// Community files check. Uses GitHub's "Community Profile" endpoint
// (`GET /repos/{owner}/{repo}/community/profile`) which already tells us
// which of README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, PR template,
// issue templates are present. SECURITY and CODEOWNERS aren't always
// surfaced in that payload, so we probe getContent for the standard paths.

import type { Octokit } from '@octokit/rest';

import type { CommunityFilePolicy, Profile } from '../profiles/types.js';

import { errMessage, splitRepo, type CheckResult } from './types.js';

type FileKey =
  | 'readme'
  | 'contributing'
  | 'codeOfConduct'
  | 'securityPolicy'
  | 'prTemplate'
  | 'issueTemplates'
  | 'codeowners';

interface CommunityProfileFiles {
  readme: { url?: string | null } | null;
  contributing: { url?: string | null } | null;
  code_of_conduct?: { url?: string | null; key?: string | null } | null;
  code_of_conduct_file?: { url?: string | null } | null;
  license?: { url?: string | null } | null;
  pull_request_template?: { url?: string | null } | null;
  issue_template?: { url?: string | null } | null;
}

interface CommunityProfileResponse {
  files: CommunityProfileFiles;
}

interface CommunityViolation {
  file: FileKey;
  policy: CommunityFilePolicy['policy'];
  present: boolean;
  reason: string;
}

const FILE_LABEL: Record<FileKey, string> = {
  readme: 'README',
  contributing: 'CONTRIBUTING',
  codeOfConduct: 'CODE_OF_CONDUCT',
  securityPolicy: 'SECURITY',
  prTemplate: 'pull request template',
  issueTemplates: 'issue templates',
  codeowners: 'CODEOWNERS',
};

function isPresent(node: { url?: string | null } | null | undefined): boolean {
  if (node === null || node === undefined) return false;
  const url = node.url;
  return typeof url === 'string' && url.length > 0;
}

export async function checkCommunityFiles(
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
): Promise<CheckResult> {
  const id = 'community-files';
  const { owner, repo } = splitRepo(repoSlug);

  let files: CommunityProfileFiles;
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/community/profile', {
      owner,
      repo,
    });
    const body = res.data as CommunityProfileResponse;
    files = body.files;
  } catch (err) {
    return {
      id,
      status: 'error',
      summary: `Failed to fetch community profile for ${repoSlug}: ${errMessage(err)}`,
    };
  }

  let presentSecurity = false;
  let presentCodeowners = false;
  for (const path of ['SECURITY.md', '.github/SECURITY.md', 'docs/SECURITY.md']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await octokit.repos.getContent({ owner, repo, path });
      presentSecurity = true;
      break;
    } catch {
      // continue
    }
  }
  for (const path of ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await octokit.repos.getContent({ owner, repo, path });
      presentCodeowners = true;
      break;
    } catch {
      // continue
    }
  }

  const present: Record<FileKey, boolean> = {
    readme: isPresent(files.readme),
    contributing: isPresent(files.contributing),
    codeOfConduct: isPresent(files.code_of_conduct ?? files.code_of_conduct_file ?? null),
    securityPolicy: presentSecurity,
    prTemplate: isPresent(files.pull_request_template ?? null),
    issueTemplates: isPresent(files.issue_template ?? null),
    codeowners: presentCodeowners,
  };

  const violations: CommunityViolation[] = [];
  const c = profile.community;
  const checks: Array<{ key: FileKey; policy: CommunityFilePolicy }> = [
    { key: 'readme', policy: c.readme },
    { key: 'contributing', policy: c.contributing },
    { key: 'codeOfConduct', policy: c.codeOfConduct },
    { key: 'securityPolicy', policy: c.securityPolicy },
    { key: 'prTemplate', policy: c.prTemplate },
    { key: 'issueTemplates', policy: c.issueTemplates },
    { key: 'codeowners', policy: c.codeowners },
  ];
  for (const { key, policy } of checks) {
    const isThere = present[key];
    if (policy.policy === 'required' && !isThere) {
      violations.push({
        file: key,
        policy: 'required',
        present: false,
        reason: `${FILE_LABEL[key]} is required but missing`,
      });
    } else if (policy.policy === 'forbidden' && isThere) {
      violations.push({
        file: key,
        policy: 'forbidden',
        present: true,
        reason: `${FILE_LABEL[key]} is forbidden but present`,
      });
    }
  }

  if (violations.length === 0) {
    return {
      id,
      status: 'pass',
      summary: 'community files match profile',
      details: { present },
    };
  }
  return {
    id,
    status: 'fail',
    summary: `community files: ${violations.length} violation(s)`,
    details: { present, violations },
    remediation: 'add the required community files (README, CONTRIBUTING, etc.) per the profile',
  };
}
