// @test-group product
// gap-webui-list-table-no-overflow-container — the shared data-table shell.
//
// Pre-fix (measured on a production instance, 2026-09-08): the ONLY horizontal-scroll fallback for a
// wide table lived under `.detail-page` (detailStyles' ≤600px media query), so the data-dense LIST
// pages (/goal /live /board /needs-human /tests) had no scroll rule — a table wider than its container
// widened the page (desktop /goal scrollWidth 1825 vs 1440) and the base sheet's mobile
// `table { display:block }` hack broke the table's real layout (headers folded to vertical single
// chars). There was no single shared rule for "wide table scrolls / prose column narrows".
//
// The fix: one shared shell in serve-render.ts — `.table-wrap` (a plain scroll container) + the
// `tableWrap()` helper, applied to every list-page <table>; `.table-wrap th { white-space: nowrap }`
// so a header never folds to vertical single chars; `.clamp` for prose columns; and `.body code
// { overflow-wrap: anywhere }` so long inline code (a /journal commit hash) wraps instead of widening
// the page. The scrollWidth/clientWidth, row-height, and header boundingRect readings are LIVE-BROWSER
// verification (chrome-devtools MCP, recorded in the commit message) — this file asserts the
// mechanically-checkable conditions that make those browser readings true, forever, without a browser.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { pageStyles, tableWrap } from "../src/serve-render.ts";
import { renderLivePage } from "../src/serve-live.ts";
import { renderBoardPage } from "../src/serve-board.ts";
import { renderNeedsHumanPage } from "../src/serve-needs-human.ts";
import { renderPerFileTable, renderFileHistoryTable } from "../src/serve-tests.ts";
import { handleGoalList } from "../src/serve-goal.ts";
import { startServer } from "../src/serve.ts";
import { clearVerificationRoundCache } from "../src/observation.ts";
import { makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function captureRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body || ""; },
  };
}

/** Count of real <table> tags (the inlined <style> CSS mentions `.table-wrap table` but never `<table`). */
const tableCount = (html) => (html.match(/<table\b/g) || []).length;
/** Count of tables that are the direct child of a .table-wrap scroll container. */
const wrappedTableCount = (html) => (html.match(/<div class="table-wrap">\s*<table\b/g) || []).length;

function assertAllTablesWrapped(html, label) {
  const total = tableCount(html);
  const wrapped = wrappedTableCount(html);
  assert.ok(total > 0, `${label}: expected at least one <table>`);
  assert.equal(wrapped, total, `${label}: every <table> must sit inside .table-wrap (wrapped ${wrapped}/${total})`);
}

// ── AC2 (selector): the shared scroll rule is NOT scoped to .detail-page ──────────────────────────

test("AC2: the shared scroll rule is unscoped (no .detail-page) and keeps display:table", () => {
  const css = pageStyles();
  const wrapRule = css.match(/\.table-wrap\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(wrapRule, /overflow-x:\s*auto/, ".table-wrap carries overflow-x: auto");
  assert.doesNotMatch(wrapRule, /\.detail-page/, ".table-wrap selector must not be limited to .detail-page");
  assert.match(css, /\.table-wrap\s+table\s*\{[^}]*display:\s*table/, ".table-wrap table keeps display:table (beats the ≤600px display:block hack)");
  assert.match(css, /\.table-wrap\s+table\s*\{[^}]*min-width:\s*100%/, ".table-wrap table fills the wrap when narrow");
});

// ── AC4: wrapped headers never fold to vertical single chars ──────────────────────────────────────

test("AC4: wrapped table headers are nowrap (never fold to vertical single chars)", () => {
  const css = pageStyles();
  assert.match(css, /\.table-wrap\s+th\s*\{[^}]*white-space:\s*nowrap/, ".table-wrap th is white-space: nowrap");
});

// ── AC3 (prose clamp rule present): the .clamp mechanism the prose columns route through ──────────

test("AC3: the .clamp prose rule exists (max-width + ellipsis)", () => {
  const css = pageStyles();
  assert.match(css, /\.clamp\s*\{[^}]*max-width/, ".clamp sets a max-width");
  assert.match(css, /\.clamp\s*\{[^}]*text-overflow:\s*ellipsis/, ".clamp ellipsizes overflow");
});

// ── the tableWrap helper is the single shell ──────────────────────────────────────────────────────

test("tableWrap wraps a table in a .table-wrap scroll container", () => {
  assert.equal(
    tableWrap("<table><tr><td>x</td></tr></table>"),
    '<div class="table-wrap"><table><tr><td>x</td></tr></table></div>',
  );
});

// ── AC2: every list-page <table> is wrapped (per-page render, pure functions) ─────────────────────

test("AC2: /live in-flight table is wrapped", () => {
  const live = {
    status: "ok",
    reason: null,
    liveState: "running",
    liveExplanation: null,
    activity: null,
    concurrency: 1,
    cpuPressure: null,
    inFlight: [{
      taskId: "gap-webui-list-table-no-overflow-container",
      runId: "run-123456",
      pid: "12345",
      sessionId: "sess-1",
      startedAtMs: Date.now(),
      implCompletedAtMs: null,
      status: "ready",
      phase: "implementing",
      suite: null,
      minutes: 5.0,
      liveness: "alive",
      blocks: ["gap-other-task-with-a-long-id"],
      blockedBy: [],
    }],
  };
  assertAllTablesWrapped(renderLivePage(live), "/live");
});

test("AC2: /board table is wrapped", () => {
  const board = {
    landing: { status: "ok", scanned: 1, reason: null, timedOut: false },
    execution: { status: "ok", inFlight: [], reason: null },
    intentStatus: "ok",
    intentReason: null,
    rows: [{ id: "gap-task", title: "t", status: "done", labels: ["gap"], landingFlag: null, execFlags: [], inFlightMinutes: null, awaitingLand: false }],
  };
  assertAllTablesWrapped(renderBoardPage(board), "/board");
});

test("AC2: /needs-human tables are wrapped and the prose column is clamped", () => {
  const active = [{ id: "gap-needs-human-task", title: "title", labels: ["gap"], reason: "a long blocking reason that should be clamped" }];
  const ledger = [{ taskId: "gap-old", detail: "detail", ts: "2026-01-01T00:00:00Z" }];
  const html = renderNeedsHumanPage(active, ledger, { name: "quay" });
  assert.equal(tableCount(html), 2, "/needs-human renders two tables (active + ledger)");
  assertAllTablesWrapped(html, "/needs-human");
  assert.match(html, /class="clamp"/, "/needs-human clamps its prose column");
});

test("AC2: /tests perFile + file-history tables are wrapped", () => {
  const perFile = [{ file: "packages/quay/src/serve-render.ts", durationMs: 1234, passed: true }];
  assertAllTablesWrapped(renderPerFileTable(perFile), "/tests perFile");
  const fh = renderFileHistoryTable([{ round: 1, startedAt: "2026-01-01T00:00:00Z", durationMs: 100, passed: true }]);
  assertAllTablesWrapped(fh, "/tests file history");
});

// ── AC2/AC3: /goal (handler-level) — wrapped + fixed-layout prose clamp ───────────────────────────

test("AC2/AC3: /goal list table is wrapped and fixed-layout (prose clamped, single-line rows)", async () => {
  const client = {
    goalList: async () => [
      { id: "GOAL-001", title: "a goal title", status: "active", kind: "goal", goal: "", criterion: "", lastProgressAt: "", firstEvidenceAt: "", evidence: null, body: "" },
    ],
  };
  const res = captureRes();
  await handleGoalList({}, res, new URL("http://localhost/goal"), client);
  assert.equal(res.statusCode, 200);
  assertAllTablesWrapped(res.body, "/goal");
  assert.match(res.body, /table-layout:\s*fixed/, "/goal table is table-layout:fixed (never wider than <main>)");
  assert.match(res.body, /text-overflow:\s*ellipsis/, "/goal cells ellipsize prose");
});

// ── AC2: /tests history table (server-level) is wrapped ───────────────────────────────────────────

test("AC2: /tests history table is wrapped (server)", async () => {
  const { workspaceRoot } = makeTmpWorkspace("gap-list-table-ac2-", { nativeBin, nativeProviderDir });
  const seed = [{ round: 1, startedAt: new Date(1_700_000_000_000).toISOString(), durationMs: 30_000, state: "green", pass: 40, fail: 0, cancelled: 0, tests: 43 }];
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "verification-round.jsonl"), seed.map((r) => JSON.stringify(r)).join("\n") + "\n");
  clearVerificationRoundCache();

  const cwd0 = process.cwd();
  let server;
  try {
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    const port = server.address().port;
    const res = await get(port, "/tests");
    assert.equal(res.status, 200, "GET /tests returns 200");
    assertAllTablesWrapped(res.body, "/tests history");
  } finally {
    process.chdir(cwd0);
    if (server) { await new Promise((r) => server.close(r)); if (server.client) await server.client.close(); }
  }
});
