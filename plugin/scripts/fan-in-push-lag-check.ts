// fan-in-push-lag-check.ts — 机械检测「本地 <branch> 领先 origin/<branch> 且领先已持续超过阈值」
// 并当轮机械重试 push；重试不可解（真 non-fast-forward）⇒ 移交既有的语义同步兜底。
//
// ── 它回答什么问题（GAP）────────────────────────────────────────────────────────────────────────
// `gap-fan-in-push-silently-fails-no-detection`：worker-driver 在主检出跑完机械 fan-in（本地
// `develop` 真实前进、ff-merge 成功、任务 status 翻 done），**但 develop → origin/develop 的 push
// 从来没有发生在这条路径上**（`packages/quay/src/fan-in/ff-merge.ts` 只做 `git push . task/X:develop`
// ——本地 ref 更新；`worker-driver.ts` 的 `runMechanicalFanIn` 全段零 push）。于是「任务 done」与
// 「代码到达远端共享仓库」完全脱钩，记录上与「一切正常」同形。
//
// 实测发生率 2（2026-09-16 / 2026-09-17），两次都是人/偶然核实发现，没有任何机制报出来：
//   事故 1 — 两个任务的 fan-in 结果本地领先 origin 16 提交，从未推送（另一个并行会话的直接 push
//            抢先把 origin/develop 推到一个不含这两处改动的点）。
//   事故 2 — `gap-dev-stats-collect-from-production-carriers` 标 done、脚本确实以两条真实提交存在于
//            **本地** develop，却没到 origin/develop；靠 GOAL-021 的 AC-277 判据连续两轮 fail 被一个
//            为**别的问题**设计的 Monitor 间接暴露。
//
// ⛔ 与 `gap-doc-develop-sync-semantic-conflict-resolution`（done）的分工：那条管【author↔develop】
// 分叉后怎么融（doc 侧落后 / 语义合并）；本条管【更前置的一层】——push 这个动作本身悄悄失败/从未
// 发生时，谁来报。落地后者的机制（ledger + 语义兜底）在本条里【被复用，⛔ 不重新发明】。
//
// ── 判据形态（硬规则 3b：枚举，不与「合格」同形）─────────────────────────────────────────────────
// 读数 verdict ∈ in-sync | within-threshold | lagging | pushed | escalated | not-evaluated。
// `not-evaluated` 是**独立取值**：git 读失败（非 git 仓 / 分支不存在 / remote 不存在）不得落进
// 「in-sync」（那正是本缺陷要消除的形态——「读不出」伪装成「合格」）。退出码同构：
//   0 = 无滞后（in-sync / within-threshold / pushed）
//   1 = 滞后仍未被解决（lagging / escalated）
//   2 = 用法 / 环境错误
//   3 = not-evaluated（判定所需的 git 读失败）
//
// **upsync（推）与 alarm（报）是两件事，年龄门只加在后者上**——见 runPushLagCheck 的 docblock。
//
// ── 为什么挂 worker-driver 的常驻轮（⛔ 不新造循环）──────────────────────────────────────────────
// 唯一真的会「做 fan-in」的常驻进程就是 worker-driver（主检出、每轮 pass），所以检测/重试挂在它
// 的每轮 pass 上（同族：liveness / reconcile / reclaim-superseded 三步），而不是新开一个驱动 kind
// 或依赖已退役的 tick 心跳（`plugin/loop/fast-mode-tick-core.md` A17 的 `sync-lag-check.sh --push`
// 属【已退役的两层 tick】，生产上没有执行者）。挂点见 worker-driver.ts 的 `step = "push-lag"`。
//
// ── 阈值不得凭空定（AC4 / 硬规则 4 推论二）──────────────────────────────────────────────────────
// 见 resolvePushLagThresholdMs 与其上的实测数据块。

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import YAML from "yaml";
import { isDirectEntry } from "./gate-script-base.ts";
import { writeDocDevelopSyncEvent } from "./driver-filters.ts";
import { resolveKernelShellSibling } from "./driver-runtime.ts";

/** 滞后事件载体（追加式 JSONL；gitignored 运行时日志，worker-outcome.jsonl 同族）。 */
export const PUSH_LAG_EVENT_REL = path.posix.join(".quay", "fan-in-push-lag.jsonl");

/** 告警阈值 = 本常数 × driver 自己的轮间隔（`--round-interval-ms`，生产传 driver 的 reconcileMs）。
 *  ⛔ 不是写死的毫秒字面量：轮间隔是 host/config 派生的量（硬规则 4 推论二），阈值跟着它走。
 *
 *  **12 的实测依据（2026-09-17 于本仓库 `.quay/worker-round.jsonl` 读数，19394 轮）**：
 *    pass 间隔 p50 = 0.6 min / p75 = 3.3 min / **p95 = 5.1 min** / p99 = 7.5 min / max = 141 min。
 *  领先窗口的正常寿命 = 【本轮机械重试当轮推掉】⇒ 远小于一个 pass 间隔。取 12：等于 12 × p95 ≈ 61 min，
 *  也等于 12 × driver 默认轮间隔（reconcileMs 300s = 5 min）。一个领先能扛过 12 个 pass 而每次重试都
 *  推不上去 ⇒ 结构性失败（真 non-fast-forward / 远端不可达 / 凭据失效），不是瞬时抖动——此时报出来
 *  的误报率最低，而事故 1/2 的领先窗口都在小时量级，12 轮的上界（≈61 min）远早于它们被发现的时间。 */
export const PUSH_LAG_ROUNDS_BEFORE_ALARM = 12;

/** driver 的默认轮间隔（ms）——与 worker-driver.ts 的 `--reconcile-interval` 缺省同源（300s）。
 *  只在调用方未传 `--round-interval-ms` 时兜底；生产由 worker-driver 传自己的真值。 */
export const DEFAULT_ROUND_INTERVAL_MS = 300_000;

/** 判定取值（枚举，⛔ 不与「合格」共用取值——硬规则 3b）。语义见 runPushLagCheck 的 docblock。 */
export type PushLagVerdict =
  | "in-sync"          // 领先数 = 0（基线）
  | "within-threshold" // 有领先但本轮没推掉，且最老一条仍在阈值内 ⇒ 正常的瞬时窗口，⛔ 不报警
  | "lagging"          // 有领先、本轮没推掉、且已超阈值 ⇒ **本检测器要报的状态**
  | "pushed"           // 有领先，本轮 upsync 把它推掉了（已解决）
  | "escalated"        // fetch 后仍是真 non-fast-forward ⇒ 已移交既有语义同步兜底
  | "not-evaluated";   // 判定所需的 git 读失败（⛔ 不是 in-sync）

/** 一条领先提交的 (sha, committer 时间)。 */
export interface AheadCommit {
  sha: string;
  epochMs: number;
}

/** 一次滞后测量（纯读数，⛔ 不包含任何动作）。 */
export interface PushLagReading {
  branch: string;
  remote: string;
  /** `<remote>/<branch>..<branch>` 的提交数（本地独有）。读失败 ⇒ null（⛔ 不是 0）。 */
  ahead: number | null;
  /** `<branch>..<remote>/<branch>` 的提交数（远端独有）。读失败 ⇒ null。 */
  behind: number | null;
  /** 领先集合里 committer 时间**最老**的一条（AC1 三字段之一）。无领先 ⇒ null。 */
  oldestAheadSha: string | null;
  oldestAheadEpochMs: number | null;
  /** now - oldestAheadEpochMs（领先时长，ms）。无领先 / 读失败 ⇒ null。 */
  lagMs: number | null;
  thresholdMs: number;
  /** 阈值来源（`env` / `config:<path>` / `default:<rounds>x<roundIntervalMs>ms`）——读不出来源
   *  的阈值与「有人配过」同形，故它是一个显式字段（硬规则 3b）。 */
  thresholdSource: string;
  /** ahead > 0 ∧ behind > 0：两侧各有对方没有的提交 ⇒ push 永远不可能成功（真分歧）。 */
  diverged: boolean;
  verdict: PushLagVerdict;
  /** verdict = not-evaluated 时的具体读失败原因（⛔ 不只留 verdict，否则「为什么没判出来」不可归因）。 */
  reason: string | null;
}

/** 一次完整判定（测量 + 重试 + 移交）的结论。 */
export interface PushLagOutcome {
  verdict: PushLagVerdict;
  /** 判定开始时的读数（重试前的现场，⛔ 不被重试后的读数覆盖——事故复盘要的是当时那一份）。 */
  reading: PushLagReading;
  /** 判定【开始时】这条领先是否已超过阈值。与 `verdict` 分开：一个「已超阈值但本轮被推掉」的领先
   *  与「刚发生、本轮被推掉」的领先，verdict 都是 `pushed`，但前者说明推送曾停摆过一个阈值以上
   *  （事故信号），后者是正常节奏。⛔ 不用 verdict 一个字面量承担这两层信息（硬规则 3b）。 */
  laggingAtMeasure: boolean;
  /** 重试后的读数（未发生重试 ⇒ null，⛔ 不用测量值冒充）。 */
  afterRetry: PushLagReading | null;
  /** 机械重试的取值（枚举，⛔ 不是布尔）。未发生重试 ⇒ null。 */
  retry: RetryVerdict | null;
  /** 载体路径（写了事件才有；未 lagging ⇒ null）。 */
  eventFile: string | null;
  reason: string | null;
}

/** 机械重试的取值（枚举 —— 「没试」「推上去了」「推不动」必须可区分）。 */
export type RetryVerdict =
  | "pushed"           // fetch 后是纯领先（behind=0）⇒ push 成功，且 push 后 ahead=0
  | "resolved-by-fetch" // fetch 后发现其实不领先（陈旧 remote-tracking ref 造成的假领先）
  | "non-ff-escalate"  // fetch 后仍是真分歧 / push 被拒 ⇒ 重试不可解
  | "error"            // git 命令本身失败（网络 / 凭据 / 非 git 仓）
  | "not-attempted";   // 未发生（调用方 --measure-only，或初始 verdict 非 lagging）

// ── git 薄封装 ─────────────────────────────────────────────────────────────────────────────────────

interface GitResult { ok: boolean; stdout: string; stderr: string; status: number | null }

/** 跑一条 git（⛔ 不抛；调用方按 ok 分流，读不懂 ≠ 空）。 */
export function gitRun(root: string, args: string[]): GitResult {
  try {
    const stdout = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout ?? "", stderr: "", status: 0 };
  } catch (e) {
    const err = e as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number | null };
    return {
      ok: false,
      stdout: String(err?.stdout ?? ""),
      stderr: String(err?.stderr ?? "").trim(),
      status: typeof err?.status === "number" ? err.status : null,
    };
  }
}

/** `<remote>/<branch>` 这个 remote-tracking ref 是否可解析。 */
function hasRemoteRef(root: string, remote: string, branch: string): boolean {
  return gitRun(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`]).ok;
}

/** 读 `<fromRef>..<toRef>` 的提交数。读失败 ⇒ null（⛔ 硬规则 6：读失败不得伪装成 0）。 */
export function revCount(root: string, fromRef: string, toRef: string): number | null {
  const r = gitRun(root, ["rev-list", "--count", `${fromRef}..${toRef}`]);
  if (!r.ok) return null;
  const n = Number(r.stdout.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** `<fromRef>..<toRef>` 的领先提交集合（sha + committer epoch-ms）。读失败 ⇒ null。 */
export function readAheadCommits(root: string, fromRef: string, toRef: string): AheadCommit[] | null {
  // `%ct` = committer date, unix ts（AC1 要的是 committer date，⛔ 不是 author date；两者在 rebase /
  // cherry-pick 后不同，而「这批提交什么时候到这里」是 committer 语义）。
  const r = gitRun(root, ["log", "--format=%H %ct", `${fromRef}..${toRef}`]);
  if (!r.ok) return null;
  const out: AheadCommit[] = [];
  for (const line of r.stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const [sha, ct] = t.split(/\s+/);
    const secs = Number(ct);
    if (!sha || !Number.isInteger(secs)) return null; // 形状读不懂 ⇒ null（⛔ 不跳过该行当没看见）
    out.push({ sha, epochMs: secs * 1000 });
  }
  return out;
}

/** 领先集合里 committer 时间**最老**的一条。集合为空 ⇒ null。 */
export function oldestAheadCommit(commits: readonly AheadCommit[]): AheadCommit | null {
  let best: AheadCommit | null = null;
  for (const c of commits) if (best === null || c.epochMs < best.epochMs) best = c;
  return best;
}

// ── 阈值解析（AC4）─────────────────────────────────────────────────────────────────────────────────

/** 阈值 + 它的来源。source 是人可读的出处串（env 名 / 配置文件:键 / 派生式）。 */
export interface PushLagThreshold { ms: number; source: string }

/** 从 `.quay/config.yml` 的 `loop.push_lag_threshold_ms` 读阈值。
 *  文件缺失 / `loop:` 节缺失 / 该键缺失 ⇒ null（本节可选，同 suite-params 的契约）。
 *  YAML 坏 / 该键值非法 ⇒ **不抛**，返回 `{ error }` —— 调用方（常驻 driver 每轮 pass）必须能
 *  区分「没配」与「配坏了」并落痕，⛔ 不能因为一个可调旋钮读坏了就每轮抛错写 error round。 */
export function readPushLagThresholdFromConfig(workspaceRoot: string): { ms: number } | { error: string } | null {
  const configPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) return null;
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return { error: `config.yml is malformed YAML — ${(e as Error).message}` };
  }
  const loop = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === undefined || loop === null || typeof loop !== "object" || Array.isArray(loop)) return null;
  const raw = (loop as Record<string, unknown>).push_lag_threshold_ms;
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { error: `config.yml loop.push_lag_threshold_ms must be a positive integer ms (got ${JSON.stringify(raw)})` };
  }
  return { ms: n };
}

/** 解析告警阈值（AC4：⛔ 不写死字面量，且出处可读）。优先级：
 *    ① env `QUAY_PUSH_LAG_THRESHOLD_MS`（逐次覆盖 / 测试缝）
 *    ② `.quay/config.yml` `loop.push_lag_threshold_ms`（逐工作区旋钮）
 *    ③ 派生缺省 = PUSH_LAG_ROUNDS_BEFORE_ALARM × roundIntervalMs（host/config 派生，⛔ 非字面量）
 *  任一来源非法 ⇒ **不静默回退**：跳过一个坏的 env 值去用 config 会让「配错了」与「没配」同形
 *  （硬规则 3b），故 env 非法直接记进 source 串。 */
export function resolvePushLagThresholdMs(opts: {
  root: string;
  roundIntervalMs?: number;
  env?: Record<string, string | undefined>;
}): PushLagThreshold {
  const env = opts.env ?? process.env;
  const roundIntervalMs = opts.roundIntervalMs && opts.roundIntervalMs > 0 ? opts.roundIntervalMs : DEFAULT_ROUND_INTERVAL_MS;
  const rawEnv = env.QUAY_PUSH_LAG_THRESHOLD_MS;
  if (rawEnv !== undefined && String(rawEnv).trim() !== "") {
    const n = Number(String(rawEnv).trim());
    if (Number.isInteger(n) && n > 0) return { ms: n, source: "env:QUAY_PUSH_LAG_THRESHOLD_MS" };
    return {
      ms: PUSH_LAG_ROUNDS_BEFORE_ALARM * roundIntervalMs,
      source: `default:${PUSH_LAG_ROUNDS_BEFORE_ALARM}x${roundIntervalMs}ms (env QUAY_PUSH_LAG_THRESHOLD_MS was IGNORED as invalid: ${rawEnv})`,
    };
  }
  const cfg = readPushLagThresholdFromConfig(opts.root);
  if (cfg && "ms" in cfg) return { ms: cfg.ms, source: "config:.quay/config.yml loop.push_lag_threshold_ms" };
  const suffix = cfg && "error" in cfg
    ? ` (config IGNORED: ${cfg.error})`
    : "";
  return {
    ms: PUSH_LAG_ROUNDS_BEFORE_ALARM * roundIntervalMs,
    source: `default:${PUSH_LAG_ROUNDS_BEFORE_ALARM}x${roundIntervalMs}ms${suffix}`,
  };
}

// ── 测量 ───────────────────────────────────────────────────────────────────────────────────────────

/** 测量一次滞后（纯读数，⛔ 不改动任何 ref / 不 push）。 */
export function measurePushLag(opts: {
  root: string;
  branch: string;
  remote: string;
  thresholdMs: number;
  thresholdSource: string;
  nowMs?: number;
}): PushLagReading {
  const { root, branch, remote, thresholdMs, thresholdSource } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const base = { branch, remote, thresholdMs, thresholdSource };
  const fail = (reason: string): PushLagReading => ({
    ...base,
    ahead: null, behind: null, oldestAheadSha: null, oldestAheadEpochMs: null, lagMs: null,
    diverged: false, verdict: "not-evaluated", reason,
  });

  if (!gitRun(root, ["rev-parse", "--git-dir"]).ok) return fail(`not a git repo: ${root}`);
  if (!gitRun(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok) {
    return fail(`local branch not found: ${branch}`);
  }
  if (!hasRemoteRef(root, remote, branch)) {
    // 首次发布（远端分支尚未建）：本地全部领先，且不存在「领先时长」可判——按 not-evaluated 报，
    // ⛔ 不报 in-sync（那会把「远端还没有这个分支」说成「已同步」，正是本缺陷的形态）。
    const remoteExists = gitRun(root, ["remote", "get-url", remote]).ok;
    return fail(remoteExists
      ? `remote-tracking ref refs/remotes/${remote}/${branch} does not exist (first publish?)`
      : `remote not found: ${remote}`);
  }

  const ahead = revCount(root, `refs/remotes/${remote}/${branch}`, `refs/heads/${branch}`);
  const behind = revCount(root, `refs/heads/${branch}`, `refs/remotes/${remote}/${branch}`);
  if (ahead === null || behind === null) return fail("rev-list --count failed");
  if (ahead === 0) {
    return { ...base, ahead, behind, oldestAheadSha: null, oldestAheadEpochMs: null, lagMs: null, diverged: false, verdict: "in-sync", reason: null };
  }
  const commits = readAheadCommits(root, `refs/remotes/${remote}/${branch}`, `refs/heads/${branch}`);
  if (commits === null) return fail("git log of the ahead set failed");
  const oldest = oldestAheadCommit(commits);
  if (oldest === null) return fail("ahead > 0 but the ahead commit set is empty (inconsistent read)");
  const lagMs = nowMs - oldest.epochMs;
  const diverged = behind > 0;
  return {
    ...base, ahead, behind,
    oldestAheadSha: oldest.sha, oldestAheadEpochMs: oldest.epochMs, lagMs, diverged,
    verdict: lagMs > thresholdMs ? "lagging" : "within-threshold",
    reason: null,
  };
}

// ── 机械重试（AC5）与移交（AC6）────────────────────────────────────────────────────────────────────

/** 机械重试 push：`git fetch` → 重测 → 纯领先则 push。
 *  ⛔ 不做 rebase / merge —— 那属于「合并策略」，本任务明令不重新发明（见文件头分工）；重试只覆盖
 *  「陈旧 remote-tracking ref 造成的假领先/假分歧」与「瞬时失败后 retry」两个可机械消解的形状。
 *  真分歧（fetch 后仍 behind > 0）⇒ 返回 non-ff-escalate，交既有语义同步兜底。 */
export function retryPush(root: string, opts: { branch: string; remote: string; thresholdMs: number; thresholdSource: string; nowMs?: number; pushScript?: string | null }): {
  verdict: RetryVerdict;
  reading: PushLagReading;
  detail: string | null;
} {
  const { branch, remote } = opts;
  const measure = () => measurePushLag({ root, branch, remote, thresholdMs: opts.thresholdMs, thresholdSource: opts.thresholdSource, nowMs: opts.nowMs });

  const fetched = gitRun(root, ["fetch", "--no-tags", remote, branch]);
  const before = measure();
  if (!fetched.ok) {
    return { verdict: "error", reading: before, detail: `git fetch ${remote} ${branch} failed: ${fetched.stderr || `exit ${fetched.status}`}` };
  }
  const afterFetch = measure();
  if (afterFetch.verdict === "not-evaluated") {
    return { verdict: "error", reading: afterFetch, detail: afterFetch.reason };
  }
  if (afterFetch.ahead === 0) {
    return { verdict: "resolved-by-fetch", reading: afterFetch, detail: "after fetch the branch no longer leads (stale remote-tracking ref)" };
  }
  if ((afterFetch.behind ?? 0) > 0) {
    return {
      verdict: "non-ff-escalate", reading: afterFetch,
      detail: `true divergence after fetch: ahead=${afterFetch.ahead} behind=${afterFetch.behind} — a push cannot succeed`,
    };
  }
  // ⛔ 本模块【不】另写一份 push：never-force 纪律（`--force` 在本仓一处都不存在）+ 成功后的跨机
  // verify 记录钩子都住在 `periodic-push-backup.sh` 这一个原语里，第二份实现就是漂移源，而且会让新
  // 路径静默丢掉那个钩子。`sync-lag-check.sh` 也是同一个委托形态（README 语义：它是 push 的唯一实现）。
  const push = pushOnce(root, { branch, remote, pushScript: opts.pushScript });
  if (push.verdict !== "ok") {
    // push 被拒（non-fast-forward / 远端不可达 / 凭据）——再测一次决定是「分歧」还是「纯失败」。
    const afterPush = measure();
    const divergedNow = (afterPush.behind ?? 0) > 0;
    return {
      verdict: divergedNow ? "non-ff-escalate" : "error",
      reading: afterPush,
      detail: push.detail,
    };
  }
  const afterPush = measure();
  if (afterPush.ahead !== 0) {
    return { verdict: "error", reading: afterPush, detail: `push reported success but ahead is still ${afterPush.ahead}` };
  }
  return { verdict: "pushed", reading: afterPush, detail: null };
}

/** 一次性 push 的结果（枚举 —— 「推上去了」「被拒（non-ff）」「跑不起来/别的错」必须可区分）。 */
export type PushOnceVerdict = "ok" | "rejected" | "unavailable";

/** 委托既有 push 原语（`periodic-push-backup.sh`，never-force 的单一实现）。
 *  退出码词表由那个脚本定义（0 成功/已最新，1 non-fast-forward 被拒，2 用法或其它失败）——本函数
 *  只做映射，⛔ 不重新解释 git 的 stderr。脚本本身解析不到 ⇒ `unavailable`（硬规则 3b：⛔ 不与
 *  「推成功」同形；调用方据此走 error 分支）。 */
export function pushOnce(root: string, opts: { branch: string; remote: string; pushScript?: string | null }): {
  verdict: PushOnceVerdict;
  detail: string | null;
  script: string | null;
} {
  let script = opts.pushScript ?? null;
  if (script === null) {
    try { script = resolveKernelShellSibling("periodic-push-backup.sh"); } catch { script = null; }
  }
  if (!script) {
    return { verdict: "unavailable", detail: "periodic-push-backup.sh not resolvable as a kernel shell sibling — no push attempted", script: null };
  }
  const r = spawnSync("bash", [script, "--root", root, "--branch", opts.branch, "--remote", opts.remote], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-4).join(" | ").slice(0, 400);
  if (r.status === 0) return { verdict: "ok", detail: null, script };
  if (r.status === 1) return { verdict: "rejected", detail: `push rejected (non-fast-forward): ${out}`, script };
  return { verdict: "unavailable", detail: `push script exit ${r.status}: ${out}`, script };
}

/** 追加一条滞后事件到载体（纯 I/O，create dir/file as needed）。 */
export function appendPushLagEvent(root: string, record: Record<string, unknown>): string {
  const file = path.join(root, PUSH_LAG_EVENT_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n", "utf8");
  return file;
}

/** 移交既有语义同步兜底（AC6）。**⛔ 不重新发明合并策略**：只做既有两个落点
 *  ① 往 `.quay/doc-develop-sync.jsonl`（`gap-doc-develop-sync-semantic-conflict-resolution` 的
 *     单一 ledger，writer = driver-filters.writeDocDevelopSyncEvent）追加一条 non-ff 升级事件
 *     —— 这是那条机制「周期核对 ⇒ 同步待办 ⇒ 机械 ⇒ 语义」链的**待办入口**（trigger 形态相同：
 *     一条带 ahead/behind 的待办记录，机械半（ff）在两侧都有独有提交时结构上不可能成功 ⇒ 直接落
 *     语义半）；
 *  ② 返回那个 ledger 的路径，供调用方落痕。
 *  返回值是可区分取值，⛔ 不是布尔。 */
export function escalateToSemanticSync(root: string, opts: {
  branch: string; remote: string; reading: PushLagReading; detail: string | null;
}): { ok: boolean; ledger: string | null; detail: string | null } {
  try {
    const ledger = writeDocDevelopSyncEvent(root, {
      event: "push-lag-non-ff-escalate",
      phase: "escalate",
      branch: opts.branch,
      remote: opts.remote,
      ahead: opts.reading.ahead,
      behind: opts.reading.behind,
      oldestAheadSha: opts.reading.oldestAheadSha,
      lagMs: opts.reading.lagMs,
      detail: opts.detail,
    });
    return { ok: true, ledger, detail: null };
  } catch (e) {
    return { ok: false, ledger: null, detail: (e as Error)?.message ?? "escalate write failed" };
  }
}

// ── 每轮 pass 的入口（worker-driver 挂点调这个）─────────────────────────────────────────────────────

/** 每轮 pass 的入口。**两件事被刻意分开**（这是本模块唯一容易做错的设计点）：
 *
 *  ① **upsync 无年龄门**：只要领先数 > 0 就当轮机械推送（fetch + push，⛔ 永不 force）。fan-in 的
 *     产物应该在一个 pass 内到达 origin——这才是事故本身的修法。若把 upsync 也压在「超阈值才推」
 *     的门后面，fan-in 结果会先躺最多一个阈值（默认 60 min）才上线，等于用一个新延迟换掉旧缺口。
 *  ② **告警有年龄门**：只有「领先已经扛过阈值**而推送仍未成功**」才报滞后。年轻的领先是正常的
 *     瞬时窗口（driver 下一轮就推掉了），报它就是噪音——AC2 的假阳性方向。
 *
 *  ⇒ 于是 verdict 的可区分取值是：
 *     in-sync         无领先
 *     pushed          有领先，本轮 upsync 把它推掉了（`laggingAtMeasure` 说明推掉之前是否已超阈值）
 *     within-threshold 有领先，本轮没推掉，但仍在阈值内 ⇒ ⛔ 不报警（下一轮重试）
 *     lagging         有领先，本轮没推掉，且已超阈值 ⇒ **报警**（结构性失败：远端不可达 / 凭据 / 被拒）
 *     escalated       fetch 后仍是真分歧 ⇒ 已移交既有语义同步兜底（**报警**）
 *     not-evaluated   判定所需的 git 读失败 ⇒ ⛔ 不当作 in-sync
 *
 *  落痕（appendPushLagEvent）只在**有信号**时发生：lagging / escalated / 「推掉之前已超阈值」。
 *  正常轮（in-sync / 年轻领先）不写载体 ⇒ AC2 的「不报警」在载体上也是可判的，而不只是 verdict 字面量。
 *
 *  `measureOnly` ⇒ 只测不动作（观测面 / 测试缝）：⛔ 不 fetch / 不 push / 不落痕。 */
export function runPushLagCheck(opts: {
  root: string;
  branch: string;
  remote: string;
  thresholdMs: number;
  thresholdSource: string;
  measureOnly?: boolean;
  /** push 原语覆盖（测试缝）；缺省 = resolveKernelShellSibling("periodic-push-backup.sh")。 */
  pushScript?: string | null;
  nowMs?: number;
}): PushLagOutcome {
  const { root, branch, remote, thresholdMs, thresholdSource } = opts;
  const reading = measurePushLag({ root, branch, remote, thresholdMs, thresholdSource, nowMs: opts.nowMs });
  const laggingAtMeasure = reading.verdict === "lagging";

  if (opts.measureOnly === true) {
    return { verdict: reading.verdict, reading, laggingAtMeasure, afterRetry: null, retry: "not-attempted", eventFile: null, reason: reading.reason };
  }
  if (reading.ahead === 0) {
    return { verdict: reading.verdict, reading, laggingAtMeasure, afterRetry: null, retry: null, eventFile: null, reason: reading.reason };
  }
  if (reading.verdict === "not-evaluated") {
    // 读不出「领先多少」⇒ ⛔ 不 fetch / 不 push（那会在不知道状态的情况下动远端引用）。
    return { verdict: reading.verdict, reading, laggingAtMeasure, afterRetry: null, retry: null, eventFile: null, reason: reading.reason };
  }

  const r = retryPush(root, { branch, remote, thresholdMs, thresholdSource, nowMs: opts.nowMs, pushScript: opts.pushScript });
  let verdict: PushLagVerdict;
  let reason: string | null = r.detail;
  let escalate: { ok: boolean; ledger: string | null; detail: string | null } | null = null;
  if (r.verdict === "pushed" || r.verdict === "resolved-by-fetch") {
    verdict = "pushed";
  } else if (r.verdict === "non-ff-escalate") {
    escalate = escalateToSemanticSync(root, { branch, remote, reading: r.reading, detail: r.detail });
    verdict = "escalated";
    if (!escalate.ok) reason = `${r.detail ?? "non-ff"} | escalate write FAILED: ${escalate.detail}`;
  } else {
    // upsync 本身失败（远端不可达 / 凭据 / 非 ff 但读不出 behind）：只有【已超阈值】才报警——
    // 年轻领先的推送失败是瞬时抖动，下一轮重试即可（⛔ 不粉饰成 escalated：那会谎称已移交）。
    verdict = laggingAtMeasure ? "lagging" : "within-threshold";
  }

  // 落痕只在【有信号】时：报警态（lagging / escalated），或「推掉之前已超阈值」（曾停摆一个阈值
  // 以上、本轮才清掉——事故信号）。正常节奏（年轻领先被当轮推掉、无领先）⛔ 不写载体，否则载体被
  // 每轮的正常节奏刷满，「有记录」就不再等于「出过事」（AC2 的载体面判据正在此处）。
  const worthRecording = verdict === "lagging" || verdict === "escalated" || (verdict === "pushed" && laggingAtMeasure);
  const afterRetry = r.reading && r.reading !== reading
    ? { ahead: r.reading.ahead, behind: r.reading.behind }
    : null;
  const eventFile = worthRecording
    ? appendPushLagEvent(root, {
        event: "push-lag",
        verdict,
        branch, remote,
        ahead: reading.ahead, behind: reading.behind,
        oldestAheadSha: reading.oldestAheadSha,
        oldestAheadEpochMs: reading.oldestAheadEpochMs,
        lagMs: reading.lagMs,
        thresholdMs, thresholdSource,
        laggingAtMeasure,
        retry: r.verdict,
        afterRetry,
        escalated: escalate ? { ok: escalate.ok, ledger: escalate.ledger } : null,
        reason,
      })
    : null;
  return { verdict, reading, laggingAtMeasure, afterRetry: r.reading, retry: r.verdict, eventFile, reason };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = `用法: node --experimental-strip-types fan-in-push-lag-check.ts [--root <dir>] [--branch <b>]
         [--remote <name>] [--round-interval-ms <n>] [--measure-only] [--json]

  检测本地 <branch> 领先 <remote>/<branch> 且领先时长超过阈值（默认 12 × round-interval-ms），
  超过则机械重试 push；重试不可解（真 non-fast-forward）⇒ 移交既有语义同步兜底。

  --root                仓库根（默认 cwd）
  --branch              被检测分支（默认 develop）
  --remote              远端名（默认 origin）
  --round-interval-ms   driver 轮间隔（默认 300000）——阈值的派生基数
  --measure-only        只测量，⛔ 不 fetch / 不 push / 不写事件
  --json                结构化输出（stdout 一行 JSON）

退出码: 0 无滞后或已解决 | 1 滞后仍未解决 | 2 用法/环境错误 | 3 not-evaluated`;

interface Cli { root: string; branch: string; remote: string; roundIntervalMs: number; measureOnly: boolean; json: boolean }

function parseCli(argv: string[]): Cli | { error: string } {
  const c: Cli = { root: process.cwd(), branch: "develop", remote: "origin", roundIntervalMs: DEFAULT_ROUND_INTERVAL_MS, measureOnly: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string | null => (i + 1 < argv.length ? argv[++i] : null);
    if (a === "--root") { const v = next(); if (!v) return { error: "--root needs a value" }; c.root = v; }
    else if (a === "--branch") { const v = next(); if (!v) return { error: "--branch needs a value" }; c.branch = v; }
    else if (a === "--remote") { const v = next(); if (!v) return { error: "--remote needs a value" }; c.remote = v; }
    else if (a === "--round-interval-ms") {
      const v = next(); const n = Number(v);
      if (v === null || !Number.isInteger(n) || n <= 0) return { error: `--round-interval-ms needs a positive integer (got ${v})` };
      c.roundIntervalMs = n;
    }
    else if (a === "--measure-only") c.measureOnly = true;
    else if (a === "--json") c.json = true;
    else if (a === "--help" || a === "-h") { process.stdout.write(USAGE + "\n"); process.exit(0); }
    else return { error: `unknown argument: ${a}` };
  }
  return c;
}

/** 退出码词汇表（⛔ 三段共用一套，见文件头）。 */
export function exitCodeFor(verdict: PushLagVerdict): number {
  if (verdict === "not-evaluated") return 3;
  if (verdict === "lagging") return 1;
  return 0; // in-sync | within-threshold | pushed | escalated
}

export function main(argv: string[]): number {
  const parsed = parseCli(argv);
  if ("error" in parsed) {
    process.stderr.write(`fan-in-push-lag-check: ${parsed.error}\n`);
    return 2;
  }
  const c = parsed;
  const th = resolvePushLagThresholdMs({ root: c.root, roundIntervalMs: c.roundIntervalMs });
  const outcome = runPushLagCheck({
    root: c.root, branch: c.branch, remote: c.remote,
    thresholdMs: th.ms, thresholdSource: th.source, measureOnly: c.measureOnly,
  });
  const r = outcome.reading;
  if (c.json) {
    process.stdout.write(JSON.stringify({
      verdict: outcome.verdict,
      branch: r.branch, remote: r.remote,
      ahead: r.ahead, behind: r.behind,
      oldestAheadSha: r.oldestAheadSha,
      oldestAheadEpochMs: r.oldestAheadEpochMs,
      lagMs: r.lagMs,
      thresholdMs: r.thresholdMs, thresholdSource: r.thresholdSource,
      diverged: r.diverged,
      retry: outcome.retry,
      eventFile: outcome.eventFile,
      reason: outcome.reason ?? r.reason,
    }) + "\n");
  } else {
    // 逐字段打印（⛔ 不打印单一布尔）：ahead / behind / 最老领先 sha / 领先时长 / 阈值 / 出处 / 重试。
    process.stdout.write(
      `fan-in-push-lag-check: ${outcome.verdict} branch=${r.branch} remote=${r.remote} ` +
      `ahead=${r.ahead} behind=${r.behind} oldest=${r.oldestAheadSha ?? "none"} ` +
      `lagMs=${r.lagMs ?? "none"} thresholdMs=${r.thresholdMs} (${r.thresholdSource}) ` +
      `retry=${outcome.retry ?? "none"}${outcome.reason ? ` reason=${outcome.reason}` : ""}\n`,
    );
    if (outcome.eventFile) process.stdout.write(`fan-in-push-lag-check: event appended: ${outcome.eventFile}\n`);
  }
  return exitCodeFor(outcome.verdict);
}

if (isDirectEntry(import.meta, process.argv[1], "fan-in-push-lag-check")) {
  process.exit(main(process.argv));
}
