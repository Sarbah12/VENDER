"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { AccountError, authenticate } from "@/server/accounts";
import { listMemberships } from "@/server/context";
import { startSession } from "@/server/session";
import { startSignUpSession } from "@/server/signup-session";
import { checkAttempt, clearAttempts, recordFailure } from "@/server/throttle";

export type SignInState = { error?: string };

const SignInSchema = z.object({
  email: z.string().trim().min(1, "Enter your email.").max(200),
  password: z.string().min(1, "Enter your password."),
});

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const email = parsed.data.email.toLowerCase();
  const key = `signin:${email}`;

  const throttle = checkAttempt(key);
  if (!throttle.allowed) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(throttle.retryInSeconds / 60)} minute(s).`,
    };
  }

  let user;
  try {
    user = await authenticate(email, parsed.data.password);
  } catch (error) {
    if (error instanceof AccountError) {
      const state = recordFailure(key);
      // The same message for an unknown email and a wrong password: anything
      // else tells a stranger which addresses have accounts here.
      return {
        error:
          state.remaining > 0
            ? "That email and password do not match."
            : "Too many attempts. This account is locked for a few minutes.",
      };
    }
    throw error;
  }

  clearAttempts(key);

  const businesses = await listMemberships(user.id);

  if (businesses.length === 0) {
    // A valid account that owns nothing yet — send them to create a business
    // rather than into an app with no tenant to show.
    await startSignUpSession(user.id);
    redirect("/setup");
  }

  // More than one, and they choose; the picker sets the session itself.
  if (businesses.length > 1) {
    await startSignUpSession(user.id);
    redirect("/choose-business");
  }

  await startSession({ userId: user.id, businessId: businesses[0].businessId });
  redirect("/pos");
}
