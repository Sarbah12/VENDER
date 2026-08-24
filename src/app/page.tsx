import { redirect } from "next/navigation";

import { getShopContext } from "@/server/context";

// Where this lands depends on the session and on whether a business exists, so
// there is nothing to prerender — and a build must never need the database.
export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await getShopContext();

  if (!context) redirect("/setup");
  if (!context.employee) redirect("/sign-in");
  redirect("/pos");
}
