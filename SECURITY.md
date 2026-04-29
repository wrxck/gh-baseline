# Security Policy

## Reporting a vulnerability

Please report security issues privately:

- **Email**: matt@heskethwebdesign.co.uk
- **GitHub**: use the [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) tab on this repo (preferred — keeps everything tracked alongside the codebase).

Please **do not** file a public issue for a vulnerability.

We aim to acknowledge reports within 72 hours and to resolve confirmed issues within 90 days. Coordinated disclosure is appreciated.

## Supported versions

Only the latest minor version of `@matthesketh/gh-baseline` receives security updates. Pin to a recent version and follow the release feed.

## Scope

In scope:

- The `@matthesketh/gh-baseline` MCP server (`src/mcp/`)
- The `gh-baseline` CLI (`src/cli.ts`, `src/commands/`)
- The interactive TUI (`src/tui/`)
- The core layer (`src/core/`) — especially `auth`, `audit`, `allowlist`, `ratelimit`
- Bundled profiles (`src/profiles/`)

Out of scope (please report to the upstream project):

- The GitHub REST API itself — report to GitHub Security.
- Octokit, `@modelcontextprotocol/sdk`, Ink, and other transitive dependencies — report to those projects (we'll coordinate updates here once their fix lands).

## Threat model summary

The MCP surface is intentionally narrower than raw Octokit. The full tier matrix is in the [README](README.md#security-model). The key invariants this project commits to:

- **No Tier-4 (destructive) operation is reachable from the MCP server.** An LLM with `gh-baseline` MCP access cannot delete a repo, archive, transfer ownership, change visibility, or force-push.
- **Every mutation has `dryRun: true` as its default** in the MCP. Persisting requires explicit opt-in.
- **Every mutation goes through the allowlist** — `~/.config/gh-baseline/config.json` declares which repos and orgs are touchable. Default deny.
- **Every mutation is audit-logged** to `~/.config/gh-baseline/audit.jsonl` with timestamp, tool, repo, args, result, and `dryRun` flag. The audit is locally readable and machine-parseable.
- **File changes go via PR**, never direct main pushes. Cooperates with the target repo's branch protection.

If you discover a way to reach a Tier-4 operation through the MCP, that's an in-scope critical issue.

## Audit log

Every MCP and CLI mutation appends one JSONL line to `~/.config/gh-baseline/audit.jsonl`. The file is mode `0600`, written under `proper-lockfile` to handle concurrent CLI/MCP/cron writers. Use `gh-baseline audit` to inspect.

If you suspect compromise, the audit log is the first place to look.
