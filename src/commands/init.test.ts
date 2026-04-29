import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultSink, setOutputSink, type OutputSink } from '../ui/output.js';
import { init } from './init.js';

let tmp: string;
let originalEnv: string | undefined;

interface CapturedSink extends OutputSink {
  out: string[];
  err: string[];
}

function capture(): CapturedSink {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout(t: string): void {
      out.push(t);
    },
    stderr(t: string): void {
      err.push(t);
    },
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-init-'));
  originalEnv = process.env.GH_BASELINE_CONFIG_PATH;
  process.env.GH_BASELINE_CONFIG_PATH = join(tmp, 'config.json');
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GH_BASELINE_CONFIG_PATH;
  else process.env.GH_BASELINE_CONFIG_PATH = originalEnv;
  rmSync(tmp, { recursive: true, force: true });
  setOutputSink(defaultSink);
});

describe('init', () => {
  it('creates a default config when none exists, mode 0600', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await init();
    expect(code).toBe(0);
    const path = join(tmp, 'config.json');
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.version).toBe(1);
    expect(parsed.defaultProfile).toBe('oss-public');
    expect(sink.out.join('')).toContain('wrote default config');
  });

  it('does not overwrite an existing config without --force', async () => {
    const path = join(tmp, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        defaultProfile: 'oss-public',
        allowedRepos: ['acme/keep-me'],
        allowedOrgs: [],
        unsafeAllowAll: false,
        auth: { mode: 'gh-cli' },
        rateLimit: { perMinute: 30 },
        paths: {},
      }),
      { mode: 0o600 },
    );
    const sink = capture();
    setOutputSink(sink);
    const code = await init();
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.allowedRepos).toEqual(['acme/keep-me']);
    expect(sink.out.join('')).toContain('config already exists');
  });

  it('overwrites with --force', async () => {
    const path = join(tmp, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({ version: 1, allowedRepos: ['will-be-lost/x'] }),
      { mode: 0o600 },
    );
    const sink = capture();
    setOutputSink(sink);
    const code = await init({ force: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.allowedRepos).toEqual([]);
    expect(sink.out.join('')).toContain('overwriting');
  });

  it('emits JSON when --json', async () => {
    const sink = capture();
    setOutputSink(sink);
    await init({ json: true });
    const parsed = JSON.parse(sink.out.join(''));
    expect(parsed.created).toBe(true);
    expect(parsed.path).toBe(join(tmp, 'config.json'));
  });
});
