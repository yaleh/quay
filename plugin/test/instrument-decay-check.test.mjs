// @test-group engine
// instrument-decay-check.test.mjs — gap-archguard-p5-instrument-decay-standing-guard
// AC3: fixture jsonl（不依赖真实 .quay/ 状态随时间漂移）驱动 instrument-decay-check.ts 的判定。
//
// 覆盖：
//   AC1   fan-in-step-trace.jsonl 里 4 个 suite 决策分组（ac-precheck/suite-start/suite-end/
//         suite-skip）0 条记录而 8 个伴生分组仍在写 ⇒ never-wrote 腐烂 + 伴生对照证据（exit 1）。
//   AC2   反向判据：单分组/全分组同旧的载体（低频但仍在写）不得报腐烂——伴生对照是结构性的
//         防误报（绝对速率阈值必然踩）。负例回归测例。
//   Shape B  有历史记录的分组末次写入比载体最新老超过 --stale-seconds ⇒ rate-stopped。
//   CLI    --no-block 报告但 exit 0；--json 产出结构；全载体缺失 ⇒ NOT-EVALUATED (exit 3)。
//
// Run:
//   node --experimental-strip-types plugin/test/instrument-decay-check.test.mjs
//   scripts/test.sh plugin/test/instrument-decay-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  MANIFEST,
  analyzeCarrier,
  analyzeAll,
  extractTsMs,
  DEFAULT_STALE_SECONDS,
} from "../scripts/instrument-decay-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "instrument-decay-check.ts");

const _tmpDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

// 固定时间戳（不随真实 .quay/ 漂移）。RECENT 与 OLD 相隔 ~5 天 > DEFAULT_STALE_SECONDS (24h)。
const RECENT = "2026-09-04T12:00:00.000Z";
const OLD = "2026-08-30T01:47:00.000Z"; // 文档 §2.5 记的 suite 步骤停写时刻

function epochOf(iso) { return Math.floor(Date.parse(iso) / 1000); }

function stepRec(step, ts) {
  return { event: "step-end", step, task: "gap-x", runId: "wk-prod-1", ts, epoch: epochOf(ts), ok: true };
}

function lockRec(event, ts) {
  return { event, ts, epoch: epochOf(ts), taskId: "gap-x", pid: 1, runId: "wk-prod-1", agentId: null };
}

function writeCarrier(dir, file, rows) {
  const p = path.join(dir, ".quay", file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

// 8 个伴生步骤（仍在写，用 RECENT）+ 可选注入 4 个 suite 决策步骤
const COMPANION_STEPS = ["merge-develop", "anti-drift", "typecheck", "scoped-gate", "doc-check", "anti-drift-land", "ac-gate", "ff"];
const SUITE_STEPS = ["ac-precheck", "suite-start", "suite-end", "suite-skip"];

function fanInStepTraceRows({ includeSuite = false, ts = RECENT } = {}) {
  const rows = COMPANION_STEPS.map((s) => stepRec(s, ts));
  if (includeSuite) for (const s of SUITE_STEPS) rows.push(stepRec(s, ts));
  return rows;
}

// ── extractTsMs ─────────────────────────────────────────────────────────────────────────────────────

test("extractTsMs — ISO ts / epoch(秒) / at / timestamp / sentAtMs 全覆盖", () => {
  assert.equal(extractTsMs({ ts: RECENT }), Date.parse(RECENT));
  assert.equal(extractTsMs({ epoch: epochOf(RECENT) }), Date.parse(RECENT));
  assert.equal(extractTsMs({ at: RECENT }), Date.parse(RECENT));
  assert.equal(extractTsMs({ timestamp: RECENT }), Date.parse(RECENT));
  assert.equal(extractTsMs({ sentAtMs: Date.parse(RECENT) }), Date.parse(RECENT));
  assert.equal(extractTsMs({ startedAt: RECENT }), Date.parse(RECENT));
  assert.equal(extractTsMs({}), null); // 缺值 = 未查，不是 0
});

// ── AC1：写手分裂（never-wrote）─────────────────────────────────────────────────────────────────────

test("AC1 — 4 个 suite 决策分组 0 条记录 + 8 个伴生分组仍在写 ⇒ 报 never-wrote 腐烂 + 伴生对照", () => {
  const dir = tmpDir("idc-ac1-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: false }));
  const spec = MANIFEST[0];
  const res = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS);
  assert.equal(res.evaluated, true);
  const neverWrote = res.decayed.filter((d) => d.kind === "never-wrote").map((d) => d.group).sort();
  assert.deepEqual(neverWrote, [...SUITE_STEPS].sort(), "the 4 suite-decision groups must be reported as never-wrote");
  const companionNames = res.companions.map((c) => c.group).sort();
  assert.deepEqual(companionNames, [...COMPANION_STEPS].sort(), "all 8 companion steps must be the still-writing contrast");
  for (const c of res.companions) assert.equal(c.lastWriteMs, Date.parse(RECENT));
});

test("AC1 正例对照 — 12 个分组全在写 ⇒ 零腐烂", () => {
  const dir = tmpDir("idc-ok-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: true }));
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS);
  assert.equal(res.evaluated, true);
  assert.equal(res.decayed.length, 0, "no group stopped → no decay");
});

// ── AC2：反向判据（低频但仍在写不得误报）────────────────────────────────────────────────────────────

test("AC2 反向 — 单分组载体末次写入很旧（30 天前）但无伴生对照 ⇒ 不报腐烂", () => {
  const dir = tmpDir("idc-neg-single-");
  writeCarrier(dir, "message-receipts.jsonl", [{ name: "quay-task-worker", state: "delivered", sentAtMs: Date.parse(OLD) }]);
  // message-receipts 是单流载体（无 step/event 分组），用同一个 groupBy=name 的规格证明：单分组载体
  // 结构上不可能满足「比伴生更旧」——它自己就是最新。绝对速率阈值会把它（30 天没写）误报，本检测器不报。
  const spec = { file: "message-receipts.jsonl", groupBy: "name", expected: ["quay-task-worker"], shapeB: true, note: "" };
  const res = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS);
  assert.equal(res.evaluated, true);
  assert.equal(res.decayed.length, 0, "a single-group low-frequency carrier must NOT be flagged as decay");
});

test("AC2 反向 — 全分组同旧（无内部对照）⇒ 不报腐烂（绝对速率阈值会报，伴生对照不报）", () => {
  const dir = tmpDir("idc-neg-allold-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: true, ts: OLD }));
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS);
  assert.equal(res.decayed.length, 0, "all groups equally old ⇒ no internal companion contrast ⇒ no decay");
});

// ── Shape B：速率归零（rate-stopped）────────────────────────────────────────────────────────────────

test("Shape B — 有历史记录的分组末次写入比载体最新老超过 stale-seconds ⇒ rate-stopped", () => {
  const dir = tmpDir("idc-rateb-");
  // merge-develop 最近还在写（RECENT），scoped-gate 有历史记录但停在 OLD（~5 天前）。
  writeCarrier(dir, "fan-in-step-trace.jsonl", [
    stepRec("merge-develop", RECENT),
    stepRec("scoped-gate", OLD),
    stepRec("scoped-gate", OLD),
  ]);
  const spec = { file: "fan-in-step-trace.jsonl", groupBy: "step", expected: ["merge-develop"], shapeB: true, note: "" };
  const res = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS);
  const rateStopped = res.decayed.filter((d) => d.kind === "rate-stopped").map((d) => d.group);
  assert.deepEqual(rateStopped, ["scoped-gate"], "scoped-gate stopped writing while merge-develop still writes");
  assert.equal(res.decayed.find((d) => d.group === "scoped-gate").count, 2);
});

test("Shape B 关闭 — shapeB:false 的载体不判速率（fan-in-lock-events 持锁时 release 可合法滞后）", () => {
  const dir = tmpDir("idc-nosb-");
  writeCarrier(dir, "fan-in-lock-events.jsonl", [lockRec("acquire", RECENT), lockRec("release", OLD)]);
  const res = analyzeCarrier(dir, MANIFEST[1], DEFAULT_STALE_SECONDS);
  assert.equal(res.evaluated, true);
  assert.equal(res.decayed.length, 0, "shapeB:false ⇒ release 滞后 acquire 不算速率腐烂");
});

// ── fan-in-lock-events Shape A ──────────────────────────────────────────────────────────────────────

test("fan-in-lock-events — release 0 条而 acquire 在写 ⇒ never-wrote（Shape A 也适用于非 step 字段）", () => {
  const dir = tmpDir("idc-lock-a-");
  writeCarrier(dir, "fan-in-lock-events.jsonl", [lockRec("acquire", RECENT)]);
  const res = analyzeCarrier(dir, MANIFEST[1], DEFAULT_STALE_SECONDS);
  const neverWrote = res.decayed.filter((d) => d.kind === "never-wrote").map((d) => d.group);
  assert.deepEqual(neverWrote, ["release"], "release never wrote while acquire does");
});

// ── analyzeAll ──────────────────────────────────────────────────────────────────────────────────────

test("analyzeAll — 汇总 anyDecayed / anyEvaluated / decayedCount", () => {
  const dir = tmpDir("idc-all-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: false }));
  const out = analyzeAll(dir, { staleSeconds: DEFAULT_STALE_SECONDS });
  assert.equal(out.anyEvaluated, true);
  assert.equal(out.anyDecayed, true);
  assert.equal(out.decayedCount, 4);
});

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function runChecker(dir, extra = []) {
  return spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir, ...extra], { encoding: "utf8" });
}

test("CLI — 写手分裂 ⇒ exit 1 + INSTRUMENT-DECAY + 伴生对照", () => {
  const dir = tmpDir("idc-cli-red-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: false }));
  writeCarrier(dir, "fan-in-lock-events.jsonl", [lockRec("acquire", RECENT), lockRec("release", RECENT)]);
  const r = runChecker(dir);
  assert.equal(r.status, 1, `must exit 1 on decay: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /INSTRUMENT-DECAY: \.quay\/fan-in-step-trace\.jsonl/);
  assert.match(r.stdout, /ac-precheck/);
  assert.match(r.stdout, /suite-start/);
  assert.match(r.stdout, /suite-end/);
  assert.match(r.stdout, /suite-skip/);
  assert.match(r.stdout, /companion \(still writing\): merge-develop/);
  assert.match(r.stdout, /scoped-gate/);
});

test("CLI — 全分组在写 ⇒ exit 0", () => {
  const dir = tmpDir("idc-cli-ok-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: true }));
  writeCarrier(dir, "fan-in-lock-events.jsonl", [lockRec("acquire", RECENT), lockRec("release", RECENT)]);
  const r = runChecker(dir);
  assert.equal(r.status, 0, `must exit 0 when nothing stopped: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /ok — no instrument decay/);
});

test("CLI — 全载体缺失（verify worktree 无主检出运行时态）⇒ exit 3 NOT-EVALUATED，永不与「无腐烂」同形", () => {
  const dir = tmpDir("idc-cli-ne-");
  // 造一个空 .quay/ 目录（有 .quay 但无清单载体）。
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  const r = runChecker(dir);
  assert.equal(r.status, 3, `absent carriers must be NOT-EVALUATED (exit 3), not exit 0: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED/);
});

test("CLI — --no-block：仍打印 INSTRUMENT-DECAY 但 exit 0（常驻 report-only 接线路径）", () => {
  const dir = tmpDir("idc-cli-noblock-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: false }));
  const r = runChecker(dir, ["--no-block"]);
  assert.equal(r.status, 0, `--no-block must exit 0 even with decay: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /INSTRUMENT-DECAY/);
  assert.match(r.stdout, /ac-precheck/);
});

test("CLI --json — 结构完整 + decayed 清单 + 伴生对照", () => {
  const dir = tmpDir("idc-cli-json-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: false }));
  const r = runChecker(dir, ["--json"]);
  assert.equal(r.status, 1, "json red still exits 1");
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.evaluated, true);
  assert.equal(out.decayedCount, 4);
  const ft = out.carriers.find((c) => c.file === "fan-in-step-trace.jsonl");
  assert.ok(ft);
  const neverWrote = ft.decayed.filter((d) => d.kind === "never-wrote").map((d) => d.group).sort();
  assert.deepEqual(neverWrote, [...SUITE_STEPS].sort());
  assert.ok(ft.companions.length >= 8);
});

test("CLI --carrier — 只检一个载体", () => {
  const dir = tmpDir("idc-cli-carrier-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", fanInStepTraceRows({ includeSuite: false }));
  writeCarrier(dir, "fan-in-lock-events.jsonl", [lockRec("acquire", RECENT)]); // release 缺失 → 也会腐烂
  const r = runChecker(dir, ["--carrier", "fan-in-step-trace.jsonl", "--json"]);
  const out = JSON.parse(r.stdout);
  assert.equal(out.carriers.length, 1, "--carrier filters the manifest to one carrier");
  assert.equal(out.carriers[0].file, "fan-in-step-trace.jsonl");
  assert.equal(out.decayedCount, 4);
});
