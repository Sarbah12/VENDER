import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db/client";
import {
  branches,
  businesses,
  employees,
  memberships,
  registers,
  users,
  warehouses,
} from "@/db/schema";
import { readSession } from "./session";

export type ShopContext = {
  user: typeof users.$inferSelect;
  business: typeof businesses.$inferSelect;
  /** The role this user holds in this business. Not the same across businesses. */
  role: (typeof memberships.$inferSelect)["role"];
  branch: typeof branches.$inferSelect;
  warehouse: typeof warehouses.$inferSelect;
  registers: Array<typeof registers.$inferSelect>;
  register: (typeof registers.$inferSelect) | null;
  /** Who is at the till. May differ from the signed-in user. */
  employee: (typeof employees.$inferSelect) | null;
};

/**
 * Resolves who is signed in and which business they are acting in.
 *
 * This is the tenant boundary, and the only place it is decided. The business
 * is taken from the session cookie and then **re-checked against a membership
 * row** — the cookie is signed, but a membership can be revoked after it was
 * issued, and a stale cookie must not outlive the access it describes.
 *
 * Everything downstream receives `business.id` from here. Nothing derives a
 * tenant from a URL, a form field, or a header.
 */
export const getShopContext = cache(async (): Promise<ShopContext | null> => {
  const session = await readSession();
  if (!session) return null;

  const db = await getDb();

  const [account] = await db
    .select({
      user: users,
      business: businesses,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(
      and(
        eq(memberships.userId, session.userId),
        eq(memberships.businessId, session.businessId),
        eq(users.isActive, true),
      ),
    )
    .limit(1);

  // No membership means the cookie is claiming access this user does not have.
  if (!account) return null;

  const businessId = account.business.id;

  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.businessId, businessId), eq(branches.isActive, true)))
    .orderBy(asc(branches.createdAt))
    .limit(1);
  if (!branch) return null;

  const [warehouse] = await db
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.businessId, businessId), eq(warehouses.branchId, branch.id)))
    .orderBy(asc(warehouses.createdAt))
    .limit(1);
  if (!warehouse) return null;

  const tills = await db
    .select()
    .from(registers)
    .where(and(eq(registers.businessId, businessId), eq(registers.isActive, true)))
    .orderBy(asc(registers.name));

  // Scoped to the business as well as the id: an employee id from another
  // tenant must not resolve, however it got into the cookie.
  let employee: (typeof employees.$inferSelect) | null = null;
  if (session.employeeId) {
    const [found] = await db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.id, session.employeeId),
          eq(employees.businessId, businessId),
          eq(employees.isActive, true),
        ),
      )
      .limit(1);
    employee = found ?? null;
  }

  // Fall back to this user's own staff record, so an owner who signs in is
  // attributed on the sales they ring up without picking themselves first.
  if (!employee) {
    const [own] = await db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.businessId, businessId),
          eq(employees.userId, session.userId),
          eq(employees.isActive, true),
        ),
      )
      .limit(1);
    employee = own ?? null;
  }

  const register = session.registerId
    ? (tills.find((t) => t.id === session.registerId) ?? null)
    : null;

  return {
    user: account.user,
    business: account.business,
    role: account.role,
    branch,
    warehouse,
    registers: tills,
    register,
    employee,
  };
});

export type SignedInContext = ShopContext & {
  employee: NonNullable<ShopContext["employee"]>;
};

export function isSignedIn(context: ShopContext | null): context is SignedInContext {
  return Boolean(context?.employee);
}

/** Every business this user can act in — for the switcher, and after sign-in. */
export async function listMemberships(userId: string) {
  const db = await getDb();
  return db
    .select({
      businessId: businesses.id,
      businessName: businesses.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(businesses.name));
}
