import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultSink, setOutputSink, type OutputSink } from '../ui/output.js';
import { auditCommand, buildAuditView, parseDuration } from './audit.js';

let tmp: string;
let originalConfigEnv: string | undefined;
let originalAuditEnv: string | undefined;
let auditPath: string;

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

function writeEntries(entries: object[]): void {
  writeFileSync(
    auditPath,
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    { mode: 0o600 },
  );
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-audit-cli-'));
  auditPath = join(tmp, 'audit.jsonl');
  originalConfigEnv = process.env.GH_BASELINE_CONFIG_PATH;
  originalAuditEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_CONFIG_PATH = join(tmp, 'config.json');
  process.env.GH_BASELINE_AUDIT_PATH = auditPath;
});

afterEach(() => {
  if (originalConfigEnv === undefined) delete process.env.GH_BASELINE_CONFIG_PATH;
  else process.env.GH_BASELINE_CONFIG_PATH = originalConfigEnv;
  if (originalAuditEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = originalAuditEnv;
  rmSync(tmp, { recursive: true, force: true });
  setOutputSink(defaultSink);
});

describe('parseDuration', () => {
  it('parses seconds, minutes, hours, days, weeks', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('1d')).toBe(86_400_000);
    expect(parseDuration('1w')).toBe(7 * 86_400_000);
  });

  it('returns undefined for malformed input', () => {
    expect(parseDuration('garbage')).toBeUndefined();
    expect(parseDuration('15')).toBeUndefined();
    expect(parseDuration('-1h')).toBeUndefined();
  });
});

describe('buildAuditView', () => {
  it('returns empty when log absent', () => {
    const view = buildAuditView();
    expect(view).toEqual({ entries: [], total: 0 });
  });

  it('applies tail (default 20)', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      ts: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
      tool: `t${i}`,
      result: 'ok',
      dryRun: false,
    }));
    writeEntries(entries);
    const view = buildAuditView();
    expect(view.total).toBe(30);
    expect(view.entries).toHaveLength(20);
    expect(view.entries[0]?.tool).toBe('t10');
    expect(view.entries[view.entries.length - 1]?.tool).toBe('t29');
  });

  it('respects an explicit tail value', () => {
    writeEntries([
      { ts: '2024-01-01T00:00:00.000Z', tool: 'a', result: 'ok', dryRun: false },
      { ts: '2024-01-01T00:00:01.000Z', tool: 'b', result: 'ok', dryRun: false },
      { ts: '2024-01-01T00:00:02.000Z', tool: 'c', result: 'ok', dryRun: false },
    ]);
    const view = buildAuditView({ tail: 2 });
    expect(view.entries.map((e) => e.tool)).toEqual(['b', 'c']);
  });

  it('filters by tool and repo', () => {
    writeEntries([
      { ts: '2024-01-01T00:00:00.000Z', tool: 'scan', repo: 'a/x', result: 'ok', dryRun: false },
      { ts: '2024-01-01T00:00:01.000Z', tool: 'apply', repo: 'a/x', result: 'ok', dryRun: false },
      { ts: '2024-01-01T00:00:02.000Z', tool: 'scan', repo: 'b/y', result: 'ok', dryRun: false },
    ]);
    expect(buildAuditView({ tool: 'scan' }).entries).toHaveLength(2);
    expect(buildAuditView({ repo: 'a/x' }).entries).toHaveLength(2);
    expect(buildAuditView({ tool: 'scan', repo: 'b/y' }).entries).toHaveLength(1);
  });

  it('filters by since', () => {
    const now = Date.now();
    const old = new Date(now - 24 * 3_600_000).toISOString();
    const recent = new Date(now - 60_000).toISOString();
    writeEntries([
      { ts: old, tool: 'a', result: 'ok', dryRun: false },
      { ts: recent, tool: 'b', result: 'ok', dryRun: false },
    ]);
    const view = buildAuditView({ since: '15m' });
    expect(view.entries.map((e) => e.tool)).toEqual(['b']);
  });
});

describe('auditCommand', () => {
  it('prints "no audit entries yet" when log empty', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await auditCommand();
    expect(code).toBe(0);
    expect(sink.out.join('')).toContain('no audit entries yet');
  });

  it('emits JSON when --json', async () => {
    writeEntries([
      { ts: '2024-01-01T00:00:00.000Z', tool: 'a', result: 'ok', dryRun: false },
    ]);
    const sink = capture();
    setOutputSink(sink);
    const code = await auditCommand({ json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(sink.out.join(''));
    expect(parsed.total).toBe(1);
    expect(parsed.entries).toHaveLength(1);
  });

  it('prints "no entries match" when filters drop everything', async () => {
    writeEntries([
      { ts: '2024-01-01T00:00:00.000Z', tool: 'a', result: 'ok', dryRun: false },
    ]);
    const sink = capture();
    setOutputSink(sink);
    const code = await auditCommand({ tool: 'nonexistent' });
    expect(code).toBe(0);
    expect(sink.out.join('')).toContain('no entries match');
  });
});
