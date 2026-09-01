// serve-dashboard.ts — /dashboard route handler + task-summary cache, split from serve-handlers.ts.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import { readLive, readSystem, readManagerLight, readTests, readGitHistory, readCurrentSuiteRun, type LiveResult, type SystemResult, type ManagerResult, type TestsResult, type GitHistoryResult, type CurrentSuiteRun } from "./observation.ts";
import { TASK_STATUS } from "./abi.ts";
import type { Manifest } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, renderSiteNav, renderMobileChrome } from "./serve-render.ts";
import { awaitingLandMs, formatAwaitingDuration, suiteSuffix } from "./serve-live.ts";

// ── /dashboard ─────────────────────────────────────────────────────────────────────────────────────

// gap-webui-dashboard-tests-card-latest-round-no-live-signal: elapsed-time formatter for a suite
// that is currently running (startedAt ISO → nowMs), pulled out as a pure function so it is testable
// without a live clock. null input/unparseable ISO → null (never a fabricated "0s").
export function formatSuiteElapsed(startedAt: string | null, nowMs: number): string | null {
  if (startedAt == null) return null;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return null;
  const totalSec = Math.max(0, Math.round((nowMs - t) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function renderDashboardPage(d: {
  live: LiveResult;
  sys: SystemResult;
  mgr: ManagerResult;
  tests: TestsResult;
  suiteRun: CurrentSuiteRun | null;
  history: GitHistoryResult;
  tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>;
}): string {
  const live = d.live;
  const liveStateText = live.status === "error" ? "读失败" : live.liveState === "running" ? "running" : live.liveState === "running-unwired" ? "在跑但未接遥测" : live.liveState === "not-running" ? "未在运行" : "—";
  // gap-webui-live-implcomplete-state-render (AC2): the liveCard is no longer a bare count line —
  // it renders a mini list of the first 3 in-flight tasks with a per-task state tag, so a task that
  // finished implementing but is stuck awaiting-land is visible at a glance (待落地 + duration in
  // the warning color), instead of hiding inside a "在飞 N" number.
  // gap-live-fan-in-execution-phase-two-axis: the liveCard's per-task tag now keys on the execution
  // PHASE (not the impl-complete boundary), so a fan-in task (worker exited, suite running) reads
  // 「fan-in · suite <state>」 instead of a misleading 「实现中」.
  const liveMiniList = live.inFlight.slice(0, 3).map((t) => {
    const tag = t.phase === "awaiting-land"
      ? `待落地 ${formatAwaitingDuration(awaitingLandMs(t))}`
      : t.phase === "fan-in"
        ? `fan-in${suiteSuffix(t.suite)}`
        : t.phase === "landed"
          ? "已落地"
          : "实现中";
    const emphasis = t.phase === "awaiting-land" || t.phase === "fan-in" || t.phase === "landed";
    return html`<div style="display:flex;justify-content:space-between;gap:0.5rem;font-size:0.78rem;line-height:1.4">
      <a href="/task/${encodeURIComponent(t.taskId)}" style="color:var(--color-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.taskId)}</a>
      <span style="flex:none;${emphasis ? "color:var(--color-accent-700);font-weight:700" : "color:var(--color-neutral-700)"}">${escapeHtml(tag)}</span>
    </div>`;
  }).join("");
  const liveCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">循环脉搏</div>
    <div style="font-weight:800">${escapeHtml(liveStateText)}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">在飞 ${live.inFlight.length} · 并发 ${live.concurrency}</p>
    ${live.status === "ok" && live.inFlight.length > 0 ? html`<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-divider);padding-top:6px">${liveMiniList}</div>` : ""}
    <a href="/live" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Live →</a>
  </div>`;

  const sysGo = d.sys.resourceGate.status === "ok" && d.sys.processBudget.status === "ok" &&
    d.sys.resourceGate.verdict === "GO" && d.sys.processBudget.verdict === "GO";
  const sysCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">系统资源</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.5">cpu_stall ${d.sys.resourceGate.cpuStallAvg10 != null ? escapeHtml(String(d.sys.resourceGate.cpuStallAvg10)) : "—"} · loadavg ${d.sys.resourceGate.loadAvg != null ? escapeHtml(String(d.sys.resourceGate.loadAvg)) : "—"}</p>
    <div style="font-weight:800;color:${sysGo ? "var(--color-accent-700)" : "var(--color-accent-800)"}">⇒ ${sysGo ? "GO" : d.sys.resourceGate.status === "ok" ? "WAIT" : "未接入"}</div>
    <a href="/system" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看系统状态 →</a>
  </div>`;

  const mgrAlive = d.mgr.liveness.sessions.filter((s) => s.alive).length;
  const mgrCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Manager / Outer / Inner</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.5">loop-driver: ${escapeHtml(d.mgr.loopDriver.verdict ?? "未接入")} · ${mgrAlive} 会话 LIVE</p>
    <a href="/manager" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看三层状态 →</a>
  </div>`;

  const counts = new Map<string, number>();
  for (const t of d.tasks) {
    const s = typeof t.status === "string" ? t.status : "unknown";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const statuses = [TASK_STATUS.DONE, TASK_STATUS.READY, TASK_STATUS.TODO, TASK_STATUS.NEEDS_HUMAN, TASK_STATUS.SUPERSEDED];
  const total = d.tasks.length;
  const bar = (s: string): string => {
    const c = counts.get(s) ?? 0;
    const pct = total > 0 ? (c / total) * 100 : 0;
    return html`<div style="width:${pct.toFixed(1)}%;background:${s === TASK_STATUS.DONE ? "var(--color-text)" : s === TASK_STATUS.NEEDS_HUMAN ? "var(--color-accent)" : "var(--color-neutral-400)"}" title="${escapeHtml(s)} ${c}"></div>`;
  };
  const recentActive = d.tasks
    .filter((t) => (t.status ?? "") !== TASK_STATUS.DONE && typeof (t as { updatedAt?: unknown }).updatedAt === "number")
    .sort((a, b) => ((b as { updatedAt?: unknown }).updatedAt as number) - ((a as { updatedAt?: unknown }).updatedAt as number))
    .slice(0, 5);

  // gap-webui-dashboard-tests-card-latest-round-no-live-signal: the card previously showed ONLY
  // tests.runs[0] — the ledger's latest COMPLETED round. Two failure modes on the real deployment:
  // (a) a suite genuinely running right now (`.quay/full-suite-state.json` state=running) has no
  //     ledger row yet, so the card silently showed a stale round instead of "运行中";
  // (b) a static-check gate failure round (fan-in's pre-test gate rejects before any test file runs)
  //     legitimately carries pass=0/tests=0 — true for THAT round, but rendered as bare "pass 0/0"
  //     it reads as "the whole suite has zero tests", which is false and unlike what /tests shows
  //     (the full history table gives that same round visible context: neighboring green rounds with
  //     thousands of tests). Now: prefer the LIVE running signal when present, label a gate-blocked
  //     round for what it is instead of a bare 0/0, and add a 近N轮 strip so the single latest row is
  //     never the only signal (硬规则4b: a single point is a proxy, not the actual health picture).
  const latestRun = d.tests.runs[0] ?? null;
  const suiteRunning = d.suiteRun && d.suiteRun.state === "running" ? d.suiteRun : null;
  const gateBlocked = latestRun != null && latestRun.tests === 0 && latestRun.pass === 0 && (latestRun.reason === "gate-failed" || latestRun.gate != null);
  const statusLine = suiteRunning
    ? html`<span style="color:var(--color-accent-700)">运行中</span>`
    : escapeHtml(latestRun ? (latestRun.state ?? "—") : "未接入");
  const elapsed = suiteRunning ? formatSuiteElapsed(suiteRunning.startedAt, Date.now()) : null;
  const detailLine = suiteRunning
    ? `已运行 ${elapsed ?? "—"}${suiteRunning.runner ? ` · runner ${escapeHtml(suiteRunning.runner)}` : ""}${suiteRunning.scope ? ` · scope ${escapeHtml(suiteRunning.scope)}` : ""}`
    : latestRun
      ? (gateBlocked
        ? `gate 未过${latestRun.gate ? `（${escapeHtml(latestRun.gate)}）` : ""}，未执行测试`
        : `pass ${latestRun.pass ?? "—"}/${latestRun.tests ?? "—"}`)
      : (d.tests.reason ? escapeHtml(d.tests.reason) : "无验证轮记录");
  const recentRuns = d.tests.runs.slice(0, 5);
  const recentStrip = recentRuns.length > 0
    ? html`<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--color-divider);padding-top:6px">
        <div style="font-size:0.7rem;color:var(--color-neutral-700)">近${recentRuns.length}轮（新→旧）</div>
        <div style="display:flex;gap:3px">${recentRuns.map((r) => {
          const color = r.state === "green" ? "var(--color-accent-700)" : r.state === "red" ? "var(--color-accent-800)" : "var(--color-neutral-400)";
          const rGateBlocked = r.tests === 0 && r.pass === 0 && (r.reason === "gate-failed" || r.gate != null);
          const title = `#${r.round ?? "?"} ${r.state ?? "—"}${rGateBlocked ? `（gate:${r.gate ?? "?"} 未执行测试）` : ` pass ${r.pass ?? "—"}/${r.tests ?? "—"}`}`;
          return html`<span title="${escapeHtml(title)}" style="width:11px;height:11px;border-radius:2px;background:${color};display:inline-block"></span>`;
        }).join("")}</div>
      </div>`
    : "";
  const testsCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">测试</div>
    <div style="font-weight:800">${statusLine}</div>
    <p style="margin:0;font-size:0.8rem;opacity:0.8">${detailLine}</p>
    ${recentStrip}
    <a href="/tests" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Tests →</a>
  </div>`;

  const recentCommits = d.history.status === "ok" ? d.history.commits.slice(0, 3).map((c) => `${c.hash.slice(0, 7)} ${c.subject}`).join("<br>") : (d.history.status === "empty" ? "无提交" : "读失败");
  const commitsCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">最近提交</div>
    <p style="margin:0;font-size:0.8rem;line-height:1.6;font-family:ui-monospace,monospace">${recentCommits}</p>
    <a href="/journal" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Journal →</a>
  </div>`;

  const taskCard = html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:6px">
    <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">任务台账速览</div>
    <div style="display:flex;height:14px;width:100%;overflow:hidden">${statuses.map(bar).join("")}</div>
    <div style="display:flex;gap:0.75rem;font-size:0.75rem;flex-wrap:wrap;color:var(--color-neutral-700)">
      ${statuses.map((s) => html`<span><b>${counts.get(s) ?? 0}</b> ${escapeHtml(s)}</span>`).join("")}
    </div>
    ${recentActive.length > 0 ? html`<div style="border-top:1px solid var(--color-divider);margin-top:2px;padding-top:8px;display:flex;flex-direction:column;gap:4px">
      <div style="font-size:0.7rem;color:var(--color-neutral-700)">最近更新（非 done）</div>
      ${recentActive.map((t) => html`<a href="/task/${encodeURIComponent(String(t.id))}" style="display:flex;justify-content:space-between;gap:8px;text-decoration:none;color:var(--color-text);font-size:0.75rem">
        <span style="font-weight:600;color:var(--color-accent)">${escapeHtml(String(t.id))}</span>
        <span style="flex:none">${escapeHtml(String(t.status ?? ""))}</span>
      </a>`).join("")}
    </div>` : ""}
    <a href="/tasks" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看任务列表 →</a>
  </div>`;

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay dashboard — 循环脉搏、任务台账、系统资源与三层状态总览">${modernistStyles()}${pageStyles()}<title>Dashboard</title></head>
    <body>${renderMobileChrome("dashboard", "dashboard")}${renderSiteNav("dashboard")}<main>
      <h1>Dashboard</h1>
      <p class="meta">循环脉搏、任务台账、系统资源与三层调度状态的总览 — 每张卡片指向对应完整页面。</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem">${liveCard}${sysCard}${mgrCard}</div>
      <h2>工作进展</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem">${taskCard}${testsCard}</div>
      <h2>变更记录</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px;background:var(--color-divider);border:1px solid var(--color-divider)">${commitsCard}${html`<div style="background:var(--color-surface);padding:1rem;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-700)">Git History</div>
        <p style="margin:0;font-size:0.8rem">提交纵向时间轴（develop 主干 + task 分支，第三方库客户端渲染）。</p>
        <a href="/git-history" style="font-size:0.8rem;color:var(--color-accent);text-decoration:none;margin-top:auto">查看 Git History →</a>
      </div>`}</div>
    </main></body></html>`;
}

// ── Task-summary short-TTL cache (dashboard display surface only) ────────────────────────────────
// gap-webui-dashboard-load-time-optimization AC3: the dashboard's taskCard shows only STATUS COUNTS
// + the 5 most-recently-updated non-done tasks, yet the pre-cache path called
// client.taskList({includeBody:false}) on EVERY /dashboard load — a full walkTasks() over the task
// store (listIds() → get() per id = readFileSync + statSync + YAML.parse). Measured ~89ms warm /
// ~640ms cold on the live store, plus the MCP subprocess round-trip. This cache (the poolMetricsCache
// 范式 in observation.ts: 30s TTL, keyed by workspaceRoot so two served workspaces never share a
// board) holds the whole frontmatter-only array the summary is derived from — on a hit,
// client.taskList is never called, so the provider's walkTasks never executes (the AC3 mechanical
// check). A 30s TTL bounds staleness: the dashboard is a display snapshot; the task store itself
// (which the promotion-driver writes on todo→ready) is always read fresh, never through this cache.
export const TASK_SUMMARY_CACHE_TTL_MS = 30_000;
const taskSummaryCache = new Map<string, { at: number; tasks: Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }> }>();

/** Test-hygiene handle: drop all cached task-summary readings. */
export function clearTaskSummaryCache(): void {
  taskSummaryCache.clear();
}

/** Dashboard task-summary source: client.taskList({includeBody:false}), short-TTL-cached per
 *  workspace root. On a hit the provider is not contacted, so its walkTasks() does not run (the AC3
 *  mechanical check). A failed read is NOT cached — the next load retries instead of pinning the
 *  error for the whole TTL (same fail-open policy as poolMetricsCache).
 *
 *  AC136 (gap-ac136-web-truth-source-follows-driver): the task ledger's truth source is the task
 *  store itself (tasks/*.md frontmatter) — the SAME store the promotion-driver writes on todo→ready.
 *  So a driver-completed promotion is reflected here (status count + 最近更新) within the 30s TTL,
 *  with no separate carrier read needed: reading client.taskList IS reading the driver's write
 *  target (口径一致). */
export async function readTaskSummary(
  root: string,
  client: ProviderClient,
): Promise<Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>> {
  const hit = taskSummaryCache.get(root);
  if (hit && Date.now() - hit.at < TASK_SUMMARY_CACHE_TTL_MS) return hit.tasks;
  const r = await client.taskList({ includeBody: false });
  const tasks = r.tasks ?? [];
  taskSummaryCache.set(root, { at: Date.now(), tasks });
  return tasks;
}

export async function handleDashboard(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: { workspaceRoot: string },
): Promise<void> {
  let live: LiveResult;
  try { live = readLive(cfg.workspaceRoot); } catch {
    live = { status: "error", reason: "internal", inFlight: [], concurrency: 0, cpuPressure: null, liveState: null, liveExplanation: null, activity: null };
  }
  // AC1 + AC2 (gap-webui-dashboard-load-time-optimization): the dashboard manager probe is now
  // readManagerLight — loop-driver + liveness ONLY, NO pool probe (the pool metrics are not shown on
  // the dashboard card; /manager still runs the full readManager).
  // readSystem + the light manager probe + the (cached) task summary are independent — run them
  // CONCURRENTLY (Promise.all); client.taskList is no longer serialized AFTER the sys/mgr group
  // (the prior gap-webui-dashboard-manager-slow-parallelize shape awaited it later).
  const [sys, mgr, tasks] = await Promise.all([
    readSystem(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", resourceGate: { status: "error" as const, reason: null, cpuStallAvg10: null, cpuStallAvg300: null, memAvailMb: null, loadAvg: null, nproc: null, nodeProcs: null, verdict: null, loadThreshold: null, loadOverFactor: null }, processBudget: { status: "error" as const, reason: null, totalBudget: null, inUse: null, available: null, verdict: null },
    })),
    readManagerLight(cfg.workspaceRoot).catch(() => ({
      status: "error" as const, reason: "internal", loopDriver: { status: "error" as const, reason: null, verdict: null, exitCode: null, detail: null }, liveness: { status: "error" as const, reason: null, sessions: [] }, observers: { status: "error" as const, reason: null, rows: [] }, pool: { status: "error" as const, reason: null, pool: null, floor: null, deficit: null, cap: null, lastPromoted: [] }, version: null, developLead: null,
    })),
    readTaskSummary(cfg.workspaceRoot, client).catch(() => [] as Array<{ id?: unknown; title?: unknown; status?: unknown; labels?: unknown; updatedAt?: unknown }>),
  ]);
  let tests: TestsResult;
  try { tests = readTests(cfg.workspaceRoot); } catch {
    tests = { status: "error", reason: "internal", runs: [] };
  }
  let suiteRun: CurrentSuiteRun | null;
  try { suiteRun = readCurrentSuiteRun(cfg.workspaceRoot); } catch { suiteRun = null; }
  let history: GitHistoryResult;
  try { history = readGitHistory(cfg.workspaceRoot); } catch {
    history = { status: "error", reason: "internal", commits: [], head: null, heads: {} };
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderDashboardPage({ live, sys, mgr, tests, suiteRun, history, tasks }));
}
