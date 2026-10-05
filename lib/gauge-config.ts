// Calibration for the staff gauge in the Nonthaburi pier camera (800x600 stream).
// Measured 2026-10-03 from night frames. The gauge leans right as it goes down,
// so the scan follows a slanted axis through the middle of the white face.
//
// Marks are the vertical centres of the decimetre labels (".90", "80", ...).
// The meter digit at the plate joint is not legible in the stream; the lower
// plate is assumed to read 1.xx m and the upper plate 2.xx m. Confirm in /admin.

export type Point = { x: number; y: number };

export type GaugeMark = { y: number; level: number };

export type GaugeConfig = {
  version: number;
  frame: { width: number; height: number };
  /** Centre line of the gauge face, top and bottom of the usable span. */
  axis: { top: Point; bottom: Point };
  /** Pixels sampled either side of the axis on each row. */
  halfWidth: number;
  /** Rows that stay dry in any realistic flood; used to learn what "white" looks like. */
  baseline: { y0: number; y1: number };
  /** Calibration marks, ordered top to bottom. */
  marks: GaugeMark[];
};

export const DEFAULT_GAUGE_CONFIG: GaugeConfig = {
  version: 1,
  frame: { width: 800, height: 600 },
  axis: { top: { x: 473, y: 8 }, bottom: { x: 527, y: 420 } },
  halfWidth: 9,
  baseline: { y0: 20, y1: 150 },
  marks: [
    { y: 29, level: 2.9 },
    { y: 50, level: 2.8 },
    { y: 72, level: 2.7 },
    { y: 91, level: 2.6 },
    { y: 114, level: 2.5 },
    { y: 132, level: 2.4 },
    { y: 154, level: 2.3 },
    { y: 172, level: 2.2 },
    { y: 193, level: 2.1 },
    { y: 214, level: 2.0 },
    { y: 234, level: 1.9 },
    { y: 254, level: 1.8 },
    { y: 275, level: 1.7 },
    { y: 294, level: 1.6 },
    { y: 312, level: 1.5 },
    { y: 331, level: 1.4 },
    { y: 352, level: 1.3 },
  ],
};
