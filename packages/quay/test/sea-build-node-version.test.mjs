// @test-group product
// sea-build-node-version.test.mjs — gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge.
//
// A SEA executable's BASE is a byte-copy of whatever `node` PATH resolves to at build time
// (build-sea.sh step [4/6] / [4/5]: `cp "$(command -v node)" "${EXE}"`), so the runtime inside the
// shipped binary is a property of the BUILD MACHINE — CI's sea-release job pins Node 20, a dev box
// on Node 25 produces a Node-25 binary from the same unchanged script. That fact used to be
// implicit and unrecorded; both build scripts now (a) write the build-time `node --version` next to
// the executable as `<exe-name>.build-node-version`, so the claim travels inside the release
// archive, and (b) compare it against the declared floor (SEA_NODE_VERSION), warning by default and
// failing closed under SEA_STRICT_NODE_FLOOR=1 (which CI sets).
//
// This test drives the REAL recording code through `--record-build-node-version` (the fast,
// hermetic path, mirroring `--stage-plugin-only`) in a temp repo layout, and asserts both readings:
// the file it writes, and the exit status / message under a matching and a mismatching floor.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

const CURRENT_VERSION = process.version; // e.g. v24.19.0
const CURRENT_MAJOR = CURRENT_VERSION.replace(/^v/, "").split(".")[0];
// A major that is definitively NOT the running one — used as the "declared floor disagrees" case.
const OTHER_MAJOR = String(Number(CURRENT_MAJOR) + 7);

const roots = [];

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** Copy a package's build-sea.sh into a temp repo layout so OUT_DIR lands in the temp dir. */
function makeTempPackage(pkgName) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `quay-sea-nodever-${pkgName}-`));
  roots.push(base);
  const scripts = path.join(base, "packages", pkgName, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "packages", pkgName, "scripts", "build-sea.sh"),
    path.join(scripts, "build-sea.sh")
  );
  return { pkg: path.join(base, "packages", pkgName), script: path.join(scripts, "build-sea.sh") };
}

/** Run a build-sea.sh flag. Returns { status, stdout, stderr } — stderr on BOTH paths, because the
 * divergence report is a warning (exit 0) in the non-strict case. */
function runScript(pkg, flag, { env = {} } = {}) {
  const r = spawnSync("bash", [pkg.script, flag], {
    encoding: "utf8",
    cwd: pkg.pkg,
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const record = (pkg, opts) => runScript(pkg, "--record-build-node-version", opts);

test("Core build-sea.sh records the build-time node version next to the executable", () => {
  const pkg = makeTempPackage("quay");
  const r = record(pkg, { env: { SEA_NODE_VERSION: CURRENT_MAJOR } });
  assert.equal(r.status, 0, `recording must succeed on the declared floor:\n${r.stderr}`);
  const file = path.join(pkg.pkg, "dist-sea", "quay.build-node-version");
  assert.ok(fs.existsSync(file), "dist-sea/quay.build-node-version must be written");
  assert.equal(
    fs.readFileSync(file, "utf8").trim(),
    CURRENT_VERSION,
    "the recorded version must be exactly what `node --version` reports at build time"
  );
  assert.match(r.stdout, /Build-time node: v/, "the build must announce the version it embedded");
});

test("quay-native build-sea.sh records its own build-time node version", () => {
  const pkg = makeTempPackage("quay-native");
  const r = record(pkg, { env: { SEA_NODE_VERSION: CURRENT_MAJOR } });
  assert.equal(r.status, 0, `recording must succeed on the declared floor:\n${r.stderr}`);
  const file = path.join(pkg.pkg, "dist-sea", "quay-native.build-node-version");
  assert.ok(fs.existsSync(file), "dist-sea/quay-native.build-node-version must be written");
  assert.equal(fs.readFileSync(file, "utf8").trim(), CURRENT_VERSION);
});

test("a build whose node is NOT the declared floor warns, but only fails closed under SEA_STRICT_NODE_FLOOR=1", () => {
  const pkg = makeTempPackage("quay");

  const lenient = record(pkg, { env: { SEA_NODE_VERSION: OTHER_MAJOR } });
  assert.equal(lenient.status, 0, "without the strict flag the local dev path must still build");
  assert.match(
    lenient.stderr,
    new RegExp(`embeds ${CURRENT_VERSION.replace(/\./g, "\\.")}, but the declared floor is Node ${OTHER_MAJOR}`),
    "the divergence must be reported, not swallowed"
  );

  const strict = record(pkg, { env: { SEA_NODE_VERSION: OTHER_MAJOR, SEA_STRICT_NODE_FLOOR: "1" } });
  assert.equal(strict.status, 1, "SEA_STRICT_NODE_FLOOR=1 (what CI sets) must fail closed");
  assert.match(strict.stderr, /SEA_STRICT_NODE_FLOOR=1 — failing closed/);
});

test("with no declared floor the version is still recorded, and the omission is stated", () => {
  const pkg = makeTempPackage("quay");
  const r = record(pkg, { env: { SEA_NODE_VERSION: "" } });
  assert.equal(r.status, 0, "an undeclared floor must not block a local build");
  assert.match(r.stderr, /SEA_NODE_VERSION is not set/);
  assert.equal(
    fs.readFileSync(path.join(pkg.pkg, "dist-sea", "quay.build-node-version"), "utf8").trim(),
    CURRENT_VERSION
  );
});

test("--stage-plugin-only still short-circuits (the fast hermetic path is unaffected)", () => {
  const pkg = makeTempPackage("quay");
  // No plugin tree in this temp layout → the sidecar step must fail loudly, proving the early-exit
  // ordering still reaches it (and never reaches the SEA build).
  const r = runScript(pkg, "--stage-plugin-only");
  assert.equal(r.status, 1, "missing plugin source must fail the sidecar step");
  assert.match(r.stderr, /plugin bundle source not found/);
  assert.ok(
    !fs.existsSync(path.join(pkg.pkg, "dist-sea", "quay.build-node-version")),
    "the SEA build (and its provenance recording) must not run on the fast path"
  );
});
