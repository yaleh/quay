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
//   - For the web server: probe `GET /` on `<host>:<port>` ⇒ reachable ⇒ skip; otherwise spawn
//     `quay serve --host <host> --port <port>` detached (setsid-equivalent) and poll the probe
//     until it answers. `quay serve` has no supervisor (unlike the drivers), so backgrounding is
//     THIS script's job — not a second copy of the driver supervisor.
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

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const DRIVER_KINDS = ["promotion", "worker", "outer", "goal"] as const;
const DEFAULT_SERVE_HOST = "0.0.0.0";
const DEFAULT_SERVE_PORT = 4173;
const DEFAULT_SERVE_TIMEOUT_MS = 30000;

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

/** Synchronous-ish HTTP probe (returns a Promise; `GET /` with a short timeout). */
export function probeUrl(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    const req = http.request({ host, port, path: "/", method: "GET", timeout: timeoutMs }, (res) => {
      res.resume();
      finish(true);
    });
    req.on("error", () => finish(false));
    req.on("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.end();
  });
}

/** Pure decision: given the current live state, which start actions are needed? Idempotency is
 *  this function's whole point — nothing already-running is re-started. */
export function planActions(opts: { promotionAlive: boolean; workerAlive: boolean; outerAlive: boolean; goalAlive: boolean; serveListening: boolean }) {
  return {
    startPromotion: !opts.promotionAlive,
    startWorker: !opts.workerAlive,
    startOuter: !opts.outerAlive,
    startGoal: !opts.goalAlive,
    startServe: !opts.serveListening,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ServeStartResult {
  state: "started" | "already-listening" | "exited" | "timeout" | "spawn-failed";
  pid?: number;
  exitCode?: number | null;
  /** Set only for `spawn-failed`: the errno of the never-started process (e.g. "ENOENT"). */
  error?: string;
}

/** Start `quay serve` detached (setsid-equivalent: spawn(detached)+unref, stdio → log file), write
 *  `.quay/serve.pid`, then poll the probe until it answers or the timeout elapses.
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
  try {
    logFd = fs.openSync(logPath, "a");
  } catch {
    logFd = fs.openSync("/dev/null", "w");
  }
  const child = spawn(
    inv.argv0,
    [...inv.args, "serve", "--host", host, "--port", String(port)],
    { detached: true, stdio: ["ignore", logFd, logFd], cwd: root, env: process.env },
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
      return { state: "exited", pid: child.pid, exitCode: child.exitCode };
    }
    if (await probeUrl(host, port)) {
      return { state: "started", pid: child.pid };
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
  --port <p>             Web server port (default: ${DEFAULT_SERVE_PORT}).
  --cli <path>           Explicit quay CLI path (default: auto-resolve source-tree → plugin vendor bundle → PATH).
  --serve-timeout <ms>   How long to wait for the serve process to answer the probe (default: ${DEFAULT_SERVE_TIMEOUT_MS}).
  --json                 Machine-readable summary on stdout.
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
  if (!Number.isFinite(opts.port) || opts.port < 1 || opts.port > 65535) {
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

  // 2. Web server — probe then background-start (serve has no supervisor; THIS script backgrounds it).
  const listening = await probeUrl(opts.host, opts.port);
  if (listening) {
    report.serve = { state: "already-listening", host: opts.host, port: opts.port };
    if (!opts.json) process.stdout.write(`serve: already listening on http://${opts.host}:${opts.port}\n`);
  } else {
    const res = await startServe(inv, root, opts.host, opts.port, opts.serveTimeoutMs);
    report.serve = { ...res, host: opts.host, port: opts.port };
    if (res.state !== "started") {
      // The failure verdict is computed OUTSIDE the `--json` guard: a serve that never came up is a
      // failed start on both surfaces (before this, `--json` reached the `return 0` below and
      // reported success for a server that was not running).
      if (res.state === "spawn-failed") {
        const diag = formatCliFailure(inv, { status: null, error: Object.assign(new Error(`spawn ${inv.argv0}: ${res.error}`), { code: res.error }) });
        process.stderr.write(`serve: the quay CLI could not be executed (${res.error}); argv0=${inv.argv0}; argv=${formatInvocation(inv)}\n`);
        if (diag) process.stderr.write(diag);
      } else if (res.state === "exited") {
        process.stderr.write(`serve: process exited before answering the probe (exit=${res.exitCode}); see .quay/serve.log\n`);
      } else {
        process.stderr.write(`serve: did not answer the probe within ${opts.serveTimeoutMs}ms; see .quay/serve.log\n`);
      }
      if (opts.json) process.stdout.write(JSON.stringify(report));
      return 1;
    }
    if (!opts.json) {
      process.stdout.write(`serve: started (pid=${res.pid ?? "?"}) on http://${opts.host}:${opts.port}\n`);
    }
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
