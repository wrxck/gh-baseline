import { afterEach, describe, expect, it } from 'vitest';

import { defaultSink, setOutputSink, type OutputSink } from '../ui/output.js';
import {
  getProfile,
  listProfiles,
  profilesList,
  profilesPlaceholder,
  profilesShow,
  type ProfilesIndexModule,
  type ProfileSummary,
} from './profiles.js';

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

afterEach(() => {
  setOutputSink(defaultSink);
});

const sample: ProfileSummary[] = [
  {
    id: 'oss-public',
    name: 'OSS public',
    description: 'baseline for public OSS repos',
    requireBranchProtection: true,
  },
  { id: 'private-team', name: 'Private team' },
];

const fakeMod: ProfilesIndexModule = {
  profiles: sample,
  getProfile: (id) => sample.find((p) => p.id === id),
};

describe('listProfiles', () => {
  it('returns [] when registry is empty', async () => {
    expect(await listProfiles({})).toEqual([]);
  });

  it('returns the registered profiles', async () => {
    expect(await listProfiles(fakeMod)).toEqual(sample);
  });

  it('supports a profiles function', async () => {
    expect(await listProfiles({ profiles: () => sample })).toEqual(sample);
  });
});

describe('getProfile', () => {
  it('finds by id via getProfile', async () => {
    const p = await getProfile('oss-public', fakeMod);
    expect(p?.id).toBe('oss-public');
  });

  it('falls back to scanning the list when no getProfile fn', async () => {
    const p = await getProfile('private-team', { profiles: sample });
    expect(p?.id).toBe('private-team');
  });

  it('returns undefined for unknown id', async () => {
    expect(await getProfile('nope', fakeMod)).toBeUndefined();
  });
});

describe('profilesList', () => {
  it('emits JSON when --json', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await profilesList({ json: true, module: fakeMod });
    expect(code).toBe(0);
    const parsed = JSON.parse(sink.out.join(''));
    expect(parsed).toEqual(sample);
  });

  it('prints a friendly message when registry empty', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await profilesList({ module: {} });
    expect(code).toBe(0);
    expect(sink.out.join('')).toContain('no profiles registered');
  });
});

describe('profilesShow', () => {
  it('returns 1 and complains for unknown id', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await profilesShow('missing', { module: fakeMod });
    expect(code).toBe(1);
    expect(sink.err.join('')).toContain('not found');
  });

  it('emits the profile JSON when --json', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await profilesShow('oss-public', { json: true, module: fakeMod });
    expect(code).toBe(0);
    const parsed = JSON.parse(sink.out.join(''));
    expect(parsed.id).toBe('oss-public');
    expect(parsed.requireBranchProtection).toBe(true);
  });

  it('pretty-prints by default', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await profilesShow('oss-public', { module: fakeMod });
    expect(code).toBe(0);
    const out = sink.out.join('');
    expect(out).toContain('oss-public');
    expect(out).toContain('OSS public');
    expect(out).toContain('requireBranchProtection');
  });
});

describe('profilesPlaceholder', () => {
  it('returns 0 and prints a v0.2.0 hint', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await profilesPlaceholder('new');
    expect(code).toBe(0);
    expect(sink.out.join('')).toContain('Coming in v0.2.0');
  });
});
