import { useId } from "react";
import { cmBetween, formatGap } from "@/lib/format";

// The signature gauge: a louvred shutter like the awnings of the old provincial hall.
// One blade is 10 cm on the staff gauge. Above the water the blades stand open, with the
// dark interior showing between them; below it each blade is shut and stained with silt.
// The watch and danger thresholds cross the shutter as balustrade rails.
// No metre values are drawn: the gauge's meter digit is unknown, so only blades are counted.

type Props = {
  level: number | null;
  watch: number;
  danger: number;
  /** Thresholds not yet confirmed by an admin; rail names get an asterisk. */
  provisional?: boolean;
};

const SLAT = 14; // px per 10 cm
const OPEN_BLADE = 6; // visible blade face when open; the rest of the pitch is gap
const TOP_PAD = 12;
const W = 212;
const FRAME_X = 64;
const FRAME_W = 92;
const STILE = 6;
const RAIL_H = 10;

export function louvreRange(level: number | null, danger: number) {
  const top = Math.max(3.0, Math.ceil((danger + 0.3) * 10) / 10);
  const lowest = level === null ? 1.0 : Math.min(level, 1.0);
  const bottom = Math.max(0, Math.floor((lowest - 0.3) * 10) / 10);
  return { bottom, top };
}

export function Louvre({ level, watch, danger, provisional }: Props) {
  const uid = useId().replace(/:/g, "");
  const { bottom, top } = louvreRange(level, danger);
  const slats = Math.round((top - bottom) * 10);
  const innerTop = TOP_PAD;
  const innerH = slats * SLAT;
  const H = innerTop + innerH + TOP_PAD;
  const y = (m: number) => innerTop + ((top - m) / (top - bottom)) * innerH;
  const innerX = FRAME_X + STILE;
  const innerW = FRAME_W - STILE * 2;
  const mark = provisional ? "*" : "";

  const clamped = level === null ? null : Math.min(top, Math.max(bottom, level));
  const waterY = clamped === null ? null : y(clamped);

  const rails = [
    { key: "watch", label: "เฝ้าระวัง", value: watch, color: "var(--watch)" },
    { key: "danger", label: "อันตราย", value: danger, color: "var(--danger)" },
  ].filter((r) => r.value > bottom && r.value < top); // danger listed last so it paints on top

  const description =
    (level === null ? "ไม้วัดจำลอง ยังไม่มีค่าระดับน้ำ" : `ไม้วัดจำลอง ${formatGap(level, { watch, danger })}`) +
    ` ระดับอันตรายสูงกว่าระดับเฝ้าระวัง ${cmBetween(danger, watch)} ซม. ช่องละ 10 ซม.` +
    (provisional ? " เกณฑ์ยังเป็นค่าชั่วคราว" : "");

  return (
    <svg className="louvre" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
      <defs>
        {rails.map((r) => (
          <pattern key={r.key} id={`${uid}-${r.key}`} width={RAIL_H} height={RAIL_H} patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width={RAIL_H} height={RAIL_H} fill="var(--ground)" />
            <rect x="1" y="1" width={RAIL_H - 2} height={RAIL_H - 2} fill="none" stroke={r.color} strokeWidth="1.6" />
            <path d={`M2.2 2.2 ${RAIL_H - 2.2} ${RAIL_H - 2.2}M${RAIL_H - 2.2} 2.2 2.2 ${RAIL_H - 2.2}`} stroke={r.color} strokeWidth="1.4" />
          </pattern>
        ))}
      </defs>

      {/* frame and the dark interior seen through open blades */}
      <rect className="stile" x={FRAME_X} y={innerTop - STILE} width={FRAME_W} height={innerH + STILE * 2} />
      <rect className="interior" x={innerX} y={innerTop} width={innerW} height={innerH} />
      {waterY !== null && (
        <rect className="water" x={innerX} y={waterY} width={innerW} height={innerTop + innerH - waterY} />
      )}

      {Array.from({ length: slats }, (_, i) => {
        const sy = innerTop + i * SLAT;
        const shut = waterY !== null && sy >= waterY - 1;
        if (shut) {
          const order = slats - 1 - i; // the bottom blade shuts first
          return (
            <g key={i} className="blade-shut" style={{ animationDelay: `${order * 70}ms` }}>
              <rect className="blade-wet" x={innerX} y={sy} width={innerW} height={SLAT} />
              <rect className="blade-overlap" x={innerX} y={sy} width={innerW} height={2} />
            </g>
          );
        }
        return (
          <g key={i}>
            <rect className="slat" x={innerX} y={sy + 1} width={innerW} height={OPEN_BLADE} />
            <rect className="slat-edge" x={innerX} y={sy + 1 + OPEN_BLADE} width={innerW} height={1.5} />
          </g>
        );
      })}

      {/* threshold rails */}
      {rails.map((r) => {
        const ry = y(r.value);
        // Labels sit level with their rail; when the rails crowd, danger's lifts above and watch's drops below.
        const crowded = rails.length === 2 && Math.abs(y(watch) - y(danger)) < 20;
        const nameY = crowded ? (r.key === "danger" ? ry - 8 : ry + 17) : ry + 4.5;
        // When the two rails would overlap, the lower (watch) rail thins to a line so danger stays whole.
        const thin = r.key === "watch" && Math.abs(y(watch) - y(danger)) < RAIL_H + 3;
        // Rails stop at the frame's right edge so they never run into the reading flag.
        const x1 = FRAME_X - 4;
        const x2 = FRAME_X + FRAME_W;
        return (
          <g key={r.key}>
            {thin ? (
              <line x1={x1} x2={x2} y1={ry} y2={ry} stroke={r.color} strokeWidth="3" />
            ) : (
              <>
                <rect x={x1} y={ry - RAIL_H / 2} width={x2 - x1} height={RAIL_H} fill={`url(#${uid}-${r.key})`} />
                <line x1={x1} x2={x2} y1={ry - RAIL_H / 2} y2={ry - RAIL_H / 2} stroke={r.color} strokeWidth="2" />
              </>
            )}
            <text className="rail-label" x={FRAME_X - 7} y={nameY} textAnchor="end" fill="currentColor">
              {r.label}
              {mark}
            </text>
          </g>
        );
      })}

      {/* the reading */}
      {waterY !== null && level !== null && (
        <g>
          <line className="waterline" x1={innerX} x2={FRAME_X + FRAME_W + 4} y1={waterY} y2={waterY} />
          <path
            className="marker"
            d={`M${FRAME_X + FRAME_W + 4} ${waterY} l6 -11 h${W - FRAME_X - FRAME_W - 10} v22 h-${W - FRAME_X - FRAME_W - 10} z`}
          />
          <text className="marker-text" x={FRAME_X + FRAME_W + 12} y={waterY + 5}>
            ตอนนี้
          </text>
        </g>
      )}
    </svg>
  );
}
