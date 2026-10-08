import { boundCeiling, stepAlert, type AlertEvent, type ReadingInput, type Thresholds } from "./alerts";
import { INITIAL_TRACKING, MAX_REFS, decideTracking, type TrackingDecision } from "./autotrack";
import { captureFrames, type Capture } from "./capture";
import { getConfig, type SiteConfig } from "./config";
import { DARK_LUMA, frameMeanLuma, readGauge } from "./gauge";
import { judgeJump, type LevelAt } from "./jump";
import { KEYS, kv } from "./kv";
import { alertMessage, digestMessage, reminderMessage, snapshotImage, systemMessage, type PushMessage, type SystemNotice } from "./messages";
import { mapLimit, sendPush } from "./push";
import { isReminderDue } from "./remind";
import { isDigestDue } from "./schedule";
import {
  addReading,
  addSuspect,
  allSubscribers,
  applyRoundUpdates,
  getGaugeRefs,
  getSnapshotMeta,
  getState,
  logEvents,
  readingsSince,
  removeSubscribers,
  repeatOf,
  resyncAlerts,
  setGaugeRefs,
  setSnapshot,
  setState,
  type LastRead,
  type RoundUpdate,
  type SiteState,
  type Subscriber,
} from "./store";
import { isBound, summarize, type Estimate } from "./summary";
import { applyTransform, makeReference, patchFits, toCalibratedY, track, type Transform } from "./track";

const HOUR = 60 * 60 * 1000;
/** After this long without a good read, routine updates say the camera is down. */
const STALE_AFTER_MS = 30 * 60 * 1000;
/** Failed rounds in a row before the admin hears the camera is down (one hour). */
const CAMERA_DOWN_NOTICE_AFTER = 6;

export type TickResult = {
  ok: boolean;
  skipped?: "locked";
  reading?: { level: number | null; confidence: string; reason?: string; y: number | null; estimate?: Estimate };
  tracking?: TrackingDecision["state"];
  error?: string;
  status?: string;
  events: AlertEvent[];
  sent: { alerts: number; reminders: number; digests: number; system: number; failed: number; removed: number };
  ms: number;
};

/** The camera and the push service, swappable in tests. */
export type TickDeps = { capture: () => Promise<Capture>; send: typeof sendPush };

const LIVE: TickDeps = { capture: () => captureFrames(), send: sendPush };

export async function runTick(origin: string, now = Date.now(), deps: TickDeps = LIVE): Promise<TickResult> {
  const started = Date.now();
  const sent = { alerts: 0, reminders: 0, digests: 0, system: 0, failed: 0, removed: 0 };
  if (!(await kv().setNX(KEYS.tickLock, now, 240))) {
    return { ok: false, skipped: "locked", events: [], sent, ms: 0 };
  }
  try {
    const config = await getConfig();
    let state = await getState();
    let events: AlertEvent[] = [];
    const notices: SystemNotice[] = [];
    let readingInfo: TickResult["reading"];
    let error: string | undefined;

    try {
      const cap = await deps.capture();
      const decision = await readTracked(cap, config, state, now);
      const r = decision.reading;
      notices.push(...decision.notices);
      state = { ...state, tracking: decision.state };
      const estimate: Estimate | undefined = r.covered ? "covered" : r.belowRange ? "below" : r.approx ? "approx" : undefined;
      // Plants reaching the watch line hide whether the water got there too.
      const hidden = r.ok && r.covered && r.level !== null && r.level >= boundCeiling(config.thresholds);
      const read: LevelAt | null =
        r.ok && r.level !== null && !hidden
          ? { t: cap.capturedAt, level: r.level, calibration: config.calibration, ...(isBound(estimate) && { bound: true }) }
          : null;
      const held = read !== null && judgeJump(read, state.lastGood, state.held) === "hold";
      const reason = held ? "jump" : hidden ? "covered" : r.reason;
      readingInfo = { level: r.level, confidence: r.confidence, reason, y: r.y, estimate };
      const jpegBase64 = cap.jpeg.toString("base64");
      const { gauge } = decision;
      // A held round draws no waterline: the number on the page is still the last accepted one.
      await setSnapshot({ t: cap.capturedAt, jpegBase64, gauge, ...(read && !held ? { y: r.y, estimate } : { y: null }) });
      // Keep the picture of a round worth a second look, so the admin can see what crossed the gauge.
      if (r.level !== null && (held || hidden || (read && r.confidence === "low"))) {
        const suspect = { t: cap.capturedAt, level: r.level, y: r.y, confidence: r.confidence, reason, gauge };
        await addSuspect({ ...suspect, ...(estimate && { estimate }), lastLevel: state.lastGood?.level ?? null }, jpegBase64);
      }

      if (hidden) {
        state = failed(state, now, "covered", { level: r.level ?? undefined, confidence: r.confidence, y: r.y, estimate });
      } else if (read && held) {
        state = {
          ...failed(state, now, "jump", { level: read.level, confidence: r.confidence, y: r.y, estimate }),
          held: read,
        };
      } else if (read) {
        const taken = { t: read.t, level: read.level, confidence: r.confidence };
        await addReading({ ...taken, y: r.y ?? undefined, ...(estimate && { estimate }) });
        const reading: ReadingInput = isBound(estimate) ? { ...taken, bound: true } : taken;
        const stepped = stepAlert(state.alert, reading, config.thresholds);
        events = stepped.events;
        state = {
          ...state,
          alert: stepped.state,
          lastRead: { t: cap.capturedAt, ok: true, level: read.level, confidence: r.confidence, reason: r.reason, y: r.y, estimate },
          lastSuccessAt: cap.capturedAt,
          failingSince: null,
          failureStreak: 0,
          lastGood: read,
          held: null,
        };
        if (events.length) await logEvents(events);
      } else {
        state = failed(state, now, r.reason ?? "unreadable");
      }
    } catch (e) {
      error = (e as Error).message;
      state = failed(state, now, "capture-failed");
    }

    // A lost gauge already sent its own notice; this one is for a camera that cannot be read at all.
    if (state.failureStreak === CAMERA_DOWN_NOTICE_AFTER && state.tracking.status !== "lost") {
      notices.push({ kind: "camera-down", since: state.failingSince ?? now, reason: state.lastRead?.reason ?? null });
    }

    // A calibration saved while this round ran is drawn on the camera as it is now; this round's
    // position and any reference it learned belong to the old one.
    const savedMeanwhile = await getConfig();
    if (savedMeanwhile.calibration !== config.calibration) {
      state = { ...state, tracking: { ...INITIAL_TRACKING, since: now } };
      await setGaugeRefs([]);
    }

    await setState(state);
    await notify({ origin, now, state, events, notices, thresholds: config.thresholds, sent, send: deps.send });
    // Thresholds saved while this round ran: the states it just wrote follow the old ones.
    if (JSON.stringify(savedMeanwhile.thresholds) !== JSON.stringify(config.thresholds)) {
      await resyncAlerts(savedMeanwhile.thresholds, now);
    }

    return {
      ok: !error,
      reading: readingInfo,
      tracking: state.tracking,
      error,
      status: state.alert.status,
      events,
      sent,
      ms: Date.now() - started,
    };
  } finally {
    await kv().del(KEYS.tickLock);
  }
}

/**
 * Find the gauge in this capture (following a moved camera), then read it there. `gauge` is the
 * calibration as it was read, kept with the picture so a label on it can be read the same way.
 */
async function readTracked(cap: Capture, config: SiteConfig, state: SiteState, now: number) {
  const refs = config.autoTrack ? await getGaugeRefs() : [];
  const frame = cap.frames[Math.floor(cap.frames.length / 2)];
  const prev = state.tracking;
  const dark = frameMeanLuma(frame) < DARK_LUMA;
  // Flood water over the reference patch is not part of the scene to match.
  const lastY = state.lastRead?.ok ? state.lastRead.y : null;
  const maskBelowY = lastY != null ? toCalibratedY(config.gauge, prev.transform, lastY) : undefined;
  const result = config.autoTrack && refs.length && !dark ? track(frame, refs, { maskBelowY, at: prev.transform }) : null;
  const lumaNow = () => makeReference(frame, config.gauge, prev.transform).meanLuma;

  let readAt: Transform = prev.transform;
  const decision = decideTracking(prev, result, { auto: config.autoTrack, refs, lumaNow, now }, (t) => {
    readAt = t; // once a round, whichever way the tracker decides
    return readGauge(cap.frames, applyTransform(config.gauge, t), config.reader.params);
  });
  // A patch cut off by the frame edge would be stored with a black band; wait for a better round.
  if (decision.learn && patchFits(config.gauge, decision.learn)) {
    const learned = makeReference(frame, config.gauge, decision.learn, cap.capturedAt);
    await setGaugeRefs([...refs, learned].slice(-MAX_REFS));
  }
  return { ...decision, gauge: applyTransform(config.gauge, readAt) };
}

/** `read` keeps what the reader saw when the level was refused rather than unreadable. */
function failed(state: SiteState, now: number, reason: string, read: Omit<LastRead, "t" | "ok" | "reason"> = {}): SiteState {
  return {
    ...state,
    lastRead: { t: now, ok: false, reason, ...read },
    failingSince: state.failingSince ?? now,
    failureStreak: state.failureStreak + 1,
  };
}

async function notify(round: {
  origin: string;
  now: number;
  state: SiteState;
  events: AlertEvent[];
  notices: SystemNotice[];
  thresholds: Thresholds;
  sent: TickResult["sent"];
  send: TickDeps["send"];
}) {
  const { origin, now, state, thresholds, sent } = round;
  const subs = await allSubscribers();
  if (!subs.length) return;

  const [readings, snap] = await Promise.all([readingsSince(now - 26 * HOUR), getSnapshotMeta()]);
  const summary = summarize(readings, now);
  const snapshotUrl = snapshotImage(snap, now);
  const stale = state.lastSuccessAt === null || now - state.lastSuccessAt > STALE_AFTER_MS;
  const digest = digestMessage(summary, state.alert.status, thresholds, { lastFailureAt: state.failingSince, stale, snapshotUrl });
  const system = round.notices.map(systemMessage);

  type Job = { sub: Subscriber; msg: PushMessage; kind: "alerts" | "reminders" | "digests" | "system" };
  const jobs: Job[] = [];
  const updates = new Map<string, RoundUpdate>();
  const update = (sub: Subscriber, patch: Omit<RoundUpdate, "id">) =>
    updates.set(sub.id, { ...(updates.get(sub.id) ?? { id: sub.id }), ...patch });
  // Every device hears once when the water reaches watch or danger, and when it falls back.
  // Climbing further in danger is left to the reminders.
  const alerts = round.events
    .filter((e) => e.kind !== "rising")
    .map((e) => {
      const estimate = summary.latest?.t === e.t ? summary.latest.estimate : undefined;
      return alertMessage(e, thresholds, { snapshotUrl, trend: summary.trendCmPerHour, estimate });
    });
  const status = state.alert.status;
  for (const sub of subs) {
    for (const msg of alerts) jobs.push({ sub, kind: "alerts", msg });
    let reminded = false;
    if (alerts.length) update(sub, { lastAlertAt: now });
    else if (status !== "normal" && summary.latest) {
      const repeat = repeatOf(sub);
      // A device that subscribed with the water already up hears after a full interval, not straight away.
      const lastAlertAt = Math.max(sub.lastAlertAt ?? 0, state.alert.since, sub.createdAt);
      if (isReminderDue({ status, repeat, quiet: sub.digest.quiet, lastAlertAt, now })) {
        // While the camera is down this is the last level read, with its age.
        const msg = reminderMessage(status, summary.latest, thresholds, {
          everyMin: repeat[status],
          trend: summary.trendCmPerHour,
          stale,
          lastFailureAt: state.failingSince,
          snapshotUrl,
        });
        jobs.push({ sub, kind: "reminders", msg });
        update(sub, { lastAlertAt: now });
        reminded = true;
      }
    }
    if (isDigestDue(sub.digest, sub.lastDigestAt, now)) {
      // An alert or reminder in the same round already carries the level; mark the slot as served.
      if (!alerts.length && !reminded) jobs.push({ sub, kind: "digests", msg: digest });
      update(sub, { lastDigestAt: now });
    }
    if (sub.admin) for (const msg of system) jobs.push({ sub, kind: "system", msg });
  }

  const gone = new Set<string>();
  await mapLimit(jobs, 20, async (job) => {
    const res = await round.send(job.sub.target, job.msg, origin);
    if (res.ok) sent[job.kind]++;
    else {
      sent.failed++;
      if (res.gone) gone.add(job.sub.id);
    }
  });

  if (gone.size) {
    await removeSubscribers([...gone]);
    sent.removed = gone.size;
  }
  await applyRoundUpdates([...updates.values()].filter((u) => !gone.has(u.id)));
}
