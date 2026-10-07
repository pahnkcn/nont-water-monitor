import { describe, expect, it } from "vitest";
import { judgeJump } from "@/lib/jump";

const MIN = 60 * 1000;
const at = (min: number, level: number, calibration = 0) => ({ t: Date.parse("2026-10-06T11:00:00+07:00") + min * MIN, level, calibration });

// The production rounds of 2026-10-06: something crossed the gauge at 12:00 and 12:10.
const morning = at(54, 0.83);

describe("judgeJump", () => {
  it("holds back a reading the river could not have reached since the last one", () => {
    expect(judgeJump(at(60, 2.54), morning, null)).toBe("hold");
  });

  it("keeps holding when the next round neither matches the last level nor the held one", () => {
    // 43 cm above 11:54 in 16 minutes, and nowhere near the 2.54 held at 12:00
    expect(judgeJump(at(70, 1.26), morning, at(60, 2.54))).toBe("hold");
  });

  it("accepts the tide moving at its usual pace", () => {
    expect(judgeJump(at(80, 0.89), morning, at(70, 1.26))).toBe("accept");
    expect(judgeJump(at(130, 0.95), at(120, 0.92), null)).toBe("accept");
  });

  it("confirms a big move once a second round agrees with the held one", () => {
    expect(judgeJump(at(70, 1.42), at(50, 0.9), at(60, 1.4))).toBe("confirm");
  });

  it("does not compare across a new calibration", () => {
    expect(judgeJump(at(60, 1.83, 1), at(50, 0.83, 0), null)).toBe("accept");
    expect(judgeJump(at(70, 1.42, 1), at(50, 0.83, 1), at(60, 1.4, 0))).toBe("hold");
  });

  it("allows more change the longer the camera was away", () => {
    // five hours down: up to 0.1 + 0.4 * 5 = 2.1 m
    expect(judgeJump(at(360, 2.3), at(60, 0.83), null)).toBe("accept");
  });

  // The live site on 2026-10-07: water hyacinth hid the water under 0.89 m until 09:30, then the
  // river showed at 0.72 m at 09:40 and was held back as a 17 cm drop in ten minutes.
  const bkk = (s: string, level: number, bound = false) => ({
    t: Date.parse(`2026-10-07T${s}:00+07:00`),
    level,
    calibration: 0,
    ...(bound && { bound }),
  });

  it("takes water anywhere under a level that was only the most it could be", () => {
    expect(judgeJump(bkk("09:40", 0.72), bkk("09:30", 0.89, true), null)).toBe("accept");
    expect(judgeJump(bkk("09:40", 0.4), bkk("09:30", 0.89, true), null)).toBe("accept");
    expect(judgeJump(bkk("09:40", 0.6, true), bkk("09:30", 0.89, true), null)).toBe("accept");
  });

  it("still holds water out of reach above such a level", () => {
    expect(judgeJump(bkk("09:40", 1.2), bkk("09:30", 0.89, true), null)).toBe("hold");
  });

  it("holds a ceiling far under the last level, and confirms it under a held one", () => {
    // 07:48: plants hid the water under 0.95 m while the last level was the 2.13 m misread at 07:40
    expect(judgeJump(bkk("07:48", 0.95, true), bkk("07:40", 2.13), null)).toBe("hold");
    expect(judgeJump(bkk("07:50", 0.97, true), bkk("07:40", 2.13), bkk("07:48", 0.95, true))).toBe("confirm");
    expect(judgeJump(bkk("07:50", 2.5, true), bkk("07:40", 2.13), null)).toBe("accept");
  });

  it("accepts the first reading there is", () => {
    expect(judgeJump(at(60, 2.54), null, null)).toBe("accept");
  });
});
