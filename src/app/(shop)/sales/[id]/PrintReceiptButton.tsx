"use client";

import { Printer } from "lucide-react";

/**
 * Sends the hidden `.receipt` block on this page to the printer. The print
 * stylesheet hides everything else, so the back office prints the same 80mm
 * document the customer was handed — marked as a re-print.
 */
export function PrintReceiptButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-secondary px-3.5 py-2">
      <Printer size={15} />
      Print receipt
    </button>
  );
}
