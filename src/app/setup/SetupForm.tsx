"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { setUpBusiness, type SetupState } from "./actions";

/**
 * A short list of countries with their currency and the sales-tax regime most
 * shops there operate under. It is a starting point the owner can override, not
 * tax advice — the rate they actually charge is theirs to set.
 */
const COUNTRIES: Array<{
  code: string;
  name: string;
  currency: string;
  taxRate: string;
  taxLabel: string;
  inclusive: boolean;
}> = [
  { code: "GH", name: "Ghana", currency: "GHS", taxRate: "3", taxLabel: "VAT Flat Rate", inclusive: true },
  { code: "NG", name: "Nigeria", currency: "NGN", taxRate: "7.5", taxLabel: "VAT", inclusive: true },
  { code: "KE", name: "Kenya", currency: "KES", taxRate: "16", taxLabel: "VAT", inclusive: true },
  { code: "ZA", name: "South Africa", currency: "ZAR", taxRate: "15", taxLabel: "VAT", inclusive: true },
  { code: "GB", name: "United Kingdom", currency: "GBP", taxRate: "20", taxLabel: "VAT", inclusive: true },
  { code: "US", name: "United States", currency: "USD", taxRate: "0", taxLabel: "Sales tax", inclusive: false },
  { code: "CA", name: "Canada", currency: "CAD", taxRate: "5", taxLabel: "GST", inclusive: false },
  { code: "DE", name: "Germany", currency: "EUR", taxRate: "19", taxLabel: "VAT", inclusive: true },
];

export function SetupForm() {
  const [state, formAction] = useActionState<SetupState, FormData>(setUpBusiness, {});
  const [country, setCountry] = useState(COUNTRIES[0]);

  const error = (name: string) => state.fieldErrors?.[name];

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Your business</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Trading name" error={error("businessName")} className="sm:col-span-2">
            <input
              name="businessName"
              required
              maxLength={120}
              autoFocus
              placeholder="What customers call you"
              className="input"
            />
          </Field>

          <Field label="Registered name" hint="Optional — appears on invoices.">
            <input name="legalName" maxLength={160} placeholder="Ltd / Enterprise name" className="input" />
          </Field>

          <Field label="Tax number" hint="Optional — printed on receipts.">
            <input name="taxNumber" maxLength={60} className="input tnum" />
          </Field>

          <Field label="Country" error={error("countryCode")}>
            <select
              name="countryCode"
              value={country.code}
              onChange={(event) =>
                setCountry(COUNTRIES.find((c) => c.code === event.target.value) ?? COUNTRIES[0])
              }
              className="input"
            >
              {COUNTRIES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Currency" error={error("currencyCode")} hint="Every price is held in this.">
            <input
              name="currencyCode"
              key={country.code}
              defaultValue={country.currency}
              required
              maxLength={3}
              className="input uppercase tnum"
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Sales tax</h2>
        <p className="mt-1 text-[0.75rem] text-muted">
          Set what you actually charge. You can change this later, and individual products can
          override it.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={`${country.taxLabel} %`} error={error("taxRate")}>
            <input
              name="taxRate"
              key={country.code}
              defaultValue={country.taxRate}
              inputMode="decimal"
              className="input tnum text-right"
            />
          </Field>

          <label className="flex cursor-pointer items-start gap-3 self-end pb-2">
            <input
              type="checkbox"
              name="pricesIncludeTax"
              key={country.code}
              defaultChecked={country.inclusive}
              className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
            />
            <span>
              <span className="block text-[0.875rem] font-semibold">Shelf prices include tax</span>
              <span className="block text-[0.75rem] text-muted">
                On means the price on the shelf is what the customer pays.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">This shop</h2>
        <p className="mt-1 text-[0.75rem] text-muted">
          Your first branch, with a stockroom and one till. More can be added later.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Shop or branch name" error={error("branchName")}>
            <input name="branchName" required maxLength={120} placeholder="Main Shop" className="input" />
          </Field>
          <Field label="Phone" hint="Printed on receipts.">
            <input name="branchPhone" maxLength={40} className="input tnum" />
          </Field>
          <Field label="Address" hint="Printed on receipts." className="sm:col-span-2">
            <input name="branchAddress" maxLength={200} className="input" />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Your login</h2>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
          A four-digit PIN opens the till. It identifies who rang up each sale — treat it as a till
          code, not a password, and do not reuse a bank PIN.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Your name" error={error("ownerName")}>
            <input name="ownerName" required maxLength={120} className="input" />
          </Field>
          <Field label="Till PIN" error={error("ownerPin")}>
            <input
              name="ownerPin"
              required
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              placeholder="••••"
              className="input tnum tracking-[0.4em]"
            />
          </Field>
          <Field label="Confirm PIN" error={error("confirmPin")}>
            <input
              name="confirmPin"
              required
              inputMode="numeric"
              maxLength={4}
              pattern="\d{4}"
              placeholder="••••"
              className="input tnum tracking-[0.4em]"
            />
          </Field>
        </div>
      </section>

      <SubmitButton className="btn btn-primary w-full py-3.5" pendingLabel="Creating your business…">
        Create business
      </SubmitButton>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
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
