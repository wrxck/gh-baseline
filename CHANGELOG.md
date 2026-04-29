# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial scaffold with strict TypeScript, ES modules, vitest, MCP SDK 1.29.0.
- `src/core/` foundation: `errors`, `validate`, `config`, `allowlist`, `auth`, `octokit`, `audit`, `ratelimit`. 88 unit tests.
- Read-only scan pipeline: `gh_baseline_scan_repo` MCP tool + `gh-baseline scan` CLI.
- First mutating actor: `gh_baseline_apply_branch_protection` (dry-run by default) + `gh-baseline apply branch-protection`.
- Bundled `oss-public` profile (strictest reasonable OSS standard).
- CLI verbs: `doctor`, `init`, `audit`, `profiles list`, `profiles show`, `tui`, `mcp`.
- Interactive Ink-based TUI: dashboard, profile builder (10-step wizard), profile list, profile detail, audit viewer.
- CI workflows pinned to commit SHAs from day 1; `publish.yml` gates on `ci.yml` success for the release commit.

## [0.1.0] - TBD

First release — see Unreleased above. Will be cut once all MVP feature branches merge to `develop` and a release PR `develop → main` is opened.
