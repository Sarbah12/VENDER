import { formatWeekday } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";

export type SalesPoint = {
  day: string;
  revenue: number;
  tax: number;
  discount: number;
  transactions: number;
};

/**
 * Hand-drawn SVG rather than a charting library: it is one chart, it renders on
 * the server with no hydration cost, and a till running on a cheap Android
 * tablet does not need 90KB of JavaScript to draw fourteen rectangles.
 *
 * Each bar splits net takings from the tax inside them, because the tax portion
 * is money the shop is holding for the revenue authority, not money it earned.
 */
export function SalesBarChart({
  data,
  currencyCode,
  height = 220,
}: {
  data: SalesPoint[];
  currencyCode: string;
  height?: number;
}) {
  const width = 720;
  const padding = { top: 12, right: 8, bottom: 26, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const peak = Math.max(...data.map((d) => d.revenue), 0);
  // A shop that has not sold anything yet still needs a readable axis, so the
  // scale never drops below a sensible floor.
  const ceiling = niceCeiling(Math.max(peak, 10_000));
  const slot = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(slot * 0.62, 34);

  // Deduplicated: on a small scale two fractions can round to the same figure,
  // which would draw gridlines on top of each other.
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(ceiling * f)))];

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Daily takings for the last ${data.length} days`}
        preserveAspectRatio="none"
      >
        {ticks.map((tick, index) => {
          const y = padding.top + plotHeight - (tick / ceiling) * plotHeight;
          return (
            <g key={`tick-${index}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="var(--text-faint)"
              >
                {compact(tick)}
              </text>
            </g>
          );
        })}

        {data.map((point, index) => {
          const x = padding.left + index * slot + (slot - barWidth) / 2;
          const totalHeight = (point.revenue / ceiling) * plotHeight;
          const taxHeight = point.revenue > 0 ? (point.tax / ceiling) * plotHeight : 0;
          const netHeight = Math.max(totalHeight - taxHeight, 0);
          const baseY = padding.top + plotHeight;

          // Built as one string rather than several JSX children: an SVG <title>
          // with multiple text nodes does not survive hydration intact.
          const tooltip = `${formatDay(point.day)} — ${formatAmount(
            point.revenue,
            currencyCode,
          )} across ${point.transactions} sale${point.transactions === 1 ? "" : "s"}`;

          return (
            <g key={point.day}>
              <title>{tooltip}</title>
              {point.revenue > 0 ? (
                <>
                  <rect
                    x={x}
                    y={baseY - netHeight}
                    width={barWidth}
                    height={netHeight}
                    fill="var(--brand)"
                    rx={2}
                  />
                  {taxHeight > 0.5 && (
                    <rect
                      x={x}
                      y={baseY - totalHeight}
                      width={barWidth}
                      height={taxHeight}
                      fill="var(--info)"
                      rx={2}
                    />
                  )}
                </>
              ) : (
                <rect x={x} y={baseY - 2} width={barWidth} height={2} fill="var(--border-strong)" rx={1} />
              )}
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--text-faint)"
              >
                {shortDay(point.day)}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-muted">
        <Key colour="var(--brand)" label="Net takings" />
        <Key colour="var(--info)" label="Tax collected" />
        <span className="ml-auto tnum">
          Peak day {formatAmount(peak, currencyCode)} {currencyCode}
        </span>
      </figcaption>
    </figure>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-2.5 rounded-sm" style={{ background: colour }} />
      {label}
    </span>
  );
}

/** Round the axis up to something a human would choose. */
function niceCeiling(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function compact(minorUnits: number): string {
  const major = minorUnits / 100;
  if (major >= 1000) return `${Math.round(major / 100) / 10}k`;
  return String(Math.round(major));
}

function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function formatDay(iso: string): string {
  return formatWeekday(`${iso}T00:00:00`);
}
