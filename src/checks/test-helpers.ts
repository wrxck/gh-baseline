// Test-only helpers. NOT exported from the package — vitest just imports
// them from sibling .test.ts files. Builds a fake Octokit with the methods
// our checks actually use, so tests can drive deterministic responses.

import type { Octokit } from '@octokit/rest';

export interface FakeOctokitImpls {
  reposGet?: (args: { owner: string; repo: string }) => Promise<unknown>;
  reposGetContent?: (args: { owner: string; repo: string; path: string }) => Promise<unknown>;
  reposGetBranchProtection?: (args: { owner: string; repo: string; branch: string }) => Promise<unknown>;
  issuesListLabelsForRepo?: (args: {
    owner: string;
    repo: string;
    per_page?: number;
    page?: number;
  }) => Promise<unknown>;
  /** Generic request handler. The first argument may be a verb+url or an options object. */
  request?: (route: string, params: Record<string, unknown>) => Promise<unknown>;
}

const notImplemented = (name: string) => async () => {
  throw new Error(`fake-octokit: ${name} not implemented for this test`);
};

/**
 * Build a partial Octokit mock the checks layer can call. The cast at the
 * bottom is intentional — we only stub the methods used by checks, not the
 * full surface.
 */
export function buildFakeOctokit(impls: FakeOctokitImpls = {}): Octokit {
  const fake = {
    repos: {
      get: impls.reposGet ?? notImplemented('repos.get'),
      getContent: impls.reposGetContent ?? notImplemented('repos.getContent'),
      getBranchProtection: impls.reposGetBranchProtection ?? notImplemented('repos.getBranchProtection'),
    },
    issues: {
      listLabelsForRepo: impls.issuesListLabelsForRepo ?? notImplemented('issues.listLabelsForRepo'),
    },
    request: impls.request ?? notImplemented('request'),
  };
  return fake as unknown as Octokit;
}

/** Wrap a value as `{ data: value }`, matching the Octokit response envelope. */
export function res<T>(data: T): { data: T } {
  return { data };
}

/** Build an error that matches the `Not Found` heuristic the checks look for. */
export function notFoundError(): Error {
  const err = new Error('Not Found') as Error & { status?: number };
  err.status = 404;
  return err;
}
