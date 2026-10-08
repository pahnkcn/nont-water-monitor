import { DEFAULT_THRESHOLDS, type Thresholds } from "./alerts";
import { DEFAULT_GAUGE_CONFIG, type GaugeConfig } from "./gauge-config";
import { KEYS, kv } from "./kv";
import { DEFAULT_READER_PARAMS, type ReaderParams } from "./reader-params";
import { resetTracking, resyncAlerts } from "./store";

export type SiteConfig = {
  thresholds: Thresholds;
  gauge: GaugeConfig;
  /** Follow the gauge when the camera moves (lib/track.ts). Off reads the saved calibration as is. */
  autoTrack: boolean;
  /** True until an admin has saved real thresholds. */
  thresholdsArePlaceholders: boolean;
  /** Goes up by one each time a calibration is saved; a round that sees it change drops its tracking. */
  calibration: number;
  /** The numbers the gauge reader judges by; tuned in /admin on labelled rounds (lib/tune.ts). */
  reader: ReaderSettings;
  updatedAt: number | null;
};

/** `savedAt` is null while the shipped numbers are in use; `labels` is how many rounds they were tuned on. */
export type ReaderSettings = { params: ReaderParams; savedAt: number | null; labels: number };

const DEFAULT_READER: ReaderSettings = { params: DEFAULT_READER_PARAMS, savedAt: null, labels: 0 };

type StoredConfig = Partial<Omit<SiteConfig, "thresholdsArePlaceholders">> & {
  thresholdsConfirmed?: boolean;
};

export async function getConfig(): Promise<SiteConfig> {
  const stored = (await kv().get<StoredConfig>(KEYS.config)) ?? {};
  return {
    thresholds: { ...DEFAULT_THRESHOLDS, ...stored.thresholds },
    gauge: stored.gauge ?? DEFAULT_GAUGE_CONFIG,
    autoTrack: stored.autoTrack ?? true,
    thresholdsArePlaceholders: !stored.thresholdsConfirmed,
    calibration: stored.calibration ?? 0,
    // A number added to the reader later starts from its shipped value.
    reader: stored.reader ? { ...stored.reader, params: { ...DEFAULT_READER_PARAMS, ...stored.reader.params } } : DEFAULT_READER,
    updatedAt: stored.updatedAt ?? null,
  };
}

export function validateThresholds(t: Thresholds): string | null {
  const nums = [t.watch, t.danger, t.hysteresis, t.repeatStep];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) return "ค่าต้องเป็นตัวเลข";
  if (t.watch >= t.danger) return "ระดับเฝ้าระวังต้องต่ำกว่าระดับอันตราย";
  if (t.watch < 0 || t.danger > 10) return "ค่าอยู่นอกช่วงของไม้วัด";
  if (t.hysteresis < 0 || t.hysteresis > 0.5) return "ระยะกันแกว่งต้องอยู่ระหว่าง 0 ถึง 0.5 ม.";
  if (t.repeatStep < 0.02 || t.repeatStep > 1) return "ระยะเตือนซ้ำต้องอยู่ระหว่าง 0.02 ถึง 1 ม.";
  return null;
}

export function validateGauge(g: GaugeConfig): string | null {
  if (!g || !Array.isArray(g.marks) || g.marks.length < 2) return "ต้องมีจุดเทียบอย่างน้อย 2 จุด";
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (!g.marks.every((m) => ok(m.y) && ok(m.level))) return "จุดเทียบไม่ถูกต้อง";
  const ys = g.marks.map((m) => m.y);
  if (new Set(ys).size !== ys.length) return "จุดเทียบซ้ำตำแหน่งกัน";
  const { top, bottom } = g.axis ?? {};
  if (![top?.x, top?.y, bottom?.x, bottom?.y].every(ok) || top.y >= bottom.y) return "แกนไม้วัดไม่ถูกต้อง";
  if (!ok(g.halfWidth) || g.halfWidth < 2 || g.halfWidth > 40) return "ความกว้างแถบไม่ถูกต้อง";
  return null;
}

export async function saveConfig(patch: {
  thresholds?: Thresholds;
  gauge?: GaugeConfig;
  autoTrack?: boolean;
  /** Tuned reader numbers, with how many labelled rounds they were tuned on. */
  reader?: { params: ReaderParams; labels: number };
  resetReader?: boolean;
}) {
  const stored = (await kv().get<StoredConfig>(KEYS.config)) ?? {};
  const now = Date.now();
  const next: StoredConfig = { ...stored, updatedAt: now };
  if (patch.thresholds) {
    next.thresholds = patch.thresholds;
    next.thresholdsConfirmed = true;
  }
  if (patch.gauge) {
    next.gauge = { ...patch.gauge, marks: [...patch.gauge.marks].sort((a, b) => a.y - b.y) };
    next.calibration = (stored.calibration ?? 0) + 1;
  }
  if (typeof patch.autoTrack === "boolean") next.autoTrack = patch.autoTrack;
  if (patch.reader) next.reader = { params: patch.reader.params, labels: patch.reader.labels, savedAt: now };
  if (patch.resetReader) delete next.reader;
  await kv().set(KEYS.config, next);
  // A calibration saved by hand is drawn on the camera as it is now: start tracking from it afresh.
  if (patch.gauge) await resetTracking();
  if (patch.thresholds) await resyncAlerts(patch.thresholds, Date.now());
}
