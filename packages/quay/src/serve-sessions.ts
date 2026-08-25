// serve-sessions.ts — /sessions + /session/<sessionId> route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import { readSessions, readSession, sessionTranscriptPath, SESSION_LAYERS, type SessionsResult, type SessionDetail, type SessionViewResult, type TranscriptBlock } from "./observation.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, obsNote } from "./serve-render.ts";
import { renderSendForm } from "./serve-send.ts";

// ── /sessions ──────────────────────────────────────────────────────────────────────────────────────

function renderSessionsPage(sessions: SessionsResult): string {
  const cardFor = (s: SessionDetail): string => {
    const msgHtml = s.messages && s.messages.length > 0
      ? s.messages.map((m) => html`<div style="border-left:2px solid var(--color-divider);padding-left:0.6rem;margin-bottom:0.5rem">
          <div style="font-size:0.7rem;color:var(--color-neutral-700)">${escapeHtml(m.time)} · ${escapeHtml(m.role)}</div>
          <p style="font-size:0.8rem;line-height:1.4;margin:0">${escapeHtml(m.text)}</p>
        </div>`).join("")
      : obsNote(s.transcriptStatus, s.transcriptReason);
    return html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:0.5rem;min-height:180px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <b>${escapeHtml(s.name)}</b>
        <span style="font-size:0.75rem;font-weight:700;color:${s.alive ? "var(--color-accent-700)" : "var(--color-accent-800)"}">${s.alive ? "LIVE" : "GONE"}</span>
      </div>
      <div style="font-size:0.75rem;color:var(--color-neutral-700)">${s.halted ? "halted" : s.pid != null ? `pid ${s.pid}` : "—"}</div>
      ${msgHtml}
    </div>`;
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
  const sections = SESSION_LAYERS.map(({ layer, heading }) => {
    const items = byLayer.get(layer) ?? [];
    return html`<section style="margin-bottom:1.5rem">
      <h2>${escapeHtml(heading)}</h2>
      ${items.length > 0
        ? html`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem">${items.map(cardFor).join("")}</div>`
        : html`<p class="meta">无该层会话目标</p>`}
    </section>`;
  }).join("");
  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay sessions — 运行中 + 已结束会话">${modernistStyles()}${pageStyles()}<title>Sessions — 会话观测</title></head>
    <body>${renderMobileChrome("sessions", "sessions")}${renderSiteNav("sessions")}<main>
      <h1>Sessions — 会话观测（运行中 + 已结束）</h1>
      <p class="meta">数据源：<code>claude agents --json</code>（运行中 · 交互式 + <code>-p</code>）+ transcript 目录扫描（已结束）+ 会话 transcript 尾部</p>
      ${obsNote(sessions.status, sessions.reason)}
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
// one <details class="tx-tool-pair">) — never a flat full-text dump. Zero client JS: collapse via
// native <details>, freshness via manual refresh (blocker ① deferred).
export function renderSessionPage(view: SessionViewResult): string {
  // First pass: index tool_use (by id) and tool_result (by tool_use_id) across ALL turns so a
  // tool_result arriving in a later user record can be folded into its assistant tool_use's <details>.
  const toolUseById = new Map<string, { name: string; input: string }>();
  const toolResultByUseId = new Map<string, { text: string; isError: boolean }>();
  for (const turn of view.turns) {
    for (const b of turn.blocks) {
      if (b.kind === "tool_use") toolUseById.set(b.id, { name: b.name, input: b.input });
      else if (b.kind === "tool_result") toolResultByUseId.set(b.toolUseId, { text: b.text, isError: b.isError });
    }
  }

  const blockFor = (b: TranscriptBlock): string => {
    if (b.kind === "text") {
      return html`<div class="tx-block tx-text" style="margin:0.25rem 0;white-space:pre-wrap;line-height:1.5;font-size:0.85rem">${escapeHtml(b.text)}</div>`;
    }
    if (b.kind === "thinking") {
      return html`<details class="tx-block tx-thinking" style="margin:0.25rem 0"><summary style="cursor:pointer;font-size:0.75rem;color:var(--color-neutral-700)">thinking</summary><pre style="margin:0.25rem 0 0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(b.text)}</pre></details>`;
    }
    if (b.kind === "tool_use") {
      const label = b.name ? `tool_use · ${b.name}` : "tool_use";
      const res = toolResultByUseId.get(b.id);
      const inputHtml = b.input ? html`<div class="tx-tool-input"><pre style="margin:0.25rem 0 0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(b.input)}</pre></div>` : "";
      const resultHtml = res
        ? html`<div class="tx-tool-result"><div style="font-size:0.7rem;color:var(--color-neutral-700);margin:0.25rem 0">${res.isError ? "result · error" : "result"}</div><pre style="margin:0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(res.text)}</pre></div>`
        : "";
      return html`<details class="tx-block tx-tool-pair" style="margin:0.25rem 0"><summary style="cursor:pointer;font-size:0.75rem;color:var(--color-neutral-700)">${escapeHtml(label)}</summary>${inputHtml}${resultHtml}</details>`;
    }
    // tool_result with no matching tool_use in the (bounded) tail renders standalone (orphan).
    return html`<details class="tx-block tx-tool-result" style="margin:0.25rem 0"><summary style="cursor:pointer;font-size:0.75rem;color:var(--color-neutral-700)">${b.isError ? "tool_result · error" : "tool_result"}</summary><pre style="margin:0.25rem 0 0;padding:0.5rem;background:var(--color-neutral-100);white-space:pre-wrap;font-size:0.78rem">${escapeHtml(b.text)}</pre></details>`;
  };

  const turnFor = (t: SessionViewResult["turns"][number]): string => {
    // Absorb matched tool_results into their tool_use's <details>; only orphans render standalone.
    const blocks = t.blocks
      .filter((b) => !(b.kind === "tool_result" && toolUseById.has(b.toolUseId)))
      .map(blockFor);
    if (blocks.length === 0) return "";
    return html`<div style="border-left:2px solid var(--color-divider);padding-left:0.75rem;margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;font-size:0.7rem;color:var(--color-neutral-700);margin-bottom:0.25rem">
        <b>${escapeHtml(t.role || "?")}</b><span>${escapeHtml(t.time)}</span>
      </div>
      ${blocks.join("")}
    </div>`;
  };

  const turnsHtml = view.turns.length > 0
    ? html`<h2>Transcript（${view.turns.length} 条消息 · 旧→新）</h2>${view.turns.map(turnFor).filter(Boolean).join("")}`
    : "";

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay session — 单一会话视图">${modernistStyles()}${pageStyles()}<title>Session — ${escapeHtml(view.sessionId)}</title></head>
    <body>${renderMobileChrome("sessions", "sessions")}${renderSiteNav("sessions")}<main>
      <h1>Session — <code>${escapeHtml(view.sessionId)}</code></h1>
      <p class="meta"><a href="/sessions">← 返回 Sessions</a> · 数据源：<code>~/.claude/projects/&lt;slug&gt;/&lt;sessionId&gt;.jsonl</code>（transcript 尾部，非实时）</p>
      ${obsNote(view.status, view.reason)}
      ${turnsHtml}
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
    view = { status: "error", reason: `internal: ${err instanceof Error ? err.message : String(err)}`, sessionId, transcriptPath: null, turns: [] };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSessionPage(view));
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
