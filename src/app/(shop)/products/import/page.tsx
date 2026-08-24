import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { can } from "@/server/authz";
import { getShopContext, isSignedIn } from "@/server/context";
import { TEMPLATE_HEADERS } from "@/server/import";
import { ImportWizard } from "./ImportWizard";

export const metadata = { title: "Import products" };
export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;
  const context = await getShopContext();
  if (!context) redirect("/setup");
  if (!isSignedIn(context)) redirect("/sign-in");

  if (!can(context.employee, "catalogue:import")) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h2 className="text-lg font-bold">Not your job — yet</h2>
        <p className="mt-2 text-sm text-muted">
          Importing the catalogue is for an owner, manager or stock clerk.
        </p>
        <Link href="/products" className="btn btn-secondary mt-5 px-4 py-2">
          Back to products
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {welcome ? (
        <div className="card border-l-4 border-l-brand p-5">
          <h2 className="text-base font-bold tracking-tight">
            {context.business.name} is ready — now bring in your products
          </h2>
          <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">
            Your chart of accounts, first branch and till are set up. The catalogue is empty and
            waiting for yours. If your list is already in Excel, this is the fastest way in; if you
            would rather start with a handful of items,{" "}
            <Link href="/products/new" className="font-semibold text-brand hover:underline">
              add them one at a time
            </Link>{" "}
            instead.
          </p>
        </div>
      ) : (
        <Link
          href="/products"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-muted hover:text-brand"
        >
          <ArrowLeft size={15} /> All products
        </Link>
      )}

      <ImportWizard currencyCode={context.business.currencyCode} />

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-bold tracking-tight">What each column means</h2>
        <div className="table-wrap mt-3">
          <table className="table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_HEADERS.map((column) => (
                <tr key={column.field}>
                  <td className="whitespace-nowrap font-semibold">{column.header}</td>
                  <td className="text-muted">{column.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[0.75rem] leading-relaxed text-muted">
          Rows are matched to what you already have by SKU — a new SKU is created, a known one is
          updated. Opening stock is only applied when a product is created, so re-importing a price
          list never doubles your stock; correct a count from the product page instead.
        </p>
      </section>
    </div>
  );
}
