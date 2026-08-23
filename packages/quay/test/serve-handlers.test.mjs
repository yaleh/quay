// @test-group product
// gap-git-history-svg-server-rendered — /git-history must return a SERVER-RENDERED SVG whose
// x-axis is commit LANDING time (not duration), with zero <script> tags (AC4 zero client JS) and
// zero new dependencies. The two task traps are pinned by the renderer's contract and tested here:
//   Trap 1 — the x-axis is the commit landing moment, not a duration: git branch lifespan ≠ task
//            work hours (measured: 149/164 fan-in branches lived <1h — the task finished before its
//            first commit even landed). The test asserts x maps monotonically to commit time and the
//            page's note says 落地时刻/非工时.
//   Trap 2 — the chart does NOT fake knowing work hours: it draws only what git proves (points at
//            commit times, branch existence intervals, merges). No duration/work-hour marks exist.
//
// renderGitHistorySvg is a PURE function (deterministic on its input), so the x-axis semantic is
// unit-tested directly; the route is integration-tested against a real git-init'd workspace.
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
import { renderGitHistorySvg, groupCommitsByBranch, renderLoadCurveSvg, readSuiteLoadSamples } from "../src/serve-handlers.ts";
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

/** A commit fixture for the pure renderer (shape matches observation.GitHistoryCommit). */
function c(hash, t, ref, parents, subject) {
  return { hash, t, ref, parents, subject };
}

// ── AC3 unit: x-axis = landing time, monotonic; no duration semantics ──────────

test("AC3: renderGitHistorySvg maps x monotonically to commit landing time (not duration)", () => {
  const t0 = 1_700_000_000;
  const history = {
    status: "ok",
    reason: null,
    commits: [
      c("aaa0000", t0, "integration", 1, "base"),
      c("bbb0000", t0 + 3 * DAY, "integration", 1, "second"),
      c("ccc0000", t0 + 6 * DAY, "integration", 1, "third"),
    ],
  };
  const svg = renderGitHistorySvg(history);
  assert.ok(svg.startsWith("<svg"), "renderer returns an SVG document");
  assert.ok(svg.includes("</svg>"), "SVG is well-formed (closes </svg>)");

  // Lane circles (ignore the legend circle at a fixed x) — the three commits' cx must increase
  // strictly with time, pinning the x-axis semantic = commit landing time. (The circles carry the
  // AC102 token class attribute before cx, so match any <circle> tag.)
  const cxs = [...svg.matchAll(/<circle[^>]*cx="([0-9.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(cxs.length >= 4, `legend + 3 commit points present (got ${cxs.length})`);
  const lane = cxs.slice(1); // drop the legend marker
  assert.equal(lane.length, 3);
  assert.ok(lane[0] < lane[1] && lane[1] < lane[2],
    `x increases with commit time: ${lane.map((v) => v.toFixed(1)).join(" < ")}`);
});

test("AC3: single-instant window still renders a finite plot (no NaN), zero <script>", () => {
  const history = {
    status: "ok",
    reason: null,
    commits: [
      c("aaa0000", 1_700_000_000, "integration", 1, "only"),
      c("bbb0000", 1_700_000_000, "task/x", 2, "merge at same instant"),
    ],
  };
  const svg = renderGitHistorySvg(history);
  assert.ok(svg.includes("<svg"), "renders even when every commit shares one timestamp");
  assert.ok(!svg.includes("NaN"), "no NaN leaks into the SVG for a zero-width window");
  assert.ok(!svg.includes("<script"), "zero client JS: no <script> in the SVG");
});

test("AC3: merge commits are marked distinctly (orange diamond), regular commits blue circles", () => {
  const history = {
    status: "ok",
    reason: null,
    commits: [
      c("aaa0000", 1_700_000_000, "integration", 1, "base"),
      c("bbb0000", 1_700_000_100, "integration", 2, "merge fan-in"),
    ],
  };
  const svg = renderGitHistorySvg(history);
  // AC102: the chart's marks are token-derived CSS classes (git-svg-*), NOT hardcoded hex —
  // the commit/merge marks carry the token classes and the svg must contain zero color literals.
  assert.ok(svg.includes('class="git-svg-commit"'), "regular commit uses the token commit class");
  assert.ok(svg.includes('class="git-svg-merge"'), "merge commit uses the token merge class");
  assert.ok(!/#[0-9a-fA-F]{6}/.test(svg), "SVG carries no hardcoded hex (AC102②)");
  assert.ok(svg.includes('rotate(45'), "merge commit is a diamond (rotated square)");
  assert.ok(svg.includes("合并提交（fan-in 落地）"), "legend labels the merge kind");
});

test("AC3: degradation — non-ok or empty history renders no chart (page shows 无数据/读失败)", () => {
  assert.equal(renderGitHistorySvg({ status: "empty", reason: "x", commits: [] }), "");
  assert.equal(renderGitHistorySvg({ status: "error", reason: "y", commits: [] }), "");
  assert.equal(renderGitHistorySvg({ status: "ok", reason: null, commits: [] }), "");
});

test("groupCommitsByBranch groups into lanes sorted by most-recent landing, commits oldest-first", () => {
  const branches = groupCommitsByBranch([
    c("aaa", 1_700_000_000, "integration", 1, "a"),
    c("bbb", 1_700_000_300, "task/z", 1, "z"),
    c("ccc", 1_700_000_200, "integration", 1, "c"),
  ]);
  assert.deepEqual(branches.map((b) => b.ref), ["task/z", "integration"], "most-recent-landing branch first");
  const integration = branches.find((b) => b.ref === "integration");
  assert.deepEqual(integration.commits.map((x) => x.hash), ["aaa", "ccc"], "lane commits oldest→newest");
});

// ── AC2/AC4 integration: real git workspace, /git-history returns SVG, zero <script> ──

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

test("AC2/AC4: GET /git-history returns a server-rendered SVG page with zero <script> tags", async () => {
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

    // seed a task so startServer (which talks to the provider) has a store to read
    createStore(tasksDir).write("GH-1", { title: "git-history task", status: "todo" });

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const r = await get(port, "/git-history");
    assert.equal(r.status, 200, "GET /git-history returns 200");
    const svgCount = (r.body.match(/<svg/g) || []).length;
    assert.ok(svgCount >= 1, `AC2/band: response contains ≥1 <svg (got ${svgCount})`);
    assert.ok(r.body.includes("feature/alpha"), "chart shows the feature branch lane");
    assert.ok(r.body.includes("master") || r.body.includes("main"), "chart shows the main branch lane");
    const scriptCount = (r.body.match(/<script/g) || []).length;
    assert.equal(scriptCount, 0, `AC4/invariant: zero <script> tags (got ${scriptCount})`);
    assert.ok(r.body.includes("落地时刻"), "page disclaims the x-axis = landing time");
    assert.ok(r.body.includes("非工时"), "page explicitly says NOT work hours (the AC3 trap)");
    assert.ok(r.body.includes("分支汇总"), "accessibility: a data table view is present");

    // readGitHistory is also directly exercised (the route's data source)
    const hist = readGitHistory(ws);
    assert.equal(hist.status, "ok");
    assert.ok(hist.commits.some((x) => x.ref === "feature/alpha"), "git history source sees the feature branch");
    assert.ok(hist.commits.some((x) => x.parents > 1), "git history source sees a merge commit");
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

test("AC5: /git-history degrades to 200 「无数据」 on a non-git workspace (never 500)", async () => {
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
    assert.equal((r.body.match(/<script/g) || []).length, 0, "degraded page still has zero <script>");
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
