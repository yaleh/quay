#!/usr/bin/env node
// manager-liveness-independent-check.ts — manager 自身活性的独立兜底（不经过 manager）
// (tasks/gap-ac147-manager-liveness-independent-channel)
//
// Defect family (Proposal): 取消两层后只剩人看 manager。三层互看时代「谁失能谁被上一层发现」的
// 冗余在 manager 之后消失——manager 阻塞（交互阻塞/心跳停/进程死）时 driver 仍在跑（机械派发不受
// 影响），但语义工作停摆、无人察觉，直到人主动去看。这就是「看门人」缺口。
//
// 本质：用【层间冗余】换【机制连续性】，需要一个【不经过 manager】的机制在 manager 失能超阈值 T
// 时让人知道。⛔ 不要求自动解除阻塞（代答越界），只要求让人知道。
//
// 本脚本就是那个独立通道：它只读 manager 的心跳产物（`orchestration/manager-tick-log.md` 的 mtime，
// 或一个显式的心跳文件 `{ts}`），从不经过 manager 自己——被计量对象不写它、不读它、也不以任何方式
// 参与判定（硬规则 4b：一个由被测对象自己产生的量，不能用来判断被测对象是否活着）。心跳陈旧超 T
// ⇒ 产出【通知】并退出非零（升级），由运行它的独立调度者（driver / OS 定时 / 人）处置。
//
// 三种失能形态（AC1）统一触发 = 心跳陈旧，分类用可测信号区分：
//   ① 进程死（process-dead）         —— 进程不存在（tmux has-session 为假 / --process-alive false）
//   ② 交互阻塞（interaction-blocked）—— 进程在、但被 AskUserQuestion 阻塞（心跳停 + --blocked true）
//   ③ 心跳停（heartbeat-stopped）     —— 进程在、无阻塞信号、但心跳停（兜底形态）
//
// 负控制（AC2）：把 manager 置入 AskUserQuestion 阻塞态（现成样本 outer 04:13:54Z–07:30:07Z），
// T 后必须产通知——由测试 `manager-liveness-independent-check.test.mjs` 回放该样本（lastTs=04:13:54Z，
// processAlive=true, blocked=true, now=04:13:54Z+T+ε）断言 notification 非空。
//
// 阈值 T（落笔方定）：DEFAULT_MAX_AGE_SECS = 3600 = 3 × ~1200s（manager 每 20 分钟一次 tick，
// 3 个周期）。正负控制都能取假：心跳新鲜 ⇒ 不通知；心跳陈旧超 T ⇒ 通知。样本阻塞 3h17m ≫ T，
// 该阈值会在人察觉前 ~2h17m 就报出。
//
// Pure functions exported for hermetic tests; the CLI wires file read + freshness judgment + 通知.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/manager-liveness-independent-check.ts \
//     [--root <dir>] [--heartbeat-file <path>] [--last-heartbeat-ts <epoch>] \
//     [--max-age-secs <N>] [--now <epoch>] [--process-alive <true|false>] \
//     [--manager-session <name>] [--blocked <true|false>] \
//     [--notify-file <path>] [--json]
//
// Exit: 0 = ALIVE (heartbeat fresh) · 1 = DISABLED (stale / missing / malformed — a notification
//       record was produced) · 2 = usage error.

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

// ── constants ───────────────────────────────────────────────────────────────────────────────────────

/** 阈值 T（落笔方定）：心跳陈旧超过这个秒数即判失能并通知。3600s = 3 × ~1200s（manager 每 20 分钟
 * 一次 tick 的 3 个周期）——大于正常 tick 间隔与抖动，小于「人最终会去看」的时距。 */
export const DEFAULT_MAX_AGE_SECS = 3600;

/** 默认心跳产物：manager 每轮 tick 追加一行写 `orchestration/manager-tick-log.md`（mtime = 最后落行
 * 时刻，与 manager-tick-log-check.sh 同一载体）。本脚本读它的 mtime 作为「最后一次心跳」时刻。 */
export const DEFAULT_HEARTBEAT_REL = "orchestration/manager-tick-log.md";

/** 默认通知载体：`.quay/manager-liveness-notifications.jsonl`（追加式、每行一条通知记录）。运行时
 * 产物（只在失能真正发生时才写一行），与 `.quay/worker-outcome.jsonl` 等 runtime state 同族。 */
export const DEFAULT_NOTIFY_REL = ".quay/manager-liveness-notifications.jsonl";

/** 默认 manager tmux 会话名（进程死判定的探测目标）。与 manager-start.sh 的默认一致。 */
export const DEFAULT_MANAGER_SESSION = "quay-manager";

/** 心跳产物「缺失/损坏」的哨兵——与「为假」区分（硬规则 6：缺值 = 未查，不是「为假」）。 */
export const MALFORMED = Object.freeze({ __malformed__: true });

// ── 判定（纯函数）──────────────────────────────────────────────────────────────────────────────────

/**
 * Judge manager heartbeat freshness. PURE.
 * @param {number} nowSec epoch-seconds "now"
 * @param {number|null|MALFORMED} lastTs the last heartbeat ts — a finite epoch number, `null` when the
 *   heartbeat product has never been written, or MALFORMED when it exists but carries no valid ts.
 * @param {number} [maxAgeSecs] dead threshold (default DEFAULT_MAX_AGE_SECS)
 * @returns {{alive:boolean, status:"alive"|"stale"|"missing"|"malformed", ageSecs:number|null, reason:string}}
 */
export function judgeLiveness(nowSec, lastTs, maxAgeSecs = DEFAULT_MAX_AGE_SECS) {
  if (lastTs === MALFORMED) {
    return { alive: false, status: "malformed", ageSecs: null, reason: "manager-heartbeat-malformed" };
  }
  if (lastTs == null) {
    return { alive: false, status: "missing", ageSecs: null, reason: "manager-heartbeat-missing" };
  }
  if (typeof lastTs !== "number" || !Number.isFinite(lastTs)) {
    return { alive: false, status: "malformed", ageSecs: null, reason: "manager-heartbeat-malformed" };
  }
  const ageSecs = Math.max(0, nowSec - lastTs); // future ts (clock skew) clamps to 0 = fresh
  if (ageSecs > maxAgeSecs) {
    return { alive: false, status: "stale", ageSecs, reason: "manager-heartbeat-stale" };
  }
  return { alive: true, status: "alive", ageSecs, reason: "manager-heartbeat-fresh" };
}

/** Failure-mode reason strings (machine-readable; the notification carries one of these). */
export const FAILURE_PROCESS_DEAD = "manager-process-dead";
export const FAILURE_INTERACTION_BLOCKED = "manager-interaction-blocked";
export const FAILURE_HEARTBEAT_STOPPED = "manager-heartbeat-stopped";

/**
 * Classify the failure mode for a STALE manager. PURE. Order matters: process-dead wins over a lingering
 * blocked signal (a dead process is not "blocked"), and an alive-but-blocked process is the
 * AskUserQuestion shape (interaction-blocked); everything else stale is the fallback heartbeat-stopped.
 * @param {object} o
 * @param {boolean} o.stale the judgeLiveness verdict (status === "stale")
 * @param {boolean|null} [o.processAlive] null = unknown (not probed / unverifiable)
 * @param {boolean} [o.blocked] AskUserQuestion 阻塞信号（生产由调用方检测 pane 提供；测试接缝）
 * @returns {string|null} one of FAILURE_* — or null when not stale (no failure mode).
 */
export function classifyFailureMode({ stale, processAlive = null, blocked = false }) {
  if (!stale) return null;
  if (processAlive === false) return FAILURE_PROCESS_DEAD;
  if (blocked === true) return FAILURE_INTERACTION_BLOCKED;
  return FAILURE_HEARTBEAT_STOPPED;
}

/** 通知记录（让人知道的那个产物）。PURE——由测试断言「T 后须有通知」即断言此对象非空。 */
export function buildNotification({ nowSec, ageSecs, failureMode, maxAgeSecs, lastTs }) {
  const lastAt = typeof lastTs === "number" && Number.isFinite(lastTs) ? new Date(lastTs * 1000).toISOString() : null;
  return {
    notifiedAt: new Date(nowSec * 1000).toISOString(),
    failureMode,
    ageSecs,
    maxAgeSecs,
    lastHeartbeatAt: lastAt,
    message: `manager 失能（${failureMode}）：心跳断 ${ageSecs}s > ${maxAgeSecs}s` + (lastAt ? `（last ${lastAt}）` : ""),
  };
}

/**
 * The full judgment — freshness + failure-mode classification + notification. PURE. This is the single
 * function the CLI and the tests consume; a stale/missing/malformed heartbeat carries a NON-NULL
 * `notification` (让人知道), a fresh heartbeat carries `notification: null` (nothing to notify).
 * @param {object} o
 * @param {number} o.nowSec epoch-seconds "now"
 * @param {number|null|MALFORMED} o.lastTs last heartbeat ts
 * @param {number} [o.maxAgeSecs]
 * @param {boolean|null} [o.processAlive]
 * @param {boolean} [o.blocked]
 * @returns {{alive:boolean, status:string, ageSecs:number|null, reason:string, failureMode:string|null, notification:object|null}}
 */
export function judge({ nowSec, lastTs, maxAgeSecs = DEFAULT_MAX_AGE_SECS, processAlive = null, blocked = false }) {
  const liveness = judgeLiveness(nowSec, lastTs, maxAgeSecs);
  if (liveness.alive) {
    return { ...liveness, failureMode: null, notification: null };
  }
  const failureMode = classifyFailureMode({ stale: liveness.status === "stale", processAlive, blocked });
  // missing/malformed 也是「没有有效心跳」——按对应形态分类，通知同样要产（让人知道），
  // 只是 ageSecs 不可得（null）。failureMode 对 missing/malformed 取 heartbeat-stopped 兜底。
  const mode = failureMode ?? FAILURE_HEARTBEAT_STOPPED;
  const notification = buildNotification({
    nowSec,
    ageSecs: liveness.ageSecs ?? 0,
    failureMode: mode,
    maxAgeSecs,
    lastTs: typeof lastTs === "number" ? lastTs : null,
  });
  return { ...liveness, failureMode: mode, notification };
}

// ── 心跳读取（读产物，不经过 manager）───────────────────────────────────────────────────────────────

/** Parse a heartbeat FILE TEXT into a ts. If the file is a JSON heartbeat (`{ts: N}`) use N; otherwise
 *  fall through to `null` so the caller uses the file mtime (the tick-log is a markdown file). PURE. */
export function parseHeartbeatText(text) {
  if (text == null || String(text).trim() === "") return null;
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && typeof v.ts === "number" && Number.isFinite(v.ts)) return v.ts;
  } catch {
    /* not JSON — a markdown tick-log; ts comes from mtime */
  }
  return null;
}

/** Read the last heartbeat ts from `file`: a JSON heartbeat's `ts`, else the file mtime, else null when
 *  the file is absent. This is the ONLY product read — it never consults the manager process itself. */
export function readHeartbeatTs(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    const ts = parseHeartbeatText(text);
    if (ts != null) return ts;
  } catch {
    /* unreadable → try mtime; a directory/perm error falls through */
  }
  try {
    const st = fs.statSync(file);
    return Math.floor(st.mtimeMs / 1000);
  } catch {
    return null;
  }
}

// ── 通知写入 ─────────────────────────────────────────────────────────────────────────────────────────

/** Append one notification record (one JSON line) to the carrier file. Creates parent dirs. Returns the
 *  file path. The carrier is append-only reviewable history (同 inner-wakeup-heartbeat 的追加式 jsonl)。 */
export function writeNotification(notifyFile, notification) {
  if (!notifyFile) return null;
  fs.mkdirSync(path.dirname(notifyFile), { recursive: true });
  fs.appendFileSync(notifyFile, `${JSON.stringify(notification)}\n`, "utf8");
  return notifyFile;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function flagVal(args, name, def) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : def;
}

/** Best-effort process-liveness probe: `tmux has-session -t <session>`. Returns true/false, or null when
 *  tmux is unavailable (unknown — the failure-mode classification falls back to heartbeat-stopped). */
export function probeProcessAlive(session, env = process.env) {
  if (!session) return null;
  const res = spawnSync("tmux", ["has-session", "-t", session], { encoding: "utf8", env, stdio: "ignore" });
  if (res.error) return null; // tmux absent → unverifiable
  return res.status === 0;
}

function usage() {
  console.log(`manager-liveness-independent-check.ts — manager 自身活性独立兜底（不经过 manager）

Reads <root>/${DEFAULT_HEARTBEAT_REL} (mtime = 最后 tick 落行时刻；或 --heartbeat-file 指定的 JSON
心跳 {ts}) and judges freshness. 心跳陈旧超 T（default ${DEFAULT_MAX_AGE_SECS}s = 3 × 20min tick）⇒
产出一条通知（让人知道）并 exit 1；心跳新鲜 ⇒ exit 0。本脚本从不经过 manager 自己——只读心跳产物、
探测进程（tmux has-session），被计量对象不参与判定（硬规则 4b）。

Usage:
  --root <dir>             workspace root (default: script dir ../..) — 默认心跳
                           <root>/${DEFAULT_HEARTBEAT_REL}，默认通知 <root>/${DEFAULT_NOTIFY_REL}
  --heartbeat-file <path>  显式心跳文件（JSON {ts} 用 ts，否则用 mtime）；覆盖默认 tick-log
  --last-heartbeat-ts <N>  显式最后心跳 epoch 秒（测试接缝，覆盖文件读取）
  --max-age-secs <N>       阈值 T（default ${DEFAULT_MAX_AGE_SECS}）
  --now <N>                "now" epoch 秒（测试接缝；default Date.now()/1000）
  --process-alive <bool>   进程存活信号（测试接缝；default 探测 tmux has-session --manager-session）
  --manager-session <name> tmux 会话名（default ${DEFAULT_MANAGER_SESSION}）
  --blocked <bool>         AskUserQuestion 阻塞信号（测试接缝；default false）
  --notify-file <path>     通知载体（default <root>/${DEFAULT_NOTIFY_REL}；传 '' 则不落盘）
  --json                   JSON 输出（default human-readable）

Exit: 0 ALIVE · 1 DISABLED (stale/missing/malformed — notification produced) · 2 usage error`);
}

export function main(argv, importMetaUrl = import.meta.url, env = process.env) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { usage(); return 0; }
  const root = path.resolve(flagVal(args, "--root", repoRoot(path.dirname(fileURLToPath(importMetaUrl)))));
  const heartbeatFile = flagVal(args, "--heartbeat-file", path.join(root, DEFAULT_HEARTBEAT_REL));
  const lastTsFlag = flagVal(args, "--last-heartbeat-ts");
  const maxAge = Number(flagVal(args, "--max-age-secs", String(DEFAULT_MAX_AGE_SECS)));
  const nowFlag = flagVal(args, "--now");
  const processAliveFlag = flagVal(args, "--process-alive");
  const managerSession = flagVal(args, "--manager-session", DEFAULT_MANAGER_SESSION);
  const blockedFlag = flagVal(args, "--blocked");
  const notifyFile = flagVal(args, "--notify-file", path.join(root, DEFAULT_NOTIFY_REL));
  const jsonOut = args.includes("--json");

  if (!Number.isFinite(maxAge) || maxAge < 0) {
    console.error("manager-liveness-independent-check: --max-age-secs must be a non-negative number");
    return 2;
  }
  const nowSec = nowFlag !== undefined ? Number(nowFlag) : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(nowSec)) {
    console.error("manager-liveness-independent-check: --now must be a numeric epoch");
    return 2;
  }

  // lastTs：显式 --last-heartbeat-ts > 心跳文件读取（JSON ts / mtime）。
  let lastTs;
  if (lastTsFlag !== undefined) {
    const n = Number(lastTsFlag);
    lastTs = Number.isFinite(n) ? n : null;
  } else {
    const ts = readHeartbeatTs(heartbeatFile);
    lastTs = ts; // number | null（文件缺失 ⇒ null = 从未写过）
  }

  // processAlive：显式 --process-alive > tmux has-session 探测（不可用 ⇒ null = unknown）。
  let processAlive = null;
  if (processAliveFlag !== undefined) {
    processAlive = processAliveFlag === "true";
  } else {
    processAlive = probeProcessAlive(managerSession, env);
  }
  const blocked = blockedFlag !== undefined ? blockedFlag === "true" : false;

  const verdict = judge({ nowSec, lastTs, maxAgeSecs: maxAge, processAlive, blocked });

  // 通知落盘（只在失能时写——文件新鲜时什么都不落）。空 --notify-file '' ⇒ 不落盘（测试/纯判定）。
  let wroteTo = null;
  if (!verdict.alive && verdict.notification && notifyFile && notifyFile !== "") {
    wroteTo = writeNotification(notifyFile, verdict.notification);
  }

  if (jsonOut) {
    console.log(JSON.stringify({
      heartbeatFile: path.resolve(heartbeatFile),
      nowSec,
      verdict: verdict.alive ? "ALIVE" : "DISABLED",
      status: verdict.status,
      ageSecs: verdict.ageSecs,
      maxAgeSecs: maxAge,
      reason: verdict.reason,
      failureMode: verdict.failureMode,
      notification: verdict.notification,
      notifyFile: wroteTo,
      processAlive,
      blocked,
    }, null, 2));
  } else if (verdict.alive) {
    console.log(`manager-liveness-independent-check: ALIVE — age ${verdict.ageSecs}s ≤ ${maxAge}s (heartbeat fresh)`);
  } else {
    const n = verdict.notification;
    console.error(`manager-liveness-independent-check: DISABLED — ${n.message}` + (wroteTo ? ` (notified ${wroteTo})` : ""));
  }
  return verdict.alive ? 0 : 1;
}

if (isDirectEntry(import.meta)) {
  const code = main(process.argv);
  process.exit(code);
}
