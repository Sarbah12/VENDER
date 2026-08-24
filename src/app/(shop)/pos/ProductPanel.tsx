"use client";

import { Loader2, PackagePlus, ScanLine, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { formatMoney, formatQty } from "@/lib/money";
import { lookupProducts } from "./actions";
import type { PosCategory, PosProduct } from "./types";

const MIN_SEARCH_LENGTH = 2;
const DEBOUNCE_MS = 220;

export function ProductPanel({
  products,
  categories,
  holdsEverything,
  catalogueSize,
  currencyCode,
  onPick,
  onNotFound,
  ref,
}: {
  /** The full catalogue, or a browsing slice of it when it is too big to hold. */
  products: PosProduct[];
  categories: PosCategory[];
  holdsEverything: boolean;
  catalogueSize: number;
  currencyCode: string;
  onPick: (product: PosProduct) => void;
  onNotFound: (code: string) => void;
  ref?: React.Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  // Keyed by the query it answers, so a result can be told apart from a stale one
  // without clearing state on every keystroke.
  const [remote, setRemote] = useState<{ query: string; rows: PosProduct[] } | null>(null);
  const [searching, startSearch] = useTransition();

  const needle = query.trim().toLowerCase();

  /* ── Local filtering: instant, and all a small shop ever needs ────────── */
  const local = useMemo(() => {
    return products.filter((product) => {
      if (category !== "all" && (product.categoryId ?? "none") !== category) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        (product.barcode?.includes(needle) ?? false)
      );
    });
  }, [products, needle, category]);

  /* ── Remote search: only when the till cannot hold the catalogue ──────── */
  const requestId = useRef(0);

  // True when this catalogue is too big to hold, so the database has to answer.
  const searchingRemote = !holdsEverything && needle.length >= MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (!searchingRemote) return;

    const id = ++requestId.current;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const rows = await lookupProducts({ query: needle });
        // Drop anything that came back after a newer keystroke.
        if (id === requestId.current) setRemote({ query: needle, rows });
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [needle, searchingRemote]);

  // While a fresh search is in flight the previous results stay on screen rather
  // than flashing empty — a till that blanks between keystrokes is unusable.
  const visible = searchingRemote ? (remote?.rows ?? []) : local;
  const stale = searchingRemote && remote?.query !== needle;

  /**
   * A barcode reader is a keyboard that types fast and presses Enter. So Enter
   * means "resolve what I just typed": an exact barcode or SKU wins outright,
   * and a search that has narrowed to one product rings that one up.
   */
  const submitCode = () => {
    const code = query.trim();
    if (!code) return;

    const exact =
      products.find((p) => p.barcode === code) ??
      products.find((p) => p.sku.toLowerCase() === code.toLowerCase()) ??
      (remote?.rows ?? []).find(
        (p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase(),
      );

    if (exact) {
      onPick(exact);
      setQuery("");
      return;
    }

    if (visible.length === 1) {
      onPick(visible[0]);
      setQuery("");
      return;
    }

    if (holdsEverything) {
      if (visible.length === 0) onNotFound(code);
      return;
    }

    // The scanned code may be outside the loaded slice — ask the database before
    // telling a cashier a real product does not exist.
    startSearch(async () => {
      const [found] = await lookupProducts({ query: code, exactCodeOnly: true });
      if (found) {
        onPick(found);
        setQuery("");
      } else if (visible.length === 0) {
        onNotFound(code);
      }
    });
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas" aria-label="Catalogue">
      <div className="shrink-0 border-b border-line bg-surface px-4 py-3">
        <div className="relative">
          <ScanLine
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand"
          />
          <input
            ref={ref}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCode();
              }
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-label="Scan a barcode or search the catalogue"
            placeholder="Scan a barcode, or search by name or SKU…"
            className="input py-3 pl-11 pr-20 text-[0.9375rem]"
          />
          <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {(searching || stale) && <Loader2 size={15} className="animate-spin text-muted" />}
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="rounded px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-3"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {!holdsEverything && (
          <p className="mt-2 text-[0.6875rem] text-muted">
            Showing {products.length} of {catalogueSize.toLocaleString()} products — type at least{" "}
            {MIN_SEARCH_LENGTH} characters to search the rest.
          </p>
        )}

        {(holdsEverything || !searchingRemote) && categories.length > 0 && (
          <div className="scroll-slim -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <CategoryPill
              active={category === "all"}
              onClick={() => setCategory("all")}
              label="All"
              count={holdsEverything ? products.length : catalogueSize}
            />
            {categories.map((c) => (
              <CategoryPill
                key={c.id}
                active={category === c.id}
                onClick={() => setCategory(c.id)}
                label={c.name}
                count={c.count}
                colour={c.colour}
              />
            ))}
          </div>
        )}
      </div>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-4">
        {catalogueSize === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-brand-soft">
              <PackagePlus size={24} className="text-brand" />
            </span>
            <p className="text-sm font-semibold">Nothing to sell yet</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted">
              The till needs a catalogue. Bring yours in from a spreadsheet and it will be ready to
              scan in a minute.
            </p>
            <Link href="/products/import" className="btn btn-primary mt-2 px-4 py-2.5">
              Import your products
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Search size={28} className="text-faint" />
            <p className="text-sm font-medium">
              {searching ? "Searching…" : "No products match that"}
            </p>
            <p className="text-xs text-muted">Try a different name, SKU or barcode.</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(154px,1fr))] gap-2.5">
            {visible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                currencyCode={currencyCode}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryPill({
  label,
  count,
  active,
  colour,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  colour?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface-2 text-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      {colour && (
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ background: active ? "rgba(255,255,255,0.75)" : colour }}
        />
      )}
      {label}
      <span className={`tnum text-[0.6875rem] ${active ? "text-white/70" : "text-faint"}`}>
        {count}
      </span>
    </button>
  );
}

function ProductCard({
  product,
  currencyCode,
  onPick,
}: {
  product: PosProduct;
  currencyCode: string;
  onPick: (product: PosProduct) => void;
}) {
  const outOfStock = product.trackStock && product.stock <= 0 && !product.allowNegativeStock;
  const low = product.trackStock && product.stock > 0 && product.stock <= 5;

  return (
    <button
      type="button"
      onClick={() => onPick(product)}
      disabled={outOfStock}
      className={`card group flex h-[112px] flex-col justify-between p-3 text-left transition-all ${
        outOfStock
          ? "cursor-not-allowed opacity-55"
          : "hover:-translate-y-0.5 hover:border-brand hover:shadow-md active:translate-y-0"
      }`}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <span
          aria-hidden
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: product.categoryColour ?? "var(--border-strong)" }}
        />
        <span className="line-clamp-2 text-[0.8125rem] font-semibold leading-[1.3]">
          {product.name}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="tnum text-[0.9375rem] font-bold">
          {formatMoney(product.sellPrice, currencyCode)}
        </span>
        {product.trackStock ? (
          <span
            className={`chip tnum ${
              outOfStock
                ? "bg-danger-soft text-danger"
                : low
                  ? "bg-warning-soft text-warning"
                  : "bg-surface-3 text-muted"
            }`}
          >
            {outOfStock ? "Out" : `${formatQty(product.stock)} ${product.unit}`}
          </span>
        ) : (
          <span className="chip bg-info-soft text-info">Service</span>
        )}
      </div>
    </button>
  );
}
