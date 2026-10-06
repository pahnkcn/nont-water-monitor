import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GAUGE_CONFIG, type GaugeConfig } from "@/lib/gauge-config";
import { detectWaterline, readGauge, yToLevel, type RGBFrame } from "@/lib/gauge";
import { FIXTURES, loadFrame } from "./frames";

/** Plain frame: grey wall, white gauge strip with dark bars down to `waterY`, brown water below. */
function syntheticFrame(waterY: number, opts: { pipeAt?: number; dark?: boolean } = {}): RGBFrame {
  const width = 800;
  const height = 600;
  const data = new Uint8Array(width * height * 3);
  const cfg = DEFAULT_GAUGE_CONFIG;
  const slope = (cfg.axis.bottom.x - cfg.axis.top.x) / (cfg.axis.bottom.y - cfg.axis.top.y);
  for (let y = 0; y < height; y++) {
    const cx = cfg.axis.top.x + (y - cfg.axis.top.y) * slope;
    for (let x = 0; x < width; x++) {
      let rgb: [number, number, number] = [120, 120, 115];
      const onGauge = Math.abs(x - cx) <= 16;
      if (y >= waterY) rgb = [118, 96, 60];
      else if (onGauge) rgb = y % 10 < 2 && x > cx ? [30, 30, 60] : [235, 235, 232];
      if (opts.pipeAt !== undefined && y >= opts.pipeAt && y < opts.pipeAt + 10) rgb = [40, 120, 220];
      if (opts.dark) rgb = [6, 6, 6];
      const i = (y * width + x) * 3;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }
  return { width, height, data };
}

describe("yToLevel", () => {
  const marks = DEFAULT_GAUGE_CONFIG.marks;

  it("returns the mark level exactly on a mark", () => {
    expect(yToLevel(214, marks)).toBeCloseTo(2.0, 5);
    expect(yToLevel(352, marks)).toBeCloseTo(1.3, 5);
  });

  it("interpolates between marks", () => {
    expect(yToLevel(224, marks)).toBeCloseTo(1.95, 2);
  });

  it("uses the labels read off the shaded bottom of the gauge", () => {
    expect(yToLevel(391, marks)).toBeCloseTo(1.1, 5);
    expect(yToLevel(445, marks)).toBeCloseTo(0.8, 5);
  });

  it("extrapolates past the last mark using the last segment", () => {
    // last segment: 428 -> 0.90, 445 -> 0.80, so 17px per 10cm
    expect(yToLevel(462, marks)).toBeCloseTo(0.7, 2);
  });
});

describe("detectWaterline on synthetic frames", () => {
  it("finds the boundary between gauge face and water", () => {
    const res = detectWaterline(syntheticFrame(300), DEFAULT_GAUGE_CONFIG);
    expect(res.y).not.toBeNull();
    expect(Math.abs((res.y as number) - 300)).toBeLessThanOrEqual(2);
    expect(res.baselineOk).toBe(true);
  });

  it("does not mistake a blue pipe across the gauge for water", () => {
    const res = detectWaterline(syntheticFrame(330, { pipeAt: 280 }), DEFAULT_GAUGE_CONFIG);
    expect(Math.abs((res.y as number) - 330)).toBeLessThanOrEqual(2);
  });

  it("still reads a flood that covers most of the always-dry rows", () => {
    // baseline rows are 20-150; water at 80 is gauge level ~2.7 m.
    const r = readGauge([syntheticFrame(80), syntheticFrame(81), syntheticFrame(80)], DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(Math.abs((r.y as number) - 80)).toBeLessThanOrEqual(2);
  });

  it("refuses a waterline so high that no baseline row is left to show the gauge is still in view", () => {
    // A camera that turned to a dark wall looks the same: a few bright rows, then "water".
    const r = readGauge([syntheticFrame(28), syntheticFrame(28), syntheticFrame(28)], DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("gauge-not-visible");
  });

  it("reports water above the top of the gauge", () => {
    const res = detectWaterline(syntheticFrame(5), DEFAULT_GAUGE_CONFIG);
    expect(res.aboveTop).toBe(true);
  });

  it("flags a dark frame as unreadable", () => {
    const res = detectWaterline(syntheticFrame(300, { dark: true }), DEFAULT_GAUGE_CONFIG);
    expect(res.dark).toBe(true);
  });
});

describe("readGauge", () => {
  it("is confident when frames agree", () => {
    const frames = [syntheticFrame(300), syntheticFrame(301), syntheticFrame(299)];
    const r = readGauge(frames, DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.level).toBeCloseTo(yToLevel(300, DEFAULT_GAUGE_CONFIG.marks), 1);
  });

  it("drops to low confidence when frames disagree", () => {
    const frames = [syntheticFrame(250), syntheticFrame(300), syntheticFrame(340)];
    const r = readGauge(frames, DEFAULT_GAUGE_CONFIG);
    expect(r.confidence).toBe("low");
  });

  it("fails cleanly on dark frames", () => {
    const r = readGauge([syntheticFrame(300, { dark: true })], DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(false);
  });

  it("reads water just under the main span as an estimate, at the real edge", () => {
    const r = readGauge([syntheticFrame(450), syntheticFrame(450), syntheticFrame(451)], DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.approx).toBe(true);
    expect(r.belowRange).toBe(false);
    expect(Math.abs((r.y as number) - 450)).toBeLessThanOrEqual(2);
  });

  it("puts the line on water that straddles the end of the main span, not where the low zone starts", () => {
    const r = readGauge([syntheticFrame(417), syntheticFrame(417), syntheticFrame(417)], DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(Math.abs((r.y as number) - 417)).toBeLessThanOrEqual(2);
  });

  it("marks water under everything it scans as below range, with the last scanned row as the level", () => {
    const r = readGauge([syntheticFrame(560), syntheticFrame(560), syntheticFrame(560)], DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(r.belowRange).toBe(true);
    expect(r.approx).toBe(false);
    expect(r.y).toBeGreaterThan(DEFAULT_GAUGE_CONFIG.axis.bottom.y);
    expect(r.y).toBeLessThan(560);
  });

  it("follows a recalibrated config", () => {
    const cfg: GaugeConfig = {
      ...DEFAULT_GAUGE_CONFIG,
      marks: DEFAULT_GAUGE_CONFIG.marks.map((m) => ({ ...m, level: m.level - 1 })),
    };
    const r = readGauge([syntheticFrame(300)], cfg);
    expect(r.level).toBeCloseTo(yToLevel(300, DEFAULT_GAUGE_CONFIG.marks) - 1, 1);
  });
});

describe("real night frames (2026-10-03 23:01-23:02)", () => {
  const files = readdirSync(FIXTURES)
    .filter((f) => f.startsWith("night-") && f.endsWith(".png"))
    .map((f) => path.join(FIXTURES, f));

  it("has fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("reads the waterline near y=368 (about 1.22 m) with high confidence", () => {
    const r = readGauge(files.slice(0, 3).map(loadFrame), DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.y).toBeGreaterThanOrEqual(362);
    expect(r.y).toBeLessThanOrEqual(374);
    expect(r.level).toBeGreaterThan(1.17);
    expect(r.level).toBeLessThan(1.27);
  });
});

describe("real day frames at low water (2026-10-06)", () => {
  // The water touches the foot of the gauge, which is in shade and crowded with large black
  // numbers. The plate (and the yellow post beside it) end at the waterline near row 452.
  it("finds the waterline at the foot of the gauge at 07:27, as an estimate", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => f.startsWith("day-") && f.endsWith(".png"))
      .sort()
      .map((f) => loadFrame(path.join(FIXTURES, f)));
    const r = readGauge(files, DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.approx).toBe(true);
    expect(r.y).toBeGreaterThanOrEqual(449);
    expect(r.y).toBeLessThanOrEqual(456);
    expect(r.level).toBeGreaterThan(0.72);
    expect(r.level).toBeLessThan(0.81);
  });

  it("is not fooled by the white cable hanging into the water at 07:56", () => {
    const r = readGauge([loadFrame(path.join(FIXTURES, "low-0756.png"))], DEFAULT_GAUGE_CONFIG);
    expect(r.ok).toBe(true);
    expect(r.approx).toBe(true);
    expect(r.y).toBeGreaterThanOrEqual(450);
    expect(r.y).toBeLessThanOrEqual(458);
  });
});

describe("real 10-minute series (2026-10-03 23:04-23:44, falling tide)", () => {
  const dir = path.join(FIXTURES, "series");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();

  it("tracks the water within a few centimetres and never jumps", () => {
    const levels = files.map((f) => {
      const r = detectWaterline(loadFrame(path.join(dir, f)), DEFAULT_GAUGE_CONFIG);
      expect(r.y).not.toBeNull();
      expect(r.contrast).toBeGreaterThan(0.35);
      return yToLevel(r.y as number, DEFAULT_GAUGE_CONFIG.marks);
    });
    for (const l of levels) {
      expect(l).toBeGreaterThan(1.15);
      expect(l).toBeLessThan(1.26);
    }
    // The tide was falling the whole time: never more than a centimetre of noise upward.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThan(0.01);
      expect(levels[i - 1] - levels[i]).toBeLessThan(0.04);
    }
  });
});
