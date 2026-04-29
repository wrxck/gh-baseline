import { describe, expect, it } from 'vitest';

import { ProfileError } from '../core/errors.js';

import { getProfile, listBundledProfiles } from './index.js';
import { ossPublicProfile } from './oss-public.js';
import { ProfileSchema } from './types.js';

describe('ProfileSchema', () => {
  it('validates the bundled oss-public profile', () => {
    const result = ProfileSchema.safeParse(ossPublicProfile);
    expect(result.success).toBe(true);
  });

  it('rejects bad ids', () => {
    const bad = { ...ossPublicProfile, id: 'NotLowerCase' };
    expect(ProfileSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects non-hex label colors', () => {
    const bad = {
      ...ossPublicProfile,
      labels: {
        policy: 'superset' as const,
        entries: [{ name: 'bug', color: 'not-hex' }],
      },
    };
    expect(ProfileSchema.safeParse(bad).success).toBe(false);
  });
});

describe('getProfile', () => {
  it('returns the bundled oss-public profile', () => {
    const p = getProfile('oss-public');
    expect(p.id).toBe('oss-public');
    expect(p.name).toBe('OSS Public');
  });

  it('throws ProfileError on unknown id', () => {
    expect(() => getProfile('does-not-exist')).toThrow(ProfileError);
  });
});

describe('listBundledProfiles', () => {
  it('returns at least the oss-public profile', () => {
    const all = listBundledProfiles();
    expect(all.some((p) => p.id === 'oss-public')).toBe(true);
  });
});
