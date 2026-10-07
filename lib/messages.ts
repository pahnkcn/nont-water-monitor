import type { AlertEvent, Status, Thresholds } from "./alerts";
import type { TrackingNotice } from "./autotrack";
import { REASON_LABEL, STATUS_LABEL, cmBetween, describeMove, formatEvery, formatGap, formatTime, formatTrend } from "./format";
import type { Estimate, StoredReading, Summary } from "./summary";

export type PushMessage = {
  title: string;
  body: string;
  /** Same tag replaces the previous notification on the device. */
  tag: "alert" | "digest" | "test" | "system";
  url: string;
  image?: string;
  requireInteraction?: boolean;
  /** Push service hints. */
  urgency: "very-low" | "low" | "normal" | "high";
  ttl: number;
};

const PLACE = "ท่าน้ำนนท์";

/** A camera picture older than this no longer shows the river as it is. */
const FRESH_PICTURE_MS = 30 * 60 * 1000;

/** The camera picture to attach to a notification, while it is still current. */
export function snapshotImage(snap: { t: number } | null, now: number): string | undefined {
  return snap && now - snap.t <= FRESH_PICTURE_MS ? `/api/snapshot?t=${snap.t}` : undefined;
}

const reachedLimit = (level: number, limit: number) => level >= limit - 0.005;

/**
 * "อันตราย: น้ำท่าน้ำนนท์เกินเกณฑ์ 12 ซม." once the threshold is reached, otherwise
 * "ใกล้ระดับเฝ้าระวัง: น้ำท่าน้ำนนท์อีก 3 ซม." (held there, within the hysteresis). `still` words it as a reminder.
 */
function levelTitle(status: Status, level: number, th: Thresholds, still = false) {
  const limit = status === "danger" ? th.danger : th.watch;
  const cm = cmBetween(level, limit);
  if (reachedLimit(level, limit)) {
    return `${still ? "ยังอยู่ระดับ" : ""}${STATUS_LABEL[status]}: น้ำ${PLACE}${cm ? `เกินเกณฑ์ ${cm} ซม.` : "ถึงเกณฑ์แล้ว"}`;
  }
  return `${still ? "ยัง" : ""}ใกล้ระดับ${STATUS_LABEL[status]}: น้ำ${PLACE}อีก ${cm} ซม.`;
}

/** When a level was read, and since when the camera has been silent if that level is old. */
function readAt(t: number, stale: boolean, lastFailureAt: number | null) {
  return stale && lastFailureAt
    ? `กล้องไม่ตอบสนองตั้งแต่ ${formatTime(lastFailureAt)} ค่านี้อ่านเมื่อ ${formatTime(t)}`
    : `อ่านเมื่อ ${formatTime(t)}`;
}

export function alertMessage(
  e: AlertEvent,
  th: Thresholds,
  /** `estimate`: how the level of the round that raised `e` was read. */
  opts: { snapshotUrl?: string; trend: number | null; estimate?: Estimate },
): PushMessage {
  const trend = formatTrend(opts.trend);
  const at = `อ่านเมื่อ ${formatTime(e.t)}`;
  const base = { tag: "alert" as const, url: "/", urgency: "high" as const, ttl: 60 * 60, image: opts.snapshotUrl };
  switch (e.kind) {
    case "escalate": {
      const reached = reachedLimit(e.level, e.to === "danger" ? th.danger : th.watch);
      return {
        ...base,
        title: levelTitle(e.to, e.level, th),
        body: [reached && e.to === "watch" ? formatGap(e.level, th) : null, trend, at].filter(Boolean).join(" · "),
        requireInteraction: e.to === "danger",
      };
    }
    case "rising":
      return {
        ...base,
        title: `น้ำยังสูงขึ้น: ${formatGap(e.level, th)}`,
        body: [`สูงขึ้น ${cmBetween(e.level, e.previous)} ซม. จากการเตือนครั้งก่อน`, trend, at].filter(Boolean).join(" · "),
        requireInteraction: true,
      };
    case "clear":
      return {
        ...base,
        urgency: "normal",
        title: e.to === "normal" ? "กลับสู่ระดับปกติ" : `พ้นระดับ${STATUS_LABEL[e.from]}`,
        body: [e.to === "normal" ? formatGap(e.level, th, opts.estimate) : `ยังอยู่ในระดับ${STATUS_LABEL[e.to]}`, trend, at]
          .filter(Boolean)
          .join(" · "),
      };
  }
}

export function digestMessage(
  summary: Summary,
  status: Status,
  th: Thresholds,
  opts: { lastFailureAt: number | null; stale: boolean; snapshotUrl?: string },
): PushMessage {
  const base = { tag: "digest" as const, url: "/", urgency: "low" as const, ttl: 30 * 60, image: opts.snapshotUrl };
  const latest = summary.latest;
  if (!latest) {
    return { ...base, title: `ระดับน้ำ${PLACE}`, body: "ยังไม่มีค่าที่อ่านได้จากกล้อง" };
  }
  const high = summary.todayHigh;
  const parts = [
    formatGap(latest.level, th, latest.estimate),
    formatTrend(summary.trendCmPerHour),
    high ? `สูงสุดวันนี้ ${formatGap(high.level, th, high.estimate)} (${formatTime(high.t)})` : null,
    readAt(latest.t, opts.stale, opts.lastFailureAt),
  ];
  return {
    ...base,
    title: `น้ำ${PLACE} · ${STATUS_LABEL[status]}`,
    body: parts.filter(Boolean).join(" · "),
  };
}

/**
 * Sent again while the site stays at watch or danger. It replaces the alert already on the device
 * and expires before the next one is due.
 */
export function reminderMessage(
  status: "watch" | "danger",
  latest: StoredReading,
  th: Thresholds,
  opts: { everyMin: number; trend: number | null; stale: boolean; lastFailureAt: number | null; snapshotUrl?: string },
): PushMessage {
  const reached = reachedLimit(latest.level, status === "danger" ? th.danger : th.watch);
  // The site can sit at watch with the water over danger (a rise not yet confirmed); "still at
  // watch" would then understate it, so the title gives the level itself.
  const overDanger = status === "watch" && reachedLimit(latest.level, th.danger);
  return {
    title: overDanger ? `น้ำ${PLACE}${formatGap(latest.level, th, latest.estimate)}` : levelTitle(status, latest.level, th, true),
    body: [
      reached && status === "watch" && !overDanger ? formatGap(latest.level, th, latest.estimate) : null,
      formatTrend(opts.trend),
      readAt(latest.t, opts.stale, opts.lastFailureAt),
      `เตือนซ้ำ${formatEvery(opts.everyMin)} ปรับหรือปิดได้ในหน้าเว็บ`,
    ]
      .filter(Boolean)
      .join(" · "),
    tag: "alert",
    url: "/",
    image: opts.snapshotUrl,
    requireInteraction: status === "danger",
    urgency: "high",
    ttl: opts.everyMin * 60,
  };
}

export function testMessage(summary: Summary, status: Status, th: Thresholds, opts: { snapshotUrl?: string } = {}): PushMessage {
  const latest = summary.latest;
  return {
    title: "การแจ้งเตือนใช้งานได้",
    body: latest
      ? `ตอนนี้น้ำ${PLACE} ${STATUS_LABEL[status]} · ${formatGap(latest.level, th, latest.estimate)} · อ่านเมื่อ ${formatTime(latest.t)}`
      : "เครื่องนี้จะได้รับข่าวระดับน้ำตามรอบที่เลือก",
    tag: "test",
    url: "/",
    image: opts.snapshotUrl,
    urgency: "normal",
    ttl: 10 * 60,
  };
}

/** Notices for whoever runs the site, sent only to devices marked as admin. */
export type SystemNotice = TrackingNotice | { kind: "camera-down"; since: number; reason: string | null };

export function systemMessage(n: SystemNotice): PushMessage {
  const base = { tag: "system" as const, url: "/admin", urgency: "normal" as const, ttl: 6 * 60 * 60 };
  switch (n.kind) {
    case "adjusted":
      return {
        ...base,
        title: "ปรับตำแหน่งไม้วัดอัตโนมัติแล้ว",
        body: `กล้องขยับ (${describeMove(n.from, n.to) ?? "เล็กน้อย"}) ระบบอ่านค่าที่ตำแหน่งใหม่แล้ว ตรวจเส้นขีดบนภาพได้ที่หน้าผู้ดูแล`,
      };
    case "lost":
      return {
        ...base,
        title: "หาไม้วัดในภาพไม่เจอ",
        body: `ตั้งแต่ ${formatTime(n.since)} ระบบไม่ใช้ค่าที่อ่านได้เพื่อไม่ให้เตือนผิด กล้องอาจหันไปทางอื่นหรือมีของบัง ตั้งตำแหน่งไม้วัดใหม่ได้ที่หน้าผู้ดูแล`,
      };
    case "camera-down":
      return {
        ...base,
        title: "อ่านค่าจากกล้องไม่ได้ 1 ชั่วโมง",
        body: [`ตั้งแต่ ${formatTime(n.since)}`, n.reason ? `สาเหตุล่าสุด: ${REASON_LABEL[n.reason] ?? n.reason}` : null]
          .filter(Boolean)
          .join(" · "),
      };
  }
}
