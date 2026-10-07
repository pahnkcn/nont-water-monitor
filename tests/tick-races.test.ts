import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { INITIAL_TRACKING } from "@/lib/autotrack";
import { saveConfig } from "@/lib/config";
import { DEFAULT_GAUGE_CONFIG } from "@/lib/gauge-config";
import type { SendResult } from "@/lib/push";
import { getGaugeRefs, getState } from "@/lib/store";
import { runTick, type TickDeps } from "@/lib/tick";
import { FIXTURES, loadFrame } from "./frames";

// A round takes seconds; people change settings and admins recalibrate meanwhile.

const ORIGIN = "https://nont.example";
const night = readdirSync(FIXTURES)
  .filter((f) => f.startsWith("night-") && f.endsWith(".png"))
  .sort()
  .map((f) => loadFrame(path.join(FIXTURES, f)));

let clock = Date.parse("2026-10-05T06:55:00+07:00");
const realNow = Date.now;
Date.now = () => clock;
afterAll(() => {
  Date.now = realNow;
});

const post = (body: unknown) =>
  new Request(`${ORIGIN}/x`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const subscription = (who: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${who}`, keys: { p256dh: "p", auth: "a" } });
const camera = async () => ({ frames: night, jpeg: Buffer.from("jpeg"), capturedAt: clock });

describe("a round that overlaps other writes", () => {
  it("keeps preference changes and unsubscribes made while the round is sending", async () => {
    const subscribe = await import("@/app/api/push/subscribe/route");
    const unsubscribe = await import("@/app/api/push/unsubscribe/route");
    const me = await import("@/app/api/push/me/route");
    for (const who of ["CHANGER", "LEAVER"]) {
      await subscribe.POST(post({ subscription: subscription(who), digest: { every: "1h", quiet: null } }));
    }

    clock = Date.parse("2026-10-05T07:00:00+07:00"); // hourly updates due for both
    let meddled = false;
    const send: TickDeps["send"] = async (): Promise<SendResult> => {
      if (!meddled) {
        meddled = true;
        await subscribe.POST(post({ subscription: subscription("CHANGER"), repeat: { watch: 120, danger: 30 } }));
        await unsubscribe.POST(post({ endpoint: subscription("LEAVER").endpoint }));
      }
      return { ok: true };
    };
    await runTick(ORIGIN, clock, { capture: camera, send });

    const changer = await (await me.POST(post({ endpoint: subscription("CHANGER").endpoint }))).json();
    expect(changer.repeat).toEqual({ watch: 120, danger: 30 });
    const leaver = await (await me.POST(post({ endpoint: subscription("LEAVER").endpoint }))).json();
    expect(leaver.subscribed).toBe(false);
  });

  it("starts tracking afresh when the calibration is saved during the round", async () => {
    clock = Date.parse("2026-10-05T07:10:00+07:00");
    const capture = async () => {
      // The admin saves a calibration while this round is reading the camera.
      await saveConfig({ gauge: DEFAULT_GAUGE_CONFIG });
      return camera();
    };
    await runTick(ORIGIN, clock, { capture, send: async () => ({ ok: true }) });
    expect((await getState()).tracking).toEqual({ ...INITIAL_TRACKING, since: expect.any(Number) });
    expect(await getGaugeRefs()).toEqual([]);
  });
});
