// @test-group engine
// self-report-vocab-audit.test.mjs — gap-reanchor-must-converge-inner-self-reported-vocabulary.
//
// The re-anchor mechanism proved "re-anchor happens + deviations corrected" but NOT "the inner's
// self-reported vocabulary converges to factory semantics": the inner kept reporting "Batch of 3
// fully merged" for three+ rounds after batch-free drives (context-history internalization, not
// prose contamination). This test pins the inner-side OBSERVABLE — a self-reported-vocabulary
// audit whose effectiveness criterion is SEMANTIC CONVERGENCE (AC2), not "re-anchor happened":
//
//   AC1 — 自述措辞审计: batch-style self-reports ("Batch of N fully merged" / batch-2/3/4 / 按批)
//         are FLAGGED; verification-round-N / 滚动派发 semantics are compliant (not flagged).
//   AC2 — 收敛判据: the newest `--window` self-reports all clean ⇒ converged (re-anchor
//         effectiveness IS semantic convergence; fail-closed below `window` reports).
//   Contract measure — inner_self_report_vocab = count of flagged reports (grep -c parity: one
//         matching line counts 1, regardless of how many patterns it hits).
//   Contract control — construct a self-report "Batch of 3 fully merged" ⇒ audit must flag; after
//         it scrolls out of the window ⇒ not flagged (converged).
//   False-alarm discipline — mechanism real names / task ids containing "batch" without a digit
//         (concurrent-batch-scheduler.ts, gap-closure-sync-is-the-true-batch-boundary,
//         gap-split-batch-vocabulary, batch-free) are NOT flagged; layer-meta commits quoting the
//         phenomenon are caller-excluded via --exclude-prefix.
//   AC5 — this file uses `import { test } from "node:test"` + `// @test-group engine`.
//
// Run:
//   scripts/test.sh plugin/test/self-report-vocab-audit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  auditSelfReports,
  BATCH_FLAG_PATTERNS,
  CONVERGED_MARKERS,
  DEFAULT_WINDOW,
  STOPPED_MARKERS,
} from "../scripts/self-report-vocab-audit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const OUTER_TICK = path.join(repoRoot, "plugin/loop/orchestrator-loop-tick.md");

function runAudit(args) {
  const CLI = path.join(repoRoot, "plugin/scripts/self-report-vocab-audit.ts");
  const res = execFileSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CLI, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return res.trim();
}

test("AC1 — a 'Batch of 3 fully merged' self-report is FLAGGED (batch-of)", () => {
  const r = auditSelfReports(["inner: rolling dispatch", "Batch of 3 fully merged", "inner: verification-round-2 green"]);
  assert.equal(r.inner_self_report_vocab, 1);
  assert.equal(r.flagged.length, 1);
  assert.equal(r.flagged[0].text, "Batch of 3 fully merged");
  assert.ok(r.flagged[0].flags.includes("batch-of"), `flags = ${r.flagged[0].flags}`);
});

test("AC1 — numbered batch vocabulary (batch-2/3/4) is FLAGGED (batch-num)", () => {
  for (const text of ["batch-2 fully merged", "landed in batch_3", "batch/4 closed in fan-in"]) {
    const r = auditSelfReports([text]);
    assert.equal(r.inner_self_report_vocab, 1, `should flag: ${text}`);
    assert.ok(r.flagged[0].flags.includes("batch-num"), `batch-num flag missing for: ${text}`);
  }
});

test("AC1 — 按批 organizing language is FLAGGED (an-pi)", () => {
  const r = auditSelfReports(["收尾按批做", "按批汇报"]);
  assert.equal(r.inner_self_report_vocab, 2);
  assert.ok(r.flagged.every((f) => f.flags.includes("an-pi")));
});

test("AC1 — factory semantics (verification-round-N / 滚动派发) are NOT flagged", () => {
  const compliant = [
    "inner: verification-round-3 green",
    "滚动派发，槽空即派",
    "rolled out by rolling dispatch, not gated batches",
  ];
  const r = auditSelfReports(compliant);
  assert.equal(r.inner_self_report_vocab, 0, "compliant self-reports must not be flagged");
  assert.equal(r.flagged.length, 0);
  // And the compliant vocabulary is recorded as evidence of convergence.
  assert.ok(r.compliant_markers.includes("verification-round"));
  assert.ok(r.compliant_markers.includes("rolling-dispatch"));
});

test("AC2 — convergence: newest `window` self-reports all clean ⇒ converged", () => {
  const reports = [
    "Batch of 3 fully merged", // old, scrolls out
    "inner: verification-round-1 green",
    "inner: verification-round-2 green",
    "inner: verification-round-3 green",
  ];
  const r = auditSelfReports(reports, 3);
  assert.equal(r.inner_self_report_vocab, 1); // the old report is still counted in the full history
  assert.equal(r.converged, true, "the NEWEST window (verification-round-1..3) is clean ⇒ converged");
  assert.equal(r.recent_clean, 3);
});

test("AC2 — a batch-style report inside the newest window ⇒ NOT converged", () => {
  const reports = [
    "inner: verification-round-1 green",
    "inner: verification-round-2 green",
    "Batch of 2 fully merged",
  ];
  const r = auditSelfReports(reports, 3);
  assert.equal(r.converged, false);
  assert.equal(r.inner_self_report_vocab, 1);
});

test("AC2 — fail-closed: fewer than `window` reports cannot claim convergence", () => {
  const r = auditSelfReports(["inner: verification-round-1 green", "inner: verification-round-2 green"], 3);
  assert.equal(r.converged, false, "2 clean reports < window 3 ⇒ can't claim 3 consecutive clean rounds");
  assert.equal(r.recent_clean, 2);
  assert.equal(r.stopped_in_window, false);
  const r2 = auditSelfReports([], 3);
  assert.equal(r2.converged, false);
  assert.equal(r2.inner_self_report_vocab, 0);
});

test("AC1 — a STOPPED-state self-report (idle/paused/awaiting) is CONVERGED even when reports < window (real specimen)", () => {
  // gap-self-report-vocab-misfires-on-stopped-state: a stopped loop emits few self-reports
  // (< `window`) precisely because it is NOT actively dispatching — honest non-drift, not drift.
  const r = auditSelfReports(["inner: idle heartbeat, paused awaiting manager"], 3);
  assert.equal(r.reports_total, 1);
  assert.ok(r.reports_total < r.window, "stopped-state fixture must be below the window to exercise the exemption");
  assert.equal(r.stopped_in_window, true);
  assert.equal(r.converged, true, "stopped state is honest non-drift ⇒ converged despite reports < window");
  assert.equal(r.inner_self_report_vocab, 0);
  assert.equal(r.stopped_reports, 1);
});

test("AC1 — multiple stopped-state reports below the window are CONVERGED", () => {
  const r = auditSelfReports(
    ["paused awaiting manager, no dispatch", "idle heartbeat", "inner: halted via .halt, no batch reports"],
    5,
  );
  assert.ok(r.reports_total < r.window);
  assert.equal(r.stopped_in_window, true);
  assert.equal(r.converged, true);
  assert.equal(r.inner_self_report_vocab, 0);
});

test("AC1/AC2 — a batch-style report inside the window is STILL flagged/not-converged even in stopped state", () => {
  // The stopped-state exemption waives only the WINDOW-FULL requirement; the ALL-CLEAN requirement
  // is unaffected — a batch-style self-report is drift whether the loop is active or stopped.
  const r = auditSelfReports(["Batch of 3 fully merged", "idle, paused awaiting manager"], 3);
  assert.equal(r.stopped_in_window, true, "the window does carry a stopped-state marker");
  assert.equal(r.converged, false, "batch-style report in window ⇒ NOT converged even with stopped marker");
  assert.equal(r.inner_self_report_vocab, 1);
  assert.equal(r.recent_clean, 1);
});

test("AC2 — active loop (no stopped marker) with < window clean reports stays fail-closed NOT converged (no regression)", () => {
  const r = auditSelfReports(["inner: verification-round-1 green", "inner: verification-round-2 green"], 3);
  assert.equal(r.stopped_in_window, false);
  assert.equal(r.converged, false, "active loop below window keeps the fail-closed judgment");
  assert.equal(r.inner_self_report_vocab, 0);
});

test("Contract measure — inner_self_report_vocab counts FLAGGED REPORTS (grep -c parity), not total matches", () => {
  // One report hitting two patterns counts once (grep -c counts matching LINES).
  const r = auditSelfReports(["Batch of 3 fully merged and also batch-2 artifacts"]);
  assert.equal(r.inner_self_report_vocab, 1);
  assert.equal(r.total_matches, 2);
});

test("Contract control — a constructed 'Batch of 3 fully merged' self-report is flagged; after it scrolls out of the window it is not (converged)", () => {
  // Control: construct the divergent report ⇒ audit MUST flag it.
  const divergent = auditSelfReports(["Batch of 3 fully merged"]);
  assert.equal(divergent.inner_self_report_vocab, 1);
  assert.ok(divergent.flagged[0].flags.includes("batch-of"));
  // Re-anchor cycles: the compliant reports scroll the divergent one out of the newest window.
  const after = auditSelfReports([
    "Batch of 3 fully merged",
    "inner: verification-round-1 green",
    "inner: verification-round-2 green",
    "inner: verification-round-3 green",
  ], 3);
  assert.equal(after.inner_self_report_vocab, 1); // still in full history
  assert.equal(after.converged, true); // but the newest window is clean
});

test("false-alarm discipline — mechanism real names / task ids / 'batch-free' are NOT flagged", () => {
  const reports = [
    "wire concurrent-batch-scheduler.ts path",
    "gap-closure-sync-is-the-true-batch-boundary closed",
    "gap-split-batch-vocabulary still todo",
    "three batch-free drives, still no batch report",
  ];
  const r = auditSelfReports(reports);
  assert.equal(r.inner_self_report_vocab, 0, "mechanism real names / task ids must not be flagged");
  assert.equal(r.flagged.length, 0);
});

test("AC5 — flag/compliant vocabulary is exported and non-empty", () => {
  assert.ok(Array.isArray(BATCH_FLAG_PATTERNS) && BATCH_FLAG_PATTERNS.length >= 3);
  assert.ok(Array.isArray(CONVERGED_MARKERS) && CONVERGED_MARKERS.length >= 2);
  assert.equal(DEFAULT_WINDOW, 3);
  assert.ok(Array.isArray(STOPPED_MARKERS) && STOPPED_MARKERS.length >= 3);
});

test("CLI — --count-only prints just the measure number (grep -c parity)", () => {
  const out = runAudit(["--count-only", "/dev/null"]);
  assert.equal(out, "0");
});

test("robustness — a non-finite/negative window falls back to the default (no NaN math)", () => {
  for (const win of [NaN, -1, 0, "abc"]) {
    const r = auditSelfReports(["inner: verification-round-1 green"], win);
    assert.equal(r.window, DEFAULT_WINDOW, `window ${win} must fall back to default`);
    assert.equal(Number.isFinite(r.window), true);
    assert.equal(r.converged, false, "fewer than default-window reports cannot converge");
  }
});

test("CLI — --git-log pulls recent commit subjects, honors --exclude-prefix, judges convergence", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svc-audit-git-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "test"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: tmp, stdio: "ignore" });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: tmp, stdio: "ignore" });
    const commit = (msg) => {
      fs.appendFileSync(path.join(tmp, "f.txt"), `${msg}\n`);
      execFileSync("git", ["add", "f.txt"], { cwd: tmp, stdio: "ignore" });
      execFileSync("git", ["commit", "-qm", msg], { cwd: tmp, stdio: "ignore" });
    };
    commit("inner: rolling dispatch, no batch");
    commit("Batch of 3 fully merged");
    commit("inner: verification-round-2 green");
    commit("outer: quoting the old Batch of 3 phenomenon (excluded)");

    const out = runAudit(["--git-log", "4", "--exclude-prefix", "outer:", "--window", "3", "--json", "--root", tmp]);
    const parsed = JSON.parse(out);
    // outer: commit excluded ⇒ 3 reports: [rolling dispatch, Batch of 3, verification-round].
    assert.equal(parsed.reports_total, 3);
    assert.equal(parsed.inner_self_report_vocab, 1);
    assert.equal(parsed.converged, false);
    assert.equal(parsed.flagged[0].text, "Batch of 3 fully merged");
    assert.ok(parsed.compliant_markers.includes("verification-round"));

    // Control: window 1 (only the newest, clean) ⇒ converged — the batch report scrolled out.
    const out2 = runAudit(["--git-log", "4", "--exclude-prefix", "outer:", "--window", "1", "--json", "--root", tmp]);
    assert.equal(JSON.parse(out2).converged, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("wiring — orchestrator-loop-tick.md re-anchor step carries the audit + convergence criterion", () => {
  const tick = fs.readFileSync(OUTER_TICK, "utf8");
  assert.ok(
    tick.includes("plugin/scripts/self-report-vocab-audit.ts"),
    "outer tick must reference the self-report-vocab-audit script path",
  );
  assert.ok(
    tick.includes("inner_self_report_vocab"),
    "outer tick must name the Contract measure inner_self_report_vocab",
  );
  assert.ok(
    tick.includes("reanchor_effectiveness_is_convergence"),
    "outer tick must encode effectiveness = semantic convergence (not 're-anchor happened')",
  );
  assert.ok(
    /语义收敛|converge/i.test(tick),
    "outer tick must state the convergence criterion",
  );
});
