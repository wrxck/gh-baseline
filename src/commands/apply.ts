import { checkAllowed } from '../core/allowlist.js';
import { getToken } from '../core/auth.js';
import { loadConfig, type Config } from '../core/config.js';
import { GhBaselineError } from '../core/errors.js';
import { createOctokit } from '../core/octokit.js';
import { createRateLimiter } from '../core/ratelimit.js';
import { assertBranchName, assertRepoSlug } from '../core/validate.js';

import {
  applyBranchProtection,
  type ApplyBranchProtectionResult,
  type BranchProtectionRule,
} from '../actors/apply-branch-protection.js';
import { getProfile } from '../profiles/index.js';

import type { Octokit } from '@octokit/rest';

/**
 * Resolve a profile id to the branch-protection rule for the given branch
 * (default `main`). Throws via `getProfile` if the profile id is unknown,
 * and a `GhBaselineError` if the profile has no rule for the branch.
 *
 * The profile's `BranchProtectionRule` shape is structurally narrower than
 * the actor's local one (the actor mirrors GitHub's full PUT shape). The
 * cast is safe; tightening the profile schema to GitHub's full shape is a
 * v0.2.0 task.
 */
export function buildRuleFromProfile(
  profileId: string,
  branch: string = 'main',
): BranchProtectionRule {
  const profile = getProfile(profileId);
  const rule = profile.branchProtection.branches[branch];
  if (rule === undefined) {
    throw new GhBaselineError(
      `profile '${profileId}' has no branch-protection rule for branch '${branch}'`,
    );
  }
  return rule as BranchProtectionRule;
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

export interface ParsedApplyArgs {
  op: string;
  repo: string;
  profile?: string;
  branch: string;
  apply: boolean;
  json: boolean;
  strict: boolean;
}

export function parseApplyArgs(args: string[]): ParsedApplyArgs {
  // Expected shape: [<op>, <repo>, ...flags]
  const positional: string[] = [];
  let profile: string | undefined;
  let branch = 'main';
  let apply = false;
  let json = false;
  let strict = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--apply') {
      apply = true;
    } else if (a === '--json') {
      json = true;
    } else if (a === '--strict') {
      strict = true;
    } else if (a === '--profile') {
      const next = args[i + 1];
      if (next === undefined) throw new GhBaselineError('--profile requires a value');
      profile = next;
      i += 1;
    } else if (a?.startsWith('--profile=')) {
      profile = a.slice('--profile='.length);
    } else if (a === '--branch') {
      const next = args[i + 1];
      if (next === undefined) throw new GhBaselineError('--branch requires a value');
      branch = next;
      i += 1;
    } else if (a?.startsWith('--branch=')) {
      branch = a.slice('--branch='.length);
    } else if (a !== undefined && !a.startsWith('--')) {
      positional.push(a);
    } else {
      throw new GhBaselineError(`Unknown flag: ${String(a)}`);
    }
  }

  const [op, repo] = positional;
  if (!op) throw new GhBaselineError('apply: missing <op> (e.g. branch-protection)');
  if (!repo) throw new GhBaselineError('apply: missing <repo> (owner/name)');
  return {
    op,
    repo,
    ...(profile !== undefined ? { profile } : {}),
    branch,
    apply,
    json,
    strict,
  };
}

// ---------------------------------------------------------------------------
// Dependency injection seam (for tests + real CLI).
// ---------------------------------------------------------------------------

export interface ApplyDeps {
  loadConfig?: () => Config;
  buildOctokit?: (config: Config) => Promise<Octokit>;
  applyBranchProtection?: typeof applyBranchProtection;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

async function defaultBuildOctokit(config: Config): Promise<Octokit> {
  const tok = await getToken(config);
  return createOctokit(tok.token);
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatHumanSummary(
  parsed: ParsedApplyArgs,
  result: ApplyBranchProtectionResult,
): string {
  const lines: string[] = [];
  if (!result.changed) {
    lines.push(`no changes (${parsed.repo}@${parsed.branch} already conforms)`);
    return lines.join('\n') + '\n';
  }
  const verb = parsed.apply ? 'applied' : 'would apply';
  lines.push(
    `${verb} ${result.diff.length} field change${result.diff.length === 1 ? '' : 's'} on ${parsed.repo}@${parsed.branch}`,
  );
  for (const entry of result.diff) {
    lines.push(
      `  ${entry.field}: ${JSON.stringify(entry.before)} -> ${JSON.stringify(entry.after)}`,
    );
  }
  if (!parsed.apply) {
    lines.push('(dry-run; re-run with --apply to persist)');
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * `gh-baseline apply <op> <repo> [flags]` handler.
 *
 * Returns the `ApplyBranchProtectionResult` for callers (the MCP server reuses
 * the inner actor directly; the CLI uses this wrapper).
 */
export async function runApply(
  args: string[],
  deps: ApplyDeps = {},
): Promise<ApplyBranchProtectionResult> {
  const parsed = parseApplyArgs(args);
  if (parsed.op !== 'branch-protection') {
    throw new GhBaselineError(
      `apply: unknown op ${JSON.stringify(parsed.op)} (only "branch-protection" is supported in MVP)`,
    );
  }
  assertRepoSlug(parsed.repo);
  assertBranchName(parsed.branch);

  const config = (deps.loadConfig ?? loadConfig)();
  const profileId = parsed.profile ?? config.defaultProfile;
  const rule = buildRuleFromProfile(profileId);

  checkAllowed(parsed.repo, config);

  const octokit = await (deps.buildOctokit ?? defaultBuildOctokit)(config);

  // Mutating op — take a token even on dry-run, since GitHub's REST quota is
  // per-token-per-route and the GET still spends quota.
  const limiter = createRateLimiter({ perMinute: config.rateLimit.perMinute });
  await limiter.take();

  const [owner, repo] = parsed.repo.split('/', 2) as [string, string];
  const apply = deps.applyBranchProtection ?? applyBranchProtection;
  const result = await apply({
    octokit,
    owner,
    repo,
    branch: parsed.branch,
    rule,
    dryRun: !parsed.apply,
  });

  const stdout = deps.stdout ?? ((line: string) => process.stdout.write(line));
  if (parsed.json) {
    stdout(JSON.stringify(result, null, 2) + '\n');
  } else {
    stdout(formatHumanSummary(parsed, result));
  }

  // `--strict` semantics for CI: a dry-run that would change something is
  // treated as a failure. With `--apply` it's never a failure.
  if (parsed.strict && result.changed && !parsed.apply) {
    throw new GhBaselineError(
      `strict mode: ${parsed.repo}@${parsed.branch} would change ${result.diff.length} field(s)`,
    );
  }

  return result;
}
