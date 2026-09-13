// server-state.ts — the ONE owner of the unified server's state carrier + per-service liveness
// readings (GOAL-017 / AC-251, SPEC-unified-quay-server-2026-09-13 §6.5 / §6.10 / §7 stage A2).
//
// WHY THE CARRIER EXISTS (SPEC §7 stage A2): `quay serve` (Web UI) and `serveControlPlane` (the MCP
// control plane) used to run in two processes. Stage A2 merges them into ONE pid — and the moment
// they share a pid, nothing in `ps` tells a reader which services that single process hosts. This
// module publishes that fact to a durable, externally-readable file and reads it back with the
// three outcomes kept apart. It is deliberately the ONLY place the carrier's path and shape are
// written down: `packages/quay/src/serve.ts` (the publisher) and `packages/quay/src/cli/server.ts`
// (the reader) both import from here, so the contract cannot drift into two definitions.
//
// ── 三分法（硬规则 3b — 本文件必须做对的判断）──────────────────────────────────────────────────
// `readServerState` returns a DISCRIMINATED result so no caller can fold three different facts into
// one boolean:
//   · absent      — no `.quay/server.json`: nothing was started here      → NOT-RUNNING  (exit 1)
//   · unreadable  — the file exists but cannot be parsed / wrong shape    → NOT-EVALUATED (exit 3)
//   · present     — a well-formed carrier; liveness is judged SEPARATELY  → running | degraded
// Collapsing "unreadable" into "absent" would let a corrupt carrier read as "no server" — a false
// negative an operator acts on. Collapsing it into "running" is the §8-8 failure (`status` green
// while a service is stalled). Both are forbidden; `absent` is therefore a separate field, not the
// negation of `evaluated`.
//
// ── 活性只取直接量（SPEC §6.7 / §6.10，硬规则 4b）──────────────────────────────────────────────
// A service's liveness is NEVER derived from "the process is alive, so its services must be"
// (§6.10 names that exact inference as the risk the merge introduces). Each service is probed
// through its OWN live face — HTTP `GET /health` for `web`, a JSON-RPC `initialize` POST for
// `control` — and every probe result carries its own `evaluated` flag, so "the probe answered and
// the service is down" and "the probe could not be interpreted" stay distinguishable. The carrier's
// own `pid` is checked too (`pidAlive`): a carrier naming a dead pid is precisely how a killed
// server masquerades as a running one.

import fs from "node:fs";
import path from "node:path";
// The atomic JSON write is single-source in the plugin layer (write-json-atomic.ts's header:
// "the single atomic JSON-file write for every state writer") and is imported by the product the
// same way packages/quay-native/src/store.ts imports plugin/scripts/shape-sections.ts — esbuild
// inlines it into the self-contained dist bundle.
import { writeJsonAtomic } from "../../../plugin/scripts/write-json-atomic.ts";

/** The carrier's workspace-relative path. Runtime state — never committed (untracked `.quay/`). */
export const SERVER_STATE_REL = ".quay/server.json";

/** Carrier schema version. Bumped only on an incompatible shape change; readers fail closed on a
 *  version they do not know (unreadable ⇒ NOT-EVALUATED, never "running"). */
export const SERVER_STATE_SCHEMA_VERSION = 1;

/** The MCP control-plane server name this package publishes — the probe checks it, so a JSON-RPC
 *  answer from some OTHER listener on the same port cannot be mistaken for our control plane. */
export const CONTROL_PLANE_NAME = "quay-server-control";

/** One hosted service: which service, under which pid, on which bind host/port. */
export interface ServerServiceEntry {
  /** "web" | "control" (the SPEC §6.9 service names). */
  name: string;
  /** The HOST process's pid. Both entries carry the same value — that equality IS stage A2. */
  pid: number;
  /** The bind host recorded at listen time (may be 0.0.0.0 / ::). */
  host: string;
  /** The port the kernel actually bound (read back from the socket, not the requested value). */
  port: number;
}

/** The published carrier. `pid` is the host process pid, duplicated inside every service entry. */
export interface ServerState {
  schemaVersion: number;
  pid: number;
  startedAt: string;
  services: ServerServiceEntry[];
}

/**
 * Discriminated read result — the three-way contract in the header.
 *
 * ⚠️ The discriminant is a STRING, not a boolean pair. This repo's root tsconfig is `strict: false`
 * (no strictNullChecks), under which TypeScript does NOT narrow a discriminated union through
 * `if (!x.flag)` / truthiness — `x` stays the whole union and member access fails to compile
 * (measured: `packages/quay/src/cli/server.ts` + `plugin/scripts/driver-shared.ts`, 2026-09-13).
 * A string-literal discriminant narrows correctly under both strictness settings, so the three
 * outcomes stay distinguishable at the type level too — not merely in the doc comment.
 */
export type ServerStateRead =
  | { kind: "present"; path: string; state: ServerState }
  | { kind: "absent"; path: string; reason: string }
  | { kind: "unreadable"; path: string; reason: string };

/** The carrier path for a workspace root. */
export function serverStatePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, SERVER_STATE_REL);
}

/** Publish the carrier atomically. Returns the written path (callers log it, never re-derive it). */
export function writeServerState(
  workspaceRoot: string,
  state: Omit<ServerState, "schemaVersion">,
): string {
  const p = serverStatePath(workspaceRoot);
  writeJsonAtomic(p, { schemaVersion: SERVER_STATE_SCHEMA_VERSION, ...state });
  return p;
}

/** Remove the carrier (best-effort). Called on a graceful server close so a stopped server is not
 *  reported from a leftover file; SIGKILL leaves the file and is caught by the pid check instead. */
export function removeServerState(workspaceRoot: string): void {
  try {
    fs.rmSync(serverStatePath(workspaceRoot), { force: true });
  } catch {
    /* best-effort: the pid-liveness check still catches a leftover carrier */
  }
}

/** True iff `value` is a well-formed carrier. Shape-checking here (not at each use site) is what
 *  makes "unreadable" a single, testable outcome. */
function isServerState(value: unknown): value is ServerState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== SERVER_STATE_SCHEMA_VERSION) return false;
  if (typeof v.pid !== "number" || !Number.isInteger(v.pid)) return false;
  if (typeof v.startedAt !== "string") return false;
  if (!Array.isArray(v.services)) return false;
  return v.services.every((s) => {
    if (!s || typeof s !== "object") return false;
    const e = s as Record<string, unknown>;
    return (
      typeof e.name === "string" &&
      e.name.length > 0 &&
      typeof e.pid === "number" &&
      Number.isInteger(e.pid) &&
      typeof e.host === "string" &&
      typeof e.port === "number" &&
      Number.isInteger(e.port)
    );
  });
}

/**
 * Read the carrier. Never throws — every failure is an explicit outcome:
 *   absent file            → { kind:"absent",     reason:"…" }   ← NOT-RUNNING
 *   unreadable / bad shape → { kind:"unreadable", reason:"…" }   ← NOT-EVALUATED (硬规则 3b)
 *   well-formed            → { kind:"present",    state }
 */
export function readServerState(workspaceRoot: string): ServerStateRead {
  const p = serverStatePath(workspaceRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return { kind: "absent", path: p, reason: `no ${SERVER_STATE_REL} in ${workspaceRoot}` };
    }
    return { kind: "unreadable", path: p, reason: `cannot read ${p}: ${String(code ?? (err as Error)?.message ?? err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { kind: "unreadable", path: p, reason: `cannot parse ${p}: ${(err as Error).message}` };
  }
  if (!isServerState(parsed)) {
    return {
      kind: "unreadable",
      path: p,
      reason: `${p} does not match the schemaVersion ${SERVER_STATE_SCHEMA_VERSION} carrier shape`,
    };
  }
  return { kind: "present", path: p, state: parsed };
}

/** Direct quantity: is this pid a live process? `kill(pid, 0)` probes existence without signalling —
 *  EPERM means "exists but not ours", which is still alive. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

// ── Per-service live faces (SPEC §6.10: 活性取直接量) ────────────────────────────────────────────
//
// `evaluated` is the hard-rule-3b half: a probe that could not be interpreted reports
// `{evaluated:false, alive:null}` — NEVER `alive:false` (which would assert a fact we did not
// obtain) and never `alive:true`. Only a probe that produced a reading it understands may set
// `alive`.

export interface ServiceProbe {
  evaluated: boolean;
  alive: boolean | null;
  /** Which live face produced the reading (null when nothing could be evaluated). */
  source: string | null;
  /** Human-readable evidence (HTTP status, JSON-RPC method, transport error…). */
  detail: string;
}

/** Probe timeout — a localhost health read; long enough not to flake under load, short enough that
 *  `server status` stays a fast command. */
export const PROBE_TIMEOUT_MS = 4000;

/** Which address to dial for a recorded bind host: wildcard bindings are reached on loopback. */
export function probeAddress(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "" || host === "*") return "127.0.0.1";
  return host;
}

/** One HTTP exchange with a hard timeout; returns null only for a TRANSPORT failure (refused /
 *  timed out / unreachable) — a received response is never null. */
async function httpExchange(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: string; headers: Headers } | { transportError: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body, headers: res.headers };
  } catch (err) {
    return { transportError: (err as Error)?.name === "AbortError" ? `timeout after ${PROBE_TIMEOUT_MS}ms` : String((err as Error)?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `web`'s live face: `GET /health` (the existing stale-code endpoint, gap-webui-server-stale-code-
 * no-restart-detection). A 200 whose body is JSON carrying `ok:true` is the reading. Anything else
 * — a transport failure, a non-200, a body that is not the health document — is `evaluated:false`
 * (we did not obtain a reading we understand), EXCEPT a transport failure, which IS a reading:
 * nothing is listening on that port.
 */
export async function probeWebService(host: string, port: number): Promise<ServiceProbe> {
  const source = "http:GET /health";
  const url = `http://${probeAddress(host)}:${port}/health`;
  const r = await httpExchange(url, { method: "GET" });
  if ("transportError" in r) {
    return { evaluated: true, alive: false, source, detail: `${url} unreachable: ${r.transportError}` };
  }
  let body: unknown;
  try {
    body = JSON.parse(r.body);
  } catch {
    return { evaluated: false, alive: null, source, detail: `${url} returned HTTP ${r.status} with a non-JSON body` };
  }
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) {
    return { evaluated: false, alive: null, source, detail: `${url} returned HTTP ${r.status} with a JSON body that is not the /health document` };
  }
  if (r.status !== 200) {
    return { evaluated: true, alive: false, source, detail: `${url} returned HTTP ${r.status}` };
  }
  return { evaluated: true, alive: true, source, detail: `${url} → HTTP 200 ok:true (stale:${JSON.stringify((body as { stale?: unknown }).stale)})` };
}

/** Extract the JSON-RPC payload from either a plain JSON body or an SSE (`data: …`) stream — the
 *  streamable-HTTP transport answers an `initialize` POST with SSE (empirically verified). */
function extractJsonRpc(body: string, contentType: string | null): Record<string, unknown> | null {
  const candidates: string[] = [];
  if (contentType && contentType.includes("application/json")) candidates.push(body);
  for (const line of body.split(/\r?\n/)) {
    const m = /^data:\s*(.+)$/.exec(line);
    if (m) candidates.push(m[1]);
  }
  if (candidates.length === 0) candidates.push(body);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && typeof (parsed as { jsonrpc?: unknown }).jsonrpc === "string") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * `control`'s live face: a JSON-RPC `initialize` POST to the streamable-HTTP endpoint (the same
 * transport `serveControlPlane` mounts). Interpreted only when the response parses as a JSON-RPC
 * frame AND — when it carries `result.serverInfo.name` — that name is OURS (`CONTROL_PLANE_NAME`),
 * so an unrelated JSON-RPC listener squatting the recorded port is not read as our control plane.
 */
export async function probeControlService(host: string, port: number): Promise<ServiceProbe> {
  const source = "jsonrpc:initialize";
  const url = `http://${probeAddress(host)}:${port}/`;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "quay-server-status", version: "1" } },
  });
  const r = await httpExchange(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: payload,
  });
  if ("transportError" in r) {
    return { evaluated: true, alive: false, source, detail: `${url} unreachable: ${r.transportError}` };
  }
  const frame = extractJsonRpc(r.body, r.headers.get("content-type"));
  if (!frame) {
    return { evaluated: false, alive: null, source, detail: `${url} returned HTTP ${r.status} but not a JSON-RPC frame` };
  }
  const serverInfo = (frame.result as { serverInfo?: { name?: unknown } } | undefined)?.serverInfo;
  if (serverInfo && typeof serverInfo.name === "string" && serverInfo.name !== CONTROL_PLANE_NAME) {
    return {
      evaluated: true,
      alive: false,
      source,
      detail: `${url} answered JSON-RPC but as serverInfo.name=${JSON.stringify(serverInfo.name)} (expected ${JSON.stringify(CONTROL_PLANE_NAME)})`,
    };
  }
  const err = frame.error as { message?: unknown } | undefined;
  if (err) {
    // A JSON-RPC error frame still proves the control plane answered on this port.
    return { evaluated: true, alive: true, source, detail: `${url} → JSON-RPC error ${JSON.stringify(err.message ?? err)}` };
  }
  return { evaluated: true, alive: true, source, detail: `${url} → JSON-RPC result (serverInfo.name=${JSON.stringify(serverInfo?.name ?? null)})` };
}
