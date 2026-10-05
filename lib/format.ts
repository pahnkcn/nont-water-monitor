import type { Status, Thresholds } from "./alerts";

export const STATUS_LABEL: Record<Status, string> = {
  normal: "ปกติ",
  watch: "เฝ้าระวัง",
  danger: "อันตราย",
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
