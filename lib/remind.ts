// Reminders while the water stays at watch or danger.

import type { Status } from "./alerts";
import { bangkokHour, inQuietHours, type DigestPref } from "./schedule";

/** Minutes between reminders at each level; 0 sends none. */
export type RepeatPref = { watch: number; danger: number };

/** Rounds run every 10 minutes, so anything finer would not be kept. */
export const REPEAT_CHOICES = {
  watch: [10, 30, 60, 120, 0],
  danger: [10, 30, 60, 0],
} as const satisfies Record<keyof RepeatPref, readonly number[]>;

export const DEFAULT_REPEAT: RepeatPref = { watch: 30, danger: 10 };

/** A round can start a little early; without this a 10-minute reminder would skip every other round. */
const SLACK_MS = 3 * 60 * 1000;

/**
 * Whether a device should hear again while the site stays at `status`. `lastAlertAt` is the
 * latest of the last alert or reminder it was sent, the moment the site reached `status` and when
 * the device subscribed. Quiet hours hold back watch reminders only; danger ones always go.
 */
export function isReminderDue(o: {
  status: Status;
  repeat: RepeatPref;
  quiet: DigestPref["quiet"];
  lastAlertAt: number;
  now: number;
}): boolean {
  if (o.status === "normal") return false;
  const minutes = o.repeat[o.status];
  if (!minutes) return false;
  if (o.status === "watch" && inQuietHours(bangkokHour(o.now), o.quiet)) return false;
  return o.now - o.lastAlertAt >= minutes * 60 * 1000 - SLACK_MS;
}
