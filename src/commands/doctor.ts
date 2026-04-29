import { existsSync } from 'node:fs';

import type { Octokit } from '@octokit/rest';

import { getToken, type ResolvedToken } from '../core/auth.js';
import {
  configPath,
  defaultConfig,
  loadConfig,
  type Config,
} from '../core/config.js';
import { GhBaselineError } from '../core/errors.js';
import { createOctokit, readPackageVersion } from '../core/octokit.js';
import { readAudit, resolveAuditPath } from '../core/audit.js';
import {
  c,
  error as printError,
  heading,
  info,
  plain,
  success,
  table,
  warn,
} from '../ui/output.js';

/** Categorisation of GitHub OAuth/PAT scopes for at-a-glance reporting. */
export interface ScopeBuckets {
  read: string[];
  write: string[];
  admin: string[];
  other: string[];
}

const READ_SCOPES = new Set([
  'read:org',
  'read:user',
  'read:public_key',
  'read:gpg_key',
  'read:packages',
  'read:project',
  'read:discussion',
  'read:repo_hook',
  'read:audit_log',
  'read:enterprise',
  'public_repo',
]);

const WRITE_SCOPES = new Set([
  'repo',
  'workflow',
  'write:packages',
  'write:org',
  'write:public_key',
  'write:gpg_key',
  'write:discussion',
  'write:repo_hook',
  'gist',
  'user',
  'user:email',
  'user:follow',
  'codespace',
]);

const ADMIN_SCOPES = new Set([
  'admin:org',
  'admin:public_key',
  'admin:repo_hook',
  'admin:org_hook',
  'admin:enterprise',
  'admin:gpg_key',
  'admin:ssh_signing_key',
  'delete_repo',
  'delete:packages',
  'site_admin',
]);

export function bucketScopes(scopes: string[]): ScopeBuckets {
  const buckets: ScopeBuckets = { read: [], write: [], admin: [], other: [] };
  for (const s of scopes) {
    if (ADMIN_SCOPES.has(s)) buckets.admin.push(s);
    else if (WRITE_SCOPES.has(s)) buckets.write.push(s);
    else if (READ_SCOPES.has(s)) buckets.read.push(s);
    else buckets.other.push(s);
  }
  return buckets;
}

export interface RepoProbeResult {
  repo: string;
  reachable: boolean;
  status?: number;
  error?: string;
}

export interface DoctorReport {
  ok: boolean;
  config: {
    path: string;
    exists: boolean;
    valid: boolean;
    error?: string;
  };
  auth: {
    mode: 'gh-cli' | 'pat' | 'unknown';
    source?: 'gh-cli' | 'pat-file';
    scopes: string[];
    buckets: ScopeBuckets;
    error?: string;
  };
  defaultProfile: string;
  allowedRepos: {
    total: number;
    reachable: number;
    unreachable: number;
    probes: RepoProbeResult[];
  };
  audit: {
    path: string;
    entries: number;
  };
  rateLimit: {
    perMinute: number;
  };
  octokit: {
    version: string;
    userAgent: string;
  };
}

/**
 * Test/MCP seam: provides the Octokit instance + token resolver.
 * Prod path uses the real `getToken`/`createOctokit`; tests inject fakes.
 */
export interface DoctorDeps {
  resolveToken?: (config: Config) => Promise<ResolvedToken>;
  octokitFactory?: (token: string) => Pick<Octokit, 'request'>;
}

export interface DoctorOptions {
  json?: boolean;
  deps?: DoctorDeps;
}

/** Build the structured report without printing. Used by `doctor` and MCP. */
export async function buildDoctorReport(
  opts: DoctorOptions = {},
): Promise<DoctorReport> {
  const cfgPath = configPath();
  const exists = existsSync(cfgPath);

  let config: Config = defaultConfig();
  let configValid = true;
  let configError: string | undefined;
  if (exists) {
    try {
      config = loadConfig();
    } catch (err) {
      configValid = false;
      configError = err instanceof Error ? err.message : String(err);
    }
  } else {
    configValid = false;
    configError = 'config file not found — run `gh-baseline init`';
  }

  const report: DoctorReport = {
    ok: true,
    config: {
      path: cfgPath,
      exists,
      valid: configValid,
      ...(configError !== undefined ? { error: configError } : {}),
    },
    auth: {
      mode: config.auth.mode,
      scopes: [],
      buckets: { read: [], write: [], admin: [], other: [] },
    },
    defaultProfile: config.defaultProfile,
    allowedRepos: {
      total: config.allowedRepos.length,
      reachable: 0,
      unreachable: 0,
      probes: [],
    },
    audit: {
      path: resolveAuditPath({ config }),
      entries: 0,
    },
    rateLimit: { perMinute: config.rateLimit.perMinute },
    octokit: {
      version: readPackageVersion(),
      userAgent: `gh-baseline/${readPackageVersion()}`,
    },
  };

  if (!configValid) report.ok = false;

  // Auth + scopes.
  let token: string | undefined;
  if (configValid) {
    try {
      const resolveToken = opts.deps?.resolveToken ?? getToken;
      const resolved = await resolveToken(config);
      token = resolved.token;
      report.auth.source = resolved.source;
      report.auth.scopes = resolved.scopes;
      report.auth.buckets = bucketScopes(resolved.scopes);
    } catch (err) {
      report.ok = false;
      report.auth.error = err instanceof Error ? err.message : String(err);
    }
  }

  // Audit log entry count.
  try {
    report.audit.entries = readAudit({ config }).length;
  } catch {
    report.audit.entries = 0;
  }

  // Probe allowed repos. Only when we have a working token and at least one repo.
  if (token !== undefined && config.allowedRepos.length > 0) {
    const factory =
      opts.deps?.octokitFactory ??
      ((tok: string): Pick<Octokit, 'request'> => createOctokit(tok));
    const octokit = factory(token);
    for (const slug of config.allowedRepos) {
      const probe = await probeRepo(octokit, slug);
      report.allowedRepos.probes.push(probe);
      if (probe.reachable) report.allowedRepos.reachable += 1;
      else {
        report.allowedRepos.unreachable += 1;
        report.ok = false;
      }
    }
  }

  return report;
}

async function probeRepo(
  octokit: Pick<Octokit, 'request'>,
  slug: string,
): Promise<RepoProbeResult> {
  const [owner, repo] = slug.split('/', 2);
  if (!owner || !repo) {
    return { repo: slug, reachable: false, error: 'malformed slug (expected owner/name)' };
  }
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
    return { repo: slug, reachable: true, status: res.status };
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status?: number }).status
        : undefined;
    const message = err instanceof Error ? err.message : String(err);
    return {
      repo: slug,
      reachable: false,
      ...(status !== undefined ? { status } : {}),
      error: message,
    };
  }
}

/** CLI entrypoint. Returns process exit code. */
export async function doctor(opts: DoctorOptions = {}): Promise<number> {
  let report: DoctorReport;
  try {
    report = await buildDoctorReport(opts);
  } catch (err) {
    if (opts.json) {
      const payload = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      plain(JSON.stringify(payload, null, 2));
    } else {
      printError(err instanceof Error ? err.message : String(err));
    }
    return err instanceof GhBaselineError ? err.exitCode : 1;
  }

  if (opts.json) {
    plain(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  printDoctorReport(report);
  return report.ok ? 0 : 1;
}

function printDoctorReport(report: DoctorReport): void {
  heading('gh-baseline doctor');

  if (report.config.exists && report.config.valid) {
    success(`config: ${report.config.path}`);
  } else if (report.config.exists) {
    warn(`config: ${report.config.path} (invalid — ${report.config.error ?? 'unknown error'})`);
  } else {
    warn(`config: ${report.config.path} (missing — run \`gh-baseline init\`)`);
  }

  if (report.auth.error) {
    warn(`auth: ${report.auth.mode} (${report.auth.error})`);
  } else {
    const src = report.auth.source ?? report.auth.mode;
    success(`auth: ${src}`);
  }

  const tickOrCross = (have: string[]): string =>
    have.length > 0 ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  info(
    `scopes: read ${tickOrCross(report.auth.buckets.read)}  ` +
      `write ${tickOrCross(report.auth.buckets.write)}  ` +
      `admin ${tickOrCross(report.auth.buckets.admin)}` +
      (report.auth.scopes.length > 0
        ? `  (${report.auth.scopes.join(', ')})`
        : ''),
  );

  info(`default profile: ${report.defaultProfile}`);

  if (report.allowedRepos.total === 0) {
    warn('allowed repos: 0 (config has no allowedRepos — every scan/apply will be blocked)');
  } else {
    const summary =
      `allowed repos: ${report.allowedRepos.total} ` +
      `(${report.allowedRepos.reachable} reachable, ${report.allowedRepos.unreachable} unreachable)`;
    if (report.allowedRepos.unreachable === 0) success(summary);
    else warn(summary);
    if (report.allowedRepos.probes.length > 0) {
      const rows = report.allowedRepos.probes.map((p) => [
        p.repo,
        p.reachable ? `${c.green}reachable${c.reset}` : `${c.red}unreachable${c.reset}`,
        p.status !== undefined ? String(p.status) : '-',
        p.error ?? '',
      ]);
      table(['repo', 'status', 'http', 'error'], rows);
    }
  }

  info(`audit log: ${report.audit.path} (${report.audit.entries} entries)`);
  info(`rate limit: ${report.rateLimit.perMinute}/min`);
  info(`octokit: ${report.octokit.userAgent}`);

  if (report.ok) {
    success('all checks passed');
  } else {
    printError('one or more checks failed (see above)');
  }
}
