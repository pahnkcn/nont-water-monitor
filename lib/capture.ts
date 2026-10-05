import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { RGBFrame } from "./gauge";

export const STREAM_URL =
  process.env.STREAM_URL ?? "https://stream.firsttech.co.th/live/nakornnont.stream/playlist.m3u8";

const WIDTH = 800;
const HEIGHT = 600;
const FRAME_BYTES = WIDTH * HEIGHT * 3;

export type Capture = { frames: RGBFrame[]; jpeg: Buffer; capturedAt: number };

/**
 * Pull a few seconds from the newest HLS segment: three frames one second apart
 * as raw RGB for the gauge reader, plus one JPEG for the dashboard and notifications.
 */
export async function captureFrames(opts: { frames?: number; timeoutMs?: number } = {}): Promise<Capture> {
  const count = opts.frames ?? 3;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  if (!ffmpegPath) throw new Error("ffmpeg binary not found");
  const jpegPath = path.join(tmpdir(), `nont-${randomUUID()}.jpg`);
  const capturedAt = Date.now();

  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-rw_timeout", "15000000",
    "-live_start_index", "-1",
    "-i", STREAM_URL,
    "-map", "0:v:0", "-vf", `fps=1,scale=${WIDTH}:${HEIGHT}`, "-frames:v", String(count),
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    "-map", "0:v:0", "-vf", `scale=${WIDTH}:${HEIGHT}`, "-frames:v", "1", "-q:v", "8", "-f", "image2", jpegPath,
  ];

  const raw = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath as string, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });

  try {
    const frames: RGBFrame[] = [];
    for (let off = 0; off + FRAME_BYTES <= raw.length; off += FRAME_BYTES) {
      frames.push({ width: WIDTH, height: HEIGHT, data: new Uint8Array(raw.subarray(off, off + FRAME_BYTES)) });
    }
    if (!frames.length) throw new Error("stream returned no frames");
    const jpeg = await readFile(jpegPath);
    return { frames, jpeg, capturedAt };
  } finally {
    await rm(jpegPath, { force: true });
  }
}
