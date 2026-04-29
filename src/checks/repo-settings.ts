// Repo settings check. Compares allow_*_merge / allow_auto_merge /
// delete_branch_on_merge / default_branch against profile.repoSettings.
// Only fields the profile actually declared are compared.

import type { Octokit } from '@octokit/rest';

import type { Profile } from '../profiles/types.js';

import { errMessage, splitRepo, type CheckResult } from './types.js';

interface SettingsSnapshot {
  allowSquashMerge: boolean | null;
  allowMergeCommit: boolean | null;
  allowRebaseMerge: boolean | null;
  allowAutoMerge: boolean | null;
  deleteBranchOnMerge: boolean | null;
  defaultBranch: string | null;
}

interface SettingViolation {
  field: keyof SettingsSnapshot;
  want: boolean | string;
  got: boolean | string | null;
}

export async function checkRepoSettings(
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
): Promise<CheckResult> {
  const id = 'repo-settings';
  const { owner, repo } = splitRepo(repoSlug);

  let snapshot: SettingsSnapshot;
  try {
    const res = await octokit.repos.get({ owner, repo });
    const data = res.data as {
      allow_squash_merge?: boolean;
      allow_merge_commit?: boolean;
      allow_rebase_merge?: boolean;
      allow_auto_merge?: boolean;
      delete_branch_on_merge?: boolean;
      default_branch?: string;
    };
    snapshot = {
      allowSquashMerge: data.allow_squash_merge ?? null,
      allowMergeCommit: data.allow_merge_commit ?? null,
      allowRebaseMerge: data.allow_rebase_merge ?? null,
      allowAutoMerge: data.allow_auto_merge ?? null,
      deleteBranchOnMerge: data.delete_branch_on_merge ?? null,
      defaultBranch: data.default_branch ?? null,
    };
  } catch (err) {
    return {
      id,
      status: 'error',
      summary: `Failed to fetch repo settings for ${repoSlug}: ${errMessage(err)}`,
    };
  }

  const want = profile.repoSettings;
  const violations: SettingViolation[] = [];

  function compareBool(field: keyof SettingsSnapshot, w: boolean | undefined): void {
    if (w === undefined) return;
    const got = snapshot[field];
    if (typeof got !== 'boolean' || got !== w) {
      violations.push({ field, want: w, got });
    }
  }

  compareBool('allowSquashMerge', want.allowSquashMerge);
  compareBool('allowMergeCommit', want.allowMergeCommit);
  compareBool('allowRebaseMerge', want.allowRebaseMerge);
  compareBool('allowAutoMerge', want.allowAutoMerge);
  compareBool('deleteBranchOnMerge', want.deleteBranchOnMerge);
  if (want.defaultBranch !== undefined) {
    if (snapshot.defaultBranch !== want.defaultBranch) {
      violations.push({
        field: 'defaultBranch',
        want: want.defaultBranch,
        got: snapshot.defaultBranch,
      });
    }
  }

  if (violations.length === 0) {
    return {
      id,
      status: 'pass',
      summary: 'repo settings match profile',
      details: { snapshot },
    };
  }
  return {
    id,
    status: 'fail',
    summary: `repo settings: ${violations.length} drift(s)`,
    details: { snapshot, violations },
    remediation:
      'apply the repo-settings actor to align merge / default-branch settings with the profile',
  };
}
