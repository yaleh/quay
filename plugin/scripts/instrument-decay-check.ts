#!/usr/bin/env node
// instrument-decay-check.ts — P5 仪器腐烂常驻检测器 (tasks/gap-archguard-p5-instrument-decay-standing-guard)
//
// 定义 (docs/proposals/archguard-generation-era-primitives.md §3 P5)：一个写入载体的写入速率归零，
// 而它的产生路径仍在运行。失败形态与「一切正常」同形：没有新记录，看起来就像没有新问题。
//
// 本检测器对仓库内【已知】的 jsonl 运行时载体逐个建时间序列（按 groupBy 字段分组的末次写入时刻），
// 当某个分组的写入速率 → 0 而同一份载体里的其它分组仍在写（伴生对照）时告警。**不用绝对速率阈值**
// —— 文档 P5 的反向判据：真正低频但仍在写的载体（如 message-receipts.jsonl）不得被误报，用绝对速率
// 阈值的实现必然踩这个。
//
// 两种腐烂形状都抓（本任务的 AC1 现场复核找到的精确根因是形状 A——写手分裂到另一文件）：
//   A. never-wrote   （写手分裂）expected 分组在载体里 0 条记录，而同一载体其它分组有记录。
//                    fan-in-step-trace.jsonl 的 ac-precheck/suite-start/suite-end/suite-skip 自
//                    a5a301e03 起被 trace() 改写到 per-run fan-in-<task>-<runId>.log，共享载体
//                    永久停写——正是「载体 A 停写，但同一批事件其实转移去了载体 B」的字面实例。
//   B. rate-stopped  （速率归零）分组有历史记录，但末次写入比该载体的最新写入（伴生分组仍在写）
//                    老超过 --stale-seconds。
//
// 伴生对照是结构性的防误报：一个单分组（或全分组同旧）的载体，其唯一分组就是它自己的「最新」，
// 结构上不可能满足「比某个伴生分组更旧」⇒ 永不误报（AC2 反向判据）。
//
// 用法:
//   instrument-decay-check.ts [--root <dir>] [--stale-seconds <n>] [--carrier <file>] [--no-block] [--json] [--help]
//     --root DIR          workspace root（默认：本脚本位置自动推导）。接 run_operational_checks 时传
//                         main_root——.quay/*.jsonl 是主检出 gitignored 运行时态，verify worktree 无。
//     --stale-seconds N   Shape B 伴生陈旧间隔秒（默认 86400 = 24h）。只影响形状 B。
//     --carrier FILE      只检一个载体（basename 或 .quay/ 下相对路径）。
//     --no-block          REPORT-ONLY：仍打印腐烂清单但 exit 0（接 run_operational_checks 的常驻路径）。
//                         默认（不带）fail-closed：有腐烂 exit 1。
//     --json              机器可读 JSON（与 --no-block 正交）。
//
// Exit 码（checker 机械脊柱契约：{0,1,2,3}）:
//   0  无腐烂（或 --no-block 时报告但不红）
//   1  发现 ≥1 腐烂（枚举清单，非布尔——硬规则 3）
//   2  usage/environment error（坏参数 / 不是 workspace：无 .quay/ 目录）
//   3  NOT-EVALUATED（输入读不懂/不可得：全部清单载体都缺文件——verify worktree 无主检出运行时态）

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo-root.ts";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_STALE_SECONDS = 86400; // 24h 伴生陈旧间隔（只影响 Shape B）

// ── 已知载体清单（单一正源）─────────────────────────────────────────────────────────────────────────
// 每个载体声明：groupBy 分组字段、expected 期望分组词表（Shape A 判据：期望分组缺席 = 写手分裂）、
// shapeB 是否应用速率归零对照（Shape B）、note 写手溯源。词表是【人审查过的声明】，不是从代码推导——
// 它自己的腐烂（代码加了新步骤而清单没更新）归 P4 守卫谱系管，不是本检测器管。
export interface CarrierSpec {
  /** .quay/ 下的相对路径。 */
  file: string;
  /** 记录里哪个字段的值构成分组身份。 */
  groupBy: string;
  /** 该载体应当出现的分组词表（Shape A：缺席 = 停写）。 */
  expected: string[];
  /** 是否应用 Shape B（速率归零对照）。锁事件类（acquire 后 release 可合法滞后）关掉。 */
  shapeB?: boolean;
  /** 记录里 `kind` 取此值的行**整体不计入本载体的分析**（既不入分组、不计 totalRecords）。缺省不过滤。
   *
   *  为什么需要（gap-goal-merge-execution-writes-no-step-trace）：`fan-in-step-trace.jsonl` 现在同时
   *  承载 goal→develop 并入的步骤（写手 `worker-fan-in.ts` 的 `GOAL_MERGE_TRACE_KIND = "goal-merge"`），
   *  而本检测器的 `expected` 词表与 Shape B 都是按【任务 fan-in 步骤链】定的。不跳过的两个方向都坏：
   *  ① 并入的步若与任务步同名（ff/typecheck/suite…），它会把**任务侧写手已停写**的分组刷成「仍在写」
   *     ⇒ 真腐烂被掩盖（硬规则 4b：代理量与实际偏离）；② 若另起名，goal 并入低频（可能数周一次），
   *     Shape B 会把它判成 rate-stopped ⇒ 误报（本文件头注点名的「真正低频但仍在写」误报形态）。
   *  判据用**精确等于**（⛔ 不是「有 kind 就跳过」）：既有记录都没有 `kind` 字段，任何「有 kind 即跳过」
   *  的写法都会把全部历史记录一起过滤掉——那是把「读不懂」伪装成「零腐烂」（硬规则 3b）。 */
  skipKind?: string;
  /** 写手溯源——为什么这些分组【应当】在这个载体里。 */
  note: string;
}

export const MANIFEST: CarrierSpec[] = [
  {
    file: "fan-in-step-trace.jsonl",
    groupBy: "step",
    expected: [
      "merge-develop", "anti-drift", "typecheck", "scoped-gate", "doc-check",
      "anti-drift-land", "ac-gate", "ff",
      // 以下 4 个是 P5 已知案例的腐烂组：a5a301e03 把 suite 决策步骤的 trace 从共享载体改写到
      // per-run fan-in-<task>-<runId>.log，共享载体停写（writer-split），文档 §2.5 记「suite 步骤
      // 40 条，2026-08-30T01:47Z 之后停止写入」。expected 词表把它们列回来 ⇒ 缺席即报。
      "ac-precheck", "suite-start", "suite-end", "suite-skip",
    ],
    shapeB: true,
    // goal→develop 并入的步骤写进同一载体（worker-fan-in.ts GOAL_MERGE_TRACE_KIND），但它们不是任务
    // fan-in 的步骤链：本检测器的 expected 词表与 Shape B 都只对任务那批成立。⚠️ 该字面量与写手侧的
    // GOAL_MERGE_TRACE_KIND 是**两处**声明（本文件不 import 写手的模块——它是常驻检测器，不背负 fan-in
    // 子系统的加载面）；改判别键取值必须同时改这里，缺一即静默失效（本文件的词表一贯是人审查过的声明，
    // 见头注「词表是【人审查过的声明】，不是从代码推导」）。
    skipKind: "goal-merge",
    note:
      "worker-driver.ts 机械 fan-in 步骤链。前 8 个经 step()/appendFanInStepTrace 写共享载体；" +
      "后 4 个（ac-precheck/suite-*）自 a5a301e03 起被 trace() 改写到 per-run 日志，" +
      "共享载体停写而伴生步骤（merge-develop/typecheck/scoped-gate/ff）仍在写——P5 的字面实例。",
  },
  {
    file: "fan-in-lock-events.jsonl",
    groupBy: "event",
    expected: ["acquire", "release"],
    shapeB: false, // acquire 后 release 可合法滞后（当前持锁），Shape B 会把持锁误报为停写
    note:
      "fan-in 锁事件账本：acquire 与 release 应成对出现。只按 Shape A 判「两种事件都在写」；" +
      "不在 Shape B 上判速率——持锁时长可变，release 末次时刻落后 acquire 是正常态。",
  },
];

export interface GroupStat {
  count: number;
  lastWriteMs: number | null;
}

export interface DecayFinding {
  group: string;
  kind: "never-wrote" | "rate-stopped";
  count: number;
  lastWriteMs: number | null;
}

export interface Companion {
  group: string;
  count: number;
  lastWriteMs: number | null;
}

export interface CarrierResult {
  file: string;
  evaluated: boolean;
  reason: string | null;
  totalRecords: number;
  freshestMs: number | null;
  groupCount: number;
  decayed: DecayFinding[];
  companions: Companion[];
}

// ── 时间戳抽取（通用：按字段优先级尝试，缺值 = 未查）───────────────────────────────────────────────
// fan-in 系载体带 ts(ISO) + epoch(秒)；checker-cost 带 at(ISO)；gate-events 带 timestamp(ISO)；
// message-receipts 带 sentAtMs(毫秒)；verification-round 带 startedAt(ISO)。一个 extractor 覆盖全部。
export function extractTsMs(rec: Record<string, unknown>): number | null {
  for (const key of ["ts", "at", "timestamp", "startedAt"]) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      // 这些键下的裸数字歧义：> 1e12 当毫秒，否则当秒。
      return v > 1e12 ? v : v * 1000;
    }
  }
  const epoch = rec["epoch"];
  if (typeof epoch === "number" && Number.isFinite(epoch)) return epoch * 1000; // fan-in 系 epoch 是秒
  const sentAtMs = rec["sentAtMs"];
  if (typeof sentAtMs === "number" && Number.isFinite(sentAtMs)) return sentAtMs;
  return null;
}

function parseLine(line: string): Record<string, unknown> | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null; // 追加式账本里一条坏行不得杀掉整个检测器
  }
}

// ── 单载体分析 ──────────────────────────────────────────────────────────────────────────────────────
export function analyzeCarrier(root: string, spec: CarrierSpec, staleSeconds: number): CarrierResult {
  const filePath = path.join(root, ".quay", spec.file);
  const empty: CarrierResult = {
    file: spec.file, evaluated: false, reason: "carrier-missing",
    totalRecords: 0, freshestMs: null, groupCount: 0, decayed: [], companions: [],
  };
  if (!fs.existsSync(filePath)) return empty;

  const text = fs.readFileSync(filePath, "utf8");
  const groups = new Map<string, GroupStat>();
  let totalRecords = 0;
  for (const line of text.split("\n")) {
    const rec = parseLine(line);
    if (!rec) continue;
    // 非本载体「该管的那批写手」的记录整体不计入（见 CarrierSpec.skipKind 的两条理由）。精确等于，
    // ⛔ 不是「有 kind 就跳过」——历史记录都没有该字段，宽松谓词会把它们一起过滤掉。
    if (spec.skipKind !== undefined && rec["kind"] === spec.skipKind) continue;
    totalRecords++;
    const key = String(rec[spec.groupBy] ?? "<unset>");
    const ts = extractTsMs(rec);
    const g = groups.get(key) ?? { count: 0, lastWriteMs: null };
    g.count++;
    if (ts !== null && (g.lastWriteMs === null || ts > g.lastWriteMs)) g.lastWriteMs = ts;
    groups.set(key, g);
  }

  let freshestMs: number | null = null;
  for (const g of groups.values()) {
    if (g.lastWriteMs !== null && (freshestMs === null || g.lastWriteMs > freshestMs)) freshestMs = g.lastWriteMs;
  }

  const decayed: DecayFinding[] = [];

  // Shape A：期望分组 0 条记录，而载体整体有记录（产生路径还在跑、只是这批事件转移去了别处）。
  if (totalRecords > 0) {
    for (const exp of spec.expected) {
      const g = groups.get(exp);
      if (!g || g.count === 0) {
        decayed.push({ group: exp, kind: "never-wrote", count: 0, lastWriteMs: null });
      }
    }
  }

  // Shape B：有历史记录的分组，末次写入比载体最新（伴生分组仍在写）老超过 staleSeconds。
  if (spec.shapeB !== false && freshestMs !== null && staleSeconds > 0) {
    const gapMs = staleSeconds * 1000;
    for (const [k, g] of groups) {
      if (g.count === 0 || g.lastWriteMs === null) continue;
      if (freshestMs - g.lastWriteMs > gapMs) {
        decayed.push({ group: k, kind: "rate-stopped", count: g.count, lastWriteMs: g.lastWriteMs });
      }
    }
  }

  // 伴生分组（仍在写的对照证据）：末次写入距载体最新不超过 staleSeconds（或无 staleSeconds 时全部）。
  const gapMs = staleSeconds > 0 ? staleSeconds * 1000 : Infinity;
  const companions: Companion[] = [];
  for (const [k, g] of groups) {
    if (g.lastWriteMs === null) continue;
    if (freshestMs === null || freshestMs - g.lastWriteMs <= gapMs) {
      companions.push({ group: k, count: g.count, lastWriteMs: g.lastWriteMs });
    }
  }
  companions.sort((a, b) => (b.lastWriteMs ?? 0) - (a.lastWriteMs ?? 0));

  return {
    file: spec.file, evaluated: true, reason: null,
    totalRecords, freshestMs, groupCount: groups.size, decayed, companions,
  };
}

export interface AnalyzeOutcome {
  carriers: CarrierResult[];
  anyEvaluated: boolean;
  anyDecayed: boolean;
  decayedCount: number;
}

export function analyzeAll(
  root: string,
  opts: { staleSeconds: number; carrier?: string },
  manifest: CarrierSpec[] = MANIFEST,
): AnalyzeOutcome {
  const specs = opts.carrier
    ? manifest.filter((m) => m.file === opts.carrier || path.basename(m.file) === opts.carrier)
    : manifest;
  const carriers = specs.map((spec) => analyzeCarrier(root, spec, opts.staleSeconds));
  const anyEvaluated = carriers.some((c) => c.evaluated);
  const anyDecayed = carriers.some((c) => c.decayed.length > 0);
  const decayedCount = carriers.reduce((n, c) => n + c.decayed.length, 0);
  return { carriers, anyEvaluated, anyDecayed, decayedCount };
}

function fmt(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toISOString();
}

function printHuman(outcome: AnalyzeOutcome): void {
  if (!outcome.anyDecayed) {
    console.log("instrument-decay-check: ok — no instrument decay (companion contrast found no stopped group)");
    return;
  }
  for (const c of outcome.carriers) {
    if (c.decayed.length === 0) continue;
    console.log(`INSTRUMENT-DECAY: .quay/${c.file} — ${c.decayed.length} group(s) stopped writing`);
    for (const d of c.decayed) {
      const extra = d.kind === "never-wrote"
        ? "never-wrote (0 records, expected — writer split to another file?)"
        : `rate-stopped (last=${fmt(d.lastWriteMs)}, ${d.count} records)`;
      console.log(`  decayed: ${d.group} — ${extra}`);
    }
    if (c.companions.length > 0) {
      const brief = c.companions
        .slice(0, 6)
        .map((cp) => `${cp.group} last=${fmt(cp.lastWriteMs)} (${cp.count})`)
        .join("; ");
      console.log(`  companion (still writing): ${brief}`);
    }
  }
}

function printJson(outcome: AnalyzeOutcome): void {
  const carriers = outcome.carriers.map((c) => ({
    file: c.file,
    evaluated: c.evaluated,
    reason: c.reason,
    totalRecords: c.totalRecords,
    freshest: fmt(c.freshestMs),
    groupCount: c.groupCount,
    decayed: c.decayed.map((d) => ({
      group: d.group,
      kind: d.kind,
      count: d.count,
      lastWrite: fmt(d.lastWriteMs),
    })),
    companions: c.companions.map((cp) => ({
      group: cp.group,
      count: cp.count,
      lastWrite: fmt(cp.lastWriteMs),
    })),
  }));
  console.log(JSON.stringify({
    ok: !outcome.anyDecayed,
    evaluated: outcome.anyEvaluated,
    decayedCount: outcome.decayedCount,
    carriers,
  }));
}

function parseArgs(argv: string[]): {
  root?: string; staleSeconds: number; carrier?: string; noBlock: boolean; json: boolean; help: boolean;
} {
  const out = { staleSeconds: DEFAULT_STALE_SECONDS, noBlock: false, json: false, help: false, root: undefined as string | undefined, carrier: undefined as string | undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { out.json = true; continue; }
    if (a === "--no-block") { out.noBlock = true; continue; }
    if (a === "--help" || a === "-h") { out.help = true; return out; }
    if (a === "--root") { out.root = argv[++i]; continue; }
    if (a === "--carrier") { out.carrier = argv[++i]; continue; }
    if (a === "--stale-seconds") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) throw new Error("--stale-seconds must be a non-negative integer (seconds)");
      out.staleSeconds = v;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

export function main(argv: string[]): number {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`instrument-decay-check: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (opts.help) {
    console.log(
      "instrument-decay-check.ts [--root <dir>] [--stale-seconds <n>] [--carrier <file>] [--no-block] [--json] — " +
      "P5 instrument-decay detector (companion contrast, not absolute rate). " +
      "0 = no decay, 1 = decay, 2 = usage/env error, 3 = NOT-EVALUATED (no carrier evaluable)."
    );
    return 0;
  }

  const root = opts.root ?? repoRoot(SCRIPT_DIR);
  if (!fs.existsSync(path.join(root, ".quay"))) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, evaluated: false, error: "not-a-workspace", root }));
    } else {
      console.error(`instrument-decay-check: not a workspace (no .quay/ dir): ${root}`);
    }
    return 2;
  }

  const outcome = analyzeAll(root, { staleSeconds: opts.staleSeconds, carrier: opts.carrier });

  if (!outcome.anyEvaluated) {
    // 全部清单载体都缺文件（verify worktree 无主检出运行时态，或载体尚未产生）——无法评估 ≠ 无腐烂。
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, evaluated: false, reason: "NOT-EVALUATED", carriers: outcome.carriers }));
    } else {
      console.log("instrument-decay-check: NOT-EVALUATED — no manifest carrier present under .quay/ (verify worktree has no main-checkout runtime state)");
    }
    return 3;
  }

  if (opts.json) {
    printJson(outcome);
  } else {
    printHuman(outcome);
  }

  if (opts.noBlock) return 0; // REPORT-ONLY 常驻路径：打印腐烂但永不红当前套件
  return outcome.anyDecayed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
