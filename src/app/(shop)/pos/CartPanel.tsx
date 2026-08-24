"use client";

import { CloudOff, Minus, Plus, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import { useState } from "react";

import type { PricedLine, SaleTotals } from "@/domain/pricing";
import { formatMoney, formatQty, parseMoney } from "@/lib/money";
import type { CartLine, PosCustomer } from "./types";

export function CartPanel({
  lines,
  priced,
  totals,
  currencyCode,
  customers,
  customerId,
  registerName,
  cashierName,
  queued,
  busy,
  onCustomerChange,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onClear,
  onPay,
}: {
  lines: CartLine[];
  priced: PricedLine[];
  totals: SaleTotals;
  currencyCode: string;
  customers: PosCustomer[];
  customerId: string | null;
  registerName: string;
  cashierName: string;
  queued: number;
  busy: boolean;
  onCustomerChange: (id: string | null) => void;
  onQuantityChange: (key: string, quantity: number) => void;
  onDiscountChange: (key: string, discount: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onPay: () => void;
}) {
  const itemCount = lines.reduce((acc, l) => acc + l.quantity, 0);

  return (
    <aside
      aria-label="Current sale"
      className="flex w-[23rem] shrink-0 flex-col border-l border-line bg-surface xl:w-[25rem]"
    >
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-bold tracking-tight">Current sale</h2>
            <p className="truncate text-[0.6875rem] text-muted">
              {registerName} · {cashierName}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {queued > 0 && (
              <span
                className="chip bg-warning-soft text-warning"
                title="Sales recorded while offline, waiting to reach the server"
              >
                <CloudOff size={12} />
                {queued}
              </span>
            )}
            <span className="chip tnum bg-surface-3 text-muted">
              {formatQty(itemCount)} item{itemCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="relative mt-2.5">
          <UserRound
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <select
            value={customerId ?? ""}
            onChange={(event) => onCustomerChange(event.target.value || null)}
            aria-label="Customer"
            className="input appearance-none py-2 pl-9 pr-8 text-[0.8125rem]"
          >
            <option value="">Walk-in — no account</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.phone ? ` · ${customer.phone}` : ""}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-surface-3">
              <ShoppingCart size={22} className="text-faint" />
            </span>
            <p className="text-sm font-semibold">Nothing on the counter yet</p>
            <p className="text-xs leading-relaxed text-muted">
              Scan a barcode or tap a product. Start typing anywhere to jump to the scan box.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {lines.map((line, index) => (
              <CartRow
                key={line.key}
                line={line}
                price={priced[index]}
                currencyCode={currencyCode}
                onQuantityChange={onQuantityChange}
                onDiscountChange={onDiscountChange}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="shrink-0 border-t border-line bg-surface-2 p-4">
        <dl className="space-y-1.5 text-[0.8125rem]">
          <Row label="Subtotal" value={formatMoney(totals.subtotal, currencyCode)} />
          {totals.discountTotal > 0 && (
            <Row
              label="Discount"
              value={`− ${formatMoney(totals.discountTotal, currencyCode)}`}
              tone="positive"
            />
          )}
          {totals.taxTotal > 0 && <Row label="Tax" value={formatMoney(totals.taxTotal, currencyCode)} />}
          <div className="flex items-baseline justify-between border-t border-line pt-2.5">
            <dt className="text-sm font-bold">Total</dt>
            <dd className="tnum text-[1.5rem] font-bold leading-none tracking-tight">
              {formatMoney(totals.total, currencyCode)}
            </dd>
          </div>
        </dl>

        <div className="mt-3.5 flex gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={lines.length === 0 || busy}
            className="btn btn-secondary px-3"
            aria-label="Clear the sale"
            title="Clear the sale"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={onPay}
            disabled={lines.length === 0 || busy}
            className="btn btn-primary flex-1 py-3.5 text-[0.9375rem]"
          >
            Pay {formatMoney(totals.total, currencyCode)}
            <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[0.625rem] font-semibold">
              F2
            </kbd>
          </button>
        </div>
      </footer>
    </aside>
  );
}

function CartRow({
  line,
  price,
  currencyCode,
  onQuantityChange,
  onDiscountChange,
  onRemove,
}: {
  line: CartLine;
  price: PricedLine | undefined;
  currencyCode: string;
  onQuantityChange: (key: string, quantity: number) => void;
  onDiscountChange: (key: string, discount: number) => void;
  onRemove: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-[0.8125rem] font-semibold leading-tight">
            {line.name}
          </span>
          <span className="tnum block text-[0.6875rem] text-muted">
            {formatMoney(line.unitPrice, currencyCode)} / {line.unit}
            {line.discount > 0 && (
              <span className="ml-1.5 font-semibold text-positive">
                − {formatMoney(line.discount, currencyCode)}
              </span>
            )}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
          <Stepper
            label={`Reduce ${line.name}`}
            onClick={() => onQuantityChange(line.key, roundStep(line.quantity - 1))}
          >
            <Minus size={13} />
          </Stepper>
          <span className="tnum min-w-8 text-center text-[0.8125rem] font-bold">
            {formatQty(line.quantity)}
          </span>
          <Stepper
            label={`Add another ${line.name}`}
            onClick={() => onQuantityChange(line.key, roundStep(line.quantity + 1))}
          >
            <Plus size={13} />
          </Stepper>
        </div>

        <span className="tnum w-[5.5rem] shrink-0 whitespace-nowrap text-right text-[0.8125rem] font-bold">
          {formatMoney(price?.lineTotal ?? 0, currencyCode)}
        </span>

        <button
          type="button"
          onClick={() => onRemove(line.key)}
          aria-label={`Remove ${line.name}`}
          className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <X size={14} />
        </button>
      </div>

      {open && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-2.5">
          <label className="block">
            <span className="label mb-1">Quantity</span>
            <input
              type="number"
              min={0}
              step="0.001"
              defaultValue={line.quantity}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) onQuantityChange(line.key, value);
              }}
              className="input py-1.5 text-[0.8125rem] tnum"
            />
          </label>
          <label className="block">
            <span className="label mb-1">Line discount</span>
            <input
              type="text"
              inputMode="decimal"
              defaultValue={line.discount ? (line.discount / 100).toFixed(2) : ""}
              placeholder="0.00"
              onChange={(event) =>
                onDiscountChange(line.key, parseMoney(event.target.value, currencyCode) ?? 0)
              }
              className="input py-1.5 text-[0.8125rem] tnum"
            />
          </label>
        </div>
      )}
    </li>
  );
}

function Stepper({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink"
    >
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum font-semibold ${tone === "positive" ? "text-positive" : ""}`}>{value}</dd>
    </div>
  );
}

/** Keep whole-unit stepping clean even when a line was set to 0.25 kg by hand. */
function roundStep(value: number): number {
  return Math.round(value * 1000) / 1000;
}
