# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(no unreleased changes yet)

## [0.1.0] - 2026-04-29

The first release — foundation, profile-driven scanning, the first mutating actor, the interactive TUI, and the documentation/security scaffolding to support all of it.

### Added

#### Core layer
- `src/core/errors.ts` — `GhBaselineError` base + 7 typed subclasses with stable exit codes.
- `src/core/validate.ts` — strict regex validators for owner / repo name / repo slug / branch / label / topic.
- `src/core/config.ts` — zod-validated config at `~/.config/gh-baseline/config.json`. Atomic writes; mode 0600.
- `src/core/allowlist.ts` — repo/org allowlist enforcement; `unsafeAllowAll` opt-in.
- `src/core/auth.ts` — gh-CLI piggyback + fine-grained PAT modes; injectable `runCmd` for testability; scope inspection.
- `src/core/octokit.ts` — Octokit factory wired with `@octokit/plugin-throttling` + `@octokit/plugin-retry`; version-stamped User-Agent.
- `src/core/audit.ts` — JSONL audit log with `proper-lockfile` for concurrent writers; `tool / repo / args / result / dryRun` shape.
- `src/core/ratelimit.ts` — in-process token bucket with promise-queue serialisation.

#### Profile system
- `src/profiles/types.ts` — `Profile` zod schema covering metadata / community files / branch protection / security features / repo settings / labels / CI policy.
- `src/profiles/oss-public.ts` — bundled strict-OSS profile.
- `src/profiles/index.ts` — `getProfile(id)` + `listBundledProfiles()`.

#### Read-only scan pipeline
- `src/checks/{repo-metadata,community-files,branch-protection,security-features,repo-settings,labels}.ts` — six baseline checks, each returning a structured `CheckResult`.
- `src/checks/index.ts` — `runChecks(octokit, repoSlug, profile)` orchestrator.
- CLI: `gh-baseline scan <repo> [--all] [--profile <id>] [--json]`.
- MCP: `gh_baseline_scan_repo`, `gh_baseline_diff_against_profile`.

#### First mutating actor (Tier 3)
- `src/actors/apply-branch-protection.ts` — pure `computeProtectionDiff` + I/O `applyBranchProtection`. Idempotent (re-runs return `changed: false`); 404 on read treated as `before: null`.
- CLI: `gh-baseline apply branch-protection <repo> [--branch <name>] [--profile <id>] [--apply] [--json] [--strict]`.
- MCP: `gh_baseline_apply_branch_protection` (default `dryRun: true`), `gh_baseline_diff_branch_protection` (forces dry-run).

#### Supporting CLI verbs (Tier 1)
- `gh-baseline doctor` — auth + scopes + allowlist reachability.
- `gh-baseline init [--force]` — bootstrap default config.
- `gh-baseline audit [--tail N] [--since 15m|1h|24h|7d|1w] [--tool X] [--repo owner/name] [--json]`.
- `gh-baseline profiles list|show <id>`. `profiles new|edit` placeholder for v0.2.0 TUI integration.
- MCP: `gh_baseline_doctor`, `gh_baseline_audit_tail`, `gh_baseline_list_profiles`.

#### Interactive TUI
- Ink-based dashboard, profile list, profile detail, audit viewer.
- 10-step ProfileBuilder wizard with steps 1 (identity), 2 (metadata), 4 (branch protection), 9 (review), 10 (export YAML to `~/.config/gh-baseline/profiles/<id>.yaml`) fully implemented. Steps 3, 5–8 stubbed for v0.2.0.
- `src/tui/profile-store.ts` — read/write user-defined YAML profiles.

#### Documentation
- `README.md` — vision, security model (four tiers), iceberg roadmap.
- `CONTRIBUTING.md` — workflow, conventional commits, tier-classification rule for new actors.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 reference + maintainer contact.
- `SECURITY.md` — private vuln reporting, scope, threat-model summary.
- `docs/architecture.md` — three mermaid diagrams (three surfaces, four tiers, request flow).
- `docs/profiles.md` — programmatic vs declarative authoring; full TS + YAML examples.
- `docs/threat-model.md` — 10-row threat table with per-threat mitigations.

#### Project hygiene
- CI workflows (`ci.yml`, `publish.yml`) pinned to commit SHAs (`actions/checkout@b4ffde65...` v4.1.1, `actions/setup-node@49933ea5...` v4.4.0).
- `publish.yml` gates on `ci.yml` success for the release commit before running `npm publish`.
- Branch protection on `main` and `develop`: required PR, required `build-and-test (20)` + `build-and-test (22)`, no force-push, no deletion, conversation resolution required.
- `dependabot.yml` configured to skip major-version bumps until v0.1.0 ships (this release flips that off).
- `.editorconfig`, `.github/{CODEOWNERS, PULL_REQUEST_TEMPLATE.md, ISSUE_TEMPLATE/{bug,feature}.md, FUNDING.yml}`.

### Test posture

- **241 tests** across 31 files: 88 (core) + 32 (scan) + 31 (apply-branch-protection) + 37 (CLI verbs) + 22 (TUI) + 31 (integration / cross-cutting).
- Strict TypeScript everywhere; no `any`, no `// @ts-ignore`.
- 1:1 file pairing throughout.
- Node 20 + 22 matrix on every PR.

### Notes

- This release does not include destructive (Tier 4) operations. Delete / archive / transfer / visibility / force-push are explicitly out of scope for the MCP surface.
- Five of the ten ProfileBuilder wizard steps are stubbed; the remaining categories (community files, security features, repo settings, labels, CI policy) ship in v0.2.0 alongside their own actors.
- The actor's `BranchProtectionRule` is intentionally a superset of the profile schema's. Aligning the two to GitHub's full PUT body shape is a v0.2.0 task.
