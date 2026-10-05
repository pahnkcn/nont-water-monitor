import type { AlertEvent, Status, Thresholds } from "./alerts";
import { STATUS_LABEL, cmBetween, formatGap, formatTime, formatTrend } from "./format";
import type { Summary } from "./summary";

export type PushMessage = {
  title: string;
  body: string;
  /** Same tag replaces the previous notification on the device. */
  tag: "alert" | "digest" | "test";
  url: string;
  image?: string;
  requireInteraction?: boolean;
  /** Push service hints. */
  urgency: "very-low" | "low" | "normal" | "high";
  ttl: number;
};

const PLACE = "ท่าน้ำนนท์";

export function alertMessage(e: AlertEvent, th: Thresholds, opts: { snapshotUrl?: string; trend: number | null }): PushMessage {
  const trend = formatTrend(opts.trend);
  const at = `อ่านเมื่อ ${formatTime(e.t)}`;
  const base = { tag: "alert" as const, url: "/", urgency: "high" as const, ttl: 60 * 60, image: opts.snapshotUrl };
  switch (e.kind) {
    case "escalate": {
      const over = cmBetween(e.level, e.to === "danger" ? th.danger : th.watch);
      return {
        ...base,
        title: `${STATUS_LABEL[e.to]}: น้ำ${PLACE}${over ? `เกินเกณฑ์ ${over} ซม.` : "ถึงเกณฑ์แล้ว"}`,
        body: [e.to === "watch" ? formatGap(e.level, th) : null, trend, at].filter(Boolean).join(" · "),
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
        body: [e.to === "normal" ? formatGap(e.level, th) : `ยังอยู่ในระดับ${STATUS_LABEL[e.to]}`, trend, at]
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
