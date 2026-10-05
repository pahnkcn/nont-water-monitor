// Routine update schedule. Thailand has no daylight saving, so local time is UTC+7.

export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type DigestEvery = "off" | "1h" | "3h" | "6h" | "daily";

export type DigestPref = {
  every: DigestEvery;
  /** Local hour 0-23 for "daily". */
  dailyHour: number;
  /** Local hours, end exclusive; wraps past midnight. Routine updates only. */
  quiet: { start: number; end: number } | null;
};

export const DEFAULT_DIGEST: DigestPref = {
  every: "daily",
  dailyHour: 7,
  quiet: { start: 22, end: 6 },
};

/** A slot is sent at most once, and only within this window after it starts. */
const SEND_WINDOW_MS = HOUR;

export function bangkokHour(t: number) {
  return new Date(t + BANGKOK_OFFSET_MS).getUTCHours();
}

export function inQuietHours(hour: number, quiet: DigestPref["quiet"]) {
  if (!quiet || quiet.start === quiet.end) return false;
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

/** Start (UTC ms) of the most recent slot at or before `now`, or null when updates are off. */
export function currentSlot(pref: DigestPref, now: number): number | null {
  const local = now + BANGKOK_OFFSET_MS;
  const localDayStart = Math.floor(local / DAY) * DAY;
  switch (pref.every) {
    case "off":
      return null;
    case "1h":
    case "3h":
    case "6h": {
      const step = { "1h": 1, "3h": 3, "6h": 6 }[pref.every] * HOUR;
      return localDayStart + Math.floor((local - localDayStart) / step) * step - BANGKOK_OFFSET_MS;
    }
    case "daily": {
      let slot = localDayStart + pref.dailyHour * HOUR;
      if (slot > local) slot -= DAY;
      return slot - BANGKOK_OFFSET_MS;
    }
  }
}

export function isDigestDue(pref: DigestPref, lastSentAt: number | null, now: number): boolean {
  const slot = currentSlot(pref, now);
  if (slot === null) return false;
  if (now - slot >= SEND_WINDOW_MS) return false;
  if (lastSentAt !== null && lastSentAt >= slot) return false;
  return !inQuietHours(bangkokHour(slot), pref.quiet);
}
