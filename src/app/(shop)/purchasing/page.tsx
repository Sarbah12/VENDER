import { Truck } from "lucide-react";

import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata = { title: "Purchasing" };

export default function PurchasingPage() {
  return (
    <ModulePlaceholder
      icon={Truck}
      title="Purchasing"
      summary="The other half of inventory: what comes in, what it cost, and who is owed for it."
      plan={[
        "Raise a purchase order against a supplier and a warehouse.",
        "Receive stock in full or in part, moving inventory and updating weighted average cost.",
        "Record the supplier invoice, posting to Accounts Payable rather than to cash.",
        "Match receipts to invoices so short deliveries and price differences surface early.",
      ]}
      dependsOn={{ label: "stock movements", href: "/inventory/movements" }}
    />
  );
}
