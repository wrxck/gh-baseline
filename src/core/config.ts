import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { ConfigError } from './errors.js';

export const CONFIG_VERSION = 1;

export const AuthSchema = z.object({
  mode: z.enum(['gh-cli', 'pat']).default('gh-cli'),
  patPath: z.string().optional(),
});

export const RateLimitSchema = z.object({
  perMinute: z.number().int().positive().default(100),
});

export const PathsSchema = z.object({
  audit: z.string().optional(),
  profiles: z.string().optional(),
});

export const ConfigSchema = z.object({
  version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),
  defaultProfile: z.string().min(1).default('oss-public'),
  allowedRepos: z.array(z.string()).default([]),
  allowedOrgs: z.array(z.string()).default([]),
  unsafeAllowAll: z.boolean().default(false),
  auth: AuthSchema.default({ mode: 'gh-cli' }),
  rateLimit: RateLimitSchema.default({ perMinute: 100 }),
  paths: PathsSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Resolve the directory for gh-baseline config (`~/.config/gh-baseline`). */
export function configDir(): string {
  return join(homedir(), '.config', 'gh-baseline');
}

/** Resolve the active config file path, honouring `GH_BASELINE_CONFIG_PATH`. */
export function configPath(): string {
  return process.env.GH_BASELINE_CONFIG_PATH ?? join(configDir(), 'config.json');
}

/** Default audit log path. */
export function defaultAuditPath(): string {
  return join(configDir(), 'audit.jsonl');
}

/** Default profiles directory. */
export function defaultProfilesDir(): string {
  return join(configDir(), 'profiles');
}

/** Build a fully-defaulted Config object. */
export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

/**
 * Load the config from disk.
 *
 * - If the file does not exist, returns the defaults (without writing anything).
 * - If the file exists but is invalid JSON or fails schema validation, throws `ConfigError`.
 */
export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return defaultConfig();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new ConfigError(
      `Failed to read config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `Config at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Config at ${path} failed validation: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Save the config to disk atomically (tmp + rename) with mode 0600.
 *
 * Ensures the parent directory exists and is mode 0700.
 */
export function saveConfig(config: Config): void {
  const validated = ConfigSchema.parse(config);
  const path = configPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync's `mode` is only honored when creating the file; chmod to be sure.
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  // Renaming preserves the file mode of the source, so the final file is 0600.
}
