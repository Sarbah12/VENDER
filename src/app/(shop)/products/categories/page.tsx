import { asc, count, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { categories, products } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { getShopContext } from "@/server/context";

export const metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");

  const db = await getDb();
  const currency = context.business.currencyCode;

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      colour: categories.colour,
      products: count(products.id),
      averagePrice: sql`coalesce(avg(${products.sellPrice}), 0)`,
      cheapest: sql`coalesce(min(${products.sellPrice}), 0)`,
      dearest: sql`coalesce(max(${products.sellPrice}), 0)`,
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .where(eq(categories.businessId, context.business.id))
    .groupBy(categories.id, categories.name, categories.colour, categories.sortOrder)
    .orderBy(asc(categories.sortOrder));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <article key={row.id} className="card overflow-hidden">
          <div
            aria-hidden
            className="h-1.5 w-full"
            style={{ background: row.colour ?? "var(--border-strong)" }}
          />
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-bold tracking-tight">{row.name}</h2>
              <span className="chip tnum bg-surface-3 text-muted">{row.products} products</span>
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-3 text-[0.8125rem]">
              <Stat label="Cheapest" value={formatMoney(Number(row.cheapest), currency)} />
              <Stat label="Average" value={formatMoney(Math.round(Number(row.averagePrice)), currency)} />
              <Stat label="Dearest" value={formatMoney(Number(row.dearest), currency)} />
            </dl>
          </div>
        </article>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="tnum mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}
