// Profile schema. A profile declares the desired posture for one or more
// repositories: metadata, community files, branch protection, security
// features, repo settings, labels, and CI expectations. Every check and
// every actor reads from the same shape, so adding a knob here is the
// single point of extension.
//
// Sub-shapes for branch protection deliberately mirror GitHub's REST API
// (`PUT /repos/{owner}/{repo}/branches/{branch}/protection`) so a profile
// value can be passed through to the API with minimal massaging.

import { z } from 'zod';

/** ID format: lowercase, starts with a letter, hyphens allowed, max 41 chars. */
export const ProfileIdRe = /^[a-z][a-z0-9-]{0,40}$/;

const PolicyRequiredOptionalForbidden = z.enum(['required', 'optional', 'forbidden']);
export type PolicyRequiredOptionalForbidden = z.infer<typeof PolicyRequiredOptionalForbidden>;

const FeatureState = z.enum(['enabled', 'disabled', 'unspecified']);
export type FeatureState = z.infer<typeof FeatureState>;

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------

export const TopicsPolicySchema = z.object({
  policy: PolicyRequiredOptionalForbidden,
  /** Minimum count when policy === 'required'. */
  minCount: z.number().int().nonnegative().optional(),
});
export type TopicsPolicy = z.infer<typeof TopicsPolicySchema>;

export const LicensePolicySchema = z.object({
  policy: PolicyRequiredOptionalForbidden,
  /** SPDX ids accepted when policy === 'required'. Empty array means any license. */
  allowed: z.array(z.string().min(1)).optional(),
});
export type LicensePolicy = z.infer<typeof LicensePolicySchema>;

export const MetadataSchema = z.object({
  description: PolicyRequiredOptionalForbidden,
  homepage: PolicyRequiredOptionalForbidden,
  topics: TopicsPolicySchema,
  license: LicensePolicySchema,
});
export type MetadataPolicy = z.infer<typeof MetadataSchema>;

// ---------------------------------------------------------------------------
// community files
// ---------------------------------------------------------------------------

export const CommunityFilePolicySchema = z.object({
  policy: PolicyRequiredOptionalForbidden,
});
export type CommunityFilePolicy = z.infer<typeof CommunityFilePolicySchema>;

export const CommunitySchema = z.object({
  readme: CommunityFilePolicySchema,
  contributing: CommunityFilePolicySchema,
  codeOfConduct: CommunityFilePolicySchema,
  securityPolicy: CommunityFilePolicySchema,
  prTemplate: CommunityFilePolicySchema,
  issueTemplates: CommunityFilePolicySchema,
  codeowners: CommunityFilePolicySchema,
});
export type CommunityPolicy = z.infer<typeof CommunitySchema>;

// ---------------------------------------------------------------------------
// branch protection
// ---------------------------------------------------------------------------

// Mirrors the GitHub REST API shape for branch protection PUT payloads. Each
// field is optional / nullable so profiles can declare exactly which knobs
// they care about; checks treat absent fields as "don't compare".

export const RequiredStatusChecksSchema = z
  .object({
    strict: z.boolean(),
    contexts: z.array(z.string()),
  })
  .nullable();
export type RequiredStatusChecks = z.infer<typeof RequiredStatusChecksSchema>;

export const RequiredPullRequestReviewsSchema = z
  .object({
    required_approving_review_count: z.number().int().min(0).max(6),
    dismiss_stale_reviews: z.boolean().optional(),
    require_code_owner_reviews: z.boolean().optional(),
    require_last_push_approval: z.boolean().optional(),
  })
  .nullable();
export type RequiredPullRequestReviews = z.infer<typeof RequiredPullRequestReviewsSchema>;

export const BranchProtectionRuleSchema = z.object({
  required_status_checks: RequiredStatusChecksSchema.optional(),
  required_pull_request_reviews: RequiredPullRequestReviewsSchema.optional(),
  enforce_admins: z.boolean().nullable().optional(),
  required_signatures: z.boolean().optional(),
  required_linear_history: z.boolean().optional(),
  allow_force_pushes: z.boolean().nullable().optional(),
  allow_deletions: z.boolean().optional(),
  required_conversation_resolution: z.boolean().optional(),
  block_creations: z.boolean().optional(),
  /** restrict who can push (null means no restriction). */
  restrictions: z
    .object({
      users: z.array(z.string()),
      teams: z.array(z.string()),
      apps: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
});
export type BranchProtectionRule = z.infer<typeof BranchProtectionRuleSchema>;

export const BranchProtectionSchema = z.object({
  branches: z.record(z.string(), BranchProtectionRuleSchema),
});
export type BranchProtectionPolicy = z.infer<typeof BranchProtectionSchema>;

// ---------------------------------------------------------------------------
// security features
// ---------------------------------------------------------------------------

export const SecurityFeaturesSchema = z.object({
  dependabotAlerts: FeatureState,
  dependabotSecurityUpdates: FeatureState,
  secretScanning: FeatureState,
  secretScanningPushProtection: FeatureState,
  vulnerabilityReporting: FeatureState,
});
export type SecurityFeaturesPolicy = z.infer<typeof SecurityFeaturesSchema>;

// ---------------------------------------------------------------------------
// repo settings
// ---------------------------------------------------------------------------

export const RepoSettingsSchema = z.object({
  allowSquashMerge: z.boolean().optional(),
  allowMergeCommit: z.boolean().optional(),
  allowRebaseMerge: z.boolean().optional(),
  allowAutoMerge: z.boolean().optional(),
  deleteBranchOnMerge: z.boolean().optional(),
  defaultBranch: z.string().min(1).optional(),
});
export type RepoSettings = z.infer<typeof RepoSettingsSchema>;

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

export const LabelEntrySchema = z.object({
  name: z.string().min(1),
  /** 6-char hex without '#'. */
  color: z.string().regex(/^[0-9A-Fa-f]{6}$/),
  description: z.string().optional(),
});
export type LabelEntry = z.infer<typeof LabelEntrySchema>;

export const LabelsSchema = z.object({
  policy: z.enum(['exact', 'superset', 'unspecified']),
  entries: z.array(LabelEntrySchema),
});
export type LabelsPolicy = z.infer<typeof LabelsSchema>;

// ---------------------------------------------------------------------------
// ci
// ---------------------------------------------------------------------------

export const CiSchema = z.object({
  testWorkflow: PolicyRequiredOptionalForbidden,
  codeQL: PolicyRequiredOptionalForbidden,
  dependabotConfig: PolicyRequiredOptionalForbidden,
});
export type CiPolicy = z.infer<typeof CiSchema>;

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  id: z.string().regex(ProfileIdRe, 'profile id must match ^[a-z][a-z0-9-]{0,40}$'),
  name: z.string().min(1),
  description: z.string(),
  metadata: MetadataSchema,
  community: CommunitySchema,
  branchProtection: BranchProtectionSchema,
  securityFeatures: SecurityFeaturesSchema,
  repoSettings: RepoSettingsSchema,
  labels: LabelsSchema,
  ci: CiSchema,
});

export type Profile = z.infer<typeof ProfileSchema>;
