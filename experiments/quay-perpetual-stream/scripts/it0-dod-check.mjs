#!/usr/bin/env node
// it0-dod-check.mjs — DoD meta-enforcer, DIR-017 Step 1 (M25-dod-meta-enforcer).
//
// Given a milestone id, its charter file, and its dashboard/ABSORB-entry text (a real dashboard.md
// excerpt, or a path to a fixture file standing in for that text), runs all 4 DoD clauses defined
// in `inherited-core.md`'s "Definition of Done" section, plus the no-self-exemption meta-check.
// Mirrors the established `it0-*-check.mjs` shape (see it0-backlog-projection-check.mjs,
// it0-dir-projection-check.mjs as direct precedent).
//
// Usage:
//   node it0-dod-check.mjs <milestone-id> <charter-file> <absorb-entry-file>
//
// The 4 clauses (see inherited-core.md's "Definition of Done" section for the full spec each
// summarizes):
//   1. Adversarial-audit gate (documentation-discipline check only — see below).
//   2. V_meta consolidation-lag gate (documentation-discipline check only — see below).
//   3. Line-budget gate — shells out to it0-ceiling-line-budget-check.sh <charter-file> directly;
//      reused, not re-derived.
//   4. Design-only-milestone impl-row gate — shells out to it0-impl-row-check.sh <milestone-id>
//      <backlog-file> directly when a backlog.md is discoverable; if no backlog.md is found (e.g.
//      a synthetic fixture milestone id with no real backlog row), this clause is evaluated instead
//      by inspecting the charter/absorb-entry text for design-only markers directly (mirrors
//      it0-impl-row-check.sh's own design-only detection heuristic) — this fallback exists ONLY so
//      the check remains runnable against synthetic fixtures that intentionally have no backlog.md
//      row; a REAL milestone always goes through the backlog.md path.
//
// Clauses 1 and 2 have no existing standalone it0-*.sh script (both are narrative HARD BLOCKs in
// OUTER-LOOP.md step 6, evaluated by the ABSORB author's own judgment + v-meta-ledger.md row
// inspection). For these two, this script checks the DOCUMENTATION DISCIPLINE, not the underlying
// judgment call: does the absorb-entry text contain an explicit disposition statement for each gate
// (a stated verdict -- "N/A/no-op", "PASS", "REFUTED", "clear", "CONCERNS", "NO REFUTATION FOUND",
// etc.)? A missing disposition statement for either gate is a DoD FAIL (mirrors the no-self-
// exemption clause: an absent disposition is indistinguishable from an undeclared silent skip).
// This script does NOT re-run the adversarial-audit subagent or re-derive V_meta-ledger math.
//
// No-self-exemption meta-check: scans the charter's "Explicitly OUT of scope" section (and the
// absorb-entry text) for language that narrows/exempts a DoD clause (heuristic string/pattern
// match) with NO corresponding waiver line (the `WAIVER: <id> | <clause> | <reason> | <date>` shape
// defined in inherited-core.md's DoD section) present in the absorb-entry text. If exemption
// language is found with no waiver line, FAIL.
//
// Exit codes:
//   0 = all 4 gate clauses PASS or legitimately N/A (with disposition present), AND no undeclared
//       self-exemption found.
//   1 = at least one gate clause FAILs, OR a self-exemption is found with no waiver line.
//   2 = usage/environment error (missing args, files not found, node/script unavailable).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.error("usage: node it0-dod-check.mjs <milestone-id> <charter-file> <absorb-entry-file>");
  process.exit(2);
}

const args = process.argv.slice(2);
const [milestoneId, charterFile, absorbEntryFile] = args;

if (!milestoneId || !charterFile || !absorbEntryFile) usage();

for (const [label, p] of [["charter-file", charterFile], ["absorb-entry-file", absorbEntryFile]]) {
  if (!fs.existsSync(p)) {
    console.error(`ERROR: ${label} not found: ${p}`);
    process.exit(2);
  }
}

const charterText = fs.readFileSync(charterFile, "utf8");
const absorbText = fs.readFileSync(absorbEntryFile, "utf8");
const combinedText = `${charterText}\n${absorbText}`;

const results = []; // { clause, status: "PASS"|"FAIL"|"N/A", detail }

function record(clause, status, detail) {
  results.push({ clause, status, detail });
}

// --- Clause 1: adversarial-audit gate — documentation-discipline check ---
{
  const dispositionPattern =
    /adversarial-audit[^\n.]{0,200}?(documented no-op|N\/A|no-op|PASS|REFUTED|CONCERNS|NO REFUTATION FOUND|clear|does not apply|neither condition applied)/i;
  const altOrderPattern =
    /(documented no-op|N\/A|no-op|PASS|REFUTED|CONCERNS|NO REFUTATION FOUND|clear|does not apply|neither condition applied)[^\n.]{0,200}?adversarial-audit/i;
  if (dispositionPattern.test(absorbText) || altOrderPattern.test(absorbText)) {
    record("Clause 1 (adversarial-audit gate)", "PASS", "explicit disposition statement found in absorb-entry text");
  } else {
    record("Clause 1 (adversarial-audit gate)", "FAIL", "no explicit disposition statement (verdict) found for the adversarial-audit gate in absorb-entry text — a missing disposition is indistinguishable from an undeclared silent skip");
  }
}

// --- Clause 2: V_meta consolidation-lag gate — documentation-discipline check ---
{
  const dispositionPattern =
    /V_meta[^\n.]{0,200}?(consolidat\w*[^\n.]{0,120}?)?(clear|PASS|N\/A|no-op|consolidated|carry-forward|dated)/i;
  const altOrderPattern =
    /(clear|PASS|N\/A|no-op|consolidated|carry-forward|dated)[^\n.]{0,200}?V_meta/i;
  if (dispositionPattern.test(absorbText) || altOrderPattern.test(absorbText)) {
    record("Clause 2 (V_meta consolidation-lag gate)", "PASS", "explicit disposition statement found in absorb-entry text");
  } else {
    record("Clause 2 (V_meta consolidation-lag gate)", "FAIL", "no explicit disposition statement found for the V_meta consolidation-lag gate in absorb-entry text — a missing disposition is indistinguishable from an undeclared silent skip");
  }
}

// --- Clause 3: line-budget gate — shell out to the existing script directly ---
{
  const scriptPath = path.join(SCRIPT_DIR, "it0-ceiling-line-budget-check.sh");
  if (!fs.existsSync(scriptPath)) {
    record("Clause 3 (line-budget gate)", "FAIL", `ERROR: ${scriptPath} not found (usage/environment error)`);
  } else {
    try {
      const out = execFileSync(scriptPath, [charterFile], { encoding: "utf8" });
      record("Clause 3 (line-budget gate)", "PASS", out.trim());
    } catch (e) {
      const out = (e.stdout || "") + (e.stderr || "");
      if (e.status === 1) {
        record("Clause 3 (line-budget gate)", "FAIL", out.trim() || "it0-ceiling-line-budget-check.sh FAILed (exit 1)");
      } else {
        record("Clause 3 (line-budget gate)", "FAIL", `ERROR: it0-ceiling-line-budget-check.sh usage/environment error (exit ${e.status}): ${out.trim()}`);
      }
    }
  }
}

// --- Clause 4: design-only-milestone impl-row gate ---
{
  const scriptPath = path.join(SCRIPT_DIR, "it0-impl-row-check.sh");
  // Prefer a real backlog.md if discoverable relative to CWD (the real-milestone path); fall back
  // to text-based design-only detection directly against the charter/absorb-entry text for
  // synthetic fixtures with no backlog.md row (fixtures intentionally have none — see header note).
  //
  // Real backlog.md rows are keyed by an `exp5-M-<UPPER-SLUG>` task id (the task-store id), NOT the
  // human-facing milestone id (e.g. `M25-dod-meta-enforcer`) — the link between the two is the
  // row's own `milestone:<milestone-id>` label token (see backlog.md's last column). Resolve the
  // ACTUAL backlog row id via that label token before shelling out to it0-impl-row-check.sh, which
  // itself expects the row's own first-column id, not the milestone id — mirrors
  // it0-dir-projection-check.mjs's own dual-id join precedent (bare id vs exp5-prefixed id).
  const backlogCandidates = ["backlog.md", path.join(SCRIPT_DIR, "..", "backlog.md")];
  const backlogFile = backlogCandidates.find((p) => fs.existsSync(p));
  let resolvedBacklogId = null;
  if (backlogFile) {
    const backlogText = fs.readFileSync(backlogFile, "utf8");
    if (backlogText.includes(`| ${milestoneId} |`)) {
      resolvedBacklogId = milestoneId;
    } else {
      const labelMatch = backlogText.match(new RegExp(`^\\|\\s*([^\\|]+?)\\s*\\|.*milestone:${milestoneId}\\b`, "m"));
      if (labelMatch) resolvedBacklogId = labelMatch[1].trim();
    }
  }

  if (resolvedBacklogId && fs.existsSync(scriptPath)) {
    try {
      const out = execFileSync(scriptPath, [resolvedBacklogId, backlogFile], { encoding: "utf8" });
      record("Clause 4 (design-only impl-row gate)", "PASS", `resolved backlog row id "${resolvedBacklogId}" via milestone:${milestoneId} label — ${out.trim()}`);
    } catch (e) {
      const out = (e.stdout || "") + (e.stderr || "");
      if (e.status === 1) {
        record("Clause 4 (design-only impl-row gate)", "FAIL", out.trim() || "it0-impl-row-check.sh FAILed (exit 1)");
      } else {
        record("Clause 4 (design-only impl-row gate)", "FAIL", `ERROR: it0-impl-row-check.sh usage/environment error (exit ${e.status}): ${out.trim()}`);
      }
    }
  } else {
    // Fallback: text-based design-only detection (fixture path — no real backlog.md row exists).
    // Mirrors it0-impl-row-check.sh's own design-only markers.
    const isDesignOnly = /design delivered|design[- ]doc only|design only|design \(doc only\)|Done-when clauses a future implementing milestone/i.test(combinedText);
    if (!isDesignOnly) {
      record("Clause 4 (design-only impl-row gate)", "PASS", "not design-only per charter/absorb-entry text (no backlog.md row found for this milestone id — fixture path; text-based fallback used) — impl-row gate does not apply");
    } else {
      const implRowId = `${milestoneId}-IMPL`;
      const hasImplRow = combinedText.includes(implRowId);
      if (hasImplRow) {
        record("Clause 4 (design-only impl-row gate)", "PASS", `design-only per charter/absorb-entry text (fixture path), but a '${implRowId}' reference was found in the combined text`);
      } else {
        record("Clause 4 (design-only impl-row gate)", "FAIL", `design-only per charter/absorb-entry text (fixture path: contains a design-only marker), but no '${implRowId}' row/reference found anywhere in the charter or absorb-entry text`);
      }
    }
  }
}

// --- No-self-exemption meta-check ---
{
  // Extract the charter's "Explicitly OUT of scope" section (if present) for the exemption scan.
  const outOfScopeMatch = charterText.match(/#+\s*Explicitly OUT of scope[\s\S]*?(?=\n#+\s|$)/i);
  const outOfScopeText = outOfScopeMatch ? outOfScopeMatch[0] : "";

  const gateNames = [
    { name: "adversarial-audit", pattern: /adversarial-audit/i },
    { name: "V_meta consolidation-lag", pattern: /V_meta|consolidation-lag/i },
    { name: "line-budget", pattern: /line-budget/i },
    { name: "impl-row", pattern: /impl-row|-IMPL/i },
  ];
  const exemptionLanguagePattern = /(exempt|skip the gate|does not apply|not required|opt(s|ed)? out)/i;

  const waiverLinePattern = new RegExp(`WAIVER:\\s*${milestoneId}\\s*\\|`, "i");
  const hasAnyWaiverLine = waiverLinePattern.test(absorbText) || waiverLinePattern.test(combinedText);

  const undeclaredExemptions = [];
  for (const gate of gateNames) {
    // Search for exemption language within ~150 chars of the gate name mention, scoped to the
    // Explicitly-OUT-of-scope section (the charter-text-inspectable surface per inherited-core.md's
    // no-self-exemption meta-clause).
    if (!outOfScopeText) continue;
    const gateMentions = [...outOfScopeText.matchAll(new RegExp(gate.pattern.source, "gi"))];
    for (const m of gateMentions) {
      const windowStart = Math.max(0, m.index - 150);
      const windowEnd = Math.min(outOfScopeText.length, m.index + 150);
      const window = outOfScopeText.slice(windowStart, windowEnd);
      if (exemptionLanguagePattern.test(window)) {
        // Found exemption-adjacent language for this gate — check for a matching waiver line
        // specifically naming this gate.
        const gateWaiverPattern = new RegExp(`WAIVER:\\s*${milestoneId}\\s*\\|[^\\n]*${gate.name}`, "i");
        const hasGateWaiver = gateWaiverPattern.test(absorbText) || gateWaiverPattern.test(combinedText);
        if (!hasGateWaiver) {
          undeclaredExemptions.push({ gate: gate.name, window: window.replace(/\s+/g, " ").trim() });
        }
      }
    }
  }

  if (undeclaredExemptions.length === 0) {
    record("No-self-exemption meta-check", "PASS", hasAnyWaiverLine ? "no undeclared exemption language found (waiver line(s) present in absorb-entry text)" : "no exemption language found adjacent to any of the 4 gate names in the charter's Explicitly-OUT-of-scope section");
  } else {
    for (const ue of undeclaredExemptions) {
      record("No-self-exemption meta-check", "FAIL", `scope-exemption language found for gate "${ue.gate}" in charter's Explicitly-OUT-of-scope section ("...${ue.window}..."), with NO corresponding WAIVER line for milestone "${milestoneId}" / gate "${ue.gate}" in the absorb-entry text`);
    }
  }
}

// --- Report ---
console.log(`DoD check for milestone ${milestoneId} (charter: ${charterFile}, absorb-entry: ${absorbEntryFile})`);
console.log("");
let anyFail = false;
for (const r of results) {
  if (r.status === "FAIL") anyFail = true;
  console.log(`[${r.status}] ${r.clause}: ${r.detail}`);
}
console.log("");

if (anyFail) {
  console.log(`FAIL: ${results.filter((r) => r.status === "FAIL").length} DoD clause violation(s) found.`);
  process.exit(1);
} else {
  console.log(`PASS: all DoD clauses cleared (PASS or legitimately N/A with disposition present), no undeclared self-exemption found.`);
  process.exit(0);
}
