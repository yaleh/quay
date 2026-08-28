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
