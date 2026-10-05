import webpush from "web-push";
import type { PushMessage } from "./messages";

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };

let configured = false;

export function vapidPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "";
}

function configure() {
  if (configured) return;
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("VAPID keys are not configured");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "https://nont-water.vercel.app", publicKey, privateKey);
  configured = true;
}

export type SendResult = { ok: true } | { ok: false; gone: boolean; status?: number; error: string };

export async function sendPush(target: PushTarget, msg: PushMessage, origin: string): Promise<SendResult> {
  configure();
  const payload = JSON.stringify({
    title: msg.title,
    body: msg.body,
    tag: msg.tag,
    url: new URL(msg.url, origin).href,
    image: msg.image ? new URL(msg.image, origin).href : undefined,
    requireInteraction: msg.requireInteraction ?? false,
  });
  try {
    await webpush.sendNotification(target, payload, {
      TTL: msg.ttl,
      urgency: msg.urgency,
      // Undelivered routine updates collapse into the newest one.
      topic: msg.tag === "digest" ? "digest" : undefined,
      timeout: 10_000,
    });
    return { ok: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410, status, error: String((err as Error).message ?? err) };
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
