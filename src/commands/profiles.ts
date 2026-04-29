import { c, error as printError, heading, info, plain, success, table, warn } from '../ui/output.js';

/**
 * Loose shape we accept from `src/profiles/index.ts` (which Agent B owns).
 * Each profile is expected to expose at least an `id`, `name`, and
 * `description`. Extra fields pass through to `profiles show --json`.
 */
export interface ProfileSummary {
  id: string;
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface ProfilesIndexModule {
  /** Either a static array of profiles or a function returning the same. */
  profiles?: ProfileSummary[] | (() => ProfileSummary[] | Promise<ProfileSummary[]>);
  /** Optional id-keyed lookup. */
  getProfile?: (id: string) => ProfileSummary | undefined | Promise<ProfileSummary | undefined>;
}

/**
 * Lazy-import the profiles index. Agent B owns `src/profiles/index.ts`. If
 * the module doesn't exist yet, this falls back to an empty registry rather
 * than crashing the CLI.
 */
export async function loadProfilesIndex(): Promise<ProfilesIndexModule> {
  // Computed specifier so TypeScript doesn't try to resolve the path at
  // compile time — Agent B owns `src/profiles/index.ts` and may not have
  // landed it yet.
  const specifier = '../profiles/index.js';
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as ProfilesIndexModule;
    return mod;
  } catch {
    return {};
  }
}

export async function listProfiles(mod?: ProfilesIndexModule): Promise<ProfileSummary[]> {
  const index = mod ?? (await loadProfilesIndex());
  if (!index.profiles) return [];
  if (typeof index.profiles === 'function') {
    return await index.profiles();
  }
  return index.profiles;
}

export async function getProfile(
  id: string,
  mod?: ProfilesIndexModule,
): Promise<ProfileSummary | undefined> {
  const index = mod ?? (await loadProfilesIndex());
  if (typeof index.getProfile === 'function') {
    return await index.getProfile(id);
  }
  // Fall back to scanning the list.
  const all = await listProfiles(index);
  return all.find((p) => p.id === id);
}

export interface ProfilesListOptions {
  json?: boolean;
  /** Test seam: inject a fake module instead of importing from disk. */
  module?: ProfilesIndexModule;
}

export async function profilesList(opts: ProfilesListOptions = {}): Promise<number> {
  const all = await listProfiles(opts.module);
  if (opts.json) {
    plain(JSON.stringify(all, null, 2));
    return 0;
  }
  heading('available profiles');
  if (all.length === 0) {
    warn('no profiles registered yet');
    info('the bundled `oss-public` profile will appear here once Agent B lands the profile registry');
    return 0;
  }
  const rows = all.map((p) => [p.id, p.name, p.description ?? '']);
  table(['id', 'name', 'description'], rows);
  return 0;
}

export interface ProfilesShowOptions extends ProfilesListOptions {}

export async function profilesShow(
  id: string,
  opts: ProfilesShowOptions = {},
): Promise<number> {
  if (!id) {
    printError('profiles show: missing <id>');
    return 1;
  }
  const profile = await getProfile(id, opts.module);
  if (!profile) {
    if (opts.json) {
      plain(JSON.stringify({ error: `profile not found: ${id}` }, null, 2));
    } else {
      printError(`profile not found: ${id}`);
    }
    return 1;
  }

  if (opts.json) {
    plain(JSON.stringify(profile, null, 2));
    return 0;
  }
  heading(`profile: ${profile.id}`);
  info(`name: ${profile.name}`);
  if (profile.description) info(`description: ${profile.description}`);
  for (const [k, v] of Object.entries(profile)) {
    if (k === 'id' || k === 'name' || k === 'description') continue;
    plain(`${c.dim}${k}:${c.reset}`);
    plain(indent(JSON.stringify(v, null, 2), 2));
  }
  return 0;
}

export async function profilesPlaceholder(verb: 'new' | 'edit'): Promise<number> {
  heading(`profiles ${verb}`);
  success('Coming in v0.2.0 (Ink TUI)');
  info(`for now, edit profile YAML directly under ~/.config/gh-baseline/profiles/`);
  return 0;
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}
