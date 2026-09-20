// start-drivers.ts — `quay driver start --kind promotion` + `quay driver start --kind worker` +
// `quay driver start --kind outer` + `quay driver start --kind goal` + `quay serve` wrapped into
// ONE idempotent in-session call.
// (tasks/gap-skill-start-drivers-webserver — SPEC-tmux-retirement-2026-09-03 §1.4 Layer 3b 第④步)
//
// The drivers skill (`plugin/skills/drivers/SKILL.md`) delegates to this executable rather than
// repeating the idempotent-start loop inline — the same delegate pattern as the init skill →
// `quay-init.sh` (a second copy of the start logic is exactly the drift this repo keeps removing).
//
// What it does (idempotent — safe to run twice):
//   - For each driver kind (promotion, worker, outer, goal): `quay driver status --kind <kind> --json` says
//     `alive: 1` ⇒ skip; otherwise `quay driver start --kind <kind> --root <root>`. The driver
//     kernel (driver-runtime.ts startKind) is itself idempotent (`already-running`), so a race
//     between two invocations cannot double-spawn — the status pre-check is a fast path, not the
//     only guard.
//   - For the web server this script performs NO pre-flight liveness probe at all
//     (gap-serve-same-root-admission-lock): it SPAWNS `quay serve` and reads the verdict from the
//     child itself. The child owns a same-root admission lock (`.quay/server.lock`) and either binds
//     (exit-less, carrier published ⇒ `started`) or REFUSES because a live host already owns this
//     root (exit 0 + a machine-readable marker on stdout ⇒ `already-running`). ⛔ A `GET /` probe
//     used to answer "is something there", and that answer was WRONG in the case that motivated this
//     change: an unrelated process squatting the hardcoded port answered 200, so the script reported
//     "already running" for a server that was not ours. There is exactly ONE admission judge now
//     (the lock, inside the host), and it is not duplicated here.
//   - The STALENESS decision is unchanged and still lives HERE (it is an orchestration policy, not
//     an admission judgment): once the child reports `already-running`, the live host is identified
//     from `.quay/server.json` (its pid + its web port — the default port is now kernel-assigned, so
//     the carrier is the only place the port is knowable) and `GET /health` decides
//     fresh / stale / not-evaluated. STALE ⇒ RELOAD (SIGTERM that host, wait for its PID to die, then
//     spawn a fresh one). ⛔ gap-serve-stale-signal-has-no-consumer: before that task, "reachable" WAS
//     the whole decision, so a live-but-stale server was skipped forever and kept serving pre-fix code
//     until a human restarted it by hand — measured twice (2026-08-23: 8.5h stale, 11 UI tasks
//     invisible; 2026-09-14: 3h+ stale, AC-179 criterion verdict oscillating 6/20). The detector that
//     reports `stale:true` has existed since gap-webui-server-stale-code-no-restart-detection
//     (2026-08-23, `packages/quay/src/serve.ts:229 computeStaleStatus`); what was missing is a
//     CONSUMER, and this script owns the only decision point that decides whether a server runs.
//     `quay serve` has no supervisor (unlike the drivers), so backgrounding — and now reloading — is
//     THIS script's job, not a second copy of the driver supervisor.
//   - A `/health` that cannot be reached / parsed / carries no boolean `stale` is NOT-EVALUATED: a
//     SEPARATE value from "fresh" (硬規則 3b — a reading we could not take must not share a shape
//     with a passing one) and never silently "stale" either (⛔ no restart on a reading we could not
//     take). It is reported loudly on stderr and as `serve.staleness = "not-evaluated"` in `--json`.
//   - Failure paths are RELAYED, never swallowed: `quay driver start` exiting non-zero (halted —
//     "clear the halt first with: quay driver resume", or worktree-root rejection, or a missing
//     config) has its stderr forwarded verbatim and this script exits non-zero with the same
//     reason. This is 硬规则 3b: a "read-unable" state must not look like success.
//   - WHICH quay CLI gets invoked is itself reported, and a CLI that could not be EXECUTED at all
//     (spawnSync `error`/`status === null` — ENOENT/EACCES/timeout) is reported as such, naming the
//     argv0 and argv that were attempted. Before gap-start-drivers-cli-resolve-blind-to-vendor-
//     layout-and-swallows-enoent this was the one failure the `status !== 0` test could not see:
//     `status` is `null` for a never-started process, the relay forwarded an empty stderr, and the
//     script exited 1 with zero diagnostic bytes — indistinguishable from "could not read".
//
// Run:
//   node --experimental-strip-types plugin/scripts/start-drivers.ts [--root <path>] [--host <ip>]
//     [--port <p>] [--cli <path>] [--serve-timeout <ms>] [--json]
//
//   ⛔ `--port` is OPTIONAL and defaults to 0 =「让内核分配临时端口」. Only pass it to pin a host to
//   an exact port (a deployment that must be addressable at a fixed number); the pinned value is
//   then honored exactly and a real collision fails loudly.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

/** In-memory ceiling for the serve host this skill starts (2026-09-17 global-OOM remediation).
 *
 *  WHY: a `quay serve` host was measured at 0.65–1.7 GB RSS (plus a ~0.33 GB `quay-native mcp`
 *  child); several of them on this 16 GB box exhausted RAM and the kernel went global-OOM, killing
 *  dbus-daemon/systemd and an unrelated chrome batch. Uncapped, one leaked host grows unbounded.
 *
 *  ⛔ NOT a literal (硬规则 4 推论二): DERIVED from the host's MemTotal, so it stays a real ceiling
 *  (or a real absence of one) on a different machine instead of silently meaning something else.
 *  Floor 512 MB, cap 4 GB. A host that trips it aborts ITSELF (V8 OOM) rather than dragging the
 *  kernel into an unattributable global OOM.
 *
 *  ⚠️ Deliberately duplicated with `packages/quay/src/cli/server.ts:serveHeapCapMb` — this file is
 *  the kernel side of the kernel↔target boundary (GOAL-012) and must not import Core's source. */
function serveHeapCapMb(): number {
  return Math.min(4096, Math.max(512, Math.round(os.totalmem() / (1024 * 1024) / 5)));
}

function withServeHeapCap(existing: string | undefined): string {
  return [existing, `--max-old-space-size=${serveHeapCapMb()}`].filter(Boolean).join(" ");
}

const DRIVER_KINDS = ["promotion", "worker", "outer", "goal"] as const;
const DEFAULT_SERVE_HOST = "0.0.0.0";
/** The web port's default: **0 = let the kernel assign an ephemeral port** (read back from the
 *  carrier). A hardcoded 4173 was a second, silently-diverging default that also made two hosts on
 *  two roots collide, and it made an unrelated process squatting the number look like our server —
 *  the exact misreading this task closes. ⛔ The default belongs to ONE place (`startServer`'s own
 *  `port = 0`); this literal exists only for the `--port` help text and the argument parser. */
const DEFAULT_SERVE_PORT = 0;
const DEFAULT_SERVE_TIMEOUT_MS = 30000;
/** `GET /health` budget. Short: this is a local freshness read, not a build. */
const HEALTH_PROBE_TIMEOUT_MS = 2000;
/** How long to wait for a SIGTERM'd serve host's PID to die before giving up (reported, not
 *  swallowed — "could not stop it" must never read as "stopped"). */
const SERVE_STOP_TIMEOUT_MS = 10000;

/** The marker `quay serve` prints on stdout when its same-root admission lock refused the start.
 *  ⚠️ Deliberately duplicated with `packages/quay/src/serve.ts:SERVE_ADMISSION_REFUSED_MARKER` —
 *  this file is a self-contained plugin entry (rule (a) laydown, zero closure deps: see the
 *  direct-entry guard at the bottom) and must not import Core's source. Both copies must move
 *  together; the `self=<pid>` field is what binds a marker line to the spawn that produced it. */
export const SERVE_ADMISSION_REFUSED_MARKER = "quay-serve-admission-refused";

/** Direct quantity: is this pid a live process? Same semantics as Core `packages/quay/src/
 *  server-state.ts:pidAlive` (`kill(pid, 0)`; **EPERM = exists but not ours = still alive** —
 *  someone else's process is not a dead one). Duplicated for the same laydown reason as the marker
 *  above: this is a zero-closure-deps direct entry (see the guard at the bottom), so it may not
 *  import the single source.
 *
 *  ⚠️ THIS IS THE ONE REMAINING COPY, on purpose — the other three are gone
 *  (`.quay/routine-findings.jsonl` finding `pidalive-eperm-opposite`, routine `semantic-dedup-scan`,
 *  runId `semantic-dedup-scan-1789889905875`: three copies read EPERM as ALIVE and driver-runtime.ts
 *  kept a fourth that read it as DEAD). `driver-runtime.ts` now re-exports Core's, and
 *  `server-partial-stop-verify.ts` imports it from there. The signature here stays `number` (⛔ not
 *  the shared string-coercing one) because its single caller `stopServeHost(pid: number, …)` already
 *  holds a number — the divergence that mattered was the EPERM branch, not the input type. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/** The exact JSON the `quay driver status --json` emits; we read only `alive` (AC139-3). */
export interface DriverStatus {
  kind?: string;
  supervisor_pid?: number | null;
  driver_pid?: number | null;
  supervisor_alive?: number;
  driver_alive?: number;
  alive?: number;
  running?: number;
  carrier_path?: string;
  carrier_records?: number;
  last_record_ts?: string | null;
}

/** Parse `quay driver status --json` stdout → { alive, parsed }. `parsed:false` = could not read
 *  (硬规则 3b: a read-unable status is a SEPARATE value from "not alive"). */
export function parseDriverStatus(stdout: string): { alive: boolean; parsed: boolean } {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return { alive: false, parsed: false };
  try {
    const obj = JSON.parse(trimmed) as DriverStatus;
    if (typeof obj === "object" && obj !== null && "alive" in obj) {
      return { alive: obj.alive === 1 || obj.alive === true, parsed: true };
    }
    return { alive: false, parsed: false };
  } catch {
    return { alive: false, parsed: false };
  }
}

/** Walk up from `startDir` for `.quay/config.yml` (mirrors packages/quay/src/config.ts findConfig —
 *  the workspace root is the parent of the parent of that file). */
export function resolveWorkspaceRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The plugin root that hosts this script — i.e. the directory of the form
 *  `<plugin-root>/scripts/start-drivers.ts`. `CLAUDE_PLUGIN_ROOT` (harness-provided) wins when
 *  set: an explicit answer beats a derived guess, and a harness that names a root is authoritative
 *  even when the bundle is not there (we then report "not found", we do not silently probe a
 *  different tree). Otherwise derive it from this file's own location, which needs no env at all.
 *  Returns null only when neither source yields a path. */
export function resolvePluginRoot(
  env: NodeJS.ProcessEnv = process.env,
  scriptUrl: string = import.meta.url,
): string | null {
  const fromEnv = env.CLAUDE_PLUGIN_ROOT;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return path.resolve(fromEnv.trim());
  const scriptPath = scriptUrl.startsWith("file:") ? fileURLToPath(scriptUrl) : scriptUrl;
  const dir = path.dirname(path.resolve(scriptPath));
  if (path.basename(dir) !== "scripts") return null; // not the <plugin-root>/scripts/ layout
  return path.dirname(dir);
}

export interface CliResolveOptions {
  /** Plugin root to probe for the bundled vendor CLI. `undefined` ⇒ derive it (env, then this
   *  file's own path); `null` ⇒ no plugin root, so skip the vendor branch entirely (test seam). */
  pluginRoot?: string | null;
  env?: NodeJS.ProcessEnv;
}

/** Resolve how to invoke the `quay` CLI. Precedence:
 *    explicit `--cli` > source-tree `<root>/packages/quay/bin/quay.ts` (dev checkout) >
 *    bundled `<plugin-root>/vendor/quay/dist/quay.js` (quay-init's upgrade-channel layout —
 *    the provider path points at `<plugin-root>/vendor/quay-native`, so the CLI bundle is a
 *    sibling and NOT on PATH) > `quay` on PATH (user-scope install).
 *
 *  The vendor branch is why a third-party project can run this at all: quay-init's runtime
 *  migration installs the bundles under the plugin root and never puts `quay` on PATH, so
 *  before this branch existed the third-party case fell straight through to a PATH lookup
 *  that could only fail. */
export function resolveCliInvocation(
  root: string,
  explicitCli?: string,
  opts: CliResolveOptions = {},
): { argv0: string; args: string[] } {
  if (typeof explicitCli === "string" && explicitCli.trim() !== "") {
    const p = path.resolve(explicitCli);
    if (p.endsWith(".ts")) return { argv0: process.execPath, args: ["--experimental-strip-types", p] };
    return { argv0: process.execPath, args: [p] };
  }
  const srcTs = path.join(root, "packages", "quay", "bin", "quay.ts");
  if (fs.existsSync(srcTs)) {
    return { argv0: process.execPath, args: ["--experimental-strip-types", srcTs] };
  }
  const pluginRoot = opts.pluginRoot === undefined ? resolvePluginRoot(opts.env) : opts.pluginRoot;
  if (pluginRoot) {
    const vendorJs = path.join(pluginRoot, "vendor", "quay", "dist", "quay.js");
    if (fs.existsSync(vendorJs)) {
      return { argv0: process.execPath, args: [vendorJs] };
    }
  }
  return { argv0: "quay", args: [] };
}

/** Human-readable one-liner for a resolved invocation (used for the stderr self-report). */
export function formatInvocation(inv: { argv0: string; args: string[] }): string {
  return [inv.argv0, ...inv.args].join(" ");
}

export interface CliFailure {
  /** `spawn` = the process never started (ENOENT/EACCES/ETIMEDOUT); `signal` = killed by a signal;
   *  `exit` = it ran and exited non-zero. */
  kind: "spawn" | "signal" | "exit";
  code: string;
  message: string;
}

/** Classify a spawnSync result. Returns null when the CLI ran and exited 0.
 *
 *  The `status === null` case is the whole point: a process that never started has NO exit status,
 *  so a `status !== 0` test is true for it but carries no reason — the caller then relays an empty
 *  stderr and reports nothing (硬规则 3b: read-unable must not share a shape with "plain failure"). */
export function classifyCliFailure(res: {
  status?: number | null;
  signal?: NodeJS.Signals | null;
  error?: (Error & { code?: string }) | null;
}): CliFailure | null {
  if (res.error) {
    const code = res.error.code ?? "SPAWN-ERROR";
    return { kind: "spawn", code, message: res.error.message ?? String(res.error) };
  }
  if (res.status === null || res.status === undefined) {
    if (res.signal) return { kind: "signal", code: String(res.signal), message: `killed by signal ${res.signal}` };
    return { kind: "spawn", code: "NO-STATUS", message: "the process produced no exit status and no error" };
  }
  if (res.status !== 0) return { kind: "exit", code: String(res.status), message: `exit status ${res.status}` };
  return null;
}

/** The stderr block for a failed CLI call, or null when it succeeded. Always names the argv0 and
 *  the full argv so a third-party operator can see WHICH quay was attempted. */
export function formatCliFailure(
  inv: { argv0: string; args: string[] },
  res: { status?: number | null; signal?: NodeJS.Signals | null; error?: (Error & { code?: string }) | null },
): string | null {
  const fail = classifyCliFailure(res);
  if (!fail) return null;
  const lines = [`start-drivers: the quay CLI did not run successfully (${fail.kind}).`];
  lines.push(`  argv0: ${inv.argv0}`);
  lines.push(`  argv:  ${formatInvocation(inv)}`);
  if (fail.kind === "spawn") {
    lines.push(`  error: ${fail.code}${fail.message ? ` — ${fail.message}` : ""}`);
    lines.push(
      `  hint:  pass --cli <path-to-quay.js|quay.ts>, put \`quay\` on PATH, or install the plugin ` +
      `bundle at <plugin-root>/vendor/quay/dist/quay.js`,
    );
  } else if (fail.kind === "signal") {
    lines.push(`  signal: ${fail.code}`);
  } else {
    lines.push(`  exit status: ${fail.code}`);
  }
  return lines.join("\n") + "\n";
}

/** Run the resolved CLI synchronously; returns the raw spawnSync result (stdout/stderr/status). */
export function runCli(
  inv: { argv0: string; args: string[] },
  cmdArgs: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
) {
  return spawnSync(inv.argv0, [...inv.args, ...cmdArgs], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: process.env,
    timeout: opts.timeoutMs ?? 60000,
  });
}

/** What to do about the web server, given (a) the verdict the HOST PROCESS returned and (b) — only
 *  when a live host was reported — the staleness reading of that host's `/health`.
 *
 *  ⚠️ This REPLACES the old `planActions` (gap-serve-same-root-admission-lock): that function's
 *  only production caller was the serve decision, and its `startServe` field was computed from a
 *  `GET /` pre-probe that no longer exists. Its four driver fields were never read by anything (the
 *  driver loop uses `aliveByKind` directly), so keeping it would leave a pure decision function that
 *  decides nothing behind — deleted rather than kept as decoration.
 *
 *  Pure, and pinned by the unit tests, because this is the ONE decision point that decides whether a
 *  server runs: the two inputs are readings, the output is the action.
 *
 *  `staleness` is three-valued and only one of the three is a boolean:
 *    · `true`  — evaluated: the running code is STALE ⇒ reload (stop the host, spawn a fresh one)
 *    · `false` — evaluated: the running code is FRESH ⇒ leave it alone
 *    · `null`/`undefined` — NOT-EVALUATED (no carrier to identify the host /health unreadable)
 *      ⇒ leave it alone. ⛔ An unevaluated reading must NOT become a restart (硬規則 3b: a reading we
 *      could not take must not be laundered into an action that looks like a verdict); the caller
 *      reports the not-evaluated case as its own literal.
 *
 *  `admission` is the child's own verdict: `started` ⇒ this run bound a fresh host (nothing to
 *  decide); `already-running` ⇒ a live host owns this root, so the only remaining question is
 *  whether its code is stale. */
export function planServeAction(opts: {
  admission: "started" | "already-running";
  staleness?: boolean | null;
}): "started" | "already-listening" | "reload" {
  if (opts.admission === "started") return "started";
  return opts.staleness === true ? "reload" : "already-listening";
}

// ── Stale-serve consumption (gap-serve-stale-signal-has-no-consumer) ──────────────────────────
// The signal (`GET /health` → `stale`) is read over HTTP rather than by importing
// `packages/quay/src/serve.ts`: this script lays down as a self-contained plugin entry (rule (a),
// zero closure deps — see the direct-entry guard at the bottom), so a cross-layer source import
// would break the laydown. HTTP is also the same seam the AC-179 criterion itself uses.

/** The staleness reading of a LISTENING server. `evaluated: false` ⇒ every `stale`-shaped answer is
 *  NOT-EVALUATED (硬規則 3b) — it is never reported as, or treated as, "fresh". */
export interface ServeStaleness {
  /** true = `/health` answered with a boolean `stale`; false = it did not (see `reason`). */
  evaluated: boolean;
  /** Only meaningful when `evaluated`; true = the process is running code older than the code on disk. */
  stale: boolean | null;
  /** Machine-readable token naming WHY it was not evaluated; null when evaluated. */
  reason: string | null;
}

/** `GET /health` → the three-valued staleness reading. Never throws: every failure mode becomes
 *  `{ evaluated: false, stale: null, reason }` with a distinguishing token, so "could not read" is a
 *  SEPARATE value from "read, and it says fresh" (硬規則 3b). */
export function probeServeStaleness(
  host: string,
  port: number,
  timeoutMs = HEALTH_PROBE_TIMEOUT_MS,
): Promise<ServeStaleness> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: ServeStaleness) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const notEvaluated = (reason: string): ServeStaleness => ({ evaluated: false, stale: null, reason });
    const req = http.request({ host, port, path: "/health", method: "GET", timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        // ⛔ Any status other than 200 is "this is not a health answer", not "healthy".
        if (res.statusCode !== 200) return finish(notEvaluated(`http-${res.statusCode ?? "?"}`));
        let obj: unknown;
        try {
          obj = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return finish(notEvaluated("unparseable-body"));
        }
        if (typeof obj !== "object" || obj === null) return finish(notEvaluated("body-not-an-object"));
        const stale = (obj as { stale?: unknown }).stale;
        if (typeof stale === "boolean") return finish({ evaluated: true, stale, reason: null });
        // The server itself says it could not determine (its own 硬規則 3b value) — NOT "fresh".
        if (stale === null) return finish(notEvaluated("health-says-not-evaluated"));
        return finish(notEvaluated(stale === undefined ? "no-stale-field" : "stale-not-boolean"));
      });
      res.on("error", () => finish(notEvaluated("response-error")));
    });
    req.on("error", () => finish(notEvaluated("unreachable")));
    req.on("timeout", () => {
      req.destroy();
      finish(notEvaluated("timeout"));
    });
    req.end();
  });
}

/** The host pid named by `.quay/server.json` — the carrier `quay serve` writes about ITSELF
 *  (`packages/quay/src/server-state.ts`). Three-valued on purpose (硬規則 3b): an unreadable carrier
 *  must not read as "no server", and "absent" must not read as "unreadable" — the caller acts
 *  differently on each.
 *
 *  ⛔ Not `.quay/serve.pid`: that file is written by THIS script's own spawn and goes stale the moment
 *  a host is started any other way (measured 2026-09-14: `.quay/serve.pid` = 2382532, long dead, while
 *  the live host was 3373657 and correctly named in `.quay/server.json`). Killing a stale pid file is
 *  how a reload becomes a no-op. */
export function readServeHostPid(
  root: string,
): { state: "present"; pid: number; startedAt: string | null; port: number | null } | { state: "absent" } | { state: "unreadable"; reason: string } {
  const p = path.join(root, ".quay", "server.json");
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { state: "absent" };
    return { state: "unreadable", reason: `read-failed:${code ?? "?"}` };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { state: "unreadable", reason: "unparseable" };
  }
  const pid = (obj as { pid?: unknown } | null)?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return { state: "unreadable", reason: "no-usable-pid" };
  const startedAt = typeof (obj as { startedAt?: unknown }).startedAt === "string" ? (obj as { startedAt: string }).startedAt : null;
  // The `web` face's port — the ONLY knowable address of the host now that the default port is
  // kernel-assigned, so /health can be read back from it. `null` when the carrier names no usable
  // web entry: that is a NOT-EVALUATED staleness reading (own literal), never port 0 / never a guess.
  const services = (obj as { services?: unknown }).services;
  const webEntry = Array.isArray(services)
    ? (services as Array<{ name?: unknown; port?: unknown }>).find((s) => s && s.name === "web")
    : undefined;
  const port = webEntry && typeof webEntry.port === "number" && Number.isInteger(webEntry.port) && webEntry.port > 0
    ? webEntry.port
    : null;
  return { state: "present", pid, startedAt, port };
}

/** SIGTERM the serve host, then wait for ITS PID to die. Discriminated result — "could not stop it"
 *  is NEVER reported as "stopped" (硬規則 3b); the caller must not spawn a replacement on top of a
 *  host that is still running.
 *
 *  Why PID death and not "the port stopped answering" (gap-serve-same-root-admission-lock): the port
 *  was a PROXY for 「宿主结束了」, and it is a proxy that goes stale in both directions — with an
 *  ephemeral-port default the caller would not even know which port to watch, an unrelated process
 *  holding that port would look like "still running", and a host that released its listener while
 *  staying alive would look like "stopped". `pidAlive` is the direct reading of the thing we act on.
 *  It is also what makes the new host's own stale-lock reclaim compatible with this wait: by the time
 *  we spawn, the old pid is gone, so a lock it left behind is unambiguously reclaimable. */
export async function stopServeHost(
  pid: number,
  timeoutMs = SERVE_STOP_TIMEOUT_MS,
): Promise<{ state: "stopped" | "still-alive" | "kill-failed"; error?: string }> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH = the pid is already gone, which IS the wanted end state (idempotent, like every other
    // action here). Any other errno is a real failure to stop it.
    if (code === "ESRCH") return { state: "stopped" };
    return { state: "kill-failed", error: code ?? String(err) };
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return { state: "stopped" };
    await sleep(200);
  }
  return { state: "still-alive" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ServeStartResult {
  state: "started" | "already-running" | "exited" | "timeout" | "spawn-failed";
  pid?: number;
  exitCode?: number | null;
  /** The port the kernel actually bound, read back from the carrier the child published. Only for
   *  `started`; null when the carrier named no usable web port (the host is up — we just did not
   *  read its port). */
  port?: number | null;
  /** The live host that already owns this root (the admission lock's holder). Only for
   *  `already-running`. */
  holderPid?: number | null;
  /** Set only for `spawn-failed`: the errno of the never-started process (e.g. "ENOENT"). */
  error?: string;
}

/** Did the bytes this spawn appended to the log carry OUR child's admission-refusal marker?
 *
 *  Read from `startOffset` (the log's size BEFORE the spawn) so a marker left by an earlier run in
 *  the same file can never answer for this one, and require `self=<our child pid>` so a concurrent
 *  start-drivers' refusal cannot answer either. Returns the holder pid the marker names, or null. */
export function readAdmissionRefusal(logPath: string, startOffset: number, childPid: number | undefined): { holderPid: number | null } | null {
  if (typeof childPid !== "number") return null;
  let chunk: string;
  try {
    const size = fs.statSync(logPath).size;
    if (size <= startOffset) return null;
    const fd = fs.openSync(logPath, "r");
    try {
      const buf = Buffer.alloc(size - startOffset);
      fs.readSync(fd, buf, 0, buf.length, startOffset);
      chunk = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of chunk.split("\n")) {
    const at = line.indexOf(SERVE_ADMISSION_REFUSED_MARKER);
    if (at === -1) continue;
    const rest = line.slice(at);
    const self = /self=(\d+)/.exec(rest);
    if (!self || Number(self[1]) !== childPid) continue;
    const holder = /holder=(\d+)/.exec(rest);
    return { holderPid: holder ? Number(holder[1]) : null };
  }
  return null;
}

/** Start `quay serve` detached (setsid-equivalent: spawn(detached)+unref, stdio → log file), write
 *  `.quay/serve.pid`, then wait for the CHILD's OWN verdict.
 *
 *  The verdict is read from two direct quantities, never from a probe this script runs itself:
 *    · the child is alive AND `.quay/server.json` names it (it publishes the carrier only AFTER the
 *      bind succeeded) ⇒ `started`, with the port read back from that carrier;
 *    · the child exited and appended its admission-refusal marker ⇒ `already-running` — a live host
 *      already owns this root. ⛔ Deliberately its OWN state: folding it into `exited` would report
 *      an idempotent no-op as a crash.
 *
 *  `spawn` failures arrive as an async 'error' EVENT, not a throw and not an exit code — without
 *  the listener below an unresolvable argv0 becomes an unhandled 'error' (process-level crash with
 *  a raw stack) or, worse, a silent timeout. Both hide the actual reason, so it is captured into
 *  `state: "spawn-failed"` + `error` and reported by the caller. */
export async function startServe(
  inv: { argv0: string; args: string[] },
  root: string,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<ServeStartResult> {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const logPath = path.join(root, ".quay", "serve.log");
  let logFd: number;
  let startOffset = 0;
  try {
    logFd = fs.openSync(logPath, "a");
    startOffset = fs.statSync(logPath).size; // before the spawn: only OUR child's bytes are read
  } catch {
    logFd = fs.openSync("/dev/null", "w");
  }
  const spawnedAtMs = Date.now();
  const child = spawn(
    inv.argv0,
    [...inv.args, "serve", "--host", host, "--port", String(port)],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: withServeHeapCap(process.env.NODE_OPTIONS) },
    },
  );
  let spawnError: (Error & { code?: string }) | null = null;
  child.on("error", (err) => { spawnError = err as Error & { code?: string }; });
  child.unref();
  if (child.pid) {
    try { fs.writeFileSync(path.join(root, ".quay", "serve.pid"), String(child.pid)); } catch { /* best-effort */ }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) {
      return { state: "spawn-failed", pid: child.pid, error: (spawnError as Error & { code?: string }).code ?? "SPAWN-ERROR" };
    }
    if (child.exitCode !== null) {
      const refusal = readAdmissionRefusal(logPath, startOffset, child.pid);
      if (refusal) return { state: "already-running", pid: child.pid, exitCode: child.exitCode, holderPid: refusal.holderPid };
      return { state: "exited", pid: child.pid, exitCode: child.exitCode };
    }
    // Both readings must agree: the carrier names THIS child, and its recorded start instant is not
    // older than this spawn (a recycled pid could otherwise inherit a dead host's carrier entry).
    const carrier = readServeHostPid(root);
    if (carrier.state === "present" && carrier.pid === child.pid) {
      const startedMs = carrier.startedAt ? Date.parse(carrier.startedAt) : NaN;
      if (!Number.isFinite(startedMs) || startedMs >= spawnedAtMs - 2000) {
        return { state: "started", pid: child.pid, port: carrier.port };
      }
    }
    await sleep(250);
  }
  return { state: "timeout", pid: child.pid };
}

interface Options {
  root?: string;
  host: string;
  port: number;
  cli?: string;
  serveTimeoutMs: number;
  json: boolean;
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = {
    host: DEFAULT_SERVE_HOST,
    port: DEFAULT_SERVE_PORT,
    serveTimeoutMs: DEFAULT_SERVE_TIMEOUT_MS,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") opts.root = argv[++i];
    else if (a === "--host") opts.host = argv[++i];
    else if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--cli") opts.cli = argv[++i];
    else if (a === "--serve-timeout") opts.serveTimeoutMs = Number(argv[++i]);
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(`start-drivers — start promotion + worker + outer + goal drivers and the web server (idempotent)

Usage:
  node --experimental-strip-types plugin/scripts/start-drivers.ts [flags]

Flags:
  --root <path>          Workspace root (default: discovered via .quay/config.yml from cwd).
  --host <ip>            Web server bind host (default: ${DEFAULT_SERVE_HOST}).
  --port <p>             Web server port (default: ${DEFAULT_SERVE_PORT} = kernel-assigned ephemeral).
                         Pass it only to pin an exact port; a real collision then fails loudly.
  --cli <path>           Explicit quay CLI path (default: auto-resolve source-tree → plugin vendor bundle → PATH).
  --serve-timeout <ms>   How long to wait for the spawned serve host to report its verdict (default: ${DEFAULT_SERVE_TIMEOUT_MS}).
  --json                 Machine-readable summary on stdout.

Web server semantics (gap-serve-same-root-admission-lock): this script performs NO pre-flight
liveness probe — it spawns \`quay serve\` and reads the verdict from that child. The child owns a
same-root admission lock, so it either binds (\`started\`) or refuses because a live host already owns
this root (\`already-running\` — reported, ⛔ not folded into a failure). When a live host is reported,
\`GET /health\` on the port its carrier names decides: FRESH ⇒ kept; STALE ⇒ RELOADED (SIGTERM that
host, wait for its pid to die, spawn a fresh one); unreadable ⇒ LEFT ALONE and reported as
\`staleness: "not-evaluated"\` — ⛔ a reading we could not take is never laundered into either
\"fresh\" or \"stale\".
`);
      return null;
    } else {
      process.stderr.write(`start-drivers: unknown argument: ${a}\n`);
      return null;
    }
  }
  return opts;
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts === null) return 2;
  // 0 is the DEFAULT and a legal value (kernel-assigned); ⛔ it is not "unset" — see the help text.
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    process.stderr.write(`start-drivers: invalid --port: ${opts.port}\n`);
    return 2;
  }
  if (!Number.isFinite(opts.serveTimeoutMs) || opts.serveTimeoutMs < 0) {
    process.stderr.write(`start-drivers: invalid --serve-timeout: ${opts.serveTimeoutMs}\n`);
    return 2;
  }

  const root = resolveWorkspaceRoot(opts.root ?? process.cwd());
  if (!root) {
    process.stderr.write(
      `start-drivers: no .quay/config.yml found (searched from ${opts.root ?? process.cwd()} upward). ` +
      `Run from a quay workspace root, or pass --root <workspace-root>.\n`,
    );
    return 1;
  }
  const inv = resolveCliInvocation(root, opts.cli);
  // Self-report WHICH quay is being driven (stderr, so --json stdout stays machine-readable). The
  // third-party failure mode this task fixes was a silent one: zero bytes of output plus a PATH
  // lookup nobody could see. One line makes the selected CLI part of the record.
  process.stderr.write(`start-drivers: quay CLI = ${formatInvocation(inv)}\n`);

  const report: Record<string, unknown> = { root, cli: formatInvocation(inv), drivers: {} as Record<string, unknown>, serve: {} as Record<string, unknown> };
  const drv = report.drivers as Record<string, unknown>;

  // 1. Drivers — status pre-check (fast path) + start (the kernel is itself idempotent).
  for (const kind of DRIVER_KINDS) {
    const status = runCli(inv, ["driver", "status", "--kind", kind, "--root", root, "--json"], { cwd: root });
    if (classifyCliFailure(status) !== null) {
      // Relay the status error (worktree-root rejection / missing config) — never treat as "not alive".
      // `status !== 0` alone missed the never-started case (status === null + ENOENT): the relay then
      // forwarded an empty stderr and the script exited 1 with zero diagnostic bytes.
      if (status.stderr) process.stderr.write(status.stderr);
      if (status.stdout) process.stderr.write(status.stdout);
      const diag = formatCliFailure(inv, status);
      if (diag) process.stderr.write(diag);
      return 1;
    }
    const parsed = parseDriverStatus(status.stdout);
    if (!parsed.parsed) {
      process.stderr.write(
        `start-drivers: could not parse \`quay driver status --kind ${kind}\` output (read-unable is not "not alive")\n`,
      );
      return 1;
    }
    if (parsed.alive) {
      drv[kind] = { state: "already-running" };
      if (!opts.json) process.stdout.write(`${kind}: already running (alive)\n`);
      continue;
    }
    const start = runCli(inv, ["driver", "start", "--kind", kind, "--root", root], { cwd: root });
    if (start.stdout) process.stdout.write(start.stdout);
    if (start.stderr) process.stderr.write(start.stderr);
    if (classifyCliFailure(start) !== null) {
      drv[kind] = { state: "error", exit: start.status ?? null };
      // ⛔ DO NOT swallow: the CLI's own reason (halted / worktree / config) is the actionable message
      // — and when the CLI never started at all, that too is stated (argv0 + ENOENT), never silence.
      const diag = formatCliFailure(inv, start);
      if (diag) process.stderr.write(diag);
      return 1;
    }
    // AC-203 (gap-driver-runtime-driver-path-anchored-at-project-root-not-dist): start 的退出码 0
    // 不等于 driver 真活——今天 `quay driver start` 就 exit 0 而系统是死的（driver not found，死在
    // supervisor 内部日志里）。start 之后重跑 status 并 parseDriverStatus，只有 alive=1 才报 started；
    // parsed=false（读不出）与 alive=false（不活）各报独立失败、exit 非 0 —— 复用 parseDriverStatus，
    // 不新造读法。
    const postStatus = runCli(inv, ["driver", "status", "--kind", kind, "--root", root, "--json"], { cwd: root });
    if (postStatus.stderr) process.stderr.write(postStatus.stderr);
    const postDiag = formatCliFailure(inv, postStatus);
    if (postDiag) {
      // The CLI failed to run (or exited non-zero) on the verification pass — say so explicitly
      // rather than letting it read as "status output was garbage".
      process.stderr.write(postDiag);
      drv[kind] = { state: "unverified", reason: "status-command-failed" };
      return 1;
    }
    const postParsed = parseDriverStatus(postStatus.stdout);
    if (!postParsed.parsed) {
      process.stderr.write(
        `start-drivers: after start, could not parse \`quay driver status --kind ${kind}\` output (read-unable is not "alive")\n`,
      );
      drv[kind] = { state: "unverified", reason: "status-unreadable" };
      return 1;
    }
    if (!postParsed.alive) {
      process.stderr.write(
        `start-drivers: ${kind} exited 0 from \`quay driver start\` but is not alive per \`quay driver status\` — refusing to report started\n`,
      );
      drv[kind] = { state: "unverified", reason: "not-alive" };
      return 1;
    }
    drv[kind] = { state: "started", alive: true };
    if (!opts.json) process.stdout.write(`${kind}: started\n`);
  }

  // 2. Web server — the ADMISSION verdict comes from the host process ITSELF (its same-root lock);
  //    this script performs no pre-flight liveness probe and owns no second liveness judge
  //    (gap-serve-same-root-admission-lock). What remains HERE is the staleness POLICY, applied only
  //    once the host has told us a live host exists.
  //
  //    ⛔ The old `GET /` pre-probe is deleted, not moved: it answered "is something answering this
  //    port", which was wrong in exactly the incident that motivated this task (an unrelated process
  //    squatting the hardcoded port answered 200 ⇒ reported as "our server is already running").
  //    With an ephemeral default there is no single port to probe any more, either.
  const admission = await startServe(inv, root, opts.host, opts.port, opts.serveTimeoutMs);

  if (admission.state === "started") {
    const boundPort = admission.port ?? null;
    report.serve = { state: "started", pid: admission.pid, host: opts.host, port: boundPort };
    if (!opts.json) {
      process.stdout.write(
        `serve: started (pid=${admission.pid ?? "?"}) on http://${opts.host}:${boundPort ?? "?"}` +
        `${boundPort == null ? " (port not read back from the carrier)" : ""}\n`,
      );
    }
  } else if (admission.state === "already-running") {
    // A live host owns this root (the child's lock refused). Identify it from the carrier IT
    // published — that carrier is also the ONLY knowable address of the web face now that the
    // default port is kernel-assigned, which is what makes the freshness read possible at all.
    const carrier = readServeHostPid(root);
    const livePort = carrier.state === "present" ? carrier.port : null;
    let staleness: ServeStaleness;
    if (carrier.state !== "present") {
      // Three-way carrier (硬規則 3b): "exists but unusable" is its own literal, never folded into
      // "no server" — we know a host is live (the lock said so) but cannot read its freshness.
      staleness = { evaluated: false, stale: null, reason: `carrier-${carrier.state}${carrier.state === "unreadable" ? `:${carrier.reason}` : ""}` };
    } else if (livePort == null) {
      staleness = { evaluated: false, stale: null, reason: "carrier-no-web-port" };
    } else {
      staleness = await probeServeStaleness(opts.host, livePort);
    }

    const action = planServeAction({ admission: "already-running", staleness: staleness.evaluated ? staleness.stale : null });

    if (action === "already-listening") {
      // Live host, code FRESH (or a freshness reading we could not take) ⇒ nothing to do. The two
      // cases carry DIFFERENT literals: a not-evaluated reading is reported as such, never as
      // "fresh" (硬規則 3b)...
      const kind = staleness.evaluated ? "fresh" : "not-evaluated";
      report.serve = {
        state: "already-listening",
        host: opts.host,
        port: livePort,
        pid: carrier.state === "present" ? carrier.pid : (admission.holderPid ?? null),
        staleness: kind,
        stalenessReason: staleness.reason,
      };
      if (staleness.evaluated) {
        if (!opts.json) process.stdout.write(`serve: already running (pid=${carrier.state === "present" ? carrier.pid : "?"}) on http://${opts.host}:${livePort} (code fresh)\n`);
      } else {
        // ...and is LOUD, because the alternative reading is "no signal at all" — the 2026-08-23
        // state this task exists to close. ⛔ Still no restart: we do not tear down a running server
        // on a reading we could not take.
        process.stderr.write(
          `serve: already running (pid=${carrier.state === "present" ? carrier.pid : "?"}) — ⛔ staleness NOT-EVALUATED ` +
          `(reason: ${staleness.reason}); NOT restarting (a reading we could not take is not a verdict).\n`,
        );
        if (!opts.json) process.stdout.write(`serve: already running on http://${opts.host}:${livePort ?? "?"} (staleness NOT-EVALUATED: ${staleness.reason})\n`);
      }
    } else {
      // RELOAD — the case that used to be silently skipped. The host to stop is the one the lock
      // named (the carrier's pid and the lock holder are the same host by construction; the carrier
      // is preferred only because it also carries the port for the report).
      if (carrier.state !== "present") {
        const why = carrier.state === "unreadable" ? ` — ${carrier.reason}` : "";
        process.stderr.write(
          `serve: a live host owns this root but its carrier does not name a usable host ` +
          `(carrier=${carrier.state}${why}) — refusing to act on a host that cannot be identified; ` +
          `stop it by hand and re-run.\n` +
          `  carrier file: .quay/server.json\n`,
        );
        report.serve = { state: "reload-host-unknown", host: opts.host, port: null, staleness: "stale", carrier: carrier.state };
        if (opts.json) process.stdout.write(JSON.stringify(report));
        return 1;
      }
      const stopped = await stopServeHost(carrier.pid);
      if (stopped.state !== "stopped") {
        process.stderr.write(
          `serve: stale serve host pid=${carrier.pid} could not be stopped (${stopped.state}` +
          `${stopped.error ? `: ${stopped.error}` : ""}) — it is still alive; ⛔ not spawning a second host on top of it.\n`,
        );
        report.serve = { state: "reload-stop-failed", host: opts.host, port: livePort, staleness: "stale", previousPid: carrier.pid, detail: stopped.state };
        if (opts.json) process.stdout.write(JSON.stringify(report));
        return 1;
      }
      process.stderr.write(`serve: STALE (code on disk newer than pid=${carrier.pid}) — reloading\n`);
      const res = await startServe(inv, root, opts.host, opts.port, opts.serveTimeoutMs);
      const boundPort = res.state === "started" ? (res.port ?? null) : livePort;
      report.serve = { ...res, state: res.state === "started" ? "reloaded-stale" : res.state, host: opts.host, port: boundPort, staleness: "stale", previousPid: carrier.pid };
      if (res.state !== "started") {
        process.stderr.write(
          `serve: reload failed after stopping pid=${carrier.pid} (${res.state}${res.state === "already-running" ? " — another host took this root in the window" : ""}); see .quay/serve.log\n`,
        );
        if (opts.json) process.stdout.write(JSON.stringify(report));
        return 1;
      }
      if (!opts.json) {
        process.stdout.write(`serve: reloaded (was stale pid=${carrier.pid} → pid=${res.pid ?? "?"}) on http://${opts.host}:${res.port ?? "?"}\n`);
      }
    }
  } else {
    // The child never delivered a verdict: spawn failure (never started), exit, or timeout. All
    // three are failures of THIS run — ⛔ `already-running` is NOT among them (it is handled above
    // as an idempotent outcome), which is the whole point of the extra state.
    report.serve = { ...admission, host: opts.host, port: null };
    if (admission.state === "spawn-failed") {
      const diag = formatCliFailure(inv, { status: null, error: Object.assign(new Error(`spawn ${inv.argv0}: ${admission.error}`), { code: admission.error }) });
      process.stderr.write(`serve: the quay CLI could not be executed (${admission.error}); argv0=${inv.argv0}; argv=${formatInvocation(inv)}\n`);
      if (diag) process.stderr.write(diag);
    } else if (admission.state === "exited") {
      process.stderr.write(`serve: process exited before becoming a host (exit=${admission.exitCode}); see .quay/serve.log\n`);
    } else {
      process.stderr.write(`serve: did not report a verdict within ${opts.serveTimeoutMs}ms; see .quay/serve.log\n`);
    }
    if (opts.json) process.stdout.write(JSON.stringify(report));
    return 1;
  }

  if (opts.json) process.stdout.write(JSON.stringify(report));
  return 0;
}

// Direct-entry guard (gate-script-base convention, inlined to keep this file self-contained —
//  no ESM sibling imports, so it lays down via rule (a) with zero closure deps).
const _entryBase = path.basename(process.argv[1] ?? "").replace(/\.(js|ts|mjs)$/, "");
if (_entryBase === "start-drivers") {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
