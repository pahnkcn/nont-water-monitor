import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PushMessage } from "@/lib/messages";
import type { PublicState } from "@/lib/public-state";
import type { TickResult } from "@/lib/tick";
import { FIXTURES, loadFrame } from "./frames";

// The morning of 2026-10-07 on the live site: a mat of water hyacinth drifted around the foot of
// the gauge, the old reader took it (and the shaded face) for the river and stored 2.13 m, and the
// site went to danger at 07:00. With the frames of 07:12 the reader finds the face ending at the
// plants: the water is hidden under them, near 0.95 m at most.

const ORIGIN = "https://nont.example";
const bkk = (s: string) => Date.parse(`2026-10-07T${s}:00+07:00`);
const mat = ["1", "2", "3"].map((k) => loadFrame(path.join(FIXTURES, "prod", `20261007-0712-${k}.jpg`)));

let clock = bkk("07:00");
const realNow = Date.now;
const sent: PushMessage[] = [];
const ticks: Record<string, TickResult> = {};
let page: PublicState;

async function round(at: string) {
  clock = bkk(at);
  const { runTick } = await import("@/lib/tick");
  ticks[at] = await runTick(ORIGIN, clock, {
    capture: async () => ({ frames: mat, jpeg: Buffer.from(`jpeg ${at}`), capturedAt: clock }),
    send: async (_target, msg) => {
      sent.push(msg);
      return { ok: true };
    },
  });
}

beforeAll(async () => {
  Date.now = () => clock;
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";
  const { saveConfig } = await import("@/lib/config");
  const { addReading, getState, setState } = await import("@/lib/store");
  const subscribe = await import("@/app/api/push/subscribe/route");

  // The site as the old reader left it at 07:00.
  await saveConfig({ thresholds: { watch: 1.3, danger: 2.0, hysteresis: 0.05, repeatStep: 0.1 }, autoTrack: false });
  const t = clock;
  await addReading({ t, level: 2.13, confidence: "low", y: 187 });
  await setState({
    ...(await getState()),
    alert: { status: "danger", since: t, lastAlertLevel: 2.13, pending: null },
    lastRead: { t, ok: true, level: 2.13, confidence: "low", reason: "weak-edge", y: 187 },
    lastSuccessAt: t,
    lastGood: { t, level: 2.13, calibration: 0 },
  });
  const res = await subscribe.POST(
    new Request(`${ORIGIN}/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/MAT", keys: { p256dh: "p", auth: "a" } },
        alerts: "watch",
        digest: { every: "off", quiet: null },
      }),
    }),
  );
  if (res.status !== 200) throw new Error(`subscribe: ${res.status}`);

  await round("07:10");
  await round("07:20");
  await round("07:30");
  const { getPublicState } = await import("@/lib/public-state");
  page = await getPublicState(clock);
}, 60_000);

afterAll(() => {
  Date.now = realNow;
});

describe("hyacinth around the foot of the gauge after a false danger", () => {
  it("reads the water as hidden under the plants, far below 2.13 m", () => {
    for (const at of ["07:10", "07:20", "07:30"]) {
      expect(ticks[at].reading).toMatchObject({ estimate: "covered", confidence: "high" });
      expect(ticks[at].reading?.level).toBeGreaterThan(0.85);
      expect(ticks[at].reading?.level).toBeLessThan(1.0);
    }
  });

  it("holds the first round back as a jump, then takes the second and clears the danger with the third", () => {
    expect(ticks["07:10"].reading?.reason).toBe("jump");
    expect(ticks["07:10"].status).toBe("danger");
    expect(ticks["07:20"].status).toBe("danger");
    expect(ticks["07:30"].events).toMatchObject([{ kind: "clear", from: "danger", to: "normal" }]);
    expect(ticks["07:30"].status).toBe("normal");
  });

  it("tells the device the water dropped, without claiming an exact distance", () => {
    // Danger reminders went on until the level was confirmed, as they would for a real danger.
    const alerts = sent.filter((m) => m.tag === "alert");
    expect(alerts.map((m) => m.title).slice(0, -1).every((t) => t.includes("อันตราย"))).toBe(true);
    const clear = alerts.at(-1)!;
    expect(clear.title).toBe("กลับสู่ระดับปกติ");
    expect(clear.body).toMatch(/อีกมากกว่า \d+ ซม\. ถึงระดับเฝ้าระวัง/);
  });

  it("shows the page the level as a bound, with the line where the plants start", () => {
    expect(page.status).toBe("normal");
    expect(page.latest).toMatchObject({ estimate: "covered" });
    expect(page.snapshot).toMatchObject({ estimate: "covered" });
    expect(page.snapshot?.y).toBeGreaterThan(410);
  });
});

describe("plants reaching the watch line", () => {
  it("are not taken as a level: the round is refused and its picture kept", async () => {
    const { saveConfig } = await import("@/lib/config");
    const { getState, readingsSince } = await import("@/lib/store");
    const { GET } = await import("@/app/api/admin/config/route");
    await saveConfig({ thresholds: { watch: 0.9, danger: 1.6, hysteresis: 0.05, repeatStep: 0.1 } });
    const before = (await readingsSince(0)).length;

    await round("07:40");
    expect(ticks["07:40"].reading).toMatchObject({ reason: "covered", estimate: "covered" });
    expect((await readingsSince(0)).length).toBe(before);
    expect((await getState()).lastRead).toMatchObject({ ok: false, reason: "covered" });
    expect(ticks["07:40"].status).toBe("normal");

    const { suspects } = await (await GET(new Request(`${ORIGIN}/api/admin/config`))).json();
    expect(suspects[0]).toMatchObject({ t: clock, reason: "covered", estimate: "covered" });
  });
});
