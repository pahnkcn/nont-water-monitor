// The numbers the gauge reader judges by (lib/gauge.ts), kept in the site config so /admin can swap
// in a set tuned on the rounds an admin has labelled (lib/tune.ts) without a deploy.

export type ReaderParams = {
  /** A face pixel is at least this bright against the face above... */
  whiteOfFace: number;
  /** ...and this close to its colour (distance between rgb shares). */
  whiteTint: number;
  /** Share of white pixels above a waterline; the marks cover much of the rest. */
  faceMin: number;
  /** Share of white pixels below a clean waterline. */
  waterMax: number;
  /** Below it when nothing passes waterMax... */
  waterSoft: number;
  /** ...as long as the share drops by this much. */
  dropMin: number;
  /** The line goes where the contrast peaks this many rows under the first match. */
  refineRows: number;
  /** Share of a row's pixels that hides the row (pipe, rope, plants). */
  hiddenRow: number;
  /** Hidden rows in a row under the face's end that hide the water. */
  plantRun: number;
  /** Rows under the face's end that tell open water from plants. */
  plantsUnder: number;
  /** Share of plant pixels there that hides the water. */
  plantsCover: number;
  /** Spread of brightness there, against the face's white, that tells a mat of leaves from open water. */
  busyUnder: number;
};

export const DEFAULT_READER_PARAMS: ReaderParams = {
  whiteOfFace: 0.8,
  whiteTint: 0.05,
  faceMin: 0.2,
  waterMax: 0.08,
  waterSoft: 0.15,
  dropMin: 0.15,
  refineRows: 8,
  hiddenRow: 0.5,
  plantRun: 8,
  plantsUnder: 16,
  plantsCover: 0.2,
  busyUnder: 0.55,
};

/** How far tuning may move each number, and in what steps. Counts of rows stay whole. */
export const READER_BOUNDS: Record<keyof ReaderParams, { min: number; max: number; step: number }> = {
  whiteOfFace: { min: 0.6, max: 0.95, step: 0.025 },
  whiteTint: { min: 0.02, max: 0.1, step: 0.01 },
  faceMin: { min: 0.1, max: 0.4, step: 0.025 },
  waterMax: { min: 0.03, max: 0.15, step: 0.01 },
  waterSoft: { min: 0.08, max: 0.3, step: 0.01 },
  dropMin: { min: 0.05, max: 0.3, step: 0.025 },
  refineRows: { min: 2, max: 16, step: 1 },
  hiddenRow: { min: 0.3, max: 0.8, step: 0.05 },
  plantRun: { min: 4, max: 16, step: 1 },
  plantsUnder: { min: 8, max: 30, step: 2 },
  plantsCover: { min: 0.1, max: 0.4, step: 0.025 },
  busyUnder: { min: 0.4, max: 0.75, step: 0.025 },
};

export const READER_KEYS = Object.keys(DEFAULT_READER_PARAMS) as (keyof ReaderParams)[];

export function validateReaderParams(p: unknown): string | null {
  if (!p || typeof p !== "object") return "ค่าตัวอ่านไม่ถูกต้อง";
  const x = p as Record<string, unknown>;
  const unknown = Object.keys(x).find((k) => !(k in DEFAULT_READER_PARAMS));
  if (unknown) return `ไม่รู้จักค่า ${unknown}`;
  for (const k of READER_KEYS) {
    const v = x[k];
    const { min, max, step } = READER_BOUNDS[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return `${k} ต้องเป็นตัวเลข`;
    if (v < min - 1e-9 || v > max + 1e-9) return `${k} ต้องอยู่ระหว่าง ${min} ถึง ${max}`;
    if (Number.isInteger(step) && !Number.isInteger(v)) return `${k} ต้องเป็นจำนวนเต็ม`;
  }
  if ((x.waterSoft as number) < (x.waterMax as number)) return "waterSoft ต้องไม่ต่ำกว่า waterMax";
  return null;
}
