import type { Config } from './config.js';
import { AllowlistError } from './errors.js';
import { assertOwner, assertRepoSlug } from './validate.js';

/**
 * Throw `AllowlistError` if `repoSlug` (`owner/name`) is not allowed by `config`.
 *
 * Resolution order:
 *   1. `unsafeAllowAll: true` — anything is fine. (Also accepts the literal `*` anywhere.)
 *   2. `allowedOrgs` — `acme` matches every repo under `acme`.
 *      `acme/*` is also accepted (alias of `acme`).
 *   3. `allowedRepos` — exact `owner/name` match. `*` only honored when `unsafeAllowAll`.
 *
 * Validation: `repoSlug` must look like a real GitHub slug. Garbage strings throw the
 * usual validate.ts error rather than masquerading as a denial.
 */
export function checkAllowed(repoSlug: string, config: Config): void {
  assertRepoSlug(repoSlug);
  if (config.unsafeAllowAll) return;

  const [owner] = repoSlug.split('/', 1) as [string];

  for (const orgPattern of config.allowedOrgs) {
    const org = orgPattern.endsWith('/*') ? orgPattern.slice(0, -2) : orgPattern;
    if (org === '*') continue; // `*` requires unsafeAllowAll
    // Permissive: don't crash the whole call on a malformed entry, just skip it.
    try {
      assertOwner(org);
    } catch {
      continue;
    }
    if (org === owner) return;
  }

  for (const allowed of config.allowedRepos) {
    if (allowed === '*') continue; // `*` requires unsafeAllowAll
    if (allowed.endsWith('/*')) {
      const org = allowed.slice(0, -2);
      try {
        assertOwner(org);
      } catch {
        continue;
      }
      if (org === owner) return;
      continue;
    }
    try {
      assertRepoSlug(allowed);
    } catch {
      continue;
    }
    if (allowed === repoSlug) return;
  }

  throw new AllowlistError(repoSlug);
}

/**
 * true when the config has bypassed the allowlist via `unsafeAllowAll`. Surfaced
 * to users at MCP startup and in `gh_baseline_doctor` so an enabled bypass is
 * never silent.
 */
export function isUnsafeAllowAll(config: Config): boolean {
  return config.unsafeAllowAll === true;
}

/** non-throwing variant: returns true when `repoSlug` is allowed. */
export function isAllowed(repoSlug: string, config: Config): boolean {
  try {
    checkAllowed(repoSlug, config);
    return true;
  } catch {
    return false;
  }
}
