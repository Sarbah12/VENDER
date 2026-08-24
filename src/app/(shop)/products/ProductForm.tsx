"use client";

import Link from "next/link";
import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { bpToPercent, formatAmount } from "@/lib/money";
import { saveProduct, type ProductFormState } from "./actions";

export type ProductFormValues = {
  id: string | null;
  sku: string;
  name: string;
  barcode: string;
  categoryId: string;
  unit: string;
  costPrice: number;
  sellPrice: number;
  taxRateBp: number | null;
  trackStock: boolean;
  allowNegativeStock: boolean;
  reorderPoint: number;
  isActive: boolean;
};

export const BLANK_PRODUCT: ProductFormValues = {
  id: null,
  sku: "",
  name: "",
  barcode: "",
  categoryId: "",
  unit: "pc",
  costPrice: 0,
  sellPrice: 0,
  taxRateBp: null,
  trackStock: true,
  allowNegativeStock: false,
  reorderPoint: 0,
  isActive: true,
};

const UNITS = ["pc", "kg", "g", "L", "ml", "pack", "box", "carton", "bag", "tin", "bottle", "crate"];

export function ProductForm({
  values,
  categories,
  currencyCode,
  defaultTaxPercent,
  onHandLabel,
}: {
  values: ProductFormValues;
  categories: Array<{ id: string; name: string }>;
  currencyCode: string;
  defaultTaxPercent: number;
  /** Shown when editing, since stock is changed by counting rather than typing. */
  onHandLabel?: string;
}) {
  const isEdit = values.id !== null;
  const action = saveProduct.bind(null, values.id);
  const [state, formAction] = useActionState<ProductFormState, FormData>(action, {});
  const fieldError = (name: string) => state.fieldErrors?.[name];

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">What it is</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="name" error={fieldError("name")} className="sm:col-span-2">
            <input
              name="name"
              defaultValue={values.name}
              required
              maxLength={200}
              autoFocus={!isEdit}
              placeholder="Voltic Water 750ml"
              className="input"
            />
          </Field>

          <Field label="SKU / item code" name="sku" error={fieldError("sku")} hint="Must be unique.">
            <input
              name="sku"
              defaultValue={values.sku}
              required
              maxLength={60}
              placeholder="DRK-001"
              className="input tnum"
            />
          </Field>

          <Field
            label="Barcode"
            name="barcode"
            error={fieldError("barcode")}
            hint="Needed for scanning at the till."
          >
            <input
              name="barcode"
              defaultValue={values.barcode}
              maxLength={60}
              inputMode="numeric"
              placeholder="6001240100011"
              className="input tnum"
            />
          </Field>

          <Field label="Category" name="categoryId">
            <select name="categoryId" defaultValue={values.categoryId} className="input">
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Unit" name="unit" hint="How it is sold.">
            <input
              name="unit"
              defaultValue={values.unit}
              list="unit-options"
              maxLength={20}
              className="input"
            />
            <datalist id="unit-options">
              {UNITS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Money</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field
            label={`Cost price (${currencyCode})`}
            name="costPrice"
            error={fieldError("costPrice")}
            hint="What you pay. Drives profit."
          >
            <input
              name="costPrice"
              defaultValue={values.costPrice ? formatAmount(values.costPrice, currencyCode) : ""}
              inputMode="decimal"
              placeholder="0.00"
              className="input tnum text-right"
            />
          </Field>

          <Field
            label={`Sell price (${currencyCode})`}
            name="sellPrice"
            error={fieldError("sellPrice")}
            hint="What the customer pays."
          >
            <input
              name="sellPrice"
              defaultValue={values.sellPrice ? formatAmount(values.sellPrice, currencyCode) : ""}
              inputMode="decimal"
              required
              placeholder="0.00"
              className="input tnum text-right"
            />
          </Field>

          <Field
            label="Tax rate %"
            name="taxRate"
            error={fieldError("taxRate")}
            hint={`Blank uses the shop default of ${defaultTaxPercent}%.`}
          >
            <input
              name="taxRate"
              defaultValue={values.taxRateBp === null ? "" : String(bpToPercent(values.taxRateBp))}
              inputMode="decimal"
              placeholder={String(defaultTaxPercent)}
              className="input tnum text-right"
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">Stock</h2>
        <div className="mt-4 space-y-4">
          <Toggle
            name="trackStock"
            defaultChecked={values.trackStock}
            label="Keep count of this item"
            hint="Turn off for services like airtime or photocopying."
          />
          <Toggle
            name="allowNegativeStock"
            defaultChecked={values.allowNegativeStock}
            label="Allow selling below zero"
            hint="For goods sold from a delivery that has not been booked in yet."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Reorder point"
              name="reorderPoint"
              error={fieldError("reorderPoint")}
              hint="Flagged on the dashboard at or below this."
            >
              <input
                name="reorderPoint"
                defaultValue={values.reorderPoint || ""}
                inputMode="decimal"
                placeholder="0"
                className="input tnum text-right"
              />
            </Field>

            {isEdit ? (
              <div>
                <span className="label">On hand</span>
                <p className="tnum rounded-lg bg-surface-2 px-3 py-2.5 text-sm font-semibold">
                  {onHandLabel ?? "—"}
                </p>
                <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted">
                  Stock is changed by counting it, not by typing a new number — so every movement
                  has a reason behind it. Use the stock count panel below.
                </p>
              </div>
            ) : (
              <Field
                label="Opening stock"
                name="openingStock"
                error={fieldError("openingStock")}
                hint="Counted-in quantity. Posts to Inventory at cost."
              >
                <input
                  name="openingStock"
                  defaultValue=""
                  inputMode="decimal"
                  placeholder="0"
                  className="input tnum text-right"
                />
              </Field>
            )}
          </div>

          <Toggle
            name="isActive"
            defaultChecked={values.isActive}
            label="Available to sell"
            hint="Turn off to retire an item without losing its history."
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn btn-primary px-5 py-2.5" pendingLabel="Saving…">
          {isEdit ? "Save changes" : "Add product"}
        </SubmitButton>
        <Link href="/products" className="btn btn-secondary px-5 py-2.5">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`} htmlFor={name}>
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

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
      />
      <span>
        <span className="block text-[0.875rem] font-semibold">{label}</span>
        <span className="block text-[0.75rem] text-muted">{hint}</span>
      </span>
    </label>
  );
}
