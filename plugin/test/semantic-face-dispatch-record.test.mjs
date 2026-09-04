// @test-group engine
// semantic-face-dispatch-record.test.mjs — AC145 判据2（AC2）语义面派发记录测试
// (tasks/gap-ac145-semantic-face-subagent-manager-driven).
//
// AC2（能取假，可查派发记录）：每类语义职责有可查的派发记录（同 A16b dispatch-record 形态）；
// 取假 = 发生一次语义产出而无对应派发记录 ⇒ 假。
//
// 本文件钉住：
//   (a) 八类职责 closed enum（isSemanticDutyKind —— 合法类通过，非法类拒绝）；
//   (b) 写入方 fail-closed（职责类别非法 / 理由缺失 / 理由过薄 ⇒ exit 1 且不写）；
//   (c) 写入方产出一条真实记录（合法类别 + 实质理由 ⇒ exit 0，字段正确落盘）；
//   (d) 查询面（AC2「可查」）：--list 读回记录、--kind 按类别过滤、--since 按时刻过滤——
//       「某类职责 0 条记录」能机械核出（与「有产出而无记录」的取假判据对接）。
//
// Run:
//   scripts/test.sh plugin/test/semantic-face-dispatch-record.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  SEMANTIC_FACE_RECORD_FILE_REL,
  SEMANTIC_DUTY_KINDS,
  SEMANTIC_DUTY_LABELS,
  MIN_REASON_CHARS,
  isSemanticDutyKind,
  reasonIsSubstantive,
  makeSemanticFaceRecord,
  appendSemanticFaceRecord,
  listSemanticFaceRecords,
  resolveSemanticFaceRecordPath,
} from "../scripts/semantic-face-dispatch-record.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const WRITER_CLI = path.join(repoRoot, "plugin", "scripts", "semantic-face-dispatch-record.ts");

/** Build a temp workspace (empty — the writer creates orchestration/ on demand).
 *  tmp-leak-pairing-check: every mkdtempSync is paired with an after() rmSync. */
function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sfdr-${tag}-`));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runWriter(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", WRITER_CLI, ...args], { encoding: "utf8" });
}

/** Read all record lines from a workspace's record file (JSON parsed). */
function readRecords(dir) {
  const file = path.join(dir, SEMANTIC_FACE_RECORD_FILE_REL);
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("AC2 (a) — SEMANTIC_DUTY_KINDS is the closed 8-duty enum, each with a label", () => {
  assert.equal(SEMANTIC_DUTY_KINDS.length, 8, "exactly 8 semantic duties");
  for (const k of SEMANTIC_DUTY_KINDS) {
    assert.ok(SEMANTIC_DUTY_LABELS[k], `every kind has a label: ${k}`);
  }
  assert.equal(SEMANTIC_DUTY_LABELS["cross-layer-correction"], "跨层纠错", "跨层纠错 is single-listed (DoD)");
});

test("AC2 (a) — isSemanticDutyKind accepts the 8 kinds and rejects anything else", () => {
  for (const k of SEMANTIC_DUTY_KINDS) assert.ok(isSemanticDutyKind(k), `${k} is a valid kind`);
  assert.ok(!isSemanticDutyKind("task-dispatch"), "a task-dispatch slug is not a semantic duty");
  assert.ok(!isSemanticDutyKind(""), "empty is not a kind");
  assert.ok(!isSemanticDutyKind(undefined), "undefined is not a kind");
  assert.ok(!isSemanticDutyKind(123), "a number is not a kind");
});

test("MIN_REASON_CHARS / reasonIsSubstantive — a real one-sentence reason is substantive; placeholders are not", () => {
  assert.ok(reasonIsSubstantive("读 outer transcript 证否其自诊断——真因是结构性阻塞"));
  assert.ok(reasonIsSubstantive("证据推翻原判断，改学习方法为按产物核"));
  assert.ok(!reasonIsSubstantive(""), "empty reason is not substantive");
  assert.ok(!reasonIsSubstantive("   "), "whitespace-only reason is not substantive");
  assert.ok(!reasonIsSubstantive("随便"), "a bare '随便' placeholder is not a one-sentence reason");
  assert.ok(!reasonIsSubstantive(undefined), "undefined reason is not substantive");
  assert.ok(reasonIsSubstantive("X".repeat(MIN_REASON_CHARS)), "exactly MIN_REASON_CHARS is substantive");
});

test("makeSemanticFaceRecord — fields round-trip, taskId defaults to null", () => {
  const r = makeSemanticFaceRecord({ dutyKind: "cross-layer-correction", reason: "证否 outer 自诊断" });
  assert.equal(r.dutyKind, "cross-layer-correction");
  assert.equal(r.taskId, null);
  assert.equal(r.reason, "证否 outer 自诊断");
  assert.ok(typeof r.ts === "string" && r.ts.length > 0);
  const withTask = makeSemanticFaceRecord({ dutyKind: "task-authoring", reason: "立案 gap-xxx", taskId: "gap-xxx" });
  assert.equal(withTask.taskId, "gap-xxx");
});

test("appendSemanticFaceRecord / listSemanticFaceRecords — round-trip + kind/since filters (AC2 可查)", () => {
  const dir = makeWorkspace("roundtrip");
  const a = makeSemanticFaceRecord({ dutyKind: "escalation-judgment", reason: "升级——red 窗持续", ts: "2026-08-28T01:00:00.000Z" });
  const b = makeSemanticFaceRecord({ dutyKind: "cross-layer-correction", reason: "证否 manager 过早归因", ts: "2026-08-28T02:00:00.000Z" });
  appendSemanticFaceRecord(dir, a);
  appendSemanticFaceRecord(dir, b);

  const all = listSemanticFaceRecords(dir);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.dutyKind), ["escalation-judgment", "cross-layer-correction"]);

  const onlyEsc = listSemanticFaceRecords(dir, { kind: "escalation-judgment" });
  assert.equal(onlyEsc.length, 1);
  assert.equal(onlyEsc[0].dutyKind, "escalation-judgment");

  const onlyCross = listSemanticFaceRecords(dir, { kind: "cross-layer-correction" });
  assert.equal(onlyCross.length, 1);
  assert.equal(onlyCross[0].reason, "证否 manager 过早归因");

  const none = listSemanticFaceRecords(dir, { kind: "learning" });
  assert.equal(none.length, 0, "a kind with no records returns [] — the「无记录 ⇒ 假」falsifier reads this");

  const since02 = listSemanticFaceRecords(dir, { since: "2026-08-28T02:00:00.000Z" });
  assert.equal(since02.length, 1, "--since filters by ts");
  assert.equal(since02[0].dutyKind, "cross-layer-correction");
});

test("resolveSemanticFaceRecordPath — is <root>/orchestration/semantic-face-dispatch-record.jsonl", () => {
  assert.equal(resolveSemanticFaceRecordPath("/r"), path.join("/r", SEMANTIC_FACE_RECORD_FILE_REL));
});

// ── writer + real record (AC2) ─────────────────────────────────────────────────────────────────────

test("AC2 — the WRITER produces a real record and --list --json reads it back", () => {
  const dir = makeWorkspace("real");
  const w = runWriter(["--add", "--kind", "cross-layer-correction", "--reason", "读 outer transcript 证否其自诊断", "--root", dir]);
  assert.equal(w.status, 0, `writer must exit 0 on a valid kind + substantive reason:\n${w.stdout}\n${w.stderr}`);
  assert.match(w.stdout, /PASS/);

  const records = readRecords(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].dutyKind, "cross-layer-correction");
  assert.equal(records[0].taskId, null);
  assert.equal(records[0].reason, "读 outer transcript 证否其自诊断");

  const l = runWriter(["--list", "--json", "--root", dir]);
  assert.equal(l.status, 0, `--list --json must exit 0:\n${l.stdout}\n${l.stderr}`);
  const parsed = JSON.parse(l.stdout);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].dutyKind, "cross-layer-correction");

  const filtered = runWriter(["--list", "--kind", "cross-layer-correction", "--json", "--root", dir]);
  const fparsed = JSON.parse(filtered.stdout);
  assert.equal(fparsed.length, 1);
  const empty = runWriter(["--list", "--kind", "learning", "--json", "--root", dir]);
  assert.equal(JSON.parse(empty.stdout).length, 0, "a kind with no records lists [] (queryable zero, not collapsed)");
});

test("AC2 — task-authoring carries an optional --task-id context", () => {
  const dir = makeWorkspace("taskid");
  const w = runWriter(["--add", "--kind", "task-authoring", "--task-id", "gap-xxx", "--reason", "立案——任务撰写经后台 subagent", "--root", dir]);
  assert.equal(w.status, 0, `writer must exit 0:\n${w.stdout}\n${w.stderr}`);
  const records = readRecords(dir);
  assert.equal(records[0].taskId, "gap-xxx");
});

// ── writer fail-closed (AC53 structural-gate shape) ───────────────────────────────────────────────

test("writer FAILS CLOSED — an invalid kind is never written (exit 1)", () => {
  const dir = makeWorkspace("badkind");
  const bad = runWriter(["--add", "--kind", "task-dispatch", "--reason", "这是一句够长的理由", "--root", dir]);
  assert.equal(bad.status, 1, `writer must exit 1 on an invalid kind:\n${bad.stdout}\n${bad.stderr}`);
  assert.match(bad.stderr, /fail-closed/);
  assert.equal(fs.existsSync(path.join(dir, SEMANTIC_FACE_RECORD_FILE_REL)), false, "a fail-closed writer must NOT append a record");
});

test("writer FAILS CLOSED — a missing reason is never written (exit 1)", () => {
  const dir = makeWorkspace("noreason");
  const missing = runWriter(["--add", "--kind", "learning", "--root", dir]);
  assert.equal(missing.status, 1, `writer must exit 1 on a missing reason:\n${missing.stdout}\n${missing.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, SEMANTIC_FACE_RECORD_FILE_REL)), false, "a fail-closed writer must NOT append a record");
});

test("writer FAILS CLOSED — a thin/placeholder reason is never written (exit 1, empty-vs-absent guard)", () => {
  const dir = makeWorkspace("thinreason");
  const thin = runWriter(["--add", "--kind", "b18-stop-loss", "--reason", "随便", "--root", dir]);
  assert.equal(thin.status, 1, `writer must exit 1 on a placeholder reason:\n${thin.stdout}\n${thin.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, SEMANTIC_FACE_RECORD_FILE_REL)), false, "a fail-closed writer must NOT append a record");
});
