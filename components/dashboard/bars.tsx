import { formatUnits } from "viem";
import { MUSD_DECIMALS } from "@/lib/chain/config";
import { musdShort } from "@/lib/client/format";

/** Daily confirmed volume as plain SVG bars, with a screen-reader table. No chart library. `tips: -1` hides the count. */
export function DailyBars({ series, symbol = "MUSD" }: { series: { day: string; amountRaw: string; tips: number }[]; symbol?: string }) {
  const values = series.map((s) => Number(formatUnits(BigInt(s.amountRaw || "0"), MUSD_DECIMALS)));
  const max = Math.max(...values, 0);
  const n = series.length || 1;
  const W = 100;
  const H = 40;
  const gap = n > 40 ? 0.2 : 0.5;
  const bw = W / n - gap;
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-44 w-full" aria-hidden>
        <line x1="0" x2={W} y1={H - 0.1} y2={H - 0.1} stroke="var(--border)" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
        {series.map((s, i) => {
          const h = max > 0 ? (values[i] / max) * (H - 2) : 0;
          return (
            <rect key={s.day} x={i * (W / n) + gap / 2} y={H - Math.max(h, values[i] > 0 ? 0.6 : 0)} width={Math.max(bw, 0.3)} height={Math.max(h, values[i] > 0 ? 0.6 : 0)} rx="0.4" fill="var(--brand)">
              <title>{`${label(s.day)}: ${musdShort(s.amountRaw)} ${symbol}${s.tips >= 0 ? `, ${s.tips} tips` : ""}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{series[0] ? label(series[0].day) : ""}</span>
        <span>Peak day: {max > 0 ? `${max.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}` : "none yet"}</span>
        <span>{series.length ? label(series[series.length - 1].day) : ""}</span>
      </figcaption>
      <table className="sr-only">
        <caption>Confirmed {symbol} per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>{symbol}</th>
            {series.some((s) => s.tips >= 0) ? <th>Tips</th> : null}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.day}>
              <td>{label(s.day)}</td>
              <td>{musdShort(s.amountRaw)}</td>
              {s.tips >= 0 ? <td>{s.tips}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
