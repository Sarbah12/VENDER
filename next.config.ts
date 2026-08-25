import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone output — a self-contained server carrying only the modules it
   * actually uses — is what the Dockerfile ships to Railway, Fly or a VPS.
   *
   * Vercel must not get it. It builds its own serverless output and expects the
   * default trace files; standalone replaces them, and the build dies on a
   * missing next-server.js.nft.json well after "Compiled successfully".
   */
  output: process.env.VERCEL ? undefined : "standalone",

  /**
   * PGlite ships a WASM build of Postgres and reaches for node:fs directly. Left
   * to the bundler it gets rewritten and fails at runtime, so it is required
   * from node_modules as-is. `postgres` is external for the same reason once a
   * hosted DATABASE_URL is in play.
   */
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "exceljs"],

  experimental: {
    serverActions: {
      // Catalogue imports arrive as a whole spreadsheet. The 1MB default rejects
      // a few hundred products with barcodes; 8MB covers a large shop's export.
      bodySizeLimit: "8mb",
    },
  },

  turbopack: {
    // Without this, the presence of a lockfile further up the tree makes Turbopack
    // infer the home directory as the workspace root.
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
