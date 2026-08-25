"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

/**
 * A password input you can read back.
 *
 * Hiding what you type is a habit from shared terminals, and on a personal
 * machine it mostly causes typos and pushes people towards shorter passwords
 * they can get right blind. Being able to check what you typed is what makes a
 * twelve-character minimum reasonable to ask for.
 *
 * It starts hidden — someone signing in at a counter may well have a customer
 * looking over their shoulder — and revealing is a deliberate act.
 */
export function PasswordField({
  name,
  label,
  autoComplete,
  hint,
  error,
  minLength,
  required = true,
  autoFocus,
}: {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  error?: string;
  minLength?: number;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const describedBy = `${id}-note`;

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={name}
          // Switching type keeps the field a real password input while hidden,
          // so password managers still recognise and fill it.
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          autoFocus={autoFocus}
          aria-describedby={hint || error ? describedBy : undefined}
          aria-invalid={error ? true : undefined}
          className="input pr-11"
        />

        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          // Excluded from tab order: reaching the submit button should not mean
          // tabbing through a control that reveals the password on Enter.
          tabIndex={-1}
          className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink"
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>

      {error ? (
        <p id={describedBy} className="mt-1 text-[0.6875rem] font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-1 text-[0.6875rem] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
