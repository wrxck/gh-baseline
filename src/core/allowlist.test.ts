import { describe, expect, it } from 'vitest';

import { checkAllowed, isAllowed } from './allowlist.js';
import { defaultConfig, type Config } from './config.js';
import { AllowlistError } from './errors.js';

function cfg(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig(), ...overrides } as Config;
}

describe('checkAllowed', () => {
  it('throws AllowlistError when nothing is configured', () => {
    expect(() => checkAllowed('acme/widgets', cfg())).toThrow(AllowlistError);
  });

  it('passes for an exact repo match', () => {
    expect(() => checkAllowed('acme/widgets', cfg({ allowedRepos: ['acme/widgets'] }))).not.toThrow();
  });

  it('rejects a different repo', () => {
    expect(() =>
      checkAllowed('acme/other', cfg({ allowedRepos: ['acme/widgets'] })),
    ).toThrow(AllowlistError);
  });

  it('passes for an org wildcard via allowedOrgs (bare org name)', () => {
    expect(() => checkAllowed('acme/anything', cfg({ allowedOrgs: ['acme'] }))).not.toThrow();
    expect(() => checkAllowed('acme/another', cfg({ allowedOrgs: ['acme'] }))).not.toThrow();
  });

  it('passes for an org wildcard via "acme/*" in allowedOrgs', () => {
    expect(() => checkAllowed('acme/anything', cfg({ allowedOrgs: ['acme/*'] }))).not.toThrow();
  });

  it('passes for an org wildcard via "acme/*" in allowedRepos', () => {
    expect(() => checkAllowed('acme/anything', cfg({ allowedRepos: ['acme/*'] }))).not.toThrow();
  });

  it('rejects another org when only one is allowed', () => {
    expect(() =>
      checkAllowed('beta/widgets', cfg({ allowedOrgs: ['acme'] })),
    ).toThrow(AllowlistError);
  });

  it('honours unsafeAllowAll = true for any repo', () => {
    expect(() =>
      checkAllowed('anyone/anyrepo', cfg({ unsafeAllowAll: true })),
    ).not.toThrow();
  });

  it('does NOT honour bare "*" without unsafeAllowAll', () => {
    expect(() =>
      checkAllowed('acme/widgets', cfg({ allowedRepos: ['*'] })),
    ).toThrow(AllowlistError);
    expect(() =>
      checkAllowed('acme/widgets', cfg({ allowedOrgs: ['*'] })),
    ).toThrow(AllowlistError);
  });

  it('rejects malformed repo slugs early', () => {
    expect(() => checkAllowed('not-a-slug', cfg({ unsafeAllowAll: true }))).toThrow();
    expect(() => checkAllowed('acme/widgets;rm', cfg({ unsafeAllowAll: true }))).toThrow();
  });

  it('skips malformed allowlist entries silently', () => {
    // garbage entry must not crash the check; legit entry below it should still work
    expect(() =>
      checkAllowed(
        'acme/widgets',
        cfg({ allowedRepos: ['not a slug', 'acme/widgets'], allowedOrgs: ['---bad', 'acme'] }),
      ),
    ).not.toThrow();
  });

  it('combines org and repo allowlists', () => {
    const c = cfg({ allowedOrgs: ['acme'], allowedRepos: ['beta/specific'] });
    expect(() => checkAllowed('acme/anything', c)).not.toThrow();
    expect(() => checkAllowed('beta/specific', c)).not.toThrow();
    expect(() => checkAllowed('beta/other', c)).toThrow(AllowlistError);
  });

  it('AllowlistError carries the repo it rejected', () => {
    try {
      checkAllowed('acme/widgets', cfg());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AllowlistError);
      expect((err as AllowlistError).repo).toBe('acme/widgets');
    }
  });
});

describe('isAllowed', () => {
  it('returns true / false instead of throwing', () => {
    expect(isAllowed('acme/widgets', cfg({ allowedRepos: ['acme/widgets'] }))).toBe(true);
    expect(isAllowed('acme/other', cfg({ allowedRepos: ['acme/widgets'] }))).toBe(false);
    // malformed slug — also false (rather than letting the validator error escape)
    expect(isAllowed('not-a-slug', cfg({ unsafeAllowAll: true }))).toBe(false);
  });
});
