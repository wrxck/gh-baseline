import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getToken, parseGhScopes, redactStderr, requireScopes, type RunCmd } from './auth.js';
import { defaultConfig, type Config } from './config.js';
import { AuthError, ScopeError } from './errors.js';

function cfg(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig(), ...overrides };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-auth-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseGhScopes', () => {
  it('parses gh 2.x output (quoted scopes)', () => {
    const out = [
      'github.com',
      "  ✓ Logged in to github.com as octocat (oauth_token)",
      "  - Token scopes: 'repo', 'read:org', 'workflow'",
    ].join('\n');
    expect(parseGhScopes(out)).toEqual(['repo', 'read:org', 'workflow']);
  });

  it('parses unquoted variant', () => {
    expect(parseGhScopes('  - Token scopes: repo, read:org')).toEqual(['repo', 'read:org']);
  });

  it('returns [] when missing', () => {
    expect(parseGhScopes('something else entirely')).toEqual([]);
  });
});

describe('requireScopes', () => {
  it('passes when all required are present', () => {
    expect(() => requireScopes(['repo', 'read:org'], ['repo'])).not.toThrow();
  });

  it('throws ScopeError listing missing', () => {
    try {
      requireScopes(['repo'], ['repo', 'admin:org']);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeError);
      expect((err as ScopeError).missing).toEqual(['admin:org']);
    }
  });
});

describe('getToken (gh-cli mode)', () => {
  it('returns the token + parsed scopes', async () => {
    const calls: Array<[string, string[]]> = [];
    const runCmd: RunCmd = async (cmd, args) => {
      calls.push([cmd, args]);
      if (args[0] === 'auth' && args[1] === 'token') {
        return { stdout: 'ghp_fake\n', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'auth' && args[1] === 'status') {
        return {
          stdout: '',
          stderr: "  - Token scopes: 'repo', 'workflow'\n",
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: 'unexpected', exitCode: 1 };
    };
    const result = await getToken(cfg(), { runCmd });
    expect(result.source).toBe('gh-cli');
    expect(result.token).toBe('ghp_fake');
    expect(result.scopes).toEqual(['repo', 'workflow']);
    expect(calls[0]).toEqual(['gh', ['auth', 'token']]);
  });

  it('throws AuthError when gh auth token fails', async () => {
    const runCmd: RunCmd = async () => ({ stdout: '', stderr: 'not logged in', exitCode: 1 });
    await expect(getToken(cfg(), { runCmd })).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError when gh auth token returns empty', async () => {
    const runCmd: RunCmd = async () => ({ stdout: '   ', stderr: '', exitCode: 0 });
    await expect(getToken(cfg(), { runCmd })).rejects.toBeInstanceOf(AuthError);
  });
});

describe('getToken (pat mode)', () => {
  it('reads token and probes scopes via /user', async () => {
    const patPath = join(tmp, 'token');
    writeFileSync(patPath, 'ghp_pat_value\n', { mode: 0o600 });
    chmodSync(patPath, 0o600);

    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://api.github.com/user');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer ghp_pat_value');
      return new Response('{}', {
        status: 200,
        headers: { 'x-oauth-scopes': 'repo, admin:org' },
      });
    };

    const result = await getToken(cfg({ auth: { mode: 'pat', patPath } }), { fetchImpl });
    expect(result.source).toBe('pat-file');
    expect(result.token).toBe('ghp_pat_value');
    expect(result.scopes).toEqual(['repo', 'admin:org']);
  });

  it('throws AuthError when patPath is missing', async () => {
    await expect(getToken(cfg({ auth: { mode: 'pat' } }))).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError when the file is empty', async () => {
    const patPath = join(tmp, 'empty');
    writeFileSync(patPath, '', { mode: 0o600 });
    chmodSync(patPath, 0o600);
    await expect(getToken(cfg({ auth: { mode: 'pat', patPath } }))).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it('throws AuthError when GitHub rejects the token', async () => {
    const patPath = join(tmp, 'bad');
    writeFileSync(patPath, 'ghp_bad', { mode: 0o600 });
    chmodSync(patPath, 0o600);
    const fetchImpl: typeof fetch = async () =>
      new Response('Bad credentials', { status: 401, statusText: 'Unauthorized' });
    await expect(
      getToken(cfg({ auth: { mode: 'pat', patPath } }), { fetchImpl }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('refuses to load when PAT file has loose permissions (group/other bits)', async () => {
    const patPath = join(tmp, 'loose');
    writeFileSync(patPath, 'ghp_x', { mode: 0o644 });
    chmodSync(patPath, 0o644);
    await expect(
      getToken(cfg({ auth: { mode: 'pat', patPath } })),
    ).rejects.toThrow(/loose permissions \(644\)/);
  });

  it('warns to stderr when PAT file is owner-only but not exactly 0600', async () => {
    const patPath = join(tmp, 'owner-strict');
    writeFileSync(patPath, 'ghp_x', { mode: 0o400 });
    chmodSync(patPath, 0o400);
    const fetchImpl: typeof fetch = async () =>
      new Response('{}', { status: 200, headers: { 'x-oauth-scopes': 'repo' } });

    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr.write as unknown) = (chunk: unknown) => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    };
    try {
      await getToken(cfg({ auth: { mode: 'pat', patPath } }), { fetchImpl });
    } finally {
      (process.stderr.write as unknown) = original;
    }
    expect(writes.join('')).toMatch(/mode 400/);
  });
});

describe('redactStderr', () => {
  it('caps long input', async () => {
    const { redactStderr } = await import('./auth.js');
    const long = 'x'.repeat(500);
    const out = redactStderr(long, 200);
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith('…')).toBe(true);
  });

  it('redacts ghp_/ghs_ token-shaped substrings', async () => {
    const { redactStderr } = await import('./auth.js');
    const out = redactStderr('error: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA leaked');
    expect(out).not.toMatch(/ghp_AAA/);
    expect(out).toMatch(/\[REDACTED\]/);
  });
});

describe('getToken (gh-cli scope parse warning)', () => {
  it('warns when gh succeeds but scopes parse is empty', async () => {
    const runCmd: RunCmd = async (_cmd, args) => {
      if (args[0] === 'auth' && args[1] === 'token') {
        return { stdout: 'ghp_fake', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: 'unparseable output\n', exitCode: 0 };
    };
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr.write as unknown) = (chunk: unknown) => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    };
    try {
      await getToken(cfg(), { runCmd });
    } finally {
      (process.stderr.write as unknown) = original;
    }
    expect(writes.join('')).toMatch(/could not parse scopes/);
  });
});
