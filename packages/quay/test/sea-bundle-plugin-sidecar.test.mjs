// @test-group product
// sea-bundle-plugin-sidecar.test.mjs — gap-release-sea-bundle-excludes-plugin-tree.
//
// The SEA release archive (quay-sea-<ver>-<platform>.{tar.gz,zip}) is the RECOMMENDED
// distribution. gap-release-excludes-plugin-bundle-agent-surface (AC16) fixed the npm
// tarball to carry plugin/, but the SEA archive still shipped only the CLI binaries —
// the plugin dir-tree (the agent surface that IS the self-evolving loop) was absent,
// so archguard could not reverse-search the 6 new mechanism names in the artifact
// (double-confirmed 2026-08-06: `quay-sea-0.4.0-linux-x64.tar.gz` had `./quay
// ./quay-native ./tasks/ ./.quay/config.yml`, no plugin/).
//
// This task's architecture decision (AC3): SIDECAR. The SEA single-file binary stays
// CLI-only (a Node-free Core); the plugin ships as a directory sidecar INSIDE the same
// archive. build-sea.sh stages the repo-root plugin/ into dist-sea/plugin/ (minus
// plugin/test/, mirroring package.sh's delivery-form ruling).
//
// This test exercises the REAL staging code via `build-sea.sh --stage-plugin-only` (the
// sidecar step WITHOUT the heavy esbuild/postject/node-copy SEA build, so it stays fast
// and hermetic), then asserts the staged bundle satisfies the task's Contract measure:
//
//   sea_has_plugin = `tar tzf quay-sea-<ver>-*.tar.gz | grep -c 'plugin'` > 0
//
// and that the 6 new mechanism names archguard searched for are present in the artifact.

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

// The 6 new mechanism names archguard searched for in the v0.4.0 SEA binary and found
// absent (gap-release-sea-bundle-excludes-plugin-tree, AC16 改判未达成). Each must be
// reverse-searchable in the release artifact once the plugin sidecar is included.
const MECHANISM_NAMES = [
  "dead-loop-check",
  "verify-delivery-surface",
  "slot-refill",
  "claim-task",
  "self-report-vocab",
  "laydown-set-check",
];

const STAGED_PLUGIN_REL = "dist-sea/plugin";
const BUNDLE_DIR = "dist-sea-release";

let tmpBase;
let tmpPkg; // <base>/packages/quay
let stagedPlugin; // <base>/packages/quay/dist-sea/plugin
let bundleRoot; // <base>/dist-sea-release

// Mirror the real repo layout (<base>/packages/quay + <base>/plugin) exactly the way the
// npm-pack-e2e test's makeTempPackageCopy does, so build-sea.sh's `../../plugin` resolves
// to the copied plugin tree (same source it resolves in CI's fresh checkout). Returns the
// mkdtemp base DIRECTLY so the caller's captured-and-rmSync'd variable covers it (R6).
function makeTempRepoLayout() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quay-sea-sidecar-"));
  const pkg = path.join(base, "packages", "quay");
  fs.mkdirSync(path.join(pkg, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(pkgDir, "scripts", "build-sea.sh"),
    path.join(pkg, "scripts", "build-sea.sh")
  );
  fs.cpSync(path.join(repoRoot, "plugin"), path.join(base, "plugin"), { recursive: true });
  return base;
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

after(() => {
  if (tmpBase) fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("build-sea.sh --stage-plugin-only stages the plugin sidecar into dist-sea/plugin", () => {
  tmpBase = makeTempRepoLayout();
  tmpPkg = path.join(tmpBase, "packages", "quay");
  const out = execFileSync("bash", [path.join(tmpPkg, "scripts", "build-sea.sh"), "--stage-plugin-only"], {
    encoding: "utf8",
    cwd: tmpPkg,
    stdio: "pipe",
  });
  stagedPlugin = path.join(tmpPkg, STAGED_PLUGIN_REL);
  assert.ok(fs.existsSync(stagedPlugin), `dist-sea/plugin must be staged by --stage-plugin-only:\n${out}`);
  assert.match(out, /Plugin sidecar staged/, "staging must report success");
  // plugin/test/ must be excluded — the delivery-form ruling (a user installs quay to
  // run its loop, not to run quay's own test suite), mirrored from package.sh.
  assert.ok(
    !fs.existsSync(path.join(stagedPlugin, "test")),
    "plugin/test must be excluded from the sidecar"
  );
});

test("the staged plugin sidecar carries all 6 new mechanism names (reverse-searchable)", () => {
  assert.ok(stagedPlugin, "the staging test must have run first");
  const allFiles = walkFiles(stagedPlugin);
  for (const name of MECHANISM_NAMES) {
    const found = allFiles.filter((f) => path.basename(f).includes(name));
    assert.ok(
      found.length > 0,
      `mechanism "${name}" must be present in the sidecar (files: ${found.length})`
    );
  }
});

test("a release bundle containing the sidecar satisfies the Contract measure sea_has_plugin > 0", () => {
  assert.ok(stagedPlugin, "the staging test must have run first");
  bundleRoot = path.join(tmpBase, BUNDLE_DIR);
  fs.mkdirSync(path.join(bundleRoot, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\n"
  );
  // The SEA binary itself is not needed for the Contract measure — the plugin sidecar is
  // a directory in the archive, listed by `tar tzf` regardless of the binary's contents.
  fs.writeFileSync(path.join(bundleRoot, "quay"), "placeholder (SEA binary — not needed for sea_has_plugin)\n");
  fs.cpSync(stagedPlugin, path.join(bundleRoot, "plugin"), { recursive: true });

  // Archive the same way release.yml does: `tar -czf <name> -C dist-sea-release .`
  const archive = path.join(tmpBase, "quay-sea-0.0.0-test-linux-x64.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", bundleRoot, "."], { encoding: "utf8" });
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  const pluginEntries = listing.split("\n").filter((l) => l.includes("plugin")).length;
  assert.ok(
    pluginEntries > 0,
    `sea_has_plugin must be > 0 (Contract measure), got ${pluginEntries}\n${listing}`
  );
  // The 6 mechanism names must be reverse-searchable in the archive listing itself — the
  // exact check archguard ran (strings / tar tzf) and found failing for v0.4.0.
  for (const name of MECHANISM_NAMES) {
    assert.ok(listing.includes(name), `archive listing must include mechanism "${name}"`);
  }
});
