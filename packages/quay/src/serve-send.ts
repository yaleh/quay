// serve-send.ts — /send handler + the shared cross-session message-delivery protocol.
//
// gap-webui-message-delivery-entry. The socket WIRE FORMAT (auth frame + user frame over the Claude
// Code unix-socket messaging endpoint) is composed in sendSessionFrames here and delivered by the
// shared `deliver()` primitive — ONE implementation that the diagnostic script reuses (AC1: 两份实现
// ⇒ 假), not a copy pasted into the web layer. gap-ac253-session-primitives-shared-layer-adoption
// moved the socket itself (connect / write / rejection detection / ledger) into
// packages/quay/src/primitives/delivery-audit.mjs, so this module no longer opens one. The web send
// entry reports a REAL delivery state (AC2),
// because `success:true` on a fire-and-forget socket write ≠ delivered (SPEC-web-session-observability
// §7.3: the real state machine is 已发送 → held(待批准) → expired(到期未批准,丢弃) | 已批准 → 送达).
//
// gap-delivery-status-two-parallel-implementations: the delivery STATE is now VERIFIED, not predicted.
// The former `deliveryStateFor(settings)` predicted "delivered" from the recipient's permission
// settings — a SECOND, unrelated definition of the same word that plugin/scripts/transcript-delivery-
// check.ts already defines (materialization in the target transcript). That prediction is REMOVED; the
// single judgment source is now transcript-delivery-check.ts's three-state verdict (delivered/failed/
// unknown), read here by SHELLING OUT to its CLI (`--check <transcript> --text <message>`) — the
// observation.ts readBoardLanding subprocess pattern — so `packages/quay/src` keeps its zero-plugin-
// import boundary (⛔ import plugin/ ⇒ 假).
//
// The four states the response can display (§7.3):
//   delivered — 已在目标 transcript 物化核证（transcript-delivery-check.ts 判定 delivered）。
//   held      — 已发送但 transcript 尚未物化（待确认/待批准）；到期仍未物化 ⇒ expired。
//   expired   — 一条 held 回执超过窗口仍未物化（收据在响应里被 classifyReceipt 折算出来）。
//   error     — 无法解析目标会话 / socket 连接写入失败 / transcript 判 failed（丢弃证据）。
//
// 因 socket 无 ack，`delivered` 只能【核证】不能【预测】——本模块在发送后 shell 出
// transcript-delivery-check.ts 读目标 transcript 取真实判定；`expired` 仍由一条 held 回执随时间折算
// ——本模块把回执落盘（`message-receipts.jsonl`），响应据此显示 held→expired 的完整路径（SPEC §7.3）。

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isValidSessionId, sessionTranscriptPath } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome } from "./serve-render.ts";
import { resolvePluginScriptExec } from "./plugin-root.ts";
// Shared session read/write primitives — the socket delivery lanes (L1 message / L2 keys) and the
// input-face audit ledger each exist exactly ONCE in this repo, byte-identical to the pinned
// quay-fleet blob (packages/quay/src/primitives/PROVENANCE.md; re-checked by
// plugin/scripts/primitives-drift-check.ts).
//
// ⛔ This module NEVER opens a socket of its own — no `node:net` import survives here at all
// (AC-253's strengthened criterion retires the hand-written duplicate in serve-send.ts /
// observation.ts as a SPEC §8-1 「只有一份实现」violation). The connect / write / rejection-detection
// / ledger mechanics are `deliver` (L1) and `deliverKeys` (L2); what stays here is only THIS repo's
// orchestration — which frames to compose, where the ledger goes, and how an outcome maps onto the
// delivery vocabulary.
import { appendAuditRecord, deliver, deliverKeys, summarizePayload } from "./primitives/delivery-audit.mjs";

const execFileP = promisify(execFile);

// ── Delivery states ────────────────────────────────────────────────────────────────────────────────

export type DeliveryState = "delivered" | "held" | "expired" | "error";

/** A persisted delivery receipt — the state at send time; `expired` is DERIVED, never stored. */
export interface MessageReceipt {
  sessionId: string;
  name: string | null;
  message: string;
  state: "delivered" | "held" | "error";
  sentAtMs: number;
  /**
   * The payload SUMMARY (`{length, sha256_12, firstLine}`, from the shared `summarizePayload`) —
   * the audit-ledger discipline of never reducing a delivery record to "it worked": the summary is
   * cheap, correlatable, and bounded, and it is what makes a receipt comparable across attempts.
   * Optional because pre-existing readers/fixtures construct receipts without it; a missing summary
   * degrades to `undefined`, never to a fabricated one (硬规则 6: 缺值 = 未查).
   */
  payloadSummary?: { length: number; sha256_12: string; firstLine: string };
}

/** How long a held message waits for approval before it is reported expired. Matches the platform's
 *  held→expired approval window (§7.3); injectable for tests so held→expired is observed without sleep. */
export const HELD_EXPIRY_MS = 5 * 60 * 1000;

/** Receipt filename, relative to the caller-supplied receipt dir (handleSend uses `<root>/.quay/`). */
export const MESSAGE_RECEIPTS_FILENAME = "message-receipts.jsonl";

/** The from-name stamped on web-injected messages. The recipient can see the message is quay-web-
 *  injected (SPEC §7.3 安全注记: 如实显示「由 quay web 注入」，不冒充平台验证过的身份). */
export const WEB_SEND_FROM_NAME = "quay-web";

// ── Shared socket protocol (composed here, delivered by the shared L1 lane) ────────────────────────

/** Default L1 delivery ledger for callers with no workspace to put one in. This module is a library
 *  and cannot invent a workspace root — a caller that HAS one (sendToSession passes
 *  `<receiptDir>/session-send-audit.jsonl`) should always supply it, so the delivery record lands
 *  next to the receipts it corroborates instead of in the OS temp dir. */
const DEFAULT_SEND_AUDIT_PATH = path.join(os.tmpdir(), "quay-session-send-audit.jsonl");

/**
 * Deliver one message over the Claude Code cross-session socket: the auth frame
 * ({"type":"auth","token":…}) then the user frame (a <cross-session-message …> wrapper). This is the
 * SAME wire format plugin/scripts/send-to-session.ts writes (auth frame first, then the user frame),
 * shared so the diagnostic script and the web entry can never drift (AC1).
 *
 * The connect/write/ledger mechanics are NOT here — they are `deliver()` in the shared
 * `primitives/delivery-audit.mjs`, the repo's ONE socket-delivery implementation (AC-253 / SPEC §8-1).
 * The socket is fire-and-forget (returns 0 bytes, no ack) — resolving `ok:true` means connect+write
 * succeeded, NOT that the message was consumed; delivery is VERIFIED by the target transcript (see
 * verifyTranscriptDelivery), never by this return.
 */
export function sendSessionFrames(opts: {
  sockPath: string;
  token: string;
  text: string;
  fromName: string;
  /** L1 ledger path (see DEFAULT_SEND_AUDIT_PATH). Records BOTH success and failure — the shared
   *  `deliver` contract, because "only recording successes" is not an audit trail. */
  auditLogPath?: string;
}): Promise<{ ok: boolean; reason: string | null }> {
  // ① auth 帧（文档明写：第一行）② 消息帧（2026-08-15 实测到达的格式；from 沿用脚本的
  // `uds:${sockPath}` 线格式）。Two newline-terminated JSON frames in ONE payload — the same bytes
  // the previous hand-written two-write version put on the wire (serve-handlers.test.mjs pins them).
  const authFrame = JSON.stringify({ type: "auth", token: opts.token });
  const userFrame = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: `<cross-session-message from="uds:${opts.sockPath}" from-name="${opts.fromName}" from-mode="bypass">\n${opts.text}\n</cross-session-message>`,
    },
  });
  return deliver({
    level: "L1",
    who: opts.fromName,
    target: opts.sockPath,
    socketPath: opts.sockPath,
    payload: `${authFrame}\n${userFrame}\n`,
    auditLogPath: opts.auditLogPath ?? DEFAULT_SEND_AUDIT_PATH,
  }).then((record) => ({
    ok: record["delivered"] === true,
    reason: typeof record["error"] === "string" ? record["error"] : null,
  }));
}

// ── Delivery-state determination (VERIFIED via the single judgment source) ─────────────────────────

/** The transcript-delivery-check.ts three-state verdict — the SINGLE source of truth for "did the
 *  message materialize in the target transcript" (plugin/scripts/transcript-delivery-check.ts). */
export type TranscriptVerdictState = "delivered" | "failed" | "unknown";

/**
 * Fold a transcript verdict into serve-send's delivery vocabulary. The core word `delivered` now
 * means the SAME thing in both paths (materialized in the target transcript — a VERIFICATION), never
 * a settings prediction. Pure + falsifiable (gap-delivery-status-two-parallel-implementations AC1/AC2).
 */
export function verdictStateToDeliveryState(verdict: TranscriptVerdictState): "delivered" | "held" | "error" {
  switch (verdict) {
    case "delivered": return "delivered"; // verified materialization
    case "failed": return "error";        // clear discard evidence (enqueue→remove, never materialized)
    default: return "held";               // unknown — sent, not yet materialized (待确认/待批准)
  }
}

const TRANSCRIPT_CHECK_TIMEOUT_MS = 5_000;

/** Resolve the transcript-delivery-check CLI via the canonical resolver (SPEC §6b — never a module-
 *  relative `import.meta.url` walk-up without a worktree check). The dev `.ts` runs with
 *  --experimental-strip-types; the shipped dist bundle (a plain ESM `.js`) runs without the flag.
 *  Absent in both forms ⇒ null (the caller then reports "unknown" — never a fabricated "delivered"). */
function resolveTranscriptChecker(): { scriptPath: string; stripTypes: boolean } | null {
  const r = resolvePluginScriptExec(path.join("scripts", "transcript-delivery-check.ts"));
  return r ? { scriptPath: r.path, stripTypes: r.stripTypes } : null;
}

/**
 * Verify delivery of `message` to `sessionId` by shelling out to transcript-delivery-check.ts
 * (`--check <transcript> --text <message>`) — the SINGLE source for "did it materialize". ⛔ No import
 * of plugin/ (the architecture boundary holds); the subprocess read is the readBoardLanding pattern.
 * Any failure to verify (checker/transcript missing, spawn/parse/timeout error) returns "unknown" —
 * never a fabricated "delivered". `checkerPath` is a test seam (defaults to the real CLI).
 */
export async function verifyTranscriptDelivery(opts: {
  root: string;
  sessionId: string;
  message: string;
  home: string;
  checkerPath?: string | null;
}): Promise<TranscriptVerdictState> {
  const transcriptPath = sessionTranscriptPath(opts.root, opts.sessionId, opts.home);
  if (transcriptPath == null) return "unknown";
  let scriptPath: string;
  let stripTypes: boolean;
  if (opts.checkerPath) {
    scriptPath = opts.checkerPath;
    stripTypes = scriptPath.endsWith(".ts");
  } else {
    const resolved = resolveTranscriptChecker();
    if (resolved == null) return "unknown";
    scriptPath = resolved.scriptPath;
    stripTypes = resolved.stripTypes;
  }
  const argv = stripTypes
    ? ["--experimental-strip-types", scriptPath, "--check", transcriptPath, "--text", opts.message]
    : [scriptPath, "--check", transcriptPath, "--text", opts.message];
  try {
    const { stdout } = await execFileP("node", argv, {
      timeout: TRANSCRIPT_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    const m = /^state: (delivered|failed|unknown)$/m.exec(stdout);
    if (m) return m[1] as TranscriptVerdictState;
    return "unknown";
  } catch {
    return "unknown"; // spawn/parse/timeout ⇒ can't verify ⇒ honest pending, never "delivered"
  }
}

// ── Session-endpoint resolution (sessionId → socket + token) ──────────────────────────────────────

export interface SessionEndpoint {
  pid: number;
  sockPath: string;
  token: string;
  name: string | null;
}

/**
 * Resolve a sessionId to its live messaging endpoint by scanning the `~/.claude/sessions/<pid>.json`
 * registry (the same source liveSessionIdForPid reads, in reverse): find the record whose `sessionId`
 * matches, take its `messagingSocketPath`, and read the peerToken from `<pid>.*.key`. sessionId is a
 * strict UUID look-up key (never a path component); a non-UUID/absent/unreadable record ⇒ null (the
 * caller then renders an honest 「未找到」 error, never a disk read on an arbitrary path — §7.4).
 * `home` is injectable for tests; defaults to the real `$HOME`.
 */
export function resolveSessionEndpoint(sessionId: string, home: string = os.homedir()): SessionEndpoint | null {
  if (!isValidSessionId(sessionId)) return null;
  const dir = path.join(home, ".claude", "sessions");
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const pidStr = entry.slice(0, -".json".length);
    if (!/^\d+$/.test(pidStr)) continue; // pid is numeric (the registry filename), never a path component
    let j: Record<string, unknown>;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8")); } catch { continue; }
    if (j.sessionId !== sessionId) continue;
    const sockPath = typeof j.messagingSocketPath === "string" ? j.messagingSocketPath : "";
    const name = typeof j.name === "string" && j.name.length > 0 ? j.name : null;
    if (!sockPath) return null; // registered but no socket ⇒ not sendable
    let token: string | null = null;
    try {
      const keyFile = fs.readdirSync(dir).find((f) => f.startsWith(`${pidStr}.`) && f.endsWith(".key"));
      if (keyFile) {
        const keyJson = JSON.parse(fs.readFileSync(path.join(dir, keyFile), "utf8")) as Record<string, unknown>;
        token = typeof keyJson.peerToken === "string" ? keyJson.peerToken : null;
      }
    } catch {
      token = null;
    }
    if (!token) return null; // no peerToken ⇒ cannot authenticate to the target
    return { pid: Number.parseInt(pidStr, 10), sockPath, token, name };
  }
  return null;
}

// ── Receipt store (held→expired observability) ─────────────────────────────────────────────────────

/** Append one receipt to `<dir>/message-receipts.jsonl`. Never throws — receipt persistence must never
 *  break the send itself (the send already happened; the receipt is the honest record of it).
 *
 *  The WRITE itself goes through the shared `appendAuditRecord` (primitives/delivery-audit.mjs), so
 *  there is exactly one implementation of "append one JSON line to a delivery ledger" in this repo.
 *  The JSON object written is unchanged byte-for-byte — the shared helper is the same
 *  `mkdirSync(dirname)` + `appendFileSync(JSON.stringify(record) + "\n")` pair, so every existing
 *  reader of `message-receipts.jsonl` keeps working (⛔ this is a re-implementation swap, not a
 *  format change — see the task result's "journal format" decision).
 */
export function appendMessageReceipt(dir: string, receipt: MessageReceipt): void {
  try {
    appendAuditRecord(path.join(dir, MESSAGE_RECEIPTS_FILENAME), receipt);
  } catch {
    // best-effort only
  }
}

/** Read all receipts from `<dir>/message-receipts.jsonl`, newest-first. sessionId non-null filters to
 *  one session. Absent/unreadable ⇒ []. Skips malformed lines (a corrupt line never crashes the page). */
export function readMessageReceipts(dir: string, sessionId: string | null = null): MessageReceipt[] {
  let text: string;
  try { text = fs.readFileSync(path.join(dir, MESSAGE_RECEIPTS_FILENAME), "utf8"); } catch { return []; }
  const out: MessageReceipt[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o: unknown;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const r = o as Record<string, unknown>;
    const sid = typeof r.sessionId === "string" ? r.sessionId : "";
    if (sessionId != null && sid !== sessionId) continue;
    const state = r.state;
    if (state !== "delivered" && state !== "held" && state !== "error") continue;
    out.push({
      sessionId: sid,
      name: typeof r.name === "string" ? r.name : null,
      message: typeof r.message === "string" ? r.message : "",
      state,
      sentAtMs: typeof r.sentAtMs === "number" && Number.isFinite(r.sentAtMs) ? r.sentAtMs : 0,
    });
  }
  out.sort((a, b) => b.sentAtMs - a.sentAtMs);
  return out;
}

/**
 * Fold a receipt into its CURRENT delivery state: a held receipt whose age ≥ ttlMs becomes `expired`
 * (the held→expired path — §7.3); delivered/error receipts are stable. Pure and injectable-clock, so
 * held→expired is observable without sleeping. `expired` is DERIVED here, never stored.
 */
export function classifyReceipt(receipt: MessageReceipt, nowMs: number, ttlMs: number = HELD_EXPIRY_MS): DeliveryState {
  if (receipt.state === "held" && nowMs - receipt.sentAtMs >= ttlMs) return "expired";
  return receipt.state;
}

// ── Orchestration ──────────────────────────────────────────────────────────────────────────────────

export interface SendOutcome {
  state: DeliveryState;
  detail: string;
  sessionId: string;
  name: string | null;
  message: string;
}

export interface SendToSessionOpts {
  sessionId: string;
  message: string;
  /** Registry home (test seam). Defaults to the real $HOME. */
  home?: string;
  /** Workspace root — resolves the target transcript path + the checker subprocess cwd. */
  root?: string;
  /** Override the resolved endpoint (test seam). null/undefined ⇒ resolve from the registry. */
  endpoint?: SessionEndpoint | null;
  /** Injectable verdict state (test seam). null/undefined ⇒ verify via the transcript checker. */
  verdict?: TranscriptVerdictState | null;
  /** Injectable checker path (test seam). Defaults to transcript-delivery-check.ts / its dist bundle. */
  checkerPath?: string | null;
  /** Injectable clock (test seam) for the receipt sentAtMs. */
  nowMs?: number;
  /** Receipt dir; a string appends a receipt, null/undefined persists nothing (pure). */
  receiptDir?: string | null;
}

/** State → display label (Chinese, matching SPEC §7.3's 「待对方批准 / 已送达 / 到期未批准」). */
export function deliveryStateLabel(state: DeliveryState): string {
  switch (state) {
    case "delivered": return "已送达";
    case "held": return "待对方批准";
    case "expired": return "到期未批准（未送达）";
    case "error": return "投递失败";
  }
}

/**
 * The full send: validate sessionId (UUID look-up key, never a path) → resolve the live endpoint →
 * write the frames → VERIFY delivery against the target transcript (the single judgment source) →
 * record a receipt. The returned state is the honest four-state delivery result: `error`
 * (unresolvable / socket write failed / transcript judged "failed"), `delivered` (verified
 * materialization in the target transcript), or `held` (sent but not yet materialized — will
 * `expire` if it never materializes). An unverifiable outcome maps to `held`, never `delivered`
 * (⛔ 不得在拿不到物化证据时声称已送达 — gap-delivery-status-two-parallel-implementations AC1).
 */
export async function sendToSession(opts: SendToSessionOpts): Promise<SendOutcome> {
  const home = opts.home ?? os.homedir();
  const sessionId = opts.sessionId;
  const message = (opts.message ?? "").trim();

  // The audit discipline the shared delivery-audit module exists to enforce: success and FAILURE
  // leave through the SAME write path. "Only recording successes" is not an audit trail — it is
  // exactly the gap the old tmux injection chain had. Every early return below persists its receipt
  // before returning, so a delivery that never reached the socket is still on the ledger.
  const payloadSummary = summarizePayload(message);
  const persist = (state: MessageReceipt["state"], name: string | null): void => {
    if (opts.receiptDir == null) return;
    appendMessageReceipt(opts.receiptDir, {
      sessionId,
      name,
      message,
      state,
      sentAtMs: opts.nowMs ?? Date.now(),
      payloadSummary,
    });
  };

  if (!isValidSessionId(sessionId)) {
    persist("error", null);
    return { state: "error", detail: `sessionId 非法（须为 UUID）：${sessionId}`, sessionId, name: null, message };
  }
  if (!message) {
    persist("error", null);
    return { state: "error", detail: "消息为空", sessionId, name: null, message };
  }

  const endpoint = opts.endpoint !== undefined ? opts.endpoint : resolveSessionEndpoint(sessionId, home);
  if (endpoint == null) {
    persist("error", null);
    return { state: "error", detail: "未找到目标会话（不在运行注册表，或已结束）", sessionId, name: null, message };
  }

  const sent = await sendSessionFrames({
    sockPath: endpoint.sockPath,
    token: endpoint.token,
    text: message,
    fromName: WEB_SEND_FROM_NAME,
    // The L1 delivery ledger lands beside the receipts it corroborates (both are this send's record);
    // no workspace ⇒ the shared default (OS temp dir). The record is written on FAILURE too — the
    // shared `deliver` contract this module adopted.
    auditLogPath: opts.receiptDir == null
      ? undefined
      : path.join(opts.receiptDir, "session-send-audit.jsonl"),
  });
  if (!sent.ok) {
    persist("error", endpoint.name);
    return { state: "error", detail: `连接/写入失败：${sent.reason ?? "unknown"}`, sessionId, name: endpoint.name, message };
  }

  const verdict: TranscriptVerdictState = opts.verdict !== undefined && opts.verdict !== null
    ? opts.verdict
    : await verifyTranscriptDelivery({
        root: opts.root ?? "",
        sessionId,
        message,
        home,
        checkerPath: opts.checkerPath,
      });
  const state = verdictStateToDeliveryState(verdict);

  const detail = state === "delivered"
    ? "已在目标 transcript 物化核证（与 fallback 核证同一判定源）"
    : state === "error"
      ? "消息被丢弃（enqueue 后未物化即 remove）"
      : "已发送，transcript 尚未物化（待确认/待批准）；到期仍未物化则 expired";

  persist(state === "delivered" ? "delivered" : state === "error" ? "error" : "held", endpoint.name);
  return { state, detail, sessionId, name: endpoint.name, message };
}

// ── L2 (raw keys / control-plane) delivery over a pty.sock ────────────────────────────────────────

export interface KeysDeliveryOutcome {
  /** True only when the DATA frame carrying `bytes` was flushed and no rejection arrived first. */
  delivered: boolean;
  /** Null on success; the rejection/timeout/connection reason otherwise. */
  error: string | null;
  /** Human-readable rejection tag when the peer answered with an explicit CTRL rejection. */
  rejectedAs: string | null;
}

/**
 * Deliver RAW TERMINAL BYTES to a session's pty socket — the L2/keys lane (fleet design §A.2).
 *
 * This is the control-plane path CLAUDE.md records as having no native equivalent: slash commands
 * like `/clear` cannot be delivered through the cross-session messaging socket, and the repo
 * forbids hand-rolled `tmux send-keys`. Bytes pass through UNMODIFIED — `0x03` (SIGINT) and every
 * other control byte are injected exactly as typed, never stripped or re-encoded.
 *
 * The WHOLE L2 protocol — pty.sock connect, the CTRL auth frame, the grace-window inference of "auth
 * accepted by absence", the DATA frame, the frame-codec decode of a rejection — lives in the shared
 * `deliverKeys()` (`primitives/delivery-audit.mjs`, the repo's ONE implementation, byte-identical to
 * the pinned quay-fleet blob). ⛔ This function opens NO socket of its own: AC-253's strengthened
 * criterion retires the hand-written duplicate (any own socket open here ⇒ SPEC §8-1 violated,
 * 「全仓只有一份」). What stays here is the repo's own mapping of `deliverKeys`' audit record onto
 * this module's `KeysDeliveryOutcome` vocabulary. `deliverKeys` appends a ledger record on EVERY
 * exit path — success, connection error, explicit auth rejection, and timeout — so a delivery
 * failure can never simply skip the ledger.
 */
export function sendKeysToSession(opts: {
  sockPath: string;
  authToken: string;
  bytes: Buffer | string;
  auditLogPath: string;
  who?: string;
  target?: string;
  timeoutMs?: number;
  /** How long to wait after the auth frame for an explicit rejection before sending DATA. */
  authGraceMs?: number;
}): Promise<KeysDeliveryOutcome> {
  return deliverKeys({
    who: opts.who ?? "quay-serve",
    target: opts.target ?? opts.sockPath,
    socketPath: opts.sockPath,
    authToken: opts.authToken,
    bytes: opts.bytes,
    auditLogPath: opts.auditLogPath,
    timeoutMs: opts.timeoutMs ?? 2000,
    authGraceMs: opts.authGraceMs ?? 50,
  }).then((record) => {
    const error = typeof record["error"] === "string" ? record["error"] : null;
    // `deliverKeys` reports an explicit auth rejection as `auth rejected: <tag>[(<message>)]`; the
    // tag is recovered here so the diagnostic CLI keeps printing `rejectedAs=` (its pre-delegation
    // shape). ⛔ Recovered from the shared record, never re-derived by a second socket read.
    const rejectedAs = error !== null && error.startsWith("auth rejected: ")
      ? (error.slice("auth rejected: ".length).split(/[\s(]/)[0] || null)
      : null;
    return { delivered: record["delivered"] === true, error, rejectedAs };
  });
}

// ── Rendering ──────────────────────────────────────────────────────────────────────────────────────

/** A badge + one-line reason for a delivery state, reusing the four-state label vocabulary. */
function stateBadge(state: DeliveryState): string {
  const color: Record<DeliveryState, string> = {
    delivered: "var(--color-accent-700)",
    held: "var(--color-warning-700, #b45309)",
    expired: "var(--color-danger-700, #b91c1c)",
    error: "var(--color-danger-700, #b91c1c)",
  };
  return html`<span style="font-weight:700;color:${color[state]}">${escapeHtml(deliveryStateLabel(state))}</span>`;
}

/** The send form for the /session page — plain HTML <form> POSTing to /send (zero client JS). */
export function renderSendForm(sessionId: string): string {
  return html`<section style="margin-top:1.5rem;background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:0.5rem">
    <h2>消息投递</h2>
    <p class="meta">向本会话注入一条跨会话消息（由 quay web 注入）。真实投递状态见回执：已送达 / 待对方批准 / 到期未批准（未送达）——⛔ 不以「已发送」冒充送达。</p>
    <form method="post" action="/send" style="display:flex;flex-direction:column;gap:0.5rem">
      <input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">
      <textarea name="message" rows="4" placeholder="消息内容…" style="font:inherit;padding:0.5rem"></textarea>
      <button type="submit" style="font:inherit;padding:0.4rem 0.8rem;cursor:pointer">发送</button>
    </form>
  </section>`;
}

/** The /send POST result page: the just-sent outcome + this session's receipt history (each folded
 *  through classifyReceipt so held→expired is observable in the response — AC2). */
export function renderSendResult(outcome: SendOutcome, receipts: MessageReceipt[], nowMs: number): string {
  const receiptRows = receipts.length > 0
    ? receipts.map((r) => {
        const state = classifyReceipt(r, nowMs);
        return html`<div style="border-left:2px solid var(--color-divider);padding-left:0.6rem;margin-bottom:0.5rem">
          <div style="display:flex;justify-content:space-between;gap:0.5rem;font-size:0.7rem;color:var(--color-neutral-700)">
            <span>${escapeHtml(new Date(r.sentAtMs).toISOString())} · ${escapeHtml(r.name ?? r.sessionId)}</span>
            ${stateBadge(state)}
          </div>
          <p style="font-size:0.8rem;line-height:1.4;margin:0.25rem 0 0;white-space:pre-wrap">${escapeHtml(r.message)}</p>
        </div>`;
      }).join("")
    : html`<p class="meta">本会话暂无投递回执</p>`;

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay message delivery — 投递状态">${modernistStyles()}${pageStyles()}<title>消息投递 — ${escapeHtml(outcome.sessionId)}</title></head>
    <body>${renderMobileChrome("sessions", "sessions")}${renderSiteNav("sessions")}<main id="main">
      <h1>消息投递 — <code>${escapeHtml(outcome.sessionId)}</code></h1>
      <p class="meta"><a href="/session/${escapeHtml(outcome.sessionId)}">← 返回会话</a> · 投递状态是【目标 transcript 物化核证】+ 回执折算，非 socket「写成功」</p>
      <section style="margin-bottom:1.5rem;background:var(--color-surface);padding:1rem">
        <h2>本次发送结果</h2>
        <div style="font-size:0.9rem;margin-bottom:0.5rem">${stateBadge(outcome.state)}</div>
        <p class="meta">${escapeHtml(outcome.detail)}</p>
        ${outcome.message ? html`<p style="white-space:pre-wrap;font-size:0.8rem;line-height:1.4">${escapeHtml(outcome.message)}</p>` : ""}
      </section>
      <h2>投递回执（旧→新，held 到期折算为 expired）</h2>
      ${receiptRows}
    </main></body></html>`;
}

// ── HTTP handler ───────────────────────────────────────────────────────────────────────────────────

/** Read a form-urlencoded POST body (no size cap beyond a sane guard). Never throws. */
function readFormBody(req: IncomingMessage): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= 1_000_000) chunks.push(c); // 1 MB guard — a message textarea never needs more
    });
    req.on("end", () => {
      const params = new Map<string, string>();
      for (const [k, v] of new URLSearchParams(Buffer.concat(chunks).toString("utf8"))) {
        params.set(k, v);
      }
      resolve(params);
    });
    req.on("error", () => resolve(new Map()));
  });
}

/**
 * POST /send — deliver a message to a local Claude Code session and render the honest four-state
 * result. The sessionId arrives in the form body (a UUID look-up key, never a path component —
 * §7.4). The receipt store lives at `<workspaceRoot>/.quay/` (gitignored, same home as gate-events).
 */
export async function handleSend(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  const params = await readFormBody(req);
  const sessionId = params.get("sessionId") ?? "";
  const message = params.get("message") ?? "";

  const receiptDir = path.join(cfg.workspaceRoot, ".quay");
  const outcome = await sendToSession({ sessionId, message, receiptDir, root: cfg.workspaceRoot });
  const receipts = readMessageReceipts(receiptDir, isValidSessionId(sessionId) ? sessionId : null);

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSendResult(outcome, receipts, Date.now()));
}
