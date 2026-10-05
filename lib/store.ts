import { createHash } from "node:crypto";
import type { AlertEvent, AlertPreference, AlertState } from "./alerts";
import { INITIAL_ALERT_STATE } from "./alerts";
import { KEYS, kv } from "./kv";
import type { PushTarget } from "./push";
import { DEFAULT_DIGEST, type DigestPref } from "./schedule";
import type { StoredReading } from "./summary";

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
};

export const INITIAL_SITE_STATE: SiteState = {
  alert: INITIAL_ALERT_STATE,
  lastRead: null,
  lastSuccessAt: null,
  failingSince: null,
  failureStreak: 0,
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

export async function removeSubscribers(ids: string[]) {
  await kv().hdel(KEYS.subs, ...ids);
}
