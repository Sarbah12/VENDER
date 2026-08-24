import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * PGlite ships a WASM build of Postgres and reaches for node:fs directly. Left
   * to the bundler it gets rewritten and fails at runtime, so it is required
   * from node_modules as-is. `postgres` is external for the same reason once a
   * hosted DATABASE_URL is in play.
   */
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],

  turbopack: {
    // Without this, the presence of a lockfile further up the tree makes Turbopack
    // infer the home directory as the workspace root.
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
