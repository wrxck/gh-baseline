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
    registerScanTools(server, {
      octokit: buildFakeOctokit(),
      config: { ...defaultConfig(), unsafeAllowAll: true },
    });
    const tools = registeredToolsOf(server);
    const tool = tools.get('gh_baseline_scan_repo');
    expect(tool).toBeDefined();
    const result = await tool!.handler({ repo: 'acme/widgets' }, {});
    expect(result.isError).not.toBe(true);
    expect(result.content?.[0].type).toBe('text');
    const parsed = JSON.parse(result.content![0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const r of parsed) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('status');
    }
  });

  it('gh_baseline_diff_against_profile returns only failing/erroring entries', async () => {
    const fakeOcto = buildFakeOctokit({
      branches: {
        'acme/widgets': {
          main: { responses: [notFoundError()] },
        },
      },
      repos: { 'acme/widgets': res({}) },
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerScanTools(server, {
      octokit: fakeOcto,
      config: { ...defaultConfig(), unsafeAllowAll: true },
    });
    const tools = registeredToolsOf(server);
    const tool = tools.get('gh_baseline_diff_against_profile');
    expect(tool).toBeDefined();
    const result = await tool!.handler({ repo: 'acme/widgets' }, {});
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content![0].text) as {
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
