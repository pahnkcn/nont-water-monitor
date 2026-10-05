import { readJson } from "@/lib/auth";
import { removeSubscribers, subscriberId } from "@/lib/store";

export async function POST(req: Request) {
  const body = await readJson<{ endpoint?: string }>(req);
  if (typeof body?.endpoint !== "string") return Response.json({ error: "endpoint required" }, { status: 400 });
  await removeSubscribers([subscriberId(body.endpoint)]);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
