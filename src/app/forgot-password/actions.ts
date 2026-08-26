"use server";

import { z } from "zod";

import { requestPasswordReset } from "@/server/auth-flows";

export type ForgotState = { sent?: boolean; error?: string };

const Schema = z.object({ email: z.string().trim().min(1, "Enter your email.").max(200) });

/**
 * Always reports the same thing, whether or not the address has an account.
 *
 * Saying "no account with that email" turns this form into a way to find out
 * who has signed up. The response is identical either way, and the work behind
 * it is rate limited on the address.
 */
export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = Schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter your email." };
  }

  try {
    await requestPasswordReset(parsed.data.email);
  } catch (error) {
    console.error("requestPasswordReset failed", error);
    // Still reported as sent: a failure here would otherwise reveal that the
    // address exists, and the user can simply try again.
  }

  return { sent: true };
}
