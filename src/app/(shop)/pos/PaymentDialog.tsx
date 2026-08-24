"use client";

import { Banknote, CreditCard, Landmark, Smartphone, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatAmount, formatMoney, parseMoney } from "@/lib/money";
import { Spinner } from "@/components/SubmitButton";
import type { Tender } from "./types";

type Method = Tender["method"];

const METHODS: Array<{ id: Method; label: string; icon: typeof Banknote }> = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "mobile_money", label: "Mobile Money", icon: Smartphone },
  { id: "card", label: "Card", icon: CreditCard },
  { id: "bank_transfer", label: "Transfer", icon: Landmark },
];

/** Notes a Ghanaian cashier is actually handed. Swap with the currency later. */
const QUICK_NOTES = [500, 1000, 2000, 5000, 10_000, 20_000];

export function PaymentDialog({
  total,
  currencyCode,
  busy,
  hasCustomer,
  onClose,
  onConfirm,
}: {
  total: number;
  currencyCode: string;
  busy: boolean;
  hasCustomer: boolean;
  onClose: () => void;
  onConfirm: (tenders: Tender[]) => void | Promise<void>;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState<Method>("cash");
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  const paid = useMemo(() => tenders.reduce((acc, t) => acc + t.amount, 0), [tenders]);
  const remaining = Math.max(0, total - paid);
  const change = Math.max(0, paid - total);
  const hasCash = tenders.some((t) => t.method === "cash");

  // Change comes out of the drawer, so an overpayment with no cash in the mix
  // is not something the till can settle.
  const overpaidWithoutCash = change > 0 && !hasCash;
  const isCreditSale = remaining > 0;
  const canConfirm =
    !busy && !overpaidWithoutCash && (remaining === 0 || (isCreditSale && hasCustomer));

  useEffect(() => {
    amountRef.current?.focus();
  }, [method]);

  const addTender = (amount: number) => {
    if (amount <= 0) return;
    setTenders((current) => [
      ...current,
      {
        key: `${Date.now()}-${current.length}`,
        method,
        amount,
        reference: reference.trim() || null,
      },
    ]);
    setAmountText("");
    setReference("");
  };

  const typedAmount = parseMoney(amountText, currencyCode) ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Take payment"
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="card animate-rise flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden shadow-lg">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-base font-bold tracking-tight">Take payment</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[1fr_18rem]">
          {/* ── Entry side ────────────────────────────────────────────── */}
          <div className="border-line p-5 md:border-r">
            <div className="flex gap-1.5">
              {METHODS.map((item) => {
                const Icon = item.icon;
                const active = method === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMethod(item.id)}
                    aria-pressed={active}
                    className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-[0.75rem] font-semibold transition-colors ${
                      active
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-line bg-surface-2 text-muted hover:bg-surface-3"
                    }`}
                  >
                    <Icon size={17} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <label className="mt-4 block">
              <span className="label">Amount tendered</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">
                  {currencyCode}
                </span>
                <input
                  ref={amountRef}
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTender(typedAmount || remaining);
                    }
                  }}
                  inputMode="decimal"
                  placeholder={formatAmount(remaining, currencyCode)}
                  className="input tnum py-3 pl-14 text-right text-xl font-bold"
                />
              </div>
            </label>

            {method !== "cash" && (
              <label className="mt-3 block">
                <span className="label">Reference {method === "mobile_money" ? "(MoMo ID)" : "(auth code)"}</span>
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Optional"
                  className="input py-2 text-sm"
                />
              </label>
            )}

            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => addTender(remaining)}
                disabled={remaining === 0}
                className="btn btn-secondary col-span-4 py-2.5 text-[0.8125rem] sm:col-span-1"
              >
                Exact
              </button>
              {method === "cash" &&
                QUICK_NOTES.filter((note) => note >= remaining || note >= 1000).slice(0, 6).map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => addTender(note)}
                    className="btn btn-secondary tnum py-2.5 text-[0.8125rem]"
                  >
                    {formatAmount(note, currencyCode)}
                  </button>
                ))}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setAmountText((current) =>
                      key === "⌫" ? current.slice(0, -1) : `${current}${key}`,
                    )
                  }
                  className="tnum rounded-lg border border-line bg-surface py-3 text-base font-semibold transition-colors hover:bg-surface-3 active:translate-y-px"
                >
                  {key}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addTender(typedAmount)}
              disabled={typedAmount <= 0}
              className="btn btn-secondary mt-2 w-full py-2.5"
            >
              Add {typedAmount > 0 ? formatMoney(typedAmount, currencyCode) : "tender"}
            </button>
          </div>

          {/* ── Summary side ──────────────────────────────────────────── */}
          <div className="flex flex-col bg-surface-2 p-5">
            <div>
              <span className="label">Amount due</span>
              <p className="tnum text-[1.75rem] font-bold leading-none tracking-tight">
                {formatMoney(total, currencyCode)}
              </p>
            </div>

            <ul className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {tenders.length === 0 ? (
                <li className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-muted">
                  No payment added yet
                </li>
              ) : (
                tenders.map((tender) => (
                  <li
                    key={tender.key}
                    className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] font-semibold">
                        {METHODS.find((m) => m.id === tender.method)?.label ?? tender.method}
                      </span>
                      {tender.reference && (
                        <span className="block truncate text-[0.6875rem] text-muted">
                          {tender.reference}
                        </span>
                      )}
                    </span>
                    <span className="tnum text-[0.8125rem] font-bold">
                      {formatMoney(tender.amount, currencyCode)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTenders((c) => c.filter((t) => t.key !== tender.key))}
                      aria-label="Remove payment"
                      className="rounded p-0.5 text-faint hover:text-danger"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))
              )}
            </ul>

            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[0.8125rem]">
              <div className="flex justify-between">
                <dt className="text-muted">Tendered</dt>
                <dd className="tnum font-semibold">{formatMoney(paid, currencyCode)}</dd>
              </div>
              {remaining > 0 && (
                <div className="flex justify-between">
                  <dt className="font-semibold text-warning">Still owing</dt>
                  <dd className="tnum font-bold text-warning">
                    {formatMoney(remaining, currencyCode)}
                  </dd>
                </div>
              )}
              {change > 0 && (
                <div className="flex items-baseline justify-between">
                  <dt className="font-semibold text-positive">Change</dt>
                  <dd className="tnum text-lg font-bold text-positive">
                    {formatMoney(change, currencyCode)}
                  </dd>
                </div>
              )}
            </dl>

            {overpaidWithoutCash && (
              <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                Change can only be given from cash. Reduce the tender or add a cash payment.
              </p>
            )}
            {isCreditSale && !hasCustomer && (
              <p role="alert" className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs font-medium text-warning">
                Pick a customer to leave {formatMoney(remaining, currencyCode)} on account.
              </p>
            )}
            {isCreditSale && hasCustomer && (
              <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-xs font-medium text-info">
                {formatMoney(remaining, currencyCode)} will be charged to the customer&apos;s account.
              </p>
            )}

            <button
              type="button"
              onClick={() => void onConfirm(tenders)}
              disabled={!canConfirm}
              className="btn btn-primary mt-4 w-full py-3.5 text-[0.9375rem]"
            >
              {busy && <Spinner />}
              {busy ? "Completing…" : isCreditSale ? "Complete on account" : "Complete sale"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
