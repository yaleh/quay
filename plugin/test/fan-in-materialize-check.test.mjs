// @test-group serial
// fan-in-materialize-check.test.mjs — gap-workflow-scriptpath-materialize-falls-back-main,
// plugin/scripts/fan-in-materialize-check.ts. The negative-control fixtures prove the checker can go
// RED on the materialization-fallback defect (判据能取假) plus the GREEN / NOT-EVALUATED paths
// (硬规则 3b — "cannot judge" is its own state, never conflated with green).
//
// The checker reads the PRODUCTION CARRIER — the SDK-written materialized workflow records
// ~/.claude/projects/<slug>/<session>/workflows/wf_*.json (which carry BOTH the passed scriptPath AND
// the materialized script content). The fixtures here mimic that carrier shape: a wf_*.json whose
// scriptPath points into a task worktree, whose `script` is the materialized content.
//
// Covered paths:
//   PURE  parseMaterializedRecord — in-scope (worktree scriptPath) / out-of-scope (main scriptPath,
//         non-fan-in workflow, unparseable, empty script)
//   PURE  isUnder / worktreeRootOf — path-segment-safe under-check; worktree-root extraction
//   PURE  judgeRecord — all verdict paths:
//         NOT-APPLICABLE  non-bootstrap task (isBootstrapHit=false) — never RED (AC1)
//         GREEN  worktree file exists + materialized == worktree file
//         RED    worktree file exists + materialized != worktree file, bootstrap-HIT (fallback — the finding)
//         NE     worktree gone + no reconstruction
//         GREEN  worktree gone + materialized == worktree@fanIn
//         GREEN  worktree gone + materialized == worktree@dispatch-HEAD
//         RED    worktree gone + materialized == base + taskTouchedWorkflow (fallback — task's fix
//                committed but absent from the materialized script)
//         GREEN  worktree gone + materialized == base + !taskTouchedWorkflow (task did not modify
//                the workflow file — base is correct)
//         NE     worktree gone + materialized matches neither (intermediate/partial evolution)
//   CLI   fixture project-dir + a LIVE worktree file: RED on mismatch, GREEN on match,
//         NOT-EVALUATED when no in-scope records
//
// Run:
//   scripts/test.sh plugin/test/fan-in-materialize-check.test.mjs
//   node --test plugin/test/fan-in-materialize-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  WORKFLOW_BASENAME,
  parseMaterializedRecord,
  isUnder,
  worktreeRootOf,
  judgeRecord,
  reconstructWorktree,
  projectSlug,
  defaultProjectDir,
  findMaterializedWorkflowFiles,
  taskIsBootstrapHit,
  aggregate,
} from "../scripts/fan-in-materialize-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-materialize-check.ts");

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── PURE: parseMaterializedRecord ───────────────────────────────────────────────────────────────────

function makeWfFile(dir, name, d) {
  const f = path.join(dir, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(d));
  return f;
}

test("PURE parseMaterializedRecord — in-scope worktree scriptPath yields a record with taskId + fanInRunId", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-parse-"));
  t.after(() => cleanup(dir));
  const root = "/home/yale/work/quay";
  const f = makeWfFile(dir, "wf_abc123-01.json", {
    runId: "wf_abc123-01", timestamp: "2026-08-20T00:00:00.000Z",
    scriptPath: "/home/yale/work/quay-worktrees/gap-foo/.claude/workflows/fan-in-execute.js",
    script: "export const meta = { name: 'fan-in-execute' };",
    args: { task: "gap-foo", runId: "fm-gap-foo-123-abc" },
  });
  const rec = parseMaterializedRecord(f, root);
  assert.ok(rec);
  assert.equal(rec.taskId, "gap-foo");
  assert.equal(rec.fanInRunId, "fm-gap-foo-123-abc");
  assert.equal(rec.runId, "wf_abc123-01");
});

test("PURE parseMaterializedRecord — MAIN checkout scriptPath is out of scope (null)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-parse-"));
  t.after(() => cleanup(dir));
  const root = "/home/yale/work/quay";
  const f = makeWfFile(dir, "wf_main-01.json", {
    runId: "wf_main-01",
    scriptPath: "/home/yale/work/quay/.claude/workflows/fan-in-execute.js", // under root ⇒ out of scope
    script: "export const meta = {};",
    args: { task: "gap-foo" },
  });
  assert.equal(parseMaterializedRecord(f, root), null);
});

test("PURE parseMaterializedRecord — non-fan-in workflow / unparseable / empty script are out of scope", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-parse-"));
  t.after(() => cleanup(dir));
  const root = "/home/yale/work/quay";
  // wrong workflow basename
  const f1 = makeWfFile(dir, "wf_other-01.json", {
    runId: "wf_other-01",
    scriptPath: "/home/yale/work/quay-worktrees/gap-foo/.claude/workflows/manager-tick-core.js",
    script: "export const meta = {};",
  });
  assert.equal(parseMaterializedRecord(f1, root), null);
  // unparseable JSON
  const f2 = path.join(dir, "wf_bad-01.json");
  fs.writeFileSync(f2, "{ not json");
  assert.equal(parseMaterializedRecord(f2, root), null);
  // empty script
  const f3 = makeWfFile(dir, "wf_empty-01.json", {
    runId: "wf_empty-01",
    scriptPath: "/home/yale/work/quay-worktrees/gap-foo/.claude/workflows/fan-in-execute.js",
    script: "",
  });
  assert.equal(parseMaterializedRecord(f3, root), null);
});

// ── PURE: isUnder / worktreeRootOf ──────────────────────────────────────────────────────────────────

test("PURE isUnder — path-segment-safe containment", () => {
  assert.equal(isUnder("/a/b", "/a/b/c"), true);
  assert.equal(isUnder("/a/b", "/a/bc"), false); // sibling prefix, not a child
  assert.equal(isUnder("/a/b", "/a/b"), false); // equal is not under
  assert.equal(isUnder("/a/b", "/c/d"), false);
});

test("PURE worktreeRootOf — extracts the worktree root from a worktree scriptPath", () => {
  const sp = "/home/yale/work/quay-worktrees/gap-foo/.claude/workflows/fan-in-execute.js";
  assert.equal(worktreeRootOf(sp), "/home/yale/work/quay-worktrees/gap-foo");
  assert.equal(worktreeRootOf("/no/marker/here.js"), null);
});

// ── PURE: judgeRecord — all verdict paths ───────────────────────────────────────────────────────────

const REC = {
  sourceFile: "/x/wf_1.json",
  runId: "wf_1",
  timestamp: "2026-08-20T00:00:00.000Z",
  scriptPath: "/wt/gap-foo/.claude/workflows/fan-in-execute.js",
  script: "WORKTREE_CONTENT",
  taskId: "gap-foo",
  fanInRunId: "fm-gap-foo-1",
};

test("PURE judgeRecord — worktree exists + match ⇒ GREEN (worktree-version-materialized)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  fs.writeFileSync(wtFile, "WORKTREE_CONTENT");
  const v = judgeRecord(REC, wtFile, null);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.kind, "green-worktree-version-materialized");
});

test("PURE judgeRecord — worktree exists + mismatch ⇒ RED (fallback — the finding's defect)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  fs.writeFileSync(wtFile, "WORKTREE_LATEST_BLOCK"); // the worktree's own version
  // materialized script is the MAIN version (lacks the worktree's latest block)
  const rec = { ...REC, script: "MAIN_VERSION_WITHOUT_THE_BLOCK" };
  // default isBootstrapHit=null ⇒ fail-closed (judged as bootstrap-HIT) ⇒ RED
  const v = judgeRecord(rec, wtFile, null);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.kind, "red-worktree-exists-mismatch");
});

test("PURE judgeRecord — non-bootstrap (isBootstrapHit=false) + worktree mismatch ⇒ NOT-APPLICABLE (no RED, AC1)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  fs.writeFileSync(wtFile, "WORKTREE_LATEST_BLOCK"); // worktree evolved (post-dispatch sync)
  const rec = { ...REC, script: "MAIN_VERSION_WITHOUT_THE_BLOCK" }; // materialized MAIN version
  const v = judgeRecord(rec, wtFile, null, false);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.equal(v.kind, "not-applicable-non-bootstrap");
});

test("PURE judgeRecord — bootstrap-hit (isBootstrapHit=true) + worktree mismatch ⇒ RED (AC2)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  fs.writeFileSync(wtFile, "WORKTREE_LATEST_BLOCK");
  const rec = { ...REC, script: "MAIN_VERSION_WITHOUT_THE_BLOCK" };
  const v = judgeRecord(rec, wtFile, null, true);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.kind, "red-worktree-exists-mismatch");
});

test("PURE judgeRecord — non-bootstrap + worktree gone + would-be-fallback ⇒ NOT-APPLICABLE (no reconstruction needed)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js"); // gone
  const rec = { ...REC, script: "BASE" };
  // even a reconstruction that WOULD be RED (base + taskTouchedWorkflow) is bypassed for non-bootstrap
  const recon = {
    baseSha: "b".repeat(40), fanInSha: "f".repeat(40),
    baseContent: "BASE", fanInContent: "FINAL_WORKTREE",
    dispatchHeadContent: "DISPATCH_HEAD", taskTouchedWorkflow: true,
  };
  const v = judgeRecord(rec, wtFile, recon, false);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.equal(v.kind, "not-applicable-non-bootstrap");
});

test("PURE judgeRecord — worktree gone + no reconstruction ⇒ NOT-EVALUATED (never conflated with green)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js"); // does not exist
  const v = judgeRecord(REC, wtFile, null);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.equal(v.kind, "not-evaluated");
});

test("PURE judgeRecord — worktree gone + materialized == worktree@fanIn ⇒ GREEN", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  const rec = { ...REC, script: "FINAL_WORKTREE" };
  const recon = {
    baseSha: "b".repeat(40), fanInSha: "f".repeat(40),
    baseContent: "BASE", fanInContent: "FINAL_WORKTREE",
    dispatchHeadContent: "DISPATCH_HEAD", taskTouchedWorkflow: true,
  };
  const v = judgeRecord(rec, wtFile, recon);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.kind, "green-worktree-final");
});

test("PURE judgeRecord — worktree gone + materialized == worktree@dispatch-HEAD ⇒ GREEN", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  const rec = { ...REC, script: "DISPATCH_HEAD" };
  const recon = {
    baseSha: "b".repeat(40), fanInSha: "f".repeat(40),
    baseContent: "BASE", fanInContent: "FINAL_WORKTREE",
    dispatchHeadContent: "DISPATCH_HEAD", taskTouchedWorkflow: true,
  };
  const v = judgeRecord(rec, wtFile, recon);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.kind, "green-worktree-dispatch-head");
});

test("PURE judgeRecord — worktree gone + materialized == base + taskTouchedWorkflow ⇒ RED (fallback: task's committed fix absent)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  const rec = { ...REC, script: "BASE" }; // pre-task version
  const recon = {
    baseSha: "b".repeat(40), fanInSha: "f".repeat(40),
    baseContent: "BASE", fanInContent: "FINAL_WORKTREE",
    dispatchHeadContent: "DISPATCH_HEAD", taskTouchedWorkflow: true,
  };
  const v = judgeRecord(rec, wtFile, recon);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.kind, "red-materialized-equals-base-task-touched");
});

test("PURE judgeRecord — worktree gone + materialized == base + !taskTouchedWorkflow ⇒ GREEN (base is correct)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  const rec = { ...REC, script: "BASE" };
  const recon = {
    baseSha: "b".repeat(40), fanInSha: "f".repeat(40),
    baseContent: "BASE", fanInContent: "FINAL_WORKTREE",
    dispatchHeadContent: "DISPATCH_HEAD", taskTouchedWorkflow: false,
  };
  const v = judgeRecord(rec, wtFile, recon);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.kind, "green-base-not-task-touched");
});

test("PURE judgeRecord — worktree gone + matches neither ⇒ NOT-EVALUATED (intermediate/partial evolution)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-judge-"));
  t.after(() => cleanup(dir));
  const wtFile = path.join(dir, "fan-in-execute.js");
  const rec = { ...REC, script: "SOME_INTERMEDIATE_STATE" };
  const recon = {
    baseSha: "b".repeat(40), fanInSha: "f".repeat(40),
    baseContent: "BASE", fanInContent: "FINAL_WORKTREE",
    dispatchHeadContent: "DISPATCH_HEAD", taskTouchedWorkflow: true,
  };
  const v = judgeRecord(rec, wtFile, recon);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.equal(v.kind, "not-evaluated");
});

// ── PURE: aggregate ─────────────────────────────────────────────────────────────────────────────────

test("PURE aggregate — any RED ⇒ not ok; all NOT-EVALUATED ⇒ evaluated=false", () => {
  const mk = (verdict) => ({ record: REC, verdict });
  // all green
  const green = aggregate([mk({ kind: "green-worktree-version-materialized", reason: "r", evaluated: true, ok: true })]);
  assert.equal(green.ok, true);
  assert.equal(green.evaluated, true);
  // one red
  const red = aggregate([
    mk({ kind: "green-worktree-version-materialized", reason: "r", evaluated: true, ok: true }),
    mk({ kind: "red-worktree-exists-mismatch", reason: "r", evaluated: true, ok: false }),
  ]);
  assert.equal(red.ok, false);
  assert.equal(red.evaluated, true);
  // all not-evaluated
  const ne = aggregate([mk({ kind: "not-evaluated", reason: "r", evaluated: false, ok: true })]);
  assert.equal(ne.ok, true);
  assert.equal(ne.evaluated, false);
  // empty
  const empty = aggregate([]);
  assert.equal(empty.ok, true);
  assert.equal(empty.evaluated, false);
});

// ── CLI integration (hermetic fixture) ──────────────────────────────────────────────────────────────

/** Build a fixture: a project-dir (for wf_*.json) + a worktree root (with a live fan-in-execute.js).
 *  The CLI is spawned with --project-dir <fixture> so it NEVER touches the real ~/.claude/projects. */
function makeCliFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-cli-"));
  const projectDir = path.join(base, "projects");
  const worktreeRoot = path.join(base, "quay-worktrees", "gap-foo");
  const worktreeWf = path.join(worktreeRoot, ".claude", "workflows", "fan-in-execute.js");
  fs.mkdirSync(path.dirname(worktreeWf), { recursive: true });
  // The worktree's fan-in-execute.js — the "latest block" the bootstrap-HIT task added.
  fs.writeFileSync(worktreeWf, "export const meta = { name: 'fan-in-execute' };\n// BOOTSTRAP-MARKER: gap-foo\n");
  return { base, projectDir, worktreeRoot, worktreeWf };
}

function writeWf(projectDir, name, over) {
  const sess = path.join(projectDir, "session-1", "workflows");
  fs.mkdirSync(sess, { recursive: true });
  const f = path.join(sess, name);
  fs.writeFileSync(f, JSON.stringify({
    runId: name.replace(".json", ""),
    timestamp: "2026-08-20T00:00:00.000Z",
    scriptPath: over.scriptPath,
    script: over.script,
    args: { task: "gap-foo", runId: "fm-gap-foo-1" },
  }));
  return f;
}

test("CLI — RED when a worktree-scriptPath dispatch materialized a NON-worktree version (worktree alive)", (t) => {
  const fx = makeCliFixture();
  t.after(() => cleanup(fx.base));
  // The worktree file on disk has the latest block; the materialized script is the MAIN version
  // (lacks the block) — the fallback the checker exists to catch.
  writeWf(fx.projectDir, "wf_bad-01.json", {
    scriptPath: path.join(fx.worktreeRoot, ".claude", "workflows", "fan-in-execute.js"),
    script: "export const meta = { name: 'fan-in-execute' };\n// (main version — no bootstrap marker)\n",
  });
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--project-dir", fx.projectDir, "--workflow-events-dir", path.join(fx.base, "no-events"), "--json"], { encoding: "utf8" });
  assert.equal(res.status, 1, `expected exit 1 (RED), got ${res.status}: ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.evaluated, true);
  assert.match(out.reason, /fan-in-materialize-fallback/);
  const bad = out.checks.find((c) => c.runId === "wf_bad-01");
  assert.equal(bad.verdict, "red-worktree-exists-mismatch");
});

test("CLI — GREEN when a worktree-scriptPath dispatch materialized the WORKTREE version (worktree alive)", (t) => {
  const fx = makeCliFixture();
  t.after(() => cleanup(fx.base));
  const wtContent = fs.readFileSync(fx.worktreeWf, "utf8");
  writeWf(fx.projectDir, "wf_ok-01.json", {
    scriptPath: path.join(fx.worktreeRoot, ".claude", "workflows", "fan-in-execute.js"),
    script: wtContent, // byte-identical to the worktree file
  });
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--project-dir", fx.projectDir, "--workflow-events-dir", path.join(fx.base, "no-events"), "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0, `expected exit 0 (GREEN), got ${res.status}: ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
  const ok = out.checks.find((c) => c.runId === "wf_ok-01");
  assert.equal(ok.verdict, "green-worktree-version-materialized");
});

test("CLI — non-bootstrap task: worktree-vs-materialized mismatch is NOT-APPLICABLE (no RED, AC1)", (t) => {
  const fx = makeCliFixture();
  t.after(() => cleanup(fx.base));
  // A non-bootstrap task file: Touches lists ONLY itself (no fan-in orchestration file).
  const tasksDir = path.join(fx.base, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "gap-foo.md"),
    "---\nid: gap-foo\n---\n## Touches\n- tasks/gap-foo.md\n");
  // Materialized script is the MAIN version (lacks the marker) while the worktree file on disk has the
  // marker (worktree evolved / post-dispatch sync) — a mismatch that MUST NOT redden a non-bootstrap task.
  writeWf(fx.projectDir, "wf_nonbootstrap-01.json", {
    scriptPath: path.join(fx.worktreeRoot, ".claude", "workflows", "fan-in-execute.js"),
    script: "export const meta = { name: 'fan-in-execute' };\n// (main version — no bootstrap marker)\n",
  });
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--project-dir", fx.projectDir, "--tasks-dir", tasksDir, "--workflow-events-dir", path.join(fx.base, "no-events"), "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0, `expected exit 0 (no RED for non-bootstrap), got ${res.status}: ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  const nb = out.checks.find((c) => c.runId === "wf_nonbootstrap-01");
  assert.equal(nb.verdict, "not-applicable-non-bootstrap");
  assert.equal(nb.ok, true);
  assert.equal(nb.evaluated, false);
});

test("CLI — bootstrap-hit task: worktree-vs-materialized mismatch is still RED (AC2)", (t) => {
  const fx = makeCliFixture();
  t.after(() => cleanup(fx.base));
  // A bootstrap-HIT task file: Touches lists a fan-in orchestration file.
  const tasksDir = path.join(fx.base, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "gap-foo.md"),
    "---\nid: gap-foo\n---\n## Touches\n- .claude/workflows/fan-in-execute.js\n");
  writeWf(fx.projectDir, "wf_bootstrap-01.json", {
    scriptPath: path.join(fx.worktreeRoot, ".claude", "workflows", "fan-in-execute.js"),
    script: "export const meta = { name: 'fan-in-execute' };\n// (main version — no bootstrap marker)\n",
  });
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--project-dir", fx.projectDir, "--tasks-dir", tasksDir, "--workflow-events-dir", path.join(fx.base, "no-events"), "--json"], { encoding: "utf8" });
  assert.equal(res.status, 1, `expected exit 1 (RED for bootstrap-hit), got ${res.status}: ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, false);
  const bs = out.checks.find((c) => c.runId === "wf_bootstrap-01");
  assert.equal(bs.verdict, "red-worktree-exists-mismatch");
});

test("CLI — NOT-EVALUATED when no in-scope worktree-scriptPath records exist", (t) => {
  const fx = makeCliFixture();
  t.after(() => cleanup(fx.base));
  // Only a MAIN-checkout scriptPath record — out of scope.
  writeWf(fx.projectDir, "wf_main-01.json", {
    scriptPath: path.join(REPO_ROOT, ".claude", "workflows", "fan-in-execute.js"),
    script: "export const meta = { name: 'fan-in-execute' };",
  });
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", REPO_ROOT, "--project-dir", fx.projectDir, "--workflow-events-dir", path.join(fx.base, "no-events"), "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0, `expected exit 0 (NOT-EVALUATED), got ${res.status}: ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, false);
  assert.match(out.reason, /NOT-EVALUATED/);
});

test("CLI — usage: --help exits 0 and prints usage", () => {
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, "--help"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /fan-in-materialize-check/);
});

// ── fs helpers ──────────────────────────────────────────────────────────────────────────────────────

test("fs projectSlug/defaultProjectDir — the main checkout slug", () => {
  assert.equal(projectSlug("/home/yale/work/quay"), "-home-yale-work-quay");
  const pd = defaultProjectDir("/home/yale/work/quay");
  assert.ok(pd.endsWith(path.join(".claude", "projects", "-home-yale-work-quay")));
});

test("fs findMaterializedWorkflowFiles — finds wf_*.json under session workflows dirs recursively", (t) => {
  const fx = makeCliFixture();
  t.after(() => cleanup(fx.base));
  const f1 = writeWf(fx.projectDir, "wf_a-01.json", {
    scriptPath: path.join(fx.worktreeRoot, ".claude", "workflows", "fan-in-execute.js"),
    script: "x",
  });
  const files = findMaterializedWorkflowFiles(fx.projectDir);
  assert.ok(files.includes(f1));
});

test("fs taskIsBootstrapHit — Touches listing a fan-in orchestration file ⇒ true; other files ⇒ false; absent ⇒ null", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "fan-mat-task-"));
  t.after(() => cleanup(base));
  fs.writeFileSync(path.join(base, "gap-hit.md"),
    "---\nid: gap-hit\n---\n## Touches\n- .claude/workflows/fan-in-execute.js\n");
  fs.writeFileSync(path.join(base, "gap-miss.md"),
    "---\nid: gap-miss\n---\n## Touches\n- tasks/gap-miss.md\n");
  assert.equal(taskIsBootstrapHit(base, "gap-hit"), true);
  assert.equal(taskIsBootstrapHit(base, "gap-miss"), false);
  assert.equal(taskIsBootstrapHit(base, "gap-gone"), null); // no task file
});
