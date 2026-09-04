// @test-group engine
// portability-strategy-check.test.mjs — AC1/AC2/AC3/AC4/AC5 of
// tasks/gap-fast-mode-cross-project-portability-strategic-question.
//
// The strategic question "can the fast-mode two-layer loop truly be ported
// cross-project, or is it overfit to quay" was being answered ad-hoc via
// meta-cc/archguard cold-start with no written reference. This check makes
// the pinning mechanically verifiable:
//   AC1 the strategic doc exists, states the question + why it matters,
//   AC3 the portability/overfit criteria each carry >= 2 decidable shapes,
//   AC2 the doc names meta-cc/archguard cold-start as the evidence vehicle,
//   AC4 the doc records >= 1 real cold-start result (- [x] entry, DIR-026),
//   AC5 the doc cross-references the SUPERSEDED roadmap.
// The negative control proves an empty container is caught: drop every
// `- [x]` evidence entry and the evidence-count audit goes RED.
//
// Run: scripts/test.sh plugin/test/portability-strategy-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const DOC = path.join(repoRoot, "docs/proposals/fast-mode-cross-project-portability.md");
const TASK = path.join(repoRoot, "tasks/gap-fast-mode-cross-project-portability-strategic-question.md");

// Returns { ok, issues[] }.
export function auditPortabilityDoc(doc) {
  const issues = [];

  // AC1: question pinned (states both the question and the criteria framing).
  if (!/(跨项目迁移|portable cross-project)/.test(doc))
    issues.push("doc does not state the cross-project portability question");
  if (!/过拟合/.test(doc))
    issues.push("doc does not name the overfit alternative");
  if (!/为什么重要|why it matters|重要/.test(doc))
    issues.push("doc does not say why the question matters");

  // AC3: >= 2 decidable shapes per side.
  const pShapes = (doc.match(/\*\*P\d\b/g) || []).length;
  const oShapes = (doc.match(/\*\*O\d\b/g) || []).length;
  if (pShapes < 2) issues.push(`portability shapes < 2 (got ${pShapes})`);
  if (oShapes < 2) issues.push(`overfit shapes < 2 (got ${oShapes})`);

  // AC2: meta-cc/archguard cold-start named as the evidence vehicle.
  if (!/meta-cc/.test(doc)) issues.push("doc does not name meta-cc");
  if (!/archguard/.test(doc)) issues.push("doc does not name archguard");
  if (!/冷启动|cold-start/.test(doc)) issues.push("doc does not name cold-start as the vehicle");

  // AC4: >= 1 recorded evidence entry (real cold-start result, DIR-026).
  const evidenceEntries = (doc.match(/^- \[x\] /gm) || []).length;
  if (evidenceEntries < 1) issues.push(`no recorded evidence entry (- [x]), got ${evidenceEntries}`);

  // AC5: cross-reference to the SUPERSEDED roadmap.
  if (!/quay-harness-crystallization-roadmap/.test(doc))
    issues.push("doc does not cross-reference the SUPERSEDED roadmap");
  if (!/SUPERSEDED|superseded/.test(doc))
    issues.push("doc does not mark the roadmap reference as superseded");

  return { ok: issues.length === 0, issues, evidenceEntries, pShapes, oShapes };
}

test("AC1/AC3/AC5: strategic doc pins the question, carries >=2 shapes per side, and cross-references the SUPERSEDED roadmap", () => {
  assert.ok(fs.existsSync(DOC), `strategic doc missing: ${DOC}`);
  const doc = fs.readFileSync(DOC, "utf8");
  const { ok, issues, pShapes, oShapes } = auditPortabilityDoc(doc);
  assert.equal(ok, true, issues.join("\n"));
  assert.ok(pShapes >= 2, `need >= 2 portability shapes, got ${pShapes}`);
  assert.ok(oShapes >= 2, `need >= 2 overfit shapes, got ${oShapes}`);
});

test("AC2/AC4: doc names meta-cc/archguard as the vehicle and records >=1 real cold-start result", () => {
  const doc = fs.readFileSync(DOC, "utf8");
  const { ok, issues, evidenceEntries } = auditPortabilityDoc(doc);
  assert.equal(ok, true, issues.join("\n"));
  assert.ok(evidenceEntries >= 1, `need >= 1 recorded evidence entry, got ${evidenceEntries}`);
  // Contract measure: portability_evidence_count = grep -c '^- \[' <doc>
  const grepLike = (doc.match(/^- \[/gm) || []).length;
  assert.ok(grepLike >= 1, `grep -c '^- \\[' must be >= 1, got ${grepLike}`);
});

test("AC4 negative control: stripping all evidence entries makes the evidence audit go RED (empty container is caught)", () => {
  const doc = fs.readFileSync(DOC, "utf8");
  const stripped = doc.replace(/^- \[x\] /gm, "- ").replace(/^- \[ \] /gm, "- ");
  const { ok, issues, evidenceEntries } = auditPortabilityDoc(stripped);
  assert.equal(ok, false, "removing evidence entries must go RED");
  assert.ok(
    issues.some((i) => i.startsWith("no recorded evidence entry")),
    "must report the missing evidence entry"
  );
  assert.equal(evidenceEntries, 0);
});

test("task AC boxes (this task's own file) reference the strategic doc path for invoke evidence", () => {
  assert.ok(fs.existsSync(TASK), `task file missing: ${TASK}`);
  const body = fs.readFileSync(TASK, "utf8");
  assert.ok(
    /fast-mode-cross-project-portability\.md/.test(body),
    "task body must cite the strategic doc path (invoke evidence authorization)"
  );
});
