import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "@/lib/alerts";
import { saveConfig } from "@/lib/config";
import { testMessage } from "@/lib/messages";
import type { PushMessage } from "@/lib/messages";
import { DEFAULT_DIGEST } from "@/lib/schedule";
import {
  INITIAL_SITE_STATE,
  addReading,
  getState,
  readingsSince,
  recentEvents,
  saveSubscribers,
  setState,
  type Subscriber,
} from "@/lib/store";
import { summarize } from "@/lib/summary";
import { runTick } from "@/lib/tick";
import { FIXTURES, loadFrame } from "./frames";

// An admin changes the thresholds while the site is in an alert state. The status and the texts
// must follow the new thresholds, without a burst of all-clears.

const night = readdirSync(FIXTURES)
  .filter((f) => f.startsWith("night-") && f.endsWith(".png"))
  .sort()
  .map((f) => loadFrame(path.join(FIXTURES, f))); // the night frames read about 1.22 m

let clock = Date.parse("2026-10-05T21:00:00+07:00");
const realNow = Date.now;
Date.now = () => clock;
afterAll(() => {
  Date.now = realNow;
});

const LOW = { ...DEFAULT_THRESHOLDS, watch: 1.1, danger: 1.2 };
const sent: { to: string; msg: PushMessage }[] = [];
const round = () =>
  runTick("https://nont.example", clock, {
    capture: async () => ({ frames: night, jpeg: Buffer.from("jpeg"), capturedAt: clock }),
    send: async (target, msg) => {
      sent.push({ to: target.endpoint.split("/").pop() as string, msg });
      return { ok: true };
    },
  });

const device = (id: string): Subscriber => ({
  id,
  target: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: "p", auth: "a" } },
  digest: { ...DEFAULT_DIGEST, every: "off" },
  createdAt: clock - 86_400_000,
  lastDigestAt: clock,
});

describe("saving new thresholds", () => {
  it("drops the site out of an alert the water no longer meets, at once and quietly", async () => {
    await saveConfig({ thresholds: LOW });
    await addReading({ t: clock, level: 1.3, confidence: "high" });
    await setState({
      ...INITIAL_SITE_STATE,
      alert: { status: "danger", since: clock - 3_600_000, lastAlertLevel: 1.3, pending: null },
    });
    await saveSubscribers([device("A"), device("B")]);

    clock += 60_000;
    await saveConfig({ thresholds: DEFAULT_THRESHOLDS });

    expect((await getState()).alert.status).toBe("normal");
    // The alert log strikes the old alert through instead of leaving it open.
    expect((await recentEvents(1))[0]).toEqual(expect.objectContaining({ kind: "clear", from: "danger", to: "normal" }));
    // Texts built from the new state no longer contradict the distance.
    const summary = summarize(await readingsSince(clock - 3_600_000), clock);
    expect(testMessage(summary, (await getState()).alert.status, DEFAULT_THRESHOLDS).body).toContain("ปกติ");

    // The next round sends no all-clear for a change nobody saw on the river.
    clock += 600_000;
    await round();
    expect(sent.filter((s) => s.msg.tag === "alert")).toEqual([]);
  });

  it("leaves a rise to the next round, which alerts as usual", async () => {
    clock += 60_000;
    await saveConfig({ thresholds: LOW });
    expect((await getState()).alert.status).toBe("normal");

    clock += 600_000;
    const r = await round();
    expect(r.events).toEqual([expect.objectContaining({ kind: "escalate", to: "danger" })]);
    expect(sent.filter((s) => s.msg.tag === "alert").map((s) => s.to).sort()).toEqual(["A", "B"]);
  });
});
