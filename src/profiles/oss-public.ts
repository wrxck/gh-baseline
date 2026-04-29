// Bundled `oss-public` profile. Encodes a strict-but-realistic posture for
// public OSS repos: branch protection on `main`, all security features
// enabled, squash-only merges, a standard label set.
//
// Status check contexts are taken from this repo's CI matrix
// (`build-and-test (20)` / `build-and-test (22)`). Forks/derivatives that
// run a different CI shape will need to override this profile.

import type { Profile } from './types.js';

export const ossPublicProfile: Profile = {
  id: 'oss-public',
  name: 'OSS Public',
  description:
    'Strict baseline for public open-source repositories: required reviews on main, ' +
    'all security features enabled, squash-only merges, standard label set.',
  metadata: {
    description: 'required',
    homepage: 'optional',
    topics: { policy: 'required', minCount: 3 },
    license: { policy: 'required', allowed: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC'] },
  },
  community: {
    readme: { policy: 'required' },
    contributing: { policy: 'required' },
    codeOfConduct: { policy: 'required' },
    securityPolicy: { policy: 'required' },
    prTemplate: { policy: 'optional' },
    issueTemplates: { policy: 'optional' },
    codeowners: { policy: 'optional' },
  },
  branchProtection: {
    branches: {
      main: {
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
          require_code_owner_reviews: false,
          require_last_push_approval: false,
        },
        required_status_checks: {
          strict: true,
          contexts: ['build-and-test (20)', 'build-and-test (22)'],
        },
        enforce_admins: true,
        required_signatures: false,
        required_linear_history: true,
        allow_force_pushes: false,
        allow_deletions: false,
        required_conversation_resolution: true,
        restrictions: null,
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
    entries: [
      { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
      { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
      { name: 'documentation', color: '0075ca', description: 'Improvements or additions to documentation' },
      { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' },
      { name: 'help wanted', color: '008672', description: 'Extra attention is needed' },
      { name: 'question', color: 'd876e3', description: 'Further information is requested' },
      { name: 'security', color: 'ee0701', description: 'Security-related issue' },
      { name: 'breaking', color: 'ff0000', description: 'Breaking change' },
      { name: 'dependencies', color: '0366d6', description: 'Pull requests that update a dependency file' },
    ],
  },
  ci: {
    testWorkflow: 'required',
    codeQL: 'optional',
    dependabotConfig: 'required',
  },
};
