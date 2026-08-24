"use client";

import { Plus } from "lucide-react";
import { useActionState, useRef } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { createCategory, type CategoryFormState } from "../actions";

const SWATCHES = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#dc2626",
  "#475569",
];

export function NewCategoryForm() {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(createCategory, {});
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
      <h2 className="text-[0.9375rem] font-bold tracking-tight">Add a category</h2>
      <p className="mt-1 text-[0.75rem] text-muted">
        Groups products on the till, so a cashier finds things by tapping rather than typing.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[12rem] flex-1">
          <span className="label">Name</span>
          <input name="name" required maxLength={80} placeholder="Frozen goods" className="input" />
        </label>

        <fieldset>
          <legend className="label">Colour</legend>
          <div className="flex gap-1.5">
            {SWATCHES.map((colour, index) => (
              <label key={colour} className="cursor-pointer">
                <input
                  type="radio"
                  name="colour"
                  value={colour}
                  defaultChecked={index === 0}
                  className="peer sr-only"
                />
                <span
                  className="block size-8 rounded-lg ring-offset-2 ring-offset-[var(--surface)] peer-checked:ring-2 peer-checked:ring-[var(--brand)]"
                  style={{ background: colour }}
                  title={colour}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <SubmitButton className="btn btn-primary px-4 py-2.5" pendingLabel="Adding…">
          <Plus size={15} />
          Add category
        </SubmitButton>
      </div>

      {state.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[0.8125rem] font-medium text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
