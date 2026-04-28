// Security features check. GitHub surfaces secret scanning + push
// protection on the repo object via `security_and_analysis`. Dependabot
// alerts and security updates have dedicated endpoints (HTTP 204 = enabled,
// 404 = disabled). Vulnerability reporting (private vuln reporting) lives
// at `GET /repos/{owner}/{repo}/private-vulnerability-reporting`.

import type { Octokit } from '@octokit/rest';

import type { FeatureState, Profile } from '../profiles/types.js';

import { errMessage, splitRepo, type CheckResult } from './types.js';

interface SecurityFeatureSnapshot {
  dependabotAlerts: FeatureState;
  dependabotSecurityUpdates: FeatureState;
  secretScanning: FeatureState;
  secretScanningPushProtection: FeatureState;
  vulnerabilityReporting: FeatureState;
}

interface SecurityViolation {
  feature: keyof SecurityFeatureSnapshot;
  want: FeatureState;
  got: FeatureState;
}

function statusFromBlock(block: { status?: string } | undefined | null): FeatureState {
  if (!block) return 'unspecified';
  if (block.status === 'enabled') return 'enabled';
  if (block.status === 'disabled') return 'disabled';
  return 'unspecified';
}

async function probeBoolEndpoint(
  octokit: Octokit,
  url: string,
  owner: string,
  repo: string,
): Promise<FeatureState> {
  try {
    await octokit.request(`GET ${url}`, { owner, repo });
    return 'enabled';
  } catch (err) {
    const message = errMessage(err);
    if (/Not Found|status.*404/i.test(message)) return 'disabled';
    return 'unspecified';
  }
}

export async function checkSecurityFeatures(
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
): Promise<CheckResult> {
  const id = 'security-features';
  const { owner, repo } = splitRepo(repoSlug);

  let secretScanning: FeatureState = 'unspecified';
  let secretScanningPushProtection: FeatureState = 'unspecified';
  try {
    const res = await octokit.repos.get({ owner, repo });
    const data = res.data as {
      security_and_analysis?: {
        secret_scanning?: { status?: string } | null;
        secret_scanning_push_protection?: { status?: string } | null;
      } | null;
    };
    secretScanning = statusFromBlock(data.security_and_analysis?.secret_scanning ?? null);
    secretScanningPushProtection = statusFromBlock(
      data.security_and_analysis?.secret_scanning_push_protection ?? null,
    );
  } catch (err) {
    return {
      id,
      status: 'error',
      summary: `Failed to fetch repo security_and_analysis for ${repoSlug}: ${errMessage(err)}`,
    };
  }

  const dependabotAlerts = await probeBoolEndpoint(
    octokit,
    '/repos/{owner}/{repo}/vulnerability-alerts',
    owner,
    repo,
  );
  const dependabotSecurityUpdates = await probeBoolEndpoint(
    octokit,
    '/repos/{owner}/{repo}/automated-security-fixes',
    owner,
    repo,
  );
  const vulnerabilityReporting = await probeBoolEndpoint(
    octokit,
    '/repos/{owner}/{repo}/private-vulnerability-reporting',
    owner,
    repo,
  );

  const snapshot: SecurityFeatureSnapshot = {
    dependabotAlerts,
    dependabotSecurityUpdates,
    secretScanning,
    secretScanningPushProtection,
    vulnerabilityReporting,
  };

  const want = profile.securityFeatures;
  const violations: SecurityViolation[] = [];
  for (const key of Object.keys(snapshot) as Array<keyof SecurityFeatureSnapshot>) {
    const wantState = want[key];
    if (wantState === 'unspecified') continue;
    if (snapshot[key] !== wantState) {
      violations.push({ feature: key, want: wantState, got: snapshot[key] });
    }
  }

  if (violations.length === 0) {
    return {
      id,
      status: 'pass',
      summary: 'security features match profile',
      details: { snapshot },
    };
  }
  return {
    id,
    status: 'fail',
    summary: `security features: ${violations.length} drift(s)`,
    details: { snapshot, violations },
    remediation:
      'enable the missing security features via repo settings or the security-features actor',
  };
}
