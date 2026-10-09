// cli/driver.ts — the `quay driver` subcommand handler (tasks/gap-ac139-unified-driver-subcommand).
//
// ⛔ 单一真源（gap-driver-cli-help-hides-four-of-six-kinds）：本文件的 **每一个** 帮助文本里的
// verb/kind 词表都是 `${VERBS.join("|")}` / `${KINDS.join("|")}` 的运行时插值——⛔ 不再手抄任何一份
// verb 或 kind 联合字面量（本文件曾有 3 处 kind 副本 + 2 处 verb 副本，取值 2/4/5/6 四种，互不一致；
// 用户实际看到的那份（cli/help.ts）只列 2 个 kind ⇒ 四个已实现的 driver kind 在产品表层等于不存在）。
// 该不变式由 plugin/scripts/enum-surface-parity-check.ts 的面 cli-driver-help-kind /
// cli-driver-usage-verbs 机械守着（字面量副本重现 ⇒ RED；见其 derivesFrom 判定）。
//
// AC139: the two drivers' launch surface converges onto ONE `quay` subcommand. AC151 (gap-ac151-
// two-level-driver-layer-landing) ports the supervisor into TS: the single generalized supervisor
// that USED to live in plugin/scripts/promotion-driver-launch.sh (bash) now lives in
// plugin/scripts/driver-runtime.ts (Layer 0 kernel — respawn loop + per-kind registry table +
// status/liveness/start/stop/drain). This CLI handler is a THIN dispatch layer (same shape as
// cli/manager.ts's delegate) that:
//   - validates the verb + --kind
//   - rejects a worktree root (AC139-4, see below)
//   - resolves the kernel via plugin-root.ts (the module-location resolver, SPEC §6b — the
//     workspace root no longer carries plugin/scripts once AC168 stops copying scripts)
//   - spawns the TS kernel (node --experimental-strip-types driver-runtime.ts) with the same argv
//
// ⛔ AC139-4 (承载路径显式从 workspace root 解析, 拒绝 worktree): this is NOT the manager.ts
//   import.meta.url walk-up. That walk-up finds the *worktree copy* of plugin/scripts when the CLI
//   is invoked from a worktree — the exact 2026-08-23 carrier-death cause (resident supervisor
//   hanging on a short-lived worktree). A workspace root that IS a worktree is REJECTED here (first
//   layer), and plugin-root.ts independently relocates to the MAIN checkout when IT is loaded from a
//   worktree (second layer) — so the kernel never hangs on a short-lived worktree copy.

import path from "node:path";
import { parseFlags, resolveJsonFlag } from "./flags.ts";
import { readFanInAttempts, readLiveWorkers, type FanInAttemptsResult, type InFlightTask } from "../observation.ts";
// gap-fan-in-instrument-availability-self-check AC3：`quay driver status --kind worker` 也报这两个 fan-in
// 仪器的当前读数。⛔ 只读（探针不写任何 quay 状态）、⛔ 不改退出码——它是**事实**，不是拦截信号。
// ⚠️ 它是本文件的**呈现**职责（GOAL-033/AC-350）：核心控制客户端 `../driver-control.ts` ⛔ 不许
// import `../fan-in/`，否则会新增 core-root → fan-in 边（fan-in → core-root 已存在）。
import { probeInstruments, type InstrumentProbe, type InstrumentReading } from "../fan-in/ff-merge.ts";
import type { CliCtx } from "./context.ts";

// VERBS 与 KINDS 定义在 core-root 的 driver-vocab.ts（零依赖叶模块——help.ts 静态 import 它，⛔ 不能
// 把这两个常量留在本文件：本文件的传递闭包带 config.ts/plugin-root.ts，实测会让 `quay --help` 每次
// 调用贵 0.4s）。此处 import + 再导出，保持既有 import 位点（goal-driver.test.mjs AC6）不变。
import { KINDS, VERBS } from "../driver-vocab.ts";
export { KINDS, VERBS };

// driver 控制客户端（校验 verb/kind → 解析 root → 拒绝 worktree → 解析 kernel → spawn → 结构化结果）
// 住在 core-root 的 ../driver-control.ts，因为 web（serve-sessions）与 CLI 共用它——它留在这里会让
// core-root import cli/（GOAL-033 拆的那条 package 环）。本文件只剩 CLI facade：argv / 帮助 / stdout /
// 退出码，以及 `status --kind worker` 的仪器附加（见下）。⛔ 不要再导出 runDriver —— 消费者直接从
// ../driver-control.ts 取，避免留下一条会把核心实现重新拖回 cli/ 的再导出路径。
import { runDriver, resolveRoot } from "../driver-control.ts";

export async function handleDriver({ sub, rest, positional }: CliCtx) {
  const { flags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

  if (sub === "--help" || sub === "-h" || flags.help) {
    process.stdout.write(`quay driver — ${VERBS.join("/")} the resident quay drivers (AC139)

Usage:
  quay driver <${VERBS.join("|")}> --kind <${KINDS.join("|")}> [--root <path>] [flags]

  start      Start the resident driver under the single supervisor (respawn on exit/kill/crash).
             ⛔ Refuses (exit non-zero) if the driver is halted — clear the halt with \`resume\` first.
  stop       Hard stop: terminate the supervisor + driver. For worker, in-flight workers are
             NOT killed (they orphan and finish) — use drain for a graceful stop.
  drain      Halt new dispatch WITHOUT killing in-flight workers (control-state halted=true).
             worker → worker-control.json; promotion → promotion-control.json; quality → quality-control.json (AC150).
  resume     drain's inverse: clear the halt (control-state halted=false) so new dispatch resumes.
             Surface recovery after drain+stop (⛔ no need to read driver-internal exports).
  status     Report {kind, supervisor_pid, driver_pid, alive, carrier_path, carrier_records,
             last_record_ts} — last_record_ts is the carrier's last-record timestamp (⛔ not just a
             record count, which cannot distinguish "growing" from "stalled").
             Also reports loaded_version: whether the RUNNING host (anchor/supervisor) loaded the
             installed kernel — current / behind / ahead / not-evaluated, with the two version
             numbers (loaded / installed) and the loaded kernel path. ⛔ Read from the running
             process (/proc/<pid>/cmdline), NOT from the kernel you happen to run status with: after
             a plugin upgrade an old anchor keeps running the old cache dir, and the older reading
             (supervisor_stale) is structurally blind to it (unwatched + fresh on a built artifact).
             ⛔ Report only — nothing auto-restarts; behind tells you to run: quay driver restart
             config_provider_path compares .quay/config.yml's provider path version segment with
             the installed version (the second drift source).
  restart    stop then start.
  log        READ-ONLY: print the driver's recorded per-attempt log (the RAW failure text of each
             attempt — never classified, never interpreted). Reads the workspace's own runtime
             carrier through observation.readFanInAttempts, the same single reader the web
             /needs-human page and the MCP \`driver_log\` tool use. ⛔ Does NOT start/stop anything
             and does not spawn the supervisor kernel.
  live       READ-ONLY: print the CURRENT in-flight worker set as JSON — the machine-readable
             counterpart to the web dashboard's "Loop pulse" card. Reuses observation.readLive's ONE
             call chain (⛔ no second /proc scan); scoped to THIS workspace (each scanned process must
             declare its own \`Repo root:\` marker equal to --root). Always JSON. Reports
             workerSignal.evaluated so "NOT evaluated" (this workspace's driver is inactive, so the
             /proc scan never ran) is DISTINCT from "zero in flight" — never the same value. ⛔ Does
             NOT start/stop/spawn anything and needs no serve process.

  --kind <${KINDS.join("|")}>   Which driver the command targets. Required for the control verbs
             (start/stop/drain/resume/status/restart); optional for the read-only \`live\` (defaults to
             \`worker\`, the only kind with in-flight worker processes).
             For \`log\`, only \`worker\` is covered today: the per-attempt fan-in records live in the
             worker driver's outcome carrier. Another kind is reported as not-covered (exit 1), never
             as an empty log.
  --task <id>                 (log only) Restrict to one task's attempts.
  --limit <n>                 (log only) Keep the most recent n attempts.
  --root <path>               Workspace root (default: discovered via .quay/config.yml from cwd).
  --reconcile-interval <s>    (worker only) Coordination floor: reconcile at least every N seconds
                              even if every edge event (worker exit) is lost — degrade to
                              "slow but correct" instead of silent stall (default 300; 0 = no floor).
  --confirm-timeout <s>       (start/restart) Liveness-confirmation window (default 30). \`start\` reports
                              success ONLY after supervisor+driver are both confirmed alive; a supervisor
                              that exited with no driver ⇒ \`start-failed:\` + the supervisor log tail,
                              exit 1; a window that expires with the supervisor STILL alive ⇒
                              \`start-pending:\` (explicitly NOT a death verdict — slow starts and
                              crash-respawn loops look the same, so neither is called dead).

⛔ Starting from a git worktree (quay-worktrees/…) is REJECTED — the resident supervisor must be
carried from the workspace root (main checkout), not a short-lived worktree.
`);
    return;
  }

  // `log` / `live` are the TWO read-only verbs: intercepted HERE, before the kernel delegation below,
  // because they have no kernel counterpart (no supervisor, no control state, no spawn). ⛔ Neither
  // goes through the worktree-root rejection — that guard protects a RESIDENT PROCESS from being
  // carried by a short-lived worktree, and reading a log / the in-flight set from one is harmless (and
  // useful: an operator debugging a worktree reads it there).
  if (sub === "log") {
    const r = runDriverLog(flags, resolveRoot(flags.root));
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.reason) process.stderr.write(r.reason + "\n");
    process.exitCode = r.exitCode;
    return;
  }

  // gap-no-readonly-surface-for-live-inflight-workers: `live` is the machine-readable counterpart to
  // the web dashboard's "Loop pulse" card — the current in-flight worker set, as JSON, with NO new
  // /proc scan (it reuses observation.readLive's chain). ⛔ Read-only: it never starts/stops/spawns.
  if (sub === "live") {
    const r = runDriverLive(flags, resolveRoot(flags.root));
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.reason) process.stderr.write(r.reason + "\n");
    process.exitCode = r.exitCode;
    return;
  }

  const r = runDriver(sub, flags.kind, rest, flags.root);
  // AC3 (gap-fan-in-instrument-availability-self-check): the fan-in instrument decoration is a CLI
  // PRESENTATION concern (see ../driver-control.ts's header for why it must not live in core-root).
  // `r.root`/`r.kernelPath` are the SAME resolution the spawn used — ⛔ never a second one (硬规则 5b).
  const stdout =
    r.ok && r.root !== null && r.kernelPath !== null
      ? withWorkerInstrumentReadings(sub, flags.kind, r.stdout, r.root, r.kernelPath)
      : r.stdout;
  if (stdout) process.stdout.write(stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.reason) console.error(r.reason);
  process.exitCode = r.exitCode;
  return;
}

/** Render a `FanInAttemptsResult` as human-readable text — the non-`--json` arm of `driver log`.
 *  ⛔ Every field it prints is the record's own value, verbatim: `reason` is NOT truncated and NOT
 *  classified (人 2026-09-20: the cause of a needs-human is an exception and an enum of causes is
 *  unreliable, so this surface shows the原文 and nothing else). The status line is the reader's own
 *  tri-state, so "the carrier could not be read" reads as itself instead of as an empty log. */
export function renderFanInAttemptsText(res: FanInAttemptsResult): string {
  const lines: string[] = [];
  lines.push(`carrier: ${res.carrier}  status: ${res.status}${res.reason != null ? `  (${res.reason})` : ""}`);
  lines.push(`lines: ${res.totalLines} (${res.malformedLines} unparseable)  attempts: ${res.attempts.length}`);
  for (const a of res.attempts) {
    lines.push("");
    lines.push(`${a.ts ?? "—"}  ${a.task ?? "—"}  run=${a.run_id ?? "—"}  state=${a.final_state ?? "—"}`);
    if (a.step != null) lines.push(`  step:       ${a.step}`);
    if (a.reason != null) lines.push(`  reason:     ${a.reason}`);
    if (a.failure_reason != null) lines.push(`  failure:    ${a.failure_reason}`);
    if (a.suiteLog != null) lines.push(`  suite log:  ${a.suiteLog}`);
    if (a.fanInLog != null) lines.push(`  fan-in log: ${a.fanInLog}`);
  }
  return lines.join("\n") + "\n";
}

/** The `quay driver log` body — a pure function of (flags, resolved root) so the CLI and any future
 *  caller share ONE implementation (the `runDriver` pattern above). `root` is null when no
 *  `.quay/config.yml` was found (the caller reports it rather than guessing a workspace). */
export function runDriverLog(
  flags: Record<string, any>,
  root: string | null,
): { stdout: string; reason: string | null; exitCode: number } {
  if (!root) {
    return { stdout: "", reason: `quay driver log: no .quay/config.yml found (searched from ${flags.root ?? process.cwd()} upward). Run from a quay workspace root, or pass --root <workspace-root>.`, exitCode: 1 };
  }
  const kind = typeof flags.kind === "string" ? flags.kind : "";
  if (!KINDS.includes(kind)) {
    return { stdout: "", reason: `quay driver log: missing/invalid --kind: ${kind || "<empty>"} (expected ${KINDS.join("|")})`, exitCode: 1 };
  }
  if (kind !== "worker") {
    return { stdout: "", reason: `quay driver log: --kind ${kind} is not covered by this reader (only \`worker\` writes the per-attempt fan-in records). Refusing to print an empty log as if the driver had none.`, exitCode: 1 };
  }
  const limit = flags.limit !== undefined ? Number(flags.limit) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    return { stdout: "", reason: `quay driver log: --limit requires a non-negative integer (got ${JSON.stringify(flags.limit)})`, exitCode: 1 };
  }
  const taskId = typeof flags.task === "string" ? flags.task : null;
  const res = readFanInAttempts(root, { taskId, limit });
  const json = resolveJsonFlag(flags);
  if (json == null) {
    return { stdout: "", reason: `quay driver log: invalid --format value (only \`json\` is accepted)`, exitCode: 1 };
  }
  const stdout = json.json ? JSON.stringify(res, null, 2) + "\n" : renderFanInAttemptsText(res);
  // Only an UNREADABLE carrier is an error: an absent one is a real "this workspace ran no worker",
  // and `malformed-lines` still delivered the attempts that DID parse (both exit 0 — a caller that
  // needs the distinction reads `status` in the output, which is present in BOTH arms).
  return { stdout, reason: null, exitCode: res.status === "carrier-unreadable" ? 1 : 0 };
}

/** Project a `readLive` InFlightTask to the exact fields the `quay driver live` JSON exposes.
 *  ⛔ `blocks`/`blockedBy` are OMITTED on purpose: readLive only populates them from its full
 *  task-store scan (`computeBlocking`), which this surface deliberately skips (the same cost decision
 *  the dashboard live card makes). Emitting `[]` there would read as "nothing blocks" — a value the
 *  reader never computed (hard rule 3b: 读不懂 ⇒ 不得返回与合格同形的值). */
function projectInFlight(t: InFlightTask): Record<string, unknown> {
  return {
    taskId: t.taskId,
    runId: t.runId,
    pid: t.pid,
    sessionId: t.sessionId,
    startedAtMs: t.startedAtMs,
    implCompletedAtMs: t.implCompletedAtMs,
    status: t.status,
    phase: t.phase,
    suite: t.suite,
    minutes: t.minutes,
    liveness: t.liveness,
  };
}

/** The `quay driver live` body — a pure function of (flags, resolved root), the `runDriverLog` pattern.
 *  Prints the current in-flight worker reading as JSON (ALWAYS JSON: it is the machine-readable
 *  counterpart to the web dashboard's "Loop pulse" card). Read-only — never starts/stops/spawns, never
 *  needs a serve process — and it reuses observation.readLive's ONE call chain (⛔ no second /proc scan).
 *  `root` is null when no `.quay/config.yml` was found (reported, never guessed).
 *
 *  Exit code is 0 for EVERY evaluated reading — including an empty in-flight set. "Not evaluated" is
 *  NOT an error here; it is carried by `workerSignal.evaluated === false` + a non-null `reason`, the
 *  independent value that separates it from "zero in flight" (hard rule 3b). */
export function runDriverLive(
  flags: Record<string, any>,
  root: string | null,
): { stdout: string; reason: string | null; exitCode: number } {
  if (!root) {
    return { stdout: "", reason: `quay driver live: no .quay/config.yml found (searched from ${flags.root ?? process.cwd()} upward). Run from a quay workspace root, or pass --root <workspace-root>.`, exitCode: 1 };
  }
  // `--kind` is optional for `live` and only `worker` is covered (the only kind with in-flight worker
  // processes). An explicit other kind is refused rather than silently answered with worker data.
  const kind = typeof flags.kind === "string" ? flags.kind : "";
  if (kind !== "" && kind !== "worker") {
    return { stdout: "", reason: `quay driver live: --kind ${kind} is not covered by this reader (only \`worker\` has in-flight worker processes). Refusing to answer with worker data for a different kind.`, exitCode: 1 };
  }
  const reading = readLiveWorkers(root);
  const out = {
    root: reading.root,
    kind: "worker",
    workerSignal: reading.workerSignal,
    telemetry: reading.telemetry,
    inFlight: reading.inFlight.map(projectInFlight),
  };
  return { stdout: JSON.stringify(out, null, 2) + "\n", reason: null, exitCode: 0 };
}

/**
 * AC3 (gap-fan-in-instrument-availability-self-check): attach the two fan-in instruments' probe
 * readings to `quay driver status --kind worker`'s output. The reading is a FACT and ⛔ never a control
 * signal — it changes no exit code, and ⛔ must not be read as "the driver will refuse something"
 * (record only, never intercept; the ruling and its why live on ff-merge.ts's probeInstruments).
 *
 * `scriptsDir` = the resolved KERNEL's own dir — the same dir `resolveKernelScriptsDir()` hands the
 * mechanical fan-in — so the reading answers "can THIS installation resolve its instruments", not "does
 * the workspace happen to carry a copy". `root` = the workspace root `status` was resolved against: the
 * tree a fan-in of this workspace would classify against.
 *
 * `--json` output is merged in place (parsed, then re-serialized) so machine readers still see ONE
 * object; any non-JSON output gets the two readings appended as text lines.
 */
export function withInstrumentReadings(stdout: string, root: string, scriptsDir: string): string {
  let probe: InstrumentProbe;
  try {
    probe = probeInstruments(root, scriptsDir);
  } catch (e) {
    // probeInstruments is structurally throw-free; if it ever throws, say NOT-evaluated (hard rule 3b)
    // rather than swallow it into a reading shaped like "available".
    const detail = `probe threw: ${(e as Error)?.message ?? String(e)}`;
    probe = { classifier: { evaluated: false, detail }, reaper: { evaluated: false, detail } };
  }
  const line = (name: string, r: InstrumentReading): string =>
    `instruments: ${name} evaluated=${r.evaluated ? 1 : 0} — ${r.detail}`;
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify({ ...parsed, instruments: probe }) + "\n";
      }
    } catch { /* not JSON after all — fall through to the text arm */ }
  }
  const prefix = stdout === "" || stdout.endsWith("\n") ? stdout : stdout + "\n";
  return prefix + line("classifier", probe.classifier) + "\n" + line("reaper", probe.reaper) + "\n";
}

/** AC3 (gap-fan-in-instrument-availability-self-check): the two fan-in instruments are a worker-kind
 *  concern (its mechanical fan-in is their only consumer) — attach their readings to `status` for
 *  `worker` only. ⛔ stdout only: the probe never changes the command's success (exitCode untouched).
 *
 *  ⛔ CLI-only (GOAL-033/AC-350): this decoration used to be applied inside `runDriver` /
 *  `runDriverAsync`; those moved to core-root (`../driver-control.ts`), which ⛔ must not import
 *  `../fan-in/`. `handleDriver` therefore applies it here, on the kernel's RAW stdout, reusing the
 *  `root`/`kernelPath` that the SAME spawn resolution already returned (⛔ no second resolution).
 *  ⚠️ `cli/server.ts` and `serve-sessions.ts` read the raw stdout — they parse named fields only and
 *  never read `instruments`, so dropping the decoration on those two paths is unobservable. */
function withWorkerInstrumentReadings(
  verb: string,
  kind: string | undefined,
  stdout: string,
  root: string,
  kernelPath: string,
): string {
  return verb === "status" && kind === "worker"
    ? withInstrumentReadings(stdout, root, path.dirname(kernelPath))
    : stdout;
}
