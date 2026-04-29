// Branch protection check. For each branch in the profile, fetch
// `GET /repos/{owner}/{repo}/branches/{branch}/protection` and compare each
// declared field structurally. Drift surfaces as a violation entry naming
// the field, the wanted value, and the observed value.
//
// We only compare fields the profile actually declared — if the profile
// doesn't mention `required_signatures`, we don't read it. That keeps
// profiles minimal and lets sites add knobs incrementally.

import type { Octokit } from '@octokit/rest';

import type {
  BranchProtectionRule,
  Profile,
  RequiredPullRequestReviews,
  RequiredStatusChecks,
} from '../profiles/types.js';

import { errMessage, splitRepo, type CheckResult } from './types.js';

interface BranchViolation {
  branch: string;
  field: string;
  want: unknown;
  got: unknown;
}

interface BranchOutcome {
  branch: string;
  status: 'pass' | 'fail' | 'error' | 'unprotected';
  violations: BranchViolation[];
  error?: string;
}

function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function compareStatusChecks(
  want: RequiredStatusChecks | undefined,
  got: { strict?: boolean; contexts?: string[] } | null | undefined,
  out: BranchViolation[],
  branch: string,
): void {
  if (want === undefined) return;
  if (want === null) {
    if (got !== null && got !== undefined) {
      out.push({ branch, field: 'required_status_checks', want: null, got });
    }
    return;
  }
  if (got === null || got === undefined) {
    out.push({ branch, field: 'required_status_checks', want, got: null });
    return;
  }
  if (Boolean(got.strict) !== want.strict) {
    out.push({
      branch,
      field: 'required_status_checks.strict',
      want: want.strict,
      got: Boolean(got.strict),
    });
  }
  const gotContexts = Array.isArray(got.contexts) ? got.contexts : [];
  if (!arraysEqualUnordered(want.contexts, gotContexts)) {
    out.push({
      branch,
      field: 'required_status_checks.contexts',
      want: want.contexts,
      got: gotContexts,
    });
  }
}

function compareReviews(
  want: RequiredPullRequestReviews | undefined,
  got:
    | {
        required_approving_review_count?: number;
        dismiss_stale_reviews?: boolean;
        require_code_owner_reviews?: boolean;
        require_last_push_approval?: boolean;
      }
    | null
    | undefined,
  out: BranchViolation[],
  branch: string,
): void {
  if (want === undefined) return;
  if (want === null) {
    if (got !== null && got !== undefined) {
      out.push({ branch, field: 'required_pull_request_reviews', want: null, got });
    }
    return;
  }
  if (got === null || got === undefined) {
    out.push({ branch, field: 'required_pull_request_reviews', want, got: null });
    return;
  }
  const gotCount = got.required_approving_review_count ?? 0;
  if (gotCount !== want.required_approving_review_count) {
    out.push({
      branch,
      field: 'required_pull_request_reviews.required_approving_review_count',
      want: want.required_approving_review_count,
      got: gotCount,
    });
  }
  if (
    want.dismiss_stale_reviews !== undefined &&
    Boolean(got.dismiss_stale_reviews) !== want.dismiss_stale_reviews
  ) {
    out.push({
      branch,
      field: 'required_pull_request_reviews.dismiss_stale_reviews',
      want: want.dismiss_stale_reviews,
      got: Boolean(got.dismiss_stale_reviews),
    });
  }
  if (
    want.require_code_owner_reviews !== undefined &&
    Boolean(got.require_code_owner_reviews) !== want.require_code_owner_reviews
  ) {
    out.push({
      branch,
      field: 'required_pull_request_reviews.require_code_owner_reviews',
      want: want.require_code_owner_reviews,
      got: Boolean(got.require_code_owner_reviews),
    });
  }
  if (
    want.require_last_push_approval !== undefined &&
    Boolean(got.require_last_push_approval) !== want.require_last_push_approval
  ) {
    out.push({
      branch,
      field: 'required_pull_request_reviews.require_last_push_approval',
      want: want.require_last_push_approval,
      got: Boolean(got.require_last_push_approval),
    });
  }
}

function compareBoolField(
  fieldName: string,
  want: boolean | null | undefined,
  got: boolean | null | undefined,
  out: BranchViolation[],
  branch: string,
): void {
  if (want === undefined) return;
  const observed = got === undefined ? null : got;
  if (observed !== want) {
    out.push({ branch, field: fieldName, want, got: observed });
  }
}

async function checkOneBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  rule: BranchProtectionRule,
): Promise<BranchOutcome> {
  let protection: {
    required_status_checks?: { strict?: boolean; contexts?: string[] } | null;
    required_pull_request_reviews?: {
      required_approving_review_count?: number;
      dismiss_stale_reviews?: boolean;
      require_code_owner_reviews?: boolean;
      require_last_push_approval?: boolean;
    } | null;
    enforce_admins?: { enabled?: boolean } | boolean | null;
    required_signatures?: { enabled?: boolean } | boolean;
    required_linear_history?: { enabled?: boolean } | boolean;
    allow_force_pushes?: { enabled?: boolean } | boolean | null;
    allow_deletions?: { enabled?: boolean } | boolean;
    required_conversation_resolution?: { enabled?: boolean } | boolean;
    block_creations?: { enabled?: boolean } | boolean;
    restrictions?: { users?: unknown[]; teams?: unknown[]; apps?: unknown[] } | null;
  };
  try {
    const res = await octokit.repos.getBranchProtection({ owner, repo, branch });
    protection = res.data as typeof protection;
  } catch (err) {
    const message = errMessage(err);
    if (/Not Found|HttpError.*404|status.*404|Branch not protected/i.test(message)) {
      return {
        branch,
        status: 'unprotected',
        violations: [{ branch, field: '<protection>', want: rule, got: null }],
      };
    }
    return { branch, status: 'error', violations: [], error: message };
  }

  const violations: BranchViolation[] = [];
  compareStatusChecks(rule.required_status_checks, protection.required_status_checks, violations, branch);
  compareReviews(rule.required_pull_request_reviews, protection.required_pull_request_reviews, violations, branch);

  const enforceAdminsObserved =
    typeof protection.enforce_admins === 'object' && protection.enforce_admins !== null
      ? Boolean(protection.enforce_admins.enabled)
      : (protection.enforce_admins ?? null);
  compareBoolField('enforce_admins', rule.enforce_admins ?? undefined, enforceAdminsObserved, violations, branch);

  const requiredSignaturesObserved =
    typeof protection.required_signatures === 'object' && protection.required_signatures !== null
      ? Boolean(protection.required_signatures.enabled)
      : Boolean(protection.required_signatures);
  if (rule.required_signatures !== undefined) {
    compareBoolField('required_signatures', rule.required_signatures, requiredSignaturesObserved, violations, branch);
  }

  const linearHistoryObserved =
    typeof protection.required_linear_history === 'object' && protection.required_linear_history !== null
      ? Boolean(protection.required_linear_history.enabled)
      : Boolean(protection.required_linear_history);
  if (rule.required_linear_history !== undefined) {
    compareBoolField('required_linear_history', rule.required_linear_history, linearHistoryObserved, violations, branch);
  }

  const forcePushObserved =
    typeof protection.allow_force_pushes === 'object' && protection.allow_force_pushes !== null
      ? Boolean(protection.allow_force_pushes.enabled)
      : (protection.allow_force_pushes ?? null);
  if (rule.allow_force_pushes !== undefined && rule.allow_force_pushes !== null) {
    compareBoolField('allow_force_pushes', rule.allow_force_pushes, forcePushObserved, violations, branch);
  }

  const deletionsObserved =
    typeof protection.allow_deletions === 'object' && protection.allow_deletions !== null
      ? Boolean(protection.allow_deletions.enabled)
      : Boolean(protection.allow_deletions);
  if (rule.allow_deletions !== undefined) {
    compareBoolField('allow_deletions', rule.allow_deletions, deletionsObserved, violations, branch);
  }

  const convoObserved =
    typeof protection.required_conversation_resolution === 'object' &&
    protection.required_conversation_resolution !== null
      ? Boolean(protection.required_conversation_resolution.enabled)
      : Boolean(protection.required_conversation_resolution);
  if (rule.required_conversation_resolution !== undefined) {
    compareBoolField(
      'required_conversation_resolution',
      rule.required_conversation_resolution,
      convoObserved,
      violations,
      branch,
    );
  }

  if (rule.restrictions !== undefined) {
    if (rule.restrictions === null) {
      if (protection.restrictions !== null && protection.restrictions !== undefined) {
        violations.push({
          branch,
          field: 'restrictions',
          want: null,
          got: protection.restrictions,
        });
      }
    } else if (protection.restrictions === null || protection.restrictions === undefined) {
      violations.push({ branch, field: 'restrictions', want: rule.restrictions, got: null });
    }
  }

  return {
    branch,
    status: violations.length === 0 ? 'pass' : 'fail',
    violations,
  };
}

export async function checkBranchProtection(
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
): Promise<CheckResult> {
  const id = 'branch-protection';
  const { owner, repo } = splitRepo(repoSlug);
  const branches = Object.entries(profile.branchProtection.branches);
  if (branches.length === 0) {
    return { id, status: 'skip', summary: 'profile declares no protected branches' };
  }

  const outcomes: BranchOutcome[] = [];
  for (const [branch, rule] of branches) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(await checkOneBranch(octokit, owner, repo, branch, rule));
  }

  const errored = outcomes.filter((o) => o.status === 'error');
  if (errored.length > 0 && errored.length === outcomes.length) {
    return {
      id,
      status: 'error',
      summary: `branch protection: all ${outcomes.length} branch check(s) errored`,
      details: { outcomes },
    };
  }
  const allViolations = outcomes.flatMap((o) => o.violations);
  const failed = outcomes.filter((o) => o.status === 'fail' || o.status === 'unprotected');
  if (failed.length === 0 && errored.length === 0) {
    return {
      id,
      status: 'pass',
      summary: `branch protection matches profile on ${outcomes.length} branch(es)`,
      details: { outcomes },
    };
  }
  return {
    id,
    status: 'fail',
    summary: `branch protection: ${allViolations.length} drift(s) across ${failed.length} branch(es)`,
    details: { outcomes },
    remediation:
      'apply the branchProtection actor to align branch protection with the profile, or update the profile if the drift is intentional',
  };
}
