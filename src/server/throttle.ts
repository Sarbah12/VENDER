import "server-only";

/**
 * A four-digit PIN falls to brute force in seconds without a limiter, so attempts
 * are counted per employee and the till locks out after a handful of misses.
 *
 * The counters live in process memory, which is honest for a single-node
 * deployment and NOT sufficient once the app runs on more than one instance —
 * at that point this wants to move to Redis or a Postgres table.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

type Bucket = { count: number; firstAt: number };

const globalBuckets = globalThis as unknown as { __venderThrottle?: Map<string, Bucket> };
const buckets = (globalBuckets.__venderThrottle ??= new Map<string, Bucket>());

export type ThrottleState = { allowed: boolean; remaining: number; retryInSeconds: number };

export function checkAttempt(key: string): ThrottleState {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.firstAt > WINDOW_MS) {
    return { allowed: true, remaining: MAX_ATTEMPTS, retryInSeconds: 0 };
  }
  if (bucket.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      retryInSeconds: Math.ceil((WINDOW_MS - (now - bucket.firstAt)) / 1000),
    };
  }
  return { allowed: true, remaining: MAX_ATTEMPTS - bucket.count, retryInSeconds: 0 };
}

export function recordFailure(key: string): ThrottleState {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.firstAt > WINDOW_MS) {
    buckets.set(key, { count: 1, firstAt: now });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, retryInSeconds: 0 };
  }

  bucket.count += 1;
  return checkAttempt(key);
}

export function clearAttempts(key: string): void {
  buckets.delete(key);
}
