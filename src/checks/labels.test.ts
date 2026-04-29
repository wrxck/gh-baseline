import { describe, expect, it } from 'vitest';

import { ossPublicProfile } from '../profiles/oss-public.js';

import { checkLabels } from './labels.js';
import { buildFakeOctokit, res } from './test-helpers.js';

const repo = 'acme/widgets';

const fullLabelSet = ossPublicProfile.labels.entries.map((e) => ({
  name: e.name,
  color: e.color,
  description: e.description ?? null,
}));

describe('checkLabels', () => {
  it('passes when superset profile is satisfied (extras allowed)', async () => {
    const octokit = buildFakeOctokit({
      issuesListLabelsForRepo: async () => res([...fullLabelSet, { name: 'extra', color: 'aabbcc', description: null }]),
    });
    const result = await checkLabels(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('pass');
  });

  it('fails when a required label is missing', async () => {
    const octokit = buildFakeOctokit({
      issuesListLabelsForRepo: async () => res(fullLabelSet.slice(1)),
    });
    const result = await checkLabels(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('fail');
    const details = result.details as { violations: Array<{ kind: string; name: string }> };
    expect(details.violations.find((v) => v.kind === 'missing')?.name).toBe(fullLabelSet[0]!.name);
  });

  it('returns error when octokit throws', async () => {
    const octokit = buildFakeOctokit({
      issuesListLabelsForRepo: async () => {
        throw new Error('boom');
      },
    });
    const result = await checkLabels(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('error');
  });

  it('skips when profile policy is unspecified', async () => {
    const profile = {
      ...ossPublicProfile,
      labels: { policy: 'unspecified' as const, entries: [] },
    };
    const octokit = buildFakeOctokit();
    const result = await checkLabels(octokit, repo, profile);
    expect(result.status).toBe('skip');
  });
});
