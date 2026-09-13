// quay serve — starts Web + provider host (proposal §9). v0 walking
// skeleton (G5): a crude but real list/detail HTTP view, no framework, no
// styling beyond what's needed to prove the loop. The Core renders
// presentation; the Provider declares semantics only (design §6.3) — this
// file never branches on provider id.
//
// M100 (ARCH-M93-003): route handler bodies extracted to serve-handlers.ts.
// startServer is now a thin dispatcher (~40 lines). All rendering helpers
// and handler logic live in serve-handlers.ts; this file holds only setup
// and server lifecycle.

import http, { type Server } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadConfig, activeProvider } from "./config.ts";
import { connectProvider, type ProviderClient } from "./provider-client.ts";
import { resolveProviderEnv } from "./provider-env.ts";
import { handleAllRoutes, serveIdentity, type ServePageCfg } from "./serve-handlers.ts";
import { readBranchModel, startDevelopRefBackgroundRefresh } from "./observation.ts";
// GOAL-017 / AC-251 (SPEC-unified-quay-server-2026-09-13 §7 stage A2): the MCP control plane is
// hosted by THIS process. `serveControlPlane` is imported from plugin/scripts/driver-shared.ts
// rather than reimplemented here — the control plane has exactly ONE implementation (AC150-3), and
// stage A2 is a MERGE of two existing implementations into one process, not a second copy. The
// product-side import of a plugin script is the sanctioned pattern
// (packages/quay-native/src/store.ts imports plugin/scripts/shape-sections.ts the same way).
import { serveControlPlane, type ControlPlaneHandle } from "../../../plugin/scripts/driver-shared.ts";
import { writeServerState, removeServerState, CONTROL_PLANE_NAME } from "./server-state.ts";
import { writeJsonAtomic } from "../../../plugin/scripts/write-json-atomic.ts";
// The service inventory is a ZERO-IMPORT leaf module (cli/driver-vocab.ts) because the same names
// appear in `quay --help`'s statically-imported help text — this file's graph must not be pulled in
// just to print them. One list, two consumers.
import { ALL_SERVICE_NAMES, HOSTED_SERVICE_NAMES } from "./cli/driver-vocab.ts";

// ══ 服务清单 + 期望态载体（GOAL-017 / AC-254, SPEC §6.9 阶段 B）══════════════════════════════════
//
// §6.9 的一句话：**服务是可独立起停的单元，进程只是宿主**。这一节实现它的一半 —— 宿主侧：
// 一个进程同时是 `web` / `control` 两个服务的宿主，每个服务可以在**不杀宿主进程**的前提下
// 单独关闭与重新打开（`stop --only web` ⇒ 释放 HTTP listener，host pid 不变，同进程的
// `control` 继续可达）。另一半（四个 CLI 动词）在 `cli/server.ts`，它通过本文件导出的
// **期望态载体** 与在跑的宿主通信。
//
// ⛔ 为什么用「期望态 + 宿主 reconcile」而不是「CLI 直接操作宿主」：
//   - 宿主是唯一能打开/关闭自己 listener 的进程；CLI 是**另一个进程**，它只能表达意图。
//   - 「写了意图」与「意图实现了」必须分开 —— CLI 写完会**轮询实测**（直接量：真探 web 端口），
//     只有观测到效果才 exit 0。⛔ 不是 fire-and-forget（那会让 exit code 与事实无关）。
//   - 这与仓库既有的控制态 idiom 同形（`worker-control.json` 之与 worker-driver），
//     ⛔ 不是第二份 MCP 控制面实现。
//
// ⛔ 为什么 `web`/`control` 的停开**不杀宿主**：若 `stop --only web` 等同杀宿主进程，同进程的
// `control` 一并死掉 —— 那正是 §6.9 不变式 2（«部分操作不波及其余»）排除的形态，且「独立起停」
// 与「整体重启」在记录上不再可区分。

/** 期望态载体的 workspace-relative 路径。运行时状态 —— 从不提交（untracked `.quay/`）。 */
export const SERVICE_STATE_REL = ".quay/server-services.json";
export const SERVICE_STATE_SCHEMA_VERSION = 1;

/** 宿主 reconcile 周期。短到 CLI 的「写完 + 轮询」在一次人眼可接受的等待内收敛，长到不空转。 */
export const RECONCILE_INTERVAL_MS = 150;

export interface ServiceState {
  schemaVersion: number;
  /** 这份期望态是**给哪个宿主**的：pid 不匹配 ⇒ 过期文件，宿主忽略（否则上一个宿主的愿望会
   *  落到新宿主头上 —— 那是「旧意图改新进程」）。 */
  pid: number;
  services: Record<string, boolean>;
  updatedAt: string;
}

export function serviceStatePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, SERVICE_STATE_REL);
}

/** 写期望态（原子 —— 与 server.json 同一份 writeJsonAtomic 单一实现）。 */
export function writeServiceState(
  workspaceRoot: string,
  pid: number,
  services: Record<string, boolean>,
): string {
  const p = serviceStatePath(workspaceRoot);
  const state: ServiceState = {
    schemaVersion: SERVICE_STATE_SCHEMA_VERSION,
    pid,
    services,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(p, state);
  return p;
}

/** 读期望态。三分法（硬规则 3b）：absent ≠ unreadable ≠ present。 */
export function readServiceState(
  workspaceRoot: string,
): { kind: "absent" | "unreadable" | "present"; state?: ServiceState; reason: string } {
  const p = serviceStatePath(workspaceRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { kind: "absent", reason: `no ${SERVICE_STATE_REL} in ${workspaceRoot}` };
    return { kind: "unreadable", reason: `cannot read ${p}: ${String(code ?? (err as Error)?.message ?? err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { kind: "unreadable", reason: `cannot parse ${p}: ${(err as Error).message}` };
  }
  const v = parsed as Record<string, unknown> | null;
  if (
    !v ||
    typeof v !== "object" ||
    v.schemaVersion !== SERVICE_STATE_SCHEMA_VERSION ||
    typeof v.pid !== "number" ||
    !Number.isInteger(v.pid) ||
    !v.services ||
    typeof v.services !== "object" ||
    Array.isArray(v.services)
  ) {
    return { kind: "unreadable", reason: `${p} does not match the schemaVersion ${SERVICE_STATE_SCHEMA_VERSION} desired-state shape` };
  }
  return { kind: "present", state: parsed as ServiceState, reason: "ok" };
}

/** `--only a,b` / `--without a,b` / `add a,b` 的取值解析 —— 单一实现，四个动词共用。
 *  未知服务名 fail-closed（⛔ 不静默忽略：那会让一个拼错的服务名表现为「已经满足了」）。 */
export function parseServiceList(
  raw: string | string[] | undefined,
): { ok: true; names: string[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, names: [] };
  const flat = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => String(s).split(","));
  const names = flat.map((s) => s.trim()).filter((s) => s.length > 0);
  const unknown = names.filter((n) => !ALL_SERVICE_NAMES.includes(n));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown service name(s): ${unknown.join(", ")} — known: ${ALL_SERVICE_NAMES.join(", ")}` };
  }
  return { ok: true, names: [...new Set(names)] };
}

// Re-export rendering helpers so external consumers (tests, etc.) can still
// import them from serve.ts if needed. These now live in serve-handlers.ts.
export {
  html,
  escapeHtml,
  stripHeadings,
  pageStyles,
  renderMarkdown,
  inlineMarkdown,
  relativeTime,
  isSafeRelativeRedirect,
  layoutGitGraph,
} from "./serve-handlers.ts";

export interface StartServerOptions {
  port?: number;
  /** Host to bind to. Defaults to "0.0.0.0" (all interfaces). */
  host?: string;
  /**
   * Where to append the access log (one line per request: ISO timestamp +
   * method + path, so hot pages / access patterns can be inferred later).
   * Defaults to `<workspaceRoot>/.quay/quay-access.log` (gitignored via `*.log`).
   */
  accessLogPath?: string;
}

// ── Stale-code detection (gap-webui-server-stale-code-no-restart-detection) ──
// The `serve` process loads its JS at startup and never reloads it; when a new
// commit lands on the serve-related source paths (`packages/quay/src` +
// `packages/quay/bin`) AFTER the process started, the running server keeps
// serving the OLD code with no awareness. This block gives it awareness: a
// `/health` endpoint compares the process start instant against the latest
// serve-related commit instant and reports `stale: true` when the code on disk
// is newer than the code in memory.
//
// Hard rule 3b shape: `evaluated` is a SEPARATE field from `stale`. When the
// workspace root is not a git repo (or git is unavailable / no commit touches
// the serve paths), `evaluated` is false and `stale` is null — never silently
// "not stale". `stale: null` means "could not determine", `stale: false` means
// "checked, and the running code is current".

export interface StaleStatus {
  /** false = the check did not run (not a git repo / git unavailable / no serve-path commit). */
  evaluated: boolean;
  /** true = code on disk is newer than the running process. null = could not determine. */
  stale: boolean | null;
  /** Wall-clock ms the serve process started (derived from process.uptime()). */
  processStartedAtMs: number;
  /** Wall-clock ms of the latest serve-related commit, or null if none. */
  latestCodeCommitAtMs: number | null;
  /** Which source produced the signal ("git" when evaluated, null otherwise). */
  source: "git" | null;
}

/** The serve-relevant source paths — anything whose change invalidates a running server. */
const SERVE_CODE_PATHS = ["packages/quay/src", "packages/quay/bin"];

/** Pure comparator: null propagates (unknown in → unknown out). */
export function isStale(processStartedAtMs: number, latestCodeCommitAtMs: number | null): boolean | null {
  if (latestCodeCommitAtMs == null) return null;
  return latestCodeCommitAtMs > processStartedAtMs;
}

/** Process start instant, reconstructed from process.uptime() (Node has no direct field). */
export function processStartMs(): number {
  return Date.now() - Math.round(process.uptime() * 1000);
}

/** Latest commit instant (epoch ms) touching the serve code paths, or null if undeterminable. */
export function latestServeCommitMs(workspaceRoot: string): number | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", workspaceRoot, "log", "-1", "--format=%ct", "--", ...SERVE_CODE_PATHS],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    const sec = parseInt(out.trim(), 10);
    if (!Number.isFinite(sec)) return null; // no commit touches the serve paths
    return sec * 1000;
  } catch {
    return null; // not a git repo / git unavailable
  }
}

export function computeStaleStatus(workspaceRoot: string, startedAtMs: number = processStartMs()): StaleStatus {
  const latestCodeCommitAtMs = latestServeCommitMs(workspaceRoot);
  const evaluated = latestCodeCommitAtMs !== null;
  return {
    evaluated,
    stale: isStale(startedAtMs, latestCodeCommitAtMs),
    processStartedAtMs: startedAtMs,
    latestCodeCommitAtMs,
    source: evaluated ? "git" : null,
  };
}

/** GET /health — machine-readable liveness + code-freshness signal. */
async function handleHealth(res: http.ServerResponse, workspaceRoot: string): Promise<void> {
  const status = computeStaleStatus(workspaceRoot);
  if (status.stale === true) {
    console.warn(
      `[quay serve] STALE CODE: 进程 ${new Date(status.processStartedAtMs).toISOString()} 启动，` +
      `最新 serve 相关提交 ${status.latestCodeCommitAtMs != null ? new Date(status.latestCodeCommitAtMs).toISOString() : "?"} 晚于启动 — ` +
      `运行中的代码已过期，请重启 server。`,
    );
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({
    ok: true,
    stale: status.stale,
    evaluated: status.evaluated,
    processStartedAt: new Date(status.processStartedAtMs).toISOString(),
    latestCodeCommitAt: status.latestCodeCommitAtMs != null ? new Date(status.latestCodeCommitAtMs).toISOString() : null,
    source: status.source,
  }));
}

// ── Access logging (gap-web-server-access-logging) ──────────────────────────
// Prior to this, `quay serve` logged only startup ("listening on...") and the
// error path (request handler exceptions) — successful requests produced NO log
// line, so nothing could later answer "which pages are hot / what does the access
// pattern look like". This adds a per-request access log: one line with an ISO
// timestamp, the HTTP method, and the request path (path + query, so filter/sort
// traffic is distinguishable). It is appended synchronously at request entry (before
// the handler runs), so the line is durable on disk even if the handler later
// errors or hangs — the error path already records its own stack to stderr, and an
// access log is the record of the request being *received*, not of it succeeding.
//
// Disk persistence (AC2): `appendFileSync` to a file — not stdout (which is
// volatile / redirect-dependent). The default path is `<workspaceRoot>/.quay/
// quay-access.log`, gitignored by the bare `*.log` rule so it never lands in the
// repository. A caller (notably a test) can override it via StartServerOptions.
// accessLogPath to pin the file to a deterministic, isolated location.

/** Default access-log filename, relative to the workspace root's `.quay/` dir. */
const ACCESS_LOG_FILENAME = "quay-access.log";

/** Append one access-log line: ISO timestamp + method + request path (incl. query). */
export function logAccess(accessLogPath: string, method: string | undefined, urlPath: string | undefined): void {
  const line = `${new Date().toISOString()} ${method ?? "?"} ${urlPath ?? "/"}\n`;
  try {
    fs.appendFileSync(accessLogPath, line);
  } catch (err) {
    // Logging must never break request handling — surface the write failure to
    // stderr and keep serving.
    console.error(`[quay serve] access log write failed (${accessLogPath}):`, (err as Error).stack || String(err));
  }
}

/**
 * Close the provider client and re-throw `cause` — the "setup failed after the
 * provider was connected" exit.
 *
 * gap-ac244-freshness-subject-set-mechanically-derived (2026-09-11): `connectProvider`
 * SPAWNS A CHILD PROCESS, and startServer used to take ownership of it implicitly —
 * only a successfully returned server carried the `client` handle a caller could close.
 * Any failure between connectProvider and the successful return (a provider whose
 * `manifest()` fails, or a bind failure such as EADDRINUSE) therefore rejected while
 * leaving the child running, with NO handle for the caller to clean up. The leaked child
 * keeps the caller's event loop alive forever.
 *
 * Measured cost of the missing cleanup (this is not hypothetical): in a `node --test`
 * suite file, one such rejection meant the file's process never exited — the file never
 * emitted its per-file completion line, so a 614-file suite finished 613 files and then
 * sat in silence until the silence watchdog killed the run. 23.5 minutes of suite
 * wall-clock lost, and the run reports "killed" instead of the failing test.
 * ⛔ A bind failure must never leak a process. Close the client here, and keep `cause`
 * as the reported error (a shutdown failure must not mask the setup failure).
 */
async function closeSetupFailure(client: ProviderClient, cause: unknown): Promise<never> {
  try {
    await client.close();
  } catch (closeErr) {
    console.error(
      `[quay serve] provider client close failed after a setup failure (the setup failure below is the reported one):`,
      (closeErr as Error).stack || String(closeErr),
    );
  }
  throw cause;
}

export async function startServer({ port = 4173, host = "0.0.0.0", accessLogPath }: StartServerOptions = {}): Promise<Server & { client: ProviderClient }> {
  const cfg = loadConfig();
  // gap-web-server-access-logging (AC2): resolve the access-log path (default
  // <workspaceRoot>/.quay/quay-access.log) and ensure its parent dir exists
  // before the first request, so appendFileSync never fails on a missing dir.
  const resolvedAccessLogPath = accessLogPath ?? path.join(cfg.workspaceRoot, ".quay", ACCESS_LOG_FILENAME);
  fs.mkdirSync(path.dirname(resolvedAccessLogPath), { recursive: true });
  const provider = activeProvider(cfg, undefined);
  const providerDir = path.resolve(cfg.workspaceRoot, provider.path ?? ".");
  const [command, ...args] = provider.mcp_entry;

  const client = await connectProvider({
    command,
    args,
    cwd: providerDir,
    // QN-045 (closes DESIGN.md §4.4's asymmetry): previously this built a
    // single-key env object from `provider.tasks_dir` directly, ignoring
    // `provider.env` entirely — the CLI/MCP legs resolved env the other way
    // (via resolveProviderEnv(cfg, provider), reading only `provider.env`).
    // A workspace config setting `tasks_dir` and `env` to different values
    // would silently serve a different task store to the Web UI than to the
    // CLI/MCP legs. Now all three bindings share the one resolution path.
    env: resolveProviderEnv(cfg, provider),
  });

  // The client owns a live child process from here on: any failure below must close it
  // (see closeSetupFailure) rather than reject past it.
  let manifest: Awaited<ReturnType<ProviderClient["manifest"]>>;
  try {
    manifest = await client.manifest();
  } catch (err) {
    return await closeSetupFailure(client, err);
  }

  // M26-adversarial-eval finding M26-F2 (Phase A audit): this request
  // handler had no top-level try/catch. Combined with provider-client.js's
  // taskList() previously swallowing Provider errors into an empty array,
  // failures were invisible; now that taskList() (and any other client.*
  // call) can throw on a real Provider failure (malformed task file
  // crashing the store, or a live rate-limit/network failure), an unhandled
  // throw inside this async handler would leave the request hanging (no
  // res.end() ever called) rather than degrading safely. This wrapper
  // ensures ANY thrown error from the request-handling logic below (not
  // just the taskList() case) results in a clean 500 response instead of a
  // hung connection or an uncaught rejection that could take the whole
  // server down.
  // gap-web-ui-pages-carry-no-host-project-identity: the page identity is ASSEMBLED ONCE, here,
  // and handed to the route dispatcher — never re-derived per page. It is filled in AFTER the
  // listen resolves because the authoritative port is the one the kernel actually bound (`--port
  // 0` is the test convention for an ephemeral port, so the requested port is not a reading of
  // anything). `identity` stays null only in the window before `listen` — no request can be
  // dispatched then, and a page that ever did see null renders the explicit 「未接入项目身份」
  // title instead of a silently anonymous one.
  // ── MCP control plane, IN THIS PROCESS (GOAL-017/AC-251, SPEC §7 stage A2) ────────────────────
  // Stage A2 = "web (serve) + control 合入一个进程". Before this, `serveControlPlane` had exactly one
  // caller (worker-driver's `--serve` path); here the SAME implementation is mounted by the serve
  // process, so the Web UI and the MCP control plane answer under one pid — which is what makes the
  // `server status` reading (web.pid === control.pid) meaningful rather than self-reported.
  //
  // Port: `0` by default (the kernel picks an ephemeral port, read back from the handle) because a
  // fixed control port would be a second hardcoded surface colliding across worktrees; the env
  // override exists for a deployment that must pin it. The control plane stays loopback-bound by
  // default (its only gate is the caller-identity check, driver-shared.ts CONTROL_HEADER) — the
  // web leg keeps binding 0.0.0.0 as before, so NO existing route's reachability changes.
  //
  // ⛔ This is deliberately NOT a new `quay serve` flag: SPEC §8 criterion 9 forbids stage A from
  // introducing a new user-visible capability, and env is not CLI surface.
  const controlHost = process.env.QUAY_CONTROL_HOST || "127.0.0.1";
  const controlPortRaw = Number(process.env.QUAY_CONTROL_PORT ?? "0");
  const controlPort = Number.isInteger(controlPortRaw) && controlPortRaw >= 0 ? controlPortRaw : 0;
  let control: ControlPlaneHandle;
  try {
    control = await serveControlPlane({
      root: cfg.workspaceRoot,
      host: controlHost,
      port: controlPort,
      name: CONTROL_PLANE_NAME,
    });
  } catch (err) {
    // Same ownership rule as the provider client (see closeSetupFailure): a failure after
    // connectProvider must not leave the provider child running with no handle to close it.
    return await closeSetupFailure(client, err);
  }

  const routeCfg: ServePageCfg = { workspaceRoot: cfg.workspaceRoot, identity: null };

  // The request handler is a VALUE, not a closure baked into one http.Server (AC-254, SPEC §6.9):
  // `stop --only web` closes the listener and `start --only web` must open a NEW one, and a closed
  // http.Server cannot be re-listened (Node throws ERR_SERVER_NOT_RUNNING). One handler, N listeners
  // — the alternative (a fresh copy of the routing logic per open) would be a second implementation
  // of the web face.
  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    // gap-web-server-access-logging (AC1): every received request produces one
    // access-log line (timestamp + method + path) — written synchronously before
    // the handler runs so the record is durable regardless of the handler's
    // outcome. This is the success path's log; the error path still logs its
    // stack to stderr separately below.
    logAccess(resolvedAccessLogPath, req.method, req.url);
    try {
      // gap-webui-server-stale-code-no-restart-detection: /health reports whether
      // the running code is stale (a serve-path commit landed after this process
      // started). Served here (not in serve-handlers.ts) so the freshness signal
      // lives beside the process lifecycle it measures.
      const url = new URL(req.url as string, `http://${req.headers.host}`);
      if (url.pathname === "/health") {
        await handleHealth(res, cfg.workspaceRoot);
        return;
      }
      await handleAllRoutes(req, res, client, manifest, routeCfg);
    } catch (err) {
      console.error(`[quay serve] request handler error (${req.method} ${req.url}):`, (err as Error).stack || String(err));
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("internal server error");
      } else {
        res.end();
      }
    }
  };

  const makeWebServer = (): http.Server => {
    const s = http.createServer(requestHandler);
    // The persistent 'error' handler (see the port-collision note below) must be on EVERY web face,
    // not only the first — a re-listen after `start --only web` gets the same treatment.
    s.on("error", (err) => {
      console.error(`[quay serve] server error:`, (err as Error).stack || String(err));
    });
    return s;
  };

  const server = makeWebServer();

  // QX-038 (experiment 4, iteration 11): DIR-005 item 5 — bind explicitly to 0.0.0.0
  // (all interfaces) instead of relying on Node's implicit default, and update the log
  // line to reflect the actual binding. Previously `server.listen(port)` with no host
  // bound all interfaces (0.0.0.0) by default, but the log line claimed `localhost`,
  // misleading the G7 precondition check ("reachable on 0.0.0.0, not localhost-only")
  // into reading it as a localhost-only binding when it was not.
  //
  // Port-collision fix (gap-serve-family-port-collision, 2026-08-12): two
  // startServer lifecycle defects made the pid-derived test-port scheme necessary:
  // (a) this function resolved BEFORE the bind completed — a caller could not read
  // `server.address().port` back, so tests could not use the kernel-assigned
  // ephemeral port (`port: 0`); (b) there was no 'error' handler, so a bind failure
  // (EADDRINUSE) crashed the process with an unhandled 'error' event instead of a
  // clean rejection. Both are fixed here: the promise resolves only once the
  // 'listening' event fires (so `server.address().port` is valid immediately after
  // `await startServer({ port: 0 })`), and a persistent 'error' handler turns bind
  // failures into logged rejections. An explicit, user-supplied `port` is still
  // honored exactly — `port: 0` is only the internal/test convention for asking the
  // kernel to pick an ephemeral port.
  /** Bind ONE web face and resolve with the port the KERNEL actually bound. */
  async function listenWeb(s: http.Server, requestedPort: number): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      s.once("listening", resolve);
      s.once("error", reject);
      s.listen(requestedPort, host, () => {
        const a = s.address();
        const actualPort = a && typeof a === "object" ? a.port : requestedPort;
        console.log(`quay serve: listening on http://${host}:${actualPort}`);
      });
    });
    const a = s.address();
    return a && typeof a === "object" ? a.port : requestedPort;
  }

  let webPort = port;
  try {
    webPort = await listenWeb(server, port);
  } catch (err) {
    // A bind failure (EADDRINUSE when the caller probed the port on loopback only while we
    // bind 0.0.0.0, or any other listen error) must leave neither a provider child NOR the
    // control-plane socket behind — the caller has no server handle to close either from.
    // A leaked listening socket is not cosmetic: it keeps the event loop alive forever, which in a
    // `node --test` file means the file never exits (the closeSetupFailure comment above records
    // that exact 23.5-minute suite stall).
    await control.close().catch((closeErr) => {
      console.error(
        `[quay serve] control-plane close failed after a bind failure (the bind failure below is the reported one):`,
        (closeErr as Error).stack || String(closeErr),
      );
    });
    return await closeSetupFailure(client, err);
  }

  // QN-031 (iteration 21): expose the underlying provider client so a caller
  // (notably an automated test) can shut down the MCP child process cleanly
  // instead of leaving it running after http.Server.close(). This is a pure
  // addition (a new property on the returned object) — no existing caller's
  // behavior changes, since nothing previously read `server.client`.
  (server as Server & { client: ProviderClient }).client = client;

  // gap-web-ui-pages-carry-no-host-project-identity: now that the bind succeeded, the identity's
  // address half is a real reading (the kernel-assigned port for `--port 0`), so assemble it and
  // hand it to every subsequent request. The git-derived branch names come from observation.ts
  // (the serve path's only sanctioned git reader).
  routeCfg.identity = serveIdentity({
    workspaceRoot: cfg.workspaceRoot,
    host,
    port: webPort,
    loop: (cfg.config as { loop?: Record<string, unknown> } | null)?.loop ?? null,
    branchModel: readBranchModel(cfg.workspaceRoot),
  });

  // ── The live service manager (GOAL-017/AC-254, SPEC §6.9) ──────────────────────────────────────
  //
  // This process is the HOST of `web` + `control`. Each face can be closed and re-opened WITHOUT
  // killing the host — that is what makes `stop --only web` different from `kill <host pid>`, and
  // the difference is observable (§6.9 不变式 2: the control face stays reachable, the host pid does
  // not change). Everything below is the host's half of the desired-state protocol; the CLI's half
  // is cli/server.ts.
  let webServer: http.Server | null = server;
  let webBoundPort = webPort;
  let controlHandle: ControlPlaneHandle | null = control;
  let controlBoundPort = control.port;
  let shuttingDown = false;
  /**
   * True only for the synchronously-scoped `close()` that `stopWebFace` issues on a PARTIAL stop.
   *
   * This flag is what keeps §6.9 不变式 2 (partial stop leaves the host — and therefore its carrier
   * and control face — alive) from colliding with the pre-AC-254 contract every existing in-process
   * caller still relies on (`server.close()` ends the whole host, so `quay serve` exits). Both close
   * the SAME `http.Server`, so the act alone cannot be told apart; the caller's intent must be said
   * explicitly, and this says it.
   *
   * ⛔ Dropping one of the two halves is not a style choice — measured 2026-09-13, each direction
   * fails a different, real check:
   *   · retire on EVERY close ⇒ a partial stop retires the carrier of a live host (a running host
   *     reported NOT-RUNNING) and kills the control face — 「波及其他服务」, the exact failure §6.9
   *     excludes, and AC-254's own record would be meaningless;
   *   · retire on NO close ⇒ the control-plane listening socket is never released at the end of a
   *     plain `server.close()`, so the event loop never drains: `packages/quay/test/serve.test.mjs`
   *     printed "All QN-031 serve/action regression tests passed." and then hung forever under
   *     `node --test` (measured: 4 286 177 ms, "Promise resolution is still pending but the event
   *     loop has already resolved" — the 71-minute scoped-gate stall).
   */
  let partialWebClose = false;

  /** Publish §6.5's carrier from the LIVE service set. A service that is down keeps its last bound
   *  port (so a reader can still probe it and read "down" instead of "unknown") and gains
   *  `up:false` — the extra key is ignored by server-state.ts's shape check, and its presence is
   *  what keeps 「停了的服务」 from being indistinguishable from 「从没有过的服务」. */
  function publishCarrier(): void {
    const services: Array<{ name: string; pid: number; host: string; port: number; up: boolean }> = [
      { name: "web", pid: process.pid, host, port: webBoundPort, up: webServer !== null },
      { name: "control", pid: process.pid, host: controlHost, port: controlBoundPort, up: controlHandle !== null },
    ];
    writeServerState(cfg.workspaceRoot, {
      pid: process.pid,
      startedAt: new Date(processStartMs()).toISOString(),
      services,
    });
  }

  async function stopWebFace(): Promise<void> {
    const s = webServer;
    if (s === null) return;
    webServer = null; // cleared FIRST: the reconcile loop must not see a half-closed face as "up"
    if (typeof (s as http.Server & { closeAllConnections?: () => void }).closeAllConnections === "function") {
      (s as http.Server & { closeAllConnections: () => void }).closeAllConnections();
    }
    // Marked as PARTIAL for exactly the span of this close. `s.close(cb)` registers `cb` as a
    // `once("close")` listener, so the host's handler (registered in `startServer`, long before this
    // call) runs FIRST and sees the mark; `cb` then clears it. See `partialWebClose` for why the two
    // directions are both load-bearing.
    partialWebClose = true;
    await new Promise<void>((resolve) =>
      s.close(() => {
        partialWebClose = false;
        resolve();
      }),
    );
  }

  async function startWebFace(): Promise<void> {
    if (webServer !== null) return;
    const s = makeWebServer();
    webBoundPort = await listenWeb(s, webBoundPort);
    webServer = s;
  }

  async function stopControlFace(): Promise<void> {
    const c = controlHandle;
    if (c === null) return;
    controlHandle = null;
    await c.close().catch((err) => {
      console.error(`[quay serve] control-plane close failed (partial stop):`, (err as Error).stack || String(err));
    });
  }

  async function startControlFace(): Promise<void> {
    if (controlHandle !== null) return;
    controlHandle = await serveControlPlane({
      root: cfg.workspaceRoot,
      host: controlHost,
      port: controlBoundPort,
      name: CONTROL_PLANE_NAME,
    });
    controlBoundPort = controlHandle.port;
  }

  /**
   * Apply the desired-state carrier to the live faces. Idempotent by construction: every branch is
   * "already in the wanted state ⇒ return".
   *
   * ⛔ PID GATE: a desired-state file naming another pid is STALE (left by a previous host) and is
   * ignored — without it, a wish recorded against a dead host would be applied to whatever host
   * starts next (an old intent silently steering a new process).
   */
  async function reconcile(): Promise<void> {
    if (shuttingDown) return;
    const read = readServiceState(cfg.workspaceRoot);
    if (read.kind !== "present") return; // absent/unreadable ⇒ change nothing (⛔ never guess a wish)
    const st = read.state as ServiceState;
    if (st.pid !== process.pid) return; // stale wish, another host's
    try {
      if (st.services.web === true) await startWebFace();
      else if (st.services.web === false) await stopWebFace();
      if (st.services.control === true) await startControlFace();
      else if (st.services.control === false) await stopControlFace();
    } catch (err) {
      // A failed face transition must be REPORTED, never swallowed: silently keeping the old state
      // while the desired state says otherwise is exactly how "the CLI said it stopped it" and
      // "the port is still accepting" diverge.
      console.error(`[quay serve] service reconcile failed:`, (err as Error).stack || String(err));
    }
    publishCarrier();
  }

  const reconcileTimer = setInterval(() => {
    void reconcile();
  }, RECONCILE_INTERVAL_MS);
  // unref'd: the reconcile tick must never be the reason the process stays alive.
  reconcileTimer.unref();

  /**
   * The host's own shutdown: close every hosted face, retire the carrier, stop reconciling.
   *
   * ⛔ NOT tied to EVERY `server.on("close")` (AC-254): closing the web face is now a NORMAL, partial
   * operation that leaves the host alive, so retiring the carrier on it would report a running host
   * as NOT-RUNNING. Retirement belongs to the host's own end — which the close handler below
   * distinguishes from a partial stop via `partialWebClose`.
   */
  async function shutdownHost(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(reconcileTimer);
    const root = cfg.workspaceRoot;
    try {
      await stopWebFace();
      await stopControlFace();
    } finally {
      removeServerState(root);
    }
  }

  // An UNMARKED close of the server this function returns is the WHOLE host ending — retire the
  // carrier and the control face with it, so `quay serve` exits and `quay server status` reports
  // NOT-RUNNING instead of reading a leftover file lying about a stopped server. This is the
  // pre-AC-254 contract every existing in-process caller still depends on: `packages/quay/test/
  // serve.test.mjs` (12 call sites) and the `--watch`/supervisor SIGINT path both use it, and
  // without it the control-plane socket keeps the event loop alive forever.
  //
  // A MARKED close (`stopWebFace` on a partial stop) returns here without retiring anything: the
  // host — and its control face — is exactly what §6.9 不变式 2 says must survive `stop --only web`.
  // See `partialWebClose` for the measured failure on each side.
  server.on("close", () => {
    if (partialWebClose) return;
    void shutdownHost();
  });

  // ── Publish the carrier, then apply the launch-time service set (GOAL-017/AC-251 & AC-254) ─────
  // Both services carry THIS process's pid — that identity is not decoration, it is the reading
  // stage A2's criterion is defined on (`web.pid === control.pid`). `startedAt` is reconstructed
  // from process.uptime() (the same source /health uses) rather than Date.now(), so a carrier is
  // never published claiming a start instant earlier than the process it describes.
  //
  // Written AFTER the bind succeeded: the ports in the carrier are the ports the kernel actually
  // bound (web) and the control handle reported (control), never the requested values — a carrier
  // naming an unbound port would be a reading of nothing.
  publishCarrier();
  console.log(`quay serve: control plane (MCP) listening on ${control.url} — same pid ${process.pid} (SPEC stage A2)`);

  // `QUAY_SERVER_SERVICES` is the LAUNCH-TIME service set (a subset of `web`/`control`). Unset ⇒
  // both, i.e. every existing caller's behaviour is byte-identical. When set, the desired-state
  // carrier is seeded and the reconciler closes whatever was not asked for — one code path, so
  // "started without control" and "control stopped later" cannot drift apart.
  const launchSet = process.env.QUAY_SERVER_SERVICES;
  if (launchSet !== undefined) {
    const want = new Set(
      launchSet
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
    writeServiceState(cfg.workspaceRoot, process.pid, {
      web: want.has("web"),
      control: want.has("control"),
    });
  }

  // gap-tasks-page-develop-ref-full-history-git-log-cost (AC1): mount a background refresh tick that
  // keeps the develop-ref read caches warm OFF the request path. The cold full build runs here (at
  // startup), so the request path reads cache in the common case instead of re-walking git history.
  // unref'd — it never keeps the process alive; a non-git workspace fails the refresh silently.
  startDevelopRefBackgroundRefresh(cfg.workspaceRoot, "develop");

  // Expose the control-plane handle the same way QN-031 exposed `client`: a caller (notably a test)
  // can retire BOTH hosted services deterministically instead of orphaning the control socket.
  const owned = server as Server & {
    client: ProviderClient;
    control: ControlPlaneHandle;
    hostedServices: HostedServiceManager;
  };
  owned.control = control;
  owned.hostedServices = {
    isUp: (name: "web" | "control") => (name === "web" ? webServer !== null : controlHandle !== null),
    portOf: (name: "web" | "control") => (name === "web" ? webBoundPort : controlBoundPort),
    reconcile,
    shutdownHost,
  };

  return owned;
}

/**
 * The live per-service view of a running host (AC-254). `isUp`/`portOf` are DIRECT readings of this
 * process's own listeners — the CLI cannot see those, which is why the host itself exposes them to
 * in-process callers (tests) while out-of-process callers go through the carrier + live probes.
 */
export interface HostedServiceManager {
  isUp(name: "web" | "control"): boolean;
  portOf(name: "web" | "control"): number;
  reconcile(): Promise<void>;
  shutdownHost(): Promise<void>;
}

/**
 * Shut a host down from outside `startServer` (used by the tests and by any in-process caller that
 * owns the object `startServer` returned). Kept as a free function so the ownership rule is stated
 * once: **closing the web face is not shutting the host down**.
 */
export async function shutdownHost(server: Server & { hostedServices?: HostedServiceManager; client?: ProviderClient }): Promise<void> {
  if (server.hostedServices) {
    await server.hostedServices.shutdownHost();
  } else {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (server.client) await server.client.close().catch(() => undefined);
}
