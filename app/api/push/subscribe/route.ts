import { initialPersonalState, personalThresholds, pointAhead, type AlertPreference } from "@/lib/alerts";
import { readJson } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import type { DigestPref } from "@/lib/schedule";
import {
  MAX_SUBSCRIBERS,
  getSubscriber,
  isValidTarget,
  latestReading,
  removeSubscribers,
  sanitizeAlerts,
  sanitizeDigest,
  sanitizeOffset,
  saveSubscribers,
  subscriberCount,
  subscriberId,
  type Subscriber,
} from "@/lib/store";

type Body = {
  subscription: unknown;
  digest?: Partial<DigestPref>;
  alerts?: AlertPreference;
  /** Personal alert point in cm; see OFFSET_CHOICES. */
  offsetCm?: number;
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
  const offsetCm = sanitizeOffset(body.offsetCm, existing?.offsetCm ?? 0);
  const alerts = sanitizeAlerts(body.alerts, existing?.alerts ?? "danger");
  const pointMoved = !existing || offsetCm !== (existing.offsetCm ?? 0);
  let alertState = existing?.alertState;
  if (pointMoved || alerts !== existing?.alerts) {
    const [config, latest] = await Promise.all([getConfig(), latestReading()]);
    const level = latest?.level ?? null;
    // A point picked under the water would never alert; the page may have shown an older level.
    if (existing && !pointAhead(level, config.thresholds, alerts, offsetCm)) {
      return Response.json({ error: "alert point is below the water", level }, { status: 409 });
    }
    // Start from where the water already is, so picking a point never sends an alert by itself.
    if (pointMoved) alertState = initialPersonalState(level, personalThresholds(config.thresholds, offsetCm), now);
  }
  const sub: Subscriber = {
    id,
    target: { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
    digest: sanitizeDigest(body.digest, existing?.digest),
    alerts,
    offsetCm,
    alertState,
    createdAt: existing?.createdAt ?? now,
    // A new subscriber waits for the next slot instead of getting an update straight away.
    lastDigestAt: existing?.lastDigestAt ?? now,
    lastTestAt: existing?.lastTestAt,
    admin: existing?.admin,
  };
  await saveSubscribers([sub]);
  return Response.json(
    { digest: sub.digest, alerts: sub.alerts, offsetCm: sub.offsetCm },
    { headers: { "cache-control": "no-store" } },
  );
}
