import { getPublicState } from "@/lib/public-state";

export async function GET() {
  return Response.json(await getPublicState(), {
    headers: { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
  });
}
