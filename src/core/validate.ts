// Input validators for GitHub-shaped strings. The regexes encode GitHub's actual
// constraints (owner length 1-39, repo name 1-100, etc.) plus pragmatic git ref
// rules. Every assertX throws a plain Error with a descriptive message — the
// caller wraps in a typed error if it wants one.

export const REPO_SLUG_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/;

export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// GitHub repo names: 1-100 chars, must start alphanumeric, allow letters,
// digits, dot, underscore, hyphen.
export const REPO_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/;

// Git ref rules (subset, applied to the *short* branch name only):
//   - cannot start with '.'
//   - cannot contain '..'
//   - cannot contain '@{'
//   - cannot contain backslash
//   - cannot contain control chars, DEL, '~', '^', ':', '?', '*', '[', ' '
//   - and we additionally forbid newlines via the control-char class.
export const BRANCH_NAME_RE = /^(?!\.)(?!.*\.\.)(?!.*@\{)(?!.*\\)[^\x00-\x1F\x7F~^:?*\[ ]+$/;

// GitHub label names: up to 50 characters, no control chars. (GitHub itself
// allows up to 50 characters incl. emoji; we just disallow control chars/null.)
export const LABEL_NAME_RE = /^[^\x00-\x1F\x7F]{1,50}$/;

// GitHub topic names: lowercase alphanumeric with hyphens, 1-50 chars, must
// start alphanumeric.
export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

function fail(label: string, value: string, reason?: string): never {
  const suffix = reason ? ` (${reason})` : '';
  throw new Error(`Invalid ${label}: ${JSON.stringify(value)}${suffix}`);
}

export function assertRepoSlug(slug: string): void {
  if (typeof slug !== 'string' || slug.length === 0) fail('repo slug', String(slug));
  if (!REPO_SLUG_RE.test(slug)) {
    fail('repo slug', slug, 'expected owner/name with GitHub-legal characters');
  }
  // No consecutive dashes in owner half (GitHub forbids).
  const owner = slug.split('/', 1)[0]!;
  if (owner.includes('--')) fail('repo slug', slug, 'owner cannot contain consecutive hyphens');
}

export function assertOwner(owner: string): void {
  if (typeof owner !== 'string' || owner.length === 0) fail('owner', String(owner));
  if (!OWNER_RE.test(owner)) fail('owner', owner, 'expected GitHub owner (1-39 chars)');
  if (owner.includes('--')) fail('owner', owner, 'cannot contain consecutive hyphens');
}

export function assertRepoName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) fail('repo name', String(name));
  if (!REPO_NAME_RE.test(name)) {
    fail('repo name', name, 'expected GitHub repo name (1-100 chars, no leading dot/dash)');
  }
}

export function assertBranchName(branch: string): void {
  if (typeof branch !== 'string' || branch.length === 0) fail('branch name', String(branch));
  if (branch.endsWith('/') || branch.endsWith('.lock') || branch.endsWith('.')) {
    fail('branch name', branch, 'illegal trailing character');
  }
  if (!BRANCH_NAME_RE.test(branch)) fail('branch name', branch);
}

export function assertLabelName(label: string): void {
  if (typeof label !== 'string') fail('label name', String(label));
  if (!LABEL_NAME_RE.test(label)) fail('label name', label, '1-50 visible characters');
}

export function assertTopic(topic: string): void {
  if (typeof topic !== 'string') fail('topic', String(topic));
  if (!TOPIC_RE.test(topic)) fail('topic', topic, 'lowercase alphanumeric with hyphens, max 50');
}
