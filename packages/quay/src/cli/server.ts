// cli/server.ts — `quay server status [--json]` (GOAL-017 / AC-251, SPEC §6.8 CLI-first).
//
// WHAT THIS COMMAND IS: the reader half of the unified server's state carrier. It answers ONE
// question — "is the single process that hosts the Web UI and the MCP control plane up, and are
// BOTH of its services actually answering?" — from OUTSIDE that process, using only the carrier
// plus two independent live probes (see server-state.ts). It is the machine criterion of SPEC §7
// stage A2 ("web + control 合入一个进程"): the JSON reports `services[].pid`, and stage A2 is
// landed exactly when `web.pid === control.pid` and both are the live host process.
//
// SCOPE (⛔ deliberately narrow): only `status`. SPEC §6.9's `start` / `add` / `stop` verbs are
// stage B (AC-254) and are NOT implemented here — inventing them now would make stage A introduce a
// new user-visible capability, which §8 criterion 9 forbids. `quay serve`'s own flag surface is
// likewise unchanged (the control-plane port is an env override, not a new flag).
//
// ── 三分法（exit code 是这条命令的契约，不是装饰）────────────────────────────────────────────────
//   0  running | degraded
//                  carrier present, host pid alive, web+control both carry that pid. Per-service
//                  liveness is reported alongside (§6.10) — `degraded` means the process is up but a
//                  service is not answering — and does NOT move the exit code.
//   1  not-running  no carrier, the carrier names a dead pid (the killed-server case), a required
//                  service is missing, or a service carries a pid other than the host's
//   3  not-evaluated the carrier exists but could not be read/parsed (硬规则 3b: 读不懂 ≠ 未达成)
// `--json` ALWAYS emits a parseable JSON document on stdout for every one of the three outcomes —
// the exit code carries the verdict, never the absence of output.
//
// ⚠️ WHY A FAILED PROBE IS NOT AN EXIT-1 (`degraded` exits 0). AC-251's criterion documents its own
// exit-1 set as "子命令不可用 / 无这两个服务 / pid 不同" — the PID-IDENTITY contract, which is what
// this command's exit code is FOR. Folding a liveness probe into it would make the criterion depend
// on a transient: a freshly started `quay serve` blocks its event loop for ~10s on a large repo
// while it warms the develop-ref read caches (measured on this repo 2026-09-13: unreachable t+0..t+9s,
// healthy after), so `web` genuinely cannot answer for that window. That transient is REAL and must
// be visible — it is, as `status:"degraded"` plus a per-service `liveness.alive:false` row, which is
// exactly the "进程活着 ≠ 服务在转" distinction SPEC §6.10/§8-8 demands — but it must not be reported
// as "the unified server is not there", which is a different and false claim.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { findConfig } from "../config.ts";
import {
  readServerState,
  pidAlive,
  probeWebService,
  probeControlService,
  serverStatePath,
  type ServiceProbe,
} from "../server-state.ts";
// The service inventory + desired-state carrier are SINGLE-SOURCED in serve.ts (the service-lifecycle
// host). `status` used to import only server-state.ts; it now shares the host's own vocabulary, so
// 「CLI 认得的服务名」 and 「宿主承载的服务名」 cannot drift into two lists (SPEC §6.8 单一实现).
import { parseServiceList, readServiceState, writeServiceState } from "../serve.ts";
// The service NAMES come from the zero-import leaf (same reason as help.ts): one list, three
// consumers. ⛔ Never re-declare them here.
import { ALL_SERVICE_NAMES, DRIVER_SERVICE_KINDS, HOSTED_SERVICE_NAMES } from "./driver-vocab.ts";
import { runDriver } from "./driver.ts";
import type { CliCtx } from "./context.ts";

/** The two services stage A2 merges; both must be present and carry the host pid for `running`. */
const REQUIRED_SERVICES = ["web", "control"] as const;

export const EXIT_RUNNING = 0;
export const EXIT_NOT_RUNNING = 1;
export const EXIT_NOT_EVALUATED = 3;

interface ServiceReport {
  name: string;
  pid: number | null;
  host: string;
  port: number;
  liveness: ServiceProbe;
}

/** SPEC §6.10「每服务独立健康读数」对 **driver kind** 的那一半（GOAL-017/AC-255）。
 *
 *  合并成「一个 anchor 承载六个 kind 循环」之后，`ps` 只剩一行 ⇒ 「进程活着」与「这个 kind 还在转」
 *  在外部不再可区分（§6.7 禁止的那种折叠）。故每行给一条**直接量**：该服务**自己的 round 心跳**的
 *  最后一条记录的 `ts`（⛔ 不是「宿主 pid 活着」这种推导，⛔ 也不是 pid 文件存在性）。
 *
 *  ⛔ 本行**不参与**顶层 `status` 的判定（`running`/`degraded` 仍是 AC-251 的 pid 同一性契约）——
 *  一个工作区里没有 driver 在跑是**常态**（未冷启动 / 已 drain），把它折进 `status` 会让
 *  「统一 server 不在」与「driver 没起」同形。它有自己的取值：`liveness.alive`。 */
interface DriverServiceReport {
  name: string;
  kind: string;
  pid: number | null;
  host: string;
  liveness: ServiceProbe;
}

/** 心跳新鲜度窗口（ms）。与 AC-255 的 criterion 同值（60min）——同一个量、同一个阈值，⛔ 不各写一份。 */
const DRIVER_HEARTBEAT_FRESH_MS = 3600_000;

/** Resolve the workspace root the way every other workspace-scoped command does: `--root` when
 *  given, else an upward walk from the process cwd. Fail-closed — a directory without
 *  `.quay/config.yml` is never silently replaced by cwd (gap-task-list-root-does-not-scope-
 *  config-lookup). Returns null after printing the error (caller exits non-zero). */
function resolveWorkspaceRoot(rootFlag: unknown): string | null {
  const startDir = typeof rootFlag === "string" && rootFlag.length > 0 ? path.resolve(rootFlag) : process.cwd();
  const configPath = findConfig(startDir);
  if (!configPath) {
    process.stderr.write(
      `Error: no .quay/config.yml found (searched from ${startDir} upward) — point --root at a quay workspace root.\n`,
    );
    return null;
  }
  return path.dirname(path.dirname(configPath));
}

/** Non-evaluated liveness for a service whose host process is gone: the probe is NOT run (there is
 *  nothing to probe), and the reading says so rather than reporting a bare `false`. */
function unevaluated(reason: string): ServiceProbe {
  return { evaluated: false, alive: null, source: null, detail: reason };
}

/** The four verbs of SPEC §6.9 stage B (plus the stage-A `status`). ONE list, used by the usage
 *  text, the help block and the dispatch — a second copy is how 「能力在而表层说没有」happens. */
export const SERVER_VERBS = ["start", "add", "stop", "status"] as const;

const USAGE = `usage: quay server <${SERVER_VERBS.join("|")}> [--only <svc,...>] [--without <svc,...>] [--json] [--root <path>]
services: ${ALL_SERVICE_NAMES.join(", ")}`;

export async function handleServer(ctx: CliCtx) {
  const { sub } = ctx;
  if (sub === "start" || sub === "add" || sub === "stop") {
    await lifecycleCommand(sub, ctx);
    return;
  }
  if (sub !== "status") {
    process.stderr.write(USAGE + `\nRun \`quay --help\` for full usage documentation.\n`);
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }
  await statusCommand(ctx);
}

/** 一个 driver kind 的健康读数：**直接量** = 它自己 round 心跳载体的最后一条记录的 `ts`。
 *  三态（硬规则 3b）：fresh(`alive:true`) / stale(`alive:false`) / not-evaluated（读不到载体或 ts
 *  不可解析 ⇒ `evaluated:false`，⛔ 与「停摆」不同形——「读不懂」不得伪装成「不合格」。 */
function driverServiceReport(workspaceRoot: string, kind: string): DriverServiceReport {
  const name = `driver:${kind}`;
  const r = runDriver("status", kind, ["--kind", kind, "--json"], workspaceRoot);
  const base: DriverServiceReport = { name, kind, pid: null, host: "local", liveness: unevaluated("driver status unavailable") };
  if (!r.ok) return { ...base, liveness: unevaluated(r.reason ?? "driver status unavailable") };
  const line = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  if (!line) return { ...base, liveness: unevaluated(`driver status produced no JSON frame (exit ${r.exitCode})`) };
  let j: {
    driver_pid?: number | null;
    anchor_pid?: number | null;
    driver_alive?: number | null;
    carrier_path?: string | null;
    last_record_carrier?: string | null;
    last_record_ts?: string | null;
  };
  try {
    j = JSON.parse(line) as typeof j;
  } catch {
    return { ...base, liveness: unevaluated("driver status JSON was unparseable") };
  }
  const pid = j.driver_pid ?? j.anchor_pid ?? null;
  const carrier = j.carrier_path;
  // ⛔ `carrier_path` 是「首个存在的载体」，**不是**这个 ts 的来源——两者在真实工作区上会不同名
  // （实测 2026-09-13 生产 `promotion`：outcome 存在但末条 ts 停在 2.5h 前、round 每 30s 一条）。
  // 把 ts 归因给 `carrier_path` 就是让一条真读数声称一个假的来源（硬规则 3b/4b）。来源由 kernel 的
  // `last_record_carrier` 单列给出；⛔ 它缺失时【不点名任何载体】，而不是退回 `carrier_path` 再谎报一次
  // （gap-driver-status-carrier-path-source-label-mismatch）。
  const tsCarrier =
    typeof j.last_record_carrier === "string" && j.last_record_carrier !== "" ? j.last_record_carrier : null;
  const tsRaw = j.last_record_ts;
  // ⚠️ **没有活着的承载进程** 是一个独立的、必须先判的取值（GOAL-017/AC-255 的负控制实测教训）：
  // 只看心跳新鲜度会让「这个 kind 已经被停掉」在 **60 分钟**内与「一切正常」同形（心跳窗口是 60min，
  // 而停掉的循环当然不会再写 —— 于是它的最后一条记录在窗口内仍然「新鲜」）。实测：`stop --kind meta`
  // 之后该行仍报 alive:true，只有 pid 变 null。那不是「服务在转」的读数。
  // ⇒ 先判承载进程（`driver_alive` = 该 kind 的 pid 载体所指进程是否活着），再判心跳。
  if (j.driver_alive !== 1) {
    return {
      ...base,
      pid,
      liveness: {
        evaluated: true,
        alive: false,
        source: "driver pid",
        detail: `no live carrying process for ${name} (pid=${pid ?? "none"}) — the loop is not running`,
      },
    };
  }
  if (!carrier || !tsRaw) {
    return { ...base, pid, liveness: unevaluated(`no round heartbeat carrier record yet (carrier=${carrier ?? "null"})`) };
  }
  const at = Date.parse(tsRaw);
  if (!Number.isFinite(at)) {
    return { ...base, pid, liveness: unevaluated(`carrier ${carrier} last ts is unparseable (${tsRaw})`) };
  }
  const ageMs = Date.now() - at;
  const stale = ageMs > DRIVER_HEARTBEAT_FRESH_MS;
  return {
    name,
    kind,
    pid,
    host: "local",
    liveness: {
      evaluated: true,
      alive: !stale,
      // 点名**真正供这个 ts 的**载体。kernel 没报来源时（旧 kernel/旧 bundle）⇒ 不声称具体载体
      // （AC2 允许的另一半：只断言实际量到的那个事实），⛔ 不用 `carrier_path` 顶替。
      source: tsCarrier !== null ? `carrier:${tsCarrier} last ts` : "driver status last_record_ts (carrier not named by the kernel)",
      detail: stale
        ? `last round heartbeat ${Math.round(ageMs / 60000)}min ago (> ${DRIVER_HEARTBEAT_FRESH_MS / 60000}min) — this service is NOT turning`
        : `last round heartbeat ${Math.round(ageMs / 1000)}s ago`,
    },
  };
}

async function statusCommand({ flags, wantsJson }: CliCtx) {
  const workspaceRoot = resolveWorkspaceRoot(flags.root);
  if (workspaceRoot === null) {
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }

  const carrierPath = serverStatePath(workspaceRoot);
  const read = readServerState(workspaceRoot);

  let status: "running" | "degraded" | "not-running" | "not-evaluated";
  let reason: string;
  let hostPid: number | null = null;
  let startedAt: string | null = null;
  let services: ServiceReport[] = [];

  if (read.kind === "unreadable") {
    // Carrier present but unreadable / wrong shape — NOT-EVALUATED (硬规则 3b).
    status = "not-evaluated";
    reason = read.reason;
  } else if (read.kind === "absent") {
    status = "not-running";
    reason = read.reason;
  } else {
    hostPid = read.state.pid;
    startedAt = read.state.startedAt;
    if (!pidAlive(hostPid)) {
      status = "not-running";
      reason = `${carrierPath} names pid ${hostPid}, which is not alive (stale carrier — the server was killed without a graceful close)`;
      // Keep the per-service rows (§6.10: 每服务一行) but with NO integer pid — a dead host cannot
      // legitimately report a live service, and `pid:null` is what keeps AC-251's "二者 pid 相同"
      // reading from going green on a corpse.
      services = read.state.services.map((s) => ({
        name: s.name,
        pid: null,
        host: s.host,
        port: s.port,
        liveness: unevaluated(reason),
      }));
    } else {
      const probes = await Promise.all(
        read.state.services.map(async (s): Promise<ServiceReport> => ({
          name: s.name,
          pid: s.pid,
          host: s.host,
          port: s.port,
          liveness:
            s.name === "control"
              ? await probeControlService(s.host, s.port)
              : await probeWebService(s.host, s.port),
        })),
      );
      services = probes;
      const problems: string[] = [];
      for (const name of REQUIRED_SERVICES) {
        if (!probes.some((p) => p.name === name)) problems.push(`service "${name}" is absent from the carrier`);
      }
      for (const p of probes) {
        if (p.pid !== hostPid) problems.push(`service "${p.name}" reports pid ${p.pid}, not the host pid ${hostPid}`);
        if (!p.liveness.evaluated) problems.push(`service "${p.name}" liveness NOT-EVALUATED: ${p.liveness.detail}`);
        else if (p.liveness.alive !== true) problems.push(`service "${p.name}" is not answering: ${p.liveness.detail}`);
      }
      status = problems.length === 0 ? "running" : "degraded";
      reason =
        problems.length === 0
          ? `pid ${hostPid} hosts ${probes.map((p) => p.name).join(" + ")} on one process`
          : problems.join("; ");
    }
  }

  // `degraded` is a LIVENESS reading, not a pid-identity failure — it stays on EXIT_RUNNING (see the
  // header note). Only "the unified server is not there / is not one process" is NOT-RUNNING.
  const exitCode =
    status === "not-evaluated"
      ? EXIT_NOT_EVALUATED
      : status === "not-running"
        ? EXIT_NOT_RUNNING
        : EXIT_RUNNING;

  // SPEC §6.10 的另一半（GOAL-017/AC-255）：六个 driver kind 各一行，活性取**该服务自己的 round 心跳**。
  // ⛔ 不在 `status`/`not-running` 分支里跳过——那正是最需要看「哪个 kind 不转了」的时刻。
  const drivers = DRIVER_SERVICE_KINDS.map((kind) => driverServiceReport(workspaceRoot, kind));

  if (wantsJson) {
    process.stdout.write(
      JSON.stringify(
        {
          schemaVersion: 1,
          status,
          reason,
          workspaceRoot,
          carrierPath,
          carrier: read.kind,
          pid: hostPid,
          startedAt,
          services,
          drivers,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(`quay server: ${status.toUpperCase()} — ${reason}\n`);
    process.stdout.write(`  workspace ${workspaceRoot}\n`);
    if (services.length === 0) {
      process.stdout.write(`  (no service rows: the carrier records none)\n`);
    }
    for (const s of services) {
      const liveness = s.liveness.evaluated
        ? s.liveness.alive === true
          ? "alive"
          : "DOWN"
        : "not-evaluated";
      process.stdout.write(
        `  ${s.name.padEnd(8)} pid ${String(s.pid ?? "—").padEnd(8)} ${s.host}:${s.port}  ${liveness} (${s.liveness.source ?? "no probe"}) — ${s.liveness.detail}\n`,
      );
    }
    process.stdout.write(`  driver services (§6.10 — 活性取各自 round 心跳的直接量，⛔ 非「进程在」):\n`);
    for (const d of drivers) {
      const liveness = d.liveness.evaluated ? (d.liveness.alive === true ? "alive" : "DOWN") : "not-evaluated";
      process.stdout.write(
        `  ${d.name.padEnd(18)} pid ${String(d.pid ?? "—").padEnd(8)} ${liveness.padEnd(14)} (${d.liveness.source ?? "no carrier"}) — ${d.liveness.detail}\n`,
      );
    }
  }

  process.exitCode = exitCode;
}

/** Exported for the test's own teardown bookkeeping — the carrier is runtime state, never tracked. */
export function carrierExists(workspaceRoot: string): boolean {
  return fs.existsSync(serverStatePath(workspaceRoot));
}

// ══ 阶段 B：服务独立起停（GOAL-017 / AC-254, SPEC §6.9）══════════════════════════════════════════
//
// 四个动词 = 同一个能力的四个面（§6.8「一个能力，一份实现，四个投影」）：
//   start [--only a,b] [--without c]   起（已在跑的服务 ⇒ no-op，⛔ 不是静默重启）
//   add   a,b                          追加起，⛔ 不动已在跑的
//   stop  [--only a,b]                 部分停，⛔ 不波及其余（宿主进程不杀）
//   status [--json]                    （阶段 A2，AC-251）
//
// ── 可区分取值（硬规则 3b）──────────────────────────────────────────────────────────────────────
// 每个服务一条 `outcome`，词表里【没有】「合格 / 未评估」共用的取值：
//   started / already-running      该服务在跑（前者=本趟起的、后者=本来就在跑 ⇒ 幂等，pid 不变）
//   stopped / already-stopped      该服务不在跑（前者=本趟停的、后者=本来就没跑）
//   not-evaluated                  说不出（宿主没起来 / 探针读不懂 / 超时）—— ⛔ 不与上面四个同形
// `changed` 是**聚合**的可区分位：只有真发生了转换才 true。**「我停掉了」与「它本来就是停的」
// 由此在记录上不同形** —— 若两者同形，`stop` 的 exit 0 就不再是任何事实的读数。

export type ServiceOutcome = "started" | "already-running" | "stopped" | "already-stopped" | "not-evaluated";

interface ServiceResult {
  name: string;
  outcome: ServiceOutcome;
  pid: number | null;
  detail: string;
}

/** 起停确认窗口。宿主的 reconcile 周期是 150ms，驱动的 `start` 自带最长 30s 的存活确认 ⇒ 这里
 *  要盖住二者中较慢的那个，且超时是 NOT-EVALUATED（⛔ 不是「成功」）。 */
const HOSTED_TRANSITION_TIMEOUT_MS = 20000;
const DRIVER_TRANSITION_TIMEOUT_MS = 90000;
const HOST_BOOT_TIMEOUT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll `probe` until true or the deadline. Returns the last reading either way (⛔ 不吞掉读数). */
async function waitUntil(probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

/** The live host of `root`, or null. A carrier naming a DEAD pid is not a host (AC-251's rule). */
function readLiveHost(workspaceRoot: string): { pid: number; services: Array<{ name: string; host: string; port: number; up: boolean }> } | null {
  const read = readServerState(workspaceRoot);
  if (read.kind !== "present") return null;
  if (!pidAlive(read.state.pid)) return null;
  return {
    pid: read.state.pid,
    services: read.state.services.map((s) => ({
      name: s.name,
      host: s.host,
      port: s.port,
      // `up` is AC-254's addition to the carrier; a carrier without it (written by a host that never
      // stopped a face) has both faces up by construction.
      up: (s as { up?: unknown }).up !== false,
    })),
  };
}

/** The DESIRED state as last recorded for THIS host, or null when none/foreign (stale pid). */
function readDesiredFor(workspaceRoot: string, hostPid: number): Record<string, boolean> | null {
  const read = readServiceState(workspaceRoot);
  if (read.kind !== "present") return null;
  if (read.state?.pid !== hostPid) return null;
  return read.state.services;
}

/** Probe ONE hosted service through its own live face. Null = the host/service cannot be probed
 *  at all (no live host, or the carrier does not name it) — a different fact from "probed, down". */
async function probeHosted(workspaceRoot: string, name: string): Promise<ServiceProbe | null> {
  const host = readLiveHost(workspaceRoot);
  if (!host) return null;
  const entry = host.services.find((s) => s.name === name);
  if (!entry) return null;
  return name === "control" ? await probeControlService(entry.host, entry.port) : await probeWebService(entry.host, entry.port);
}

/** Spawn a detached unified host seeded with `initial` as its launch-time service set. */
function spawnHost(workspaceRoot: string, initial: string[], port: string | undefined, hostFlag: string | undefined): string | null {
  // ⚠️ Resolve to an ABSOLUTE path before spawning: the child runs with cwd=workspaceRoot, so a
  // relative argv[1] (the normal `node packages/quay/bin/quay.ts server start` invocation) would
  // resolve against the WRONG directory and the child would die instantly — which would then read
  // as "the host never came up", i.e. a locating bug masquerading as a server failure.
  const raw = process.argv[1];
  const entry = raw ? path.resolve(raw) : "";
  if (!entry || !fs.existsSync(entry)) return `cannot locate the CLI entry to spawn (process.argv[1]=${JSON.stringify(raw)})`;
  // The dev tree entry is a `.ts` file (needs the strip-types flag); the shipped bundle is `.js`
  // and must NOT be given it (an older Node would reject the flag on a plain ESM bundle).
  const stripTypes = entry.endsWith(".ts") ? ["--experimental-strip-types"] : [];
  const args = ["--no-warnings", ...stripTypes, entry, "serve", "--host", hostFlag ?? "127.0.0.1", "--port", port ?? "4173"];
  const child = spawn(process.execPath, args, {
    cwd: workspaceRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, QUAY_SERVER_SERVICES: initial.join(",") },
  });
  child.unref();
  return null;
}

/** Driver-kind service name → kind. Null when `name` is not a driver service. */
function driverKindOf(name: string): string | null {
  const prefix = "driver:";
  if (!name.startsWith(prefix)) return null;
  const kind = name.slice(prefix.length);
  return DRIVER_SERVICE_KINDS.includes(kind as (typeof DRIVER_SERVICE_KINDS)[number]) ? kind : null;
}

/** Read a driver kind's liveness from the kernel's OWN `status --json` (⛔ 不解析人类可读文本，
 *  ⛔ 不读 pid 文件存在性 —— 那是代理量，CLAUDE.md 硬规则 4b）。 */
function driverRunning(workspaceRoot: string, kind: string): { evaluated: boolean; running: boolean; pid: number | null; detail: string } {
  const r = runDriver("status", kind, ["--kind", kind, "--json"], workspaceRoot);
  if (!r.ok) return { evaluated: false, running: false, pid: null, detail: r.reason ?? "driver status unavailable" };
  const line = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  if (!line) return { evaluated: false, running: false, pid: null, detail: `driver status produced no JSON frame (exit ${r.exitCode})` };
  try {
    const j = JSON.parse(line) as { running?: number; driver_pid?: number | null; supervisor_pid?: number | null };
    return {
      evaluated: true,
      running: j.running === 1,
      pid: j.driver_pid ?? j.supervisor_pid ?? null,
      detail: `driver status running=${j.running === 1 ? 1 : 0}`,
    };
  } catch {
    return { evaluated: false, running: false, pid: null, detail: "driver status JSON was unparseable" };
  }
}

async function lifecycleCommand(verb: "start" | "add" | "stop", { flags, positional, wantsJson }: CliCtx): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot(flags.root);
  if (workspaceRoot === null) {
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }

  // ── 请求集：单一解析（--only / --without / 位置参数），三个动词共用 ──────────────────────────
  const only = parseServiceList(flags.only);
  if (only.ok === false) {
    process.stderr.write(`Error: ${only.error}\n`);
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }
  const without = parseServiceList(flags.without);
  if (without.ok === false) {
    process.stderr.write(`Error: ${without.error}\n`);
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }
  const addList = parseServiceList(positional[0] ?? flags.services);
  if (verb === "add") {
    if (addList.ok === false) {
      process.stderr.write(`Error: ${addList.error}\n`);
      process.exitCode = EXIT_NOT_RUNNING;
      return;
    }
    if (addList.names.length === 0) {
      process.stderr.write(`Error: \`quay server add\` needs a service list, e.g. \`quay server add control\`.\n${USAGE}\n`);
      process.exitCode = EXIT_NOT_RUNNING;
      return;
    }
  }

  const requested =
    verb === "add"
      ? (addList as { ok: true; names: string[] }).names
      : only.names.length > 0
        ? only.names
        : ALL_SERVICE_NAMES.slice();
  const wanted = requested.filter((n) => !without.names.includes(n));

  if (verb === "stop" && only.names.length === 0) {
    process.stderr.write(`Error: \`quay server stop\` requires --only <svc,...> (stopping everything is not what this verb means; stop the host instead).\n${USAGE}\n`);
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }

  const results: ServiceResult[] = [];

  // ── 宿主承载的服务（web / control）：期望态 + 宿主 reconcile + 本进程实测确认 ─────────────────
  const hostedWanted = wanted.filter((n) => HOSTED_SERVICE_NAMES.includes(n as (typeof HOSTED_SERVICE_NAMES)[number]));
  if (hostedWanted.length > 0) {
    if (verb === "stop") {
      const live = readLiveHost(workspaceRoot);
      if (!live) {
        // ⛔ 一个「本来就没有宿主在跑」的 stop 必须与「刚刚停掉」可区分（硬规则 3b）。
        for (const name of hostedWanted) results.push({ name, outcome: "already-stopped", pid: null, detail: "no live server host in this workspace" });
      } else {
        const before = new Map<string, boolean>();
        for (const name of HOSTED_SERVICE_NAMES) {
          const probe = await probeHosted(workspaceRoot, name);
          before.set(name, probe?.alive === true);
        }
        const desired = readDesiredFor(workspaceRoot, live.pid) ?? Object.fromEntries(before);
        for (const name of hostedWanted) desired[name] = false;
        writeServiceState(workspaceRoot, live.pid, desired);
        for (const name of hostedWanted) {
          const was = before.get(name) === true;
          const ok = await waitUntil(async () => (await probeHosted(workspaceRoot, name))?.alive === false, HOSTED_TRANSITION_TIMEOUT_MS);
          results.push(
            ok
              ? { name, outcome: was ? "stopped" : "already-stopped", pid: live.pid, detail: was ? "face closed; host process untouched" : "was already down" }
              : { name, outcome: "not-evaluated", pid: live.pid, detail: `face did not go down within ${HOSTED_TRANSITION_TIMEOUT_MS}ms` },
          );
        }
      }
    } else {
      // start / add：确保宿主在跑（没有就起一个），再写期望态，再实测确认
      //
      // ⚠️ `was` 必须在**起宿主之前**取：起完之后再探针，一个刚被本趟启动的服务会被读成
      // 「本来就在跑」，于是 `started` 永远不出现、`changed` 恒 false —— 那是把「本趟做了事」
      // 与「本来就没事可做」合并成同一个读数（硬规则 3b 的形态）。
      const before = new Map<string, boolean>();
      for (const name of hostedWanted) {
        before.set(name, (await probeHosted(workspaceRoot, name))?.alive === true);
      }
      let live = readLiveHost(workspaceRoot);
      if (!live) {
        const spawnErr = spawnHost(workspaceRoot, hostedWanted, typeof flags.port === "string" ? flags.port : undefined, typeof flags.host === "string" ? flags.host : undefined);
        if (spawnErr) {
          for (const name of hostedWanted) results.push({ name, outcome: "not-evaluated", pid: null, detail: spawnErr });
          emit(verb, workspaceRoot, results, wantsJson);
          return;
        }
        const booted = await waitUntil(async () => readLiveHost(workspaceRoot) !== null, HOST_BOOT_TIMEOUT_MS);
        live = readLiveHost(workspaceRoot);
        if (!booted || !live) {
          for (const name of hostedWanted) results.push({ name, outcome: "not-evaluated", pid: null, detail: `no host carrier appeared within ${HOST_BOOT_TIMEOUT_MS}ms` });
          emit(verb, workspaceRoot, results, wantsJson);
          return;
        }
        // The child seeds the desired-state carrier itself from QUAY_SERVER_SERVICES; give its
        // reconciler a moment to apply the launch set before probing.
      }
      const desired = readDesiredFor(workspaceRoot, live.pid) ?? Object.fromEntries((await Promise.all(HOSTED_SERVICE_NAMES.map(async (n) => [n, (await probeHosted(workspaceRoot, n))?.alive === true] as const))) as Array<[string, boolean]>);
      for (const name of hostedWanted) desired[name] = true;
      writeServiceState(workspaceRoot, live.pid, desired);
      for (const name of hostedWanted) {
        const was = before.get(name) === true;
        // ⛔ 幂等：本来就在跑的服务不重启 —— 探针先读到 alive 就直接报 already-running（pid 就是
        // 宿主 pid，进出的两次读数相同 ⇒ 「是 no-op 而不是静默重启」在记录上看得见）。
        const ok = was || (await waitUntil(async () => (await probeHosted(workspaceRoot, name))?.alive === true, HOSTED_TRANSITION_TIMEOUT_MS));
        results.push(
          ok
            ? { name, outcome: was ? "already-running" : "started", pid: live.pid, detail: was ? "already up — no-op, not a restart" : "face opened inside the existing host" }
            : { name, outcome: "not-evaluated", pid: live.pid, detail: `face did not come up within ${HOSTED_TRANSITION_TIMEOUT_MS}ms` },
        );
      }
    }
  }

  // ── driver:<kind>：组合既有 `quay driver start|stop --kind X`（⛔ 不重写 driver 起停）──────────
  for (const name of wanted) {
    const kind = driverKindOf(name);
    if (kind === null) continue;
    const st = driverRunning(workspaceRoot, kind);
    if (!st.evaluated) {
      results.push({ name, outcome: "not-evaluated", pid: null, detail: st.detail });
      continue;
    }
    if (verb === "stop") {
      if (!st.running) {
        results.push({ name, outcome: "already-stopped", pid: null, detail: "driver was not running" });
        continue;
      }
      const r = runDriver("stop", kind, ["--kind", kind], workspaceRoot);
      const ok = r.ok && (await waitUntil(async () => !driverRunning(workspaceRoot, kind).running, DRIVER_TRANSITION_TIMEOUT_MS));
      results.push(
        ok
          ? { name, outcome: "stopped", pid: st.pid, detail: "driver stop delegated to `quay driver stop` (in-flight worker children NOT killed)" }
          : { name, outcome: "not-evaluated", pid: st.pid, detail: `quay driver stop did not reach a stopped state (exit ${r.exitCode})` },
      );
    } else {
      if (st.running) {
        // §6.9 不变式 1：一个已在跑的 driver **绝不重启**（重启会打断在飞 worker）。
        results.push({ name, outcome: "already-running", pid: st.pid, detail: "driver already running — no-op, not a restart" });
        continue;
      }
      const r = runDriver("start", kind, ["--kind", kind], workspaceRoot);
      const ok = r.ok && (await waitUntil(async () => driverRunning(workspaceRoot, kind).running, DRIVER_TRANSITION_TIMEOUT_MS));
      const after = driverRunning(workspaceRoot, kind);
      results.push(
        ok
          ? { name, outcome: "started", pid: after.pid, detail: "driver start delegated to `quay driver start`" }
          : { name, outcome: "not-evaluated", pid: null, detail: `quay driver start did not reach a running state (exit ${r.exitCode})` },
      );
    }
  }

  emit(verb, workspaceRoot, results, wantsJson);
}

function emit(verb: string, workspaceRoot: string, results: ServiceResult[], wantsJson: boolean): void {
  const changed = results.filter((r) => r.outcome === "started" || r.outcome === "stopped").length;
  const unevaluated = results.filter((r) => r.outcome === "not-evaluated");
  if (wantsJson) {
    process.stdout.write(
      JSON.stringify(
        {
          schemaVersion: 1,
          action: verb,
          workspaceRoot,
          changed: changed > 0,
          changedCount: changed,
          services: results,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(`quay server ${verb}: ${results.length} service(s), ${changed} changed\n`);
    for (const r of results) {
      process.stdout.write(`  ${r.name.padEnd(20)} ${r.outcome.padEnd(15)} pid ${String(r.pid ?? "—").padEnd(8)} ${r.detail}\n`);
    }
  }
  process.exitCode = unevaluated.length > 0 ? EXIT_NOT_EVALUATED : EXIT_RUNNING;
}
