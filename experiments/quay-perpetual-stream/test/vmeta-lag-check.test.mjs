// @test-group engine
// Unit tests for vmeta-lag-check.mjs — the single-source V_meta consolidation-lag ARITHMETIC.
// exp5-M-CRYST-D3 increment R5 (Axis-2′); R5 prose-parsing residual resolved in M70/D4 (ADR-004
// structured [tag] field). Written RED-first (ADR-001 / DIR-019 discipline): the fix for any
// failing case belongs in the MODULE, never in the fixtures.
// Run:
//   node --test experiments/quay-perpetual-stream/test/vmeta-lag-check.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/vmeta-lag-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const { parseMilestoneNumber, parseRows, rowStatus, confirmingMilestone, hasDatedCarryForward, evaluateRow, checkLedger, } = await import("../scripts/vmeta-lag-check.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "vmeta");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");

// ── parseMilestoneNumber ────────────────────────────────────────────────────────────────────────
test("parseMilestoneNumber: m<N> / M<N> / bare N", () => {
  assert.equal(parseMilestoneNumber("m3"), 3);
  assert.equal(parseMilestoneNumber("M12"), 12);
  assert.equal(parseMilestoneNumber("confirmed@m6"), 6);
  assert.equal(parseMilestoneNumber("nope"), null);
});

// ── parseRows ───────────────────────────────────────────────────────────────────────────────────
test("parseRows: extracts data rows from the GFM table, skips header+separator", () => {
  const rows = parseRows(read("within-threshold.md"));
  assert.equal(rows.length, 2);
  assert.match(rows[0].cells[0], /CI-job/);
  assert.equal(rows[0].cells.length, 4);
});
test("parseRows: no table → empty array", () => {
  assert.deepEqual(parseRows("# just a heading\n\nno table here\n"), []);
});

// ── rowStatus ───────────────────────────────────────────────────────────────────────────────────
// M70/D4 (ADR-004 structured [tag] field): rowStatus ONLY accepts cells starting with
// [consolidated], [confirmed], or [proposed] (optionally **bold**-wrapped). All bare prose → null.
test("rowStatus: reads [tag] structured status cells (bold-wrapped tolerated)", () => {
  assert.equal(rowStatus("[confirmed] — past φ threshold"), "confirmed");
  assert.equal(rowStatus("**[consolidated]** (m7 ABSORB)"), "consolidated");
  assert.equal(rowStatus("[proposed] — noted"), "proposed");
  assert.equal(rowStatus("something else"), null);
});
test("rowStatus: [tag] with trailing narrative → lifecycle word; prose is ignored", () => {
  assert.equal(rowStatus("[confirmed] — not yet consolidated"), "confirmed");
  assert.equal(rowStatus("[proposed] — noted, never applied"), "proposed");
  assert.equal(rowStatus("[confirmed] — confirmed again (m3, m5)"), "confirmed");
});
// CRITICAL: bold-wrapped [tag] must still read correctly (live ledger uses **[consolidated]**)
test("rowStatus: **[consolidated]** with history text reads consolidated", () => {
  assert.equal(rowStatus("**[consolidated]** (m7 ABSORB) — recording the m3 confirming instance; resolved by consolidation, not a carry-forward; twice-confirmed convention"), "consolidated");
});
// RED: bare prose (no [tag] prefix) → null (fail-closed), regardless of prose content
// This is the M70/D4 canonical test: the OLD leading-token parser would have read these as the
// lifecycle word; the NEW structured parser rejects them all.
test("rowStatus: bare prose without [tag] prefix → null (fail-closed) — the hard fix for R5 residual", () => {
  assert.equal(rowStatus("consolidated (m7)"), null);                          // old parser: "consolidated"
  assert.equal(rowStatus("confirmed — past φ threshold"), null);               // old parser: "confirmed"
  assert.equal(rowStatus("proposed — noted, never applied"), null);            // old parser: "proposed"
  assert.equal(rowStatus("not yet fully consolidated, confirmed@m3"), null);   // was always null
  assert.equal(rowStatus("not-yet-consolidated, confirmed@m3"), null);         // was always null
  assert.equal(rowStatus("consolidated pending; confirmed@m3"), null);         // old parser: null (qualifier)
  assert.equal(rowStatus("not consolidated yet, still confirmed — pending fold"), null); // was always null
});

// ── confirmingMilestone ─────────────────────────────────────────────────────────────────────────
test("confirmingMilestone: reads confirmed@m<N> marker", () => {
  assert.equal(confirmingMilestone("2 — confirmed@m3 (2nd cross-domain)"), 3);
});
test("confirmingMilestone: falls back to 'crossed at m<N>' / 'confirmed m<N>'", () => {
  assert.equal(confirmingMilestone("crossed at m5"), 5);
  assert.equal(confirmingMilestone("confirmed m4 by cross-domain"), 4);
});
test("confirmingMilestone: none → null", () => {
  assert.equal(confirmingMilestone("1 (m3 only — no second confirmation yet)"), 3);
  assert.equal(confirmingMilestone("no milestone token"), null);
});

// ── hasDatedCarryForward ────────────────────────────────────────────────────────────────────────
test("hasDatedCarryForward: requires BOTH a carry-forward marker AND an ISO date", () => {
  assert.equal(hasDatedCarryForward("carry-forward 2026-07-19: blocked on D3"), true);
  assert.equal(hasDatedCarryForward("carry-forward: blocked (no date)"), false);
  assert.equal(hasDatedCarryForward("2026-07-19 dated note but no deferral marker"), false);
  assert.equal(hasDatedCarryForward("confirmed — pending"), false);
});

// ── evaluateRow (the arithmetic + decision) ──────────────────────────────────────────────────────
test("evaluateRow: confirmed, over K, no carry-forward → alarm", () => {
  const r = evaluateRow({ status: "confirmed", confirming: 3, statusCell: "[confirmed] — pending" }, 6, 2);
  assert.equal(r.lag, 3);
  assert.equal(r.alarm, true);
});
test("evaluateRow: within K → no alarm", () => {
  const r = evaluateRow({ status: "confirmed", confirming: 3, statusCell: "[confirmed]" }, 4, 2);
  assert.equal(r.lag, 1);
  assert.equal(r.alarm, false);
});
test("evaluateRow: consolidated → never alarms regardless of lag", () => {
  const r = evaluateRow({ status: "consolidated", confirming: 3, statusCell: "[consolidated]" }, 99, 2);
  assert.equal(r.alarm, false);
});
test("evaluateRow: proposed (not confirmed) → never alarms", () => {
  const r = evaluateRow({ status: "proposed", confirming: null, statusCell: "[proposed]" }, 99, 2);
  assert.equal(r.alarm, false);
});
test("evaluateRow: over K but dated carry-forward → no alarm", () => {
  const r = evaluateRow(
    { status: "confirmed", confirming: 3, statusCell: "[confirmed] — carry-forward 2026-07-19: blocked" },
    6, 2,
  );
  assert.equal(r.alarm, false);
});
test("evaluateRow: confirmed but confirming-milestone unparseable → fail-closed alarm", () => {
  const r = evaluateRow({ status: "confirmed", confirming: null, statusCell: "[confirmed] — pending" }, 6, 2);
  assert.equal(r.alarm, true);
  assert.match(r.reason, /confirming milestone/i);
});
// HARDENING (must-fix #2 — fail-open): a data row whose status cell carries NO non-negated lifecycle
// word must fail-closed, not drop to status=null → silent PASS.
test("evaluateRow: unrecognized/keyword-less status → fail-closed alarm", () => {
  const r = evaluateRow({ status: null, confirming: 3, statusCell: "folding into inherited-core still pending" }, 6, 2);
  assert.equal(r.alarm, true);
  assert.match(r.reason, /unrecognized|absent|fail-closed/i);
});

// ── checkLedger (end-to-end over fixtures) ───────────────────────────────────────────────────────
test("checkLedger: over-threshold-unconsolidated-no-carryforward → FAIL", () => {
  const rep = checkLedger(read("over-threshold-unconsolidated-no-carryforward.md"));
  assert.equal(rep.verdict, "FAIL");
  assert.ok(rep.alarms.length >= 1);
});
test("checkLedger: consolidated → PASS", () => {
  assert.equal(checkLedger(read("consolidated.md")).verdict, "PASS");
});
test("checkLedger: within-threshold → PASS", () => {
  assert.equal(checkLedger(read("within-threshold.md")).verdict, "PASS");
});
test("checkLedger: dated-carry-forward → PASS", () => {
  assert.equal(checkLedger(read("dated-carry-forward.md")).verdict, "PASS");
});
// M70/D4 RED fixture: bare prose "consolidated (m7)" — old leading-token parser said PASS; [tag] says FAIL
test("checkLedger: bare-prose-no-tag fixture → FAIL (D4 canonical RED case via fixture file)", () => {
  assert.equal(checkLedger(read("bare-prose-no-tag.md")).verdict, "FAIL");
});
test("checkLedger: milestone_counter read from the ledger's own comment marker", () => {
  const rep = checkLedger(read("over-threshold-unconsolidated-no-carryforward.md"));
  assert.equal(rep.milestoneCounter, 6);
});
test("checkLedger: explicit milestone_counter arg overrides the marker", () => {
  const rep = checkLedger(read("over-threshold-unconsolidated-no-carryforward.md"), { milestoneCounter: 4 });
  // lag = 4 − 3 = 1 <= K → PASS
  assert.equal(rep.verdict, "PASS");
});
test("checkLedger: no table AND no counter → N/A (explicit, never silent-skip)", () => {
  const rep = checkLedger("# empty ledger\nno rows\n");
  assert.equal(rep.verdict, "N/A");
});
// STRUCTURED FIELD end-to-end (M70/D4): bare prose status WITHOUT [tag] prefix → FAIL-closed.
// The structured [tag] rule uniformly rejects ALL non-[tag] status cells, regardless of content.
test("checkLedger: bare prose 'not consolidated yet, still confirmed' (no [tag]) → FAIL", () => {
  const text =
    "milestone_counter: 40\n\n| insight | origin | confirm | status |\n|---|---|---|---|\n" +
    "| CI≡audit | m1 | confirmed@m3 | not consolidated yet, still confirmed — pending fold |\n";
  const rep = checkLedger(text);
  assert.equal(rep.verdict, "FAIL", JSON.stringify(rep.evaluations));
});
test("checkLedger: bare prose 'not yet fully consolidated' (no [tag]) → FAIL", () => {
  const text =
    "milestone_counter: 40\n\n| insight | origin | confirm | status |\n|---|---|---|---|\n" +
    "| CI≡audit | m1 | confirmed@m3 | not yet fully consolidated, confirmed@m3 — fold pending |\n";
  assert.equal(checkLedger(text).verdict, "FAIL");
});
test("checkLedger: bare prose keyword-less status (no [tag]) → FAIL-closed", () => {
  const text =
    "milestone_counter: 40\n\n| insight | origin | confirm | status |\n|---|---|---|---|\n" +
    "| repo-root isolation | m3 | confirmed@m3 | folding into inherited-core still pending |\n";
  const rep = checkLedger(text);
  assert.equal(rep.verdict, "FAIL", JSON.stringify(rep.evaluations));
});
// RED (M70/D4 canonical): bare "consolidated (m7)" — old leading-token parser said PASS; [tag] says FAIL
test("checkLedger: bare 'consolidated (m7)' without [tag] prefix → FAIL (the D4 canonical RED case)", () => {
  const text =
    "milestone_counter: 9\n\n| insight | origin | confirm | status |\n|---|---|---|---|\n" +
    "| CI≡audit | m1 | confirmed@m3 | consolidated (m7) — folded into inherited-core.md |\n";
  const rep = checkLedger(text);
  assert.equal(rep.verdict, "FAIL", JSON.stringify(rep.evaluations));
});
test("checkLedger: rows present but no milestone_counter derivable → fail-closed", () => {
  const text = "## Rows\n\n| a | b | c | status |\n|---|---|---|---|\n| x | m1 | confirmed@m3 | [confirmed] |\n";
  const rep = checkLedger(text);
  assert.equal(rep.verdict, "FAIL");
  assert.match(rep.reason, /milestone_counter/i);
});

// ── CLI (main) end-to-end — exercises the runnable path + the --counter override + N/A print. ─────
const CLI = path.join(__dirname, "..", "scripts", "vmeta-lag-check.ts");
const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("CLI: FAIL fixture → exit 1, prints ALARM + FAIL verdict", () => {
  const r = runCli([path.join(FIX, "over-threshold-unconsolidated-no-carryforward.md")]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ALARM/);
  assert.match(r.stdout, /^FAIL:/m);
});
test("CLI: PASS fixture → exit 0", () => {
  const r = runCli([path.join(FIX, "consolidated.md")]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^PASS:/m);
});
test("CLI: --counter override flips FAIL fixture to PASS", () => {
  const r = runCli(["--counter", "4", path.join(FIX, "over-threshold-unconsolidated-no-carryforward.md")]);
  assert.equal(r.status, 0);
});
test("CLI: no args → usage error exit 2", () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
});
test("CLI: unreadable file → exit 2", () => {
  const r = runCli([path.join(FIX, "does-not-exist.md")]);
  assert.equal(r.status, 2);
});
test("CLI: N/A ledger (no rows, no counter) → exit 0 and prints N/A explicitly", () => {
  const tmp = path.join(__dirname, "..", "fixtures", "vmeta", ".tmp-empty-na.md");
  fs.writeFileSync(tmp, "# empty ledger\nno rows here\n");
  try {
    const r = runCli([tmp]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /N\/A/);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

