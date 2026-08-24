import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Liveness for the host's health checks and uptime monitoring.
 *
 * It actually touches the database rather than just returning 200, because an
 * app that cannot reach Postgres is useless to a till and should be taken out
 * of rotation. Deliberately says nothing about the connection itself — a health
 * endpoint is public, and hostnames are not something to hand out.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const db = await getDb();
    await db.execute(sql`select 1`);

    return NextResponse.json(
      { status: "ok", database: "reachable", latencyMs: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json(
      { status: "degraded", database: "unreachable", latencyMs: Date.now() - startedAt },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
