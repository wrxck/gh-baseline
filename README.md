# gh-baseline

[![CI](https://github.com/wrxck/gh-baseline/actions/workflows/ci.yml/badge.svg)](https://github.com/wrxck/gh-baseline/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@matthesketh/gh-baseline.svg)](https://www.npmjs.com/package/@matthesketh/gh-baseline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-blue.svg)](https://nodejs.org/)

> Profile-driven, idempotent, security-first GitHub account hardening — CLI, interactive TUI, and MCP server.

`gh-baseline` brings every repository in a GitHub account up to a consistent standard
(branch protection, security features, community files, CI workflows, badges, labels) and
keeps it there. It does the same job for GitHub that
[`fleet`](https://github.com/wrxck/fleet) does for Docker apps, or that a hardening MCP
does for a Cloudflare account.

It runs three ways:

- **CLI** — for cron, scripts, automation. Programmatic and deterministic: same input, same output.
- **Interactive TUI** (Ink-based) — for the parts that need human composition: building a new profile, triaging which violations to apply, drilling into scan results.
- **MCP server** — for Claude Code. The MCP surface is purely programmatic and **deliberately narrower than raw Octokit**: the LLM never gets the keys to the kingdom.

## Design principle: programmatic where it's deterministic, interactive where it's not

Most of what `gh-baseline` does is deterministic: given a profile spec and a repo,
the diff, the apply, the audit-log entry are all functions of the inputs. Those
operations live in the CLI and the MCP and never need a human in the loop.

The TUI exists for the genuinely creative parts:

- composing a new profile (`gh-baseline profiles new`)
- editing an existing profile (`gh-baseline profiles edit <name>`)
- drilling into a multi-repo scan and choosing which violations to fix
  (`gh-baseline scan --interactive`)
- reverse-engineering a profile from a well-tended repo (`gh-baseline profiles reverse <repo>`)

The TUI's output is always a YAML/TS profile file you can commit to a config repo.
After that, every subsequent run is programmatic: `gh-baseline apply <profile> <repo>`
behaves identically whether invoked from a terminal, a cron job, or an MCP tool.

## Why this exists

A typical GitHub account accumulates dozens of repos, each with its own drift:
inconsistent branch protection, missing `SECURITY.md`, no Dependabot, stale labels, no
CI for some, untested workflows, READMEs without badges. Fixing this by hand is tedious
and the work decays the moment a new repo is created.

`gh-baseline` defines the *target state* as a profile (a YAML/TS spec), scans every repo
against it, and applies the missing pieces idempotently. Re-running is always safe.

## Security model

The MCP exposes operations in tiers; the LLM only ever interacts with the safe ones.

| Tier | What | LLM access | CLI access |
|------|------|-----------|------------|
| **1 — Read-only** | scans, audits, diffs, list, doctor | yes | yes |
| **2 — Idempotent additions** | apply standard labels, add `SECURITY.md`, enable Dependabot, set repo description/topics | yes (`dryRun=true` default) | yes (`--apply` to persist) |
| **3 — Mutating modifications** | replace branch protection rules, modify community files, change merge settings | diff-only via MCP | yes (`--apply`) |
| **4 — Destructive / irreversible** | delete, archive, transfer, change visibility, force-push | **never** in MCP | CLI-only with `--yes-i-am-sure` |

Cross-cutting safeguards on every tier:

- **Allowlist** — `~/.config/gh-baseline/config.json` declares which repos and orgs are touchable. Default deny. Wildcard requires `unsafe_allow_all: true`.
- **Audit log** — every mutation appended to `~/.config/gh-baseline/audit.jsonl` with timestamp, tool, repo, args, result, and `dryRun` flag.
- **Rate limiting** — Octokit throttling + per-tool per-minute cap to stop runaway loops.
- **PR-not-push** — file changes always go via PR against the default branch; never direct main pushes.
- **Idempotency** — every `apply_*` actor is `read → diff → no-op-if-empty → minimal change`. Re-runs are safe.
- **Strict zod schemas** — every MCP tool argument is validated; `assertRepoSlug`, `assertBranchName`, etc.
- **Token-scope inspection** — at startup the server inspects the PAT's scopes and refuses to run with insufficient scope (errors) or with excessive scope where the user can grant a fine-grained PAT instead (warns).

## Installation

```bash
npm install -g @matthesketh/gh-baseline
gh-baseline init   # interactive: auth + allowlist + first profile
gh-baseline doctor # verify auth, scopes, config
```

## Usage

```bash
# scan one repo against the strictest bundled profile
gh-baseline scan owner/repo --profile oss-public

# scan every allowlisted repo, summary table
gh-baseline scan --all

# show the diff between current branch protection and the profile
gh-baseline apply branch-protection owner/repo --profile oss-public

# actually apply (the absence of --apply is dry-run)
gh-baseline apply branch-protection owner/repo --profile oss-public --apply

# inspect what's been applied
gh-baseline audit --tail 50

# list bundled profiles
gh-baseline profiles list
gh-baseline profiles show oss-public
```

## MCP usage

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "gh-baseline": {
      "command": "gh-baseline",
      "args": ["mcp"]
    }
  }
}
```

Then in Claude Code:

> "Scan all my Node libraries against the `library` profile and tell me which ones are missing branch protection."

## Profiles

Profiles are declarative — they say what a repo *should* look like, not how to get there.

Bundled in `0.1.0`:

- `oss-public` — strictest, for public OSS projects (every safeguard on).
- `library` *(roadmap)* — publishable npm/library standard.
- `application` *(roadmap)* — internal deployable app standard.
- `personal` *(roadmap)* — relaxed standard for scratch repos.

Custom profiles are TS files exported from `src/profiles/` (or, post-MVP, YAML in
`~/.config/gh-baseline/profiles/`).

## Roadmap (the iceberg)

`0.1.0` is the foundation: scan + branch protection apply + the security spine.
The rest is layered on as separate releases — each new actor goes through the same
tier classification, dry-run-by-default, and audit treatment.

### Repo hygiene
- Apply community files (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, PR/issue templates) via PR
- README badges (CI, license, npm, coverage, OSSF Scorecard) injected idempotently
- `CODEOWNERS`, `.editorconfig`, `FUNDING.yml`
- Standard label set (`bug`, `enhancement`, `good first issue`, `security`, `breaking`)
- `CHANGELOG.md` scaffolding (release-please)

### CI/CD
- Test workflow application (per-profile Node matrix)
- CodeQL setup
- Dependabot version + security updates
- Workflow SHA-pinning enforcement
- Auto-merge for Dependabot patch/minor PRs

### Security posture
- Dependabot alerts + security updates + push protection
- Secret scanning + custom patterns
- Private vulnerability reporting
- Required signed commits (per-profile)
- Org-wide 2FA enforcement

### Branch & merge policy
- Profile-driven branch protection rules
- Auto-delete merged branches
- Linear history
- `CODEOWNERS`-driven required reviewers
- Required PR conversation resolution

### Account / org level
- Profile README setup, pinned-repo curation
- Org settings audit (member privileges, third-party access)
- Outside-collaborator audit
- Org secrets / vars audit (names only — never values)
- Webhook audit

### Cross-cutting reports
- OSSF Scorecard run + delta tracking
- Profile-compliance report
- Drift report (repos that have drifted since last `apply`)
- Stale issue / PR triage
- Aggregate dependency report

### Bulk + lifecycle
- Bulk apply profile to N repos with per-repo confirmation
- New-repo auto-onboarding hook
- Archive stale repos with grace period
- Cross-org transfer (CLI-only, multiple confirmations)
- Reverse-engineer: extract a profile spec from an existing well-tended repo

### Integrations *(later, behind feature flags)*
- Linear / Jira / Notion sync for issue triage
- Slack / Telegram / iMessage alerts
- Wiki content sync from a `docs/` folder

## Development

```bash
git clone https://github.com/wrxck/gh-baseline.git
cd gh-baseline
npm install
npm test
npm run build
```

The codebase mirrors [`fleet`](https://github.com/wrxck/fleet)'s conventions: strict
TypeScript, ES modules, `vitest` with 1:1 file pairing, zod-validated boundaries,
`execSafe`-style spawn wrappers, MCP server in `src/mcp/server.ts`.

## License

MIT — see [LICENSE](LICENSE).
