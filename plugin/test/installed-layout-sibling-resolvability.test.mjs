// @test-group product
// installed-layout-sibling-resolvability.test.mjs — gap-fan-in-installed-layout-sibling-script-
// resolvability-test-and-reaper-bundling.
//
// THE DEFECT THIS PINS. `packages/quay/src/fan-in/ff-merge.ts` spawns plugin scripts as SIBLINGS:
// the resolver tries the raw `.ts` first (dev tree) and the shipped `dist/<name>.js` second, and the
// shipped artifact DELETES the raw plugin `.ts` — so in ANY install layout only the bundle can
// resolve. `worktree-process-reaper.ts` was never in the packager's derived entry set (the
// derivation's every scan keys on a literal path segment; this spawn carries none), so no
// `dist/worktree-process-reaper.js` was ever produced. Measured on the REAL `package.sh` artifact:
//   - at v0.10.0 (tag 4c8116632, 96 dist bundles): reaper NOT-RESOLVABLE
//   - at this task's base commit (99 dist bundles):  reaper NOT-RESOLVABLE
// It surfaced only as `worktree-process-reaper not resolvable` on an already-refused failure path,
// which read as harmless noise. NO test ran any of these resolutions in a packaged layout — which is
// why the classifier's own (already-fixed) variant and this one are one class, not two incidents
// (硬规则 5b: fix the class, not the instance that was reported).
//
// WHAT IS ASSERTED, and against what (⛔ no re-implementation of any production rule in test code):
//   1. the MANIFEST is complete — `SIBLING_SCRIPTS` (exported by ff-merge.ts, the SINGLE SOURCE the
//      call sites read) has exactly one row per `siblingScriptArgv` call site in that file, so a new
//      call site that is not registered turns this red;
//   2. every manifest script RESOLVES in a PACKAGED layout — through ff-merge's OWN resolver, against
//      a layout built by the REAL packager (`deriveEntries` + `bundleEntries`, i.e. the same code
//      `package.sh` runs), never a hand-assembled `dist/`;
//   3. the packager's DERIVATION lists every manifest script as a bundle entry (this is the mechanism
//      that makes `package.sh` ship them — asserted separately from 2 because 2 can only fail after
//      the bundle step);
//   4. the shipped bundle actually RUNS on a bare node (no `--experimental-strip-types`), which is
//      the artifact's whole contract;
//   5. END-TO-END on that packaged layout + a disposable THIRD-PARTY git project: the certificate
//      gate reaches a VERDICT (⛔ never `not-evaluated`) for both a task-status flip commit and a
//      `src/app.ts` delta, and the reaper step runs without `not resolvable`.
//
// WHY RESOLUTION IS MEASURED AGAINST `…/scripts/dist` (not `…/scripts`): that is the production shape
// (`worker-driver` passes `resolveKernelScriptsDir()` = the bundled kernel's dir) and it is the shape
// in which the raw `.ts` candidate STRUCTURALLY cannot exist — the bundler writes only `.js` there.
// So the test needs no copy of `package.sh`'s raw-`.ts` deletion rule and cannot pass by falling back
// to a dev-tree `.ts`.
//
// Run: scripts/test.sh plugin/test/installed-layout-sibling-resolvability.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_SRC = path.join(REPO_ROOT, "plugin");
const PKG_DIR = path.join(REPO_ROOT, "packages", "quay");
const BUILD_PLUGIN_DIST = path.join(PKG_DIR, "scripts", "build-plugin-dist.mjs");
const FF_MERGE_TS = path.join(PKG_DIR, "src", "fan-in", "ff-merge.ts");

const { SIBLING_SCRIPTS, siblingScriptArgv, siblingScriptCandidates, classifyDeltaVerdict } =
  await import(FF_MERGE_TS);
const { deriveEntries, bundleEntries } = await import(BUILD_PLUGIN_DIST);

/** The manifest's rows (one per call site) and its distinct script names (what must be packaged). */
const MANIFEST_ROWS = Object.entries(SIBLING_SCRIPTS);
const MANIFEST_NAMES = [...new Set(Object.values(SIBLING_SCRIPTS))].sort();

// ── the packaged layout, built by the REAL packager ─────────────────────────────────────────────────

let layout = null;

/** Build a real packaged plugin layout in a private tmp dir (never a shared build artifact).
 *  `cp -R plugin/` is the same staging copy `package.sh` makes; the bundles come from the REAL
 *  `deriveEntries` + `bundleEntries`, so this is the artifact's own code path, not a fixture. */
async function buildPackagedLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "installed-layout-"));
  const pluginRoot = path.join(root, "plugin");
  fs.cpSync(PLUGIN_SRC, pluginRoot, { recursive: true });
  // esbuild resolves the plugin's bare deps (`yaml`) by walking up from the entry, so the layout
  // needs a node_modules it can reach — the SHARED checkout's, by symlink (the same shape
  // `dispatch-worktree-setup.sh` provisions a worktree with). ⛔ A symlink, never a copy: the test
  // must not own a second install of the dependency tree.
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  const { scripts, gateScripts } = deriveEntries(pluginRoot);
  const entries = [...scripts, ...gateScripts].filter((rel) =>
    MANIFEST_NAMES.includes(path.basename(rel))
  );
  const outfiles = await bundleEntries(pluginRoot, entries);
  return {
    root,
    pluginRoot,
    scriptsDir: path.join(pluginRoot, "scripts"),
    distDir: path.join(pluginRoot, "scripts", "dist"),
    entries,
    outfiles,
  };
}

before(async () => {
  layout = await buildPackagedLayout();
});

after(() => {
  if (layout) fs.rmSync(layout.root, { recursive: true, force: true });
});

// ── 1. the manifest is complete (one row per call site) ─────────────────────────────────────────────

test("AC2a: SIBLING_SCRIPTS has exactly one row per siblingScriptArgv call site in ff-merge.ts", () => {
  const src = fs.readFileSync(FF_MERGE_TS, "utf8");
  // The AC's own predicate: `grep -n "siblingScriptArgv(" packages/quay/src/fan-in/ff-merge.ts`.
  const hits = [...src.matchAll(/siblingScriptArgv\(/g)].map((m) => src.slice(0, m.index).split("\n").length);
  const definitionLines = [...src.matchAll(/(?:function\s+|const\s+)siblingScriptArgv\s*\(/g)].map(
    (m) => src.slice(0, m.index).split("\n").length
  );
  assert.equal(definitionLines.length, 1, `expected exactly one DECLARATION of siblingScriptArgv, got ${definitionLines}`);
  const callSites = hits.filter((l) => !definitionLines.includes(l));
  const srcLines = src.split("\n");
  const firstThree = callSites.slice(0, 3).map((l) => `${l}:${srcLines[l - 1].trim()}`);
  assert.equal(
    callSites.length,
    MANIFEST_ROWS.length,
    `the manifest must carry one row per call site — a NEW call site that is not registered here ` +
      `(and therefore never packaged) must turn this red.\n` +
      `  grep -n "siblingScriptArgv(" ${path.relative(REPO_ROOT, FF_MERGE_TS)} → ${hits.length} hit(s), ` +
      `of which ${definitionLines.length} is the declaration at line ${definitionLines[0]}\n` +
      `  call sites (${callSites.length}):\n    ${firstThree.join("\n    ")}\n` +
      `  manifest rows (${MANIFEST_ROWS.length}): ${MANIFEST_ROWS.map(([k, v]) => `${k}=${v}`).join(", ")}`
  );
  // One row per call site (not per distinct script) is what makes the relation exact.
  assert.deepEqual(
    [...new Set(MANIFEST_ROWS.map(([, v]) => v))].sort(),
    MANIFEST_NAMES,
    "manifest values are the plugin script names; the distinct set is what must be packaged"
  );
});

// ── 2. every manifest script resolves in the packaged layout ────────────────────────────────────────

test("AC2b: every manifest script resolves through ff-merge's own resolver in the packaged layout", () => {
  for (const name of MANIFEST_NAMES) {
    const argv = siblingScriptArgv(layout.distDir, name);
    assert.ok(
      argv,
      `${name} is NOT RESOLVABLE under ${layout.distDir} — tried ${siblingScriptCandidates(
        layout.distDir,
        name
      ).join(" , ")} (this is the install-layout failure the task exists to remove)`
    );
    const resolved = argv[argv.length - 1];
    assert.ok(
      resolved.endsWith(".js"),
      `${name} resolved to ${resolved} — in a packaged layout only the SHIPPED BUNDLE may resolve ` +
        `(a raw .ts there means the layout is not the artifact's)`
    );
    assert.ok(fs.existsSync(resolved), `resolved path vanished: ${resolved}`);
  }
});

test("AC2c: the packager's derivation lists every manifest script as a bundle entry", () => {
  // The mechanism half: `package.sh` bundles exactly what `deriveEntries` returns, so a manifest
  // script missing here ships no bundle however well test AC2b's layout happens to be built.
  const { scripts, gateScripts } = deriveEntries(PLUGIN_SRC);
  const derived = new Set([...scripts, ...gateScripts].map((rel) => path.basename(rel)));
  const missing = MANIFEST_NAMES.filter((n) => !derived.has(n));
  assert.deepEqual(
    missing,
    [],
    `deriveEntries(plugin/) does not list these sibling-resolved scripts as bundle entries, so ` +
      `package.sh would ship no dist/<name>.js for them: ${missing.join(", ")}`
  );
});

test("AC2d: each shipped bundle is an entry the plugin owns and runs bare (no --experimental-strip-types)", () => {
  assert.deepEqual(
    layout.outfiles.map((f) => path.basename(f)).sort(),
    MANIFEST_NAMES.map((n) => n.replace(/\.ts$/, ".js")).sort(),
    "the real bundler must produce exactly one dist bundle per distinct manifest script"
  );
  // `--list` is the reaper's dry run (kills nothing) and exits 0 — so a zero exit here means a bare
  // node actually EXECUTED the bundle, and the JSON shape is the reaper's own output contract (a
  // bundle that ran an inlined sibling's main would not emit it).
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reaper-bare-"));
  const r = spawnSync(
    process.execPath,
    [path.join(layout.distDir, "worktree-process-reaper.js"), "--worktree", probeRoot, "--list", "--json"],
    { encoding: "utf8", timeout: 60_000 }
  );
  fs.rmSync(probeRoot, { recursive: true, force: true });
  assert.equal(
    r.status,
    0,
    `the shipped reaper bundle must run on a bare node (no --experimental-strip-types): ${r.stderr}`
  );
  const probe = JSON.parse(r.stdout);
  assert.equal(probe.mode, "worktree", `expected the reaper's own JSON output, got: ${r.stdout}`);
});

// ── 3. end-to-end: packaged layout + a disposable THIRD-PARTY project ───────────────────────────────

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

/** A disposable project with no relation to quay — the shape an installed copy actually runs in.
 *  Returns the commit shas whose `git diff --name-only` IS each delta. */
function makeExternalProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "external-project-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "installed-layout-test");
  git(root, "config", "user.email", "ilt@example.com");
  git(root, "branch", "-M", "develop");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const app = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const base = git(root, "rev-parse", "HEAD");

  // the flip commit: a task-status toggle, the delta a fan-in always carries
  fs.writeFileSync(path.join(root, "tasks", "demo-task.md"), "# demo\n\n## AC\n\n- [ ] one\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "task file");
  const preFlip = git(root, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(root, "tasks", "demo-task.md"), "# demo\n\n## AC\n\n- [x] one\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "tasks: demo-task ready→done（flip）");
  const flip = git(root, "rev-parse", "HEAD");

  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const app = 2;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "code delta");
  const code = git(root, "rev-parse", "HEAD");
  return { root, base, preFlip, flip, code };
}

test("AC4: the certificate gate and the reaper are EVALUATED, end-to-end, on a packaged layout + an external project", () => {
  const proj = makeExternalProject();
  try {
    const delta = (a, b) => git(proj.root, "diff", "--name-only", a, b).split("\n").filter(Boolean);

    const flipDelta = delta(proj.preFlip, proj.flip);
    const codeDelta = delta(proj.flip, proj.code);
    assert.deepEqual(flipDelta, ["tasks/demo-task.md"], "the flip delta is the task file alone");
    assert.deepEqual(codeDelta, ["src/app.ts"], "the code delta is the source file alone");

    const flipVerdict = classifyDeltaVerdict(proj.root, layout.distDir, flipDelta);
    const codeVerdict = classifyDeltaVerdict(proj.root, layout.distDir, codeDelta);

    assert.notEqual(
      flipVerdict.kind,
      "not-evaluated",
      `the certificate gate must REACH A VERDICT for a flip commit on a packaged layout: ${flipVerdict.detail ?? ""}`
    );
    assert.notEqual(
      codeVerdict.kind,
      "not-evaluated",
      `the certificate gate must REACH A VERDICT for a code delta on a packaged layout: ${codeVerdict.detail ?? ""}`
    );
    // The three-state verdicts must be the REAL ones, not two flavours of "unknown".
    assert.equal(flipVerdict.kind, "inert", `a task-status flip is an inert delta, got ${JSON.stringify(flipVerdict)}`);
    assert.equal(codeVerdict.kind, "non-inert", `src/app.ts is a code delta, got ${JSON.stringify(codeVerdict)}`);
    assert.deepEqual(codeVerdict.paths, ["src/app.ts"]);

    // The reaper step of the blocked certificate path, exactly as ff-merge spawns it.
    const reaperArgv = siblingScriptArgv(layout.distDir, SIBLING_SCRIPTS.reaperRun);
    assert.ok(reaperArgv, "the reaper must resolve for the blocked-path step to run at all");
    const r = spawnSync(
      process.execPath,
      [...reaperArgv.slice(1), "--orphans", "--stale-lock-holders-only", "--root", proj.root, "--json"],
      { encoding: "utf8", timeout: 120_000 }
    );
    assert.equal(r.status, 0, `the reaper step must run clean on a foreign project: ${r.stderr}`);
    assert.doesNotMatch(
      r.stderr + r.stdout,
      /not resolvable/i,
      "the blocked path's reaper step must not report `not resolvable` any more"
    );
  } finally {
    fs.rmSync(proj.root, { recursive: true, force: true });
  }
});
