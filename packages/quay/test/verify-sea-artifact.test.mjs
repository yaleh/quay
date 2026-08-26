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

// bundle(overrides): build a release bundle dir (mirroring release.yml's dist-sea-release layout)
// with plugin/ staged from the sidecar plus a placeholder SEA binary + .quay/config.yml.
function assembleBundle({ includePlugin = true, pluginFileCount = null } = {}) {
  const root = path.join(tmpBase, "bundle-" + Math.random().toString(36).slice(2));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers:\n  native:\n    enabled: true\n");
  fs.writeFileSync(path.join(root, "quay"), "placeholder (SEA binary — plugin is a sidecar)\n");
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

function runVerify(bundleDir) {
  return execFileSync("bash", [verifyScript, bundleDir], { encoding: "utf8", stdio: "pipe" });
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
