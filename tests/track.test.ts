import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readGauge, type RGBFrame } from "@/lib/gauge";
import { DEFAULT_GAUGE_CONFIG as CFG } from "@/lib/gauge-config";
import { applyTransform, makeReference, patchFits, track } from "@/lib/track";
import { FIXTURES, loadFrame, moveCamera, movedPoint, relight } from "./frames";

const night = readdirSync(FIXTURES)
  .filter((f) => f.startsWith("night-") && f.endsWith(".png"))
  .sort()
  .map((f) => loadFrame(path.join(FIXTURES, f)));
const ref = makeReference(night[0], CFG);
const original = readGauge(night, CFG);

/** Largest distance between where the tracked config puts each mark and where it really is. */
function markError(move: Parameters<typeof moveCamera>[1], found: ReturnType<typeof track>) {
  const cfg = applyTransform(CFG, found.transform);
  return Math.max(
    ...CFG.marks.map((m, i) => {
      const x = CFG.axis.top.x + ((m.y - CFG.axis.top.y) * (CFG.axis.bottom.x - CFG.axis.top.x)) / (CFG.axis.bottom.y - CFG.axis.top.y);
      return Math.abs(movedPoint({ x, y: m.y }, move).y - cfg.marks[i].y);
    }),
  );
}

describe("track: camera panned or tilted", () => {
  for (const [dx, dy] of [
    [0, 0],
    [5, -3],
    [-12, 8],
    [30, 20],
    [-60, -40],
  ]) {
    it(`finds a move of (${dx}, ${dy}) px and keeps the reading`, () => {
      const move = { dx, dy };
      const frames = night.map((f) => moveCamera(f, move));
      const found = track(frames[0], [ref]);
      expect(found.found).toBe(true);
      expect(Math.abs(found.transform.dx - dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(found.transform.dy - dy)).toBeLessThanOrEqual(1);
      expect(markError(move, found)).toBeLessThanOrEqual(1);

      const r = readGauge(frames, applyTransform(CFG, found.transform));
      expect(r.ok).toBe(true);
      expect(Math.abs((r.level as number) - (original.level as number))).toBeLessThanOrEqual(0.01);
    });
  }
});

describe("track: camera zoomed", () => {
  for (const move of [
    { scale: 1.08 },
    { scale: 0.93, dx: -10, about: { x: 250, y: 100 } },
  ]) {
    it(`finds a zoom of ×${move.scale} and keeps the reading`, () => {
      const frames = night.map((f) => moveCamera(f, move));
      const found = track(frames[0], [ref]);
      expect(found.found).toBe(true);
      expect(Math.abs(found.transform.scale - move.scale)).toBeLessThanOrEqual(0.01);
      expect(markError(move, found)).toBeLessThanOrEqual(1.5);

      const r = readGauge(frames, applyTransform(CFG, found.transform));
      expect(r.ok).toBe(true);
      expect(Math.abs((r.level as number) - (original.level as number))).toBeLessThanOrEqual(0.02);
    });
  }
});

describe("track: other light", () => {
  for (const [name, light] of [
    ["daylight", { gain: 1.5, offset: 40, gamma: 0.7 }],
    ["dusk", { gain: 0.5, offset: 0, gamma: 1.2 }],
  ] as const) {
    it(`still finds a moved camera at ${name}`, () => {
      const move = { dx: -7, dy: 11 };
      const found = track(relight(moveCamera(night[0], move), light), [ref]);
      expect(found.found).toBe(true);
      expect(markError(move, found)).toBeLessThanOrEqual(1);
    });
  }
});

/** Water painted over everything below `waterY`, as in a flood that reaches the reference patch. */
function flood(frame: RGBFrame, waterY: number): RGBFrame {
  const data = frame.data.slice();
  for (let i = waterY * frame.width * 3; i < data.length; i += 3) {
    const n = (i * 2654435761) % 13;
    data[i] = 96 + n;
    data[i + 1] = 80 + n;
    data[i + 2] = 52 + n;
  }
  return { ...frame, data };
}

describe("track: real day and night frames", () => {
  // Captured 2026-10-06 07:27 in daylight; the camera had not moved since the night fixtures.
  const day = readdirSync(FIXTURES)
    .filter((f) => f.startsWith("day-") && f.endsWith(".png"))
    .sort()
    .map((f) => loadFrame(path.join(FIXTURES, f)));
  const still = { dx: 0, dy: 0, scale: 1 };

  it("finds the gauge in daylight with a reference learned at night", () => {
    // The window behind the gauge is dark at night and bright sky by day.
    const found = track(day[0], [ref], { at: still });
    expect(found.found).toBe(true);
    expect(Math.abs(found.transform.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(found.transform.dy)).toBeLessThanOrEqual(1);
    expect(found.atLast).toBeGreaterThan(0.4);
  });

  it("finds a camera moved by daylight with a reference learned at night", () => {
    const move = { dx: -15, dy: 10 };
    const found = track(moveCamera(day[0], move), [ref]);
    expect(found.found).toBe(true);
    expect(markError(move, found)).toBeLessThanOrEqual(1);
  });

  it("finds the gauge at night with a reference learned by day", () => {
    const found = track(night[1], [makeReference(day[0], CFG)], { at: still });
    expect(found.found).toBe(true);
    expect(Math.abs(found.transform.dy)).toBeLessThanOrEqual(1);
  });
});

describe("patchFits", () => {
  it("says whether the reference patch is wholly inside the frame at a position", () => {
    // The patch starts at row 8, so moving the scene up 12 px pushes its top out of the frame.
    expect(patchFits(CFG, { dx: 0, dy: 0, scale: 1 })).toBe(true);
    expect(patchFits(CFG, { dx: 18, dy: 12, scale: 1 })).toBe(true);
    expect(patchFits(CFG, { dx: 18, dy: -12, scale: 1 })).toBe(false);
  });
});

describe("track: what it must not do", () => {
  it("reports nothing found in an unrelated scene, and that the old position no longer matches", () => {
    const upsideDown = { ...night[0], data: night[0].data.slice().reverse() };
    const found = track(upsideDown, [ref]);
    expect(found.found).toBe(false);
    expect(found.atLast).toBeLessThan(0.3);
  });

  it("says the old position still matches when only the light has changed", () => {
    const found = track(relight(night[1], { gain: 1.5, offset: 40, gamma: 0.7 }), [ref], { at: { dx: 0, dy: 0, scale: 1 } });
    expect(found.atLast).toBeGreaterThan(0.5);
  });

  it("never claims a confident wrong move on a gauge with nothing but repeating marks", () => {
    // Plain wall and a gauge whose 10 cm marks repeat every 10 px: a 10 px move looks like no move.
    const marks = (shift: number): RGBFrame => {
      const data = new Uint8Array(800 * 600 * 3).fill(120);
      for (let y = 0; y < 600; y++) {
        for (let x = 440; x < 520; x++) {
          const v = (y - shift) % 10 < 3 ? 30 : 235;
          data.fill(v, (y * 800 + x) * 3, (y * 800 + x) * 3 + 3);
        }
      }
      return { width: 800, height: 600, data };
    };
    const found = track(marks(10), [makeReference(marks(0), CFG)]);
    if (found.found) expect(Math.abs(found.transform.dy - 10)).toBeLessThanOrEqual(1);
    else expect(found.found).toBe(false);
  });

  it("still finds the gauge when flood water covers the lower half of the patch", () => {
    const move = { dx: 4, dy: 12 };
    // The caller passes where the water was last seen, in calibrated rows.
    const found = track(flood(moveCamera(night[0], move), 90), [ref], { maskBelowY: 90 - 12 });
    expect(found.found).toBe(true);
    expect(markError(move, found)).toBeLessThanOrEqual(1);
  });

  it("says the patch is under water instead of guessing when almost all of it is covered", () => {
    const found = track(flood(night[0], 30), [ref], { maskBelowY: 30 });
    expect(found.found).toBe(false);
    expect(found.covered).toBe(true);
  });

  it("takes well under a tenth of the 10-minute budget's CPU share per frame", () => {
    const frame = moveCamera(night[1], { dx: 20, dy: -15 });
    track(frame, [ref]);
    const t0 = performance.now();
    track(frame, [ref]);
    expect(performance.now() - t0).toBeLessThan(150);
  });
});
