// Reminders while the water stays at or over a device's alert point.

import { rank, type AlertPreference, type Status } from "./alerts";
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
 * Whether a device still at `status` should hear again. `lastAlertAt` is the later of the last
 * alert or reminder it was sent and the moment it reached `status`. Quiet hours hold back watch
 * reminders only; danger ones always go.
 */
export function isReminderDue(o: {
  status: Status;
  alerts: AlertPreference;
  repeat: RepeatPref;
  quiet: DigestPref["quiet"];
  lastAlertAt: number;
  now: number;
}): boolean {
  if (o.status === "normal" || o.alerts === "off" || rank(o.status) < rank(o.alerts)) return false;
  const minutes = o.repeat[o.status];
  if (!minutes) return false;
  if (o.status === "watch" && inQuietHours(bangkokHour(o.now), o.quiet)) return false;
  return o.now - o.lastAlertAt >= minutes * 60 * 1000 - SLACK_MS;
}
