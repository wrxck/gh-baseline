import { describe, expect, it } from 'vitest';

import { ossPublicProfile } from '../profiles/oss-public.js';

import { checkRepoSettings } from './repo-settings.js';
import { buildFakeOctokit, res } from './test-helpers.js';

const repo = 'acme/widgets';

describe('checkRepoSettings', () => {
  it('passes when settings match', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () =>
        res({
          allow_squash_merge: true,
          allow_merge_commit: false,
          allow_rebase_merge: false,
          allow_auto_merge: true,
          delete_branch_on_merge: true,
          default_branch: 'main',
        }),
    });
    const result = await checkRepoSettings(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('pass');
  });

  it('fails when allow_merge_commit is true but profile wants false', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () =>
        res({
          allow_squash_merge: true,
          allow_merge_commit: true,
          allow_rebase_merge: false,
          allow_auto_merge: true,
          delete_branch_on_merge: true,
          default_branch: 'main',
        }),
    });
    const result = await checkRepoSettings(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('fail');
    const details = result.details as { violations: Array<{ field: string }> };
    expect(details.violations.some((v) => v.field === 'allowMergeCommit')).toBe(true);
  });

  it('returns error when octokit throws', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () => {
        throw new Error('nope');
      },
    });
    const result = await checkRepoSettings(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('error');
  });
});
