import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version as string;

const HELP = `gh-baseline v${VERSION} — GitHub account hardening (CLI + MCP)

Usage: gh-baseline <command> [options]

Commands:
  doctor                 Check auth, scopes, config
  init                   First-run setup wizard (auth + allowlist)
  scan <repo>            Scan a repo against the active profile
  scan --all             Scan every allowlisted repo
  apply <op> <repo>      Apply an actor to a repo (default dry-run)
  audit [--tail N]       Show recent audit log entries
  profiles list          List bundled profiles
  profiles show <name>   Print a profile spec
  mcp                    Run as an MCP server over stdio

Global flags:
  --apply                Persist changes (without this, every action is a dry-run)
  --json                 Emit JSON
  --profile <name>       Profile to use (default: oss-public)
  -v, --version          Print version
  -h, --help             Print this help
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

  switch (command) {
    case 'mcp': {
      const { startMcpServer } = await import('./mcp/server.js');
      return startMcpServer();
    }
    // Other commands are wired in by Agent D.
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stdout.write(HELP);
      process.exit(1);
  }
}
