import { describe, expect, it } from "vitest";
import { currentSlot, inQuietHours, isDigestDue, type DigestPref } from "@/lib/schedule";
import { summarize, type StoredReading } from "@/lib/summary";

// Bangkok local time helper: bkk("2026-10-04 07:05") -> UTC ms
const bkk = (s: string) => Date.parse(s.replace(" ", "T") + ":00+07:00");
const MIN = 60_000;

const hourly: DigestPref = { every: "1h", dailyHour: 7, quiet: null };
const daily7: DigestPref = { every: "daily", dailyHour: 7, quiet: { start: 22, end: 6 } };

describe("quiet hours", () => {
  it("wraps past midnight", () => {
    expect(inQuietHours(23, { start: 22, end: 6 })).toBe(true);
    expect(inQuietHours(3, { start: 22, end: 6 })).toBe(true);
    expect(inQuietHours(6, { start: 22, end: 6 })).toBe(false);
    expect(inQuietHours(12, { start: 22, end: 6 })).toBe(false);
  });

  it("handles a same-day window", () => {
    expect(inQuietHours(13, { start: 12, end: 14 })).toBe(true);
    expect(inQuietHours(14, { start: 12, end: 14 })).toBe(false);
  });
});

describe("currentSlot", () => {
  it("aligns 3-hourly slots to Bangkok midnight", () => {
    expect(currentSlot({ ...hourly, every: "3h" }, bkk("2026-10-04 10:40"))).toBe(bkk("2026-10-04 09:00"));
  });

  it("uses yesterday's slot before today's daily hour", () => {
    expect(currentSlot(daily7, bkk("2026-10-04 06:50"))).toBe(bkk("2026-10-03 07:00"));
    expect(currentSlot(daily7, bkk("2026-10-04 07:00"))).toBe(bkk("2026-10-04 07:00"));
  });
});

describe("isDigestDue", () => {
  it("sends once per hourly slot", () => {
    const now = bkk("2026-10-04 10:02");
    expect(isDigestDue(hourly, bkk("2026-10-04 09:01"), now)).toBe(true);
    expect(isDigestDue(hourly, now, now + 10 * MIN)).toBe(false);
  });

  it("does not send for a brand-new subscriber until the next slot", () => {
    const created = bkk("2026-10-04 10:35");
    expect(isDigestDue(hourly, created, created + 5 * MIN)).toBe(false);
    expect(isDigestDue(hourly, created, bkk("2026-10-04 11:01"))).toBe(true);
  });

  it("sends daily at the chosen hour, with catch-up inside the hour", () => {
    const last = bkk("2026-10-03 07:01");
    expect(isDigestDue(daily7, last, bkk("2026-10-04 06:58"))).toBe(false);
    expect(isDigestDue(daily7, last, bkk("2026-10-04 07:09"))).toBe(true);
    expect(isDigestDue(daily7, last, bkk("2026-10-04 07:55"))).toBe(true);
    expect(isDigestDue(daily7, last, bkk("2026-10-04 08:05"))).toBe(false);
  });

  it("skips slots inside quiet hours", () => {
    const pref: DigestPref = { every: "1h", dailyHour: 7, quiet: { start: 22, end: 6 } };
    expect(isDigestDue(pref, bkk("2026-10-04 01:00"), bkk("2026-10-04 02:03"))).toBe(false);
    expect(isDigestDue(pref, bkk("2026-10-04 05:00"), bkk("2026-10-04 06:03"))).toBe(true);
  });

  it("never sends when off", () => {
    expect(isDigestDue({ ...hourly, every: "off" }, null, bkk("2026-10-04 10:02"))).toBe(false);
  });
});

describe("summarize", () => {
  const r = (t: string, level: number): StoredReading => ({ t: bkk(t), level, confidence: "high" });

  it("computes trend over about an hour and today's high and low", () => {
    const readings = [
      r("2026-10-03 23:50", 1.9),
      r("2026-10-04 05:00", 1.2),
      r("2026-10-04 05:10", 1.24),
      r("2026-10-04 06:00", 1.3),
      r("2026-10-04 06:10", 1.34),
    ];
    const s = summarize(readings, bkk("2026-10-04 06:12"));
    expect(s.latest?.level).toBe(1.34);
    expect(s.trendCmPerHour).toBe(10);
    expect(s.todayHigh?.level).toBe(1.34);
    expect(s.todayLow?.level).toBe(1.2);
  });

  it("has no trend without an hour of history", () => {
    const s = summarize([r("2026-10-04 06:00", 1.3), r("2026-10-04 06:10", 1.34)], bkk("2026-10-04 06:12"));
    expect(s.trendCmPerHour).toBeNull();
  });
});
