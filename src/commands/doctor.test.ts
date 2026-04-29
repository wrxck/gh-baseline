import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedToken } from '../core/auth.js';
import { defaultConfig, saveConfig } from '../core/config.js';
import { defaultSink, setOutputSink, type OutputSink } from '../ui/output.js';
import { bucketScopes, buildDoctorReport, doctor } from './doctor.js';

let tmp: string;
let originalConfigEnv: string | undefined;
let originalAuditEnv: string | undefined;

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

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-doctor-'));
  originalConfigEnv = process.env.GH_BASELINE_CONFIG_PATH;
  originalAuditEnv = process.env.GH_BASELINE_AUDIT_PATH;
  process.env.GH_BASELINE_CONFIG_PATH = join(tmp, 'config.json');
  process.env.GH_BASELINE_AUDIT_PATH = join(tmp, 'audit.jsonl');
});

afterEach(() => {
  if (originalConfigEnv === undefined) delete process.env.GH_BASELINE_CONFIG_PATH;
  else process.env.GH_BASELINE_CONFIG_PATH = originalConfigEnv;
  if (originalAuditEnv === undefined) delete process.env.GH_BASELINE_AUDIT_PATH;
  else process.env.GH_BASELINE_AUDIT_PATH = originalAuditEnv;
  rmSync(tmp, { recursive: true, force: true });
  setOutputSink(defaultSink);
});

describe('bucketScopes', () => {
  it('classifies common scopes', () => {
    const b = bucketScopes(['repo', 'read:org', 'admin:org', 'foo:bar']);
    expect(b.write).toContain('repo');
    expect(b.read).toContain('read:org');
    expect(b.admin).toContain('admin:org');
    expect(b.other).toContain('foo:bar');
  });
});

describe('buildDoctorReport', () => {
  it('marks ok=false when config is missing', async () => {
    const report = await buildDoctorReport({
      deps: {
        resolveToken: async (): Promise<ResolvedToken> => ({
          token: 't',
          source: 'gh-cli',
          scopes: [],
        }),
      },
    });
    expect(report.ok).toBe(false);
    expect(report.config.exists).toBe(false);
    expect(report.config.error).toMatch(/init/);
  });

  it('marks ok=true when config valid, auth resolved, no allowed repos', async () => {
    saveConfig(defaultConfig());
    const report = await buildDoctorReport({
      deps: {
        resolveToken: async (): Promise<ResolvedToken> => ({
          token: 't',
          source: 'gh-cli',
          scopes: ['repo'],
        }),
      },
    });
    expect(report.ok).toBe(true);
    expect(report.config.valid).toBe(true);
    expect(report.auth.scopes).toEqual(['repo']);
    expect(report.auth.buckets.write).toContain('repo');
    expect(report.allowedRepos.total).toBe(0);
  });

  it('probes allowed repos via the injected octokit factory', async () => {
    saveConfig({
      ...defaultConfig(),
      allowedRepos: ['acme/widgets', 'ghost/missing'],
    });
    const calls: string[] = [];
    const report = await buildDoctorReport({
      deps: {
        resolveToken: async (): Promise<ResolvedToken> => ({
          token: 't',
          source: 'gh-cli',
          scopes: ['repo'],
        }),
        octokitFactory: () => {
          const request = async (
            route: string,
            params: { owner: string; repo: string },
          ): Promise<{ status: number; data: unknown }> => {
            calls.push(`${route} ${params.owner}/${params.repo}`);
            if (params.repo === 'missing') {
              const e = new Error('Not Found') as Error & { status: number };
              e.status = 404;
              throw e;
            }
            return { status: 200, data: {} };
          };
          return { request } as unknown as Pick<
            import('@octokit/rest').Octokit,
            'request'
          >;
        },
      },
    });
    expect(calls).toEqual([
      'GET /repos/{owner}/{repo} acme/widgets',
      'GET /repos/{owner}/{repo} ghost/missing',
    ]);
    expect(report.allowedRepos.reachable).toBe(1);
    expect(report.allowedRepos.unreachable).toBe(1);
    expect(report.ok).toBe(false);
  });

  it('records audit entry count', async () => {
    saveConfig(defaultConfig());
    writeFileSync(
      join(tmp, 'audit.jsonl'),
      [
        JSON.stringify({
          ts: '2024-01-01T00:00:00.000Z',
          tool: 'a',
          result: 'ok',
          dryRun: false,
        }),
        JSON.stringify({
          ts: '2024-01-02T00:00:00.000Z',
          tool: 'b',
          result: 'ok',
          dryRun: false,
        }),
      ].join('\n') + '\n',
    );
    const report = await buildDoctorReport({
      deps: {
        resolveToken: async (): Promise<ResolvedToken> => ({
          token: 't',
          source: 'gh-cli',
          scopes: [],
        }),
      },
    });
    expect(report.audit.entries).toBe(2);
  });
});

describe('doctor (CLI entrypoint)', () => {
  it('emits JSON and returns 0 when healthy', async () => {
    saveConfig(defaultConfig());
    const sink = capture();
    setOutputSink(sink);
    const code = await doctor({
      json: true,
      deps: {
        resolveToken: async (): Promise<ResolvedToken> => ({
          token: 't',
          source: 'gh-cli',
          scopes: ['repo'],
        }),
      },
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(sink.out.join(''));
    expect(parsed.ok).toBe(true);
    expect(parsed.auth.scopes).toEqual(['repo']);
  });

  it('returns 1 when config missing', async () => {
    const sink = capture();
    setOutputSink(sink);
    const code = await doctor({
      json: true,
      deps: {
        resolveToken: async (): Promise<ResolvedToken> => ({
          token: 't',
          source: 'gh-cli',
          scopes: [],
        }),
      },
    });
    expect(code).toBe(1);
  });
});
