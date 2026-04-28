import { describe, expect, it } from 'vitest';

import { createOctokit, readPackageVersion } from './octokit.js';

describe('readPackageVersion', () => {
  it('returns a non-empty version string', () => {
    const v = readPackageVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});

describe('createOctokit', () => {
  it('returns an Octokit instance with default gh-baseline user-agent', () => {
    const o = createOctokit('ghs_test_token');
    expect(o).toBeDefined();
    // The Octokit instance carries its constructor options via request.endpoint.DEFAULTS.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults = (o as any).request?.endpoint?.DEFAULTS as { headers: Record<string, string> };
    expect(defaults.headers['user-agent']).toMatch(/^gh-baseline\//);
  });

  it('respects userAgent override', () => {
    const o = createOctokit('ghs_test_token', { userAgent: 'gh-baseline-test/9.9.9' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults = (o as any).request?.endpoint?.DEFAULTS as { headers: Record<string, string> };
    expect(defaults.headers['user-agent']).toContain('gh-baseline-test/9.9.9');
  });

  it('respects baseUrl override', () => {
    const o = createOctokit('ghs_test_token', { baseUrl: 'https://ghe.example.com/api/v3' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults = (o as any).request?.endpoint?.DEFAULTS as { baseUrl: string };
    expect(defaults.baseUrl).toBe('https://ghe.example.com/api/v3');
  });

  it('has throttling and retry plugins active', () => {
    // The plugin function references are stored on the constructor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = createOctokit('ghs_test_token').constructor as any;
    const plugins: Function[] = Array.isArray(Ctor.plugins) ? Ctor.plugins : [];
    const names = plugins.map((p) => p.name);
    expect(names).toContain('throttling');
    expect(names).toContain('retry');
  });
});
