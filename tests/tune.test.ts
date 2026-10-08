import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GAUGE_CONFIG } from "@/lib/gauge-config";
import { sampleGauge } from "@/lib/gauge";
import { DEFAULT_READER_PARAMS } from "@/lib/reader-params";
import { evaluate, grid, scoreLabel, tune, type Sample } from "@/lib/tune";
import { FIXTURES, loadFrame } from "./frames";
import { HYACINTH, OPEN_WATER } from "./prod-rows";

// The eye-read production rounds stand in for rounds an admin labelled in /admin.

const sample = (name: string, kind: Sample["kind"], y: number): Sample => ({
  t: 0,
  kind,
  y,
  gauge: DEFAULT_GAUGE_CONFIG,
  pixels: sampleGauge(loadFrame(path.join(FIXTURES, "prod", `${name}.jpg`)), DEFAULT_GAUGE_CONFIG),
});

// 13:50 has plants close under the line, which the reader may fairly call covered.
const SAMPLES = [
  ...OPEN_WATER.filter(([name]) => name !== "20261006-1350").map(([name, row]) => sample(name, "waterline", row)),
  ...HYACINTH.map(([name, row]) => sample(name, "covered", row)),
];

describe("scoring a labelled round", () => {
  const read = { y: 300, aboveTop: false, belowRange: false, covered: false, approx: false, dark: false, baselineOk: true, contrast: 0.8 };

  it("holds open water to 4 rows and a covered round to the window the production tests use", () => {
    expect(scoreLabel(read, { kind: "waterline", y: 304 })).toEqual({ pass: true, error: 4 });
    expect(scoreLabel(read, { kind: "waterline", y: 305 })).toEqual({ pass: false, error: 5 });
    expect(scoreLabel({ ...read, covered: true }, { kind: "covered", y: 320 })).toEqual({ pass: true, error: 0 });
    expect(scoreLabel({ ...read, covered: true }, { kind: "covered", y: 290 })).toEqual({ pass: false, error: 2 });
  });

  it("calls the wrong kind of answer a full miss", () => {
    expect(scoreLabel({ ...read, covered: true }, { kind: "waterline", y: 300 }).error).toBe(40);
    expect(scoreLabel(read, { kind: "covered", y: 300 }).error).toBe(40);
    expect(scoreLabel(read, { kind: "below", y: null }).pass).toBe(false);
    expect(scoreLabel({ ...read, baselineOk: false }, { kind: "waterline", y: 300 }).pass).toBe(false);
    expect(scoreLabel({ ...read, belowRange: true }, { kind: "below", y: null }).pass).toBe(true);
  });
});

describe("tuning on labelled rounds", () => {
  it("passes every eye-read round with the shipped numbers", () => {
    const e = evaluate(SAMPLES, DEFAULT_READER_PARAMS);
    expect(e.passCount).toBe(SAMPLES.length);
  });

  it("walks numbers set badly back to reading more rounds right, without losing any it read right", () => {
    const start = { ...DEFAULT_READER_PARAMS, whiteOfFace: 0.6, waterMax: 0.15, waterSoft: 0.15 };
    const r = tune(SAMPLES, start);
    expect(r.after.passCount).toBeGreaterThan(r.before.passCount);
    r.before.pass.forEach((ok, i) => {
      if (ok) expect(r.after.pass[i]).toBe(true);
    });
    expect(r.changed.length).toBeGreaterThan(0);
    expect(evaluate(SAMPLES, r.params)).toEqual(r.after);
  }, 120_000);

  it("gives the same answer every time", () => {
    const start = { ...DEFAULT_READER_PARAMS, whiteOfFace: 0.65 };
    const few = SAMPLES.slice(0, 6);
    expect(tune(few, start).params).toEqual(tune(few, start).params);
  }, 120_000);

  it("tries each number across its bounds in whole steps", () => {
    expect(grid("refineRows")).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(grid("whiteOfFace")).toContain(DEFAULT_READER_PARAMS.whiteOfFace);
    expect(grid("busyUnder")).toContain(DEFAULT_READER_PARAMS.busyUnder);
  });
});
