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
// --no-block (gap-coverage-miss-fail-closed-stops-code-landings): **取值与阻断解耦**。
//   本判据的对象是一条**历史**事实（前一天的落地漏写 complete 事件），与**当轮**任何 delta 无关。
//   默认（无 --no-block）下 RED ⇒ exit 1，而 run_checker 对 exit 1 fail-closed ⇒ **当天每一条 code
//   delta 的 fan-in 都在静态闸中止、套件根本不跑**（2026-10-01 实测：`.quay/full-suite-state.json`
//   `reason=static-check` / 日志尾 `# tests 0 · # fail 46 · # suite red static-check`）。这正是本仓
//   已记过的「成本落在无关任务头上」缺陷——此前只把窗口从 3 天收到 1 天缩小了影响面，**没有动
//   fail-closed 这一维**。
//   --no-block 把两个轴分开：**取值轴**仍是 pass / red / not-evaluated（打印 + 记入 grow-only ledger
//   `.quay/gate-event-coverage-nonblock-ledger.jsonl`，可审计、不消失）；**阻断轴**关掉（RED 不再
//   exit 1）。⇒ 「闸坏了」（载体读不到 ⇒ 仍 exit 3，run_checker 记 not-evaluated）与「昨天漏记了一条」
//   （RED：报出 + 记账，但不挡当轮）**可区分**（硬规则 3b）。
//   ⛔ 不是「改成不报」：RED 的判定行与 UNCOVERED 明细照常打印，且落 ledger；默认模式**保持**
//   fail-closed（mutation case 与按需诊断走的正是默认模式——它必须仍能报红）。同形态先例：
//   task-contract-check / suite-duration-exceed-check / instrument-decay-check 的 --no-block 接线。
//
// 读侧 (gap-coverage-nonblock-ledger-has-no-consumer): `--no-block` 把代价从「过高」改成了「为零」——
//   ledger 建好、写入、可审计，但**零读者**：套件日志里那行 NON-BLOCKING 会滚走，台账没人打开
//   ⇒ 「有人报过」与「没人报过」在任何会被读的记录上同形（硬规则 9：可见性 ≠ 执行）。同一次 --no-block
//   下 run_checker 按 exit 0 把 cost 行记成 `verdict:"pass"`，所以**取值轴只**剩这份台账。
//   `readNonBlockLedger()`（本文件）把它变成一条**三态**读数，由 manager tick 每轮报出（reader =
//   `manager-tick-readings.ts` 的 `gate_event_coverage_nonblock.*` 行，落点是每轮会被处置的面）。
//   **处置（处置 ≠ 手维护豁免 id 表）是推导出来的**：条目已处置 ⇔ 载体里已有同任务的
//   `gate:"complete"`+`pass` 事件、且其 ts ≥ 该条目自己的记账时刻 `at`。
//   为什么 `at` 是正确的下界：写侧**只在**「当时该任务没有 ≥ flip 时刻的 complete 事件（60s 容差）」
//   时才记这一条（否则它会被算成 covered 而不入 ledger）⇒ 任何满足 ts ≥ at 的事件必然是**事后补上**
//   的，即缺口已被填补。（裁定同理：只接受落进载体的带理由事件，⛔ 不接受代码里的 id 白名单。）
//   **三态（硬规则 3b）**：台账**缺席**不是「零未处置」——写侧把缺席当作「尚无条目」（它做的是去重读），
//   读侧不行：「没有人报过」与「报过且都处置了」正是这份读者存在的理由。同理，gate-events 载体读不到
//   ⇒ 处置不可判 ⇒ NOT-EVALUATED；台账存在但**全部**行不可解析 ⇒ 读不懂，也不与空台账同形。
//
// Exit codes: 0 = PASS（窗口内每个非豁免日覆盖率 ≥ 阈值）;
//             1 = RED（至少一个非豁免日覆盖率 < 阈值）—— 仅默认模式;
//             2 = usage/environment error;
//             3 = NOT-EVALUATED（载体/git/落地读数不可得）—— --no-block 下**照旧** exit 3;
//             0 = RED 且 --no-block（取值 RED、阻断关闭；已打印 + 已记账）.
//
// Usage:
//   node --experimental-strip-types gate-event-coverage-check.ts [--root <dir>] [--merge-target <ref>]
//     [--days <N> | --all | --since <ISO> --until <ISO>] [--threshold <pct>] [--json] [--gate] [--no-block]
//   --days N    最近 N 个**完整**日（UTC，不含今天；缺省 3）——静态门的常规窗口
//   --all       自载体最早一条 complete 事件起，逐日评估（取证/复核用；在修复前数据上必须报红）
//   --gate      静态门接线模式：只输出一行判定 + 失败明细（缺省非 gate 打印完整逐日表）
//   --no-block  RED 只报出 + 记账，不 exit 1（默认模式仍 fail-closed）
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

// ── --no-block grow-only ledger ─────────────────────────────────────────────────────────────────────
// (gap-coverage-miss-fail-closed-stops-code-landings, 对齐 task-contract-check 的 --no-block ledger.)
// 取值轴与阻断轴解耦后，RED 不再 exit 1 ⇒ 若只靠「套件日志里那行」承载取值，取值就退回**可滚动
// 丢失的屏显**（硬规则 9：可见性≠执行）。这份 ledger 是取值轴的**持久载体**：每条未覆盖落地一行，
// 纯追加、按 `day|task` 去重（同一缺口反复报出不会把它刷爆），best-effort（ledger I/O 失败不得把
// 一个**故意不阻断**的检查变红——同 task-contract-check:596 的纪律）。
export const NO_BLOCK_LEDGER_REL = ".quay/gate-event-coverage-nonblock-ledger.jsonl";

export interface NonBlockLedgerEntry {
  day: string;
  task: string;
  sha: string;
  coverage: number;
  threshold: number;
  at: string;
}

/**
 * Append this run's RED reading (every uncovered landing) to the grow-only ledger, deduped by
 * `day|task`. Pure append of NEW keys only (a re-run of the same gap records nothing new).
 * Returns the ledger path + the number of NEW entries written.
 */
export function recordNonBlockReport(
  root: string,
  report: CoverageReport,
  landings: Landing[],
  nowIso: string,
): { path: string; recorded: number } {
  const p = path.join(root, NO_BLOCK_LEDGER_REL);
  const shaByKey = new Map<string, string>();
  for (const l of landings) shaByKey.set(`${l.day}|${l.task}`, l.sha);
  const seen = new Set<string>();
  try {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as { day?: unknown; task?: unknown };
        if (typeof e.day === "string" && typeof e.task === "string") seen.add(`${e.day}|${e.task}`);
      } catch {
        continue; // 坏行：跳过单条，不让一行噪声把整份 ledger 判成不可读
      }
    }
  } catch {
    /* 载体缺席 ⇒ 尚无已记条目（⛔ 不是「读不懂」——新 ledger 首次运行时本就为空） */
  }
  const fresh: NonBlockLedgerEntry[] = [];
  for (const d of report.days) {
    for (const task of d.uncovered) {
      const key = `${d.day}|${task}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({
        day: d.day,
        task,
        sha: shaByKey.get(key) ?? "",
        coverage: d.coverage,
        threshold: report.threshold,
        at: nowIso,
      });
    }
  }
  if (fresh.length) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${fresh.map((e) => JSON.stringify(e)).join("\n")}\n`);
  }
  return { path: p, recorded: fresh.length };
}

// ── Reading side: the consumer of the --no-block ledger ─────────────────────────────────────────────
// (gap-coverage-nonblock-ledger-has-no-consumer —— 本文件头注释「读侧」一段是这段代码的正本.)
// 这份文件此前只有写者：`recordNonBlockReport` 往 ledger 里写，**没有任何东西读它**。下面这个函数
// 把台账变成一条**三态**读数；消费方是 `manager-tick-readings.ts`（每轮 manager tick 报到处置面）。

/** 台账载体的读取状态。⛔ `absent`/`unreadable` 不得与「读过且零未处置」共用一个取值（硬规则 3b）。 */
export type LedgerCarrierState = "read" | "absent" | "unreadable";

export interface NonBlockLedgerReading {
  /** false ⇒ 本条读数**不携带可用取值**（⛔ 绝不等价于「0 条未处置」）。 */
  evaluated: boolean;
  carrier: LedgerCarrierState;
  /** `null` ⇔ `!evaluated` —— ⛔ 不是 `[]`：空数组会被读成「查过且干净」。 */
  unresolved: NonBlockLedgerEntry[] | null;
  /** 已处置条目数（同任务已有 ts ≥ 该条目 `at` 的 complete+pass 事件）。 */
  disposed: number;
  entries: number;
  malformedLines: number;
  reason: string;
  ledger: string;
  eventsCarrier: string;
}

/**
 * Read the `--no-block` ledger and judge each entry's DISPOSITION. PURE w.r.t. its inputs (reads two
 * files, writes nothing). Three states, never collapsed (硬规则 3b):
 *   - ledger absent            ⇒ `evaluated:false, carrier:"absent"`     （⛔ 不是「零未处置」）
 *   - ledger present, all bad  ⇒ `evaluated:false, carrier:"unreadable"`
 *   - gate-events unreadable   ⇒ `evaluated:false`（处置不可判）
 *   - otherwise                ⇒ `evaluated:true` + `unresolved` 清单
 * DISPOSITION is derived, never a hand-maintained id table: an entry is disposed ⇔ the gate-events
 * carrier holds a `complete`+`pass` event for the same task with ts ≥ the entry's own `at`. `at` is
 * the correct floor because the writer records an entry ONLY when no such event existed at that
 * moment — so any event at/after `at` necessarily appeared afterwards (i.e. the gap was filled).
 * An entry with an unparseable/absent `at` cannot be shown disposed ⇒ it stays in `unresolved`
 * (the safe direction: a visible stale entry costs noise, a silently-dropped one re-opens the hole).
 */
export function readNonBlockLedger(root: string): NonBlockLedgerReading {
  const ledger = path.join(root, NO_BLOCK_LEDGER_REL);
  const eventsCarrier = path.join(root, ".quay", "gate-events.jsonl");
  const base = { unresolved: null, disposed: 0, entries: 0, malformedLines: 0, ledger, eventsCarrier };
  let raw: string;
  try {
    raw = fs.readFileSync(ledger, "utf8");
  } catch {
    return {
      ...base,
      evaluated: false,
      carrier: "absent",
      reason: `NOT-EVALUATED: --no-block 台账载体缺席（${ledger}）——「没有人报过」⛔ 不与「报过且都处置了」同形`,
    };
  }

  const entries: NonBlockLedgerEntry[] = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e: Partial<NonBlockLedgerEntry>;
    try {
      e = JSON.parse(line) as Partial<NonBlockLedgerEntry>;
    } catch {
      malformed++;
      continue;
    }
    if (typeof e?.day !== "string" || typeof e?.task !== "string") {
      malformed++;
      continue;
    }
    entries.push({
      day: e.day,
      task: e.task,
      sha: typeof e.sha === "string" ? e.sha : "",
      coverage: typeof e.coverage === "number" ? e.coverage : NaN,
      threshold: typeof e.threshold === "number" ? e.threshold : NaN,
      at: typeof e.at === "string" ? e.at : "",
    });
  }
  if (entries.length === 0 && malformed > 0) {
    return {
      ...base,
      evaluated: false,
      carrier: "unreadable",
      malformedLines: malformed,
      reason: `NOT-EVALUATED: 台账存在但 ${malformed} 行全部不可解析（读不懂 ⛔ 不等于零未处置）`,
    };
  }

  const events = readCompleteEvents(eventsCarrier);
  if (events === null) {
    return {
      ...base,
      evaluated: false,
      carrier: "read",
      entries: entries.length,
      malformedLines: malformed,
      reason: `NOT-EVALUATED: 载体读不到（${eventsCarrier}）⇒ 无法判「已处置」，⛔ 不与「零未处置」同形`,
    };
  }

  const unresolved: NonBlockLedgerEntry[] = [];
  let disposed = 0;
  for (const e of entries) {
    const floor = Date.parse(e.at);
    const hit = Number.isFinite(floor) && events.some((ev) => ev.task === e.task && Date.parse(ev.ts) >= floor);
    if (hit) disposed++;
    else unresolved.push(e);
  }
  return {
    evaluated: true,
    carrier: "read",
    unresolved,
    disposed,
    entries: entries.length,
    malformedLines: malformed,
    reason: unresolved.length
      ? `${unresolved.length} 条未处置（已处置 ${disposed}/${entries.length}）`
      : `零未处置（${disposed}/${entries.length} 条均已处置）`,
    ledger,
    eventsCarrier,
  };
}

/** Human-readable form of a ledger reading (⚠️ `not-evaluated` 有独立一行，⛔ 不打印成 0). */
export function formatNonBlockLedger(r: NonBlockLedgerReading): string {
  if (!r.evaluated) return `${r.reason}\n  carrier=${r.carrier} ledger=${r.ledger}`;
  const head = `gate-event-coverage-nonblock ledger — ${r.ledger}`;
  const body = `entries=${r.entries} disposed=${r.disposed} unresolved=${r.unresolved!.length} malformed_lines=${r.malformedLines}`;
  const detail = r.unresolved!.map(
    (e) =>
      `  UNRESOLVED ${e.day} ${e.task} — coverage ${Number.isFinite(e.coverage) ? `${e.coverage * 100 < 100 ? (e.coverage * 100).toFixed(0) : "100"}` : "?"}% < ${Number.isFinite(e.threshold) ? e.threshold : "?"}% · sha=${e.sha || "(none)"} · recorded ${e.at || "(no at)"}`,
  );
  return [head, body, ...detail].join("\n");
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
      "  --no-block              RED 只报出 + 记账（grow-only ledger），不 exit 1；默认仍 fail-closed\n" +
      "  --ledger                读侧模式：读 --no-block 台账并判每条目的处置态（三态；不跑覆盖率判据）\n" +
      "exit 0=PASS · 1=RED（仅默认模式）· 2=usage · 3=NOT-EVALUATED（载体/git/落地读数不可得）\n" +
      "  --no-block 下 RED ⇒ exit 0（取值 RED、阻断关闭；判定行照打 + 落 ledger）\n" +
      "  --ledger 下：0=读到（未处置数见输出）· 3=未评估（台账缺席/不可解析 · gate-events 读不到）",
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
  // --no-block: 取值轴保留（RED 照报 + 记账），阻断轴关闭（RED 不 exit 1）。默认 fail-closed 不变。
  const noBlock = args.includes("--no-block");
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  // --ledger: 读侧模式 —— 只读台账、判处置态，⛔ 不跑覆盖率判据、不写任何东西。它存在的理由是让
  // 「台账有没有人读」这件事本身可被一条命令取到读数（AC2/AC3 取证 + manager 面之外的手工复核）。
  if (args.includes("--ledger")) {
    const reading = readNonBlockLedger(root);
    console.log(json ? JSON.stringify(reading, null, 2) : formatNonBlockLedger(reading));
    return reading.evaluated ? 0 : 3;
  }
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

  // --no-block 且 RED ⇒ 先把取值落 ledger（持久载体），再决定阻断。ledger 写入是 best-effort：
  // I/O 失败只告警，⛔ 绝不把一个有意不阻断的检查变成红（同 task-contract-check finish()）。
  let ledger: { path: string; recorded: number } | null = null;
  if (noBlock && report.verdict === "red") {
    try {
      ledger = recordNonBlockReport(root, report, landings, new Date().toISOString());
    } catch (e) {
      console.error(`gate-event-coverage-check: ledger write failed (non-blocking, ignored): ${(e as Error)?.message ?? e}`);
    }
  }
  const blocked = report.verdict === "red" && !noBlock;

  if (json) {
    // 取值轴（verdict/days/…）与阻断轴（noBlock/blocked）分列，消费方可各自读；ledger 是取值载体。
    console.log(JSON.stringify({ ...report, noBlock, blocked, ledger }, null, 2));
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
    if (noBlock && report.verdict === "red") printNonBlockLine(ledger);
  } else {
    console.log(`${report.verdict.toUpperCase()}: ${report.reason}`);
    for (const d of report.days) {
      if (d.uncovered.length) console.log(`  UNCOVERED ${d.day} (${(d.coverage * 100).toFixed(0)}%): ${d.uncovered.join(", ")}`);
    }
    for (const d of report.days) {
      if (d.exempt.length) console.log(`  EXEMPT ${d.day} (bootstrap, < ${report.bootstrapCutoff}): ${d.exempt.join(", ")}`);
    }
    if (noBlock && report.verdict === "red") printNonBlockLine(ledger);
  }

  if (report.verdict === "red") return blocked ? 1 : 0;
  return report.verdict === "not-evaluated" ? 3 : 0;
}

/** --no-block 的显式、可搜索标记行：取值 RED 已报出 + 已记账，但**不**阻断当轮（硬规则 3b：
 *  与「闸坏了」exit 3 的 NOT-EVALUATED 不同形，也与 PASS 的静默不同形）。 */
function printNonBlockLine(ledger: { path: string; recorded: number } | null): void {
  const rec = ledger ? `recorded ${ledger.recorded} new entry(s) → ${ledger.path}` : "ledger unavailable (write failed — see stderr)";
  console.log(`NON-BLOCKING (--no-block): verdict RED is reported + ${rec}; blocking is OFF for this round. The RED is a PREVIOUS-day landing-coverage fact, unrelated to the current delta; the DEFAULT mode still exits 1.`);
}

// expectedBase 是**必填**的（见 gate-script-base.ts —— 裸 isDirectEntry(import.meta) 在 bundled
// 形态下会让被内联的库也执行自己的 main，实测 2026-09-13 三个 driver 全跑成 pool-quality-judge）。
if (isDirectEntry(import.meta, process.argv[1], "gate-event-coverage-check")) {
  process.exitCode = await main();
}
