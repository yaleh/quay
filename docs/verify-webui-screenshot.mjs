// Pixel-verifies a Web UI screenshot (AC100/AC96 criterion shape): the page must
// be a non-blank render — Modernist `--color-bg` light background dominant, dark
// body text present, and the accent `--color-accent-600` present (token effective).
// Rejects an all-white / all-one-color / failed render.
//
// ⛔ The accent value is NOT written down here — it is READ from
// packages/quay/src/webui-modernist.css, the design system's single source of
// truth (which the server inlines into every page it renders). A literal here is
// the defect `gap-readme-ac278-four-screenshots-and-verify-token-drift` fixed: this
// file pinned #ec3013, the CSS moved to #dd2b0f, and the instrument went SILENTLY
// constant-false — judging every real render BLANK, with a failure shape that
// looked like "the UI broke".
//
// Usage: node docs/verify-webui-screenshot.mjs <screenshot.png>
// Prints one JSON line:
//   { file, width, height, lightPct, darkPct, accentPixels, accentToken,
//     accentTokenSource, accentBasePixels, verdict }
// Exit 0 iff verdict === "non-blank"; 1 iff "BLANK"; 2 iff "NOT-EVALUATED"
// (the token could not be read — a broken instrument, deliberately NOT reported
// in the same shape as a failed render; see the three-state note below).
//
// ⚠️ Three states, not two (hard rule 3b): "could not read the token" must not
// share an output shape with "the render is blank", or a broken reader is
// indistinguishable from a broken page.
//
// ⚠️ Known limit, reported rather than hidden: the verdict keys on
// `--color-accent-600` (the fill token). Pages whose accent styling uses the base
// `--color-accent` token instead carry no accent-600 pixels and WILL be judged
// BLANK — e.g. /goal and /task/<id> on 2026-09-17, ~1235 and ~399 base-accent
// pixels each and 0 accent-600. `accentBasePixels` is reported alongside so that
// case is legible as a criterion-shape limit, not misread as a broken render.
//
// Self-contained PNG decoder: signature, IHDR, IDAT (zlib inflate), per-scanline
// filter reconstruction (types 0–4), truecolor RGB (colortype 2) / RGBA (6).

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.join(HERE, "..", "packages", "quay", "src", "webui-modernist.css");

// Per-channel tolerance for "this pixel is the token". Absorbs anti-aliasing /
// compositing fringe without reaching a genuinely different token: the retired
// #ec3013 sits 15 apart from the current #dd2b0f on the red channel, so Δ≤4
// still separates them (measured 2026-09-17: old-token render ⇒ 0 px at Δ≤8).
const ACCENT_TOLERANCE = 4;

// Read a `--color-*` custom property out of the Modernist stylesheet. Returns
// null when the file or the declaration is absent — the caller must treat that
// as NOT-EVALUATED, never as "no accent pixels found".
function readCssToken(cssPath, varName) {
  let css;
  try {
    css = fs.readFileSync(cssPath, "utf8");
  } catch {
    return null;
  }
  const m = css.match(new RegExp(`${varName}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  if (!m) return null;
  let hex = m[1].slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length !== 6) return null;
  return {
    hex: `#${hex.toLowerCase()}`,
    rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)],
  };
}

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

// ── Resolve the tokens from the stylesheet, not from a literal here ────────────
const accentToken = readCssToken(CSS_PATH, "--color-accent-600");
const accentBase = readCssToken(CSS_PATH, "--color-accent");
if (!accentToken) {
  // Distinctly NOT "BLANK": the instrument is broken, not the render. Exit 2.
  console.log(
    JSON.stringify({
      file,
      evaluated: false,
      verdict: "NOT-EVALUATED",
      reason: `could not read --color-accent-600 from ${CSS_PATH} — the accent token moved or the stylesheet was renamed; fix this reader rather than assuming the render failed`,
    }),
  );
  process.exit(2);
}

const near = (r, g, b, T) =>
  Math.abs(r - T[0]) <= ACCENT_TOLERANCE &&
  Math.abs(g - T[1]) <= ACCENT_TOLERANCE &&
  Math.abs(b - T[2]) <= ACCENT_TOLERANCE;

const { width, height, bpp, pixels } = decodePng(file);
let light = 0;
let dark = 0;
let accent = 0;
let accentBasePixels = 0;
for (let i = 0; i < pixels.length; i += bpp) {
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 230) light += 1;
  else if (lum < 100) dark += 1;
  if (near(r, g, b, accentToken.rgb)) accent += 1;
  if (accentBase && near(r, g, b, accentBase.rgb)) accentBasePixels += 1;
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
    accentToken: accentToken.hex,
    accentTokenSource: path.relative(path.join(HERE, ".."), CSS_PATH),
    accentTolerance: ACCENT_TOLERANCE,
    accentBasePixels,
    note:
      verdict === "BLANK" && accent > 0
        ? "accent present but bg/text thresholds failed"
        : verdict === "BLANK" && accentBasePixels > 0
          ? `accent-600 (${accentToken.hex}) absent but base accent (${accentBase.hex}) present ×${accentBasePixels} — this page styles its accent with the base token, outside what this criterion measures`
          : undefined,
    verdict,
  }),
);
process.exit(verdict === "non-blank" ? 0 : 1);
