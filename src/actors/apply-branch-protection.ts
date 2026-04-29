import type { Octokit } from '@octokit/rest';

import { auditLog } from '../core/audit.js';
import { GhBaselineError } from '../core/errors.js';
import { assertBranchName, assertOwner, assertRepoName } from '../core/validate.js';

// ---------------------------------------------------------------------------
// Types
//
// TODO(profile-integration): once Agent B's `src/profiles/types.ts` lands and
// exports `BranchProtectionRule`, replace this local interface with an import
// from there. The shape is intentionally identical to GitHub's
// `PUT /repos/{owner}/{repo}/branches/{branch}/protection` request body so the
// swap is mechanical (the field names match the API exactly).
// ---------------------------------------------------------------------------

export interface BranchProtectionRequiredPullRequestReviews {
  required_approving_review_count?: number;
  dismiss_stale_reviews?: boolean;
  require_code_owner_reviews?: boolean;
  require_last_push_approval?: boolean;
}

export interface BranchProtectionRequiredStatusChecksCheck {
  context: string;
  app_id?: number;
}

export interface BranchProtectionRequiredStatusChecks {
  strict?: boolean;
  /** Legacy form. GitHub still accepts it; `checks` is preferred. */
  contexts?: string[];
  checks?: BranchProtectionRequiredStatusChecksCheck[];
}

export interface BranchProtectionRule {
  required_pull_request_reviews?: BranchProtectionRequiredPullRequestReviews | null;
  required_status_checks?: BranchProtectionRequiredStatusChecks | null;
  enforce_admins?: boolean;
  required_signatures?: boolean;
  required_linear_history?: boolean;
  allow_force_pushes?: boolean;
  allow_deletions?: boolean;
  required_conversation_resolution?: boolean;
  block_creations?: boolean;
  lock_branch?: boolean;
  // restrictions intentionally omitted from MVP.
}

/** One field-level diff entry. `before`/`after` are the structural values. */
export interface ProtectionDiffEntry {
  field: keyof BranchProtectionRule;
  before: unknown;
  after: unknown;
}

export type ProtectionDiff = ProtectionDiffEntry[];

export interface ApplyBranchProtectionInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  rule: BranchProtectionRule;
  dryRun: boolean;
}

export interface ApplyBranchProtectionResult {
  changed: boolean;
  diff: ProtectionDiff;
  before: BranchProtectionRule | null;
  /** `null` when `dryRun === true` AND `changed === true`. */
  after: BranchProtectionRule | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const RULE_FIELDS: ReadonlyArray<keyof BranchProtectionRule> = [
  'required_pull_request_reviews',
  'required_status_checks',
  'enforce_admins',
  'required_signatures',
  'required_linear_history',
  'allow_force_pushes',
  'allow_deletions',
  'required_conversation_resolution',
  'block_creations',
  'lock_branch',
];

/**
 * Stable structural equality — works for the JSON-shaped values we hold in
 * BranchProtectionRule (booleans, numbers, strings, arrays, plain objects,
 * null/undefined). Sorts object keys before comparing so `{a:1,b:2}` equals
 * `{b:2,a:1}`. Arrays are compared positionally (order matters), which matches
 * GitHub semantics for `contexts` / `checks`.
 */
function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!structurallyEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  for (const k of aKeys) {
    if (!structurallyEqual(aObj[k], bObj[k])) return false;
  }
  return true;
}

/**
 * Compute the structural diff between `before` and `target`.
 *
 * - We only inspect fields that the target *declares* (present as own
 *   property, regardless of value — including `null`/`undefined`/`false`).
 *   Existing fields the profile doesn't care about are preserved.
 * - When `before === null` (no protection at all), every declared target
 *   field shows up as a diff entry with `before: undefined`.
 */
export function computeProtectionDiff(
  before: BranchProtectionRule | null,
  target: BranchProtectionRule,
): ProtectionDiff {
  const diff: ProtectionDiff = [];
  for (const field of RULE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(target, field)) continue;
    const targetVal = target[field];
    const beforeVal = before === null ? undefined : before[field];
    if (!structurallyEqual(beforeVal, targetVal)) {
      diff.push({ field, before: beforeVal, after: targetVal });
    }
  }
  return diff;
}

/**
 * Merge `target` over `before`, preserving any `before` fields the target
 * doesn't declare. Used to build the body for the `PUT` so we don't blow away
 * settings the profile is silent about.
 */
function mergeRule(
  before: BranchProtectionRule | null,
  target: BranchProtectionRule,
): BranchProtectionRule {
  const merged: Record<string, unknown> = {};
  if (before !== null) {
    for (const field of RULE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(before, field)) {
        merged[field] = before[field];
      }
    }
  }
  for (const field of RULE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(target, field)) {
      merged[field] = target[field];
    }
  }
  return merged as BranchProtectionRule;
}

function ruleIsEmpty(rule: BranchProtectionRule): boolean {
  for (const field of RULE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rule, field)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GitHub I/O
// ---------------------------------------------------------------------------

interface OctokitErrorLike {
  status?: number;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as OctokitErrorLike).status === 404
  );
}

/**
 * Read the current branch protection. Returns `null` for 404 (branch exists
 * with no protection, or branch missing — caller can't distinguish via this
 * endpoint, and the subsequent PUT will fail loudly if the branch truly does
 * not exist).
 */
async function readCurrentProtection(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<BranchProtectionRule | null> {
  try {
    const res = await octokit.request(
      'GET /repos/{owner}/{repo}/branches/{branch}/protection',
      { owner, repo, branch },
    );
    return normalizeProtectionResponse(res.data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * GitHub's GET response is shaped slightly differently from the PUT body:
 * each scalar field comes wrapped as `{ enabled: boolean }`. Translate it
 * into the canonical PUT-shaped rule so diffs are apples-to-apples.
 */
function normalizeProtectionResponse(raw: unknown): BranchProtectionRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: BranchProtectionRule = {};

  if (r.required_pull_request_reviews !== undefined) {
    const v = r.required_pull_request_reviews as
      | Record<string, unknown>
      | null
      | undefined;
    if (v === null) {
      out.required_pull_request_reviews = null;
    } else if (v) {
      const review: BranchProtectionRequiredPullRequestReviews = {};
      if (typeof v.required_approving_review_count === 'number') {
        review.required_approving_review_count = v.required_approving_review_count;
      }
      if (typeof v.dismiss_stale_reviews === 'boolean') {
        review.dismiss_stale_reviews = v.dismiss_stale_reviews;
      }
      if (typeof v.require_code_owner_reviews === 'boolean') {
        review.require_code_owner_reviews = v.require_code_owner_reviews;
      }
      if (typeof v.require_last_push_approval === 'boolean') {
        review.require_last_push_approval = v.require_last_push_approval;
      }
      out.required_pull_request_reviews = review;
    }
  }

  if (r.required_status_checks !== undefined) {
    const v = r.required_status_checks as Record<string, unknown> | null | undefined;
    if (v === null) {
      out.required_status_checks = null;
    } else if (v) {
      const checks: BranchProtectionRequiredStatusChecks = {};
      if (typeof v.strict === 'boolean') checks.strict = v.strict;
      if (Array.isArray(v.contexts)) {
        checks.contexts = (v.contexts as unknown[]).filter(
          (c): c is string => typeof c === 'string',
        );
      }
      if (Array.isArray(v.checks)) {
        const list: BranchProtectionRequiredStatusChecksCheck[] = [];
        for (const c of v.checks as unknown[]) {
          if (typeof c === 'object' && c !== null) {
            const co = c as Record<string, unknown>;
            if (typeof co.context === 'string') {
              const entry: BranchProtectionRequiredStatusChecksCheck = {
                context: co.context,
              };
              if (typeof co.app_id === 'number') entry.app_id = co.app_id;
              list.push(entry);
            }
          }
        }
        checks.checks = list;
      }
      out.required_status_checks = checks;
    }
  }

  // The wrapped { enabled: boolean } scalar fields.
  for (const field of [
    'enforce_admins',
    'required_signatures',
    'required_linear_history',
    'allow_force_pushes',
    'allow_deletions',
    'required_conversation_resolution',
    'block_creations',
    'lock_branch',
  ] as const) {
    const v = r[field];
    if (typeof v === 'boolean') {
      out[field] = v;
    } else if (typeof v === 'object' && v !== null) {
      const enabled = (v as Record<string, unknown>).enabled;
      if (typeof enabled === 'boolean') out[field] = enabled;
    }
  }

  return out;
}

/**
 * Apply (or dry-run) a branch protection rule.
 *
 * - Validates inputs against `core/validate`.
 * - Reads current protection; computes a structural diff against `target`.
 * - Empty diff → no-op (`changed: false`), idempotent.
 * - `dryRun === true` → reports the diff but does not write.
 * - Otherwise → PUTs a *merged* rule (target over before) so fields the
 *   profile doesn't care about are preserved.
 *
 * Always emits one `auditLog` entry, including on error (`result: 'error'`).
 */
export async function applyBranchProtection(
  input: ApplyBranchProtectionInput,
): Promise<ApplyBranchProtectionResult> {
  const { octokit, owner, repo, branch, rule, dryRun } = input;
  assertOwner(owner);
  assertRepoName(repo);
  assertBranchName(branch);

  if (ruleIsEmpty(rule)) {
    throw new GhBaselineError(
      'applyBranchProtection: rule has no fields set; refusing to send an empty protection update',
    );
  }

  const repoSlug = `${owner}/${repo}`;

  try {
    const before = await readCurrentProtection(octokit, owner, repo, branch);
    const diff = computeProtectionDiff(before, rule);

    if (diff.length === 0) {
      await auditLog({
        tool: 'apply-branch-protection',
        repo: repoSlug,
        args: { branch, rule },
        result: 'ok',
        dryRun,
      });
      return { changed: false, diff: [], before, after: before };
    }

    if (dryRun) {
      await auditLog({
        tool: 'apply-branch-protection',
        repo: repoSlug,
        args: { branch, rule },
        result: 'dry-run',
        dryRun: true,
      });
      return { changed: true, diff, before, after: null };
    }

    const merged = mergeRule(before, rule);
    // Octokit's typed PUT requires `restrictions` (and several other fields)
    // to be on the request body even though GitHub accepts them as optional
    // on the wire. Route the call through `genericRequest` so we can send
    // exactly the API-faithful body without satisfying every required-prop on
    // the legacy typed overload.
    type GenericRequest = (route: string, params: Record<string, unknown>) => Promise<unknown>;
    const genericRequest = octokit.request as unknown as GenericRequest;
    await genericRequest('PUT /repos/{owner}/{repo}/branches/{branch}/protection', {
      owner,
      repo,
      branch,
      ...merged,
    });

    await auditLog({
      tool: 'apply-branch-protection',
      repo: repoSlug,
      args: { branch, rule },
      result: 'ok',
      dryRun: false,
    });

    return { changed: true, diff, before, after: merged };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await auditLog({
      tool: 'apply-branch-protection',
      repo: repoSlug,
      args: { branch, rule },
      result: 'error',
      error: message,
      dryRun,
    });
    if (err instanceof GhBaselineError) throw err;
    throw new GhBaselineError(`apply-branch-protection failed: ${message}`);
  }
}
