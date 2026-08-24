"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";
import { employees } from "@/db/schema";
import { verifyPin } from "@/server/pin";
import { startSession } from "@/server/session";
import { checkAttempt, clearAttempts, recordFailure } from "@/server/throttle";

export type SignInState = { error?: string };

const SignInSchema = z.object({
  employeeId: z.uuid("Pick who is on the till."),
  registerId: z.union([z.uuid(), z.literal("")]).optional(),
  pin: z.string().regex(/^\d{4,8}$/, "Enter your PIN."),
});

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = SignInSchema.safeParse({
    employeeId: formData.get("employeeId"),
    registerId: formData.get("registerId") ?? "",
    pin: formData.get("pin"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const { employeeId, registerId, pin } = parsed.data;

  const throttle = checkAttempt(employeeId);
  if (!throttle.allowed) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(throttle.retryInSeconds / 60)} minute(s), or ask a manager.`,
    };
  }

  const db = await getDb();
  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.isActive, true)))
    .limit(1);

  const ok = employee ? await verifyPin(pin, employee.pinHash) : false;

  if (!ok) {
    const state = recordFailure(employeeId);
    return {
      error:
        state.remaining > 0
          ? `That PIN is not right. ${state.remaining} attempt${state.remaining === 1 ? "" : "s"} left.`
          : "Too many attempts. This till is locked for a few minutes.",
    };
  }

  clearAttempts(employeeId);
  await startSession(employee!.id, registerId ? registerId : null);

  // redirect throws to unwind the action, so it must sit outside any try/catch.
  redirect("/pos");
}
