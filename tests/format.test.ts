import { describe, expect, it } from "vitest";
import { formatGap, thresholdGap } from "@/lib/format";
import { summarize } from "@/lib/summary";

const th = { watch: 2.2, danger: 2.5 };

describe("distance to a threshold for a level the reader could only estimate", () => {
  it("says 'about' for water read on the shaded foot of the gauge", () => {
    expect(thresholdGap(0.76, th, "approx")).toEqual({ cm: 144, target: "watch", over: false, estimate: "approx" });
    expect(formatGap(0.76, th, "approx")).toBe("อีกประมาณ 144 ซม. ถึงระดับเฝ้าระวัง");
  });

  // No water down to the last row scanned; the real level is lower still.
  it("says 'more than' for water under everything the reader scans", () => {
    expect(thresholdGap(0.74, th, "below")).toEqual({ cm: 146, target: "watch", over: false, estimate: "below" });
    expect(formatGap(0.74, th, "below")).toBe("อีกมากกว่า 146 ซม. ถึงระดับเฝ้าระวัง");
  });

  it("keeps the exact wording for a level read on the gauge", () => {
    expect(formatGap(1.35, th)).toBe("อีก 85 ซม. ถึงระดับเฝ้าระวัง");
    expect(thresholdGap(1.35, th).estimate).toBeUndefined();
  });
});

describe("trend", () => {
  const t0 = Date.parse("2026-10-06T06:00:00+07:00");
  const at = (min: number) => t0 + min * 60_000;

  it("is unknown while the latest reading is pinned under the scanned rows", () => {
    const s = summarize([{ t: at(0), level: 0.8, confidence: "high", estimate: "approx" }, { t: at(60), level: 0.74, confidence: "high", estimate: "below" }], at(60));
    expect(s.trendCmPerHour).toBeNull();
  });

  it("is unknown when the hour-old reading was pinned there", () => {
    const s = summarize([{ t: at(0), level: 0.74, confidence: "high", estimate: "below" }, { t: at(60), level: 0.8, confidence: "high", estimate: "approx" }], at(60));
    expect(s.trendCmPerHour).toBeNull();
  });

  // A clean read just above the shaded foot against an estimate on it mixes two error budgets;
  // so does a reading stored before estimates existed, pinned at the old bottom row.
  it("is unknown across a clean read and an estimate", () => {
    const s = summarize([{ t: at(0), level: 0.98, confidence: "high" }, { t: at(60), level: 0.71, confidence: "high", estimate: "approx" }], at(60));
    expect(s.trendCmPerHour).toBeNull();
  });

  it("is worked out from estimates, which share the same small error", () => {
    const s = summarize([{ t: at(0), level: 0.8, confidence: "high", estimate: "approx" }, { t: at(60), level: 0.76, confidence: "high", estimate: "approx" }], at(60));
    expect(s.trendCmPerHour).toBe(-4);
  });
});
