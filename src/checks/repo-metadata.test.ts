import { describe, expect, it } from 'vitest';

import { ossPublicProfile } from '../profiles/oss-public.js';

import { checkRepoMetadata } from './repo-metadata.js';
import { buildFakeOctokit, res } from './test-helpers.js';

const repo = 'acme/widgets';

describe('checkRepoMetadata', () => {
  it('passes when description, topics, and license match the profile', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () =>
        res({
          description: 'A widget',
          homepage: 'https://example.com',
          topics: ['cli', 'security', 'github'],
          license: { spdx_id: 'MIT' },
        }),
    });
    const result = await checkRepoMetadata(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('pass');
  });

  it('fails when description is missing and license is not in allowed set', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () =>
        res({
          description: '',
          homepage: null,
          topics: ['cli', 'security', 'github'],
          license: { spdx_id: 'GPL-3.0' },
        }),
    });
    const result = await checkRepoMetadata(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('fail');
    const details = result.details as { violations: Array<{ field: string }> };
    const fields = details.violations.map((v) => v.field);
    expect(fields).toContain('description');
    expect(fields).toContain('license');
  });

  it('returns error status when octokit throws', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () => {
        throw new Error('boom');
      },
    });
    const result = await checkRepoMetadata(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('error');
    expect(result.summary).toContain('boom');
  });
});
