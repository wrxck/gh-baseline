import { describe, expect, it } from 'vitest';

import { ossPublicProfile } from '../profiles/oss-public.js';

import { ALL_CHECKS, runChecks } from './index.js';
import { buildFakeOctokit, notFoundError, res } from './test-helpers.js';

const repo = 'acme/widgets';

describe('runChecks', () => {
  it('returns one CheckResult per check, in stable order', async () => {
    // Provide an octokit that errors on every method — runChecks should not
    // throw, every result should arrive (most as 'error' / 'fail').
    const octokit = buildFakeOctokit({
      reposGet: async () => {
        throw new Error('no repos');
      },
      reposGetBranchProtection: async () => {
        throw new Error('no protection');
      },
      issuesListLabelsForRepo: async () => {
        throw new Error('no labels');
      },
      reposGetContent: async () => {
        throw notFoundError();
      },
      request: async () => {
        throw new Error('no request');
      },
    });
    const results = await runChecks(octokit, repo, ossPublicProfile);
    expect(results.map((r) => r.id)).toEqual(ALL_CHECKS.map((c) => c.id));
    for (const r of results) {
      expect(['pass', 'fail', 'skip', 'error']).toContain(r.status);
    }
  });

  it('captures synchronous throws as error CheckResults', async () => {
    // Build an octokit that would survive Promise.allSettled by throwing
    // outside any awaited path. Because each check awaits its own request,
    // any throw becomes a rejected promise and lands in the settled array.
    const octokit = buildFakeOctokit();
    const results = await runChecks(octokit, repo, ossPublicProfile);
    // labels has policy=superset; every other check has no impl wired.
    // All non-skip checks must surface as 'error' (not throw).
    const errors = results.filter((r) => r.status === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes through fully-matching responses', async () => {
    const octokit = buildFakeOctokit({
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
        res(
          ossPublicProfile.labels.entries.map((e) => ({
            name: e.name,
            color: e.color,
            description: e.description ?? null,
          })),
        ),
      reposGetContent: async ({ path }) =>
        path === 'SECURITY.md' ? res({ name: 'SECURITY.md' }) : Promise.reject(notFoundError()),
      request: async (route) => {
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
        // dependabot / vuln endpoints — return empty success.
        return res({});
      },
    });
    const results = await runChecks(octokit, repo, ossPublicProfile);
    const fails = results.filter((r) => r.status === 'fail' || r.status === 'error');
    expect(fails.map((r) => r.id + ':' + r.summary)).toEqual([]);
  });
});
