"use client";

import { MailCheck } from "lucide-react";
import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { requestReset, type ForgotState } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ForgotState, FormData>(requestReset, {});

  if (state.sent) {
    return (
      <div className="card p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-positive-soft text-positive">
          <MailCheck size={22} />
        </span>
        <h2 className="mt-4 text-base font-bold tracking-tight">Check your email</h2>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-muted">
          If there is an account with that address, a link to set a new password is on its way. It
          is good for one hour.
        </p>
        <p className="mt-3 text-[0.75rem] text-muted">
          Nothing arrived? Check spam, then try again — the link may take a minute.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-4 p-6">
      <label className="block">
        <span className="label">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          maxLength={200}
          className="input"
        />
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SubmitButton className="btn btn-primary w-full py-3" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
