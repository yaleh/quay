// start-drivers.ts — `quay driver start --kind promotion` + `quay driver start --kind worker` +
// `quay serve` wrapped into ONE idempotent in-session call.
// (tasks/gap-skill-start-drivers-webserver — SPEC-tmux-retirement-2026-09-03 §1.4 Layer 3b 第④步)
//
// The drivers skill (`plugin/skills/drivers/SKILL.md`) delegates to this executable rather than
// repeating the idempotent-start loop inline — the same delegate pattern as the init skill →
// `quay-init.sh` (a second copy of the start logic is exactly the drift this repo keeps removing).
//
// What it does (idempotent — safe to run twice):
//   - For each driver kind (promotion, worker): `quay driver status --kind <kind> --json` says
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
//
// Run:
//   node --experimental-strip-types plugin/scripts/start-drivers.ts [--root <path>] [--host <ip>]
//     [--port <p>] [--cli <path>] [--serve-timeout <ms>] [--json]

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const DRIVER_KINDS = ["promotion", "worker"] as const;
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

/** Resolve how to invoke the `quay` CLI. Precedence: explicit `--cli` > source-tree
 *  `<root>/packages/quay/bin/quay.ts` (dev checkout) > `quay` on PATH (user-scope install). */
export function resolveCliInvocation(root: string, explicitCli?: string): { argv0: string; args: string[] } {
  if (typeof explicitCli === "string" && explicitCli.trim() !== "") {
    const p = path.resolve(explicitCli);
    if (p.endsWith(".ts")) return { argv0: process.execPath, args: ["--experimental-strip-types", p] };
    return { argv0: process.execPath, args: [p] };
  }
  const srcTs = path.join(root, "packages", "quay", "bin", "quay.ts");
  if (fs.existsSync(srcTs)) {
    return { argv0: process.execPath, args: ["--experimental-strip-types", srcTs] };
  }
  return { argv0: "quay", args: [] };
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
export function planActions(opts: { promotionAlive: boolean; workerAlive: boolean; serveListening: boolean }) {
  return {
    startPromotion: !opts.promotionAlive,
    startWorker: !opts.workerAlive,
    startServe: !opts.serveListening,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ServeStartResult {
  state: "started" | "already-listening" | "exited" | "timeout";
  pid?: number;
  exitCode?: number | null;
}

/** Start `quay serve` detached (setsid-equivalent: spawn(detached)+unref, stdio → log file), write
 *  `.quay/serve.pid`, then poll the probe until it answers or the timeout elapses. */
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
  child.unref();
  if (child.pid) {
    try { fs.writeFileSync(path.join(root, ".quay", "serve.pid"), String(child.pid)); } catch { /* best-effort */ }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
      process.stdout.write(`start-drivers — start promotion + worker drivers and the web server (idempotent)

Usage:
  node --experimental-strip-types plugin/scripts/start-drivers.ts [flags]

Flags:
  --root <path>          Workspace root (default: discovered via .quay/config.yml from cwd).
  --host <ip>            Web server bind host (default: ${DEFAULT_SERVE_HOST}).
  --port <p>             Web server port (default: ${DEFAULT_SERVE_PORT}).
  --cli <path>           Explicit quay CLI path (default: auto-resolve source-tree → PATH).
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

  const report: Record<string, unknown> = { root, drivers: {} as Record<string, unknown>, serve: {} as Record<string, unknown> };
  const drv = report.drivers as Record<string, unknown>;

  // 1. Drivers — status pre-check (fast path) + start (the kernel is itself idempotent).
  for (const kind of DRIVER_KINDS) {
    const status = runCli(inv, ["driver", "status", "--kind", kind, "--root", root, "--json"], { cwd: root });
    if (status.status !== 0) {
      // Relay the status error (worktree-root rejection / missing config) — never treat as "not alive".
      if (status.stderr) process.stderr.write(status.stderr);
      if (status.stdout) process.stderr.write(status.stdout);
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
    if (start.status !== 0) {
      drv[kind] = { state: "error", exit: start.status };
      // ⛔ DO NOT swallow: the CLI's own reason (halted / worktree / config) is the actionable message.
      return 1;
    }
    drv[kind] = { state: "started" };
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
    if (!opts.json) {
      if (res.state === "started") {
        process.stdout.write(`serve: started (pid=${res.pid ?? "?"}) on http://${opts.host}:${opts.port}\n`);
      } else if (res.state === "exited") {
        process.stderr.write(`serve: process exited before answering the probe (exit=${res.exitCode}); see .quay/serve.log\n`);
        return 1;
      } else {
        process.stderr.write(`serve: did not answer the probe within ${opts.serveTimeoutMs}ms; see .quay/serve.log\n`);
        return 1;
      }
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
