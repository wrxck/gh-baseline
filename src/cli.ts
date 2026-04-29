import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version as string;

const HELP = `gh-baseline v${VERSION} — GitHub account hardening (CLI, interactive TUI, MCP)

Usage: gh-baseline <command> [options]

Commands:
  doctor                       Check auth, scopes, config
  init                         Interactive first-run wizard (auth + allowlist + first profile)
  scan <repo>                  Scan a repo against the active profile
  scan --all                   Scan every allowlisted repo
  scan --interactive           TUI dashboard: scan + drill-down
  apply <op> <repo>            Apply an actor to a repo (default dry-run)
  audit [--tail N]             Show recent audit log entries
  profiles list                List available profiles
  profiles show <name>         Print a profile spec
  profiles new                 Interactive profile builder (Ink TUI)
  profiles edit <name>         Open an existing profile in the builder
  profiles export <name>       Print profile as YAML for sharing/checking-in
  tui                          Open the full interactive dashboard
  mcp                          Run as an MCP server over stdio

Global flags:
  --apply                      Persist changes (without this, every action is a dry-run)
  --json                       Emit JSON
  --profile <name>             Profile to use (default: oss-public)
  --interactive                Open the TUI for this command (where supported)
  -v, --version                Print version
  -h, --help                   Print this help

Profiles can be defined two ways:
  1. Programmatic — TypeScript modules under src/profiles/ (in this package) or
     ~/.config/gh-baseline/profiles/*.ts (user-defined). Bundled: oss-public.
  2. Declarative — YAML at ~/.config/gh-baseline/profiles/*.yaml. Composed via
     'profiles new' or written by hand. Both forms validate against the same
     zod schema and behave identically.

The interactive builder ('profiles new', 'tui') produces a YAML file you can
commit to a config repo, version-control, and share across machines.
`;

export async function run(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const command = args[0];

  if (args.includes('-v') || args.includes('--version')) {
    process.stdout.write(VERSION + '\n');
    return;
  }
  if (!command || args.includes('-h') || args.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }

  const json = args.includes('--json');

  switch (command) {
    case 'mcp': {
      const { startMcpServer } = await import('./mcp/server.js');
      return startMcpServer();
    }
    case 'tui': {
      const { launchTui } = await import('./tui/app.js');
      return launchTui();
    }
    case 'doctor': {
      const { doctor } = await import('./commands/doctor.js');
      const code = await doctor({ json });
      if (code !== 0) process.exit(code);
      return;
    }
    case 'init': {
      const { init } = await import('./commands/init.js');
      const force = args.includes('--force');
      const code = await init({ json, force });
      if (code !== 0) process.exit(code);
      return;
    }
    case 'audit': {
      const { auditCommand } = await import('./commands/audit.js');
      const tail = readNumberFlag(args, '--tail');
      const since = readStringFlag(args, '--since');
      const tool = readStringFlag(args, '--tool');
      const repo = readStringFlag(args, '--repo');
      const code = await auditCommand({
        json,
        ...(tail !== undefined ? { tail } : {}),
        ...(since !== undefined ? { since } : {}),
        ...(tool !== undefined ? { tool } : {}),
        ...(repo !== undefined ? { repo } : {}),
      });
      if (code !== 0) process.exit(code);
      return;
    }
    case 'profiles': {
      const sub = args[1];
      const { profilesList, profilesShow, profilesPlaceholder } = await import(
        './commands/profiles.js'
      );
      if (sub === undefined || sub === 'list') {
        const code = await profilesList({ json });
        if (code !== 0) process.exit(code);
        return;
      }
      if (sub === 'show') {
        const id = args[2];
        if (!id) {
          process.stderr.write('Usage: gh-baseline profiles show <id>\n');
          process.exit(1);
        }
        const code = await profilesShow(id, { json });
        if (code !== 0) process.exit(code);
        return;
      }
      if (sub === 'new' || sub === 'edit') {
        const code = await profilesPlaceholder(sub);
        if (code !== 0) process.exit(code);
        return;
      }
      process.stderr.write(`Unknown profiles subcommand: ${sub}\n`);
      process.exit(1);
      return;
    }
    case 'scan': {
      const { scanCommand } = await import('./commands/scan.js');
      await scanCommand(args.slice(1));
      return;
    }
    // 'apply' is wired in by feat/apply-branch-protection (#14).
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stdout.write(HELP);
      process.exit(1);
  }
}

/** Read `--flag value` or `--flag=value` from argv. */
function readStringFlag(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === flag) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) return next;
      return undefined;
    }
    if (a !== undefined && a.startsWith(flag + '=')) {
      return a.slice(flag.length + 1);
    }
  }
  return undefined;
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const raw = readStringFlag(args, flag);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
