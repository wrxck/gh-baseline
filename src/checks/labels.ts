// Label check. Walks `GET /repos/{owner}/{repo}/labels` (paginated). For
// `exact` policy, both missing and extra labels are violations. For
// `superset`, only missing labels are violations. `unspecified` skips.

import type { Octokit } from '@octokit/rest';

import type { LabelEntry, Profile } from '../profiles/types.js';

import { errMessage, splitRepo, type CheckResult } from './types.js';

interface ObservedLabel {
  name: string;
  color: string;
  description: string | null;
}

interface LabelViolation {
  kind: 'missing' | 'extra' | 'color-mismatch' | 'description-mismatch';
  name: string;
  want?: { color?: string; description?: string };
  got?: { color?: string; description?: string | null };
}

function normaliseColor(value: string | undefined | null): string {
  return (value ?? '').toLowerCase();
}

export async function checkLabels(
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
): Promise<CheckResult> {
  const id = 'labels';
  if (profile.labels.policy === 'unspecified') {
    return { id, status: 'skip', summary: 'labels policy is unspecified' };
  }
  const { owner, repo } = splitRepo(repoSlug);

  let observed: ObservedLabel[];
  try {
    const all: ObservedLabel[] = [];
    let page = 1;
    while (page < 50) {
      // eslint-disable-next-line no-await-in-loop
      const res = await octokit.issues.listLabelsForRepo({ owner, repo, per_page: 100, page });
      const data = res.data as Array<{ name: string; color: string; description: string | null }>;
      for (const l of data) {
        all.push({ name: l.name, color: l.color, description: l.description });
      }
      if (data.length < 100) break;
      page += 1;
    }
    observed = all;
  } catch (err) {
    return {
      id,
      status: 'error',
      summary: `Failed to list labels for ${repoSlug}: ${errMessage(err)}`,
    };
  }

  const wantByName = new Map<string, LabelEntry>();
  for (const e of profile.labels.entries) wantByName.set(e.name, e);
  const gotByName = new Map<string, ObservedLabel>();
  for (const o of observed) gotByName.set(o.name, o);

  const violations: LabelViolation[] = [];
  for (const [name, want] of wantByName) {
    const got = gotByName.get(name);
    if (!got) {
      violations.push({
        kind: 'missing',
        name,
        want: { color: want.color, description: want.description ?? undefined },
      });
      continue;
    }
    if (normaliseColor(got.color) !== normaliseColor(want.color)) {
      violations.push({
        kind: 'color-mismatch',
        name,
        want: { color: want.color },
        got: { color: got.color },
      });
    }
    if (want.description !== undefined && (got.description ?? '') !== want.description) {
      violations.push({
        kind: 'description-mismatch',
        name,
        want: { description: want.description },
        got: { description: got.description },
      });
    }
  }
  if (profile.labels.policy === 'exact') {
    for (const got of observed) {
      if (!wantByName.has(got.name)) {
        violations.push({ kind: 'extra', name: got.name, got });
      }
    }
  }

  if (violations.length === 0) {
    return {
      id,
      status: 'pass',
      summary: `labels match profile (${profile.labels.policy})`,
      details: { policy: profile.labels.policy, observedCount: observed.length },
    };
  }
  return {
    id,
    status: 'fail',
    summary: `labels: ${violations.length} drift(s) (${profile.labels.policy})`,
    details: { policy: profile.labels.policy, observedCount: observed.length, violations },
    remediation:
      profile.labels.policy === 'exact'
        ? 'apply the labels actor to add missing labels and remove unexpected ones'
        : 'apply the labels actor to add the missing labels (extras are allowed under superset)',
  };
}
