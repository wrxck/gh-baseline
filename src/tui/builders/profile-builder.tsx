import React from 'react';
import { Box, Text } from 'ink';

/**
 * Interactive profile builder (Agent F).
 *
 * UX outline (the things this needs to compose):
 *
 *   1. NAME / DESCRIPTION       — ink-text-input, validate against zod
 *   2. METADATA RULES           — toggle which fields are required (description, homepage, topics, license)
 *   3. COMMUNITY FILES          — checkboxed list (CONTRIBUTING, COC, SECURITY, PR template, issues, CODEOWNERS)
 *   4. CI POLICY                — ink-tabs (test workflow, CodeQL, Dependabot, Scorecard) — each tab a sub-form
 *   5. BRANCH PROTECTION        — per-branch rules: required reviewers, required checks, signed commits, force-push policy
 *   6. SECURITY FEATURES        — Dependabot alerts/updates, secret scanning, push protection, vulnerability reporting
 *   7. LABELS                   — start from a curated default set, allow add/remove
 *   8. REPO SETTINGS            — squash/merge/rebase allowed, auto-delete-branch, default-branch name
 *   9. REVIEW                   — ink-rule + summary table; offer to "save as YAML" or "generate as TS"
 *  10. EXPORT                   — write to ~/.config/gh-baseline/profiles/<name>.{yaml,ts}; offer to commit to a profiles repo if configured
 *
 * The builder is BIDIRECTIONAL: 'profiles edit <name>' loads an existing profile into
 * the same form chain, so editing and creating share UI.
 *
 * The builder is also reusable from the scan view: when a scan surfaces "this repo
 * doesn't match any profile", offer "create a profile from this repo" → reverse-engineer
 * a profile spec from the repo's current state.
 */
export function ProfileBuilder(): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Profile builder</Text>
      <Text dimColor>Stub — Agent F implements the full form chain (steps 1–10 above).</Text>
    </Box>
  );
}
