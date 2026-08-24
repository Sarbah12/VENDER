import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 32;

/**
 * Till PINs are hashed with scrypt and a per-PIN salt. A four-digit PIN has only
 * ten thousand possibilities, so the hash is not what protects it — the deliberate
 * cost of scrypt and the small keyspace mean this is shift attribution, not
 * account security. Real account authentication belongs to the Administration
 * module and should carry a password, a second factor, and rate limiting.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(pin.normalize("NFKC"), salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(
    pin.normalize("NFKC"),
    Buffer.from(saltHex, "hex"),
    expected.length,
  )) as Buffer;

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
