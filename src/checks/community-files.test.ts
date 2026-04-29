import { describe, expect, it } from 'vitest';

import { ossPublicProfile } from '../profiles/oss-public.js';

import { checkCommunityFiles } from './community-files.js';
import { buildFakeOctokit, notFoundError, res } from './test-helpers.js';

const repo = 'acme/widgets';

describe('checkCommunityFiles', () => {
  it('passes when README/CONTRIBUTING/CODE_OF_CONDUCT and SECURITY are present', async () => {
    const octokit = buildFakeOctokit({
      request: async (route) => {
        if (route.includes('/community/profile')) {
          return res({
            files: {
              readme: { url: 'https://x/r' },
              contributing: { url: 'https://x/c' },
              code_of_conduct: { url: 'https://x/coc' },
              pull_request_template: { url: 'https://x/p' },
              issue_template: { url: 'https://x/i' },
            },
          });
        }
        throw new Error('unexpected route ' + route);
      },
      reposGetContent: async ({ path }) => {
        if (path === 'SECURITY.md') return res({ name: 'SECURITY.md' });
        throw notFoundError();
      },
    });
    const result = await checkCommunityFiles(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('pass');
  });

  it('fails when SECURITY is missing under a profile that requires it', async () => {
    const octokit = buildFakeOctokit({
      request: async (route) => {
        if (route.includes('/community/profile')) {
          return res({
            files: {
              readme: { url: 'https://x/r' },
              contributing: { url: 'https://x/c' },
              code_of_conduct: { url: 'https://x/coc' },
            },
          });
        }
        throw new Error('unexpected route');
      },
      reposGetContent: async () => {
        throw notFoundError();
      },
    });
    const result = await checkCommunityFiles(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('fail');
    const details = result.details as { violations: Array<{ file: string }> };
    expect(details.violations.some((v) => v.file === 'securityPolicy')).toBe(true);
  });

  it('returns error status when the community endpoint throws', async () => {
    const octokit = buildFakeOctokit({
      request: async () => {
        throw new Error('explode');
      },
    });
    const result = await checkCommunityFiles(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('error');
  });
});
