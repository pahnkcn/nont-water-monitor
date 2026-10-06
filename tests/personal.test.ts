import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS as TH,
  INITIAL_ALERT_STATE,
  firstOffsetAhead,
  initialPersonalState,
  personalThresholds,
  pointAhead,
  stepAlert,
  type AlertEvent,
  type AlertState,
} from "@/lib/alerts";
import { alertMessage } from "@/lib/messages";
import { sanitizeOffset } from "@/lib/store";

// Site thresholds: watch 2.20, danger 2.50, hysteresis 5 cm.

function run(levels: number[], offsetCm: number, start: AlertState = INITIAL_ALERT_STATE) {
  const th = personalThresholds(TH, offsetCm);
  let state = start;
  const events: (AlertEvent & { i: number })[] = [];
  levels.forEach((level, i) => {
    const out = stepAlert(state, { t: i, level, confidence: "high" }, th);
    state = out.state;
    events.push(...out.events.map((e) => ({ ...e, i })));
  });
  return { events, state };
}

const rising = [1.9, 1.95, 2.0, 2.05, 2.1, 2.15, 2.2, 2.25, 2.3, 2.35, 2.4, 2.45];

describe("personal alert point", () => {
  it("at the threshold, alerts exactly where the site does", () => {
    expect(run(rising, 0).events.map((e) => e.i)).toEqual([6]); // 2.20
  });

  it("20 cm early alerts when the water is 20 cm below watch", () => {
    const { events } = run(rising, -20);
    expect(events[0]).toEqual(expect.objectContaining({ i: 2, kind: "escalate", to: "watch" })); // 2.00
    expect(events[1]).toEqual(expect.objectContaining({ i: 8, kind: "escalate", to: "danger" })); // 2.30, 20 cm before danger
  });

  it("20 cm late alerts only once the water is 20 cm over watch", () => {
    expect(run(rising, 20).events).toEqual([expect.objectContaining({ i: 10, kind: "escalate", to: "watch" })]); // 2.40
  });

  it("moves danger by the same amount", () => {
    expect(personalThresholds(TH, -30)).toEqual({ ...TH, watch: 1.9, danger: 2.2 });
  });

  it("starts from where the water already is, so changing the setting sends nothing by itself", () => {
    const th = personalThresholds(TH, -20);
    const start = initialPersonalState(2.05, th, 0);
    expect(start.status).toBe("watch");
    expect(run([2.06, 2.08], -20, start).events).toEqual([]);
    expect(initialPersonalState(1.9, th, 0).status).toBe("normal");
    expect(initialPersonalState(null, th, 0).status).toBe("normal");
  });

  it("accepts only the offered offsets", () => {
    expect(sanitizeOffset(-20)).toBe(-20);
    expect(sanitizeOffset(30)).toBe(30);
    expect(sanitizeOffset(15)).toBe(0);
    expect(sanitizeOffset("-20")).toBe(0);
    expect(sanitizeOffset(undefined, -10)).toBe(-10);
  });
});

describe("picking an alert point the water has not reached", () => {
  it("allows only points above the current level", () => {
    // Water at 2.05: watch -20 (2.00) is passed, watch -10 (2.10) is still ahead.
    expect(pointAhead(2.05, TH, "watch", -20)).toBe(false);
    expect(pointAhead(2.05, TH, "watch", -10)).toBe(true);
    expect(pointAhead(2.05, TH, "danger", -30)).toBe(true); // 2.20
  });

  it("treats a point the water stands exactly at as passed", () => {
    expect(pointAhead(2.2, TH, "watch", 0)).toBe(false);
    expect(pointAhead(2.19, TH, "watch", 0)).toBe(true);
  });

  it("allows anything with no reading or with alerts off", () => {
    expect(pointAhead(null, TH, "watch", -50)).toBe(true);
    expect(pointAhead(3, TH, "off", -50)).toBe(true);
  });

  it("finds the earliest point still above the water", () => {
    expect(firstOffsetAhead(1.5, TH, "watch")).toBe(-50);
    expect(firstOffsetAhead(2.05, TH, "watch")).toBe(-10);
    expect(firstOffsetAhead(2.3, TH, "danger")).toBe(-10); // 2.40
    expect(firstOffsetAhead(2.5, TH, "watch")).toBeNull(); // watch +30 is 2.50
    expect(firstOffsetAhead(2.79, TH, "danger")).toBe(30);
    expect(firstOffsetAhead(2.8, TH, "danger")).toBeNull();
  });
});

describe("alert wording with a personal alert point", () => {
  const opts = { trend: null };
  const escalate = (level: number) => ({ kind: "escalate" as const, from: "normal" as const, to: "watch" as const, level, t: 0 });

  it("says how far the water still is from the real threshold when alerting early", () => {
    const m = alertMessage(escalate(2.0), TH, { ...opts, offsetCm: -20 });
    expect(m.title).toBe("ใกล้ระดับเฝ้าระวัง: น้ำท่าน้ำนนท์อีก 20 ซม.");
    expect(m.body).toContain("จุดเตือนของคุณ: ก่อนถึงเกณฑ์ 20 ซม.");
  });

  it("says how far over the threshold the water is when alerting late", () => {
    const m = alertMessage(escalate(2.41), TH, { ...opts, offsetCm: 20 });
    expect(m.title).toBe("เฝ้าระวัง: น้ำท่าน้ำนนท์เกินเกณฑ์ 21 ซม.");
    expect(m.body).toContain("จุดเตือนของคุณ: เกินเกณฑ์ 20 ซม.");
  });

  it("does not claim the site level was left when only the personal point was", () => {
    const m = alertMessage({ kind: "clear", from: "watch", to: "normal", level: 1.93, t: 0 }, TH, { ...opts, offsetCm: -20 });
    expect(m.title).toBe("น้ำลดต่ำกว่าจุดเตือนเฝ้าระวังของคุณ");
    expect(m.body).toContain("อีก 27 ซม. ถึงระดับเฝ้าระวัง");
  });

  it("keeps the plain wording at the threshold", () => {
    expect(alertMessage(escalate(2.21), TH, { ...opts, offsetCm: 0 }).title).toBe("เฝ้าระวัง: น้ำท่าน้ำนนท์เกินเกณฑ์ 1 ซม.");
    expect(
      alertMessage({ kind: "clear", from: "watch", to: "normal", level: 2.12, t: 0 }, TH, { ...opts, offsetCm: 0 }).title,
    ).toBe("กลับสู่ระดับปกติ");
  });
});
