#!/usr/bin/env node
// pool-quality-judge.ts — pool 任务质量语义闸的确定性部分（ADR-033，task gap-pool-quality-semantic-gate）
//
// PROBLEM: pool 质量是「需要语义才能产生的值」——机械脚本只能辅助（AC 计数、触发量、Touches 解析），
// 真正判定（前提是否成立、工作是否落地、是否该撤出）必须由带 schema 的 agent() 产出（ADR-033 accepted）。
// nyf-semantic-judge workflow 证明过一次然后丢失（49c0be86 flip 4 done，24min）——三层执行核
// （orchestrator/fast-mode/manager tick-core）都有「检测 workflow 没被调用」的仪器，没有一层有
// 「调用 workflow」的步骤。仪器在测一个从未被规定过的动作。
//
// 处方（本文件 = workflow 的确定性部分，ADR-033: "script 是 workflow 里的确定性部分"）:
//   1. 机械触发（pool > 25 OR 最久未复核 > 48h OR 每 10 轮 verification-round）——触发用机械量;
//   2. 池枚举 + 每任务机械 AC 计数——schema agent 的判定输入（脚本只做算术，判定交给 agent）;
//   3. 判词聚合（ready / needs-work / should-remove / uncertain 的 JS 算术）——值到手后的算术，
//      把 should-remove 映射成「撤出/重定范围」动作（不是进 pool）。
// 判定本体（每任务一个 schema agent 出 {verdict, acCompleteness, premiseSound, evidence,
// recommendation}）在 .claude/workflows/pool-quality-judge.js；本脚本可单独跑机械部分:
//
// Usage:
//   node --no-warnings --experimental-strip-types pool-quality-judge.ts --root <repo> [--plan]
//        # 机械触发评估 + 池枚举 + 每任务机械 AC 计数（JSON）。default mode。
//   node --no-warnings --experimental-strip-types pool-quality-judge.ts --root <repo> --aggregate <verdicts.json>
//        # 对 agent 判词做 JS 算术:分布 + 动作（should-remove → 撤出/重定范围）。exit 0。
//   node --no-warnings --experimental-strip-types pool-quality-judge.ts --root <repo> --demo
//        # 合成一组判词（含 should-remove 案例）跑聚合——演示机制，invoke 证据。
//   node --no-warnings --experimental-strip-types pool-quality-judge.ts --root <repo> --rounds-since <N>
//        # 覆盖"每 10 轮"读数（供测试/手动评估用）。
//   node --no-warnings --experimental-strip-types pool-quality-judge.ts --root <repo> --record-last-round
//        # 写端（B15）:把当前 verification-round 持久化为 lastRound——judge 完成路径的单写者,
//        # 由 .claude/workflows/pool-quality-judge.js 完成路径调用。
//
// Exit: 0 = judged/planned · 2 = usage error.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// 池枚举复用 ready-pool-check 的同一套判定（单源:ready pool = status:ready 减三类非派发类）。
import { analyzeTasks } from "./ready-pool-check.ts";
// AC 计数复用 task-schema 的唯一 box 计数（单源:不再重写 checklist-box 正则）。
import { extractSection, countBoxes } from "./task-schema.ts";

// ── 常量（机械触发阈值）─────────────────────────────────────────────────────────────────────────────
export const POOL_SIZE_TRIGGER = 25; // pool > 25 触发
export const OLDEST_UNREVIEWED_TRIGGER_MS = 48 * 60 * 60 * 1000; // 最久未复核 > 48h
export const ROUNDS_SINCE_LAST_JUDGE_TRIGGER = 10; // 每 10 轮 verification-round
export const VERDICTS = ["ready", "needs-work", "should-remove", "uncertain"] as const;
export type Verdict = (typeof VERDICTS)[number];

// ── 机械触发评估（PURE，可测）────────────────────────────────────────────────────────────────────────

export interface TriggerInput {
  poolCount: number;
  oldestUnreviewedAgeMs: number;
  roundsSinceLastJudge: number;
}

export interface TriggerResult extends TriggerInput {
  fired: boolean;
  reasons: string[];
}

/**
 * 机械触发:pool > 25 OR 最久未复核 > 48h OR 每 10 轮。PURE。
 * 触发用机械量（AC3）——判定用 agent（ADR-033），本函数只回答「该不该跑」。
 */
export function computeTriggers({ poolCount, oldestUnreviewedAgeMs, roundsSinceLastJudge }: TriggerInput): TriggerResult {
  const reasons: string[] = [];
  if (poolCount > POOL_SIZE_TRIGGER) reasons.push(`pool>${POOL_SIZE_TRIGGER}`);
  if (oldestUnreviewedAgeMs > OLDEST_UNREVIEWED_TRIGGER_MS) reasons.push("oldest-unreviewed>48h");
  if (roundsSinceLastJudge >= ROUNDS_SINCE_LAST_JUDGE_TRIGGER) reasons.push("every-10-rounds");
  return {
    poolCount,
    oldestUnreviewedAgeMs,
    roundsSinceLastJudge,
    fired: reasons.length > 0,
    reasons,
  };
}

// ── 每任务机械 AC 计数（PURE，可测）──────────────────────────────────────────────────────────────────

export interface TaskMechanicalInput {
  id: string;
  acChecked: number;
  acTotal: number;
  acCompleteness: "all-checked" | "partial" | "none";
  sections: string[]; // 任务体含哪些工件段（Proposal/Plan/AC/DoD 的形状无关枚举）
  fileAgeMs: number; // 任务文件 mtime 距今（最久未复核的机械代理）
}

/**
 * 从任务体机械算出 agent 判定用的输入:AC box 计数 + 工件段枚举。
 * 不做语义判断——acCompleteness 只按 box 计数分档，真正判定交给 agent。
 * PURE（除 fileAgeMs 由调用方传入）。
 */
export function taskMechanicalInput(id: string, body: string, fileAgeMs: number): TaskMechanicalInput {
  const acSec = extractSection(body, "Acceptance Criteria");
  const boxes = acSec ? countBoxes(acSec) : { checked: 0, total: 0 };
  const acCompleteness = boxes.total === 0 ? "none" : boxes.checked === boxes.total ? "all-checked" : "partial";
  const sections: string[] = [];
  for (const h of ["Proposal", "Plan", "Acceptance Criteria", "Definition of Done"]) {
    if (extractSection(body, h) !== null) sections.push(h);
  }
  return {
    id,
    acChecked: boxes.checked,
    acTotal: boxes.total,
    acCompleteness,
    sections,
    fileAgeMs,
  };
}

// ── 判词聚合（PURE，可测——值到手后的 JS 算术，ADR-033）──────────────────────────────────────────────

export interface VerdictRecord {
  id: string;
  verdict: Verdict;
  acCompleteness: string;
  premiseSound: boolean;
  evidence: string;
  recommendation?: string;
}

export interface Action {
  id: string;
  verdict: Verdict;
  action: string;
  reason: string;
}

export interface AggregateResult {
  counts: { ready: number; needsWork: number; shouldRemove: number; uncertain: number; total: number };
  distribution: Record<Verdict, number>;
  actions: Action[];
  shouldRemoveIds: string[];
}

/** 判词 → 动作路由（should-remove 生效:前提证伪 → 撤出/重定范围,不是进 pool——AC4）。PURE。 */
export function actionFor(verdict: Verdict): string {
  switch (verdict) {
    case "ready":
      return "dispatchable";
    case "needs-work":
      return "back-to-todo";
    case "should-remove":
      return "remove-or-rescope";
    case "uncertain":
      return "needs-human";
  }
}

/** 判词字符串 → counts 的 camelCase 键。PURE。 */
export function countKeyFor(verdict: Verdict): keyof typeof countsEmpty {
  switch (verdict) {
    case "ready":
      return "ready";
    case "needs-work":
      return "needsWork";
    case "should-remove":
      return "shouldRemove";
    case "uncertain":
      return "uncertain";
  }
}

const countsEmpty = { ready: 0, needsWork: 0, shouldRemove: 0, uncertain: 0 };

/** 聚合 agent 判词:JS 算术——分布 + 动作列表。PURE。 */
export function aggregateVerdicts(verdicts: VerdictRecord[]): AggregateResult {
  const counts = { ...countsEmpty, total: verdicts.length };
  const actions: Action[] = [];
  for (const v of verdicts) {
    counts[countKeyFor(v.verdict)] += 1;
    actions.push({
      id: v.id,
      verdict: v.verdict,
      action: actionFor(v.verdict),
      reason: v.verdict === "should-remove" ? `premise-falsified → ${actionFor(v.verdict)}: ${v.evidence}` : v.evidence,
    });
  }
  const distribution: Record<Verdict, number> = {
    ready: counts.ready,
    "needs-work": counts.needsWork,
    "should-remove": counts.shouldRemove,
    uncertain: counts.uncertain,
  };
  return {
    counts,
    distribution,
    actions,
    shouldRemoveIds: actions.filter((a) => a.verdict === "should-remove").map((a) => a.id),
  };
}

// ── 机械读数（读盘）───────────────────────────────────────────────────────────────────────────────────

/** 读 verification-round.jsonl 当前轮数（行数即轮数）。缺文件 ⇒ 0。 */
export function readCurrentRound(root: string): number {
  const p = path.join(root, ".quay", "verification-round.jsonl");
  if (!fs.existsSync(p)) return 0;
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0);
  return lines.length;
}

// ── judge 完成态持久化（B15:写端补齐 + fail-open 三态,硬规则 3b）─────────────────────────────────

export const JUDGE_STATE_REL = path.join(".quay", "pool-quality-judge-state.json");

/** judge 状态文件路径。运行时状态,gitignored（与 gate-events.jsonl 同族,见 .gitignore）。 */
export function judgeStatePath(root: string): string {
  return path.join(root, JUDGE_STATE_REL);
}

/**
 * 三态读 judge 状态（硬规则 3b:「无法评估」必须独立取值,不得与「合格/该跑」同形）:
 *   - missing  文件不存在 ⇒ fail-open fire（「从没判过」第一次本来也该跑）——显式标注,不是静默默认 0;
 *   - ok       文件存在且 lastRound 有效 ⇒ 正常算 roundsSinceLastJudge;
 *   - corrupt  文件存在但解析失败/lastRound 非法 ⇒ NOT-EVALUATED——不得当作 lastRound=0
 *              （否则与 missing 的 fail-open fire 同形,「永远响」退化成更隐蔽的「读不懂当没判过」）。
 */
export type LastJudgeStatus = "ok" | "missing" | "corrupt";

export interface LastJudgeState {
  status: LastJudgeStatus;
  lastRound: number | null; // ok 时为非负 round;missing/corrupt 为 null（不可信）
  reason?: string;          // missing/corrupt 给显式原因
}

export function readLastJudgeRoundState(root: string): LastJudgeState {
  const p = judgeStatePath(root);
  if (!fs.existsSync(p)) {
    return { status: "missing", lastRound: null, reason: "state-file-absent (fail-open: never judged ⇒ 该跑)" };
  }
  let j: unknown;
  try {
    j = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { status: "corrupt", lastRound: null, reason: `JSON parse failed: ${(e as Error).message}` };
  }
  const lastRound = (j as { lastRound?: unknown })?.lastRound;
  if (typeof lastRound !== "number" || !Number.isFinite(lastRound) || lastRound < 0) {
    return {
      status: "corrupt",
      lastRound: null,
      reason: `lastRound is not a non-negative number: ${JSON.stringify(lastRound)}`,
    };
  }
  return { status: "ok", lastRound };
}

/** 兼容旧签名（缺/损坏 ⇒ 0）。新代码判三态请用 readLastJudgeRoundState。 */
export function readLastJudgeRound(root: string): number {
  const s = readLastJudgeRoundState(root);
  return s.status === "ok" ? (s.lastRound as number) : 0;
}

/** 写端:把 lastRound 持久化到 judge 状态文件（单写者——workflow 完成路径经 --record-last-round 调）。 */
export function writeLastJudgeRound(root: string, lastRound: number): LastJudgeState {
  const p = judgeStatePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ lastRound, judgedAt: new Date().toISOString() }, null, 2));
  return { status: "ok", lastRound };
}

/** 读当前 verification-round 数并把 lastRound 持久化。返回写入的 round。 */
export function recordLastJudgeRound(root: string): number {
  const currentRound = readCurrentRound(root);
  writeLastJudgeRound(root, currentRound);
  return currentRound;
}

/** 池枚举 + 最久未复核年龄。复用 ready-pool-check.analyzeTasks（单源）。 */
export function readPoolPlan(root: string): { pool: string[]; poolCount: number; oldestUnreviewedAgeMs: number; oldestTaskId: string | null } {
  // concurrency-default-fallback: fixed cap 5 (declared per gap-concurrency-literal-only-at-definition-points;
  // the single source is QUAY_MAX_TASK_SUBAGENTS once gap-single-flight-lock-2-slot-concurrent-suites lands).
  const analysis = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  const pool = analysis.ready ?? [];
  let oldestUnreviewedAgeMs = 0;
  let oldestTaskId: string | null = null;
  for (const id of pool) {
    const f = path.join(root, "tasks", `${id}.md`);
    let ageMs = 0;
    if (fs.existsSync(f)) {
      ageMs = Math.max(0, Date.now() - fs.statSync(f).mtimeMs);
    }
    if (ageMs > oldestUnreviewedAgeMs) {
      oldestUnreviewedAgeMs = ageMs;
      oldestTaskId = id;
    }
  }
  return { pool, poolCount: pool.length, oldestUnreviewedAgeMs, oldestTaskId };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function usage() {
  console.error(`pool-quality-judge.ts — pool 任务质量语义闸的确定性部分（ADR-033）

机械触发（pool>25 / 最久未复核>48h / 每 10 轮）+ 池枚举 + 每任务机械 AC 计数 + 判词聚合。
判定本体（每任务一个 schema agent）在 .claude/workflows/pool-quality-judge.js。

Usage:
  --plan                机械触发评估 + 池枚举 + 每任务机械 AC 计数（JSON，default）
  --aggregate <file>    对 agent 判词 JSON 数组做 JS 算术:分布 + 动作（should-remove → 撤出/重定范围）
  --demo                合成判词（含 should-remove 案例）跑聚合——invoke 证据
  --root <dir>          workspace root（default cwd）
  --rounds-since <N>    覆盖「每 10 轮」读数（测试/手动评估用）
  --json                同 --plan（显式）
  --record-last-round   写端（B15）:把当前 verification-round 持久化为 lastRound（judge 完成路径单写者）

Exit: 0 = planned/judged · 2 = usage error`);
}

function planJson(root: string, roundsSinceOverride?: number): string {
  const { pool, poolCount, oldestUnreviewedAgeMs, oldestTaskId } = readPoolPlan(root);
  const currentRound = readCurrentRound(root);
  const judgeState = readLastJudgeRoundState(root);
  // roundsSinceLastJudge: null ⇒ NOT-EVALUATED（corrupt 文件）,不得与 fire 同形（硬规则 3b）。
  let roundsSinceLastJudge: number | null;
  if (roundsSinceOverride !== undefined) {
    roundsSinceLastJudge = Number.isFinite(roundsSinceOverride) ? roundsSinceOverride : null;
  } else if (judgeState.status === "ok") {
    roundsSinceLastJudge = Math.max(0, currentRound - (judgeState.lastRound as number));
  } else if (judgeState.status === "missing") {
    // fail-open:从没判过 ⇒ 距上次=currentRound ⇒ 该跑（显式标注,不是静默默认 0）。
    roundsSinceLastJudge = currentRound;
  } else {
    roundsSinceLastJudge = null; // corrupt ⇒ NOT-EVALUATED
  }
  const triggers = computeTriggers({
    poolCount,
    oldestUnreviewedAgeMs,
    roundsSinceLastJudge: roundsSinceLastJudge ?? 0,
  });
  if (judgeState.status === "corrupt" && roundsSinceLastJudge === null) {
    // NOT-EVALUATED:every-10-rounds 不作数（不得与 fire 同形）,只留 pool/age 的真实触发。
    triggers.reasons = triggers.reasons.filter((r) => r !== "every-10-rounds");
    triggers.fired = triggers.reasons.length > 0;
  }
  const tasks = pool.map((id) => {
    const f = path.join(root, "tasks", `${id}.md`);
    const body = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    const ageMs = fs.existsSync(f) ? Math.max(0, Date.now() - fs.statSync(f).mtimeMs) : 0;
    return taskMechanicalInput(id, body, ageMs);
  });
  return JSON.stringify(
    {
      task: "gap-pool-quality-semantic-gate",
      triggers,
      triggerThresholds: {
        poolSize: POOL_SIZE_TRIGGER,
        oldestUnreviewed: OLDEST_UNREVIEWED_TRIGGER_MS,
        roundsSinceLastJudge: ROUNDS_SINCE_LAST_JUDGE_TRIGGER,
      },
      currentRound,
      lastJudgeRound: judgeState.status === "ok" ? (judgeState.lastRound as number) : null,
      lastJudgeState: judgeState, // 三态:ok / missing（fail-open fire）/ corrupt（NOT-EVALUATED）
      roundsSinceLastJudge,
      oldestTaskId,
      poolCount,
      pool,
      tasks,
    },
    null,
    2,
  );
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 2;
  }
  const flagVal = (name: string, def?: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : def;
  };
  const root = path.resolve(flagVal("--root", ".") ?? ".");
  if (args.includes("--record-last-round")) {
    const lastRound = recordLastJudgeRound(root);
    console.log(JSON.stringify({ recorded: true, lastRound, path: judgeStatePath(root) }, null, 2));
    return 0;
  }
  const mode = args.includes("--demo") ? "demo" : args.includes("--aggregate") ? "aggregate" : "plan";
  if (mode === "aggregate") {
    const file = flagVal("--aggregate");
    if (!file) {
      console.error("pool-quality-judge: --aggregate requires a verdicts JSON file path");
      return 2;
    }
    let verdicts: VerdictRecord[];
    try {
      verdicts = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`pool-quality-judge: cannot read verdicts file ${file}: ${(e as Error).message}`);
      return 2;
    }
    if (!Array.isArray(verdicts)) {
      console.error("pool-quality-judge: verdicts file must be a JSON array");
      return 2;
    }
    const out = aggregateVerdicts(verdicts);
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }
  if (mode === "demo") {
    // 合成判词:含 should-remove 案例（premise-falsified → 撤出/重定范围, AC4 生效演示）。
    const demo: VerdictRecord[] = [
      { id: "gap-demo-should-remove", verdict: "should-remove", acCompleteness: "partial", premiseSound: false, evidence: "premise falsified — the assumed gap is already covered by scoped selection (cf. gap-crosscut-checks-zero-coverage-of-plugin-scripts)" },
      { id: "gap-demo-ready", verdict: "ready", acCompleteness: "all-checked", premiseSound: true, evidence: "all substantive ACs done, work landed" },
      { id: "gap-demo-needs-work", verdict: "needs-work", acCompleteness: "partial", premiseSound: true, evidence: "AC2 untouched, plan incomplete" },
      { id: "gap-demo-uncertain", verdict: "uncertain", acCompleteness: "all-checked", premiseSound: true, evidence: "verification-window AC — needs outer re-run" },
    ];
    const out = aggregateVerdicts(demo);
    console.log(JSON.stringify({ mode: "demo", demo: true, ...out }, null, 2));
    return 0;
  }
  // plan mode
  const roundsOverride = flagVal("--rounds-since");
  const roundsSince = roundsOverride !== undefined ? Number(roundsOverride) : undefined;
  console.log(planJson(root, Number.isFinite(roundsSince) ? roundsSince : undefined));
  return 0;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
