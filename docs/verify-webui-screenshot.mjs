// Pixel-verifies a Web UI screenshot (AC100/AC96 criterion shape): the page must
// be a non-blank render — Modernist `--color-bg` light background dominant, dark
// body text present, and the accent `--color-accent-600` (#ec3013) present (token
// effective). Rejects an all-white / all-one-color / failed render.
//
// Usage: node docs/verify-webui-screenshot.mjs <screenshot.png>
// Prints one JSON line: { file, width, height, lightPct, darkPct, accentPixels, verdict }
// Exit 0 iff verdict === "non-blank".
//
// Self-contained PNG decoder: signature, IHDR, IDAT (zlib inflate), per-scanline
// filter reconstruction (types 0–4), truecolor RGB (colortype 2) / RGBA (6).

import zlib from "node:zlib";
import fs from "node:fs";

const ACCENT = [0xec, 0x30, 0x13]; // --color-accent-600 (Modernist token)

function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG (bad signature)`);
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`${file}: unsupported bit depth ${bitDepth} (want 8)`);
  if (!(colorType === 2 || colorType === 6)) {
    throw new Error(`${file}: unsupported color type ${colorType} (want 2=RGB or 6=RGBA)`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const line = raw.subarray(src, src + stride);
    src += stride;
    const recon = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? recon[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = line[x]; break;
        case 1: val = line[x] + a; break;
        case 2: val = line[x] + b; break;
        case 3: val = line[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`${file}: unknown scanline filter ${filter}`);
      }
      recon[x] = val & 0xff;
    }
    prev = Buffer.from(recon);
  }
  return { width, height, bpp, pixels: out };
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node docs/verify-webui-screenshot.mjs <screenshot.png>");
  process.exit(2);
}

const { width, height, bpp, pixels } = decodePng(file);
let light = 0;
let dark = 0;
let accent = 0;
for (let i = 0; i < pixels.length; i += bpp) {
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 230) light += 1;
  else if (lum < 100) dark += 1;
  if (r === ACCENT[0] && g === ACCENT[1] && b === ACCENT[2]) accent += 1;
}
const total = width * height;
const lightPct = (light / total) * 100;
const darkPct = (dark / total) * 100;
// Non-blank: light Modernist bg dominant, measurable dark text, accent token present.
const verdict = lightPct > 50 && darkPct > 0.2 && accent > 0 ? "non-blank" : "BLANK";
console.log(
  JSON.stringify({
    file,
    width,
    height,
    lightPct: +lightPct.toFixed(1),
    darkPct: +darkPct.toFixed(1),
    accentPixels: accent,
    verdict,
  }),
);
process.exit(verdict === "non-blank" ? 0 : 1);
