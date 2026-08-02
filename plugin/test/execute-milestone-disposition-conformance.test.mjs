// @test-group engine
// execute-milestone-disposition-conformance.test.mjs — M180
// gap-absorb-entry-clause-disposition-sequencing (it0-dod-check.ts clause1/clause2/clause7).
//
// PROBLEM this closes: the M180 iteration-0 acceptance audit (milestones/M180/audits/
// iteration-0-acceptance-audit.md) REFUTED AC2 ("a real, unmodified-by-hand absorb-entry file
// actually passes clause1/2/7") because the only verification performed was a one-off manual
// self-test — hand-append the two disposition lines to /tmp/m180-absorb-entry.md, re-run
// it0-dod-check.sh, observe PASS, then EXPLICITLY REVERT the file. That leaves zero durable
// evidence: the next person to look finds the pre-fix file again and no test that would catch a
// regression to the wording.
//
// This test replaces that pattern with a PERMANENT, CI-enforced (scripts/test.sh canonical glob)
// proof that:
//   1. The literal disposition-line phrase TEMPLATES `.claude/workflows/execute-milestone.js` and
//      `plugin/workflows/execute-milestone.js`'s Audit-phase step 2a instruct the agent to append
//      are still present verbatim (a drift guard — if the wording ever changes, this test's first
//      assertion fails BEFORE the templates below can silently go stale).
//   2. Those exact templates, populated with REAL values (a real vmeta-lag-check.ts `checkLedger()`
//      call result — not a fabricated "clear" string — and each of the 3 real audit verdict
//      strings the Audit phase can return), actually satisfy `it0-dod-check.ts`'s real clause1/
//      clause2 regexes — by calling the real exported `runDodCheck()`, never a reimplementation.
//   3. The Build-phase step 1a `surface:` vocabulary it instructs (method-infra/docs/
//      cross-cutting/packaging vs. cli/web-ui/provider-abi/mcp) resolves clause7 exactly the way
//      the M180 charter claims: non-product labels N/A-pass with no coverage/WAIVER text needed;
//      product labels still fail closed without one; no `surface:` token at all still fails
//      closed.
//   4. The pre-fix baseline (no disposition lines at all) still genuinely fails — so this test
//      cannot pass vacuously; it proves the fix is NECESSARY as well as sufficient.
//
// Scope discipline (M180 charter "Out of scope"): does NOT modify or reimplement
// it0-dod-check.ts or vmeta-lag-check.ts — imports and calls their real exported pure functions
// directly. Does NOT substitute for an actual live execute-milestone.js orchestrated dispatch
// (AC2's literal ask) — that requires a real LLM agent turn following the Audit-phase prompt
// end-to-end, which no static test can exercise. What it DOES prove, mechanically and
// permanently: the wiring is correct — IF the agent follows the instructions verbatim, the
// checker WILL pass. That is the part a static regression test can close; the remaining gap is
// purely "did the agent actually follow them on a given real run," which is inherently a live-
// dispatch question, not a code-correctness question.
//
// Run:
//   node --test plugin/test/execute-milestone-disposition-conformance.test.mjs
//   scripts/test.sh plugin/test/execute-milestone-disposition-conformance.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDodCheck } from '../../experiments/quay-perpetual-stream/scripts/it0-dod-check.ts';
import { checkLedger } from '../../experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(__dirname, '..', '..');
const CLAUDE_WORKFLOW = path.join(repoRoot, '.claude', 'workflows', 'execute-milestone.js');
const PLUGIN_WORKFLOW = path.join(repoRoot, 'plugin', 'workflows', 'execute-milestone.js');

const claudeSrc = fs.readFileSync(CLAUDE_WORKFLOW, 'utf8');
const pluginSrc = fs.readFileSync(PLUGIN_WORKFLOW, 'utf8');
const MIRRORS = [
  ['.claude/workflows/execute-milestone.js', claudeSrc],
  ['plugin/workflows/execute-milestone.js', pluginSrc],
];

// ── 1. Drift guard: the literal instructed phrase templates must still be present verbatim ───────
test('Audit-phase step 2a still instructs the exact clause1/clause2 disposition phrase templates (both mirrors)', () => {
  for (const [name, src] of MIRRORS) {
    assert.match(src, /adversarial-audit disposition: <VERDICT>/, `${name}: clause1 phrase template must be present`);
    assert.match(src, /V_meta consolidation-lag: <verbatim/, `${name}: clause2 phrase template must be present`);
    // Sequencing: the append instruction (step 2a) must appear BEFORE the mechanical-gate
    // invocation (step 3) in prompt text order — this is the exact circularity the charter's
    // Finding section identified and fixed; a regression that moves 2a after 3 would silently
    // reintroduce it without touching any regex, so assert it structurally.
    const step2aIdx = src.indexOf('DISPOSITION APPEND');
    const step3Idx = src.indexOf('MECHANICAL GATE');
    assert.ok(step2aIdx > -1 && step3Idx > -1 && step2aIdx < step3Idx,
      `${name}: DISPOSITION APPEND (step 2a) must precede MECHANICAL GATE (step 3) in prompt order`);
  }
});

test('Build-phase step 1a still instructs the exact surface: vocabulary clause7 recognizes (both mirrors)', () => {
  for (const [name, src] of MIRRORS) {
    for (const label of ['method-infra', 'docs', 'cross-cutting', 'packaging', 'cli', 'web-ui', 'provider-abi', 'mcp']) {
      assert.ok(src.includes(label), `${name}: surface vocabulary must mention "${label}"`);
    }
  }
});

// ── Minimal real fixture scaffold (mirrors the shape experiments/quay-perpetual-stream/test/
// it0-dod-check.test.mjs's own buildFixture() uses) — a single combined text passed as BOTH
// charterFileText and absorbFileText, isolated per-section by runDodCheck's own extractSection(). ─
const CHARTER_EXCERPT = `## Charter excerpt

**Milestone id:** MID

### Explicitly OUT of scope
- Ordinary scope note that names/exempts no DoD clause (must NOT trigger clause 5).
`;

const AC_DOD = `## Acceptance Criteria

- The disposition-append mechanism produces text that satisfies the real checker.

## Definition of Done

References the standard DoD (the five clauses in inherited-core.md — adversarial-audit,
V_meta-lag, line-budget, impl-row, no-self-exemption).
`;

function backlogRow(surfaceLabelsCsv) {
  const surfacePart = surfaceLabelsCsv ? `, surface:${surfaceLabelsCsv}` : '';
  return `## Backlog row

| MID | fake conformance-test milestone exercising the real execute-milestone.js templates | DONE | - | gap${surfacePart} |
`;
}

function absorbExcerpt(...lines) {
  return `## ABSORB-entry excerpt

${lines.filter(Boolean).join('\n')}
`;
}

function run({ absorb, surface }) {
  const text = [CHARTER_EXCERPT, absorb, backlogRow(surface), AC_DOD].join('\n') + '\n';
  return runDodCheck({
    milestoneId: 'MID',
    charterFile: THIS_FILE,
    charterFileText: text,
    absorbFileText: text,
  });
}

const hasFail = (r, needle) => r.failures.some((f) => f.includes(needle));
const hasPass = (r, needle) => r.passes.some((p) => p.includes(needle));

// ── 2. Negative control: the ORIGINAL bug is still real without the fix's output ──────────────────
test('control: absorb text with neither disposition line still FAILs clause1 AND clause2 (the original bug, not vacuously fixed)', () => {
  const r = run({ absorb: absorbExcerpt('(no disposition lines written yet — this is the pre-fix baseline the charter describes)'), surface: 'method-infra' });
  assert.ok(hasFail(r, 'clause1-adversarial-audit'), JSON.stringify(r.failures));
  assert.ok(hasFail(r, 'clause2-vmeta-lag'), JSON.stringify(r.failures));
});

// ── 3. clause1: the exact instructed template, for each of the 3 real verdicts the Audit phase
// can return, satisfies the real checker ──────────────────────────────────────────────────────────
for (const verdict of ['NO REFUTATION FOUND', 'CONCERNS', 'REFUTED']) {
  test(`clause1: literal template "adversarial-audit disposition: ${verdict}" (exact Audit-phase wording) satisfies clause1`, () => {
    const line = `adversarial-audit disposition: ${verdict}`;
    const r = run({ absorb: absorbExcerpt(line), surface: 'method-infra' });
    assert.ok(hasPass(r, 'clause1-adversarial-audit'), JSON.stringify(r.failures));
  });
}

// ── 4. clause2: the exact instructed template, populated with a REAL checkLedger() result (never
// a fabricated "clear"), satisfies the real checker — both a PASS-shaped and a FAIL-shaped real
// ledger result (the Audit-phase instruction says "copy the script's actual reason text; do not
// paraphrase or invent a 'clear' result if the script did not say so" — so both must be proven). ──
test('clause2: literal template populated with a REAL checkLedger() PASS result satisfies clause2', () => {
  // Real call: no ledger rows, an explicit milestoneCounter override — mirrors the CLI's own
  // `--counter <N>` flag path with an otherwise-empty ledger. checkLedger() is the SAME function
  // vmeta-lag-check.sh's CLI wraps; not reimplemented here.
  const result = checkLedger('', { milestoneCounter: 5 });
  assert.equal(result.verdict, 'PASS', 'sanity: this synthetic ledger call must itself be PASS');
  const line = `V_meta consolidation-lag: ${result.verdict}: ${result.reason}`;
  const r = run({ absorb: absorbExcerpt(line), surface: 'method-infra' });
  assert.ok(hasPass(r, 'clause2-vmeta-lag'), JSON.stringify(r.failures));
});

test('clause2: literal template populated with a REAL checkLedger() FAIL/ALARM result also satisfies clause2', () => {
  // Real call: one row confirmed far enough in the past, with K=2, and NO dated carry-forward —
  // a genuine ALARM, not a fabricated one.
  const ledgerText = `| Insight | Confirmed | Status |\n|---|---|---|\n| conformance-test row | m1 | [confirmed] no carry-forward recorded |\n`;
  const result = checkLedger(ledgerText, { milestoneCounter: 10 });
  assert.equal(result.verdict, 'FAIL', 'sanity: this synthetic ledger call must itself be FAIL/ALARM');
  const line = `V_meta consolidation-lag: ${result.verdict}: ${result.reason}`;
  const r = run({ absorb: absorbExcerpt(line), surface: 'method-infra' });
  assert.ok(hasPass(r, 'clause2-vmeta-lag'), JSON.stringify(r.failures));
});

test('clause2: an arbitrary non-conforming disposition line does NOT pass (not a tautological test)', () => {
  const r = run({ absorb: absorbExcerpt('V_meta consolidation-lag: pending investigation, will follow up later'), surface: 'method-infra' });
  assert.ok(hasFail(r, 'clause2-vmeta-lag'), JSON.stringify(r.failures));
});

// ── 5. clause7: the Build-phase step 1a surface: vocabulary resolves exactly as the charter
// claims — non-product labels N/A-pass with NO coverage/WAIVER text; product labels and the
// no-token case still fail closed without one. ─────────────────────────────────────────────────
const disposedAudit = absorbExcerpt('adversarial-audit disposition: NO REFUTATION FOUND', `V_meta consolidation-lag: ${checkLedger('', { milestoneCounter: 5 }).reason}`);

for (const nonProductLabel of ['method-infra', 'docs', 'cross-cutting', 'packaging']) {
  test(`clause7: surface:${nonProductLabel} auto-resolves N/A-PASS with no coverage/WAIVER text (Build-phase step 1a fail-safe)`, () => {
    const r = run({ absorb: disposedAudit, surface: nonProductLabel });
    assert.ok(hasPass(r, 'clause7-test-floor'), JSON.stringify(r.failures));
    const passLine = r.passes.find((p) => p.includes('clause7-test-floor'));
    assert.match(passLine, /N\/A/);
  });
}

test('clause7: a product-touching surface (e.g. cli) with no coverage/WAIVER text still fails closed', () => {
  const r = run({ absorb: disposedAudit, surface: 'cli' });
  assert.ok(hasFail(r, 'clause7-test-floor'), JSON.stringify(r.failures));
});

test('clause7: no surface: token at all still fails closed (the Build-phase step 1a instruction exists precisely to prevent this)', () => {
  const r = run({ absorb: disposedAudit, surface: '' });
  assert.ok(hasFail(r, 'clause7-test-floor'), JSON.stringify(r.failures));
});

// ── 6. End-to-end: all three literal templates together, in one absorb-entry text, produce a
// clean clause1/clause2/clause7 result simultaneously (the actual shape a real Audit-phase run
// would leave behind) ──────────────────────────────────────────────────────────────────────────
test('end-to-end: all three literal templates together satisfy clause1 + clause2 + clause7 simultaneously', () => {
  const result = checkLedger('', { milestoneCounter: 5 });
  const absorb = absorbExcerpt(
    'adversarial-audit disposition: NO REFUTATION FOUND',
    `V_meta consolidation-lag: ${result.verdict}: ${result.reason}`,
  );
  const r = run({ absorb, surface: 'method-infra' });
  assert.ok(hasPass(r, 'clause1-adversarial-audit'), JSON.stringify(r.failures));
  assert.ok(hasPass(r, 'clause2-vmeta-lag'), JSON.stringify(r.failures));
  assert.ok(hasPass(r, 'clause7-test-floor'), JSON.stringify(r.failures));
});
