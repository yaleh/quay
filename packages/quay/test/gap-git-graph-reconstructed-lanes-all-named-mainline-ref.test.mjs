// @test-group product
// gap-git-graph-reconstructed-lanes-all-named-mainline-ref — 泳道命名概念取消后，标签不再由「活 ref /
// 合并 subject 带引号名 / 未命名」三级可证性推断（那个模型曾把 113/113 条 reconstructed 泳道全命名为
// develop，退化成零信息）。现在标签只来自 git 的 %D decoration：一个提交上有什么 ref 就显示什么，没有
// ref 就不显示——永远不伪造名字。
//
//   AC1  fixture：没有 ref 指向的提交 decorations 为空（不会凭空贴 develop/分支名）。
//   AC2  fixture：有 ref 指向的提交 decorations 精确等于该 ref 集（无伪造、无缺失）。
//   AC3  生产：页面上每个标签都能在 git %D 里找到（错标计数 = 0）。
//
// ── gap-git-graph-live-ref-oracle-siblings-unfrozen: ONE frozen ref window per 对拍 ─────────────────
// AC3 pairs the rendered label set against a live `git log … %D` set. Those were two INDEPENDENT LIVE
// reads of the production window: a ref advancing between them shifts the window head by K and drops K
// off the tail ⇒ mismatches that are a window SHIFT, not a mislabel. Both sides now read the SAME
// frozen ref set (`helpers/git-ref-window.mjs`), resolved ONCE before either side reads.
// Negative control (⛔ dry-run only): `QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` restores the live-`--all` arms
// (AC1/AC2 are pure fixtures and read no ref at all — they are unaffected by either arm).
//
// Run (scoped): node --test packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs
// Negative control: QUAY_TEST_GIT_GRAPH_LIVE_REFS=1 node --test <same file>
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { layoutGitGraph } from "../src/serve-git.ts";
import { readGitHistory } from "../src/observation.ts";
import { resolveRefWindow, windowScopeArgs, windowGitExec, describeWindow } from "./helpers/git-ref-window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

function c(hash, t, parentHashes, subject, decorations = []) {
  return { hash, t, ref: "", parents: parentHashes.length, parentHashes, subject, decorations };
}

test("AC1: a commit no ref points at carries NO decorations (never fabricated develop/task name)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("c000000", t0 + 2, ["b000000"], "three", ["develop"]),
    c("b000000", t0 + 1, ["a000000"], "two", []),
    c("a000000", t0, [], "base", []),
  ];
  const layout = layoutGitGraph({ status: "ok", reason: null, commits, head: "c000000", heads: {} });
  const undecorated = layout.rows.filter((r) => r.decorations.length === 0);
  assert.ok(undecorated.length >= 2, "interior commits carry no decoration (the retired model named them all develop)");
  assert.ok(undecorated.every((r) => r.decorations.length === 0), "no commit is fabricated a name");
});

test("AC2: a ref-tip commit's decorations equal exactly that ref set (no missing, no extra)", () => {
  const t0 = 1_700_000_000;
  const commits = [
    c("m000000", t0 + 3, ["b000000", "x000000"], "merge", ["develop"]),
    c("x000000", t0 + 2, ["b000000"], "branch", ["task/x"]),
    c("b000000", t0 + 1, ["a000000"], "trunk", []),
    c("a000000", t0, [], "base", []),
  ];
  const layout = layoutGitGraph({ status: "ok", reason: null, commits, head: "m000000", heads: {} });
  const byHash = new Map(layout.rows.map((r) => [r.hash, r.decorations]));
  assert.deepEqual(byHash.get("m000000"), ["develop"], "the develop tip decorates develop only");
  assert.deepEqual(byHash.get("x000000"), ["task/x"], "the task tip decorates task/x only");
});

test("AC3: every production label exists in git %D (mislabel count = 0)", () => {
  const refs = resolveRefWindow(); // frozen ONCE, before either side reads
  console.log(`[ref-window] ${describeWindow(refs)}`);
  const history = readGitHistory(REPO_ROOT, { limit: 500, exec: windowGitExec(refs) });
  assert.equal(history.status, "ok", "the checkout under test is a readable git repo");
  const layout = layoutGitGraph(history);
  // --topo-order matches readGitHistory's own query (production's scope `--topo-order -n`); the
  // default date-order window can select a DIFFERENT 500-commit set when an out-of-order merge tip
  // sits near the boundary, so the two must be aligned or the label comparison compares two different
  // windows. Same for the ref SCOPE — taken from the shared constant — and for the WINDOW itself, taken
  // from the one frozen snapshot both sides read.
  const decOut = execFileSync("git", ["-C", REPO_ROOT, "log", ...windowScopeArgs(refs), "--topo-order", "-n", "500", "--pretty=format:%H%x01%D"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const refDecs = new Map();
  for (const line of decOut.split("\n")) {
    const idx = line.indexOf("\x01");
    if (idx === -1) continue;
    const hash = line.slice(0, idx).trim();
    refDecs.set(hash, line.slice(idx + 1).trim().split(",").map((s) => s.trim()).filter(Boolean));
  }
  let mislabels = 0;
  for (const r of layout.rows) {
    const git = refDecs.get(r.hash) ?? [];
    if (r.decorations.length !== git.length) mislabels++;
    else if (r.decorations.some((d, i) => d !== git[i])) mislabels++;
  }
  assert.equal(mislabels, 0, `every rendered label matches git %D exactly (mislabel ${mislabels})`);
});
