// serve-sessions.ts — /sessions + /session/<sessionId> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readSessions, readSession, readTranscript, sessionTranscriptPath, isValidSessionId, SESSION_LAYERS, SESSION_VIEW_INITIAL_TURNS, SESSION_VIEW_EARLIER_CHUNK, type SessionsResult, type SessionDetail, type SessionViewResult, type TranscriptBlock, type TranscriptTurn } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, obsNote } from "./serve-render.ts";
import { runDriver } from "./cli/driver.ts";
import { renderSendForm } from "./serve-send.ts";

// ── /sessions ──────────────────────────────────────────────────────────────────────────────────────

export function renderSessionsPage(sessions: SessionsResult): string {
  // AC1 (gap-sessions-page-slow-unclickable-flat-render): the card is an <a href="/session/<id>"> —
  // the detail page already exists, the list just never linked to it. sessionId is a strict UUID
  // ([0-9a-f-]), so the href is a lookup key, never a path-traversal vector.
  const cardFor = (s: SessionDetail): string => {
    const msgHtml = s.messages && s.messages.length > 0
      ? s.messages.map((m) => html`<div style="border-left:2px solid var(--color-divider);padding-left:0.6rem;margin-bottom:0.5rem">
          <div style="font-size:0.7rem;color:var(--color-neutral-700)">${escapeHtml(m.time)} · ${escapeHtml(m.role)}</div>
          <p style="font-size:0.8rem;line-height:1.4;margin:0">${escapeHtml(m.text)}</p>
        </div>`).join("")
      : s.alive
        ? obsNote(s.transcriptStatus, s.transcriptReason)
        // AC2: a GONE card's tail is NOT read on the list page — render a hint, not a fabricated 未接入.
        : html`<p class="meta">transcript 在详情页按需读取 — 点击查看</p>`;
    return html`<a href="/session/${escapeHtml(s.sessionId)}" style="text-decoration:none;color:inherit;background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:0.5rem;min-height:180px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <b>${escapeHtml(s.name)}</b>
        <span style="font-size:0.75rem;font-weight:700;color:${s.alive ? "var(--color-positive-700)" : "var(--color-accent-800)"}">${s.alive ? "LIVE" : "GONE"}</span>
      </div>
      <div style="font-size:0.75rem;color:var(--color-neutral-700)">${s.halted ? "halted" : s.pid != null ? `pid ${s.pid}` : "—"}</div>
      ${msgHtml}
    </a>`;
  };

  // Group by layer (Manager / Outer / Inner, plus Other for names that carry no layer marker) so
  // each section renders only its own layer's sessions — never mixed. SESSION_LAYERS covers every
  // possible layer value, so no session is dropped.
  const byLayer = new Map<SessionDetail["layer"], SessionDetail[]>();
  for (const s of sessions.sessions) {
    const list = byLayer.get(s.layer) ?? [];
    list.push(s);
    byLayer.set(s.layer, list);
  }
  // AC2: default-render LIVE only; GONE sessions fold into a collapsed <details> (native, zero-JS).
  // The GONE tail was already skipped in readSessions, so the <details> holds only minimal name cards.
  const grid = "display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem";
  const sections = SESSION_LAYERS.map(({ layer, heading }) => {
    const items = byLayer.get(layer) ?? [];
    const live = items.filter((s) => s.alive);
    const gone = items.filter((s) => !s.alive);
    return html`<section style="margin-bottom:1.5rem">
      <h2>${escapeHtml(heading)}</h2>
      ${live.length > 0
        ? html`<div style="${grid}">${live.map(cardFor).join("")}</div>`
        : html`<p class="meta">无运行中会话</p>`}
      ${gone.length > 0
        ? html`<details style="margin-top:0.75rem">
            <summary style="cursor:pointer;font-size:0.8rem;color:var(--color-neutral-700)">已结束会话（GONE · ${gone.length}）</summary>
            <div style="${grid};margin-top:0.75rem">${gone.map(cardFor).join("")}</div>
          </details>`
        : ""}
    </section>`;
  }).join("");
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay sessions — 运行中 + 已结束会话">${modernistStyles()}${pageStyles()}<title>Sessions — 会话观测</title></head>
    <body>${renderMobileChrome("sessions", "sessions")}${renderSiteNav("sessions")}<main>
      <h1>Sessions — 会话观测（运行中 + 已结束）</h1>
      <p class="meta">数据源：<code>claude agents --json</code>（运行中 · 交互式 + <code>-p</code>）+ transcript 目录扫描（已结束）+ 会话 transcript 尾部</p>
      ${obsNote(sessions.status, sessions.reason)}
      ${renderLifecycleSection()}
      ${sessions.sessions.length > 0 ? sections : ""}
    </main></body></html>`;
}

export async function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let sessions: SessionsResult;
  try {
    sessions = await readSessions(cfg.workspaceRoot);
  } catch (err) {
    sessions = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, sessions: [] };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSessionsPage(sessions));
}

// ── /session/<sessionId> ──────────────────────────────────────────────────────────────────────────

// gap-webui-session-detail-view — the single-session view. Addressable by sessionId ONLY (§7.1), the
// one quantity stable across live/dead × interactive/-p. The renderer is the observation-level parse
// (structured text/thinking/tool_use/tool_result blocks) — NOT the /sessions 3-message preview.
// AC2 (结构化分块非摊平): each content block renders as a marked, collapsible unit (`tx-text` /
// `tx-thinking` / `tx-tool-pair`), and a `tool_use` is PAIRED with its `tool_result` (rendered inside
// one <details class="tx-tool-pair">) — never a flat full-text dump.
//
// gap-sessions-page-slow-unclickable-flat-render AC3: the detail page no longer flattens the whole
// 2 MB tail. It renders the most recent SESSION_VIEW_INITIAL_TURNS turns by default and lazy-loads
// earlier turns on scroll-up. ⛔ This BREAKS the zero-client-JS convention for THIS one page — a
// deliberate, documented exception (see the task Plan §3 tension note): scroll-triggered lazy-loading
// is structurally impossible in pure HTML, and the native <details> alternative either re-embeds the
// full 2 MB (defeating the perf fix) or degrades to a "load earlier" pagination link (excluded by the
// Plan). The break is minimal — one self-contained <script> (IntersectionObserver), no framework, no
// WebSocket — and every other page stays zero-JS.

/** tool_use→result pairing maps, indexed across a full turn list so a tool_result in a later record
 *  folds into its assistant tool_use even when only a slice of turns is rendered. */
interface ToolMaps {
  toolUseById: Map<string, { name: string; input: string }>;
  toolResultByUseId: Map<string, { text: string; isError: boolean }>;
}

function buildToolMaps(turns: TranscriptTurn[]): ToolMaps {
  const toolUseById = new Map<string, { name: string; input: string }>();
  const toolResultByUseId = new Map<string, { text: string; isError: boolean }>();
  for (const turn of turns) {
    for (const b of turn.blocks) {
      if (b.kind === "tool_use") toolUseById.set(b.id, { name: b.name, input: b.input });
      else if (b.kind === "tool_result") toolResultByUseId.set(b.toolUseId, { text: b.text, isError: b.isError });
    }
  }
  return { toolUseById, toolResultByUseId };
}

/** Render a list of turns (a slice of the transcript) to HTML using pre-built tool pairing maps.
 *  Shared by the detail page (recent N) and the /session/<id>/earlier endpoint (older chunks). */
function renderTurnsHtml(turns: TranscriptTurn[], maps: ToolMaps): string {
  const blockFor = (b: TranscriptBlock): string => {
    if (b.kind === "text") {
      return html`<div class="tx-block tx-text" style="margin:0.25rem 0;white-space:pre-wrap;line-height:1.5;font-size:0.85rem">${escapeHtml(b.text)}</div>`;
    }
    if (b.kind === "thinking") {
      return html`<details class="tx-block tx-thinking" style="margin:0.25rem 0"><summary style="cursor:pointer;font-size:0.75rem;color:var(--color-neutral-700)">thinking</summary><pre style="margin:0.25rem 0 0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(b.text)}</pre></details>`;
    }
    // queue-operation / attachment event (a queued cross-session message absorbed mid-turn — never a
    // `type:"user"` record). Rendered as a distinguishable marker, NOT a forged user/assistant bubble.
    if (b.kind === "external") {
      return html`<div class="tx-block tx-external" style="margin:0.25rem 0;padding:0.5rem;background:var(--color-neutral-100);border-left:3px solid var(--color-accent-700)"><div style="font-size:0.7rem;color:var(--color-accent-800);font-weight:700">${escapeHtml(b.label)}</div><div style="margin-top:0.25rem;white-space:pre-wrap;line-height:1.5;font-size:0.85rem">${escapeHtml(b.text)}</div></div>`;
    }
    if (b.kind === "tool_use") {
      const label = b.name ? `tool_use · ${b.name}` : "tool_use";
      const res = maps.toolResultByUseId.get(b.id);
      const inputHtml = b.input ? html`<div class="tx-tool-input"><pre style="margin:0.25rem 0 0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(b.input)}</pre></div>` : "";
      const resultHtml = res
        ? html`<div class="tx-tool-result"><div style="font-size:0.7rem;color:var(--color-neutral-700);margin:0.25rem 0">${res.isError ? "result · error" : "result"}</div><pre style="margin:0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(res.text)}</pre></div>`
        : "";
      return html`<details class="tx-block tx-tool-pair" style="margin:0.25rem 0"><summary style="cursor:pointer;font-size:0.75rem;color:var(--color-neutral-700)">${escapeHtml(label)}</summary>${inputHtml}${resultHtml}</details>`;
    }
    // tool_result with no matching tool_use in the (bounded) tail renders standalone (orphan).
    return html`<details class="tx-block tx-tool-result" style="margin:0.25rem 0"><summary style="cursor:pointer;font-size:0.75rem;color:var(--color-neutral-700)">${b.isError ? "tool_result · error" : "tool_result"}</summary><pre style="margin:0.25rem 0 0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(b.text)}</pre></details>`;
  };

  const turnFor = (t: TranscriptTurn): string => {
    // Absorb matched tool_results into their tool_use's <details>; only orphans render standalone.
    const blocks = t.blocks
      .filter((b) => !(b.kind === "tool_result" && maps.toolUseById.has(b.toolUseId)))
      .map(blockFor);
    if (blocks.length === 0) return "";
    return html`<div style="border-left:2px solid var(--color-divider);padding-left:0.75rem;margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;font-size:0.7rem;color:var(--color-neutral-700);margin-bottom:0.25rem">
        <b>${escapeHtml(t.role || "?")}</b><span>${escapeHtml(t.time)}</span>
      </div>
      ${blocks.join("")}
    </div>`;
  };

  return turns.map(turnFor).filter(Boolean).join("");
}

export function renderSessionPage(view: SessionViewResult): string {
  const maps = buildToolMaps(view.turns);
  const recent = view.turns.slice(-SESSION_VIEW_INITIAL_TURNS);
  const olderCount = view.turns.length - recent.length;
  const lazy = olderCount > 0 || view.truncated;

  let transcriptHtml = "";
  if (view.turns.length > 0) {
    const heading = html`<h2>Transcript（${view.turns.length} 条消息 · 旧→新${olderCount > 0 ? `，默认显示最近 ${recent.length} 条` : ""}）</h2>`;
    const sentinel = lazy
      ? html`<div id="tx-earlier-sentinel" class="meta" style="padding:0.5rem 0;color:var(--color-neutral-700);font-size:0.75rem">加载更早消息…</div>`
      : "";
    transcriptHtml = html`<div id="tx-list" data-session="${escapeHtml(view.sessionId)}" data-rendered="${recent.length}" data-total="${view.turns.length}" data-truncated="${view.truncated}">${heading}${sentinel}${renderTurnsHtml(recent, maps)}</div>`;
  }

  // One self-contained scroll-loader (the deliberate zero-JS break). Auto-scrolls to the newest turn
  // (chat-style), then IntersectionObserver on the top sentinel fetches older chunks on scroll-up.
  const loaderScript = lazy
    ? html`<script>
(() => {
  const list = document.getElementById("tx-list");
  if (!list) return;
  const sentinel = document.getElementById("tx-earlier-sentinel");
  if (!sentinel) return;
  const sessionId = list.dataset.session;
  const total = Number(list.dataset.total) || 0;
  let rendered = Number(list.dataset.rendered) || 0;
  let truncated = list.dataset.truncated === "true";
  let busy = false;
  const done = () => rendered >= total && !truncated;
  function finish() {
    if (truncated) {
      sentinel.outerHTML = '<p class="meta">更早的 transcript 超出读取窗口 — <a href="/session/' + encodeURIComponent(sessionId) + '/download">下载完整 transcript</a></p>';
    } else {
      sentinel.remove();
    }
  }
  async function load() {
    if (busy || done()) return;
    busy = true;
    try {
      const res = await fetch("/session/" + encodeURIComponent(sessionId) + "/earlier?before=" + rendered);
      if (!res.ok) return;
      const data = await res.json();
      if (data.count > 0) {
        sentinel.insertAdjacentHTML("afterend", data.html || "");
        rendered += data.count;
        truncated = data.truncated === true;
        if (!done() && sentinel.getBoundingClientRect().top < window.innerHeight) {
          busy = false;
          load();
          return;
        }
      }
      if (done() || data.count === 0) finish();
    } catch {} finally { busy = false; }
  }
  list.scrollIntoView({ block: "end" });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) load();
  }, { rootMargin: "600px 0px" });
  io.observe(sentinel);
})();
</script>`
    : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay session — 单一会话视图">${modernistStyles()}${pageStyles()}<title>Session — ${escapeHtml(view.sessionId)}</title></head>
    <body>${renderMobileChrome("sessions", "sessions")}${renderSiteNav("sessions")}<main>
      <h1>Session — <code>${escapeHtml(view.sessionId)}</code></h1>
      <p class="meta"><a href="/sessions">← 返回 Sessions</a> · 数据源：<code>~/.claude/projects/&lt;slug&gt;/&lt;sessionId&gt;.jsonl</code>（transcript 尾部，非实时）</p>
      ${obsNote(view.status, view.reason)}
      ${transcriptHtml}
      ${loaderScript}
      ${renderSendForm(view.sessionId)}
    </main></body></html>`;
}

export async function handleSession(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  sessionId: string,
): Promise<void> {
  let view: SessionViewResult;
  try {
    view = readSession(cfg.workspaceRoot, sessionId);
  } catch (err) {
    view = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, sessionId, transcriptPath: null, turns: [], truncated: false };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSessionPage(view));
}

// ── /session/<sessionId>/earlier ─────────────────────────────────────────────────────────────────
// gap-sessions-page-slow-unclickable-flat-render AC3: the on-demand endpoint the detail page's scroll
// loader calls. `before` = the number of turns already rendered (the most recent); the server re-reads
// the bounded tail and returns the next SESSION_VIEW_EARLIER_CHUNK turns BEFORE them as HTML (the
// "服务端按需重新截取 tail" half — the client never holds the full 2 MB). Response is JSON
// { html, count, truncated, total } so the loader can append and know when to stop. A non-UUID
// sessionId resolves to null ⇒ 400 (same traversal-proof house rule as /session/<id>).

/** Pure: the next chunk of earlier turns (up to SESSION_VIEW_EARLIER_CHUNK) immediately BEFORE the
 *  last `before` turns — the slice the /earlier endpoint returns. Exported for direct unit testing
 *  (the pagination math is the AC3 "按需加载" surface; no transcript file I/O needed to verify it). */
export function earlierTurnsChunk(turns: TranscriptTurn[], before: number): TranscriptTurn[] {
  const total = turns.length;
  const clamped = Number.isFinite(before) && before > 0 ? Math.min(before, total) : 0;
  const start = Math.max(0, total - clamped - SESSION_VIEW_EARLIER_CHUNK);
  return turns.slice(start, total - clamped);
}

export async function handleSessionEarlier(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  sessionId: string,
  url: URL,
): Promise<void> {
  const transcriptPath = sessionTranscriptPath(cfg.workspaceRoot, sessionId);
  if (transcriptPath == null) {
    writeJson(res, 400, { html: "", count: 0, truncated: false, total: 0, status: "empty", reason: "sessionId 非法（须为 UUID）" });
    return;
  }
  const t = readTranscript(transcriptPath);
  const beforeRaw = url.searchParams.get("before") ?? "";
  const parsed = Number.parseInt(beforeRaw, 10);
  const slice = earlierTurnsChunk(t.turns, parsed);
  const maps = buildToolMaps(t.turns);
  writeJson(res, 200, { html: renderTurnsHtml(slice, maps), count: slice.length, truncated: t.truncated, total: t.turns.length, status: t.status, reason: t.reason });
}

// ── /session/<sessionId>/download ────────────────────────────────────────────────────────────────
// gap-worker-task-transcript-access-webui AC3: raw JSONL transcript download (Content-Disposition:
// attachment). The session_id is a strict-UUID LOOKUP KEY resolved via sessionTranscriptPath — the
// same traversal-proof resolver the view uses (UUID regex → fixed project slug join, §7.4 house
// pattern). A non-UUID / `../` / absolute-path session_id resolves to null ⇒ 400, never touches the
// disk (AC3: ⛔ 任意路径可读 ⇒ 假). A valid-but-absent transcript ⇒ 404; present ⇒ streamed raw.

export async function handleSessionDownload(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  sessionId: string,
): Promise<void> {
  const transcriptPath = sessionTranscriptPath(cfg.workspaceRoot, sessionId);
  if (transcriptPath == null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("invalid session id (must be a UUID)");
    return;
  }
  let size: number;
  try {
    size = fs.statSync(transcriptPath).size;
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("transcript not found");
    return;
  }
  // sessionId is UUID-validated (only [0-9a-f-]) ⇒ safe as a Content-Disposition filename (no CR/LF).
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Content-Disposition": `attachment; filename="${sessionId}.jsonl"`,
    "Content-Length": String(size),
  });
  const stream = fs.createReadStream(transcriptPath);
  stream.on("error", () => {
    try { res.destroy(); } catch { /* client already gone */ }
  });
  stream.pipe(res);
}

// ── /fan-in-log/<task>/<file> ──────────────────────────────────────────────────────────────────
// gap-mech-fan-in-log-webui-visible-clickable B3: the mechanical fan-in process log's view/download
// endpoint — the worker-driver writes .quay/fan-in-<task>-<runId>.log (gitignored runtime state) and
// the Runs block links it. Path-traversal protection is the SAME house pattern as /session/<id>/
// download: a strict task slug + a strict filename whitelist resolve to a fixed `.quay/` join — a
// non-whitelist / `..` / absolute-path segment is rejected with 400 BEFORE any disk access (AC3).

/** Strict task-id shape (all live ids are [A-Za-z0-9-]); rejects `../`, absolute paths, and any
 *  non-task-id before filesystem access. */
export const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
/** Strict fan-in log filename whitelist (no `/`, no `\`, no `..` traversal via a bare `..` name). */
export const FAN_IN_LOG_NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Resolve a task id + fan-in log file name to its path — PURE (no filesystem access, AC3). A
 * non-slug task or a non-whitelist file name (including `..` or an absolute path) returns null;
 * otherwise the file must land strictly inside <root>/.quay/ (defense in depth: a bare `..` matches
 * the filename whitelist literally, so the resolved-path containment check is the traversal guard).
 */
export function fanInLogPath(root: string, task: string, file: string): string | null {
  if (!TASK_ID_RE.test(task)) return null;
  if (!FAN_IN_LOG_NAME_RE.test(file)) return null;
  const quayDir = path.resolve(root, ".quay");
  const resolved = path.resolve(quayDir, file);
  if (!resolved.startsWith(quayDir + path.sep)) return null;
  return resolved;
}

/** Serve a fan-in log: view (inline text/plain) or download (Content-Disposition: attachment). A
 *  non-slug task / non-whitelist file name ⇒ 400; valid-but-absent ⇒ 404; present ⇒ streamed. */
async function handleFanInLog(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  task: string,
  file: string,
  download: boolean,
): Promise<void> {
  const p = fanInLogPath(cfg.workspaceRoot, task, file);
  if (p == null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("invalid fan-in log path");
    return;
  }
  let size: number;
  try {
    size = fs.statSync(p).size;
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("fan-in log not found");
    return;
  }
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(size),
  };
  if (download) {
    // file is whitelist-validated ([A-Za-z0-9_.-]) ⇒ safe as a Content-Disposition filename (no CR/LF).
    headers["Content-Disposition"] = `attachment; filename="${file}"`;
  }
  res.writeHead(200, headers);
  const stream = fs.createReadStream(p);
  stream.on("error", () => {
    try { res.destroy(); } catch { /* client already gone */ }
  });
  stream.pipe(res);
}

/** GET /fan-in-log/<task>/<file> — inline view. */
export async function handleFanInLogView(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  task: string,
  file: string,
): Promise<void> {
  await handleFanInLog(req, res, cfg, task, file, false);
}

/** GET /fan-in-log/<task>/<file>/download — attachment download. */
export async function handleFanInLogDownload(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: { workspaceRoot: string },
  task: string,
  file: string,
): Promise<void> {
  await handleFanInLog(req, res, cfg, task, file, true);
}

// ── 会话生命周期（gap-webui-session-lifecycle）─────────────────────────────────────────────────
// headless driver 两个 kind 的 start/stop/restart 复用 `quay driver`（cli/driver.ts runDriver，⛔ 不
// 重造 driver 逻辑）；新建会话 = `-p --input-format stream-json` + `--session-id <uuid>` + profile +
// 显式权限模式；重启 = `--resume <sessionId>`（SPEC §10.3：上下文保留）。交互式 manager/outer/inner
// 的停/重启【不暴露】（AC3：无鉴权前提下任何人可杀正在工作的 manager，风险不对等）。

/** The web surface's allowed driver verbs — lifecycle only (status/drain stay CLI-only). */
export const WEB_DRIVER_VERBS = ["start", "stop", "restart"] as const;
/** The web surface's allowed driver kinds — headless mechanical drivers ONLY (⛔ interactive manager/outer/inner). */
export const WEB_DRIVER_KINDS = ["promotion", "worker"] as const;

export interface DriverActionSpec {
  verb: (typeof WEB_DRIVER_VERBS)[number];
  kind: (typeof WEB_DRIVER_KINDS)[number];
}

/**
 * Validate a web driver-lifecycle request. Only headless kinds (promotion/worker) × lifecycle verbs
 * (start/stop/restart) are allowed; anything else — interactive manager/outer/inner kinds, status,
 * drain, unknown strings — returns null ⇒ the handler 400s (AC1 scope + AC3: no interactive
 * stop/restart surface, and no reimplemented driver verbs beyond the reused ones).
 */
export function driverActionSpec(verb: unknown, kind: unknown): DriverActionSpec | null {
  if (typeof verb !== "string" || typeof kind !== "string") return null;
  if (!(WEB_DRIVER_VERBS as readonly string[]).includes(verb)) return null;
  if (!(WEB_DRIVER_KINDS as readonly string[]).includes(kind)) return null;
  return { verb: verb as DriverActionSpec["verb"], kind: kind as DriverActionSpec["kind"] };
}

/** The quay-launch.sh role name = the profile handle the web form consumes (AC154's interface). */
export interface NewSessionInput {
  profile: unknown;
  permissionMode: unknown;
  sessionId?: unknown;
  root: string;
}

export interface NewSessionSpec {
  argv: string[];
  sessionId: string;
  profile: string;
  permissionMode: string;
}

/**
 * Build the argv for a NEW headless session (`-p --input-format stream-json --session-id <uuid>` +
 * profile + explicit permission mode). Returns null on a validation failure. ⛔ blocker ③: the
 * permission mode is REQUIRED (no silent default — a missing/empty mode ⇒ null, the handler 400s).
 * `profile` is the profiles.yml ROLE name (AC154's concluded interface: quay-launch.sh <role>). The
 * sessionId is pinned at spawn (`--session-id`) so its transcript is traceable and resumable later;
 * when not supplied, a fresh UUID is generated.
 */
export function newSessionArgs(input: NewSessionInput): NewSessionSpec | null {
  const profile = typeof input.profile === "string" ? input.profile.trim() : "";
  const permissionMode = typeof input.permissionMode === "string" ? input.permissionMode.trim() : "";
  if (!profile || !permissionMode) return null;
  const sessionId =
    typeof input.sessionId === "string" && isValidSessionId(input.sessionId) ? input.sessionId : randomUUID();
  const argv = [
    "bash",
    path.join(input.root, "plugin", "scripts", "quay-launch.sh"),
    profile,
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--session-id", sessionId,
    "--permission-mode", permissionMode,
  ];
  return { argv, sessionId, profile, permissionMode };
}

export interface ResumeSessionInput {
  sessionId: unknown;
  profile: unknown;
  permissionMode: unknown;
  root: string;
}

export interface ResumeSessionSpec {
  argv: string[];
  sessionId: string;
  profile: string;
  permissionMode: string;
}

/**
 * Build the argv for RESTARTING an ended session via `--resume <sessionId>` (AC2: context preserved
 * BECAUSE the same sessionId is resumed, not a fresh session — ⛔ dropping `--resume` or generating a
 * new id ⇒ context lost ⇒ fake). sessionId must be a strict UUID (traversal-proof, same house rule as
 * /session/<id>). ⛔ blocker ③: permissionMode is REQUIRED (no silent default).
 */
export function resumeSessionArgs(input: ResumeSessionInput): ResumeSessionSpec | null {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  if (!isValidSessionId(sessionId)) return null;
  const profile = typeof input.profile === "string" ? input.profile.trim() : "";
  const permissionMode = typeof input.permissionMode === "string" ? input.permissionMode.trim() : "";
  if (!profile || !permissionMode) return null;
  const argv = [
    "bash",
    path.join(input.root, "plugin", "scripts", "quay-launch.sh"),
    profile,
    "-p",
    "--resume", sessionId,
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--permission-mode", permissionMode,
  ];
  return { argv, sessionId, profile, permissionMode };
}

export interface SpawnedSession {
  pid: number | null;
}

/**
 * Spawn a detached headless session (the claude process — reached after quay-launch.sh `exec`s — lives
 * on after the web request returns). stdin is held OPEN as a pipe so a `-p --input-format stream-json`
 * session keeps waiting for input (SPEC §6.1: held-open stdin is the "can wait" switch); stdout/stderr
 * are drained with no-op listeners so the child never backpressures into a deadlock. `unref()` lets the
 * server exit without waiting on the session. Injectable for tests (the pure argv builders above are the
 * unit-tested surface; this is the thin OS boundary).
 */
export function spawnSession(argv: string[], cwd: string): SpawnedSession {
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return { pid: null };
  }
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  child.on("error", () => {});
  child.unref();
  return { pid: child.pid ?? null };
}

/** Read a POST body (bounded), JSON or url-encoded (native form) → plain object. Never throws. */
function parsePostBody(raw: string, contentType: string): Record<string, unknown> {
  const body = raw.slice(0, 64 * 1024);
  if (contentType.includes("json")) {
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  }
  const out: Record<string, unknown> = {};
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, " "));
    const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    if (k) out[k] = v;
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => { data += String(c); if (data.length > 64 * 1024) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(data));
  });
}

function writeJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/**
 * POST /sessions/driver — headless driver start/stop/restart, REUSING `quay driver` (runDriver).
 * Body: {verb: start|stop|restart, kind: promotion|worker}. Any other verb/kind (interactive
 * manager/outer/inner, status, drain) ⇒ 400 (AC3). The valid path delegates to runDriver and echoes
 * its structured result (ok/reason/stdout/stderr/exitCode) — never a reimplemented lifecycle.
 */
export async function handleDriverLifecycle(req: IncomingMessage, res: ServerResponse, cfg: { workspaceRoot: string }): Promise<void> {
  const raw = await readBody(req);
  const body = parsePostBody(raw, req.headers["content-type"] ?? "");
  const spec = driverActionSpec(body.verb, body.kind);
  if (spec == null) {
    writeJson(res, 400, { ok: false, reason: `invalid driver action (verb ∈ ${WEB_DRIVER_VERBS.join("|")}, kind ∈ ${WEB_DRIVER_KINDS.join("|")})`, verb: body.verb ?? null, kind: body.kind ?? null });
    return;
  }
  // Forward --kind into the supervisor argv (runDriver's `rest` carries the user flags verbatim; the
  // CLI gets --kind from `rest`, the web layer must pass it explicitly). ⛔ omitting it makes the
  // supervisor default to promotion — a web "worker" action would silently hit the promotion driver.
  const r = runDriver(spec.verb, spec.kind, ["--kind", spec.kind], cfg.workspaceRoot);
  writeJson(res, 200, { ok: r.ok, verb: spec.verb, kind: spec.kind, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, reason: r.reason });
}

/**
 * POST /sessions/new — create a NEW headless session. Body: {profile, permissionMode, sessionId?}.
 * ⛔ blocker ③: permissionMode is REQUIRED (no default); missing ⇒ 400.
 */
export async function handleNewSession(req: IncomingMessage, res: ServerResponse, cfg: { workspaceRoot: string }): Promise<void> {
  const raw = await readBody(req);
  const body = parsePostBody(raw, req.headers["content-type"] ?? "");
  const spec = newSessionArgs({ profile: body.profile, permissionMode: body.permissionMode, sessionId: body.sessionId, root: cfg.workspaceRoot });
  if (spec == null) {
    writeJson(res, 400, { ok: false, reason: "profile 与 permissionMode 均必填（⛔ 权限模式无默认值）" });
    return;
  }
  const { pid } = spawnSession(spec.argv, cfg.workspaceRoot);
  writeJson(res, 200, { ok: true, sessionId: spec.sessionId, pid, profile: spec.profile, permissionMode: spec.permissionMode });
}

/**
 * POST /sessions/resume — restart an ended session via `--resume <sessionId>` (AC2: context preserved).
 * Body: {sessionId, profile, permissionMode}. A non-UUID sessionId ⇒ 400 (traversal-proof).
 */
export async function handleResumeSession(req: IncomingMessage, res: ServerResponse, cfg: { workspaceRoot: string }): Promise<void> {
  const raw = await readBody(req);
  const body = parsePostBody(raw, req.headers["content-type"] ?? "");
  const spec = resumeSessionArgs({ sessionId: body.sessionId, profile: body.profile, permissionMode: body.permissionMode, root: cfg.workspaceRoot });
  if (spec == null) {
    writeJson(res, 400, { ok: false, reason: "sessionId 须为合法 UUID，且 profile 与 permissionMode 均必填" });
    return;
  }
  const { pid } = spawnSession(spec.argv, cfg.workspaceRoot);
  writeJson(res, 200, { ok: true, sessionId: spec.sessionId, pid, profile: spec.profile, permissionMode: spec.permissionMode });
}

// ── 生命周期 UI（原生 form POST，零客户端 JS——与全站约定一致）──────────────────────────────────

function renderLifecycleSection(): string {
  const field = "padding:0.4rem 0.5rem;border:1px solid var(--color-divider);border-radius:4px;background:var(--color-surface);font-size:0.85rem";
  const btn = "padding:0.4rem 0.75rem;border:1px solid var(--color-divider);border-radius:4px;background:var(--color-accent-700);color:#fff;font-size:0.85rem;cursor:pointer";
  const form = "display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin:0.5rem 0";
  return html`<section style="margin:1.5rem 0 1rem;padding:1rem;background:var(--color-surface);border-radius:8px">
    <h2>会话生命周期（headless）</h2>
    <p class="meta">driver 复用 <code>quay driver</code>；新建 = <code>-p --input-format stream-json</code>；重启 = <code>--resume</code>。⛔ 交互式 manager/outer/inner 不在此暴露。提交结果为 JSON。</p>
    <form method="POST" action="/sessions/driver" style="${form}">
      <select name="verb" style="${field}"><option value="start">start</option><option value="stop">stop</option><option value="restart">restart</option></select>
      <select name="kind" style="${field}"><option value="promotion">promotion</option><option value="worker">worker</option></select>
      <button type="submit" style="${btn}">driver 操作</button>
    </form>
    <form method="POST" action="/sessions/new" style="${form}">
      <input name="profile" placeholder="profile（role 名，必填）" required style="${field}">
      <input name="permissionMode" placeholder="权限模式（必填，无默认）" required style="${field}">
      <button type="submit" style="${btn}">新建会话</button>
    </form>
    <form method="POST" action="/sessions/resume" style="${form}">
      <input name="sessionId" placeholder="session-id（UUID）" required style="${field}">
      <input name="profile" placeholder="profile（role 名）" required style="${field}">
      <input name="permissionMode" placeholder="权限模式（必填）" required style="${field}">
      <button type="submit" style="${btn}">重启会话（--resume）</button>
    </form>
  </section>`;
}
