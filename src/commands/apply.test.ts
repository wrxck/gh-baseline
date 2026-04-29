import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Octokit } from '@octokit/rest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ApplyBranchProtectionInput,
  type ApplyBranchProtectionResult,
  type BranchProtectionRule,
} from '../actors/apply-branch-protection.js';
import { defaultConfig, type Config } from '../core/config.js';
import { GhBaselineError } from '../core/errors.js';

import { parseApplyArgs, runApply } from './apply.js';

// ---------------------------------------------------------------------------
// parseApplyArgs
// ---------------------------------------------------------------------------

describe('parseApplyArgs', () => {
  it('parses op + repo', () => {
    const p = parseApplyArgs(['branch-protection', 'acme/widgets']);
    expect(p.op).toBe('branch-protection');
    expect(p.repo).toBe('acme/widgets');
    expect(p.apply).toBe(false);
    expect(p.json).toBe(false);
    expect(p.branch).toBe('main');
    expect(p.profile).toBeUndefined();
  });

  it('parses --apply / --json / --strict / --profile / --branch', () => {
    const p = parseApplyArgs([
      'branch-protection',
      'acme/widgets',
      '--apply',
      '--json',
      '--strict',
      '--profile',
      'oss-public',
      '--branch',
      'develop',
    ]);
    expect(p.apply).toBe(true);
    expect(p.json).toBe(true);
    expect(p.strict).toBe(true);
    expect(p.profile).toBe('oss-public');
    expect(p.branch).toBe('develop');
  });

  it('accepts --flag=value form', () => {
    const p = parseApplyArgs([
      'branch-protection',
      'acme/widgets',
      '--profile=oss-public',
      '--branch=develop',
    ]);
    expect(p.profile).toBe('oss-public');
    expect(p.branch).toBe('develop');
  });

  it('rejects missing op or repo', () => {
    expect(() => parseApplyArgs([])).toThrow(/missing <op>/);
    expect(() => parseApplyArgs(['branch-protection'])).toThrow(/missing <repo>/);
  });

  it('rejects unknown flags', () => {
    expect(() =>
      parseApplyArgs(['branch-protection', 'acme/widgets', '--bogus']),
    ).toThrow(/Unknown flag/);
  });
});

// ---------------------------------------------------------------------------
// runApply (with stubs)
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gh-baseline-cmd-'));
  originalEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_AUDIT_PATH = join(tmpDir, 'audit.jsonl');
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = originalEnv;
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig(), allowedRepos: ['acme/widgets'], ...overrides };
}

describe('runApply', () => {
  it('routes to applyBranchProtection in dry-run by default and prints human summary', async () => {
    const lines: string[] = [];
    const fakeRule: BranchProtectionRule = { enforce_admins: true };
    const stubResult: ApplyBranchProtectionResult = {
      changed: true,
      diff: [{ field: 'enforce_admins', before: false, after: true }],
      before: { enforce_admins: false },
      after: null,
    };
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => stubResult,
    );

    const result = await runApply(['branch-protection', 'acme/widgets'], {
      loadConfig: () => makeConfig(),
      buildOctokit: async () => ({}) as unknown as Octokit,
      applyBranchProtection: apply,
      stdout: (l) => lines.push(l),
    });

    expect(result).toBe(stubResult);
    expect(apply).toHaveBeenCalledTimes(1);
    const callArg = apply.mock.calls[0]![0];
    expect(callArg.dryRun).toBe(true);
    expect(callArg.owner).toBe('acme');
    expect(callArg.repo).toBe('widgets');
    expect(callArg.branch).toBe('main');
    expect(typeof callArg.rule).toBe('object');
    void fakeRule; // type check only
    const out = lines.join('');
    expect(out).toMatch(/would apply 1 field change/);
    expect(out).toMatch(/dry-run/);
  });

  it('passes dryRun=false when --apply flag is set', async () => {
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: true,
        diff: [{ field: 'enforce_admins', before: false, after: true }],
        before: { enforce_admins: false },
        after: { enforce_admins: true },
      }),
    );
    const lines: string[] = [];
    await runApply(['branch-protection', 'acme/widgets', '--apply'], {
      loadConfig: () => makeConfig(),
      buildOctokit: async () => ({}) as unknown as Octokit,
      applyBranchProtection: apply,
      stdout: (l) => lines.push(l),
    });
    expect(apply.mock.calls[0]![0].dryRun).toBe(false);
    expect(lines.join('')).toMatch(/applied 1 field change/);
  });

  it('emits JSON when --json is set', async () => {
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: false,
        diff: [],
        before: { enforce_admins: true },
        after: { enforce_admins: true },
      }),
    );
    const lines: string[] = [];
    await runApply(['branch-protection', 'acme/widgets', '--json'], {
      loadConfig: () => makeConfig(),
      buildOctokit: async () => ({}) as unknown as Octokit,
      applyBranchProtection: apply,
      stdout: (l) => lines.push(l),
    });
    const parsed = JSON.parse(lines.join(''));
    expect(parsed.changed).toBe(false);
  });

  it('rejects unknown op', async () => {
    await expect(
      runApply(['nope', 'acme/widgets'], {
        loadConfig: () => makeConfig(),
      }),
    ).rejects.toThrow(/unknown op/);
  });

  it('rejects repo not in allowlist', async () => {
    await expect(
      runApply(['branch-protection', 'evil/repo'], {
        loadConfig: () => makeConfig(),
      }),
    ).rejects.toThrow();
  });

  it('--strict + dry-run + changed → throws', async () => {
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: true,
        diff: [{ field: 'enforce_admins', before: false, after: true }],
        before: null,
        after: null,
      }),
    );
    await expect(
      runApply(['branch-protection', 'acme/widgets', '--strict'], {
        loadConfig: () => makeConfig(),
        buildOctokit: async () => ({}) as unknown as Octokit,
        applyBranchProtection: apply,
        stdout: () => undefined,
      }),
    ).rejects.toBeInstanceOf(GhBaselineError);
  });

  it('--strict + --apply does NOT throw on changes', async () => {
    const apply = vi.fn(
      async (_input: ApplyBranchProtectionInput): Promise<ApplyBranchProtectionResult> => ({
        changed: true,
        diff: [{ field: 'enforce_admins', before: false, after: true }],
        before: null,
        after: { enforce_admins: true },
      }),
    );
    await expect(
      runApply(['branch-protection', 'acme/widgets', '--strict', '--apply'], {
        loadConfig: () => makeConfig(),
        buildOctokit: async () => ({}) as unknown as Octokit,
        applyBranchProtection: apply,
        stdout: () => undefined,
      }),
    ).resolves.toBeDefined();
  });
});
