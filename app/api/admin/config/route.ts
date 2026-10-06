import type { Thresholds } from "@/lib/alerts";
import { isAdminRequest, readJson } from "@/lib/auth";
import { getConfig, saveConfig, validateGauge, validateThresholds } from "@/lib/config";
import type { GaugeConfig } from "@/lib/gauge-config";
import { pushConfig } from "@/lib/push";
import { clearGaugeRefs, getGaugeRefs, getSnapshotMeta, getState, getSuspects, subscriberCount } from "@/lib/store";

export async function GET(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [config, state, snap, subs, refs, suspects] = await Promise.all([
    getConfig(),
    getState(),
    getSnapshotMeta(),
    subscriberCount(),
    getGaugeRefs(),
    getSuspects(),
  ]);
  return Response.json(
    {
      config,
      state,
      snapshot: snap,
      subscribers: subs,
      refs: refs.map((r) => ({ t: r.t, meanLuma: r.meanLuma })),
      push: pushConfig(),
      suspects,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PUT(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson<{ thresholds?: Thresholds; gauge?: GaugeConfig; autoTrack?: boolean; resetRefs?: boolean }>(
    req,
    20_000,
  );
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 });
  if (body.thresholds) {
    const err = validateThresholds(body.thresholds);
    if (err) return Response.json({ error: err }, { status: 400 });
  }
  if (body.gauge) {
    const err = validateGauge(body.gauge);
    if (err) return Response.json({ error: err }, { status: 400 });
  }
  if (body.autoTrack !== undefined && typeof body.autoTrack !== "boolean") {
    return Response.json({ error: "autoTrack must be true or false" }, { status: 400 });
  }
  await saveConfig(body);
  // Saving a calibration already resets tracking. A relearn keeps the camera position it has now.
  if (body.resetRefs && !body.gauge) await clearGaugeRefs();
  return Response.json({ config: await getConfig() }, { headers: { "cache-control": "no-store" } });
}
