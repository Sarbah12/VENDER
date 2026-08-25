import { redirect } from "next/navigation";

import { getShopContext } from "@/server/context";
import { readSession } from "@/server/session";
import { readSignUpSession } from "@/server/signup-session";

// Where this lands depends on the session, so there is nothing to prerender —
// and a build must never need the database.
export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await getShopContext();
  if (context) redirect("/pos");

  // A signed session that did not resolve means the membership behind it is
  // gone; a signup in progress means the account exists but owns nothing yet.
  const session = await readSession();
  const pendingUserId = await readSignUpSession();

  if (session || pendingUserId) redirect("/choose-business");
  redirect("/sign-in");
}
