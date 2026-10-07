import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS as TH } from "@/lib/alerts";
import { alertMessage } from "@/lib/messages";
import { DEFAULT_REPEAT } from "@/lib/remind";
import { DEFAULT_DIGEST } from "@/lib/schedule";
import { getSubscriber, saveSubscribers, subscriberId, type Subscriber } from "@/lib/store";

// Every device is alerted at the site thresholds; the reminders after that are its only choice.

const post = (body: unknown) =>
  new Request("https://nont.example/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const subscription = (who: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${who}`, keys: { p256dh: "p", auth: "a" } });

describe("saving settings", () => {
  it("keeps the updates and reminders, and nothing about an alert level or point", async () => {
    const subscribe = await import("@/app/api/push/subscribe/route");
    const res = await subscribe.POST(post({ subscription: subscription("NEW"), alerts: "off", offsetCm: -20, repeat: { watch: 60 } }));
    expect(await res.json()).toEqual({ digest: DEFAULT_DIGEST, repeat: { watch: 60, danger: DEFAULT_REPEAT.danger } });
    const saved = await getSubscriber(subscriberId(subscription("NEW").endpoint));
    expect(saved).not.toHaveProperty("alerts");
    expect(saved).not.toHaveProperty("offsetCm");
  });

  it("carries a device saved with alerts from danger only over to the reminders it had", async () => {
    const subscribe = await import("@/app/api/push/subscribe/route");
    const me = await import("@/app/api/push/me/route");
    const { endpoint } = subscription("OLD");
    const id = subscriberId(endpoint);
    const old = {
      id,
      target: subscription("OLD"),
      digest: DEFAULT_DIGEST,
      alerts: "danger",
      offsetCm: -20,
      alertState: { status: "watch", since: 0, lastAlertLevel: 2.0, pending: null },
      createdAt: 0,
      lastDigestAt: 0,
    } as Subscriber;
    await saveSubscribers([old]);

    const shown = await (await me.POST(post({ endpoint }))).json();
    expect(shown).toEqual(expect.objectContaining({ subscribed: true, repeat: { watch: 0, danger: DEFAULT_REPEAT.danger } }));
    expect(shown).not.toHaveProperty("alerts");

    // The page sends back what it was shown, changed or not; the old fields go with that save.
    await subscribe.POST(post({ subscription: subscription("OLD"), digest: DEFAULT_DIGEST, repeat: { ...shown.repeat, danger: 30 } }));
    const saved = await getSubscriber(id);
    expect(saved?.repeat).toEqual({ watch: 0, danger: 30 });
    expect(saved).not.toHaveProperty("alerts");
    expect(saved).not.toHaveProperty("offsetCm");
    expect(saved).not.toHaveProperty("alertState");
  });
});

describe("alert wording", () => {
  const opts = { trend: null };
  const escalate = (to: "watch" | "danger", level: number) => ({ kind: "escalate" as const, from: "normal" as const, to, level, t: 0 });

  it("says how far over the threshold the water is", () => {
    expect(alertMessage(escalate("watch", 2.21), TH, opts).title).toBe("เฝ้าระวัง: น้ำท่าน้ำนนท์เกินเกณฑ์ 1 ซม.");
    expect(alertMessage(escalate("danger", 2.5), TH, opts).title).toBe("อันตราย: น้ำท่าน้ำนนท์ถึงเกณฑ์แล้ว");
  });

  it("names the level the water left", () => {
    const clear = (from: "watch" | "danger", to: "normal" | "watch", level: number) =>
      alertMessage({ kind: "clear", from, to, level, t: 0 }, TH, opts);
    expect(clear("watch", "normal", 2.12).title).toBe("กลับสู่ระดับปกติ");
    expect(clear("watch", "normal", 2.12).body).toContain("อีก 8 ซม. ถึงระดับเฝ้าระวัง");
    expect(clear("danger", "watch", 2.4).title).toBe("พ้นระดับอันตราย");
  });
});
