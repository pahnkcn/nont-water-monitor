import { BANGKOK_OFFSET_MS } from "./schedule";

/**
 * How far a level can be trusted when it is not a clean read: "approx" for water on the shaded
 * foot of the gauge (the row is right, the scale there is rough), "below" for water under every
 * row the reader scans (the level is that last row, and the water is lower still), "covered" for
 * water hidden under plants or something afloat (the level is where they start; the water is lower).
 */
export type Estimate = "approx" | "below" | "covered";

/** The level is only the most the water can be. */
export function isBound(estimate?: Estimate) {
  return estimate === "below" || estimate === "covered";
}

export type StoredReading = {
  t: number;
  level: number;
  confidence: "high" | "low";
  y?: number;
  /** Missing for a clean read. */
  estimate?: Estimate;
};

export type Summary = {
  latest: StoredReading | null;
  /** cm per hour over roughly the last hour; null without enough history. */
  trendCmPerHour: number | null;
  todayHigh: StoredReading | null;
  todayLow: StoredReading | null;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function bangkokDayStart(t: number) {
  const local = t + BANGKOK_OFFSET_MS;
  return Math.floor(local / DAY) * DAY - BANGKOK_OFFSET_MS;
}

/** `readings` sorted oldest first. */
export function summarize(readings: StoredReading[], now: number): Summary {
  const latest = readings.at(-1) ?? null;
  if (!latest) return { latest: null, trendCmPerHour: null, todayHigh: null, todayLow: null };

  // Compare with the reading closest to one hour before the latest, if it is 40-90 minutes old.
  let ref: StoredReading | null = null;
  for (const r of readings) {
    const age = latest.t - r.t;
    if (age < 40 * 60 * 1000 || age > 90 * 60 * 1000) continue;
    if (!ref || Math.abs(age - HOUR) < Math.abs(latest.t - ref.t - HOUR)) ref = r;
  }
  // A bound says nothing about how fast the water moves, and a clean read against an estimate
  // mixes two error budgets. Two estimates share one, so they compare.
  const trendCmPerHour = ref && ref.estimate === latest.estimate && !isBound(latest.estimate)
    ? Math.round(((latest.level - ref.level) * 100 * HOUR) / (latest.t - ref.t))
    : null;

  const dayStart = bangkokDayStart(now);
  let todayHigh: StoredReading | null = null;
  let todayLow: StoredReading | null = null;
  for (const r of readings) {
    if (r.t < dayStart) continue;
    if (!todayHigh || r.level > todayHigh.level) todayHigh = r;
    if (!todayLow || r.level < todayLow.level) todayLow = r;
  }
  return { latest, trendCmPerHour, todayHigh, todayLow };
}
