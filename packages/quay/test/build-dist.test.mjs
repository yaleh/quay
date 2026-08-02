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
//       canonical dist/quay.js (no bash coverage tool in this repo — RED/GREEN
//       exit-code + existence assertion, per the plan's shell strategy).
//
// The runnable-bundle assertions build into a DEPTH-MATCHED temp tree
// (<root>/l1/l2/pkg/{package.json,dist/quay.js}) so BOTH src/version.ts's
// `../package.json` read AND src/gate/registry.ts's 4-levels-up REPO_ROOT
// resolve INSIDE the temp root — never the real repo tree, and never a
// mismatched /tmp/package.json.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const scriptSh = path.join(pkgDir, "scripts", "build-dist.sh");
const canonicalOut = path.join(pkgDir, "dist", "quay.js");

// Build target inside a temp tree whose depth mirrors packages/quay/dist so the
// bundle's own relative reads (version.ts, registry.ts REPO_ROOT) stay in temp.
function tempTree(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `quay-m120-builddist-${tag}-`));
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

test("(d) shell wrapper: `bash scripts/build-dist.sh` exits 0 and writes the canonical dist/quay.js", () => {
  // RED before build-dist.sh exists / GREEN after. No bash coverage tool in
  // this repo (confirmed: no kcov/bashcov) — exit-code + existence is the check.
  execFileSync("bash", [scriptSh], { encoding: "utf8", stdio: "pipe" });
  assert.ok(fs.existsSync(canonicalOut), `build-dist.sh must write ${canonicalOut}`);
});
