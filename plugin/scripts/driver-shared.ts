// plugin/scripts/driver-shared.ts — 两驱动（worker / promotion）共用的资源门 + 控制面载体（AC150-3）。
// (tasks/gap-ac150-promotion-driver-resource-gate-control-plane)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC150-3）：promotion-driver 与 worker-driver 跑在同一台
// 机器上，二者的【资源门判定】与【halt 判定】必须是同一份实现（函数级复用，⛔ 非复制粘贴）。
// 下一阶段 AC151 做的是架构分层（把共性上收），本条只做到【先共用】：把 worker-driver.ts 里已有的
// resourceGateCheck / 控制态（read/write/halt）/ 身份闸 / serveControlPlane 抽到本文件，两驱动 import。
//
// ── 该「共性」现在分居两处，本文件是它的 plugin 侧入口（tasks/gap-arch-reverse-edges-zero）──────
// 上段所述的四个共性里，三个（控制态 read/write/halt、身份闸、serveControlPlane）**已下沉到
// `packages/quay/src/kernel/`**（control-state.ts + control-plane-http.ts），本文件只做 re-export：
// 原因是 `packages/quay/src/serve/serve.ts` 也是它们的消费者（AC-251 把控制面并进 `quay serve` 进程），
// 而产品层不得反向 import 方法学层。方向恒为 plugin → kernel。第四个（资源门 resourceGateCheck）
// 留在本文件：它 spawn 一个 plugin 侧 shell（resource-gate.sh），是【driver 运行时】而非共享原语。
// ⛔ 判据（读数不为 0 就说明方向被写反了）：`node --experimental-strip-types
// plugin/scripts/import-graph-check.ts --json` 的 `reverseEdges` 必须为空数组 —— `packages/**`
// 不得 import `plugin/**`；本文件的 re-export 是反方向，不计入该量。
//
// 单一真相源（继承 worker-driver.ts SPEC §5 阶段 3 退役清单）：
//   控制态文件 = <root>/.quay/<kind>-control.json（worker → worker-control.json；promotion →
//   promotion-control.json）。每个 kind 一个文件（halting worker 不影响 promotion，反之亦然），
//   ⛔ 但读/写/判停的逻辑只有 kernel/control-state.ts 一份——文件路径是【参数】（rel），不是第二份实现。
//   读失败 fail-closed（读失败/解析失败 ⇒ halted=true，硬规则 3b：读不懂 ≠ 合格）。
//   `.halt` 文件机制对【驱动】退役 —— 驱动不读 `.halt`（单一真相源 = 控制态）。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// worker 进程身份 + dispatch 载体（gap-worker-dispatch-carrier-owner-and-contract-unregistered）：
// 这三个都是 leaf / kernel 叶子（profile-policy → yaml，proc-identity → node:fs），⛔ 不反向 import
// worker-driver.ts —— 那会与 `worker-driver → relaxed-dispatch-ledger → duration-report` 一起成值环
// （import-graph-check 的 valueSccs 棘轮钉在 0）。duration-report.ts 因此能从本文件取到【同一份】
// classifyOrphanDispatch，而不是自己再写一套 pid 判定。
import { loadProfiles, resolveRole } from "./profile-policy.ts";
import { readProcCmdlineText } from "../../packages/quay/src/kernel/proc-identity.ts";
import { escapeRegExp } from "./regex-escape.ts";

// ── 控制态 + 身份闸 + MCP 控制面：kernel 侧实现，本文件原样转出 ─────────────────────────────────
// `export *`（不是逐条列举）是刻意的：逐条列举会在 kernel 新增导出时静默漏掉一个，而调用方拿到的
// 将是 `undefined` 而不是编译错误——一个「看起来还在」的缺失（硬规则 3b 的同族形态）。
export * from "../../packages/quay/src/kernel/control-state.ts";
export * from "../../packages/quay/src/kernel/control-plane-http.ts";

// ── 资源门（AC150-1）：起 LLM worker / fix worker 前经同一个资源门判定 ──────────────────────────────

/** 解析 resource-gate.sh 到本 kernel 安装位置（⛔ 非 opts.root —— gap-driver-resource-gate-path-
 *  anchored-at-root-third-party：quay-init 后的第三方项目没有 plugin/scripts/，锚在 opts.root 会
 *  `bash <不存在路径>` exit 127 ⇒ 恒 WAIT（fail-closed）⇒ 永不派发）。QUAY_PLUGIN_ROOT 覆盖基准
 *  （同 driver-runtime.ts resolveKernelPluginRoot 的手法）。覆盖两种形态：dev-tree（本 .ts 与
 *  resource-gate.sh 同住 plugin/scripts/，dir 的 basename 是 scripts）与 installed-artifact（本模块
 *  bundle 进 plugin/scripts/dist/，dir 的 basename 是 dist ⇒ 上跳两级到 plugin root 再进 scripts/）。
 *  找不到 ⇒ null（调用方 fail-closed，⛔ 不静默 GO）。 */
export function resolveResourceGateScript(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.QUAY_PLUGIN_ROOT;
  let pluginRoot: string;
  if (override) {
    pluginRoot = override;
  } else {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    pluginRoot = path.basename(dir) === "dist" ? path.dirname(path.dirname(dir)) : path.dirname(dir);
  }
  const script = path.join(pluginRoot, "scripts", "resource-gate.sh");
  return fs.existsSync(script) ? script : null;
}

/** 判停条件之二：resource-gate 是否报 WAIT（AC3）。cmd 覆盖是测试缝；缺省 = kernel 安装位置的
 *  resource-gate.sh `--for full-suite --json`（resolveResourceGateScript，⛔ 非 opts.root）。exit 0 = GO，
 *  非 0 = WAIT（读不懂/读失败 ⇒ fail-closed WAIT，硬规则 3b）。`root` 参数已不再用于路径解析，仅为
 *  调用方 API 兼容保留。 */
export function resourceGateCheck(root: string, cmd: string[] | null): { go: boolean; reason: string } {
  let argv: string[];
  if (cmd) {
    argv = cmd;
  } else {
    const gate = resolveResourceGateScript();
    if (!gate) return { go: false, reason: "resource-gate.sh not found (kernel install location) — fail-closed" };
    argv = ["bash", gate, "--for", "full-suite", "--json"];
  }
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: 20_000, maxBuffer: 1 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { go: false, reason: `resource-gate spawn failed (${msg}) — fail-closed` };
  }
  if (r.error) return { go: false, reason: `resource-gate failed (${String(r.error.message || r.error)}) — fail-closed` };
  const stdout = String(r.stdout ?? "").trim();
  if (r.status === 0) {
    try {
      const j = JSON.parse(stdout);
      if (j && typeof j.verdict === "string") {
        return { go: j.verdict === "GO", reason: j.reason || `resource-gate verdict ${j.verdict}` };
      }
    } catch {
      /* not JSON — use exit code */
    }
    return { go: true, reason: stdout ? stdout.slice(0, 200) : "resource-gate GO" };
  }
  return { go: false, reason: stdout ? stdout.slice(0, 200) : `resource-gate WAIT (exit ${r.status})` };
}

// ── 常驻循环停机控制器（可唤醒 sleep）：三个 resident-loop driver 共用同一份 ────────────────────────
//
// WHY THIS EXISTS（routine finding `driver-sleep-requeststop-triple`，semantic-dedup-scan runId
// semantic-dedup-scan-1791442852793，verdict real-duplication / kind byte-identical-body）：outer /
// promotion / quality-gate 三个常驻循环各自逐字重定义了同一组四行——
//   `let stopRequested` + `let wakeResolve` + `requestStop` 一行闭包 + 可被唤醒的 `sleep`。
// 三份副本的【语义】必须一致（停机延迟 0 而非一个 interval、wakeResolve 只被清空一次），
// 分别是本仓库最典型的 drift 面（硬规则 5b：缺陷成簇，改一处漏两处）。
//
// 语义（三 kind 一致，逐字继承旧实现）：
//   · requestStop()：置停机标志 + 【唤醒当前 sleep】⇒ 循环在下一行即退出，⛔ 不等满一个 interval。
//   · sleep(ms)：正常到点 resolve；被 requestStop 唤醒时提前 resolve。二者对调用方【同形】（都只是
//     resolve，无值可区分）——这正是要的：循环醒来后靠 isStopRequested() 判该继续还是退出。
//   · wakeResolve 只在仍等于本次 resolve 时清空：定时器到点后若已被唤醒（wakeResolve 已置 null），
//     ⛔ 不重复清空。双 resolve 本身幂等无害，此处保持与旧实现逐字相同的时序。
//   · 【提前唤醒必须 clearTimeout 本觉的定时器】（gap-driver-shared-sleep-timer-not-cleared-on-early-
//     wake）：wakeResolve 只让 Promise 提前 resolve，**⛔ 不取消那个已排定的 setTimeout**。若不清它，
//     回调虽是无害 no-op（wakeResolve 已 null），但那个 handle 仍挂在事件循环上，要等满 `ms` 才到期
//     —— 实测后果：driver-shared.test.mjs 里 `sleep(60_000)` + `requestStop()` 使整个测试文件
//     从 ~3.8s 拖到 ~62.7s（`.quay/verification-round.jsonl` 台账读数），生产上则是停机后进程被一个
//     悬空 interval 拖着不退。故 requestStop 在唤醒在飞 sleep 时一并 clearTimeout 并置 wakeTimer=null。
// ⛔ 不进程退出、⛔ 不杀在飞轮（调用方负责）——本控制器只做「标志 + 唤醒这一觉」。

// ── 跨 bundle 停机探针（gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles）─────────────
//
// WHY（实测 2026-10-14，ClaudeCodeUI 的 shipped dist 内核）：per-kind stop 走的是 `driver-runtime.ts`
// 的 `KIND_STOP` **进程内存**登记表 —— anchor 用 `requestKindStop(kind)` 找登记。那条路只在
// 「anchor 与各 kind 同享**一个模块实例**」时成立。shipped 内核里 `driver-anchor.js` 与每个
// `<kind>-driver.js` 是**各自独立的 esbuild bundle**，各自内联一份 `driver-runtime` ⇒ anchor 查的是
// 它自己那份**空表**、恒 `false`，而返回值被丢弃 ⇒ `stop --kind X` 永远等满超时（5 次实测全
// `stop-failed`，同一命令在 dev 树上 3510ms 成功）。⇒ 停机信号必须有一个**不依赖模块同一性**的通道。
//
// 本组选项就是那个通道的通用半边：调用方注入一个**读盘探针**，控制器在 sleep 分片与轮边界读它。
// ⛔ 探针只读**停机记录**（`.quay/anchor-kind-stops.json`），**不读**期望态成员资格 —— 见
// `driver-runtime.ts` `kindStopProbe` 的 WHY。
//
// 三态（硬规则 3b：⛔ `not-evaluated` 不与 `not-stopped` 共用取值）：
//   · `stopped`        ⇒ 停机（latch，回到稳态不再重复读盘）
//   · `not-stopped`    ⇒ 继续
//   · `not-evaluated`  ⇒ **继续**（fail-open：读不懂停机记录时停掉一个**没人要求停**的循环，比漏掉
//     一次停机请求贵得多），但**如实留痕一次**（⛔ 不静默、⛔ 不每周期刷屏）

/** 跨 bundle 停机探针的一趟读数（三态，硬规则 3b）。 */
export type DiskStopReading = "stopped" | "not-stopped" | "not-evaluated";

/** 盘上探针的轮询周期缺省（ms）= anchor 的 reconcile 周期 ⇒ 停机延迟 ≤ 1 个 reconcile tick。 */
export const DISK_STOP_POLL_MS_DEFAULT = 500;

export interface ResidentLoopStopOptions {
  /** 盘上停机探针（见上 WHY）。不传 ⇒ 行为与从前**逐字**相同（只有进程信号 + 进程内登记）。 */
  diskStopProbe?: () => DiskStopReading;
  /** 探针轮询周期（ms，缺省 `DISK_STOP_POLL_MS_DEFAULT`）。 */
  diskPollMs?: number;
  /** `not-evaluated` 读数的**一次性**具名落痕（⛔ 不静默）。 */
  onNotEvaluated?: () => void;
}

/** 常驻循环的停机控制器。`while (!ctl.isStopRequested())` + `await ctl.sleep(intervalMs)`。 */
export interface ResidentLoopStop {
  /** 停机是否已被请求（常驻 while 的条件用）。 */
  isStopRequested(): boolean;
  /** 请求停机：置标志并唤醒当前 sleep。登记给 `registerKindStop` 的就是它。 */
  requestStop(): void;
  /** 可被 requestStop 唤醒的 sleep（到点或唤醒，均 resolve）。 */
  sleep(ms: number): Promise<void>;
}

/** 建一个常驻循环停机控制器（见上 WHY）。三 driver 各 import 本函数，⛔ 不各写一份四行副本。 */
export function residentLoopStop(opts: ResidentLoopStopOptions = {}): ResidentLoopStop {
  let stopRequested = false;
  let wakeResolve: (() => void) | null = null;
  // 当前在飞 sleep 排定的定时器 handle（见 WHY 第三条）：requestStop 提前唤醒时须 clearTimeout，
  // 否则悬空 handle 会把事件循环/测试进程拖到原 `ms` 到期。
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let notEvaluatedLogged = false;

  /** 读一次盘上探针并按三态动作；`stopped` 会 **latch** 停机标志（此后不再读盘）。 */
  const probe = (): boolean => {
    if (stopRequested) return true;
    if (!opts.diskStopProbe) return false;
    let reading: DiskStopReading;
    try {
      reading = opts.diskStopProbe();
    } catch {
      // 探针自己抛错（读盘失败、注入的假探针坏了）⇒ 与「读不懂」同形，⛔ 不冒充实测到的取值。
      reading = "not-evaluated";
    }
    if (reading === "stopped") { stopRequested = true; return true; }
    if (reading === "not-evaluated" && !notEvaluatedLogged) {
      notEvaluatedLogged = true;
      try { opts.onNotEvaluated?.(); } catch { /* 落痕失败不阻碍循环 */ }
    }
    return false;
  };

  return {
    isStopRequested: () => probe(),
    requestStop: () => {
      stopRequested = true;
      if (wakeResolve) {
        const w = wakeResolve;
        wakeResolve = null;
        // 取消本觉排定的定时器（它已经不该再触发）——先清 handle 再唤醒，二者无时序耦合但保持
        // “唤醒即不再有本觉的定时器”这一可断言的不变式。
        if (wakeTimer !== null) { clearTimeout(wakeTimer); wakeTimer = null; }
        w();
      }
    },
    sleep: (ms: number) => new Promise<void>((resolve) => {
      if (!opts.diskStopProbe) {
        wakeResolve = resolve;
        wakeTimer = setTimeout(() => {
          wakeTimer = null; // 已到点 ⇒ 本觉的定时器不再在飞，提前唤醒路径无须（也不应）再 clear 它
          if (wakeResolve === resolve) wakeResolve = null;
          resolve();
        }, ms);
        return;
      }
      // 分片轮询（⛔ 不是「睡满一个 interval 再判一次」）：每次分片到点读一次盘，读到停机即唤醒 ⇒
      // 停机延迟 ≤ 一个分片周期，与间隔长短无关。`requestStop` 仍能提前唤醒（它清掉当前分片的定时器）。
      const pollMs = Math.max(1, Math.floor(opts.diskPollMs ?? DISK_STOP_POLL_MS_DEFAULT));
      const deadline = Date.now() + ms;
      const finish = (): void => { wakeResolve = null; wakeTimer = null; resolve(); };
      const tick = (): void => {
        if (probe()) { finish(); return; }
        const remaining = deadline - Date.now();
        if (remaining <= 0) { finish(); return; }
        wakeTimer = setTimeout(tick, Math.min(pollMs, remaining));
      };
      wakeResolve = resolve;
      wakeTimer = setTimeout(tick, Math.min(pollMs, Math.max(0, ms)));
    }),
  };
}

// ── worker 进程身份（两个驱动 + 只读报告共用的同一份判定）──────────────────────────────────────────
//
// 本组从 worker-driver.ts 抽到此处（gap-worker-dispatch-carrier-owner-and-contract-unregistered）：
// `plugin/scripts/duration-report.ts` 必须用【同一份】classifyOrphanDispatch 判「在飞 / 残留」，而
// `worker-driver → relaxed-dispatch-ledger → duration-report` 已是一条值边 ⇒ duration-report 反向
// import worker-driver 会成值环。抽到本 leaf 是唯一不新增第二套 pid 判定、也不造环的落点。
// ⛔ 判据（读数回升即方向写反）：`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`
// 的 `valueSccs` 必须仍为 0。

/** 存活 worker 进程的 `-n` 名（launchArgv 经 profile-policy.ts 解析 .quay/profiles.yml 的
 *  `roles["task-worker"].name` 承载；AC140-2 测试钉死 name 以 quay- 开头）。
 *  ⚠️ 这是【缺省值】，不是「本 workspace 的 worker 名」。真实名由 `.quay/profiles.yml` 承载 ⇒ 一律经
 *  resolveWorkerProcessName(root) 取。字面常量只作解析失败时的历史缺省（quay 自己的 profiles.yml
 *  恰好就是这个名字）。 */
export const WORKER_PROCESS_NAME = "quay-task-worker";

/** 本 workspace 的 worker 进程名（`-n <name>`）：读 `.quay/profiles.yml` 的 roles["task-worker"].name。
 *
 *  🔴 为什么必须解析而不能用上面的字面常量（gap-reconcile-finalizes-live-worker-as-exited-and-double-
 *  dispatches-same-task，2026-09-13 第一手对照）：字面量 `quay-task-worker` 是【quay 自己】的命名；
 *  第三方项目按 quay-init 的注释自行改名（quay-fleet: `fleet-task-worker`）。此前所有存活探测
 *  （enumerateLiveWorkerCmdlines / hasLiveWorkerForTask / findLiveWorkerPid）都写死该字面量 ⇒
 *  在 quay-fleet 上**恒不命中任何真实 worker**（硬规则 4b：一个依赖宿主的字面量，换项目就静默失效）。
 *  后果是 reconcile 把【在飞】worker 判为「已退出」（假失败记录）并清掉冷启动排除集 ⇒ 同任务双派、
 *  两个 worker 共用一个 worktree。对照：同一份 argv 只改角色名，hasLiveWorkerForTask 给出相反取值。
 *
 *  解析失败（无 profiles.yml / 无该角色 / yaml 读不懂）⇒ 回落到 WORKER_PROCESS_NAME（历史行为），
 *  ⛔ 不抛——探测是观测，观测不得让驱动停摆；且回落方向的残余危害由 finalizeOrphanDispatch 的
 *  /proc 存活实测兜底（见该函数）。 */
export function resolveWorkerProcessName(root: string | null | undefined): string {
  if (!root) return WORKER_PROCESS_NAME;
  try {
    const name = resolveRole(loadProfiles(root), "task-worker").name;
    return name && name.length > 0 ? name : WORKER_PROCESS_NAME;
  } catch {
    return WORKER_PROCESS_NAME;
  }
}

/** 读某 pid 的 /proc/<pid>/cmdline（归一化：NUL → 空格、trim）；pid 不存在 / 无权限 ⇒ null
 *  （硬规则 3b：读不懂 ≠ 无存活，但调用方按 falsy 判「已死」——方向是「少 adopt」，⛔ 不误信 pid）。
 *  读由 kernel leaf 单点实现；⛔ 保留「空 cmdline ⇒ ""」这一取值（调用方按 falsy 与 null 同判
 *  「已死」，但取值本身不同形，见 `probePidLiveness` 对同一区分的用法）。 */
export function readPidCmdline(pid: number, procDir: string = "/proc"): string | null {
  const text = readProcCmdlineText(pid, procDir);
  return text === null ? null : text.trim();
}

/** 该 task 是否有存活 worker 正在跑：某存活进程 cmdline 同时含 worker 名（-n 名）与该 task id
 *  （worker prompt 里的 "Task: <id>"）。纯谓词，cmdline 列表注入（缺省由调用方从 /proc 取）。
 *  task id 用【词边界】匹配，⛔ 不用裸 substring——短 id（如 `gap-t`）会作为前缀命中 `gap-test-…` /
 *  `gap-todo-…` 的存活 worker cmdline（2026-08-24 实测：测试 task `gap-t` 误命中生产 worker
 *  `gap-test-fixture-pollutes-bash-history` ⇒ cleanupOrphanWorktree 假跳过）。边界字符类 = 字母/数字/
 *  下划线/连字符（task id 全由它们组成 ⇒ `gap-t` 后跟 `e` 或 `-` 都不算命中，后跟 `.`/空格/行尾才算）。 */
export function hasLiveWorkerForTask(taskId: string, workerCmdlines: string[], workerName: string = WORKER_PROCESS_NAME): boolean {
  const re = new RegExp(`(^|[^a-zA-Z0-9_-])${escapeRegExp(taskId)}(?![a-zA-Z0-9_-])`);
  return workerCmdlines.some((cmd) => cmd.includes(workerName) && re.test(cmd));
}

/** 判「孤儿 dispatch 该 adopt 还是 finalize」所需的身份面（DispatchRecord 的结构子集 ⇒ 纯分类器
 *  不必依赖载体类型）。 */
export interface DispatchIdentity {
  taskId: string;
  workerPid: number;
}

/** 孤儿 dispatch 分类（纯函数）：adopt（pid 存活且 cmdline 仍是本任务的 worker）/ finalize（pid 已死 /
 *  被复用）。复核用 hasLiveWorkerForTask 的词边界 cmdline 匹配（同 cold-start-inflight 交叉核对），⛔ 不
 *  裸信 pid 数字——pid 复用后指向别的进程，cmdline 不再含 <worker 名> + task id ⇒ 判 finalize。
 *  空 cmdline（僵尸已退未收尸）与读不到（null）同判「已死」。
 *  workerName：本 workspace 的 worker `-n` 名（resolveWorkerProcessName(root)），⛔ 不用写死的
 *  `quay-task-worker`——第三方项目改名后本函数会对【在飞】worker 恒判 finalize（2026-09-13 quay-fleet 实证）。 */
export function classifyOrphanDispatch(
  record: DispatchIdentity,
  procDir: string = "/proc",
  workerName: string = WORKER_PROCESS_NAME,
): "adopt" | "finalize" {
  const cmdline = readPidCmdline(record.workerPid, procDir);
  if (!cmdline) return "finalize";
  return hasLiveWorkerForTask(record.taskId, [cmdline], workerName) ? "adopt" : "finalize";
}

// ── dispatch 持久记录（.quay/worker-dispatch.json）───────────────────────────────────────────────
//
// 载体的【契约正本】= docs/references/worker-dispatch-carrier.md（⛔ 契约正文只在那里一份，本处只
// 留实现 + 指针）。它登记在 docs/carrier-registry.json，owner = plugin/scripts/worker-driver.ts
// （spawn 后写、终态删的唯一写者）。
//
// 一条记录 = spawn 后的派发影子：旧 driver 死掉后内存 running 整体丢失，但这份持久影子存活 ⇒ 新
// driver 的 reconcile 能读到「这个 task 为什么在飞、是哪次 dispatch、跑了多久、原定超时预算是多少」，
// 据此 adopt（纳入超时监管）或 finalize（已死补终态），⛔ 不再是「排除集之外一片黑箱」。

/** 载体仓库相对路径（gitignored 运行时状态，worker-outcome.jsonl / worker-round.jsonl 同族）。 */
export const WORKER_DISPATCH_REL = ".quay/worker-dispatch.json";

/** 每条记录自带的稳定版本标记（AC2）。⛔ 读者不得用「字段形状」猜版本：没有本标记的记录是 v1 之前
 *  写的（legacy-unversioned），按同一份读取逻辑处理但如实报 `schema: null`。 */
export const WORKER_DISPATCH_RECORD_SCHEMA = "worker-dispatch-record/v1";

/** 一条 dispatch 持久记录（spawn 后写、终态后清；driver 重启遗留的条目 = 孤儿在飞）。
 *  契约正文 → docs/references/worker-dispatch-carrier.md。 */
export interface DispatchRecord {
  /** 版本标记：{@link WORKER_DISPATCH_RECORD_SCHEMA}。旧记录（本字段引入前写的）运行期可能缺失 ⇒
   *  读取方按 `null` 处理（见 readDispatchStoreClassified 的 `schema` 字段）。 */
  schema: string;
  taskId: string;
  runId: string;
  workerPid: number;
  selectorReason: string;
  /** 派发时刻（epoch ms）。 */
  startedAtMs: number;
  /** 原始超时截止时刻（epoch ms）；0 = 无超时（与 timeoutMs>0 对齐）。adopt 沿用此值，⛔ 不重置。 */
  timeoutDeadlineMs: number;
  /** spawn 时的归一化 cmdline（argv 空格 join）——观测抓手 + adopt 时 hasLiveWorkerForTask 复核的参照
   *  （⛔ 不裸信 pid 数字，避免 pid 复用误判）。 */
  cmdlineFingerprint: string;
}

/** 写入侧的记录输入：`schema` 由 upsertDispatchRecord 统一盖章（单一写入口，⛔ 不靠每个调用点记得填）。 */
export type DispatchRecordInput = Omit<DispatchRecord, "schema"> & { schema?: string };

/** dispatch 记录文件的绝对路径。 */
export function dispatchStoreFile(root: string): string {
  return path.join(root, WORKER_DISPATCH_REL);
}

/** 读整份 dispatch store（taskId → record）；文件缺失 / 解析失败 ⇒ {}（fail-soft，硬规则 3b：读不懂
 *  ≠ 无记录，但方向是「少 adopt ⇒ 维持现状」，⛔ 不是 fail-closed 到「全部孤儿」——那会误接管手工起的 worker）。
 *  ⚠️ 需要区分「文件缺失 / 不可读 / 解析失败」的读者用 readDispatchStoreClassified（三态），⛔ 不要把
 *  本函数的 `{}` 读成「没有在飞」。 */
export function readDispatchStore(file: string): Record<string, DispatchRecord> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, DispatchRecord>;
    return {};
  } catch {
    return {};
  }
}

/** 原子写整份 dispatch store（tmp + rename，外部读者绝不读到半截——与 worker-driver 的 appendWorkerPid 同手法）。 */
export function writeDispatchStore(file: string, store: Record<string, DispatchRecord>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* dispatch store 是观测抓手 + 孤儿 adopt/finalize 的输入，写失败不改变主流程（同 appendWorkerPid） */
  }
}

/** upsert 一条 dispatch 记录（读-改-写，原子）。`schema` 标记在此【单一写入口】盖章。 */
export function upsertDispatchRecord(file: string, record: DispatchRecordInput): void {
  const store = readDispatchStore(file);
  store[record.taskId] = { ...record, schema: record.schema ?? WORKER_DISPATCH_RECORD_SCHEMA };
  writeDispatchStore(file, store);
}

/** 移除一条 dispatch 记录（终态已算 ⇒ dispatch 已了结）。记录本不存在 ⇒ no-op（⛔ 不写 spurious 空文件）。 */
export function removeDispatchRecord(file: string, taskId: string): void {
  const store = readDispatchStore(file);
  if (!(taskId in store)) return;
  delete store[taskId];
  writeDispatchStore(file, store);
}

// ── 只读三态判定（AC4）：live / residue / not-evaluated ───────────────────────────────────────────
//
// ⛔ 这三个取值互不同形，且 residue / not-evaluated **不得**被折成「无在飞」：外部读者（报告、人工
// 排查、后续 live-state）必须能把「读到了、确无在飞」与「读不懂」「有残留」分开。pid 判定只有
// classifyOrphanDispatch 一份（DoD：⛔ 不新增第二套）。

/** 单条记录的只读判定。`not-evaluated` 只出现在【记录本身结构不可读】时（没有可用的 workerPid /
 *  taskId）；文件级缺失/不可读见 DispatchStoreReading.status。 */
export type DispatchEntryState = "live" | "residue" | "not-evaluated";

export interface DispatchStoreEntry {
  /** 文件 map 里的键（读者比对用它，⛔ 不用记录自报的 taskId 当键）。 */
  taskId: string;
  record: DispatchRecord | null;
  state: DispatchEntryState;
  /** 记录自报的 schema 标记；旧记录没有 ⇒ null（⛔ 不用字段形状猜版本）。 */
  schema: string | null;
}

export interface DispatchStoreReading {
  /** 文件级判定：ok = 读到了并逐条判过；not-evaluated = 缺失/不可读/解析失败（⛔ 不是「无在飞」）。 */
  status: "ok" | "not-evaluated";
  /** 未评估的成因（status === "ok" 时为 "ok"）——枚举，⛔ 不与 status 共用一个布尔。 */
  fileState: "ok" | "missing" | "unreadable" | "malformed";
  file: string;
  entries: DispatchStoreEntry[];
  /** 便捷计数（从 entries 派生，⛔ 不另存第二份判定）。 */
  live: number;
  residue: number;
}

/** 单条记录 → live（pid 存活且 cmdline 仍是本任务的 worker）/ residue（其余：pid 已死、cmdline 不匹配、
 *  或 /proc 读不懂——与 classifyOrphanDispatch 的 finalize 同判，⛔ 不新增第二套 pid 判定）。 */
export function classifyDispatchEntry(
  record: DispatchIdentity,
  procDir: string = "/proc",
  workerName: string = WORKER_PROCESS_NAME,
): "live" | "residue" {
  return classifyOrphanDispatch(record, procDir, workerName) === "adopt" ? "live" : "residue";
}

/** 只读地把整份载体判成三态（外部读者的【唯一入口】）。读文件 → 逐条 classifyDispatchEntry。
 *  文件缺失 / 不可读 / 解析失败 ⇒ status "not-evaluated"（entries 为 []，⛔ 不与「空 map、确无在飞」
 *  同形——后者 status "ok" 且 entries []）。 */
export function readDispatchStoreClassified(
  file: string,
  procDir: string = "/proc",
  workerName: string = WORKER_PROCESS_NAME,
): DispatchStoreReading {
  const unreadable = (fileState: "missing" | "unreadable" | "malformed"): DispatchStoreReading => ({
    status: "not-evaluated",
    fileState,
    file,
    entries: [],
    live: 0,
    residue: 0,
  });
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    // ENOENT = 从未写过（还没有任何派发）；其余（EACCES 等）= 文件在但读不了。两者都是 not-evaluated，
    // 但成因不同形（⛔ 不折成一个 "missing"）。
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
    return unreadable(code === "ENOENT" ? "missing" : "unreadable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreadable("malformed");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return unreadable("malformed");
  const entries: DispatchStoreEntry[] = [];
  for (const [taskId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      entries.push({ taskId, record: null, state: "not-evaluated", schema: null });
      continue;
    }
    const record = value as Partial<DispatchRecord>;
    const schema = typeof record.schema === "string" && record.schema.length > 0 ? record.schema : null;
    const pid = typeof record.workerPid === "number" && Number.isFinite(record.workerPid) ? record.workerPid : null;
    // 记录自报的 taskId 缺失时回落到 map 键（载体按 taskId 索引，键就是 writer 用的那个值）；两者都
    // 没有可用 workerPid ⇒ 这条记录结构不可读，⛔ 不猜一个判定。
    const identityTask = typeof record.taskId === "string" && record.taskId.length > 0 ? record.taskId : taskId;
    if (pid === null) {
      entries.push({ taskId, record: record as DispatchRecord, state: "not-evaluated", schema });
      continue;
    }
    entries.push({
      taskId,
      record: record as DispatchRecord,
      state: classifyDispatchEntry({ taskId: identityTask, workerPid: pid }, procDir, workerName),
      schema,
    });
  }
  return {
    status: "ok",
    fileState: "ok",
    file,
    entries,
    live: entries.filter((e) => e.state === "live").length,
    residue: entries.filter((e) => e.state === "residue").length,
  };
}
