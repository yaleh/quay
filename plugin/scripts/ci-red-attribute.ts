#!/usr/bin/env node
// ci-red-attribute.ts — GOAL-020 / AC-269 (tasks/gap-ci-red-attribution-classifier).
//
// The question this makes askable: **一条 CI 红是哪一类** —— 真缺陷 / 被测对象之外的基础设施问题
// / 已知负载 flake？在它之前，回答这个问题要人肉读 15684 行日志并跨 4 次 run 比对失败集合
// （AC-269 origin 逐字）。本模块给出**机械归因**：入参是一条载体记录（可选带该 run 的 job 级读数），
// 出参 `{attribution, signals}`，`attribution` 取三元词表之一。
//
// ── 判定只取客观字段（⛔ 不做日志文本关键词匹配）──────────────────────────────────────────
// 全部信号来自记录的结构化字段：`timedOut` / `durationSec` / `jobs[].durationSec` /
// `jobs[].timeoutMinutes` / `jobs[].conclusion` / `jobs[].steps[]` / `testFiles` / `failedTests`。
// 本模块**从不**读日志正文 —— 关键词匹配会把「日志里提到了 timeout」当成 timeout。
//
// ── 判定次序（外部原因 → 已知 flake → 兜底）──────────────────────────────────────────────
//   1. `infrastructure` —— 红发生在被测对象**之外**（超时 / 被取消 / 测试步从未开始）。
//   2. `known-flake`   —— 失败测试标识命中 `plugin/scripts/known-flakes.json` 登记表。
//   3. `real-defect`   —— **兜底默认**。
// 兜底方向取「当作真缺陷」的理由是**代价不对称**：把真缺陷误记为 infra/flake 会**豁免一条红**，
// 把 infra/flake 误记为真缺陷只是多一次人看。方向不可逆的一侧永远不取。
//
// ── 可区分性（硬规则 3b）────────────────────────────────────────────────────────────────
// 同一个取值 `real-defect` 有两件**不同**的事在背后：
//   · `defect:tests-ran-and-failed` —— 读懂了记录，测试确实跑了并失败了；
//   · `default:no-signal-matched`   —— 一条信号都没命中，**兜底**判定。
// 若二者共用同一个 signals 形状，「读不懂」就会与「读懂了且判为真缺陷」同形。故兜底时写入
// 显式标记 `default:no-signal-matched`。
// 同理，`attribution` 可以是 `null`：记录**不是** failure（本函数不适用），这不是一个归因取值，
// 也绝不能被读成「判为 real-defect」。
//
// ── CLI ────────────────────────────────────────────────────────────────────────────────
//   node --experimental-strip-types plugin/scripts/ci-red-attribute.ts --record-file <j>
//   node --experimental-strip-types plugin/scripts/ci-red-attribute.ts --carrier <carrier.jsonl>
//   node --experimental-strip-types plugin/scripts/ci-red-attribute.ts --list-flakes
// 退出码：0 = 归因完成（可读）；1 = 输入读不懂（缺文件 / 非法 JSON / 非法 --record json）；
//         2 = 用法错误。⛔ 「读不懂」的退出码与「判出 real-defect」不同（硬规则 3b）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// flag (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one of
// the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { flagValue } from "./gate-script-base.ts";

/** 三元词表 —— `attribution` 只能取其中之一（AC-269 判据逐字读这三个值）。 */
export const ATTRIBUTION_VOCAB = ["real-defect", "infrastructure", "known-flake"] as const;
export type Attribution = (typeof ATTRIBUTION_VOCAB)[number];

/** 兜底标记（硬规则 3b：兜底的 real-defect 必须与「命中信号判出的 real-defect」可分辨）。 */
export const DEFAULT_NO_SIGNAL = "default:no-signal-matched";
/** 命中信号判出的 real-defect 的标记（与上面成对）。 */
export const DEFECT_TESTS_RAN = "defect:tests-ran-and-failed";

export interface JobStepReading {
  name?: string;
  conclusion?: string;
  number?: number;
}
export interface JobReading {
  name?: string;
  conclusion?: string;
  durationSec?: number;
  /** 该 job 的 `timeout-minutes`（workflow 声明值；GitHub 默认 360）。 */
  timeoutMinutes?: number;
  /**
   * 套件运行前置在**该 job 自己的日志**里的状态（AC-282 载体臂读的字段，判据读 `jobs[]` 里
   * `name == "test"` 那条）：`{pyyaml, tmux, procps}`，值域
   * `already-present | installed-apt | installed-pip | absent`（见 ci-runs-collect.ts 的
   * `derivePrereqProvision`）。⛔ **派生不出（没拉日志）就不写这个键** —— 缺 ≠ `absent`
   * （硬规则 6），照 `durationSec` / `timeoutMinutes` 的先例。
   */
  prereqProvision?: Record<string, string>;
  /**
   * 该 job 日志里**套件自身调度器**的墙钟（毫秒）—— AC-281 判据读的字段，判据读 `jobs[]` 里
   * `name == "test"` 那条：`__OVERHEAD__ scheduler_ms=<n>`（`suite-scheduler.ts` 在队列排空那一刻
   * 打一次，见 ci-runs-collect.ts 的 `deriveSchedulerMs`）。
   *
   * 为什么量的是它而不是 `durationSec`：`durationSec` 是 GitHub 给的 job 总墙钟，含 checkout /
   * npm install / coverage self-check / runner 收尾等**固定开销**（实测 ≥27s），2026-09-17 人裁定
   * 改为只量套件自身的调度器时长。
   * ⛔ **只在跑测试的那个 job 的读数里出现**（marker 只在那份日志里）；**派生不出（没拉日志 / 日志里
   * 没有这一行）就不写这个键** —— 缺 ≠ `0`（硬规则 6），照 `durationSec` / `timeoutMinutes` /
   * `prereqProvision` 的先例。一个恒为 0 的字段会让 AC-281 的判据变成恒真的回声（硬规则 4）。
   */
  schedulerMs?: number;
  /**
   * 该 job 拿到的 **runner 名**（jobs API 的 `runner_name`）——「这个 job 到底起跑没有」的**直接量**。
   *
   * ⛔ **只有 API 给了字符串才写这个键**：`runner_name: null` / 缺键 ⇒ 采集器**不写**（缺 ≠ 空串，
   * 硬规则 6）。GitHub 在「这个 job 从未拿到 runner」时给的正是**空串**（实测 2026-09-24 run
   * 35966264609 的 `version-consistency`：`runner_name=""`、`steps=[]`、`started_at == created_at`）
   * ⇒ 空串是一个**可区分**的观测，不是「没有值」。
   * 没有它，`jobNeverStarted` 判不出（`undefined` 被刻意排除），那条 job 的 132s 排队时长会被读成
   * 「执行了 132s」而进 `job-timeout-reached` 分支 —— 那正是本字段存在的理由。
   */
  runnerName?: string;
  steps?: JobStepReading[];
}

/** 载体记录（`.quay/ci-runs.jsonl` 的一行）。字段口径与 AC-265/266/267/268 判据读到的集合一致。 */
export interface RunRecord {
  /** run **自己的**时刻（⛔ 不是采集时刻 —— AC-265 判据的窗口比较就建立在这条上）。 */
  ts?: string;
  branch?: string;
  workflow?: string;
  conclusion?: string;
  runId?: string | number;
  /** 该 run 实际跑到的测试文件数（可缺 —— 缺 ≠ 0，硬规则 6）。 */
  testFiles?: number;
  /** run 级超时的**直接观测**（GitHub 自己说 timed_out 时才置真；推断路径见 job-timeout-reached）。 */
  timedOut?: boolean;
  durationSec?: number;
  /** 失败测试标识 `文件::测试名`（由日志/报告派生；没有就是没有）。 */
  failedTests?: string[];
  /**
   * **未启动 job 的成因** —— check-runs annotation 里 `annotation_level=failure` 的 message **逐字**
   * （截断长度是 `ci-runs-collect.ts` 的 `NOT_STARTED_CAUSE_MAX_CHARS`，唯一一处常量）。
   *
   * **三态可区分**（硬规则 3b）：
   *   · 字符串 —— 取到了，逐字（实测形态：*"The job was not started because recent account payments
   *     have failed or your spending limit needs to be increased"*）；
   *   · `null` —— **没拿到成因**（离线缝没试 / annotation 调用失败 / 响应里没有 failure 级 annotation）。
   *     这是「试过但拿不到」这个**独立取值**：⛔ 它**不**影响 not-started 这个 signal 本身是否产出
   *     （拿不到成因 ≠ 回落成 job-timeout-reached）；
   *   · **键缺失** —— 这条 run **没有**未启动 job（缺 ≠ `null`，硬规则 6）。
   */
  notStartedCause?: string | null;
  jobs?: JobReading[];
  attribution?: string;
  signals?: string[];
  [k: string]: unknown;
}

export interface KnownFlake {
  /** 测试标识 `文件::测试名`（逐字匹配 `failedTests` 的元素）。 */
  test: string;
  /** 首次登记日期（YYYY-MM-DD）。 */
  firstRegistered: string;
  /** 一次性复现证据的引用（文件路径或 URL）。 */
  evidence: string;
}
export interface KnownFlakeRegistry {
  flakes: KnownFlake[];
}

export interface AttributeResult {
  /** `null` = 该记录不是 failure，本函数不适用（⛔ 不是「判为 real-defect」）。 */
  attribution: Attribution | null;
  signals: string[];
}

export interface AttributeOptions {
  /** 已知 flake 登记表。`null`/`undefined` = 读不到（与「空表」不同，硬规则 3b）。 */
  knownFlakes?: KnownFlakeRegistry | null;
  /** 记录里没有 job 级 timeoutMinutes 时使用的 run 级默认值。 */
  jobTimeoutMinutes?: number | null;
}

/**
 * job 里「这一步在跑测试套件」的步名形态（只在步名上判定，不读日志正文）。
 *
 * ⚠️ 刻意**不**含裸的 `test` / `suite`：实测 ci.yml 里有一个失败的前置步叫
 * `Test-coverage self-check (DIR-110/ADR-019 …)` —— 它名字里有 test 但**不是**测试套件。
 * 用裸词匹配会把它读成「测试步跑过」，从而把「测试根本没开始」判反。
 */
export const TEST_STEP_RE = /(run tests?\b|run the (test )?suite|test suite\b|vitest|node --test|npm (run )?test\b|jest\b|playwright|cypress|\be2e\b)/i;
/** job 里「失败的只是 setup」的步名形态（Finding 点名的三类：checkout / setup-node / 依赖安装）。 */
export const SETUP_STEP_RE = /(set up job|checkout|setup-node|setup node|install|npm ci|npm install|yarn|pnpm|restore cache|cache)/i;

/** 「这个 job 从未拿到 runner」这条 infra 信号的**前缀**（后接 job 名）。 */
export const JOB_NOT_STARTED_PREFIX = "infra:job-not-started:";

/**
 * 「这个 job **从未拿到 runner**」的直接量判据（tasks/gap-ci-collector-job-not-started-misattributed-as-timeout）。
 *
 * 为什么需要它（2026-09-24 实测 run `35966264609`）：`version-consistency` job 从未拿到 runner
 * （jobs API 逐字：`runner_name=""`、`steps=[]`、`started_at == created_at == 06:48:06`、
 * `completed_at` 06:50:18），而 `timeout-minutes: 2` ⇒ 旧的 `dur >= to*60` 判据把 132s 报成
 * `infra:job-timeout-reached:version-consistency`。真相是 check-run annotation 逐字给出的
 * *"The job was not started because recent account payments have failed…"* —— 那 132s 是**排队到被拒**
 * 的时长，`timeout-minutes` 只计执行时间，它根本没撞到自己的超时。
 * 形态 = 硬规则 4b：一个**由间接形态推出**的量（时长 ≥ 阈值）冒充了**直接量**（有没有 runner）；
 * 也让「从没起跑」与「跑到一半挂死」共用同一个 signal（硬规则 3b）。
 *
 * 两个条件都不可省：
 *   · `runnerName === ""` —— 严格等于**空串**（API 的直接读数）。⛔ `undefined`（API 给 `null` /
 *     缺键 ⇒ 采集器不写该键）**不算**命中：缺 ≠ 空串（硬规则 6），否则「没采集到」会伪装成「从未起跑」。
 *   · `steps` **存在且为空数组** —— 从未起跑的 job 一条步读数都没有。⛔ 同样要求**存在**：
 *     `steps` 键缺失 = 分不出「没有步」与「没读到步」（硬规则 3b），此时不得报 infra（方向安全）。
 *
 * ⛔ 与 `job-timeout-reached` **互斥且优先**：命中本判据的 job 不再产出同 job 的 timeout signal。
 */
export function jobNeverStarted(job: { runnerName?: unknown; steps?: unknown }): boolean {
  return job.runnerName === "" && Array.isArray(job.steps) && job.steps.length === 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function jobReadings(record: RunRecord): JobReading[] {
  const jobs = record.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => asRecord(j) as JobReading).filter((j): j is JobReading => j !== null);
}

function stepReadings(job: JobReading): JobStepReading[] {
  if (!Array.isArray(job.steps)) return [];
  return job.steps.map((s) => asRecord(s) as JobStepReading).filter((s): s is JobStepReading => s !== null);
}

/** 该 job 里匹配「这是一次测试步」的步读数（**只看步名**，不读日志正文）。 */
function testSteps(job: JobReading): JobStepReading[] {
  return stepReadings(job).filter((s) => TEST_STEP_RE.test(String(s.name ?? "")));
}

/**
 * 测试步是否**执行过**（不论是成功还是失败）。
 *
 * ⚠️ 这一条与被它取代的 `=== "success"` 的差别是本模块最贵的一个 bug（2026-09-15 实测）：
 * 旧写法把「测试步**没成功**」当成「测试步**没跑**」⇒ 一条名叫 `Run tests` 且 conclusion=failure
 * 的步被判成「测试从未开始」⇒ 19 条真失败**全部**被归为 infrastructure（一个在真实语料上恒定的取值，
 * 且方向是把真红**豁免**掉，正是本任务明令不可逆的那一侧）。判据：`skipped` 才是「没跑」，
 * `success` / `failure` / `cancelled` 都是「跑了」。
 */
function testStepStarted(job: JobReading): boolean {
  return testSteps(job).some((s) => ["success", "failure", "cancelled"].includes(String(s.conclusion ?? "")));
}

/** 测试步是否**跑过且失败了**（「测试确实跑了并失败」的直接读出）。 */
function testStepFailed(job: JobReading): boolean {
  return testSteps(job).some((s) => String(s.conclusion ?? "") === "failure");
}

/**
 * 这个 job 的红是不是**实质性的** —— 即它来自被测对象，而不是基础设施把它截断了。
 *
 * 存在的理由（2026-09-15 对真 run 归因时发现）：一个 run 里**有 job 被取消**（`conclusion=cancelled`）
 * 并不代表这个 run 的红就发生在被测对象之外 —— 同一 run 的**另一个** job 可能真真切切地失败了。
 * 实测两次 release run 都是这个形态：`release` job 被取消，而 `sea-verify-node-free` 的
 * `Run quay serve and curl it (no Node on PATH)` 步**真的失败**（那正是 AC-267 追的 SEA 缺陷）。
 * 若让「有 job 被取消」一句话把整条 run 豁免成 infrastructure，就把一个真缺陷洗成了基础设施
 * —— 正是本任务明令不可逆的那一侧。
 *
 * ⛔ 找不到步级证据时返回 false（**不声称**实质性）—— 但那只影响「infra 信号是否被推翻」，
 * 不构成「判为 infrastructure」的理由：没有实质失败时 infra 信号照常生效。
 */
function jobFailureIsSubstantive(job: JobReading): boolean {
  if (String(job.conclusion ?? "") !== "failure") return false;
  const failing = stepReadings(job).filter((s) => String(s.conclusion ?? "") === "failure");
  if (failing.length === 0) return false;
  const testRan = testStepStarted(job) || testStepFailed(job);
  const nonSetupFailed = failing.some((s) => !SETUP_STEP_RE.test(String(s.name ?? "")));
  return testRan || nonSetupFailed;
}

/**
 * 归因一条**失败**记录。纯函数：不读文件、不读环境、不读时钟（登记表由调用方注入）。
 *
 * 记录不是 `conclusion === "failure"` 时返回 `attribution: null` —— 本函数对成功/取消/进行中的
 * run 不适用，而不是「判为真缺陷」（硬规则 3b：读不懂不得与合格同形）。
 */
export function attributeRun(record: RunRecord, opts: AttributeOptions = {}): AttributeResult {
  const rec = asRecord(record) as RunRecord | null;
  if (rec === null) return { attribution: null, signals: ["refused:record-not-an-object"] };

  const conclusion = String(rec.conclusion ?? "");
  if (conclusion !== "failure") {
    return { attribution: null, signals: [`refused:conclusion-is-not-failure:${conclusion || "<absent>"}`] };
  }

  // ── 1. infrastructure — 红发生在【被测对象之外】 ──────────────────────────────────────
  const infra: string[] = [];

  if (rec.timedOut === true) infra.push("infra:run-timed-out");

  const jobs = jobReadings(rec);
  const runLevelTimeout =
    typeof opts.jobTimeoutMinutes === "number" && opts.jobTimeoutMinutes > 0 ? opts.jobTimeoutMinutes : null;

  for (const job of jobs) {
    const name = String(job.name ?? "<unnamed-job>");
    const dur = job.durationSec;
    const to =
      typeof job.timeoutMinutes === "number" && job.timeoutMinutes > 0
        ? job.timeoutMinutes
        : runLevelTimeout;
    // ⛔ 互斥且**优先**：从未拿到 runner 的 job，它的 `durationSec` 是**排队到被拒**的时长，不是执行
    // 时长 ⇒ 不得再产出同 job 的 `job-timeout-reached`（两个成因对同一个 job 互斥，且直接量优先）。
    // 不加这条 else，一个 132s 的排队会被读成「撞到了 2 分钟的执行超时」（2026-09-24 实测的误归因）。
    if (jobNeverStarted(job)) {
      infra.push(`${JOB_NOT_STARTED_PREFIX}${name}`);
    } else if (typeof dur === "number" && dur > 0 && to !== null && dur >= to * 60) {
      infra.push(`infra:job-timeout-reached:${name}`);
    }
    if (String(job.conclusion ?? "") === "cancelled") {
      infra.push(`infra:job-cancelled:${name}`);
    }
  }

  // 失败集中在 **setup 步**（checkout / setup-node / 依赖安装）而测试步从未开始。
  // 两个限定都不可省：
  //   ① ⛔ 只在【有步级读数】时成立 —— 没有步级读数就分不出「挂在 setup」与「挂在测试」，
  //      此时不得报 infra（读不懂 ⇒ 回到兜底，方向安全）。
  //   ② ⛔ 只有【失败的步本身是 setup 形】才成立 —— 否则一个失败在测试之前、但既非 setup 也非测试
  //      的步（实测：`Test-coverage self-check …`）会被误豁免。找不出 setup 形 ⇒ 不报 infra，
  //      落到 real-defect（多一次人看），而不是把一个可能的真缺陷洗成基础设施。
  const hasStepReadings = jobs.some((j) => stepReadings(j).length > 0);
  const failedStepNames = jobs.flatMap((j) =>
    stepReadings(j)
      .filter((s) => String(s.conclusion ?? "") === "failure")
      .map((s) => String(s.name ?? "")),
  );
  const testStepRan = jobs.some((j) => testStepStarted(j));
  const testStepRed = jobs.some((j) => testStepFailed(j));
  const testsReported = typeof rec.testFiles === "number" && rec.testFiles > 0;
  const setupStepFailed = failedStepNames.find((n) => SETUP_STEP_RE.test(n));
  if (hasStepReadings && setupStepFailed !== undefined && !testStepRan && !testsReported) {
    infra.push(`infra:failed-before-tests-started:setup-step:${setupStepFailed}`);
  }

  // infra 信号**不是一票通过**：同一 run 里若另有 job 的红是实质性的，则那个红才是这个 run 红的
  // 成因，不得被兄弟 job 的取消/超时豁免掉（方向不可逆）。被压制的 infra 信号原样留在 signals 里
  // —— 读记录的人要能看见「它命中过，只是没定案」，而不是看不见它。
  const substantiveJob = jobs.find((j) => jobFailureIsSubstantive(j));
  const suppressed: string[] = [];
  if (infra.length > 0) {
    if (substantiveJob === undefined) return { attribution: "infrastructure", signals: infra };
    suppressed.push(`defect:substantive-failure:${String(substantiveJob.name ?? "<unnamed-job>")}`);
    for (const s of infra) suppressed.push(`suppressed-by-substantive-failure:${s}`);
  }

  // ── 2. known-flake — 失败测试标识命中登记表 ──────────────────────────────────────────
  // ⛔ 登记表为空 / 读不到就**判不出** known-flake。「看起来像 flake」「上次也红过」不是信号：
  // 那会把真缺陷洗成 flake，方向不可逆。
  const flakeSignals: string[] = [];
  const failedTests = Array.isArray(rec.failedTests) ? rec.failedTests.map((t) => String(t)) : [];
  const registry = opts.knownFlakes ?? null;
  if (registry !== null && Array.isArray(registry.flakes) && failedTests.length > 0) {
    for (const flake of registry.flakes) {
      const id = String(asRecord(flake)?.test ?? "");
      if (id !== "" && failedTests.includes(id)) flakeSignals.push(`flake:${id}`);
    }
  }
  if (flakeSignals.length > 0) return { attribution: "known-flake", signals: flakeSignals };

  // ── 3. real-defect — 兜底 ────────────────────────────────────────────────────────────
  // 与兜底可分辨的正向读出：测试**确实跑了**（`testFiles > 0`，或某个 job 的测试步执行过）
  // ⇒ 这是「读懂了记录，判为真缺陷」，不是「无信号可依」。
  const tail = suppressed.length > 0 ? suppressed : [];
  if (testsReported || testStepRan || testStepRed) {
    return { attribution: "real-defect", signals: [DEFECT_TESTS_RAN, ...tail] };
  }
  return { attribution: "real-defect", signals: [DEFAULT_NO_SIGNAL, ...tail] };
}

/** 判定一条已归因记录是否「带一个合法 attribution」（供只读复核与写面自检）。 */
export function hasValidAttribution(record: RunRecord): boolean {
  return (ATTRIBUTION_VOCAB as readonly string[]).includes(String(record.attribution ?? ""));
}

/** 登记表路径（默认与模块同目录的 `known-flakes.json`）。 */
export function defaultKnownFlakesPath(moduleDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  return path.join(moduleDir, "known-flakes.json");
}

/**
 * 读登记表。**读不到 ⇒ `null`**（⛔ 不返回空表：`null` = 读不懂，`{flakes:[]}` = 表是空的，
 * 二者在硬规则 3b 下必须是不同取值）。非法 JSON 同样是 `null`。
 */
export function loadKnownFlakes(filePath: string = defaultKnownFlakesPath()): KnownFlakeRegistry | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = asRecord(parsed);
  if (obj === null || !Array.isArray(obj.flakes)) return null;
  const flakes: KnownFlake[] = [];
  for (const f of obj.flakes) {
    const r = asRecord(f);
    if (r === null) return null;
    if (typeof r.test !== "string" || typeof r.firstRegistered !== "string" || typeof r.evidence !== "string") {
      return null;
    }
    flakes.push({ test: r.test, firstRegistered: r.firstRegistered, evidence: r.evidence });
  }
  return { flakes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "ci-red-attribute.ts — 把一条失败 run 记录归因为 real-defect | infrastructure | known-flake",
    "",
    "用法:",
    "  --record-file <path>   读一条 JSON 记录并归因（打印 {attribution, signals}）",
    "  --carrier <path>       只读复核整个载体：逐条报 failure 记录的 attribution 是否合法",
    "  --flakes <path>        已知 flake 登记表（默认 plugin/scripts/known-flakes.json）",
    "  --json                 机器可读输出",
    "  --list-flakes          打印登记表内容",
    "  --help",
    "",
    "退出码: 0 = 归因/复核完成且可读; 1 = 输入读不懂; 2 = 用法错误; 3 = 复核发现缺归因",
  ].join("\n");
}

function readJsonFile(p: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  /** Arity-1 adapter over the shared `flagValue`: this closure captures the local `argv`. The
   *  `|| null` preserves THIS call site's original reading — a flag whose value is the empty string
   *  reads as "not given" (see flagValue's header: that reading is now a per-call-site decision, not
   *  an inherited property of a private copy). */
  const flag = (name: string): string | null => flagValue(argv, name) || null;

  const flakesPath = flag("--flakes") ?? defaultKnownFlakesPath();
  const knownFlakes = loadKnownFlakes(flakesPath);

  if (argv.includes("--list-flakes")) {
    if (knownFlakes === null) {
      console.error(`⚠ 登记表读不到或格式非法: ${flakesPath}`);
      return 1;
    }
    for (const f of knownFlakes.flakes) console.log(`${f.test}\t${f.firstRegistered}\t${f.evidence}`);
    console.error(`(${knownFlakes.flakes.length} 条)`);
    return 0;
  }

  const recordFile = flag("--record-file");
  const carrier = flag("--carrier");

  if (recordFile === null && carrier === null) {
    console.error(usage());
    return 2;
  }

  if (recordFile !== null) {
    const r = readJsonFile(recordFile);
    if (!r.ok) {
      console.error(`读不懂输入 ${recordFile}: ${r.error}`);
      return 1;
    }
    const rec = asRecord(r.value);
    if (rec === null) {
      console.error(`读不懂输入 ${recordFile}: 顶层不是一个 JSON 对象`);
      return 1;
    }
    const res = attributeRun(rec as RunRecord, { knownFlakes });
    if (argv.includes("--json")) console.log(JSON.stringify(res));
    else console.log(`${res.attribution}\t${res.signals.join(",")}`);
    return 0;
  }

  // ── 只读复核整个载体 ──
  let lines: string[];
  try {
    lines = fs.readFileSync(carrier as string, "utf8").split("\n");
  } catch (e) {
    console.error(`读不懂输入 ${carrier}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  let total = 0;
  let failures = 0;
  let unreadableFlags = 0;
  const missing: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      unreadableFlags += 1;
      continue;
    }
    const rec = asRecord(parsed);
    if (rec === null) {
      unreadableFlags += 1;
      continue;
    }
    total += 1;
    if (String(rec.conclusion ?? "") !== "failure") continue;
    failures += 1;
    if (!(ATTRIBUTION_VOCAB as readonly string[]).includes(String(rec.attribution ?? ""))) {
      missing.push({ runId: rec.runId, attribution: rec.attribution ?? null });
    }
  }
  console.log(
    `records=${total} failures=${failures} unattributed=${missing.length} unreadable=${unreadableFlags}`,
  );
  if (missing.length > 0) {
    for (const m of missing.slice(0, 5)) console.error(`  缺归因: runId=${m.runId} attribution=${m.attribution}`);
    return 3;
  }
  return 0;
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "ci-red-attribute"
) {
  process.exit(main(process.argv.slice(2)));
}
