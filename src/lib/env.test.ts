import assert from "node:assert/strict";
import { test } from "node:test";

import { checkDatabaseUrl } from "./env.ts";

/*
 * Every one of these is a mistake that otherwise surfaces as an opaque driver
 * error — "Invalid URL", "Tenant or user not found" — at the exact moment
 * someone is trying to connect for the first time.
 */

const message = (url: string | undefined) => {
  const result = checkDatabaseUrl(url, "DATABASE_URL");
  return result.ok ? null : result.message;
};

test("a real pooled Supabase URL passes", () => {
  const result = checkDatabaseUrl(
    "postgresql://postgres.abcdefghijklmnop:s3cret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
    "DATABASE_URL",
  );
  assert.equal(result.ok, true);
});

test("an unfilled template is named, not just rejected", () => {
  const text = message(
    "postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-[YOUR-REGION].pooler.supabase.com:6543/postgres",
  );
  assert.match(text!, /\[YOUR-PASSWORD\]/);
});

test("empty and missing are caught", () => {
  assert.match(message("")!, /is empty/);
  assert.match(message(undefined)!, /is empty/);
});

test("plain postgres username against a pooler is caught", () => {
  // Supabase returns "Tenant or user not found" for this, which explains nothing.
  const text = message("postgresql://postgres:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres");
  assert.match(text!, /postgres\.YOUR-PROJECT-REF/);
});

test("a password containing an unescaped @ is explained", () => {
  // Node's URL parser accepts this by taking the last @; the Postgres driver
  // splits on the first and ends up with a nonsense hostname.
  const text = message("postgresql://postgres.abc:pass@word@host.pooler.supabase.com:6543/postgres");
  assert.match(text!, /Percent-encode it/);
});

test("something that is not a Postgres URL at all", () => {
  assert.match(message("https://jusmuwfvvxlvkwlkntbc.supabase.co")!, /should start with postgresql/);
});

test("a URL with no password is caught", () => {
  assert.match(message("postgresql://postgres.abc@host.pooler.supabase.com:6543/postgres")!, /no password/);
});

test("a plain local Postgres URL is fine", () => {
  const result = checkDatabaseUrl(
    "postgresql://postgres:postgres@localhost:5432/vender?sslmode=disable",
    "DATABASE_URL",
  );
  assert.equal(result.ok, true);
});
