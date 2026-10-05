import { vapidPublicKey } from "@/lib/push";

export function GET() {
  const key = vapidPublicKey();
  if (!key) return Response.json({ error: "push not configured" }, { status: 503 });
  return Response.json({ key }, { headers: { "cache-control": "public, max-age=3600" } });
}
