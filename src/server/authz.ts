import "server-only";

import type { Employee } from "@/db/schema";

/**
 * A small, explicit permission table.
 *
 * The roles were always in the schema but nothing enforced them, which meant a
 * cashier could rewrite the price list. This closes that for the actions that
 * now exist; it is deliberately a lookup rather than a framework, because a
 * permission system nobody can read in one screen is one nobody audits.
 */
export type Permission =
  | "catalogue:write"
  | "catalogue:import"
  | "stock:adjust"
  | "sale:record"
  | "sale:refund"
  | "settings:write"
  | "people:write";

const GRANTS: Record<Employee["role"], Permission[]> = {
  owner: [
    "catalogue:write",
    "catalogue:import",
    "stock:adjust",
    "sale:record",
    "sale:refund",
    "settings:write",
    "people:write",
  ],
  manager: ["catalogue:write", "catalogue:import", "stock:adjust", "sale:record", "sale:refund"],
  stock_clerk: ["catalogue:write", "catalogue:import", "stock:adjust"],
  cashier: ["sale:record"],
};

export function can(employee: Pick<Employee, "role"> | null, permission: Permission): boolean {
  if (!employee) return false;
  return GRANTS[employee.role]?.includes(permission) ?? false;
}

export class NotAllowedError extends Error {
  constructor(readonly permission: Permission) {
    super("You do not have permission to do that.");
    this.name = "NotAllowedError";
  }
}

/** Throws unless the employee holds the permission. Use at the top of an action. */
export function requirePermission(
  employee: Pick<Employee, "role"> | null,
  permission: Permission,
): void {
  if (!can(employee, permission)) throw new NotAllowedError(permission);
}

export const ROLE_LABEL: Record<Employee["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  stock_clerk: "Stock clerk",
};
