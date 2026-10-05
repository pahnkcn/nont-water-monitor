import type { AlertPreference } from "@/lib/alerts";
import { readJson } from "@/lib/auth";
import type { DigestPref } from "@/lib/schedule";
import {
  MAX_SUBSCRIBERS,
  getSubscriber,
  isValidTarget,
  removeSubscribers,
  sanitizeAlerts,
  sanitizeDigest,
  saveSubscribers,
  subscriberCount,
  subscriberId,
  type Subscriber,
} from "@/lib/store";

type Body = {
  subscription: unknown;
  digest?: Partial<DigestPref>;
  alerts?: AlertPreference;
  /** Endpoint this subscription replaces (browser rotated its subscription). */
  previousEndpoint?: string;
};

export async function POST(req: Request) {
  const body = await readJson<Body>(req);
  if (!body || !isValidTarget(body.subscription)) {
    return Response.json({ error: "invalid subscription" }, { status: 400 });
  }
  const target = body.subscription;
  const id = subscriberId(target.endpoint);
  let existing = await getSubscriber(id);
  if (!existing && typeof body.previousEndpoint === "string") {
    const prevId = subscriberId(body.previousEndpoint);
    existing = await getSubscriber(prevId);
    if (existing) await removeSubscribers([prevId]);
  }
  if (!existing && (await subscriberCount()) >= MAX_SUBSCRIBERS) {
    return Response.json({ error: "subscriber limit reached" }, { status: 503 });
  }
  const now = Date.now();
  const sub: Subscriber = {
    id,
    target: { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
    digest: sanitizeDigest(body.digest, existing?.digest),
    alerts: sanitizeAlerts(body.alerts, existing?.alerts ?? "danger"),
    createdAt: existing?.createdAt ?? now,
    // A new subscriber waits for the next slot instead of getting an update straight away.
    lastDigestAt: existing?.lastDigestAt ?? now,
    lastTestAt: existing?.lastTestAt,
  };
  await saveSubscribers([sub]);
  return Response.json({ digest: sub.digest, alerts: sub.alerts }, { headers: { "cache-control": "no-store" } });
}
