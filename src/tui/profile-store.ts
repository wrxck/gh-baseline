import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';

import * as YAML from 'yaml';
import { z } from 'zod';

// TODO(integration): swap to imported ProfileSchema once src/profiles/types.ts
// lands. The local schema kept loose so writes from the builder don't reject
// fields that aren't yet pinned in the global schema.
const LocalProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
  })
  .passthrough();

export type ProfileSpec = z.infer<typeof LocalProfileSchema>;

export interface ProfileFile {
  id: string;
  profile: ProfileSpec;
  source: string;
  format: 'yaml';
}

/** Resolve `~/.config/gh-baseline/profiles`, honouring `GH_BASELINE_PROFILES_DIR`. */
export function profilesDir(): string {
  const override = process.env.GH_BASELINE_PROFILES_DIR;
  if (override) return override;
  return join(homedir(), '.config', 'gh-baseline', 'profiles');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/** Enumerate `*.yaml` files in the profiles directory. Returns [] if missing. */
export function list(): ProfileFile[] {
  const dir = profilesDir();
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const result: ProfileFile[] = [];
  for (const name of entries) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    const id = name.slice(0, -extname(name).length);
    const file = read(id);
    if (file) result.push(file);
  }
  return result;
}

/**
 * Load + parse + validate a profile by id.
 *
 * Returns `null` when the file is missing or malformed (rather than throwing)
 * — the TUI surfaces this as "could not load" without crashing the navigator.
 */
export function read(id: string): ProfileFile | null {
  const dir = profilesDir();
  const candidates = [join(dir, `${id}.yaml`), join(dir, `${id}.yml`)];
  for (const source of candidates) {
    if (!existsSync(source)) continue;
    let raw: string;
    try {
      raw = readFileSync(source, 'utf-8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch {
      return null;
    }
    const validated = LocalProfileSchema.safeParse(parsed);
    if (!validated.success) return null;
    return { id, profile: validated.data, source, format: 'yaml' };
  }
  return null;
}

/**
 * Validate + serialise + atomically write a profile to
 * `<profilesDir>/<id>.yaml` with mode 0600. Returns the absolute path.
 */
export function write(profile: ProfileSpec, format: 'yaml'): string {
  const validated = LocalProfileSchema.parse(profile);
  if (format !== 'yaml') {
    // Only yaml is supported in MVP; the param is kept for forwards-compat.
    throw new Error(`Unsupported profile format: ${format}`);
  }
  const dir = profilesDir();
  ensureDir(dir);
  const path = join(dir, `${validated.id}.yaml`);
  const parentDir = dirname(path);
  ensureDir(parentDir);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const body = YAML.stringify(validated);
  writeFileSync(tmp, body, { mode: 0o600 });
  // writeFileSync's mode is umask-masked; chmod again to be sure.
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return path;
}

export { LocalProfileSchema };
