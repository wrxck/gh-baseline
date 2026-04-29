// Repo metadata check: description, homepage, topics, license must match
// the profile's metadata policy. Uses `GET /repos/{owner}/{repo}` for the
// scalar fields; topics arrive on the same response.

import type { Octokit } from '@octokit/rest';

import type { Profile } from '../profiles/types.js';

import { errMessage, splitRepo, type CheckResult } from './types.js';

interface RepoFields {
  description: string | null;
  homepage: string | null;
  topics: string[];
  licenseSpdx: string | null;
}

interface MetadataViolation {
  field: 'description' | 'homepage' | 'topics' | 'license';
  policy: string;
  observed: unknown;
  reason: string;
}

export async function checkRepoMetadata(
  octokit: Octokit,
  repoSlug: string,
  profile: Profile,
): Promise<CheckResult> {
  const id = 'repo-metadata';
  const { owner, repo } = splitRepo(repoSlug);
  let fields: RepoFields;
  try {
    const res = await octokit.repos.get({ owner, repo });
    const data = res.data as {
      description?: string | null;
      homepage?: string | null;
      topics?: string[] | null;
      license?: { spdx_id?: string | null } | null;
    };
    fields = {
      description: data.description ?? null,
      homepage: data.homepage ?? null,
      topics: Array.isArray(data.topics) ? data.topics : [],
      licenseSpdx: data.license?.spdx_id ?? null,
    };
  } catch (err) {
    return {
      id,
      status: 'error',
      summary: `Failed to fetch repo metadata for ${repoSlug}: ${errMessage(err)}`,
    };
  }

  const violations: MetadataViolation[] = [];
  const m = profile.metadata;

  if (m.description === 'required' && (fields.description ?? '').trim() === '') {
    violations.push({
      field: 'description',
      policy: 'required',
      observed: fields.description,
      reason: 'description is required but missing',
    });
  } else if (m.description === 'forbidden' && (fields.description ?? '').trim() !== '') {
    violations.push({
      field: 'description',
      policy: 'forbidden',
      observed: fields.description,
      reason: 'description is forbidden but set',
    });
  }

  if (m.homepage === 'required' && (fields.homepage ?? '').trim() === '') {
    violations.push({
      field: 'homepage',
      policy: 'required',
      observed: fields.homepage,
      reason: 'homepage is required but missing',
    });
  } else if (m.homepage === 'forbidden' && (fields.homepage ?? '').trim() !== '') {
    violations.push({
      field: 'homepage',
      policy: 'forbidden',
      observed: fields.homepage,
      reason: 'homepage is forbidden but set',
    });
  }

  if (m.topics.policy === 'required') {
    const min = m.topics.minCount ?? 1;
    if (fields.topics.length < min) {
      violations.push({
        field: 'topics',
        policy: 'required',
        observed: fields.topics,
        reason: `topics: have ${fields.topics.length}, want at least ${min}`,
      });
    }
  } else if (m.topics.policy === 'forbidden' && fields.topics.length > 0) {
    violations.push({
      field: 'topics',
      policy: 'forbidden',
      observed: fields.topics,
      reason: 'topics are forbidden but set',
    });
  }

  if (m.license.policy === 'required') {
    if (fields.licenseSpdx === null || fields.licenseSpdx === '') {
      violations.push({
        field: 'license',
        policy: 'required',
        observed: fields.licenseSpdx,
        reason: 'license is required but missing',
      });
    } else if (
      m.license.allowed !== undefined &&
      m.license.allowed.length > 0 &&
      !m.license.allowed.includes(fields.licenseSpdx)
    ) {
      violations.push({
        field: 'license',
        policy: 'required',
        observed: fields.licenseSpdx,
        reason: `license ${fields.licenseSpdx} is not in allowed set [${m.license.allowed.join(
          ', ',
        )}]`,
      });
    }
  } else if (
    m.license.policy === 'forbidden' &&
    fields.licenseSpdx !== null &&
    fields.licenseSpdx !== ''
  ) {
    violations.push({
      field: 'license',
      policy: 'forbidden',
      observed: fields.licenseSpdx,
      reason: 'license is forbidden but set',
    });
  }

  if (violations.length === 0) {
    return {
      id,
      status: 'pass',
      summary: 'repo metadata matches profile',
      details: { fields },
    };
  }
  return {
    id,
    status: 'fail',
    summary: `repo metadata: ${violations.length} violation(s)`,
    details: { fields, violations },
    remediation:
      'update the repository description / homepage / topics / license to match the profile metadata policy',
  };
}
