import { readJson, siteOrigin } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { testMessage } from "@/lib/messages";
import { sendPush } from "@/lib/push";
import { getState, getSubscriber, readingsSince, removeSubscribers, saveSubscribers, subscriberId } from "@/lib/store";
import { summarize } from "@/lib/summary";

const MIN_INTERVAL_MS = 60_000;

export async function POST(req: Request) {
  const body = await readJson<{ endpoint?: string }>(req);
  if (typeof body?.endpoint !== "string") return Response.json({ error: "endpoint required" }, { status: 400 });
  const sub = await getSubscriber(subscriberId(body.endpoint));
  if (!sub) return Response.json({ error: "not subscribed" }, { status: 404 });
  const now = Date.now();
  if (sub.lastTestAt && now - sub.lastTestAt < MIN_INTERVAL_MS) {
    return Response.json({ error: "wait a minute between tests" }, { status: 429 });
  }
  const [state, readings, config] = await Promise.all([getState(), readingsSince(now - 26 * 60 * 60 * 1000), getConfig()]);
  const res = await sendPush(
    sub.target,
    testMessage(summarize(readings, now), state.alert.status, config.thresholds),
    siteOrigin(req),
  );
  if (!res.ok && res.gone) {
    await removeSubscribers([sub.id]);
    return Response.json({ error: "subscription expired" }, { status: 410 });
  }
  await saveSubscribers([{ ...sub, lastTestAt: now }]);
  return Response.json(res.ok ? { ok: true } : { error: res.error }, { status: res.ok ? 200 : 502 });
}
