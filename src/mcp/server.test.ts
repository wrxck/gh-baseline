import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { buildFakeOctokit, notFoundError, res } from '../checks/test-helpers.js';
import { defaultConfig } from '../core/config.js';

import { registerScanTools } from './server.js';

interface RegisteredTool {
  description?: string;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content?: Array<{ type: string; text: string }>; isError?: boolean }>;
}

function registeredToolsOf(server: McpServer): Map<string, RegisteredTool> {
  // McpServer exposes its registered tools as `_registeredTools` (private).
  // Cast carefully — this is test-only introspection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = (server as any)._registeredTools as Record<string, RegisteredTool>;
  return new Map(Object.entries(map));
}

let tmp: string;
let prevAuditEnv: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-mcp-'));
  prevAuditEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_AUDIT_PATH = join(tmp, 'audit.jsonl');
});

afterEach(() => {
  if (prevAuditEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = prevAuditEnv;
  rmSync(tmp, { recursive: true, force: true });
});

describe('registerScanTools', () => {
  it('registers gh_baseline_scan_repo and gh_baseline_diff_against_profile', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerScanTools(server, {
      octokit: buildFakeOctokit(),
      config: { ...defaultConfig(), unsafeAllowAll: true },
    });
    const tools = registeredToolsOf(server);
    expect(tools.has('gh_baseline_scan_repo')).toBe(true);
    expect(tools.has('gh_baseline_diff_against_profile')).toBe(true);
  });

  it('gh_baseline_scan_repo invokes the registered handler and returns JSON content', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const fullResponses = {
      reposGet: async () =>
        res({
          description: 'A widget',
          homepage: 'https://example.com',
          topics: ['cli', 'security', 'github'],
          license: { spdx_id: 'MIT' },
          allow_squash_merge: true,
          allow_merge_commit: false,
          allow_rebase_merge: false,
          allow_auto_merge: true,
          delete_branch_on_merge: true,
          default_branch: 'main',
          security_and_analysis: {
            secret_scanning: { status: 'enabled' },
            secret_scanning_push_protection: { status: 'enabled' },
          },
        }),
      reposGetBranchProtection: async () =>
        res({
          required_status_checks: {
            strict: true,
            contexts: ['build-and-test (20)', 'build-and-test (22)'],
          },
          required_pull_request_reviews: {
            required_approving_review_count: 1,
            dismiss_stale_reviews: true,
            require_code_owner_reviews: false,
            require_last_push_approval: false,
          },
          enforce_admins: { enabled: true },
          required_signatures: { enabled: false },
          required_linear_history: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
          required_conversation_resolution: { enabled: true },
          restrictions: null,
        }),
      issuesListLabelsForRepo: async () => res([]),
      reposGetContent: async () => {
        throw notFoundError();
      },
      request: async () => res({ files: { readme: { url: 'x' }, contributing: { url: 'x' }, code_of_conduct: { url: 'x' } } }),
    };
    registerScanTools(server, {
      octokit: buildFakeOctokit(fullResponses),
      config: { ...defaultConfig(), unsafeAllowAll: true },
    });
    const tools = registeredToolsOf(server);
    const scanTool = tools.get('gh_baseline_scan_repo');
    expect(scanTool).toBeDefined();
    const out = await scanTool!.handler({ repo: 'acme/widgets' }, {});
    expect(out.isError).toBeUndefined();
    expect(out.content?.[0]?.type).toBe('text');
    const parsed = JSON.parse(out.content![0]!.text) as Array<{ id: string; status: string }>;
    expect(parsed.map((r) => r.id)).toContain('repo-metadata');
  });

  it('gh_baseline_diff_against_profile filters out passes', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerScanTools(server, {
      octokit: buildFakeOctokit({
        reposGet: async () => {
          throw new Error('boom');
        },
        reposGetBranchProtection: async () => {
          throw new Error('boom');
        },
        issuesListLabelsForRepo: async () => res([]),
        reposGetContent: async () => {
          throw notFoundError();
        },
        request: async () => {
          throw new Error('boom');
        },
      }),
      config: { ...defaultConfig(), unsafeAllowAll: true },
    });
    const tools = registeredToolsOf(server);
    const diffTool = tools.get('gh_baseline_diff_against_profile');
    const out = await diffTool!.handler({ repo: 'acme/widgets' }, {});
    const payload = JSON.parse(out.content![0]!.text) as {
      repo: string;
      profile: string;
      failing: Array<{ status: string }>;
    };
    expect(payload.repo).toBe('acme/widgets');
    // Every failing entry must be 'fail' or 'error' (no passes leaked in).
    expect(payload.failing.every((f) => f.status === 'fail' || f.status === 'error')).toBe(true);
    expect(payload.failing.length).toBeGreaterThan(0);
  });
});
