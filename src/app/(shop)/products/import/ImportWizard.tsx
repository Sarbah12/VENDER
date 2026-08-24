"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { Spinner, SubmitButton } from "@/components/SubmitButton";
import { formatMoney, formatQty } from "@/lib/money";
import type { ImportPreview, ImportRow } from "@/server/import";
import { applyImport, previewImport, type CommitState, type PreviewState } from "./actions";

export function ImportWizard({ currencyCode }: { currencyCode: string }) {
  const [previewState, previewAction] = useActionState<PreviewState, FormData>(previewImport, {
    status: "idle",
  });
  const [commit, setCommit] = useState<CommitState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);

  if (commit.status === "done") {
    return <Done result={commit} onAgain={() => setCommit({ status: "idle" })} />;
  }

  const preview = previewState.status === "ready" ? previewState.preview : null;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-[0.9375rem] font-bold tracking-tight">1. Start from the template</h2>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
              It has the columns filled in and two worked examples. You can also upload an export
              from another system — common column names are recognised automatically, and anything
              unrecognised is ignored rather than rejected.
            </p>
          </div>
          {/*
            A plain anchor on purpose: this route returns a file, not a page.
            next/link would prefetch it and try a client-side navigation, which
            is exactly wrong for a download.
          */}
          <a href="/products/import/template" download className="btn btn-secondary px-4 py-2.5">
            <Download size={15} />
            Download template
          </a>
        </div>
      </section>

      <form action={previewAction} className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">2. Upload your file</h2>
        <p className="mt-1.5 text-[0.8125rem] text-muted">
          Excel (.xlsx) or CSV, up to 8MB. Nothing is saved until you approve the preview.
        </p>

        <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface-2 px-6 py-8 text-center transition-colors hover:border-brand hover:bg-brand-soft/40">
          <Upload size={22} className="text-brand" />
          <span className="text-[0.875rem] font-semibold">
            {fileName ?? "Choose a spreadsheet"}
          </span>
          <span className="text-[0.75rem] text-muted">.xlsx or .csv</span>
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="sr-only"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          />
        </label>

        {previewState.status === "error" && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg bg-danger-soft px-4 py-3 text-[0.8125rem] font-medium text-danger"
          >
            <AlertTriangle size={16} className="mt-px shrink-0" />
            {previewState.message}
          </p>
        )}

        <SubmitButton className="btn btn-primary mt-4 px-5 py-2.5" pendingLabel="Reading the file…">
          Check the file
          <ArrowRight size={15} />
        </SubmitButton>
      </form>

      {preview && (
        <PreviewPanel
          preview={preview}
          currencyCode={currencyCode}
          pending={pending}
          error={commit.status === "error" ? commit.message : null}
          onApply={() => {
            const usable = preview.rows.filter((row) => row.action !== "error");
            startTransition(async () => setCommit(await applyImport(usable)));
          }}
        />
      )}
    </div>
  );
}

function PreviewPanel({
  preview,
  currencyCode,
  pending,
  error,
  onApply,
}: {
  preview: ImportPreview;
  currencyCode: string;
  pending: boolean;
  error: string | null;
  onApply: () => void;
}) {
  const [showOnly, setShowOnly] = useState<"all" | "error" | "warning">("all");

  const withWarnings = preview.rows.filter((r) => r.warnings.length > 0).length;
  const usable = preview.summary.create + preview.summary.update;

  const rows = preview.rows.filter((row) => {
    if (showOnly === "error") return row.action === "error";
    if (showOnly === "warning") return row.warnings.length > 0;
    return true;
  });

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">3. Check what will happen</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-muted">
          <FileSpreadsheet size={13} />
          {preview.fileName}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
        <Tally label="New products" value={preview.summary.create} tone="positive" />
        <Tally label="Updated" value={preview.summary.update} tone="info" />
        <Tally label="Rows with problems" value={preview.summary.error} tone="danger" />
        <Tally label="Warnings" value={withWarnings} tone="warning" />
      </div>

      <div className="space-y-3 border-b border-line px-5 py-4 text-[0.8125rem]">
        {preview.summary.newCategories.length > 0 && (
          <p className="text-muted">
            <span className="font-semibold text-ink">
              {preview.summary.newCategories.length} new categor
              {preview.summary.newCategories.length === 1 ? "y" : "ies"}
            </span>{" "}
            will be created: {preview.summary.newCategories.join(", ")}
          </p>
        )}
        {preview.summary.openingStockValue > 0 && (
          <p className="text-muted">
            Opening stock worth{" "}
            <span className="tnum font-semibold text-ink">
              {formatMoney(preview.summary.openingStockValue, currencyCode)}
            </span>{" "}
            will be counted in and posted to Inventory.
          </p>
        )}
        {preview.unmatchedHeaders.length > 0 && (
          <p className="text-muted">
            Ignored columns: {preview.unmatchedHeaders.slice(0, 8).join(", ")}
            {preview.unmatchedHeaders.length > 8 ? ` and ${preview.unmatchedHeaders.length - 8} more` : ""}
          </p>
        )}
        {preview.summary.error > 0 && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 font-medium text-warning">
            {preview.summary.error} row{preview.summary.error === 1 ? "" : "s"} will be skipped. Fix
            them in the file and upload again if you need them.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
        <Filter active={showOnly === "all"} onClick={() => setShowOnly("all")}>
          All {preview.rows.length}
        </Filter>
        {preview.summary.error > 0 && (
          <Filter active={showOnly === "error"} onClick={() => setShowOnly("error")}>
            Problems {preview.summary.error}
          </Filter>
        )}
        {withWarnings > 0 && (
          <Filter active={showOnly === "warning"} onClick={() => setShowOnly("warning")}>
            Warnings {withWarnings}
          </Filter>
        )}
      </div>

      <div className="table-wrap max-h-[26rem] overflow-y-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="num">Row</th>
              <th>Action</th>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th className="num">Cost</th>
              <th className="num">Price</th>
              <th className="num">Opening stock</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((row) => (
              <PreviewRow key={row.rowNumber} row={row} currencyCode={currencyCode} />
            ))}
          </tbody>
        </table>
        {rows.length > 300 && (
          <p className="px-5 py-3 text-center text-[0.75rem] text-muted">
            Showing the first 300 of {rows.length} rows. All of them will be imported.
          </p>
        )}
      </div>

      <div className="border-t border-line p-5">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-3 text-[0.8125rem] font-medium text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onApply}
            disabled={pending || usable === 0}
            className="btn btn-primary px-5 py-3"
          >
            {pending && <Spinner />}
            {pending ? "Importing…" : `Import ${usable} product${usable === 1 ? "" : "s"}`}
          </button>
          <p className="text-[0.75rem] text-muted">
            Applied in one go — if anything fails, nothing is saved.
          </p>
        </div>
      </div>
    </section>
  );
}

function PreviewRow({ row, currencyCode }: { row: ImportRow; currencyCode: string }) {
  const tone =
    row.action === "error"
      ? "bg-danger-soft text-danger"
      : row.action === "create"
        ? "bg-positive-soft text-positive"
        : "bg-info-soft text-info";

  return (
    <tr className={row.action === "error" ? "opacity-70" : undefined}>
      <td className="num text-muted">{row.rowNumber}</td>
      <td>
        <span className={`chip ${tone}`}>
          {row.action === "error" ? "Skip" : row.action === "create" ? "New" : "Update"}
        </span>
      </td>
      <td className="tnum font-semibold">{row.sku || "—"}</td>
      <td>
        <span className="block font-medium">{row.name || "—"}</span>
        {row.errors.map((message) => (
          <span key={message} className="block text-[0.6875rem] font-medium text-danger">
            {message}
          </span>
        ))}
        {row.warnings.map((message) => (
          <span key={message} className="block text-[0.6875rem] text-warning">
            {message}
          </span>
        ))}
      </td>
      <td className="text-muted">{row.categoryName ?? "—"}</td>
      <td className="num text-muted">{formatMoney(row.costPrice, currencyCode)}</td>
      <td className="num font-semibold">{formatMoney(row.sellPrice, currencyCode)}</td>
      <td className="num text-muted">
        {row.openingStock > 0 ? `${formatQty(row.openingStock)} ${row.unit}` : "—"}
      </td>
    </tr>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "positive" | "info" | "danger" | "warning";
}) {
  const colour = {
    positive: "text-positive",
    info: "text-info",
    danger: value > 0 ? "text-danger" : "text-muted",
    warning: value > 0 ? "text-warning" : "text-muted",
  }[tone];

  return (
    <div className="bg-surface px-5 py-4">
      <p className={`tnum text-[1.5rem] font-bold leading-none ${value === 0 ? "text-muted" : colour}`}>
        {value}
      </p>
      <p className="mt-1 text-[0.75rem] text-muted">{label}</p>
    </div>
  );
}

function Filter({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-[0.75rem] font-semibold transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface-2 text-muted hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}

function Done({
  result,
  onAgain,
}: {
  result: Extract<CommitState, { status: "done" }>;
  onAgain: () => void;
}) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-positive-soft text-positive">
        <CheckCircle2 size={26} />
      </span>
      <h2 className="mt-5 text-xl font-bold tracking-tight">Catalogue imported</h2>
      <p className="mt-2 text-[0.9375rem] text-muted">
        {result.created} product{result.created === 1 ? "" : "s"} added
        {result.updated > 0 ? `, ${result.updated} updated` : ""}
        {result.categoriesCreated > 0
          ? `, ${result.categoriesCreated} categor${result.categoriesCreated === 1 ? "y" : "ies"} created`
          : ""}
        .
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/products" className="btn btn-primary px-5 py-2.5">
          See the catalogue
        </Link>
        <Link href="/pos" className="btn btn-secondary px-5 py-2.5">
          Open the till
        </Link>
        <button type="button" onClick={onAgain} className="btn btn-ghost px-4 py-2.5">
          <X size={15} />
          Import another file
        </button>
      </div>
    </div>
  );
}
