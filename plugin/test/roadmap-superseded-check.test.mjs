// @test-group engine
// roadmap-superseded-check.test.mjs — AC1/AC2/AC4/AC5 of
// tasks/gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode.
//
// docs/proposals/quay-harness-crystallization-roadmap.md (07-31) was silently
// stale: it was built entirely on the ADR-022 (08-03) retired classic milestone
// pipeline (prepare-milestone.js / execute-milestone.js / ProposalReview /
// PlanCheck / kernel-policy separation). "Silently stale is more dangerous than
// absent" — this check mechanically enforces that the doc stays annotated:
//   AC1 the SUPERSEDED banner stays (names ADR-022 + date + fast-mode pointer),
//   AC3 the still-valid cross-project strategic question is cross-referenced,
//   AC2/AC4 every reference to a deleted classic-pipeline mechanism sits in an
//   annotated region (banner / mechanism-status table / [retired] blockquote).
// The negative control proves silent rot is caught: strip the banner and the
// audit goes RED.
//
// Run: scripts/test.sh plugin/test/roadmap-superseded-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const ROADMAP = path.join(repoRoot, "docs/proposals/quay-harness-crystallization-roadmap.md");

// Deleted-under-ADR-022 classic-pipeline mechanism names that must never appear
// unannotated in the roadmap. (The contract's `stale_refs` band is ≥1 — i.e.
// references may remain, but only while annotated retired/superseded.)
const DELETED_MECH = new RegExp(
  "prepare-milestone|execute-milestone|ProposalReview|PlanCheck|" +
    "proposal-convergence|milestone-preparation-check|OUTER-LOOP|" +
    "milestone-worktree|StageReceiptEnvelope",
  "g"
);
const ANNOTATION = /SUPERSEDED|RETIRED|retired|superseded|已删除|退役|作废/;

// Returns { ok, issues[] }. An "annotated region" is either the pre-first-`## `
// header block (which carries the SUPERSEDED banner) or a `## ` section whose
// leading `>` blockquote carries an annotation marker. A line that itself carries
// an inline annotation marker also passes. Any deleted-mechanism reference in an
// unannotated region is reported.
export function auditRoadmap(doc) {
  const lines = doc.split(/\r?\n/);
  const issues = [];

  if (!/SUPERSEDED/.test(doc)) issues.push("no SUPERSEDED marker in doc");
  if (!/ADR-022/.test(doc)) issues.push("no ADR-022 reference in doc");
  if (!/2026-08-03/.test(doc)) issues.push("no ADR-022 date (2026-08-03) in doc");
  if (!/gap-fast-mode-cross-project-portability-strategic-question/.test(doc)) {
    issues.push("no cross-reference to gap-fast-mode-cross-project-portability-strategic-question");
  }

  const sections = [];
  let current = null;
  const headerBlock = { start: 0, end: 0, annotated: false };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## /.test(line)) {
      if (current) current.end = i;
      current = { start: i, end: lines.length, annotated: false };
      sections.push(current);
    } else if (current) {
      if (/^> /.test(line) && ANNOTATION.test(line)) current.annotated = true;
    } else {
      headerBlock.end = i;
      if (/^> /.test(line) && ANNOTATION.test(line)) headerBlock.annotated = true;
    }
  }
  if (current) current.end = lines.length;

  const regionFor = (idx) => {
    for (const s of sections) if (idx >= s.start && idx < s.end) return s;
    return headerBlock;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    DELETED_MECH.lastIndex = 0;
    if (!DELETED_MECH.test(line)) continue;
    if (ANNOTATION.test(line)) continue; // inline marker on the same line
    const region = regionFor(i);
    if (!region.annotated) {
      issues.push(`unannotated deleted-mechanism reference at line ${i + 1}: ${line.trim()}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

test("AC1/AC3: roadmap carries SUPERSEDED banner (ADR-022 + date) and the cross-project reference", () => {
  const doc = fs.readFileSync(ROADMAP, "utf8");
  const { ok, issues } = auditRoadmap(doc);
  assert.equal(ok, true, issues.join("\n"));
});

test("AC4 negative control: stripping the annotation blockquotes makes the audit fail (silent rot is caught)", () => {
  const doc = fs.readFileSync(ROADMAP, "utf8");
  // Remove every `>` annotation blockquote (banner + [retired] section notes).
  // The doc still literally contains the word "SUPERSEDED" in its Status line,
  // so the banner check alone cannot save it — the deleted-mechanism references
  // become unannotated and the audit must go RED.
  const stripped = doc
    .split(/\r?\n/)
    .filter((l) => !/^> /.test(l))
    .join("\n");
  const { ok, issues } = auditRoadmap(stripped);
  assert.equal(ok, false, "removing annotation blockquotes must go RED");
  assert.ok(
    issues.some((i) => i.startsWith("unannotated deleted-mechanism reference")),
    "must report unannotated deleted-mechanism references"
  );
});
