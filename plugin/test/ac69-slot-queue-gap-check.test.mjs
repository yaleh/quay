// @test-group engine
// ac69-slot-queue-gap-check.test.mjs — AC69 槽满排队「先量再改」测量记录检查器测试
// (tasks/gap-ac69-suite-slot-full-should-queue-not-wait, AC1 + DoD).
//
// AC1 判据（verbatim）：槽释放→下次派发的差已测（现成量，零新机制），结论支撑改法或维持。
// DoD（verbatim）：槽释放→下次派发差值已实测（/proc/locks 或 suite 终态写入时刻，零新机制），
//   结论支撑改法或维持。
//
// This file pins:
//   (a) the pure logic (plugin/scripts/ac69-slot-queue-gap-check.ts) — validateRecord / hasFiniteMedian /
//       RECORD_REL / REQUIRED_FIELDS / VALID_CONCLUSIONS;
//   (b) the REAL committed measurement record is GREEN (CLI exit 0) — the「先量再改」deliverable landed;
//   (c) the NEGATIVE CONTROLS (硬规则 3b —「无法评估」≠「合格」，退出码必须区分):
//       (1) record absent ⇒ exit 2 (NOT-EVALUATED, NOT 0);
//       (2) record malformed JSON ⇒ exit 3 (NOT-EVALUATED, NOT 0);
//       (3) record missing a required field (no conclusion) ⇒ exit 3;
//       (4) record with an invalid conclusion value ⇒ exit 3.
//
// Run:
//   scripts/test.sh plugin/test/ac69-slot-queue-gap-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  RECORD_REL,
  REQUIRED_FIELDS,
  VALID_CONCLUSIONS,
  EXIT_NOT_FOUND,
  EXIT_MALFORMED,
  hasFiniteMedian,
  validateRecord,
  checkRecord,
} from "../scripts/ac69-slot-queue-gap-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "ac69-slot-queue-gap-check.ts");
const REAL_RECORD = path.join(repoRoot, RECORD_REL);

/** Build a minimal valid record object. */
function validRecord(overrides = {}) {
  return {
    task: "gap-ac69-suite-slot-full-should-queue-not-wait",
    measuredAt: "2026-08-14T00:00:00Z",
    dataSource: ".quay/verification-round.jsonl",
    method: "suite terminal-state write: end(N) = startedAt(N)+durationMs(N); gap = start(N+1)-end(N)",
    stats: { medianSeconds: 123.4 },
    conclusion: "maintain",
    conclusionReason: "median gap ~123s (~2 min), NOT a full tick period (1200-1800s); maintain the 2-slot model.",
    ...overrides,
  };
}

/** Spawn the CLI in a temp root (or with an explicit --record override). */
function runCli({ record }) {
  const args = ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot, "--record", record];
  return spawnSync("node", args, { encoding: "utf8" });
}

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("RECORD_REL points at the committed measurement record", () => {
  assert.equal(RECORD_REL, "docs/analysis/ac69-slot-release-vs-dispatch-gap.json");
});

test("REQUIRED_FIELDS — the record must carry task/measuredAt/dataSource/method/stats/conclusion/conclusionReason", () => {
  assert.deepEqual(REQUIRED_FIELDS, [
    "task", "measuredAt", "dataSource", "method", "stats", "conclusion", "conclusionReason",
  ]);
});

test("VALID_CONCLUSIONS — conclusion must be maintain|change (the「改法或维持」axis)", () => {
  assert.deepEqual(VALID_CONCLUSIONS, ["maintain", "change"]);
});

test("hasFiniteMedian — true only for a finite number", () => {
  assert.equal(hasFiniteMedian({ medianSeconds: 123.4 }), true);
  assert.equal(hasFiniteMedian({ medianSeconds: 0 }), true);
  assert.equal(hasFiniteMedian({ medianSeconds: "123.4" }), false);
  assert.equal(hasFiniteMedian({}), false);
  assert.equal(hasFiniteMedian(null), false);
  assert.equal(hasFiniteMedian({ medianSeconds: NaN }), false);
});

test("validateRecord — a complete record is ok", () => {
  const v = validateRecord(validRecord());
  assert.equal(v.ok, true);
  assert.deepEqual(v.missing, []);
});

test("validateRecord — a non-object record is not ok", () => {
  assert.equal(validateRecord(null).ok, false);
  assert.equal(validateRecord("nope").ok, false);
  assert.equal(validateRecord(42).ok, false);
});

test("validateRecord — missing a required field is not ok (names the field)", () => {
  const { conclusion, ...noConclusion } = validRecord();
  const v = validateRecord(noConclusion);
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes("conclusion"));
});

test("validateRecord — an invalid conclusion value is not ok", () => {
  const v = validateRecord(validRecord({ conclusion: "keep-it" }));
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes("conclusion"));
});

test("validateRecord — a non-finite median is not ok", () => {
  const v = validateRecord(validRecord({ stats: { medianSeconds: "big" } }));
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes("stats.medianSeconds"));
});

test("validateRecord — a trivial conclusionReason is not ok", () => {
  const v = validateRecord(validRecord({ conclusionReason: "  " }));
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes("conclusionReason"));
});

// ── real record ─────────────────────────────────────────────────────────────────────────────────────

test("AC1 DoD — the REAL committed measurement record is GREEN (CLI exit 0)", () => {
  assert.ok(fs.existsSync(REAL_RECORD), `measurement record must exist at ${RECORD_REL}`);
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot], { encoding: "utf8" });
  assert.equal(r.status, 0, `real record must be GREEN:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /PASS/);
  assert.match(r.stdout, /conclusion=maintain/, "the committed record must state its 维持/改法 conclusion");
});

test("AC1 DoD — the real record's conclusion field is one of maintain|change and has a median", () => {
  const rec = JSON.parse(fs.readFileSync(REAL_RECORD, "utf8"));
  assert.ok(VALID_CONCLUSIONS.includes(rec.conclusion), `conclusion must be maintain|change, got ${rec.conclusion}`);
  assert.ok(typeof rec.stats.medianSeconds === "number" && Number.isFinite(rec.stats.medianSeconds));
});

// ── negative controls (硬规则 3b: NOT-EVALUATED ≠ 合格) ─────────────────────────────────────────────

test("硬规则 3b 负控制 — record ABSENT ⇒ exit 2 (NOT-EVALUATED), never 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac69-neg-absent-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = runCli({ record: path.join(dir, "no-such-record.json") });
  assert.equal(r.status, EXIT_NOT_FOUND, `absent record must exit ${EXIT_NOT_FOUND} (distinct from pass):\n${r.stdout}\n${r.stderr}`);
  assert.notEqual(r.status, 0, "absent record must NOT look like a pass (硬规则 3b)");
  assert.match(r.stdout, /NOT FOUND/);
});

test("硬规则 3b 负控制 — record MALFORMED JSON ⇒ exit 3 (NOT-EVALUATED), never 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac69-neg-json-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, "{ not json", "utf8");
  const r = runCli({ record: file });
  assert.equal(r.status, EXIT_MALFORMED, `malformed JSON must exit ${EXIT_MALFORMED}:\n${r.stdout}\n${r.stderr}`);
  assert.notEqual(r.status, 0, "malformed record must NOT look like a pass (硬规则 3b)");
  assert.match(r.stdout, /not valid JSON/);
});

test("硬规则 3b 负控制 — record MISSING required field ⇒ exit 3 (NOT-EVALUATED), never 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac69-neg-field-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "missing-conclusion.json");
  const { conclusion, ...noConclusion } = validRecord();
  fs.writeFileSync(file, JSON.stringify(noConclusion), "utf8");
  const r = runCli({ record: file });
  assert.equal(r.status, EXIT_MALFORMED, `missing field must exit ${EXIT_MALFORMED}:\n${r.stdout}\n${r.stderr}`);
  assert.notEqual(r.status, 0, "missing-field record must NOT look like a pass (硬规则 3b)");
  assert.match(r.stdout, /missing required field/);
});

test("硬规则 3b 负控制 — record INVALID conclusion value ⇒ exit 3 (NOT-EVALUATED), never 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac69-neg-concl-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "bad-conclusion.json");
  fs.writeFileSync(file, JSON.stringify(validRecord({ conclusion: "maybe" })), "utf8");
  const r = runCli({ record: file });
  assert.equal(r.status, EXIT_MALFORMED, `invalid conclusion must exit ${EXIT_MALFORMED}:\n${r.stdout}\n${r.stderr}`);
  assert.notEqual(r.status, 0, "invalid-conclusion record must NOT look like a pass (硬规则 3b)");
  assert.match(r.stdout, /conclusion must be one of/);
});

// ── exit-code separation is structural (硬规则 3b) ───────────────────────────────────────────────────

test("硬规则 3b — the three exit codes are pairwise distinct (0 ≠ 2 ≠ 3)", () => {
  assert.notEqual(EXIT_NOT_FOUND, 0);
  assert.notEqual(EXIT_MALFORMED, 0);
  assert.notEqual(EXIT_NOT_FOUND, EXIT_MALFORMED);
});

test("checkRecord — direct call returns ok:false + distinct code for an absent file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac69-direct-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = checkRecord(path.join(dir, "absent.json"));
  assert.equal(res.ok, false);
  assert.equal(res.code, EXIT_NOT_FOUND);
  assert.match(res.reason, /NOT FOUND/);
});
