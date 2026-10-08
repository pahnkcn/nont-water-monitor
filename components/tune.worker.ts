import { sampleGauge, type RGBFrame } from "@/lib/gauge";
import type { Label } from "@/lib/labels";
import type { ReaderParams } from "@/lib/reader-params";
import { evaluate, tune, type Evaluation, type Sample, type TuneResult } from "@/lib/tune";

// Reads the labelled pictures off the main thread: tuning reads each of them hundreds of times.

/** `labels` are scored ones; `images[i]` is the picture of `labels[i]`. */
export type TuneRequest = { job: "evaluate" | "tune"; labels: Label[]; images: Blob[]; params: ReaderParams };

export type TuneReply =
  | { type: "progress"; done: number; total: number }
  | { type: "evaluated"; evaluation: Evaluation }
  | { type: "tuned"; result: TuneResult }
  | { type: "error"; message: string };

const reply = (msg: TuneReply) => self.postMessage(msg);

/** The picture as the reader sees a frame: packed RGB at the calibration's size. */
async function decode(blob: Blob, width: number, height: number): Promise<RGBFrame> {
  // No colour management: the camera's JPEGs carry no profile, and the server reads raw pixels.
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });
  const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    data[j] = rgba[i];
    data[j + 1] = rgba[i + 1];
    data[j + 2] = rgba[i + 2];
  }
  return { width, height, data };
}

self.onmessage = async (e: MessageEvent<TuneRequest>) => {
  const { job, labels, images, params } = e.data;
  try {
    const samples: Sample[] = [];
    for (let i = 0; i < labels.length; i++) {
      const { t, kind, y, gauge } = labels[i];
      const frame = await decode(images[i], gauge.frame.width, gauge.frame.height);
      samples.push({ t, kind, y, gauge, pixels: sampleGauge(frame, gauge) });
    }
    if (job === "evaluate") reply({ type: "evaluated", evaluation: evaluate(samples, params) });
    else reply({ type: "tuned", result: tune(samples, params, (done, total) => reply({ type: "progress", done, total })) });
  } catch (err) {
    reply({ type: "error", message: (err as Error).message });
  }
};
