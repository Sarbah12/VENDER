import "server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { getDb, type Database } from "@/db/client";
import { authTokens, employees, memberships, users } from "@/db/schema";
import { addMembership, normaliseEmail } from "./accounts";
import { appUrl, invitationEmail, sendEmail } from "./email";
import { hashPassword } from "./passwords";
import { consumeToken, issueToken, peekToken } from "./tokens";

export type StaffRole = "owner" | "manager" | "cashier" | "stock_clerk";

export class InvitationError extends Error {
  constructor(
    readonly code:
      | "already_member"
      | "already_invited"
      | "not_allowed"
      | "invalid_token"
      | "email_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

/**
 * Who may invite whom.
 *
 * An owner can bring in anyone, including another owner. A manager can staff
 * their own counter but cannot appoint someone at or above their own level —
 * otherwise "manager" is just "owner" with an extra step.
 */
const CAN_INVITE: Record<StaffRole, StaffRole[]> = {
  owner: ["owner", "manager", "cashier", "stock_clerk"],
  manager: ["cashier", "stock_clerk"],
  cashier: [],
  stock_clerk: [],
};

export function canInvite(inviterRole: StaffRole, targetRole: StaffRole): boolean {
  return CAN_INVITE[inviterRole]?.includes(targetRole) ?? false;
}

export async function inviteStaff(args: {
  businessId: string;
  businessName: string;
  inviterUserId: string;
  inviterName: string;
  inviterRole: StaffRole;
  email: string;
  role: StaffRole;
}): Promise<{ delivered: boolean }> {
  if (!canInvite(args.inviterRole, args.role)) {
    throw new InvitationError("not_allowed", "You cannot invite someone to that role.");
  }

  const db = await getDb();
  const email = normaliseEmail(args.email);

  // Already on the team: inviting again would create a second staff record.
  const [existingMember] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.businessId, args.businessId), eq(users.email, email)))
    .limit(1);

  if (existingMember) {
    throw new InvitationError("already_member", "That person is already on your team.");
  }

  const [pending] = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.kind, "invitation"),
        eq(authTokens.businessId, args.businessId),
        eq(authTokens.email, email),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (pending) {
    throw new InvitationError(
      "already_invited",
      "They have an invitation outstanding. Revoke it first to send a new one.",
    );
  }

  const token = await issueToken({
    kind: "invitation",
    email,
    businessId: args.businessId,
    role: args.role,
    invitedByUserId: args.inviterUserId,
  });

  const link = appUrl(`/accept-invitation?token=${encodeURIComponent(token)}`);
  const result = await sendEmail({
    to: email,
    ...invitationEmail(args.inviterName, args.businessName, link),
  });

  return { delivered: result.delivered };
}

export type PendingInvitation = {
  id: string;
  email: string;
  role: StaffRole;
  invitedBy: string | null;
  expiresAt: string;
};

export async function listPendingInvitations(businessId: string): Promise<PendingInvitation[]> {
  const db = await getDb();

  const rows = await db
    .select({
      id: authTokens.id,
      email: authTokens.email,
      role: authTokens.role,
      invitedBy: users.name,
      expiresAt: authTokens.expiresAt,
    })
    .from(authTokens)
    .leftJoin(users, eq(users.id, authTokens.invitedByUserId))
    .where(
      and(
        eq(authTokens.kind, "invitation"),
        eq(authTokens.businessId, businessId),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authTokens.createdAt));

  return rows.map((r) => ({
    id: r.id,
    email: r.email ?? "",
    role: (r.role ?? "cashier") as StaffRole,
    invitedBy: r.invitedBy,
    expiresAt: r.expiresAt.toISOString(),
  }));
}

/** Retires an outstanding invitation. Scoped so one business cannot revoke another's. */
export async function revokeInvitation(businessId: string, invitationId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.id, invitationId),
        eq(authTokens.businessId, businessId),
        eq(authTokens.kind, "invitation"),
      ),
    );
}

export type InvitationDetails = {
  email: string;
  role: StaffRole;
  businessId: string;
  businessName: string;
  invitedBy: string | null;
  /** True when this address already has a login, so it needs no new password. */
  hasAccount: boolean;
};

/** Reads an invitation without spending it, so the page can describe the offer. */
export async function describeInvitation(token: string): Promise<InvitationDetails | null> {
  const found = await peekToken(token, "invitation");
  if (!found?.businessId || !found.email) return null;

  const db = await getDb();
  const { businesses } = await import("@/db/schema");

  const [business] = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(eq(businesses.id, found.businessId))
    .limit(1);
  if (!business) return null;

  const [inviter] = found.invitedByUserId
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, found.invitedByUserId)).limit(1)
    : [undefined];

  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, found.email))
    .limit(1);

  return {
    email: found.email,
    role: (found.role ?? "cashier") as StaffRole,
    businessId: business.id,
    businessName: business.name,
    invitedBy: inviter?.name ?? null,
    hasAccount: Boolean(account),
  };
}

export type AcceptResult = { userId: string; businessId: string; employeeId: string };

/**
 * Accepts an invitation.
 *
 * Two shapes: someone who already has a login simply gains a membership, and
 * someone new gets an account created here. Either way the token is spent
 * first, so a link that has already been used cannot add a second membership.
 *
 * Arriving via a link sent to the address proves the address, so the account is
 * marked verified without a second email.
 */
export async function acceptInvitation(args: {
  token: string;
  /** Supplied only when the invitee is creating an account. */
  name?: string;
  password?: string;
}): Promise<AcceptResult> {
  const claimed = await consumeToken(args.token, "invitation");
  if (!claimed?.businessId || !claimed.email) {
    throw new InvitationError("invalid_token", "That invitation has expired or has been used.");
  }

  const db = await getDb();
  const email = claimed.email;
  const role = (claimed.role ?? "cashier") as StaffRole;

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;

    const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);

    let userId: string;
    let name: string;

    if (existing) {
      userId = existing.id;
      name = existing.name;
    } else {
      if (!args.password || !args.name) {
        throw new InvitationError("invalid_token", "A name and password are needed to accept this.");
      }
      const [created] = await tx
        .insert(users)
        .values({
          email,
          name: args.name.trim(),
          passwordHash: await hashPassword(args.password),
          // The link went to this address, so it is confirmed by arriving here.
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id, name: users.name });
      userId = created.id;
      name = created.name;
    }

    const { branches } = await import("@/db/schema");
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.businessId, claimed.businessId!))
      .limit(1);

    const employeeId = await addMembership(tx, {
      userId,
      businessId: claimed.businessId!,
      branchId: branch?.id ?? null,
      role,
      name,
      email,
    });

    return { userId, businessId: claimed.businessId!, employeeId };
  });
}

/** Removes someone from a business. Their sales stay, attributed as before. */
export async function removeStaff(businessId: string, employeeId: string): Promise<void> {
  const db = await getDb();

  const [staff] = await db
    .select({ userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)))
    .limit(1);

  if (!staff) return;

  // Deactivated rather than deleted: sales reference this row, and a receipt
  // must still say who rang it up.
  await db
    .update(employees)
    .set({ isActive: false })
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)));

  if (staff.userId) {
    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, staff.userId), eq(memberships.businessId, businessId)));
  }
}
