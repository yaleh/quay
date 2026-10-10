// plugin/scripts/driver-runtime.ts — AC151: 两级分层抽象（Layer 0 driver-runtime + Layer 1a/1b）。
// (tasks/gap-ac151-two-level-driver-layer-landing)
//
// WHY THIS EXISTS（manager-phase-goal.md ### AC151 / SPEC-unified-driver-architecture §2.1）：
// promotion-driver 与 worker-driver 各自独立发明了同一套常驻驱动骨架（reap/派发/判停/round 心跳/控制面/
// liveness），且真正 supervisor（respawn/pid 记账/8 张 registry 表）一直住在 bash 里
// （promotion-driver-launch.sh），测试只能黑盒 spawn 整个进程。人 2026-08-23 逐字裁定「这不是可选项、
// 不是迁移期并存」：supervisor 港进 TS，cli/driver.ts 由 spawnSync 薄壳变真正实现入口。
//
// ⛔ 不是一个 kernel + N 个平级 plugin，是【两级】抽象：
//
//   Layer 0 · driver-runtime（三种 driver 全部共享）
//     supervisor   respawn / pid 记账 / stop sentinel / 8 张 registry 表（由 .sh 港进）
//     loop         round 计数 / 信号处理 / 异步 spawn 原语（runAsync）
//     trigger      兜底轮询（interval）+ 事件订阅（提前唤醒，⛔ 非替代轮询）
//     stopCondition halt(控制面) ∧ resourceGate ∧ kind 自定终止
//     heartbeat    每轮无条件写一条 round 记录（appendHeartbeatLine）
//     controlPlane MCP（halt/preference/forceDispatch，⛔ 非 worker 私产）
//     notify       send-to-session → manager（notifyManager）
//     profile      LLM 调用配置解析（launchArgv，AC140 单一构造点）
//     ResultVocab  ⛔ 输出词表强制含【无法评估】态（driver-result.ts）
//
//   Layer 1a · task-processing（promotion/worker 继承 0+1a）
//     source    候选池（ready-pool-check，参数化）
//     filters   ⛔ 可组合谓词【列表】（driver-filters.ts，AC152）
//     select    策略（全部合格 | LLM 选一）
//     act       spawn LLM worker（按 role profile = launchArgv）
//     verify    ⛔ 独立复核（driver-result.ts verifyIndependently，AC153）
//     outcome   task-keyed 记录（统一信封）
//
//   Layer 1b · routine（outer-kind 继承 0+1b）
//     routines  [{name, schedule, run() → Facts}]
//     schedule  复用 routine-scheduler.ts 判定函数（isDue）
//     collect   汇集 Facts
//     report    经 notify 上报
//
// 取假（AC1，一条命令可验）：
//   ① outer-kind（1b）被骨架强制实现空的候选池/选择/verify 三段 ⇒ 假（那三段属 1a，⛔ 不属于 0）。
//     结构保证：Layer 1b 的例程契约（RoutineSpec）不引用 Layer 1a 的 source/select/verify——1b 只 import
//     Layer 0（循环/心跳/判停经 import，非重实现），outer-kind 继承 0+1b 时结构上无法被迫实现 1a 三段。
//   ② 1b 重新实现了一份 Layer 0 已有的循环/心跳/判停 ⇒ 假（分层没起作用）。
//     结构保证：stopCondition/heartbeat/notify 只在本文件（Layer 0）定义一次，1a/1b 都经 import 消费。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0 · 主检出推导（order-independent，gap-main-checkout-root-derivation-recurs-three-sites）。
import { mainCheckoutRoot, repoRoot } from "./repo-root.ts";
// Layer 1a · filters（AC152 单一实现：可组合谓词列表，两 driver 共用）。
import { TASK_FILTERS, applyTaskFilters, makeFilterContext, allDepsDone, readTaskStatus } from "./driver-filters.ts";
// Layer 0 · ResultVocab + verify（AC153 单一实现：核心不变式 + 词表强制含 not-evaluated）。
import {
  verifyIndependently,
  verified,
  notEvaluated,
  failed,
  type DriverResult,
} from "./driver-result.ts";
// Layer 0 · controlPlane / controlState / resourceGate（AC150 单一实现）。
import {
  resourceGateCheck,
  isHalted,
  readControlState,
  writeControlState,
  applyHalt,
  applyPreference,
  applyForceDispatch,
  knownCallers,
  resolveCaller,
  headerValue,
  serveControlPlane,
  CONTROL_STATE_REL,
  PROMOTION_CONTROL_STATE_REL,
  type ControlPlaneHandle,
} from "./driver-shared.ts";
// Layer 1b · schedule（routine-scheduler 判定函数，⛔ 不新造定时器）。
import { isDue } from "./routine-scheduler.ts";
// Layer 0 · profile → L2 policy（gap-driver-binding-semantic-kind-to-profile：launchArgv 经 policy 解析
// 语义 kind → profile，⛔ 不各自解析 profiles.yml / 不硬编码 launcher/model）。
import { loadProfiles, resolveRole, type ProfilesConfig } from "./profile-policy.ts";
import { rootsFromEnv, mcpConfigArgvSuffix, type McpConfigRoots } from "./mcp-blacklist-resolve.ts";

// ── Layer 0 · ResultVocab / controlPlane（re-export，单一真相源）────────────────────────────────────
// 三种 driver 全部经本文件消费这些词表/控制面；⛔ 不得在 kind 里另写一份。
export { verifyIndependently, verified, notEvaluated, failed };
export type { DriverResult };
export {
  resourceGateCheck,
  isHalted,
  readControlState,
  writeControlState,
  applyHalt,
  applyPreference,
  applyForceDispatch,
  knownCallers,
  resolveCaller,
  headerValue,
  serveControlPlane,
  CONTROL_STATE_REL,
  PROMOTION_CONTROL_STATE_REL,
};
// Layer 0 · 常驻循环停机控制器（residentLoopStop，单一实现于 driver-shared.ts）：outer / promotion /
// quality-gate 三循环共用——finding `driver-sleep-requeststop-triple`（semantic-dedup-scan）抽出。
export { residentLoopStop, type ResidentLoopStop } from "./driver-shared.ts";
// Layer 1a · filters（re-export，两 driver 经本文件消费同一谓词列表）。
export { TASK_FILTERS, applyTaskFilters, makeFilterContext, allDepsDone, readTaskStatus };

// ── Layer 0 · registry 表（数据，由 promotion-driver-launch.sh 港进）───────────────────────────────
// 每个 kind 的差异全部由这张【数据表】承载（⛔ 非两份代码分支，AC139-2）。新增一个 kind = 这里加一行 +
// 写该 kind 的 .ts（继承 Layer 0 + 1a 或 1b），⛔ 不需要重写 respawn 循环/心跳/判停。

/** 驱动 kind 标识（promotion/worker = 任务处理型，继承 0+1a；outer = 例程型，继承 0+1b——AC143 承接
 *  outer 的纯机械 A/B 段；quality = 例程型（AC144，1b）——均无任务池/无选择/无 verify）。 */
export type DriverKind = "promotion" | "worker" | "outer" | "quality" | "meta" | "goal";

/** 一个 kind 的 registry 条目（KIND_* 八张 bash 表 → 一个 TS 数据结构）。 */
export interface KindSpec {
  /** driver .ts 文件名（相对 <root>/plugin/scripts/）。 */
  driver: string;
  /** 状态文件前缀（<prefix>.pid / <prefix>-supervisor.pid / <prefix>-supervisor.log …）。 */
  prefix: string;
  /** 支持的动词（__supervise 是内部模式，非用户动词）。 */
  verbs: readonly string[];
  /** cap 旗标名（promotion=--cap；worker=--concurrency）。 */
  capFlag: string;
  /** 是否透传 --interval（promotion 是定时驱动；worker 常驻选择环无 --interval）。 */
  hasInterval: boolean;
  /** 是否透传 --reconcile-interval（仅 worker 常驻选择环有边沿触发+无地板的问题）。 */
  hasReconcile: boolean;
  /** --pid-file 语义：true=驱动自写自己的 pid（单值覆盖）；false=in-flight 子进程 pid（append）。 */
  pidSelf: boolean;
  /** run-id 前缀（缺省 run_id = <prefix>-<epoch>）。 */
  runPrefix: string;
  /** 载体文件（相对 .quay/）。⛔ 顺序【不是】主载体优先级——status 的 carrier_path 取
   *  「实际存在的第一个」（见 carrierStats 的 primaryPath）：registry 表把 outcome 排在 round 前，
   *  但只有同时写两个名字的 workspace 才两个都有；只写新名字的项目取首个会报一个不存在的路径。 */
  carriers: readonly string[];
  /** 载体记录的时间戳键（缺省 ts；quality 的判词载体用 judgedAt——gap-meta-carrierstats）。 */
  tsKey?: string;
  /** 控制态文件（相对 .quay/；drain 写它、驱动判停读它）。 */
  controlFile: string;
}

/** 8 张 bash registry 表 → 单一 TS 数据表（AC139-2 单一真相源）。 */
export const DRIVER_KINDS: Record<DriverKind, KindSpec> = {
  promotion: {
    driver: "promotion-driver.ts",
    prefix: "promotion-driver",
    verbs: ["start", "stop", "drain", "resume", "status", "restart", "liveness"],
    capFlag: "--cap",
    hasInterval: true,
    hasReconcile: false,
    pidSelf: true,
    runPrefix: "pm-prod",
    carriers: ["promotion-outcome.jsonl", "promotion-round.jsonl"],
    controlFile: "promotion-control.json",
  },
  worker: {
    driver: "worker-driver.ts",
    prefix: "worker-driver",
    verbs: ["start", "stop", "drain", "resume", "status", "restart", "liveness"],
    capFlag: "--concurrency",
    hasInterval: false,
    hasReconcile: true,
    pidSelf: false,
    runPrefix: "wk-prod",
    carriers: ["worker-outcome.jsonl", "worker-round.jsonl"],
    controlFile: "worker-control.json",
  },
  // AC143：outer 例程型 kind（继承 Layer 0 + 1b，⛔ 非 1a 任务处理型）。无 cap 概念（例程是「读→报」
  // 不是「spawn 执行者」），capFlag 仅为 registry 字段齐整（⛔ 生产不传 --cap 给 outer）。carriers 单一：
  // 每轮无条件写一条 round 记录（含 facts），AC1 生产载体。
  outer: {
    driver: "outer-driver.ts",
    prefix: "outer-driver",
    verbs: ["start", "stop", "drain", "status", "restart", "liveness"],
    capFlag: "--cap",
    hasInterval: true,
    hasReconcile: false,
    pidSelf: true,
    runPrefix: "ot-prod",
    carriers: ["outer-round.jsonl"],
    controlFile: "outer-control.json",
  },
  quality: {
    driver: "quality-gate-driver.ts",
    prefix: "quality-driver",
    verbs: ["start", "stop", "drain", "resume", "status", "restart", "liveness"],
    capFlag: "", // 例程型 kind 无任务池 ⇒ 无 cap（driverArgvForKind 仅在 opts.cap 非空时拼 capFlag）
    hasInterval: true,
    hasReconcile: false,
    pidSelf: true,
    runPrefix: "qg-prod",
    carriers: ["quality-round.jsonl"],
    tsKey: "judgedAt",
    controlFile: "quality-control.json",
  },
  // meta：机制演进复核（例程型，继承 Layer 0 + 1b）。唯一例程 = meta-review：跑 active goal 各 AC 的
  // criterion → 机械算 divergence → 【读数变了/给了 focus/到地板】才派语义半（事件触发 + 定时器地板，
  // 08-23 SPEC §5 的机械形态）。无任务池 ⇒ 无 cap（同 quality/outer）。
  meta: {
    driver: "meta-driver.ts",
    prefix: "meta-driver",
    verbs: ["start", "stop", "drain", "resume", "status", "restart", "liveness"],
    capFlag: "",
    hasInterval: true,
    hasReconcile: false,
    pidSelf: true,
    runPrefix: "mt-prod",
    carriers: ["meta-driver-round.jsonl"],
    controlFile: "meta-control.json",
  },
  // goal（gap-goal-driver-mechanical-ring，G6）：goal 机械环例程型 kind（继承 Layer 0 + 1b，同
  // quality/meta）。每轮对每个 active GOAL 跑其 AC 的 criterion → verdict → 写 evidence、I2 推导
  // flip achieved、I3 判陈旧三态、I4 查分歧，一条 Fact[] 写 .quay/goal-round.jsonl。无任务池 ⇒
  // 无 cap（同 quality/outer/meta）。
  goal: {
    driver: "goal-driver.ts",
    prefix: "goal-driver",
    verbs: ["start", "stop", "drain", "resume", "status", "restart", "liveness"],
    capFlag: "",
    hasInterval: true,
    hasReconcile: false,
    pidSelf: true,
    runPrefix: "gl-prod",
    carriers: ["goal-round.jsonl"],
    controlFile: "goal-control.json",
  },
};

export const KNOWN_KINDS = Object.keys(DRIVER_KINDS) as DriverKind[];

// ── Layer 0 · 工具（ts / pid / 落盘） ─────────────────────────────────────────────────────────────

/** 与 .sh `date -u +"%Y-%m-%dT%H:%M:%SZ"` 同形（秒级 UTC，⛔ 无毫秒——supervisor log 与 carrier 记录
 *  的 ts 都经此，status 的 last_record_ts 比较也依赖 ISO 可字典序）。 */
export function ts(): string {
  return new Date().toISOString().slice(0, 19) + "Z";
}

// `pidAlive`（`kill -0` 等价：pid 存活判定，读不懂 / 非正整数 ⇒ false）**不再在本文件定义** ——
// 它是 Core `server-state.ts` 的单一真相源，在下面的「Layer 0 · Core 库符号的单一导入面」处导入并
// 再导出。旧实现在这里留过一份**副本**，其裸 `catch { return false }` 把 EPERM 读成 DEAD，而另外三份
// 读成 ALIVE ⇒ 同一个探针在 driver 路径上把「活着但不属于我们」的 pid 报成死的
// （`.quay/routine-findings.jsonl` finding `pidalive-eperm-opposite`，routine `semantic-dedup-scan`，
// runId `semantic-dedup-scan-1789889905875`）。副本已删，语义差随之消失，⛔ 不是改了判据再留一份。

/** 读 pid 文件（缺失/读失败 ⇒ ""，⛔ 不抛）。 */
export function readPidFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

/** 写 pid 文件（原子语义不需要——单进程写；mkdir -p）。返回落盘路径。 */
export function writePidFile(file: string, pid: number): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${pid}\n`, "utf8");
  return file;
}

/** 追加一行到日志（mkdir -p + append）。 */
export function appendLog(file: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line + "\n", "utf8");
  } catch {
    /* 日志写失败不致命（运行时日志） */
  }
}

/** 异步 sleep（⛔ 不用 Atomics.wait 阻塞事件循环；start/stop 的等待窗口用它）。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 本 kernel 文件的绝对路径（supervisor 自重启的 cmdline 载体：`node … driver-runtime.ts __supervise`）。
 *
 *  `readlink -f`（realpath）后返回（gap-config-provider-path-frozen-to-versioned-cache-dir）：一个项目
 *  可能通过 `<ws>/.quay/plugin` 这条**项目内符号链接**引用插件（config 的 provider path 正是它），此时
 *  任何把**符号链接路径**当作 exec 实参的启动都会让 `/proc/<pid>/cmdline` 只留下链接路径 —— 而
 *  `versionOfKernelScript` 要从那条路径的**版本目录**读出已加载版本（硬规则 4b：cmdline 是外部可核的
 *  直接量，不能让它变成一条无版本信息的代理量）。realpath 失败（路径消失等）⇒ 原样返回，⛔ 不抛。
 *  Node 默认已对主模块做 realpath，所以这是一条廉价的不变式（`--preserve-symlinks-main` 之类会推翻它）。 */
export function kernelSelfPath(): string {
  const p = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** 本 kernel 的脚本目录（sibling 脚本解析基准：driver / ready-pool-check / send-to-session 都住这里）。
 *  锚在本 kernel 自身安装位置（⛔ 非 opts.root —— AC-203：quay-init 后的第三方项目没有 plugin/）。
 *  QUAY_PLUGIN_ROOT 覆盖基准（hermetic 测试缝，同 Core plugin-root.ts 的手法）。 */
export function resolveKernelScriptsDir(): string {
  const override = process.env.QUAY_PLUGIN_ROOT;
  if (override) return path.join(override, "scripts");
  return path.dirname(kernelSelfPath());
}

/** 本 kernel 的 plugin root（含 scripts/ 的目录；出厂 settings 的基准）。QUAY_PLUGIN_ROOT 覆盖。 */
export function resolveKernelPluginRoot(): string {
  const override = process.env.QUAY_PLUGIN_ROOT;
  if (override) return override;
  const dir = path.dirname(kernelSelfPath());
  return path.basename(dir) === "dist" ? path.dirname(path.dirname(dir)) : path.dirname(dir);
}

/** 本 kernel 是否跑在【源检出】里 —— Core 源码就在本 plugin root 旁边
 *  （`<repo>/plugin/scripts/*.ts` + `<repo>/packages/quay/src/**`）。只有那里 raw `.ts` 才是真相源
 *  （编辑即生效 + `sourceFilesMaxMtimeMs` 的源码自刷新）。
 *
 *  ⛔ 出厂安装一律以自包含 dist bundle 为可运行形态：npm-pack（raw .ts 直接不存在）、plugin
 *  MARKETPLACE cache（`publish-dist-branch.sh` rsync 整个 plugin/，raw 与 dist 并存、且没有
 *  node_modules 可解析 raw 的裸 npm import）、第三方 vendored 副本、`package.sh` 的 staged 快照。
 *  实测 2026-09-14（gap-dist-plugin-missing-node-modules-task-schema-yaml）：在真实的
 *  `~/.claude/plugins/cache/quay/quay/0.6.2` 上，raw kernel 的 23 文件 import 闭包需要 `yaml` /
 *  `@modelcontextprotocol/sdk/*` / `zod`，`quay driver start` 对**每一个 kind** 都崩在
 *  `ERR_MODULE_NOT_FOUND: Cannot find package 'yaml' imported from <cache>/scripts/task-schema.ts`，
 *  而同一目录的 `scripts/dist/driver-runtime.js` 跑同一个 verb 正常。出厂树是静态的（没有源码可
 *  推进），选 raw 零收益、代价是启动即崩 ⇒ 判据是「是不是源检出」，⛔ 不是「哪个形态存在」。
 *
 *  ⛔ 镜像 Core `packages/quay/src/plugin-root.ts::isPluginSourceCheckout`（同一判据，从本 kernel
 *  自身安装位置解析 —— kernel ⛔ 不能 import Core 模块）。两处必须同改。
 *
 *  ⛔ 本函数只做存在性探针，**不在这里第二次拼 `packages/quay/src`**：布局知识必须只存在于单一入口
 *  （kernel-sibling-resolution-check 的 DRIVER-SCOPE 规则——root 锚点拼法只允许出现在
 *  `resolveQuayCodeRoot` / `resolveQuaySrcModule` / `quaySrcModuleLegacyShape` 三个函数体内；
 *  实测 2026-09-14 本函数原先自己 `path.join(codeRoot, "packages", "quay", "src")` 时，
 *  `kernel-sibling-resolution-check` 报 `driver-root-anchor` ⇒ 整轮 suite `# fail 5`）。
 *  故取源树形的**目录**（`rel=""` ⇒ `path.join` 的末段空串被规范化掉，得 `<codeRoot>/packages/quay/src`
 *  本身，与原本的目录级判据逐字等价），⛔ 不要改成探某个具体文件（夹具只建目录、不建文件）。 */
export function isKernelSourceCheckout(): boolean {
  const codeRoot = resolveQuayCodeRoot();
  return !!codeRoot && fs.existsSync(quaySrcModuleLegacyShape(codeRoot, ""));
}

/** 解析本 kernel 的一个 sibling 脚本到可运行形态：原始 .ts（dev tree，用 --experimental-strip-types 跑）
 *  或 bundled dist/<name>.js（installed artifact，纯 ESM，不带 flag 跑）。两者都不在 ⇒ null（调用方
 *  fail-closed）。⛔ 不锚在 opts.root（AC-203）。
 *
 *  ⛔ raw 只在【源检出】里胜出（isKernelSourceCheckout）：出厂安装里 raw 与 dist 并存时 dist 优先
 *  —— 否则 supervisor 会 spawn 一个 import 不到 `yaml`/`zod`/`@modelcontextprotocol/sdk` 的裸 .ts，
 *  六个 driver kind 全部启动即崩（`runSupervisor` 的 `spec.driver` 正是经本函数解析）。dist 不存在
 *  ⇒ 退回 raw（保持既有行为，不把可解析的脚本变成 null）。 */
export function resolveKernelSibling(name: string): { path: string; stripTypes: boolean } | null {
  const dir = resolveKernelScriptsDir();
  const raw = path.join(dir, name);
  const isTs = name.endsWith(".ts");
  if (fs.existsSync(raw) && (!isTs || isKernelSourceCheckout())) return { path: raw, stripTypes: true };
  if (isTs) {
    const js = name.replace(/\.ts$/, ".js");
    const bundledDir = path.basename(dir) === "dist" ? dir : path.join(dir, "dist");
    const bundled = path.join(bundledDir, js);
    if (fs.existsSync(bundled)) return { path: bundled, stripTypes: false };
  }
  return fs.existsSync(raw) ? { path: raw, stripTypes: isTs } : null;
}

/** 解析本 kernel 的一个 shell sibling（.sh）到 `<pluginRoot>/scripts/<name>`。shipped 下 .sh 以
 *  loose 形态住在 `scripts/`（⛔ 不在 `scripts/dist/`），故 `resolveKernelSibling` 的 .ts→dist 回退
 *  覆盖不到；这是它的 .sh 半边（单一入口，⛔ 各 spawn 点不各自重写 basename==="dist" 上跳逻辑）。
 *  缺 ⇒ null（调用方 fail-closed）。 */
export function resolveKernelShellSibling(name: string): string | null {
  const script = path.join(resolveKernelPluginRoot(), "scripts", name);
  return fs.existsSync(script) ? script : null;
}

/** 解析一个 kernel sibling 脚本到【可直接 spawn 的完整 argv】（含解释器）。源树 ⇒
 *  `node --no-warnings --experimental-strip-types <dir>/<name>.ts`；installed 产物 ⇒
 *  `node --no-warnings <dist>/<name>.js`；`.sh` ⇒ `bash <pluginRoot>/scripts/<name>.sh`。
 *  找不到 ⇒ **null**（调用方 fail-closed 记 not-evaluated）。
 *
 *  ⛔ 返回 null 而不是回退到 `path.join(<workspaceRoot>, "plugin", "scripts", <name>)`：后者在 quay
 *  自己的开发检出里恰好正确（root 就是 repo 根），在第三方项目里指向一个不存在的文件——而
 *  spawn 不存在的文件只会得到 ENOENT/非零退出，被例程读成「跑过了、没数据」。
 *  硬规则 3b：读不到输入必须与「读到了、值是 X」不同形；硬规则 4：在开发检出里跑的测试结构上
 *  无法暴露这条差异（2026-09-13 gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root
 *  在真实第三方项目上的实测）。 */
export function kernelSiblingArgv(name: string, extra: readonly string[] = []): string[] | null {
  if (name.endsWith(".sh")) {
    const sh = resolveKernelShellSibling(name);
    return sh ? ["bash", sh, ...extra] : null;
  }
  const sib = resolveKernelSibling(name);
  if (!sib) return null;
  return sib.stripTypes
    ? ["node", "--no-warnings", "--experimental-strip-types", sib.path, ...extra]
    : ["node", "--no-warnings", sib.path, ...extra];
}

// ── Layer 0 · quay 自身代码根（resolveQuayCodeRoot，Plan 2 的单一解析入口）────────────────────────
// gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root：driver 运行时此前把
// 「工作区 root」与「quay 代码所在地」当成同一个目录，按 `<workspaceRoot>/packages|plugin/…` 拼
// quay 自己的模块路径。在 quay 自己的检出里两者恰好重合（root 就是 repo 根）⇒ 全部自测绿；
// upgrade-channel/vendor 安装下两者分离 ⇒ goal-store 调用报 `Cannot find module
// '<project>/packages/quay/src/goal-store.ts'`、outer 的 5 条 fact 因 unreadable/unparseable 取不到值，
// 而进程 alive=1、载体持续在写（静默失效）。⇒ 解析基准改为【本 kernel 自身的安装位置】，与
// workspaceRoot 彻底分离；⛔ 各处不再各拼一次（本函数 + resolveQuaySrcModule 是唯一入口）。

/** quay 自身代码（`packages/quay/src/**` 或 shipped 打平的 `<pkg>/src/**`）所在的根，从【本 kernel
 *  自身的安装位置】反推（⛔ 不用 opts.root —— AC-203：quay-init 后的第三方项目没有 packages/）。
 *
 *  两种出厂布局（按存在性判定，⛔ 非按包名/VERSION 判定）：
 *    源树     `<repo>/plugin/scripts/*.ts`   + `<repo>/packages/quay/src/**`  ⇒ 返回 `<repo>`
 *    shipped  `<pkg>/plugin/scripts|dist/*.js` + `<pkg>/src/**`                ⇒ 返回 `<pkg>`
 *  两者都不在 ⇒ null（调用方 fail-closed 并报出可诊断的原因，⛔ **不回退 workspace root**——
 *  那正是本缺陷的形态）。 */
export function resolveQuayCodeRoot(): string | null {
  const parent = path.dirname(resolveKernelPluginRoot());
  if (fs.existsSync(path.join(parent, "packages", "quay", "src"))) return parent;
  if (fs.existsSync(path.join(parent, "src"))) return parent;
  return null;
}

/** 解析不出时返回的【源树形】路径（该路径不存在）—— 单一入口的「miss 半边」，让调用方保留原有契约：
 *  「本函数给出 argv，跑不动由调用方按『读不懂』记 not-evaluated / unreadable」（硬规则 3b）。
 *  ⛔ 解析层不抛：把 miss 升级成异常会改掉**调用方的语义**（读不懂 → 崩溃），而不是修了路径解析
 *  （goal-driver.test.mjs 的 `scriptRoot 不存在 ⇒ unreadable` 负控制正是钉这条契约）。 */
export function quaySrcModuleLegacyShape(codeRoot: string, rel: string): string {
  return path.join(codeRoot, "packages", "quay", "src", rel);
}

/** quay 自身【随包出厂】的配置文件绝对路径（`scripts/drivers.yml` / `.claude-plugin/plugin.json`…），
 *  基准 = 本 kernel 的 plugin root（⛔ 非 `<workspaceRoot>/plugin/…`）。
 *
 *  drivers.yml 是 quay 自己的声明式配置（并发 cap / 轮间隔 / goal 段），随 plugin 出厂；第三方项目
 *  的 root 下没有 `plugin/` ⇒ 按 workspace root 读会**静默读不到**并回退到缺省值——配置失效而没有任何
 *  读数报出来（硬规则 3b 的「读不懂 ⇒ 伪装成合格」形态）。2026-09-13 第三方项目实测：四个 driver
 *  在 `/home/yale/work/quay-fleet` 上跑，全部 drivers.yml 读取都落到缺省分支。 */
export function kernelConfigPath(rel: string): string {
  return path.join(resolveKernelPluginRoot(), rel);
}

/** 在 quay 代码根下解析一个 `packages/quay/src/<rel>` 模块到实际路径（布局感知，单一入口）。
 *  源树 ⇒ `<codeRoot>/packages/quay/src/<rel>`；shipped 打平 ⇒ `<codeRoot>/src/<rel>`。
 *  两形皆无 ⇒ null（调用方 fail-closed）。`codeRoot` 缺省取 `resolveQuayCodeRoot()`。 */
export function resolveQuaySrcModule(rel: string, codeRoot: string | null = resolveQuayCodeRoot()): string | null {
  if (!codeRoot) return null;
  const srcTree = path.join(codeRoot, "packages", "quay", "src", rel);
  if (fs.existsSync(srcTree)) return srcTree;
  const shipped = path.join(codeRoot, "src", rel);
  if (fs.existsSync(shipped)) return shipped;
  return null;
}

// ── Layer 0 · Core 库符号的单一导入面（gap-ac262-…）──────────────────────────────────────────────
//
// 为什么在这里：drivers 需要 Core 的**库**符号（不是把它当 CLI spawn——那是另一个缺陷）。这类静态
// import 是正当的代码依赖：`build-plugin-dist.mjs` 的 coreSrcAliasPlugin 会把它内联进 `dist/*.js`，
// 出厂 bundle 因此自包含（⛔ 不能用运行期拼路径的 dynamic import 替代——那会让 shipped 形态落到
// node_modules 里的 `.ts`，Node ≥23.7 拒绝 strip-types；见 core-src-import.ts 头注释）。
//
// 但**「哪棵树里有 Core」这条布局知识只能出现在一处**（DRIVER-SCOPE 规则；本文件正是那个单一入口）。
// 于是这两个消费方（goal-driver / meta-driver）不再各自写出 `<repo>/packages/quay/src/…` 字面量，
// 而是从本模块取符号：布局知识留在 Layer 0，driver 只表达「我需要这个符号」。
// ⊢ AC-262 判据按源文本扫这两个文件（剥掉 `//` 行注释后不得出现 Core 源码树字面量），故符号本身
//   必须在这里落地一次；⛔ 不是把字面量藏起来——是把「谁知道布局」收敛到它该在的地方。
// `GOAL_ACCEPTANCE_ACTIVE_ENV`（判据重入闸的**变量名**）在这里落地一次的理由与上面完全相同：
// goal-driver 的「立案前直接量复核」要**参与**那道闸（跑判据前置位、已在跑则拒绝），而它必须读
// 同一个名字。⛔ 在 driver 侧重写一份 `"QUAY_GOAL_ACCEPTANCE_ACTIVE"` 字面量就是第二个定义——
// store 侧改名后 driver 会**静默停止守闸**（硬规则 5b 的形态），故走单一导入面。
export { inAchievedReverifyScope, readsFrozenPopulation, stripEvidenceTimestamp, GOAL_ACCEPTANCE_ACTIVE_ENV } from "../../packages/quay/src/goal-store.ts";
export { createMetaStore } from "../../packages/quay/src/meta-store.ts";
// goal-branch (SPEC-goal-branch-2026-10-03 §5 B1, ruling ⑩): the goal-driver OWNS the criterion
// worktree's lifecycle (create / refresh / delete, ruling ㉒) while the criterion's cwd is chosen by
// the store. Both sides must name the SAME path, so the derivation lives in Core once
// (`goalCriterionWorktreeDir`, derived from the config-resolved worktree namespace) and this module
// is where the driver-side symbols are surfaced — ⛔ goal-driver never spells a Core source-tree
// literal itself (AC-262; same reason the two re-exports above exist).
export { goalCriterionWorktreeDir, realpathOrSelf } from "../../packages/quay/src/goal-store.ts";
// `ensureGoalBranch` is the ONE creation site for `goal/<id>` (Core `branch-model.ts`) — the store
// calls it on the transition that leaves a branch-mode goal active. goal-driver now also calls it
// idempotently to BACK-FILL a missing branch on an already-active branch-mode goal
// (gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals), so the symbol is
// surfaced here for the same AC-262 reason as the two lines above: the driver expresses "I need this
// symbol", ⛔ never the Core layout literal.
export { goalBranchName, goalBranchRefExists, goalBranchTip, ensureGoalBranch } from "../../packages/quay/src/branch-model.ts";
export type { GoalBranchAction, GoalBranchReport } from "../../packages/quay/src/branch-model.ts";
// The ledger's `goal-merge-result` reading — the goal-side record of a LANDED `goal/<id>` merge. The
// back-fill predicate must tell "never created" from "merged and then deleted" (the latter must NOT
// be re-created), and this is the single definition of that fact (Core `goal-merge.ts`); ⛔ no second
// "was merged" predicate is written driver-side.
export { readGoalMergeResults } from "../../packages/quay/src/goal-merge.ts";
export type { GoalMergeResult } from "../../packages/quay/src/goal-merge.ts";
// goal-preview (SPEC-goal-branch-2026-10-03 §4.10, rulings ㉒㉓): the criterion worktree IS the
// preview instance, so goal-driver (which owns the worktree's lifecycle) must take its `.quay/`
// SNAPSHOT on create/refresh and STOP the preview serve before it deletes the worktree. Both live
// in Core (`goal-preview.ts`) and are surfaced here for exactly the reason above — the driver never
// spells a Core source-tree literal, and a third-party layout has no `packages/quay/src` to spell.
export {
  snapshotQuayDirInto,
  stopPreviewServe,
  previewWorktreeDir,
  ensureWorktreeNodeModules,
  type QuaySnapshotReading,
  type PreviewStopReading,
  type WorktreeNodeModulesReading,
} from "../../packages/quay/src/goal-preview.ts";
// GOAL-032：judge-stdout → 三态 verdict 的解析算法（Core kernel leaf）。goal-driver 的
// `parseSemanticSufficiencyVerdict` 与产品侧 `criterion-fidelity.ts::parseFidelityVerdict` 此前各有一份
// 逐字相同的解析循环，现收敛到 Core 的单一实现；driver 只是**取符号**，布局知识仍只在本节出现一次
// （AC-262 判据按源文本扫 goal-driver / meta-driver，剥掉 `//` 后不得出现 Core 源码树字面量——同上一节）。
export { parseBinaryVerdict } from "../../packages/quay/src/kernel/verdict-parse.ts";

// `pidAlive`：**本文件曾是它的第四份副本**，且是唯一把 EPERM（exists-but-not-ours）读成 DEAD 的一份
// ⇒ `rmCarrierUnlessForeignLive`（存在的理由正是「别删掉一个外来的活进程在盘上唯一的记录」）与
// `stopLegacyPair`（存在的理由正是「停不掉不得报成停掉了」）在 EPERM 那一支上恰好被自己的探针反制。
// 现改为**从单一真相源取符号**：Core `server-state.ts` 定义一次，本文件导入并再导出（下游
// `server-partial-stop-verify.ts` 等经本文件取，布局知识仍只在本节出现一次）。
// (import + export, ⛔ 不是 `export … from` —— 本文件内部多处直接调用 `pidAlive`，需要一个本地绑定。)
import { pidAlive } from "../../packages/quay/src/server-state.ts";
export { pidAlive };

// 「宿主**实际加载**的版本 vs **已安装**版本」的读数：**从 Core 取符号**，本文件不再自带一份实现。
// WHY 落 Core 而不是留在这里（gap-serve-host-has-no-loaded-version-reading-driver-status-covers-
// anchor-only）：`quay server status` 也要读同一个量（serve 宿主的 loaded_version），而 Core 不得
// **静态** import `plugin/**`（import-graph-check 的 reverseEdges 棘轮），运行时 `import()` 内核又会把
// 整个内核闭包拖进一条 status 命令、且在 linked worktree 里会被 `plugin-root.ts` 约束 ① 重定位到
// **主检出**的内核（读数于是反映主检出的代码而不是被测代码）。
// ⇒ 唯一实现落在 `packages/quay/src/loaded-version.ts`，本文件导入并原样再导出（`plugin/` → `packages/`
// 是受认可的方向；⛔ 不是复制一份，硬规则 5b）。`versionOfKernelScript` 是它历来的导出名，保留为别名。
import {
  loadedVersionReadingForHost,
  loadedScriptFromCmdline,
  readVersionFile,
  readVersionOfDirectory,
  installedVersionFromRegistry,
  providerPathVersions,
  configProviderPathReading,
  compareVersions,
  versionOfLoadedScript,
  pickKernelScript,
  DRIVER_HOST_NOUN,
  type LoadedVersionState,
  type VersionRelation,
  type LoadedVersionReading,
  type InstalledRegistryReading,
} from "../../packages/quay/src/loaded-version.ts";
export {
  loadedScriptFromCmdline,
  readVersionFile,
  readVersionOfDirectory,
  installedVersionFromRegistry,
  providerPathVersions,
  configProviderPathReading,
  compareVersions,
  versionOfLoadedScript,
};
/** 历来的导出名（内核视角），⛔ 与 `versionOfLoadedScript` 是**同一个函数**（serve 的 vendor bundle
 *  也经它读版本）——保留只为不打断既有消费面。 */
export { versionOfLoadedScript as versionOfKernelScript };
export type { LoadedVersionState, VersionRelation, LoadedVersionReading, InstalledRegistryReading };

// 「把子进程包进 `systemd-run --user --scope` 包络」的**唯一一份**实现：单元名派生、可用性探测、
// MemoryMax 策略、argv 构造。**从 Core 取符号**，本文件不再自带一份（gap-serve-host-spawned-in-
// caller-session-cgroup-dies-when-cloudcli-restarts）。
// WHY 落 Core 而不是留在这里：serve 宿主的两个 spawn 点横跨边界（Core `cli/server.ts:spawnHost` +
// 本层 `start-drivers.ts:startServe`），而 Core **不得静态 import `plugin/**`**（import-graph-check 的
// reverseEdges 棘轮）⇒ 纯函数提到 `packages/quay/src/systemd-scope.ts`，两侧 import 同一份。本文件
// 把它历来导出的名字（`anchorLaunchArgv` / `anchorUnitName` / `anchorSystemdRunAvailable` / …）原样
// 再导出（`plugin/` → `packages/` 是受认可的方向；⛔ 不是复制一份，硬规则 5b）。
import {
  scopeUnitName,
  systemdScopeAvailable,
  parseMemoryMaxOverride,
  defaultScopeMemoryMax,
  resolveScopeEnvelope,
  scopeLaunchArgv,
  SCOPE_ENVELOPE_HOST_FRACTION,
  SERVE_UNIT_PREFIX,
  type ResolvedScopeEnvelope,
  type ScopeEnvelopeSource,
} from "../../packages/quay/src/systemd-scope.ts";

// ── Layer 0 · 稳定承载（resolveMainRoot，gap-resident-driver-stable-carrier-liveness AC1）──────────
// 常驻 supervisor 不得由生命周期短于它的对象（worktree）承载：若 --root 落在 git worktree 内，把 root
// 规范化到 primary worktree（主检出）。git 不可用 / 非 git 仓库 / 解析失败 ⇒ 原样返回 root。

/** 把 --root 规范化到主检出（order-independent：`git rev-parse --git-common-dir` 的父目录，经
 *  repo-root.ts `mainCheckoutRoot` 共享——⛔ 不用 `git worktree list --porcelain` 首个 worktree 行，
 *  该列表顺序不保证主检出在前）。 */
export function resolveMainRoot(root: string): string {
  const main = mainCheckoutRoot(root);
  if (main && fs.existsSync(main)) return main;
  return root;
}

// ── Layer 0 · 载体观测（carrierStats，AC139-3 / AC138-3）──────────────────────────────────────────
// carrier_records = 全载体行数之和（wc -l 语义：数换行符）；last_record_ts = 全载体末条记录 ts 的
// 最大值（⛔ 只报计数无法区分「在长」与「停更」——载体停更与「一切正常」同形）。时间戳键按 kind 的
// tsKey 读（缺省 ts；quality 判词载体用 judgedAt——gap-meta-carrierstats：键不匹配会把停摆伪装成
// 未查）。quality 载体混两种键（心跳 ts + 判词 judgedAt），读两者较新者——见 gap-meta-round-log-rel。

/** 一个载体的存在性 + 行数分解（Plan 2：让「新旧载体名并存」在读数上可见，⛔ 靠读代码才知道）。 */
export interface CarrierFileStat {
  /** 载体 basename（相对 .quay/；registry 表里的名字）。 */
  name: string;
  /** 该名字在 .quay/ 下是否存在（fs.existsSync）。 */
  exists: boolean;
  /** 该载体自身的行数（wc -l 语义；不存在 ⇒ 0）。 */
  records: number;
}

/** 一个 kind 的载体观测结果。 */
export interface CarrierStats {
  records: number;
  lastTs: string | null;
  /** 首个【实际存在】的载体绝对路径；一个都不存在 ⇒ null。
   *  ⛔ 不报一个不存在的路径——路径与 records 必须同源同态（硬规则 3b：「读不到」不得与
   *  「正常读数」同形：有路径 + 有计数 + 有时间戳看起来一切正常，实际谁都没读到）。 */
  primaryPath: string | null;
  /** 【提供 `lastTs` 的那个】载体的绝对路径；`lastTs` 为 null ⇔ 本字段为 null（同态，硬规则 3b）。
   *
   *  ⛔ 与 `primaryPath` 是**两个不同的量**：`primaryPath` = carriers 里首个存在的（「谁在盘上」），
   *  本字段 = 末条 ts 最大的那个（「这个 ts 从哪来」）。真实工作区上两者会不同名——实测
   *  2026-09-13 生产 `/home/yale/work/quay` 的 `promotion`：`promotion-outcome.jsonl` 存在但末条 ts
   *  停在 20:01:48Z（2.5h 陈旧），`promotion-round.jsonl` 每 30s 一条、末条 22:33:30Z ⇒ 报出的
   *  `last_record_ts` 来自后者，而读 `carrier_path` 的人看的是前者。
   *  ⇒ 「ts 大 ⇒ ts 来自 primaryPath」是一条**只在上游注里成立**的推断，落到渲染面上就是
   *  「真读数被归因到没供数的载体」（硬规则 3b/4b：一条读数声称的来源不是它的来源）。
   *  见 gap-driver-status-carrier-path-source-label-mismatch。 */
  lastTsCarrier: string | null;
  /** 逐载体分解（哪个存在、哪个没有、各自多少行）。 */
  files: CarrierFileStat[];
}

/** 读一个 kind 的全部载体：行数之和 + 末条 ts 最大。读失败/缺失 ⇒ 该载体记 0 条（⛔ 不抛）。 */
export function carrierStats(root: string, kind: DriverKind): CarrierStats {
  const spec = DRIVER_KINDS[kind];
  const tsKey = spec.tsKey ?? "ts";
  // 时间戳键集合：quality 载体混两种键（心跳 ts + 判词 judgedAt——gap-meta-round-log-rel）。取两者较
  // 新者作 lastTs；⛔ 只读 tsKey 会把心跳（ts，每 30s 一条的 liveness 直接量）与停摆同形——判词 judgedAt
  // 是间歇量，池不触发就停更，靠它判活必假报 stall（硬规则 4b：liveness 用直接量，⛔ 不用间歇派生量）。
  const tsKeys = tsKey === "ts" ? ["ts"] : [tsKey, "ts"];
  let records = 0;
  let lastTs: string | null = null;
  // 主载体 = carriers 中【首个实际存在】的那个，⛔ 不是列表首个（registry 表把 outcome 排在 round 前，
  // 但这只对「两个名字都写」的 quay 开发检出成立；只用新名字的干净 workspace —— 如第三方项目
  // quay-fleet —— 只有 <kind>-round.jsonl ⇒ 取首个会报一个不存在的路径，而 records 汇总的是真文件
  // ⇒ 一个诊断字段谎报自己的来源。见 gap-driver-status-carrier-path-names-first-entry-not-the-existing-one；
  // 同一现象独立复现于 gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable:73-75）。
  let primaryPath: string | null = null;
  // 提供 lastTs 的那个载体（⛔ 与 primaryPath 分开跟踪——两者是「谁在盘上」与「ts 从哪来」两个量）。
  // 比较用严格 `>`（相等不更新）⇒ 并列时保留**首个**供数载体，与 lastTs 的取值规则逐字一致。
  let lastTsCarrier: string | null = null;
  const files: CarrierFileStat[] = [];
  for (const name of spec.carriers) {
    const file = path.join(root, ".quay", name);
    const exists = fs.existsSync(file);
    if (exists && primaryPath === null) primaryPath = file;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      files.push({ name, exists, records: 0 });
      continue;
    }
    if (text === "") {
      files.push({ name, exists, records: 0 });
      continue;
    }
    // wc -l 语义：数换行符（⛔ split("\n").length 会把无尾换行的文件多算 1）。
    const n = (text.match(/\n/g) ?? []).length;
    records += n;
    files.push({ name, exists, records: n });
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        for (const k of tsKeys) {
          if (j && typeof j[k] === "string" && j[k] && (lastTs === null || j[k] > lastTs)) {
            lastTs = j[k];
            lastTsCarrier = file;
          }
        }
      } catch {
        /* torn/partial tail — skip */
      }
    }
  }
  return { records, lastTs, primaryPath, lastTsCarrier, files };
}

/** 派生状态文件的绝对路径（supervisor 共享的一份路径规则，⛔ kind 差异由 registry 表承载）。 */
export function statePaths(root: string, kind: DriverKind) {
  const spec = DRIVER_KINDS[kind];
  const q = path.join(root, ".quay");
  return {
    driverPidFile: path.join(q, `${spec.prefix}.pid`),
    supervisorPidFile: path.join(q, `${spec.prefix}-supervisor.pid`),
    driverLog: path.join(q, `${spec.prefix}.log`),
    supervisorLog: path.join(q, `${spec.prefix}-supervisor.log`),
    livenessLog: path.join(q, `${spec.prefix}-liveness.log`),
    stopSentinel: path.join(q, `${spec.prefix}.stop`),
    inflightPidFile: path.join(q, `${spec.prefix}-inflight.pid`),
    controlFile: path.join(q, spec.controlFile),
    // 控制面宿主（AC-252）启动后写的**运行时回读面**：{kind, url, port, pid, at}。supervisor 日志里
    // 也有人读的一行，但日志是 append-only 文本、逐 kind 回读要解析；本文件是结构化字段（同 statePaths
    // 家族），供 AC2/AC6 逐 kind 回读「控制面真的起了、实际端口是多少」。
    controlPlaneFile: path.join(q, `${spec.prefix}-control-plane.json`),
  };
}

/** --pid-file 传给驱动的目标：promotion = 驱动 pid 文件（自写）；worker = in-flight pid 文件（append）。 */
export function pidArgFile(root: string, kind: DriverKind): string {
  const spec = DRIVER_KINDS[kind];
  const q = path.join(root, ".quay");
  return spec.pidSelf ? path.join(q, `${spec.prefix}.pid`) : path.join(q, `${spec.prefix}-inflight.pid`);
}

/** 组装驱动 argv（run_supervisor 的 args 映射：--cap → capFlag；--interval / --reconcile-interval 按
 *  registry 透传；--pid-file / --run-id 恒传）。纯函数，可单测。 */
export function driverArgvForKind(
  root: string,
  kind: DriverKind,
  opts: { cap?: string; interval?: string; reconcileInterval?: string; pidFile: string; runId: string },
): string[] {
  const spec = DRIVER_KINDS[kind];
  const args = ["--root", root];
  if (opts.cap) args.push(spec.capFlag, opts.cap);
  if (spec.hasInterval && opts.interval) args.push("--interval", opts.interval);
  if (spec.hasReconcile && opts.reconcileInterval) args.push("--reconcile-interval", opts.reconcileInterval);
  args.push("--pid-file", opts.pidFile, "--run-id", opts.runId);
  return args;
}

// ── Layer 0 · 控制面宿主（SPEC-unified-quay-server §7 阶段 A1：控制面上收进 Layer 0）──────────────
// GOAL-017/AC-252：`serveControlPlane` 的实现早在 driver-shared.ts 一份（AC150-3），但**调用点**只有
// worker-driver 一处 ⇒ 另外五个 kind 结构上拿不到入站控制面。本函数把调用点上收成【仓库里唯一的一个】，
// 且挂在 Layer 0：六个 kind 全部经 runSupervisor（registry 表驱动）获得控制面 ⇒ 新增一个 kind 只要在
// DRIVER_KINDS 加一行，⛔ 不需要改任何 kind 文件（硬规则 9：结构保证，而不是「记得加一行」）。
//
// ⚠️ `rel` 恒为【该 kind 自己的】控制态文件（`DRIVER_KINDS[kind].controlFile`），⛔ 绝不回落
// serveControlPlane 的缺省 `rel`——缺省是 worker 的（driver-shared.ts:294），回落会让 halting kind X
// 写进 worker 的控制态文件，即「控制面看起来通了、实际停错了 kind」的恒假读数（硬规则 3b；meta-driver.ts
// 的同族注释：「控制态文件（与 quality 分开——⛔ 共用会让一个 kind 的 halt 误停另一个）」）。
export async function serveKindControlPlane(
  kind: DriverKind,
  root: string,
  opts: { host?: string; port?: number; env?: NodeJS.ProcessEnv; name?: string } = {},
): Promise<ControlPlaneHandle> {
  const spec = DRIVER_KINDS[kind];
  // 读不懂入参（未知 kind）⇒ 抛，⛔ 不返回一个与「合格」同形的句柄（硬规则 3b：不得让「无法评估」
  // 与「已评估且合格」共用一种输出）。
  if (!spec) throw new Error(`serveKindControlPlane: unknown driver kind "${kind}" (not in DRIVER_KINDS)`);
  const handle = await serveControlPlane({
    root,
    host: opts.host,
    // port 缺省 0 = 内核分配：六个 kind 各起一个控制面也不会互撞（⛔ 不写死端口——写死必然六 kind 互撞，
    // 且「恰好没撞」会依赖启动顺序这种宿主事实）。调用方经 handle.port 回读实际端口。
    port: opts.port ?? 0,
    env: opts.env,
    rel: path.posix.join(".quay", spec.controlFile),
    name: opts.name ?? `${spec.prefix}-control`,
  });
  return handle;
}

// ── Layer 0 · 事件循环层停机登记（SPEC §7 阶段 C：进程边界 → 事件循环边界）──────────────────────────
//
// WHY THIS EXISTS（GOAL-017/AC-255）：阶段 C 把六个 kind 的常驻循环收进【一个】anchor 进程后，
// `kill -TERM <pid>` 不再能只停一个 kind——那会停掉 anchor = 停掉全部六个。逐 kind 的停机必须变成
// **进程内的一个信号**，而不是 OS 信号。本登记表就是那个信号：驱动在进入常驻循环时
// `registerKindStop(kind, requestStop)`，anchor 用 `requestKindStop(kind)` 只停它请求的那一个。
//
// ⛔ 登记表是**进程内存态**（只有 anchor 与各 kind 同进程时才有效）。跨进程调用 `requestKindStop`
// 返回 false —— 如实报出「办不到」，⛔ 不静默 no-op（硬规则 3b）。

interface KindStopController {
  requested: boolean;
  signalers: Set<() => void>;
}
const KIND_STOP = new Map<DriverKind, KindStopController>();

export interface KindStopHandle {
  /** 本 kind 是否已被请求停机（常驻循环的条件用）。 */
  requested(): boolean;
  /** 请求本 kind 停机（登记表内部 + 单元测试用；生产路径用 requestKindStop）。 */
  stop(): void;
}

/** 登记一个 kind 的停机控制器（常驻循环进入时调用一次）。进程级 SIGINT/SIGTERM 仍然停该 kind
 *  （与旧 driver 进程 `process.on(SIGINT/SIGTERM)` 的语义一致——单进程直跑时它就是全部）。 */
export function registerKindStop(kind: DriverKind, onStop?: () => void): KindStopHandle {
  const ctl: KindStopController = { requested: false, signalers: new Set<() => void>() };
  if (onStop) ctl.signalers.add(onStop);
  KIND_STOP.set(kind, ctl);
  const stop = (): void => {
    if (ctl.requested) return;
    ctl.requested = true;
    for (const f of ctl.signalers) {
      try { f(); } catch { /* 停机回调抛错不阻碍其余 signaler */ }
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return { requested: () => ctl.requested, stop };
}

/** 请求【单个】kind 停机。返回 false = 本进程里没有该 kind 的常驻循环（⛔ 不是「停成功了」）。 */
export function requestKindStop(kind: DriverKind): boolean {
  const ctl = KIND_STOP.get(kind);
  if (!ctl) return false;
  ctl.requested = true;
  for (const f of ctl.signalers) {
    try { f(); } catch { /* 同上 */ }
  }
  return true;
}

/** 本进程是否已请求该 kind 停机（缺省 false = 没有该 kind 的循环）。 */
export function kindStopRequested(kind: DriverKind): boolean {
  return KIND_STOP.get(kind)?.requested ?? false;
}

// ── Layer 0 · anchor 载体路径（SPEC §7 阶段 C：一个 anchor 进程承载全部 kind 循环）───────────────
//
// ⛔ `.quay/anchor.pid` 刻意【不】叫 `*-driver.pid`：AC-255 的判据数的是「**承载 driver 循环**的
// 进程数」，它读 `.quay/*-driver.pid` / `.quay/*-driver-supervisor.pid` 的**去重 pid 集合**。anchor
// 把每个 kind 的 `.quay/<prefix>.pid` 写成自己的 pid ⇒ 六个文件、**一个**去重后的存活 pid——这正是
// 「一个进程承载六个 kind」这一事实的诚实表示，⛔ 不是把计数改小（进程数另有直接量：`ps`）。

export const ANCHOR_PID_REL = ".quay/anchor.pid";
export const ANCHOR_DESIRED_REL = ".quay/anchor-desired.json";
export const ANCHOR_STATE_REL = ".quay/anchor.json";
export const ANCHOR_LOG_REL = ".quay/anchor.log";
/** 「哪些 kind 是被**显式停掉**的」记录（GOAL-017/AC-255 能力半边；见 `readKindStops` 的头注释）。 */
export const ANCHOR_KIND_STOPS_REL = ".quay/anchor-kind-stops.json";

export function anchorPaths(root: string): {
  pidFile: string;
  desiredFile: string;
  stateFile: string;
  logFile: string;
  kindStopsFile: string;
} {
  return {
    pidFile: path.join(root, ANCHOR_PID_REL),
    desiredFile: path.join(root, ANCHOR_DESIRED_REL),
    stateFile: path.join(root, ANCHOR_STATE_REL),
    logFile: path.join(root, ANCHOR_LOG_REL),
    kindStopsFile: path.join(root, ANCHOR_KIND_STOPS_REL),
  };
}

/** 读 anchor pid（不存在/不可读/非正整数 ⇒ null）。 */
export function readAnchorPid(root: string): number | null {
  const raw = readPidFile(anchorPaths(root).pidFile);
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** `.quay/anchor.json` 的**带原因**读法（硬规则 3b）。⛔ 「文件不存在」与「文件在但读不懂」不得共用
 *  输出：前者只是「还没有写过回读面」，后者是**别人写坏了**（非原子写的 torn read / 人为损坏）。
 *  `readAnchorState` 为兼容把两者都映射成 null（对它的消费者而言那条回退是**有意**的，见 `anchorHosts`），
 *  但夹具与诊断面拿得到具名原因 —— 否则一次**正在发生的**损坏会被读成「一切正常，只是还早」。 */
export type AnchorStateRead =
  | { ok: true; pid: number | null; kinds: DriverKind[] }
  | { ok: false; reason: "missing" | "unreadable" | "malformed" };

export function readAnchorStateDetailed(root: string): AnchorStateRead {
  let raw: string;
  try {
    raw = fs.readFileSync(anchorPaths(root).stateFile, "utf8");
  } catch (e) {
    // ⛔ 只有 ENOENT 是「不存在」；其余（EACCES / EMFILE / …）是**读不成**，各自具名。
    return { ok: false, reason: (e as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable" };
  }
  try {
    const j = JSON.parse(raw) as { pid?: unknown; kinds?: unknown };
    if (!Array.isArray(j.kinds)) return { ok: false, reason: "malformed" };
    return {
      ok: true,
      pid: typeof j.pid === "number" && Number.isFinite(j.pid) ? j.pid : null,
      kinds: j.kinds.filter((k): k is DriverKind => KNOWN_KINDS.includes(k as DriverKind)),
    };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** 读 anchor 的**结构化回读面** `.quay/anchor.json`（`{pid, startedAt, kinds, host}`）。⇒
 *  **anchor 每个 reconcile pass 重写一次**（⛔ 不是「启动时写一次的静态声明」），故 `kinds` 是
 *  「**此刻实际在跑循环的 kind 集合**」的权威读数——⛔ 与 `readDesired`（期望态）不同：声明了却没能
 *  起来循环的 kind 不在 `kinds` 里。
 *  读不到 / 不可解析 / 无 `kinds` 数组 ⇒ null（三态；⛔ 与「一个 kind 都没托管」不同形——那是 `[]`）。
 *  ⚠️ 「读不到」在这里**同时覆盖**「不存在」与「读不懂」——那是**给本函数的消费者**的回退语义
 *  （`anchorHosts` 用它，而那条回退对两者本来就该走同一支）。要分得开请用 `readAnchorStateDetailed`。 */
export function readAnchorState(root: string): { pid: number | null; kinds: DriverKind[] } | null {
  const r = readAnchorStateDetailed(root);
  return r.ok ? { pid: r.pid, kinds: r.kinds } : null;
}

/** `.quay/anchor.json` 里 anchor 自报的**内核 bundle 同步读数**（每个 reconcile pass 重写）。
 *
 *  为什么它是一个**独立字段**而不是一行日志（硬规则 3b）：日志行只有人读得到，而「本内核比源树旧」
 *  在**任何结构化读数**里此前都与「一切正常」同形 —— 那正是它静默持续 2 天的形态。取值见
 *  `KernelBundleSyncState`（⛔ `not-evaluated` / `stale-no-action` 各自独立，⛔ 不与 `fresh` 同形）。 */
export interface AnchorBundleReading {
  state: KernelBundleSyncState;
  /** 本内核内核文件的绝对路径（读不出 ⇒ null）。 */
  kernel: string | null;
  /** 该文件的构建时刻（ISO；读不出 ⇒ null）。 */
  builtAt: string | null;
  /** 被比较的源树 scripts 目录（不是 mirror 形态 ⇒ null）。 */
  sourceDir: string | null;
  /** 源树被监视文件的最新 mtime（ISO；不是 mirror 形态 ⇒ null）。 */
  sourceMtime: string | null;
  /** 陈旧时，哪些 kind 参与了这个判定（KernelBundleSyncState 的 stale-* 三态才有意义）。 */
  kinds: DriverKind[];
  /** 最近一次机械重建的读数（没试过 ⇒ null）。 */
  rebuild: { attempted: boolean; ok: boolean; reason: string | null; command: string | null; at: string } | null;
  /** 本读数被写入的时刻（ISO）。 */
  at: string | null;
}

/** 读 anchor 自报的 bundle 同步读数（`.quay/anchor.json` 的 `bundle` 字段）。
 *  ⛔ 读不出 / 不是三态里的取值 ⇒ **null**（调用方 fail-closed；⛔ 不把「读不懂」当 `fresh`）。 */
export function readAnchorBundleReading(root: string): AnchorBundleReading | null {
  let raw: string;
  try {
    raw = fs.readFileSync(anchorPaths(root).stateFile, "utf8");
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw) as { bundle?: unknown };
    const b = j.bundle as AnchorBundleReading | undefined;
    if (!b || typeof b.state !== "string") return null;
    const known: readonly string[] = ["fresh", "stale-swappable", "stale-rebuilt", "stale-rebuild-failed", "stale-no-action", "not-evaluated"];
    if (!known.includes(b.state)) return null;
    return b;
  } catch {
    return null;
  }
}

/** 该 kind **自己的常驻循环**是否已就绪 —— 判据 = 逐 kind pid 载体 `.quay/<prefix>.pid` 写着一个
 *  **活着的**进程（`pidSelf` 类由驱动自己在进入循环体后写；`pidSelf=false` 的 worker 由宿主在起循环时写，
 *  见 `driverPidIsReadinessMarker`）。
 *
 *  ⛔ **只用于 `start` 的就绪确认**（`startKindViaAnchor`），与 `gap-driver-start-false-confirms-
 *  unsettled-driver` 的纪律一致：「anchor 收下了这个 kind」⛔ 不等于「它的循环真的跑起来了」——
 *  §6.1 的守卫实测过：一个每轮必抛的 kind 必须让 `start` **不报成功**。
 *
 *  ⛔ **不得用于状态判定**（`status`/`liveness`/`server status`）：收敛形态下这张文件**不可靠**——
 *  它是【循环的产物】而非【托管关系的产物】（写一次、循环收尾时被删、活着期间不重写），生产实测
 *  6 个 anchor 托管的 kind 里 5 个没有它（见 `anchorHosts` 的注释）。状态判定请用 `aliveness()`。 */
export function loopReadinessMarker(root: string, kind: DriverKind): boolean {
  const raw = readPidFile(statePaths(root, kind).driverPidFile);
  const pid = /^\d+$/.test(raw) ? Number(raw) : null;
  return pid !== null && pidAlive(pid);
}

/** 该 kind 是否由 anchor 承载：**anchor 进程活着 ∧ 它把本 kind 收在活跃循环集合里**。
 *  ⛔ 这是**三态**判定，不是「有没有 supervisor 文件」——anchor 承载（true）与「supervisor 模型」
 *  （false）必须不同形，否则 `aliveness().running` 会在收敛后恒 false（把「在跑」读成「死了」）。
 *
 *  ⛔ **判据不得是「该 kind 的 pid 载体文件恰好写着 anchor 的 pid」**
 *  （gap-driver-status-misreports-anchor-hosted-kind-as-down，2026-09-15 生产实测：6 个 anchor 托管的
 *  kind 里 5 个被读成 `host=supervisor, alive=0`，而同刻六个 round 载体都在**秒级**刷新）。
 *  那张文件是【循环的产物】，不是【托管关系的产物】：
 *    · 只在 kind 的常驻循环**进入循环体时写一次**（`pidSelf` 类由驱动自己写；`pidSelf=false` 的
 *      worker 由 anchor 写——见 driver-anchor 的写者分工注释），
 *    · 而会在**任何一次循环收尾时被删**（anchor 的 loop-cleanup / 退出清理、`stopKind*` 的清理），
 *      且**只要循环活着就没有任何东西会把它写回来**。
 *  ⇒ 任意时刻「哪些 kind 有这个文件」是一个**随循环代次漂移的任意子集**（生产实测 6 个里只有
 *    `promotion` 有；同一机制的两次独立采样给出 4/2 与 1/5 两种**不同**的分裂）。拿它当托管判据必然
 *    误报，且误报的**子集每次都不一样**——这正是「读不懂输入 ⇒ 报了一个假死亡」的硬规则 3b 镜像。
 *  （本轮**未**归因出生产实例里那 5 张文件是被哪一次生命周期事件删掉的：同一 shape 的夹具复跑会正常
 *    产出这 5 张文件 ⇒ 不把猜测写成结论。本判据的修法不依赖那个归因。）
 *  ⇒ 判据改为 anchor 自己的权威读数：**进程活着**（`pidAlive` 读 `/proc`，外部直接量）+ **回读面点名**
 *    （每 500ms 重写）。⛔ 回读面是 anchor 自报的，单独**不足以**制造「托管」——本函数要求 `anchor.pid`
 *    指向的进程真的活着，而 anchor 正常退出会同时删掉回读面与 pid 文件。
 *  ② 是兼容回退：回读面缺失 / 不可解析 / **换代**（其 `pid` 对不上 `anchor.pid`）时，退回「该 kind 的
 *    pid 载体写着 anchor 的 pid」这条旧判据——⛔ 读不懂回读面不得变成「报死亡」（硬规则 3b）。 */
export function anchorHosts(root: string, kind: DriverKind): { hosted: boolean; anchorPid: number | null } {
  const anchorPid = readAnchorPid(root);
  if (anchorPid === null || !pidAlive(anchorPid)) return { hosted: false, anchorPid: null };
  const st = readAnchorState(root);
  if (st !== null && st.pid === anchorPid && st.kinds.includes(kind)) return { hosted: true, anchorPid };
  const dpid = readPidFile(statePaths(root, kind).driverPidFile);
  const driverPid = /^\d+$/.test(dpid) ? Number(dpid) : null;
  return { hosted: driverPid === anchorPid, anchorPid };
}

/** 逐 kind 的启动参数（`quay driver start --kind X --cap n --interval ms` 的透传面）。 */
export interface AnchorDesiredEntry {
  cap?: string;
  interval?: string;
  reconcileInterval?: string;
  runId?: string;
}

/** anchor 的声明式期望态（`.quay/anchor-desired.json`）。锚是**文件**而不是进程内变量：
 *  `quay driver start` / `stop` 是两个短命进程，它们与常驻 anchor 之间只能经盘上载体通话。 */
export interface AnchorDesired {
  kinds: DriverKind[];
  opts?: Record<string, AnchorDesiredEntry>;
  updatedBy: string;
  updatedAt: string;
}

/** 读期望态。缺失/不可解析 ⇒ null（⛔ 与「空集合」不同形：null = 没人声明过，[] = 声明了一个都不要）。 */
export function readDesired(root: string): AnchorDesired | null {
  let raw: string;
  try {
    raw = fs.readFileSync(anchorPaths(root).desiredFile, "utf8");
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw) as { kinds?: unknown; opts?: unknown; updatedBy?: unknown; updatedAt?: unknown };
    const kinds = Array.isArray(j.kinds) ? j.kinds.filter((k): k is DriverKind => KNOWN_KINDS.includes(k as DriverKind)) : [];
    const opts: Record<string, AnchorDesiredEntry> = {};
    if (j.opts && typeof j.opts === "object") {
      for (const [k, v] of Object.entries(j.opts as Record<string, unknown>)) {
        if (!v || typeof v !== "object") continue;
        const o = v as Record<string, unknown>;
        const entry: AnchorDesiredEntry = {};
        for (const f of ["cap", "interval", "reconcileInterval", "runId"] as const) {
          if (o[f] != null) entry[f] = String(o[f]);
        }
        opts[k] = entry;
      }
    }
    return {
      kinds,
      opts,
      updatedBy: typeof j.updatedBy === "string" ? j.updatedBy : "unknown",
      updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : "",
    };
  } catch {
    return null;
  }
}

/** 写期望态（原子替换；调用方传**完整**集合——本函数不做并集，避免把读-改-写竞态藏起来）。 */
export function writeDesired(root: string, kinds: DriverKind[], updatedBy: string, opts?: Record<string, AnchorDesiredEntry>): void {
  const file = anchorPaths(root).desiredFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ kinds: [...new Set(kinds)], opts: opts ?? {}, updatedBy, updatedAt: ts() }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

/** 幂等加入 / 移除一个 kind（`quay driver start|stop --kind X` 的写侧）。返回改后的集合。 */
export function updateDesired(
  root: string,
  kind: DriverKind,
  present: boolean,
  updatedBy: string,
  entry?: AnchorDesiredEntry,
): DriverKind[] {
  const cur = readDesired(root);
  const curKinds = cur?.kinds ?? [];
  const curOpts = { ...(cur?.opts ?? {}) };
  const next = present ? [...new Set([...curKinds, kind])] : curKinds.filter((k) => k !== kind);
  if (present && entry) curOpts[kind] = { ...(curOpts[kind] ?? {}), ...entry };
  if (!present) delete curOpts[kind];
  writeDesired(root, next, updatedBy, curOpts);
  // 停机记录与期望态**同一次调用里**翻转（AC-255 能力半边）：加入 ⇒ 清记录，移出 ⇒ 落记录。
  // ⛔ 两处都写才使「操作员有意停机」与「静默丢失」在读数上分得开（见 `kindDeclaration`）。
  if (present) clearKindStop(root, kind);
  else recordKindStop(root, kind, updatedBy);
  return next;
}

// ── 停机记录 + 「未声明」独立取值（GOAL-017/AC-255 **能力半边**）──────────────────────────────────────
//
// 缺陷现场（2026-09-23 实测，`.quay/anchor.log` + `quality-round.jsonl`/`meta-driver-round.jsonl`）：
// anchor 跑哪些 kind **唯一**由 `.quay/anchor-desired.json` 决定，而该文件只有两个写侧 ——
// `updateDesired(present=true)` 并集加 / `updateDesired(present=false)` 过滤删。⇒ 一次 `stop --kind X`
// 就把 X 移出集合，而在**任何读数**里都没留下「这是显式停的」这一信息：`updatedBy` 会被下一次 `start`
// 覆盖。此后 anchor 照常以「一个健康进程」的样子跑剩余 kind，`ps` 完全看不出少了一个 —— 外部只看得见
// 「进程活着」，看不见「六个循环里有两个没在转」（SPEC §6.7 禁止的那种折叠）。
//
// 修法（硬规则 3b）：给「本 kind 既不在期望态里、**又**没有显式停机记录」一个**独立取值**，
// ⛔ 不与「正在跑」/「显式停过」共用输出。⛔ 这**不是**「一律自动拉满六个 kind」：reconcile 的**行为**
// 一行未动（它仍只起 `desired.kinds`），本条交付的只是**读数** —— 让「操作员有意停机」与「静默丢失」
// 在机器可读面上分得开（AC4 立、AC5 是它的反向控制，缺 AC5 则 AC4 退化成「永远拉满六个」）。

/** 一条显式停机的记录（谁、什么时候）。 */
export interface AnchorKindStopRecord {
  at: string;
  by: string;
}

/** `.quay/anchor-kind-stops.json` 的读出半边。三态（硬规则 3b）：
 *  · 文件**不存在** ⇒ `{}`（=「从未记录过任何显式停机」，一个合法且自明的状态，冷启动即此态）；
 *  · 文件存在且可解析 ⇒ 其中的记录；
 *  · 文件存在但**读不懂**（坏 JSON / 非对象）⇒ **null**（⛔ 不与「没有记录」同形：读不懂时无法区分
 *    「显式停过」与「静默丢失」，冒充任一取值都是撒谎）。 */
export function readKindStops(root: string): Record<string, AnchorKindStopRecord> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(anchorPaths(root).kindStopsFile, "utf8");
  } catch {
    return {};
  }
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const out: Record<string, AnchorKindStopRecord> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      out[k] = { at: typeof o.at === "string" ? o.at : "", by: typeof o.by === "string" ? o.by : "unknown" };
    }
    return out;
  } catch {
    return null;
  }
}

/** 写停机记录（原子替换）。 */
function writeKindStops(root: string, stops: Record<string, AnchorKindStopRecord>): void {
  const file = anchorPaths(root).kindStopsFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(stops, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

/** 落一条显式停机记录（`quay driver stop --kind X` 的写侧）。读不懂既有记录时 ⇒ **不覆盖**
 *  （覆盖会把别人写过的记录抹掉——那是新的静默丢失；如实留在原处，由 `readKindStops` 报 null）。 */
export function recordKindStop(root: string, kind: DriverKind, by: string): void {
  const cur = readKindStops(root);
  if (cur === null) return;
  writeKindStops(root, { ...cur, [kind]: { at: ts(), by } });
}

/** 清掉某 kind 的停机记录（`quay driver start --kind X` / 加入期望态时）。读不懂既有记录 ⇒ 不覆盖。 */
export function clearKindStop(root: string, kind: DriverKind): void {
  const cur = readKindStops(root);
  if (cur === null || !(kind in cur)) return;
  const next = { ...cur };
  delete next[kind];
  writeKindStops(root, next);
}

/** 一趟判定所用的**期望态 + 停机记录**快照（gap-anchor-state-nonatomic-and-declaration-outruns-log M1）。
 *
 *  为什么需要它：`kindDeclaration` 一族每次调用都**现读盘**。`driver-anchor` 的一趟 reconcile 里
 *  `wanted`（趟首快照）、`silent`（`undeclaredKinds`）、发布面（`kindDeclarationMap`）本是**三次独立
 *  读盘**——期望态恰好落在它们之间时（`writeDesired` 是 tmp+rename 原子写，故只会读到完整的新集合），
 *  这一趟就会**发布 `not-declared` 而 `silent` 为空 ⇒ 不打那行日志**，诊断行落到**下一趟**
 *  （≤1 个 reconcile 周期）。三处收敛到**同一份快照**之后，这个分叉在结构上不可能出现
 *  （⛔ 修法不是把夹具的断言放宽 —— 那是把测量换成回声）。
 *
 *  ⛔ 它**不**声称 `desired` 与 `stops` 两个文件之间是原子读：期望态与停机记录由 `updateDesired`
 *  在**同一次调用**里写两处，跨文件原子性是另一个问题，不在这里解决。它保证的只有一条：
 *  **同一趟内的判定用同一份快照**。 */
export interface DeclarationSnapshot {
  desired: AnchorDesired | null;
  stops: Record<string, AnchorKindStopRecord> | null;
}

/** 读一次盘，得到本趟判定用的快照。⛔ 调用方**一趟只调一次**，然后把**同一个对象**传给
 *  `undeclaredKinds` / `kindDeclarationMap` / `kindDeclaration`（三者都接受它）。不传 ⇒ 各自现读
 *  （等价于本函数出现之前的行为，供一次性/诊断调用方使用）。 */
export function readDeclarationSnapshot(root: string): DeclarationSnapshot {
  return { desired: readDesired(root), stops: readKindStops(root) };
}

/** 一个 kind 相对**期望态**的声明状态。四态各自独立（硬规则 3b：⛔ 没有「未评估」这一态的判定
 *  就无法区分「查过」与「没查成」）：
 *  · `declared`           ∈ `desired.kinds`（正在跑的那个集合）
 *  · `stopped-explicitly` ∉ 期望态 ∧ **有**显式停机记录（操作员有意停机 —— AC5）
 *  · `not-declared`       ∉ 期望态 ∧ **无**显式停机记录（静默脱离期望态 —— 本任务要报出的那一态，AC4）
 *  · `not-evaluated`      读不懂期望态**或**读不懂停机记录 ⇒ 不冒充上面任一取值
 *  `snap` = 本趟的读盘快照（见 `DeclarationSnapshot`）；不传 ⇒ 现读一次。 */
export type KindDeclaration = "declared" | "stopped-explicitly" | "not-declared" | "not-evaluated";

export const KIND_DECLARATIONS: readonly KindDeclaration[] = [
  "declared",
  "stopped-explicitly",
  "not-declared",
  "not-evaluated",
];

export function kindDeclaration(root: string, kind: DriverKind, snap?: DeclarationSnapshot): KindDeclaration {
  const s = snap ?? readDeclarationSnapshot(root);
  if (s.desired === null) return "not-evaluated";
  if (s.desired.kinds.includes(kind)) return "declared";
  if (s.stops === null) return "not-evaluated";
  return s.stops[kind] ? "stopped-explicitly" : "not-declared";
}

/** 六个 kind 各自相对期望态的声明读法（四态见 `KindDeclaration`）。消费面有两处：`driver-anchor`
 *  每趟把本函数的返回发布到盘上，`quay driver status` 逐 kind 报出它 —— ⛔ 两处都只是**发布**，
 *  判据的正本始终是本函数（不传 `snap` 时它每次现算，⛔ 不读任何派生的快照）。
 *  ⚠️ `driver-anchor` 一趟里**必须**传 `snap`（且与 `undeclaredKinds` 传**同一个**）：否则
 *  「发布面」与「日志行」又变成两次独立读盘 —— 那正是本函数接受 `snap` 要关掉的那个分叉。 */
export function kindDeclarationMap(root: string, snap?: DeclarationSnapshot): Record<DriverKind, KindDeclaration> {
  const s = snap ?? readDeclarationSnapshot(root);
  const out = {} as Record<DriverKind, KindDeclaration>;
  for (const kind of KNOWN_KINDS) out[kind] = kindDeclaration(root, kind, s);
  return out;
}

/** 静默脱离期望态的 kind（`not-declared`）。⛔ 只报这一态：`stopped-explicitly` 是**有意**的，
 *  把它混进来会让每一个被正常停掉的 kind 每轮都被"报红"（噪声会把信号淹没）。
 *  `snap` 见 `DeclarationSnapshot`（⛔ 与 `kindDeclarationMap` 用**同一个**对象才是同趟一致）。 */
export function undeclaredKinds(root: string, snap?: DeclarationSnapshot): DriverKind[] {
  const s = snap ?? readDeclarationSnapshot(root);
  return KNOWN_KINDS.filter((k) => kindDeclaration(root, k, s) === "not-declared");
}

/** 本内核【自身安装位置】在主检出里的对应目录 —— 仅当本内核跑在一个 **linked worktree** 里时才与自身
 *  目录不同（dev tree 的 worktree 场景：常驻 anchor ⛔ 不应把生存期绑在一个短命的 worktree 路径上 ——
 *  worktree 被回收后，任何一次 kind 重启都会 import 失败）。
 *
 *  ⚠️ 基准是**本内核自己的路径**（`kernelSelfPath()`），⛔ 不是 `--root`（工作区）：`--root` 在第三方项目里
 *  是**别人的项目**，其下没有 quay 的 `plugin/scripts/` —— 「把 quay 自己的资源拼在 workspace root 下」
 *  正是 AC-203 / gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root 的缺陷形（症状：
 *  第三方项目上解析到一个不存在的文件 ⇒ spawn 只得 ENOENT/非零退出，被例程读成「跑过了、没数据」）。
 *  `kernel-sibling-resolution-check` 的 DRIVER-SCOPE 规则对 driver-runtime.ts 上的这一形态 fail-closed，
 *  且 **不认** dev-tree-only 豁免（该标记的前提在这些文件上为假）。⛔ 不能靠「在 quay 自己的检出里跑
 *  测试」发现它：那里 `--root` 与「内核所在仓库」恰好重合 ⇒ 该缺陷形态**结构上无法自测**。
 *
 *  非 git / 主检出不可解析 / 本内核不在 worktree 里 / 主检出里没有对应目录 ⇒ 返回本内核自身的目录
 *  （⇒ 行为与「兄弟文件回退」逐字相同，⛔ 不引入新的失败面）。 */
function mainCheckoutKernelDir(): string {
  const here = path.dirname(kernelSelfPath());
  try {
    const selfRepo = repoRoot(here);
    const main = mainCheckoutRoot(here);
    if (!main || main === selfRepo || !fs.existsSync(main)) return here;
    const rel = path.relative(selfRepo, here);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return here;
    const candidate = path.join(main, rel);
    return fs.existsSync(candidate) ? candidate : here;
  } catch {
    return here;
  }
}

/** 解析 anchor 内核可执行文件的**优选**路径。
 *
 *  优先级（GOAL-017/AC-255）：① **主检出**的 `driver-anchor.{ts,js}` —— 收敛形态的**持久**落点（常驻
 *  anchor ⛔ 不应把生存期绑在一个短命的 worktree 路径上）；② 本内核的**兄弟文件**（`import.meta.url`
 *  同目录）。① 的基准见 `mainCheckoutKernelDir` —— **是本内核自己的仓库的主检出**，⛔ 不是 `--root`。
 *  两者都是「本内核自身安装位置」的派生量，故 ① 只在「本内核跑在 linked worktree 里」时生效；其余情况
 *  `mainCheckoutKernelDir()` 逐字返回自身目录 ⇒ ① 与 ② 指向同一个文件 ⇒ 直接走 ②（⛔ 不重复加载）。
 *
 *  ③ **本内核是构建产物时**（自己目录里没有 raw `driver-anchor.ts`）= 跑的是 dist bundle / pack-time
 *  暂存拷贝 ⇒ 优先它**源树**的**同名 dist bundle**（`<源树>/scripts/dist/driver-anchor.js`），且只在
 *  那份**比本内核更新**时才选它（`gap-ac259-frozen-reading-stale-staging-kernel`）。
 *  两条约束的理由：
 *   - **换版本只在同形态内发生（bundle → bundle）**：raw 会丢掉 bundle 形态的保证 —— shipped 布局下
 *     raw 的裸 npm import（yaml/zod/@modelcontextprotocol/sdk）解析不到（见 `isKernelSourceCheckout`
 *     的实测注释），而「让一个跑得好好的 bundle 内核悄悄变成 raw」不是自刷新该做的事。
 *   - **只换到更新的那一份**：替换目标不比本内核新时换过去还是同一版 ⇒ 每次 reconcile 都换 = 重启风暴。
 *     换不动的形态由 `driver-anchor.ts` **如实报出**（独立取值），⛔ 不静默、⛔ 不假装 fresh。
 *
 *  ⛔ **不走 `QUAY_PLUGIN_ROOT`**：那是「第三方项目/夹具的 plugin/ 在哪」的缝，用它会让每个夹具都必须
 *  复制一份完整内核闭包；而 anchor 要跑的是**内核自己的**代码（只有它托管的 kind 模块才可能来自
 *  QUAY_PLUGIN_ROOT——那正是 `invokeKindDefault` 用 resolveKernelSibling 的地方）。 */
export function preferredAnchorKernel(): { path: string; stripTypes: boolean } | null {
  const here = path.dirname(kernelSelfPath());
  return preferredAnchorKernelIn(here, mainCheckoutKernelDir(), kernelSourceScriptsDir());
}

/** `preferredAnchorKernel` 的**判定半边**（三个输入全部显式传入 ⇒ 可单测；⛔ 路径解析只留在上面那个
 *  包装里）。判定本身与「本内核装在哪」无关，只与这三个目录有关。 */
export function preferredAnchorKernelIn(
  here: string,
  mainDir: string,
  srcScripts: string | null,
): { path: string; stripTypes: boolean } | null {
  const selfTs = path.join(here, "driver-anchor.ts");
  const selfJs = path.join(here, "driver-anchor.js");
  if (mainDir !== here) {
    const mainTs = path.join(mainDir, "driver-anchor.ts");
    const mainJs = path.join(mainDir, "driver-anchor.js");
    if (fs.existsSync(mainTs)) return { path: mainTs, stripTypes: true };
    if (fs.existsSync(mainJs)) return { path: mainJs, stripTypes: false };
  }
  if (fs.existsSync(selfTs)) return { path: selfTs, stripTypes: true };
  // ③ 构建产物内核 → 源树里**更新**的那份 bundle（见上）。
  if (!fs.existsSync(selfTs) && srcScripts) {
    const srcDistJs = path.join(srcScripts, "dist", "driver-anchor.js");
    try {
      if (fs.existsSync(srcDistJs) && path.resolve(srcDistJs) !== path.resolve(selfJs)) {
        const srcMtime = fs.statSync(srcDistJs).mtimeMs;
        const selfMtime = fs.existsSync(selfJs) ? fs.statSync(selfJs).mtimeMs : 0;
        if (srcMtime > selfMtime) return { path: srcDistJs, stripTypes: false };
      }
    } catch { /* 读不到 mtime ⇒ 不换（⛔ 不把「读不懂」当「更新」） */ }
  }
  if (fs.existsSync(selfJs)) return { path: selfJs, stripTypes: false };
  return null;
}

// ── Layer 0 · 内核 bundle 陈旧的动作面（gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation）──
//
// 缺陷（2026-09-17 实测，AC-214 第六次转红的成因，全部直接读数）：
//   `driver-anchor.ts` 的 `bundleStale` 支**会检测**「本内核 bundle 比它的源树旧」，并把
//   `rebuild the bundle to clear this` 写进 `.quay/anchor.log`（≥3 条带时刻的行，最新 2026-09-17T04:03:49Z）。
//   而**全仓没有任何机件执行那个动词** ⇒ 该条件静默持续 2 天：第五次转红落地的修复（立案步
//   `fileRoutineTask`，提交 4c7e5c23）落在**源**里、跑的却是早它 22 分钟的**产物**
//   （`dist/probe-routine.js` 有 `scan-round`、没有 `filing-round`）⇒ 生产载体
//   `.quay/routine-findings.jsonl` 里 `kind:"filing-round"` 的记录数 = **0**，AC-238/239 的 act-now
//   finding 三次落进载体、三次没有对应任务。
//   ⇒ 与硬规则 3b 同形：**一个「检测到了」的条件，若没有会动作的消费者，就与「一切正常」同形**。
//   ⇒ 与硬规则 4 推论三同形：实现了、测试绿了，而**生产没跑过**。
//
// 本段交付的是那个**动作面**（两件事，缺一不可）：
//   ① `resolveQuayKernelBuildScript()` —— 找到把本内核的**源树**编译成 dist bundle 的那个构建脚本
//      （**单一入口**：布局知识只住在这里，⛔ 调用方不各自拼 `packages/quay/scripts/…`）。
//   ② `rebuildKernelBundle()` —— 机械重建，且**只写产物**（`<pluginRoot>/scripts/dist/`），
//      ⛔ 不碰任何被 git 跟踪的源文件、⛔ 不碰 `--root` 工作区。
//
// ⛔ 重建**不是**「换得动」的替代品：重建后本进程内存里仍是旧代码（Node 的 ESM 缓存按 URL，
//   见 driver-anchor.ts 头注释），所以调用方**必须**再走一次整进程重启才能让新产物真的执行
//   ——「重建 + 重启」是**一个**动作的两个半边，⛔ 只做前一半等于把日志里的建议照抄一遍。

/** 把一个 `KernelBundleRebuildResult` 的**取值**（硬规则 3b：⛔ 不同形态不共用取值）。 */
export type KernelBundleSyncState =
  /** 本内核不比源树旧（或压根没有源可推进）—— 无需动作。 */
  | "fresh"
  /** 陈旧，且本内核之外**存在**一份更新的内核 ⇒ 走既有的整进程自刷新（⛔ 不重建）。 */
  | "stale-swappable"
  /** 陈旧且换不动 ⇒ 机械重建**成功**（下一步是整进程重启把它加载进来）。 */
  | "stale-rebuilt"
  /** 陈旧且换不动 ⇒ 重建**尝试过但失败**（如实留痕，⛔ ⛔ 不静默降级成 fresh）。 */
  | "stale-rebuild-failed"
  /** 陈旧且换不动 ⇒ **没有可用动作**（找不到构建脚本 / 被 kill switch 关掉）。⛔ 三态之一，不与 fresh 同形。 */
  | "stale-no-action"
  /** 读不出内核/源树读数 —— ⛔ 与 fresh 不同形（硬规则 3b）。 */
  | "not-evaluated";

/** 一次机械重建的读数（⛔ 不只是布尔：失败原因与命令都要可核）。 */
export interface KernelBundleRebuildResult {
  /** 是否真的调用了构建脚本。 */
  attempted: boolean;
  /** 构建脚本退出码为 0。 */
  ok: boolean;
  /** `attempted=false` 时说明为什么没做 / `ok=false` 时说明失败原因；`ok=true` ⇒ null。 */
  reason: string | null;
  /** 实际运行的完整 argv（可复跑；`attempted=false` ⇒ null）。 */
  command: string | null;
  durationMs: number;
  /** 构建脚本 stdout+stderr 的**尾部**（⛔ 不吞掉，失败时可诊断）。 */
  outputTail: string;
}

/** 本内核的**源树**被编译成 dist bundle 时用的那个构建脚本的绝对路径。
 *
 *  本内核不是跑在构建产物形态上 / 找不到源树 / 找不到构建脚本 ⇒ **null**（调用方 fail-closed，
 *  ⛔ 不把「读不懂」当「换得动」）。
 *
 *  ⛔ **单一入口**：`packages/quay/scripts/…` 这一布局段只在本函数体内出现
 *  （kernel-sibling-resolution-check 的 DRIVER-SCOPE 规则；该规则把本函数与
 *  `resolveQuayCodeRoot` / `resolveQuaySrcModule` / `quaySrcModuleLegacyShape` 并列为合法落点）。
 *  ⛔ 先要求 `kernelSourceScriptsDir()` 非空：没有源树 = 装好的产物（npm-pack / marketplace cache /
 *  第三方 vendored），那里**没有**可重建的源，重建它们只会把静态产物写成半成品。 */
export function resolveQuayKernelBuildScript(): string | null {
  if (!kernelSourceScriptsDir()) return null;
  const codeRoot = resolveQuayCodeRoot();
  if (!codeRoot) return null;
  const script = path.join(codeRoot, "packages", "quay", "scripts", "build-plugin-dist.mjs");
  return fs.existsSync(script) ? script : null;
}

/** 机械重建本内核的 bundle（**唯一**动作面：跑源树自己的构建脚本，只写产物目录）。
 *
 *  退出条件全部**取值可区分**（硬规则 3b）：`attempted=false`（没动作可用 / 被关掉）与
 *  `attempted=true, ok=false`（动作做了但失败）与 `ok=true` 是三态，⛔ 不共用一个「没成功」。
 *
 *  kill switch：`QUAY_ANCHOR_NO_BUNDLE_REBUILD=1` ⇒ 直接 `attempted=false`（机器上不想让常驻进程
 *  evoking esbuild 时用；⛔ 关掉它**不**等于「不陈旧」——调用方仍须报出陈旧，只是取值变成
 *  `stale-no-action`）。 */
export function rebuildKernelBundle(opts: { timeoutMs?: number; scriptPath?: string | null } = {}): KernelBundleRebuildResult {
  const t0 = Date.now();
  const deny = (reason: string): KernelBundleRebuildResult =>
    ({ attempted: false, ok: false, reason, command: null, durationMs: Date.now() - t0, outputTail: "" });
  if (process.env.QUAY_ANCHOR_NO_BUNDLE_REBUILD === "1") {
    return deny("disabled by QUAY_ANCHOR_NO_BUNDLE_REBUILD=1");
  }
  const script = opts.scriptPath === undefined ? resolveQuayKernelBuildScript() : opts.scriptPath;
  if (!script) return deny("no plugin-dist build script resolvable from this kernel's source tree");
  const srcScripts = kernelSourceScriptsDir();
  if (!srcScripts) return deny("no source tree for this kernel (installed artifact — nothing to rebuild)");
  const pluginRoot = path.dirname(srcScripts);
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? 600_000);
  const argv = [process.execPath, script, pluginRoot];
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      timeout: timeoutMs,
      // cwd = 源树的**仓库根**（构建脚本按相对路径找 packages/quay/… 的兄弟；⛔ 不是 --root 工作区）。
      cwd: path.dirname(pluginRoot),
      env: { ...process.env },
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    return { attempted: true, ok: false, reason: `spawn threw: ${e instanceof Error ? e.message : String(e)}`, command: argv.join(" "), durationMs: Date.now() - t0, outputTail: "" };
  }
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const tail = out.length > 4000 ? out.slice(-4000) : out;
  if (r.error) {
    return { attempted: true, ok: false, reason: `spawn error: ${r.error.message}`, command: argv.join(" "), durationMs: Date.now() - t0, outputTail: tail };
  }
  if (r.status !== 0) {
    return { attempted: true, ok: false, reason: `build script exited ${r.status}`, command: argv.join(" "), durationMs: Date.now() - t0, outputTail: tail };
  }
  return { attempted: true, ok: true, reason: null, command: argv.join(" "), durationMs: Date.now() - t0, outputTail: tail };
}

// ── gap-driver-anchor-runs-without-host-derived-memory-envelope ──────────────────────────────────────
// 现场（2026-09-25，一次真事故）：`quay-drivers-claudecodeui-*.scope` 里的 driver 群与其全部 worker
// 在 10:15–10:37 被内核 OOM killer 击杀 36 次，load 冲到 4309。那个 scope **不是 quay 创建的**：有人
// 用 `systemd-run --user --scope -p OOMPolicy=continue` 手工包了一层 `start-drivers`，**没有 MemoryMax**、
// 也没开内存记账 ⇒ 事后连峰值读数都没有。根因不是「运维不会用 systemd-run」，而是**机制缺口**：
// `spawnAnchor` 直接 `spawn(node, [driver-anchor …], {detached:true})`，六个 kind 的常驻循环与
// worker-driver 派出的**全部** worker 都继承调用者所在的 cgroup；`systemd-run --scope` 此前只出现在
// `full-suite-runner.ts`（全量套件有包络、driver 群没有）⇒ 想要包络的人只能自己手搓一个（且搓得不带上限）。
//
// 本条把包络放在 anchor 的**唯一起点**：spawnAnchor（`startKindViaAnchor` 与自刷新/接管两条路都经它）。
// 实测（2026-09-25）`systemd-run --scope` 会**原地 exec**——被 spawn 的 pid 与内层 `$$` 相同
// （210035 == 210035）⇒ `.quay/anchor.pid` / `*-driver.pid` 的语义（pid 是 anchor 自己写的）一行未变，
// 而 anchor 的全部子进程（含每个 worker）都在该 scope 内。
//
// ⛔ 为什么 MemoryMax 必须**宿主推导**而不是写死一个 `16G` 类字面量（CLAUDE.md 硬规则 4 推论二）：
//   写死的上限在写它的那台机器上「等价于无限制」，换台机器就变成**真**限制且静默。默认取宿主总内存的
//   一个比例（下面的 ANCHOR_ENVELOPE_HOST_FRACTION），可用 QUAY_DRIVER_SYSTEMD_RUN_LIMITS 覆盖。
//   ⚠️ 该比例**是未经测量的起始值**，不是目标：本机 246G ⇒ ≈61G，而同机全量套件无上限时实测峰值
//   8–10.5G。本任务同时落 `MemoryPeak` 读数（见 SKILL），之后**按实测调**，⛔ 不是凭空定阈值。
//
// ⛔ 复用的是 `full-suite-runner.ts` 的**思路与 seam 名**，不是它的模块：`full-suite-runner.ts` 反过来
//   `import { resolveKernelSibling, resolveKernelPluginRoot } from "./driver-runtime.ts"`（:140），
//   `driver-runtime → full-suite-runner` 会成**新的 import 环**（`valueSccs` 基线不许涨）。故此处自带
//   最小一份，功能对应关系写在这里，⛔ 不 import：
//     · `parseSystemdRunLimits`  ↦ `parseAnchorMemoryMaxOverride`（只取 MemoryMax 一键；语义差别见其注释）
//     · `systemdRunAvailable`    ↦ `anchorSystemdRunAvailable`（同一 QUAY_TEST_SYSTEMD_RUN_AVAILABLE seam）
//     · `buildSystemdRunArgv`    ↦ `anchorLaunchArgv`（同一 --user --scope 形状；本处多 --collect/--unit）
//   ⛔ 三条各自的**消费者不同**（套件 vs anchor 组），合并到共享模块要动第三份文件，收益只是省几十行。

/** 包络里的上限来源：宿主推导 / env 覆盖 / env 明确不设上限 / 读不到（⛔ 四态各自独立，不与「没包络」同形）。 */
export type AnchorEnvelopeSource = ScopeEnvelopeSource;

/** anchor 组的内存包络读数（纯函数判定 + 内核直接量两条路**共用同一形状**）。
 *
 *  ⛔ `envelope` 的取值**不包含**「缺字段/未评估」以外的东西：`"none"` 是**如实报出无包络**的独立取值
 *  （硬规则 3b —— ⛔ 不把「无包络」伪装成「有包络」，也 ⛔ 不把它伪装成「检查失败」）；区分「没查成」
 *  与「查了、就是没有」的是 `reason` 的具名取值，⛔ 不是让两者共用 `"none"` 而不给原因。 */
export interface AnchorEnvelope {
  /** "scope" = 本进程（或本次启动将）在一个 quay-anchor-*.scope 内；"none" = 无包络（回退当前行为）。 */
  envelope: "scope" | "none";
  /** cgroup 末段单元名（直接量，取自 /proc/self/cgroup）。读不到/不在 scope 内 ⇒ null。 */
  unit: string | null;
  /** 内核**实际生效**的 memory.max（直接量，读 cgroup 的 memory.max 文件；"max" = 内核语的无上限）。
   *  ⛔ 不是回显我们传给 systemd-run 的参数（硬规则 4b：回显是自证，不是测量）。 */
  memoryMax: string | null;
  /** 上限**由谁决定**（启动者声明，经 QUAY_ANCHOR_ENVELOPE_SOURCE 传给 anchor；内核读不到这件事）。 */
  source: AnchorEnvelopeSource;
  /** envelope==="none" 时的**具名**原因（⛔ 不给原因 = 与「没查」同形）。 */
  reason: string | null;
}

/** anchor scope 的单元名前缀。读侧靠它把「我们给的包络」与**环境自带的 scope**（GUI 会话的
 *  `session-N.scope` 等）分开：后者也以 `.scope` 结尾，但**不是**本机制给的包络。 */
export const ANCHOR_UNIT_PREFIX = "quay-anchor-";
/** 默认上限 = 宿主总内存 × 本比例。⚠️ **未经测量的起始值**（见上面长注释）——用 MemoryPeak 实测后调。
 *  比例的唯一实现落在 Core `systemd-scope.ts`（serve 宿主共用同一个）；此处只是历来的导出名。 */
export const ANCHOR_ENVELOPE_HOST_FRACTION = SCOPE_ENVELOPE_HOST_FRACTION;
/** 覆盖上限的环境变量（语法同 full-suite-runner 的 QUAY_TEST_SYSTEMD_RUN_LIMITS；**显式空串 = 不设上限**）。 */
export const ANCHOR_LIMITS_ENV = "QUAY_DRIVER_SYSTEMD_RUN_LIMITS";
/** 启动者把「上限由谁决定」传给 anchor 的 seam（内核读不到这件事，只能由启动者声明）。 */
export const ANCHOR_ENVELOPE_SOURCE_ENV = "QUAY_ANCHOR_ENVELOPE_SOURCE";
/** 默认上限（宿主推导）：`floor(totalmem × 比例)` 向下对齐页边界，至少一页。
 *  ⛔ 纯函数（入参是字节数，不是 os.totalmem()）⇒ 两个注入宿主必得两个不同的值（AC1）。
 *  实现落在 Core `systemd-scope.ts`（`defaultScopeMemoryMax`）——本函数只是历来的导出名。 */
export function defaultAnchorMemoryMax(totalmemBytes: number): string {
  return defaultScopeMemoryMax(totalmemBytes, ANCHOR_ENVELOPE_HOST_FRACTION);
}

/** 从覆盖串里取 MemoryMax 一键。三态（⛔ 各自独立，不与「没给这个键」共用一个取值）：
 *   - `"absent"`    —— 串里没有 MemoryMax ⇒ **宿主推导**的默认值生效（与 parseSystemdRunLimits 的
 *                      「缺键回落默认值」同形，只是本处的默认值是宿主推导而非字面量）；串为 `undefined`
 *                      （env 根本未设）也走这一支。
 *   - `"value"`     —— `MemoryMax=<v>`（v 非空）⇒ 用 `<v>`。
 *   - `"unlimited"` —— 串**显式为空/全空白**（明确「一组属性都不设」）或 `MemoryMax=`（值为空）
 *                      ⇒ 不传 `-p MemoryMax=`（机制上不设该限制，⛔ 不写一个"等价无限制"的字面值）。 */
export function parseAnchorMemoryMaxOverride(raw: string | undefined): { kind: "absent" | "value" | "unlimited"; value: string | null } {
  // 三态解析的唯一实现在 Core `systemd-scope.ts`（serve 宿主共用同一套语义）；此处只是历来的导出名。
  return parseMemoryMaxOverride(raw);
}

/** anchor 的 scope 单元名（`quay-anchor-<root 基名>-<ts>.scope`）：可读、可按前缀 grep、可按 root 分辨。
 *  sanitize 到 systemd 允许的字符集；⛔ 不依赖它全局唯一（同名已存在的单元 systemd-run 会拒绝起新的）。
 *  实现落在 Core `systemd-scope.ts`（`scopeUnitName`）——本函数只是历来的导出名 + anchor 的前缀。 */
export function anchorUnitName(root: string, nowMs: number): string {
  return scopeUnitName(ANCHOR_UNIT_PREFIX, root, nowMs);
}

/** `systemd-run --user --scope` 在本机是否可用（记忆化）。与 full-suite-runner.systemdRunAvailable 的
 *  **同一判据、同一 seam**：起一个真瞬态 scope（`true`）——二进制在不在**不构成**判据，必须有一个活的
 *  user manager（user session / D-Bus）接受 `--scope` + 属性。`QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0|1` 强制。
 *  实现落在 Core `systemd-scope.ts`（`systemdScopeAvailable`），serve 宿主共用**同一份探测与同一 memo**。 */
export function anchorSystemdRunAvailable(): boolean {
  return systemdScopeAvailable();
}

/** anchor 包络的完整读数：Core 的四态包络 **+ 共享宿主那一步自己的出处**（硬规则 3b——收紧是**谁**
 *  按**什么计数**做的，必须与「就是没查」区分得开）。 */
export interface ResolvedAnchorEnvelope extends ResolvedScopeEnvelope {
  /** 收紧时用到的同类 scope 数；`null` = **未评估**（⇒ ceiling 逐字节等于项目盲的旧值）。 */
  siblingScopeCount: number | null;
  /** `siblingScopeCount === null` 时的具名原因（子树残缺时也在此说明）；否则 null。 */
  siblingScopeReason: string | null;
}

/** 算出 anchor 启动方式：包不包、包住时的上限是多少。**纯函数**（宿主总内存 / env / 探测全可注入）
 *  ⇒ 两个注入宿主必得两个不同的 MemoryMax（AC1），且 systemd 不可用时有独立取值 `"none"`（⛔ 不是缺字段）。
 *  实现落在 Core `systemd-scope.ts`（`resolveScopeEnvelope`）——本函数只是 anchor 的前缀/env 绑定。
 *
 *  自 `gap-independent-anchor-memory-envelope-oversubscribes-shared-host` 起，宿主推导的**比例**不再是
 *  固定的 0.25：本函数先只读枚举宿主上活着的同类 scope（`listSharedHostScopes`），把它交给
 *  `sharedHostCeilingBytes` 得出**字节** ceiling 再注入（见那段长注释里的公式与两个校准依据）。
 *  ⛔ `N = 0`（含 N ≤ 3）时结果**逐字节**等于改动前的 `defaultAnchorMemoryMax(totalmem)`。 */
export function resolveAnchorEnvelope(opts: {
  root: string;
  /** 测试缝：宿主总内存（字节）。缺省 = `os.totalmem()`。 */
  totalmemBytes?: number;
  /** 测试缝：覆盖串。缺省 = 读 `process.env.QUAY_DRIVER_SYSTEMD_RUN_LIMITS`。传 `undefined` = 「env 未设」。 */
  limitsRaw?: string;
  /** 测试缝：systemd-run 可用性。缺省 = `anchorSystemdRunAvailable()`。 */
  systemdRun?: boolean;
  /** 测试缝：单元名里的时间戳。缺省 = `Date.now()`。 */
  nowMs?: number;
  /** 测试缝：宿主上**其它**同类 scope 的存活数（`null` = 已知未评估 ⇒ fail-open 回旧值）。
   *  缺省 = 真去读（`listSharedHostScopes().count`）——与 `systemdRun` 同一约定：**能注入，默认探测**。 */
  siblingScopeCount?: number | null;
}): ResolvedAnchorEnvelope {
  const totalmemBytes = opts.totalmemBytes ?? os.totalmem();
  // 读数与计数一起取出：计数进了 ceiling，`reason` 进了返回值的出处（⛔ 不把「没数成」静默成「就我一个」）。
  const reading = opts.siblingScopeCount === undefined ? listSharedHostScopes() : null;
  const siblingScopeCount = reading === null ? (opts.siblingScopeCount as number | null) : reading.count;
  const siblingScopeReason = reading === null ? null : reading.reason;
  const ceilingBytes = sharedHostCeilingBytes(totalmemBytes, siblingScopeCount);
  return {
    ...resolveScopeEnvelope({
      prefix: ANCHOR_UNIT_PREFIX,
      root: opts.root,
      limitsEnv: ANCHOR_LIMITS_ENV,
      systemdRun: opts.systemdRun,
      // ⛔ 不是把 `ceiling/totalmem` 当比例注入：非可表示的商会让 `floor(totalmem × 比例)` 差 1 字节，
      // 再被页对齐放大成一页。把**已经页对齐的字节数**当 totalmem、比例取 1 注入 ⇒
      // `defaultScopeMemoryMax(ceiling, 1) = pageAlign(floor(ceiling)) = ceiling`，**逐字节相等**。
      // 这条同时是 N=0 的回归保证：那时 `ceiling === defaultAnchorMemoryMax(totalmem)`，回程恒等。
      totalmemBytes: ceilingBytes,
      totalmemFraction: 1,
      limitsRaw: opts.limitsRaw,
      nowMs: opts.nowMs,
    }),
    siblingScopeCount,
    siblingScopeReason,
  };
}

/** 把内层 argv 包进 `systemd-run --user --scope`（envelope==="none" ⇒ **原样返回**内层 argv = 回退当前行为）。
 *  `--scope` 下 systemd-run 会**原地 exec** ⇒ 内层 argv 是**尾段**、pid 与 `.quay/anchor.pid` 的语义不变
 *  （AC5 的结构性理由：⛔ 不经 shell、⛔ 不 fork 一个中间进程）。`--collect` = 单元退出后自动回收
 *  （含失败），避免瞬态 scope 在 user manager 里堆积；`OOMPolicy=continue` = 组内某个进程被 OOM 杀
 *  **不**拖垮整个 anchor（正是事故里那个手工 scope 唯一的正确之处）。
 *  argv 构造的唯一实现在 Core `systemd-scope.ts`（`scopeLaunchArgv`），serve 宿主共用同一份。 */
export function anchorLaunchArgv(innerArgv: string[], res: { envelope: "scope" | "none"; memoryMax: string | null; unit: string | null }): string[] {
  return scopeLaunchArgv(innerArgv, res);
}

/** anchor 侧读**内核实际生效**的包络（直接量）：`/proc/self/cgroup` 取单元名、该 cgroup 的 `memory.max`
 *  取上限。⚠️ 与 `resolveAnchorEnvelope` 的入参不同：那条算「我们要传什么」，本条读「内核真给了什么」——
 *  ⛔ 不回声自己传的参数（硬规则 4b），故两者**可以在诊断上不一致**，而那种不一致正是要能被看见的东西。
 *
 *  四态（`envelope` × `reason`）：`"scope"`（在 `quay-anchor-*.scope` 内，带 memory.max 直接量）/
 *  `"none"` + 具名原因（① 不是 cgroup v2 ② cgroup 读不到 ③ 不在 `.scope` 内 ④ 在别的 scope 内，如
 *  环境自带的 `session-N.scope`）。⛔ 四种原因各自具名，全部与「有包络」不同形。 */
export function readAnchorEnvelope(env: Record<string, string | undefined> = process.env): AnchorEnvelope {
  const source = (env[ANCHOR_ENVELOPE_SOURCE_ENV] ?? null) as AnchorEnvelopeSource;
  let cgroup = "";
  try {
    cgroup = fs.readFileSync("/proc/self/cgroup", "utf8");
  } catch (e) {
    return { envelope: "none", unit: null, memoryMax: null, source: null, reason: `cannot read /proc/self/cgroup (${e instanceof Error ? e.message : String(e)}) — cgroup membership unknown, not evaluated` };
  }
  // cgroup v2 的 unified 行是 `0::<path>`；v1 主机没有这一行（⇒ 具名说「不是 v2」，⛔ 不说「无上限」）。
  const m = cgroup.match(/(?:^|\n)0::(\/\S*)/);
  if (!m) {
    return { envelope: "none", unit: null, memoryMax: null, source: null, reason: "not a cgroup-v2 host (no 0:: line in /proc/self/cgroup) — envelope not evaluated" };
  }
  const cgPath = m[1];
  const unit = cgPath.split("/").filter(Boolean).pop() ?? null;
  if (unit === null || !unit.endsWith(".scope")) {
    return { envelope: "none", unit, memoryMax: null, source: null, reason: `not inside a transient scope (cgroup=${cgPath})` };
  }
  if (!unit.startsWith(ANCHOR_UNIT_PREFIX)) {
    return { envelope: "none", unit, memoryMax: null, source: null, reason: `inside an ambient scope, not this mechanism's envelope (unit=${unit}; expected prefix ${ANCHOR_UNIT_PREFIX})` };
  }
  let memoryMax: string;
  try {
    memoryMax = fs.readFileSync(`/sys/fs/cgroup${cgPath}/memory.max`, "utf8").trim();
  } catch (e) {
    return { envelope: "none", unit, memoryMax: null, source: null, reason: `cannot read the scope's memory.max (${e instanceof Error ? e.message : String(e)}) — limit not evaluated` };
  }
  return { envelope: "scope", unit, memoryMax, source, reason: null };
}

// ── gap-independent-anchor-memory-envelope-oversubscribes-shared-host ────────────────────────────
// 宿主推导的包络公式 `floor(host_totalmem × 0.25)`（`SCOPE_ENVELOPE_HOST_FRACTION`）里有一个**未声明
// 的前提**：「这台宿主机上只有我这一个项目在做同样的事」。共享宿主上每个同类 scope 各自独立套用同一条
// 公式 ⇒ **无人协调**，N 个 scope 的 ceiling 之和 = N × 0.25 × host。
//
// ── 实测（2026-10-10，本机，`free -b` + 逐 scope `cat /sys/fs/cgroup/.../memory.max`）──────────
// 宿主总内存 265 182 715 904 B（247.0 GiB）。枚举宿主上全部 `quay-anchor-*` / `quay-serve-*`
// scope（**跨用户**：本机同时有 yale/kai/vince/zhengji 四个 uid 在跑 quay，`/sys/fs/cgroup/user.slice/
// user-<uid>.slice/user@<uid>.service/app.slice/` 全部可读）得 12 个，每个 ceiling 都是 66 295 676 928 B
// （= 0.25 × host）⇒ **求和 795 548 123 136 B = 2.75 × 宿主总内存**。其中至少 2 个根本不是真项目：
// `quay-anchor-anchor-boundary-IfIFT6-*` / `quay-anchor-anchor-partial-FutWOQ-*` 的 cmdline 是
// `driver-anchor.ts __anchor --root /tmp/anchor-boundary-IfIFT6`——测试的 tmp workspace 遗留（见本任务 AC1）。
//
// ⛔ 今天没有 OOM：ceiling **不是预留**，各 scope 的 `memory.current` 都远低于它（cantus 3.9 GB /
// claudecodeui 4.5 GB）。被破坏的是这个机制**唯一的承诺**——「某个项目用超了，只会死在它自己的
// cgroup 里」：host 上真能分配的物理内存是 247 GiB，不是 795 GiB；多个 anchor 同时逼近各自 ceiling 时
// 先触发的会是**宿主级不可控 OOM killer**（可误杀任意项目的任意进程），而不是某个 cgroup 内受控的
// `memory.max` oom_kill。**这是稳态结构问题，不是时序竞态**——不需要「同时起跑」，常驻 anchor 只要都
// 长期挂着就够了（与 `gap-cross-project-resource-gate-no-declarative-quota-or-shared-slot` 的瞬时
// 竞态是两回事，那条按硬规则 12 不立案是因为无发生率，本条的发生率就是上面这组读数本身）。
//
// ── 修法：只读感知，⛔ 不引入任何跨进程锁 / 预留 / 互斥 / 共享配置文件（DIR-132 的方向）──────
// 计算自己的分数**之前**，先枚举宿主上还活着多少个同类 scope（`listSharedHostScopes`），据此把自己的
// 固定 0.25 收紧。没有协议、没有配置、没有协调——纯读 `/sys/fs/cgroup`。
//
// ── 公式（`sharedHostCeilingBytes`）与它的两个校准依据 ─────────────────────────────────────────
//     ceiling(N) = pageAlign( min( 0.25 × host , max( host / (N+1) , FLOOR ) ) )
//   · `host / (N+1)` —— **系数 k = 1**：N+1 个活着的同类 scope 把宿主总内存**平摊一次**，而不是各拿
//     0.25。k=1 的**临界点恰好落在旧公式开始超配的地方**：旧式 (N+1) × 0.25 ≤ 1 ⟺ N ≤ 3，即
//     N ≤ 3 时旧公式本来就没超配（无需收紧），N ≥ 4 时旧式必然超过宿主（5 × 0.25 = 1.25 × host）。
//     ⛔ 这就是为什么 **N=0（乃至 N≤3）时公式逐字节退化为原来的固定 0.25**——不是特例，是临界点。
//   · `FLOOR = 2 × 已观测到的真实长期峰值` —— 裸除法会**过度收紧**。实测（ClaudeCodeUI 侧，2026-10-10）：
//     `quay-anchor-cantus-*` 存活 6 天的 peak = 13.0 GiB、`quay-anchor-claudecodeui-*` 35 分钟的
//     peak = 12.2 GiB——相对 61.74 GiB 的 ceiling 有约 4.75× headroom。**12 个 scope 时裸除法给出
//     61.74/12 ≈ 5.1 GiB**，已低于已观测的真实需求 ⇒ 会杀掉健康的 anchor。故取 **2 倍**最大实测峰值
//     作为下界：**26.0 GiB**。⛔ 这是**绝对值**不是宿主比例：0.25 那条公式本身是宿主推导的，而这个下界
//     表达的是「一个真实 anchor 绝对需要多少」——写成比例会在小宿主上按比例缩到真实需求以下（本机
//     0.105 × host）；写成字节数在小宿主上被 `min(0.25 × host, …)` 挡回去，只收紧不放松。
//     ⚠️ 后果（如实写出）：`0.25 × host ≤ 26.0 GiB`（host ≤ 104 GiB）时下界主导 ⇒ 结果 = 0.25 × host，
//     **小宿主上不收紧**。这是有意的保守方向：宁可少收紧，不可把已观测的真实需求砍掉。
//
// ── 为什么实现在本文件而不是 `effective-capacity-probe.ts` ────────────────────────────────────
// 本任务声明的 Touches 里有 `effective-capacity-probe.ts`（它 `QUAY_OWN_SCOPE_PREFIXES` 那份「quay 自己
// 的 scope 前缀」和这里要数的前缀是同一组字符串，本可以是它的家）。但 `probe → runner-concurrency.ts
// → driver-runtime.ts` 是一条**已有的值导入链**（`probe:107` / `runner-concurrency.ts:21`），再加
// `driver-runtime → probe` 就闭合成**新的三节点 SCC**，而 `plugin/import-graph-baseline.json` 的
// `valueSccs` 基线是 **0**（shrink-only 棘轮）⇒ 那条路会让 import-graph-check 直接变红。故实现落在本
// 文件（anchor 侧本来就有 `readAnchorEnvelope` 这类 cgroup 读侧代码），前缀常量由**已有的两个单源**拼出
// （本文件的 `ANCHOR_UNIT_PREFIX` + Core 的 `SERVE_UNIT_PREFIX`），⛔ 不是给第三份前缀清单（硬规则 5b）。
// `full-suite-runner.ts` 与两个测试文件都从**本文件** import 这一份实现。

/** 共享宿主上「同类」的 scope 名前缀：常驻的 anchor 组与 serve 宿主。
 *  ⛔ 不含 `run-*`：那是 `systemd-run --scope` 给**一次套件**的瞬态 scope（短命、每个套件一个、
 *  与 anchor 的常驻 ceiling 不是同一类东西）。两个前缀各自取自**已有的单源**，⛔ 不新写字符串。 */
export const SHARED_HOST_SCOPE_PREFIXES: readonly string[] = [ANCHOR_UNIT_PREFIX, SERVE_UNIT_PREFIX];

/** cgroup 树遍历的最大深度（`…/user.slice/user-N.slice/user@N.service/app.slice/x.scope` = 5 层；
 *  留余量）。设界是为了「系统级 scope / 容器目录」不会让一次枚举变成无界递归。 */
export const SHARED_HOST_SCOPE_MAX_DEPTH = 8;

/** 已观测到的**真实长期峰值**（ClaudeCodeUI 侧实测，2026-10-10）：`quay-anchor-cantus-*` 存活 6 天，
 *  peak = 13.0 GiB。⛔ 这是测量值，不是凭空定的阈值；下界由它推导。 */
export const SHARED_HOST_OBSERVED_PEAK_BYTES = Math.round(13.0 * 1024 ** 3);

/** 下界 = 2 × 最大实测峰值 = 26.0 GiB —— 公式收紧时**不得**把 ceiling 压到这个数以下
 *  （理由见上面那段长注释：裸除法在 N=12 时给出 ≈5.1 GiB < 实测峰值，会杀健康 anchor）。 */
export const SHARED_HOST_MIN_CEILING_BYTES = 2 * SHARED_HOST_OBSERVED_PEAK_BYTES;

/** 同类 scope 的枚举读数。**三态**（硬规则 3b）：`count: null` = **未评估**（cgroup 根读不到），
 *  ⛔ 与 `count: 0`（读了，就是没有别的）**不共用取值**。 */
export interface SharedHostScopeReading {
  /** 宿主上活着的同类 scope 数，**不含本进程自己所在的那个**；`null` = 未评估。 */
  count: number | null;
  /** 被数到的单元名（排序后），供证据/诊断直接引用——⛔ 不是一个只有条数的黑箱。 */
  units: string[];
  /** 读不到的子树（`路径 (原因)`）。非空 ⇒ `count` 是**下界**。 */
  unreadableDirs: string[];
  /** `count === null` 时的具名原因；子树残缺时的具名说明；否则 null。 */
  reason: string | null;
}

/** 本进程所在 cgroup 的末段单元名（`.scope` 结尾），读不到 / 不在 scope 内 ⇒ null。
 *  用来把「自己」从计数里排除：本进程若已在某个 `quay-anchor-*` 里（自刷新 / takeover 路径），
 *  它自己**不是**兄弟；`N+1` 里的那个 `+1` 就是它。 */
export function selfScopeUnitName(procSelfCgroup?: string | null): string | null {
  let text: string | null;
  if (procSelfCgroup === undefined) {
    try {
      text = fs.readFileSync("/proc/self/cgroup", "utf8");
    } catch {
      return null;
    }
  } else {
    text = procSelfCgroup;
  }
  if (text === null) return null;
  const m = /(?:^|\n)0::(\/\S*)/.exec(text);
  if (!m) return null;
  const last = m[1].split("/").filter(Boolean).pop() ?? null;
  return last !== null && last.endsWith(".scope") ? last : null;
}

/** 只读枚举宿主上活着的同类 scope（`SHARED_HOST_SCOPE_PREFIXES`），**跨用户**——共享宿主上别人的
 *  uid 也在跑 quay，只数自己那份会少算一半（实测本机 4 个 uid 各有 anchor）。`/sys/fs/cgroup` 的
 *  `user.slice/user-<uid>.slice/user@<uid>.service/app.slice` 目录对其他 uid 是可读的，故不需要特权。
 *
 *  Fail-open（硬规则 3b）：cgroup 根都读不到（非 Linux / 无 cgroup v2 / 无权限）⇒ `count: null` +
 *  **具名原因**，调用方回退到原来的固定 0.25（⛔ 不拒绝运行、⛔ 不要求任何外部配置存在）。
 *  子树读不到 ⇒ 仍给 `count`，但 `reason` 说明它是**下界**：少数的方向是「ceiling 更松」，⛔ 永远不会
 *  因为读不到而**多收紧**。
 *  ⛔ 一个 scope 目录内的子 cgroup 是它的委派子树（不是单元），故不再向下走。 */
export function listSharedHostScopes(
  opts: {
    /** 测试缝：cgroup 根。缺省 `/sys/fs/cgroup`。 */
    cgroupRoot?: string;
    /** 测试缝：`/proc/self/cgroup` 的**原文**。缺省读它；`null` = 已知读不到。 */
    procSelfCgroup?: string | null;
    /** 测试缝：自己所在的单元名（排除用）。缺省从 `procSelfCgroup` 推导。 */
    ownUnit?: string | null;
    /** 测试缝：要数的前缀。缺省 `SHARED_HOST_SCOPE_PREFIXES`。 */
    prefixes?: readonly string[];
    /** 测试缝：最大遍历深度。缺省 `SHARED_HOST_SCOPE_MAX_DEPTH`。 */
    maxDepth?: number;
  } = {},
): SharedHostScopeReading {
  const root = opts.cgroupRoot ?? "/sys/fs/cgroup";
  const prefixes = opts.prefixes ?? SHARED_HOST_SCOPE_PREFIXES;
  const maxDepth = opts.maxDepth ?? SHARED_HOST_SCOPE_MAX_DEPTH;
  const ownUnit = opts.ownUnit !== undefined ? opts.ownUnit : selfScopeUnitName(opts.procSelfCgroup);

  const units: string[] = [];
  const unreadableDirs: string[] = [];
  let rootError: string | null = null;

  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      const msg = `${dir} (${e instanceof Error ? e.message : String(e)})`;
      if (dir === root) rootError = msg;
      else unreadableDirs.push(msg);
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (name.endsWith(".scope")) {
        if (name !== ownUnit && prefixes.some((p) => name.startsWith(p))) units.push(name);
        continue;
      }
      if (depth + 1 > maxDepth) continue;
      walk(path.join(dir, name), depth + 1);
    }
  };
  walk(root, 0);

  // ⛔ 根都读不到 ⇒ **未评估**（一个独立取值），⛔ 不是 `count: 0`。
  if (rootError !== null) {
    return {
      count: null,
      units: [],
      unreadableDirs,
      reason: `cannot enumerate the cgroup root — ${rootError}; the live same-kind scope count was NOT evaluated`,
    };
  }
  units.sort();
  return {
    count: units.length,
    units,
    unreadableDirs,
    reason:
      unreadableDirs.length === 0
        ? null
        : `${unreadableDirs.length} subtree(s) could not be read (${unreadableDirs.join("; ")}) — the count is a LOWER BOUND (fewer siblings ⇒ a LOOSER ceiling, never a tighter one)`,
  };
}

/** 本 scope 可用的内存 ceiling（字节，**已页对齐**）——共享宿主感知的那条公式（见上面长注释）。
 *
 *  `siblingScopeCount`：`null` = **未评估** ⇒ 返回原来的项目盲值 `defaultScopeMemoryMax(total, 0.25)`
 *  （**逐字节**等于改动前的值，⛔ 不是「约等于」）；`0..3` 时 `host/(N+1) ≥ 0.25 × host`，`min` 让结果
 *  同样**逐字节**等于旧值（临界点，见上）；`≥4` 起才真正收紧，并止于 `SHARED_HOST_MIN_CEILING_BYTES`。
 *  ⛔ 纯函数（宿主字节数 / 计数全可注入）⇒ 两个注入宿主必得两个不同的值（硬规则 4）。 */
export function sharedHostCeilingBytes(
  totalmemBytes: number,
  siblingScopeCount: number | null,
  baseFraction: number = SCOPE_ENVELOPE_HOST_FRACTION,
): number {
  const total = Number.isFinite(totalmemBytes) && totalmemBytes > 0 ? totalmemBytes : 0;
  const projectBlind = Number(defaultScopeMemoryMax(total, baseFraction));
  if (siblingScopeCount === null) return projectBlind;
  const n = Number.isFinite(siblingScopeCount) && siblingScopeCount > 0 ? Math.floor(siblingScopeCount) : 0;
  const split = Math.floor(total / (n + 1));
  const chosen = Math.min(projectBlind, Math.max(split, SHARED_HOST_MIN_CEILING_BYTES));
  // 页对齐复用同一实现（`defaultScopeMemoryMax(x, 1)` = pageAlign(floor(x))）——⛔ 不自带第二份对齐逻辑。
  return Number(defaultScopeMemoryMax(chosen, 1));
}

/** 上式的**分数**形态，供证据/日志直接引用「算出来的分数值」。
 *
 *  ⛔ 未评估 ⇒ 原样返回 `baseFraction`（与 `sharedHostCeilingBytes` 的 fail-open 一致）。
 *  ⛔ 而**收紧没生效**时（`N ≤ 3`）也返回 `baseFraction` —— 那**正是**当时生效的规则：ceiling 逐字节
 *  等于项目盲值，能产生它的比例就是 0.25 本身。若在这里回算 `pageAlign(...)/total`，得到的是
 *  `0.2499999922…`——一个「看起来像测量值的数」，把「规则没变」显示成「规则变了一点点」（硬规则 3b）。 */
export function sharedHostEnvelopeFraction(
  totalmemBytes: number,
  siblingScopeCount: number | null,
  baseFraction: number = SCOPE_ENVELOPE_HOST_FRACTION,
): number {
  if (siblingScopeCount === null) return baseFraction;
  const total = Number.isFinite(totalmemBytes) && totalmemBytes > 0 ? totalmemBytes : 0;
  if (total === 0) return baseFraction;
  const projectBlind = Number(defaultScopeMemoryMax(total, baseFraction));
  const ceiling = sharedHostCeilingBytes(total, siblingScopeCount, baseFraction);
  return ceiling === projectBlind ? baseFraction : ceiling / total;
}

/** 起一个 anchor 子进程（detached，setsid 等价）。返回 {pid, error}。⛔ 不继承调用者 stdout/stderr。
 *
 *  自 2026-09-25 起：可用时**包在 `systemd-run --user --scope` 里**起（见上面那段长注释；实测原地 exec
 *  ⇒ pid 语义不变）。systemd-run 不可用 ⇒ **回退为原行为**，但把独立取值 `envelope: "none"` + 具名原因
 *  写进 anchor 日志（硬规则 3b：⛔ 不静默地假装有包络）。 */
export function spawnAnchor(
  root: string,
  opts: { logFile?: string; takeoverPid?: number | null } = {},
): { pid: number | null; error: string | null } {
  const sibling = preferredAnchorKernel();
  if (!sibling) return { pid: null, error: `driver-anchor module not found next to driver-runtime (${path.dirname(kernelSelfPath())})` };
  const anchorLog = opts.logFile ?? anchorPaths(root).logFile;
  fs.mkdirSync(path.dirname(anchorLog), { recursive: true });
  let fd: number;
  try {
    fd = fs.openSync(anchorLog, "a");
  } catch {
    return { pid: null, error: `cannot open anchor log ${anchorLog}` };
  }
  const innerArgs = [
    process.execPath,
    ...(sibling.stripTypes ? ["--experimental-strip-types"] : []),
    sibling.path,
    "__anchor",
    "--root",
    root,
  ];
  if (opts.takeoverPid) innerArgs.push("--takeover", String(opts.takeoverPid));
  const res = resolveAnchorEnvelope({ root });
  const args = anchorLaunchArgv(innerArgs, res);
  // envelope 读数是**启动者的声明**（内核读不到「上限由谁决定」），经 env 交给 anchor 去发布（Plan 步 2）；
  // ⛔ memoryMax 本身**不**走这条——它由 anchor 从 cgroup 文件读（硬规则 4b）。
  const childEnv: NodeJS.ProcessEnv = res.source ? { ...process.env, [ANCHOR_ENVELOPE_SOURCE_ENV]: res.source } : process.env;
  // 共享宿主那一步的出处必须与 ceiling 同行落痕：读这份日志的人要能分辨「按 N 个同类 scope 收紧过」
  // 与「没数成、退回项目盲的 0.25」（硬规则 3b——两者若同形，「收紧没生效」就永远看不见）。
  const sharedHostNote =
    res.siblingScopeCount === null
      ? `shared-host: sibling count NOT evaluated (${res.siblingScopeReason ?? "reason not recorded"}) — project-blind fraction`
      : `shared-host: ${res.siblingScopeCount} live sibling scope(s) counted`;
  try {
    fs.writeSync(
      fd,
      res.envelope === "scope"
        ? `driver-runtime: anchor envelope: unit=${res.unit} memoryMax=${res.memoryMax ?? "(unset — env explicitly unlimited)"} source=${res.source} (${sharedHostNote})\n`
        : `driver-runtime: anchor envelope: none — ${res.reason} (${sharedHostNote})\n`,
    );
  } catch { /* 日志写失败不致命 */ }
  const child = spawn(args[0], args.slice(1), { detached: true, stdio: ["ignore", fd, fd], env: childEnv });
  child.unref();
  return { pid: child.pid ?? null, error: child.pid ? null : "spawn returned no pid" };
}

// ── Layer 0 · 判停（stopCondition，SPEC §2.1 共同不变式：halt ∧ resourceGate）──────────────────────
// 两 driver 的派发环起新 worker/晋升前逐轮读：halt 优先（终态，latch）；其次 resource-gate WAIT（瞬时，
// ⛔ 不 latch——gap-worker-driver-stopreason-latch-permanent-stop：WAIT 名字含 WAIT，负载高恰因在飞
// worker 在跑、worker 结束负载降但闸再没被读 = 自我锁死反馈环）。

/** 判停结果。terminal=true ⇒ 终态（mcp-halt），latch 后停止起新派发、在飞跑完才退出；terminal=false
 *  ⇒ 瞬时 WAIT（resource-gate-wait），本轮不派、下一轮重读，⛔ 不 latch。 */
export interface StopConditionResult {
  stop: boolean;
  reason: string | null;
  terminal: boolean;
}

/** 构造一个 kind 的判停函数（halt 经 kind 控制态文件读；resource-gate 与 worker 共用同一份实现）。 */
export function makeStopCondition(
  root: string,
  kind: DriverKind,
  resourceGateArgv: string[] | null = null,
): () => StopConditionResult {
  const spec = DRIVER_KINDS[kind];
  const controlRel = path.posix.join(".quay", spec.controlFile);
  return () => {
    if (isHalted(root, process.env, controlRel)) {
      return {
        stop: true,
        reason: `mcp-halt (control state halted — no new dispatch; in-flight workers untouched)`,
        terminal: true,
      };
    }
    const rg = resourceGateCheck(root, resourceGateArgv);
    if (!rg.go) return { stop: true, reason: `resource-gate-wait: ${rg.reason}`, terminal: false };
    return { stop: false, reason: null, terminal: false };
  };
}

// ── Layer 0 · 心跳（heartbeat，AC138-3：无条件每轮写一条 round 记录）───────────────────────────────
// round 心跳与 outcome 分工：outcome 只在任务真完成时写，池空时 outcome 停更会被 status 的 last_record_ts
// 误读为「死亡」；round 每轮无条件写一条作 liveness 直接量。⛔ 一条 append 的单一实现，两 driver 共用。

/** 把一条已序列化的 round 记录追加写入文件（mkdir -p + appendFileSync，一行一 JSON，⛔ 不截断不覆盖）。 */
export function appendHeartbeatLine(file: string, record: Record<string, unknown>): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return file;
}

// ── Layer 0 · 出站通知（notify，SPEC §2.3：driver → manager，send-to-session own-child）──────────────
// driver 进程不是 Claude Code 会话、无 SendMessage 工具可调，必须走进程间通信。own-child 模式
// （--pid <manager-pid> --token <childToken>）由 manager 把自己的 childToken 交给启动的子进程——不是伪造
// 身份。⛔ 本函数是【接口】，具体消息形态/频率由 AC146「显式承接者」落地方设计；AC151 只落地能力。

/** 通知 manager 一次（fire-and-forget：send-to-session 写 socket 返回 0 字节、无 ack）。返回是否
 *  spawn 成功（连上+写成功 = ok；⛔ 不代表对方真收到）。 */
export function notifyManager(opts: {
  root: string;
  pid: number;
  token: string;
  message: string;
}): { ok: boolean; error: string | null } {
  const sibling = resolveKernelSibling("send-to-session.ts");
  if (!sibling) {
    return { ok: false, error: "send-to-session.ts not resolvable from the kernel's install location (third-party install missing the shipped bundle)" };
  }
  const argv = [
    process.execPath,
    ...(sibling.stripTypes ? ["--experimental-strip-types"] : []),
    sibling.path,
    "--pid",
    String(opts.pid),
    "--token",
    opts.token,
    opts.message,
  ];
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error || r.status !== 0) {
      return { ok: false, error: r.error ? String(r.error.message || r.error) : `send-to-session exited ${r.status}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e && typeof e === "object" && "message" in e ? String(e.message) : String(e) };
  }
}

// ── Layer 0 · profile（launchArgv，AC140 单一构造点：LLM 调用配置解析）──────────────────────────────
// 驱动 LLM spawn 的 argv 构造：调用点只说【语义 kind】（role ∈ task-worker | selector | fix-worker），
// 由 L2 policy（profile-policy.ts loadProfiles + resolveRole）解析成 L1 profile（launcher / model /
// --bare / -n / env），再在此【单一构造点】出 argv（L3 gap-driver-binding-semantic-kind-to-profile）。
// ⛔ 不再 `bash quay-launch.sh <role> -p <prompt>`——那会把 kind→profile 解析交给 bash 里的第二份实现
// （python3+jq，且不套 L2 的主备回退/加载校验/继承去重）。quay-launch.sh 保留给非驱动路径
// （manager/outer/inner 长驻会话，经 manager-start.sh / session-bootstrap.sh 直接调用）。

/** 空格分隔 argv 切分（⛔ 无 shell 元字符 / 引号；用于覆盖命令与默认 claude -p）。 */
export function splitArgs(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

/** settings 文件选取：`<root>/.claude/launch.settings.json`（dev-tree 优先）→ `<root>/plugin/.claude/
 *  launch.settings.json`（出厂 fallback，同 quay-launch.sh 的手法）。两处都不存在 ⇒ 抛错（fail-closed）。 */
function pickSettingsFile(root: string): string {
  const devTree = path.join(root, ".claude", "launch.settings.json");
  if (fs.existsSync(devTree)) return devTree;
  const shipped = path.join(resolveKernelPluginRoot(), ".claude", "launch.settings.json");
  if (fs.existsSync(shipped)) return shipped;
  throw new Error(`launch settings file not found (checked ${devTree} and ${shipped})`);
}

/** 拼 `--settings` 参数：把 profile.unset（取消继承，删除 settings env 键）+ resolved 的 env（profile.env
 *  + role.env）合并到 settings 文件 env 之上。无 unset 且无 env ⇒ 直接用文件路径（可读、逐字可查）；
 *  否则合并成 JSON 字符串传给 --settings（--settings 接受 file-or-json，复刻 quay-launch.sh 语义）。 */
function launchSettingsArg(root: string, config: ProfilesConfig, kind: string, resolvedEnv: Record<string, string>): string {
  const settingsFile = pickSettingsFile(root);
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const roleSpec = config.roles?.[kind];
  const profileSpec = roleSpec ? config.profiles?.[roleSpec.profile] : undefined;
  const unset = profileSpec?.unset ?? [];
  const env: Record<string, string> = { ...(settings.env ?? {}) };
  for (const k of unset) delete env[k];
  Object.assign(env, resolvedEnv);
  const needsJson = unset.length > 0 || Object.keys(resolvedEnv).length > 0;
  return needsJson ? JSON.stringify({ ...settings, env }) : settingsFile;
}

/** `launchArgv` 的可选缝。全部缺省 ⇒ 生产行为（读真实 profiles.yml / 真实配置根）。 */
export interface LaunchArgvOpts {
  /** MCP 配置根覆盖（测试缝，AC7）：`null` = 显式「解析不出」⇒ 不追加任何 mcp flag；
   *  缺省（undefined）⇒ 生产路径（env 缝 / 真实 `~/.claude*`）。⛔ 用 undefined vs null 区分
   *  「没传」与「传了、结论是不可用」——两者动作相同但成因不同，测试要能分别钉住。 */
  mcpRoots?: McpConfigRoots | null;
  /** 把 prompt 从 argv 移出（`-p` 留空，prompt 由调用方经 runAsync 的 stdinData 写入）。
   *  为什么存在：prompt 作为**单个 argv 元素**时受 Linux `MAX_ARG_STRLEN`（128 KiB）限制，
   *  超过即 `spawn E2BIG`——meta-driver 的 readings JSON 已实测到 1.28 MB
   *  （gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen）。
   *  缺省 false ⇒ 既有调用点 argv **逐字不变**（只有真正超限的调用点才开）。 */
  promptViaStdin?: boolean;
}

/** LLM 调用配置解析单一构造点（role ∈ task-worker | selector | fix-worker）。经 L2 policy 解析
 *  语义 kind → profile，再出 argv。profile 缺失 / 非法 ⇒ loadProfiles 抛错（fail-closed，⛔ 不静默）。
 *
 *  MCP 黑名单（gap-worker-mcp-blacklist-strict-config）：若该 role 声明了非空 `mcpBlacklist`，
 *  枚举当前实际配置的 MCP server、减去黑名单，追加 `--strict-mcp-config --mcp-config <inline json>`。
 *  ⛔ 解析不出（读不懂输入）⇒ 一个 flag 都不加（回退原样派发）——这是资源优化，不是正确性闸。
 *  空黑名单（如 outer）⇒ 逐字不变的 argv（AC1 负控制：共享 profile 不连坐）。 */
export function launchArgv(role: string, prompt: string, root: string, opts: LaunchArgvOpts = {}): string[] {
  const config = loadProfiles(root); // L2：读 + 校验 profiles.yml（加载校验 AC2）
  const resolved = resolveRole(config, role); // L2：kind → profile（主备回退 / 继承去重）
  if (!resolved.launcher || !resolved.name) {
    throw new Error(`role "${role}" resolves an empty launcher/name — check .quay/profiles.yml`);
  }
  const argv = [resolved.launcher, "--settings", launchSettingsArg(root, config, role, resolved.env)];
  if (config.excludeDynamicSystemPromptSections === true) argv.push("--exclude-dynamic-system-prompt-sections");
  if (config.promptSuggestions === false) argv.push("--prompt-suggestions", "false");
  if (resolved.model) argv.push("--model", resolved.model);
  if (resolved.bare) argv.push("--bare");
  if (resolved.mcpBlacklist.length > 0) {
    const roots = opts.mcpRoots !== undefined ? opts.mcpRoots : rootsFromEnv([root], process.env, resolveKernelPluginRoot());
    if (roots) argv.push(...mcpConfigArgvSuffix(resolved.mcpBlacklist, roots));
  }
  // promptViaStdin ⇒ `-p` 不带值（prompt 由调用方写 stdin）；缺省仍是 `-p <prompt>`，逐字不变。
  if (opts.promptViaStdin === true) argv.push("-n", resolved.name, "-p");
  else argv.push("-n", resolved.name, "-p", prompt);
  return argv;
}

// ── 环境级（environment-fatal）签名：launcher/model 解析结果【必然导致所有 worker 同样失败】的字面形态 ──
// 为什么这份表住在 Layer 0（driver-runtime）而不是 worker-driver：**两个消费方必须共用同一份清单**——
// ① 本文件的启动冒烟 `runEnvironmentSmoke`（起循环【之前】就拒绝一个坏环境）；② worker-driver 的快速
// 死亡分类器（循环【之中】发现环境级故障 ⇒ 停 driver 而不是逐个 park 任务）。而 worker-driver **已经**
// 从本文件 import（stopCondition 等），反向 import 会造出一个新的 value SCC（import-graph-check 是
// shrink-only 棘轮，基线 valueSccs=0 ⇒ 直接红）。把表放在【被依赖的那一侧】是唯一不造环的单一真相源。
// 生产实例 → `gap-worker-quick-death-environment-fatal-halts-driver`（claudecodeui 2026-09-20）。
//
// ⛔ 宁窄勿宽（硬规则 2 按位置判定）：每条签名都配一条【不命中】的反例，由测试逐条双向断言——过宽的
// 签名必然在它自己的反例上命中，所以这份表能对自己的「过宽」取假。

/** 环境级签名的一条匹配规则。`example`/`counterexample` 是机器可读的正反例（测试逐条断言）。 */
export interface EnvFatalSignature {
  /** 签名名（人读标识，落进停机原因）；⛔ 不是匹配面本身。 */
  name: string;
  /** 匹配规则。⛔ 用正则而非裸子串：`401` 这类短数字裸子串会命中 `wall_clock_ms=4012`。 */
  re: RegExp;
  /** 一条【命中】该签名的真实文本形态（第一手样本或同族字面形态）。 */
  example: string;
  /** 一条【不命中】该签名的反例——必须「看起来像」但结构上不同形。 */
  counterexample: string;
}

/** 环境级签名表（见上方「为什么住在 Layer 0」）。 */
export const ENVIRONMENT_FATAL_SIGNATURES: readonly EnvFatalSignature[] = [
  {
    name: "model_not_found",
    re: /model_not_found/i,
    example:
      'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: v4.1flash"}} (model_not_found)',
    counterexample: "worker exited with code 1",
  },
  {
    name: "auth-401",
    // ⛔ 裸 `401` 太宽（`wall_clock_ms=4012` 会命中）⇒ 必须带 HTTP 错误语境。
    re: /api error:\s*(401|403)\b/i,
    example: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    counterexample: "worker exited with code 4012",
  },
  {
    name: "invalid-x-api-key",
    re: /invalid\s+x-api-key/i,
    example: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    counterexample: "x-api-key header accepted by gateway",
  },
  {
    name: "authentication_error",
    re: /authentication_error/i,
    example: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    counterexample: "worker exited with code 1",
  },
  {
    name: "launcher-enoent",
    // ⛔ 裸 `ENOENT` 太宽（`ENOENT: no such file or directory, open 'tasks/x.md'` 是任务自身缺陷的常见
    // 形态）⇒ 只认「spawn 一个可执行文件」那一种 node 错误形态。
    re: /spawn\s+\S+\s+enoent/i,
    example: "Error: spawn claude-fjdac ENOENT",
    counterexample: "ENOENT: no such file or directory, open 'tasks/gap-x.md'",
  },
  {
    name: "dns-unresolvable",
    re: /could not resolve host/i,
    example: "curl: (6) Could not resolve host: api.anthropic.com",
    counterexample: "resolved host api.anthropic.com → 160.79.104.10",
  },
];

/** 环境级签名匹配结果：命中的签名名 + 【原文摘录】（停机原因与载体要附的「签名原文」）。 */
export interface EnvFatalMatch {
  signature: string;
  /** 命中处的原文（截断到一行）。⛔ 理论上可为 null（跨行正则命中而非单行），调用方须容忍。 */
  evidence: string | null;
}

/** 在一段文本里找第一条命中的环境级签名（纯函数，⛔ 不读文件、⛔ 不看进程、⛔ 不调模型）。
 *  返回 null = 【没命中】（硬规则 3：不与「命中某条」同形）。 */
export function matchEnvironmentFatalSignature(text: string | null | undefined): EnvFatalMatch | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  for (const sig of ENVIRONMENT_FATAL_SIGNATURES) {
    if (!sig.re.test(text)) continue;
    let evidence: string | null = null;
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      if (sig.re.test(line)) { evidence = line.trim().slice(0, 400); break; }
    }
    if (evidence == null) {
      const first = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
      evidence = first != null ? first.slice(0, 400) : null;
    }
    return { signature: sig.name, evidence };
  }
  return null;
}

// ── Layer 0 · 环境冒烟（`quay driver start --kind worker` 起循环【之前】的拒绝闸）─────────────────

/** 冒烟调用用的最小 prompt（⛔ 不是任务 prompt——它只问「这个 launcher+model 现在能不能通」）。 */
export const ENVIRONMENT_SMOKE_PROMPT = "Reply with exactly: ok";
/** 冒烟调用预算（ms）。机制常量（一次最小往返的上界），⛔ 不读宿主规格。 */
export const ENVIRONMENT_SMOKE_TIMEOUT_MS = 120_000;

/** 环境冒烟结果【四态】（⛔ 两两不同形，硬规则 3/3b）：
 *   - "pass"                    —— launcher+model 解析得出，冒烟退出 0。
 *   - "refused"                 —— 命中环境级签名（含 launcher 根本起不来）⇒ 调用方拒绝启动。
 *   - "failed-non-environment"  —— 跑了、非零退出/超时/起不来，但【没有】环境级签名（如瞬时限流）
 *                                  ⇒ 只告警不拒启（拒启会把一次限流变成「起不了 driver」，而限流正是
 *                                  驱动自己该退避处理的态）。
 *   - "not-evaluated"           —— 连冒烟 argv 都构不出（profiles.yml 缺失/非法 ⇒ 解析不出 launcher/
 *                                  model）⇒ 如实报「未评估」，⛔ 不与 "pass" 同形（硬规则 3b：读不懂 ≠ 合格）。 */
export type EnvironmentSmokeVerdict = "pass" | "refused" | "failed-non-environment" | "not-evaluated";

/** 一次环境冒烟的结果（verdict + 人读原因 + 命中签名 + 输出尾部）。 */
export interface EnvironmentSmokeResult {
  verdict: EnvironmentSmokeVerdict;
  reason: string;
  signature: string | null;
  /** 冒烟输出的尾部（供人/载体读）。⛔ 未评估 ⇒ 空串（没跑就没输出）。 */
  output: string;
}

/** 用【解析出的 launcher + model】做一次最小调用，回答「这个环境现在能不能跑 worker」。
 *  判定面 = 子进程的 stderr+stdout+spawn 错误（⛔ 不看退出码单独下结论：launcher 可能把 404 打在
 *  输出里却 exit 0）。**失败即拒绝**只留给环境级签名与「起不来」；其余失败只告警（见四态注释）。 */
export async function runEnvironmentSmoke(
  root: string,
  opts: { timeoutMs?: number; role?: string } = {},
): Promise<EnvironmentSmokeResult> {
  let argv: string[];
  try {
    argv = launchArgv(opts.role ?? "task-worker", ENVIRONMENT_SMOKE_PROMPT, root);
  } catch (e) {
    // 解析不出 launcher/model ⇒ 没有可比对的对象。⛔ 不伪装成 pass。
    return { verdict: "not-evaluated", reason: `profile resolution failed: ${e instanceof Error ? e.message : String(e)}`, signature: null, output: "" };
  }
  const r = await runAsync(argv, { timeoutMs: opts.timeoutMs ?? ENVIRONMENT_SMOKE_TIMEOUT_MS, collectStderr: true });
  const spawnErr = r.error ? String(r.error.message ?? r.error) : "";
  const combined = [r.stderr, r.stdout, spawnErr].filter((s) => s.length > 0).join("\n");
  const match = matchEnvironmentFatalSignature(combined);
  if (match != null) {
    const ev = match.evidence ?? combined.slice(-400);
    return { verdict: "refused", reason: `environment-fatal signature "${match.signature}": ${ev}`, signature: match.signature, output: combined.slice(-4000) };
  }
  if (r.error) {
    return { verdict: "failed-non-environment", reason: `smoke call could not run: ${spawnErr}`, signature: null, output: combined.slice(-4000) };
  }
  if (r.status !== 0) {
    return { verdict: "failed-non-environment", reason: `smoke call exited ${r.status} without an environment-fatal signature`, signature: null, output: combined.slice(-4000) };
  }
  return { verdict: "pass", reason: "smoke call exited 0", signature: null, output: combined.slice(-4000) };
}

// ── Layer 0 · 异步 spawn 原语（runAsync，SPEC §5.7：循环体用 spawnSync 会冻住协调地板）──────────────

/** 异步 spawn（spawn 而非 spawnSync）：不阻塞事件循环，child exit 本身是一个唤醒源。collectStderr=true
 *  时捕获 stderr；缺省 stderr 丢弃。timeoutMs 到期 ⇒ SIGKILL child 并 resolve error；timeoutMs=Infinity
 *  ⇒ 无超时（unbounded，child exit/error 是唯一唤醒）——正确性锁的排队等待用（死持有者由调用侧的
 *  watchdog 兜底，不靠此处 SIGKILL）。永不 throw。 */
export async function runAsync(
  argv: string[],
  opts: { timeoutMs: number; collectStderr?: boolean; stdinData?: string } = { timeoutMs: 120_000 },
): Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }> {
  const { timeoutMs, collectStderr = false, stdinData } = opts;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        // stdinData 缺省 ⇒ "ignore"，与既有行为逐字一致；给了才开 pipe 并写入后 end。
        // （gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen：prompt 作为单个 argv 元素会撞
        // Linux 的 MAX_ARG_STRLEN=128KiB 单参数上限 ⇒ spawn E2BIG。走 stdin 是那条路的上限之外的传输面。）
        stdio: [stdinData === undefined ? "ignore" : "pipe", "pipe", collectStderr ? "pipe" : "ignore"],
      });
    } catch (e) {
      resolve({ status: null, stdout: "", stderr: "", error: e as Error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (status: number | null, error: Error | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    };
    // ⛔ setTimeout(…, Infinity) 会被 Node 压到 1ms ⇒ 立即 SIGKILL（把「无超时」错当「立即超时」）。
    // Infinity 显式 = 不设 timer（unbounded）；有限值仍照旧 SIGKILL。child close/error 是唯一唤醒源。
    if (Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        finish(null, new Error(`spawn timeout after ${timeoutMs}ms (SIGKILL): ${argv[0]}`));
      }, timeoutMs);
    }
    if (stdinData !== undefined && child.stdin) {
      // 写失败（子进程已退出/EPIPE）不算致命：child.on("error"/"close") 仍会 settle。
      child.stdin.on("error", () => { /* ignored — the child's own exit decides the outcome */ });
      child.stdin.end(stdinData);
    }
    child.stdout?.on("data", (d) => { stdout += d; });
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code, null));
  });
}

// ── Layer 0 · liveness（gap-resident-driver-stable-carrier-liveness AC2/AC3：死亡告警）────────────────
// 检测并报告 driver/supervisor 的死亡：pid 文件指向【已不存在的 pid】是死亡的直接量（⛔ 载体停更 ≠
// 一切正常）。复用本 kernel 的 pid 记账（单一真相源），⛔ 不在驱动里重写存活判定。

/** liveness 检查的 wall-clock 上限（spawnSync timeout，毫秒）。轻量（kill -0 判定），远小于 round。 */
export const LIVENESS_CHECK_TIMEOUT_MS = 10_000;

/** 单轮 liveness 检查结果。checked=false ⇒ 未查成（脚本缺失 / spawn 失败 / 输出不可解析）——「未评估」，
 *  ⛔ 不是「健康」（硬规则 3b）。deaths=null + checked=true ⇒ 查过且健康；deaths 非空 ⇒ 查过且检出死亡。 */
export interface LivenessResult {
  checked: boolean;
  deaths: string | null;
  running: boolean;
}

/** 缺省 liveness 检查命令：复用本 kernel 的 liveness 子命令（单一真相源）。kind 是驱动文件身份
 *  （worker-driver.ts 恒 worker；promotion-driver.ts 恒 promotion，同函数传不同 kind）。 */
export function defaultLivenessCheckArgv(root: string, kind: DriverKind): string[] {
  return [process.execPath, "--experimental-strip-types", kernelSelfPath(), "liveness", "--kind", kind, "--root", root, "--json"];
}

/** liveness 告警日志（ok / DEATH）单一落点：livenessForKind（外部子命令）与 livenessInProcess
 *  （常驻循环 in-process 缺省）共用，⛔ 不各写一遍。 */
function writeLivenessLog(root: string, kind: DriverKind, deaths: string[], supervisorPid: number | null, driverPid: number | null): void {
  const st = statePaths(root, kind);
  if (deaths.length > 0) {
    appendLog(
      st.livenessLog,
      `${ts()} liveness: DEATH deaths=${deaths.join(",")} kind=${kind} supervisor_pid=${supervisorPid ?? "none"} driver_pid=${driverPid ?? "none"}`,
    );
  } else {
    appendLog(
      st.livenessLog,
      `${ts()} liveness: ok kind=${kind} supervisor_pid=${supervisorPid ?? "none"} driver_pid=${driverPid ?? "none"}`,
    );
  }
}

/** 常驻循环的缺省（cmd=null）in-process liveness：aliveness() 单一真相源 + 写 liveness 告警日志。
 *  ⛔ 不 spawn `node … driver-runtime.ts liveness`——那个子命令每轮加载整个 kernel + resolveMainRoot
 *  （spawnSync git worktree list），16-way 桶负载下把常驻循环拖到 5000ms waitFor 超时（gap-ac151
 *  RED：worker-driver.test.mjs 5 测全 waitFor 超时）。in-process 无 spawn 失败路径 ⇒ checked=true 恒成立
 *  （「查过」；deaths 空 = 健康，deaths 非空 = 检出死亡——与外部版 checked/deaths 语义一致）。 */
export function livenessInProcess(root: string, kind: DriverKind): LivenessResult {
  const a = aliveness(root, kind);
  writeLivenessLog(root, kind, a.deaths, a.supervisorPid, a.driverPid);
  return { checked: true, deaths: a.deaths.length > 0 ? a.deaths.join(",") : null, running: a.running };
}

/** 跑一次 liveness 检查。cmd 覆盖命令（测试缝）⇒ spawn；缺省（cmd=null）⇒ in-process
 *  livenessInProcess（⛔ 不 spawn 重进程）。 */
export function runLivenessCheck(root: string, kind: DriverKind, cmd: string[] | null = null): LivenessResult {
  if (cmd === null) return livenessInProcess(root, kind);
  const argv = cmd;
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: LIVENESS_CHECK_TIMEOUT_MS, maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error || r.status === null) return { checked: false, deaths: null, running: false };
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const deaths = j && typeof j.deaths === "string" && j.deaths !== "none" && j.deaths !== "" ? String(j.deaths) : null;
    return { checked: true, deaths, running: !!j.running };
  } catch {
    return { checked: false, deaths: null, running: false };
  }
}

/** runLivenessCheck 的异步版（常驻循环体用——⛔ spawnSync 会冻住协调地板）。缺省（cmd=null）⇒
 *  in-process livenessInProcess（同步，无 spawn）；cmd 覆盖 ⇒ 异步 spawn。 */
export async function runLivenessCheckAsync(
  root: string,
  kind: DriverKind,
  cmd: string[] | null = null,
): Promise<LivenessResult> {
  if (cmd === null) return livenessInProcess(root, kind);
  const argv = cmd;
  const r = await runAsync(argv, { timeoutMs: LIVENESS_CHECK_TIMEOUT_MS });
  if (r.error || r.status === null) return { checked: false, deaths: null, running: false };
  try {
    const j = JSON.parse(r.stdout.trim());
    const deaths = j && typeof j.deaths === "string" && j.deaths !== "none" && j.deaths !== "" ? String(j.deaths) : null;
    return { checked: true, deaths, running: !!j.running };
  } catch {
    return { checked: false, deaths: null, running: false };
  }
}

// ── Layer 1a · task-processing（source / select / filters / act / verify / outcome）────────────────
// 任务处理型 kind（promotion / worker）的共享面。⛔ Layer 2（kind）保留的部分：候选池的参数（promotion
// vs worker 语义不同）、单任务实际动作、select 策略、outcome 字段语义——那些在 kind 自己的 .ts 里。

/** Layer 1a 的例程契约：source 参数化 + 共享 filters/verify，kind 自供 act/select/outcome 语义。 */
export interface TaskProcessingSpec {
  /** source：候选池取可行集（kind 参数化 ready-pool-check 语义）。 */
  source(root: string, inFlight: string[], cap: number): Promise<{ ready: string[]; pool: number; criterionMet: boolean; error: string | null }>;
  /** filters：可组合谓词列表（单一实现，driver-filters）。 */
  filters: readonly { name: string }[];
  /** verify：独立复核（driver-result，单一实现）。 */
  verify: typeof verifyIndependently;
}

/** Fisher–Yates 打散（Layer 1a · select：候选顺序打散后交 selector，避免每次都看到同一顺序）。 */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 缺省 ready-pool-check 命令（Layer 1a · source 的缺省承载）。脚本路径锚在本 kernel 自身安装位置
 *  （⛔ 非 root —— AC-203），--root 仍指向目标 workspace root。 */
export function defaultReadyPoolArgv(root: string, inFlight: string[], cap: number): string[] {
  const sibling = resolveKernelSibling("ready-pool-check.ts");
  const scriptArgs = sibling
    ? (sibling.stripTypes ? ["--experimental-strip-types", sibling.path] : [sibling.path])
    : ["--experimental-strip-types", path.join(resolveKernelScriptsDir(), "ready-pool-check.ts")];
  const argv = ["node", ...scriptArgs, "--root", root, "--cap", String(cap), "--json"];
  if (inFlight.length > 0) argv.push("--in-flight", inFlight.join(","));
  return argv;
}

/** 调 ready-pool-check 取可行集（Layer 1a · source）。解析失败/非零退出 ⇒ fail-closed 空池（硬规则 3b）。 */
export async function readyPoolCheck(
  root: string,
  cmd: string[] | null,
  inFlight: string[],
  cap: number,
): Promise<{ ready: string[]; pool: number; criterionMet: boolean; error: string | null }> {
  const argv = cmd ?? defaultReadyPoolArgv(root, inFlight, cap);
  const r = await runAsync(argv, { timeoutMs: 120_000 });
  if (r.error || r.status !== 0) {
    const msg = r.error ? String(r.error.message || r.error) : `ready-pool-check exited ${r.status}`;
    return { ready: [], pool: 0, criterionMet: false, error: msg };
  }
  try {
    const j = JSON.parse(r.stdout.trim());
    const ready = Array.isArray(j.ready) ? j.ready.filter((x: unknown) => typeof x === "string") : [];
    return {
      ready,
      pool: typeof j.pool === "number" ? j.pool : ready.length,
      criterionMet: !!j.criterion_met,
      error: null,
    };
  } catch {
    return { ready: [], pool: 0, criterionMet: false, error: "unparseable ready-pool-check output" };
  }
}

/** 缺省 selector worker 命令（Layer 1a · select 的 LLM 语义选择）。 */
export function defaultSelectorArgv(candidateIds: string[], root: string): string[] {
  const prompt = [
    `You are the resident task selector for the quay worker driver (SPEC §5 阶段 4 — AC129).`,
    `Candidate task ids (ready pool, in-flight subtracted, order shuffled): ${candidateIds.join(", ")}.`,
    `Before choosing, read orchestration/dispatch-preference.md — its 覆盖段 carries the current priority (manager-maintained). Honor it unless a candidate is structurally ineligible (Touches conflict / unmet deps). If no candidate matches the override priority, fall back to your own semantic judgment.`,
    `Pick exactly ONE task to dispatch next and reply with a single line: <task-id> <one-line reason>`,
    `and nothing else. Repo root: ${root}.`,
  ].join(" ");
  return launchArgv("selector", prompt, root);
}

/** 解析 selector worker 输出（Layer 1a · select）。无效输出 ⇒ fail-closed 回退打散后首个候选。 */
export function parseSelectorOutput(
  stdout: string,
  candidates: string[],
  exitCode: number | null,
  stderr: string | null = null,
): { task: string; reason: string } | null {
  const line = String(stdout ?? "").trim().split("\n")[0]?.trim() ?? "";
  const m = line.match(/^\s*(\S+)(?:\s+(.*))?$/);
  const task = m ? m[1] : null;
  const reason = m && m[2] ? m[2].trim() : "";
  if (task && candidates.includes(task)) {
    return { task, reason: reason || `selector picked ${task}` };
  }
  const fallback = candidates[0];
  if (!fallback) return null;
  const got = line ? `, got "${line.slice(0, 80)}"` : "";
  const errFrag = stderr ? `, stderr="${stderr.slice(0, 200)}"` : "";
  return {
    task: fallback,
    reason: `selector worker returned no valid pick (exit ${exitCode ?? "null"}${got}${errFrag}); fallback to first shuffled candidate`,
  };
}

/** 交短命 selector worker（Layer 1a · select）。永不 throw。 */
export async function runSelectorWorker(
  candidates: string[],
  fixedArgv: string[] | null,
  root: string,
): Promise<{ task: string; reason: string } | null> {
  if (candidates.length === 0) return null;
  const argv = fixedArgv ?? defaultSelectorArgv(candidates, root);
  const r = await runAsync(argv, { timeoutMs: 120_000, collectStderr: true });
  return parseSelectorOutput(r.stdout, candidates, r.error ? null : r.status, r.stderr.trim() || null);
}

// ── Layer 1b · routine（routines / schedule / collect / report）────────────────────────────────────
// outer-kind（AC143 承接，吸收 outer 的纯机械 A/B 段）继承 Layer 0 + 1b。⛔ 它没有候选池、没有任务
// 选择、没有「spawn 执行者再复核其自述」——它的单元是【例程】不是【任务】，产出是【读数】不是
// 【任务终态】。硬塞进 1a 会迫使它实现三个空段（source/select/verify），那正是 AC151 取假① 说的架构错误。

/** 一条例程的产出（读数）。state=not-evaluated 表示读不到输入（⛔ 与「合格」不同形，硬规则 3b）。 */
export interface Fact<T = unknown> {
  name: string;
  value: T;
  state: "verified" | "not-evaluated" | "failed";
  reason: string | null;
}

/** 一条例程本轮可读的控制面上下文。halted=true ⇒ 本轮【不做受闸动作（spawn）】，但机械读数照跑
 *  （gap-drain-on-routine-driver-empties-round-and-respawn-loops：halt 是轮内的闸，⛔ 不是进程的
 *  终止条件——旧的 break 让例程型 driver 每 5s 起停一次）。 */
export interface RoutineRunContext {
  halted: boolean;
}

/** 一条例程（name + schedule 判定 + run(ctx) → Facts[]）。ctx 可选——不读 halt 的例程定义无需该参数；
 *  需按 halt 挡 spawn 的例程用 ctx.halted（只挡动作，不挡观测）。 */
export interface RoutineSpec {
  name: string;
  schedule: Parameters<typeof isDue>[0];
  run(ctx?: RoutineRunContext): Fact[] | Promise<Fact[]>;
}

/** schedule（Layer 1b）：复用 routine-scheduler.ts 的判定函数，⛔ 不新造定时器。 */
export const scheduleIsDue = isDue;

/** collect（Layer 1b）：汇集例程的 Facts（⛔ 一个例程读不到输入 ⇒ not-evaluated Fact，不静默丢弃）。 */
export function collectFacts(routines: readonly RoutineSpec[]): Promise<Fact[]> {
  return Promise.all(routines.map(async (r) => (await r.run()) as Fact[])).then((all) => all.flat());
}

/** report（Layer 1b）：经 Layer 0 notify 上报 Facts（manager 不主动读载体也能被叫醒）。 */
export function reportFacts(
  root: string,
  facts: readonly Fact[],
  managerPid: number,
  token: string,
): { ok: boolean; error: string | null } {
  const message = JSON.stringify({ kind: "routine-report", facts });
  return notifyManager({ root, pid: managerPid, token, message });
}

// ── Layer 0 · 源码自刷新（source-refresh，AC-184 陈旧写者收尾）────────────────────────────────────
// AC-184 失败：常驻 promotion/worker driver 早于 driver-filters.ts 最近一次提交启动，仍在写旧格式的
// sync/filter 代码——进程载入内存后不再感知源码变更。supervisor 逐轮对照「被监视源码最新 mtime」与
// 「当前 driver 进程启动时刻」：源码推进到启动时刻之后 ⇒ SIGTERM driver 触发 respawn——复用既有的
// exit→respawn 循环（⛔ 不新建并行重启机制），driver 以新进程重新 import 全部依赖（driver-filters 的
// sync/filter 单一实现随之刷新）。判据取假（DoD）：关掉这个对照 ⇒ 源码变更后 driver 永不自愈 ⇒ 测试红。

/** 被监视的共享源码（相对 <root>/plugin/scripts/）：driver 自身入口 + 两 driver 共用、会独立于重启
 *  而变更的 Layer 0/1a 模块。driver-filters.ts 是 AC-184 的根（sync/filter 单一实现）；driver-runtime.ts
 *  （kernel）与 driver-result/shared/config 同族——driver 启动时一次性 import，任一变更 ⇒ 常驻进程陈旧。 */
const SHARED_SOURCE_FILES: readonly string[] = [
  "driver-filters.ts",
  "driver-runtime.ts",
  "driver-result.ts",
  "driver-shared.ts",
  "driver-config.ts",
  // AC-255（SPEC §7 阶段 C）：anchor 是收敛形态的**宿主**，它的源码推进必须同样触发自刷新
  // （否则改 anchor 自己 = 改了没人重启 —— 与 AC-184 对其它内核文件的处理同形）。
  "driver-anchor.ts",
];

/** 一个 kind 的 driver 进程须监视的源码文件（相对 <root>/plugin/scripts/）。 */
export function watchedSourceFiles(kind: DriverKind): string[] {
  return [DRIVER_KINDS[kind].driver, ...SHARED_SOURCE_FILES];
}

/** 一个目录里被监视文件的最新 mtime（mtimeMs 的 max）；一个都 stat 不到 ⇒ 0。 */
function watchedMax(dir: string, kind: DriverKind): number {
  let max = 0;
  for (const rel of watchedSourceFiles(kind)) {
    try {
      const st = fs.statSync(path.join(dir, rel));
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch { /* 缺失 → 跳过 */ }
  }
  return max;
}

// ── Layer 0 · 内核源树 / 源码监视三态（gap-ac259-frozen-reading-stale-staging-kernel）──────────────
// 缺陷（2026-09-15 实测）：本仓库自宿主 anchor 的 cmdline 是
//   <repo>/packages/quay/plugin/scripts/dist/driver-anchor.js __anchor --root <repo>
// 而 `packages/quay/plugin/` 是 **pack-time 暂存快照**（`.gitignore` 忽略、`git ls-files` 0 条，由
// `package.sh` 从 `<repo>/plugin/` 拷出），它的 `.ts` 源在 `<repo>/plugin/scripts/`。旧读法只看
// `resolveKernelScriptsDir()`（= 那个 dist 目录，里面只有 `.js`）⇒ 每个被监视 `.ts` 都 stat 抛错 ⇒
// `max` **恒 0** ⇒「源码从未推进」与「没有源码可推进」同形（硬规则 3b）⇒ 07:35 构建的 bundle 上跑着的
// 内核永远不知道自己陈旧：10:17 落地的修复从未执行，且**重启也不换版本**（重启后仍是那个 dist 目录）。
// ⛔ 这与「装好的 bundle 是静态的」不是一回事：装好的产物盘上**没有**源树（下面 fail-closed 返 null，
// 行为与今天逐字相同）；暂存快照**有**源树，它只是从来没被看见过。

/** 本内核所【构建自】的源树 scripts 目录；本内核自己就是源树 / 找不到源树 ⇒ null。
 *
 *  唯一候选：`<主检出>/<本内核 plugin 树同名>/scripts`。基准是**本内核自身安装位置**的主检出
 *  （`mainCheckoutRoot`，git 推导；非 git 夹具退回 `repoRoot` 的 bundle 形态判定），⛔ 不是 `--root`
 *  （工作区）——「把 quay 自己的资源拼在 target root 下」正是 AC-203 / gap-drivers-resolve-quay-scripts-
 *  under-project-root-not-plugin-root 的缺陷形。⛔ 布局段取**本内核 plugin 树的 basename**，不写死
 *  `"plugin"` 字面量：driver 域的布局锚点由 kernel-sibling-resolution-check 的 DRIVER-SCOPE 规则判红，
 *  且取 basename 对改名/打平后的布局同样成立。
 *  ⛔ fail-closed（宁可「看不见源树」= 今天的行为）：候选必须真的**是源树**（≥2 个被监视文件在位）且
 *  不是本内核自己的目录，否则 null —— 不把某个碰巧同名的目录当成源树。
 *  ⛔ 基准只用 `mainCheckoutRoot`（git 推导），⛔ **不用 `repoRoot`**：后者的兜底是 `process.cwd()`，
 *  于是一个从 quay 检出目录里起来的**装好的**内核会把 cwd 误当仓库根、把 `<cwd>/plugin/scripts` 当成
 *  自己的源树（硬规则 5b：一处成立不等于处处成立；宁可「看不见源树」= 今天的行为）。
 *  结果按**内核目录**记忆（内核的源树在一次进程生存期内不会搬家；`mainCheckoutRoot` 每次要 spawn git；
 *  按内核目录而非全局单值 ⇒ 同进程里换夹具/换内核目录仍各算各的）。 */
const _kernelSourceScriptsDirCache = new Map<string, string | null>();
export function kernelSourceScriptsDir(): string | null {
  const dir = resolveKernelScriptsDir();
  const cached = _kernelSourceScriptsDirCache.get(dir);
  if (cached !== undefined) return cached;
  const out = ((): string | null => {
    // 本内核自己的目录里就有被监视源码 ⇒ 它跑在源树上，「源树」就是它自己（无镜像）。
    if (SHARED_SOURCE_FILES.some((rel) => fs.existsSync(path.join(dir, rel)))) return null;
    let root = "";
    try { root = mainCheckoutRoot(dir); } catch { root = ""; }
    if (!root || !fs.existsSync(root)) return null;
    const cand = path.join(root, path.basename(resolveKernelPluginRoot()), "scripts");
    if (path.resolve(cand) === path.resolve(dir)) return null;
    const hits = SHARED_SOURCE_FILES.filter((rel) => fs.existsSync(path.join(cand, rel))).length;
    return hits >= 2 ? cand : null;
  })();
  _kernelSourceScriptsDirCache.set(dir, out);
  return out;
}

/** 被监视源码的解析结果（三态）。⛔ 存在的理由就是让「源码没推进」与「根本没有源码可推进 / 跑的是
 *  一份构建产物」在读数上**可区分**——此前两者共用那个恒 0 的 `max`。 */
export interface SourceWatch {
  /** watched   = 本内核目录里就能 stat 到被监视 `.ts`（dev 源树直跑的内核）；
   *  mirror    = 本内核目录里一个都没有，但它的**源树**里有 ⇒ 本内核是一份**构建产物**
   *              （dist bundle / 暂存拷贝），`dir`/`mtimeMs` 指向源树；
   *  unwatched = 两处都没有（装好的产物：盘上没有源可推进）。 */
  state: "watched" | "mirror" | "unwatched";
  /** 实际求值的目录（本内核目录，或它的源树目录）。 */
  dir: string;
  /** 该目录里被监视 `.ts` 的最新 mtime（epoch ms）。unwatched ⇒ 0，由 `state` 区分取值含义。 */
  mtimeMs: number;
}

/** 被监视源码的解析（`watched` / `mirror` / `unwatched`）。基准同 `sourceFilesMaxMtimeMs`（内核自身
 *  安装位置，⛔ 非 `--root`）。 */
export function sourceWatch(root: string, kind: DriverKind): SourceWatch {
  void root; // 参数保留（既有调用方/测试按 (root, kind) 传参）；基准是内核自身安装位置。
  const dir = resolveKernelScriptsDir();
  const own = watchedMax(dir, kind);
  if (own > 0) return { state: "watched", dir, mtimeMs: own };
  const src = kernelSourceScriptsDir();
  if (src) return { state: "mirror", dir: src, mtimeMs: watchedMax(src, kind) };
  return { state: "unwatched", dir, mtimeMs: 0 };
}

/** 被监视源码的最新 mtime（mtimeMs 的 max）。全部缺失/读失败 ⇒ 0。
 *  源码目录锚在本 kernel 自身安装位置（⛔ 非 root —— AC-203）；本内核自己目录里没有原始 `.ts` 时
 *  退回它的**源树**（见 `sourceWatch`）—— 跑在构建产物上的内核必须拿源树的 mtime 比，⛔ 不是恒 0。 */
export function sourceFilesMaxMtimeMs(root: string, kind: DriverKind): number {
  return sourceWatch(root, kind).mtimeMs;
}

/** 源码是否推进到 sinceMs 之后（任一被监视文件 mtimeMs > sinceMs ⇒ true）。纯函数，可单测。
 *  ⚠️ unwatched（无源可推进）⇒ 恒 false；调用方若要区分「未推进」与「无源」，读 `sourceWatch().state`。 */
export function sourceChangedSince(root: string, kind: DriverKind, sinceMs: number): boolean {
  return sourceFilesMaxMtimeMs(root, kind) > sinceMs;
}

// ── Layer 0 · supervisor 陈旧判定（gap-supervisor-never-self-refreshes-no-detector）────────────────
// 源码自刷新（AC-184）住在 supervisor 的 sourceCheck 里，`:958` 杀的是 child——【只有 driver】，从不
// 包括 supervisor 自己。supervisor 是常驻前台进程（runSupervisor `:967` 永不 resolve），它内存里的
// kernel 是启动那一刻的版本、此后永不刷新；而 driver-runtime.ts 本身就在 SHARED_SOURCE_FILES 里——改它
// 会重启 driver，却改不动持有该逻辑的 supervisor。两个后果：① 早于该功能启动的 supervisor 连刷新循环
// 都没有 ⇒ 其 driver 永不自愈（实测 quality 跑 2 天 8 小时陈旧代码）；② supervisor 半边的任何改动对在跑
// 的 supervisor 静默无效。本段新增一个【直接量】：supervisor 进程启动时刻 vs 被监视源码最新 mtime，
// 陈旧即报进 aliveness()/status；读不到启动时刻 ⇒ not-evaluated（⛔ 与「新鲜」同形，硬规则 3b/4b）。

/** 读 /proc/<pid>/stat 的 starttime（field 22，USER_HZ 时钟 tick 数，自 boot 起）。读失败/非负非法
 *  ⇒ null。偏移与 supervisor-observe.sh 的 stat_fields 一致：rfind(")") 后 split，fields[0]=state
 *  （field 3）… fields[19]=starttime（field 22）。 */
function procStartTicks(pidOrSelf: number | "self"): number | null {
  try {
    const stat = fs.readFileSync(pidOrSelf === "self" ? "/proc/self/stat" : `/proc/${pidOrSelf}/stat`, "utf8");
    const idx = stat.lastIndexOf(")");
    if (idx < 0) return null;
    const fields = stat.slice(idx + 2).trim().split(/\s+/);
    const ticks = Number(fields[19]);
    return Number.isFinite(ticks) && ticks >= 0 ? ticks : null;
  } catch {
    return null;
  }
}

/** /proc/uptime 第一字段（系统 BOOTTIME 秒，float，亚秒精度）。读失败/非法 ⇒ null。 */
function systemUptimeSeconds(): number | null {
  try {
    const n = Number(fs.readFileSync("/proc/uptime", "utf8").trim().split(/\s+/)[0]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

let _clkTck: number | null = null;

/** sysconf(_SC_CLK_TCK)——USER_HZ，/proc/<pid>/stat starttime 的 tick 单位（tick/秒）。Node 无 sysconf
 *  绑定，从本进程自身 /proc/self/stat starttime 与 /proc/uptime 推导（两读数独立于任何目标 pid、都读
 *  宿主——⛔ 不写死宿主依赖字面量，硬规则 4 推论二）：selfTicks / (systemUptime − nodeUptime) = tick/秒。
 *  推导失败（/proc 缺失/进程初起 elapsed≤1s 噪声大）⇒ 回退 100（Linux x86_64/arm64 的 USER_HZ）。 */
function clockTicksPerSecond(): number {
  if (_clkTck !== null) return _clkTck;
  try {
    const selfTicks = procStartTicks("self");
    const uptime = systemUptimeSeconds();
    const elapsed = uptime != null ? uptime - process.uptime() : null; // boot → 本进程 exec 的秒数（按 kernel 时钟）
    if (selfTicks !== null && elapsed != null && elapsed > 1) {
      const clk = selfTicks / elapsed;
      if (Number.isFinite(clk) && clk > 0) {
        _clkTck = clk;
        return clk;
      }
    }
  } catch { /* fall through to fallback */ }
  _clkTck = 100;
  return _clkTck;
}

/** 进程启动时刻（epoch ms）。读不到 /proc 或 uptime ⇒ null（= not-evaluated，⛔ 不是「新鲜」）。
 *  ⛔ 不用 /proc/stat 的 btime（整数秒，丢掉 boot 的小数秒 ⇒ 进程启动时刻系统性偏早最多 ~1s，实测
 *  ~318ms，会把「刚启动的 supervisor」误判为陈旧——gap-supervisor-never-self-refreshes-no-detector）：
 *  改用 Date.now()（REALTIME 现在）− (uptime − starttime/CLK_TCK)（BOOTTIME 自进程启动以来经过的
 *  秒数），两者都有亚秒精度，⛔ 不引 btime 截断误差。 */
export function procStartTimeMs(pid: number): number | null {
  const ticks = procStartTicks(pid);
  const uptime = systemUptimeSeconds();
  if (ticks === null || uptime === null) return null;
  const elapsedMs = (uptime - ticks / clockTicksPerSecond()) * 1000;
  return Math.round(Date.now() - elapsedMs);
}

/** supervisor 陈旧判定结果。state=not-evaluated 表示读不到 supervisor 进程启动时刻（⛔ 与「新鲜」同形，
 *  硬规则 3b/4b——「跑着旧代码的 supervisor」与「健康 supervisor」必须在读数上可区分）。 */
export interface SupervisorStaleness {
  state: "fresh" | "stale" | "not-evaluated";
  /** supervisor 进程启动时刻（epoch ms）；读不到 ⇒ null。 */
  supervisorStartedAt: number | null;
  /** 被监视源码最新 mtime（epoch ms；unwatched ⇒ 0，见 `sourceWatch`）。 */
  sourceMtimeMs: number;
  /** 被监视源码的解析态（gap-ac259-frozen-reading-stale-staging-kernel）：`watched`（本内核目录里
   *  就有 .ts）/ `mirror`（本内核是构建产物，比的是它的**源树**）/ `unwatched`（盘上没有源可推进，
   *  装好的产物）。⛔ 独立取值：`fresh` 在 `unwatched` 下说的是「无源可推进」、在 `watched`/`mirror`
   *  下说的是「源码未推进」——两者必须可区分（硬规则 3b）。 */
  sourceWatch: SourceWatch["state"];
  /** 实际被求值的目录（`sourceWatch` 选中的那个；unwatched 时 = 本内核自己的目录）。 */
  sourceWatchDir: string;
}

/** 判定一个 supervisor 是否陈旧：supervisor 启动时刻 vs 被监视源码最新 mtime。源码推进到启动时刻之后
 *  ⇒ stale（supervisor 内存里的 kernel 早于盘上源码，sourceCheck 只重启 driver、永远改不动它自己）。
 *  supervisor pid 缺失/已死/读不到启动时刻 ⇒ not-evaluated。
 *
 *  ⚠️ 对被监视源码的解析走 `sourceWatch`：本内核是**构建产物**（dist bundle / pack-time 暂存拷贝）时
 *  比的是它的**源树**的 mtime —— 这正是 2026-09-15 的缺陷形：暂存树里只有 `.js`，旧的「只看自己
 *  目录」读法恒得 0，于是跑在 07:35 bundle 上、而源树已在 10:17 前进的常驻内核被报 `fresh`
 *  （与「一切正常」同形）。`sourceWatch` 把该形态报成 `mirror` 并给出真读数 ⇒ 该内核报 **stale**。 */
export function supervisorStaleness(
  root: string,
  kind: DriverKind,
  supervisorPid: number | null,
): SupervisorStaleness {
  const watch = sourceWatch(root, kind);
  const base = { sourceMtimeMs: watch.mtimeMs, sourceWatch: watch.state, sourceWatchDir: watch.dir };
  if (supervisorPid === null || !pidAlive(supervisorPid)) {
    return { state: "not-evaluated", supervisorStartedAt: null, ...base };
  }
  const supervisorStartedAt = procStartTimeMs(supervisorPid);
  if (supervisorStartedAt === null) {
    return { state: "not-evaluated", supervisorStartedAt: null, ...base };
  }
  return {
    state: watch.mtimeMs > supervisorStartedAt ? "stale" : "fresh",
    supervisorStartedAt,
    ...base,
  };
}

// ── Layer 0 · 已加载内核版本 vs 已安装版本（gap-driver-status-loaded-vs-installed-version-drift）──────
//
// 缺陷（2026-09-23 生产实测，claudecodeui）：`status` 的新鲜度判定（`supervisor_stale` / `source_watch`）
// 求值的是**执行 status 命令的那个内核自己的目录**（`sourceWatch` 的基准是 `resolveKernelScriptsDir()`），
// ⛔ 不是**正在运行的 anchor 实际加载的目录**。实测：pid 2166980 自 2026-09-20 10:28 起跑
// `…/cache/quay/quay/0.10.0/scripts/dist/driver-anchor.js`，而插件已装 0.11.0；用 0.11.0 的 kernel 读
// 出 `supervisor_stale="fresh"`、`source_watch="unwatched"`——**一个落后 3 天的进程被报成 fresh**
// （硬规则 3b：读错了对象 ⇒ 读数与「合格」同形）。上游 `caeca6f9c`（2026-09-20 17:14，晚于 0.10.0
// cache 的构建时刻 10:18）因此在 claudecodeui 整整 3 天未生效，而没有任何读数能显示这一点。
// 第二个漂移源：`.quay/config.yml` 的 provider `path` 写的是**安装当时**的 cache 版本目录，升级后不变。
// 第三个漂移源（gap-path-resolved-quay-version-not-in-driver-status）：**执行 `quay` 命令时 PATH 实际
// 命中的是哪一版**。2026-10-05 生产实测：本机 PATH 里冻结着 `cache/quay/quay/0.11.0/bin`，`which -a quay`
// 第一项是 0.11.0，而注册表已是 0.14.0——人敲 `quay ...` 跑的是 0.11.0，而前两个量都不回答这一点
// （`loaded_version` 问的是常驻 anchor 加载了哪版，`config_provider_path` 问的是配置里 provider 指向哪版）。
//
// 读法（硬规则 4b：用**外部可核**的直接量，⛔ 不用被测对象自报的心跳/派生计数）：
//   · 「运行中进程实际加载了哪份内核」—— `/proc/<pid>/cmdline`（进程自己的 exec 实参，外部可核）。
//     ⛔ 只有当 cmdline 读不出内核实参时，才退回 anchor 的**回读面** `.quay/anchor.json.bundle.kernel`
//     （每个 reconcile pass 重写；它是 anchor 对**自己**内核路径的自报 = second-best）——哪一种来源被
//     采信由 `loadedKernelSource` 单列，⛔ 不把两者混成同一个读数。
//   · 「当前已安装版本」—— `~/.claude/plugins/installed_plugins.json` 里 `quay@quay` 的**最高**版本条目
//     （附安装时刻 `installedAt`/`lastUpdated`）；注册表读不到时退回**本内核自己的 `VERSION` 文件**。
//   · 「PATH 命中的那一版」—— `command -v quay` 的 realpath 所在**版本目录的 `VERSION` 文件**
//     （⛔ 不 exec `quay --version`——它受 bundle 内嵌版本影响，见 gap-release-bundle-embeds-dev-version-
//     after-stamp）；与注册表所选条目比较，给 `path_quay_version`。找不到 quay / 推不出版本 / 注册表读不出
//     ⇒ 一律 `not-evaluated`（⛔ 不与 `current` 同形）。
//   · 两个版本都拿到才判；任一读不到 ⇒ `not-evaluated`（⛔ 不与 `current` 同形）。
//   ⛔ 都只报，⛔ **不自动重启**（重启时机由人或 manager 决定）；`behind` 的人可读形态给出 `quay driver
//     restart` 的提示。
//
// 与 `sourceWatch`/`supervisorStaleness` 的分工（⛔ 不是同一条判据的两种写法）：
//   · `supervisor_stale` 比的是【本内核目录里的源码 mtime vs 宿主进程启动时刻】——它对**装好的产物**
//     恒报 `unwatched`+fresh（盘上没有源可推进），这正是本缺陷静默的形态；
//   · 本条比的是【宿主进程**实际加载的**内核版本 vs 已安装版本】——装好的产物上只有它能取假。
//   两者都保留：前者回答「我改的源码进了那个进程没有」，后者回答「那个进程跑的是不是装好的那版」。

// `LoadedVersionState` / `VersionRelation` / `LoadedVersionReading` 三者（以及下文的
// `compareVersions` / `readVersionFile` / `versionOfLoadedScript` / `installedVersionFromRegistry` /
// `providerPathVersions` / `configProviderPathReading` / `loadedScriptFromCmdline`）的**唯一实现**在
// `packages/quay/src/loaded-version.ts`（见文件顶部那一节 import 的 WHY）。本文件此处只保留**内核
// 特有**的那几件：PATH 命中读数、`.quay/plugin` 指引链接读数、以及「哪一段 cmdline 算内核」的 probe。

/** 「执行 `quay` 命令时 PATH 实际命中的是哪一版」的完整读数（见本区第三漂移源的注释）。
 *  ⛔ 三种「读不到」各自 ⇒ `state:"not-evaluated"` + 非空 `reason`（硬规则 3b：读不到不得伪装成
 *  `current`）：① PATH 上找不到 quay；② 命中但推不出版本；③ 注册表读不出（比较基准缺失）。
 *  ⛔ 每一格都有独立取值（`path`/`version` 的 `null` 与 `reason`），⛔ 不与「一致」同形。 */
export interface PathQuayVersionReading {
  state: LoadedVersionState;
  /** PATH 上第一个 `quay` 的 realpath（`readlink -f` 的等价物；找不到 / 解析不出 ⇒ null）。 */
  path: string | null;
  /** 从 `path` 推出的版本（⛔ 从该版本目录的 `VERSION` 文件，⛔ 不 exec `quay --version`；读不出 ⇒ null）。 */
  version: string | null;
  /** `path` 的版本 vs 注册表已安装版本的方向（`loaded-older` = PATH quay 更旧）。 */
  relation: VersionRelation;
  /** `not-evaluated` 的原因（⛔ 读不出时必须给，⛔ 不得为空——空读不出与「没问题」同形）。 */
  reason: string | null;
}

/** 「已加载内核版本 vs 已安装版本」的判定（见本节头注释）。**实现只有一份**（上面 import 的那一节）：
 *  本函数只提供**内核特有**的那两件 —— 从 cmdline 里认内核脚本，以及 cmdline 认不出时退回 anchor
 *  每个 reconcile pass 重写的回读面 `.quay/anchor.json.bundle.kernel`（第二来源，由 `source` 单列）。
 *
 *  `hostPid` = 承载本工作区驱动循环的**宿主进程**（收敛形态 = anchor；旧形态 = supervisor）——
 *  调用方从 `aliveness()` 传（`a.host === "anchor" ? a.anchorPid : a.supervisorPid`）。
 *  `opts.homeDir` / `opts.selfVersion` 是 hermetic 测试缝（缺省 = 真 HOME / 本内核 plugin root 的
 *  `VERSION`）——⛔ 生产调用方不传。 */
export function loadedVersionReading(
  root: string,
  hostPid: number | null,
  opts: { homeDir?: string; selfVersion?: string | null } = {},
): LoadedVersionReading {
  return loadedVersionReadingForHost(root, hostPid, DRIVER_HOST_PROBE, {
    ...opts,
    // 注册表读不出时的第二来源 = **本内核自己** plugin root 的版本记录（惰性：Core 侧只在需要时才调）。
    selfVersionResolver: () => readVersionOfDirectory(resolveKernelPluginRoot()),
  });
}

/** anchor/supervisor 的 probe：cmdline 里认内核脚本（`pickKernelScript`），认不出时退回 anchor 的
 *  回读面 —— ⛔ 只认**同一个 pid** 的回读面（换代/残留的回读面不得冒充）。serve 宿主没有这一层
 *  （它不写「我加载了哪个脚本」的回读面），故 `SERVE_HOST_PROBE` 只有前半。 */
const DRIVER_HOST_PROBE = {
  noun: DRIVER_HOST_NOUN,
  pick: pickKernelScript,
  fallback(root: string, hostPid: number): { script: string; source: "anchor-state" } | null {
    if (readAnchorPid(root) !== hostPid) return null;
    const b = readAnchorBundleReading(root);
    return b?.kernel ? { script: b.kernel, source: "anchor-state" as const } : null;
  },
};

/** PATH 上第一个 `quay` 的 realpath（`command -v quay` + `readlink -f` 的等价物；⛔ 不 shell out、
 *  ⛔ 不 exec quay 自己）。逐个 PATH 目录找**存在的普通文件** `<dir>/quay`，取第一个。
 *  ⛔ 一个都找不到 ⇒ null；命中了但 realpath 解析失败 ⇒ null（= 读不懂，⛔ 不退回字面路径猜，
 *  硬规则 3b：读不到不得伪装成「命中且合格」）。 */
export function pathResolvedQuay(opts: { pathEnv?: string } = {}): string | null {
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (dir === "") continue;
    const cand = path.join(dir, "quay");
    try {
      // ⛔ 必须是普通文件：一个名为 `quay` 的目录不是 `command -v quay` 会命中的东西。
      if (!fs.statSync(cand).isFile()) continue;
    } catch {
      continue; // 不存在 / stat 失败 ⇒ 这一条不算命中
    }
    try {
      return fs.realpathSync(cand);
    } catch {
      return null; // 命中了但解析不出真实路径 ⇒ 读不懂
    }
  }
  return null;
}

/** 「PATH 命中的 quay 是哪一版」的判定（见本区第三漂移源的注释）。
 *
 *  取 PATH 上第一个 `quay` 的 realpath（`pathResolvedQuay`），从**该版本目录的 `VERSION` 文件**读版本
 *  （⛔ 不 exec `quay --version` —— 它受 bundle 内嵌版本影响，见 gap-release-bundle-embeds-dev-version-
 *  after-stamp），与**注册表所选条目**比较，给 `current`/`behind`/`ahead`/`not-evaluated`。
 *  ⛔ 只报，⛔ 不自动修复 PATH（人敲 `quay ...` 跑的是哪一版，由人选 PATH 决定）。
 *
 *  `opts.homeDir` / `opts.pathEnv` / `opts.quayPath` 是 hermetic 测试缝（缺省 = 真 HOME / 真 PATH /
 *  自己解析 PATH quay）——⛔ 生产调用方不传。`quayPath` 显式给 `null` 时表示「PATH 上没有 quay」。 */
export function pathQuayVersionReading(
  opts: { homeDir?: string; pathEnv?: string; quayPath?: string | null } = {},
): PathQuayVersionReading {
  const homeDir = opts.homeDir ?? process.env.HOME ?? os.homedir();
  const realpath = opts.quayPath !== undefined ? opts.quayPath : pathResolvedQuay({ pathEnv: opts.pathEnv });
  if (realpath === null) {
    return {
      state: "not-evaluated",
      path: null,
      version: null,
      relation: "not-evaluated",
      reason: "no `quay` executable found on PATH",
    };
  }
  const version = versionOfLoadedScript(realpath);
  if (version === null) {
    return {
      state: "not-evaluated",
      path: realpath,
      version: null,
      relation: "not-evaluated",
      reason: `cannot derive a version from the PATH-resolved quay (${realpath})`,
    };
  }
  const reg = installedVersionFromRegistry(homeDir);
  if (reg === null) {
    return {
      state: "not-evaluated",
      path: realpath,
      version,
      relation: "not-evaluated",
      reason: "cannot determine the installed version (installed_plugins.json unreadable) — no baseline to compare the PATH quay against",
    };
  }
  const c = compareVersions(version, reg.version);
  const relation: VersionRelation =
    c === null ? (version === reg.version ? "equal" : "not-evaluated") : c === 0 ? "equal" : c < 0 ? "loaded-older" : "loaded-newer";
  const state: LoadedVersionState =
    relation === "equal" ? "current" : relation === "loaded-older" ? "behind" : relation === "loaded-newer" ? "ahead" : "not-evaluated";
  return { state, path: realpath, version, relation, reason: null };
}

/** 一个插件根目录的版本：`VERSION` 文件，读不到时退回 `.claude-plugin/plugin.json` 的 `version`。
 *  ⛔ 不用 `quay --version` 输出 —— bundle 内嵌的是 dev 版本（gap-release-bundle-embeds-dev-version-
 *  after-stamp），那是另一个量。
 *  ⚠️ 「从一个目录读版本记录」这件事实**只有一份实现**（Core `loaded-version.ts:readVersionOfDirectory`）
 *  —— 本函数只是它在本文件的入口名，⛔ 不是第二份读法（硬规则 5b）。两条记录在本仓库与 cache 布局上
 *  恒相等（`plugin/VERSION` == `plugin/.claude-plugin/plugin.json`），故优先级的差别取不到假。 */
export function pluginRootVersion(dir: string | null): string | null {
  return dir === null ? null : readVersionOfDirectory(dir);
}

/** `driver status` 的 `pointer` 读数：Core 自身所在插件根 vs 项目指引链接 `.quay/plugin` 的版本关系
 *  （gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it (B)）。
 *
 *  语义（⛔ 四态，`not-evaluated` 与 `current` 不同形）：`current` 链接与 Core 同版本；`behind` 链接
 *  落后于 Core（`/quay:init` 之后插件升过级）；`ahead` 链接比 Core 新（Core 是旧 checkout）；
 *  `not-evaluated` 链接缺失 / 目标无 plugin.json / Core 版本读不到。
 *  Core ⛔ 任何路径都不写这个链接（多版本会话并存时运行期刷新会互相覆盖），只报漂移。 */
export interface PointerReading {
  state: LoadedVersionState;
  coreVersion: string | null;
  coreRoot: string | null;
  linkTarget: string | null;
  linkVersion: string | null;
  reason: string | null;
}

export function pointerReading(root: string, opts: { coreRoot?: string | null } = {}): PointerReading {
  const coreRoot = opts.coreRoot !== undefined ? opts.coreRoot : resolveKernelPluginRoot();
  const coreVersion = pluginRootVersion(coreRoot);
  const linkPath = path.join(root, ".quay", "plugin");
  let linkTarget: string | null = null;
  try {
    if (fs.lstatSync(linkPath).isSymbolicLink()) linkTarget = fs.readlinkSync(linkPath);
  } catch {
    linkTarget = null;
  }
  const linkVersion = linkTarget === null ? null : pluginRootVersion(linkTarget);
  const base = { coreVersion, coreRoot, linkTarget, linkVersion };
  if (linkTarget === null) {
    return { state: "not-evaluated", ...base, reason: `no .quay/plugin symlink in ${root}` };
  }
  if (linkVersion === null) {
    return { state: "not-evaluated", ...base, reason: `the .quay/plugin target (${linkTarget}) carries no plugin.json version` };
  }
  if (coreVersion === null) {
    return { state: "not-evaluated", ...base, reason: "cannot read this Core plugin root's version" };
  }
  const c = compareVersions(coreVersion, linkVersion);
  const state: LoadedVersionState =
    c === null ? (coreVersion === linkVersion ? "current" : "not-evaluated") : c === 0 ? "current" : c > 0 ? "behind" : "ahead";
  return { state, ...base, reason: null };
}

// ── Layer 0 · supervisor（respawn / pid 记账 / stop sentinel，由 promotion-driver-launch.sh 港进）────
// 仓库里只此一份 respawn 循环；kind 差异由 DRIVER_KINDS 数据表驱动（⛔ 非两份代码分支）。

/** supervisor 的完整运行态（__supervise 模式的前台进程里运行）。 */
export interface SupervisorOptions {
  root: string;
  kind: DriverKind;
  cap?: string;
  interval?: string;
  reconcileInterval?: string;
  /** 崩溃退避（秒）——driver 进程【非正常终止】后的重启间隔，⛔ 不是轮询节奏。
   *  正常节奏由 driver 自身常驻循环按 `drivers.yml <kind>.interval_ms`（或 `--interval`）决定，
   *  例程型（goal/quality/meta/outer）与任务型（promotion/worker）是同一分工。两者混淆会产出
   *  「drivers.yml 声明 30s、实际每 5s 一轮」的读数
   *  （gap-drivers-yml-interval-not-honored-for-routine-kinds）。 */
  restartDelaySecs: number;
  runId: string;
}

/** respawn 循环（run_supervisor 港进）：spawn driver →（⛔ 只替【不自写】的 kind 写 driver pid）→ wait →
 *  stop sentinel 则退出，否则 sleep restartDelaySecs 后重拉。每次重拉写一条 supervisor 事件。
 *
 *  ⚠️ driver pid 文件的**写者**决定了它读数的含义（见 aliveness 与 startKind 的头注释）：
 *  `pidSelf=true` 的 kind，写者是【驱动自己】（进入常驻循环后写 --pid-file）⇒ 该文件是「已就绪」；
 *  supervisor 在 spawn 时抢先写同一个文件会把「刚 spawn 出来」伪装成「已就绪」
 *  （gap-driver-start-false-confirms-unsettled-driver 的根因）。 */
export async function runSupervisor(opts: SupervisorOptions): Promise<number> {
  const spec = DRIVER_KINDS[opts.kind];
  const st = statePaths(opts.root, opts.kind);
  const driverSibling = resolveKernelSibling(spec.driver);
  if (!driverSibling) {
    process.stderr.write(`driver-runtime: driver not found at ${path.join(resolveKernelScriptsDir(), spec.driver)}\n`);
    return 2;
  }
  fs.mkdirSync(path.join(opts.root, ".quay"), { recursive: true });

  // ── Layer 0 · 控制面（SPEC §7 阶段 A1 / AC-252）：六个 kind 全部从本共享骨架获得入站控制面 ────────
  // 宿主 = supervisor 进程本身（Layer 0；本文件头注释的 Layer 0 清单第 7 项「controlPlane MCP」）。
  // 端口由内核分配（serveKindControlPlane 缺省 port:0）⇒ 六个 kind 各起一个也不互撞；**实际端口**回写
  // supervisor 日志（可观测面，便于逐 kind 回读 URL/端口）。
  // 生命周期随宿主进程：SIGTERM/SIGINT / stop sentinel 退出即释放 listener，⛔ 不留孤儿 listener。
  // 起不来（SDK 缺失 / 端口耗尽）⇒ 如实记一条 error 行，⛔ 不静默——「控制面缺席」必须与「在跑」可区分
  // （硬规则 3b；这也让 AC2/AC6 的读数能取假）。
  let controlPlane: ControlPlaneHandle | null = null;
  const controlPlaneRel = path.posix.join(".quay", spec.controlFile);
  try {
    controlPlane = await serveKindControlPlane(opts.kind, opts.root);
    // 结构化运行时回读面（statePaths().controlPlaneFile）+ 人读日志一行。两者都写：日志是时间线，
    // JSON 是逐 kind 回读的机器面（AC2/AC6）。
    try {
      fs.writeFileSync(
        st.controlPlaneFile,
        JSON.stringify({ kind: opts.kind, url: controlPlane.url, port: controlPlane.port, pid: process.pid, rel: controlPlaneRel, at: ts() }) + "\n",
        "utf8",
      );
    } catch { /* 回读面写失败不致命；上面的日志行仍在 */ }
    appendLog(
      st.supervisorLog,
      `${ts()} supervisor: control plane kind=${opts.kind} listening at ${controlPlane.url} (port=${controlPlane.port}, rel=${controlPlaneRel})`,
    );
  } catch (e) {
    appendLog(
      st.supervisorLog,
      `${ts()} supervisor: control plane start FAILED for kind=${opts.kind} (rel=${controlPlaneRel}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const closeControlPlane = (): void => {
    if (!controlPlane) return;
    const h = controlPlane;
    controlPlane = null;
    // 退出即摘掉回读面：留下的 JSON 会让「控制面在跑」与「已经停了」同形（硬规则 3b）。
    try { fs.rmSync(st.controlPlaneFile, { force: true }); } catch { /* ignore */ }
    try { void h.close(); } catch { /* 进程即将退出，listener 随 fd 释放 */ }
  };

  // AC155：worker 并发缺省不再经 env 注入 QUAY_MAX_TASK_SUBAGENTS="5"（旧第三份并发真相源）——
  // 驱动自己经 driver-config 读 drivers.yml（resolveConcurrency → driverCap 单一真相源）。supervisor
  // 只透传显式 --cap/--concurrency（若有），⛔ 不再替驱动决定缺省并发。
  const env: NodeJS.ProcessEnv = { ...process.env };

  const args = driverArgvForKind(opts.root, opts.kind, {
    cap: opts.cap,
    interval: opts.interval,
    reconcileInterval: opts.reconcileInterval,
    pidFile: pidArgFile(opts.root, opts.kind),
    runId: opts.runId,
  });

  let child: ReturnType<typeof spawn> | null = null;
  let stopping = false;
  // 当前 driver 进程的启动时刻（epoch ms）——源码自刷新对照的基准（AC-184）。
  let driverStartedAt = 0;

  // 忽略 HUP（nohup 等价）：supervisor 由 startKind 以 detached 起（setsid），但直调/旧宿主可能发 HUP。
  process.on("SIGHUP", () => { /* ignore */ });
  process.on("SIGTERM", () => {
    stopping = true;
    closeControlPlane();
    if (child) { try { child.kill("SIGTERM"); } catch { /* gone */ } }
  });
  process.on("SIGINT", () => {
    stopping = true;
    closeControlPlane();
    if (child) { try { child.kill("SIGINT"); } catch { /* gone */ } }
  });

  const startDriver = (): void => {
    let logFd: number;
    try {
      logFd = fs.openSync(st.driverLog, "a");
    } catch {
      logFd = 2; // fall back to stderr if the log cannot be opened
    }
    child = spawn(process.execPath, [...(driverSibling.stripTypes ? ["--experimental-strip-types"] : []), driverSibling.path, ...args], {
      stdio: ["ignore", logFd, logFd],
      env,
    });
    driverStartedAt = Date.now();
    // ⛔ 只替【不自写 pid】的 kind 写（pidSelf=false = worker，它的 --pid-file 是 in-flight 文件）。
    // 自写 kind（promotion/outer/quality/meta/goal）的 driver pid 文件由【驱动自己】在进入常驻循环后写
    // （pidArgFile → statePaths().driverPidFile，见 DRIVER_KINDS[*].pidSelf）。这里若替它预写，文件就
    // 不再区分「走到了自己的循环」与「刚 spawn、还在 import、马上要 exit(1)」——start 的存活确认会
    // 退化成「进程存在 ≥250ms」，对「活 600ms 后退出」的驱动误报 `started:`（硬规则 4b：用代理量
    // 「进程存在」冒充直接量「走到常驻循环」）。
    if (child.pid && !spec.pidSelf) writePidFile(st.driverPidFile, child.pid);
    appendLog(st.supervisorLog, `${ts()} supervisor: started driver pid=${child.pid ?? "?"}`);
    child.on("exit", (code) => {
      appendLog(st.supervisorLog, `${ts()} supervisor: driver exited code=${code ?? "null"}`);
      if (logFd !== 2) { try { fs.closeSync(logFd); } catch { /* ignore */ } }
      child = null;
      if (stopping || fs.existsSync(st.stopSentinel)) {
        appendLog(st.supervisorLog, `${ts()} supervisor: stop sentinel present; exiting`);
        try { fs.rmSync(st.stopSentinel, { force: true }); } catch { /* ignore */ }
        process.exit(0);
      }
      // ⛔ 本行是【崩溃退避】，不是轮询节奏（gap-drivers-yml-interval-not-honored-for-routine-kinds）：
      // 一个正常工作的 driver 是【常驻】的——它在自身循环里 sleep `<kind>.interval_ms` 后继续跑下一轮，
      // 进程不退出，本行因此永不执行。本行只在该 driver 进程意外终止之后生效（崩溃 / 被下面的源码自刷新
      // SIGTERM / 退出码非 0），作用是避免热重启风暴。
      // ⇒ 诊断口诀：supervisor 日志里【重启间隔恒等于 restartDelaySecs】时，先怀疑「driver 没有进入
      //   常驻循环」（它的 --interval / drivers.yml 值因此从未参与节奏），而不是「interval_ms 没生效」。
      appendLog(st.supervisorLog, `${ts()} supervisor: respawning driver in ${opts.restartDelaySecs}s`);
      setTimeout(startDriver, opts.restartDelaySecs * 1000);
    });
  };

  startDriver();

  // 源码自刷新（AC-184）：逐轮对照被监视源码 mtime 与 driver 启动时刻，源码推进到启动时刻之后 ⇒
  // SIGTERM driver 复用既有 exit→respawn 循环（⛔ 不新建并行重启机制）。轮询间隔 = restartDelaySecs
  // （测试传 1s ⇒ 快；生产缺省 5s ⇒ 慢，源码陈旧 ≤ ~2×restartDelaySecs 即自愈）。事件落 supervisor 日志
  // （⛔ 静默重启——硬规则 9「可见性 ≠ 执行」）。respawn 间隙 child=null ⇒ 跳过（不 SIGTERM 空引用）。
  const sourceCheckIntervalMs = Math.max(opts.restartDelaySecs, 1) * 1000;
  const sourceCheck = setInterval(() => {
    if (stopping || !child || driverStartedAt <= 0) return;
    // ⛔ 只对 **watched** 的 kind 重启 child：child 重启只有在它**从盘上源码**重载时才会换版本
    // （dev 源树直跑）。**mirror**（本内核是构建产物）下 child 重启加载的是**同一个 bundle** ⇒
    // 换不了版本、只是白重启一轮（gap-ac259-frozen-reading-stale-staging-kernel）。构建产物内核的
    // 「陈旧」由 `driver-anchor.ts` 的 bundleStale 支处理（目标 = 源树里更新的那份 bundle）。
    if (sourceWatch(opts.root, opts.kind).state === "watched" && sourceChangedSince(opts.root, opts.kind, driverStartedAt)) {
      appendLog(
        st.supervisorLog,
        `${ts()} supervisor: source changed (mtime=${sourceFilesMaxMtimeMs(opts.root, opts.kind)} > driver_start=${driverStartedAt}); restarting driver`,
      );
      try { child.kill("SIGTERM"); } catch { /* gone */ }
    }
  }, sourceCheckIntervalMs);
  // 本 timer 不单独保活（unref）：supervisor 的存活由 child 子进程句柄 + respawn setTimeout 共同维持；
  // stop sentinel → exit 路径仍由 child 的 exit 事件驱动（process.exit 会一并拆掉本 timer）。
  sourceCheck.unref();

  // supervisor 是常驻前台进程：靠 child 的 exit 事件驱动，永不 resolve（被 SIGTERM/stop sentinel 退出）。
  return new Promise<number>(() => {});
}

/** driver pid 文件读数的**含义**由写者决定（唯一正本；⛔ 别在别处再描述一遍）。
 *  `true`  ⇒ 该 kind 的 driver 在【进入常驻循环后】自写自己的 pid（DRIVER_KINDS[*].pidSelf，
 *            写者 = 驱动）⇒ `aliveness().driverAlive` 读的是「驱动走到了自己的循环」= 直接量。
 *  `false` ⇒ 驱动不自写（worker 的 --pid-file 是 in-flight 文件，由 appendWorkerPid 逐 worker 追加），
 *            driver pid 文件仍由 supervisor 在 spawn 时写 ⇒ `driverAlive` 读的是「子进程此刻存在」
 *            = 代理量（含「刚 spawn、还没起来」与「马上要退」）。
 *  ⚠️ 已知残留（gap-driver-start-false-confirms-unsettled-driver AC4 枚举项）：`false` 这一支仍是
 *  代理量 ⇒ `start --kind worker` 的存活确认仍可能对「未就绪」的 worker 驱动误报 `started:`。
 *  修它需要 worker-driver.ts 自写 driver pid 文件（本任务的 ## Touches 只含 driver-runtime.ts /
 *  其测试 / 任务体 ⇒ 不在本次改动面内，如实登记为残留而非静默）。 */
export function driverPidIsReadinessMarker(kind: DriverKind): boolean {
  return DRIVER_KINDS[kind].pidSelf;
}

/** 派生一个 kind 的 { supervisor_alive, driver_alive, running, deaths }（status 与 liveness 共用）。
 *  `driverPid`/`driverAlive` = **承载该 kind 常驻循环的那个进程**：收敛形态（anchor 承载）下就是 anchor
 *  自己，旧形态下是 pid 载体指向的 driver 进程——两者的活性都是 `/proc` 直接量。
 *  （`driverPidIsReadinessMarker` 描述的是**旧形态**里 pid 载体的写者分工；收敛形态下那张文件可能不存在，
 *  见 `anchorHosts` 的注释。） */
export function aliveness(root: string, kind: DriverKind): {
  supervisorPid: number | null;
  driverPid: number | null;
  supervisorAlive: boolean;
  driverAlive: boolean;
  running: boolean;
  deaths: string[];
  /** supervisor 进程启动时刻（epoch ms）；读不到 ⇒ null（not-evaluated，⛔ 与「新鲜」同形）。 */
  supervisorStartedAt: number | null;
  /** supervisor 是否陈旧（其启动时刻早于被监视源码最新 mtime）。true=stale；false=fresh；null=
   *  not-evaluated（supervisor 缺失/已死/读不到启动时刻）。 */
  supervisorStale: boolean | null;
  /** gap-ac259-frozen-reading-stale-staging-kernel：被监视源码的解析态（`watched` / `mirror` /
   *  `unwatched`）。⛔ 独立取值：`supervisorStale=false` 在 `unwatched` 下说的是「盘上没有源可推进」、
   *  在 `watched`/`mirror` 下说的是「源码没推进到启动时刻之后」——先读这个字段再解释 `supervisorStale`
   *  （硬规则 3b：读不到输入不得与合格同形）。`mirror` 且 `supervisorStale=true` = **本内核跑的是
   *  一份比源树旧的构建产物**（暂存 dist / pack-time 快照）——那是本任务的核心读数。 */
  sourceWatch: SourceWatch["state"];
  /** 实际被求值的目录（`sourceWatch` 选中的那个）。 */
  sourceWatchDir: string;
  /** AC-255：承载该 kind 常驻循环的宿主模型。`anchor` = 收敛形态（一个进程承载全部 kind 循环）；
   *  `supervisor` = 旧的多进程形态。⛔ 两者必须不同形，否则「收敛了没」在读数上不可见。 */
  host: "anchor" | "supervisor";
  /** AC-255：anchor 进程 pid（无活 anchor ⇒ null）。 */
  anchorPid: number | null;
} {
  const st = statePaths(root, kind);
  const spidRaw = readPidFile(st.supervisorPidFile);
  const dpidRaw = readPidFile(st.driverPidFile);
  const supervisorPid = /^\d+$/.test(spidRaw) ? Number(spidRaw) : null;
  const pidFilePid = /^\d+$/.test(dpidRaw) ? Number(dpidRaw) : null;
  const supervisorAlive = supervisorPid != null && pidAlive(supervisorPid);
  // AC-255（SPEC §7 阶段 C）：收敛后**没有 supervisor 进程**——该 kind 的常驻循环由 anchor 进程承载，
  // `.quay/<prefix>.pid` 写的是 anchor 的 pid（六个 kind 同一个 pid）。此时 `running` 的直接量是
  // 「承载进程活着 ∧ 该 kind 已被 anchor 接管」，⛔ 不是「supervisor ∧ driver 双活」（那会恒 false，
  // 把收敛后的「在跑」读成「死了」——硬规则 3b 的镜像：读不懂输入 ⇒ 报了一个假死亡）。
  const host = anchorHosts(root, kind);
  // **承载该 kind 常驻循环的进程**：anchor 承载时**就是 anchor 自己**（`host.anchorPid`），
  // ⛔ 不是「pid 载体文件里碰巧写着谁」——那张文件是**循环的产物**，收敛形态下可能压根不存在（生产
  // 实测 6 个 kind 里 5 个没有它，见 anchorHosts 的注释）。`driver_pid`/`driver_alive` 的语义是
  // 「跑这个 kind 的进程是谁 / 它活着吗」，故收敛形态下报 anchor 的 pid 与活性——这也正是 driver-anchor
  // 文档写死的载体约定（`.quay/<prefix>.pid` 六个文件一个 pid）。直接量：`pidAlive` 读 `/proc`。
  // ⚠️ `gap-driver-status-misreports-anchor-hosted-kind-as-down` 的另一半：`packages/quay/src/cli/
  //   server.ts` 用 `driver_alive !== 1` 判「这个 kind 的循环没在转」⇒ ⛔ 不能只修 `running` 而让
  //   `driver_alive` 继续报 0（那只是把一个字段的假死搬到另一个字段）。
  const driverPid = host.hosted ? host.anchorPid : pidFilePid;
  const driverAlive = driverPid != null && pidAlive(driverPid);
  const running = host.hosted ? driverAlive : supervisorAlive && driverAlive;
  const deaths: string[] = [];
  if (!host.hosted) {
    // supervisor 死：pid 文件在而进程不在。
    if (supervisorPid != null && !supervisorAlive) deaths.push("supervisor_dead");
    // 孤儿 driver：supervisor 死而 driver 进程还在 —— ⛔ 不算「在跑」（AC3(b)）。
    if (!supervisorAlive && driverAlive) deaths.push("driver_orphaned");
  } else if (supervisorPid != null) {
    // anchor 承载 && 仍有 supervisor pid 文件 ⇒ 残留（阶段 C 已退役 supervisor）。如实报出，⛔ 不静默。
    deaths.push("stale_supervisor_pidfile");
  }
  // driver 死：承载进程不在（收敛形态下 = anchor 不在，而 anchorHosts 已要求 anchor 活着 ⇒ 恒不触发；
  // 旧形态下 = pid 载体指向一个死进程）。
  if (driverPid != null && !driverAlive) deaths.push("driver_dead");
  // supervisor 陈旧判定（gap-supervisor-never-self-refreshes-no-detector）：只对【活着】的 supervisor
  // 有意义；缺失/已死/读不到启动时刻 ⇒ not-evaluated（null），⛔ 不与「新鲜」（false）同形。
  // AC-255：anchor 承载时「宿主陈旧」判定的对象是 **anchor 进程**（supervisor 已退役）——同一个直接量
  // （宿主启动时刻 vs 被监视源码 mtime），换的只是宿主的 pid 从哪来。
  const hostPidForStaleness = host.hosted ? host.anchorPid : supervisorAlive ? supervisorPid : null;
  const staleness = supervisorStaleness(root, kind, hostPidForStaleness);
  return {
    supervisorPid,
    driverPid,
    supervisorAlive,
    driverAlive,
    running,
    deaths,
    supervisorStartedAt: staleness.supervisorStartedAt,
    supervisorStale: staleness.state === "stale" ? true : staleness.state === "fresh" ? false : null,
    sourceWatch: staleness.sourceWatch,
    sourceWatchDir: staleness.sourceWatchDir,
    host: host.hosted ? "anchor" : "supervisor",
    anchorPid: host.anchorPid,
  };
}

/** status 输出（JSON 与人类可读两态）。alive 与 running 同值（alive 是 AC139-3 字段名，running 保留
 *  backward compat）。carrier_path / carrier_records / last_record_ts / last_record_carrier 全部出自
 *  **同一个 carrierStats 读数**，但⛔ **不是同一个量**：carrier_path = 首个存在的载体（「谁在盘上」）；
 *  last_record_ts = 全载体末条 ts 最大值；last_record_carrier = **提供该 ts 的那个载体**（「从哪来」）。
 *  ⛔ 不得把 carrier_path 读成 last_record_ts 的来源——两者在真实工作区上会不同名
 *  （见 CarrierStats.lastTsCarrier 的实测；gap-driver-status-carrier-path-source-label-mismatch）。
 *  carrier_path 为 null ⇔ 无任何载体存在 ⇔ records=0（⛔ 不报一个不存在的路径——AC1/AC2）。
 *  carrier_files 是逐载体分解（哪个存在/哪个没有/各多少行）：让「新旧载体名并存」在读数上可见。
 *
 *  `loaded_version` / `loaded` / `installed` / `config_provider_path`（gap-driver-status-loaded-vs-
 *  installed-version-drift）：回答 `supervisor_stale` **结构上答不了**的那个问题——「跑着的那个进程
 *  加载的是哪一版内核」。`supervisor_stale` 对**装好的产物**恒报 `unwatched`-fresh（盘上没有源可推进），
 *  于是「落后 3 天的 anchor」与「一切正常」同形；本条比的是宿主进程**实际加载的**内核版本 vs 已安装版本。
 *  `path_quay_version` / `path_quay` / `path_quay_version_resolved`（gap-path-resolved-quay-version-not-in-
 *  driver-status）：第三个漂移源——**PATH 命中的 quay 是哪一版**（人敲 `quay ...` 实际跑的那一版）；
 *  前两个量都不回答它。⛔ 读不到一律 `not-evaluated`（硬规则 3b）、⛔ 只报不修 PATH。 */
export function statusForKind(root: string, kind: DriverKind, json: boolean, out: (s: string) => void): number {
  const spec = DRIVER_KINDS[kind];
  const a = aliveness(root, kind);
  const stats = carrierStats(root, kind);
  // 宿主进程：收敛形态 = anchor；旧多进程形态 = supervisor。⛔ 不用 driverPid——短命的 driver 子进程
  // 不是「加载了哪份内核」这个问题的主体（常驻宿主才是）。
  const lv = loadedVersionReading(root, a.host === "anchor" ? a.anchorPid : a.supervisorPid);
  // 第三个版本读数：PATH 命中的 quay 是哪一版（见本区「第三个漂移源」注释）。⛔ 与宿主进程无关——
  // 它读的是**查询者 shell 的 PATH**，回答「人敲 `quay ...` 跑的是哪一版」。⛔ 只报，不修 PATH。
  const pq = pathQuayVersionReading();
  // 第四个漂移源（项目指引链接 `.quay/plugin` vs Core 自身）：Core ⛔ 不写链接，只报漂移。见
  // pointerReading 的头注释。`not-evaluated`（链接缺失）⛔ 不与 `current` 同形（硬规则 3b）。
  const ptr = pointerReading(root);
  // AC-255 能力半边：`running` 回答「有没有一个活着的承载进程」，**答不了**「这个 kind 的循环还在转
  // 吗」——收敛形态下六个 kind 共用一个 anchor，anchor 活着时全部报 `running=1`，哪怕其中两个的循环
  // 早已被移出期望态而停摆（2026-09-23 实测：`quality`/`meta` 停摆 264min，六个 kind 的 `running` 全是 1）。
  // ⇒ 声明状态是一条**独立**的读数，来自期望态 + 停机记录（见 `kindDeclaration`）。
  const declaration = kindDeclaration(root, kind);
  // 人类可读面：ts 与它的【来源】必须相邻出现；来源 ≠ carrier_path 时把「跨载体最大值」标注出来——
  // 否则读者会把行内先出现的 carrier_path 当成这个 ts 的来源（正是本任务修的缺陷）。
  // ⛔ 只改打印的并置关系，不改任何取值规则（carrier_path 语义不变，由既有测试钉住）。
  const crossCarrier =
    stats.lastTsCarrier !== null && stats.lastTsCarrier !== stats.primaryPath ? " (cross-carrier max)" : "";
  if (json) {
    out(JSON.stringify({
      kind,
      supervisor_pid: a.supervisorPid,
      driver_pid: a.driverPid,
      supervisor_alive: a.supervisorAlive ? 1 : 0,
      driver_alive: a.driverAlive ? 1 : 0,
      alive: a.running ? 1 : 0,
      running: a.running ? 1 : 0,
      carrier_path: stats.primaryPath,
      carrier_records: stats.records,
      last_record_ts: stats.lastTs,
      // ts 的【来源】单列：`carrier_path` 是「首个存在」，⛔ 不是「供这个 ts 的那个」。
      last_record_carrier: stats.lastTsCarrier,
      carrier_files: stats.files,
      supervisor_started_at: a.supervisorStartedAt,
      supervisor_stale: a.supervisorStale === true ? "stale" : a.supervisorStale === false ? "fresh" : "not-evaluated",
      // gap-ac259-…：`supervisor_stale` 的**输入从哪来**必须与它相邻可读——`watched`（本内核目录里就有
      // .ts）/ `mirror`（本内核是构建产物，比的是源树）/ `unwatched`（盘上没有源可推进）。⛔ 没有这个
      // 字段时，「跑在陈旧构建产物上」与「一切正常」在同一个 `fresh`/`stale` 取值里不可区分（硬规则 3b）。
      source_watch: a.sourceWatch,
      source_watch_dir: a.sourceWatchDir,
      // AC-255：宿主模型（anchor=收敛形态 / supervisor=旧多进程形态）+ anchor pid。⛔ 两者不同形。
      host: a.host,
      anchor_pid: a.anchorPid,
      // 已加载内核版本 vs 已安装版本（见本节头注释）。`loaded_version` 四态各自独立——`not-evaluated`
      // （读不到运行记录/宿主已死）⛔ 不与 `current` 同形（硬规则 3b）；`ahead` 与 `behind` 也不同形
      // （源树检出里 anchor 跑的是比注册表更新的一版，并进 `behind` 会报一个方向错的读数）。
      loaded_version: lv.state,
      loaded: lv.loaded,
      installed: lv.installed,
      installed_at: lv.installedAt,
      installed_source: lv.installedSource,
      loaded_version_relation: lv.relation,
      loaded_kernel: lv.loadedKernel,
      loaded_kernel_source: lv.loadedKernelSource,
      loaded_version_reason: lv.reason,
      // 第二个漂移源（`.quay/config.yml` provider `path` 的版本段），独立取值。
      config_provider_path: lv.configProviderPath,
      config_provider_path_version: lv.configProviderPathVersion,
      // 第三个漂移源（PATH 命中的 quay）：`path_quay_version` 四态各自独立——找不到 quay / 推不出版本 /
      // 注册表读不出 ⇒ `not-evaluated`，⛔ 不与 `current` 同形（硬规则 3b）。`path_quay` 是命中的 realpath。
      path_quay_version: pq.state,
      path_quay: pq.path,
      path_quay_version_resolved: pq.version,
      path_quay_version_relation: pq.relation,
      path_quay_version_reason: pq.reason,
      // 第四个漂移源（项目指引链接 `.quay/plugin` vs Core 自身插件根）。四态各自独立；链接缺失 /
      // 目标无 plugin.json ⇒ `not-evaluated`，⛔ 不与 `current` 同形（硬规则 3b）。
      pointer: {
        state: ptr.state,
        core_version: ptr.coreVersion,
        core_root: ptr.coreRoot,
        link_target: ptr.linkTarget,
        link_version: ptr.linkVersion,
        reason: ptr.reason,
      },
      // AC-255 能力半边：本 kind 相对**期望态**的声明状态。四态各自独立（⛔ 不与 `alive`/`running` 同形）：
      // `declared` / `stopped-explicitly`（操作员有意停机）/ `not-declared`（**静默脱离期望态**）/
      // `not-evaluated`（读不懂期望态或停机记录）。缺这个字段时，「六个循环里有两个没在转」与
      // 「一切正常」在所有既有字段上都同形 —— `alive` 读的是**承载进程**，不是这个 kind 的循环。
      declaration: declaration,
    }) + "\n");
  } else {
    // 人类可读面：已加载版本读数**打在最前面**（第一行、第一个字段——一个落后 3 天的进程必须在读者
    // 看到 `supervisor_stale=fresh` 之前就先看到它）。`behind` 附 `quay driver restart` 的动作提示
    // （⛔ 只提示、⛔ 不自动重启——停/起常驻 anchor 的时机由人或 manager 决定）。
    // ⚠️ 仍是**一整行**（`driver-status-carrier-path.test.mjs` AC3 钉住「恰好一行正文 + 尾换行」）：
    // 「放在第一行」= 排在行首，⛔ 不是另起一行——另起一行会撞那条既有判据。
    const loadedHead =
      `loaded-version-${lv.state}: loaded=${lv.loaded ?? "null"} installed=${lv.installed ?? "null"}` +
      (lv.installedAt ? ` (installed_at ${lv.installedAt})` : "") +
      (lv.loadedKernel ? ` kernel=${lv.loadedKernel}` : "") +
      (lv.loadedKernelSource ? ` source=${lv.loadedKernelSource}` : "") +
      (lv.state === "behind"
        ? " — the running host loaded an OLDER kernel than the installed one: run `quay driver restart` to load it"
        : lv.state === "ahead"
          ? " — the running host loaded a NEWER kernel than the installed one (a source checkout in front of the registry)"
          : lv.state === "not-evaluated"
            ? ` — ${lv.reason ?? "no reason given"}`
            : "") +
      " · ";
    out(
      loadedHead +
      `${spec.prefix}: kind=${kind} · host=${a.host} anchor_pid=${a.anchorPid ?? "none"} · ` +
      `supervisor pid=${a.supervisorPid ?? "none"} alive=${a.supervisorAlive ? 1 : 0} · ` +
      `driver pid=${a.driverPid ?? "none"} alive=${a.driverAlive ? 1 : 0} · running=${a.running ? 1 : 0} · ` +
      `declaration=${declaration} · ` +
      `supervisor_stale=${a.supervisorStale === true ? "stale" : a.supervisorStale === false ? "fresh" : "not-evaluated"} · ` +
      `source_watch=${a.sourceWatch} · ` +
      // ⛔ 不打印空串：显式 "null"（= 无载体存在），与 last_record_ts 的 null 表达同形（硬规则 3b）。
      `carrier_path=${stats.primaryPath ?? "null"} · carrier_records=${stats.records} · ` +
      `last_record_ts=${stats.lastTs ?? "null"}${crossCarrier} · ` +
      // ⛔ 紧邻上面那一项：这就是「这条 ts 从哪来」的答案（`carrier_path` 回答的是另一个问题）。
      `last_record_carrier=${stats.lastTsCarrier ?? "null"} · ` +
      `carrier_files=${stats.files.map((f) => `${f.name}:${f.exists ? f.records : "missing"}`).join(",")} · ` +
      // 第二个漂移源（provider `path` 的版本段）；已加载版本那三键已在行首（loadedHead）。
      // ⛔ 空值打印 "null"，⛔ 不打印空串（硬规则 3b）。
      `config_provider_path=${lv.configProviderPath}` +
      `${lv.configProviderPathVersion ? `:${lv.configProviderPathVersion}` : ""} · ` +
      // 第三个漂移源（PATH 命中的 quay）：state + 从路径读出的版本 + 命中的 realpath。⛔ 读不到时显式
      // 报 `not-evaluated`（⛔ 不印空串、⛔ 不印 current——空串与「没问题」同形，硬规则 3b）。
      `path_quay_version=${pq.state}` +
      `${pq.version ? `:${pq.version}` : ""}` +
      `${pq.path ? `:path=${pq.path}` : ""}` +
      `${pq.state === "not-evaluated" && pq.reason ? ` (${pq.reason})` : ""} · ` +
      // 第四个漂移源（项目指引链接 `.quay/plugin` vs Core）：state 四态 + 两侧版本 + 链接目标。
      // ⛔ 读不到时报 `not-evaluated`（⛔ 不印空串、⛔ 不印 current——空串与「没问题」同形，硬规则 3b）。
      `pointer=${ptr.state}` +
      `${ptr.linkVersion ? `:link=${ptr.linkVersion}` : ""}` +
      `${ptr.coreVersion ? `:core=${ptr.coreVersion}` : ""}` +
      `${ptr.state === "not-evaluated" && ptr.reason ? ` (${ptr.reason})` : ""}\n`,
    );
  }
  return 0;
}

/** liveness 输出（AC2 死亡告警 / AC3 supervisor 死检测）。检出死亡 ⇒ 写 DEATH 事件 + 退出 1；健康 ⇒
 *  写 ok 心跳 + 退出 0。 */
export function livenessForKind(root: string, kind: DriverKind, json: boolean, out: (s: string) => void): number {
  const spec = DRIVER_KINDS[kind];
  const a = aliveness(root, kind);
  const deaths = a.deaths.length > 0 ? a.deaths.join(",") : "none";
  if (json) {
    out(JSON.stringify({
      kind,
      supervisor_pid: a.supervisorPid,
      driver_pid: a.driverPid,
      supervisor_alive: a.supervisorAlive ? 1 : 0,
      driver_alive: a.driverAlive ? 1 : 0,
      running: a.running ? 1 : 0,
      deaths,
    }) + "\n");
  } else {
    out(
      `${spec.prefix}-liveness: kind=${kind} · supervisor_alive=${a.supervisorAlive ? 1 : 0} · ` +
      `driver_alive=${a.driverAlive ? 1 : 0} · running=${a.running ? 1 : 0} · deaths=${deaths}\n`,
    );
  }
  writeLivenessLog(root, kind, a.deaths, a.supervisorPid, a.driverPid);
  return a.deaths.length > 0 ? 1 : 0;
}

/** start 的【存活确认窗口】（秒，缺省值）。⚠️ 它不是「死亡判定窗」——窗口用尽只产出
 *  `start-pending`（第三种取值），死亡只在【决断信号】上判（见 startKind 的确认段注释）。 */
const DEFAULT_CONFIRM_TIMEOUT_SECS = 30;
/** 确认轮询间隔（ms）。轻量（读 pid 文件 + kill -0 判定），远小于窗口。 */
const CONFIRM_POLL_MS = 250;

/** 一个文件的末 N 行（报死因时贴出 supervisor 日志尾；读不到 ⇒ 空串，⛔ 不是「无死因」）。 */
function fileTailLines(file: string, n = 8): string {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").slice(-n).join("\n");
  } catch {
    return "";
  }
}

/** 存活确认的判决（⛔ 三态不是布尔——硬规则 3b：「查过且起来了」与「查不成/还没起来」必须不同形）。
 *  `confirmed` = supervisor 活 ∧ **driver 已就绪**（见下）且该读数被【连续两次】轮询都读到；
 *  `dead` = 决断信号（supervisor 已退出且无 driver）；`pending` = 窗口用尽而 supervisor 仍活
 *  （慢启动 / 崩溃-重拉循环）。
 *
 *  ⚠️「driver 已就绪」的定义是这条判据的**全部要害**（gap-driver-start-false-confirms-unsettled-driver）：
 *  pidSelf 类 kind 的就绪标记由**驱动自己在进入常驻循环后写**（driverPidIsReadinessMarker）⇒ 与宿主
 *  负载无关。⛔ 曾经的定义是「driver pid 文件在 ∧ 该进程存在 ≥250ms」——而 supervisor 在 spawn 时替
 *  驱动预写了那个文件 ⇒ 「文件在」只等于「spawn 过」。`CONFIRM_POLL_MS` 是个**定值**，其合理性依赖
 *  「进程从 spawn 到就绪的延迟 < 250ms」这个**宿主性质**（硬规则 4 推论二）⇒ 套件级并发把 node 启动
 *  推到 >250ms 后，守卫不再区分「起来了」与「刚 spawn 出来、活 600ms 就 exit(1)」，回到「报成功但
 *  实际死亡」。实测：boot ~50ms ⇒ `start-pending`+rc1（5/5）；boot ~600ms ⇒ `started:`+rc0（误报）。 */
export type ConfirmVerdict = "confirmed" | "dead" | "pending";

export interface ConfirmResult {
  verdict: ConfirmVerdict;
  driverPid: number | null;
  supervisorAlive: boolean;
  driverAlive: boolean;
  elapsedMs: number;
}

/** 等 driver 被确认存活（start 的【唯一】确认实现；spawn 路径与 already-running 路径共用，⛔ 不写两份）。
 *  `supervisorGone` = supervisor 是否已不在（决断信号），由调用方给：spawn 路径用 spawn 句柄的 exit
 *  事件（⛔ 不用 pidAlive——未 reap 的子进程是可 signal 的僵尸，见 startKind 注释）；already-running
 *  路径用 `pidAlive(pid)`（那个进程不是我们的子进程，无僵尸问题）。 */
async function awaitDriverConfirmation(
  root: string,
  kind: DriverKind,
  opts: { supervisorGone: () => boolean; confirmSecs: number },
): Promise<ConfirmResult> {
  const confirmStartedAt = Date.now();
  const deadline = confirmStartedAt + Math.max(0, opts.confirmSecs) * 1000;
  // 就绪判据 = `aliveness()` 的双活读数。它的**含义**由 driver pid 文件的写者决定，见
  // driverPidIsReadinessMarker：pidSelf 类是驱动自写的就绪标记（直接量，与负载无关）；worker 仍是
  // 「子进程存在」（代理量，残留见该函数的注释）。⛔ 本函数不再自己承担「分开起来了与刚 spawn 出来」
  // 这件事 —— 那件事的可靠实现是【让驱动自己写】，「等一个定值时长」做不到（硬规则 4 推论二）。
  //
  // 稳定判据：就绪读数必须被【连续两次】轮询都读到（`firstAliveAt` 起算 ≥ 一个轮询间隔）。⚠️ 它现在
  // 只承担**去抖**（挡住「写完就绪标记的同一瞬间就死了」这种单次采样噪声），⛔ 不再承担就绪判别 ——
  // 所以 `CONFIRM_POLL_MS` 的取值（250ms）不再影响正确性，只影响确认耗时；把它调大调小都不会让
  // 「未就绪」变成「已就绪」。⛔ 它也只推迟确认、不产生假死（慢启动照样在窗口内确认）。
  const settleMs = CONFIRM_POLL_MS;
  let firstAliveAt = 0;
  for (;;) {
    const a = aliveness(root, kind);
    if (a.supervisorAlive && a.driverAlive) {
      if (firstAliveAt === 0) firstAliveAt = Date.now();
      if (Date.now() - firstAliveAt >= settleMs) {
        return { verdict: "confirmed", driverPid: a.driverPid, supervisorAlive: true, driverAlive: true, elapsedMs: Date.now() - confirmStartedAt };
      }
    } else {
      firstAliveAt = 0;
    }
    if (opts.supervisorGone() && !a.driverAlive) {
      return { verdict: "dead", driverPid: a.driverPid, supervisorAlive: a.supervisorAlive, driverAlive: a.driverAlive, elapsedMs: Date.now() - confirmStartedAt };
    }
    if (Date.now() >= deadline) {
      return { verdict: "pending", driverPid: a.driverPid, supervisorAlive: a.supervisorAlive, driverAlive: a.driverAlive, elapsedMs: Date.now() - confirmStartedAt };
    }
    await sleep(CONFIRM_POLL_MS);
  }
}

/** 把「未确认存活」如实报出（⛔ 不静默、⛔ 不与已确认同形）：死/未确认两种取值 + supervisor 日志尾
 *  （死因在那里；⛔ 日志读不到时要说明「这不等于无死因」）。 */
function reportUnconfirmed(root: string, kind: DriverKind, v: ConfirmResult, confirmSecs: number, err: (s: string) => void): void {
  const st = statePaths(root, kind);
  const tail = fileTailLines(st.supervisorLog);
  if (v.verdict === "dead") {
    err(`start-failed: kind=${kind} — supervisor 已退出且无 driver 存活（elapsed_ms=${v.elapsedMs}）。死因（${st.supervisorLog} 尾）:\n`);
  } else {
    err(
      `start-pending: kind=${kind} — 确认窗口 ${confirmSecs}s 用尽，driver 未被确认存活` +
      `（supervisor alive=${v.supervisorAlive ? 1 : 0}，driver pid=${v.driverPid ?? "none"} alive=${v.driverAlive ? 1 : 0}，elapsed_ms=${v.elapsedMs}）。` +
      `⛔ 这不是死亡判定（慢启动 / 驱动崩溃-重拉循环与此同形）；复读用 quay driver status --kind ${kind}。日志尾:\n`,
    );
  }
  err(tail ? `${tail}\n` : "(supervisor 日志为空/读不到 —— ⛔ 这不等于「无死因」)\n");
}

/** start：无活 supervisor ⇒ 清孤儿驱动、spawn detached supervisor（setsid+nohup 等价）、**确认 driver
 *  真的活了**才报成功。有活 supervisor ⇒ already-running（⛔ 但同样要确认 driver 真活）。
 *
 *  gap-ac203-record-schema-has-no-kind-dimension（AC3/AC4）：本函数此前【无条件】打印
 *  `started: …` 并返回 0（statusForKind 恒返回 0），而 driver 根本没活时同样如此——「报成功但实际
 *  死亡」与「真的起来了」共用一种输出（硬规则 3b）。实测代价见 tasks/gap-ac203-record-schema-has-no-
 *  kind-dimension.md 的 Proposal（2026-09-13 三个 kind 全中，真实死因只写在目标项目内部日志里）。
 *
 *  修法：把两个信号【分开取值】，⛔ 不用「等 N 秒看有没有 pid」当死亡判据（那是把【慢】读成【死】）：
 *    · `started:`       supervisor 活 ∧ **driver 已就绪**（pidSelf 类 kind 的就绪标记由驱动自己在进入
 *                       常驻循环后写——见 driverPidIsReadinessMarker），且该读数被**连续两次**轮询读到
 *                       （去抖；就绪判别本身不再依赖轮询次数/间隔）—— 窗口内确认即成功。
 *                       ⛔ 「driver pid 文件在」只有在写者是驱动时才等于「已就绪」：supervisor 若在
 *                       spawn 时替它预写，该文件只证明「spawn 过」，确认会退化成「进程存在 ≥250ms」
 *                       （gap-driver-start-false-confirms-unsettled-driver；见 runSupervisor 的写者注释）。
 *    · `start-failed:`  我们 spawn 的那个 supervisor 进程**已退出** ∧ driver 不活 ⇒ 再也没有谁会拉起
 *                       driver。这是【决断信号】，与窗口大小无关（缺 driver 脚本、解释器不接受启动参数
 *                       等都在此列），并贴出 supervisor 日志尾作为死因。
 *    · `start-pending:` 窗口用尽而 supervisor **仍活着**（慢启动 / 驱动崩溃-重拉循环）⇒ 独立取值，
 *                       ⛔ 不报「死」、⛔ 不打印 `started:`。退出码非 0 = 「未确认」≠「死」。
 */
/** 阶段 C 的 start 路径（anchor 承载）：声明期望态 → 确保 anchor 在跑 → 等该 kind **自己的循环**就绪。
 *
 *  ⛔ 就绪判据 = `loopReadinessMarker()`（**该 kind 自己的** pid 载体写着一个活进程），⛔ **不是**
 *  `aliveness().running`：后者回答「这个 kind 有没有被一个活着的宿主承载」，而本函数要回答的是
 *  「它的循环**真的跑起来了**没有」——两者在收敛形态下**必须是取假值不同的两个量**，否则一个每轮必抛的
 *  kind 会被 `start` 报成成功（§6.1 的守卫实测过这条，见 driver-anchor.test.mjs）。
 *  ⚠️ `gap-driver-status-misreports-anchor-hosted-kind-as-down` 的残留（如实登记，⛔ 不静默）：生产实例里
 *  那 5 个「anchor 托管却没有 pid 载体」的 kind，`start --kind <k>` 会等满确认窗口并报 `start-pending`
 *  （**本任务之前就是这样**，本任务⛔ 未改变它——那需要一个「循环在产出」的直接量，超出本任务 Touches）。
 *  它的读数取自 `loopReadinessMarker` 的同一张文件；`status` 半边已由本任务修好（host=anchor/alive=1）。 */
async function startKindViaAnchor(
  root: string,
  kind: DriverKind,
  opts: StartOptions,
  out: (s: string) => void,
  err: (s: string) => void,
): Promise<number> {
  const confirmSecs = Math.max(0, opts.confirmTimeoutSecs ?? DEFAULT_CONFIRM_TIMEOUT_SECS);
  const t0 = Date.now();

  const before = aliveness(root, kind);
  // ⛔ 判据是「**本 kind 自己的**循环就绪」而不是 `aliveness().running`（承载关系）——理由见本函数的
  // 文档注释。在 anchor 路径下这条与旧 `before.running`（旧语义 = `hosted ∧ driverAlive`，而 driverAlive
  // 读的正是同一张 pid 载体）**逐字等价** ⇒ 对 `start` 是无行为变更的改写。
  if (loopReadinessMarker(root, kind)) {
    // §6.9 不变式 1：已在跑 ⇒ no-op（⛔ 不是静默重启）。
    out(`already-running: host=${before.host} anchor pid=${before.anchorPid ?? "none"} driver pid=${before.driverPid ?? "?"}\n`);
    return statusForKind(root, kind, true, out);
  }

  // ① 声明期望态（把该 kind 加进集合；⛔ 不覆盖别的 kind —— `quay driver start --kind X` 只加 X）。
  updateDesired(root, kind, true, "quay-driver-start", {
    cap: opts.cap,
    interval: opts.interval,
    reconcileInterval: opts.reconcileInterval,
    runId: opts.runId,
  });

  // ② 确保 anchor 进程在跑（幂等：活着就不重起 —— 那会打断其余 kind 在飞的工作，§6.9 不变式 2）。
  let anchorPid = readAnchorPid(root);
  if (anchorPid === null || !pidAlive(anchorPid)) {
    const r = spawnAnchor(root);
    if (r.error !== null || r.pid === null) {
      err(`start-failed: kind=${kind} — cannot spawn driver anchor: ${r.error ?? "no pid"}\n`);
      return 1;
    }
    anchorPid = r.pid;
  }

  // ③ 等该 kind **自己的循环**就绪（判据 = `loopReadinessMarker`，见本函数的文档注释）；anchor 进程死了
  //    ⇒ 决断信号。
  for (;;) {
    const cur = aliveness(root, kind);
    if (loopReadinessMarker(root, kind)) {
      out(`started: anchor pid=${anchorPid} kind=${kind} driver pid=${cur.driverPid ?? "?"} confirmed_ms=${Date.now() - t0}\n`);
      return statusForKind(root, kind, true, out);
    }
    if (!pidAlive(anchorPid)) {
      err(`start-failed: kind=${kind} — driver anchor pid=${anchorPid} exited before the loop became ready (elapsed_ms=${Date.now() - t0}). 锚日志尾（${anchorPaths(root).logFile}）:\n`);
      err(`${fileTailLines(anchorPaths(root).logFile) || "(anchor 日志为空/读不到 —— ⛔ 这不等于「无死因」)"}\n`);
      return 1;
    }
    if (Date.now() - t0 >= confirmSecs * 1000) {
      err(
        `start-pending: kind=${kind} — 确认窗口 ${confirmSecs}s 用尽，anchor pid=${anchorPid} 仍活着但该 kind 的循环未被确认就绪` +
        `（readiness_marker=${loopReadinessMarker(root, kind) ? 1 : 0}，host=${cur.host}，carrier_last_ts=${carrierStats(root, kind).lastTs ?? "null"}，elapsed_ms=${Date.now() - t0}）。` +
        `⛔ 这不是死亡判定（慢启动 / 崩溃-重拉循环与此同形）；复读用 quay driver status --kind ${kind}。锚日志尾:\n`,
      );
      err(`${fileTailLines(anchorPaths(root).logFile) || "(anchor 日志为空/读不到 —— ⛔ 这不等于「无死因」)"}\n`);
      return 1;
    }
    await sleep(CONFIRM_POLL_MS);
  }
}

/** start/restart 共用的启动参数面（`quay driver start --kind X --cap …` 的透传面）。
 *  提成具名类型是 `restartKind` 需要 `StartOptions & StopOptions` 的结果——⛔ 语义未变。 */
export interface StartOptions {
  cap?: string;
  interval?: string;
  reconcileInterval?: string;
  restartDelaySecs: number;
  runId?: string;
  confirmTimeoutSecs?: number;
  /** 启动环境冒烟的预算（ms，测试缝）。⛔ 缺省 = ENVIRONMENT_SMOKE_TIMEOUT_MS（生产值）。 */
  smokeTimeoutMs?: number;
}

export async function startKind(
  root: string,
  kind: DriverKind,
  opts: StartOptions,
  out: (s: string) => void = (s) => process.stdout.write(s),
  err: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> {
  const spec = DRIVER_KINDS[kind];
  const st = statePaths(root, kind);
  const confirmSecs = Math.max(0, opts.confirmTimeoutSecs ?? DEFAULT_CONFIRM_TIMEOUT_SECS);
  const spidRaw = readPidFile(st.supervisorPidFile);
  if (spidRaw && pidAlive(spidRaw)) {
    out(`already-running: supervisor pid=${spidRaw}\n`);
    // ⚠️ 「supervisor 已在」⛔ 不等于「driver 真活」：supervisor 与 driver 之间隔着一次 spawn，
    // driver 崩在重拉间隙里（或压根起不来）时，旧实现照样 exit 0 —— 与上面那条同一种「报成功但
    // 实际死亡」（硬规则 5b：缺陷是成簇的，⛔ 只修被报出来的那一个）。⇒ 同一条确认通道走一遍：
    // supervisor 会自己重拉 driver，故这里只需等，⛔ 不另写一份判定。
    const v = await awaitDriverConfirmation(root, kind, {
      supervisorGone: () => !pidAlive(spidRaw),
      confirmSecs,
    });
    if (v.verdict === "confirmed") {
      out(`already-running: confirmed driver pid=${v.driverPid ?? "?"} confirmed_ms=${v.elapsedMs}\n`);
      return statusForKind(root, kind, true, out);
    }
    reportUnconfirmed(root, kind, v, confirmSecs, err);
    return 1;
  }
  // gap-driver-drain-no-inverse AC2：drain 写 halted=true 后，start 照常 spawn supervisor 会起一个用户
  // 已 halt 的驱动。1a 类（promotion/worker）读到 halt ⇒ 本轮 break 退出 ⇒ supervisor respawn；
  // 例程型（goal/quality/outer/meta）读到 halt ⇒ 只观测不派发（循环继续，见 gap-drain-on-routine-driver-
  // empties-round-and-respawn-loops——已修掉例程型的 exit，⛔ 不靠这里的拒绝来消 respawn，但起一个已
  // halt 的驱动仍是错的）。无活 supervisor 且控制态 halted ⇒ 明确拒绝并提示解闸命令（退出 1）。
  // 读失败（parseError）⇒ 同样拒绝（fail-closed，⛔ 读不懂 ≠ 未 halt）。
  const ctlRel = path.posix.join(".quay", spec.controlFile);
  const ctl = readControlState(root, process.env, ctlRel);
  if (ctl.parseError) {
    err(`quay driver: could not read control state at ${path.join(root, ctlRel)} (${ctl.parseError}) — refusing to start (fail-closed)\n`);
    return 1;
  }
  if (ctl.state.halted) {
    err(`quay driver: ${kind} is halted (halted_by=${ctl.state.halted_by ?? "unknown"}${ctl.state.halted_at ? `, halted_at=${ctl.state.halted_at}` : ""}) — refusing to start; clear the halt first with: quay driver resume --kind ${kind}\n`);
    return 1;
  }

  // ── 环境冒烟（gap-worker-quick-death-environment-fatal-halts-driver item 4）：起 worker 循环【之前】
  //    用解析出的 launcher + model 做一次最小调用——环境级故障（模型名/密钥/launcher/网关）在起循环
  //    之前就拒绝，⛔ 不让 driver 拿着一个必然失败的环境去逐个 park 池子里的任务（本缺陷真正烧掉的是
  //    整池：claudecodeui 2026-09-20 一次坏环境 = 5 个任务被翻 needs-human）。
  //    四态（见 runEnvironmentSmoke）：refused ⇒ 拒绝启动（退出 1，⛔ 不 spawn 任何东西）；
  //    pass ⇒ 一行确认；not-evaluated / failed-non-environment ⇒ 告警但照常启动（⛔ 不把一次限流
  //    变成「起不了 driver」，也 ⛔ 不把「解析不出 launcher」伪装成冒烟通过——硬规则 3b）。
  if (kind === "worker") {
    const smoke = await runEnvironmentSmoke(root, { timeoutMs: opts.smokeTimeoutMs });
    if (smoke.verdict === "refused") {
      err(
        `quay driver: environment smoke check FAILED — refusing to start the worker driver (nothing was spawned).\n` +
        `  ${smoke.reason}\n` +
        `  这是【环境级】故障：所有 worker 都会以同样方式失败，逐个派发只会把池子里的任务逐个 park。\n` +
        `  修好环境后重试：quay driver start --kind worker\n`,
      );
      return 1;
    }
    if (smoke.verdict === "pass") out(`environment-smoke: ok — launcher+model resolved and callable\n`);
    else err(`start-warning: kind=worker — environment smoke ${smoke.verdict}: ${smoke.reason}\n`);
  }

  // ── SPEC §7 阶段 C（GOAL-017/AC-255）：默认走 **anchor 承载** ────────────────────────────────────
  // 收敛后不再有 per-kind 的 supervisor 进程：六个 kind 的常驻循环住在一个 anchor 进程的事件循环里
  // （§6.1）。`quay driver start --kind X` 因此变成两件事：①把 X 声明进 `.quay/anchor-desired.json`
  // （声明式期望态，anchor reconcile 它）；②确保 anchor 进程在跑。⛔ 判定语义一行未动——见
  // startKindViaAnchor 与 driver-anchor.ts 的头注释。
  //
  // 回退开关 `QUAY_DRIVER_LEGACY_SUPERVISOR=1` ⇒ 走下面那段多进程 supervisor 路径（阶段 C 可独立回退，
  // SPEC §7「每阶段独立可回退」）。⛔ 它不是默认路径。
  if (process.env.QUAY_DRIVER_LEGACY_SUPERVISOR !== "1") {
    return await startKindViaAnchor(root, kind, opts, out, err);
  }

  // 无活 supervisor；清掉孤儿驱动（supervisor 已死但驱动还在的中间态）。
  //
  // ⚠️ 这是 stop 侧被修的那个缺陷类的**第二个实例**（硬规则 5b 扫描：同一载体里同族的命中见提交说明）——
  // 旧实现「快照一次 pid → 一个 SIGTERM → 等 1s → ⛔ 不验证 → **无条件删三张载体**」与
  // `stopKind` legacy 分支逐字同形：杀不掉就把记录删掉 ⇒ 活着的孤儿变成盘上不可见的进程。
  // ⇒ 复用同一个原语（每轮重读 + SIGKILL 升级 + 回读确认 + 活进程的载体不摘）。宽限保持 1s（旧值）。
  const orphan = await stopLegacyPair(root, kind, { graceMs: 1000, killWaitMs: 1000 });
  if (orphan.state === "stopped") {
    err(`orphan legacy pair pid=[${orphan.signalled.join(",")}] (no live supervisor); stopped\n`);
  } else if (orphan.state === "still-running") {
    // 清不掉 ⇒ 如实报出并**保留载体**，⛔ 不静默继续（旧实现这里删掉载体就直接往下走）。
    err(
      `start-warning: kind=${kind} — 无活 supervisor 但盘上仍有未退出的旧进程（remaining pid=[${orphan.remaining.join(",")}]）；` +
      `⛔ 其 pid 载体已保留（核对：ps -o pid,ppid,stat,cmd -p ${orphan.remaining.join(",")}）。\n`,
    );
  }
  rmCarrierUnlessForeignLive(st.driverPidFile, null);
  rmCarrierUnlessForeignLive(st.supervisorPidFile, null);
  // ⛔ stop sentinel 必须清掉（`stopLegacyPair` 会写它）：留着会让下面刚 spawn 的 supervisor 在它的
  // driver 一退出时就 exit(0)（那是「刚起来就自己停了」的静默失败）。
  try { fs.rmSync(st.stopSentinel, { force: true }); } catch { /* ignore */ }
  const runId = opts.runId || `${spec.runPrefix}-${Math.floor(Date.now() / 1000)}`;

  // spawn detached supervisor（Node 侧等价原语：spawn(detached:true, stdio:["ignore",fd,fd]).unref()
  // ≡ setsid+nohup）。supervisor 的 cmdline 载体 = 本 kernel 的绝对路径（⛔ 非 worktree 路径）。
  // ⛔ detached supervisor 绝不可继承调用者的 stdout/stderr：fallback 到 fd 2（stderr）会让 spawnSync
  // 调用者等不到 pipe EOF 而 ETIMEDOUT（gap-driver-runtime-test-fixture-driver-not-reclaimed：测试
  // fixture 的 root 无 .quay ⇒ openSync 失败 ⇒ fallback 2 ⇒ start 挂死 ⇒ t.after 回收永不执行）。
  // 先 mkdir .quay 使 supLogFd 能开成真实文件；开失败仍退回 /dev/null，⛔ 不退回 stderr。
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  let supLogFd: number;
  try {
    supLogFd = fs.openSync(st.supervisorLog, "a");
  } catch {
    supLogFd = fs.openSync("/dev/null", "w");
  }
  const supArgs = [
    process.execPath, "--experimental-strip-types", kernelSelfPath(), "__supervise",
    "--kind", kind, "--root", root,
  ];
  if (opts.cap) supArgs.push("--cap", opts.cap);
  if (spec.hasInterval && opts.interval) supArgs.push("--interval", opts.interval);
  if (spec.hasReconcile && opts.reconcileInterval) supArgs.push("--reconcile-interval", opts.reconcileInterval);
  supArgs.push("--restart-delay", String(opts.restartDelaySecs), "--run-id", runId);

  const sup = spawn(supArgs[0], supArgs.slice(1), {
    detached: true,
    stdio: ["ignore", supLogFd, supLogFd],
    env: process.env,
  });
  sup.unref();
  if (sup.pid) writePidFile(st.supervisorPidFile, sup.pid);

  // ── 存活确认（见本函数头注释：三种取值分开，⛔ 不以窗口当死亡判据）────────────────────────────
  // 决断信号用 spawn 句柄的 exit 事件（直接量），⛔ 不用 pidAlive(sup.pid)：被 spawn 的子进程在
  // 未回收前仍是可 signal 的僵尸 ⇒ kill -0 对「已死但未 reap」返回成功（硬规则 4b：代理量与它要
  // 代表的东西脱节）。
  let supervisorExited = false;
  sup.on("exit", () => { supervisorExited = true; });
  const v = await awaitDriverConfirmation(root, kind, { supervisorGone: () => supervisorExited, confirmSecs });
  if (v.verdict === "confirmed") {
    out(`started: supervisor pid=${sup.pid ?? "?"} kind=${kind} run_id=${runId} driver pid=${v.driverPid ?? "?"} confirmed_ms=${v.elapsedMs}\n`);
    return statusForKind(root, kind, true, out);
  }
  reportUnconfirmed(root, kind, v, confirmSecs, err);
  return 1;
}

/** 读该 kind 的**【旧形态】两张 pid 载体**（supervisor / driver）并解析成 pid。
 *  ⛔ 本函数**不读 in-flight 载体**：worker 的在飞子进程是独立 OS 进程，`stop` 的语义是「杀调度者，
 *  ⛔ 不是在跑的工作」（SPEC §6.9 不变式 3）——凡是拆除旧 pair 的路径都必须守着这一条。 */
export function legacyCarrierPids(root: string, kind: DriverKind): { supervisorPid: number | null; driverPid: number | null } {
  const st = statePaths(root, kind);
  const sup = readPidFile(st.supervisorPidFile);
  const drv = readPidFile(st.driverPidFile);
  return {
    supervisorPid: /^\d+$/.test(sup) ? Number(sup) : null,
    driverPid: /^\d+$/.test(drv) ? Number(drv) : null,
  };
}

/** 该 kind 是否由 anchor 形态拥有（决定 stop 走哪条路）。**三态判据**：
 *  ① driver pid 文件已被 anchor 接管 ⇒ 是；
 *  ② workspace 已声明 anchor 期望态（`.quay/anchor-desired.json` 存在）**且盘上没有任何活着的
 *     【旧形态】进程**（supervisor 载体、或一个不是 anchor 自己的 driver 载体）⇒ 是
 *     （anchor 可能正崩在重拉间隙，此时仍走 anchor 路径——⛔ 不因「anchor 恰好死了」就回落到杀 supervisor）；
 *  ③ 其余 ⇒ 否（旧多进程 supervisor 形态，或旧形态的孤儿 driver）。
 *  ⛔ 「读不懂期望态」（文件在但 JSON 坏）由 readDesired 返回 null 表达 ⇒ 落 ③，与本函数的语义一致。
 *
 *  ⚠️ ② 里「**不是 anchor 自己的** driver 载体」这一条是
 *  `gap-driver-restart-unreliable-legacy-to-anchor-migration` 的根因修复点，⛔ 不是修饰：旧实现只看
 *  supervisor 载体，于是「期望态文件存在（**任意一个** kind 已经迁移过就会存在）∧ 没有活 supervisor
 *  载体」被当作「anchor 所有这个 kind」。legacy→anchor 迁移期恰好常处于这个形状（旧的 supervisor 先
 *  退出、它的 driver 还活着，或那两张载体已被上一次拆除删掉）⇒ `stop --kind X` 走 anchor 路径，
 *  而 anchor 路径**一个信号都不发给遗留 pid**、只把两张载体删掉 ⇒ 活着的旧 loop 变成盘上不可见的孤儿，
 *  与新的 anchor loop 同时派发（生产实测：四组 supervisor+driver 在 restart 返回 60s 后仍活，`goal`
 *  的旧进程 8 分钟以上仍在写同一个 `goal-round.jsonl`）。
 *  ⇒ 判据必须问「**盘上还有没有活着的旧形态进程**」，⛔ 不能问「有没有活 supervisor 载体」
 *  （载体是**循环的产物**，会在拆除/收尾时被删——同 `anchorHosts` 的注释）。 */
function anchorOwns(root: string, kind: DriverKind): boolean {
  if (anchorHosts(root, kind).hosted) return true;
  if (readDesired(root) === null) return false;
  const anchorPid = readAnchorPid(root);
  const { supervisorPid, driverPid } = legacyCarrierPids(root, kind);
  if (supervisorPid !== null && pidAlive(supervisorPid)) return false;
  if (driverPid !== null && driverPid !== anchorPid && pidAlive(driverPid)) return false;
  return true;
}

/** 停动词的**测试缝 + 生产缺省**参数（⛔ 缺省值就是生产值——见 driver-anchor 的 `reconcileMs` 等
 *  同名手法；测试用它把「宽限」压到毫秒级，⛔ 不改生产节奏）。 */
export interface StopOptions {
  /** 旧 pair 的 SIGTERM 宽限（缺省 10000 = 既有 `stop` 的 20×500ms，⛔ 不是新阈值）。 */
  legacyGraceMs?: number;
  /** SIGKILL 之后的确认窗口（缺省 2000）：杀完要**回读确认**，⛔ 不假设 SIGKILL 必然生效。 */
  legacyKillWaitMs?: number;
  /** 等 anchor 承载的该 kind 循环收尾的窗口（缺省 60000 = 既有值）。 */
  stopTimeoutMs?: number;
  /** 等 anchor 自身退出的确认窗口（缺省 30000 = 既有值）。 */
  anchorExitMs?: number;
}

const LEGACY_STOP_GRACE_MS = 10_000;
const LEGACY_STOP_POLL_MS = 250;
const LEGACY_KILL_WAIT_MS = 2_000;
const ANCHOR_LOOP_STOP_TIMEOUT_MS = 60_000;
const ANCHOR_EXIT_WAIT_MS = 30_000;

/** 拆除旧 pair 的**判别式结果**（⛔ 不是布尔）——「停掉了」/「本来就没跑」/「停不掉」三者必须
 *  不同形（硬规则 3b；同族先例 `start-drivers.ts` 的 `stopServeHost`：could-not-stop 永不报成
 *  stopped）。`still-running` 那一支的调用方**必须**把它当失败上报，⛔ 不得继续 start。 */
export interface LegacyStopResult {
  state: "stopped" | "not-running" | "still-running";
  /** 本次拆除中送过信号的 pid（含旧 supervisor 在期间**重拉出来的新** driver pid）。 */
  signalled: number[];
  /** `still-running` 时到点仍活着的 pid。 */
  remaining: number[];
}

/** 拆除该 kind 的**旧形态 supervisor+driver pair**（阶段 C 之前的多进程形态）。
 *
 *  与旧 `stopKind` legacy 分支的三点差别，逐条都是本任务要修的可靠性缺陷：
 *   ① **每轮重读载体**（旧实现只在入口快照一次）⇒ 旧 supervisor 在宽限内重拉出来的**新** driver
 *      pid 会被看见并一起停掉；旧实现看不见它，于是「命令返回了、新 driver 还活着」——正是
 *      「报成功但旧进程树没退出」的直接成因。
 *   ② **SIGKILL 之后回读确认**（旧实现杀完即 `return 0`，⛔ 不验证）⇒ 返回值从此承载真实结论；
 *      杀不掉时返回 `still-running` + pid 清单，⛔ 不假装 `stopped`。
 *   ③ **确认不在之前不摘载体**（旧实现在没把握时照样删两张 pid 文件）⇒ 一个活着的进程不会因为
 *      记录被删而变成盘上不可见的孤儿（这正是生产里 8 分钟以上的 `goal` 旧进程的成因）。
 *
 *  ⛔ 信号只发给**本函数观察到的 carrier pid**：不扫 `/proc`、不按名字匹配、**从不碰 in-flight 载体**
 *  ⇒ worker 的在飞子进程（独立 OS 进程）在任何分支下都不受影响（SPEC §6.9 不变式 3，AC5）。
 *  `excludePid` 用于 anchor 承载路径：收敛形态下 `pidSelf=false` 的 worker 其 driver 载体里写的
 *  **就是 anchor 自己的 pid**，那不是遗留进程（⛔ 不排除它就会把 anchor 自己 SIGTERM 掉）。 */
export async function stopLegacyPair(
  root: string,
  kind: DriverKind,
  opts: {
    graceMs?: number;
    killWaitMs?: number;
    excludePid?: number | null;
    /** 测试缝：发信号的实现（缺省 `process.kill`）。存在的理由和 `invokeKind` / `maxReconcilePasses`
     *  一样——`still-running` 那一支在真实 OS 上**不可确定地制造**（SIGKILL 杀不掉一个普通进程），
     *  而「停不掉」必须与「停掉了」不同形是这个修复的核心契约之一 ⇒ 它不能被留成一条没测过的分支。 */
    signalFn?: (pid: number, sig: "SIGTERM" | "SIGKILL") => void;
  } = {},
): Promise<LegacyStopResult> {
  const st = statePaths(root, kind);
  const graceMs = Math.max(0, opts.graceMs ?? LEGACY_STOP_GRACE_MS);
  const killWaitMs = Math.max(0, opts.killWaitMs ?? LEGACY_KILL_WAIT_MS);
  const excludePid = opts.excludePid ?? null;
  const signalFn = opts.signalFn ?? ((pid: number, sig: "SIGTERM" | "SIGKILL") => { process.kill(pid, sig); });
  // stop sentinel：让还活着的旧 supervisor 在它的 child 退出时**退出**而不是重拉（与旧 stop 逐字同）。
  try { fs.writeFileSync(st.stopSentinel, "\n", "utf8"); } catch { /* ignore */ }

  // `seen` 只增不减：一个 pid 一旦在**载体里出现过**就一直是本函数的目标，即使那张载体随后被删
  // （载体被删而进程还活着，正是本任务要覆盖的形状）。每轮重读载体 ⇒ 重拉出的新 pid 也进 seen。
  const seen = new Set<number>();
  const signalled: number[] = [];
  const refresh = (): number[] => {
    const { supervisorPid, driverPid } = legacyCarrierPids(root, kind);
    for (const p of [supervisorPid, driverPid]) if (p !== null && p !== excludePid) seen.add(p);
    return [...seen].filter((p) => pidAlive(p));
  };
  const deadline = Date.now() + graceMs;
  for (;;) {
    const live = refresh();
    if (live.length === 0) break;
    for (const p of live) {
      if (signalled.includes(p)) continue;
      try { signalFn(p, "SIGTERM"); signalled.push(p); } catch { /* already gone */ }
    }
    if (Date.now() >= deadline) break;
    await sleep(LEGACY_STOP_POLL_MS);
  }
  // 到点仍在 ⇒ **确定性升级** SIGKILL（⛔ 只针对本函数观察到的 carrier pid）。
  let remaining = refresh();
  if (remaining.length > 0) {
    for (const p of remaining) { try { signalFn(p, "SIGKILL"); } catch { /* already gone */ } }
    await sleep(killWaitMs);
    remaining = refresh();
  }
  if (remaining.length > 0) {
    // ⛔ 载体**刻意保留**：这是一个活进程在盘上唯一的记录（`anchorOwns` 也靠它把下一次 stop 引回
    // legacy 路径）。删了它 = 下一次 restart 起第二个 loop 而没有任何东西记得第一个还在。
    return { state: "still-running", signalled, remaining };
  }
  // 确认不在 ⇒ 摘载体（死 pid 会让「已经停了」与「在跑」同形，硬规则 3b）。
  // ⛔ 但**任何指向活进程的载体都不摘**——包括写着 anchor 自己 pid 的那张（收敛形态下 worker 的
  // driver 载体由 anchor 写、pidSelf 类 kind 由跑在 anchor 里的驱动写）：本函数只负责**遗留**进程，
  // 它没有资格判定「anchor 自己的标记该不该留」，那是调用方的收尾（`stopKindViaAnchor`）的事。
  rmCarrierUnlessForeignLive(st.driverPidFile, null);
  rmCarrierUnlessForeignLive(st.supervisorPidFile, null);
  try { fs.rmSync(st.stopSentinel, { force: true }); } catch { /* ignore */ }
  return { state: signalled.length > 0 ? "stopped" : "not-running", signalled, remaining: [] };
}

/** 摘掉一张 pid 载体，**除非它指向一个活着的、且 pid ≠ `ownPid` 的进程**。两个条件都是必须的：
 *  · 指向**外来的**活进程的载体 = 那个进程在盘上唯一的记录（⛔ 旧实现无条件删两张载体 ⇒ 盘上若还有
 *    活着的旧进程，删完就成了不可见孤儿 —— 本任务修的正是这个）；
 *  · `ownPid`（= anchor 自己）是**已知写者**，它的标记可以摘 —— 不摘会让下一次 `start` 读到一个假
 *    的 `already-running`（gap-driver-status-misreports 的同族形态）。 */
function rmCarrierUnlessForeignLive(file: string, ownPid: number | null): void {
  const raw = readPidFile(file);
  const pid = /^\d+$/.test(raw) ? Number(raw) : null;
  if (pid !== null && pid !== ownPid && pidAlive(pid)) return; // 外来的活进程 ⇒ 留痕，⛔ 不删
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
}

/** 阶段 C 的 stop 路径（anchor 承载）：从期望态里摘掉该 kind ⇒ anchor 只停**那一个**循环。
 *
 *  ⛔ 关键语义（§6.9 不变式 2/3，AC6）：停 `worker` 时其余五个 kind 的循环**不受影响**（它们住在同一个
 *  anchor 进程里，但各有独立的停机信号——`requestKindStop`），而 worker 的在飞子进程是**独立 OS 进程**，
 *  本函数一行都不碰它们（与旧 `quay driver stop` 的硬停语义逐字相同：杀的是调度者，⛔ 不是在跑的工作）。
 *  集群里若还有别的 kind 被声明，anchor 进程继续活着；一个 kind 都不剩才停 anchor 自身。
 *
 *  ⚠️ `gap-driver-restart-unreliable-legacy-to-anchor-migration`：本函数开头**先真的停掉遗留 pair**
 *  （`stopLegacyPair`）。旧实现在这一支里只删两张载体、⛔ 一个信号都不发 ⇒ 只要 anchor 声称托管了该
 *  kind 而旧的 supervisor+driver 还活着（legacy→anchor 迁移期的实测形态），两份 loop 就会一直同时跑。 */
async function stopKindViaAnchor(
  root: string,
  kind: DriverKind,
  out: (s: string) => void,
  opts: StopOptions = {},
): Promise<number> {
  const st = statePaths(root, kind);
  const anchorPid0 = readAnchorPid(root);
  // ① 遗留 pair 先真的停掉（⛔ 与「谁拥有这个 kind」无关：盘上有活着的旧进程就必须先停干净）。
  const legacy = await stopLegacyPair(root, kind, {
    graceMs: opts.legacyGraceMs,
    killWaitMs: opts.legacyKillWaitMs,
    excludePid: anchorPid0,
  });
  if (legacy.state === "still-running") {
    process.stderr.write(
      `stop-failed: kind=${kind} — 旧 supervisor/driver pair 在宽限内未能退出（remaining pid=[${legacy.remaining.join(",")}]，` +
      `signalled=[${legacy.signalled.join(",")}]）。⛔ 旧形态载体**保留**（那是一个活进程在盘上唯一的记录）。` +
      `核对：ps -o pid,ppid,stat,cmd -p ${legacy.remaining.join(",")}\n`,
    );
    return 1;
  }
  if (legacy.state === "stopped") {
    // 独立取值（⛔ 不与 `not-running` 同形）：确实停掉了东西，但停的是**遗留 pair**，不是 anchor 的循环。
    out(`stopped-legacy: kind=${kind} — 旧 supervisor/driver pair pids=[${legacy.signalled.join(",")}] 已退出\n`);
  }

  const before = aliveness(root, kind);
  if (!before.running) {
    // ⛔「本来就没跑」与「刚停掉」必须不同形（硬规则 3b）。
    // 清理残留的 pid 载体（anchor 崩溃留下的死 pid 文件会让下一次 start 读到假读数）。
    // ⛔ 但只摘**死的或 anchor 自己的**：一张指向**外来**活进程的载体是那个进程在盘上唯一的记录。
    rmCarrierUnlessForeignLive(st.driverPidFile, anchorPid0);
    out(legacy.state === "stopped" ? "stopped\n" : "not-running\n");
    return 0;
  }
  const remaining = updateDesired(root, kind, false, "quay-driver-stop");
  // 等该 kind 的循环收尾（anchor 摘掉 pid 文件 = 循环已退出的直接量）。
  const stopTimeoutMs = Math.max(0, opts.stopTimeoutMs ?? ANCHOR_LOOP_STOP_TIMEOUT_MS);
  const deadline = Date.now() + stopTimeoutMs;
  while (Date.now() < deadline) {
    if (!aliveness(root, kind).running) break;
    await sleep(250);
  }
  const stillRunning = aliveness(root, kind).running;
  // 一个 kind 都不剩 ⇒ anchor 自身也可以停了（⛔ 不与「还有别的 kind 要跑」同形）。
  const anchorPid = readAnchorPid(root);
  if (remaining.length === 0 && anchorPid !== null && pidAlive(anchorPid)) {
    try { process.kill(anchorPid, "SIGTERM"); } catch { /* gone */ }
    const adl = Date.now() + Math.max(0, opts.anchorExitMs ?? ANCHOR_EXIT_WAIT_MS);
    while (pidAlive(anchorPid) && Date.now() < adl) await sleep(200);
    if (pidAlive(anchorPid)) { try { process.kill(anchorPid, "SIGKILL"); } catch { /* gone */ } }
    // ⛔ 只摘**已经不在的** anchor.pid（5b 扫描的同族第三例）：anchor 若扛住了 SIGKILL，删它这张载体
    // 会把一个活着的 anchor 变成盘上不可见的进程——正是本任务修的那个形态。
    rmCarrierUnlessForeignLive(anchorPaths(root).pidFile, null);
    try { fs.rmSync(anchorPaths(root).stateFile, { force: true }); } catch { /* ignore */ }
  }
  rmCarrierUnlessForeignLive(st.driverPidFile, anchorPid0);
  rmCarrierUnlessForeignLive(st.supervisorPidFile, anchorPid0);
  try { fs.rmSync(st.stopSentinel, { force: true }); } catch { /* ignore */ }
  if (stillRunning) {
    process.stderr.write(
      `stop-failed: kind=${kind} — 该 kind 的循环在 ${stopTimeoutMs}ms 内未收尾（anchor pid=${anchorPid ?? "none"}）。` +
      `⛔ 本条**不报成 not-running**：循环仍在 ⇒ 接着 start 会得到两份 loop（双派发）。` +
      `锚日志尾:\n`,
    );
    process.stderr.write(`${fileTailLines(anchorPaths(root).logFile) || "(anchor 日志为空/读不到 —— ⛔ 这不等于「无死因」)"}\n`);
    return 1;
  }
  out("stopped\n");
  return 0;
}

/** stop（硬停：杀 supervisor + 驱动；⛔ 不杀 worker 在飞子进程）。 */
export async function stopKind(
  root: string,
  kind: DriverKind,
  out: (s: string) => void = (s) => process.stdout.write(s),
  opts: StopOptions = {},
): Promise<number> {
  // SPEC §7 阶段 C：anchor 承载时，`stop --kind X` 只停 X 的循环（⛔ 不杀 anchor ⇒ 其余 kind 不受影响）。
  if (process.env.QUAY_DRIVER_LEGACY_SUPERVISOR !== "1" && anchorOwns(root, kind)) {
    return await stopKindViaAnchor(root, kind, out, opts);
  }
  const r = await stopLegacyPair(root, kind, { graceMs: opts.legacyGraceMs, killWaitMs: opts.legacyKillWaitMs });
  if (r.state === "still-running") {
    process.stderr.write(
      `stop-failed: kind=${kind} — 旧 supervisor/driver pair 在 SIGTERM 宽限 + SIGKILL 确认之后仍在运行` +
      `（remaining pid=[${r.remaining.join(",")}]，signalled=[${r.signalled.join(",")}]）。` +
      `⛔ 本条不报 \`stopped\`（「停不掉」与「停掉了」必须不同形）。核对：ps -o pid,ppid,stat,cmd -p ${r.remaining.join(",")}\n`,
    );
    return 1;
  }
  out(r.state === "stopped" ? "stopped\n" : "not-running\n");
  return 0;
}

/** drain（AC150-2）：halt 语义——写 <kind>-control.json halted=true。halt 的效果是【每 kind 自己的闸】：
 *  1a 类（promotion/worker）读到 halt ⇒ 本轮 break 退出；例程型（goal/quality/outer/meta）读到
 *  halt ⇒ 只挡受闸动作（spawn），观测循环继续（gap-drain-on-routine-driver-empties-round-and-respawn-
 *  loops——⛔ 不再整进程退出）。两种都【不杀在飞 worker】。读-改-写经 driver-shared 单一真相源
 *  （保留 preference/forced，不破坏用户控制态）。 */
export function drainKind(root: string, kind: DriverKind, out: (s: string) => void = (s) => process.stdout.write(s)): number {
  const spec = DRIVER_KINDS[kind];
  const rel = path.posix.join(".quay", spec.controlFile);
  const { state, parseError } = readControlState(root, process.env, rel);
  if (parseError) {
    process.stderr.write(`driver-runtime: drain: could not read ${path.join(root, rel)}: ${parseError}\n`);
    return 2;
  }
  const next = applyHalt(state, "quay-driver-drain", true);
  const file = writeControlState(root, next, rel);
  out(`drained: ${kind} halted (no new dispatch; in-flight workers untouched) — control state at ${file}\n`);
  return 0;
}

/** resume（drain 的逆操作，gap-driver-drain-no-inverse AC1）：写 <kind>-control.json halted=false，解闸。
 *  纯文件操作、driver 停着也能写（与 drain 同性质）。读-改-写经 driver-shared 单一真相源
 *  （applyHalt(state, caller, false) 只清 halted/halted_by/halted_at，保留 preference/forced）。 */
export function resumeKind(root: string, kind: DriverKind, out: (s: string) => void = (s) => process.stdout.write(s)): number {
  const spec = DRIVER_KINDS[kind];
  const rel = path.posix.join(".quay", spec.controlFile);
  const { state, parseError } = readControlState(root, process.env, rel);
  if (parseError) {
    process.stderr.write(`driver-runtime: resume: could not read ${path.join(root, rel)}: ${parseError}\n`);
    return 2;
  }
  const next = applyHalt(state, "quay-driver-resume", false);
  const file = writeControlState(root, next, rel);
  out(`resumed: ${kind} halt cleared (new dispatch re-enabled) — control state at ${file}\n`);
  return 0;
}

/** restart = **确认停干净之后的** start。
 *
 *  ⚠️ `gap-driver-restart-unreliable-legacy-to-anchor-migration`：旧实现 `await stopKind(...)` 后
 *  **丢弃返回值**、无条件 start。于是 legacy→anchor 迁移期最危险的那种形状——stop 报「旧进程树还在」
 *  ——恰恰会继续走到 start，把该 kind 加进 anchor 期望态 ⇒ **两份 loop 同时跑同一个 kind**，而命令的
 *  退出码与输出（`started:` / `already-running:` / `start-pending:`）读起来都像一次重启的产物，人无法
 *  从中看出旧 loop 没死（生产实证：四组旧 supervisor+driver 在 restart 返回 60s 后仍活）。
 *  ⇒ 现在 stop 未确认干净（非 0）就**中止**，⛔ 不起新循环；退出码 1 = 「重启没发生」，是可信的。
 *  这也让 `restart --kind X` 的判据与 DoD 一致：0 ⇔ 旧进程树已消失 ∧ 新循环已确认就绪。 */
export async function restartKind(
  root: string,
  kind: DriverKind,
  opts: StartOptions & StopOptions,
  out: (s: string) => void = (s) => process.stdout.write(s),
  err: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> {
  const stopRc = await stopKind(root, kind, out, {
    legacyGraceMs: opts.legacyGraceMs,
    legacyKillWaitMs: opts.legacyKillWaitMs,
    stopTimeoutMs: opts.stopTimeoutMs,
    anchorExitMs: opts.anchorExitMs,
  });
  if (stopRc !== 0) {
    err(
      `restart-aborted: kind=${kind} — stop 未确认旧进程树已退出（exit=${stopRc}）；⛔ 不起新循环（否则与旧 loop 双派发）。` +
      `按上面的 stop-failed 行核对 pid；确认旧进程消亡后重跑 \`quay driver restart --kind ${kind}\`。\n`,
    );
    return 1;
  }
  return startKind(root, kind, opts, out, err);
}

// ── CLI（本 kernel 是 supervisor + 状态操作的【真正实现入口】，cli/driver.ts 直接 import 调用）──────

const VERBS = ["start", "stop", "drain", "resume", "status", "restart", "liveness", "__supervise"];

function parseKernelArgs(argv: string[]) {
  const args = argv.slice(2);
  const cmd = args[0] ?? "start";
  let kind = "promotion";
  let root = "";
  let interval: string | undefined;
  let reconcileInterval: string | undefined;
  let cap: string | undefined;
  let restartDelay = "5";
  let runId: string | undefined;
  let confirmTimeout: string | undefined;
  let json = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--kind") kind = args[++i];
    else if (a === "--root") root = args[++i];
    else if (a === "--interval") interval = args[++i];
    else if (a === "--reconcile-interval") reconcileInterval = args[++i];
    else if (a === "--cap") cap = args[++i];
    else if (a === "--restart-delay") restartDelay = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--confirm-timeout") confirmTimeout = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") return { help: true } as const;
    else return { error: `driver-runtime: unknown argument: ${a}` } as const;
  }
  return { cmd, kind, root, interval, reconcileInterval, cap, restartDelay, runId, confirmTimeout, json };
}

function isNonNegInt(s: string): boolean {
  return /^\d+$/.test(s);
}

/** 本 kernel 的 CLI 入口（`node … driver-runtime.ts <verb> --kind … --root …`）。行为与旧 .sh 对齐：
 *  退出 0 = 成功/健康；1 = 运行/停止失败/liveness 检出死亡；2 = 参数错误。 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseKernelArgs(argv);
  if ("help" in parsed && parsed.help) {
    process.stdout.write(`driver-runtime — AC151 Layer 0 kernel（supervisor 港进 TS 的真正实现入口）

Usage:
  node --experimental-strip-types plugin/scripts/driver-runtime.ts <start|stop|drain|resume|status|restart|liveness> \\
    --kind <promotion|worker|outer|quality|meta|goal> [--root <repo>] [--interval <ms>] [--reconcile-interval <s>] [--cap <n>] \\
    [--restart-delay <s>] [--run-id <id>] [--confirm-timeout <s>] [--json]

  --confirm-timeout <s>  start/restart 的【存活确认窗口】(default ${DEFAULT_CONFIRM_TIMEOUT_SECS})。窗口内确认 supervisor+driver
                         双活 ⇒ \`started:\` 且退出 0；supervisor 进程已退出且无 driver ⇒ \`start-failed:\` 且退出 1
                         并贴出 supervisor 日志尾；窗口用尽而 supervisor 仍活 ⇒ \`start-pending:\`（⛔ 不是死亡判定）。

stop/restart 的【旧进程树确认】（gap-driver-restart-unreliable-legacy-to-anchor-migration）：
  ⛔ 退出 0 的 \`stopped\` 表示**盘上已无活着的旧形态 supervisor/driver**（每轮重读载体 ⇒ 旧 supervisor
  重拉出的新 driver 也算；SIGTERM 宽限 ${LEGACY_STOP_GRACE_MS}ms → SIGKILL → 回读确认）。停不干净 ⇒
  \`stop-failed:\` + 仍活的 pid 清单 + 退出 1，且**旧形态载体被保留**（那是一个活进程在盘上唯一的记录）。
  \`restart\` 在 stop 非 0 时**中止**（⛔ 不起新循环 ⇒ 不会与旧 loop 双派发），退出 1 = 「重启没发生」。
  worker 的在飞子进程是独立 OS 进程，任何分支都不受影响（只发信号给本 kind 的 pid 载体里的进程）。
`);
    return 0;
  }
  if ("error" in parsed && parsed.error) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }

  const { cmd, kind, root: rawRoot, interval, reconcileInterval, cap, restartDelay, runId, confirmTimeout, json } = parsed;

  if (!KNOWN_KINDS.includes(kind as DriverKind)) {
    process.stderr.write(`driver-runtime: unknown --kind: ${kind || "<empty>"} (expected ${KNOWN_KINDS.join("|")})\n`);
    return 2;
  }
  const k = kind as DriverKind;
  const spec = DRIVER_KINDS[k];

  if (cmd !== "__supervise" && !spec.verbs.includes(cmd)) {
    process.stderr.write(`driver-runtime: kind ${k} does not support '${cmd}' (supports: ${spec.verbs.join(" ")})\n`);
    return 2;
  }

  const rootDir = rawRoot ? path.resolve(rawRoot) : path.resolve(process.cwd());
  if (!fs.existsSync(rootDir)) {
    process.stderr.write(`driver-runtime: invalid --root: ${rootDir}\n`);
    return 2;
  }

  // 稳定承载（AC1）：worktree → 主检出规范化（可观测，不静默）。
  const mainRoot = resolveMainRoot(rootDir);
  if (mainRoot !== rootDir) {
    process.stderr.write(`driver-runtime: relocating carrier worktree=${rootDir} → main=${mainRoot}\n`);
  }
  const root = mainRoot;

  // 轻量校验（正整数/零——驱动自己还会二次校验；此处只防「坏配置 → 重启死循环」）。
  if (interval !== undefined && !isNonNegInt(interval)) {
    process.stderr.write(`driver-runtime: invalid --interval: ${interval}\n`);
    return 2;
  }
  if (reconcileInterval !== undefined && !isNonNegInt(reconcileInterval)) {
    process.stderr.write(`driver-runtime: invalid --reconcile-interval: ${reconcileInterval}\n`);
    return 2;
  }
  if (cap !== undefined && !isNonNegInt(cap)) {
    process.stderr.write(`driver-runtime: invalid --cap: ${cap}\n`);
    return 2;
  }
  if (!isNonNegInt(restartDelay)) {
    process.stderr.write(`driver-runtime: invalid --restart-delay: ${restartDelay}\n`);
    return 2;
  }
  if (confirmTimeout !== undefined && !isNonNegInt(confirmTimeout)) {
    process.stderr.write(`driver-runtime: invalid --confirm-timeout: ${confirmTimeout}\n`);
    return 2;
  }

  const restartDelaySecs = Number(restartDelay);
  const confirmTimeoutSecs = confirmTimeout === undefined ? undefined : Number(confirmTimeout);
  const out = (s: string) => process.stdout.write(s);
  const err = (s: string) => process.stderr.write(s);

  switch (cmd) {
    case "start":
      return await startKind(root, k, { cap, interval, reconcileInterval, restartDelaySecs, runId, confirmTimeoutSecs }, out, err);
    case "stop":
      return await stopKind(root, k, out);
    case "drain":
      return drainKind(root, k, out);
    case "resume":
      return resumeKind(root, k, out);
    case "status":
      return statusForKind(root, k, json, out);
    case "liveness":
      return livenessForKind(root, k, json, out);
    case "restart":
      return await restartKind(root, k, { cap, interval, reconcileInterval, restartDelaySecs, runId, confirmTimeoutSecs }, out, err);
    case "__supervise": {
      const supervisorRunId = runId || `${spec.runPrefix}-${Math.floor(Date.now() / 1000)}`;
      return await runSupervisor({ root, kind: k, cap, interval, reconcileInterval, restartDelaySecs, runId: supervisorRunId });
    }
    default:
      process.stderr.write(`driver-runtime: unknown command: ${cmd} (expected ${VERBS.join("|")})\n`);
      return 2;
  }
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "driver-runtime")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
