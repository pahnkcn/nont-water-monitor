import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PushMessage } from "@/lib/messages";
import type { ChartPoint, PublicState } from "@/lib/public-state";
import type { TickResult } from "@/lib/tick";
import { FIXTURES, loadFrame } from "./frames";

// Low water on 2026-10-06 07:27: the water touches the shaded foot of the gauge (row 452, about
// 0.76 m on the scale). The camera line must sit on that edge, and every distance is an estimate.

const ORIGIN = "https://nont.example";
const day = readdirSync(FIXTURES)
  .filter((f) => f.startsWith("day-") && f.endsWith(".png"))
  .sort()
  .map((f) => loadFrame(path.join(FIXTURES, f)));

let clock = Date.parse("2026-10-06T06:55:00+07:00");
const realNow = Date.now;
const sent: PushMessage[] = [];
let tick: TickResult;
let page: PublicState;
let chart: ChartPoint[];

beforeAll(async () => {
  Date.now = () => clock;
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
  const subscribe = await import("@/app/api/push/subscribe/route");
  const readings = await import("@/app/api/readings/route");
  const { runTick } = await import("@/lib/tick");
  const { getPublicState } = await import("@/lib/public-state");

  const res = await subscribe.POST(
    new Request(`${ORIGIN}/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/LOW", keys: { p256dh: "p", auth: "a" } },
        alerts: "watch",
        digest: { every: "1h", quiet: null },
      }),
    }),
  );
  if (res.status !== 200) throw new Error(`subscribe: ${res.status}`);

  clock = Date.parse("2026-10-06T07:00:00+07:00");
  tick = await runTick(ORIGIN, clock, {
    capture: async () => ({ frames: day, jpeg: Buffer.from("jpeg"), capturedAt: clock }),
    send: async (_target, msg) => {
      sent.push(msg);
      return { ok: true };
    },
  });
  page = await getPublicState(clock);
  chart = (await (await readings.GET(new Request(`${ORIGIN}/api/readings?range=7d`))).json()).points;
}, 60_000);

afterAll(() => {
  Date.now = realNow;
});

describe("a round with the water at the foot of the gauge", () => {
  it("still counts as a normal reading and raises no alert", () => {
    expect(tick.ok).toBe(true);
    expect(tick.reading).toMatchObject({ level: 0.76, estimate: "approx" });
    expect(tick.status).toBe("normal");
    expect(tick.events).toEqual([]);
  });

  it("puts the camera line on the waterline and tells the page the level is an estimate", () => {
    expect(page.snapshot).toMatchObject({ y: 452, estimate: "approx" });
    expect(page.latest).toMatchObject({ level: 0.76, estimate: "approx" });
    expect(page.day.at(-1)).toEqual([clock, 0.76, "approx"]);
    expect(chart.at(-1)).toEqual([clock, 0.76, "approx"]);
  });

  it("says 'about' in the hourly update instead of an exact distance", () => {
    const digest = sent.find((m) => m.tag === "digest");
    expect(digest?.body).toContain("อีกประมาณ 144 ซม. ถึงระดับเฝ้าระวัง");
    expect(digest?.body).not.toMatch(/อีก 144/);
  });
});
