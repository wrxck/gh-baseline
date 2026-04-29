import { describe, expect, it } from 'vitest';

import { ossPublicProfile } from '../profiles/oss-public.js';

import { checkBranchProtection } from './branch-protection.js';
import { buildFakeOctokit, notFoundError, res } from './test-helpers.js';

const repo = 'acme/widgets';

const fullyMatchingProtection = {
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
};

describe('checkBranchProtection', () => {
  it('passes when branch protection matches the profile rule', async () => {
    const octokit = buildFakeOctokit({
      reposGetBranchProtection: async () => res(fullyMatchingProtection),
    });
    const result = await checkBranchProtection(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('pass');
  });

  it('fails when the branch is unprotected (404)', async () => {
    const octokit = buildFakeOctokit({
      reposGetBranchProtection: async () => {
        throw notFoundError();
      },
    });
    const result = await checkBranchProtection(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/drift/);
  });

  it('fails with field-level drift when status check contexts mismatch', async () => {
    const octokit = buildFakeOctokit({
      reposGetBranchProtection: async () =>
        res({
          ...fullyMatchingProtection,
          required_status_checks: { strict: true, contexts: ['something-else'] },
        }),
    });
    const result = await checkBranchProtection(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('fail');
    const details = result.details as {
      outcomes: Array<{ violations: Array<{ field: string }> }>;
    };
    const allFields = details.outcomes.flatMap((o) => o.violations.map((v) => v.field));
    expect(allFields).toContain('required_status_checks.contexts');
  });

  it('returns error status when octokit throws a non-404 error', async () => {
    const octokit = buildFakeOctokit({
      reposGetBranchProtection: async () => {
        throw new Error('boom');
      },
    });
    const result = await checkBranchProtection(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('error');
  });
});
