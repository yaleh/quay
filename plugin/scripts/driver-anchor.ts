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
//   `.quay/anchor.json`             结构化回读面 {pid, startedAt, kinds, host}
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
  readAnchorPid,
  readDesired,
  requestKindStop,
  resolveKernelSibling,
  sourceChangedSince,
  spawnAnchor,
  statePaths,
  ts,
  writeDesired,
  type AnchorDesiredEntry,
  type DriverKind,
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
  if (opts.takeoverPid) {
    const takeoverDeadlineMs = shutdownGraceMs + 60_000;
    const deadline = Date.now() + takeoverDeadlineMs;
    while (pidAlive(opts.takeoverPid) && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    if (pidAlive(opts.takeoverPid)) {
      log(`${ts()} anchor: takeover ${opts.takeoverPid} STILL ALIVE after ${takeoverDeadlineMs}ms — REFUSING to start (two anchors would double-dispatch); this refresh attempt is abandoned`);
      return 1;
    }
    log(`${ts()} anchor: takeover ${opts.takeoverPid} exited — taking over`);
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

  // 启动集合：显式 kinds > 盘上期望态 > 全部六个（冷启动）。
  const initial = opts.kinds ?? readDesired(opts.root)?.kinds ?? [...KNOWN_KINDS];
  // 盘上没有期望态而我们给了初始集合 ⇒ 落盘，使后续 `start/stop --kind X` 有一个可读改的基底。
  if (readDesired(opts.root) === null) writeDesired(opts.root, initial, "driver-anchor:cold-start");

  const writeState = (): void => {
    try {
      fs.writeFileSync(
        paths.stateFile,
        JSON.stringify({ pid: process.pid, startedAt: new Date(hostStartedAt).toISOString(), kinds: [...active.keys()], host: "anchor" }) + "\n",
        "utf8",
      );
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

    const wanted = readDesired(opts.root)?.kinds ?? [];
    // 起：期望态里有而没在跑 ⇒ 起（幂等：已在 active 的就是 no-op，⛔ 不重启——§6.9 不变式 1）。
    for (const kind of wanted) {
      if (!active.has(kind)) startKindTask(kind, opts, log, active, desiredOpts()[kind] ?? {});
    }
    // 停：在跑而期望态里没有 ⇒ 只停那一个（§6.9 不变式 2：⛔ 不波及其余）。
    for (const kind of [...active.keys()]) {
      if (!wanted.includes(kind)) active.get(kind)?.stop();
    }
    writeState();

    // 源码自刷新（AC-184）：被监视源码推进到本 anchor 启动时刻之后 ⇒ 整个 anchor 重启（模块级热重载
    // 会因为双份 driver-runtime 而让停机登记表分裂，见 invokeKindDefault 的注释）。⛔ 只在**确认替换
    // 进程活着**之后才退出——否则一次 spawn 失败 = 六个 driver 一起消失（比不刷新更糟）。
    const stale = [...active.keys()].filter((k) => sourceChangedSince(opts.root, k, hostStartedAt));
    // AC8 的持久化半边：当**主检出**的 anchor 内核出现（或推进）到本进程启动时刻之后 ⇒ 同样自刷新 ——
    // 替换进程经 preferredAnchorKernel 会**优先**加载主检出那一份。这让「实现落地后常驻形态自动换成
    // 主检出版本」不需要任何人工重启，也把常驻 anchor 的生存期从「当前 worktree 路径」上解绑。
    // ⛔ 自刷新条件里必须排除「主检出那份就是我自己」——否则替换进程会立刻再判一次 stale = 重启风暴。
    let mainKernelStale = false;
    let mainKernelPath: string | null = null;
    try {
      const me = fileURLToPath(import.meta.url);
      const cand = preferredAnchorKernel(opts.root);
      if (cand && cand.path !== me) {
        mainKernelPath = cand.path;
        mainKernelStale = fs.statSync(cand.path).mtimeMs > hostStartedAt;
      }
    } catch { /* 读不到 mtime ⇒ 不判 stale（⛔ 不把「读不懂」当作「陈旧」） */ }
    if ((stale.length > 0 || mainKernelStale) && !stopping) {
      log(
        `${ts()} anchor: restarting anchor (AC-184 self-refresh; kinds=[${stale.join(",")}]` +
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
