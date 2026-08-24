import { BarChart3 } from "lucide-react";

import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <ModulePlaceholder
      icon={BarChart3}
      title="Reports"
      summary="The idea document asks for actionable insight rather than raw numbers, so this module is about answers, not another table of rows."
      plan={[
        "Profit and loss and balance sheet, drawn straight from the journal.",
        "Sales by hour, day, cashier, branch and payment method.",
        "Product performance: movers, dead stock, and margin by category.",
        "Stock valuation at a point in time, rebuilt from stock movements.",
        "Z-report per till session — takings, tenders, and the drawer variance.",
      ]}
      dependsOn={{ label: "the trial balance", href: "/finance" }}
    />
  );
}
