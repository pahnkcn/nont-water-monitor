import { createHash } from "node:crypto";
import type { AlertEvent, AlertPreference, AlertState, Thresholds } from "./alerts";
import { INITIAL_ALERT_STATE, OFFSET_CHOICES, initialPersonalState, personalThresholds, rank } from "./alerts";
import { INITIAL_TRACKING, type TrackingState } from "./autotrack";
import { KEYS, kv } from "./kv";
import type { PushTarget } from "./push";
import { DEFAULT_DIGEST, type DigestPref } from "./schedule";
import type { StoredReading } from "./summary";
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
};

export const INITIAL_SITE_STATE: SiteState = {
  alert: INITIAL_ALERT_STATE,
  lastRead: null,
  lastSuccessAt: null,
  failingSince: null,
  failureStreak: 0,
  tracking: INITIAL_TRACKING,
};

export async function getState(): Promise<SiteState> {
  return { ...INITIAL_SITE_STATE, ...((await kv().get<SiteState>(KEYS.state)) ?? {}) };
}

export async function setState(s: SiteState) {
  await kv().set(KEYS.state, s);
}

// ---------- snapshot ----------

export type Snapshot = { t: number; jpegBase64: string; y: number | null };

export type SnapshotMeta = Omit<Snapshot, "jpegBase64">;

export async function setSnapshot(s: Snapshot) {
  await kv().set(KEYS.snapshot, s);
  // Small copy for the dashboard so it never has to pull the image out of Redis.
  await kv().set(KEYS.snapshotMeta, { t: s.t, y: s.y } satisfies SnapshotMeta);
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
  alerts: AlertPreference;
  createdAt: number;
  lastDigestAt: number;
  lastTestAt?: number;
  /** Personal alert point in cm against the site thresholds; see OFFSET_CHOICES. */
  offsetCm?: number;
  /** Alert state at the personal point. Missing on devices subscribed before personal points existed. */
  alertState?: AlertState;
  /** Gets camera and tracking notices meant for whoever runs the site. */
  admin?: boolean;
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

export function sanitizeAlerts(a: unknown, fallback: AlertPreference = "danger"): AlertPreference {
  return a === "watch" || a === "danger" || a === "off" ? a : fallback;
}

export function sanitizeOffset(v: unknown, fallback = 0): number {
  return (OFFSET_CHOICES as readonly unknown[]).includes(v) ? (v as number) : fallback;
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

/** What a round changes on a device: its state at its own alert point, and when its last update went out. */
export type RoundUpdate = { id: string; offsetCm: number; alertState?: AlertState; lastDigestAt?: number };

/**
 * Apply a round's results to the records as they are now, not as they were when the round began.
 * A device unsubscribed meanwhile stays gone, and a newly picked alert point keeps the starting
 * state the subscribe route gave it.
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
    if (u.alertState && (sub.offsetCm ?? 0) === u.offsetCm) next.alertState = u.alertState;
    merged.push(next);
  }
  if (merged.length) await saveSubscribers(merged);
}

/**
 * After new thresholds are saved: lower the site's and every device's alert state to what the
 * latest reading meets under them, without notifications, so the header, the page and every text
 * agree at once. A state that would rise is left to the next round, which alerts as usual.
 */
export async function resyncAlerts(th: Thresholds, now: number) {
  const latest = await latestReading();
  if (!latest) return;
  const lowered = (current: AlertState, t: Thresholds) => {
    const fresh = initialPersonalState(latest.level, t, now);
    return rank(fresh.status) < rank(current.status) ? fresh : null;
  };

  const state = await getState();
  const site = lowered(state.alert, th);
  if (site) {
    await setState({ ...state, alert: site });
    // Strikes the old alert through in the public log.
    await logEvents([{ kind: "clear", from: state.alert.status, to: site.status, level: latest.level, t: now }]);
  }

  const updates: RoundUpdate[] = [];
  for (const sub of await allSubscribers()) {
    const offsetCm = sub.offsetCm ?? 0;
    const mine = lowered(sub.alertState ?? state.alert, personalThresholds(th, offsetCm));
    if (mine) updates.push({ id: sub.id, offsetCm, alertState: mine });
  }
  await applyRoundUpdates(updates);
}

export async function removeSubscribers(ids: string[]) {
  await kv().hdel(KEYS.subs, ...ids);
}
