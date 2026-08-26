"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { completePasswordReset } from "@/server/auth-flows";
import { checkPasswordStrength } from "@/server/passwords";

export type ResetState = { error?: string };

const Schema = z.object({
  token: z.string().min(1),
  password: z.string().min(1, "Choose a password."),
  confirm: z.string(),
});

export async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = Schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { token, password, confirm } = parsed.data;
  if (password !== confirm) return { error: "The two passwords do not match." };

  const weak = checkPasswordStrength(password);
  if (weak) return { error: weak };

  const result = await completePasswordReset(token, password);
  if (!result.ok) {
    return {
      error:
        "That link has expired or has already been used. Request a new one and try again.",
    };
  }

  // Deliberately not signed in here: whoever used the link should prove they
  // know the new password, and it puts them on a page that confirms it worked.
  redirect("/sign-in?reset=1");
}
