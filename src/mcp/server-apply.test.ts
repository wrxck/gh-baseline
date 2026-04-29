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
  tmpDir = mkdtempSync(join(tmpdir(), 'gh-baseline-mcp-apply-'));
  originalEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_AUDIT_PATH = join(tmpDir, 'audit.jsonl');
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = originalEnv;
  rmSync(tmpDir, { recursive: true, force: true });
});

interface RegisteredTool {
  description?: string;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content?: Array<{ type: string; text: string }>; isError?: boolean; structuredContent?: unknown }>;
}

function registeredToolsOf(server: McpServer): Map<string, RegisteredTool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = (server as any)._registeredTools as Record<string, RegisteredTool>;
  return new Map(Object.entries(map));
}

function fakeRule(): BranchProtectionRule {
  return { required_signatures: true };
}

function fakeConfig(): Config {
  return { ...defaultConfig(), unsafeAllowAll: true };
}

describe('registerBranchProtectionTools', () => {
  it('registers gh_baseline_apply_branch_protection and gh_baseline_diff_branch_protection', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerBranchProtectionTools(server, {
      loadConfig: fakeConfig,
      buildOctokit: async () => ({} as unknown as Octokit),
      buildRuleFromProfile: fakeRule,
      applyBranchProtection: async (
        _input: ApplyBranchProtectionInput,
      ): Promise<ApplyBranchProtectionResult> => ({
        changed: false,
        diff: [],
        before: null,
        after: null,
      }),
    });
    const tools = registeredToolsOf(server);
    expect(tools.has('gh_baseline_apply_branch_protection')).toBe(true);
    expect(tools.has('gh_baseline_diff_branch_protection')).toBe(true);
  });

  it('apply tool returns structured result for happy path', async () => {
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: true,
        diff: [{ field: 'required_signatures', before: false, after: true }],
        before: { required_signatures: false },
        after: { required_signatures: true },
      }),
    );
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerBranchProtectionTools(server, {
      loadConfig: fakeConfig,
      buildOctokit: async () => ({} as unknown as Octokit),
      buildRuleFromProfile: fakeRule,
      applyBranchProtection: apply,
    });
    const tools = registeredToolsOf(server);
    const tool = tools.get('gh_baseline_apply_branch_protection');
    expect(tool).toBeDefined();
    const result = await tool!.handler(
      { repo: 'acme/widgets', branch: 'main', dryRun: false },
      {},
    );
    expect(result.isError).not.toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content![0].text) as ApplyBranchProtectionResult;
    expect(parsed.changed).toBe(true);
    expect(parsed.diff.length).toBe(1);
  });

  it('diff tool forces dry-run and strips after', async () => {
    const apply = vi.fn(
      async (input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => {
        // The diff tool should always pass dryRun=true regardless of caller.
        expect(input.dryRun).toBe(true);
        return {
          changed: true,
          diff: [{ field: 'required_signatures', before: false, after: true }],
          before: { required_signatures: false },
          after: null,
        };
      },
    );
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerBranchProtectionTools(server, {
      loadConfig: fakeConfig,
      buildOctokit: async () => ({} as unknown as Octokit),
      buildRuleFromProfile: fakeRule,
      applyBranchProtection: apply,
    });
    const tools = registeredToolsOf(server);
    const tool = tools.get('gh_baseline_diff_branch_protection');
    expect(tool).toBeDefined();
    const result = await tool!.handler({ repo: 'acme/widgets', branch: 'main' }, {});
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(result.content![0].text);
    expect(parsed).toHaveProperty('changed', true);
    expect(parsed).toHaveProperty('diff');
    expect(parsed).toHaveProperty('before');
    expect(parsed).not.toHaveProperty('after');
  });

  it('apply tool surfaces errors as isError=true', async () => {
    const apply = vi.fn(async () => {
      throw new Error('octokit explosion');
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerBranchProtectionTools(server, {
      loadConfig: fakeConfig,
      buildOctokit: async () => ({} as unknown as Octokit),
      buildRuleFromProfile: fakeRule,
      applyBranchProtection: apply,
    });
    const tools = registeredToolsOf(server);
    const tool = tools.get('gh_baseline_apply_branch_protection');
    const result = await tool!.handler(
      { repo: 'acme/widgets', branch: 'main', dryRun: true },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content![0].text).toContain('octokit explosion');
  });
});
