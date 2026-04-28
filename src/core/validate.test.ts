import { describe, it, expect } from 'vitest';

import {
  BRANCH_NAME_RE,
  LABEL_NAME_RE,
  OWNER_RE,
  REPO_NAME_RE,
  REPO_SLUG_RE,
  TOPIC_RE,
  assertBranchName,
  assertLabelName,
  assertOwner,
  assertRepoName,
  assertRepoSlug,
  assertTopic,
} from './validate.js';

describe('REPO_SLUG_RE / assertRepoSlug', () => {
  it('accepts well-formed slugs', () => {
    for (const slug of [
      'acme/widgets',
      'acme/widgets-core',
      'a/b',
      'A1/B2',
      'octocat/Hello-World',
      'octocat/Hello.World',
      'octocat/repo_with_underscores',
    ]) {
      expect(() => assertRepoSlug(slug)).not.toThrow();
      expect(REPO_SLUG_RE.test(slug)).toBe(true);
    }
  });

  it('rejects malformed slugs', () => {
    for (const slug of [
      '',
      'no-slash',
      '/leading',
      'trailing/',
      'two//slashes',
      'owner/name/extra',
      '-acme/widgets', // owner cannot start with hyphen
      '.acme/widgets', // owner cannot start with dot
      'acme/-widgets', // name cannot start with hyphen
      'ac--me/widgets', // consecutive hyphens in owner
      'acme widgets/x',
    ]) {
      expect(() => assertRepoSlug(slug)).toThrow();
    }
  });

  it('rejects shell injection / control chars', () => {
    expect(() => assertRepoSlug('acme/widgets; rm -rf /')).toThrow();
    expect(() => assertRepoSlug('acme/widgets$(cmd)')).toThrow();
    expect(() => assertRepoSlug('acme/widgets\nevil')).toThrow();
    expect(() => assertRepoSlug('acme/wid\x00gets')).toThrow();
  });

  it('rejects oversized owner/name', () => {
    const longOwner = 'a' + 'b'.repeat(39); // 40 chars
    const longName = 'a' + 'b'.repeat(100); // 101 chars
    expect(() => assertRepoSlug(`${longOwner}/widgets`)).toThrow();
    expect(() => assertRepoSlug(`acme/${longName}`)).toThrow();
  });
});

describe('OWNER_RE / assertOwner', () => {
  it('accepts well-formed owners', () => {
    for (const owner of ['a', 'acme', 'octocat', 'Acme-Corp', 'a1-b2-c3']) {
      expect(() => assertOwner(owner)).not.toThrow();
      expect(OWNER_RE.test(owner)).toBe(true);
    }
  });

  it('rejects malformed owners', () => {
    for (const owner of [
      '',
      '-acme',
      'acme--corp',
      'acme.corp', // dots not allowed in owner
      'acme corp',
      'acme/extra',
      'a'.repeat(40),
    ]) {
      expect(() => assertOwner(owner)).toThrow();
    }
  });
});

describe('REPO_NAME_RE / assertRepoName', () => {
  it('accepts valid repo names', () => {
    for (const name of ['widgets', 'Hello-World', 'Hello.World', 'repo_with_underscores', 'a', 'a1.b2_c3-d4']) {
      expect(() => assertRepoName(name)).not.toThrow();
      expect(REPO_NAME_RE.test(name)).toBe(true);
    }
  });

  it('rejects empty / leading-dot / leading-dash / oversized / spaces', () => {
    expect(() => assertRepoName('')).toThrow();
    expect(() => assertRepoName('.hidden')).toThrow();
    expect(() => assertRepoName('-leading')).toThrow();
    expect(() => assertRepoName('a' + 'b'.repeat(100))).toThrow();
    expect(() => assertRepoName('with space')).toThrow();
  });
});

describe('BRANCH_NAME_RE / assertBranchName', () => {
  it('accepts valid branch names', () => {
    for (const branch of [
      'main',
      'develop',
      'feat/my-feature',
      'fix/bug-123',
      'release/1.0.0',
      'feat/v2.0-rewrite',
      'user/octocat/topic',
    ]) {
      expect(() => assertBranchName(branch)).not.toThrow();
      expect(BRANCH_NAME_RE.test(branch)).toBe(true);
    }
  });

  it('rejects refs starting with a dot', () => {
    expect(() => assertBranchName('.hidden')).toThrow();
  });

  it('rejects "..", "@{", backslashes', () => {
    expect(() => assertBranchName('feat/..')).toThrow();
    expect(() => assertBranchName('foo..bar')).toThrow();
    expect(() => assertBranchName('foo@{1}')).toThrow();
    expect(() => assertBranchName('foo\\bar')).toThrow();
  });

  it('rejects control chars / shell metacharacters', () => {
    expect(() => assertBranchName('foo\x00bar')).toThrow();
    expect(() => assertBranchName('foo\nbar')).toThrow();
    expect(() => assertBranchName('foo bar')).toThrow();
    expect(() => assertBranchName('foo~bar')).toThrow();
    expect(() => assertBranchName('foo^bar')).toThrow();
    expect(() => assertBranchName('foo:bar')).toThrow();
    expect(() => assertBranchName('foo?bar')).toThrow();
    expect(() => assertBranchName('foo*bar')).toThrow();
    expect(() => assertBranchName('foo[bar')).toThrow();
  });

  it('rejects illegal trailing chars', () => {
    expect(() => assertBranchName('feat/')).toThrow();
    expect(() => assertBranchName('feat.lock')).toThrow();
    expect(() => assertBranchName('feat.')).toThrow();
  });

  it('rejects empty', () => {
    expect(() => assertBranchName('')).toThrow();
  });
});

describe('LABEL_NAME_RE / assertLabelName', () => {
  it('accepts typical labels', () => {
    for (const label of ['bug', 'good first issue', 'P1: critical', 'área: docs', 'priority/high']) {
      expect(() => assertLabelName(label)).not.toThrow();
      expect(LABEL_NAME_RE.test(label)).toBe(true);
    }
  });

  it('rejects empty / oversized / control chars', () => {
    expect(() => assertLabelName('')).toThrow();
    expect(() => assertLabelName('a'.repeat(51))).toThrow();
    expect(() => assertLabelName('with\x00null')).toThrow();
    expect(() => assertLabelName('newline\nhere')).toThrow();
  });
});

describe('TOPIC_RE / assertTopic', () => {
  it('accepts valid topics', () => {
    for (const topic of ['security', 'mcp-server', 'a', 'a1-b2', 'gh-baseline']) {
      expect(() => assertTopic(topic)).not.toThrow();
      expect(TOPIC_RE.test(topic)).toBe(true);
    }
  });

  it('rejects uppercase, underscores, leading hyphen, oversized, empty', () => {
    expect(() => assertTopic('')).toThrow();
    expect(() => assertTopic('Security')).toThrow();
    expect(() => assertTopic('-leading')).toThrow();
    expect(() => assertTopic('with_underscore')).toThrow();
    expect(() => assertTopic('a'.repeat(51))).toThrow();
    expect(() => assertTopic('with space')).toThrow();
    expect(() => assertTopic('emoji😀')).toThrow();
  });
});
