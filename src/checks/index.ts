// Scan orchestrator. Runs every check in parallel via Promise.allSettled so
// a single check that throws (e.g. a transient 500) doesn't take down the
// whole scan — it just produces a `status: 'error'` result.

import type { Octokit } from '@octokit/rest';

import type { Profile } from '../profiles/types.js';

import { checkBranchProtection } from './branch-protection.js';
import { checkCommunityFiles } from './community-files.js';
import { checkLabels } from './labels.js';
import { checkRepoMetadata } from './repo-metadata.js';
import { checkRepoSettings } from './repo-settings.js';
import { checkSecurityFeatures } from './security-features.js';
import { errMessage, type CheckFn, type CheckResult } from './types.js';

export const ALL_CHECKS: Array<{ id: string; fn: CheckFn }> = [
  { id: 'repo-metadata', fn: checkRepoMetadata },
  { id: 'community-files', fn: checkCommunityFiles },
  { id: 'branch-protection', fn: checkBranchProtection },
  { id: 'security-features', fn: checkSecurityFeatures },
  { id: 'repo-settings', fn: checkRepoSettings },
  { id: 'labels', fn: checkLabels },
];

/**
 * Run every check against the repo + profile in parallel. Individual check
 * failures (rejected promises) become a `status: 'error'` CheckResult — the
 * whole array is always returned in the same order as `ALL_CHECKS`.
 */
export async function runChecks(
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
): Promise<CheckResult[]> {
  const settled = await Promise.allSettled(
    ALL_CHECKS.map(({ fn }) => fn(octokit, repoSlug, profile)),
  );
  return settled.map((s, i) => {
    const meta = ALL_CHECKS[i]!;
    if (s.status === 'fulfilled') return s.value;
    return {
      id: meta.id,
      status: 'error',
      summary: `check ${meta.id} threw: ${errMessage(s.reason)}`,
    };
  });
}

export * from './types.js';
export { checkRepoMetadata } from './repo-metadata.js';
export { checkCommunityFiles } from './community-files.js';
export { checkBranchProtection } from './branch-protection.js';
export { checkSecurityFeatures } from './security-features.js';
export { checkRepoSettings } from './repo-settings.js';
export { checkLabels } from './labels.js';
