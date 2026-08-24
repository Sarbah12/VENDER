import type { LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * What an unbuilt module shows.
 *
 * The alternative — hiding the module until it exists — makes the product look
 * like a POS with ambitions rather than a platform being built out in order. So
 * the route exists, says plainly what will live there, and points at the part
 * that already works.
 */
export function ModulePlaceholder({
  icon: Icon,
  title,
  summary,
  plan,
  dependsOn,
}: {
  icon: LucideIcon;
  title: string;
  summary: string;
  plan: string[];
  dependsOn?: { label: string; href: string };
}) {
  return (
    <div className="card mx-auto max-w-2xl p-8">
      <span className="grid size-12 place-items-center rounded-xl bg-brand-soft text-brand">
        <Icon size={24} />
      </span>

      <h2 className="mt-5 text-xl font-bold tracking-tight">{title}</h2>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{summary}</p>

      <p className="label mt-7">What goes here</p>
      <ul className="mt-1 space-y-2">
        {plan.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
            <span aria-hidden className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-brand" />
            <span className="text-muted">{item}</span>
          </li>
        ))}
      </ul>

      {dependsOn && (
        <p className="mt-7 rounded-lg bg-surface-2 px-4 py-3 text-[0.8125rem] text-muted">
          The data model for this already exists — it is written by{" "}
          <Link href={dependsOn.href} className="font-semibold text-brand hover:underline">
            {dependsOn.label}
          </Link>
          .
        </p>
      )}
    </div>
  );
}
