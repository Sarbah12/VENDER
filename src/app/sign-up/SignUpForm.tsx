"use client";

import { useActionState } from "react";

import { PasswordField } from "@/components/PasswordField";
import { SubmitButton } from "@/components/SubmitButton";
import { signUp, type SignUpState } from "./actions";

export function SignUpForm() {
  const [state, formAction] = useActionState<SignUpState, FormData>(signUp, {});
  const error = (name: string) => state.fieldErrors?.[name];

  return (
    <form action={formAction} className="card space-y-4 p-6">
      <Field label="Your name" error={error("name")}>
        <input name="name" autoComplete="name" required autoFocus maxLength={120} className="input" />
      </Field>

      <Field label="Email" error={error("email")}>
        <input name="email" type="email" autoComplete="email" required maxLength={200} className="input" />
      </Field>

      <PasswordField
        name="password"
        label="Password"
        autoComplete="new-password"
        minLength={12}
        error={error("password")}
        hint="At least 12 characters. Length beats symbols."
      />

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SubmitButton className="btn btn-primary w-full py-3" pendingLabel="Creating your account…">
        Create account
      </SubmitButton>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[0.6875rem] font-medium text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[0.6875rem] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
