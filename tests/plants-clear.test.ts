import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveConfig } from "@/lib/config";
import type { RGBFrame } from "@/lib/gauge";
import { getState, readingsSince } from "@/lib/store";
import { runTick } from "@/lib/tick";
import { FIXTURES, loadFrame } from "./frames";

// The live site on 2026-10-07: water hyacinth hid the water at the foot of the gauge all morning,
// so each round stored only the most the water could be (0.89 m at 09:30). At 09:40 the plants had
// drifted off and the river showed at 0.72 m, 17 cm under that ceiling. The round was held back as
// a jump the tide could not make in ten minutes, and the site said it could not read the camera.

const ORIGIN = "https://nont.example";
const bkk = (s: string) => Date.parse(`2026-10-07T${s}:00+07:00`);
const prod = (name: string) => loadFrame(path.join(FIXTURES, "prod", `${name}.jpg`));
const plants = ["1", "2", "3"].map((k) => prod(`20261007-0731-${k}`));
const open = prod("20261007-0940");

let clock = 0;
const realNow = Date.now;
Date.now = () => clock;
afterAll(() => {
  Date.now = realNow;
});

async function round(at: string, frames: RGBFrame[]) {
  clock = bkk(at);
  return runTick(ORIGIN, clock, {
    capture: async () => ({ frames, jpeg: Buffer.from(`jpeg ${at}`), capturedAt: clock }),
    send: async () => ({ ok: true }),
  });
}

beforeAll(async () => {
  await saveConfig({ thresholds: { watch: 1.3, danger: 2.0, hysteresis: 0.05, repeatStep: 0.1 }, autoTrack: false });
});

describe("open water under a ceiling the plants left", () => {
  it("stores the plants' round as a ceiling", async () => {
    const r = await round("09:30", plants);
    expect(r.reading?.estimate).toBe("covered");
    expect((await getState()).lastGood).toMatchObject({ bound: true });
  });

  it("takes the open water ten minutes later instead of holding it back", async () => {
    const ceiling = (await getState()).lastGood?.level as number;
    const r = await round("09:40", [open]);
    expect(r.reading?.reason).toBeUndefined();
    expect(r.reading?.level).toBeLessThan(ceiling - 0.17);
    const state = await getState();
    expect(state.lastRead).toMatchObject({ ok: true, estimate: "approx" });
    expect(state.lastGood).not.toHaveProperty("bound");
    expect((await readingsSince(0)).at(-1)).toMatchObject({ t: bkk("09:40"), estimate: "approx" });
  });
});
