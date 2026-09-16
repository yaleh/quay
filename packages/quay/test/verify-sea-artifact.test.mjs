// @test-group product
// verify-sea-artifact.test.mjs — gap-release-artifact-missing-plugin-ac16 (AC3 产物层验证).
//
// The v0.4.0 SEA release archive shipped without plugin/ and `strings` of the 6 mechanism names
// found zero hits in the binaries (archguard report #13) — AC16 unmet at the artifact layer.
// `packages/quay/scripts/verify-sea-artifact.sh` is the mechanical artifact-level check (Contract
// measure release_tarball_has_plugin = plugin/ 非空 OR 6 机制名全在产物). This test exercises the
// REAL script hermetically: it stages a plugin sidecar (build-sea.sh --stage-plugin-only, the same
// fast + hermetic path sea-bundle-plugin-sidecar.test.mjs uses), assembles a release bundle the way
// release.yml does, and asserts the script PASSes on the good bundle and FAILs closed on broken ones
// (no plugin/; empty plugin/). --list-mechanisms must print exactly the 6 names.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const verifyScript = path.join(pkgDir, "scripts", "verify-sea-artifact.sh");

const MECHANISM_NAMES = [
  "dead-loop-check",
  "verify-delivery-surface",
  "slot-refill",
  "claim-task",
  "self-report-vocab",
  "laydown-set-check",
];

let tmpBase;
let stagedPlugin; // <base>/packages/quay/dist-sea/plugin

function stagePluginSidecar(base) {
  const pkg = path.join(base, "packages", "quay");
  fs.mkdirSync(path.join(pkg, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(pkgDir, "scripts", "build-sea.sh"), path.join(pkg, "scripts", "build-sea.sh"));
  fs.cpSync(path.join(repoRoot, "plugin"), path.join(base, "plugin"), { recursive: true });
  execFileSync("bash", [path.join(pkg, "scripts", "build-sea.sh"), "--stage-plugin-only"], {
    encoding: "utf8", cwd: pkg, stdio: "pipe",
  });
  return path.join(pkg, "dist-sea", "plugin");
}

// A REAL SEA binary is a byte-copy of `node` plus an injected blob; the extraction anchors below
// live in node's own .rodata (the V8 inspector user-agent and the config.gypi source-tarball URL),
// so a fixture only needs those markers to exercise the checker's logic. The extractor's behaviour
// on an ACTUAL node binary is covered separately, against the running node itself — see the
// "--extract-node-version" test.
function fakeSeaBinary(version) {
  return [
    "placeholder SEA binary — base is a byte-copy of node",
    `node.js/${version}Protocol-Version`,
    `https://nodejs.org/download/release/${version}/node-${version}.tar.gz`,
    "",
  ].join("\n");
}

// bundle(overrides): build a release bundle dir (mirroring release.yml's dist-sea-release layout)
// with plugin/ staged from the sidecar, the two SEA binaries (with their build-runtime provenance
// sidecars, as build-sea.sh + release.yml's assemble step produce them) and .quay/config.yml.
function assembleBundle({
  includePlugin = true,
  pluginFileCount = null,
  embeddedVersion = "v20.19.0",
  recordedVersion = null, // defaults to embeddedVersion; pass a different value to break the cross-check
  omitProvenanceFor = null, // "quay" | "quay-native" — omit that binary's recorded provenance file
  omitBinaries = false,
} = {}) {
  const root = path.join(tmpBase, "bundle-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\n");
  if (!omitBinaries) {
    for (const name of ["quay", "quay-native"]) {
      fs.writeFileSync(path.join(root, name), fakeSeaBinary(embeddedVersion));
      if (name !== omitProvenanceFor) {
        fs.writeFileSync(path.join(root, `${name}.build-node-version`), `${recordedVersion ?? embeddedVersion}\n`);
      }
    }
  }
  if (includePlugin) {
    const dest = path.join(root, "plugin");
    fs.cpSync(stagedPlugin, dest, { recursive: true });
    if (pluginFileCount === 0) {
      // Empty plugin/: remove every file but keep the dir.
      for (const f of walkFiles(dest)) fs.rmSync(f);
    }
  }
  return root;
}

function walkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// The declared SEA Node floor (release.yml's workflow-level SEA_NODE_VERSION) is REQUIRED by the
// bundle form — check (c) fails closed without it, so every bundle test states it explicitly.
function runVerify(bundleDir, { env = { SEA_NODE_VERSION: "20" } } = {}) {
  return execFileSync("bash", [verifyScript, bundleDir], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...env },
  });
}

after(() => {
  if (tmpBase) fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("--list-mechanisms prints exactly the 6 mechanism names", () => {
  const out = execFileSync("bash", [verifyScript, "--list-mechanisms"], { encoding: "utf8" });
  const lines = out.trim().split("\n").filter(Boolean);
  assert.deepEqual(lines, MECHANISM_NAMES, "must print the 6 names, one per line");
});

test("a release bundle with the plugin sidecar PASSes the artifact check", () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "quay-verify-sea-"));
  stagedPlugin = stagePluginSidecar(tmpBase);
  const bundle = assembleBundle();
  const out = runVerify(bundle);
  assert.match(out, /PASS/, "good bundle must PASS");
  assert.match(out, /plugin sidecar present and non-empty/, "must report the sidecar");
});

test("a release bundle WITHOUT plugin/ FAILs closed (v0.4.0 regression)", () => {
  assert.ok(stagedPlugin, "the staging test must have run first");
  const bundle = assembleBundle({ includePlugin: false });
  assert.throws(() => runVerify(bundle), /ERROR: .*mechanism names are NOT present/,
    "a plugin-less bundle is exactly the v0.4.0 regression and must fail");
});

test("a release bundle with an EMPTY plugin/ FAILs closed", () => {
  assert.ok(stagedPlugin, "the staging test must have run first");
  const bundle = assembleBundle({ pluginFileCount: 0 });
  assert.throws(() => runVerify(bundle), /ERROR: plugin\/ is EMPTY/,
    "an empty plugin/ sidecar carries no mechanisms and must fail");
});

test("verify-sea-artifact.sh with a missing bundle dir exits 1", () => {
  assert.throws(
    () => runVerify(path.join(tmpBase, "does-not-exist")),
    /ERROR: bundle dir not found/,
    "missing bundle dir must fail closed"
  );
});

// ── gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge ────────────────────────────
// Check (c): the SEA binaries must embed the declared Node floor. The criterion is able to be
// FALSE in three distinct ways (wrong version, self-inconsistent artifact, unreadable), and each
// is exercised below as a negative control — plus the honest-probe test that runs the extractor
// against the REAL node binary rather than a fixture.

test("--extract-node-version reads the real running node's version from its BYTES", () => {
  // Non-tautological: the extractor is handed the actual node executable and must return exactly
  // what `node --version` reports. If the anchors ever stop matching real node builds, this fails
  // here rather than silently turning check (c) into a no-op.
  const out = execFileSync("bash", [verifyScript, "--extract-node-version", process.execPath], {
    encoding: "utf8",
  });
  assert.equal(out.trim(), process.version, "extracted version must equal the running node's");
});

test("--extract-node-version on a non-Node file exits 1 (unreadable must not look readable)", () => {
  const notNode = path.join(tmpBase, "not-a-binary");
  fs.writeFileSync(notNode, "this file has no node version in it\n");
  assert.throws(
    () => execFileSync("bash", [verifyScript, "--extract-node-version", notNode], { encoding: "utf8", stdio: "pipe" }),
    /no embedded Node version found/,
    "an unreadable binary must fail closed, not print an empty version"
  );
});

test("a bundle whose binaries embed the declared floor PASSes check (c)", () => {
  assert.ok(stagedPlugin, "the staging test must have run first");
  const bundle = assembleBundle();
  const out = runVerify(bundle);
  assert.match(out, /quay embeds Node v20\.19\.0/, "must report the embedded version read from bytes");
  assert.match(out, /all 2 SEA binaries embed the declared Node 20/, "both binaries must be checked");
});

test("a bundle whose binaries embed a DIFFERENT Node than the declared floor FAILs closed", () => {
  assert.ok(stagedPlugin, "the staging test must run first");
  // The exact defect this task records: same build script, built on a Node-25 dev box, shipped
  // against a Node-20 declaration.
  const bundle = assembleBundle({ embeddedVersion: "v25.1.0", recordedVersion: "v25.1.0" });
  assert.throws(
    () => runVerify(bundle),
    /embeds Node v25\.1\.0, but release\.yml declares the SEA Node floor as 20/,
    "an artifact embedding a non-declared Node must never pass the release gate"
  );
});

test("a binary whose bytes disagree with its recorded provenance FAILs closed", () => {
  assert.ok(stagedPlugin, "the staging test must run first");
  const bundle = assembleBundle({ embeddedVersion: "v20.19.0", recordedVersion: "v22.0.0" });
  assert.throws(
    () => runVerify(bundle),
    /embeds Node v20\.19\.0 but the build recorded v22\.0\.0/,
    "binary vs provenance disagreement is an unattributable artifact and must fail"
  );
});

test("a bundle missing a binary's recorded provenance FAILs closed", () => {
  assert.ok(stagedPlugin, "the staging test must run first");
  const bundle = assembleBundle({ omitProvenanceFor: "quay-native" });
  assert.throws(
    () => runVerify(bundle),
    /quay-native' has no recorded build-runtime provenance/,
    "without the recorded provenance the claim cannot be checked against anything"
  );
});

test("a bundle with no SEA binary at all FAILs closed", () => {
  assert.ok(stagedPlugin, "the staging test must run first");
  const bundle = assembleBundle({ omitBinaries: true });
  assert.throws(
    () => runVerify(bundle),
    /no SEA binary .* found in/,
    "a release bundle without its binaries is not verifiable and must not pass"
  );
});

test("an undeclared floor (SEA_NODE_VERSION unset) FAILs closed rather than passing unevaluated", () => {
  assert.ok(stagedPlugin, "the staging test must run first");
  const bundle = assembleBundle();
  assert.throws(
    () => runVerify(bundle, { env: { SEA_NODE_VERSION: "" } }),
    /SEA_NODE_VERSION is not set/,
    "a gate that cannot evaluate must not report PASS"
  );
});
