# Contributing

Thanks for your interest. This project is opinionated about its security posture, so contributions go through a tier classification before they land. The bar isn't high — it's just explicit.

## Setup

```bash
git clone https://github.com/wrxck/gh-baseline.git
cd gh-baseline
npm install
npm test
npm run build
```

Node `>=20` (matrix tested on 20 + 22). TypeScript strict, ES modules, vitest.

## Workflow

1. Branch from `develop`, never from `main`.
2. Branch names: `feat/<thing>`, `fix/<thing>`, `chore/<thing>`, `docs/<thing>`.
3. Conventional commits — `type(scope): description`.
4. Stage specific files; never `git add .` or `-A`.
5. PRs target `develop`. `main` is updated only at release time.
6. No force-push, no `--no-verify`, no Co-Authored-By trailers.
7. If a hook fails, fix the underlying issue rather than bypassing it.

## Tier classification (required for any new actor or MCP tool)

Every PR that adds a capability must declare which tier it belongs to:

- **Tier 1** — read-only (scans, audits, diffs, list, doctor). MCP-callable.
- **Tier 2** — idempotent additions (apply standard labels, add `SECURITY.md`, enable Dependabot). MCP-callable with `dryRun: true` default.
- **Tier 3** — modifying mutations (replace branch protection, modify community files). MCP returns diffs only; CLI applies with `--apply`.
- **Tier 4** — destructive / irreversible (delete, archive, transfer, change visibility, force-push). CLI-only with `--yes-i-am-sure`. **Never MCP.**

See [README.md → Security model](README.md#security-model) for the full table.

A new tool that doesn't fit cleanly into a tier should pause for design discussion before implementation.

## Adding a bundled profile

A profile is a TypeScript module under `src/profiles/<id>.ts` that exports a `Profile` value (the type lives in `src/profiles/types.ts`). The shape is zod-validated at import.

1. Pick a stable `id` matching `^[a-z][a-z0-9-]{0,40}$`.
2. Specify every category (metadata, community, branchProtection, securityFeatures, repoSettings, labels, ci) — `unspecified` is a valid policy where you don't want to enforce.
3. Add a unit test that asserts the profile parses against `ProfileSchema`.
4. Update the README's "Profiles" section.

Custom profiles for individual users live at `~/.config/gh-baseline/profiles/<id>.yaml` and are loaded at runtime.

## Tests

- Vitest, 1:1 file pairing (`src/foo.ts` ↔ `src/foo.test.ts`).
- Don't mock `node:fs` at the module level — use `mkdtempSync` + cleanup.
- For Octokit, use the injection seam in `src/core/octokit.ts`.
- For shell-out tests (`src/core/auth.ts`), use the injectable `runCmd` argument.
- Aim for ≥ 70% statement coverage on `src/core/`. The TUI is exempt — focus there on reducer + zod tests.

## Security

If you find a security issue, please follow [SECURITY.md](SECURITY.md). Don't open a public issue.

## Code of conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
