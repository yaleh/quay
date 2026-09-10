// @test-group engine
// ac56-recommended-deordered-check.test.mjs — AC56 判据1/判据2/判据3 检查器测试
// (tasks/gap-ac56-recommended-deordered, "AC56 去锚").
//
// AC56 判据1: `recommended` must be an UNORDERED feasible set OR a dictionary (lexicographic) order
//   with an explicit "order meaningless" annotation.
// AC56 判据2 (FALSIFIABLE): if the output is STILL ordered by a meaningful priority (1/cost — in this
//   repo the blocking_suite → id sort; the delivery_critical axis was RETIRED 2026-09-07,
//   gap-delivery-critical-mechanical-axis-orphaned-needs-ruling), the check MUST go RED.
// AC56 判据3 (ANTI-只改文案): the check reads the OUTPUT ITSELF (the `recommended` array + the
//   `recommended_order` / `recommended_unordered` field), NEVER documentation/comments — a comment
//   claiming "序无意义" while the array still encodes a priority order is caught by the lexicographic
//   test.
//
// This file pins:
//   (a) the pure logic (plugin/scripts/ac56-recommended-deordered-check.ts);
//   (b) the REAL slot-refill CLI produces a de-ordered `recommended` (lexicographic) + the annotation,
//       and the checker is GREEN on it (the DoD 实跑 shape — the exact AC55/AC36 evidence pattern);
//   (c) the NEGATIVE CONTROL (判据2) — a 1/cost-sorted sample ⇒ RED;
//   (d) the ANTI-只改文案 control (判据3) — a priority-sorted array carrying a lying annotation ⇒ RED;
//   (e) 判据1 half-control — a lexicographic array WITHOUT the annotation ⇒ RED (明确标注 required).
//
// Run:
//   scripts/test.sh plugin/test/ac56-recommended-deordered-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { isLexicographic, hasOrderMeaninglessAnnotation, checkRecommendedDeordered } from "../scripts/ac56-recommended-deordered-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// ── fixture helpers (mirror slot-refill.test.mjs so the REAL CLI path is exercised) ────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ac56-chk-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "ready", labels = ["gap"], body }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    "parent: null",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  // C8 SELF-TOUCH MODELING (gap-slot-refill-c8-reject-no-backfill): a real dispatchable task's
  // `## Touches` must contain `tasks/<id>.md` WITHOUT `(new)` — slot-refill's default self-touch gate
  // rejects a candidate missing it (recommended stays empty). Inject it so the END-TO-END run reaches
  // slot-refill's recommendation path at all.
  if (body.includes("## Touches") && !body.includes(`- tasks/${id}.md`)) {
    body = body.replace(/(## Touches\n)/, `$1- tasks/${id}.md\n`);
  }
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${body}`);
}

function dispatchableBody(touches) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   slot = `node plugin/scripts/slot-refill.ts` stdout 的 slots_free 字段",
    "band      slot = ≥0",
    "invoke    `node plugin/scripts/slot-refill.ts`",
    "control   in-flight≥cap ⇒ should_refill false",
    "resume    分步提交",
    "## Touches",
    ...touches,
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

function runSlotRefill(root, cap = 3) {
  const script = path.resolve(repoRoot, "plugin", "scripts", "slot-refill.ts");
  // QUAY_TELEMETRY_SUBAGENTS=0 (same pin the ac36/slot-refill E2E tests apply): a bare --json run
  // MEASURES the in-flight view via the /proc-GLOBAL non-task-subagent scan; pinning to 0 hermeticizes
  // the E2E against ambient suite load while still exercising the real CLI.
  return JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", String(cap), "--json"],
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));
}

function runCheckerCli(args) {
  const script = path.resolve(repoRoot, "plugin", "scripts", "ac56-recommended-deordered-check.ts");
  return execFileSync(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], { encoding: "utf8" });
}

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("isLexicographic — a dictionary-sorted array is TRUE; a priority/1-cost order is FALSE", () => {
  assert.equal(isLexicographic([]), true, "empty is trivially lexicographic");
  assert.equal(isLexicographic(["gap-a"]), true, "single element is trivially lexicographic");
  assert.equal(isLexicographic(["gap-a", "gap-b"]), true, "dictionary order is lexicographic");
  assert.equal(isLexicographic(["gap-a", "gap-b", "gap-c"]), true);
  assert.equal(isLexicographic(["gap-b", "gap-a"]), false, "reversed order is NOT lexicographic");
  assert.equal(isLexicographic(["gap-a", "gap-b", "gap-0"]), false, "out-of-dictionary-order is NOT lexicographic");
});

test("hasOrderMeaninglessAnnotation — reads the OUTPUT fields, not comments", () => {
  assert.equal(hasOrderMeaninglessAnnotation({ recommended_order: "lexicographic-by-id (order meaningless — 字典序，不代表优先级)" }), true, "the slot-refill annotation matches");
  assert.equal(hasOrderMeaninglessAnnotation({ recommended_unordered: true }), true, "the unordered flag counts as the annotation");
  assert.equal(hasOrderMeaninglessAnnotation({ recommended: ["gap-a"] }), false, "no annotation field ⇒ false (a comment in code would NOT count)");
  assert.equal(hasOrderMeaninglessAnnotation({ recommended_order: "priority-by-cost" }), false, "a value that does NOT declare the order meaningless ⇒ false");
});

test("checkRecommendedDeordered — missing recommended (output itself) ⇒ RED, never a silent pass (判据3/硬规则6)", () => {
  const r = checkRecommendedDeordered({});
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /not an array/.test(x)), JSON.stringify(r.reason));
  const r2 = checkRecommendedDeordered(null);
  assert.equal(r2.ok, false);
});

// ── GREEN cases ────────────────────────────────────────────────────────────────────────────────────

test("GREEN — a lexicographic recommended WITH the annotation passes (判据1 option 2)", () => {
  const r = checkRecommendedDeordered({
    recommended: ["gap-a", "gap-b", "gap-c"],
    recommended_order: "lexicographic-by-id (order meaningless — 字典序，不代表优先级)",
  });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
  assert.equal(r.checks.order.lexicographic, true);
  assert.equal(r.checks.annotation.present, true);
});

test("GREEN — empty recommended passes trivially (nothing to anchor; halted/none)", () => {
  const r = checkRecommendedDeordered({ recommended: [], recommended_order: "none (nothing recommended — halted)" });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
});

test("GREEN — a single recommended id passes trivially (a one-element array carries no meaningful order)", () => {
  const r = checkRecommendedDeordered({ recommended: ["gap-a"], recommended_order: "lexicographic-by-id (order meaningless)" });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
});

// ── RED cases (判据2 / 判据3 negative controls) ───────────────────────────────────────────────────

test("RED (判据2) — an output STILL sorted by 1/cost (priority: DC/suite-blocker first) is NOT lexicographic ⇒ RED, even WITH an annotation", () => {
  // The exact pre-fix shape: a delivery-critical task ("ac56-e2e") ranked FIRST, ahead of the
  // non-DC "ac56-aaa" — the meaningful priority sort. Non-lexicographic (aaa < e2e), so the checker
  // MUST go red.
  const r = checkRecommendedDeordered({
    recommended: ["ac56-e2e", "ac56-aaa"],
    recommended_order: "lexicographic-by-id (order meaningless — 字典序，不代表优先级)", // a lying annotation
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /recommended-not-lexicographic/.test(x)), JSON.stringify(r.reason));
});

test("RED (判据3, anti-只改文案) — priority-sorted array + annotation claiming 序无意义 ⇒ RED (the comment/annotation alone is not enough; the ARRAY must actually be de-ordered)", () => {
  const r = checkRecommendedDeordered({
    recommended: ["gap-suiteblocker", "gap-a", "gap-b"], // suite-blocker first — a meaningful order
    recommended_order: "order meaningless — 序无意义",
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /recommended-not-lexicographic/.test(x)), JSON.stringify(r.reason));
});

test("RED (判据1 half) — a lexicographic array WITHOUT the explicit annotation ⇒ RED (明确标注 required for the dictionary-order option)", () => {
  const r = checkRecommendedDeordered({ recommended: ["gap-a", "gap-b"] }); // no annotation field
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /order-meaningless-annotation-missing/.test(x)), JSON.stringify(r.reason));
});

test("RED — recommended is not an array ⇒ RED", () => {
  const r = checkRecommendedDeordered({ recommended: "gap-a" });
  assert.equal(r.ok, false);
});

// ── END-TO-END: REAL slot-refill CLI + checker (the DoD 实跑 shape) ───────────────────────────────
// Run the REAL slot-refill.ts CLI against a temp workspace (with a delivery-critical label present so
// the OLD priority sort WOULD have put it first), feed the JSON to the checker → the checker is GREEN
// because `recommended` is de-ordered (lexicographic) + annotated. The `ranking` diagnostic now carries
// only (suiteBlocking, rank) — the AC36 delivery-critical axis was RETIRED
// (gap-delivery-critical-mechanical-axis-orphaned-needs-ruling, 人 2026-09-07 裁定).

test("END-TO-END — real slot-refill CLI: recommended is de-ordered (lexicographic) + annotated; checker GREEN; ranking no longer exposes the retired DC axis", (t) => {
  const root = makeWorkspace("e2e");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac56-aaa", { labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  // delivery-critical present: the OLD (pre-AC56) sort would rank this FIRST into `recommended`.
  writeTask(root, "ac56-e2e", { labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });

  const out = runSlotRefill(root);
  // 判据1: recommended is de-ordered — lexicographic, NOT the DC task first.
  assert.deepEqual(out.recommended, ["ac56-aaa", "ac56-e2e"], "recommended is lexicographic (DC task NOT first — de-ordered)");
  assert.ok(/order meaningless|序无意义/i.test(out.recommended_order), `the annotation marks the order meaningless: ${out.recommended_order}`);
  // 判据3: the checker reads this OUTPUT and is GREEN.
  const inputPath = path.join(root, "slot-refill.json");
  fs.writeFileSync(inputPath, JSON.stringify(out));
  const cli = runCheckerCli(["--input", inputPath]);
  assert.match(cli, /PASS/, cli);
  // AC36 机械排序轴已退役 (gap-delivery-critical-mechanical-axis-orphaned-needs-ruling, 人 2026-09-07
  // 裁定): ranking 不再暴露 deliveryCritical，只带 (suiteBlocking, rank)。排序键回到
  // (blocking_suite, id) ⇒ 本 fixture 无 suite-blocker，ac56-aaa 字典序在前 = rank 0。
  const dc = out.ranking.find((e) => e.id === "ac56-e2e");
  assert.equal(dc.deliveryCritical, undefined, "ranking no longer exposes the retired DC axis");
  assert.equal(dc.suiteBlocking, false, "no suite-blocker in this fixture");
  assert.equal(out.ranking.find((e) => e.id === "ac56-aaa").rank, 0, "ranking is (blocking_suite, id): lexicographic ⇒ aaa first");
});

test("END-TO-END RED — the checker CLI exits 1 on a 1/cost-sorted (priority-ordered) sample", (t) => {
  const root = makeWorkspace("e2e-red");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputPath = path.join(root, "priority.json");
  // The pre-fix shape: DC task ranked first (a meaningful priority/1-cost order).
  fs.writeFileSync(inputPath, JSON.stringify({
    recommended: ["ac56-e2e", "ac56-aaa"],
    recommended_order: "lexicographic-by-id (order meaningless — 字典序，不代表优先级)",
  }));
  let threw = false;
  try {
    runCheckerCli(["--input", inputPath]);
  } catch (e) {
    threw = true;
    assert.equal(e.status, 1, "checker CLI exits 1 on a priority-sorted sample");
    assert.match(e.stdout, /recommended-not-lexicographic/, e.stdout);
  }
  assert.equal(threw, true, "the CLI must fail when recommended is still priority-ordered");
});
