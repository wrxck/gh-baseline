import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

import type { Config } from './config.js';
import { AuthError, ScopeError } from './errors.js';

/** Result of running a subprocess. */
export interface RunCmdResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Subprocess runner — injectable so tests don't shell out. */
export type RunCmd = (cmd: string, args: string[]) => Promise<RunCmdResult>;

export interface ResolvedToken {
  token: string;
  source: 'gh-cli' | 'pat-file';
  scopes: string[];
}

export interface GetTokenOptions {
  /** Override the subprocess runner (defaults to a `spawn`-based runner). */
  runCmd?: RunCmd;
  /** Override the HTTP fetcher used to read scopes for PAT mode. */
  fetchImpl?: typeof fetch;
}

/** Default `runCmd` backed by `node:child_process.spawn`. */
export const defaultRunCmd: RunCmd = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      resolve({ stdout, stderr: stderr + (err.message ?? ''), exitCode: 1 });
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });

/**
 * Resolve a GitHub token from the user's configured auth backend.
 *
 * - `gh-cli` mode: shells out to `gh auth token` for the token, and
 *   `gh auth status` to read scopes (parses the `- Token scopes:` line).
 * - `pat` mode: reads `auth.patPath` (warns to stderr if mode is looser than
 *   0600), then probes `GET /user` and reads `x-oauth-scopes` for the scope
 *   list.
 */
export async function getToken(
  config: Config,
  opts: GetTokenOptions = {},
): Promise<ResolvedToken> {
  const runCmd = opts.runCmd ?? defaultRunCmd;
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (config.auth.mode === 'gh-cli') {
    const tok = await runCmd('gh', ['auth', 'token']);
    if (tok.exitCode !== 0 || tok.stdout.trim() === '') {
      throw new AuthError(
        `\`gh auth token\` failed (exit ${tok.exitCode}): ${tok.stderr.trim() || 'no output'}`,
      );
    }
    const token = tok.stdout.trim();

    const status = await runCmd('gh', ['auth', 'status']);
    // gh auth status writes to stderr; combine to be safe across versions.
    const haystack = `${status.stdout}\n${status.stderr}`;
    const scopes = parseGhScopes(haystack);
    return { token, source: 'gh-cli', scopes };
  }

  // PAT mode
  const patPath = config.auth.patPath;
  if (!patPath || patPath.length === 0) {
    throw new AuthError('auth.mode is "pat" but auth.patPath is not set');
  }
  let mode: number;
  try {
    mode = statSync(patPath).mode & 0o777;
  } catch (err) {
    throw new AuthError(
      `Failed to stat PAT file at ${patPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (mode !== 0o600) {
    process.stderr.write(
      `gh-baseline: warning: PAT file at ${patPath} has mode ${mode.toString(8)}, expected 600\n`,
    );
  }
  let token: string;
  try {
    token = readFileSync(patPath, 'utf-8').trim();
  } catch (err) {
    throw new AuthError(
      `Failed to read PAT file at ${patPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (token === '') throw new AuthError(`PAT file at ${patPath} is empty`);

  // Probe scopes via GET /user. Errors here surface as AuthError because
  // without the token actually authenticating, every other call will fail
  // anyway and we'd rather fail fast.
  let res: Response;
  try {
    res = await fetchImpl('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    throw new AuthError(
      `Failed to probe GitHub for token scopes: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new AuthError(
      `GitHub rejected PAT during scope probe: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const headerVal = res.headers.get('x-oauth-scopes') ?? '';
  const scopes = headerVal
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { token, source: 'pat-file', scopes };
}

/**
 * Throw a `ScopeError` listing missing scopes if any of `required` are not in
 * `actual`. Comparison is case-sensitive, matching GitHub's documented scopes.
 */
export function requireScopes(actual: string[], required: string[]): void {
  const have = new Set(actual);
  const missing = required.filter((s) => !have.has(s));
  if (missing.length > 0) throw new ScopeError(missing);
}

/**
 * Parse the `- Token scopes:` line out of `gh auth status` output.
 *
 * Format (gh 2.x): `  - Token scopes: 'repo', 'read:org', 'workflow'`
 * Older variants: `  - Token scopes: repo, read:org, workflow`
 */
export function parseGhScopes(output: string): string[] {
  const line = output.split(/\r?\n/).find((l) => /Token scopes:/i.test(l));
  if (!line) return [];
  const after = line.split(/Token scopes:/i)[1] ?? '';
  return after
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
}
