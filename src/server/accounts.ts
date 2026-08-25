import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { employees, memberships, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "./passwords";

export class AccountError extends Error {
  constructor(
    readonly code: "email_taken" | "invalid_credentials" | "inactive" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Creates a login. Does not create a business — that is a separate step, so the
 * same account can go on to own several.
 */
export async function createUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<string> {
  const db = await getDb();
  const email = normaliseEmail(input.email);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    throw new AccountError("email_taken", "There is already an account with that email.");
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const [created] = await db
      .insert(users)
      .values({ email, name: input.name.trim(), passwordHash })
      .returning({ id: users.id });
    return created.id;
  } catch (error) {
    // The unique index is the real guard; the check above only makes the
    // message friendly. Two simultaneous signups land here.
    if (error instanceof Error && /users_email_uq|unique/i.test(error.message)) {
      throw new AccountError("email_taken", "There is already an account with that email.");
    }
    throw error;
  }
}

export type AuthenticatedUser = { id: string; name: string; email: string };

/**
 * Verifies an email and password.
 *
 * A wrong email and a wrong password produce the same error, and an unknown
 * email still pays for a hash comparison — otherwise the response time tells an
 * attacker which addresses have accounts.
 */
export async function authenticate(
  emailInput: string,
  password: string,
): Promise<AuthenticatedUser> {
  const db = await getDb();
  const email = normaliseEmail(emailInput);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    // A real verification against a throwaway hash, to keep the timing even.
    await verifyPassword(password, DUMMY_HASH);
    throw new AccountError("invalid_credentials", "That email and password do not match.");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new AccountError("invalid_credentials", "That email and password do not match.");
  if (!user.isActive) throw new AccountError("inactive", "That account has been disabled.");

  await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));

  return { id: user.id, name: user.name, email: user.email };
}

// Generated once at module load so an unknown email costs the same as a known one.
const DUMMY_HASH =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

/** Grants a user access to a business, and gives them a staff record in it. */
export async function addMembership(
  tx: Database,
  args: {
    userId: string;
    businessId: string;
    branchId: string | null;
    role: (typeof memberships.$inferSelect)["role"];
    name: string;
    email: string;
  },
): Promise<string> {
  await tx
    .insert(memberships)
    .values({ userId: args.userId, businessId: args.businessId, role: args.role })
    .onConflictDoNothing();

  const [existing] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.businessId, args.businessId), eq(employees.userId, args.userId)))
    .limit(1);

  if (existing) return existing.id;

  const [staff] = await tx
    .insert(employees)
    .values({
      businessId: args.businessId,
      branchId: args.branchId,
      userId: args.userId,
      name: args.name,
      email: args.email,
      role: args.role,
    })
    .returning({ id: employees.id });

  return staff.id;
}

/** Confirms a user may act in a business. The check every tenant decision rests on. */
export async function hasMembership(userId: string, businessId: string): Promise<boolean> {
  const db = await getDb();
  const [found] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.businessId, businessId)))
    .limit(1);
  return Boolean(found);
}
