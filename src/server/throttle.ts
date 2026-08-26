import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { rateLimits } from "@/db/schema";

/**
 * Rate limiting that survives a deploy and works across instances.
 *
 * This used to be a Map in process memory, which on a serverless host barely
 * limits anything: every instance keeps its own count, so an attacker spread
 * across them gets a fresh allowance from each, and a deploy wipes the lot.
 * Postgres is already on the critical path for every sign-in, so counting
 * there costs one round trip and is actually shared.
 */
const WINDOW_MS = 5 * 60 * 1000;

export type ThrottleState = { allowed: boolean; remaining: number; retryInSeconds: number };

export const LIMITS = {
  signin: 5,
  signup: 5,
  /** Reset requests are cheap to ask for and expensive to send, so tighter. */
  password_reset: 3,
  pin: 5,
} as const;

export type LimitKind = keyof typeof LIMITS;

/**
 * Counts an attempt and reports whether it may proceed.
 *
 * One statement, so two simultaneous requests cannot both read "4 used" and
 * both decide they are the fifth. The insert-or-increment resets the counter
 * when the previous window has passed.
 */
export async function recordAttempt(kind: LimitKind, subject: string): Promise<ThrottleState> {
  const key = `${kind}:${subject.toLowerCase()}`;
  const max = LIMITS[kind];

  try {
    const db = await getDb();
    const cutoff = new Date(Date.now() - WINDOW_MS);

    const rows = await db
      .insert(rateLimits)
      .values({ key, count: 1, windowStartedAt: new Date() })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.windowStartedAt} < ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
          windowStartedAt: sql`case when ${rateLimits.windowStartedAt} < ${cutoff} then now() else ${rateLimits.windowStartedAt} end`,
        },
      })
      .returning({ count: rateLimits.count, windowStartedAt: rateLimits.windowStartedAt });

    const row = rows[0];
    const used = row?.count ?? 1;
    const startedAt = row?.windowStartedAt?.getTime() ?? Date.now();
    const retryInSeconds = Math.max(0, Math.ceil((startedAt + WINDOW_MS - Date.now()) / 1000));

    return {
      allowed: used <= max,
      remaining: Math.max(0, max - used),
      retryInSeconds: used <= max ? 0 : retryInSeconds,
    };
  } catch (error) {
    // A limiter that cannot reach the database must not lock everyone out of a
    // working shop. Fail open, but loudly.
    console.error("Rate limiter unavailable, allowing the attempt", error);
    return { allowed: true, remaining: max, retryInSeconds: 0 };
  }
}

/** Called after a success, so a correct sign-in clears the failures before it. */
export async function clearAttempts(kind: LimitKind, subject: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(rateLimits).where(sql`${rateLimits.key} = ${`${kind}:${subject.toLowerCase()}`}`);
  } catch {
    // Nothing depends on this: the window expires by itself.
  }
}

/** Removes windows that have long since passed. */
export async function pruneRateLimits(): Promise<void> {
  const db = await getDb();
  await db
    .delete(rateLimits)
    .where(sql`${rateLimits.windowStartedAt} < ${new Date(Date.now() - 24 * 60 * 60 * 1000)}`);
}
