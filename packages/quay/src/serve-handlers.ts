// serve-handlers.ts — route dispatcher + re-export barrel for quay serve.
// M100 extracted the route handler bodies here from serve.ts; gap-serve-handlers-split-by-concern
// split this 3559-line monolith into per-concern files (serve-render/task/adr/goal/doc/live/board/
// git/system/tests/sessions/architecture/dashboard). This file now holds ONLY the route dispatcher
// (handleAllRoutes) and re-exports the public surface so existing importers (serve.ts + tests) are
// unchanged.
//
// IMPORTANT: This file MUST NOT import from ./serve.ts (would create circular import).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import type { Manifest } from "./serve-render.ts";

import { handleTaskList, handleTaskDetail } from "./serve-task.ts";
import { handleAdrList, handleAdrDetail } from "./serve-adr.ts";
import { handleGoalList, handleGoalDetail } from "./serve-goal.ts";
import { handleDocList, handleDocDetail } from "./serve-doc.ts";
import { handleLive, handleJournal } from "./serve-live.ts";
import { handleBoard } from "./serve-board.ts";
import { handleGitHistory, handleGitHistoryJson } from "./serve-git.ts";
import { handleSystem, handleManager } from "./serve-system.ts";
import { handleTests, handleTestsFile } from "./serve-tests.ts";
import { handleSessions, handleSession, handleSessionEarlier, handleSessionDownload, handleDriverLifecycle, handleNewSession, handleResumeSession, handleFanInLogView, handleFanInLogDownload } from "./serve-sessions.ts";
import { handleArchitecture } from "./serve-architecture.ts";
import { handleDashboard, handleDashboardCards } from "./serve-dashboard.ts";
import { handleSend } from "./serve-send.ts";
import { handleNeedsHuman } from "./serve-needs-human.ts";

// Re-export the full public surface (shared render helpers + domain render/handler functions) so
// serve.ts's named re-exports and existing test imports remain unchanged.
export * from "./serve-render.ts";
export * from "./serve-task.ts";
export * from "./serve-adr.ts";
export * from "./serve-goal.ts";
export * from "./serve-doc.ts";
export * from "./serve-live.ts";
export * from "./serve-board.ts";
export * from "./serve-git.ts";
export * from "./serve-system.ts";
export * from "./serve-tests.ts";
export * from "./serve-sessions.ts";
export * from "./serve-architecture.ts";
export * from "./serve-dashboard.ts";
export * from "./serve-send.ts";
export * from "./serve-needs-human.ts";

// ── Facade dispatcher (M99 pattern: single entry point keeps startServer outDegree low) ──

export async function handleAllRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: { workspaceRoot: string },
): Promise<void> {
  const url = new URL(req.url as string, `http://${req.headers.host}`);

  // gap-webui-session-lifecycle: the three lifecycle POST routes (headless driver start/stop/restart,
  // new -p session, --resume restart). Dispatched on METHOD, before the GET matchers below (a GET on
  // these paths falls through to the /sessions page or 404). Interactive manager/outer/inner
  // stop/restart is deliberately NOT routed (AC3). This block intercepts ONLY the three lifecycle
  // paths — any other POST (e.g. /send) falls through to the path matchers below (⛔ a catch-all
  // 404 here would shadow the /send route and break message delivery).
  if (req.method === "POST") {
    if (url.pathname === "/sessions/driver") {
      await handleDriverLifecycle(req, res, cfg);
      return;
    }
    if (url.pathname === "/sessions/new") {
      await handleNewSession(req, res, cfg);
      return;
    }
    if (url.pathname === "/sessions/resume") {
      await handleResumeSession(req, res, cfg);
      return;
    }
  }

  // gap-webui-root-should-show-dashboard: `/` is the design's landing page → dashboard.
  // AC95 had kept `/` wired to the legacy task list; the design (state.page: 'dashboard' default,
  // navGroupDefs 核心 order [dashboard, tasks]) says dashboard lands first. `/` now 302s to the
  // canonical /dashboard, and the task list moves to its own /tasks route (still nav-reachable).
  if (url.pathname === "/") {
    res.writeHead(302, { Location: "/dashboard" });
    res.end();
    return;
  }

  if (url.pathname === "/tasks") {
    await handleTaskList(req, res, url, client, manifest, cfg);
    return;
  }

  // AC95: the six new design views. dashboard needs the provider taskList (task-ledger card);
  // the rest read workspace observation via observation.ts (mechanism scripts / git / suite-state).
  if (url.pathname === "/dashboard") {
    await handleDashboard(req, res, client, manifest, cfg);
    return;
  }

  // gap-dashboard-testscard-livecard-auto-refresh — the JSON data endpoint the dashboard liveCard/
  // testsCard auto-refresh script polls. Re-renders ONLY those two cards (no sys/mgr/tasks probes).
  if (url.pathname === "/dashboard/cards") {
    await handleDashboardCards(req, res, client, cfg);
    return;
  }

  if (url.pathname === "/system") {
    await handleSystem(req, res, cfg);
    return;
  }

  if (url.pathname === "/manager") {
    await handleManager(req, res, cfg);
    return;
  }

  if (url.pathname === "/tests") {
    await handleTests(req, res, cfg, url);
    return;
  }

  // gap-webui-test-file-detail-page AC1 — the single-file cross-round detail page. `path` is the
  // repo-rel path (URL-encoded by the /tests perFile links); absent ⇒ the page renders 「未找到」.
  if (url.pathname === "/tests/file") {
    await handleTestsFile(req, res, cfg, url);
    return;
  }

  if (url.pathname === "/sessions") {
    await handleSessions(req, res, cfg);
    return;
  }

  // gap-sessions-page-slow-unclickable-flat-render AC3: the detail page's scroll-loader fetches the
  // next chunk of earlier turns here. Same strict-UUID lookup key as /session/<id>; a non-UUID segment
  // resolves to null → 400. Routed BEFORE the single-session matcher (distinct path shape, `/earlier`
  // suffix), so it can never be swallowed by the `/session/([^/]+)` regex below.
  const sessionEarlierM = /^\/session\/([^/]+)\/earlier$/.exec(url.pathname);
  if (sessionEarlierM) {
    let sessionId: string;
    try { sessionId = decodeURIComponent(sessionEarlierM[1]); } catch { sessionId = sessionEarlierM[1]; }
    await handleSessionEarlier(req, res, cfg, sessionId, url);
    return;
  }

  // gap-webui-session-detail-view — the single-session view, addressed by sessionId (§7.1). The id is
  // validated as a strict UUID inside readSession (lookup key, never a path component — §7.4). A
  // malformed %-escape falls back to the raw segment, which then fails UUID validation → honest
  // 「非法」 empty state rather than a 500.
  const sessionM = /^\/session\/([^/]+)$/.exec(url.pathname);
  if (sessionM) {
    let sessionId: string;
    try { sessionId = decodeURIComponent(sessionM[1]); } catch { sessionId = sessionM[1]; }
    await handleSession(req, res, cfg, sessionId);
    return;
  }

  // gap-worker-task-transcript-access-webui AC3: raw JSONL download for a transcript session. Same
  // strict-UUID lookup key as the view; the handler resolves it through sessionTranscriptPath (UUID
  // regex → fixed project slug join), so a non-UUID / traversal segment is rejected with 400, never
  // used as a path component. A malformed %-escape falls back to the raw segment → fails UUID
  // validation → honest 400 rather than a 500.
  const sessionDlM = /^\/session\/([^/]+)\/download$/.exec(url.pathname);
  if (sessionDlM) {
    let sessionId: string;
    try { sessionId = decodeURIComponent(sessionDlM[1]); } catch { sessionId = sessionDlM[1]; }
    await handleSessionDownload(req, res, cfg, sessionId);
    return;
  }

  // gap-webui-message-delivery-entry — POST /send delivers a message to a local session and renders
  // the honest four-state result (delivered/held/expired/error). The sessionId is in the form body
  // (a UUID look-up key), resolved through the same /session addressing path; the handler reuses the
  // shared send-to-session socket protocol (never a second copy of the frame logic).
  if (url.pathname === "/send" && req.method === "POST") {
    await handleSend(req, res, cfg);
    return;
  }

  if (url.pathname === "/architecture") {
    await handleArchitecture(req, res, cfg);
    return;
  }

  // gap-web-cannot-show-what-the-loop-is-doing-now: /live + /journal are the loop-observation
  // surface. They read workspace observation files through the observation.ts facade (the ONLY
  // module allowed to know `.workflow-events/`, `orchestration/`, `git`), never directly.
  if (url.pathname === "/live") {
    await handleLive(req, res, cfg);
    return;
  }

  if (url.pathname === "/journal") {
    await handleJournal(req, res, cfg);
    return;
  }

  // gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead AC5: /git is the short alias
  // people type for the git history view; it 302s to the canonical /git-history (the old bare /git
  // returned 404 and left a console error).
  if (url.pathname === "/git") {
    res.writeHead(302, { Location: "/git-history" });
    res.end();
    return;
  }

  // gap-git-history-svg-server-rendered: server-rendered git history SVG. Reads git via the same
  // workspace-observation path as /live + /journal (observation.ts shells out to git too).
  if (url.pathname === "/git-history") {
    await handleGitHistory(req, res, cfg, url);
    return;
  }

  // gap-git-graph-drops-commits-while-overflowcount-reports-zero: the on-demand pagination endpoint
  // the scroll loader calls. Distinct path shape from /git-history (the `.json` suffix), routed AFTER
  // the HTML page matcher so the two never shadow each other.
  if (url.pathname === "/git-history.json") {
    await handleGitHistoryJson(req, res, cfg, url);
    return;
  }

  // gap-web-board-needs-an-inconsistency-verdict-it-does-not-have: /board joins 意图/执行/落地
  // and renders the four inconsistency flags. The landing judgment is REUSED from the drift
  // checker (observation.ts's readBoardLanding) so per-task agreement holds by construction.
  if (url.pathname === "/board") {
    await handleBoard(req, res, url, client, manifest, cfg);
    return;
  }

  // gap-ac146-human-interface-explicit-owner: the explicit human owner interface for needs-human
  // tasks — joins 当前待办 (store status) + 升级台账 (.quay/promotion-outcome.jsonl), no transcript.
  if (url.pathname === "/needs-human") {
    await handleNeedsHuman(req, res, client, manifest, cfg);
    return;
  }

  if (url.pathname === "/adr") {
    await handleAdrList(req, res, url, client);
    return;
  }

  const adrM = /^\/adr\/([^/]+)$/.exec(url.pathname);
  if (adrM) {
    const id = decodeURIComponent(adrM[1]);
    await handleAdrDetail(req, res, id, client);
    return;
  }

  // /goal + /doc — SPEC §4: the third sibling kind's route, done TOGETHER with /doc
  // (which had NO route — grep -c document = 0), both following the /adr shape. The
  // goal page shows target / criterion / status / recent verdict+time / origin.
  if (url.pathname === "/goal") {
    await handleGoalList(req, res, url, client, cfg.workspaceRoot);
    return;
  }

  const goalM = /^\/goal\/([^/]+)$/.exec(url.pathname);
  if (goalM) {
    const id = decodeURIComponent(goalM[1]);
    await handleGoalDetail(req, res, id, client, cfg.workspaceRoot);
    return;
  }

  if (url.pathname === "/doc") {
    await handleDocList(req, res, url, cfg);
    return;
  }

  const docM = /^\/doc\/([^/]+)$/.exec(url.pathname);
  if (docM) {
    const id = decodeURIComponent(docM[1]);
    await handleDocDetail(req, res, id, cfg);
    return;
  }

  const taskM = /^\/task\/([^/]+)$/.exec(url.pathname);
  if (taskM) {
    const id = decodeURIComponent(taskM[1]);
    await handleTaskDetail(req, res, url, id, client, cfg);
    return;
  }

  // gap-mech-fan-in-log-webui-visible-clickable B3: the mechanical fan-in process log's
  // view/download routes. task + file are each decoded with a malformed-%-escape fallback, then
  // rejected by fanInLogPath's strict slug + filename whitelist BEFORE any disk read (same
  // traversal-proof house pattern as /session/<id>/download). The download matcher is checked FIRST
  // (distinct `/download` suffix), so it can never be swallowed by the view matcher below.
  const fanInLogDlM = /^\/fan-in-log\/([^/]+)\/([^/]+)\/download$/.exec(url.pathname);
  if (fanInLogDlM) {
    let task: string;
    let file: string;
    try { task = decodeURIComponent(fanInLogDlM[1]); } catch { task = fanInLogDlM[1]; }
    try { file = decodeURIComponent(fanInLogDlM[2]); } catch { file = fanInLogDlM[2]; }
    await handleFanInLogDownload(req, res, cfg, task, file);
    return;
  }

  const fanInLogM = /^\/fan-in-log\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (fanInLogM) {
    let task: string;
    let file: string;
    try { task = decodeURIComponent(fanInLogM[1]); } catch { task = fanInLogM[1]; }
    try { file = decodeURIComponent(fanInLogM[2]); } catch { file = fanInLogM[2]; }
    await handleFanInLogView(req, res, cfg, task, file);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}
