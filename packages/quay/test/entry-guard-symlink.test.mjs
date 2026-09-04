// @test-group product
// entry-guard-symlink.test.mjs — gap-quay-entry-guard-symlink-broken (AC2 负控制矩阵).
//
// The bin/quay.ts entry guard (isMain, the thin shell's "only run when this file
// is the main module" check) must fire run() in ALL THREE call topologies the CLI
// ships as. This is the negative-control matrix the task demands — NOT one more
// fix-on-recurrence (this defect family is now at its 3rd instance: SEA CJS via
// require.main, then ESM source, now npm-installed symlinked ESM).
//
//   1. source ESM            — node <pkg>/bin/quay.ts (dev path). import.meta.url
//                              is the real source URL; argv[1] is the same literal
//                              path (no symlink), so the plain compare holds.
//   2. npm-installed symlink — node <root>/node_modules/.bin/quay -> ../quay/dist/quay.js
//                              (npm install -g on Linux/macOS). import.meta.url
//                              resolves to the REAL file the symlink points at while
//                              argv[1] keeps the symlink path ⇒ the plain string
//                              compare is ALWAYS false — pre-fix, `quay --version`
//                              printed NOTHING and exited 0 (v0.6.0 fully broken for
//                              npm global installs). The fix canonicalizes argv[1]
//                              with fs.realpathSync.
//   3. SEA CJS               — node <tmp>/quay-bundle.cjs (esbuild format:cjs, the
//                              SEA build's bundle). esbuild rewrites import.meta to
//                              {} so the ESM branch is inert; the require.main ===
//                              module branch must fire instead.
//
// Each topology asserts the guard FIRES: --version prints the real package version
// (non-empty) and exits 0. Pre-fix, topology 2 asserted `stdout === ""` (the bug);
// the assert below would fail on that output, so the matrix is load-bearing, not a
// fixture echo (硬规则 3b / 推论三).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import { buildDist } from "../scripts/build-dist.mjs";
import { runCli } from "./helpers/run-cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");

const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;

const _tmpDirs = [];
after(() => {
  for (const d of _tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});
function tmpDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), tag));
  _tmpDirs.push(d);
  return d;
}

/** Spawn `node <entry> --version` and return { status, stdout } (product result only). */
function runVersion(entry) {
  return runCli(entry, ["--version"]);
}

function assertVersionPrinted(res, topology) {
  assert.equal(res.status, 0, `${topology}: --version must exit 0 (pre-fix symlink topology: EXIT=0 but empty — the guard never ran): ${res.stderr}`);
  assert.ok(
    res.stdout.trim().length > 0,
    `${topology}: --version must be NON-EMPTY — empty output is exactly the pre-fix silent-nothing symptom`
  );
  assert.equal(
    res.stdout.trim(),
    PKG_VERSION,
    `${topology}: --version must print the real package version (${PKG_VERSION}), got ${JSON.stringify(res.stdout.trim())}`
  );
}

test("AC2-a: source ESM topology — node bin/quay.ts --version fires the entry guard", () => {
  const entry = path.join(pkgDir, "bin", "quay.ts");
  assert.ok(fs.existsSync(entry), `source entry must exist: ${entry}`);
  const res = runVersion(entry);
  assertVersionPrinted(res, "source ESM");
});

test("AC2-b: npm-installed symlinked ESM topology — bin symlink -> ../quay/dist/quay.js fires the entry guard", async () => {
  // Mirror npm install -g's Linux/macOS layout under an isolated root:
  //   <root>/node_modules/quay/dist/quay.js   (the installed package file)
  //   <root>/node_modules/.bin/quay -> ../quay/dist/quay.js   (the bin symlink)
  const root = tmpDir("quay-entry-guard-symlink-");
  const binDir = path.join(root, "node_modules", ".bin");
  const quayDistDir = path.join(root, "node_modules", "quay", "dist");
  fs.mkdirSync(quayDistDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  // Build the real ESM dist bundle (the exact artifact npm installs) into the
  // isolated package dir — same buildDist() build-dist.mjs / package.sh produce.
  const distPath = path.join(quayDistDir, "quay.js");
  await buildDist({ outfile: distPath });
  assert.ok(fs.existsSync(distPath), `dist bundle must be built: ${distPath}`);

  // npm's bin entry is a RELATIVE symlink: node_modules/.bin/quay -> ../quay/dist/quay.js.
  const symlink = path.join(binDir, "quay");
  fs.symlinkSync(path.join("..", "quay", "dist", "quay.js"), symlink);
  assert.ok(fs.lstatSync(symlink).isSymbolicLink(), "bin entry must be a symlink (the npm -g topology)");

  const res = runVersion(symlink);
  assertVersionPrinted(res, "npm-installed symlinked ESM");
});

test("AC2-c: SEA CJS topology — node <tmp>/quay-bundle.cjs --version fires the require.main guard", async () => {
  // Replicate scripts/esbuild-sea.mjs's CJS bundle into a temp outfile (format:cjs +
  // the version-sea-shim redirect; the ESM branch is inert under CJS because esbuild
  // rewrites import.meta to {}). The require.main === module branch must fire.
  const root = tmpDir("quay-entry-guard-cjs-");
  const cjsBundle = path.join(root, "quay-bundle.cjs");

  const versionReal = path.resolve(pkgDir, "src/version.ts");
  const versionShim = path.resolve(pkgDir, "scripts/version-sea-shim.js");
  const redirectVersionPlugin = {
    name: "redirect-version-to-sea-shim",
    setup(build) {
      build.onResolve({ filter: /version\.(js|ts)$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        if (resolved === versionReal) return { path: versionShim };
        return null;
      });
    },
  };
  await esbuild.build({
    entryPoints: [path.join(pkgDir, "bin", "quay.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: cjsBundle,
    plugins: [redirectVersionPlugin],
    loader: { ".json": "json" },
    logLevel: "silent",
  });
  assert.ok(fs.existsSync(cjsBundle), `CJS bundle must be written: ${cjsBundle}`);

  const res = runVersion(cjsBundle);
  assertVersionPrinted(res, "SEA CJS");
});
