import type { GaugeConfig, GaugeMark } from "./gauge-config";
import { DEFAULT_READER_PARAMS, type ReaderParams } from "./reader-params";

/** Packed RGB24 pixels, row-major. */
export type RGBFrame = { width: number; height: number; data: Uint8Array };

export type WaterlineResult = {
  /**
   * Row of the first wet pixel on the axis; with `covered`, the first row hidden under what floats
   * there; with `belowRange`, the last row scanned. Null when unreadable.
   */
  y: number | null;
  /** Water covers the whole scanned span. */
  aboveTop: boolean;
  /** No water found before the end of the scanned span, the low zone included. */
  belowRange: boolean;
  /** Plants or something afloat hide the gauge from `y` down: the water is somewhere under that row. */
  covered: boolean;
  /** Found in the low zone under the axis, where the reading is only an estimate. */
  approx: boolean;
  /** Frame too dark to read (camera off, night without lamp). */
  dark: boolean;
  /** The always-dry part of the gauge looks like a gauge (camera has not moved). */
  baselineOk: boolean;
  /** Share of white face pixels just above the line minus just below; near 1 is a crisp edge. */
  contrast: number;
};

export type GaugeReading = {
  ok: boolean;
  level: number | null;
  y: number | null;
  confidence: "high" | "low";
  aboveTop: boolean;
  belowRange: boolean;
  /** The water is hidden under `y`: the level is the most it can be. */
  covered: boolean;
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

// The waterline is where the white face of the gauge stops. "White" is judged against the face just
// above each row, not once for the whole gauge: in the morning the top of the gauge is lit by the sky
// behind it while the foot is in shade, and at night the lamp-lit water under the gauge is nearly as
// bright as the face (it reflects it) but warmer in colour.
// How white, how sharp an edge and how much of a mat it takes are ReaderParams (lib/reader-params.ts),
// which /admin can tune on labelled rounds. Leaves in the blue shade of a morning sky lose their
// green, but not their edges: open water under the face is even (0.06-0.45 of the face's white
// between its 10th and 90th percentile brightness on the real frames), a mat of stems and leaves is
// not (0.6-0.83), hence busyUnder.
const WINDOW = 12; // rows (~6 cm) compared either side of a candidate waterline
const REF_ROWS = 24; // rows above a candidate that show how the dry face looks there...
const REF_GAP = 2; // ...leaving out the ones right above it, often wet
const MIN_CONTRAST = 0.2;
const MAX_SPREAD_PX = 6; // ~3 cm between frames
const COVERED_SPREAD_PX = 40; // stems sway between frames (32 px seen), and the row only bounds the water
// The low zone: rows past the bottom of the axis, the shaded foot of the gauge.
const LOW_ZONE_PX = 50; // about 25 cm
// A leaf can lean over a dry face; the face then carries on under it.
const RESUME_ROWS = 16;
const RESUME_WHITE = 0.2;
const RESUME_PLANTS = 0.3;
// The always-dry rows: a gauge shows white and its black marks, not a plain wall or water.
const BASELINE_CLEARANCE = 5; // rows just above the water are often wet
const BASELINE_MIN_ROWS = 10;
const BASELINE_WHITE = 0.2;
const BASELINE_MARKS = 0.06;
const MARK_OF_FACE = 0.45; // a mark pixel is at most this bright against the face
const FACE_LUMA_MIN = 90;
const WHITE_MIN = 60;
const FACE_SAT_MAX = 0.3; // the face is near grey under any light; river water is brown
export const DARK_LUMA = 25;

export function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function axisX(cfg: GaugeConfig, y: number) {
  const { top, bottom } = cfg.axis;
  return top.x + ((y - top.y) * (bottom.x - top.x)) / (bottom.y - top.y);
}

const PLANT = 1;
const OBJECT = 2;

/** One sampled pixel: brightness, red and green shares of its colour, and what hides it if anything. */
export type Px = { luma: number; sat: number; r: number; g: number; hidden: 0 | typeof PLANT | typeof OBJECT };

function hue(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return h;
}

function pixel(r: number, g: number, b: number): Px {
  const max = Math.max(r, g, b);
  const sat = max ? (max - Math.min(r, g, b)) / max : 0;
  const h = hue(r, g, b);
  const l = luma(r, g, b);
  let hidden: Px["hidden"] = 0;
  // Water hyacinth, from pale stems to leaves in shade (teal under a morning sky).
  if (sat >= 0.15 && h >= 60 && h <= 185 && max >= 30) hidden = PLANT;
  // The blue PVC pipe. The black marks look blue under a morning sky too, but stay dark.
  else if (sat >= 0.4 && h > 185 && h <= 235 && l >= 70) hidden = OBJECT;
  // The red rope tied across the gauge.
  else if (sat >= 0.45 && (h <= 20 || h >= 335) && l >= 50) hidden = OBJECT;
  const sum = r + g + b || 1;
  return { luma: l, sat, r: r / sum, g: g / sum, hidden };
}

function sampleRow(frame: RGBFrame, cfg: GaugeConfig, y: number): Px[] {
  const cx = Math.round(axisX(cfg, y));
  const row: Px[] = [];
  for (let dx = -cfg.halfWidth; dx <= cfg.halfWidth; dx++) {
    const x = cx + dx;
    if (x < 0 || x >= frame.width) continue;
    const i = (y * frame.width + x) * 3;
    row.push(pixel(frame.data[i], frame.data[i + 1], frame.data[i + 2]));
  }
  return row;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort(); // numeric, and far quicker than a comparator
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** How the dry face looks in some rows: the brightness of its white and the colour of that white. */
type Face = { white: number; r: number; g: number };

/** `white` is given when already known for these pixels. */
function learnFace(px: Px[], params: ReaderParams, white = faceWhite(px)): Face {
  let r = 0;
  let g = 0;
  let n = 0;
  for (const p of px) {
    if (p.luma < params.whiteOfFace * white) continue;
    r += p.r;
    g += p.g;
    n++;
  }
  return { white, r: n ? r / n : 1 / 3, g: n ? g / n : 1 / 3 };
}

// A floor keeps the grain of a dim picture from passing for white.
function faceWhite(px: Px[]) {
  return Math.max(
    WHITE_MIN,
    percentile(
      px.map((p) => p.luma),
      0.9,
    ),
  );
}

function isWhite(p: Px, face: Face, params: ReaderParams) {
  if (p.luma < params.whiteOfFace * face.white) return false;
  const dr = p.r - face.r;
  const dg = p.g - face.g;
  // The blue share moves by -(dr + dg). Squared, as this runs for every pixel of every candidate row.
  return dr * dr + dg * dg + (dr + dg) * (dr + dg) <= params.whiteTint * params.whiteTint;
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

/**
 * The pixels the reader looks at, one row across the face per image row from the top of the axis
 * to the end of the low zone. They do not depend on ReaderParams, so tuning samples each frame once.
 */
export type GaugeSample = { dark: boolean; rows: Px[][] };

/**
 * The white of the face over each candidate row of a sample, by the hiddenRow it was worked out
 * with (that alone decides which rows are in view). Tuning reads one sample hundreds of times.
 */
const whites = new WeakMap<GaugeSample, Map<string, number>>();

export function sampleGauge(frame: RGBFrame, cfg: GaugeConfig): GaugeSample {
  if (frameMeanLuma(frame) < DARK_LUMA) return { dark: true, rows: [] };
  const last = Math.min(frame.height - 1, cfg.axis.bottom.y + LOW_ZONE_PX);
  const rows: Px[][] = [];
  for (let y = cfg.axis.top.y; y <= last; y++) rows.push(sampleRow(frame, cfg, y));
  return { dark: false, rows };
}

export function detectWaterline(frame: RGBFrame, cfg: GaugeConfig, params = DEFAULT_READER_PARAMS): WaterlineResult {
  return detectInSample(sampleGauge(frame, cfg), cfg, params);
}

export function detectInSample(sample: GaugeSample, cfg: GaugeConfig, params = DEFAULT_READER_PARAMS): WaterlineResult {
  const none = { y: null, aboveTop: false, belowRange: false, covered: false, approx: false, contrast: 0 };
  if (sample.dark) return { ...none, dark: true, baselineOk: false };

  const { rows } = sample;
  const top = cfg.axis.top.y;
  const last = top + rows.length - 1;
  const hiddenShare = (row: Px[], kind?: Px["hidden"]) =>
    row.length ? row.filter((p) => (kind ? p.hidden === kind : p.hidden)).length / row.length : 1;
  const hiddenRow = rows.map((row) => hiddenShare(row) >= params.hiddenRow);
  const plantRow = rows.map((row) => hiddenShare(row, PLANT) >= params.hiddenRow);

  /** Does the face look like a gauge on the baseline rows above `wetFrom`? */
  const baselineAbove = (wetFrom: number) => {
    const px: Px[] = [];
    let n = 0;
    for (let y = cfg.baseline.y0; y <= Math.min(cfg.baseline.y1, wetFrom - BASELINE_CLEARANCE); y++) {
      const row = rows[y - top];
      if (!row) continue;
      px.push(...row.filter((p) => !p.hidden));
      n++;
    }
    // Too few rows left is not proof of a gauge: a camera turned to a dark wall looks the same
    // (a few bright rows, then "water"). Water over the very top is reported as aboveTop instead.
    if (n < BASELINE_MIN_ROWS || !px.length) return false;
    const face = learnFace(px, params);
    const whites = px.filter((p) => isWhite(p, face, params));
    const marks = px.filter((p) => p.luma <= MARK_OF_FACE * face.white).length;
    return (
      face.white >= FACE_LUMA_MIN &&
      whites.length >= BASELINE_WHITE * px.length &&
      marks >= BASELINE_MARKS * px.length &&
      percentile(
        whites.map((p) => p.sat),
        0.5,
      ) <= FACE_SAT_MAX
    );
  };

  // Rows in view, top to bottom. A waterline is looked for between two of them, so a pipe or a rope
  // across a dry face is stepped over.
  let seen = rows.map((_, k) => k).filter((k) => !hiddenRow[k]);

  /** The face over the rows above position `j` of `seen`. Cutting `seen` short below keeps these. */
  const faces = new Map<number, Face>();
  let knownWhite = whites.get(sample);
  if (!knownWhite) whites.set(sample, (knownWhite = new Map()));
  const faceAbove = (j: number) => {
    let face = faces.get(j);
    if (face) return face;
    const px: Px[] = [];
    for (let q = Math.max(0, j - REF_GAP - REF_ROWS); q < Math.max(1, j - REF_GAP); q++) {
      if (q < seen.length) px.push(...rows[seen[q]].filter((p) => !p.hidden));
    }
    const key = `${params.hiddenRow}:${j}`;
    let white = knownWhite.get(key);
    if (white === undefined) knownWhite.set(key, (white = faceWhite(px)));
    faces.set(j, (face = learnFace(px, params, white)));
    return face;
  };
  /** Share of white pixels in positions from-to of `seen`; `all` counts hidden pixels as not white. */
  const whiteShare = (from: number, to: number, face: Face, all = false) => {
    let w = 0;
    let n = 0;
    for (let q = Math.max(0, from); q < Math.min(seen.length, to); q++) {
      for (const p of rows[seen[q]]) {
        if (p.hidden) {
          if (all) n++;
          continue;
        }
        n++;
        if (isWhite(p, face, params)) w++;
      }
    }
    return n ? w / n : 0;
  };
  /** Share of white above position `j` minus below it: plants under the line count as not white. */
  const edges = new Map<number, { above: number; below: number }>();
  const edgeAt = (j: number) => {
    let edge = edges.get(j);
    if (edge) return edge;
    const face = faceAbove(j);
    edge = { above: whiteShare(j - WINDOW, j, face), below: whiteShare(j, j + WINDOW, face, true) };
    edges.set(j, edge);
    return edge;
  };

  // Water over the top rows: nothing near grey and bright there, the colour of the river instead.
  const topRows = seen.slice(0, WINDOW).flatMap((k) => rows[k].filter((p) => !p.hidden));
  const greyShare = topRows.filter((p) => p.luma >= FACE_LUMA_MIN && p.sat <= FACE_SAT_MAX).length / (topRows.length || 1);
  if (greyShare < params.waterMax) return { ...none, y: top, aboveTop: true, dark: false, baselineOk: false };

  // Plants float on the water, so the face cannot be dry under a mat of them. A run of plant rows
  // (the last rows scanned included) only lets the scan go on when the face clearly carries on under it.
  let mat = -1;
  for (let q = 1; q <= seen.length && mat === -1; q++) {
    const next = q < seen.length ? seen[q] : rows.length;
    const gap = next - seen[q - 1] - 1;
    let plants = 0;
    for (let k = seen[q - 1] + 1; k < next; k++) if (plantRow[k]) plants++;
    if (gap < params.plantRun || plants * 2 < gap) continue;
    const face = faceAbove(q);
    const below = seen.slice(q, q + RESUME_ROWS).flatMap((k) => rows[k]);
    const resumes =
      below.length > 0 &&
      whiteShare(q, q + RESUME_ROWS, face) >= RESUME_WHITE &&
      below.filter((p) => p.hidden === PLANT).length <= RESUME_PLANTS * below.length;
    if (!resumes) mat = q;
  }
  if (mat !== -1) {
    seen = seen.slice(0, mat);
    edges.clear(); // the rows under an edge are cut short too
  }

  /** The first place the face gives way to something darker, moved to where the contrast peaks. */
  const firstEdge = (fits: (above: number, below: number) => boolean) => {
    for (let j = WINDOW; j < seen.length; j++) {
      const { above, below } = edgeAt(j);
      if (above < params.faceMin || !fits(above, below)) continue;
      // The first match can be a row or two early, while the window under it still holds some face.
      let edge = j;
      let contrast = above - below;
      for (let q = j + 1; q < Math.min(seen.length, j + params.refineRows + 1); q++) {
        const e = edgeAt(q);
        if (e.above - e.below > contrast) {
          edge = q;
          contrast = e.above - e.below;
        }
      }
      return { edge, contrast };
    }
    return null;
  };
  // A clean edge; failing that, the first clear drop. Pale stems can keep the rows under the face
  // from looking empty, and the strongest drop is no answer: under a mat the reference sinks with the
  // light, and anything pale down there out-scores the real edge.
  let found =
    firstEdge((_, below) => below <= params.waterMax) ??
    firstEdge((above, below) => below <= params.waterSoft && above - below >= params.dropMin);
  // The face runs into a plant mat without a clear edge.
  if (!found && mat !== -1) found = { edge: seen.length, contrast: edgeAt(seen.length).above };
  // No drop anywhere: the face carries on to the last row scanned, and the water is lower still.
  if (!found) return { ...none, y: last, belowRange: true, dark: false, baselineOk: baselineAbove(Infinity) };

  const { edge, contrast } = found;
  const lastFace = seen[edge - 1];
  const firstWet = edge < seen.length ? seen[edge] : rows.length;
  // The face ends at something afloat (a pipe, plants) rather than at open water.
  const under = rows.slice(lastFace + 1, lastFace + 1 + params.plantsUnder).flat();
  const lumas = under.map((p) => p.luma);
  const busy = (percentile(lumas, 0.9) - percentile(lumas, 0.1)) / faceAbove(edge).white;
  const covered =
    firstWet - lastFace - 1 >= params.plantRun ||
    under.filter((p) => p.hidden === PLANT).length >= params.plantsCover * (under.length || 1) ||
    busy >= params.busyUnder;
  const y = top + (covered ? lastFace + 1 : firstWet);
  return {
    y,
    aboveTop: false,
    belowRange: false,
    covered,
    approx: !covered && y > cfg.axis.bottom.y,
    dark: false,
    baselineOk: baselineAbove(y),
    contrast,
  };
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
export function readGauge(frames: RGBFrame[], cfg: GaugeConfig, params = DEFAULT_READER_PARAMS): GaugeReading {
  const results = frames.map((f) => detectWaterline(f, cfg, params));
  const base = { aboveTop: false, belowRange: false, covered: false, approx: false, frames: results };
  if (!results.length) return { ...base, ok: false, level: null, y: null, confidence: "low", reason: "no-frames" };

  const usable = results.filter((r) => !r.dark && r.y !== null);
  if (!usable.length) return { ...base, ok: false, level: null, y: null, confidence: "low", reason: "dark" };

  const most = (pick: (r: WaterlineResult) => boolean) => usable.filter(pick).length > usable.length / 2;
  const aboveTop = most((r) => r.aboveTop);
  const belowRange = most((r) => r.belowRange);
  const covered = most((r) => r.covered);
  const approx = most((r) => r.approx);
  const ys = usable.map((r) => r.y as number);
  const y = Math.round(median(ys));
  const level = Math.round(yToLevel(y, cfg.marks) * 100) / 100;

  const spread = Math.max(...ys) - Math.min(...ys);
  const baselineOk = usable.every((r) => r.baselineOk);
  const contrast = median(usable.map((r) => r.contrast));

  let reason: GaugeReading["reason"];
  if (!baselineOk && !aboveTop) reason = "gauge-not-visible";
  else if (spread > (covered ? COVERED_SPREAD_PX : MAX_SPREAD_PX)) reason = "frames-disagree";
  // Only an edge on open water is judged by its contrast; the others are bounds already.
  else if (!aboveTop && !belowRange && !covered && contrast < MIN_CONTRAST) reason = "weak-edge";
  else if (usable.length < results.length) reason = "dark";

  if (reason === "gauge-not-visible") {
    return { ...base, ok: false, level: null, y, confidence: "low", reason, aboveTop, belowRange, covered, approx };
  }
  const confidence = reason || aboveTop ? "low" : "high";
  return { ...base, ok: true, level, y, confidence, reason, aboveTop, belowRange, covered, approx };
}
