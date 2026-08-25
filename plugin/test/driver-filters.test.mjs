// @test-group governance
// driver-filters.test.mjs — AC152 (tasks/gap-ac152-filter-composable-predicate-list): the dispatch-pre-
// filter is a COMPOSABLE PREDICATE LIST shared by the two task-processing drivers (worker / promotion),
// not a per-kind private branch. The five predicates (notInFlight / depsSatisfied / touchesDisjoint /
// retryCapNotExhausted / notNeedsHuman) are elements of ONE list (TASK_FILTERS); both drivers consume it
// via applyTaskFilters. AC1 falsifiable: adding a new predicate to BOTH drivers must be a ONE-place change
// (append to TASK_FILTERS); if it required editing both driver files ⇒ false.
//
// Run: scripts/test.sh plugin/test/driver-filters.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TASK_FILTERS,
  applyTaskFilters,
  makeFilterContext,
  allDepsDone,
  readTaskStatus,
} from "../scripts/driver-filters.ts";
import { readTaskStatus as workerReadTaskStatus } from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `driver-filters-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return dir;
}

/** 写一个任务文件（fm = frontmatter 文本，body 可选，缺省给一个带【每任务唯一】## Touches 的合法 body）。 */
function writeTask(root, id, fm, body) {
  const b = body ?? `## Proposal\n\nprose\n\n## Touches\n\n- plugin/scripts/own-${id}.ts\n`;
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${b}`, "utf8");
}

const ctx = (root, overrides = {}) => makeFilterContext(root, overrides);

// ── AC1：五个谓词是一个列表里的元素 ──────────────────────────────────────────────────────────────

test("AC1 — TASK_FILTERS is the single list of the five composable predicates", () => {
  assert.deepEqual(
    TASK_FILTERS.map((f) => f.name),
    ["notInFlight", "depsSatisfied", "touchesDisjoint", "retryCapNotExhausted", "notNeedsHuman"],
    "五个谓词是一个列表里的元素（顺序固定，取假：缺任一名或散落他处 ⇒ 假）",
  );
  assert.equal(new Set(TASK_FILTERS.map((f) => f.name)).size, TASK_FILTERS.length, "names are unique");
});

test("AC1 — worker-driver re-exports the SAME readTaskStatus（两 driver 共用单一实现，非平行副本）", async () => {
  assert.equal(workerReadTaskStatus, readTaskStatus, "worker re-export is the driver-filters function (identity)");
});

// ── allDepsDone ──────────────────────────────────────────────────────────────────────────────────

test("allDepsDone — empty deps ⇒ true; all done ⇒ true; any not-done/missing ⇒ false", () => {
  assert.equal(allDepsDone([], () => null), true, "empty deps = 真无依赖 (not 读不懂)");
  assert.equal(allDepsDone(["a"], (id) => "done"), true);
  assert.equal(allDepsDone(["a", "b"], (id) => (id === "a" ? "done" : "ready")), false, "not-done dep blocks");
  assert.equal(allDepsDone(["a"], () => null), false, "missing dep (statusOf → null) ⇒ fail-closed");
});

// ── notInFlight ─────────────────────────────────────────────────────────────────────────────────

test("notInFlight — filters the in-flight ids, keeps the rest", () => {
  const p = TASK_FILTERS[0].predicate(ctx("/none", { inFlight: ["gap-a", "gap-b"] }));
  assert.equal(p("gap-a"), false);
  assert.equal(p("gap-b"), false);
  assert.equal(p("gap-c"), true);
});

// ── depsSatisfied ───────────────────────────────────────────────────────────────────────────────

test("depsSatisfied — no deps ⇒ true; all done ⇒ true; not-done ⇒ false; missing dep ⇒ false; unreadable ⇒ false", (t) => {
  const root = makeRoot("deps");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pred = TASK_FILTERS[1].predicate(ctx(root));
  const write = (id, fm) => fs.writeFileSync(path.join(root, "tasks", `${id}.md`), fm);

  write("gap-none", "---\nid: gap-none\nstatus: ready\n---\n\nbody\n");
  assert.equal(pred("gap-none"), true, "no depends_on ⇒ true (真无依赖)");

  write("gap-prereq", "---\nid: gap-prereq\nstatus: done\n---\n\nbody\n");
  write("gap-ok", "---\nid: gap-ok\nstatus: ready\ndepends_on:\n  - gap-prereq\n---\n\nbody\n");
  assert.equal(pred("gap-ok"), true, "dep done ⇒ true");

  write("gap-prereq2", "---\nid: gap-prereq2\nstatus: ready\n---\n\nbody\n");
  write("gap-blocked", "---\nid: gap-blocked\nstatus: ready\ndepends_on:\n  - gap-prereq2\n---\n\nbody\n");
  assert.equal(pred("gap-blocked"), false, "dep not done ⇒ false");

  write("gap-missing-dep", "---\nid: gap-missing-dep\nstatus: ready\ndepends_on:\n  - gap-no-such\n---\n\nbody\n");
  assert.equal(pred("gap-missing-dep"), false, "dep file missing ⇒ false");

  assert.equal(pred("gap-no-such-candidate"), false, "candidate file missing ⇒ fail-closed");

  write("gap-flow", "---\nid: gap-flow\nstatus: ready\ndepends_on: [gap-prereq, gap-prereq2]\n---\n\nbody\n");
  assert.equal(pred("gap-flow"), false, "flow form: any not-done dep blocks");
});

// ── touchesDisjoint ─────────────────────────────────────────────────────────────────────────────

test("touchesDisjoint — overlapping candidate filtered vs in-flight; disjoint kept; unreadable ⇒ conservative", (t) => {
  const root = makeRoot("touches");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (id, touchesLine) => fs.writeFileSync(
    path.join(root, "tasks", `${id}.md`),
    `---\nid: ${id}\nstatus: ready\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n- ${touchesLine}\n`,
    "utf8",
  );
  write("gap-a", "plugin/scripts/foo.ts");
  write("gap-b", "plugin/scripts/foo.ts"); // overlaps gap-a
  write("gap-c", "plugin/scripts/bar.ts"); // disjoint from both

  const noInFlight = TASK_FILTERS[2].predicate(ctx(root, { inFlight: [] }));
  assert.equal(noInFlight("gap-b"), true, "no in-flight ⇒ no conflict ⇒ pass");

  const pred = TASK_FILTERS[2].predicate(ctx(root, { inFlight: ["gap-a"] }));
  assert.equal(pred("gap-b"), false, "overlapping gap-b filtered");
  assert.equal(pred("gap-c"), true, "disjoint gap-c kept");
  assert.equal(pred("gap-zzz"), false, "unreadable candidate ⇒ conservative serialize");
});

// ── retryCapNotExhausted ────────────────────────────────────────────────────────────────────────

test("retryCapNotExhausted — filters the retry-exhausted ids", () => {
  const pred = TASK_FILTERS[3].predicate(ctx("/none", { retryExhausted: new Set(["gap-a"]) }));
  assert.equal(pred("gap-a"), false);
  assert.equal(pred("gap-b"), true);
});

// ── notNeedsHuman ───────────────────────────────────────────────────────────────────────────────

test("notNeedsHuman — filters needs-human status; unreadable ⇒ fail-closed", (t) => {
  const root = makeRoot("nh");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pred = TASK_FILTERS[4].predicate(ctx(root));
  writeTask(root, "gap-ready", "---\nid: gap-ready\nstatus: ready\n---");
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: needs-human\n---");
  assert.equal(pred("gap-ready"), true, "ready status ⇒ not needs-human");
  assert.equal(pred("gap-nh"), false, "needs-human status ⇒ filtered");
  assert.equal(pred("gap-missing"), false, "unreadable ⇒ fail-closed (读不懂 ≠ 合格)");
});

// ── applyTaskFilters ────────────────────────────────────────────────────────────────────────────

test("applyTaskFilters — full list: a candidate failing ANY predicate is filtered; passing all is kept", (t) => {
  const root = makeRoot("apply");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 六个候选，各命中一个谓词（唯 gap-ok 全过）：
  writeTask(root, "gap-ok", "---\nid: gap-ok\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/ok.ts\n");
  writeTask(root, "gap-inflight", "---\nid: gap-inflight\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/inflight.ts\n");
  writeTask(root, "gap-overlap", "---\nid: gap-overlap\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/inflight.ts\n"); // touchesDisjoint fails
  writeTask(root, "gap-dep", "---\nid: gap-dep\nstatus: ready\ndepends_on:\n  - gap-blocker\n---", "## Touches\n\n- plugin/scripts/dep.ts\n"); // depsSatisfied fails
  writeTask(root, "gap-blocker", "---\nid: gap-blocker\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/blocker.ts\n");
  writeTask(root, "gap-nh", "---\nid: gap-nh\nstatus: needs-human\n---", "## Touches\n\n- plugin/scripts/nh.ts\n"); // notNeedsHuman fails
  writeTask(root, "gap-exhausted", "---\nid: gap-exhausted\nstatus: ready\n---", "## Touches\n\n- plugin/scripts/exhausted.ts\n"); // retryCapNotExhausted fails

  const c = ctx(root, { inFlight: ["gap-inflight"], retryExhausted: new Set(["gap-exhausted"]) });
  assert.deepEqual(
    applyTaskFilters(["gap-ok", "gap-inflight", "gap-overlap", "gap-dep", "gap-nh", "gap-exhausted"], c),
    ["gap-ok"],
    "only the candidate passing all five predicates is kept",
  );
});

test("applyTaskFilters — named subset: promotion fix-pass applies only retryCap/needs-human (deps/touches NOT re-filtered)", (t) => {
  const root = makeRoot("subset");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A dep-blocked (deps-not-ready) candidate: the promotion fix-pass must NOT drop it via depsSatisfied —
  // it stays for the AC134 skip ledger (ready-pool-check already classified depsReady=false as unfixable).
  writeTask(root, "gap-dep", "---\nid: gap-dep\nstatus: todo\ndepends_on:\n  - gap-missing\n---");
  writeTask(root, "gap-exhausted", "---\nid: gap-exhausted\nstatus: todo\n---");

  const c = ctx(root, { retryExhausted: new Set(["gap-exhausted"]) });
  const names = ["retryCapNotExhausted", "notNeedsHuman"];
  assert.deepEqual(
    applyTaskFilters(["gap-dep", "gap-exhausted"], c, names),
    ["gap-dep"],
    "deps-not-ready NOT re-filtered (kept for skip ledger); retry-exhausted filtered",
  );
});

test("applyTaskFilters — empty candidates ⇒ empty; empty list ⇒ all kept (identity on names=[])", () => {
  assert.deepEqual(applyTaskFilters([], ctx("/none")), []);
  assert.deepEqual(applyTaskFilters(["gap-a", "gap-b"], ctx("/none"), []), ["gap-a", "gap-b"]);
});

// ── readTaskStatus ──────────────────────────────────────────────────────────────────────────────

test("readTaskStatus — reads status; missing/unreadable ⇒ null", (t) => {
  const root = makeRoot("status");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-done", "---\nid: gap-done\nstatus: done\n---");
  assert.equal(readTaskStatus(root, "gap-done"), "done");
  assert.equal(readTaskStatus(root, "gap-missing"), null);
});
