import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GAUGE_CONFIG } from "@/lib/gauge-config";
import { detectWaterline, readGauge, yToLevel } from "@/lib/gauge";
import { FIXTURES, loadFrame } from "./frames";

// Rounds the live site kept as suspicious on 2026-10-06 and 07, with the row where the white face
// really ends, read off each picture by eye. The old reader took the lamp-lit water right under the
// gauge for more face at night (6 to 9 cm low), and in the morning of the 7th took the shaded face
// for water and a mat of water hyacinth for the river, reading 2.13 m while the water was near 0.9.

const PROD = path.join(FIXTURES, "prod");
const frame = (name: string) => loadFrame(path.join(PROD, `${name}.jpg`));

const OPEN_WATER: [name: string, row: number, note: string][] = [
  ["20261006-1350", 392, "afternoon, hyacinth drifting a few rows under the line"],
  ["20261006-1440", 365, "afternoon"],
  ["20261006-1510", 352, "blue pipe floating under the line"],
  ["20261006-1700", 315, "rope across the gauge"],
  ["20261006-1720", 311, "rope across the gauge"],
  ["20261006-1740", 316, "dusk"],
  ["20261006-1750", 315, "dusk"],
  ["20261006-1800", 312, "dusk, warm light"],
  ["20261006-1910", 326, "lamp-lit, the gauge reflected in still water"],
  ["20261006-1920", 326, "lamp-lit, reflection"],
  ["20261006-1930", 330, "lamp-lit, reflection"],
  ["20261006-1940", 332, "lamp-lit, reflection"],
  ["20261006-2000", 331, "lamp-lit, reflection"],
  ["20261006-2020", 340, "lamp-lit, reflection"],
  ["20261007-0420", 403, "lamp-lit, low tide"],
];

const HYACINTH: [name: string, row: number, note: string][] = [
  ["20261007-0610", 393, "a leaf over the foot"],
  ["20261007-0620", 411, "a leaf over the face, more face under it, then the mat"],
  ["20261007-0630", 415, "mat around the foot"],
  ["20261007-0640", 409, "a leaf over the face, more face under it, then the mat"],
  ["20261007-0650", 430, "pale stems across the foot"],
  ["20261007-0700", 413, "mat around the foot, face in morning shade (read as 2.13 m)"],
  ["20261007-0712-1", 425, "mat around the foot"],
  ["20261007-0712-2", 425, "mat around the foot"],
  ["20261007-0712-3", 425, "mat around the foot"],
  ["20261007-0731-1", 411, "leaves in blue morning shade, no green left"],
  ["20261007-0731-2", 411, "leaves in blue morning shade"],
  ["20261007-0731-3", 431, "leaves in blue morning shade, stems across the foot"],
];

describe("production rounds over open water", () => {
  it.each(OPEN_WATER)("%s: the line is on the waterline (%i, %s)", (name, row) => {
    const r = detectWaterline(frame(name), DEFAULT_GAUGE_CONFIG);
    expect(r.baselineOk).toBe(true);
    expect(Math.abs((r.y as number) - row)).toBeLessThanOrEqual(4);
    // 13:50 has plants close under the line; calling that row the top of what hides the water is fair.
    if (name !== "20261006-1350") expect(r.covered).toBe(false);
  });

  it("puts the lamp-lit evening within 2.5 cm of the waterline, not on its reflection", () => {
    for (const [name, row] of OPEN_WATER.filter(([n]) => n >= "20261006-1910" && n <= "20261006-2020")) {
      const r = detectWaterline(frame(name), DEFAULT_GAUGE_CONFIG);
      const off = yToLevel(r.y as number, DEFAULT_GAUGE_CONFIG.marks) - yToLevel(row, DEFAULT_GAUGE_CONFIG.marks);
      expect(Math.abs(off)).toBeLessThanOrEqual(0.025);
    }
  });
});

describe("production rounds with water hyacinth at the gauge", () => {
  it.each(HYACINTH)("%s: the water is hidden under the face, which ends near row %i (%s)", (name, row) => {
    const r = detectWaterline(frame(name), DEFAULT_GAUGE_CONFIG);
    expect(r.baselineOk).toBe(true);
    expect(r.covered).toBe(true);
    // A bound may start a little high, where stems first cross the face; under the face's end it would lie.
    expect(r.y).toBeLessThanOrEqual(row + 8);
    expect(r.y).toBeGreaterThanOrEqual(row - 25);
  });

  it("never reads the morning of the 7th anywhere near the 2.13 m it was stored as", () => {
    for (const [name] of HYACINTH) {
      const r = readGauge([frame(name)], DEFAULT_GAUGE_CONFIG);
      expect(r.ok).toBe(true);
      expect(r.covered).toBe(true);
      expect(r.level).toBeLessThan(1.15);
    }
  });

  it.each(["0712", "0731"])("agrees across the three frames of the %s round", (hhmm) => {
    const r = readGauge(
      [1, 2, 3].map((k) => frame(`20261007-${hhmm}-${k}`)),
      DEFAULT_GAUGE_CONFIG,
    );
    expect(r).toMatchObject({ ok: true, covered: true, confidence: "high" });
    expect(r.level).toBeGreaterThan(0.85);
    expect(r.level).toBeLessThan(1.0);
  });
});
