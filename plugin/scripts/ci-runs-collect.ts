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
//
// ── 运维后果（⛔ 跑之前先读这一条）────────────────────────────────────────────────────────
// 载体在本仓是**被 git 跟踪**的（与 `.quay/routine-findings.jsonl` 同一形态 —— AC-269/268/267 的判据
// 就是在某个检出里读这个文件，不被跟踪它就只能活在跑采集的那一个 worktree 里）。
// 后果：**采集与提交必须成对做**。只跑采集不提交，工作树会留下一条 ` M .quay/ci-runs.jsonl`；
// 而 ff 的 benign-runtime-dirty 通道只放行 `??`（未跟踪）的 `.quay/*`（`fan-in/ff-merge.ts` 的
// `pstatus !== "??"` 分支），跟踪+已改的路径会被判「working tree not clean」⇒ 挡住之后每一次 fan-in 的 ff。
// ⇒ 用法：`… ci-runs-collect.ts … && git add .quay/ci-runs.jsonl && git commit -m 'chore: CI run 载体'`。
//
// ── 离线缝 ─────────────────────────────────────────────────────────────────────────────
// `--from-file <runs.json>` 用一份 gh 形状的 run 数组替代真实 API 调用，走的是**同一个 collect()**
// 与**同一个写函数**。这让「写面会写 attribution」可以在没有网络时被真跑一遍，而不是靠手工往载体里塞一行。
//
// 用法:
//   node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --limit 20
//   node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --from-file runs.json --print
//   node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --carrier-verify
// 退出码: 0 = 采集并落盘（或 dry-run）成功；1 = 输入读不懂 / gh 失败；2 = 用法错误。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import {
  attributeRun,
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

/** 把 gh 的 job 形状转成归因器读的 job 读数（纯转换，无 IO）。 */
export function toJobReadings(jobs: GhJob[], timeouts: Record<string, number> = {}): JobReading[] {
  return jobs.map((j) => {
    const name = String(j.name ?? "");
    const reading: JobReading = {
      name,
      conclusion: j.conclusion === null || j.conclusion === undefined ? undefined : String(j.conclusion),
    };
    const dur = secsBetween(j.started_at, j.completed_at);
    if (dur !== undefined) reading.durationSec = dur;
    const to = timeouts[name];
    if (typeof to === "number" && to > 0) reading.timeoutMinutes = to;
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
  if (jobs.length > 0) rec.jobs = toJobReadings(jobs, opts.timeouts ?? {});
  // `timedOut` 只记 **GitHub 自己说的**（run 或 job 结论为 timed_out）；从时长推断的那条走
  // 归因器的 infra:job-timeout-reached（两个不同来源，不合并成一个布尔）。
  // ⛔ 这一条**不在** `jobs.length > 0` 块里：run 级的 timed_out 与「job 列表取没取到」无关，
  // 放进那个块会让「jobs API 读失败」静默地连带丢掉 run 级超时这个直接观测。
  if (String(run.conclusion ?? "") === "timed_out" || jobs.some((j) => String(j.conclusion ?? "") === "timed_out")) {
    rec.timedOut = true;
  }
  if (typeof opts.testFiles === "number" && opts.testFiles > 0) rec.testFiles = opts.testFiles;
  if (Array.isArray(opts.failedTests) && opts.failedTests.length > 0) rec.failedTests = opts.failedTests;

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

export const defaultGhRunner: GhRunner = (args) =>
  execFileSync("gh", args, { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });

function ghJson<T>(run: GhRunner, args: string[]): T {
  return JSON.parse(run(args)) as T;
}

export interface CollectOptions {
  repo: string;
  workflow?: string;
  limit?: number;
  branch?: string;
  fetchLogs?: boolean;
  run?: GhRunner;
  /** 离线缝：直接用这份 run 数组，不调 gh（走的是同一个 buildRecord/collect 路径）。 */
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

    let testFiles: number | null = opts.testFilesByRun?.[runId] ?? null;
    if (testFiles === null && opts.fetchLogs && !opts.runs && runId !== "") {
      for (const j of jobs) {
        if (typeof j.id !== "number" && typeof j.id !== "string") continue;
        try {
          // `--allow-escape-sequences` 不可省：gh 默认**拒绝**输出含 ANSI 转义色的 job 日志
          // （报 "the response contains terminal escape sequences; pass --allow-escape-sequences"），
          // 而测试日志恰恰是带色的 ⇒ 省掉它会让每一条 job 都取回 0 字节，testFiles 永远派生不出来。
          // 实测 2026-09-15：不加该旗标 `gh api .../jobs/<id>/logs` 返回 0 字节。
          const log = run(["api", "--allow-escape-sequences", `/repos/${opts.repo}/actions/jobs/${j.id}/logs`]);
          const n = deriveTestFilesFromLog(log);
          if (n !== null && (testFiles === null || n > testFiles)) testFiles = n;
        } catch (e) {
          warnings.push(`job-log-unreadable:${j.id}:${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    records.push(buildRecord(r, { jobs, timeouts, testFiles }));
  }

  return { records, warnings };
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

export interface WriteResult {
  appended: number;
  skipped: number;
  attributed: number;
}

/**
 * **落盘**：归因（只对 failure）→ 去重 → 追加。载体只追加，从不重写既有行。
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
  return { appended: out.length, skipped, attributed };
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
    "  --fetch-logs          额外下载 job 日志以派生 testFiles（慢；默认关）",
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
  const flag = (n: string): string | null => {
    const i = argv.indexOf(n);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };

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

  let result: CollectResult;
  try {
    result = collect({
      repo,
      ...(workflow ? { workflow } : {}),
      limit,
      ...(branch ? { branch } : {}),
      fetchLogs: argv.includes("--fetch-logs"),
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
      `carrier=${carrier} appended=${res.appended} skipped=${res.skipped} attributed=${res.attributed}`,
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
