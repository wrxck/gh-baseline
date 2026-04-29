// Profile registry. Today this is a static map of bundled profiles; later it
// will compose with user-defined YAML profiles loaded from
// `~/.config/gh-baseline/profiles/`. Both forms validate against the same
// `ProfileSchema` so callers don't need to care about the source.

import { ProfileError } from '../core/errors.js';

import { ossPublicProfile } from './oss-public.js';
import { ProfileSchema, type Profile } from './types.js';

const BUNDLED: Record<string, Profile> = {
  [ossPublicProfile.id]: ossPublicProfile,
};

/**
 * Look up a bundled profile by id. Throws `ProfileError` if the id is unknown.
 *
 * The returned profile has been validated against `ProfileSchema` so callers
 * can rely on it being well-formed.
 */
export function getProfile(id: string): Profile {
  const candidate = BUNDLED[id];
  if (candidate === undefined) {
    const known = Object.keys(BUNDLED).sort().join(', ');
    throw new ProfileError(`Unknown profile: ${JSON.stringify(id)}. Bundled profiles: ${known}`);
  }
  // Defensive: re-parse so a future edit to a bundled profile that fails
  // validation surfaces immediately rather than silently shipping bad data.
  return ProfileSchema.parse(candidate);
}

/** Return every bundled profile, validated. */
export function listBundledProfiles(): Profile[] {
  return Object.values(BUNDLED).map((p) => ProfileSchema.parse(p));
}

export { ossPublicProfile } from './oss-public.js';
export * from './types.js';
