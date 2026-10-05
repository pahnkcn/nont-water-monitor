import { getSnapshot } from "@/lib/store";

export async function GET() {
  const snap = await getSnapshot();
  if (!snap) return new Response("no snapshot yet", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(Buffer.from(snap.jpegBase64, "base64"), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600",
      "last-modified": new Date(snap.t).toUTCString(),
    },
  });
}
