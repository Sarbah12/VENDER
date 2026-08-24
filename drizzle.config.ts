import { defineConfig } from "drizzle-kit";

/**
 * `npm run db:generate` only reads the schema, so no credentials are needed.
 * Migrations are applied at runtime by src/db/client.ts against whichever
 * Postgres is configured — embedded PGlite locally, hosted Postgres in prod.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : { driver: "pglite" as const, dbCredentials: { url: "./.data/pg" } }),
});
