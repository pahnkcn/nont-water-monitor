import { detectInSample, type GaugeSample, type WaterlineResult } from "./gauge";
import type { GaugeConfig } from "./gauge-config";
import type { Label } from "./labels";
import { READER_BOUNDS, READER_KEYS, validateReaderParams, type ReaderParams } from "./reader-params";

// Score the reader's numbers on the rounds an admin labelled, and look for numbers that read more
// of them right. Runs in the admin's browser (components/tune.worker.ts): no storage, no node.

/** A labelled round ready to read: its pixels sampled along the gauge it was read at. */
export type Sample = { t: number; kind: Label["kind"]; y: number | null; gauge: GaugeConfig; pixels: GaugeSample };

/** Rows off that count as fully wrong; also the error of a wrong kind of answer. */
const MISS_PX = 40;
/** Fewer labelled rounds than this and tuning would chase noise. */
export const MIN_SAMPLES = 10;

export type Score = { pass: boolean; error: number };

/** Unreadable rounds teach nothing about where the water is. */
export const isScored = (s: Pick<Sample, "kind">) => s.kind !== "unreadable";

/** The tolerances are the ones tests/production.test.ts holds the reader to. */
export function scoreLabel(r: WaterlineResult, label: Pick<Sample, "kind" | "y">): Score {
  const miss = { pass: false, error: MISS_PX };
  const seen = !r.dark && r.y !== null && (r.baselineOk || r.aboveTop);
  if (label.kind === "below") return r.belowRange && !r.dark ? { pass: true, error: 0 } : miss;
  if (!seen || label.y === null || r.y === null) return miss;
  if (label.kind === "waterline") {
    if (r.covered || r.belowRange) return miss;
    const off = Math.abs(r.y - label.y);
    return { pass: off <= 4, error: Math.min(off, MISS_PX) };
  }
  if (label.kind === "covered") {
    if (!r.covered) return miss;
    // A bound may start a little high, where stems first cross the face; under the face's end it would lie.
    const off = Math.max(0, r.y - (label.y + 8), label.y - 25 - r.y);
    return { pass: off === 0, error: Math.min(off, MISS_PX) };
  }
  return miss;
}

export type Evaluation = { pass: boolean[]; passCount: number; error: number };

/** `samples` are scored ones (isScored); `pass[i]` is about `samples[i]`. */
export function evaluate(samples: Sample[], params: ReaderParams): Evaluation {
  return evaluateKeeping(samples, params, []) as Evaluation;
}

/** As evaluate, but null as soon as a round that passes in `keep` does not. Those are read first. */
function evaluateKeeping(samples: Sample[], params: ReaderParams, keep: boolean[]): Evaluation | null {
  const pass: boolean[] = new Array(samples.length);
  let error = 0;
  const order = samples.map((_, i) => i).sort((a, b) => Number(keep[b] ?? false) - Number(keep[a] ?? false));
  for (const i of order) {
    const score = scoreLabel(detectInSample(samples[i].pixels, samples[i].gauge, params), samples[i]);
    if (keep[i] && !score.pass) return null;
    pass[i] = score.pass;
    error += score.error;
  }
  return { pass, passCount: pass.filter(Boolean).length, error };
}

/** Every value tuning tries for one number, low to high. */
export function grid(key: keyof ReaderParams): number[] {
  const { min, max, step } = READER_BOUNDS[key];
  const out: number[] = [];
  for (let i = 0; min + i * step <= max + 1e-9; i++) out.push(Math.round((min + i * step) * 1e4) / 1e4);
  return out;
}

export type TuneResult = {
  params: ReaderParams;
  before: Evaluation;
  after: Evaluation;
  /** The numbers that moved, with their old and new values. */
  changed: { key: keyof ReaderParams; from: number; to: number }[];
};

const MAX_PASSES = 3;

/**
 * Coordinate descent from `start`: try every value of one number at a time and keep a change when
 * more rounds read right (or as many, closer), and no round that read right stops doing so. The
 * same samples always give the same answer. `samples` are scored ones, as for evaluate.
 */
export function tune(samples: Sample[], start: ReaderParams, onProgress?: (done: number, total: number) => void): TuneResult {
  const grids = READER_KEYS.map((key) => [key, grid(key)] as const);
  const total = MAX_PASSES * grids.reduce((n, [, values]) => n + values.length, 0);
  const before = evaluate(samples, start);
  let cur = { ...start };
  let best = before;
  let done = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (const [key, values] of grids) {
      for (const v of values) {
        done++;
        if (v === cur[key]) continue;
        const cand = { ...cur, [key]: v };
        if (validateReaderParams(cand)) continue;
        const e = evaluateKeeping(samples, cand, best.pass);
        if (e && (e.passCount > best.passCount || (e.passCount === best.passCount && e.error < best.error - 1e-9))) {
          cur = cand;
          best = e;
          improved = true;
        }
      }
      onProgress?.(done, total);
    }
    if (!improved) break;
  }
  onProgress?.(total, total);
  const changed = READER_KEYS.filter((k) => cur[k] !== start[k]).map((key) => ({ key, from: start[key], to: cur[key] }));
  return { params: cur, before, after: best, changed };
}
