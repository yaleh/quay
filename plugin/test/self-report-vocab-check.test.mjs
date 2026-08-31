// @test-group engine
// self-report-vocab-check.test.mjs — tasks/gap-reanchor-must-converge-inner-self-reported-vocabulary
// (AC1/AC2/AC4/AC5): the inner self-reported-vocabulary audit + semantic-convergence criterion.
//
// The inner layer's SELF-REPORTED VOCABULARY drifts from the shipped semantics: after batch-free
// drives it kept reporting "Batch of 3 fully merged", because its context history internalized
// batch-2/3/4 as its organizing form. Doc-side wording alone (gap-split-batch-vocabulary, done)
// can't fix internalized vocabulary; this task adds an OBSERVABLE semantics-convergence criterion
// to the re-anchor cycle. This file makes the audit + criterion mechanically checkable:
//   - AC1/AC4: the audit flags batch-style inner self-reports ("Batch of N fully merged",
//     "batch N/M all landed", "batch-N", "按批") and does NOT flag clean factory vocabulary
//     (verification-round-N / rolling dispatch) nor the whitelist (task ids, mechanism true-names,
//     historical batch names).
//   - AC4 negative control: a harmful self-report string MUST be flagged (+1); the same report
//     restored to factory vocabulary MUST be clean (back to 0).
//   - AC2: convergence = consecutive N rounds (default 3) with zero batch-style self-reports;
//     a flagged round resets the counter. The re-anchor mechanism's effectiveness is measured by
//     this `converged`, not by "re-anchor happened" (invariant reanchor_effectiveness_is_convergence).
//   - AC1/AC3: the outer tick doc (orchestrator-loop-tick.md 1c) wires the audit invocation and the
//     convergence criterion, and cross-annotates the doc-side pairing.
//   - AC5: this file uses node:test and declares // @test-group engine.
//
// Run:
//   scripts/test.sh plugin/test/self-report-vocab-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { flagBatchVocab, nextConvergenceState } from "../scripts/self-report-vocab-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/self-report-vocab-check.ts");
const NODE = process.execPath;

function runScript(args) {
  return execFileSync(NODE, ["--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
}

// ── AC4: the audit flags batch-style self-reports ──────────────────────────────────────────────────

test("AC4 — 'Batch of N fully merged' (the live harmful specimen) is flagged", () => {
  const hits = flagBatchVocab("inner: Batch of 3 fully merged");
  assert.ok(hits.length >= 1, "must flag the batch-of specimen");
  assert.ok(hits.some((h) => h.pattern === "batch-of"), "must be classified batch-of");
});

test("AC4 — 'batch N/M all landed' (batch-count self-report) is flagged", () => {
  const hits = flagBatchVocab("inner: DIR-124-B2 fan-in (abc1234); batch 5/5 all landed, in-flight 0");
  assert.ok(hits.length >= 1, "must flag a batch-count self-report");
  assert.ok(hits.some((h) => h.pattern === "batch-count"), "must be classified batch-count");
});

test("AC4 — 'batch-N' / 'batch-2/3/4' identifiers in a self-report are flagged", () => {
  const hits = flagBatchVocab("batch-4 2/3 done; next batch-2/3/4");
  assert.ok(hits.some((h) => h.pattern === "batch-id"), "must flag bare batch-N identifiers");
});

test("AC4 — '按批' (reporting/closing in batches) is flagged", () => {
  const hits = flagBatchVocab("按批汇报：3 条 fully merged");
  assert.ok(hits.some((h) => h.pattern === "by-batch"), "must flag 按批");
});

// ── AC4 negative control: factory vocabulary + whitelist are clean ─────────────────────────────────

test("AC4 negative control — factory vocabulary (verification-round-N / rolling dispatch) is clean", () => {
  const clean = [
    "inner: verification-round-1 fan-in complete; 滚动派发; worktrees/branches cleaned",
    "merge task/gap-some-task: verification-round-2 closure; 滚动派发",
    "inner: quality-criteria-trend fan-in (abc1234, trend-check.ts); in-flight 0/5",
  ].join("\n");
  const hits = flagBatchVocab(clean);
  assert.equal(hits.length, 0, `factory vocabulary must be clean, got: ${JSON.stringify(hits)}`);
});

test("AC4 negative control — the SAME harmful report restored to factory vocabulary is clean (back to 0)", () => {
  const harmful = "inner: Batch of 3 fully merged";
  const restored = "inner: verification-round-1 收尾 3 条；滚动派发；fan-in 落地";
  assert.ok(flagBatchVocab(harmful).length >= 1, "harmful string must be flagged first");
  assert.equal(flagBatchVocab(restored).length, 0, "restored factory vocabulary must be clean");
});

test("AC4 — whitelist survives: task ids, mechanism true-names, historical batch names are NOT flagged", () => {
  const whitelist = [
    "merge task/gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round",
    "concurrent-batch-scheduler.ts { batch, deferred }",
    "docs/analysis/batch2-queue-state.md batch4a batch4b batch4c",
    "gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async",
  ].join("\n");
  const hits = flagBatchVocab(whitelist);
  assert.equal(hits.length, 0, `whitelist must be clean, got: ${JSON.stringify(hits)}`);
});

// ── AC2: the convergence criterion ─────────────────────────────────────────────────────────────────

test("AC2 — one clean round starts the counter; converged only after N consecutive clean rounds", () => {
  let state = nextConvergenceState(null, 0, 3);
  assert.equal(state.roundsClean, 1);
  assert.equal(state.converged, false);

  state = nextConvergenceState(state, 0, 3);
  assert.equal(state.roundsClean, 2);
  assert.equal(state.converged, false);

  state = nextConvergenceState(state, 0, 3);
  assert.equal(state.roundsClean, 3);
  assert.equal(state.converged, true, "3 consecutive clean rounds must converge");
});

test("AC2 — a flagged round resets the counter to 0 (convergence is NOT monotonic)", () => {
  let state = nextConvergenceState(null, 0, 3);
  state = nextConvergenceState(state, 0, 3); // roundsClean 2
  state = nextConvergenceState(state, 1, 3); // a flagged self-report round
  assert.equal(state.roundsClean, 0, "a flagged round must reset the counter");
  assert.equal(state.converged, false);
});

test("AC2 — the invariant is convergence, not 're-anchor happened' (0 flagged => converged at N)", () => {
  // The re-anchor mechanism's effectiveness is measured by semantic convergence. If a round is clean
  // but N not yet reached, the mechanism is NOT converged — the criterion is stricter than "happened".
  const oneClean = nextConvergenceState(null, 0, 3);
  assert.equal(oneClean.converged, false, "1 clean round out of 3 is not yet converged");
  const threeClean = nextConvergenceState(
    nextConvergenceState(nextConvergenceState(null, 0, 3), 0, 3),
    0, 3,
  );
  assert.equal(threeClean.converged, true);
});

// ── AC2/AC4: CLI end-to-end ────────────────────────────────────────────────────────────────────────

test("AC4 — CLI flags a constructed 'Batch of 3 fully merged' self-report (control)", () => {
  const out = JSON.parse(runScript(["--text", "inner: Batch of 3 fully merged", "--json", "--no-state"]));
  assert.ok(out.count >= 1, `expected >=1 flagged, got ${out.count}`);
  assert.ok(out.flagged.some((f) => f.pattern === "batch-of"));
});

test("AC4 — CLI is clean on a factory-vocabulary self-report (negative control, back to 0)", () => {
  const out = JSON.parse(
    runScript(["--text", "inner: verification-round-1 fan-in complete; 滚动派发", "--json", "--no-state"]),
  );
  assert.equal(out.count, 0);
});

test("AC2 — CLI convergence state persists across rounds via the state file (3 clean => converged)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "srvc-"));
  const stateFile = path.join(tmp, "state.json");
  try {
    for (let i = 0; i < 2; i++) {
      const out = JSON.parse(
        runScript(["--text", "inner: verification-round-N fan-in; 滚动派发", "--json", "--state", stateFile]),
      );
      assert.equal(out.converged, false, `round ${i + 1} must not yet be converged`);
    }
    const third = JSON.parse(
      runScript(["--text", "inner: verification-round-N fan-in; 滚动派发", "--json", "--state", stateFile]),
    );
    assert.equal(third.roundsClean, 3);
    assert.equal(third.converged, true, "3rd consecutive clean round must converge");
    const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(persisted.converged, true, "converged must be persisted to the state file");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC1/AC3: outer tick doc wiring ─────────────────────────────────────────────────────────────────

test("AC1/AC2 — the outer tick doc wires the self-report audit + convergence criterion into the re-anchor step", () => {
  const tick = fs.readFileSync(OUTER_TICK, "utf8");
  // The audit invocation (the helper path) is referenced from the re-anchor section.
  assert.ok(tick.includes("self-report-vocab-check.ts"), "outer tick must invoke the audit helper");
  // The convergence criterion is the effectiveness measure: N clean rounds => converged.
  assert.match(tick, /语义收敛/, "outer tick must name the semantic-convergence criterion");
  assert.match(tick, /converged|收敛/, "outer tick must reference the converged flag / 收敛");
  assert.match(
    tick,
    /不只「重锚发生了」|通道存在 ≠ 词汇收敛/,
    "outer tick must state the invariant: effectiveness = convergence, not 're-anchor happened'",
  );
});

test("AC3 — the outer tick cross-annotates the doc-side pairing (both alone can't solve it)", () => {
  const tick = fs.readFileSync(OUTER_TICK, "utf8");
  assert.ok(
    tick.includes("gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round"),
    "outer tick must reference the doc-side vocabulary task",
  );
  assert.match(tick, /单独做任一条都解决不了/, "cross-annotation: neither side alone solves the problem");
});

// ── AC5: this file uses node:test + @test-group engine ────────────────────────────────────────

test("AC5 — this file declares node:test and // @test-group engine", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /import \{ test \} from "node:test"/);
  assert.match(src, /\/\/ @test-group engine/);
});
