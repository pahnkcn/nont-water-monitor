import { readJson } from "@/lib/auth";
import { getSubscriber, subscriberId } from "@/lib/store";

export async function POST(req: Request) {
  const body = await readJson<{ endpoint?: string }>(req);
  if (typeof body?.endpoint !== "string") return Response.json({ error: "endpoint required" }, { status: 400 });
  const sub = await getSubscriber(subscriberId(body.endpoint));
  if (!sub) return Response.json({ subscribed: false }, { headers: { "cache-control": "no-store" } });
  return Response.json(
    { subscribed: true, digest: sub.digest, alerts: sub.alerts, offsetCm: sub.offsetCm ?? 0, admin: Boolean(sub.admin) },
    { headers: { "cache-control": "no-store" } },
  );
}
