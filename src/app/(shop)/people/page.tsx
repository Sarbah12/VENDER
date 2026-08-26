import { asc, count, eq, sql } from "drizzle-orm";
import { Clock, X } from "lucide-react";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { branches, employees, sales } from "@/db/schema";
import { formatDate } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";
import { ROLE_LABEL } from "@/server/authz";
import { getShopContext } from "@/server/context";
import { canInvite, listPendingInvitations, type StaffRole } from "@/server/invitations";
import { cancelInvitation, deactivateStaff } from "./actions";
import { InviteForm } from "./InviteForm";

export const metadata = { title: "People" };
export const dynamic = "force-dynamic";

const ALL_ROLES: StaffRole[] = ["owner", "manager", "cashier", "stock_clerk"];

export default async function PeoplePage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;
  const role = context.role as StaffRole;

  const invitableRoles = ALL_ROLES.filter((target) => canInvite(role, target));
  const isOwner = role === "owner";

  const [staff, pending] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employees.name,
        role: employees.role,
        phone: employees.phone,
        email: employees.email,
        isActive: employees.isActive,
        hasLogin: sql<boolean>`${employees.userId} is not null`,
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
        employees.email,
        employees.isActive,
        employees.userId,
        employees.pinHash,
        branches.name,
      )
      .orderBy(asc(employees.name)),

    listPendingInvitations(context.business.id),
  ]);

  return (
    <div className="space-y-5">
      {invitableRoles.length > 0 && <InviteForm invitableRoles={invitableRoles} />}

      {pending.length > 0 && (
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <Clock size={16} className="text-warning" />
            <h2 className="text-[0.9375rem] font-bold tracking-tight">Waiting to be accepted</h2>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {pending.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-semibold">
                    {invitation.email}
                  </span>
                  <span className="block text-[0.6875rem] text-muted">
                    {ROLE_LABEL[invitation.role]}
                    {invitation.invitedBy ? ` · invited by ${invitation.invitedBy}` : ""} · expires{" "}
                    {formatDate(invitation.expiresAt)}
                  </span>
                </span>
                {invitableRoles.length > 0 && (
                  <form action={cancelInvitation}>
                    <input type="hidden" name="invitationId" value={invitation.id} />
                    <button
                      type="submit"
                      className="btn btn-ghost px-3 py-1.5 text-[0.75rem]"
                      title="Revoke this invitation"
                    >
                      <X size={13} />
                      Revoke
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[0.9375rem] font-bold tracking-tight">Your team</h2>
          <p className="mt-0.5 text-[0.75rem] text-muted">
            A login signs in to the app; a PIN identifies who rang up a sale at the counter. Someone
            can have either, or both.
          </p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Access</th>
                <th className="num">Sales</th>
                <th className="num">Value</th>
                <th>Status</th>
                {isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {staff.map((person) => (
                <tr key={person.id} className={person.isActive ? undefined : "opacity-60"}>
                  <td>
                    <span className="block font-semibold">{person.name}</span>
                    {person.email && (
                      <span className="block text-[0.6875rem] text-muted">{person.email}</span>
                    )}
                  </td>
                  <td className="text-muted">{ROLE_LABEL[person.role] ?? person.role}</td>
                  <td className="text-muted">{person.branch ?? "—"}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {person.hasLogin && (
                        <span className="chip bg-info-soft text-info">Login</span>
                      )}
                      {person.hasPin && <span className="chip bg-surface-3 text-muted">PIN</span>}
                      {!person.hasLogin && !person.hasPin && (
                        <span className="text-[0.75rem] text-faint">None yet</span>
                      )}
                    </span>
                  </td>
                  <td className="num text-muted">{person.salesCount}</td>
                  <td className="num font-semibold">
                    {formatMoney(Number(person.salesTotal), currency)}
                  </td>
                  <td>
                    <span
                      className={`chip ${
                        person.isActive
                          ? "bg-positive-soft text-positive"
                          : "bg-surface-3 text-muted"
                      }`}
                    >
                      {person.isActive ? "Active" : "Removed"}
                    </span>
                  </td>
                  {isOwner && (
                    <td>
                      {person.isActive && person.id !== context.employee?.id && (
                        <form action={deactivateStaff}>
                          <input type="hidden" name="employeeId" value={person.id} />
                          <button
                            type="submit"
                            className="btn btn-ghost px-2.5 py-1 text-[0.75rem] hover:text-danger"
                          >
                            Remove
                          </button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-[0.75rem] text-muted">
          Removing someone revokes their access immediately. Their past sales stay on the books,
          still attributed to them — a receipt has to keep saying who served the customer.
        </p>
      </section>
    </div>
  );
}
