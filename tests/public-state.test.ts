import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "@/lib/alerts";
import { INITIAL_TRACKING, type TrackingState } from "@/lib/autotrack";
import { DEFAULT_GAUGE_CONFIG } from "@/lib/gauge-config";
import { snapshotThresholdRows } from "@/lib/public-state";

// Default marks: 2.50 at row 114, 2.20 at row 172; default thresholds sit right on them.
const config = { gauge: DEFAULT_GAUGE_CONFIG, thresholds: DEFAULT_THRESHOLDS, autoTrack: true };
const tracking = (patch: Partial<TrackingState> = {}): TrackingState => ({ ...INITIAL_TRACKING, status: "ok", ...patch });

describe("snapshotThresholdRows", () => {
  it("puts the watch and danger levels on their gauge marks", () => {
    expect(snapshotThresholdRows(config, tracking())).toEqual({ watch: 172, danger: 114 });
  });

  it("follows the camera to where the round found the gauge", () => {
    const moved = tracking({ status: "moved", transform: { dx: 6, dy: 20, scale: 1 } });
    expect(snapshotThresholdRows(config, moved)).toEqual({ watch: 192, danger: 134 });
  });

  it("uses the saved calibration as is when tracking is switched off", () => {
    const stale = tracking({ status: "manual", transform: { dx: 0, dy: 20, scale: 1 } });
    expect(snapshotThresholdRows({ ...config, autoTrack: false }, stale)).toEqual({ watch: 172, danger: 114 });
  });

  it("draws nothing while the gauge is lost", () => {
    expect(snapshotThresholdRows(config, tracking({ status: "lost" }))).toBeNull();
  });

  it("draws nothing when the calibration cannot place a threshold", () => {
    // The top two marks typed with the same level: no slope to extrapolate up to danger at 3.00.
    const marks = [{ y: 29, level: 2.9 }, { y: 50, level: 2.9 }, ...DEFAULT_GAUGE_CONFIG.marks.slice(2)];
    const typo = {
      gauge: { ...DEFAULT_GAUGE_CONFIG, marks },
      thresholds: { ...DEFAULT_THRESHOLDS, danger: 3.0 },
      autoTrack: true,
    };
    expect(snapshotThresholdRows(typo, tracking())).toBeNull();
  });
});
