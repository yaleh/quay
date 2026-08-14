// @test-group governance
// ac36-sortkey-criterion-check.test.mjs — mechanical checker for AC36 判据②
// (tasks/gap-ac36-recommended-exposes-sort-key). slot-refill --json's `recommended` is a pure
// string-id array that does NOT expose the sort axes (blocking_suite / delivery_critical / id), so
// the AC36 判据② "打了 label 的任务位次严格前移 + 负控制：不打 label 的同族位次不变" could only be verified
// by a human comparing two runs. The `ranking` array (added by this task) exposes each recommended
// id's axes; THIS checker mechanically asserts the criterion from two slot-refill JSONs.
//
// AC2 exposure: `--json` ranking exposes blocking_suite / delivery_critical / id per recommended id
//   (pinned here via integration runs against the REAL slot-refill CLI).
// AC3 mechanical: checkCriterion2 asserts (a) DC task strictly moved forward, (b) negative control
//   — same-family non-DC keep relative order, (c) blocking_suite stays above delivery_critical.
// AC4 no-regress: slot-refill's own existing assertions on the STRING `recommended` array are
//   untouched except for the AC56 de-ordering (gap-ac56-recommended-deordered: `recommended` is now
//   lexicographic + "order meaningless" annotated — the dispatch array no longer encodes the priority
//   order). The PRIORITY order lives in the `ranking` array (the AC36 diagnostic), which THIS checker
//   reads — AC36 判据② stays mechanically assertable because `ranking` remains priority-ordered while
//   `recommended` is de-ordered.
//
// Run: scripts/test.sh plugin/test/ac36-sortkey-criterion-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { checkCriterion2, rankingExposureViolation, isRankingEntry } from "../scripts/ac36-sortkey-criterion-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── fixture helpers ───────────────────────────────────────────────────────────────────────────────

function makeWorkspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ac36-chk-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "code"), { recursive: true });
  return dir;
}

function writeTask(root, id, { status = "todo", labels = [], parent = null, body }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    ...labels.map((l) => `  - ${l}`),
    `parent: ${parent}`,
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  // C8 SELF-TOUCH MODELING (gap-slot-refill-c8-reject-no-backfill): a real dispatchable task's
  // `## Touches` must contain `tasks/<id>.md` WITHOUT `(new)` — the C8 dispatch gate the inner's
  // A15 gate ⑤ applies pre-dispatch. slot-refill's default self-touch gate rejects a candidate
  // missing it (recommended stays empty), so fixtures must model a C8-clean body for the
  // END-TO-END ranking/checker tests to reach slot-refill's recommendation path at all.
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

// A minimal parsed slot-refill result: only the `ranking` surface the checker reads.
function rankingResult(entries) {
  return { ranking: entries };
}

// ── AC2 exposure helpers ────────────────────────────────────────────────────────────────────────────

test("rankingExposureViolation / isRankingEntry — the sort-key surface the check reads (AC2)", () => {
  assert.equal(isRankingEntry({ id: "x", deliveryCritical: false, suiteBlocking: true, rank: 0 }), true);
  assert.equal(isRankingEntry({ id: "x", deliveryCritical: false, suiteBlocking: true }), false, "missing rank ⇒ not an entry");
  assert.equal(isRankingEntry({ id: 1, deliveryCritical: false, suiteBlocking: true, rank: 0 }), false, "non-string id ⇒ not an entry");
  assert.ok(rankingExposureViolation({}, "before"), "no ranking array ⇒ a violation");
  assert.equal(rankingExposureViolation(rankingResult([{ id: "x", deliveryCritical: false, suiteBlocking: true, rank: 0 }]), "before"), null, "well-formed ranking ⇒ no violation");
});

// ── AC3 (a): DC strict forward movement ─────────────────────────────────────────────────────────────

test("AC3 (a) — a delivery-critical task that strictly moves forward passes (dcMovement recorded)", () => {
  const before = rankingResult([
    { id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "gap-b", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  const after = rankingResult([
    { id: "gap-b", deliveryCritical: true, suiteBlocking: false, rank: 0 },
    { id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "gap-b", familyPrefix: "gap-" });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
  assert.deepEqual(r.checks.dcMovement, { id: "gap-b", before: 1, after: 0, movedForward: true });
});

test("AC3 (a) — auto-detects the task that BECAME deliveryCritical between the runs (no --dc-id)", () => {
  const before = rankingResult([
    { id: "gap-x", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "gap-y", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  const after = rankingResult([
    { id: "gap-y", deliveryCritical: true, suiteBlocking: false, rank: 0 },
    { id: "gap-x", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  const r = checkCriterion2({ before, after });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
  assert.equal(r.checks.dcMovement.id, "gap-y", "the flipped task is auto-detected");
});

test("AC3 (a) — a task that moved from OUTSIDE the recommended window INTO it counts as forward movement", () => {
  const before = rankingResult([{ id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 }]);
  const after = rankingResult([
    { id: "gap-new", deliveryCritical: true, suiteBlocking: false, rank: 0 },
    { id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "gap-new" });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
  assert.deepEqual(r.checks.dcMovement, { id: "gap-new", before: null, after: 0, movedForward: true });
});

test("AC3 (a) RED — a DC task that did NOT strictly move forward fails", () => {
  const before = rankingResult([
    { id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "gap-b", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  // label applied but the rank did not improve (a sort regression that ignores the DC axis).
  const after = rankingResult([
    { id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "gap-b", deliveryCritical: true, suiteBlocking: false, rank: 1 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "gap-b" });
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /did NOT strictly move forward/.test(x)), JSON.stringify(r.reason));
});

test("AC3 (a) RED — explicit --dc-id that never landed (not DC in after) fails closed", () => {
  const before = rankingResult([
    { id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "gap-b", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  const after = rankingResult([
    { id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "gap-b", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "gap-b" });
  assert.equal(r.ok, false, "label did not land ⇒ cannot assert movement");
});

test("AC3 (a) RED — no DC task at all ⇒ fails with a clear ask (--dc-id)", () => {
  const before = rankingResult([{ id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 }]);
  const after = rankingResult([{ id: "gap-a", deliveryCritical: false, suiteBlocking: false, rank: 0 }]);
  const r = checkCriterion2({ before, after });
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /--dc-id/.test(x)), JSON.stringify(r.reason));
});

// ── AC3 (b): negative control — same-family non-DC keep relative order ──────────────────────────────

test("AC3 (b) — unlabeled same-family tasks keep relative order even as absolute ranks shift (negative control)", () => {
  // The AC36 fixture shape: label the MIDDLE task; the unlabeled x/z must keep x-before-z.
  const before = rankingResult([
    { id: "ac36-x", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "ac36-y", deliveryCritical: false, suiteBlocking: false, rank: 1 },
    { id: "ac36-z", deliveryCritical: false, suiteBlocking: false, rank: 2 },
  ]);
  const after = rankingResult([
    { id: "ac36-y", deliveryCritical: true, suiteBlocking: false, rank: 0 },
    { id: "ac36-x", deliveryCritical: false, suiteBlocking: false, rank: 1 },
    { id: "ac36-z", deliveryCritical: false, suiteBlocking: false, rank: 2 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "ac36-y", familyPrefix: "ac36-" });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
  assert.equal(r.checks.negativeControl.beforeCount, 3);
  assert.equal(r.checks.negativeControl.afterCount, 2, "only x/z remain non-DC after the label");
});

test("AC3 (b) RED — a same-family non-DC re-order fails the negative control", () => {
  const before = rankingResult([
    { id: "ac36-x", deliveryCritical: false, suiteBlocking: false, rank: 0 },
    { id: "ac36-y", deliveryCritical: false, suiteBlocking: false, rank: 1 },
    { id: "ac36-z", deliveryCritical: false, suiteBlocking: false, rank: 2 },
  ]);
  // y becomes DC and moves up, but x and z SWAP — a non-DC re-order the DC axis must never cause.
  const after = rankingResult([
    { id: "ac36-y", deliveryCritical: true, suiteBlocking: false, rank: 0 },
    { id: "ac36-z", deliveryCritical: false, suiteBlocking: false, rank: 1 },
    { id: "ac36-x", deliveryCritical: false, suiteBlocking: false, rank: 2 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "ac36-y", familyPrefix: "ac36-" });
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /negative control/.test(x)), JSON.stringify(r.reason));
});

// ── AC3 (c): blocking_suite stays ABOVE delivery_critical ───────────────────────────────────────────

test("AC3 (c) — a suite-blocker ranks above a delivery-critical task (first axis never demoted)", () => {
  // crit must BOTH strictly move forward (2→1) AND stay below the suite-blocker (wd at 0) — the
  // blocking_suite axis bounds the DC axis's forward movement. other (non-DC) slides 1→2.
  const before = rankingResult([
    { id: "gap-wd", deliveryCritical: false, suiteBlocking: true, rank: 0 },
    { id: "gap-other", deliveryCritical: false, suiteBlocking: false, rank: 1 },
    { id: "gap-crit", deliveryCritical: false, suiteBlocking: false, rank: 2 },
  ]);
  const after = rankingResult([
    { id: "gap-wd", deliveryCritical: false, suiteBlocking: true, rank: 0 },
    { id: "gap-crit", deliveryCritical: true, suiteBlocking: false, rank: 1 },
    { id: "gap-other", deliveryCritical: false, suiteBlocking: false, rank: 2 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "gap-crit" });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
  assert.equal(r.checks.suiteBlockingAboveDC.suiteBlocking, 1);
  assert.equal(r.checks.suiteBlockingAboveDC.deliveryCritical, 1);
  assert.deepEqual(r.checks.dcMovement, { id: "gap-crit", before: 2, after: 1, movedForward: true });
});

test("AC3 (c) RED — a delivery-critical task ranked ABOVE a suite-blocker fails", () => {
  const before = rankingResult([
    { id: "gap-wd", deliveryCritical: false, suiteBlocking: true, rank: 0 },
    { id: "gap-crit", deliveryCritical: false, suiteBlocking: false, rank: 1 },
  ]);
  // Regression: DC ranks above the suite-blocker (blocking_suite demoted).
  const after = rankingResult([
    { id: "gap-crit", deliveryCritical: true, suiteBlocking: false, rank: 0 },
    { id: "gap-wd", deliveryCritical: false, suiteBlocking: true, rank: 1 },
  ]);
  const r = checkCriterion2({ before, after, dcId: "gap-crit" });
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /blocking_suite does NOT sit above/.test(x)), JSON.stringify(r.reason));
});

// ── AC2 exposure — no ranking array ⇒ fail closed (the defect this task fixes) ──────────────────────

test("AC2 RED — a --json output WITHOUT the ranking array fails (the pre-fix shape: pure string recommended)", () => {
  const before = { recommended: ["gap-a", "gap-b"] }; // no ranking
  const after = { recommended: ["gap-b", "gap-a"] };  // no ranking
  const r = checkCriterion2({ before, after, dcId: "gap-b" });
  assert.equal(r.ok, false);
  assert.ok(r.reason.some((x) => /ranking/.test(x)), JSON.stringify(r.reason));
});

// ── END-TO-END: real slot-refill CLI before/after + checker (the DoD 实跑 shape) ────────────────────
// Run the REAL slot-refill.ts CLI against a temp workspace, apply the delivery-critical label, run
// it again, then feed both JSONs to the checker — the full mechanical 判据② chain, no fixtures hand-
// built into rankingResult. This is the exact evidence the DoD's "修后实跑" calls for.

function runSlotRefill(root, cap = 3) {
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  return JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", String(cap), "--json"],
    // LOAD-SENSITIVE FIX (ac36 4/6 flake): a bare `slot-refill --json` (no --in-flight) MEASURES the
    // in-flight view via fast-mode-telemetry --slot-status, whose non-task-subagent count scans
    // /proc GLOBALLY (unscoped to --root — readSubagentsInFlight()/scanNonTaskSubagents in
    // fast-mode-telemetry.ts). Under full-suite load the outer loop's live subagents inflate that
    // count, which shrinks slots_free and CAPS `recommended` to fewer tasks than this fixture asserts
    // (observed: before.recommended ['ac36-aaa'] / after.recommended ['ac36-e2e'] instead of both) —
    // the test passed isolated but failed 4/6 full-suite runs. QUAY_TELEMETRY_SUBAGENTS is the
    // telemetry CLI's OWN documented deterministic override (readSubagentsInFlight: "so slot
    // arithmetic never depends on what else happens to be running on the machine at test time").
    // Pinning it to 0 hermeticizes the E2E against ambient load while STILL exercising the real
    // slot-refill CLI end-to-end (the DoD 实跑 shape). The temp root has no telemetry store, so the
    // only ambient input this shuts off is the /proc subagent scan — nothing the assertion relies on.
    { encoding: "utf8", env: { ...process.env, QUAY_TELEMETRY_SUBAGENTS: "0" } },
  ));
}

test("END-TO-END — real slot-refill CLI: ranking carries the axes, checker verifies 判据② mechanically", (t) => {
  const root = makeWorkspace("e2e");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/e2e.ts (new)"]) });

  const before = runSlotRefill(root);
  assert.deepEqual(before.recommended, ["ac36-aaa", "ac36-e2e"], "recommended is de-ordered (lexicographic)");
  assert.ok(/order meaningless/.test(before.recommended_order), "the de-ordered output is explicitly annotated (AC56)");
  assert.ok(Array.isArray(before.ranking), "--json exposes the ranking array");
  assert.equal(before.ranking.length, 2);
  for (const e of before.ranking) {
    assert.equal(typeof e.deliveryCritical, "boolean", "deliveryCritical axis exposed");
    assert.equal(typeof e.suiteBlocking, "boolean", "suiteBlocking axis exposed");
    assert.equal(typeof e.rank, "number", "rank exposed");
  }
  assert.deepEqual(before.ranking.map((e) => e.id), ["ac36-aaa", "ac36-e2e"]);

  // Apply the label; the next refill evaluation must move the labeled task strictly forward IN THE
  // RANKING (the AC36 diagnostic), while `recommended` stays de-ordered (AC56 去序 — inner is not
  // anchored to "the mechanism's first pick").
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });
  const after = runSlotRefill(root);
  assert.deepEqual(after.recommended, ["ac36-aaa", "ac36-e2e"], "recommended stays de-ordered (lexicographic) — the label does NOT reorder the dispatch array (AC56)");
  assert.deepEqual(after.ranking.map((e) => e.id), ["ac36-e2e", "ac36-aaa"], "the labeled task ranks first in the ranking (priority order — the AC36 surface)");

  const r = checkCriterion2({ before, after, familyPrefix: "ac36-" });
  assert.equal(r.ok, true, JSON.stringify(r.reason));
  assert.deepEqual(r.checks.dcMovement, { id: "ac36-e2e", before: 1, after: 0, movedForward: true });
  assert.equal(r.checks.exposure.before, 2);
  assert.equal(r.checks.exposure.after, 2);

  // CLI surface: feed the two JSON files to the checker script itself (exit 0).
  const beforePath = path.join(root, "before.json");
  const afterPath = path.join(root, "after.json");
  fs.writeFileSync(beforePath, JSON.stringify(before));
  fs.writeFileSync(afterPath, JSON.stringify(after));
  const script = path.resolve(__dirname, "..", "scripts", "ac36-sortkey-criterion-check.ts");
  const cli = execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--before", beforePath, "--after", afterPath, "--family-prefix", "ac36-"],
    { encoding: "utf8" },
  );
  assert.match(cli, /PASS/, cli);
});

test("END-TO-END RED — the checker CLI exits non-zero when the criterion is NOT met", (t) => {
  const root = makeWorkspace("e2e-red");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "ac36-aaa", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/aaa.ts (new)"]) });
  writeTask(root, "ac36-e2e", { status: "ready", labels: ["gap", "delivery-critical"], body: dispatchableBody(["- code/e2e.ts (new)"]) });

  // Both runs carry the label ⇒ no task BECAME delivery-critical between them ⇒ auto-detect fails.
  const before = runSlotRefill(root);
  const after = runSlotRefill(root);
  const beforePath = path.join(root, "before.json");
  const afterPath = path.join(root, "after.json");
  fs.writeFileSync(beforePath, JSON.stringify(before));
  fs.writeFileSync(afterPath, JSON.stringify(after));
  const script = path.resolve(__dirname, "..", "scripts", "ac36-sortkey-criterion-check.ts");
  let threw = false;
  try {
    execFileSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", script, "--before", beforePath, "--after", afterPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    threw = true;
    assert.equal(e.status, 1, "checker CLI exits 1 on an unmet criterion");
    assert.match(e.stdout, /no delivery-critical task found/, e.stdout);
  }
  assert.equal(threw, true, "the CLI must fail when the criterion is not met");
});
