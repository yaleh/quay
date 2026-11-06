#!/usr/bin/env node
// @instrument "Are the active goals' declared criteria actually passing — and when a criterion's real
//   verdict disagrees with the record, does anything notice and propose a correction?"
//
// meta-driver.ts — 机制演进的观测/提案例程（SPEC-capability-planes §12.2 提名管线的第一片实现）。
//
// PROBLEM（实测，2026-09-06）：`goal-store.ts gate <id>` 已经实现了「跑 criterion → 写 GateEvent →
// 把 evidence{at,verdict,reading} 回写记录」的完整机械半，而 `.quay/gate-events.jsonl` 里
// `"gate":"goal"` 事件数 = **0**——它从未被调用过一次。于是 goal store 建立当天即漂移：AC-170 /
// AC-173 的 criterion 实跑是 PASS，记录却仍是 active 未翻转。**缺的不是机制，是轮子**（同
// memory define-correct-mechanism-not-patch：正解入口已存在且零调用者 ⇒ 接线，不是再造一个）。
//
// 同期实测的第二个量：人在 3 天内手写 ScheduleWakeup 自循环做同类监测 **37 轮**（fan-in 收敛 24 +
// 「推进 GOAL-001」11 + 单任务盯梢 2，间隔 ~20min），prompt 正文里逐字抄着「每轮机械读取…」——
// 即本文件要取代的那个「自带私有常驻 + 私有状态」的手工机制（SPEC §8「取代」类判准逐字命中）。
//
// 形态（ADR-033 的分工，与 pool-quality-judge 同构）：
//   机械半（本文件，零 LLM）：枚举 active goal 的 AC → 逐条真跑 `goal-store.ts gate <id>` →
//                              机械算出 divergence 三类 → 出读数。
//   语义半（plugin/probes/meta-driver.md，短命 claude -p）：只对读数做「这意味着什么/该提什么案」，
//                              ⛔ 不自己采证、⛔ 不执行、⛔ 不翻状态。
//
// 抗漂移靠结构而非提示词：①每轮全新短命上下文；②读数由脚本预算好，LLM 不自采证；③输出是约定
// JSON，解析不了 ⇒ not-evaluated（⛔ 绝不静默当合格，硬规则 3b）；④行为规格是版本化的 probe 文件；
// ⑤每轮追加 Fact 到载体 ⇒ 它的沉默可被检测。
//
// 自动/提案的界线**按动作类别与可逆性划，不按自评信心**（自评信心结构上不可取假，硬规则 4）：
//   自动：跑 criterion、写 evidence/GateEvent（`goal-store gate` 自带）、写读数与 Fact、写 draft 提案
//         （draft 记录构造上惰性——写下它不会让任何事发生，安全性来自构造而非纪律）。
//   ⛔ 提案（要人确认）：激活 goal（draft→active，SPEC-goal-mechanism 裁定 3 保留给人）、翻任何状态、
//         新建/退役/合并机制、改闸的判据、改它自己的 probe 规格。
//
// 节制复用既有机件，不另造：`routine-file-gate.ts` 的三闸（quality 证据正则 / dedup findingKey /
// rate K=3）——它此前零调用者，本文件是它的第一个消费者。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/meta-driver.ts [--root <dir>] [--once]
//        [--no-llm] [--focus "<steer>"] [--k N] [--json]
// Exit: 0 = 轮跑完（含 not-evaluated）; 1 = 轮失败（failed fact）; 2 = usage。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
// `.quay/config.yml` 的读取复用既有依赖（同 goal-store.ts / goal-driver.ts 的 `yaml`，⛔ 不手搓 parser）。
import { parse as YAML } from "yaml";
import { launchArgv, runAsync, ts, aliveness, carrierStats, KNOWN_KINDS, resolveQuayCodeRoot, resolveKernelPluginRoot, goalDriverChildTimeoutMs, GOAL_STORE_SIGTERM_GRACE_MS, type Fact, type RoutineSpec } from "./driver-runtime.ts";
// quay CLI 入口解析的单一入口（`resolveCliInvocation`）——goal 动词现在经 quay CLI 跑（见
// goalStoreArgv 的注释），布局知识留在那一个函数里，⛔ 不在本文件第二次拼 `packages/quay/…`。
import { resolveCliInvocation } from "./start-drivers.ts";
import { runResidentQualityGateLoop, computeRoundRecord } from "./quality-gate-driver.ts";
import { readProbeSpec } from "./read-probe-spec.ts";
import { gateFinding, findingKey, DEFAULT_RATE, countRecentFilings, routineQuotaDecision, BoardKeys, type BoardKeyOwner } from "./routine-file-gate.ts";
// 载体相对路径的单一真相源（⛔ 不在此处硬写字面量「.quay/routine-findings.jsonl」——那会制造第二份
// 定义，本文件读的全局窗口合计必须与 probe-routine.ts 写的是同一个文件；硬规则 5b）。
import { ROUTINE_FINDINGS_REL } from "./probe-routine.ts";
// 停放读数（gap-meta-scanparkingboard）：`.quay/needs-human-parking-recheck.json` 的**第一个消费者**。
// 生产方是 promotion-driver（每轮 `scanParkingBoard` → `writeParkingReading`），而本文件的
// collectReadings 从不读它 ⇒ 「解停条件已成立而任务仍 PARKED」这个读数没有消费者：任务被派发池
// 排除（永不翻 done）、依赖它的 todo 被 judgeDeps 无限期饿死（GOAL-914 的 AC-939 链就是这么卡住的）。
// ⛔ 不在这里重写探测器、也不重拼载体路径：路径与扫描回退都取自同一个模块（硬规则 5b）。
import {
  PARKING_READING_REL,
  scanParkingBoard,
  type ParkedUnparkEntry,
  type ParkedUnparkState,
  type ParkingRecheck,
  type ParkingState,
} from "./needs-human-parking-recheck.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// 状态载体的原子写只有一份实现（kernel `writeJsonAtomic`，tmp + renameSync）。本文件的 `writeState`
// 曾是**裸 writeFileSync**（O_TRUNC 后写 ⇒ 并发读者可观测到零长度/半写，与「文件不存在」同形），
// 而 red-window-triage / runner-state-write 的同类 helper 早已委托 kernel —— 一处行为三个实现
// （.quay/routine-findings.jsonl finding `write-state-atomic-split`，routine semantic-dedup-scan，2026-10-25）。
import { writeJsonAtomic } from "./write-json-atomic.ts";
// ⛔ 必须 import，不能只靠下面的 re-export：`export { x } from "..."` 只绑定导出表、不在本模块作用域
// 绑定 x，本文件内裸调用会 ReferenceError（gap-meta-driver-snapshot-tracked-changes-reference-error）。
import { snapshotTrackedChanges, probeWriteViolations } from "./probe-write-guard.ts";
// AC155（gap-drivers-yml-interval-not-honored-for-routine-kinds）：轮询间隔的单一真相源——
// drivers.yml 经 driver-config 加载，⛔ 不在本文件另写一份字面量（goal/quality/outer 同款接法）。
// routineGlobalCeiling 同属该配置面：driveItems 的真实全局天花板从这里读（本任务新增）。
// routineWindowMs 亦同（gap-routine-quota-window-ms-parsed-but-inert）：rate 窗口从 drivers.yml
// `routine_quota.window_ms` 读，⛔ 不再引用孤儿常量 FILING_WINDOW_MS（它曾让 window_ms 改了没用）。
// DRIVERS_CONFIG_REL 亦同源：`listGoalRecords` 的 wall-clock 上限按 drivers.yml
// `kinds.goal.list_timeout_ms` 派生（gap-goal-driver-filing-ledger 的读面半边），读的必须是
// `loadDriverConfig` 的同一个文件——⛔ 此处不另拼一份 `plugin/scripts/drivers.yml` 字面量（硬规则 5b）。
import { defaultDriverConfig, loadDriverConfig, routineGlobalCeiling, routineWindowMs, DRIVERS_CONFIG_REL } from "./driver-config.ts";
// stripEvidenceTimestamp 的单一真相源在 Core（goal-store）——本文件与 goal-store 的提交决策
// 必须用同一判据「什么算实质变化」（gap-goal-gate-timestamp-commit-flood），⛔ 不各写一份。
// meta 记录是第五种 store kind（gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label）：
// 寄给 meta-driver 的消息是 META 记录（不是 task 标签），答复内嵌在同一条记录上。
//
// ⚠️ 两个核心符号都经 Layer 0（driver-runtime 的 Core 导入面）取，⛔ 不在此处直接写 Core 源码树的
// import 字面量：「Core 的源码树在哪」是布局知识，唯一落点是 Layer 0（AC-262 判据按源文本扫本文件，
// 正是要求这一点；它仍会被 coreSrcAliasPlugin 内联进 dist bundle ⇒ 出厂形态保持自包含）。
import { stripEvidenceTimestamp, createMetaStore } from "./driver-runtime.ts";
// 覆盖段抽取的单一真相源在 dispatch-preference-check.ts——本文件读 meta-driver-focus.md 的覆盖段
// 必须用同一段标题（OVERRIDE_SECTION）与同一抽取逻辑（extractSectionContent），⛔ 不各写一份
// （硬规则 5b：同一原则在第二个载体上的适用点必须复用同一判据，否则标题漂移会让检查器与本文件各说各话）。
import { extractSectionContent, OVERRIDE_SECTION } from "./dispatch-preference-check.ts";
// 正则转义的单一真相源（同 24 个 plugin/scripts 消费者）——下面的 nextSequenceId 由字面前缀拼正则，
// ⛔ 不在此处内联第二份 escaper（那正是本任务要消掉的重复的同类）。
import { escapeRegExp } from "./regex-escape.ts";

/** 载体：每轮一条记录（与 quality-round.jsonl 同族，gitignored 运行时状态）。 */
export const ROUND_CARRIER_REL = path.join(".quay", "meta-driver-round.jsonl");

/** 机械 spawn 的超时（跑一条 criterion）。⛔ LLM 派发不设有限超时——成本结构未测出前不设阈值
 *  （硬规则 4 推论一；同 quality-gate-driver 的 judgeTimeoutMs=Infinity 裁定）。 */
export const CRITERION_TIMEOUT_MS = 120_000;

/** 人工转向通道文件（orchestration/meta-driver-focus.md）——常驻 meta-driver 每轮读其覆盖段。
 *  与 orchestration/dispatch-preference.md 同源：git 可见、每轮读（非启动时读）、三段式、
 *  由 dispatch-preference-check.ts --file 强制结构（tasks/gap-meta-driver-no-steering-channel-focus-unreachable）。 */
export const META_FOCUS_FILE_REL = "orchestration/meta-driver-focus.md";

/** 读人工转向通道的覆盖段内容（每轮调用，⛔ 非启动时读一次——改文件即刻生效，无需重启常驻驱动）。
 *  文件缺失 / 覆盖段解析不出 / 内容空 ⇒ null（= 人没给方向）。返回覆盖段全文（trim 后）。
 *  ⛔ 覆盖段内容可能是「暂无方向」的注记——它是【人编辑才变】的量，进摘要（readingsDigest）正是
 *  它该有的行为（变了 ⇒ 判读一次），与 staleSecs/记录数那些【每轮都变】的量相反（后者进摘要会让
 *  变化检测闸恒为真）。 */
export function readFocusFile(root: string): string | null {
  try {
    const text = fs.readFileSync(path.join(root, META_FOCUS_FILE_REL), "utf8");
    const section = extractSectionContent(text, OVERRIDE_SECTION);
    if (!section) return null;
    const content = section.content.trim();
    return content.length > 0 ? content : null;
  } catch {
    // 文件不存在 / 读不到 ⇒ 无方向。⛔ 不抛——缺文件就是「人没给方向」，不是致命错误。
    return null;
  }
}

/** 一条 AC 的本轮读数。verdict 来自真跑，不是记录自述。 */
export interface CriterionReading {
  id: string;
  title: string | null;
  goal: string | null;
  status: string;
  criterion: string | null;
  verdict: "pass" | "fail" | "not-evaluated";
  reason: string;
  /** WHY a `not-evaluated` is not-evaluated — mirroring goal-driver.ts's gateCriterion so the two
   *  driver readouts name the same causes: "spawn" (the child was killed / could not start — the
   *  75 000ms outer bound lands here), "usage" (exit 2), "unreadable" (non-JSON stdout), or the
   *  goal-store's OWN cause (e.g. "timeout", "capability", "declared"). `null` when the verdict is
   *  definitive (pass/fail) or the store did not name a cause.
   *  (tasks/gap-meta-goaldriverchildtimeoutms — without this, "not-evaluated" was a dead end: the
   *  2026-10-21 autoDrive task could only say "not-evaluated" and invented the rest. A reading that
   *  cannot say WHY it is not measurable cannot be routed OR refuted.) */
  cause: string | null;
  /** 本 AC 声明自己取代哪些旧 AC（store 的 `supersedes` 投影）。⛔ 这是【声明】不是【处置】——
   *  它不会翻转任何 AC 的 status（goal-store 的处置分支以 `isGoalRecord` 为闸，本 driver 只写 AC-*）。
   *  `collectReadings` 总是填它；undefined = 【调用方没提供关系数据】，⛔ 不等于「没有关系」
   *  （硬规则 3b：读不懂不得与「合格」同形——所以这里不用 `[]` 冒充「已查且为空」）。 */
  supersedes?: string[];
  /** 谁声明取代本 AC（store 的 `superseded-by` 投影）。⚠️ 实测存在【单向漂移】：AC-938 写了
   *  `supersedes: ["AC-934"]` 而 AC-934 的 `supersededBy` 为空——所以第五类判定取两向【并集】，
   *  并在 reason 里带 `direction:one-way` 让漂移本身可见（⛔ 不静默当成「没有关系」）。 */
  supersededBy?: string[];
}

/** 机械算出的五类偏离（criterion 的真值 vs 记录的自述）。
 *  ⛔ `not-evaluated` is its OWN kind, never folded into pass/fail (hard rule 3b: "could not
 *  measure" and "is false" are different values). It exists so a standing unmeasured AC is
 *  ESCALATED instead of being silently absent from every divergence list
 *  (tasks/gap-meta-goaldriverchildtimeoutms: the 2026-10-21T04:08:39Z meta reading was
 *  `not-evaluated` and produced NO divergence — no handler was ever told it could not be measured). */
export type DivergenceKind =
  | "pass-but-unflipped"
  | "achieved-but-failing"
  | "no-criterion"
  | "not-evaluated"
  /** 第五类（tasks/gap-ac940-exit-condition-contradiction）：一条已 `achieved` 的 AC，被【它自己声明的
   *  替代者】反证——替代者存在且尚未 `achieved`。前四类逐条只看【单条】AC 的 status×verdict，
   *  结构上表达不了「跨 AC」的矛盾，于是 AC-934（achieved）∧ AC-938（active，声明取代它）这个组合
   *  在每轮 `readings.divergences` 里都是隐形的（实测：2026-11-06 判据 exit 1，divergences 为空）。
   *
   *  ⚠️ 误报纪律（⛔ 别把这条变成每轮都在的噪声）：`supersedes` 关系本身【不等于】矛盾——
   *  「替代者尚未达成」在一个正常重构窗口里同样成立。本类只声明【读数】（谁声明取代谁、双方此刻
   *  各自的状态），是否良性由语义半判定。确定性逃逸口有两条：让替代者达成，或把旧 AC 退役成
   *  `superseded`（那时它已不在承诺态，本类只对 `achieved` 触发）。 */
  | "achieved-but-superseder-unmet";

/** 处理者的三态 + 「读不出」。⛔ 读不出 ≠ 不存在：读不懂不得与「合格」或其反面同形
 *  （硬规则 3b）。「不存在」是【确实没有处理者】，「读不出」是【读了但没读到】——两者处置相反
 *  （前者 escalate，后者不得 escalate）。 */
export type DivergenceHandlerState = "healthy" | "stalled" | "absent" | "unreadable";

/** 一条偏离的处理者信息（机械可算，由 drivers 读数派生，⛔ 非语义判断）。
 *  kind = 处理者标识（driver kind，或 "none"）；state = 三态。 */
export interface DivergenceHandler {
  kind: string;
  state: DivergenceHandlerState;
}

export interface Divergence {
  id: string;
  kind: DivergenceKind;
  status: string;
  verdict: string;
  reason: string;
  /** 【处理者】谁该消解这条偏离、它此刻在什么状态。由 drivers 读数机械派生（⛔ 不是布尔、
   *  不是总数）：kind = 处理者标识；state = healthy/stalled/absent/unreadable。这是正确的分类轴——
   *  同一条 pass-but-unflipped 在 goal-driver 活着时是正常时延窗口，在它停摆时是唯一值得报的事
   *  （且该报的对象不是 AC 而是 goal-driver）。 */
  handler?: DivergenceHandler;
  /** 【重复计数】已连续多少轮产生同一 (id, kind) 的建议——从它自己的载体
   *  `.quay/meta-driver-round.jsonl` 机械算出，⛔ 不进 readingsDigest：它每轮都可能 +1，
   *  进了会让摘要恒不相等、变化检测闸失效（硬规则 4 推论一，同 staleSecs/记录数的道理）。
   *  0 = 本轮首次，或载体里无此键（无历史）。这是【算术】不是判断——判断留给语义半。 */
  repeatCount?: number;
  /** 上次同一 (id, kind) 建议的 recommendation 原文（无历史 ⇒ null）。逐条带原文，
   *  ⛔ 不只给一个总数（SPEC §5.3：不枚举对象、零指引价值）。 */
  lastRecommendation?: string | null;
}

/** 一轮的完整读数（喂给语义半的输入，也是载体里那条记录的值面）。 */
export interface MetaRoundReadings {
  goals: Array<{ id: string; title: string | null; status: string }>;
  criteria: CriterionReading[];
  divergences: Divergence[];
  /** 机制生态：每个 driver kind 在不在跑、载体多久没动。 */
  drivers: DriverReading[];
  /** author↔develop 同步的成败计数（该机制自己的产物）。 */
  syncHealth: SyncHealth;
  /** 【寄给 meta-driver 的消息】——`meta/META-NNN.md` 的 `proposed` 记录（第五种 store kind，
   *  与 task/adr/goal/document 同级）。正文【完整】进读数（专用 schema 自己定义送达面，⛔ 不存在
   *  「只传标题」的截断——这正是被取代的 gap-meta-addressedtasks-input-truncates-* 缺陷）。
   *  只收 `proposed`：答复内嵌在同一条记录上、翻 `answered` 后即离开读数。 */
  metaRecords: MetaMessage[];
  /** gap-not-evaluated-checkers-never-persisted — the suite's INERT checkers (which run_static_checks
   *   checker "读不懂输入" this round, i.e. exited 3 = NOT-EVALUATED), enumerated by NAME (⛔ 不是计数 —
   *   SPEC §5.3: a bare scalar gates nothing; enumerate the names so the semantic half can name which
   *   guard went inert). Read from full-suite-state.json's `notEvaluatedCheckers`. Empty array = "no
   *   inert checker this round" (distinguishable from a missing dimension). */
  inertCheckers: string[];
  focus: string | null;
  /** 【时序派生层】跨轮派生量（streak）——⛔ 快照量里都不存在「连续 N 轮空转」这个信息
   *  （gap-meta-readings-no-timeseries-derivation）。count 每轮变 ⇒ ⛔ 不进 digest（进了会让摘要
   *  恒不相等、变化检测闸失效，硬规则 4 推论一）；只有 crossed 位进（见 readingsDigest），
   *  与 drivers 只取 running 位、divergences 不取 repeatCount 同一条纪律。 */
  timeSeries: TimeSeriesSignal[];
  /** 【第七类读数】动作记录（会话语料）失败聚合——本文件里**唯一不读状态载体**的一类
   *  （GOAL-014 选项①）。三态见 `ActionFailureReading`；digest 只取越阈项的签名与三态 token。 */
  actionRecordFailures: ActionFailureReading;
  /** 【停放读数】两个「已停放但可能该解停」的人群——body-PARKED 的宣告式 unpark 检查是否已通过，
   *  以及 needs-human 的停放理由是否已失效（gap-meta-scanparkingboard）。
   *  来源是 promotion-driver 每轮落盘的 `.quay/needs-human-parking-recheck.json`：⛔ 不复跑第二套
   *  判据（消费者，不是并列生产者）。两臂各自三态；`evaluated:false` 时 `counts` 为 null（⛔ 全 0 ——
   *  「查过且一个都没有」与「没查成」不同形，硬规则 3b/6）。 */
  parking: ParkingRoundReading;
}

// ── 机械半 ────────────────────────────────────────────────────────────────────────────────────────

/** goal 动词的 argv（单一构造点——所有 goal 读写都经这里，⛔ 不在别处拼路径）。
 *  `scriptRoot` 是 quay 代码根（`resolveQuayCodeRoot()` 的取值，测试缝可显式传），`dataRoot` 定位
 *  `goals/` 与 `.quay/gate-events.jsonl`；生产上两者相同。
 *  **总是显式传 `--root`**：store 的缺省是从 cwd 向上找根，driver 从别的 cwd 跑时会找错
 *  （隐式 cwd 依赖，硬规则 4b：别让判定量经过一层未经验证的中间推导）。
 *
 *  gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache —— 这里曾返回
 *  `["node","--no-warnings","--experimental-strip-types", <codeRoot>/…/goal-store.ts, …]`：
 *  一个**进程边界产物**，而那个文件在出厂布局里【不存在】（npm-pack / plugin marketplace cache /
 *  第三方 vendored 副本）。goal-store 的【库】确实在——`coreSrcAliasPlugin` 已把它内联进
 *  `scripts/dist/goal-driver.js`——但它的 CLI 入口不可达：goal-store 的 `isMain` 判的是
 *  `process.argv[1].endsWith("goal-store.ts")`，在 bundle 里恒 false（注释明说这是刻意设计）。
 *  **缺的不是代码，是调用方式。** ⇒ 改为调 **quay CLI 的 `goal` 动词**
 *  （`quay goal list|gate|check|batch|write …`，实现在 Core 的 cli/goal.ts，v1 把 argv
 *  原样交给 goal-store 自己的 dispatch ⇒ 旗标文法与退出码单一实现）。
 *
 *  ⛔ 源检出那支【不自己拼】quay CLI 的路径：布局知识（源检出 ⇒ `packages/quay/bin/quay.ts`）的唯一
 *  入口是 `start-drivers.ts` 的 `resolveCliInvocation` —— 它正是「quay CLI 在哪」这个问题的既有实现。
 *  在这里再拼一份就是第二处布局知识（硬规则 5b）。出厂那支只有一条路径可拼（vendored bundle 相对
 *  本 kernel 的 plugin root，同 `start-drivers.ts` 的 vendor 支路），且**显式不走 PATH**（见下）。
 *
 *  ⚠️ 解析不出时【返回一个不存在的路径而不是抛】：本函数的契约是「给出一组 argv，跑不动由调用方按
 *  『读不懂』处理」（硬规则 3b：读不到输入 ⇒ not-evaluated，⛔ 不与合格同形）——把它升级成异常
 *  会让所有 `scriptRoot 不存在 ⇒ unreadable` 的负控制（goal-driver.test.mjs 的 AC-242 successor /
 *  冻结population 两例）从「读不懂」变成「崩溃」，即**改掉了调用方的语义**而不是修了路径解析。
 *  ⛔ 同理【不回退 PATH 上的 `quay`】——那会让「解析不出」静默变成「跑了一个别处的 quay」。 */
export function goalStoreArgv(scriptRoot: string | null, sub: string[], dataRoot: string = scriptRoot ?? ""): string[] {
  const entry = resolveGoalCliEntry(scriptRoot);
  // `--store` = 「按 goal-store 方言跑」（见 cli/goal.ts 的 STORE_DIALECT_FLAG）。⛔ 对 driver 不是可选
  // 优化：ABI 路线要求 `--root` 底下一份 `.quay/config.yml`（workspace），而本 driver 的每轮读数跑的正是
  // 【没有 config 的裸目录】这一形（测试夹具；第三方项目 quay-init 之前的 root）——不选方言就会退化成
  // "no .quay/config.yml found"，即把「布局不同」伪装成「机制没跑」。
  return [process.execPath, "--no-warnings", ...entry, "goal", ...sub, "--store", "--root", dataRoot];
}

/** quay CLI 入口的解析（`goalStoreArgv` 的唯一路径来源）。返回可直接 spawn 的 argv 片段
 *  （`[--experimental-strip-types, <src>]` 或 `[<vendor bundle>]`）。
 *
 *  两种输入：
 *    `scriptRoot !== null` —— 显式代码根（生产传 `resolveQuayCodeRoot()`；测试缝传夹具根）。
 *        用它解析 ⇒ 解析不出时**不做任何回退**，返回一个不存在的路径：负控制（夹具根不存在 ⇒
 *        `readFrozenFailing` 记 `unreadable`）钉的正是这条契约。
 *    `scriptRoot === null` —— 出厂布局（没有 quay 源码树）。此时唯一的可运行形态是本 kernel 自己
 *        plugin root 下的 vendored bundle。
 *  ⛔ 本函数【不接受】`resolveCliInvocation` 的最后一条支路（PATH 上的 `quay`）：
 *  它把「解析不出」伪装成「跑了一个别处的 quay」（硬规则 3b）。 */
function resolveGoalCliEntry(scriptRoot: string | null): string[] {
  if (scriptRoot !== null) {
    const inv = resolveCliInvocation(scriptRoot, undefined, { pluginRoot: null });
    if (inv.args.length > 0) return inv.args;
    return [path.join(scriptRoot, GOAL_CLI_UNRESOLVED_BASENAME)];
  }
  // 出厂布局：`resolveQuayCodeRoot()` 为 null ⇔ 本 kernel 不在源检出里（源检出恒非 null）
  // ⇒ 可运行形态只能是本 kernel 自己 plugin root 下的 vendored bundle。
  // ⛔ 不在这里走 `resolveCliInvocation` 的 PATH 支路（那会跑一个别处的 quay）；bundle 缺失时
  // 照原样给出该路径，由 spawn 的 ENOENT 如实报出。
  return [path.join(resolveKernelPluginRoot(), "vendor", "quay", "dist", "quay.js")];
}

/** quay CLI 入口的 basename，当**解析不出**时作为「不存在的路径」的末段（见 `resolveGoalCliEntry`）。
 *  用一个自述性的名字，使 ENOENT 的 stderr 里能读出「解析失败」而不是一个像拼错的普通路径。 */
const GOAL_CLI_UNRESOLVED_BASENAME = "quay-cli-unresolved";

/** quay CLI 入口此刻【是否解析得出】——给 `runGoalRound` 的 fail-closed 诊断用（硬规则 3b：
 *  「安装布局不对」要与「模块找不到」可分）。⛔ 源检出那支不做存在性探测：解析规则本身就是判据，
 *  实际能不能跑由 spawn 结果如实报出；出厂那支必须探测（那一个路径可能是空的，而「解析出一个
 *  不存在的路径」正是本函数要与之区分的东西）。 */
export function goalCliResolvable(scriptRoot: string | null): boolean {
  if (scriptRoot !== null) {
    return resolveCliInvocation(scriptRoot, undefined, { pluginRoot: null }).args.length > 0;
  }
  return fs.existsSync(path.join(resolveKernelPluginRoot(), "vendor", "quay", "dist", "quay.js"));
}

/** `goal list` 的 wall-clock 上限缺省（毫秒）。⛔ 不是「随便拍的数」：正源是 drivers.yml
 *  `kinds.goal.list_timeout_ms`，本常量只在配置缺席时兜底。旧实现写死 `CRITERION_TIMEOUT_MS`
 *  （120s）——那是一个**机械 spawn**（跑一条 criterion）的上限，被借给了「读整个 goal store」，
 *  于是一次高负载 / 接管窗口下的长读被记成 store 读失败（`goal-ring state=failed`），
 *  与「store 真的坏了」同形（硬规则 3b）。 */
export const GOAL_LIST_TIMEOUT_MS_DEFAULT = 180_000;

/** `goal list` 超时的三态读数（硬规则 3b：**「用了配置值」「用了缺省」「配置值非法」三者不同形**）。
 *  `detail` 非 null 只在 source==="default" 且**配置里有值但被拒**时——「没配」与「配了但读不懂」
 *  在 `source` 上同形（都是 default），靠 `detail` 区分，⛔ 不把两者折叠成一句「用了缺省」。 */
export interface GoalListTimeoutReading {
  timeoutMs: number;
  source: "explicit" | "config" | "default";
  /** config 值存在但非法时记录原值与拒绝理由（非法值回落缺省，⛔ 静默）。 */
  detail: string | null;
}

/** `goal list` 的 wall-clock 上限：显式覆盖 → drivers.yml `kinds.goal.list_timeout_ms` → 缺省
 *  `GOAL_LIST_TIMEOUT_MS_DEFAULT`。非法值（非正有限数）回落缺省并在 `detail` 记下原值。
 *
 *  基准是 **dataRoot**（workspace root）——与被驱动项目自己的声明同族（同 goalSpawnCap 的论证：
 *  goal 的 spawn 上限/超时是【被驱动项目】的声明，不是本 kernel 安装位置的）。 */
export function goalListTimeoutReading(dataRoot: string, explicit?: number): GoalListTimeoutReading {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    return { timeoutMs: explicit, source: "explicit", detail: null };
  }
  let raw: unknown;
  let present = false;
  try {
    const text = fs.readFileSync(path.join(dataRoot, DRIVERS_CONFIG_REL), "utf8");
    const parsed = YAML(text) as { kinds?: { goal?: { list_timeout_ms?: unknown } } } | null;
    raw = parsed?.kinds?.goal?.list_timeout_ms;
    present = raw !== undefined && raw !== null;
  } catch {
    // drivers.yml 缺失 / 不可解析 ⇒ 缺省（同 loadDriverConfig 的 fail-open）。
    return { timeoutMs: GOAL_LIST_TIMEOUT_MS_DEFAULT, source: "default", detail: null };
  }
  if (!present) return { timeoutMs: GOAL_LIST_TIMEOUT_MS_DEFAULT, source: "default", detail: null };
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { timeoutMs: raw, source: "config", detail: null };
  }
  return {
    timeoutMs: GOAL_LIST_TIMEOUT_MS_DEFAULT,
    source: "default",
    detail: `kinds.goal.list_timeout_ms=${JSON.stringify(raw)} 不是正有限数 ⇒ 回落缺省 ${GOAL_LIST_TIMEOUT_MS_DEFAULT}ms`,
  };
}

/** `goal list` 的 argv（单一构造点，⛔ 调用方各自拼一份）。`noEvidence` = 走 `--no-evidence`
 *  的**无台账投影**：`evidence` 由 `.quay/gate-events.jsonl` 派生，实测 14.4s（206MB 载体），
 *  而 pass 1 不消费它（唯一消费者 `ledgerTailVerdict` 在 pass 2）。 */
export function goalListArgv(
  scriptRoot: string | null,
  dataRoot: string = scriptRoot ?? "",
  opts: { noEvidence?: boolean } = {},
): string[] {
  return goalStoreArgv(scriptRoot, opts.noEvidence === true ? ["list", "--no-evidence"] : ["list"], dataRoot);
}

/** 读全部 goal 记录。解析不了 ⇒ 抛（fail-closed：读不到输入不得继续，⛔ 不返回空数组冒充"没有"）。
 *
 *  `scriptRoot` = 代码根（定位 goal-store 入口），`dataRoot` = goals/ 所在根。缺省 `dataRoot` 就是
 *  `scriptRoot`（与 `goalStoreArgv` 同一缺省），故本模块的既有调用点 `listGoalRecords(root)` 行为不变；
 *  goal-driver 的【测试缝】需要把两者分开时才显式传第二个参数。
 *  **单一实现**（routine semantic-dedup-scan finding `list-goal-records-duplicated`，runId
 *  `semantic-dedup-scan-1793162251891`）：goal-driver 从这里 import 并 re-export，⛔ 不再各带一份
 *  byte-identical 副本。
 *
 *  `opts.noEvidence`：跳过 evidence 派生（pass 1 用，见 `goalListArgv`）。
 *  `opts.timeoutMs`：显式覆盖 wall-clock 上限（测试缝）；缺省按 `goalListTimeoutReading(dataRoot)`。 */
export async function listGoalRecords(
  scriptRoot: string | null,
  dataRoot: string = scriptRoot ?? "",
  opts: { noEvidence?: boolean; timeoutMs?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const timeoutMs = goalListTimeoutReading(dataRoot, opts.timeoutMs).timeoutMs;
  const r = await runAsync(goalListArgv(scriptRoot, dataRoot, opts), { timeoutMs, collectStderr: true });
  if (r.error || r.status !== 0) {
    throw new Error(`goal-store list failed (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 300)}`);
  }
  const parsed = JSON.parse(String(r.stdout ?? "").trim());
  if (!Array.isArray(parsed)) throw new Error("goal-store list did not return an array");
  return parsed as Array<Record<string, unknown>>;
}

/** 跑一条 AC 的 criterion。⚠️ 副作用是设计如此：`goal-store gate` 自己写 GateEvent + evidence 回写，
 *  这正是「自动档」允许的那类动作（观测性、可逆、不改变系统行为）。 */
export async function gateCriterion(
  root: string,
  id: string,
  opts: { recordTimeoutMs?: unknown } = {},
): Promise<{ verdict: "pass" | "fail" | "not-evaluated"; reason: string; cause: string | null }> {
  // The OUTER bound is DERIVED from the child's own inner deadline (its record's `timeoutMs` >
  // env > default), ⛔ never the mechanical `CRITERION_TIMEOUT_MS`: a record declaring a deadline
  // ≥ that literal would be pre-empted by the driver's SIGKILL before `goal gate` could reach its own
  // verdict (gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks).
  const r = await runAsync(goalStoreArgv(root, ["gate", id]), {
    timeoutMs: goalDriverChildTimeoutMs(opts.recordTimeoutMs, "gate"),
    collectStderr: true,
    killGraceMs: GOAL_STORE_SIGTERM_GRACE_MS,
  });
  if (r.error) return { verdict: "not-evaluated", reason: `gate spawn error: ${r.error.message}`, cause: "spawn" };
  // exit 0 = pass, 1 = fail（含空 criterion 的 fail-closed）, 2 = 用法/记录不存在 ⇒ 无法评估。
  if (r.status === 2) return { verdict: "not-evaluated", reason: `gate usage error: ${(r.stderr || "").trim().slice(0, 200)}`, cause: "usage" };
  try {
    const out = JSON.parse(String(r.stdout ?? "").trim());
    const v = out.verdict === "pass" ? "pass" : out.verdict === "fail" ? "fail" : "not-evaluated";
    return {
      verdict: v,
      reason: String(out.reason ?? "").slice(0, 500),
      // The store names its OWN cause ("timeout"/"capability"/"declared"/…); pass it through rather
      // than collapsing every not-evaluated into one opaque value.
      cause: typeof out.cause === "string" ? out.cause : null,
    };
  } catch {
    // 读不懂输出 ≠ 合格（硬规则 3b）——给它一个独立取值，不与 pass/fail 共用。
    return { verdict: "not-evaluated", reason: `unparseable gate output (exit ${r.status})`, cause: "unreadable" };
  }
}

/** 机械算 divergence。⛔ 只由 verdict 与 status 决定，无语义判断。 */
export function computeDivergences(readings: CriterionReading[]): Divergence[] {
  const out: Divergence[] = [];
  for (const c of readings) {
    const base = { id: c.id, status: c.status, verdict: c.verdict, reason: c.reason };
    // 只有【承诺态】才可能构成偏离。承诺态 = active（已许诺、待兑现）∪ achieved（已宣称兑现）。
    // 其余三态都不是承诺，判据过不过都不构成偏离：
    //   draft      —— 尚未被人激活的【提案】。（实测：AC-180 是 meta-driver 自己提的 draft，
    //                 却被报成 pass-but-unflipped——把「提案」当成「未兑现的承诺」是错的，
    //                 且会让偏离数随提案数虚增。）
    //   retired    —— 已撤回。⚠️ 实测 2026-09-06：把 AC-181（活性监控项误写成目标判据）退役后，
    //                 它的判据仍 pass 而 status≠achieved ⇒ 立刻被报成 pass-but-unflipped，
    //                 制造出一条【每轮都在、永远无法消解】的假偏离——退役的东西没有「该翻 achieved」可言。
    //   superseded —— 已被后继取代，同理。
    // ⊢ 判据写成「不在承诺态集合里就跳过」而非「逐个排除已知的坏值」：新增一个状态时默认安全
    //   （不被误报），⛔ 不是默认危险。
    if (c.status !== "active" && c.status !== "achieved") continue;
    if (!c.criterion || c.criterion.trim() === "") { out.push({ ...base, kind: "no-criterion" }); continue; }
    if (c.verdict === "pass" && c.status !== "achieved") { out.push({ ...base, kind: "pass-but-unflipped" }); continue; }
    if (c.verdict === "fail" && c.status === "achieved") { out.push({ ...base, kind: "achieved-but-failing" }); continue; }
    // A committed AC whose criterion could NOT BE RUN this round is a divergence in its own right:
    // "we promised to measure this and we did not". Before this branch, `not-evaluated` fell through
    // every case and produced NOTHING — a standing unmeasured AC was indistinguishable from a healthy
    // one on the divergence list (tasks/gap-meta-goaldriverchildtimeoutms: the 04:08:39Z reading).
    // ⛔ Not `achieved-but-failing`/`pass-but-unflipped`: the verdict is neither (hard rule 3b).
    if (c.verdict === "not-evaluated") { out.push({ ...base, kind: "not-evaluated" }); continue; }
  }
  // 第二遍：跨 AC 判定（第五类）。⛔ 放在第一遍之后、且【不触碰】上面任何分支的判定与顺序——
  // 既有四类在同样的输入下必须逐条逐字段不变（四条旧测试一条都不改）。
  out.push(...computeSupersederDivergences(readings));
  return out;
}

// ── 第五类：被自己声明的替代者反证（tasks/gap-ac940-exit-condition-contradiction）─────────────────
// 一条 supersede 关系 = 【new 声明自己取代 old】。两个方向都可能写下这条声明（new 的 `supersedes`
// 与 old 的 `superseded-by`），而实测存在单向漂移 ⇒ 取两向【并集】，并把 `twoWay=false` 记进
// reason 让漂移可见（硬规则 5/3b：读不全不得与「没有关系」同形）。
export interface SupersedeRelation {
  oldId: string;
  newId: string;
  /** 两向声明都写了 ⇒ true；只有一侧写了（漂移）⇒ false。 */
  twoWay: boolean;
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((s) => s !== "");
}

/** 从整批读数机械算出 supersede 关系集（两向并集，去重）。⛔ 纯算术，无语义判断。
 *  只在【两端都在本批读数里且同 goal】时成立：看不见的一端其 status 不可知，⛔ 不臆造
 *  「它没达成」（硬规则 3b），也不臆造「关系不存在」——它只是不参与本类判定。 */
export function supersedeRelations(readings: CriterionReading[]): SupersedeRelation[] {
  const byId = new Map(readings.map((r) => [r.id, r]));
  // key = `${oldId}\u0000${newId}`；两个布尔位分别记录哪一侧写了声明。
  const pairs = new Map<string, { oldId: string; newId: string; viaSupersedes: boolean; viaSupersededBy: boolean }>();
  const touch = (oldId: string, newId: string, side: "supersedes" | "supersededBy") => {
    const key = `${oldId}\u0000${newId}`;
    const row = pairs.get(key) ?? { oldId, newId, viaSupersedes: false, viaSupersededBy: false };
    if (side === "supersedes") row.viaSupersedes = true;
    else row.viaSupersededBy = true;
    pairs.set(key, row);
  };
  for (const r of readings) {
    // r 的 `supersedes` 列的是【被它取代的旧 id】⇒ old → new = (oldId, r.id)。
    for (const oldId of idList(r.supersedes)) if (oldId !== r.id) touch(oldId, r.id, "supersedes");
    // r 的 `supersededBy` 列的是【取代它的新 id】⇒ old = r.id, new = 每个 newId。
    for (const newId of idList(r.supersededBy)) if (newId !== r.id) touch(r.id, newId, "supersededBy");
  }
  const out: SupersedeRelation[] = [];
  for (const row of pairs.values()) {
    const oldRec = byId.get(row.oldId);
    const newRec = byId.get(row.newId);
    // 看不见的一端 / 跨 goal 的关系 ⇒ 本类不判定（不是「无矛盾」，是「不可判」）。
    if (!oldRec || !newRec) continue;
    if (oldRec.goal == null || oldRec.goal !== newRec.goal) continue;
    out.push({ oldId: row.oldId, newId: row.newId, twoWay: row.viaSupersedes && row.viaSupersededBy });
  }
  // 稳定顺序：先按旧 AC，再按新 AC —— 同一批输入必须产出同一顺序（载体/摘要可比）。
  return out.sort((a, b) => (a.oldId === b.oldId ? a.newId.localeCompare(b.newId) : a.oldId.localeCompare(b.oldId)));
}

/** 第五类的判定（纯函数）。判定写全：
 *  X.status === "achieved" ∧ ∃Y≠X 同 goal：Y 声明取代 X ∧ Y.status !== "achieved"
 *  ⇒ 一条 divergence（id = X.id，reason 逐条枚举 Y 的 id 与 status）。 */
function computeSupersederDivergences(readings: CriterionReading[]): Divergence[] {
  const byId = new Map(readings.map((r) => [r.id, r]));
  const unmet = new Map<string, Array<{ rel: SupersedeRelation; status: string; verdict: string }>>();
  for (const rel of supersedeRelations(readings)) {
    const oldRec = byId.get(rel.oldId)!;
    const newRec = byId.get(rel.newId)!;
    if (oldRec.status !== "achieved") continue; // 旧 AC 只在【已宣称兑现】时才会被反证
    if (newRec.status === "achieved") continue; // 替代者已达成 ⇒ 矛盾消解（确定性逃逸口之一）
    const list = unmet.get(rel.oldId) ?? [];
    list.push({ rel, status: newRec.status, verdict: newRec.verdict });
    unmet.set(rel.oldId, list);
  }
  const out: Divergence[] = [];
  for (const [oldId, list] of [...unmet.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const oldRec = byId.get(oldId)!;
    const superseders = list
      .map((x) => `${x.rel.newId} (status=${x.status}, verdict=${x.verdict})`)
      .join(", ");
    // 漂移本身就是读数：任一关系只有一侧写了声明 ⇒ one-way。⛔ 不把它折成「无事发生」。
    const direction = list.every((x) => x.rel.twoWay) ? "two-way" : "one-way";
    out.push({
      id: oldRec.id,
      kind: "achieved-but-superseder-unmet",
      status: oldRec.status,
      verdict: oldRec.verdict,
      reason: `${oldRec.id} is achieved but its declared superseder is not: ${superseders}; direction:${direction}`,
    });
  }
  return out;
}

// ── 处理者路由（gap-meta-divergences-not-routed-by-handler-existence）────────────────────────────
// computeDivergences 按「AC 的 status × verdict」分类，产出三种 kind 却逐字段同形——而它们的处理者
// 存在性截然不同（pass-but-unflipped → goal-driver 全自动翻；no-criterion → task→worker 但需显式触发；
// achieved-but-failing → 无）。同形导致 259 次把「goal-driver 没在跑」报成 259 条 AC 症状，病因
// （drivers.goal 没在跑）就在同一份读数里却一次也没被报出（硬规则 4b：AC 未翻是代理量，driver 活性
// 是直接量）。修法不是替 LLM 下「goal-driver 停了」的结论（SPEC §5.3 语义解读归 probe），而是给每条
// 偏离附一个【机械可算的处理者三态】，让 probe 按它路由。

/** 每条偏离 kind 的处理者 driver kind（⛔ "none" = 无处理者）。
 *  pass-but-unflipped → goal-driver 全自动翻 achieved；no-criterion → task→worker 流水线（需显式触发：
 *  要有人立一条补判据的任务）；achieved-but-failing → 无（见 gap-goal-achieved-but-failing-no-handler）。 */
export const DIVERGENCE_HANDLER_KIND: Record<DivergenceKind, string> = {
  "pass-but-unflipped": "goal",
  "no-criterion": "worker",
  "achieved-but-failing": "none",
  // ⛔ "none" on purpose: re-running an unmeasurable criterion is what the goal-driver already does
  // every round — that is the FAILING instrument, not a handler for it. No driver kind resolves
  // "this criterion could not be run"; a person must raise the deadline or repair the criterion.
  // Mapping it to "goal" would report handler.state=healthy and the probe spec would suppress it
  // as a transient window — exactly the silence this task removes.
  "not-evaluated": "none",
  // ⛔ "none" on purpose, and the reason is NOT "nobody cares": the two deterministic escapes are
  // (a) LAND the superseder so it reaches `achieved` — that is worker/fan-in work on the superseder's
  //     own task, not a goal-driver round; and (b) a PERSON retires the old AC (`superseded`), which
  //     takes it out of the committed set. Mapping this kind to "goal" would claim that re-running
  //     the goal-driver resolves it — it cannot: the goal-driver only re-gates criteria and flips an
  //     AC whose criterion passes; it never lands code. It would also make handler.state=healthy
  //     suppress the reading as a transient window, which is exactly the invisibility this kind
  //     exists to remove (same reasoning as `not-evaluated` above).
  "achieved-but-superseder-unmet": "none",
};

/** 由 drivers 读数派生一条偏离的处理者三态。纯函数、可枚举（⛔ 不是布尔/总数）：
 *  处理者 kind 在读数里且 running ⇒ healthy；在读数里但不跑 ⇒ stalled；不在读数里 ⇒ absent；
 *  读数整体缺失或该 kind 的 aliveness 读不出 ⇒ unreadable（⛔ 与 absent 不同取值，硬规则 3b）。 */
export function handlerStateFor(handlerKind: string, drivers: DriverReading[] | null | undefined): DivergenceHandlerState {
  if (handlerKind === "none") return "absent"; // 结构性：无处理者 ⇒ 不存在（⛔ 不是读不出）
  if (drivers == null) return "unreadable"; // 读数整体缺失 ⇒ 读不出（⛔ 不冒充 absent）
  const row = drivers.find((d) => d.kind === handlerKind);
  if (!row) return "absent"; // 读数里没有这个 driver kind ⇒ 不存在
  if (row.running === null) return "unreadable"; // 该 kind 的 aliveness 读不出
  if (row.running) return "healthy";
  return "stalled"; // 存在但不跑（含陈旧载体：进程死 ⇒ 停摆）
}

/** 给每条偏离附上机械可算的处理者信息 handler = {kind, state}（纯函数，不改输入）。 */
export function attachDivergenceHandlers(
  divergences: Divergence[],
  drivers: DriverReading[] | null | undefined,
): Divergence[] {
  return divergences.map((d) => {
    const kind = DIVERGENCE_HANDLER_KIND[d.kind];
    return { ...d, handler: { kind, state: handlerStateFor(kind, drivers) } };
  });
}

// ── 重复计数（从自己的载体机械算出）────────────────────────────────────────────────────────────
// gap-meta-divergence-recommendation-recurrence-invisible — divergences 是四条输出通道里唯一没有
// 执行器的一条，而 meta-driver 每轮全新上下文 ⇒ 结构上无法发现自己已把同一建议重复了 N 轮。
// ⛔ 修法不是给语义半塞历史（那会破坏 profiles.yml:77 的「每轮全新上下文」抗漂移设计），
// 而是把一个【机械可算的量】作为读数交给它：从它自己的载体算出「这条 (id, kind) 已连续
// 多少轮给出建议」。机械层算术、语义层判断，与 ADR-033 的切分一致。

/** 一条 (id, kind) 的重复历史（机械算术，⛔ 不含任何判断）。 */
export interface DivergenceRecurrence {
  repeatCount: number;
  lastRecommendation: string | null;
}

/** 稳定键：id + kind 联合定位一条偏离（⛔ 只按 id 会混掉同一 AC 的不同偏离类别）。 */
export function divergenceKey(id: string, kind: string): string {
  return `${id}::${kind}`;
}

/** 从载体记录里抽出【产生建议的轮】（judge round = 有 fact 的 value.interpretations 数组）。
 *  ⛔ 不是每条载体记录都判读过：两次复核之间是 routine 未到期的空心跳（facts=[]），
 *  变化检测闸还会跳过没变的轮（semantic=skipped-unchanged，无 interpretations 键）——
 *  这些都不产生建议，故既不计入、也不打断连续（「已连续 N 轮」数的是产生建议的轮）。 */
export function extractJudgeRounds(records: Array<Record<string, unknown>>): Array<Array<Record<string, unknown>>> {
  const out: Array<Array<Record<string, unknown>>> = [];
  for (const rec of records) {
    const facts = rec.facts;
    if (!Array.isArray(facts)) continue;
    for (const f of facts) {
      if (!f || typeof f !== "object") continue;
      const value = (f as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      const interps = (value as Record<string, unknown>).interpretations;
      if (Array.isArray(interps)) { out.push(interps as Array<Record<string, unknown>>); break; }
    }
  }
  return out;
}

/** 通用轮载体读取：解析 jsonl（坏行跳过，⛔ 一行坏 JSON 不使机制失明）。读不到 ⇒ 空数组
 *  （「没有历史」——⛔ 不返回 null 冒充「读失败」，硬规则 6）。单一真相源：meta 载体与 goal 载体
 *  共用这一条读取逻辑（⛔ 不各写一份解析，硬规则 5b）。 */
export function readRoundCarrier(root: string, rel: string): Array<Record<string, unknown>> {
  let text: string;
  try { text = fs.readFileSync(path.join(root, rel), "utf8"); } catch { return []; }
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as Record<string, unknown>); } catch { /* 坏行跳过 */ }
  }
  return out;
}

/** 读自己的载体（解析不了的行跳过，⛔ 不因一行坏 JSON 使机制失明）。读不到 ⇒ 空数组
 *  （「没有历史」——与 computeDivergenceRecurrence 的 0 同义，⛔ 不返回 null 冒充「读失败」）。 */
export function readMetaCarrier(root: string): Array<Record<string, unknown>> {
  return readRoundCarrier(root, ROUND_CARRIER_REL);
}

/** 对当前每条 divergence 算「已连续多少轮产生同一 (id, kind) 建议」。
 *  从最新一轮往旧走，只数【产生建议的轮】（extractJudgeRounds 已滤掉心跳/跳过轮），
 *  遇第一个不含该 (id, kind) 的判读轮即停（连续被打破）。lastRecommendation = 最近那次的原句。 */
export function computeDivergenceRecurrence(
  judgeRounds: Array<Array<Record<string, unknown>>>,
  divergences: Divergence[],
): Map<string, DivergenceRecurrence> {
  const out = new Map<string, DivergenceRecurrence>();
  for (const d of divergences) {
    const k = divergenceKey(d.id, d.kind);
    let count = 0;
    let last: string | null = null;
    let captured = false;
    for (let i = judgeRounds.length - 1; i >= 0; i--) {
      const round = judgeRounds[i];
      const hit = round.find((it) => divergenceKey(String(it.id ?? ""), String(it.kind ?? "")) === k);
      if (!hit) break; // 连续被打断：这一判读轮没有此 (id, kind) 建议
      count++;
      if (!captured) { captured = true; last = typeof hit.recommendation === "string" ? (hit.recommendation as string) : null; }
    }
    out.set(k, { repeatCount: count, lastRecommendation: last });
  }
  return out;
}

// ── 时序派生层（gap-meta-readings-no-timeseries-derivation）────────────────────────────────
// 问题：collectReadings 产出的 MetaRoundReadings 全部是【快照量】——每条 AC 的 verdict/status、
// 每个 driver 的 running/staleSecs、syncHealth 窗口统计、metaRecords、inertCheckers、focus。
// 没有任何【跨轮派生量】（streak / 斜率 /「连续 N 轮某事没发生」）。于是「连续 N 轮空转」
// 在【任何单轮】的快照里都不存在（实例：GOAL-009 AC-214 连续 8 轮 spawn 零产出，轮长从 ~60s
// 退化到 5–9 分钟，任何一轮读数都看不见）。修法不是给某个载体加一个计数器（那又是只修被报出来
// 的那一个，硬规则 5b），而是给读数加一个【通用时序层】：对已在读的载体自动派生两类 streak——
// (a) 连续 N 轮取值不变；(b) 连续 N 轮「应发生而未发生」（如 spawn 了但产出为 0）。

/** 时序信号的两种模式。 */
export type StreakMode = "unchanged" | "expected-absent";

/** 一条派生存续信号。⛔ count 每轮都可能 +1 ⇒ 不进 readingsDigest（进了会让摘要恒不相等、
 *  变化检测闸失效——同 staleSecs/记录数/repeatCount 的道理，硬规则 4 推论一）；只有 crossed
 *  （是否越阈）这个位进。evaluated=false 与「count=0 / crossed=false」不同形（硬规则 3b）。 */
export interface TimeSeriesSignal {
  key: string;
  mode: StreakMode;
  count: number;
  crossed: boolean;
  evaluated: boolean;
  threshold: number;
  /** 窗口里有几轮**因「这一轮被停机打断、读数没取到」而被跳过**（gap-meta-derivegoalcarriersignals）。
   *
   *  ⛔ WHY THIS FIELD EXISTS: 一条被中止的轮（`stopped_mid_round`）**不是**「本轮该 AC 的取值变了」，
   *  也不是「没有历史」——它是「这一轮没跑完、没读数」。此前派生层把它记成 `null`，而 `null` 同时
   *  做两件坏事：① 打断 `unchangedStreak`/`absentStreak`（于是「连续 8 轮 verdict 不变」与
   *  「spawn 了却零产出」两个安全网在中止轮附近量不出来）；② 作为尾值时让整条信号变
   *  `evaluated:false`（把一个「跳过」伪装成「无历史」，硬规则 3b）。
   *  实测（2026-11-06 生产 `.quay/goal-round.jsonl`）：最近 40 轮里 7 轮是中止轮，**最后一条**就是，
   *  于是整份 timeSeries 全是 `evaluated:false`。
   *
   *  现在中止轮被**跳过**（既不打断连续、也不抹掉尾值），而跳过这件事以本字段**独立可见**：
   *  `skippedAbortedRounds > 0` 就是告诉读者「这条 streak 的尾值不是最近一轮的，中间隔了这么多轮没读数」。
   *  ⛔ 它**不进** readingsDigest（同 `count`/`value` 的道理：每出现一个中止轮它就 +1，
   *  进了会让摘要恒不相等、变化检测闸失效，硬规则 4 推论一）。 */
  skippedAbortedRounds: number;
  /** The REPEATED value for `mode: "unchanged"` — i.e. WHAT has been unchanged for `count` rounds.
   *  `null` for `mode: "expected-absent"` (that mode counts an absence, not a value) and when
   *  `evaluated` is false (no value was read).
   *
   *  ⛔ WHY THIS FIELD EXISTS (tasks/gap-meta-goaldriverchildtimeoutms): `unchanged:13` alone is
   *  ambiguous between "failing for 13 rounds" and "UNMEASURED for 13 rounds" — and the 2026-10-21
   *  semantic probe read the AC-911 streak as the latter, filing a task against an instrument whose
   *  ledger already held 21 definitive `fail` events for AC-911 by that round (30 by 05:00Z).
   *  Carrying the value makes the signal self-describing instead of leaving the reader to infer it.
   *  It stays OUT of readingsDigest for
   *  the same reason `count` does: it changes only when the streak changes. */
  value: string | null;
}

/** 一条 streak 计算结果（evaluated:false = 读不出/无历史，⛔ 不与 count=0 同形）。 */
export interface StreakResult { evaluated: boolean; count: number }

/** (a) 连续 N 轮取值不变。values 时间序（旧→新），null = 该轮无此值（打断连续）。
 *  空 / 尾值 null ⇒ evaluated:false（⛔ 不冒充「streak=0」，硬规则 3b）。 */
export function unchangedStreak(values: Array<string | null>): StreakResult {
  if (values.length === 0) return { evaluated: false, count: 0 };
  const last = values[values.length - 1];
  if (last === null) return { evaluated: false, count: 0 };
  let n = 0;
  for (let i = values.length - 1; i >= 0; i--) { if (values[i] !== last) break; n++; }
  return { evaluated: true, count: n };
}

/** (b) 连续 N 轮「应发生而未发生」。absent 时间序（旧→新）：true = 该轮应发生而未发生；
 *  false = 该轮【发生了】（打断连续）；null = 读不出/不适用（打断连续）。
 *  空 / 尾值 null ⇒ evaluated:false；尾值 false ⇒ count=0（发生了，⛔ 不是未评估）。 */
export function absentStreak(absent: Array<boolean | null>): StreakResult {
  if (absent.length === 0) return { evaluated: false, count: 0 };
  const last = absent[absent.length - 1];
  if (last === null) return { evaluated: false, count: 0 };
  let n = 0;
  for (let i = absent.length - 1; i >= 0; i--) { if (absent[i] !== true) break; n++; }
  return { evaluated: true, count: n };
}

/** goal 载体的轮记录路径（driver-runtime DRIVER_KINDS.goal 的 carriers[0]，⛔ 与那处一致）。 */
export const GOAL_ROUND_CARRIER_REL = path.join(".quay", "goal-round.jsonl");

/** 一条轮记录里 goal-ring 的 value（facts 里 name==="goal-ring" 的 value）。读不出 ⇒ null。 */
export function goalRingValue(round: Record<string, unknown>): Record<string, unknown> | null {
  const facts = round.facts;
  if (!Array.isArray(facts)) return null;
  for (const f of facts) {
    if (!f || typeof f !== "object") continue;
    if ((f as Record<string, unknown>).name !== "goal-ring") continue;
    const v = (f as Record<string, unknown>).value;
    if (v && typeof v === "object") return v as Record<string, unknown>;
    return null;
  }
  return null;
}

/** 该轮的 goal-ring 读数是否「因为**这一轮被停机打断**而根本没取到」
 *  （gap-meta-derivegoalcarriersignals）。真 ⇒ 这一轮对任何 AC 都不提供信息，
 *  派生层**跳过**它（⛔ 不记 `null`：`null` 会同时打断 streak 并抹掉尾值）。
 *
 *  判据按优先序（⛔ 只读结构化字段，**不匹配 reason 文本**——文本是给人看的，改一个措辞就会
 *  让判据静默失效，硬规则 2）：
 *   ① goal-ring 的 `value` 自带 `stopped_mid_round: true` —— 即 `abandonedMidRoundFact`
 *      （quality-gate-driver.ts）写下的形状 `{stopped_mid_round:true, observed:false, grace_ms}`；
 *      生产实测 73/20625 轮是这个形状，且**每一条**与记录级旗标同时为真。
 *   ② goal-ring fact 缺失 / 无 value，而**记录级** `stopped_mid_round: true` ⇒ 兜底判为被打断。
 *      ⛔ 记录级旗标**不能单独当判据**：它只说明「本轮有**某条**例程被打断」，
 *      goal-ring 自己可能已经跑完（quality-gate-driver 是**按例程**置这个旗标的）。
 *   ③ 反过来，`value` 带着 `criteria` 读数 ⇒ **算观测到了**（数据优先于旗标）：
 *      真读到读数的一轮不该因为一个旗标被丢掉。
 *   ④ `state:"failed"`（store 读失败，`value` 只有 `{phase:"list"}`）**不是**被打断：
 *      那一轮**跑完了**、只是没读到 ⇒ 仍记 `null`。两者不同形（硬规则 3b：
 *      「跑完了但没读到」会打断连续，「没跑完」不会）。 */
export function goalRingRoundAborted(round: Record<string, unknown>): boolean {
  const v = goalRingValue(round);
  if (v !== null && Array.isArray(v.criteria)) return false; // ③ 有读数 ⇒ 算观测到
  if (v !== null) return v.stopped_mid_round === true;       // ①
  return round.stopped_mid_round === true;                   // ②
}

/** 「连续 N 轮 spawn 了但零产出」的阈值——安全网非调优值（⛔ 不是按成本/收益调出来的，硬规则 4 推论一）。
 *  实测分布（2026-09-09 生产 goal-round.jsonl，48 个 AC 的 spawn-zero-output streak 长度）：
 *    streak=1 占 36 条（正常时延：本轮 spawn、下轮 taskCount≥1）、2–7 共 9 条、尾部两条 21（AC-158）
 *    与 24（AC-214——本任务点名的「连续 8 轮」窗口所在的那段更长 streak）。
 *  阈值 8 落在「正常时延（≤7）」与「真持续空转（21/24）」之间的空隙，只为把「持续空转」这个类挑出来，
 *  ⛔ 不是从成本收益曲面里调出来的值。 */
export const SPAWN_ZERO_OUTPUT_THRESHOLD = 8;
/** 「连续 N 轮 verdict 取值不变」的阈值——同一安全网语义（见上：verdict 变是【会改变判读结论】的量，
 *  但「已经连续 N 轮不变」这个【位】才是派生层要交的，N 本身不进 digest）。 */
export const VERDICT_UNCHANGED_THRESHOLD = 8;

/** 从 goal-round 载体派生存续信号（⛔ 纯函数：只读传入的轮记录数组，不碰磁盘）。
 *  对每个 AC id 派生两类：verdict 取值不变（mode a）+ spawn 了但零产出（mode b）。
 *  「spawn 了但零产出」= 该轮 gap_spawns 有该 AC（spawn 了）且 gaps 里它仍是 state==="gap"
 *  （taskCount 仍 0 ⇒ 那次 spawn 没产出新任务）。⛔ 不重改 computeGoalGaps 的牵引口径——那是
 *  gap-goal-gap-done-task-not-traction-respawns-every-round 已修好的实例，本函数只【读】它产出的
 *  gap_spawns/gaps 快照，做跨轮派生（DoD3）。
 *
 *  ⚠️ 被停机打断的轮（`goalRingRoundAborted`）**整轮跳过**、⛔ 不记 `null`：它们既不算「取值变了」
 *  也不算「没有历史」，记 null 会让安全网在中止轮附近全失效（gap-meta-derivegoalcarriersignals，
 *  实测：最近 40 轮里 7 轮是中止轮，且最后一条就是 ⇒ 旧实现下整份 timeSeries 全是 evaluated:false）。
 *  跳过的轮数由 `skippedAbortedRounds` 独立带出（⛔ 不折叠进 count/evaluated——那会把
 *  「跳过 N 轮后仍有 8 轮读数」与「真有最近 8 轮读数」混成同一读数，硬规则 3b）。 */
export function deriveGoalCarrierSignals(
  rounds: Array<Record<string, unknown>>,
  acIds: string[],
  opts: { spawnZeroThreshold?: number; verdictUnchangedThreshold?: number } = {},
): TimeSeriesSignal[] {
  const spawnZeroThreshold = opts.spawnZeroThreshold ?? SPAWN_ZERO_OUTPUT_THRESHOLD;
  const verdictUnchangedThreshold = opts.verdictUnchangedThreshold ?? VERDICT_UNCHANGED_THRESHOLD;
  const out: TimeSeriesSignal[] = [];
  for (const ac of acIds) {
    const verdicts: Array<string | null> = [];
    const spawnZero: Array<boolean | null> = [];
    /** 本 AC 的窗口里被跳过的中止轮数（⛔ 每条信号各自带一份，让信号自描述）。 */
    let skippedAbortedRounds = 0;
    for (const round of rounds) {
      const v = goalRingValue(round);
      // 被停机打断的一轮 = 这一轮没跑完、没读数（⛔ 不是「取值变了」也不是「没有历史」）
      // ⇒ 整轮跳过：既不 push null（会打断连续、抹掉尾值），也不参与任何计数；
      //   跳过的轮数单独记账，让「尾值不是最近一轮的」这件事在信号上可见。
      if (goalRingRoundAborted(round)) { skippedAbortedRounds++; continue; }
      if (v === null) { verdicts.push(null); spawnZero.push(null); continue; }
      const criteria = Array.isArray(v.criteria) ? (v.criteria as Array<Record<string, unknown>>) : [];
      const c = criteria.find((x) => String(x.id ?? "") === ac);
      verdicts.push(c ? String(c.verdict ?? "") : null);
      const spawned = Array.isArray(v.gap_spawns) && (v.gap_spawns as Array<Record<string, unknown>>)
        .some((s) => String(s.ac ?? "") === ac);
      if (!spawned) { spawnZero.push(null); continue; } // 本轮没 spawn ⇒ 不适用（打断连续）
      const gaps = Array.isArray(v.gaps) ? (v.gaps as Array<Record<string, unknown>>) : [];
      const stillGap = gaps.some((g) => String(g.ac ?? "") === ac && g.state === "gap");
      spawnZero.push(stillGap); // spawn 了且仍 gap ⇒ 零产出；spawn 了且不再 gap ⇒ 有产出
    }
    const vr = unchangedStreak(verdicts);
    const sr = absentStreak(spawnZero);
    out.push({
      key: `goal:${ac}:verdict`, mode: "unchanged",
      count: vr.count, crossed: vr.evaluated && vr.count >= verdictUnchangedThreshold,
      evaluated: vr.evaluated, threshold: verdictUnchangedThreshold,
      skippedAbortedRounds,
      // WHAT was unchanged — `null` exactly when there is no evaluated tail (⛔ not "").
      value: vr.evaluated ? verdicts[verdicts.length - 1] : null,
    });
    out.push({
      key: `goal:${ac}:spawn-zero-output`, mode: "expected-absent",
      count: sr.count, crossed: sr.evaluated && sr.count >= spawnZeroThreshold,
      evaluated: sr.evaluated, threshold: spawnZeroThreshold,
      skippedAbortedRounds,
      // This mode counts an ABSENCE; it has no repeated value to report.
      value: null,
    });
  }
  return out;
}

// ── 第七类读数：动作记录失败聚合（GOAL-014 选项①，gap-meta-driver-action-record-failure-aggregation-reading）──
// 缺口（GOAL-014 实证 2026-09-10）：6 个互不相同的会话各自撞同一错误（`Unknown skill` 类）
// 合计 12+ 次、各自现场回退，**没有任何机件把这 12 次汇总成一个信号**。前六类读数（criteria/
// drivers/syncHealth/metaRecords/inertCheckers/focus）**全部读状态载体**；本类是第一类读
// **动作记录**（会话语料）的读数。⛔ inertCheckers 管的是方向相反的东西（从不报红的惰性守卫）。
//
// 成本结构（2026-09-12 本机实测，写进本任务体作为阈值定值依据）：
//   · 语料规模：`get_session_directory` = 5513 文件 / 3.93 GB（quay 项目，顶层 + subagent）。
//   · 单次全量扫描 `query_session_signals type=errors` 实测 **≥15 分钟**（见任务体实测读数）。
//   · ⚠️ `since` **不降低扫描成本**：meta-cc 的时间过滤在【全量载入之后】逐条判定
//     （internal/mcp/executor/provider_query.go:`runProviderJQ`/`inTimeRange`），不是文件级预过滤
//     ⇒ GOAL-014 成本约束里「读语料必须增量（since = 上轮时刻）」在机制上落不了地。
//     **本读数的成本控制只能靠【缓存 + TTL】**，⛔ 不是靠缩小窗口。首版即按此实现。
//
// 形态（三条硬纪律）：
//   ① 三态互不同形（硬规则 3b）：`crossed`（有越阈项）/ `none`（无越阈项）/ `not-evaluated`
//      （语料读不到、或阈值未配置）。`aggregates` 为 **null ⇔ not-evaluated**——⛔ 绝不与
//      `[]`（**查过**、本轮无命中）共用取值：前者是「没查成」，后者是「查成了、没有」。
//   ② digest 只取【越阈项的签名】与三态 token，⛔ **原始计数一律不进**——计数每轮都可能变，
//      进了摘要会让变化检测闸恒为真、每轮烧 LLM（硬规则 4 推论一；同 staleSecs/repeatCount 的纪律）。
//   ③ 阈值 ⛔ **不写字面量**（硬规则 4 推论二）：从 `.quay/config.yml` 的 `action_record_failures:`
//      段读；未配置 ⇒ 走 `not-evaluated` + 独立 reason，**不设「恰好合理」的默认值**。

/** 动作记录扫描结果的载体（gitignored 运行时状态，与轮载体分开——它是【缓存】不是【记录】）。 */
export const ACTION_RECORD_SCAN_REL = path.join(".quay", "action-record-scan.json");

/** 一条动作记录失败（= meta-cc `query_session_signals type=errors` 结果里的一条记录；
 *  其**实际交付形态**是投影后的 `{category, error_text, session_id, timestamp, tool_name}`，
 *  ⛔ 不是原始 transcript 的 `message.content[].is_error` —— 见 `errorTextsFromRecord`）。
 *  `signature` 是归一化后的错误签名（同一错误的多次出现归到同一个键）；`sessionId` 是
 *  【跨会话】这个维度的承载——聚合要数的是「命中几个不同会话」，⛔ 不是「总共几条」。 */
export interface ActionFailureRecord {
  sessionId: string;
  signature: string;
  /** 原始错误文本的截断样例（给人看「这是什么错」；⛔ 不进 digest）。 */
  example: string;
  ts: string | null;
}

/** 一个聚合项 = 一个错误签名 × 其跨会话命中面。⛔ 不是布尔。 */
export interface ActionFailureAggregate {
  signature: string;
  /** 命中会话数（去重后的 sessionId 个数）。 */
  sessions: number;
  /** 总次数（含同一会话内重复）。 */
  count: number;
  /** 是否越过本轮阈值（阈值由调用侧给定，⛔ 本函数内无字面量）。
   *  `null` = 阈值**尚未配置** ⇒ 不给越阈判定（⛔ 不与 `false`「查过、未越阈」同形，硬规则 3b）。 */
  crossed: boolean | null;
  /** 一条原始错误样例（截断）——SPEC §5.3：枚举对象、给指引，⛔ 不只给一个标量。 */
  example: string;
}

/** 第七类读数。状态见文件段注释①。
 *  ⚠️ `unthresholded` 是 AC3 三态之外的第四态，**必须存在**：本任务明令「⛔ 不定阈值数值——
 *  实测出的扫描耗时与命中率写进任务体后阈值才有依据」。若没有这一态，唯一的选择就是要么
 *  凭空定一个数（违反硬规则 4 推论一/二），要么把真实扫到的清单丢掉（AC7 落空）。
 *  ⇒ 把【扫描】（成本旋钮）与【越阈判定】（判断旋钮）**解耦**：扫描照跑、清单照出，
 *  只是 `crossed` 为 null——「我看见了什么」与「我判它越没越阈」是两件事。 */
export interface ActionFailureReading {
  state: "crossed" | "none" | "unthresholded" | "not-evaluated";
  /** null ⇔ not-evaluated（⛔ 与「查过、无命中」的 [] 不同形）。 */
  aggregates: ActionFailureAggregate[] | null;
  /** not-evaluated 的成因（语料读不到 / 阈值未配置 / 扫描失败）——同一 state 下成因可区分。 */
  reason: string | null;
  scannedAt: string | null;
  scanMs: number | null;
  since: string | null;
  recordsScanned: number | null;
  /** 本轮生效的阈值；null = 未配置（不与任何数值同形）。 */
  thresholdSessions: number | null;
}

/** `.quay/config.yml` 的 `action_record_failures:` 段。全部可缺省（⛔ 无字面量默认值，
 *  硬规则 4 推论二）：缺 ⇒ null，调用侧据此走 not-evaluated 而不是拿一个「恰好合理」的数。 */
export interface ActionRecordConfig {
  minSessions: number | null;
  windowMs: number | null;
  scanTtlMs: number | null;
  scanTimeoutMs: number | null;
}

/** 解析时长字面量（`30m`/`12h`/`7d`/裸数字=毫秒）。⛔ 只解析，不给默认值。 */
export function parseDurationMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
    if (m) {
      const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase() as "ms" | "s" | "m" | "h" | "d"];
      return Number(m[1]) * mult;
    }
  }
  return null;
}

/** 读 `.quay/config.yml` 的 `action_record_failures:` 段。读不到 / 段缺失 / 键缺失 ⇒ 对应字段 null
 *  （⛔ 不抛、⛔ 不回退到任何数值默认——见硬规则 4 推论二）。 */
export function readActionRecordConfig(root: string): ActionRecordConfig {
  const out: ActionRecordConfig = { minSessions: null, windowMs: null, scanTtlMs: null, scanTimeoutMs: null };
  let parsed: unknown;
  try {
    parsed = YAML(fs.readFileSync(path.join(root, ".quay", "config.yml"), "utf8"));
  } catch { return out; }
  const sec = parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>).action_record_failures
    : undefined;
  if (!sec || typeof sec !== "object") return out;
  const s = sec as Record<string, unknown>;
  const ms = s.min_sessions;
  if (typeof ms === "number" && Number.isInteger(ms) && ms >= 1) out.minSessions = ms;
  out.windowMs = parseDurationMs(s.window);
  out.scanTtlMs = parseDurationMs(s.scan_ttl);
  out.scanTimeoutMs = parseDurationMs(s.scan_timeout);
  return out;
}

/** 归一化错误签名：把每次出现都不同、但**不改变错误身份**的部分抹掉
 *  （commit sha / uuid / 数字 / 路径 / 引号内的一次性内容），保留错误本身的措辞。
 *  ⛔ 这一步是「同错误」可聚合的前提——不归一化则每次报错都是新签名，清单恒为全 1。 */
export function errorSignature(text: string): string {
  let s = String(text ?? "");
  s = s.replace(/\s+/g, " ").trim();
  // commit sha / uuid 片段（先于纯数字，长跑优先）。要求命中里【含数字】——否则英文里
  // 恰好由 a–f 组成的普通词（`defaced`/`acceded`）会被当成 sha 抹掉，把不同错误并成一个签名。
  s = s.replace(/\b[0-9a-f]{7,40}\b/gi, (m) => (/\d/.test(m) ? "<hex>" : m));
  // 退出码是失败的【类别】，不是一次性取值：137(SIGKILL/OOM 形) / 124(timeout) / 1|2(普通失败)
  // 是不同失败类别，抹成 <n> 会把它们并成一个签名（实测 2026-10-11：`Exit code <n>` 一组 160 条，
  // 覆盖 144/1/123/2/255/137/5/124/7 九个码）。开头的 `Exit code N` 逐字摘出，其余照常归一化。
  const exitCode = s.match(/^Exit code (\d+)/);
  if (exitCode) s = "\u0001" + s.slice(exitCode[0].length); // 占位符不含数字 ⇒ 下面规则命中不到
  s = s.replace(/\d+/g, "<n>");                       // 行号 / 计数 / 时间戳数字
  s = s.replace(/(?:\/[\w.@+-]+){2,}/g, "<path>");    // 路径
  s = s.replace(/["'`][^"'`]{24,}["'`]/g, "<quoted>"); // 一次性长引文
  if (exitCode) s = exitCode[0] + s.slice(1);         // 原样接回退出码 token
  return s.slice(0, 200);
}

/** 产出扫描载体的**抽取器身份**：抽取+归一化管线（记录解包 → 逐条错误正文 → 签名归一化）源码
 *  的指纹。⚠️ 用源码指纹而**不是**手写版本号——手写号改了代码却忘记 bump 时，被取代的实现写的
 *  旧载体仍会被当作新鲜读数服务出去，而那正是本任务的缺陷（2026-11-06：`error_text` 支路修好前
 *  写下的零记录载体，18.8 h 后被当成「查过、干净」）。源码指纹自动跟随实现：管线任一环变了 ⇒
 *  指纹变 ⇒ 旧载体不再被采信（保守方向只是一次多余重扫，⛔ 不会静默放行）。
 *  `Function.prototype.toString()` 在同一构建里稳定（同一源码 ⇒ 同一指纹）。 */
export const ACTION_RECORD_EXTRACTOR_ID: string = createHash("sha256")
  .update([extractActionFailureRecords, mcpResultRecords, errorTextsFromRecord, flattenContentText, errorSignature]
    .map((f) => f.toString()).join("\n"))
  .digest("hex")
  .slice(0, 16);

/** 从 meta-cc `query_session_signals type=errors` 的查询结果里抽动作记录。
 *  ⛔ **返回 null 与返回 [] 不同义**（硬规则 3b）：null = 这坨结果我**读不懂**（形状不认识 /
 *  没有可解析的载荷），[] = 读懂了、里面**没有**错误记录。⚠️ 调用侧（`aggregateActionFailures`）
 *  对 [] 仍走 not-evaluated：见那里的注释——「读到零条」与「查过、干净」不可分。 */
export function extractActionFailureRecords(queryResult: unknown): ActionFailureRecord[] | null {
  const records = mcpResultRecords(queryResult);
  if (records === null) return null;
  const out: ActionFailureRecord[] = [];
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    const sessionId = String(r.sessionId ?? r.session_id ?? r.threadId ?? "");
    const ts = typeof r.timestamp === "string" ? r.timestamp : null;
    // 归一化后的记录形态各版本可能不同 ⇒ 逐条【枚举】候选承载点，⛔ 不赌单一键名。
    for (const err of errorTextsFromRecord(r)) {
      if (!sessionId) continue;
      out.push({ sessionId, signature: errorSignature(err), example: err.replace(/\s+/g, " ").trim().slice(0, 300), ts });
    }
  }
  return out;
}

/** 「读不懂」时的形状提示：把信封的顶层键与 mode 打出来，⛔ 不打印内容（可能很大 / 含隐私）。
 *  用途是把「解析器少了一支」与「语料真的读不到」在**故障信息里**就分开——两者的处置完全不同。 */
export function describeResultShape(queryResult: unknown): string {
  try {
    const content = (queryResult as Record<string, unknown>)?.content;
    if (!Array.isArray(content)) return "no content[]";
    const t = (content[0] as Record<string, unknown>)?.text;
    if (typeof t !== "string") return "content[0].text not a string";
    const j = JSON.parse(t) as Record<string, unknown>;
    if (Array.isArray(j)) return `payload=array(len=${j.length})`;
    return `payload keys=${Object.keys(j).join(",")} mode=${String(j.mode)}`;
  } catch (e) {
    return `shape probe failed: ${(e as Error).message}`;
  }
}

/** 从一条会话记录里枚举全部错误文本。**枚举**候选承载点，⛔ 不赌单一键名/单一形态：
 *   ① meta-cc `query_session_signals type=errors` 的**实际交付形态**（2026-11-06 对活语料实测，
 *      逐字取自 `meta-cc` 的返回）：
 *        `{category, error_text, session_id, timestamp, tool_name}`
 *      —— `error_text` 才是本条记录的错误正文；**没有** `message.content[].is_error`。
 *      ⛔ 漏掉这一支 = 逐条静默跳过 ⇒ 整类读数恒报 `none` 且与「查过、没有重复失败」同形
 *      （硬规则 3b 的镜像：读到了语料、一个字段都没认出、报「检查通过」）。
 *   ② 原始 transcript 形态：`message.content[]` 里 `is_error:true` 的 tool_result（本函数首版的
 *      唯一一支；仍是 meta-cc 某些视图/版本可能交付的形状，保留）。
 *   ③ 规范化 provider 形态：字符串 `error` / `error_message`。
 *  读不出任何结构 ⇒ []（本条记录没贡献），⛔ 不抛。 */
function errorTextsFromRecord(rec: Record<string, unknown>): string[] {
  const out: string[] = [];
  // ② 原始 transcript 形态
  const msg = rec.message;
  const content = msg && typeof msg === "object" ? (msg as Record<string, unknown>).content : undefined;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      if (cc.is_error !== true) continue;
      const text = flattenContentText(cc.content);
      if (text.trim()) out.push(text);
    }
  }
  if (out.length > 0) return out;
  // ①/③ 投影形态 / 规范化形态——逐条枚举候选键名（⛔ 不赌单一键名）。
  for (const k of ["error_text", "errorText", "error", "error_message", "errorMessage"]) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) { out.push(v); break; }
  }
  return out;
}

/** `content` 可能是字符串，或 `[{type:"text",text}]` 数组。压平成一段文本。 */
function flattenContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((x) => (x && typeof x === "object" ? String((x as Record<string, unknown>).text ?? "") : String(x ?? "")))
      .join(" ");
  }
  if (content && typeof content === "object") return String((content as Record<string, unknown>).text ?? "");
  return "";
}

/** 从 MCP `tools/call` 的 result 信封里取出【记录数组】。⛔ 取不出 ⇒ null（读不懂，不是「没有」）。
 *  meta-cc 的 `content[0].text` 是一段 JSON 字符串；不同工具分别返回数组或 `{records:[…]}` 形对象。 */
function mcpResultRecords(queryResult: unknown): Array<Record<string, unknown>> | null {
  let payload = queryResult;
  // content[0].text → JSON 字符串
  const content = payload && typeof payload === "object" ? (payload as Record<string, unknown>).content : undefined;
  if (Array.isArray(content)) {
    const texts = content
      .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>).text : undefined))
      .filter((t): t is string => typeof t === "string");
    if (texts.length > 0) {
      try { payload = JSON.parse(texts.join("")); } catch { return null; }
    }
  }
  // 信封可能再包一层 structuredContent（⛔ 不赌单一形态）。
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const sc = (payload as Record<string, unknown>).structuredContent;
    if (sc !== undefined) payload = sc;
  }
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    // meta-cc 的 hybrid output（internal/mcp/response/adapter.go）：结果大到超过阈值时走
    // `file_ref` 模式——信封里给 `file_ref.path`，**记录本体在那个 JSONL 临时文件里**。
    // ⚠️ 实测（2026-09-12）：不处理这一支时，全量扫描（>inline 阈值）永远解析不出来，
    // 本读数会恒报 corpus-unreadable——而它看起来像「语料读不到」，不像「解析器少了一支」。
    // 读它 = 读 meta-cc 自己的交付形态（⛔ 不是手搓语料解析）。
    const fr = o.file_ref;
    if (fr && typeof fr === "object") {
      const p = (fr as Record<string, unknown>).path;
      if (typeof p !== "string" || !p) return null;
      let text: string;
      try { text = fs.readFileSync(p, "utf8"); } catch { return null; }
      const rows: Array<Record<string, unknown>> = [];
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try { rows.push(JSON.parse(t) as Record<string, unknown>); } catch { return null; }
      }
      return rows;
    }
    for (const k of ["records", "results", "data", "items"]) {
      const v = o[k];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    }
  }
  return null;
}

/** 纯聚合：动作记录 → 按「同错误 × 跨会话」聚合的清单。⛔ 排序确定性（digest 稳定性靠它：
 *  同一份语料 ⇒ 同一份清单 ⇒ 同一份签名序列）。`records === null`（读不懂）⇒ not-evaluated。
 *
 *  ⚠️ **零记录同样 ⇒ not-evaluated**（硬规则 3b，2026-11-06 实证）：`[]` 与「查过、干净」同形，
 *  但产生 `[]` 的成因至少两种——语料真的没有错误，**或者**抽取器一条都没认出（那一版只认
 *  `message.content[].is_error`，而 meta-cc 实际交付的是投影形态 `error_text` ⇒ 逐条静默跳过）。
 *  两者在读数上不可分，所以「零记录」不是一个可取假的测量，不能报成合格侧。它有自己的
 *  reason（`empty-corpus:`），与「读不懂」（`corpus-unreadable:`）同 state 但成因可区分。 */
export function aggregateActionFailures(
  records: ActionFailureRecord[] | null,
  opts: { minSessions: number | null; scannedAt?: string | null; scanMs?: number | null; since?: string | null; reason?: string | null },
): ActionFailureReading {
  const meta = {
    scannedAt: opts.scannedAt ?? null,
    scanMs: opts.scanMs ?? null,
    since: opts.since ?? null,
    thresholdSessions: opts.minSessions,
  };
  if (records === null) {
    return { state: "not-evaluated", aggregates: null, reason: opts.reason ?? "corpus-unreadable", ...meta, thresholdSessions: null };
  }
  if (records.length === 0) {
    // ⛔ 不并入下面的 none 分支：零记录不是「查过、干净」的证据（见函数注释）。
    return {
      state: "not-evaluated", aggregates: null,
      reason: opts.reason ?? "empty-corpus: scan yielded 0 records — indistinguishable from an extractor that recognized nothing",
      ...meta, recordsScanned: 0,
    };
  }
  const bySig = new Map<string, { sessions: Set<string>; count: number; example: string }>();
  for (const r of records) {
    if (!r.signature) continue;
    let e = bySig.get(r.signature);
    if (!e) { e = { sessions: new Set<string>(), count: 0, example: r.example }; bySig.set(r.signature, e); }
    e.sessions.add(r.sessionId);
    e.count++;
  }
  const min = opts.minSessions;
  const aggregates: ActionFailureAggregate[] = [...bySig.entries()]
    .map(([signature, e]) => ({
      signature, sessions: e.sessions.size, count: e.count,
      crossed: min === null ? null : e.sessions.size >= min, example: e.example,
    }))
    // 确定性排序：越阈的在前，再按 会话数 desc / 次数 desc / 签名 asc——⛔ 不依赖 Map 插入序
    // （digest 的稳定性靠它：同一份语料必须给出同一个签名序列）。
    .sort((a, b) => (Number(b.crossed ?? false) - Number(a.crossed ?? false)) || (b.sessions - a.sessions) || (b.count - a.count) || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
  const state: ActionFailureReading["state"] = min === null
    ? "unthresholded"
    : aggregates.some((a) => a.crossed) ? "crossed" : "none";
  return { state, aggregates, reason: opts.reason ?? null, ...meta, recordsScanned: records.length };
}

/** meta-cc MCP 可执行文件的定位（单一真相源）。优先级：`QUAY_META_CC_MCP` 显式覆盖 →
 *  `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/bin/meta-cc-mcp`（取最高版本）→
 *  `~/.local/share/meta-cc/bin/meta-cc-mcp`（meta-cc 当前安装落点）→
 *  `~/.local/bin/meta-cc-mcp`（meta-cc 旧 `make install` 落点）。
 *  ⛔ 找不到 ⇒ null（调用侧转 not-evaluated，⛔ 不是「没有重复失败」）。 */
export function locateMetaCcMcp(env: Record<string, string | undefined> = process.env, home: string = os.homedir()): string | null {
  const explicit = env.QUAY_META_CC_MCP;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const found: string[] = [];
  const cacheRoot = path.join(home, ".claude", "plugins", "cache");
  try {
    for (const mk of fs.readdirSync(cacheRoot)) {
      for (const pl of fs.readdirSync(path.join(cacheRoot, mk))) {
        const plDir = path.join(cacheRoot, mk, pl);
        let versions: string[];
        try { versions = fs.readdirSync(plDir); } catch { continue; }
        for (const v of versions) {
          const bin = path.join(plDir, v, "bin", "meta-cc-mcp");
          if (pl.startsWith("meta-cc") && fs.existsSync(bin)) found.push(bin);
        }
      }
    }
  } catch { /* 无 cache 目录 ⇒ 继续走下一个候选 */ }
  const share = path.join(home, ".local", "share", "meta-cc", "bin", "meta-cc-mcp");
  if (fs.existsSync(share)) found.push(share);
  const local = path.join(home, ".local", "bin", "meta-cc-mcp");
  if (fs.existsSync(local)) found.push(local);
  if (found.length === 0) return null;
  // 版本比较按【路径里的数字段】降序，取最高——⛔ 不按字典序（"3.10" < "3.9" 会选错）。
  return found.sort((a, b) => versionKey(b) - versionKey(a))[0];
}

function versionKey(p: string): number {
  const m = p.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : 0;
}

/** 经 MCP stdio 调 meta-cc 的一个工具，返回 `result` 信封（⛔ 不是 tools/list 那种协议层东西）。
 *  失败/超时/协议错 ⇒ `{ok:false, reason}`——**独立取值**，⛔ 不返回 null 冒充空结果（硬规则 3b）。
 *  `timeoutMs: null` = 不设超时（⛔ 不写有限默认值：成本结构未实测前不设阈值，硬规则 4 推论一）。 */
export async function callMetaCcTool(opts: {
  binary: string; tool: string; args: Record<string, unknown>; cwd: string; timeoutMs: number | null;
}): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(opts.binary, [], { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, reason: `spawn failed: ${(e as Error).message}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: { ok: true; result: unknown } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      resolve(r);
    };
    if (opts.timeoutMs !== null && Number.isFinite(opts.timeoutMs)) {
      timer = setTimeout(() => finish({ ok: false, reason: `scan timeout after ${opts.timeoutMs}ms (SIGKILL)` }), opts.timeoutMs);
    }
    child.on("error", (e) => finish({ ok: false, reason: `spawn error: ${e.message}` }));
    child.on("close", () => finish({ ok: false, reason: `server exited before responding (stderr: ${stderr.trim().slice(0, 200)})` }));
    child.stdout?.on("data", (d) => {
      stdout += String(d);
      // meta-cc 的日志也走 stdout ⇒ 逐行找【带我们 id 的那一行】，⛔ 不解析整屏。
      for (const line of stdout.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        let j: unknown;
        try { j = JSON.parse(t); } catch { continue; }
        const o = j as Record<string, unknown>;
        if (o.id !== 2) continue;
        if (o.error) { finish({ ok: false, reason: `tool error: ${JSON.stringify(o.error).slice(0, 300)}` }); return; }
        finish({ ok: true, result: o.result });
        return;
      }
    });
    child.stderr?.on("data", (d) => { stderr += String(d); });
    const write = (o: unknown) => { try { child.stdin?.write(JSON.stringify(o) + "\n"); } catch { /* 写失败由 close/timeout 兜底 */ } };
    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "quay-meta-driver", version: "1" } } });
    write({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: opts.tool, arguments: opts.args } });
  });
}

/** 扫描结果载体：`{scannedAt, scanMs, since, extractor, records}`。读不到 / 解析不了 ⇒ null
 *  （⛔ 不是「空语料」）。`extractor` 是**产出该载体的抽取器身份**（见 `ACTION_RECORD_EXTRACTOR_ID`）；
 *  早期载体没有这个键 ⇒ `null`（⛔ 不补一个当前值——那会把「不知谁写的」伪装成「我写的」）。 */
export interface ActionRecordScan {
  scannedAt: string;
  scanMs: number | null;
  since: string | null;
  extractor: string | null;
  records: ActionFailureRecord[];
}

export function readActionRecordScan(root: string): ActionRecordScan | null {
  let j: unknown;
  try { j = JSON.parse(fs.readFileSync(path.join(root, ACTION_RECORD_SCAN_REL), "utf8")); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (typeof o.scannedAt !== "string" || !Array.isArray(o.records)) return null;
  const records: ActionFailureRecord[] = [];
  for (const r of o.records) {
    if (!r || typeof r !== "object") continue;
    const rr = r as Record<string, unknown>;
    if (typeof rr.sessionId !== "string" || typeof rr.signature !== "string") continue;
    records.push({ sessionId: rr.sessionId, signature: rr.signature, example: String(rr.example ?? ""), ts: typeof rr.ts === "string" ? rr.ts : null });
  }
  return {
    scannedAt: o.scannedAt, scanMs: typeof o.scanMs === "number" ? o.scanMs : null,
    since: typeof o.since === "string" ? o.since : null,
    extractor: typeof o.extractor === "string" ? o.extractor : null,
    records,
  };
}

/** 跑一次真实语料扫描并落载体。返回扫描结果或失败原因（⛔ 失败不写半成品载体）。 */
export async function scanActionRecords(
  root: string,
  cfg: ActionRecordConfig,
  opts: { now?: number; binary?: string | null } = {},
): Promise<{ ok: true; scan: ActionRecordScan } | { ok: false; reason: string }> {
  const binary = opts.binary === undefined ? locateMetaCcMcp() : opts.binary;
  if (!binary) return { ok: false, reason: "meta-cc-mcp not found (set QUAY_META_CC_MCP or install meta-cc)" };
  const nowMs = opts.now ?? Date.now();
  const since = cfg.windowMs === null ? null : new Date(nowMs - cfg.windowMs).toISOString();
  const args: Record<string, unknown> = { type: "errors", working_dir: root };
  if (since) args.since = since;
  const t0 = Date.now();
  const r = await callMetaCcTool({ binary, tool: "query_session_signals", args, cwd: root, timeoutMs: cfg.scanTimeoutMs });
  const scanMs = Date.now() - t0;
  if (!r.ok) return { ok: false, reason: r.reason };
  const records = extractActionFailureRecords(r.result);
  if (records === null) return { ok: false, reason: `corpus-unreadable: meta-cc result shape unrecognized (${describeResultShape(r.result)})` };
  const scannedAt = new Date(nowMs).toISOString();
  // ⚠️ `extractor` 必须随载体落盘：没有它，读侧只能靠 `scannedAt` 判新鲜（TTL 内一律采信），
  // 于是一个**被取代的实现**写下的载体在 TTL 内与本次实现写下的载体同形——正是本任务的缺陷。
  const scan: ActionRecordScan = { scannedAt, scanMs, since, extractor: ACTION_RECORD_EXTRACTOR_ID, records };
  try {
    // 同一族载体的写侧也是原子的（硬规则 5b：`writeState` 之外，本文件还有这一处裸写；它同样是
    // 一个被并发读的 JSON 缓存载体，裸写会让读侧看到半写 ⇒ 当作「无缓存」再扫一次）。
    writeJsonAtomic(path.join(root, ACTION_RECORD_SCAN_REL), scan);
  } catch (e) {
    return { ok: false, reason: `scan carrier write failed: ${(e as Error).message}` };
  }
  return { ok: true, scan };
}

/** 采第七类读数。成本控制【只靠缓存 + TTL】（见文件段注释：`since` 不降低成本）：
 *  载体新鲜（< `scan_ttl` **且**由本实现的抽取器产出）⇒ 直接聚合；过期/缺失/旧抽取器产出
 *  且 `scan_ttl` 已配置 ⇒ 真扫一次再聚合。
 *  `scan_ttl` **未配置 ⇒ 从不自动扫**（⛔ 不写字面量默认 TTL）——此时有载体就用载体、
 *  没载体就 not-evaluated。这让「自动扫描」是一个**显式的运维选择**，而不是一个隐式开销。 */
export async function collectActionRecordFailures(
  root: string,
  opts: { now?: number; cfg?: ActionRecordConfig; binary?: string | null; allowScan?: boolean } = {},
): Promise<ActionFailureReading> {
  const cfg = opts.cfg ?? readActionRecordConfig(root);
  const nowMs = opts.now ?? Date.now();
  let scan = readActionRecordScan(root);
  // 「新鲜」= 两条判据同时成立：①年龄在 TTL 内；②载体由**本实现**的抽取器产出。
  // ⛔ 只看 ①：一个被取代实现写的载体在 TTL 内与本次实现写的载体同形（硬规则 3b）——
  // 2026-11-06 的现场正是这样：零记录载体出自修好 `error_text` 之前的实现，18.8 h 后被当作新鲜读数。
  const currentExtractor = (s: ActionRecordScan | null): boolean => s !== null && s.extractor === ACTION_RECORD_EXTRACTOR_ID;
  const fresh = scan !== null && cfg.scanTtlMs !== null
    && (nowMs - Date.parse(scan.scannedAt)) < cfg.scanTtlMs
    && currentExtractor(scan);
  const allowScan = opts.allowScan !== false;
  let staleReason: string | null = null;
  if (!fresh && allowScan && cfg.scanTtlMs !== null) {
    const r = await scanActionRecords(root, cfg, { now: nowMs, binary: opts.binary });
    if (r.ok) scan = r.scan;
    else if (scan === null) {
      return {
        state: "not-evaluated", aggregates: null, reason: `scan-failed: ${r.reason}`,
        scannedAt: null, scanMs: null, since: null, recordsScanned: null, thresholdSessions: null,
      };
    } else {
      // 扫描失败但有旧载体 ⇒ 落到下面用旧载体（值仍来自**真实**扫描，只是旧），但【必须】在
      // reason 上命名这次扫描失败——⛔ 不再静默回退：stale-served 与 fresh 读数同形（硬规则 3b），
      // 正是本任务的缺陷。`scannedAt` 会暴露年龄，但 digest 只取 crossed 签名、对年龄盲视。
      staleReason = `scan-failed: ${r.reason} (served stale carrier scannedAt=${scan.scannedAt})`;
    }
  }
  if (scan === null) {
    return {
      state: "not-evaluated", aggregates: null, reason: "corpus-unreadable: no scan carrier present",
      scannedAt: null, scanMs: null, since: null, recordsScanned: null, thresholdSessions: null,
    };
  }
  if (!currentExtractor(scan)) {
    // 载体是本实现**产不出**的（旧抽取器写的，或早期无戳载体）⇒ ⛔ 绝不当读数服务出去。
    // 这不是「读不到语料」而是「这份语料不是我认得的抽取器读出来的」——独立 reason，
    // 处置不同：前者修 meta-cc 连接，后者重扫一次即可。`scan_ttl` 未配置时也会走到这里
    // （那时从不自动扫 ⇒ 只能报未评估，等运维跑 `--scan-action-records`）。
    return {
      state: "not-evaluated", aggregates: null,
      reason: `superseded-extractor: carrier extractor=${scan.extractor ?? "<unstamped>"} != current ${ACTION_RECORD_EXTRACTOR_ID}`
        + ` (scannedAt=${scan.scannedAt})` + (staleReason ? `; ${staleReason}` : ""),
      scannedAt: scan.scannedAt, scanMs: scan.scanMs, since: scan.since,
      recordsScanned: scan.records.length, thresholdSessions: cfg.minSessions,
    };
  }
  // ⛔ `minSessions` 可以是 null（阈值尚未由人定值）——这时**照出清单**、只是不给越阈判定
  // （见 `ActionFailureReading` 的 `unthresholded` 注释）：扫描是成本旋钮、越阈是判断旋钮，
  // 两者解耦。否则「不定阈值」就等于「不看语料」，AC7 会落空。
  return aggregateActionFailures(scan.records, {
    minSessions: cfg.minSessions, scannedAt: scan.scannedAt, scanMs: scan.scanMs, since: scan.since,
    reason: staleReason,
  });
}

/** 采本轮读数：active goal → 其下全部 AC → 逐条真跑 criterion → 算 divergence。
 *  `cliFocus` 是 CLI `--focus`（一次性人工干跑）的显式方向，优先级高于文件；两者都缺时
 *  `readings.focus` = 每轮现读的 orchestration/meta-driver-focus.md 覆盖段内容（常驻场景的人给方向通道）。 */
export async function collectReadings(root: string, cliFocus: string | null): Promise<MetaRoundReadings> {
  const all = await listGoalRecords(root);
  const goals = all
    .filter((r) => String(r.id ?? "").startsWith("GOAL-") && r.status === "active")
    .map((r) => ({ id: String(r.id), title: r.title == null ? null : String(r.title), status: String(r.status) }));
  const goalIds = new Set(goals.map((g) => g.id));
  const acs = all.filter((r) => String(r.id ?? "").startsWith("AC-") && goalIds.has(String(r.goal ?? "")));

  // supersede 关系从【同一批】`all` 记录里取——⛔ 不新增第二次 store 读（那是白花一次读面成本，
  // 且两次读可能落在不同时刻、拼出一个不存在的状态组合）。两向都取：实测存在单向漂移
  // （AC-938.supersedes=[AC-934] 而 AC-934.supersededBy=[]），由 `supersedeRelations` 取并集
  // 并在 reason 里标 direction:one-way。
  const idArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter((s) => s !== "") : [];
  const criteria: CriterionReading[] = [];
  for (const ac of acs) {
    const id = String(ac.id);
    const criterion = ac.criterion == null ? null : String(ac.criterion);
    const { verdict, reason, cause } = await gateCriterion(root, id, { recordTimeoutMs: ac.timeoutMs });
    criteria.push({
      id,
      title: ac.title == null ? null : String(ac.title),
      goal: ac.goal == null ? null : String(ac.goal),
      status: String(ac.status ?? ""),
      criterion,
      verdict,
      reason,
      cause,
      // store 的投影字段：`supersedes` = 本 AC 取代谁，`supersededBy` = 谁取代本 AC。
      // ⛔ 原样传两向，判定侧取并集——不在这里「归一化」成一个方向（那会把漂移抹掉）。
      supersedes: idArray(ac.supersedes),
      supersededBy: idArray(ac.supersededBy),
    });
  }
  const drivers = collectDriverReadings(root);
  // 处理者路由：先附 handler 三态（由 drivers 读数派生），再算重复计数。⛔ 顺序无关紧要，但
  // handler 必须在每条偏离上非空——它是 probe 决定「报不报、报谁」的分类轴。
  const divergences = attachDivergenceHandlers(computeDivergences(criteria), drivers);
  // 重复计数：从自己的载体机械算出（⛔ 不进摘要，见 readingsDigest），逐条附到 divergence 上。
  const recurrence = computeDivergenceRecurrence(extractJudgeRounds(readMetaCarrier(root)), divergences);
  for (const d of divergences) {
    const r = recurrence.get(divergenceKey(d.id, d.kind));
    d.repeatCount = r?.repeatCount ?? 0;
    d.lastRecommendation = r?.lastRecommendation ?? null;
  }
  // CLI --focus（一次性）优先；否则每轮现读文件覆盖段（常驻的人给方向通道）。两者都缺 ⇒ null。
  const focus = cliFocus ?? readFocusFile(root);
  // 时序派生层：读 goal-round 载体一次，对当前 criteria 里每个 AC 派生存续信号（⛔ 只读一次载体，
  // 每个 AC 重读一遍会线性放大 IO）。载体读不到 ⇒ 每条信号 evaluated:false（⛔ 不冒充「streak=0」）。
  const timeSeries = deriveGoalCarrierSignals(readRoundCarrier(root, GOAL_ROUND_CARRIER_REL), criteria.map((c) => c.id));
  // 第七类读数：动作记录失败聚合。⚠️ 这是本函数里**唯一可能长时间阻塞**的一步（真扫语料
  // 实测 ≥15 分钟）——所以它自己带 TTL 缓存，且 `scan_ttl` 未配置时从不自动扫（见该函数注释）。
  const actionRecordFailures = await collectActionRecordFailures(root);
  return {
    goals, criteria, divergences, drivers,
    syncHealth: collectSyncHealth(root),
    metaRecords: collectMetaRecords(root),
    inertCheckers: collectInertCheckers(root),
    focus,
    timeSeries,
    actionRecordFailures,
    // 停放读数（gap-meta-scanparkingboard）：promotion-driver 每轮落盘的载体 → 本层每轮消费。
    // ⛔ 默认允许回退现扫（载体缺失时），因为「没读成」必须与「没有一条该解停」可区分（硬规则 3b）。
    parking: collectParkingReadings(root),
  };
}

// ── 提案的闸与落地 ────────────────────────────────────────────────────────────────────────────────

/** 一条提案（语义半的产出形状，与 probe 规格里的 JSON 契约一一对应）。 */
export interface Proposal {
  goal: string;
  title: string;
  criterion: string;
  expect: string;
  origin: string;
  /** 可选：本条提案意图取代的旧 AC id。**这是一条声明，不是一次处置**——它只记录「新提案 X
   *  与旧 AC Y 的替代关系」，让这层关联第一次有了载体（此前只存在于人的脑子里：决策通道的
   *  prompt 要人自己去跑 supersede，中间不留任何记录）。
   *
   *  ⛔ 边界（gap-meta-driver-proposal-lacks-supersedes-field 的 DoD，且由 store 结构性保证）：
   *  写入它**不会**翻转旧 AC 的 status。goal-store 的处置分支以 `isGoalRecord` 为闸
   *  （goal-store.ts:2322），而本 driver 只写 `AC-*` ⇒ 旧 AC 的状态在任何路径上都不动。
   *  淘汰旧 AC 仍然是人的动作。 */
  supersedes?: string;
}

/** 把提案渲染成 `routine-file-gate` 认识的候选文本（**同一个函数也用来给既有记录算 key**，
 *  这样两边的 key 可比——⛔ 不要为既有记录另写一套 key 算法）。 */
export function proposalCandidateText(p: { title?: string; criterion?: string | null; origin?: string | null }): string {
  return `## Finding\n${p.title ?? ""}\n\n${p.origin ?? ""}\n\n${p.criterion ?? ""}\n`;
}

/** 把 **goal/AC 记录自己的 `status`** 映射进**看板的任务状态词汇**，好让同一个 `dedupReading`
 *  判定可以直接套用（⛔ 不另写一套 dedup——本任务的 Plan 明确要求复用 probe 路径的形状）。
 *
 *  ⚠️ 缺陷原样（本任务 Proposal ③）：`existingProposalKeys` 此前把**每一条** `AC-*` 记录的 key
 *  都塞进集合而**完全不看 status**，于是被 `superseded`/`achieved` 的旧 AC 永久压制同名提案——
 *  这正是 probe 路径已由 `dedupReading` 的 `done-only` 态修掉的同一个「done key 永久压制」形状，
 *  只是提案路径漏了。此外那个裸 `Set` 被 `dedupReading` 判成 `unknown`，拒绝理由读作
 *  「bare Set … NOT EVALUATED」——那**不实**：它明明被评估过，只是没带拥有者状态。
 *
 *  三态映射（硬规则 3b：第三态是 `null`，⛔ 不与任一已知态同形）：
 *    · 未决（`draft` / `active` / `needs-human`）→ `"ready"`（→ `live` ⇒ 拦：AC(c) 的
 *      「active-goal draft AC 仍拒」）；
 *    · 已了结（`achieved` / `superseded` / `retired`）→ `"done"`（→ `done-only` ⇒ 不拦：AC(c)
 *      的 superseded 被接受；`retired`「已撤回」同为了结态，一并算闭——硬规则 5b 的兄弟实例）；
 *    · 其它 / 缺失 → `null`（拥有者状态读不出 ⇒ `unknown` ⇒ fail-closed，⛔ 冒充不了 `done-only`）。 */
export function proposalBoardStatus(status: unknown): string | null {
  const s = status == null ? "" : String(status).trim().toLowerCase();
  if (s === "draft" || s === "active" || s === "needs-human") return "ready";
  if (s === "achieved" || s === "superseded" || s === "retired") return "done";
  return null;
}

/** 既有 AC 记录的 key 集（用于 dedup）。用与候选相同的渲染 + findingKey。
 *
 *  ⚠️ 返回类型是 `BoardKeys`（`Set<string>` 的子类，带每个 key 的**拥有者状态**）——所以
 *  `dedupReading` 能像 probe 路径那样按 status 分类，而不是把裸 Set 一律判成 `unknown`。
 *  所有既有读法（`.size` / `[...keys]` / `.has` / `.add`）逐字不变。 */
export function existingProposalKeys(records: Array<Record<string, unknown>>): BoardKeys {
  const owners = new Map<string, BoardKeyOwner[]>();
  for (const r of records) {
    if (!String(r.id ?? "").startsWith("AC-")) continue;
    const k = findingKey(proposalCandidateText({
      title: r.title == null ? "" : String(r.title),
      criterion: r.criterion == null ? "" : String(r.criterion),
      origin: r.origin == null ? "" : String(r.origin),
    }));
    if (!k) continue;
    const owner: BoardKeyOwner = { file: `${String(r.id)}.md`, status: proposalBoardStatus(r.status) };
    const list = owners.get(k);
    if (list) list.push(owner); else owners.set(k, [owner]);
  }
  return new BoardKeys(owners);
}

/** 下一个可用的顺序编号：扫 `${prefix}-<≥digits 位数字>`，取 max+1，按 digits 左补零。
 *  ⛔ 不复用已存在的编号（硬规则 8：编号不得复用）。
 *  为什么是一个函数而不是两套：AC 与 GOAL 的**唯一**差别就是前缀字面量与位数，两份各自演化的
 *  扫描循环是对同一规则的第二个定义（硬规则 5b）——archguard dup 6e19b6d306d82356 记的就是它。 */
export function nextSequenceId(records: Array<Record<string, unknown>>, prefix: string, digits = 3): string {
  const re = new RegExp(`^${escapeRegExp(prefix)}-(\\d{${digits},})$`);
  let max = 0;
  for (const r of records) {
    const m = String(r.id ?? "").match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(digits, "0")}`;
}

/** 下一个可用 AC id（薄包装：nextSequenceId 是唯一定义）。⛔ 不复用已存在的编号（硬规则 8：编号不得复用）。 */
export function nextAcId(records: Array<Record<string, unknown>>): string {
  return nextSequenceId(records, "AC");
}

/** 写一条 draft 提案。⛔ 永不传 --status：goal-store 的 write 缺省即 draft（构造上惰性）。 */
export async function writeDraftProposal(root: string, id: string, p: Proposal, dataRoot: string = root): Promise<{ ok: boolean; reason: string }> {
  const argv = goalStoreArgv(root, [
    "write", id,
    "--goal", p.goal,
    "--title", p.title,
    "--criterion", p.criterion,
    "--expect", p.expect,
    "--origin", p.origin,
    // `supersedes` 非空时才追加 ⇒ 未声明的提案 argv 与改动前逐字一致（零变化路径不只是解析层的
    // 契约，argv 层同样成立——否则 AC1 的「逐字一致」会因为多一个 flag 而只对了一半）。
    ...(p.supersedes && p.supersedes.trim() !== "" ? ["--supersedes", p.supersedes.trim()] : []),
  ], dataRoot);
  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { ok: false, reason: `write spawn error: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `write exit ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}` };
  // 写盘即提交：goal-store 的 write 自己写盘后立即提交（gap-meta-commitgoalfile），未跟踪
  // goals/*.md 不再阻塞 develop→doc 的 ff-only 同步——⛔ 这里不再二次提交（不新建并行机制）。
  return { ok: true, reason: "written as draft" };
}

/** 过闸 + 落地提案。返回每条的处置（accepted / 被哪一闸挡下），**逐条留痕**——⛔ 不只报总数
 *  （硬规则 3：枚举不布尔）。 */
export async function fileProposals(
  root: string,
  proposals: Proposal[],
  records: Array<Record<string, unknown>>,
  opts: { k: number; activeGoalIds: Set<string>; dryRun: boolean; dataRoot?: string },
): Promise<Array<{ proposal: Proposal; id: string | null; accepted: boolean; reason: string }>> {
  const results: Array<{ proposal: Proposal; id: string | null; accepted: boolean; reason: string }> = [];
  const keys = existingProposalKeys(records);
  const known = [...records];
  let acceptedThisRound = 0;

  for (const p of proposals) {
    if (!opts.activeGoalIds.has(p.goal)) {
      results.push({ proposal: p, id: null, accepted: false, reason: `invalid goal id ${JSON.stringify(p.goal)} (not an active goal)` });
      continue;
    }
    const candidate = proposalCandidateText(p);
    const g = gateFinding(candidate, { existingKeys: keys, recentCount: acceptedThisRound, K: opts.k });
    if (!g.accept) { results.push({ proposal: p, id: null, accepted: false, reason: g.reason }); continue; }
    const id = nextAcId(known);
    if (opts.dryRun) {
      results.push({ proposal: p, id, accepted: true, reason: "dry-run: would write as draft" });
    } else {
      const w = await writeDraftProposal(root, id, p, opts.dataRoot ?? root);
      if (!w.ok) { results.push({ proposal: p, id, accepted: false, reason: w.reason }); continue; }
      results.push({ proposal: p, id, accepted: true, reason: w.reason });
    }
    keys.add(findingKey(candidate));
    known.push({ id, goal: p.goal, title: p.title, criterion: p.criterion, origin: p.origin });
    acceptedThisRound++;
  }
  return results;
}

// ── 轮末结算 evidence 写入（⛔ 不把共享检出留在脏状态）────────────────────────────────────────────
// 实测代价：一轮机械半把 23 个 tracked 的 goals/*.md 写脏，而其中【25 行改动全部只是 evidence.at
// 时间戳】——零信息。常驻后这会让主检出永久脏 ⇒ syncDevelopToDoc 的 --ff-only 失败 ⇒ 正好加剧
// 它本要观测的那个同步失败率。**一个观测机制不得因为观测而破坏被观测的系统。**
//
// 结算规则：只有时间戳变了 ⇒ 还原（无信息）；verdict/reading 真变了 ⇒ 保留并报出（有信息，
// 由调用侧决定提交）。⛔ 只还原「除 at 行外与 HEAD 逐字相同」的文件——若有人另外改过该文件，
// 比较必然不等，于是原样不动（不会毁掉别人在编辑的改动）。

/** 去掉 evidence 的 at 行后的内容（比较用；at 每轮必变且不携带信息）。
 *  单一真相源已迁到 Core 的 goal-store.ts（上方 import）——re-export 供 settleEvidenceWrites
 *  与 meta-driver.test.mjs 继续用同一判据，⛔ 不在此处另写一份。 */
export { stripEvidenceTimestamp };

export interface EvidenceSettlement { restored: string[]; kept: string[]; skipped: string[] }

/** 轮末结算。返回逐条处置（⛔ 不只报总数，硬规则 3 枚举不布尔）。 */
export function settleEvidenceWrites(root: string, goalsRel = "goals"): EvidenceSettlement {
  const out: EvidenceSettlement = { restored: [], kept: [], skipped: [] };
  const vcs = (args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  let dirty: string[];
  try {
    const r = vcs(["status", "--porcelain", "--", goalsRel]);
    if (r.status !== 0) return out;
    dirty = String(r.stdout ?? "").split("\n")
      .map((l) => l.trim()).filter((l) => l.startsWith("M "))
      .map((l) => l.slice(2).trim());
  } catch { return out; }

  for (const rel of dirty) {
    let head: string, work: string;
    try {
      const h = vcs(["show", `HEAD:${rel}`]);
      if (h.status !== 0) { out.skipped.push(rel); continue; }
      head = String(h.stdout ?? "");
      work = fs.readFileSync(path.join(root, rel), "utf8");
    } catch { out.skipped.push(rel); continue; }

    if (stripEvidenceTimestamp(head) === stripEvidenceTimestamp(work)) {
      const c = vcs(["checkout", "--", rel]);
      if (c.status === 0) out.restored.push(rel); else out.skipped.push(rel);
    } else {
      out.kept.push(rel); // verdict/reading 真变了 ⇒ 有信息，保留
    }
  }
  return out;
}

// ── 机制生态读数（driver 是否在跑 / 同步是否在成功）──────────────────────────────────────────────
// 为什么在这里：meta-driver 的职责是【发现机制层面的问题，并判断有没有机制在管它】。只看 goal
// 判据看不见「主检出落后 develop」「某 driver 停摆」这类问题——那正是人 2026-09-06 指出的缺口。
// ⛔ 不自己实现存活/载体统计：复用 driver-runtime 已有的 aliveness/carrierStats（硬规则①）。

/** 一个 driver kind 的生态读数。staleSecs = 现在距其载体最后一条记录的秒数（载体停更 ≠ 一切正常）。
 *  running=null 表示 aliveness 读不出（⛔ 不填 false 冒充「停了」——读不懂不得与「停摆」同形，硬规则 3b）。
 *  carrierUnreadable=null 表示 carrierStats 自身没跑成（⛔ 不得拿空数组冒充「全部读完了」——同上）。 */
export interface DriverReading {
  kind: string;
  running: boolean | null;
  supervisorAlive: boolean;
  driverAlive: boolean;
  carrierRecords: number;
  carrierLastTs: string | null;
  staleSecs: number | null;
  /** 存在但读不出的载体名（空数组 = 全部读完）；null = 载体观测本身没跑成。
   *  没有这个字段时，`carrierRecords=0` 同时覆盖「载体为空」「载体读不出」两种世界
   *  （硬规则 3b；gap-meta-collectdriverreadings）。 */
  carrierUnreadable: string[] | null;
}

export function collectDriverReadings(root: string, now: number = Date.now()): DriverReading[] {
  const out: DriverReading[] = [];
  for (const kind of KNOWN_KINDS) {
    let a, c;
    try { a = aliveness(root, kind); } catch { a = null; }
    try { c = carrierStats(root, kind); } catch { c = null; }
    const lastTs = c?.lastTs ?? null;
    const parsed = lastTs ? Date.parse(lastTs) : NaN;
    out.push({
      kind,
      // aliveness 读失败（a===null）⇒ running=null（⛔ 不填 false 冒充「停了」，硬规则 3b），
      // handler 三态据此把「读不出」与「停摆」分开。
      running: a === null ? null : !!a.running,
      supervisorAlive: !!a?.supervisorAlive,
      driverAlive: !!a?.driverAlive,
      carrierRecords: c?.records ?? 0,
      carrierLastTs: lastTs,
      // 载体观测没跑成 ⇒ null（⛔ 不填 []：空数组的含义是「存在的载体全读完了」，两者不同形）。
      carrierUnreadable: c ? c.unreadable : null,
      // 读不出时刻 ⇒ null（⛔ 不填 0 冒充"刚刚"，硬规则 6：缺值 = 未查，不是为假）。
      staleSecs: Number.isFinite(parsed) ? Math.round((now - parsed) / 1000) : null,
    });
  }
  return out;
}

/** author↔develop 同步的健康度（成功/失败各多少）。这条载体是该机制自己的产物，
 *  ⛔ 不靠"看起来在跑"判断——它每轮都调，失败也每轮都落痕。 */
export interface SyncHealth {
  window: number;
  ffSynced: number;
  notFf: number;
  /** not-ff 的 benign 分解（gap-meta-collectsynchealth）：benign=true = behind===0 的良性 ahead-only
   *  （author 刚提交任务状态、无物可拉），benign=false = behind>0 的真分叉。⛔ 只数 notFf 总数会把
   *  「良性领先」与「真分叉」混为一谈——两者处置完全不同（前者等下一轮 ff 即可，后者要升级语义兜底）。
   *  旧事件（无 benign 字段）不进任一桶，只进 notFf 总数（⛔ 不猜——硬规则 6：缺值 = 未查，不是为假）。 */
  notFfBenign: number;
  notFfBehind: number;
  ffError: number;
  /** 语义兜底进入次数（begin）。⛔ 必须与终结态分开数——只数终结态会让「进入了但没结束」隐身。 */
  semanticBegin: number;
  semanticResolved: number;
  /** ⚠️ 2026-09-06 补：此前【漏数】这一态，而它正是占主导的失败形态（实测 26 次进入中 21 次
   *  停在这里）⇒ 读数对主要失败态全盲。由 meta-driver 自己在一轮里读码发现并指出——
   *  「conflict 不进 syncHealth 聚合面，读数本身盲于此失败态」。 */
  semanticConflict: number;
  semanticAlignFailed: number;
  semanticFfFailed: number;
  /** ⚠️ 2026-09-11 补（gap-develop-sync-reset-hard-destroys-third-party-project-tree）：终局解
   *  `takeDevelopDiscardingDoc` 新增了一个**终止态——拒绝**（被丢弃的提交不可弃 ⇒ 不 reset）。
   *  ⛔ 不数它就会重犯本接口上方 :739-741 已记过一次的错（「读数对主要失败态全盲」）：拒绝发生在
   *  `…-take-develop-refused` 事件上，而它后面还跟着一条双向同步汇总事件 ⇒ `lastEvent` 也读不到，
   *  于是新状态在聚合读数里**既不入桶也不当最后事件** ⇒ 与「一切正常」同形（硬规则 3b）。 */
  semanticTakeDevelopRefused: number;
  /** ⚠️ 2026-11-06 补（gap-meta-synchealth-doc-to-develop-outcome-invisible）：doc→develop 的
   *  **最近结局**，三态（⛔ 不用布尔——布尔的 false 会把「拒绝」与「读不懂」压成同一个值，硬规则 3b/6）：
   *    - `"ok"`      — 窗口内最后一条 `doc-develop-sync-bidirectional` 的 `docToDevelop` 为真；
   *    - `"refused"` — 该值为假 ⇒ doc→develop 被拒/失败（**阻塞中**，成因在共享检出的脏工作树，
   *                    属人的领地）；此前它只在 `doc-develop-sync-bidirectional` 事件的字段里，而
   *                    `lastEvent` 只取事件名 ⇒ 「阻塞中」与「健康」在聚合读数里同形 ⇒ 摘要不变 ⇒
   *                    语义半永不被唤醒（2026-10-31 那次 30+ 分钟冻结全程静默就是这么来的）；
   *    - `"unknown"` — 窗口内无该事件 / 值非布尔 / 其后有坏行 / 载体读不出 ⇒ **未评估**，⛔ 不与
   *                    `"ok"` 同形（硬规则 6：缺值 = 未查，不是为假）。 */
  lastDocToDevelop: "ok" | "refused" | "unknown";
  lastEvent: string | null;
  lastTs: string | null;
}

export function collectSyncHealth(root: string, window = 200): SyncHealth {
  const file = path.join(root, ".quay", "doc-develop-sync.jsonl");
  const h: SyncHealth = {
    window, ffSynced: 0, notFf: 0, notFfBenign: 0, notFfBehind: 0, ffError: 0,
    semanticBegin: 0, semanticResolved: 0, semanticConflict: 0, semanticAlignFailed: 0, semanticFfFailed: 0,
    semanticTakeDevelopRefused: 0,
    // 缺省即「未评估」：载体不存在 / 读不出 / 窗口内无该事件时都落在这里（⛔ 不填 "ok"——
    // 把「没读到」当成「同步健康」正是本任务要消灭的那种同形，硬规则 3b）。
    lastDocToDevelop: "unknown",
    lastEvent: null, lastTs: null,
  };
  let lines: string[];
  try { lines = fs.readFileSync(file, "utf8").trim().split("\n"); } catch { return h; }
  for (const line of lines.slice(-window)) {
    let r: Record<string, unknown>;
    try { r = JSON.parse(line); } catch {
      // 坏行 ⇒ 该位置之后的「最后结局」不可知（它可能就是被吞掉的那条 bidirectional 事件）。
      // 按位置否定上次判定：坏行【在】最后一条 bidirectional 之前 ⇒ 后面的好事件会再覆盖回来。
      h.lastDocToDevelop = "unknown";
      continue;
    }
    const e = String(r.event ?? "");
    if (e === "doc-develop-sync-ff-synced") h.ffSynced++;
    else if (e === "doc-develop-sync-not-ff") {
      h.notFf++;
      // benign 分解（gap-meta-collectsynchealth）：写侧已在 not-ff 事件上落 ahead/behind/benign: behind===0
      // 三键。读侧只取 benign（behind===0 的派生量）——benign:true = 良性 ahead-only，benign:false = 真分叉。
      // 旧事件（benign 字段不存在）不进任一桶，只进 notFf 总数（⛔ 不猜，硬规则 6）。
      if (r.benign === true) h.notFfBenign++;
      else if (r.benign === false) h.notFfBehind++;
    }
    else if (e === "doc-develop-sync-ff-error") h.ffError++;
    else if (e === "doc-develop-sync-semantic") h.semanticBegin++;
    else if (e === "doc-develop-sync-semantic-resolved") h.semanticResolved++;
    else if (e === "doc-develop-sync-semantic-conflict") h.semanticConflict++;
    else if (e === "doc-develop-sync-semantic-align-failed") h.semanticAlignFailed++;
    else if (e === "doc-develop-sync-semantic-ff-failed") h.semanticFfFailed++;
    else if (e === "doc-develop-sync-semantic-take-develop-refused") h.semanticTakeDevelopRefused++;
    else if (e === "doc-develop-sync-bidirectional") {
      // doc→develop 的三态派生：写侧落 `String(docToDevelop)`（"true"/"false"），旧/手工事件可能是
      // 原生布尔 ⇒ 两种形态都认；**其余任何值（缺键/数字/其它串）一律 "unknown"**，⛔ 不猜。
      const v = r.docToDevelop;
      h.lastDocToDevelop = v === true || v === "true" ? "ok"
        : v === false || v === "false" ? "refused"
        : "unknown";
    }
    if (e) { h.lastEvent = e; h.lastTs = typeof r.ts === "string" ? r.ts : null; }
  }
  return h;
}

// gap-not-evaluated-checkers-never-persisted — 惰性守卫采集：从本轮 full-suite-state.json 提取
// `notEvaluatedCheckers`（checker-cost-lib exit 3 = NOT-EVALUATED，非红非绿）逐条枚举名字。⛔ 不是
// 计数——SPEC §5.3「原始工具输出的裸标量不得单独 gate 流水线；不枚举环/不给文件/不给修法，零指引
// 价值」。取不到（state 缺失/还在 running/字段不存在）⇒ 空数组（⛔ 不是 undefined——「本轮没有未评估
// 项」与「本轮没记录这个维度」必须可区分，硬规则 3b，与 full-suite-runner 侧 AC2 同形）。
export function collectInertCheckers(root: string): string[] {
  const file = path.join(root, ".quay", "full-suite-state.json");
  let j: unknown;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; }
  const arr = (j as { notEvaluatedCheckers?: unknown })?.notEvaluatedCheckers;
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const c of arr) {
    if (c && typeof (c as { name?: unknown }).name === "string" && ((c as { name: string }).name)) {
      out.push((c as { name: string }).name);
    }
  }
  return out;
}

// ── 停放读数（gap-meta-scanparkingboard）─────────────────────────────────────────────────────────
// 问题：promotion-driver 每轮把 `scanParkingBoard` 的结果落进 `.quay/needs-human-parking-recheck.json`，
// 而 collectReadings 从不读它 ⇒ 两臂都只有生产者、没有消费者。后果不是「少一个数字」：body-PARKED
// 的任务被派发池排除（`isParked`）、永不翻 done，而 judgeDeps 把任何非 done 非 superseded 的依赖都算
// 活跃阻塞 ⇒ 它后面的 todo 被无限期饿死（GOAL-914：gap-goal-driver-filing-ledger 的宣告式检查
// 已经打印 `landed`，而 gap-goal-filing-chain-audit 仍每轮 pending）。
// 修法 = **接消费者**：读同一个载体、用同一个探测器做回退，⛔ 不新建并行机制（DoD 第 2 条）。
// 本层只读数：删 PARKED 标记 / 翻 done / 重入队都仍是人（manager）的动作。

/** 两臂共用的读数骨架。三态纪律：`evaluated:true` ⇒ `counts` 是四态计数；`evaluated:false` ⇒
 *  `reason` 非空且 `counts` 为 **null**。⛔ 不填 0 —— 0 是「查过、一个都没有」这个**判定**，与
 *  「没查成」不同形（硬规则 3b/6；生产方在未评估时落的是全 0，本层必须把它翻成 null 才不会
 *  在消费端把「没查成」读成「全部仍阻塞/全部已解停」）。 */
export interface ParkingArmBase {
  evaluated: boolean;
  reason: string | null;
  /** 本轮读数从哪来：`carrier` = 生产载体（promotion-driver 每轮落盘）；`live-scan` = 载体不可用时
   *  现跑同一个 `scanParkingBoard`；`null` = 两路都没成（未评估）。⛔ 三者不合并成一个 token。 */
  source: "carrier" | "live-scan" | null;
  /** 载体没被采用的原因（`source:"live-scan"` 时说明为什么回退；`source:"carrier"` 时为 null）。 */
  carrierProblem: string | null;
  /** 读数的采集时刻与其年龄（ms）。读不出日期 ⇒ 两个字段都 null（⛔ 不填 0 冒充「刚刚」）。 */
  at: string | null;
  ageMs: number | null;
}

/** body-PARKED 人群（ARM 2）。`entries` 是探测器**报出来**的那些（宣告式 unpark 检查已通过而任务
 *  仍 PARKED）——也就是唯一需要人处置的清单；其余任务在 `counts` 里按四态分桶。 */
export interface ParkedUnparkArm extends ParkingArmBase {
  counts: Record<ParkedUnparkState, number> | null;
  parkedTotal: number | null;
  reportedPassed: number | null;
  entries: ParkedUnparkEntry[] | null;
}

/** needs-human 人群（ARM 1，同一个载体的另一半）。两臂一起消费：只接一臂就是把「读数没人读」这个
 *  缺陷的兄弟实例留在原地（硬规则 5b）。 */
export interface NeedsHumanParkingArm extends ParkingArmBase {
  counts: Record<ParkingState, number> | null;
  needsHumanTotal: number | null;
  reportedStale: number | null;
  stale: ParkingRecheck[] | null;
}

export interface ParkingRoundReading {
  parked: ParkedUnparkArm;
  needsHuman: NeedsHumanParkingArm;
}

const PARKED_COUNT_KEYS = ["unpark-passed", "unpark-still-blocked", "no-unpark-check", "not-evaluated"] as const;
const NEEDS_HUMAN_COUNT_KEYS = ["parking-reason-stale", "still-blocked", "no-registered-judge", "not-evaluated"] as const;
const PARKED_STATES: readonly ParkedUnparkState[] = PARKED_COUNT_KEYS;
const NEEDS_HUMAN_STATES: readonly ParkingState[] = NEEDS_HUMAN_COUNT_KEYS;

/** 四态计数。缺键或非数值 ⇒ **null**（整臂未评估），⛔ 不逐键补 0：补出来的 0 会让
 *  「四态里少了一态」伪装成「那一态是零条」（硬规则 6：缺值 = 未查，不是为假）。 */
function readFourStateCounts<K extends string>(raw: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const v = src[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

/** 取值域必须落在枚举里——读到不认识的 state 说明载体不是本层理解的形状，整臂判未评估
 *  （⛔ 不把未知态归到 `not-evaluated`：那是给「跑过但读不出结果」用的，与「载体读不懂」不同源）。 */
function readEnumState<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 载体里一条 body-PARKED 条目 → 本层形状。缺 `id` 或缺可识别的 `state` ⇒ null（该臂整臂不可信）。 */
function readParkedEntry(raw: unknown): ParkedUnparkEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const state = readEnumState(r.state, PARKED_STATES);
  if (id === "" || state === null) return null;
  return {
    id,
    status: strOrNull(r.status),
    state,
    command: strOrNull(r.command),
    expectedOutput: strOrNull(r.expectedOutput),
    exitCode: numOrNull(r.exitCode),
    output: strOrNull(r.output),
    note: strOrNull(r.note),
  };
}

/** 载体里一条 needs-human 条目 → 本层形状。`currentHits` 逐条保留（判定要能被人复查，⛔ 只留计数）。 */
function readNeedsHumanEntry(raw: unknown): ParkingRecheck | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const state = readEnumState(r.state, NEEDS_HUMAN_STATES);
  if (id === "" || state === null) return null;
  const hits = Array.isArray(r.currentHits) ? r.currentHits.filter((h): h is string => typeof h === "string") : [];
  return { id, state, judge: strOrNull(r.judge), recordedReason: strOrNull(r.recordedReason), currentHits: hits, note: strOrNull(r.note) };
}

/** `at` → 时刻与年龄。读不出 ⇒ 两者都 null。 */
function readArmTime(at: unknown, nowMs: number): { at: string | null; ageMs: number | null } {
  const s = typeof at === "string" ? at : null;
  const parsed = s === null ? NaN : Date.parse(s);
  // 未来时刻（时钟回拨/手改载体）⇒ ageMs 取 0 而不是负数——负数会读成「比现在更新」。
  return { at: s, ageMs: Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null };
}

/** 同一工作区？两次 realpath 都成功才比 realpath（worktree 常经 symlink），否则退回 path.resolve。
 *  载体描述的是**另一个**工作区时不能采用：那是「读数在，但不是这一轮的这块板」（硬规则 5）。 */
function sameWorkspace(carrierRoot: string, root: string): boolean {
  const norm = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return norm(carrierRoot) === norm(root);
}

function unevaluatedArm(reason: string, carrierProblem: string | null): ParkingArmBase {
  return { evaluated: false, reason, source: null, carrierProblem, at: null, ageMs: null };
}

/** 生产载体 → 两臂。`ok:false` 时 `problem` 指名是哪一环读不懂（⛔ 不返回「空读数」——空读数与
 *  「一条都没有」同形，硬规则 3b）。载体的 `evaluated:false` **是**一个有效读数（生产方自己没评估成），
 *  照样消费，只是把它的全 0 计数翻成 null 并带上它自己的 reason。 */
function parkingFromCarrier(root: string, nowMs: number):
  | { ok: true; reading: ParkingRoundReading }
  | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, PARKING_READING_REL), "utf8"));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    return {
      ok: false,
      problem: code === "ENOENT"
        ? `no carrier at ${PARKING_READING_REL}`
        : `carrier unreadable (${(e as Error).message})`,
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problem: "carrier is not a JSON object" };
  const o = raw as Record<string, unknown>;
  const carrierRoot = typeof o.root === "string" ? o.root : "";
  if (carrierRoot === "") return { ok: false, problem: "carrier carries no root" };
  if (!sameWorkspace(carrierRoot, root)) return { ok: false, problem: `carrier describes a different workspace (${carrierRoot})` };

  // ── ARM 2（parked）：本任务的判据点名的就是它 ──
  const p = o.parked;
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, problem: "carrier has no parked arm" };
  const pw = p as Record<string, unknown>;
  if (typeof pw.evaluated !== "boolean") return { ok: false, problem: "carrier parked arm has no boolean evaluated" };
  const time = readArmTime(pw.at, nowMs);
  let parked: ParkedUnparkArm;
  if (pw.evaluated === true) {
    const counts = readFourStateCounts(pw.counts, PARKED_COUNT_KEYS);
    if (counts === null) return { ok: false, problem: "carrier parked arm lacks the four-state counts" };
    if (!Array.isArray(pw.entries) || !Array.isArray(pw.tasks)) return { ok: false, problem: "carrier parked arm lacks entries/tasks arrays" };
    const entries: ParkedUnparkEntry[] = [];
    for (const e of pw.entries) { const one = readParkedEntry(e); if (one === null) return { ok: false, problem: "carrier parked arm has an unreadable entry" }; entries.push(one); }
    for (const e of pw.tasks) { if (readParkedEntry(e) === null) return { ok: false, problem: "carrier parked arm has an unreadable task entry" }; }
    // 计数必须与上报清单自洽：`reported_passed` 与 entries 长度不一致 ⇒ 载体不是这一版写出来的。
    const reported = numOrNull(pw.reported_passed);
    if (reported !== null && reported !== entries.length) {
      return { ok: false, problem: `carrier parked arm is self-inconsistent (reported_passed=${reported} but entries=${entries.length})` };
    }
    parked = {
      evaluated: true, reason: null, source: "carrier", carrierProblem: null, ...time,
      counts, parkedTotal: numOrNull(pw.parked_total), reportedPassed: reported, entries,
    };
  } else {
    parked = {
      evaluated: false, reason: strOrNull(pw.reason) ?? "carrier parked arm is not evaluated", source: "carrier", carrierProblem: null,
      ...time, counts: null, parkedTotal: null, reportedPassed: null, entries: null,
    };
  }

  // ── ARM 1（needs-human）：同一个载体的另一半，字段在顶层 ──
  if (typeof o.evaluated !== "boolean") return { ok: false, problem: "carrier has no boolean top-level evaluated (needs-human arm)" };
  const nhTime = readArmTime(o.at, nowMs);
  let needsHuman: NeedsHumanParkingArm;
  if (o.evaluated === true) {
    const counts = readFourStateCounts(o.counts, NEEDS_HUMAN_COUNT_KEYS);
    if (counts === null) return { ok: false, problem: "carrier needs-human arm lacks the four-state counts" };
    if (!Array.isArray(o.stale) || !Array.isArray(o.tasks)) return { ok: false, problem: "carrier needs-human arm lacks stale/tasks arrays" };
    const stale: ParkingRecheck[] = [];
    for (const e of o.stale) { const one = readNeedsHumanEntry(e); if (one === null) return { ok: false, problem: "carrier needs-human arm has an unreadable stale entry" }; stale.push(one); }
    for (const e of o.tasks) { if (readNeedsHumanEntry(e) === null) return { ok: false, problem: "carrier needs-human arm has an unreadable task entry" }; }
    const reported = numOrNull(o.reported_stale);
    if (reported !== null && reported !== stale.length) {
      return { ok: false, problem: `carrier needs-human arm is self-inconsistent (reported_stale=${reported} but stale=${stale.length})` };
    }
    needsHuman = {
      evaluated: true, reason: null, source: "carrier", carrierProblem: null, ...nhTime,
      counts, needsHumanTotal: numOrNull(o.needs_human_total), reportedStale: reported, stale,
    };
  } else {
    needsHuman = {
      evaluated: false, reason: strOrNull(o.reason) ?? "carrier needs-human arm is not evaluated", source: "carrier", carrierProblem: null,
      ...nhTime, counts: null, needsHumanTotal: null, reportedStale: null, stale: null,
    };
  }
  return { ok: true, reading: { parked, needsHuman } };
}

/** 载体不可用时的回退：现跑**同一个** `scanParkingBoard`（⛔ 不写第二套判据）。回退不是静默的——
 *  `source:"live-scan"` + `carrierProblem` 把「生产载体这条链断了」留在读数里。 */
function parkingFromLiveScan(root: string, nowMs: number, carrierProblem: string): ParkingRoundReading {
  const scan = scanParkingBoard(root, { now: new Date(nowMs) });
  const pTime = readArmTime(scan.parked.at, nowMs);
  const nTime = readArmTime(scan.at, nowMs);
  return {
    parked: {
      evaluated: scan.parked.evaluated === true,
      reason: scan.parked.evaluated === true ? null : (scan.parked.reason ?? "live scan did not evaluate"),
      source: "live-scan", carrierProblem, ...pTime,
      counts: scan.parked.evaluated === true ? scan.parked.counts : null,
      parkedTotal: scan.parked.evaluated === true ? scan.parked.parked_total : null,
      reportedPassed: scan.parked.evaluated === true ? scan.parked.reported_passed : null,
      entries: scan.parked.evaluated === true ? scan.parked.entries : null,
    },
    needsHuman: {
      evaluated: scan.evaluated === true,
      reason: scan.evaluated === true ? null : (scan.reason ?? "live scan did not evaluate"),
      source: "live-scan", carrierProblem, ...nTime,
      counts: scan.evaluated === true ? scan.counts : null,
      needsHumanTotal: scan.evaluated === true ? scan.needs_human_total : null,
      reportedStale: scan.evaluated === true ? scan.reported_stale : null,
      stale: scan.evaluated === true ? scan.stale : null,
    },
  };
}

/** 采停放读数：**先读生产载体**（`carrier`），读不成才现跑探测器（`live-scan`），两路都不成才
 *  `evaluated:false` + `reason`。`allowScan:false` 用于「只要载体、⛔ 别 spawn 子进程」的调用方。
 *  ⚠️ 回退会 spawn 宣告式 unpark 命令（每个有上限的读取，见 DEFAULT_UNPARK_TIMEOUT_MS）。 */
export function collectParkingReadings(
  root: string,
  opts: { now?: number; allowScan?: boolean } = {},
): ParkingRoundReading {
  const nowMs = opts.now ?? Date.now();
  const fromCarrier = parkingFromCarrier(root, nowMs);
  if (fromCarrier.ok) return fromCarrier.reading;
  if (opts.allowScan !== false) {
    try {
      return parkingFromLiveScan(root, nowMs, fromCarrier.problem);
    } catch (e) {
      const reason = `${fromCarrier.problem}; live scan failed (${(e as Error).message})`;
      return {
        parked: { ...unevaluatedArm(reason, fromCarrier.problem), counts: null, parkedTotal: null, reportedPassed: null, entries: null },
        needsHuman: { ...unevaluatedArm(reason, fromCarrier.problem), counts: null, needsHumanTotal: null, reportedStale: null, stale: null },
      };
    }
  }
  return {
    parked: { ...unevaluatedArm(fromCarrier.problem, fromCarrier.problem), counts: null, parkedTotal: null, reportedPassed: null, entries: null },
    needsHuman: { ...unevaluatedArm(fromCarrier.problem, fromCarrier.problem), counts: null, needsHumanTotal: null, reportedStale: null, stale: null },
  };
}

/** 停放读数对摘要的贡献（gap-meta-scanparkingboard）：只取**会改变判读结论**的位——两臂各
 *  ①未评估 ②「被点名要人处置」的 id 清单。⛔ 计数与年龄一律不进（四态里 `no-unpark-check`
 *  随任务增删而变、`unpark-still-blocked` 是常态，进摘要会让语义半每轮被唤醒——同 staleSecs 的纪律）。
 *  未评估与「一条都没有」用**不同 token**（`parked:u` vs `parked:none`，硬规则 3b）。 */
export function readingsDigestPartsForParking(p: ParkingRoundReading | null | undefined): string[] {
  const parts: string[] = [];
  if (!p || typeof p !== "object") return ["parked:u", "nhparking:u"];
  const ids = (list: Array<{ id?: unknown }> | null | undefined): string[] =>
    [...new Set((Array.isArray(list) ? list : []).map((e) => String(e?.id ?? "").trim()).filter((s) => s !== ""))].sort();
  const parked = p.parked;
  if (!parked || typeof parked !== "object" || parked.evaluated !== true || !parked.counts) parts.push("parked:u");
  else {
    const list = ids(parked.entries);
    parts.push(...(list.length > 0 ? list.map((id) => `parked-passed:${id}`) : ["parked:none"]));
  }
  const nh = p.needsHuman;
  if (!nh || typeof nh !== "object" || nh.evaluated !== true || !nh.counts) parts.push("nhparking:u");
  else {
    const list = ids(nh.stale);
    parts.push(...(list.length > 0 ? list.map((id) => `nh-stale:${id}`) : ["nhparking:none"]));
  }
  return parts;
}

// ── 读数声明覆盖（gap-meta-readingsdigestpartsforparking）───────────────────────────────────────
// 缺陷：`plugin/probes/meta-driver.md` 只声明了 readings 的**一部分**顶层键。`timeSeries` /
// `inertCheckers` / `actionRecordFailures` / `parking` 四个键每轮随 readings 一并送到语义半，
// 却既无释义也无处置口径 ⇒ 读到了、但没有任何动作由它触发（「有输入无输出」，兄弟实例
// `gap-meta-addressedtasks-input-without-output-channel`）。同类缺陷发生过一次、兄弟实例原样留在
// 同一文件里，正是硬规则 5b 的形态。
//
// 判据必须能取假且不能靠手写清单：**键清单从接口声明本身按位置取**（⛔ 不在测试或此处写死一份
// 键名数组——那份清单会在下一次给 readings 加键时静默过期，而「静默过期」正是本缺陷的形态）。
// ⛔ 不按关键词扫全文：`L_D`-式的关键词判定会把散文里的提及当成声明（硬规则 2）；这里认的是
// 接口块内两格缩进的成员行。

/** readings 顶层键的接口名（键清单的唯一来源）。 */
export const META_ROUND_READINGS_INTERFACE = "MetaRoundReadings";

/** 从 `export interface MetaRoundReadings { … }` 的**接口体**按位置取出顶层键。
 *  嵌套成员都写在行内的 `Array<{ … }>` 里，因此「两格缩进的 `key:` 行」恰好只命中顶层键。
 *  读不出接口块 / 块内零键 ⇒ **null**（硬规则 3b：读不懂不得与「没有缺声明」同形——`[]` 是
 *  「查过、全声明了」这个**判定**，两者不可共用取值）。 */
export function readingsTopLevelKeys(sourceText: string): string[] | null {
  const text = typeof sourceText === "string" ? sourceText : "";
  const open = text.indexOf(`export interface ${META_ROUND_READINGS_INTERFACE} {`);
  if (open < 0) return null;
  const bodyStart = text.indexOf("\n", open);
  if (bodyStart < 0) return null;
  const rest = text.slice(bodyStart + 1);
  const end = rest.search(/^}$/m); // 接口体的闭合花括号在行首
  if (end < 0) return null;
  const keys: string[] = [];
  for (const m of rest.slice(0, end).matchAll(/^ {2}([A-Za-z_$][\w$]*)\??:/gm)) keys.push(m[1]);
  return keys.length === 0 ? null : keys;
}

/** 未在 probe 规格里具名的 readings 顶层键（排序、去重）。
 *  `keys` 为 null/空、或 `probeText` 为空 ⇒ **null**（未评估：连键清单或规格都读不出，就无法对
 *  「覆盖是否完整」出结论；⛔ 不与 `[]` =「查过、一个都不缺」同形）。 */
export function undeclaredReadingsKeys(
  keys: readonly string[] | null | undefined,
  probeText: string,
): string[] | null {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  if (typeof probeText !== "string" || probeText.trim() === "") return null;
  return [...new Set(keys)].filter((k) => !probeText.includes(k)).sort();
}

/** 规格里某个读数键的**声明块**：从行首的 `- \`<key>\`` 项目符号起，到下一个同级项目符号
 *  （行首 `- `）为止，去掉行尾空行。找不到 ⇒ null。
 *  ⛔ 不用 `includes` 判「具名」：`focus` 会命中 `--focus`、任何键都会命中散文里的提及。
 *  「被声明」= 它有一个属于自己的项目符号块，块里才有释义与处置口径。 */
export function probeKeyBlock(probeText: string, key: string): string | null {
  if (typeof probeText !== "string" || typeof key !== "string" || key === "") return null;
  const lines = probeText.split("\n");
  const head = `- \`${key}\``;
  const start = lines.findIndex((l) => l.startsWith(head));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("- ")) { end = i; break; }
  }
  const block = lines.slice(start, end).join("\n").replace(/\s+$/, "");
  return block === "" ? null : block;
}

/** 一个声明块的**非空白字符数**——释义/处置口径的密度下限用（⛔ 不是「词出现过」的代理量：
 *  一个只写了键名的项目符号在这里得 0 附近的值，恰好该被判不合格）。 */
export function declarationDensity(block: string | null): number {
  return typeof block === "string" ? block.replace(/\s+/g, "").length : 0;
}

// ── 变化检测（语义半的触发闸）────────────────────────────────────────────────────────────────────

/** 语义半的触发状态（gitignored 运行时状态，与轮载体分开——它是【状态】不是【记录】）。 */
export const STATE_REL = path.join(".quay", "meta-driver-state.json");

/** 第七类读数对摘要的贡献：三态各一个**独立 token**，越阈项按签名逐条进（排序保证确定性）。
 *  ⛔ 计数与时间一律不进。`crossed` 与非 crossed 项的区别正是「会改变判读结论」的那个位。 */
export function readingsDigestPartsForActionFailures(r: ActionFailureReading): string[] {
  // 结构性缺失（字段不在）⇒ 与「未评估」同 token。⛔ 绝不落到 "none"——把「没读到这一维」
  // 当成「查过、无越阈项」正是硬规则 3b 禁的那种伪装（合格侧的伪装）。
  if (!r || typeof r !== "object") return ["actfail-state:u"];
  if (r.state === "not-evaluated") return ["actfail-state:u"];
  if (r.state === "unthresholded") return ["actfail-state:unt"];
  if (r.state === "none") return ["actfail-state:none"];
  const crossed = (r.aggregates ?? []).filter((a) => a.crossed).map((a) => a.signature).sort();
  // 构造上 crossed 非空（state==="crossed" 的定义）；仍加一个兜底 token，⛔ 不让「空数组」
  // 与 "none" 同形（硬规则 3b：读不懂/构造意外不得伪装成合格）。
  return crossed.length > 0 ? crossed.map((s) => `actfail-x:${s}`) : ["actfail-state:crossed-empty"];
}

/** 读数的稳定摘要：只含【会改变判读结论】的量（每条 AC 的 verdict/status + 偏离类别），
 *  ⛔ 不含时间戳/reason 文本（那些每轮都变，会让摘要恒不相等 ⇒ 变化检测恒为真 ⇒ 闸失效）。 */
export function readingsDigest(readings: MetaRoundReadings): string {
  const parts = [
    // `cause` is included: WHICH not-evaluated it is (spawn/usage/timeout/capability/…) changes the
    // disposition (raise the deadline vs repair the invocation vs declare the capability), and it is
    // stable per round — so it belongs in the "did the conclusion change" digest. `-` for a
    // definitive verdict / an unnamed cause.
    ...readings.criteria.map((c) => `${c.id}:${c.status}:${c.verdict}:${c.cause ?? "-"}`).sort(),
    // 偏离带处理者三态（handler.state）进摘要——三态变了结论就变（如 goal-driver 由跑变停）。
    // ⛔ 不取 handler 的秒数（staleSecs）与 repeatCount/lastRecommendation：那些每轮都变。
    ...readings.divergences.map((d) => `${d.id}:${d.kind}:${d.handler?.state ?? "no-handler"}`).sort(),
    // driver 只取【在跑与否】这个会改变结论的位；⛔ 不取 staleSecs/记录数——它们每轮都变，
    // 取了会让摘要恒不相等、变化检测闸失效（同 reason 文本的道理）。running=null（读不出）
    // 单独一个 token "u"，⛔ 不与 false（停摆）同形（硬规则 3b）。
    // `carrierUnreadable` 同理进摘要（它不每轮变）：载体从「读得出」变「读不出」时，结论必须被重判——
    // 只报 carrierRecords 的话这个变化在摘要里不可见（gap-meta-collectdriverreadings）。
    // 三态各自独立：null（观测没跑成）⇒ "u"；[]（全读完）⇒ "none"；否则逐名。
    ...readings.drivers.map((d) => {
      const run = d.running === null ? "u" : d.running ? 1 : 0;
      const unread = !Array.isArray(d.carrierUnreadable) ? "u" : d.carrierUnreadable.join(",") || "none";
      return `drv:${d.kind}:${run}:${unread}`;
    }).sort(),
    // 同步只取【最近是否在失败】这个位，⛔ 不取计数。
    // gap-meta-synchealth-doc-to-develop-outcome-invisible：仅取 lastEvent 时，「doc→develop 被拒」
    // 与「健康」同形（拒绝态藏在 bidirectional 事件的字段里）⇒ 摘要不变 ⇒ 语义半永不被唤醒。
    // 补三态 `lastDocToDevelop`（ok/refused/unknown）：阻塞**开始**与**结束**时摘要各变一次、阻塞
    // 持续期间不变 ⇒ 语义半至多各判读一次，天然消抖。⛔ 不引入计数/时间阈值（硬规则 4 推论一：
    // 成本结构未实测前不设阈值）。字段结构性缺失 ⇒ "unknown"（不与 "ok" 同形，硬规则 3b）。
    `sync:${readings.syncHealth.lastEvent ?? "none"}:${readings.syncHealth.lastDocToDevelop ?? "unknown"}`,
    // 寄给它的消息：id + status 都进摘要。**必须进**——否则人新发一条 META 记录不会改变摘要，
    // 变化检测闸会把那一轮判为"读数没变"而跳过语义半 ⇒ 这个入口在定时轮里等于不存在。
    ...readings.metaRecords.map((m) => `meta:${m.id}:${m.status}`).sort(),
    // gap-not-evaluated-checkers-never-persisted — 惰性守卫的名字必须进摘要（⛔ 只进计数会让新出现的
    // 惰性守卫不改变摘要 ⇒ 语义半永不被唤醒；逐名进，某个 guard 从在→不在/不在→在都改变摘要）。
    ...readings.inertCheckers.map((n) => `inert:${n}`).sort(),
    // 时序派生信号：只进「是否越阈」的位（⛔ 不进 count——count 每轮 +1，进了摘要恒变、闸失效；
    //  同 drivers 只取 running 位、divergences 不取 repeatCount 的纪律）。evaluated=false 单列 token
    //  "u"（⛔ 不与 crossed=false 同形，硬规则 3b）。⛔ `skippedAbortedRounds` 与 `value` 同理不进：
    //  每出现一个中止轮前者就 +1（进了摘要恒变），后者只在 streak 变时变、而那一刻 crossed/count 已变。
    ...readings.timeSeries.map((s) => `sig:${s.key}:${s.evaluated ? (s.crossed ? 1 : 0) : "u"}`).sort(),
    // 人工转向（覆盖段内容）：人编辑才变，进摘要 ⇒ 变了判读一次、不变不判读（「变了」而非「非空」）。
    // ⛔ 它恰是【人编辑才变】的量（与 staleSecs/记录数相反——那些每轮都变，进摘要会让变化检测恒为真）。
    `focus:${readings.focus ?? "none"}`,
    // 第七类读数（动作记录失败聚合）：⛔ **只有越阈项的签名**与三态 token 进摘要。原始计数
    // （sessions/count/recordsScanned/scannedAt）⛔ 一律不进——那些每轮都可能变，进了会让摘要
    // 恒不相等、变化检测闸失效（硬规则 4 推论一；同 staleSecs/repeatCount 的纪律）。
    // 三态 token 用独立前缀（`actfail-state:` / `actfail-x:`），⛔ 不让一个签名的字面值
    // 与状态 token 撞形（硬规则 8：编号/命名不得复用——缺席被伪装成在场）。
    ...readingsDigestPartsForActionFailures(readings.actionRecordFailures),
    // 停放读数（gap-meta-scanparkingboard）：⛔ 只取「哪几条被点名要人处置」与两臂的未评估位。
    // **必须进**：不进的话「解停条件已成立」这件事不改变摘要 ⇒ 语义半不被唤醒 ⇒ 本任务只是把数字
    // 塞进 JSON，读数仍然到不了能处置它的层（这正是缺陷本身）。计数/年龄不进（见该函数注释）。
    ...readingsDigestPartsForParking(readings.parking),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export interface MetaState { digest: string | null; lastJudgedAt: string | null }

export function readState(root: string): MetaState {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), "utf8"));
    return { digest: typeof j.digest === "string" ? j.digest : null, lastJudgedAt: typeof j.lastJudgedAt === "string" ? j.lastJudgedAt : null };
  } catch {
    // 读不到 ⇒ never-judged（⛔ 不当作"没变化"——那会让首轮静默跳过语义半）。
    return { digest: null, lastJudgedAt: null };
  }
}

export function writeState(root: string, s: MetaState): void {
  try {
    // 原子写（委托 kernel 唯一实现）：本处曾是裸 `fs.writeFileSync` ⇒ 并发读者可看到半写/零长度的
    // `.quay/meta-driver-state.json`，解析失败退化为 never-judged ⇒ **多判一次**（成本事故，且与
    // 「读到旧值」同形，硬规则 3b）。字段集与语义逐字未动，只换写入方式。
    writeJsonAtomic(path.join(root, STATE_REL), s);
  } catch { /* 状态写失败不致命；下一轮退化为 never-judged ⇒ 多判一次，不会漏判 */ }
}

/** 语义半是否该跑。**事件触发 + 定时器地板**（08-23 SPEC §5 已裁定的模型的机械形态）：
 *  读数变了 ⇒ 跑；人给了 `--focus`（CLI，一次性）⇒ 跑；距上次判读超过地板 ⇒ 跑。
 *  ⛔ `args.focus` 是 **CLI `--focus`（一次性人工干跑）**，不是文件覆盖段——文件覆盖段已经进
 *  `digest`（readingsDigest），走「读数变了 ⇒ 跑」这一支：内容变了判读一次，不变不判读。
 *  若把文件覆盖段也塞进 `args.focus`，就会退化成「非空就每轮强制判读」——这正是本任务要消灭的
 *  成本事故（tasks/gap-meta-driver-no-steering-channel-focus-unreachable）。
 *  ⊢ 地板是**安全网不是调优参数**：它防的是「摘要因故恒不变 ⇒ 永不再判读」这一失效模式，
 *    故取一个粗值（缺省 24h）并显式可配，⛔ 不是按成本/收益调出来的阈值（硬规则 4 推论一）。 */
export function shouldJudge(
  args: { digest: string; state: MetaState; focus: string | null; now: number; floorMs: number },
): { judge: boolean; reason: string } {
  if (args.focus) return { judge: true, reason: "focus given by human" };
  if (args.state.digest === null) return { judge: true, reason: "never judged" };
  if (args.state.digest !== args.digest) return { judge: true, reason: "readings changed" };
  const last = args.state.lastJudgedAt ? Date.parse(args.state.lastJudgedAt) : NaN;
  if (!Number.isFinite(last)) return { judge: true, reason: "last-judged timestamp unreadable" };
  if (args.now - last >= args.floorMs) return { judge: true, reason: `floor reached (${Math.round((args.now - last) / 60000)}m since last judge)` };
  return { judge: false, reason: `unchanged since ${args.state.lastJudgedAt}` };
}

/** 语义半地板的缺省值（24h）——粗安全网，见 shouldJudge 的说明。 */
export const JUDGE_FLOOR_MS_DEFAULT = 24 * 60 * 60 * 1000;

// ── 自动驱动通道（把已被读数证实的机制缺陷推进既有任务流水线）────────────────────────────────────
// 人 2026-09-06 裁定：像「同步 69% 失败」「变化检测该不该上升为平台能力」这类问题应当【自动驱动】，
// 不必每次等人确认。自动驱动 = 立一条任务，交给既有的 promotion→worker→fan-in 流水线执行——
// ⛔ 不新建执行机制（那才是膨胀）。
//
// 三条与「提案」通道不同的、更严的机械前置（⛔ 通道选择不由 LLM 自评信心决定，硬规则 4）：
//  ① evidenceKey 必须在【本轮读数】里解析得出——杜绝凭空造证据；解析不出即拒。
//  ② mechanismKeyword 必须在既有任务里搜不到——搜到即拒并报出命中，因为「已有任务在管」与
//     「无人管」修法完全不同（memory dedup-tasks-by-mechanism-not-symptom 的机械化）。
//  ③ 每轮至多 1 条（比提案的 K=3 更严）——立案会被自动晋升并派发，代价比 draft 高得多。

export interface AutoDriveItem {
  title: string;
  problem: string;
  evidenceKey: string;
  mechanismKeyword: string;
  criterion: string;
  expect: string;
  /** 要改的文件（仓库相对路径，逗号分隔）。**必填**——Touches 是 anti-drift 的授权面，
   *  ⛔ 不能硬编码：实测 gap-meta-syncdeveloptodoc 因模板把 Touches 写死成 meta-driver.ts，
   *  而真正要修的是 driver-filters.ts ⇒ worker 结构上改不了对的文件 ⇒ 连撞 3 次重试上限进
   *  needs-human。立案时就把授权面写错，等于立了一条不可能完成的任务。 */
  touches: string;
}

/** 读数里【按业务键索引的数组】——点号路径不能索引数组下标，所以这些必须显式按键查。
 *
 *  ⚠️ 生产首轮（mt-prod-1788703469, 2026-09-06）实测：本表原先【只有 drivers】，
 *  于是同一轮里 autoDrive 引 `criteria.AC-180.verdict`、decision 引 `criteria.AC-143.status`
 *  ——两条都是【真实存在】的读数——却双双被判「解析不出」而拒绝，该轮 1 提 0 立 / 1 提 0 路由。
 *  ⇒ 机制最主要的证据类型（24 条 criteria vs 6 个 driver）在结构上无法被引用，
 *  两条最有价值的输出通道被自己的闸堵死。**这不是 probe 写错，是闸缺表。**
 *
 *  ⊢ 硬规则 5b（在某处修好 X ≠ X 只在那一处）：写这个函数时已经知道「数组要按键索引」并
 *  为 drivers 做了特例，却漏了同一个对象里的其余三个同形数组。补齐时逐个列出，不只补被报出来的那个。 */
export const ID_KEYED_READING_ARRAYS: Record<string, string> = {
  drivers: "kind",
  criteria: "id",
  divergences: "id",
  goals: "id",
  metaRecords: "id",
};

/** 按点号路径在本轮读数里解析证据。`<数组名>.<业务键>[.<字段>]` 按 ID_KEYED_READING_ARRAYS 查。
 *  解析不出 ⇒ undefined（调用侧据此拒绝——⛔ 不允许「引用了一个不存在的读数」的自动驱动）。 */
export function resolveEvidence(readings: MetaRoundReadings, key: string): unknown {
  const parts = String(key ?? "").split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  const idField = ID_KEYED_READING_ARRAYS[parts[0]];
  if (idField && parts.length >= 2) {
    const arr = (readings as unknown as Record<string, unknown>)[parts[0]];
    if (!Array.isArray(arr)) return undefined;
    const hit = (arr as Array<Record<string, unknown>>).find((x) => String(x?.[idField]) === parts[1]);
    if (!hit) return undefined;
    return parts.length === 2 ? hit : hit[parts[2]];
  }
  let cur: unknown = readings as unknown;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** 证据闸对一条 evidenceKey 的**三态**读数（硬规则 3/3b：三种结局三个取值，⛔ 不得同形）。
 *
 *  ⚠️ 缺陷原样（本任务 Proposal ②）：`driveItems`/`fileDecisions` 此前只拒 `undefined`，于是一个
 *  **值本身是 `null`** 的读数（含义「没读出来」，例如某个 driver 的 `running: null`）像证据一样
 *  过了闸。`undefined`（路径解析不出）与 `null`（解析得出、但该读数「无法读取」）是**两件事**，
 *  同用一个返回值就把「读不懂」伪装成了「有证据」（硬规则 3b）。
 *
 *  ⛔ `0` / `false` / `""` 是**合法读数**，照样准入——本函数只把 `null` 单列，⛔ 不波及它们。 */
export type EvidenceGateReading =
  | { state: "admitted"; value: unknown }
  | { state: "missing"; reason: string }
  | { state: "unreadable"; reason: string };

export function readEvidenceForGate(readings: MetaRoundReadings, key: string): EvidenceGateReading {
  const v = resolveEvidence(readings, key);
  if (v === undefined) {
    return { state: "missing", reason: `evidenceKey ${JSON.stringify(key)} 在本轮读数里解析不出 ⇒ 拒（⛔ 不接受凭空证据）` };
  }
  if (v === null) {
    return { state: "unreadable", reason: `evidenceKey ${JSON.stringify(key)} 解析得到 null——该读数「没读出来」（例如 driver 的 running: null）⇒ 拒（⛔ 读不出 ≠ 有证据；这与「键不在读数里」是两回事）` };
  }
  return { state: "admitted", value: v };
}

/** 既有任务里是否已有人在管这个机制（按机制词搜，⛔ 不按症状词——memory 记的那次真实漏抓）。
 *  **带上状态**：只报文件名不足以判断——「有人正在做」与「有人说做完了但问题还在」需要相反的处置，
 *  而后者（done 却问题依旧）恰恰是最该被驱动的信号，不是拦截的理由。 */
export interface OwningTask { file: string; status: string }
export function findOwningTasks(root: string, keyword: string, cap = 5): OwningTask[] {
  const kw = String(keyword ?? "").trim().toLowerCase();
  if (kw.length < 4) return []; // 太短的词会命中一切，等于没搜
  const dir = path.join(root, "tasks");
  let files: string[];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return []; }
  // ⚠️ 缺陷原样（本任务 Proposal ①）：扫描曾在 `hits.length >= cap` 处**提前 break**——而 cap 在
  // 【状态过滤之前】生效。板上 2622/2698 任务是 done ⇒ 一个常见机制词的前 5 个命中可能全是 done，
  // 板上的第 6 个（真正在办的）owner 结构上永远看不见 ⇒ 条目被当重复挡下，闸却报「没有在办的 owner」。
  // 这正是硬规则 3b：闸读不到 ⇒ 报了一个与「查过且没有」同形的答案。
  // ⇒ 现在扫全板，cap 只作用在【报告面】——且**按类别分别截断**：未决 owner 先入列，done/closed
  //   的是「假完成证据」（会进任务体），不因截断把 live owner 挤出可见集。
  const hits: OwningTask[] = [];
  for (const f of files) {
    try {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      if (!text.toLowerCase().includes(kw)) continue;
      // status 取 frontmatter 首个 `status:`（⛔ 不 grep 全文——正文里提到 status 的行会误命中）。
      const fm = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
      const m = fm.match(/^status:\s*(\S+)\s*$/m);
      hits.push({ file: f, status: m ? m[1] : "unknown" });
    } catch { /* 读不了就跳过这一个 */ }
  }
  const live = hits.filter((o) => o.status !== "done" && o.status !== "superseded");
  const closed = hits.filter((o) => o.status === "done" || o.status === "superseded");
  return [...live.slice(0, cap), ...closed.slice(0, cap)];
}

/** 只有【未完成】的任务才构成「已有人在管」的拦截理由。done/superseded 的命中不拦——
 *  问题仍在而任务已 done，说明那是个假完成，应当被驱动而不是被它挡住。 */
export function blockingOwners(owners: OwningTask[]): OwningTask[] {
  return owners.filter((o) => o.status !== "done" && o.status !== "superseded");
}

/** 读 tasks/<id>.md 的 status；文件不存在 ⇒ null。⛔ 区分「不存在」（null）与「存在但读不出
 *  状态」（"unknown"）——硬规则 6：读不出 ≠ 已完成，unknown 走「拒」分支，⛔ 不当作可覆盖。 */
export function taskFileStatus(root: string, id: string): string | null {
  const f = path.join(root, "tasks", `${id}.md`);
  if (!fs.existsSync(f)) return null;
  try {
    const text = fs.readFileSync(f, "utf8");
    const fm = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
    const m = fm.match(/^status:\s*(\S+)\s*$/m);
    return m ? m[1] : "unknown";
  } catch { return "unknown"; }
}

/** 派生 id 已存在时，找第一个不撞的区分后缀（-2、-3…）。⛔ 确定性幂等：同一任务集下返回同一后缀。 */
export function nextCollisionId(root: string, baseId: string): string {
  let n = 2;
  let file = `${baseId}-${n}.md`;
  while (fs.existsSync(path.join(root, "tasks", file))) {
    n++;
    file = `${baseId}-${n}.md`;
  }
  return `${baseId}-${n}`;
}

/** 一条寄给 meta-driver 的消息（`meta/META-NNN.md` 的 proposed 记录，第五种 store kind）。
 *  与 task/adr/goal/document 同级：专用 schema 自己定义送达面——正文【完整】进读数（body），
 *  ⛔ 不存在「只传 title 的截断」。答复（reply）内嵌在同一条记录上，翻 answered 后离开读数。 */
export interface MetaMessage {
  id: string;
  title: string | null;
  status: string;
  handler: string | null;
  reply: string | null;
  body: string;
}

/** probe 输出里对一条 meta 记录的判定输入（语义半的原始产出，机械半随后与 metaRecords 对齐）。 */
export interface MetaRecordOpinionInput {
  metaId: string;
  hasOpinion: boolean;
  note?: string | null;
}

/** 逐条三态：有意见 / 无意见 / 未评估。⛔ 「无意见」与「没读到这条记录」不得共用取值（硬规则 3b）：
 *  probe 显式给出 `hasOpinion:false` 才是「无意见」（看过且无话可说，是真测量）；
 *  probe 完全没提到该记录（或该条形状读不懂）⇒「未评估」——读不懂 ≠ 合格，也不等于「看过且无话可说」。
 *  ⛔ 不是总数、不是布尔：对【每一条】 meta 记录落一个 metaId + 三态（SPEC §5.3 枚举不布尔）。 */
export type MetaRecordOpinion = "has-opinion" | "no-opinion" | "not-evaluated";

export interface MetaRecordJudgment {
  metaId: string;
  opinion: MetaRecordOpinion;
  note: string | null;
}

/** 读【寄给 meta-driver 的消息】——`meta/` 目录里 `status: proposed` 的记录（经 meta-store，⛔ 不手搓
 *  解析 frontmatter）。这是「裸缺陷/要求」的入口：人（或任何一层）用 `quay meta write` 立一条 META
 *  记录，它下一轮就进读数。⛔ 不再用 `label:meta-driver` 的 task——那个标签双义（主题 vs 路由）、双
 *  消费者（worker 实现 + meta-driver 评论），正是被取代的 gap-addressedtasks-conflates-* 缺陷。 */
export function collectMetaRecords(root: string): MetaMessage[] {
  let records: Array<Record<string, unknown>>;
  try {
    records = createMetaStore(path.join(root, "meta")).list({ status: "proposed" });
  } catch { return []; }
  return records.map((m) => ({
    id: String(m.id),
    title: m.title == null ? null : String(m.title),
    status: String(m.status),
    handler: m.handler == null ? null : String(m.handler),
    reply: m.reply == null ? null : String(m.reply),
    body: m.body == null ? "" : String(m.body),
  }));
}

/** 把 probe 的逐条判定与 metaRecords 对齐：对【每一条】 meta 记录落一个三态判定。
 *  ⛔ 判定条数必须 == metaRecords 条数（probe 少答一条 ⇒ 那条落「未评估」，不被静默丢弃——
 *  SPEC §5.3 不枚举对象则零指引价值；负控制见单测）。
 *  对齐规则：
 *    - probe 显式给出 `hasOpinion:true` ⇒ 「有意见」；`hasOpinion:false` ⇒ 「无意见」（真测量）；
 *    - probe 没提到该 metaId，或该条形状读不懂（metaId 空 / hasOpinion 非布尔）⇒ 「未评估」；
 *    - probe 多答了不在 metaRecords 里的 metaId ⇒ 丢弃（判定只覆盖真实输入的消息集，⛔ 不跟着
 *      probe 的幻觉扩出一个不存在的对象）；同一 metaId 出现多条 ⇒ 取第一条（不猜测、不合并）。
 *  ⛔ 纯判定，零副作用：不写 meta 文件——答复的写盘在调用侧（writeMetaReplies），本函数只对齐。 */
export function resolveMetaRecordOpinions(
  metaRecords: MetaMessage[],
  opinions: MetaRecordOpinionInput[],
): MetaRecordJudgment[] {
  const byId = new Map<string, { opinion: "has-opinion" | "no-opinion"; note: string | null }>();
  for (const o of opinions) {
    const id = String(o?.metaId ?? "").trim();
    if (!id || byId.has(id)) continue;
    // 形状读不懂 ⇒ 不登记 ⇒ 落到「未评估」（⛔ 不得当成「无意见」，硬规则 3b）。
    if (typeof o?.hasOpinion !== "boolean") continue;
    byId.set(id, {
      opinion: o.hasOpinion ? "has-opinion" : "no-opinion",
      note: typeof o.note === "string" && o.note.trim() ? o.note.trim() : null,
    });
  }
  return metaRecords.map((m) => {
    const hit = byId.get(m.id);
    return hit
      ? { metaId: m.id, opinion: hit.opinion, note: hit.note }
      : { metaId: m.id, opinion: "not-evaluated" as const, note: null };
  });
}

/** 一条判定的答复文本（纯函数）。⛔ 「未评估」⇒ null（不答复，留 proposed 下一轮再呈现）；
 *  「有意见」⇒ note（空则回退一个显式标记）；「无意见」⇒ 一个确定性标记——两者都必须【答复】
 *  （翻 answered），否则发件人无法区分「被看过但无话」与「根本没被读」。 */
export function metaReplyText(judgment: MetaRecordJudgment): string | null {
  if (judgment.opinion === "not-evaluated") return null;
  if (judgment.opinion === "has-opinion") {
    return judgment.note ?? "(meta-driver 有意见，未附注)";
  }
  return "(meta-driver 无意见)";
}

/** 把逐条判定写回 meta 记录：答复内嵌在同一条记录上（问与答同一对象）、翻 answered。
 *  写盘即提交由 meta-store 的 commit-after-write 负责——内容不变 ⇒ 不提交（AC6 提交洪水闸），
 *  内容变 ⇒ 恰 1 次提交。逐条留痕（⛔ 不只报总数，硬规则 3）。 */
export function writeMetaReplies(
  root: string,
  judgments: MetaRecordJudgment[],
): Array<{ metaId: string; reply: string | null; ok: boolean; reason: string }> {
  const store = createMetaStore(path.join(root, "meta"));
  const out: Array<{ metaId: string; reply: string | null; ok: boolean; reason: string }> = [];
  for (const j of judgments) {
    const reply = metaReplyText(j);
    if (reply === null) {
      out.push({ metaId: j.metaId, reply: null, ok: false, reason: "not-evaluated ⇒ 不答复（留 proposed）" });
      continue;
    }
    try {
      store.write(j.metaId, { status: "answered", reply });
      out.push({ metaId: j.metaId, reply, ok: true, reason: "answered" });
    } catch (e) {
      out.push({ metaId: j.metaId, reply, ok: false, reason: (e as Error).message });
    }
  }
  return out;
}

/** 逗号分隔的仓库相对路径里，【真实存在】的那些。用于「拿得出真出处」这类闸——
 *  ⛔ 存在性是关键：一个逃避责任的升级拿不出真实存在的文件路径，而一个真冲突拿得出。 */
export function existingPaths(root: string, csv: string): string[] {
  return String(csv ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    .filter((rel) => { try { return fs.existsSync(path.join(root, rel)); } catch { return false; } });
}

/** 任务体（四件套）。⛔ 机械渲染自结构化输出——不给 LLM 写文件的权力。 */
export function renderAutoDriveBody(item: AutoDriveItem, evidence: unknown, at: string, staleOwners: string[] = [], taskId?: string): string {
  return [
    "## Finding",
    `${item.problem}`,
    "",
    `本轮读数（${item.evidenceKey}）= \`${JSON.stringify(evidence)}\`，采于 ${at}，由 meta-driver 机械采集。`,
    staleOwners.length > 0
      ? `⚠️ 机制词 \`${item.mechanismKeyword}\` 命中【已完成】任务：${staleOwners.join("、")}——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。`
      : `涉及机制关键词：\`${item.mechanismKeyword}\`（立案前已搜既有任务，无人认领）。`,
    "",
    "## AC（draft）",
    `- [ ] \`${item.criterion}\` ⇒ ${item.expect}`,
    "",
    "## DoD（draft）",
    "- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）",
    "- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制",
    "",
    "## Touches",
    // 机制所在文件（由语义半读码指明）+ 任务体自身（立案纪律要求 self-touch）。
    // self-touch 机械补齐（立案纪律要求任务体自身在 Touches 里）——⛔ 不指望 LLM 记得。
    ...[...new Set([
      ...item.touches.split(",").map((t) => t.trim()).filter(Boolean),
      ...(taskId ? [`tasks/${taskId}.md`] : []),
    ])].map((t) => `- \`${t}\``),
  ].join("\n");
}

/** 立一条任务（复用 quay-native 的 task create CLI，⛔ 不手搓 markdown 落盘）。
 *  **单一构造点**：autoDrive 与 needs-human-task 两条落地路径共用它，⛔ 不各拼一份 argv。 */
export async function createTask(
  root: string, id: string, title: string, labels: string[], body: string, status?: string,
): Promise<{ ok: boolean; reason: string }> {
  const argv = [
    "node", "--no-warnings", "--experimental-strip-types",
    path.join(root, "packages", "quay-native", "bin", "quay-native.ts"),
    "task", "create", id,
    "--title", title,
    "--labels", labels.join(","),
    ...(status ? ["--status", status] : []),
    "--body", body,
  ];
  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { ok: false, reason: `task create spawn error: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `task create exit ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}` };
  return { ok: true, reason: `filed as ${id}` };
}

/** autoDrive 的落地（保持既有标签集不变）。 */
export async function createAutoDriveTask(
  root: string, id: string, item: AutoDriveItem, body: string,
): Promise<{ ok: boolean; reason: string }> {
  return createTask(root, id, item.title, ["meta-driver", "driver-candidate"], body);
}

export interface AutoDriveResult { item: AutoDriveItem; id: string | null; accepted: boolean; reason: string }

/** 自动驱动的闸 + 落地。逐条留痕（⛔ 不只报总数）。 */
export async function driveItems(
  root: string, items: AutoDriveItem[], readings: MetaRoundReadings,
  opts: { cap: number; dryRun: boolean; at: string },
): Promise<AutoDriveResult[]> {
  const out: AutoDriveResult[] = [];
  let filed = 0;
  // 全局窗口合计（本任务新增）：**与 probe-routine.ts 的 ① 同一次读法**——从同一载体
  // `.quay/routine-findings.jsonl` 读跨 routine 的尾窗合计（⛔ 不用本轮的局部计数冒充当全局）。
  // 读不到载体 ⇒ `countRecentFilings` 返回 0（与「窗口内确实 0 条」同值——两者都只让闸更松，不回退）。
  const carrierPath = path.join(root, ROUTINE_FINDINGS_REL);
  const nowMs = Date.now();
  // 窗口从 drivers.yml `routine_quota.window_ms` 读（⛔ 不是常量 FILING_WINDOW_MS）——与 probe-routine.ts
  // 的 ① 同源同值，否则两条立案路径会对同一个载体用两个不同的尾窗。
  const globalBase = countRecentFilings(carrierPath, nowMs, routineWindowMs(root), null);
  const globalCeiling = routineGlobalCeiling(root);
  for (const item of items) {
    if (filed >= opts.cap) {
      out.push({ item, id: null, accepted: false, reason: `rate: 本轮已自动驱动 ${filed} 条，上限 ${opts.cap}` });
      continue;
    }
    const evg = readEvidenceForGate(readings, item.evidenceKey);
    if (evg.state !== "admitted") {
      out.push({ item, id: null, accepted: false, reason: evg.reason });
      continue;
    }
    const ev = evg.value;
    const owners = findOwningTasks(root, item.mechanismKeyword);
    const blocking = blockingOwners(owners);
    if (blocking.length > 0) {
      out.push({ item, id: null, accepted: false, reason: `未完成的既有任务已在管（机制词 ${item.mechanismKeyword}）：${blocking.map((o) => `${o.file}[${o.status}]`).join(", ")}` });
      continue;
    }
    // done/superseded 的命中不拦，但要带进任务体——「已 done 却问题依旧」是立案的核心证据。
    const staleOwners = owners.map((o) => `${o.file}[${o.status}]`);
    // 准入判据由**独立纯 Policy 函数**执行（与 probe-routine.ts 收敛到同一个 routineQuotaDecision）。
    // ⚠️ 语义差异（本任务 Plan ②要求写明，⛔ 不假装两条链同构）：这里的 `perRoutine: filed` 是
    // **本轮函数内局部计数**（不是跨轮读载体），而 probe-routine.ts 的 `perRoutine` 是**跨轮载体尾窗
    // 读数**——两者都叫 recentCount，量的来源不同。`global` 则与 ① 一致：载体尾窗合计（跨 routine）
    // + 本轮已驱动数（meta 自身不写该载体 ⇒ 只有本地 +filed 才把本轮计入全局，与 ① 的
    // +acceptedThisRound 形状一致）。结果交给 gateFinding 以保持 quality → dedup → rate/global-rate 的闸序。
    const quota = routineQuotaDecision(
      { perRoutine: filed, global: globalBase + filed },
      { k: opts.cap, globalCeiling },
    );
    const gate = gateFinding(proposalCandidateText({ title: item.title, criterion: item.criterion, origin: item.problem }), { existingKeys: [], quota });
    if (!gate.accept) { out.push({ item, id: null, accepted: false, reason: gate.reason }); continue; }

    const baseId = `gap-meta-${item.mechanismKeyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}`;
    // ⛔ 派生 id 是 mechanismKeyword 的确定性 slug、不带唯一化 ⇒ 可能撞上既有任务。撞 done/superseded
    // ⇒ 问题仍在而任务已 done（假完成）⇒ refile 为新任务（加区分后缀，⛔ 不覆盖既有任务体）；
    // 撞未完成/读不出状态 ⇒ 拒（占着 id，覆盖 = 静默吞掉在办任务）。三态必须可区分（硬规则 3b）：
    // `filed as <新 id>` / `rejected: …` / `refiled as <新 id>（既有 <旧 id> 已 done）`。
    const existingStatus = taskFileStatus(root, baseId);
    let id = baseId;
    let refiledFrom: string | null = null;
    if (existingStatus !== null) {
      if (existingStatus === "done" || existingStatus === "superseded") {
        id = nextCollisionId(root, baseId);
        refiledFrom = baseId;
        // 撞上的 done 任务进任务体证据（⛔ 即使 findOwningTasks 因关键词不在其体内而没抓到它）。
        // 格式与 findOwningTasks 的 `${o.file}[${o.status}]` 一致（裸文件名，无 tasks/ 前缀），⛔ 不重复列。
        const collisionOwner = `${baseId}.md[${existingStatus}]`;
        if (!staleOwners.includes(collisionOwner)) staleOwners.push(collisionOwner);
      } else {
        out.push({ item, id: null, accepted: false, reason: `rejected: 既有任务 ${baseId}.md[${existingStatus}] 占着派生 id（未完成）⇒ 不覆盖` });
        continue;
      }
    }
    if (opts.dryRun) {
      out.push({ item, id, accepted: true, reason: refiledFrom ? `dry-run: would refile as ${id}（既有 ${refiledFrom} 已 done）` : "dry-run: would file" });
    } else {
      const c = await createAutoDriveTask(root, id, item, renderAutoDriveBody(item, ev, opts.at, staleOwners, id));
      const reason = c.ok && refiledFrom ? `refiled as ${id}（既有 ${refiledFrom} 已 done）` : c.reason;
      out.push({ item, id, accepted: c.ok, reason });
      if (!c.ok) continue;
    }
    filed++;
  }
  return out;
}

// ── probe 写入守卫（把 FILE-ONLY 从散文变成机制）──────────────────────────────────────────────────
// 实测 2026-09-06：launch.settings.json 是 `defaultMode: bypassPermissions` ⇒ 派出去的 claude -p
// **本来就有全部工具权限**，包括 Write/Edit/Bash。「⛔ 不执行、⛔ 不翻状态」这些话此前**只存在于
// probe 规格的散文里，没有任何机制强制**（硬规则 9：守与不守在记录上无法区分）。
// 人 2026-09-06 裁定给它读代码的能力 ⇒ 读的授权扩大，写的风险随之上升 ⇒ 必须把守卫做成机制。
//
// 契约：**语义半在其运行期间不得改动任何 tracked 文件**——它的产出是 JSON，一切落盘都由本文件
// 在其之后机械执行。故「spawn 期间出现的新改动」= 违约。
// ⛔ 不自动还原：共享检出里同时有别的 driver 在写，还原会毁掉它们的工作。改为**检出即拒**——
// 违约轮 fail-closed，不落任何提案/决策/任务（一个越权的 probe，其输出不可信）。
//
// 2026-09-13 迁移：实现搬到 `probe-write-guard.ts`（第二个消费者 probe-routine.ts 由 quality
// driver 承载 ⇒ 留在这里会形成 quality-gate-driver → probe-routine → meta-driver → quality-gate-driver
// 的 import 环）。此处 re-export 保持所有既有调用点/测试的 import 路径不变，实现仍只有一份。
export { snapshotTrackedChanges, probeWriteViolations } from "./probe-write-guard.ts";

// ── 决策通道（方向问题也必须【被路由】，⛔ 不许停在一个死胡同字段里）──────────────────────────────
// 人 2026-09-06 裁定：这些问题都在自举的 quay 应自行处理的范围内——meta-driver 可以不自己解决，
// 但**要么找到既有机制去解决，要么创建该机制**。
//
// 而 v0 的 humanAttention 是一个【死胡同】：只打印到 stdout + 一个 gitignored 的 jsonl，没有任何
// 人会看到，也没有关闭路径。那正是本文件自己诊断过的 escalations.md 死法（12 条未答、死 10 天）。
// ⇒ 改为路由到既有机制：一个方向问题 = 一条 **draft GOAL 记录**（kind 由 id 前缀派生、status 缺省
// draft、GOAL- 记录不需要 criterion），它落在 /goal?status=draft 的「N 条待人裁定」面上，
// **激活它就是裁定本身**（SPEC-goal-mechanism 裁定 3：draft→active 保留给人）。
// ⛔ 不新建第七个登记面——用的是已经在跑的 goal store 和刚接好的那个可见面。

/** 载体：⛔ 「需要人裁决」不等于「是 GOAL 尺寸」。此前两者被混为一谈——本轮实测那条决策
 *  （SPEC-0809 §3 与 AC-180 冲突）是【政策冲突】而非「我们要什么」，却因 draft→active 恰好是
 *  人裁决界面而被写成 draft GOAL。载体现在按事情的性质选，不按通道选。 */
export type DecisionCarrier = "goal" | "needs-human-task";

export interface DecisionItem {
  title: string;
  question: string;
  options: string;
  evidenceKey: string;
  origin: string;
  /** 载体。缺省 `goal`（向后兼容），但两种载体各有自己的机械闸，缺字段即被该闸拒（fail-closed）。 */
  carrier?: DecisionCarrier;
  /** carrier=goal 必填：作用域（仓库相对路径，逗号分隔）。**必须 ≥3 条真实存在**——
   *  一个只要改一两个文件就能满足的东西，结构上不是 GOAL（颗粒度闸，与 mechanismKeyword 拒症状词同构）。 */
  scope?: string;
  /** carrier=needs-human-task 必填：**互相矛盾的既有立场，逐字引用**。≥2 条，且每条的 `quote`
   *  必须**在 `source` 文件里逐字存在**（fs 校验）。
   *  ⛔ 这是防逃逸的核心，且是【语义】闸不是频率闸：它直接检验 a/b/c 判据的 (b) 步——
   *  「阻碍是不是一个【已经写下】的偏好」。能引出两条互相矛盾的原文 ⇒ 确实需要人在两个既有立场间裁决；
   *  只引得出一条 ⇒ 那条就是答案，应当直接适用（走 autoDrive）；一条都引不出 ⇒ 那是「我不确定」，不是「须人裁决」。
   *  逐字校验让伪造变得昂贵：编不出一段恰好存在于某个真实文件里的话。 */
  conflict?: Array<{ source: string; quote: string }>;
  /** carrier=needs-human-task 必填：机器若自行选错，什么会变得难以撤销。
   *  ⛔ 语义核心之二：一个【容易撤销】的选择不该占用人的注意力——自己选、记录下来即可。
   *  只有代价不可逆时，「交给人」才是负责任而不是逃避。 */
  irreversible?: string;
  /** carrier=needs-human-task 必填：授权面（同 autoDrive 的 Touches）。 */
  touches?: string;
}

/** 下一个可用 GOAL id（薄包装：nextSequenceId 是唯一定义）。⛔ 不复用编号（硬规则 8）。 */
export function nextGoalId(records: Array<Record<string, unknown>>): string {
  return nextSequenceId(records, "GOAL");
}

/** 决策的 origin 正文：问题 + 选项 + 读数出处。`origin` 是 goal-store 的必填 fail-closed 字段，
 *  也是 /goal 列表里可见的一列 ⇒ 内容放这里，人在待裁定面上就能直接读到要裁什么。 */
export function renderDecisionOrigin(item: DecisionItem, evidence: unknown, at: string): string {
  return [
    `【要裁定什么】${item.question}`,
    `【选项与代价】${item.options}`,
    `【实测依据】${item.evidenceKey} = ${JSON.stringify(evidence)}（meta-driver 机械采集于 ${at}）`,
    `【为什么不能机械决定】${item.origin}`,
    `【怎么关闭】认可某个选项 ⇒ goal-store write <id> --status active；否决 ⇒ 保持 draft 或标 superseded。`,
  ].join("\n");
}

/** 决策的 body 正文：GOAL 契约要求的三段（背景 / 范围与非目标 / 退出条件）。
 *  ⛔ 与 renderDecisionOrigin 分工：origin = 出处引用（要裁什么/选项/实测依据/为何不能机械决定/怎么关闭，
 *  待裁定面上可见的一列）；body = 实质（goal 的 substance，goal-store 对 goal kind 的 create 要求
 *  ≥ MIN_GOAL_BODY_CHARS 非空白）。两者分离，⛔ 不是把 origin 复制进 body（store 契约明文拒绝
 *  「互为副本」的形态——origin 只是 provenance citation，不是 body）。 */
export function renderDecisionBody(item: DecisionItem): string {
  const scope = String(item.scope ?? "").trim();
  return [
    "## 背景",
    `待裁定的方向问题：${item.question}`,
    `为何机器不能自决：${item.origin}`,
    "",
    "## 范围与非目标",
    `作用域：${scope || "（未声明）"}`,
    `选项与代价：${item.options}`,
    "非目标：本记录只承载「要人作何选择」，不预先承诺任一选项的落地——选定后的落地作为后续工作另立案。",
    "",
    "## 退出条件",
    "认可某个选项 ⇒ goal-store write <id> --status active；否决 ⇒ 保持 draft 或标 superseded。",
  ].join("\n");
}

/** carrier=goal 决策的 write argv（单一构造点——单测据此直接断言 argv 含 `--body` 且其值 ≥40，
 *  ⛔ 不靠读落盘文件反推）。body = renderDecisionBody 的三段正文，origin = renderDecisionOrigin 的出处引用。
 *  `dataRoot` 缺省 = scriptRoot（生产同源）；测试传临时目录隔离落盘（同 fileProposals 的 dataRoot 手法）。 */
export function decisionGoalWriteArgv(
  scriptRoot: string, id: string, item: DecisionItem, origin: string, body: string, dataRoot: string = scriptRoot,
): string[] {
  return goalStoreArgv(scriptRoot, ["write", id, "--title", item.title, "--origin", origin, "--body", body], dataRoot);
}

/** 决策 AC 的判据：退出条件 = 该决策已被裁定，即 GOAL 离开 `draft`（active = 认可某选项；
 *  superseded = 否决）。⛔ 不是恒真式：draft 期间判据为假，且**在同一行写出成因**（写面的 attribution
 *  闸要求失败可归因——裸 `exit 1` 会被 `goal-store write` 直接拒掉，这正是本仓库 2026-09-11 那条实测）。
 *  ⛔ 构造自 `goalStoreArgv`（单一来源）：入口/方言/--root 与写路径同源 ⇒ 不会分叉成两份入口解析。
 *  ⚠️ 这条判据由【人裁定】这一动作使其为真，⛔ 不是机器能替人做的判断——它只把「裁没裁」变成可判定的。 */
export function decisionAcCriterion(scriptRoot: string | null, goalId: string, dataRoot: string): string {
  const cli = goalStoreArgv(scriptRoot, ["get", goalId], dataRoot).map(shellQuoteArg).join(" ");
  const cause = `'${goalId} 仍未裁定（draft）—— 认可某选项 ⇒ goal write ${goalId} --status active；否决 ⇒ --status superseded'`;
  return `${cli} | grep -Eq '"status": "(active|superseded)"' || { echo ${cause} >&2; exit 1; }`;
}

/** 供判据字符串用的最小 shell 引用（判据是**文本**，将来由 shell 跑；⛔ 不是本进程的 argv）。 */
function shellQuoteArg(a: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

/** 决策 AC 的 write argv——**必须先于** decisionGoalWriteArgv 执行（AC-first）。 */
export function decisionAcWriteArgv(
  scriptRoot: string | null, acId: string, goalId: string, item: DecisionItem, origin: string,
  dataRoot: string = scriptRoot ?? "",
): string[] {
  return goalStoreArgv(scriptRoot, [
    "write", acId,
    "--title", `${item.title} — 退出条件`,
    "--status", "draft",
    "--goal", goalId,
    "--criterion", decisionAcCriterion(scriptRoot, goalId, dataRoot),
    "--expect", `该决策已被裁定：${goalId} 离开 draft（active = 认可某选项；superseded = 否决）。draft 期间判据为假并写出成因。`,
    "--origin", origin,
  ], dataRoot);
}

/** 决策自己的质量判据。⛔ 不复用 gateFinding 的 quality 闸——那个 EVIDENCE 正则是为【缺陷发现】
 *  调的（要求正文含文件路径/sha/`exit N` 这类代码形 token），而一个架构方向问题合理地可以不含
 *  这种 token。实测误杀：「变化检测是否上升为平台能力」被拒，理由 "no actionable ## Finding with
 *  reproduction evidence" ⇒ 判据用错了对象。
 *  决策的质量在于【是不是一个真的选择】：有问题、有 ≥2 个带代价的选项、说得出机器为何不能定。
 *  经验依据由 evidenceKey 单独强制（那才是"有实测支撑"的闸），此处不重复要求代码形 token。 */
export function decisionQuality(item: DecisionItem): { ok: boolean; reason: string } {
  if (item.question.trim().length < 20) return { ok: false, reason: "quality: question 过短，说不清要裁什么" };
  if (item.origin.trim().length < 20) return { ok: false, reason: "quality: origin 未说明机器为何不能自决" };
  // ≥2 个选项：按常见枚举符切分，每段需有实质长度。「一个选项的决策不是决策」（probe 规格原话）。
  const segs = item.options.split(/[;；]|[①②③④⑤]|\([a-d]\)|\b[1-4][.)]/u)
    .map((x) => x.trim()).filter((x) => x.length >= 10);
  if (segs.length < 2) return { ok: false, reason: `quality: 只解析出 ${segs.length} 个实质选项——一个选项的决策不是决策` };
  return { ok: true, reason: `accepted: ${segs.length} 个选项，问题与不可自决理由齐备` };
}

/** GOAL 的颗粒度下限：作用域须有 ≥3 条真实存在的路径。改一两个文件就能满足的不是 GOAL。 */
export const GOAL_MIN_SCOPE_ENTRIES = 3;
/** needs-human-task 的冲突下限：≥2 条【逐字可核】的既有立场。 */
export const HUMAN_CALL_MIN_SOURCES = 2;
/** 逐字引用的最短长度，**按 UTF-8 字节**算。太短的片段在任何文件里都能命中，等于没校验。
 *
 *  ⚠️ 为什么是字节不是字符：按字符数标定的阈值是拿 ASCII 校准的，会低估 CJK 的信息密度——
 *  `不存在无判据的活跃验收` 只有 11 个字符却已经相当具体，用 `<12 字符` 判会把它当成"太短"拒掉。
 *  这与本仓库 `cand-cjk-proposal-slot-word-boundary` 踩过的 `\b` 词边界是同一类缺陷：
 *  **一个为 ASCII 调好的判据，遇到 CJK 静默失效。** 24 字节 ≈ ASCII 4 个词 ≈ CJK 8 字，两侧都足够具体。 */
export const HUMAN_CALL_MIN_QUOTE_BYTES = 24;

/** 逐字核对：`quote` 是否**真的**出现在 `source` 文件里。
 *  读不到文件 ⇒ false（fail-closed，⛔ 读不出不得与「核对通过」同形，硬规则 3b）。 */
export function quoteIsVerbatim(root: string, source: string, quote: string): boolean {
  const q = String(quote ?? "").trim();
  if (Buffer.byteLength(q, "utf8") < HUMAN_CALL_MIN_QUOTE_BYTES) return false;
  try {
    return fs.readFileSync(path.join(root, String(source ?? "")), "utf8").includes(q);
  } catch { return false; }
}
/** needs-human-task 的标签（背压闸按它数未关闭条数）。 */
export const HUMAN_CALL_LABEL = "meta-human-call";

/** 载体闸：按事情的性质选载体，并对各自的滥用形态设机械下限。
 *
 *  人 2026-09-06 授权 needs-human-task，附加要求「极为谨慎地使用，以防其成为又一种逃避责任的出口」。
 *  ⊢ 按硬规则 9，「谨慎」写成劝告等于没写（守与不守在记录上无法区分）⇒ 必须机械化。三道闸：
 *    ① 真出处：`sources` 里【真实存在】的路径 ≥2 —— 一个真冲突拿得出两个互相矛盾的既有出处，
 *      一句「我不确定」拿不出。存在性由 fs 校验，⛔ 不是长度或关键词。
 *    ② 授权面：必须给 touches —— 说不出该改哪里，就不是「一件卡住的工作」，那是没想清楚。
 *    ③ 背压（在调用侧）：已有未关闭的 meta-human-call ⇒ 拒。**这个出口一次只允许开一条**，
 *      用过就关上，直到人把它关掉 —— 逃避一次的代价是失去再逃避的能力。 */
export function carrierGate(root: string, item: DecisionItem): { ok: boolean; carrier: DecisionCarrier; reason: string } {
  const carrier: DecisionCarrier = item.carrier === "needs-human-task" ? "needs-human-task" : "goal";
  if (carrier === "goal") {
    const hits = existingPaths(root, item.scope ?? "");
    if (hits.length < GOAL_MIN_SCOPE_ENTRIES) {
      return {
        ok: false, carrier,
        reason: `granularity: scope 只解析出 ${hits.length} 条真实路径（需 ≥${GOAL_MIN_SCOPE_ENTRIES}）——改一两个文件就能满足的东西不是 GOAL，请改用 autoDrive 或 needs-human-task`,
      };
    }
    return { ok: true, carrier, reason: `goal: scope ${hits.length} 条真实路径` };
  }
  // 语义闸①：互相矛盾的既有立场，逐字可核。⛔ 不是「引用了几个文件」，是「引的话真的在那个文件里」。
  const conflict = Array.isArray(item.conflict) ? item.conflict : [];
  const verified = conflict.filter((c) => c && quoteIsVerbatim(root, c.source, c.quote));
  if (verified.length < HUMAN_CALL_MIN_SOURCES) {
    const bad = conflict.filter((c) => !verified.includes(c)).map((c) => c?.source ?? "<无 source>");
    return {
      ok: false, carrier,
      reason: `escape-guard: 只核实了 ${verified.length}/${conflict.length} 条逐字冲突引用（需 ≥${HUMAN_CALL_MIN_SOURCES}）`
        + (bad.length ? `；核不上的：${bad.join("、")}` : "")
        + `。⊢ 引不出两条互相矛盾的原文 ⇒ 这不是「两个既有立场要人裁决」：只引得出一条 ⇒ 那条就是答案，直接适用（autoDrive）；一条都引不出 ⇒ 是「我不确定」，不是「须人裁决」`,
    };
  }
  // 语义闸②：不可逆性。容易撤销的选择不该占用人的注意力——自己选、记录即可。
  if (String(item.irreversible ?? "").trim().length < 20) {
    return {
      ok: false, carrier,
      reason: "escape-guard: 未说明「机器若自行选错，什么会变得难以撤销」——一个容易撤销的选择应当自己做并记录，交给人才是逃避",
    };
  }
  if (!String(item.touches ?? "").trim()) {
    return { ok: false, carrier, reason: "escape-guard: needs-human-task 必须给 touches（授权面）——说不出该改哪里的，不是一件卡住的工作" };
  }
  return { ok: true, carrier, reason: `needs-human-task: ${verified.length} 条逐字可核的冲突引用 + 不可逆性说明 + 授权面齐备` };
}

/** needs-human-task 的任务体。⛔ 机械渲染自结构化输出——不给 LLM 写文件的权力（同 autoDrive）。 */
export function renderHumanCallBody(item: DecisionItem, evidence: unknown, at: string, taskId?: string): string {
  return [
    "## Finding",
    `${item.question}`,
    "",
    `**要人裁决的是什么**：${item.title}`,
    `**选项与代价**：${item.options}`,
    `**为什么机器不能自决**：${item.origin}`,
    `**若机器自行选错，什么难以撤销**：${item.irreversible ?? ""}`,
    `**实测依据**：\`${item.evidenceKey}\` = ${JSON.stringify(evidence)}（meta-driver 机械采集于 ${at}）`,
    "",
    "**互相矛盾的既有立场（逐字引用，已机械核对确实存在于对应文件）**：",
    ...(item.conflict ?? []).map((c) => `- \`${c.source}\`：「${c.quote}」`),
    "",
    "## AC（draft）",
    "- [ ] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定）",
    "- [ ] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成）",
    "",
    "## DoD（draft）",
    "- [ ] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中",
    "- [ ] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突",
    "",
    "## Touches",
    ...[...new Set([
      ...String(item.touches ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      ...(taskId ? [`tasks/${taskId}.md`] : []),
    ])].map((t) => `- \`${t}\``),
  ].join("\n");
}

export interface DecisionResult { item: DecisionItem; id: string | null; accepted: boolean; reason: string }

/** 决策的闸 + 落地。与自动驱动同源的证据纪律：evidenceKey 必须在本轮读数里解析得出。 */
export async function fileDecisions(
  root: string, items: DecisionItem[], readings: MetaRoundReadings,
  records: Array<Record<string, unknown>>,
  opts: { cap: number; dryRun: boolean; at: string; dataRoot?: string },
): Promise<DecisionResult[]> {
  const out: DecisionResult[] = [];
  const keys = new Set<string>();
  for (const r of records) {
    const k = findingKey(proposalCandidateText({ title: String(r.title ?? ""), origin: String(r.origin ?? ""), criterion: "" }));
    if (k) keys.add(k);
  }
  const known = [...records];
  let filed = 0;
  for (const item of items) {
    if (filed >= opts.cap) {
      out.push({ item, id: null, accepted: false, reason: `rate: 本轮已路由 ${filed} 条决策，上限 ${opts.cap}` });
      continue;
    }
    const evg = readEvidenceForGate(readings, item.evidenceKey);
    if (evg.state !== "admitted") {
      out.push({ item, id: null, accepted: false, reason: evg.reason });
      continue;
    }
    const ev = evg.value;
    const q = decisionQuality(item);
    if (!q.ok) { out.push({ item, id: null, accepted: false, reason: q.reason }); continue; }

    const cg = carrierGate(root, item);
    if (!cg.ok) { out.push({ item, id: null, accepted: false, reason: cg.reason }); continue; }

    if (cg.carrier === "needs-human-task") {
      // ⛔ 这里【没有】数量背压。人 2026-09-06 否掉了「一次只允许开一条」：那是频率控制冒充语义控制，
      // 且方向反了——第一条无论多烂都放行，之后再真实的冲突都被挡，过滤依赖到达顺序而非质量，
      // 还会制造「名额被占用所以不报真问题」的反向激励。防滥用全部落在 carrierGate 的语义闸上。
      // 未关闭的 human-call 是【信息】不是【配额】——它的判重由语义半读码自行完成（⛔ 不再经
      // `label:meta-driver` 标签回流成读数，那个标签双义的通道已被 META 记录取代）。
      const taskId = `gap-meta-call-${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
      if (opts.dryRun) {
        out.push({ item, id: taskId, accepted: true, reason: `dry-run: would file as needs-human task ${taskId}` });
      } else {
        const body = renderHumanCallBody(item, ev, opts.at, taskId);
        const r = await createTask(root, taskId, item.title, [HUMAN_CALL_LABEL, "meta-driver"], body, "needs-human");
        if (!r.ok) { out.push({ item, id: taskId, accepted: false, reason: r.reason }); continue; }
        out.push({ item, id: taskId, accepted: true, reason: `routed as needs-human task ${taskId}（占用唯一名额，关闭后才可再升级）` });
      }
      filed++;
      continue;
    }

    const origin = renderDecisionOrigin(item, ev, opts.at);
    const candidate = proposalCandidateText({ title: item.title, origin, criterion: "" });
    const key = findingKey(candidate);
    if (keys.has(key)) {
      out.push({ item, id: null, accepted: false, reason: "dedup: 已有等价的待裁定记录" });
      continue;
    }

    const id = nextGoalId(known);
    const acId = nextAcId(known);
    if (opts.dryRun) {
      out.push({ item, id, accepted: true, reason: `dry-run: would file AC ${acId} (the decision's exit condition), then draft GOAL ${id}` });
    } else {
      // ⚠️ AC-FIRST（2026-09-17, gap-goal-born-draft-zero-ac-escapes-standing-invariant）：决策 GOAL
      // 按设计出生即 `draft`（待裁定面 /goal?status=draft 就是读它的地方），而写面现在拒绝「出生即
      // draft/active 而名下零 AC」——那正是不变式 AC-217 自己的作用域 {draft, active}。旧写法只写 GOAL
      // ⇒ 落进被禁态、且从此**每次决策路由都 exit 2**（本文件此前从未被该闸覆盖过：它写的是 GOAL，
      // 而旧谓词只管 active 那一半）。决策的退出条件（人裁定）因此作为一条真 AC 先落盘。
      // ⛔ 不是新机制：仍是「先 AC 后 GOAL」这一个写序，与 CLI 和 e2e 走的是同一条。
      const body = renderDecisionBody(item);
      const acArgv = decisionAcWriteArgv(root, acId, id, item, origin, opts.dataRoot ?? root);
      const acRes = await runAsync(acArgv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
      if (acRes.error || acRes.status !== 0) {
        out.push({ item, id, accepted: false, reason: `decision AC write failed (exit ${acRes.status}): ${(acRes.stderr || "").trim().slice(0, 200)}` });
        continue;
      }
      const argv = decisionGoalWriteArgv(root, id, item, origin, body, opts.dataRoot ?? root);
      const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
      if (r.error || r.status !== 0) {
        out.push({ item, id, accepted: false, reason: `goal write failed (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 200)}` });
        continue;
      }
      // 写盘即提交：goal-store 的 write 自己写盘后立即提交（gap-meta-commitgoalfile）——
      // ⛔ 这里不再二次提交（不新建并行机制）。
      out.push({ item, id, accepted: true, reason: `routed as draft ${id}（可在 /goal?status=draft 看到；退出条件已作为 draft AC ${acId} 先落）` });
    }
    keys.add(findingKey(candidate));
    known.push({ id, title: item.title, origin });
    known.push({ id: acId, title: `${item.title} — 退出条件`, origin, goal: id });
    filed++;
  }
  return out;
}

// ── 语义半 ────────────────────────────────────────────────────────────────────────────────────────

/** 语义半读数的落盘相对路径（.quay 下、gitignored；每轮原子覆写）。
 *  prompt 只带路径 + 稳定摘要，完整 JSON 落盘让 probe 惰性 Read
 *  （gap-meta-driver-probe-readings-inline-over-1mb：整段 JSON 内联曾是每轮 >1MB fresh input）。 */
export const META_DRIVER_READINGS_REL = path.join(".quay", "meta-driver-readings.json");

/** 组装 probe prompt 的**单一构造点**（复刻 launchArgv 的 AC140 纪律：一次性入口与常驻入口
 *  共用同一个组装函数，⛔ 不各拼一份）。
 *  ⛔ 不再把 `JSON.stringify(readings)` 整段内联进 prompt：readings 实测可达 >1MB，作为每轮全新
 *  fresh input 按 1× 计费是纯浪费（driver 全量 fresh_input 里最大的一块）。改为：完整 readings
 *  落盘（<root>/.quay/meta-driver-readings.json，与旧内联的是**同一份** `JSON.stringify` 语义），
 *  prompt 只带**路径** + **稳定摘要**（readingsDigest）+ 一条「按需 Read」指令。probe 规格已授予
 *  Read 权限；FILE-ONLY 守卫只拦 tracked 文件改动（落盘在 .quay 下、gitignored ⇒ 不触发违约）。 */
export function buildProbePrompt(
  objective: string,
  readings: MetaRoundReadings,
  opts: { root?: string; readingsPath?: string } = {},
): string {
  const readingsPath = opts.readingsPath ?? (opts.root ? path.join(opts.root, META_DRIVER_READINGS_REL) : null);
  if (readingsPath) {
    // 落盘失败 ⇒ 语义半这轮拿不到完整读数。⛔ 不内联兜底（那正是本任务要消灭的形态）；prompt 里
    // 明示「未落盘」，probe 把缺读数读成 not-evaluated 而不是自采证（硬规则 3b）。
    try {
      writeJsonAtomic(readingsPath, readings);
    } catch {
      // 吞掉：语义半仍可跑（读不到文件会 not-evaluated），但绝不退化成整段内联。
    }
  }
  const digest = readingsDigest(readings);
  return [
    objective.trim(),
    "",
    "READINGS (mechanically collected this round — arithmetic, not a verdict):",
    `readings file: ${readingsPath ?? "(not persisted this round)"}`,
    `readings digest: ${digest}`,
    "The full readings JSON is on disk at the path above. Read that file when you need any specific number. The readings remain the ONLY measurements — never replace one with a count you derived yourself.",
  ].join("\n");
}

/** 解析语义半的输出。读不懂 ⇒ null（调用侧转 not-evaluated / failed，⛔ 不当空结果放行）。 */
export function parseProbeOutput(stdout: string): {
  divergences: unknown[];
  proposals: Proposal[];
  autoDrive: AutoDriveItem[];
  decisions: DecisionItem[];
  /** probe 对每条 meta 记录的逐条判定（随后由 resolveMetaRecordOpinions 与真实 meta 记录集对齐）。 */
  metaRecordOpinions: MetaRecordOpinionInput[];
} | null {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  // 容忍 LLM 在 JSON 前后带少量散文：取第一个 { 到最后一个 }。
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const proposals: Proposal[] = Array.isArray(o.proposals)
    ? (o.proposals as unknown[]).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const p = raw as Record<string, unknown>;
        const need = ["goal", "title", "criterion", "expect", "origin"] as const;
        if (need.some((k) => typeof p[k] !== "string" || String(p[k]).trim() === "")) return [];
        // `supersedes` 是**可选**字段：LLM 不给它时返回的对象里【不出现这个键】——⛔ 不写成
        // `supersedes: undefined`，那会让对象多出一个键、破坏「缺省路径与改动前逐字一致」。
        // 给了但纯净（空白）也不认：空白不是 id，⛔ 不把它凑成一条「看起来合格」的声明（硬规则 3b）。
        const supersedes = typeof p.supersedes === "string" ? p.supersedes.trim() : "";
        return [{
          goal: String(p.goal).trim(), title: String(p.title).trim(), criterion: String(p.criterion).trim(),
          expect: String(p.expect).trim(), origin: String(p.origin).trim(),
          ...(supersedes !== "" ? { supersedes } : {}),
        }];
      })
    : [];
  const autoDrive: AutoDriveItem[] = Array.isArray(o.autoDrive)
    ? (o.autoDrive as unknown[]).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const a = raw as Record<string, unknown>;
        const need = ["title", "problem", "evidenceKey", "mechanismKeyword", "criterion", "expect", "touches"] as const;
        if (need.some((k) => typeof a[k] !== "string" || String(a[k]).trim() === "")) return [];
        return [{
          title: String(a.title).trim(), problem: String(a.problem).trim(),
          evidenceKey: String(a.evidenceKey).trim(), mechanismKeyword: String(a.mechanismKeyword).trim(),
          criterion: String(a.criterion).trim(), expect: String(a.expect).trim(),
          touches: String(a.touches).trim(),
        }];
      })
    : [];
  const decisions: DecisionItem[] = Array.isArray(o.decisions)
    ? (o.decisions as unknown[]).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const d = raw as Record<string, unknown>;
        const need = ["title", "question", "options", "evidenceKey", "origin"] as const;
        if (need.some((k) => typeof d[k] !== "string" || String(d[k]).trim() === "")) return [];
        // carrier 只认两个字面量；⛔ 无法识别的取值不静默当成 goal，而是原样带下去让 carrierGate
        // 走 goal 分支的颗粒度闸——不认识的输入不得与合格输入同形（硬规则 3b）。
        const carrier = d.carrier === "needs-human-task" ? "needs-human-task" as const
          : d.carrier === "goal" ? "goal" as const : undefined;
        return [{
          title: String(d.title).trim(), question: String(d.question).trim(),
          options: String(d.options).trim(), evidenceKey: String(d.evidenceKey).trim(),
          origin: String(d.origin).trim(),
          ...(carrier ? { carrier } : {}),
          ...(typeof d.scope === "string" ? { scope: d.scope.trim() } : {}),
          ...(typeof d.irreversible === "string" ? { irreversible: d.irreversible.trim() } : {}),
          ...(typeof d.touches === "string" ? { touches: d.touches.trim() } : {}),
          // conflict：只收 {source,quote} 两个字段都是非空字符串的条目。形状不对的条目直接丢弃，
          // ⛔ 不补默认值——一个形状不对的引用不得被凑成"看起来合格"（硬规则 3b）。
          ...(Array.isArray(d.conflict)
            ? {
                conflict: (d.conflict as unknown[]).flatMap((c) => {
                  if (!c || typeof c !== "object") return [];
                  const e = c as Record<string, unknown>;
                  if (typeof e.source !== "string" || typeof e.quote !== "string") return [];
                  const source = e.source.trim(); const quote = e.quote.trim();
                  return source && quote ? [{ source, quote }] : [];
                }),
              }
            : {}),
        }];
      })
    : [];
  // 逐条三态判定（measurement 通道——答复写回由调用侧 writeMetaReplies 落地，⛔ 本函数只解析）。
  // 形状闸：metaId 非空字符串 + hasOpinion 布尔，缺一即丢 ⇒ 落到「未评估」（⛔ 不补默认值、
  // 不凑成「看起来合格」，硬规则 3b）。
  const metaRecordOpinions: MetaRecordOpinionInput[] = Array.isArray(o.metaRecordOpinions)
    ? (o.metaRecordOpinions as unknown[]).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const a = raw as Record<string, unknown>;
        if (typeof a.metaId !== "string" || String(a.metaId).trim() === "") return [];
        if (typeof a.hasOpinion !== "boolean") return [];
        return [{
          metaId: String(a.metaId).trim(),
          hasOpinion: a.hasOpinion,
          note: typeof a.note === "string" ? a.note : null,
        }];
      })
    : [];
  return {
    divergences: Array.isArray(o.divergences) ? (o.divergences as unknown[]) : [],
    proposals,
    autoDrive,
    decisions,
    metaRecordOpinions,
  };
}

// ── 一轮 ──────────────────────────────────────────────────────────────────────────────────────────

export interface MetaRoundOptions {
  root: string;
  focus: string | null;
  noLlm: boolean;
  k: number;
  dryRun: boolean;
  /** 语义半的定时器地板（缺省 JUDGE_FLOOR_MS_DEFAULT）——安全网，非调优阈值。 */
  judgeFloorMs?: number;
  /** 测试缝：注入语义半的 argv（缺省经 launchArgv 派 claude -p）。 */
  probeArgv?: (prompt: string) => string[];
  /** 测试缝：probe 规格目录（缺省 <root>/plugin）。 */
  pluginRoot?: string;
}

/** 一轮的结果 = **一条 Fact**。⛔ 不再另出一个 record 形状：一次性路径与常驻循环若各写各的
 *  形状到同一个载体，读者就要在一个文件里分辨两套 schema（本仓库已在 verification-round 上
 *  付过这个代价）。统一信封 = computeRoundRecord({facts:[fact]})，明细全在 fact.value 里。 */
export interface MetaRoundResult {
  fact: Fact<Record<string, unknown>>;
}

/** 跑一轮：读数（机械，总是跑）→ 语义判读（可关）→ 提案过闸落地 → 出 Fact + 载体记录。 */
/** 跑一轮，并把【本轮耗时】盖进 fact.value。
 *  ⛔ 语义半没有有限超时（沿用 quality-gate-driver 的裁定——一个拍脑袋的 180s 曾造成真实缺陷
 *  gap-quality-gate-driver-pool-judge-spawn-timeout）。既然不设阈值，就必须让代价【可观测】，
 *  否则「这一轮跑了多久」永远无从谈起。实测已见 134s / 175s / >900s（第三次被外部 timeout 900
 *  杀掉）⇒ 分布重尾；常驻化前先靠这组读数说话，⛔ 不凭空定超时。 */
export async function runMetaRound(opts: MetaRoundOptions): Promise<MetaRoundResult> {
  const startedMs = Date.now();
  const r = await runMetaRoundInner(opts);
  const value = (r.fact.value ?? {}) as Record<string, unknown>;
  return { fact: { ...r.fact, value: { ...value, durationMs: Date.now() - startedMs } } };
}

async function runMetaRoundInner(opts: MetaRoundOptions): Promise<MetaRoundResult> {
  const { root, focus, noLlm, k, dryRun } = opts;
  const at = ts();
  let readings: MetaRoundReadings;
  try {
    readings = await collectReadings(root, focus);
  } catch (e) {
    const reason = `readings failed: ${(e as Error).message}`;
    // 采读数途中失败也要结算——⛔ 不能因为异常路径就把共享检出留在脏状态。
    try { settleEvidenceWrites(root); } catch { /* 结算失败不致命 */ }
    return {
      fact: { name: "meta-driver", value: { phase: "readings" }, state: "failed", reason },
    };
  }

  // 读数已采完（criterion 全跑过），立刻结算 evidence 写入：只有时间戳变的还原，真变的保留。
  // ⛔ 放在这里而不是函数末尾：语义半可能很慢（实测 134–175s），那段时间不该让共享检出脏着。
  const settlement = settleEvidenceWrites(root);

  const base = {
    goalCount: readings.goals.length,
    criterionCount: readings.criteria.length,
    divergenceCount: readings.divergences.length,
    divergences: readings.divergences,
    // 生态读数进 fact.value：--no-llm 是零成本观测路径，它必须能看见这些
    // （否则"driver 停摆/同步在失败"只能靠烧 LLM 才看得到）。
    drivers: readings.drivers,
    syncHealth: readings.syncHealth,
    // 寄给它的消息也必须进记录：否则「这个入口有没有被消费」在生产载体上不可见。
    // （实测 2026-09-06：加了 addressedTasks 读数却漏了记录处，把「字段缺失」误读成「命中 0 条」。）
    metaRecords: readings.metaRecords,
    // 时序派生信号也进记录（DoD1：生产载体上可见——⛔ 不以单测绿充当完成）。count 进记录但⛔ 不进
    // digest（digest 只取 crossed 位），故「count 递增、未越阈」的轮摘要不变、不烧 LLM。
    timeSeries: readings.timeSeries,
    // 第七类读数也进记录（DoD：生产载体上可见、且「无越阈项」与「语料读不到」在记录上可区分）：
    // state 三态 + aggregates 全清单（含计数）。⛔ 计数进记录、不进 digest——digest 只取越阈签名。
    actionRecordFailures: readings.actionRecordFailures,
    // 停放读数也进轮记录（gap-meta-scanparkingboard）：⛔ 只在 collectReadings 里返回而不落记录，
    // 「这个入口有没有被消费」在生产载体上就不可见（同 metaRecords 那条实测教训）。计数进记录、
    // ⛔ 不进 digest（digest 只取点名清单与未评估位，见 readingsDigestPartsForParking）。
    parking: readings.parking,
    // 结算处置进读数：evidenceKept 非空 = 本轮真有 verdict 变化（有信息，待提交）；
    // 全 restored = 本轮只是刷新了时间戳（无信息）。这让「观测的副作用」自身可观测。
    evidenceRestored: settlement.restored.length,
    evidenceKept: settlement.kept,
    evidenceSkipped: settlement.skipped,
    // 记录里写【本轮实际生效的】focus（文件覆盖段，或 CLI --focus 覆盖它时是 CLI 值），
    // ⛔ 不是 destructured 的 CLI focus（常驻场景恒 null，会让「人编辑了覆盖段」在载体上不可见）。
    focus: readings.focus,
  };

  // 摘要在机械半就算出来并输出：它是触发闸的输入，必须能被【不花 LLM 的一次调用】观测到
  // （否则"摘要在真实数据上是否稳定"这个最容易坏的性质只能靠烧 LLM 来验）。
  const digest = readingsDigest(readings);

  if (noLlm) {
    return {
      fact: { name: "meta-driver", value: { ...base, semantic: "mechanical-only", digest, readings: readings.criteria }, state: "verified", reason: `mechanical-only (${readings.divergences.length} divergences, digest ${digest})` },
    };
  }

  // 事件触发闸：读数没变且没到地板 ⇒ 不派语义半（同一输入重复派 LLM 是纯烧钱；实测两轮
  // 生产读数完全相同）。⛔ 「跳过」有独立取值，不与「判读过」同形（硬规则 3b）。
  const state = readState(root);
  const gate = shouldJudge({ digest, state, focus, now: Date.now(), floorMs: opts.judgeFloorMs ?? JUDGE_FLOOR_MS_DEFAULT });
  if (!gate.judge) {
    return {
      fact: { name: "meta-driver", value: { ...base, semantic: "skipped-unchanged", digest, skipReason: gate.reason }, state: "verified", reason: `semantic half skipped: ${gate.reason}` },
    };
  }

  let objective: string;
  try {
    objective = readProbeSpec("meta-driver", opts.pluginRoot ?? path.join(root, "plugin")).objective;
  } catch (e) {
    const reason = `probe spec unavailable: ${(e as Error).message}`;
    return {
      fact: { name: "meta-driver", value: { ...base, digest }, state: "not-evaluated", reason },
    };
  }

  const prompt = buildProbePrompt(objective, readings, { root });
  // ⛔ prompt 走 **stdin** 而不是 argv：本轮的 readings JSON 实测可达 >1 MB，作为单个 argv 元素
  //    必然撞 Linux `MAX_ARG_STRLEN`（128 KiB）⇒ `spawn E2BIG`，语义半每轮必死
  //    （gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen）。promptViaStdin 只影响本条路径，
  //    其它调用点的 argv 逐字不变。probeArgv 测试缝存在时不改（它自带完整 argv 语义）。
  const argv = opts.probeArgv ? opts.probeArgv(prompt) : launchArgv("meta-driver", prompt, root, { promptViaStdin: true });
  const promptViaStdin = !opts.probeArgv;
  // FILE-ONLY 守卫的前照：spawn 期间 tracked 文件不得被改动（见 probeWriteViolations 上方说明）。
  const beforeChanges = snapshotTrackedChanges(root);
  // ⛔ 语义半不设有限超时：成本结构未实测前不设阈值（硬规则 4 推论一）。v0 是手工触发，
  //    外部 ctrl-c 是兜底；固化成常驻例程前必须先拿到实测耗时再定这个数。
  const r = await runAsync(argv, { timeoutMs: Infinity, collectStderr: true, stdinData: promptViaStdin ? prompt : undefined });
  if (r.error) {
    const reason = `probe spawn error: ${r.error.message}`;
    return { fact: { name: "meta-driver", value: { ...base, digest }, state: "not-evaluated", reason } };
  }
  // FILE-ONLY 守卫的后照 + 判定。违约 ⇒ fail-closed：不解析、不落任何东西。
  const violations = probeWriteViolations(beforeChanges, snapshotTrackedChanges(root));
  if (violations !== null && violations.length > 0) {
    const reason = `probe 违约：spawn 期间改动了 ${violations.length} 个 tracked 文件（${violations.slice(0, 5).join(", ")}）⇒ 本轮不落任何提案/决策/任务`;
    return { fact: { name: "meta-driver", value: { ...base, digest, probeWroteFiles: violations }, state: "failed", reason } };
  }

  const parsed = parseProbeOutput(r.stdout);
  if (!parsed) {
    const reason = `unparseable probe output (exit ${r.status})`;
    return { fact: { name: "meta-driver", value: { ...base, digest }, state: "failed", reason } };
  }

  // 逐条三态判定：probe 的 metaRecordOpinions 与真实 meta 记录对齐（⛔ 只有语义半真跑了才有）。
  const metaRecordOpinions = resolveMetaRecordOpinions(readings.metaRecords, parsed.metaRecordOpinions);
  // 答复写回：内嵌在同一条 meta 记录上（问与答同一对象）、翻 answered。⛔ 只在非 dry-run 写
  // （dry-run 不许落盘——与提案/决策/autoDrive 的 dry-run 语义一致）。
  const metaReplies = dryRun ? [] : writeMetaReplies(root, metaRecordOpinions);

  const records = await listGoalRecords(root);
  const activeGoalIds = new Set(readings.goals.map((g) => g.id));
  const filed = await fileProposals(root, parsed.proposals, records, { k, activeGoalIds, dryRun });
  const acceptedIds = filed.filter((f) => f.accepted).map((f) => f.id);
  // 自动驱动：每轮至多 1 条（⛔ 比提案更严——立案会被自动晋升并派发）。
  // concurrency-default-fallback: 每轮 auto-drive 至多 1 条是语义上限（轮内立案密度控制），非机器规格依赖。
  const driven = await driveItems(root, parsed.autoDrive, readings, { cap: 1, dryRun, at });
  const drivenIds = driven.filter((d) => d.accepted).map((d) => d.id);
  // 决策也必须被【路由】到 draft GOAL（⛔ 不许停在一个只打印的字段里）。
  // concurrency-default-fallback: 每轮 decisions 至多 2 条是语义上限（轮内决策密度控制），非机器规格依赖。
  const decided = await fileDecisions(root, parsed.decisions, readings, records, { cap: 2, dryRun, at });
  const decidedIds = decided.filter((d) => d.accepted).map((d) => d.id);
  // 判读成功才推进状态：失败/解析不了的轮不写 state ⇒ 下一轮仍判为「该判读」，⛔ 不会因
  // 一次失败就把这批读数当成"已判过"而永久跳过。
  if (!dryRun) writeState(root, { digest, lastJudgedAt: new Date().toISOString() });

  const value = {
    ...base,
    // 逐条三态判定：对每一条 meta 记录落 metaId + 三态。⛔ 不进 base——它由 probe 输出派生，
    // 只有语义半真跑了才有（进 base 会让 no-llm/skipped 路径也带一个恒空字段，与「未评估」混同）；
    // ⛔ 不进 readingsDigest——判定每轮可变，进摘要会让变化检测闸恒为真（AC 判据）。
    metaRecordOpinions,
    // probe 原始产出条数（对齐前的裸计数）——「入口有没有被消费」在载体上可观测，⛔ 不是对齐后的条数。
    metaRecordOpinionsOffered: parsed.metaRecordOpinions.length,
    // 答复写回的结果（逐条留痕，⛔ 不只报总数）：哪些消息被答复、答复文本、写回是否成功。
    metaReplies,
    // ⚠️ 此前这里只写【条数】，20 条解读本身全部丢弃。实测 2026-09-06：5 个判决轮共产出
    // 100 条解读，无一落痕——它们烧了 LLM 时间却不留任何痕迹，比"只被打印"更彻底
    // （probe 规格自己写着：只被打印的观察与从未做过的观察不可区分；只留计数连打印都没有）。
    // 后果具体可见：7 条 pass-but-unflipped（AC-170..176，判据实跑 pass 而记录未翻 achieved）
    // 被连续报了 26 轮无人处理——因为"该翻哪一条、为什么"这句话每轮都被扔掉了。
    // ⊢ 同一形状在本文件出现过第二次（evidenceRestored 只留数字而 kept/skipped 留清单）：
    //   占主导的那一桶反而不可枚举。硬规则 3「枚举，不布尔」的计数版变体。
    interpretations: parsed.divergences,
    interpretationCount: parsed.divergences.length,
    proposalsOffered: parsed.proposals.length,
    proposalsAccepted: acceptedIds.length,
    acceptedIds,
    autoDriveOffered: parsed.autoDrive.length,
    autoDriveFiled: drivenIds,
    autoDrive: driven,
    decisionsOffered: parsed.decisions.length,
    decisionsRouted: decidedIds,
    decisions: decided,
  };
  return {
    fact: { name: "meta-driver", value, state: "verified", reason: `${readings.divergences.length} divergences, ${acceptedIds.length}/${parsed.proposals.length} proposals, ${drivenIds.length}/${parsed.autoDrive.length} auto-driven, ${decidedIds.length}/${parsed.decisions.length} decisions routed` },
  };
}

/** 追加一条轮记录（载体写失败不致命——⛔ 不因日志炸轮）。 */
export function appendRoundSafe(root: string, record: Record<string, unknown>): void {
  try {
    const file = path.join(root, ROUND_CARRIER_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  } catch { /* 载体写失败不致命 */ }
}

// ── 常驻形态（例程） ──────────────────────────────────────────────────────────────────────────────

/** 控制态文件（与 quality 分开——⛔ 共用会让一个 kind 的 halt 误停另一个）。 */
export const META_CONTROL_STATE_REL = path.join(".quay", "meta-control.json");

/** 本 driver 的例程集：**只此一条**。复用 quality-gate-driver 里那个【已经通用的】例程型常驻
 *  循环（收 RoutineSpec[]、评估 due、汇 Facts、写轮记录），⛔ 不再抄一份 95 行样板——
 *  SPEC §4 正是要消灭那种逐 kind 重复。 */
export function metaDriverRoutines(root: string, opts: {
  reviewIntervalMinutes: number;
  k: number;
  judgeFloorMs: number;
  focus?: string | null;
}): RoutineSpec[] {
  return [{
    name: "meta-review",
    schedule: { kind: "interval", minutes: opts.reviewIntervalMinutes },
    run: async () => {
      // 常驻轮永不 dry-run：提案要真落盘（落盘即 draft，构造上惰性）。
      const { fact } = await runMetaRound({
        root, focus: opts.focus ?? null, noLlm: false, k: opts.k, dryRun: false, judgeFloorMs: opts.judgeFloorMs,
      });
      return [fact];
    },
  }];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "meta-driver.ts — 机制演进的观测/提案例程（机械读数 + 语义判读 + draft 提案）",
  "",
  "Usage: node --experimental-strip-types plugin/scripts/meta-driver.ts [options]",
  "  --root <dir>      仓库根（缺省 cwd）",
  "  --once            跑一轮后退出（手工检视用；⛔ 缺省是【常驻】，与 quality 等例程型 kind 一致）",
  "  --no-llm          只跑机械半（读数 + divergence），不派语义 probe",
  "  --focus \"<text>\"  一次性人工干跑（--once）时的显式方向，进 prompt；⛔ 常驻驱动收不到这个参数",
  "                    ——常驻的人给方向通道是 orchestration/meta-driver-focus.md 覆盖段（每轮现读）",
  "  --k <N>           本轮提案上限（缺省 " + DEFAULT_RATE + "，routine-file-gate 的 rate 闸）",
  "  --dry-run         提案过闸但不写盘（也不推进变化检测状态）",
  "  --judge-floor <m> 语义半的定时器地板（分钟，缺省 1440=24h）——安全网非调优阈值：",
  "                    读数变了/给了 --focus 就会判读；地板只防「摘要恒不变 ⇒ 永不再判」",
  "  --json            输出 JSON（缺省人读摘要）",
  "  --scan-action-records",
  "                    只跑第七类读数的【语料扫描】并落缓存载体，不跑整轮（运维/定时刷新入口）。",
  "                    ⚠️ 实测 ≥15 分钟（quay 语料 5513 文件 / 3.93 GB）；这是唯一会真扫语料的入口，",
  "                    轮内自动扫描由 .quay/config.yml 的 action_record_failures.scan_ttl 决定。",
  "",
  "常驻（例程型，复用通用循环）:",
  "  --resident            常驻跑（**已是缺省**，保留仅为显式表达；一次性用 --once）",
  "  --interval <ms>       循环滴答间隔（缺省 " + defaultDriverConfig().meta.intervalMs + "，来自 drivers.yml meta.interval_ms）",
  "  --review-interval <m> meta 复核的例程间隔（分钟，缺省 20）",
  "  --run-id <id> / --pid-file <p> / --max-rounds <n>",
  "",
  "Exit: 0 = 轮跑完（含 not-evaluated）; 1 = 轮失败; 2 = usage",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root = process.cwd();
  let focus: string | null = null;
  let noLlm = false;
  let dryRun = false;
  let json = false;
  let k = DEFAULT_RATE;
  let judgeFloorMs = JUDGE_FLOOR_MS_DEFAULT;
  let once = false;
  // ⛔ 不写字面量缺省（硬规则 4 推论二）：缺省在本函数尾部经 loadDriverConfig 现读 drivers.yml，
  // 与 goal/quality 同款——本字段此前是硬编码 30_000，drivers.yml 的 meta.interval_ms 零消费者。
  let intervalRaw: string | undefined;
  let reviewIntervalMinutes = 20;
  let runId = `meta-${Date.now()}`;
  let pidFile: string | undefined;
  let maxRounds: number | null = null;
  let scanActionRecordsOnly = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") { root = args[++i]; }
    else if (a === "--focus") { focus = args[++i] ?? null; }
    else if (a === "--k") { k = Number(args[++i]); }
    else if (a === "--judge-floor") { judgeFloorMs = Number(args[++i]) * 60_000; }
    else if (a === "--no-llm") { noLlm = true; }
    else if (a === "--dry-run") { dryRun = true; }
    else if (a === "--json") { json = true; }
    else if (a === "--once") { once = true; }
    else if (a === "--resident") { /* 常驻已是缺省（见下），保留旗标以便显式表达与向后兼容 */ }
    else if (a === "--interval") { intervalRaw = args[++i]; }
    else if (a === "--review-interval") { reviewIntervalMinutes = Number(args[++i]); }
    else if (a === "--run-id") { runId = args[++i]; }
    else if (a === "--pid-file") { pidFile = args[++i]; }
    else if (a === "--max-rounds") { maxRounds = Number(args[++i]); }
    else if (a === "--scan-action-records") { scanActionRecordsOnly = true; }
    else if (a === "--help" || a === "-h") { process.stdout.write(HELP + "\n"); return 0; }
    else { process.stderr.write(`meta-driver: unknown argument: ${a}\n${HELP}\n`); return 2; }
  }
  if (!Number.isFinite(k) || k < 1) { process.stderr.write("meta-driver: --k must be a positive number\n"); return 2; }
  if (!Number.isFinite(judgeFloorMs) || judgeFloorMs < 0) { process.stderr.write("meta-driver: --judge-floor must be a non-negative number of minutes\n"); return 2; }
  // 循环滴答间隔：显式 --interval 优先，否则现读 drivers.yml meta.interval_ms（AC155 单一真相源；
  // 与 goal-driver / quality-gate-driver 的解析形状逐字对齐）。
  const intervalMs = intervalRaw !== undefined && /^\d+$/.test(intervalRaw)
    ? Number(intervalRaw)
    : loadDriverConfig(root).meta.intervalMs;

  // 第七类读数的【语料扫描】单独入口：成本 ≥15 分钟，⛔ 不该藏在整轮里被隐式触发。
  // 这是运维/定时的刷新路径；轮内自动扫描另由 config 的 scan_ttl 决定（见 collectActionRecordFailures）。
  if (scanActionRecordsOnly) {
    const cfg = readActionRecordConfig(root);
    const binary = locateMetaCcMcp();
    if (!binary) { process.stderr.write("meta-driver: meta-cc-mcp not found (set QUAY_META_CC_MCP)\n"); return 1; }
    process.stderr.write(`meta-driver: scanning action records via ${binary} (root=${root}, window=${cfg.windowMs ?? "all"}ms)…\n`);
    const r = await scanActionRecords(root, cfg, { binary });
    if (!r.ok) { process.stderr.write(`meta-driver: action-record scan failed: ${r.reason}\n`); return 1; }
    // 扫描面照出清单（成本旋钮）；`min_sessions` 未配置时 `crossed` 全为 null、state=unthresholded
    // （判断旋钮）——⛔ 不在这里替人定一个数（硬规则 4 推论一/二）。
    const agg = aggregateActionFailures(r.scan.records, { minSessions: cfg.minSessions, scannedAt: r.scan.scannedAt, scanMs: r.scan.scanMs, since: r.scan.since });
    process.stdout.write(JSON.stringify({
      ok: true, carrier: ACTION_RECORD_SCAN_REL, scannedAt: r.scan.scannedAt, scanMs: r.scan.scanMs,
      since: r.scan.since, extractor: r.scan.extractor, records: r.scan.records.length,
      state: agg.state, thresholdSessions: agg.thresholdSessions,
      aggregates: agg.aggregates,
    }, null, 2) + "\n");
    return 0;
  }

  // 常驻是【缺省】，与兄弟例程型 kind 对齐（quality-gate-driver.ts main() 也是无条件进常驻循环）。
  //
  // ⚠️ 生产实测（2026-09-06）：此前缺省是一次性、常驻要 `--resident`，而 `driverArgvForKind`
  // （driver-runtime.ts:365-377）拼的 argv 只有 --root/cap/--interval/--pid-file/--run-id，
  // **不传 --resident** ⇒ `quay driver start --kind meta` 起的是一次性模式 ⇒ 跑一轮 exit 0 ⇒
  // supervisor 5 秒后重启 ⇒ 20 分钟的复核间隔完全失效，退化成 ~38 秒的忙循环：
  // 35 分钟内 23 轮 × 24 条 criterion ≈ 550 次子进程调用，而设计意图是约 2 轮。
  // （lastRun 是进程内存态，每次重启都 never-ran ⇒ 必然立刻 due，间隔无从生效。）
  // ⊢ 这是 SPEC §7「半登记」损害的第三例（quality 补接线、suite 半登记、本次 meta）。
  // ⊢ 修法是【跟随兄弟实现】而非给 driverArgvForKind 再加一个 per-kind 旗标——后者正是 §7 在说的那种成本。
  // 手工一次性检视仍可用 `--once`；`--json`/`--dry-run` 隐含一次性（一次性的输出形态，⛔ 不该进无限循环）。
  const oneShot = once || json || dryRun;
  if (!oneShot) {
    // 常驻：复用通用例程型循环，配自己的控制面与载体（⛔ 不与 quality 共用控制面）。
    return await runResidentQualityGateLoop({
      root, intervalMs, once: false, maxRounds,
      roundLogFile: path.join(root, ROUND_CARRIER_REL),
      runId, json, pidFile,
      kind: "meta",
      controlStateRel: META_CONTROL_STATE_REL,
      routines: metaDriverRoutines(root, { reviewIntervalMinutes, k, judgeFloorMs, focus }),
    });
  }

  const { fact } = await runMetaRound({ root, focus, noLlm, k, dryRun, judgeFloorMs });
  // ⛔ dry-run 也要留痕：「跑了一轮、什么都没提」正是最该被记录的情形——不记则「跑过」与
  // 「没跑过」在载体上同形，本例程的沉默就不可被检测（硬规则 9）。dryRun 进记录，不进条件。
  // 信封与常驻轮【完全相同】（computeRoundRecord），避免同一载体两套 schema。
  const record = {
    ...computeRoundRecord({ round: 0, runId, pid: process.pid, at: new Date().toISOString(), facts: [fact] }),
    dryRun,
  };
  appendRoundSafe(root, record);

  if (json) {
    // 输出【与载体逐字同一个对象】——⛔ 不另拼一份，否则 stdout 与载体会各说各话。
    process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  } else {
    const v = (fact.value ?? {}) as Record<string, unknown>;
    process.stdout.write(`meta-driver [${fact.state}] ${fact.reason}\n`);
    if (Array.isArray(v.divergences)) {
      for (const d of v.divergences as Divergence[]) {
        process.stdout.write(`  divergence ${d.kind}: ${d.id} (status=${d.status}, verdict=${d.verdict})\n`);
      }
    }
    if (Array.isArray(v.acceptedIds) && (v.acceptedIds as string[]).length > 0) {
      process.stdout.write(`  filed as draft: ${(v.acceptedIds as string[]).join(", ")}\n`);
    }
    for (const d of (v.decisions as DecisionResult[] | undefined) ?? []) {
      process.stdout.write(`  decision ${d.accepted ? d.id : "REJECTED"}: ${d.item.title} — ${d.reason}\n`);
      // ⛔ 被拒的决策不得静默消失：轮记录写在 gitignored 的载体里，若只落那儿，一个被闸误杀的
      // 方向问题就again 无人知晓（正是本通道要消灭的死胡同，只是下沉了一层）。此处显式提示
      // 它需要人看一眼——闸可能是错的（实测已发生过一次：质量判据用错了对象）。
      if (!d.accepted) {
        process.stdout.write(`      ⚠️ 该决策未被路由，问题本身仍未解决——若闸判错，修闸而不是重提\n`);
      }
    }
  }
  return fact.state === "failed" ? 1 : 0;
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// expectedBase ⇒ 恒为真 ⇒ 被 import 时就跑一整轮（实测：单测 import 即真调 goal-store 并派 LLM）。
if (isDirectEntry(import.meta, undefined, "meta-driver")) {
  main(process.argv).then((c) => { process.exitCode = c; });
}
