import { existsSync } from 'node:fs';

import {
  configPath,
  defaultConfig,
  loadConfig,
  saveConfig,
  type Config,
} from '../core/config.js';
import { c, heading, info, success, warn, plain } from '../ui/output.js';

export interface InitOptions {
  force?: boolean;
  json?: boolean;
}

export interface InitResult {
  path: string;
  created: boolean;
  overwritten: boolean;
  alreadyExisted: boolean;
  config: Config;
}

/**
 * Non-interactive initialiser.
 *
 * - If config exists and `--force` not passed: prints a summary, returns
 *   `alreadyExisted: true`.
 * - If config doesn't exist: writes `defaultConfig()` and prints next steps.
 * - With `--force`: overwrites any existing config with the defaults.
 *
 * The interactive Ink wizard is delivered separately in v0.2.0.
 */
export async function init(opts: InitOptions = {}): Promise<number> {
  const path = configPath();
  const exists = existsSync(path);

  let result: InitResult;
  if (exists && !opts.force) {
    let cfg: Config;
    try {
      cfg = loadConfig();
    } catch {
      cfg = defaultConfig();
    }
    result = {
      path,
      created: false,
      overwritten: false,
      alreadyExisted: true,
      config: cfg,
    };
    if (opts.json) {
      plain(JSON.stringify(result, null, 2));
      return 0;
    }
    heading('gh-baseline init');
    info(`config already exists at ${path}`);
    info(`default profile: ${cfg.defaultProfile}`);
    info(`allowed repos: ${cfg.allowedRepos.length}`);
    info(`allowed orgs: ${cfg.allowedOrgs.length}`);
    info(`auth mode: ${cfg.auth.mode}`);
    info(`use ${c.cyan}--force${c.reset} to overwrite (your existing settings will be lost)`);
    return 0;
  }

  if (exists && opts.force) {
    warn(`overwriting existing config at ${path}`);
  }

  const cfg = defaultConfig();
  saveConfig(cfg);

  result = {
    path,
    created: !exists,
    overwritten: exists,
    alreadyExisted: false,
    config: cfg,
  };

  if (opts.json) {
    plain(JSON.stringify(result, null, 2));
    return 0;
  }

  heading('gh-baseline init');
  success(`wrote default config to ${path}`);
  info('next steps:');
  plain(`  1. Run ${c.cyan}gh auth login${c.reset} if you haven't already`);
  plain(`  2. Edit ${path} to add ${c.cyan}allowedRepos${c.reset} or ${c.cyan}allowedOrgs${c.reset}`);
  plain(`  3. Run ${c.cyan}gh-baseline doctor${c.reset} to verify`);
  return 0;
}
