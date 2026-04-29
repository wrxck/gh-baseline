import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Octokit } from '@octokit/rest';
import { z } from 'zod';

import { runChecks, type CheckResult } from '../checks/index.js';
import { buildAuditView } from '../commands/audit.js';
import { buildDoctorReport } from '../commands/doctor.js';
import { listProfiles } from '../commands/profiles.js';
import { checkAllowed } from '../core/allowlist.js';
import { auditLog } from '../core/audit.js';
import { getToken } from '../core/auth.js';
import { loadConfig, type Config } from '../core/config.js';
import { createOctokit } from '../core/octokit.js';
import { assertRepoSlug } from '../core/validate.js';
import { getProfile } from '../profiles/index.js';

// ---------------------------------------------------------------------------
// Tier 1 — read-only scan/diff
// ---------------------------------------------------------------------------

export interface RegisterScanToolsDeps {
  /** Inject an octokit (tests). When set, on-disk auth is bypassed. */
  octokit?: Octokit;
  /** Inject a config (tests). When set, the on-disk config is not loaded. */
  config?: Config;
}

async function resolveScanDeps(
  deps: RegisterScanToolsDeps,
): Promise<{ octokit: Octokit; config: Config }> {
  const config = deps.config ?? loadConfig();
  if (deps.octokit) return { octokit: deps.octokit, config };
  const tok = await getToken(config);
  return { octokit: createOctokit(tok.token), config };
}

const ScanToolInputShape = {
  repo: z.string(),
  profile: z.string().optional(),
} as const;

export function registerScanTools(server: McpServer, deps: RegisterScanToolsDeps = {}): void {
  server.registerTool(
    'gh_baseline_scan_repo',
    {
      description:
        'Run every read-only baseline check against a repository and return the structured CheckResult[] as JSON.',
      inputSchema: ScanToolInputShape,
    },
    async (args) => {
      const repo = args.repo;
      assertRepoSlug(repo);
      const { octokit, config } = await resolveScanDeps(deps);
      checkAllowed(repo, config);
      const profile = getProfile(args.profile ?? config.defaultProfile);
      let results: CheckResult[] = [];
      let errMsg: string | undefined;
      try {
        results = await runChecks(octokit, repo, profile);
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }
      await auditLog({
        tool: 'mcp.gh_baseline_scan_repo',
        repo,
        args: { profile: profile.id },
        result: errMsg === undefined ? 'ok' : 'error',
        ...(errMsg !== undefined ? { error: errMsg } : {}),
        dryRun: true,
      }).catch(() => undefined);
      if (errMsg !== undefined) {
        return { content: [{ type: 'text', text: errMsg }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );

  server.registerTool(
    'gh_baseline_diff_against_profile',
    {
      description:
        'Run baseline checks and return only the failing/erroring CheckResult entries, ' +
        'i.e. the actionable drift between the repository and the profile.',
      inputSchema: ScanToolInputShape,
    },
    async (args) => {
      const repo = args.repo;
      assertRepoSlug(repo);
      const { octokit, config } = await resolveScanDeps(deps);
      checkAllowed(repo, config);
      const profile = getProfile(args.profile ?? config.defaultProfile);
      let failing: CheckResult[] = [];
      let errMsg: string | undefined;
      try {
        const all = await runChecks(octokit, repo, profile);
        failing = all.filter((r) => r.status === 'fail' || r.status === 'error');
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }
      await auditLog({
        tool: 'mcp.gh_baseline_diff_against_profile',
        repo,
        args: { profile: profile.id },
        result: errMsg === undefined ? 'ok' : 'error',
        ...(errMsg !== undefined ? { error: errMsg } : {}),
        dryRun: true,
      }).catch(() => undefined);
      if (errMsg !== undefined) {
        return { content: [{ type: 'text', text: errMsg }], isError: true };
      }
      const payload = { repo, profile: profile.id, failing };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );
}

// ---------------------------------------------------------------------------
// Tier 1 — supporting tools (doctor / audit / profiles list)
// ---------------------------------------------------------------------------

export function registerSupportTools(server: McpServer): void {
  server.registerTool(
    'gh_baseline_doctor',
    {
      description:
        'Run the gh-baseline doctor self-check. Returns config validity, auth/scopes, ' +
        'allowed-repo reachability, audit log size, and the configured rate limit.',
      inputSchema: {},
    },
    async () => {
      const report = await buildDoctorReport();
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        structuredContent: report as unknown as Record<string, unknown>,
        isError: !report.ok,
      };
    },
  );

  server.registerTool(
    'gh_baseline_audit_tail',
    {
      description:
        'Return the most recent gh-baseline audit log entries. Optional `count` (default 20), `tool`, and `repo` filters.',
      inputSchema: {
        count: z.number().int().positive().max(1000).optional(),
        tool: z.string().optional(),
        repo: z
          .string()
          .optional()
          .refine(
            (v) => {
              if (v === undefined) return true;
              try {
                assertRepoSlug(v);
                return true;
              } catch {
                return false;
              }
            },
            { message: 'repo must be a valid owner/name slug' },
          ),
      },
    },
    async (args) => {
      const view = buildAuditView({
        tail: args.count ?? 20,
        ...(args.tool !== undefined ? { tool: args.tool } : {}),
        ...(args.repo !== undefined ? { repo: args.repo } : {}),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(view, null, 2) }],
        structuredContent: view as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'gh_baseline_list_profiles',
    {
      description:
        'List the profile metadata bundled with gh-baseline (id, name, description). ' +
        'Returns an empty list with a note if the profile registry has not been wired in this build.',
      inputSchema: {},
    },
    async () => {
      const all = await listProfiles();
      const payload =
        all.length === 0
          ? {
              profiles: [],
              note: 'profile registry not yet available — bundled profiles will appear once src/profiles/index.ts is published',
            }
          : { profiles: all };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}

export async function startMcpServer(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

  const server = new McpServer({
    name: 'gh-baseline',
    version: pkg.version,
  });

  registerScanTools(server);
  registerSupportTools(server);
  // 'apply' tools registered by feat/apply-branch-protection (#14).

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
