"use client";

import { useActionState } from "react";

import { PasswordField } from "@/components/PasswordField";
import { SubmitButton } from "@/components/SubmitButton";
import { resetPassword, type ResetState } from "./actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetState, FormData>(resetPassword, {});

  return (
    <form action={formAction} className="card space-y-4 p-6">
      <input type="hidden" name="token" value={token} />

      <h2 className="text-base font-bold tracking-tight">Set a new password</h2>

      <PasswordField
        name="password"
        label="New password"
        autoComplete="new-password"
        minLength={12}
        autoFocus
        hint="At least 12 characters."
      />

      <PasswordField name="confirm" label="Confirm new password" autoComplete="new-password" />

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SubmitButton className="btn btn-primary w-full py-3" pendingLabel="Saving…">
        Set password
      </SubmitButton>
    </form>
  );
}
