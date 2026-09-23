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
import { execFileSync, spawnSync } from "node:child_process";
import { parseFlags, resolveJsonFlag } from "./flags.ts";
import { findConfig } from "../config.ts";
import { resolvePluginScriptExec } from "../plugin-root.ts";
import { readFanInAttempts, type FanInAttemptsResult } from "../observation.ts";
// gap-fan-in-instrument-availability-self-check AC3：`quay driver status --kind worker` 也报这两个 fan-in
// 仪器的当前读数。⛔ 只读（探针不写任何 quay 状态）、⛔ 不改退出码——它是**事实**，不是拦截信号。
import { probeInstruments, type InstrumentProbe, type InstrumentReading } from "../fan-in/ff-merge.ts";
import type { CliCtx } from "./context.ts";

// VERBS 与 KINDS 定义在 cli/driver-vocab.ts（零依赖叶模块——help.ts 静态 import 它，⛔ 不能把这两个
// 常量留在本文件：本文件的传递闭包带 config.ts/plugin-root.ts，实测会让 `quay --help` 每次调用贵 0.4s）。
// 此处 import + 再导出，保持既有 import 位点（goal-driver.test.mjs AC6）不变。
import { KINDS, VERBS } from "./driver-vocab.ts";
export { KINDS, VERBS };

/** Resolve the workspace root from `--root` (walk-up) or the process cwd; null when no config. */
function resolveRoot(rootFlag: string | undefined): string | null {
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

export async function handleDriver({ sub, rest, positional }: CliCtx) {
  const { flags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

  if (sub === "--help" || sub === "-h" || flags.help) {
    process.stdout.write(`quay driver — start/stop/drain/resume/status/restart the resident quay drivers (AC139)

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

  --kind <${KINDS.join("|")}>   Required. Which driver the command targets.
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

  // `log` is the ONE read-only verb: it is intercepted HERE, before the kernel delegation below,
  // because it has no kernel counterpart (no supervisor, no control state, no spawn). ⛔ It also does
  // NOT go through the worktree-root rejection — that guard protects a RESIDENT PROCESS from being
  // carried by a short-lived worktree, and reading a log from one is harmless (and useful: an
  // operator debugging a worktree reads its log there).
  if (sub === "log") {
    const r = runDriverLog(flags, resolveRoot(flags.root));
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.reason) process.stderr.write(r.reason + "\n");
    process.exitCode = r.exitCode;
    return;
  }

  const r = runDriver(sub, flags.kind, rest, flags.root);
  if (r.stdout) process.stdout.write(r.stdout);
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
export function runDriver(
  verb: string,
  kind: string | undefined,
  rest: string[],
  rootFlag: string | undefined,
): DriverRunResult {
  if (!VERBS.includes(verb)) {
    return { ok: false, reason: `quay driver: unknown subcommand: ${verb} (try: ${VERBS.join(", ")})`, stdout: "", stderr: "", exitCode: 1 };
  }
  if (!KINDS.includes(kind)) {
    return { ok: false, reason: `quay driver: missing/invalid --kind: ${kind ?? "<empty>"} (expected ${KINDS.join("|")})`, stdout: "", stderr: "", exitCode: 1 };
  }

  // AC139-4: resolve the carrier/entry path from the workspace root (NOT import.meta walk-up).
  const root = resolveRoot(rootFlag);
  if (!root) {
    return {
      ok: false,
      reason:
        `quay driver: no .quay/config.yml found (searched from ${rootFlag ?? process.cwd()} upward). ` +
        `Run from a quay workspace root, or pass --root <workspace-root>.`,
      stdout: "",
      stderr: "",
      exitCode: 1,
    };
  }

  // AC139-4: reject a worktree root (fail closed; never start a supervisor on a worktree).
  if (isWorktreeRoot(root)) {
    return {
      ok: false,
      reason:
        `quay driver: refusing to run from a git worktree (${root}). ` +
        `The resident supervisor must be carried from the workspace root (main checkout), ` +
        `not a short-lived worktree. Run from the main checkout instead.`,
      stdout: "",
      stderr: "",
      exitCode: 1,
    };
  }

  const kernel = resolvePluginScriptExec(path.join("scripts", "driver-runtime.ts"));
  if (!kernel) {
    return { ok: false, reason: `quay driver: driver runtime kernel not found (no plugin root resolved — no local plugin/ copy and no installed quay plugin)`, stdout: "", stderr: "", exitCode: 1 };
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
  const r = spawnSync(process.execPath, spawnArgs, { encoding: "utf8" });
  // AC3 (gap-fan-in-instrument-availability-self-check): the two fan-in instruments are a worker-kind
  // concern (its mechanical fan-in is their only consumer) — attach their readings to `status` for
  // `worker` only. ⛔ stdout only: the probe never changes the command's success (exitCode untouched).
  const stdout =
    verb === "status" && kind === "worker"
      ? withInstrumentReadings(r.stdout ?? "", root, path.dirname(kernel.path))
      : r.stdout ?? "";
  return { ok: true, reason: null, stdout, stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}
