#!/usr/bin/env node
// server-partial-stop-verify.ts — the PRODUCER for GOAL-017 / AC-254's carrier
// (`.quay/unified-server-verification.jsonl`).
//
// WHAT QUESTION THIS ANSWERS
//   "Does `quay server stop --only web` — the SPEC §6.9 partial stop — really stop ONLY the web
//    service, i.e. does it leave the host process alive, leave the SAME process's `control` face
//    reachable, and leave the six drivers' round heartbeats advancing?"
//
// WHY A PRODUCER AND NOT A CHECKER (硬规则 4 推论三)
//   AC-254's criterion reads a carrier that no code produced. A criterion whose only satisfier is a
//   fixture proves that a record CAN be produced, never that one HAS been. So this script is the
//   thing that runs the real partial stop against a real unified server and writes the real
//   record — and it is fail-closed at every reading: anything it cannot read or cannot satisfy
//   produces ZERO record plus a DISTINGUISHABLE non-zero verdict (硬规则 3b). It is deliberately
//   NOT registered in runner-static-gate.ts (it is a producer, not a per-round static check;
//   registering it would redden the whole suite every round until the record exists).
//
// ── 为什么这里的探针是【独立实现】而不是复用产品里的 probeWebService ─────────────────────────────
//   硬规则 4b：不能用一个由被测对象自己产生、自己维护的量去判它。产品的 `server status` 与
//   `probeWebService` 就是**被测面的一部分**；验证器与被验证者共用同一具仪器，读到的是「它说它
//   是什么」而不是「它是什么」。故本脚本用最朴素的 `fetch` 独立探：web = `GET /health` 必须
//   HTTP 200 且 body.ok===true；control = 对控制端口 POST 一条 JSON-RPC `initialize` 并必须拿到
//   **JSON-RPC 形态**的响应帧。⛔ 这不是「第二份实现」——两份实现的分工是【被测】与【验证】，
//   而 §6.8/§6.9 禁止的是同一职责的第二份实现。
//
// ── 读数全是直接量 ─────────────────────────────────────────────────────────────────────────────
//   web 可达性   = 对**端口**真发 HTTP 请求（⛔ 不采信 `quay server status` 的自报）
//   host 存活    = `.quay/server.json` 的 pid + `process.kill(pid,0)`（外部可核）
//   round 推进   = 六个 `.quay/<kind>-round.jsonl` 各自末行的 `run_id` + `round`（⛔ 不是 pid 文件
//                  存在性——那是代理量，CLAUDE.md 硬规则 4b）
//   前后同 run   = 两点读数的 `run_id` 必须逐 kind 相同（否则「driver 被重启、round 从 1 重数」
//                  会被读成「观察到推进」）
//
// Usage:
//   node --experimental-strip-types plugin/scripts/server-partial-stop-verify.ts \
//        [--root <workspace-root>] [--cli <path-to-quay-cli-entry>] [--window-ms N] [--json]
//        [--control <no-host|kill-host>]
//
// Exit codes (the verdict is the code, and `--json` always emits a parseable document):
//   0  a qualifying record was appended
//   1  the partial stop was performed but the record was REFUSED (zero record) — see `verdict`
//   2  the run could NOT be evaluated (no live web before the stop / unreadable carrier)
//   3  usage error
//   `--control kill-host` is the STRUCTURAL control: it kills the host process instead of doing a
//   partial stop, and the producer must REFUSE (✅ the two are distinguishable in the record).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DRIVER_KINDS } from "./driver-runtime.ts";
import { isDirectEntry } from "./gate-script-base.ts";

/** AC-254's own id, verbatim — the criterion matches this string exactly. */
export const AC_ID = "GOAL-017-AC-254";
/** The carrier this producer owns. The criterion's exit 1 on a missing carrier means the AC's own
 *  product is absent. */
export const CARRIER_REL = ".quay/unified-server-verification.jsonl";
/** The unified server's state carrier (written by the host; this script only READS it). */
const SERVER_STATE_REL = ".quay/server.json";
/** The six kinds the criterion requires — ⛔ derived from the kernel's DRIVER_KINDS, never typed out.
 *  A hardcoded copy would drift the moment a kind is added, and the criterion would silently start
 *  demanding 6 while the producer reports 7 (or vice versa). */
export const KIND_NAMES: string[] = Object.keys(DRIVER_KINDS);

/** The ROUND carrier for one kind, derived from the kernel's registry (`carriers`), never typed out.
 *  The registry lists carriers in scan order (outcome first, round second); the round heartbeat is
 *  the `-round.jsonl` one, and AC-254 is about round advancement. Returns null when a kind declares
 *  no round carrier (⇒ NOT-EVALUATED, never "no progress"). */
export function roundCarrierName(carriers: readonly string[]): string | null {
  const rounds = carriers.filter((c) => /-round\.jsonl$/.test(c));
  return rounds.length === 1 ? rounds[0] : null;
}

/** kind → `.quay/<round carrier>` for every kind the kernel knows. */
export function roundCarrierMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [kind, spec] of Object.entries(DRIVER_KINDS)) {
    const name = roundCarrierName((spec as { carriers: readonly string[] }).carriers);
    if (name) out[kind] = name;
  }
  return out;
}

// ── 读数：一个 round 记录 ───────────────────────────────────────────────────────────────────────

export interface RoundReading {
  kind: string;
  /** the carrier file, workspace-relative (evidence for cross-checking). */
  carrier: string;
  /** the reading's own `run_id`. TWO readings belong to the same driver lifetime iff these match. */
  runId: string;
  /** the round number, as an INTEGER. ⚠️ The carrier stores it as a JSON STRING (`"2499"`); this
   *  field is the CONVERTED value and `roundRawType` records what was actually on disk. */
  round: number;
  /** "string" | "number" | "missing" — the type as found on disk (the conversion's evidence). */
  roundRawType: string;
  ts: string;
}

/**
 * Parse ONE round-carrier line. Returns null when the line cannot be read as a round record —
 * which the caller must treat as NOT-EVALUATED (⛔ never as "no progress": «读不懂» ≠ «没推进»,
 * 硬规则 3b).
 *
 * ⚠️ The `round` field is a JSON STRING in the carriers (measured 2026-09-13:
 * `{"ts":"…","round":"2499","run_id":"wk-prod-…"}`), while the criterion's python is
 * `isinstance(b, int)` ⇒ writing the raw string through is structurally disqualifying. The
 * conversion happens HERE, once, and `roundRawType` keeps the pre-conversion type visible.
 */
export function parseRoundRecord(line: string, tsKey: string): RoundReading | null {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  const rawRound = r.round;
  const rawType = rawRound === undefined ? "missing" : typeof rawRound;
  let round: number | null = null;
  if (typeof rawRound === "number" && Number.isInteger(rawRound)) round = rawRound;
  else if (typeof rawRound === "string" && /^-?\d+$/.test(rawRound.trim())) round = Number(rawRound.trim());
  if (round === null) return null;
  const ts = r[tsKey] ?? r.ts;
  const runId = r.run_id ?? r.runId;
  return {
    kind: "",
    carrier: "",
    runId: typeof runId === "string" ? runId : "",
    round,
    roundRawType: rawType,
    ts: typeof ts === "string" ? ts : "",
  };
}

/** The LAST non-empty line of a JSONL file, or null when the file is absent / empty / unreadable.
 *  Reading the tail by splitting is fine here: these carriers are per-round append-only lines. */
export function lastLine(file: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

/** Read one kind's round reading from `root`, or null when it cannot be obtained. */
export function readKind(root: string, kind: string, carrier: string, tsKey: string): RoundReading | null {
  const line = lastLine(path.join(root, ".quay", carrier));
  if (line === null) return null;
  const r = parseRoundRecord(line, tsKey);
  if (r === null) return null;
  return { ...r, kind, carrier: `.quay/${carrier}` };
}

// ── 组装：判据字段形态 fail-closed（字段类型就是判据的一部分）────────────────────────────────────

export interface StopReadings {
  hostPidBefore: number | null;
  hostPidAfter: number | null;
  /** Is the host process ALIVE after the stop? Read with `process.kill(pid,0)`, i.e. externally.
   *  ⛔ Without this, a SIGKILLed host still reads "pid unchanged" from the leftover carrier FILE —
   *  and the whole-process control would pass a pid comparison while the process is a corpse. */
  hostAliveAfter: boolean;
  webReachableBefore: boolean;
  webReachableAfter: boolean;
  controlReachableAfter: boolean;
  /** The instant the BEFORE series was read (ISO-8601). Every carrier must have been written at or
   *  after it — that is exactly what the criterion's mtime cross-check asserts, and choosing the
   *  EARLIEST observation is what makes the assertion true by construction rather than by luck. */
  at: string;
  before: RoundReading[];
  after: RoundReading[];
  stoppedVia: string;
  stoppedArgv: string[];
  stoppedExit: number;
  stoppedStdout: string;
}

export type Verdict =
  | "OK"
  | "NOT-EVALUATED"
  | "NO-PROGRESS"
  | "RUN-MISMATCH"
  | "TYPE-INVALID"
  | "HOST-CHANGED"
  | "CONTROL-DOWN"
  | "WEB-STILL-UP";

export interface BuildResult {
  ok: boolean;
  verdict: Verdict;
  reason: string;
  record?: Record<string, unknown>;
}

/** Does `v` look like an ISO-8601 instant the criterion's `time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")`
 *  can parse? The criterion reports exit 3 for a non-ISO `at`, so the producer must not emit one. */
export function isIsoInstant(v: unknown): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v);
}

/**
 * Assemble AC-254's record — fail-closed, and every refusal carries a DISTINGUISHABLE verdict.
 *
 * The order matters: the strongest "the measurement was empty" (a) comes first, then the
 * structural controls (host changed / control down), then the per-kind readings. Each branch is a
 * way the record COULD have been produced while observing nothing.
 */
export function buildRecord(r: StopReadings): BuildResult {
  // (a) 空转控制：停之前 web 就不可达 ⇒ 「停掉后不可达」什么都没观察到。⛔ 零记录。
  if (r.webReachableBefore !== true) {
    return {
      ok: false,
      verdict: "NOT-EVALUATED",
      reason: "web was NOT reachable BEFORE the stop — 'unreachable after' would be vacuous (空转控制 a)",
    };
  }
  // (b) 整体停机控制：宿主进程变了 ⇒ 这不是「部分停止」，是「整体重启」。读数的可区分性就在这里。
  if (r.hostPidBefore === null || r.hostPidAfter === null) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: "host pid could not be read before/after the stop" };
  }
  if (r.hostPidBefore !== r.hostPidAfter) {
    return {
      ok: false,
      verdict: "HOST-CHANGED",
      reason: `host pid changed ${r.hostPidBefore} → ${r.hostPidAfter}: the host was replaced, so this is a whole-process restart, not a partial stop (§6.9 不变式 2)`,
    };
  }
  if (r.hostAliveAfter !== true) {
    return {
      ok: false,
      verdict: "HOST-CHANGED",
      reason: `host pid ${r.hostPidAfter} is NOT alive after the stop — the process was killed (or exited), which is the whole-process replacement this AC must be distinguishable from (§6.9 不变式 2)`,
    };
  }
  if (r.webReachableAfter !== false) {
    return { ok: false, verdict: "WEB-STILL-UP", reason: "web is still reachable after `stop --only web` — nothing was stopped" };
  }
  // (c) `control` 必须仍然可达 —— 它就在同一个宿主进程里。若它也不可达，那正是「波及其他服务」。
  if (r.controlReachableAfter !== true) {
    return {
      ok: false,
      verdict: "CONTROL-DOWN",
      reason: "the control face of the SAME host is not reachable after the partial stop — the stop took other services with it (§6.9 不变式 2)",
    };
  }
  if (!isIsoInstant(r.at)) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: `'at' is not an ISO-8601 instant: ${JSON.stringify(r.at)}` };
  }

  // (d) 六个 kind 必须都在，且逐 kind 前后同 run、round 严格推进、类型是整数。
  const beforeByKind = new Map(r.before.map((x) => [x.kind, x]));
  const afterByKind = new Map(r.after.map((x) => [x.kind, x]));
  const missing = KIND_NAMES.filter((k) => !beforeByKind.has(k) || !afterByKind.has(k));
  if (missing.length > 0) {
    return { ok: false, verdict: "NOT-EVALUATED", reason: `no usable round reading for kind(s): ${missing.join(", ")}` };
  }
  for (const kind of KIND_NAMES) {
    const b = beforeByKind.get(kind) as RoundReading;
    const a = afterByKind.get(kind) as RoundReading;
    if (typeof b.round !== "number" || !Number.isInteger(b.round) || typeof a.round !== "number" || !Number.isInteger(a.round)) {
      return {
        ok: false,
        verdict: "TYPE-INVALID",
        reason: `kind ${kind}: round must be an INTEGER (got before=${JSON.stringify(b.round)} [${b.roundRawType}], after=${JSON.stringify(a.round)} [${a.roundRawType}]) — the criterion's isinstance(b,int) would fail`,
      };
    }
    if (b.runId === "" || a.runId === "") {
      return { ok: false, verdict: "NOT-EVALUATED", reason: `kind ${kind}: run_id could not be read` };
    }
    if (b.runId !== a.runId) {
      return {
        ok: false,
        verdict: "RUN-MISMATCH",
        reason: `kind ${kind}: before run_id ${b.runId} ≠ after run_id ${a.runId} — the driver restarted inside the window, so a round-advance was never observed (前后不同 run 控制 c)`,
      };
    }
    if (a.round <= b.round) {
      return {
        ok: false,
        verdict: "NO-PROGRESS",
        reason: `kind ${kind}: round did not advance (${b.round} → ${a.round}) within the window — measured, and the answer is "no advance" (零推进控制 d; ⛔ distinct from "not measured")`,
      };
    }
  }

  const roundsBefore: Record<string, number> = {};
  const roundsAfter: Record<string, number> = {};
  const runIds: Record<string, string> = {};
  const carriers: Record<string, string> = {};
  let sumBefore = 0;
  let sumAfter = 0;
  for (const kind of KIND_NAMES) {
    const b = beforeByKind.get(kind) as RoundReading;
    const a = afterByKind.get(kind) as RoundReading;
    roundsBefore[kind] = b.round;
    roundsAfter[kind] = a.round;
    runIds[kind] = b.runId;
    carriers[kind] = b.carrier;
    sumBefore += b.round;
    sumAfter += a.round;
  }

  return {
    ok: true,
    verdict: "OK",
    reason: `partial stop of 'web' observed on host pid ${r.hostPidBefore}; all ${KIND_NAMES.length} kinds advanced within one run_id each`,
    record: {
      // ── 判据逐字读的字段（⛔ 名字与类型都是契约，不是风格）──────────────────────────────
      ac: AC_ID,
      stopped_service: "web",
      // JSON `false`, never "false" / 0 — the criterion tests `is not False` in Python, where only
      // the JSON boolean survives as `False`.
      web_reachable_after: false,
      at: r.at,
      driver_round_before_by_kind: roundsBefore,
      driver_round_after_by_kind: roundsAfter,
      // ── 加强字段（判据不读，供人/后续交叉核对；⛔ 不是判据的一部分）────────────────────
      web_reachable_before: true,
      driver_run_id_by_kind: runIds,
      driver_carrier_by_kind: carriers,
      driver_round_before: sumBefore,
      driver_round_after: sumAfter,
      driver_round_sum_definition: "point-in-time sum of the six kinds' round counters (the per-kind dicts above are the criterion's reading)",
      driver_kinds_alive_after: KIND_NAMES.slice(),
      driver_kinds_alive_after_source: "round-heartbeat freshness (last round record per kind), NOT pid-file existence",
      host_pid_before: r.hostPidBefore,
      host_pid_after: r.hostPidAfter,
      control_reachable_after: true,
      stopped_via: r.stoppedVia,
      stopped_argv: r.stoppedArgv,
      stopped_exit: r.stoppedExit,
      stopped_stdout: r.stoppedStdout,
      ts: new Date().toISOString(),
    },
  };
}

// ── 独立探针（⛔ 不复用产品里的 probe*：验证器与被验证者不共用仪器）──────────────────────────────

/** `GET /health` on the web face: HTTP 200 AND a JSON body with `ok:true`. Any transport failure,
 *  non-200, or non-JSON body is "not reachable" — for a boolean reachability reading the
 *  conservative direction is `false` (we did not see the face answer), and the producer's OTHER
 *  branch (before=false ⇒ NOT-EVALUATED) is what keeps that from being read as a stop. */
export async function webReachable(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${probeHost(host)}:${port}/health`, { signal: ctl.signal });
    if (res.status !== 200) return false;
    const body = (await res.json()) as { ok?: unknown };
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** `POST initialize` on the control face: a JSON-RPC frame (plain JSON or an SSE `data:` line) is
 *  the reading. ⛔ A JSON-RPC ERROR frame counts too — it still proves a JSON-RPC peer answered. */
export async function controlReachable(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${probeHost(host)}:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ac254-verify", version: "1" } },
      }),
      signal: ctl.signal,
    });
    const text = await res.text();
    const candidates: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^data:\s*(.+)$/.exec(line);
      if (m) candidates.push(m[1]);
    }
    candidates.push(text);
    return candidates.some((c) => {
      try {
        const j = JSON.parse(c) as { jsonrpc?: unknown };
        return typeof j?.jsonrpc === "string";
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function probeHost(host: string): string {
  return host === "0.0.0.0" || host === "::" || host === "*" || host === "" ? "127.0.0.1" : host;
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

interface ServerCarrier {
  pid: number;
  services: Array<{ name: string; host: string; port: number; up?: boolean }>;
}

function readServerCarrier(root: string): ServerCarrier | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, SERVER_STATE_REL), "utf8")) as ServerCarrier;
    if (!j || !Array.isArray(j.services) || !Number.isInteger(j.pid)) return null;
    return j;
  } catch {
    return null;
  }
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The ts key per kind (quality's verdict carrier uses `judgedAt`) — read from the kernel registry. */
function tsKeyFor(kind: string): string {
  const spec = DRIVER_KINDS[kind as keyof typeof DRIVER_KINDS] as { tsKey?: string } | undefined;
  return spec?.tsKey ?? "ts";
}

function resolveCliPath(explicit: string | undefined): string | null {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  // Default: the Core CLI of the checkout this script lives in (`<repo>/plugin/scripts/…`).
  const repoRoot = path.resolve(SCRIPT_DIR, "..", "..");
  const devEntry = path.join(repoRoot, "packages", "quay", "bin", "quay.ts");
  return fs.existsSync(devEntry) ? devEntry : null;
}

function runCli(cli: string, args: string[], cwd: string): { argv: string[]; exit: number; stdout: string; stderr: string } {
  const stripTypes = cli.endsWith(".ts") ? ["--experimental-strip-types"] : [];
  const argv = [process.execPath, "--no-warnings", ...stripTypes, cli, ...args];
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", timeout: 180000 });
  return { argv, exit: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function out(json: boolean, doc: Record<string, unknown>): void {
  if (json) process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
  else {
    const parts = Object.entries(doc)
      .filter(([, v]) => typeof v !== "object")
      .map(([k, v]) => `${k}=${String(v)}`);
    process.stdout.write(parts.join(" ") + "\n");
    for (const [k, v] of Object.entries(doc)) {
      if (v && typeof v === "object") process.stdout.write(`  ${k}: ${JSON.stringify(v)}\n`);
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const valueOf = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const root = path.resolve(valueOf("root") ?? process.cwd());
  const control = valueOf("control");
  const windowMs = Number(valueOf("window-ms") ?? "900000");
  const cli = resolveCliPath(valueOf("cli"));
  if (cli === null) {
    out(json, { ac: AC_ID, verdict: "USAGE", reason: "cannot locate the Core CLI entry — pass --cli <path/to/quay.ts|quay.js>" });
    return 3;
  }
  if (!/^\d+$/.test(String(windowMs)) || windowMs <= 0) {
    out(json, { ac: AC_ID, verdict: "USAGE", reason: `--window-ms must be a positive integer (got ${JSON.stringify(valueOf("window-ms"))})` });
    return 3;
  }

  // ── ① 确保统一 server 在跑（幂等；CLI 会报 already-running 而不会重启）─────────────────────────
  if (control !== "no-host") {
    // `--port 0`: the kernel picks an ephemeral port for the verifier's own unified host. ⛔ This is
    // not cosmetic — a workspace typically ALREADY has a `quay serve` on the default port, and a
    // second host that cannot bind publishes no carrier, which would read as "no unified server"
    // (a port collision masquerading as a missing capability). `--port` is ignored when a live host
    // already exists, so this only affects the spawn.
    const started = runCli(cli, ["server", "start", "--only", "web,control", "--port", "0", "--json", "--root", root], root);
    const carrier = readServerCarrier(root);
    if (!carrier || !pidAlive(carrier.pid)) {
      out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: "no live unified server host after `server start`", start_stdout: started.stdout, start_stderr: started.stderr, start_exit: started.exit });
      return 2;
    }
  }

  let carrier = readServerCarrier(root);
  if (!carrier) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: `no ${SERVER_STATE_REL} in ${root}` });
    return 2;
  }
  const webEntry = carrier.services.find((s) => s.name === "web");
  const controlEntry = carrier.services.find((s) => s.name === "control");
  if (!webEntry || !controlEntry) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: "the carrier does not host both web and control — not the unified form" });
    return 2;
  }
  const hostPidBefore = carrier.pid;

  // ── ② before：web 必须真的可达（空转控制 a）─────────────────────────────────────────────────
  const webReachableBefore = await webReachable(webEntry.host, webEntry.port);
  const at = new Date().toISOString(); // the EARLIEST observation instant — see StopReadings.at
  if (webReachableBefore !== true) {
    out(json, {
      ac: AC_ID,
      verdict: "NOT-EVALUATED",
      reason: `web was not reachable BEFORE the stop (http://${probeHost(webEntry.host)}:${webEntry.port}/health) — the 'unreachable after' reading would be vacuous`,
    });
    return 2;
  }

  // ── ③ 六个 kind 的 before 读数（直接量：round 载体末行）──────────────────────────────────────
  const carrierMap = roundCarrierMap();
  const before: RoundReading[] = [];
  const unreadable: string[] = [];
  for (const kind of KIND_NAMES) {
    const name = carrierMap[kind];
    const reading = name ? readKind(root, kind, name, tsKeyFor(kind)) : null;
    if (reading) before.push(reading);
    else unreadable.push(`${kind}${name ? "" : " (no round carrier declared)"}`);
  }
  if (unreadable.length > 0) {
    out(json, { ac: AC_ID, verdict: "NOT-EVALUATED", reason: `no usable before reading for kind(s): ${unreadable.join(", ")}` });
    return 2;
  }

  // ── ④ 执行部分停止（或结构性控制：杀掉宿主）─────────────────────────────────────────────────
  let stop: { argv: string[]; exit: number; stdout: string; stderr: string };
  let stoppedVia: string;
  if (control === "kill-host") {
    // STRUCTURAL CONTROL (AC5): the whole-process replacement. The producer must REFUSE.
    try {
      process.kill(hostPidBefore, "SIGKILL");
    } catch {
      /* already gone */
    }
    await sleep(500);
    stop = { argv: ["<internal>", "SIGKILL", String(hostPidBefore)], exit: 0, stdout: "", stderr: "" };
    stoppedVia = "SIGKILL <host pid> (structural control: whole-process replacement, NOT a partial stop)";
  } else {
    stop = runCli(cli, ["server", "stop", "--only", "web", "--json", "--root", root], root);
    stoppedVia = `${cli} server stop --only web --json --root ${root}`;
  }

  // ── ⑤ after：web 不可达 ∧ host pid 不变 ∧ control 仍可达 ────────────────────────────────────
  carrier = readServerCarrier(root) ?? carrier;
  const hostPidAfter = carrier.pid;
  const webReachableAfter = await webReachable(webEntry.host, webEntry.port);
  const controlReachableAfter = await controlReachable(controlEntry.host, controlEntry.port);
  const hostPidAfterLive = pidAlive(hostPidAfter);

  // ── ⑥ 等到六个 kind 各自在【同一 run_id】上推进 ─────────────────────────────────────────────
  const after: RoundReading[] = [];
  let waited = 0;
  for (;;) {
    after.length = 0;
    for (const kind of KIND_NAMES) {
      const name = carrierMap[kind];
      const reading = name ? readKind(root, kind, name, tsKeyFor(kind)) : null;
      if (reading) after.push(reading);
    }
    const beforeByKind = new Map(before.map((b) => [b.kind, b]));
    const progressed = after.length === KIND_NAMES.length && after.every((a) => {
      const b = beforeByKind.get(a.kind);
      return b !== undefined && a.runId === b.runId && a.round > b.round;
    });
    if (progressed) break;
    if (waited >= windowMs) break;
    // ⛔ If the host died (or a driver restarted, run_id changed), no amount of waiting produces a
    // qualifying record — stop early instead of burning the whole window on a known-bad run.
    if (!pidAlive(hostPidAfter) || (control !== "kill-host" && !hostPidAfterLive)) break;
    await sleep(5000);
    waited += 5000;
  }

  const readings: StopReadings = {
    hostPidBefore,
    hostPidAfter,
    hostAliveAfter: hostPidAfterLive,
    webReachableBefore,
    webReachableAfter,
    controlReachableAfter,
    at,
    before,
    after,
    stoppedVia,
    stoppedArgv: stop.argv,
    stoppedExit: stop.exit,
    stoppedStdout: (stop.stdout || "").trim().slice(0, 4000),
  };
  const built = buildRecord(readings);

  // ── ⑦ 合格才写；⛔ 不合格 ⇒ 零记录 + 可区分 verdict + 非 0 ─────────────────────────────────
  if (!built.ok) {
    out(json, {
      ac: AC_ID,
      verdict: built.verdict,
      reason: built.reason,
      record_written: false,
      readings: {
        host_pid_before: hostPidBefore,
        host_pid_after: hostPidAfter,
        host_alive_after: hostPidAfterLive,
        web_reachable_before: webReachableBefore,
        web_reachable_after: webReachableAfter,
        control_reachable_after: controlReachableAfter,
        waited_ms: waited,
        stop_exit: stop.exit,
        stop_stdout: (stop.stdout || "").trim().slice(0, 2000),
      },
    });
    return built.verdict === "NOT-EVALUATED" ? 2 : 1;
  }

  // ⛔ Restore web BEFORE writing the record: the record claims a stopped-then-restorable service,
  // and leaving the production observation face down is forbidden (AC-254 DoD).
  const restored = runCli(cli, ["server", "start", "--only", "web", "--json", "--root", root], root);
  const webBack = await webReachable(webEntry.host, webEntry.port);
  const record = { ...(built.record as Record<string, unknown>), web_restored: webBack, web_restore_argv: restored.argv };

  if (webBack !== true) {
    out(json, {
      ac: AC_ID,
      verdict: "NOT-EVALUATED",
      reason: "web did NOT come back after the partial stop — refusing to record, the production observation face must not be left down",
      restore_stdout: restored.stdout,
    });
    return 2;
  }

  const carrierPath = path.join(root, CARRIER_REL);
  fs.mkdirSync(path.dirname(carrierPath), { recursive: true });
  fs.appendFileSync(carrierPath, JSON.stringify(record) + "\n");
  out(json, {
    ac: AC_ID,
    verdict: "OK",
    record_written: true,
    carrier: CARRIER_REL,
    workspace_root: root,
    host_pid: hostPidBefore,
    web_port: webEntry.port,
    control_port: controlEntry.port,
    waited_ms: waited,
    web_restored: webBack,
    record,
  });
  return 0;
}

// Direct-entry guard — the repo's name-based convention (gate-script-base.ts's isDirectEntry is
// REQUIRED to be name-based: under bundling every inlined module shares one `import.meta.url`, so a
// URL comparison fires for libraries too — the 2026-09-13 incident where three bundled drivers all
// executed the first inlined library's main).
if (isDirectEntry(import.meta, undefined, "server-partial-stop-verify")) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
