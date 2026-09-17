// serve-system.ts — /system + /manager route handlers, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readSystem, readManager, type SystemResult, type ManagerResult, type ResourceGateReading } from "./observation.ts";
import type { ServePageCfg, ServeIdentity } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome, obsNote, pageTitle, pageNameFor, htmlLangTag, DEFAULT_LANG, type Lang } from "./serve-render.ts";

// ── /system ─────────────────────────────────────────────────────────────────────────────────────────

/** Meter-bar percentage: `val / numericLimit` clamped to 0–100. Returns `null` (「无法评估」) when
 *  the denominator is missing / non-finite / ≤ 0 — never silently degrades to 1 (硬规则 3b/4: a
 *  reading that can't be evaluated must not look identical to a valid 100%). */
export function meterPct(val: number, numericLimit: number | null): number | null {
  if (numericLimit == null || !Number.isFinite(numericLimit) || numericLimit <= 0) return null;
  return Math.min(100, Math.max(0, (val / numericLimit) * 100));
}

/** One /system meter-bar definition: label + value + numeric denominator + the right-side caption. */
export interface MeterBarSpec {
  label: string;
  val: number | null;
  numericLimit: number | null;
  displayLimit: string | null;
}

/** Every /system progress-bar call site — the single source of truth (AC4 enumerates over it, so a
 *  newly added bar can't escape the denominator check). `limit` is SPLIT: `numericLimit` is the
 *  percentage denominator, `displayLimit` is the human caption (e.g. `nproc×2≈32`). */
export function systemBars(rg: ResourceGateReading): MeterBarSpec[] {
  return [
    { label: "cpu_stall (avg10)", val: rg.cpuStallAvg10, numericLimit: 60, displayLimit: "60" },
    { label: "cpu_stall (avg300)", val: rg.cpuStallAvg300, numericLimit: 60, displayLimit: "60" },
    {
      label: "loadavg (1m)",
      val: rg.loadAvg,
      numericLimit: rg.loadThreshold,
      displayLimit: rg.loadThreshold != null ? `nproc×${rg.loadOverFactor ?? "?"}≈${rg.loadThreshold}` : "nproc×factor",
    },
  ];
}

/** Render one meter bar. A fill bar is drawn ONLY when the numeric limit is evaluable (a value AND
 *  a finite-positive denominator); otherwise the bar is omitted and an explicit `（未知上限）` marker
 *  is shown — never a fake 100% (硬规则 3b: 「无法评估」 gets its own value). */
export function renderBar(label: string, val: number | null, numericLimit: number | null, displayLimit: string | null): string {
  const pct = val != null ? meterPct(val, numericLimit) : null;
  const unknown = val != null && pct == null
    ? html` <span style="color:var(--color-neutral-700)">（未知上限）</span>`
    : "";
  return html`<div><div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:2px">
    <span>${escapeHtml(label)}</span><span>${val != null ? escapeHtml(String(val)) : "—"}${displayLimit ? html` <span style="color:var(--color-neutral-700)">/ ${escapeHtml(displayLimit)}</span>` : ""}${unknown}</span>
  </div>${pct != null ? html`<div style="height:8px;background:var(--color-neutral-300)"><div style="height:100%;width:${pct.toFixed(1)}%;background:var(--color-text)"></div></div>` : ""}</div>`;
}

/** AC-293: `lang` is this request's resolved language (AC-288's mechanism, threaded in by the
 *  dispatcher via `handleSystem`'s `cfg.lang`). It reaches FOUR things on this page and nothing
 *  else: the `<html lang>` attribute, the shared nav bar (`renderSiteNav`) and mobile chrome
 *  (`renderMobileChrome`) — whose `system` entry already exists in NAV_LABELS (ROW 1) — the page's
 *  own `<title>` (through `pageTitle`), and the `<h1>`'s page-name token (through `pageNameFor`
 *  against serve-i18n.ts's PAGE_LABELS). The last two are the whole point: wiring only the SHARED
 *  nav bar would leave the `<title>` at `System — 系统状态` under zh, which is the difference
 *  between "the nav switched" and "THIS page switched" — and AC-293's third arm fails the page on
 *  exactly that (CAUSE=title-unchanged).
 *
 *  ⛔ `/manager` below is a DIFFERENT page and is deliberately NOT wired here (it belongs to its
 *  own AC). Only `renderSystemPage` takes `lang`; `renderManagerPage` keeps its hard-coded English
 *  document-language attribute (spelled the same way this one used to be), which is why counting
 *  the hard-coded attribute in this file goes 2 → 1. (This comment deliberately does NOT spell that
 *  attribute out: a doc-comment quoting it is a false positive for a `grep -c` on the literal —
 *  hard rule 2's comment-vs-position split — and the scope proof for AC5 reads a count.)
 *
 *  `lang` DEFAULTS to `DEFAULT_LANG` on purpose: a direct `renderSystemPage()` caller that predates
 *  it keeps rendering byte-for-byte what it rendered before, and `pageNameFor`'s en column is the
 *  identity for every token — so the en baseline the goal criterion reads off the live page cannot
 *  move as this page is wired. */
function renderSystemPage(sys: SystemResult, identity: ServeIdentity | null = null, lang: Lang = DEFAULT_LANG): string {
  const rg = sys.resourceGate;
  const pb = sys.processBudget;
  const bothOk = rg.status === "ok" && pb.status === "ok";
  const goVerdict = bothOk && rg.verdict === "GO" && pb.verdict === "GO";
  const banner = bothOk
    ? html`<div class="${goVerdict ? "success-banner" : "error-banner"}" role="status"><strong>⇒ ${goVerdict ? "GO" : "WAIT"}</strong>：${goVerdict ? "资源充足，可以跑" : "资源受限，等待"}</div>`
    : "";
  return html`<!doctype html>
    ${htmlLangTag(lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay system — resource gate and process budget">${modernistStyles()}${pageStyles()}<title>${pageTitle("System — 系统状态", identity, lang)}</title></head>
    <body>${renderMobileChrome("system", "system", lang)}${renderSiteNav("system", lang)}<main id="main">
      <h1>${pageNameFor("System", lang)} — 系统状态</h1>
      <p class="meta">数据源：<code>resource-gate.sh --json</code> · <code>process-budget.sh --json</code>（稳定机读 JSON 输出）</p>
      ${banner}
      ${obsNote(rg.status, rg.reason)}
      <h2>resource-gate.sh</h2>
      ${rg.status === "ok" ? html`<div style="display:flex;flex-direction:column;gap:0.75rem;max-width:640px">
        ${systemBars(rg).map((b) => renderBar(b.label, b.val, b.numericLimit, b.displayLimit)).join("")}
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>mem_avail</span><span>${rg.memAvailMb != null ? `${escapeHtml(String(rg.memAvailMb))} MB` : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>nproc / node_procs</span><span>${rg.nproc != null ? escapeHtml(String(rg.nproc)) : "—"} / ${rg.nodeProcs != null ? escapeHtml(String(rg.nodeProcs)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>verdict</span><span>${escapeHtml(rg.verdict ?? "—")}</span></div>
      </div>` : ""}
      ${obsNote(pb.status, pb.reason)}
      <h2>process-budget.sh</h2>
      ${pb.status === "ok" ? html`<div style="display:flex;flex-direction:column;gap:0.5rem;max-width:640px">
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>total_budget</span><span>${pb.totalBudget != null ? escapeHtml(String(pb.totalBudget)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>in_use</span><span>${pb.inUse != null ? escapeHtml(String(pb.inUse)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>available</span><span>${pb.available != null ? escapeHtml(String(pb.available)) : "—"}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem"><span>verdict</span><span>${escapeHtml(pb.verdict ?? "—")}</span></div>
      </div>` : ""}
      <p class="meta" style="margin-top:1rem">阈值按 <code>nproc</code> 动态计算显示，不写死当前机器上的数字。</p>
    </main></body></html>`;
}

export async function handleSystem(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: ServePageCfg,
): Promise<void> {
  let sys: SystemResult;
  try {
    sys = await readSystem(cfg.workspaceRoot);
  } catch (err) {
    sys = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      resourceGate: { status: "error", reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null },
      processBudget: { status: "error", reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSystemPage(sys, cfg.identity, cfg.lang));
}

// ── /manager ───────────────────────────────────────────────────────────────────────────────────────

function renderManagerPage(mgr: ManagerResult, identity: ServeIdentity | null = null): string {
  const loopCards = (label: string, statusText: string, note: string): string => html`<div style="background:var(--color-surface);padding:1rem">
    <div style="font-size:0.85rem;color:var(--color-neutral-700);margin-bottom:4px">${escapeHtml(label)}</div>
    <div style="font-weight:700">${statusText}</div>
    <p style="font-size:0.8rem;margin:4px 0 0">${escapeHtml(note)}</p>
  </div>`;

  const ld = mgr.loopDriver;
  const livenessRows = mgr.liveness.sessions.length > 0 ? html`<table>
    <tr><th>会话</th><th>alive</th><th>pid</th><th>halted</th></tr>
    ${mgr.liveness.sessions.map((s) => html`<tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.alive ? "LIVE" : "GONE"}</td>
      <td>${s.pid != null ? escapeHtml(String(s.pid)) : "—"}</td>
      <td>${s.halted ? "halted" : "—"}</td>
    </tr>`).join("\n")}
  </table>` : "";

  const observerRows = mgr.observers.rows.length > 0 ? html`<table>
    <tr><th>name</th><th>status</th><th>root</th><th>note</th></tr>
    ${mgr.observers.rows.map((r) => html`<tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td><code>${escapeHtml(r.root)}</code></td>
      <td>${escapeHtml(r.note)}</td>
    </tr>`).join("\n")}
  </table>` : "";

  const pool = mgr.pool;
  const poolNote = pool.status === "ok"
    ? html`<div style="font-family:ui-monospace,monospace;font-size:0.85rem;line-height:1.7">
        pool=${pool.pool ?? "—"} floor=${pool.floor ?? "—"} deficit=${pool.deficit ?? "—"} cap=${pool.cap ?? "—"}
        ${pool.lastPromoted.length > 0 ? html`<div style="color:var(--color-neutral-700)">最近一轮晋升（promotion-driver）：${pool.lastPromoted.map((id) => html`<a href="/task/${encodeURIComponent(id)}" style="color:var(--color-accent)">${escapeHtml(id)}</a>`).join(" · ")}</div>` : ""}
      </div>`
    : obsNote(pool.status, pool.reason);

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay manager — Manager/Outer/Inner 三层状态">${modernistStyles()}${pageStyles()}<title>${pageTitle("Manager / Outer / Inner", identity)}</title></head>
    <body>${renderMobileChrome("manager", "manager")}${renderSiteNav("manager")}<main id="main">
      <h1>Manager / Outer / Inner — 三层状态</h1>
      <p class="meta">三层自适应探测：多信号加权判定，缺失信号诚实标注「未检测到」，不静默假设。</p>
      <h2>Loop / 会话</h2>
      ${obsNote(ld.status, ld.reason)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:2px;margin-bottom:1rem">
        ${loopCards("Loop driver", ld.verdict ?? "—", ld.detail || `exit=${ld.exitCode ?? "—"}`)}
        ${mgr.liveness.sessions.map((s) => loopCards(s.name, s.alive ? "LIVE" : "GONE", s.halted ? "halted" : s.pid != null ? `pid ${s.pid}` : "—")).join("")}
      </div>
      ${obsNote(mgr.liveness.status, mgr.liveness.reason)}
      ${livenessRows}
      <h2>Monitor 注册表</h2>
      ${obsNote(mgr.observers.status, mgr.observers.reason)}
      ${observerRows}
      <p class="meta">读 <code>observer-registry.conf</code> 单一登记表。</p>
      <h2>主要观测指标</h2>
      ${poolNote}
      <p class="meta">pool/floor/deficit/cap 读 <code>.quay/promotion-round.jsonl</code>（promotion-driver round 记录，cap 默认 5，floor = cap × 4）</p>
      <p class="meta">release=${escapeHtml(mgr.version ?? "—")} · develop 领先 ${mgr.developLead != null ? escapeHtml(String(mgr.developLead)) : "—"} 提交</p>
    </main></body></html>`;
}

export async function handleManager(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: ServePageCfg,
): Promise<void> {
  let mgr: ManagerResult;
  try {
    mgr = await readManager(cfg.workspaceRoot);
  } catch (err) {
    mgr = {
      status: "error",
      reason: `internal: ${err instanceof Error ? err.message : String(err)}`,
      loopDriver: { status: "error", reason: null, verdict: null, exitCode: null, detail: null },
      liveness: { status: "error", reason: null, sessions: [] },
      observers: { status: "error", reason: null, rows: [] },
      pool: { status: "error", reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] },
      version: null,
      developLead: null,
    };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderManagerPage(mgr, cfg.identity));
}
