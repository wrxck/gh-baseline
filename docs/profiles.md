# Profiles

A profile is the **target state** of a repo. Scans compare a repo against a profile and report drift; actors apply the profile and bring the repo into alignment. Profiles never change at runtime — they're frozen specs you check into version control.

## Two formats

### Programmatic (TypeScript)

Bundled profiles ship with the package as TypeScript modules under `src/profiles/`. They get the full strictness of `tsc` and can re-export shared definitions (label sets, branch-protection rules, etc.).

`src/profiles/oss-public.ts`:

```ts
import type { Profile } from './types.js';
import { standardLabels } from './shared/labels.js';

export const ossPublicProfile: Profile = {
  id: 'oss-public',
  name: 'OSS Public',
  description: 'Strictest reasonable standard for public open-source projects.',

  metadata: {
    description: { policy: 'required' },
    homepage: { policy: 'optional' },
    topics: { policy: 'required', minCount: 1 },
    license: { policy: 'required', allowed: ['mit', 'apache-2.0', 'bsd-3-clause'] },
  },

  community: {
    readme: { policy: 'required' },
    contributing: { policy: 'required' },
    codeOfConduct: { policy: 'required' },
    securityPolicy: { policy: 'required' },
    prTemplate: { policy: 'required' },
    issueTemplates: { policy: 'required' },
    codeowners: { policy: 'required' },
  },

  branchProtection: {
    branches: {
      main: {
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
          require_code_owner_reviews: false,
        },
        required_status_checks: {
          strict: true,
          checks: [
            { context: 'build-and-test (20)' },
            { context: 'build-and-test (22)' },
          ],
        },
        enforce_admins: false,
        required_conversation_resolution: true,
        allow_force_pushes: false,
        allow_deletions: false,
      },
    },
  },

  securityFeatures: {
    dependabotAlerts: 'enabled',
    dependabotSecurityUpdates: 'enabled',
    secretScanning: 'enabled',
    secretScanningPushProtection: 'enabled',
    vulnerabilityReporting: 'enabled',
  },

  repoSettings: {
    allowSquashMerge: true,
    allowMergeCommit: false,
    allowRebaseMerge: false,
    allowAutoMerge: true,
    deleteBranchOnMerge: true,
    defaultBranch: 'main',
  },

  labels: {
    policy: 'superset',
    entries: standardLabels,
  },

  ci: {
    testWorkflow: 'required',
    codeQL: 'required',
    dependabotConfig: 'required',
  },
};
```

### Declarative (YAML)

User-authored profiles live at `~/.config/gh-baseline/profiles/<id>.yaml`. Same schema, friendlier to compose by hand or via the TUI builder.

```yaml
id: my-internal-app
name: Internal application
description: Standard for private apps deployed to our internal infra.

metadata:
  description: { policy: required }
  homepage: { policy: forbidden }
  topics: { policy: optional }
  license: { policy: forbidden }

community:
  readme: { policy: required }
  contributing: { policy: optional }
  codeOfConduct: { policy: optional }
  securityPolicy: { policy: required }
  prTemplate: { policy: required }
  issueTemplates: { policy: optional }
  codeowners: { policy: required }

branchProtection:
  branches:
    main:
      required_pull_request_reviews:
        required_approving_review_count: 2
        require_code_owner_reviews: true
      required_status_checks:
        strict: true
        checks:
          - { context: 'build' }
          - { context: 'test' }
      required_signatures: true
      required_linear_history: true
      allow_force_pushes: false
      allow_deletions: false
      required_conversation_resolution: true

securityFeatures:
  dependabotAlerts: enabled
  dependabotSecurityUpdates: enabled
  secretScanning: enabled
  secretScanningPushProtection: enabled
  vulnerabilityReporting: enabled

repoSettings:
  allowSquashMerge: true
  allowMergeCommit: false
  allowRebaseMerge: false
  allowAutoMerge: true
  deleteBranchOnMerge: true
  defaultBranch: main

labels:
  policy: exact
  entries:
    - { name: bug, color: d73a4a }
    - { name: enhancement, color: a2eeef }
    - { name: incident, color: ff0000 }

ci:
  testWorkflow: required
  codeQL: optional
  dependabotConfig: required
```

## Authoring a profile via the TUI

```bash
gh-baseline profiles new
```

Walks through 10 steps (identity → metadata → community → branch protection → security → settings → labels → CI → review → export). Output is a YAML file at `~/.config/gh-baseline/profiles/<id>.yaml`.

To edit an existing profile:

```bash
gh-baseline profiles edit <id>
```

Loads it into the same form chain. Saving overwrites.

## Reverse-engineering a profile from an existing repo *(roadmap)*

```bash
gh-baseline profiles reverse owner/repo
```

Inspects a well-tended repo's current state (branch protection, security features, community files) and emits a profile YAML matching what's there. Useful for codifying tribal knowledge from your "exemplar" repo.

## Schema reference

The canonical schema is in `src/profiles/types.ts`. Every field is optional in YAML — missing categories default to `{ policy: 'unspecified' }`, which means scans skip the category and actors don't touch it.

The most common gotcha: the `policy` discriminator. Three values:

- `required` — the field must be present / the feature must be on. Scan fails if not.
- `optional` — present is fine, absent is fine. Scan always passes.
- `forbidden` — must be absent / off. Scan fails if present.
- `unspecified` *(default if you omit a category)* — skip entirely.

For label policies the discriminator is different:

- `exact` — repo's labels must exactly match `entries`.
- `superset` — repo must have at least all `entries`; extra labels are fine.
- `unspecified` — skip.
