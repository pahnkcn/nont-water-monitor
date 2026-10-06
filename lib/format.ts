import type { Status, Thresholds } from "./alerts";
import type { Transform } from "./track";

export const STATUS_LABEL: Record<Status, string> = {
  normal: "ปกติ",
  watch: "เฝ้าระวัง",
  danger: "อันตราย",
};

/** Why a round could not be read, for the admin page and admin notices. */
export const REASON_LABEL: Record<string, string> = {
  dark: "ภาพมืด",
  "capture-failed": "ดึงภาพจากสตรีมไม่ได้",
  "no-frames": "ไม่ได้ภาพจากกล้อง",
  "gauge-not-visible": "มองไม่เห็นหน้าไม้วัด",
  "gauge-lost": "หาไม้วัดในภาพไม่เจอ",
  "frames-disagree": "ภาพแต่ละเฟรมไม่ตรงกัน",
  "weak-edge": "ขอบผิวน้ำไม่ชัด",
  "camera-moved": "กล้องเพิ่งขยับ รอยืนยัน",
  unreadable: "อ่านค่าไม่ได้",
};

// Levels are never shown as metres. Only the top of the staff gauge is in view and the meter
// digit at the plate joint is unreadable, so "1.35" could really be 2.35. The distance between
// two marks on the gauge is exact, so the public reading is centimetres to a threshold.

export type Gap = {
  cm: number;
  /** The threshold the distance is measured to. */
  target: "watch" | "danger";
  /** True once the water is at or over danger; cm then counts how far over. */
  over: boolean;
};

/** Distance from a level to the next threshold above it, or past danger. */
export function thresholdGap(level: number, th: Pick<Thresholds, "watch" | "danger">): Gap {
  if (level >= th.danger) return { cm: Math.round((level - th.danger) * 100), target: "danger", over: true };
  const target = level < th.watch ? "watch" : "danger";
  // Never "0 cm to go" while still below the line.
  return { cm: Math.max(1, Math.round((th[target] - level) * 100)), target, over: false };
}

/** "อีก 85 ซม. ถึงระดับเฝ้าระวัง" / "สูงกว่าระดับอันตราย 12 ซม." */
export function formatGap(level: number, th: Pick<Thresholds, "watch" | "danger">) {
  const g = thresholdGap(level, th);
  if (g.over) return g.cm ? `สูงกว่าระดับอันตราย ${g.cm} ซม.` : "ถึงระดับอันตรายแล้ว";
  return `อีก ${g.cm} ซม. ถึงระดับ${STATUS_LABEL[g.target]}`;
}

/** A personal alert point: "ก่อนถึงเกณฑ์ 20 ซม." / "เกินเกณฑ์ 20 ซม." / "ตรงเกณฑ์". */
export function formatOffset(offsetCm: number) {
  if (offsetCm < 0) return `ก่อนถึงเกณฑ์ ${-offsetCm} ซม.`;
  return offsetCm > 0 ? `เกินเกณฑ์ ${offsetCm} ซม.` : "ตรงเกณฑ์";
}

/** "ภาพเลื่อนขวา 18 พิกเซล ขึ้น 12 พิกเซล ซูมเข้า 8%", or null when it rounds to no move. */
export function describeMove(from: Transform, to: Transform) {
  const parts: string[] = [];
  const dx = Math.round(to.dx - from.dx);
  const dy = Math.round(to.dy - from.dy);
  const zoom = Math.round((to.scale / from.scale - 1) * 100);
  if (dx) parts.push(`${dx > 0 ? "ขวา" : "ซ้าย"} ${Math.abs(dx)} พิกเซล`);
  if (dy) parts.push(`${dy > 0 ? "ลง" : "ขึ้น"} ${Math.abs(dy)} พิกเซล`);
  if (zoom) parts.push(`${zoom > 0 ? "ซูมเข้า" : "ซูมออก"} ${Math.abs(zoom)}%`);
  return parts.length ? `ภาพเลื่อน${parts.join(" ")}` : null;
}

/** Whole centimetres between two levels; exact on the gauge even when the meter digit is not. */
export function cmBetween(a: number, b: number) {
  return Math.round(Math.abs(a - b) * 100);
}

// Pinned to Bangkok so the server render and every visitor's browser show the same clock.
const TIME = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });

/** "23:10 น." in Bangkok time. */
export function formatTime(t: number) {
  return `${TIME.format(t)} น.`;
}

/** "4 ต.ค. 23:10 น." in Bangkok time. */
export function formatDateTime(t: number) {
  return `${DAY.format(t)} ${formatTime(t)}`;
}

export function formatTrend(cmPerHour: number | null) {
  if (cmPerHour === null) return null;
  if (Math.abs(cmPerHour) < 2) return "ทรงตัว";
  return cmPerHour > 0 ? `ขึ้น ${cmPerHour} ซม./ชม.` : `ลง ${Math.abs(cmPerHour)} ซม./ชม.`;
}
