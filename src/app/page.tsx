import { redirect } from "next/navigation";

import { getShopContext } from "@/server/context";

export default async function Home() {
  const context = await getShopContext();

  if (!context) redirect("/setup");
  if (!context.employee) redirect("/sign-in");
  redirect("/pos");
}
