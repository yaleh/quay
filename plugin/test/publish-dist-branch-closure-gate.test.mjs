// @test-group product
// publish-dist-branch-closure-gate.test.mjs — AC-263 (gap-ac263-marketplace-channel-has-no-dist-
// closure-gate): the marketplace / `dist-plugin` ORPHAN-BRANCH channel had NO dist reference-closure
// assertion while the secondary npm-tarball channel had one (package.sh → build-plugin-dist.mjs
// --verify-closure). orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:139 declares
// marketplace the PRIMARY publish channel, so the guarded channel was the secondary one.
//
// Three layers, all against the REAL code (no re-implementation of the predicate in test code):
//   1. AC3 red/green/restore at the gate level — `verifyDistClosureDir` + the `--verify-closure-dir`
//      CLI, on a fixture tree. The mutation is the Contract's own control: delete a `dist/<name>.js`
//      the tree references ⇒ red (exit 1 + the name listed); restore ⇒ green.
//   2. AC2: the REAL publish-dist-branch.sh, run end-to-end in a disposable stub repo, must ABORT —
//      non-zero exit, no orphan commit, no branch — when the tree it is about to commit lost a
//      referenced bundle. The mutation is injected by a PATH shim that acts ONLY on the gate
//      invocation (the build/rewrite/commit steps stay genuine). A warn-and-continue gate would pass
//      step 1 and fail this one, which is why the abort is asserted behaviorally rather than by
//      grepping the script for `exit`.
//   3. The prose filter is pinned: an unfiltered artifact scan reports `X.js` (a doc placeholder in
//      plugin/scripts/quay-init.sh with no backing .ts) — measured on the real tree 2026-09-15, see
//      scanPublishTreeReferences' docstring. This test keeps the filtered/unfiltered distinction
//      from silently collapsing.
//
// Run: scripts/test.sh plugin/test/publish-dist-branch-closure-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";
import { verifyDistClosureDir, scanPublishTreeReferences } from "../../packages/quay/scripts/build-plugin-dist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const PUBLISH_SCRIPT = path.join(pluginDir, "scripts", "publish-dist-branch.sh");
const BUILD_PLUGIN_DIST = path.join(repoRoot, "packages", "quay", "scripts", "build-plugin-dist.mjs");
const NODE_MODULES = path.join(repoRoot, "node_modules");

function writeFile(p, content, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, mode === undefined ? undefined : { mode });
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

/** Run the gate CLI. Returns { status, stdout, stderr } (never throws on a non-zero gate). */
function runGateCli(publishRoot, sourcePluginRoot) {
  const args = ["--experimental-strip-types", BUILD_PLUGIN_DIST, "--verify-closure-dir", publishRoot];
  if (sourcePluginRoot) args.push(sourcePluginRoot);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

// ── layer 1: the gate itself, red/green/restore (AC3) ───────────────────────────────────────────────

/** A minimal assembled-tree shape: one real script `alpha-tool`, shipped as a bundle and referenced
 *  by a carrier in the rewritten form the publish step produces. */
function makeFixtureTree(tag) {
  const root = makeTmpDir(tag);
  writeFile(
    path.join(root, "scripts", "alpha-tool.ts"),
    'export function main(): void {\n  console.log("alpha-tool");\n}\n'
  );
  writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    "# demo\n\nRun: `node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/alpha-tool.js`\n"
  );
  writeFile(path.join(root, "scripts", "dist", "alpha-tool.js"), "// bundled alpha-tool\n");
  return root;
}

test("AC3: a dist bundle the tree references but does not carry is RED; restore is GREEN", () => {
  const root = makeFixtureTree("ac263-fixture-");
  const bundle = path.join(root, "scripts", "dist", "alpha-tool.js");

  // green side — present ⇒ no missing, CLI exit 0
  const green = verifyDistClosureDir(root, root);
  assert.deepEqual(green.missing, [], "a carried bundle must not be reported missing");
  assert.deepEqual(green.required, ["alpha-tool"], "the required set must come from the real tree");
  const greenCli = runGateCli(root, root);
  assert.equal(greenCli.status, 0, `gate must be green: ${greenCli.stderr}`);
  assert.match(greenCli.stdout, /dist-closure gate OK \(directory\): 1 referenced dist bundles/);
  // the ARTIFACT-side reading alone (no source root ⇒ no entry derivation) must reach the same
  // requirement — that is the "another reading for the directory form" half of AC1, and it is what
  // makes the gate independent of a source tree that happens to be present.
  assert.deepEqual(verifyDistClosureDir(root).required, ["alpha-tool"]);

  // red side — the Contract's mutation: delete a referenced dist bundle
  fs.rmSync(bundle);
  const red = verifyDistClosureDir(root, root);
  assert.deepEqual(red.missing, ["alpha-tool"], "the deleted bundle must be reported missing");
  assert.deepEqual(
    verifyDistClosureDir(root).missing,
    ["alpha-tool"],
    "the artifact-side reading alone must catch the Contract's mutation"
  );
  const redCli = runGateCli(root, root);
  assert.equal(redCli.status, 1, "a gate that cannot take the value false is a false assurance");
  assert.match(redCli.stderr, /dist-closure gate FAILED/);
  assert.match(redCli.stderr, /- alpha-tool\.js/);

  // restore ⇒ green again (both sides, not just one hand-run)
  writeFile(bundle, "// bundled alpha-tool\n");
  assert.deepEqual(verifyDistClosureDir(root, root).missing, []);
  assert.equal(runGateCli(root, root).status, 0);
});

test("AC1/AC3: a rebuilt-but-unreferenced bundle is NOT a closure requirement (the predicate is references, not a file count)", () => {
  const root = makeFixtureTree("ac263-unref-");
  // A bundle nothing references: its absence changes no reading, its presence requires no reference.
  writeFile(path.join(root, "scripts", "dist", "orphan-tool.js"), "// nobody references me\n");
  assert.deepEqual(verifyDistClosureDir(root, root).missing, []);
  fs.rmSync(path.join(root, "scripts", "dist", "orphan-tool.js"));
  assert.deepEqual(verifyDistClosureDir(root, root).missing, []);
  // …while a reference to a name no real plugin script backs is PROSE, not closure (the measured
  // `X.js` case): it must not be reported missing, or the primary publish channel fails on a doc
  // placeholder. Spelling mirrors the real carrier (plugin/scripts/quay-init.sh:1913).
  writeFile(path.join(root, "scripts", "dist", "alpha-tool.js"), "// bundled alpha-tool\n");
  writeFile(
    path.join(root, "skills", "demo", "PLACEHOLDER.md"),
    "# placeholder\n\nthe rewritten form resolves as `$ws/plugin/scripts/dist/X.js`\n"
  );
  assert.equal(scanPublishTreeReferences(root, undefined).has("X"), true, "unfiltered scan sees it");
  assert.deepEqual(verifyDistClosureDir(root, root).missing, [], "filtered by the source's real .ts");
});

// ── layer 2: the real publish script must ABORT (AC2) ───────────────────────────────────────────────

/** A disposable stub repo holding the REAL publish script + the REAL bundler, with one bundleable
 *  script referenced by one carrier — small enough to assemble in seconds, structurally the same
 *  shape the real repo hands the script (plugin/ + packages/quay/scripts + vendor bundle). */
function makeStubRepo(tag) {
  const root = makeTmpDir(tag);
  // esbuild is resolved by walking up from the bundler's own location ⇒ the stub needs node_modules.
  fs.symlinkSync(NODE_MODULES, path.join(root, "node_modules"), "dir");
  writeFile(path.join(root, "README.md"), "stub\n");
  // the REAL script and the REAL bundler — a copy of a fixture would stop testing what ships
  writeFile(path.join(root, "plugin", "scripts", "publish-dist-branch.sh"), fs.readFileSync(PUBLISH_SCRIPT));
  writeFile(
    path.join(root, "packages", "quay", "scripts", "build-plugin-dist.mjs"),
    fs.readFileSync(BUILD_PLUGIN_DIST)
  );
  writeFile(path.join(root, "plugin", "scripts", "alpha-tool.ts"), 'export const alpha = 1;\n');
  // the raw-shipped registry the strip step must preserve (publish-dist-branch.sh's sanity check)
  writeFile(path.join(root, "plugin", "scripts", "runner-static-gate.ts"), "export const registry = 1;\n");
  // the strip step finds over both script dirs ⇒ gate-scripts must exist even when empty
  writeFile(path.join(root, "plugin", "gate-scripts", ".keep"), "");
  writeFile(
    path.join(root, "plugin", "skills", "demo", "SKILL.md"),
    "# demo\n\nRun: `node --experimental-strip-types plugin/scripts/alpha-tool.ts`\n"
  );
  writeFile(path.join(root, "plugin", "vendor", "quay", "dist", "quay.js"), "// stub vendor bundle\n");
  git(root, "init", "-q", "-b", "master");
  git(root, "add", "-A");
  git(root, "-c", "user.name=ac263", "-c", "user.email=ac263@test.invalid", "commit", "-q", "-m", "stub");
  return root;
}

/** A `node` shim that removes one bundle from the assembled tree at the gate invocation only, then
 *  execs the real node — so the publish run itself is unmodified and the mutation is exactly the
 *  Contract's control ("从待发布树里删掉一个被引用的 scripts/dist/*.js"). */
function makeMutationShim(tag, dropName) {
  const dir = makeTmpDir(tag);
  writeFile(
    path.join(dir, "node"),
    [
      "#!/usr/bin/env bash",
      "prev=''",
      'for a in "$@"; do',
      '  if [ "$prev" = "--verify-closure-dir" ]; then',
      `    rm -f "$a/scripts/dist/${dropName}.js"`,
      '    echo "[ac263-shim] MUTATION: removed scripts/dist/' + `${dropName}.js before the gate"`,
      "  fi",
      '  prev="$a"',
      "done",
      `exec "${process.execPath}" "$@"`,
      "",
    ].join("\n"),
    0o755
  );
  return dir;
}

function runPublish(stubRoot, branch, shimDir) {
  const env = { ...process.env };
  if (shimDir) env.PATH = `${shimDir}:${env.PATH}`;
  return spawnSync("bash", [path.join(stubRoot, "plugin", "scripts", "publish-dist-branch.sh"), "--no-build", "--branch", branch], {
    cwd: stubRoot,
    encoding: "utf8",
    env,
  });
}

test("AC2: the real publish script exits non-zero and commits nothing when a referenced bundle is absent", () => {
  const stub = makeStubRepo("ac263-stub-");
  const branch = "probe-dist";

  // green baseline: the same script, the same tree, no mutation
  const ok = runPublish(stub, branch, undefined);
  assert.equal(ok.status, 0, `baseline publish must succeed:\n${ok.stdout}\n${ok.stderr}`);
  assert.match(ok.stdout, /dist-closure gate OK \(directory\): 1 referenced dist bundles/);
  assert.match(ok.stdout, /orphan commit ready/);
  assert.equal(git(stub, "branch", "--list", branch).length > 0, true, "green run must create the branch");
  git(stub, "branch", "-D", branch);

  // red: one referenced bundle removed from the tree the gate reads
  const shim = makeMutationShim("ac263-shim-", "alpha-tool");
  const red = runPublish(stub, branch, shim);
  const out = `${red.stdout}\n${red.stderr}`;
  assert.notEqual(red.status, 0, "the gate must abort the publish, not warn");
  assert.match(out, /dist-closure gate FAILED/);
  assert.match(out, /- alpha-tool\.js/);
  assert.ok(!/orphan commit ready/.test(out), "no commit may be created after a failed gate");
  assert.equal(
    git(stub, "branch", "--list", branch),
    "",
    "a failed gate must leave no branch behind (the later commit/push steps must not have run)"
  );
});
