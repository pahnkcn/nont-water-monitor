import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RGBFrame } from "@/lib/gauge";
import { DEFAULT_GAUGE_CONFIG } from "@/lib/gauge-config";
import type { PushMessage } from "@/lib/messages";
import type { PushTarget, SendResult } from "@/lib/push";
import type { Subscriber } from "@/lib/store";
import { FIXTURES, loadFrame, moveCamera } from "./frames";

// One morning of 10-minute rounds through the real tick: tracker, gauge reader, alert state
// machines, schedules and messages. Only the camera, the push service and the clock are fakes.
// The camera is a real night frame with flood water painted in at the wanted level.

const ORIGIN = "https://nont.example";
const bkk = (s: string) => Date.parse(`2026-10-05T${s}:00+07:00`);
const hhmm = (t: number) => new Date(t + 7 * 3600e3).toISOString().slice(11, 16);

/** Image row of a gauge level, inverting the calibration marks. */
function yForLevel(level: number) {
  const m = DEFAULT_GAUGE_CONFIG.marks;
  for (let i = 0; i < m.length - 1; i++) {
    const [a, b] = [m[i], m[i + 1]];
    if (level <= a.level && level >= b.level) return a.y + ((a.level - level) * (b.y - a.y)) / (a.level - b.level);
  }
  throw new Error(`level ${level} is off the calibrated gauge`);
}

function paintWater(frame: RGBFrame, waterY: number): RGBFrame {
  const data = frame.data.slice();
  for (let i = Math.round(waterY) * frame.width * 3; i < data.length; i += 3) {
    const n = (i * 2654435761) % 13;
    data[i] = 96 + n;
    data[i + 1] = 80 + n;
    data[i + 2] = 52 + n;
  }
  return { ...frame, data };
}

type Scene = number | "down" | "elsewhere" | [number, "shaky"];
const MOVE = { dx: 18, dy: -12 };

const morning: Array<[string, Scene]> = [
  ["05:50", 1.9], ["06:00", 1.94], ["06:10", 1.97], ["06:20", 1.97], ["06:30", 2.03], ["06:40", 2.06], ["06:50", 2.09],
  ["07:00", 2.12], ["07:10", 2.16], ["07:20", 2.24], ["07:30", 2.26], ["07:40", 2.33], ["07:50", 2.37],
  ["08:00", 2.41], ["08:10", 2.45], ["08:20", [2.53, "shaky"]], ["08:30", [2.55, "shaky"]], ["08:40", 2.58], ["08:50", 2.61],
  ["09:00", 2.67], ["09:10", 2.63], ["09:20", 2.58], ["09:30", 2.52], ["09:40", 2.43], ["09:50", 2.39],
  // the camera is knocked at 10:00 and stays that way
  ["10:00", 2.35], ["10:10", 2.31], ["10:20", "down"], ["10:30", "down"], ["10:40", "down"], ["10:50", "down"],
  ["11:00", "down"], ["11:10", "down"], ["11:20", 2.2], ["11:30", 2.16], ["11:40", 2.11], ["11:50", 2.06],
  ["12:00", 2.02], ["12:10", "elsewhere"], ["12:20", "elsewhere"], ["12:30", "elsewhere"], ["12:40", "elsewhere"],
];

type Sent = { at: number; to: string; msg: PushMessage };
const sent: Sent[] = [];
const ticks: Record<string, Awaited<ReturnType<typeof import("@/lib/tick").runTick>>> = {};
let clock = bkk("05:45");
const realNow = Date.now;

const of = (who: string, tag?: string) => sent.filter((s) => s.to === who && (!tag || s.msg.tag === tag));
const times = (list: Sent[]) => list.map((s) => hhmm(s.at));
const titles = (list: Sent[]) => list.map((s) => s.msg.title);
const reminder = (s: Sent) => s.msg.body.includes("ปรับหรือปิดได้ในหน้าเว็บ");

beforeAll(async () => {
  Date.now = () => clock;
  process.env.ADMIN_PASSWORD = "pw";
  process.env.VAPID_PUBLIC_KEY = "test-public";
  process.env.VAPID_PRIVATE_KEY = "test-private";

  const subscribe = await import("@/app/api/push/subscribe/route");
  const adminNotify = await import("@/app/api/admin/notify/route");
  const { saveSubscribers, subscriberId } = await import("@/lib/store");
  const { runTick } = await import("@/lib/tick");

  const night = readdirSync(FIXTURES)
    .filter((f) => f.startsWith("night-") && f.endsWith(".png"))
    .sort()
    .map((f) => loadFrame(path.join(FIXTURES, f)));
  const knocked = night.map((f) => moveCamera(f, MOVE));
  const elsewhere = night.map((f) => ({ ...f, data: f.data.slice().reverse() }));

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/x`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  const subscription = (who: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${who}`, keys: { p256dh: "p", auth: "a" } });

  const noRepeat = { watch: 0, danger: 0 };
  const devices = [
    { who: "A", digest: { every: "1h", dailyHour: 7, quiet: null }, repeat: noRepeat },
    { who: "B", digest: { every: "daily", dailyHour: 7, quiet: { start: 22, end: 6 } }, repeat: noRepeat },
    { who: "D", digest: { every: "1h", quiet: null } },
    // Default reminders: every 30 minutes at watch, every 10 at danger.
    { who: "R", digest: { every: "off" } },
  ];
  for (const d of devices) {
    const res = await subscribe.POST(post({ subscription: subscription(d.who), ...d }));
    if (res.status !== 200) throw new Error(`subscribe ${d.who}: ${res.status}`);
  }
  // Saved back when each device picked the level its alerts started from, and a point of its own.
  const old = (who: string, alerts: string, more: object): Subscriber =>
    ({
      id: subscriberId(subscription(who).endpoint),
      target: subscription(who),
      alerts,
      createdAt: clock,
      lastDigestAt: clock,
      ...more,
    }) as Subscriber;
  await saveSubscribers([
    old("C", "off", { digest: { every: "3h", dailyHour: 7, quiet: null } }),
    old("E", "danger", {
      digest: { every: "off", dailyHour: 7, quiet: null },
      offsetCm: -20,
      alertState: { status: "normal", since: clock, lastAlertLevel: null, pending: null },
    }),
  ]);
  const admin = await adminNotify.POST(post({ subscription: subscription("ADMIN"), on: true }, { "x-admin-password": "pw" }));
  if (admin.status !== 200) throw new Error(`admin notify: ${admin.status}`);

  const send = async (target: PushTarget, msg: PushMessage): Promise<SendResult> => {
    const to = target.endpoint.split("/").pop() as string;
    sent.push({ at: clock, to, msg });
    return to === "D" ? { ok: false, gone: true, status: 410, error: "gone" } : { ok: true };
  };

  let scene: Scene = 0;
  const capture = async () => {
    if (scene === "down") throw new Error("stream timeout");
    const knockedYet = clock >= bkk("10:00");
    const base = scene === "elsewhere" ? elsewhere : knockedYet ? knocked : night;
    const [level, shaky] = Array.isArray(scene) ? [scene[0], true] : [scene as number, false];
    const y = scene === "elsewhere" ? 0 : yForLevel(level) + (knockedYet ? MOVE.dy : 0);
    const frames = base.map((f, i) => (scene === "elsewhere" ? f : paintWater(f, y + (shaky ? [0, 9, -9][i] : 0))));
    return { frames, jpeg: Buffer.from("jpeg"), capturedAt: clock };
  };

  for (const [time, s] of morning) {
    clock = bkk(time);
    scene = s;
    ticks[time] = await runTick(ORIGIN, clock, { capture, send });
  }
}, 120_000);

afterAll(() => {
  Date.now = realNow;
});

describe("a morning of rounds", () => {
  it("reads the painted water to within a centimetre", () => {
    for (const [time, s] of morning) {
      if (typeof s !== "number" || time === "10:00") continue;
      expect(Math.abs((ticks[time].reading?.level as number) - s)).toBeLessThanOrEqual(0.015);
    }
  });

  it("alerts every device once at watch and once at danger, then when the water falls back", () => {
    for (const who of ["A", "B", "C", "E", "R"]) {
      const alerts = of(who, "alert").filter((s) => !reminder(s));
      expect(times(alerts)).toEqual(["07:20", "08:30", "09:50", "11:50"]);
      expect(titles(alerts)).toEqual([
        expect.stringMatching(/^เฝ้าระวัง: น้ำท่าน้ำนนท์เกินเกณฑ์ \d ซม\.$/),
        expect.stringMatching(/^อันตราย: น้ำท่าน้ำนนท์เกินเกณฑ์ \d ซม\.$/),
        "พ้นระดับอันตราย",
        "กลับสู่ระดับปกติ",
      ]);
    }
    // Climbing another 10 cm in danger is in the log, but it is the reminders' to tell.
    expect(ticks["09:00"].events).toEqual([expect.objectContaining({ kind: "rising" })]);
  });

  it("sends nothing more to a device with reminders off, and an hourly update otherwise", () => {
    expect(of("A", "alert").filter(reminder)).toEqual([]);
    expect(times(of("A", "digest"))).toEqual(["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00"]);
  });

  it("holds an alert back for one round when the frames disagree", () => {
    expect(ticks["08:20"].events).toEqual([]);
    expect(ticks["08:30"].events).toEqual([expect.objectContaining({ kind: "escalate", to: "danger" })]);
  });

  it("gives the daily update at 07:00 and the alerts, nothing else", () => {
    expect(times(of("B", "digest"))).toEqual(["07:00"]);
    expect(of("B").every((s) => s.msg.tag === "digest" || !reminder(s))).toBe(true);
  });

  it("alerts a device saved with alerts off, without reminders, and keeps its updates", () => {
    expect(of("C", "alert").filter(reminder)).toEqual([]);
    expect(times(of("C", "digest"))).toEqual(["06:00", "09:00", "12:00"]);
  });

  it("drops a device the push service says is gone, after one try", () => {
    expect(of("D")).toHaveLength(1);
    expect(ticks["06:00"].sent.removed).toBe(1);
  });

  it("alerts a device saved with its own point at the site thresholds, and reminds it in danger only", () => {
    expect(times(of("E", "alert").filter(reminder))).toEqual(["08:40", "08:50", "09:00", "09:10", "09:20", "09:30", "09:40"]);
  });

  it("reminds every 30 minutes at watch and every 10 at danger, counting from the last alert", () => {
    const r = of("R", "alert");
    expect(times(r.filter(reminder))).toEqual([
      "07:50", "08:20", // watch
      "08:40", "08:50", "09:00", "09:10", "09:20", "09:30", "09:40", // danger
      "10:20", "10:50", "11:20", // watch again, through the camera outage
    ]);
    expect(r.filter(reminder).every((s) => s.msg.tag === "alert" && s.msg.urgency === "high")).toBe(true);
    // 08:20 is still watch for the device, but the unconfirmed reading is over danger.
    expect(r.find((s) => hhmm(s.at) === "08:20")?.msg.title).toMatch(/^น้ำท่าน้ำนนท์สูงกว่าระดับอันตราย \d ซม\.$/);
  });

  it("keeps reminding while the camera is down, with the age of the level", () => {
    const at = (t: string) => of("R", "alert").find((s) => hhmm(s.at) === t)?.msg.body;
    expect(at("10:20")).toContain("อ่านเมื่อ 10:10 น.");
    expect(at("10:50")).toContain("กล้องไม่ตอบสนองตั้งแต่ 10:20 น. ค่านี้อ่านเมื่อ 10:10 น.");
  });

  it("follows the knocked camera: one held-back round, then normal readings at the new spot", () => {
    expect(ticks["10:00"].reading?.confidence).toBe("low");
    expect(ticks["10:00"].reading?.reason).toBe("camera-moved");
    expect(ticks["10:10"].reading?.confidence).toBe("high");
    expect(Math.abs((ticks["11:20"].reading?.level as number) - 2.2)).toBeLessThanOrEqual(0.015);
  });

  it("refuses to read when the gauge is nowhere in the picture", () => {
    for (const t of ["12:10", "12:20", "12:30", "12:40"]) expect(ticks[t].reading?.reason).toBe("gauge-lost");
    expect(ticks["12:40"].events).toEqual([]);
  });

  it("tells only the admin device about the camera, once per incident", () => {
    // The admin device also got the dashboard defaults (daily 07:00 update, default reminders).
    expect(of("ADMIN", "system").map((s) => [hhmm(s.at), s.msg.tag, s.msg.title])).toEqual([
      ["10:10", "system", "ปรับตำแหน่งไม้วัดอัตโนมัติแล้ว"],
      ["11:10", "system", "อ่านค่าจากกล้องไม่ได้ 1 ชั่วโมง"],
      ["12:30", "system", "หาไม้วัดในภาพไม่เจอ"],
    ]);
    expect(of("ADMIN", "system").every((s) => s.msg.url === "/admin")).toBe(true);
    expect(sent.filter((s) => s.to !== "ADMIN" && s.msg.tag === "system")).toEqual([]);
  });

  it("attaches this round's camera picture, and none while the camera is down", () => {
    expect(of("A", "alert").every((s) => s.msg.image === `/api/snapshot?t=${s.at}`)).toBe(true);
    // 11:00 falls in the outage; the last picture is from 10:10
    expect(times(of("A", "digest").filter((s) => !s.msg.image))).toEqual(["11:00"]);
    expect(of("A", "digest").filter((s) => s.msg.image).every((s) => s.msg.image === `/api/snapshot?t=${s.at}`)).toBe(true);
  });

  it("never puts a metre value in any notification", () => {
    expect(sent.filter((s) => /\d\.\d\d ม\./.test(s.msg.title + s.msg.body))).toEqual([]);
  });
});
