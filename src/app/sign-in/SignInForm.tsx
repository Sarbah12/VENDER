"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { signIn, type SignInState } from "./actions";

export function SignInForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});

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

      <label className="block">
        <span className="label">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <SubmitButton className="btn btn-primary w-full py-3" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
