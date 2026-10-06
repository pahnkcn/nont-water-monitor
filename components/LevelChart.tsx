"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDateTime, formatGap, formatTime } from "@/lib/format";
import type { ChartPoint as Point } from "@/lib/public-state";
import { PlayIcon } from "./icons";
import { BANGKOK_OFFSET_MS } from "@/lib/schedule";
type Range = "24h" | "7d" | "30d";

const RANGE_LABEL: Record<Range, string> = { "24h": "24 ชม.", "7d": "7 วัน", "30d": "30 วัน" };
const HOUR = 3_600_000;
const SPAN: Record<Range, number> = { "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR };

const H = 240;
// No value axis: levels are not shown as metres (see lib/format.ts). The grid spacing is
// stated under the chart instead, and the grid is anchored on the watch line.
const PAD = { top: 16, right: 12, bottom: 28, left: 20 };

type Props = { day: Point[]; watch: number; danger: number; now: number; provisional?: boolean };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceStep(span: number) {
  for (const s of [0.05, 0.1, 0.2, 0.25, 0.5, 1]) if (span / s <= 5) return s;
  return 1;
}

function timeTicks(from: number, to: number, range: Range) {
  const step = range === "24h" ? 6 * HOUR : range === "7d" ? 24 * HOUR : 7 * 24 * HOUR;
  const local = (t: number) => t + BANGKOK_OFFSET_MS;
  const first = Math.ceil(local(from) / step) * step - BANGKOK_OFFSET_MS;
  const ticks: number[] = [];
  for (let t = first; t <= to; t += step) ticks.push(t);
  return ticks;
}

function tickLabel(t: number, range: Range) {
  if (range === "24h") return formatTime(t).replace(" น.", "");
  const d = new Date(t + BANGKOK_OFFSET_MS);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

export function LevelChart({ day, watch, danger, now, provisional }: Props) {
  const [range, setRange] = useState<Range>("24h");
  const [remote, setRemote] = useState<Partial<Record<Range, Point[]>>>({});
  const [failed, setFailed] = useState<Partial<Record<Range, boolean>>>({});
  const [active, setActive] = useState<number | null>(null);
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const titleId = useId();

  const points = range === "24h" ? day : remote[range];
  const status = points ? "idle" : failed[range] ? "error" : "loading";

  useEffect(() => {
    if (range === "24h" || remote[range] || failed[range]) return;
    let cancelled = false;
    fetch(`/api/readings?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { points: Point[] }) => {
        if (cancelled) return;
        setRemote((prev) => ({ ...prev, [range]: d.points }));
      })
      .catch(() => !cancelled && setFailed((prev) => ({ ...prev, [range]: true })));
    return () => {
      cancelled = true;
    };
  }, [range, remote, failed]);

  const geo = useMemo(() => {
    if (!points?.length || width < 50) return null;
    const to = Math.max(now, points.at(-1)![0]);
    const from = to - SPAN[range];
    const levels = points.map((p) => p[1]);
    let lo = Math.min(...levels) - 0.1;
    let hi = Math.max(...levels) + 0.1;
    if (hi - lo < 0.3) {
      const mid = (hi + lo) / 2;
      lo = mid - 0.15;
      hi = mid + 0.15;
    }
    const step = niceStep(hi - lo);
    lo = watch + Math.floor((lo - watch) / step) * step;
    hi = watch + Math.ceil((hi - watch) / step) * step;
    const iw = width - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - from) / (to - from)) * iw;
    const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * ih;
    const yTicks: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push(Math.round(v * 1000) / 1000);

    // Break the line where readings are missing for more than 40 minutes (camera down).
    const gap = range === "24h" ? 40 * 60_000 : range === "7d" ? 3 * HOUR : 8 * HOUR;
    const runs: Point[][] = [];
    for (const p of points) {
      const run = runs.at(-1);
      if (run && p[0] - run.at(-1)![0] <= gap) run.push(p);
      else runs.push([p]);
    }
    const line = runs.map((r) => r.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("")).join("");
    const area = runs
      .filter((r) => r.length > 1)
      .map(
        (r) =>
          `M${x(r[0][0]).toFixed(1)} ${y(lo)}` +
          r.map((p) => `L${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("") +
          `L${x(r.at(-1)![0]).toFixed(1)} ${y(lo)}Z`,
      )
      .join("");
    const rails = [
      { key: "watch", label: "เฝ้าระวัง", value: watch, color: "var(--watch)" },
      { key: "danger", label: "อันตราย", value: danger, color: "var(--danger)" },
    ].filter((r) => r.value >= lo && r.value <= hi);
    // Isolated readings (first reading, or one between camera outages) get a dot so they are visible.
    const singles = runs.filter((r) => r.length === 1).map((r) => r[0]);
    return { from, to, x, y, lo, hi, step, yTicks, line, area, rails, iw, singles };
  }, [points, width, range, now, watch, danger]);

  const pick = (clientX: number, el: SVGSVGElement) => {
    if (!geo || !points?.length) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geo.x(p[0]) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!points?.length) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const cur = active ?? points.length - 1;
      setActive(Math.max(0, Math.min(points.length - 1, cur + (e.key === "ArrowLeft" ? -1 : 1))));
    } else if (e.key === "Escape") setActive(null);
  };

  const activePoint = active !== null && points ? points[Math.min(active, points.length - 1)] : null;
  const latest = points?.at(-1);
  const th = { watch, danger };
  const gapAt = (p: Point) => formatGap(p[1], th, p[2]);
  const anyBelow = !!points?.some((p) => p[2] === "below");
  const anyApprox = !!points?.some((p) => p[2] === "approx");

  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="section__head">
        <h2 className="section__title" id={titleId}>
          ระดับน้ำย้อนหลัง {RANGE_LABEL[range]}
        </h2>
        <div className="slats" role="group" aria-label="ช่วงเวลา">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => {
                setRange(r);
                setActive(null);
              }}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="chart" ref={wrapRef}>
        {status === "loading" && !points ? (
          <div className="chart__state" role="status">
            กำลังโหลดข้อมูล {RANGE_LABEL[range]}…
          </div>
        ) : status === "error" && !points ? (
          <div className="chart__state" role="alert">
            <div>
              <p>โหลดข้อมูลย้อนหลังไม่สำเร็จ</p>
              <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setFailed((p) => ({ ...p, [range]: false }))}>
                ลองโหลดอีกครั้ง
              </button>
            </div>
          </div>
        ) : !points?.length ? (
          <div className="chart__state">ยังไม่มีค่าที่บันทึกในช่วงนี้ ระบบอ่านค่าทุก 10 นาที ค่าแรกจะขึ้นที่นี่</div>
        ) : geo ? (
          <>
            <svg
              width={width}
              height={H}
              viewBox={`0 0 ${width} ${H}`}
              role="img"
              aria-label={`กราฟระดับน้ำ ${RANGE_LABEL[range]} ล่าสุด ${latest ? gapAt(latest) : "ไม่มีค่า"} ใช้ลูกศรซ้ายขวาเพื่อดูค่าแต่ละจุด`}
              tabIndex={0}
              onKeyDown={onKey}
              onPointerMove={(e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget)}
              onPointerDown={(e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget)}
              onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
              onBlur={() => setActive(null)}
            >
              {geo.yTicks.map((v) => (
                <line key={v} className="grid" x1={PAD.left} x2={width - PAD.right} y1={geo.y(v)} y2={geo.y(v)} />
              ))}
              {timeTicks(geo.from, geo.to, range).map((t) => (
                <text key={t} className="axis-text num" x={geo.x(t)} y={H - 8} textAnchor="middle">
                  {tickLabel(t, range)}
                </text>
              ))}
              {/* the same plain 2px rail as on the gauge */}
              {geo.rails.map((r) => (
                <line key={r.key} x1={PAD.left} x2={width - PAD.right} y1={geo.y(r.value)} y2={geo.y(r.value)} stroke={r.color} strokeWidth="2" />
              ))}
              <path className="area" d={geo.area} />
              <path className="line" d={geo.line} />
              {/* rail names paint over the line so their knockout keeps them legible */}
              {geo.rails.map((r) => (
                <text key={r.key} x={PAD.left + 6} y={geo.y(r.value) - 6} className="axis-text rail-name">
                  {r.label}
                  {provisional ? "*" : ""}
                </text>
              ))}
              {geo.singles.map((p) => (
                <circle key={p[0]} className="dot" cx={geo.x(p[0])} cy={geo.y(p[1])} r="4" />
              ))}
              {latest && <circle className="dot" cx={geo.x(latest[0])} cy={geo.y(latest[1])} r="4" />}
              {activePoint && (
                <g>
                  <line className="cross" x1={geo.x(activePoint[0])} x2={geo.x(activePoint[0])} y1={PAD.top} y2={H - PAD.bottom} />
                  <circle className="dot" cx={geo.x(activePoint[0])} cy={geo.y(activePoint[1])} r="5" />
                </g>
              )}
            </svg>
            {activePoint && (
              <div
                className="chart__tip num"
                style={{ left: Math.min(Math.max(geo.x(activePoint[0]), 100), width - 100) }}
                aria-live="polite"
              >
                <strong>{gapAt(activePoint)}</strong>
                <br />
                {range === "24h" ? formatTime(activePoint[0]) : formatDateTime(activePoint[0])}
              </div>
            )}
          </>
        ) : (
          <div className="chart__state" aria-hidden>
            {" "}
          </div>
        )}
      </div>

      {latest && (
        <p className="legend-rails">
          ล่าสุด {gapAt(latest)}
          {geo && ` · เส้นแนวนอนห่างกัน ${Math.round(geo.step * 100)} ซม.`}
          {anyApprox && " · ช่วงที่น้ำอยู่ช่วงล่างของไม้วัดเป็นค่าประมาณ อาจคลาดเคลื่อนราว 5 ซม."}
          {anyBelow && " · ช่วงที่น้ำต่ำกว่าที่ระบบอ่านได้ เส้นแสดงที่ค่าต่ำสุดที่อ่านได้"}
          {range !== "24h" && " · แต่ละจุดคือค่าสูงสุดในช่วงนั้น"}
          {provisional && " · * เกณฑ์ชั่วคราว"}
        </p>
      )}

      {!!points?.length && (
        <details className="table-view">
          <summary>
            <PlayIcon size={12} className="disclosure" />
            ดูเป็นตาราง
          </summary>
          <div className="table-scroll">
            <table className="readings-table num">
              <thead>
                <tr>
                  <th scope="col">เวลา</th>
                  <th scope="col">ระดับน้ำ</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p[0]}>
                    <td>{formatDateTime(p[0])}</td>
                    <td>{gapAt(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
