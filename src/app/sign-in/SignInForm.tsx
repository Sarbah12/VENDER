"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { signIn, type SignInState } from "./actions";

type Staff = { id: string; name: string; role: string };
type Register = { id: string; name: string };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  stock_clerk: "Stock clerk",
};

const PIN_LENGTH = 4;

export function SignInForm({ staff, registers }: { staff: Staff[]; registers: Register[] }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});
  const [employeeId, setEmployeeId] = useState(staff[0]?.id ?? "");
  const [registerId, setRegisterId] = useState(registers[0]?.id ?? "");
  const [pin, setPin] = useState("");

  const press = (digit: string) => setPin((current) => (current + digit).slice(0, PIN_LENGTH));

  return (
    <form action={formAction} className="card p-6">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="registerId" value={registerId} />
      <input type="hidden" name="pin" value={pin} />

      <fieldset>
        <legend className="label">Who is on the till</legend>
        <div className="grid gap-2">
          {staff.map((person) => {
            const selected = person.id === employeeId;
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => {
                  setEmployeeId(person.id);
                  setPin("");
                }}
                aria-pressed={selected}
                className={`flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-surface-2 hover:bg-surface-3"
                }`}
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    selected ? "bg-brand text-white" : "bg-surface-3 text-muted"
                  }`}
                >
                  {initials(person.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{person.name}</span>
                  <span className="block text-xs text-muted">
                    {ROLE_LABEL[person.role] ?? person.role}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {registers.length > 1 && (
        <div className="mt-5">
          <span className="label">Till</span>
          <div className="flex gap-2">
            {registers.map((register) => (
              <button
                key={register.id}
                type="button"
                onClick={() => setRegisterId(register.id)}
                aria-pressed={register.id === registerId}
                className={`flex-1 rounded-[10px] border px-3 py-2 text-sm font-semibold transition-colors ${
                  register.id === registerId
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-surface-2 text-muted hover:bg-surface-3"
                }`}
              >
                {register.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <span className="label">PIN</span>
        <div className="mb-4 flex justify-center gap-3" aria-live="polite">
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              className={`size-3.5 rounded-full transition-colors ${
                i < pin.length ? "bg-brand" : "bg-surface-3 ring-1 ring-line-strong"
              }`}
            />
          ))}
          <span className="sr-only">{pin.length} of {PIN_LENGTH} digits entered</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <PinKey key={digit} onClick={() => press(digit)}>
              {digit}
            </PinKey>
          ))}
          <PinKey onClick={() => setPin("")} muted>
            Clear
          </PinKey>
          <PinKey onClick={() => press("0")}>0</PinKey>
          <PinKey onClick={() => setPin((c) => c.slice(0, -1))} muted aria-label="Delete last digit">
            ←
          </PinKey>
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="mt-4 rounded-[10px] bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      )}

      <SubmitButton
        className="btn btn-primary mt-5 w-full py-3"
        pendingLabel="Checking…"
        disabled={pin.length < PIN_LENGTH || !employeeId}
      >
        Open till
      </SubmitButton>
    </form>
  );
}

function PinKey({
  children,
  onClick,
  muted,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  muted?: boolean;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-14 rounded-[10px] border border-line text-lg font-semibold tnum transition-colors active:translate-y-px ${
        muted ? "bg-surface-2 text-sm text-muted" : "bg-surface hover:bg-surface-3"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
