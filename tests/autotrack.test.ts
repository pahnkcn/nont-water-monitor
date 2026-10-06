import { describe, expect, it } from "vitest";
import { INITIAL_TRACKING, decideTracking, type TrackingContext, type TrackingState } from "@/lib/autotrack";
import type { GaugeReading } from "@/lib/gauge";
import { IDENTITY, type TrackResult, type Transform } from "@/lib/track";

const good: GaugeReading = { ok: true, level: 1.5, y: 300, confidence: "high", aboveTop: false, belowRange: false, approx: false, frames: [] };
const weak: GaugeReading = { ...good, confidence: "low", reason: "weak-edge" };
const blind: GaugeReading = { ...good, ok: false, level: null, confidence: "low", reason: "gauge-not-visible" };

const found = (t: Partial<Transform>): TrackResult => ({
  found: true,
  transform: { ...IDENTITY, ...t },
  score: 0.95,
  margin: 0.4,
  ref: 0,
  covered: false,
  atLast: 0.9,
});
/** Search failed, but the patch at the last position still looks like the gauge (light changed). */
const lost: TrackResult = { found: false, transform: IDENTITY, score: 0.3, margin: 0.02, ref: 0, covered: false, atLast: 0.55 };
/** Search failed and the last position shows something else entirely. */
const gone: TrackResult = { ...lost, atLast: 0.05 };

const ctx = (over: Partial<TrackingContext> = {}): TrackingContext => ({
  auto: true,
  refs: [{ meanLuma: 160 }],
  lumaNow: () => 158,
  now: 1_000,
  ...over,
});

/** A reader that records which position it was asked to read at. */
function reader(result: GaugeReading = good) {
  const asked: Transform[] = [];
  return { asked, read: (t: Transform) => (asked.push(t), result) };
}

const settled = (t: Partial<Transform> = {}): TrackingState => ({ ...INITIAL_TRACKING, status: "ok", transform: { ...IDENTITY, ...t } });

describe("decideTracking", () => {
  it("reads the saved calibration untouched when auto-tracking is off", () => {
    const r = reader();
    const out = decideTracking(settled({ dx: 9 }), found({ dx: 20 }), ctx({ auto: false }), r.read);
    expect(r.asked).toEqual([IDENTITY]);
    expect(out.state.status).toBe("manual");
    expect(out.reading).toBe(good);
  });

  it("learns its first reference from the first clear reading", () => {
    const r = reader();
    const out = decideTracking(INITIAL_TRACKING, null, ctx({ refs: [] }), r.read);
    expect(out.learn).toEqual(IDENTITY);
    expect(out.state.status).toBe("ok");
  });

  it("waits for a clear reading before learning", () => {
    const out = decideTracking(INITIAL_TRACKING, null, ctx({ refs: [] }), reader(weak).read);
    expect(out.learn).toBeNull();
    expect(out.state.status).toBe("learning");
  });

  it("follows small drift without fuss", () => {
    const r = reader();
    const out = decideTracking(settled(), found({ dx: 1.2, dy: -0.8 }), ctx(), r.read);
    expect(r.asked).toEqual([{ dx: 1.2, dy: -0.8, scale: 1 }]);
    expect(out.state.status).toBe("ok");
    expect(out.reading).toBe(good);
    expect(out.notices).toEqual([]);
  });

  it("reads at a new position after a jump but holds the reading back until the next round agrees", () => {
    const r = reader();
    const first = decideTracking(settled(), found({ dx: 14, dy: 9 }), ctx(), r.read);
    expect(r.asked).toEqual([{ dx: 14, dy: 9, scale: 1 }]);
    expect(first.state.status).toBe("moved");
    expect(first.reading.confidence).toBe("low");
    expect(first.reading.reason).toBe("camera-moved");
    expect(first.notices).toEqual([]);

    const second = decideTracking(first.state, found({ dx: 14.4, dy: 8.7 }), ctx({ now: 2_000 }), reader().read);
    expect(second.state.status).toBe("ok");
    expect(second.reading.confidence).toBe("high");
    expect(second.notices).toEqual([expect.objectContaining({ kind: "adjusted" })]);
  });

  it("keeps holding back while the camera is still moving", () => {
    const first = decideTracking(settled(), found({ dx: 14 }), ctx(), reader().read);
    const second = decideTracking(first.state, found({ dx: 30 }), ctx(), reader().read);
    expect(second.state.status).toBe("moved");
    expect(second.reading.confidence).toBe("low");
    expect(second.notices).toEqual([]);
  });

  it("trusts the old position when the tracker is unsure but the gauge reads cleanly there", () => {
    const r = reader();
    const out = decideTracking(settled({ dy: 3 }), lost, ctx(), r.read);
    expect(r.asked).toEqual([{ dx: 0, dy: 3, scale: 1 }]);
    expect(out.reading).toBe(good);
    expect(out.state.lostStreak).toBe(0);
  });

  it("learns another reference when the light has changed, so day and night both match next time", () => {
    const daylight = decideTracking(settled({ dy: 3 }), lost, ctx({ lumaNow: () => 210 }), reader().read);
    expect(daylight.learn).toEqual({ dx: 0, dy: 3, scale: 1 });
    const sameLight = decideTracking(settled({ dy: 3 }), lost, ctx({ lumaNow: () => 170 }), reader().read);
    expect(sameLight.learn).toBeNull();
  });

  it("does not trust a clean-looking reading at the old position when the scene there has changed", () => {
    // Something else entirely can still have a bright strip over a dark one where the gauge was.
    const out = decideTracking(settled(), gone, ctx({ lumaNow: () => 90 }), reader(good).read);
    expect(out.reading.ok).toBe(false);
    expect(out.reading.reason).toBe("gauge-lost");
    expect(out.learn).toBeNull();
  });

  it("refuses to read when the gauge cannot be found and tells the admin after half an hour", () => {
    let state = settled();
    const notices: string[] = [];
    const reasons: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      const out = decideTracking(state, gone, ctx({ now: i }), reader(weak).read);
      state = out.state;
      reasons.push(out.reading.ok ? "read" : out.reading.reason);
      notices.push(...out.notices.map((n) => n.kind));
    }
    expect(reasons).toEqual(["gauge-lost", "gauge-lost", "gauge-lost", "gauge-lost", "gauge-lost"]);
    expect(state.status).toBe("lost");
    expect(notices).toEqual(["lost"]);
  });

  it("keeps the last position while flood water hides the patch", () => {
    const r = reader();
    const covered: TrackResult = { ...lost, covered: true };
    const out = decideTracking(settled({ dx: 5 }), covered, ctx(), r.read);
    expect(r.asked).toEqual([{ dx: 5, dy: 0, scale: 1 }]);
    expect(out.state.status).toBe("covered");
    expect(out.reading).toBe(good);
  });

  it("leaves dark frames to the gauge reader at the last position", () => {
    const r = reader(blind);
    const out = decideTracking(settled({ dx: 5 }), null, ctx(), r.read);
    expect(r.asked).toEqual([{ dx: 5, dy: 0, scale: 1 }]);
    expect(out.reading).toBe(blind);
    expect(out.state.status).toBe("ok");
  });
});
