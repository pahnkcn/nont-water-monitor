import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getConfig, saveConfig } from "@/lib/config";
import { DEFAULT_GAUGE_CONFIG } from "@/lib/gauge-config";
import type { Label } from "@/lib/labels";
import { DEFAULT_READER_PARAMS } from "@/lib/reader-params";
import { getSnapshot, getSuspects } from "@/lib/store";
import { runTick, type TickDeps } from "@/lib/tick";
import { GET as adminConfig, PUT as putConfig } from "@/app/api/admin/config/route";
import { DELETE as deleteLabel, GET as getLabels, POST as postLabel } from "@/app/api/admin/labels/route";
import { syntheticFrame } from "./frames";

// The admin says where the water really was on a round, and the reader's numbers can be swapped
// for a set tuned on those labels without a deploy.

const ORIGIN = "https://nont.example";
const MIN = 60 * 1000;
let clock = Date.parse("2026-10-07T11:50:00+07:00");
const realNow = Date.now;
Date.now = () => clock;
afterAll(() => {
  Date.now = realNow;
});

async function round(waterY: number, opts: { pipeAt?: number } = {}) {
  clock += 10 * MIN;
  const frames = [0, 1, 2].map(() => syntheticFrame(waterY, opts));
  const deps: TickDeps = {
    capture: async () => ({ frames, jpeg: Buffer.from(`jpeg ${clock}`), capturedAt: clock }),
    send: async () => ({ ok: true }),
  };
  return runTick(ORIGIN, clock, deps);
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const label = (body: unknown) => postLabel(new Request(`${ORIGIN}/api/admin/labels`, json(body)));
const labels = async () => ((await (await getLabels(new Request(`${ORIGIN}/api/admin/labels`))).json()) as { labels: Label[] }).labels;
const picture = (t: number) => getLabels(new Request(`${ORIGIN}/api/admin/labels?t=${t}`));
const put = (body: unknown) => putConfig(new Request(`${ORIGIN}/api/admin/config`, { ...json(body), method: "PUT" }));

beforeAll(async () => {
  // Synthetic frames have no scene to track; read the saved calibration as is.
  await saveConfig({ autoTrack: false });
});

describe("labelling a suspicious round", () => {
  it("keeps the round's picture and the calibration it was read at", async () => {
    await round(436);
    await round(105); // held back as a jump
    const [held] = await getSuspects();
    expect(held.gauge).toEqual(DEFAULT_GAUGE_CONFIG);

    const res = await label({ source: "suspect", i: 0, t: held.t, verdict: "corrected", kind: "waterline", y: 436 });
    expect(res.status).toBe(200);
    const [saved] = await labels();
    expect(saved).toMatchObject({ t: held.t, kind: "waterline", y: 436, verdict: "corrected", source: "suspect" });
    expect(saved.reader).toMatchObject({ y: held.y, reason: "jump" });
    expect(saved.gauge).toEqual(DEFAULT_GAUGE_CONFIG);
    expect(Buffer.from(await (await picture(held.t)).arrayBuffer()).toString()).toBe(`jpeg ${held.t}`);
  });

  it("takes the reader's own line when the admin agrees, and replaces an earlier label", async () => {
    const [held] = await getSuspects();
    expect((await label({ source: "suspect", i: 0, t: held.t, verdict: "correct" })).status).toBe(200);
    const all = await labels();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "waterline", y: held.y, verdict: "correct" });
  });

  it("refuses a round that has moved down the list or a row off the picture", async () => {
    const [held] = await getSuspects();
    expect((await label({ source: "suspect", i: 1, t: held.t, verdict: "correct" })).status).toBe(404);
    expect((await label({ source: "suspect", i: 0, t: held.t, verdict: "corrected", kind: "waterline", y: 600 })).status).toBe(400);
    expect((await label({ source: "suspect", i: 0, t: held.t, verdict: "corrected", kind: "waterline" })).status).toBe(400);
    expect((await label({ source: "suspect", i: 0, t: held.t, verdict: "corrected", kind: "boat", y: 300 })).status).toBe(400);
  });

  it("outlives the suspect list", async () => {
    const [first] = await labels();
    for (let i = 0; i < 25; i++) {
      await round(436);
      await round(105);
    }
    expect((await getSuspects()).some((s) => s.t === first.t)).toBe(false);
    expect((await picture(first.t)).status).toBe(200);
    expect((await labels()).map((l) => l.t)).toContain(first.t);
  });

  it("is listed on the admin page without its calibration", async () => {
    const d = (await (await adminConfig(new Request(`${ORIGIN}/api/admin/config`))).json()) as {
      labels: Label[];
      suspects: { gauge?: unknown }[];
    };
    expect(d.labels.length).toBeGreaterThan(0);
    expect(d.labels[0].gauge).toBeUndefined();
    expect(d.suspects[0].gauge).toBeUndefined();
  });

  it("can be deleted", async () => {
    const [first] = await labels();
    await deleteLabel(new Request(`${ORIGIN}/api/admin/labels?t=${first.t}`, { method: "DELETE" }));
    expect(await labels()).toEqual([]);
    expect((await picture(first.t)).status).toBe(404);
  });
});

describe("labelling the latest snapshot", () => {
  it("keeps the snapshot as long as it is still the latest", async () => {
    await round(436);
    await round(436);
    const snap = await getSnapshot();
    expect(snap?.gauge).toEqual(DEFAULT_GAUGE_CONFIG);
    const res = await label({ source: "snapshot", t: clock, verdict: "corrected", kind: "covered", y: 420 });
    expect(res.status).toBe(200);
    expect((await labels())[0]).toMatchObject({ t: clock, kind: "covered", y: 420, source: "snapshot" });
    expect((await label({ source: "snapshot", t: clock - 10 * MIN, verdict: "correct" })).status).toBe(409);
  });

  it("cannot agree with a held round, which drew no line", async () => {
    await round(105);
    expect((await getSnapshot())?.y).toBeNull();
    expect((await label({ source: "snapshot", t: clock, verdict: "correct" })).status).toBe(400);
    const res = await label({ source: "snapshot", t: clock, verdict: "corrected", kind: "unreadable" });
    expect(res.status).toBe(200);
    expect((await labels())[0]).toMatchObject({ kind: "unreadable", y: null });
  });
});

describe("tuned reader numbers", () => {
  it("are checked before they are saved", async () => {
    expect((await put({ reader: { params: { ...DEFAULT_READER_PARAMS, whiteOfFace: 2 }, labels: 12 } })).status).toBe(400);
    expect((await put({ reader: { params: { ...DEFAULT_READER_PARAMS, plantRun: 8.5 }, labels: 12 } })).status).toBe(400);
    expect((await put({ reader: { params: { ...DEFAULT_READER_PARAMS, extra: 1 }, labels: 12 } })).status).toBe(400);
    expect((await put({ reader: { params: DEFAULT_READER_PARAMS, labels: -1 } })).status).toBe(400);
  });

  it("change how the next round reads, and go back to the shipped ones on reset", async () => {
    await round(300);
    // A pipe floating right on the water: ten hidden rows hide the water under the shipped numbers.
    const covered = await round(300, { pipeAt: 290 });
    expect(covered.reading?.estimate).toBe("covered");

    expect((await put({ reader: { params: { ...DEFAULT_READER_PARAMS, plantRun: 12 }, labels: 12 } })).status).toBe(200);
    const { reader } = await getConfig();
    expect(reader).toMatchObject({ params: { plantRun: 12 }, labels: 12, savedAt: clock });
    const open = await round(300, { pipeAt: 290 });
    expect(open.reading?.estimate).toBeUndefined();
    expect(open.reading?.y).toBe(300);

    expect((await put({ resetReader: true })).status).toBe(200);
    expect((await getConfig()).reader).toEqual({ params: DEFAULT_READER_PARAMS, savedAt: null, labels: 0 });
    expect((await round(300, { pipeAt: 290 })).reading?.estimate).toBe("covered");
  });
});
