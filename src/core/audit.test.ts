import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, readAudit, resolveAuditPath } from './audit.js';
import { defaultConfig } from './config.js';

let tmp: string;
let auditPath: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-audit-'));
  auditPath = join(tmp, 'audit.jsonl');
  originalEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_AUDIT_PATH = auditPath;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = originalEnv;
  rmSync(tmp, { recursive: true, force: true });
});

describe('resolveAuditPath', () => {
  it('honours the explicit path arg first', () => {
    expect(resolveAuditPath({ path: '/explicit/x.jsonl' })).toBe('/explicit/x.jsonl');
  });

  it('falls through to env, then config, then default', () => {
    expect(resolveAuditPath()).toBe(auditPath);
    delete process.env.GH_BASELINE_AUDIT_PATH;
    const cfg = { ...defaultConfig(), paths: { audit: '/cfg/y.jsonl' } };
    expect(resolveAuditPath({ config: cfg })).toBe('/cfg/y.jsonl');
    expect(resolveAuditPath()).toMatch(/audit\.jsonl$/);
  });
});

describe('auditLog', () => {
  it('creates the file at mode 0600 and appends a JSONL line', async () => {
    await auditLog({ tool: 'check.repo', repo: 'acme/widgets', result: 'ok', dryRun: false });
    const stat = statSync(auditPath);
    expect(stat.mode & 0o777).toBe(0o600);
    const entries = readAudit();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tool).toBe('check.repo');
    expect(entries[0]?.repo).toBe('acme/widgets');
    expect(entries[0]?.result).toBe('ok');
    expect(entries[0]?.dryRun).toBe(false);
    expect(entries[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends multiple entries in order', async () => {
    await auditLog({ tool: 'a', result: 'ok', dryRun: false });
    await auditLog({ tool: 'b', result: 'error', error: 'boom', dryRun: false });
    await auditLog({ tool: 'c', result: 'dry-run', dryRun: true });
    const entries = readAudit();
    expect(entries.map((e) => e.tool)).toEqual(['a', 'b', 'c']);
    expect(entries[1]?.error).toBe('boom');
    expect(entries[2]?.dryRun).toBe(true);
  });

  it('survives concurrent writers (lockfile serialises them)', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        auditLog({ tool: `tool-${i}`, result: 'ok', dryRun: false }),
      ),
    );
    const entries = readAudit();
    expect(entries).toHaveLength(10);
    const tools = new Set(entries.map((e) => e.tool));
    expect(tools.size).toBe(10);
  });
});

describe('readAudit', () => {
  it('returns [] when the file does not exist', () => {
    expect(readAudit({ path: join(tmp, 'missing.jsonl') })).toEqual([]);
  });

  it('skips malformed lines silently', () => {
    writeFileSync(
      auditPath,
      [
        JSON.stringify({
          ts: '2024-01-01T00:00:00.000Z',
          tool: 'a',
          result: 'ok',
          dryRun: false,
        }),
        'not json',
        JSON.stringify({ no: 'schema' }),
        JSON.stringify({
          ts: '2024-01-01T00:00:01.000Z',
          tool: 'b',
          result: 'ok',
          dryRun: false,
        }),
        '',
      ].join('\n'),
    );
    const entries = readAudit();
    expect(entries.map((e) => e.tool)).toEqual(['a', 'b']);
  });

  it('honours tail', async () => {
    for (let i = 0; i < 5; i += 1) {
      await auditLog({ tool: `t${i}`, result: 'ok', dryRun: false });
    }
    const last2 = readAudit({ tail: 2 });
    expect(last2.map((e) => e.tool)).toEqual(['t3', 't4']);
  });
});
