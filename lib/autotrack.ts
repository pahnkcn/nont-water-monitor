import type { GaugeReading } from "./gauge";
import { IDENTITY, type TrackResult, type Transform } from "./track";

// What to do with the tracker's answer each round. Kept free of storage and images so every
// case can be tested: the caller passes a `read` function that reads the gauge at a position.

export type TrackingStatus =
  | "learning" // no reference yet
  | "ok"
  | "moved" // jumped this round; waiting for the next round to agree
  | "lost" // gauge not found; readings refused
  | "covered" // flood water hides the reference patch; last position kept
  | "manual"; // auto-tracking switched off in /admin

export type TrackingState = {
  status: TrackingStatus;
  /** Position the gauge is read at. */
  transform: Transform;
  since: number;
  /** Rounds in a row the gauge could not be found. */
  lostStreak: number;
  /** Last settled position while a jump waits for the next round to confirm it. */
  before: Transform | null;
  /** How well the patch matched in the last round that compared it, -1 to 1, for /admin. */
  score: number | null;
};

export const INITIAL_TRACKING: TrackingState = {
  status: "learning",
  transform: IDENTITY,
  since: 0,
  lostStreak: 0,
  before: null,
  score: null,
};

export type TrackingContext = {
  auto: boolean;
  /** Brightness of each stored reference. */
  refs: { meanLuma: number }[];
  /** Brightness of the reference patch in this frame at the current position; only worked out when needed. */
  lumaNow: () => number;
  now: number;
};

export type TrackingNotice =
  | { kind: "adjusted"; from: Transform; to: Transform }
  | { kind: "lost"; since: number };

export type TrackingDecision = {
  state: TrackingState;
  reading: GaugeReading;
  /** Store this frame as a new reference, cut at this position. */
  learn: Transform | null;
  notices: TrackingNotice[];
};

/** Larger than this between rounds is a camera move, not drift. */
const JUMP_PX = 2;
const JUMP_SCALE = 0.01;
/** Rounds without finding the gauge before the admin hears about it (30 minutes). */
const LOST_NOTICE_AFTER = 3;
/**
 * Least correlation at the last position to keep reading there when the search fails. Night
 * against day measured 0.58 on the real fixtures; an unrelated scene measured near 0.
 */
const HOLD_SCORE = 0.4;
/** A reference this much darker or brighter than all others is worth keeping as well. */
const NEW_LIGHT = 30;
export const MAX_REFS = 4;

function apart(a: Transform, b: Transform) {
  return Math.abs(a.dx - b.dx) > JUMP_PX || Math.abs(a.dy - b.dy) > JUMP_PX || Math.abs(a.scale - b.scale) > JUMP_SCALE;
}

const clear = (r: GaugeReading) => r.ok && r.confidence === "high" && !r.reason;

export function decideTracking(
  prev: TrackingState,
  result: TrackResult | null,
  ctx: TrackingContext,
  read: (t: Transform) => GaugeReading,
): TrackingDecision {
  const next = (status: TrackingStatus, patch: Partial<TrackingState> = {}): TrackingState => ({
    ...prev,
    status,
    since: status === prev.status ? prev.since : ctx.now,
    score: result && !result.covered ? (result.found ? result.score : result.atLast) : prev.score,
    ...patch,
  });
  const quiet = { learn: null, notices: [] };

  if (!ctx.auto) {
    return { ...quiet, state: next("manual", { transform: IDENTITY, before: null, lostStreak: 0 }), reading: read(IDENTITY) };
  }

  if (!ctx.refs.length) {
    const reading = read(prev.transform);
    if (clear(reading)) return { ...quiet, state: next("ok"), reading, learn: prev.transform };
    return { ...quiet, state: next("learning"), reading };
  }

  // Dark frame: nothing to match against; the gauge reader reports it.
  if (!result) return { ...quiet, state: prev, reading: read(prev.transform) };

  if (result.covered) return { ...quiet, state: next("covered"), reading: read(prev.transform) };

  if (result.found) {
    const t = result.transform;
    const settled = { transform: t, before: null, lostStreak: 0 };
    if (!apart(t, prev.transform)) {
      // Where it was last round. After a jump, that is the confirmation.
      const notices: TrackingNotice[] = prev.before ? [{ kind: "adjusted", from: prev.before, to: t }] : [];
      return { ...quiet, state: next("ok", settled), reading: read(t), notices };
    }
    // A jump seen once: read at the new place, but too soon to let it change an alert.
    const reading = read(t);
    return {
      ...quiet,
      state: next("moved", { transform: t, before: prev.before ?? prev.transform, lostStreak: 0 }),
      reading: reading.ok ? { ...reading, confidence: "low", reason: "camera-moved" } : reading,
    };
  }

  // Not found. If the patch where the gauge was still resembles a reference and the gauge reads
  // cleanly there, the camera has not moved; the light has (dawn, rain, floodlights), so keep
  // this look of the patch as well. A clean reading alone is not enough: any bright strip over a
  // dark area reads as a gauge, and learning such a scene would poison every later round.
  const fallback = read(prev.transform);
  if (result.atLast >= HOLD_SCORE && clear(fallback)) {
    const luma = ctx.lumaNow();
    const newLight = ctx.refs.every((r) => Math.abs(r.meanLuma - luma) > NEW_LIGHT);
    return {
      ...quiet,
      state: next("ok", { before: null, lostStreak: 0 }),
      reading: fallback,
      learn: newLight ? prev.transform : null,
    };
  }

  const lostStreak = prev.lostStreak + 1;
  const since = prev.status === "lost" ? prev.since : ctx.now;
  return {
    ...quiet,
    state: next("lost", { lostStreak, before: null }),
    reading: { ...fallback, ok: false, level: null, confidence: "low", reason: "gauge-lost" },
    notices: lostStreak === LOST_NOTICE_AFTER ? [{ kind: "lost", since }] : [],
  };
}
