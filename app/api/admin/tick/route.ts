import { isAdminRequest, siteOrigin } from "@/lib/auth";
import { runTick } from "@/lib/tick";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await runTick(siteOrigin(req));
  return Response.json(result, { status: result.skipped ? 409 : 200, headers: { "cache-control": "no-store" } });
}
