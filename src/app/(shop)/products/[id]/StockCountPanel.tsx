"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { recountStock, type StockFormState } from "../actions";

/**
 * Correcting stock by counting it, rather than by typing a new number into the
 * product record. The difference is posted to Stock Adjustments, so shrinkage
 * shows up in the P&L instead of quietly changing the inventory value.
 */
export function StockCountPanel({
  productId,
  onHand,
  unit,
  canAdjust,
}: {
  productId: string;
  onHand: number;
  unit: string;
  canAdjust: boolean;
}) {
  const action = recountStock.bind(null, productId);
  const [state, formAction] = useActionState<StockFormState, FormData>(action, {});

  return (
    <section className="card p-5">
      <h2 className="text-[0.9375rem] font-bold tracking-tight">Stock count</h2>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
        Enter what is actually on the shelf. The difference is recorded as an adjustment with a
        reason, and written off to (or recovered from) Stock Adjustments.
      </p>

      {!canAdjust ? (
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5 text-[0.8125rem] text-muted">
          Your role cannot adjust stock.
        </p>
      ) : (
        <form action={formAction} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Counted quantity ({unit})</span>
              <input
                name="countedQuantity"
                defaultValue={onHand}
                inputMode="decimal"
                required
                className="input tnum text-right"
              />
            </label>
            <label className="block">
              <span className="label">Reason</span>
              <input
                name="note"
                placeholder="Monthly stock take"
                maxLength={200}
                className="input"
              />
            </label>
          </div>

          {state.error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[0.8125rem] font-medium text-danger">
              {state.error}
            </p>
          )}
          {state.message && (
            <p role="status" className="rounded-lg bg-positive-soft px-3 py-2 text-[0.8125rem] font-medium text-positive">
              {state.message}
            </p>
          )}

          <SubmitButton className="btn btn-secondary px-4 py-2.5" pendingLabel="Adjusting…">
            Record count
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
