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

/** job 里「测试真的开始跑了」的步名形态（只在步名上判定，不读日志正文）。 */
export const TEST_STEP_RE = /(run tests|test suite|suite|vitest|node --test|npm test|playwright|e2e)/i;
/** job 里「失败的只是 setup」的步名形态（Finding 点名的三类：checkout / setup-node / 依赖安装）。 */
export const SETUP_STEP_RE = /(set up job|checkout|setup-node|setup node|install|npm ci|npm install|yarn|pnpm|restore cache|cache)/i;

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

/** 该 job 是否真的跑过一个测试步（**只看步名与结论**）。 */
function testStepSucceeded(job: JobReading): boolean {
  return stepReadings(job).some(
    (s) => TEST_STEP_RE.test(String(s.name ?? "")) && String(s.conclusion ?? "") === "success",
  );
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
    if (typeof dur === "number" && dur > 0 && to !== null && dur >= to * 60) {
      infra.push(`infra:job-timeout-reached:${name}`);
    }
    if (String(job.conclusion ?? "") === "cancelled") {
      infra.push(`infra:job-cancelled:${name}`);
    }
  }

  // 失败集中在 setup 步而测试步从未开始。⛔ 只在【有步级读数】时成立：没有步级读数就分不出
  // 「挂在 setup」与「挂在测试」，此时不得报 infra（读不懂 ⇒ 回到兜底，方向安全）。
  const hasStepReadings = jobs.some((j) => stepReadings(j).length > 0);
  const failedStepNames = jobs.flatMap((j) =>
    stepReadings(j)
      .filter((s) => String(s.conclusion ?? "") === "failure")
      .map((s) => String(s.name ?? "")),
  );
  const anyTestStepRan = jobs.some((j) => testStepSucceeded(j));
  const testsReported = typeof rec.testFiles === "number" && rec.testFiles > 0;
  if (hasStepReadings && failedStepNames.length > 0 && !anyTestStepRan && !testsReported) {
    // 命中的步名里优先点名 setup 形（checkout / setup-node / 依赖安装）—— Finding 点名的三类；
    // 没有 setup 形时（例如失败在静态检查步）仍成立（测试步同样从未开始），只是不点名。
    const setupStep = failedStepNames.find((n) => SETUP_STEP_RE.test(n));
    infra.push(
      setupStep
        ? `infra:failed-before-tests-started:setup-step:${setupStep}`
        : `infra:failed-before-tests-started:first-failed-step:${failedStepNames[0]}`,
    );
  }

  if (infra.length > 0) return { attribution: "infrastructure", signals: infra };

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
  // 与兜底可分辨的正向读出：测试**确实跑了**并失败（testFiles > 0，或某个 job 的测试步跑成功了）
  // ⇒ 这是「读懂了记录，判为真缺陷」，不是「无信号可依」。
  if (testsReported || anyTestStepRan) {
    return { attribution: "real-defect", signals: [DEFECT_TESTS_RAN] };
  }
  return { attribution: "real-defect", signals: [DEFAULT_NO_SIGNAL] };
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
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };

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
