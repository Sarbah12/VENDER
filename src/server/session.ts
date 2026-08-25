import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "vender_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // Two weeks.

/**
 * What the signed cookie carries.
 *
 * `businessId` is the tenant boundary. Every query in the app is scoped to it,
 * and it comes from here — from a value the server signed — never from a URL,
 * a header, or anything else a request could choose for itself.
 *
 * `employeeId` is who is standing at the till, which is a separate question
 * from who is signed in: an owner may sign in and then hand the counter to a
 * cashier who identifies with a PIN.
 */
export type SessionPayload = {
  userId: string;
  businessId: string;
  employeeId: string | null;
  registerId: string | null;
  /** Seconds since epoch. */
  issuedAt: number;
};

function secret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  return "dev-only-insecure-secret";
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    // A token missing either identifier is not merely stale — it predates
    // multi-tenancy, and honouring it would leave the tenant unresolved.
    if (typeof payload.userId !== "string" || typeof payload.businessId !== "string") return null;
    if (Date.now() / 1000 - payload.issuedAt > MAX_AGE_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return decode(jar.get(COOKIE)?.value);
}

export async function startSession(payload: {
  userId: string;
  businessId: string;
  employeeId?: string | null;
  registerId?: string | null;
}): Promise<void> {
  await write({
    userId: payload.userId,
    businessId: payload.businessId,
    employeeId: payload.employeeId ?? null,
    registerId: payload.registerId ?? null,
    issuedAt: Math.floor(Date.now() / 1000),
  });
}

/**
 * Change part of the session without re-authenticating — switching business,
 * or picking who is at the till. Anything not named keeps its current value.
 */
export async function updateSession(
  changes: Partial<Omit<SessionPayload, "issuedAt">>,
): Promise<void> {
  const current = await readSession();
  if (!current) return;
  await write({ ...current, ...changes });
}

async function write(payload: SessionPayload): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, encode(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
