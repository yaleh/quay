#!/usr/bin/env node
// it0-dod-check.mjs — DoD meta-enforcer, charters M25-dod-meta-enforcer (DIR-017 Step 1, clauses
// 0-5) and M32-dod-escrow-testfloor (DIR-017 Step 2, clauses 6-7).
//
// Given a milestone id, a charter file path, and an ABSORB-entry text file (a fixture standing in
// for the real dashboard.md/ABSORB log excerpt for milestones not yet ABSORBed), runs all 8 DoD
// clauses (0-7) defined in `inherited-core.md`'s "Definition of Done" section:
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
//   6. Escrow-Δv gate (M32/DIR-017 Step 2) — documentation-discipline check only, mirroring
//      clauses 1/2's shape. Fires ONLY when the milestone is design-only (same trigger as clause
//      4, read from the "## Backlog row" section) AND the ABSORB-entry text claims a nonzero VT
//      Δv. FAILs if that Δv claim lacks escrow/provisional language adjacent to it.
//   7. Product-work test-floor gate (M32/DIR-017 Step 2) — trigger-condition-by-label check
//      mirroring clause 4's shape, but the "what it checks" half is documentation-discipline
//      (mirrors clauses 1/2). Fires when the milestone's backlog row's `surface:` label(s)
//      indicate product-touching scope (cli/web-ui/provider-abi/mcp, or no surface label at all —
//      fail-closed) as opposed to method-infra/docs/cross-cutting/packaging. FAILs if the
//      ABSORB-entry text has neither a ≥80%-coverage disposition nor a matching test-floor
//      WAIVER line (reuses clause 5's waiver-line syntax, clause name "test-floor").
//
// This script does NOT re-run the adversarial-audit subagent, does NOT recompute v-meta-ledger.md
// arithmetic, does NOT re-implement the line-budget/impl-row scripts' own logic, and does NOT
// independently verify a claimed test-coverage percentage against a real coverage-tool run — see
// inherited-core.md's "Definition of Done" section for why (clauses 1/2/6/7 are documentation-
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
//   0 = all 8 gate clauses (0-7) PASS or legitimately N/A (with disposition present), AND no
//       undeclared self-exemption found.
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

// --- Clause 0: AC + DoD present and well-formed in the TASK (single source of truth) ---
// AC/DoD are authored at proposal stage and recorded in the task body (tasks/<id>.md), per
// inherited-core.md's "AC/DoD live in the TASK" rule (proposal↔task / plan↔milestone). This clause
// checks PRESENCE + SHAPE only — whether each AC criterion is actually MET is the per-milestone
// acceptance audit's job (OUTER-LOOP.md step 6). Source text: the task file tasks/<milestoneId>.md
// if found (real run), else the charter/fixture file text (fixture run, which embeds the two
// sections at top level so a synthetic milestone can be exercised without a real task file).
{
  const taskCandidates = [
    path.join(process.cwd(), "tasks", `${milestoneId}.md`),
    path.join(__dirname, "..", "..", "..", "tasks", `${milestoneId}.md`),
  ];
  const taskPath = taskCandidates.find((p) => fs.existsSync(p));
  const taskText = taskPath ? fs.readFileSync(taskPath, "utf8") : charterFileText;
  const acSection = extractSection(taskText, "Acceptance Criteria");
  const dodSection = extractSection(taskText, "Definition of Done");

  const placeholderRe = /^\s*([-*]|\d+[.)])\s*(TBD|TODO|N\/A|xxx|\.\.\.)?\s*$/i;
  const acClauses = acSection
    ? acSection.split("\n").filter((l) =>
        /^\s*([-*]|\d+[.)])\s+\S/.test(l) &&
        l.replace(/^\s*([-*]|\d+[.)])\s+/, "").trim().length >= 8 &&
        !placeholderRe.test(l))
    : [];
  const dodRefRe = /(standard|inherited-core|five clauses|clause\s*[1-5]|meta-enforcer)/i;

  const clause0Fail = [];
  if (acSection === null) clause0Fail.push("no '## Acceptance Criteria' section found in the task");
  else if (acClauses.length === 0) clause0Fail.push("'## Acceptance Criteria' section has no concrete checkable clause (needs >=1 non-placeholder bullet/numbered line)");
  if (dodSection === null) clause0Fail.push("no '## Definition of Done' section found in the task");
  else if (dodSection.trim().length === 0) clause0Fail.push("'## Definition of Done' section is empty");
  else if (!dodRefRe.test(dodSection)) clause0Fail.push("'## Definition of Done' section does not reference the standard DoD (must reference the standard five clauses / inherited-core, per the reference-plus-extras rule)");

  const srcLabel = taskPath ? `[${path.relative(process.cwd(), taskPath)}]` : "[fixture text — no real task file]";
  if (clause0Fail.length === 0) {
    passes.push(`clause0-ac-dod-present: task AC has ${acClauses.length} checkable clause(s); DoD references the standard ${srcLabel}`);
    dispositionedClauses.add("ac-dod");
  } else {
    for (const m of clause0Fail) failures.push(`clause0-ac-dod-present: ${m} ${srcLabel}`);
  }
}

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
// M32 extension (clauses 6/7): both new clauses are, LIKE clauses 3/4, run UNCONDITIONALLY every
// run (see clause 6/7 blocks below — they always call dispositionedClauses.add(...) regardless of
// outcome, N/A-pass included). Per the SAME DIR-019 reasoning above, they therefore belong in
// MECHANICALLY_UNCONDITIONAL_CLAUSES too — an "already dispositioned" state for escrow-delta-v or
// test-floor is NOT evidence a self-exemption of them is legitimate, so exemption language for
// either always requires a matching WAIVER line, never relying on the conditional-disposition
// carve-out. NOTE: this block executes BEFORE the clause 6/7 blocks further below in file order,
// so `dispositionedClauses` does not yet contain "escrow-delta-v"/"test-floor" at the time this
// runs — harmless, since both are in MECHANICALLY_UNCONDITIONAL_CLAUSES and so the
// already-dispositioned carve-out is skipped for them regardless of add-order; listed here purely
// so a self-exemption of clause 6/7 in the charter's "Explicitly OUT of scope" section is still
// caught by clause 5's scan.
{
  const MECHANICALLY_UNCONDITIONAL_CLAUSES = new Set(["line-budget", "impl-row", "escrow-delta-v", "test-floor"]);
  const clauseNames = [
    { key: "adversarial-audit", pattern: /adversarial[- ]audit/i },
    { key: "V_meta consolidation-lag", pattern: /V_meta consolidation[- ]lag|V_meta[- ]lag/i },
    { key: "line-budget", pattern: /line[- ]budget/i },
    { key: "impl-row", pattern: /impl-row|-IMPL row/i },
    { key: "escrow-delta-v", pattern: /escrow[- ]δ?v|escrow-delta-v|escrow[- ]Δv/i },
    { key: "test-floor", pattern: /test[- ]floor/i },
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

// --- Clause 6: Escrow-Δv gate (M32 / DIR-017 Step 2) ---
// Documentation-discipline check, same shape as clauses 1/2 — does NOT re-derive whether a claimed
// Δv figure is numerically correct, only whether its FINALITY is correctly qualified for a
// design-only milestone. Trigger condition reuses clause 4's own design-only determination, read
// from the SAME SOURCE clause 4 reads (the "## Backlog row" section's single pipe-delimited row
// line for this milestone id — NOT the whole fixture/ABSORB/charter prose, which may discuss the
// design-only markers in the negative, e.g. "no 'design delivered' wording" — a whole-text
// substring scan would false-positive on such text, exactly as `it0-impl-row-check.sh` itself
// avoids by scoping its own grep to the single matched row line).
{
  const clause6BacklogSectionMatch = absorbFileText.match(/## Backlog row\n([\s\S]*?)(\n##|\n?$)/);
  const clause6BacklogRowLine = clause6BacklogSectionMatch
    ? (clause6BacklogSectionMatch[1].split("\n").find((l) => l.trim().startsWith("|") && l.includes(`| ${milestoneId} |`)) || "")
    : "";
  const designOnlyMarkerRe = /design delivered|design[- ]doc only|design only|design \(doc only\)/i;
  const futureImplChecklistRe = /done-when clauses a future implementing milestone( would need)?/i;
  const isDesignOnly = designOnlyMarkerRe.test(clause6BacklogRowLine) || futureImplChecklistRe.test(clause6BacklogRowLine)
    || futureImplChecklistRe.test(charterText); // charter's OWN checklist heading (not prose ABOUT it) is a legitimate second signal, mirroring inherited-core.md's clause-4 definition (a) OR (b)

  if (!isDesignOnly) {
    passes.push("clause6-escrow-delta-v: N/A — milestone is not design-only (rule does not apply)");
    dispositionedClauses.add("escrow-delta-v");
  } else {
    // A "no VT chart cell" / "Δv̂: 0" style disposition means there is no Δv claim to escrow.
    const noDeltaVClaim = /(δv̂?|delta[- ]?v)\s*[:=]?\s*0\b|no vt chart cell|no vt point/i.test(absorbText);
    // A nonzero Δv claim: look for a VT-curve-append style statement (Δv/delta-v with a nonzero
    // number, or explicit "VT-curve" append language) anywhere in the ABSORB-entry text.
    const deltaVClaimRe = /(δv̂?|delta[- ]?v)[^\n.]{0,60}?[1-9][0-9.]*|VT[- ]curve[^\n.]{0,80}?append/i;
    const hasNonzeroDeltaVClaim = !noDeltaVClaim && deltaVClaimRe.test(absorbText);

    if (!hasNonzeroDeltaVClaim) {
      passes.push("clause6-escrow-delta-v: PASS — design-only milestone claims no Δv (documented no-op, e.g. 'Δv̂: 0, no VT chart cell')");
      dispositionedClauses.add("escrow-delta-v");
    } else {
      // Escrow language must appear reasonably close to the Δv claim AND not be a NEGATED mention
      // (e.g. "with NO escrow/provisional language anywhere near the claim" must NOT count as
      // compliant escrow language — a fixture-construction hazard caught while building this
      // clause: prose describing the ABSENCE of escrow language contains the word "escrow" itself).
      // Two containment measures: (1) the window is narrowed to the Δv claim's OWN
      // bullet/paragraph only (bounded by blank lines / bullet starts, not a fixed ±150-char slice
      // that can spill into an adjacent explanatory sentence); (2) within that window, an escrow
      // keyword is only counted if NOT immediately preceded (within 3 words) by a negation word
      // (no/not/without/lacks/lacking/absent/missing).
      const claimMatch = absorbText.match(deltaVClaimRe);
      const claimIdx = claimMatch ? claimMatch.index : -1;
      let claimWindow = "";
      if (claimIdx >= 0) {
        const before = absorbText.slice(0, claimIdx);
        const after = absorbText.slice(claimIdx);
        const paraStart = Math.max(before.lastIndexOf("\n\n"), before.lastIndexOf("\n- "), before.lastIndexOf("\n* "));
        const windowStart = paraStart >= 0 ? paraStart : Math.max(0, claimIdx - 150);
        const afterParaEndMatch = after.match(/\n\n|\n[-*] /);
        const windowEnd = afterParaEndMatch ? claimIdx + afterParaEndMatch.index : Math.min(absorbText.length, claimIdx + 150);
        claimWindow = absorbText.slice(windowStart, windowEnd);
      }
      const escrowKeywordRe = /(escrow(ed)?|provisional|pending[- ](the )?-?impl|not yet (confirmed|final))/gi;
      // A negation word "poisons" every escrow-keyword occurrence up to the next SENTENCE
      // boundary (., —, or a blank-line/bullet break) — not merely the single nearest occurrence —
      // because a real fixture (and plausibly a real ABSORB entry too) commonly lists several
      // escrow-adjacent terms in one negated slash/quote-delimited list, e.g. `no
      // "escrow"/"provisional"/"pending -IMPL" qualifier anywhere near this claim`. Find the
      // nearest negation word BEFORE the keyword match and confirm no sentence-ending punctuation
      // sits between them.
      const negationWordRe = /\b(no|not|without|lacks?|lacking|absent|missing)\b/gi;
      let hasAdjacentEscrowLang = false;
      let kwMatch;
      while ((kwMatch = escrowKeywordRe.exec(claimWindow)) !== null) {
        const precedingText = claimWindow.slice(0, kwMatch.index);
        // Nearest sentence boundary before this keyword (., —, or blank line) — negation only
        // "reaches" back to there, not further.
        let sentenceStart = 0;
        for (const marker of [".", "—", "\n\n"]) {
          const idx = precedingText.lastIndexOf(marker);
          if (idx > sentenceStart) sentenceStart = idx + marker.length;
        }
        const sentenceSoFar = precedingText.slice(sentenceStart);
        let negated = false;
        let negMatch;
        negationWordRe.lastIndex = 0;
        while ((negMatch = negationWordRe.exec(sentenceSoFar)) !== null) {
          negated = true;
          break;
        }
        if (!negated) {
          hasAdjacentEscrowLang = true;
          break;
        }
      }

      if (hasAdjacentEscrowLang) {
        passes.push("clause6-escrow-delta-v: PASS — design-only milestone's Δv claim is explicitly marked escrowed/provisional");
        dispositionedClauses.add("escrow-delta-v");
      } else {
        failures.push("clause6-escrow-delta-v: FAIL — design-only milestone claims a nonzero Δv with NO escrow/provisional language adjacent to the claim (Δv would be wrongly treated as final before the corresponding -IMPL row ships)");
        dispositionedClauses.add("escrow-delta-v");
      }
    }
  }
}

// --- Clause 7: Product-work test-floor gate (M32 / DIR-017 Step 2) ---
// Trigger-condition-by-label check (mirrors clause 4's shape) + documentation-discipline check
// (mirrors clauses 1/2/6) for the "what it checks" half. Reads the `surface:` label(s) from the
// "## Backlog row" section (same source clause 4 already parses).
{
  const NON_PRODUCT_SURFACES = ["method-infra", "docs", "cross-cutting", "packaging"];
  const PRODUCT_SURFACE_COMPONENTS = ["cli", "web-ui", "provider-abi", "mcp"];

  const backlogSectionMatch = absorbFileText.match(/## Backlog row\n([\s\S]*?)(\n##|\n?$)/);
  const backlogRowLine = backlogSectionMatch
    ? backlogSectionMatch[1].split("\n").find((l) => l.trim().startsWith("|")) || ""
    : "";
  const surfaceLabelMatches = [...backlogRowLine.matchAll(/surface:([a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase());

  // A label "matches" a product-touching surface if it IS one of the 4 exact names, or (for
  // compound labels like `cli-mcp-webui-docs`) if it CONTAINS one of the 4 component substrings
  // (component-wise, not exact-string matching — a milestone cannot dodge the gate by folding a
  // product surface into a multi-surface compound tag). `web-ui` is checked both hyphenated and
  // as the de-hyphenated `webui` substring seen in some legacy compound labels (e.g.
  // `cli-mcp-webui-docs`).
  const labelIsProductTouching = (label) =>
    PRODUCT_SURFACE_COMPONENTS.some((p) => label === p || label.includes(p) || label.includes(p.replace("-", "")));
  const labelIsExactlyNonProduct = (label) => NON_PRODUCT_SURFACES.includes(label);

  let triggerFires;
  if (surfaceLabelMatches.length === 0) {
    // No surface: label at all — fail-closed, treated as product-touching.
    triggerFires = true;
  } else if (surfaceLabelMatches.some(labelIsProductTouching)) {
    // Any present label resolves to a product-touching surface (exact or compound-component) —
    // fires regardless of any other co-present non-product labels.
    triggerFires = true;
  } else if (surfaceLabelMatches.every(labelIsExactlyNonProduct)) {
    // Every present label is EXACTLY one of the 4 known non-product-touching names — N/A-passes.
    triggerFires = false;
  } else {
    // At least one present label is neither a recognized product-touching nor a recognized
    // non-product-touching surface (an unknown/future label) — fail-closed, treat as
    // product-touching rather than silently exempting an unrecognized surface.
    triggerFires = true;
  }

  if (!triggerFires) {
    passes.push(`clause7-test-floor: N/A — surface label(s) [${surfaceLabelMatches.join(", ")}] are exclusively non-product-touching (method-infra/docs/cross-cutting/packaging)`);
    dispositionedClauses.add("test-floor");
  } else {
    const coverageDispositionRe = /\b(test[- ]coverage|tests? exist|test floor)\b[^\n]{0,120}?(\b(8[0-9]|9[0-9]|100)(\.\d+)?\s*%|≥\s*80\s*%|full coverage|complete coverage)|(\b(8[0-9]|9[0-9]|100)(\.\d+)?\s*%|≥\s*80\s*%)[^\n]{0,120}?\b(test[- ]coverage|coverage|tests?)\b/i;
    const waiverPattern = new RegExp(
      `WAIVER:\\s*${milestoneId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*[^|]*test-floor`,
      "i"
    );
    const hasCoverageDisposition = coverageDispositionRe.test(absorbText);
    const hasWaiver = waiverPattern.test(absorbText);

    if (hasCoverageDisposition || hasWaiver) {
      passes.push(`clause7-test-floor: PASS — product-touching surface [${surfaceLabelMatches.length ? surfaceLabelMatches.join(", ") : "none/fail-closed"}] has a ` + (hasCoverageDisposition ? "recorded ≥80% coverage disposition" : "matching test-floor WAIVER line"));
      dispositionedClauses.add("test-floor");
    } else {
      failures.push(`clause7-test-floor: FAIL — product-touching surface [${surfaceLabelMatches.length ? surfaceLabelMatches.join(", ") : "none/fail-closed"}] has NEITHER a ≥80% test-coverage disposition NOR a matching test-floor WAIVER line in the ABSORB-entry text`);
      dispositionedClauses.add("test-floor");
    }
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
