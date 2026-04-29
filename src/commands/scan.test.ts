import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFakeOctokit, notFoundError, res } from '../checks/test-helpers.js';
import { defaultConfig, type Config } from '../core/config.js';

import { scanCommand, formatHumanReport } from './scan.js';

let tmp: string;
let prevAuditEnv: string | undefined;

function fakeConfig(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig(), ...overrides };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-scan-'));
  prevAuditEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_AUDIT_PATH = join(tmp, 'audit.jsonl');
});

afterEach(() => {
  if (prevAuditEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = prevAuditEnv;
  rmSync(tmp, { recursive: true, force: true });
});

const fullyMatchingResponses = {
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
  issuesListLabelsForRepo: async () =>
    res([
      { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
      { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
      { name: 'documentation', color: '0075ca', description: 'Improvements or additions to documentation' },
      { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' },
      { name: 'help wanted', color: '008672', description: 'Extra attention is needed' },
      { name: 'question', color: 'd876e3', description: 'Further information is requested' },
      { name: 'security', color: 'ee0701', description: 'Security-related issue' },
      { name: 'breaking', color: 'ff0000', description: 'Breaking change' },
      { name: 'dependencies', color: '0366d6', description: 'Pull requests that update a dependency file' },
    ]),
  reposGetContent: async ({ path }: { path: string }) =>
    path === 'SECURITY.md' ? res({ name: 'SECURITY.md' }) : Promise.reject(notFoundError()),
  request: async (route: string) => {
    if (route.includes('/community/profile')) {
      return res({
        files: {
          readme: { url: 'x' },
          contributing: { url: 'x' },
          code_of_conduct: { url: 'x' },
          pull_request_template: { url: 'x' },
          issue_template: { url: 'x' },
        },
      });
    }
    return res({});
  },
};

describe('scanCommand', () => {
  it('runs every check and emits JSON when --json is set', async () => {
    const octokit = buildFakeOctokit(fullyMatchingResponses);
    let captured = '';
    await scanCommand(['acme/widgets', '--json'], {
      octokit,
      config: fakeConfig({ unsafeAllowAll: true }),
      stdout: (c) => {
        captured += c;
      },
      stderr: () => undefined,
    });
    const parsed = JSON.parse(captured) as Array<{ repo: string; results: Array<{ id: string; status: string }> }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.repo).toBe('acme/widgets');
    expect(parsed[0]!.results.every((r) => r.status === 'pass' || r.status === 'skip')).toBe(true);
  });

  it('produces a human-readable summary by default', async () => {
    const octokit = buildFakeOctokit(fullyMatchingResponses);
    let captured = '';
    await scanCommand(['acme/widgets'], {
      octokit,
      config: fakeConfig({ unsafeAllowAll: true }),
      stdout: (c) => {
        captured += c;
      },
      stderr: () => undefined,
    });
    expect(captured).toMatch(/repo: acme\/widgets/);
    expect(captured).toMatch(/total: \d+ pass/);
  });

  it('throws on unknown flags', async () => {
    const octokit = buildFakeOctokit();
    await expect(
      scanCommand(['acme/widgets', '--bogus'], {
        octokit,
        config: fakeConfig({ unsafeAllowAll: true }),
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    ).rejects.toThrow(/Unknown flag/);
  });

  it('errors when neither <repo> nor --all is provided', async () => {
    await expect(
      scanCommand([], {
        octokit: buildFakeOctokit(),
        config: fakeConfig({ unsafeAllowAll: true }),
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    ).rejects.toThrow(/either <repo> or --all/);
  });

  it('skips repos that fail the allowlist and continues', async () => {
    const octokit = buildFakeOctokit(fullyMatchingResponses);
    let stdout = '';
    let stderr = '';
    await scanCommand(['acme/widgets'], {
      octokit,
      config: fakeConfig({ allowedRepos: ['only/this-one'] }),
      stdout: (c) => {
        stdout += c;
      },
      stderr: (c) => {
        stderr += c;
      },
    });
    expect(stderr).toMatch(/allowlist|skipping/);
    expect(stdout).toMatch(/total: 0 pass/);
  });
});

describe('formatHumanReport', () => {
  it('totals pass/fail/skip/error counts', () => {
    const out = formatHumanReport([
      {
        repo: 'a/b',
        profile: 'oss-public',
        results: [
          { id: 'x', status: 'pass', summary: 'ok' },
          { id: 'y', status: 'fail', summary: 'bad' },
          { id: 'z', status: 'skip', summary: 'skipped' },
          { id: 'w', status: 'error', summary: 'oops' },
        ],
      },
    ]);
    expect(out).toMatch(/total: 1 pass, 1 fail, 1 skip, 1 error/);
  });
});
