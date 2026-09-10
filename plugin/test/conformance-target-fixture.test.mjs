// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-09-10 real quay-init --loop conformance-target fixture (GOAL-012 exit③); spawns a quay-init subprocess tree, install-family
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each run spawns a real quay-init.sh --loop install subprocess tree, so it belongs in the
// concurrency-1 serial phase alongside quay-init.test.mjs (gap-install-family-tests-rotate-flakes-
// under-full-suite). It does NOT run a real npm install (人 2026-09-10 裁定暂缓 — the dist-layout
// blind spot is covered by the AC-224/225 static checkers + the real remote periodic re-verification).
//
// conformance-target-fixture.test.mjs — gap-ac228-conformance-target-fixture-real-quay-init: the
// GOAL-012 exit-③ conformance-target fixture. It builds a REAL third-party target by spawning
// quay-init.sh --loop (⛔ NOT a committed snapshot, ⛔ NOT a hand-written makeWorkspace() config —
// the hand-written form matches "the layout the test author imagines" instead of "the layout
// quay-init actually produces"; the profiles.yml-missing-worker-roles drift surfaced on 2026-09-09
// is exactly that gap). Two targets:
//
//   P-real — three axes all UNLIKE this repo (no plugin/, working branch ≠ author, no
//            scripts/test.sh — only loop.test_command) — is the GATE: the three-domain resolution /
//            command constructors must not anchor at this repo's own features.
//   P-self — this-repo shape (scripts/test.sh present, working branch author) — is the NEGATIVE
//            CONTROL: the three commands stay byte-identical to their pre-migration form (the
//            third-party degradation must not back-flow into this repo).
//
// The three domains (GOAL-012 "kernel↔target boundary" ownership):
//   A — script-path resolution   resolveKernelSibling / resolveKernelPluginRoot (driver-runtime.ts),
//                                 resolvePluginScript (packages/quay/src/plugin-root.ts)
//   B — doc-branch derivation    resolveDocBranch (driver-filters.ts)
//   C — test command construction docCheckCommandFor / resolveScopedGateCommand /
//                                 defaultMechanicalSuiteCommand (worker-driver.ts)
//
// Run:
//   scripts/test.sh plugin/test/conformance-target-fixture.test.mjs
//   node --no-warnings --experimental-strip-types --test plugin/test/conformance-target-fixture.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A domain — kernel-side script resolution (anchors on the KERNEL's own install location, never the
// target root — AC-203; a third-party project has no plugin/ so target-root anchoring resolves to a
// missing path).
import { resolveKernelSibling, resolveKernelPluginRoot, resolveKernelScriptsDir } from "../scripts/driver-runtime.ts";
// A domain — Core-side plugin resolution (walks up from this module's own location, never cwd/root).
import { resolvePluginScript } from "../../packages/quay/src/plugin-root.ts";
// B domain — doc-branch derivation (runtime-derived from the target's checked-out branch, ⛔ not the
// hardcoded literal DOC_BRANCH "author").
import { resolveDocBranch } from "../scripts/driver-filters.ts";
// The OLD hardcoded form, kept as a LOCAL constant (⛔ non-shipped kernel — driver-filters.ts's
// `export const DOC_BRANCH = "author"` residual was eliminated by AC-226, gap-ac226-target-identity-
// literal-check d650099c8). It exists only to model "the old form misreads a non-author branch" (AC6 B).
const DOC_BRANCH = "author";
// C domain — test command construction (delegates to loop.test_command for a third-party project,
// ⛔ not unconditionally calling this repo's dev-tree scripts/test.sh).
import { docCheckCommandFor, resolveScopedGateCommand, defaultMechanicalSuiteCommand } from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, ".."); // <repo>/plugin — CLAUDE_PLUGIN_ROOT for the real quay-init
const repoRoot = path.resolve(pluginDir, "..");  // <repo>

// ── fixture hygiene (AC7): mkdtemp targets live OUTSIDE the repo tree ───────────────────────────────
const _tmp = [];
function makeTmp(prefix = "conformance-target-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(d);
  return d;
}
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
after(() => { for (const d of _tmp) cleanup(d); });

/** A worktree root on REAL DISK (⛔ /tmp is tmpfs — validate_worktree_root fails closed on tmpfs). */
function diskWorktreeRoot() {
  const d = fs.mkdtempSync(path.join("/var/tmp", "conformance-target-wt-"));
  _tmp.push(d);
  return d;
}

/** Run a git command (cwd=root, utf8, non-zero throws, returns trimmed stdout). */
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Spawn the REAL quay-init --loop against a fresh target dir (AC3: ⛔ not a hand-written config). */
function runInit(ws) {
  return spawnSync(
    "bash",
    [
      path.join(pluginDir, "scripts", "quay-init.sh"),
      "--loop", "--root", ws, "--project", "proj",
      "--test-command", "node --test",
      "--worktree-root", diskWorktreeRoot(),
    ],
    {
      cwd: ws,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
    },
  );
}

/** P-real: real quay-init --loop laydown + git init -b main (working branch ≠ author). */
function makePReal() {
  const ws = makeTmp();
  const r = runInit(ws);
  assert.equal(r.status, 0, `quay-init --loop must exit 0:\n${r.stdout}${r.stderr}`);
  execFileSync("git", ["init", "-q", "-b", "main", ws], { stdio: "ignore" });
  git(ws, "config", "user.email", "test@example.com");
  git(ws, "config", "user.name", "conformance-target-fixture");
  git(ws, "add", ".");
  git(ws, "commit", "-q", "-m", "baseline");
  return ws;
}

/** P-self: this-repo shape — scripts/test.sh present + a plugin/ dir + working branch author. */
function makePSelf() {
  const ws = makeTmp();
  fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(ws, "scripts", "test.sh"), "#!/bin/bash\necho test\n");
  fs.mkdirSync(path.join(ws, "plugin"), { recursive: true });
  fs.writeFileSync(path.join(ws, "plugin", ".keep"), "this-repo shape marker\n");
  execFileSync("git", ["init", "-q", "-b", "author", ws], { stdio: "ignore" });
  git(ws, "config", "user.email", "test@example.com");
  git(ws, "config", "user.name", "conformance-target-fixture");
  git(ws, "add", ".");
  git(ws, "commit", "-q", "-m", "baseline");
  return ws;
}

// Lazy singletons — quay-init --loop is the expensive step; build each target once and share it
// across the read-only assertions (tests in one file run sequentially).
let _pReal = null;
let _pSelf = null;
function pReal() { if (!_pReal) _pReal = makePReal(); return _pReal; }
function pSelf() { if (!_pSelf) _pSelf = makePSelf(); return _pSelf; }

// The full-suite-runner argv the C domain builds for a "this-repo shape" target — reconstructed via
// resolveKernelSibling (the same single-source the production code uses) so the AC5 byte-identical
// assertion is anchored on the real kernel location, not a hand-typed path.
function expectedSuiteArgv(task, worktree, root, suiteLogFile, runId) {
  const runner = resolveKernelSibling("full-suite-runner.ts");
  const prefix = runner
    ? (runner.stripTypes ? ["--experimental-strip-types", runner.path] : [runner.path])
    : ["--experimental-strip-types", path.join(resolveKernelScriptsDir(), "full-suite-runner.ts")];
  return [
    "node", "--no-warnings", ...prefix,
    "--buckets", task,
    "--root", worktree,
    "--state-dir", path.join(root, ".quay"),
    "--runner", "inner",
    "--log-file", suiteLogFile,
    "--run-id", runId,
  ];
}

// ── AC3: P-real is generated by the REAL quay-init and holds all three "unlike this repo" axes ──────

test("AC3 — P-real is laid down by real quay-init --loop and holds the three non-self axes", () => {
  const ws = pReal();

  // Axis A: no plugin/ dir (quay-init writes the seven-item closed set, never a plugin/scripts copy).
  assert.equal(fs.existsSync(path.join(ws, "plugin")), false, "no plugin/ dir (quay-init face)");
  // Axis B: working branch ≠ author.
  assert.equal(git(ws, "branch", "--show-current"), "main", "working branch is main (⛔ author)");
  assert.notEqual(git(ws, "branch", "--show-current"), "author", "working branch is explicitly not author");
  // Axis C: no scripts/test.sh, but loop.test_command in .quay/config.yml.
  assert.equal(fs.existsSync(path.join(ws, "scripts", "test.sh")), false, "no scripts/test.sh (third-party face)");
  const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
  assert.match(cfg, /loop:\s*\n(?:[ \t].*\n)*[ \t]+test_command: node --test/, "loop.test_command present in config.yml");
});

// ── AC4: P-real is the gate — three domains do not anchor at this repo's own features ───────────────

test("AC4 (A) — resolveKernelSibling / resolveKernelPluginRoot / resolvePluginScript do not anchor at P-real root", () => {
  const ws = pReal();
  const pRealResolved = path.resolve(ws);

  const sibling = resolveKernelSibling("ready-pool-check.ts");
  assert.ok(sibling, "resolveKernelSibling resolves non-null (kernel install location)");
  assert.ok(fs.existsSync(sibling.path), "resolved sibling exists on disk (⛔ target-root anchor ⇒ missing)");
  assert.ok(
    !path.resolve(sibling.path).startsWith(pRealResolved + path.sep),
    "sibling NOT anchored at P-real root",
  );

  const kpr = resolveKernelPluginRoot();
  assert.ok(kpr, "resolveKernelPluginRoot returns non-null");
  assert.ok(
    !path.resolve(kpr).startsWith(pRealResolved + path.sep),
    "kernel plugin root NOT under P-real root",
  );

  const ps = resolvePluginScript("scripts/driver-runtime.ts");
  assert.ok(ps && fs.existsSync(ps), "resolvePluginScript resolves an existing script");
  assert.ok(
    !path.resolve(ps).startsWith(pRealResolved + path.sep),
    "Core plugin script NOT anchored at P-real root",
  );
});

test("AC4 (B) — resolveDocBranch reads the target's real checked-out branch, ⛔ the literal author", () => {
  const ws = pReal();
  assert.equal(resolveDocBranch(ws), "main", "doc branch resolves to main (runtime-derived)");
  assert.notEqual(resolveDocBranch(ws), DOC_BRANCH, "doc branch is not the hardcoded literal 'author'");
});

test("AC4 (C) — no scripts/test.sh ⇒ delegate to loop.test_command / independent capability-absent value, no exit 127", () => {
  const ws = pReal();

  // doc-check: independent "capability absent" value (null), ⛔ not a broken dev-tree script argv.
  assert.equal(docCheckCommandFor(ws), null, "doc-check returns null (third-party-no-doc-check-tooling)");

  // scoped-gate: delegates to loop.test_command (`node --test`) via cd into the worktree.
  const scoped = resolveScopedGateCommand("gap-x", ws, ws);
  assert.equal(scoped.kind, "run", "scoped gate runs (delegated to test_command)");
  assert.deepEqual(scoped.argv, ["bash", "-c", `cd '${ws}' && node --test`], "scoped argv = bash -c 'cd <ws> && node --test'");
  assert.ok(!scoped.argv.join(" ").includes("exit 127"), "no exit 127 in scoped argv");

  // suite: delegates to loop.test_command (⛔ not full-suite-runner, which assumes this repo's layout).
  const suite = defaultMechanicalSuiteCommand({
    task: "gap-x", worktree: ws, root: repoRoot, suiteLogFile: "/tmp/f.log", runId: "r1",
  });
  assert.deepEqual(suite, ["bash", "-c", `cd '${ws}' && node --test`], "suite argv = bash -c 'cd <ws> && node --test'");
  assert.ok(!suite.join(" ").includes("exit 127"), "no exit 127 in suite argv");
});

// ── AC5: P-self negative control — three commands byte-identical to pre-migration ───────────────────

test("AC5 (P-self) — this-repo shape keeps doc-check / scoped-gate / suite byte-identical to pre-migration", () => {
  const ws = pSelf();

  // doc-check: bash <dir>/scripts/test.sh --static-checks-doc (unchanged).
  assert.deepEqual(
    docCheckCommandFor(ws),
    ["bash", path.join(ws, "scripts", "test.sh"), "--static-checks-doc"],
    "doc-check byte-identical (bash <ws>/scripts/test.sh --static-checks-doc)",
  );

  // scoped-gate: bash <dir>/scripts/test.sh --for-task <task> --allow-thin (unchanged).
  assert.deepEqual(
    resolveScopedGateCommand("gap-x", ws, ws),
    { kind: "run", argv: ["bash", path.join(ws, "scripts", "test.sh"), "--for-task", "gap-x", "--allow-thin"] },
    "scoped-gate byte-identical (bash <ws>/scripts/test.sh --for-task <task> --allow-thin)",
  );

  // suite: full-suite-runner argv (unchanged — the third-party test_command degradation must not
  // back-flow into a repo-shaped target).
  assert.deepEqual(
    defaultMechanicalSuiteCommand({ task: "gap-x", worktree: ws, root: repoRoot, suiteLogFile: "/tmp/f.log", runId: "r1" }),
    expectedSuiteArgv("gap-x", ws, repoRoot, "/tmp/f.log", "r1"),
    "suite byte-identical (full-suite-runner argv, ⛔ test_command degradation)",
  );
});

// ── AC6: bidirectional negative control — reverting any domain to its old form goes RED first ───────

test("AC6 (A) — reverting the anchor to target root makes resolution fail on P-real (RED)", () => {
  const ws = pReal();
  const prev = process.env.QUAY_PLUGIN_ROOT;
  try {
    // OLD form: the kernel anchored at <target-root>/plugin/scripts — P-real has no plugin/, so it
    // resolves to nothing. (QUAY_PLUGIN_ROOT is the hermetic seam resolveKernelScriptsDir honors.)
    process.env.QUAY_PLUGIN_ROOT = path.join(ws, "plugin");
    assert.equal(
      resolveKernelSibling("ready-pool-check.ts"),
      null,
      "old form (target-root anchor) resolves to null on P-real — the gate assertion would be RED",
    );
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = prev;
  }
  // Correct form (no target-root override) already proven GREEN in AC4 (A).
});

test("AC6 (B) — the literal DOC_BRANCH 'author' misreads a non-author branch (RED), runtime derivation is GREEN", () => {
  const ws = pReal();
  const literal = DOC_BRANCH;                 // OLD form: the hardcoded literal branch name.
  const derived = resolveDocBranch(ws);       // NEW form: runtime-derived branch name.
  assert.equal(literal, "author", "DOC_BRANCH literal is 'author' (the old hardcoded form)");
  assert.equal(derived, "main", "correct form reads the target's real branch (main) — GREEN");
  assert.notEqual(literal, derived, "old form (literal 'author') ≠ actual branch 'main' — the gate assertion would be RED");
});

test("AC6 (C) — unconditionally calling the dev-tree's own scripts/test.sh on P-real is RED, delegation is GREEN", () => {
  const ws = pReal();

  // OLD form: unconditionally call this repo's dev-tree script (bash <dir>/scripts/test.sh …),
  // regardless of whether the target has one. P-real has no scripts/test.sh ⇒ the argv references a
  // nonexistent script.
  const oldDocCheck = ["bash", path.join(ws, "scripts", "test.sh"), "--static-checks-doc"];
  assert.equal(fs.existsSync(path.join(ws, "scripts", "test.sh")), false, "P-real has no scripts/test.sh (old form targets a nonexistent dev-tree script)");
  assert.notDeepEqual(docCheckCommandFor(ws), oldDocCheck, "correct doc-check form ≠ the old unconditional dev-tree argv");
  assert.equal(docCheckCommandFor(ws), null, "correct doc-check form returns the independent capability-absent value (null) — GREEN");

  const oldScoped = { kind: "run", argv: ["bash", path.join(ws, "scripts", "test.sh"), "--for-task", "gap-x", "--allow-thin"] };
  assert.notDeepEqual(resolveScopedGateCommand("gap-x", ws, ws), oldScoped, "correct scoped form ≠ the old unconditional dev-tree argv");
});

// ── AC7: hygiene — targets are mkdtemp'd OUTSIDE the repo tree and cleaned up by teardown ────────────

test("AC7 — fixture targets are mkdtemp'd in os.tmpdir() (outside the repo tree) and teardown removes them", () => {
  const repoResolved = path.resolve(repoRoot);
  const d = makeTmp();
  assert.ok(d.startsWith(path.resolve(os.tmpdir()) + path.sep), "target dir is under os.tmpdir()");
  assert.ok(!d.startsWith(repoResolved + path.sep), "target dir is NOT inside the repo tree");
  cleanup(d);
  assert.equal(fs.existsSync(d), false, "teardown removes the target dir");
});
