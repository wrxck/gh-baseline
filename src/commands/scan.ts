// `gh-baseline scan` command. Reads config + auth, builds an octokit, and
// runs every check against either a single repo (positional `<repo>`) or
// every allowlisted repo (`--all`). Output is a pretty per-repo table by
// default; `--json` emits a structured array.

import type { Octokit } from '@octokit/rest';

import { runChecks, type CheckResult } from '../checks/index.js';
import { auditLog } from '../core/audit.js';
import { checkAllowed } from '../core/allowlist.js';
import { getToken, requireScopes } from '../core/auth.js';
import { loadConfig, type Config } from '../core/config.js';
import { GhBaselineError } from '../core/errors.js';
import { createOctokit } from '../core/octokit.js';
import { assertRepoSlug } from '../core/validate.js';
import { getProfile } from '../profiles/index.js';
import type { Profile } from '../profiles/types.js';

export interface ScanOptions {
  /** Inject an octokit (tests / programmatic callers). When set, auth + scope checks are skipped. */
  octokit?: Octokit;
  /** Inject a config (tests). When set, the on-disk config is not loaded. */
  config?: Config;
  /** Override stdout writer. */
  stdout?: (chunk: string) => void;
  /** Override stderr writer. */
  stderr?: (chunk: string) => void;
}

export interface ScanReportRow {
  repo: string;
  profile: string;
  results: CheckResult[];
}

interface ParsedArgs {
  repo?: string;
  all: boolean;
  profileId?: string;
  json: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = { all: false, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '--all') {
      out.all = true;
      continue;
    }
    if (a === '--json') {
      out.json = true;
      continue;
    }
    if (a === '--profile') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new GhBaselineError('--profile requires an argument', 1);
      }
      out.profileId = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--profile=')) {
      out.profileId = a.slice('--profile='.length);
      continue;
    }
    if (a.startsWith('--')) {
      throw new GhBaselineError(`Unknown flag: ${a}`, 1);
    }
    if (out.repo === undefined) {
      out.repo = a;
    } else {
      throw new GhBaselineError(`Unexpected positional argument: ${a}`, 1);
    }
  }
  return out;
}

function resolveTargetRepos(parsed: ParsedArgs, config: Config): string[] {
  if (parsed.repo !== undefined) {
    assertRepoSlug(parsed.repo);
    return [parsed.repo];
  }
  if (!parsed.all) {
    throw new GhBaselineError('scan requires either <repo> or --all', 1);
  }
  // --all: take every fully-qualified slug from allowedRepos. Org-level
  // entries (`acme` or `acme/*`) can't be enumerated without additional API
  // calls, so we surface those as a hint.
  const slugs: string[] = [];
  const orgs: string[] = [];
  for (const e of config.allowedRepos) {
    if (e === '*' || e.endsWith('/*')) {
      orgs.push(e);
      continue;
    }
    if (e.includes('/')) {
      slugs.push(e);
    } else {
      orgs.push(e);
    }
  }
  for (const e of config.allowedOrgs) orgs.push(e);
  if (slugs.length === 0) {
    const hint =
      orgs.length > 0
        ? ` (org-level entries [${orgs.join(', ')}] cannot be enumerated by --all yet)`
        : '';
    throw new GhBaselineError(`--all: no fully-qualified repos in allowedRepos${hint}`, 1);
  }
  return slugs;
}

function statusGlyph(s: CheckResult['status']): string {
  switch (s) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'skip':
      return 'SKIP';
    case 'error':
      return 'ERR ';
  }
}

export function formatHumanReport(rows: ScanReportRow[]): string {
  const lines: string[] = [];
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;
  let totalError = 0;
  for (const row of rows) {
    lines.push(`\nrepo: ${row.repo}  profile: ${row.profile}`);
    const idWidth = Math.max(...row.results.map((r) => r.id.length), 4);
    for (const r of row.results) {
      lines.push(`  [${statusGlyph(r.status)}] ${r.id.padEnd(idWidth)}  ${r.summary}`);
      if (r.status === 'pass') totalPass += 1;
      else if (r.status === 'fail') totalFail += 1;
      else if (r.status === 'skip') totalSkip += 1;
      else totalError += 1;
    }
  }
  lines.push('');
  lines.push(
    `total: ${totalPass} pass, ${totalFail} fail, ${totalSkip} skip, ${totalError} error`,
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * Execute the scan command. Designed to be import-safe: `opts.octokit` and
 * `opts.config` let tests bypass disk + network without monkey-patching.
 */
export async function scanCommand(args: string[], opts: ScanOptions = {}): Promise<void> {
  const stdout = opts.stdout ?? ((c: string) => process.stdout.write(c));
  const stderr = opts.stderr ?? ((c: string) => process.stderr.write(c));
  const parsed = parseArgs(args);

  const config = opts.config ?? loadConfig();
  const profileId = parsed.profileId ?? config.defaultProfile;
  const profile: Profile = getProfile(profileId);

  let octokit: Octokit;
  if (opts.octokit) {
    octokit = opts.octokit;
  } else {
    const tok = await getToken(config);
    // Fine-grained tokens use 'metadata:read' / 'repo:read'; classic PATs
    // use the coarse 'repo' scope. Accept either by checking 'repo' or both
    // fine-grained scopes. requireScopes is strict; do the check ourselves
    // and only call requireScopes for its canonical error shape.
    const have = new Set(tok.scopes);
    if (!have.has('repo') && !(have.has('metadata:read') && have.has('repo:read'))) {
      requireScopes(tok.scopes, ['repo']);
    }
    octokit = createOctokit(tok.token);
  }

  const targets = resolveTargetRepos(parsed, config);
  const rows: ScanReportRow[] = [];
  for (const repoSlug of targets) {
    try {
      checkAllowed(repoSlug, config);
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await auditLog({
        tool: 'scan',
        repo: repoSlug,
        result: 'error',
        error: err instanceof Error ? err.message : String(err),
        dryRun: true,
      }).catch(() => undefined);
      stderr(
        `scan: skipping ${repoSlug} (${err instanceof Error ? err.message : String(err)})\n`,
      );
      continue;
    }
    let results: CheckResult[];
    try {
      // eslint-disable-next-line no-await-in-loop
      results = await runChecks(octokit, repoSlug, profile);
      // eslint-disable-next-line no-await-in-loop
      await auditLog({
        tool: 'scan',
        repo: repoSlug,
        args: { profile: profile.id },
        result: 'ok',
        dryRun: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-await-in-loop
      await auditLog({
        tool: 'scan',
        repo: repoSlug,
        args: { profile: profile.id },
        result: 'error',
        error: message,
        dryRun: true,
      }).catch(() => undefined);
      results = [{ id: 'scan', status: 'error', summary: `scan failed: ${message}` }];
    }
    rows.push({ repo: repoSlug, profile: profile.id, results });
  }

  if (parsed.json) {
    stdout(JSON.stringify(rows, null, 2) + '\n');
  } else {
    stdout(formatHumanReport(rows));
  }
}
