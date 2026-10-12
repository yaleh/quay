// @test-group engine
// self-report-vocab-check.test.mjs — tasks/gap-reanchor-must-converge-inner-self-reported-vocabulary
// (AC1/AC2/AC4/AC5) + tasks/gap-self-report-vocab-audit-check-pattern-tables-diverge (AC1-AC4).
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
//   - AC2: convergence = the newest `window` (default 3) reports all clean; a flagged report inside
//     the window breaks it. The re-anchor mechanism's effectiveness is measured by this `converged`,
//     not by "re-anchor happened" (invariant reanchor_effectiveness_is_convergence).
//   - AC1/AC3: the outer tick doc (plugin/loop/orchestrator-loop-tick.md 1c) wires the audit
//     invocation and the convergence criterion, and cross-annotates the doc-side pairing.
//   - AC5: this file uses node:test and declares // @test-group engine.
//
// ── gap-self-report-vocab-audit-check-pattern-tables-diverge (2026-10-12) ───────────────────────
// The SAME task was implemented twice: this entry point carried its own pattern table
// (`BATCH_SELF_REPORT_PATTERNS`), its own convergence counter and zero stopped-state handling,
// while self-report-vocab-audit.ts carried the table + judgment + the stopped-state fix. The two
// disagreed on `batch4a`, on `Batch of` without a digit, and on a stopped window. This file now
// pins the three properties that make that impossible:
//   * AC1 — check declares NO pattern table: it reads `BATCH_FLAG_PATTERNS` from the single source
//     (pinned BEHAVIOURALLY: injecting a probe into the shared table must reach check's verdict).
//   * AC2 — PARITY: the same inputs through BOTH entry points ⇒ identical verdicts; the expected
//     verdict per input is asserted too, so "both agree on nothing" cannot pass.
//   * AC4 — the stopped-state exemption holds at BOTH entry points.
// AC3 (negative control) re-runs AC2 against a divergent copy via $SELF_REPORT_VOCAB_CHECK_SCRIPT
// and must go RED; the red output is the evidence, so the default here is always the production path.
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

import { flagBatchVocab } from "../scripts/self-report-vocab-check.ts";
import { BATCH_FLAG_PATTERNS } from "../scripts/self-report-vocab-audit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/self-report-vocab-check.ts");
const AUDIT_SCRIPT = path.join(REPO_ROOT, "plugin/scripts/self-report-vocab-audit.ts");
// Test seam for the AC3 negative control ONLY: point the check entry point at a scratch DIVERGENT
// copy. Unset (the default, and the only mode the committed suite uses) ⇒ the production module.
const CHECK_SCRIPT = process.env.SELF_REPORT_VOCAB_CHECK_SCRIPT || SCRIPT;
const NODE = process.execPath;

function runScript(args, opts = {}) {
  return execFileSync(NODE, ["--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    ...opts,
  });
}

function runCheckCli(args, opts = {}) {
  return execFileSync(NODE, ["--experimental-strip-types", CHECK_SCRIPT, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    ...opts,
  });
}

function runAuditCli(args) {
  return execFileSync(NODE, ["--no-warnings", "--experimental-strip-types", AUDIT_SCRIPT, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
}

/** Verdict per flagged report, in order, as a sorted pattern-id list — the shape both entry
 *  points' JSON can be normalized to (audit: `flagged[].flags`; check: `flagged[].pattern`). */
function checkVerdicts(parsed) {
  const byReport = new Map();
  for (const f of parsed.flagged) {
    const key = f.line; // check emits one entry per (report line, pattern)
    if (!byReport.has(key)) byReport.set(key, new Set());
    byReport.get(key).add(f.pattern);
  }
  return [...byReport.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, pats]) => [...pats].sort());
}

function auditVerdicts(parsed) {
  return [...parsed.flagged]
    .sort((a, b) => a.index - b.index)
    .map((f) => [...f.flags].sort());
}

/** Run BOTH entry points over the same text (one report per line) and return their normalized
 *  verdicts + convergence. `window` is passed to each under its own flag name. */
function bothEntryPoints(text, window = 3) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "srvc-parity-"));
  try {
    const file = path.join(tmp, "reports.txt");
    fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
    const audit = JSON.parse(
      runAuditCli([file, "--json", "--window", String(window)]),
    );
    const check = JSON.parse(
      runCheckCli(["--stdin", "--json", "--no-state", "--window", String(window)], { input: text }),
    );
    return { audit, check };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  assert.ok(hits.some((h) => h.pattern === "batch-num"), "must be classified batch-num");
});

test("AC4 — 'batch-N' / 'batch-2/3/4' identifiers in a self-report are flagged", () => {
  const hits = flagBatchVocab("batch-4 2/3 done; next batch-2/3/4");
  assert.ok(hits.some((h) => h.pattern === "batch-num"), "must flag bare batch-N identifiers");
});

test("AC4 — '按批' (reporting/closing in batches) is flagged", () => {
  const hits = flagBatchVocab("按批汇报：3 条 fully merged");
  assert.ok(hits.some((h) => h.pattern === "an-pi"), "must flag 按批");
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

// ── AC1 (this task): ONE pattern table — check reads the shared one, behaviourally ───────────────

test("AC1 — check has NO pattern table of its own: a probe injected into the shared table reaches its verdict", () => {
  // If check kept a private copy of the table (the pre-2026-10-12 defect), mutating the SINGLE
  // SOURCE would leave its verdict unchanged and this test would fail. BEHAVIOURAL, not a source
  // grep: it measures the wiring, not the spelling.
  const probe = { id: "__parity-probe__", re: /PARITY-PROBE-TOKEN/, desc: "injected by AC1" };
  BATCH_FLAG_PATTERNS.push(probe);
  try {
    const hits = flagBatchVocab("inner: x PARITY-PROBE-TOKEN y");
    assert.ok(
      hits.some((h) => h.pattern === "__parity-probe__"),
      "check must flag via the SHARED BATCH_FLAG_PATTERNS (a private copy would ignore the probe)",
    );
  } finally {
    BATCH_FLAG_PATTERNS.splice(BATCH_FLAG_PATTERNS.indexOf(probe), 1);
  }
});

// ── AC2 (this task): PARITY across every remaining entry point ────────────────────────────────────

// The AC2 input set, with the intended verdict recorded per input (the reconciliation the plan
// requires be written down by name). `null` = clean.
const PARITY_CASES = [
  ["batch4a", null, "digit followed by a letter = historical artifact name (batch4a/4b/4c)"],
  ["batch-2", "batch-num", "numbered batch vocabulary"],
  ["Batch of 3", "batch-of", "the live harmful specimen"],
  ["Batch of", "batch-of", "the signature is the PHRASE — a missing digit must not launder it clean"],
  ["batch 2/3", "batch-num", "batch N/M"],
  ["按批收尾", "an-pi", "按批 organizing language"],
  ["concurrent-batch-scheduler.ts", null, "mechanism true-name, no digit"],
];

test("AC2 — parity: every parity input gets the SAME verdict at BOTH entry points (and the intended one)", () => {
  const failures = [];
  for (const [text, expected, why] of PARITY_CASES) {
    const { audit, check } = bothEntryPoints(text, 3);
    const a = auditVerdicts(audit);
    const c = checkVerdicts(check);
    if (JSON.stringify(a) !== JSON.stringify(c)) {
      failures.push(`DIVERGED on ${JSON.stringify(text)} (${why}): audit=${JSON.stringify(a)} check=${JSON.stringify(c)}`);
      continue;
    }
    const want = expected === null ? [] : [[expected]];
    if (JSON.stringify(a) !== JSON.stringify(want)) {
      failures.push(`WRONG VERDICT on ${JSON.stringify(text)} (${why}): expected ${JSON.stringify(want)}, both said ${JSON.stringify(a)}`);
    }
  }
  assert.deepEqual(failures, [], `parity failures:\n  ${failures.join("\n  ")}`);
});

test("AC2 — parity: the two entry points agree on convergence over a mixed window", () => {
  const text = ["Batch of 3 fully merged", "inner: verification-round-1 green", "inner: verification-round-2 green"].join("\n");
  const { audit, check } = bothEntryPoints(text, 3);
  assert.equal(
    audit.converged,
    check.converged,
    `convergence must agree: audit=${audit.converged} check=${check.converged}`,
  );
  assert.equal(check.converged, false, "a batch-style report inside the window breaks convergence");

  const clean = ["inner: verification-round-1 green", "inner: verification-round-2 green", "inner: verification-round-3 green"].join("\n");
  const both = bothEntryPoints(clean, 3);
  assert.equal(both.audit.converged, true);
  assert.equal(both.check.converged, true, "3 clean reports ⇒ converged at both entry points");
});

// ── AC2 (original task): the convergence criterion ────────────────────────────────────────────────

test("AC2 — one clean report is not enough; converged only once the newest `window` are all clean", () => {
  const one = bothEntryPoints("inner: verification-round-1 green", 3);
  assert.equal(one.audit.converged, false);
  assert.equal(one.check.converged, false, "1 clean report < window 3 ⇒ fail-closed NOT converged");

  const three = bothEntryPoints(
    ["inner: verification-round-1 green", "inner: verification-round-2 green", "inner: verification-round-3 green"].join("\n"),
    3,
  );
  assert.equal(three.check.converged, true);
  assert.equal(three.check.roundsClean, 3);
  assert.equal(three.check.convergenceRounds, 3);
});

test("AC2 — a flagged report resets convergence to 0 (convergence is NOT monotonic)", () => {
  const r = JSON.parse(
    runScript(["--text", "inner: verification-round-1 green\nBatch of 3 fully merged", "--json", "--no-state"]),
  );
  assert.equal(r.converged, false);
  assert.equal(r.roundsClean, 1, "only the clean report counts toward the window");
  assert.equal(r.count, 1);
});

test("AC2 — the invariant is convergence, not 're-anchor happened'", () => {
  // A clean round below the window is NOT converged — the criterion is stricter than "happened".
  const short = JSON.parse(
    runScript(["--text", "inner: verification-round-1 green\ninner: verification-round-2 green", "--json", "--no-state"]),
  );
  assert.equal(short.converged, false, "2 clean reports < window 3 is not yet converged");
  assert.equal(short.roundsClean, 2);
});

// ── AC4 (this task): the stopped-state exemption holds at EVERY remaining entry point ─────────────

test("AC4 — the stopped-state window is CONVERGED at BOTH entry points (window-full waived)", () => {
  const stopped = "inner: idle heartbeat, paused awaiting manager";
  const { audit, check } = bothEntryPoints(stopped, 3);
  assert.equal(audit.stopped_in_window, true, "audit must see the stopped marker");
  assert.equal(check.stoppedInWindow, true, "check must see the stopped marker");
  assert.equal(audit.reports_total, 1);
  assert.ok(audit.reports_total < audit.window, "fixture must be below the window to exercise the exemption");
  assert.equal(audit.converged, true, "audit: stopped state is honest non-drift");
  assert.equal(check.converged, true, "check: the SAME exemption must apply (it had none before 2026-10-12)");
  assert.equal(check.count, 0);
});

test("AC4 — a batch-style report in a stopped window is STILL drift at both entry points (no regression)", () => {
  const text = ["Batch of 3 fully merged", "idle, paused awaiting manager"].join("\n");
  const { audit, check } = bothEntryPoints(text, 3);
  assert.equal(audit.stopped_in_window, true);
  assert.equal(check.stoppedInWindow, true);
  assert.equal(audit.converged, false, "the exemption waives the WINDOW-FULL requirement only");
  assert.equal(check.converged, false, "batch-style report in a stopped window ⇒ still not converged");
  assert.equal(check.count, 1);
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

test("AC2 — the state file records the shared window reading (a reading carrier, not a local counter)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "srvc-"));
  const stateFile = path.join(tmp, "state.json");
  try {
    const clean = "inner: verification-round-N fan-in; 滚动派发";
    const first = JSON.parse(runScript(["--text", clean, "--json", "--state", stateFile]));
    assert.equal(first.converged, false, "1 clean report < window 3 must not converge");
    const reading = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(reading.roundsClean, first.roundsClean, "the file mirrors the shared judgment");
    assert.equal(reading.window, first.convergenceRounds);
    assert.equal(reading.converged, false);

    const three = JSON.parse(
      runScript([
        "--text",
        [clean, "inner: verification-round-N+1 fan-in", "inner: verification-round-N+2 fan-in"].join("\n"),
        "--json",
        "--state",
        stateFile,
      ]),
    );
    assert.equal(three.roundsClean, 3);
    assert.equal(three.converged, true, "3 clean reports ⇒ converged");
    const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(persisted.converged, true, "converged must be persisted to the state file");
    assert.equal(persisted.roundsClean, 3);
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
