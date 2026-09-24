#!/usr/bin/env node
// ci-runs-collect.ts — GOAL-020 / AC-265 carrier producer + AC-269 attribution write face
// (tasks/gap-ci-red-attribution-classifier Requested action 2/4).
//
// 本文件是 `.quay/ci-runs.jsonl` 的**唯一写面**。它做两件事：
//   ① 把 GitHub Actions 的 run 结论落成载体记录（字段口径 = AC-265/266/267/268 判据读到的集合）；
//   ② **在写面上接一处归因** —— `conclusion === "failure"` 的记录落盘时带
//      `attribution ∈ {real-defect, infrastructure, known-flake}` + `signals`。
//
// ⛔ 为什么不另写一份「分类报告」：AC-269 的判据读的是**载体里的失败记录本身**。另写报告、或事后
// 往载体追加一条新记录，原记录仍然是 `conclusion=failure` 且无 `attribution` ⇒ 判据照红。归因必须
// 发生在写面。
// ⛔ 非 failure 记录【不写】`attribution`：给 success 也盖一个会让「有归因」这件事失去信息量。
//
// ── 字段口径（逐字对齐判据）────────────────────────────────────────────────────────────
//   ts            run **自己的**时刻（created_at）—— ⛔ 不是采集时刻；AC-265/268 的「窗口」比较建立在
//                 这条上，写成采集时刻会让「回填历史」把窗口伪造出来。
//   branch        head_branch。workflow  workflow 显示名（gh 给 "CI"/"Release"）—— 写成路径会被判据的
//                 `not in (None,"ci.yml","CI")` 静默跳过（rows 空 ⇒ 报 no-decisive-run-after-landing，
//                 而真因是字段口径）。
//   conclusion    只取 success|failure|cancelled（cancelled 按设计不进 decisive 记分）。
//   testFiles     该 run 实际跑到的测试文件数，由日志的 `__GROUP__ … files=N` 派生（GitHub run 元数据里
//                 没有这个字段）；派生不出就【不写这个键】—— 缺 ≠ 0（硬规则 6）。
//   prereqProvision
//                 **在 job 级读数上**（判据读 `jobs[]` 里 `name == "test"` 那条）：该 job 自己的日志里
//                 `__PREREQ__ <name>=<state>` 行（ci.yml 的 `Install suite runtime prerequisites` 步打印）
//                 ⇒ `{pyyaml, tmux, procps}` 三键。词表 `already-present | installed-apt | installed-pip
//                 | absent`；⛔ 没有「读不懂 ⇒ already-present」的路径（硬规则 3b）。
//                 **日志压根没拉** ⇒ **不写该键**（缺 ≠ 0）；**拉到了但一条 marker 都没有** ⇒ 三键全
//                 `absent`（一个独立取值：「没评估成」，⛔ 不是「从来没装过」）。AC-282 载体臂读它。
//   schedulerMs   **在 job 级读数上**（判据 AC-281 读 `jobs[]` 里 `name == "test"` 那条）：该 job
//                 自己的日志里 `__OVERHEAD__ scheduler_ms=<n>` 行（`suite-scheduler.ts` 在套件队列
//                 排空那一刻往 stderr 打一次）⇒ 套件**自身调度器**的墙钟（毫秒）。
//                 ⛔ 它**不是** job 总墙钟：GitHub 的 `durationSec` 含 checkout / npm install /
//                 coverage self-check / runner 收尾（实测 ≥27s 的不可约开销），而 AC-281 只量套件自身。
//                 **日志压根没拉 / 日志里没有这一行** ⇒ **不写该键**（缺 ≠ 0，硬规则 6）。
//   seaVerify     **只在 release workflow 的记录上**出现（`workflow ∈ {Release, release.yml}`）：
//                 release.yml 的 SEA 验证 job（`sea-verify-node-free` +
//                 matrix 形态的 `sea-verify-node-free-cross-platform (…)`）的结论派生 ——
//                 `success` / `failure` / `incomplete`（只到一部分 job）/ `absent`（一个都不在 =
//                 job 列表读不到 ⇒ **没评估成**）。⛔ 词表里没有「读不懂 ⇒ success」的路径
//                 （硬规则 3b/4：恒为 success 的字段与「一切正常」同形）。AC-267 的载体臂读它。
//
// ── 载体的归宿：**gitignored 运行时载体**（⛔ 2026-09-15 改判，理由如下）─────────────────────
// 本文件此前把载体写成**被 git 跟踪**的，并要求「采集与提交必须成对做」。**那与本文件的第 ② 条
// 生产接线（goal-driver 每轮采集）在结构上不相容**，实测证据：
//   ff 的 benign-runtime-dirty 通道只放行 `??`（**未跟踪**）的路径（`fan-in/ff-merge.ts:239`
//   `if (pstatus !== "??") { benignOk = false; break; }`）⇒ 一条被跟踪且被改写的
//   `.quay/ci-runs.jsonl` 会让**每一次** fan-in 的 ff 判「working tree not clean」。
//   而 goal-driver 每轮采集 ⇒ 每轮都把这条跟踪文件改脏 ⇒ 全仓 fan-in 的 ff 永久失败。
// ⇒ 载体现为 gitignored（与 `.quay/goal-round.jsonl` / `.quay/worker-outcome.jsonl` 同族），
//   登记在 `plugin/scripts/quay-runtime-artifacts.txt`（消费者项目的 `.gitignore` 由它生成）。
//   **为什么不担心「不跟踪就丢」**：载体的每一条都是 GitHub 状态的**派生视图**，gh 可达时可由
//   「回填历史」完整重建（`--limit` 覆盖 AC-265 窗口所需的全部 decisive run）——它不是原始数据。
//   ⛔ 判据读的仍是盘上这个路径；未跟踪不影响可读性（AC-265/268/269 的判据都只 os.path.exists）。
//
// ── 两件事都必须**可区分**（硬规则 3b）────────────────────────────────────────────────────
//   gh 不可达     ⇒ collectForRound() 返回 status:"gh-unavailable" + 候选清单，⛔ 不静默写 0 条。
//   testFiles 派生不出 ⇒ **不写该键**（缺 ≠ 0），⛔ 不回落到一个常量（恒值字段会让反作弊关系退化成恒等式）。
//
// ── 离线缝 ─────────────────────────────────────────────────────────────────────────────
// `--from-file <runs.json>` 用一份 gh 形状的 run 数组替代真实 API 调用，走的是**同一个 collect()**
// 与**同一个写函数**。这让「写面会写 attribution」可以在没有网络时被真跑一遍，而不是靠手工往载体里塞一行。
//
// 用法:
//   node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --limit 20 --branch develop --workflow ci.yml
//   node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --from-file runs.json --print
//   node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --log-fetch none --print
// 退出码: 0 = 采集并落盘（或 dry-run）成功；1 = 输入读不懂 / gh 失败；2 = 用法错误。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
// flag (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one of
// the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { flagValue } from "./gate-script-base.ts";
import {
  attributeRun,
  jobNeverStarted,
  loadKnownFlakes,
  defaultKnownFlakesPath,
  type KnownFlakeRegistry,
  type RunRecord,
  type JobReading,
} from "./ci-red-attribute.ts";

/** 默认载体路径（相对 root）。 */
export const CARRIER_REL = path.join(".quay", "ci-runs.jsonl");

/** GitHub run 里本模块用到的字段（`gh api .../actions/runs` 的形状）。 */
export interface GhRun {
  id?: number | string;
  name?: string;
  display_title?: string;
  head_branch?: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
  run_started_at?: string;
  updated_at?: string;
  html_url?: string;
}
export interface GhJob {
  id?: number | string;
  name?: string;
  conclusion?: string | null;
  /**
   * 该 job 拿到的 runner 名（jobs API 原生字段）。**直接量**：`""` = 这个 job 从未拿到 runner
   * （实测 2026-09-24 run 35966264609 的 `version-consistency`），⛔ `null` = API 说「还没有值」
   * （排队中）—— 两者在采集器里必须**分别**落成「写空串」与「不写键」，见 `toJobReadings`。
   */
  runner_name?: string | null;
  started_at?: string;
  completed_at?: string;
  steps?: Array<{ name?: string; conclusion?: string | null; number?: number }>;
}

/** 日志里测试文件总数的派生形（唯一实测出现过的形态：`__GROUP__ concurrency=8 files=631`）。 */
export const GROUP_FILES_RE = /__GROUP__[^\n]*?\bfiles=(\d+)/g;

/** 从一段 job 日志里派生 testFiles（取所有 `__GROUP__ … files=N` 的最大值）。派生不出 ⇒ null。 */
export function deriveTestFilesFromLog(logText: string): number | null {
  let max: number | null = null;
  for (const m of logText.matchAll(GROUP_FILES_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && (max === null || n > max)) max = n;
  }
  return max;
}

// ── prereqProvision：套件运行前置「是本来就有的、还是每个 job 又装了一遍」（AC-282 载体臂）──────
// 为什么需要它：AC-282 问的是「`Install suite runtime prerequisites` 那一步在预置好的 runner 上是否
// 走 no-op 分支」。这个读数在 **jobs API 这一层结构上不可派生** —— `GhJob.steps` 只有
// `{name, conclusion, number}`，而 `already-present` 与 `installed-apt` 两个分支的 step conclusion
// **都是 `success`**，jobs API 也不给 per-step 时长。⇒ 唯一承载它的位置是**那一步自己的 stdout**；
// 故 workflow 每个分支各打印一行机器可读 marker，本函数只读该行（⛔ 不读散文措辞 ——
// 「中间层把量改写掉」正是硬规则 4c 的形态）。
//
// ⛔ `absent` 是**独立取值**，绝不回落成 `already-present`（硬规则 3b/4：一个恒为「合格」的字段与
// 「一切正常」同形，会让 AC-282 变成恒真的回声）。两个不同的观测各自成值：
//   · marker 行在且说 already-present ⇒ `already-present`（真的预置好了）
//   · marker 行在、但说是别的前置状态 ⇒ 逐字取那个值（`installed-apt` / `installed-pip`）
//   · **一条 marker 都没有**（日志拉到了） ⇒ `absent`（没评估成）
//   · **日志没拉** ⇒ **不写该键**（缺 ≠ 0，与 `testFiles` 同款；这是调用点的事，不是本函数的事）

/** 前置名（AC-282 判据逐字读这三个键）。 */
export const PREREQ_NAMES = ["pyyaml", "tmux", "procps"] as const;

/** marker 行的形态：`__PREREQ__ <name>=<state>`（house 形，与 `__GROUP__` 同族）。 */
export const PREREQ_MARKER_RE = /__PREREQ__[ \t]+([A-Za-z0-9_-]+)=([A-Za-z0-9_.-]+)/g;

/** 该前置本来就有的。 */
export const PREREQ_ALREADY_PRESENT = "already-present";
/** 该前置在本 job 内用 apt 装过（= 镜像没预置）。 */
export const PREREQ_INSTALLED_APT = "installed-apt";
/** 该前置在本 job 内用 pip 装过（走 apt 不可用那条分支）。 */
export const PREREQ_INSTALLED_PIP = "installed-pip";
/** **没有任何 marker 行** ⇒ 没评估成（⛔ 不是「没装过」，也不是「已经有了」）。 */
export const PREREQ_ABSENT = "absent";

/** 派生词表。⛔ 未知取值**不进入**词表 —— 见 `derivePrereqProvision` 的过滤。 */
export const PREREQ_VOCAB: readonly string[] = [
  PREREQ_ALREADY_PRESENT,
  PREREQ_INSTALLED_APT,
  PREREQ_INSTALLED_PIP,
  PREREQ_ABSENT,
];

/**
 * 从**一个 job 自己的日志**里派生 `prereqProvision`。三键**总是齐**（判据要求 `NEED` 三键全在），
 * 缺的填 `absent`。
 *
 * ⛔ 未知取值（marker 名不在 PREREQ_NAMES / 值不在 PREREQ_VOCAB）**被丢掉**，不进入输出：让一个
 * 未经声明的字符串流进载体，会让下游只能拿「≠ already-present」去判它，从而**把「读不懂」报成
 * 「每次都在重装」**（硬规则 3b 的同族：一个看起来覆盖了的取值）。丢掉 ⇒ 该前置回落 `absent`
 * （「没评估成」），方向安全。
 * 同一前置出现多行 ⇒ **后者胜**（同一条日志里最后打印的那个状态才是终态）。
 */
export function derivePrereqProvision(logText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PREREQ_NAMES) out[name] = PREREQ_ABSENT;
  for (const m of logText.matchAll(PREREQ_MARKER_RE)) {
    const name = m[1];
    const value = m[2];
    if (!(PREREQ_NAMES as readonly string[]).includes(name)) continue;
    if (!PREREQ_VOCAB.includes(value)) continue;
    out[name] = value;
  }
  return out;
}

/** 一条 job 读数是否已经带了 prereqProvision（载体侧判「这条 run 派生过了」用的）。 */
export function hasPrereqProvision(reading: { prereqProvision?: unknown }): boolean {
  const p = reading.prereqProvision;
  return p !== null && typeof p === "object" && !Array.isArray(p);
}

// ── schedulerMs：**套件自身调度器**的墙钟（AC-281 判据读的字段）───────────────────────────────
// 为什么需要它（tasks/gap-ac281-scheduler-ms-carrier-field）：AC-281 原量的是 CI `test` job 的**总
// 墙钟**（`durationSec`），而其中不可约的固定开销（checkout / npm install / coverage self-check /
// runner 收尾）实测 ≥27s ⇒ 那条判据在当前 job 结构下**数学不可达成**。2026-09-17 人裁定改为只量
// 套件自身的调度器时长 —— 那条读数此前只在日志里，载体没有采集它 ⇒ 判据永久停在
// `CAUSE=scheduler-ms-not-recorded`（NOT-EVALUATED，硬规则 4 推论三的形态：明明打了，但没落进载体）。
//
// 这个读数**只能**从 job 自己的日志得到：GitHub 的 jobs API 只给 job 级 started/completed_at（固定
// 开销一起算进去），不拆分套件内部。故 `suite-scheduler.ts` 在**所有文件跑完、三个队列都排空**那一刻
// 往 stderr 打一行 house marker（与 `__GROUP__` / `__PREREQ__` 同族），本组函数只读该行。
//
// ⛔ 正则**刻意不锚 `^`**：GitHub 的 job 日志给**每一行**都加了 `<ISO 时间戳> ` 前缀（实测 2026-09-17
// run 35233095902 / job 105242006545 的原始字节：
//   `2026-09-17T14:23:32.6759493Z __OVERHEAD__ scheduler_ms=53460`）
// ⇒ `^`-锚定会让命中**恒为 0**，而"检查恒不命中"与"套件没打印"同形（硬规则 4c：判据点名的量必须
// 穿过所有中间层还取得到 —— 这里的中间层就是 GitHub 的行前缀）。同文件既有的 `GROUP_FILES_RE` /
// `PREREQ_MARKER_RE` 也正是**不锚**的，这是同一条实测结论的第二个受益者。

/** marker 行的形态：`__OVERHEAD__ scheduler_ms=<n>`（单位毫秒）。 */
export const SCHEDULER_MS_RE = /__OVERHEAD__[ \t]+scheduler_ms=(\d+)/g;

/**
 * 从**一个 job 自己的日志**里派生 `schedulerMs`（毫秒）。命中 ⇒ 取**最后一个**；无命中 / 读不懂
 * ⇒ `null`（调用方据此**不写**该键 —— 缺 ≠ 0，硬规则 6，⛔ 不回落成 `0`/`-1` 这类"看起来像失败"
 * 的假值：一个恒值字段会让 AC-281 的判据退化成恒真的回声，硬规则 4）。
 *
 * 为什么取**最后一个**：该 marker 在同一份日志里**结构上只出现一次**（调度器只在队列排空那一刻打
 * 一次；实测上述真实日志里 `scheduler_ms=` 的命中数 = 1），故"第一个"与"最后一个"在真实日志上等价；
 * 但一旦哪天出现第二行，**最后一行才是调度器自己的终态读数**（它必然排在所有测试输出之后），而第一行
 * 可能是某个测试回显的字符串。与 `derivePrereqProvision` 的「同一前置多行 ⇒ 后者胜」同款。
 */
export function deriveSchedulerMs(logText: string): number | null {
  let last: number | null = null;
  for (const m of logText.matchAll(SCHEDULER_MS_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) last = n;
  }
  return last;
}

/** 一条 job 读数是否已经带了 schedulerMs（载体侧判「这条 run 派生过了」用的）。 */
export function hasSchedulerMs(reading: { schedulerMs?: unknown }): boolean {
  return typeof reading.schedulerMs === "number" && Number.isFinite(reading.schedulerMs);
}

// ── notStartedCause：**未启动 job 的成因**（tasks/gap-ci-collector-job-not-started-misattributed-as-timeout）──
// 为什么需要它：`runnerName === ""` + `steps: []` 已经能把「从没起跑」从「跑到一半挂死」里分出来
// （那才是主判据，见 ci-red-attribute.ts 的 `jobNeverStarted`），但**为什么没起跑**只在 check-run
// annotation 里 —— 实测 run 35966264609 逐字给出：
//   *"The job was not started because recent account payments have failed or your spending limit needs to
//     be increased"*
// 没有它，「未启动」只说明现象、不说明成因（是配额？是余额？是 runner 池没容量？）。
//
// ⛔ 它是**成因补充，不是信号源**：拿不到成因时写 `null`（= 试过但拿不到），而 not-started 这个 signal
// **照常产出** —— 绝不因为拿不到成因就回落到 `job-timeout-reached`（那正是本任务要修的误归因）。
// ⛔ 也只对 conclusion=failure 的未启动 job 调（成功的 run 根本不做归因，拉了纯属浪费配额）。

/** `notStartedCause` 的截断长度 —— **唯一一处**常量（写入侧与测试都读它，⛔ 不出现第二个字面值）。 */
export const NOT_STARTED_CAUSE_MAX_CHARS = 400;

/** check-runs annotations 响应**里一个元素**用到的字段（`gh api /repos/<repo>/check-runs/<id>/annotations`；
 *  ⚠️ 响应顶层是**数组**，见 `deriveNotStartedCause`）。 */
export interface GhAnnotation {
  annotation_level?: string | null;
  message?: string | null;
}

/**
 * 从 annotations 响应里取**失败级**成因：`annotation_level === "failure"` 的第一条 message，**逐字**
 * （只按 `NOT_STARTED_CAUSE_MAX_CHARS` 截断，⛔ 不加省略号 —— 加了就不是逐字了）。
 *
 * ⚠️ **响应形态实测**（2026-09-24，`gh api /repos/yaleh/quay/check-runs/107553751055/annotations`）：
 * 这个端点返回的是**裸 JSON 数组**，⛔ 不是 `{annotations: […]}` 包一层的对象
 * （逐字：`[{"path":".github",…,"annotation_level":"failure","message":"The job was not started because
 * recent account payments have failed…"},{…,"annotation_level":"notice",…}]`）。
 * 故两种形态都收：**裸数组**（实测形态）与 `{annotations: […]}`（包一层，防御性）。⛔ 只认前者会让
 * 生产侧**永远**只落 `null` —— 而 `null` 恰好也是「没拿到成因」的合法取值，于是「端点形态读错了」
 * 与「真的没有成因」同形（硬规则 3b）。这条只有**真打一次 API** 才能发现：单测夹具若照着自己以为的
 * 形状写，绿色也只证明自己和自己一致。
 *
 * 拿不到 ⇒ `null`（**独立取值**，硬规则 3b）：响应既不是数组也不是对象 / 一条 failure 级的都没有 /
 * message 是空白。⛔ 绝不回落成空串（空串在本模块里是 `runnerName` 那个「确定读到」的取值，两者不得同形）。
 */
export function deriveNotStartedCause(body: unknown): string | null {
  const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  let list: unknown[];
  if (Array.isArray(body)) {
    list = asList(body);
  } else {
    const obj = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    list = obj === null ? [] : asList(obj.annotations);
  }
  for (const a of list) {
    const rec = a !== null && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : null;
    if (rec === null) continue;
    if (String(rec.annotation_level ?? "") !== "failure") continue;
    const msg = typeof rec.message === "string" ? rec.message : "";
    if (msg.trim() === "") continue;
    return msg.length > NOT_STARTED_CAUSE_MAX_CHARS ? msg.slice(0, NOT_STARTED_CAUSE_MAX_CHARS) : msg;
  }
  return null;
}

// ── seaVerify：SEA 产物「真的能在无 Node 环境跑起来吗」的载体字段（AC-267 载体臂）──────────────
// 为什么需要它：AC-267 的判据静态臂只证明**源码里**再没有模块顶层求值 `import.meta.url` 的点；
// 「发出去的二进制真的能起 `quay serve`」这件事只能由**一次真实 release run** 证明。在此之前载体里
// 根本没有承载这个读数的字段 ⇒ 判据停在 `CAUSE=carrier-absent`，而那是**结构性**的（同硬规则 4
// 推论三：实现了、测试绿了、生产没跑过）。本字段把 release workflow 自己的 SEA 验证 job 结论
// 派生进记录，让载体臂有东西可读。
//
// ⛔ 词表里**没有**「读不懂 ⇒ success」的路径（硬规则 3b）：job 列表读不到 / 这些 job 一个都不在
// ⇒ `absent`（一个**独立取值**，明确「没评估成」），⛔ 绝不回落到常量 `success` —— 一个恒为
// `success` 的字段与「一切正常」同形，它会让 AC-267 的载体臂变成恒真的回声（硬规则 4）。

/** release workflow 的两种写法：gh 的 `run.name` 给的是 workflow 的 `name:`（本仓
 *  `.github/workflows/release.yml` 的 `name:` 是 `Release`），判据两种都认。 */
export const RELEASE_WORKFLOW_NAMES = ["Release", "release.yml"];

/** release.yml 里真正跑 SEA 二进制的那两个 job 的**基名**。
 *  ⚠️ 第二个是 matrix job，gh 把矩阵值缀在名字后
 *  （实测 2026-09-15：`sea-verify-node-free-cross-platform (macos-latest, macos-arm64, tar.gz)`）
 *  ⇒ 必须按**基名 + ` (`** 匹配，逐字相等会把它读成「缺失」。
 *  第一个 `sea-verify-node-free` 不带矩阵后缀。 */
export const SEA_VERIFY_JOB_BASES = ["sea-verify-node-free", "sea-verify-node-free-cross-platform"];

/** `seaVerify` 的取值词表。四个取值各对应一个**不同的观测**，相互可区分。 */
export const SEA_VERIFY_SUCCESS = "success";
/** 这些 job 中至少有一个在，且结论不是 success（真红）。 */
export const SEA_VERIFY_FAILURE = "failure";
/** 一部分 job 在、一部分不在 ⇒ 结论**不完整**，无法据此判 success。 */
export const SEA_VERIFY_INCOMPLETE = "incomplete";
/** **一个都不在** —— job 列表读不到（API 失败 / 空），或这条 run 根本没有 SEA 验证 job。
 *  ⛔ 这是「没评估成」，不是「通过了」。 */
export const SEA_VERIFY_ABSENT = "absent";

/** job 名是否属于某个基名（精确名，或 matrix 形态 `基名 (…, …)`）。 */
function jobMatchesBase(job: { name?: string }, base: string): boolean {
  const n = String(job.name ?? "");
  return n === base || n.startsWith(`${base} (`);
}

/**
 * 从一条 run 的 job 读数派生 `seaVerify`。
 *
 * 判定次序（先报**确证的观测**，再报「读不全」，最后才是 success —— ⛔ success 只能是兜底之外
 * 唯一的正读数，绝不能是兜底）：
 *   ① 两个基名一个都不在 ⇒ `absent`（job 列表读不到 / 无 SEA 验证 job）
 *   ② 命中的 job 里有任何一条 conclusion !== "success" ⇒ `failure`
 *   ③ 只到了一部分基名 ⇒ `incomplete`
 *   ④ 两个基名都在且全为 success ⇒ `success`
 */
export function deriveSeaVerify(jobs: Array<{ name?: string; conclusion?: string | null }>): string {
  const presentBases = SEA_VERIFY_JOB_BASES.filter((b) => jobs.some((j) => jobMatchesBase(j, b)));
  if (presentBases.length === 0) return SEA_VERIFY_ABSENT;
  const matched = jobs.filter((j) => SEA_VERIFY_JOB_BASES.some((b) => jobMatchesBase(j, b)));
  if (matched.some((j) => String(j.conclusion ?? "") !== "success")) return SEA_VERIFY_FAILURE;
  if (presentBases.length < SEA_VERIFY_JOB_BASES.length) return SEA_VERIFY_INCOMPLETE;
  return SEA_VERIFY_SUCCESS;
}

/** 从 workflow YAML 里抽 per-job `timeout-minutes`（键为 job id）。抽不出 ⇒ {}。 */
export function parseJobTimeouts(yaml: string): Record<string, number> {
  const out: Record<string, number> = {};
  const lines = yaml.split("\n");
  let current: string | null = null;
  let inJobs = false;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) break; // 离开 jobs 块
    const jobKey = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobKey) {
      current = jobKey[1];
      continue;
    }
    const tm = /^\s+timeout-minutes:\s*(\d+)\s*$/.exec(line);
    if (tm && current !== null) out[current] = Number(tm[1]);
  }
  return out;
}

function secsBetween(a?: string, b?: string): number | undefined {
  if (!a || !b) return undefined;
  const t0 = Date.parse(a);
  const t1 = Date.parse(b);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return undefined;
  return Math.round((t1 - t0) / 1000);
}

/** 把 gh 的 job 形状转成归因器读的 job 读数（纯转换，无 IO）。
 *
 *  `prereqByJob` 是**这次真的拉到过日志**的 job（键 = job 对象的引用）→ 它日志里派生出的
 *  `prereqProvision`。⛔ 不在表里的 job（没拉日志）**不写这个键** —— 缺 ≠ `absent`（硬规则 6）。
 *  用对象引用而不是 job id 作键：id 可能缺失/重复，而 `targets` 与 `jobs` 是同一批对象。 */
export function toJobReadings(
  jobs: GhJob[],
  timeouts: Record<string, number> = {},
  prereqByJob?: ReadonlyMap<GhJob, Record<string, string>>,
  schedulerByJob?: ReadonlyMap<GhJob, number>,
): JobReading[] {
  return jobs.map((j) => {
    const name = String(j.name ?? "");
    const reading: JobReading = {
      name,
      conclusion: j.conclusion === null || j.conclusion === undefined ? undefined : String(j.conclusion),
    };
    // runnerName：**只有 API 给了字符串才落键**。`""` 是「从未拿到 runner」的直接读数（要落），
    // `null` / 缺键 = API 说「还没有值」/ 这个字段没采到 ⇒ **不落键**（缺 ≠ 空串，硬规则 6）。
    if (typeof j.runner_name === "string") reading.runnerName = j.runner_name;
    const dur = secsBetween(j.started_at, j.completed_at);
    if (dur !== undefined) reading.durationSec = dur;
    const to = timeouts[name];
    if (typeof to === "number" && to > 0) reading.timeoutMinutes = to;
    const prov = prereqByJob?.get(j);
    if (prov !== undefined) reading.prereqProvision = prov;
    const sched = schedulerByJob?.get(j);
    if (sched !== undefined) reading.schedulerMs = sched;
    if (Array.isArray(j.steps)) {
      reading.steps = j.steps.map((s) => ({
        name: String(s.name ?? ""),
        conclusion: s.conclusion === null || s.conclusion === undefined ? undefined : String(s.conclusion),
        ...(typeof s.number === "number" ? { number: s.number } : {}),
      }));
    }
    return reading;
  });
}

export interface BuildRecordOptions {
  jobs?: GhJob[];
  timeouts?: Record<string, number>;
  testFiles?: number | null;
  failedTests?: string[];
  /** 这次真的拉到过日志的 job → 它日志里派生出的 `prereqProvision`（见 `toJobReadings`）。 */
  prereqByJob?: ReadonlyMap<GhJob, Record<string, string>>;
  /** 这次真的拉到过日志的 job → 它日志里派生出的 `schedulerMs`（见 `toJobReadings`）。 */
  schedulerByJob?: ReadonlyMap<GhJob, number>;
  /**
   * **未启动 job 的成因**（check-runs annotation 的 message 逐字；`null` = 试过但拿不到）。
   * ⛔ 只在**这条 run 真的有未启动 job** 时才传 —— 键缺失 = 没有未启动 job（缺 ≠ `null`，硬规则 6）。
   */
  notStartedCause?: string | null;
}

/**
 * gh run → 载体记录。**只做转换，不做归因** —— 归因是写面的单独一步（withAttribution），
 * 这样「记录长什么样」与「它被判成什么」两件事可以分别被检验。
 */
export function buildRecord(run: GhRun, opts: BuildRecordOptions = {}): RunRecord {
  const rec: RunRecord = {
    // run 自己的时刻（⛔ 不是采集时刻）
    ts: String(run.created_at ?? run.run_started_at ?? ""),
    branch: run.head_branch === undefined ? undefined : String(run.head_branch),
    workflow: run.name === undefined ? undefined : String(run.name),
    conclusion: run.conclusion === null || run.conclusion === undefined ? undefined : String(run.conclusion),
    runId: run.id,
    url: run.html_url,
  };
  const dur = secsBetween(run.run_started_at ?? run.created_at, run.updated_at);
  if (dur !== undefined) rec.durationSec = dur;

  const jobs = opts.jobs ?? [];
  if (jobs.length > 0) {
    rec.jobs = toJobReadings(jobs, opts.timeouts ?? {}, opts.prereqByJob, opts.schedulerByJob);
  }
  // seaVerify：**只在 release workflow 的记录上**派生（AC-267 载体臂读的是
  // `workflow ∈ {release.yml, Release}` 的记录）。派生自本条记录自己的 job 读数 —— 与 `rec.jobs`
  // 同源，两者不会各说各话。⛔ jobs 为空（API 读失败 / 离线缝没喂）⇒ `absent`，⛔ 不是 `success`。
  if (RELEASE_WORKFLOW_NAMES.includes(String(run.name ?? ""))) {
    rec.seaVerify = deriveSeaVerify(rec.jobs ?? jobs);
  }
  // `timedOut` 只记 **GitHub 自己说的**（run 或 job 结论为 timed_out）；从时长推断的那条走
  // 归因器的 infra:job-timeout-reached（两个不同来源，不合并成一个布尔）。
  // ⛔ 这一条**不在** `jobs.length > 0` 块里：run 级的 timed_out 与「job 列表取没取到」无关，
  // 放进那个块会让「jobs API 读失败」静默地连带丢掉 run 级超时这个直接观测。
  if (String(run.conclusion ?? "") === "timed_out" || jobs.some((j) => String(j.conclusion ?? "") === "timed_out")) {
    rec.timedOut = true;
  }
  if (typeof opts.testFiles === "number" && opts.testFiles > 0) rec.testFiles = opts.testFiles;
  if (Array.isArray(opts.failedTests) && opts.failedTests.length > 0) rec.failedTests = opts.failedTests;
  // 未启动 job 的成因：⛔ `null` 要**落键**（那是「试过但拿不到」这个独立取值），故判 `!== undefined`
  // —— 末尾那句「删掉所有 undefined 键」的清扫不会碰它。
  if (opts.notStartedCause !== undefined) rec.notStartedCause = opts.notStartedCause;

  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return rec;
}

/**
 * **写面**：给一条记录决定它落盘时带不带 `attribution`。
 * 非 failure ⇒ 原样返回（⛔ 不带 attribution 字段）；failure ⇒ 带 `{attribution, signals}`。
 */
export function withAttribution(record: RunRecord, knownFlakes: KnownFlakeRegistry | null): RunRecord {
  if (String(record.conclusion ?? "") !== "failure") return record;
  const res = attributeRun(record, { knownFlakes });
  if (res.attribution === null) return record; // failure 记录上不该发生；宁可不写也不编一个值
  return { ...record, attribution: res.attribution, signals: res.signals };
}

// ── IO（gh / 文件 / 载体）─────────────────────────────────────────────────────────────────

export type GhRunner = (args: string[]) => string;

/** gh 二进制的解析结果。**三态可区分**（硬规则 3b）：`bin === null` 是一个**读数**（没找到 gh），
 *  ⛔ 不是一个异常、更不是「跑过且零输出」——后者会让「gh 不可达」与「CI 没有 run」同形。 */
export interface GhBinResolution {
  bin: string | null;
  /** 解析来源：`env:QUAY_GH_BIN` / `env:GH_BIN` / `path:<dir>` / `fallback:<path>` / `none`。 */
  source: string;
  /** 依次尝试过的候选（诊断用；`bin === null` 时它是唯一的成因证据）。 */
  candidates: string[];
}

/**
 * 解析 gh 可执行文件。⛔ 不靠 `execFileSync("gh")` 撞 PATH：driver 的 PATH 不保证含 `~/.local/bin`
 * （实测 2026-09-15：本机 gh 在 `/home/yale/.local/bin/gh`，而常驻 driver 的 PATH 里没有它）。
 * 顺序：显式 env（QUAY_GH_BIN → GH_BIN）→ PATH 各目录 → 常见安装位。
 */
export function resolveGhBin(
  env: NodeJS.ProcessEnv = process.env,
  isExec: (p: string) => boolean = (p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
): GhBinResolution {
  const candidates: string[] = [];
  const labelled: Array<{ bin: string; source: string }> = [];
  const push = (p: string | undefined, source: string) => {
    if (!p || p.trim() === "" || candidates.includes(p)) return;
    candidates.push(p);
    labelled.push({ bin: p, source });
  };
  push(env.QUAY_GH_BIN, "env:QUAY_GH_BIN");
  push(env.GH_BIN, "env:GH_BIN");
  for (const dir of String(env.PATH ?? "").split(path.delimiter)) {
    if (dir.trim() !== "") push(path.join(dir, "gh"), `path:${dir}`);
  }
  const home = env.HOME && env.HOME.trim() !== "" ? env.HOME : null;
  if (home) push(path.join(home, ".local", "bin", "gh"), "fallback:~/.local/bin/gh");
  for (const p of ["/usr/local/bin/gh", "/opt/homebrew/bin/gh", "/usr/bin/gh", "/bin/gh"]) {
    push(p, `fallback:${p}`);
  }

  for (const c of labelled) {
    if (isExec(c.bin)) return { bin: c.bin, source: c.source, candidates };
  }
  return { bin: null, source: "none", candidates };
}

/** gh 不可达（PATH/env 里都没有可执行的 gh）。⛔ 与「gh 跑了但失败」是两个不同的成因。 */
export class GhUnavailableError extends Error {
  // ⛔ 不写 TS parameter property（`constructor(readonly x)`）：Node 的 strip-only 类型剥离不支持它
  // （实测 2026-09-15：`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not
  // supported in strip-only mode`——而本仓跑的就是 strip-only）。
  resolution: GhBinResolution;
  constructor(resolution: GhBinResolution) {
    super(
      `gh 不可达（PATH / QUAY_GH_BIN / GH_BIN 都解析不出可执行的 gh）—— 尝试过的候选: ${resolution.candidates.join(", ") || "(空)"}`,
    );
    this.name = "GhUnavailableError";
    this.resolution = resolution;
  }
}

/** 缺省 gh runner。⛔ 在**调用时**才解析二进制（模块加载时解析会把「当时的环境」冻进常量，
 *  测试缝/驱动环境改 PATH 后不生效）。解析不出 ⇒ 抛 GhUnavailableError（可区分，⛔ 不静默返回空串）。 */
export const defaultGhRunner: GhRunner = (args) => {
  const res = resolveGhBin();
  if (res.bin === null) throw new GhUnavailableError(res);
  return execFileSync(res.bin, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
};

function ghJson<T>(run: GhRunner, args: string[]): T {
  return JSON.parse(run(args)) as T;
}

/** 日志拉取模式。`decisive` = 只对判据能记分的 run（conclusion ∈ success|failure）拉日志 ——
 *  cancelled 占 develop run 的 ~43%（被后续 push 顶替），对它们拉日志纯属浪费且判据不读。 */
export type LogFetchMode = "none" | "decisive" | "all";

/** 单次调用为一个 run 拉日志的上界（成本上界；超出 ⇒ 留 `log-budget-exhausted:` 警告，⛔ 不静默少拉）。 */
export const DEFAULT_MAX_LOG_RUNS = 25;

/** 派生 testFiles 时优先拉哪些 job 的日志：`__GROUP__` 行由 scripts/test.sh 产出，只在跑测试的那个
 *  job 里。实测 2026-09-15：4 个 job 中只有 `test` 的日志含该行 ⇒ 只拉 1 份而不是 4 份。 */
export const DEFAULT_LOG_JOB_RE = /test|suite/i;

export interface CollectOptions {
  repo: string;
  workflow?: string;
  limit?: number;
  branch?: string;
  /** 兼容旧调用：`true` ⇒ 等价于 `logFetch:"all"`。 */
  fetchLogs?: boolean;
  /** 日志拉取模式（缺省 `decisive`）。 */
  logFetch?: LogFetchMode;
  /** 单次调用为一个 run 拉日志的上界（缺省 DEFAULT_MAX_LOG_RUNS）。 */
  maxLogRuns?: number;
  /** 优先拉日志的 job 名谓词（缺省 DEFAULT_LOG_JOB_RE）；命中为零 ⇒ 退回全部 job。 */
  logJobRe?: RegExp;
  /** runId → **已经知道的** testFiles（通常由载体现有记录喂入）⇒ 跳过重复拉日志（增量回填）。 */
  knownTestFiles?: Record<string, number | null>;
  /** 已经派生过 `prereqProvision` 的 runId（由载体现有记录喂入）⇒ 不重复拉日志。
   *  ⛔ 与 knownTestFiles **是两个不同的闸门**：那个由 testFiles 决定，这个由 prereqProvision 决定。
   *  只按前者放行，会让一条 testFiles 已派生过的 run **永远不再读日志** ⇒ 它的 prereqProvision
   *  结构性不可派生（这正是 AC-282 停在 `prereq-provision-not-recorded` 的成因之一）。 */
  knownPrereqRuns?: ReadonlySet<string>;
  /** 已经派生过 `schedulerMs` 的 runId（由载体现有记录喂入）⇒ 不重复拉日志。
   *  ⛔ **第三个**独立闸门，与 knownTestFiles / knownPrereqRuns 同款理由：三个量共用**同一次**下载
   *  （同一条 job 日志同时承载 `__GROUP__` / `__PREREQ__` / `__OVERHEAD__ scheduler_ms`）。只按前两者
   *  放行，会让一条两个旧量都已派生过的 run **永远不再读日志** ⇒ 它的 schedulerMs 结构性不可派生
   *  （AC-281 恒停 `scheduler-ms-not-recorded`）。 */
  knownSchedulerRuns?: ReadonlySet<string>;
  /** 已知**派生不出** testFiles 的 runId（负缓存）：跳过拉日志且**不重复告警**。
   *  ⛔ 与 knownTestFiles 是两个方向：那个说「已经知道值了」，这个说「试过，拿不到」。 */
  skipLogRuns?: ReadonlySet<string>;
  run?: GhRunner;
  /** 离线缝：直接用这份 run 数组，不调 gh（走的是同一个 buildRecord/collect 路径）。
   *  ⛔ **同时传 `run`** ⇒ 只有 run 列表来自离线缝、日志仍经注入的 runner 取（测试缝形态）；
   *  只传 `runs` 不传 `run` ⇒ 整条路径零 gh 调用（`--from-file` 的承诺）。 */
  runs?: GhRun[];
  /** 离线缝：runId → job 数组。 */
  jobsByRun?: Record<string, GhJob[]>;
  /** 离线缝：runId → testFiles。 */
  testFilesByRun?: Record<string, number>;
}

export interface CollectResult {
  records: RunRecord[];
  /** 采集过程中读不懂的东西（⛔ 不静默吞掉：非空时要让调用方看得见）。 */
  warnings: string[];
  /** 本次真的为多少条 run 下载了 job 日志（testFiles 派生的**成本直接量**，不是记录条数）。 */
  logRunsFetched: number;
}

/**
 * 为一条 run 里**未启动的失败 job** 取成因（见文件头 `notStartedCause` 段）。
 *
 * 三态返回（硬规则 3b）：
 *   · `undefined` —— 这条 run **没有**未启动的失败 job ⇒ 调用方**不写**该键（缺 ≠ `null`）；
 *   · 字符串 —— 取到逐字成因；
 *   · `null` —— 有未启动 job 而**成因没拿到**（离线缝没试 / 调用失败 / 响应里没有 failure 级 annotation）。
 *     ⛔ 它**不**影响 not-started signal 的产出：拿不到成因 ≠ 回落成 `job-timeout-reached`。
 *
 * 判据（哪些 job 算「未启动」）复用归因器那一份 `jobNeverStarted` —— ⛔ **不在这里重写一遍**：
 * 两处若各写一份，「哪些 job 要拉 annotation」与「哪些 job 报 not-started」会各自漂移。
 */
function deriveRunNotStartedCause(
  run: GhRunner,
  repo: string,
  jobs: GhJob[],
  offlineSeam: boolean,
  warnings: string[],
): string | null | undefined {
  const misses = jobs.filter(
    (j) => String(j.conclusion ?? "") === "failure" && jobNeverStarted({ runnerName: j.runner_name, steps: j.steps }),
  );
  if (misses.length === 0) return undefined;
  // 离线缝的承诺是「整条路径零 gh」⇒ ⛔ 不为成因破例（`--from-file` 那条路本就没有网络）。
  if (offlineSeam) return null;
  for (const j of misses) {
    if (typeof j.id !== "number" && typeof j.id !== "string") continue;
    try {
      const body = ghJson<unknown>(run, [
        "api",
        `/repos/${repo}/check-runs/${j.id}/annotations`,
      ]);
      const cause = deriveNotStartedCause(body);
      if (cause !== null) return cause;
    } catch (e) {
      // ⛔ 调用失败只留痕、只落 `null`（「试过但拿不到」是独立取值），绝不静默吞掉。
      warnings.push(`not-started-annotation-unreadable:${j.id}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return null;
}

/**
 * 采集：拉 run（或读离线缝）→ 拉 job 读数 → 派生 testFiles → 组装记录。**不落盘、不归因。**
 * 归因由 writeCarrier() 在落盘前统一施加。
 */
export function collect(opts: CollectOptions): CollectResult {
  const run = opts.run ?? defaultGhRunner;
  const warnings: string[] = [];
  const limit = opts.limit ?? 20;

  let runs: GhRun[] = [];
  if (opts.runs) {
    runs = opts.runs;
  } else {
    const q = new URLSearchParams({ per_page: String(Math.min(limit, 100)) });
    if (opts.branch) q.set("branch", opts.branch);
    const path = opts.workflow
      ? `/repos/${opts.repo}/actions/workflows/${encodeURIComponent(opts.workflow)}/runs`
      : `/repos/${opts.repo}/actions/runs`;
    const body = ghJson<{ workflow_runs?: GhRun[] }>(run, ["api", `${path}?${q.toString()}`]);
    runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  }
  runs = runs.slice(0, limit);

  // ⛔ 还在跑的 run 不落盘：它的 conclusion 此刻还不存在，记下来就是**冻结一个瞬态** ——
  // 那条记录会永久带着一个永远不会被修正的取值，且没有任何判据认它。跳过并留痕。
  if (runs.some((r) => typeof r.status === "string" && r.status !== "completed")) {
    const skipped = runs.filter((r) => typeof r.status === "string" && r.status !== "completed");
    for (const r of skipped) warnings.push(`run-not-completed:${String(r.id ?? "")}:${String(r.status)}`);
    runs = runs.filter((r) => !(typeof r.status === "string" && r.status !== "completed"));
  }

  const timeoutsCache = new Map<string, Record<string, number>>();
  const records: RunRecord[] = [];

  // 日志拉取模式：旧 `fetchLogs:true` ⇒ all（向后兼容）；缺省 decisive（只对判据能记分的 run）。
  const logMode: LogFetchMode = opts.fetchLogs ? "all" : (opts.logFetch ?? "decisive");
  const maxLogRuns = opts.maxLogRuns ?? DEFAULT_MAX_LOG_RUNS;
  const logJobRe = opts.logJobRe ?? DEFAULT_LOG_JOB_RE;
  // 离线缝的承诺是「整条路径零 gh」——由「喂了 runs 又没给 runner」表达（见 CollectOptions.runs）。
  // ⛔ 不能只判 `!opts.runs`：那样测试缝（runs + 注入 runner）就永远测不到日志派生，而日志派生
  // 恰恰是本任务要补的那件最要紧的事。
  const offlineSeam = opts.runs !== undefined && opts.run === undefined;
  let logRunsUsed = 0;
  const wantsLogs = (r: GhRun): boolean => {
    if (logMode === "none") return false;
    if (logMode === "all") return true;
    const c = String(r.conclusion ?? "");
    return c === "success" || c === "failure";
  };

  for (const r of runs) {
    const runId = String(r.id ?? "");
    let jobs: GhJob[] = [];
    if (opts.jobsByRun) {
      jobs = opts.jobsByRun[runId] ?? [];
    } else if (runId !== "") {
      try {
        const jb = ghJson<{ jobs?: GhJob[] }>(run, ["api", `/repos/${opts.repo}/actions/runs/${runId}/jobs`]);
        jobs = Array.isArray(jb.jobs) ? jb.jobs : [];
      } catch (e) {
        warnings.push(`jobs-unreadable:${runId}:${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // per-job timeout-minutes：优先用离线缝，其次按 head_sha 读该 run **自己那条** workflow 的 YAML。
    // ⛔ workflow 路径取自 run 自己的 `path`（gh 会给 `.github/workflows/ci.yml`），不是只在传了
    // `--workflow` 时才查 —— 否则默认那次（不传 --workflow，取全部 workflow 的 run）永远拿不到
    // timeoutMinutes，`infra:job-timeout-reached` 这条信号在默认调用下是**死的**。
    // 缓存键 = sha|workflow路径（不同 workflow 可以共用同一个 sha）。
    let timeouts: Record<string, number> = {};
    if (opts.runs) {
      timeouts = {};
    } else {
      const sha = String((r as Record<string, unknown>).head_sha ?? "");
      const wfPath = opts.workflow
        ? `.github/workflows/${opts.workflow}`
        : String((r as Record<string, unknown>).path ?? "");
      const cacheKey = `${sha}|${wfPath}`;
      if (sha !== "" && wfPath !== "" && wfPath.startsWith(".github/workflows/")) {
        if (!timeoutsCache.has(cacheKey)) {
          try {
            const body = ghJson<{ content?: string; encoding?: string }>(run, [
              "api",
              `/repos/${opts.repo}/contents/${wfPath}?ref=${sha}`,
            ]);
            const text =
              body.encoding === "base64" && typeof body.content === "string"
                ? Buffer.from(body.content, "base64").toString("utf8")
                : "";
            timeoutsCache.set(cacheKey, text === "" ? {} : parseJobTimeouts(text));
          } catch (e) {
            warnings.push(`workflow-unreadable:${wfPath}@${sha}:${e instanceof Error ? e.message : String(e)}`);
            timeoutsCache.set(cacheKey, {});
          }
        }
        timeouts = timeoutsCache.get(cacheKey) ?? {};
      }
    }

    let testFiles: number | null = opts.testFilesByRun?.[runId] ?? opts.knownTestFiles?.[runId] ?? null;
    const alreadyKnown = testFiles !== null;
    const knownUnderivable = opts.skipLogRuns?.has(runId) === true;
    const prereqKnown = opts.knownPrereqRuns?.has(runId) === true;
    const schedulerKnown = opts.knownSchedulerRuns?.has(runId) === true;
    // 闸门（tasks/gap-ac282-runner-prereqs-already-present §三.1）：**testFiles 未知（且未负缓存）
    // 或 prereqProvision 未派生** ⇒ 这一条 run 就要读日志。原来是 `!alreadyKnown && …` —— 只由
    // testFiles 决定 ⇒ 一条 testFiles 已派生过的 run 永远不再读日志，它的 prereqProvision 结构性
    // 不可派生。多个量共用**同一次**下载（同一条 job 日志同时承载 `__GROUP__` / `__PREREQ__` /
    // `__OVERHEAD__ scheduler_ms`）—— **每一个后派生字段各要一个闸门**，缺哪个哪个就结构性不可派生。
    const needsTestFiles = !alreadyKnown && !knownUnderivable;
    const needsPrereq = !prereqKnown;
    const needsSchedulerMs = !schedulerKnown;
    const prereqByJob = new Map<GhJob, Record<string, string>>();
    const schedulerByJob = new Map<GhJob, number>();
    if ((needsTestFiles || needsPrereq || needsSchedulerMs) && wantsLogs(r) && !offlineSeam && runId !== "") {
      if (logRunsUsed >= maxLogRuns) {
        // ⛔ 预算耗尽要留痕：静默少拉会让「没派生出来」与「派生不出」同形（硬规则 3b）。
        // 它现在同时覆盖 testFiles / prereqProvision / schedulerMs 三条派生路径。
        warnings.push(`log-budget-exhausted:${runId}:maxLogRuns=${maxLogRuns}`);
      } else {
        logRunsUsed += 1;
        // 只拉可能含 `__GROUP__` 的 job（跑测试那个）；命中为零 ⇒ 退回全部 job（fail-soft，
        // ⛔ 不是「没命中就判没有 testFiles」）。
        const preferred = jobs.filter((j) => logJobRe.test(String(j.name ?? "")));
        const targets = preferred.length > 0 ? preferred : jobs;
        if (preferred.length === 0 && jobs.length > 0) warnings.push(`log-job-filter-no-match:${runId}`);
        for (const j of targets) {
          if (typeof j.id !== "number" && typeof j.id !== "string") continue;
          try {
            // `--allow-escape-sequences` 不可省：gh 默认**拒绝**输出含 ANSI 转义色的 job 日志
            // （报 "the response contains terminal escape sequences; pass --allow-escape-sequences"），
            // 而测试日志恰恰是带色的 ⇒ 省掉它会让每一条 job 都取回 0 字节，testFiles 永远派生不出来。
            // 实测 2026-09-15：不加该旗标 `gh api .../jobs/<id>/logs` 返回 0 字节。
            const log = run(["api", "--allow-escape-sequences", `/repos/${opts.repo}/actions/jobs/${j.id}/logs`]);
            const n = deriveTestFilesFromLog(log);
            if (n !== null && (testFiles === null || n > testFiles)) testFiles = n;
            // 日志**拉到了** ⇒ 就该给这个 job 落一个 prereqProvision（一条 marker 都没有 ⇒ 三键全
            // `absent`，那是「没评估成」这个独立取值，⛔ 不是「没写」）。没拉到日志的 job 不落键。
            prereqByJob.set(j, derivePrereqProvision(log));
            // 同一次下载、第三个派生量：schedulerMs 只在跑测试那个 job 的日志里（marker 由
            // `suite-scheduler.ts` 在队列排空那一刻打一次）。派不出 ⇒ **不 set**（缺 ≠ 0）。
            const sched = deriveSchedulerMs(log);
            if (sched !== null) schedulerByJob.set(j, sched);
          } catch (e) {
            warnings.push(`job-log-unreadable:${j.id}:${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (testFiles === null) warnings.push(`testFiles-underivable:${runId}`);
      }
    }

    // 未启动 job 的成因（每个这样的 job 至多一次 API 调用；它们本来就罕见）。位置在 log 派生之后、
    // 组装之前：`runnerName`/`steps` 是 jobs API 直接给的，与日志拉取无关，两条路径互不依赖。
    const notStartedCause = deriveRunNotStartedCause(run, opts.repo, jobs, offlineSeam, warnings);
    records.push(buildRecord(r, { jobs, timeouts, testFiles, prereqByJob, schedulerByJob, notStartedCause }));
  }

  return { records, warnings, logRunsFetched: logRunsUsed };
}

/** 载体现有记录的 key 集（`workflow|runId`）——重复采集不重复落盘。 */
export function existingKeys(carrierPath: string): Set<string> {
  const keys = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(carrierPath, "utf8");
  } catch {
    return keys;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t) as RunRecord;
      keys.add(`${String(r.workflow ?? "")}|${String(r.runId ?? "")}`);
    } catch {
      // 读不懂的行不参与去重（⛔ 也不被删掉 —— 写面只追加，从不重写别人的行）
    }
  }
  return keys;
}

/**
 * 载体现有记录的 `runId → testFiles`（只收**整数**）。喂给 `collect(knownTestFiles:)` ⇒ 增量回填：
 * 已经派生过 testFiles 的 run 不再重复下载日志（⛔ 缺值不参与，否则「缺失」会被当成「已知」，
 * 从此永不补拉 —— 硬规则 6：缺 ≠ 0）。
 */
export function knownTestFilesFromCarrier(carrierPath: string): Record<string, number> {
  const out: Record<string, number> = {};
  let text: string;
  try {
    text = fs.readFileSync(carrierPath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t) as RunRecord;
      const id = r.runId === undefined || r.runId === null ? "" : String(r.runId);
      if (id !== "" && typeof r.testFiles === "number" && Number.isInteger(r.testFiles)) out[id] = r.testFiles;
    } catch {
      // 读不懂的行跳过（写面只追加，⛔ 从不重写别人的行）
    }
  }
  return out;
}

/**
 * 载体现有记录里**已经派生过 `prereqProvision`** 的 runId（任一条 job 读数带该键即算）。
 * 喂给 `collect(knownPrereqRuns:)` ⇒ 已派生过的 run 不重复下载日志。
 * ⛔ 缺 ≠ 0（硬规则 6）：没有该键的 run 不参与，否则「缺失」会被当成「已知」，从此永不补拉。
 */
export function knownPrereqRunsFromCarrier(carrierPath: string): Set<string> {
  const out = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(carrierPath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t) as RunRecord;
      const id = r.runId === undefined || r.runId === null ? "" : String(r.runId);
      if (id === "") continue;
      const jobs = Array.isArray(r.jobs) ? r.jobs : [];
      if (jobs.some((j) => hasPrereqProvision(j))) out.add(id);
    } catch {
      // 读不懂的行跳过（写面只追加，⛔ 从不重写别人的行）
    }
  }
  return out;
}

/**
 * 载体现有记录里**已经派生过 `schedulerMs`** 的 runId（任一条 job 读数带该键即算）。
 * 喂给 `collect(knownSchedulerRuns:)` ⇒ 已派生过的 run 不重复下载日志。
 * ⛔ 缺 ≠ 0（硬规则 6）：没有该键的 run 不参与，否则「缺失」会被当成「已知」，从此永不补拉
 * —— 而 AC-281 读的正是**最新**那条记录，它可能恰好在飞窗口里。
 */
export function knownSchedulerRunsFromCarrier(carrierPath: string): Set<string> {
  const out = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(carrierPath, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const r = JSON.parse(t) as RunRecord;
      const id = r.runId === undefined || r.runId === null ? "" : String(r.runId);
      if (id === "") continue;
      const jobs = Array.isArray(r.jobs) ? r.jobs : [];
      if (jobs.some((j) => hasSchedulerMs(j))) out.add(id);
    } catch {
      // 读不懂的行跳过（写面只追加，⛔ 从不重写别人的行）
    }
  }
  return out;
}

export interface WriteResult {
  appended: number;
  skipped: number;
  attributed: number;
  /** 就地补全 `testFiles` 的条数（只填**缺失**的派生字段；⛔ 不改其它任何字段）。 */
  enriched: number;
  /** 就地补全 `prereqProvision` 的条数（同一条边界：只填缺失的那个键）。 */
  enrichedPrereq: number;
  /** 就地补全 `schedulerMs` 的条数（同一条边界：只填缺失的那个键）。 */
  enrichedScheduler: number;
}

/** 一条既有记录的 job 列表里，哪些 job 需要被 `incoming` 补上 `prereqProvision`（其余字段逐字保留）。 */
function prereqPatch(existingJobs: unknown, incomingJobs: unknown): RunRecord["jobs"] | null {
  if (!Array.isArray(existingJobs) || !Array.isArray(incomingJobs)) return null;
  const byName = new Map<string, Record<string, unknown>>();
  for (const j of incomingJobs) {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    if (rec && hasPrereqProvision(rec)) byName.set(String(rec.name ?? ""), rec);
  }
  let changed = false;
  const out = existingJobs.map((j) => {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    if (!rec || hasPrereqProvision(rec)) return j;
    const src = byName.get(String(rec.name ?? ""));
    if (!src) return j;
    changed = true;
    return { ...rec, prereqProvision: src.prereqProvision };
  });
  return changed ? (out as RunRecord["jobs"]) : null;
}

/** 既有记录的 job 列表里，哪些 job 需要被 `incoming` 补上 `schedulerMs`（其余字段逐字保留）。 */
function schedulerPatch(existingJobs: unknown, incomingJobs: unknown): RunRecord["jobs"] | null {
  if (!Array.isArray(existingJobs) || !Array.isArray(incomingJobs)) return null;
  const byName = new Map<string, Record<string, unknown>>();
  for (const j of incomingJobs) {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    if (rec && hasSchedulerMs(rec)) byName.set(String(rec.name ?? ""), rec);
  }
  let changed = false;
  const out = existingJobs.map((j) => {
    const rec = j !== null && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    if (!rec || hasSchedulerMs(rec)) return j;
    const src = byName.get(String(rec.name ?? ""));
    if (!src) return j;
    changed = true;
    return { ...rec, schedulerMs: src.schedulerMs };
  });
  return changed ? (out as RunRecord["jobs"]) : null;
}

/** `enrichable` 的读数：要合并进去的键 + **哪几个 job 级补全真的动了**（各自的计数分开报）。 */
interface Enrichment {
  patch: Record<string, unknown>;
  /** 本次补上了 `prereqProvision`。 */
  prereqPatched: boolean;
  /** 本次补上了 `schedulerMs`。 */
  schedulerPatched: boolean;
}

/**
 * 一条既有记录能否被 `incoming` **补全**。返回要合并进去的键（没有可补的 ⇒ null）。
 *
 * 边界与 `testFiles` 那一条**逐字同款**（刻意收窄到不可能改语义）：只补**既有行缺、新记录有**的
 * 派生字段，既有行其余字段逐字保留。
 *
 * 为什么 `prereqProvision` / `schedulerMs` 也要纳入（tasks/gap-ac282-runner-prereqs-already-present
 * §三.2；tasks/gap-ac281-scheduler-ms-carrier-field）：去重键是 `workflow|runId`，而这两个键都是
 * **后派生**的（要下载 job 日志）。一条在派生落地**之前**已落盘的记录走纯追加路径**永远补不上**
 * ⇒ 在飞窗口里那条会永久缺这个读数，而判据读「最新一条」，正好可能读到它。
 *
 * 两个 job 级补全**串联**（不是一个盖掉另一个）：它们写在同一个 `jobs` 数组的**不同键**上，串联后
 * 两条都能落到同一次落盘里；各自动没动分别用独立读数报（⛔ 不合并成一个 `jobs` 布尔，那样「补了
 * 哪个」就不可区分了 —— 硬规则 3b）。
 *
 * ⛔ `runnerName` / `notStartedCause` **刻意不在这里**（tasks/gap-ci-collector-job-not-started-misattributed-as-timeout
 * 的「回填」条款）：那两个是**新判据的输入**，对落地**之前**采集的历史记录重算它们，等于用今天的
 * 采集能力改写昨天的观测 —— 历史载体不重算，新行为只对落地后采集的记录生效。
 */
function enrichable(existing: RunRecord, incoming: RunRecord): Enrichment | null {
  const patch: Record<string, unknown> = {};
  if (!(typeof existing.testFiles === "number" && Number.isInteger(existing.testFiles))) {
    if (typeof incoming.testFiles === "number" && Number.isInteger(incoming.testFiles)) {
      patch.testFiles = incoming.testFiles;
    }
  }
  const prereqJobs = prereqPatch(existing.jobs, incoming.jobs);
  const prereqPatched = prereqJobs !== null;
  const baseJobs = prereqJobs ?? existing.jobs;
  const schedJobs = schedulerPatch(baseJobs, incoming.jobs);
  const schedulerPatched = schedJobs !== null;
  const jobs = schedJobs ?? prereqJobs;
  if (jobs !== null) patch.jobs = jobs;
  if (Object.keys(patch).length === 0) return null;
  return { patch, prereqPatched, schedulerPatched };
}

/**
 * **落盘**：归因（只对 failure）→ 去重追加 → **就地补全缺失的 testFiles**。
 *
 * ⛔ 为什么需要就地补全（2026-09-15 实测的**结构性**缺口）：去重键是 `workflow|runId`，而 testFiles
 * 是**后派生**的（要下载 job 日志）。所以「先落盘、后来才派生出来」的那批记录，走纯追加路径**永远
 * 补不上**——重采时它们被去重跳过，载体里那批记录就永久缺 testFiles，而 AC-265 的反作弊关系
 * （green 的 testFiles ≥ 紧邻前一次的 testFiles）**两边都要求整数** ⇒ 判据恒报
 * `*-missing-testFiles`。实测：30 条 run 里 5 条已派生成功，10 条新追加、20 条被跳过，**载体里
 * testFiles 计数 = 0**。
 *
 * 补全的**边界**（刻意收窄到不可能改语义）：
 *   • 只写 `testFiles` 这一个键，且只在既有行**没有**该键、新记录**有**时；
 *   • 既有行其余字段逐字保留（attribution / signals / jobs / failedTests 都不重算）；
 *   • 只对**已经存在**的 key 生效，⛔ 不新增行（新增仍走追加）。
 * 写面唯一性：本文件是载体的唯一写者（头注释），故 read-modify-write 不会与第二个写者冲突；
 * 落盘用 temp+rename（同一目录内原子替换，⛔ 不让读到半截文件）。
 */
export function writeCarrier(
  carrierPath: string,
  records: RunRecord[],
  knownFlakes: KnownFlakeRegistry | null,
): WriteResult {
  const seen = existingKeys(carrierPath);
  const out: string[] = [];
  let skipped = 0;
  let attributed = 0;
  const byKey = new Map<string, RunRecord>();
  for (const rec of records) byKey.set(`${String(rec.workflow ?? "")}|${String(rec.runId ?? "")}`, rec);

  for (const rec of records) {
    const key = `${String(rec.workflow ?? "")}|${String(rec.runId ?? "")}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    const final = withAttribution(rec, knownFlakes);
    if (typeof final.attribution === "string") attributed += 1;
    out.push(JSON.stringify(final));
  }
  if (out.length > 0) {
    fs.mkdirSync(path.dirname(carrierPath), { recursive: true });
    fs.appendFileSync(carrierPath, out.join("\n") + "\n");
  }

  // 就地补全（见上）；任何 IO 失败都只是「这轮没补上」，⛔ 不影响已经追加的行。
  let enriched = 0;
  let enrichedPrereq = 0;
  let enrichedScheduler = 0;
  let existingText: string | null = null;
  try {
    existingText = fs.readFileSync(carrierPath, "utf8");
  } catch {
    existingText = null;
  }
  if (existingText !== null) {
    const lines = existingText.split("\n");
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === "") continue;
      let rec: RunRecord;
      try {
        rec = JSON.parse(t) as RunRecord;
      } catch {
        continue; // 读不懂的行原样保留
      }
      const key = `${String(rec.workflow ?? "")}|${String(rec.runId ?? "")}`;
      const incoming = byKey.get(key);
      if (!incoming) continue;
      const enr = enrichable(rec, incoming);
      if (enr === null) continue;
      if ("testFiles" in enr.patch) enriched += 1;
      if (enr.prereqPatched) enrichedPrereq += 1;
      if (enr.schedulerPatched) enrichedScheduler += 1;
      lines[i] = JSON.stringify({ ...rec, ...enr.patch });
      changed = true;
    }
    if (changed) {
      const tmp = `${carrierPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, lines.join("\n"));
      fs.renameSync(tmp, carrierPath);
    }
  }
  return { appended: out.length, skipped, attributed, enriched, enrichedPrereq, enrichedScheduler };
}

// ── 生产接线面（goal-driver 每轮调用）────────────────────────────────────────────────────────

/** 采集节流状态文件（gitignored 运行时态，同 `.quay/*.jsonl` 族）。 */
export const COLLECT_STATE_REL = path.join(".quay", "ci-runs-collect-state.json");

/** 每轮采集的节流间隔（毫秒）。缺省 10 分钟：gh 是**外部配额资源**，每轮（goal 轮间隔 30s）打它
 *  等于每分钟 2 次 API 调用 —— 硬规则 4 推论二同族（别把一个恰好合适的频率写成常量），故可覆盖。 */
export const DEFAULT_COLLECT_THROTTLE_MS = 600_000;

/**
 * 一轮采集的读数。**四态可区分**（硬规则 3b）：`status` ∈ ok / throttled / gh-unavailable / error /
 * disabled —— 「没采集」永不与「采集了零条」同形。`status === "ok"` 时 appended/skipped 才是「真跑了」
 * 的读数；其余三态它们是 0 **且** `reason` 带成因。
 */
export interface CiRunsRoundReading {
  status: "ok" | "throttled" | "gh-unavailable" | "error" | "disabled";
  ran: boolean;
  reason: string;
  carrier: string;
  appended: number;
  skipped: number;
  attributed: number;
  /** 本次就地补全 testFiles 的条数。 */
  enriched: number;
  /** 本次就地补全 prereqProvision 的条数。 */
  enrichedPrereq: number;
  /** 本次就地补全 schedulerMs 的条数。 */
  enrichedScheduler: number;
  /** 本次真的下载了多少条 run 的 job 日志（testFiles/prereqProvision/schedulerMs 派生的成本直接量）。 */
  logsFetched: number;
  /** 本次从日志里派生出的 testFiles 条数（⛔ 不是「写了多少条记录」）。 */
  testFilesDerived: number;
  /** 本次从日志里派生出的 prereqProvision 条数（载体里带该键的记录数）。 */
  prereqProvisionDerived: number;
  /** 本次从日志里派生出的 schedulerMs 条数（载体里带该键的记录数）。 */
  schedulerMsDerived: number;
  /** 采集过程中读不懂的东西（⛔ 不静默吞）。 */
  warnings: string[];
}

export interface CollectForRoundOptions {
  /** GitHub `owner/name`；缺省从 root 的 origin remote 推（推不出 ⇒ status:"error"）。 */
  repo?: string | null;
  branch?: string;
  workflow?: string;
  limit?: number;
  /** 节流间隔（毫秒）；0 ⇒ 不节流（每次调用都采集）。 */
  throttleMs?: number;
  /** 状态文件路径；缺省 `<root>/.quay/ci-runs-collect-state.json`。 */
  statePath?: string;
  /** 载体路径；缺省 `<root>/.quay/ci-runs.jsonl`。 */
  carrier?: string;
  maxLogRuns?: number;
  /** 注入的 gh runner（测试缝）。缺省 = defaultGhRunner（调用时解析 gh 二进制）。 */
  run?: GhRunner;
  /** 注入的「现在」（测试缝；缺省 Date.now()）。 */
  now?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * 注入的「该路径是可执行的 gh」判定（测试缝；缺省 = 真实文件系统探测，见 `resolveGhBin`）。
   *
   * 为什么需要它（tasks/gap-ci-runs-collect-gh-fallback-defeats-unavailable-test）：`resolveGhBin` 在
   * env / PATH / `~/.local/bin` 之后还有**四个硬编码绝对路径**（`/usr/local/bin/gh`、`/opt/homebrew/bin/gh`、
   * `/usr/bin/gh`、`/bin/gh`），那一段**故意不受 `env.PATH`/`env.HOME` 影响**（常驻 driver 的 PATH 不保证
   * 含 `~/.local/bin`）。副作用是：靠「把 env 覆写成 `PATH=/nonexistent`」来模拟「gh 不可达」的测试，
   * 在**真装了系统级 gh 的机器**（GitHub Actions 的 ubuntu 镜像预装 gh）上完全不生效 —— 实测 2026-09-16
   * CI run 35054411272：该测试红在与被测逻辑无关的**宿主环境差异**上（解析到了真实的 gh，于是落到
   * `defaultGhRunner`，API 调用失败 ⇒ `status:'error'` ≠ `'gh-unavailable'`）。
   * ⇒ 把判定穿透出来，让「gh 不可达」不再依赖真实文件系统当前状态。
   */
  ghIsExec?: (p: string) => boolean;
}

interface CollectState {
  lastRunAt?: number;
  /** testFiles 负缓存：runId → 首次确认「派生不出」的时刻。⛔ 它只抑制**重复尝试**，
   *  绝不参与「有没有 testFiles」的判定（那是载体自己的字段）。 */
  underivable?: Record<string, string>;
}

function readState(statePath: string): CollectState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as CollectState;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(statePath: string, state: CollectState): void {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state) + "\n");
    fs.renameSync(tmp, statePath);
  } catch {
    // 状态写不进去 ⇒ 下一轮会重采一次（fail-open 方向安全：多采 > 停采），⛔ 不因此判失败
  }
}

/**
 * **生产调用点**：goal-driver 每轮调它一次。节流 → 采集（增量回填 testFiles）→ 落盘 → 写状态。
 * ⛔ **永不抛**：任何失败都折算成一条可区分的读数（硬规则 3b —— 抛出去会让调用方要么吞掉、
 * 要么把整轮判失败，两者都把「采集坏掉」伪装成别的东西）。
 */
export function collectForRound(root: string, opts: CollectForRoundOptions = {}): CiRunsRoundReading {
  const carrier = opts.carrier ?? path.join(root, CARRIER_REL);
  const statePath = opts.statePath ?? path.join(root, COLLECT_STATE_REL);
  const base: CiRunsRoundReading = {
    status: "error",
    ran: false,
    reason: "",
    carrier,
    appended: 0,
    skipped: 0,
    attributed: 0,
    enriched: 0,
    enrichedPrereq: 0,
    enrichedScheduler: 0,
    logsFetched: 0,
    testFilesDerived: 0,
    prereqProvisionDerived: 0,
    schedulerMsDerived: 0,
    warnings: [],
  };

  const now = opts.now ?? Date.now();
  const state = readState(statePath);
  const throttleMs = opts.throttleMs ?? DEFAULT_COLLECT_THROTTLE_MS;
  if (throttleMs > 0) {
    const last = state.lastRunAt;
    if (typeof last === "number" && now - last < throttleMs) {
      return {
        ...base,
        status: "throttled",
        reason: `距上次采集 ${Math.round((now - last) / 1000)}s < 节流 ${Math.round(throttleMs / 1000)}s`,
      };
    }
  }

  const repo = opts.repo !== undefined ? opts.repo : repoFromRemote(root);
  if (repo === null || repo === undefined || repo === "") {
    return { ...base, status: "error", reason: `从 ${root} 的 origin remote 推不出 owner/name` };
  }

  // 第二个参数只在测试缝注入时才非 undefined —— 缺省实参（真实文件系统探测）照旧生效。
  const ghRes = resolveGhBin(opts.env ?? process.env, opts.ghIsExec);
  if (ghRes.bin === null && opts.run === undefined) {
    return {
      ...base,
      status: "gh-unavailable",
      reason: `解析不出 gh 可执行文件（来源 ${ghRes.source}）—— ⛔ 这不是「没有 run」`,
      warnings: [`gh-candidates:${ghRes.candidates.join(",") || "(空)"}`],
    };
  }

  const warnings: string[] = [];
  let result: CollectResult;
  try {
    result = collect({
      repo,
      ...(opts.workflow ? { workflow: opts.workflow } : {}),
      limit: opts.limit ?? 20,
      ...(opts.branch ? { branch: opts.branch } : {}),
      logFetch: "decisive",
      maxLogRuns: opts.maxLogRuns ?? DEFAULT_MAX_LOG_RUNS,
      knownTestFiles: knownTestFilesFromCarrier(carrier),
      knownPrereqRuns: knownPrereqRunsFromCarrier(carrier),
      knownSchedulerRuns: knownSchedulerRunsFromCarrier(carrier),
      skipLogRuns: new Set(Object.keys(state.underivable ?? {})),
      ...(opts.run ? { run: opts.run } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = e instanceof GhUnavailableError ? "gh-unavailable" : "error";
    return { ...base, status: kind, reason: `采集失败: ${msg}`, warnings };
  }
  warnings.push(...result.warnings);

  let res: WriteResult = {
    appended: 0,
    skipped: 0,
    attributed: 0,
    enriched: 0,
    enrichedPrereq: 0,
    enrichedScheduler: 0,
  };
  try {
    const knownFlakes = loadKnownFlakes(defaultKnownFlakesPath());
    if (knownFlakes === null) warnings.push("known-flakes-unreadable:本次判不出 known-flake");
    res = writeCarrier(carrier, result.records, knownFlakes);
  } catch (e) {
    return {
      ...base,
      status: "error",
      reason: `写载体失败: ${e instanceof Error ? e.message : String(e)}`,
      warnings,
    };
  }

  // testFiles 负缓存：把本轮新确认「派生不出」的 runId 记下，下一轮不再重复下载它们的日志。
  const underivable: Record<string, string> = { ...(state.underivable ?? {}) };
  for (const w of result.warnings) {
    const m = /^testFiles-underivable:(.+)$/.exec(w);
    if (m && !(m[1] in underivable)) underivable[m[1]] = new Date(now).toISOString();
  }
  writeState(statePath, { lastRunAt: now, underivable });

  return {
    status: "ok",
    ran: true,
    reason:
      `采集 ${result.records.length} 条，追加 ${res.appended} 条，` +
      `补全 testFiles ${res.enriched} 条 / prereqProvision ${res.enrichedPrereq} 条 / ` +
      `schedulerMs ${res.enrichedScheduler} 条`,
    carrier,
    appended: res.appended,
    skipped: res.skipped,
    attributed: res.attributed,
    enriched: res.enriched,
    enrichedPrereq: res.enrichedPrereq,
    enrichedScheduler: res.enrichedScheduler,
    logsFetched: result.logRunsFetched,
    testFilesDerived: result.records.filter((r) => typeof r.testFiles === "number").length,
    prereqProvisionDerived: result.records.filter((r) => (r.jobs ?? []).some((j) => hasPrereqProvision(j))).length,
    schedulerMsDerived: result.records.filter((r) => (r.jobs ?? []).some((j) => hasSchedulerMs(j))).length,
    warnings,
  };
}

/** 从 origin remote 推 `owner/name`（推不出 ⇒ null，⛔ 不猜）。 */
export function repoFromRemote(cwd: string): string | null {
  try {
    const url = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "ci-runs-collect.ts — 把 GitHub Actions run 结论写进 .quay/ci-runs.jsonl（failure 带 attribution）",
    "",
    "用法:",
    "  --root <dir>          仓库/工作区根（默认 repoRoot()）",
    "  --carrier <path>      载体路径（默认 <root>/.quay/ci-runs.jsonl）",
    "  --repo <owner/name>   GitHub 仓库（默认从 origin remote 推）",
    "  --workflow <file>     workflow 文件名（如 ci.yml）",
    "  --branch <name>       只取该分支",
    "  --limit <n>           取多少条 run（默认 20）",
    "  --fetch-logs          等价于 --log-fetch=all（对每条 run 都拉日志；慢）",
    "  --log-fetch <mode>    none | decisive（默认）| all —— decisive 只对 conclusion ∈ success|failure",
    "                        的 run 拉日志（判据能记分的那些；cancelled 约占 develop run 的 43%）",
    "  --max-log-runs <n>    单次调用为一个 run 拉日志的上界（默认 25；超出留 log-budget-exhausted 警告）",
    "  --gh <path>           gh 可执行文件路径（等价于 env QUAY_GH_BIN；缺省 PATH + 常见安装位）",
    "  --from-file <path>    离线缝：读一份 gh 形状的 run 数组，不调 gh（同一条写路径）",
    "  --print               打印本次写出的记录",
    "  --dry-run             只算不写",
    "  --help",
  ].join("\n");
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  /** Arity-1 adapter over the shared `flagValue`: this closure captures the local `argv`. The
   *  `?? null` preserves THIS call site's original `null`-when-absent reading. */
  const flag = (n: string): string | null => flagValue(argv, n) ?? null;

  const root = flag("--root") ?? repoRoot();
  const carrier = flag("--carrier") ?? path.join(root, CARRIER_REL);
  const workflow = flag("--workflow");
  const branch = flag("--branch") ?? undefined;
  const limit = Number(flag("--limit") ?? "20");
  const fromFile = flag("--from-file");
  const dryRun = argv.includes("--dry-run");

  let repo = flag("--repo");
  if (repo === null) {
    repo = repoFromRemote(root);
    if (repo === null) {
      console.error("无法从 origin remote 推出 owner/name —— 显式传 --repo");
      return 1;
    }
  }

  let runs: GhRun[] | undefined;
  if (fromFile !== null) {
    try {
      const parsed = JSON.parse(fs.readFileSync(fromFile, "utf8"));
      if (!Array.isArray(parsed)) {
        console.error(`读不懂 ${fromFile}: 顶层不是数组`);
        return 1;
      }
      runs = parsed as GhRun[];
    } catch (e) {
      console.error(`读不懂 ${fromFile}: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  const knownFlakes = loadKnownFlakes(defaultKnownFlakesPath());
  if (knownFlakes === null) {
    // ⛔ 读不懂登记表 ≠ 表是空的（硬规则 3b）：报出来，但继续 —— 归因会因此判不出 known-flake，
    // 只会往 real-defect 兜底，方向安全。
    console.error(`⚠ 已知 flake 登记表读不到或格式非法：${defaultKnownFlakesPath()} ⇒ 本次判不出 known-flake`);
  }

  const logFetchArg = (flag("--log-fetch") ?? (argv.includes("--fetch-logs") ? "all" : "decisive")) as LogFetchMode;
  if (!["none", "decisive", "all"].includes(logFetchArg)) {
    console.error(`--log-fetch 取值非法: ${logFetchArg}（取 none | decisive | all）`);
    return 2;
  }
  const maxLogRuns = Number(flag("--max-log-runs") ?? String(DEFAULT_MAX_LOG_RUNS));
  const ghPath = flag("--gh");
  if (ghPath !== null) process.env.QUAY_GH_BIN = ghPath;

  let result: CollectResult;
  try {
    result = collect({
      repo,
      ...(workflow ? { workflow } : {}),
      limit,
      ...(branch ? { branch } : {}),
      logFetch: logFetchArg,
      maxLogRuns,
      // 增量回填：载体现有 testFiles / prereqProvision / schedulerMs 喂进来 ⇒ 已派生过的 run 不重复
      // 下载日志。⛔ 三个闸门都要接上：漏掉哪个，那个字段对「已派生过前两个量的 run」就结构性不可派生。
      knownTestFiles: knownTestFilesFromCarrier(carrier),
      knownPrereqRuns: knownPrereqRunsFromCarrier(carrier),
      knownSchedulerRuns: knownSchedulerRunsFromCarrier(carrier),
      ...(runs ? { runs } : {}),
    });
  } catch (e) {
    console.error(`采集失败: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  for (const w of result.warnings) console.error(`⚠ ${w}`);

  if (dryRun) {
    for (const r of result.records) console.log(JSON.stringify(withAttribution(r, knownFlakes)));
  } else {
    const res = writeCarrier(carrier, result.records, knownFlakes);
    console.log(
      `carrier=${carrier} appended=${res.appended} skipped=${res.skipped} attributed=${res.attributed} ` +
        `enriched=${res.enriched} enrichedPrereq=${res.enrichedPrereq} enrichedScheduler=${res.enrichedScheduler} ` +
        `logRunsFetched=${result.logRunsFetched} ` +
        `testFilesDerived=${result.records.filter((r) => typeof r.testFiles === "number").length} ` +
        `prereqProvisionDerived=${result.records.filter((r) => (r.jobs ?? []).some((j) => hasPrereqProvision(j))).length} ` +
        `schedulerMsDerived=${result.records.filter((r) => (r.jobs ?? []).some((j) => hasSchedulerMs(j))).length}`,
    );
    if (argv.includes("--print")) {
      for (const r of result.records) console.log(JSON.stringify(withAttribution(r, knownFlakes)));
    }
  }
  return 0;
}

if (process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "ci-runs-collect") {
  process.exit(main(process.argv.slice(2)));
}
