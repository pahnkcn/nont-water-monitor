import type { AlertEvent, Status, Thresholds } from "./alerts";
import type { TrackingNotice } from "./autotrack";
import { REASON_LABEL, STATUS_LABEL, cmBetween, describeMove, formatGap, formatOffset, formatTime, formatTrend } from "./format";
import type { Summary } from "./summary";

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

/**
 * `e` comes from the subscriber's own alert point (site thresholds moved by `offsetCm`),
 * but every distance in the text is measured against the site thresholds in `th`.
 */
export function alertMessage(
  e: AlertEvent,
  th: Thresholds,
  opts: { snapshotUrl?: string; trend: number | null; offsetCm?: number },
): PushMessage {
  const offsetCm = opts.offsetCm ?? 0;
  const trend = formatTrend(opts.trend);
  const at = `อ่านเมื่อ ${formatTime(e.t)}`;
  const mine = offsetCm ? `จุดเตือนของคุณ: ${formatOffset(offsetCm)}` : null;
  const base = { tag: "alert" as const, url: "/", urgency: "high" as const, ttl: 60 * 60, image: opts.snapshotUrl };
  switch (e.kind) {
    case "escalate": {
      const limit = e.to === "danger" ? th.danger : th.watch;
      const cm = cmBetween(e.level, limit);
      const reached = e.level >= limit - 0.005;
      return {
        ...base,
        title: reached
          ? `${STATUS_LABEL[e.to]}: น้ำ${PLACE}${cm ? `เกินเกณฑ์ ${cm} ซม.` : "ถึงเกณฑ์แล้ว"}`
          : `ใกล้ระดับ${STATUS_LABEL[e.to]}: น้ำ${PLACE}อีก ${cm} ซม.`,
        body: [reached && e.to === "watch" ? formatGap(e.level, th) : null, mine, trend, at].filter(Boolean).join(" · "),
        requireInteraction: e.to === "danger",
      };
    }
    case "rising":
      return {
        ...base,
        title: `น้ำยังสูงขึ้น: ${formatGap(e.level, th)}`,
        body: [`สูงขึ้น ${cmBetween(e.level, e.previous)} ซม. จากการเตือนครั้งก่อน`, mine, trend, at].filter(Boolean).join(" · "),
        requireInteraction: true,
      };
    case "clear":
      return {
        ...base,
        urgency: "normal",
        // With a personal point the site level may never have been reached, so name the point instead.
        title: offsetCm
          ? `น้ำลดต่ำกว่าจุดเตือน${STATUS_LABEL[e.from]}ของคุณ`
          : e.to === "normal"
            ? "กลับสู่ระดับปกติ"
            : `พ้นระดับ${STATUS_LABEL[e.from]}`,
        body: [offsetCm || e.to === "normal" ? formatGap(e.level, th) : `ยังอยู่ในระดับ${STATUS_LABEL[e.to]}`, trend, at]
          .filter(Boolean)
          .join(" · "),
      };
  }
}

export function digestMessage(
  summary: Summary,
  status: Status,
  th: Thresholds,
  opts: { lastFailureAt: number | null; stale: boolean },
): PushMessage {
  const base = { tag: "digest" as const, url: "/", urgency: "low" as const, ttl: 30 * 60 };
  const latest = summary.latest;
  if (!latest) {
    return { ...base, title: `ระดับน้ำ${PLACE}`, body: "ยังไม่มีค่าที่อ่านได้จากกล้อง" };
  }
  const high = summary.todayHigh;
  const parts = [
    formatGap(latest.level, th),
    formatTrend(summary.trendCmPerHour),
    high ? `สูงสุดวันนี้ ${formatGap(high.level, th)} (${formatTime(high.t)})` : null,
    opts.stale && opts.lastFailureAt
      ? `กล้องไม่ตอบสนองตั้งแต่ ${formatTime(opts.lastFailureAt)} ค่านี้อ่านเมื่อ ${formatTime(latest.t)}`
      : `อ่านเมื่อ ${formatTime(latest.t)}`,
  ];
  return {
    ...base,
    title: `น้ำ${PLACE} · ${STATUS_LABEL[status]}`,
    body: parts.filter(Boolean).join(" · "),
  };
}

export function testMessage(summary: Summary, status: Status, th: Thresholds): PushMessage {
  const latest = summary.latest;
  return {
    title: "การแจ้งเตือนใช้งานได้",
    body: latest
      ? `ตอนนี้น้ำ${PLACE} ${STATUS_LABEL[status]} · ${formatGap(latest.level, th)} · อ่านเมื่อ ${formatTime(latest.t)}`
      : "เครื่องนี้จะได้รับข่าวระดับน้ำตามรอบที่เลือก",
    tag: "test",
    url: "/",
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
