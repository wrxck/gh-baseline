import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { lock } from 'proper-lockfile';
import { z } from 'zod';

import { defaultAuditPath, type Config } from './config.js';

export const AuditEntrySchema = z.object({
  ts: z.string(),
  tool: z.string(),
  repo: z.string().optional(),
  args: z.unknown().optional(),
  result: z.enum(['ok', 'error', 'dry-run']),
  error: z.string().optional(),
  dryRun: z.boolean(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export interface AuditLogInput {
  tool: string;
  repo?: string;
  args?: unknown;
  result: 'ok' | 'error' | 'dry-run';
  error?: string;
  dryRun: boolean;
}

export interface AuditLogOptions {
  /** Override the destination path. Otherwise resolved via `resolveAuditPath`. */
  path?: string;
  /** Optionally pass the active config so `paths.audit` is honoured. */
  config?: Config;
}

/**
 * Resolve where audit lines should be written.
 *
 * Precedence: explicit `path` arg > `GH_BASELINE_AUDIT_PATH` env > `config.paths.audit`
 * > `defaultAuditPath()`.
 */
export function resolveAuditPath(opts: AuditLogOptions = {}): string {
  if (opts.path) return opts.path;
  const envPath = process.env.GH_BASELINE_AUDIT_PATH;
  if (envPath) return envPath;
  if (opts.config?.paths?.audit) return opts.config.paths.audit;
  return defaultAuditPath();
}

function ensureFile0600(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(path)) {
    const fd = openSync(path, 'a', 0o600);
    closeSync(fd);
    // openSync's mode is masked by umask, so chmod again to be sure.
    chmodSync(path, 0o600);
  }
}

/**
 * Append a single JSONL audit entry. The write is bracketed by a
 * `proper-lockfile` lock so concurrent writers don't tear lines.
 */
export async function auditLog(
  entry: AuditLogInput,
  opts: AuditLogOptions = {},
): Promise<void> {
  const path = resolveAuditPath(opts);
  ensureFile0600(path);

  const full: AuditEntry = {
    ts: new Date().toISOString(),
    tool: entry.tool,
    result: entry.result,
    dryRun: entry.dryRun,
    ...(entry.repo !== undefined ? { repo: entry.repo } : {}),
    ...(entry.args !== undefined ? { args: entry.args } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
  };

  // Validate before write so a malformed entry can't poison the log.
  AuditEntrySchema.parse(full);
  const line = JSON.stringify(full) + '\n';

  const release = await lock(path, {
    retries: { retries: 50, factor: 1.2, minTimeout: 10, maxTimeout: 100 },
    stale: 5_000,
  });
  try {
    appendFileSync(path, line);
  } finally {
    await release();
  }
}

export interface ReadAuditOptions {
  /** Return only the last N entries (after parsing). */
  tail?: number;
  /** Override the source path. Otherwise resolved via `resolveAuditPath`. */
  path?: string;
  /** Optionally pass the active config so `paths.audit` is honoured. */
  config?: Config;
}

/**
 * Read the audit log from disk and return parsed entries (newest last).
 *
 * Malformed lines are skipped silently — the caller can run their own
 * validation if they want a strict mode.
 */
export function readAudit(opts: ReadAuditOptions = {}): AuditEntry[] {
  const path = resolveAuditPath(opts);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const entries: AuditEntry[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const result = AuditEntrySchema.safeParse(parsed);
    if (result.success) entries.push(result.data);
  }
  if (opts.tail !== undefined && opts.tail >= 0) {
    return entries.slice(-opts.tail);
  }
  return entries;
}
