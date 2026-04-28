import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Octokit } from '@octokit/rest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAudit } from '../core/audit.js';
import { GhBaselineError } from '../core/errors.js';
import {
  applyBranchProtection,
  computeProtectionDiff,
  type BranchProtectionRule,
} from './apply-branch-protection.js';

// ---------------------------------------------------------------------------
// Pure diff tests
// ---------------------------------------------------------------------------

describe('computeProtectionDiff', () => {
  it('returns empty diff when target matches before', () => {
    const before: BranchProtectionRule = {
      enforce_admins: true,
      allow_force_pushes: false,
    };
    const target: BranchProtectionRule = { enforce_admins: true };
    expect(computeProtectionDiff(before, target)).toEqual([]);
  });

  it('reports missing protection (before=null) as full additions', () => {
    const target: BranchProtectionRule = {
      enforce_admins: true,
      required_linear_history: true,
    };
    const diff = computeProtectionDiff(null, target);
    expect(diff).toEqual([
      { field: 'enforce_admins', before: undefined, after: true },
      { field: 'required_linear_history', before: undefined, after: true },
    ]);
  });

  it('reports field-level changes only for declared target fields', () => {
    const before: BranchProtectionRule = {
      enforce_admins: false,
      allow_force_pushes: true,
      allow_deletions: true,
    };
    const target: BranchProtectionRule = {
      enforce_admins: true,
      // `allow_deletions` not declared — should be preserved, not in diff.
    };
    const diff = computeProtectionDiff(before, target);
    expect(diff).toEqual([{ field: 'enforce_admins', before: false, after: true }]);
  });

  it('compares nested objects structurally (key order independent)', () => {
    const before: BranchProtectionRule = {
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismiss_stale_reviews: true,
      },
    };
    const target: BranchProtectionRule = {
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        required_approving_review_count: 1,
      },
    };
    expect(computeProtectionDiff(before, target)).toEqual([]);
  });

  it('detects array contents differences', () => {
    const before: BranchProtectionRule = {
      required_status_checks: { strict: true, contexts: ['ci', 'lint'] },
    };
    const target: BranchProtectionRule = {
      required_status_checks: { strict: true, contexts: ['ci', 'lint', 'typecheck'] },
    };
    const diff = computeProtectionDiff(before, target);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.field).toBe('required_status_checks');
  });

  it('handles null target value distinct from undefined', () => {
    const before: BranchProtectionRule = {
      required_pull_request_reviews: { required_approving_review_count: 1 },
    };
    const target: BranchProtectionRule = { required_pull_request_reviews: null };
    const diff = computeProtectionDiff(before, target);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.after).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Fake octokit + audit fixture
// ---------------------------------------------------------------------------

interface FakeRequest {
  route: string;
  params: Record<string, unknown>;
}

interface FakeOctokitOpts {
  /** Response for GET /…/protection. `null` triggers a 404. */
  protection: BranchProtectionRule | null;
  /** Optional throw-on-PUT for error-path tests. */
  putError?: Error;
}

function makeFakeOctokit(
  opts: FakeOctokitOpts,
): { octokit: Octokit; calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  const request = async (route: string, params: Record<string, unknown>) => {
    calls.push({ route, params });
    if (route.startsWith('GET ')) {
      if (opts.protection === null) {
        const err = new Error('Not Found') as Error & { status?: number };
        err.status = 404;
        throw err;
      }
      // Mimic the GET shape: scalar fields wrapped in { enabled }.
      const data: Record<string, unknown> = {};
      const wrapped: Array<keyof BranchProtectionRule> = [
        'enforce_admins',
        'required_signatures',
        'required_linear_history',
        'allow_force_pushes',
        'allow_deletions',
        'required_conversation_resolution',
        'block_creations',
        'lock_branch',
      ];
      for (const k of wrapped) {
        const v = opts.protection[k];
        if (v !== undefined) data[k] = { enabled: v };
      }
      if (opts.protection.required_pull_request_reviews !== undefined) {
        data.required_pull_request_reviews = opts.protection.required_pull_request_reviews;
      }
      if (opts.protection.required_status_checks !== undefined) {
        data.required_status_checks = opts.protection.required_status_checks;
      }
      return { data, status: 200, headers: {}, url: '' };
    }
    if (route.startsWith('PUT ')) {
      if (opts.putError) throw opts.putError;
      return { data: {}, status: 200, headers: {}, url: '' };
    }
    throw new Error(`unexpected route ${route}`);
  };
  // Octokit's runtime has many methods; we only use `.request`. Cast is local
  // to the test fixture and never escapes.
  const octokit = { request } as unknown as Octokit;
  return { octokit, calls };
}

// Per-test scratch audit log so we can assert audit emission without polluting
// the user's real audit file.
let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gh-baseline-actor-'));
  originalEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_AUDIT_PATH = join(tmpDir, 'audit.jsonl');
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = originalEnv;
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('applyBranchProtection', () => {
  const baseInput = {
    owner: 'acme',
    repo: 'widgets',
    branch: 'main',
  };

  it('happy path: drift → PUT called with merged rule, audit ok', async () => {
    const { octokit, calls } = makeFakeOctokit({
      protection: { enforce_admins: false, allow_deletions: true },
    });
    const rule: BranchProtectionRule = { enforce_admins: true };

    const result = await applyBranchProtection({
      ...baseInput,
      octokit,
      rule,
      dryRun: false,
    });

    expect(result.changed).toBe(true);
    expect(result.diff).toEqual([
      { field: 'enforce_admins', before: false, after: true },
    ]);
    // PUT was called.
    const put = calls.find((c) => c.route.startsWith('PUT '));
    expect(put).toBeDefined();
    // Merged rule preserves `allow_deletions`.
    expect(put?.params.enforce_admins).toBe(true);
    expect(put?.params.allow_deletions).toBe(true);
    expect(put?.params.owner).toBe('acme');

    const audit = readAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.tool).toBe('apply-branch-protection');
    expect(audit[0]?.result).toBe('ok');
    expect(audit[0]?.dryRun).toBe(false);
    expect(audit[0]?.repo).toBe('acme/widgets');
  });

  it('dry-run path: drift → no PUT call, after === null, audit dry-run', async () => {
    const { octokit, calls } = makeFakeOctokit({
      protection: { enforce_admins: false },
    });
    const rule: BranchProtectionRule = { enforce_admins: true };

    const result = await applyBranchProtection({
      ...baseInput,
      octokit,
      rule,
      dryRun: true,
    });

    expect(result.changed).toBe(true);
    expect(result.after).toBeNull();
    expect(calls.find((c) => c.route.startsWith('PUT '))).toBeUndefined();

    const audit = readAudit();
    expect(audit[0]?.result).toBe('dry-run');
    expect(audit[0]?.dryRun).toBe(true);
  });

  it('idempotent: no drift → no PUT, changed=false, after === before', async () => {
    const { octokit, calls } = makeFakeOctokit({
      protection: { enforce_admins: true },
    });
    const rule: BranchProtectionRule = { enforce_admins: true };

    const result = await applyBranchProtection({
      ...baseInput,
      octokit,
      rule,
      dryRun: false,
    });

    expect(result.changed).toBe(false);
    expect(result.diff).toEqual([]);
    expect(calls.find((c) => c.route.startsWith('PUT '))).toBeUndefined();
    expect(result.after).toEqual(result.before);

    const audit = readAudit();
    expect(audit[0]?.result).toBe('ok');
  });

  it('404 before path: PUT called with full target', async () => {
    const { octokit, calls } = makeFakeOctokit({ protection: null });
    const rule: BranchProtectionRule = {
      enforce_admins: true,
      required_linear_history: true,
    };

    const result = await applyBranchProtection({
      ...baseInput,
      octokit,
      rule,
      dryRun: false,
    });

    expect(result.before).toBeNull();
    expect(result.changed).toBe(true);
    const put = calls.find((c) => c.route.startsWith('PUT '));
    expect(put?.params.enforce_admins).toBe(true);
    expect(put?.params.required_linear_history).toBe(true);
  });

  it('error path: octokit PUT throws → wrapped error + audit error', async () => {
    const { octokit } = makeFakeOctokit({
      protection: { enforce_admins: false },
      putError: new Error('boom'),
    });
    const rule: BranchProtectionRule = { enforce_admins: true };

    await expect(
      applyBranchProtection({ ...baseInput, octokit, rule, dryRun: false }),
    ).rejects.toBeInstanceOf(GhBaselineError);

    const audit = readAudit();
    expect(audit[0]?.result).toBe('error');
    expect(audit[0]?.error).toContain('boom');
  });

  it('rejects empty rule with no fields set', async () => {
    const { octokit } = makeFakeOctokit({ protection: null });
    await expect(
      applyBranchProtection({
        ...baseInput,
        octokit,
        rule: {},
        dryRun: true,
      }),
    ).rejects.toThrow(/no fields set/);
  });

  it('rejects invalid owner/repo/branch via core/validate', async () => {
    const { octokit } = makeFakeOctokit({ protection: null });
    const rule: BranchProtectionRule = { enforce_admins: true };
    await expect(
      applyBranchProtection({
        ...baseInput,
        owner: 'bad owner!',
        octokit,
        rule,
        dryRun: true,
      }),
    ).rejects.toThrow(/owner/);
    await expect(
      applyBranchProtection({
        ...baseInput,
        branch: '..bad',
        octokit,
        rule,
        dryRun: true,
      }),
    ).rejects.toThrow(/branch/);
  });
});
