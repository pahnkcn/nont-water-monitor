import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveConfig } from "@/lib/config";
import { readingsSince, getState } from "@/lib/store";
import { runTick, type TickDeps } from "@/lib/tick";
import { GET as adminConfig } from "@/app/api/admin/config/route";
import { GET as suspectImage } from "@/app/api/admin/suspects/route";
import { syntheticFrame } from "./frames";

// Something crossing the gauge reads as water far above the real level. Such a round is held
// back until the next one agrees, and its picture is kept for the admin to look at.

const ORIGIN = "https://nont.example";
const MIN = 60 * 1000;
let clock = Date.parse("2026-10-06T11:50:00+07:00");
const realNow = Date.now;
Date.now = () => clock;
afterAll(() => {
  Date.now = realNow;
});

/** One round ten minutes after the last, the camera showing water at these rows. */
async function round(...waterRows: number[]) {
  clock += 10 * MIN;
  const frames = (waterRows.length === 1 ? [waterRows[0], waterRows[0], waterRows[0]] : waterRows).map((y) => syntheticFrame(y));
  const deps: TickDeps = {
    capture: async () => ({ frames, jpeg: Buffer.from(`jpeg ${clock}`), capturedAt: clock }),
    send: async () => ({ ok: true }),
  };
  return runTick(ORIGIN, clock, deps);
}

const stored = async () => (await readingsSince(0)).map((r) => r.level);

beforeAll(async () => {
  // Synthetic frames have no scene to track; read the saved calibration as is.
  await saveConfig({ autoTrack: false });
});

describe("a reading the river could not have reached", () => {
  it("is held back: not stored, no alert, and the round says why", async () => {
    await round(436); // 0.85 m on the gauge foot
    const before = await stored();
    const r = await round(105); // 2.54 m ten minutes later
    expect(r.reading?.level).toBeCloseTo(2.54, 1);
    expect(await stored()).toEqual(before);
    const state = await getState();
    expect(state.alert.status).toBe("normal");
    expect(state.lastRead).toMatchObject({ ok: false, reason: "jump", level: expect.closeTo(2.54, 1) });
  });

  it("is dropped when the next round is back at the old level", async () => {
    const before = await stored();
    await round(434);
    expect((await stored()).length).toBe(before.length + 1);
    expect((await getState()).lastRead).toMatchObject({ ok: true });
  });

  it("is taken once the next round agrees, since then the water really moved", async () => {
    const before = await stored();
    await round(300); // about 1.57 m: out of reach of 0.85 ten minutes ago
    expect(await stored()).toEqual(before);
    await round(298);
    expect((await stored()).slice(before.length)).toEqual([expect.closeTo(1.57, 1)]);
    expect((await getState()).held).toBeNull();
  });
});

type SuspectRow = { t: number; level: number | null; reason?: string; confidence: string; lastLevel: number | null };
const suspects = async () =>
  ((await (await adminConfig(new Request(`${ORIGIN}/api/admin/config`))).json()) as { suspects: SuspectRow[] }).suspects;
const image = (s: SuspectRow, i: number) => suspectImage(new Request(`${ORIGIN}/api/admin/suspects?i=${i}&t=${s.t}`));

describe("pictures of suspicious rounds", () => {
  it("keeps the picture of a held round, newest first, with what it was judged against", async () => {
    // Back to the gauge foot from 1.57 m: the second round confirms the move.
    await round(436);
    await round(436);
    await round(105);
    const [held] = await suspects();
    expect(held).toMatchObject({ t: clock, reason: "jump", level: expect.closeTo(2.54, 1), lastLevel: expect.closeTo(0.85, 1) });
    const res = await image(held, 0);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(`jpeg ${clock}`);
  });

  it("keeps the picture of a low-confidence round, which is still stored", async () => {
    const before = await stored();
    await round(434, 436, 460); // frames disagree
    const [low] = await suspects();
    expect(low).toMatchObject({ t: clock, reason: "frames-disagree", confidence: "low" });
    expect((await stored()).length).toBe(before.length + 1);
  });

  it("keeps nothing of a clean round", async () => {
    const before = await suspects();
    await round(436);
    expect(await suspects()).toEqual(before);
  });

  it("refuses a picture that has since been pushed down the list", async () => {
    const [newest] = await suspects();
    await round(434, 436, 460);
    expect((await image(newest, 0)).status).toBe(404);
    expect((await image(newest, 1)).status).toBe(200);
  });

  it("keeps the last 24 only", async () => {
    for (let i = 0; i < 25; i++) await round(434, 436, 460);
    expect(await suspects()).toHaveLength(24);
  });
});
