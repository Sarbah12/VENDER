"use server";

import { redirect } from "next/navigation";

import { seedDemoBusiness } from "@/db/seed";

export async function createDemoShop() {
  await seedDemoBusiness();
  redirect("/sign-in");
}
