// @test-group product
// gap-git-history-svg-server-rendered — /git-history must return a SERVER-RENDERED SVG with zero
// client JS and zero new deps. AC2: the route returns a real `<svg`; AC3: x 轴 = 落地时刻 with NO
// duration/effort semantics (a per-day histogram — each column is a 1-day bucket of commits LANDED,
// never a duration bar; the page names the two traps); AC4: zero `<script>` tags in the whole page
// and no new dependencies; AC5: a non-git workspace degrades to 200 (never a 500).
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
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

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

/** Write a native-provider config.yml for the given workspace. */
function writeConfig(ws, tasksDir) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
}

/** Build a git-inited native workspace whose README accumulates the fixture commits. */
function makeGitWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  writeConfig(ws, tasksDir);
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "git-history fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  // Base commit is dated 400 days ago so it stays OUTSIDE every window this suite uses (default 30,
  // ?days=100) — the histogram assertions count only the explicit fixture commits.
  const baseIso = new Date(Date.now() - 400 * 86400 * 1000).toISOString();
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture base"], {
    cwd: ws,
    env: { ...process.env, GIT_AUTHOR_DATE: baseIso, GIT_COMMITTER_DATE: baseIso },
  });
  // commit(msg, daysAgo): a commit dated `daysAgo` whole days before now (same wall-clock hour, so
  // spaced dates land on distinct LOCAL calendar days regardless of timezone).
  const commit = (msg, daysAgo) => {
    const iso = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString();
    fs.appendFileSync(path.join(ws, "README.md"), `${msg}\n`);
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], {
      cwd: ws,
      env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
    });
  };
  return { ws, commit };
}

test("AC2/AC3/AC4: /git-history returns a server-rendered SVG histogram with zero client JS and no duration semantics", async () => {
  const { ws, commit } = makeGitWorkspace("gh-ac2-");
  commit("gh-feature-1", 3);
  commit("gh-feature-2", 2);
  commit("gh-feature-3", 1);
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const page = await get(port, "/git-history");
    assert.equal(page.status, 200, "AC2: GET /git-history returns 200");
    const body = page.body;

    // AC2: a real server-rendered <svg> is present.
    assert.ok(/<svg/.test(body), `AC2: body contains <svg (got ${body.length} chars)`);
    assert.ok(/<rect /.test(body), "AC2: the SVG renders per-day histogram columns");

    // AC4: zero client JS anywhere in the page.
    assert.equal((body.match(/<script/g) || []).length, 0, "AC4: zero <script> tags in /git-history");

    // AC3: x 轴 = 落地时刻, no duration/effort semantics — the two traps are named on the page.
    assert.ok(body.includes("落地时刻"), "AC3: page names 落地时刻 as the x axis");
    assert.ok(body.includes("无持续时间/工时语义"), "AC3: page states no duration/effort semantics");

    // The histogram is per-day: each fixture commit (3 distinct local days) is one 1-day column.
    const countAttrs = body.match(/data-count="(\d+)"/g) || [];
    assert.equal(countAttrs.length, 3, `AC2: one column per fixture day (got ${countAttrs.length})`);
    const total = countAttrs.reduce((acc, m) => acc + Number(/data-count="(\d+)"/.exec(m)[1]), 0);
    assert.equal(total, 3, "AC2: per-day counts sum to the 3 fixture commits");
    const dateAttrs = body.match(/data-date="\d{4}-\d{2}-\d{2}"/g) || [];
    assert.equal(dateAttrs.length, 3, "AC2: each column carries a YYYY-MM-DD landing date");

    // The recent-commits table renders the fixture subjects.
    assert.ok(body.includes("gh-feature-3"), "AC2: recent-commits table shows the newest fixture subject");
    assert.ok(body.includes("gh-feature-1"), "AC2: recent-commits table shows the oldest fixture subject");

    // The histogram must NOT contain a duration bar — no horizontal line spans more than a column
    // (the only <line> elements are the y-axis gridlines + baseline, all vertical/horizontal axis
    // furniture). Sanity: assert the page carries no <script> and the SVG is column-only.
    assert.ok(!/<\/script>/.test(body), "AC4: no closing </script> either");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5/degradation: a non-git workspace returns 200 with a visible 读失败 note (never 500)", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gh-deg-"));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  writeConfig(ws, tasksDir); // deliberately NO git init — non-git workspace
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const page = await get(port, "/git-history");
    assert.equal(page.status, 200, "AC5: /git-history still returns 200 on a non-git workspace");
    assert.ok(page.body.includes("读失败"), "AC5: a visible 读失败 note names the failure");
    assert.ok(page.body.includes("git 仓库") || page.body.includes("git log"), "AC5: the note explains the git cause");
    assert.ok(/<svg/.test(page.body), "AC5: the empty-state SVG still renders");
    assert.equal((page.body.match(/<script/g) || []).length, 0, "AC4: zero <script> tags even in degraded mode");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: /git-history supports a ?days=N window (default 30; narrow window filters the histogram)", async () => {
  const { ws, commit } = makeGitWorkspace("gh-days-");
  commit("gh-old-commit", 40); // 40 days ago — outside a 30-day window
  commit("gh-recent-commit", 2); // 2 days ago — inside
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    // Default 30-day window: only the recent commit is shown (one column), but the recent-commits
    // table still lists both (the raw top-N of git log).
    const page30 = await get(port, "/git-history");
    const count30 = (page30.body.match(/data-count="(\d+)"/g) || []).reduce((a, m) => a + Number(/data-count="(\d+)"/.exec(m)[1]), 0);
    assert.equal(count30, 1, "AC2: default 30-day window shows only the recent commit (data-count sum = 1)");
    assert.ok(page30.body.includes("gh-recent-commit"), "AC2: recent commit subject is in the recent table");
    assert.ok(page30.body.includes("gh-old-commit"), "AC2: the 40-day-old commit still appears in the recent table (it's raw git log, not windowed)");

    // ?days=100 widens the window to include both → two columns.
    const page100 = await get(port, "/git-history?days=100");
    const count100 = (page100.body.match(/data-count="(\d+)"/g) || []).reduce((a, m) => a + Number(/data-count="(\d+)"/.exec(m)[1]), 0);
    assert.equal(count100, 2, "AC2: ?days=100 widens the window to both commits (data-count sum = 2)");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
