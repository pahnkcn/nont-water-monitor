import { isAdminRequest, readJson } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import type { GaugeConfig } from "@/lib/gauge-config";
import { LABEL_KINDS, deleteLabel, getLabelImage, getLabels, saveLabel, type Label, type LabelKind } from "@/lib/labels";
import { getSnapshot, getState, getSuspectImage, getSuspects } from "@/lib/store";
import { IDENTITY, applyTransform } from "@/lib/track";

const NO_STORE = { "cache-control": "no-store" };

/** Every label with the calibration it was read at, for tuning; or with `t`, that round's picture. */
export async function GET(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const t = new URL(req.url).searchParams.get("t");
  if (t === null) return Response.json({ labels: await getLabels() }, { headers: NO_STORE });
  const jpeg = await getLabelImage(Number(t));
  if (!jpeg) return Response.json({ error: "no such label" }, { status: 404, headers: NO_STORE });
  return new Response(Buffer.from(jpeg, "base64"), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" },
  });
}

type Body = {
  source: "suspect" | "snapshot";
  /** When the round was taken. */
  t: number;
  /** The round's place in the suspect list. */
  i?: number;
  verdict: "correct" | "corrected";
  /** With "corrected": what the picture really shows, and the row for a waterline or where the cover starts. */
  kind?: LabelKind;
  y?: number | null;
};

const bad = (error: string, status = 400) => Response.json({ error }, { status, headers: NO_STORE });

/** Label a suspicious round or the latest snapshot. The picture is copied from where it is kept now. */
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson<Body>(req);
  if (!body || !Number.isFinite(body.t)) return bad("need t");
  if (body.verdict !== "correct" && body.verdict !== "corrected") return bad("verdict must be correct or corrected");

  let found: { jpegBase64: string; reader: Label["reader"]; gauge?: GaugeConfig } | null = null;
  if (body.source === "suspect") {
    const i = body.i;
    if (!Number.isInteger(i) || (i as number) < 0) return bad("need i");
    const [suspects, jpegBase64] = await Promise.all([getSuspects(), getSuspectImage(i as number, body.t)]);
    const s = suspects[i as number];
    // Gone when newer rounds pushed it out, or moved down the list since the page loaded.
    if (!s || s.t !== body.t || !jpegBase64) return bad("picture no longer kept here", 404);
    found = { jpegBase64, reader: { y: s.y, estimate: s.estimate, reason: s.reason }, gauge: s.gauge };
  } else if (body.source === "snapshot") {
    const snap = await getSnapshot();
    if (!snap || snap.t !== body.t) return bad("a newer round has replaced this picture", 409);
    found = { jpegBase64: snap.jpegBase64, reader: { y: snap.y, estimate: snap.estimate }, gauge: snap.gauge };
  } else {
    return bad("source must be suspect or snapshot");
  }

  // Rounds kept before labels existed: the camera is read where it has the gauge now.
  let gauge = found.gauge;
  if (!gauge) {
    const [config, state] = await Promise.all([getConfig(), getState()]);
    gauge = applyTransform(config.gauge, config.autoTrack ? state.tracking.transform : IDENTITY);
  }

  let kind: LabelKind;
  let y: number | null;
  if (body.verdict === "correct") {
    const { reader } = found;
    if (reader.y === null) return bad("the reader drew no line on this round to agree with");
    kind = reader.estimate === "covered" ? "covered" : reader.estimate === "below" ? "below" : "waterline";
    y = kind === "below" ? null : reader.y;
  } else {
    if (!LABEL_KINDS.includes(body.kind as LabelKind)) return bad("unknown kind");
    kind = body.kind as LabelKind;
    y = null;
    if (kind === "waterline" || kind === "covered") {
      const row = body.y;
      if (!Number.isInteger(row) || (row as number) < 0 || (row as number) >= gauge.frame.height) return bad("y must be a row of the picture");
      y = row as number;
    }
  }

  const label: Label = {
    t: body.t,
    kind,
    y,
    verdict: body.verdict,
    reader: found.reader,
    gauge,
    source: body.source,
    labeledAt: Date.now(),
  };
  if (!(await saveLabel(label, found.jpegBase64))) return bad("label store is full; delete old labels first", 507);
  return Response.json({ label: { ...label, gauge: undefined } }, { headers: NO_STORE });
}

export async function DELETE(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const t = new URL(req.url).searchParams.get("t");
  if (!t || !Number.isFinite(Number(t))) return bad("need t");
  await deleteLabel(Number(t));
  return Response.json({ ok: true }, { headers: NO_STORE });
}
