import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { authTokens } from "@/db/schema";

export type TokenKind = "email_verification" | "password_reset" | "invitation";

/**
 * Tokens for the links sent by email.
 *
 * The plaintext is returned once, to be put in the email, and never stored —
 * only its SHA-256. A stolen database therefore cannot be used to reset
 * anyone's password, which is the whole reason such a table is worth stealing.
 *
 * SHA-256 without a salt is right here, unlike for passwords: the token is 32
 * random bytes, so there is nothing to brute-force and nothing a rainbow table
 * could precompute.
 */
const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

export const TOKEN_LIFETIME: Record<TokenKind, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  // Short on purpose: a reset link sitting in an inbox is a way into the account.
  password_reset: 60 * 60 * 1000,
  invitation: 7 * 24 * 60 * 60 * 1000,
};

export async function issueToken(args: {
  kind: TokenKind;
  userId?: string | null;
  email?: string | null;
  businessId?: string | null;
  role?: "owner" | "manager" | "cashier" | "stock_clerk" | null;
  invitedByUserId?: string | null;
}): Promise<string> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");

  // Only one live token of a kind per user: requesting a new reset link should
  // retire the previous one rather than leaving several doors open.
  if (args.userId) {
    await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, args.userId),
          eq(authTokens.kind, args.kind),
          isNull(authTokens.usedAt),
        ),
      );
  }

  await db.insert(authTokens).values({
    kind: args.kind,
    userId: args.userId ?? null,
    email: args.email ?? null,
    businessId: args.businessId ?? null,
    role: args.role ?? null,
    invitedByUserId: args.invitedByUserId ?? null,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + TOKEN_LIFETIME[args.kind]),
  });

  return token;
}

export type ResolvedToken = typeof authTokens.$inferSelect;

/** Looks a token up without spending it, so a page can be shown before acting. */
export async function peekToken(token: string, kind: TokenKind): Promise<ResolvedToken | null> {
  const db = await getDb();
  const [found] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hash(token)), eq(authTokens.kind, kind)))
    .limit(1);

  if (!found) return null;
  if (found.usedAt) return null;
  if (found.expiresAt.getTime() < Date.now()) return null;

  return found;
}

/**
 * Spends a token, atomically.
 *
 * The `used_at is null` in the WHERE is what makes it single-use: two requests
 * arriving together both try to claim it and only one row comes back, so a
 * reset link cannot be replayed by anyone who sees it afterwards.
 */
export async function consumeToken(token: string, kind: TokenKind): Promise<ResolvedToken | null> {
  const db = await getDb();
  const now = new Date();

  const [claimed] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, hash(token)),
        eq(authTokens.kind, kind),
        isNull(authTokens.usedAt),
      ),
    )
    .returning();

  if (!claimed) return null;
  if (claimed.expiresAt.getTime() < now.getTime()) return null;

  return claimed;
}

/** Compares two tokens without leaking their difference through timing. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(hash(a));
  const right = Buffer.from(hash(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Clears out spent and expired rows. Nothing depends on it running — every
 * check above already rejects both — but the table should not grow forever.
 */
export async function pruneTokens(tx?: Database): Promise<number> {
  const db = tx ?? (await getDb());
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const removed = await db
    .delete(authTokens)
    .where(or(lt(authTokens.expiresAt, new Date()), lt(authTokens.createdAt, cutoff)))
    .returning({ id: authTokens.id });

  return removed.length;
}
