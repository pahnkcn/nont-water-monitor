import { cmBetween, formatGap, thresholdGap } from "@/lib/format";
import type { Estimate } from "@/lib/summary";

// The signature gauge, drawn like a dimension on a survey drawing: one ruler marked every
// 10 cm, a silt column for the water, and a dimension line from the waterline to the next
// threshold carrying the same centimetres as the big numeral beside it.
// No metre values are drawn: the gauge's meter digit is unknown, so only marks are counted.

type Props = {
  level: number | null;
  /** How the level was estimated, when it was not a clean read. */
  estimate?: Estimate;
  watch: number;
  danger: number;
  /** Thresholds not yet confirmed by an admin; rail names get an asterisk. */
  provisional?: boolean;
};

const PITCH = 14; // px per 10 cm
const TOP_PAD = 12;
const W = 212;
const LABEL_X = 56; // rail names end here
const COL_X = 64;
const COL_W = 32;
const RULE_X = COL_X + COL_W;
const RAIL_END = 108;
const DIM_X = 132;
const TERM = 4; // half-length of a 45° dimension terminator

export function louvreRange(level: number | null, danger: number) {
  const top = Math.max(3.0, Math.ceil((danger + 0.3) * 10) / 10);
  const lowest = level === null ? 1.0 : Math.min(level, 1.0);
  const bottom = Math.max(0, Math.floor((lowest - 0.3) * 10) / 10);
  return { bottom, top };
}

export function Louvre({ level, estimate, watch, danger, provisional }: Props) {
  const { bottom, top } = louvreRange(level, danger);
  const steps = Math.round((top - bottom) * 10);
  const innerTop = TOP_PAD;
  const innerH = steps * PITCH;
  const base = innerTop + innerH;
  const H = base + TOP_PAD;
  const y = (m: number) => innerTop + ((top - m) / (top - bottom)) * innerH;
  const mark = provisional ? "*" : "";

  const clamped = level === null ? null : Math.min(top, Math.max(bottom, level));
  const waterY = clamped === null ? null : y(clamped);

  const rails = [
    { key: "watch", label: "เฝ้าระวัง", value: watch, color: "var(--watch)" },
    { key: "danger", label: "อันตราย", value: danger, color: "var(--danger)" },
  ].filter((r) => r.value > bottom && r.value < top); // danger listed last so it paints on top

  // The dimension measures the same gap as the numeral, so it can never disagree with it.
  const gap = level === null ? null : thresholdGap(level, { watch, danger }, estimate);
  const target = gap ? (gap.target === "watch" ? watch : danger) : null;
  const dim =
    gap && gap.cm > 0 && waterY !== null && target !== null && target > bottom && target < top
      ? {
          a: Math.min(y(target), waterY),
          b: Math.max(y(target), waterY),
          railY: y(target),
          color: gap.target === "watch" ? "var(--watch)" : "var(--danger)",
          prefix: gap.over ? "+" : gap.estimate === "below" ? ">" : gap.estimate === "approx" ? "≈" : "",
        }
      : null;

  const description =
    (level === null ? "ไม้วัดจำลอง ยังไม่มีค่าระดับน้ำ" : `ไม้วัดจำลอง ${formatGap(level, { watch, danger }, estimate)}`) +
    ` ระดับอันตรายสูงกว่าระดับเฝ้าระวัง ${cmBetween(danger, watch)} ซม. ขีดละ 10 ซม.` +
    (provisional ? " เกณฑ์ยังเป็นค่าชั่วคราว" : "");

  return (
    <svg className="louvre" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
      {/* water column and ruler */}
      <rect className="column" x={COL_X + 0.5} y={innerTop + 0.5} width={COL_W - 1} height={innerH - 1} />
      {waterY !== null && <rect className="water" x={COL_X} y={waterY} width={COL_W} height={base - waterY} />}
      {Array.from({ length: steps + 1 }, (_, i) => {
        const ty = innerTop + i * PITCH;
        // Every fifth mark is longer, counted on the gauge's own 10 cm steps.
        const long = Math.round(top * 10 - i) % 5 === 0;
        return <line key={i} className="tick" x1={RULE_X} x2={RULE_X + (long ? 10 : 5)} y1={ty} y2={ty} />;
      })}
      <line className="rule" x1={RULE_X} x2={RULE_X} y1={innerTop} y2={base} />

      {/* threshold rails */}
      {rails.map((r) => {
        const ry = y(r.value);
        // Labels sit level with their rail; when the rails crowd, danger's lifts above and watch's drops below.
        const crowded = rails.length === 2 && Math.abs(y(watch) - y(danger)) < 20;
        const nameY = crowded ? (r.key === "danger" ? ry - 8 : ry + 17) : ry + 4.5;
        // When the two rails would overlap, the lower (watch) rail thins so danger stays whole.
        const thin = r.key === "watch" && Math.abs(y(watch) - y(danger)) < 5;
        return (
          <g key={r.key}>
            <line x1={LABEL_X + 4} x2={RAIL_END} y1={ry} y2={ry} stroke={r.color} strokeWidth={thin ? 1 : 2} />
            <text className="rail-label" x={LABEL_X} y={nameY} textAnchor="end" fill="currentColor">
              {r.label}
              {mark}
            </text>
          </g>
        );
      })}

      {/* the reading: waterline and the dimension to the next threshold */}
      {waterY !== null && (
        <g className="reading">
          <line className="waterline" x1={COL_X} x2={DIM_X} y1={waterY} y2={waterY} />
          <circle className="origin" cx={DIM_X} cy={waterY} r={2.5} />
          {dim && gap && (
            <>
              <line x1={RAIL_END} x2={DIM_X + 5} y1={dim.railY} y2={dim.railY} stroke={dim.color} strokeWidth={1} />
              <line className="dim" x1={DIM_X} x2={DIM_X} y1={dim.a} y2={dim.b} />
              <path
                className="dim-end"
                d={`M${DIM_X - TERM} ${dim.a + TERM} l${TERM * 2} ${-TERM * 2} M${DIM_X - TERM} ${dim.b + TERM} l${TERM * 2} ${-TERM * 2}`}
              />
              <text
                className="dim-value"
                x={DIM_X + 7}
                y={Math.min(H - 4, Math.max(innerTop + 14, (dim.a + dim.b) / 2 + 7))}
              >
                {dim.prefix}
                {gap.cm}
                <tspan className="dim-unit"> ซม.</tspan>
              </text>
            </>
          )}
        </g>
      )}
    </svg>
  );
}
