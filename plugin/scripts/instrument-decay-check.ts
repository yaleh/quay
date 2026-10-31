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
// 形状 B 的裁定（adjudication，gap-fan-in-step-trace-rate-stopped-adjudication）：
//   Shape B 只能看见「末次写入太旧」，它无法区分【按设计罕见/条件性不可达】与【写手腐烂】——两者
//   在输出上同形（硬规则 3b）。描述符因此可以携带**机器可读**的裁定声明（`adjudicated`）：
//     • rare-by-design       —— 该分组只在罕见例外路径上写；触发未发生 ⇒ 缺席是正常的。
//     • conditional-on-input —— 该分组的输入条件当前恒假（例：持续基线红让 rerun 绿分支不可达）；
//                                条件命令 exit 0 ⇒ 缺席已解释，exit≠0 ⇒ 条件不再成立 ⇒ 仍报腐烂。
//   ⛔ 裁定**必须可过期**：`reviewAfter` 是必填项，过了就回到 decayed[]（不提供永久豁免开关）。
//   ⛔ 裁定不是豁免的隐身衣：被裁定的分组进独立的 `adjudicated[]`，**计数与读数照样输出**，
//      只是不计入 `decayedCount` —— 「不算腐烂」不得等于「从读数里消失」。
//
// 两种【照常写入】的暗形态（gap-instrument-decay-check-unwired-and-blind-to-content-dark）：
//   C. content-dark   带 `evaluated` 字段的载体，从首条起每条都是 false（≥2 条记录——1 条可能是冷启动
//                     时序，这是最小结构条件，不是调出来的阈值）。载体在写，但写的全是「没评估成」。
//   D. stale-evaluated 最新一条有 evaluated:true 作用域的记录，其产物时间戳早于【覆盖源路径的最新提交】。
//                     它与真正的健康状态从外部看完全相同（读数说「已评估、0 环」），比 C 更危险。
//                     ⚠️ 例外：描述符用 `artifactIndependentWhen` 声明的 live 读数（如
//                     `basis:"single-directory"`，结论来自 `git ls-files` 而非产物）不做这个比较，
//                     并**显式**记 `artifact-independent`（⛔ 不是静默跳过，硬规则 3b）。
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
import { isDirectEntry, parseArgs as baseParseArgs, printJsonCompact } from "./gate-script-base.ts";

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
  /** 形状 B 的机器可读裁定声明（见头注「形状 B 的裁定」）。缺省 []。 */
  adjudicated?: Adjudication[];
  /** 写手溯源——为什么这些分组【应当】在这个载体里。 */
  note: string;
}

/** 裁定的两种形态。 */
export type AdjudicationKind = "rare-by-design" | "conditional-on-input";

/** 一条机器可读的裁定声明（描述符的一部分，人审查过；⛔ 不是自由文本 note 的替代品——
 *  note 从不被判定逻辑读取，这正是本任务修的缺陷）。 */
export interface Adjudication {
  /** 被裁定的分组名（与 Shape B 的分组键精确相等）。 */
  group: string;
  kind: AdjudicationKind;
  /** 为什么缺席是正常的（一句话；空串 ⇒ 声明无效，不产生豁免）。 */
  reason: string;
  /** 仅 `conditional-on-input`：可执行的条件读数命令（在载体 root 下 `sh -c` 执行）。
   *  exit 0 ⇒ 声明的条件仍成立（缺席已解释）；exit≠0 / 超时 / spawn 失败 ⇒ 条件不成立 ⇒ 仍报腐烂
   *  （fail-closed 到「报腐烂」，不是 fail-open 到「已解释」）。 */
  conditionCmd?: string;
  /** 裁定失效时刻（ISO，必填）。过了 ⇒ 分组回到 `decayed[]`。⛔ 留空/读不懂 ⇒ 不产生豁免。 */
  reviewAfter: string;
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
  /** 「该作用域的 cycle 结论不依赖产物」的机器可读判定（gap-arch-cycle-single-directory-basis-never-due）。
   *
   *  为什么需要：有些读数的 provenance 是 LIVE 输入（`single-directory` 的 `git ls-files`），
   *  `artifactTimestamp` 只是「我们看过哪份产物」，不承载结论。此前检测器看不到这个区别 ⇒ 一条
   *  **当前**的 live 读数只要挂着旧产物时间戳就被判 stale；而写手侧为了绕开它写了一个恒为 0 的
   *  `commitsSinceArtifact`（硬规则 4：恒真的量不是测量）。
   *  `field` 取到 `equals` ⇒ 该作用域记 `artifact-independent`，**显式跳过**产物 vs 提交比较
   *  （⛔ 不是静默跳过：跳过这件事本身进读数，硬规则 3b）。
   *  缺省 ⇒ 没有这种作用域，既有比较对所有作用域生效。 */
  artifactIndependentWhen?: {
    field: string;
    equals: string | boolean;
    /** 载体自己记录的直接量字段名（live file list 的读取时刻）。缺省 ⇒ 不读取时刻，
     *  读数里显式写 `readAt:null`（「没记」而不是「等于 0」）。 */
    readAtField?: string;
  };
}

/** suite-recovery / suite-recovery-blocked 共用的条件读数（两者由同一段恢复阶梯代码写，
 *  缺席的直接成因是同一个：阶梯有没有「降档」或「耗尽」）。
 *
 *  语义：取【最近一次降档(suite-recovery) 或 耗尽(blocked)】的时刻作为窗口起点；窗口内每一条
 *  suite-incomplete 都必须在同一 task 上等到一条 suite-recovery-accepted（或 baseline-exempt）。
 *  ——「恢复轮自己定论了」= certifiedRun !== null ⇒ 这两个终端分支的触发不存在。
 *  ⛔ 不是「本组多久没写」的二次包装：它读的是触发输入本身，输入一变条件立刻取假。
 *  ⛔ 与检测器同口径排除 kind=goal-merge（那不是任务 fan-in 的步骤链）。 */
export const RECOVERY_LADDER_CONDITION_CMD =
  `node -e 'const fs=require("fs");const R=[];` +
  `for(const l of fs.readFileSync(".quay/fan-in-step-trace.jsonl","utf8").split("\\n")){` +
  `if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}` +
  `if(r.kind==="goal-merge")continue;R.push(r)}` +
  `let start=null;` +
  `for(const r of R)if((r.step==="suite-recovery"||r.step==="suite-recovery-blocked")&&r.ts&&(!start||r.ts>start))start=r.ts;` +
  `if(!start)process.exit(1);` +
  `const after=R.filter(r=>r.ts&&r.ts>start);` +
  `const cert=after.filter(r=>r.step==="suite-recovery-accepted"||r.step==="suite-recovery-baseline-exempt");` +
  `const inc=after.filter(r=>r.step==="suite-incomplete");` +
  `let bad=0;` +
  `for(const r of inc)if(!cert.some(c=>c.ts>r.ts&&c.task===r.task))bad++;` +
  `process.exit(bad===0?0:1)'`;

/** suite-incomplete 的触发输入读数（gap-instrument-decay-suite-recovery-groups-unadjudicated）。
 *
 *  触发 = 一次**原轮**的 suite 日志里带 SUITE-INCOMPLETE 标记（worker-fan-in.ts:2960 解析、:2961 判定、
 *  :2970 写本组）。同一个标记由 runner 按**同一谓词**同时落到轮次账本：`full-suite-runner.ts:4873-4878`
 *  把 `incomplete (missing/planned)` 或 `oom-killed (n)` 写进记录的 `notEvaluated`，`:5125` 的
 *  `if (incomplete || oomKilled)` 才是印标记行的条件 ⇒ `.quay/verification-round.jsonl` 是**独立于
 *  本组写手**的同源读数。本条件就数它：**有没有一轮真的没得出完整结论**。⛔ 不是「本组多久没写」的
 *  二次包装——窗口内一次 incomplete 都没有，与「本组 40h 没写」是两个量，后者由 Shape B 本身暴露。
 *
 *  ⚠️ 两个必须的结构判据（否则条件会在 OOM 风暴后恒红）：
 *  ① **恢复轮与原轮共用 runId**（worker-fan-in.ts 的 `recoverySuiteCommand` 复用同一条 suite 命令，
 *     只改 `--lane-count`/`--log-file`）⇒「同一 runId 的第一条 = 原轮，其余 = 恢复轮」是结构判据；
 *  ② 恢复轮自己即使又被 OOM 杀，也**不会**写 suite-incomplete（阶梯只写 suite-recovery）⇒ 必须排除。
 *     实测：170 条 incomplete/OOM 轮次里 105 条是恢复轮，不排除会把「修复后首次 OOM 风暴」误判成腐烂。
 *
 *  ⚠️ 时间窗 120s：实测「轮次记录落盘 → suite-incomplete 落盘」间隔 6.5–9.5s（65 个样本，p90 9.3s），
 *     12 倍余量；⛔ 不用「零条 incomplete」这种空转真值换绿（orig===0 ⇒ exit 1）。末尾另有一条
 *     「账本仍与载体同步」的守卫：末次 suite-incomplete 之后要么还有轮次跑过、要么它自己那轮的记录
 *     就落在同一个 120s 窗里（写在两个不同 else 分支里）；两者皆无 ⇒ 账本已停写，读数不可信 ⇒ fail-closed。
 *
 *  ⛔ 与检测器同口径排除 kind=goal-merge（那不是任务 fan-in 的步骤链）。 */
export const SUITE_INCOMPLETE_TRIGGER_CMD =
  `node -e 'const fs=require("fs");const R=[];` +
  `for(const l of fs.readFileSync(".quay/fan-in-step-trace.jsonl","utf8").split("\\n")){` +
  `if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}` +
  `if(r.kind==="goal-merge")continue;R.push(r)}` +
  `const inc=R.filter(r=>r.step==="suite-incomplete"&&r.ts);` +
  `let last=null;for(const r of inc)if(!last||r.ts>last)last=r.ts;` +
  `if(!last)process.exit(1);` +
  `let raw;try{raw=fs.readFileSync(".quay/verification-round.jsonl","utf8")}catch{process.exit(1)}` +
  `const V=[];` +
  `for(const l of raw.split("\\n")){if(!l.trim())continue;let v;try{v=JSON.parse(l)}catch{continue}` +
  `if(v&&typeof v.startedAt==="string")V.push(v)}` +
  `if(V.length===0)process.exit(1);` +
  `const first=new Map();` +
  `for(const v of V){if(!v.runId)continue;const p=first.get(v.runId);if(!p||v.startedAt<p.startedAt)first.set(v.runId,v)}` +
  `const endMs=v=>Date.parse(v.startedAt)+(Number.isFinite(v.durationMs)?v.durationMs:0);` +
  `const trig=v=>{const n=typeof v.notEvaluated==="string"?v.notEvaluated:"";` +
  `return n.indexOf("incomplete ")===0||n.indexOf("oom-killed ")===0};` +
  `let orig=0,bad=0;` +
  `for(const v of V){if(first.get(v.runId)!==v)continue;if(!trig(v))continue;orig++;` +
  `const e=endMs(v);` +
  `if(!inc.some(r=>r.task===v.taskId&&Math.abs(Date.parse(r.ts)-e)<120000))bad++}` +
  `if(orig===0)process.exit(1);` +
  `if(bad>0)process.exit(1);` +
  `if(!V.some(v=>Date.parse(v.startedAt)>Date.parse(last))&&` +
  `!V.some(v=>Math.abs(endMs(v)-Date.parse(last))<120000))process.exit(1);` +
  `process.exit(0)'`;

/** suite-recovery-accepted 的触发输入读数：**有没有一条 incomplete 等不到阶梯定论**。
 *
 *  本组的触发是「恢复阶梯的某一档给出了完整判词 ⇒ certifiedRun !== null ⇒ 认证」。阶梯的**每一条**
 *  suite-incomplete 都必然以二者之一收尾（worker-fan-in.ts:3135 的 blocked / :3150 的 accepted），
 *  所以「一条 incomplete 之后既没有 accepted 也没有 blocked」= 阶梯卡住或认证写手腐烂 ⇒ 缺席无解释。
 *  ⛔ 不是「本组多久没写」：它读的是 incomplete 与阶梯终端的配对关系（就是 AC 里那句
 *  「是否有 incomplete 等不到认证」），配对上就立刻取假。 */
export const RECOVERY_ACCEPTED_TRIGGER_CMD =
  `node -e 'const fs=require("fs");const R=[];` +
  `for(const l of fs.readFileSync(".quay/fan-in-step-trace.jsonl","utf8").split("\\n")){` +
  `if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}` +
  `if(r.kind==="goal-merge")continue;R.push(r)}` +
  `const inc=R.filter(r=>r.step==="suite-incomplete"&&r.ts);` +
  `if(inc.length===0)process.exit(1);` +
  `let bad=0;` +
  `for(const r of inc)if(!R.some(c=>c.ts&&c.task===r.task&&c.ts>r.ts&&` +
  `(c.step==="suite-recovery-accepted"||c.step==="suite-recovery-blocked")))bad++;` +
  `process.exit(bad===0?0:1)'`;

/** suite-recovery-baseline-exempt 的触发输入读数：**每一次认证走的是哪一条分支**。
 *
 *  本组的触发是「恢复轮完整跑完但真红、且红集与基线逐字等价、且候选自己的 Touches 测试干净」
 *  （worker-fan-in.ts:3103 在 `be.verdict.kind === "exempt"` 分支里写）。认证有且只有两条来路：
 *  `suite-recovery-certified`（恢复轮本身是绿的，:3063）或 `suite-recovery-baseline-exempt`（:3103）
 *  —— 二者必居其一，且都在紧随其后的 `suite-recovery-accepted`（:3150）**之前**落盘。
 *  因此「一条 accepted 在其前置 incomplete 之后找不到 certified 也找不到 exempt」= 认证发生在一个
 *  没有记录来路的出口上 ⇒ exempt 写手腐烂（那条 trace 被删/被改路径）。
 *  ⛔ 不是「本组多久没写」的二次包装：读的是每次认证**走的分支**；分支一变条件立刻取假。
 *  ⛔ 同时排除 kind=goal-merge。 */
export const RECOVERY_EXEMPT_TRIGGER_CMD =
  `node -e 'const fs=require("fs");const R=[];` +
  `for(const l of fs.readFileSync(".quay/fan-in-step-trace.jsonl","utf8").split("\\n")){` +
  `if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}` +
  `if(r.kind==="goal-merge")continue;R.push(r)}` +
  `const acc=R.filter(r=>r.step==="suite-recovery-accepted"&&r.ts);` +
  `if(acc.length===0)process.exit(1);` +
  `let bad=0;` +
  `for(const a of acc){let prev=null;` +
  `for(const r of R)if(r.step==="suite-incomplete"&&r.task===a.task&&r.ts&&r.ts<a.ts&&(!prev||r.ts>prev))prev=r.ts;` +
  `if(prev===null){bad++;continue}` +
  `if(!R.some(r=>r.task===a.task&&r.ts&&r.ts>=prev&&r.ts<=a.ts&&` +
  `(r.step==="suite-recovery-certified"||r.step==="suite-recovery-baseline-exempt")))bad++}` +
  `process.exit(bad===0?0:1)'`;

/** baseline-red-exempt 的触发输入读数（gap-instrument-decay-baseline-red-exempt-unadjudicated；
 *  gap-instrument-decay-baseline-red-exempt-condition-stale-proxy 修正过期代理）。
 *
 *  写手 `worker-fan-in.ts:3482-3487`：主路径的既存红等价 A/B（`runBaselineEquivalence`，其 `traceVerdict`
 *  在 :2810-2820 写 `baseline-red` 步）判出 `exempt` 时，紧接着写本组。判据是纯函数
 *  `compareFailureSignatures`（:1420-1446）：**`exempt` ⇔ task 侧红签名集合 ⊆ baseline 侧红签名集合**。
 *  ⇒ 本组的真实触发是「窗口内至少一条 A/B 判 `exempt`」，与 baseline 红集**是否为空无关**：baseline 非空
 *  且 task 引入基线之外的新红（`added>0`）时，`exempt ⇔ task 红集 ⊆ baseline 红集` 同样不成立。
 *
 *  条件读的是【窗口内 A/B 判词的形态】，⛔ 不是「本组多久没写」的二次包装：
 *    ① 窗口 = 末次 `baseline-red-exempt` 之后；窗口内必须 **≥1 条 A/B**（⛔「一次 A/B 都没有」不得当作
 *       解释——那是空转真值）；
 *    ② `baselineFiles` 字段必须可读（⛔ 缺值/读不懂 ⇒ exit 1，硬规则 6/3b：没查 ≠ 合格）。⛔ 不得再检查
 *       `baselineFiles` 的取值——「baseline 为空 ⇒ exempt 不可达」是特例代理，baseline 非空 + added>0 时
 *       exempt 同样不可达（2026-10-30 实读：窗口内 4 条 A/B 全 hard-red、其中 2 条 baselineFiles=2，旧条件
 *       把「baseline 非空」误当成「exempt 可达」而恒误报 rate-stopped）；
 *    ③ 写手腐烂守卫：每条 `exempt` 的 `baseline-red` 都必须等到**同 task** 的一条收尾——主路径
 *       `baseline-red-exempt`（:3484）或恢复阶梯 `suite-recovery-baseline-exempt`（:3390）。两条都要认，
 *       因为两条路径调的是**同一个** `runBaselineEquivalence`、都会写一条 `baseline-red`；恢复阶梯的收尾
 *       不是本组 ⇒ ⛔ 不得把它读成「主路径豁免未落痕」（近名陷阱）。一条 exempt 在下一个同 task 的 A/B
 *       之前（或 EOF 前）没有收尾 ⇒ 写手腐烂 ⇒ exit 1。
 *  ⛔ 同时排除 kind=goal-merge（那不是任务 fan-in 的步骤链，与检测器同口径）。 */
export const BASELINE_RED_EXEMPT_TRIGGER_CMD =
  `node -e 'const fs=require("fs");const R=[];` +
  `for(const l of fs.readFileSync(".quay/fan-in-step-trace.jsonl","utf8").split("\\n")){` +
  `if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}` +
  `if(r.kind==="goal-merge")continue;R.push(r)}` +
  `let last=null;` +
  `for(const r of R)if(r.step==="baseline-red-exempt"&&r.ts&&(!last||r.ts>last))last=r.ts;` +
  `if(!last)process.exit(1);` +
  `const W=R.filter(r=>r.step==="baseline-red"&&r.ts&&r.ts>last);` +
  `if(W.length===0)process.exit(1);` +
  `const nums=W.filter(r=>typeof r.baselineFiles==="number");` +
  `if(nums.length===0)process.exit(1);` +
  `const byTask=new Map();` +
  `for(const r of R)if(r.task&&r.ts){const a=byTask.get(r.task)||[];a.push(r);byTask.set(r.task,a)}` +
  `let bad=0;` +
  `for(const [t,recs] of byTask){` +
  `recs.sort((a,b)=>a.ts<b.ts?-1:a.ts>b.ts?1:0);` +
  `let pending=false;` +
  `for(const r of recs){` +
  `if(r.step==="baseline-red"){if(pending)bad++;pending=r.verdict==="exempt"}` +
  `else if((r.step==="baseline-red-exempt"||r.step==="suite-recovery-baseline-exempt")&&pending)pending=false}` +
  `if(pending)bad++}` +
  `process.exit(bad===0?0:1)'`;

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
    // 12 个 rate-stopped 分组的机器可读裁定：前 5 条来自 gap-fan-in-step-trace-rate-stopped-adjudication
    // （触发普查为 0 的三组、条件性不可达的一组、真回归信号一组）；接着 3 条（suite-skip /
    // suite-recovery / suite-recovery-blocked）来自 gap-instrument-decay-explained-absence-declarations
    // ——同一批分组此前已在 2026-10-22、2026-10-23 两次被**散文**裁定过，第三次才落成机制；
    // 最后 3 条（suite-incomplete / suite-recovery-accepted / suite-recovery-baseline-exempt）来自
    // gap-instrument-decay-suite-recovery-groups-unadjudicated——同一条 OOM→incomplete→恢复链的**下游**终端。
    // ⚠️ reviewAfter 一律是**必须重看的日期**，不是「永久白名单」——过期即回到 decayed[]。
    // ⚠️ conditional-on-input 的条件命令读的都是【载体里的触发输入】，不是「本组多久没写」：
    //    「原因仍然缺席」与「写手还活着」是两个量，条件只对前者负责；写手腐烂由 Shape B 本身暴露。
    adjudicated: [
      {
        group: "verification-round-record",
        kind: "rare-by-design",
        reason:
          "recordDelegatedRound(force) 只在 hungByWatchdog || spawnFailed 时补写；watchdog-killed 全历史 7 轮、" +
          "最后一轮 startedAt 2026-10-14T11:21:43Z（早于本组末次写入 2026-10-14T11:41:51Z），spawn-failed 全历史 0 轮" +
          " ⇒ 触发事件没有发生，写手路径仍在。",
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "catch-up-develop",
        kind: "rare-by-design",
        reason:
          "只有 fan-in 的 mergeTarget != develop（任务落回 goal 分支）才走 `if (mergeTarget !== \"develop\")` 这一步；" +
          "最后一次 goal 落地 2026-10-10T19:27:53Z 之后 goal-merge 执行 0 次、当前不存在 goal/* 分支 ⇒ 输入不存在。",
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-rerun-green",
        kind: "conditional-on-input",
        reason:
          "in-round rerun 的绿分支被持续基线红遮蔽，读的只是这个机制：只要还有一个基线红文件挡住 suite，" +
          "rerun 就只可能回来 rerun-red 或 rerun-not-evaluated（后者是「没评估成」的第三态，不是绿）⇒ 绿分支条件性不可达。" +
          "当前实例是 plugin/test/full-suite-runner-cgroup.test.mjs 的 AC3（a REAL round's measured concurrency）" +
          "——**文件名是实例说明，不是条件的一部分**：红的是哪个文件会随修/坏翻转，把实例写进条件会让裁定随之为随机读数。" +
          "条件读的是【末次 suite-rerun-green 之后的每一条 rerun 记录】：出现一条 rerun-green、没有任何 rerun、" +
          "或出现未知/缺失 state，本裁定立即失效、回到 decayed[]。",
        // ⚠️ 只读、亚秒级、可证伪：窗口 = 末次 suite-rerun-green 写入之后；窗口内断言 ① 至少一条 rerun
        //    （⛔ 不用「零 rerun」这种空转真值换绿）② 没有一条 rerun-green ③ 每条状态都是已知的
        //    rerun-red / rerun-not-evaluated。
        // ⛔ 触发式而非实例式：⛔ 不点名任何文件（旧写法把「被声明为红的那一个文件」钉进正/负控制，
        //    于是该文件转绿后条件恒 exit 1 —— 声明的机制没变，声明的实例过期了；且「换了个红文件」与
        //    「写手真腐烂」在读数上同形，硬规则 3b）。
        // ⛔ 三态不得压成布尔（硬规则 3b）：rerun-not-evaluated 是写手明确保留的第三态，不得读成「原因消失」；
        //    未知/缺失态与服务端「窗口内出现 rerun-green」一样 fail-closed 到 exit 1（不豁免）。
        // ⛔ 不读 append-only 的 baseline-red 台账——那份台账只增不减，一旦为真就永远为真（单向闩锁不是读数）。
        // ⛔ 与检测器同口径排除 kind=goal-merge（那不是任务 fan-in 的步骤链）。
        conditionCmd:
          `node -e 'const fs=require("fs");const R=[];` +
          `for(const l of fs.readFileSync(".quay/fan-in-step-trace.jsonl","utf8").split("\\n")){` +
          `if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}` +
          `if(r.kind==="goal-merge")continue;R.push(r)}` +
          `let last=null;` +
          `for(const r of R)if(r.step==="suite-rerun-green"&&r.ts&&(!last||r.ts>last))last=r.ts;` +
          `if(!last)process.exit(1);` +
          `const after=R.filter(r=>r.step==="rerun"&&r.ts&&r.ts>last);` +
          `if(after.length===0)process.exit(1);` +
          `for(const r of after)if(r.state!=="rerun-red"&&r.state!=="rerun-not-evaluated")process.exit(1);` +
          `process.exit(0)'`,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-recovery-certified",
        kind: "rare-by-design",
        reason:
          "「恢复轮干净跑完」的终端分支；2026-10-21T04:50:38Z 之后恢复流程仍发生 7 次，全部经另一终端分支 " +
          "suite-recovery-baseline-exempt 落地并写 suite-recovery-accepted（7 条）⇒ 恢复机制在跑，只是 certified 触发未发生。",
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-recovery-new-regression",
        kind: "rare-by-design",
        reason:
          "只在「原并发下通过的文件在更低并发下变红」时写（suite-recovery 阶梯的 new-regression 分支），" +
          "全历史 1 条 ⇒ 真回归信号，本身低频。",
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-skip",
        kind: "conditional-on-input",
        reason:
          "写手 worker-fan-in.ts:3265 只在 needSuite === false（codeDelta === \"\" 的 doc-only 落地，或 reuseSkip 的 " +
          "develop-advance-doc-only-reuse）时写本组。末次写入 2026-10-23T08:42:04.648Z 是 gap-goal911-… 的一次真实" +
          "doc-only 落地（per-run delta 逐字记 \"doc-only delta → skip suite\"）；此后载体里有 23 个含 ff 的落地" +
          "（2026-10-25 实读），其中唯一没有 suite-start 的正是写出这条 suite-skip 的那个落地本身 ⇒ 跳过分支的输入" +
          "没有再发生。条件读的是【末次 suite-skip 之后的每一次落地】：任何一个含 ff 却没有 suite-start 的落地" +
          "（且不是末次 suite-skip 自己那次）⇒ 本裁定立即失效、回到 decayed[]。",
        // ⚠️ 只读、亚秒级、可证伪：按 task 关联（runId 在生产载体里恒为 wk-prod-anchor，不能当作 run 键），
        //    并要求窗口内至少一次落地（⛔ 不用「零落地」这种空转真值换绿）。
        // ⛔ 与检测器同口径排除 kind=goal-merge：那不是任务 fan-in 的步骤链（见描述符 skipKind 注释）。
        conditionCmd:
          `node -e 'const fs=require("fs");const R=[];` +
          `for(const l of fs.readFileSync(".quay/fan-in-step-trace.jsonl","utf8").split("\\n")){` +
          `if(!l.trim())continue;let r;try{r=JSON.parse(l)}catch{continue}` +
          `if(r.kind==="goal-merge")continue;R.push(r)}` +
          `let last=null;` +
          `for(const r of R)if(r.step==="suite-skip"&&r.ts&&(!last||r.ts>last.ts))last=r;` +
          `if(!last)process.exit(1);` +
          `const seen=new Map();` +
          `for(const r of R){if(!r.ts||r.ts<=last.ts||!r.task)continue;` +
          `const e=seen.get(r.task)||{ff:false,start:false};` +
          `if(r.step==="ff")e.ff=true;if(r.step==="suite-start")e.start=true;seen.set(r.task,e)}` +
          `let ff=0,bad=0;` +
          `for(const [t,e] of seen){if(!e.ff)continue;ff++;if(t!==last.task&&!e.start)bad++}` +
          `process.exit(ff>0&&bad===0?0:1)'`,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-recovery",
        kind: "conditional-on-input",
        reason:
          "写手 worker-fan-in.ts:3042/:3051 只在某个恢复档返回 no-conclusion 或 incomplete（**降档**）时写。" +
          "末次写入 2026-10-23T23:15:27.308Z（OOM 风暴末轮）之后 suite-incomplete 发生 2 次" +
          "（2026-10-24T00:01:07.835Z、2026-10-24T15:43:31.916Z，均 oom-killed），两次恢复轮都在第一档" +
          "（concurrency 64）就产出自己的完整判词并写 suite-recovery-accepted + suite-recovery-baseline-exempt" +
          "（00:15:35.319Z、16:01:38.392Z），降档 0 次 ⇒ 本组自己的触发没有发生；读数的下降是 OOM 修复的结果，" +
          "不是写手停摆。条件读的是【最近一次降档/耗尽之后的每一条 suite-incomplete】：任何一条在同一 task 上" +
          "等不到 suite-recovery-accepted / suite-recovery-baseline-exempt ⇒ 本裁定立即失效、回到 decayed[]。",
        // ⚠️ 窗口起点 = 本组最近一次写入与 blocked 最近一次写入的**较大者**（两者由同一段阶梯代码写，
        //    任一发生都意味着阶梯确实动了 ⇒ 之前的 incomplete 已被那次动作解释）。窗口内只要有一条
        //    incomplete 没等到认证，就说明恢复轮没能自己定论——那正是腐烂该露头的形状。
        conditionCmd: RECOVERY_LADDER_CONDITION_CMD,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-recovery-blocked",
        kind: "conditional-on-input",
        reason:
          "写手 worker-fan-in.ts:3135 只在 certifiedRun === null（阶梯耗尽、没有任何一档给出完整判词）时写。" +
          "末次写入 2026-10-23T23:15:27.308Z 之后 suite-incomplete 2 次、两次都在第一档被认证" +
          "（certifiedRun !== null）⇒ 触发没有发生；本组 44 条自 2026-10-14 起、最近 20 个间隔中位数 0.6h、" +
          "全历史最大 1.8h，当前约 24h 远超自身节奏——这是「罕见的条件性缺席」，不是写手腐烂。条件与 " +
          "suite-recovery 同一条：最近一次降档/耗尽之后每条 suite-incomplete 都必须等到后续认证。",
        conditionCmd: RECOVERY_LADDER_CONDITION_CMD,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      // ── 后 3 条：OOM→incomplete→恢复阶梯那条因果链的**下游**（gap-instrument-decay-suite-recovery-
      //    groups-unadjudicated）。上游 4 组（suite-skip / suite-recovery / suite-recovery-blocked /
      //    suite-recovery-certified…）已由前两条任务裁定；这 3 组是同一个 `if (incompleteMarker !== null)`
      //    的终端分支，2026-10-23 / 2026-10-25 两次被**散文**裁定过、第三次才落成机制（硬规则 5b 的兄弟
      //    实例遗漏形态）。⛔ 三条条件读的都是【触发输入】，不是「本组多久没写」。
      {
        group: "suite-incomplete",
        kind: "conditional-on-input",
        reason:
          "写手 worker-fan-in.ts:2970，进入条件是 :2960 `extractSuiteIncompleteMarker(suiteLogText)` 非 null" +
          "（:2961）——即本轮 suite 日志里带了 runner 印的 SUITE-INCOMPLETE 标记（`oom-killed (n)` /" +
          "`incomplete (missing/planned files)`）。同一谓词由 runner 独立落进 .quay/verification-round.jsonl 的" +
          "`notEvaluated` 字段（full-suite-runner.ts:4873-4878，印标记行的 :5125 是同一个 `incomplete || oomKilled`）" +
          "⇒ 条件读的是**轮次账本**：只要出现一条【原轮】（同 runId 的第一条——恢复轮与它共用 runId）" +
          "`notEvaluated` 以 `incomplete `/`oom-killed ` 开头、而载体里 120s 内没有对应的 suite-incomplete，" +
          "就说明「一轮真的没得出完整结论」却没有被记录 ⇒ 本裁定立即失效、回到 decayed[]。" +
          "反之窗口内没有这样的原轮 = 触发确实没发生（本组 63→65 条的历史成因是 OOM 风暴，已由" +
          "gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency / -lane-scaled-ladder-floor-32 修）。",
        // ⚠️ 只读、亚秒级、可证伪；⛔ 恢复轮必须排除（它们自己也 OOM 时不写本组，留着会让条件在风暴后恒红）。
        conditionCmd: SUITE_INCOMPLETE_TRIGGER_CMD,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-recovery-accepted",
        kind: "conditional-on-input",
        reason:
          "写手 worker-fan-in.ts:3150，只在恢复阶梯的某一档给出**完整判词**（certifiedRun !== null ⇒ 认证）" +
          "时写；它与 :3103 的 baseline-exempt 同在 `if (incompleteMarker !== null)` 阶梯内部，没有 incomplete" +
          " 就结构上不可达。条件读的是「**有没有一条 incomplete 等不到认证**」：阶梯的每一条 suite-incomplete" +
          "都必然以同一 task 上的 suite-recovery-accepted（:3150）或 suite-recovery-blocked（:3135）收尾，" +
          "任何一条 incomplete 之后二者皆无 ⇒ 阶梯卡住或认证写手腐烂 ⇒ 本裁定立即失效、回到 decayed[]。",
        conditionCmd: RECOVERY_ACCEPTED_TRIGGER_CMD,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "suite-recovery-baseline-exempt",
        kind: "conditional-on-input",
        reason:
          "写手 worker-fan-in.ts:3103，在 `be.verdict.kind === \"exempt\"`（恢复轮红集与基线逐字等价）且候选" +
          "自己的 Touches 测试干净时写；同样只在 incomplete 阶梯内部可达。条件读的是「每一次认证**走的哪条" +
          "分支**」：认证只有两条来路——suite-recovery-certified（:3063，恢复轮本身就是绿的）或" +
          "suite-recovery-baseline-exempt（:3103，本组）——且都落盘在紧随其后的 suite-recovery-accepted（:3150）" +
          "之前。任何一条 accepted 在其前置 incomplete 之后两条来路都找不到 ⇒ 认证发生在一个没有记录的出口上" +
          "⇒ 本组写手腐烂（那段 trace 被删/改路径）⇒ 本裁定立即失效、回到 decayed[]。",
        conditionCmd: RECOVERY_EXEMPT_TRIGGER_CMD,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
      {
        group: "baseline-red-exempt",
        kind: "conditional-on-input",
        reason:
          "写手 worker-fan-in.ts:3482-3487（**主路径**的既存红等价 A/B 出口）：判据是纯函数 " +
          "compareFailureSignatures（:1420-1446），exempt ⇔ task 红集 ⊆ baseline 红集 ⇒ 本组的真实触发是" +
          "「窗口内至少一条 A/B 判 exempt」，与 baseline 红集是否为空无关——baseline 非空且 task 引入基线之外" +
          "的新红（added>0）时 exempt 同样不可达。全历史 79 条（2026-10-13T00:53:58Z → 2026-10-27T04:58:55Z，" +
          "间隔中位数 0.58h）= 主流终端分支，不是 rare-by-design。条件读的是【窗口内 A/B 判词的形态】：" +
          "末次本组写入之后必须 ≥1 条 A/B（⛔ 零 A/B 不是解释）、baselineFiles 字段可读（⛔ 缺值/读不懂即" +
          "fail-closed，不检查其取值——baseline 是否为空不是 exempt 可达性的判据）、且每条 exempt 的" +
          "baseline-red 都必须等到同 task 的收尾（主路径 baseline-red-exempt 或恢复阶梯" +
          "suite-recovery-baseline-exempt——两条路径共用同一个 runBaselineEquivalence，恢复阶梯的收尾⛔ 不得被" +
          "读成主路径写手腐烂）。任何一条不成立 ⇒ 本裁定立即失效、回到 decayed[]。",
        conditionCmd: BASELINE_RED_EXEMPT_TRIGGER_CMD,
        reviewAfter: "2026-11-22T00:00:00.000Z",
      },
    ],
    note:
      "worker-driver.ts 机械 fan-in 步骤链。前 8 个经 step()/appendFanInStepTrace 写共享载体；" +
      "后 4 个（ac-precheck/suite-*）自 a5a301e03 起被 trace() 改写到 per-run 日志，" +
      "共享载体停写而伴生步骤（merge-develop/typecheck/scoped-gate/ff）仍在写——P5 的字面实例。" +
      "【罕见但活着的例外路径，不是腐烂】verification-round-record：仅当本轮 suite 无结论" +
      "（看门狗 SIGKILL / 从未 spawn）时 force 写一条（worker-fan-in.ts recordDelegatedRound）；" +
      "quay 形态（suite_runner: quay-buckets）下普通红/绿轮由 full-suite-runner 入账、不走本组。" +
      "catch-up-develop：仅当 fan-in 的 mergeTarget ≠ develop（goal 分支落地）时才有这一步。" +
      "suite-recovery-blocked：仅当 suite 恢复阶梯耗尽（64/48/32 都无完整判词）时才写。" +
      "suite-incomplete / suite-recovery-accepted / suite-recovery-baseline-exempt：同一条 " +
      "incomplete 标记的下游终端（原始轮记录 / 阶梯认证 / 基线等价认证），触发未发生即结构性缺席。",
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
      // gap-arch-cycle-single-directory-basis-never-due: a `single-directory` scope's cycle count comes
      // from `git ls-files` at read time, NOT from the persisted artifact — so an old
      // `artifactTimestamp` is provenance, not evidence that the reading is stale. Without this the
      // detector reported `scripts` stale every round while the carrier simultaneously reported it as
      // a current reading (`commitsSinceArtifact:0`), i.e. the two readings disagreed by construction.
      artifactIndependentWhen: { field: "basis", equals: "single-directory", readAtField: "fileListReadAt" },
    },
    note:
      "arch-cycle-report 例程每轮追加一行。记录级 evaluated 是「全部作用域都可读」；作用域级 evaluated " +
      "是「这一作用域可读」。形态 D 取**最后一条含已评估作用域**的记录（记录级 false 只表示并非全部" +
      "作用域可读，不表示什么都没评估）。作用域 source 是 repo 相对路径 ⇒ D 的对照量是 git 提交时刻。" +
      "作用域 basis=single-directory 时读数是 live 文件列表派生的 ⇒ 标 artifact-independent，不做" +
      "「产物 vs 最新提交」比较（⛔ 跳过本身进读数）。",
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
  /** 读数细节（D：产物时间戳 vs 覆盖路径最新提交；C：暗区间；B 的裁定被拒：拒绝理由）。 */
  detail: string | null;
}

/** 一条**生效中**的裁定（形状 B 命中 + 声明存在 + 未过期 + 条件成立）。
 *
 *  ⛔ 它不出现在 `decayed[]`、不计入 `decayedCount`，但**必须**出现在输出里（含 count / lastWrite）：
 *  「不算腐烂」不等于「从读数里消失」（AC5 / 硬规则 3b）。 */
export interface AdjudicatedFinding {
  group: string;
  /** 声明里的裁定种类。 */
  kind: AdjudicationKind;
  /** 生效后的读数态：按设计罕见 / 条件成立故缺席已解释。 */
  state: "rare-by-design" | "explained-absent";
  reason: string;
  reviewAfter: string;
  /** `conditional-on-input` 的条件读数（命令 + 退出码）；`rare-by-design` ⇒ null。 */
  condition: { cmd: string; exitCode: number | null; error: string | null } | null;
  /** 该分组此刻的真实读数——裁定不隐藏它。 */
  count: number;
  lastWriteMs: number | null;
}

/** 裁定求值结果：`exempt:false` 时 `denialReason` 写进 DecayFinding.detail（为什么豁免不成立）。 */
export interface AdjudicationVerdict {
  exempt: boolean;
  finding: AdjudicatedFinding | null;
  denialReason: string | null;
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

/** 形状 D：一个作用域的产物时间戳 vs 覆盖源路径的最新提交。
 *
 *  `state:"artifact-independent"` 是一条**通过**的读数，不是「未评估」：该作用域的 cycle 结论来自
 *  live 输入，产物时间戳只承载 provenance ⇒ 「产物早于最新提交」对它不构成过期证据。它必须自成一态
 *  （⛔ 不与 `fresh` 合并、更不与 `stale` 合并：跳过比较这件事本身要可读）。 */
export interface StaleScopeReading {
  scope: string;
  source: string;
  artifactTs: string | null;
  artifactMs: number | null;
  commitMs: number | null;
  commitSha: string | null;
  state: "stale" | "fresh" | "not-evaluated" | "artifact-independent";
  reason: string | null;
  /** `state:"artifact-independent"` 时为判定依据（描述符字段/取值 + 载体自己记的 live 读取时刻）；
   *  其余为 null。 */
  independence: ArtifactIndependence | null;
}

/** 一条 artifact-independence 判定：**哪个字段**取到什么值，以及载体记录的 live 直接量。
 *  ⛔ `readAt` 取的是载体里的字段（判据能取假），不是描述符的回显。 */
export interface ArtifactIndependence {
  field: string;
  value: string | boolean;
  /** 载体里 live file list 的读取时刻；字段缺失/读不懂 ⇒ null（「没记」，⛔ 不是「刚读过」）。 */
  readAt: string | null;
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
  /** 被判定为 artifact-independent 的作用域名（`state:"artifact-independent"` 的同一批，记录级点名）。
   *  ⛔ 空数组 = 「比过了」；这一态与 `state:"fresh"` 同时出现是正常的（live 读数当前、产物不承载
   *  结论）——它把「为什么没做那个比较」留在读数面上（硬规则 3b）。 */
  artifactIndependentScopes: string[];
}

export interface CarrierResult {
  file: string;
  evaluated: boolean;
  reason: string | null;
  totalRecords: number;
  freshestMs: number | null;
  groupCount: number;
  decayed: DecayFinding[];
  /** 生效中的裁定（Shape B 命中但被解释）。⛔ 不计入 decayed，但必须可见。 */
  adjudicated: AdjudicatedFinding[];
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
  const na = (reason: string): ShapeDReading => ({ state: "not-applicable", reason, recordTs: null, recordStale: null, scopes: [], artifactIndependentScopes: [] });
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
      artifactIndependentScopes: [],
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

    // ARTIFACT INDEPENDENCE first (gap-arch-cycle-single-directory-basis-never-due): if the descriptor
    // says this scope's field marks a live reading, the artifact timestamp is PROVENANCE ONLY. Compare
    // nothing and say so — an old artifact must not make a current live reading look stale, and ⛔ the
    // skip must not be silent (硬规则 3b: "skipped" and "checked and fresh" are different facts).
    const independenceSpec = art.artifactIndependentWhen;
    if (independenceSpec !== undefined && s[independenceSpec.field] === independenceSpec.equals) {
      const readAtRaw = independenceSpec.readAtField === undefined ? undefined : s[independenceSpec.readAtField];
      const readAt = typeof readAtRaw === "string" && readAtRaw !== "" ? readAtRaw : null;
      scopes.push({
        scope, source, artifactTs, artifactMs,
        commitMs: null, commitSha: null,
        state: "artifact-independent",
        reason:
          `'${independenceSpec.field}'='${String(independenceSpec.equals)}' ⇒ this reading comes from the live file list` +
          `${readAt === null ? " (no read timestamp recorded)" : ` read at ${readAt}`}, so ${art.artifactTsField} ${artifactTs ?? "(none)"} ` +
          `is provenance only and is NOT compared against the latest commit touching ${source || "(no source)"}`,
        independence: { field: independenceSpec.field, value: independenceSpec.equals, readAt },
      });
      continue;
    }

    if (source === "") {
      scopes.push({ scope, source, artifactTs, artifactMs, commitMs: null, commitSha: null, state: "not-evaluated", reason: `scope has no '${art.sourceField}' — no covered path to compare against`, independence: null });
      continue;
    }
    if (artifactMs === null) {
      scopes.push({ scope, source, artifactTs, artifactMs, commitMs: null, commitSha: null, state: "not-evaluated", reason: artifactTs === null ? `scope has no '${art.artifactTsField}'` : `unparseable artifact timestamp '${artifactTs}'`, independence: null });
      continue;
    }
    const commit = gitLatestCommitForPath(root, source);
    if (commit.ms === null) {
      scopes.push({ scope, source, artifactTs, artifactMs, commitMs: null, commitSha: commit.sha, state: "not-evaluated", reason: `git could not resolve the latest commit: ${commit.error}`, independence: null });
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
      independence: null,
    });
  }

  const artifactIndependentScopes = scopes.filter((s) => s.state === "artifact-independent").map((s) => s.scope);
  if (scopes.length === 0) {
    return { state: "not-evaluated", reason: "the chosen record carries no evaluated scope with a comparable artifact", recordTs, recordStale, scopes, artifactIndependentScopes };
  }
  if (scopes.some((s) => s.state === "stale")) return { state: "stale", reason: null, recordTs, recordStale, scopes, artifactIndependentScopes };
  if (scopes.some((s) => s.state === "not-evaluated")) return { state: "not-evaluated", reason: "at least one scope could not be compared", recordTs, recordStale, scopes, artifactIndependentScopes };
  // No stale, nothing unevaluable ⇒ fresh. Scopes that were SKIPPED because they are artifact-
  // independent are named in `artifactIndependentScopes` — the verdict is "fresh" only for the
  // comparisons that actually happened.
  return { state: "fresh", reason: null, recordTs, recordStale, scopes, artifactIndependentScopes };
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

// ── 形状 B 的裁定求值 ──────────────────────────────────────────────────────────────────────────────
/** 条件命令的 wall-clock 上限（毫秒）。⛔ 这不是成本阈值，是**活性安全界**：条件命令由描述符声明，
 *  设计上只读、亚秒级；一个挂死的命令不得把常驻检测器一起挂住。 */
export const ADJUDICATION_CONDITION_TIMEOUT_MS = 60_000;

/** 求值一条裁定声明。
 *
 *  四态而非布尔（硬规则 3b）：**读不懂的声明不产生豁免**——缺 reason / reviewAfter 读不出 / 未知 kind /
 *  conditional-on-input 缺条件命令，全部走 `exempt:false` + 一个可读的 `denialReason`（该分组照常报腐烂）。
 *  失败方向必须偏向「报腐烂」：条件是「当前结构性不可达」，它一旦不成立就该重新看见腐烂。 */
export function evaluateAdjudication(
  root: string,
  decl: Adjudication,
  count: number,
  lastWriteMs: number | null,
  nowMs: number,
): AdjudicationVerdict {
  const deny = (why: string): AdjudicationVerdict => ({ exempt: false, finding: null, denialReason: why });
  const reason = typeof decl.reason === "string" ? decl.reason.trim() : "";
  if (reason === "") return deny("adjudication carries no reason — a bare exemption is not an adjudication");
  const reviewMs = typeof decl.reviewAfter === "string" ? Date.parse(decl.reviewAfter) : NaN;
  if (!Number.isFinite(reviewMs)) {
    return deny(
      `adjudication reviewAfter ${JSON.stringify(decl.reviewAfter)} is unreadable — an adjudication must be expirable`,
    );
  }
  if (reviewMs <= nowMs) {
    return deny(
      `adjudication expired at ${decl.reviewAfter} — re-review it (an adjudication is not a permanent exemption)`,
    );
  }
  if (decl.kind !== "rare-by-design" && decl.kind !== "conditional-on-input") {
    return deny(`unknown adjudication kind ${JSON.stringify(decl.kind)}`);
  }
  if (decl.kind === "rare-by-design") {
    return {
      exempt: true,
      finding: {
        group: decl.group, kind: decl.kind, state: "rare-by-design",
        reason, reviewAfter: decl.reviewAfter, condition: null, count, lastWriteMs,
      },
      denialReason: null,
    };
  }
  const cmd = typeof decl.conditionCmd === "string" ? decl.conditionCmd.trim() : "";
  if (cmd === "") return deny("conditional-on-input adjudication carries no conditionCmd — there is no reading to trust");
  const r = spawnSync("sh", ["-c", cmd], {
    cwd: root,
    encoding: "utf8",
    timeout: ADJUDICATION_CONDITION_TIMEOUT_MS,
  });
  if (r.error || r.status !== 0) {
    const why = r.error
      ? `spawn error: ${r.error.message}`
      : `exit ${r.status === null ? `signal ${String(r.signal)}` : r.status}`;
    return deny(`condition command did not hold (${why}) — the declared cause is gone; the absence is unexplained`);
  }
  return {
    exempt: true,
    finding: {
      group: decl.group, kind: decl.kind, state: "explained-absent",
      reason, reviewAfter: decl.reviewAfter,
      condition: { cmd, exitCode: r.status, error: String(r.stderr ?? "").trim().slice(0, 200) || null },
      count, lastWriteMs,
    },
    denialReason: null,
  };
}

// ── 单载体分析 ──────────────────────────────────────────────────────────────────────────────────────
export function analyzeCarrier(
  root: string,
  spec: CarrierSpec,
  staleSeconds: number,
  nowMs: number = Date.now(),
): CarrierResult {
  const empty: CarrierResult = {
    file: spec.file, evaluated: false, reason: "carrier-missing",
    totalRecords: 0, freshestMs: null, groupCount: 0, decayed: [], adjudicated: [], companions: [],
    contentDark: { state: "not-evaluated", records: 0, falseRecords: 0, reason: "carrier-missing", darkInterval: null },
    staleEvaluated: { state: "not-evaluated", reason: "carrier-missing", recordTs: null, recordStale: null, scopes: [], artifactIndependentScopes: [] },
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
  // 命中后先问描述符有没有对它的裁定声明：未过期且条件成立 ⇒ 进 adjudicated[]（读数照出，不计腐烂）。
  const adjudications = new Map<string, Adjudication>();
  for (const a of spec.adjudicated ?? []) {
    if (typeof a.group === "string" && a.group !== "" && !adjudications.has(a.group)) adjudications.set(a.group, a);
  }
  const adjudicated: AdjudicatedFinding[] = [];
  if (spec.shapeB !== false && freshestMs !== null && staleSeconds > 0) {
    const gapMs = staleSeconds * 1000;
    for (const [k, g] of groups) {
      if (g.count === 0 || g.lastWriteMs === null) continue;
      if (freshestMs - g.lastWriteMs > gapMs) {
        const decl = adjudications.get(k);
        if (decl !== undefined) {
          const verdict = evaluateAdjudication(root, decl, g.count, g.lastWriteMs, nowMs);
          if (verdict.exempt && verdict.finding !== null) {
            adjudicated.push(verdict.finding);
            continue;
          }
          decayed.push({ group: k, kind: "rate-stopped", count: g.count, lastWriteMs: g.lastWriteMs, detail: verdict.denialReason });
          continue;
        }
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
    totalRecords, freshestMs, groupCount: groups.size, decayed, adjudicated, companions,
    contentDark, staleEvaluated,
  };
}

export interface AnalyzeOutcome {
  carriers: CarrierResult[];
  anyEvaluated: boolean;
  anyDecayed: boolean;
  decayedCount: number;
  /** 生效中的裁定总数。⛔ 与 decayedCount 分开计数——它们不是腐烂，但也不得消失。 */
  adjudicatedCount: number;
  /** 未覆盖的载体（⛔ 不计入 healthyCount）。 */
  uncovered: UncoveredEntry[];
  uncoveredCount: number;
  /** 已登记、可评估、且没有任何腐烂读数的载体数。 */
  healthyCount: number;
}

export function analyzeAll(
  root: string,
  opts: { staleSeconds: number; carrier?: string; nowMs?: number },
  manifest: CarrierSpec[] = MANIFEST,
): AnalyzeOutcome {
  const specs = opts.carrier
    ? manifest.filter((m) => m.file === opts.carrier || path.basename(m.file) === opts.carrier)
    : manifest;
  const nowMs = opts.nowMs ?? Date.now();
  const carriers = specs.map((spec) => analyzeCarrier(root, spec, opts.staleSeconds, nowMs));
  const anyEvaluated = carriers.some((c) => c.evaluated);
  const anyDecayed = carriers.some((c) => c.decayed.length > 0);
  const decayedCount = carriers.reduce((n, c) => n + c.decayed.length, 0);
  const adjudicatedCount = carriers.reduce((n, c) => n + c.adjudicated.length, 0);
  // --carrier 是聚焦查询：覆盖面对它不是读数（只报它自己），⛔ 不因此把整个 .quay 扫一遍。
  const uncovered = opts.carrier ? [] : discoverUncovered(root, manifest);
  const healthyCount = carriers.filter((c) => c.evaluated && c.decayed.length === 0).length;
  return { carriers, anyEvaluated, anyDecayed, decayedCount, adjudicatedCount, uncovered, uncoveredCount: uncovered.length, healthyCount };
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
  // 生效中的裁定：不在腐烂清单里，但**照样打印**（⛔ 「不算腐烂」≠「从读数里消失」）。
  for (const c of outcome.carriers) {
    if (c.adjudicated.length === 0) continue;
    console.log(`INSTRUMENT-ADJUDICATED: .quay/${c.file} — ${c.adjudicated.length} group(s) adjudicated (NOT counted as decay)`);
    for (const a of c.adjudicated) {
      const cond = a.condition === null
        ? ""
        : ` condition=${a.condition.cmd} exit=${a.condition.exitCode === null ? "?" : a.condition.exitCode}`;
      console.log(
        `  adjudicated: ${a.group} — ${a.state} (last=${fmt(a.lastWriteMs)}, ${a.count} records)${cond}; ` +
        `reviewAfter=${a.reviewAfter}; ${a.reason}`,
      );
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
    const adj = outcome.adjudicatedCount > 0 ? `, ${outcome.adjudicatedCount} adjudicated (not decay)` : "";
    console.log(`instrument-decay-check: ok — no instrument decay (${outcome.healthyCount} carrier(s) healthy${adj}, ${outcome.uncoveredCount} uncovered)`);
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
      /** 未做「产物 vs 提交」比较的 live 读数（显式点名——跳过必须可读，硬规则 3b）。 */
      artifactIndependentScopes: c.staleEvaluated.artifactIndependentScopes,
      scopes: c.staleEvaluated.scopes.map((s) => ({
        scope: s.scope,
        source: s.source,
        artifactTs: s.artifactTs,
        commitTs: fmt(s.commitMs),
        commitSha: s.commitSha,
        state: s.state,
        reason: s.reason,
        independence: s.independence,
      })),
    },
    decayed: c.decayed.map((d) => ({
      group: d.group,
      kind: d.kind,
      count: d.count,
      lastWrite: fmt(d.lastWriteMs),
      detail: d.detail,
    })),
    // 生效中的裁定：独立读数面（⛔ 不计入 decayedCount，但**必须**在这里，否则「已裁定例外」
    // 就从读数里消失了——那正是本任务要修的缺陷的镜像）。
    adjudicated: c.adjudicated.map((a) => ({
      group: a.group,
      kind: a.kind,
      state: a.state,
      reason: a.reason,
      reviewAfter: a.reviewAfter,
      condition: a.condition,
      count: a.count,
      lastWrite: fmt(a.lastWriteMs),
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
    adjudicatedCount: outcome.adjudicatedCount,
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
      "instrument-decay detector: A never-wrote / B rate-stopped (companion contrast, not absolute rate), " +
      "C content-dark (every record evaluated:false, reported as a start/count/ended interval), " +
      "D stale-evaluated (artifact predates the newest commit touching its covered source), " +
      "plus an uncovered list that is never counted healthy. " +
      "Shape B honours machine-readable adjudications declared by the descriptor (rare-by-design / " +
      "conditional-on-input with an executable conditionCmd); an adjudication older than its reviewAfter, " +
      "or with no reason, exempts nothing — those groups come back as decay. Adjudicated groups are reported " +
      "in their own `adjudicated[]` and never counted in decayedCount. " +
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

// Name-based guard, NOT a URL comparison: quality-gate-driver / meta-driver / goal-driver
// statically import this module as a library, so esbuild inlines it into their bundles. A URL-form
// guard would become TRUE inside the host bundle (the URL is the host's) and run this module's main()
// instead of the driver's — build-plugin-dist refuses such a bundle (findEntryGuardHijacks). The
// name form is inert when inlined and still runs main() when this file is executed directly.
if (isDirectEntry(import.meta, process.argv[1], "instrument-decay-check")) {
  process.exitCode = main(process.argv);
}
