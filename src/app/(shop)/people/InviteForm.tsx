"use client";

import { UserPlus } from "lucide-react";
import { useActionState, useRef } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { sendInvitation, type InviteState } from "./actions";
import type { StaffRole } from "@/server/invitations";

const ROLE_HELP: Record<StaffRole, string> = {
  owner: "Everything, including inviting other owners.",
  manager: "Sell, manage the catalogue and stock, invite counter staff.",
  cashier: "Sell at the till. Cannot change prices.",
  stock_clerk: "Manage the catalogue and stock. Cannot sell.",
};

export function InviteForm({ invitableRoles }: { invitableRoles: StaffRole[] }) {
  const [state, formAction] = useActionState<InviteState, FormData>(sendInvitation, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await formAction(formData);
        formRef.current?.reset();
      }}
      className="card p-5"
    >
      <h2 className="text-[0.9375rem] font-bold tracking-tight">Invite someone</h2>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
        They get an email with a link to set their own password. Nothing is added to your team
        until they accept, and the link lasts seven days.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[14rem] flex-1">
          <span className="label">Their email</span>
          <input
            name="email"
            type="email"
            required
            maxLength={200}
            placeholder="name@example.com"
            className="input"
          />
        </label>

        <label className="min-w-[10rem]">
          <span className="label">Role</span>
          <select name="role" defaultValue={invitableRoles[0]} className="input">
            {invitableRoles.map((role) => (
              <option key={role} value={role}>
                {LABEL[role]}
              </option>
            ))}
          </select>
        </label>

        <SubmitButton className="btn btn-primary px-4 py-2.5" pendingLabel="Sending…">
          <UserPlus size={15} />
          Send invitation
        </SubmitButton>
      </div>

      <ul className="mt-4 space-y-1">
        {invitableRoles.map((role) => (
          <li key={role} className="text-[0.75rem] text-muted">
            <span className="font-semibold text-ink">{LABEL[role]}</span> — {ROLE_HELP[role]}
          </li>
        ))}
      </ul>

      {state.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[0.8125rem] font-medium text-danger">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="mt-3 rounded-lg bg-positive-soft px-3 py-2 text-[0.8125rem] font-medium text-positive">
          {state.message}
        </p>
      )}
    </form>
  );
}

const LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  stock_clerk: "Stock clerk",
};
