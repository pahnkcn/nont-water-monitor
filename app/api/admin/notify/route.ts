import { isAdminRequest, readJson } from "@/lib/auth";
import { DEFAULT_DIGEST } from "@/lib/schedule";
import { getSubscriber, isValidTarget, removeSubscribers, saveSubscribers, subscriberId, type Subscriber } from "@/lib/store";

/** Mark this device as the admin's: it gets camera and tracking notices. */
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson<{ subscription?: unknown; on?: boolean; previousEndpoint?: string }>(req);
  if (!body || !isValidTarget(body.subscription) || typeof body.on !== "boolean") {
    return Response.json({ error: "subscription and on required" }, { status: 400 });
  }
  const target = body.subscription;
  const id = subscriberId(target.endpoint);
  const now = Date.now();
  let existing = await getSubscriber(id);
  if (!existing && typeof body.previousEndpoint === "string") {
    // The browser replaced a subscription made with old VAPID keys: move its record over.
    const prevId = subscriberId(body.previousEndpoint);
    const prev = await getSubscriber(prevId);
    if (prev) {
      existing = { ...prev, id, target: { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } } };
      await removeSubscribers([prevId]);
    }
  }
  // A new device gets the same defaults as the one-tap button on the dashboard, so the dashboard
  // shows honest settings for it.
  const sub: Subscriber = existing
    ? { ...existing, admin: body.on }
    : {
        id,
        target: { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
        digest: DEFAULT_DIGEST,
        createdAt: now,
        lastDigestAt: now,
        admin: body.on,
      };
  await saveSubscribers([sub]);
  return Response.json({ admin: body.on, created: !existing }, { headers: { "cache-control": "no-store" } });
}
