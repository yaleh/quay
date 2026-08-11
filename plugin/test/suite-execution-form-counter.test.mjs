// @test-group engine
// suite-execution-form-counter.test.mjs — tasks/gap-suite-execution-rollback-to-main-session-
// not-restored-after-crash.
// OOM 后套件执行形态静默回落：.halt 解除后连续 K 轮 runner=outer（主会话直跑，零 Workflow）没有任何机件
// 切回 workflow。本测试钉住计数器：plugin/scripts/suite-execution-form-counter.ts。
//
// Coverage map (task ACs + Contract):
//   AC2 — 计数器脚本：读 verification-round.jsonl 的 `runner` 字段，数「.halt 解除后连续 K 轮 runner=outer」，
//         >= K 报「回落」信号；伪造 verification-round 注入，断言 0/K 分档。
//   AC3 — 主会话越界检测：连续 K 轮 runner=outer（无 subagent 失败前提）即违规信号（同 AC2 的信号）。
//   Contract measure — `--json` 输出 consecutive_outer_rounds 数字。
//   Contract band — consecutive < K 健康（exit 0）；>= K 报回落（exit 1）。
//   Control — .halt 接管期豁免（halt_present ⇒ 0，不计数）。
//   枚举不布尔 — runner_counts 输出各 runner 值（outer/workflow/missing）的计数，不是单个布尔。
//   缺值=未查 — runner 缺失的套件轮不当作 outer（断，不计入）。
//
// Fixtures are self-contained: 伪造 verification-round.jsonl 行注入，断言 0/K 分档 + .halt 豁免。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isSuiteRound,
  countConsecutiveOuterRounds,
  judgeConsecutiveOuter,
  DEFAULT_K,
} from "../scripts/suite-execution-form-counter.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CLI = join(repoRoot, "plugin", "scripts", "suite-execution-form-counter.ts");

function run(args, opts = {}) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
    ...opts,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `suite-form-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── fixture builders ───────────────────────────────────────────────────────────────────────────────
// 一条套件轮次记录（runner=outer 为默认；workflow 治理期亦由 full-suite-runner 硬编码 outer）。
function suiteRound(round, runner, startedAt = `2026-08-10T${String(round % 24).padStart(2, "0")}:00:00.000Z`) {
  return { round, runner, startedAt, state: "green", scope: "worktree" };
}

// 一条 closure-pass 记录（非套件轮次：无 runner、无 startedAt）——必须被跳过。
function closurePass(round) {
  return { round, at: `2026-08-11T03:2${round % 10}:00.000Z`, suiteGreen: true, closed: ["DIR-001"] };
}

// ── pure function unit tests ───────────────────────────────────────────────────────────────────────

test("isSuiteRound — suite rounds (runner or startedAt) vs closure-pass records", () => {
  assert.equal(isSuiteRound(suiteRound(1, "outer")), true);
  assert.equal(isSuiteRound(suiteRound(2, "workflow")), true);
  assert.equal(isSuiteRound({ round: 3, startedAt: "2026-08-10T00:00:00Z" }), true); // runner 缺失但 startedAt 在
  assert.equal(isSuiteRound(closurePass(7)), false); // closure-pass：无 runner 无 startedAt
  assert.equal(isSuiteRound(null), false);
});

test("countConsecutiveOuterRounds — trailing run of outer rounds, closure records skipped", () => {
  // 旧→新：r1 workflow → r2 outer → r3 closure → r4 outer → r5 outer（最新）
  const records = [
    suiteRound(1, "workflow"),
    suiteRound(2, "outer"),
    closurePass(3),
    suiteRound(4, "outer"),
    suiteRound(5, "outer"),
  ];
  const { consecutive, runnerCounts } = countConsecutiveOuterRounds(records);
  assert.equal(consecutive, 3); // 尾部连续 outer：r5, r4, (r3 closure 跳过), r2 → 3；r1 workflow 断
  assert.deepEqual(runnerCounts, { workflow: 1, outer: 3 });
});

test("countConsecutiveOuterRounds — a workflow round breaks the run", () => {
  const records = [
    suiteRound(1, "outer"),
    suiteRound(2, "workflow"),
    suiteRound(3, "outer"),
    suiteRound(4, "outer"),
  ];
  const { consecutive } = countConsecutiveOuterRounds(records);
  assert.equal(consecutive, 2); // r4, r3; r2 workflow 断
});

test("countConsecutiveOuterRounds — missing runner on a suite round breaks (缺值=未查)", () => {
  const records = [
    suiteRound(1, "outer"),
    { round: 2, startedAt: "2026-08-10T02:00:00.000Z" }, // runner 缺失
    suiteRound(3, "outer"),
  ];
  const { consecutive, runnerCounts } = countConsecutiveOuterRounds(records);
  assert.equal(consecutive, 1); // r3 outer；r2 runner 缺失 ⇒ 断（不能把未分类算 outer）
  assert.deepEqual(runnerCounts, { outer: 2, missing: 1 });
});

test("countConsecutiveOuterRounds — all-outer history counts everything (the field is not yet workflow-aware)", () => {
  const records = Array.from({ length: 5 }, (_, i) => suiteRound(i + 1, "outer"));
  const { consecutive, runnerCounts } = countConsecutiveOuterRounds(records);
  assert.equal(consecutive, 5);
  assert.deepEqual(runnerCounts, { outer: 5 });
});

// ── band judgment (AC2: 0/K 分档) ────────────────────────────────────────────────────────────────

test("judgeConsecutiveOuter — <K healthy, >=K rollback signal", () => {
  assert.equal(judgeConsecutiveOuter(0, 3).band, "healthy");
  assert.equal(judgeConsecutiveOuter(0, 3).signal, false);
  assert.equal(judgeConsecutiveOuter(2, 3).band, "healthy");
  assert.equal(judgeConsecutiveOuter(3, 3).band, "rollback");
  assert.equal(judgeConsecutiveOuter(3, 3).signal, true);
  assert.equal(judgeConsecutiveOuter(3, 3).action, "驱动切回 workflow");
  assert.equal(judgeConsecutiveOuter(6, 3).signal, true);
  assert.equal(DEFAULT_K, 3);
});

// ── CLI end-to-end with injected fixtures (AC2: 0/K 分档 via --verification-round/--halt) ────────

function makeFixtures(builder) {
  const dir = tmp("cli");
  const vr = join(dir, "verification-round.jsonl");
  const halt = join(dir, ".halt");
  const { records, haltText } = builder();
  writeFileSync(vr, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (haltText) writeFileSync(halt, haltText, "utf8");
  return { dir, vr, halt };
}

test("CLI — 0 consecutive outer rounds (workflow last) ⇒ exit 0, band healthy", () => {
  const { dir, vr, halt } = makeFixtures(() => ({
    records: [
      suiteRound(1, "workflow"),
      suiteRound(2, "workflow"),
      suiteRound(3, "outer"),
    ],
    haltText: null,
  }));
  try {
    const res = run(["--root", dir, "--verification-round", vr, "--halt", halt, "--json"]);
    assert.equal(res.status, 0);
    const o = JSON.parse(res.stdout);
    assert.equal(o.consecutive_outer_rounds, 1);
    assert.equal(o.signal, false);
    assert.equal(o.band, "healthy");
    assert.equal(o.runner_counts.workflow, 2);
  } finally {
    cleanup(dir);
  }
});

test("CLI — K consecutive outer rounds ⇒ exit 1, band rollback (AC2/AC3 signal)", () => {
  const { dir, vr, halt } = makeFixtures(() => ({
    records: [
      suiteRound(1, "outer"),
      suiteRound(2, "outer"),
      suiteRound(3, "outer"),
    ],
    haltText: null,
  }));
  try {
    const res = run(["--root", dir, "--verification-round", vr, "--halt", halt, "--json"]);
    assert.equal(res.status, 1);
    const o = JSON.parse(res.stdout);
    assert.equal(o.consecutive_outer_rounds, 3);
    assert.equal(o.signal, true);
    assert.equal(o.band, "rollback");
    assert.match(o.message, /执行形态回落/);
  } finally {
    cleanup(dir);
  }
});

test("CLI — .halt present ⇒ takeover-period exemption, exit 0 (invariant halt_taken_into_account)", () => {
  const { dir, vr, halt } = makeFixtures(() => ({
    records: [
      suiteRound(1, "outer"),
      suiteRound(2, "outer"),
      suiteRound(3, "outer"),
      suiteRound(4, "outer"),
    ],
    haltText: "paused\n",
  }));
  try {
    const res = run(["--root", dir, "--verification-round", vr, "--halt", halt, "--json"]);
    assert.equal(res.status, 0);
    const o = JSON.parse(res.stdout);
    assert.equal(o.consecutive_outer_rounds, 0);
    assert.equal(o.signal, false);
    assert.equal(o.band, "halt-takeover");
    assert.equal(o.halt_present, true);
  } finally {
    cleanup(dir);
  }
});

test("CLI — closure-pass records are skipped, not counted (枚举不布尔: runner_counts reflects suite rounds only)", () => {
  const { dir, vr, halt } = makeFixtures(() => ({
    records: [
      suiteRound(1, "outer"),
      closurePass(2),
      suiteRound(3, "outer"),
      suiteRound(4, "outer"),
    ],
    haltText: null,
  }));
  try {
    const res = run(["--root", dir, "--verification-round", vr, "--halt", halt, "--json"]);
    assert.equal(res.status, 1);
    const o = JSON.parse(res.stdout);
    assert.equal(o.consecutive_outer_rounds, 3); // r4, r3 outer; r2 closure 跳过; r1 outer 也算 → 3
    assert.equal(o.total_records, 4);
    assert.equal(o.suite_rounds, 3);
    assert.deepEqual(o.runner_counts, { outer: 3 });
  } finally {
    cleanup(dir);
  }
});

test("CLI — invalid --k ⇒ exit 2 (usage/environment error)", () => {
  const { dir, vr, halt } = makeFixtures(() => ({
    records: [suiteRound(1, "outer")],
    haltText: null,
  }));
  try {
    const res = run(["--root", dir, "--k", "0", "--verification-round", vr, "--halt", halt]);
    assert.equal(res.status, 2);
  } finally {
    cleanup(dir);
  }
});

test("CLI — missing verification-round file ⇒ 0 consecutive, healthy (cold-start, no false positive)", () => {
  const dir = tmp("empty");
  try {
    const vr = join(dir, "verification-round.jsonl"); // 不存在
    const halt = join(dir, ".halt"); // 不存在
    const res = run(["--root", dir, "--verification-round", vr, "--halt", halt, "--json"]);
    assert.equal(res.status, 0);
    const o = JSON.parse(res.stdout);
    assert.equal(o.consecutive_outer_rounds, 0);
    assert.equal(o.signal, false);
    assert.equal(o.band, "healthy");
    assert.equal(o.total_records, 0);
  } finally {
    cleanup(dir);
  }
});
