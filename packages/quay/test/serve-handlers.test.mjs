// @test-group product
// gap-git-history-vertical-graph-thirdparty-lib — /git-history renders a VERTICAL timeline (develop
// trunk + task-branch fork/merge lanes) via a third-party library (D3), and the 「零客户端 JS」
// invariant is retired site-wide (human ruling 2026-08-23, recorded in docs/webui-guide.md).
//
// layoutGitGraph is a PURE function (deterministic on its input) that computes the trunk + branch
// fork/merge structure BEFORE any SVG is drawn — AC1 (vertical trunk + fork/merge edges) and AC2
// (branches collapsed-by-default, carrying full commit lists for expansion) are tested directly on
// that output. The route is integration-tested against a real git workspace: the page carries an
// embedded JSON graph payload + an inlined D3 <script> (client JS is now permitted).
//
// Run (scoped): node --test packages/quay/test/serve-handlers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { layoutGitGraph, groupCommitsByBranch, renderLoadCurveSvg, readSuiteLoadSamples, renderPerFileTable, taskIdFromBranchRef } from "../src/serve-handlers.ts";
import { readGitHistory } from "../src/observation.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

const DAY = 86400;

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** A commit fixture (shape matches observation.GitHistoryCommit). `parentHashes` = parent hashes. */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}

/** A minimal ok GitHistoryResult for the pure layout. */
function hist(commits, head, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

// ── AC1 unit: layoutGitGraph computes the vertical trunk + branch fork/merge ──

test("AC1: layoutGitGraph yields a vertical trunk (first-parent chain) + branch fork/merge edges", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("a000000", t0, "master", [], "base"),
    c("b000000", t0 + 1, "master", ["a000000"], "trunk two"),
    c("x000000", t0 + 2, "task/x", ["b000000"], "branch commit"),
    c("m000000", t0 + 3, "master", ["b000000", "x000000"], "merge task/x"),
  ];
  const layout = layoutGitGraph(hist(commits, "m000000", { master: "m000000", "task/x": "x000000" }));
  assert.ok(layout, "an ok history yields a layout");
  // trunk = first-parent chain from HEAD, oldest → newest
  assert.deepEqual(layout.trunk.commits.map((x) => x.hash), ["a000000", "b000000", "m000000"], "trunk is the first-parent chain, oldest-first");
  assert.equal(layout.trunk.ref, "master", "trunk carries the mainline ref name");
  // the merge's second parent becomes a branch lane: fork at b, merge at m
  assert.equal(layout.branches.length, 1, "exactly one branch lane");
  const b = layout.branches[0];
  assert.equal(b.ref, "task/x", "branch ref name");
  assert.deepEqual(b.commits.map((x) => x.hash), ["x000000"], "branch commits are the lateral commits");
  assert.equal(b.fork, "b000000", "fork point = the trunk commit the branch diverged from");
  assert.equal(b.merge, "m000000", "merge point = the trunk merge commit");
});

test("AC1: a linear history has a trunk and NO branch lanes (negative control)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("a000000", t0, "master", [], "base"),
    c("b000000", t0 + 1, "master", ["a000000"], "two"),
    c("c000000", t0 + 2, "master", ["b000000"], "three"),
  ];
  const layout = layoutGitGraph(hist(commits, "c000000", { master: "c000000" }));
  assert.deepEqual(layout.trunk.commits.map((x) => x.hash), ["a000000", "b000000", "c000000"], "trunk = whole chain");
  assert.equal(layout.branches.length, 0, "no merge → no branch lanes");
});

test("AC2: branches are collapsed by default and carry full commits + time span for expansion", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("a000000", t0, "master", [], "base"),
    c("b000000", t0 + 1, "master", ["a000000"], "trunk"),
    c("x100000", t0 + 2, "task/x", ["b000000"], "branch one"),
    c("x200000", t0 + 3, "task/x", ["x100000"], "branch two"),
    c("m000000", t0 + 4, "master", ["b000000", "x200000"], "merge task/x"),
  ];
  const layout = layoutGitGraph(hist(commits, "m000000", { master: "m000000", "task/x": "x200000" }));
  const b = layout.branches[0];
  assert.equal(b.collapsed, true, "AC2: branch is collapsed by default");
  assert.equal(b.commits.length, 2, "the full commit list is present (for expansion)");
  assert.deepEqual(b.commits.map((x) => x.hash), ["x100000", "x200000"], "branch commits oldest → newest");
  assert.equal(b.firstT, t0 + 2, "firstT = oldest branch commit landing time");
  assert.equal(b.lastT, t0 + 3, "lastT = newest branch commit landing time (the time span)");
});

test("degradation: non-ok or empty history yields no layout", () => {
  assert.equal(layoutGitGraph({ status: "empty", reason: "x", commits: [], head: null, heads: {} }), null);
  assert.equal(layoutGitGraph({ status: "error", reason: "y", commits: [], head: null, heads: {} }), null);
  assert.equal(layoutGitGraph({ status: "ok", reason: null, commits: [], head: null, heads: {} }), null);
});

test("groupCommitsByBranch groups into lanes sorted by most-recent landing, commits oldest-first", () => {
  const branches = groupCommitsByBranch([
    c("aaa", 1_700_000_000, "integration", [], "a"),
    c("bbb", 1_700_000_300, "task/z", [], "z"),
    c("ccc", 1_700_000_200, "integration", [], "c"),
  ]);
  assert.deepEqual(branches.map((b) => b.ref), ["task/z", "integration"], "most-recent-landing branch first");
  const integration = branches.find((b) => b.ref === "integration");
  assert.deepEqual(integration.commits.map((x) => x.hash), ["aaa", "ccc"], "lane commits oldest→newest");
});

// ── integration: real git workspace, /git-history serves the vertical-graph JSON + inlined D3 ──

// ── AC1: branch names on the /git-history chart link out to their task's /task/<id> ──

test("AC1: taskIdFromBranchRef maps task/<id> → <id> and leaves non-task refs unlinked", () => {
  assert.equal(taskIdFromBranchRef("task/gap-git-history-clickable-branches-window"), "gap-git-history-clickable-branches-window");
  assert.equal(taskIdFromBranchRef("task/"), null, "a bare task/ prefix has no task id");
  assert.equal(taskIdFromBranchRef("develop"), null, "develop is a mainline ref, not a task");
  assert.equal(taskIdFromBranchRef("master"), null);
  assert.equal(taskIdFromBranchRef("integration"), null);
  assert.equal(taskIdFromBranchRef("verify/stale"), null);
  assert.equal(taskIdFromBranchRef("feature/alpha"), null);
});

function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  return { ws, tasksDir };
}

/**
 * git commit helper with a fixed clock so the chart has a non-trivial x window.
 * Each commit appends to its OWN file (per-branch), so the later `--no-ff` merge is conflict-free.
 */
function gitCommit(ws, msg, { t, file = "log.txt" }) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(t * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(t * 1000).toISOString(),
  };
  fs.appendFileSync(path.join(ws, file), `${msg}\n`);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws, env });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: ws, env });
}

test("integration: GET /git-history serves the vertical-graph JSON payload + an inlined D3 <script> (client JS now permitted)", async () => {
  const { ws, tasksDir } = makeWorkspace("gh-");
  const cwd0 = process.cwd();
  let server;
  try {
    // git init + an initial commit
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "git-history fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: ws });

    // main line commits, then a feature branch, then a merge (2-parent commit).
    // Timestamps are recent (within readGitHistory's active-branch window) so the fixture's branches
    // count as active lanes — gap-git-history-counts-stale-branches filters stale branches out.
    const nowSec = Math.floor(Date.now() / 1000);
    gitCommit(ws, "main one", { t: nowSec - 500 });
    gitCommit(ws, "main two", { t: nowSec - 400 });
    execFileSync("git", ["checkout", "-q", "-b", "feature/alpha"], { cwd: ws });
    gitCommit(ws, "feature alpha one", { t: nowSec - 300, file: "feature.txt" });
    gitCommit(ws, "feature alpha two", { t: nowSec - 200, file: "feature.txt" });
    execFileSync("git", ["checkout", "-q", "master"], { cwd: ws });
    gitCommit(ws, "main three", { t: nowSec - 100 });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "--no-ff", "feature/alpha", "-m", "merge feature/alpha"], { cwd: ws });

    // a task branch whose lane label must link to its task's detail page (AC1)
    execFileSync("git", ["checkout", "-q", "-b", "task/GH-1"], { cwd: ws });
    gitCommit(ws, "task work", { t: nowSec - 50, file: "task.txt" });
    execFileSync("git", ["checkout", "-q", "master"], { cwd: ws });

    // seed a task so startServer (which talks to the provider) has a store to read
    createStore(tasksDir).write("GH-1", { title: "git-history task", status: "todo" });

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const r = await get(port, "/git-history");
    assert.equal(r.status, 200, "GET /git-history returns 200");
    // AC1: the graph mount + embedded JSON payload (vertical trunk + fork/merge structure).
    assert.ok(r.body.includes('id="git-graph"'), "the vertical graph mount is present");
    assert.ok(r.body.includes('id="git-graph-data"'), "the embedded graph JSON payload is present");
    assert.ok(r.body.includes('"fork"'), "the JSON payload carries fork edges");
    assert.ok(r.body.includes('"merge"'), "the JSON payload carries merge edges");
    assert.ok(r.body.includes('"collapsed":true'), "AC2: branches are collapsed by default in the payload");
    assert.ok(r.body.includes("feature/alpha"), "the feature branch appears");
    assert.ok(r.body.includes("master") || r.body.includes("main"), "the main branch appears");
    // AC3: client JS + the third-party D3 library are now inlined (the retired zero-client-JS invariant).
    assert.ok(r.body.includes("d3js.org"), "the inlined D3 library is present");
    assert.ok((r.body.match(/<script/g) || []).length >= 3, "the page carries the data/lib/client <script> tags");
    assert.ok(r.body.includes("分支汇总"), "the server-rendered summary table is still present");
    // readGitHistory now exposes the DAG edges (parentHashes + heads) the layout consumes.
    const h = readGitHistory(ws);
    assert.equal(h.status, "ok");
    assert.ok(h.head, "readGitHistory resolves HEAD");
    assert.ok(h.commits.some((x) => x.parents > 1), "git history source sees a merge commit");
    assert.ok(h.commits.some((x) => x.parentHashes.length === 2), "a merge commit carries 2 parent hashes");
    const layout = layoutGitGraph(h);
    assert.ok(layout.branches.some((b) => b.ref === "feature/alpha"), "layout places the feature branch as a fork/merge lane");
    assert.ok(layout.branches.every((b) => b.collapsed === true), "AC2: every branch is collapsed by default");
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(cwd0);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5: /git-history degrades to 200 「无数据」 on a non-git workspace (never 500, no graph mount)", async () => {
  const { ws, tasksDir } = makeWorkspace("gh-deg-");
  const cwd0 = process.cwd();
  let server;
  try {
    // NO git init — the workspace is not a git repo
    createStore(tasksDir).write("GH-DEG", { title: "degraded", status: "todo" });
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const r = await get(port, "/git-history");
    assert.equal(r.status, 200, "non-git workspace still returns 200 (never 500)");
    assert.ok(r.body.includes("无数据"), "page renders 「无数据」 for a non-git workspace");
    assert.ok(!r.body.includes('id="git-graph"'), "no graph mount when there is no data to graph");
    assert.ok(!r.body.includes("d3js.org"), "no D3 library is inlined when there is no graph");
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(cwd0);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC127: GET /tests renders the buckets column — a bucket row shows its label, a legacy bucket-less row shows no fabricated \"full\"", async () => {
  const { ws, tasksDir } = makeWorkspace("tests-bucket-");
  const cwd0 = process.cwd();
  let server;
  try {
    // Oldest→newest file order: a legacy row (no bucket fields), then a bucket-mode row carrying the
    // AC126 fields. readTests presents newest-first, so the bucket row is the latest banner + first row.
    fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), [
      JSON.stringify({ round: 227, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519, state: "green", runner: "outer", scope: "worktree", commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9", pass: 900, fail: 0, cancelled: 0, tests: 900, failures: [] }),
      JSON.stringify({ round: 228, startedAt: "2026-08-22T00:00:00.000Z", durationMs: 366000, state: "green", runner: "outer", scope: "bucket", commit: "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f", pass: 500, fail: 0, cancelled: 0, tests: 500, failures: [], buckets: "M", bucket_files: 12, bucket_duration_ms: 366000 }),
    ].join("\n"));

    createStore(tasksDir).write("AC127-T", { title: "bucket web tests", status: "todo" });

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "GET /tests returns 200");
    assert.ok(r.body.includes("<th>buckets</th>"), "the history table has a buckets column");
    assert.ok(r.body.includes("<td>M</td>"), "the bucket row's cell shows its label M");
    assert.ok(r.body.includes("buckets M"), "the latest-run banner surfaces the bucket label");
    assert.ok(!r.body.includes("<td>full</td>"), "a legacy bucket-less row shows no fabricated \"full\" bucket cell");
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(cwd0);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── gap-test-detail-load-timeseries — suite-load curve (server-rendered SVG) ──────────

test("load curve: renderLoadCurveSvg draws the loadavg series as a pure SVG (zero <script>, zero hex, no NaN)", () => {
  const samples = [
    { t: 1_700_000_000_000, loadavg: 1.0, cpu_stall: 5.2, mem_avail: 9000.0 },
    { t: 1_700_000_005_000, loadavg: 3.5, cpu_stall: 30.1, mem_avail: 8500.0 },
    { t: 1_700_000_010_000, loadavg: 6.0, cpu_stall: 55.7, mem_avail: 8000.0 },
  ];
  const svg = renderLoadCurveSvg(samples);
  assert.ok(svg.startsWith("<svg"), "renderer returns an SVG document");
  assert.ok(svg.includes("</svg>"), "SVG is well-formed (closes </svg>)");
  assert.ok(svg.includes('class="load-svg-line"'), "the loadavg series is a stroke line (token class)");
  assert.ok(svg.includes("<polyline"), "the curve is a polyline");
  assert.ok(svg.includes('class="git-svg-commit"'), "sample points use the token point class");
  assert.ok(svg.includes("loadavg (1m)"), "the curve is labelled as the 1-minute load");
  assert.ok(!svg.includes("<script"), "zero client JS: no <script> in the SVG");
  assert.ok(!/#[0-9a-fA-F]{6}/.test(svg), "SVG carries no hardcoded hex (AC102 token discipline)");
  assert.ok(!svg.includes("NaN"), "no NaN leaks into the SVG");
});

test("load curve: single-sample / empty / all-null input degrades safely (never NaN, empty -> no chart)", () => {
  assert.equal(renderLoadCurveSvg([]), "", "empty samples -> no chart");
  assert.equal(
    renderLoadCurveSvg([{ t: 1_700_000_000_000, loadavg: null, cpu_stall: null, mem_avail: null }]),
    "",
    "all-null loadavg -> no plottable series -> no chart",
  );
  const single = renderLoadCurveSvg([{ t: 1_700_000_000_000, loadavg: 2.0, cpu_stall: 4.0, mem_avail: 7000.0 }]);
  assert.ok(single.startsWith("<svg"), "a single sample still renders a finite plot");
  assert.ok(!single.includes("NaN"), "single-sample window has no NaN");
});

test("load curve: readSuiteLoadSamples parses the sampler's jsonl, skips malformed lines, sorts by t", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "load-read-"));
  try {
    fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".quay", "suite-load-abc123.jsonl"),
      [
        JSON.stringify({ t: 3, loadavg: 2.0, cpu_stall: 3.0, mem_avail: 1000 }),
        "not-json",
        JSON.stringify({ t: 1, loadavg: 1.0, cpu_stall: 1.0, mem_avail: 900 }),
        JSON.stringify({ t: 2, loadavg: null, cpu_stall: null, mem_avail: null }),
        "",
      ].join("\n"),
    );
    const got = readSuiteLoadSamples(ws, "abc123");
    assert.equal(got.length, 3, "three valid lines parsed (malformed line + blank skipped)");
    assert.deepEqual(got.map((s) => s.t), [1, 2, 3], "samples sorted by t ascending");
    assert.equal(got[0].loadavg, 1.0);
    assert.equal(got[2].loadavg, 2.0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("load curve: GET /tests renders the server-side load curve for the current runId", async () => {
  const { ws, tasksDir } = makeWorkspace("tests-loadcurve-");
  const cwd0 = process.cwd();
  let server;
  try {
    createStore(tasksDir).write("LC-T", { title: "load curve web tests", status: "todo" });
    // full-suite-state.json carries the current runId; the sampler's file is keyed by it.
    const runId = "11111111-2222-3333-4444-555555555555";
    fs.writeFileSync(path.join(ws, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", runId }));
    fs.writeFileSync(
      path.join(ws, ".quay", `suite-load-${runId}.jsonl`),
      [
        JSON.stringify({ t: Date.now(), loadavg: 1.5, cpu_stall: 10.0, mem_avail: 8000.0 }),
        JSON.stringify({ t: Date.now() + 5000, loadavg: 4.5, cpu_stall: 40.0, mem_avail: 7500.0 }),
      ].join("\n"),
    );

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "GET /tests returns 200");
    assert.ok(r.body.includes("负载曲线"), "the page has a load-curve section");
    assert.ok(r.body.includes("suite-load-"), "the section names the sampler's timeseries source");
    assert.ok(r.body.includes("<polyline"), "the load curve is server-rendered SVG (no client chart lib)");
    assert.equal((r.body.match(/<script/g) || []).length, 0, "still zero <script> with the curve present");
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(cwd0);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── gap-test-detail-perfile-duration-failed: AC2 (perFile table render) ──────────────────────────

test("renderPerFileTable sorts by duration DESC, marks failed files red (verdict-fail), and renders nothing for empty/absent", () => {
  const perFile = [
    { file: "packages/quay/test/fast.test.mjs", durationMs: 12, passed: true },
    { file: "packages/quay/test/slow.test.mjs", durationMs: 210, passed: false },
    { file: "packages/quay/test/mid.test.mjs", durationMs: 100, passed: true },
  ];
  const out = renderPerFileTable(perFile);
  assert.ok(out.includes("perFile 耗时明细"), "renders the perFile table heading");
  // Sorted by duration DESC: slow (210) → mid (100) → fast (12). indexOf on a pure-function output
  // is unambiguous (no failureDetails / history table in the same string).
  const slowIdx = out.indexOf("slow.test.mjs");
  const midIdx = out.indexOf("mid.test.mjs");
  const fastIdx = out.indexOf("fast.test.mjs");
  assert.ok(slowIdx > -1 && midIdx > -1 && fastIdx > -1, "all three files present");
  assert.ok(slowIdx < midIdx && midIdx < fastIdx, `duration DESC order: slow(${slowIdx}) < mid(${midIdx}) < fast(${fastIdx})`);
  // The failed file carries verdict-fail (red); the passed files do not.
  assert.ok(/class="verdict-fail"/.test(out), "the failed file carries verdict-fail (red)");
  assert.ok(out.includes(">failed<"), "the failed file shows the failed label");
  assert.ok(out.includes(">passed<"), "the passed files show the passed label");
  // Absent/empty perFile ⇒ "" (no fabricated table — AC2's 无 perFile ⇒ 假 guard).
  assert.equal(renderPerFileTable(undefined), "");
  assert.equal(renderPerFileTable(null), "");
  assert.equal(renderPerFileTable([]), "");
});

test("AC2: GET /tests renders the perFile table (sorted, failed red) — a legacy no-perFile row renders no fabricated table", async () => {
  const { ws, tasksDir } = makeWorkspace("tests-perfile-");
  const cwd0 = process.cwd();
  let server;
  try {
    // Oldest→newest file order: a legacy row (no perFile), then a perFile-carrying row. readTests
    // presents newest-first, so the perFile row is the latest and its perFile table renders.
    fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), [
      JSON.stringify({ round: 227, startedAt: "2026-08-17T04:30:00.000Z", durationMs: 936519, state: "green", runner: "outer", scope: "worktree", commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9", pass: 900, fail: 0, cancelled: 0, tests: 900, failures: [] }),
      JSON.stringify({ round: 228, startedAt: "2026-08-23T00:00:00.000Z", durationMs: 500000, state: "red", runner: "outer", scope: "worktree", commit: "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f", pass: 1, fail: 1, cancelled: 0, tests: 2, failures: [], perFile: [{ file: "packages/quay/test/slow.test.mjs", durationMs: 210, passed: false }, { file: "packages/quay/test/fast.test.mjs", durationMs: 12, passed: true }] }),
    ].join("\n"));

    createStore(tasksDir).write("AC2-PF", { title: "perfile web tests", status: "todo" });

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "GET /tests returns 200");
    assert.ok(r.body.includes("perFile 耗时明细"), "the page renders the perFile table");
    const slowIdx = r.body.indexOf("slow.test.mjs");
    const fastIdx = r.body.indexOf("fast.test.mjs");
    assert.ok(slowIdx > -1 && fastIdx > -1, "both perFile files present");
    assert.ok(slowIdx < fastIdx, `duration DESC order (slow before fast): slow(${slowIdx}) < fast(${fastIdx})`);
    assert.ok(/class="verdict-fail"/.test(r.body), "failed file marked red (verdict-fail)");
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(cwd0);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC1/AC2: GET /tests renders a startedAt column per history row (carrier-sourced) and a clickable commit link (not pure StaticText)", async () => {
  const { ws, tasksDir } = makeWorkspace("tests-startedat-");
  const cwd0 = process.cwd();
  let server;
  try {
    // Oldest→newest: round 228 (startedAt appears ONLY in its history row, not the latest banner),
    // then round 229 (the latest banner). This lets AC1's assertion target the ROW rendering — the
    // round-228 startedAt cannot come from the latest-run banner, so it proves the row template emits it.
    fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), [
      JSON.stringify({ round: 228, startedAt: "2026-08-23T01:57:10.824Z", durationMs: 936519, state: "green", runner: "outer", scope: "worktree", commit: "426b21ceaabbe7502334d92d79ce4a4a8d935fe9", pass: 900, fail: 0, cancelled: 0, tests: 900, failures: [] }),
      JSON.stringify({ round: 229, startedAt: "2026-08-23T02:00:00.000Z", durationMs: 366000, state: "green", runner: "outer", scope: "full", commit: "37b8afcf9d09a5e5f5f5f5f5f5f5f5f5f5f5f5f", pass: 500, fail: 0, cancelled: 0, tests: 500, failures: [] }),
    ].join("\n"));

    createStore(tasksDir).write("AC-STARTED-T", { title: "startedAt web tests", status: "todo" });

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "GET /tests returns 200");
    assert.ok(r.body.includes("<th>startedAt</th>"), "the history table has a startedAt column header");
    // The round-228 timestamp is the NON-latest row → it can only appear via the history-row
    // template (the latest banner renders round-229's 02:00:00 value, never 228's).
    assert.ok(r.body.includes("2026-08-23T01:57:10.824Z"), "the round-228 row renders its startedAt timestamp");
    // AC2: the commit column is an <a> link (not pure StaticText), carrying the full commit hash.
    assert.ok(r.body.includes('href="/git-history?commit=426b21ceaabbe7502334d92d79ce4a4a8d935fe9"'), "the commit cell is a clickable link to /git-history?commit=<hash>");
    assert.ok(r.body.includes("<code>426b21ce</code>"), "the linked commit still shows its 8-char short hash");
  } finally {
    if (server) {
      server.close();
      if (server.client) await server.client.close();
    }
    process.chdir(cwd0);
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
