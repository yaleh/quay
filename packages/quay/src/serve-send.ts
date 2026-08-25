// serve-send.ts — /send handler + the shared cross-session message-delivery protocol.
//
// gap-webui-message-delivery-entry. The socket protocol (auth frame + user frame over the Claude
// Code unix-socket messaging endpoint) is extracted from plugin/scripts/send-to-session.ts into
// sendSessionFrames here — ONE implementation that the diagnostic script reuses (AC1: 两份实现 ⇒ 假),
// not a copy pasted into the web layer. The web send entry reports a REAL delivery state (AC2),
// because `success:true` on a fire-and-forget socket write ≠ delivered (SPEC-web-session-observability
// §7.3: the real state machine is 已发送 → held(待批准) → expired(到期未批准,丢弃) | 已批准 → 送达).
//
// The four states the response can display (§7.3 / §10.1):
//   delivered — 接收方 settings 直通（permissions.defaultMode=bypassPermissions 或
//               crossSessionInbound:accept 任一）⇒ 送达并被消费。
//   held      — 两者皆无 ⇒ 待接收方批准；未经批准到期 ⇒ expired（未送达）。
//   expired   — 一条 held 回执超过批准窗口仍未批准（收据在响应里被 classifyReceipt 折算出来）。
//   error     — 无法解析目标会话 / socket 连接或写入失败。
//
// 决定变量是接收方 settings（§10.1 单变量对照结论），不是 socket 的 fire-and-forget「写成功」。
// 因 socket 无 ack，`delivered` 是【按接收方 settings 的确定性预测】，`held` 同理；`expired` 只能由
// 一条 held 回执随时间折算——故本模块把回执落盘（`message-receipts.jsonl`），响应据此显示 held→expired
// 的完整路径（SPEC §7.3 的「并保留回执」）。

import type { IncomingMessage, ServerResponse } from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidSessionId } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome } from "./serve-render.ts";

// ── Delivery states ────────────────────────────────────────────────────────────────────────────────

export type DeliveryState = "delivered" | "held" | "expired" | "error";

/** The recipient-settings pair that decides direct-delivery vs held (§10.1). */
export interface RecipientSettings {
  defaultMode: string | null;
  crossSessionInbound: string | null;
}

/** A persisted delivery receipt — the state at send time; `expired` is DERIVED, never stored. */
export interface MessageReceipt {
  sessionId: string;
  name: string | null;
  message: string;
  state: "delivered" | "held" | "error";
  sentAtMs: number;
}

/** How long a held message waits for approval before it is reported expired. Matches the platform's
 *  held→expired approval window (§7.3); injectable for tests so held→expired is observed without sleep. */
export const HELD_EXPIRY_MS = 5 * 60 * 1000;

/** Receipt filename, relative to the caller-supplied receipt dir (handleSend uses `<root>/.quay/`). */
export const MESSAGE_RECEIPTS_FILENAME = "message-receipts.jsonl";

/** The from-name stamped on web-injected messages. The recipient can see the message is quay-web-
 *  injected (SPEC §7.3 安全注记: 如实显示「由 quay web 注入」，不冒充平台验证过的身份). */
export const WEB_SEND_FROM_NAME = "quay-web";

// ── Shared socket protocol (extracted from plugin/scripts/send-to-session.ts) ──────────────────────

/**
 * Deliver one message over the Claude Code cross-session socket: connect → write the auth frame
 * ({"type":"auth","token":…}) then the user frame (a <cross-session-message …> wrapper). This is the
 * SAME wire format plugin/scripts/send-to-session.ts writes (auth frame first, then the user frame),
 * shared so the diagnostic script and the web entry can never drift (AC1). The socket is fire-and-
 * forget (returns 0 bytes, no ack) — resolving `ok:true` means connect+write succeeded, NOT that the
 * message was consumed; delivery is decided by the recipient's settings (§10.1), never by this return.
 */
export function sendSessionFrames(opts: {
  sockPath: string;
  token: string;
  text: string;
  fromName: string;
}): Promise<{ ok: boolean; reason: string | null }> {
  return new Promise((resolve) => {
    const { sockPath, token, text, fromName } = opts;
    let settled = false;
    const finish = (ok: boolean, reason: string | null): void => {
      if (settled) return;
      settled = true;
      resolve({ ok, reason });
    };

    const s = net.createConnection(sockPath);
    s.on("connect", () => {
      // ① auth 帧（文档明写：第一行）
      s.write(JSON.stringify({ type: "auth", token }) + "\n");
      // ② 消息帧（2026-08-15 实测到达的格式；from 沿用脚本的 `uds:${sockPath}` 线格式）
      const frame = {
        type: "user",
        message: {
          role: "user",
          content: `<cross-session-message from="uds:${sockPath}" from-name="${fromName}" from-mode="bypass">\n${text}\n</cross-session-message>`,
        },
      };
      s.write(JSON.stringify(frame) + "\n");
      // socket 无 ack（实测返回 0 字节）；给对端一个读窗口再关（与脚本同值，保持协议行为一致）
      setTimeout(() => {
        s.end();
        finish(true, null);
      }, 800);
    });
    s.on("error", (e) => {
      finish(false, e.message);
    });
  });
}

// ── Delivery-state determination (pure — AC2's falsifiable core) ───────────────────────────────────

/**
 * Classify a recipient's settings into direct (delivered) vs pending-approval (held). §10.1 单变量
 * 对照: `permissions.defaultMode=bypassPermissions` OR `crossSessionInbound:accept` 任一即直通；两者
 * 皆无 ⇒ held。纯函数 — 测试直接注入 settings 断言（bypass→delivered / 皆无→held，能取假）。
 */
export function deliveryStateFor(settings: RecipientSettings): "delivered" | "held" {
  if (settings.defaultMode === "bypassPermissions" || settings.crossSessionInbound === "accept") {
    return "delivered";
  }
  return "held";
}

/** Parse a Claude Code settings JSON document into the delivery-relevant pair. Unparseable/non-object
 *  ⇒ null (hard rule ③b: 读不懂 ≠ 合格，诚实 null 让调用方走「无法确定」路径). */
export function extractDeliverySettings(jsonText: string): RecipientSettings | null {
  try {
    const j: unknown = JSON.parse(jsonText);
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    const o = j as Record<string, unknown>;
    const permissions = o.permissions;
    const defaultMode =
      permissions && typeof permissions === "object" && !Array.isArray(permissions) &&
        typeof (permissions as Record<string, unknown>).defaultMode === "string"
        ? (permissions as Record<string, unknown>).defaultMode as string
        : null;
    const crossSessionInbound = typeof o.crossSessionInbound === "string" ? o.crossSessionInbound : null;
    return { defaultMode, crossSessionInbound };
  } catch {
    return null;
  }
}

/**
 * Derive delivery settings from a process argv (`/proc/<pid>/cmdline` split on NUL). Order:
 * `--dangerously-skip-permissions` ⇒ bypassPermissions; else `--settings <path>` ⇒ read that file;
 * else the global `~/.claude/settings.json`. `readSettingsFile` is injectable for tests. null ⇒ the
 * recipient's settings could not be determined (the caller maps that to held, never to delivered).
 */
export function deliverySettingsFromArgv(
  argv: string[],
  readSettingsFile: (p: string) => string | null,
  home: string,
): RecipientSettings | null {
  if (argv.includes("--dangerously-skip-permissions")) {
    return { defaultMode: "bypassPermissions", crossSessionInbound: null };
  }
  const si = argv.indexOf("--settings");
  if (si !== -1 && si + 1 < argv.length) {
    const text = readSettingsFile(argv[si + 1]);
    if (text != null) return extractDeliverySettings(text);
  }
  const global = readSettingsFile(path.join(home, ".claude", "settings.json"));
  if (global != null) return extractDeliverySettings(global);
  return null;
}

/** Read a recipient process's delivery settings from `/proc/<pid>/cmdline`. Never throws; null when
 *  /proc is unavailable (non-linux / process gone) or the settings file is unreadable. */
export function readRecipientSettings(pid: number, home: string = os.homedir()): RecipientSettings | null {
  let argv: string[];
  try {
    argv = fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean);
  } catch {
    argv = [];
  }
  const readSettingsFile = (p: string): string | null => {
    try { return fs.readFileSync(p, "utf8"); } catch { return null; }
  };
  return deliverySettingsFromArgv(argv, readSettingsFile, home);
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
 *  break the send itself (the send already happened; the receipt is the honest record of it). */
export function appendMessageReceipt(dir: string, receipt: MessageReceipt): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, MESSAGE_RECEIPTS_FILENAME), JSON.stringify(receipt) + "\n");
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
  /** Override recipient settings (test seam). null/undefined ⇒ read from /proc/<pid>/cmdline. */
  settings?: RecipientSettings | null;
  /** Override the resolved endpoint (test seam). null/undefined ⇒ resolve from the registry. */
  endpoint?: SessionEndpoint | null;
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
 * read recipient settings → write the frames → record a receipt. The returned state is the honest
 * four-state delivery result: `error` (unresolvable / socket write failed), `delivered` (recipient
 * settings direct), or `held` (neither — pending approval, will `expire`). Unreadable settings map to
 * `held`, never `delivered` (⛔ 不得在拿不到直通证据时声称已送达).
 */
export async function sendToSession(opts: SendToSessionOpts): Promise<SendOutcome> {
  const home = opts.home ?? os.homedir();
  const sessionId = opts.sessionId;
  const message = (opts.message ?? "").trim();

  if (!isValidSessionId(sessionId)) {
    return { state: "error", detail: `sessionId 非法（须为 UUID）：${sessionId}`, sessionId, name: null, message };
  }
  if (!message) {
    return { state: "error", detail: "消息为空", sessionId, name: null, message };
  }

  const endpoint = opts.endpoint !== undefined ? opts.endpoint : resolveSessionEndpoint(sessionId, home);
  if (endpoint == null) {
    return { state: "error", detail: "未找到目标会话（不在运行注册表，或已结束）", sessionId, name: null, message };
  }

  const settings = opts.settings !== undefined ? opts.settings : readRecipientSettings(endpoint.pid, home);
  const predicted = settings != null ? deliveryStateFor(settings) : "held";

  const sent = await sendSessionFrames({
    sockPath: endpoint.sockPath,
    token: endpoint.token,
    text: message,
    fromName: WEB_SEND_FROM_NAME,
  });
  if (!sent.ok) {
    return { state: "error", detail: `连接/写入失败：${sent.reason ?? "unknown"}`, sessionId, name: endpoint.name, message };
  }

  const detail = predicted === "delivered"
    ? "接收方 settings 直通（bypassPermissions / crossSessionInbound:accept）"
    : "接收方未设直通（待批准）；到期未批准则未送达（expired）";

  if (opts.receiptDir != null) {
    appendMessageReceipt(opts.receiptDir, {
      sessionId,
      name: endpoint.name,
      message,
      state: predicted,
      sentAtMs: opts.nowMs ?? Date.now(),
    });
  }
  return { state: predicted, detail, sessionId, name: endpoint.name, message };
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
    <body>${renderMobileChrome("sessions", "sessions")}${renderSiteNav("sessions")}<main>
      <h1>消息投递 — <code>${escapeHtml(outcome.sessionId)}</code></h1>
      <p class="meta"><a href="/session/${escapeHtml(outcome.sessionId)}">← 返回会话</a> · 投递状态是【接收方 settings 的决定性预测】+ 回执折算，非 socket「写成功」</p>
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
  const outcome = await sendToSession({ sessionId, message, receiptDir });
  const receipts = readMessageReceipts(receiptDir, isValidSessionId(sessionId) ? sessionId : null);

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSendResult(outcome, receipts, Date.now()));
}
