import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Octokit } from '@octokit/rest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ApplyBranchProtectionInput,
  type ApplyBranchProtectionResult,
  type BranchProtectionRule,
} from '../actors/apply-branch-protection.js';
import { defaultConfig, type Config } from '../core/config.js';

import { registerBranchProtectionTools } from './server.js';

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gh-baseline-mcp-'));
  originalEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_AUDIT_PATH = join(tmpDir, 'audit.jsonl');
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = originalEnv;
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(): Config {
  return { ...defaultConfig(), allowedRepos: ['acme/widgets'] };
}

function makeServer(): McpServer {
  return new McpServer({ name: 'gh-baseline-test', version: '0.0.0' });
}

describe('registerBranchProtectionTools', () => {
  it('registers without throwing', () => {
    const server = makeServer();
    expect(() => registerBranchProtectionTools(server)).not.toThrow();
  });

  it('apply tool: invokes underlying actor with dryRun default true', async () => {
    const server = makeServer();
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: true,
        diff: [{ field: 'enforce_admins', before: false, after: true }],
        before: { enforce_admins: false },
        after: null,
      }),
    );
    registerBranchProtectionTools(server, {
      loadConfig: () => makeConfig(),
      buildOctokit: async () => ({}) as unknown as Octokit,
      applyBranchProtection: apply,
      buildRuleFromProfile: (): BranchProtectionRule => ({ enforce_admins: true }),
    });

    // Reach into the registered tool callback. McpServer doesn't expose a
    // public "call this tool" hook for in-process use, so we invoke via the
    // internal _registeredTools map. This is fine for tests — we own the
    // server object.
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra?: unknown) => Promise<unknown> }> })._registeredTools;
    const applyTool = tools['gh_baseline_apply_branch_protection'];
    expect(applyTool).toBeDefined();

    const result = (await applyTool!.handler(
      { repo: 'acme/widgets', branch: 'main', dryRun: true },
      {},
    )) as { structuredContent?: { changed: boolean }; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.changed).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0].dryRun).toBe(true);
  });

  it('apply tool: dryRun:false is honoured', async () => {
    const server = makeServer();
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: true,
        diff: [{ field: 'enforce_admins', before: false, after: true }],
        before: null,
        after: { enforce_admins: true },
      }),
    );
    registerBranchProtectionTools(server, {
      loadConfig: () => makeConfig(),
      buildOctokit: async () => ({}) as unknown as Octokit,
      applyBranchProtection: apply,
      buildRuleFromProfile: () => ({ enforce_admins: true }),
    });

    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra?: unknown) => Promise<unknown> }> })._registeredTools;
    await tools['gh_baseline_apply_branch_protection']!.handler(
      { repo: 'acme/widgets', branch: 'main', dryRun: false },
      {},
    );
    expect(apply.mock.calls[0]![0].dryRun).toBe(false);
  });

  it('diff tool: forces dryRun=true and omits "after"', async () => {
    const server = makeServer();
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: true,
        diff: [{ field: 'enforce_admins', before: false, after: true }],
        before: { enforce_admins: false },
        after: null,
      }),
    );
    registerBranchProtectionTools(server, {
      loadConfig: () => makeConfig(),
      buildOctokit: async () => ({}) as unknown as Octokit,
      applyBranchProtection: apply,
      buildRuleFromProfile: () => ({ enforce_admins: true }),
    });

    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra?: unknown) => Promise<unknown> }> })._registeredTools;
    const diffTool = tools['gh_baseline_diff_branch_protection'];
    expect(diffTool).toBeDefined();

    const result = (await diffTool!.handler(
      { repo: 'acme/widgets', branch: 'main' },
      {},
    )) as {
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    expect(Object.keys(result.structuredContent!)).toEqual(['changed', 'diff', 'before']);
    expect(apply.mock.calls[0]![0].dryRun).toBe(true);
  });

  it('apply tool: invalid repo slug → isError', async () => {
    const server = makeServer();
    registerBranchProtectionTools(server, {
      loadConfig: () => makeConfig(),
    });
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra?: unknown) => Promise<unknown> }> })._registeredTools;
    // The McpServer auto-validates inputSchema; calling with an invalid slug
    // should surface as an error to the caller. We invoke the callback
    // directly here, but the callback also re-runs assertions inside, so
    // either layer rejects.
    const result = (await tools['gh_baseline_apply_branch_protection']!.handler(
      { repo: 'not a slug', branch: 'main', dryRun: true },
      {},
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it('apply tool: repo not in allowlist → isError', async () => {
    const server = makeServer();
    registerBranchProtectionTools(server, {
      loadConfig: () => makeConfig(),
      buildOctokit: async () => ({}) as unknown as Octokit,
      applyBranchProtection: vi.fn(),
      buildRuleFromProfile: () => ({ enforce_admins: true }),
    });
    const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra?: unknown) => Promise<unknown> }> })._registeredTools;
    const result = (await tools['gh_baseline_apply_branch_protection']!.handler(
      { repo: 'evil/repo', branch: 'main', dryRun: true },
      {},
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});
