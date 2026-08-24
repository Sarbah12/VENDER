"use server";

import { redirect } from "next/navigation";

import { endSession } from "@/server/session";

export async function signOut() {
  await endSession();
  redirect("/sign-in");
}
