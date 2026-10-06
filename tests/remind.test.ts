import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS as TH } from "@/lib/alerts";
import { reminderMessage } from "@/lib/messages";
import { DEFAULT_REPEAT, isReminderDue } from "@/lib/remind";
import { sanitizeRepeat } from "@/lib/store";

// Bangkok local time helper: bkk("2026-10-04 07:05") -> UTC ms
const bkk = (s: string) => Date.parse(s.replace(" ", "T") + ":00+07:00");
const MIN = 60_000;

describe("isReminderDue", () => {
  const base = {
    status: "watch" as const,
    alerts: "watch" as const,
    repeat: DEFAULT_REPEAT,
    quiet: null,
    lastAlertAt: bkk("2026-10-05 07:20"),
  };

  it("repeats watch every third round and danger every round by default", () => {
    expect(isReminderDue({ ...base, now: bkk("2026-10-05 07:40") })).toBe(false);
    expect(isReminderDue({ ...base, now: bkk("2026-10-05 07:50") })).toBe(true);
    const danger = { ...base, status: "danger" as const };
    expect(isReminderDue({ ...danger, now: bkk("2026-10-05 07:30") })).toBe(true);
  });

  it("allows for a round that runs a little early", () => {
    expect(isReminderDue({ ...base, now: bkk("2026-10-05 07:50") - 90_000 })).toBe(true);
    expect(isReminderDue({ ...base, status: "danger", now: bkk("2026-10-05 07:30") - 2 * MIN })).toBe(true);
  });

  it("never repeats at the normal level", () => {
    expect(isReminderDue({ ...base, status: "normal", now: bkk("2026-10-05 12:00") })).toBe(false);
  });

  it("follows the level the device asked to be alerted from", () => {
    const later = bkk("2026-10-05 09:00");
    expect(isReminderDue({ ...base, alerts: "danger", now: later })).toBe(false);
    expect(isReminderDue({ ...base, alerts: "danger", status: "danger", now: later })).toBe(true);
    expect(isReminderDue({ ...base, alerts: "off", status: "danger", now: later })).toBe(false);
  });

  it("uses the chosen interval, and 0 turns a level off", () => {
    const repeat = { watch: 120, danger: 0 };
    expect(isReminderDue({ ...base, repeat, now: bkk("2026-10-05 09:00") })).toBe(false);
    expect(isReminderDue({ ...base, repeat, now: bkk("2026-10-05 09:20") })).toBe(true);
    expect(isReminderDue({ ...base, repeat, status: "danger", now: bkk("2026-10-05 12:00") })).toBe(false);
  });

  it("keeps watch reminders out of quiet hours, but never danger ones", () => {
    const night = { ...base, quiet: { start: 22, end: 6 }, lastAlertAt: bkk("2026-10-05 22:00") };
    expect(isReminderDue({ ...night, now: bkk("2026-10-05 23:00") })).toBe(false);
    expect(isReminderDue({ ...night, now: bkk("2026-10-06 06:00") })).toBe(true);
    expect(isReminderDue({ ...night, status: "danger", now: bkk("2026-10-05 23:00") })).toBe(true);
  });
});

describe("sanitizeRepeat", () => {
  it("keeps only the offered intervals for each level", () => {
    expect(sanitizeRepeat({ watch: 120, danger: 0 })).toEqual({ watch: 120, danger: 0 });
    expect(sanitizeRepeat({ watch: 15, danger: 120 })).toEqual(DEFAULT_REPEAT);
    expect(sanitizeRepeat({ watch: "30" as unknown as number })).toEqual(DEFAULT_REPEAT);
  });

  it("falls back per level to the device's current setting", () => {
    expect(sanitizeRepeat({ danger: 30 }, { watch: 60, danger: 0 })).toEqual({ watch: 60, danger: 30 });
    expect(sanitizeRepeat(undefined, { watch: 0, danger: 60 })).toEqual({ watch: 0, danger: 60 });
    expect(sanitizeRepeat(undefined)).toEqual(DEFAULT_REPEAT);
  });
});

describe("reminderMessage", () => {
  // Site thresholds: watch 2.20, danger 2.50.
  const at = bkk("2026-10-05 08:40");
  const reading = (level: number, t = at) => ({ t, level, confidence: "high" as const });
  const fresh = { trend: 4, stale: false, lastFailureAt: null };

  it("says the water is still in danger, how far over, and how often it will repeat", () => {
    const m = reminderMessage("danger", reading(2.62), TH, { ...fresh, everyMin: 10 });
    expect(m.title).toBe("ยังอยู่ระดับอันตราย: น้ำท่าน้ำนนท์เกินเกณฑ์ 12 ซม.");
    expect(m.body).toBe("ขึ้น 4 ซม./ชม. · อ่านเมื่อ 08:40 น. · เตือนซ้ำทุก 10 นาที ปรับหรือปิดได้ในหน้าเว็บ");
    expect(m).toEqual(expect.objectContaining({ tag: "alert", urgency: "high", ttl: 600, requireInteraction: true }));
  });

  it("at watch also gives the distance to danger, and does not stay on screen", () => {
    const m = reminderMessage("watch", reading(2.28), TH, { ...fresh, everyMin: 60 });
    expect(m.title).toBe("ยังอยู่ระดับเฝ้าระวัง: น้ำท่าน้ำนนท์เกินเกณฑ์ 8 ซม.");
    expect(m.body).toContain("อีก 22 ซม. ถึงระดับอันตราย");
    expect(m.body).toContain("เตือนซ้ำทุก 1 ชั่วโมง");
    expect(m.ttl).toBe(3600);
    expect(m.requireInteraction).toBe(false);
  });

  it("with an early alert point, says how far the site threshold still is", () => {
    const m = reminderMessage("watch", reading(2.12), TH, { ...fresh, everyMin: 30, offsetCm: -20 });
    expect(m.title).toBe("ยังใกล้ระดับเฝ้าระวัง: น้ำท่าน้ำนนท์อีก 8 ซม.");
    expect(m.body).toContain("จุดเตือนของคุณ: ก่อนถึงเกณฑ์ 20 ซม.");
  });

  it("never says watch while the water is over danger (unconfirmed rise, or a late alert point)", () => {
    const m = reminderMessage("watch", reading(2.53), TH, { ...fresh, everyMin: 30, offsetCm: 30 });
    expect(m.title).toBe("น้ำท่าน้ำนนท์สูงกว่าระดับอันตราย 3 ซม.");
    expect(m.body).not.toContain("สูงกว่าระดับอันตราย");
  });

  it("says when the camera stopped and how old the level is", () => {
    const m = reminderMessage("danger", reading(2.55, bkk("2026-10-05 10:10")), TH, {
      trend: null,
      stale: true,
      lastFailureAt: bkk("2026-10-05 10:20"),
      everyMin: 10,
    });
    expect(m.body).toContain("กล้องไม่ตอบสนองตั้งแต่ 10:20 น. ค่านี้อ่านเมื่อ 10:10 น.");
  });
});
