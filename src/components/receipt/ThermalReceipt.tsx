import { PAYMENT_LABEL } from "@/domain/accounts";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney, formatQty } from "@/lib/money";
import type { Receipt } from "@/server/receipts";
import type { PaymentMethod } from "@/db/schema";

export type ReceiptLineView = {
  name: string;
  unit: string;
  quantity: number;
  lineTotal: number;
  /** null for a queued sale the server has not priced back yet. */
  unitPrice: number | null;
  discountAmount: number;
};

export type ReceiptView = {
  heading: string;
  branchName?: string | null;
  branchAddress?: string | null;
  branchPhone?: string | null;
  taxNumber?: string | null;
  number: string | null;
  soldAt: string;
  cashier?: string | null;
  customer?: string | null;
  currencyCode: string;
  lines: ReceiptLineView[];
  subtotal: number | null;
  discountTotal: number;
  taxTotal: number;
  total: number;
  payments: Array<{ method: PaymentMethod; amount: number; reference?: string | null }>;
  changeGiven: number;
  balanceDue: number;
  /** Shown on a re-print so nobody mistakes it for the original. */
  reprint?: boolean;
};

/** Turns a stored sale into the shape this component prints. */
export function receiptToView(receipt: Receipt, options?: { reprint?: boolean }): ReceiptView {
  return {
    heading: receipt.business.name,
    branchName: receipt.branch.name,
    branchAddress: receipt.branch.address,
    branchPhone: receipt.branch.phone,
    taxNumber: receipt.business.taxNumber,
    number: receipt.number,
    soldAt: receipt.soldAt,
    cashier: receipt.cashier,
    customer: receipt.customer,
    currencyCode: receipt.currencyCode,
    lines: receipt.lines.map((line) => ({
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
    })),
    subtotal: receipt.subtotal,
    discountTotal: receipt.discountTotal,
    taxTotal: receipt.taxTotal,
    total: receipt.total,
    payments: receipt.payments,
    changeGiven: receipt.changeGiven,
    balanceDue: receipt.balanceDue,
    reprint: options?.reprint,
  };
}

/**
 * The printed artefact, and the only one.
 *
 * The till's confirmation dialog and the re-print from sales history both render
 * this, so a receipt handed over at the counter and one printed from the back
 * office a week later are the same document. Sized for 58–80mm thermal paper by
 * the `@media print` rules in globals.css, which key off the `.receipt` class.
 */
export function ThermalReceipt({ view }: { view: ReceiptView }) {
  const c = view.currencyCode;

  return (
    <div className="receipt font-mono text-[0.75rem] leading-relaxed">
      <div className="text-center">
        <p className="text-sm font-bold">{view.heading}</p>
        {view.branchName && <p className="text-muted">{view.branchName}</p>}
        {view.branchAddress && <p className="text-muted">{view.branchAddress}</p>}
        {view.branchPhone && <p className="text-muted">{view.branchPhone}</p>}
        {view.taxNumber && <p className="text-muted">TIN {view.taxNumber}</p>}
      </div>

      <Divider />

      <div className="flex justify-between text-muted">
        <span>{view.number ?? "Queued"}</span>
        <span>{formatDateTime(view.soldAt)}</span>
      </div>
      {view.cashier && <div className="text-muted">Served by {view.cashier}</div>}
      {view.customer && <div className="text-muted">Customer: {view.customer}</div>}
      {view.reprint && <div className="mt-1 text-center font-bold">*** RE-PRINT ***</div>}

      <Divider />

      <ul>
        {view.lines.map((line, index) => (
          <li key={index} className="mb-1.5">
            <div className="flex justify-between gap-3">
              <span className="min-w-0 flex-1 truncate">{line.name}</span>
              <span className="tnum shrink-0">{formatMoney(line.lineTotal, c)}</span>
            </div>
            <div className="tnum text-muted">
              {formatQty(line.quantity)} {line.unit}
              {line.unitPrice !== null && ` × ${formatMoney(line.unitPrice, c)}`}
              {line.discountAmount > 0 && <span> · less {formatMoney(line.discountAmount, c)}</span>}
            </div>
          </li>
        ))}
      </ul>

      <Divider />

      <dl className="space-y-0.5">
        {view.subtotal !== null && <Line label="Subtotal" value={formatMoney(view.subtotal, c)} />}
        {view.discountTotal > 0 && (
          <Line label="Discount" value={`− ${formatMoney(view.discountTotal, c)}`} />
        )}
        {view.taxTotal > 0 && <Line label="Tax" value={formatMoney(view.taxTotal, c)} />}
        <Line label="TOTAL" value={formatMoney(view.total, c)} strong />

        <div className="pt-1.5" />
        {view.payments.map((payment, index) => (
          <Line
            key={index}
            label={PAYMENT_LABEL[payment.method]}
            value={formatMoney(payment.amount, c)}
          />
        ))}
        {view.changeGiven > 0 && <Line label="Change" value={formatMoney(view.changeGiven, c)} />}
        {view.balanceDue > 0 && (
          <Line label="On account" value={formatMoney(view.balanceDue, c)} strong />
        )}
      </dl>

      <Divider />
      <p className="text-center text-muted">Thank you — please come again</p>
    </div>
  );
}

function Divider() {
  return <div aria-hidden className="my-2.5 border-t border-dashed border-line-strong" />;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-[0.8125rem] font-bold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}
