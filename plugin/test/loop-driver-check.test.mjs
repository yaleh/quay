// @test-group governance
// loop-driver-check.test.mjs — gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.
//
// The outer measured the defect end-to-end (not by reading code): loop-driver-check.sh reads a
// SELF-DECLARED registry (<root>/.quay/loop-driver.jsonl) that the tick doc never instructed writing,
// so a verbatim tick-doc cold start reports STALLED (exit 3), and the doc's STALLED remedy ("rebuild
// the cron") manufactures the very double-trigger the check exists to catch.
//
// Layer-1 fix (this task):
//   1. the tick doc's step 4 now WRITES the registry, verbatim same-source as the cold-start skill;
//   2. the .gitignore covers the registry (already in master, f263f12fb) — verified, not re-added;
//   3. the STALLED disposition now checks the registry before telling the human to rebuild the cron;
//   4. the .halt print is a control-plane reading (未暂停), not a state assertion (运行中).
// Layer-2 (recorded in the task body, NOT implemented here): the registry is self-declared — a bash
// checker cannot tell a dead cron's leftover registration from a live one, so AC3's "stale registry
// must not report LIVE" is NOT solvable in layer 1. No test asserts the checker CAN distinguish; the
// task body records it honestly as unsolved + written into layer 2.
//
// Contract measures pinned here:
//   doc_registers     — grep -c "loop-driver.jsonl" plugin/loop/orchestrator-loop-tick.md >= 1
//   clean_start_exit  — executing the tick-doc step-4 write lines in a clean repo ⇒ check exit 0 (LIVE)
//   registry_ignored  — git check-ignore -v .quay/loop-driver.jsonl ⇒ exit 0, `**/.quay/...` shape
//   invoke            — bash scripts/test.sh plugin/test/loop-driver-check.test.mjs
//   control           — two registry lines ⇒ DOUBLE-TRIGGER exit 4 (no regression)
//   invariant         — zero-driver repo (fresh clone, registry absent) ⇒ STALLED, never LIVE
//
// Run:
//   scripts/test.sh plugin/test/loop-driver-check.test.mjs
//   node --test plugin/test/loop-driver-check.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginRoot, '..');
const TICK_DOC = path.join(pluginRoot, 'loop', 'orchestrator-loop-tick.md');
const COLD_START = path.join(pluginRoot, 'skills', 'cold-start', 'SKILL.md');
const CHECKER = path.join(pluginRoot, 'scripts', 'loop-driver-check.sh');

// The registry-write lines the tick-doc step 4 and the cold-start skill step 5 both instruct.
// `<root>` is the placeholder the docs use (substituted per-project at cold-start).
const REG_MKDIR = 'mkdir -p <root>/.quay';
const REG_WRITE = `printf '%s\\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}' >> <root>/.quay/loop-driver.jsonl`;

function makeTmp(prefix = 'loop-drv-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// Execute the doc's own registry-write lines against a root (proves doc → behavior).
function writeRegistryPerDoc(root) {
  for (const line of [REG_MKDIR, REG_WRITE]) {
    const cmd = line.replaceAll('<root>', root);
    const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
    assert.equal(r.status, 0, `doc write line must execute: ${cmd}\n${r.stderr}`);
  }
}

function runCheck(root) {
  return spawnSync('bash', [CHECKER, root], { encoding: 'utf8' });
}

// ── AC1/AC5: the tick doc registers the driver, verbatim same-source as the cold-start skill ──────────
test('AC1/AC5 — the tick doc step 4 registers the driver, verbatim same-source as the cold-start skill', () => {
  const tick = fs.readFileSync(TICK_DOC, 'utf8');
  const skill = fs.readFileSync(COLD_START, 'utf8');
  assert.ok(tick.includes(REG_WRITE), 'tick doc must instruct the registry write (defect one)');
  assert.ok(tick.includes(REG_MKDIR), 'tick doc must mkdir .quay before writing');
  assert.ok(skill.includes(REG_WRITE), 'cold-start skill must still instruct the registry write');
  // 逐字同源 (AC5): the write line is byte-identical in both docs.
  const tickLine = tick.split('\n').find((l) => l.includes('loop-driver.jsonl') && l.includes('printf'));
  const skillLine = skill.split('\n').find((l) => l.includes('loop-driver.jsonl') && l.includes('printf'));
  assert.ok(tickLine && skillLine, 'both docs must carry the printf write line');
  assert.equal(tickLine, skillLine, 'the registry-write line must be verbatim same-source (AC5)');
  // Contract measure doc_registers >= 1.
  const n = tick.split('loop-driver.jsonl').length - 1;
  assert.ok(n >= 1, `doc_registers must be >= 1, got ${n}`);
});

// ── AC1: clean cold start per the tick doc ⇒ LIVE ───────────────────────────────────────────────────
test('AC1 — executing the tick-doc step-4 write lines in a clean repo ⇒ loop-driver-check reports LIVE (exit 0)', () => {
  const ws = makeTmp();
  try {
    writeRegistryPerDoc(ws);   // exactly what the tick doc now instructs
    const c = runCheck(ws);
    assert.equal(c.status, 0, `clean cold-start must be LIVE (exit 0), got ${c.status}: ${c.stdout}${c.stderr}`);
    assert.match(c.stdout, /loop-driver: LIVE \(1\)/, 'must print the LIVE (1) line');
  } finally { cleanup(ws); }
});

// ── AC2: the registry is gitignored, same shape as gate-events.jsonl ────────────────────────────────
test('AC2 — the registry is gitignored, same shape as gate-events.jsonl', () => {
  const reg = path.join('.quay', 'loop-driver.jsonl');
  const r = spawnSync('git', ['check-ignore', '-v', reg], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(r.status, 0, `git check-ignore must exit 0:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /\*\*\/\.quay\/loop-driver\.jsonl/, 'matched rule must be **/.quay/loop-driver.jsonl');
  // Same family shape as gate-events.jsonl (`.gitignore:<n>:**/.quay/<file>`).
  const ge = spawnSync('git', ['check-ignore', '-v', path.join('.quay', 'gate-events.jsonl')],
    { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(ge.status, 0, 'gate-events.jsonl must also be ignored (family control)');
  assert.match(ge.stdout, /\*\*\/\.quay\/gate-events\.jsonl/, 'gate-events rule must be the same **/.quay shape');
});

// ── AC4: double-trigger negative control ────────────────────────────────────────────────────────────
test('AC4 — two registry lines ⇒ DOUBLE-TRIGGER (exit 4) — the negative control must not regress', () => {
  const ws = makeTmp();
  try {
    writeRegistryPerDoc(ws);            // step 4: one cron
    writeRegistryPerDoc(ws);            // §4a relapse: a second driver
    const c = runCheck(ws);
    assert.equal(c.status, 4, `two drivers must be DOUBLE-TRIGGER (exit 4), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /DOUBLE-TRIGGER/, 'must report DOUBLE-TRIGGER');
  } finally { cleanup(ws); }
});

// ── AC5: STALLED disposition checks the registry before rebuilding ──────────────────────────────────
test('AC5 — the STALLED disposition checks the registry before telling the human to rebuild the cron', () => {
  const tick = fs.readFileSync(TICK_DOC, 'utf8');
  // The old wording told the reader to just "回步骤 4 重建 cron" (which omits the write → STALLED
  // forever → re-build → double-trigger). The bare rebuild-cron instruction must be gone.
  assert.ok(!tick.includes('回步骤 4 重建 cron'), 'the STALLED remedy must no longer be a bare rebuild-cron instruction');
  // The new wording must require checking the registry first (AC5).
  assert.match(tick, /先查注册表[^。]*再谈重建 cron/, 'must check the registry before rebuilding the cron (AC5)');
  assert.match(tick, /rm -f <root>\/\.quay\/loop-driver\.jsonl/, 'must name the stale-registry clear command');
});

// ── AC7: the .halt print is a control-plane reading, not a state assertion ──────────────────────────
test('AC7 — the .halt print is a control-plane reading (未暂停), not a state assertion (运行中)', () => {
  const tick = fs.readFileSync(TICK_DOC, 'utf8');
  const haltLine = tick.split('\n').find((l) => l.includes('.halt') && l.includes('head -c 80'));
  assert.ok(haltLine, 'the .halt print line must exist in the tick doc');
  assert.match(haltLine, /未暂停/, 'the no-.halt branch must print 未暂停');
  assert.doesNotMatch(haltLine, /运行中/, 'must NOT print 运行中 — a control-plane absence is not a state assertion');
});

// ── Invariant: a zero-driver repo never reports LIVE ────────────────────────────────────────────────
test('AC1/invariant — a zero-driver repo (fresh clone, registry absent) reports STALLED (exit 3), never LIVE', () => {
  const ws = makeTmp();
  try {
    const c = runCheck(ws);
    assert.equal(c.status, 3, `zero drivers must be STALLED (exit 3), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /STALLED/, 'must report STALLED');
    assert.doesNotMatch(c.stdout, /LIVE/, 'a zero-driver repo must NEVER report LIVE (invariant)');
  } finally { cleanup(ws); }
});

// ── Invariant: a stale registry's live/dead is structurally indistinguishable in layer 1 ─────────────
test('AC3 (layer-1 limit, pinned) — a registry written but whose cron died is indistinguishable from LIVE at the checker level; the DOC-level remedy is what layer 1 ships', () => {
  // Layer 1 cannot make the checker distinguish a dead cron's leftover registration from a live one
  // (the cron is session-internal; a bash checker cannot observe it — the layer-2 open question).
  // What layer 1 DOES ship is the doc-level remedy: both the tick doc and the cold-start skill
  // instruct clearing the stale registry before a re-cold-start. Pin that here so a future layer-2
  // change that makes the checker stale-aware updates this test's contract.
  const tick = fs.readFileSync(TICK_DOC, 'utf8');
  const skill = fs.readFileSync(COLD_START, 'utf8');
  assert.match(skill, /rm -f <root>\/\.quay\/loop-driver\.jsonl/, 'cold-start skill must clear the stale registry');
  assert.match(tick, /rm -f <root>\/\.quay\/loop-driver\.jsonl/, 'tick doc must clear the stale registry before rebuild');
  // The stale-state construction is real (one line, no live cron); the layer-1 outcome is recorded
  // in the task body as NOT solved at the checker level (AC3), NOT asserted as fixed here.
});
