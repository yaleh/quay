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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0 · 主检出推导（order-independent，gap-main-checkout-root-derivation-recurs-three-sites）。
import { mainCheckoutRoot } from "./repo-root.ts";
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

/** `kill -0` 等价：pid 存活判定（读不懂 / 非正整数 ⇒ false）。 */
export function pidAlive(pid: string | number | null | undefined): boolean {
  if (pid === null || pid === undefined || pid === "") return false;
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

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

/** 本 kernel 文件的绝对路径（supervisor 自重启的 cmdline 载体：`node … driver-runtime.ts __supervise`）。 */
export function kernelSelfPath(): string {
  return fileURLToPath(import.meta.url);
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

/** 解析本 kernel 的一个 sibling 脚本到可运行形态：原始 .ts（dev tree，用 --experimental-strip-types 跑）
 *  或 bundled dist/<name>.js（installed artifact，纯 ESM，不带 flag 跑）。两者都不在 ⇒ null（调用方
 *  fail-closed）。⛔ 不锚在 opts.root（AC-203）。 */
export function resolveKernelSibling(name: string): { path: string; stripTypes: boolean } | null {
  const dir = resolveKernelScriptsDir();
  const raw = path.join(dir, name);
  if (fs.existsSync(raw)) return { path: raw, stripTypes: true };
  if (name.endsWith(".ts")) {
    const js = name.replace(/\.ts$/, ".js");
    const bundledDir = path.basename(dir) === "dist" ? dir : path.join(dir, "dist");
    const bundled = path.join(bundledDir, js);
    if (fs.existsSync(bundled)) return { path: bundled, stripTypes: false };
  }
  return null;
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
          }
        }
      } catch {
        /* torn/partial tail — skip */
      }
    }
  }
  return { records, lastTs, primaryPath, files };
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

export function anchorPaths(root: string): {
  pidFile: string;
  desiredFile: string;
  stateFile: string;
  logFile: string;
} {
  return {
    pidFile: path.join(root, ANCHOR_PID_REL),
    desiredFile: path.join(root, ANCHOR_DESIRED_REL),
    stateFile: path.join(root, ANCHOR_STATE_REL),
    logFile: path.join(root, ANCHOR_LOG_REL),
  };
}

/** 读 anchor pid（不存在/不可读/非正整数 ⇒ null）。 */
export function readAnchorPid(root: string): number | null {
  const raw = readPidFile(anchorPaths(root).pidFile);
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** 该 kind 是否由 anchor 承载：driver pid 文件里的 pid == anchor pid ∧ 该 pid 活着。
 *  ⛔ 这是**三态**判定，不是「有没有 supervisor 文件」——anchor 承载（true）与「supervisor 模型」
 *  （false）必须不同形，否则 `aliveness().running` 会在收敛后恒 false（把「在跑」读成「死了」）。 */
export function anchorHosts(root: string, kind: DriverKind): { hosted: boolean; anchorPid: number | null } {
  const anchorPid = readAnchorPid(root);
  if (anchorPid === null || !pidAlive(anchorPid)) return { hosted: false, anchorPid: null };
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
  return next;
}

/** 解析 anchor 内核可执行文件的**优选**路径。
 *
 *  优先级（GOAL-017/AC-255）：① **主检出**的 `<mainRoot>/plugin/scripts/driver-anchor.{ts,js}` —— 收敛形态
 *  的**持久**落点（常驻 anchor ⛔ 不应把生存期绑在一个短命的 worktree 路径上：worktree 被回收后，
 *  任何一次 kind 重启都会 import 失败）；② 本内核的**兄弟文件**（`import.meta.url` 同目录）。
 *
 *  ⚠️ ① 存在但**就是本文件自己**时等同 ②（⛔ 不重复加载）。锚定 ② 而**不走 `QUAY_PLUGIN_ROOT`**：
 *  那是「第三方项目/夹具的 plugin/ 在哪」的缝，用它会让每个夹具都必须复制一份完整内核闭包；而 anchor
 *  要跑的是**内核自己的**代码（只有它托管的 kind 模块才可能来自 QUAY_PLUGIN_ROOT——那正是
 *  `invokeKindDefault` 用 resolveKernelSibling 的地方）。 */
export function preferredAnchorKernel(root: string): { path: string; stripTypes: boolean } | null {
  const here = path.dirname(kernelSelfPath());
  const selfTs = path.join(here, "driver-anchor.ts");
  const selfJs = path.join(here, "driver-anchor.js");
  let mainRoot = root;
  try {
    mainRoot = resolveMainRoot(root);
  } catch { /* 非 git / 推导失败 ⇒ 用 root 自身 */ }
  for (const candidate of [
    { p: path.join(mainRoot, "plugin", "scripts", "driver-anchor.ts"), strip: true },
    { p: path.join(mainRoot, "plugin", "scripts", "driver-anchor.js"), strip: false },
  ]) {
    if (candidate.p === selfTs || candidate.p === selfJs) continue;
    if (fs.existsSync(candidate.p)) return { path: candidate.p, stripTypes: candidate.strip };
  }
  if (fs.existsSync(selfTs)) return { path: selfTs, stripTypes: true };
  if (fs.existsSync(selfJs)) return { path: selfJs, stripTypes: false };
  return null;
}

/** 起一个 anchor 子进程（detached，setsid 等价）。返回 {pid, error}。⛔ 不继承调用者 stdout/stderr。 */
export function spawnAnchor(
  root: string,
  opts: { logFile?: string; takeoverPid?: number | null } = {},
): { pid: number | null; error: string | null } {
  const sibling = preferredAnchorKernel(root);
  if (!sibling) return { pid: null, error: `driver-anchor module not found next to driver-runtime (${path.dirname(kernelSelfPath())})` };
  const anchorLog = opts.logFile ?? anchorPaths(root).logFile;
  fs.mkdirSync(path.dirname(anchorLog), { recursive: true });
  let fd: number;
  try {
    fd = fs.openSync(anchorLog, "a");
  } catch {
    return { pid: null, error: `cannot open anchor log ${anchorLog}` };
  }
  const args = [
    process.execPath,
    ...(sibling.stripTypes ? ["--experimental-strip-types"] : []),
    sibling.path,
    "__anchor",
    "--root",
    root,
  ];
  if (opts.takeoverPid) args.push("--takeover", String(opts.takeoverPid));
  const child = spawn(args[0], args.slice(1), { detached: true, stdio: ["ignore", fd, fd], env: process.env });
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

/** LLM 调用配置解析单一构造点（role ∈ task-worker | selector | fix-worker）。经 L2 policy 解析
 *  语义 kind → profile，再出 argv。profile 缺失 / 非法 ⇒ loadProfiles 抛错（fail-closed，⛔ 不静默）。 */
export function launchArgv(role: string, prompt: string, root: string): string[] {
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
  argv.push("-n", resolved.name, "-p", prompt);
  return argv;
}

// ── Layer 0 · 异步 spawn 原语（runAsync，SPEC §5.7：循环体用 spawnSync 会冻住协调地板）──────────────

/** 异步 spawn（spawn 而非 spawnSync）：不阻塞事件循环，child exit 本身是一个唤醒源。collectStderr=true
 *  时捕获 stderr；缺省 stderr 丢弃。timeoutMs 到期 ⇒ SIGKILL child 并 resolve error；timeoutMs=Infinity
 *  ⇒ 无超时（unbounded，child exit/error 是唯一唤醒）——正确性锁的排队等待用（死持有者由调用侧的
 *  watchdog 兜底，不靠此处 SIGKILL）。永不 throw。 */
export async function runAsync(
  argv: string[],
  opts: { timeoutMs: number; collectStderr?: boolean } = { timeoutMs: 120_000 },
): Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }> {
  const { timeoutMs, collectStderr = false } = opts;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        stdio: ["ignore", "pipe", collectStderr ? "pipe" : "ignore"],
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

/** 被监视源码的最新 mtime（mtimeMs 的 max）。全部缺失/读失败 ⇒ 0——0 恒不大于 driver 启动时刻 ⇒
 *  不触发 respawn（与「未变更」同形；源码缺失本就是非 git root 测试临时目录的常态，⛔ 不是「无源码」）。
 *  源码目录锚在本 kernel 自身安装位置（⛔ 非 root —— AC-203）；installed artifact 只有 dist bundle、
 *  无原始 .ts ⇒ 恒 0 ⇒ 无自刷新（正确：装好的 bundle 是静态的，无源码可推进）。 */
export function sourceFilesMaxMtimeMs(_root: string, kind: DriverKind): number {
  let max = 0;
  const dir = resolveKernelScriptsDir();
  for (const rel of watchedSourceFiles(kind)) {
    try {
      const st = fs.statSync(path.join(dir, rel));
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch { /* 缺失 → 跳过 */ }
  }
  return max;
}

/** 源码是否推进到 sinceMs 之后（任一被监视文件 mtimeMs > sinceMs ⇒ true）。纯函数，可单测。 */
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
  /** 被监视源码最新 mtime（epoch ms；全部缺失 ⇒ 0）。 */
  sourceMtimeMs: number;
}

/** 判定一个 supervisor 是否陈旧：supervisor 启动时刻 vs 被监视源码最新 mtime。源码推进到启动时刻之后
 *  ⇒ stale（supervisor 内存里的 kernel 早于盘上源码，sourceCheck 只重启 driver、永远改不动它自己）。
 *  supervisor pid 缺失/已死/读不到启动时刻 ⇒ not-evaluated。 */
export function supervisorStaleness(
  root: string,
  kind: DriverKind,
  supervisorPid: number | null,
): SupervisorStaleness {
  const sourceMtimeMs = sourceFilesMaxMtimeMs(root, kind);
  if (supervisorPid === null || !pidAlive(supervisorPid)) {
    return { state: "not-evaluated", supervisorStartedAt: null, sourceMtimeMs };
  }
  const supervisorStartedAt = procStartTimeMs(supervisorPid);
  if (supervisorStartedAt === null) {
    return { state: "not-evaluated", supervisorStartedAt: null, sourceMtimeMs };
  }
  return {
    state: sourceMtimeMs > supervisorStartedAt ? "stale" : "fresh",
    supervisorStartedAt,
    sourceMtimeMs,
  };
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
    if (sourceChangedSince(opts.root, opts.kind, driverStartedAt)) {
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
 *  `driverAlive` 的含义取决于写者，见 driverPidIsReadinessMarker 的注释（⛔ 直接量 vs 代理量）。 */
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
  const driverPid = /^\d+$/.test(dpidRaw) ? Number(dpidRaw) : null;
  const supervisorAlive = supervisorPid != null && pidAlive(supervisorPid);
  const driverAlive = driverPid != null && pidAlive(driverPid);
  // AC-255（SPEC §7 阶段 C）：收敛后**没有 supervisor 进程**——该 kind 的常驻循环由 anchor 进程承载，
  // `.quay/<prefix>.pid` 写的是 anchor 的 pid（六个 kind 同一个 pid）。此时 `running` 的直接量是
  // 「承载进程活着 ∧ 该 kind 已被 anchor 接管」，⛔ 不是「supervisor ∧ driver 双活」（那会恒 false，
  // 把收敛后的「在跑」读成「死了」——硬规则 3b 的镜像：读不懂输入 ⇒ 报了一个假死亡）。
  const host = anchorHosts(root, kind);
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
  // driver 死：pid 文件在而进程不在。
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
    host: host.hosted ? "anchor" : "supervisor",
    anchorPid: host.anchorPid,
  };
}

/** status 输出（JSON 与人类可读两态）。alive 与 running 同值（alive 是 AC139-3 字段名，running 保留
 *  backward compat）。carrier_path / carrier_records / last_record_ts 三者同源（同一个 carrierStats 读数），
 *  carrier_path 为 null ⇔ 无任何载体存在 ⇔ records=0（⛔ 不报一个不存在的路径——AC1/AC2）。
 *  carrier_files 是逐载体分解（哪个存在/哪个没有/各多少行）：让「新旧载体名并存」在读数上可见。 */
export function statusForKind(root: string, kind: DriverKind, json: boolean, out: (s: string) => void): number {
  const spec = DRIVER_KINDS[kind];
  const a = aliveness(root, kind);
  const stats = carrierStats(root, kind);
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
      carrier_files: stats.files,
      supervisor_started_at: a.supervisorStartedAt,
      supervisor_stale: a.supervisorStale === true ? "stale" : a.supervisorStale === false ? "fresh" : "not-evaluated",
      // AC-255：宿主模型（anchor=收敛形态 / supervisor=旧多进程形态）+ anchor pid。⛔ 两者不同形。
      host: a.host,
      anchor_pid: a.anchorPid,
    }) + "\n");
  } else {
    out(
      `${spec.prefix}: kind=${kind} · host=${a.host} anchor_pid=${a.anchorPid ?? "none"} · ` +
      `supervisor pid=${a.supervisorPid ?? "none"} alive=${a.supervisorAlive ? 1 : 0} · ` +
      `driver pid=${a.driverPid ?? "none"} alive=${a.driverAlive ? 1 : 0} · running=${a.running ? 1 : 0} · ` +
      `supervisor_stale=${a.supervisorStale === true ? "stale" : a.supervisorStale === false ? "fresh" : "not-evaluated"} · ` +
      // ⛔ 不打印空串：显式 "null"（= 无载体存在），与 last_record_ts 的 null 表达同形（硬规则 3b）。
      `carrier_path=${stats.primaryPath ?? "null"} · carrier_records=${stats.records} · ` +
      `last_record_ts=${stats.lastTs ?? "null"} · ` +
      `carrier_files=${stats.files.map((f) => `${f.name}:${f.exists ? f.records : "missing"}`).join(",")}\n`,
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
/** 阶段 C 的 start 路径（anchor 承载）：声明期望态 → 确保 anchor 在跑 → 等该 kind 的循环就绪。
 *
 *  ⛔ 就绪判据（`aliveness().running`）在收敛形态下的含义**没有变弱**：五个 `pidSelf` kind 的
 *  `.quay/<prefix>.pid` 仍由**驱动自己**在进入常驻循环后写（`driverPidIsReadinessMarker`）；收敛只是把
 *  「那个 pid 是独立 driver 进程」换成「那个 pid 是承载它的 anchor 进程」——直接量没有变成代理量。
 *  worker（pidSelf=false）的 pid 文件与旧 supervisor 一样由宿主在起循环时写。 */
async function startKindViaAnchor(
  root: string,
  kind: DriverKind,
  opts: { cap?: string; interval?: string; reconcileInterval?: string; restartDelaySecs: number; runId?: string; confirmTimeoutSecs?: number },
  out: (s: string) => void,
  err: (s: string) => void,
): Promise<number> {
  const confirmSecs = Math.max(0, opts.confirmTimeoutSecs ?? DEFAULT_CONFIRM_TIMEOUT_SECS);
  const t0 = Date.now();

  const before = aliveness(root, kind);
  if (before.running) {
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

  // ③ 等该 kind 的循环就绪（直接量：它的 pid 文件 = 活着的 anchor pid）。anchor 进程死了 ⇒ 决断信号。
  for (;;) {
    const cur = aliveness(root, kind);
    if (cur.running) {
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
        `（driver pid=${cur.driverPid ?? "none"} alive=${cur.driverAlive ? 1 : 0}，host=${cur.host}，elapsed_ms=${Date.now() - t0}）。` +
        `⛔ 这不是死亡判定（慢启动 / 崩溃-重拉循环与此同形）；复读用 quay driver status --kind ${kind}。锚日志尾:\n`,
      );
      err(`${fileTailLines(anchorPaths(root).logFile) || "(anchor 日志为空/读不到 —— ⛔ 这不等于「无死因」)"}\n`);
      return 1;
    }
    await sleep(CONFIRM_POLL_MS);
  }
}

export async function startKind(
  root: string,
  kind: DriverKind,
  opts: { cap?: string; interval?: string; reconcileInterval?: string; restartDelaySecs: number; runId?: string; confirmTimeoutSecs?: number },
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
  const dpidRaw = readPidFile(st.driverPidFile);
  if (dpidRaw && pidAlive(dpidRaw)) {
    err(`orphan driver pid=${dpidRaw} (no live supervisor); killing\n`);
    try { process.kill(Number(dpidRaw), "SIGTERM"); } catch { /* gone */ }
    await sleep(1000);
  }
  for (const f of [st.driverPidFile, st.supervisorPidFile, st.stopSentinel]) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
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

/** 该 kind 是否由 anchor 形态拥有（决定 stop 走哪条路）。**三态判据**：
 *  ① driver pid 文件已被 anchor 接管 ⇒ 是；
 *  ② workspace 已声明 anchor 期望态（`.quay/anchor-desired.json` 存在）**且该 kind 没有活 supervisor** ⇒ 是
 *     （anchor 可能正崩在重拉间隙，此时仍走 anchor 路径——⛔ 不因「anchor 恰好死了」就回落到杀 supervisor）；
 *  ③ 其余 ⇒ 否（旧多进程 supervisor 形态）。
 *  ⛔ 「读不懂期望态」（文件在但 JSON 坏）由 readDesired 返回 null 表达 ⇒ 落 ③，与本函数的语义一致。 */
function anchorOwns(root: string, kind: DriverKind): boolean {
  if (anchorHosts(root, kind).hosted) return true;
  if (readDesired(root) === null) return false;
  const spid = readPidFile(statePaths(root, kind).supervisorPidFile);
  return !(spid && pidAlive(spid));
}

/** 阶段 C 的 stop 路径（anchor 承载）：从期望态里摘掉该 kind ⇒ anchor 只停**那一个**循环。
 *
 *  ⛔ 关键语义（§6.9 不变式 2/3，AC6）：停 `worker` 时其余五个 kind 的循环**不受影响**（它们住在同一个
 *  anchor 进程里，但各有独立的停机信号——`requestKindStop`），而 worker 的在飞子进程是**独立 OS 进程**，
 *  本函数一行都不碰它们（与旧 `quay driver stop` 的硬停语义逐字相同：杀的是调度者，⛔ 不是在跑的工作）。
 *  集群里若还有别的 kind 被声明，anchor 进程继续活着；一个 kind 都不剩才停 anchor 自身。 */
async function stopKindViaAnchor(
  root: string,
  kind: DriverKind,
  out: (s: string) => void,
): Promise<number> {
  const st = statePaths(root, kind);
  const before = aliveness(root, kind);
  if (!before.running) {
    // ⛔「本来就没跑」与「刚停掉」必须不同形（硬规则 3b）。
    // 清理残留的 pid 载体（anchor 崩溃留下的死 pid 文件会让下一次 start 读到假读数）。
    try { fs.rmSync(st.driverPidFile, { force: true }); } catch { /* ignore */ }
    out("not-running\n");
    return 0;
  }
  const remaining = updateDesired(root, kind, false, "quay-driver-stop");
  // 等该 kind 的循环收尾（anchor 摘掉 pid 文件 = 循环已退出的直接量）。
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!aliveness(root, kind).running) break;
    await sleep(250);
  }
  const stillRunning = aliveness(root, kind).running;
  // 一个 kind 都不剩 ⇒ anchor 自身也可以停了（⛔ 不与「还有别的 kind 要跑」同形）。
  const anchorPid = readAnchorPid(root);
  if (remaining.length === 0 && anchorPid !== null && pidAlive(anchorPid)) {
    try { process.kill(anchorPid, "SIGTERM"); } catch { /* gone */ }
    const adl = Date.now() + 30_000;
    while (pidAlive(anchorPid) && Date.now() < adl) await sleep(200);
    if (pidAlive(anchorPid)) { try { process.kill(anchorPid, "SIGKILL"); } catch { /* gone */ } }
    try { fs.rmSync(anchorPaths(root).pidFile, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(anchorPaths(root).stateFile, { force: true }); } catch { /* ignore */ }
  }
  try { fs.rmSync(st.driverPidFile, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(st.supervisorPidFile, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(st.stopSentinel, { force: true }); } catch { /* ignore */ }
  if (stillRunning) {
    process.stderr.write(`quay driver: kind=${kind} loop did not stop within 60s (anchor pid=${anchorPid ?? "none"})\n`);
    out("not-running\n");
    return 1;
  }
  out("stopped\n");
  return 0;
}

/** stop（硬停：杀 supervisor + 驱动；⛔ 不杀 worker 在飞子进程）。 */
export async function stopKind(root: string, kind: DriverKind, out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const st = statePaths(root, kind);
  // SPEC §7 阶段 C：anchor 承载时，`stop --kind X` 只停 X 的循环（⛔ 不杀 anchor ⇒ 其余 kind 不受影响）。
  if (process.env.QUAY_DRIVER_LEGACY_SUPERVISOR !== "1" && anchorOwns(root, kind)) {
    return await stopKindViaAnchor(root, kind, out);
  }
  const spidRaw = readPidFile(st.supervisorPidFile);
  const dpidRaw = readPidFile(st.driverPidFile);
  let stopped = 0;
  try { fs.writeFileSync(st.stopSentinel, "\n", "utf8"); } catch { /* ignore */ }
  if (spidRaw && pidAlive(spidRaw)) { try { process.kill(Number(spidRaw), "SIGTERM"); } catch { /* gone */ } stopped = 1; }
  if (dpidRaw && pidAlive(dpidRaw)) { try { process.kill(Number(dpidRaw), "SIGTERM"); } catch { /* gone */ } stopped = 1; }
  for (let i = 0; i < 20; i++) {
    if ((!spidRaw || !pidAlive(spidRaw)) && (!dpidRaw || !pidAlive(dpidRaw))) break;
    await sleep(500);
  }
  // 兜底 kill -9（supervisor/驱动 10s 内未退出）。⛔ 只针对 supervisor 与驱动自身，不扫 in-flight。
  if (spidRaw && pidAlive(spidRaw)) { try { process.kill(Number(spidRaw), "SIGKILL"); } catch { /* gone */ } }
  if (dpidRaw && pidAlive(dpidRaw)) { try { process.kill(Number(dpidRaw), "SIGKILL"); } catch { /* gone */ } }
  for (const f of [st.driverPidFile, st.supervisorPidFile, st.stopSentinel]) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
  out(stopped === 1 ? "stopped\n" : "not-running\n");
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

/** restart = stop then start。 */
export async function restartKind(
  root: string,
  kind: DriverKind,
  opts: { cap?: string; interval?: string; reconcileInterval?: string; restartDelaySecs: number; runId?: string; confirmTimeoutSecs?: number },
  out: (s: string) => void = (s) => process.stdout.write(s),
  err: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> {
  await stopKind(root, kind, () => {});
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
