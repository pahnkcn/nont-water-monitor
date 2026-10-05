import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { DEFAULT_GAUGE_CONFIG, type GaugeConfig } from "@/lib/gauge-config";
import { detectWaterline, readGauge, yToLevel, type RGBFrame } from "@/lib/gauge";

const FIXTURES = path.join(__dirname, "fixtures");

function loadFrame(file: string): RGBFrame {
  const data = execFileSync(
    ffmpegPath as string,
    ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { maxBuffer: 1 << 24 },
  );
  return { width: 800, height: 600, data: new Uint8Array(data) };
}

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

  it("extrapolates past the last mark using the last segment", () => {
    // last segment: 331 -> 1.40, 352 -> 1.30, so 21px per 10cm
    expect(yToLevel(373, marks)).toBeCloseTo(1.2, 2);
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
