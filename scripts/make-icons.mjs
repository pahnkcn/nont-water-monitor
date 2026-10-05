// Draws the app icons (louvred shutter with river water closing the lower slats)
// straight into PNG files. Provisional icon: replace public/icons/* if a real logo exists.
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const C = { frame: hex("#22302F"), slat: hex("#E4E6E1"), edge: hex("#C3C8C1"), water: hex("#7A6235"), waterEdge: hex("#5E4B29"), line: hex("#C9A227") };

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x / size, y / size), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Full-bleed icon; the louvre sits in the central safe zone so maskable crops keep it.
function louvre(u, v) {
  const x0 = 0.24, x1 = 0.76, y0 = 0.18, y1 = 0.82, stile = 0.045;
  if (u < x0 || u > x1 || v < y0 || v > y1) return C.frame;
  if (u < x0 + stile || u > x1 - stile || v < y0 + stile || v > y1 - stile) return C.frame;
  const inner = (v - (y0 + stile)) / (y1 - y0 - 2 * stile);
  const slats = 7;
  const pos = (inner * slats) % 1;
  const waterTop = 0.58;
  const edge = pos > 0.72 && pos < 0.92;
  if (Math.abs(inner - waterTop) < 0.012) return C.line;
  if (inner > waterTop) return edge ? C.waterEdge : C.water;
  return edge ? C.edge : C.slat;
}

// Notification badge: white slats on transparent, lower slats solid.
function badge(u, v) {
  const t = [0, 0, 0, 0], w = [255, 255, 255, 255];
  if (u < 0.2 || u > 0.8 || v < 0.16 || v > 0.84) return t;
  const inner = (v - 0.16) / 0.68;
  const pos = (inner * 6) % 1;
  if (inner > 0.6) return w;
  return pos < 0.6 ? w : t;
}

mkdirSync("public/icons", { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(`public/icons/${name}`, png(size, louvre));
}
writeFileSync("public/icons/badge-96.png", png(96, badge));
console.log("icons written");
