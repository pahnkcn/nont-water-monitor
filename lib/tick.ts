import { stepAlert, wantsEvent, type AlertEvent } from "./alerts";
import { captureFrames } from "./capture";
import { getConfig } from "./config";
import { readGauge } from "./gauge";
import { KEYS, kv } from "./kv";
import { alertMessage, digestMessage, type PushMessage } from "./messages";
import { mapLimit, sendPush } from "./push";
import { isDigestDue } from "./schedule";
import {
  addReading,
  allSubscribers,
  getState,
  logEvents,
  readingsSince,
  removeSubscribers,
  saveSubscribers,
  setSnapshot,
  setState,
  type SiteState,
  type Subscriber,
} from "./store";
import { summarize } from "./summary";

const HOUR = 60 * 60 * 1000;
/** After this long without a good read, routine updates say the camera is down. */
const STALE_AFTER_MS = 30 * 60 * 1000;

export type TickResult = {
  ok: boolean;
  skipped?: "locked";
  reading?: { level: number | null; confidence: string; reason?: string; y: number | null };
  error?: string;
  status?: string;
  events: AlertEvent[];
  sent: { alerts: number; digests: number; failed: number; removed: number };
  ms: number;
};

export async function runTick(origin: string, now = Date.now()): Promise<TickResult> {
  const started = Date.now();
  const sent = { alerts: 0, digests: 0, failed: 0, removed: 0 };
  if (!(await kv().setNX(KEYS.tickLock, now, 240))) {
    return { ok: false, skipped: "locked", events: [], sent, ms: 0 };
  }
  try {
    const config = await getConfig();
    let state = await getState();
    let events: AlertEvent[] = [];
    let readingInfo: TickResult["reading"];
    let error: string | undefined;

    try {
      const cap = await captureFrames();
      const r = readGauge(cap.frames, config.gauge);
      readingInfo = { level: r.level, confidence: r.confidence, reason: r.reason, y: r.y };
      await setSnapshot({ t: cap.capturedAt, jpegBase64: cap.jpeg.toString("base64"), y: r.ok ? r.y : null });

      if (r.ok && r.level !== null) {
        await addReading({ t: cap.capturedAt, level: r.level, confidence: r.confidence, y: r.y ?? undefined });
        const stepped = stepAlert(state.alert, { t: cap.capturedAt, level: r.level, confidence: r.confidence }, config.thresholds);
        events = stepped.events;
        state = {
          ...state,
          alert: stepped.state,
          lastRead: { t: cap.capturedAt, ok: true, level: r.level, confidence: r.confidence, reason: r.reason, y: r.y },
          lastSuccessAt: cap.capturedAt,
          failingSince: null,
          failureStreak: 0,
        };
        if (events.length) await logEvents(events);
      } else {
        state = failed(state, now, r.reason ?? "unreadable");
      }
    } catch (e) {
      error = (e as Error).message;
      state = failed(state, now, "capture-failed");
    }

    await setState(state);
    await notify(origin, now, state, events, config.thresholds, sent);

    return { ok: !error, reading: readingInfo, error, status: state.alert.status, events, sent, ms: Date.now() - started };
  } finally {
    await kv().del(KEYS.tickLock);
  }
}

function failed(state: SiteState, now: number, reason: string): SiteState {
  return {
    ...state,
    lastRead: { t: now, ok: false, reason },
    failingSince: state.failingSince ?? now,
    failureStreak: state.failureStreak + 1,
  };
}

async function notify(
  origin: string,
  now: number,
  state: SiteState,
  events: AlertEvent[],
  thresholds: Parameters<typeof alertMessage>[1],
  sent: TickResult["sent"],
) {
  const subs = await allSubscribers();
  if (!subs.length) return;

  const readings = await readingsSince(now - 26 * HOUR);
  const summary = summarize(readings, now);
  const snapshotUrl = `/api/snapshot?t=${state.lastRead?.t ?? now}`;
  const alertMsgs = events.map((e) => ({
    event: e,
    msg: alertMessage(e, thresholds, { snapshotUrl, trend: summary.trendCmPerHour }),
  }));
  const stale = state.lastSuccessAt === null || now - state.lastSuccessAt > STALE_AFTER_MS;
  const digest = digestMessage(summary, state.alert.status, thresholds, { lastFailureAt: state.failingSince, stale });

  type Job = { sub: Subscriber; msg: PushMessage; kind: "alert" | "digest" };
  const jobs: Job[] = [];
  const digestSubs: Subscriber[] = [];
  for (const sub of subs) {
    const mine = alertMsgs.filter((a) => wantsEvent(sub.alerts, a.event));
    for (const a of mine) jobs.push({ sub, msg: a.msg, kind: "alert" });
    if (isDigestDue(sub.digest, sub.lastDigestAt, now)) {
      // An alert in the same round already carries the level; mark the slot as served.
      if (!mine.length) jobs.push({ sub, msg: digest, kind: "digest" });
      digestSubs.push(sub);
    }
  }

  const gone = new Set<string>();
  await mapLimit(jobs, 20, async (job) => {
    const res = await sendPush(job.sub.target, job.msg, origin);
    if (res.ok) sent[job.kind === "alert" ? "alerts" : "digests"]++;
    else {
      sent.failed++;
      if (res.gone) gone.add(job.sub.id);
    }
  });

  if (gone.size) {
    await removeSubscribers([...gone]);
    sent.removed = gone.size;
  }
  const updated = digestSubs.filter((s) => !gone.has(s.id)).map((s) => ({ ...s, lastDigestAt: now }));
  if (updated.length) await saveSubscribers(updated);
}
