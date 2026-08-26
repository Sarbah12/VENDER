"use client";

import { useActionState } from "react";

import { PasswordField } from "@/components/PasswordField";
import { SubmitButton } from "@/components/SubmitButton";
import { accept, type AcceptState } from "./actions";

export function AcceptForm({
  token,
  hasAccount,
  email,
}: {
  token: string;
  /** Someone who already has a login needs no password — just the membership. */
  hasAccount: boolean;
  email: string;
}) {
  const [state, formAction] = useActionState<AcceptState, FormData>(accept, {});

  return (
    <form action={formAction} className="card space-y-4 p-6">
      <input type="hidden" name="token" value={token} />

      {hasAccount ? (
        <p className="text-[0.875rem] leading-relaxed text-muted">
          You already have an account for <span className="font-semibold text-ink">{email}</span>.
          Accepting adds this business to it — your existing password does not change.
        </p>
      ) : (
        <>
          <label className="block">
            <span className="label">Your name</span>
            <input
              name="name"
              required
              autoFocus
              maxLength={120}
              autoComplete="name"
              className="input"
            />
          </label>

          <PasswordField
            name="password"
            label="Choose a password"
            autoComplete="new-password"
            minLength={12}
            hint="At least 12 characters."
          />

          <PasswordField name="confirm" label="Confirm password" autoComplete="new-password" />
        </>
      )}

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SubmitButton className="btn btn-primary w-full py-3" pendingLabel="Joining…">
        {hasAccount ? "Accept invitation" : "Create account and join"}
      </SubmitButton>
    </form>
  );
}
