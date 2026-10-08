import { createHash } from "node:crypto";
import type { AlertEvent, AlertState, Thresholds } from "./alerts";
import type { GaugeConfig } from "./gauge-config";
import { INITIAL_ALERT_STATE, rank, stateAtLevel } from "./alerts";
import { INITIAL_TRACKING, type TrackingState } from "./autotrack";
import { KEYS, kv } from "./kv";
import type { PushTarget } from "./push";
import { DEFAULT_REPEAT, REPEAT_CHOICES, type RepeatPref } from "./remind";
import { DEFAULT_DIGEST, type DigestPref } from "./schedule";
import type { Estimate, StoredReading } from "./summary";
import { MAX_SUSPECTS, type LevelAt } from "./jump";
import type { GaugeReference } from "./track";

const DAY = 24 * 60 * 60 * 1000;
export const HISTORY_DAYS = 35;
export const MAX_SUBSCRIBERS = 5000;

// ---------- readings ----------

export async function addReading(r: StoredReading) {
  await kv().zadd(KEYS.readings, r.t, r);
  await kv().zremBelow(KEYS.readings, r.t - HISTORY_DAYS * DAY);
}

export async function readingsSince(since: number): Promise<StoredReading[]> {
  return kv().zrangeByScore<StoredReading>(KEYS.readings, since, Date.now() + 60_000);
}

/** The newest reading from the past two hours, if any. */
export async function latestReading(): Promise<StoredReading | null> {
  return (await readingsSince(Date.now() - 2 * 60 * 60 * 1000)).at(-1) ?? null;
}

// ---------- site state ----------

export type LastRead = {
  t: number;
  ok: boolean;
  reason?: string;
  level?: number;
  confidence?: "high" | "low";
  y?: number | null;
  estimate?: Estimate;
};

export type SiteState = {
  alert: AlertState;
  lastRead: LastRead | null;
  lastSuccessAt: number | null;
  /** Start of the current run of failed reads; null when the last read worked. */
  failingSince: number | null;
  failureStreak: number;
  /** Where the camera has the gauge now, relative to the saved calibration. */
  tracking: TrackingState;
  /** The last level taken into the history; the next round is judged against it (lib/jump.ts). */
  lastGood: LevelAt | null;
  /** A round held back as out of the river's reach, waiting for the next round to agree. */
  held: LevelAt | null;
};

export const INITIAL_SITE_STATE: SiteState = {
  alert: INITIAL_ALERT_STATE,
  lastRead: null,
  lastSuccessAt: null,
  failingSince: null,
  failureStreak: 0,
  tracking: INITIAL_TRACKING,
  lastGood: null,
  held: null,
};

export async function getState(): Promise<SiteState> {
  return { ...INITIAL_SITE_STATE, ...((await kv().get<SiteState>(KEYS.state)) ?? {}) };
}

export async function setState(s: SiteState) {
  await kv().set(KEYS.state, s);
}

// ---------- snapshot ----------

/**
 * `y` is the waterline row; with estimate "below" the last row scanned, with "covered" the first
 * hidden one (the water is lower). `gauge` is the calibration it was read at, for a label on it.
 */
export type Snapshot = { t: number; jpegBase64: string; y: number | null; estimate?: Estimate; gauge?: GaugeConfig };

export type SnapshotMeta = Omit<Snapshot, "jpegBase64" | "gauge">;

export async function setSnapshot(s: Snapshot) {
  await kv().set(KEYS.snapshot, s);
  // Small copy for the dashboard so it never has to pull the image out of Redis.
  await kv().set(KEYS.snapshotMeta, { t: s.t, y: s.y, estimate: s.estimate } satisfies SnapshotMeta);
}

export async function getSnapshotMeta(): Promise<SnapshotMeta | null> {
  return kv().get<SnapshotMeta>(KEYS.snapshotMeta);
}

export async function getSnapshot(): Promise<Snapshot | null> {
  return kv().get<Snapshot>(KEYS.snapshot);
}

// ---------- gauge tracking ----------

export async function getGaugeRefs(): Promise<GaugeReference[]> {
  return (await kv().get<GaugeReference[]>(KEYS.gaugeRefs)) ?? [];
}

export async function setGaugeRefs(refs: GaugeReference[]) {
  await kv().set(KEYS.gaugeRefs, refs);
}

/**
 * Forget the references but keep the last known camera position, so the next clear round
 * learns new ones right where the gauge is now.
 */
export async function clearGaugeRefs() {
  await kv().del(KEYS.gaugeRefs);
}

/** After a new calibration: old references and the last known camera position no longer apply. */
export async function resetTracking() {
  await clearGaugeRefs();
  await setState({ ...(await getState()), tracking: INITIAL_TRACKING });
}

// ---------- suspicious rounds ----------

/** A round held back as a jump or read with low confidence, kept with its picture for /admin. */
export type Suspect = {
  t: number;
  level: number;
  y: number | null;
  confidence: "high" | "low";
  /** "jump" when held back as out of the river's reach, otherwise why the reader was unsure. */
  reason?: string;
  estimate?: Estimate;
  /** The accepted level the round was judged against. */
  lastLevel: number | null;
  /** The calibration the round was read at; missing on rounds kept before labels. */
  gauge?: GaugeConfig;
};

/** The pictures go in a second list kept in step with the first, so listing the rounds stays small. */
export async function addSuspect(s: Suspect, jpegBase64: string) {
  await kv().lpushTrim(KEYS.suspects, s, MAX_SUSPECTS);
  await kv().lpushTrim(KEYS.suspectImages, { t: s.t, jpegBase64 }, MAX_SUSPECTS);
}

/** Newest first. */
export async function getSuspects(): Promise<Suspect[]> {
  return kv().lrange<Suspect>(KEYS.suspects, 0, -1);
}

/** The picture at position `i` of the list, if it is still the one taken at `t`. */
export async function getSuspectImage(i: number, t: number): Promise<string | null> {
  const [img] = await kv().lrange<{ t: number; jpegBase64: string }>(KEYS.suspectImages, i, i);
  return img?.t === t ? img.jpegBase64 : null;
}

// ---------- alert log ----------

export type LoggedEvent = AlertEvent & { id: string };

export async function logEvents(events: AlertEvent[]) {
  for (const e of events) await kv().lpushTrim(KEYS.alertLog, { ...e, id: `${e.t}-${e.kind}` }, 60);
}

export async function recentEvents(limit = 30): Promise<LoggedEvent[]> {
  return kv().lrange<LoggedEvent>(KEYS.alertLog, 0, limit - 1);
}

// ---------- subscribers ----------

export type Subscriber = {
  id: string;
  target: PushTarget;
  digest: DigestPref;
  createdAt: number;
  lastDigestAt: number;
  lastTestAt?: number;
  /** Gets camera and tracking notices meant for whoever runs the site. */
  admin?: boolean;
  /** Reminders while the water stays at watch or danger. Read through repeatOf. */
  repeat?: RepeatPref;
  /**
   * The level alerts started from, on devices saved back when that was a choice. Every device is
   * alerted now; repeatOf keeps them from reminders at a level they had turned away.
   */
  alerts?: "watch" | "danger" | "off";
  /** When this device was last sent an alert or a reminder. */
  lastAlertAt?: number;
};

export function subscriberId(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("base64url").slice(0, 24);
}

export function isValidTarget(t: unknown): t is PushTarget {
  const x = t as PushTarget;
  if (!x || typeof x.endpoint !== "string" || x.endpoint.length > 1000) return false;
  try {
    if (new URL(x.endpoint).protocol !== "https:") return false;
  } catch {
    return false;
  }
  return (
    typeof x.keys?.p256dh === "string" &&
    typeof x.keys?.auth === "string" &&
    x.keys.p256dh.length < 200 &&
    x.keys.auth.length < 100
  );
}

export function sanitizeDigest(d: Partial<DigestPref> | undefined, fallback: DigestPref = DEFAULT_DIGEST): DigestPref {
  const every = ["off", "1h", "3h", "6h", "daily"].includes(d?.every as string) ? (d!.every as DigestPref["every"]) : fallback.every;
  const hour = (n: unknown, f: number) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 23 ? (n as number) : f);
  const quiet =
    d?.quiet === null
      ? null
      : d?.quiet
        ? { start: hour(d.quiet.start, 22), end: hour(d.quiet.end, 6) }
        : fallback.quiet;
  return { every, dailyHour: hour(d?.dailyHour, fallback.dailyHour), quiet };
}

export function sanitizeRepeat(r: Partial<RepeatPref> | undefined, fallback: RepeatPref = DEFAULT_REPEAT): RepeatPref {
  const pick = (level: keyof RepeatPref) =>
    (REPEAT_CHOICES[level] as readonly unknown[]).includes(r?.[level]) ? (r![level] as number) : fallback[level];
  return { watch: pick("watch"), danger: pick("danger") };
}

/** The reminders a device gets. Missing means DEFAULT_REPEAT, less any level it had turned alerts off for. */
export function repeatOf(sub: Pick<Subscriber, "repeat" | "alerts">): RepeatPref {
  const repeat = sub.repeat ?? DEFAULT_REPEAT;
  if (sub.alerts === "off") return { watch: 0, danger: 0 };
  return sub.alerts === "danger" ? { ...repeat, watch: 0 } : repeat;
}

export async function getSubscriber(id: string) {
  return kv().hget<Subscriber>(KEYS.subs, id);
}

export async function allSubscribers(): Promise<Subscriber[]> {
  return Object.values(await kv().hgetall<Subscriber>(KEYS.subs));
}

export async function subscriberCount() {
  return kv().hlen(KEYS.subs);
}

export async function saveSubscribers(subs: Subscriber[]) {
  await kv().hset(KEYS.subs, Object.fromEntries(subs.map((s) => [s.id, s])));
}

/** What a round changes on a device: when its last update and alert went out. */
export type RoundUpdate = { id: string; lastDigestAt?: number; lastAlertAt?: number };

/**
 * Apply a round's results to the records as they are now, not as they were when the round began.
 * A device unsubscribed meanwhile stays gone, and settings changed meanwhile are kept.
 */
export async function applyRoundUpdates(updates: RoundUpdate[]) {
  if (!updates.length) return;
  const current = await kv().hgetall<Subscriber>(KEYS.subs);
  const merged: Subscriber[] = [];
  for (const u of updates) {
    const sub = current[u.id];
    if (!sub) continue;
    const next = { ...sub };
    if (u.lastDigestAt !== undefined) next.lastDigestAt = Math.max(sub.lastDigestAt, u.lastDigestAt);
    if (u.lastAlertAt !== undefined) next.lastAlertAt = Math.max(sub.lastAlertAt ?? 0, u.lastAlertAt);
    merged.push(next);
  }
  if (merged.length) await saveSubscribers(merged);
}

/**
 * After new thresholds are saved: lower the site's alert state to what the latest reading meets
 * under them, without notifications, so the header, the page and every text agree at once. A
 * state that would rise is left to the next round, which alerts as usual.
 */
export async function resyncAlerts(th: Thresholds, now: number) {
  const latest = await latestReading();
  if (!latest) return;
  const state = await getState();
  const fresh = stateAtLevel(latest.level, th, now);
  if (rank(fresh.status) >= rank(state.alert.status)) return;
  await setState({ ...state, alert: fresh });
  // Strikes the old alert through in the public log.
  await logEvents([{ kind: "clear", from: state.alert.status, to: fresh.status, level: latest.level, t: now }]);
}

export async function removeSubscribers(ids: string[]) {
  await kv().hdel(KEYS.subs, ...ids);
}
