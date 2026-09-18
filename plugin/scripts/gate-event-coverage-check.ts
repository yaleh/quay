#!/usr/bin/env node
// gate-event-coverage-check.ts — 每日「落地 ⇒ `complete` GateEvent」覆盖率判据
// (tasks/gap-complete-gateevent-coverage-has-a-residual-gap).
//
// THE DEFECT THIS CLOSES (残留缺口，逐条追因见任务体 ## Finding)：
//   `complete` GateEvent 是「完成数」的权威载体，但**不是每个落地都写它**。上一次修复
//   (gap-mechanical-fan-in-writes-no-complete-gateevent) 只修了机械 fan-in 一条路径，另有多条落地路径
//   绕过写侧，而**没有任何检查盯覆盖率** ⇒ 「今天少写了两成事件」与「今天真的完成得少」在记录上同形，
//   据该载体统计完成数的判据/看板会系统性少算，且偏差不发声音。
//
// WHAT IT MEASURES (两个都必须对，否则读数无意义)：
//   - 分母 = **落地**（landing），⛔ 不是 `翻 X done` 提交条数。一次落地可产生多条翻 done 提交：
//     机械 fan-in 的 flip 在 ff **之前**，ff 失败 ⇒ reset 回 ready 重试 ⇒ 同一次落地留下 1..N 条
//     flip 提交。实测 2026-09-07：89 条 flip 提交 / 47 个任务 = 1.89×。用提交条数当分母会把
//     「重试」误读成「漏写」（原 finding 的 53% 里绝大部分是这个）。
//     本检查取「每个任务在窗口内的**最后一次** flip」且**该任务在 merge target 上的终态是 done**
//     ——回滚掉的尝试与未落地的任务都不入分母。
//   - 分子 = 该任务存在 `gate:"complete"` + `verdict:"pass"` 且时间戳 ≥ 该 flip 提交时刻的事件。
//
// KNOWN EXCEPTIONS (推导式，⛔ 不是手维护的 id 白名单 —— 白名单可以被加 id 静默放大，推导式不能)：
//   一次**未覆盖**的落地，其 flip 提交时刻**早于**载体中**第一条 `actor:"quay-driver"` 的 complete
//   pass 事件** ⇒ 判为 bootstrap 例外：那一刻机械 fan-in 写侧在生产上**尚未生效**（代码已提交但在
//   任务分支上、主检出的 driver 跑的还是旧代码），要求它为「机制还不存在」负责是把仪器故障算成数据缺陷。
//   实测该 cutoff = 2026-09-04T11:16:47Z，恰好把 09-04 的两条 bootstrap 落地排除，而 09-06 的
//   AC78 workflow 落地（17:47/20:18）与 09-12 的直接 task_write 落地都**在 cutoff 之后** ⇒ 仍报红。
//   例外集合每次运行**逐条打印**（可审计）；它随历史增长只会变小，不会变大。
//
// THREE-STATE (硬规则 3b —— 读不懂输入不得与「合格」同形)：
//   载体读不到 / git 不可用 / 窗口内零落地 ⇒ exit 3 NOT-EVALUATED，**绝不 exit 0**。
//   run_checker 认 exit 3 为第三态（不 fail-closed、不 abort 套件），消费方工作区（无 .quay/
//   gate-events.jsonl、无 develop）必须能把「这里没评估」与「这里评估过且合格」区分开。
//
// Exit codes: 0 = PASS（窗口内每个非豁免日覆盖率 ≥ 阈值）;
//             1 = RED（至少一个非豁免日覆盖率 < 阈值）;
//             2 = usage/environment error;
//             3 = NOT-EVALUATED（载体/git/落地读数不可得）.
//
// Usage:
//   node --experimental-strip-types gate-event-coverage-check.ts [--root <dir>] [--merge-target <ref>]
//     [--days <N> | --all | --since <ISO> --until <ISO>] [--threshold <pct>] [--json] [--gate]
//   --days N    最近 N 个**完整**日（UTC，不含今天；缺省 3）——静态门的常规窗口
//   --all       自载体最早一条 complete 事件起，逐日评估（取证/复核用；在修复前数据上必须报红）
//   --gate      静态门接线模式：只输出一行判定 + 失败明细（缺省非 gate 打印完整逐日表）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// argValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";

export interface Landing {
  task: string;
  /** flip 提交的 committer ISO 时间戳 */
  ts: string;
  day: string;
  sha: string;
}

export interface DayReading {
  day: string;
  landings: number;
  covered: number;
  /** 未覆盖且**不在**例外集合内 —— 这些才判红 */
  uncovered: string[];
  /** 未覆盖但在例外集合内（bootstrap：早于载体中第一条 quay-driver complete 事件） */
  exempt: string[];
  coverage: number;
}

export interface CoverageReport {
  windowFrom: string;
  windowTo: string;
  threshold: number;
  bootstrapCutoff: string | null;
  days: DayReading[];
  /** 非豁免日里的最低覆盖率；窗口内零落地时为 null */
  worstCoverage: number | null;
  verdict: "pass" | "red" | "not-evaluated";
  reason: string;
}

/** `git log` 的 (sha, committer ISO, subject) 三元组，按**分支顺序**（--reverse ⇒ 旧→新）。 */
export function readLog(root: string, mergeTarget: string, extra: string[]): Array<{ sha: string; ts: string; subject: string }> {
  const out = execFileSync(
    "git",
    ["-C", root, "log", mergeTarget, "--reverse", "--date=iso-strict", "--pretty=%H%x09%cI%x09%s", ...extra],
    { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] },
  );
  return out.split("\n").filter(Boolean).map((line) => {
    const [sha, ts, ...rest] = line.split("\t");
    return { sha, ts, subject: rest.join("\t") };
  });
}

const STATUS_RE = /^([+-])status: (\S+)$/;
const FILE_RE = /^\+\+\+ b\/tasks\/(.+)\.md$/;

/** 窗口内的**落地**集合 —— ⛔ 按**状态转移**取，不按提交信息取。
 *
 *  WHY NOT SUBJECT MATCHING（`/^tasks: 翻 (\S+) done/`）：那只认写「翻 X done」字样的路径。实测本仓
 *  另有一条**不写该字样**的落地路径（直接 Provider-ABI `task_write status: done`，
 *  提交信息形如 `tasks: <id> task_write by cli:<pid>`）——09-04~09-14 有 3 次
 *  （09-12 gap-goal-target-health-vs-dir131-boundary 且是 todo→done 的非法边、09-08、09-06），
 *  按提交信息扫**一条都看不见**。这正是 AC1 要求的「枚举所有会把任务翻 done 的路径」的机械版：
 *  判据按**位置**（`tasks/*.md` 的 frontmatter status 行从非 done 变 done），不按关键词。
 *
 *  ONE git call（`git log -p -- tasks/`），⛔ 不是每提交两次 `git show`（--all 窗口上千提交下会秒级变分钟级）。
 *  per-(commit,file) 块内：`-status: X` 之后 `+status: done` ⇒ 该提交把该任务翻成了 done。
 *  「回滚重试」自然落空：那次 flip 之后又有 `-status: done` ⇒ 该任务的**最后**一次转移不是 done。
 *  终态判据另用 mergeTarget tip 上的 status 复核（tip 不是 done 的一律不入分母）。 */
export function collectLandings(
  root: string,
  mergeTarget: string,
  fromIso: string | null,
  toIso: string | null,
): Landing[] {
  const extra: string[] = [];
  if (fromIso) extra.push(`--since=${fromIso}`);
  if (toIso) extra.push(`--until=${toIso}`);
  const out = execFileSync(
    "git",
    // 哨兵必须是 diff 里结构上不可能出现的串：`@@` 会与 hunk 头（`@@ -1,7 +1,7 @@`）撞车
    // ⇒ 把 hunk 头当提交头解析，ts 被清零、块被提前关闭（实测：窗口内零落地）。
    // -U0 把每条 hunk 压到最小（本检查只看 status 行，不需要上下文）；--no-renames 省掉重命名检测。
    // ⚠️ 选项必须排在 `--` **之前**：`--` 之后的 `--since=…` 会被当成 **pathspec**（实测：静默扫全史，
    // 3 天窗口读出 2048 条「落地」= done 任务总数，而逐日聚合又把它们按 day 过滤掉了 ⇒ 表面上正确、
    // 代价 42s，且窗口在 git 侧根本没生效 —— 硬规则 4c：量要穿过所有中间层，包括 argv 顺序）。
    [
      "-C", root, "log", mergeTarget, "--reverse", "--date=iso-strict",
      "--pretty=@@COMMIT@@%H%x09%cI", "-p", "-U0", "--no-renames", ...extra, "--", "tasks/",
    ],
    { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] },
  );

  // 每任务最后一次「非 done → done」的转移（log 为旧→新，直接覆盖即得最后一次）
  const lastLanding = new Map<string, { ts: string; sha: string }>();
  let curTs = "";
  let curSha = "";
  let curTask: string | null = null;
  let prevStatus: string | null = null; // 本 (commit,file) 块内见到的最近一条 `-status:`
  let plusStatus: string | null = null; // 本块内见到的 `+status:`

  const closeBlock = (): void => {
    if (curTask && plusStatus === "done" && prevStatus !== "done") {
      lastLanding.set(curTask, { ts: curTs, sha: curSha }); // 后者覆盖前者 ⇒ 留最后一次
    }
    curTask = null;
    prevStatus = null;
    plusStatus = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("@@COMMIT@@")) {
      closeBlock();
      const [sha, ts] = line.slice("@@COMMIT@@".length).split("\t");
      curSha = sha ?? "";
      curTs = ts ?? "";
      continue;
    }
    const fm = line.match(FILE_RE);
    if (fm) {
      closeBlock();
      curTask = fm[1];
      continue;
    }
    const sm = line.match(STATUS_RE);
    if (sm && curTask) {
      if (sm[1] === "-") prevStatus = sm[2];
      else plusStatus = sm[2];
    }
  }
  closeBlock();

  const landings: Landing[] = [];
  for (const [task, l] of lastLanding) {
    // 终态复核：mergeTarget tip 上 status 必须是 done（tip 已删/非 done ⇒ 不是落地）。
    let status: string | null = null;
    try {
      const body = execFileSync("git", ["-C", root, "show", `${mergeTarget}:tasks/${task}.md`], {
        encoding: "utf8",
        maxBuffer: 1 << 24,
        stdio: ["ignore", "pipe", "ignore"], // 任务在 tip 上不存在是**正常**分支（status=null），不是噪声
      });
      status = (body.match(/^status: (\S+)$/m) ?? [])[1] ?? null;
    } catch {
      status = null;
    }
    if (status !== "done") continue;
    landings.push({ task, ts: l.ts, day: l.ts.slice(0, 10), sha: l.sha });
  }
  return landings.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

export interface CompleteEvent {
  task: string;
  ts: string;
  actor: string;
}

/** 载体的 complete pass 事件（三态：读不到 ⇒ null，⛔ 不是空数组——「读不到」与「读到且为空」不同形）。 */
export function readCompleteEvents(carrier: string): CompleteEvent[] | null {
  let raw: string;
  try {
    raw = fs.readFileSync(carrier, "utf8");
  } catch {
    return null;
  }
  const out: CompleteEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 半行/坏行：跳过单条，不让一行噪声把整份读数判成不可得
    }
    if (e.gate !== "complete" || e.verdict !== "pass") continue;
    const task = (e.pipeline_id ?? e.item_id) as string | undefined;
    if (typeof task !== "string" || typeof e.timestamp !== "string") continue;
    out.push({ task, ts: e.timestamp, actor: typeof e.actor === "string" ? e.actor : "" });
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/** Pure aggregation: landings × complete events ⇒ 逐日读数 + 判定。 */
/** 窗口边界（UTC 日，含两端）。⛔ 必须是**同一个**函数供 git 侧与聚合侧共用——两边各算一次就会漂移，
 *  而漂移的形态是「git 只扫了窗口、聚合按别的窗口算」⇒ 静默少算（硬规则 4c：量要穿过所有中间层）。 */
export function windowBounds(opts: { days: number | "all"; events: CompleteEvent[]; nowIso: string }): { from: string; to: string } {
  const todayUtc = opts.nowIso.slice(0, 10);
  if (opts.days === "all") {
    return { from: opts.events.length ? opts.events[0].ts.slice(0, 10) : todayUtc, to: todayUtc };
  }
  const t = Date.parse(`${todayUtc}T00:00:00Z`);
  // 最近 N 个**完整**日：不含今天（部分日会把覆盖率拖低，是读数伪影不是缺陷）
  return {
    from: new Date(t - opts.days * 86400e3).toISOString().slice(0, 10),
    to: new Date(t - 86400e3).toISOString().slice(0, 10),
  };
}

export function computeCoverage(opts: {
  landings: Landing[];
  events: CompleteEvent[];
  threshold: number;
  from: string;
  to: string;
}): CoverageReport {
  const { landings, events, threshold, from, to } = opts;
  // bootstrap cutoff：载体里第一条 quay-driver complete 事件（写侧在生产上生效的最早可观测时刻）。
  const driverEvents = events.filter((e) => e.actor === "quay-driver");
  const bootstrapCutoff = driverEvents.length ? driverEvents[0].ts : null;

  const byDay = new Map<string, Landing[]>();
  for (const l of landings) {
    if (l.day < from || l.day > to) continue;
    const arr = byDay.get(l.day) ?? [];
    arr.push(l);
    byDay.set(l.day, arr);
  }

  const days: DayReading[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const ls = byDay.get(day)!;
    const uncovered: string[] = [];
    const exempt: string[] = [];
    let covered = 0;
    for (const l of ls) {
      // 该任务在 flip 时刻之后（允许 60s 时钟容差）有 complete pass 事件 ⇒ 覆盖
      const hit = events.some((e) => e.task === l.task && Date.parse(e.ts) >= Date.parse(l.ts) - 60e3);
      if (hit) {
        covered++;
      } else if (bootstrapCutoff !== null && Date.parse(l.ts) < Date.parse(bootstrapCutoff)) {
        exempt.push(l.task);
      } else {
        uncovered.push(l.task);
      }
    }
    const denom = ls.length - exempt.length;
    days.push({
      day,
      landings: ls.length,
      covered,
      uncovered,
      exempt,
      coverage: denom > 0 ? covered / denom : 1,
    });
  }

  const judged = days.filter((d) => d.landings - d.exempt.length > 0);
  const worstCoverage = judged.length ? Math.min(...judged.map((d) => d.coverage)) : null;
  // ⚠️ 单位：`threshold` 是百分数（95），`d.coverage` 是比值（0.9459）——⛔ 不能直接比。
  const redDays = judged.filter((d) => d.coverage * 100 < threshold);
  const verdict: CoverageReport["verdict"] =
    landings.length === 0 && days.length === 0 ? "not-evaluated" : redDays.length ? "red" : "pass";
  const reason =
    verdict === "not-evaluated"
      ? "窗口内零落地 —— 无可评估对象（⛔ 不是「合格」）"
      : verdict === "red"
        ? `覆盖率低于阈值 ${threshold}% 的非豁免日：${redDays.map((d) => `${d.day}=${(d.coverage * 100).toFixed(0)}%`).join(" ")}`
        : `窗口内全部非豁免日覆盖率 ≥ ${threshold}%（最差 ${worstCoverage === null ? "n/a" : (worstCoverage * 100).toFixed(0)}%）`;

  return { windowFrom: from, windowTo: to, threshold, bootstrapCutoff, days, worstCoverage, verdict, reason };
}

function usage(): void {
  console.log(
    "gate-event-coverage-check — 每日「落地 ⇒ complete GateEvent」覆盖率判据\n" +
      "  --root <dir>            主检出 root（载体 <root>/.quay/gate-events.jsonl 所在；缺省 cwd）\n" +
      "  --merge-target <ref>    落地提交所在分支（缺省 develop）\n" +
      "  --days <N>              最近 N 个完整日（UTC，不含今天；缺省 3）\n" +
      "  --all                   自载体最早一条 complete 事件起逐日评估（取证用）\n" +
      "  --threshold <pct>       覆盖率阈值（缺省 95）\n" +
      "  --json                  机器可读输出\n" +
      "  --gate                  静态门模式：只打印判定行 + 失败/例外明细\n" +
      "exit 0=PASS · 1=RED · 2=usage · 3=NOT-EVALUATED（载体/git/落地读数不可得）",
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }
  const json = args.includes("--json");
  const gate = args.includes("--gate");
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const mergeTarget = flagValue(args, "--merge-target") ?? "develop";
  const daysRaw = flagValue(args, "--days");
  const days: number | "all" = args.includes("--all") ? "all" : daysRaw ? Number(daysRaw) : 3;
  if (days !== "all" && (!Number.isFinite(days) || days < 1)) {
    console.error("gate-event-coverage-check: --days must be a positive integer");
    return 2;
  }
  const thresholdRaw = flagValue(args, "--threshold");
  const threshold = thresholdRaw ? Number(thresholdRaw) : 95;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
    console.error("gate-event-coverage-check: --threshold must be in (0,100]");
    return 2;
  }

  const carrier = path.join(root, ".quay", "gate-events.jsonl");
  const events = readCompleteEvents(carrier);
  if (events === null) {
    // 三态：读不到载体 ⇒ NOT-EVALUATED（⛔ 不是 PASS——「没评估」与「评估过且合格」必须可区分）
    const msg = `NOT-EVALUATED: 载体读不到（${carrier}）——无法评估，⛔ 不判合格`;
    if (json) console.log(JSON.stringify({ verdict: "not-evaluated", reason: msg, carrier }));
    else console.log(msg);
    return 3;
  }

  // 窗口先定（⛔ 在 git 扫描**之前**），并把同一对边界喂给 git 与聚合两侧。
  const { from, to } = windowBounds({ days, events, nowIso: new Date().toISOString() });

  let landings: Landing[];
  try {
    landings = collectLandings(root, mergeTarget, `${from}T00:00:00Z`, `${to}T23:59:59Z`);
  } catch (e) {
    const msg = `NOT-EVALUATED: 读不到 ${mergeTarget} 的落地提交（${(e as Error)?.message ?? e}）`;
    if (json) console.log(JSON.stringify({ verdict: "not-evaluated", reason: msg }));
    else console.log(msg);
    return 3;
  }

  const report = computeCoverage({ landings, events, threshold, from, to });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!gate) {
    console.log(`gate-event-coverage-check — 窗口 ${report.windowFrom} .. ${report.windowTo}，阈值 ${threshold}%`);
    console.log(`bootstrap cutoff（载体中第一条 quay-driver complete 事件）: ${report.bootstrapCutoff ?? "（无 ⇒ 无豁免）"}`);
    console.log("day         landings covered exempt uncovered  coverage");
    for (const d of report.days) {
      const pct = d.landings - d.exempt.length > 0 ? `${(d.coverage * 100).toFixed(0)}%` : "n/a（全豁免）";
      console.log(
        `${d.day}  ${String(d.landings).padStart(8)} ${String(d.covered).padStart(7)} ${String(d.exempt.length).padStart(6)} ${String(d.uncovered.length).padStart(9)}  ${pct}`,
      );
      if (d.uncovered.length) console.log(`    UNCOVERED: ${d.uncovered.join(", ")}`);
      if (d.exempt.length) console.log(`    EXEMPT(bootstrap): ${d.exempt.join(", ")}`);
    }
    console.log(`${report.verdict.toUpperCase()}: ${report.reason}`);
  } else {
    console.log(`${report.verdict.toUpperCase()}: ${report.reason}`);
    for (const d of report.days) {
      if (d.uncovered.length) console.log(`  UNCOVERED ${d.day} (${(d.coverage * 100).toFixed(0)}%): ${d.uncovered.join(", ")}`);
    }
    for (const d of report.days) {
      if (d.exempt.length) console.log(`  EXEMPT ${d.day} (bootstrap, < ${report.bootstrapCutoff}): ${d.exempt.join(", ")}`);
    }
  }

  return report.verdict === "red" ? 1 : report.verdict === "not-evaluated" ? 3 : 0;
}

// expectedBase 是**必填**的（见 gate-script-base.ts —— 裸 isDirectEntry(import.meta) 在 bundled
// 形态下会让被内联的库也执行自己的 main，实测 2026-09-13 三个 driver 全跑成 pool-quality-judge）。
if (isDirectEntry(import.meta, process.argv[1], "gate-event-coverage-check")) {
  process.exitCode = await main();
}
