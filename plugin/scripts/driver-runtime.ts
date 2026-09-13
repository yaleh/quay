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
  /** 载体文件（相对 .quay/；首个 = 主载体，作 status 的 carrier_path）。 */
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

/** 一个 kind 的载体观测结果。 */
export interface CarrierStats {
  records: number;
  lastTs: string | null;
  primaryPath: string;
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
  let primaryPath = "";
  for (let i = 0; i < spec.carriers.length; i++) {
    const file = path.join(root, ".quay", spec.carriers[i]);
    if (i === 0) primaryPath = file;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text === "") continue;
    // wc -l 语义：数换行符（⛔ split("\n").length 会把无尾换行的文件多算 1）。
    records += (text.match(/\n/g) ?? []).length;
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
  return { records, lastTs, primaryPath };
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

/** respawn 循环（run_supervisor 港进）：spawn driver → 权威写 driver pid → wait → stop sentinel 则退出，
 *  否则 sleep restartDelaySecs 后重拉。每次重拉写一条 supervisor 事件。 */
export async function runSupervisor(opts: SupervisorOptions): Promise<number> {
  const spec = DRIVER_KINDS[opts.kind];
  const st = statePaths(opts.root, opts.kind);
  const driverSibling = resolveKernelSibling(spec.driver);
  if (!driverSibling) {
    process.stderr.write(`driver-runtime: driver not found at ${path.join(resolveKernelScriptsDir(), spec.driver)}\n`);
    return 2;
  }
  fs.mkdirSync(path.join(opts.root, ".quay"), { recursive: true });

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
    if (child) { try { child.kill("SIGTERM"); } catch { /* gone */ } }
  });
  process.on("SIGINT", () => {
    stopping = true;
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
    if (child.pid) writePidFile(st.driverPidFile, child.pid);
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

/** 派生一个 kind 的 { supervisor_alive, driver_alive, running, deaths }（status 与 liveness 共用）。 */
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
} {
  const st = statePaths(root, kind);
  const spidRaw = readPidFile(st.supervisorPidFile);
  const dpidRaw = readPidFile(st.driverPidFile);
  const supervisorPid = /^\d+$/.test(spidRaw) ? Number(spidRaw) : null;
  const driverPid = /^\d+$/.test(dpidRaw) ? Number(dpidRaw) : null;
  const supervisorAlive = supervisorPid != null && pidAlive(supervisorPid);
  const driverAlive = driverPid != null && pidAlive(driverPid);
  const running = supervisorAlive && driverAlive;
  const deaths: string[] = [];
  // supervisor 死：pid 文件在而进程不在。
  if (supervisorPid != null && !supervisorAlive) deaths.push("supervisor_dead");
  // driver 死：pid 文件在而进程不在。
  if (driverPid != null && !driverAlive) deaths.push("driver_dead");
  // 孤儿 driver：supervisor 死而 driver 进程还在 —— ⛔ 不算「在跑」（AC3(b)）。
  if (!supervisorAlive && driverAlive) deaths.push("driver_orphaned");
  // supervisor 陈旧判定（gap-supervisor-never-self-refreshes-no-detector）：只对【活着】的 supervisor
  // 有意义；缺失/已死/读不到启动时刻 ⇒ not-evaluated（null），⛔ 不与「新鲜」（false）同形。
  const staleness = supervisorStaleness(root, kind, supervisorAlive ? supervisorPid : null);
  return {
    supervisorPid,
    driverPid,
    supervisorAlive,
    driverAlive,
    running,
    deaths,
    supervisorStartedAt: staleness.supervisorStartedAt,
    supervisorStale: staleness.state === "stale" ? true : staleness.state === "fresh" ? false : null,
  };
}

/** status 输出（JSON 与人类可读两态）。alive 与 running 同值（alive 是 AC139-3 字段名，running 保留
 *  backward compat）。 */
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
      supervisor_started_at: a.supervisorStartedAt,
      supervisor_stale: a.supervisorStale === true ? "stale" : a.supervisorStale === false ? "fresh" : "not-evaluated",
    }));
  } else {
    out(
      `${spec.prefix}: kind=${kind} · supervisor pid=${a.supervisorPid ?? "none"} alive=${a.supervisorAlive ? 1 : 0} · ` +
      `driver pid=${a.driverPid ?? "none"} alive=${a.driverAlive ? 1 : 0} · running=${a.running ? 1 : 0} · ` +
      `supervisor_stale=${a.supervisorStale === true ? "stale" : a.supervisorStale === false ? "fresh" : "not-evaluated"} · ` +
      `carrier_path=${stats.primaryPath} · carrier_records=${stats.records} · last_record_ts=${stats.lastTs ?? "null"}`,
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
    }));
  } else {
    out(
      `${spec.prefix}-liveness: kind=${kind} · supervisor_alive=${a.supervisorAlive ? 1 : 0} · ` +
      `driver_alive=${a.driverAlive ? 1 : 0} · running=${a.running ? 1 : 0} · deaths=${deaths}`,
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
 *  `confirmed` = supervisor ∧ driver 双活且【连续两次】轮询都读到；`dead` = 决断信号（supervisor 已
 *  退出且无 driver）；`pending` = 窗口用尽而 supervisor 仍活（慢启动 / 崩溃-重拉循环）。 */
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
  // 稳定判据：双活必须被【连续两次】轮询都读到（`firstAliveAt` 起算 ≥ 一个轮询间隔）。为什么不是
  // 「读到一次就确认」：`pidAlive` 对「刚 spawn 出来、尚未 import 完就自己退了」的进程会读到一次
  // true（进程表里确实存在过）——一次采样分不开「起来了」与「短暂存在过」（硬规则 4b）。⛔ 这只推迟
  // 确认，不产生假死（慢启动照样在窗口内确认）。
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
 *    · `started:`       supervisor 活 ∧ driver pid 文件在 ∧ driver 进程活，且该读数被**连续两次**轮询
 *                       读到（一次采样分不开「起来了」与「刚 spawn 出来就退了」）—— 窗口内确认即成功。
 *    · `start-failed:`  我们 spawn 的那个 supervisor 进程**已退出** ∧ driver 不活 ⇒ 再也没有谁会拉起
 *                       driver。这是【决断信号】，与窗口大小无关（缺 driver 脚本、解释器不接受启动参数
 *                       等都在此列），并贴出 supervisor 日志尾作为死因。
 *    · `start-pending:` 窗口用尽而 supervisor **仍活着**（慢启动 / 驱动崩溃-重拉循环）⇒ 独立取值，
 *                       ⛔ 不报「死」、⛔ 不打印 `started:`。退出码非 0 = 「未确认」≠「死」。
 */
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

/** stop（硬停：杀 supervisor + 驱动；⛔ 不杀 worker 在飞子进程）。 */
export async function stopKind(root: string, kind: DriverKind, out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const st = statePaths(root, kind);
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
