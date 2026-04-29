import { describe, it, expect } from 'vitest';

import {
  AllowlistError,
  AuthError,
  ConfigError,
  GhBaselineError,
  ProfileError,
  RateLimitError,
  RepoNotFoundError,
  ScopeError,
} from './errors.js';

describe('GhBaselineError', () => {
  it('defaults exitCode to 1', () => {
    const err = new GhBaselineError('boom');
    expect(err.message).toBe('boom');
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe('GhBaselineError');
    expect(err instanceof Error).toBe(true);
  });

  it('accepts a custom exitCode', () => {
    expect(new GhBaselineError('x', 42).exitCode).toBe(42);
  });
});

describe('AuthError', () => {
  it('has a sensible default message and exitCode 2', () => {
    const err = new AuthError();
    expect(err.message).toMatch(/auth/i);
    expect(err.exitCode).toBe(2);
    expect(err.name).toBe('AuthError');
    expect(err instanceof GhBaselineError).toBe(true);
  });

  it('accepts an override message', () => {
    expect(new AuthError('gh token missing').message).toBe('gh token missing');
  });
});

describe('ScopeError', () => {
  it('lists missing scopes in default message', () => {
    const err = new ScopeError(['repo', 'admin:org']);
    expect(err.missing).toEqual(['repo', 'admin:org']);
    expect(err.message).toContain('repo');
    expect(err.message).toContain('admin:org');
    expect(err.exitCode).toBe(3);
    expect(err.name).toBe('ScopeError');
  });

  it('accepts an override message', () => {
    const err = new ScopeError(['repo'], 'custom');
    expect(err.message).toBe('custom');
    expect(err.missing).toEqual(['repo']);
  });
});

describe('AllowlistError', () => {
  it('mentions the repo and how to fix in default message', () => {
    const err = new AllowlistError('acme/widgets');
    expect(err.message).toContain('acme/widgets');
    expect(err.repo).toBe('acme/widgets');
    expect(err.exitCode).toBe(4);
    expect(err.name).toBe('AllowlistError');
  });
});

describe('RateLimitError', () => {
  it('has exitCode 5', () => {
    const err = new RateLimitError();
    expect(err.exitCode).toBe(5);
    expect(err.name).toBe('RateLimitError');
  });
});

describe('RepoNotFoundError', () => {
  it('mentions the repo', () => {
    const err = new RepoNotFoundError('acme/missing');
    expect(err.repo).toBe('acme/missing');
    expect(err.message).toContain('acme/missing');
    expect(err.exitCode).toBe(6);
    expect(err.name).toBe('RepoNotFoundError');
  });
});

describe('ConfigError', () => {
  it('exists with exitCode 7', () => {
    expect(new ConfigError().exitCode).toBe(7);
  });
});

describe('ProfileError', () => {
  it('exists with exitCode 8', () => {
    expect(new ProfileError().exitCode).toBe(8);
  });
});
