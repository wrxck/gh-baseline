export class GhBaselineError extends Error {
  constructor(message: string, public exitCode = 1) {
    super(message);
    this.name = 'GhBaselineError';
  }
}

export class AuthError extends GhBaselineError {
  constructor(message = 'GitHub authentication failed') {
    super(message, 2);
    this.name = 'AuthError';
  }
}

export class ScopeError extends GhBaselineError {
  constructor(public missing: string[], message?: string) {
    super(message ?? `Missing required GitHub scopes: ${missing.join(', ')}`, 3);
    this.name = 'ScopeError';
  }
}

export class AllowlistError extends GhBaselineError {
  constructor(public repo: string, message?: string) {
    super(
      message ??
        `Repo not in allowlist: ${repo}. Add it to allowedRepos/allowedOrgs in config or set unsafeAllowAll=true.`,
      4,
    );
    this.name = 'AllowlistError';
  }
}

export class RateLimitError extends GhBaselineError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 5);
    this.name = 'RateLimitError';
  }
}

export class RepoNotFoundError extends GhBaselineError {
  constructor(public repo: string, message?: string) {
    super(message ?? `Repository not found: ${repo}`, 6);
    this.name = 'RepoNotFoundError';
  }
}

export class ConfigError extends GhBaselineError {
  constructor(message = 'Invalid gh-baseline configuration') {
    super(message, 7);
    this.name = 'ConfigError';
  }
}

export class ProfileError extends GhBaselineError {
  constructor(message = 'Invalid gh-baseline profile') {
    super(message, 8);
    this.name = 'ProfileError';
  }
}
