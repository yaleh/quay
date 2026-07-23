#!/usr/bin/env node
// it0-dod-check.mjs — DoD meta-enforcer, charters M25-dod-meta-enforcer (DIR-017 Step 1, clauses
// 0-5), M32-dod-escrow-testfloor (DIR-017 Step 2, clauses 6-7),
// M40-dir014-task-canonical-lifecycle-record (DIR-014 item 6, clause 8), and
// M47-dir034-mechanize-enforcement (DIR-034, clauses 10-12 — folds the previously prose-only
// tree-hygiene/worktree-branch-hygiene/audit-independence checks into this MECHANICAL gate).
//
// Given a milestone id, a charter file path, and an ABSORB-entry text file (a fixture standing in
// for the real dashboard.md/ABSORB log excerpt for milestones not yet ABSORBed), runs all 13 DoD
// clauses (0-12) defined in `inherited-core.md`'s "Definition of Done" section:
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
//   8. Task canonical-lifecycle-record gate (M40-dir014-task-canonical-lifecycle-record / DIR-014
//      item 6) — reuses the SAME extractSection()-style helper Clause 0 uses to pull the target
//      task's `## Proposal` and `## Plan` sections. FAILs if `## Proposal` is missing/empty/
//      placeholder, OR `## Plan` is missing, OR `## Plan` references a `docs/plans/*.md` path that
//      does not resolve on disk. PASSes if `## Plan` states `N/A — <reason>` or references a
//      resolving `docs/plans/*.md` path, and `## Proposal` has real content.
//   10. Tree-hygiene gate (DIR-031/DIR-034) — shells out to the EXISTING `tree-hygiene-check.sh`
//       directly (reused, not re-implemented) against the REAL repo tree. Runs UNCONDITIONALLY
//       every check (mirrors clauses 3/4's shape). Mechanizes what was, before M47, ONLY an
//       OUTER-LOOP.md prose ABSORB close-out — an ABSORB that skipped the prose step passed this
//       gate silently pre-DIR-034.
//   11. Worktree/branch-hygiene gate (DIR-033/DIR-034) — shells out to the EXISTING
//       `worktree-branch-hygiene-check.sh` directly, against the real repo's registered
//       branches/worktrees. Same mechanization rationale/shape as clause 10.
//   12. Audit-independence gate (DIR-032/DIR-034) — shells out to the EXISTING
//       `audit-independence-check.sh` (which wraps `audit-independence-check.mjs`) against the real
//       audit artifact this milestone produced. Conditionally dispositioned (like clauses 1/2/6/7):
//       fires only when the ABSORB-entry text embeds a `## Audit-independence check` section naming
//       the artifact path / orchestrator id / dispatch-record path; N/A-passes (documented no-op)
//       when that section is absent. Mechanizes what was, before M47, an engine-registered gate
//       (DIR-032/M44) never invoked by THIS enforcer (grep=0) — only cited in OUTER-LOOP.md prose.
//
// This script does NOT re-run the adversarial-audit subagent, does NOT recompute v-meta-ledger.md
// arithmetic, does NOT re-implement the line-budget/impl-row/tree-hygiene/worktree-branch-hygiene/
// audit-independence scripts' own logic, and does NOT independently verify a claimed test-coverage
// percentage against a real coverage-tool run — see inherited-core.md's "Definition of Done" section
// for why (clauses 1/2/6/7 are documentation-discipline checks by design; clauses 3/4/10/11/12 wrap
// the existing scripts directly).
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
//   0 = all 13 gate clauses (0-12) PASS or legitimately N/A (with disposition present), AND no
//       undeclared self-exemption found.
//   1 = at least one gate clause FAILs, OR a self-exemption is found with no waiver line.
//   2 = usage/environment error (missing args, files not found, node unavailable, sibling script
//       missing).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import os from "node:os";
// extractSection is now defined ONCE in task-schema.ts (canonical-task-schema unit B1) and shared
// here by import — the section-parsing logic is no longer forked between this enforcer and the
// task-schema check. Behavior is identical (the function was moved verbatim, it is pure).
import { extractSection } from "./task-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A usage/environment error (exit-code-2 path). runDodCheck() throws this instead of calling
// process.exit(2) directly, so the pure function can be imported+unit-tested without terminating the
// test process; the thin CLI wrapper (main) catches it and reproduces the EXACT legacy behavior
// (console.error(message) then process.exit(2)). Behavior-preserving-by-construction: the message
// strings below are byte-identical to the pre-restructure console.error(...) calls.
class DodCheckEnvError extends Error {
  exitCode: number;
  constructor(message: string) {
    super(message);
    this.name = "DodCheckEnvError";
    this.exitCode = 2;
  }
}

// runDodCheck — the pure DoD-clause engine, extracted VERBATIM from the former top-level script body
// (clauses 0-9). Given a milestone id + the already-read charter/absorb file TEXT (charterFileText /
// absorbFileText — the whole-file text of each arg, which may be the same combined-fixture file),
// runs all clauses and returns the accumulated result object. It performs the SAME on-disk reads the
// original did (task-file lookup for clauses 0/8, shell-outs for clauses 3/4 via
// it0-ceiling-line-budget-check.sh / it0-impl-row-check.sh), using `charterFile` only to pass the
// charter path through to the line-budget shell-out exactly as before. Environment errors (missing
// sibling script, malformed backlog section) throw DodCheckEnvError (exit-2) instead of calling
// process.exit(2) — the ONLY structural change; every clause's logic is relocated unchanged.
export function runDodCheck({ milestoneId, charterFile, charterFileText, absorbFileText }) {
// Support two input shapes:
//   (a) real milestone: charter-file is a real charter (charters/M-NN.md), absorb-entry-file is a
//       real dashboard.md/ABSORB-log excerpt — used as-is, whole-file text.
//   (b) combined fixture: a single fixture file (used for BOTH the charter-file and
//       absorb-entry-file args) containing distinct `## Charter excerpt` / `## ABSORB-entry
//       excerpt` sections (see fixtures/dod/*.md) — each role's check must see ONLY its own
//       section, not the whole combined file, otherwise the charter's self-exemption prose and
//       the ABSORB-entry's disposition prose would contaminate each other's scan (a real fixture-
//       construction hazard, not a hypothetical one — caught during this milestone's own build).
// NOTE: extractSection is imported from ./task-schema.ts (moved there verbatim, canonical-task-
// schema unit B1) — the depth-aware section-parsing logic is now shared, not forked between this
// enforcer and the task-schema check. See its definition + doc in task-schema.ts.

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

// DIR-026 (SPLIT-OR-COMMIT): a milestone that cannot fully complete for a factor OUTSIDE project
// control marks the terminal `needs-human` lifecycle outcome instead of a partial/pending delivery.
// Detect a declared needs-human outcome (e.g. a line `OUTCOME: needs-human — <reason>` /
// `Terminal outcome: needs-human ...`) in the ABSORB-entry or charter text, and capture the stated
// reason. Clause 0 waives its unchecked-AC hard-block for a declared needs-human (a blocked
// milestone legitimately has incomplete AC); Clause 9 validates the reason is a genuine EXTERNAL
// blocker (in-project difficulty is NOT a valid needs-human reason — it must be split-and-completed).
const needsHumanRe = /^\s*(?:OUTCOME|STATUS|Terminal outcome|Outcome)\s*[:=]\s*needs-human\b\s*[—:-]?\s*(.*)$/im;
const needsHumanMatch = (absorbText + "\n" + charterText).match(needsHumanRe);
const needsHuman = { declared: !!needsHumanMatch, reason: needsHumanMatch ? needsHumanMatch[1].trim() : "" };

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

  // Checklist-form detection (DIR-020/M34-ac-dod-checklist-writeback, 2026-07-19): a GFM checklist
  // line is `- [ ] text` (unchecked) or `- [x]`/`- [X]` text (checked). This is a STRICTER shape
  // than the general acClauses bullet/numbered-line filter above (which already structurally
  // matches checklist lines via the `[-*]` + `\s+\S` pattern — the `[` of `[ ]` satisfies `\S`).
  // Distinguishing checked vs. unchecked, and HARD-blocking on any remaining unchecked item, is the
  // NEW mechanism this milestone adds — not a shape-regex tweak. Prose-form AC (numbered lines,
  // plain bullets with no `[ ]`/`[x]` token) has ZERO lines matching either checklist regex below,
  // so `isChecklistForm` is false and this whole sub-check is skipped, preserving full backward
  // compatibility with pre-existing prose-form tasks (e.g. M32's `exp5-M-DOD-ESCROW-TESTFLOOR`).
  const uncheckedBoxRe = /^\s*[-*]\s+\[\s\]\s+(\S.*)$/;
  const checkedBoxRe = /^\s*[-*]\s+\[[xX]\]\s+(\S.*)$/;
  const acLines = acSection ? acSection.split("\n") : [];
  const uncheckedBoxes = acLines.filter((l) => uncheckedBoxRe.test(l)).map((l) => l.match(uncheckedBoxRe)[1].trim());
  const checkedBoxes = acLines.filter((l) => checkedBoxRe.test(l));
  const isChecklistForm = (uncheckedBoxes.length + checkedBoxes.length) > 0;

  const clause0Fail = [];
  if (acSection === null) clause0Fail.push("no '## Acceptance Criteria' section found in the task");
  else if (acClauses.length === 0) clause0Fail.push("'## Acceptance Criteria' section has no concrete checkable clause (needs >=1 non-placeholder bullet/numbered line)");
  else if (isChecklistForm && uncheckedBoxes.length > 0 && !needsHuman.declared) {
    // DIR-026: an unchecked AC box hard-blocks a milestone claiming DONE (no partial/pending). A
    // milestone that instead declares the terminal `needs-human` outcome legitimately has
    // incomplete AC (it is externally blocked, not done) — the unchecked-box block is waived here;
    // Clause 9 then validates that the needs-human reason is a genuine EXTERNAL blocker.
    clause0Fail.push(`checklist-form AC has ${uncheckedBoxes.length} unchecked item(s) remaining (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does): ${uncheckedBoxes.map((t) => `"${t}"`).join(", ")}`);
  }
  if (dodSection === null) clause0Fail.push("no '## Definition of Done' section found in the task");
  else if (dodSection.trim().length === 0) clause0Fail.push("'## Definition of Done' section is empty");
  else if (!dodRefRe.test(dodSection)) clause0Fail.push("'## Definition of Done' section does not reference the standard DoD (must reference the standard five clauses / inherited-core, per the reference-plus-extras rule)");

  const srcLabel = taskPath ? `[${path.relative(process.cwd(), taskPath)}]` : "[fixture text — no real task file]";
  if (clause0Fail.length === 0) {
    const shapeNote = isChecklistForm ? `checklist-form, ${checkedBoxes.length}/${checkedBoxes.length + uncheckedBoxes.length} checked` : "prose-form";
    passes.push(`clause0-ac-dod-present: task AC has ${acClauses.length} checkable clause(s) (${shapeNote}); DoD references the standard ${srcLabel}`);
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
    throw new DodCheckEnvError(`ERROR: sibling script not found: ${scriptPath}`);
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
      throw new DodCheckEnvError(`ERROR: it0-ceiling-line-budget-check.sh usage/environment error (exit ${e.status}): ${(e.stderr || "").toString().trim()}`);
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
    throw new DodCheckEnvError(`ERROR: sibling script not found: ${scriptPath}`);
  }
  const backlogSectionMatch = absorbFileText.match(/## Backlog row\n([\s\S]*?)(\n##|\n?$)/);
  if (!backlogSectionMatch) {
    throw new DodCheckEnvError(`ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause against a synthetic milestone)`);
  }
  const backlogRows = backlogSectionMatch[1]
    .split("\n")
    .filter((l) => l.trim().startsWith("|"));
  if (backlogRows.length === 0) {
    throw new DodCheckEnvError(`ERROR: "## Backlog row" section has no pipe-delimited row line`);
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
      throw new DodCheckEnvError(`ERROR: it0-impl-row-check.sh usage/environment error (exit ${e.status}): ${(e.stderr || "").toString().trim()}`);
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
  // M47/DIR-034: clauses 10/11 (tree-hygiene, worktree-branch-hygiene) run UNCONDITIONALLY every
  // run (see their blocks above — always dispositioned regardless of outcome), so they belong in
  // MECHANICALLY_UNCONDITIONAL_CLAUSES for the SAME DIR-019 reasoning as line-budget/impl-row/etc:
  // an "already dispositioned" state is not evidence a self-exemption of them is legitimate. Clause
  // 12 (audit-independence) is, by contrast, CONDITIONALLY dispositioned (like clauses 1/2) — it
  // legitimately N/A-passes when no audit ran this milestone — so it is NOT listed here, mirroring
  // clauses 1/2's own placement.
  const MECHANICALLY_UNCONDITIONAL_CLAUSES = new Set(["line-budget", "impl-row", "escrow-delta-v", "test-floor", "task-canonical-lifecycle-record", "tree-hygiene", "worktree-branch-hygiene"]);
  const clauseNames = [
    { key: "adversarial-audit", pattern: /adversarial[- ]audit/i },
    { key: "V_meta consolidation-lag", pattern: /V_meta consolidation[- ]lag|V_meta[- ]lag/i },
    { key: "line-budget", pattern: /line[- ]budget/i },
    { key: "impl-row", pattern: /impl-row|-IMPL row/i },
    { key: "escrow-delta-v", pattern: /escrow[- ]δ?v|escrow-delta-v|escrow[- ]Δv/i },
    { key: "test-floor", pattern: /test[- ]floor/i },
    { key: "task-canonical-lifecycle-record", pattern: /task canonical[- ]lifecycle[- ]record|proposal\/plan|proposal-plan/i },
    { key: "tree-hygiene", pattern: /tree[- ]hygiene/i },
    { key: "worktree-branch-hygiene", pattern: /worktree[- ]branch[- ]hygiene|worktree\/branch[- ]hygiene/i },
    { key: "audit-independence", pattern: /audit[- ]independence/i },
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
    const coverageDispositionRe = /\b(test[- ]coverage|tests? exist|test floor)\b[^\n]{0,120}?(\b(8[0-9]|9[0-9]|100)(\.\d+)?\s*%|≥\s*80\s*%|full coverage|complete coverage)|(\b(8[0-9]|9[0-9]|100)(\.\d+)?\s*%|≥\s*80\s*%)[^\n]{0,120}?\b(test[- ]coverage|coverage|tests?)\b/gi;
    // A coverage-disposition-shaped match is discounted if the SAME SENTENCE also carries negation
    // language (e.g. "no 80% test coverage floor was met" / "decided it wasn't necessary; coverage
    // remains ~9%") — found live during the M32 acceptance audit: the un-negation-aware regex
    // false-PASSed prose that plainly admits inadequate coverage while incidentally mentioning
    // "80%"/"test coverage". Mirrors Clause 6's sentence-scoped negation-window technique.
    const coverageNegationWordRe = /\b(no|not|without|lacks?|lacking|absent|missing|insufficient|inadequate|below|under|wasn'?t|isn'?t|doesn'?t|didn'?t|aren'?t|weren'?t|couldn'?t|shouldn'?t|wouldn'?t)\b/gi;
    let hasCoverageDisposition = false;
    let covMatch;
    while ((covMatch = coverageDispositionRe.exec(absorbText)) !== null) {
      const precedingText = absorbText.slice(0, covMatch.index);
      let sentenceStart = 0;
      for (const marker of [".", "—", "\n\n", ";"]) {
        const idx = precedingText.lastIndexOf(marker);
        if (idx > sentenceStart) sentenceStart = idx + marker.length;
      }
      const afterText = absorbText.slice(covMatch.index);
      const sentenceEndMatch = afterText.match(/[.;—]|\n\n/);
      const sentenceEnd = sentenceEndMatch ? covMatch.index + sentenceEndMatch.index : absorbText.length;
      const fullSentence = absorbText.slice(sentenceStart, sentenceEnd);
      coverageNegationWordRe.lastIndex = 0;
      if (!coverageNegationWordRe.test(fullSentence)) {
        hasCoverageDisposition = true;
        break;
      }
    }
    const waiverPattern = new RegExp(
      `WAIVER:\\s*${milestoneId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*[^|]*test-floor`,
      "i"
    );
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

// --- Clause 8: Task canonical-lifecycle-record gate (DIR-014 item 6 / M40-dir014-task-canonical-
// lifecycle-record) ---
// Trigger condition: FORWARD-ONLY, mirroring DIR-020/M34's own "checklist form MANDATED going
// forward ... NOT retroactively rewritten ... no retroactive sweep required" precedent for Clause 0
// — and this milestone's own charter's explicit "Explicitly OUT of scope: Retroactively backfilling
// `## Proposal`/`## Plan` onto the ≤M39 milestones' tasks ... this is forward-only, same as
// DIR-020's AC/DoD rule." A brand-new REQUIRED SECTION (unlike Clause 0's checklist-vs-prose SHAPE
// distinction, where the section always existed) cannot be made unconditional without violating
// that explicit out-of-scope constraint — every one of the 23 pre-M40 `exp5-M-*` tasks lacks a
// `## Proposal` section entirely (verified at charter-authoring time, see charter's "Current-state
// notes"), so an unconditional trigger would HARD-BLOCK all of them retroactively, exactly what is
// disclaimed. Cutover mechanism: reuse the EXISTING `milestone:M<N>` task label convention (already
// present on most `exp5-M-*` tasks, see e.g. this task's own `milestone:M40-...` label) — the
// clause fires only for tasks whose label's milestone number is >= 40 (this milestone, the first to
// require the section). A task with NO `milestone:M<N>` label, or one whose label's N < 40, is
// legacy/pre-cutover and N/A-passes (grandfathered), stated explicitly, not silently skipped.
{
  const taskCandidates = [
    path.join(process.cwd(), "tasks", `${milestoneId}.md`),
    path.join(__dirname, "..", "..", "..", "tasks", `${milestoneId}.md`),
  ];
  const taskPath = taskCandidates.find((p) => fs.existsSync(p));
  const taskText = taskPath ? fs.readFileSync(taskPath, "utf8") : charterFileText;
  const srcLabel = taskPath ? `[${path.relative(process.cwd(), taskPath)}]` : "[fixture text — no real task file]";

  const CLAUSE8_CUTOVER_MILESTONE_NUM = 40;
  // exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH (M124): a task can carry MULTIPLE `milestone:M<N>`
  // labels over its lifetime (e.g. an early discovery label plus the real landing label added later,
  // when re-selected/re-scoped) — a task only ever GAINS higher-numbered labels after landing, never
  // a lower one, so the MAXIMUM matched number is the real/final landing milestone. A single `.match`
  // here returned only the FIRST label in file order, which could be a stale low-numbered discovery
  // label below the cutover even when the task's real landing milestone was well past it.
  //
  // Scope the scan to the frontmatter block ONLY when real frontmatter is present (a real task file),
  // not the whole document text — the M124 adversarial audit found that scanning the whole text lets
  // an unrelated `milestone:M<N>`-shaped string incidentally quoted in the task's OWN prose body (e.g.
  // discussing a different task's label, or this exact defect's own writeup) spuriously inflate the
  // max and misfire the cutover. Real labels live in the frontmatter `labels:` block; scanning just
  // that substring is both correct and sufficient. Fixture/charter text (the no-real-task-file
  // fallback below) has no `---`-delimited frontmatter — falls back to scanning the whole fixture
  // text, unchanged, preserving every existing fixture's `label: milestone:M<N>` convention.
  const frontmatterMatch = taskText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const labelScanText = frontmatterMatch ? frontmatterMatch[1] : taskText;
  const milestoneLabelMatches = [...labelScanText.matchAll(/milestone:M-?(\d+)/gi)];
  const taskMilestoneNum = milestoneLabelMatches.length > 0
    ? Math.max(...milestoneLabelMatches.map((m) => parseInt(m[1], 10)))
    : null;
  const clause8Applies = taskMilestoneNum !== null && taskMilestoneNum >= CLAUSE8_CUTOVER_MILESTONE_NUM;

  if (!clause8Applies) {
    const reason = taskMilestoneNum === null
      ? "no 'milestone:M<N>' label found — legacy/unlabeled task, predates the DIR-014 item 6 cutover"
      : `milestone:M${taskMilestoneNum} < M${CLAUSE8_CUTOVER_MILESTONE_NUM} cutover — legacy task, predates DIR-014 item 6 (forward-only, no retroactive backfill per this milestone's own charter)`;
    passes.push(`clause8-task-canonical-lifecycle-record: N/A — ${reason} ${srcLabel}`);
    dispositionedClauses.add("task-canonical-lifecycle-record");
  } else {

  const proposalSection = extractSection(taskText, "Proposal");
  const planSection = extractSection(taskText, "Plan");

  // Placeholder detection mirrors Clause 0's own placeholderRe intent, but applied to a whole
  // section body rather than a single bullet line: a proposal is a placeholder if, after stripping
  // whitespace, it is empty OR consists solely of a single short boilerplate token (TBD/TODO/N/A/
  // xxx/...), OR its real (non-blank) content is under a minimal length threshold that no genuine
  // approach description could plausibly satisfy.
  const proposalPlaceholderRe = /^\s*(TBD|TODO|N\/A|xxx|\.\.\.)?\s*$/i;
  const proposalBodyTrimmed = proposalSection === null ? "" : proposalSection.trim();
  const proposalIsPlaceholder = proposalSection === null
    || proposalPlaceholderRe.test(proposalBodyTrimmed)
    || proposalBodyTrimmed.length < 40;

  const clause8Fail = [];
  if (proposalSection === null) {
    clause8Fail.push("no '## Proposal' section found in the task (item 6a requires an embedded proposal)");
  } else if (proposalIsPlaceholder) {
    clause8Fail.push("'## Proposal' section is empty/placeholder-only (needs real approach text, not a stub)");
  }

  if (planSection === null) {
    clause8Fail.push("no '## Plan' section found in the task (item 6b requires either N/A-with-reasoning or a resolving docs/plans/*.md reference)");
  } else {
    const planBodyTrimmed = planSection.trim();
    const naRe = /^\s*N\/A\s*[—\-:]\s*\S+/i;
    const planPathMatches = [...planBodyTrimmed.matchAll(/docs\/plans\/[A-Za-z0-9._\/-]*\.md/g)].map((m) => m[0]);

    if (planPathMatches.length > 0) {
      // A docs/plans/*.md path is referenced — every referenced path must resolve on disk
      // (relative to repo root, mirroring how the task-file lookup above resolves relative paths).
      const repoRootCandidates = [
        process.cwd(),
        path.join(__dirname, "..", "..", ".."),
      ];
      const unresolvedPaths = planPathMatches.filter((p) =>
        !repoRootCandidates.some((root) => fs.existsSync(path.join(root, p)))
      );
      if (unresolvedPaths.length > 0) {
        clause8Fail.push(`'## Plan' references docs/plans/*.md path(s) that do NOT resolve on disk: ${unresolvedPaths.join(", ")}`);
      }
    } else if (naRe.test(planBodyTrimmed)) {
      // N/A with reasoning — compliant, no further check.
    } else {
      clause8Fail.push("'## Plan' section neither states 'N/A — <reason>' nor references a docs/plans/*.md path (item 6b requires one or the other, not silent absence-of-either-form content)");
    }
  }

  if (clause8Fail.length === 0) {
    passes.push(`clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' (${proposalBodyTrimmed.length} chars) and a well-formed '## Plan' ${srcLabel}`);
    dispositionedClauses.add("task-canonical-lifecycle-record");
  } else {
    for (const m of clause8Fail) failures.push(`clause8-task-canonical-lifecycle-record: ${m} ${srcLabel}`);
    dispositionedClauses.add("task-canonical-lifecycle-record");
  }
  }
}

// --- Clause 9: SPLIT-OR-COMMIT — no partial/pending outcome; `needs-human` only for factors
// OUTSIDE project control (DIR-026). A milestone's ABSORB outcome must be exactly one of:
//   (i) fully done (every AC/DoD green — enforced by clauses 0-8; a "partial" ABSORB with an
//       unchecked AC box is already HARD-blocked by clause 0's unchecked-box sub-check), OR
//   (ii) the terminal `needs-human` outcome with a reason naming a factor OUTSIDE project control.
// This clause validates the (ii) path: an IN-PROJECT reason (architecture mismatch, algorithm
// complexity, change volume, refactor scope, "too hard") is NOT a valid `needs-human` reason — such
// work MUST be split-smaller-and-completed, so an in-project `needs-human` is itself a DoD violation.
// When no `needs-human` outcome is declared, this clause is N/A (the done path is clauses 0-8). ---
{
  if (!needsHuman.declared) {
    nops.push("clause9-split-or-commit: no `needs-human` outcome declared — N/A (the done path is governed by clauses 0-8; a partial/unchecked-AC ABSORB is HARD-blocked by clause 0)");
    dispositionedClauses.add("split-or-commit");
  } else {
    const reason = needsHuman.reason;
    const inProjectRe = /\b(architecture|architectural|algorithm|too\s+complex|complexity|change\s+volume|too\s+(many|much|big|hard)|refactor(ing)?|mismatch(ed)?|difficult|"?this\s+is\s+hard"?)\b/i;
    const externalRe = /\b(external|upstream|third[-\s]?party|credential|token|dataset|data\s+source|service\s+(is\s+)?(down|unavailable|outage)|api\b|network|rate[-\s]?limit|not\s+yet\s+(released|available|published)|awaiting\s+.*(release|access|approval)|blocked\s+by\s+.*(service|api|resource|credential|dataset|upstream|vendor))\b/i;
    if (!reason || reason.replace(/[—:\-\s]/g, "").length < 8) {
      failures.push("clause9-split-or-commit: `needs-human` declared but no specific external blocker named — a bare/empty reason is not sufficient; name the OUTSIDE-project factor (DIR-026)");
      dispositionedClauses.add("split-or-commit");
    } else if (inProjectRe.test(reason) && !externalRe.test(reason)) {
      failures.push(`clause9-split-or-commit: \`needs-human\` reason is an IN-PROJECT factor ("${reason}") — NOT a valid failure reason. In-project difficulty (architecture/algorithm/change-volume/refactor/"too hard") MUST be split-smaller-and-completed, not marked needs-human (DIR-026)`);
      dispositionedClauses.add("split-or-commit");
    } else if (externalRe.test(reason)) {
      passes.push(`clause9-split-or-commit: \`needs-human\` with a genuine OUTSIDE-project blocker ("${reason}") — a legitimate terminal outcome`);
      dispositionedClauses.add("split-or-commit");
    } else {
      failures.push(`clause9-split-or-commit: \`needs-human\` reason ("${reason}") does not name a recognizable OUTSIDE-project blocker (external service/resource/credential/dataset/upstream/API/network). If genuinely external, state it explicitly; if in-project, split-and-complete instead (DIR-026)`);
      dispositionedClauses.add("split-or-commit");
    }
  }
}

// --- Clause 10: Tree-hygiene gate (DIR-031/DIR-034) — reuse tree-hygiene-check.sh directly ---
// DIR-034 finding: DIR-031's tree-hygiene-check.sh was runnable and wired into OUTER-LOOP.md as an
// ABSORB PROSE close-out only — this mechanical gate did NOT invoke it (grep=0), so an ABSORB that
// simply forgot the prose step passed the mechanical gate silently. Mechanize it here: runs
// UNCONDITIONALLY every check (mirrors clauses 3/4's shape — always dispositioned, never
// conditionally-skippable), shelling out to the EXISTING script (reused, never reimplemented) against
// the real repo tree. Exit 0 = clean (PASS); exit 1 = scratch found (FAIL); any other exit is a usage/
// environment error surfaced as DodCheckEnvError (fail-loud, not silently ignored).
{
  const scriptPath = path.join(__dirname, "tree-hygiene-check.sh");
  if (!fs.existsSync(scriptPath)) {
    throw new DodCheckEnvError(`ERROR: sibling script not found: ${scriptPath}`);
  }
  try {
    const out = execFileSync(scriptPath, [], { encoding: "utf8" });
    passes.push(`clause10-tree-hygiene: PASS — ${out.trim().split("\n")[0]}`);
    dispositionedClauses.add("tree-hygiene");
  } catch (e) {
    const out = (e.stdout || "").toString().trim();
    if (e.status === 1) {
      failures.push(`clause10-tree-hygiene: FAIL — ${out.split("\n")[0] || "(no output)"}`);
      dispositionedClauses.add("tree-hygiene");
    } else {
      throw new DodCheckEnvError(`ERROR: tree-hygiene-check.sh usage/environment error (exit ${e.status}): ${(e.stderr || "").toString().trim()}`);
    }
  }
}

// --- Clause 11: Worktree/branch-hygiene gate (DIR-033/DIR-034) — reuse worktree-branch-hygiene-
// check.sh directly ---
// Same mechanization rationale as clause 10, for DIR-033's check: runs UNCONDITIONALLY against the
// real repo state (registered branches/worktrees), reusing the existing script verbatim.
{
  const scriptPath = path.join(__dirname, "worktree-branch-hygiene-check.sh");
  if (!fs.existsSync(scriptPath)) {
    throw new DodCheckEnvError(`ERROR: sibling script not found: ${scriptPath}`);
  }
  try {
    const out = execFileSync(scriptPath, [], { encoding: "utf8" });
    passes.push(`clause11-worktree-branch-hygiene: PASS — ${out.trim().split("\n")[0]}`);
    dispositionedClauses.add("worktree-branch-hygiene");
  } catch (e) {
    const out = (e.stdout || "").toString().trim();
    if (e.status === 1) {
      failures.push(`clause11-worktree-branch-hygiene: FAIL — ${out.split("\n")[0] || "(no output)"}`);
      dispositionedClauses.add("worktree-branch-hygiene");
    } else {
      throw new DodCheckEnvError(`ERROR: worktree-branch-hygiene-check.sh usage/environment error (exit ${e.status}): ${(e.stderr || "").toString().trim()}`);
    }
  }
}

// --- Clause 12: Audit-independence gate (DIR-032/DIR-034) — reuse audit-independence-check.mjs
// directly, via its CLI (audit-independence-check.sh) ---
// DIR-034 finding: audit-independence-check.mjs/`audit-independence` named engine gate existed and
// was engine-registered (DIR-032/M44), but this mechanical DoD enforcer never invoked it (grep=0) —
// only OUTER-LOOP.md prose named it as part of the ABSORB sequence. Mechanize it here too.
//
// Trigger + inputs: this clause is conditionally dispositioned (like clauses 1/2/6/7) because it
// needs the real audit artifact PATH + orchestrator id to run against — those are milestone-specific
// and not knowable from a bare charter/absorb-entry pair without a naming convention. Convention:
// the ABSORB-entry text embeds a fenced `## Audit-independence check` section with three lines:
//   Artifact: <path to milestones/M<NN>/audits/*.md, repo-root-relative>
//   Orchestrator id: <the orchestrating session/agent id>
//   Dispatch record: <path to a dispatch-record file, or "N/A" to invoke --allow-uncorroborated>
// If that section is ABSENT, this clause N/A-passes with an explicit disposition (documented no-op,
// same shape as clauses 1/2's "no verdict but no-op stated" path) — it does NOT silently skip; the
// no-op is itself a recorded, refutable disposition the audit can catch if untrue for a real
// milestone that actually ran an adversarial audit. If the section IS present, the clause shells out
// to `audit-independence-check.sh` for real and requires exit 0.
{
  const auditSectionMatch = absorbFileText.match(/## Audit-independence check\n([\s\S]*?)(\n##|\n?$)/i);
  if (!auditSectionMatch) {
    passes.push("clause12-audit-independence: N/A — no '## Audit-independence check' section in the ABSORB-entry text (documented no-op; a milestone that actually ran an adversarial audit must include this section, or the acceptance audit should refute this no-op)");
    dispositionedClauses.add("audit-independence");
  } else {
    const sectionText = auditSectionMatch[1];
    const artifactMatch = sectionText.match(/Artifact:\s*(\S.*)$/im);
    const orchIdMatch = sectionText.match(/Orchestrator id:\s*(\S.*)$/im);
    const recordMatch = sectionText.match(/Dispatch record:\s*(\S.*)$/im);

    if (!artifactMatch) {
      throw new DodCheckEnvError(`ERROR: '## Audit-independence check' section present but missing required "Artifact: <path>" line`);
    }
    const artifactPath = artifactMatch[1].trim();
    const orchestratorId = orchIdMatch ? orchIdMatch[1].trim() : "";
    const recordValue = recordMatch ? recordMatch[1].trim() : "";

    const scriptPath = path.join(__dirname, "audit-independence-check.sh");
    if (!fs.existsSync(scriptPath)) {
      throw new DodCheckEnvError(`ERROR: sibling script not found: ${scriptPath}`);
    }
    const resolvedArtifact = path.isAbsolute(artifactPath) ? artifactPath : path.join(process.cwd(), artifactPath);
    if (!fs.existsSync(resolvedArtifact)) {
      failures.push(`clause12-audit-independence: FAIL — declared audit artifact does not exist on disk: ${artifactPath}`);
      dispositionedClauses.add("audit-independence");
    } else {
      const args = [];
      if (orchestratorId) args.push("--orchestrator-id", orchestratorId);
      if (recordValue && recordValue.toUpperCase() !== "N/A") {
        args.push("--dispatch-record", path.isAbsolute(recordValue) ? recordValue : path.join(process.cwd(), recordValue));
      } else if (recordValue && recordValue.toUpperCase() === "N/A") {
        args.push("--allow-uncorroborated");
      }
      args.push(resolvedArtifact);
      try {
        const out = execFileSync(scriptPath, args, { encoding: "utf8" });
        passes.push(`clause12-audit-independence: PASS — ${out.trim().split("\n").filter((l) => l.startsWith("PASS")).pop() || out.trim().split("\n").pop()}`);
        dispositionedClauses.add("audit-independence");
      } catch (e) {
        const out = (e.stdout || "").toString().trim();
        if (e.status === 1) {
          failures.push(`clause12-audit-independence: FAIL — ${out.split("\n").filter((l) => l.startsWith("FAIL")).pop() || out.split("\n").pop() || "(no output)"}`);
          dispositionedClauses.add("audit-independence");
        } else {
          throw new DodCheckEnvError(`ERROR: audit-independence-check.sh usage/environment error (exit ${e.status}): ${(e.stderr || "").toString().trim()}`);
        }
      }
    }
  }
}

  return { passes, failures, nops, dispositionedClauses, needsHuman };
}

// ── Thin CLI wrapper ─────────────────────────────────────────────────────────────────────────────
// Parses argv, validates + reads the files (the exit-2 usage/file-not-found path, unchanged), calls
// the pure runDodCheck(), and prints the SAME stdout lines in the SAME order/format the former
// top-level body did, then exits 1 if any clause failed else 0. Environment errors surfaced by
// runDodCheck (DodCheckEnvError) reproduce the legacy `console.error(msg); process.exit(2)` behavior.
function usage() {
  console.error("usage: node it0-dod-check.mjs <milestone-id> <charter-file> <absorb-entry-file>");
  process.exit(2);
}

function main(argv) {
  const [milestoneId, charterFile, absorbEntryFile] = argv.slice(2);
  if (!milestoneId || !charterFile || !absorbEntryFile) usage();

  for (const [label, p] of [["charter-file", charterFile], ["absorb-entry-file", absorbEntryFile]]) {
    if (!fs.existsSync(p)) {
      console.error(`ERROR: ${label} not found: ${p}`);
      process.exit(2);
    }
  }

  const charterFileText = fs.readFileSync(charterFile, "utf8");
  const absorbFileText = fs.readFileSync(absorbEntryFile, "utf8");

  let result;
  try {
    result = runDodCheck({ milestoneId, charterFile, charterFileText, absorbFileText });
  } catch (e) {
    if (e instanceof DodCheckEnvError) {
      console.error(e.message);
      process.exit(e.exitCode);
    }
    throw e;
  }
  const { passes, failures, nops } = result;

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
}

// Run the CLI only when invoked directly (node it0-dod-check.mjs ...), NOT when imported by a test.
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) main(process.argv);
