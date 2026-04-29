export interface RateLimiter {
  /** Resolves immediately if a token is available, otherwise waits. */
  take(): Promise<void>;
  /** Current number of available tokens (fractional, rounded down). */
  available(): number;
}

export interface CreateRateLimiterOptions {
  /** Capacity of the bucket and refill budget per minute. */
  perMinute: number;
  /** Override the clock (defaults to `Date.now`). Useful in tests. */
  clock?: () => number;
  /** Override the sleep primitive (defaults to `setTimeout`). Useful in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Token bucket rate limiter.
 *
 * Capacity = `perMinute`. Refill rate = `perMinute / 60` tokens per second.
 * `take()` resolves immediately when a whole token is available, otherwise it
 * waits exactly long enough for the next token to refill.
 *
 * Both the clock and the sleep primitive are injectable so tests can drive
 * deterministic timing without `vi.useFakeTimers`.
 */
export function createRateLimiter(opts: CreateRateLimiterOptions): RateLimiter {
  if (!Number.isFinite(opts.perMinute) || opts.perMinute <= 0) {
    throw new Error(`createRateLimiter: perMinute must be > 0, got ${opts.perMinute}`);
  }

  const capacity = opts.perMinute;
  const refillPerMs = opts.perMinute / 60_000;
  const clock = opts.clock ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  let tokens = capacity;
  let lastRefill = clock();
  // Serialises waiters so two concurrent take() calls don't both think the
  // same future token is theirs.
  let queue: Promise<void> = Promise.resolve();

  function refill(): void {
    const now = clock();
    const elapsed = now - lastRefill;
    if (elapsed > 0) {
      tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
      lastRefill = now;
    }
  }

  async function takeOne(): Promise<void> {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    // Need to wait until tokens >= 1.
    const deficit = 1 - tokens;
    const waitMs = Math.ceil(deficit / refillPerMs);
    await sleep(waitMs);
    refill();
    // Even with clock jitter we should now have at least one token; if not,
    // loop until we do (bounded by sleep granularity).
    while (tokens < 1) {
      await sleep(Math.max(1, Math.ceil((1 - tokens) / refillPerMs)));
      refill();
    }
    tokens -= 1;
  }

  return {
    async take(): Promise<void> {
      const mine = queue.then(takeOne);
      // Swallow rejections in the chain so a failed take doesn't poison
      // subsequent ones (none of our internals reject, but be defensive).
      queue = mine.catch(() => undefined);
      return mine;
    },
    available(): number {
      refill();
      return Math.floor(tokens);
    },
  };
}
