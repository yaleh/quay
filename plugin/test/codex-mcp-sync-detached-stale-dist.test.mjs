// @test-group product
// codex-mcp-sync-detached-stale-dist.test.mjs — gap-codex-mcp-sync-installs-stale-dist-from-detached-
// worktree: a publish run from a detached/tag worktree must not leave the vendored dist at its build-time
// `-dev` version. The defect: `sync-vendor.sh`'s build-mode stamp step stamped `--root plugin/`, but the
// repo-root `.codex-plugin/plugin.json` carrier is not under `plugin/`, so `stamp-version` exited 1 and the
// `&&`-chained `--stamp-bundle-tree` / `--bundle-tree` were SILENTLY skipped (set -e does not fire on a
// non-final `&&` failure) — the vendored bundle kept `-dev` on a release build. The fix adds
// `stamp-version --mode build --repo-layout` (stamps the REPO's own tree: plugin carriers keep the
// `plugin/` prefix, the codex carrier stays at the repo root) and makes both `sync-vendor.sh` and
// `publish-dist-branch.sh` fail-closed instead of silently skipping the bundle-tree stamp.
//
// This test exercises the REAL generators on a synthetic repo-layout detached@tag tree (the same
// discipline as publish-dist-branch-closure-gate.test.mjs's stub: the entry + source modules are copied
// from the repo, the carriers are minimal synthetic ones in the shape the generator reads). It does NOT
// re-implement the stamp predicate.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const NODE_MODULES = path.join(repoRoot, "node_modules");
const SYNC_VENDOR = path.join(pluginDir, "scripts", "sync-vendor.sh");
const PUBLISH_SCRIPT = path.join(pluginDir, "scripts", "publish-dist-branch.sh");
const STAMP_VERSION_MJS = path.join(repoRoot, "scripts", "stamp-version.mjs");
const BUNDLE_CHECK_MJS = path.join(repoRoot, "scripts", "version-consistency-check.mjs");

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

// The esbuild-inlined `packages/quay/package.json` object the bundle-tree axis reads/rewrites. The
// `-dev` starting point is what a build inlines from the committed tracked carrier on every branch.
const BUNDLE_ANCHOR = 'var package_default = { name: "quay", version: "0.0.0-dev", type: "module" };\n';

/** A repo-layout tree: VERSION + plugin carriers + the repo-root codex carrier + a synthetic bundle, at
 *  a detached HEAD with a version tag — the exact shape sync-vendor.sh stamps. */
function makeRepoLayoutTree() {
  const root = makeTmpDir("codex-detached-stamp-");
  fs.symlinkSync(NODE_MODULES, path.join(root, "node_modules"), "dir");
  for (const rel of [
    "scripts/stamp-version.mjs",
    "scripts/stamp-version.ts",
    "scripts/version-carriers.ts",
    "scripts/resolve-version.ts",
    "scripts/version-consistency-check.mjs",
    "scripts/version-consistency-check.ts",
  ]) {
    writeFile(path.join(root, rel), fs.readFileSync(path.join(repoRoot, rel)));
  }
  writeFile(path.join(root, "VERSION"), "0.0.0\n");
  writeFile(path.join(root, "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "quay", version: "0.0.0-dev" }, null, 2) + "\n");
  writeFile(path.join(root, "plugin", "README.md"), "quay plugin v0.0.0-dev — stub\n");
  writeFile(path.join(root, "plugin", "VERSION"), "0.0.0-dev\n");
  writeFile(path.join(root, "plugin", "vendor", "quay", "package.json"), JSON.stringify({ name: "quay-plugin-vendor", version: "0.0.0-dev" }, null, 2) + "\n");
  writeFile(path.join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "quay", version: "0.0.0-dev" }, null, 2) + "\n");
  writeFile(path.join(root, "plugin", "vendor", "quay", "dist", "quay.js"), BUNDLE_ANCHOR);
  git(root, "init", "-q", "-b", "master");
  git(root, "-c", "user.name=test", "-c", "user.email=test@invalid", "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@invalid", "commit", "-q", "-m", "stub");
  git(root, "tag", "v0.0.0");
  git(root, "checkout", "-q", "--detach", "v0.0.0");
  return root;
}

/** The bundle-embedded version the bundle-tree axis judges (the REAL locateEmbeddedVersion predicate). */
function embeddedVersion(bundlePath) {
  const raw = fs.readFileSync(bundlePath, "utf8");
  const m = raw.match(/package_default\s*=\s*\{[\s\S]{0,400}?(?:version|"version")\s*:\s*"([^"]*)"/);
  return m ? m[1] : null;
}

test("--repo-layout stamps the repo's own tree (incl. the repo-root codex carrier) and re-derives the bundle to the tag version", () => {
  const root = makeRepoLayoutTree();
  const pluginRoot = path.join(root, "plugin");
  const bundle = path.join(pluginRoot, "vendor", "quay", "dist", "quay.js");
  try {
    // Reverse control (the OLD, broken path): stamping `--root plugin/` without --repo-layout cannot see
    // the repo-root `.codex-plugin/plugin.json` carrier, so it must fail (exit 1, nothing written) rather
    // than silently skipping the bundle restamp.
    const old = spawnSync("node", [STAMP_VERSION_MJS, "--mode", "build", "--root", pluginRoot, "--git-root", root], {
      encoding: "utf8",
    });
    assert.notEqual(old.status, 0, `--root plugin/ (no --repo-layout) must fail on the repo-root codex carrier:\n${old.stdout}\n${old.stderr}`);

    // The fix: --repo-layout stamps the repo tree, including .codex-plugin/plugin.json at the repo root.
    const stamp = spawnSync(
      "node",
      [STAMP_VERSION_MJS, "--mode", "build", "--repo-layout", "--root", root, "--git-root", root],
      { encoding: "utf8" },
    );
    assert.equal(stamp.status, 0, `--repo-layout stamp must succeed:\n${stamp.stdout}\n${stamp.stderr}`);
    const pluginJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
    const codexJson = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
    assert.equal(pluginJson.version, "0.0.0", "plugin/.claude-plugin/plugin.json must be stamped to the tag version");
    assert.equal(codexJson.version, "0.0.0", ".codex-plugin/plugin.json must be stamped to the tag version (the carrier that broke the old --root plugin/ stamp)");

    // Reverse control: the carriers are now bare 0.0.0 but the bundle still says 0.0.0-dev ⇒ the
    // bundle-tree judge must RED (the silent-skip defect hid exactly this).
    const red = spawnSync("node", [BUNDLE_CHECK_MJS, "--bundle-tree", pluginRoot], { encoding: "utf8" });
    assert.notEqual(red.status, 0, `bundle-tree must red on a -dev bundle against a bare manifest:\n${red.stdout}\n${red.stderr}`);

    // The (b) half: re-derive the bundle from the tree's own plugin.json, then the judge goes green.
    const restamp = spawnSync("node", [BUNDLE_CHECK_MJS, "--stamp-bundle-tree", pluginRoot], { encoding: "utf8" });
    assert.equal(restamp.status, 0, `--stamp-bundle-tree must succeed:\n${restamp.stdout}\n${restamp.stderr}`);
    assert.equal(embeddedVersion(bundle), "0.0.0", "the bundle's inlined version must be re-derived to the tag version");

    const green = spawnSync("node", [BUNDLE_CHECK_MJS, "--bundle-tree", pluginRoot], { encoding: "utf8" });
    assert.equal(green.status, 0, `bundle-tree must be green after the restamp:\n${green.stdout}\n${green.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sync-vendor.sh and publish-dist-branch.sh stamp the build tree with --repo-layout and fail closed", () => {
  const syncSrc = fs.readFileSync(SYNC_VENDOR, "utf8");
  assert.match(
    syncSrc,
    /stamp-version\.mjs"\s+--mode build --repo-layout --root "\$\{REPO_ROOT\}" --git-root "\$\{REPO_ROOT\}"/,
    "sync-vendor.sh must stamp the REPO tree with --repo-layout (the codex carrier lives at the repo root, not under plugin/)",
  );
  assert.match(
    syncSrc,
    /\|\|\s*\{\s*echo "[^"]*stale[^"]*"[^;]*;[^}]*exit 1;\s*\}/s,
    "sync-vendor.sh's stamp chain must fail closed instead of silently skipping the bundle-tree restamp",
  );

  const publishSrc = fs.readFileSync(PUBLISH_SCRIPT, "utf8");
  assert.match(
    publishSrc,
    /\|\|\s*\{\s*echo "[^"]*stale[^"]*"[^;]*;[^}]*exit 1;\s*\}/s,
    "publish-dist-branch.sh's stamp chain must fail closed instead of publishing a possibly-stale bundle",
  );
});
