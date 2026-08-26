import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { appUrl, passwordResetEmail, sendEmail, verificationEmail } from "./email";
import { normaliseEmail } from "./accounts";
import { hashPassword } from "./passwords";
import { consumeToken, issueToken, peekToken } from "./tokens";
import { recordAttempt } from "./throttle";

/**
 * Sends a verification link. Safe to call more than once — issuing a new token
 * retires the previous one.
 */
export async function sendVerificationEmail(userId: string): Promise<void> {
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.emailVerifiedAt) return;

  const token = await issueToken({ kind: "email_verification", userId });
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);

  await sendEmail({ to: user.email, ...verificationEmail(user.name, link) });
}

export type VerifyResult = "verified" | "already_verified" | "invalid";

export async function verifyEmail(token: string): Promise<VerifyResult> {
  const existing = await peekToken(token, "email_verification");
  if (!existing?.userId) return "invalid";

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, existing.userId)).limit(1);
  if (!user) return "invalid";
  if (user.emailVerifiedAt) return "already_verified";

  const claimed = await consumeToken(token, "email_verification");
  if (!claimed?.userId) return "invalid";

  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, claimed.userId));
  return "verified";
}

/**
 * Starts a password reset.
 *
 * Always reports success to the caller, whether or not the address exists —
 * a reset form that says "no such account" is an account-enumeration tool.
 * The rate limit is keyed on the address for the same reason.
 */
export async function requestPasswordReset(emailInput: string): Promise<void> {
  const email = normaliseEmail(emailInput);

  const throttle = await recordAttempt("password_reset", email);
  if (!throttle.allowed) return;

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive) return;

  const token = await issueToken({ kind: "password_reset", userId: user.id });
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);

  await sendEmail({ to: user.email, ...passwordResetEmail(user.name, link) });
}

export type ResetResult = { ok: true } | { ok: false; reason: "invalid" | "expired" };

/** Checks a reset link before showing the form, so a dead link says so up front. */
export async function checkResetToken(token: string): Promise<boolean> {
  return Boolean(await peekToken(token, "password_reset"));
}

export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  const claimed = await consumeToken(token, "password_reset");
  if (!claimed?.userId) return { ok: false, reason: "invalid" };

  const db = await getDb();
  const passwordHash = await hashPassword(newPassword);

  await db
    .update(users)
    .set({
      passwordHash,
      // Using a link sent to the address proves the address, so a reset also
      // verifies it — otherwise someone could be stuck unable to verify.
      emailVerifiedAt: sqlNow(),
    })
    .where(eq(users.id, claimed.userId));

  return { ok: true };
}

const sqlNow = () => new Date();

/** Changing a password from inside the app, where the old one is known. */
export async function changePassword(userId: string, newPassword: string): Promise<void> {
  const db = await getDb();
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}
