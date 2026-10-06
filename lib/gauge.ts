import type { GaugeConfig, GaugeMark } from "./gauge-config";

/** Packed RGB24 pixels, row-major. */
export type RGBFrame = { width: number; height: number; data: Uint8Array };

export type WaterlineResult = {
  /** Row of the first wet pixel on the axis (the last row scanned when belowRange), or null when unreadable. */
  y: number | null;
  /** Water covers the whole scanned span. */
  aboveTop: boolean;
  /** No water found before the end of the scanned span, the low zone included. */
  belowRange: boolean;
  /** Found in the low zone under the axis, where the reading is only an estimate. */
  approx: boolean;
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
  /** The waterline is in the low zone: its row is right, the level is an estimate. */
  approx: boolean;
  reason?:
    | "dark"
    | "gauge-not-visible"
    | "frames-disagree"
    | "weak-edge"
    | "no-frames"
    // set by lib/autotrack.ts
    | "camera-moved"
    | "gauge-lost";
  frames: WaterlineResult[];
};

const WET_RUN = 5; // consecutive wet rows (~2.5 cm) before we call it water
const WET_WHITE_MAX = 0.3;
const OCCLUDER_MIN = 0.4;
const BASELINE_MIN = 0.45;
const BASELINE_CLEARANCE = 5; // rows just above the water are often wet
const BASELINE_MIN_ROWS = 10;
export const DARK_LUMA = 25;
const MAX_SPREAD_PX = 6; // ~3 cm between frames
const MIN_CONTRAST = 0.35;
// The low zone: rows past the bottom of the axis, scanned only when the main span is all dry.
// The foot of the gauge there is in shade and crowded with large black numbers, so the main
// pass would take a label for water; this pass wants rows with almost no white at all.
const LOW_ZONE_PX = 50; // about 25 cm
const LOW_LEARN_ROWS = 40; // lowest rows of the main span: how white the shaded foot looks
const LOW_WET_WHITE_MAX = 0.1; // a label row still keeps 2 or 3 white pixels; water keeps none
const LOW_WET_RUN = 6;
const LOW_MIN_CONTRAST = 0.2;

export function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function axisX(cfg: GaugeConfig, y: number) {
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

/** Learn the brightness of the gauge face from rows y0-y1 (normally the always-dry baseline). */
function whiteThreshold(frame: RGBFrame, cfg: GaugeConfig, y0 = cfg.baseline.y0, y1 = cfg.baseline.y1) {
  const lumas: number[] = [];
  for (let y = y0; y <= y1; y += 2) {
    const cx = Math.round(axisX(cfg, y));
    for (let dx = -cfg.halfWidth; dx <= cfg.halfWidth; dx += 2) {
      const x = cx + dx;
      if (x < 0 || x >= frame.width) continue;
      const i = (y * frame.width + x) * 3;
      lumas.push(luma(frame.data[i], frame.data[i + 1], frame.data[i + 2]));
    }
  }
  return Math.max(90, 0.7 * percentile(lumas, 0.9));
}

/** Average each row with its neighbours: single dark tick rows and specks of glare should not decide the edge. */
function smoothRows(rows: RowStats[]) {
  return rows.map((row, k) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, k - 1); j <= Math.min(rows.length - 1, k + 1); j++) {
      if (rows[j].occluder >= OCCLUDER_MIN) continue;
      s += rows[j].white;
      n++;
    }
    return n ? s / n : row.white;
  });
}

/** Index of the first run of `len` wet rows (smoothed white under `max`), skipping occluded rows; -1 if none. */
function firstWetRun(rows: RowStats[], smooth: number[], max: number, len: number, from = 0) {
  let runStart = -1;
  let runLen = 0;
  for (let k = from; k < rows.length; k++) {
    if (rows[k].occluder >= OCCLUDER_MIN) continue; // neither gauge nor water: skip without breaking a run
    if (smooth[k] < max) {
      if (runLen === 0) runStart = k;
      if (++runLen >= len) return runStart;
    } else {
      runLen = 0;
    }
  }
  return -1;
}

/** Mean whiteness of rows from-to, leaving out occluded rows. */
function meanWhite(rows: RowStats[], from: number, to: number) {
  let s = 0;
  let n = 0;
  for (let k = Math.max(0, from); k < Math.min(rows.length, to); k++) {
    if (rows[k].occluder >= OCCLUDER_MIN) continue;
    s += rows[k].white;
    n++;
  }
  return n ? s / n : 0;
}

/**
 * The main span is dry: look for the water on the shaded foot of the gauge below it, judging
 * white by the lowest dry rows. `end` is the last row looked at; `y` is null when the face runs
 * on past it, or when the edge found is too faint to trust.
 */
function lowZoneWaterline(frame: RGBFrame, cfg: GaugeConfig, y1: number) {
  const end = Math.min(frame.height - 1, y1 + LOW_ZONE_PX);
  const from = Math.max(cfg.axis.top.y, y1 - LOW_LEARN_ROWS);
  const whiteLuma = whiteThreshold(frame, cfg, from, y1);
  const rows: RowStats[] = [];
  for (let y = from; y <= end; y++) rows.push(rowStats(frame, cfg, y, whiteLuma));
  // Start a run short of the main span's end, so water lapping across it is caught where it begins.
  const found = firstWetRun(rows, smoothRows(rows), LOW_WET_WHITE_MAX, LOW_WET_RUN, y1 + 1 - WET_RUN - from);
  if (found === -1) return { y: null, end, contrast: 0 };
  const contrast = meanWhite(rows, found - 15, found) - meanWhite(rows, found, found + LOW_WET_RUN * 2);
  return { y: contrast >= LOW_MIN_CONTRAST ? from + found : null, end, contrast };
}

export function frameMeanLuma(frame: RGBFrame) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < frame.data.length; i += 3 * 97) {
    sum += luma(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
    n++;
  }
  return n ? sum / n : 0;
}

export function detectWaterline(frame: RGBFrame, cfg: GaugeConfig): WaterlineResult {
  const empty = { y: null, aboveTop: false, belowRange: false, approx: false, contrast: 0 };
  if (frameMeanLuma(frame) < DARK_LUMA) return { ...empty, dark: true, baselineOk: false };

  const whiteLuma = whiteThreshold(frame, cfg);
  const y0 = cfg.axis.top.y;
  const y1 = Math.min(cfg.axis.bottom.y, frame.height - 1);
  const rows: RowStats[] = [];
  for (let y = y0; y <= y1; y++) rows.push(rowStats(frame, cfg, y, whiteLuma));

  /** Does the face look like a gauge on the baseline rows above `wetFrom`? */
  const baselineAbove = (wetFrom: number) => {
    let sum = 0;
    let n = 0;
    for (let y = cfg.baseline.y0; y <= Math.min(cfg.baseline.y1, wetFrom - BASELINE_CLEARANCE); y++) {
      sum += rows[y - y0]?.white ?? 0;
      n++;
    }
    // Too few rows left is not proof of a gauge: a camera turned to a dark wall looks the same
    // (a few bright rows, then "water"). Water over the very top is reported as aboveTop instead.
    return n >= BASELINE_MIN_ROWS && sum / n >= BASELINE_MIN;
  };

  const found = firstWetRun(rows, smoothRows(rows), WET_WHITE_MAX, WET_RUN);

  if (found === -1) {
    const baselineOk = baselineAbove(Infinity);
    const low = lowZoneWaterline(frame, cfg, y1);
    if (low.y === null) return { ...empty, y: low.end, belowRange: true, dark: false, baselineOk };
    return { ...empty, y: low.y, approx: true, dark: false, baselineOk, contrast: low.contrast };
  }

  const y = y0 + found;
  const baselineOk = baselineAbove(y);
  const contrast = meanWhite(rows, found - 15, found) - meanWhite(rows, found, found + WET_RUN * 2);
  return { y, aboveTop: found === 0, belowRange: false, approx: false, dark: false, baselineOk, contrast };
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

/** The inverse of yToLevel: the image row where a gauge level sits, extrapolating at both ends. */
export function levelToY(level: number, marks: GaugeMark[]): number {
  if (marks.length < 2) throw new Error("need at least two calibration marks");
  const m = [...marks].sort((a, b) => b.level - a.level);
  let i = 0;
  if (level >= m[0].level) i = 0;
  else if (level <= m[m.length - 1].level) i = m.length - 2;
  else while (i < m.length - 2 && level < m[i + 1].level) i++;
  const a = m[i];
  const b = m[i + 1];
  return a.y + ((level - a.level) * (b.y - a.y)) / (b.level - a.level);
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Read several frames from the same moment and agree on one level. */
export function readGauge(frames: RGBFrame[], cfg: GaugeConfig): GaugeReading {
  const results = frames.map((f) => detectWaterline(f, cfg));
  const base = { aboveTop: false, belowRange: false, approx: false, frames: results };
  if (!results.length) return { ...base, ok: false, level: null, y: null, confidence: "low", reason: "no-frames" };

  const usable = results.filter((r) => !r.dark && r.y !== null);
  if (!usable.length) return { ...base, ok: false, level: null, y: null, confidence: "low", reason: "dark" };

  const aboveTop = usable.filter((r) => r.aboveTop).length > usable.length / 2;
  const belowRange = usable.filter((r) => r.belowRange).length > usable.length / 2;
  const approx = usable.filter((r) => r.approx).length > usable.length / 2;
  const ys = usable.map((r) => r.y as number);
  const y = Math.round(median(ys));
  const level = Math.round(yToLevel(y, cfg.marks) * 100) / 100;

  const spread = Math.max(...ys) - Math.min(...ys);
  const baselineOk = usable.every((r) => r.baselineOk);
  const contrast = median(usable.map((r) => r.contrast));

  let reason: GaugeReading["reason"];
  if (!baselineOk && !aboveTop) reason = "gauge-not-visible";
  else if (spread > MAX_SPREAD_PX) reason = "frames-disagree";
  // The low zone has its own, lower bar for the edge.
  else if (!aboveTop && !belowRange && !approx && contrast < MIN_CONTRAST) reason = "weak-edge";
  else if (usable.length < results.length) reason = "dark";

  if (reason === "gauge-not-visible") {
    return { ...base, ok: false, level: null, y, confidence: "low", reason, aboveTop, belowRange, approx };
  }
  const confidence = reason || aboveTop ? "low" : "high";
  return { ...base, ok: true, level, y, confidence, reason, aboveTop, belowRange, approx };
}
