import { Package, Plus, Search, Upload } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { bpToPercent, formatMoney, formatQty } from "@/lib/money";
import { can } from "@/server/authz";
import { catalogueTotals, searchCatalogue } from "@/server/catalogue";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Products" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageParam } = await searchParams;

  const context = await getShopContext();
  if (!context) redirect("/setup");

  const currency = context.business.currencyCode;
  const warehouseId = context.register?.warehouseId ?? context.warehouse.id;
  const page = Math.max(1, Number(pageParam) || 1);
  const query = q.trim();

  const [{ rows, total }, totals] = await Promise.all([
    searchCatalogue({
      businessId: context.business.id,
      warehouseId,
      query,
      includeInactive: true,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    catalogueTotals(context.business.id, warehouseId),
  ]);

  const editable = can(context.employee, "catalogue:write");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const empty = totals.products === 0;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-3">
        <Summary
          label="Products"
          value={String(totals.products)}
          detail={`${totals.active} on sale`}
        />
        <Summary
          label="Stock at cost"
          value={formatMoney(totals.stockAtCost, currency)}
          detail="Matches the Inventory account"
        />
        <Summary
          label="Stock at retail"
          value={formatMoney(totals.stockAtRetail, currency)}
          detail="If every unit sells at list"
        />
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[0.9375rem] font-bold tracking-tight">Catalogue</h2>
          <div className="flex flex-wrap items-center gap-2">
            {!empty && (
              <form method="get" className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                />
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Search name, SKU or barcode"
                  aria-label="Search the catalogue"
                  className="input w-56 py-2 pl-9 text-[0.8125rem]"
                />
              </form>
            )}
            {editable && (
              <>
                <Link href="/products/import" className="btn btn-secondary px-3.5 py-2">
                  <Upload size={15} />
                  Import from Excel
                </Link>
                <Link href="/products/new" className="btn btn-primary px-3.5 py-2">
                  <Plus size={15} />
                  Add product
                </Link>
              </>
            )}
          </div>
        </div>

        {empty ? (
          <div className="px-6 py-16 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-soft text-brand">
              <Package size={24} />
            </span>
            <h3 className="mt-4 text-base font-bold tracking-tight">No products yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-[0.875rem] leading-relaxed text-muted">
              Bring your catalogue in from a spreadsheet — it recognises the column names most
              systems export — or add the first item by hand.
            </p>
            {editable && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link href="/products/import" className="btn btn-primary px-4 py-2.5">
                  <Upload size={15} />
                  Import from Excel
                </Link>
                <Link href="/products/new" className="btn btn-secondary px-4 py-2.5">
                  <Plus size={15} />
                  Add one product
                </Link>
              </div>
            )}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">
            Nothing matches “{query}”.{" "}
            <Link href="/products" className="font-semibold text-brand hover:underline">
              Clear the search
            </Link>
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Barcode</th>
                    <th className="num">Cost</th>
                    <th className="num">Price</th>
                    <th className="num">Margin</th>
                    <th className="num">Tax</th>
                    <th className="num">On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const margin =
                      row.sellPrice > 0
                        ? Math.round(((row.sellPrice - row.costPrice) / row.sellPrice) * 100)
                        : 0;
                    const low = row.trackStock && row.stock <= row.reorderPoint;

                    return (
                      <tr key={row.id}>
                        <td>
                          <Link
                            href={`/products/${row.id}`}
                            className="block font-semibold hover:text-brand hover:underline"
                          >
                            {row.name}
                          </Link>
                          <span className="tnum block text-[0.6875rem] text-muted">
                            {row.sku}
                            {!row.isActive && " · retired"}
                          </span>
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1.5 text-muted">
                            <span
                              aria-hidden
                              className="size-2 rounded-full"
                              style={{ background: row.categoryColour ?? "var(--border-strong)" }}
                            />
                            {row.categoryName}
                          </span>
                        </td>
                        <td className="tnum text-muted">{row.barcode ?? "—"}</td>
                        <td className="num text-muted">{formatMoney(row.costPrice, currency)}</td>
                        <td className="num font-semibold">{formatMoney(row.sellPrice, currency)}</td>
                        <td className="num">
                          <span
                            className={
                              margin >= 30 ? "text-positive" : margin >= 15 ? "" : "text-warning"
                            }
                          >
                            {margin}%
                          </span>
                        </td>
                        <td className="num text-muted">
                          {bpToPercent(row.taxRateBp ?? context.business.taxRateBp)}%
                        </td>
                        <td className="num">
                          {row.trackStock ? (
                            <span
                              className={`chip tnum ${
                                row.stock <= 0
                                  ? "bg-danger-soft text-danger"
                                  : low
                                    ? "bg-warning-soft text-warning"
                                    : "bg-surface-3 text-muted"
                              }`}
                            >
                              {formatQty(row.stock)} {row.unit}
                            </span>
                          ) : (
                            <span className="chip bg-info-soft text-info">Service</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination page={page} pages={pages} total={total} query={query} />
          </>
        )}
      </section>
    </div>
  );
}

function Pagination({
  page,
  pages,
  total,
  query,
}: {
  page: number;
  pages: number;
  total: number;
  query: string;
}) {
  const href = (target: number) =>
    `/products?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(target) })}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
      <p className="tnum text-[0.75rem] text-muted">
        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
        {query ? ` matching “${query}”` : ""}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          {page > 1 && (
            <Link href={href(page - 1)} className="btn btn-secondary px-3 py-1.5 text-[0.75rem]">
              Previous
            </Link>
          )}
          <span className="tnum px-2 text-[0.75rem] text-muted">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={href(page + 1)} className="btn btn-secondary px-3 py-1.5 text-[0.75rem]">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="card p-5">
      <p className="label mb-2">{label}</p>
      <p className="tnum text-[1.5rem] font-bold leading-none tracking-tight">{value}</p>
      <p className="mt-1.5 text-[0.75rem] text-muted">{detail}</p>
    </div>
  );
}
