import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/AppShell";
import { brand } from "@/lib/brand";
import { getShopContext, isSignedIn } from "@/server/context";
import { signOut } from "./actions";

// Every page under this shell reads the session and the shop it belongs to, so
// none of them can be prerendered — and the build must not need a database.
export const dynamic = "force-dynamic";

export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const context = await getShopContext();
  if (!context) redirect("/setup");
  if (!isSignedIn(context)) redirect("/sign-in");

  return (
    <AppShell
      brandName={brand.name}
      user={{
        name: context.employee.name,
        role: context.employee.role,
        initials: initials(context.employee.name),
      }}
      shop={{
        business: context.business.name,
        branch: context.branch.name,
        register: context.register?.name ?? null,
      }}
      signOut={signOut}
    >
      {children}
    </AppShell>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
