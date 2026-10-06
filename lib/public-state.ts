import { getConfig } from "./config";
import { getSnapshotMeta, getState, readingsSince, recentEvents, type LoggedEvent, type SnapshotMeta } from "./store";
import { summarize, type StoredReading } from "./summary";
import type { Status } from "./alerts";
import type { TrackingStatus } from "./autotrack";

const HOUR = 60 * 60 * 1000;
const STALE_AFTER_MS = 30 * 60 * 1000;

export type PublicState = {
  now: number;
  status: Status;
  statusSince: number;
  latest: StoredReading | null;
  trendCmPerHour: number | null;
  todayHigh: StoredReading | null;
  todayLow: StoredReading | null;
  thresholds: { watch: number; danger: number };
  thresholdsArePlaceholders: boolean;
  camera: "ok" | "stale" | "waiting";
  failingSince: number | null;
  lastAttemptAt: number | null;
  lastReason: string | null;
  /** Whether the reader is following a moved camera or has lost the gauge. */
  tracking: TrackingStatus;
  events: LoggedEvent[];
  snapshot: SnapshotMeta | null;
  /** Readings for the past 24 h, oldest first. */
  day: Array<[number, number]>;
};

export async function getPublicState(now = Date.now()): Promise<PublicState> {
  const [config, state, readings, events, snapshot] = await Promise.all([
    getConfig(),
    getState(),
    readingsSince(now - 26 * HOUR),
    recentEvents(20),
    getSnapshotMeta(),
  ]);
  const s = summarize(readings, now);
  const camera =
    state.lastSuccessAt === null ? "waiting" : now - state.lastSuccessAt > STALE_AFTER_MS ? "stale" : "ok";
  return {
    now,
    status: state.alert.status,
    statusSince: state.alert.since,
    latest: s.latest,
    trendCmPerHour: s.trendCmPerHour,
    todayHigh: s.todayHigh,
    todayLow: s.todayLow,
    thresholds: { watch: config.thresholds.watch, danger: config.thresholds.danger },
    thresholdsArePlaceholders: config.thresholdsArePlaceholders,
    camera,
    failingSince: state.failingSince,
    lastAttemptAt: state.lastRead?.t ?? null,
    lastReason: state.lastRead && !state.lastRead.ok ? (state.lastRead.reason ?? null) : null,
    tracking: state.tracking.status,
    events,
    snapshot,
    day: readings.filter((r) => r.t >= now - 24 * HOUR).map((r) => [r.t, r.level]),
  };
}
