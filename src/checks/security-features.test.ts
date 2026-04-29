import { describe, expect, it } from 'vitest';

import { ossPublicProfile } from '../profiles/oss-public.js';

import { checkSecurityFeatures } from './security-features.js';
import { buildFakeOctokit, notFoundError, res } from './test-helpers.js';

const repo = 'acme/widgets';

describe('checkSecurityFeatures', () => {
  it('passes when all features are enabled', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () =>
        res({
          security_and_analysis: {
            secret_scanning: { status: 'enabled' },
            secret_scanning_push_protection: { status: 'enabled' },
          },
        }),
      request: async () => res({}),
    });
    const result = await checkSecurityFeatures(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('pass');
  });

  it('fails when secret scanning is disabled', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () =>
        res({
          security_and_analysis: {
            secret_scanning: { status: 'disabled' },
            secret_scanning_push_protection: { status: 'enabled' },
          },
        }),
      request: async () => res({}),
    });
    const result = await checkSecurityFeatures(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('fail');
    const details = result.details as { violations: Array<{ feature: string }> };
    expect(details.violations.some((v) => v.feature === 'secretScanning')).toBe(true);
  });

  it('returns error status when repos.get throws', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () => {
        throw new Error('boom');
      },
    });
    const result = await checkSecurityFeatures(octokit, repo, ossPublicProfile);
    expect(result.status).toBe('error');
  });

  it('treats 404s on dependabot endpoints as disabled', async () => {
    const octokit = buildFakeOctokit({
      reposGet: async () =>
        res({
          security_and_analysis: {
            secret_scanning: { status: 'enabled' },
            secret_scanning_push_protection: { status: 'enabled' },
          },
        }),
      request: async () => {
        throw notFoundError();
      },
    });
    const result = await checkSecurityFeatures(octokit, repo, ossPublicProfile);
    // Dependabot endpoints all 404 -> disabled, profile wants enabled, so fail.
    expect(result.status).toBe('fail');
    const details = result.details as { violations: Array<{ feature: string; got: string }> };
    expect(details.violations.find((v) => v.feature === 'dependabotAlerts')?.got).toBe('disabled');
  });
});
