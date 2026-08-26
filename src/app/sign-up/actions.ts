"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { AccountError, createUser } from "@/server/accounts";
import { checkPasswordStrength } from "@/server/passwords";
import { sendVerificationEmail } from "@/server/auth-flows";
import { recordAttempt } from "@/server/throttle";
import { startSignUpSession } from "@/server/signup-session";

export type SignUpState = { error?: string; fieldErrors?: Record<string, string> };

const SignUpSchema = z.object({
  name: z.string().trim().min(1, "What should we call you?").max(120),
  email: z.email("That does not look like an email address.").max(200),
  password: z.string().min(1, "Choose a password."),
});

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = SignUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const { name, email, password } = parsed.data;

  // Rate limited by email so signup cannot be used to enumerate or to grind
  // through the expensive password hash.
  const throttle = await recordAttempt("signup", email);
  if (!throttle.allowed) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const weak = checkPasswordStrength(password, [name, email.split("@")[0]]);
  if (weak) return { error: "Check the highlighted fields.", fieldErrors: { password: weak } };

  let userId: string;
  try {
    userId = await createUser({ email, name, password });
  } catch (error) {
    if (error instanceof AccountError && error.code === "email_taken") {
      return {
        error: "There is already an account with that email.",
        fieldErrors: { email: "Already registered — sign in instead." },
      };
    }
    console.error("signUp failed", error);
    return { error: "The account could not be created. Nothing was saved." };
  }

  // Best effort: a bounced welcome email must not stop the account being made.
  // The address can be confirmed later from settings.
  await sendVerificationEmail(userId);

  // Signed in, but with no business yet — the next step creates one.
  await startSignUpSession(userId);
  redirect("/setup");
}
