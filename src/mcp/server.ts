import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Octokit } from '@octokit/rest';
import { z } from 'zod';

import {
  applyBranchProtection,
  type ApplyBranchProtectionResult,
  type BranchProtectionRule,
} from '../actors/apply-branch-protection.js';
import { buildRuleFromProfile } from '../commands/apply.js';
import { checkAllowed } from '../core/allowlist.js';
import { getToken } from '../core/auth.js';
import { loadConfig, type Config } from '../core/config.js';
import { GhBaselineError } from '../core/errors.js';
import { createOctokit } from '../core/octokit.js';
import { createRateLimiter } from '../core/ratelimit.js';
import { assertBranchName, assertRepoSlug } from '../core/validate.js';

// ---------------------------------------------------------------------------
// DI seam — swappable in tests so we can register tools and exercise their
// schemas without any real network or filesystem touch.
// ---------------------------------------------------------------------------

export interface RegisterToolsDeps {
  loadConfig?: () => Config;
  buildOctokit?: (config: Config) => Promise<Octokit>;
  applyBranchProtection?: typeof applyBranchProtection;
  buildRuleFromProfile?: (profileId: string) => BranchProtectionRule;
}

async function defaultBuildOctokit(config: Config): Promise<Octokit> {
  const tok = await getToken(config);
  return createOctokit(tok.token);
}

// Zod schema for the shared input shape. Keep it local — these are the MCP
// tool's input contracts, not part of the public API.
const repoSchema = z
  .string()
  .min(1)
  .superRefine((v, ctx) => {
    try {
      assertRepoSlug(v);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

const branchSchema = z
  .string()
  .min(1)
  .superRefine((v, ctx) => {
    try {
      assertBranchName(v);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

interface RunToolArgs {
  repo: string;
  branch: string;
  profile?: string;
  dryRun: boolean;
}

async function executeApplyBranchProtection(
  args: RunToolArgs,
  deps: RegisterToolsDeps,
): Promise<ApplyBranchProtectionResult> {
  const config = (deps.loadConfig ?? loadConfig)();
  checkAllowed(args.repo, config);
  const profileId = args.profile ?? config.defaultProfile;
  const rule = (deps.buildRuleFromProfile ?? buildRuleFromProfile)(profileId);
  const octokit = await (deps.buildOctokit ?? defaultBuildOctokit)(config);

  const limiter = createRateLimiter({ perMinute: config.rateLimit.perMinute });
  await limiter.take();

  const [owner, repo] = args.repo.split('/', 2) as [string, string];
  const apply = deps.applyBranchProtection ?? applyBranchProtection;
  return apply({
    octokit,
    owner,
    repo,
    branch: args.branch,
    rule,
    dryRun: args.dryRun,
  });
}

/**
 * Register the apply/diff branch-protection tools on `server`. Exported so
 * tests can register against a server they own without spinning up stdio.
 */
export function registerBranchProtectionTools(
  server: McpServer,
  deps: RegisterToolsDeps = {},
): void {
  server.registerTool(
    'gh_baseline_apply_branch_protection',
    {
      description:
        'Apply (or dry-run) branch protection on a repo. Default dryRun=true; pass dryRun:false to actually persist.',
      inputSchema: {
        repo: repoSchema,
        branch: branchSchema,
        profile: z.string().min(1).optional(),
        dryRun: z.boolean().default(true),
      },
    },
    async (args) => {
      try {
        const result = await executeApplyBranchProtection(
          {
            repo: args.repo,
            branch: args.branch,
            ...(args.profile !== undefined ? { profile: args.profile } : {}),
            dryRun: args.dryRun,
          },
          deps,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    },
  );

  server.registerTool(
    'gh_baseline_diff_branch_protection',
    {
      description:
        'Show the structural diff between current branch protection and the profile target. Always dry-run.',
      inputSchema: {
        repo: repoSchema,
        branch: branchSchema,
        profile: z.string().min(1).optional(),
      },
    },
    async (args) => {
      try {
        const result = await executeApplyBranchProtection(
          {
            repo: args.repo,
            branch: args.branch,
            ...(args.profile !== undefined ? { profile: args.profile } : {}),
            dryRun: true,
          },
          deps,
        );
        // Strip `after` per spec — diff tool returns the diff + before only.
        const diffOnly = {
          changed: result.changed,
          diff: result.diff,
          before: result.before,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(diffOnly) }],
          structuredContent: diffOnly as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    },
  );
}

export async function startMcpServer(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

  const server = new McpServer({
    name: 'gh-baseline',
    version: pkg.version,
  });

  // Tools are registered by Agent D in commands/ and actors/. The placeholder
  // below documents the contract: scan/diff/apply, all with dryRun defaults.
  registerBranchProtectionTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Re-export for callers that want to compose this in their own server.
export { GhBaselineError };
