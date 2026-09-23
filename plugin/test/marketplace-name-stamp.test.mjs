// @test-group product
// marketplace-name-stamp.test.mjs — the dogfood/release marketplace-name split (2026-09-23).
//
// A marketplace name is ONE machine-wide slot and a directory marketplace loads its plugin in place,
// so the repo's plugin/ is named `quay-dev` in source (this repo enables quay@quay-dev) while every
// published copy is stamped back to the release channel's name by scripts/stamp-marketplace-name.mjs.
// Pinned here:
//   1. the source-form invariant — plugin/ is NOT named like the release channel (if it were, the dev
//      tree would take over `quay@quay` for every project on the machine again);
//   2. the stamp itself, run as a CLI on a COPY: name becomes the release name, nothing else changes;
//   3. fail-closed on missing input (exit 1, not a silent "stamped").
// The end-to-end readings (published tree / packed tarball are named `quay`) live next to the real
// publish runs: publish-dist-branch-closure-gate.test.mjs and packages/quay/test/npm-pack-e2e.test.mjs.
//
// Run: scripts/test.sh plugin/test/marketplace-name-stamp.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import { releaseMarketplaceName } from "../../scripts/stamp-marketplace-name.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const STAMP = path.join(repoRoot, "scripts", "stamp-marketplace-name.mjs");
const PLUGIN_MARKETPLACE = path.join(pluginDir, ".claude-plugin", "marketplace.json");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const runStamp = (...args) => spawnSync(process.execPath, [STAMP, ...args], { encoding: "utf8" });

test("source form: plugin/ is the `quay-dev` dogfood marketplace, NOT the release channel's name", () => {
  const release = releaseMarketplaceName(repoRoot);
  assert.equal(release, "quay", "the repo-root marketplace is the release channel `/plugin marketplace add yaleh/quay` registers");
  const dev = readJson(PLUGIN_MARKETPLACE);
  assert.equal(dev.name, "quay-dev");
  assert.notEqual(dev.name, release, "plugin/ must not claim the release slot (it would make every project load this dev tree)");
  // the plugin itself keeps its name ⇒ quay:* skills and mcp__plugin_quay_quay__* tools are unchanged
  assert.equal(readJson(path.join(pluginDir, ".claude-plugin", "plugin.json")).name, "quay");
  assert.ok(dev.plugins.some((p) => p.name === "quay" && p.source === "."), "plugin/ is its own marketplace root (a symlinked root fails skill loading with path-traversal)");
});

test("stamp rewrites ONLY the copy's name to the release name, preserving every other field", () => {
  const tree = makeTmpDir("mkt-stamp-");
  fs.mkdirSync(path.join(tree, ".claude-plugin"), { recursive: true });
  const copy = path.join(tree, ".claude-plugin", "marketplace.json");
  fs.copyFileSync(PLUGIN_MARKETPLACE, copy);
  const sourceBefore = fs.readFileSync(PLUGIN_MARKETPLACE, "utf8");

  const r = runStamp("--root", tree, "--repo-root", repoRoot);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"quay-dev" => "quay"/);

  const after = readJson(copy);
  const before = JSON.parse(sourceBefore);
  assert.equal(after.name, "quay");
  assert.deepEqual({ ...after, name: before.name }, before, "only `name` may change");
  assert.equal(fs.readFileSync(PLUGIN_MARKETPLACE, "utf8"), sourceBefore, "the repo's own plugin/ is never touched");

  // idempotent: a second run is a no-op that still reports the release name
  const again = runStamp("--root", tree, "--repo-root", repoRoot);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /"quay" => "quay"/);
});

test("fail-closed: a tree without a readable marketplace.json exits 1 and never reports a stamp", () => {
  const empty = makeTmpDir("mkt-stamp-empty-");
  const r = runStamp("--root", empty, "--repo-root", repoRoot);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STAMP-MARKETPLACE-NAME: FAILED/);
  assert.doesNotMatch(r.stdout, /=>/);

  const noArgs = runStamp();
  assert.equal(noArgs.status, 1, "no --root is a usage error, not a no-op success");
});
