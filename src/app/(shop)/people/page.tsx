import { asc, count, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { branches, employees, sales } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "People" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  stock_clerk: "Stock clerk",
};

export default async function PeoplePage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;

  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      phone: employees.phone,
      isActive: employees.isActive,
      hasPin: sql<boolean>`${employees.pinHash} is not null`,
      branch: branches.name,
      salesCount: count(sales.id),
      salesTotal: sql`coalesce(sum(${sales.total}), 0)`,
    })
    .from(employees)
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(sales, eq(sales.employeeId, employees.id))
    .where(eq(employees.businessId, context.business.id))
    .groupBy(
      employees.id,
      employees.name,
      employees.role,
      employees.phone,
      employees.isActive,
      employees.pinHash,
      branches.name,
    )
    .orderBy(asc(employees.name));

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Staff</h2>
        <p className="mt-0.5 text-[0.75rem] text-muted">
          Till PINs identify who rang up each sale. Full account authentication, roles and
          permissions belong to the Administration module.
        </p>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Branch</th>
              <th>Phone</th>
              <th className="num">Sales rung up</th>
              <th className="num">Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="font-semibold">{row.name}</td>
                <td className="text-muted">{ROLE_LABEL[row.role] ?? row.role}</td>
                <td className="text-muted">{row.branch ?? "—"}</td>
                <td className="tnum text-muted">{row.phone ?? "—"}</td>
                <td className="num text-muted">{row.salesCount}</td>
                <td className="num font-semibold">
                  {formatMoney(Number(row.salesTotal), currency)}
                </td>
                <td>
                  <span className="flex gap-1">
                    <span
                      className={`chip ${
                        row.isActive ? "bg-positive-soft text-positive" : "bg-surface-3 text-muted"
                      }`}
                    >
                      {row.isActive ? "Active" : "Disabled"}
                    </span>
                    {row.hasPin && <span className="chip bg-surface-3 text-muted">PIN set</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
