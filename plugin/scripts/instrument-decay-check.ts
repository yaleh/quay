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
// 两种【照常写入】的暗形态（gap-instrument-decay-check-unwired-and-blind-to-content-dark）：
//   C. content-dark   带 `evaluated` 字段的载体，从首条起每条都是 false（≥2 条记录——1 条可能是冷启动
//                     时序，这是最小结构条件，不是调出来的阈值）。载体在写，但写的全是「没评估成」。
//   D. stale-evaluated 最新一条有 evaluated:true 作用域的记录，其产物时间戳早于【覆盖源路径的最新提交】。
//                     它与真正的健康状态从外部看完全相同（读数说「已评估、0 环」），比 C 更危险。
//   两种形态都允许例外声明：描述符可注明 D 无输入（记录里没有产物时间戳/覆盖路径，或例程直接读 git）。
//
// 覆盖面诚实（硬规则 3b）：没有 `evaluated` 字段、也未登记描述符的载体列入 `uncovered`，
// ⛔ 不计入健康载体数——「没被检查」不得与「检查过且干净」同形。
//
// 扩展点：要检查一个新载体，只需在 MANIFEST（或调用方传入的 manifest）里登记一个描述符，
// ⛔ 不改本文件的判定逻辑（AC4 负控制测的就是这一点）。
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
import { spawnSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import { fileURLToPath } from "node:url";
import { parseArgs as baseParseArgs, printJsonCompact } from "./gate-script-base.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_STALE_SECONDS = 86400; // 24h 伴生陈旧间隔（只影响 Shape B）

// ── 已知载体清单（单一正源）─────────────────────────────────────────────────────────────────────────
// 每个载体声明：groupBy 分组字段、expected 期望分组词表（Shape A 判据：期望分组缺席 = 写手分裂）、
// shapeB 是否应用速率归零对照（Shape B）、note 写手溯源。词表是【人审查过的声明】，不是从代码推导——
// 它自己的腐烂（代码加了新步骤而清单没更新）归 P4 守卫谱系管，不是本检测器管。
export interface CarrierSpec {
  /** .quay/ 下的相对路径。 */
  file: string;
  /** 记录里哪个字段的值构成分组身份。缺省 ⇒ 本载体不做分组分析（形状 A/B 不适用）。 */
  groupBy?: string;
  /** 该载体应当出现的分组词表（Shape A：缺席 = 停写）。缺省 []。 */
  expected?: string[];
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
  /** 记录级 `evaluated` 字段名（形状 C 的输入）。缺省 ⇒ 形状 C 不适用。 */
  evaluatedField?: string;
  /** 形状 D 的输入：这份载体读的是【持久化产物】时，记录里产物时间戳与覆盖源路径的位置。
   *  缺省 ⇒ 形状 D 不适用；此时 `artifactNotApplicable` 必须写明为什么（⛔ 不静默跳过）。 */
  artifact?: ArtifactSpec;
  /** 形状 D 不适用的理由（与 `artifact` 二选一）。 */
  artifactNotApplicable?: string;
  /** 写手溯源——为什么这些分组【应当】在这个载体里。 */
  note: string;
}

/** 形状 D 的读取位置：每个「作用域」一条（覆盖源路径 + 产物时间戳 + 该作用域是否已评估）。 */
export interface ArtifactSpec {
  /** 记录里承载作用域数组的字段（如 `scopes`）。 */
  scopesField: string;
  /** 每个作用域里覆盖的源路径字段（repo 相对路径，交给 `git log -- <path>`）。 */
  sourceField: string;
  /** 每个作用域里产物时间戳字段（ISO 字符串）。 */
  artifactTsField: string;
  /** 每个作用域里的 evaluated 字段。缺省 ⇒ 用记录级 evaluated。 */
  scopeEvaluatedField?: string;
  /** 作用域名字段（报告里点名用）。缺省 `scope`。 */
  scopeNameField?: string;
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
      "共享载体停写而伴生步骤（merge-develop/typecheck/scoped-gate/ff）仍在写——P5 的字面实例。" +
      "【罕见但活着的例外路径，不是腐烂】verification-round-record：仅当本轮 suite 无结论" +
      "（看门狗 SIGKILL / 从未 spawn）时 force 写一条（worker-fan-in.ts recordDelegatedRound）；" +
      "quay 形态（suite_runner: quay-buckets）下普通红/绿轮由 full-suite-runner 入账、不走本组。" +
      "catch-up-develop：仅当 fan-in 的 mergeTarget ≠ develop（goal 分支落地）时才有这一步。" +
      "suite-recovery-blocked：仅当 suite 恢复阶梯耗尽（64/48/32 都无完整判词）时才写。",
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
  {
    // gap-instrument-decay-check-unwired-and-blind-to-content-dark：形态 C 的实测载体——25/25 条
    // record-level evaluated:false（首条 2026-10-18T10:25Z），载体照常写入但写进去的全是「未评估」。
    // 形态 D 的实测载体——src scope 读「已评估、0 环」，读的是 2026-10-21T16:17Z 的产物，而目录环在
    // 16:26Z/16:27Z 才被提交引入 ⇒ 与真正的健康读数从外部看完全相同。
    file: "arch-cycle-history.jsonl",
    evaluatedField: "evaluated",
    artifact: {
      scopesField: "scopes",
      sourceField: "source",
      artifactTsField: "artifactTimestamp",
      scopeEvaluatedField: "evaluated",
      scopeNameField: "scope",
    },
    note:
      "arch-cycle-report 例程每轮追加一行。记录级 evaluated 是「全部作用域都可读」；作用域级 evaluated " +
      "是「这一作用域可读」。形态 D 取**最后一条含已评估作用域**的记录（记录级 false 只表示并非全部" +
      "作用域可读，不表示什么都没评估）。作用域 source 是 repo 相对路径 ⇒ D 的对照量是 git 提交时刻。",
  },
  {
    // AC1 的负对照：31/31 条 evaluated:true ⇒ 形状 C 必须不命中（而不是「样本刚好绿」）。
    file: "arch-coverage-history.jsonl",
    evaluatedField: "evaluated",
    artifactNotApplicable:
      "记录不含『产物时间戳 + 覆盖源路径』对（analyzedBy 是 archguard scope key，不是产物时间）⇒ 形状 D 无输入",
    note:
      "arch-coverage-report 例程每轮追加一行（语言 × 覆盖状态）。它有 record-level evaluated，因此形态 C " +
      "适用；它读的是分析器注册表而不是逐作用域的持久化产物，故形态 D 按声明不适用。",
  },
  {
    // 形态 C 的边界：只有 1 条记录 ⇒ 冷启动时序，不足以下结论。形态 D 显式不适用（读 git，不读产物）。
    file: "design-evolution-history.jsonl",
    evaluatedField: "evaluated",
    artifactNotApplicable:
      "例程直接读 git 历史（RM1/RM2），没有可取时间戳的持久化产物 ⇒ 形状 D 按定义不适用",
    note:
      "design-evolution-readings 例程每轮追加一行。它读 git 历史与 worker-outcome 账本，不读持久化" +
      "分析产物 ⇒ 形状 D 按声明不适用；record-level evaluated 存在 ⇒ 形态 C 适用。",
  },
];

/** 已知但**未登记描述符**的载体（覆盖面的诚实声明）。
 *
 *  为什么需要（Plan item 4）：`uncovered` 必须可见，否则「检测器没有检查这个载体」与「检查过且干净」
 *  在读数上同形（硬规则 3b）。这不是一份「所有 jsonl」的清单——`.quay/` 里绝大多数文件不是读数载体；
 *  这里只列**读数型**载体中已知的漏网者。`evaluated` 字段的存在与否由检测器自己读首条记录判定，
 *  ⛔ 不在这份声明里复制（声明只写它为什么没有描述符）。 */
export interface UncoveredCarrier {
  file: string;
  note: string;
}

export const DECLARED_UNCOVERED: UncoveredCarrier[] = [
  {
    file: "measure-history.jsonl",
    note:
      "suite 每文件耗时账本（127 万+ 行，无 evaluated 字段）：它记录的是测量时长，不是「评估结论」，" +
      "本检测器的四种形状都没有输入。列入 uncovered 是为了不把它算进健康载体数。",
  },
];

export interface GroupStat {
  count: number;
  lastWriteMs: number | null;
}

/** 四种腐烂形态。前两种是「写入停止」，后两种是「照常写入但内容是暗的」。 */
export type DecayKind = "never-wrote" | "rate-stopped" | "content-dark" | "stale-evaluated";

export interface DecayFinding {
  group: string;
  kind: DecayKind;
  count: number;
  lastWriteMs: number | null;
  /** 读数细节（D：产物时间戳 vs 覆盖路径最新提交；C：暗区间）。 */
  detail: string | null;
}

export interface Companion {
  group: string;
  count: number;
  lastWriteMs: number | null;
}

/** 形状 C 的四态（⛔ 不用布尔：读不懂/冷启动不得与「健康」同形——硬规则 3b）。 */
export type ShapeCState = "dark" | "healthy" | "not-applicable" | "not-evaluated";

/** 从首条记录起的暗区间（持续 false 的前导段）。
 *
 *  WHY AN INTERVAL AND NOT A BOOLEAN (AC1「检测器报告暗区间，而不只报告当前状态」): a repair task can
 *  land while this detector is in flight, turning the carrier's newest record true. A reader must still be
 *  able to see that the carrier was dark from 2026-10-18T10:25Z for 25 records — otherwise the repair
 *  erases the evidence of the rot it repaired, and 「曾经暗过」 becomes indistinguishable from 「一直健康」. */
export interface ContentDarkInterval {
  /** 前导 false 段第一条记录的 ts（原始字符串；读不出 ⇒ null）。 */
  startTs: string | null;
  /** 前导 false 段最后一条记录的 ts。 */
  endTs: string | null;
  /** 前导 false 段的记录数。 */
  records: number;
  /** 段后出现了 true ⇒ 区间已结束（载体当前不再判暗）。 */
  ended: boolean;
}

export interface ShapeCReading {
  state: ShapeCState;
  /** 参与判定的记录数（已按 skipKind 过滤）。 */
  records: number;
  /** 其中 evaluated === false 的条数。 */
  falseRecords: number;
  reason: string | null;
  /** 前导暗区间；无 false 前导段 ⇒ null。⛔ 已结束的区间仍然报告（见类型注释）。 */
  darkInterval: ContentDarkInterval | null;
}

/** 形状 D：一个作用域的产物时间戳 vs 覆盖源路径的最新提交。 */
export interface StaleScopeReading {
  scope: string;
  source: string;
  artifactTs: string | null;
  artifactMs: number | null;
  commitMs: number | null;
  commitSha: string | null;
  state: "stale" | "fresh" | "not-evaluated";
  reason: string | null;
}

/** 形状 D 的四态（同上：`not-evaluated` 与 `fresh` 必须可区分）。 */
export type ShapeDState = "stale" | "fresh" | "not-applicable" | "not-evaluated";

export interface ShapeDReading {
  state: ShapeDState;
  reason: string | null;
  /** 判定所用记录的 ts（点名证据用）。 */
  recordTs: string | null;
  /** 该记录自带的 record-level `stale` 信号（arch-cycle 的「产物年龄 > 调度间隔」）。
   *  ⛔ 只携带、不参与 D 的判定：D 判的是「产物早于覆盖源码的最新提交」，与「产物年龄 > 间隔」是
   *  两件不同的事（gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts 明确要求
   *  不复用这个名字做新语义）。它此前**没有任何下游**，现在至少随 Fact 一起被消费。 */
  recordStale: boolean | null;
  scopes: StaleScopeReading[];
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
  /** 形状 C（内容全暗）读数——`not-applicable` 是描述符的声明，不是「查不到」。 */
  contentDark: ShapeCReading;
  /** 形状 D（过期的已评估）读数。 */
  staleEvaluated: ShapeDReading;
}

/** uncovered 的两种成因：声明已知但未登记；或**发现**带 evaluated 却无描述符（登记表自身漂移）。 */
export type UncoveredReason = "declared-uncovered" | "evaluated-but-undescribed";

export interface UncoveredEntry {
  file: string;
  reason: UncoveredReason;
  /** 文件此刻是否存在——「声明了但盘上没有」与「在盘上但没描述符」不是同一件事。 */
  present: boolean;
  note: string | null;
}

/** 读一个载体的全部记录（坏行跳过；skipKind 精确等于过滤，见 CarrierSpec.skipKind）。 */
export function readCarrierRecords(root: string, spec: CarrierSpec): Record<string, unknown>[] | null {
  const filePath = path.join(root, ".quay", spec.file);
  if (!fs.existsSync(filePath)) return null;
  const out: Record<string, unknown>[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const rec = parseLine(line);
    if (!rec) continue;
    if (spec.skipKind !== undefined && rec["kind"] === spec.skipKind) continue;
    out.push(rec);
  }
  return out;
}

/** 形状 C：带 record-level `evaluated` 的载体，从首条起每条都是 false（≥2 条）。
 *
 *  ⛔ 四态：少于 2 条 ⇒ `not-evaluated`（冷启动时序，不是「健康」）；某条缺布尔字段 ⇒ `not-evaluated`
 *  （读不懂 ≠ 合格，硬规则 3b）。≥2 是**最小结构条件**，不是调出来的阈值。
 *
 *  ⛔ 报告的是**前导暗区间**，不只是「此刻是否暗」：修复落地后（首条 true 出现）仍要把
 *  「从哪条起、覆盖多少条、到哪条结束」说出来（AC1）。因此 `healthy` 可以**同时**带一个
 *  `ended:true` 的区间——那不是当前腐烂，是刚刚被修复的腐烂的证据。 */
export function analyzeContentDarkness(records: Record<string, unknown>[], spec: CarrierSpec): ShapeCReading {
  const field = spec.evaluatedField;
  if (field === undefined) {
    return { state: "not-applicable", records: records.length, falseRecords: 0, reason: "descriptor does not declare an evaluated field", darkInterval: null };
  }
  if (records.length < 2) {
    return { state: "not-evaluated", records: records.length, falseRecords: 0, reason: `only ${records.length} record(s) — fewer than 2 is a cold-start timing, not a verdict`, darkInterval: null };
  }
  let falseRecords = 0;
  for (let i = 0; i < records.length; i++) {
    const v = records[i][field];
    if (typeof v !== "boolean") {
      return { state: "not-evaluated", records: records.length, falseRecords, reason: `record #${i} has no boolean '${field}' (got ${JSON.stringify(v)}) — cannot conclude`, darkInterval: null };
    }
    if (v === false) falseRecords++;
  }
  // 前导 false 段（从首条起）。records[i] 已校验为布尔 ⇒ 段后第一条必为 true。
  let run = 0;
  while (run < records.length && records[run][field] === false) run++;
  if (run === 0) {
    return { state: "healthy", records: records.length, falseRecords, reason: null, darkInterval: null };
  }
  const tsOf = (rec: Record<string, unknown>): string | null => (typeof rec["ts"] === "string" ? (rec["ts"] as string) : null);
  const darkInterval: ContentDarkInterval = {
    startTs: tsOf(records[0]),
    endTs: tsOf(records[run - 1]),
    records: run,
    ended: run < records.length,
  };
  if (!darkInterval.ended) {
    return {
      state: "dark",
      records: records.length,
      falseRecords,
      reason: `all ${records.length} record(s) are ${field}:false since the first record (${darkInterval.startTs ?? "ts unreadable"})`,
      darkInterval,
    };
  }
  return { state: "healthy", records: records.length, falseRecords, reason: null, darkInterval };
}

export interface GitCommitTime {
  ms: number | null;
  sha: string | null;
  error: string | null;
}

/** 覆盖源路径的最新提交（committer date）。空输出（该路径无提交）与 git 失败都返回 error ⇒ 未评估。 */
export function gitLatestCommitForPath(root: string, source: string): GitCommitTime {
  const r = spawnSync("git", ["-C", root, "log", "-1", "--format=%ct%x09%H", "--", source], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (r.error) return { ms: null, sha: null, error: r.error.message };
  if (r.status !== 0) {
    return { ms: null, sha: null, error: (String(r.stderr ?? "").trim().slice(0, 200)) || `git exited ${r.status}` };
  }
  const line = String(r.stdout ?? "").trim().split("\n")[0];
  if (!line) return { ms: null, sha: null, error: `no commit touches '${source}'` };
  const [ct, sha] = line.split("\t");
  const sec = Number(ct);
  if (!Number.isFinite(sec)) return { ms: null, sha: sha ?? null, error: `unparseable commit time '${ct}'` };
  return { ms: sec * 1000, sha: sha ?? null, error: null };
}

/** 形状 D：最新一条「含已评估作用域」的记录，其产物时间戳早于覆盖源路径的最新提交 ⇒ stale。
 *
 *  为什么取「含已评估作用域」而不是「record-level evaluated:true」：arch-cycle-history 的记录级
 *  evaluated 表示「**全部**作用域都可读」——一条记录可以是记录级 false 而仍有若干作用域已评估
 *  （实测最后一条就是：2 个作用域不可读、4 个可读）。只认记录级 true 会让 D 对这个真实载体无输入。
 *
 *  ⛔ 四态：无描述符 ⇒ not-applicable（并带 descriptor 给出的理由）；无可用记录 / 任一作用域读不出
 *  ⇒ not-evaluated；有 stale ⇒ stale；否则 fresh。 */
export function analyzeStaleEvaluated(records: Record<string, unknown>[], spec: CarrierSpec, root: string): ShapeDReading {
  const na = (reason: string): ShapeDReading => ({ state: "not-applicable", reason, recordTs: null, recordStale: null, scopes: [] });
  if (spec.evaluatedField === undefined || spec.artifact === undefined) {
    return na(spec.artifactNotApplicable ?? "descriptor declares no artifact (artifact timestamp + covered paths)");
  }
  const art = spec.artifact;
  const scopeEvaluated = (s: Record<string, unknown>, rec: Record<string, unknown>): boolean =>
    art.scopeEvaluatedField !== undefined
      ? s[art.scopeEvaluatedField] === true
      : rec[spec.evaluatedField as string] === true;

  let chosen: Record<string, unknown> | null = null;
  for (let i = records.length - 1; i >= 0; i--) {
    const arr = records[i][art.scopesField];
    if (!Array.isArray(arr)) continue;
    if (arr.some((s) => s !== null && typeof s === "object" && scopeEvaluated(s as Record<string, unknown>, records[i]))) {
      chosen = records[i];
      break;
    }
  }
  if (chosen === null) {
    return {
      state: "not-evaluated",
      reason: `no record carries an evaluated '${art.scopesField}' scope — cannot tell whether the artifact is stale`,
      recordTs: null,
      recordStale: null,
      scopes: [],
    };
  }

  const recordTs = typeof chosen["ts"] === "string" ? (chosen["ts"] as string) : null;
  const recordStale = typeof chosen["stale"] === "boolean" ? (chosen["stale"] as boolean) : null;
  const scopes: StaleScopeReading[] = [];
  for (const raw of chosen[art.scopesField] as unknown[]) {
    if (raw === null || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (!scopeEvaluated(s, chosen)) continue;
    const nameRaw = s[art.scopeNameField ?? "scope"];
    const scope = typeof nameRaw === "string" && nameRaw !== "" ? nameRaw : "<unset>";
    const sourceRaw = s[art.sourceField];
    const source = typeof sourceRaw === "string" ? sourceRaw : "";
    const artifactTsRaw = s[art.artifactTsField];
    const artifactTs = typeof artifactTsRaw === "string" && artifactTsRaw !== "" ? artifactTsRaw : null;
    const artifactMs = artifactTs === null ? null : (Number.isFinite(Date.parse(artifactTs)) ? Date.parse(artifactTs) : null);

    if (source === "") {
      scopes.push({ scope, source, artifactTs, artifactMs, commitMs: null, commitSha: null, state: "not-evaluated", reason: `scope has no '${art.sourceField}' — no covered path to compare against` });
      continue;
    }
    if (artifactMs === null) {
      scopes.push({ scope, source, artifactTs, artifactMs, commitMs: null, commitSha: null, state: "not-evaluated", reason: artifactTs === null ? `scope has no '${art.artifactTsField}'` : `unparseable artifact timestamp '${artifactTs}'` });
      continue;
    }
    const commit = gitLatestCommitForPath(root, source);
    if (commit.ms === null) {
      scopes.push({ scope, source, artifactTs, artifactMs, commitMs: null, commitSha: commit.sha, state: "not-evaluated", reason: `git could not resolve the latest commit: ${commit.error}` });
      continue;
    }
    // 严格小于：产物【早于】覆盖路径的最新提交才是过期。相等时无法区分先后 ⇒ 记 fresh（同一秒）。
    const stale = artifactMs < commit.ms;
    scopes.push({
      scope, source, artifactTs, artifactMs,
      commitMs: commit.ms, commitSha: commit.sha,
      state: stale ? "stale" : "fresh",
      reason: stale
        ? `artifact ${artifactTs} predates the latest commit touching ${source} (${new Date(commit.ms).toISOString()} ${commit.sha ?? ""})`.trim()
        : null,
    });
  }

  if (scopes.length === 0) {
    return { state: "not-evaluated", reason: "the chosen record carries no evaluated scope with a comparable artifact", recordTs, recordStale, scopes };
  }
  if (scopes.some((s) => s.state === "stale")) return { state: "stale", reason: null, recordTs, recordStale, scopes };
  if (scopes.some((s) => s.state === "not-evaluated")) return { state: "not-evaluated", reason: "at least one scope could not be compared", recordTs, recordStale, scopes };
  return { state: "fresh", reason: null, recordTs, recordStale, scopes };
}

/** 首条可解析记录（uncovered 发现只看这一条——measure-history 有 127 万行，⛔ 不整份读）。 */
function firstRecordOf(root: string, file: string): Record<string, unknown> | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(path.join(root, ".quay", file), "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      const rec = parseLine(line);
      if (rec) return rec;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* best-effort */ } }
  }
}

/** 没有登记描述符的载体清单。
 *
 *  两个来源，缺一即不诚实：
 *   ① DECLARED_UNCOVERED —— 人审查过的「已知但没有描述符」；
 *   ② **发现**：`.quay/*.jsonl` 首条记录带布尔 `evaluated` 却既无描述符也未声明 ⇒ 登记表自身漂移
 *      （新载体已经带上了评估语义，而没人给它登记描述符）。这正是本任务的形态 C 从源头消失前的样子。
 *  ⛔ 不带 `evaluated` 的随手数据文件（测试残留、证据包、度量账本）不在此列——检测器不假装检查一切。 */
export function discoverUncovered(root: string, manifest: CarrierSpec[] = MANIFEST): UncoveredEntry[] {
  const described = new Set(manifest.map((m) => m.file));
  const entries = new Map<string, UncoveredEntry>();
  for (const d of DECLARED_UNCOVERED) {
    if (described.has(d.file)) continue;
    entries.set(d.file, {
      file: d.file,
      reason: "declared-uncovered",
      present: fs.existsSync(path.join(root, ".quay", d.file)),
      note: d.note,
    });
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(root, ".quay")).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {
    return [...entries.values()];
  }
  for (const name of names) {
    if (described.has(name) || entries.has(name)) continue;
    const first = firstRecordOf(root, name);
    if (first !== null && typeof first["evaluated"] === "boolean") {
      entries.set(name, {
        file: name,
        reason: "evaluated-but-undescribed",
        present: true,
        note: "first record carries a boolean 'evaluated' but no descriptor is registered — shapes C/D cannot be applied; register a descriptor",
      });
    }
  }
  return [...entries.values()].sort((a, b) => a.file.localeCompare(b.file));
}

// ── 单载体分析 ──────────────────────────────────────────────────────────────────────────────────────
export function analyzeCarrier(root: string, spec: CarrierSpec, staleSeconds: number): CarrierResult {
  const empty: CarrierResult = {
    file: spec.file, evaluated: false, reason: "carrier-missing",
    totalRecords: 0, freshestMs: null, groupCount: 0, decayed: [], companions: [],
    contentDark: { state: "not-evaluated", records: 0, falseRecords: 0, reason: "carrier-missing", darkInterval: null },
    staleEvaluated: { state: "not-evaluated", reason: "carrier-missing", recordTs: null, recordStale: null, scopes: [] },
  };
  const records = readCarrierRecords(root, spec);
  if (records === null) return empty;

  const totalRecords = records.length;
  const groups = new Map<string, GroupStat>();
  if (spec.groupBy !== undefined) {
    for (const rec of records) {
      const key = String(rec[spec.groupBy] ?? "<unset>");
      const ts = extractTsMs(rec);
      const g = groups.get(key) ?? { count: 0, lastWriteMs: null };
      g.count++;
      if (ts !== null && (g.lastWriteMs === null || ts > g.lastWriteMs)) g.lastWriteMs = ts;
      groups.set(key, g);
    }
  }

  let freshestMs: number | null = null;
  for (const g of groups.values()) {
    if (g.lastWriteMs !== null && (freshestMs === null || g.lastWriteMs > freshestMs)) freshestMs = g.lastWriteMs;
  }

  const decayed: DecayFinding[] = [];

  // Shape A：期望分组 0 条记录，而载体整体有记录（产生路径还在跑、只是这批事件转移去了别处）。
  if (totalRecords > 0 && spec.groupBy !== undefined) {
    for (const exp of spec.expected ?? []) {
      const g = groups.get(exp);
      if (!g || g.count === 0) {
        decayed.push({ group: exp, kind: "never-wrote", count: 0, lastWriteMs: null, detail: null });
      }
    }
  }

  // Shape B：有历史记录的分组，末次写入比载体最新（伴生分组仍在写）老超过 staleSeconds。
  if (spec.shapeB !== false && freshestMs !== null && staleSeconds > 0) {
    const gapMs = staleSeconds * 1000;
    for (const [k, g] of groups) {
      if (g.count === 0 || g.lastWriteMs === null) continue;
      if (freshestMs - g.lastWriteMs > gapMs) {
        decayed.push({ group: k, kind: "rate-stopped", count: g.count, lastWriteMs: g.lastWriteMs, detail: null });
      }
    }
  }

  // Shape C：载体在写，但写进去的全是「没评估成」。
  const contentDark = analyzeContentDarkness(records, spec);
  if (contentDark.state === "dark") {
    const lastWriteMs = records.reduce<number | null>((acc, r) => {
      const ts = extractTsMs(r);
      return ts !== null && (acc === null || ts > acc) ? ts : acc;
    }, null);
    decayed.push({
      group: "(all records)",
      kind: "content-dark",
      count: records.length,
      lastWriteMs,
      detail: contentDark.darkInterval === null
        ? contentDark.reason
        : `${contentDark.reason}; darkInterval=[${contentDark.darkInterval.startTs ?? "?"} .. now], ${contentDark.darkInterval.records} record(s)`,
    });
  }

  // Shape D：已评估，但读到的产物早于它覆盖的源码的最新提交。
  const staleEvaluated = analyzeStaleEvaluated(records, spec, root);
  for (const s of staleEvaluated.scopes) {
    if (s.state !== "stale") continue;
    decayed.push({
      group: s.scope,
      kind: "stale-evaluated",
      count: 1,
      lastWriteMs: s.artifactMs,
      detail: s.reason,
    });
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
    contentDark, staleEvaluated,
  };
}

export interface AnalyzeOutcome {
  carriers: CarrierResult[];
  anyEvaluated: boolean;
  anyDecayed: boolean;
  decayedCount: number;
  /** 未覆盖的载体（⛔ 不计入 healthyCount）。 */
  uncovered: UncoveredEntry[];
  uncoveredCount: number;
  /** 已登记、可评估、且没有任何腐烂读数的载体数。 */
  healthyCount: number;
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
  // --carrier 是聚焦查询：覆盖面对它不是读数（只报它自己），⛔ 不因此把整个 .quay 扫一遍。
  const uncovered = opts.carrier ? [] : discoverUncovered(root, manifest);
  const healthyCount = carriers.filter((c) => c.evaluated && c.decayed.length === 0).length;
  return { carriers, anyEvaluated, anyDecayed, decayedCount, uncovered, uncoveredCount: uncovered.length, healthyCount };
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
function fmt(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toISOString();
}

function describeFinding(d: DecayFinding): string {
  switch (d.kind) {
    case "never-wrote":
      return "never-wrote (0 records, expected — writer split to another file?)";
    case "rate-stopped":
      return `rate-stopped (last=${fmt(d.lastWriteMs)}, ${d.count} records)`;
    case "content-dark":
      return `content-dark (${d.count} record(s), every one evaluated:false — the carrier writes, but writes "not evaluated")`;
    case "stale-evaluated":
      return `stale-evaluated (artifact=${fmt(d.lastWriteMs)} predates the newest commit touching its source)`;
  }
}

function printHuman(outcome: AnalyzeOutcome): void {
  for (const c of outcome.carriers) {
    if (c.decayed.length === 0) continue;
    console.log(`INSTRUMENT-DECAY: .quay/${c.file} — ${c.decayed.length} finding(s)`);
    for (const d of c.decayed) {
      console.log(`  decayed: ${d.group} — ${describeFinding(d)}`);
      if (d.detail) console.log(`    detail: ${d.detail}`);
    }
    if (c.companions.length > 0) {
      const brief = c.companions
        .slice(0, 6)
        .map((cp) => `${cp.group} last=${fmt(cp.lastWriteMs)} (${cp.count})`)
        .join("; ");
      console.log(`  companion (still writing): ${brief}`);
    }
  }
  // 已结束的暗区间（AC1）：修复落地后当前不再判暗，但「曾经从哪条起暗了多少条」必须仍然可见。
  for (const c of outcome.carriers) {
    const iv = c.contentDark.darkInterval;
    if (iv !== null && iv.ended) {
      console.log(`INSTRUMENT-HISTORY: .quay/${c.file} — content-dark interval ended: ${iv.startTs ?? "?"} .. ${iv.endTs ?? "?"} (${iv.records} record(s)); current reading is not dark`);
    }
  }
  // 覆盖面（⛔ 不与健康同形）：未覆盖的载体单独列出，且明说它们不在健康计数里。
  if (outcome.uncoveredCount > 0) {
    console.log(`UNCOVERED: ${outcome.uncoveredCount} carrier(s) have no descriptor — NOT counted as healthy:`);
    for (const u of outcome.uncovered) {
      console.log(`  ${u.file} (${u.reason}${u.present ? "" : ", absent"}${u.note ? `) — ${u.note}` : ")"}`);
    }
  }
  if (!outcome.anyDecayed) {
    console.log(`instrument-decay-check: ok — no instrument decay (${outcome.healthyCount} carrier(s) healthy, ${outcome.uncoveredCount} uncovered)`);
  }
}

// Renamed from `printJson` when its terminal write moved to the shared emitter: the local name is
// the payload BUILDER's, and `printJson` now names the imported emitter (gate-script-base.ts).
function printDecayReport(outcome: AnalyzeOutcome): void {
  const carriers = outcome.carriers.map((c) => ({
    file: c.file,
    evaluated: c.evaluated,
    reason: c.reason,
    totalRecords: c.totalRecords,
    freshest: fmt(c.freshestMs),
    groupCount: c.groupCount,
    contentDark: c.contentDark,
    staleEvaluated: {
      state: c.staleEvaluated.state,
      reason: c.staleEvaluated.reason,
      recordTs: c.staleEvaluated.recordTs,
      recordStale: c.staleEvaluated.recordStale,
      scopes: c.staleEvaluated.scopes.map((s) => ({
        scope: s.scope,
        source: s.source,
        artifactTs: s.artifactTs,
        commitTs: fmt(s.commitMs),
        commitSha: s.commitSha,
        state: s.state,
        reason: s.reason,
      })),
    },
    decayed: c.decayed.map((d) => ({
      group: d.group,
      kind: d.kind,
      count: d.count,
      lastWrite: fmt(d.lastWriteMs),
      detail: d.detail,
    })),
    companions: c.companions.map((cp) => ({
      group: cp.group,
      count: cp.count,
      lastWrite: fmt(cp.lastWriteMs),
    })),
  }));
  // Compact shape from the shared emitter (gate-script-base.ts) — this file carried a local copy of
  // the same terminal write; semantic-dedup-scan finding `print-json-three-behaviours` (5b sweep).
  printJsonCompact({
    ok: !outcome.anyDecayed,
    evaluated: outcome.anyEvaluated,
    decayedCount: outcome.decayedCount,
    healthyCount: outcome.healthyCount,
    uncoveredCount: outcome.uncoveredCount,
    uncovered: outcome.uncovered,
    carriers,
  });
}

// Thin adapter over the ONE canonical parser (gate-script-base.ts `parseArgs`) — this file carried one
// of the six hand-rolled token loops filed by a `semantic-dedup-scan` pass as
// `parse-args-adoption-split` (routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1791908616513`,
// verdict `divergent-implementation`). It keeps this command's flag set and its THROW-based usage
// model (`main` catches and prefixes the message). `argv` is the WHOLE `process.argv` (the retired
// loop started at index 2 precisely because of that) — the shared parser does the `slice(2)`.
function parseArgs(argv: string[]): {
  root?: string; staleSeconds: number; carrier?: string; noBlock: boolean; json: boolean; help: boolean;
} {
  const parsed = baseParseArgs(argv, {
    minArgs: 0,
    usage: "[--root <dir>] [--stale-seconds <n>] [--carrier <file>] [--no-block] [--json]",
    help: "return",
    errors: "return",
    unknown: "reject",
    flags: {
      root: { type: "string" },
      "stale-seconds": { type: "string" },
      carrier: { type: "string" },
      "no-block": { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (parsed.error) throw new Error(parsed.error);
  if (parsed.args.length > 0) throw new Error(`unknown argument: ${parsed.args[0]}`);
  const str = (v: string | boolean | undefined): string | undefined => (typeof v === "string" ? v : undefined);
  let staleSeconds = DEFAULT_STALE_SECONDS;
  if (parsed.flags["stale-seconds"] !== undefined) {
    const raw = parsed.flags["stale-seconds"];
    // "" is the shared parser's spelling for a flag that carried NO value; the retired loop's
    // `Number(argv[++i])` read that as NaN and threw. Kept — laundering it into 0 would be a ceiling
    // the user never named (硬规则 3b).
    const v = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new Error("--stale-seconds must be a non-negative integer (seconds)");
    staleSeconds = v;
  }
  return {
    root: str(parsed.flags.root),
    staleSeconds,
    carrier: str(parsed.flags.carrier),
    noBlock: parsed.flags["no-block"] === true,
    json: parsed.flags.json === true,
    help: parsed.help === true,
  };
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
    printDecayReport(outcome);
  } else {
    printHuman(outcome);
  }

  if (opts.noBlock) return 0; // REPORT-ONLY 常驻路径：打印腐烂但永不红当前套件
  return outcome.anyDecayed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
