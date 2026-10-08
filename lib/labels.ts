import type { GaugeConfig } from "./gauge-config";
import { KEYS, kv } from "./kv";
import type { Estimate } from "./summary";

// Rounds an admin has looked at and said where the water really was. They outlive the suspect
// list (lib/jump.ts keeps 24) and are what lib/tune.ts scores the reader's numbers against.

/**
 * "waterline": open water meets the face at `y`. "covered": something afloat hides the gauge from
 * `y` down, the water is lower. "below": the water is under every row the reader scans.
 * "unreadable": nothing to learn from (someone in front, the camera turned away); kept, not scored.
 */
export type LabelKind = "waterline" | "covered" | "below" | "unreadable";
export const LABEL_KINDS: readonly LabelKind[] = ["waterline", "covered", "below", "unreadable"];

export type Label = {
  /** When the round was taken; also its key. */
  t: number;
  kind: LabelKind;
  /** Image row; null for "below" and "unreadable". */
  y: number | null;
  /** "correct" when the admin agreed with the reader, "corrected" when they put the line elsewhere. */
  verdict: "correct" | "corrected";
  /** What the reader saw that round. */
  reader: { y: number | null; estimate?: Estimate; reason?: string };
  /** The calibration as the round was read, with the camera's move at the time already applied. */
  gauge: GaugeConfig;
  source: "suspect" | "snapshot";
  labeledAt: number;
};

/** Roughly 135 KB a picture: about 40 MB, well inside the free Upstash plan. */
export const MAX_LABELS = 300;

/** Newest first. */
export async function getLabels(): Promise<Label[]> {
  return Object.values(await kv().hgetall<Label>(KEYS.labels)).sort((a, b) => b.t - a.t);
}

export async function getLabelImage(t: number): Promise<string | null> {
  return (await kv().hget<{ jpegBase64: string }>(KEYS.labelImages, String(t)))?.jpegBase64 ?? null;
}

/** Saves the label of a round, replacing an earlier one for the same round. False when the store is full. */
export async function saveLabel(label: Label, jpegBase64: string): Promise<boolean> {
  const key = String(label.t);
  if (!(await kv().hget<Label>(KEYS.labels, key)) && (await kv().hlen(KEYS.labels)) >= MAX_LABELS) return false;
  // The picture goes first, so a listed label always has one.
  await kv().hset(KEYS.labelImages, { [key]: { jpegBase64 } });
  await kv().hset(KEYS.labels, { [key]: label });
  return true;
}

export async function deleteLabel(t: number) {
  await kv().hdel(KEYS.labels, String(t));
  await kv().hdel(KEYS.labelImages, String(t));
}
