// @test-group product
// gap-git-graph-adopt-git-column-algorithm-and-decorate-labels — /git-history 改用 git 的活跃列 + 回收
// 算法（每提交一行 + 该行的边集合，取消泳道对象与 fork/merge/open 分类），标签改为只在 ref tip 内联的
// %D decoration，删除折叠/展开等全部交互，纵轴新的在上，并以 git log --graph 的列号逐条对拍为判据。
//
//   AC1  列号对拍（核心，退化解不可满足）：对生产仓库同一窗口，我方每个提交的列号与
//        `git log --graph --all --pretty=format:'%x01%H'` 哨兵解析出的列号逐条相等，不一致数 = 0。
//   AC2  负控制：测试内显式跑一版「不回收列」的分配（每个第二父都开新列），断言 AC1 的不一致数 > 0。
//   AC3  标签只在 ref tip：渲染出的标签集合与 `git log --pretty=format:'%H%x01%D'` 中 %D 非空的提交
//        集合逐条相等；且 develop 标签出现次数 = 1（当前 6）。
//   AC4  交互机件归零：serve-git.ts 中 expanded[ / 点击展开 / 折叠 / git-svg-hit / appendChip 全为 0。
//   AC5  悬空标记归零：渲染后无「窗口外分叉」文本；布局输出的行对象不再有 fork / merge / open 字段。
//   AC6  纵轴方向：y 最小的那一行（rows[0]）= `git log --all -1 --pretty=%H`（最新提交）。
//   AC7  滚动加载未被打回：client 脚本仍带 sentinel IntersectionObserver + before= 分页自链
//        （详细自链/终止判据由 gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag 覆盖）。
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGitHistory, GIT_HISTORY_LIMIT } from "../src/observation.ts";
import {
  layoutGitGraph,
  assignGitColumns,
  renderGitHistoryPage,
  gitGraphClientScript,
} from "../src/serve-git.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIMIT = 500;

/** The git oracle: run `git log --graph --all -n <n>` and parse each commit's column from the `*`. */
function gitGraphReferenceColumns(n = LIMIT) {
  const out = execFileSync("git", ["-C", REPO_ROOT, "log", "--graph", "--all", "-n", String(n), "--pretty=format:%x01%H"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const map = new Map();
  for (const line of out.split("\n")) {
    const idx = line.indexOf("\x01");
    if (idx === -1) continue;
    const hash = line.slice(idx + 1).trim();
    const star = line.indexOf("*");
    if (star === -1) continue;
    map.set(hash, Math.floor(star / 2));
  }
  return map;
}

/** Commits in git emission order (the SAME order the data layer fetches — `--all --topo-order`). */
function emissionOrderCommits(n = LIMIT) {
  const out = execFileSync("git", ["-C", REPO_ROOT, "log", "--all", "--topo-order", "-n", String(n), "--pretty=format:%H%x1f%P"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const commits = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [hash, parents] = line.split("\x1f");
    commits.push({ hash, parentHashes: (parents ?? "").split(/\s+/).filter(Boolean) });
  }
  return commits;
}

// ── AC1: column numbers match git log --graph EXACTLY (the mechanical judge, un-degenerable) ────────

test("AC1: my per-commit column equals git log --graph --all for the same window (mismatch = 0)", () => {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  assert.ok(layout, "the production history yields a layout");
  assert.ok(layout.rows.length > 0, "the window carries commits");
  // The oracle's `-n` is the LOADED count (layout.rows.length), not a hardcoded 500 — so the judge
  // follows whatever window was actually read (gap-git-graph-pagination-appends-page-relative-col-and-torow).
  const refCols = gitGraphReferenceColumns(layout.rows.length);
  assert.ok(refCols.size > 0, "the git oracle parsed a non-empty column map");

  let mismatch = 0;
  const samples = [];
  for (const r of layout.rows) {
    const ref = refCols.get(r.hash);
    if (ref === undefined) { mismatch++; continue; } // my commit missing from the git window
    if (ref !== r.col) { mismatch++; if (samples.length < 8) samples.push(`${r.hash.slice(0, 7)} mine=${r.col} git=${ref}`); }
  }
  assert.equal(mismatch, 0, `column mismatch = 0 (got ${mismatch}${samples.length ? ": " + samples.join(", ") : ""})`);
});

// ── AC2: negative control — a no-recycling allocation must disagree (the judge can be false) ────────

test("AC2: the no-recycle allocation (every second parent opens a new column) mismatches git (mismatch > 0)", () => {
  const commits = emissionOrderCommits(LIMIT);
  const refCols = gitGraphReferenceColumns(commits.length);

  // Inline reimplementation of the retired lane-model behaviour: a second parent ALWAYS gets a brand-new
  // column, never dedup/reuse — the allocation that exploded to 25 lanes where git uses ~6.
  function noRecycleColumns(commits) {
    const col = new Map();
    let nextCol = 0;
    for (const C of commits) {
      if (!col.has(C.hash)) col.set(C.hash, nextCol++);
      const colC = col.get(C.hash);
      C.parentHashes.forEach((p, pi) => {
        if (col.has(p)) return;
        if (pi === 0) col.set(p, colC);   // first parent inherits the child's column
        else col.set(p, nextCol++);        // second parent: ALWAYS a new column (no recycle)
      });
    }
    return col;
  }

  const correct = assignGitColumns(commits);
  const noRecycle = noRecycleColumns(commits);
  let correctMismatch = 0;
  let noRecycleMismatch = 0;
  for (const c of commits) {
    if (correct.get(c.hash) !== refCols.get(c.hash)) correctMismatch++;
    if (noRecycle.get(c.hash) !== refCols.get(c.hash)) noRecycleMismatch++;
  }
  assert.equal(correctMismatch, 0, "the recycling allocation matches git (precondition)");
  assert.ok(noRecycleMismatch > 0, `the no-recycle allocation mismatches git (${noRecycleMismatch} > 0) — the judge can be false`);
});

// ── AC3: labels appear ONLY on the commit a ref points at; develop appears exactly once ─────────────

test("AC3: the rendered label set equals the %D-nonempty commit set; develop appears once", () => {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  const layout = layoutGitGraph(history);
  const myDecorated = new Set(layout.rows.filter((r) => r.decorations.length > 0).map((r) => r.hash));

  // --topo-order matches readGitHistory's own query (`--all --topo-order -n`); the default date-order
  // window can select a DIFFERENT 500-commit set when an out-of-order merge tip sits near the boundary,
  // so the two must be aligned or the label-set comparison compares two different windows.
  const decOut = execFileSync("git", ["-C", REPO_ROOT, "log", "--all", "--topo-order", "-n", String(LIMIT), "--pretty=format:%H%x01%D"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const refDecorated = new Set();
  for (const line of decOut.split("\n")) {
    const idx = line.indexOf("\x01");
    if (idx === -1) continue;
    const hash = line.slice(0, idx).trim();
    if (line.slice(idx + 1).trim()) refDecorated.add(hash);
  }
  let setMismatch = 0;
  for (const h of refDecorated) if (!myDecorated.has(h)) setMismatch++;
  for (const h of myDecorated) if (!refDecorated.has(h)) setMismatch++;
  assert.equal(setMismatch, 0, `the label set matches %D-nonempty commits exactly (mismatch ${setMismatch})`);

  let developCount = 0;
  // `%D` renders the CHECKED-OUT branch's own decoration as the COMBINED `HEAD -> <name>` form, never a
  // separate bare `<name>` entry (parseDecorations keeps it as one raw string — AC4: the HEAD split is
  // the client renderer's job). So a bare `d === "develop"` under-counts by one whenever `develop` is
  // the checked-out branch — which is exactly the shape of a fresh `actions/checkout@v4` in CI
  // (workflow triggers on `push: branches: [develop]`) and of any contributor with develop checked out.
  // Root cause of the CI failure (`got 0`); measured directly on a fresh clone at a different path.
  // Both forms name the develop label ⇒ still exactly one, so AC3's invariant is unchanged.
  const namesDevelop = (d) => d === "develop" || /^HEAD\s*->\s*develop$/.test(d);
  for (const r of layout.rows) for (const d of r.decorations) if (namesDevelop(d)) developCount++;
  assert.equal(developCount, 1, `develop label appears on exactly one commit (got ${developCount}, was 6)`);
});

// ── AC4: every interaction mechanism is gone from the source ────────────────────────────────────────

test("AC4: serve-git.ts carries zero interaction mechanisms (expanded[/点击展开/折叠/git-svg-hit/appendChip)", () => {
  const src = readFileSync(path.resolve(__dirname, "../src/serve-git.ts"), "utf8");
  const patterns = ["expanded[", "点击展开", "折叠", "git-svg-hit", "appendChip"];
  for (const p of patterns) {
    assert.ok(!src.includes(p), `serve-git.ts must not contain ${JSON.stringify(p)}`);
  }
});

// ── AC5: no dangling markers, and the row model has no fork/merge/open fields ───────────────────────

test("AC5: no 窗口外分叉 text, and layout rows carry no fork/merge/open fields", () => {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  const html = renderGitHistoryPage(history);
  assert.ok(!html.includes("窗口外分叉"), "the rendered page carries no 窗口外分叉 marker (was 5)");

  const layout = layoutGitGraph(history);
  assert.ok(layout.rows.length > 0, "production rows exist");
  for (const r of layout.rows) {
    assert.ok(!("fork" in r), "row objects have no fork field");
    assert.ok(!("merge" in r), "row objects have no merge field");
    assert.ok(!("open" in r), "row objects have no open field");
  }
});

// ── AC6: the smallest y (rows[0]) is the newest commit ──────────────────────────────────────────────

test("AC6: the top row (smallest y) is the newest commit across --all", () => {
  const history = readGitHistory(REPO_ROOT, { limit: LIMIT });
  const layout = layoutGitGraph(history);
  assert.ok(layout.rows.length > 0, "production rows exist");
  const newest = execFileSync("git", ["-C", REPO_ROOT, "log", "--all", "-1", "--pretty=%H"], { encoding: "utf8" }).trim();
  assert.equal(layout.rows[0].hash, newest, "rows[0] (smallest y) is the newest --all commit");
});

// ── AC7: the scroll loader survives (sentinel observer + before= pagination self-chain) ─────────────

test("AC7: the client script still wires the sentinel observer and before= pagination", () => {
  const script = gitGraphClientScript();
  new Function(script); // must parse as a self-contained IIFE
  assert.ok(script.includes("git-graph-sentinel"), "the client reads the scroll sentinel");
  assert.ok(script.includes("IntersectionObserver"), "the client arms an IntersectionObserver");
  assert.ok(script.includes("/git-history.json?before="), "the client fetches the older page by cursor");
  assert.ok(script.includes("loadOlder(); }"), "the self-chain call is present");
  assert.ok(script.includes("data.rows.push"), "older rows are appended (the graph grows)");
});
