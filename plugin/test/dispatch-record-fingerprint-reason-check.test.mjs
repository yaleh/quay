// @test-group engine
// dispatch-record-fingerprint-reason-check.test.mjs — AC55 判据1/判据3 检查器测试
// (tasks/gap-ac55-dispatch-record-fingerprint-reason).
//
// AC55 判据1: EVERY dispatch record must carry ① the dispatch-preference file's CONTENT FINGERPRINT
// (git blob hash — answering "用的是哪一版") AND ② a one-sentence "为什么选它" (answering "按倾向选还是
// 随便选"). AC55 判据3 (falsifiable, negative control PRODUCED BY THE IMPLEMENTER, AC49 判据1 D2
// attribution): take a REAL dispatch record and replay it — missing fingerprint OR missing reason
// MUST go RED.
//
// This file pins:
//   (a) the pure logic (plugin/scripts/dispatch-record.ts + dispatch-record-fingerprint-reason-check.ts);
//   (b) the WRITER produces a REAL record (real `git hash-object` fingerprint of the preference
//       file) and the CHECKER is GREEN on it;
//   (c) the NEGATIVE CONTROL (判据3) — take that real record, delete the fingerprint ⇒ RED; delete
//       the reason ⇒ RED; thin the reason ⇒ RED;
//   (d) the writer FAILS CLOSED on a missing/thin reason (a reason-less dispatch is never recorded).
//
// Run:
//   scripts/test.sh plugin/test/dispatch-record-fingerprint-reason-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  RECORD_FILE_REL,
  MIN_REASON_CHARS,
  computePreferenceFingerprint,
  makeRecord,
  reasonIsSubstantive,
  appendRecord,
} from "../scripts/dispatch-record.ts";
import { validateRecord, checkRecordText, resolveRecordPath } from "../scripts/dispatch-record-fingerprint-reason-check.ts";
import { PREFERENCE_FILE_REL } from "../scripts/dispatch-preference-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const WRITER_CLI = path.join(repoRoot, "plugin", "scripts", "dispatch-record.ts");
const CHECKER_CLI = path.join(repoRoot, "plugin", "scripts", "dispatch-record-fingerprint-reason-check.ts");
const REAL_PREFERENCE = path.join(repoRoot, PREFERENCE_FILE_REL);

/** Build a temp workspace carrying a real dispatch-preference.md (same content as the real file —
 *  so the writer's fingerprint equals the real file's blob hash) plus an empty orchestration/ dir.
 *  tmp-leak-pairing-check: every mkdtempSync is paired with an after() rmSync. */
function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dr-${tag}-`));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  fs.copyFileSync(REAL_PREFERENCE, path.join(dir, PREFERENCE_FILE_REL));
  return dir;
}

function runWriter(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", WRITER_CLI, ...args], { encoding: "utf8" });
}

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER_CLI, ...args], { encoding: "utf8" });
}

/** Read the one record line from a workspace's record file (JSON parsed). */
function readOneRecord(dir) {
  const file = path.join(dir, RECORD_FILE_REL);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `expected exactly 1 record line, got ${lines.length}`);
  return { file, record: JSON.parse(lines[0]) };
}

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("MIN_REASON_CHARS / reasonIsSubstantive — a real one-sentence reason is substantive; placeholders are not", () => {
  assert.ok(reasonIsSubstantive("覆盖段本阶段 AC55 优先——与阶段目标直接相关"));
  assert.ok(reasonIsSubstantive("红窗优先——修复 streaming-red 连续红窗"));
  assert.ok(!reasonIsSubstantive(""), "empty reason is not substantive");
  assert.ok(!reasonIsSubstantive("   "), "whitespace-only reason is not substantive");
  assert.ok(!reasonIsSubstantive("随便"), "a bare '随便' placeholder is not a one-sentence reason");
  assert.ok(!reasonIsSubstantive(undefined), "undefined reason is not substantive");
  assert.ok(reasonIsSubstantive("X".repeat(MIN_REASON_CHARS)), "exactly MIN_REASON_CHARS is substantive");
});

test("computePreferenceFingerprint — real preference file yields a 40-hex git blob hash", () => {
  const fp = computePreferenceFingerprint(repoRoot);
  assert.ok(fp && /^[0-9a-f]{40}$/i.test(fp), `fingerprint must be a 40-hex git blob hash, got ${fp}`);
});

test("makeRecord / validateRecord — a well-formed record is GREEN", () => {
  const r = makeRecord({ taskId: "gap-xxx", reason: "覆盖段 AC55 优先", fingerprint: "a".repeat(40) });
  const v = validateRecord(r);
  assert.equal(v.ok, true);
  assert.equal(v.why, "ok");
});

test("validateRecord — missing fingerprint ⇒ RED (fingerprint-missing)", () => {
  const r = makeRecord({ taskId: "gap-xxx", reason: "覆盖段 AC55 优先", fingerprint: "a".repeat(40) });
  delete r.preferenceFingerprint;
  const v = validateRecord(r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "fingerprint-missing");
});

test("validateRecord — null fingerprint (writer could not compute) ⇒ RED (fingerprint-missing)", () => {
  const r = makeRecord({ taskId: "gap-xxx", reason: "覆盖段 AC55 优先", fingerprint: null });
  const v = validateRecord(r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "fingerprint-missing");
});

test("validateRecord — non-40-hex fingerprint ⇒ RED (fingerprint-invalid)", () => {
  const r = makeRecord({ taskId: "gap-xxx", reason: "覆盖段 AC55 优先", fingerprint: "not-a-real-hash" });
  const v = validateRecord(r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "fingerprint-invalid");
});

test("validateRecord — missing reason ⇒ RED (reason-too-thin, the empty-vs-absent guard)", () => {
  const r = makeRecord({ taskId: "gap-xxx", reason: "覆盖段 AC55 优先", fingerprint: "a".repeat(40) });
  delete r.reason;
  const v = validateRecord(r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "reason-too-thin");
});

test("validateRecord — thin reason (below MIN_REASON_CHARS) ⇒ RED (reason-too-thin)", () => {
  const r = makeRecord({ taskId: "gap-xxx", reason: "x", fingerprint: "a".repeat(40) });
  const v = validateRecord(r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "reason-too-thin");
});

test("validateRecord — missing taskId ⇒ RED (taskId-missing)", () => {
  const r = makeRecord({ taskId: "gap-xxx", reason: "覆盖段 AC55 优先", fingerprint: "a".repeat(40) });
  delete r.taskId;
  const v = validateRecord(r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "taskId-missing");
});

test("checkRecordText — a single valid record ⇒ ok; an unparseable line ⇒ RED", () => {
  const okText = JSON.stringify(makeRecord({ taskId: "gap-xxx", reason: "覆盖段 AC55 优先", fingerprint: "a".repeat(40) }));
  assert.equal(checkRecordText(okText, "sample").ok, true);
  const bad = checkRecordText("this is not json\n", "sample");
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.includes("unparseable")));
});

test("resolveRecordPath — --file wins; default is <root>/orchestration/dispatch-record.jsonl", () => {
  assert.equal(resolveRecordPath("/r", undefined), path.join("/r", RECORD_FILE_REL));
  assert.equal(resolveRecordPath("/r", "samples/x.jsonl"), path.resolve("/r", "samples/x.jsonl"));
});

// ── writer + real-record GREEN (AC55 判据1) ────────────────────────────────────────────────────────

test("AC55 判据1 — the WRITER produces a REAL record (real git blob hash) and the CHECKER is GREEN on it", () => {
  const dir = makeWorkspace("real-green");
  const w = runWriter(["--add", "--task-id", "gap-ac55-dispatch-record-fingerprint-reason", "--reason", "覆盖段本阶段 AC55 优先——与阶段目标直接相关", "--root", dir]);
  assert.equal(w.status, 0, `writer must exit 0 on a substantive reason:\n${w.stdout}\n${w.stderr}`);
  const { file, record } = readOneRecord(dir);
  // the fingerprint must be the REAL 40-hex git blob hash of the preference file — the SAME hash
  // as the checked-in preference file (same content copied into the workspace).
  assert.ok(/^[0-9a-f]{40}$/i.test(record.preferenceFingerprint), `real fingerprint, got ${record.preferenceFingerprint}`);
  const c = runChecker(["--file", file]);
  assert.equal(c.status, 0, `checker must be GREEN on a real well-formed record:\n${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /PASS/);
});

test("AC55 判据3 — real record with the FINGERPRINT deleted ⇒ RED", () => {
  const dir = makeWorkspace("neg-fp");
  const w = runWriter(["--add", "--task-id", "gap-ac55-dispatch-record-fingerprint-reason", "--reason", "覆盖段本阶段 AC55 优先——与阶段目标直接相关", "--root", dir]);
  assert.equal(w.status, 0, `writer must exit 0:\n${w.stdout}\n${w.stderr}`);
  const { file, record } = readOneRecord(dir);
  delete record.preferenceFingerprint; // replay the SAME real record missing its fingerprint
  fs.writeFileSync(file, JSON.stringify(record) + "\n", "utf8");
  const c = runChecker(["--file", file]);
  assert.equal(c.status, 1, `checker must RED on a real record missing its fingerprint:\n${c.stdout}\n${c.stderr}`);
  assert.match(c.stderr, /fingerprint-missing/, "RED output must name the missing fingerprint");
});

test("AC55 判据3 — real record with the REASON deleted ⇒ RED", () => {
  const dir = makeWorkspace("neg-reason");
  const w = runWriter(["--add", "--task-id", "gap-ac55-dispatch-record-fingerprint-reason", "--reason", "覆盖段本阶段 AC55 优先——与阶段目标直接相关", "--root", dir]);
  assert.equal(w.status, 0, `writer must exit 0:\n${w.stdout}\n${w.stderr}`);
  const { file, record } = readOneRecord(dir);
  delete record.reason; // replay the SAME real record missing its reason
  fs.writeFileSync(file, JSON.stringify(record) + "\n", "utf8");
  const c = runChecker(["--file", file]);
  assert.equal(c.status, 1, `checker must RED on a real record missing its reason:\n${c.stdout}\n${c.stderr}`);
  assert.match(c.stderr, /reason-too-thin/, "RED output must name the missing/thin reason");
});

test("AC55 判据3 — real record with a THIN reason ⇒ RED (empty-vs-absent guard)", () => {
  const dir = makeWorkspace("neg-thin");
  const w = runWriter(["--add", "--task-id", "gap-ac55-dispatch-record-fingerprint-reason", "--reason", "覆盖段本阶段 AC55 优先——与阶段目标直接相关", "--root", dir]);
  assert.equal(w.status, 0, `writer must exit 0:\n${w.stdout}\n${w.stderr}`);
  const { file, record } = readOneRecord(dir);
  record.reason = "随便"; // a placeholder must not read as a one-sentence reason
  fs.writeFileSync(file, JSON.stringify(record) + "\n", "utf8");
  const c = runChecker(["--file", file]);
  assert.equal(c.status, 1, `checker must RED on a real record whose reason is a bare placeholder:\n${c.stdout}\n${c.stderr}`);
  assert.match(c.stderr, /reason-too-thin/, "RED output must name the thin reason");
});

// ── writer fail-closed (AC53 structural-gate shape) ────────────────────────────────────────────────

test("writer FAILS CLOSED — a dispatch recorded without a substantive reason is never written (exit 1)", () => {
  const dir = makeWorkspace("failclosed");
  const missing = runWriter(["--add", "--task-id", "gap-xxx", "--root", dir]);
  assert.equal(missing.status, 1, `writer must exit 1 on a missing reason:\n${missing.stdout}\n${missing.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, RECORD_FILE_REL)), false, "a fail-closed writer must NOT append a record");
  const thin = runWriter(["--add", "--task-id", "gap-xxx", "--reason", "随便", "--root", dir]);
  assert.equal(thin.status, 1, `writer must exit 1 on a placeholder reason:\n${thin.stdout}\n${thin.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, RECORD_FILE_REL)), false, "a fail-closed writer must NOT append a record");
});

test("writer appends to the exact runtime log path and can be read back", () => {
  const dir = makeWorkspace("append");
  const r = makeRecord({ taskId: "gap-append", reason: "红窗优先——修复红窗", fingerprint: computePreferenceFingerprint(dir) });
  const file = appendRecord(dir, r);
  assert.equal(file, path.join(dir, RECORD_FILE_REL));
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).taskId, "gap-append");
});

// ── PROMOTION REGRESSION (tasks/gap-correctness-checkers-opt-in-not-default-suite-member) ───────────
//
// This checker used to live in run_operational_checks() — the OPT-IN tier whose only invocation was a
// human typing `scripts/test.sh --static-checks-operational`. Measured 2026-09-13: ZERO automatic
// callers anywhere in the repo. And this checker is the ONLY post-hoc detector for the one shape the
// writer deliberately does NOT block — dispatch-record.ts:157 fails closed on a missing/thin REASON
// but only WARNS on an uncomputable FINGERPRINT (:164-168), so an empty-fingerprint record CAN land
// on disk. "The checker exists" and "the checker runs" had drifted apart.
//
// It is now registered in run_static_checks() — the default full-suite gate (⇒ every fan-in), reading
// the MAIN checkout's carrier via --root main_root so the worktree/fan-in path is not vacuous.
//
// These tests pin the registration AND that the REGISTERED argv — read out of the live gate file,
// never restated here — still goes RED on a record whose fingerprint was stripped. A check that is
// wired but never evaluates is the same defect class one layer up (硬规则 3b).

const GATE_FILE = path.join(repoRoot, "plugin", "scripts", "runner-static-gate.ts");

/** The flag list of the gate's registered `run_checker "<name>"` line inside `fnName`'s body.
 *  SINGLE SOURCE: the test never restates the flags — it reads what the gate actually runs, so a
 *  future edit to the wiring (e.g. dropping --root main_root) is what this test judges. */
function registeredCheckerFlags(name, fnName) {
  const text = fs.readFileSync(GATE_FILE, "utf8");
  const start = text.indexOf(`${fnName}() {`);
  assert.ok(start >= 0, `${fnName}() must exist in runner-static-gate.ts`);
  const body = text.slice(start, text.indexOf("\n}\n", start));
  const line = body.split("\n").find((l) => l.includes(`run_checker "${name}"`));
  assert.ok(line, `${name} must be registered in ${fnName}()`);
  const flags = line.replace(/^.*?\.ts"\s*/, "");
  assert.notEqual(flags, line.trim(), "the registered line must name a .ts script");
  return flags.trim();
}

/** Run the checker with the gate's own registered flags, but with the root redirected to `dir`
 *  (the gate's root variables are shell paths; a test cannot satisfy them, so only the ROOT is
 *  substituted — every other flag is verbatim from the gate). */
function runRegisteredFlags(name, fnName, dir) {
  const flags = registeredCheckerFlags(name, fnName)
    .replaceAll('"${main_root}"', JSON.stringify(dir))
    .replaceAll('"${repo_root}"', JSON.stringify(dir))
    .replaceAll("${main_root}", dir)
    .replaceAll("${repo_root}", dir);
  const argv = flags.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, ""));
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER_CLI, ...argv], { encoding: "utf8" });
}

test("PROMOTED: the checker is registered in run_static_checks() (default gate) and NOT in the opt-in operational tier", () => {
  const text = fs.readFileSync(GATE_FILE, "utf8");
  const bodyOf = (fn) => {
    const start = text.indexOf(`${fn}() {`);
    assert.ok(start >= 0, `${fn}() must exist`);
    return text.slice(start, text.indexOf("\n}\n", start));
  };
  assert.ok(
    bodyOf("run_static_checks").includes('run_checker "dispatch-record-fingerprint-reason-check"'),
    "the fingerprint checker must be registered in run_static_checks (the default full-suite gate)",
  );
  assert.ok(
    !bodyOf("run_operational_checks").includes('run_checker "dispatch-record-fingerprint-reason-check"'),
    "it must NOT also sit in run_operational_checks — the opt-in tier has no automatic caller",
  );
  assert.match(
    registeredCheckerFlags("dispatch-record-fingerprint-reason-check", "run_static_checks"),
    /--root\s+"?\$\{main_root\}/,
    "the registered --root must be main_root: orchestration/dispatch-record.jsonl is MAIN-checkout " +
      "gitignored runtime state, absent from the one-shot verify worktree — with repo_root the check " +
      "would be vacuous in exactly the fan-in path that matters",
  );
});

test("NEGATIVE CONTROL on the REGISTERED argv: a real record whose fingerprint was stripped still goes RED", () => {
  const dir = makeWorkspace("promoted-red");
  const added = runWriter([
    "--add", "--task-id", "gap-promoted-needle", "--reason",
    "覆盖段本阶段 AC55 优先——与阶段目标直接相关", "--root", dir,
  ]);
  assert.equal(added.status, 0, `writer must produce a real record:\n${added.stdout}${added.stderr}`);
  const file = path.join(dir, RECORD_FILE_REL);
  assert.equal(runRegisteredFlags("dispatch-record-fingerprint-reason-check", "run_static_checks", dir).status, 0,
    "GREEN baseline: the registered argv must pass on a well-formed real record");

  // INJECT the exact shape the writer lets through (it only WARNS on an uncomputable fingerprint).
  const before = fs.readFileSync(file, "utf8");
  const stripped = before.replace(/,"preferenceFingerprint":"[0-9a-f]{40}"/, "");
  assert.notEqual(stripped, before, "the fixture must actually lose its fingerprint field");
  fs.writeFileSync(file, stripped, "utf8");

  const red = runRegisteredFlags("dispatch-record-fingerprint-reason-check", "run_static_checks", dir);
  assert.equal(red.status, 1,
    `the REGISTERED argv must RED on an empty-fingerprint record (a wired-but-never-evaluating check ` +
      `is the defect this promotion cures):\n${red.stdout}${red.stderr}`);
  assert.match(red.stdout + red.stderr, /fingerprint/i, "the RED output must name the missing fingerprint");
});
