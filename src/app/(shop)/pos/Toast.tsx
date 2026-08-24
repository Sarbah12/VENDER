"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useEffect } from "react";

export type ToastMessage = { kind: "success" | "warn" | "error"; text: string };

const STYLE: Record<ToastMessage["kind"], { class: string; icon: typeof CheckCircle2 }> = {
  success: { class: "bg-positive text-white", icon: CheckCircle2 },
  warn: { class: "bg-warning text-white", icon: AlertTriangle },
  error: { class: "bg-danger text-white", icon: XCircle },
};

export function Toast({
  message,
  onDismiss,
}: {
  message: ToastMessage | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    // Errors stay long enough to read and act on; confirmations get out of the way.
    const timer = setTimeout(onDismiss, message.kind === "error" ? 6000 : 3200);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  const { class: tone, icon: Icon } = STYLE[message.kind];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`animate-rise fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${tone}`}
    >
      <Icon size={17} className="shrink-0" />
      <span>{message.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 rounded px-1.5 py-0.5 text-xs font-bold opacity-70 transition-opacity hover:opacity-100"
      >
        Dismiss
      </button>
    </div>
  );
}
