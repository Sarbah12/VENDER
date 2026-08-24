import { NextResponse } from "next/server";

import { can } from "@/server/authz";
import { getShopContext, isSignedIn } from "@/server/context";
import { buildTemplateWorkbook } from "@/server/import";

export const dynamic = "force-dynamic";

/** Serves the starter workbook, filled in with the shop's own currency. */
export async function GET() {
  const context = await getShopContext();
  if (!context || !isSignedIn(context)) {
    return new NextResponse("Sign in first.", { status: 401 });
  }
  if (!can(context.employee, "catalogue:import")) {
    return new NextResponse("You do not have permission to import.", { status: 403 });
  }

  const workbook = await buildTemplateWorkbook(context.business.currencyCode);

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="product-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
