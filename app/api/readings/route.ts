import { readingsSince } from "@/lib/store";

const HOUR = 60 * 60 * 1000;
const RANGES = { "24h": { span: 24 * HOUR, bucket: 0 }, "7d": { span: 7 * 24 * HOUR, bucket: HOUR / 2 }, "30d": { span: 30 * 24 * HOUR, bucket: 2 * HOUR } } as const;

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("range") ?? "24h";
  const range = RANGES[key as keyof typeof RANGES];
  if (!range) return Response.json({ error: "range must be 24h, 7d or 30d" }, { status: 400 });

  const now = Date.now();
  const readings = await readingsSince(now - range.span);
  let points: Array<[number, number]>;
  if (!range.bucket) {
    points = readings.map((r) => [r.t, r.level]);
  } else {
    // Keep the highest reading in each bucket: the peak is what matters for flooding.
    const buckets = new Map<number, [number, number]>();
    for (const r of readings) {
      const b = Math.floor(r.t / range.bucket);
      const cur = buckets.get(b);
      if (!cur || r.level > cur[1]) buckets.set(b, [r.t, r.level]);
    }
    points = [...buckets.values()].sort((a, b) => a[0] - b[0]);
  }
  return Response.json(
    { range: key, points },
    { headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } },
  );
}
