import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { list, read, write } from './profile-store.js';

let tempDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'gh-baseline-profile-store-'));
  prevEnv = process.env.GH_BASELINE_PROFILES_DIR;
  process.env.GH_BASELINE_PROFILES_DIR = tempDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.GH_BASELINE_PROFILES_DIR;
  else process.env.GH_BASELINE_PROFILES_DIR = prevEnv;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('profile-store', () => {
  it('list returns [] when the directory is missing', () => {
    rmSync(tempDir, { recursive: true, force: true });
    expect(list()).toEqual([]);
  });

  it('write + read round-trip preserves the profile', () => {
    const path = write(
      { id: 'oss-public', name: 'OSS Public', description: 'For public OSS repos' },
      'yaml',
    );
    expect(path.endsWith('oss-public.yaml')).toBe(true);

    const loaded = read('oss-public');
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe('oss-public');
    expect(loaded?.profile.name).toBe('OSS Public');
    expect(loaded?.profile.description).toBe('For public OSS repos');
    expect(loaded?.format).toBe('yaml');
  });

  it('list enumerates yaml profiles', () => {
    write({ id: 'a-prof', name: 'A' }, 'yaml');
    write({ id: 'b-prof', name: 'B' }, 'yaml');
    const ls = list().map((f) => f.id).sort();
    expect(ls).toEqual(['a-prof', 'b-prof']);
  });

  it('read returns null on malformed yaml', () => {
    writeFileSync(join(tempDir, 'broken.yaml'), ': : :\n - not: [valid', 'utf-8');
    expect(read('broken')).toBeNull();
  });

  it('read returns null on missing files', () => {
    expect(read('does-not-exist')).toBeNull();
  });

  it('write rejects an invalid id', () => {
    expect(() =>
      write({ id: 'BAD ID!!', name: 'x' } as unknown as { id: string; name: string }, 'yaml'),
    ).toThrow();
  });
});
