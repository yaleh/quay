#!/usr/bin/env node
// server-restart-inflight-verify.ts — the PRODUCER for GOAL-017 / AC-256's carrier
// (`.quay/unified-server-verification.jsonl`, shared with AC-254 and disambiguated by the `ac` field).
//
// WHAT QUESTION THIS ANSWERS
//   "When ONE service — `driver:worker` — is restarted on the UNIFIED server form, do the worker
//    subprocesses that were IN FLIGHT at that moment survive? i.e. is SPEC §6.9 不变式 3 / §8-7 后半
//    ('重启 driver:worker ⛔ 不得杀掉它在飞的 worker 子进程') still true after the merge?"
//
// WHY A PRODUCER AND NOT A CHECKER (硬规则 4 推论三)
//   AC-256's criterion reads a carrier that no code produced. A criterion whose only satisfier is a
//   fixture proves that a record CAN be produced, never that one HAS been. So this script performs
//   the real service-level restart against the real production workspace and writes the real record
//   — fail-closed at every reading: anything it cannot read or cannot satisfy produces ZERO record
//   plus a DISTINGUISHABLE non-zero verdict (硬规则 3b). It is deliberately NOT registered in
//   runner-static-gate.ts (producer, not a per-round static check: registering it would redden the
//   whole suite every round until the record exists).
//
// ── 这条 AC 的风险不是「造」，是「丢」────────────────────────────────────────────────────────────
//   现状 `quay driver stop --kind X` **已经**是「不杀在飞子进程」的语义（stopKind 只 SIGTERM
//   supervisor + 驱动自身，⛔ 不扫 in-flight）。所以本脚本不是去实现一个新能力，而是**造一具能取假
//   的读数**去守住一个已存在的能力：合并（SPEC 阶段 A2「web + control 合入一个进程」）最容易造成的
//   实质回退，就是这条路被别的东西接管而它不再被服务级重启走到。
//
// ── 三个空转，每一个都能让「一个都没死」恒真 ─────────────────────────────────────────────────────
//   (a) 在飞集合【为空】         ⇒ 没有任何东西可死 ⇒ criterion 已用 len(before)<1 挡住，此处也挡。
//   (b) before 里有【已死/僵尸】pid ⇒ kill -0 对僵尸仍返回成功（driver-runtime 自己的第一手记录：
//                                  gap-driver-start-false-confirms-unsettled-driver）⇒ 「都没死」恒真。
//                                  ⇒ 必须【逐个核活且非 Z 态】。
//   (c) 重启是【no-op】（只改写 pid 文件）⇒ 进程根本没换 ⇒ 也无所谓死不死。
//                                  ⇒ 必须验旧 pid【真的不在】且新 pid【真的活】。
//
// ── 读数全是【独立推导】的直接量（硬规则 4b）────────────────────────────────────────────────────
//   在飞集合  = 从 **driver 进程的进程树** 推导（/proc/<driver_pid>/task/*/children + cmdline 过滤），
//               ⛔ **不采信** `.quay/worker-driver-inflight.pid` —— 那是 driver 进程【自己维护】的集合，
//               在它停摆时恰好也停止更新，与「一切正常」同形。自报集合只作交叉核对字段留档。
//   driver 存活 = 读 `.quay/worker-driver.pid` 得到 pid 后，**逐个核 /proc/<pid> + 非 Z 态 + cmdline
//               确实是本 kind 的驱动**（⛔ pid 文件的内容本身不是证据，它只是「谁声称自己是」）。
//   driver 恢复 = `.quay/worker-round.jsonl` 出现 **新 run_id** 且其 `ts` **严格晚于**重启动作时刻的
//               记录（直接量）。⛔ 不只靠 `os.path.getmtime`（criterion 用的是它，`touch` 即可骗过；
//                本脚本两根读数并列留档）。
//   在飞存活   = **对原集合逐个再核活**。⛔⛔ **不是重新枚举进程树** —— 重新枚举会把「死了旧的、
//                新起了别的」读成同一个集合，那正是本 AC 要防的假阳性（AC5 逐字）。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/server-restart-inflight-verify.ts \
//        [--root <workspace-root>] [--cli <path-to-quay-cli-entry>] [--window-ms N] [--json]
//        [--control <none|no-restart>]
//
// Exit codes (the verdict is the code, and `--json` always emits a parseable document):
//   0  a qualifying record was appended
//   1  the restart was performed but the record was REFUSED (zero record) — see `verdict`
//   2  the run could NOT be evaluated (not the unified form / driver:worker not running / empty
//      in-flight set / unreadable readings) — ⛔ distinct from 1.
//      ⚠️ `verdict:"HOSTED-BY-ANCHOR"` is a 2 as well, but a DIFFERENT fact from all of the above:
//      under SPEC §7 阶段 C the worker kind is an event-loop loop inside a single anchor process, so
//      `.quay/worker-driver.pid` names the ANCHOR — a per-kind restart cannot change a process pid,
//      which makes AC-256's `driver_pid_before != driver_pid_after` structurally unsatisfiable in
//      that form. The producer refuses BEFORE acting (running the pre-stage-C path would SIGTERM the
//      anchor and take all six hosted kinds down). 硬规则 3b: 「本形态下判据不可满足」 must not share
//      a value with 「没测成」.
//   3  usage error
//   `--control no-restart` is the SAFE STRUCTURAL control: it asks the service layer to `start` a
//   service that is already running (§6.9 不变式 1 ⇒ a no-op, the driver pid must NOT move). The
//   producer must then REFUSE with `NOT-A-RESTART` — which simultaneously proves (i) that `start`
//   does not silently restart, and (ii) that `driver_pid_before != driver_pid_after` is load-bearing
//   rather than decorative. It touches no production process.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DRIVER_KINDS } from "./driver-runtime.ts";
// valueOf (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one
// of the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
// The `round` field is a JSON STRING in these carriers; that conversion is ALREADY solved (and
// unit-tested) in AC-254's producer, which shares this very carrier file. ⛔ A second copy would be
// the exact 「两份实现 = 漂移」 shape — and the trap is silent: writing the raw string through is
// structurally disqualifying because the criterion's `isinstance(b, int)` would fail while the
// record still LOOKS complete.
import { lastLine, parseRoundRecord, roundCarrierName, type RoundReading } from "./server-partial-stop-verify.ts";
// The workspace's OWN worker process name (`-n <name>`) — resolved from `.quay/profiles.yml` by the
// SAME function the driver itself uses, ⛔ never the hardcoded `quay-task-worker` (that literal is
// quay's own naming; a third-party project renames the role and every probe built on the literal
// silently misses — see resolveWorkerProcessName's own first-hand record).
import { resolveWorkerProcessName } from "./worker-driver.ts";

/** AC-256's own id, verbatim — the criterion matches this string exactly. */
export const AC_ID = "GOAL-017-AC-256";
/** The service that is restarted. Verbatim: the criterion matches this string exactly. */
export const RESTARTED_SERVICE = "driver:worker";
/** The carrier this producer owns (shared with AC-254; the `ac` field separates the records). */
export const CARRIER_REL = ".quay/unified-server-verification.jsonl";
/** How the in-flight set was obtained — recorded so the derivation is auditable, not asserted. */
export const INFLIGHT_SOURCE = "proc-tree";
const SERVER_STATE_REL = ".quay/server.json";
/** SPEC §7 阶段 C（AC-255）的 anchor 回读面 {pid, startedAt, kinds, host}。读它是为了**在动手之前**
 *  认出「这个 kind 的 pid 其实是 anchor 的 pid」——⛔ 不读它就会 SIGTERM 一个承载六个 kind 的进程。 */
const ANCHOR_STATE_REL = ".quay/anchor.json";
const WORKER_ROUND_REL = ".quay/worker-round.jsonl";
/** The markers that identify the worker-driver process in a cmdline — derived from the kernel
 *  registry (`DRIVER_KINDS.worker.driver`), ⛔ not typed out (a new driver filename must not silently
 *  turn this probe into a constant-false reader).
 *
 *  ⚠️ TWO forms, and the second is the one PRODUCTION runs: a source tree spawns the raw
 *  `worker-driver.ts` (`node --experimental-strip-types …`), while a shipped/installed tree DELETES
 *  the raw .ts and spawns the bundled `dist/worker-driver.js`. Matching only the registry's `.ts`
 *  filename made this probe **constant-false against every real production driver** — measured
 *  2026-09-14 on `/home/yale/work/quay`, whose live driver cmdline is
 *  `node …/plugin/scripts/dist/worker-driver.js --root …`: the producer refused with "refusing to
 *  act on an unrelated process" while the process was in fact exactly the right one (硬规则 4b's
 *  constant-false shape: a reader that can never say yes is indistinguishable from "not running").
 *  The `.js` form is derived from the SAME registry stem — ⛔ no second literal.
 *  Not widened into a bare `worker` match on purpose: the supervisor's own cmdline
 *  (`driver-runtime.js __supervise --kind worker …`) carries the kind word but ⛔ NOT this stem, so
 *  the probe still tells the driver apart from its supervisor (verified against both live pids). */
export const WORKER_DRIVER_MARKERS: readonly string[] = (() => {
  const stem = DRIVER_KINDS.worker.driver.replace(/\.tsx?$/, "");
  return [`${stem}.ts`, `${stem}.js`];
})();
/** The worker kind's round carrier, derived the same way (⛔ 不硬编码). */
export const WORKER_ROUND_CARRIER: string | null = roundCarrierName(DRIVER_KINDS.worker.carriers);

// ══ 采样层：/proc 上的直接量 ═══════════════════════════════════════════════════════════════════════

function readProc(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** One process's state CHARACTER (`/proc/<pid>/status` → `State:`) — null when unreadable (gone). */
export function procState(pid: number, procDir = "/proc"): string | null {
  const raw = readProc(path.join(procDir, String(pid), "status"));
  if (raw === null) return null;
  const m = /^State:\s+(\S)/m.exec(raw);
  return m ? m[1] : null;
}

/** One process's cmdline, NULs → spaces — null when unreadable. */
export function procCmdline(pid: number, procDir = "/proc"): string | null {
  const raw = readProc(path.join(procDir, String(pid), "cmdline"));
  return raw === null ? null : raw.replace(/\0/g, " ").trim();
}

/**
 * 该 pid 是否【活着且不是僵尸/非常死】。
 *
 * ⛔ `kill(pid, 0)` 不够：僵尸进程仍可被 signal（driver-runtime 自己的第一手记录：
 * gap-driver-start-false-confirms-unsettled-driver 写明「被 spawn 的子进程在未回收前仍是可 signal
 * 的僵尸 ⇒ kill -0 对『已死但未 reap』返回成功」）。而僵尸恰恰是「已经死了」——把它算作存活会让本 AC
 * 的核心断言「一个都没死」**恒真**（空转形态 b）。故判据是 /proc 的 State 字符，不是 signal 能力。
 * ⛔ 也⛔ 不能用「cmdline 读得到」代替：僵尸的 cmdline 仍读得到。
 */
export function aliveNonZombie(pid: number, procDir = "/proc"): boolean {
  const st = procState(pid, procDir);
  if (st === null) return false;
  return st !== "Z" && st !== "X";
}

/**
 * `pid` 的【全部直接子进程】（跨该进程的所有线程：/proc/<pid>/task/<tid>/children）。
 *
 * 为什么必须遍历 task 而不只读 /proc/<pid>/task/<pid>/children：children 文件是 **per-thread** 的
 * （列的是该线程自己 fork 的子进程）——worker 驱动在辅助线程里 spawn 时，只读主线程会漏掉它们，
 * 而「漏掉」在这里的方向是**危险的**：集合变小 ⇒ 「都没死」更容易恒真。
 */
export function driverChildren(driverPid: number, procDir = "/proc"): number[] {
  const taskDir = path.join(procDir, String(driverPid), "task");
  let tids: string[];
  try {
    tids = fs.readdirSync(taskDir);
  } catch {
    return [];
  }
  const out = new Set<number>();
  for (const tid of tids) {
    if (!/^\d+$/.test(tid)) continue;
    const raw = readProc(path.join(taskDir, tid, "children"));
    if (raw === null) continue;
    for (const tok of raw.trim().split(/\s+/)) if (/^\d+$/.test(tok)) out.add(Number(tok));
  }
  return [...out].sort((a, b) => a - b);
}

/** A pid file's contents as ints (whitespace-separated). ⛔ Used ONLY for the cross-check field:
 *  this is a set the driver maintains ABOUT ITSELF (硬规则 4b) and never the criterion's reading. */
export function parsePidFile(text: string | null): number[] {
  if (text === null) return [];
  const out = new Set<number>();
  for (const tok of text.trim().split(/\s+/)) if (/^\d+$/.test(tok)) out.add(Number(tok));
  return [...out].sort((a, b) => a - b);
}

/** `pid` 是否【就是】本 kind 的驱动进程（cmdline 命中注册表里的驱动入口名，源树 `.ts` 与出厂
 *  bundle `.js` 两个形态都认 —— 见 WORKER_DRIVER_MARKERS 的实测记录）。 */
export function cmdlineIsWorkerDriver(pid: number, procDir = "/proc"): boolean {
  const cmd = procCmdline(pid, procDir);
  return cmd !== null && WORKER_DRIVER_MARKERS.some((m) => cmd.includes(m));
}

export interface InflightReading {
  /** ✅ 判据集合：driver 的子进程里 cmdline 命中本 workspace worker 名的那些（进程树独立推导）。
   *  ⛔ 刻意【窄】：driver 的直接子进程还包含例程探针脚本（如 `closure-lag-check.sh`）——把它们算进
   *  判据集合，一次正常退出的探针就会被读成「杀了在飞 worker」的假回退。 */
  pids: number[];
  /** driver 自报的在飞集合（交叉核对字段，⛔ 不参与判定）。 */
  declared: number[];
  /** driver 的【全部】直接子进程 —— 被排除在判据集合之外的那些必须在读数里可见，
   *  ⛔ 不能只报留下来的（否则「排除了什么」不可核）。 */
  allChildren: number[];
}

/** 推导在飞 worker 集合：进程树 ∩ cmdline 命中 worker 名。 */
export function deriveInflight(driverPid: number, workerName: string, declared: number[], procDir = "/proc"): InflightReading {
  const allChildren = driverChildren(driverPid, procDir);
  const pids = allChildren.filter((c) => {
    const cmd = procCmdline(c, procDir);
    return cmd !== null && cmd.includes(workerName);
  });
  return { pids, declared, allChildren };
}

/** 子进程的 cmdline 摘要（供「排除了什么」可核）——长 cmdline 截断到可读长度。 */
export function childDigest(pids: number[], procDir = "/proc"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pids) {
    const cmd = procCmdline(p, procDir) ?? "<unreadable>";
    out[String(p)] = cmd.length > 160 ? cmd.slice(0, 160) + "…" : cmd;
  }
  return out;
}

/** 对一组 pid **逐个再核活**（⛔ 不是重新枚举进程树 —— 见文件头）。返回其中【仍然活着且非 Z 态】的。 */
export function aliveAmong(pids: number[], procDir = "/proc"): number[] {
  return pids.filter((p) => aliveNonZombie(p, procDir));
}

/** 两组 pid 是否【按集合相等】（排序后逐位比较；重复项无意义，先并集）。 */
export function samePidSet(a: number[], b: number[]): boolean {
  const sa = [...new Set(a)].sort((x, y) => x - y);
  const sb = [...new Set(b)].sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

// ══ 组装：判据字段形态 fail-closed（字段类型就是判据的一部分）═══════════════════════════════════════

export interface Readings {
  /** 最早的观测时刻（ISO-8601）——before 系列就是在它之后读的。criterion 拿它跟
   *  `os.path.getmtime(worker-round.jsonl)` 比，选**最早**的那个观测时刻才让该断言按构造成立。 */
  at: string;
  /** 重启动作【发出】的时刻（ISO-8601）——「driver 真的恢复运转」要求新 round 的 ts 严格晚于它。 */
  restartedAt: string;
  driverPidBefore: number | null;
  driverPidAfter: number | null;
  /** 采样时旧 driver pid 是否活着且非 Z 态。false ⇒ 我们采的是一个尸体，读数无意义。 */
  driverPidBeforeAlive: boolean;
  /** 重启后旧 pid **是否还在**（且 cmdline 仍是本 kind 的驱动）。必须为 false —— 否则一个只改写
   *  pid 文件的 no-op 也能满足 `before != after`（DoD 逐字禁止）。 */
  driverPidBeforeAliveAfter: boolean;
  driverPidAfterAlive: boolean;
  inflightBefore: number[];
  /** before 集合是否【逐个】活着且非 Z 态（空转形态 b 的闸）。 */
  inflightBeforeAllAlive: boolean;
  inflightDeclared: number[];
  inflightAllChildren: number[];
  /** 对**原集合**逐个再核活的结果。 */
  inflightAliveAfter: number[];
  workerRunIdBefore: string;
  workerRoundBefore: number | null;
  workerRunIdAfter: string;
  workerRoundAfter: number | null;
  workerRoundTsAfter: string;
  /** `os.path.getmtime(worker-round.jsonl)` 的 ISO 形态（criterion 用的代理量，与上面的直接量并列）。 */
  workerRoundMtime: string;
  restartedService: string;
  restartedVia: string;
  restartedArgv: string[];
  restartedExit: number;
  restartedStdout: string;
  controlMode: string;
}

/** The refusal vocabulary. ⛔ 每个取值都是一个**不同的事实**：把「测了没死」与「没测成」、
 *  「没重启」与「重启了但旧驱动还活着」折成同一个值，就是 硬规则 3b 的失败形态。 */
export type Verdict =
  | "OK"
  | "NOT-EVALUATED"
  | "NOT-A-RESTART"
  | "OLD-DRIVER-SURVIVED"
  | "DRIVER-NOT-RESUMED"
  | "INFLIGHT-KILLED";

export interface BuildResult {
  ok: boolean;
  verdict: Verdict;
  reason: string;
  record?: Record<string, unknown>;
}

export function isIsoInstant(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v);
}

function isoMs(v: string): number {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
}

/** 这些字段是 criterion 逐字读的 —— 单列出来，供测试把「缺字段」当成一个**可枚举的**缺陷检查。 */
export const REQUIRED_RECORD_FIELDS = [
  "ac",
  "restarted_service",
  "at",
  "driver_pid_before",
  "driver_pid_after",
  "inflight_worker_pids_before",
  "inflight_worker_pids_alive_after",
] as const;

/**
 * Assemble AC-256's record — fail-closed, and every refusal carries a DISTINGUISHABLE verdict.
 *
 * 顺序即强度：先挡「根本没测成」（NOT-EVALUATED），再挡三个空转形态，最后才是核心断言。
 * 每一步都是一个「记录**本可以被产出**而其实什么都没观察到」的路径。
 */
export function buildRecord(r: Readings): BuildResult {
  // ── ⓪ 形态：字段类型就是判据的一部分，读不出 ⇒ 不写（硬规则 3b：读不懂 ⇏ 合格）──────────────
  if (!isIsoInstant(r.at) || !isIsoInstant(r.restartedAt)) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: `'at' / 'restartedAt' is not an ISO-8601 instant (${JSON.stringify(r.at)} / ${JSON.stringify(r.restartedAt)})` };
  }
  if (r.driverPidBefore === null || r.driverPidAfter === null) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: `driver pid could not be read before/after the restart (before=${JSON.stringify(r.driverPidBefore)}, after=${JSON.stringify(r.driverPidAfter)})` };
  }
  // ── ① 空转形态 b 的前置：我们采到的旧 driver 必须【当时是活的】────────────────────────────────
  if (r.driverPidBeforeAlive !== true) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: `the driver pid ${r.driverPidBefore} was NOT alive-and-non-zombie at sampling time — the reading was taken from a corpse` };
  }
  // ── ② 空转形态 a：在飞集合为空 ⇒ 「一个都没死」恒真（criterion 也挡这一条）────────────────────
  if (r.inflightBefore.length < 1) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: "the in-flight worker set was EMPTY before the restart — 'not one of them died' would be vacuously true (空转控制 a)" };
  }
  // ── ③ 空转形态 b：before 里有已死/僵尸 pid ⇒ 同上（criterion 结构上挡不住，只有这里挡）─────────
  if (r.inflightBeforeAllAlive !== true) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: `NOT every in-flight worker pid was alive-and-non-zombie before the restart (${JSON.stringify(r.inflightBefore)}) — a dead/zombie pid in the before set makes 'not one of them died' vacuously true (空转控制 b)` };
  }
  // ── ④ 假重启控制：pid 没变 ⇒ 没有「重启」可言（criterion 也要求 before != after）──────────────
  if (r.driverPidBefore === r.driverPidAfter) {
    return {
      ok: false,
      verdict: "NOT-A-RESTART",
      reason: `driver pid is unchanged (${r.driverPidBefore}) — this was a no-op, so 'the in-flight workers survived the restart' observes nothing (假重启控制)`,
    };
  }
  // ── ⑤ 旧驱动【真的不在】：只验 before != after 会被「只改写 pid 文件」骗过（DoD 逐字）──────────
  if (r.driverPidBeforeAliveAfter !== false) {
    return {
      ok: false,
      verdict: "OLD-DRIVER-SURVIVED",
      reason: `the OLD driver pid ${r.driverPidBefore} is STILL alive after the 'restart' — the pid file moved but the old process did not, so two drivers now exist (or the change was cosmetic)`,
    };
  }
  if (r.driverPidAfterAlive !== true) {
    return { ok: false, verdict: "DRIVER-NOT-RESUMED", reason: `the new driver pid ${r.driverPidAfter} is not alive — the service was stopped and never came back` };
  }
  // ── ⑥ 核心断言：对【原集合】逐个再核活的集合必须与之前【按集合相等】───────────────────────────
  if (!samePidSet(r.inflightAliveAfter, r.inflightBefore)) {
    const missing = r.inflightBefore.filter((p) => !r.inflightAliveAfter.includes(p));
    return {
      ok: false,
      verdict: "INFLIGHT-KILLED",
      reason:
        `in-flight worker pid(s) ${JSON.stringify(missing)} did NOT survive the restart of ${r.restartedService} ` +
        `(before=${JSON.stringify(r.inflightBefore)}, alive-after=${JSON.stringify(r.inflightAliveAfter)}) — SPEC §6.9 不变式 3 violated`,
    };
  }
  // ── ⑦ driver 真的恢复运转：直接量（新 run_id + 晚于重启时刻的 ts），⛔ 不只靠 mtime────────────
  if (r.workerRunIdBefore === "" || r.workerRunIdAfter === "") {
    return { ok: false, verdict: "NOT-EVALUATED", reason: "the worker round carrier's run_id could not be read before/after — 'the driver resumed' cannot be established" };
  }
  if (r.workerRunIdAfter === r.workerRunIdBefore) {
    return {
      ok: false,
      verdict: "DRIVER-NOT-RESUMED",
      reason: `worker-round.jsonl still carries the OLD run_id ${r.workerRunIdBefore} — the driver never came back, so 'it did not kill anything' is just 'it was stopped' (停机不恢复控制)`,
    };
  }
  const tsAfter = isoMs(r.workerRoundTsAfter);
  if (!Number.isFinite(tsAfter) || tsAfter <= isoMs(r.restartedAt)) {
    return {
      ok: false,
      verdict: "DRIVER-NOT-RESUMED",
      reason: `the newest round record on the NEW run_id ${r.workerRunIdAfter} carries ts ${JSON.stringify(r.workerRoundTsAfter)}, which is not strictly after the restart instant ${r.restartedAt} — the driver is not demonstrably turning again`,
    };
  }

  return {
    ok: true,
    verdict: "OK",
    reason: `${r.restartedService} restarted (pid ${r.driverPidBefore} → ${r.driverPidAfter}); all ${r.inflightBefore.length} in-flight worker child(ren) survived, and the driver resumed on run_id ${r.workerRunIdAfter}`,
    record: {
      // ── 判据逐字读的字段（⛔ 名字与类型都是契约，不是风格）──────────────────────────────────
      ac: AC_ID,
      restarted_service: r.restartedService,
      at: r.at,
      // ⛔ JSON 整数，不是字符串：criterion 侧 `isinstance(..., int)` 对字符串恒假 ⇒ 必不合格。
      driver_pid_before: r.driverPidBefore,
      driver_pid_after: r.driverPidAfter,
      inflight_worker_pids_before: r.inflightBefore,
      inflight_worker_pids_alive_after: r.inflightAliveAfter,
      // ── 加强字段（判据不读，供人/后续交叉核对；⛔ 不是判据的一部分）──────────────────────────
      driver_pid_before_alive: r.driverPidBeforeAlive,
      driver_pid_before_dead_after: !r.driverPidBeforeAliveAfter,
      driver_pid_after_alive: r.driverPidAfterAlive,
      inflight_worker_pids_before_all_alive: r.inflightBeforeAllAlive,
      inflight_declared_by_driver: r.inflightDeclared,
      inflight_source: INFLIGHT_SOURCE,
      inflight_alive_after_source: "re-checked each ORIGINAL pid individually (/proc State); ⛔ NOT a re-enumeration of the process tree",
      inflight_declared_vs_derived: samePidSet(r.inflightDeclared, r.inflightBefore) ? "identical" : "DIFFERENT — the independent derivation is authoritative",
      driver_children_all: r.inflightAllChildren,
      worker_run_id_before: r.workerRunIdBefore,
      worker_run_id_after: r.workerRunIdAfter,
      worker_round_before: r.workerRoundBefore,
      worker_round_after: r.workerRoundAfter,
      worker_round_ts_after: r.workerRoundTsAfter,
      worker_round_jsonl_mtime: r.workerRoundMtime,
      worker_round_jsonl_rel: WORKER_ROUND_REL,
      restarted_at: r.restartedAt,
      restarted_service_owner: r.restartedService === RESTARTED_SERVICE ? "the service layer (quay server restart)" : "UNKNOWN",
      restarted_via: r.restartedVia,
      restarted_argv: r.restartedArgv,
      restarted_exit: r.restartedExit,
      restarted_stdout: r.restartedStdout,
      control_mode: r.controlMode,
      ts: new Date().toISOString(),
    },
  };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function resolveCliPath(explicit: string | undefined): string | null {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const repoRoot = path.resolve(SCRIPT_DIR, "..", "..");
  const devEntry = path.join(repoRoot, "packages", "quay", "bin", "quay.ts");
  return fs.existsSync(devEntry) ? devEntry : null;
}

function runCli(cli: string, args: string[], cwd: string): { argv: string[]; exit: number; stdout: string; stderr: string } {
  const stripTypes = cli.endsWith(".ts") ? ["--experimental-strip-types"] : [];
  const argv = [process.execPath, "--no-warnings", ...stripTypes, cli, ...args];
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", timeout: 300000 });
  return { argv, exit: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function out(json: boolean, doc: Record<string, unknown>): void {
  if (json) process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
  else {
    const parts = Object.entries(doc)
      .filter(([, v]) => typeof v !== "object")
      .map(([k, v]) => `${k}=${String(v)}`);
    process.stdout.write(parts.join(" ") + "\n");
    for (const [k, v] of Object.entries(doc)) if (v && typeof v === "object") process.stdout.write(`  ${k}: ${JSON.stringify(v)}\n`);
  }
}

interface ServerCarrier {
  pid: number;
  services: Array<{ name: string; host: string; port: number; up?: boolean }>;
}

function readServerCarrier(root: string): ServerCarrier | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, SERVER_STATE_REL), "utf8")) as ServerCarrier;
    if (!j || !Array.isArray(j.services) || !Number.isInteger(j.pid)) return null;
    return j;
  } catch {
    return null;
  }
}

function readPidFileAbs(p: string): number | null {
  try {
    const raw = fs.readFileSync(p, "utf8").trim();
    return /^\d+$/.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** The anchor回读面, or null when absent/unreadable/ill-shaped (⇒ not the anchor form; ⛔ fail-OPEN
 *  here on purpose: a broken carrier must not make the producer refuse everything, and the thing this
 *  guards against is only reachable when the reading is POSITIVE). */
function readAnchor(root: string): { pid: number; kinds: string[] } | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, ANCHOR_STATE_REL), "utf8")) as { pid?: unknown; kinds?: unknown };
    if (!j || !Number.isInteger(j.pid) || !Array.isArray(j.kinds) || !j.kinds.every((k) => typeof k === "string")) return null;
    return { pid: j.pid as number, kinds: j.kinds as string[] };
  } catch {
    return null;
  }
}

/** The worker kind's driver pid file, from the kernel's own statePaths naming (`<prefix>.pid`). */
function workerDriverPidFile(root: string): string {
  return path.join(root, ".quay", `${DRIVER_KINDS.worker.prefix}.pid`);
}

function readWorkerRound(root: string): RoundReading | null {
  const line = lastLine(path.join(root, WORKER_ROUND_REL));
  return line === null ? null : parseRoundRecord(line, "ts");
}

function roundMtimeIso(root: string): string {
  try {
    return fs.statSync(path.join(root, WORKER_ROUND_REL)).mtime.toISOString();
  } catch {
    return "";
  }
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const json = args.includes("--json");
  /** Arity-1 adapter over the shared `flagValue`: the `--` prefix is this call site's own spelling. */
  const valueOf = (name: string): string | undefined => flagValue(args, `--${name}`);
  const root = path.resolve(valueOf("root") ?? process.cwd());
  const control = valueOf("control") ?? "none";
  const windowMs = Number(valueOf("window-ms") ?? "1200000");
  const cli = resolveCliPath(valueOf("cli"));
  if (cli === null) {
    out(json, { ac: AC_ID, verdict: "USAGE", reason: "cannot locate the Core CLI entry — pass --cli <path/to/quay.ts|quay.js>" });
    return 3;
  }
  if (!/^\d+$/.test(String(windowMs)) || windowMs <= 0) {
    out(json, { ac: AC_ID, verdict: "USAGE", reason: `--window-ms must be a positive integer (got ${JSON.stringify(valueOf("window-ms"))})` });
    return 3;
  }
  if (control !== "none" && control !== "no-op-read") {
    out(json, { ac: AC_ID, verdict: "USAGE", reason: `--control must be 'none' or 'no-op-read' (got ${JSON.stringify(control)})` });
    return 3;
  }
  if (WORKER_ROUND_CARRIER === null) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: "the kernel registry declares no round carrier for kind 'worker'" });
    return 2;
  }

  // ── ① 形态前置：必须是统一 server 形态（web 与 control 同 host pid）且 driver:worker 在跑 ────────
  // ⛔ 在【合并前的 13 进程形态】上产出的记录不能取假：那条路径本来就不杀在飞子进程，读数不区分
  // 「合并后保住了」与「合并后这条路径根本没被服务级 restart 管到」（DoD 逐字禁止）。
  const carrier = readServerCarrier(root);
  if (!carrier) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: `no readable ${SERVER_STATE_REL} in ${root} — not the unified server form` });
    return 2;
  }
  const web = carrier.services.find((s) => s.name === "web");
  const controlSvc = carrier.services.find((s) => s.name === "control");
  const sameHost = web !== undefined && controlSvc !== undefined && web.pid === carrier.pid && controlSvc.pid === carrier.pid;
  if (!sameHost) {
    out(json, {
      ac: AC_ID,
      verdict: "NOT-EVALUATED",
      reason: `the carrier does not report web and control on ONE host pid (host=${carrier.pid}, web=${web?.pid ?? "absent"}, control=${controlSvc?.pid ?? "absent"}) — not the unified form (SPEC §6.9 阶段 A2)`,
    });
    return 2;
  }

  const at = new Date().toISOString(); // the EARLIEST observation instant — see Readings.at

  // ── ② 独立推导在飞集合（⛔ 不采信 .quay/worker-driver-inflight.pid）───────────────────────────
  const driverPidFile = workerDriverPidFile(root);
  const driverPidBefore = readPidFileAbs(driverPidFile);
  if (driverPidBefore === null) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: `${driverPidFile} is absent/unreadable — driver:worker does not appear to be running` });
    return 2;
  }
  // ⛔ 形态判定必须【先于任何动作】：下面这个分支是唯一挡在「SIGTERM 一个承载六个 kind 的 anchor
  // 进程」之前的东西（阶段 C 起 `.quay/<prefix>.pid` 的内容是 anchor 的 pid，六个文件一个 pid）。
  const anchor = readAnchor(root);
  if (!aliveNonZombie(driverPidBefore)) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: `the pid in ${driverPidFile} (${driverPidBefore}) is not alive-and-non-zombie — refusing to sample a corpse` });
    return 2;
  }
  // ⚠️ 独立推导放在【所有拒绝之前】：它是纯读操作，而且**拒绝路径上它恰恰最有价值** ——
  // 「自报集合 vs 进程树推导」的并列读数在形态被拒时同样成立，把两个数字都贴出来，才能让人
  // 看见它们差多少（硬规则 4b：被测对象自己维护的集合，在它停摆时恰好也停止更新）。
  const workerName = resolveWorkerProcessName(root);
  const declaredBefore = parsePidFile(readProc(path.join(root, ".quay", `${DRIVER_KINDS.worker.prefix}-inflight.pid`)));
  const inflight = deriveInflight(driverPidBefore, workerName, declaredBefore);
  const derivation = {
    inflight_source: INFLIGHT_SOURCE,
    inflight_worker_pids_before: inflight.pids,
    inflight_declared_by_driver: inflight.declared,
    inflight_declared_vs_derived: samePidSet(inflight.declared, inflight.pids) ? "identical" : "DIFFERENT — the independent derivation is authoritative",
    driver_children_all: inflight.allChildren,
    driver_children_digest: childDigest(inflight.allChildren),
    workspace_worker_name: workerName,
  };
  const driverPidBeforeAlive = cmdlineIsWorkerDriver(driverPidBefore);
  if (!driverPidBeforeAlive) {
    if (anchor !== null && anchor.pid === driverPidBefore) {
      // 可区分的**结构性**取值（硬规则 3b）：这不是「读不懂」，也不是「没达成」，而是
      // 「本形态下该 AC 的判据不可满足」——必须与上面两者都不同形。
      out(json, {
        ac: AC_ID,
        verdict: "HOSTED-BY-ANCHOR",
        reason:
          `the pid in ${driverPidFile} (${driverPidBefore}) is the ANCHOR process (SPEC §7 stage C, ${ANCHOR_STATE_REL}: ` +
          `kinds=${JSON.stringify(anchor.kinds)}), not a per-kind driver. A per-kind restart in this form is an event-loop ` +
          `respawn INSIDE the anchor, so \`driver_pid_before != driver_pid_after\` — AC-256's criterion — is structurally ` +
          `unsatisfiable here, and the pre-stage-C service path would SIGTERM the anchor and take every hosted kind down. ` +
          `⛔ No restart attempted (record_written=false).`,
        record_written: false,
        anchor_pid: anchor.pid,
        anchor_kinds: anchor.kinds,
        worker_driver_pid_file: driverPidFile,
        ...derivation,
      });
      return 2;
    }
    out(json, {
      ac: AC_ID,
      verdict: "NOT-EVALUATED",
      reason: `the pid in ${driverPidFile} (${driverPidBefore}) is alive but its cmdline does not identify it as any of ${JSON.stringify(WORKER_DRIVER_MARKERS)} (cmdline: ${JSON.stringify(procCmdline(driverPidBefore))}) — refusing to act on an unrelated process`,
      record_written: false,
      ...derivation,
    });
    return 2;
  }
  const inflightBeforeAllAlive = inflight.pids.length > 0 && inflight.pids.every((p) => aliveNonZombie(p));
  if (inflight.pids.length < 1) {
    // 空集 ⇒ NOT-EVALUATED、⛔ 不写记录、⛔ 不得为凑读数而制造假在飞 worker（DoD 逐字）。
    out(json, {
      ac: AC_ID,
      verdict: "NOT-EVALUATED",
      reason: `no in-flight worker child of driver pid ${driverPidBefore} matched the workspace worker name '${workerName}' — 'not one of them died' would be vacuously true (空转控制 a). Children seen: ${JSON.stringify(childDigest(inflight.allChildren))}`,
      record_written: false,
      ...derivation,
    });
    return 2;
  }
  if (!inflightBeforeAllAlive) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: `in-flight set ${JSON.stringify(inflight.pids)} contains a dead/zombie pid — vacuous-before-set control (空转控制 b)`, record_written: false, ...derivation });
    return 2;
  }
  const roundBefore = readWorkerRound(root);
  if (roundBefore === null) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: `${WORKER_ROUND_REL} is missing/unreadable — cannot establish that the driver was turning BEFORE the restart` });
    return 2;
  }

  // ── ③ 执行服务级重启（⛔ 不碰其余五个 kind）────────────────────────────────────────────────────
  let restart: { argv: string[]; exit: number; stdout: string; stderr: string };
  let via: string;
  const restartedAt = new Date().toISOString();
  if (control === "no-op-read") {
    // 结构性控制（安全，⛔ 不碰任何生产进程）：拿一条**纯读**命令顶替重启动作。driver pid 因此
    // 不可能移动 ⇒ 生产者必须拒写（NOT-A-RESTART），这证明 `driver_pid_before != driver_pid_after`
    // 这个字段在做功、而不是装饰。
    // ⚠️ 为什么控制不写成「对在跑的服务调 `start`」：本工作区的 worker driver 可以是**孤儿**
    // （supervisor 死、driver 进程还在 —— 2026-09-13 实测就是这个状态），而 kernel 里
    // `quay driver start` 对孤儿 driver 的设计行为是「杀掉孤儿再起一个 supervisor」
    // （driver-runtime.ts startKind 的 orphan 分支）。那会真的杀掉生产驱动 —— 一个「负控制」绝不能
    // 有副作用。§6.9 不变式 1（start 不静默重启）的活体对照因此放在 CLI 的单测里，与它的既有
    // fixture driver 一起做，而不在这里拿生产驱动冒险。
    restart = runCli(cli, ["server", "status", "--json", "--root", root], root);
    via = `${cli} server status --json --root ${root} (STRUCTURAL CONTROL: a pure read stands in for the restart, so the driver pid cannot move)`;
  } else {
    restart = runCli(cli, ["server", "restart", "--only", RESTARTED_SERVICE, "--json", "--root", root], root);
    via = `${cli} server restart --only ${RESTARTED_SERVICE} --json --root ${root}`;
  }

  // ── ④ 等到「新 driver pid 活了 ∧ 新 run_id 出现且 ts 晚于重启时刻」────────────────────────────
  let waited = 0;
  let driverPidAfter: number | null = null;
  let roundAfter: RoundReading | null = null;
  for (;;) {
    driverPidAfter = readPidFileAbs(driverPidFile);
    roundAfter = readWorkerRound(root);
    const pidMoved =
      driverPidAfter !== null && driverPidAfter !== driverPidBefore && aliveNonZombie(driverPidAfter) && cmdlineIsWorkerDriver(driverPidAfter);
    const resumed =
      roundAfter !== null &&
      roundAfter.runId !== "" &&
      roundAfter.runId !== roundBefore.runId &&
      Number.isFinite(isoMs(roundAfter.ts)) &&
      isoMs(roundAfter.ts) > isoMs(restartedAt);
    if (pidMoved && resumed) break;
    if (waited >= windowMs) break;
    await sleep(5000);
    waited += 5000;
  }

  // ── ⑤ after 读数：旧 pid 是否真的不在 ∧ 对【原集合】逐个再核活 ────────────────────────────────
  const driverPidAfterAlive = driverPidAfter !== null && aliveNonZombie(driverPidAfter) && cmdlineIsWorkerDriver(driverPidAfter);
  const driverPidBeforeAliveAfter = aliveNonZombie(driverPidBefore) && cmdlineIsWorkerDriver(driverPidBefore);
  const inflightAliveAfter = aliveAmong(inflight.pids);

  const readings: Readings = {
    at,
    restartedAt,
    driverPidBefore,
    driverPidAfter,
    driverPidBeforeAlive,
    driverPidBeforeAliveAfter,
    driverPidAfterAlive,
    inflightBefore: inflight.pids,
    inflightBeforeAllAlive,
    inflightDeclared: inflight.declared,
    inflightAllChildren: inflight.allChildren,
    inflightAliveAfter,
    workerRunIdBefore: roundBefore.runId,
    workerRoundBefore: roundBefore.round,
    workerRunIdAfter: roundAfter?.runId ?? "",
    workerRoundAfter: roundAfter?.round ?? null,
    workerRoundTsAfter: roundAfter?.ts ?? "",
    workerRoundMtime: roundMtimeIso(root),
    restartedService: RESTARTED_SERVICE,
    restartedVia: via,
    restartedArgv: restart.argv,
    restartedExit: restart.exit,
    restartedStdout: (restart.stdout || "").trim().slice(0, 4000),
    controlMode: control,
  };
  const built = buildRecord(readings);

  // ── ⑥ 合格才写；⛔ 不合格 ⇒ 零记录 + 可区分 verdict + 非 0 ─────────────────────────────────────
  if (!built.ok) {
    out(json, {
      ac: AC_ID,
      verdict: built.verdict,
      reason: built.reason,
      record_written: false,
      readings: {
        at,
        restarted_at: restartedAt,
        driver_pid_before: driverPidBefore,
        driver_pid_after: driverPidAfter,
        driver_pid_before_alive: driverPidBeforeAlive,
        driver_pid_before_dead_after: !driverPidBeforeAliveAfter,
        driver_pid_after_alive: driverPidAfterAlive,
        inflight_worker_pids_before: inflight.pids,
        inflight_worker_pids_alive_after: inflightAliveAfter,
        inflight_declared_by_driver: inflight.declared,
        driver_children_all: inflight.allChildren,
        worker_run_id_before: roundBefore.runId,
        worker_run_id_after: roundAfter?.runId ?? null,
        worker_round_ts_after: roundAfter?.ts ?? null,
        worker_round_jsonl_mtime: roundMtimeIso(root),
        waited_ms: waited,
        restarted_exit: restart.exit,
        restarted_stdout: (restart.stdout || "").trim().slice(0, 2000),
      },
    });
    return built.verdict === "NOT-EVALUATED" ? 2 : 1;
  }

  const carrierPath = path.join(root, CARRIER_REL);
  fs.mkdirSync(path.dirname(carrierPath), { recursive: true });
  // Digest of EVERY direct child (not just the ones kept) — so "what was excluded" stays auditable.
  const record = { ...(built.record as Record<string, unknown>), driver_children_digest: childDigest(inflight.allChildren) };
  fs.appendFileSync(carrierPath, JSON.stringify(record) + "\n");
  out(json, {
    ac: AC_ID,
    verdict: "OK",
    record_written: true,
    carrier: CARRIER_REL,
    workspace_root: root,
    waited_ms: waited,
    record,
  });
  return 0;
}

// Direct-entry guard — the repo's name-based convention (gate-script-base.ts's isDirectEntry is
// REQUIRED to be name-based: under bundling every inlined module shares one `import.meta.url`, so a
// URL comparison fires for libraries too — the 2026-09-13 incident where three bundled drivers all
// executed the first inlined library's main).
if (isDirectEntry(import.meta, undefined, "server-restart-inflight-verify")) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
