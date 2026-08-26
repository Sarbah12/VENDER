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

  /**
   * Baseline security headers.
   *
   * A POS holds money and customer records, and these cost nothing. No CSP yet
   * — Next injects inline scripts for hydration, so a strict policy needs
   * nonce plumbing, and a loose one is theatre. The rest are unambiguous.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The app never belongs in someone else's frame; clickjacking a
          // "complete sale" button is a real attack on a till.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here needs a camera, a microphone or a location.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Session cookies are marked secure in production; this stops a
          // downgrade attempt reaching the server at all.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Receipts and reports are a business's own records.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },

  turbopack: {
    // Without this, the presence of a lockfile further up the tree makes Turbopack
    // infer the home directory as the workspace root.
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
