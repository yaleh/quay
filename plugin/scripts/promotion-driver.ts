// plugin/scripts/promotion-driver.ts — AC130 (tasks/gap-ac130-promotion-driver-resident-loop)
//
// 常驻循环，每轮调 `ready-pool-check` 取【全池】判定（⛔ 非单条 --targeted），跑完一轮不退出、
// 按间隔进入下一轮。停掉驱动 ⇒ 池中新出现的合格任务不再被晋升（AC2 能取假，证明晋升由驱动驱动、
// 非 outer tick）。
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC130，晋升面机械化的第一半）：
//   todo→ready 晋升过去靠 outer 每轮记得调 A22 --apply（角色意志，换会话/换模型即丢失）。本驱动是
//   常驻【机械】进程：每轮无条件调 ready-pool-check --apply 取全池判定 + 落地合格晋升（复用 A22 已在
//   用的心跳路径，零 LLM），跑完一轮不退出、按 --interval 进入下一轮。AC130 只做【常驻全池循环】这一半。
//
// 权责边界（⛔ 只做 AC130 判据，不越界到 AC131–136 —— 那些是独立任务）：
//   驱动  ✅ 每轮调 ready-pool-check --apply（全池判定 + 合格晋升，零 LLM）
//         ✅ 跑完一轮不退出、按 --interval 进入下一轮；SIGINT/SIGTERM 优雅停机
//         ✅ 每轮写一条 round 记录（.quay/promotion-round.jsonl，gitignored，outer 可消费）
//   驱动  ⛔ 不做任何 commit  ⛔ 不 spawn LLM fix worker（那是 AC132/133 的任务）
//         ⛔ 不读/不写 .halt（停机态 = 进程信号，单一真相源；AC135 才涉及 outer 退役）
//
// Run:
//   node --experimental-strip-types plugin/scripts/promotion-driver.ts \
//     --root <repo> [--interval <ms>] [--cap <n>] [--once] [--max-rounds <n>]
//     [--ready-pool-cmd "<argv>"] [--round-log <path>] [--run-id <id>] [--pid-file <path>] [--json]
//   --interval <ms>       轮间隔（缺省 30000；测试缝传小值）
//   --cap <n>             传给 ready-pool-check 的并发 cap（缺省 5——AC48 后 cap 不再闸晋升，
//                         但仍参与 floor 报告与 disjointness 排序；传 5 避免 cap-3 回退的 floor 假象）
//   --once                跑一轮即退出（手动单发 / 测试）
//   --max-rounds <n>      跑满 N 轮退出（测试缝，防常驻环无限跑）
//   --ready-pool-cmd <s>  覆盖 ready-pool-check 命令（测试缝，同 worker-driver 的缝）。
//                         缺省 = `node …ready-pool-check.ts --root <root> --cap <cap> --apply --json`。
//                         输出须为 analyzeTasks JSON（含 pool / promotions / applied_promotions）。
//                         解析失败/非零退出 ⇒ fail-closed（本轮记 error，⛔ 不得伪装成「无候选」）。
//   --round-log <path>    轮记录文件（缺省 <root>/.quay/promotion-round.jsonl）
//   --pid-file <path>     把驱动自身 pid 写到该文件（外部观测 + kill 抓手）
//   --json                每轮向 stdout 打一条 JSON 事件行
// Exit: 0 = 正常（信号停机 / --once / --max-rounds 跑完）；2 = 参数错误。
//
// 复用面（manager-phase-goal ### AC130「可复用面」记，非强制）：splitArgs 复用 worker-driver.ts 的
// 单源实现（⛔ 不复制一份平行版本）；ready-pool-check 的 --apply 心跳路径本身即 A22 已在用的晋升机件。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { splitArgs } from "./worker-driver.ts";

/** round 记录的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。 */
export const ROUND_LOG_REL = ".quay/promotion-round.jsonl";

/** 轮间隔缺省（毫秒）。AC130 判据不设数值阈值（硬规则 4）——此值只是「机械心跳」的占位节奏，
 *  生产部署时由 outer 的启动命令传 --interval 覆盖；测试传小值。 */
export const INTERVAL_MS_DEFAULT = 30_000;

// 并发 cap 缺省。concurrency-default-fallback：生产调用方从 cap-from-gate.sh 传自适应 --cap；
// 此值只是「未传 --cap」的手动/测试回退。AC48 后 cap 不闸晋升，传 5 避免 cap-3 回退的 floor 假象。
export const CAP_DEFAULT = 5;

/** ready-pool-check 单轮的 wall-clock 上限（spawnSync timeout，毫秒）。 */
export const ROUND_TIMEOUT_MS = 180_000;

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────────────────────────

/** 缺省 ready-pool-check 命令（全池 + --apply 落地晋升）。输出须为 analyzeTasks JSON。 */
export function defaultPromotionCheckArgv(root: string, cap: number): string[] {
  return [
    "node", "--experimental-strip-types",
    path.join(root, "plugin", "scripts", "ready-pool-check.ts"),
    "--root", root, "--cap", String(cap), "--apply", "--json",
  ];
}

/** 单轮判定结果。promotedIds = 闸判定「合格应晋」的候选 id；applied = 闸实际落地的晋升（含
 *  deliveryCritical 标签同现判定）。error 非空 ⇒ 本轮读不懂（fail-closed，⛔ 不得伪装成无候选）。 */
export interface PromotionRound {
  ok: boolean;
  error: string | null;
  pool: number | null;
  shouldApply: boolean;
  promotedIds: string[];
  applied: Array<{ id: string; ok: boolean; from: string | null; to: string | null; deliveryCritical: boolean }>;
}

/** 跑一轮：调 ready-pool-check（缺省 --apply 全池），解析 analyzeTasks JSON。解析失败/非零退出 ⇒
 *  fail-closed（ok:false + error），⛔ 不把「读不懂」与「无候选」混为一谈（硬规则 3b）。 */
export function runPromotionRound(root: string, cmd: string[] | null, cap: number): PromotionRound {
  const argv = cmd ?? defaultPromotionCheckArgv(root, cap);
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: ROUND_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { ok: false, error: `ready-pool-check spawn failed (${msg})`, pool: null, shouldApply: false, promotedIds: [], applied: [] };
  }
  if (r.error || r.status !== 0) {
    const msg = r.error ? String(r.error.message || r.error) : `ready-pool-check exited ${r.status}`;
    return { ok: false, error: msg, pool: null, shouldApply: false, promotedIds: [], applied: [] };
  }
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const promotions = Array.isArray(j.promotions) ? j.promotions : [];
    const promotedIds = promotions
      .map((p) => (p && typeof p === "object" && "id" in p ? String(p.id) : String(p)))
      .filter(Boolean);
    const appliedRaw = Array.isArray(j.applied_promotions) ? j.applied_promotions : [];
    const applied = appliedRaw
      .map((a) => ({
        id: a && typeof a === "object" && "id" in a ? String(a.id) : null,
        ok: !!(a && a.ok),
        from: a && typeof a === "object" && "from" in a ? a.from : null,
        to: a && typeof a === "object" && "to" in a ? a.to : null,
        deliveryCritical: !!(a && a.deliveryCritical),
      }))
      .filter((a) => a.id);
    return {
      ok: true, error: null,
      pool: typeof j.pool === "number" ? j.pool : null,
      shouldApply: !!j.should_apply,
      promotedIds, applied,
    };
  } catch {
    return { ok: false, error: "unparseable ready-pool-check output", pool: null, shouldApply: false, promotedIds: [], applied: [] };
  }
}

/** 一条结构化 round 记录（字段：ts · round · run_id · pid · action · pool · should_apply ·
 *  promoted_ids · applied · error）。action ∈ promote|none|error。 */
export function computeRoundRecord(opts: {
  round: number;
  runId: string;
  pid: number;
  at: string;
  pool: number | null;
  shouldApply: boolean;
  promotedIds: string[];
  applied: PromotionRound["applied"];
  error: string | null;
}) {
  const action = opts.error ? "error" : opts.promotedIds.length > 0 ? "promote" : "none";
  return {
    ts: opts.at, round: opts.round, run_id: opts.runId, pid: opts.pid, action,
    pool: opts.pool, should_apply: opts.shouldApply, promoted_ids: opts.promotedIds,
    applied: opts.applied, error: opts.error,
  };
}

/** 把一条 round 记录追加写入文件（pure append，⛔ 不截断不覆盖）。 */
export function appendRoundRecord(file: string, record: ReturnType<typeof computeRoundRecord>): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
}

/** 解析 --interval。缺省 INTERVAL_MS_DEFAULT；非负有限数才合法。 */
export function parseIntervalMs(raw: string | undefined): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: INTERVAL_MS_DEFAULT };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `invalid --interval: ${raw}` };
  return { ok: true, value: n };
}

/** 解析 --cap。缺省 CAP_DEFAULT；正整数才合法。 */
export function resolveCap(raw: string | undefined): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: CAP_DEFAULT };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: `invalid --cap: ${raw}` };
  return { ok: true, value: n };
}

// ── 常驻循环（AC130 AC1 常驻 + AC2 停机取假） ─────────────────────────────────────────────────────

/** 常驻循环的选项（`main` 装配后传入）。 */
export interface ResidentLoopOptions {
  root: string;
  intervalMs: number;
  cap: number;
  once: boolean;
  maxRounds: number | null;
  readyPoolArgv: string[] | null;
  roundLogFile: string;
  runId: string;
  json: boolean;
  pidFile?: string;
}

/**
 * 常驻循环（AC1）：跑一轮不退出，按 --interval 进入下一轮，直到 SIGINT/SIGTERM 或 --once/--max-rounds。
 *  每轮 = runPromotionRound（调 ready-pool-check --apply 全池判定 + 落地晋升）→ computeRoundRecord →
 *  appendRoundRecord → （json 时）stdout 事件行。停机由进程信号驱动（⛔ 不读 .halt，单一真相源）。
 */
export async function runResidentPromotionLoop(opts: ResidentLoopOptions): Promise<number> {
  const { root, intervalMs, cap, once, maxRounds, readyPoolArgv, roundLogFile, runId, json, pidFile } = opts;

  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测，写失败不致命 */ }
  }

  let stopRequested = false;
  let wakeResolve: (() => void) | null = null;
  const requestStop = () => { stopRequested = true; if (wakeResolve) { const w = wakeResolve; wakeResolve = null; w(); } };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  // 可被信号唤醒的 sleep：SIGINT/SIGTERM 立即 resolve，本轮结束即退出（⛔ 不杀在飞——单轮是同步的，
  // 不存在「在飞轮」）。
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    wakeResolve = resolve;
    setTimeout(() => { if (wakeResolve === resolve) wakeResolve = null; resolve(); }, ms);
  });

  let round = 0;
  while (!stopRequested) {
    round += 1;
    const r = runPromotionRound(root, readyPoolArgv, cap);
    const record = computeRoundRecord({ round, runId, pid: process.pid, at: new Date().toISOString(), ...r });
    try { appendRoundRecord(roundLogFile, record); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...record })}\n`);
    if (once) break;
    if (maxRounds !== null && round >= maxRounds) break;
    await sleep(intervalMs);
  }

  if (json && stopRequested) {
    process.stdout.write(`${JSON.stringify({ event: "stop", reason: "signal", round })}\n`);
  }
  return 0;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "promotion-driver — AC130：常驻循环，每轮调 ready-pool-check 取全池判定（--apply 落地合格晋升），",
  "跑完一轮不退出、按 --interval 进入下一轮。SIGINT/SIGTERM 优雅停机。",
  "  --root <repo> [--interval <ms>] [--cap <n>] [--once] [--max-rounds <n>]",
  "  [--ready-pool-cmd \"<argv>\"] [--round-log <p>] [--run-id <id>] [--pid-file <p>] [--json]",
  "  --interval <ms>       轮间隔（缺省 30000；测试缝传小值）",
  "  --cap <n>             传给 ready-pool-check 的并发 cap（缺省 5）",
  "  --once                跑一轮即退出（手动单发 / 测试）",
  "  --max-rounds <n>      跑满 N 轮退出（测试缝，防常驻环无限跑）",
  "  --ready-pool-cmd <s>  覆盖 ready-pool-check 命令（测试缝）",
  "  --round-log <path>    轮记录文件（缺省 <root>/.quay/promotion-round.jsonl）",
  "  --pid-file <path>     把驱动自身 pid 写到该文件（外部观测 + kill 抓手）",
  "  --json                每轮向 stdout 打一条 JSON 事件行",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root: string | undefined;
  let intervalRaw: string | undefined;
  let capRaw: string | undefined;
  let once = false;
  let maxRounds: number | null = null;
  let readyPoolCmd: string | undefined;
  let roundLogPath: string | undefined;
  let runId: string | undefined;
  let json = false;
  let pidFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--interval") intervalRaw = args[++i];
    else if (a === "--cap") capRaw = args[++i];
    else if (a === "--once") once = true;
    else if (a === "--max-rounds") maxRounds = Number(args[++i]);
    else if (a === "--ready-pool-cmd") readyPoolCmd = args[++i];
    else if (a === "--round-log") roundLogPath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") { console.log(HELP); return 0; }
    else { console.error(`promotion-driver: unknown argument: ${a}`); return 2; }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());

  const interval = parseIntervalMs(intervalRaw);
  if (!interval.ok) { console.error(`promotion-driver: ${interval.error}`); return 2; }
  const capRes = resolveCap(capRaw);
  if (!capRes.ok) { console.error(`promotion-driver: ${capRes.error}`); return 2; }
  if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    console.error("promotion-driver: --max-rounds must be a positive integer");
    return 2;
  }

  const roundLogFile = roundLogPath ? path.resolve(roundLogPath) : path.join(rootDir, ROUND_LOG_REL);
  const resolvedRunId = runId || `pm-${Date.now()}`;

  return runResidentPromotionLoop({
    root: rootDir,
    intervalMs: interval.value,
    cap: capRes.value,
    once,
    maxRounds,
    readyPoolArgv: readyPoolCmd ? splitArgs(readyPoolCmd) : null,
    roundLogFile,
    runId: resolvedRunId,
    json,
    pidFile,
  });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "promotion-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
