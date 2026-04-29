import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './ratelimit.js';

/** Build a deterministic clock + sleep pair for tests. */
function makeFakeTime(): {
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  advance: (ms: number) => void;
  now: () => number;
} {
  let t = 1_000_000;
  const clock = () => t;
  const sleep = async (ms: number) => {
    t += ms;
  };
  const advance = (ms: number) => {
    t += ms;
  };
  return { clock, sleep, advance, now: () => t };
}

describe('createRateLimiter', () => {
  it('rejects non-positive perMinute', () => {
    expect(() => createRateLimiter({ perMinute: 0 })).toThrow();
    expect(() => createRateLimiter({ perMinute: -10 })).toThrow();
  });

  it('lets bursts up to capacity through immediately', async () => {
    const { clock, sleep } = makeFakeTime();
    const rl = createRateLimiter({ perMinute: 60, clock, sleep });
    expect(rl.available()).toBe(60);
    for (let i = 0; i < 60; i += 1) await rl.take();
    expect(rl.available()).toBe(0);
  });

  it('waits for the next token when at limit, then succeeds', async () => {
    const { clock, sleep, now } = makeFakeTime();
    // 60/min => 1 token per 1000ms.
    const rl = createRateLimiter({ perMinute: 60, clock, sleep });
    for (let i = 0; i < 60; i += 1) await rl.take();
    const start = now();
    await rl.take();
    const elapsed = now() - start;
    // Should have advanced roughly 1000ms (one refill interval).
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });

  it('refills over time', async () => {
    const { clock, sleep, advance } = makeFakeTime();
    const rl = createRateLimiter({ perMinute: 60, clock, sleep });
    for (let i = 0; i < 60; i += 1) await rl.take();
    expect(rl.available()).toBe(0);
    advance(2_000); // 2 tokens worth at 60/min
    expect(rl.available()).toBe(2);
  });

  it('available() never exceeds capacity', () => {
    const { clock, sleep, advance } = makeFakeTime();
    const rl = createRateLimiter({ perMinute: 30, clock, sleep });
    advance(10 * 60_000); // 10 minutes — would refill 300 tokens uncapped
    expect(rl.available()).toBe(30);
  });

  it('serialises concurrent takes (queue order, no double-spend)', async () => {
    const { clock, sleep, now } = makeFakeTime();
    const rl = createRateLimiter({ perMinute: 60, clock, sleep });
    // Drain
    for (let i = 0; i < 60; i += 1) await rl.take();
    const start = now();
    // Two queued takes should each wait ~1000ms in order, total ~2000ms.
    await Promise.all([rl.take(), rl.take()]);
    const elapsed = now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(2000);
  });
});
