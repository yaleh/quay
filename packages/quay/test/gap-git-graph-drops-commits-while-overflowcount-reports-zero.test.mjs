// @test-group product
// gap-git-graph-drops-commits-while-overflowcount-reports-zero — /git-history 一次性拉取
// GIT_HISTORY_LIMIT=500 条、无分页入口；本仓库约 690 提交/天 ⇒ 页面只覆盖 15-17 小时。修法：
//   AC1  /git-history.json?before=<t>&limit=<n> 返回一份完整 GitGraphLayout JSON，commitCount 反映 limit。
//   AC2  负控制：旧的「全部 ref 塞进一次全局 -n limit」会挤掉长期活跃非 mainline 分支的提交；按 ref
//        分别取不会 —— 判据能区分新旧（证明按 ref 取数是必要的，不是装饰）。
//   AC3  生产读数：before=<默认 500 窗口下界时间戳> 返回更旧的提交（端点真能往回翻，不是重复同一批）。
//   AC4  客户端集成：渲染后的 HTML 含 sentinel 元素 + 调用该端点的脚本（Playwright 滚动实测在 DoD）。
//   AC5  覆盖时长：由已加载提交的实际时间跨度算出（fixture 断言随窗口扩大而增大，不是写死常量）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-drops-commits-while-overflowcount-reports-zero.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readGitHistory, clearGitHistoryCache } from "../src/observation.ts";
import { gitHistoryJson, coverageSpanSeconds, formatCoverageSpan, renderGitHistoryPage, layoutGitGraph, handleGitHistoryJson } from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Commit helper with a fixed clock (committer date = author date = `t`), per-branch file. */
function commitAt(ws, msg, t, file = "log.txt") {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(t * 1000).toISOString(),
    GIT_COMMITTER_DATE: new Date(t * 1000).toISOString(),
  };
  fs.appendFileSync(path.join(ws, file), `${msg}\n`);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws, env });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: ws, env });
}

/** A synthetic ok GitHistoryResult for the pure layout / page / json helpers. */
function c(hash, t, ref, parentHashes, subject) {
  return { hash, t, ref, parents: parentHashes.length, parentHashes, subject };
}
function hist(commits, head = commits.length ? commits[commits.length - 1].hash : null, heads = {}) {
  return { status: "ok", reason: null, commits, head, heads };
}

function mockRes() {
  let status = 0;
  let body = "";
  return {
    writeHead: (s) => { status = s; },
    end: (b) => { body = String(b); },
    get statusCode() { return status; },
    get bodyText() { return body; },
  };
}

// ── AC1: the endpoint returns a complete layout, commitCount reflects the requested limit ────────────

test("AC1: /git-history.json returns a complete GitGraphLayout; commitCount reflects the requested limit", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ghdrop-ac1-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "develop"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: ws });
    const nowSec = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= 6; i++) commitAt(ws, `main ${i}`, nowSec - (6 - i) * 60);

    clearGitHistoryCache();
    const res = mockRes();
    await handleGitHistoryJson({}, res, { workspaceRoot: ws }, new URL("http://x/git-history.json?limit=3"));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.status, "ok");
    assert.equal(body.commitCount, 3, "commitCount reflects the requested limit=3 (7 develop commits, no branches)");
    assert.ok(Array.isArray(body.branches) && body.branches.length >= 1, "a complete layout has branches");
    assert.equal(body.branches[0].kind, "mainline", "branches[0] is the mainline lane");
    assert.ok(body.branches[0].commits.length <= 3);
    assert.equal(typeof body.overflowCount, "number", "layout carries overflowCount");
    assert.equal(typeof body.textWidth, "number", "layout carries the content-derived width seed");
    assert.equal(typeof body.oldestT, "number", "layout carries oldestT");
    assert.equal(typeof body.newestT, "number", "layout carries newestT");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC2: negative control — the old global -n limit squeezes a long-lived branch; per-ref does not ───

/** The OLD single-pass fetch (`git log <allrefs> -n <limit> --source`), reimplemented INLINE (never
 *  imported) so the criterion can be false. Counts the commits the old model attributed to `branchRef`. */
function oldSinglePassBranchCount(ws, refs, limit, branchRef) {
  const out = execFileSync(
    "git",
    ["-C", ws, "log", ...refs, "--source", "--date=unix", `-n ${limit}`, "--pretty=format:%H%x1f%ct%x1f%S%x1f%P%x1f%s"],
    { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  let count = 0;
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split("\x1f");
    if (parts[2] === branchRef) count++;
  }
  return count;
}

test("AC2: negative control — the old global -n limit squeezes a long-lived branch; per-ref does not", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ghdrop-ac2-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "develop"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    const nowSec = Math.floor(Date.now() / 1000);
    const T0 = nowSec - 3 * 86400;
    const env0 = {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(T0 * 1000).toISOString(),
      GIT_COMMITTER_DATE: new Date(T0 * 1000).toISOString(),
    };
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base"], { cwd: ws, env: env0 });
    // A long-lived live branch: 20 exclusive commits, all OLDER than develop's newest commit.
    execFileSync("git", ["checkout", "-q", "-b", "task/long"], { cwd: ws });
    for (let i = 1; i <= 20; i++) commitAt(ws, `branch ${i}`, T0 + i, "branch.txt");
    execFileSync("git", ["checkout", "-q", "develop"], { cwd: ws });
    commitAt(ws, "develop newest", T0 + 100, "main.txt");

    // New model: per-ref fetch keeps ALL 20 exclusive commits regardless of the small global limit.
    clearGitHistoryCache();
    const perRef = readGitHistory(ws, { limit: 5 });
    assert.equal(perRef.status, "ok");
    const branchCommits = perRef.commits.filter((x) => x.ref === "task/long");
    assert.equal(branchCommits.length, 20, "per-ref keeps all 20 exclusive commits despite limit=5");

    // Old model: the global -n 5 pass returns only the newest few branch commits (the rest squeezed).
    const oldCount = oldSinglePassBranchCount(ws, ["develop", "task/long"], 5, "task/long");
    assert.ok(oldCount < 20, `the old global -n 5 model squeezes the branch to ${oldCount} commits (< 20)`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC2 mirror: per-ref does NOT resurface a stale branch's commits older than the mainline window ────

test("AC2-mirror: a dead branch's ancient commit (older than the mainline window floor) is not resurfaced", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ghdrop-ac2b-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "develop"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "README.md"), "fixture\n");
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: ws });
    const nowSec = Math.floor(Date.now() / 1000);
    const T0 = nowSec - 3 * 86400;
    const env0 = {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(T0 * 1000).toISOString(),
      GIT_COMMITTER_DATE: new Date(T0 * 1000).toISOString(),
    };
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base"], { cwd: ws, env: env0 });
    // A dead branch forked from `base` with one commit just after base — far older than the recent
    // mainline window below. Its tip stays inside the 7-day active window (so it IS enumerated as a
    // live ref), but its commit sits outside the page's time floor.
    execFileSync("git", ["checkout", "-q", "-b", "task/stale"], { cwd: ws });
    commitAt(ws, "stale commit", T0 + 1, "stale.txt");
    // develop advances far past the stale commit: 10 recent commits, so the limit=5 mainline window
    // floor (~T0+1005) is far newer than the stale commit (T0+1).
    execFileSync("git", ["checkout", "-q", "develop"], { cwd: ws });
    for (let i = 0; i < 10; i++) commitAt(ws, `recent ${i}`, T0 + 1000 + i, "main.txt");

    clearGitHistoryCache();
    const perRef = readGitHistory(ws, { limit: 5 });
    assert.equal(perRef.status, "ok");
    const staleCommits = perRef.commits.filter((x) => x.ref === "task/stale");
    assert.equal(staleCommits.length, 0, "the stale branch's ancient commit is outside the page window and not resurfaced");
    // Negative control: the branch tip WAS enumerated as a live ref (the 7-day filter kept it) — the
    // exclusion is the --since bound's doing, not the active-window filter dropping the whole branch.
    const tips = execFileSync("git", ["-C", ws, "for-each-ref", "refs/heads", "--format=%(refname:short)"], { encoding: "utf8" });
    assert.ok(tips.split(/\r?\n/).includes("task/stale"), "task/stale is still a live branch tip");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC3: production reading — before=<cursor> pages back (returns an older window) ───────────────────

test("AC3: production reading — before=<cursor> returns a strictly-older window than the default", () => {
  clearGitHistoryCache();
  const base = readGitHistory(REPO_ROOT, { limit: 500 });
  assert.equal(base.status, "ok", "the checkout under test is a readable git repo");
  const baseOldest = Math.min(...base.commits.map((x) => x.t));
  const older = readGitHistory(REPO_ROOT, { limit: 500, before: baseOldest });
  assert.equal(older.status, "ok");
  assert.ok(older.commits.length > 0, "the before window is non-empty (18000+ develop commits)");
  const olderOldest = Math.min(...older.commits.map((x) => x.t));
  assert.ok(olderOldest < baseOldest, `before window's oldest (${olderOldest}) is earlier than the default's (${baseOldest})`);
});

// ── AC4: client integration (static) — the HTML carries the sentinel + the pagination script ─────────

test("AC4: rendered HTML carries the sentinel element and the pagination-endpoint script", () => {
  const T0 = 1_700_000_000;
  const commits = [
    c("a000000", T0, "develop", [], "base"),
    c("b000000", T0 + 60, "develop", ["a000000"], "trunk"),
  ];
  const html = renderGitHistoryPage(hist(commits, "b000000", { develop: "b000000" }));
  assert.ok(html.includes('id="git-graph-sentinel"'), "the scroll sentinel element is present");
  assert.ok(html.includes("/git-history.json?before="), "the client script fetches the pagination endpoint");
  assert.ok(html.includes("IntersectionObserver"), "the scroll loader arms an IntersectionObserver");
  assert.ok(html.includes('id="git-graph-coverage"'), "the coverage span element is present");
});

// ── AC5: coverage duration is computed from the loaded commits' actual time span (not a constant) ────

test("AC5: coverage span grows with the window and is formatted from the actual time span", () => {
  const T0 = 1_700_000_000;
  const small = layoutGitGraph(hist([
    c("a000000", T0, "develop", [], "base"),
    c("b000000", T0 + 3600, "develop", ["a000000"], "later"),
  ], "b000000", { develop: "b000000" }));
  const big = layoutGitGraph(hist([
    c("a000000", T0, "develop", [], "base"),
    c("b000000", T0 + 3 * 86400, "develop", ["a000000"], "later"),
  ], "b000000", { develop: "b000000" }));
  assert.equal(coverageSpanSeconds(small), 3600, "span = newest − oldest = 3600s");
  assert.equal(coverageSpanSeconds(big), 3 * 86400, "span = 3 days");
  assert.ok(coverageSpanSeconds(big) > coverageSpanSeconds(small), "span grows as the window grows (not a hardcoded constant)");
  assert.equal(formatCoverageSpan(3600), "1 小时");
  assert.equal(formatCoverageSpan(86400), "1 天");
  const html = renderGitHistoryPage(hist([
    c("a000000", T0, "develop", [], "base"),
    c("b000000", T0 + 86400, "develop", ["a000000"], "later"),
  ], "b000000", { develop: "b000000" }));
  assert.ok(html.includes("1 天"), "the guide prose renders the computed coverage duration");
});
