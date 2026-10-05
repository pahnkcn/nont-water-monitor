import type { Thresholds } from "@/lib/alerts";
import { isAdminRequest, readJson } from "@/lib/auth";
import { getConfig, saveConfig, validateGauge, validateThresholds } from "@/lib/config";
import type { GaugeConfig } from "@/lib/gauge-config";
import { getSnapshotMeta, getState, subscriberCount } from "@/lib/store";

export async function GET(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [config, state, snap, subs] = await Promise.all([getConfig(), getState(), getSnapshotMeta(), subscriberCount()]);
  return Response.json(
    { config, state, snapshot: snap, subscribers: subs },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson<{ thresholds?: Thresholds; gauge?: GaugeConfig }>(req, 20_000);
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 });
  if (body.thresholds) {
    const err = validateThresholds(body.thresholds);
    if (err) return Response.json({ error: err }, { status: 400 });
  }
  if (body.gauge) {
    const err = validateGauge(body.gauge);
    if (err) return Response.json({ error: err }, { status: 400 });
  }
  await saveConfig(body);
  return Response.json({ config: await getConfig() }, { headers: { "cache-control": "no-store" } });
}
