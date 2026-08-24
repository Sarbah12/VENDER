import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";
import { categories } from "@/db/schema";
import { bpToPercent } from "@/lib/money";
import { can } from "@/server/authz";
import { getShopContext, isSignedIn } from "@/server/context";
import { BLANK_PRODUCT, ProductForm } from "../ProductForm";

export const metadata = { title: "Add product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const context = await getShopContext();
  if (!context) redirect("/setup");
  if (!isSignedIn(context)) redirect("/sign-in");

  if (!can(context.employee, "catalogue:write")) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h2 className="text-lg font-bold">Not your job — yet</h2>
        <p className="mt-2 text-sm text-muted">
          Adding products is for an owner, manager or stock clerk. You are signed in as a cashier.
        </p>
        <Link href="/products" className="btn btn-secondary mt-5 px-4 py-2">
          Back to products
        </Link>
      </div>
    );
  }

  const db = await getDb();
  const categoryList = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.businessId, context.business.id))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/products"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-muted hover:text-brand"
      >
        <ArrowLeft size={15} /> All products
      </Link>

      <ProductForm
        values={BLANK_PRODUCT}
        categories={categoryList}
        currencyCode={context.business.currencyCode}
        defaultTaxPercent={bpToPercent(context.business.taxRateBp)}
      />
    </div>
  );
}
