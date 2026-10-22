// worker-fan-in.ts — 机械 fan-in 子系统（从 worker-driver.ts 抽出）。
//
// 出处：tasks/gap-arch-worker-fan-in-extract-from-worker-driver，依据
// docs/analysis/worker-driver-decomposition-investigation.md §AC4 第一期（「只拆到 R15 为止」）。
//
// 职责：driver 接手 worker 的 worktree，机械跑 fan-in 的机械部分——锁 / merge develop / delta 判定 /
// ts-typecheck / scoped 门 / 全量 suite / ff merge。happy-path 由 driver 机械驱动（人 2026-08-27 裁定①），
// 失败回退旧 fan-in-execute workflow 子代理兜底（语义兜底）。⛔ 本模块不做任何 LLM 判断、⛔ 不 spawn worker。
//
// 抽出的边界 = 区域本体 + 随区域一并迁入的三类符号（它们的唯一或主要消费者在区域内，若留在
// worker-driver.ts 则本模块必须反指它 ⇒ 值环；任务 AC4 明禁）：
//   ① 区域本体 —— 锁事件 / 步骤 trace / suite 日志与 runId / scoped-gate 缓存 / runMechanicalFanIn /
//      spawnMechanicalFanIn / mirrorMechanicalFanInSuiteState；
//   ② scoped 门 + doc-check 命令解析（resolveScopedGateCommand / scopedGateCommandFor /
//      resolveDocCheckCommand / docCheckCommandFor / readLoopFanInContract 及私有 shq /
//      readLoopSection / readLoopTestCommand / readLoopTestOutput）——
//      「本项目声明了什么能力」的单一真相源，fan-in 执行侧与 worker prompt 侧共用
//      （gap-driver-fanin-hardcoded-test-sh-third-party / gap-worker-premerge-scoped-gate-cache）；
//      ⛔ 判据是 `.quay/config.yml` 的显式声明，**不是任何文件是否存在**
//      （gap-repo-shape-inferred-from-test-sh-existence / GOAL-027 / AC-316）；
//   ③ kernel sibling 运行 argv 前缀（kernelSiblingArgv）与 worker 侧 scoped-gate 缓存写入签名
//      （scopedGateCacheWriteSignature，派生自 workerDriverSelfArgv）—— 机械 fan-in 的 suite / spawn 与
//      缓存写入两条路径共用同一入口（AC152 同族：⛔ 不各写一份 .ts/.js 回退）；
//   ④ ff-merge Core 模块加载（loadFfMergeModule）与仪器可用性摘要（instrumentSummary）—— 区域独占
//      （唯一消费者是 fan-in 的 step 6.9 仪器探针与 step 9 ff）。
//
// 反向依赖为零：本模块 ⛔ 不 import worker-driver.ts（否则即值环，任务 AC4）。worker-driver.ts 对本模块的
// 导出改 re-export，保持既有 test 文件的 import 面逐字不变（任务 AC2）；其中 worker-driver.ts 仍需【直接
// 调用】的少数符号（computeLandingState 之外的 runMechanicalFanIn / spawnMechanicalFanIn /
// scopedGateCacheWriteSignature / resolveScopedGateCommand / appendCompleteGateEvent / scopedGateKey /
// writeScopedGateCache / MechanicalFanInResult）另经普通 import 取——`export { … } from` 不建立本地绑定。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import {
  runAsync,
  resolveKernelSibling,
  resolveKernelScriptsDir,
  resolveKernelPluginRoot,
  resolveKernelShellSibling,
  resolveQuaySrcModule,
  ensureWorktreeNodeModules,
  snapshotQuayDirInto,
} from "./driver-runtime.ts";
import { spawnSuiteAndWait, type SuiteOutcome, type SuiteRunResult } from "./suite-driver.ts";
import { suiteLockBase } from "./suite-lock-slots.ts";
// SPEC-goal-branch-2026-10-03 §4.6：goal 分支有【自己的】fan-in 锁（裁定⑥），锁文件名是派生量——
// `goal/<GOAL-NNN>` → `fan-in.goal-<GOAL>.lock`。goalIdFromBranchToken 是「该 token 是不是 goal 分支、
// 叫什么 GOAL」的单一实现（与 §4.8 身份检查同源，⛔ 不写第二份正则）。budget-model.ts 是 leaf（只
// import node 内建），无反向边。
import { goalIdFromBranchToken, goalBranchName, goalBranchRefExists } from "../../packages/quay/src/core/branch-model.ts";
// SPEC-goal-branch-2026-10-03 §4.7 (裁定⑫⑲⑳): the goal→develop merge executor is the worker-driver
// (DIR-131). The REQUEST/RESULT event shapes + the derived-pending reader live in Core (ONE definition,
// shared with `quay goal merge` and the tests); ⛔ this module never re-declares them.
import {
  GOAL_MERGE_RESULT_GATE,
  type GoalMergeRequest,
} from "../../packages/quay/src/goal-merge.ts";
// gate-script-base 是叶子（只 import node 内建）——⛔ 不成环。normalizeRel 供本文件的 suite 日志
// 失败行解析（自 worker-driver.ts 迁入，见该簇的注释）。
import { normalizeRel } from "./gate-script-base.ts";
import { computeDocCheckFaceKey, readDocCheckCache, writeDocCheckCache, readGreenCache, writeGreenCache } from "./doc-check-cache.ts";
import type { GreenCacheEntry } from "./doc-check-cache.ts";
import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "./mirror-full-suite-state.ts";
import { defaultLaneCount, readLoadAvg, passedFileSet } from "./full-suite-runner.ts";
import { SUITE_LOG_NOT_RUN_PREFIX, SUITE_LOG_RUN_START_PREFIX, SUITE_LOG_INCOMPLETE_PREFIX, SUITE_LOG_PLAN_PREFIX } from "./full-suite-runner.ts";
import { buildPreVerifiedRoundRecord, appendPreVerifiedRound } from "./pre-verified-round-record.ts";
import { splitTaskFile, statusFromFrontmatter, patchStatusField, commitTaskFile } from "./task-ops.ts";
// ADR-007's PER-MILESTONE predicate at the mechanical flip (gap-mechanical-fan-in-flip-bypasses-
// adr007-dark-axis-predicate). ⛔ NOT a second implementation: `classifyDarkAxisRecord` is Core's
// single judgment and `taskBodyOf` is the CLI's single frontmatter stripper — the module below is
// the very file the standalone CLI lives in, so the two faces cannot drift. The workspace switch is
// `workspaceEnforcesDarkAxis` (lifecycle.ts), the SAME `gates.adr` declaration the ready→done verbs
// use — no new config surface.
import {
  classifyDarkAxisRecord,
  taskBodyOf,
  type DarkAxisVerdict,
} from "./dark-axis-record-check.ts";
import { workspaceEnforcesDarkAxis } from "../../packages/quay/src/gate/lifecycle.ts";
// gap-task-status-events-contract-v1: the fan-in's FOUR status writes (ready→done, the done→ready
// "未落地" reset, the re-flip after it, and the goal-branch doc-face done) now emit the kernel's v1
// transition event. Before this task the fan-in wrote ZERO events — the largest measured coverage
// hole (139 ready→done transitions in the reading window, 0 events). ⛔ The writer is imported, never
// re-implemented here.
import { appendTaskStatusEvent, edgeKindFor, gitBlobSha } from "../../packages/quay/src/kernel/task-transition.ts";
import { fetchTaskStatusAtRef } from "./task-schema.ts";
// B2 (SPEC-goal-branch-2026-10-03 §5): the doc-face write path — main-checkout commit +
// propagateDocBranchToDevelop (ff-only + semantic fallback). Importing it (⛔ not re-implementing
// the push/semantic-fallback machinery) is safe for the import-graph ratchet: driver-filters.ts
// does not reach back to this module, so this is not an SCC edge.
import { propagateDocBranchToDevelop } from "./driver-filters.ts";
// ⛔ `import type`（编译期擦除）——运行期符号仍经 loadFfMergeModule 的动态 import 取（见其注释）；若改成
// 值 import，Core 源码树字面量就会以【静态边】进入本 kernel 的 bundle，而它必须仍由 coreSrcAliasPlugin
// 按同一处 specifier 内联。
import type { InstrumentProbe } from "../../packages/quay/src/fan-in/ff-merge.ts";

/** 单引号 shell 转义（第三方 test_command 需 `cd <worktree> && <test_command>` 在工作树内跑——worktree
 *  路径可能含空格/特殊字符，⛔ 不裸拼）。 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 读 <dir>/.quay/config.yml 的 `loop:` 映射（缺失/不可解析/非对象 ⇒ null）。本文件三个 loop 读面
 *  （test_command / test_output / fan-in 契约）共用这一处 YAML 读法，⛔ 不各写一份解析。⛔ 不依赖
 *  packages/quay/src/config.ts（第三方安装物可能无 packages/ 树）——直接 YAML 读，与 driver-config.ts
 *  同法。 */
function readLoopSection(dir: string): Record<string, unknown> | null {
  const file = path.join(dir, ".quay", "config.yml");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return null;
  }
  const loop = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).loop : undefined;
  return loop && typeof loop === "object" && !Array.isArray(loop) ? (loop as Record<string, unknown>) : null;
}

/** 读 <dir>/.quay/config.yml 的 loop.test_command（项目 quay-init --loop 写入的全量测试命令，如
 *  `node --test`）。缺失/不可解析/非字符串 ⇒ null。 */
function readLoopTestCommand(dir: string): string | null {
  const cmd = readLoopSection(dir)?.test_command;
  return typeof cmd === "string" && cmd.trim() ? cmd.trim() : null;
}

/** gap-verification-round-bound-to-quay-shaped-suite-entry AC5 — 读 <dir>/.quay/config.yml 的
 *  `loop.test_output`：目标项目【自己声明】的测试输出约定（{字段: 正则，恰好一个捕获组}，字段 ∈
 *  pass/fail/cancelled/tests）。quay 依声明从 suite 日志解析计数并落台账，⛔ 不把输出格式写死成 quay
 *  自己的 node:test/measure-reporter 形状（人 2026-09-12 裁定：「只让入口可配而输出解析仍写死，是换了
 *  一个位置的同一个病」）。
 *
 *  读面只做形状校验（值为非空字符串的已知字段；未知字段/非法类型丢弃）——正则能否编译/匹配由 writer
 *  侧 fail-closed 处理（不匹配 ⇒ 该字段缺席，⛔ 不伪造 0）。无有效声明 ⇒ null（调用方退回内建解析，
 *  本仓库形态零回归）。与 readLoopTestCommand 同一 YAML 读法（⛔ 不依赖 packages/quay/src/config.ts）。 */
export function readLoopTestOutput(dir: string): Record<string, string> | null {
  const decl = readLoopSection(dir)?.test_output;
  if (!decl || typeof decl !== "object" || Array.isArray(decl)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(decl as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 一个能力的声明状态——**三态可分**（硬规则 3b）：declared（读到有效值）/ absent（未声明）/
 *  invalid（声明了但读不懂，原文留在 raw 里供点名）。⛔ invalid 不得与 absent 同形：那会把「用户想跑
 *  但配置写错」静默降级成「这个项目没有该能力」——正是本缺陷的形态。 */
export type CapabilityDecl<T> =
  | { state: "declared"; value: T }
  | { state: "absent" }
  | { state: "invalid"; raw: string };

/** `.quay/config.yml` `loop:` 下**显式声明**的 fan-in 契约（GOAL-027 / AC-316 的读面）。
 *
 *  本模块此前按「worktree 里有没有 `scripts/test.sh`」推断「这是不是本仓库形态」——第三方项目只要按
 *  `loop.test_command` 的约定交付了自己的 `scripts/test.sh`，就被整体当成 quay 仓库，随后 scoped 门 /
 *  doc-check / suite 调度逐项对不上，而每一处对不上都表现为「读不出东西」而不是报错（硬规则 3b）。
 *  现在：**声明了 ⇒ 用；没声明 ⇒ 独立的「未提供」取值**；声明了但读不懂 ⇒ 第三态，fail-closed。
 *  ⛔ 判据不再是任何文件是否存在。 */
export interface LoopFanInContract {
  /** `suite_runner`: `quay-buckets`（经 full-suite-runner.ts 跑 bucket 协议）| `delegated`（用本项目自己的
   *  `loop.test_command` 跑全量）。未声明 ⇒ delegated 当且仅当 testCommand 有声明，否则无测试能力
   *  fail-closed。 */
  suiteRunner: CapabilityDecl<"quay-buckets" | "delegated">;
  /** `scoped_command`: scoped 门的 argv 模板（`{worktree}` / `{task}` 占位符）。未声明 ⇒ 该能力「未提供」。 */
  scopedCommand: CapabilityDecl<string[]>;
  /** `doc_check_command`: doc-check 的 argv 模板（`{worktree}` 占位符）。未声明 ⇒ 同上。 */
  docCheckCommand: CapabilityDecl<string[]>;
  /** `rerun_command`: **本轮重跑失败文件**的 argv 模板（`{worktree}` 占位符 + `{files}` 整元素占位符——
   *  该元素被失败文件列表**逐个替换**）。**项目声明**，产品代码不含任何项目知识（⛔ 不引入「按已知脆弱
   *  族分名单」的概念：那条路已于 2026-09-03 被人裁定取消）。未声明 ⇒ 该能力「未提供」（独立取值
   *  `no-rerun-command-declared`，重跑结果取 `rerun-not-evaluated`，⛔ 不与「重跑跑了且红」同形）。 */
  rerunCommand: CapabilityDecl<string[]>;
  /** `loop.test_command`：本项目声明的全量测试命令。未声明 ⇒ null。 */
  testCommand: string | null;
}

/** 读一个 argv 模板声明（逐元素非空字符串的**非空**列表 ⇒ declared；键缺席 / YAML null ⇒ absent；
 *  其它任何形状（字符串、空列表、数字元素…）⇒ invalid + 原文）。 */
function readArgvTemplate(loop: Record<string, unknown>, key: string): CapabilityDecl<string[]> {
  const raw = loop[key];
  if (raw === undefined || raw === null) return { state: "absent" };
  if (Array.isArray(raw) && raw.length > 0 && raw.every((a) => typeof a === "string" && a !== "")) {
    return { state: "declared", value: raw as string[] };
  }
  return { state: "invalid", raw: JSON.stringify(raw) };
}

/** 读 <dir>/.quay/config.yml `loop:` 里声明的 fan-in 契约。⛔ 本函数的判据【只有声明本身】——
 *  任何文件（`scripts/test.sh`、`plugin/`…）是否存在都不参与（本缺陷的根因）。 */
export function readLoopFanInContract(dir: string): LoopFanInContract {
  const loop = readLoopSection(dir) ?? {};
  const sr = loop["suite_runner"];
  let suiteRunner: CapabilityDecl<"quay-buckets" | "delegated">;
  if (sr === undefined || sr === null) suiteRunner = { state: "absent" };
  else if (sr === "quay-buckets" || sr === "delegated") suiteRunner = { state: "declared", value: sr };
  else suiteRunner = { state: "invalid", raw: JSON.stringify(sr) };
  return {
    suiteRunner,
    scopedCommand: readArgvTemplate(loop, "scoped_command"),
    docCheckCommand: readArgvTemplate(loop, "doc_check_command"),
    rerunCommand: readArgvTemplate(loop, "rerun_command"),
    testCommand: readLoopTestCommand(dir),
  };
}

/** argv 模板的占位符替换：`{worktree}` → argvDir、`{task}` → task。⛔ 逐元素整串替换——模板值是
 *  【argv 元素】，不经 shell 求值（占位符是路径，可能含空格/特殊字符，替换后仍是一个 argv 元素）。 */
function applyTemplate(argv: string[], vars: { worktree: string; task: string }): string[] {
  return argv.map((a) => a.split("{worktree}").join(vars.worktree).split("{task}").join(vars.task));
}

/** scoped-gate 命令的解析结果（gap-driver-fanin-hardcoded-test-sh-third-party）：
 *  - run   argv  — `loop.scoped_command` 声明的 argv 模板（占位符已替换）。本仓库声明的是
 *                 `bash {worktree}/scripts/test.sh --for-task {task} --allow-thin`（与迁移前逐字一致）。
 *  - skip        — 未声明 ⇒ 该项目没有 scoped 能力，fan-in 跳过 scoped 门直接进全量 suite 步骤
 *                 （可区分取值 no-scoped-command-declared，⛔ 不与「scoped 门跑了且失败」同形）。
 *  - fail        — 声明了但读不懂 ⇒ **fail-closed**（⛔ 不得静默当成 skip：那是 fail-open，硬规则 3b）。
 *  argvDir 用于替换 `{worktree}`、capabilityDir 用于读声明（execution 侧二者都 = worktree；prompt 侧
 *  capabilityDir = root、argvDir = 占位符 worktree 路径——同一 repo 二者同形，因 .quay/config.yml 随
 *  worktree 铺出）。 */
export type ScopedGateResolution =
  | { kind: "run"; argv: string[] }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; reason: string };

/** 解析 scoped-gate 命令（单一真相源，fan-in 执行侧与 worker prompt 侧共用——⛔ 两处不得出现两套
 *  标准）。 */
export function resolveScopedGateCommand(task: string, capabilityDir: string, argvDir: string): ScopedGateResolution {
  const decl = readLoopFanInContract(capabilityDir).scopedCommand;
  if (decl.state === "declared") {
    return { kind: "run", argv: applyTemplate(decl.value, { worktree: argvDir, task }) };
  }
  if (decl.state === "invalid") {
    return {
      kind: "fail",
      reason: `scoped-command-declaration-unreadable: loop.scoped_command = ${decl.raw}（须是非空字符串列表；⛔ 不静默跳过该门）`,
    };
  }
  return { kind: "skip", reason: "no-scoped-command-declared" };
}

/** 机械 fan-in 的 scoped 门缺省命令（gap-worker-premerge-scoped-gate-cache 抽成单一真相源）：
 *  `loop.scoped_command` 声明的 argv；未声明 ⇒ null（fan-in 跳过 scoped 门）。⛔ 不再是按
 *  `<worktree>/scripts/test.sh` 是否存在推断（本缺陷）；声明读不懂 ⇒ 也返回 null，由
 *  `resolveScopedGateCommand`（fan-in 与 worker prompt 实际用的三态入口）报 fail。 */
export function scopedGateCommandFor(task: string, worktree: string): string[] | null {
  const r = resolveScopedGateCommand(task, worktree, worktree);
  return r.kind === "run" ? r.argv : null;
}

/** doc-check 命名的三态解析（fan-in 的 doc-check 步用这个，⛔ 不是 `docCheckCommandFor`——后者是面向
 *  「命令构造」的简化读面，把 invalid 与 absent 都折成 null）。 */
export function resolveDocCheckCommand(capabilityDir: string, argvDir: string): ScopedGateResolution {
  const decl = readLoopFanInContract(capabilityDir).docCheckCommand;
  if (decl.state === "declared") {
    return { kind: "run", argv: applyTemplate(decl.value, { worktree: argvDir, task: "" }) };
  }
  if (decl.state === "invalid") {
    return {
      kind: "fail",
      reason: `doc-check-command-declaration-unreadable: loop.doc_check_command = ${decl.raw}（须是非空字符串列表；⛔ 不静默跳过 doc-check）`,
    };
  }
  return { kind: "skip", reason: "no-doc-check-command-declared" };
}

/** 机械 fan-in 的 doc-check 缺省命令（gap-driver-fanin-hardcoded-test-sh-third-party）：`loop.doc_check_command`
 *  声明的 argv（占位符已替换）；未声明 **或读不懂** ⇒ null。⛔ 按文件是否存在推断（本缺陷）已删除。
 *  ⚠️ 三态判定（invalid ≠ absent）由 `resolveDocCheckCommand` 提供，fan-in 用后者。 */
export function docCheckCommandFor(worktree: string): string[] | null {
  const r = resolveDocCheckCommand(worktree, worktree);
  return r.kind === "run" ? r.argv : null;
}

/** argv 模板的**文件列表**占位符替换：与 applyTemplate 同法（逐元素整串替换，⛔ 不经 shell 求值），
 *  但 `{files}` 是**整元素**占位符——那个 argv 元素被失败文件列表**逐个替换**（splice），而不是拼成
 *  一个字符串（argv 元素即一个路径；拼串会把路径切碎——那是注入面）。⛔ 嵌在字符串里的 `{files}`
 *  （如 `--files={files}`）**不**展开：形状歧义会被静默当成字面量，故本模板不定义该形态。其余元素
 *  走 `{worktree}` 替换。 */
function applyFileTemplate(argv: string[], vars: { worktree: string; files: string[] }): string[] {
  const out: string[] = [];
  for (const a of argv) {
    if (a === "{files}") out.push(...vars.files);
    else out.push(a.split("{worktree}").join(vars.worktree));
  }
  return out;
}

/** 本轮重跑命令的解析（gap-fan-in-suite-red-no-in-round-rerun-of-red-files）。⛔ 与 `ScopedGateResolution`
 *  分开：重跑**没有** fail-closed 的门语义——`not-evaluated` 是【如实】的取值（「这个项目没声明怎么按
 *  文件重跑」不是错误），调用方据此写 `rerun-not-evaluated` 并要求【suite 仍红】（⛔ 不放行）。
 *  `invalid`（声明了但读不懂）与 `absent` 在这里都落 not-evaluated，但 reason token 不同——硬规则 3b：
 *  两者的成因必须在记录上可分。 */
export function resolveRerunCommand(
  capabilityDir: string,
  argvDir: string,
  files: string[],
): { kind: "run"; argv: string[] } | { kind: "not-evaluated"; reason: string } {
  const decl = readLoopFanInContract(capabilityDir).rerunCommand;
  if (decl.state === "declared") return { kind: "run", argv: applyFileTemplate(decl.value, { worktree: argvDir, files }) };
  if (decl.state === "invalid") {
    return {
      kind: "not-evaluated",
      reason: `rerun-command-declaration-unreadable: loop.rerun_command = ${decl.raw}（须是非空字符串列表；⛔ 不静默当成「没声明」）`,
    };
  }
  return { kind: "not-evaluated", reason: "no-rerun-command-declared" };
}

/** fan-in 的 delta 判定「没判出来」哨兵：分类器非零退出（它没能给出结论）⇒ 本轮 fail-closed 跑全量
 *  suite（硬规则 3b：判不出 ≠ 不需要）。⛔ 它不是「delta 是 code」的同义词——两者的后果相同（都跑
 *  suite），但只有前者是【判决】；日志的 reason 必须能把二者分开。 */
export const CLASSIFY_FAILED = "__CLASSIFY_FAILED__";

/** 把一次 `--classify-delta` 调用映射成 fan-in 的三态 code_delta 取值（【单一定义点】——step 4 与
 *  其 4b「develop 前进面复用」判定共用，⛔ 两处不得各写一份三元式，硬规则 5b）：
 *    ""                分类器给出了结论，且 delta 全落 doc/inert 面 ⇒ 跳过全量 suite；
 *    "<path>…"         分类器给出了结论，且有 code 面 ⇒ 跑全量 suite；
 *    CLASSIFY_FAILED   分类器【没给出结论】（非零退出）⇒ 跑全量 suite（fail-closed）。
 *  第三方 worktree 过去必然落到第三者（分类器 `--root <worktree>` 找不到 quay 的检查注册表 ⇒ exit 2，
 *  生产读数：claudecodeui 177 次 delta 判定中 11 次）——分类器现在自带「声明的 loop.doc_surfaces →
 *  保守缺省」兜底，第三方也走前两者（gap-fan-in-delta-classify-declared-doc-surfaces）。 */
export function classifyDeltaOutcome(ok: boolean, stdout: string): string {
  return ok ? String(stdout ?? "").trim() : CLASSIFY_FAILED;
}

/** 解析本 kernel 的一个 shell sibling（.sh）—— 实现已上收 `driver-runtime.resolveKernelShellSibling`
 *  （单一入口，⛔ 不各写一份 basename==="dist" 上跳逻辑）。本文件经 import 消费，⛔ 不再本地复制一份。
 *  gap-promotion-driver-ready-pool-check-path-third-party：第三方项目无 plugin/scripts/，.sh 以 loose
 *  形态随包住在 scripts/ 而非 dist/。缺 ⇒ null（调用方 fail-closed）。 */

/** 解析一个 kernel sibling 脚本到运行 argv 前缀（不含 "node" 可执行名）：原始 .ts ⇒
 *  ["--experimental-strip-types", <path>]；bundled dist/*.js ⇒ [<path>]（不带 flag）。两者都不在 ⇒
 *  ["--experimental-strip-types", <resolveKernelScriptsDir()>/<name>]（spawn 时 fail-closed）。
 *  resolveKernelSibling 单一真相源（⛔ 各 spawn 点不再各自重写 .ts/.js 回退——同
 *  defaultPromotionCheckArgv 手法）。 */
function kernelSiblingArgv(name: string): string[] {
  const sibling = resolveKernelSibling(name);
  return sibling
    ? (sibling.stripTypes ? ["--experimental-strip-types", sibling.path] : [sibling.path])
    : ["--experimental-strip-types", path.join(resolveKernelScriptsDir(), name)];
}

/** worker-driver 自入口的 spawn 前缀（"node" + kernelSiblingArgv("worker-driver.ts")）。锚在本 kernel
 *  安装位置（⛔ 非 root）：原始 .ts（dev tree，带 flag）或 bundled dist/worker-driver.js（installed，
 *  不带 flag）。两者都不在 ⇒ 回退 kernelScriptsDir 下的 .ts（运行期 fail-closed）。 */
function workerDriverSelfArgv(): string[] {
  return ["node", ...kernelSiblingArgv("worker-driver.ts")];
}

/** The two ff-merge.ts (Core `packages/quay/src/fan-in/ff-merge.ts`) symbols this kernel consumes:
 *  the 持锁段 ff itself, and the instrument probe (gap-fan-in-instrument-availability-self-check).
 *  ⛔ Declared structurally rather than `import type`d so the ONE runtime specifier below stays the
 *  only place the Core source-tree layout is named — and so the two consumers cannot end up loaded
 *  from different module instances. */
interface FfMergeModule {
  ffMerge: (o: {
    task: string; root: string; mergeTarget: string; runId: string; attemptKey: string;
    worktree: string; suiteCapture: string; suiteState: string; lockWaitSecs: number;
    token: string; scriptsDir: string;
  }) => Promise<{ code: number; stdout: string; stderr: string; landedSha: string | null }>;
  probeInstruments: (root: string, scriptsDir?: string | null) => InstrumentProbe;
}

/** Load the ff-merge Core module — ONE resolution shared by BOTH its consumers (the step-9 ff and the
 *  pre-suite instrument probe). ⛔ A second copy of this specifier would let the `opts.ffMergeModule`
 *  test seam be honoured by one consumer and silently ignored by the other (the probe would then read
 *  the repo's real module while the ff read the fixture's) — hard rule 5b shape, same file, same class.
 *
 *  gap-resolve-kernel-src-module-strip-types-node-modules: production goes through the static-literal
 *  dynamic import (source-tree-relative resolution; the SHIPPED bundle inlines it via
 *  coreSrcAliasPlugin); the `opts.ffMergeModule` seam is kept for hermetic test repos whose worktree
 *  carries no `packages/quay/src`. */
async function loadFfMergeModule(override?: string): Promise<FfMergeModule> {
  const mod = override
    ? await import(/* @vite-ignore */ pathToFileURL(override).href)
    : await import("../../packages/quay/src/fan-in/ff-merge.ts");
  return mod as unknown as FfMergeModule;
}

/** Both instruments reduced to one readable line for a trace `reason` (⛔ every value here is the
 *  reading's own — no re-classification: `evaluated=false` prints as NOT-evaluated, never as ok). */
function instrumentSummary(p: InstrumentProbe): string {
  const one = (k: string, r: { evaluated: boolean; detail: string }): string =>
    `${k}=${r.evaluated ? "available" : "NOT-evaluated"}(${r.detail})`;
  return `${one("classifier", p.classifier)}; ${one("reaper", p.reaper)}`;
}

/** worker 侧 scoped-gate 缓存写入 CLI 签名（gap-worker-premerge-scoped-gate-cache 阶段 a）：worker 在
 *  退出前跑绿 scoped 门后，用这条命令机械写入 (task, developSha, pass) 缓存（⛔ 不靠 agent 手写 JSON）。
 *  developSha 用 `git -C <worktree> rev-parse develop`（worker 已 merge develop ⇒ develop 即其验证过的 tip）。
 *  入口经 workerDriverSelfArgv 锚在本 kernel 安装位置（⛔ 非 root/plugin/scripts/worker-driver.ts）。
 *  ⛔ 经 export 暴露给 worker-driver.ts 的 preMergeNote（它的唯一区域外消费者）——但【不】在
 *  worker-driver.ts 的 re-export 面上（消费方是 prompt 构建，不是旧 import 面的测试），故 AC2 的导出面
 *  逐字不变仍成立。 */
export function scopedGateCacheWriteSignature(task: string, root: string, worktree: string): string {
  return `${workerDriverSelfArgv().join(" ")} --write-scoped-gate-cache --task ${task} --develop-sha "$(git -C ${worktree} rev-parse develop)" --root ${root}`;
}

// ── 机械 fan-in（gap-fan-in-driver-mechanical-orchestration / SPEC 2026-08-27）────────────────────
// 取消 fan-in-execute.js workflow 子代理串行跑机械步骤（每条命令间 ~3-5min 模型延迟把 ~10min 机械活
// 撑到 ~30min + 30min watchdog 强制释放），改由 driver 机械驱动 fan-in 的机械部分
// （锁/merge/delta/typecheck/scoped门/suite/ff）。happy-path 先做（人 2026-08-27 裁定①）：driver 跑通
// 「无失败 fan-in」，失败回退旧 workflow 子代理兜底。四判据：
//   AC1 锁时长塌缩——driver 持锁整段 merge→suite→ff，机械时长（非 30min 模型恒值）；
//   AC2 锁罩住 suite——release 不早于 suite 结束（driver 在 spawnSuiteAndWait 返回后才 release）；
//   AC3 无 detach——suite 是 driver 子进程（spawn+wait，ppid 指向 driver，⛔ setsid+&+disown 孤儿）；
//   AC4 ff-race 归零——锁罩住 merge→suite→ff 整段 ⇒ develop 在持锁期间不前进。

/** 一次机械 fan-in 的选项（suite 命令/锁路径/日志/静默阈值是测试缝）。 */
export interface MechanicalFanInOptions {
  task: string;
  worktree: string;
  root: string;
  runId: string;
  /** per-suite runId 覆盖（测试缝）。缺省 = newMechanicalSuiteRunId(task)（`mfi-<task>-<epoch-ms>-<rand>`，
   *  每次 fan-in 唯一）。它是【suite 身份】——传给 runner --run-id 并贯穿 full-suite-state /
   *  suite-load-<runId>.jsonl / verification-round 记录，⛔ 不是 runId（那个是 fan-in 过程身份，锁/日志/ff
   *  用它）。gap-mechanical-fan-in-per-suite-runid-unified。 */
  perSuiteRunId?: string;
  mergeTarget?: string;
  /** suite 命令（测试缝）；缺省 = defaultMechanicalSuiteCommand（本仓库 node full-suite-runner.ts
   *  --buckets <task> --root <worktree> --state-dir <root>/.quay --runner inner --log-file
   *  <suiteLogFile>；第三方项目无 scripts/test.sh ⇒ bash -c "cd <worktree> && <loop.test_command>"）。
   *  gap-fan-in-red-bucket-run-not-recorded：机械路径不再跑平行 `bash scripts/test.sh --buckets`
   *  （绕开 verification-round 唯一 writer），改走正确的 runner——green+red 桶轮次都入
   *  verification-round.jsonl（state=red 记录可见）。 */
  suiteCommand?: string[];
  /** suite 单飞槽 base（测试缝）；缺省 = suiteLockBase(root)。 */
  slotBase?: string;
  /** suite-slot-lib.sh 路径（测试缝）；缺省 = <root>/plugin/scripts/suite-slot-lib.sh。 */
  slotLib?: string;
  /** 静默看门狗阈值（测试缝）。 */
  silenceMs?: number;
  /** suite 日志（静默看门狗盯的）；缺省 .quay/fan-in-suite-<task>~<runId>~<attempt>.log（durable，⛔ 不再
   *  /tmp；attempt 唯一后缀 ⇒ 同一 runId 内多次 suite 互不覆盖，gap-fan-in-suite-log-same-runid-overwrite）。 */
  suiteLogFile?: string | null;
  /** suite capture（ff 闸读的证书）；缺省 /tmp/fan-in-suite-<task>.env。 */
  suiteCapture?: string;
  /** 强制跑 suite（跳过 doc-only 判定；测试缝）。 */
  forceSuite?: boolean;
  /** scoped 门命令（测试缝）；缺省 = scopedGateCommandFor(task, worktree)（本仓库 test.sh --for-task；
   *  第三方退化为 loop.test_command；两者皆无 ⇒ null 跳过 scoped 门）。 */
  scopedGateCommand?: string[];
  /** doc 检查命令（测试缝）；缺省 = docCheckCommandFor(worktree)（本仓库 test.sh --static-checks-doc；
   *  第三方无该文件 ⇒ null 跳过 doc-check）。 */
  docCheckCommand?: string[];
  /** doc-check 缓存文件（测试缝）；缺省 = <root>/.quay/doc-check-cache.json（gitignored 运行时缓存，
   *  gap-fan-in-doc-check-cache）。doc 面未变时命中缓存跳过 doc-check（~0s），变化失效重跑。 */
  docCheckCacheFile?: string;
  /** scoped-gate 缓存文件（测试缝）；缺省 = <root>/.quay/scoped-gate-cache.json（运行时缓存，
   *  gap-worker-premerge-scoped-gate-cache）。worker 退出前写 (task, developSha, pass)；锁内 merge 到的
   *  develop tip 与之一致时跳过 scoped-gate（可证明冗余），否则照跑（fail-closed）。 */
  scopedGateCacheFile?: string;
  /** fan-in 编排脚本目录（测试缝）；缺省 = <worktree>/plugin/scripts（自举：本分支的编排脚本自验）。 */
  scriptsDir?: string;
  /** ff-merge TS 模块路径（测试缝，hermetic 仓库 worktree 无 packages/quay/src ⇒ 测试显式传 FF_MERGE_MODULE）；
   *  生产不传 ⇒ 走静态字面量动态 import "packages/quay/src/fan-in/ff-merge.ts"（源树相对解析；shipped
   *  bundle 由 coreSrcAliasPlugin 内联——gap-resolve-kernel-src-module-strip-types-node-modules）。 */
  ffMergeModule?: string;
  /** 权威 suite 状态载体 full-suite-state.json 的路径（D7 测试缝）；缺省 = <root>/.quay/full-suite-state.json。 */
  suiteStateFile?: string;
  /** 本轮重跑命令（测试缝）；缺省 = resolveRerunCommand(worktree, worktree, <失败文件>)（读
   *  `<worktree>/.quay/config.yml` 的 `loop.rerun_command`，`{files}` 整元素被文件列表 splice）。 */
  rerunCommand?: string[];
  /** 重跑子进程的墙钟上限（测试缝）；缺省 RERUN_TIMEOUT_MS。⛔ 被中止 ⇒ rerun-not-evaluated（不放行）。 */
  rerunTimeoutMs?: number;
  /** 既存红 A/B 的基线树临时 worktree 路径（测试缝）；缺省 = `<dirname(worktree)>/.baseline-red-<task>-<runId>`。 */
  baselineWorktree?: string;
  /** 基线树 provisioning 命令（测试缝）。`undefined` ⇒ 缺省（`bash <kernel>/dispatch-worktree-setup.sh <baselineDir> --root <root>`）；
   *  `null` ⇒ **跳过**（hermetic 夹具的基线树自带 `scripts/test.sh`，不需 node_modules symlink/config 拷贝）；
   *  显式数组 ⇒ 用它。⛔ best-effort：provisioning 失败不致命（随后的重跑跑不起来 ⇒ 未评估 ⇒ 维持硬红）。 */
  baselineProvisionCommand?: string[] | null;
  /** dark-axis 步读的任务文件（测试缝）；缺省 = `<worktree>/tasks/<task>.md`。
   *  只为让 hermetic 夹具能到达 NOT-EVALUATED 分支（AC2）：该分支要求「文件读不出来」而 ac-gate
   *  仍能过——同一文件同时满足两者在生产上不成立，故须显式指向。⛔ 生产不传。 */
  darkAxisTaskFile?: string;
}

/** 机械 fan-in 单步失败的【结构化 verdict】（D6）：⛔ 不再是 `(stderr||stdout).trim()` 裸流。
 *  step = 失败步骤、verdict = 该步判定（恒 "failed"，与 outcome=red 同向）、exitCode = 子进程退出码、
 *  summary = 去噪后的可读失败摘要（能定位「哪个测试失败」）、logFile = 裸流 dump 路径（记录留指针，
 *  ⛔ 不把裸流塞进 reason）。logFile=null 仅当该步无裸流（如 flip-done 的 reason 已结构化）。 */
export interface MechanicalFanInStepVerdict {
  step: string;
  verdict: "failed";
  exitCode: number | null;
  summary: string;
  logFile: string | null;
}

/** 本轮重跑的三态结果（gap-fan-in-suite-red-no-in-round-rerun-of-red-files，硬规则 3b）。
 *  ⛔ 三态不得压平：`rerun-green`（点名文件全绿 ⇒ 按绿继续落地）/ `rerun-red`（仍红 ⇒ 维持 red）/
 *  `rerun-not-evaluated`（没有可用的重跑命令 / 解析不出文件 / 重跑自身被 watchdog 中止）。 */
export type RerunState = "rerun-green" | "rerun-red" | "rerun-not-evaluated";

/** 本轮重跑的读数（落进 mechanical_fan_in.rerun）。 */
export interface RerunReading {
  state: RerunState;
  /** `rerun-not-evaluated` 的成因 token（该态时非空；green/red 时 null）。⛔ 不与「跑了且绿/红」同形。 */
  reason: string | null;
  /** 本次重跑点名的失败文件（green/red 时非空；not-evaluated 时为空）。 */
  files: string[];
  /** 重跑子进程退出码（被 watchdog 中止 / 未跑 ⇒ null）。 */
  exitCode: number | null;
  /** 重跑结束 epoch（秒）；未跑 ⇒ null。 */
  finishedEpoch: number | null;
  /** 重跑输出的落盘文件名（`.quay/` 下的 basename；未跑/写失败 ⇒ null）。 */
  log: string | null;
}

/** 机械 fan-in 的三态结果（landed / red）。not-evaluated 由调用方按「未落地」处理（硬规则 3b）。
 *  单步失败的富结构在 `verdict`（step/reason 是其投影，保持旧读面）。 */
export interface MechanicalFanInResult {
  outcome: "landed" | "red";
  /** 结构化 per-step verdict（outcome=red 时非 null；landed 时 null）。 */
  verdict: MechanicalFanInStepVerdict | null;
  /** 失败步骤名（= verdict.step；outcome=red 时非空，landed 时 null）。 */
  step: string | null;
  /** 失败原因（= verdict.summary，去噪后的摘要；outcome=red 时非空）。 */
  reason: string | null;
  /** fan-in 锁持有时长（release epoch - acquire epoch，秒；读自 fan-in-lock-events）。 */
  lockHoldSecs: number | null;
  /** 锁 acquire / release 的 epoch（秒）——AC2 判据（release ≥ suite 结束）的输入。 */
  lockAcquireEpoch: number | null;
  lockReleaseEpoch: number | null;
  /** suite 结束时刻（epoch 秒，仅真跑 suite 时非 null）。 */
  suiteFinishedEpoch: number | null;
  /** suite 三态 outcome（真跑时非 null）。 */
  suiteOutcome: SuiteOutcome | null;
  /** suite 子进程 pid（AC3 判据输入——ppid 指向 driver）。 */
  suitePid: number | null;
  /** 落地 sha（develop 被 ff 到的 tip；landed 时非 null）。 */
  landedSha: string | null;
  /** fan-in 过程日志文件名（`.quay/fan-in-<task>-<runId>.log` 的 basename——web 链接据此构造，
   *  ⛔ 不重算 sanitize，单一真相源）。red/landed 两态都非 null。 */
  fanInLog: string | null;
  /** suite 日志文件名（`.quay/fan-in-suite-<task>~<runId>~<attempt>.log` 的 basename——web 链接 / 续做
   *  prompt / needs-human 注记据此构造绝对路径，⛔ 不靠命名约定猜）。red ∧ step=suite 时非 null（suite
   *  真因落该文件——183KB 真因只能靠命名约定猜的病根）；其它步骤 / landed 时 null。 */
  suiteLog: string | null;
  /** 仪器可用性读数（gap-fan-in-instrument-availability-self-check）：本次 fan-in 进 suite 之前探到的
   *  分类器 / reaper 读数，**只记录、不拦截**（⛔ 不参与任何控制流，见 ff-merge.ts probeInstruments 上方
   *  的裁定与理由）。`null` = 本次 fan-in 在探针之前就失败了（**未评估**，⛔ 与「探过且可用」不同形——
   *  硬规则 3b）；对象内部各自的 `evaluated:false` 才是「探过、判不出」。 */
  instruments?: InstrumentProbe | null;
  /** 受测的**合并树** SHA（worktree 在 merge 之后的 HEAD；suite 跑过时非 null）。取证缺口
   *  （gap-fan-in-suite-red-no-in-round-rerun-of-red-files）：旧 outcome 不记它，任务分支落地即删 ⇒
   *  「同一棵树上红转绿」事后无法证明。 */
  mergeTreeSha: string | null;
  /** 受测当时的 **develop SHA**（mergeTarget tip，ff 之前）——与 mergeTreeSha 配对，说明这棵树是
   *  对哪个基线跑的。取不到 ⇒ null（⛔ 不伪造成 mergeTreeSha 的别名）。 */
  developSha: string | null;
  /** suite 日志点名的失败测试文件读数；`null` = suite 从未红（**不适用**，⛔ 不是「未评估」——
   *  未评估在 `evaluated:false` 上）。 */
  failedTestFiles: FailedTestFilesReading | null;
  /** 本轮内重跑读数；`null` = suite 从未红（不适用）。suite 红 ⇒ 恒非 null（三态必有其一）。 */
  rerun: RerunReading | null;
  /** 既存红等价 A/B 读数（gap-fanin-suite-gate-no-baseline-equivalent-exception）。`null` = 本轮没有
   *  进 A/B（suite 绿 / 重跑转绿 / 在 A/B 之前就返回了）——**不适用**，⛔ 不是「未评估」（未评估在
   *  `verdict.kind === "not-evaluated"` 上）。 */
  baselineEquivalence?: BaselineEquivalenceReading | null;
}

/** 既存红 A/B 的读数（落进 `mechanical_fan_in.baselineEquivalence`）。 */
export interface BaselineEquivalenceReading {
  /** 等价判定（三态）。 */
  verdict: BaselineEquivalenceVerdict;
  /** 基线树（detached worktree @ mergeTarget）路径；未起 / 已清理 ⇒ null。 */
  baselineWorktree: string | null;
  /** 基线重跑输出落盘 basename（`.quay/` 下）；未跑 / 写失败 ⇒ null。 */
  log: string | null;
}

/** runAsync 的结果收窄为「成/败 + 输出」，机械 fan-in 各步骤的共用判定（⛔ 不各写一遍 status!==0）。 */
interface MechShResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

/** 机械 fan-in 步骤的进程组 spawn（gap-fan-in-subprocess-hang-timeout-recovery AC2/AC4）：detached:true
 *  （子进程成进程组组长）+ timeout 到期 SIGKILL 整组。⛔ runAsync 的 timeout 只 SIGKILL 直接子进程——
 *  孙进程（继承 stdout/stderr 管道 + 可能继承 flock FD）持管道写端存活 ⇒ close 永不触发、锁泄漏；
 *  本函数组 kill 整棵进程树，且显式 resolve 不依赖 close 事件（孙进程持管道不阻塞返回，硬规则 4b）。
 *  永不 throw；恒捕获 stdout+stderr（combinedOutput 需两流合并去噪，⛔ 不丢任一流的失败签名）。 */
export async function mechSh(argv: string[], timeoutMs = 120_000): Promise<MechShResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (e) {
      resolve({ ok: false, status: null, stdout: "", stderr: "", error: e as Error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (status: number | null, error: Error | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok: status === 0, status, stdout, stderr, error });
    };
    if (Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        // ⛔ 组 kill（-pid）：只 child.kill 会留孙进程持管道/锁。detached:true ⇒ 子进程是组长 ⇒ -pid 命中整组。
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }
        // 显式 resolve（⛔ 不依赖 close——孙进程持管道时 close 可能永不触发）。
        finish(null, new Error(`spawn timeout after ${timeoutMs}ms (SIGKILL process group): ${argv[0]}`));
      }, timeoutMs);
    }
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code, null));
  });
}

/** 机械 fan-in 步骤 trace 载体（.quay/fan-in-step-trace.jsonl，gitignored 运行时诊断日志——AC1：
 *  每步 begin/end 各一条；begin 无 end ⇒ 该步挂起/未返回，据 epoch 定位）。best-effort：写失败不致命
 *  （诊断载体失败 ≠ fan-in 失败，硬规则 3b 的镜像半边）。
 *
 *  ── 时长通道（gap-fan-in-step-trace-suite-steps-write-end-without-begin AC2）──────────────────
 *  **每条 `step-end` 自带 `durationMs`（该步真实墙钟毫秒）——读时长⛔不要用 begin/end 配对。**
 *  两个理由，都不是风格问题：
 *  1) **4 个 suite 决策步只有 end 没有 begin**（见 traceSuiteEvent）：ac-precheck / suite-start /
 *     suite-end / suite-skip 是【单发决策事件】而非区间——它们没有可配对的 begin，任何配对读法
 *     对它们恒返回「无数据」，而「无数据」与「这一步不存在」同形（硬规则 3b）。实测一位分析者
 *     正是用配对读法得出「suite 结构上不在这个载体里」的错误结论（该结论已收回，见
 *     docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md §5 错误一）。
 *  2) 配对读法**对它覆盖的那 8 步也不可靠**：跨天/跨轮的陈旧 begin 会与新的 end 配错。自带时长
 *     没有这个失败模式。
 *  ⛔ 因此：**不要**给这 4 个决策事件补一个「紧挨着 end 写的 begin」来把孤儿率刷到 0 —— 一个
 *  写下去就立刻被配掉的 begin 结构上不可能与 end 分离（硬规则 4：恒等式不是测量），那是给指标
 *  看的样子，不是仪器。 */
export function appendFanInStepTrace(
  root: string,
  task: string,
  runId: string,
  step: string,
  phase: "begin" | "end",
  extra: Record<string, unknown> = {},
): void {
  try {
    const file = path.join(root, ".quay", "fan-in-step-trace.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      JSON.stringify({
        event: `step-${phase}`,
        step,
        task,
        runId,
        ts: new Date().toISOString(),
        epoch: Math.floor(Date.now() / 1000),
        ...extra,
      }) + "\n",
      "utf8",
    );
  } catch {
    // best-effort：trace 写失败 ≠ fan-in 失败。
  }
}

/** 合并 stdout+stderr 为单一流（⛔ 不丢弃任一流、⛔ 不 stderr 优先——未知失败签名可能在任一流，
 *  硬规则 3b/4b/9 同族：stderr 恒非空恒良性时，只取 stderr 会把 stdout 的真失败签名丢掉）。
 *  两流皆空/全空白 ⇒ 空串（调用方回退 `exit <code>`）。单一机件，fail() 与 flip 共用。 */
export function combinedOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter((s) => s && s.trim() !== "").join("\n");
}

/** 无害噪声行（MODULE_TYPELESS 等）——⛔ 污染失败摘要/判词。extractFailureSummary 与
 *  extractFirstFailureLine 共用（⛔ 两处各写一份正则 = 漂移，硬规则 5b）。 */
function isNoiseLine(l: string): boolean {
  const t = l.trim();
  return (
    l.includes("MODULE_TYPELESS_PACKAGE_JSON") ||
    l.includes("Reparsing as ES module") ||
    l.includes("This incurs a performance overhead") ||
    l.includes("To eliminate this warning") ||
    l.includes('add "type": "module"') ||
    l.includes("--trace-warnings") ||
    // gap-fan-in-suite-red-reason-carries-split-or-commit-title：suite 静态检查阶段的「== … ==」分节
    // 标题行（runner-static-gate.ts 的 echo）与 node:test 的「✔ 通过测试」行都不是失败信号——但标题含
    // 「continuously-checked」（\bchecked\b）/「to-fail」（\bFAIL\b）、通过测试名含「AssertionError」/
    // 「Could not resolve」等词，会撞 isFailureSignalLine 的松散正则 ⇒ 把标题/通过测试当失败摘要（归因
    // 错位到 split-or-commit 标题）。⛔ 两者都整体当噪声（不进 meaningful 回退、不进 signals）。
    /^== .* ==$/.test(t) ||
    /^\s*✔/.test(l) ||
    // gap-fan-in-suite-refusal-reports-as-suite-red：runner 的【溯源标记】不是一条测试失败——它是
    // 「本轮跑没跑」的结构性事实（AC3）。⛔ 不得被 extractFirstFailureLine 当失败摘要（那会让一条
    // SUITE-RUN-START 变成 reason），refused 轮由 extractSuiteNotRunLine 显式取证。
    l.includes(SUITE_LOG_NOT_RUN_PREFIX) ||
    l.includes(SUITE_LOG_RUN_START_PREFIX) ||
    // gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files — 同一族的第三
    // 个标记：SUITE-INCOMPLETE / SUITE-PLAN 也是**溯源标记**（「本轮跑全没有 / OOM 杀过几次」），⛔ 不是
    // 一条测试失败。漏掉这一条，`planned=0 missing=0` 会被 extractFirstFailureLine 当成失败摘要。
    l.includes(SUITE_LOG_INCOMPLETE_PREFIX) ||
    l.includes(SUITE_LOG_PLAN_PREFIX)
  );
}

/** AC2 — 从 suite log 里取【第一条】「本轮没跑（拒绝）」标记行（runner 写、本层读，前缀同源）。
 *  ⛔ 与 extractFirstFailureLine 分开：拒绝【不是】一次测试失败，两者混用会把「没跑」记成「跑了且失败」
 *  （正是本条要修的病）。无标记 ⇒ null（调用方保持原有真失败摘要路径，⛔ 不伪造）。 */
export function extractSuiteNotRunLine(combined: string): string | null {
  const hit = String(combined ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(SUITE_LOG_NOT_RUN_PREFIX));
  return hit ?? null;
}

/**
 * gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files AC2/AC3/AC8 — 读
 * runner 写的**完整性 / OOM 标记行**（前缀与 full-suite-runner.ts 同源，⛔ 不各写一份前缀 = 漂移）。
 *
 * 病（实测轮 2660）：全量套件被 OOM 杀掉主阶段的一大半（579 个计划文件里 514 个一行没产出），runner
 * 仍写 green，fan-in 照常 `suite-end exit 0` → flip-done → ff 落地。判词只数 TAP 输出 ⇒「跑不成」与
 * 「跑过且全绿」同形（硬规则 3b）。本函数把「本轮**没跑全**」变成日志里的结构化事实。
 *
 * 三态（硬规则 3b）：**读到标记** ⇒ 返回读数；**没读到** ⇒ null（调用方保持既有真失败摘要路径，
 * ⛔ 不伪造）。`oomKill` 沿用 runner 的三态（`"unknown"` = telemetry 读不到，⛔ 不是 0）。
 */
export interface SuiteIncompleteReading {
  reason: "incomplete" | "oom-killed";
  planned: number | null;
  terminal: number;
  missing: number;
  oomKill: number | "unknown";
  files: string[];
}

export function extractSuiteIncompleteMarker(combined: string): SuiteIncompleteReading | null {
  const line = String(combined ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(SUITE_LOG_INCOMPLETE_PREFIX));
  if (!line) return null;
  const field = (k: string): string | null => {
    const m = new RegExp(`(?:^|\\s)${k}=(\\S*)`).exec(line);
    return m ? m[1] : null;
  };
  const num = (k: string): number | null => {
    const v = field(k);
    return v !== null && /^\d+$/.test(v) ? Number(v) : null;
  };
  const reasonRaw = field("reason");
  const oomRaw = field("oomKill");
  const files = (field("files") ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f && !f.startsWith("..."));
  return {
    reason: reasonRaw === "oom-killed" ? "oom-killed" : "incomplete",
    planned: num("planned"),
    terminal: num("terminal") ?? 0,
    missing: num("missing") ?? 0,
    oomKill: oomRaw !== null && /^\d+$/.test(oomRaw) ? Number(oomRaw) : "unknown",
    files,
  };
}

/**
 * gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files AC10/AC11 — 读 runner
 * 恒写的 `SUITE-PLAN` 行（绿轮也写）：本轮的**完整性读数**与**本轮的并发档位**。恢复轮（AC10）要用原轮
 * 的 `laneCount` 决定「下一档更低的值」；恢复轮自己也写这一行 ⇒ AC11 的「用它自己的 planned/terminal/
 * oomKill 计数、⛔ 不是原轮的」有唯一来源。
 *
 * 三态（硬规则 3b/6）：**读到行** ⇒ 返回读数；**没读到** ⇒ null（⛔ 不是 `planned=0` ——「没写」与
 * 「写了 0」不得压平）。单个字段读不出 / 格式不认识 ⇒ 该字段 null（⛔ 不猜）。
 */
export interface SuitePlanReading {
  planned: number | null;
  terminal: number | null;
  missing: number | null;
  completeness: string | null;
  oomKill: number | "unknown" | null;
  laneCount: number | null;
}

export function extractSuitePlanMarker(combined: string): SuitePlanReading | null {
  const line = String(combined ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(SUITE_LOG_PLAN_PREFIX));
  if (!line) return null;
  const field = (k: string): string | null => {
    const m = new RegExp(`(?:^|\\s)${k}=(\\S*)`).exec(line);
    return m ? m[1] : null;
  };
  const num = (k: string): number | null => {
    const v = field(k);
    return v !== null && /^\d+$/.test(v) ? Number(v) : null;
  };
  const oomRaw = field("oomKill");
  return {
    planned: num("planned"),
    terminal: num("terminal"),
    missing: num("missing"),
    completeness: field("completeness"),
    oomKill: oomRaw !== null && /^\d+$/.test(oomRaw) ? Number(oomRaw) : oomRaw === "unknown" ? "unknown" : null,
    laneCount: num("laneCount"),
  };
}

/**
 * AC11/AC12 — 一次**恢复轮**的可分读数。关键在**形状**：只有 `complete-red` 携带 `failures`（唯一能被喂
 * 给签名比较器的形状）；`incomplete`（被 OOM 杀 / 有文件没产出终态）**根本没有这个字段**。⇒ 一条
 * OOM / `unknown` / missing-file 记录**结构上**进不了 `runBaselineEquivalence` 的比较器 —— AC12 的
 * 「enforced by type/shape, ⛔ not by convention」在这里是一条**类型声明**，而不是一句约定。
 */
export type RecoveryRoundReading =
  | { kind: "certified"; run: SuiteRunResult; plan: SuitePlanReading | null; concurrency: number }
  | { kind: "incomplete"; run: SuiteRunResult; marker: SuiteIncompleteReading; plan: SuitePlanReading | null; concurrency: number }
  | { kind: "complete-red"; run: SuiteRunResult; plan: SuitePlanReading | null; failures: FailedTestFilesReading; concurrency: number }
  | { kind: "no-conclusion"; run: SuiteRunResult; reason: string; concurrency: number };

/** 把一轮恢复的结果判成上面四分形态。判据只看两处：run 的进程级三态位，与日志里的**结构化标记**。
 *  ⚠️ 判「没结论」**不是** `outcome !== "done"`：非零退出码是一轮**有**结论的真红，把它当「没结论」会把
 *  每一次真红都退化成「再降一档」，永远走不到 AC12 的 A/B（硬规则 3b 的镜像）。 */
export function classifyRecoveryRound(
  run: SuiteRunResult,
  logText: string,
  concurrency: number,
  root?: string | null,
): RecoveryRoundReading {
  if (run.hungByWatchdog || run.spawnFailed === true || String(logText ?? "") === "") {
    return {
      kind: "no-conclusion", run, concurrency,
      reason: run.hungByWatchdog ? "watchdog-killed" : run.spawnFailed === true ? "spawn-failed" : "log-unreadable",
    };
  }
  const plan = extractSuitePlanMarker(logText);
  const marker = extractSuiteIncompleteMarker(logText);
  if (marker !== null) return { kind: "incomplete", run, marker, plan, concurrency };
  if (run.exitCode === 0) return { kind: "certified", run, plan, concurrency };
  return { kind: "complete-red", run, plan, failures: readFailedTestFiles(logText, root ?? null), concurrency };
}

/** AC10/AC13 — 恢复轮**声明式**的并发降档梯。降序；**最后一个是地板**（AC13 的「floor concurrency N」
 *  就是它）。⛔ 声明式而非开放式：序列被这张表**有界**（AC13 的「不得无限重复同一组参数」）。 */
export const SUITE_RECOVERY_CONCURRENCY_LADDER: readonly number[] = [64, 48, 32];

/** AC13 — 梯子的地板档（最后一项）。 */
export function suiteRecoveryFloor(): number {
  return SUITE_RECOVERY_CONCURRENCY_LADDER[SUITE_RECOVERY_CONCURRENCY_LADDER.length - 1];
}

/**
 * AC10 — 恢复轮的**并发序列**：梯子上**严格低于**原轮并发的每一档，降序（「下一档更低的值」排最前）。
 *
 * 三态（硬规则 3b/6）：`original === null`（读不到原轮并发）⇒ **整条梯子**，⛔ 不是空序列 —— 空序列会被
 * 读成「已经在最低档下面、没什么可做的」，把「读不懂」伪装成「无需恢复」（零信息读数）。反之，原轮
 * 并发读到了且已 ≤ 地板 ⇒ 序列确实为空（那是**真实**的「没有更低的档」）。
 */
export function recoveryConcurrencySteps(original: number | null): number[] {
  if (original === null) return [...SUITE_RECOVERY_CONCURRENCY_LADDER];
  return SUITE_RECOVERY_CONCURRENCY_LADDER.filter((v) => v < original);
}

/**
 * 把 argv 里的 `--log-file <path>` 改成**恰好一份**、指向 `logFile`。
 *
 * ⛔ 必须是**替换**而不是追加：runner 读旗标用 `flagValue`（gate-script-base.ts），而它的实现是
 * `argv.indexOf(name)` ⇒ **取第一份**。追加一份新的 `--log-file` 会让 runner 继续用旧的那份，把本函数
 * 想修的东西原样保留（静默）。
 *
 * ⛔ 单 token 的 `--log-file=<path>` 形态**必须整条丢掉、改以空格形态追加**，⛔ 不能就地改写成
 * `--log-file=<logFile>`：`flagValue` 按**精确串相等**查（`indexOf("--log-file")`），它认不出 `=` 形态
 * ⇒ runner 会退回自己的缺省路径 `<state-dir>/full-suite.log`，而调用方仍读本档那份 —— 那正是本任务要
 * 消灭的「写一处、读另一处」，只是换了个马甲（静默）。丢掉之后 `placed` 保持 false，由末尾统一追加。
 */
function retargetLogFile(base: string[], logFile: string): string[] {
  const out: string[] = [];
  let placed = false;
  for (let i = 0; i < base.length; i++) {
    const a = base[i];
    if (a === "--log-file") {
      if (!placed) { out.push("--log-file", logFile); placed = true; }
      i += 1; // 丢掉它原来指的那个值（本轮不再经过它）
      continue;
    }
    if (a.startsWith("--log-file=")) continue; // 认不出的形态 ⇒ 丢（见上）
    out.push(a);
  }
  if (!placed) out.push("--log-file", logFile);
  return out;
}

/**
 * AC10 — 恢复轮的 argv：**同一条 suite 命令** + 把本轮的并发旋钮调到更低，**并把本轮的结构化日志
 * 重定向到本档自己的 `--log-file`**。
 *
 * 本仓库形态（`full-suite-runner.ts --buckets …`）用 **`--lane-count <n>`** —— runner 的既有并发旋钮；
 * runner 的 REPLACE splice（runner-concurrency.ts `spliceConcurrency`）把同一个值作为
 * **`--test-concurrency=<n>`** 交给真正的 suite 入口 `bash scripts/test.sh`。⇒ ⛔ 不新造机制、⛔ 不另加
 * 一层包装；「真正的 suite 入口收到 `--test-concurrency=<n>`」是 runner 既有行为的投影。
 *
 * ⛔ `recLogFile` 是**必需**参数，不是可选的「顺手带上」——这正是
 * gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable 的成因：恢复轮的 argv 由
 * 本函数给出，而**读**那一档日志的是调用方（`spawnSuiteAndWait` 的 `logFile` + `classifyRecoveryRound`），
 * 两者被当成同一件事，实际不是——runner 把 `SUITE-PLAN`/`SUITE-INCOMPLETE`/`__PERFILE__` **写进它自己
 * argv 里的 `--log-file`**（`fs.appendFileSync(logFile, …)`），且**不写 stdout**；而 `spawnSuiteAndWait`
 * 只把 `child.stdout` tee 进它拿到的那份 `logFile`。⇒ argv 不重定向时 runner 的字全落在**原轮**那份日志上
 * （还被每一档依次以 `flags:"w"` 截断），调用方读到的那份恒为 0 字节 ⇒ 每一档恒
 * `no-conclusion(log-unreadable)`，即便该档其实完整、零 OOM。**重定向使「runner 写的那份」与「调用方读
 * 的那份」结构上成为同一个路径** —— 本参数就是这条结构不变式的载体。
 *
 * 非本仓库形态（命令里没有 runner）⇒ **null**：那种轮次结构上不会写 SUITE-INCOMPLETE 标记（标记只有
 * full-suite-runner 写），且没有已知的并发旋钮 ⇒ 调用方记一个**独立的**下一档 token，⛔ 不伪造「已降档」
 * （硬规则 3b：降不了档必须与降了档可区分）。
 */
export function recoverySuiteCommand(base: string[], n: number, recLogFile: string): string[] | null {
  const isRunner = base.some((a) => /(^|[\\/])full-suite-runner\.ts$/.test(a));
  if (!isRunner) return null;
  // 空路径 = 接线错误（会让本轮回到「runner 写一处、调用方读另一处」的原始缺陷）。抛，⛔ 不静默产出一条
  // 指向错文件的 argv（硬规则 3b：读不懂/不成立必须与「合格」可区分）。唯一调用点传的是 `path.join(...)`。
  if (typeof recLogFile !== "string" || recLogFile.trim() === "") {
    throw new Error("recoverySuiteCommand: recLogFile is required (an empty path would re-point the round at a log nobody reads)");
  }
  return [...retargetLogFile(base, recLogFile), "--lane-count", String(n)];
}

/** 失败信号行（node:test 的 not ok / ✖ / # fail、断言 expected/actual、anti-drift HARD FAIL、esbuild 的
 *  Could not resolve / [ERROR] 构建失败、ac-gate/anti-drift 的 checked/violation 判词）。extractFailureSummary
 *  与 extractFirstFailureLine 共用（⛔ 不复制正则）。 */
function isFailureSignalLine(l: string): boolean {
  return /^\s*not ok\b|^\s*✖|\bFAIL\b|# fail\b|HARD FAIL|AssertionError|\bexpected:|\bactual:|\bfail \d+\b|\bexit=\d+|Could not resolve|\[ERROR\]|\bchecked\b|\bviolation\b/i.test(l);
}

/** D6：从某步的 stdout+stderr 合并流里提取【可读失败摘要】——⛔ 裸流（MODULE_TYPELESS 噪声占满、
 *  ⛔ 丢真正测试结果）。去噪 + 保留失败信号行（node:test 的 not ok / ✖ / # fail、断言 expected/actual、
 *  anti-drift HARD FAIL、esbuild 的 Could not resolve / [ERROR] 构建失败），有界（最后 N 行 + 4000 字符）。
 *  裸流本身落进 logFile（fail dump），记录里留指针。提取不出任何行 ⇒ 空串（调用方回退 `exit <code>`）。
 *  gap-scoped-gate-reason-stderr-drops-stdout：scoped 门红时 stdout 的真失败（esbuild 构建崩 = Could not
 *  resolve）必须进 reason——⛔ stderr 良性 preamble 优先 || 短路丢弃 stdout（硬规则 3b/4b/9 同族）。
 *  esbuild 失败行加入 isSignal：即使与 TAP not ok 并存，构建失败签名也不再被 slice(-60) 尾截掉。
 *  gap-step-trace-reason-captures-gate-stdout：ac-gate/anti-drift 的 stdout 判词（checked X/Y / violation）
 *  加入 isSignal——⛔ ac-gate 的 FAIL 行与「checked X/Y」并存时后者被 signals-first 丢弃，真判词不进 reason。 */
export function extractFailureSummary(combined: string): string {
  const meaningful = combined.split("\n").filter((l) => l.trim() !== "" && !isNoiseLine(l));
  const signals = meaningful.filter(isFailureSignalLine);
  const chosen = signals.length > 0 ? signals : meaningful;
  return chosen.slice(-60).join("\n").trim().slice(0, 4000);
}

/** 从合并流里取【第一条】真实失败信号行（同 extractFailureSummary 的 isNoiseLine/isFailureSignalLine，
 *  ⛔ 不复制正则）。suite 红 needs-human 用：把 suite 日志摘要出「第一条真实断言/报错行」塞进
 *  mechanical_fan_in.reason——⛔ extractFailureSummary 的 tail-60 多行 blob 塞进单行 markdown bullet 会断行，
 *  且它无信号时回退 meaningful 会违反「无匹配行 ⇒ 回退通用文案」（硬规则 3b 三态可分）。
 *  无信号 ⇒ 空串（调用方回退 `suite <outcome>` 通用文案，⛔ 不伪造/截断出误导内容）。 */
export function extractFirstFailureLine(combined: string): string {
  const lines = String(combined ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !isNoiseLine(l));
  // 真实失败优先序（gap-fan-in-suite-red-reason-carries-split-or-commit-title）：真实断言原文
  // （AssertionError）→ 失败文件（__PERFILE__ passed=false）→ 测试级失败（✖ / not ok / # fail N>0）
  // → 松散静态检查信号（HARD FAIL / Could not resolve / checked / violation）。
  // 旧实现取【文档序第一条】松散信号，而 suite 静态检查阶段的良性判词（0 violation(s) / checked 566 /
  // PASS）排在真实失败之前、且全中松散正则 ⇒ reason 恒为「split-or-commit 标题」而非真实失败（归因
  // 错位）。改成确定性失败优先，仍保留松散信号作【静态检查真失败】（无测试失败时）的回退。
  const definitive = [
    /AssertionError/i,
    /__PERFILE__ .* passed=false/i,
    /^\s*✖|^\s*not ok\b|# fail\s+[1-9]\d*\b/i,
  ];
  for (const re of definitive) {
    const hit = lines.find((l) => re.test(l));
    if (hit) return hit;
  }
  return lines.find(isFailureSignalLine) ?? "";
}

// ── suite 失败行解析（gap-suite-failure-attribution-third-party-layout；本簇自 worker-driver.ts 迁入）──
// 【为什么住在这里】机械 fan-in 的「suite 红后本轮内重跑【日志点名的】失败文件」需要这份读数，而本模块
// ⛔ 不能 import worker-driver.ts（本模块被它值 import ⇒ 成值环，import-graph-check 的 valueSccs 基线为
// 0）。单一真相源 ⇒ 实现落在【被依赖的下层】本文件，worker-driver.ts 反向 import 并 re-export 给既有
// 消费者（judgeRetryExemption / stop-terminal 判词 / 既有测试），⛔ 不复制第二份解析器。
//
// 上游缺陷（原文）：本解析曾把【本仓库的测试布局】写死进判据——前缀只认 `(packages|plugin|experiments)/`、
// 后缀只认 `.test.mjs`。第三方项目（`server/**/*.test.ts`、`src/**/*.test.tsx`）匹配恒为 0 ⇒ 返回
// `[]` ⇒ judgeRetryExemption 判 insufficient-data-fallback ⇒ park 时的判词写成「the suite log names
// nothing a worker could fix」——**一个肯定断言，而它的依据只是「解析器没读懂」**（硬规则 3b 的镜像：
// 读不懂 ⇒ 伪装成判定）。生产读数（claudecodeui `.quay/worker-round.jsonl`，2026-09-20→09-23）：51 次
// retry_exemptions 中 failingTestFiles 非空 **0 次**，波及 29 个任务；其中一例真凶是一条可一行修的
// barrel 导入 lint 错误（`not ok - lint: server/…/model-context-window.test.ts:10:49: …`）。
//
// 修法：⛔ 不再按路径前缀/后缀白名单判定，改为**按 token 的形态**分三类（硬规则 3b 要求「读不懂」有
// 独立取值，⛔ 不与「合格」同形）：
//   - 带路径分隔符的 token ⇒ 真实文件位置（`server/x/y.test.ts`、worktree 绝对路径形态都算）
//   - 无路径且无扩展名的 token ⇒ **伪阶段名**（`lint` / `typecheck`——runner 的 per-file 记录里它们
//     占同一字段位，但它们不是文件；旧实现会把 `lint` 当测试文件）
//   - 其余（含句子碎片、无路径又非测试后缀的 token）⇒ **无法识别**，原样留证，⛔ 不混进 files
/** suite 日志失败行的解析结果。三态可区分（硬规则 3b）。 */
export interface SuiteLogFailureParse {
  /** 归因到的失败文件（repo-relative；worktree 绝对路径形态按 root 归一）。 */
  files: string[];
  /** 解析器识别出的失败行数 N（`__PERFILE__ … passed=false` 与 `not ok - …` 两类之和）——
   *  唯一能区分「日志里没有失败行」与「有失败行但解析器读不懂」的量（⛔ 旧实现两者同形）。 */
  failingLines: number;
  /** 识别为伪阶段名的 token（`lint` / `typecheck` 等）——⛔ 不是测试文件。 */
  pseudoStages: string[];
  /** 既非真实文件也非伪阶段名 ⇒ 读不懂的 token（原样留证）。 */
  unclassified: string[];
}

/** 测试文件后缀（node:test 的 `*.test.*` 与 jest/vitest 的 `*.spec.*`；本仓库自身用 .test.mjs）。 */
const SUITE_TEST_FILE_RE = /\.(?:test|spec)\.(?:mjs|cjs|js|ts|tsx|jsx|mts|cts)$/i;
/** 路径 token 的合法字符集——挡掉 `boundaries(dependencies):` 这类句子碎片混进文件名（那是"读不懂"）。 */
const SUITE_PATH_TOKEN_RE = /^[\w./@~+-]+$/;

/** 单个 token 的形态分类。⛔ 不查 worktree 是否存在：第三方日志里的失败文件常常不在本 worktree
 *  （其它模块/并行分支），存在性检查会把真实文件误判成读不懂（且 AC 用例的假 root 里文件不存在）。 */
function classifySuiteToken(token: string): "file" | "pseudo-stage" | "unclassified" {
  const t = String(token ?? "").trim().replace(/[,;]+$/, "");
  if (!t) return "unclassified";
  if (!SUITE_PATH_TOKEN_RE.test(t)) return "unclassified";
  if (t.includes("/")) return "file";
  if (!t.includes(".")) return "pseudo-stage";
  return SUITE_TEST_FILE_RE.test(t) ? "file" : "unclassified";
}

/** token → repo-relative；定位不出 ⇒ null（**读不懂的独立取值**，硬规则 3b）。
 *  绝对路径的 repo 根【只能】由 root 给出（生产里 `measure-suite-reporter` 发的是 full-path，而 suite
 *  在任务 worktree 里跑、调用方拿的是主检出 root）：先按 root 前缀剥离，不在 root 下则取「在 root 下
 *  真实存在」的最长后缀——存在性是判据。⛔ 不按 `packages|plugin|experiments` 关键词猜前缀（那正是本
 *  缺陷的成因）；⛔ 也不在无 root 时把绝对路径削成「看着像 repo-relative」的假路径——它会被当成已归因，
 *  直接污染 AC-317 的读数（假在产物字段上 ⇒ 比读不懂更坏）。 */
function toRepoRelToken(token: string, root: string | null): string | null {
  const raw = String(token ?? "").replace(/\\/g, "/").trim();
  if (!raw.startsWith("/")) return normalizeRel(raw) || null;
  const rootAbs = root ? `/${normalizeRel(root)}` : "";
  if (!rootAbs || rootAbs === "/") return null;
  if (raw === rootAbs || raw.startsWith(`${rootAbs}/`)) return normalizeRel(raw.slice(rootAbs.length)) || null;
  const parts = raw.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i += 1) {
    const cand = parts.slice(i).join("/");
    try {
      if (fs.statSync(path.join(rootAbs, cand)).isFile()) return cand;
    } catch { /* 该后缀不存在，继续缩短 */ }
  }
  return null;
}

/** `__PERFILE__ duration_ms=… <token> passed=false …` 的 <token> = `passed=false` 前那个字段。 */
function suiteTokenBeforePassedFalse(line: string): string | null {
  const idx = line.indexOf("passed=false");
  if (idx < 0) return null;
  const parts = line.slice(0, idx).trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : null;
}

/** `not ok - <rest>` 的 <rest>（兼容 TAP 的 `not ok 1 - name` 编号形态）。无该形态 / 空 ⇒ null。
 *  ⛔ 这一个正则就是「什么算 not ok 行」的唯一定义：下面的 head / 指名文件两个读者共用它。 */
function suiteNotOkRest(line: string): string | null {
  const m = /^not ok\b(?:\s+\d+)?\s*-\s*(.*)$/i.exec(line);
  if (!m) return null;
  return m[1].trim() || null;
}

/** `<rest>` 里 `:` 之前的头部 token（`lint` / `server/a/b.test.ts`）；空 ⇒ ""（调用方按 unclassified 处置）。 */
function suiteNotOkHead(rest: string): string {
  const ci = rest.indexOf(":");
  return (ci < 0 ? rest : rest.slice(0, ci)).trim();
}

/** 伪阶段名后指名的真实文件：`lint: <rel>:<line>:<col>: <msg>` ⇒ `<rel>`。
 *  只在确实像路径/测试文件时返回（⛔ 不把 `not ok - lint: 5 problems` 的 `5` 当文件）。 */
function suiteFileNamedAfterStage(rest: string): string | null {
  const ci = rest.indexOf(":");
  if (ci < 0) return null;
  const chunk = (rest.slice(ci + 1).trim().split(/\s+/)[0] ?? "").replace(/(?::\d+){1,2}:?$/, "").replace(/:$/, "");
  if (!chunk) return null;
  if (!chunk.includes("/") && !SUITE_TEST_FILE_RE.test(chunk)) return null;
  return chunk;
}

/** suite 日志 → 失败行解析（三态）。N = 失败行数（`__PERFILE__ … passed=false` + `not ok - …`）。
 *  ⛔ N 与 files 分开返回：调用方据此把「日志里没有失败行」与「有 N 行但一行也归因不出」写成不同的判词
 *  （旧实现两者都只说「提取不出」，与「真的没有可修对象」同形）。 */
export function parseSuiteLogFailures(logText: string, root?: string | null): SuiteLogFailureParse {
  const files: string[] = [];
  const pseudoStages: string[] = [];
  const unclassified: string[] = [];
  let failingLines = 0;
  const notePseudo = (t: string): void => { if (t && !pseudoStages.includes(t)) pseudoStages.push(t); };
  const noteUnclassified = (t: string): void => { if (t && !unclassified.includes(t)) unclassified.push(t); };
  const addFile = (token: string): void => {
    // 定位不出 repo-relative（如无 root 的绝对路径）⇒ 归入「读不懂」，⛔ 不冒充已归因（硬规则 3b）。
    const rel = toRepoRelToken(token, root ?? null);
    if (!rel) { noteUnclassified(token); return; }
    if (!files.includes(rel)) files.push(rel);
  };

  for (const raw of String(logText ?? "").split("\n")) {
    const line = raw.trim();
    if (line.includes("passed=false")) {
      const token = suiteTokenBeforePassedFalse(line);
      if (!token) continue;
      failingLines += 1;
      const cls = classifySuiteToken(token);
      if (cls === "file") addFile(token);
      else if (cls === "pseudo-stage") notePseudo(token);
      else noteUnclassified(token);
      continue;
    }
    const rest = suiteNotOkRest(line);
    if (rest === null) continue;
    failingLines += 1;
    const head = suiteNotOkHead(rest);
    const cls = classifySuiteToken(head);
    if (cls === "file") { addFile(head); continue; }
    if (cls === "pseudo-stage") notePseudo(head);
    else noteUnclassified(head);
    // `not ok - <stage>: <rel>:<line>:<col>` 行把阶段失败【指名】到了真实文件上 ⇒ 归因到它。
    const named = suiteFileNamedAfterStage(rest);
    if (named !== null) {
      if (classifySuiteToken(named) === "file") addFile(named);
      else noteUnclassified(named);
    }
  }
  return { files, failingLines, pseudoStages, unclassified };
}

/** 从 suite 日志文本提取失败测试文件（repo-relative）。见 parseSuiteLogFailures。
 *  读不出 ⇒ []（不伪造；空列表与「读懂了但无失败」同形，调用方据 continueSuiteLogNote 的有无判定
 *  是否 suite 红，或据 parseSuiteLogFailures().failingLines 把两者分开）。 */
export function failingTestFilesFromSuiteLog(logText: string, root?: string | null): string[] {
  return parseSuiteLogFailures(logText, root).files;
}

// ── gap-fan-in-suite-red-no-in-round-rerun-of-red-files：本轮重跑要的【三态读数】──────────────────
// 重跑只在「日志点名了 ≥1 个失败测试文件」时才有对象。`failingTestFilesFromSuiteLog` 返回的 `[]` 把
// 两种完全不同的情形压成同一个值——「读懂了，日志里没有失败行」与「有失败行但一个也归因不出」/「日志
// 读不出」（硬规则 3b 的镜像：读不懂 ⇒ 伪装成「没有可重跑的对象」）。故这里另给一个三态读面：
//   evaluated:true  ⇒ files 非空（≥1 个点名文件）——重跑有对象；
//   evaluated:false ⇒ **未评估**（成因 token 在 reason 里）——重跑结果必须取 rerun-not-evaluated。
export type FailedTestFilesReading =
  | { evaluated: true; files: string[] }
  | { evaluated: false; reason: string };

/** suite 日志 → 失败测试文件清单三态读数（重跑的唯一输入）。⛔ 空清单不是「没有失败文件」，是
 *  **未评估**——`reason` 区分成因，⛔ 不与 evaluated:true 共用取值。 */
export function readFailedTestFiles(logText: string, root?: string | null): FailedTestFilesReading {
  if (String(logText ?? "").trim() === "") return { evaluated: false, reason: "suite-log-unreadable" };
  const parsed = parseSuiteLogFailures(logText, root);
  if (parsed.files.length > 0) return { evaluated: true, files: parsed.files };
  return {
    evaluated: false,
    reason: parsed.failingLines === 0 ? "no-failing-lines-in-suite-log" : "failing-lines-unattributable-to-files",
  };
}

// ── 既存红等价豁免（gap-fanin-suite-gate-no-baseline-equivalent-exception）───────────────────────────
//
// 病根（quay-fleet 三任务循环死锁，2026-10-12 登记）：fan-in 的 suite 步只有两种结局——全绿 / 红。
// 没有第三档「这个红点集合与 develop 基线逐字相同 ⇒ 既存红、不是本次引入、允许继续」。三个任务各自
// 完整修好三个既存红之一、各自独立验证零回归，却都因为另外两个红仍在而全量退出码非 0 ⇒ 互为落地门槛：
// 谁先合都被另外两个挡住（把多个任务的分支合进同一工作树去「一次做完」会被 anti-drift 判成
// out-of-declared，且把未验收的工作不透明地送进 develop）。
//
// 本机制（只加一档出口，不改任何既存判据）：suite 红时，起一棵 **detached worktree @ mergeTarget**，
// 对它重跑**同一批失败测试文件**（既有 `loop.rerun_command` 模板，`{worktree}` 换成基线树），把两边
// 的【失败签名集合】逐字比对：
//   task 红点集合 ⊆ baseline 红点集合（逐字）  ⇒ 既存红等价 ⇒ 放行（继续 typecheck/ff 等后续步骤）；
//   任何 task 独有 / 断言文本变化的红点          ⇒ 硬红（⛔ 不打折：对【新增】红的容忍度一字不改）。
//
// ⛔ 硬边界（三点都与 Proposal 的「明确非目标」一致）：
//   ① 「不变差」不是「打折」——豁免只允许本次 fan-in 在既存红集合不变的前提下继续推进；它不清空、
//      不减少对新增红的任何容忍度。
//   ② 读不懂 / A/B 自身失败 / 基线跑不起来 ⇒ **not-evaluated**，维持改动前的硬红（fail-closed）。
//      ⇒ 本机制最坏情况逐字等于改动前的行为，不存在「误放行」通道。
//   ③ ⛔ 不复用 `isOuterVerificationItem` / `isBodyLanded`（那是 AC-completion 语义的出口）——本档是
//      suite-gate 本身的出口，两者必须分开，读 `isOuterVerificationItem` 的下游逻辑不得读到它。

/** 一条失败签名：`file`（失败测试文件的 repo-relative 身份）+ `text`（该红点**逐字**的断言文本）。
 *  ⛔ 两棵树（task 合并树 / develop 基线树）都用本解析器 ⇒ 「逐字相同」是可判定的：绝对路径按各自
 *  root 归一成 repo-relative，断言文本原样（⛔ 不折易变量——Proposal 的判据就是「逐字」；折了会把
 *  「文本变了」这一负控情形并回「同一个」，正是 AC3 要拦的）。 */
export interface FailureSignature {
  file: string;
  text: string;
}

/** 失败签名解析三态（硬规则 3b）：`evaluated:false` = 未评估，成因在 reason 里，⛔ 不与「评估过且
 *  没有失败签名」同形（后者是 evaluated:true + 空数组，只在语义上不可能于红 suite 出现）。 */
export type FailureSignatureParse =
  | { evaluated: true; signatures: FailureSignature[] }
  | { evaluated: false; reason: string };

const SIG_PERFILE_RE = /^__PERFILE__\s+duration_ms=[0-9.]+\s+(\S+)\s+passed=false\b/;
const SIG_NOT_OK_RE = /^not ok\b(?:\s+\d+)?\s*-\s*(.*)$/i;
const SIG_ASSERTION_RE = /AssertionError(?:\s*\[[^\]]*\])?:\s*(.+)$/;
/** 断言文本的有界前瞻行数（`__PERFILE__ passed=false` 之后紧跟 TAP 明细块）。 */
const SIG_ASSERTION_LOOKAHEAD = 8;
// ── node spec reporter（本仓库 `scripts/test.sh` 的真实输出形态，⛔ 不是 TAP）────────────────────────
// gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red：真实 suite 日志里
// `^not ok` 一行也没有（2026-10-13 生产读数：0 条），失败以 `✖ <test name> (<ms>)` 出现在
// `✖ failing tests:` 块下，身份由 `test at <file>:<line>:<col>` 给出 ⇒ 旧解析器恒 `no-failure-signature-lines`
// （基线侧）⇒ A/B `not-evaluated` ⇒ 一份 develop 本来就红的日志被当成归因不出的基建之谜，健康的任务被停派。
const SIG_TEST_AT_RE = /^test at\s+(\S+?):(\d+):(\d+)\s*$/;
/** `✖ <test name> (<ms>)` —— 只认【紧跟在 `test at` 之后】的那一条：日志里 `✖ failing tests:`（块头）与
 *  文件级汇总里的独立 `✖` 行都没有 `test at` 配对，把它们当失败点会凭空造出签名。 */
const SIG_SPEC_FAIL_RE = /^✖\s+(.+)$/u;
/** 测试名尾部的 ` (<ms>)` —— **必须剥掉**：它是耗时，同一红点在两棵树上不同（实测 15439.958259ms vs
 *  12802.349732ms）⇒ 不剥会把「同一个红点」判成 `changed-assertion`（假红）。 */
const SIG_SPEC_DURATION_RE = /\s+\([0-9]+(?:\.[0-9]+)?ms\)$/;
/** 错误码行（`code: 'ERR_STRING_TOO_LONG'`）——**稳定**的失败成因 token，作为 detail 并入签名文本
 *  （⛔ 不取 `Error: …` 消息行 / 栈帧：那两者含路径与易变量，取了会让两棵树对不上）。 */
const SIG_SPEC_CODE_RE = /^\s*code:\s*['"]([^'"]+)['"]\s*$/;
/** 从 `test at` 行起、找配对的 `✖` 行与错误码行的有界前瞻（一个 spec 失败块的长度量级）。 */
const SIG_SPEC_LOOKAHEAD = 40;

/** 绝对路径 → repo-relative；不在 root 下 / 无 root ⇒ null（**读不懂的独立取值**，⛔ 不削成「看着像
 *  repo-relative」的假路径——那会把两棵树上不同的文件判成同一个）。相对路径原样归一。 */
function signatureRelPath(token: string, root: string | null): string | null {
  const raw = String(token ?? "").replace(/\\/g, "/").trim();
  if (!raw) return null;
  if (!raw.startsWith("/")) return normalizeRel(raw) || null;
  const rootAbs = root ? `/${normalizeRel(root)}` : "";
  if (!rootAbs || rootAbs === "/") return null;
  if (raw === rootAbs) return null;
  if (raw.startsWith(`${rootAbs}/`)) return normalizeRel(raw.slice(rootAbs.length)) || null;
  return null;
}

/** suite 日志 → 失败签名集合（三态）。识别三类失败行（本仓库与第三方 TAP 的共同形态）：
 *  ① `__PERFILE__ duration_ms=… <path> passed=false` —— 文件级失败标记；断言文本取紧随其后的第一条
 *     `AssertionError: …`（有界前瞻），读不到 ⇒ ""（⛔ 不伪造文本）。
 *  ② `^not ok [N] - <head>: <detail>` —— TAP 行；`<head>` 是测试/文件身份，`<detail>` 是断言文本。
 *  ③ node **spec reporter**：`test at <file>:<line>:<col>` + 紧随其后的 `✖ <test name> (<ms>)`，
 *     块内的 `code: 'ERR_…'` 作为 detail（gap-fan-in-baseline-comparison-blind-to-spec-reporter-…
 *     ——真实 suite 日志一个 `^not ok` 都没有，只认 TAP 等于对生产日志全盲）。
 *  三类都按 `root` 归一文件身份。一条签名也没解析出、但**确实见到了**失败行 ⇒ `evaluated:false`
 *  （成因 `failure-lines-without-resolvable-identity`，⛔ 不与「日志里没有失败行」同形）。
 *
 *  **粒度归并**：`__PERFILE__` 是**文件级**标记（它不带测试身份，读不到断言文本时 `text` 为空串）；当一个
 *  文件在同一份日志里另有 ≥1 条 spec **测试级**签名时，该文件级标记被**吸收**（丢弃）——否则「任务侧整份
 *  suite 日志带 `__PERFILE__`、基线侧重跑日志不带」这一纯粹的**记录粒度差**会被读成 `task-introduced-red`
 *  （同一红点集合，一侧多一条无名空签名 ⇒ 假红、假阻塞）。⛔ 只吸收 `__PERFILE__` 那一条，TAP 行不受影响。 */
export function parseFailureSignatures(logText: string, root?: string | null): FailureSignatureParse {
  const text = String(logText ?? "");
  if (text.trim() === "") return { evaluated: false, reason: "empty-suite-log" };
  const lines = text.split("\n");
  // 行序去重累加器：`fromMarker` = 这条签名来自 `__PERFILE__`（文件级标记），`fromSpec` = 它也以 spec
  // 测试级形态出现过。两者都置位 ⇒ 不被吸收（它有一条货真价实的测试级身份）。
  const byKey = new Map<string, { sig: FailureSignature; fromMarker: boolean; fromSpec: boolean }>();
  const order: string[] = [];
  const unresolvable: string[] = [];
  const push = (file: string, sig: string, origin: "marker" | "tap" | "spec"): void => {
    const f = file.trim();
    if (!f) return;
    const k = `${f}\u0000${sig}`;
    let e = byKey.get(k);
    if (e === undefined) {
      e = { sig: { file: f, text: sig }, fromMarker: false, fromSpec: false };
      byKey.set(k, e);
      order.push(k);
    }
    if (origin === "marker") e.fromMarker = true;
    if (origin === "spec") e.fromSpec = true;
  };
  // ⛔ 身份定位不出的失败行**不得**用原样 token 兜底（那会把「两棵树上各自不同的绝对路径」判成两个身份，
  // 或者反过来把同一个绝对路径判成「同一个」）——硬规则 3b：读不懂 = 未评估，⛔ 不落成一个签名。
  const noteUnresolvable = (token: string): void => { if (token && !unresolvable.includes(token)) unresolvable.push(token); };
  let sawFailureLine = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const pf = SIG_PERFILE_RE.exec(line);
    if (pf) {
      sawFailureLine = true;
      const rel = signatureRelPath(pf[1], root ?? null);
      if (rel === null) { noteUnresolvable(pf[1]); continue; }
      let sig = "";
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + SIG_ASSERTION_LOOKAHEAD); j += 1) {
        const m = SIG_ASSERTION_RE.exec(lines[j].trim());
        if (m) { sig = m[1].trim(); break; }
      }
      push(rel, sig, "marker");
      continue;
    }
    const no = SIG_NOT_OK_RE.exec(line);
    if (no) {
      sawFailureLine = true;
      const rest = no[1].trim();
      const ci = rest.indexOf(":");
      const head = (ci < 0 ? rest : rest.slice(0, ci)).trim();
      const detail = (ci < 0 ? "" : rest.slice(ci + 1)).trim();
      const rel = signatureRelPath(head, root ?? null);
      if (rel === null) { noteUnresolvable(head); continue; }
      push(rel, detail, "tap");
      continue;
    }
    const at = SIG_TEST_AT_RE.exec(line);
    if (at) {
      // `:line:col` 只作定位信息，⛔ 不入身份——行号在两条分支之间必然漂移（Plan 第 1 条）。
      sawFailureLine = true;
      const rel = signatureRelPath(at[1], root ?? null);
      if (rel === null) { noteUnresolvable(at[1]); continue; }
      // 配对的 `✖ <name>`：从 `test at` 的下一行起有界前瞻，取**第一条**非空行；它必须以 `✖` 开头，
      // 否则这个块读不懂（⛔ 不拿别的行冒充测试名）。
      let name: string | null = null;
      let codeLine = -1;
      const end = Math.min(lines.length, i + 1 + SIG_SPEC_LOOKAHEAD);
      for (let j = i + 1; j < end; j += 1) {
        const l = lines[j].trim();
        if (l === "") continue;
        if (SIG_TEST_AT_RE.test(l)) break; // 下一个失败块开始 ⇒ 本块结束（⛔ 不越界取名）
        if (name === null) {
          const m = SIG_SPEC_FAIL_RE.exec(l);
          if (!m) break;
          name = m[1].trim().replace(SIG_SPEC_DURATION_RE, "").trim();
          continue;
        }
        if (SIG_SPEC_CODE_RE.test(l)) { codeLine = j; break; }
      }
      if (name === null || name === "") continue; // 没有配对的 `✖` 行 ⇒ 不是 spec 失败块（⛔ 不落签名）
      const code = codeLine < 0 ? "" : (SIG_SPEC_CODE_RE.exec(lines[codeLine].trim())?.[1] ?? "");
      push(rel, code === "" ? name : `${name} [code: ${code}]`, "spec");
      continue;
    }
  }
  // 有失败行但**任何一条**身份定位不出 ⇒ 整个解析未评估（fail-closed：部分解析出的集合与另一棵树的
  // 集合比较会漏掉那些定位不出的红点 ⇒ 假豁免）。⛔ 不与「日志里没有失败行」同形（reason 不同）。
  if (unresolvable.length > 0) {
    return {
      evaluated: false,
      reason: `failure-line identity unresolvable for ${unresolvable.length} token(s): ${unresolvable.slice(0, 3).join(", ")}${unresolvable.length > 3 ? " …" : ""}`,
    };
  }
  const entries = order.map((k) => byKey.get(k)!);
  // 文件级标记的吸收（见函数头注释）：该文件另有测试级 spec 签名 ⇒ 丢弃那条无测试身份的 `__PERFILE__`。
  const specFiles = new Set(entries.filter((e) => e.fromSpec).map((e) => e.sig.file));
  const signatures = entries
    .filter((e) => !(e.fromMarker && !e.fromSpec && specFiles.has(e.sig.file)))
    .map((e) => e.sig);
  if (signatures.length > 0) return { evaluated: true, signatures };
  return {
    evaluated: false,
    reason: sawFailureLine ? "failure-lines-without-resolvable-identity" : "no-failure-signature-lines",
  };
}

/** 一条「同 id 但断言文本变了」的红点（AC3 的负控证据面，⛔ 不与「新增 id」同形）。 */
export interface ChangedSignature {
  file: string;
  baselineText: string;
  taskText: string;
}

/** 等价判定（纯函数）。三态取值互不同形（硬规则 3b）：
 *  - `exempt`        —— task 红点集合 ⊆ baseline 红点集合（逐字）⇒ 既存红等价，放行继续；
 *  - `hard-red`      —— 有 task 独有红点（`task-introduced-red`）或同 id 断言文本变化
 *                       （`changed-assertion`）⇒ 拦截；
 *  - `not-evaluated` —— 输入不完整（成因在 reason 里）⇒ 调用方维持改动前的硬红。
 *  ⛔ baseline 比 task **多**不算差（本任务修掉的红点下一轮就不在 task 集合里了）——只拦「变差」方向。 */
export type BaselineEquivalenceVerdict =
  | { kind: "exempt"; unchanged: number; signature: string }
  | { kind: "hard-red"; reason: "task-introduced-red" | "changed-assertion"; added: FailureSignature[]; changed: ChangedSignature[]; signature: string }
  | { kind: "not-evaluated"; reason: string };

function signatureKey(s: FailureSignature): string {
  return `${s.file}\u0000${s.text}`;
}

/** 失败签名集合的**规范串**（排序后拼接）——电路断路器用它做「同一个签名」的身份。 */
export function failureSignatureSetKey(sigs: FailureSignature[]): string {
  return sigs.map(signatureKey).sort().join("\n");
}

/** 比较 task 树与 baseline 树的失败签名集合（见 BaselineEquivalenceVerdict）。 */
export function compareFailureSignatures(
  task: FailureSignature[],
  baseline: FailureSignature[],
): BaselineEquivalenceVerdict {
  const baseKeys = new Set(baseline.map(signatureKey));
  const baseById = new Map<string, string[]>();
  for (const b of baseline) {
    const l = baseById.get(b.file);
    if (l === undefined) baseById.set(b.file, [b.text]);
    else l.push(b.text);
  }
  const added: FailureSignature[] = [];
  const changed: ChangedSignature[] = [];
  for (const t of task) {
    if (baseKeys.has(signatureKey(t))) continue;
    const baseTexts = baseById.get(t.file);
    if (baseTexts !== undefined && !baseTexts.includes(t.text)) {
      changed.push({ file: t.file, baselineText: baseTexts.join(" | "), taskText: t.text });
    } else {
      added.push(t);
    }
  }
  const signature = failureSignatureSetKey(task);
  if (changed.length > 0) return { kind: "hard-red", reason: "changed-assertion", added, changed, signature };
  if (added.length > 0) return { kind: "hard-red", reason: "task-introduced-red", added, changed, signature };
  return { kind: "exempt", unchanged: task.length, signature };
}

// ── 电路断路器（AC4）：同一任务连续 N 轮撞【同一签名】⇒ 停止自动重派 + 可读的循环死锁诊断 ────────────

/** 一轮「被既存红集合挡住」的读数（耐久载体 `.quay/baseline-red-rounds.jsonl` 的一行）。 */
export interface BaselineRedRound {
  task: string;
  /** 该轮 task 树失败签名集合的规范串（`failureSignatureSetKey`）。 */
  signature: string;
  ts: number;
  /** 被挡住的失败测试文件（诊断里点名）。 */
  blocked: string[];
}

export const BASELINE_RED_ROUNDS_REL = ".quay/baseline-red-rounds.jsonl";

export type CircuitBreakerVerdict =
  | { kind: "continue"; consecutive: number }
  | { kind: "stop-terminal"; consecutive: number; signature: string; peers: string[]; diagnostic: string };

/** 读耐久载体（坏行跳过；文件缺失 ⇒ []——⛔ 不伪造历史）。 */
export function readBaselineRedRounds(root: string): BaselineRedRound[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, BASELINE_RED_ROUNDS_REL), "utf8");
  } catch {
    return [];
  }
  const out: BaselineRedRound[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as Partial<BaselineRedRound>;
      if (typeof rec.task !== "string" || typeof rec.signature !== "string" || typeof rec.ts !== "number") continue;
      out.push({ task: rec.task, signature: rec.signature, ts: rec.ts, blocked: Array.isArray(rec.blocked) ? rec.blocked.filter((b): b is string => typeof b === "string") : [] });
    } catch { /* 坏行跳过 */ }
  }
  return out;
}

/** 追加一条读数（best-effort；⛔ 不参与控制流——写失败不改变本轮的 suite 判定）。 */
export function appendBaselineRedRound(root: string, round: BaselineRedRound): void {
  try {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.appendFileSync(path.join(root, BASELINE_RED_ROUNDS_REL), `${JSON.stringify(round)}\n`, "utf8");
  } catch { /* best-effort */ }
}

/** 电路断路器判定（纯函数）：同一任务**连续** `cap` 轮（含本轮）撞同一签名 ⇒ stop-terminal。
 *  `cap` 建议与 `RETRY_CAP_DEFAULT` 对齐（调用方传 `maxRetries`）。`allRounds` 供诊断点名**同签名的
 *  其它任务**（三方死锁的「哪几个任务」半边）——缺省只报本任务。⛔ 只判「签名不变」；签名一变即重置
 *  连续计数（那说明是另一堵墙，交给既有重试上限路径）。 */
export function decideBaselineRedCircuitBreaker(
  prior: BaselineRedRound[],
  current: BaselineRedRound,
  cap: number,
  allRounds: BaselineRedRound[] = [],
): CircuitBreakerVerdict {
  const same = prior
    .filter((r) => r.task === current.task && r.ts <= current.ts)
    .sort((a, b) => a.ts - b.ts);
  let consecutive = 1;
  for (let i = same.length - 1; i >= 0; i -= 1) {
    if (same[i].signature !== current.signature) break;
    consecutive += 1;
  }
  if (!(cap >= 1) || consecutive < cap) return { kind: "continue", consecutive };
  const peers = [...new Set(
    allRounds
      .filter((r) => r.task !== current.task && r.signature === current.signature)
      .map((r) => r.task),
  )].sort();
  const blocked = [...new Set([...current.blocked, ...same.slice(-(consecutive - 1)).flatMap((r) => r.blocked)])].sort();
  const diagnostic = [
    `LOOP DEADLOCK: task ${current.task} has been blocked by the SAME pre-existing red set for ${consecutive} consecutive fan-in rounds`,
    `(signature unchanged across rounds). Blocked red points: ${blocked.length > 0 ? blocked.join(", ") : "(none attributed)"}.`,
    peers.length > 0
      ? `Other tasks blocked by the identical red set: ${peers.join(", ")} — each of these tasks fixes a red point OUTSIDE the blocked set, so they are mutually landing gates (none can produce a green full suite while the others' reds remain).`
      : `No other task in the carrier shares this signature yet — if more arrive, they are mutually landing gates.`,
    `Suggested resolution: land ANY ONE of them first (each one's own fix is outside the blocked set, so the red set does not grow); the others' blocked sets then shrink by that red point and they land in turn. If a landing still makes it worse, a human must decide the order.`,
    `⛔ The gates were NOT relaxed: every new/changed red point still hard-fails this task (baseline-equivalence exemption never covers a red the task introduced).`,
  ].join(" ");
  return { kind: "stop-terminal", consecutive, signature: current.signature, peers, diagnostic };
}

/** 驱动侧入口：本任务当前的「既存红死锁」读数（供 worker-driver 决定是否停派）。
 *  无记录 / 未达上限 ⇒ `{ kind:"continue", consecutive }`。 */
export function baselineRedDeadlockReading(
  root: string,
  taskId: string,
  cap: number,
  nowMs: number = Date.now(),
): CircuitBreakerVerdict {
  const rounds = readBaselineRedRounds(root).filter((r) => r.task === taskId);
  if (rounds.length === 0) return { kind: "continue", consecutive: 0 };
  const current = rounds.reduce((a, b) => (b.ts >= a.ts ? b : a));
  return decideBaselineRedCircuitBreaker(rounds, current, cap, readBaselineRedRounds(root).filter((r) => r.task !== taskId));
}

/** 读 fan-in 锁事件里本任务+runId 的持有时长（AC1/AC2 判据输入，纯文件读）。`lock` = 本次 acquire
 *  的锁域标签（锁文件 basename，SPEC-goal-branch §4.6），使「这次落地用了哪把锁」事后可核；缺字段
 *  （老事件）⇒ null（⛔ 不伪造成 fan-in.lock——硬规则 3b）。 */
export function readFanInLockHold(
  root: string,
  task: string,
  runId: string,
): { lockHoldSecs: number | null; lockAcquireEpoch: number | null; lockReleaseEpoch: number | null; lock: string | null } {
  const file = path.join(root, ".quay", "fan-in-lock-events.jsonl");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null, lock: null };
  }
  let acquire: number | null = null;
  let release: number | null = null;
  let lock: string | null = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: { event?: unknown; taskId?: unknown; runId?: unknown; epoch?: unknown; lock?: unknown };
    try {
      rec = JSON.parse(t);
    } catch {
      continue;
    }
    if (rec.taskId !== task) continue;
    if (rec.runId !== runId) continue;
    if (typeof rec.epoch !== "number") continue;
    if (rec.event === "acquire") {
      acquire = rec.epoch;
      if (typeof rec.lock === "string") lock = rec.lock;
    } else if (rec.event === "release") release = rec.epoch;
  }
  const lockHoldSecs = acquire !== null && release !== null ? Math.max(0, release - acquire) : null;
  return { lockHoldSecs, lockAcquireEpoch: acquire, lockReleaseEpoch: release, lock };
}

// ── fan-in 锁：driver 自身经非分离直接子进程持锁（ADR-034）────────────────────────────
// 废除 gap-fan-in-workflow-lock-and-S1 的「分离 holder + flag 文件释放」协议（fan-in-ff-merge.sh
// --acquire/--release-fan-in-lock 里 `setsid bash … & disown` 的持锁进程 + `while [ -e flag ]` 死
// 循环 + 外部删 flag 释放）。该协议让持锁进程活得过它的 caller：caller 在 ff 后删 flag 前被杀 ⇒
// holder 孤儿化（PPID=1）+ 活着 ⇒ 死循环 ⇒ 锁持 23 分钟阻塞全仓 fan-in（gap-full-suite-lock-hold-
// watchdog-threshold-shorter-than-fan-in 末次实证）。ADR-034 裁定：锁的生死 = 工作的进程生死——锁由
// driver（受监督、可重启的常驻进程）经【非分离直接子进程】持有，释放只靠「持锁进程退出 → 内核自动关
// fd → flock 释放」一种机制，⛔ 不设任何时间阈值、⛔ 不依赖第三方外部信号（无 hold-max/TTL/stale）。
//
// 实现：driver spawn 一个【非 detached、非 disown】的 bash 子进程（holder）做 flock，然后阻塞在
// stdin 读上。driver 持有该子进程 stdin 管道的写端：driver 死（任何原因，含 SIGKILL）⇒ 内核关写端 ⇒
// holder 的 stdin 读到 EOF ⇒ 写 release 事件 + flock -u + 退出 ⇒ flock 自动释放。正常 release = driver
// 关 stdin 写端（同一路径）。锁文件/事件文件 = fan-in.lock /
// .quay/fan-in-lock-events.jsonl，fan-in-ff-protocol-check 判据4 与 readFanInLockHold
// 继续读同一载体。

/** fan-in 锁文件路径（git common dir 下，与 suite 锁同目录不同文件）。
 *  解析 git-common-dir（⛔ 不读 FULL_SUITE_LOCK_FILE env——那是 suite 锁的 seam，不属于 fan-in 锁）。 */
export function fanInLockFileNamed(root: string, name: string): string {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  const commonDir = r.status === 0 && !r.error ? (r.stdout ?? "").trim() : "";
  return path.join(path.resolve(root, commonDir || ".git"), name);
}

/** develop 落地的 fan-in 锁文件（`fan-in.lock`）——今天的唯一锁域，逐字不变。 */
export function fanInLockFile(root: string): string {
  return fanInLockFileNamed(root, "fan-in.lock");
}

/** SPEC-goal-branch-2026-10-03 §4.6（裁定⑥）：每个 goal 分支有【自己】的 fan-in 锁
 *  `<git-common-dir>/fan-in.goal-<GOAL-NNN>.lock`，使一个方向的落地不阻塞别的方向的落地。develop
 *  目标 ⇒ 仍取 `fan-in.lock`（⛔ 逐字不变）。锁域由【派生】的 mergeTarget 决定，⛔ 不新增 stored flag。 */
export function fanInLockFileForMergeTarget(root: string, mergeTarget: string): string {
  const goalId = goalIdFromBranchToken(mergeTarget);
  return goalId === null ? fanInLockFile(root) : fanInLockFileNamed(root, `fan-in.goal-${goalId}.lock`);
}

/** 持锁 holder 的 bash 脚本（非分离直接子进程；`cat >/dev/null` 阻塞在 stdin，driver 死 ⇒ EOF ⇒ 释放）。
 *  参数：$1=锁文件 $2=taskId $3=runIdJson（已编码 `"r"` 或 `null`）$4=agentIdJson $5=事件文件
 *  $6=锁域标签（锁文件 basename，供 readFanInLockHold/事后核对「用了哪把锁」——§4.6 的 `lock` 字段）。 */
const FAN_IN_LOCK_HOLDER = `exec {fd}>"$1" || exit 2
flock -x "$fd" || exit 2
_emit() {
  printf '{"event":"%s","ts":"%s","epoch":%s,"taskId":"%s","pid":%s,"runId":%s,"agentId":%s,"lock":"%s"}\\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%s)" "$2" "$$" "$3" "$4" "$5"
}
_emit acquire "$2" "$3" "$4" "$6" >> "$5"
_emit acquire "$2" "$3" "$4" "$6"
cat >/dev/null
_emit release "$2" "$3" "$4" "$6" >> "$5"
flock -u "$fd" 2>/dev/null || true
exit 0`;

/** 一次 fan-in 锁的持有句柄（driver 侧）：release() 关 stdin 写端 ⇒ holder 写 release 事件 +
 *  flock -u 退出；driver 死（SIGKILL）⇒ 内核关 stdin 写端 ⇒ 同一释放路径（无孤儿、无残留锁）。 */
export interface FanInLockHandle {
  holderPid: number | null;
  release: () => Promise<void>;
}

/** 经非分离直接子进程 acquire fan-in 锁（ADR-034）。resolve = holder 已 flock 并写出 acquire
 *  事件（stdout 出现该行）；reject = holder 在 acquire 前死（flock 错误 / spawn 失败）。unbounded——排队
 *  等待正是这把正确性锁存在的意义（⛔ 无超时，与旧 --acquire-fan-in-lock 的 `flock -x` 无界语义一致）。 */
export function acquireFanInLock(opts: {
  root: string;
  task: string;
  runId: string;
  agentId?: string | null;
  lockFile?: string;
  eventsFile?: string;
}): Promise<FanInLockHandle> {
  const lockFile = opts.lockFile ?? fanInLockFile(opts.root);
  const eventsFile = opts.eventsFile ?? path.join(opts.root, ".quay", "fan-in-lock-events.jsonl");
  const runIdJson = opts.runId ? JSON.stringify(opts.runId) : "null";
  const agentIdJson = opts.agentId ? JSON.stringify(opts.agentId) : "null";
  // §4.6：把锁域标签（锁文件 basename）写进事件——事后可核「这次落地用了哪把锁」（goal 锁 vs develop 锁）。
  const lockLabel = path.basename(lockFile);
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });

  const child = spawn(
    "bash",
    ["-c", FAN_IN_LOCK_HOLDER, "fan-in-lock-holder", lockFile, opts.task, runIdJson, agentIdJson, eventsFile, lockLabel],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  let released = false;
  const release = (): Promise<void> => {
    if (released) return Promise.resolve();
    released = true;
    child.stdin?.end();
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise<void>((res) => child.once("close", () => res()));
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      if (!settled && stdoutBuf.includes('"event":"acquire"')) {
        settled = true;
        resolve({ holderPid: child.pid ?? null, release });
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`fan-in lock holder exited before acquiring (code ${code})`));
      }
    });
    child.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(new Error(`fan-in lock holder spawn error: ${(e as Error).message}`));
      }
    });
  });
}

/** 写 suite capture（ff 闸 ff-merge.ts 模块的证书——读 suite_exit + suite_head 判「本任务 suite 已
 *  绿且 suite_head 是待 ff tip 的祖先」）。fail-open（gap-write-suite-capture-non-blocking AC1）：
 *  capture 是 suite 结果的派生观测载体，写失败（磁盘/权限）只 WARN 到 stderr、⛔ 不抛——ff 闸在 capture
 *  缺失/不可读时回退读权威源 full-suite-state.json（同一轮 mirrorMechanicalFanInSuiteState 已写
 *  state=green + commit=suite_head + taskId），观测写失败不得弄死一个真实绿 suite 的落地
 *  （人 2026-08-30 裁定「观测不得阻塞主执行」）。 */
function writeSuiteCapture(captureFile: string, fields: Record<string, string>): void {
  try {
    const lines = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
    fs.mkdirSync(path.dirname(captureFile), { recursive: true });
    fs.writeFileSync(captureFile, lines.join("\n") + "\n", "utf8");
  } catch (e) {
    console.error(`worker-driver: writeSuiteCapture failed (fail-open — fan-in continues, ff gate falls back to the authoritative source): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 取本任务上一轮 green bucket suite 的 verified commit（suite_head）——权威源 full-suite-state.json 的
 *  mirror 记录（mirrorMechanicalFanInSuiteState 写 state=green + commit=suite_head + taskId；与 ff 闸
 *  readGreenMirrorCommit 同形同一份 shape，⛔ 不另造字段）。⛔ 该 commit 是【历史指针】非实时态：读回后
 *  由调用方用 `git merge-base --is-ancestor` 对工作树 HEAD 做祖先校验（距今一致性），不据此断当前在跑。
 *  取不到 / 非本任务 / 非 green / commit 非法（非 40-hex）⇒ null（缺值 = 未查，⛔ 不是「可复用」——
 *  硬规则 3b：读不懂 ≠ 上一轮绿）。gap-fan-in-continue-doc-only-advance-reuse-suite AC4 输入。 */
export function readPreviousGreenSuiteCommit(stateFile: string, task: string): string | null {
  let text = "";
  try {
    text = fs.readFileSync(stateFile, "utf8");
  } catch {
    return null;
  }
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(text);
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
  if (rec.state !== "green") return null;
  if (rec.taskId !== task) return null;
  const commit = rec.commit;
  if (typeof commit !== "string") return null;
  const sha = commit.trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

// readTaskStatusAtRef (async) — SINGLE-SOURCE in task-schema.ts as `fetchTaskStatusAtRef`
// (gap-task-status-parsing-reimplemented-13-sites); imported above. The resident loop must stay async
// (AC4 — never block on execFileSync).

/** 写 worktree 任务文件 + 提交（flip / reset 共用的机械步：写盘 → add → commit --no-verify）。
 *  返回 `commit`（本次提交的 sha，`git rev-parse HEAD` 读回；读不回 ⇒ null）与 `at`（写盘时刻 = 该
 *  status 变更发生的时刻）——二者是 v1 事件 `evidence.commit` / `at` 的直接来源
 *  （gap-task-status-events-contract-v1：事件在提交【之后】追加，故 sha 可在追加前取到）。 */
async function commitTaskStatusChange(
  worktree: string,
  task: string,
  file: string,
  nextText: string,
  message: string,
): Promise<{ ok: boolean; reason: string | null; commit: string | null; at: string }> {
  fs.writeFileSync(file, nextText, "utf8");
  const at = new Date().toISOString();
  const failed = (reason: string) => ({ ok: false, reason, commit: null, at });
  let a = await mechSh(["git", "-C", worktree, "add", `tasks/${task}.md`]);
  if (!a.ok) return failed(`git add failed: ${combinedOutput(a.stdout, a.stderr) || `exit ${a.status}`}`);
  a = await mechSh(["git", "-C", worktree, "commit", "-q", "--no-verify", "-m", message, "--", `tasks/${task}.md`]);
  if (!a.ok) return failed(`git commit failed: ${combinedOutput(a.stdout, a.stderr) || `exit ${a.status}`}`);
  const rev = await mechSh(["git", "-C", worktree, "rev-parse", "HEAD"]);
  const sha = rev.ok ? rev.stdout.trim() : "";
  return { ok: true, reason: null, commit: /^[0-9a-f]{40,64}$/i.test(sha) ? sha : null, at };
}

/** The fan-in's v1 transition-event emit (ONE shape for all four sites). Called AFTER the commit —
 *  never before (硬规则 7): the event traces a status write that is already durable, and names the
 *  commit that carries it. A failed append never fails the flip (the kernel counts + logs it and the
 *  reconcile script closes the gap) but IS returned so the caller's step trace can show it. */
function emitFanInTransitionEvent(
  ctx: { root: string; cause?: { runId?: string } },
  task: string,
  from: string,
  to: string,
  at: string,
  written: string,
  commit: string | null,
  writerId: string,
): void {
  appendTaskStatusEvent(ctx.root, {
    taskId: task,
    from,
    to,
    kind: edgeKindFor(from, to, { allowLegacy: true }),
    actor: { kind: "fan-in", id: writerId },
    at,
    ...(ctx.cause && Object.keys(ctx.cause).length > 0 ? { cause: ctx.cause } : {}),
    evidence: {
      commit,
      statusBlobSha: gitBlobSha(written),
      ...(commit === null ? { commitAbsentReason: "git rev-parse HEAD returned no sha after the commit" } : {}),
    },
  });
}

/** 读 worktree 的任务文件并翻 status ready→done（fail-closed：status 经 task-ops.ts 单一 parser 读出，
 *  非 ready/done 即拒；gap-task-ops-consolidate-driver-frontmatter-writers）。
 *  gap-fan-in-flip-done-already-done-not-landed：「先 flip 后 ff」（人 2026-08-14 裁定）留下的
 *  「done 但未落地」不一致中间态（worktree 已翻 done、develop 未含落地提交）在重跑时收敛——读到
 *  `status: done` 先判真落地：
 *    - 已真落地（mergeTarget 的 tasks/<task>.md status=done）⇒ skip（不 reset、不重翻，返回 ok）；
 *    - 未真落地（mergeTarget 仍是 ready / 读不到）⇒ reset 到 ready 再 flip（两提交，ff 落在新 flip tip）。
 *  正常 `status: ready` 的 flip 行为不变（AC4）。判落地用「mergeTarget 的任务文件 status」直接量
 *  （⛔ 不各写一遍 computeLandingState 的 landing 判定——本函数只判 flip 侧的一致性）。
 *
 *  gap-task-status-events-contract-v1：每次提交成功后 emit 一行 v1 转移事件（reset 与 flip 各一行
 *  ——它们是两次真实的 status 变更）。`ctx.root` 是工作区根（事件载体 `.quay/task-status-events.jsonl`
 *  所在），`ctx.cause.runId` 是本轮 fan-in 的过程 id。⛔ 事件 emit 失败不改判 ok（内核 fail-open +
 *  计数 + stderr；缺口归 reconcile）。 */
async function flipTaskDone(
  worktree: string,
  task: string,
  mergeTarget: string,
  ctx: { root: string; cause?: { runId?: string } },
): Promise<{ ok: boolean; reason: string | null }> {
  const file = path.join(worktree, "tasks", `${task}.md`);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, reason: `read task file failed: ${(e as Error).message}` };
  }
  // gap-task-ops-consolidate-driver-frontmatter-writers：status 读/写经 task-ops.ts（splitTaskFile /
  // statusFromFrontmatter / patchStatusField，单一 parser，⛔ 不再手搓 status 行正则 / 精确行计数）。
  const split = splitTaskFile(text);
  if (!split) return { ok: false, reason: "task file has no frontmatter" };
  const from = statusFromFrontmatter(split.frontmatterRaw);
  const rebuild = (fm: string): string => `${split.open}${fm}${split.close}${split.body}`;
  const flipMessage = `tasks: 翻 ${task} done（driver 机械 fan-in）`;
  if (from === "ready") {
    const flipped = patchStatusField(split.frontmatterRaw, "done");
    if (!flipped.ok) return { ok: false, reason: `flip failed: ${flipped.reason}` };
    const nextText = rebuild(flipped.fm);
    const res = await commitTaskStatusChange(worktree, task, file, nextText, flipMessage);
    if (res.ok) emitFanInTransitionEvent(ctx, task, "ready", "done", res.at, nextText, res.commit, "worker-fan-in flipTaskDone");
    return res;
  }
  if (from === "done") {
    // done 已存在：判真落地（mergeTarget 的任务文件是否已 done）。已落地 ⇒ skip；未落地 ⇒ reset→flip。
    const landed = await fetchTaskStatusAtRef(worktree, mergeTarget, task);
    if (landed === "done") return { ok: true, reason: null };
    const reset = patchStatusField(split.frontmatterRaw, "ready");
    if (!reset.ok) return { ok: false, reason: `reset to ready failed: ${reset.reason}` };
    const resetText = rebuild(reset.fm);
    const resetResult = await commitTaskStatusChange(
      worktree, task, file, resetText,
      `tasks: reset ${task} done→ready（fan-in 收敛「done 未落地」中间态）`,
    );
    if (!resetResult.ok) return resetResult;
    emitFanInTransitionEvent(ctx, task, "done", "ready", resetResult.at, resetText, resetResult.commit, "worker-fan-in flipTaskDone reset");
    const flipped = patchStatusField(reset.fm, "done");
    if (!flipped.ok) return { ok: false, reason: `flip after reset failed: ${flipped.reason}` };
    const flipText = rebuild(flipped.fm);
    const flipResult = await commitTaskStatusChange(worktree, task, file, flipText, flipMessage);
    if (flipResult.ok) emitFanInTransitionEvent(ctx, task, "ready", "done", flipResult.at, flipText, flipResult.commit, "worker-fan-in flipTaskDone");
    return flipResult;
  }
  return { ok: false, reason: `expected status 'ready' or 'done', got ${from === null ? "none" : JSON.stringify(from)}` };
}

/**
 * B2 状态双写（SPEC-goal-branch-2026-10-03 §5，裁定⑪）：`done` 的语义是「已落到它的 mergeTarget」。
 *  mergeTarget 是一条 goal 分支时，代码照常 ff 到 `goal/<id>`（上一步），但合并【目标】不在 develop——而
 *  【派发/晋升读的是主检出盘上的 tasks/*.md，主检出跟随 develop】（CLAUDE.md 硬规则 11b）。若不把同一个
 *  done 翻转也写到 develop，worktree 回收后 develop 上仍是 ready ⇒ 任务被【反复派发】（本 gap 的缺陷）。
 *
 *  写路径 = 现有文档面写路径（⛔ 不自造）：主检出（root）上把 tasks/<task>.md 翻成 done 并 pathspec 限定
 *  提交（commitTaskFile，⛔ 不裸 commit 扫共享 index）→ propagateDocBranchToDevelop（ff-only + 语义兜底，
 *  把 doc 分支推到 develop）。主检出已是 done（上一轮部分成功的残留）⇒ 不重复提交，仅再同步一次。
 *
 *  ⛔ 只在 `mergeTarget !== "develop"` 时调用（develop 目标路径逐字不变，AC1）：develop 目标下 done 随
 *  ff 直接落到 develop，不需要也不得产生额外的文档面提交。
 *
 *  拒绝取值（硬规则 3b/6）：主检出任务文件读不到 / 无 frontmatter / 状态非 ready|done / 提交失败 /
 *  propagate 返回 false ⇒ {ok:false, reason}（⛔ 不与「已同步」同形）。
 */
async function syncDoneToDocFace(root: string, task: string): Promise<{ ok: boolean; reason: string | null }> {
  const rel = `tasks/${task}.md`;
  const file = path.join(root, rel);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, reason: `doc-face task file unreadable: ${(e as Error).message}` };
  }
  const split = splitTaskFile(text);
  if (!split) return { ok: false, reason: "doc-face task file has no frontmatter" };
  const from = statusFromFrontmatter(split.frontmatterRaw);
  if (from !== "ready" && from !== "done") {
    return { ok: false, reason: `doc-face status expected 'ready'/'done', got ${from === null ? "none" : JSON.stringify(from)}` };
  }
  if (from === "ready") {
    const flipped = patchStatusField(split.frontmatterRaw, "done");
    if (!flipped.ok) return { ok: false, reason: `doc-face flip failed: ${flipped.reason}` };
    const nextText = `${split.open}${flipped.fm}${split.close}${split.body}`;
    fs.writeFileSync(file, nextText, "utf8");
    const at = new Date().toISOString();
    if (!commitTaskFile(root, rel, `tasks: 翻 ${task} done（goal 分支落地，状态双写 develop）`)) {
      return { ok: false, reason: "doc-face commit failed" };
    }
    // gap-task-status-events-contract-v1: the doc-face done is a REAL status change in its own right
    // (this is the one that reaches develop when the merge target is a goal branch) ⇒ one v1 event,
    // appended after its commit. The worktree-side flip above emits its own event for its own commit;
    // only one of the two ever reaches a given ref, so a ref-scoped reconcile counts one, not two.
    const rev = await mechSh(["git", "-C", root, "rev-parse", "HEAD"]);
    const sha = rev.ok ? rev.stdout.trim() : "";
    emitFanInTransitionEvent({ root }, task, "ready", "done", at, nextText, /^[0-9a-f]{40,64}$/i.test(sha) ? sha : null, "worker-fan-in syncDoneToDocFace");
  }
  if (!propagateDocBranchToDevelop(root)) {
    return { ok: false, reason: "propagateDocBranchToDevelop failed (doc→develop ff-only ∧ semantic fallback both failed)" };
  }
  return { ok: true, reason: null };
}

/** 解析 `packages/quay/src/` 子树下一模块（shipped 感知，⛔ 硬编码 packages/quay/src 布局锚点）：
 *  源树上下文（base 是 quay 源树，含 packages/quay/src/<rel>）⇒ base/packages/quay/src/<rel>；
 *  shipped 上下文（npm 包把 packages/quay/ 打平到包根、base 无 packages/）⇒ <包根>/src/<rel>。
 *  包根 = resolveKernelPluginRoot() 的父目录（源树 = <repo>/plugin 的父 <repo>；shipped = <pkg>/plugin
 *  的父 <pkg>——实测 /tmp/ac207-prefix/lib/node_modules/quay/ 下 src/ 与 plugin/ 平级）。存在性判定
 *  （fs.existsSync）先试源树形、再退 shipped 形；两形互斥（同一 base 不会同时命中两种布局）。两形皆无
 *  时返回 shipped 形路径，import 的 MODULE_NOT_FOUND 由调用方 best-effort 捕获（与现状一致，不在此抛）。
 *  gap-fanin-gate-event-store-path-shipped-unsafe：appendCompleteGateEvent 与 ffMergeModule 两处
 *  packages/quay/src 锚点原为仓库布局硬编码，shipped npm 包（打平布局）下 MODULE_NOT_FOUND 被静默吞。
 *  ⚠️ gap-resolve-kernel-src-module-strip-types-node-modules：上述两调用点已改静态字面量动态 import
 *  （shipped bundle 由 coreSrcAliasPlugin 内联，消除 node_modules 下 .ts 的 runtime import）。本函数
 *  保留为布局解析单一真相源 + 测试锚点（AC4「双向不变」）；生产已无调用点。
 */
export function resolveKernelSrcModule(base: string, rel: string): string {
  // 布局判定已上收 driver-runtime.resolveQuaySrcModule（单一入口，⛔ 不再就地拼 `packages/quay/src`）：
  // 源树形（base 是 quay 源树 ⇒ 命中）与 shipped 打平形都在那一个入口里；两形皆无 ⇒ 旧契约的
  // shipped 形路径（以 **kernel 包根**为基准退回，⛔ 不是 base——base 是消费方/第三方 worktree，
  // 它没有 <base>/src），由调用方的 best-effort catch 兜。本函数已无生产调用点，仅测试锚点。
  return resolveQuaySrcModule(rel, base)
    ?? path.join(path.dirname(resolveKernelPluginRoot()), "src", rel);
}

/** gap-mechanical-fan-in-writes-no-complete-gateevent — 机械 fan-in 翻 done 后经既有 gate-event-store
 *  写 `complete` pass GateEvent（恢复 gap-loop-completion-path-produces-zero-gateevents AC2 在新路径上
 *  成立；⛔ 不手搓 append）。事件写到 <root>/.quay/gate-events.jsonl——与 CLI/loop 同一载体，
 *  stale-ready-audit.ts 的 bypassComplete 判据据此不再把机械 fan-in 的 done 误报为「绕过 QENG」。
 *  actor 缺省 "quay-driver"（区别于 CLI "quay-cli" / loop "outer"）。Package import 走动态
 *  pathToFileURL（同 loop-complete-task.ts：esbuild bundle 不解析 ../../packages/...）。best-effort：
 *  写失败返回 { ok:false }，不抛——fan-in 已 landed，观测写不得阻塞主执行（同 writeSuiteCapture）。 */
export async function appendCompleteGateEvent(
  root: string,
  task: string,
  actor = "quay-driver",
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    // gap-resolve-kernel-src-module-strip-types-node-modules: shipped npm 包把 packages/quay/ 打平到
    // 包根，resolveKernelSrcModule 会解析到 <包根>/src/gate/gate-event-store.ts（node_modules 下的 .ts）
    // ⇒ Node ≥23.7 拒剥 ⇒ ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING。改静态字面量动态 import（同
    // send-to-session.ts 的 gap-ac205 手法）：源树相对路径直接解析；shipped bundle 由 build-plugin-dist.mjs
    // 的 coreSrcAliasPlugin 重指并 INLINE（bundle:true），无 runtime 落 node_modules .ts 的 import。
    // ⛔ 不用 pathToFileURL(计算路径)——esbuild 无法内联计算 specifier，shipped 下必挂。
    const { appendGateEvent } = await import(
      "../../packages/quay/src/gate/gate-event-store.ts"
    ) as { appendGateEvent: (logPath: string, event: unknown) => void };
    appendGateEvent(path.join(root, ".quay", "gate-events.jsonl"), {
      id: randomUUID(),
      item_id: task,
      pipeline_id: task,
      gate: "complete",
      actor,
      verdict: "pass",
      timestamp: new Date().toISOString(),
      payload: { from: "ready", to: "done" },
    });
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

// ── ADR-007 per-milestone predicate on the MECHANICAL flip
//    (gap-mechanical-fan-in-flip-bypasses-adr007-dark-axis-predicate) ────────────────────────────
//
// THE DEFECT: the predicate's only enforcement points were the lifecycle verbs
// (`runComplete`/`runCompleteLoop`/`runCompleteOutOfBand` → `enforceDarkAxis`). The PRODUCTION
// landing path is the mechanical fan-in, which writes `status: done` from its own frontmatter patch
// (`flipTaskDone`) and never traverses them — measured 2026-10-22: 816 `complete` events vs 36
// `dark-axis` events since 2026-09-14, and replaying the predicate over the 793 distinct tasks the
// driver landed gives MISSING 782 / DISCLAIMED 11 / RECORDED 0. The step below closes that hole:
// it sits AFTER `ac-gate` and BEFORE `flipTaskDone`, and it is the same judgment, not a plugin-side
// re-derivation (⛔ no second L_D/L_G regex — CLAUDE.md 硬规则 5b).

/** The task-body classifier the mechanical flip uses, as a PATH-taking function so the AC3 evidence
 *  can drive it over a whole task population exactly as the CLI does.
 *
 *  A file that cannot be READ is `NOT-EVALUATED`, its own value (硬规则 3b): "could not look" must
 *  never wear the shape of a verdict about the body's content. This mirrors the CLI
 *  (`dark-axis-record-check.ts`: a missing task file ⇒ exit 2), which is why the two faces agree
 *  state-for-state over a read-only population (AC3). */
export function darkAxisVerdictForTaskFile(taskFile: string): DarkAxisVerdict {
  let text: string;
  try {
    text = fs.readFileSync(taskFile, "utf8");
  } catch (e) {
    return {
      state: "NOT-EVALUATED",
      readings: [],
      disclaimer: null,
      reason:
        `NOT-EVALUATED — the task body could not be read at ${taskFile}: ${(e as Error)?.message ?? String(e)}. ` +
        `An unreadable input is neither evidence of a record nor evidence of its absence (硬规则 3b).`,
    };
  }
  return classifyDarkAxisRecord(taskBodyOf(text));
}

/** The file the mechanical flip classifies: the WORKTREE's task file (the tree that is about to be
 *  merged), not the main checkout's copy — the body must be the one this landing carries. */
export function darkAxisTaskFileFor(worktree: string, task: string): string {
  return path.join(worktree, "tasks", `${task}.md`);
}

/** Map the four-state classification onto the gate ledger's three-value vocabulary
 *  (`GateVerdictKind`). ⛔ MISSING and NOT-EVALUATED stay DISTINGUISHABLE in the ledger: collapsing
 *  "nothing recorded" and "could not read" into one `fail` would recreate, one layer down, exactly
 *  the conflation `classifyDarkAxisRecord` was built to avoid (硬规则 3b). */
function darkAxisLedgerVerdict(state: DarkAxisVerdict["state"]): "pass" | "fail" | "not-evaluated" {
  if (state === "RECORDED" || state === "DISCLAIMED") return "pass";
  return state === "NOT-EVALUATED" ? "not-evaluated" : "fail";
}

/** Append the `dark-axis` GateEvent for ONE mechanical-flip judgment — via the SAME gate-event store
 *  the CLI/loop/complete writer uses (⛔ never a hand-rolled JSONL append). The event is what turns
 *  "complete / dark-axis ratio" into a directly readable quantity (the task's AC6), so unlike the
 *  `complete` event (written after landing, where a failure must not block) this one is a
 *  PRECONDITION: its caller treats a write failure as a refusal to flip — a judgment that leaves no
 *  trace is indistinguishable from no judgment. actor is `quay-driver` (the fan-in's own identity,
 *  matching `appendCompleteGateEvent`'s default). */
export async function appendDarkAxisGateEvent(
  root: string,
  task: string,
  verdict: DarkAxisVerdict,
  ctx: { runId?: string } = {},
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const { appendGateEvent } = await import(
      "../../packages/quay/src/gate/gate-event-store.ts"
    ) as { appendGateEvent: (logPath: string, event: unknown) => void };
    appendGateEvent(path.join(root, ".quay", "gate-events.jsonl"), {
      id: randomUUID(),
      item_id: task,
      pipeline_id: task,
      gate: "dark-axis",
      actor: "quay-driver",
      verdict: darkAxisLedgerVerdict(verdict.state),
      timestamp: new Date().toISOString(),
      payload: {
        state: verdict.state,
        reason: `dark-axis (ADR-007 per-milestone predicate): ${verdict.reason}`,
        step: "mechanical-fan-in",
        ...(ctx.runId ? { runId: ctx.runId } : {}),
      },
    });
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

/** gap-mechanical-fan-in-per-suite-runid-unified — 生成一次机械 fan-in 的 per-suite runId
 *  （`mfi-<task>-<epoch-ms>-<rand>`）。⛔ 不用共享的 wk-prod（那是 driver 轮次号，一 driver 轮次内多个
 *  suite 共用，不能当 suite 身份）；也⛔ 不把 runId（fan-in 过程身份，锁/日志/ff 用它）当 suite 身份——
 *  suite 身份必须每次 fan-in 唯一（epoch-ms + rand 双重唯一）——AC2「同一 driver 轮次两个不同任务的
 *  per-suite runId 不同」。独立成函数供测试直接调用（⛔ 不内联 randomUUID 让「每次新」无处可验）。 */
export function newMechanicalSuiteRunId(task: string): string {
  return `mfi-${task}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

/** gap-fan-in-red-bucket-run-not-recorded — 机械 fan-in 的 suite 步缺省命令：经 full-suite-runner.ts
 *  --buckets 跑（正确的 runner，green+red 桶轮次都在 suite 退出时入 verification-round.jsonl），⛔ 不是
 *  平行 `bash scripts/test.sh --buckets`（绕开唯一 writer，红桶轮次零记录——硬规则 3b「没跑过」与
 *  「跑了但红」同形）。--root <worktree> 是受测检出（test.sh 在 worktree 内跑）；--state-dir <root>/.quay
 *  把 state/verification-round/measure-history/suite-load 落进共享主检出（/tests 的读取处）；--runner inner
 *  显式标注层身份；--log-file <suiteLogFile> 让 runner 把 suite 流 tee 进 fan-in 的 /tmp 日志
 *  （spawnSuiteAndWait 的静默看门狗盯其 mtime——runner 不写 stdout，须经此缝让看门狗看到进度）。
 *  --run-id <runId> 把 per-suite 身份传给 runner（gap-mechanical-fan-in-per-suite-runid-unified：
 *  runner 用它当 runId，贯穿 full-suite-state / generation guard / suite-load-<runId>.jsonl / 记录，
 *  使 /tests 按记录 runId 查得到负载曲线）。
 *  runner 路径经 kernelSiblingArgv 锚在本 kernel 安装位置（⛔ 非 opts.worktree ——
 *  gap-plugin-root-resolution-remaining-callsites-round2：第三方项目无 plugin/scripts/，锚在 worktree
 *  会 Cannot find module ⇒ 挡住任务落地）。
 *  抽成纯函数便于 worker-driver.test.mjs 断言缺省命令是 runner 而非 test.sh harness（AC2）。 */
/** 机械 fan-in suite 步的解析结果（硬规则 3b）。两种产物都是【一条 argv】，调用方从 argv 本身分不清
 *  「真会跑 suite」与「本项目没有测试能力（fail-closed exit 2）」——所以这里把成因一并交出来：
 *  `capabilityMissing` 非 null ⇒ `argv` 是 {@link suiteCapabilityFailClosed} 的产物。goal 并入据此给
 *  该步一个**独立 step 取值**（`suite-capability`），⛔ 不与「suite 跑了且失败」同形（读事件的人不会
 *  把一个项目配置问题当成代码问题去查）。 */
export interface MechanicalSuiteResolution {
  argv: string[];
  capabilityMissing: string | null;
}

/** `defaultMechanicalSuiteCommand` 的三态版（argv + 成因）。⛔ 判据只有一处：本函数是 suite 能力解析的
 *  单一实现，`defaultMechanicalSuiteCommand` 只是它的 argv 投影（5b：同一个判类不得写两份）。 */
export function resolveMechanicalSuiteCommand(opts: {
  task: string;
  worktree: string;
  root: string;
  suiteLogFile: string;
  runId: string;
}): MechanicalSuiteResolution {
  // 本仓库（scripts/test.sh 存在）⇒ full-suite-runner（本仓库 bucket 化测试基建，行为与修改前逐字
  // 一致）；第三方项目无该文件 ⇒ 直接委托 loop.test_command（全量）——⛔ 不调用 full-suite-runner
  // （其内部锚点假设本仓库结构，gap-driver-fanin-hardcoded-test-sh-third-party 范围扩展：修 5 处
  // __dirname 是治标，第三方本就不该走这条路径）。
  const contract = readLoopFanInContract(opts.worktree);
  const sr = contract.suiteRunner;
  if (sr.state === "invalid") {
    // 声明了但读不懂 ⇒ fail-closed，⛔ 不静默当成 delegated（那是把「配置写错」伪装成「跑过了」）。
    const cause = `suite-runner-declaration-unreadable: loop.suite_runner = ${sr.raw}（有效值：quay-buckets | delegated）`;
    return { argv: suiteCapabilityFailClosed(cause), capabilityMissing: cause };
  }
  if (sr.state === "declared" && sr.value === "quay-buckets") {
    return {
      argv: [
        "node", "--no-warnings", ...kernelSiblingArgv("full-suite-runner.ts"),
        "--buckets", opts.task,
        "--root", opts.worktree,
        "--state-dir", path.join(opts.root, ".quay"),
        "--runner", "inner",
        "--log-file", opts.suiteLogFile,
        "--run-id", opts.runId,
      ],
      capabilityMissing: null,
    };
  }
  // declared "delegated" 或未声明 ⇒ 用本项目自己声明的全量命令（loop.test_command）。该项目自己的
  // test_command（如 `node --test`）依赖 cwd 定位测试树 ⇒ 显式 cd 进 worktree 再跑
  // （spawnSuiteAndWait spawn 不设 cwd）。
  const testCommand = contract.testCommand;
  if (testCommand !== null) {
    return { argv: ["bash", "-c", `cd ${shq(opts.worktree)} && ${testCommand}`], capabilityMissing: null };
  }
  // 无全量测试能力（quay-init 对第三方已 fail-closed 缺 test_command，此分支仅防半初始化工作区）。
  // fail-closed 且可区分（⛔ 不与「suite 跑了且失败」同形）。⛔ 不再以「命令不存在」的 exit code 127
  // 形态出现——「能力不存在」须可区分于「命令不存在」（GOAL-012 退出条件②；
  // gap-ac227-third-party-capability-degradation）。
  const cause = sr.state === "declared"
    ? "no-suite-tooling: loop.suite_runner=delegated 但未声明 loop.test_command（无测试能力）"
    : "no-suite-tooling: 未声明 loop.suite_runner 且未声明 loop.test_command（无测试能力）";
  return { argv: suiteCapabilityFailClosed(cause), capabilityMissing: cause };
}

/** suite 步缺省命令（argv 投影，既有调用方与测试的 import 面逐字不变）。 */
export function defaultMechanicalSuiteCommand(opts: {
  task: string;
  worktree: string;
  root: string;
  suiteLogFile: string;
  runId: string;
}): string[] {
  return resolveMechanicalSuiteCommand(opts).argv;
}

/** 无测试能力的 fail-closed argv（exit 2 + 具名 cause；⛔ 不是 exit 127 的「命令不存在」形态）。 */
function suiteCapabilityFailClosed(cause: string): string[] {
  return ["bash", "-c", `echo ${shq(cause)} >&2; exit 2`];
}

/** gap-verification-round-bound-to-quay-shaped-suite-entry — 本 fan-in 的 suite 是否【不经
 *  full-suite-runner.ts】：只有声明 `suite_runner: quay-buckets` 才经该 runner；其余（delegated 或未
 *  声明）用它自己的 loop.test_command 跑全量 ⇒ runner 这条 verification-round 唯一 writer 不在路径上
 *  ⇒ 台账行须由本层补写（appendDelegatedSuiteRound）。
 *
 *  ⛔ 判据与 defaultMechanicalSuiteCommand / resolveScopedGateCommand 的分支【同源】（同一份声明），
 *  不新造第三种「算不算 quay 形态」的判法——三处一旦各判各的，「suite 跑在谁手里」与「谁负责入账」
 *  就会分叉（硬规则 5b：修一个别漏一簇）。
 *  未声明 test_command ⇒ false：那种工作区根本没有 suite 可跑（命令是 fail-closed exit 2 的「无测试
 *  能力」），没有「一轮 suite」可入账。 */
export function suiteRunsOutsideRunner(dir: string): boolean {
  const contract = readLoopFanInContract(dir);
  const viaBucketsRunner =
    contract.suiteRunner.state === "declared" && contract.suiteRunner.value === "quay-buckets";
  return !viaBucketsRunner && contract.testCommand !== null;
}

/** gap-verification-round-bound-to-quay-shaped-suite-entry — 第三方 fan-in 的 verification-round 入账：
 *  suite 的执行入口是项目自己的（loop.test_command），但【台账写入与「suite 由谁跑」解耦】——本函数把
 *  这一轮追加进 <root>/.quay/verification-round.jsonl（/tests 卡片读的正是这条载体）。
 *
 *  ⛔ 复用既有 shared writer（buildPreVerifiedRoundRecord + appendPreVerifiedRound）：runId/taskId/
 *  startedAt/durationMs/commit 全取本轮 fan-in 的真实读数；state 由调用方按 suite 结果给（绿/红都入账，
 *  与 full-suite-runner 的「红绿皆入账」契约一致——否则「跑了且红」与「没跑过」同形，硬规则 3b）。
 *  preverified=false（suite 确在本轮 fan-in 内真跑了，⛔ 非复用 capture）。
 *
 *  cpu_time_s 显式 null + cpu_source='not-wired'：第三方路径没有 cgroup scope / gnu-time 包裹 ⇒ 未测得，
 *  ⛔ 不写 0（0 会把「没测」伪装成「测得约 0」，硬规则 4）。laneCount 取 defaultLaneCount()——与同一轮
 *  mirrorMechanicalFanInSuiteState 写进 full-suite-state.json 的值同源，两个载体对同一轮不各说各话。
 *
 *  best-effort（观测写不得阻塞主执行，同 writeSuiteCapture / mirrorMechanicalFanInSuiteState）：失败返回
 *  {ok:false, reason}，由调用方 trace 进 .quay/fan-in-step-trace.jsonl —— 失败可见，但不伪装成通过
 *  （硬规则 3b：观测写失败的取值必须与「写成功」可区分）。 */
export function appendDelegatedSuiteRound(o: {
  task: string;
  runId: string;
  root: string;
  commit: string;
  startedAt: string;
  durationMs: number;
  state: "green" | "red";
  suiteLog: string;
  /** 受测 checkout（读它的 .quay/config.yml 的 loop.test_output —— AC5：项目声明的输出约定）。 */
  worktree: string;
  /**
   * gap-watchdog-killed-round-writes-no-verification-round-record — 这一轮【没有任何结论】时给一个
   * 机器 token（今天的取值：`watchdog-killed`）。与 `state` 一起传时产出 NOT-EVALUATED 形状
   * （state=red + evaluated=false + reason=<token>，⛔ 无 failures[]）。省略 = 既有行为逐字不变。
   * ⛔ 该形状与绿轮/红轮都可区分（evaluated:false vs true），这正是硬规则 3b 要的「独立取值」。
   */
  notEvaluated?: string;
}): { ok: boolean; reason: string | null; applied: Record<string, number> | null } {
  try {
    // AC5 — 项目自己声明的输出约定（缺声明 ⇒ null ⇒ writer 走内建解析，零回归）。
    const testOutput = readLoopTestOutput(o.worktree);
    const built = buildPreVerifiedRoundRecord({
      taskId: o.task,
      runId: o.runId,
      startedAt: o.startedAt,
      durationMs: o.durationMs,
      laneCount: defaultLaneCount(),
      load: readLoadAvg(),
      commit: o.commit,
      preverified: false,
      runner: "inner",
      state: o.state,
      // ⛔ 未传时显式 undefined（不是空串）——空串会落进 builder 的 token 校验分支并 fail-closed，
      // 把「评估过的一轮」误判成参数错（可区分取值不得被一个缺席参数伪造，硬规则 6）。
      notEvaluated: o.notEvaluated,
      suiteLog: o.suiteLog,
      // ⚠️ 字面量 "null"（字符串）而不是 JS null：writer 的「考虑过但取不到」哨兵是 CLI 形态的
      // `--cpu-time-s null`（builder 里 `raw === "null"` ⇒ 记录 cpu_time_s=null，硬规则 6/AC6），而 JS
      // null 会被 builder 的 `!= null` 判成「没传」⇒ 字段整个缺席（cpu_source 却写着 not-wired，两半不自洽）。
      cpuTimeS: "null",
      cpuSource: "not-wired",
      testOutput,
      root: o.root,
    }) as { record?: unknown; error?: string; appliedDeclared?: Record<string, number> | null };
    if (built.error) return { ok: false, reason: built.error, applied: null };
    appendPreVerifiedRound(path.join(o.root, ".quay", "verification-round.jsonl"), built.record);
    return { ok: true, reason: null, applied: built.appliedDeclared ?? null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e), applied: null };
  }
}

/** fan-in 过程日志文件名（`.quay/fan-in-<task>-<runId>.log` 的 basename）。runId 唯一后缀 ⇒ 跨 relaunch
 *  不复用（同 gap-fan-in-suite-log-cross-relaunch-reuse 防护——旧轮内容不残留）；runId 先 sanitize 到
 *  `[A-Za-z0-9_.-]`（⛔ 不把未净化的 runId 当路径段）。 */
export function fanInLogFileName(task: string, runId: string): string {
  const runIdSafe = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `fan-in-${task}-${runIdSafe}.log`;
}

/** gap-fan-in-suite-log-same-runid-overwrite — suite 日志文件名的【任务边界】分隔符。⛔ 不能用 `-`：
 *  任务 id 本身 kebab-case（实测 DIR-035 / DIR-035-A、exp5-M-CRYST / exp5-M-CRYST-A2 等前缀碰撞 300+ 对），
 *  用 `-` 分隔 ⇒ 轮转按 `fan-in-suite-<task>-` 前缀匹配会把兄弟任务（`<task>-<suffix>`）的日志一并删掉
 *  （硬规则 5b：修一个别漏一簇）。`~` 不在 task/runId 的 sanitize 字符集 `[A-Za-z0-9_.-]` 内 ⇒ 它只能
 *  是分隔符本身，前缀 `fan-in-suite-<task>~` 对任意 task id 都无歧义。 */
const SUITE_LOG_DELIM = "~";

/** suite 日志文件名（`.quay/fan-in-suite-<task>~<runId>~<attempt>.log` 的 basename）。runId 唯一后缀 ⇒
 *  跨 relaunch 不复用（同 gap-fan-in-suite-log-cross-relaunch-reuse 防护——旧轮内容不残留）；attempt
 *  唯一后缀（epoch-ms + rand 双唯一）⇒ 同一 runId 内多次独立 suite 运行互不覆盖
 *  （gap-fan-in-suite-log-same-runid-overwrite AC1）。task/runId 都先 sanitize 到 `[A-Za-z0-9_.-]`
 *  （⛔ 不把未净化的 id 当路径段；也保证 `~` 分隔符在 id 内部永不出现 ⇒ 轮转前缀匹配无歧义）。 */
export function suiteLogFileName(task: string, runId: string, attempt: string): string {
  const taskSafe = task.replace(/[^A-Za-z0-9_.-]/g, "_");
  const runIdSafe = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `fan-in-suite-${taskSafe}${SUITE_LOG_DELIM}${runIdSafe}${SUITE_LOG_DELIM}${attempt}.log`;
}

/** 生成一次 suite 日志的 attempt 后缀（epoch-ms + rand 双唯一——同一 runId 内多次 suite 不覆盖）。
 *  独立成函数供测试直接调用（⛔ 不内联 randomUUID 让「每次新」无处可验；同 newMechanicalSuiteRunId 形态）。 */
export function newSuiteLogAttemptSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 6)}`;
}

/** 轮转：删除某任务名下全部历史 suite attempt 日志（landed 后调用——任务落地，红 attempt 日志不再
 *  需要回溯，⛔ 长期运行 .quay/ 无限堆积孤儿 fan-in-suite-*.log；gap-fan-in-suite-log-same-runid-
 *  overwrite AC3）。用 `<task>~` 前缀精确匹配（⛔ 裸 `<task>-` 会误删兄弟任务 `<task>-<suffix>` 的日志）。
 *  best-effort：删除失败不致命（landing 判定不依赖它）。返回删除的文件数（供 trace）。 */
export function pruneTaskSuiteLogs(root: string, task: string): number {
  const dir = path.join(root, ".quay");
  const taskSafe = task.replace(/[^A-Za-z0-9_.-]/g, "_");
  const prefix = `fan-in-suite-${taskSafe}${SUITE_LOG_DELIM}`;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(prefix) && name.endsWith(".log")) {
        try {
          fs.rmSync(path.join(dir, name), { force: true });
          removed += 1;
        } catch { /* best-effort — 单文件删除失败不阻断轮转 */ }
      }
    }
  } catch { /* best-effort — 目录缺失/不可读 ⇒ 无可轮转 */ }
  return removed;
}

/** 追加一行 fan-in 过程 trace（JSONL，一行一 JSON；首字段 ts）。写失败不致命（运行时日志，
 *  ⛔ 不因日志写失败炸 fan-in——trace 是观测面不是正确性闸）。 */
export function appendFanInTrace(file: string, entry: Record<string, unknown>): void {
  const rec = { ts: new Date().toISOString(), ...entry };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
  } catch { /* best-effort runtime log */ }
}

// ── scoped-gate cache（gap-worker-premerge-scoped-gate-cache）──────────────────────────────────────
// worker 退出前 agent-mediated pre-merge + scoped test 后，机械记录 (task, developSha, verdict=pass)
// 到 .quay/scoped-gate-cache.json（仿 .quay/doc-check-cache.json 的既有模式）。driver 锁内
// merge-develop 之后、scoped-gate 之前查这份缓存：当且仅当锁内合并到的 develop tip 与 worker 记录的
// developSha 完全一致才跳过 scoped-gate（可证明冗余——worker 已对着这个确切状态验证过绿）；develop
// 前进 / 缓存缺失 / 读不懂 ⇒ 照跑（fail-closed，与 docCheckLeg 的「面未变才命中、算不出就照跑」同一条
// 纪律）。只缓存绿、⛔ 键算不出 ⇒ 照跑。
// 读/写原语【只有一处实现】= doc-check-cache.ts 的 readGreenCache/writeGreenCache（下面的
// readScopedGateCache/writeScopedGateCache 是别名而非复制）——两面的缓存曾是逐字相同的两份函数体。

/** 缓存键 = `${task}\t${developSha}`（task id 不含 \t；developSha 是 develop tip 的完整 sha）。
 *  (task, developSha) 二元组唯一确定键——develop 前进一个提交即失配（未命中照跑）。 */
export function scopedGateKey(task: string, developSha: string): string {
  return `${task}\t${developSha}`;
}

/** 缓存条目形：最后一个 GREEN scoped-gate verdict，键 = scopedGateKey(task, developSha)。
 *  ⛔ 不是第二份声明——green-verdict 条目形只有一处定义：doc-check-cache.ts 的 GreenCacheEntry。 */
export type ScopedGateCacheEntry = GreenCacheEntry;

/** 读键为 `key` 的缓存绿 verdict。命中（key 完全一致 + ok:true）⇒ true；未命中/缺失/损坏/非绿 ⇒
 *  null（fail-closed——null 永不是命中）。实现 = doc-check-cache.ts 的共享 readGreenCache（别名，
 *  ⛔ 不复制函数体——本函数体曾与 readDocCheckCache 逐字相同，见 gap-routine-semantic-dedup-scan-
 *  doc-check-cache-vs-scoped-gate-cache）。 */
export const readScopedGateCache = readGreenCache;

/** 写 GREEN verdict（原子替换；只有绿才被缓存——worker 仅在 scoped 门跑绿后调用）。best-effort：
 *  写失败 ≠ fan-in 失败。实现 = doc-check-cache.ts 的共享 writeGreenCache（别名，⛔ 不复制函数体）。 */
export const writeScopedGateCache = writeGreenCache;

// ── scoped 门取值（三态；gap-scoped-gate-thin-selection-not-same-shape-as-green）─────────────────────
// 缺陷：scoped 命令【取零个测试文件】时退出 0，fan-in 把它记成与「真评了 ≥1 个文件且全绿」同形的
// ok:true ⇒ 硬规则 3b 的假绿。生产实例（claudecodeui `scripts/test.sh:114`）：交付物是 `scripts/*.sh`
// 的任务从 `## Touches` 抽到 0 个 `*.test.*` ⇒ 打印 `no scoped test files for <id> (thin)` 后 exit 0，
// fan-in 侧记成 ok:true；项目不得不自造 `scripts/suite-scope-check.sh` 自救。
//
// 修法 = 把契约写成【接口】（scoped 命令自己有「评没评」的知识，只有它能说）：
//   scoped 命令**没有可评对象**时，必须往 stdout 打一行 `SCOPED-THIN selected=<n>`（thin ⇒ n=0）
//   并仍以 exit 0 退出。fan-in 见到该标记 ⇒ 记 `not-evaluated`（⛔ 不记 green，也⛔ 不当失败——
//   全量 suite 照跑，那才是唯一真评过的东西）。⛔ 未打印标记的命令无法与 green 区分——这是契约的
//   代价，故接口必须写进 quay-init 的文档供第三方遵循（plugin/skills/init/SKILL.md）。
//
// 退出码语义不变（0=绿 / 非零=红）；标记只在 exit 0 时才被读（非零 ⇒ red，fail-closed——一个真失败的
// 命令就是真失败，⛔ 不让「它说自己没评」把红洗成 not-evaluated）。

/** scoped 命令的输出契约标记。判定按【位置】：行首（trim 后）命中才算，⛔ 不是「输出里任意位置出现
 *  该词」（硬规则 2：注释/字符串/日志正文里提到不算命中）。 */
export const SCOPED_THIN_MARKER = "SCOPED-THIN";

/** scoped 门的取值（三态，两两不同形，硬规则 3b）：green = 真评了且全绿；red = 真评了且有红；
 *  not-evaluated = **没评成**（thin / 该项目未声明该能力 / 声明不可读）。⛔ 第三态不得与「合格」
 *  共用取值——那正是本缺陷的形态。 */
export type ScopedGateVerdict = "green" | "red" | "not-evaluated";

/** 从 scoped 命令的输出（stdout+stderr 合并流）里读输出契约标记。无标记 ⇒ `{thin:false}`（调用方
 *  按「真评了」处理——契约面上无可区分信息，⛔ 不臆造）。有标记 ⇒ thin:true，并尽力取 `selected=<n>`
 *  （取不到 ⇒ null，⛔ 不伪造成 0——「没写计数」与「评了 0 个」不同形）。 */
export function parseScopedThin(output: string): { thin: boolean; selected: number | null; detail: string } {
  const line = String(output ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(SCOPED_THIN_MARKER));
  if (line === undefined) return { thin: false, selected: null, detail: "" };
  const m = /(?:^|\s)selected=(\d+)(?:\s|$)/.exec(line);
  const selected = m ? Number(m[1]) : null;
  return { thin: true, selected, detail: selected === null ? line : `selected=${selected}` };
}

/** scoped 门三态取值的单一真相源（fan-in 执行侧的三个入口共用：未声明该能力 / 缓存命中 / 真跑）。
 *  ⛔ 取值与 reason 只在这里产生——判据与测试对着同一处，⛔ 不各写一套标准。
 *  - skip      ⇒ not-evaluated（reason = 该项目的可区分取值）
 *  - cache-hit ⇒ green（worker 已对着【同一 develop tip】跑绿，出处写在 reason 里；⛔ 不是「没评」）
 *  - run       ⇒ exit 非零 ⇒ red；exit 0 且有 thin 标记 ⇒ not-evaluated；否则 green
 *  只有 run 的 not-evaluated 带 `scoped-thin(...)` 出处（它是本任务新增的那一态）。 */
export function scopedGateVerdict(o:
  | { state: "skip"; skipReason: string }
  | { state: "cache-hit" }
  | { state: "run"; ok: boolean; output: string }): { verdict: ScopedGateVerdict; reason: string | null } {
  if (o.state === "skip") return { verdict: "not-evaluated", reason: o.skipReason };
  if (o.state === "cache-hit") return { verdict: "green", reason: "cache-hit(worker-premerge)" };
  if (!o.ok) return { verdict: "red", reason: null }; // 判词走既有失败摘要路径（⛔ 不在这里另造一套）
  const thin = parseScopedThin(o.output);
  if (thin.thin) return { verdict: "not-evaluated", reason: `scoped-thin(${thin.detail})` };
  return { verdict: "green", reason: null };
}

/** 本轮重跑子进程的墙钟上限（gap-fan-in-suite-red-no-in-round-rerun-of-red-files 的测试缝
 *  `opts.rerunTimeoutMs` 的缺省）。重跑只跑【日志点名的失败文件】（通常远小于全量 suite 的 9-11min），
 *  但给足余量：它不是正确性闸，长一点只花时间；⛔ 被中止 ⇒ `rerun-not-evaluated`（fail-closed，不放行）。 */
export const RERUN_TIMEOUT_MS = 300_000;

/**
 * driver 机械跑通一次无失败 fan-in 的 happy path（锁/merge/delta/typecheck/scoped门/suite/ff）。
 * ⛔ 语义失败点（merge 冲突 / anti-drift HARD FAIL / typecheck 红 / suite 红 / ff 失败）一律返回
 * outcome=red + step，由调用方回退旧 workflow 子代理兜底（本函数不调 LLM、不做语义修复）。
 * 锁在任一退出路径都会 release（finally）——成功 release 于 ff 之后（AC2）；失败也 release（回退的
 * workflow 子代理会重新 acquire，幂等）。
 */
export async function runMechanicalFanIn(opts: MechanicalFanInOptions): Promise<MechanicalFanInResult> {
  const { task, worktree, root, runId } = opts;
  // gap-mechanical-fan-in-per-suite-runid-unified — the per-suite runId (suite 身份，非 runId 的过程身份)。
  // Generated ONCE per fan-in (each fan-in = one suite) so the runner's full-suite-state / suite-load-
  // <runId>.jsonl / verification-round record all carry the SAME key the /tests page joins on.
  const perSuiteRunId = opts.perSuiteRunId ?? newMechanicalSuiteRunId(task);
  const mergeTarget = opts.mergeTarget ?? "develop";
  const slotBase = opts.slotBase ?? suiteLockBase(root);
  // ⛔ 非 root/plugin/scripts/（第三方项目无 plugin/）——resolveKernelShellSibling 锚在本 kernel 安装
  // 位置；缺 ⇒ 回退 kernel plugin root 下的同路径（suite 取槽时 `source <缺失路径>` 报错 ⇒ fail-closed）。
  const slotLib = opts.slotLib ?? (resolveKernelShellSibling("suite-slot-lib.sh")
    ?? path.join(resolveKernelPluginRoot(), "scripts", "suite-slot-lib.sh"));
  const suiteCapture = opts.suiteCapture ?? `/tmp/fan-in-suite-${task}.env`;
  const runIdSafe = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
  // 过程日志（A1，gitignored 运行时日志）：.quay/fan-in-<task>-<runId>.log，逐步骤 trace。
  const fanInLog = path.join(root, ".quay", `fan-in-${task}-${runIdSafe}.log`);
  // 套件日志（A2）：从 /tmp 迁到 .quay/（durable——/tmp 系统清理实证见 3389 个测试遗留目录）。文件名带
  // runId + attempt——⛔ 不再复用 /tmp/fan-in-suite-${task}.log（跨 relaunch 残留旧轮内容，
  // gap-fan-in-suite-log-cross-relaunch-reuse）；attempt 唯一后缀 ⇒ 同一 runId 内多次 suite 互不覆盖
  // （gap-fan-in-suite-log-same-runid-overwrite AC1）。
  const suiteLogFile =
    opts.suiteLogFile ?? path.join(root, ".quay", suiteLogFileName(task, runId, newSuiteLogAttemptSuffix()));
  const suiteStateFile = opts.suiteStateFile ?? path.join(root, ".quay", "full-suite-state.json");
  const scriptsDir = opts.scriptsDir ?? resolveKernelScriptsDir();
  // P2 (gap-execution-loop-productization-p2-p4): the ff 持锁段 is now a TS module (packages/quay/
  // fan-in/ff-merge.ts), IMPORTED — ⛔ no shell-out to the retired bash fan-in-ff-merge.sh.
  // gap-resolve-kernel-src-module-strip-types-node-modules: 生产走静态字面量动态 import（源树相对解析，
  // shipped bundle 由 coreSrcAliasPlugin 内联）；opts.ffMergeModule 测试缝保留（hermetic 仓库 worktree
  // 无 packages/quay/src ⇒ 由测试显式传 FF_MERGE_MODULE）。
  // 编排脚本（anti-drift/classify/typecheck/ac-gate）：opts.scriptsDir 覆盖（hermetic 测试缝，⛔ 生产不用）
  // ⇒ <scriptsDir>/<name>.ts 直拼（带 --experimental-strip-types）；缺省 ⇒ kernelSiblingArgv（第三方项目无
  // plugin/scripts/，.ts 已 bundle 成 dist/*.js，resolveKernelSibling 回退到 .js 且不带 flag——
  // gap-plugin-root-resolution-remaining-callsites-round2）。
  const gateArgv = (name: string): string[] =>
    opts.scriptsDir
      ? ["node", "--experimental-strip-types", path.join(opts.scriptsDir, name)]
      : ["node", ...kernelSiblingArgv(name)];
  const antiDrift = gateArgv("anti-drift-touches-check.ts");
  const classify = gateArgv("select-static-checks-for-touches.ts");
  const typecheck = gateArgv("fan-in-ts-typecheck-gate.ts");
  const acGate = gateArgv("fan-in-ac-completion-gate.ts");

  // gap-mechanical-fan-in-red-lock-times-null：失败结果在【release 之后】才读锁时间（同成功路径
  // :3625 的时机）——⛔ 不能在 try 内 return 时就地读（release 事件尚未落盘 ⇒ lockHoldSecs 恒 null），
  // 也不能事后补读（后续重试会追加更新的 acquire/release ⇒ readFanInLockHold 取最后一组 ⇒ 张冠李戴）。
  // pendingRed = 已获锁失败结果的待填句柄：verdictOf/failSuite 构造时不带锁字段，finally release 后统一填。
  let pendingRed: MechanicalFanInResult | null = null;

  // D6：单步失败产出结构化 verdict（⛔ 不再是 `(stderr||stdout).trim()` 裸流）。裸流 dump 进 logFile、
  // summary 去噪保留「哪个测试失败」，reason 是 summary 的投影（旧读面，⛔ 不含 MODULE_TYPELESS 噪声）。
  const verdictOf = (step: string, exitCode: number | null, summary: string, logFile: string | null): MechanicalFanInResult => {
    const r = {
      outcome: "red",
      verdict: { step, verdict: "failed", exitCode, summary, logFile },
      step, reason: summary,
      suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
      suiteLog: null,
      fanInLog: path.basename(fanInLog),
      // suite 红之外的失败步：重跑不适用（`null` = 不适用，⛔ 不是「未评估」）；受测树 SHA 见
      // mergeTreeSha/developSha（suite 跑过才有值）。
      mergeTreeSha, developSha, failedTestFiles, rerun,
    } as unknown as MechanicalFanInResult; // 锁字段在 finally release 后填（见 pendingRed）
    pendingRed = r;
    return r;
  };
  const stepLogFile = (step: string): string =>
    `/tmp/fan-in-step-${task}-${runId.replace(/[^A-Za-z0-9_.-]/g, "_")}-${step}.log`;
  // 有裸流的机械步：stdout+stderr 全量 dump 进 logFile，summary 从合并流提取（⛔ 只取 stderr 会丢
  // stdout 里真正的测试结果——D6 的病根）。dump 失败不致命（logFile=null，summary 仍可定位）。
  const fail = (step: string, a: MechShResult): MechanicalFanInResult => {
    const combined = combinedOutput(a.stdout, a.stderr);
    const summary = extractFailureSummary(combined) || `exit ${a.status}`;
    const logFile = stepLogFile(step);
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, combined, "utf8");
    } catch {
      return verdictOf(step, a.status, summary, null);
    }
    return verdictOf(step, a.status, summary, logFile);
  };
  // 无裸流的机械步（reason 已结构化：flip-done / exception；acquire-fan-in-lock 走独立构造——结构性例外）。
  const failClean = (step: string, summary: string, exitCode: number | null = null): MechanicalFanInResult =>
    verdictOf(step, exitCode, summary, null);

  // 逐步骤 trace（A1，gap-mech-fan-in-log-webui-visible-clickable）：每步追加一行 {ts, step, exit,
  // wall_ms, ok} 到 .quay/fan-in-<task>-<runId>.log（web 可见的过程日志），失败步附 reason。
  const trace = (entry: Record<string, unknown>): void => appendFanInTrace(fanInLog, entry);
  // suite 决策事件的两路 trace（gap-fan-in-step-trace-suite-step-stopped-writing）：ac-precheck /
  // suite-start / suite-end / suite-skip 除写 per-run 过程日志（trace()，web 详情页 a5a301e03 的读者）
  // 外，还必须镜像到共享载体 .quay/fan-in-step-trace.jsonl（appendFanInStepTrace，跨任务/跨时间聚合
  // 监控的读者，如 gap-archguard-p5-instrument-decay-standing-guard）——两者服务不同读者，⛔ 互斥=分裂
  // （原 bug：只写 per-run 让共享读者永久看不到这批步骤）。phase 统一 "end"（单发事件，⛔ 用 "begin"
  // 会给挂起检测留下「begin 无 end」的假挂起）。与 trace() 一一对应 ⇒ 两载体 suite 条目数一致（AC3）。
  //
  // 时长（gap-fan-in-step-trace-suite-steps-write-end-without-begin AC2）：共享载体上这批事件
  // **自带 `durationMs`**（= per-run 的 `wall_ms`，同一读数），因此 suite 时长不必、也不能靠
  // begin/end 配对得到（它们本就没有 begin——AC1 的孤儿根因）。两个载体各自的时长效字段名不同是
  // 刻意的：per-run 的读者（web 详情页 / fan-in-execute 的 poll 证书）认 `wall_ms`，共享载体的
  // 聚合读者认 `durationMs`；⛔ 不互相复制一份（同载体两个同义字段 = 漂移源）。
  const traceSuiteEvent = (step: string, extra: Record<string, unknown>): void => {
    const { wall_ms, ...rest } = extra as Record<string, unknown> & { wall_ms?: number };
    // 缺 wall_ms 的调用点是编码错误，不是「时长 0」——不过滤成 0，留 null 让读者看得出「没测」
    // （硬规则 6/3b：缺值 = 未查，⛔ 不与「合格」共用取值）。
    appendFanInStepTrace(root, task, runId, step, "end", {
      ...rest,
      durationMs: typeof wall_ms === "number" ? wall_ms : null,
    });
    trace({ step, ...extra });
  };
  // mechSh 步的包层：跑 + 计时 + 两路 trace——① appendFanInStepTrace begin/end（挂起 = begin 无 end，
  // 据 epoch 定位挂起步；gap-fan-in-subprocess-hang-timeout-recovery AC1）；② A1 一行过程日志。
  // `durMs` 算【一次】，共享载体的 `durationMs` 与 per-run 的 `wall_ms` 用同一个读数——⛔ 不各算一次
  // （两次 Date.now() 会给出两个不一致的「同一步时长」）。
  // `endExtra`（gap-scoped-gate-thin-selection-not-same-shape-as-green）：本节新增于「跑完才有读数」的
  // 步（scoped 门的三态取值）——它必须与 `ok`/`durationMs` 写在【同一条】end 记录里。⛔ 事后补写第二条
  // end 记录不是替代（同一 step 两条 end，在【不用配对读法】的读者看来是多跑了一次），故做成 step() 的
  // 入参而不是第二步。缺省不影响任何既有调用点（无 endExtra ⇒ 记录逐字同前）。
  const step = async (
    name: string,
    argv: string[],
    timeoutMs = 120_000,
    endExtra?: (r: MechShResult) => Record<string, unknown>,
  ): Promise<MechShResult> => {
    const t0 = Date.now();
    appendFanInStepTrace(root, task, runId, name, "begin");
    const r = await mechSh(argv, timeoutMs);
    const durMs = Date.now() - t0;
    const extra = endExtra?.(r) ?? {};
    appendFanInStepTrace(root, task, runId, name, "end", { ok: r.ok, durationMs: durMs, ...extra });
    trace({
      step: name, exit: r.status, wall_ms: durMs, ok: r.ok, ...extra,
      ...(r.ok || extra.reason !== undefined ? {} : { reason: extractFailureSummary(combinedOutput(r.stdout, r.stderr)) || `exit ${r.status}` }),
    });
    return r;
  };

  // 1. acquire fan-in lock（机械包裹整段 merge→suite→ff，AC4）。ADR-034：driver 自身经非分离
  // 直接子进程持锁（⛔ 废除 fan-in-ff-merge.sh 的 `& disown` 分离 holder + flag 释放协议）——锁的生死 =
  // 工作的进程生死，driver 死（含 SIGKILL）⇒ 内核关 stdin 写端 ⇒ holder 释放 flock。unbounded（无超时）：
  // fan-in 锁是正确性锁（「此刻谁可 merge develop」），排队等待正是它存在的意义（⛔ 120s 短超时会在
  // 等待时误杀，gap-mech-fan-in-acquire-lock-timeout-queue-semantics）。⛔ 无时间阈值（无 hold-max/TTL/stale）。
  let fanInLock: FanInLockHandle;
  const acquireT0 = Date.now();
  try {
    // SPEC-goal-branch §4.6（裁定⑥）：锁域随 mergeTarget 派生——goal 分支落地持自己的
    // `fan-in.goal-<GOAL>.lock`，develop 落地持 `fan-in.lock`（逐字不变），使一个方向的落地不阻塞别的。
    fanInLock = await acquireFanInLock({ root, task, runId, lockFile: fanInLockFileForMergeTarget(root, mergeTarget) });
    trace({ step: "acquire-fan-in-lock", exit: 0, wall_ms: Date.now() - acquireT0, ok: true });
  } catch (e) {
    trace({ step: "acquire-fan-in-lock", exit: 1, wall_ms: Date.now() - acquireT0, ok: false, reason: (e as Error)?.message ?? "acquire failed" });
    // 结构性例外（锁本身没拿到，无 acquire 事件可读）：锁字段显式 null。⛔ 不走 verdictOf 的 pendingRed
    // 填充路径——那条只对【已获锁之后】的失败有意义（gap-mechanical-fan-in-red-lock-times-null）。
    const reason = (e as Error)?.message ?? "acquire failed";
    return {
      outcome: "red",
      verdict: { step: "acquire-fan-in-lock", verdict: "failed", exitCode: null, summary: reason, logFile: null },
      step: "acquire-fan-in-lock", reason,
      lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null,
      suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
      suiteLog: null,
      fanInLog: path.basename(fanInLog),
      mergeTreeSha: null, developSha: null, failedTestFiles: null, rerun: null,
    };
  }
  const releaseLock = async (): Promise<void> => {
    await fanInLock.release();
  };
  let a: MechShResult;

  let suiteOutcome: SuiteOutcome | null = null;
  let suiteFinishedEpoch: number | null = null;
  let suitePid: number | null = null;
  // 仪器可用性读数（gap-fan-in-instrument-availability-self-check），探针在 step 6.9 填。null = 本次 fan-in
  // 在探针之前就返回了（未评估；⛔ 与「探过且判不出」不同形）。
  let instruments: InstrumentProbe | null = null;

  // A（gap-worker-execution-history-index-not-reachable-from-task）：suite 红时 verdict.logFile 指向
  // .quay/fan-in-suite-*.log（真因文件，⛔ 不再 null——旧一路 logFile:null 让 183KB 真因只能靠命名约定
  // 猜）+ suiteLog 落 mechanical_fan_in（与 fanInLog 同形的 basename，web/续做/needs-human 据此构造绝对路径）。
  // 受测合并树 / develop 基线 SHA + suite 红的取证读数（gap-fan-in-suite-red-no-in-round-rerun-of-red-files）。
  // suite 还没跑 ⇒ null；suite 红 ⇒ 下面逐条填（⛔ 三态：`null` = 不适用，`evaluated:false` = 未评估）。
  let mergeTreeSha: string | null = null;
  let developSha: string | null = null;
  let failedTestFiles: FailedTestFilesReading | null = null;
  let rerun: RerunReading | null = null;
  // 既存红等价 A/B 读数（null = 本轮没进 A/B；见 BaselineEquivalenceReading 的注释——那是**不适用**）。
  let baselineEquivalence: BaselineEquivalenceReading | null = null;

  const failSuite = (summary: string, exitCode: number | null): MechanicalFanInResult => {
    const r = {
      outcome: "red",
      verdict: { step: "suite", verdict: "failed", exitCode, summary, logFile: suiteLogFile },
      step: "suite", reason: summary,
      suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
      suiteLog: path.basename(suiteLogFile),
      fanInLog: path.basename(fanInLog),
      mergeTreeSha, developSha, failedTestFiles, rerun,
      baselineEquivalence,
    } as unknown as MechanicalFanInResult; // 锁字段在 finally release 后填（见 pendingRed）
    pendingRed = r;
    return r;
  };

  // ── 本轮内重跑（gap-fan-in-suite-red-no-in-round-rerun-of-red-files）──────────────────────────────
  // 病根：suite 步一旦红就直接 outcome:"red" 返回，本轮内没有任何重跑——任何再尝试都是一次【新的 worker
  // 派发】（续做 prompt + 重新 fan-in），而生产上的 suite 红多数不是该任务引入的。
  // 修法：suite 红且【日志点名了 ≥1 个失败测试文件】时，在【同一轮、同一把 fan-in 锁内、同一棵合并树上】
  // 只重跑这些文件；全绿 ⇒ 按绿继续落地（并记 rerun-green），仍有红 ⇒ 维持 red。
  // ⛔ 零项目知识：重跑对象只取自 suite 日志本身点名的文件；重跑命令由项目在 .quay/config.yml 的
  // `loop.rerun_command` 里【自己声明】——⛔ 产品代码不含任何「按已知脆弱族分名单」的概念（那条路
  // 2026-09-03 已被人裁定取消；被取消任务的 id 见本任务 ## Proposal 的 dedup-ref 段，⛔ 不在代码里
  // 复述那个 id：它的名字本身就带着该概念的英文 token，复述会让「产品代码零项目知识」这条判据
  // 变成一条按关键词 grep 就会被命中的假阳性）。
  // ⛔ 三态不得压平（硬规则 3b）：没有可用的重跑命令 / 解析不出文件 / 重跑自身被 watchdog 中止 ⇒
  // `rerun-not-evaluated`，行为与修改前逐字一致（仍 return failSuite，⛔ 不放行）。
  const runInRoundRerun = async (failed: FailedTestFilesReading): Promise<RerunReading> => {
    const t0 = Date.now();
    const notEvaluated = (reason: string): RerunReading => {
      traceSuiteEvent("rerun", { exit: 0, wall_ms: 0, ok: false, reason: `rerun-not-evaluated: ${reason}` });
      return { state: "rerun-not-evaluated", reason, files: [], exitCode: null, finishedEpoch: null, log: null };
    };
    if (!failed.evaluated) return notEvaluated(failed.reason);
    const resolved = opts.rerunCommand !== undefined
      ? { kind: "run" as const, argv: opts.rerunCommand }
      : resolveRerunCommand(worktree, worktree, failed.files);
    if (resolved.kind !== "run") return notEvaluated(resolved.reason);
    // 重跑日志与 suite attempt 日志同族（同前缀 `fan-in-suite-<task>~` ⇒ 落地时被 pruneTaskSuiteLogs
    // 一并轮转，⛔ 不新增一族无人清理的孤儿日志）。
    const logFile = path.join(root, ".quay", suiteLogFileName(task, runId, `rerun-${newSuiteLogAttemptSuffix()}`));
    const r = await mechSh(resolved.argv, opts.rerunTimeoutMs ?? RERUN_TIMEOUT_MS);
    const finishedEpoch = Math.floor(Date.now() / 1000);
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, combinedOutput(r.stdout, r.stderr), "utf8");
    } catch { /* 日志 best-effort：写失败不改变三态判定（判定只看退出码） */ }
    // 三态判定：0 ⇒ 绿；非 0 ⇒ 红；status===null（mechSh 墙钟到点组 kill）⇒ **未评估**（⛔ 被中止的重跑
    // 不得当成「仍然红」也不得当成「转绿」——两者都是伪造结论）。
    const state: RerunState = r.status === 0 ? "rerun-green" : r.status === null ? "rerun-not-evaluated" : "rerun-red";
    const reason = state === "rerun-not-evaluated" ? "rerun-aborted" : null;
    traceSuiteEvent("rerun", {
      exit: r.status, wall_ms: Date.now() - t0, ok: state === "rerun-green",
      state, namedFiles: failed.files.length,
      // AC6 — 点名的文件本身也留痕（不只是计数）：attempt 日志会被落地清理轮转掉，共享 step trace
      // （`.quay/fan-in-step-trace.jsonl`）不会 ⇒ 「本轮重跑了哪些文件」必须落在后者上。
      files: failed.files.slice(0, 200),
      ...(reason === null ? {} : { reason }),
    });
    return { state, reason, files: failed.files, exitCode: r.status, finishedEpoch, log: path.basename(logFile) };
  };

  // ── 既存红等价 A/B（gap-fanin-suite-gate-no-baseline-equivalent-exception）─────────────────────────
  // 见文件顶部本节的长注释。**机器执行的 A/B，不是 prose 声明**：起一棵 detached worktree @ mergeTarget,
  // 对它重跑同一批失败文件，逐字比对失败签名集合。⛔ 任何一步读不懂 ⇒ not-evaluated（调用方维持硬红）。
  const runBaselineEquivalence = async (
    taskLogText: string,
    failed: FailedTestFilesReading,
  ): Promise<BaselineEquivalenceReading> => {
    const t0 = Date.now();
    const traceVerdict = (verdict: BaselineEquivalenceVerdict, extra: Record<string, unknown> = {}): void => {
      traceSuiteEvent("baseline-red", {
        exit: 0, wall_ms: Date.now() - t0, ok: verdict.kind === "exempt",
        verdict: verdict.kind,
        ...(verdict.kind === "hard-red" ? { hardReason: verdict.reason, added: verdict.added.length, changed: verdict.changed.length } : {}),
        ...(verdict.kind === "not-evaluated" ? { reason: verdict.reason } : {}),
        ...extra,
      });
    };
    const notEvaluated = (reason: string): BaselineEquivalenceReading => {
      const v: BaselineEquivalenceVerdict = { kind: "not-evaluated", reason };
      traceVerdict(v);
      return { verdict: v, baselineWorktree: null, log: null };
    };
    if (!failed.evaluated) return notEvaluated(`no runnable failing-file set: ${failed.reason}`);
    const taskParse = parseFailureSignatures(taskLogText, worktree);
    if (!taskParse.evaluated) return notEvaluated(`task-side signatures unevaluable: ${taskParse.reason}`);
    const baseDir = opts.baselineWorktree
      ?? path.join(path.dirname(worktree), `.baseline-red-${task}-${runIdSafe}`);
    let baselineLog: string | null = null;
    try {
      // 陈旧残留（上一轮被中断）⇒ 先清；git worktree add 对已存在路径报错。
      try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      const add = await mechSh(["git", "-C", worktree, "worktree", "add", "--detach", baseDir, mergeTarget], 120_000);
      if (!add.ok) return notEvaluated(`baseline worktree add failed: ${(add.stderr || add.stdout || "").trim() || `exit ${add.status}`}`);
      // 基线树要能跑 [rerun_command]（本仓库是 `bash {worktree}/scripts/test.sh`）⇒ node_modules + config.yml。
      // best-effort：失败只记 trace，随后重跑若跑不起来会落 not-evaluated（⛔ 不把 provisioning 失败当成
      // 「等价」）。`null` = 夹具明确声明不需要 provisioning。
      if (opts.baselineProvisionCommand !== null) {
        const provision = opts.baselineProvisionCommand
          ?? (() => {
            const sib = resolveKernelShellSibling("dispatch-worktree-setup.sh");
            return sib ? ["bash", sib, baseDir, "--root", root] : null;
          })();
        if (provision !== null) {
          const pv = await mechSh(provision, 300_000);
          if (!pv.ok) {
            trace({ step: "baseline-provision", exit: pv.status, wall_ms: 0, ok: false, reason: "best-effort (non-fatal)" });
          }
        }
      }
      const resolved = opts.rerunCommand !== undefined
        ? { kind: "run" as const, argv: opts.rerunCommand }
        : resolveRerunCommand(worktree, baseDir, failed.files);
      if (resolved.kind !== "run") return notEvaluated(`no baseline rerun command: ${resolved.reason}`);
      const logFile = path.join(root, ".quay", suiteLogFileName(task, runId, `baseline-${newSuiteLogAttemptSuffix()}`));
      const rr = await mechSh(resolved.argv, opts.rerunTimeoutMs ?? RERUN_TIMEOUT_MS);
      // 与 runInRoundRerun 同族命名（落地时被 pruneTaskSuiteLogs 一并轮转，⛔ 不新增孤儿日志族）。
      try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(logFile, combinedOutput(rr.stdout, rr.stderr), "utf8");
        baselineLog = path.basename(logFile);
      } catch { /* 日志 best-effort */ }
      // status===null ⇒ mechSh 墙钟到点组 kill ⇒ **未评估**（⛔ 被中止的基线重跑不得当成「基线无该红」）。
      if (rr.status === null) return notEvaluated("baseline rerun aborted");
      const baseParse = parseFailureSignatures(combinedOutput(rr.stdout, rr.stderr), baseDir);
      if (!baseParse.evaluated) return notEvaluated(`baseline-side signatures unevaluable: ${baseParse.reason}`);
      const verdict = compareFailureSignatures(taskParse.signatures, baseParse.signatures);
      traceVerdict(verdict, { baselineFiles: baseParse.signatures.length, taskFiles: taskParse.signatures.length });
      return { verdict, baselineWorktree: baseDir, log: baselineLog };
    } catch (e) {
      return notEvaluated(`baseline A/B error: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      // 基线树是临时的：无论成败都清掉（best-effort）。
      try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      await mechSh(["git", "-C", worktree, "worktree", "prune"], 60_000).catch(() => undefined);
    }
  };

  try {
    // 2. merge mergeTarget（冲突 ⇒ red → 语义会话兜底）。
    a = await step("merge-develop", ["git", "-C", worktree, "merge", "--no-edit", mergeTarget], 120_000);
    if (!a.ok) return fail("merge-develop", a);

    // 2b. 追平（catch-up）develop —— SPEC-goal-branch-2026-10-03 §4.4 裁定③，仅当 mergeTarget 不是
    //     develop 时进入。落回 `goal/<id>` 的任务，其 worktree 先合入 `goal/<id>`（上一步），再把
    //     `develop` 追平进来：追平后的这棵树恰是被【本任务自己的全量 suite】验证过、随后被 ff 到
    //     `goal/<id>` 的同一棵树——⛔ 没有一棵未经验证的中间树（SPEC §4.4 的落地理由）。
    //     `--no-edit` 是必须的：追平要留下可核对的 merge 提交（AC-322 的判据把「该次落地内合入
    //     develop 的 merge 提交时间」当作追平时刻）；develop 已在祖先里时 git 报 "Already up to
    //     date"、不产生提交，此时 develop tip 本就是落地提交的祖先，判据退化为「该次落地最早提交
    //     时间」——两条路径都使 develop 的当时 tip 成为落地提交的祖先。
    //     ⛔ `mergeTarget === "develop"` 路径【逐字不变】（AC1）：本分支不进入，行为与改动前等价。
    if (mergeTarget !== "develop") {
      a = await step("catch-up-develop", ["git", "-C", worktree, "merge", "--no-edit", "develop"], 120_000);
      if (!a.ok) return fail("catch-up-develop", a);
    }

    // 3. anti-drift Touches 核对（HARD FAIL ⇒ red）。
    a = await step("anti-drift", [...antiDrift, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000);
    if (!a.ok) return fail("anti-drift", a);

    // 4. delta 断言面判定（doc-only 跳过 suite，code 跑 suite；判不出 fail-closed 跑 suite）。
    const deltaT0 = Date.now();
    const fork = await mechSh(["git", "-C", worktree, "merge-base", mergeTarget, "HEAD"], 30_000);
    const deltaFiles = await mechSh(["git", "-C", worktree, "diff", "--name-only", (fork.stdout || "").trim(), "HEAD"], 30_000);
    const deltaList = (deltaFiles.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    let codeDelta = "";
    if (deltaList.length > 0) {
      const cd = await mechSh([...classify, "--classify-delta", "--root", worktree, ...deltaList], 120_000);
      codeDelta = classifyDeltaOutcome(cd.ok, cd.stdout || "");
    }
    // 4b. develop 前进面复用（gap-fan-in-continue-doc-only-advance-reuse-suite）：任务自身 delta 是 code
    // 时，若上一轮 green bucket suite（full-suite-state.json 的 mirror 记录，taskId=本任务）之后、
    // 当前 HEAD 只触及 doc/inert 面（develop 在长 suite 期间被 doc/inert 前进 ⇒ ff not-fast-forward ⇒
    // CONTINUE 重跑，重跑时任务 delta 仍是 code），则复用上一 green 判定、不重跑 suite。判不出
    // （无上一 green / 非祖先 / classify 失败）⇒ fail-closed 照常跑 suite（硬规则 3b）。
    let reuseSkip = false;
    if (codeDelta !== "" && codeDelta !== CLASSIFY_FAILED) {
      const prevCommit = readPreviousGreenSuiteCommit(suiteStateFile, task);
      if (prevCommit) {
        const anc = await mechSh(["git", "-C", worktree, "merge-base", "--is-ancestor", prevCommit, "HEAD"], 30_000);
        if (anc.ok) {
          const sincePrev = await mechSh(["git", "-C", worktree, "diff", "--name-only", prevCommit, "HEAD"], 30_000);
          const sinceList = (sincePrev.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
          const adv = await mechSh([...classify, "--classify-delta", "--root", worktree, ...sinceList], 120_000);
          // 前进面全 doc/inert ⇒ 复用上一 green（同一映射：【没判出来】不构成复用理由）
          reuseSkip = classifyDeltaOutcome(adv.ok, adv.stdout || "") === "";
        }
      }
    }
    const needSuite = opts.forceSuite === true || codeDelta === CLASSIFY_FAILED || (codeDelta !== "" && !reuseSkip);
    trace({ step: "delta", exit: 0, wall_ms: Date.now() - deltaT0, ok: true, reason: needSuite ? (codeDelta === CLASSIFY_FAILED ? "classify failed → run suite (fail-closed)" : `code delta (${codeDelta || "forced"}) → run suite`) : (reuseSkip ? "code delta + doc/inert-only develop advance → reuse prev green (skip suite)" : "doc-only delta → skip suite") });

    // 5. ts-typecheck ∥ doc-check 并行（merge+anti-drift 后二者相互独立，可并行；doc-check 提前到
    //    scoped-gate 之前——廉价失败先于昂贵）。合并为一次 gate 判定：任一非零 ⇒ red → 语义会话兜底。
    //    失败报告顺序 typecheck 先于 doc-check（与串行序一致——AC3 判定一致性的读面）。
    // 三态解析（run / skip / fail）：声明了跑、未声明跳过（可区分取值）、声明了但读不懂 ⇒ fail-closed。
    const docRes: ScopedGateResolution =
      opts.docCheckCommand !== undefined
        ? { kind: "run", argv: opts.docCheckCommand }
        : resolveDocCheckCommand(worktree, worktree);
    // doc-check 缓存（gap-fan-in-doc-check-cache）：doc 面 = run_doc_checks 读的全部输入（@static-object
    // 判定对象 + plugin/scripts 检查器/仪器面 + scripts/test.sh + .gitignore + 全树文件结构）。面未变 ⇒
    // 命中上次绿 verdict（~0s，reason=cache-hit）；面变 ⇒ 失效重跑。⛔ 只缓存绿、⛔ 键算不出 ⇒ 照跑（fail-closed）。
    const docCacheFile = opts.docCheckCacheFile ?? path.join(root, ".quay", "doc-check-cache.json");
    const docCheckLeg = async (): Promise<MechShResult> => {
      const t0 = Date.now();
      // 未声明 doc_check_command ⇒ 跳过，可区分取值 no-doc-check-command-declared（⛔ 不与「doc 检查
      // 真的跑了且失败」同形，硬规则 3b）。声明了但读不懂 ⇒ fail-closed（⛔ 不静默降级成跳过）。
      if (docRes.kind === "fail") {
        return { ok: false, status: 2, stdout: "", stderr: docRes.reason, error: docRes.reason };
      }
      if (docRes.kind === "skip") {
        const reason = docRes.reason;
        const durMs = Date.now() - t0;
        appendFanInStepTrace(root, task, runId, "doc-check", "end", { ok: true, reason, durationMs: durMs });
        trace({ step: "doc-check", exit: 0, wall_ms: durMs, ok: true, reason });
        return { ok: true, status: 0, stdout: "", stderr: "", error: null };
      }
      const docCmd = docRes.argv;
      const docKey = computeDocCheckFaceKey(worktree);
      const cachedDocOk = docKey === null ? null : readDocCheckCache(docCacheFile, docKey);
      if (cachedDocOk === true) {
        trace({ step: "doc-check", exit: 0, wall_ms: Date.now() - t0, ok: true, reason: "cache-hit" });
        return { ok: true, status: 0, stdout: "", stderr: "", error: null };
      }
      const r = await step("doc-check", docCmd, 300_000);
      if (docKey !== null && r.ok) writeDocCheckCache(docCacheFile, docKey);
      return r;
    };
    const [tc, dc] = await Promise.all([
      step("typecheck", [...typecheck, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000),
      docCheckLeg(),
    ]);
    if (!tc.ok) return fail("typecheck", tc);
    if (!dc.ok) return fail("doc-check", dc);

    // 5.5 archguard 结构闸【已从 fan-in gate 链移除】（gap-fan-in-remove-archguard-gate）：零发火、零指引、
    // 27s/次串行关键路径（周 1.33h），降级为【按需命令】（AC3/AC4）——需要结构信号时手动跑：
    //   node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root>
    // 产物 append 进 <repo-root>/.archguard/metrics-history.jsonl（按需产出，不进 fan-in 关键路径）。

    // 6. scoped 门（必须绿）。worker 已在退出前对着同一 develop tip 跑绿并写缓存（gap-worker-premerge-
    //    scoped-gate-cache）⇒ 锁内 merge 到的 develop tip 与 worker 记录的 developSha 完全一致时跳过
    //    （可证明冗余——worker 已对着这个确切状态验证过绿）；develop 前进 / 缓存缺失 / 读不懂 ⇒ 照跑
    //    （fail-closed，同 docCheckLeg 的「面未变才命中、算不出就照跑」纪律）。
    const scopedRes: ScopedGateResolution =
      opts.scopedGateCommand !== undefined
        ? { kind: "run", argv: opts.scopedGateCommand }
        : resolveScopedGateCommand(task, worktree, worktree);
    const scopedCacheFile = opts.scopedGateCacheFile ?? path.join(root, ".quay", "scoped-gate-cache.json");
    const scopedT0 = Date.now();
    // 每个分支都写三态取值 `verdict`（gap-scoped-gate-thin-selection-not-same-shape-as-green）：
    //   skip（该项目未声明该能力）⇒ not-evaluated，取值 = 声明解析给出的可区分取值
    //   cache-hit                   ⇒ green（worker 已对着同一 develop tip 评过绿，出处写 reason）
    //   run                          ⇒ red / not-evaluated(thin) / green
    // ⛔ `ok` 仍是【控制流】字段（该步该不该让 fan-in 失败），`verdict` 才是【取值】——⛔ 不把
    // 「没评成」写成 ok 的某种取值（那正是本缺陷：not-evaluated 与 green 共用 ok:true）。
    // 三态解析（run / skip / fail）：声明了跑、未声明跳过（可区分取值 no-scoped-command-declared，
    // ⛔ 不与「scoped 门跑了且失败」同形，硬规则 3b）、声明了但读不懂 ⇒ **fail-closed**
    // （⛔ 不静默跳过——那会让「配置写错」与「项目没有该能力」不可分）。
    if (scopedRes.kind === "fail") {
      return fail("scoped-gate", { ok: false, status: 2, stdout: "", stderr: scopedRes.reason, error: scopedRes.reason });
    }
    if (scopedRes.kind === "skip") {
      const v = scopedGateVerdict({ state: "skip", skipReason: scopedRes.reason });
      const durMs = Date.now() - scopedT0;
      appendFanInStepTrace(root, task, runId, "scoped-gate", "end", { ok: true, verdict: v.verdict, reason: v.reason, durationMs: durMs });
      trace({ step: "scoped-gate", exit: 0, wall_ms: durMs, ok: true, verdict: v.verdict, reason: v.reason });
    } else {
      const scopedCmd = scopedRes.argv;
      const scopedDevelopSha = (await mechSh(["git", "-C", worktree, "rev-parse", mergeTarget], 30_000)).stdout.trim();
      const scopedCacheHit = scopedDevelopSha !== "" && readScopedGateCache(scopedCacheFile, scopedGateKey(task, scopedDevelopSha)) === true;
      if (scopedCacheHit) {
        const v = scopedGateVerdict({ state: "cache-hit" });
        const durMs = Date.now() - scopedT0;
        appendFanInStepTrace(root, task, runId, "scoped-gate", "end", { ok: true, verdict: v.verdict, reason: v.reason, durationMs: durMs });
        trace({ step: "scoped-gate", exit: 0, wall_ms: durMs, ok: true, verdict: v.verdict, reason: v.reason });
      } else {
        a = await step("scoped-gate", scopedCmd, 600_000, (r) => {
          const v = scopedGateVerdict({ state: "run", ok: r.ok, output: combinedOutput(r.stdout, r.stderr) });
          return { verdict: v.verdict, ...(v.reason === null ? {} : { reason: v.reason }) };
        });
        if (!a.ok) return fail("scoped-gate", a);
      }
    }

    // 6.9 仪器可用性探针（gap-fan-in-instrument-availability-self-check）：把「这台安装里分类器 /
    //     reaper 是否可解析」在**进 suite 之前**变成读数，落进本次 outcome 的 mechanical_fan_in.instruments
    //     与过程日志的一行 trace。
    //     ⛔ 只记录、不拦截（人 2026-09-20 裁定）：下面这一段【不参与任何控制流】——不改 needSuite /
    //     scoped / 重试 / needs-human，探针失败也照常进 suite。理由（外部项目里 flip 提交已按身份判惰性、
    //     不需要分类器；无条件拦截会让没 registry 的项目里每个任务都死在 suite 之前）见 ff-merge.ts
    //     probeInstruments 上方注释。⛔ 也不要给它加 `return`——那是另一次裁定的事，须先有发生率读数。
    const probeT0 = Date.now();
    try {
      const ffMod = await loadFfMergeModule(opts.ffMergeModule);
      // 探的 root = worktree：fan-in 自己的 `--classify-delta --root <worktree>`（step 4）用的就是它，
      // 探别的 root 会报出调用点并不具备的能力。
      instruments = ffMod.probeInstruments(worktree, scriptsDir);
      trace({ step: "instrument-probe", exit: 0, wall_ms: Date.now() - probeT0, ok: true, reason: instrumentSummary(instruments) });
    } catch (e) {
      // 探针模块本身加载不了 ⇒ 两个仪器都判「未评估」（硬规则 3b：读不懂 ≠ 合格），⛔ 仍然不拦截。
      const why = `probe unavailable: ${(e as Error)?.message ?? String(e)}`;
      instruments = { classifier: { evaluated: false, detail: why }, reaper: { evaluated: false, detail: why } };
      trace({ step: "instrument-probe", exit: 1, wall_ms: Date.now() - probeT0, ok: false, reason: instrumentSummary(instruments) });
    }

    // 7. suite（driver 子进程 + 异步 poll，⛔ 不 detach——AC3）。suite_head 在 merge + 各闸之后取。
    const suiteHead = (await mechSh(["git", "-C", worktree, "rev-parse", "HEAD"], 30_000)).stdout.trim();
    // 取证（gap-fan-in-suite-red-no-in-round-rerun-of-red-files）：把【受测合并树 SHA】与【当时的
    // develop SHA】变成读数。旧 outcome 不记它们，而任务分支落地即删 ⇒ 「同一棵树上红转绿」事后无法
    // 证明（suite 尝试日志也被落地时的 pruneTaskSuiteLogs 删掉，幸存集被失败偏置）。两读都在 ff 之前
    // 取 ⇒ developSha 就是这棵树【当时对着哪个基线】跑的（⛔ 不是 ff 之后的新 tip）。
    mergeTreeSha = suiteHead || null;
    developSha = (await mechSh(["git", "-C", root, "rev-parse", mergeTarget], 30_000)).stdout.trim() || null;
    // gap-verification-round-bound-to-quay-shaped-suite-entry — 第三方路径（suite 由项目自己的
    // loop.test_command 跑，不经 full-suite-runner）的 verification-round 入账。绿/红共用这一处
    // （⛔ 不两条分支各写一份——那正是硬规则 5b 的成簇漏改形态）。声明了 suite_runner: quay-buckets ⇒
    // suiteRunsOutsideRunner=false 直接返回，runner 已写，行为逐字不变（AC2 负控制）。
    const recordDelegatedRound = (state: "green" | "red", startedAt: string, durationMs: number, o?: { force?: boolean; notEvaluated?: string }): void => {
      // gap-watchdog-killed-round-writes-no-verification-round-record — `force` 是「本轮的预定 writer 已
      // 经死了」这一事实的显式表达：suiteRunsOutsideRunner=false 时预定的 writer 是 full-suite-runner，而
      // 静默看门狗 SIGKILL 的是【整个进程组】——runner 与它的 suite 一起死，它【结构上】写不成
      // （这正是既有 `recordDelegatedRound` 提前返回没能覆盖本子类的根因）。此时活着的写者只剩 driver
      // 进程自己（spawnSuiteAndWait 的调用方），记录必须由它补写。⛔ 只在「runner 不可能再写」的
      // 情形下 force（调用点只有两个，且都在同一行：hungByWatchdog / spawnFailed——前者 runner 被
      // 整组杀掉、后者 runner 根本没被 spawn），否则就是同一轮双写、round 号虚增。
      if (!o?.force && !suiteRunsOutsideRunner(worktree)) return;
      const t0 = Date.now();
      const rd = appendDelegatedSuiteRound({
        task, runId: perSuiteRunId, root, commit: suiteHead,
        startedAt, durationMs, state, suiteLog: suiteLogFile, worktree,
        notEvaluated: o?.notEvaluated,
      });
      // AC5 的可见性：项目声明了输出约定时，把【实际应用到的派生字段】写进 trace —— 声明有效但一条都
      // 没匹配上（applied={}）必须与「没声明」（applied=null）在记录上可分（硬规则 3b）。
      let reason = "";
      if (!rd.ok) reason = rd.reason ?? "append failed";
      else if (rd.applied !== null) {
        reason = Object.keys(rd.applied).length > 0
          ? `test_output declared → ${Object.entries(rd.applied).map(([k, v]) => `${k}=${v}`).join(" ")}`
          : "test_output declared but nothing matched (no count fields derived)";
      }
      traceSuiteEvent("verification-round-record", {
        exit: rd.ok ? 0 : 1, wall_ms: Date.now() - t0, ok: rd.ok,
        ...(reason === "" ? {} : { reason }),
      });
    };
    if (needSuite) {
      // 6.5 AC 全勾 fail-fast 预检（suite 前——未全勾直接拒翻跳过 suite，省注定无效的 9-11min/cycle；
      // gap-fan-in-ac-precheck-before-suite）。⛔ 用同源 ac-gate 脚本 --json 读结构化 verdict
      // （checked/total）——不新造计数函数（countCompletionCheckboxes / isLandedCodeComplete 同源，与
      // flip 闸 fan-in-ac-completion-gate.ts 一致）。not-evaluated（段缺失）fail-closed 拒翻（硬规则 3b：
      // 无法评估 ≠ 合格）。⛔ 保留 step 8 的 ac-gate（flip 闸）——flip 前再判一次（幂等双保险）。
      const acPreT0 = Date.now();
      const acPre = await mechSh([...acGate, "--task", task, "--worktree", worktree, "--json"], 60_000);
      if (!acPre.ok) {
        let checkedTotal = "?/?";
        let status = "fail";
        try {
          const parsed = JSON.parse((acPre.stdout || "").trim());
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const c = typeof parsed.checked === "number" ? String(parsed.checked) : "?";
            const n = typeof parsed.total === "number" ? String(parsed.total) : "?";
            checkedTotal = `${c}/${n}`;
            if (typeof parsed.status === "string") status = parsed.status;
          }
        } catch { /* JSON 解析失败 ⇒ 保守 ?/?（仍拒翻，fail-closed） */ }
        const summary = status === "not-evaluated"
          ? `AC/DoD 段缺失或无法识别（${checkedTotal}）——suite 前 fail-fast 拒翻`
          : `AC 未全勾（${checkedTotal}）——suite 前 fail-fast 拒翻`;
        traceSuiteEvent("ac-precheck", { exit: acPre.status, wall_ms: Date.now() - acPreT0, ok: false, reason: summary });
        return failClean("ac-precheck", summary, acPre.status);
      }
      traceSuiteEvent("ac-precheck", { exit: 0, wall_ms: Date.now() - acPreT0, ok: true });

      traceSuiteEvent("suite-start", { exit: 0, wall_ms: 0, ok: true });
      const suiteCmd = opts.suiteCommand ?? defaultMechanicalSuiteCommand({ task, worktree, root, suiteLogFile, runId: perSuiteRunId });
      // ⚠️ `let`：AC10/AC11 的恢复重跑认证后，**被记录的轮次换成恢复轮**（它才是本轮真正给出结论的那次
      //    suite）——下游 capture / verification-round 镜像 / suiteOutcome·pid·epoch 一律指向它自己的读数。
      let sr: SuiteRunResult = await spawnSuiteAndWait({ slotBase, slotLib, suiteCommand: suiteCmd, logFile: suiteLogFile, silenceMs: opts.silenceMs });
      suiteOutcome = sr.outcome;
      suiteFinishedEpoch = Math.floor(new Date(sr.finishedAt).getTime() / 1000);
      suitePid = sr.pid;
      // gap-fan-in-suite-refusal-reports-as-suite-red AC2 — 【先判「跑没跑」再判「为什么红」】。
      // 生产者（full-suite-runner.ts）的每条「未跑就返回」分支都在 suite log 里留了一行
      // SUITE-NOT-RUN 标记（含分支名与原因）⇒ 被拒轮在【两处】都不得呈现为裸 `suite red`（Finding
      // 实证的形态正是 `suite-end` 的 `reason:"suite red"` 与 `mechanical_fan_in.reason` 的裸
      // 「suite red」，二者与「真跑且真红」措辞不可分 —— 硬规则 3b）。⛔ 顺序不可颠倒：拒绝行对
      // isFailureSignalLine 是噪声（它不是一条测试失败），只有下面的拒绝分支能认出它。
      let suiteLogText = "";
      let refusalLine: string | null = null;
      if (sr.outcome !== "done") {
        try {
          suiteLogText = fs.readFileSync(suiteLogFile, "utf8");
        } catch { /* 日志缺失 ⇒ fallback 通用文案 */ }
        refusalLine = extractSuiteNotRunLine(suiteLogText);
      }
      traceSuiteEvent("suite-end", {
        exit: sr.exitCode, wall_ms: sr.durationMs, ok: sr.outcome === "done",
        ...(sr.outcome === "done"
          ? {}
          : refusalLine !== null
            ? { reason: `suite not run (refused): ${refusalLine}`, refused: true }
            : { reason: sr.error ?? `suite ${sr.outcome}` }),
      });
      if (sr.outcome !== "done") {
        // 红 suite 记录由 full-suite-runner.ts --buckets 在 suite 退出时写入（gap-fan-in-red-bucket-run-
        // not-recorded：runner 是 verification-round.jsonl 的唯一 writer，green+red 都入账，静态闸红亦由
        // runner 的 staticCheckDetected → gate=static-check 记录）。⛔ 不平行补写——runner 已记 + 再补写
        // = 同一红 suite 两条记录、round 号虚增（与「两套平行机制收敛为一」相悖）。
        // gap-needs-human-note-missing-real-error-line：suite 红 needs-human 的「失败步/判词」不再恒为
        // 「suite red」——把 suite 日志（stdout 落进 suiteLogFile）摘要出第一条真实断言/报错行塞进 reason。
        // 无信号 / 日志缺失 ⇒ 回退通用文案（硬规则 3b 三态可分，⛔ 不伪造/截断出误导内容）。
        if (refusalLine !== null) {
          // 拒绝轮【没有跑过测试】：不写第三方 path 的 red 轮次（那会记成「跑了且红」，正是本条要消灭的
          // 同形——全量套件从未执行，一条 SUITE-RED 也没有）。reason 指名「未运行（拒绝）+ 哪条分支」。
          return failSuite(`suite NOT run (refused) — ${refusalLine}`, sr.exitCode);
        }
        const firstFailure = extractFirstFailureLine(suiteLogText);
        // ── AC2/AC3/AC8：完整性 / OOM 标记（runner 写、本层读；前缀同源）【必须先于重跑通道】──────
        // 病（轮 2660 实测）：suite 只跑了 11% 的文件、被 OOM 杀掉 4 个进程，日志/状态却是 green，
        // fan-in 照常 `suite-end exit 0` → flip-done → ff。修法：runner 把「没跑全」写成结构化标记行，
        // 本层见到就**整条重跑/A-B 链都不进**——rerun-green 的语义是「日志点名的失败文件在隔离重跑下
        // 全绿」，而 incomplete 轮的问题恰恰是【有一些文件根本没有结论】：重跑既没有对象（日志没点名
        // 它们），也不能证明任何事（隔离重跑移除了造成 OOM 的并发本身，AC8 的判词）。reason 用**自己的
        // 成因 token**（`incomplete suite (N/M files)` / `oom-killed (n)`），⛔ 不是裸 `suite red`。
        // ⛔ 不补写 round 记录：quay 形态下 runner 是 verification-round 的唯一 writer，且它刚刚活着写下
        //    了这条标记（平行补写 = 同一轮两条记录、round 号虚增）。
        // AC10/AC11 — 恢复轮认证 ⇒ 本轮**不再走下面任何「原轮红」的出口**（无结论 / 本轮内重跑 / A/B /
        // 硬红）。那几档是给「原轮**给出了结论**且它是红的」用的；认证后 `sr` 已经换成**恢复轮**，再掉
        // 进去只会以 `suite done`/`suite red` 这类自相矛盾的判词收场（而且会把恢复轮当红驳回）。
        let recoveredCertified = false;
        const incompleteMarker = extractSuiteIncompleteMarker(suiteLogText);
        if (incompleteMarker !== null) {
          const oomNote =
            typeof incompleteMarker.oomKill === "number" && incompleteMarker.oomKill > 0
              ? ` oomKill=${incompleteMarker.oomKill}`
              : "";
          const reason =
            incompleteMarker.reason === "incomplete"
              ? `incomplete suite (${incompleteMarker.missing}/${incompleteMarker.planned ?? "?"} files)${oomNote}`
              : `oom-killed (${incompleteMarker.oomKill})`;
          traceSuiteEvent("suite-incomplete", {
            exit: sr.exitCode, wall_ms: 0, ok: false, reason,
            planned: incompleteMarker.planned, terminal: incompleteMarker.terminal,
            missing: incompleteMarker.missing, oomKill: incompleteMarker.oomKill,
            files: incompleteMarker.files.slice(0, 40),
          });

          // ── AC10/AC11/AC12/AC13：完整的、更低并发的【恢复重跑】─────────────────────────────────
          // ⛔ 不是点名失败文件的重跑（那正是 AC3/AC8 禁止的洗白通道：隔离重跑移除了造成 OOM 的并发
          //    本身），⛔ 也不是基线 A/B（A/B 比对的是**真实失败签名**，而一条被杀死/从没跑过的文件根本
          //    没有签名——拿它当红点去比对，就是本任务要消灭的 3b 违规，只是上移了一层）。
          // 恢复轮跑的是【同一条 suite 命令】的**完整计划清单**，只是并发降到更低的一档；它用**自己的**
          // 读数独立定论（AC11），⛔ 不继承原轮的任何结论。
          const originalPlan = extractSuitePlanMarker(suiteLogText);
          const originalConcurrency = originalPlan?.laneCount ?? null;
          const steps = recoveryConcurrencySteps(originalConcurrency);
          // AC13(b) 的分母：原轮**跑过且通过**的文件（⛔ 原轮没产出终态行的文件不在集合里——它们是
          // 「缺值」，硬规则 6，⛔ 不得当作「通过」）。用 runner 的同一份 `__PERFILE__` 解析。
          const originalPassed = passedFileSet(suiteLogText.split("\n"), worktree);
          const origFailedReading = readFailedTestFiles(suiteLogText, worktree);
          const originalRedFiles = new Set(origFailedReading.evaluated ? origFailedReading.files : []);

          if (steps.length === 0) {
            // AC13(a) — 梯子上没有低于**原轮并发**的档：已经到/低于地板 ⇒ 阻塞 + 具名下一步，
            // ⛔ 绝不用同一组参数重试（这正是 AC13 要禁止的无限循环）。
            const next =
              `recovery exhausted at floor concurrency ${suiteRecoveryFloor()} — the round's own concurrency ` +
              `(${originalConcurrency ?? "unknown"}) leaves no lower declared rung; needs a code/config fix, ` +
              `see plugin/scripts/full-suite-runner.ts`;
            traceSuiteEvent("suite-recovery-exhausted", {
              exit: 0, wall_ms: 0, ok: false, reason: next,
              originalConcurrency, ladder: [...SUITE_RECOVERY_CONCURRENCY_LADDER],
            });
            return failSuite(`${reason} — ${next}`, sr.exitCode);
          }

          let certifiedRun: SuiteRunResult | null = null;
          let certifiedPlan: SuitePlanReading | null = null;
          let exemptReading: BaselineEquivalenceReading | null = null;
          let blockedNextStep: string | null = null;
          for (const n of steps) {
            // 本档**自己的**日志路径：必须在本档 argv 之前定下来——它同时是 (a) runner argv 里
            // `--log-file` 的目标（结构化的 SUITE-PLAN/SUITE-INCOMPLETE/__PERFILE__ 落点）与 (b) 下面
            // `spawnSuiteAndWait` 的 stdout tee / 静默看门狗 mtime 的观察对象 / (c) `classifyRecoveryRound`
            // 的读取对象。三者是**同一个路径**是 AC2 的结构不变式（⛔ 不是「约定两份文件内容刚好一样」）。
            const recLogFile = path.join(root, ".quay", suiteLogFileName(task, runId, `recovery-${n}-${newSuiteLogAttemptSuffix()}`));
            const recArgv = recoverySuiteCommand(suiteCmd, n, recLogFile);
            if (recArgv === null) {
              // 这条 suite 命令没有已知的并发旋钮（而且结构上也写不出 SUITE-INCOMPLETE 标记）⇒ 记一个
              // **独立的**下一档 token，⛔ 不伪造「已降档」（硬规则 3b：降不了档必须与降了档可区分）。
              blockedNextStep =
                `recovery unsupported for this suite entry (no --lane-count control): ${suiteCmd[0] ?? "?"}; ` +
                `needs a code/config fix, see plugin/scripts/worker-fan-in.ts`;
              traceSuiteEvent("suite-recovery-unsupported", { exit: 0, wall_ms: 0, ok: false, reason: blockedNextStep, originalConcurrency });
              break;
            }
            const recT0 = Date.now();
            const rec = await spawnSuiteAndWait({ slotBase, slotLib, suiteCommand: recArgv, logFile: recLogFile, silenceMs: opts.silenceMs });
            // 读到的是**本档自己**那份（argv 的 `--log-file` 与这里的 `recLogFile` 是同一个路径）。⛔ 空/读不出
            // 仍然判「无结论」（硬规则 3b 的另一个方向：真正读不到绝不能被判成「读到了」）——修的是
            // 「明明写进了一份真实日志、却被读到另一份空文件」那一半，⛔ 不是把空文件当合格。
            let recLog = "";
            try { recLog = fs.readFileSync(recLogFile, "utf8"); } catch { /* 日志读不出 ⇒ 下面判「无结论」 */ }
            const recWall = Date.now() - recT0;
            // AC12 的**形状**闸：四分形态里只有 `complete-red` 带 `failures`；一条 OOM / missing 记录落进
            // `incomplete` 变体，**结构上就没有签名字段**（⛔ 不靠一句「约定」），所以下面那台比较器根本
            // 拿不到它。
            const reading = classifyRecoveryRound(rec, recLog, n, worktree);

            if (reading.kind === "no-conclusion") {
              // 恢复轮**自己也没有结论**（看门狗 SIGKILL 整组 / 没起来 / 日志 0 字节）⇒ ⛔ 不认证
              //（硬规则 3b：读不懂 ≠ 合格）。仍在有界梯子内 ⇒ 降到下一档（AC13）。
              traceSuiteEvent("suite-recovery", {
                exit: reading.run.exitCode, wall_ms: recWall, ok: false, concurrency: n, outcome: reading.run.outcome,
                reason: `recovery round had no conclusion (${reading.reason}) — stepping down`,
              });
              continue;
            }
            if (reading.kind === "incomplete") {
              // 降档后**还是**没跑全 / 又被 OOM 杀 ⇒ 继续降到下一档（AC11：要么继续降、要么耗尽边界）。
              const m = reading.marker;
              traceSuiteEvent("suite-recovery", {
                exit: reading.run.exitCode, wall_ms: recWall, ok: false, concurrency: n,
                reason: m.reason, planned: m.planned, terminal: m.terminal,
                missing: m.missing, oomKill: m.oomKill, files: m.files.slice(0, 40),
              });
              continue;
            }
            if (reading.kind === "certified") {
              // AC11 — 干净的一轮：无 incomplete 标记（missing==0）、独立退出 0 ⇒ **认证**；记的是它
              // **自己的** planned/terminal/oomKill 读数（⛔ 不是原轮的）。
              certifiedRun = reading.run;
              certifiedPlan = reading.plan;
              traceSuiteEvent("suite-recovery-certified", {
                exit: 0, wall_ms: recWall, ok: true, concurrency: n,
                reason: `recovery round complete at concurrency ${n} (${steps.indexOf(n) + 1}/${steps.length}) — landing on ITS OWN verdict`,
                planned: reading.plan?.planned ?? null, terminal: reading.plan?.terminal ?? null,
                missing: reading.plan?.missing ?? null, oomKill: reading.plan?.oomKill ?? null,
                completeness: reading.plan?.completeness ?? null,
              });
              break;
            }
            // ── 恢复轮**完整跑完、但真红**（不是 OOM、不是 missing）⇒ AC13(b) / AC12 两条出口 ────────
            const recFailed = reading.failures;
            const recRedFiles = recFailed.evaluated ? recFailed.files : [];
            const newRegressions = recRedFiles.filter((f) => originalPassed.has(f) && !originalRedFiles.has(f));
            if (newRegressions.length > 0) {
              // AC13(b) — 一个**原轮跑过且通过**的文件在更低并发下变红：真正的回归信号。⛔ 不再继续降档
              //（继续降就是用换参数掩盖新失败）。阻塞 + 具名下一步。
              blockedNextStep =
                `new regression at lower concurrency: ${newRegressions.slice(0, 20).join(",")} ` +
                `(passed at the original concurrency ${originalConcurrency ?? "unknown"}, fails at ${n}) — needs a code fix`;
              traceSuiteEvent("suite-recovery-new-regression", {
                exit: rec.exitCode, wall_ms: recWall, ok: false, concurrency: n,
                reason: blockedNextStep, files: newRegressions.slice(0, 40),
              });
              break;
            }
            // AC12 — 完整跑完的真红：**只在这一条路径上**走上既存 baseline-equivalence（⛔ 只喂真实签名）。
            const be = await runBaselineEquivalence(recLog, recFailed);
            if (be !== null && be.verdict.kind === "exempt") {
              // AC12 — 「与 develop 基线等价」**本身不足以上床**：候选自己声明的 Touches 相关测试也必须
              // 干净。用**既存的** scoped 门命令再取一次真实读数（⛔ 不靠「本步之前已经跑过一次」这句
              // prose——那是个未被检验的断言）。
              let touchesClean = false;
              let touchesDetail = "";
              if (scopedRes.kind === "run") {
                const sg = await mechSh(scopedRes.argv, 600_000);
                touchesClean = sg.ok;
                touchesDetail = `scoped gate (${scopedRes.argv.join(" ")}) exit ${sg.status}`;
              } else {
                touchesDetail = `scoped gate not evaluable here (${scopedRes.kind})`;
              }
              traceSuiteEvent("suite-recovery-baseline-exempt", {
                exit: 0, wall_ms: Date.now() - recT0, ok: touchesClean, concurrency: n,
                reason: touchesClean
                  ? `recovery red set is verbatim-equal to the ${mergeTarget} baseline red set (${be.verdict.unchanged} red point(s)) AND the candidate's own Touches-relevant tests are clean — landing (no gate relaxed)`
                  : `recovery red set is baseline-equivalent but the candidate's own Touches-relevant tests are NOT clean — blocked`,
                taskFiles: recRedFiles.length, baselineFiles: be.verdict.unchanged, touchesDetail,
              });
              if (touchesClean) {
                certifiedRun = reading.run;
                certifiedPlan = reading.plan;
                exemptReading = be;
              } else {
                blockedNextStep = `recovery baseline-equivalent but the candidate's own Touches-relevant tests are not clean (${touchesDetail}) — needs a code fix`;
              }
              break;
            }
            // A/B 判不出等价（硬红 / 未评估）⇒ 维持硬红（既有语义逐字不变，⛔ 不打折）。
            blockedNextStep =
              be !== null && be.verdict.kind === "hard-red"
                ? `recovery red set is NOT a subset of the ${mergeTarget} baseline red set: added=${be.verdict.added.map((a) => a.file).join(",") || "-"} changed=${be.verdict.changed.map((c) => c.file).join(",") || "-"} — needs a code fix`
                : `recovery baseline-equivalence not evaluable at concurrency ${n} — needs a code fix`;
            break;
          }

          if (certifiedRun === null) {
            const detail =
              blockedNextStep ??
              // ⛔ 措辞不得只说「仍然 incomplete/OOM」：走到这里的每一档可能是**没结论**（看门狗杀 / 没起来 /
              //    日志读不出），那与「跑了且 incomplete」不是同一件事（硬规则 3b）。说**没产出完整判词**对
              //    两种成因都成立，且仍指到地板与下一步。
              `recovery exhausted at floor concurrency ${suiteRecoveryFloor()} — no declared rung produced a complete verdict ` +
                `(${steps.join(",")}); needs a code/config fix, see plugin/scripts/full-suite-runner.ts`;
            traceSuiteEvent("suite-recovery-blocked", {
              exit: 0, wall_ms: 0, ok: false, reason: detail,
              originalConcurrency, steps: [...steps],
            });
            return failSuite(`${reason} — ${detail}`, sr.exitCode);
          }
          // 认证 ⇒ **落到下面的绿块**：本轮终态是「可继续」，而**被记录的轮次是恢复轮**（AC11）——把下游
          // （capture / verification-round 镜像 / suiteOutcome·pid·epoch）都指向它**自己的**读数，⛔ 不是
          // 原轮的。`certifiedPlan` 是它自己的完整性读数（AC11 的 planned/terminal/oomKill）。
          sr = certifiedRun;
          suiteOutcome = certifiedRun.outcome;
          suiteFinishedEpoch = Math.floor(new Date(certifiedRun.finishedAt).getTime() / 1000);
          suitePid = certifiedRun.pid;
          if (exemptReading !== null) baselineEquivalence = exemptReading;
          recoveredCertified = true;
          traceSuiteEvent("suite-recovery-accepted", {
            exit: 0, wall_ms: 0, ok: true,
            concurrency: certifiedPlan?.laneCount ?? null,
            planned: certifiedPlan?.planned ?? null, terminal: certifiedPlan?.terminal ?? null,
            missing: certifiedPlan?.missing ?? null, oomKill: certifiedPlan?.oomKill ?? null,
            reason: `landing on the recovery round's own complete verdict (original round stayed ${incompleteMarker.reason})`,
          });
        }
        if (!recoveredCertified) {
        // ── 本轮**无结论**（看门狗 SIGKILL 整组 / suite 从未起来）⇒ ⛔ 不进重跑、⛔ 不进 A/B ──────
        // gap-watchdog-killed-round-writes-no-verification-round-record + 本任务 AC6：被静默看门狗杀死的
        // 一轮**没有任何结论**（实测 2026-10-14 08:43 那轮：suite 从未跑完，wall 1156s），而旧控制流把
        // 「重跑 3 个点名文件全绿」当成结论、直接落到绿块落地——把一个从未跑完的套件洗成 green，正是本条
        // 要消灭的同形。判据的一半是**顺序**：`inconclusive` 必须在重跑**之前**算出（旧代码在重跑之后的
        // else 里算，所以永远轮不到它生效）。它们同样不进 A/B（日志不是一轮完整 suite 的失败集合）。
        const inconclusive = sr.hungByWatchdog || sr.spawnFailed === true;
        if (inconclusive) {
          recordDelegatedRound("red", sr.startedAt, sr.durationMs,
            sr.hungByWatchdog ? { force: true, notEvaluated: "watchdog-killed" }
              : { force: true, notEvaluated: "spawn-failed" });
          return failSuite(firstFailure || `suite ${sr.outcome}${sr.error ? `: ${sr.error}` : ""}`, sr.exitCode);
        }
        // ── 本轮内重跑（gap-fan-in-suite-red-no-in-round-rerun-of-red-files）──────────────────────────
        // 【先解析「日志点名了哪些失败测试文件」，再决定有没有重跑对象】——三态读数（evaluated:false =
        // 未评估，⛔ 不是一个空清单）。重跑在【同一把 fan-in 锁内、同一棵合并树上】跑（仍在 try 内 ⇒
        // finally 的 release 在它之后，锁的 release epoch 必 ≥ 重跑结束时刻）。
        // rerun-green ⇒ **不 return**，落到下面的绿块（本轮终态是绿；⛔ 不双写 round——红色轮次记录在
        // 重跑绿的情形下【不写】，因为本轮没有红的结论，红的证据在 rerun.files / 重跑日志里）。
        // ⚠️ 落到绿块后 `recordDelegatedRound("green", …)` 仍以【原 suite 日志】为轮次日志（该调用点
        // 不在本任务的 ## Touches 内，⛔ 不改它的签名）：第三方项目的这一轮会从那份红日志里解析出
        // fail>0 的计数。已知且有意——轮次【状态】是对的（本轮终态确实是绿），而计数描述的是本轮真正
        // 跑过的那次 suite；重跑的分母写在 outcome 的 rerun 字段里，⛔ 不在这里另造一套。
        failedTestFiles = readFailedTestFiles(suiteLogText, worktree);
        rerun = await runInRoundRerun(failedTestFiles);
        if (rerun.state === "rerun-green") {
          traceSuiteEvent("suite-rerun-green", {
            exit: 0, wall_ms: 0, ok: true,
            reason: `in-round rerun green on ${rerun.files.length} named file(s) — landing as green`,
            // AC6 — **点名的文件**必须落在**落地清理后仍存活**的载体上（proposal 的实测：attempt 日志被
            // pruneTaskSuiteLogs 删掉，只有计数进了 step trace，具体 3 个文件名事后不可恢复）。共享
            // `.quay/fan-in-step-trace.jsonl` 不在轮转范围内（轮转只删 `fan-in-suite-*.log`）⇒ 名字随
            // 这条事件永久留痕。runInRoundRerun 的 "rerun" 事件同样带上（两处同源，⛔ 不只改一边）。
            files: rerun.files.slice(0, 200),
          });
        } else {
        // gap-fanin-suite-gate-no-baseline-equivalent-exception —— 既存红等价 A/B 是**第三档出口**：
        // suite 真跑过且真红、且本轮内重跑仍红时，与 develop 基线树逐字比对失败签名集合；等价 ⇒ 放行
        // （落到下面的绿块，继续 typecheck/ff），不等价/读不懂 ⇒ 维持硬红。
        // ⛔ 「本轮无结论」形态已在上面 return（看门狗 SIGKILL 整组 / suite 从未起来）——它们**不进 A/B**
        //    （日志不是一轮完整 suite 的失败集合，拿它当「签名集合」去比对是本机制自己的 3b 违规）。
        baselineEquivalence = await runBaselineEquivalence(suiteLogText, failedTestFiles);
        if (baselineEquivalence !== null && baselineEquivalence.verdict.kind === "exempt") {
          traceSuiteEvent("baseline-red-exempt", {
            exit: 0, wall_ms: 0, ok: true,
            reason: `task red set is verbatim-equal to the ${mergeTarget} baseline red set (${baselineEquivalence.verdict.unchanged} red point(s)) — landing as green (no gate relaxed: a new/changed red would have hard-failed)`,
          });
          // 落到下面的绿块（同 rerun-green 的形状：本轮终态是「可继续」，⛔ 不双写红色轮次记录）。
        } else {
        // gap-verification-round-bound-to-quay-shaped-suite-entry：第三方路径的红轮同样入账
        // （「跑了且红」必须与「没跑过」可分，硬规则 3b；与 full-suite-runner 的红绿皆入账契约一致）。
        // gap-watchdog-killed-round-writes-no-verification-round-record — `hung`（看门狗 SIGKILL 整组）
        // 与 `red`（跑了且红）【不是同一件事】，入账形态也不同：被看门狗杀的这一轮没有任何结论 ⇒ 走
        // NOT-EVALUATED 形状（evaluated:false + reason=watchdog-killed），且必须 force 写——预定的 writer
        // （full-suite-runner）就在被杀的那个进程组里，它写不成。
        // gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files AC6 — 那两个
        // 「本轮无结论」形态现已在**上游**（重跑之前）单独 return，⛔ 到不了这里。保留这里的无参调用即
        // 改动前对**余下**那类红轮（真跑过、真红、A/B 判不出等价）的行为：[force=false] 时 runner 活着
        // 且已入账 ⇒ recordDelegatedRound 对 quay 形态直接早返回（⛔ 不双写 round）。
        recordDelegatedRound("red", sr.startedAt, sr.durationMs);
        // 既存红死锁的耐久载体（电路断路器 AC4 的输入）：**只有**在 A/B 判出「task 独有/文本变化」这类
        // 真被挡住的轮次才记——放行轮次不记（它落地了，不存在死锁）。best-effort，⛔ 不影响本轮判定。
        if (baselineEquivalence !== null && baselineEquivalence.verdict.kind === "hard-red") {
          appendBaselineRedRound(root, {
            task, signature: baselineEquivalence.verdict.signature, ts: Date.now(),
            blocked: [...baselineEquivalence.verdict.added.map((a) => a.file), ...baselineEquivalence.verdict.changed.map((c) => c.file)],
          });
        }
        // ⛔ `not-evaluated` **不得**往 reason 里加任何注记——本机制的不变式是「A/B 读不懂 ⇒ 逐字等于
        // 改动前的行为」（见本文件上方 runBaselineEquivalence 的非目标与 `worker-fan-in-baseline-red.test.mjs`
        // 的 fail-closed 夹具），而 `reason` 正是「改动前的行为」里最可见的那一面：一旦给它加尾巴，
        // 一个「本轮没跑过 A/B」的轮次在 needs-human 注记里就与改动前不可分辨（反而制造了新的同形）。
        // A/B 的未评估成因**已**由两条结构化载体留痕（`traceSuiteEvent("baseline-red", {reason})` 与
        // `mechanical_fan_in.baselineEquivalence.verdict.reason`）⇒ 信息不丢，⛔ 不需要污染人读的 reason。
        // gap-needs-human-note-missing-real-error-line 的既有负控制（s10 AC2：零输出 ⇒ reason 逐字
        // `suite red`）正是这条的守卫，本注释是它第二次生效。
        const baselineNote = baselineEquivalence !== null && baselineEquivalence.verdict.kind === "hard-red"
          ? ` [baseline A/B: HARD RED (${baselineEquivalence.verdict.reason}) — the task's red set is NOT a subset of the ${mergeTarget} baseline red set: added=${baselineEquivalence.verdict.added.map((a) => a.file).join(",") || "-"} changed=${baselineEquivalence.verdict.changed.map((c) => c.file).join(",") || "-"}]`
          : "";
        return failSuite((firstFailure || `suite ${sr.outcome}${sr.error ? `: ${sr.error}` : ""}`) + baselineNote, sr.exitCode);
        }
        }
        } // if (!recoveredCertified)
      }
      // ⚠️ `suite_exit: "0"` 在这里的语义与 rerun-green 相同：「本轮已获准落地」，⛔ 不是「全量套件绿」。
      //   两处（rerun-green / baseline-red-exempt）都如此——本轮的**真读数**在 outcome 的 rerun /
      //   baselineEquivalence 字段里。既存红放行额外落一个可审计标记（ff 闸的读者据此可区分）。
      writeSuiteCapture(suiteCapture, {
        full_suite_ran: "true", skip_reason: "", suite_exit: "0",
        suite_head: suiteHead, start_iso: sr.startedAt, end_iso: sr.finishedAt,
        ...(baselineEquivalence !== null && baselineEquivalence.verdict.kind === "exempt" ? { baseline_red_exempt: "true" } : {}),
      });
      // gap-verification-round-bound-to-quay-shaped-suite-entry：第三方路径的绿轮入账（红轮在 suite
      // 退出分支，见 recordDelegatedRound 定义处的说明）。
      recordDelegatedRound("green", sr.startedAt, sr.durationMs);
      // D7：把本轮 bucket suite 状态镜像到权威载体 full-suite-state.json（scope=worktree + taskId 区分
      // bucket-run 与 full-run，⛔ 不伪造 full-green；finishedAt 与 mfi.suiteFinishedEpoch 同源 ⇒ 不陈旧）。
      // ⛔ runId 用 perSuiteRunId（非过程 runId）——runner 已用 perSuiteRunId 写 full-suite-state，镜像
      // 必须同键，否则 AC1「state/load/记录三者同键」被镜像最后一写破坏（gap-mechanical-fan-in-per-suite-runid-unified）。
      mirrorMechanicalFanInSuiteState({
        task, runId: perSuiteRunId, commit: suiteHead,
        startedAt: sr.startedAt, finishedAt: sr.finishedAt, durationMs: sr.durationMs,
        stateFile: suiteStateFile,
      });
    } else {
      writeSuiteCapture(suiteCapture, { full_suite_ran: "false", skip_reason: reuseSkip ? "develop-advance-doc-only-reuse" : "doc-only-delta", suite_exit: "0", suite_head: suiteHead });
      traceSuiteEvent("suite-skip", { exit: 0, wall_ms: 0, ok: true, reason: reuseSkip ? "develop-advance-doc-only-reuse" : "doc-only-delta" });
    }

    // 8. land 前 anti-drift 重跑 + AC 完成闸 + flip done（先 flip 后 ff，人 2026-08-14 裁定）。
    a = await step("anti-drift-land", [...antiDrift, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000);
    if (!a.ok) return fail("anti-drift-land", a);
    a = await step("ac-gate", [...acGate, "--task", task, "--worktree", worktree], 60_000);
    if (!a.ok) return fail("ac-gate", a);
    // 8.5 ADR-007 per-milestone predicate (gap-mechanical-fan-in-flip-bypasses-adr007-dark-axis-
    //     predicate): the mechanical flip is the PRODUCTION landing path and it bypassed the
    //     predicate entirely. Judged on the SAME classifier the ready→done verbs use, reading the
    //     WORKTREE body this landing is about to carry, and gated by the SAME workspace switch
    //     (`gates.adr` contains ADR-007 — no new config surface).
    //     Every judgment leaves a `dark-axis` GateEvent, so the complete:dark-axis ratio becomes a
    //     directly readable quantity instead of a gap someone has to rediscover (AC6).
    //     RECORDED / DISCLAIMED ⇒ continue. MISSING ⇒ refuse, task stays `ready`. NOT-EVALUATED ⇒
    //     refuse too, with its OWN reason (硬规则 3b) — never folded into MISSING, which would make
    //     "recorded nothing" and "could not read the record" the same failure.
    if (workspaceEnforcesDarkAxis(root)) {
      const darkT0 = Date.now();
      appendFanInStepTrace(root, task, runId, "dark-axis", "begin");
      const taskFile = opts.darkAxisTaskFile ?? darkAxisTaskFileFor(worktree, task);
      const darkVerdict = darkAxisVerdictForTaskFile(taskFile);
      const darkEvent = await appendDarkAxisGateEvent(root, task, darkVerdict, { runId });
      const darkPass = darkVerdict.state === "RECORDED" || darkVerdict.state === "DISCLAIMED";
      const darkDurMs = Date.now() - darkT0;
      appendFanInStepTrace(root, task, runId, "dark-axis", "end", {
        ok: darkPass && darkEvent.ok, durationMs: darkDurMs, state: darkVerdict.state, gateEvent: darkEvent.ok,
      });
      trace({
        step: "dark-axis", exit: darkPass && darkEvent.ok ? 0 : 1, wall_ms: darkDurMs, ok: darkPass && darkEvent.ok,
        state: darkVerdict.state,
        ...(darkPass && darkEvent.ok ? {} : { reason: darkEvent.ok ? `${darkVerdict.state}: ${darkVerdict.reason}` : `gate-event write failed: ${darkEvent.reason}` }),
      });
      // The ledger write is a PRECONDITION, not an observation: a judgment with no event cannot be
      // told apart from no judgment, which is the defect this step exists to close (⛔ fail-open).
      if (!darkEvent.ok) {
        return failClean("dark-axis", `dark-axis GateEvent write failed: ${darkEvent.reason ?? "unknown"} — refusing the flip (an unrecorded judgment is not a judgment)`);
      }
      if (!darkPass) {
        return failClean("dark-axis", `dark-axis (ADR-007 per-milestone predicate) refused the flip — ${darkVerdict.state}: ${darkVerdict.reason}`);
      }
    } else {
      trace({ step: "dark-axis-skip", exit: 0, wall_ms: 0, ok: true, reason: "workspace does not declare ADR-007 in gates.adr (workspaceEnforcesDarkAxis=false)" });
    }
    const flipT0 = Date.now();
    const flip = await flipTaskDone(worktree, task, mergeTarget, { root, cause: { runId } });
    trace({ step: "flip-done", exit: flip.ok ? 0 : 1, wall_ms: Date.now() - flipT0, ok: flip.ok, ...(flip.ok ? {} : { reason: flip.reason ?? "flip failed" }) });
    if (!flip.ok) return failClean("flip-done", flip.reason ?? "flip failed");

    // 9. ff（fan-in/ff-merge.ts 读 suite capture 证书 + L1 token 闸；成功 fall through，失败 red）。
    //    P2：⛔ 不再 shell-out 到 bash fan-in-ff-merge.sh —— 持锁段业务已 TS 模块化被 import。
    const ffT0 = Date.now();
    appendFanInStepTrace(root, task, runId, "ff", "begin");
    const ffToken = randomUUID();
    // ⛔ specifier / 测试缝解析收在 loadFfMergeModule 一处——它在 step 6.9 已被调过一次（探针），本步是
    // 同一模块的第二个消费者（那次调用结果不缓存：两次 import 同一 specifier 由 ESM 缓存去重）。
    const { ffMerge: ffMergeFn } = await loadFfMergeModule(opts.ffMergeModule);
    // attemptKey = perSuiteRunId (mfi-<task>-<epoch>-<rand>, generated once per fan-in): the per-dispatch
    // identity for the ff retry counter. ⛔ NOT runId (wk-prod-<epoch>) — that is the driver-process
    // lifetime id, constant across dispatches, which latches a task's retry budget across independent
    // dispatches (gap-ff-retry-counter-runid-no-longer-per-dispatch).
    const ff = await ffMergeFn({
      task, root, mergeTarget, runId, attemptKey: perSuiteRunId, worktree, suiteCapture, suiteState: suiteStateFile,
      lockWaitSecs: 30, token: ffToken, scriptsDir,
    });
    const ffDurMs = Date.now() - ffT0;
    appendFanInStepTrace(root, task, runId, "ff", "end", { ok: ff.code === 0, durationMs: ffDurMs });
    trace({ step: "ff", exit: ff.code, wall_ms: ffDurMs, ok: ff.code === 0, ...(ff.code === 0 ? {} : { reason: (ff.stderr || ff.stdout || "").trim() || `exit ${ff.code}` }) });
    if (ff.code !== 0) return fail("ff", { ok: false, status: ff.code, stdout: ff.stdout, stderr: ff.stderr, error: null });

    // 9.3 状态双写（B2，SPEC-goal-branch-2026-10-03 §5 裁定⑪）：`done` = 已落到它的 mergeTarget。
    //     mergeTarget 非 develop（goal 分支）时，done 只落在 goal/<id>；而派发/晋升读 develop 上的
    //     tasks/*.md ⇒ 不双写则 develop 仍 ready ⇒ worktree 回收后任务被反复派发。ff 成功后经现有文档面
    //     写路径（主检出提交 + propagateDocBranchToDevelop）把同一个 done 也写到 develop。
    //     ⛔ 失败即 red（fail-closed，硬规则 3b）：状态没双写进 develop 就不能声称本轮落地完成——
    //     worktree 保留，下一轮 flipTaskDone 见 mergeTarget 已 done 而 skip、ff 幂等，只重试本步。
    //     ⛔ mergeTarget === "develop" 时【逐字不变】：本分支不进入，develop 目标下不产生额外文档面提交。
    if (mergeTarget !== "develop") {
      const docT0 = Date.now();
      const docSync = await syncDoneToDocFace(root, task);
      trace({
        step: "doc-face-done-sync", exit: docSync.ok ? 0 : 1, wall_ms: Date.now() - docT0, ok: docSync.ok,
        ...(docSync.ok ? {} : { reason: docSync.reason ?? "doc-face done sync failed" }),
      });
      if (!docSync.ok) return failClean("doc-face-done-sync", docSync.reason ?? "doc-face done sync failed");
    }

    // 9.4b 写 complete pass GateEvent（gap-mechanical-fan-in-writes-no-complete-gateevent AC2）：机械
    // fan-in 此前绕过 gate 引擎（runMechanicalFanIn/flipTaskDone 全文零 GateEvent），.quay/gate-events.jsonl
    // 里 complete 单路缺席——stale-ready-audit 的 bypassComplete 每轮报 9 条真阳性被当噪声。现在经既有
    // gate-event-store 补写（与 CLI/loop 同一载体，⛔ 不手搓 append）。best-effort：写失败不致命。
    const gateEventT0 = Date.now();
    const gateEvent = await appendCompleteGateEvent(root, task);
    trace({
      step: "append-complete-gate-event", exit: gateEvent.ok ? 0 : 1, wall_ms: Date.now() - gateEventT0,
      ok: gateEvent.ok, ...(gateEvent.ok ? {} : { reason: gateEvent.reason ?? "write failed" }),
    });

    // 9.5 清理 worktree + 删 task 分支（ff 成功后——landed 判据 = status done ∧ 无残留 worktree）。
    // best-effort：移除失败不致命，landing 判定（computeLandingState）会据残留 worktree 诚实判未落地。
    const cleanupT0 = Date.now();
    const wr = await mechSh(["git", "-C", root, "worktree", "remove", "--force", worktree], 60_000);
    const bd = await mechSh(["git", "-C", root, "branch", "-D", `task/${task}`], 60_000);
    const cleanupOk = wr.ok && bd.ok;
    // 轮转：landed ⇒ 清掉该任务名下全部历史 suite attempt 日志（⛔ 长期 .quay/ 无限堆积孤儿
    // fan-in-suite-*.log；gap-fan-in-suite-log-same-runid-overwrite AC3）。best-effort，非 landing 判据。
    const prunedSuiteLogs = pruneTaskSuiteLogs(root, task);
    trace({
      step: "cleanup", exit: cleanupOk ? 0 : 1, wall_ms: Date.now() - cleanupT0, ok: cleanupOk,
      ...(cleanupOk
        ? (prunedSuiteLogs > 0 ? { reason: `pruned ${prunedSuiteLogs} suite attempt log(s)` } : {})
        : { reason: "worktree remove / branch delete best-effort (non-fatal)" }),
    });
  } catch (e) {
    return failClean("exception", (e as Error)?.message ?? String(e));
  } finally {
    const relT0 = Date.now();
    await releaseLock();
    // 已获锁的失败结果：release 事件刚落盘，此刻读锁时间 = 本次尝试自己的区间（⛔ 早读无 release、
    // 晚读会被后续重试的区间张冠李戴——gap-mechanical-fan-in-red-lock-times-null）。
    if (pendingRed !== null) {
      const lock = readFanInLockHold(root, task, runId);
      pendingRed.lockHoldSecs = lock.lockHoldSecs;
      pendingRed.lockAcquireEpoch = lock.lockAcquireEpoch;
      pendingRed.lockReleaseEpoch = lock.lockReleaseEpoch;
      // 仪器读数与锁时长同一时机填：探针在 [acquire, release] 区间内跑（step 6.9），此刻的 `instruments`
      // 就是本次尝试自己的读数；探针之前失败 ⇒ 仍是 null（未评估，⛔ 不伪造成「探过」）。
      pendingRed.instruments = instruments;
    }
    trace({ step: "release-fan-in-lock", exit: 0, wall_ms: Date.now() - relT0, ok: true });
  }

  // 成功路径（try 未 return）：release 之后读锁持有时长 + 落地 sha。
  const landedSha = (await mechSh(["git", "-C", root, "rev-parse", mergeTarget], 30_000)).stdout.trim();
  const lock = readFanInLockHold(root, task, runId);
  return {
    outcome: "landed", verdict: null, step: null, reason: null,
    ...lock, suiteFinishedEpoch, suiteOutcome, suitePid, landedSha,
    // rerun-green 落地时四个取证读数随成功结果一起写（AC：这些字段在 suite 红【与】rerun-green 落地
    // 两种情形下都写）；普通绿落地 ⇒ failedTestFiles/rerun 保持 null（不适用，⛔ 不是「未评估」）。
    mergeTreeSha, developSha, failedTestFiles, rerun,
    // 既存红等价放行（baseline-red-exempt）落地时也带上 A/B 读数；其余落地路径为 null（不适用）。
    baselineEquivalence,
    suiteLog: null,
    fanInLog: path.basename(fanInLog),
    instruments,
  };
}

/**
 * 每任务新进程执行（gap-fan-in-token-gate-version-mismatch-self-lock AC1）：机械 fan-in 不在守护进程
 * in-process 跑（守护是主检出旧代码、但 fan-in 编排脚本从 worktree 加载 ⇒ 版本错位），改为每任务 spawn
 * 一个 fresh node 进程加载 worker-driver.ts --mechanical-fan-in。执行器（entry）锚在本 kernel 安装位置
 * （kernelSiblingArgv("worker-driver.ts") = resolveKernelSibling，与 driver 同版）——⛔ 不用 worktree 的、
 * 也⛔ 不锚在 opts.root/plugin/scripts（gap-plugin-root-resolution-remaining-callsites-round2：第三方
 * 项目无 plugin/scripts/）。（gap-fan-in-spawn-stale-worktree-executor-missing-argv：stale worktree 缺
 * 新 argv 如 --mechanical-fan-in ⇒ fresh 进程报 unknown argument ⇒ 无 JSON 输出 ⇒ parse-mechanical-fan-in
 * red）。fan-in 编排器本就是基础设施，应跟 driver 同版；任务 delta（含对 worker-driver.ts 自身的改动）
 * 由 suite step（worktree test.sh）验证，不因执行器用 kernel 版而丢。锁半（acquireFanInLock，ADR-034）
 * 与编排半（ff-merge.ts 模块）仍在 worktree 同源。结果经 stdout 单行 JSON 回传（--mechanical-fan-in
 * 只打一行 result JSON）；spawn 失败/输出不可解析 fail-closed 为 red（硬规则 3b：读不懂 ≠ 合格）。
 */
export async function spawnMechanicalFanIn(opts: MechanicalFanInOptions): Promise<MechanicalFanInResult> {
  const entry = kernelSiblingArgv("worker-driver.ts");
  const argv = [
    process.execPath, ...entry,
    "--mechanical-fan-in",
    "--task", opts.task,
    "--worktree", opts.worktree,
    "--root", opts.root,
    "--run-id", opts.runId,
    "--json",
  ];
  if (opts.mergeTarget) argv.push("--merge-target", opts.mergeTarget);
  const r = await runAsync(argv, { timeoutMs: Infinity, collectStderr: true });
  // MechanicalFanInResult 自 D5/D6/D7 起带 verdict 字段（outcome=red 时非 null）——spawn 失败 / 输出
  // 不可解析的 red 也须构造结构化 verdict（⛔ 缺字段 ⇒ typecheck 红；硬规则 3b 读不懂 ≠ 合格）。
  const red = (step: string, reason: string, exitCode: number | null = null): MechanicalFanInResult => ({
    outcome: "red",
    verdict: { step, verdict: "failed", exitCode, summary: reason, logFile: null },
    step, reason,
    lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null,
    suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
    suiteLog: null,
    // spawn 未起/输出不可解析 ⇒ 探针从未跑过（未评估，⛔ 不是「探过且判不出」）。
    instruments: null,
    // suite 从未跑过（连 fan-in 进程都没起）⇒ 重跑不适用（`null`，⛔ 不是「未评估」）。
    mergeTreeSha: null, developSha: null, failedTestFiles: null, rerun: null,
  });
  if (r.status === null) {
    return red("spawn-mechanical-fan-in", r.error?.message ?? `fresh mechanical fan-in process failed: ${r.stderr || "no output"}`);
  }
  const lastJson = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean).pop();
  if (lastJson) {
    try {
      const parsed = JSON.parse(lastJson);
      if (parsed && typeof parsed === "object" && (parsed.outcome === "landed" || parsed.outcome === "red")) {
        return parsed as MechanicalFanInResult;
      }
    } catch { /* fall through to red */ }
  }
  return red("parse-mechanical-fan-in", `unparseable fresh mechanical fan-in output: ${(r.stderr || r.stdout || "").trim() || `exit ${r.status}`}`, r.status);
}

/** D7：机械 fan-in 的 bucket suite 绿后，把本轮 suite 状态镜像到权威载体 full-suite-state.json。
 *  ⛔ 不伪造 full-green：scope=worktree + taskId + runner=inner 区分 bucket-run（本任务的 --buckets 子集）
 *  与 full-run（scope=main + runner=outer 无 taskId）——读面据此可分辨「退休已修 suite 绿」≠「全量 suite 绿」。
 *  finishedAt 与 mfi.suiteFinishedEpoch 同源（同一 sr.finishedAt 派生）⇒ 载体不再 28h 陈旧（D7 AC3）。
 *  laneCount 取 defaultLaneCount()（nproc-derived 单一真相源，⛔ 非字面量——bucket suite 跑的是
 *  test.sh AC5 派生的真实 lane 数，不是 1 条）。
 *  best-effort：写失败 / 状态在飞（shouldSkipMirrorWrite）不致命——mfi 仍是这次 fan-in 的权威记录。
 *
 *  ⚠️ 本函数的 fail-open 姿态（`void` 返回 + `if (built.error) return` + 空 `catch` ⇒ 外部【无法从返回值
 *  区分「写了」与「没写」】）**正是硬规则 3b 的形状**（读不懂 ⇒ 沉默 ⇒ 与合格同形）。该姿态在这里【成立】，
 *  但成立的理由不在这几行里 —— ⛔ 下一个读到它的人【不要】把它「修」成 fail-closed：那个「修复」会红掉
 *  真实绿的 suite。以下五点缺一不可，缺任一条本姿态就退化为一个恒绿伪装：
 *
 *   （1）**沉默是有意的**：`void` 返回是设计，不是疏漏 —— 观测写不得阻塞主执行（人 2026-08-30 裁定）。
 *       `writeSuiteCapture` 的 fail-open 是同一条裁定的另一实例（见其上方注释）。
 *   （2）**谁在兜底**：`packages/quay/src/fan-in/ff-merge.ts` 的 `readGreenMirrorCommit`（capture 缺失时
 *       `suiteCertGate` 回退读本镜像）。消费者【不是信任本镜像，而是校验它】—— 镜像是回退源，不是证书本身。
 *   （3）**它的三个条件（逐条）**：`state === "green"` ∧ `taskId` 与本任务相等 ∧ `commit` 匹配
 *       `/^[0-9a-f]{40}$/i`。三者任一不满足 ⇒ 返回 `""`（缺值）⇒ `suiteCertGate` 拿不到 `suite_head`
 *       ⇒ 返回 `{ ok: false }`（**fail-closed**）。且即便拿到 commit，还要过祖先校验
 *       `git merge-base --is-ancestor suiteHead suiteTip`（同在 `suiteCertGate` 内）—— 非祖先同样拒。
 *       ⇒ 陈旧的 / 别的任务的 / full-run（无 taskId）的绿镜像都【不】能冒充本任务的证书。
 *       ⛔ 条件表以 `readGreenMirrorCommit` 为准，此处不另造一套条件（单源）。
 *   （4）**同一纪律的第二实例**：`plugin/scripts/worker-driver.ts` 的 `readPreviousGreenSuiteCommit` ——
 *       与上条同形（读的是同一个权威载体的同一份 shape），且它已自述其第三态：「取不到 / 非本任务 /
 *       非 green / commit 非法（非 40-hex）⇒ `null`（缺值 = 未查，⛔ 不是「可复用」）」（硬规则 3b）。
 *       两个消费者的条件表是同一张 —— 此处【指向它】，不复制。
 *   （5）**可证伪的反例（硬规则 4 推论四）**：**若** `readGreenMirrorCommit` 只查 `state === "green"` 而
 *       【不查 `taskId`】，**则**上一个任务（或任一别的任务）留下的绿镜像会伪装成本任务的证书，ff 闸据此
 *       放行一个本任务【从未跑过】的 suite ⇒ 本函数的沉默就从「有下游垫背」退化为「恒绿伪装」。
 *       该反例的对照读数在 `plugin/test/fan-in-ff-merge.test.mjs`：同一 fixture 只改 `taskId`
 *       （别的任务 ⇒ exit 2；本任务 ⇒ ff 生效），两条读数相反 —— 这就是本姿态可检验性的来源。 */
export function mirrorMechanicalFanInSuiteState(opts: {
  task: string;
  runId: string;
  commit: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stateFile: string;
}): void {
  try {
    const built = buildMirrorState({
      state: "green", startedAt: opts.startedAt, finishedAt: opts.finishedAt,
      durationMs: opts.durationMs, laneCount: defaultLaneCount(), commit: opts.commit,
      taskId: opts.task, runId: opts.runId, runner: "inner", scope: "worktree",
    });
    if (built.error) return;
    if (shouldSkipMirrorWrite(readCurrentState(opts.stateFile))) return;
    writeMirrorState(opts.stateFile, built.state);
  } catch {
    // best-effort：镜像写失败 ≠ fan-in 失败（mfi 仍是权威）。
  }
}

// ── goal→develop 最终 fan-in 的执行侧（SPEC-goal-branch-2026-10-03 §4.7，裁定⑭⑲⑳）────────────────
//
// 执行者是 worker-driver（task 落地机制的所有者，DIR-131）——⛔ 不是 goal-driver。人在终端里跑
// `quay goal merge` 只【记录请求】（Core `packages/quay/src/goal-merge.ts`）；本函数是每轮把仍
// 「待执行」的请求真正并入 develop 的那一半。
//
// 与 `runMechanicalFanIn` 的关系：**同一套机械（锁 → merge → 验证 → ff），源分支参数化**。
//   · 持锁顺序固定「goal 锁 → develop 锁」（§4.6，避免死锁）。
//   · 临时 worktree 检出 develop（detached），`git merge --no-ff goal/<id>` 造【一个】合并提交
//     （裁定⑲）——develop 本身仍只做 ff，故「develop 上每个提交都是被验证过的树」不变。
//   · 验证（typecheck / scoped 门 / 全量 suite）跑在临时 worktree 上；绿 ⇒ 用 ff-merge 的【源参数】
//     （gap-goal-branch-ff-merge-source-param 的 `sourceRef`）把 develop ff 到该合并提交，删 goal 分支。
//   · 红或冲突 ⇒ 不动任何 ref，释放锁，写 `goal-merge-result`；请求仍「待执行」（tip 前进后自动重试，
//     裁定⑳）——重试由 `pendingGoalMerges`（Core）派生，⛔ 本函数不存状态。

/** goal→develop 并入写进共享步骤 trace 载体时的**判别键**取值（`kind` 字段，随每条 begin/end 落盘）。
 *
 *  为什么必须有它（本任务 gap-goal-merge-execution-writes-no-step-trace）：并入与任务 fan-in 共用同一份
 *  `.quay/fan-in-step-trace.jsonl`，而该载体的既有读者隐含假定「一条记录 = 一次 task fan-in 的一步」。
 *  `task` 字段放的是 GOAL id（⛔ 不是 task id）——以 `task` 为键聚合的读者若不看 `kind`，会把 goal 当成
 *  一个任务；`kind:"goal-merge"` 让这种聚合**可判别**（硬规则 3：枚举，不布尔）。
 *  ⛔ 不写成「goal 条目不进这个载体」——并入的步骤时长正是本任务要读的量，分开写 = 又造一个读者看不见的
 *  分载体（P5 writer-split 的字面实例）。 */
export const GOAL_MERGE_TRACE_KIND = "goal-merge";

/** 写一条 `goal-merge-result` GateEvent（§4.7 裁定⑫：worker-driver 把结果写成 goal 侧可读的事件，
 *  由现有 gap-filing 立「有请求 ∧ 最近一次执行红」的 gap——⛔ 事件里不含任何 fan-in 载体路径，
 *  以过 `goal-driver-task-boundary-check.ts`）。与 appendCompleteGateEvent 同款动态 import（shipped
 *  bundle 由 coreSrcAliasPlugin 内联）。best-effort：写失败返回 {ok:false}，不抛。 */
export async function appendGoalMergeResultEvent(
  root: string,
  goalId: string,
  payload: Record<string, unknown>,
  actor = "quay-driver",
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const { appendGateEvent } = await import(
      "../../packages/quay/src/gate/gate-event-store.ts"
    ) as { appendGateEvent: (logPath: string, event: unknown) => void };
    appendGateEvent(path.join(root, ".quay", "gate-events.jsonl"), {
      id: randomUUID(),
      item_id: goalId,
      pipeline_id: goalId,
      gate: GOAL_MERGE_RESULT_GATE,
      actor,
      verdict: payload.outcome === "landed" ? "pass" : "fail",
      timestamp: new Date().toISOString(),
      payload,
    });
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

export interface GoalMergeFanInOptions {
  root: string;
  goalId: string;
  request: GoalMergeRequest;
  runId?: string;
  perSuiteRunId?: string;
  /** 注入可控 suite 结果（hermetic 测试缝；缺省 = 复用 defaultMechanicalSuiteCommand，与本仓 fan-in 同源）。 */
  suiteCommand?: string[];
  suiteLogFile?: string;
  suiteCapture?: string;
  suiteStateFile?: string;
  slotBase?: string;
  slotLib?: string;
  scriptsDir?: string;
  ffMergeModule?: string;
  /** 可选的额外验证步（生产接线；缺省**不执行 ⇒ 轨迹里无此步**——⛔ 不补一条 not-evaluated 的 end，
   *  理由见 runGoalMergeFanIn 内 traceStep 的注释：该载体每条 end 必须带布尔 ok / 数值 durationMs）。 */
  typecheckCommand?: string[] | null;
  antiDriftCommand?: string[] | null;
  now?: () => Date;
}

export interface GoalMergeFanInResult {
  outcome: "landed" | "red";
  step: string | null;
  reason: string | null;
  tipSha: string;
  landedSha: string | null;
  mergeCommitSha: string | null;
  requestEventId: string;
}

/** 把仍「待执行」的一条 goal 合并请求机械执行一次。⛔ 不调 LLM、不做语义修复；失败即 red + 落事件。 */
export async function runGoalMergeFanIn(opts: GoalMergeFanInOptions): Promise<GoalMergeFanInResult> {
  const { root, goalId, request } = opts;
  const branch = goalBranchName(goalId);
  const runId = opts.runId ?? `gm-${goalId}-${Date.now()}`;
  const perSuiteRunId = opts.perSuiteRunId ?? newMechanicalSuiteRunId(goalId);
  const tipSha = request.tipSha || (await mechSh(["git", "-C", root, "rev-parse", branch], 30_000)).stdout.trim();
  const suiteCapture = opts.suiteCapture ?? path.join(root, ".quay", `goal-merge-suite-${goalId}.env`);
  const suiteStateFile = opts.suiteStateFile ?? path.join(root, ".quay", "full-suite-state.json");
  const suiteLogFile = opts.suiteLogFile ?? path.join(root, ".quay", `goal-merge-suite-${goalId}-${runId.replace(/[^A-Za-z0-9_.-]/g, "_")}.log`);
  const scriptsDir = opts.scriptsDir ?? resolveKernelScriptsDir();

  // ── 步骤轨迹（本任务 gap-goal-merge-execution-writes-no-step-trace）────────────────────────────────
  // 并入的每一步都经 appendFanInStepTrace 写一对 begin/end 到共享载体 `.quay/fan-in-step-trace.jsonl`
  // （与任务 fan-in 的 `step()`，约 :1755 起，同一载体、同一读法）；`step-end` 自带**数值型** `durationMs`，
  // 于是「这次并入慢在哪一步 / 红在哪一步」是直接量，⛔ 不必再从请求与结果两个事件的时间戳反推整段耗时。
  // 每条记录带 `kind: GOAL_MERGE_TRACE_KIND` 判别键，`task` 放 GOAL id（见该常量的注释：既有读者按
  // `task` 聚合时不得把 goal 当成任务）。
  // ⛔ 只给**实际执行**的步骤写 begin/end：未接线的可选步（anti-drift / typecheck 缺省）**不写任何条目**
  // ——本载体的每条 `step-end` 必须带布尔 `ok` 与数值 `durationMs`，补一条 `ok:null` 的「未评估」记录会让
  // 目标项目健康探针（goal-driver.ts 的 HEALTH_PROBE_SCRIPT：`ok` 非布尔 ⇒ 判 `trace-unparseable`）把
  // 「这一步没跑」读成「这个载体读不懂」（硬规则 3b 的反面：没跑的步 ≠ 坏记录）。
  // ⛔ `finally` 里的收尾（删临时 worktree + mkdtemp 父目录）**刻意不成一步**：它在 `red()` 之后、promise
  // settle 之前才跑，若也写 end，则「suite 红的并入」的**最后一条** `step-end` 会是收尾而不是红的那一步
  // （AC1 的判据正是「最后一条 step-end 是 suite 且 ok:false」）——红在哪一步会被收尾掩盖。收尾耗时并入
  // 整段墙钟即可，⛔ 不为它牺牲「末条 = 失败步」这条可读性。
  const traceStep = (step: string, phase: "begin" | "end", extra: Record<string, unknown> = {}): void =>
    appendFanInStepTrace(root, goalId, runId, step, phase, { kind: GOAL_MERGE_TRACE_KIND, ...extra });

  /** 跑一步 + 计时 + 一对 trace。`okOf` 由调用方给实际成败（⛔ 不从返回值自述推）；`extraOf` 只在
   *  【跑完才有读数】时用（如 suite 失败摘要）——它与 `ok`/`durationMs` 写在同一条 end 里，⛔ 不事后补
   *  第二条 end（同一 step 两条 end，在不做 begin/end 配对的读者看来是多跑了一次）。
   *  `okOf` 缺省 `() => true` 只对「唯一失败形态是抛异常」的步成立（如 acquireFanInLock）——那种步的
   *  异常由下面的 catch 写成 `ok:false` 的 end 再原样抛出，⛔ 不留「begin 无 end」的假挂起。 */
  const tracedStep = async <T>(
    name: string,
    run: () => Promise<T>,
    okOf: (v: T) => boolean = () => true,
    extraOf?: (v: T) => Record<string, unknown>,
  ): Promise<T> => {
    const t0 = Date.now();
    traceStep(name, "begin");
    let v: T;
    try {
      v = await run();
    } catch (e) {
      traceStep(name, "end", { ok: false, durationMs: Date.now() - t0, reason: (e as Error)?.message ?? String(e) });
      throw e;
    }
    traceStep(name, "end", { ok: okOf(v), durationMs: Date.now() - t0, ...(extraOf?.(v) ?? {}) });
    return v;
  };

  const red = async (step: string | null, reason: string): Promise<GoalMergeFanInResult> => {
    await appendGoalMergeResultEvent(root, goalId, {
      outcome: "red", step, reason, tipSha, requestEventId: request.eventId, landedSha: null,
    });
    return { outcome: "red", step, reason, tipSha, landedSha: null, mergeCommitSha: null, requestEventId: request.eventId };
  };

  // 固定加锁顺序：goal 锁 → develop 锁（§4.6）。任一 acquire 失败 ⇒ red（⛔ 不动任何 ref）。
  let goalLock: FanInLockHandle | null = null;
  let developLock: FanInLockHandle | null = null;
  let tmpWorktree: string | null = null;
  // mkdtemp 建出来的是【父目录】，worktree 只是它的 `wt` 子目录（见下面建它的那行）。父目录要自己
  // 记着——`tmpWorktree` 指向子目录，清理子目录【不会】删掉父目录，于是每次并入都在 /tmp 留下一个
  // 空的 `goal-merge-GOAL-NNN-XXXXXX`（2026-10-06 实测 584 个）。⛔ 只记本函数 mkdtemp 出来的那个。
  let tmpWorktreeParent: string | null = null;
  try {
    // 两个 acquire 各成一步：**等锁**往往是并入耗时的大头（unbounded 排队），单独成步才读得出它占了多久。
    try {
      goalLock = await tracedStep(
        "acquire-goal-lock",
        () => acquireFanInLock({ root, task: goalId, runId, lockFile: fanInLockFileForMergeTarget(root, branch) }),
      );
    } catch (e) {
      return red("acquire-goal-lock", (e as Error)?.message ?? String(e));
    }
    try {
      developLock = await tracedStep(
        "acquire-develop-lock",
        () => acquireFanInLock({ root, task: goalId, runId, lockFile: fanInLockFile(root) }),
      );
    } catch (e) {
      return red("acquire-develop-lock", (e as Error)?.message ?? String(e));
    }

    // develop 在锁内不会动——记下基线，ff 前复核（CAS 的另一半；⛔ 不假设）。
    const developRead = await tracedStep(
      "read-develop",
      () => mechSh(["git", "-C", root, "rev-parse", "develop"], 30_000),
      (r) => r.ok,
    );
    const developBase = developRead.stdout.trim();
    if (!developBase) return red("read-develop", "develop ref does not resolve");

    // 2. 临时 worktree 检出 develop（detached），造 --no-ff 合并提交（裁定⑲）。
    //    路径用 mkdtemp 的【子目录】——`git worktree add <dir>` 要求目标不存在（mkdtemp 自身建的空目录
    //    会让 git 报 "already exists"）。
    tmpWorktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), `goal-merge-${goalId}-`));
    tmpWorktree = path.join(tmpWorktreeParent, "wt");
    const add = await tracedStep(
      "worktree-add",
      () => mechSh(["git", "-C", root, "worktree", "add", "--detach", tmpWorktree as string, "develop"], 60_000),
      (r) => r.ok,
    );
    if (!add.ok) return red("worktree-add", (add.stderr || add.stdout || "git worktree add failed").trim());
    // 依赖装配（与判据/预览 worktree 同一实现）：裸 `git worktree add` 不带 gitignored 的
    // `node_modules`，而 `git merge --no-ff` 会触发 pre-merge-commit 钩子、suite 也会跑构建——
    // 没有依赖时钩子/构建会 ERR_MODULE_NOT_FOUND 把合并中止（GOAL-904 演练读到的那次）。
    // 主检出没有依赖时不建链（读数由 merge 结果本身如实反映），⛔ 不抛。
    ensureWorktreeNodeModules(root, tmpWorktree);
    const mergeMsg = `merge: ${branch} into develop (request ${request.eventId})`;
    const merge = await tracedStep(
      "merge",
      () => mechSh(["git", "-C", tmpWorktree as string, "merge", "--no-ff", branch, "-m", mergeMsg], 120_000),
      (r) => r.ok,
      (r) => (r.ok ? {} : { reason: (r.stderr || r.stdout || "merge failed").trim() }),
    );
    if (!merge.ok) {
      // 失败分类（硬规则 3b）：`git merge` 非 0 有两种成因——内容冲突与基础设施失败（钩子崩了、spawn
      // 失败等），⛔ 不得同形。只有【退出码 1 ∧ 索引里确有未合并路径】才是 `merge-conflict`；其余写
      // `merge-failed`，`reason` 保留 git 原文（GOAL-904 演练里 pre-merge-commit 钩子 ERR_MODULE_NOT_FOUND
      // 被误标成 merge-conflict，读 step 的人被引去找冲突）。
      const unmerged = (await mechSh(["git", "-C", tmpWorktree, "diff", "--name-only", "--diff-filter=U"], 30_000)).stdout.trim();
      const step = merge.status === 1 && unmerged !== "" ? "merge-conflict" : "merge-failed";
      await mechSh(["git", "-C", tmpWorktree, "merge", "--abort"], 30_000);
      return red(step, (merge.stderr || merge.stdout || "merge failed").trim());
    }
    const mergeCommitSha = (await mechSh(["git", "-C", tmpWorktree, "rev-parse", "HEAD"], 30_000)).stdout.trim();
    if (!mergeCommitSha) return red("merge-commit", "merge produced no commit sha");

    // 2b. `.quay/` 快照（gap-goal-merge-temp-worktree-lacks-quay-snapshot-no-suite-tooling）——
    //     裸 `git worktree add` 只带【已跟踪】的树；`.quay/config.yml` 若是 gitignored（quay 自己与
    //     cantus 都如此），临时 worktree 里就没有它。suite 步随后经
    //     `readLoopSection(<worktree>/.quay/config.yml)` 判「本项目声明了什么能力」，文件不存在 ⇒ 读成
    //     【未声明】⇒ `no-suite-tooling` fail-closed（cantus 2026-10-06 第一次 `quay goal merge
    //     GOAL-003` 就是这样红的，step=suite）。修法复用判据/预览 worktree 的同一实现
    //     （`snapshotQuayDirInto`），⛔ 不写第三份。
    //
    //     ⚠️ 时序（必须先想清楚）：快照必须在【合并提交造好之后】铺。早于 `git merge --no-ff` 会把快照
    //     写进工作树——已跟踪路径的本地改动会让 merge 因「本地改动会被覆盖」失败（quay 自己的仓库跟踪
    //     `.quay/` 下 101 个文件）。放在 merge 之后，合并提交是既成事实，天然不受快照影响。
    //     ⛔ 只铺【未被该合并提交跟踪】的条目：已跟踪条目已由 checkout 铺在 worktree 里，再覆盖一次会让
    //     受测树 ≠ 合并提交，并把已跟踪文件弄脏。`ls-files` 读的是索引（merge --no-ff 提交后索引 =
    //     合并提交的树），正是「哪些路径会被写脏」的判据。两种项目形态都覆盖：跟踪部分 `.quay/` 的
    //     （quay 自己）跳过那些、只补 gitignored 的 config.yml；完全不跟踪的（cantus）全铺。
    //     ⛔ 快照条目是未跟踪/被忽略的运行时文件，不得进任何提交——合并提交在其之前已造好、快照只写
    //     工作树，天然满足。`ok` 判据只认 `copied`：`source-absent`（主检出根本没有 `.quay/`）如实标红，
    //     ⛔ 不伪装成铺过（硬规则 3/3b）。
    const snapshot = await tracedStep(
      "quay-snapshot",
      async () => {
        const trackedOut = await mechSh(["git", "-C", tmpWorktree as string, "ls-files", "-z", "--", ".quay"], 30_000);
        const tracked = new Set(trackedOut.stdout.split("\0").filter(Boolean));
        return snapshotQuayDirInto(root, tmpWorktree as string, {
          skip: (rel) =>
            tracked.has(path.join(".quay", rel))
              ? "tracked by the merge commit — already checked out, not overwritten"
              : null,
        });
      },
      (r) => r.state === "copied",
      (r) => ({ state: r.state, copied: r.copied.length, excluded: r.excluded.length, failed: r.reasons.length }),
    );
    if (snapshot.state !== "copied") {
      return red("quay-snapshot", snapshot.reasons.join("; ") || `snapshot state ${snapshot.state}`);
    }

    // 3. 验证（typecheck / scoped 门 / 全量 suite）——全部跑在临时 worktree（受测树 = 合并提交）。
    if (opts.antiDriftCommand) {
      const a = await tracedStep("anti-drift", () => mechSh(opts.antiDriftCommand as string[], 120_000), (r) => r.ok);
      if (!a.ok) return red("anti-drift", (a.stderr || a.stdout || `exit ${a.status}`).trim());
    }
    if (opts.typecheckCommand) {
      const t = await tracedStep("typecheck", () => mechSh(opts.typecheckCommand as string[], 180_000), (r) => r.ok);
      if (!t.ok) return red("typecheck", (t.stderr || t.stdout || `exit ${t.status}`).trim());
    }
    const suiteResolution: MechanicalSuiteResolution = opts.suiteCommand
      ? { argv: opts.suiteCommand, capabilityMissing: null }
      : resolveMechanicalSuiteCommand({ task: goalId, worktree: tmpWorktree, root, suiteLogFile, runId: perSuiteRunId });
    // 「本项目没有测试能力」（未声明 suite_runner/test_command，或声明读不懂）走**独立 step 取值**
    // `suite-capability`（硬规则 3b）——读 goal-merge-result 的人不会把一个项目配置/环境问题当成
    // 「suite 跑了且失败」的代码问题去查。注入的 suiteCommand（测试缝）永远是 `suite`。
    const suiteStep = suiteResolution.capabilityMissing === null ? "suite" : "suite-capability";
    const suite = await tracedStep(
      suiteStep,
      () => mechSh(suiteResolution.argv, 30 * 60_000),
      (r) => r.ok,
      (r) => (r.ok ? {} : { reason: extractFailureSummary(combinedOutput(r.stdout, r.stderr)) || `exit ${r.status}` }),
    );
    if (!suite.ok) {
      const failReason = extractFailureSummary(combinedOutput(suite.stdout, suite.stderr)) || `exit ${suite.status}`;
      return red(suiteStep, suiteResolution.capabilityMissing ?? failReason);
    }

    // suite 绿：写证书（suite_head = 合并提交 = 待 ff tip ⇒ delta 空 ⇒ 证书闸放行，同 runMechanicalFanIn）。
    writeSuiteCapture(suiteCapture, { full_suite_ran: "true", suite_exit: "0", suite_head: mergeCommitSha });

    // 4. 绿 ⇒ ff-only develop 到该合并提交（ff-merge 的【源参数】），删 goal 分支。
    const ffMod = await loadFfMergeModule(opts.ffMergeModule);
    const ff = await tracedStep(
      "ff",
      () => ffMod.ffMerge({
        task: goalId, root, mergeTarget: "develop", sourceRef: mergeCommitSha,
        runId, attemptKey: perSuiteRunId, worktree: tmpWorktree as string, suiteCapture, suiteState: suiteStateFile,
        lockWaitSecs: 30, token: randomUUID(), scriptsDir,
      }),
      (r) => r.code === 0,
    );
    if (ff.code !== 0) return red("ff", (ff.stderr || ff.stdout || `exit ${ff.code}`).trim());
    const landedSha = ff.landedSha ?? (await mechSh(["git", "-C", root, "rev-parse", "develop"], 30_000)).stdout.trim();

    // 删 goal 分支（+ 判据 worktree，若存在）。best-effort：删不动 ⇒ 落痕但仍是 landed（判据是
    // 「Develop 上出现合并提交」，分支删除是收尾——残留分支不使已落地的合并消失）。
    const criterionWt = path.join(root, ".quay", `goal-criterion-${goalId}`);
    await mechSh(["git", "-C", root, "worktree", "remove", "--force", criterionWt], 60_000);
    const del = await tracedStep("branch-delete", () => mechSh(["git", "-C", root, "branch", "-D", branch], 60_000), (r) => r.ok);
    if (!del.ok) {
      await appendGoalMergeResultEvent(root, goalId, {
        outcome: "landed", step: "branch-delete", reason: (del.stderr || "branch -D failed").trim(),
        tipSha, requestEventId: request.eventId, landedSha,
      });
    }
    await appendGoalMergeResultEvent(root, goalId, {
      outcome: "landed", step: null, reason: null, tipSha, requestEventId: request.eventId, landedSha,
    });
    return { outcome: "landed", step: null, reason: null, tipSha, landedSha, mergeCommitSha, requestEventId: request.eventId };
  } catch (e) {
    return red("exception", (e as Error)?.message ?? String(e));
  } finally {
    if (tmpWorktree) {
      await mechSh(["git", "-C", root, "worktree", "remove", "--force", tmpWorktree], 60_000);
      try { fs.rmSync(tmpWorktree, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    // 上面那步只够得着 `wt` 子目录——再删 mkdtemp 出来的父目录，否则每次并入（成功或失败）都在
    // /tmp 留一个空目录。删之前确认它【确实是本函数建的那个】：basename 以 `goal-merge-` 开头，
    // 且它就是 `tmpWorktree` 的 dirname。⛔ 绝不删 `os.tmpdir()` 本身或任何别的路径 —— 这条判据
    // 取假（用例里的 `keep-me` 安全断言：不属于函数的目录必须原样还在）。
    if (
      tmpWorktreeParent !== null &&
      tmpWorktree !== null &&
      path.basename(tmpWorktreeParent).startsWith("goal-merge-") &&
      path.dirname(tmpWorktree) === tmpWorktreeParent
    ) {
      try { fs.rmSync(tmpWorktreeParent, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    if (developLock) await developLock.release();
    if (goalLock) await goalLock.release();
  }
}
