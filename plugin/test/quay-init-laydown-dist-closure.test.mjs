// @test-group engine
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-16 packaged-install e2e; install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// this file stages a PACKAGED plugin (package.sh's dist-bundle + .ts-delete + invoker-rewrite) and
// runs a real quay-init.sh --loop install from it, so it belongs to the concurrency-1 serial phase
// with the rest of the install family.
//
// quay-init-laydown-dist-closure.test.mjs — gap-delivery-laydown-dist-closure-gap.
//
// The PACKAGED artifact's closure derivation must pull ${SCRIPT_DIR}/dist/X.js siblings into the
// laydown set. package.sh rewrites every .ts reference in .sh/.md/workflow invokers to the bundled
// dist/X.js form, then DELETES the raw .ts; the packaged quay-init.sh's dependency-closure regex
// must match the two-segment `dist/X.js` path (pre-fix the single-segment `[a-zA-Z0-9._-]*`
// truncated it to `dist` and the basename-strip dropped the dist/ prefix — so
// dist/transcript-delivery-check.js + dist/pane-state-classify.js never entered the laydown set and
// B/C machines' send-keys-reliable.sh failed loud at runtime). This pins:
//   AC1 — the packaged verify_referenced_landed closure-CHECK passes on a packaged install (the
//         closure-check regex also matches dist/X.js paths and checks $ws/plugin/scripts/dist/X.js).
//   AC2 — a packaged --loop install lays down dist/transcript-delivery-check.js +
//         dist/pane-state-classify.js (exit 0, both files present, verify OK).
//   AC3 — negative control: a ${SCRIPT_DIR}/dist/ghost.js reference makes the packaged install FAIL
//         LOUD (dependency-not-landed, names dist/ghost.js), while the two real dist bundles land.
//
// Run:
//   scripts/test.sh plugin/test/quay-init-laydown-dist-closure.test.mjs
//   node --test plugin/test/quay-init-laydown-dist-closure.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { buildPluginDist, rewriteInvokers } from "../../packages/quay/scripts/build-plugin-dist.mjs";
import { diskWorktreeRoot } from "./quay-init-loop-helpers.mjs";
import { stagingDirPrefix } from "../scripts/loop-shipping-exclusion-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");

// The staged packaged-plugin root. A staged copy must live INSIDE the repo tree so esbuild can
// resolve yaml from the repo root's node_modules when bundling read-probe-spec.ts etc. (a /tmp
// staging dir fails that resolution). package.sh itself stages at packages/quay/plugin, but a test
// must NOT reuse that shared path: two concurrent test invocations (e.g. this file's standalone run
// racing a `scripts/test.sh --for-task` run) would clobber each other's staging. Each
// stagePackagedPlugin() call gets a PID + counter-unique subdir, cleaned up in the after() hook.
const STAGED_PREFIX = stagingDirPrefix; // single source: loop-shipping-exclusion-data.mjs
let _stagingCounter = 0;
const _stagingDirs = [];

const _cleanups = [];
after(() => {
  for (const d of _stagingDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  _stagingDirs.length = 0;
  for (const d of _cleanups) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  _cleanups.length = 0;
});
function makeTmp(prefix = "pkgdist-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _cleanups.push(d);
  return d;
}

// gap-orphan-staging-dirs-pollute-walkcorpus: a KILLED prior run leaves packages/quay/
// plugin-staging-<pid>-{0,1}/ orphans (the after() hook never fires on OOM/interrupt). Remove them at
// startup — but ONLY when their embedded PID is no longer alive, so a LIVE concurrent invocation's
// staging dir (its PID is alive) is never deleted. Best-effort hygiene; the hard guard against SCAN
// pollution is walkCorpus's name-skip (stagingDirPrefix in loop-shipping-exclusion-data.mjs).
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true; // unparseable → conservative: keep it
  try {
    process.kill(pid, 0); // signal 0 = existence probe, no signal delivered
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // EPERM = exists but owned elsewhere; ESRCH = gone
  }
}
function cleanOrphanStagingDirs() {
  const container = path.join(repoRoot, 'packages', 'quay');
  let entries;
  try { entries = fs.readdirSync(container, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (!ent.isDirectory() || !ent.name.startsWith(stagingDirPrefix)) continue;
    const rest = ent.name.slice(stagingDirPrefix.length); // e.g. "3477285-0"
    const pid = Number.parseInt(rest.split('-')[0], 10);
    if (pidAlive(pid)) continue;
    try { fs.rmSync(path.join(container, ent.name), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
cleanOrphanStagingDirs();

function vendorRuntimePresent() {
  return fs.existsSync(path.join(pluginDir, "vendor", "quay", "dist", "quay.js"))
    && fs.existsSync(path.join(pluginDir, "vendor", "quay-native", "dist", "quay-native.js"));
}

function walkDelete(d, pred) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walkDelete(p, pred);
    else if (pred(ent.name)) fs.rmSync(p);
  }
}

// stagePackagedPlugin() — mirror package.sh's staging on a copy of the source plugin:
//   1. copy plugin/ → a PID-unique staging root (inside the repo tree so esbuild resolves yaml),
//      EXCLUDING plugin/test (package.sh's `rm -rf ${PLUGIN_DEST}/test` — the shipped artifact
//      carries no test suite, and excluding it keeps the test index unpolluted)
//   2. bundle consumer-referenced .ts → scripts/dist/*.js (+ gate-scripts/dist/*.js)
//   3. DELETE the raw .ts (the shipped artifact carries only the bundles)
//   4. rewrite staged invokers (.sh/.md + workflow .js) to reference the dist bundles
//   5. copy the vendored runtime bundles (the installed copy's quay-init --loop lays them into the
//      target's .quay/runtime/ — absent ⇒ the provider mcp_entry check fails closed)
async function stagePackagedPlugin() {
  const staged = path.join(repoRoot, "packages", "quay", `${STAGED_PREFIX}${process.pid}-${_stagingCounter++}`);
  _stagingDirs.push(staged);
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(staged, { recursive: true });
  fs.cpSync(pluginDir, staged, { recursive: true });
  fs.rmSync(path.join(staged, "test"), { recursive: true, force: true });
  // buildPluginDist is ASYNC (esbuild) — must await before the .ts deletion, or the deletion races
  // esbuild's reads and the bundles never build.
  await buildPluginDist(staged);
  for (const sub of ["scripts", "gate-scripts"]) {
    const d = path.join(staged, sub);
    if (!fs.existsSync(d)) continue;
    walkDelete(d, (name) => name.endsWith(".ts"));
  }
  rewriteInvokers(staged);
  for (const b of ["vendor/quay/dist/quay.js", "vendor/quay-native/dist/quay-native.js"]) {
    const src = path.join(pluginDir, b);
    if (fs.existsSync(src)) {
      const dst = path.join(staged, b);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  return staged;
}

function runPackagedInit(staged, ws) {
  return spawnSync(
    "bash",
    [path.join(staged, "scripts", "quay-init.sh"),
      "--loop", "--root", ws, "--project", "proj",
      "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
      "--worktree-root", diskWorktreeRoot()],
    { encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: staged } },
  );
}

// ── AC2 + AC1: a packaged --loop install lays down the two dist bundles the .sh wrappers call ──────
test("AC2/AC1 — packaged --loop lays down dist/transcript-delivery-check.js + dist/pane-state-classify.js and verify passes", async (t) => {
  if (!vendorRuntimePresent()) {
    t.skip("source plugin has no built vendored runtime (gitignored; run npm install at the repo root)");
    return;
  }
  const staged = await stagePackagedPlugin();
  const ws = makeTmp("pkgdist-ws-");
  try {
    const r = runPackagedInit(staged, ws);
    assert.equal(r.status, 0, `packaged init must exit 0:\n${r.stderr}`);
    // The two bundles send-keys-reliable.sh references via ${SCRIPT_DIR}/dist/… MUST be laid down.
    for (const f of ["transcript-delivery-check.js", "pane-state-classify.js"]) {
      const p = path.join(ws, "plugin", "scripts", "dist", f);
      assert.ok(fs.existsSync(p), `dist/${f} must be laid down (closure regex covers dist/X.js paths): ${p}`);
    }
    assert.match(r.stdout + r.stderr, /verify-referenced-landed: OK/,
      "the packaged closure-CHECK must also match dist/X.js paths and pass");
  } finally {
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── AC3: negative control — a ${SCRIPT_DIR}/dist/ghost.js reference fails the install loud ─────────
test("AC3 — negative control: a dist/ghost.js reference fails the packaged install loud (dependency-not-landed)", async (t) => {
  if (!vendorRuntimePresent()) {
    t.skip("source plugin has no built vendored runtime (gitignored; run npm install at the repo root)");
    return;
  }
  const staged = await stagePackagedPlugin();
  // Point a laid-down consumer's CHECKER at a dist bundle that does not exist.
  const sk = path.join(staged, "scripts", "send-keys-reliable.sh");
  const before = fs.readFileSync(sk, "utf8");
  fs.writeFileSync(sk, before.replace("${SCRIPT_DIR}/dist/transcript-delivery-check.js", "${SCRIPT_DIR}/dist/ghost.js"));
  const ws = makeTmp("pkgdist-ghost-");
  try {
    const r = runPackagedInit(staged, ws);
    assert.notEqual(r.status, 0, "packaged init must FAIL when a laid-down script references a missing dist bundle");
    assert.match(r.stderr, /dependency-not-landed/, "must use the dependency-not-landed category");
    assert.match(r.stderr, /dist\/ghost\.js/, "must name the missing dist bundle");
  } finally {
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── orphan staging-dir cleanup (gap-orphan-staging-dirs-pollute-walkcorpus) ─────────────────────────
test("cleanup — cleanOrphanStagingDirs removes a dead-PID orphan, keeps a live-PID staging dir", () => {
  const container = path.join(repoRoot, "packages", "quay");
  // A dead PID: the pid of a completed sync child (already exited + reaped when spawnSync returns).
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  const deadOrphan = path.join(container, `${stagingDirPrefix}${deadPid}-cleanup-dead`);
  const liveDir = path.join(container, `${stagingDirPrefix}${process.pid}-cleanup-live`);
  fs.mkdirSync(deadOrphan, { recursive: true });
  fs.writeFileSync(path.join(deadOrphan, "probe.md"), "orphan residue\n");
  fs.mkdirSync(liveDir, { recursive: true });
  try {
    cleanOrphanStagingDirs();
    assert.ok(!fs.existsSync(deadOrphan), "a dead-PID plugin-staging-* orphan must be removed");
    assert.ok(fs.existsSync(liveDir), "a live-PID plugin-staging-* dir must NOT be removed (concurrent invocation)");
  } finally {
    fs.rmSync(deadOrphan, { recursive: true, force: true });
    fs.rmSync(liveDir, { recursive: true, force: true });
  }
});
