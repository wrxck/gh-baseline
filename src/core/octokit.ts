import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';

export interface CreateOctokitOptions {
  /** GitHub Enterprise Server / mock URL. Defaults to `https://api.github.com`. */
  baseUrl?: string;
  /** Override the User-Agent header. Defaults to `gh-baseline/<version>`. */
  userAgent?: string;
}

const ThrottledOctokit = Octokit.plugin(throttling, retry);

let cachedVersion: string | undefined;

/**
 * Read the package version from the on-disk `package.json`. Cached after the
 * first call. Falls back to `0.0.0` if the file isn't present (e.g. in some
 * test layouts).
 */
export function readPackageVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    // src/core/octokit.ts -> ../../ is the package root.
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = join(here, '..', '..', 'package.json');
    const raw = readFileSync(candidate, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    cachedVersion = typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/**
 * Construct a configured Octokit client with throttling + retry plugins.
 *
 * - User-Agent defaults to `gh-baseline/<version>`.
 * - Primary rate-limit hook respects `retryAfter` and retries up to twice.
 * - Secondary (abuse-detection) hook waits up to 60s once.
 */
export function createOctokit(token: string, opts: CreateOctokitOptions = {}): Octokit {
  const userAgent = opts.userAgent ?? `gh-baseline/${readPackageVersion()}`;
  const constructorOpts: ConstructorParameters<typeof ThrottledOctokit>[0] = {
    auth: token,
    userAgent,
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        const method = (options as { method?: string }).method ?? 'GET';
        const url = (options as { url?: string }).url ?? '';
        process.stderr.write(
          `gh-baseline: rate limit hit for ${method} ${url} — retry after ${retryAfter}s\n`,
        );
        if (retryCount < 2) return true;
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        const method = (options as { method?: string }).method ?? 'GET';
        const url = (options as { url?: string }).url ?? '';
        process.stderr.write(
          `gh-baseline: secondary rate limit (abuse detection) for ${method} ${url} — retry after ${retryAfter}s\n`,
        );
        // Only retry once, and only if GitHub is asking us to wait <= 60s.
        if (retryCount < 1 && retryAfter <= 60) return true;
        return false;
      },
    },
  };
  if (opts.baseUrl !== undefined) constructorOpts.baseUrl = opts.baseUrl;

  return new ThrottledOctokit(constructorOpts);
}
