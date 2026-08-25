import "server-only";

import { asc, eq, sql } from "drizzle-orm";
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

  /*
   * One round trip, not six.
   *
   * This runs before every page in the app, and the database is not next door —
   * roughly 200ms away from a shop in Accra. Fetching the membership, then the
   * branch, then the warehouse, then the tills, then the employee in sequence
   * cost over a second before a page began rendering.
   *
   * They are gathered here as independent sub-selects so the network pays once.
   * The membership check is still the gate: if the WHERE below matches nothing,
   * nothing else is returned either.
   */
  const rows = await db.execute(sql`
    select
      to_jsonb(u.*)  as "user",
      to_jsonb(b.*)  as "business",
      m.role         as "role",
      (
        select to_jsonb(br.*) from ${branches} br
        where br.business_id = b.id and br.is_active
        order by br.created_at limit 1
      ) as "branch",
      (
        select to_jsonb(w.*) from ${warehouses} w
        where w.business_id = b.id
          and w.branch_id = (
            select br2.id from ${branches} br2
            where br2.business_id = b.id and br2.is_active
            order by br2.created_at limit 1
          )
        order by w.created_at limit 1
      ) as "warehouse",
      coalesce((
        select jsonb_agg(to_jsonb(r.*) order by r.name) from ${registers} r
        where r.business_id = b.id and r.is_active
      ), '[]'::jsonb) as "registers",
      (
        select to_jsonb(e.*) from ${employees} e
        where e.business_id = b.id and e.is_active
          -- The session's employee if it is genuinely ours, otherwise this
          -- user's own staff record, so an owner is attributed without picking
          -- themselves first.
          and (e.id = ${session.employeeId ?? null}::uuid or e.user_id = ${session.userId}::uuid)
        order by (e.id = ${session.employeeId ?? null}::uuid) desc
        limit 1
      ) as "employee"
    from ${memberships} m
    join ${users} u on u.id = m.user_id
    join ${businesses} b on b.id = m.business_id
    where m.user_id = ${session.userId}::uuid
      and m.business_id = ${session.businessId}::uuid
      and u.is_active
    limit 1
  `);

  const row = firstRow<RawContextRow>(rows);

  // No membership means the cookie is claiming access this user does not have.
  if (!row) return null;
  // A business without a branch or a stockroom cannot be traded from.
  if (!row.branch || !row.warehouse) return null;

  const tills = (row.registers ?? []).map((till) =>
    revive<typeof registers.$inferSelect>(till),
  );
  const register = session.registerId
    ? (tills.find((t) => t.id === session.registerId) ?? null)
    : null;

  return {
    user: revive(row.user),
    business: revive(row.business),
    role: row.role,
    branch: revive(row.branch),
    warehouse: revive(row.warehouse),
    registers: tills,
    register,
    employee: row.employee ? revive(row.employee) : null,
  };
});

/**
 * The two drivers disagree about what `execute` returns: postgres-js hands back
 * an array of rows, PGlite an object with a `rows` property. Reading only one
 * shape works locally and returns nothing in production — which for this
 * function means every user silently failing to resolve a session.
 */
function firstRow<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) return result[0] as T | undefined;
  const rows = (result as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
}

type RawContextRow = {
  user: Record<string, unknown>;
  business: Record<string, unknown>;
  role: ShopContext["role"];
  branch: Record<string, unknown> | null;
  warehouse: Record<string, unknown> | null;
  registers: Array<Record<string, unknown>> | null;
  employee: Record<string, unknown> | null;
};

/**
 * jsonb gives back snake_case keys and ISO strings. Drizzle's own mapping does
 * this for a normal select; doing it by hand is the cost of the single round
 * trip above.
 */
function revive<T>(raw: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] =
      typeof value === "string" && TIMESTAMP.test(value) ? new Date(value) : value;
  }
  return out as T;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

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
