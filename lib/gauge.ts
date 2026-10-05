import type { GaugeConfig, GaugeMark } from "./gauge-config";

/** Packed RGB24 pixels, row-major. */
export type RGBFrame = { width: number; height: number; data: Uint8Array };

export type WaterlineResult = {
  /** Row of the first wet pixel on the axis, or null when unreadable. */
  y: number | null;
  /** Water covers the whole scanned span. */
  aboveTop: boolean;
  /** No water found before the end of the scanned span. */
  belowRange: boolean;
  /** Frame too dark to read (camera off, night without lamp). */
  dark: boolean;
  /** The always-dry part of the gauge looks like a gauge (camera has not moved). */
  baselineOk: boolean;
  /** Whiteness just above the line minus just below; near 1 is a crisp edge. */
  contrast: number;
};

export type GaugeReading = {
  ok: boolean;
  level: number | null;
  y: number | null;
  confidence: "high" | "low";
  aboveTop: boolean;
  belowRange: boolean;
  reason?: "dark" | "gauge-not-visible" | "frames-disagree" | "weak-edge" | "no-frames";
  frames: WaterlineResult[];
};

const WET_RUN = 5; // consecutive wet rows (~2.5 cm) before we call it water
const WET_WHITE_MAX = 0.3;
const OCCLUDER_MIN = 0.4;
const BASELINE_MIN = 0.45;
const DARK_LUMA = 25;
const MAX_SPREAD_PX = 6; // ~3 cm between frames
const MIN_CONTRAST = 0.35;

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function axisX(cfg: GaugeConfig, y: number) {
  const { top, bottom } = cfg.axis;
  return top.x + ((y - top.y) * (bottom.x - top.x)) / (bottom.y - top.y);
}

type RowStats = { white: number; occluder: number };

function rowStats(frame: RGBFrame, cfg: GaugeConfig, y: number, whiteLuma: number): RowStats {
  const cx = Math.round(axisX(cfg, y));
  let white = 0;
  let occluder = 0;
  let n = 0;
  for (let dx = -cfg.halfWidth; dx <= cfg.halfWidth; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= frame.width) continue;
    const i = (y * frame.width + x) * 3;
    const r = frame.data[i];
    const g = frame.data[i + 1];
    const b = frame.data[i + 2];
    const max = Math.max(r, g, b);
    const sat = max ? (max - Math.min(r, g, b)) / max : 0;
    if (luma(r, g, b) >= whiteLuma && sat < 0.28) white++;
    // The blue PVC pipe that crosses near the gauge foot.
    else if (b > r + 25 && b > g + 5 && sat > 0.35) occluder++;
    n++;
  }
  return { white: n ? white / n : 0, occluder: n ? occluder / n : 0 };
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Learn the brightness of the gauge face from the always-dry baseline rows. */
function whiteThreshold(frame: RGBFrame, cfg: GaugeConfig) {
  const lumas: number[] = [];
  for (let y = cfg.baseline.y0; y <= cfg.baseline.y1; y += 2) {
    const cx = Math.round(axisX(cfg, y));
    for (let dx = -cfg.halfWidth; dx <= cfg.halfWidth; dx += 2) {
      const i = (y * frame.width + cx + dx) * 3;
      lumas.push(luma(frame.data[i], frame.data[i + 1], frame.data[i + 2]));
    }
  }
  return Math.max(90, 0.7 * percentile(lumas, 0.9));
}

function frameMeanLuma(frame: RGBFrame) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < frame.data.length; i += 3 * 97) {
    sum += luma(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
    n++;
  }
  return n ? sum / n : 0;
}

export function detectWaterline(frame: RGBFrame, cfg: GaugeConfig): WaterlineResult {
  const empty = { y: null, aboveTop: false, belowRange: false, contrast: 0 };
  if (frameMeanLuma(frame) < DARK_LUMA) return { ...empty, dark: true, baselineOk: false };

  const whiteLuma = whiteThreshold(frame, cfg);
  const y0 = cfg.axis.top.y;
  const y1 = Math.min(cfg.axis.bottom.y, frame.height - 1);
  const rows: RowStats[] = [];
  for (let y = y0; y <= y1; y++) rows.push(rowStats(frame, cfg, y, whiteLuma));

  let baseSum = 0;
  let baseN = 0;
  for (let y = cfg.baseline.y0; y <= cfg.baseline.y1; y++) {
    baseSum += rows[y - y0]?.white ?? 0;
    baseN++;
  }
  const baselineOk = baseN > 0 && baseSum / baseN >= BASELINE_MIN;

  // Average each row with its neighbours: single dark tick rows and specks of glare should not decide the edge.
  const smooth = rows.map((row, k) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, k - 1); j <= Math.min(rows.length - 1, k + 1); j++) {
      if (rows[j].occluder >= OCCLUDER_MIN) continue;
      s += rows[j].white;
      n++;
    }
    return n ? s / n : row.white;
  });

  let runStart = -1;
  let runLen = 0;
  let found = -1;
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    if (row.occluder >= OCCLUDER_MIN) continue; // neither gauge nor water: skip without breaking a run
    if (smooth[k] < WET_WHITE_MAX) {
      if (runLen === 0) runStart = k;
      runLen++;
      if (runLen >= WET_RUN) {
        found = runStart;
        break;
      }
    } else {
      runLen = 0;
    }
  }

  if (found === -1) return { ...empty, y: y1, belowRange: true, dark: false, baselineOk };

  const y = y0 + found;
  const mean = (from: number, to: number) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, from); k < Math.min(rows.length, to); k++) {
      if (rows[k].occluder >= OCCLUDER_MIN) continue;
      s += rows[k].white;
      n++;
    }
    return n ? s / n : 0;
  };
  const contrast = mean(found - 15, found) - mean(found, found + WET_RUN * 2);
  return { y, aboveTop: found === 0, belowRange: false, dark: false, baselineOk, contrast };
}

/** Piecewise-linear map from image row to gauge level, extrapolating at both ends. */
export function yToLevel(y: number, marks: GaugeMark[]): number {
  if (marks.length < 2) throw new Error("need at least two calibration marks");
  const m = [...marks].sort((a, b) => a.y - b.y);
  let i = 0;
  if (y <= m[0].y) i = 0;
  else if (y >= m[m.length - 1].y) i = m.length - 2;
  else while (i < m.length - 2 && y > m[i + 1].y) i++;
  const a = m[i];
  const b = m[i + 1];
  return a.level + ((y - a.y) * (b.level - a.level)) / (b.y - a.y);
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Read several frames from the same moment and agree on one level. */
export function readGauge(frames: RGBFrame[], cfg: GaugeConfig): GaugeReading {
  const results = frames.map((f) => detectWaterline(f, cfg));
  const base = { aboveTop: false, belowRange: false, frames: results };
  if (!results.length) return { ...base, ok: false, level: null, y: null, confidence: "low", reason: "no-frames" };

  const usable = results.filter((r) => !r.dark && r.y !== null);
  if (!usable.length) return { ...base, ok: false, level: null, y: null, confidence: "low", reason: "dark" };

  const aboveTop = usable.filter((r) => r.aboveTop).length > usable.length / 2;
  const belowRange = usable.filter((r) => r.belowRange).length > usable.length / 2;
  const ys = usable.map((r) => r.y as number);
  const y = Math.round(median(ys));
  const level = Math.round(yToLevel(y, cfg.marks) * 100) / 100;

  const spread = Math.max(...ys) - Math.min(...ys);
  const baselineOk = usable.every((r) => r.baselineOk);
  const contrast = median(usable.map((r) => r.contrast));

  let reason: GaugeReading["reason"];
  if (!baselineOk && !aboveTop) reason = "gauge-not-visible";
  else if (spread > MAX_SPREAD_PX) reason = "frames-disagree";
  else if (!aboveTop && !belowRange && contrast < MIN_CONTRAST) reason = "weak-edge";
  else if (usable.length < results.length) reason = "dark";

  if (reason === "gauge-not-visible") {
    return { ...base, ok: false, level: null, y, confidence: "low", reason, aboveTop, belowRange };
  }
  const confidence = reason || aboveTop ? "low" : "high";
  return { ...base, ok: true, level, y, confidence, reason, aboveTop, belowRange };
}
