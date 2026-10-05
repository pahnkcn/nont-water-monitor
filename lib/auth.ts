import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Vercel Cron and cron-job.org both send `Authorization: Bearer <CRON_SECRET>`. */
export function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export function isAdminRequest(req: Request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return process.env.NODE_ENV !== "production";
  return safeEqual(req.headers.get("x-admin-password") ?? "", password);
}

export function siteOrigin(req: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return new URL(req.url).origin;
}

export async function readJson<T>(req: Request, maxBytes = 8_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
