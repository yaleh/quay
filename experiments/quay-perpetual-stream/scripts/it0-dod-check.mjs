#!/usr/bin/env node
// it0-dod-check.mjs — DoD meta-enforcer, charter M25-dod-meta-enforcer (DIR-017 Step 1).
//
// Given a milestone id, a charter file path, and an ABSORB-entry text file (a fixture standing in
// for the real dashboard.md/ABSORB log excerpt for milestones not yet ABSORBed), runs all 5 DoD
// clauses defined in `inherited-core.md`'s "Definition of Done" section:
//   1. Adversarial-audit gate  — documentation-discipline check only (does NOT re-run the audit
//      subagent or re-derive its verdict): does the ABSORB-entry text contain an explicit
//      disposition statement for this gate (a stated verdict, or an explicit "neither condition
//      applied" no-op statement)?
//   2. V_meta consolidation-lag gate — documentation-discipline check only (does NOT recompute
//      v-meta-ledger.md math): does the ABSORB-entry text contain an explicit disposition
//      statement for this gate (a stated "clear"/"no rows past threshold"/resolved-row statement)?
//   3. Line-budget gate — shells out to the EXISTING `it0-ceiling-line-budget-check.sh
//      <charter-file>` directly (reused, not re-implemented). This is the one clause whose true
//      firing point is charter-authoring/plan time (see inherited-core.md's clause-3 note); this
//      script always evaluates it against the given charter file regardless of ABSORB status.
//   4. Design-only-milestone impl-row gate — shells out to the EXISTING
//      `it0-impl-row-check.sh <milestone-id> <backlog-file>` directly (reused, not re-implemented).
//      A synthetic backlog file is materialized from the fixture/ABSORB-entry text's embedded
//      "## Backlog row" section (a single `| id | ... |` line) so the existing script can run
//      against non-real (fixture) milestones without touching the real backlog.md.
//   5. No-self-exemption meta-clause — scans the CHARTER file's "Explicitly OUT of scope" section
//      (heuristic pattern match: "exempt", "does not apply", "skip the gate", "N/A" adjacent to one
//      of the 4 clause names) for exemption-adjacent language with NO corresponding waiver line
//      (`WAIVER: <milestone-id> | <clause-name> | ...`) present in the ABSORB-entry text. A hit
//      with no matching waiver line is a FAIL, independent of clauses 1-4's own outcomes.
//
// This script does NOT re-run the adversarial-audit subagent, does NOT recompute v-meta-ledger.md
// arithmetic, and does NOT re-implement the line-budget/impl-row scripts' own logic — see
// inherited-core.md's "Definition of Done" section for why (clauses 1/2 are documentation-
// discipline checks by design; clauses 3/4 wrap the existing scripts directly).
//
// Usage:
//   node it0-dod-check.mjs <milestone-id> <charter-file> <absorb-entry-file>
//
// charter-file and absorb-entry-file may be the SAME file (the combined-fixture shape used by
// fixtures/dod/*.md — a single file with distinct `## Charter excerpt` / `## ABSORB-entry
// excerpt` sub-sections, each role's check reading ONLY its own section) or two different real
// files (a real charters/M-NN.md + a real dashboard.md/ABSORB-log excerpt). See extractSection()
// below for the section-isolation logic that makes the combined-fixture shape safe.
//
// Exit codes:
//   0 = all 4 gate clauses PASS or legitimately N/A (with disposition present), AND no undeclared
//       self-exemption found.
//   1 = at least one gate clause FAILs, OR a self-exemption is found with no waiver line.
//   2 = usage/environment error (missing args, files not found, node unavailable, sibling script
//       missing).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error("usage: node it0-dod-check.mjs <milestone-id> <charter-file> <absorb-entry-file>");
  process.exit(2);
}

const [milestoneId, charterFile, absorbEntryFile] = process.argv.slice(2);
if (!milestoneId || !charterFile || !absorbEntryFile) usage();

for (const [label, p] of [["charter-file", charterFile], ["absorb-entry-file", absorbEntryFile]]) {
  if (!fs.existsSync(p)) {
    console.error(`ERROR: ${label} not found: ${p}`);
    process.exit(2);
  }
}

const charterFileText = fs.readFileSync(charterFile, "utf8");
const absorbFileText = fs.readFileSync(absorbEntryFile, "utf8");

// Support two input shapes:
//   (a) real milestone: charter-file is a real charter (charters/M-NN.md), absorb-entry-file is a
//       real dashboard.md/ABSORB-log excerpt — used as-is, whole-file text.
//   (b) combined fixture: a single fixture file (used for BOTH the charter-file and
//       absorb-entry-file args) containing distinct `## Charter excerpt` / `## ABSORB-entry
//       excerpt` sections (see fixtures/dod/*.md) — each role's check must see ONLY its own
//       section, not the whole combined file, otherwise the charter's self-exemption prose and
//       the ABSORB-entry's disposition prose would contaminate each other's scan (a real fixture-
//       construction hazard, not a hypothetical one — caught during this milestone's own build).
function extractSection(fullText, heading) {
  // Match the heading line, capture its own `#` depth, then stop the section body at the next
  // line whose heading is at the SAME OR SHALLOWER depth (e.g. a "## Charter excerpt" section
  // extends through any nested "### " subheadings and stops only at the next "## " or shallower —
  // NOT at its own nested subsections, which would silently truncate the section).
  const headingLineRe = new RegExp(`^(##+)\\s*${heading}\\s*$`, "im");
  const headingMatch = fullText.match(headingLineRe);
  if (!headingMatch) return null;
  const depth = headingMatch[1].length;
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = fullText.slice(startIdx);
  const stopRe = new RegExp(`^#{1,${depth}}\\s`, "m");
  const stopMatch = rest.match(stopRe);
  return stopMatch ? rest.slice(0, stopMatch.index) : rest;
}

const charterSection = extractSection(charterFileText, "Charter excerpt");
const charterText = charterSection !== null ? charterSection : charterFileText;

const absorbSection = extractSection(absorbFileText, "ABSORB-entry excerpt");
const absorbText = absorbSection !== null ? absorbSection : absorbFileText;

const failures = [];
const passes = [];
const nops = [];

// Clauses that have received ANY recorded disposition this run (PASS, FAIL, or N/A — anything
// except silence) — clause 5 consults this set so a charter's LEGITIMATE "this clause's trigger
// did not fire" statement (recorded, not narrated away) is never treated as an undeclared
// self-exemption, per inherited-core.md's clause-5 distinguishing test ("did the record show the
// gate was EVALUATED and DISPOSITIONED ... or was the gate's applicability argued away with no
// disposition recorded at all"). Populated by clauses 1-4 below as each runs.
const dispositionedClauses = new Set();

// --- Clause 1: Adversarial-audit gate — documentation-discipline check ---
// A valid disposition is EITHER a stated verdict (REFUTED / CONCERNS / NO REFUTATION FOUND,
// case-insensitive) OR an explicit no-op statement ("neither condition applied" or equivalent
// "gate does not apply" / "N/A" language directly adjacent to "adversarial-audit").
{
  const hasVerdict = /adversarial-audit[\s\S]{0,200}?\b(REFUTED|CONCERNS|NO REFUTATION FOUND)\b/i.test(absorbText)
    || /\b(REFUTED|CONCERNS|NO REFUTATION FOUND)\b[\s\S]{0,200}?adversarial-audit/i.test(absorbText);
  const hasNoop = /adversarial-audit[\s\S]{0,200}?(neither condition (applied|fired)|does not apply|N\/A|no-op)/i.test(absorbText)
    || /(neither condition (applied|fired)|documented no-op)[\s\S]{0,200}?adversarial-audit/i.test(absorbText);
  if (hasVerdict || hasNoop) {
    passes.push("clause1-adversarial-audit: disposition statement present" + (hasVerdict ? " (verdict)" : " (documented no-op)"));
    dispositionedClauses.add("adversarial-audit");
  } else {
    failures.push("clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text (missing verdict AND missing documented-no-op statement)");
  }
}

// --- Clause 2: V_meta consolidation-lag gate — documentation-discipline check ---
{
  const hasDisposition = /V_meta consolidation[- ]lag[\s\S]{0,200}?\b(clear|no rows? (past|over) threshold|resolved|consolidated|carry-forward|K=2)\b/i.test(absorbText)
    || /\b(clear|no rows? (past|over) threshold|resolved|consolidated|carry-forward)\b[\s\S]{0,200}?V_meta consolidation[- ]lag/i.test(absorbText);
  if (hasDisposition) {
    passes.push("clause2-vmeta-lag: disposition statement present");
    dispositionedClauses.add("V_meta consolidation-lag");
  } else {
    failures.push("clause2-vmeta-lag: NO disposition statement found in ABSORB-entry text (missing 'clear'/'no rows past threshold'/resolved/consolidated/carry-forward statement)");
  }
}

// --- Clause 3: Line-budget gate — reuse it0-ceiling-line-budget-check.sh directly ---
{
  const scriptPath = path.join(__dirname, "it0-ceiling-line-budget-check.sh");
  if (!fs.existsSync(scriptPath)) {
    console.error(`ERROR: sibling script not found: ${scriptPath}`);
    process.exit(2);
  }
  try {
    const out = execFileSync(scriptPath, [charterFile], { encoding: "utf8" });
    passes.push(`clause3-line-budget: PASS — ${out.trim().split("\n")[0]}`);
    dispositionedClauses.add("line-budget");
  } catch (e) {
    const out = (e.stdout || "").toString().trim();
    if (e.status === 1) {
      failures.push(`clause3-line-budget: FAIL — ${out.split("\n")[0] || "(no output)"}`);
      dispositionedClauses.add("line-budget");
    } else {
      console.error(`ERROR: it0-ceiling-line-budget-check.sh usage/environment error (exit ${e.status}): ${(e.stderr || "").toString().trim()}`);
      process.exit(2);
    }
  }
}

// --- Clause 4: Design-only-milestone impl-row gate — reuse it0-impl-row-check.sh directly ---
// Materialize a temp backlog file from the ABSORB-entry text's "## Backlog row" section (a single
// `| id | ... |` line) so the existing script can be run against a fixture/synthetic milestone
// without touching the real backlog.md.
{
  const scriptPath = path.join(__dirname, "it0-impl-row-check.sh");
  if (!fs.existsSync(scriptPath)) {
    console.error(`ERROR: sibling script not found: ${scriptPath}`);
    process.exit(2);
  }
  const backlogSectionMatch = absorbFileText.match(/## Backlog row\n([\s\S]*?)(\n##|\n?$)/);
  if (!backlogSectionMatch) {
    console.error(`ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause against a synthetic milestone)`);
    process.exit(2);
  }
  const backlogRows = backlogSectionMatch[1]
    .split("\n")
    .filter((l) => l.trim().startsWith("|"));
  if (backlogRows.length === 0) {
    console.error(`ERROR: "## Backlog row" section has no pipe-delimited row line`);
    process.exit(2);
  }
  const tmpBacklog = path.join(os.tmpdir(), `it0-dod-check-backlog-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(tmpBacklog, backlogRows.join("\n") + "\n");
  try {
    const out = execFileSync(scriptPath, [milestoneId, tmpBacklog], { encoding: "utf8" });
    passes.push(`clause4-impl-row: PASS — ${out.trim().split("\n")[0]}`);
    dispositionedClauses.add("impl-row");
  } catch (e) {
    const out = (e.stdout || "").toString().trim();
    if (e.status === 1) {
      failures.push(`clause4-impl-row: FAIL — ${out.split("\n")[0] || "(no output)"}`);
      dispositionedClauses.add("impl-row");
    } else {
      console.error(`ERROR: it0-impl-row-check.sh usage/environment error (exit ${e.status}): ${(e.stderr || "").toString().trim()}`);
      process.exit(2);
    }
  } finally {
    fs.rmSync(tmpBacklog, { force: true });
  }
}

// --- Clause 5: No-self-exemption meta-clause ---
// Scan the CHARTER's "Explicitly OUT of scope" section for exemption-adjacent language paired
// with one of the 4 clause names, then require a matching WAIVER line in the ABSORB-entry text.
//
// DIR-019 fix: clauses 3 (line-budget) and 4 (impl-row) are executed UNCONDITIONALLY every run
// (see clause 3/4 blocks above — they always call dispositionedClauses.add(...) regardless of
// outcome). That means "already dispositioned" is NOT evidence a self-exemption of those two
// clauses is legitimate — it is true on every single run, mechanically, so the carve-out was
// dead code for them and let an undeclared self-exemption of line-budget/impl-row pass silently
// (the exact bug DIR-019 reports). Only clauses 1 (adversarial-audit) and 2 (V_meta
// consolidation-lag) are dispositioned CONDITIONALLY — their "already dispositioned" state means
// a real, independently-recorded legitimate-non-firing determination, so the carve-out remains
// valid ONLY for those two. Concretely: exemption language for line-budget/impl-row always
// requires a matching WAIVER line, regardless of dispositionedClauses; exemption language for
// adversarial-audit/V_meta-lag is still allowed to rely on the conditional-disposition carve-out.
{
  const MECHANICALLY_UNCONDITIONAL_CLAUSES = new Set(["line-budget", "impl-row"]);
  const clauseNames = [
    { key: "adversarial-audit", pattern: /adversarial[- ]audit/i },
    { key: "V_meta consolidation-lag", pattern: /V_meta consolidation[- ]lag|V_meta[- ]lag/i },
    { key: "line-budget", pattern: /line[- ]budget/i },
    { key: "impl-row", pattern: /impl-row|-IMPL row/i },
  ];
  const outOfScopeMatch = charterText.match(/##+ Explicitly OUT of scope[\s\S]*?(\n##+ |$)/i);
  const outOfScopeText = outOfScopeMatch ? outOfScopeMatch[0] : "";
  const exemptionLangPattern = /\b(exempt|exempted|exempts|does not apply|skip the gate|skips? this gate|not applicable to this gate)\b/i;

  const undeclaredExemptions = [];
  if (outOfScopeText) {
    // Scan line by line: a line mentions a clause name AND exemption language together.
    for (const rawLine of outOfScopeText.split("\n")) {
      for (const { key, pattern } of clauseNames) {
        if (pattern.test(rawLine) && exemptionLangPattern.test(rawLine)) {
          if (dispositionedClauses.has(key) && !MECHANICALLY_UNCONDITIONAL_CLAUSES.has(key)) continue; // legitimate non-firing, already dispositioned above (only for conditionally-dispositioned clauses 1/2)
          // Check for a corresponding waiver line for this milestone + this clause.
          const waiverPattern = new RegExp(
            `WAIVER:\\s*${milestoneId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*[^|]*${key.split(" ")[0]}`,
            "i"
          );
          if (!waiverPattern.test(absorbText)) {
            undeclaredExemptions.push({ clause: key, line: rawLine.trim() });
          }
        }
      }
    }
  }

  if (undeclaredExemptions.length > 0) {
    for (const u of undeclaredExemptions) {
      failures.push(`clause5-no-self-exemption: charter's "Explicitly OUT of scope" section exempts "${u.clause}" with NO matching WAIVER line found in ABSORB-entry text — offending line: "${u.line}"`);
    }
  } else {
    passes.push("clause5-no-self-exemption: no undeclared self-exemption language found (or all found exemptions have a matching WAIVER line)");
  }
}

console.log(`--- it0-dod-check: ${milestoneId} ---`);
console.log(`charter: ${charterFile}`);
console.log(`absorb-entry: ${absorbEntryFile}`);
console.log("");
for (const p of passes) console.log(`PASS: ${p}`);
for (const n of nops) console.log(`N/A: ${n}`);
for (const f of failures) console.log(`FAIL: ${f}`);
console.log("");

if (failures.length > 0) {
  console.log(`FAIL: DoD check failed — ${failures.length} clause violation(s) found (see above).`);
  process.exit(1);
} else {
  console.log(`PASS: DoD check passed — all clauses satisfied (${passes.length} disposition(s) confirmed), no undeclared self-exemption.`);
  process.exit(0);
}
