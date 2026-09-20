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
// ── gap-fan-in-cert-flip-commit-identity-inert: the window is now FROZEN, not merely shared-scoped ──
// Sharing the ref SCOPE (above) fixed WHICH refs the window covers; it did not fix WHEN the two sides
// read them. AC3 still did two INDEPENDENT LIVE reads — the data layer inside `readGitHistory` first,
// the oracle (`liveWindowHashes()`) after — with no snapshot between them. Any ref that advances in
// between shifts the window head by K and drops K off the tail ⇒ `dropped = K` with the lost commits
// being exactly the K NEW ones, which the data layer had no way to fetch. Measured 2026-09-20 on this
// repo (real fan-in sample, not constructed): `dropped 1` while
// `e18962e2a` was committed to `author` at 08:09:35Z — inside the ~1s between AC1's read (cached, the
// 30s TTL in `observation.ts` is why AC3 reuses it) and AC3's oracle read at 08:09:35.87Z. The loop
// advances `develop`/`author` while the suite runs, so `--all`'s stability was an assumption this test
// never held and production never satisfies. The identical race was already fixed the same way in the
// sibling file `gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs`
// (gap-git-graph-pagination-ac2-oracle-races-live-refs) — hard rule 5b: fixing it in one carrier did
// not fix this one, and fan-in runs this file's scoped gate, so it mis-kills every code-delta task.
//
// FIX: snapshot the ref set ONCE into immutable object names and hand the SAME list to BOTH sides. The
// production read path (`observation.ts`) is UNCHANGED — the frozen list enters through its existing
// `exec` host-read seam (`GitExec`), which exists for exactly this ("hand the reader a frozen snapshot
// of the host instead of racing the live repo"). NOT a fixture: the real `git` binary reads the real
// repo; only the START-POINT LIST is pinned instead of `--all`. Equivalence 干跑 before writing this
// (硬规则 4c), `-n 200` on the worktree: `git log <182 frozen ref object names> --topo-order -n 200
// --format=%H` is BYTE-IDENTICAL to `git log <GIT_HISTORY_REF_SCOPE> --topo-order -n 200 --format=%H`
// (both md5 `bc7c2972de509f4172b0edb5f0b04d9c`). The notes chain is excluded from the frozen list
// because `GIT_HISTORY_REF_SCOPE` excludes it — freezing alone was never enough (a stable window that
// carries the notes chain is stably wrong).
//
// ⛔ FALSIFIABILITY CONTROL (dry-run only, NEVER set by the suite). `QUAY_TEST_GIT_GRAPH_LIVE_REFS=1`
// puts BOTH sides back on independent LIVE reads of `--all` — the pre-fix shape — so the race is
// re-exposed under concurrent ref churn and AC3 must be able to go RED there. It is the seam that
// proves the frozen window is READ rather than echoed.
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
// Negative control: QUAY_TEST_GIT_GRAPH_LIVE_REFS=1 node --test <same file>   ⇒ the frozen window is
// switched off and both sides read live `--all` again (the pre-fix shape; GREEN whenever no ref happens
// to advance mid-test — that arm re-exposes the race, it does not manufacture it).
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

/** Negative-control seam (see the header block): with this set AC3's two sides go back to reading live
 *  `--all` independently — the pre-fix shape — so concurrent ref churn re-exposes the race.
 *  Default (unset) = the frozen window. */
const LIVE_REFS = process.env.QUAY_TEST_GIT_GRAPH_LIVE_REFS === "1";

/** The repo's ref set frozen into immutable object names, plus a provenance record (which refs, when).
 *  Mirrors production's ref SCOPE: `refs/notes/*` is excluded, because `GIT_HISTORY_REF_SCOPE` excludes
 *  it (a frozen list that still carried the notes chain would freeze the notes flood in place — the
 *  window would be stable AND useless). */
function snapshotRefWindow() {
  const out = execFileSync("git", ["-C", REPO_ROOT, "for-each-ref", "--format=%(objectname)%09%(refname)"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const shas = new Set();
  const heads = [];
  const tags = [];
  for (const line of out.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (!sha || !ref) continue;
    if (ref.startsWith("refs/notes/")) continue;
    shas.add(sha);
    if (ref.startsWith("refs/heads/")) heads.push(ref);
    else if (ref.startsWith("refs/tags/")) tags.push(ref);
  }
  try {
    const h = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (h) shas.add(h); // `--all` includes HEAD, `for-each-ref refs/` does not
  } catch { /* unborn HEAD — `%D` still marks it when it exists */ }
  return { shas: [...shas].sort(), refCount: shas.size, heads, tags, at: new Date().toISOString() };
}

/** The window for one reading: frozen by default, `null` only under the negative-control seam. */
function resolveRefWindow() {
  return LIVE_REFS ? null : snapshotRefWindow();
}

/** A `GitExec` that pins every `log` invocation to the frozen ref window (⛔ no live `--all`).
 *  Fail-closed, like `linearWindow`'s seam below: an invocation that does not ask for the `--all`
 *  scope THROWS rather than silently answering a different question (硬规则 3b — a seam that quietly
 *  serves an unasked-for window would make the verdict a function of the seam, not of production). */
function frozenGitExec(shas) {
  return (args, opts = {}) => {
    if (!args.includes("log")) return execFileSync("git", args, { encoding: "utf8", timeout: opts.timeout ?? 15_000, stdio: ["ignore", "pipe", "pipe"] });
    if (!args.includes("--all")) throw new Error(`frozen-window seam got a log invocation with no --all scope: ${args.join(" ")}`);
    return execFileSync("git", args.flatMap((a) => (a === "--all" ? shas : [a])), {
      encoding: "utf8",
      timeout: opts.timeout ?? 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  };
}

/** The production window's own argv (minus `-C <root>`), so the oracle cannot drift from production.
 *  `scope` defaults to the shared production constant; the frozen arm passes the pinned ref list (the
 *  byte-equivalence of the two is the 干跑 recorded in the header block). */
function windowLogArgs(limit, scope = GIT_HISTORY_REF_SCOPE) {
  return ["-C", REPO_ROOT, "log", ...scope, "--topo-order", "-n", String(limit), "--format=%H"];
}

/** One read of the production window's commit hashes — the AC3 mechanical oracle. `scope` is the
 *  frozen ref list by default; the negative-control arm passes `GIT_HISTORY_REF_SCOPE` (live `--all`). */
function oracleWindowHashes(scope) {
  return new Set(
    execFileSync("git", windowLogArgs(LIMIT, scope), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
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
  // ONE snapshot, taken BEFORE either side reads, served to BOTH (see the header block). Without it
  // the data layer and the oracle are two independent live reads of a moving `--all`, and the loop
  // advancing `develop`/`author` mid-test shows up as `dropped = K` — a window SHIFT, not a lost side
  // branch. `refs === null` is the negative-control live-`--all` arm (pre-fix shape).
  const refs = control ? null : resolveRefWindow();
  const history = readGitHistory(
    REPO_ROOT,
    control ? { limit: LIMIT, exec: control.exec }
      : refs ? { limit: LIMIT, exec: frozenGitExec(refs.shas) }
        : { limit: LIMIT },
  );
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const fetched = new Set(history.commits.map((c) => c.hash));
  // The page window IS `git log <GIT_HISTORY_REF_SCOPE> --topo-order -n <limit>` — the same argv
  // production runs (read from the one shared constant, so scope drift is impossible) and the same
  // window `git log --graph` draws over that scope (the AC1 oracle). A commit is "lost" iff git's own
  // traversal emits it within the limit but the data layer did not fetch it (the old develop-only
  // lateral batch dropped side-branch commits exactly this way). A second parent below the window
  // (cut off by `-n`) is legitimately deferred to an older page, matching git.
  const windowHashes = control ? control.hashes : oracleWindowHashes(refs ? refs.shas : GIT_HISTORY_REF_SCOPE);
  // The window's identity, so a green reading is attributable to WHICH arm produced it (the frozen arm
  // and the negative-control arm must never be mistaken for one another).
  const arm = control ? `linear (QUAY_GGW_LINEAR_WINDOW=1; ${windowHashes.size} commits)`
    : refs ? `frozen at ${refs.at} (${refs.refCount} ref object names; ${windowHashes.size} commits)`
      : `LIVE --all (QUAY_TEST_GIT_GRAPH_LIVE_REFS=1; ${windowHashes.size} commits)`;
  let dropped = 0;
  for (const h of windowHashes) if (!fetched.has(h)) dropped++;
  assert.equal(dropped, 0, `the window [${arm}] emits ${windowHashes.size} commits; the data layer dropped ${dropped} (side branch lost)`);
  assert.equal(fetched.size, windowHashes.size, `the data layer fetched the full window [${arm}] (${fetched.size} vs ${windowHashes.size})`);

  // Non-vacuous half: the window genuinely contains merge second parents (a merge commit whose
  // second parent also lands inside the --all window — the commits AC1's column match draws an edge to).
  let inWindowSecondParents = 0;
  for (const cm of history.commits) {
    if (cm.parentHashes.length < 2) continue;
    for (const p of cm.parentHashes.slice(1)) if (windowHashes.has(p)) inWindowSecondParents++;
  }
  assert.ok(inWindowSecondParents > 0, "the window contains merge second parents to verify (non-vacuous)");
});
