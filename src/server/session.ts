import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "vender_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // One trading day.

export type SessionPayload = {
  employeeId: string;
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
    if (typeof payload.employeeId !== "string") return null;
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

export async function startSession(employeeId: string, registerId: string | null): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, encode({ employeeId, registerId, issuedAt: Math.floor(Date.now() / 1000) }), {
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
