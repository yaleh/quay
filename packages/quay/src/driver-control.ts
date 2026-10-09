// driver-control.ts — the driver CONTROL CLIENT (GOAL-033/AC-350), shared by the CLI and the web host.
//
// WHY THIS MODULE IS IN core-root（⛔ 不是"整理文件"）：`runDriver` / `runDriverAsync` 是**driver 控制
// 客户端**——校验 verb/kind → 从 `--root`/cwd 解析 workspace root → 拒绝 worktree root（AC139-4）→
// 经 plugin-root.ts 解析 TS kernel → spawn → 返回**结构化结果**（⛔ 从不写 process 全局量，所以 web
// 处理器能在进程内调用它而不与 stdout/exitCode 耦合）。两个消费者是 `cli/driver.ts`（CLI facade）与
// `serve-sessions.ts`（POST /sessions/driver）——宿主 serve 是 core。⛔ 它此前住在 `cli/driver.ts` 里，
// 于是 core-root（serve-sessions）不得不 import `cli/`，在 ArchGuard 的 package 图上制造
// core-root → core-cli 边（GOAL-033 拆的那条环）。ownership 随真实消费者走：**控制客户端在 core**，
// 住在 CLI 里的只有 argv/帮助/stdout/exit 这层 facade（`cli/driver.ts` 的 `handleDriver`）。
//
// ⛔ fan-in 仪器附加**不在这里**（搬壳陷阱，GOAL-033 调查发现）：`quay driver status --kind worker`
// 的 stdout 会附加 `fan-in/ff-merge.ts::probeInstruments` 的读数。这份读数只有 CLI 的用户输出会看到
// （`cli/server.ts` 只解析具名字段、从不读 `instruments`；serve-sessions 只做 start/stop/restart），
// 所以它是 **CLI 呈现职责**，留在 `cli/driver.ts`。若把它一起搬进 core-root，就会**新增
// core-root → fan-in 边**，而 `fan-in → core-root` 已存在 ⇒ 拆掉 root⇄cli 的同时造出 root⇄fan-in
// 的新互指。因此本模块返回**原始** stdout，由 CLI facade 自己决定要不要附加。
//
// ⛔ 允许的 import 只有：`node:path` / `node:child_process` / `./config.ts` / `./plugin-root.ts` /
// `./driver-vocab.ts`。⛔ 不得 import `./cli/` 任何文件（那就是本模块存在的原因）；⛔ 不得 import
// `./fan-in/` 任何文件（见上一段）。不变式由 GOAL-033/AC-350 的判据机械守着。

import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { findConfig } from "./config.ts";
import { resolvePluginScriptExec } from "./plugin-root.ts";
import { KINDS, VERBS } from "./driver-vocab.ts";

/** Resolve the workspace root from `--root` (walk-up) or the process cwd; null when no config.
 *
 *  Exported because `cli/driver.ts`'s `runDriverLog` / `runDriverLive`（CLI 独有的两个只读动词）
 *  用它解析同一个 root —— ⛔ 不是给它们再写一份（硬规则 5b：第二份解析就是两边漂移的起点）。 */
export function resolveRoot(rootFlag: string | undefined): string | null {
  const startDir =
    typeof rootFlag === "string" && rootFlag.trim() !== "" ? path.resolve(rootFlag) : process.cwd();
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  return path.dirname(path.dirname(configPath));
}

/** AC139-4: is `root` a git worktree (the literal quay-worktrees/ convention, or a linked worktree)? */
function isWorktreeRoot(root: string): boolean {
  // ① literal convention the AC names: a `quay-worktrees/` path.
  if (/(^|\/)quay-worktrees(\/|$)/.test(root)) return true;
  // ② git-backed: root is a LINKED worktree (any non-main entry in `git worktree list`).
  try {
    const out = execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
    });
    const worktrees = out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => path.resolve(l.slice("worktree ".length).trim()));
    const real = path.resolve(root);
    return worktrees.slice(1).some((w) => w === real);
  } catch {
    return false; // git unavailable / not a repo → only the path check applies
  }
}

/** Structured result of `runDriver` — the shared core behind both the CLI and the web surface. */
export interface DriverRunResult {
  /** true = the command was delegated to the supervisor kernel (spawn succeeded). */
  ok: boolean;
  /** Human-readable failure reason (validation / root / worktree / kernel-missing), null when ok. */
  reason: string | null;
  stdout: string;
  stderr: string;
  /** Exit code the caller should report. */
  exitCode: number;
  /**
   * The workspace root this invocation resolved against, or null when the invocation never reached
   * the kernel (validation / root / worktree / kernel-missing refusal).
   *
   * ⛔ Exposed so the CLI's presentation layer can decorate the output with readings that need the
   * SAME resolved root — reusing this one resolution instead of running a second one (硬规则 5b:
   * a second root/kernel resolution is exactly how the two drift apart).
   */
  root: string | null;
  /** The resolved kernel path (`driver-runtime.ts` / its dist bundle), or null on a refusal.
   *  Same rationale as `root` — the CLI's instrument decoration needs the kernel's own dir. */
  kernelPath: string | null;
}

/**
 * gap-webui-session-lifecycle AC1: the web surface exposes headless driver start/stop/restart by
 * REUSING `quay driver` — this pure function is that shared core. It validates verb+kind, resolves
 * the workspace root, rejects a worktree root (AC139-4), resolves the TS kernel path, and
 * spawnSync's the supervisor kernel — returning a structured result (⛔ never writes to process globals,
 * so the web handler can call it in-process without coupling to stdout/exitCode). Both the CLI
 * (handleDriver) and the web handler consume this ONE implementation (⛔ reimplementing the driver
 * lifecycle in the web layer would be fake reuse).
 */
/** The resolved spawn inputs for one `quay driver` delegation. `failure` non-null ⇒ the invocation
 *  never reached the kernel (verb/kind validation, root resolution, worktree rejection, missing
 *  kernel) and the caller returns that result verbatim. */
interface DriverInvocation {
  failure: DriverRunResult | null;
  spawnArgs: string[];
  root: string;
  kernelPath: string;
}

function refusedInvocation(reason: string, exitCode = 1): DriverInvocation {
  return {
    failure: { ok: false, reason, stdout: "", stderr: "", exitCode, root: null, kernelPath: null },
    spawnArgs: [],
    root: "",
    kernelPath: "",
  };
}

/** The SHARED prologue of `runDriver` / `runDriverAsync`: validate the verb+kind, resolve the
 *  workspace root, reject a worktree root (AC139-4), resolve the kernel and build the argv.
 *
 *  ⛔ ONE implementation, deliberately: the sync spawn site and the concurrent one must agree on
 *  every one of these judgments, and a second copy of the root/kernel resolution is exactly how
 *  the two drift apart (硬规则 5b). Only the SPAWN itself differs between them. */
function resolveDriverInvocation(
  verb: string,
  kind: string | undefined,
  rest: string[],
  rootFlag: string | undefined,
): DriverInvocation {
  if (!VERBS.includes(verb)) {
    return refusedInvocation(`quay driver: unknown subcommand: ${verb} (try: ${VERBS.join(", ")})`);
  }
  if (!KINDS.includes(kind)) {
    return refusedInvocation(`quay driver: missing/invalid --kind: ${kind ?? "<empty>"} (expected ${KINDS.join("|")})`);
  }

  // AC139-4: resolve the carrier/entry path from the workspace root (NOT import.meta walk-up).
  const root = resolveRoot(rootFlag);
  if (!root) {
    return refusedInvocation(
      `quay driver: no .quay/config.yml found (searched from ${rootFlag ?? process.cwd()} upward). ` +
        `Run from a quay workspace root, or pass --root <workspace-root>.`,
    );
  }

  // AC139-4: reject a worktree root (fail closed; never start a supervisor on a worktree).
  if (isWorktreeRoot(root)) {
    return refusedInvocation(
      `quay driver: refusing to run from a git worktree (${root}). ` +
        `The resident supervisor must be carried from the workspace root (main checkout), ` +
        `not a short-lived worktree. Run from the main checkout instead.`,
    );
  }

  const kernel = resolvePluginScriptExec(path.join("scripts", "driver-runtime.ts"));
  if (!kernel) {
    return refusedInvocation(`quay driver: driver runtime kernel not found (no plugin root resolved — no local plugin/ copy and no installed quay plugin)`);
  }

  // Forward the user's argv verbatim (rest already carries --kind/--root/--json/…), then pin
  // --root to the resolved workspace root (last-wins in the kernel's parser) so the kernel runs
  // against the same root this handler resolved — never a stale/missing one. AC151: the supervisor
  // is TS now — spawn the kernel with `node --experimental-strip-types` (⛔ no more bash .sh).
  // The dev tree kernel is the raw `driver-runtime.ts` (run WITH --experimental-strip-types); the
  // shipped artifact carries it ONLY as the bundled `dist/driver-runtime.js` (a plain ESM bundle,
  // run WITHOUT the flag) — resolvePluginScriptExec applies that dev/dist fallback
  // (gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs).
  const args = [verb, ...rest, "--root", root];
  const spawnArgs = kernel.stripTypes
    ? ["--experimental-strip-types", kernel.path, ...args]
    : [kernel.path, ...args];
  return { failure: null, spawnArgs, root, kernelPath: kernel.path };
}

/** The SYNC delegation: `spawnSync` the kernel and wait. Unchanged behaviour — see `runDriverAsync`
 *  for the concurrent twin. Returns the kernel's **raw** stdout (⛔ no fan-in instrument decoration:
 *  that is a CLI presentation concern and lives in cli/driver.ts — see this file's header). */
export function runDriver(
  verb: string,
  kind: string | undefined,
  rest: string[],
  rootFlag: string | undefined,
): DriverRunResult {
  const inv = resolveDriverInvocation(verb, kind, rest, rootFlag);
  if (inv.failure !== null) return inv.failure;
  const r = spawnSync(process.execPath, inv.spawnArgs, { encoding: "utf8" });
  return { ok: true, reason: null, stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1, root: inv.root, kernelPath: inv.kernelPath };
}

/** The ASYNC twin of `runDriver`: SAME validation/root/kernel resolution and the SAME argv (both go
 *  through `resolveDriverInvocation`), but spawns with the async `spawn` so N independent
 *  delegations can run CONCURRENTLY under `Promise.all`.
 *
 *  WHY IT EXISTS (gap-server-status-six-serial-driver-runtime-cold-spawns): `quay server status`
 *  reads six driver kinds, and each read is a FULL cold Node start + `--experimental-strip-types`
 *  transpile (measured 0.23–1.02s per kind on this repo). Serialised through `spawnSync` that is the
 *  SUM of six process starts — measured 3.92–4.07s wall for a ~3.2KB response body, i.e. the latency
 *  is process startup, ⛔ not I/O and ⛔ not serialisation. The six reads share no mutable state
 *  (each kernel opens only its own kind's carriers), so concurrency collapses the wall clock to
 *  ≈ the slowest single kind.
 *
 *  ⛔ A failed spawn is reported the SAME way the sync arm reports it: `spawnSync` yields
 *  `status:null` ⇒ `exitCode 1`, empty stdout, `ok:true`; the caller's parser then renders
 *  `unevaluated("driver status produced no JSON frame (exit 1)")`. Mirroring that here keeps
 *  「一个 kind 起不来」 from acquiring a different shape just because the call site went concurrent
 *  (硬规则 3b: the failure must stay a reading, not become an absence).
 *
 *  Returns the kernel's **raw** stdout, exactly like `runDriver` (⛔ no instrument decoration). */
export function runDriverAsync(
  verb: string,
  kind: string | undefined,
  rest: string[],
  rootFlag: string | undefined,
): Promise<DriverRunResult> {
  const inv = resolveDriverInvocation(verb, kind, rest, rootFlag);
  if (inv.failure !== null) return Promise.resolve(inv.failure);
  return new Promise<DriverRunResult>((resolve) => {
    const child = spawn(process.execPath, inv.spawnArgs);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const finish = (r: DriverRunResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    // Spawn-level failure (ENOENT / EACCES on the interpreter): same reading as the sync arm's
    // `status:null` — see the doc comment. stderr stays "" so the two arms cannot disagree on what
    // a failed spawn looks like; the caller renders it through the no-JSON-frame path.
    child.on("error", () => finish({ ok: true, reason: null, stdout: "", stderr: "", exitCode: 1, root: inv.root, kernelPath: inv.kernelPath }));
    child.on("close", (code: number | null) => {
      finish({ ok: true, reason: null, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), exitCode: code ?? 1, root: inv.root, kernelPath: inv.kernelPath });
    });
  });
}
