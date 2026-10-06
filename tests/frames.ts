import { execFileSync } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { RGBFrame } from "@/lib/gauge";
import { DEFAULT_GAUGE_CONFIG } from "@/lib/gauge-config";

export const FIXTURES = path.join(__dirname, "fixtures");

export function loadFrame(file: string): RGBFrame {
  const data = execFileSync(
    ffmpegPath as string,
    ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { maxBuffer: 1 << 24 },
  );
  return { width: 800, height: 600, data: new Uint8Array(data) };
}

/**
 * What the camera would see after moving: the scene point at `p` now shows at
 * `c + scale * (p - c) + (dx, dy)`. Pixels that come from outside the old frame are grey.
 */
export function moveCamera(
  frame: RGBFrame,
  move: { dx?: number; dy?: number; scale?: number; about?: { x: number; y: number } },
): RGBFrame {
  const { dx = 0, dy = 0, scale = 1 } = move;
  const c = move.about ?? { x: frame.width / 2, y: frame.height / 2 };
  const out = new Uint8Array(frame.data.length);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const sx = c.x + (x - dx - c.x) / scale;
      const sy = c.y + (y - dy - c.y) / scale;
      const o = (y * frame.width + x) * 3;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= frame.width || y0 + 1 >= frame.height) {
        out[o] = out[o + 1] = out[o + 2] = 110;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const p = (yy: number, xx: number) => frame.data[(yy * frame.width + xx) * 3 + ch];
        const top = p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx;
        const bottom = p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx;
        out[o + ch] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { width: frame.width, height: frame.height, data: out };
}

/** Same scene under different light: per-channel gain, offset and gamma, clamped to 0-255. */
export function relight(frame: RGBFrame, opts: { gain?: number; offset?: number; gamma?: number }): RGBFrame {
  const { gain = 1, offset = 0, gamma = 1 } = opts;
  const out = new Uint8Array(frame.data.length);
  for (let i = 0; i < frame.data.length; i++) {
    const v = 255 * Math.pow(frame.data[i] / 255, gamma) * gain + offset;
    out[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { width: frame.width, height: frame.height, data: out };
}

/** Where a calibration point lands after `moveCamera` with the same arguments. */
export function movedPoint(
  p: { x: number; y: number },
  move: { dx?: number; dy?: number; scale?: number; about?: { x: number; y: number } },
  frame = { width: 800, height: 600 },
) {
  const { dx = 0, dy = 0, scale = 1 } = move;
  const c = move.about ?? { x: frame.width / 2, y: frame.height / 2 };
  return { x: c.x + scale * (p.x - c.x) + dx, y: c.y + scale * (p.y - c.y) + dy };
}

/** Plain frame: grey wall, white gauge strip with dark bars down to `waterY`, brown water below. */
export function syntheticFrame(waterY: number, opts: { pipeAt?: number; dark?: boolean } = {}): RGBFrame {
  const width = 800;
  const height = 600;
  const data = new Uint8Array(width * height * 3);
  const cfg = DEFAULT_GAUGE_CONFIG;
  const slope = (cfg.axis.bottom.x - cfg.axis.top.x) / (cfg.axis.bottom.y - cfg.axis.top.y);
  for (let y = 0; y < height; y++) {
    const cx = cfg.axis.top.x + (y - cfg.axis.top.y) * slope;
    for (let x = 0; x < width; x++) {
      let rgb: [number, number, number] = [120, 120, 115];
      const onGauge = Math.abs(x - cx) <= 16;
      if (y >= waterY) rgb = [118, 96, 60];
      else if (onGauge) rgb = y % 10 < 2 && x > cx ? [30, 30, 60] : [235, 235, 232];
      if (opts.pipeAt !== undefined && y >= opts.pipeAt && y < opts.pipeAt + 10) rgb = [40, 120, 220];
      if (opts.dark) rgb = [6, 6, 6];
      const i = (y * width + x) * 3;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    }
  }
  return { width, height, data };
}
