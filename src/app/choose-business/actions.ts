"use server";

import { redirect } from "next/navigation";

import { hasMembership } from "@/server/accounts";
import { readSession, startSession } from "@/server/session";
import { endSignUpSession, readSignUpSession } from "@/server/signup-session";

/**
 * Switches which business the session is acting in.
 *
 * The businessId arrives from a form, so it is attacker-controlled and is
 * checked against a membership before it is written into the session. Skipping
 * that check would let anyone hand themselves another company's books.
 */
export async function chooseBusiness(formData: FormData) {
  const session = await readSession();
  const pendingUserId = await readSignUpSession();
  const userId = session?.userId ?? pendingUserId;

  if (!userId) redirect("/sign-in");

  const businessId = String(formData.get("businessId") ?? "");
  if (!businessId) redirect("/choose-business");

  if (!(await hasMembership(userId, businessId))) {
    // Not an error page — from the user's side the business simply is not theirs.
    redirect("/choose-business");
  }

  // A fresh session for the new tenant: carrying the old employee or till over
  // would point at rows belonging to the business being left behind.
  await startSession({ userId, businessId });
  await endSignUpSession();

  redirect("/pos");
}
