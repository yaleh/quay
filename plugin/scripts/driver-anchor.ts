// plugin/scripts/driver-anchor.ts — GOAL-017/AC-255（SPEC-unified-quay-server §7 阶段 C / §6.1）。
//
// WHY THIS EXISTS（一句话）：阶段 C 之前，六个 driver kind 各自 = **两个** OS 进程（supervisor + driver）
// = 12 个长驻进程 + `quay serve` = 13；`ps` 能逐个看出谁死了，但启动/停止/健康判定要在 8 张 registry
// 表之间来回。本文件把那 12 个进程收成**一个** anchor 进程：六个 kind 的常驻循环在**事件循环层**并发
// 运行，每个循环各有一个**独立错误边界 + 重启计数**（§6.1：把 respawn 从 OS 进程层降到事件循环层），
// 剩下的不可恢复故障（OOM / 段错误）由这一个 anchor 兜——⛔ 不是六个 supervisor。
//
// ⛔ 这不是重写判定逻辑：本文件**不碰**任何 kind 的派发/判停/归因语义。它做的只有一件新事——**换进程
// 边界**。每个 kind 的循环仍由它自己的模块实现（promotion-driver.ts / worker-driver.ts / …），anchor
// 经该模块**既有的 `main(argv)` 入口**在同一进程内调用它（同 argv 形态 ⇒ 同一条码路）。
//
// ── 收敛后各读数的含义（AC-255 的判据形状决定了这些必须写死在这里）────────────────────────────────
//   `.quay/<prefix>.pid`            每个 kind 一份，内容是 **anchor 的 pid**（六个文件一个 pid）
//   `.quay/<prefix>-supervisor.pid` 阶段 C 起**退役**——anchor 承担 respawn，⛔ 不再有 supervisor 层
//   `.quay/anchor.pid`              anchor 自身 pid（⛔ 刻意不叫 `*-driver.pid`，见 driver-runtime 注释）
//   `.quay/anchor-desired.json`     期望托管的 kind 集合（声明式；`quay driver start/stop --kind X` 改它）
//   `.quay/anchor.json`             结构化回读面 {pid, startedAt, kinds, host, bundle, takeover}
//   `.quay/anchor-takeover.json`    **接管异常**记录（无此文件 = 干净交接/未发生接管；三态见 TakeoverRecord）
//
// ⛔ **本文件是【唯一】把多个 kind 收进一个进程的地方**——若未来某个 kind 需要独立进程（例如 CPU 密集
// 到会饿死其余 kind，SPEC §9 开放问题 1），正确做法是给它一个单独的 anchor 实例（`--kinds <一个>`），
// 而**不是**在 kind 文件里另写一份循环。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import {
  DRIVER_KINDS,
  KNOWN_KINDS,
  anchorPaths,
  appendLog,
  driverArgvForKind,
  pidArgFile,
  pidAlive,
  preferredAnchorKernel,
  kindDeclarationMap,
  readAnchorPid,
  readDeclarationSnapshot,
  readDesired,
  readKindStops,
  rebuildKernelBundle,
  requestKindStop,
  resolveKernelSibling,
  sourceChangedSince,
  sourceWatch,
  spawnAnchor,
  statePaths,
  ts,
  undeclaredKinds,
  writeDesired,
  type AnchorBundleReading,
  type AnchorDesiredEntry,
  type DeclarationSnapshot,
  type DriverKind,
  type KernelBundleRebuildResult,
  type KernelBundleSyncState,
} from "./driver-runtime.ts";

/** 一个 kind 循环的运行记录。 */
interface KindTask {
  stop: () => void;
  /** 循环任务结束（含 anchor 请求停机后的收尾）才会 resolve。 */
  done: Promise<void>;
}

export interface AnchorOptions {
  root: string;
  /** 启动时的托管集合。缺省 = 盘上期望态；盘上也没有 ⇒ 全部六个（冷启动=全量，与旧 `drivers skill`
   *  逐个 start 的终态一致）。 */
  kinds?: DriverKind[];
  /** 接管的旧 anchor pid（源码自刷新用）：等它退出后再写 anchor.pid / 起循环，⛔ 不做双写。 */
  takeoverPid?: number | null;
  /** 事件循环层 respawn 的退避基准（秒，缺省 5，与旧 supervisor 的 --restart-delay 同值）。 */
  restartDelaySecs?: number;
  /** 期望态 reconcile 周期（ms，缺省 500）。 */
  reconcileMs?: number;
  /** 测试缝：跑满 N 轮 reconcile 后停机退出（⛔ 生产不传 = 常驻）。 */
  maxReconcilePasses?: number | null;
  /** 日志落点覆盖（测试缝）；缺省 `<root>/<ANCHOR_LOG_REL>`。 */
  logFile?: string;
  /** 测试缝：注入「遇到某 kind 的循环实现」的方式。缺省 = 动态 import 该 kind 的 driver 模块并调 main()。 */
  invokeKind?: (kind: DriverKind, root: string, runId: string, entry: AnchorDesiredEntry) => Promise<number>;
}

/** 调用一个 kind 的**既有**常驻循环入口（同 argv 形态 ⇒ 同一条码路，⛔ 不复制判定逻辑）。
 *
 *  ⚠️ 动态 import 的目标是 `resolveKernelSibling` 解析出的**同一个绝对路径**——这样 `driver-runtime.ts`
 *  在本进程里只有**一个**模块实例，`registerKindStop` 的登记表才与各 kind 看到的是同一张。
 *  ⛔ 不要给 import URL 加 `?t=` 之类的时间戳缓存破坏：那会加载第二份 driver-runtime，
 *  登记表随之分裂（停机信号发到一份、循环听的是另一份 ⇒ 停机静默失效）。源码推进的自刷新走
 *  **整个 anchor 重启**（见 maybeSelfRefresh），⛔ 不是模块级热重载。 */
async function invokeKindDefault(kind: DriverKind, root: string, runId: string, entry: AnchorDesiredEntry): Promise<number> {
  const spec = DRIVER_KINDS[kind];
  const sibling = resolveKernelSibling(spec.driver);
  if (!sibling) throw new Error(`driver-anchor: driver module not found for kind=${kind} (${spec.driver})`);
  const mod = (await import(pathToFileURL(sibling.path).href)) as { main?: (argv: string[]) => Promise<number> };
  if (typeof mod.main !== "function") throw new Error(`driver-anchor: ${spec.driver} exports no main()`);
  const argv = [
    process.execPath,
    spec.driver,
    ...driverArgvForKind(root, kind, {
      cap: entry.cap,
      interval: entry.interval,
      reconcileInterval: entry.reconcileInterval,
      pidFile: pidArgFile(root, kind),
      runId: entry.runId ?? runId,
    }),
  ];
  return await mod.main(argv);
}

/** 启动一个 kind 的常驻循环（含事件循环层错误边界 + 重启计数）。
 *
 *  §6.1 的对应关系，逐条可核：
 *    `独立错误边界`  每个 kind 一个 async 任务，循环体抛错被本任务的 try/catch 捕获 ⇒ ⛔ 不波及其余 kind
 *    `重启计数`      非预期返回/抛错 ⇒ 退避重启（计数只增不减，落在 anchor 日志里，⛔ 不静默）
 *    `一个外层 anchor` 只有本进程；⛔ 没有六个 supervisor
 *
 *  ⛔ 循环**正常结束**（`requestKindStop` 之后）不算「崩溃」，⛔ 不重启——否则 `stop --kind X` 会变成
 *  「停了又自己起来」，即 §6.9 不变式 1 的反面。 */
function startKindTask(
  kind: DriverKind,
  opts: AnchorOptions,
  log: (line: string) => void,
  active: Map<DriverKind, KindTask>,
  entry: AnchorDesiredEntry = {},
): KindTask {
  const st = statePaths(opts.root, kind);
  const restartDelayMs = Math.max(1, opts.restartDelaySecs ?? 5) * 1000;
  const runId = `${DRIVER_KINDS[kind].runPrefix}-anchor`;
  const invoke = opts.invokeKind ?? invokeKindDefault;

  let stopRequested = false;
  const stop = (): void => { stopRequested = true; requestKindStop(kind); };

  // `.quay/<prefix>.pid` = **anchor 的 pid**（六个 kind 一份一个 pid）。这正是「一个进程承载六个
  // kind」的诚实表示；AC-255 的判据读它并**按 pid 去重**，故六个 kind 只贡献 1 个存活进程。
  //
  // ⚠️ 写者分工**不变**（见 driverPidIsReadinessMarker）：`pidSelf=true` 的五个 kind 由**驱动自己**
  // 在进入常驻循环后写（`--pid-file` 指向同一个文件）⇒ 该文件仍然是「走到了自己的循环」这个**直接量**，
  // ⛔ 不能由 anchor 抢先预写（那会把「刚 spawn」伪装成「已就绪」——gap-driver-start-false-confirms-
  // unsettled-driver 的根因）。只有 `pidSelf=false`（worker：它的 --pid-file 是 in-flight 文件）才由
  // anchor 写 driver pid 文件——与旧 supervisor 的写者分工逐字相同。
  if (!DRIVER_KINDS[kind].pidSelf) {
    try {
      fs.writeFileSync(st.driverPidFile, `${process.pid}\n`, "utf8");
    } catch (e) {
      log(`${ts()} anchor: cannot write ${st.driverPidFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // 阶段 C：supervisor 退役 —— 残留的 supervisor pid 文件会让 `aliveness()` 报 stale_supervisor_pidfile。
  try {
    fs.rmSync(st.supervisorPidFile, { force: true });
  } catch { /* ignore */ }

  const done = (async (): Promise<void> => {
    let restarts = 0;
    for (;;) {
      const startedAt = Date.now();
      try {
        const code = await invoke(kind, opts.root, runId, entry);
        log(`${ts()} anchor: kind=${kind} loop returned code=${code} after ${Date.now() - startedAt}ms`);
      } catch (e) {
        // 独立错误边界：一个 kind 的循环抛错 ⛔ 不带倒其余 kind（这就是 §6.1 用事件循环层边界换来的
        // 那部分隔离；⛔ 不声称它等于 OS 进程隔离——见 SPEC §6.1 的反面论证）。
        log(`${ts()} anchor: kind=${kind} loop THREW after ${Date.now() - startedAt}ms: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`);
      }
      // 期望态里已经不要它了（stop / drain 到终态）⇒ 正常收尾，⛔ 不重启。
      const wanted = readDesired(opts.root)?.kinds ?? [];
      if (stopRequested || !wanted.includes(kind)) break;
      restarts += 1;
      const delay = Math.min(restartDelayMs * restarts, 60_000);
      log(`${ts()} anchor: kind=${kind} restarting in ${delay}ms (event-loop respawn #${restarts}, SPEC §6.1)`);
      await new Promise<void>((r) => setTimeout(r, delay));
      if (stopRequested || !(readDesired(opts.root)?.kinds ?? []).includes(kind)) break;
    }
    // 收尾：摘掉本 kind 的 pid 文件 —— 留着会让「已经在跑」与「已经停了」同形（硬规则 3b）。
    try { fs.rmSync(st.driverPidFile, { force: true }); } catch { /* ignore */ }
    active.delete(kind);
    log(`${ts()} anchor: kind=${kind} loop stopped`);
  })();

  const task: KindTask = { stop, done };
  active.set(kind, task);
  log(`${ts()} anchor: kind=${kind} loop started (pid=${process.pid})`);
  return task;
}

// ── 接管等待预算（D2）与接管异常载体（D3） ─────────────────────────────────────────────────────────
//
// 现场（2026-09-18，全部从 `.quay/anchor.log` 与代码读出，⛔ 非推断）：stop 请求 15:33:25 → 旧 anchor
// **233s 后**才退出（`anchor: exited` 15:37:18），而接管者的等待预算是 `shutdownGraceMs + 60_000`
// = 180s ⇒ 15:36:20 `REFUSING to start`，随后替换进程退出、旧 anchor 也退出 ⇒ **零 anchor 27 分钟**
// （直到人手工重启 drivers）。三个缺陷在本段收口：
//   D1 `!stopping` 闸（见 reconcile 的起分支）：停机后⛔ 不再拉起任何 kind ⇒ 旧 anchor 真的会排空。
//   D2 预算从**旧 anchor 的真实最坏退出**派生，⛔ 不是 `grace + 60_000`——后者在 grace ≥ 60s 时
//      **恰好等于**最坏退出时间（不是一个**超过**它的上界）⇒ 一次「正确但慢」的交接被判为失败。
//   D3 「放弃」不再是**终态**：超预算只把这次交接**标成异常**并**继续等**旧 pid 退出；旧 pid 一死就
//      接管（那时双派发在结构上不可能——旧进程已经不在）。真的等不到（观察窗内旧 pid 始终不退）才
//      放弃，且必须留下**机器可读**的记录，⛔ 不是只打一行日志。

/** 旧 anchor 的**真实最坏退出时间**（ms）。与 runAnchor 的两段**有界**等待逐字对应：
 *   ① 有界停机宽限 `shutdownGraceMs`（下面 `stopping` 支超时即 break）；
 *   ② 循环收尾等待 `Math.min(60_000, shutdownGraceMs)`（收尾循环那句）。
 *  ⚠️ 它是**代码里两段等待的上界**，⛔ 不是「这个进程一定会在此时刻前退出」的保证——调度抖动可以让
 *  reconcile 的 500ms 定时器晚到几十秒（2026-09-18 实测：宽限 120s 的那段实际走了 162s）。正因为
 *  这一点，D3 必须让「超预算」可继续，⛔ 不能靠把余量调大来掩盖。 */
export function oldAnchorWorstExitMs(shutdownGraceMs: number): number {
  const grace = Math.max(0, shutdownGraceMs);
  return grace + Math.min(60_000, grace);
}

/** 超预算的余量（ms）：覆盖「停机请求被察觉」的最坏延迟（≤ reconcileMs）与收尾清理。
 *  ⚠️ 这是**分类阈值**（「这还算一次正常交接吗」），⛔ **不是**接管与否的分界——超过它只是把交接
 *  标成异常并继续等（D3）。故它的取值 ⛔ 不影响正确性，只影响异常被记下的早晚。 */
export const TAKEOVER_MARGIN_MS = 20_000;

/** 接管等待预算（ms）= 旧 anchor 的真实最坏退出 + 察觉延迟 + 余量。
 *  `QUAY_ANCHOR_TAKEOVER_BUDGET_MS` 覆盖（测试缝/运维；⛔ 不是「不设限」的替代表达，见硬规则 4 推论二）。 */
export function takeoverBudgetMs(shutdownGraceMs: number, reconcileMs: number): number {
  const override = Number(process.env.QUAY_ANCHOR_TAKEOVER_BUDGET_MS ?? "");
  if (Number.isFinite(override) && override > 0) return override;
  return oldAnchorWorstExitMs(shutdownGraceMs) + Math.max(0, reconcileMs) + TAKEOVER_MARGIN_MS;
}

/** 超预算之后**继续观察**旧 pid 的上限（ms，缺省 30 分钟）。
 *  等满仍在 ⇒ 放弃启动并留痕：旧 anchor 彻底卡死时接管不可能安全（双派发比「晚一点接管」贵得多）。 */
export function takeoverAbandonWatchMs(): number {
  const raw = Number(process.env.QUAY_ANCHOR_TAKEOVER_ABANDON_WATCH_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 1_800_000;
}

/** 接管异常的**机器可读**载体：`.quay/anchor-takeover.json`。
 *
 *  ⛔ **刻意不复用 `.quay/anchor.json`**：那个文件由**在任 anchor 每趟 reconcile 重写一次**（见
 *  driver-runtime `readAnchorState` 的注释）⇒ 接管者在等待期写进去的记录会在 500ms 内被覆盖，
 *  「写了」与「没写」同形（硬规则 3b）。本文件只由**接管者**写，故外部读得到。
 *  ✅ 同一个记录经 `writeState()` 的 `takeover` 字段**出现在 `.quay/anchor.json` 上**——那是 manager/
 *  外层已经在读的面（与 `bundle` 字段同形）⇒ 本条读数有既有消费者，⛔ 不是只给 fixture 看的。
 *  ⛔ state 三态互斥、且「无此文件」= 干净交接（或根本没有接管），四者**不共用取值**：
 *    takeover-abandoned          超预算但旧 pid 仍在——本进程还在等，旧 pid 一死即接管
 *    taken-over-after-abandon    旧 pid 已死、本进程已接管（异常已收敛）
 *    takeover-abandoned-gave-up  观察窗内旧 pid 始终不退——本进程放弃启动并退出（双派发硬闸）
 *  读方若要判「异常此刻仍在进行中」，须同时 `kill -0` 记录里的 `pid`（进程被 SIGKILL 时记录会留在盘上，
 *  ⛔ 与「正在等」同形）。 */
export const ANCHOR_TAKEOVER_REL = ".quay/anchor-takeover.json";
export type TakeoverState = "takeover-abandoned" | "taken-over-after-abandon" | "takeover-abandoned-gave-up";
export interface TakeoverRecord {
  state: TakeoverState;
  /** 写这条记录的进程（= 接管者）。 */
  pid: number;
  /** 在等的旧 anchor pid。 */
  waitingOn: number;
  budgetMs: number;
  waitedMs: number;
  at: string;
}

function takeoverRecordFile(root: string): string {
  return path.join(root, ANCHOR_TAKEOVER_REL);
}

function writeTakeoverRecord(root: string, rec: TakeoverRecord): void {
  try {
    const f = takeoverRecordFile(root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec) + "\n", "utf8");
  } catch { /* 回读面写失败不致命：日志行仍在（⛔ 但也不假装写成了） */ }
}

/** 读接管异常记录。缺 / 不可解析 ⇒ null。
 *  ⚠️ 这里「没有」与「读不懂」共用 null 是**可接受**的：本条读数**不触发任何动作**（只被展示），
 *  ⛔ 与 bundle 那类要动作的判定不同（那种形态必须给「未评估」独立取值，硬规则 3b）。 */
export function readTakeoverRecord(root: string): TakeoverRecord | null {
  try {
    const o = JSON.parse(fs.readFileSync(takeoverRecordFile(root), "utf8")) as { state?: unknown };
    return typeof o?.state === "string" ? (o as TakeoverRecord) : null;
  } catch { return null; }
}

/** 常驻 anchor 主体：托管若干 kind 的循环，reconcile 期望态，直到收到停机请求。 */
export async function runAnchor(opts: AnchorOptions): Promise<number> {
  const logFile = opts.logFile ?? anchorPaths(opts.root).logFile;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (line: string): void => { appendLog(logFile, line); };

  const shutdownGraceMs = Number(process.env.QUAY_ANCHOR_SHUTDOWN_GRACE_MS ?? 120_000);

  // 接管：等旧 anchor 退出后再写自己的 pid 文件（⛔ 不做双写——两个 anchor 同时调度 = **双派发**）。
  //
  // ⚠️ 实测缺陷（2026-09-13 生产现场，代价：两个 anchor 并发跑了同一组六个 kind 约 3 分钟）：
  // 初版等 60s，而旧 anchor 的**有界停机宽限是 120s** ⇒ 60s 到点时旧 anchor 仍在 drain，初版打印
  // 「STILL ALIVE after 60s (starting anyway)」**照样起循环** ⇒ 两个进程同时派发。修法两条，缺一不可：
  //   ① 等待上限必须 **> 停机宽限**（否则「等」永远等不到一个正常收敛的旧 anchor）；
  //   ② 到点仍活着 ⇒ **放弃接管并退出**（⛔ 不是「照样起」）—— 延迟自刷新是可恢复的，双派发不是。
  //
  // ⚠️ ② 在 2026-09-18 被**再修一次**（D2+D3）：① 的预算只到「宽限 + 60s」，而旧 anchor 的真实最坏
  // 退出是「宽限 + min(60s, 宽限) + 察觉延迟 + 清理」——两者在宽限 ≥ 60s 时**相等**，不是一个严格
  // 上界；实测 233s > 180s ⇒ `REFUSING`。同时 ② 的「放弃」是**终态**（只打一行日志就退出），于是旧
  // anchor 随后退出 = 零 anchor。现在：预算按真实最坏退出派生（D2），且超预算**不等于**放弃接管——
  // 它降级为「继续等旧 pid 退出，一死就接管」（D3）。「放弃」只在观察窗内旧 pid 始终不退时发生，
  // 且必然留一条机器可读记录。
  if (opts.takeoverPid) {
    const budgetMs = takeoverBudgetMs(shutdownGraceMs, opts.reconcileMs ?? 500);
    const waitT0 = Date.now();
    const deadline = waitT0 + budgetMs;
    while (pidAlive(opts.takeoverPid) && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    if (pidAlive(opts.takeoverPid)) {
      // ── 超预算 ⇒ 交接**分类**变了，但交接本身⛔ 没有失败（D3）─────────────────────────────────
      const waitedMs = Date.now() - waitT0;
      log(
        `${ts()} anchor: takeover ${opts.takeoverPid} STILL ALIVE after ${budgetMs}ms (waited ${waitedMs}ms) — ` +
        `abandoning the NORMAL-handoff CLASSIFICATION only (state=takeover-abandoned in ${ANCHOR_TAKEOVER_REL}), ` +
        `NOT the takeover: still watching for ${opts.takeoverPid} to exit — starting now would double-dispatch, ` +
        `but once the old pid is gone there is nothing left to race`,
      );
      // ⛔ 先留痕、**再**等：要求记录某动作就不能把该动作排在记录之后（硬规则 7 的镜像）——「正在等」
      // 必须在等待**之前**可读，否则读方在整段等待里看到的都是「什么都没有」（与「一切正常」同形）。
      writeTakeoverRecord(opts.root, {
        state: "takeover-abandoned", pid: process.pid, waitingOn: opts.takeoverPid, budgetMs, waitedMs, at: ts(),
      });
      const watchMs = takeoverAbandonWatchMs();
      const watchDeadline = Date.now() + watchMs;
      while (pidAlive(opts.takeoverPid) && Date.now() < watchDeadline) {
        await new Promise<void>((r) => setTimeout(r, 200));
      }
      if (pidAlive(opts.takeoverPid)) {
        const totalMs = Date.now() - waitT0;
        writeTakeoverRecord(opts.root, {
          state: "takeover-abandoned-gave-up", pid: process.pid, waitingOn: opts.takeoverPid, budgetMs, waitedMs: totalMs, at: ts(),
        });
        log(
          `${ts()} anchor: takeover ${opts.takeoverPid} still alive after ${totalMs}ms total ` +
          `(${watchMs}ms of watching beyond the ${budgetMs}ms budget) — REFUSING to start (two anchors would ` +
          `double-dispatch); this refresh attempt is abandoned and recorded in ${ANCHOR_TAKEOVER_REL}`,
        );
        return 1;
      }
      const lateMs = Date.now() - waitT0;
      log(
        `${ts()} anchor: takeover ${opts.takeoverPid} exited at last (after ${lateMs}ms, ${lateMs - budgetMs}ms ` +
        `past the budget) — taking over (double-dispatch is impossible: the old pid is gone)`,
      );
      writeTakeoverRecord(opts.root, {
        state: "taken-over-after-abandon", pid: process.pid, waitingOn: opts.takeoverPid, budgetMs, waitedMs: lateMs, at: ts(),
      });
    } else {
      log(`${ts()} anchor: takeover ${opts.takeoverPid} exited — taking over`);
    }
  }
  // 双派发硬闸（与上面的等待互补，覆盖「等待被绕过 / 无 --takeover 的并发起法」）：盘上 anchor.pid
  // 指向一个**活着的、不是我**的进程 ⇒ 拒绝起循环。宁可不起，⛔ 不可两个 anchor 同时派发。
  {
    const incumbent = readAnchorPid(opts.root);
    if (incumbent !== null && incumbent !== process.pid && pidAlive(incumbent)) {
      log(`${ts()} anchor: another anchor is live (pid=${incumbent}, me=${process.pid}) — REFUSING to start (double-dispatch guard)`);
      return 1;
    }
  }

  const paths = anchorPaths(opts.root);
  try {
    fs.writeFileSync(paths.pidFile, `${process.pid}\n`, "utf8");
  } catch (e) {
    process.stderr.write(`driver-anchor: cannot write ${paths.pidFile}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  const hostStartedAt = Date.now();
  const active = new Map<DriverKind, KindTask>();

  // **本进程加载的那份 kernel 文件的构建时刻**（gap-ac259-frozen-reading-stale-staging-kernel）：
  // `sourceWatch(kind).state === "mirror"`（本内核是一份构建产物）时，「本内核陈旧了吗」的直接量是
  // 「源树最新 mtime > 本文件的 mtime」——⛔ 不是「> hostStartedAt」：后者随重启往后推，于是「重启
  // 一次就假装新鲜」，而这份 mtime 是不随重启变的常量。读不到 ⇒ 0 ⇒ 该判据不成立（⛔ 不把「读不懂」
  // 当「陈旧」，硬规则 3b）。
  let kernelBuiltAt = 0;
  let kernelPathForLog = "";
  try {
    kernelPathForLog = fileURLToPath(import.meta.url);
    kernelBuiltAt = fs.statSync(kernelPathForLog).mtimeMs;
  } catch { kernelBuiltAt = 0; }
  // 「陈旧且换不动」这条读数只在其 kinds 集合变化时打一次（⛔ 每 500ms reconcile 刷屏）。
  let staleBundleLogged = "";
  // 同款（AC-255 能力半边）：「静默脱离期望态」的 kind 集合变化时才打一行，⛔ 不刷屏。
  let lastUndeclaredLogged: string | null = null;

  // ── 陈旧 bundle 的**动作面**（gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation）──
  //
  // 在这条之前，「本内核比源树旧」只有**一条日志行**：检测在、读数诚实、**没有消费者** ⇒ 静默 2 天，
  // 期间落地的修复（立案步）在源里、不在跑的那个产物里。本段给它两样东西：
  //   ① **机械重建**（+ 整进程重启把它加载进来）—— 那正是日志行一直在喊、而没有人执行的那个动词；
  //   ② 一个**结构化的独立取值**（`.quay/anchor.json` 的 `bundle` 字段，见 `KernelBundleSyncState`）
  //      —— 让「陈旧且换不动」在机器可读面上⛔ 不再与「新鲜」同形（硬规则 3b）。
  //
  // ⚠️ 重建**有冷却**：重建成功后本进程内存里仍是旧代码，若不重启，`bundleStale` 会一直为真 ⇒
  // 每趟 reconcile 重建一次 = 重建风暴。冷却 + 「成功过就不再重试」两道一起挡。
  const rebuildCooldownMs = Math.max(0, Number(process.env.QUAY_ANCHOR_BUNDLE_REBUILD_COOLDOWN_MS ?? 600_000));
  // 测试缝/运维：重建成功后**不**重启（默认重启——⛔ 只重建不重启等于把日志里的建议照抄一遍，
  // 因为本进程的 ESM 缓存按 URL，重建的文件不会被已加载的进程看见）。
  const rebuildNoRestart = process.env.QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART === "1";
  let lastRebuildAtMs = 0;
  let lastRebuildResult: KernelBundleRebuildResult | null = null;
  let lastRebuildIso: string | null = null;
  let bundleReading: AnchorBundleReading = {
    state: "not-evaluated", kernel: null, builtAt: null, sourceDir: null, sourceMtime: null,
    kinds: [], rebuild: null, at: null,
  };

  // 启动集合：显式 kinds > 盘上期望态 > 全部六个（冷启动）。
  const initial = opts.kinds ?? readDesired(opts.root)?.kinds ?? [...KNOWN_KINDS];
  // 盘上没有期望态而我们给了初始集合 ⇒ 落盘，使后续 `start/stop --kind X` 有一个可读改的基底。
  if (readDesired(opts.root) === null) writeDesired(opts.root, initial, "driver-anchor:cold-start");

  // ⚠️ `snap` = 本趟判定用的读盘快照（`DeclarationSnapshot`）。**一趟 reconcile 只读一次期望态**，
  // 并把**同一个对象**同时用于 `wanted`、`silent`（`undeclaredKinds`）与这里的发布面
  // （`kindDeclarationMap`）—— 见下面 reconcile 循环里那条注释（M1 的修法）。
  const writeState = (snap?: DeclarationSnapshot): void => {
    try {
      fs.mkdirSync(path.dirname(paths.stateFile), { recursive: true });
      const body = JSON.stringify({
        pid: process.pid,
        startedAt: new Date(hostStartedAt).toISOString(),
        kinds: [...active.keys()],
        host: "anchor",
        // 内核 bundle 同步读数（每趟 pass 重写；`KernelBundleSyncState` 六态各自独立，⛔ 不与 fresh 同形）。
        bundle: bundleReading,
        // 接管异常读数（D3，`TakeoverRecord`）：无记录 ⇒ **null**，⛔ 与那三个具名态都不共用取值。
        // 放在这里而不是只留在 `.quay/anchor-takeover.json`：`anchor.json` 是 manager/外层已经在读的
        // 回读面（与 `bundle` 同字段同形）⇒ 交接异常在既有消费者那里**可见**，⛔ 不是只给 fixture 看。
        // ⚠️ 在任 anchor 也会把它读到的记录（= 某个接管者写的）原样带上——那正是期望的：此刻确实
        // 有一次交接在进行/已收敛，读方按 `state` + 记录里 `pid` 的存活区分「在等」与「已收敛」。
        takeover: readTakeoverRecord(opts.root),
        // 逐 kind 的**声明状态**（AC-255 能力半边，每趟 reconcile 重写）：`declared` /
        // `stopped-explicitly`（操作员有意停机）/ `not-declared`（**静默脱离期望态**）/ `not-evaluated`。
        // ⛔ 四态各自独立，⛔ 不与 `kinds`（此刻实际在跑的集合）共用输出：`kinds` 少了一个不代表
        // 「有人停的」——那正是本任务要分开的两件事。放在这里而不是只留在 `.quay/anchor-kind-stops.json`：
        // `anchor.json` 是 manager/外层/`server status` 已经在读的回读面（与 `bundle`/`takeover` 同形）。
        // ⛔ 必须与本趟 `silent` 用**同一份快照**（不传 ⇒ 现读一次，那会让两处又变成两次独立读盘）。
        declaration: kindDeclarationMap(opts.root, snap),
      }) + "\n";
      // ── M2：**原子替换**（tmp + rename），⛔ 不是裸 `fs.writeFileSync` ──────────────────────────────
      // 裸写 = `O_TRUNC` 之后写 ⇒ 并发读者可观测到**零长度/半写**的 `.quay/anchor.json`（实测：本机
      // ambient load 下 0/32/96 三档 torn 率 5.6e-4 / 5.2e-4 / 1.4e-3；全量 suite 负载下读者把解析失败
      // 读成 `null`，与「文件不存在」同形 ⇒ `TypeError: Cannot read properties of null (reading 'kinds')`）。
      // 与同一文件族的 `writeDesired`（driver-runtime）逐字同款：读者要么看到完整旧值、要么看到完整新值。
      // ⛔ 字段集与语义逐字未动（只换写入方式）—— `stateFile` 的**读**侧一行未改。
      const tmp = `${paths.stateFile}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, body, "utf8");
      fs.renameSync(tmp, paths.stateFile);
    } catch { /* 回读面写失败不致命（日志行仍在） */ }
  };
  writeState();

  log(`${ts()} anchor: host pid=${process.pid} root=${opts.root} kinds=[${initial.join(",")}] reconcile=${opts.reconcileMs ?? 500}ms`);

  const desiredOpts = (): Record<string, AnchorDesiredEntry> => readDesired(opts.root)?.opts ?? {};
  for (const kind of initial) startKindTask(kind, opts, log, active, desiredOpts()[kind] ?? {});
  writeState();

  let stopping = false;
  let stopRequestedAt = 0;
  // ⚠️ **有界停机**（实测缺陷，2026-09-13）：worker 的常驻循环要到「在飞全部跑完」才 break
  // （`runResidentLoop` 的 `running.length === 0` 那一支，§6.9 不变式 3 要求它 ⛔ 不杀在飞），而在飞
  // worker 的 `--timeout` 缺省是 **0 = 无超时**（SPEC §4④：成本结构未知前不设阈值）。⇒ 「等全部循环
  // 收尾」在结构上可以是**无界**的：实测一次 SIGTERM 之后 anchor 卡在 stopping 态 10 分钟以上不退出。
  // 这里给停机一个**有界宽限**：超时后如实记一条并退出（在飞 worker 子进程是**独立 OS 进程**，⛔ 不会
  // 因 anchor 退出而被杀 —— 与旧 `quay driver stop` 的语义逐字相同：杀调度者，不是在跑的工作）。
  const requestAnchorStop = (): void => {
    if (stopping) return;
    stopping = true;
    stopRequestedAt = Date.now();
    log(`${ts()} anchor: stop requested — stopping ${active.size} kind loop(s) (in-flight worker children NOT killed, SPEC §6.9 inv.3)`);
    for (const t of active.values()) t.stop();
  };
  process.on("SIGINT", requestAnchorStop);
  process.on("SIGTERM", requestAnchorStop);

  // §6.1 的最后一段：一个外层 anchor 兜住**不可恢复**的故障。若某个 kind 的循环漏出一条例外
  // （uncaughtException / unhandledRejection），Node 缺省会**整进程退出** ⇒ 六个 kind 一起死。
  // 这里显式接住并**如实记一条**（⛔ 不静默、⛔ 不假装无事发生）；随后仍退出——因为「anchor 兜住」的
  // 意思正是「由更外层重启它」，而不是「就地假装没发生」（硬规则 3b）。
  const crash = (what: string) => (e: unknown): void => {
    log(`${ts()} anchor: FATAL ${what}: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`);
    process.stderr.write(`driver-anchor: FATAL ${what}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(70);
  };
  process.on("uncaughtException", crash("uncaughtException"));
  process.on("unhandledRejection", crash("unhandledRejection"));

  const reconcileMs = opts.reconcileMs ?? 500;
  let passes = 0;
  for (;;) {
    await new Promise<void>((r) => setTimeout(r, reconcileMs));
    passes += 1;

    // ── M1：**一趟只读一次期望态**，`wanted` / `silent` / 发布面全部派生自这一份快照 ────────────────
    // 修前这里是三次独立读盘（`readDesired` 取 `wanted`；`undeclaredKinds` 内部**再读一次**、
    // 却用**陈旧的 `wanted`** 过滤；`writeState` → `kindDeclarationMap` 又读第三次）。期望态恰好落在
    // 这三者之间时，这一趟会**发布 `not-declared` 而 `silent` 为空 ⇒ 不打那行日志**，诊断行落到下一趟
    // （≤1 个 reconcile 周期）。⇒ 「同一趟的发布面」与「同一趟的日志行」不同现，且只在宿主负载把
    // 那段同步体放大到够撞上时才出现（全量 suite 下随机红）。收敛到一份快照后，该分叉结构上不可能出现。
    // ⛔ 不传 `snap` 的调用（下面启动期的两次 `writeState()`）各自现读一次，那是**有意**的：那两处
    //    不在 reconcile 趟内，没有「同一趟」可言。
    const desired = readDesired(opts.root);
    const wanted = desired?.kinds ?? [];
    const snap: DeclarationSnapshot = { desired, stops: readKindStops(opts.root) };
    // 起：期望态里有而没在跑 ⇒ 起（幂等：已在 active 的就是 no-op，⛔ 不重启——§6.9 不变式 1）。
    //
    // ⛔ `!stopping` 闸（D1，2026-09-18 实测）：停机是**不可逆**态，一旦请求就⛔ 不得再拉起任何 kind。
    //   缺这道闸时，一个刚收尾的 kind 会在**下一趟** reconcile 被重新拉起（`wanted` 仍是盘上期望态，
    //   它不看 `stopping`）⇒ `active` 永不排空 ⇒ 上面那条「有界停机宽限」从**兜底**变成**唯一**的退出
    //   路径，而新拉起的循环又把宽限拖满。实测 anchor.log：15:33:25 `stop requested` → 15:33:53 /
    //   15:34:41 / 15:36:07 三次 `loop started` → 宽限到点后仍等满 `min(60s, grace)` ⇒ **233s** 才退出，
    //   超过接管者的等待预算 ⇒ `REFUSING to start` + 旧 anchor 随后退出 = **零 anchor 27 分钟**。
    if (!stopping) {
      const opts0 = desired?.opts ?? {};
      for (const kind of wanted) {
        // ⚠️ 用**本趟快照**的 opts（⛔ 不是再读一次盘）：同一趟的判定面全部同源。
        if (!active.has(kind)) startKindTask(kind, opts, log, active, opts0[kind] ?? {});
      }
    }
    // 停：在跑而期望态里没有 ⇒ 只停那一个（§6.9 不变式 2：⛔ 不波及其余）。
    for (const kind of [...active.keys()]) {
      if (!wanted.includes(kind)) active.get(kind)?.stop();
    }
    // AC-255 能力半边：**静默脱离期望态**的 kind（既不在期望态里、又没有显式停机记录）。
    // ⛔ 这不是一个「动作」，只是一条读数：reconcile 的**行为**一行未动（它只起 `wanted`）。缺这条读数时，
    //   「有人 `stop --kind X`」与「X 某次被静默移出且无人加回」在**任何**盘上载体上都同形 —— anchor
    //   照常以「一个健康进程」的样子跑剩余 kind，`ps` 看不见少了谁（2026-09-23 实测：`quality`/`meta`
    //   停摆 264min，期间 anchor 健康、其余四个 kind 新鲜）。⛔ 只报 `not-declared`：
    //   `stopped-explicitly` 是**有意**的，混进来 = 每个正常停掉的 kind 每轮报红 = 信号被噪声淹没。
    // ⚠️ 与 `staleBundleLogged` 同款：只在集合**变化**时打一行，⛔ 不每 500ms 刷屏。
    // ⛔ 必须用**本趟快照**（`silent` 与下面 `writeState(snap)` 的发布面同源 ⇒ 同趟一致）。
    //    末尾那个 `!wanted.includes(k)` 现在由快照蕴含（`not-declared` ⇒ 不在 `desired.kinds`），保留它
    //    只是把「日志行 ⊆ 不在 wanted 里的 kind」这条不变量写成断言，⛔ 它不再是一次独立读盘。
    const silent = undeclaredKinds(opts.root, snap).filter((k) => !wanted.includes(k));
    const silentKey = silent.join(",");
    if (silentKey !== lastUndeclaredLogged) {
      lastUndeclaredLogged = silentKey;
      if (silent.length > 0) {
        log(
          `${ts()} anchor: kind(s) absent from the desired set with NO explicit stop record: [${silentKey}] ` +
          `— either an operator stopped them without a record or they were silently dropped ` +
          `(⛔ this anchor will NOT auto-start them: an explicit \`stop --kind X\` must stay stopped, SPEC §6.9 inv.1; ` +
          `restore with \`quay driver start --kind X\`)`,
        );
      }
    }
    writeState(snap);

    // 源码自刷新（AC-184）：被监视源码推进到本 anchor 启动时刻之后 ⇒ 整个 anchor 重启（模块级热重载
    // 会因为双份 driver-runtime 而让停机登记表分裂，见 invokeKindDefault 的注释）。⛔ 只在**确认替换
    // 进程活着**之后才退出——否则一次 spawn 失败 = 六个 driver 一起消失（比不刷新更糟）。
    // ⛔ 只对 **watched**（本内核目录里就有被监视 .ts = dev 源树直跑）的 kind 用「推进到启动时刻之后」
    // 这个基准：对 **mirror**（本内核跑的是构建产物）它是个**错的基准**——重启不会换 bundle 里的代码，
    // 只会把基准往后推（重启一次就「假装新鲜」）。构建产物走下面 bundleStale 那条直接量。
    const stale = [...active.keys()].filter(
      (k) => sourceWatch(opts.root, k).state === "watched" && sourceChangedSince(opts.root, k, hostStartedAt),
    );
    // **本内核这份 bundle 比它的源树旧**（gap-ac259-frozen-reading-stale-staging-kernel）：`mirror` 态
    // 下比的是「源树最新 mtime vs **本进程加载的那份 kernel 文件的 mtime**」，⛔ 不是 vs 本进程启动时刻
    // ——后者在「bundle 早于源码落地、进程却在之后才启动」的形态下报 fresh（本任务的实测形态：
    // bundle 07:35 / 修复 10:17 / 进程 02:15 起 ⇒ 源树 14:45 > 进程 02:15 ⇒ 其实就是 stale，但换个
    // 启动更晚的进程就会假新鲜），而 bundle mtime 是**不随重启变**的常量 ⇒ 该读数不会被重启洗掉。
    // kernelBuiltAt 读不到（文件被删/权限）⇒ 0 ⇒ 该支不成立（⛔ 不把「读不懂」当「陈旧」）。
    const bundleStale = [...active.keys()].filter((k) => {
      if (kernelBuiltAt <= 0) return false;
      const w = sourceWatch(opts.root, k);
      return w.state === "mirror" && w.mtimeMs > kernelBuiltAt;
    });
    // AC8 的持久化半边：当**本内核所在仓库的主检出**的 anchor 内核出现（或推进）到本进程启动时刻之后
    // ⇒ 同样自刷新 —— 替换进程经 preferredAnchorKernel 会**优先**加载主检出那一份。这让「实现落地后常驻
    // 形态自动换成主检出版本」不需要任何人工重启，也把常驻 anchor 的生存期从「当前 worktree 路径」上解绑。
    // （基准是**本内核自身的安装位置**的仓库主检出，⛔ 不是 `opts.root` 工作区——见 mainCheckoutKernelDir：
    //  用 `--root` 拼 `<workspaceRoot>/plugin/scripts/…` 是第三方项目上的缺陷形，由
    //  kernel-sibling-resolution-check 的 DRIVER-SCOPE 规则挡住。）
    // ⛔ 自刷新条件里必须排除「主检出那份就是我自己」——否则替换进程会立刻再判一次 stale = 重启风暴。
    let mainKernelStale = false;
    let mainKernelPath: string | null = null;
    try {
      const me = fileURLToPath(import.meta.url);
      const cand = preferredAnchorKernel();
      if (cand && cand.path !== me) {
        mainKernelPath = cand.path;
        mainKernelStale = fs.statSync(cand.path).mtimeMs > hostStartedAt;
      }
    } catch { /* 读不到 mtime ⇒ 不判 stale（⛔ 不把「读不懂」当作「陈旧」） */ }
    // ⛔ 重启风暴守卫：`stale`（源码在**我这一生**里推进）与 `mainKernelStale`（主检出内核推进）换过去
    // 必然是新一版，可无条件换；**只有** bundleStale 触发时，替换目标必须真的是**另一份更晚构建的
    // bundle**（`preferredAnchorKernel` 已把这条编码进去，这里复核一次），否则换过去还是同一版 ⇒
    // 每 500ms reconcile 一次 = 风暴。换不动时**如实留痕**并留在原地 —— 这正是「陈旧且换不动」这一
    // 独立取值（硬规则 3b：⛔ 不静默、⛔ 不假装 fresh）。留痕只在 kinds 集合变化时打一次（⛔ 不刷屏）。
    let canRefresh = stale.length > 0 || mainKernelStale;
    if (!canRefresh && bundleStale.length > 0) {
      try {
        const me = fileURLToPath(import.meta.url);
        const cand = preferredAnchorKernel();
        canRefresh = !!cand && cand.path !== me &&
          fs.statSync(cand.path).mtimeMs > kernelBuiltAt;
      } catch { canRefresh = false; /* 读不到 ⇒ 换不动（⛔ 不把「读不懂」当「可换」） */ }
    }
    // ── bundle 同步读数（`.quay/anchor.json.bundle`）：六态各自独立，⛔ 不与 fresh 同形 ──────────
    //
    // ⚠️ 这里就是「陈旧且换不动」的**动作面**：它不再只打一行日志——`!canRefresh` 时**机械重建**
    // 本内核的 bundle（跑源树自己的构建脚本），成功后把 `canRefresh` 置真 ⇒ 复用下面那条既有的
    // 整进程自刷新把**重建出来的**那一份加载进来（⛔ 只重建不重启 = 本进程仍跑旧代码，等于把日志里
    // 的建议照抄一遍）。重建失败/无动作可做 ⇒ **如实留痕**并留在原地，取值分别是
    // `stale-rebuild-failed` / `stale-no-action`（⛔ 都不与 `fresh` 同形）。
    {
      const srcDir = bundleStale.length > 0 ? sourceWatch(opts.root, bundleStale[0]).dir : null;
      const srcMtime = bundleStale.length > 0 ? sourceWatch(opts.root, bundleStale[0]).mtimeMs : 0;
      let state: KernelBundleSyncState;
      // 本读数的**适用面** = `mirror` 形态（本内核是一份构建产物、而它的源树在盘上）。源树直跑的
      // 内核（`watched`）与装好的产物（`unwatched`）都没有「bundle 比源树旧」这个量 ⇒ 独立取值
      // `not-evaluated`，⛔ 不与 `fresh` 同形（硬规则 3b；那正是旧形态里它与「一切正常」同形的地方）。
      const anyMirror = [...active.keys()].some((k) => sourceWatch(opts.root, k).state === "mirror");
      if (kernelBuiltAt <= 0 || !anyMirror) {
        state = "not-evaluated";
      } else if (bundleStale.length === 0) {
        state = "fresh";
      } else if (canRefresh) {
        state = "stale-swappable";
      } else {
        // 冷却之外只重试一次成功的重建（成功后本进程内存里仍是旧代码 ⇒ bundleStale 会一直为真；
        // ⛔ 不重试 = 不重建风暴；重启由下面那条既有支路负责）。
        const recent = lastRebuildResult && Date.now() - lastRebuildAtMs < rebuildCooldownMs;
        const succeededBefore = lastRebuildResult?.ok === true;
        if (recent || succeededBefore) {
          state = lastRebuildResult?.ok ? "stale-rebuilt" : "stale-rebuild-failed";
        } else {
          lastRebuildAtMs = Date.now();
          const r = rebuildKernelBundle();
          lastRebuildResult = r;
          lastRebuildIso = new Date(lastRebuildAtMs).toISOString();
          if (r.attempted) {
            log(
              `${ts()} anchor: bundle rebuild ${r.ok ? "OK" : "FAILED"} in ${r.durationMs}ms ` +
              `(kinds=[${bundleStale.join(",")}]; builtAt was ${new Date(kernelBuiltAt).toISOString()}; ` +
              `cmd=${r.command ?? "-"}${r.ok ? "" : `; reason=${r.reason ?? "-"}`})`,
            );
            if (!r.ok && r.outputTail) log(`${ts()} anchor: bundle rebuild output tail:\n${r.outputTail}`);
          } else {
            log(
              `${ts()} anchor: bundle rebuild SKIPPED (${r.reason ?? "no reason given"}) — ` +
              `the stale condition is still true and is reported as such`,
            );
          }
          // 三态可区分（硬规则 3b）：没试过（无动作可用 / 被 kill switch 关掉）与试过但失败
          // ⛔ 不共用「没成功」这一个取值。
          state = r.ok ? "stale-rebuilt" : r.attempted ? "stale-rebuild-failed" : "stale-no-action";
          // ⛔ 重建成功后走既有的整进程自刷新：替换进程加载的**就是**刚重建出来的这一份
          // （`preferredAnchorKernel()` 在本内核就是产物时返回本路径）。
          // ⛔ 测试缝：`QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART=1` ⇒ 只验「重建发生了」，不 spawn 替换进程。
          if (r.ok && !rebuildNoRestart) canRefresh = true;
        }
      }
      bundleReading = {
        state,
        kernel: kernelPathForLog || null,
        builtAt: kernelBuiltAt > 0 ? new Date(kernelBuiltAt).toISOString() : null,
        sourceDir: srcDir,
        sourceMtime: srcMtime > 0 ? new Date(srcMtime).toISOString() : null,
        kinds: bundleStale,
        rebuild: lastRebuildResult
          ? { attempted: lastRebuildResult.attempted, ok: lastRebuildResult.ok, reason: lastRebuildResult.reason, command: lastRebuildResult.command, at: lastRebuildIso ?? new Date(lastRebuildAtMs).toISOString() }
          : null,
        at: new Date().toISOString(),
      };
    }
    // 「陈旧」这条**检测**读数：只要陈旧就留痕，⛔ 与「消费者这一趟做成了没有」无关
    // （硬规则 3b —— 补救 seam 被关掉时，陈旧条件必须**仍被报出**，不得静默降级成 fresh）。
    // 只在 kinds 集合变化时打一次（⛔ 不刷屏）；动作结果另有一条 `bundle rebuild …` 行。
    if (bundleStale.length > 0) {
      const key = bundleStale.join(",");
      if (staleBundleLogged !== key) {
        staleBundleLogged = key;
        const srcDir = sourceWatch(opts.root, bundleStale[0]).dir;
        log(
          `${ts()} anchor: STALE BUNDLE — source tree is newer than this kernel's build ` +
          `(kinds=[${key}]; kernel=${kernelPathForLog} builtAt=${new Date(kernelBuiltAt).toISOString()}; ` +
          `source=${srcDir} — no NEWER kernel resolved; the bundle-rebuild consumer below is acting on it ` +
          `(state=${bundleReading.state}, see .quay/anchor.json bundle)`,
        );
      }
    }
    if (canRefresh && !stopping) {
      log(
        `${ts()} anchor: restarting anchor (AC-184 self-refresh; kinds=[${stale.join(",")}]` +
        `${bundleStale.length > 0 ? `, stale bundle: kinds=[${bundleStale.join(",")}]` : ""}` +
        `${mainKernelStale ? `, main-checkout kernel advanced: ${mainKernelPath}` : ""})`,
      );
      const r = spawnAnchor(opts.root, { logFile, takeoverPid: process.pid });
      if (r.error || r.pid === null) {
        log(`${ts()} anchor: self-refresh spawn FAILED (${r.error ?? "no pid"}) — staying up rather than dying`);
      } else {
        await new Promise<void>((res) => setTimeout(res, 1000));
        if (!pidAlive(r.pid)) {
          log(`${ts()} anchor: replacement pid=${r.pid} died within 1s — staying up rather than dying`);
        } else {
          log(`${ts()} anchor: replacement pid=${r.pid} alive — stopping this anchor`);
          requestAnchorStop();
        }
      }
    }

    if (stopping) {
      if (active.size === 0) break;
      const draining = [...active.keys()];
      if (Date.now() - stopRequestedAt > shutdownGraceMs) {
        log(
          `${ts()} anchor: shutdown grace ${shutdownGraceMs}ms exceeded with loop(s) still draining: [${draining.join(",")}]` +
          ` — exiting anyway (their in-flight children are independent OS processes and are NOT killed, SPEC §6.9 inv.3)`,
        );
        break;
      }
      if (passes % 60 === 0) log(`${ts()} anchor: stopping — ${active.size} loop(s) still draining: [${draining.join(",")}]`);
    }
    if (opts.maxReconcilePasses != null && passes >= opts.maxReconcilePasses) {
      requestAnchorStop();
      // 给循环一个收尾窗口；⛔ 不无限等（测试缝专用）。
      const deadline = Date.now() + 10_000;
      while (active.size > 0 && Date.now() < deadline) await new Promise<void>((r) => setTimeout(r, 100));
      break;
    }
  }

  // 等循环收尾（⛔ 有界：worker 的在飞子进程可能还在跑，但那个「还在跑」在结构上可以无界——见上面
  // shutdownGraceMs 的注释）。宽限之外不再等：在飞 worker 子进程是独立 OS 进程，⛔ 不因本进程退出而死。
  const deadline = Date.now() + Math.min(60_000, shutdownGraceMs);
  while (active.size > 0 && Date.now() < deadline) await new Promise<void>((r) => setTimeout(r, 200));
  // 逐 kind 摘掉 pid 载体：留着死 pid 会让下一次 `start` 读到「有个 driver 在跑」（硬规则 3b）。
  for (const kind of KNOWN_KINDS) {
    try { fs.rmSync(statePaths(opts.root, kind).driverPidFile, { force: true }); } catch { /* ignore */ }
  }
  try { fs.rmSync(paths.pidFile, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(paths.stateFile, { force: true }); } catch { /* ignore */ }
  log(`${ts()} anchor: exited (remaining loops=${active.size})`);
  return 0;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────

const USAGE = [
  "driver-anchor — GOAL-017/AC-255：一个进程承载若干 driver kind 的常驻循环（SPEC §7 阶段 C / §6.1）。",
  "  node --experimental-strip-types plugin/scripts/driver-anchor.ts __anchor --root <repo> \\",
  "    [--kinds a,b] [--takeover <pid>] [--restart-delay <s>] [--reconcile-ms <ms>] [--max-reconcile-passes <n>]",
  "  __anchor                 常驻（⛔ 内部模式；用户面是 `quay driver start|stop --kind X`，经 driver-runtime 调本入口）",
  "  --kinds a,b              启动托管的 kind 集合（缺省 = .quay/anchor-desired.json > 全部六个）",
  "  --takeover <pid>         等该 pid 退出后再接管（源码自刷新用）",
  "  --restart-delay <s>      事件循环层 respawn 退避基准（缺省 5）",
  "  --reconcile-ms <ms>      期望态 reconcile 周期（缺省 500）",
  "  --max-reconcile-passes <n>  测试缝：跑满 N 轮后停机",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const cmd = args[0] ?? "";
  let root = "";
  let kinds: DriverKind[] | undefined;
  let takeoverPid: number | null = null;
  let restartDelaySecs = 5;
  let reconcileMs = 500;
  let maxReconcilePasses: number | null = null;

  if (cmd !== "__anchor") {
    process.stderr.write(`driver-anchor: unknown mode "${cmd}"\n${USAGE}\n`);
    return 2;
  }
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--kinds") kinds = String(args[++i]).split(",").filter((k): k is DriverKind => KNOWN_KINDS.includes(k as DriverKind));
    else if (a === "--takeover") takeoverPid = Number(args[++i]);
    else if (a === "--restart-delay") restartDelaySecs = Number(args[++i]);
    else if (a === "--reconcile-ms") reconcileMs = Number(args[++i]);
    else if (a === "--max-reconcile-passes") maxReconcilePasses = Number(args[++i]);
    else if (a === "--help" || a === "-h") { process.stdout.write(`${USAGE}\n`); return 0; }
    else { process.stderr.write(`driver-anchor: unknown argument: ${a}\n${USAGE}\n`); return 2; }
  }
  if (!root) {
    process.stderr.write(`driver-anchor: --root is required\n${USAGE}\n`);
    return 2;
  }
  if (takeoverPid !== null && !Number.isFinite(takeoverPid)) takeoverPid = null;
  return await runAnchor({ root, kinds, takeoverPid, restartDelaySecs, reconcileMs, maxReconcilePasses });
}

if (isDirectEntry(import.meta, undefined, "driver-anchor")) {
  // ⚠️ 显式 process.exit（⛔ 不是只设 exitCode）：常驻循环用 setTimeout 链把自己挂在事件循环上，
  // 即使 runAnchor 已经返回、Node 也不会自行退出——实测一次真实 SIGTERM 之后日志已写完「shutdown
  // grace exceeded … exiting anyway」而进程又活了 10 分钟以上。设 exitCode 只影响「如果它退出时的
  // 退出码」，⛔ 不产生退出。这里退出的是**调度者**；在飞 worker 子进程是独立 OS 进程，不受影响。
  main(process.argv).then((code) => {
    process.exit(code);
  });
}
