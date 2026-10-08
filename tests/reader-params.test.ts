import { describe, expect, it } from "vitest";
import { DEFAULT_READER_PARAMS, READER_BOUNDS, READER_KEYS, validateReaderParams } from "@/lib/reader-params";

describe("reader numbers from /admin", () => {
  it("ship inside the bounds tuning keeps to", () => {
    expect(validateReaderParams(DEFAULT_READER_PARAMS)).toBeNull();
    for (const k of READER_KEYS) {
      expect(DEFAULT_READER_PARAMS[k]).toBeGreaterThanOrEqual(READER_BOUNDS[k].min);
      expect(DEFAULT_READER_PARAMS[k]).toBeLessThanOrEqual(READER_BOUNDS[k].max);
    }
  });

  it("refuse anything that is not a full set of numbers in bounds", () => {
    expect(validateReaderParams(null)).not.toBeNull();
    expect(validateReaderParams({ ...DEFAULT_READER_PARAMS, whiteTint: Number.NaN })).not.toBeNull();
    expect(validateReaderParams({ ...DEFAULT_READER_PARAMS, faceMin: "0.2" })).not.toBeNull();
    expect(validateReaderParams({ ...DEFAULT_READER_PARAMS, busyUnder: 0.9 })).not.toBeNull();
    expect(validateReaderParams({ ...DEFAULT_READER_PARAMS, refineRows: 4.5 })).not.toBeNull();
    expect(validateReaderParams({ ...DEFAULT_READER_PARAMS, waterSoft: 0.08, waterMax: 0.1 })).not.toBeNull();
    expect(validateReaderParams({ ...DEFAULT_READER_PARAMS, unknown: 1 })).not.toBeNull();
    expect(validateReaderParams({ ...DEFAULT_READER_PARAMS, dropMin: undefined })).not.toBeNull();
  });
});
