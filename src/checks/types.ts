// Read-only check result type. Every check function returns one of these.
// `details` is intentionally typed as `unknown` — checks shape it however
// makes sense for their domain, and downstream actors / formatters narrow.

import type { Octokit } from '@octokit/rest';

import type { Profile } from '../profiles/types.js';

export type CheckStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface CheckResult {
  /** Stable identifier, e.g. `branch-protection.main`. */
  id: string;
  status: CheckStatus;
  /** Single-line human summary. */
  summary: string;
  /** Structured violation data, consumed by actors and the JSON formatter. */
  details?: unknown;
  /** Optional hint for how to fix. */
  remediation?: string;
}

/** Signature every check module exports. */
export type CheckFn = (
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
) => Promise<CheckResult>;

/** Split `owner/name` into its parts. Validation is the caller's job. */
export function splitRepo(repoSlug: string): { owner: string; repo: string } {
  const idx = repoSlug.indexOf('/');
  if (idx === -1) return { owner: repoSlug, repo: '' };
  return { owner: repoSlug.slice(0, idx), repo: repoSlug.slice(idx + 1) };
}

/** Best-effort coercion of a thrown value to a human string. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
