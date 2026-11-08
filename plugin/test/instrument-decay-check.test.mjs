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
  SUITE_INCOMPLETE_TRIGGER_CMD,
  RECOVERY_ACCEPTED_TRIGGER_CMD,
  RECOVERY_EXEMPT_TRIGGER_CMD,
  BASELINE_RED_EXEMPT_TRIGGER_CMD,
  landingStepConditionCmd,
  RERUN_UNREACHABLE_CONDITION_CMD,
  SUITE_RERUN_GREEN_CONDITION_CMD,
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

// ── 形态 C：内容全暗（gap-instrument-decay-check-unwired-and-blind-to-content-dark）───────────────────
// 载体照常写入，但写进去的每一条都是 evaluated:false。形状 A/B 结构上看不见它。

const ARCH_CYCLE_SPEC = MANIFEST.find((m) => m.file === "arch-cycle-history.jsonl");
const ARCH_COVERAGE_SPEC = MANIFEST.find((m) => m.file === "arch-coverage-history.jsonl");
const DESIGN_EVOLUTION_SPEC = MANIFEST.find((m) => m.file === "design-evolution-history.jsonl");

function cycleRec(ts, evaluated, scopes = []) {
  return { ts, mode: "arch-cycle-report-round", evaluated, scopes };
}
function coverageRec(ts, evaluated) {
  return { ts, runner: "arch-coverage-report.ts", evaluated, languages: [] };
}

test("形态 C — 真实描述符（arch-cycle-history）：从首条起每条 false ⇒ content-dark + 暗区间", () => {
  const dir = tmpDir("idc-c-dark-");
  writeCarrier(dir, "arch-cycle-history.jsonl", [
    cycleRec("2026-10-18T10:25:51.593Z", false),
    cycleRec("2026-10-19T10:25:51.593Z", false),
    cycleRec("2026-10-21T23:14:05.363Z", false),
  ]);
  const res = analyzeCarrier(dir, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.contentDark.state, "dark");
  assert.equal(res.contentDark.records, 3);
  assert.equal(res.contentDark.falseRecords, 3);
  assert.deepEqual(res.contentDark.darkInterval, {
    startTs: "2026-10-18T10:25:51.593Z",
    endTs: "2026-10-21T23:14:05.363Z",
    records: 3,
    ended: false,
  }, "the dark INTERVAL (start / count / still dark) is part of the reading, not just a boolean");
  const dark = res.decayed.filter((d) => d.kind === "content-dark");
  assert.equal(dark.length, 1, "content-dark must be a DecayFinding, not only a shape reading");
  assert.equal(dark[0].group, "(all records)");
  assert.equal(dark[0].count, 3);
  assert.match(dark[0].detail, /darkInterval=\[2026-10-18T10:25:51\.593Z \.\. now\], 3 record/);
});

test("形态 C — 修复落地后（首条 true 出现）报告一个【已结束】的暗区间，当前不再判暗（AC1 第二支）", () => {
  const dir = tmpDir("idc-c-ended-");
  // 25 条 false（模拟 2026-10-18T10:25Z 起的历史）之后，修复任务写入了首条 true。
  const rows = Array.from({ length: 25 }, (_, i) =>
    cycleRec(`2026-10-${String(18 + Math.floor(i / 12)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:25:51.593Z`, false));
  rows.push(cycleRec("2026-10-22T05:00:00.000Z", true));
  writeCarrier(dir, "arch-cycle-history.jsonl", rows);
  const res = analyzeCarrier(dir, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.contentDark.state, "healthy", "current state is no longer dark");
  assert.deepEqual(res.contentDark.darkInterval, {
    startTs: "2026-10-18T00:25:51.593Z",
    endTs: "2026-10-20T00:25:51.593Z",
    records: 25,
    ended: true,
  }, "the ENDED interval must survive the repair: start + 25 records + ended");
  assert.equal(res.decayed.filter((d) => d.kind === "content-dark").length, 0, "an ended interval is NOT a current finding");
});

test("形态 C 负对照 — arch-coverage-history 描述符：31/31 true ⇒ healthy（不命中）", () => {
  const dir = tmpDir("idc-c-healthy-");
  writeCarrier(dir, "arch-coverage-history.jsonl", Array.from({ length: 31 }, (_, i) =>
    coverageRec(`2026-10-${String((i % 21) + 1).padStart(2, "0")}T07:02:50.500Z`, true)));
  const res = analyzeCarrier(dir, ARCH_COVERAGE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.contentDark.state, "healthy");
  assert.equal(res.contentDark.records, 31);
  assert.equal(res.contentDark.darkInterval, null, "no leading false run ⇒ no interval");
  assert.equal(res.decayed.filter((d) => d.kind === "content-dark").length, 0);
});

test("形态 C 边界 — 只有 1 条记录 ⇒ not-evaluated（冷启动时序，⛔ 不是 healthy）", () => {
  const dir = tmpDir("idc-c-cold-");
  writeCarrier(dir, "design-evolution-history.jsonl", [{ ts: RECENT, evaluated: true }]);
  const res = analyzeCarrier(dir, DESIGN_EVOLUTION_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.contentDark.state, "not-evaluated");
  assert.match(res.contentDark.reason, /cold-start/);
  assert.equal(res.contentDark.darkInterval, null);
  assert.equal(res.decayed.length, 0, "a cold start is not a finding");
});

test("形态 C 边界 — 一条记录缺 evaluated 字段 ⇒ not-evaluated（读不懂 ≠ 健康）", () => {
  const dir = tmpDir("idc-c-missing-");
  writeCarrier(dir, "arch-cycle-history.jsonl", [cycleRec(RECENT, false), { ts: RECENT, mode: "arch-cycle-report-round" }]);
  const res = analyzeCarrier(dir, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.contentDark.state, "not-evaluated");
  assert.match(res.contentDark.reason, /no boolean 'evaluated'/);
});

// ── 形态 D：过期的已评估 ────────────────────────────────────────────────────────────────────────────

function git(dir, args, env = {}) {
  return spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", ...env },
  });
}

function makeRepo(dir) {
  assert.equal(git(dir, ["init", "-q"]).status, 0, "git init");
  assert.equal(git(dir, ["config", "user.email", "fixture@example.com"]).status, 0);
  assert.equal(git(dir, ["config", "user.name", "fixture"]).status, 0);
}

function commitAt(dir, iso, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  assert.equal(git(dir, ["add", relPath]).status, 0, "git add");
  const r = git(dir, ["commit", "-q", "-m", `touch ${relPath}`], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  });
  assert.equal(r.status, 0, `git commit at ${iso}: ${r.stderr}`);
}

test("形态 D — 产物时间戳早于覆盖源路径的最新提交 ⇒ stale-evaluated", () => {
  const dir = tmpDir("idc-d-stale-");
  makeRepo(dir);
  // 覆盖源路径在 16:26 被提交改动；读数里的产物时间戳是 16:17 ⇒ 读数过期。
  commitAt(dir, "2026-10-21T16:26:00Z", "packages/quay/src/a.ts", "export const a = 1;\n");
  writeCarrier(dir, "arch-cycle-history.jsonl", [
    {
      ts: "2026-10-21T23:14:05.363Z", mode: "arch-cycle-report-round", evaluated: false,
      stale: true, // the carrier's OWN staleness signal — carried, never used as D's verdict
      scopes: [{ scope: "src", source: "packages/quay/src", evaluated: true, artifactTimestamp: "2026-10-21T16:17:56.117Z", cycleCount: 0 }],
    },
  ]);
  const res = analyzeCarrier(dir, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.staleEvaluated.state, "stale");
  assert.equal(res.staleEvaluated.scopes.length, 1);
  assert.equal(res.staleEvaluated.scopes[0].state, "stale");
  assert.equal(res.staleEvaluated.scopes[0].artifactMs, Date.parse("2026-10-21T16:17:56.117Z"));
  assert.equal(res.staleEvaluated.scopes[0].commitMs, Date.parse("2026-10-21T16:26:00Z"));
  assert.equal(res.staleEvaluated.recordStale, true, "the carrier's own `stale` is carried (it had no downstream before)");
  const finding = res.decayed.filter((d) => d.kind === "stale-evaluated");
  assert.equal(finding.length, 1);
  assert.equal(finding[0].group, "src");
});

test("形态 D 负对照 — 产物时间晚于所有覆盖提交 ⇒ fresh（不命中）", () => {
  const dir = tmpDir("idc-d-fresh-");
  makeRepo(dir);
  commitAt(dir, "2026-10-21T16:26:00Z", "packages/quay/src/a.ts", "export const a = 1;\n");
  writeCarrier(dir, "arch-cycle-history.jsonl", [
    {
      ts: "2026-10-21T23:14:05.363Z", mode: "arch-cycle-report-round", evaluated: true,
      scopes: [{ scope: "src", source: "packages/quay/src", evaluated: true, basis: "module-graph", artifactTimestamp: "2026-10-21T22:00:00.000Z", cycleCount: 0 }],
    },
  ]);
  const res = analyzeCarrier(dir, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.staleEvaluated.state, "fresh");
  assert.deepEqual(res.staleEvaluated.artifactIndependentScopes, [], "an artifact-derived reading was actually compared");
  assert.equal(res.decayed.filter((d) => d.kind === "stale-evaluated").length, 0);
});

// ── 形态 D × artifact-independence（gap-arch-cycle-single-directory-basis-never-due）─────────────────
// 生产实测（2026-10-25T17:27Z）：载体同一条记录里 `scripts` 是 `basis:"single-directory"`、
// `artifactTimestamp` 比覆盖源最新提交早 1.5h，写手为了绕开这一点把 `commitsSinceArtifact` 硬编码成 0
// ⇒ 检测器判 stale、载体自称当前，两个读数互相矛盾。修法：描述符声明 `basis:"single-directory"` 是
// live 读数 ⇒ 不做「产物 vs 提交」比较，并**显式**记 `artifact-independent`（⛔ 不是静默跳过）。

test("形态 D — 同一记录里 single-directory（live）标 artifact-independent，module-graph 仍判 stale（AC2 正/负对照）", () => {
  const dir = tmpDir("idc-d-independence-");
  makeRepo(dir);
  // 两条覆盖路径都在产物之后被提交改动过。
  commitAt(dir, "2026-10-21T16:26:00Z", "plugin/scripts/a.ts", "export const a = 1;\n");
  commitAt(dir, "2026-10-21T16:27:00Z", "packages/quay/src/a.ts", "export const a = 1;\n");
  writeCarrier(dir, "arch-cycle-history.jsonl", [
    {
      ts: "2026-10-21T23:14:05.363Z", mode: "arch-cycle-report-round", evaluated: true,
      scopes: [
        {
          scope: "scripts", source: "plugin/scripts", evaluated: true, basis: "single-directory",
          readingFreshness: "live-file-list", fileListReadAt: "2026-10-21T23:00:00.000Z",
          artifactTimestamp: "2026-10-21T16:17:56.117Z", cycleCount: 0,
          commitsSinceArtifact: null, behindSources: null,
        },
        {
          scope: "src", source: "packages/quay/src", evaluated: true, basis: "module-graph",
          readingFreshness: "artifact", fileListReadAt: null,
          artifactTimestamp: "2026-10-21T16:17:56.117Z", cycleCount: 0,
          commitsSinceArtifact: 1, behindSources: true,
        },
      ],
    },
  ]);
  const res = analyzeCarrier(dir, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  const byScope = Object.fromEntries(res.staleEvaluated.scopes.map((s) => [s.scope, s]));

  // (a) live 读数 + 旧产物 ⇒ 不是 stale；跳过比较这件事本身进读数。
  assert.equal(byScope.scripts.state, "artifact-independent");
  assert.deepEqual(byScope.scripts.independence, {
    field: "basis",
    value: "single-directory",
    readAt: "2026-10-21T23:00:00.000Z",
  }, "the live read timestamp comes from the CARRIER, not from the descriptor");
  assert.equal(byScope.scripts.commitMs, null, "no artifact-vs-commit comparison was made for a live reading");
  assert.equal(byScope.scripts.artifactTs, "2026-10-21T16:17:56.117Z", "the artifact is still reported — as provenance");
  assert.match(byScope.scripts.reason, /provenance only/);
  assert.deepEqual(res.staleEvaluated.artifactIndependentScopes, ["scripts"], "the skip is named at the record level too");

  // (b) module-graph + 同一个旧产物 ⇒ 仍然 stale（豁免不是一揽子）。
  assert.equal(byScope.src.state, "stale");
  assert.equal(byScope.src.commitMs, Date.parse("2026-10-21T16:27:00Z"));
  assert.equal(byScope.src.independence, null);
  const findings = res.decayed.filter((d) => d.kind === "stale-evaluated");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].group, "src", "⛔ only the artifact-derived scope is reported — never the live one");

  // 整体仍是 stale：同一条记录里确实有一份「读的是产物且已落后」的读数。
  assert.equal(res.staleEvaluated.state, "stale");
  assert.equal(res.staleEvaluated.artifactIndependentScopes.includes("src"), false);
});

test("形态 D — 只有 artifact-independent 作用域 ⇒ 整体 fresh（不是 stale，也不是 not-evaluated）", () => {
  const dir = tmpDir("idc-d-independence-only-");
  makeRepo(dir);
  commitAt(dir, "2026-10-21T16:26:00Z", "plugin/scripts/a.ts", "export const a = 1;\n");
  writeCarrier(dir, "arch-cycle-history.jsonl", [
    {
      ts: "2026-10-21T23:14:05.363Z", mode: "arch-cycle-report-round", evaluated: true,
      scopes: [{
        scope: "scripts", source: "plugin/scripts", evaluated: true, basis: "single-directory",
        readingFreshness: "live-file-list", fileListReadAt: "2026-10-21T23:00:00.000Z",
        artifactTimestamp: "2026-10-21T16:17:56.117Z", cycleCount: 0,
        commitsSinceArtifact: null, behindSources: null,
      }],
    },
  ]);
  const res = analyzeCarrier(dir, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.staleEvaluated.state, "fresh", "a current live reading is fresh — the old artifact does not age it");
  assert.deepEqual(res.staleEvaluated.artifactIndependentScopes, ["scripts"]);
  assert.equal(res.decayed.filter((d) => d.kind === "stale-evaluated").length, 0);

  // 负对照（同一份产物时间戳、去掉 basis 声明）⇒ 同样的数据仍被判 stale。若没有这一臂，
  // 「artifact-independent」就可能只是「这个夹具永远不报」。
  const dir2 = tmpDir("idc-d-independence-neg-");
  makeRepo(dir2);
  commitAt(dir2, "2026-10-21T16:26:00Z", "plugin/scripts/a.ts", "export const a = 1;\n");
  writeCarrier(dir2, "arch-cycle-history.jsonl", [
    {
      ts: "2026-10-21T23:14:05.363Z", mode: "arch-cycle-report-round", evaluated: true,
      scopes: [{
        scope: "scripts", source: "plugin/scripts", evaluated: true, artifactTimestamp: "2026-10-21T16:17:56.117Z", cycleCount: 0,
      }],
    },
  ]);
  const res2 = analyzeCarrier(dir2, ARCH_CYCLE_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res2.staleEvaluated.state, "stale", "⛔ without the independence declaration the same old artifact IS stale");
  assert.deepEqual(res2.staleEvaluated.artifactIndependentScopes, []);
});

test("形态 D — 读 git 的例程按声明 not-applicable（⛔ 不是 fresh，也不是 finding）", () => {
  const dir = tmpDir("idc-d-na-");
  writeCarrier(dir, "design-evolution-history.jsonl", [
    { ts: RECENT, evaluated: true, mode: "design-evolution-readings-round" },
    { ts: RECENT, evaluated: true, mode: "design-evolution-readings-round" },
  ]);
  const res = analyzeCarrier(dir, DESIGN_EVOLUTION_SPEC, DEFAULT_STALE_SECONDS);
  assert.equal(res.staleEvaluated.state, "not-applicable");
  assert.match(res.staleEvaluated.reason, /git/);
  assert.equal(res.decayed.filter((d) => d.kind === "stale-evaluated").length, 0);
});

// ── 形状 B 的裁定（adjudication）──────────────────────────────────────────────────────────────────
// gap-fan-in-step-trace-rate-stopped-adjudication：Shape B 无法区分「按设计罕见 / 条件性不可达」与
// 「写手腐烂」。描述符可以携带机器可读裁定；裁定**必须可过期**，且被裁定的分组不得从读数里消失。

const NOW_MS = Date.parse("2026-10-23T00:00:00.000Z");
const FUTURE = "2026-11-22T00:00:00.000Z";
const PAST = "2026-10-01T00:00:00.000Z";

/** 一个 Shape B 命中的最小载体：merge-develop 在写，old-group 停了 5 天。 */
function rateStoppedFixture() {
  const dir = tmpDir("idc-adj-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", [
    stepRec("merge-develop", RECENT),
    stepRec("old-group", OLD),
    stepRec("old-group", OLD),
  ]);
  return dir;
}

function rateSpec(adjudicated) {
  return {
    file: "fan-in-step-trace.jsonl", groupBy: "step", expected: ["merge-develop"],
    shapeB: true, note: "", ...(adjudicated !== undefined ? { adjudicated } : {}),
  };
}

test("裁定 — 声明存在且未过期：rare-by-design 进 adjudicated[] 而非 decayed[]，decayedCount 不计它", () => {
  const dir = rateStoppedFixture();
  const spec = rateSpec([
    { group: "old-group", kind: "rare-by-design", reason: "only written on a rare exceptional path", reviewAfter: FUTURE },
  ]);
  const res = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, NOW_MS);
  assert.equal(res.decayed.filter((d) => d.kind === "rate-stopped").length, 0, "an adjudicated group is NOT decay");
  assert.equal(res.adjudicated.length, 1);
  const a = res.adjudicated[0];
  assert.equal(a.group, "old-group");
  assert.equal(a.kind, "rare-by-design");
  assert.equal(a.state, "rare-by-design");
  assert.equal(a.reviewAfter, FUTURE);
  assert.equal(a.condition, null);
  // ⛔ 裁定不隐藏读数：count / lastWriteMs 照样在 adjudicated 里。
  assert.equal(a.count, 2);
  assert.equal(a.lastWriteMs, Date.parse(OLD));

  const out = analyzeAll(dir, { staleSeconds: DEFAULT_STALE_SECONDS, nowMs: NOW_MS }, [spec]);
  assert.equal(out.decayedCount, 0);
  assert.equal(out.adjudicatedCount, 1, "the adjudicated count is a SEPARATE reading, never folded into decayedCount");
  assert.equal(out.healthyCount, 1);
});

test("裁定负控制 — reviewAfter 已过（或删掉声明）⇒ 同一批组回到 decayed[]，且 detail 点名过期", () => {
  const dir = rateStoppedFixture();
  const expired = analyzeCarrier(dir, rateSpec([
    { group: "old-group", kind: "rare-by-design", reason: "only written on a rare exceptional path", reviewAfter: PAST },
  ]), DEFAULT_STALE_SECONDS, NOW_MS);
  const stopped = expired.decayed.filter((d) => d.kind === "rate-stopped");
  assert.deepEqual(stopped.map((d) => d.group), ["old-group"], "an expired adjudication exempts nothing");
  assert.equal(expired.adjudicated.length, 0);
  assert.match(stopped[0].detail, /adjudication expired at 2026-10-01/);
  assert.match(stopped[0].detail, /not a permanent exemption/);

  // 删掉声明：同一份数据回到腐烂（对照证明豁免来自声明，不是来自数据形状）。
  const undeclared = analyzeCarrier(dir, rateSpec(), DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(undeclared.decayed.filter((d) => d.kind === "rate-stopped").map((d) => d.group), ["old-group"]);
  assert.equal(undeclared.adjudicated.length, 0);
});

test("裁定 — 读不懂的声明不产生豁免（无 reason / reviewAfter 读不出 / 未知 kind）", () => {
  const dir = rateStoppedFixture();
  const cases = [
    [{ group: "old-group", kind: "rare-by-design", reason: "   ", reviewAfter: FUTURE }, /no reason/],
    [{ group: "old-group", kind: "rare-by-design", reason: "real reason here", reviewAfter: "not-a-date" }, /unreadable/],
    [{ group: "old-group", kind: "wishful-thinking", reason: "real reason here", reviewAfter: FUTURE }, /unknown adjudication kind/],
  ];
  for (const [decl, re] of cases) {
    const res = analyzeCarrier(dir, rateSpec([decl]), DEFAULT_STALE_SECONDS, NOW_MS);
    assert.equal(res.adjudicated.length, 0, `must NOT exempt: ${JSON.stringify(decl)}`);
    const stopped = res.decayed.filter((d) => d.kind === "rate-stopped");
    assert.deepEqual(stopped.map((d) => d.group), ["old-group"]);
    assert.match(stopped[0].detail, re);
  }
});

test("裁定 — conditional-on-input：条件命令 exit 0 ⇒ explained-absent 并附条件读数；exit 1 ⇒ 仍报 rate-stopped", () => {
  const dir = rateStoppedFixture();
  const hold = analyzeCarrier(dir, rateSpec([
    { group: "old-group", kind: "conditional-on-input", reason: "unreachable while the input condition holds", conditionCmd: "exit 0", reviewAfter: FUTURE },
  ]), DEFAULT_STALE_SECONDS, NOW_MS);
  assert.equal(hold.decayed.filter((d) => d.kind === "rate-stopped").length, 0);
  assert.equal(hold.adjudicated.length, 1);
  assert.equal(hold.adjudicated[0].state, "explained-absent");
  assert.equal(hold.adjudicated[0].condition.cmd, "exit 0");
  assert.equal(hold.adjudicated[0].condition.exitCode, 0);

  // 负控制：条件不成立 ⇒ 缺席不再有解释 ⇒ 照常报腐烂（fail-closed 到「报腐烂」）。
  const broken = analyzeCarrier(dir, rateSpec([
    { group: "old-group", kind: "conditional-on-input", reason: "unreachable while the input condition holds", conditionCmd: "exit 1", reviewAfter: FUTURE },
  ]), DEFAULT_STALE_SECONDS, NOW_MS);
  const stopped = broken.decayed.filter((d) => d.kind === "rate-stopped");
  assert.deepEqual(stopped.map((d) => d.group), ["old-group"], "a false condition must NOT exempt the group");
  assert.match(stopped[0].detail, /condition command did not hold \(exit 1\)/);
  assert.equal(broken.adjudicated.length, 0);

  // 缺条件命令同样不豁免（否则 conditional-on-input 会退化成无条件的永久豁免）。
  const noCmd = analyzeCarrier(dir, rateSpec([
    { group: "old-group", kind: "conditional-on-input", reason: "unreachable while the input condition holds", reviewAfter: FUTURE },
  ]), DEFAULT_STALE_SECONDS, NOW_MS);
  assert.equal(noCmd.adjudicated.length, 0);
  assert.match(noCmd.decayed.find((d) => d.kind === "rate-stopped").detail, /no conditionCmd/);
});

// ── 生产 MANIFEST 的 8 条裁定（本任务的交付物本身）────────────────────────────────────────────────
// 用真实描述符 + 合成载体：8 个分组都命中 Shape B，但描述符声明了裁定 ⇒ 全部进 adjudicated[]。
// ⚠️ 其中 4 条 conditional-on-input 跑的是**生产条件命令**（suite-rerun-green 读末次本组写入之后的
// rerun 记录；suite-skip / suite-recovery / suite-recovery-blocked 读各自的触发输入），因此这些用例同时证明
// 「声明的可执行条件读数」真的能跑、且方向正确——不是把散文抄进 reason 就算数。

const RARE_BY_DESIGN_GROUPS = [
  "verification-round-record", "catch-up-develop",
  "suite-recovery-certified", "suite-recovery-new-regression",
];
const EXPLAINED_ABSENT_GROUPS = [
  "suite-rerun-green", "suite-skip", "suite-recovery", "suite-recovery-blocked",
];
const ADJUDICATED_GROUPS = [...RARE_BY_DESIGN_GROUPS, ...EXPLAINED_ABSENT_GROUPS];
// ⛔ 不是「那一个基线红文件」：suite-rerun-green 的条件是**触发式**的，点名哪个文件与裁定无关。
//    这里用任意一个名字，正是为证明这一点（旧写的 /task-granularity-advice\.test\.mjs/ 断言是缺陷编码）。
const ANY_RERUN_FILE = "plugin/test/some-other-suite-red.test.mjs";
// OLD (08-30) < MID < MID2 < RECENT (09-04)，且 MID/MID2 距 RECENT < 24h（否则恢复阶梯的两个
// 认证分组自己会被 Shape B 判成 rate-stopped，把用例变成一个与主题无关的腐烂读数）。
const MID = "2026-09-03T18:00:00.000Z";
const MID2 = "2026-09-03T20:00:00.000Z";

function manifestFixtureRows({
  lastRerunState = "rerun-red",
  lastRerunFiles = [ANY_RERUN_FILE],
  strayDocOnlyLanding = false,
  omitRerun = false,
  omitRerunState = false,
} = {}) {
  const rows = [];
  for (const s of COMPANION_STEPS) rows.push(stepRec(s, RECENT));
  // ⛔ suite-skip 不在 RECENT 那批里：它属于本任务新裁定的 explained-absent 组，末次写入是 OLD。
  for (const s of SUITE_STEPS.filter((x) => x !== "suite-skip")) rows.push(stepRec(s, RECENT));
  for (const g of ADJUDICATED_GROUPS) rows.push(stepRec(g, OLD));
  // omitRerun ⇒ 载体里没有触发输入（负控制 ④）：readable 但最后一轮重跑记录不存在。
  if (!omitRerun) {
    const rerun = { event: "step-end", step: "rerun", task: "gap-x", runId: "wk-prod-1", ts: RECENT, epoch: epochOf(RECENT), exit: 1, ok: false, state: lastRerunState, files: lastRerunFiles };
    // omitRerunState ⇒ 记录里**没有** state 键（负控制 ⑤ 的「缺失」一半；null/未知字符串各是另外一半）。
    if (omitRerunState) delete rerun.state;
    rows.push(rerun);
  }
  // 恢复阶梯的条件输入：末次降档之后一次 incomplete + 它在同一 task 上的认证（= 首档自己定论）。
  rows.push(stepRec("suite-incomplete", MID));
  rows.push(stepRec("suite-recovery-accepted", MID2));
  rows.push(stepRec("suite-recovery-baseline-exempt", MID2));
  // 负控制 ③ 的输入：一次「含 ff 但没有 suite-start」的落地（不是末次 suite-skip 自己那次）。
  if (strayDocOnlyLanding) rows.push({ ...stepRec("ff", RECENT), task: "gap-doc-only-landing" });
  return rows;
}

/** 复制生产描述符，只覆写一条裁定（负控制用）：证明豁免来自那一条声明，不是来自数据形状。 */
function manifestSpecWithGroupOverride(group, patch) {
  return {
    ...MANIFEST[0],
    adjudicated: MANIFEST[0].adjudicated.map((a) => (a.group === group ? { ...a, ...patch } : a)),
  };
}

test("生产 MANIFEST — 8 个 rate-stopped 分组全部被裁定（4 rare-by-design + 4 explained-absent），0 腐烂", () => {
  const dir = tmpDir("idc-manifest-adj-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows());
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(res.decayed.filter((d) => d.kind === "rate-stopped"), [], "no rate-stopped group may survive the adjudications");
  assert.deepEqual(res.adjudicated.map((a) => a.group).sort(), [...ADJUDICATED_GROUPS].sort());
  for (const g of RARE_BY_DESIGN_GROUPS) {
    assert.equal(res.adjudicated.find((a) => a.group === g).state, "rare-by-design");
  }
  for (const g of EXPLAINED_ABSENT_GROUPS) {
    const a = res.adjudicated.find((a) => a.group === g);
    assert.equal(a.state, "explained-absent", `${g}: the condition must be a real executable reading, not prose`);
    assert.equal(a.condition.exitCode, 0);
    assert.equal(a.kind, "conditional-on-input");
    // ⛔ 已裁定 ≠ 从读数里消失：count / lastWrite 照旧输出，且都指向那组的真实末次写入。
    assert.ok(a.count > 0 && a.lastWriteMs === Date.parse(OLD), `${g} keeps its real reading in adjudicated[]`);
  }
  // ⛔ 触发式条件的正控制（旧写此处是 `assert.match(…, /task-granularity-advice\.test\.mjs/)` 的**反转**）：
  //    生产的条件命令不得含任何具体文件名——把实例钉进条件，会让裁定随「当前哪个文件红」翻转（硬规则 3b）。
  assert.doesNotMatch(res.adjudicated.find((a) => a.group === "suite-rerun-green").condition.cmd, /\.test\.mjs/);
  assert.doesNotMatch(res.adjudicated.find((a) => a.group === "suite-rerun-green").condition.cmd, /task-granularity-advice\.test\.mjs/);
});

test("生产 MANIFEST 负控制 ① — 把 suite-skip 的 reviewAfter 改到过去 ⇒ 它回到 decayed[]，detail 点名过期", () => {
  const dir = tmpDir("idc-manifest-adj-expired-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows());
  const res = analyzeCarrier(dir, manifestSpecWithGroupOverride("suite-skip", { reviewAfter: PAST }), DEFAULT_STALE_SECONDS, NOW_MS);
  const stopped = res.decayed.filter((d) => d.kind === "rate-stopped");
  assert.deepEqual(stopped.map((d) => d.group), ["suite-skip"], "an expired adjudication exempts nothing");
  assert.match(stopped[0].detail, /adjudication expired at 2026-10-01/);
  assert.equal(res.adjudicated.length, 7, "the other seven adjudications still hold");
});

test("生产 MANIFEST 负控制 ② — 把 suite-recovery 的 conditionCmd 换成 exit 1 ⇒ 它回到 decayed[]，detail 点名条件不成立", () => {
  const dir = tmpDir("idc-manifest-adj-cond-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows());
  const res = analyzeCarrier(dir, manifestSpecWithGroupOverride("suite-recovery", { conditionCmd: "exit 1" }), DEFAULT_STALE_SECONDS, NOW_MS);
  const stopped = res.decayed.filter((d) => d.kind === "rate-stopped");
  assert.deepEqual(stopped.map((d) => d.group), ["suite-recovery"], "a false condition must NOT exempt the group");
  assert.match(stopped[0].detail, /condition command did not hold \(exit 1\)/);
  assert.equal(res.adjudicated.length, 7, "the other seven adjudications still hold");
});

test("生产 MANIFEST 负控制 ③ — 含 ff 但没有 suite-start 的落地 ⇒ suite-skip 的裁定不豁免它", () => {
  const dir = tmpDir("idc-manifest-adj-doconly-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows({ strayDocOnlyLanding: true }));
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  const stopped = res.decayed.filter((d) => d.kind === "rate-stopped");
  assert.deepEqual(stopped.map((d) => d.group), ["suite-skip"], "an unexplained doc-only landing re-exposes the absence");
  assert.match(stopped[0].detail, /condition command did not hold/);
  assert.equal(res.adjudicated.length, 7, "the other seven adjudications still hold");
});

// ── 生产 MANIFEST 第 9–11 条裁定：OOM→incomplete→恢复阶梯链的【下游】三个终端 ────────────────────
// (gap-instrument-decay-suite-recovery-groups-unadjudicated)
// 三组（suite-incomplete / suite-recovery-accepted / suite-recovery-baseline-exempt）的写手都在
// worker-fan-in.ts 的同一个 `if (incompleteMarker !== null)` 块里：没有 incomplete 就结构上不可达。
// 条件读的都是【触发输入】，⛔ 不是「本组多久没写」：
//   suite-incomplete               ← .quay/verification-round.jsonl 里【原轮】的 notEvaluated
//                                     （runner 按同一谓词印 SUITE-INCOMPLETE 标记 + 落账本）
//   suite-recovery-accepted        ← 每条 suite-incomplete 是否等到 accepted / blocked
//   suite-recovery-baseline-exempt ← 每次认证走的是 certified 还是 exempt 分支
//
// ⚠️ 恢复轮与原轮**共用 runId**（recoverySuiteCommand 复用同一条 suite 命令）⇒「同一 runId 的第一条
//    = 原轮」是结构判据；恢复轮即使自己又被 OOM 杀也不写 suite-incomplete，必须排除，否则条件在
//    一次 OOM 风暴之后会恒红——负控制 ⑥ 测的就是这个排除是承重的。

const SUITE_OLD = "2026-08-29T10:00:00.000Z"; // suite-incomplete 的末次写入（>24h 早于 RECENT）
const SUITE_OLD2 = "2026-08-29T11:00:00.000Z"; // 阶梯终端（accepted / baseline-exempt）的末次写入
const SUITE_CHAIN_GROUPS = [
  "suite-incomplete", "suite-recovery-accepted", "suite-recovery-baseline-exempt",
];

function ledgerRound({ runId, endedAt, durationMs = 120000, laneCount = 128, notEvaluated, taskId = "gap-x" }) {
  const startedAt = new Date(Date.parse(endedAt) - durationMs).toISOString();
  const rec = {
    round: 1, runId, taskId, startedAt, durationMs, laneCount,
    state: "red", completeness: "complete", plannedFiles: 620, terminalFiles: 620,
  };
  if (notEvaluated !== undefined) rec.notEvaluated = notEvaluated;
  return rec;
}

/** 三个分组都命中 Shape B（末次写入 6 天前），且触发输入都在 ⇒ 全部 explained-absent。 */
function suiteChainFixture({
  extraRows = [],
  extraLedger = [],
  extraIncompleteTask = null, // 追加一条 incomplete（无终端）⇒ 负控制 ④
  certWithoutBranch = false, // 追加一次「没有来路的认证」⇒ 负控制 ⑤
  recoveryOomRound = false, // 追加一条【恢复轮】OOM ⇒ 正控制 ⑥（必须仍被排除）
} = {}) {
  const dir = tmpDir("idc-suite-chain-");
  const rows = [];
  for (const s of COMPANION_STEPS) rows.push(stepRec(s, RECENT));
  for (const s of SUITE_STEPS) rows.push(stepRec(s, RECENT));
  rows.push(stepRec("suite-incomplete", SUITE_OLD));
  rows.push(stepRec("suite-recovery-accepted", SUITE_OLD2));
  rows.push(stepRec("suite-recovery-baseline-exempt", SUITE_OLD2));
  const ledgerExtra = [];
  // 注入的一条 incomplete **总是配上它自己的原轮账本记录**（现实里 suite-incomplete 正是那条轮次
  // 结束 ~7s 后写的）——否则注入的就不是「触发发生了但没认证」，而是「账本本身缺条」，两种缺陷不该混在一起。
  const addRecordedIncomplete = (task, at) => {
    rows.push({ ...stepRec("suite-incomplete", at), task });
    ledgerExtra.push(ledgerRound({
      runId: `mfi-${task}-1`, taskId: task,
      endedAt: new Date(Date.parse(at) + 5000).toISOString(), notEvaluated: "oom-killed (1)",
    }));
  };
  if (extraIncompleteTask !== null) {
    addRecordedIncomplete(extraIncompleteTask, new Date(Date.parse(SUITE_OLD2) + 60000).toISOString());
  }
  if (certWithoutBranch) {
    const t1 = new Date(Date.parse(SUITE_OLD) + 30 * 60000).toISOString();
    const t2 = new Date(Date.parse(SUITE_OLD) + 31 * 60000).toISOString();
    addRecordedIncomplete("gap-x2", t1);
    rows.push({ ...stepRec("suite-recovery-accepted", t2), task: "gap-x2" });
  }
  for (const r of extraRows) rows.push(r);
  writeCarrier(dir, "fan-in-step-trace.jsonl", rows);

  const ledger = [
    // 原轮：结束在末次 suite-incomplete 之后 5s（实测间隔 6.5–9.5s，120s 窗内）
    ledgerRound({ runId: "mfi-gap-x-1", endedAt: new Date(Date.parse(SUITE_OLD) + 5000).toISOString(), notEvaluated: "oom-killed (1)" }),
    // 恢复轮：同一 runId 的第二条 ⇒ 结构性排除（即使自己也 OOM 也不该让条件变红）
    ledgerRound({ runId: "mfi-gap-x-1", endedAt: new Date(Date.parse(SUITE_OLD) + 600000).toISOString(), laneCount: 64, notEvaluated: "oom-killed (2)" }),
  ];
  if (recoveryOomRound) {
    ledger.push(ledgerRound({ runId: "mfi-gap-x-1", endedAt: new Date(Date.parse(SUITE_OLD) + 1200000).toISOString(), laneCount: 32, notEvaluated: "oom-killed (3)" }));
  }
  for (const r of ledgerExtra) ledger.push(r);
  for (const r of extraLedger) ledger.push(r);
  writeCarrier(dir, "verification-round.jsonl", ledger);
  return dir;
}

/** 用生产条件命令直接取一次读数（cwd = 载体 root，与 detector 内部调用完全一致）。 */
function runCondition(cmd, cwd) {
  const r = spawnSync("sh", ["-c", cmd], { cwd, encoding: "utf8" });
  return { status: r.status, stderr: String(r.stderr ?? "") };
}

function rateStoppedGroups(res) {
  return res.decayed.filter((d) => d.kind === "rate-stopped").map((d) => d.group).sort();
}

test("生产 MANIFEST 第 9–11 条 — 3 个下游终端全部 explained-absent，且 count/lastWrite 照出", () => {
  const dir = suiteChainFixture();
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), [], "no rate-stopped group may survive the three adjudications");
  assert.deepEqual(res.adjudicated.map((a) => a.group).sort(), [...SUITE_CHAIN_GROUPS].sort());
  for (const g of SUITE_CHAIN_GROUPS) {
    const a = res.adjudicated.find((x) => x.group === g);
    assert.equal(a.kind, "conditional-on-input", `${g} is condition-gated, not a permanent exemption`);
    assert.equal(a.state, "explained-absent", `${g}: the declared condition must be a real executable reading`);
    assert.equal(a.condition.exitCode, 0);
    // ⛔ 已裁定 ≠ 从读数里消失（硬规则 3b）：count / lastWrite 照旧输出。
    assert.ok(a.count > 0, `${g} keeps its record count`);
  }
  assert.equal(res.adjudicated.find((x) => x.group === "suite-incomplete").lastWriteMs, Date.parse(SUITE_OLD));
  assert.equal(res.adjudicated.find((x) => x.group === "suite-recovery-accepted").lastWriteMs, Date.parse(SUITE_OLD2));
});

test("生产 MANIFEST 负控制 ④（AC3 的负控制）— incomplete 等不到认证（及无来路认证、无记录 OOM 轮）⇒ 三组全部回到 decayed[]", () => {
  const dir = suiteChainFixture({
    extraIncompleteTask: "gap-unresolved",
    certWithoutBranch: true,
    // 账本里另有一条没人记账的原轮 OOM（C1 的负控制）
    extraLedger: [ledgerRound({
      runId: "mfi-negative-control-1", taskId: "gap-negative-control",
      endedAt: "2026-08-29T12:00:00.000Z", notEvaluated: "oom-killed (1)",
    })],
  });
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), [...SUITE_CHAIN_GROUPS].sort(),
    "an incomplete that never gets a terminal, and an OOM round with no suite-incomplete, re-expose ALL three");
  for (const g of SUITE_CHAIN_GROUPS) {
    const d = res.decayed.find((x) => x.group === g);
    assert.match(d.detail, /condition command did not hold \(exit 1\)/, `${g}: the false condition must be named`);
  }
  assert.equal(res.adjudicated.length, 0, "nothing is exempted while the trigger input says otherwise");
});

test("生产 MANIFEST 负控制 ⑤ — 一次认证找不到来路（无 certified / exempt）⇒ 只有 baseline-exempt 回到 decayed[]", () => {
  const dir = suiteChainFixture({ certWithoutBranch: true });
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), ["suite-recovery-baseline-exempt"],
    "the exempt reading is per-certification branch attribution, not a copy of the accepted reading");
  assert.match(res.decayed.find((d) => d.group === "suite-recovery-baseline-exempt").detail, /condition command did not hold \(exit 1\)/);
  assert.equal(res.adjudicated.length, 2, "the other two still hold");
});

test("生产 MANIFEST 负控制 ⑥ — 恢复轮自己也 OOM（同一 runId 的第二条）⇒ suite-incomplete 的裁定仍然成立", () => {
  // ⛔ 这条是承重的：不排除恢复轮，条件会在一次 OOM 风暴之后恒红（实测 170 条 incomplete/OOM 轮次里
  //    105 条是恢复轮），裁定就变成「风暴后永远报腐烂」——与它要消灭的误报同形。
  const dir = suiteChainFixture({ recoveryOomRound: true });
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), [], "a recovery round that itself OOMs is not a missing suite-incomplete");
  assert.equal(res.adjudicated.length, 3);
  assert.equal(res.adjudicated.find((a) => a.group === "suite-incomplete").state, "explained-absent");
});

test("生产 MANIFEST 负控制 ⑦ — 账本里出现一条没被记录的原轮 OOM ⇒ 只有 suite-incomplete 回到 decayed[]", () => {
  const dir = suiteChainFixture({
    extraLedger: [ledgerRound({
      runId: "mfi-unrecorded-original-1", taskId: "gap-x",
      endedAt: new Date(Date.parse(SUITE_OLD) + 3600000).toISOString(), notEvaluated: "incomplete (12/620 missing)",
    })],
  });
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), ["suite-incomplete"],
    "an original round that produced no complete verdict but left no record is exactly the rot this declares away");
  assert.equal(res.adjudicated.length, 2, "the two recovery terminals are unaffected");
});

test("三条条件命令 — 载体或账本读不懂时 fail-closed 到 exit 1（⛔ 不是静默豁免）", () => {
  const noLedger = suiteChainFixture();
  fs.rmSync(path.join(noLedger, ".quay", "verification-round.jsonl"), { force: true });
  assert.equal(runCondition(SUITE_INCOMPLETE_TRIGGER_CMD, noLedger).status, 1, "missing ledger ⇒ cannot evaluate ⇒ decay");

  const emptyCarrier = tmpDir("idc-suite-chain-empty-");
  writeCarrier(emptyCarrier, "fan-in-step-trace.jsonl", []);
  for (const cmd of [SUITE_INCOMPLETE_TRIGGER_CMD, RECOVERY_ACCEPTED_TRIGGER_CMD, RECOVERY_EXEMPT_TRIGGER_CMD]) {
    assert.equal(runCondition(cmd, emptyCarrier).status, 1, "no suite-incomplete in the carrier ⇒ nothing to explain ⇒ decay");
  }
});

// ── suite-rerun-green 的【触发式】条件：可达性 + 三态 ──────────────────────────────────────────────
// (gap-instrument-decay-suite-rerun-green-file-pin-expired；
//  gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated 再修)
// 语义：窗口 = 末次 suite-rerun-green 写入之后；窗口内 rerun 0 条 ⇒ 证成红全是 OOM/incomplete
//       （每条 suite-end ok:false 都等到同 task 的 suite-incomplete）⇒ exit 0；rerun 非 0 ⇒ 没有
//       rerun-green 且状态全部已知（rerun-red / rerun-not-evaluated）⇒ exit 0；否则 exit 1。
// ⛔ 条件不点名任何文件：「当前红的是哪一个文件」不再是条件的一部分——旧缺陷正是把实例钉进条件，
//    该文件转绿后条件恒红，而「换了个红文件」与「写手真腐烂」在读数上同形（硬规则 3b）。

// 7 个新组（gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated）共用的合成夹具：
// 五个落地步骤 + rerun + suite-rerun-green 都停在 OLD（>24h ⇒ rate-stopped），窗口内只有一次
// 「suite-end ok:false + suite-incomplete」的 OOM/incomplete 红（无 suite 放行、无 rerun）⇒ 缺席已解释。
// suite-skip 必须在场（expected 词表），但又**不得**成为窗口里的 suite 放行 ⇒ 放在 OLD 之前（OLD_MINUS），
// 它自己那条裁定读到的窗口里仍有 ff@OLD + suite-start@RECENT ⇒ 仍然成立。
const LANDING_STEPS = ["anti-drift-land", "ac-gate", "ff", "dark-axis", "slice-readings-post"];
const DECAYED_LANDING_GROUPS = [...LANDING_STEPS, "rerun", "suite-rerun-green"];
const OLD_MINUS = "2026-08-29T01:47:00.000Z";
const RED_TS = "2026-09-04T12:01:00.000Z";
const RED_TS2 = "2026-09-04T12:01:01.000Z";

function decayedLandingFixture() {
  const dir = tmpDir("idc-decayed-landing-");
  const rows = [];
  for (const s of ["merge-develop", "anti-drift", "typecheck", "scoped-gate", "doc-check", "ac-precheck", "suite-start"]) {
    rows.push(stepRec(s, RECENT));
  }
  rows.push({ ...stepRec("suite-end", RED_TS), ok: false, reason: "suite red" });
  rows.push({ ...stepRec("suite-incomplete", RED_TS2), ok: false, reason: "oom-killed (2)" });
  rows.push(stepRec("suite-skip", OLD_MINUS));
  for (const g of DECAYED_LANDING_GROUPS) rows.push(stepRec(g, OLD));
  writeCarrier(dir, "fan-in-step-trace.jsonl", rows);
  return dir;
}

test("suite-rerun-green 触发式控制 ① — 末次写入之后最新的 rerun 是 rerun-red（点名任意文件）⇒ explained-absent", () => {
  const dir = tmpDir("idc-rerun-green-red-");
  // ⚠️ 随机一个文件名：换成哪个文件都不影响裁定（这正是修法要证明的东西）。
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows({
    lastRerunState: "rerun-red", lastRerunFiles: ["plugin/test/whatever-is-red-today.test.mjs"],
  }));
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(res.decayed.filter((d) => d.kind === "rate-stopped"), [], "a persistent baseline red explains the absence regardless of WHICH file");
  const a = res.adjudicated.find((x) => x.group === "suite-rerun-green");
  assert.ok(a, "suite-rerun-green must be in adjudicated[]");
  assert.equal(a.state, "explained-absent");
  assert.equal(a.condition.exitCode, 0);
  assert.equal(res.adjudicated.length, 8);
});

test("suite-rerun-green 触发式控制 ② — rerun-not-evaluated（第三态）⇒ explained-absent（⛔ 不压成布尔）", () => {
  const dir = tmpDir("idc-rerun-green-nev-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows({ lastRerunState: "rerun-not-evaluated" }));
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(res.decayed.filter((d) => d.kind === "rate-stopped"), [], "not-evaluated is not 'the cause is gone'");
  const a = res.adjudicated.find((x) => x.group === "suite-rerun-green");
  assert.ok(a, "suite-rerun-green must stay in adjudicated[]");
  assert.equal(a.state, "explained-absent");
  assert.equal(a.condition.exitCode, 0, "the producer's explicit third state must satisfy the condition");
  assert.equal(res.adjudicated.length, 8);
});

test("suite-rerun-green 触发式控制 ③ — 末次写入之后出现 rerun-green ⇒ 绿分支发生了却没写出本组 ⇒ decayed[]", () => {
  const dir = tmpDir("idc-rerun-green-hit-");
  // ⚠️ 文件仍被点名：唯一让解释失效的是 `rerun-green` 这个状态本身（不是「不再点名」）。
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows({ lastRerunState: "rerun-green", lastRerunFiles: [ANY_RERUN_FILE] }));
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  const stopped = res.decayed.filter((d) => d.kind === "rate-stopped").map((d) => d.group);
  assert.deepEqual(stopped, ["suite-rerun-green"], "a green rerun removes the conditional-on-input explanation");
  assert.match(res.decayed.find((d) => d.group === "suite-rerun-green").detail, /condition command did not hold/);
  assert.equal(res.adjudicated.length, 7, "the other seven adjudications still hold");
});

test("suite-rerun-green 触发式控制 ④ — 窗口内 rerun 0 条 + 红全是 OOM/incomplete ⇒ explained-absent", () => {
  const dir = decayedLandingFixture();
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(res.decayed.filter((d) => d.kind === "rate-stopped"), [], "OOM/incomplete red explains the absence without any rerun");
  const a = res.adjudicated.find((x) => x.group === "suite-rerun-green");
  assert.ok(a, "suite-rerun-green must be in adjudicated[]");
  assert.equal(a.state, "explained-absent");
  assert.equal(a.condition.exitCode, 0, "rerun unreachable (OOM/incomplete) ⇒ rerun-green unreachable");
});

test("suite-rerun-green 触发式控制 ⑤ — rerun 的 state 缺失/未知 ⇒ 条件不成立（未知态不豁免）", () => {
  for (const [prefix, patch] of [
    ["idc-rerun-green-nostate-", { omitRerunState: true }],
    ["idc-rerun-green-unknown-", { lastRerunState: "rerun-mystery" }],
    ["idc-rerun-green-null-", { lastRerunState: null }],
  ]) {
    const dir = tmpDir(prefix);
    writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows(patch));
    const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
    const stopped = res.decayed.filter((d) => d.kind === "rate-stopped").map((d) => d.group);
    assert.deepEqual(stopped, ["suite-rerun-green"], `${prefix}: an unrecognized state must fail closed to 'report decay'`);
    assert.equal(res.adjudicated.length, 7, `${prefix}: the other seven adjudications still hold`);
  }
});

test("suite-rerun-green 触发式控制 ⑥ — 生产的 condition.cmd 不含任何具体文件名（原 :699 断言反转）", () => {
  const cmd = MANIFEST[0].adjudicated.find((a) => a.group === "suite-rerun-green").conditionCmd;
  assert.doesNotMatch(cmd, /task-granularity-advice\.test\.mjs/, "the expired instance must not be part of the condition");
  assert.doesNotMatch(cmd, /\.test\.mjs/, "no concrete file name at all: the condition must be trigger-driven");
  // 条件读的是【触发输入本身】（rerun 的可达性：rerun 0 条读 OOM/incomplete、非 0 读三态），
  // 不是「本组多久没写」的二次包装。
  assert.match(cmd, /suite-rerun-green/, "the window start must be this group's own last write");
  assert.match(cmd, /rerun-red/, "a known non-green state must be an accepted window member");
  assert.match(cmd, /rerun-not-evaluated/, "the producer's third state must be an accepted window member");
  assert.match(cmd, /suite-incomplete/, "when rerun is unreachable the condition must read the OOM/incomplete input");
});

// ── 6 条新裁定 + suite-rerun-green 条件重写（gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated）─
// 五个落地步骤（anti-drift-land / ac-gate / ff / dark-axis / slice-readings-post）共用第一类条件：
//   窗口 = 该组末次写入之后；≥1 次落地尝试（merge-develop/suite-start）且无 suite 放行 ⇒ exit 0；
//   零尝试 / 有放行而本组没写 ⇒ exit 1。rerun 用第二类条件（每条 suite-end ok:false 都伴随
//   suite-incomplete）；suite-rerun-green 重写为读 rerun 的可达性。⛔ 全部读触发输入，不是「多久没写」。

test("生产 MANIFEST — 7 个新组全部 explained-absent，count/lastWrite 照出（⛔ 不消失）", () => {
  const dir = decayedLandingFixture();
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(res.decayed.filter((d) => d.kind === "rate-stopped"), [], "no rate-stopped group may survive the seven adjudications");
  const adj = Object.fromEntries(res.adjudicated.map((a) => [a.group, a]));
  for (const g of DECAYED_LANDING_GROUPS) {
    const a = adj[g];
    assert.ok(a, `${g} must be in adjudicated[]`);
    assert.equal(a.kind, "conditional-on-input", `${g} is condition-gated, not a permanent exemption`);
    assert.equal(a.state, "explained-absent", `${g}: the declared condition must be a real executable reading`);
    assert.equal(a.condition.exitCode, 0, `${g}: condition must hold on the OOM/incomplete window`);
    assert.ok(a.count > 0 && a.lastWriteMs === Date.parse(OLD), `${g} keeps its real reading (count/lastWrite)`);
  }
});

test("第一类 负控制 ② — 窗口内一次 suite 放行而落地步骤没写 ⇒ exit 1 回 decayed[]", () => {
  const dir = tmpDir("idc-landing-release-");
  const rows = [];
  for (const s of ["merge-develop", "anti-drift", "typecheck", "scoped-gate", "doc-check", "ac-precheck", "suite-start"]) {
    rows.push(stepRec(s, RECENT));
  }
  rows.push({ ...stepRec("suite-end", RED_TS), ok: true }); // 一次 suite 放行（绿）
  rows.push(stepRec("suite-skip", OLD_MINUS));
  for (const g of LANDING_STEPS) rows.push(stepRec(g, OLD));
  writeCarrier(dir, "fan-in-step-trace.jsonl", rows);
  assert.equal(runCondition(landingStepConditionCmd("anti-drift-land"), dir).status, 1, "a suite release without the landing step writing is writer rot");
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  const stopped = res.decayed.filter((d) => d.kind === "rate-stopped").map((d) => d.group).sort();
  assert.deepEqual(stopped, [...LANDING_STEPS].sort(), "all five landing steps come back to decayed[] under a release");
  assert.match(res.decayed.find((d) => d.group === "anti-drift-land").detail, /condition command did not hold \(exit 1\)/);
});

test("第一类 负控制 ③ — 窗口内零落地尝试 ⇒ exit 1（loop 死不是已解释）", () => {
  const dir = tmpDir("idc-landing-noattempt-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", [
    stepRec("anti-drift-land", OLD),
    stepRec("typecheck", RECENT), // 一个伴生对照（仍在写），但没有 merge-develop/suite-start
  ]);
  assert.equal(runCondition(landingStepConditionCmd("anti-drift-land"), dir).status, 1, "zero landing attempts cannot explain the absence (a vacuous truth is not a measurement)");
});

test("rerun 负控制 ④ — 一条无 suite-incomplete 的普通红而 rerun 没写 ⇒ exit 1", () => {
  const dir = tmpDir("idc-rerun-normalred-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", [
    stepRec("rerun", OLD),
    stepRec("merge-develop", RECENT),
    stepRec("suite-start", RECENT),
    { ...stepRec("suite-end", RED_TS), ok: false, reason: "suite red" }, // 普通红，无 suite-incomplete
  ]);
  assert.equal(runCondition(RERUN_UNREACHABLE_CONDITION_CMD, dir).status, 1, "a normal red without suite-incomplete means rerun was reachable but did not write");
  // suite-rerun-green 的 rerun==0 分支读到同一条普通红 ⇒ 同样 fail（两者的可达性判据一致）。
  const dir2 = tmpDir("idc-srg-normalred-");
  writeCarrier(dir2, "fan-in-step-trace.jsonl", [
    stepRec("suite-rerun-green", OLD),
    stepRec("merge-develop", RECENT),
    stepRec("suite-start", RECENT),
    { ...stepRec("suite-end", RED_TS), ok: false, reason: "suite red" },
  ]);
  assert.equal(runCondition(SUITE_RERUN_GREEN_CONDITION_CMD, dir2).status, 1, "suite-rerun-green must fail too: a normal red makes rerun reachable");
});

test("suite-rerun-green 负控制 ⑤ — 窗口内一条 rerun-green 而无本组 ⇒ exit 1", () => {
  const dir = tmpDir("idc-srg-rerungreen-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", [
    stepRec("suite-rerun-green", OLD),
    stepRec("merge-develop", RECENT),
    { event: "step-end", step: "rerun", task: "gap-x", runId: "wk-prod-1", ts: RECENT, epoch: epochOf(RECENT), exit: 0, ok: true, state: "rerun-green", files: [ANY_RERUN_FILE] },
  ]);
  assert.equal(runCondition(SUITE_RERUN_GREEN_CONDITION_CMD, dir).status, 1, "a green rerun with no suite-rerun-green is writer rot");
});

test("6 条新裁定 + suite-rerun-green — MANIFEST 声明完整（组名唯一、条件可执行、reason 不点名文件实例）", () => {
  const groups = MANIFEST[0].adjudicated.map((a) => a.group);
  for (const g of DECAYED_LANDING_GROUPS) {
    assert.ok(groups.includes(g), `${g} must be declared`);
    assert.equal(groups.filter((x) => x === g).length, 1, `${g} must be declared exactly once`);
  }
  const srg = MANIFEST[0].adjudicated.find((a) => a.group === "suite-rerun-green");
  assert.equal(srg.conditionCmd, SUITE_RERUN_GREEN_CONDITION_CMD, "the fixed condition is the exported constant, not an inline copy");
  assert.doesNotMatch(srg.reason, /full-suite-runner-cgroup/, "the reason is the mechanism itself, not the current red-file instance");
  assert.match(srg.reason, /可达性/, "the reason states the trigger (rerun reachability)");
  for (const g of LANDING_STEPS) {
    const a = MANIFEST[0].adjudicated.find((x) => x.group === g);
    assert.equal(a.conditionCmd, landingStepConditionCmd(g), `${g} uses the shared first-class landing-step condition`);
  }
  const rerun = MANIFEST[0].adjudicated.find((a) => a.group === "rerun");
  assert.equal(rerun.conditionCmd, RERUN_UNREACHABLE_CONDITION_CMD);
});

test("CLI --json — 裁定在机器面上：decayedCount 不含它们，adjudicated[] 独立可见", () => {
  const dir = tmpDir("idc-adj-json-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", manifestFixtureRows());
  const r = runChecker(dir, ["--json"]);
  assert.equal(r.status, 0, `adjudicated-only ⇒ no decay ⇒ exit 0: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  // ⛔ 已裁定 ≠ 载体健康：`ok`/`decayedCount` 的语义只是「没有 decay」，不是「这些分组没有缺席」。
  // 本用例因此只断言这两条读数，**不**把 healthyCount 拿来当健康声明（改它的语义要触碰
  // quality-gate-driver 的读数面，不属本任务 Touches）；8 条裁定各自带 count/lastWrite 独立可见。
  assert.equal(out.decayedCount, 0);
  assert.equal(out.adjudicatedCount, 8);
  const ft = out.carriers.find((c) => c.file === "fan-in-step-trace.jsonl");
  assert.deepEqual(ft.decayed, []);
  assert.equal(ft.adjudicated.length, 8);
  assert.deepEqual(ft.adjudicated.map((a) => a.group).sort(), [...ADJUDICATED_GROUPS].sort());
  assert.ok(ft.adjudicated.every((a) => a.reviewAfter === FUTURE || typeof a.reviewAfter === "string"));
  assert.ok(ft.adjudicated.every((a) => a.count > 0 && typeof a.lastWrite === "string"));
  for (const g of EXPLAINED_ABSENT_GROUPS) {
    const a = ft.adjudicated.find((x) => x.group === g);
    assert.equal(a.state, "explained-absent");
    assert.equal(a.condition.exitCode, 0);
  }

  const human = runChecker(dir);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /INSTRUMENT-ADJUDICATED: \.quay\/fan-in-step-trace\.jsonl — 8 group\(s\) adjudicated \(NOT counted as decay\)/);
  assert.match(human.stdout, /adjudicated: suite-rerun-green — explained-absent/);
  assert.match(human.stdout, /adjudicated: suite-skip — explained-absent/);
  assert.match(human.stdout, /8 adjudicated \(not decay\)/);
});


// ── 未覆盖 ≠ 健康（AC3）─────────────────────────────────────────────────────────────────────────────

test("uncovered — measure-history 列入且不计入健康载体数（⛔ 未检查与检查过且干净不同形）", () => {
  const dir = tmpDir("idc-uncovered-");
  // 一个健康的已登记载体（全 true），一个声明的未覆盖载体，一个「带 evaluated 但无描述符」的载体。
  writeCarrier(dir, "arch-coverage-history.jsonl", [
    coverageRec("2026-10-20T07:02:50.500Z", true),
    coverageRec("2026-10-21T07:02:50.500Z", true),
  ]);
  writeCarrier(dir, "measure-history.jsonl", [{ round: 1, runAt: RECENT, file: "x.test.mjs", durationMs: 1 }]);
  writeCarrier(dir, "some-new-eval-carrier.jsonl", [{ ts: RECENT, evaluated: true }]);
  const out = analyzeAll(dir, { staleSeconds: DEFAULT_STALE_SECONDS });
  const files = out.uncovered.map((u) => u.file);
  assert.ok(files.includes("measure-history.jsonl"), `measure-history must be listed as uncovered; got ${files.join(",")}`);
  const mh = out.uncovered.find((u) => u.file === "measure-history.jsonl");
  assert.equal(mh.reason, "declared-uncovered");
  assert.equal(mh.present, true);
  const discovered = out.uncovered.find((u) => u.file === "some-new-eval-carrier.jsonl");
  assert.ok(discovered, "a carrier carrying `evaluated` but lacking a descriptor must be discovered");
  assert.equal(discovered.reason, "evaluated-but-undescribed");
  assert.equal(out.uncoveredCount, 2);
  // 只有 arch-coverage-history 是「已登记 + 可评估 + 无腐烂」；uncovered 两个都不在健康计数里。
  assert.equal(out.healthyCount, 1);
});

test("uncovered — --carrier 聚焦查询不扫全目录（覆盖面不是它的读数）", () => {
  const dir = tmpDir("idc-uncovered-focus-");
  writeCarrier(dir, "fan-in-lock-events.jsonl", [lockRec("acquire", RECENT), lockRec("release", RECENT)]);
  writeCarrier(dir, "measure-history.jsonl", [{ round: 1 }]);
  const out = analyzeAll(dir, { staleSeconds: DEFAULT_STALE_SECONDS, carrier: "fan-in-lock-events.jsonl" });
  assert.equal(out.uncoveredCount, 0);
});

// ── AC4：扩展点 —— 只注册一个合成描述符即可检查新载体（⛔ 不改检测器逻辑）──────────────────────────

test("AC4 — 注册一个合成描述符 ⇒ 新载体被检查；不注册 ⇒ 同一断言失败（负对照）", () => {
  const dir = tmpDir("idc-ac4-");
  writeCarrier(dir, "synthetic-evaluated-carrier.jsonl", [
    { ts: "2026-10-20T00:00:00Z", evaluated: false },
    { ts: "2026-10-21T00:00:00Z", evaluated: false },
  ]);
  const synthetic = { file: "synthetic-evaluated-carrier.jsonl", evaluatedField: "evaluated", note: "AC4 synthetic descriptor" };

  const registered = analyzeAll(dir, { staleSeconds: DEFAULT_STALE_SECONDS }, [synthetic]);
  assert.equal(registered.carriers.length, 1);
  assert.equal(registered.carriers[0].file, "synthetic-evaluated-carrier.jsonl");
  assert.equal(registered.carriers[0].contentDark.state, "dark", "the descriptor alone makes the new carrier analysable");
  assert.equal(registered.decayedCount, 1);

  // 负对照：同一份数据、同一断言，不注册 ⇒ 载体根本不被检查（carriers 为空）。
  const unregistered = analyzeAll(dir, { staleSeconds: DEFAULT_STALE_SECONDS }, []);
  assert.equal(unregistered.carriers.length, 0);
  assert.equal(unregistered.carriers.find((c) => c.file === "synthetic-evaluated-carrier.jsonl"), undefined);
  assert.equal(unregistered.decayedCount, 0);
});

test("CLI --json — 形态 C/D 与 uncovered 都在机器面上（healthyCount ≠ 全目录）", () => {
  const dir = tmpDir("idc-cli-json-new-");
  writeCarrier(dir, "arch-cycle-history.jsonl", [
    cycleRec("2026-10-20T00:00:00Z", false),
    cycleRec("2026-10-21T00:00:00Z", false),
  ]);
  writeCarrier(dir, "measure-history.jsonl", [{ round: 1 }]);
  const r = runChecker(dir, ["--json"]);
  assert.equal(r.status, 1, `content-dark is decay (exit 1): ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const cycle = out.carriers.find((c) => c.file === "arch-cycle-history.jsonl");
  assert.equal(cycle.contentDark.state, "dark");
  assert.equal(cycle.staleEvaluated.state, "not-evaluated"); // no scopes in the fixture ⇒ cannot tell, not "fresh"
  assert.equal(out.uncoveredCount, 1);
  assert.equal(out.uncovered[0].file, "measure-history.jsonl");
  assert.equal(out.healthyCount, 0, "the uncovered carrier must not be counted healthy");
});

// ── 第 12 条裁定：baseline-red-exempt（**主路径**的 A/B 豁免出口）───────────────────────────────────
// (gap-instrument-decay-baseline-red-exempt-unadjudicated；
//  gap-instrument-decay-baseline-red-exempt-condition-stale-proxy 修正过期代理)
// 写手 worker-fan-in.ts:3482-3487：主路径的既存红等价 A/B（runBaselineEquivalence）判出 exempt 时写本组。
// 判据 compareFailureSignatures（:1420-1446）：exempt ⇔ task 红集 ⊆ baseline 红集 ⇒ 本组触发是「窗口内
// 至少一条 A/B 判 exempt」，与 baseline 红集是否为空无关（baseline 非空 + added>0 时 exempt 同样不可达）。
//
// ⚠️ 近名陷阱（承重）：恢复阶梯在 :3379 调的是**同一个** runBaselineEquivalence ⇒ 它也会写一条
//    `baseline-red` 步，但那条 A/B 的收尾是 `suite-recovery-baseline-exempt`（另一组、另一条路径）。
//    条件必须把它认作「已收尾」，⛔ 不得把它读成「主路径豁免未落痕」——否则恢复阶梯每跑一次，
//    本条裁定就会误报主路径写手腐烂。
// ⛔ 另有两条空转陷阱：(a) 窗口内一次 A/B 都没有不得当作解释；(b) 「本组多久没写」不是条件。
// ⛔ 「baselineFiles===0」不再是条件的一部分——它是「baseline 为空 ⇒ exempt 不可达」的特例代理。

const BRE_OLD = "2026-09-03T00:00:00.000Z"; // baseline-red-exempt 的末次写入（>24h 早于 RECENT）
const BRE_CLOSURE = "2026-09-04T12:01:00.000Z"; // 恢复阶梯收尾（紧随 RECENT 那条 A/B 之后）

/** baseline-red-exempt 命中 Shape B（末次写入 BRE_OLD），并带一个可变的「窗口内 A/B」形态。 */
function baselineRedExemptFixture({
  windowAbr = "hard-red-zero-baseline", // 窗口内 A/B 的形态（见下面的 switch）
  withLastWrite = true,
} = {}) {
  const dir = tmpDir("idc-bre-");
  const rows = [];
  for (const s of COMPANION_STEPS) rows.push(stepRec(s, RECENT));
  for (const s of SUITE_STEPS) rows.push(stepRec(s, RECENT));
  if (withLastWrite) rows.push(stepRec("baseline-red-exempt", BRE_OLD));
  // 窗口 = 末次 baseline-red-exempt 之后。A/B 放在 RECENT（与生产形态一致：窗口里有真 A/B）。
  const ab = (extra) => ({ ...stepRec("baseline-red", RECENT), task: "gap-window", ...extra });
  switch (windowAbr) {
    case "hard-red-zero-baseline":
      rows.push(ab({ verdict: "hard-red", baselineFiles: 0, taskFiles: 2 }));
      break;
    case "exempt-recovery-closure":
      // 恢复阶梯的 exempt：收尾是 suite-recovery-baseline-exempt（⛔ 不是本组）——必须被认作已收尾。
      rows.push(ab({ verdict: "exempt", baselineFiles: 0, taskFiles: 2 }));
      rows.push({ ...stepRec("suite-recovery-baseline-exempt", BRE_CLOSURE), task: "gap-window" });
      break;
    case "exempt-unclosed":
      rows.push(ab({ verdict: "exempt", baselineFiles: 0, taskFiles: 2 }));
      break;
    case "baseline-nonzero":
      rows.push(ab({ verdict: "hard-red", baselineFiles: 2, taskFiles: 2 }));
      break;
    case "baseline-missing":
      rows.push(ab({ verdict: "not-evaluated" }));
      break;
    case "omit":
      break; // 窗口内零 A/B（空转真值陷阱）
    default:
      throw new Error(`unknown windowAbr ${windowAbr}`);
  }
  writeCarrier(dir, "fan-in-step-trace.jsonl", rows);
  return dir;
}

test("生产 MANIFEST 第 12 条 — baseline-red-exempt explained-absent，count/lastWrite 照出（⛔ 不消失）", () => {
  const dir = baselineRedExemptFixture();
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), [], "the declared absence must be explained, not re-reported as rot");
  const a = res.adjudicated.find((x) => x.group === "baseline-red-exempt");
  assert.ok(a, "baseline-red-exempt must be in adjudicated[] — an adjudication is not a disappearance");
  assert.equal(a.kind, "conditional-on-input");
  assert.equal(a.state, "explained-absent");
  assert.equal(a.condition.exitCode, 0, "the structural reason must be a real executable reading");
  assert.ok(a.count > 0 && a.lastWriteMs === Date.parse(BRE_OLD), "count / lastWrite are preserved verbatim");
  assert.ok(Date.parse(a.reviewAfter) > NOW_MS, "reviewAfter must be unexpired");
  assert.ok(a.reason.length > 0 && /baseline/.test(a.reason), "the reason must name the input (baseline red set)");
});

test("生产 MANIFEST 第 12 条 正控制（近名陷阱）— 恢复阶梯的 exempt A/B 由 suite-recovery-baseline-exempt 收尾 ⇒ 仍 explained-absent", () => {
  const dir = baselineRedExemptFixture({ windowAbr: "exempt-recovery-closure" });
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), [],
    "a recovery-ladder exemption is a CLOSED main-path-shaped A/B: treating it as rot would fire on every recovery ladder run");
  assert.equal(res.adjudicated.find((x) => x.group === "baseline-red-exempt").condition.exitCode, 0);
});

test("生产 MANIFEST 第 12 条 负控制 ① — exempt A/B 无任何收尾 ⇒ 主路径写手腐烂 ⇒ 回到 decayed[]", () => {
  const dir = baselineRedExemptFixture({ windowAbr: "exempt-unclosed" });
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), ["baseline-red-exempt"],
    "an exempt verdict with no baseline-red-exempt (and no recovery closure) is exactly the writer rot this declares away");
  assert.match(res.decayed.find((d) => d.group === "baseline-red-exempt").detail, /condition command did not hold \(exit 1\)/);
  assert.equal(res.adjudicated.length, 0, "nothing is exempted while the trigger input says otherwise");
});

test("生产 MANIFEST 第 12 条 负控制 ② — 窗口内零 A/B ⇒ 空转真值不得当解释 ⇒ 回到 decayed[]", () => {
  const dir = baselineRedExemptFixture({ windowAbr: "omit" });
  assert.equal(runCondition(BASELINE_RED_EXEMPT_TRIGGER_CMD, dir).status, 1,
    "zero A/B in the window cannot explain anything (a vacuous truth is not a measurement)");
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), ["baseline-red-exempt"]);
});

test("生产 MANIFEST 第 12 条 正控制 ⑤ — 窗口内 A/B 全 hard-red 但 baselineFiles 非 0（如 =2）⇒ exit 0（baseline 非空不再误报）", () => {
  const dir = baselineRedExemptFixture({ windowAbr: "baseline-nonzero" });
  assert.equal(runCondition(BASELINE_RED_EXEMPT_TRIGGER_CMD, dir).status, 0,
    "baselineFiles!==0 is NOT a proxy for exempt-reachability: hard-red + non-empty baseline keeps the group absent");
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), [],
    "the absence is explained by 'no A/B judged exempt in the window', regardless of baseline emptiness");
  assert.equal(res.adjudicated.find((x) => x.group === "baseline-red-exempt").condition.exitCode, 0);
});

test("生产 MANIFEST 第 12 条 负控制 ④ — 窗口内 A/B 缺 baselineFiles（读不懂）⇒ fail-closed 回到 decayed[]", () => {
  const dir = baselineRedExemptFixture({ windowAbr: "baseline-missing" });
  assert.equal(runCondition(BASELINE_RED_EXEMPT_TRIGGER_CMD, dir).status, 1,
    "missing reading ≠ zero (硬规则 6/3b): 'not evaluated' must never satisfy the condition");
  const res = analyzeCarrier(dir, MANIFEST[0], DEFAULT_STALE_SECONDS, NOW_MS);
  assert.deepEqual(rateStoppedGroups(res), ["baseline-red-exempt"]);
});

test("第 12 条 条件命令 — 载体缺失 / 本组从未写过 ⇒ exit 1（⛔ 不是静默豁免）", () => {
  const empty = tmpDir("idc-bre-empty-");
  writeCarrier(empty, "fan-in-step-trace.jsonl", []);
  assert.equal(runCondition(BASELINE_RED_EXEMPT_TRIGGER_CMD, empty).status, 1, "empty carrier ⇒ nothing to explain ⇒ decay");

  const noHistory = baselineRedExemptFixture({ withLastWrite: false });
  assert.equal(runCondition(BASELINE_RED_EXEMPT_TRIGGER_CMD, noHistory).status, 1,
    "no baseline-red-exempt history ⇒ no window anchor ⇒ cannot explain ⇒ decay");
});

test("第 12 条 MANIFEST 声明 — 与 suite-recovery-baseline-exempt 是**两条**独立裁定（近名陷阱）", () => {
  const groups = MANIFEST[0].adjudicated.map((a) => a.group);
  assert.ok(groups.includes("baseline-red-exempt"), "the main-path exit must be declared");
  assert.ok(groups.includes("suite-recovery-baseline-exempt"), "the recovery-ladder exit keeps its own declaration");
  const bre = MANIFEST[0].adjudicated.find((a) => a.group === "baseline-red-exempt");
  const sre = MANIFEST[0].adjudicated.find((a) => a.group === "suite-recovery-baseline-exempt");
  assert.notEqual(bre.conditionCmd, sre.conditionCmd, "two different writers/paths ⇒ two different trigger readings");
  assert.equal(bre.kind, "conditional-on-input");
  assert.notEqual(bre.reviewAfter, undefined);
  assert.ok(bre.reason.includes("⊆"), "the reason states the set-inclusion criterion (exempt ⇔ task red ⊆ baseline red)");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 形状 B 的第三态：载体级静默期（gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window）
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 缺陷（受控重放，真实载体）：Shape B 的参照量 `freshest` 由同一个载体的写手产生 ⇒ 整个管线停摆时
// 它跟着一起停。恢复轮写下第一条记录时 `freshest` 一次跳过 24h+，静默前**仍然新鲜**的分组同时越线
// ⇒ 前一次落地的一批收尾步被读成「五个写手同时腐烂」。修法不是把它们豁免掉，而是给第三态：
//   静默开始时该组还新鲜（from − lastWrite ≤ staleSeconds）
//   且 静默结束 → 判定时刻的**墙钟**时间 < staleSeconds
//   ⇒ 成因与「整个管线停摆」不可区分 ⇒ idleWindowExplained[]（不计 decayed，也不计 healthy）。
// ⛔ 自过期：恢复期按墙钟写满 staleSeconds ⇒ 自动回到 decayed[]（不是永久豁免）。
// ⛔ 负控制：某组停写而载体时间轴上没有 ≥staleSeconds 的间隔 ⇒ 照旧 rate-stopped（不得弄瞎）。

// 载体级静默：10-20T06:00 → 10-21T07:00（25h ≥ 24h）。stopped 组的末次写入在其前 1h（仍然新鲜）。
const IDLE_SILENCE_FROM = "2026-10-20T06:00:00.000Z";
const IDLE_SILENCE_TO = "2026-10-21T07:00:00.000Z";
const IDLE_GROUP_LAST = "2026-10-20T05:00:00.000Z";
const IDLE_NOW = "2026-10-21T08:00:00.000Z"; // 恢复期 1h（< 24h）
const IDLE_NOW_ALMOST_EXPIRED = "2026-10-22T06:59:59.000Z"; // 恢复期 24h − 1s
const IDLE_NOW_EXPIRED = "2026-10-22T07:00:00.000Z"; // 恢复期 24h（= staleSeconds ⇒ 自过期）

/** 恢复轮：静默结束后载体继续写（使 freshest 越过 stopped 组 24h 以上）。
 *  ⚠️ 静默前后写入 MANIFEST 的**全部 expected 分组**：否则 Shape A 会给缺席的分组报 never-wrote，
 *  把 `decayed[]` 弄脏成一个与本用例无关的读数（判据就不能取假成「第三态生效」了）。 */
function idleWindowRows() {
  const rows = [stepRec("stopped-group", IDLE_GROUP_LAST)];
  const expected = [...COMPANION_STEPS, ...SUITE_STEPS];
  for (const ts of [IDLE_SILENCE_FROM, IDLE_SILENCE_TO, "2026-10-21T07:30:00.000Z"]) {
    for (const g of expected) rows.push(stepRec(g, ts));
  }
  return rows;
}

function idleWindowFixture() {
  const dir = tmpDir("idc-idle-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", idleWindowRows());
  return dir;
}

/** 第三态的判定只需要一个 Shape B 载体；expected 留空 ⇒ 读数里只剩 rate-stopped 这一族。 */
function idleSpec(adjudicated) {
  return {
    file: "fan-in-step-trace.jsonl", groupBy: "step", expected: [], shapeB: true, note: "",
    ...(adjudicated !== undefined ? { adjudicated } : {}),
  };
}

test("AC2/第三态 — 静默开始时仍新鲜的分组 ⇒ idleWindowExplained[]（不计 decayed，也不计 healthy）", () => {
  const dir = idleWindowFixture();
  const spec = idleSpec();
  const res = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, Date.parse(IDLE_NOW));
  // ⛔ 先证它**确实**命中 Shape B（否则这个用例什么都没测到）。
  const gapH = (Date.parse(IDLE_SILENCE_TO) - Date.parse(IDLE_GROUP_LAST)) / 3_600_000;
  assert.ok(gapH > 24, `fixture precondition: the group is ${gapH}h behind freshest (> 24h)`);
  assert.deepEqual(res.decayed, [], "the stop must NOT be reported as decay while the idle window is open");
  assert.deepEqual(res.idleWindowExplained.map((e) => e.group), ["stopped-group"]);
  const e = res.idleWindowExplained[0];
  // 成因读数必须可读：哪段静默、多长、恢复期多长（⛔ 不是一句散文）。
  assert.equal(e.idleWindow.from, IDLE_SILENCE_FROM);
  assert.equal(e.idleWindow.to, IDLE_SILENCE_TO);
  assert.equal(e.idleWindow.ms, 25 * 3_600_000);
  assert.equal(e.recoveryMs, 3_600_000, "the recovery window elapsed is measured on the WALL CLOCK, not on the carrier's own freshest");
  assert.equal(e.count, 1, "the real reading travels with the third state");
  assert.equal(e.lastWriteMs, Date.parse(IDLE_GROUP_LAST));
  assert.match(e.reason, /cannot be distinguished from a whole-pipeline stall/);
  assert.match(e.reason, /NOT decay, and NOT healthy/);
  // 载体级静默段本身也是读数（未解释任何分组时同样可见）。
  assert.deepEqual(res.idleWindows.map((w) => w.ms), [25 * 3_600_000]);

  const out = analyzeAll(dir, { staleSeconds: DEFAULT_STALE_SECONDS, nowMs: Date.parse(IDLE_NOW) }, [spec]);
  assert.equal(out.decayedCount, 0);
  assert.equal(out.idleWindowExplainedCount, 1);
  assert.equal(out.healthyCount, 0, "undecidable is NOT healthy (硬规则 3b: the third state has its own value)");
});

test("AC3/负控制 — 一个分组停写、载体时间轴上没有 ≥staleSeconds 的间隔 ⇒ 仍然报 rate-stopped（不得弄瞎）", () => {
  // 同样的「停止」形状，唯一差别：伴生分组**一路在写**，时间轴上最大间隔只有 4h。
  const rows = [];
  for (let h = 0; h <= 28; h += 4) {
    const ts = new Date(Date.parse(IDLE_GROUP_LAST) + h * 3_600_000).toISOString();
    for (const g of [...COMPANION_STEPS, ...SUITE_STEPS]) rows.push(stepRec(g, ts));
  }
  rows.push(stepRec("stopped-group", IDLE_GROUP_LAST));
  const dir = tmpDir("idc-idle-neg-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", rows);
  const nowMs = Date.parse("2026-10-21T09:00:00.000Z");
  const res = analyzeCarrier(dir, idleSpec(), DEFAULT_STALE_SECONDS, nowMs);
  assert.deepEqual(rateStoppedGroups(res), ["stopped-group"],
    "with no carrier-level silence the group's stop is REAL rot — the new criterion must not blind the detector");
  assert.deepEqual(res.idleWindowExplained, []);
  assert.deepEqual(res.idleWindows, [], "no ≥24h gap on the timeline ⇒ no idle window exists");
  assert.equal(res.decayed.find((d) => d.group === "stopped-group").detail, null, "no adjudication is declared for it ⇒ plain decay");

  // 边界：间隔恰好比阈值少 1 秒 ⇒ 不算静默（阈值是真读数，不是恒真/恒假）。
  const from = "2026-10-20T05:00:01.000Z";
  const rows2 = [
    // 该组 04:00 停写 ⇒ 与 freshest 相差 25h（> 阈值），但载体时间轴上没有 ≥24h 的间隔。
    stepRec("stopped-group", "2026-10-20T04:00:00.000Z"),
    stepRec("merge-develop", from),
    stepRec("merge-develop", new Date(Date.parse(from) + DEFAULT_STALE_SECONDS * 1000 - 1000).toISOString()),
  ];
  const dir2 = tmpDir("idc-idle-edge-");
  writeCarrier(dir2, "fan-in-step-trace.jsonl", rows2);
  const res2 = analyzeCarrier(dir2, idleSpec(), DEFAULT_STALE_SECONDS, Date.parse("2026-10-21T04:00:00.000Z"));
  assert.deepEqual(res2.idleWindows, [], "a 23h59m59s gap is not a >=24h silence");
  assert.deepEqual(rateStoppedGroups(res2), ["stopped-group"]);
});

test("AC3/负控制（另一半）— 静默开始时该组**已经**陈旧 ⇒ 静默解释不了它，照旧报腐烂", () => {
  // 同一段 25h 静默，但 stopped 组的末次写入在静默开始前 40h ⇒ 它在我停之前就停了。
  const rows = idleWindowRows();
  rows[0] = stepRec("stopped-group", new Date(Date.parse(IDLE_SILENCE_FROM) - 40 * 3_600_000).toISOString());
  const dir = tmpDir("idc-idle-stale-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", rows);
  const res = analyzeCarrier(dir, idleSpec(), DEFAULT_STALE_SECONDS, Date.parse(IDLE_NOW));
  assert.deepEqual(res.idleWindowExplained, [],
    "a group already stale 40h when the silence began was NOT explained by the silence");
  assert.deepEqual(rateStoppedGroups(res), ["stopped-group"]);
  assert.ok(res.idleWindows.length > 0, "the carrier silence itself is still reported (it just doesn't explain THIS group)");
});

test("AC4/自过期 — 恢复期写满 staleSeconds 而该组仍未写 ⇒ 从 idleWindowExplained[] 回到 decayed[]", () => {
  const dir = idleWindowFixture();
  const spec = idleSpec();
  // 阈值两侧各取一次：差 1 秒仍解释，到点即失效（⛔ 不是永久豁免，也不是「恒解释」）。
  const almost = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, Date.parse(IDLE_NOW_ALMOST_EXPIRED));
  assert.deepEqual(almost.idleWindowExplained.map((e) => e.group), ["stopped-group"],
    "1 second short of the threshold the cause is STILL undecidable");
  assert.equal(almost.decayed.length, 0);

  const expired = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, Date.parse(IDLE_NOW_EXPIRED));
  assert.deepEqual(expired.idleWindowExplained, [], "the third state self-expires at exactly staleSeconds");
  assert.deepEqual(rateStoppedGroups(expired), ["stopped-group"]);

  // 自相矛盾的重放（判定时刻早于载体最新记录）不产生「恢复期 0」的豁免 ⇒ fail-closed 报腐烂。
  const before = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, Date.parse("2026-10-21T06:00:00.000Z"));
  assert.deepEqual(before.idleWindowExplained, [], "a judgement instant older than the carrier's newest record cannot explain anything");
  assert.deepEqual(rateStoppedGroups(before), ["stopped-group"]);
  // 同一份载体、同一个分组、同一条判定：唯一变化量是判定时刻 ⇒ 自过期读的是墙钟（⛔ 不是载体自报的量）。
  assert.equal(fs.readFileSync(path.join(dir, ".quay", "fan-in-step-trace.jsonl"), "utf8"),
    idleWindowRows().map((r) => JSON.stringify(r)).join("\n") + "\n");
});

test("第三态与裁定的先后 — 静默期内先说「分不清」，静默期过后裁定才生效（互不冒充）", () => {
  const dir = idleWindowFixture();
  const spec = idleSpec([
    { group: "stopped-group", kind: "rare-by-design", reason: "only written on a rare exceptional path", reviewAfter: FUTURE },
  ]);
  const during = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, Date.parse(IDLE_NOW));
  assert.deepEqual(during.idleWindowExplained.map((e) => e.group), ["stopped-group"]);
  assert.deepEqual(during.adjudicated, [], "while the silence is undecidable the detector must not assert a specific cause");

  const after = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, Date.parse(IDLE_NOW_EXPIRED));
  assert.deepEqual(after.idleWindowExplained, []);
  assert.deepEqual(after.adjudicated.map((a) => a.group), ["stopped-group"], "past the window the declaration takes over");
  assert.equal(after.decayed.length, 0);
});

// ── 第 13 条：baseline-red / develop-red-set 的 conditional-on-input（AC5）─────────────────────────
// 写手都在 runBaselineEquivalence 内，带 SUITE-INCOMPLETE 标记的红轮在恢复阶梯分支就走掉了、
// 根本调用不到它（A/B 的调用点在 worker-fan-in.ts:4108）⇒ 条件读的是【窗口内红轮的形态】。
const RED_LAST = "2026-10-20T00:00:00.000Z";

/** 红轮时间线：每条 suite-end ok:false 是否都等到同 task 的 suite-incomplete。 */
function suiteRedRows({ redWithoutIncomplete = false } = {}) {
  const rows = [stepRec("baseline-red", RED_LAST), stepRec("develop-red-set", RED_LAST)];
  // 伴生写入（⛔ 每 <24h 一笔：避免造出一段本用例无意测试的载体级静默）。
  for (let h = 2; h <= 30; h += 6) {
    rows.push(stepRec("merge-develop", new Date(Date.parse(RED_LAST) + h * 3_600_000).toISOString()));
  }
  rows.push({ ...stepRec("suite-end", "2026-10-20T02:00:00.000Z"), task: "task-a", ok: false });
  rows.push({ ...stepRec("suite-incomplete", "2026-10-20T02:10:00.000Z"), task: "task-a" });
  rows.push({ ...stepRec("suite-end", "2026-10-20T08:00:00.000Z"), task: redWithoutIncomplete ? "task-b-unnamed" : "task-b", ok: false });
  if (!redWithoutIncomplete) {
    rows.push({ ...stepRec("suite-incomplete", "2026-10-20T08:10:00.000Z"), task: "task-b" });
  }
  return rows;
}

/** 带**生产**那两条裁定的最小描述符（expected 留空：本用例只测裁定，不测 Shape A）。 */
function redSpec() {
  return {
    file: "fan-in-step-trace.jsonl", groupBy: "step", expected: [], shapeB: true, note: "",
    adjudicated: MANIFEST[0].adjudicated.filter((a) => a.group === "baseline-red" || a.group === "develop-red-set"),
  };
}

test("AC5 — baseline-red / develop-red-set 的条件命令：红轮全进恢复阶梯 ⇒ exit 0 ⇒ explained-absent", () => {
  const dir = tmpDir("idc-suite-red-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", suiteRedRows());
  const nowMs = Date.parse("2026-10-21T08:00:00.000Z");
  for (const group of ["baseline-red", "develop-red-set"]) {
    const decl = MANIFEST[0].adjudicated.find((a) => a.group === group);
    assert.ok(decl, `${group} must be declared in the production descriptor`);
    assert.equal(decl.kind, "conditional-on-input");
    assert.equal(runCondition(decl.conditionCmd, dir).status, 0, `${group}: every red in the window went to the recovery ladder`);
  }
  const res = analyzeCarrier(dir, redSpec(), DEFAULT_STALE_SECONDS, nowMs);
  assert.deepEqual(res.decayed.filter((d) => d.kind === "rate-stopped"), []);
  const adj = res.adjudicated.filter((a) => a.group === "baseline-red" || a.group === "develop-red-set");
  assert.equal(adj.length, 2);
  for (const a of adj) {
    assert.equal(a.state, "explained-absent");
    assert.equal(a.condition.exitCode, 0);
    assert.equal(a.count, 1, "the real reading travels with the adjudication");
    assert.equal(a.lastWriteMs, Date.parse(RED_LAST));
  }
});

test("AC5/负控制 — 窗口内一条红没有任何 incomplete（本该走到 A/B）⇒ exit 1 ⇒ 该组仍报 rate-stopped", () => {
  const dir = tmpDir("idc-suite-red-neg-");
  writeCarrier(dir, "fan-in-step-trace.jsonl", suiteRedRows({ redWithoutIncomplete: true }));
  const nowMs = Date.parse("2026-10-21T08:00:00.000Z");
  for (const group of ["baseline-red", "develop-red-set"]) {
    const decl = MANIFEST[0].adjudicated.find((a) => a.group === group);
    assert.equal(runCondition(decl.conditionCmd, dir).status, 1,
      `${group}: a plain red with no suite-incomplete means the A/B path WAS reachable ⇒ the declared cause is gone`);
  }
  const res = analyzeCarrier(dir, redSpec(), DEFAULT_STALE_SECONDS, nowMs);
  const stopped = res.decayed.filter((d) => d.kind === "rate-stopped").map((d) => d.group).sort();
  assert.deepEqual(stopped, ["baseline-red", "develop-red-set"]);
  for (const d of res.decayed) assert.match(d.detail, /condition command did not hold \(exit 1\)/);
});

test("AC5/边界 — 本组从未写过 / 它之后载体一笔都没有 ⇒ exit 1（空转真值不是测量）", () => {
  const noHistory = tmpDir("idc-suite-red-nohist-");
  writeCarrier(noHistory, "fan-in-step-trace.jsonl", [stepRec("merge-develop", "2026-10-20T00:00:00.000Z")]);
  for (const group of ["baseline-red", "develop-red-set"]) {
    const decl = MANIFEST[0].adjudicated.find((a) => a.group === group);
    assert.equal(runCondition(decl.conditionCmd, noHistory).status, 1, `${group}: no window anchor ⇒ cannot explain`);
  }
});

test("AC5 — suite-recovery-exhausted 的 rare-by-design 声明带 reviewAfter（ladder-at-floor 是罕见例外，不是腐烂）", () => {
  const decl = MANIFEST[0].adjudicated.find((a) => a.group === "suite-recovery-exhausted");
  assert.ok(decl, "the exhaustion branch must be declared");
  assert.equal(decl.kind, "rare-by-design");
  assert.equal(decl.conditionCmd, undefined, "rare-by-design carries no condition command");
  assert.ok(Number.isFinite(Date.parse(decl.reviewAfter)), "an adjudication must be expirable");
  assert.ok(Date.parse(decl.reviewAfter) > Date.parse("2026-11-08T00:00:00.000Z"), "reviewAfter must be in the future when filed");
  assert.match(decl.reason, /全历史 1 条|梯|阶梯/);
});

test("第三态 — Shape B 关掉的载体（shapeB:false）不产生静默读数（「不适用」不得伪装成「没有静默」）", () => {
  const dir = idleWindowFixture();
  const spec = { file: "fan-in-step-trace.jsonl", groupBy: "step", shapeB: false, note: "lock-event shaped" };
  const res = analyzeCarrier(dir, spec, DEFAULT_STALE_SECONDS, Date.parse(IDLE_NOW));
  assert.deepEqual(res.idleWindows, []);
  assert.deepEqual(res.idleWindowExplained, []);
  assert.deepEqual(res.decayed, [], "shapeB:false ⇒ shape B is not applied at all");
});

test("CLI --json / --now — 第三态在机器面上：idleWindowExplainedCount 与 decayedCount 分开，且重放可复现", () => {
  const dir = idleWindowFixture();
  const run = (extra) => spawnSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", CHECKER,
    "--root", dir, "--carrier", "fan-in-step-trace.jsonl", "--json", "--no-block", ...extra,
  ], { encoding: "utf8" });

  const open = run(["--now", IDLE_NOW]);
  assert.equal(open.status, 0);
  const openJson = JSON.parse(open.stdout);
  assert.equal(openJson.decayedCount, 0);
  assert.equal(openJson.idleWindowExplainedCount, 1);
  assert.equal(openJson.healthyCount, 0);
  const carrier = openJson.carriers[0];
  assert.deepEqual(carrier.idleWindowExplained.map((e) => e.group), ["stopped-group"]);
  assert.deepEqual(carrier.idleWindowExplained[0].idleWindow, { from: IDLE_SILENCE_FROM, to: IDLE_SILENCE_TO, ms: 25 * 3_600_000 });
  assert.equal(carrier.idleWindows.length, 1);

  // 同一个载体、同一条命令，只把判定时刻推到静默结束后 24h ⇒ 第三态自过期成腐烂（重放可复现）。
  const expired = run(["--now", IDLE_NOW_EXPIRED]);
  const expiredJson = JSON.parse(expired.stdout);
  assert.equal(expiredJson.idleWindowExplainedCount, 0);
  assert.equal(expiredJson.decayedCount, 1);
  assert.deepEqual(expiredJson.carriers[0].decayed.map((d) => d.group), ["stopped-group"]);

  // ⛔ --now 读不懂 ⇒ usage error（⛔ 不是悄悄退回墙钟）。
  const bad = run(["--now", "not-a-date"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--now must be an ISO timestamp/);
});

