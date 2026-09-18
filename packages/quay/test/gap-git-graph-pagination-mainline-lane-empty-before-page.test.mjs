// @test-group product
// gap-git-graph-pagination-mainline-lane-empty-before-page — 泳道模型取消后，「脊柱为空」的不变式换成
// 新模型的等价断言：/git-history.json?before= 的分页页必须返回非空 rows，且连续多页单调增长。旧的
// bug 是 before 页 branches[0].commits 恒为 0（脊柱从不在 batch 里的 tip 起走）；新模型下同形的失效
// 是「分页页 rows 为空 ⇒ 滚动加载第一页即停」。
//
//   AC1  before 页非空：before=<首屏最老 t> 直调 readGitHistory + layoutGitGraph，rows.length > 0。
//   AC2  连续三页单调增长：cursor 逐页回退连取三页，合并提交数单调增长且第三页非空。
//   AC3  侧枝不丢：数据层取回的提交集与 `git log <GIT_HISTORY_REF_SCOPE> --topo-order -n <limit>`
//        逐条相等（drop = 0），该 ref 范围完整遍历不丢任何 git 发 emit 的提交（旧 develop-only 侧枝
//        batch 会丢侧枝提交）。
//
// ── gap-git-history-window-notes-ref-dominates: the window's REF SCOPE is now shared with production ──
// AC3 used to compare against a live `git log --all`. Since ~2026-08-12 that window is FILLED by the
// linear `refs/notes/quay-cmv-merge` commit chain — a notes ref is metadata ATTACHED to history, but
// `--all` includes it and `--topo-order` emits a linear chain contiguously. `cross-machine-verify.sh`
// pushes that ref to origin (it is cross-machine STATE, not clutter anyone may delete), so it is not
// going away. Measured 2026-09-18 on `/home/yale/work/quay`, `-n 200`: the `--all` window was
// **200/200 notes commits** with **0** in-window second-parent edges, while the same window minus
// notes carried 70 merges and 45 edges ⇒ the non-vacuity clause below was RED, and because fan-in runs
// this file's scoped gate, EVERY code-delta task's fan-in died at `step=suite`. The window is now read
// from `GIT_HISTORY_REF_SCOPE` — production's own exported constant — so this oracle and
// `readGitHistory` can never drift apart on which refs the window covers again.
//
// ⛔ FALSIFIABILITY CONTROL (dry-run only, NEVER set by the suite). `QUAY_GGW_LINEAR_WINDOW=1` hands
// BOTH production (through `observation.ts`'s `exec` host-read seam) and this file's oracle a window
// whose commits form a LINEAR chain: real hashes/timestamps/subjects, but every commit is re-parented
// onto its successor and its other parents dropped, so no second parent can land inside the window.
// That is precisely the class the non-vacuity clause refuses (and the shape the notes chain itself
// has), so AC3 MUST report RED under it. If AC3 stays green, the clause is vacuously true — strictly
// worse than no clause at all (硬规则 3b: 一个恒绿的检查是假的保证，而「没有检查」只是已知的空白).
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs
// Negative control: QUAY_GGW_LINEAR_WINDOW=1 node --test <same file>   ⇒ AC3 must be RED (fail 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutGitGraph } from "../src/serve-git.ts";
import { readGitHistory, GIT_HISTORY_REF_SCOPE } from "../src/observation.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIMIT = 200;

const LINEAR_WINDOW = process.env.QUAY_GGW_LINEAR_WINDOW === "1";

/** The production window's own argv (minus `-C <root>`), so the oracle cannot drift from production. */
function windowLogArgs(limit) {
  return ["-C", REPO_ROOT, "log", ...GIT_HISTORY_REF_SCOPE, "--topo-order", "-n", String(limit), "--format=%H"];
}

/** One live read of the production window's commit hashes — the AC3 mechanical oracle. */
function liveWindowHashes() {
  return new Set(
    execFileSync("git", windowLogArgs(LIMIT), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .trim().split(/\r?\n/).filter(Boolean),
  );
}

/** The negative-control window (see the header block): a linear chain of REAL commits. */
function linearWindow(limit) {
  const out = execFileSync(
    "git",
    ["-C", REPO_ROOT, "log", ...GIT_HISTORY_REF_SCOPE, "--topo-order", "-n", String(limit), "--pretty=format:%H%x1f%ct%x1f%s"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const rows = out.split(/\r?\n/).filter(Boolean).map((l) => l.split("\x1f"));
  const commits = rows.map(([hash, ct, subject], i) => ({
    hash,
    ct: Number(ct),
    subject,
    parent: i + 1 < rows.length ? rows[i + 1][0] : "", // linear: each commit's only parent is its successor
  }));
  // The seam handed to `readGitHistory`, serving the SAME `%H %P %D %ct %s` shape production parses.
  // Fail-closed: an unrecognised invocation throws rather than silently answering a different question.
  const exec = (args) => {
    if (args.includes("rev-parse")) return `${commits[0]?.hash ?? ""}\n`;
    if (!args.includes("log")) throw new Error(`linear-window seam got an unexpected invocation: ${args.join(" ")}`);
    return commits.map((c) => [c.hash, c.parent, "", String(c.ct), c.subject].join("\x1f")).join("\n") + "\n";
  };
  return { commits, exec, hashes: new Set(commits.map((c) => c.hash)) };
}

test("AC1: a before= page has non-empty rows (the pagination spine is not empty)", () => {
  const page1 = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(page1.status, "ok", "the checkout under test is a readable git repo");
  const rows1 = layoutGitGraph(page1).rows;
  assert.ok(rows1.length > 0, "the first page has rows");
  const cursor = Math.min(...rows1.map((r) => r.t));
  const page2 = readGitHistory(REPO_ROOT, { limit: LIMIT, before: cursor });
  assert.equal(page2.status, "ok", "the before= page reads ok");
  assert.ok(layoutGitGraph(page2).rows.length > 0, "the before= page has non-empty rows (the bug returns 0)");
});

test("AC2: three consecutive pages grow the merged commit set monotonically and page 3 is non-empty", () => {
  const seen = new Set();
  let cursor = null;
  let prevSize = 0;
  for (let i = 1; i <= 3; i++) {
    const h = readGitHistory(REPO_ROOT, { limit: LIMIT, before: cursor });
    assert.equal(h.status, "ok", `page ${i} reads ok`);
    const rows = layoutGitGraph(h).rows;
    assert.ok(rows.length > 0, `page ${i} has rows`);
    for (const r of rows) seen.add(r.hash);
    assert.ok(seen.size > prevSize, `merged commit set grows after page ${i} (${prevSize} -> ${seen.size})`);
    prevSize = seen.size;
    cursor = Math.min(...rows.map((r) => r.t));
  }
});

test("AC3: every in-window second parent is fetched (no side branch lost by the production traversal)", () => {
  const control = LINEAR_WINDOW ? linearWindow(LIMIT) : null;
  const history = readGitHistory(REPO_ROOT, control ? { limit: LIMIT, exec: control.exec } : { limit: LIMIT });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const fetched = new Set(history.commits.map((c) => c.hash));
  // The page window IS `git log <GIT_HISTORY_REF_SCOPE> --topo-order -n <limit>` — the same argv
  // production runs (read from the one shared constant, so scope drift is impossible) and the same
  // window `git log --graph` draws over that scope (the AC1 oracle). A commit is "lost" iff git's own
  // traversal emits it within the limit but the data layer did not fetch it (the old develop-only
  // lateral batch dropped side-branch commits exactly this way). A second parent below the window
  // (cut off by `-n`) is legitimately deferred to an older page, matching git.
  const windowHashes = control ? control.hashes : liveWindowHashes();
  let dropped = 0;
  for (const h of windowHashes) if (!fetched.has(h)) dropped++;
  assert.equal(dropped, 0, `git --all emits ${windowHashes.size} commits; the data layer dropped ${dropped} (side branch lost)`);
  assert.equal(fetched.size, windowHashes.size, `the data layer fetched the full --all window (${fetched.size} vs ${windowHashes.size})`);

  // Non-vacuous half: the window genuinely contains merge second parents (a merge commit whose
  // second parent also lands inside the --all window — the commits AC1's column match draws an edge to).
  let inWindowSecondParents = 0;
  for (const cm of history.commits) {
    if (cm.parentHashes.length < 2) continue;
    for (const p of cm.parentHashes.slice(1)) if (windowHashes.has(p)) inWindowSecondParents++;
  }
  assert.ok(inWindowSecondParents > 0, "the window contains merge second parents to verify (non-vacuous)");
});
