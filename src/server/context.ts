import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "@/db/client";
import { branches, businesses, employees, registers, warehouses } from "@/db/schema";
import { readSession } from "./session";

export type ShopContext = {
  business: typeof businesses.$inferSelect;
  branch: typeof branches.$inferSelect;
  warehouse: typeof warehouses.$inferSelect;
  registers: Array<typeof registers.$inferSelect>;
  register: (typeof registers.$inferSelect) | null;
  employee: (typeof employees.$inferSelect) | null;
};

/**
 * Resolves who is at the till and which shop they are standing in.
 *
 * Branch selection is currently "the first branch" — a single-shop assumption
 * that the Administration module will replace with a branch picker. Everything
 * downstream already takes branchId and warehouseId as parameters, so that
 * change stays contained here.
 */
export const getShopContext = cache(async (): Promise<ShopContext | null> => {
  const db = await getDb();

  const [business] = await db.select().from(businesses).orderBy(asc(businesses.createdAt)).limit(1);
  if (!business) return null;

  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.businessId, business.id), eq(branches.isActive, true)))
    .orderBy(asc(branches.createdAt))
    .limit(1);
  if (!branch) return null;

  const [warehouse] = await db
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.businessId, business.id), eq(warehouses.branchId, branch.id)))
    .orderBy(asc(warehouses.createdAt))
    .limit(1);
  if (!warehouse) return null;

  const tills = await db
    .select()
    .from(registers)
    .where(and(eq(registers.branchId, branch.id), eq(registers.isActive, true)))
    .orderBy(asc(registers.name));

  const session = await readSession();
  let employee: (typeof employees.$inferSelect) | null = null;

  if (session) {
    const [found] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, session.employeeId), eq(employees.isActive, true)))
      .limit(1);
    // A cashier who was deactivated mid-shift stops being signed in.
    employee = found ?? null;
  }

  const register = session?.registerId
    ? (tills.find((t) => t.id === session.registerId) ?? null)
    : null;

  return { business, branch, warehouse, registers: tills, register, employee };
});

/** Every page that touches money needs all three of these; this narrows the type once. */
export type SignedInContext = ShopContext & {
  employee: NonNullable<ShopContext["employee"]>;
};

export function isSignedIn(context: ShopContext | null): context is SignedInContext {
  return Boolean(context?.employee);
}
