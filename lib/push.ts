import webpush from "web-push";
import type { PushMessage } from "./messages";

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };

let configured = false;

type Env = Record<string, string | undefined>;

export function vapidPublicKey(env: Env = process.env) {
  return env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? env.VAPID_PUBLIC_KEY ?? "";
}

export type PushProblem = "public-key" | "private-key" | "subject-missing" | "subject-format" | "subject-localhost";

/**
 * The contact sent to push services with every message, and anything that would stop delivery.
 * Apple's push service (every iPhone) rejects a subject that is not an https: URL or a mailto:
 * address, and rejects localhost. Without VAPID_SUBJECT the site's own address is used.
 */
export function pushConfig(env: Env = process.env): { subject: string | null; problems: PushProblem[] } {
  const problems: PushProblem[] = [];
  if (!vapidPublicKey(env)) problems.push("public-key");
  if (!env.VAPID_PRIVATE_KEY) problems.push("private-key");
  const site = env.SITE_URL?.replace(/\/$/, "") ?? (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  const subject = env.VAPID_SUBJECT || site || null;
  if (!subject) problems.push("subject-missing");
  else if (!/^(https:\/\/[^/\s]+|mailto:\S+@\S+)/.test(subject)) problems.push("subject-format");
  else if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(subject)) problems.push("subject-localhost");
  return { subject, problems };
}

function configure() {
  if (configured) return;
  const { subject, problems } = pushConfig();
  if (problems.length) throw new Error(`Web push is not configured: ${problems.join(", ")}`);
  webpush.setVapidDetails(subject as string, vapidPublicKey(), process.env.VAPID_PRIVATE_KEY as string);
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
    const { statusCode: status, body } = err as { statusCode?: number; body?: string };
    // The push service's own reason (FCM, Mozilla, Apple) is in the body, not the message.
    const reason = [String((err as Error).message ?? err), status, body?.trim().slice(0, 200)].filter(Boolean).join(" · ");
    return { ok: false, gone: status === 404 || status === 410, status, error: reason };
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
