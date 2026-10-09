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
// 原因是 `packages/quay/src/serve.ts` 也是它们的消费者（AC-251 把控制面并进 `quay serve` 进程），
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
export function residentLoopStop(): ResidentLoopStop {
  let stopRequested = false;
  let wakeResolve: (() => void) | null = null;
  // 当前在飞 sleep 排定的定时器 handle（见 WHY 第三条）：requestStop 提前唤醒时须 clearTimeout，
  // 否则悬空 handle 会把事件循环/测试进程拖到原 `ms` 到期。
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    isStopRequested: () => stopRequested,
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
      wakeResolve = resolve;
      wakeTimer = setTimeout(() => {
        wakeTimer = null; // 已到点 ⇒ 本觉的定时器不再在飞，提前唤醒路径无须（也不应）再 clear 它
        if (wakeResolve === resolve) wakeResolve = null;
        resolve();
      }, ms);
    }),
  };
}
