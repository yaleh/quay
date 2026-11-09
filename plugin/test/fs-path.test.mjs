// @test-group engine
// fs-path.test.mjs — controls for the ONE kernel "realpath when it resolves, else path.resolve"
// predicate (`plugin/scripts/fs-path.ts#realpathOrResolve`), extracted from the byte-identical
// copies the semantic-dedup-scan routine filed as `normalize-path-triple` — and re-filed EIGHT
// times before it (normalize-path-realpath-or-resolve, normalise-path-copy, path-normalization,
// B2, path-normalization-3x, path-normalization-quad, …). The re-filing is the reason this file
// guards the POSITION, not just the behavior:
//
//   ① BEHAVIOR — an existing path (incl. a symlink) resolves to its realpath; a path that does not
//      exist falls back to its ABSOLUTE `path.resolve` spelling; ⛔ never throws.
//   ② POSITION — no other file on either surface declares the same body. This is the standing guard
//      that makes the extraction stick; without it the routine simply re-finds the copies on its
//      next pass, which is exactly what happened eight times.
//
// The wider `realpathOrSelf` (packages/quay/src/core/fs-path.ts) is deliberately NOT covered here:
// it is a different predicate (longest-existing-ancestor walk), and the two are documented as such.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpathOrResolve } from "../scripts/fs-path.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const CANONICAL = "plugin/scripts/fs-path.ts";

/** The exact body, whitespace-insensitive, with a BACKREFERENCE on the parameter name so a copy that
 *  renames the argument (`p` → `abs`) still matches. ⛔ Not a keyword match: the body positions are
 *  what is asserted (hard rule 2) — a comment mentioning the body cannot satisfy this. */
const COPY_BODY_RE =
  /try\s*\{\s*return\s+fs\.realpathSync\(\s*([A-Za-z_$][\w$]*)\s*\)\s*;\s*\}\s*catch\s*\{\s*return\s+path\.resolve\(\s*\1\s*\)\s*;\s*\}/;

/** The probe's own two surfaces: `plugin/scripts/` and every `packages/*\/src/`. */
function scanSurfaces() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "test" || e.name === "node_modules" || e.name === ".git") continue;
        walk(abs);
      } else if (/\.(ts|mjs|js)$/.test(e.name)) {
        files.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(REPO_ROOT, "plugin", "scripts"));
  const packagesDir = path.join(REPO_ROOT, "packages");
  for (const pkg of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    walk(path.join(packagesDir, pkg.name, "src"));
  }
  return files.sort();
}

test("② position — the exact body exists in EXACTLY ONE file, the canonical kernel leaf", () => {
  const surfaces = scanSurfaces();
  // ENUMERATE, don't boolean (hard rule 3): "which files still carry a copy" is the actionable info.
  const carriers = [];
  for (const rel of surfaces) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    if (COPY_BODY_RE.test(text)) carriers.push(rel);
  }
  assert.deepEqual(
    carriers,
    [CANONICAL],
    `the "realpath, else path.resolve" body must live only in ${CANONICAL}; ` +
      `carriers found: ${JSON.stringify(carriers)} — call realpathOrResolve instead of re-writing it`,
  );
  // The scan surface must not be empty: an unreadable tree would make the assertion above vacuous
  // (硬规则 3b — "could not read" must never share the output shape of "read it and it was clean").
  assert.ok(surfaces.length > 100, `scan surface too small (${surfaces.length} files) — the walk is broken`);
});

test("① behavior — realpath wins for an existing path (a symlink resolves to its target)", () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fs-path-"));
  try {
    const real = path.join(root, "real");
    fs.mkdirSync(real);
    const link = path.join(root, "link");
    fs.symlinkSync(real, link);
    assert.equal(realpathOrResolve(link), fs.realpathSync(real));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("① behavior — a missing path falls back to its absolute path.resolve spelling, never throwing", () => {
  const missing = path.join(os.tmpdir(), `fs-path-missing-${process.pid}`, "nope", "deeper");
  assert.equal(realpathOrResolve(missing), path.resolve(missing));
  assert.ok(path.isAbsolute(realpathOrResolve("relative/nope/path")), "the fallback is absolute");
});
