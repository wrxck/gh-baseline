# Architecture

`gh-baseline` runs as one of three surfaces sharing a single core. This document captures how they fit together and why.

## Three surfaces, one core

```mermaid
flowchart TB
    classDef surface fill:#e3f2fd,stroke:#1976d2,color:#000
    classDef coreNode fill:#fff3e0,stroke:#f57c00,color:#000
    classDef state fill:#f3e5f5,stroke:#7b1fa2,color:#000
    classDef external fill:#e8f5e9,stroke:#388e3c,color:#000

    cli[CLI<br/>src/cli.ts + src/commands/*]:::surface
    tui[Interactive TUI<br/>src/tui/*]:::surface
    mcp[MCP server<br/>src/mcp/server.ts]:::surface

    core[Core<br/>auth · octokit · validate · allowlist<br/>audit · ratelimit · config · errors]:::coreNode
    profiles[Profiles<br/>src/profiles/*]:::coreNode
    checks[Checks<br/>src/checks/*<br/>read-only assessments]:::coreNode
    actors[Actors<br/>src/actors/*<br/>idempotent mutations]:::coreNode

    config[(~/.config/gh-baseline/<br/>config.json + profiles/)]:::state
    audit[(~/.config/gh-baseline/<br/>audit.jsonl)]:::state

    gh[(GitHub REST API)]:::external

    cli --> core
    tui --> core
    mcp --> core

    cli --> checks
    cli --> actors
    tui --> checks
    tui --> actors
    mcp --> checks
    mcp --> actors

    checks --> profiles
    actors --> profiles

    core --> config
    core --> audit
    actors --> audit

    core --> gh
    checks --> gh
    actors --> gh
```

The CLI is for cron and scripting. The TUI is for human composition. The MCP is for Claude Code. They all agree on the same core, the same profiles, and the same audit log.

## The four security tiers

```mermaid
flowchart LR
    classDef tier1 fill:#e8f5e9,stroke:#388e3c,color:#000
    classDef tier2 fill:#fff9c4,stroke:#f9a825,color:#000
    classDef tier3 fill:#ffe0b2,stroke:#ef6c00,color:#000
    classDef tier4 fill:#ffcdd2,stroke:#c62828,color:#000

    t1[Tier 1<br/>Read-only<br/>scans · audits · diffs · doctor]:::tier1
    t2[Tier 2<br/>Idempotent additions<br/>labels · SECURITY.md · Dependabot]:::tier2
    t3[Tier 3<br/>Modifying mutations<br/>branch protection · community files · merge settings]:::tier3
    t4[Tier 4<br/>Destructive<br/>delete · archive · transfer · visibility · force-push]:::tier4

    t1 -.->|"MCP: yes"| mcp[MCP server]
    t2 -.->|"MCP: yes, dryRun=true default"| mcp
    t3 -.->|"MCP: diff-only"| mcp
    t4 -.->|"MCP: never"| mcp

    t1 -.->|"CLI: yes"| cli[CLI]
    t2 -.->|"CLI: --apply to persist"| cli
    t3 -.->|"CLI: --apply to persist"| cli
    t4 -.->|"CLI: --yes-i-am-sure"| cli
```

The classification isn't bureaucratic — it determines what the MCP server is allowed to expose. An LLM with `gh-baseline` access cannot reach a Tier 4 operation no matter what it's told.

## Token + request flow

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as gh-baseline CLI
    participant Core as Core layer
    participant Octo as Octokit (throttled, retried)
    participant GH as GitHub API
    participant Audit as audit.jsonl

    U->>CLI: gh-baseline apply branch-protection foo/bar --apply
    CLI->>Core: loadConfig()
    Core-->>CLI: { allowedRepos, defaultProfile, ... }
    CLI->>Core: getToken(config)
    alt auth.mode === 'gh-cli'
        Core->>Core: spawn 'gh auth token' + 'gh auth status'
    else auth.mode === 'pat'
        Core->>Core: read patPath (mode-check 0600)
        Core->>GH: GET /user (read x-oauth-scopes)
    end
    Core-->>CLI: { token, source, scopes }
    CLI->>Core: requireScopes(scopes, ['repo'])
    CLI->>Core: checkAllowed('foo/bar', config)
    CLI->>Core: createOctokit(token)
    CLI->>Octo: actors.applyBranchProtection({ ... })
    Octo->>GH: GET /repos/foo/bar/branches/main/protection
    GH-->>Octo: 200 { ... current state ... }
    Octo->>Octo: computeProtectionDiff(before, target)
    alt diff is empty
        Octo-->>CLI: { changed: false }
    else dryRun === true
        Octo-->>CLI: { changed: true, diff, after: null }
    else
        Octo->>GH: PUT /repos/foo/bar/branches/main/protection
        GH-->>Octo: 200 { ... new state ... }
        Octo-->>CLI: { changed: true, diff, after }
    end
    CLI->>Audit: append { ts, tool, repo, args, result, dryRun }
    CLI-->>U: pretty diff + outcome
```

The shape is consistent across all actors:

1. Load config, resolve token, check scopes, check allowlist, build octokit.
2. Read current state.
3. Compute diff against profile/target.
4. If empty → no-op (and that's still audit-logged as `result: 'ok'`).
5. If `dryRun` → return the diff without persisting.
6. Else → persist via PUT/PATCH/POST.
7. Append to audit log regardless.

## Profiles: programmatic vs declarative

A profile is the target state of a repo. Two ways to author one:

- **Programmatic** — a TypeScript module under `src/profiles/<id>.ts` exporting a `Profile` object. Bundled with the package, version-controlled in this repo. Used for company defaults and the curated `oss-public` standard.
- **Declarative** — a YAML file under `~/.config/gh-baseline/profiles/<id>.yaml`. Composed via the interactive TUI builder or hand-written. User-specific.

Both validate against the same `ProfileSchema` (zod) at load time. The CLI and the MCP behave identically with either.

```mermaid
flowchart LR
    builder[TUI: profiles new]
    edit[CLI: profiles edit]
    yaml[(~/.config/.../foo.yaml)]
    ts[(src/profiles/foo.ts)]
    schema[zod ProfileSchema]
    runtime[CLI / MCP / TUI<br/>at runtime]

    builder --> yaml
    edit --> yaml
    yaml --> schema
    ts --> schema
    schema --> runtime
```

Why both? TypeScript modules let bundled profiles use full language features (re-export shared label sets, compose). YAML is the right format for user-authored, version-controllable, shareable profiles.

## Why the safeguards are non-negotiable

Each safeguard exists because a different failure mode is otherwise plausible:

- **Allowlist**: an LLM compromise (or a fat-finger) shouldn't be able to touch arbitrary repos by passing different slugs. Default deny.
- **Dry-run by default**: every diff is shown before any write. The user opts in.
- **Audit log**: when something goes wrong, the answer to "what did it do?" must be on disk.
- **PR-not-push**: file changes that go through PR cooperate with the target repo's branch protection rather than bypass it. Direct writes to `main` would be a contradiction of `gh-baseline`'s purpose.
- **Idempotency**: re-running the same `apply` against the same repo must be a no-op. Otherwise drift detection breaks.
- **Scope inspection**: starting up with the wrong scopes is a hard fail, not a silent failure deep inside an operation.
- **Rate limiting**: an LLM that spirals shouldn't be able to spray 1000 API calls.

Drop any one of these and `gh-baseline` becomes "Octokit with chat-friendly wrappers". Keep them all and it's a tool you can hand the keys to without losing sleep.
