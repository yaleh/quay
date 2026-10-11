import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/start-drivers.ts
import fs2 from "node:fs";
import path4 from "node:path";
import os2 from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

// packages/quay/src/serve-log.ts
import fs from "node:fs";
import path from "node:path";
var SERVE_LOG_BASENAME = "serve.log";
var SERVE_LOG_UNAVAILABLE = "serve-log-unavailable";
function serveLogPath(workspaceRoot) {
  return path.join(workspaceRoot, ".quay", SERVE_LOG_BASENAME);
}
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}
function openServeLog(workspaceRoot) {
  const target = serveLogPath(workspaceRoot);
  let fd = null;
  let unavailable = false;
  let reason = null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fd = fs.openSync(target, "a");
  } catch (err) {
    unavailable = true;
    reason = messageOf(err);
  }
  let startOffset = 0;
  try {
    startOffset = fs.statSync(target).size;
  } catch {
    startOffset = 0;
  }
  if (fd === null) {
    try {
      fd = fs.openSync("/dev/null", "w");
    } catch (err2) {
      reason = `${reason ?? "the serve log could not be opened"}; /dev/null also unwritable (${messageOf(err2)})`;
    }
  }
  const opened = fd;
  return {
    path: target,
    stdio: opened === null ? "ignore" : ["ignore", opened, opened],
    startOffset,
    unavailable,
    reason,
    close() {
      if (opened === null) return;
      try {
        fs.closeSync(opened);
      } catch {
      }
    }
  };
}

// packages/quay/src/systemd-scope.ts
import os from "node:os";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
var SYSTEMD_RUN_AVAILABLE_ENV = "QUAY_TEST_SYSTEMD_RUN_AVAILABLE";
var SCOPE_ENVELOPE_HOST_FRACTION = 0.25;
var SCOPE_ENVELOPE_PAGE_BYTES = 4096;
var SERVE_UNIT_PREFIX = "quay-serve-";
var SERVE_LIMITS_ENV = "QUAY_SERVE_SYSTEMD_RUN_LIMITS";
var SERVE_SCOPE_UNAVAILABLE = "serve-scope-unavailable";
var SCOPE_PROPERTY_ARGS = ["-p", "MemoryAccounting=yes", "-p", "OOMPolicy=continue"];
function scopeProbeArgv() {
  return ["systemd-run", "--user", "--scope", "--quiet", ...SCOPE_PROPERTY_ARGS, "true"];
}
function runScopeProbe(argv) {
  try {
    execFileSync(argv[0], argv.slice(1), { stdio: "ignore", timeout: 1e4 });
    return true;
  } catch {
    return false;
  }
}
var _systemdScopeAvailable = null;
function systemdScopeAvailable() {
  const forced = process.env[SYSTEMD_RUN_AVAILABLE_ENV];
  if (forced === "0") return false;
  if (forced === "1") return true;
  if (_systemdScopeAvailable !== null) return _systemdScopeAvailable;
  _systemdScopeAvailable = runScopeProbe(scopeProbeArgv());
  return _systemdScopeAvailable;
}
function scopeUnitName(prefix, root, nowMs) {
  const base = path2.basename(path2.resolve(root)).replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  const slug = base === "" ? "root" : base;
  return `${prefix}${slug.slice(0, 180)}-${nowMs}.scope`;
}
function defaultScopeMemoryMax(totalmemBytes, fraction = SCOPE_ENVELOPE_HOST_FRACTION) {
  const bytes = Math.floor(Math.max(0, totalmemBytes) * fraction);
  const aligned = Math.max(SCOPE_ENVELOPE_PAGE_BYTES, Math.floor(bytes / SCOPE_ENVELOPE_PAGE_BYTES) * SCOPE_ENVELOPE_PAGE_BYTES);
  return String(aligned);
}
function parseMemoryMaxOverride(raw) {
  if (raw === void 0) return { kind: "absent", value: null };
  if (raw.trim() === "") return { kind: "unlimited", value: null };
  for (const part of raw.trim().split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) !== "MemoryMax") continue;
    const value = part.slice(eq + 1);
    return value === "" ? { kind: "unlimited", value: null } : { kind: "value", value };
  }
  return { kind: "absent", value: null };
}
function resolveScopeEnvelope(opts) {
  const available = opts.systemdRun ?? systemdScopeAvailable();
  if (!available) {
    return {
      envelope: "none",
      memoryMax: null,
      source: null,
      unit: null,
      reason: "systemd-run --user --scope unavailable on this host (no user manager / no D-Bus / probe failed) \u2014 falling back to an unenveloped spawn"
    };
  }
  const raw = opts.limitsRaw !== void 0 ? opts.limitsRaw : process.env[opts.limitsEnv];
  const override = parseMemoryMaxOverride(raw);
  let memoryMax;
  let source;
  if (override.kind === "value") {
    memoryMax = override.value;
    source = "env-override";
  } else if (override.kind === "unlimited") {
    memoryMax = null;
    source = "env-unlimited";
  } else {
    memoryMax = defaultScopeMemoryMax(opts.totalmemBytes ?? os.totalmem(), opts.totalmemFraction);
    source = "host-derived";
  }
  return {
    envelope: "scope",
    memoryMax,
    source,
    unit: scopeUnitName(opts.prefix, opts.root, opts.nowMs ?? Date.now()),
    reason: null
  };
}
function scopeLaunchArgv(innerArgv, res) {
  if (res.envelope === "none" || !res.unit) return innerArgv;
  const argv = ["systemd-run", "--user", "--scope", "--collect", `--unit=${res.unit}`, ...SCOPE_PROPERTY_ARGS];
  if (res.memoryMax) argv.push("-p", `MemoryMax=${res.memoryMax}`);
  return [...argv, ...innerArgv];
}
function resolveServeEnvelope(opts) {
  return resolveScopeEnvelope({
    prefix: SERVE_UNIT_PREFIX,
    root: opts.root,
    limitsEnv: SERVE_LIMITS_ENV,
    systemdRun: opts.systemdRun,
    totalmemBytes: opts.totalmemBytes,
    limitsRaw: opts.limitsRaw,
    nowMs: opts.nowMs
  });
}
function serveScopeUnavailableReport(res) {
  if (res.envelope !== "none") return null;
  return `${SERVE_SCOPE_UNAVAILABLE}: the serve host will spawn WITHOUT its own cgroup scope \u2014 ${res.reason ?? "reason not recorded"}; a restart of the launching session/service can kill it
`;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path3 from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path3.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }
  const usageError = (message) => {
    if (spec.errors === "return") {
      result.error = message;
      return result;
    }
    console.error(message);
    process.exit(2);
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && unknownMode === "reject") return usageError(`unknown argument: --${name}`);
      if (!def && unknownMode === "skip") continue;
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (def?.type === "string[]") {
        if (!result.lists) result.lists = {};
        const list = result.lists[name] ??= [];
        if (eqIdx >= 0) list.push(a.slice(eqIdx + 1));
        else if (def.greedy) {
          while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) list.push(raw[++i]);
        } else if (i + 1 < raw.length) list.push(raw[++i]);
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }
  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    return usageError(`Usage: ${scriptName} ${spec.usage}`);
  }
  return result;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/start-drivers.ts
function serveHeapCapMb() {
  return Math.min(4096, Math.max(512, Math.round(os2.totalmem() / (1024 * 1024) / 5)));
}
function withServeHeapCap(existing) {
  return [existing, `--max-old-space-size=${serveHeapCapMb()}`].filter(Boolean).join(" ");
}
var DRIVER_KINDS = ["promotion", "worker", "outer", "goal"];
var DEFAULT_SERVE_TIMEOUT_MS = 3e4;
var HEALTH_PROBE_TIMEOUT_MS = 2e3;
var SERVE_STOP_TIMEOUT_MS = 1e4;
var SERVE_ADMISSION_REFUSED_MARKER = "quay-serve-admission-refused";
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}
function parseDriverStatus(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return { alive: false, parsed: false };
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj === "object" && obj !== null && "alive" in obj) {
      return { alive: obj.alive === 1 || obj.alive === true, parsed: true };
    }
    return { alive: false, parsed: false };
  } catch {
    return { alive: false, parsed: false };
  }
}
function resolveWorkspaceRoot(startDir) {
  let dir = path4.resolve(startDir);
  for (; ; ) {
    if (fs2.existsSync(path4.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path4.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function resolvePluginRoot(env = process.env, scriptUrl = import.meta.url) {
  const fromEnv = env.CLAUDE_PLUGIN_ROOT;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return path4.resolve(fromEnv.trim());
  const scriptPath = scriptUrl.startsWith("file:") ? fileURLToPath(scriptUrl) : scriptUrl;
  const dir = path4.dirname(path4.resolve(scriptPath));
  if (path4.basename(dir) !== "scripts") return null;
  return path4.dirname(dir);
}
function resolveCliInvocation(root, explicitCli, opts = {}) {
  if (typeof explicitCli === "string" && explicitCli.trim() !== "") {
    const p = path4.resolve(explicitCli);
    if (p.endsWith(".ts")) return { argv0: process.execPath, args: ["--experimental-strip-types", p] };
    return { argv0: process.execPath, args: [p] };
  }
  const srcTs = path4.join(root, "packages", "quay", "bin", "quay.ts");
  if (fs2.existsSync(srcTs)) {
    return { argv0: process.execPath, args: ["--experimental-strip-types", srcTs] };
  }
  const pluginRoot = opts.pluginRoot === void 0 ? resolvePluginRoot(opts.env) : opts.pluginRoot;
  if (pluginRoot) {
    const vendorJs = path4.join(pluginRoot, "vendor", "quay", "dist", "quay.js");
    if (fs2.existsSync(vendorJs)) {
      return { argv0: process.execPath, args: [vendorJs] };
    }
  }
  return { argv0: "quay", args: [] };
}
function formatInvocation(inv) {
  return [inv.argv0, ...inv.args].join(" ");
}
function classifyCliFailure(res) {
  if (res.error) {
    const code = res.error.code ?? "SPAWN-ERROR";
    return { kind: "spawn", code, message: res.error.message ?? String(res.error) };
  }
  if (res.status === null || res.status === void 0) {
    if (res.signal) return { kind: "signal", code: String(res.signal), message: `killed by signal ${res.signal}` };
    return { kind: "spawn", code: "NO-STATUS", message: "the process produced no exit status and no error" };
  }
  if (res.status !== 0) return { kind: "exit", code: String(res.status), message: `exit status ${res.status}` };
  return null;
}
function formatCliFailure(inv, res) {
  const fail = classifyCliFailure(res);
  if (!fail) return null;
  const lines = [`start-drivers: the quay CLI did not run successfully (${fail.kind}).`];
  lines.push(`  argv0: ${inv.argv0}`);
  lines.push(`  argv:  ${formatInvocation(inv)}`);
  if (fail.kind === "spawn") {
    lines.push(`  error: ${fail.code}${fail.message ? ` \u2014 ${fail.message}` : ""}`);
    lines.push(
      `  hint:  pass --cli <path-to-quay.js|quay.ts>, put \`quay\` on PATH, or install the plugin bundle at <plugin-root>/vendor/quay/dist/quay.js`
    );
  } else if (fail.kind === "signal") {
    lines.push(`  signal: ${fail.code}`);
  } else {
    lines.push(`  exit status: ${fail.code}`);
  }
  return lines.join("\n") + "\n";
}
function runCli(inv, cmdArgs, opts = {}) {
  return spawnSync(inv.argv0, [...inv.args, ...cmdArgs], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: process.env,
    timeout: opts.timeoutMs ?? 6e4
  });
}
function planServeAction(opts) {
  if (opts.admission === "started") return "started";
  return opts.staleness === true ? "reload" : "already-listening";
}
function probeServeStaleness(host, port, timeoutMs = HEALTH_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const notEvaluated = (reason) => ({ evaluated: false, stale: null, reason });
    const req = http.request({ host, port, path: "/health", method: "GET", timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        if (res.statusCode !== 200) return finish(notEvaluated(`http-${res.statusCode ?? "?"}`));
        let obj;
        try {
          obj = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return finish(notEvaluated("unparseable-body"));
        }
        if (typeof obj !== "object" || obj === null) return finish(notEvaluated("body-not-an-object"));
        const stale = obj.stale;
        if (typeof stale === "boolean") return finish({ evaluated: true, stale, reason: null });
        if (stale === null) return finish(notEvaluated("health-says-not-evaluated"));
        return finish(notEvaluated(stale === void 0 ? "no-stale-field" : "stale-not-boolean"));
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
function readServeHostPid(root) {
  const p = path4.join(root, ".quay", "server.json");
  let raw;
  try {
    raw = fs2.readFileSync(p, "utf8");
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") return { state: "absent" };
    return { state: "unreadable", reason: `read-failed:${code ?? "?"}` };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { state: "unreadable", reason: "unparseable" };
  }
  const pid = obj?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return { state: "unreadable", reason: "no-usable-pid" };
  const startedAt = typeof obj.startedAt === "string" ? obj.startedAt : null;
  const services = obj.services;
  const webEntry = Array.isArray(services) ? services.find((s) => s && s.name === "web") : void 0;
  const port = webEntry && typeof webEntry.port === "number" && Number.isInteger(webEntry.port) && webEntry.port > 0 ? webEntry.port : null;
  const host = webEntry && typeof webEntry.host === "string" && webEntry.host.trim() !== "" ? webEntry.host : null;
  return { state: "present", pid, startedAt, host, port };
}
async function stopServeHost(pid, timeoutMs = SERVE_STOP_TIMEOUT_MS) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    const code = err.code;
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function readAdmissionRefusal(logPath, startOffset, childPid) {
  if (typeof childPid !== "number") return null;
  let chunk;
  try {
    const size = fs2.statSync(logPath).size;
    if (size <= startOffset) return null;
    const fd = fs2.openSync(logPath, "r");
    try {
      const buf = Buffer.alloc(size - startOffset);
      fs2.readSync(fd, buf, 0, buf.length, startOffset);
      chunk = buf.toString("utf8");
    } finally {
      fs2.closeSync(fd);
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
async function startServe(inv, root, host, port, timeoutMs) {
  fs2.mkdirSync(path4.join(root, ".quay"), { recursive: true });
  const log = openServeLog(root);
  const logPath = log.path;
  const startOffset = log.startOffset;
  if (log.unavailable) {
    process.stderr.write(
      `${SERVE_LOG_UNAVAILABLE}: cannot open ${logPath} (${log.reason}) \u2014 the host's stdout/stderr will be discarded and an admission refusal will read as \`exited\`
`
    );
  }
  const spawnedAtMs = Date.now();
  const serveArgs = [...inv.args, "serve"];
  if (host !== void 0) serveArgs.push("--host", host);
  if (port !== void 0) serveArgs.push("--port", String(port));
  const scope = resolveServeEnvelope({ root });
  if (scope.envelope === "none") {
    const report = serveScopeUnavailableReport(scope);
    if (report) process.stderr.write(report);
  }
  const launchArgv = scopeLaunchArgv([inv.argv0, ...serveArgs], scope);
  const child = spawn(
    launchArgv[0],
    launchArgv.slice(1),
    {
      detached: true,
      stdio: log.stdio,
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: withServeHeapCap(process.env.NODE_OPTIONS) }
    }
  );
  log.close();
  let spawnError = null;
  child.on("error", (err) => {
    spawnError = err;
  });
  child.unref();
  if (child.pid) {
    try {
      fs2.writeFileSync(path4.join(root, ".quay", "serve.pid"), String(child.pid));
    } catch {
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) {
      return { state: "spawn-failed", pid: child.pid, error: spawnError.code ?? "SPAWN-ERROR" };
    }
    if (child.exitCode !== null) {
      const refusal = readAdmissionRefusal(logPath, startOffset, child.pid);
      if (refusal) return { state: "already-running", pid: child.pid, exitCode: child.exitCode, holderPid: refusal.holderPid };
      return { state: "exited", pid: child.pid, exitCode: child.exitCode };
    }
    const carrier = readServeHostPid(root);
    if (carrier.state === "present" && carrier.pid === child.pid) {
      const startedMs = carrier.startedAt ? Date.parse(carrier.startedAt) : NaN;
      if (!Number.isFinite(startedMs) || startedMs >= spawnedAtMs - 2e3) {
        return { state: "started", pid: child.pid, port: carrier.port, host: carrier.host };
      }
    }
    await sleep(250);
  }
  return { state: "timeout", pid: child.pid };
}
var USAGE = `start-drivers \u2014 start promotion + worker + outer + goal drivers and the web server (idempotent)

Usage:
  node --experimental-strip-types plugin/scripts/start-drivers.ts [flags]

Flags:
  --root <path>          Workspace root (default: discovered via .quay/config.yml from cwd).
  --host <ip>            Web server bind host. Forwarded to \`quay serve\` ONLY when given; when
                         omitted the host is resolved by the ONE definition point
                         (packages/quay/src/serve-binding.ts): .quay/config.yml \`serve.host\`, else
                         the single declared fallback.
  --port <p>             Web server port. Forwarded to \`quay serve\` ONLY when given; when omitted
                         the port is resolved by the same definition point and defaults to 0 =
                         kernel-assigned ephemeral (read back from .quay/server.json). Pass it only
                         to pin an exact port; a real collision then fails loudly.
  --cli <path>           Explicit quay CLI path (default: auto-resolve source-tree \u2192 plugin vendor bundle \u2192 PATH).
  --serve-timeout <ms>   How long to wait for the spawned serve host to report its verdict (default: ${DEFAULT_SERVE_TIMEOUT_MS}).
  --json                 Machine-readable summary on stdout.

Web server semantics (gap-serve-same-root-admission-lock): this script performs NO pre-flight
liveness probe \u2014 it spawns \`quay serve\` and reads the verdict from that child. The child owns a
same-root admission lock, so it either binds (\`started\`) or refuses because a live host already owns
this root (\`already-running\` \u2014 reported, \u26D4 not folded into a failure). When a live host is reported,
\`GET /health\` on the port its carrier names decides: FRESH \u21D2 kept; STALE \u21D2 RELOADED (SIGTERM that
host, wait for its pid to die, spawn a fresh one); unreadable \u21D2 LEFT ALONE and reported as
\`staleness: "not-evaluated"\` \u2014 \u26D4 a reading we could not take is never laundered into either
"fresh" or "stale".
`;
function parseArgs2(argv) {
  const { flags, help, error } = parseArgs(argv, {
    minArgs: 0,
    usage: "[--root <path>] [--host <ip>] [--port <p>] [--cli <path>] [--serve-timeout <ms>] [--json]",
    help: "return",
    unknown: "reject",
    errors: "return",
    flags: {
      root: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      cli: { type: "string" },
      "serve-timeout": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const str = (v) => typeof v === "string" && v !== "" ? v : void 0;
  const num = (v, fallback) => {
    const s = str(v);
    return s === void 0 ? fallback : Number(s);
  };
  return {
    opts: {
      root: str(flags.root),
      host: str(flags.host),
      port: str(flags.port) === void 0 ? void 0 : Number(str(flags.port)),
      cli: str(flags.cli),
      serveTimeoutMs: num(flags["serve-timeout"], DEFAULT_SERVE_TIMEOUT_MS),
      json: flags.json === true
    },
    help: help === true,
    error
  };
}
async function main(argv) {
  const parsed = parseArgs2(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 2;
  }
  if (parsed.error !== void 0) {
    process.stderr.write(`start-drivers: ${parsed.error}
`);
    return 2;
  }
  const opts = parsed.opts;
  if (opts.port !== void 0 && (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535)) {
    process.stderr.write(`start-drivers: invalid --port: ${opts.port}
`);
    return 2;
  }
  if (!Number.isFinite(opts.serveTimeoutMs) || opts.serveTimeoutMs < 0) {
    process.stderr.write(`start-drivers: invalid --serve-timeout: ${opts.serveTimeoutMs}
`);
    return 2;
  }
  const root = resolveWorkspaceRoot(opts.root ?? process.cwd());
  if (!root) {
    process.stderr.write(
      `start-drivers: no .quay/config.yml found (searched from ${opts.root ?? process.cwd()} upward). Run from a quay workspace root, or pass --root <workspace-root>.
`
    );
    return 1;
  }
  const inv = resolveCliInvocation(root, opts.cli);
  process.stderr.write(`start-drivers: quay CLI = ${formatInvocation(inv)}
`);
  const report = { root, cli: formatInvocation(inv), drivers: {}, serve: {} };
  const drv = report.drivers;
  for (const kind of DRIVER_KINDS) {
    const status = runCli(inv, ["driver", "status", "--kind", kind, "--root", root, "--json"], { cwd: root });
    if (classifyCliFailure(status) !== null) {
      if (status.stderr) process.stderr.write(status.stderr);
      if (status.stdout) process.stderr.write(status.stdout);
      const diag = formatCliFailure(inv, status);
      if (diag) process.stderr.write(diag);
      return 1;
    }
    const parsed2 = parseDriverStatus(status.stdout);
    if (!parsed2.parsed) {
      process.stderr.write(
        `start-drivers: could not parse \`quay driver status --kind ${kind}\` output (read-unable is not "not alive")
`
      );
      return 1;
    }
    if (parsed2.alive) {
      drv[kind] = { state: "already-running" };
      if (!opts.json) process.stdout.write(`${kind}: already running (alive)
`);
      continue;
    }
    const start = runCli(inv, ["driver", "start", "--kind", kind, "--root", root], { cwd: root });
    if (start.stdout) process.stdout.write(start.stdout);
    if (start.stderr) process.stderr.write(start.stderr);
    if (classifyCliFailure(start) !== null) {
      drv[kind] = { state: "error", exit: start.status ?? null };
      const diag = formatCliFailure(inv, start);
      if (diag) process.stderr.write(diag);
      return 1;
    }
    const postStatus = runCli(inv, ["driver", "status", "--kind", kind, "--root", root, "--json"], { cwd: root });
    if (postStatus.stderr) process.stderr.write(postStatus.stderr);
    const postDiag = formatCliFailure(inv, postStatus);
    if (postDiag) {
      process.stderr.write(postDiag);
      drv[kind] = { state: "unverified", reason: "status-command-failed" };
      return 1;
    }
    const postParsed = parseDriverStatus(postStatus.stdout);
    if (!postParsed.parsed) {
      process.stderr.write(
        `start-drivers: after start, could not parse \`quay driver status --kind ${kind}\` output (read-unable is not "alive")
`
      );
      drv[kind] = { state: "unverified", reason: "status-unreadable" };
      return 1;
    }
    if (!postParsed.alive) {
      process.stderr.write(
        `start-drivers: ${kind} exited 0 from \`quay driver start\` but is not alive per \`quay driver status\` \u2014 refusing to report started
`
      );
      drv[kind] = { state: "unverified", reason: "not-alive" };
      return 1;
    }
    drv[kind] = { state: "started", alive: true };
    if (!opts.json) process.stdout.write(`${kind}: started
`);
  }
  const admission = await startServe(inv, root, opts.host, opts.port, opts.serveTimeoutMs);
  if (admission.state === "started") {
    const boundPort = admission.port ?? null;
    const boundHost = admission.host ?? opts.host ?? null;
    report.serve = { state: "started", pid: admission.pid, host: boundHost, port: boundPort };
    if (!opts.json) {
      process.stdout.write(
        `serve: started (pid=${admission.pid ?? "?"}) on http://${boundHost ?? "?"}:${boundPort ?? "?"}${boundPort == null ? " (port not read back from the carrier)" : ""}
`
      );
    }
  } else if (admission.state === "already-running") {
    const carrier = readServeHostPid(root);
    const livePort = carrier.state === "present" ? carrier.port : null;
    const carrierHost = carrier.state === "present" ? carrier.host : null;
    const liveHost = opts.host ?? carrierHost ?? null;
    let staleness;
    if (carrier.state !== "present") {
      staleness = { evaluated: false, stale: null, reason: `carrier-${carrier.state}${carrier.state === "unreadable" ? `:${carrier.reason}` : ""}` };
    } else if (livePort == null) {
      staleness = { evaluated: false, stale: null, reason: "carrier-no-web-port" };
    } else if (liveHost == null) {
      staleness = { evaluated: false, stale: null, reason: "carrier-no-web-host" };
    } else {
      staleness = await probeServeStaleness(liveHost, livePort);
    }
    const action = planServeAction({ admission: "already-running", staleness: staleness.evaluated ? staleness.stale : null });
    if (action === "already-listening") {
      const kind = staleness.evaluated ? "fresh" : "not-evaluated";
      report.serve = {
        state: "already-listening",
        host: liveHost,
        port: livePort,
        pid: carrier.state === "present" ? carrier.pid : admission.holderPid ?? null,
        staleness: kind,
        stalenessReason: staleness.reason
      };
      if (staleness.evaluated) {
        if (!opts.json) process.stdout.write(`serve: already running (pid=${carrier.state === "present" ? carrier.pid : "?"}) on http://${liveHost ?? "?"}:${livePort} (code fresh)
`);
      } else {
        process.stderr.write(
          `serve: already running (pid=${carrier.state === "present" ? carrier.pid : "?"}) \u2014 \u26D4 staleness NOT-EVALUATED (reason: ${staleness.reason}); NOT restarting (a reading we could not take is not a verdict).
`
        );
        if (!opts.json) process.stdout.write(`serve: already running on http://${liveHost ?? "?"}:${livePort ?? "?"} (staleness NOT-EVALUATED: ${staleness.reason})
`);
      }
    } else {
      if (carrier.state !== "present") {
        const why = carrier.state === "unreadable" ? ` \u2014 ${carrier.reason}` : "";
        process.stderr.write(
          `serve: a live host owns this root but its carrier does not name a usable host (carrier=${carrier.state}${why}) \u2014 refusing to act on a host that cannot be identified; stop it by hand and re-run.
  carrier file: .quay/server.json
`
        );
        report.serve = { state: "reload-host-unknown", host: liveHost, port: null, staleness: "stale", carrier: carrier.state };
        if (opts.json) process.stdout.write(JSON.stringify(report));
        return 1;
      }
      const stopped = await stopServeHost(carrier.pid);
      if (stopped.state !== "stopped") {
        process.stderr.write(
          `serve: stale serve host pid=${carrier.pid} could not be stopped (${stopped.state}${stopped.error ? `: ${stopped.error}` : ""}) \u2014 it is still alive; \u26D4 not spawning a second host on top of it.
`
        );
        report.serve = { state: "reload-stop-failed", host: liveHost, port: livePort, staleness: "stale", previousPid: carrier.pid, detail: stopped.state };
        if (opts.json) process.stdout.write(JSON.stringify(report));
        return 1;
      }
      process.stderr.write(`serve: STALE (code on disk newer than pid=${carrier.pid}) \u2014 reloading
`);
      const res = await startServe(inv, root, opts.host, opts.port, opts.serveTimeoutMs);
      const boundPort = res.state === "started" ? res.port ?? null : livePort;
      const boundHost = res.state === "started" ? res.host ?? liveHost : liveHost;
      report.serve = { ...res, state: res.state === "started" ? "reloaded-stale" : res.state, host: boundHost, port: boundPort, staleness: "stale", previousPid: carrier.pid };
      if (res.state !== "started") {
        process.stderr.write(
          `serve: reload failed after stopping pid=${carrier.pid} (${res.state}${res.state === "already-running" ? " \u2014 another host took this root in the window" : ""}); see .quay/serve.log
`
        );
        if (opts.json) process.stdout.write(JSON.stringify(report));
        return 1;
      }
      if (!opts.json) {
        process.stdout.write(`serve: reloaded (was stale pid=${carrier.pid} \u2192 pid=${res.pid ?? "?"}) on http://${boundHost ?? "?"}:${res.port ?? "?"}
`);
      }
    }
  } else {
    report.serve = { ...admission, host: opts.host ?? null, port: null };
    if (admission.state === "spawn-failed") {
      const diag = formatCliFailure(inv, { status: null, error: Object.assign(new Error(`spawn ${inv.argv0}: ${admission.error}`), { code: admission.error }) });
      process.stderr.write(`serve: the quay CLI could not be executed (${admission.error}); argv0=${inv.argv0}; argv=${formatInvocation(inv)}
`);
      if (diag) process.stderr.write(diag);
    } else if (admission.state === "exited") {
      process.stderr.write(`serve: process exited before becoming a host (exit=${admission.exitCode}); see .quay/serve.log
`);
    } else {
      process.stderr.write(`serve: did not report a verdict within ${opts.serveTimeoutMs}ms; see .quay/serve.log
`);
    }
    if (opts.json) process.stdout.write(JSON.stringify(report));
    return 1;
  }
  if (opts.json) process.stdout.write(JSON.stringify(report));
  return 0;
}
var _entryBase = path4.basename(process.argv[1] ?? "").replace(/\.(js|ts|mjs)$/, "");
if (_entryBase === "start-drivers") {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
export {
  SERVE_ADMISSION_REFUSED_MARKER,
  classifyCliFailure,
  formatCliFailure,
  formatInvocation,
  parseDriverStatus,
  planServeAction,
  probeServeStaleness,
  readAdmissionRefusal,
  readServeHostPid,
  resolveCliInvocation,
  resolvePluginRoot,
  resolveWorkspaceRoot,
  runCli,
  startServe,
  stopServeHost
};
