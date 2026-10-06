import { isAdminRequest } from "@/lib/auth";
import { getSuspectImage } from "@/lib/store";

/** The picture of one suspicious round: `i` is its place in the list, `t` when it was taken. */
export async function GET(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const i = Number(params.get("i"));
  const t = Number(params.get("t"));
  if (!Number.isInteger(i) || i < 0 || !Number.isFinite(t)) return Response.json({ error: "need i and t" }, { status: 400 });
  const jpeg = await getSuspectImage(i, t);
  // Gone when newer rounds pushed it out, or moved down the list since the page loaded.
  if (!jpeg) return Response.json({ error: "picture no longer kept here" }, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(Buffer.from(jpeg, "base64"), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
