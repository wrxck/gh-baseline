import { defaultConfig, loadConfig, type Config } from '../core/config.js';
import { readAudit, type AuditEntry } from '../core/audit.js';
import { c, heading, info, plain, table, warn } from '../ui/output.js';

export interface AuditCommandOptions {
  tail?: number;
  json?: boolean;
  since?: string;
  tool?: string;
  repo?: string;
  /** Optional config override, primarily for tests. */
  config?: Config;
}

/**
 * Parse `15m`, `1h`, `24h`, `7d`, `30s` into milliseconds.
 *
 * Returns `undefined` for malformed input — callers decide how to surface that.
 */
export function parseDuration(input: string): number | undefined {
  const m = /^(\d+)\s*(s|m|h|d|w)$/i.exec(input.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return undefined;
  switch ((m[2] ?? '').toLowerCase()) {
    case 's':
      return n * 1_000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    case 'w':
      return n * 7 * 86_400_000;
    default:
      return undefined;
  }
}

/** Build the filtered entry list (newest-last). Used by CLI + MCP. */
export function buildAuditView(opts: AuditCommandOptions = {}): {
  entries: AuditEntry[];
  total: number;
} {
  let cfg: Config;
  if (opts.config) {
    cfg = opts.config;
  } else {
    try {
      cfg = loadConfig();
    } catch {
      // If the config is broken we still want `audit` to work — fall back to
      // defaults so `paths.audit` resolution still happens.
      cfg = defaultConfig();
    }
  }

  let entries = readAudit({ config: cfg });
  const total = entries.length;

  if (opts.since !== undefined) {
    const ms = parseDuration(opts.since);
    if (ms !== undefined) {
      const cutoff = Date.now() - ms;
      entries = entries.filter((e) => {
        const t = Date.parse(e.ts);
        return Number.isFinite(t) && t >= cutoff;
      });
    }
  }
  if (opts.tool !== undefined) {
    entries = entries.filter((e) => e.tool === opts.tool);
  }
  if (opts.repo !== undefined) {
    entries = entries.filter((e) => e.repo === opts.repo);
  }

  const tail = opts.tail ?? 20;
  if (tail >= 0 && entries.length > tail) entries = entries.slice(-tail);
  return { entries, total };
}

export async function auditCommand(opts: AuditCommandOptions = {}): Promise<number> {
  const view = buildAuditView(opts);

  if (opts.json) {
    plain(JSON.stringify(view, null, 2));
    return 0;
  }

  heading('gh-baseline audit');
  if (view.total === 0) {
    info('no audit entries yet');
    return 0;
  }

  if (view.entries.length === 0) {
    warn('no entries match the given filters');
    info(`(audit log has ${view.total} entries total)`);
    return 0;
  }

  const rows = view.entries.map((e) => [
    e.ts,
    e.tool,
    e.repo ?? '-',
    e.dryRun ? `${c.yellow}yes${c.reset}` : 'no',
    formatResult(e.result),
    e.error ?? '',
  ]);
  table(['timestamp', 'tool', 'repo', 'dry-run', 'result', 'error'], rows);
  info(`showing ${view.entries.length} of ${view.total} total entries`);
  return 0;
}

function formatResult(r: 'ok' | 'error' | 'dry-run'): string {
  switch (r) {
    case 'ok':
      return `${c.green}ok${c.reset}`;
    case 'error':
      return `${c.red}error${c.reset}`;
    case 'dry-run':
      return `${c.yellow}dry-run${c.reset}`;
  }
}
