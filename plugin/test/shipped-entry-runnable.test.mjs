// @test-group product
// plugin/test/shipped-entry-runnable.test.mjs
//
// gap-shipped-entry-files-not-runnable (AC-233): packages/quay's `files` used to
// ship the whole `bin/` directory, so the npm tarball carried bin/quay.js (a
// source-tree probe shim) and bin/quay.ts (the raw TypeScript CLI) — files that
// LOOK like entries (exec bit / shebang / under bin/) but are structurally NOT
// runnable from an install location. Node refuses type stripping for files under
// node_modules/ (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, independent of
// Node version), and bin/quay.js is a dev-tree probe, not a declared bin.
//
// Invariant pinned here: every file that (a) gets packed into the tarball and
// (b) looks like an entry (executable bit / shebang / under bin/) must be a
// declared `package.json` bin that runs from an install-location layout. The
// AC-233 fix removes `bin` from `files`, so the only shipped entry is the
// declared bin `./dist/quay.js` (a self-contained esbuild bundle — the version
// is embedded at build time, see src/version.ts).
//
// ⛔ NOT "the declared bin runs": the enumerated set is ALL packed entry-like
// files. A non-declared entry-like file that sneaks into `files` (the exact
// shape of the original defect) fails the assertion — that is the whole point.
//
// Run: node --test plugin/test/shipped-entry-runnable.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PKG_DIR = path.join(REPO_ROOT, "packages", "quay");

const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));

// Normalize package.json `bin` values ("quay": "./dist/quay.js") to the
// package-relative paths npm pack reports ("dist/quay.js").
function declaredBinPaths() {
  const bin = pkgJson.bin || {};
  return Object.values(bin).map((p) => p.replace(/^\.\//, ""));
}

// `npm pack --dry-run --json` is the authoritative "what actually ships" source —
// the same mechanism AC-233's own AC4 uses. Emits a JSON array on stdout; each
// entry's `files[]` carries {path, size, mode}.
function packedFiles() {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PKG_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out)[0].files.map((f) => ({ path: f.path, mode: f.mode }));
}

// Read the first 2 bytes — enough to detect a `#!` shebang.
function readShebangPrefix(rel) {
  const abs = path.join(PKG_DIR, rel);
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(2);
    const n = fs.readSync(fd, buf, 0, 2, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// A packed file "looks like an entry" if it has an executable bit, a shebang
// first line, or sits in the conventional bin/ directory. The bin/ criterion
// matters: bin/node-version-check.cjs has neither bit nor shebang but is still
// entry-shaped by location.
function isEntryLike(packedFile, shebangPrefix) {
  const { path: rel, mode } = packedFile;
  if (rel.split("/")[0] === "bin") return true;
  if ((mode & 0o111) !== 0) return true;
  if (shebangPrefix === "#!") return true;
  return false;
}

// Files npm runs via package.json `scripts` (lifecycle hooks — postinstall,
// build, ...) are invoked BY npm, not by a user, so they are not "entries" even
// when they carry a shebang (scripts/register-plugin.mjs does). Exempting them
// keeps the enumeration honest: a postinstall hook is a legitimate shipped file,
// not a broken entry, and must not be demanded to be a declared bin.
function lifecycleHookPaths() {
  const scripts = pkgJson.scripts || {};
  const paths = new Set();
  for (const cmd of Object.values(scripts)) {
    for (const m of String(cmd).matchAll(/\b([\w./-]+\.(?:mjs|cjs|js|ts))\b/g)) {
      paths.add(m[1]);
    }
  }
  return paths;
}

// "Runnable from an install-location layout": copy the declared bin into a
// node_modules/<pkg>/ directory and run it there. The node_modules path component
// is what makes a `.ts` entry structurally fail (Node refuses type stripping under
// node_modules), so running from this layout is what actually discriminates a
// runnable bundle from a `.ts` entry that can never run after install. dist/quay.js
// is a self-contained esbuild bundle (version embedded at build time), so copying
// the single file is a faithful install-location simulation.
function runsFromInstallLayout(rel) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-shipped-entry-"));
  const dest = path.join(tmp, "node_modules", "quay", rel);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(PKG_DIR, rel), dest);
    const res = spawnSync(process.execPath, [dest, "--version"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    return res.status === 0 && res.stdout.trim().length > 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("every packed entry-like file is a declared bin runnable from an install layout", () => {
  const binPaths = declaredBinPaths();
  const hookPaths = lifecycleHookPaths();
  const packed = packedFiles();
  const violations = [];
  for (const f of packed) {
    if (hookPaths.has(f.path)) continue; // lifecycle hook, not a user-facing entry
    if (!isEntryLike(f, readShebangPrefix(f.path))) continue;
    if (!binPaths.includes(f.path)) {
      violations.push(`${f.path}: packed + entry-like but NOT a declared bin`);
      continue;
    }
    if (!runsFromInstallLayout(f.path)) {
      violations.push(`${f.path}: declared bin but does not run from an install layout`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `packed entry-like files must each be a declared bin runnable from an install layout. ` +
      `Declared bins: ${JSON.stringify(binPaths)}. Violations:\n${violations.join("\n")}`,
  );
});

test("negative control: the install-layout run check refuses a .ts entry and accepts a .js entry", () => {
  // A .ts entry under a node_modules/ layout must be refused by Node (type
  // stripping is unsupported under node_modules — on Node >= 22.6 this is
  // ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — the exact structural failure
  // the task exists to prevent, reproduced hermetically so the "runnable from
  // install layout" leg is proven able to take false (硬规则 4). The assertion
  // pins the refusal (non-zero exit + a produced error), not the Node-internal
  // error string, so it stays true across Node floors (a pre-stripping Node
  // fails the .ts with a SyntaxError instead — still a refusal).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-shipped-entry-nc-"));
  const nmRoot = path.join(tmp, "node_modules", "quay");
  fs.mkdirSync(nmRoot, { recursive: true });
  try {
    const tsEntry = path.join(nmRoot, "evil.ts");
    fs.writeFileSync(tsEntry, "#!/usr/bin/env node\nconst x: number = 1;\nconsole.log('hi', x);\n");
    const tsRun = spawnSync(process.execPath, [tsEntry], { encoding: "utf8" });
    assert.notEqual(tsRun.status, 0, "a .ts entry under node_modules/ must NOT run");
    assert.ok(
      String(tsRun.stderr).length > 0,
      "the .ts refusal must produce an error (type stripping unsupported under node_modules)",
    );

    const jsEntry = path.join(nmRoot, "ok.js");
    fs.writeFileSync(jsEntry, "#!/usr/bin/env node\nconsole.log('ok');\n");
    const jsRun = spawnSync(process.execPath, [jsEntry], { encoding: "utf8" });
    assert.equal(jsRun.status, 0, "a .js entry under node_modules/ must run");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
