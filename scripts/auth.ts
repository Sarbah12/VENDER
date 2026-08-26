/**
 * Exercises the account flows: `npm run auth`.
 *
 * These are the paths where a bug locks someone out of their own business, and
 * where a weakness hands someone else the way in. Both deserve testing beyond
 * "the page rendered".
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { authTokens, users } from "../src/db/schema";
import { AccountError, authenticate, createUser } from "../src/server/accounts";
import {
  checkResetToken,
  completePasswordReset,
  verifyEmail,
} from "../src/server/auth-flows";
import { checkPasswordStrength } from "../src/server/passwords";
import { clearAttempts, recordAttempt } from "../src/server/throttle";
import { consumeToken, issueToken, peekToken } from "../src/server/tokens";

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function main() {
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set. This creates and deletes accounts.");
    process.exit(1);
  }
  const dir = process.env.PGLITE_DIR;
  if (dir) fs.rmSync(path.resolve(dir), { recursive: true, force: true });

  const db = await getDb();

  /* ── Password rules ──────────────────────────────────────────────────── */
  console.log("\nPassword rules");
  check("a short password is refused", checkPasswordStrength("short") !== null);
  check("an obvious one is refused", checkPasswordStrength("password123") !== null);
  check("a repeated character is refused", checkPasswordStrength("aaaaaaaaaaaaaa") !== null);
  check(
    "one containing the email is refused",
    checkPasswordStrength("kwabena-is-great", ["kwabena"]) !== null,
  );
  check("a decent one passes", checkPasswordStrength("correct horse battery staple") === null);

  /* ── Verification ────────────────────────────────────────────────────── */
  console.log("\nEmail verification");
  const userId = await createUser({
    email: "auth@example.test",
    name: "Auth Test",
    password: "a-perfectly-fine-password",
  });

  const verifyToken = await issueToken({ kind: "email_verification", userId });
  check("the token is not stored in plaintext", await tokenIsHashed(verifyToken));

  check("verifying works", (await verifyEmail(verifyToken)) === "verified");
  const [afterVerify] = await db.select().from(users).where(eq(users.id, userId));
  check("the account is marked verified", afterVerify.emailVerifiedAt !== null);
  check("the same link cannot be reused", (await verifyEmail(verifyToken)) !== "verified");

  /* ── Reset ───────────────────────────────────────────────────────────── */
  console.log("\nPassword reset");
  const resetToken = await issueToken({ kind: "password_reset", userId });
  check("a fresh link validates", await checkResetToken(resetToken));

  // Issuing a second retires the first, so an old email in an inbox is dead.
  const secondToken = await issueToken({ kind: "password_reset", userId });
  check("asking again retires the previous link", !(await checkResetToken(resetToken)));
  check("and the new one works", await checkResetToken(secondToken));

  const reset = await completePasswordReset(secondToken, "a-brand-new-password");
  check("the reset completes", reset.ok);

  const signedIn = await authenticate("auth@example.test", "a-brand-new-password");
  check("the new password signs in", signedIn.id === userId);

  let oldRefused = false;
  try {
    await authenticate("auth@example.test", "a-perfectly-fine-password");
  } catch (error) {
    oldRefused = error instanceof AccountError;
  }
  check("the old password no longer works", oldRefused);

  const replay = await completePasswordReset(secondToken, "yet-another-password");
  check("a spent link cannot be replayed", !replay.ok);

  /* ── Expiry ──────────────────────────────────────────────────────────── */
  console.log("\nExpiry");
  const expiring = await issueToken({ kind: "password_reset", userId });
  await db
    .update(authTokens)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(authTokens.tokenHash, hashOf(expiring)));
  check("an expired link is refused", !(await checkResetToken(expiring)));
  check("and cannot be consumed", (await consumeToken(expiring, "password_reset")) === null);

  check("a made-up token resolves to nothing", (await peekToken("not-a-real-token", "password_reset")) === null);

  /* ── Rate limiting ───────────────────────────────────────────────────── */
  console.log("\nRate limiting");
  await clearAttempts("signin", "limit@example.test");

  const outcomes: boolean[] = [];
  for (let i = 0; i < 7; i++) {
    outcomes.push((await recordAttempt("signin", "limit@example.test")).allowed);
  }
  check(
    "the first five attempts are allowed",
    outcomes.slice(0, 5).every(Boolean),
    outcomes.join(","),
  );
  check("the sixth and seventh are refused", !outcomes[5] && !outcomes[6]);

  await clearAttempts("signin", "limit@example.test");
  check(
    "a successful sign-in clears the count",
    (await recordAttempt("signin", "limit@example.test")).allowed,
  );

  // Survives a restart, unlike the in-memory version it replaced.
  const other = await recordAttempt("signin", "someone-else@example.test");
  check("limits are per-account, not global", other.allowed);

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);

  async function tokenIsHashed(token: string): Promise<boolean> {
    const rows = await db.select({ hash: authTokens.tokenHash }).from(authTokens);
    return rows.every((r) => r.hash !== token) && rows.some((r) => r.hash === hashOf(token));
  }
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
