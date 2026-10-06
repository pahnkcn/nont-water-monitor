import { axisX, luma, type RGBFrame } from "./gauge";
import type { GaugeConfig, Point } from "./gauge-config";

// Finds where the camera has moved to, so a nudged or re-zoomed camera does not shift
// every reading by a few centimetres without anyone noticing. A grey patch around the dry
// top of the gauge (with the red pole and window grille beside it, which do not repeat the
// way the 10 cm marks do) is matched against each new frame by zero-mean normalised
// cross-correlation of edge strength. Edges, not brightness: the window behind the gauge is
// dark at night and bright sky by day, which turns its brightness pattern inside out, while
// the bars and marks keep their edges in the same places.

/** Where the calibrated scene now sits: scaled about the patch centre, then shifted, in pixels. */
export type Transform = { dx: number; dy: number; scale: number };

export const IDENTITY: Transform = { dx: 0, dy: 0, scale: 1 };

export type GaugeReference = {
  /** Patch corner and size in calibrated-frame pixels. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Half-resolution luma of the patch, base64. */
  luma: string;
  /** Mean brightness of the patch, which tells day, night and rain references apart. */
  meanLuma: number;
  t: number;
};

export type TrackResult = {
  found: boolean;
  transform: Transform;
  /** Correlation at the best position, -1 to 1. */
  score: number;
  /** Best score minus the best score more than MIN_PEAK_GAP px away; small means a repeating pattern fooled it. */
  margin: number;
  /** Index of the reference that matched best, or -1. */
  ref: number;
  /** Flood water hides too much of the patch to judge; keep the last known position. */
  covered: boolean;
  /**
   * Correlation at the last known position (`opts.at`), best over the references. Still well
   * above zero when only the light has changed; near zero when the camera shows something else.
   */
  atLast: number;
};

const STEP = 2; // reference pixels are 2x2 frame pixels
const SIDE = 60; // patch reaches this far either side of the gauge axis
const SEARCH = 80; // largest move looked for, in frame pixels
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.15;
const COARSE_SCALE_STEP = 0.05;
const FINE_SCALE_STEP = 0.0125;
// Measured on the real frames (tests/fixtures): the same light scores 0.98-1.0; night against
// day 0.54-0.58 at the right spot with a margin of 0.24-0.25; an unrelated scene 0.17 with a
// margin of 0.01. The margin is what tells a real match from a lucky one.
const MIN_SCORE = 0.45;
const MIN_MARGIN = 0.15;
const MIN_PEAK_GAP = 8;
const WATER_CLEARANCE = 8; // rows just above the last waterline are left out too: waves, wet stains
const MIN_DRY = 0.25; // share of the patch that must be above water to judge at all
const PEAKS = 5; // coarse peaks worth refining; repeating marks can make the true one only second or third
const MIN_OVERLAP = 0.6;

type Plane = { w: number; h: number; v: Float32Array };

function lumaPlane(frame: RGBFrame): Plane {
  const v = new Float32Array(frame.width * frame.height);
  for (let i = 0, o = 0; i < v.length; i++, o += 3) v[i] = luma(frame.data[o], frame.data[o + 1], frame.data[o + 2]);
  return { w: frame.width, h: frame.height, v };
}

/** 2x2 box average; pixel X of the result is centred on 2X + 0.5 of the input. */
function halve(p: Plane): Plane {
  const w = p.w >> 1;
  const h = p.h >> 1;
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = 2 * y * p.w;
    const b = a + p.w;
    for (let x = 0; x < w; x++) v[y * w + x] = (p.v[a + 2 * x] + p.v[a + 2 * x + 1] + p.v[b + 2 * x] + p.v[b + 2 * x + 1]) / 4;
  }
  return { w, h, v };
}

/** Bilinear sample of a half-resolution plane at a full-resolution point; NaN outside. */
function sampleHalf(p: Plane, x: number, y: number) {
  const fx = (x - 0.5) / 2;
  const fy = (y - 0.5) / 2;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= p.w || y0 + 1 >= p.h) return NaN;
  const ax = fx - x0;
  const ay = fy - y0;
  const i = y0 * p.w + x0;
  const top = p.v[i] * (1 - ax) + p.v[i + 1] * ax;
  const bottom = p.v[i + p.w] * (1 - ax) + p.v[i + p.w + 1] * ax;
  return top * (1 - ay) + bottom * ay;
}

export function referenceRegion(cfg: GaugeConfig) {
  const xs = [axisX(cfg, cfg.baseline.y0), axisX(cfg, cfg.baseline.y1)];
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - SIDE));
  const x1 = Math.min(cfg.frame.width, Math.ceil(Math.max(...xs) + SIDE));
  const y0 = Math.max(0, cfg.axis.top.y);
  const y1 = Math.min(cfg.frame.height, cfg.baseline.y1);
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/** The fixed point of a zoom: centre of the reference patch. */
export function trackAnchor(cfg: GaugeConfig): Point {
  const r = referenceRegion(cfg);
  return { x: r.x0 + r.w / 2, y: r.y0 + r.h / 2 };
}

function mapPoint(p: Point, a: Point, t: Transform): Point {
  return { x: a.x + t.scale * (p.x - a.x) + t.dx, y: a.y + t.scale * (p.y - a.y) + t.dy };
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Reference sample points in calibrated-frame pixels, row-major. */
function samplePoints(ref: Pick<GaugeReference, "x0" | "y0" | "w" | "h">) {
  const cols = Math.floor(ref.w / STEP);
  const rows = Math.floor(ref.h / STEP);
  const xs = Array.from({ length: cols }, (_, i) => ref.x0 + STEP * i + 0.5);
  const ys = Array.from({ length: rows }, (_, j) => ref.y0 + STEP * j + 0.5);
  return { cols, rows, xs, ys };
}

/**
 * Grab the reference patch from a frame. `at` is where the calibrated scene sits in this
 * frame, so a new reference can be learned (say, for daylight) while the camera is off its
 * original spot.
 */
export function makeReference(frame: RGBFrame, cfg: GaugeConfig, at: Transform = IDENTITY, t = 0): GaugeReference {
  const region = referenceRegion(cfg);
  const anchor = trackAnchor(cfg);
  const half = halve(lumaPlane(frame));
  const { cols, rows, xs, ys } = samplePoints(region);
  const bytes = new Uint8Array(cols * rows);
  let sum = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = mapPoint({ x: xs[i], y: ys[j] }, anchor, at);
      const v = sampleHalf(half, p.x, p.y);
      bytes[j * cols + i] = Number.isNaN(v) ? 0 : Math.round(v);
      sum += bytes[j * cols + i];
    }
  }
  return { ...region, luma: toBase64(bytes), meanLuma: Math.round(sum / bytes.length), t };
}

type Sums = { n: number; f: number; ff: number; r: number; rr: number; fr: number };

function zncc(s: Sums, needed: number) {
  if (s.n < needed) return -1;
  const vf = s.n * s.ff - s.f * s.f;
  const vr = s.n * s.rr - s.r * s.r;
  if (vf <= 1e-6 || vr <= 1e-6) return -1;
  return (s.n * s.fr - s.f * s.r) / Math.sqrt(vf * vr);
}

type Candidate = { score: number; dx: number; dy: number; scale: number };

/**
 * Edge strength of a plane: sum of absolute central differences across and down, borders
 * clamped. `step` is the neighbour distance in samples.
 */
function edges(v: ArrayLike<number>, w: number, h: number, step = 1): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - step) * w;
    const down = Math.min(h - 1, y + step) * w;
    for (let x = 0; x < w; x++) {
      const left = Math.max(0, x - step);
      const right = Math.min(w - 1, x + step);
      out[y * w + x] = Math.abs(v[y * w + right] - v[y * w + left]) + Math.abs(v[down + x] - v[up + x]);
    }
  }
  return out;
}

const edgePlane = (p: Plane): Plane => ({ w: p.w, h: p.h, v: edges(p.v, p.w, p.h) });

/**
 * A reference ready to match. `values` are edges between neighbouring samples (2 frame px apart,
 * like neighbouring half-resolution pixels); `coarse` uses samples two apart (4 px, like
 * quarter-resolution pixels) for the coarse pass.
 */
type Patch = { values: Float32Array; coarse: Float32Array; cols: number; rows: number; xs: number[]; ys: number[]; anchor: Point };

/**
 * Every whole-pixel shift and every zoom step, on a quarter-resolution frame with every
 * other reference sample. Nearest-pixel sampling keeps this to integer index arithmetic.
 */
function coarseSearch(quarter: Plane, p: Patch): Candidate[] {
  const is: number[] = [];
  const js: number[] = [];
  for (let i = 0; i < p.cols; i += 2) is.push(i);
  for (let j = 0; j < p.rows; j += 2) js.push(j);
  const needed = Math.ceil(MIN_OVERLAP * is.length * js.length);
  const k = SEARCH / 4;
  const out: Candidate[] = [];
  for (let scale = SCALE_MIN; scale <= SCALE_MAX + 1e-9; scale += COARSE_SCALE_STEP) {
    // Quarter-resolution pixel X is centred on 4X + 1.5 in the full frame.
    const ix = is.map((i) => Math.round((p.anchor.x + scale * (p.xs[i] - p.anchor.x) - 1.5) / 4));
    const iy = js.map((j) => Math.round((p.anchor.y + scale * (p.ys[j] - p.anchor.y) - 1.5) / 4));
    for (let ky = -k; ky <= k; ky++) {
      for (let kx = -k; kx <= k; kx++) {
        const s: Sums = { n: 0, f: 0, ff: 0, r: 0, rr: 0, fr: 0 };
        for (let b = 0; b < js.length; b++) {
          const y = iy[b] + ky;
          if (y < 0 || y >= quarter.h) continue;
          const row = y * quarter.w;
          const refRow = js[b] * p.cols;
          for (let a = 0; a < is.length; a++) {
            const x = ix[a] + kx;
            if (x < 0 || x >= quarter.w) continue;
            const f = quarter.v[row + x];
            const r = p.coarse[refRow + is[a]];
            s.n++;
            s.f += f;
            s.ff += f * f;
            s.r += r;
            s.rr += r * r;
            s.fr += f * r;
          }
        }
        out.push({ score: zncc(s, needed), dx: 4 * kx, dy: 4 * ky, scale });
      }
    }
  }
  return out;
}

/** Full correlation on the half-resolution frame with bilinear sampling. */
function fineScore(half: Plane, p: Patch, t: Transform) {
  const needed = Math.ceil(MIN_OVERLAP * p.cols * p.rows);
  const s: Sums = { n: 0, f: 0, ff: 0, r: 0, rr: 0, fr: 0 };
  for (let j = 0; j < p.rows; j++) {
    const y = p.anchor.y + t.scale * (p.ys[j] - p.anchor.y) + t.dy;
    for (let i = 0; i < p.cols; i++) {
      const f = sampleHalf(half, p.anchor.x + t.scale * (p.xs[i] - p.anchor.x) + t.dx, y);
      if (Number.isNaN(f)) continue;
      const r = p.values[j * p.cols + i];
      s.n++;
      s.f += f;
      s.ff += f * f;
      s.r += r;
      s.rr += r * r;
      s.fr += f * r;
    }
  }
  return zncc(s, needed);
}

/** Offset of a parabola's peak through three equally spaced samples, in steps. */
function vertex(minus: number, mid: number, plus: number) {
  const den = minus - 2 * mid + plus;
  return den < 0 ? Math.max(-0.5, Math.min(0.5, (minus - plus) / (2 * den))) : 0;
}

/** The strongest coarse candidates that are more than MIN_PEAK_GAP apart. */
function peaks(coarse: Candidate[]) {
  const picked: Candidate[] = [];
  for (const c of [...coarse].sort((a, b) => b.score - a.score)) {
    if (picked.length === PEAKS) break;
    if (picked.every((q) => Math.max(Math.abs(c.dx - q.dx), Math.abs(c.dy - q.dy)) > MIN_PEAK_GAP)) picked.push(c);
  }
  return picked;
}

const clampScale = (s: number) => Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));

/** Climb from a coarse candidate to the nearest fine peak: 2 px steps, then 1 px. */
function refine(half: Plane, p: Patch, start: Candidate): Candidate {
  let cur: Candidate = { ...start, score: fineScore(half, p, start) };
  for (const step of [2, 1]) {
    for (let moved = true, guard = 0; moved && guard < 40; guard++) {
      moved = false;
      const around: Transform[] = [];
      for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) if (kx || ky) around.push({ dx: cur.dx + kx * step, dy: cur.dy + ky * step, scale: cur.scale });
      for (const k of [-1, 1]) around.push({ dx: cur.dx, dy: cur.dy, scale: clampScale(cur.scale + k * step * FINE_SCALE_STEP) });
      for (const t of around) {
        const score = fineScore(half, p, t);
        if (score > cur.score + 1e-6) {
          cur = { ...t, score };
          moved = true;
        }
      }
    }
  }
  return cur;
}

function trackOne(
  half: Plane,
  quarter: Plane,
  ref: GaugeReference,
  maskBelowY: number,
  last: Transform,
): Omit<TrackResult, "ref"> {
  const points = samplePoints(ref);
  // Rows run top to bottom, so dropping the flooded part of the patch is dropping its last rows.
  const dryRows = points.ys.filter((y) => y < maskBelowY - WATER_CLEARANCE).length;
  if (dryRows < MIN_DRY * points.rows) {
    return { found: false, transform: IDENTITY, score: -1, margin: 0, covered: true, atLast: -1 };
  }
  const lumaSamples = fromBase64(ref.luma);
  const p: Patch = {
    ...points,
    values: edges(lumaSamples, points.cols, points.rows),
    coarse: edges(lumaSamples, points.cols, points.rows, 2),
    rows: dryRows,
    anchor: { x: ref.x0 + ref.w / 2, y: ref.y0 + ref.h / 2 },
  };
  const atLast = fineScore(half, p, last);

  // The coarse pass only proposes; each proposal is judged at full quality.
  const refined = peaks(coarseSearch(quarter, p))
    .map((c) => refine(half, p, c))
    .sort((a, b) => b.score - a.score);
  const fine = refined[0];
  const rival = refined.find((c) => Math.max(Math.abs(c.dx - fine.dx), Math.abs(c.dy - fine.dy)) > MIN_PEAK_GAP);
  const margin = fine.score - (rival?.score ?? -1);

  // Then to a fraction of a pixel and of a zoom step from the shape of the peak.
  const at = (t: Partial<Transform>) => fineScore(half, p, { dx: fine.dx, dy: fine.dy, scale: fine.scale, ...t });
  const transform = {
    dx: fine.dx + vertex(at({ dx: fine.dx - 1 }), fine.score, at({ dx: fine.dx + 1 })),
    dy: fine.dy + vertex(at({ dy: fine.dy - 1 }), fine.score, at({ dy: fine.dy + 1 })),
    scale:
      fine.scale +
      FINE_SCALE_STEP * vertex(at({ scale: fine.scale - FINE_SCALE_STEP }), fine.score, at({ scale: fine.scale + FINE_SCALE_STEP })),
  };
  return { found: fine.score >= MIN_SCORE && margin >= MIN_MARGIN, transform, score: fine.score, margin, covered: false, atLast };
}

/**
 * Where the calibrated gauge sits in `frame`, judged against every stored reference.
 * `maskBelowY` is the last known waterline in calibrated rows; the patch below it is ignored.
 * `at` is the last known position, scored as is in `atLast`.
 */
export function track(
  frame: RGBFrame,
  refs: GaugeReference[],
  opts: { maskBelowY?: number; at?: Transform } = {},
): TrackResult {
  const none: TrackResult = { found: false, transform: IDENTITY, score: -1, margin: 0, ref: -1, covered: false, atLast: -1 };
  if (!refs.length) return none;
  const halfLuma = halve(lumaPlane(frame));
  const half = edgePlane(halfLuma);
  const quarter = edgePlane(halve(halfLuma));
  let best = none;
  let atLast = -1;
  for (let i = 0; i < refs.length; i++) {
    const r = trackOne(half, quarter, refs[i], opts.maskBelowY ?? Infinity, opts.at ?? IDENTITY);
    // All references share one patch, so water that hides one hides them all.
    if (r.covered) return { ...none, covered: true };
    atLast = Math.max(atLast, r.atLast);
    if (r.score > best.score) best = { ...r, ref: i };
  }
  return { ...best, atLast };
}

/**
 * Whether the whole reference patch is inside the frame at `t`. A patch learned with part of it
 * outside would store that part as black and drag down every later match.
 */
export function patchFits(cfg: GaugeConfig, t: Transform) {
  const r = referenceRegion(cfg);
  const a = trackAnchor(cfg);
  const corners = [mapPoint({ x: r.x0, y: r.y0 }, a, t), mapPoint({ x: r.x0 + r.w, y: r.y0 + r.h }, a, t)];
  return corners.every((p) => p.x >= 0 && p.y >= 0 && p.x <= cfg.frame.width - 1 && p.y <= cfg.frame.height - 1);
}

/** A row seen in a frame where the scene has moved by `t`, back in calibrated rows. */
export function toCalibratedY(cfg: GaugeConfig, t: Transform, y: number) {
  const a = trackAnchor(cfg);
  return a.y + (y - t.dy - a.y) / t.scale;
}

/** The calibration as it should be read in a frame where the scene has moved by `t`. */
export function applyTransform(cfg: GaugeConfig, t: Transform): GaugeConfig {
  if (t.dx === 0 && t.dy === 0 && t.scale === 1) return cfg;
  const a = trackAnchor(cfg);
  const mapY = (y: number) => a.y + t.scale * (y - a.y) + t.dy;
  const H = cfg.frame.height - 1;
  const W = cfg.frame.width - 1;
  const top = mapPoint(cfg.axis.top, a, t);
  const bottom = mapPoint(cfg.axis.bottom, a, t);
  // Keep the axis inside the frame by sliding its ends along the line, not by bending it.
  const along = (y: number) => top.x + ((y - top.y) * (bottom.x - top.x)) / (bottom.y - top.y);
  const ty = Math.max(0, top.y);
  const by = Math.min(H, bottom.y);
  const clampX = (x: number) => Math.max(0, Math.min(W, Math.round(x)));
  const axisTop = { x: clampX(along(ty)), y: Math.round(ty) };
  const axisBottom = { x: clampX(along(by)), y: Math.round(by) };
  return {
    ...cfg,
    axis: { top: axisTop, bottom: axisBottom },
    halfWidth: Math.max(2, Math.round(cfg.halfWidth * t.scale)),
    baseline: {
      y0: Math.max(axisTop.y, Math.round(mapY(cfg.baseline.y0))),
      y1: Math.min(axisBottom.y, Math.round(mapY(cfg.baseline.y1))),
    },
    marks: cfg.marks.map((m) => ({ ...m, y: mapY(m.y) })),
  };
}
