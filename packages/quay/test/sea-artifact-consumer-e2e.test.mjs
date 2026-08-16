// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e (quay-init --loop against release artifact); install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// this test spawns a real quay-init.sh --loop subprocess tree against the RELEASE ARTIFACT's plugin
// sidecar. The install/quay-init family rotated flakes across groups under full-suite load, so the
// whole family (this file included) is consolidated into the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
// sea-artifact-consumer-e2e.test.mjs — gap-release-artifact-missing-plugin-ac16 (AC4 升级通道通).
//
// The v0.4.0 SEA release archive shipped WITHOUT plugin/ — a consumer who downloaded it could not
// init --loop into the mechanisms at all (archguard #13). The fix (gap-release-sea-bundle-excludes-
// plugin-tree) makes the release archive carry the plugin as a SIDECAR directory. This test proves
// the CONSUMER upgrade channel end-to-end, hermetically, against the ARTIFACT's own plugin:
//
//   1. stage the plugin sidecar exactly as release.yml's build-sea.sh does (--stage-plugin-only);
//   2. assemble a release bundle the way release.yml's sea-release job does (plugin/ + binaries +
//      packaged .quay/config.yml);
//   3. run `quay-init.sh --loop` from the BUNDLE's plugin (CLAUDE_PLUGIN_ROOT = artifact plugin)
//      against a fresh consumer git workspace;
//   4. assert the loop mechanism lands (exit 0 + the observable mechanism files present) AND the
//      artifact-level check (verify-sea-artifact.sh) passes.
//
// This is the DIR-110-family consumer e2e: it uses the RELEASE ARTIFACT's plugin, not the source
// tree, so it would have caught the v0.4.0 regression (plugin absent from the artifact ⇒ the
// artifact's plugin cannot init --loop at all).
//
// NOTE on the 6 mechanism names: 5 of them (dead-loop-check / slot-refill / claim-task /
// self-report-vocab / laydown-set-check) are LOOP mechanisms laid down into a consumer workspace by
// quay-init --loop. verify-delivery-surface is a REPO-LEVEL (plugin-side) delivery-surface checker
// — it is referenced only by capability-catalog.sh's entry-surface declaration, is not part of the
// loop laydown set, and is correctly NOT copied into a consumer tree; its presence in the ARTIFACT
// is asserted by verify-sea-artifact.sh (all 6 names must be reverse-searchable in the bundle).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  makeTmp, cleanup, runInit,
} from "../../../plugin/test/quay-init-loop-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const pluginSrc = path.join(repoRoot, "plugin");

const MECHANISM_NAMES = [
  "dead-loop-check",
  "verify-delivery-surface",
  "slot-refill",
  "claim-task",
  "self-report-vocab",
  "laydown-set-check",
];
// The loop mechanisms quay-init --loop actually lays down into a consumer workspace.
// touches-one-entry-one-path-check: precommit-guard.ts's ESM `./` import — the delta-scope
// unverified-landing defect (gap-quay-init-laydown-missing-touches-checker) — the consumer's
// guard --install-hook dies with ERR_MODULE_NOT_FOUND when this checker is absent from the laydown.
const LAID_DOWN_MECHANISMS = [
  "dead-loop-check", "slot-refill", "claim-task", "self-report-vocab", "laydown-set-check",
  "touches-one-entry-one-path-check",
];

let tmpBase;
let stagedPlugin; // <base>/packages/quay/dist-sea/plugin — the artifact's plugin sidecar
let bundlePlugin; // <base>/bundle/plugin — the assembled release bundle's plugin

// The consumer workspace: a fresh git repo with one initial commit (the "fresh-clone" baseline that
// a real downloader starts from), with local git identity set so quay-init's auto-commit works.
function consumerWorkspace(prefix = "sea-consumer-") {
  const ws = makeTmp(prefix);
  const git = (args) => spawnSync("git", args, { cwd: ws, encoding: "utf8" });
  for (const a of [["init", "-q"], ["config", "user.name", "sea-artifact-consumer-e2e"], ["config", "user.email", "sea-e2e@test"]]) {
    const r = git(a);
    if (r.status !== 0) { cleanup(ws); throw new Error(`git ${a[0]} failed: ${r.stderr}`); }
  }
  fs.writeFileSync(path.join(ws, "README.md"), "# fixture\n");
  const add = git(["add", "README.md"]);
  const cm = git(["commit", "-qm", "initial"]);
  if (add.status !== 0 || cm.status !== 0) { cleanup(ws); throw new Error(`initial commit failed: ${cm.stderr}`); }
  return ws;
}

// stageArtifact(): mirror the real repo layout (<base>/packages/quay + <base>/plugin), stage the
// plugin sidecar via build-sea.sh --stage-plugin-only, and assemble the release bundle the way
// release.yml's sea-release job does.
function stageArtifact() {
  const base = makeTmp("sea-consumer-e2e-");
  const pkg = path.join(base, "packages", "quay");
  fs.mkdirSync(path.join(pkg, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(pkgDir, "scripts", "build-sea.sh"), path.join(pkg, "scripts", "build-sea.sh"));
  fs.cpSync(pluginSrc, path.join(base, "plugin"), { recursive: true });
  // The release artifact's plugin MUST carry the vendored runtime bundle (quay-init lays it into a
  // target's .quay/runtime/ and fail-closes when it is absent). In a real release the vendored
  // dist is built by `npm install` (root postinstall) / `scripts/test.sh build_dist_once` BEFORE
  // build-sea.sh stages the sidecar — so the SOURCE plugin's vendor/quay/dist is a freshly-built
  // gitignored mirror when this test runs under scripts/test.sh. We copy that mirror (read-only
  // from the shared tree, written only to our temp copy) and FAIL CLOSED if it is absent — a
  // release whose artifact plugin lacks the runtime is exactly the AC16 regression this test
  // exists to catch. Never write the shared plugin tree from a test (test-isolation R3).
  const vendorCore = path.join(base, "plugin", "vendor", "quay", "dist", "quay.js");
  const vendorNative = path.join(base, "plugin", "vendor", "quay-native", "dist", "quay-native.js");
  if (!fs.existsSync(vendorCore) || !fs.existsSync(vendorNative)) {
    throw new Error("source plugin vendor runtime missing from the shared checkout " +
      "(plugin/vendor/quay/dist/quay.js + plugin/vendor/quay-native/dist/quay-native.js). " +
      "Run `scripts/test.sh` (build_dist_once mirrors the dist) or `bash plugin/scripts/sync-vendor.sh` " +
      "so the staged sidecar carries the runtime quay-init lays into a target.");
  }
  const stage = spawnSync("bash", [path.join(pkg, "scripts", "build-sea.sh"), "--stage-plugin-only"], {
    cwd: pkg, encoding: "utf8", stdio: "pipe", timeout: 120_000,
  });
  if (stage.status !== 0) throw new Error(`--stage-plugin-only failed:\n${stage.stderr}`);
  const staged = path.join(pkg, "dist-sea", "plugin");
  if (!fs.existsSync(staged)) throw new Error("staged plugin sidecar missing");

  // Assemble the bundle (mirrors release.yml's "Assemble release bundle" step).
  const bundle = path.join(base, "bundle");
  fs.mkdirSync(path.join(bundle, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(bundle, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "quay"), "placeholder (SEA binary — plugin is a sidecar)\n");
  fs.cpSync(staged, path.join(bundle, "plugin"), { recursive: true });
  fs.writeFileSync(path.join(bundle, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\n    path: \".\"\n    tasks_dir: \"./tasks\"\n");
  return { base, staged, bundlePlugin: path.join(bundle, "plugin") };
}

after(() => {
  if (tmpBase) fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("AC4 — a consumer can init --loop from the RELEASE ARTIFACT's plugin and gets the mechanisms", () => {
  const artifact = stageArtifact();
  tmpBase = artifact.base;
  stagedPlugin = artifact.staged;
  bundlePlugin = artifact.bundlePlugin;

  // The artifact-level check (AC3) must pass on the assembled bundle BEFORE the consumer step —
  // this is the "下载新产物 ⇒ 产物含 plugin + 6 机制名" half of the upgrade channel.
  const verify = spawnSync("bash", [path.join(pkgDir, "scripts", "verify-sea-artifact.sh"), path.join(tmpBase, "bundle")], {
    encoding: "utf8", stdio: "pipe",
  });
  assert.equal(verify.status, 0, `artifact-level check must PASS before the consumer step:\n${verify.stderr}`);

  // Consumer step: fresh clone → quay-init --loop FROM THE BUNDLE'S PLUGIN.
  const ws = consumerWorkspace();
  try {
    const r = runInit(ws, [
      "--loop", "--root", ws, "--project", "proj",
      "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
    ], bundlePlugin);
    assert.equal(r.status, 0, `quay-init --loop from the artifact plugin must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /quay-init complete/, "init must report completion");
    assert.match(r.stdout, /auto-commit: committed/, "init must auto-commit the laid-down mechanisms");

    // The loop mechanism actually landed in the consumer workspace.
    const wsPlugin = path.join(ws, "plugin");
    assert.ok(fs.existsSync(path.join(ws, "orchestration", "orchestrator-loop-tick.md")),
      "outer tick doc must be laid down");
    for (const m of LAID_DOWN_MECHANISMS) {
      const files = walkFiles(ws).filter((f) => path.basename(f).includes(m));
      assert.ok(files.length > 0,
        `loop mechanism "${m}" must be laid down into the consumer workspace (found ${files.length})`);
    }
  } finally {
    cleanup(ws);
  }
});

test("AC4 — the ARTIFACT plugin carries all 6 mechanism names (verify-sea-artifact list)", () => {
  assert.ok(bundlePlugin, "the AC4 init test must have run first");
  // Cross-check the artifact's plugin files directly: every mechanism name must be present in the
  // staged sidecar (the archive content a consumer downloads). verify-delivery-surface is included
  // here even though it is not laid down — it ships in the artifact as a plugin-side checker.
  for (const m of MECHANISM_NAMES) {
    const files = walkFiles(stagedPlugin).filter((f) => path.basename(f).includes(m));
    assert.ok(files.length > 0,
      `mechanism "${m}" must be present in the artifact's plugin sidecar (found ${files.length})`);
  }
});

function walkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}
