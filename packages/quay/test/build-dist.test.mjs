// @test-group product
// build-dist.test.mjs — M120 Stage 1.1 (DIR-060, release-blocking).
//
// Pins the ESM `dist/quay.js` bundle build (scripts/build-dist.mjs +
// scripts/build-dist.sh): the transpile-on-publish mechanism that lets the
// npm-pack tarball's `bin` run on the declared Node-20 floor (native `.ts`
// only runs on Node >=23). Test-first per the M120 plan's Stage 1.1.
//
//   (a) happy path: buildDist() produces a runnable ESM bundle whose
//       `--help` / `--version` succeed as a real subprocess.
//   (b) banner regression-pin: the built bundle contains the load-bearing
//       `createRequire` banner (without it, `yaml`'s CJS-interop dynamic
//       require crashes the ESM bundle at runtime — Grounded finding 1).
//   (c) failure path via the QUAY_BUILD_DIST_ENTRY env-var testability hook:
//       a nonexistent entry makes buildDist() reject (loud, non-zero).
//   (d) shell wrapper: `bash scripts/build-dist.sh` exits 0 and writes the
//       configured outfile. The outfile is redirected to THIS test's own temp
//       dir (QUAY_BUILD_DIST_OUTFILE hook) so the real wrapper is exercised
//       without rewriting the shared packages/quay/dist/quay.js that M136's
//       sync-vendor --check reads concurrently in the full suite
//       (no bash coverage tool in this repo — RED/GREEN exit-code + existence
//       assertion, per the plan's shell strategy).
//   (e) self-contained regression (gap-dist-runtime-not-self-contained-reads-
//       external-package-json): the bundle runs `--version` with NO sibling
//       package.json — the version is inlined at build time, so the dist is a
//       single loose standalone file (pre-fix this crashed with ENOENT).
//
// The runnable-bundle assertions build into a DEPTH-MATCHED temp tree
// (<root>/l1/l2/pkg/{package.json,dist/quay.js}). After the self-contained fix,
// src/version.ts NO LONGER reads `../package.json` at runtime (version inlined
// at build time — test (e) asserts the bundle runs with zero sibling package.json);
// the depth-match survives for src/gate/registry.ts's 4-levels-up REPO_ROOT,
// which still resolves inside the temp root — never the real repo tree, and
// never a mismatched /tmp/package.json.
//
// Run: node --test --experimental-test-coverage packages/quay/test/build-dist.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { buildDist } from "../scripts/build-dist.mjs";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const scriptSh = path.join(pkgDir, "scripts", "build-dist.sh");

// Build target inside a temp tree whose depth mirrors packages/quay/dist so the
// bundle's own relative reads (registry.ts's 4-levels-up REPO_ROOT) stay in
// temp. The package.json copy was historically needed for src/version.ts's
// `../package.json` read; after the self-contained fix (test (e)) version.ts no
// longer reads it, but the copy is harmless and kept for depth-matching parity.
function tempTree(tag) {
  const root = makeTmpDir(`quay-m120-builddist-${tag}-`);
  const pkg = path.join(root, "l1", "l2", "pkg");
  fs.mkdirSync(path.join(pkg, "dist"), { recursive: true });
  fs.copyFileSync(path.join(pkgDir, "package.json"), path.join(pkg, "package.json"));
  return { root, out: path.join(pkg, "dist", "quay.js") };
}

test("(a) happy path: buildDist() writes a runnable ESM bundle; --help and --version succeed", async () => {
  const { out } = tempTree("happy");
  const written = await buildDist({ outfile: out });
  assert.equal(written, out);
  assert.ok(fs.existsSync(out), `expected bundle at ${out}`);

  const help = execFileSync("node", [out, "--help"], { encoding: "utf8" });
  assert.match(help, /Usage/, "--help must print usage text");

  const version = execFileSync("node", [out, "--version"], { encoding: "utf8" }).trim();
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  assert.equal(version, pkgVersion, `--version must print package.json version (${pkgVersion})`);
});

test("(b) banner regression-pin: the built bundle contains the load-bearing createRequire banner", async () => {
  const { out } = tempTree("banner");
  await buildDist({ outfile: out });
  const src = fs.readFileSync(out, "utf8");
  assert.match(
    src,
    /createRequire/,
    "the esbuild `banner` (import createRequire) must be present — without it yaml's dynamic require crashes the ESM bundle"
  );
});

test("(c) failure path: a nonexistent QUAY_BUILD_DIST_ENTRY makes buildDist() reject loudly", async () => {
  const { out } = tempTree("fail");
  const prev = process.env.QUAY_BUILD_DIST_ENTRY;
  process.env.QUAY_BUILD_DIST_ENTRY = path.join(os.tmpdir(), "quay-m120-does-not-exist.ts");
  try {
    await assert.rejects(
      () => buildDist({ outfile: out }),
      /./,
      "buildDist() must reject when the entrypoint cannot be resolved"
    );
  } finally {
    if (prev === undefined) delete process.env.QUAY_BUILD_DIST_ENTRY;
    else process.env.QUAY_BUILD_DIST_ENTRY = prev;
  }
});

test("(d) shell wrapper: `bash scripts/build-dist.sh` exits 0 and writes the configured outfile", () => {
  // RED before build-dist.sh exists / GREEN after. No bash coverage tool in
  // this repo (confirmed: no kcov/bashcov) — exit-code + existence is the check.
  // The outfile is redirected to THIS TEST's own temp dir via the
  // QUAY_BUILD_DIST_OUTFILE testability hook (sibling of QUAY_BUILD_DIST_ENTRY),
  // so the wrapper is exercised for real but NEVER rewrites the shared
  // packages/quay/dist/quay.js that M136's sync-vendor --check reads concurrently
  // in the same full-suite run (gap-sync-vendor-drift-mislabelled-as-task-schema,
  // round 3: eliminate the interference source).
  const outRoot = makeTmpDir("quay-m120-builddist-sh-");
  try {
    const out = path.join(outRoot, "dist", "quay.js");
    fs.mkdirSync(path.join(outRoot, "dist"), { recursive: true });
    execFileSync("bash", [scriptSh], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, QUAY_BUILD_DIST_OUTFILE: out },
    });
    assert.ok(fs.existsSync(out), `build-dist.sh must write ${out}`);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test("(e) self-contained: built bundle runs --version with NO sibling package.json (version inlined at build time)", async () => {
  // gap-dist-runtime-not-self-contained-reads-external-package-json: the dist
  // runtime must not read an external package.json at startup — version.ts
  // embeds the version at build time (esbuild json loader inlines it). This
  // subtest builds the bundle into a BARE temp dir (no package.json, no depth
  // matching) and asserts --version prints the real version. Pre-fix this
  // crashed with `Error: ENOENT ... open <dir>/../package.json`.
  const root = makeTmpDir("quay-m120-builddist-nopkg-");
  try {
    const out = path.join(root, "quay.js");
    const written = await buildDist({ outfile: out });
    assert.equal(written, out);
    assert.ok(fs.existsSync(out), `expected bundle at ${out}`);

    // The bundle must physically not carry version.ts's old runtime read
    // (`../package.json` relative path); the version string is inlined instead.
    const src = fs.readFileSync(out, "utf8");
    assert.ok(
      !src.includes("../package.json"),
      "the bundle must not contain version.ts's '../package.json' runtime read"
    );

    const pkgVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
    const version = execFileSync("node", [out, "--version"], { encoding: "utf8" }).trim();
    assert.equal(version, pkgVersion, `--version must print the inlined version (${pkgVersion}) with no sibling package.json`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
