import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ConfigSchema,
  configPath,
  defaultAuditPath,
  defaultConfig,
  defaultProfilesDir,
  loadConfig,
  saveConfig,
} from './config.js';
import { ConfigError } from './errors.js';

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gh-baseline-config-'));
  originalEnv = process.env.GH_BASELINE_CONFIG_PATH;
  process.env.GH_BASELINE_CONFIG_PATH = join(tmp, 'config.json');
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GH_BASELINE_CONFIG_PATH;
  else process.env.GH_BASELINE_CONFIG_PATH = originalEnv;
  rmSync(tmp, { recursive: true, force: true });
});

describe('defaultConfig', () => {
  it('produces a fully-defaulted config matching the schema', () => {
    const cfg = defaultConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.defaultProfile).toBe('oss-public');
    expect(cfg.allowedRepos).toEqual([]);
    expect(cfg.allowedOrgs).toEqual([]);
    expect(cfg.unsafeAllowAll).toBe(false);
    expect(cfg.auth.mode).toBe('gh-cli');
    expect(cfg.rateLimit.perMinute).toBe(100);
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });
});

describe('configPath', () => {
  it('respects GH_BASELINE_CONFIG_PATH', () => {
    expect(configPath()).toBe(join(tmp, 'config.json'));
  });

  it('falls back to ~/.config/gh-baseline/config.json', () => {
    delete process.env.GH_BASELINE_CONFIG_PATH;
    expect(configPath()).toMatch(/\.config\/gh-baseline\/config\.json$/);
  });
});

describe('loadConfig', () => {
  it('returns defaults when the file does not exist', () => {
    const cfg = loadConfig();
    expect(cfg).toEqual(defaultConfig());
  });

  it('parses a valid config from disk', () => {
    writeFileSync(
      configPath(),
      JSON.stringify({
        version: 1,
        defaultProfile: 'oss-public',
        allowedRepos: ['acme/widgets'],
        allowedOrgs: ['octolab'],
        unsafeAllowAll: false,
        auth: { mode: 'pat', patPath: '/etc/gh-baseline/token' },
        rateLimit: { perMinute: 30 },
        paths: { audit: '/tmp/x.jsonl' },
      }),
    );
    const cfg = loadConfig();
    expect(cfg.allowedRepos).toEqual(['acme/widgets']);
    expect(cfg.auth.mode).toBe('pat');
    expect(cfg.auth.patPath).toBe('/etc/gh-baseline/token');
    expect(cfg.rateLimit.perMinute).toBe(30);
    expect(cfg.paths.audit).toBe('/tmp/x.jsonl');
  });

  it('fills in missing fields with defaults', () => {
    writeFileSync(configPath(), JSON.stringify({ allowedRepos: ['a/b'] }));
    const cfg = loadConfig();
    expect(cfg.allowedRepos).toEqual(['a/b']);
    expect(cfg.defaultProfile).toBe('oss-public');
    expect(cfg.auth.mode).toBe('gh-cli');
  });

  it('throws ConfigError on malformed JSON', () => {
    writeFileSync(configPath(), '{not json');
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it('throws ConfigError on schema violations', () => {
    writeFileSync(
      configPath(),
      JSON.stringify({ version: 99, rateLimit: { perMinute: -5 } }),
    );
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it('rejects unknown auth.mode values', () => {
    writeFileSync(configPath(), JSON.stringify({ auth: { mode: 'oauth' } }));
    expect(() => loadConfig()).toThrow(ConfigError);
  });
});

describe('saveConfig', () => {
  it('creates the parent dir, writes atomically, and ends up at mode 0600', () => {
    const path = configPath();
    saveConfig({ ...defaultConfig(), allowedOrgs: ['acme'] });
    const stat = statSync(path);
    // mask perm bits
    expect(stat.mode & 0o777).toBe(0o600);
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.allowedOrgs).toEqual(['acme']);
    expect(onDisk.version).toBe(1);
  });

  it('round-trips through loadConfig', () => {
    const original = {
      ...defaultConfig(),
      allowedRepos: ['a/b', 'c/d'],
      rateLimit: { perMinute: 7 },
    };
    saveConfig(original);
    expect(loadConfig()).toEqual(original);
  });

  it('refuses to save an invalid config', () => {
    const bad = { ...defaultConfig(), rateLimit: { perMinute: 0 } };
    expect(() => saveConfig(bad)).toThrow();
  });
});

describe('defaultAuditPath / defaultProfilesDir', () => {
  it('point under ~/.config/gh-baseline', () => {
    expect(defaultAuditPath()).toMatch(/\.config\/gh-baseline\/audit\.jsonl$/);
    expect(defaultProfilesDir()).toMatch(/\.config\/gh-baseline\/profiles$/);
  });
});
