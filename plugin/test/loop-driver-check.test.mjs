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
// loop-driver-check.test.mjs —
// gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.
// loop-driver-check.sh counts LINES in the SELF-DECLARED registry
// .quay/loop-driver.jsonl — it does not observe any real driver. The tick doc
// step 4 now instructs writing that registry (byte-identical payload with the
// cold-start skill) so a verbatim cold start reaches LIVE.
//
// Tests:
//   AC1 (doc parity) — the tick doc step 4 records the driver with the SAME
//                      JSON payload as the cold-start skill (逐字同源).
//   AC1 (live)       — one cron registry line → LIVE, exit 0.
//   AC4 (neg ctrl)   — two lines → DOUBLE-TRIGGER, exit 4.
//   AC3 (HONEST limit) — a STALE single line (no real driver exists) is
//                      INDISTINGUISHABLE from a live one → still reports LIVE.
//                      This is the structural limit of a self-declared registry;
//                      recorded as NOT solved by L1, transferred to L2. We do NOT
//                      fake a pass: the test pins the true current behavior.
//   AC5 (doc)        — the tick doc STALLED remedy checks the registry BEFORE
//                      re-creating the cron (no more double-trigger machine).
//   AC7 (doc)        — the no-.halt print is 未暂停, not 运行中 (a control-plane
//                      read, not a state assertion).
//   AC2 (gitignore)  — the registry is gitignored with a rule same-shaped as
//                      gate-events.jsonl.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const TICK_DOC = path.join(PLUGIN_DIR, "loop", "orchestrator-loop-tick.md");
const SKILL_DOC = path.join(PLUGIN_DIR, "skills", "cold-start", "SKILL.md");
const CHECK_SCRIPT = path.join(PLUGIN_DIR, "scripts", "loop-driver-check.sh");

// The registry line payload — the exact string both docs must carry (逐字同源).
const REG_PAYLOAD = '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}';

function tmpWs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ldc-check-"));
}

function writeRegistry(dir, count = 1) {
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  for (let i = 0; i < count; i++) {
    fs.appendFileSync(path.join(dir, ".quay", "loop-driver.jsonl"), REG_PAYLOAD + "\n", "utf8");
  }
}

function runCheck(dir) {
  return spawnSync("bash", [CHECK_SCRIPT, dir], { cwd: dir, encoding: "utf8" });
}

// ── AC1 (doc parity): the tick doc step 4 writes the registry, same payload ────────────────────────
test('AC1 (doc parity) — tick doc step 4 records the driver with the same payload as the cold-start skill (逐字同源)', () => {
  const tick = fs.readFileSync(TICK_DOC, "utf8");
  const skill = fs.readFileSync(SKILL_DOC, "utf8");
  assert.ok(tick.includes("loop-driver.jsonl"), "the tick doc must name the registry (band doc_registers >= 1)");
  assert.match(tick, /printf '%s\\n' '.*loop-driver\.jsonl/, "the tick doc step 4 must contain the registry-write line");
  assert.ok(tick.includes(REG_PAYLOAD), "the tick doc's registry payload must be the sanctioned one");
  assert.ok(skill.includes(REG_PAYLOAD), "the cold-start skill's registry payload must be the sanctioned one");
  assert.ok(skill.includes("loop-driver.jsonl"), "the cold-start skill names the registry");
});

// ── AC1 (live): one cron line → LIVE, exit 0 ───────────────────────────────────────────────────────
test('AC1 (live) — one cron registry line reports LIVE, exit 0', () => {
  const ws = tmpWs();
  try {
    writeRegistry(ws, 1);
    const c = runCheck(ws);
    assert.equal(c.status, 0, `one cron driver must be LIVE (exit 0), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /LIVE/, "must print LIVE");
    assert.match(c.stdout, /\(1\)/, "must print the count 1");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC4 (negative control): two lines → DOUBLE-TRIGGER, exit 4 ────────────────────────────────────
test('AC4 (negative control) — two registry lines still report DOUBLE-TRIGGER, exit 4', () => {
  const ws = tmpWs();
  try {
    writeRegistry(ws, 2);
    const c = runCheck(ws);
    assert.equal(c.status, 4, `two drivers must be DOUBLE-TRIGGER (exit 4), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /DOUBLE-TRIGGER/, "must report DOUBLE-TRIGGER");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC3 (honest limitation, NOT solved by L1) ─────────────────────────────────────────────────────
test('AC3 (honest limitation) — a stale single entry is indistinguishable from a live one: still reports LIVE (NOT solved by L1)', () => {
  const ws = tmpWs();
  try {
    // "registry has one line, but that driver is long gone" — the previous
    // session's cron is dead, yet the self-declared registry still has its line.
    writeRegistry(ws, 1);
    const c = runCheck(ws);
    // The checker can only count lines. It CANNOT distinguish a dead cron from a
    // live one — the registry carries no session identity or liveness probe. A
    // zero-driver repo with a stale line is therefore reported LIVE (false
    // positive), which is exactly the structural limit recorded in the task body
    // (AC3 not solved in L1; transferred to L2). We pin the TRUE behavior rather
    // than fake a pass.
    assert.equal(c.status, 0, "self-declared registry cannot detect staleness — reports LIVE (exit 0) by design");
    assert.match(c.stdout, /LIVE/, "the checker reads only the registry, not the real driver");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC5 (doc): STALLED remedy checks the registry before re-creating the cron ─────────────────────
test('AC5 (doc) — the STALLED remedy checks the registry was written before re-creating the cron', () => {
  const tick = fs.readFileSync(TICK_DOC, "utf8");
  const stallSection = tick.slice(tick.indexOf("确认恰好一个触发源"));
  assert.ok(stallSection.includes("STALLED"), "must address the STALLED case");
  assert.match(stallSection, /先查注册表是否写过，再谈重建 cron/, "must gate the rebuild behind the registry check in the phrasing itself");
  assert.match(stallSection, /注册表写过吗/, "must tell the operator to check whether the registry was written");
  // The double-trigger machine is gone: re-creating the cron must be the
  // LAST-resort step (step 3), AFTER checking the registry (step 1) and after
  // distinguishing "never wrote it" (step 2) — never the unconditional first action.
  const checkIdx = stallSection.indexOf("注册表写过吗");
  const rebuildIdx = stallSection.indexOf("这时才回步骤 4 重建 cron");
  assert.ok(checkIdx !== -1 && rebuildIdx !== -1, "both the registry check and the gated rebuild must be present");
  assert.ok(rebuildIdx > checkIdx, "the registry check must precede the (gated) rebuild");
});

// ── AC7 (doc): no-.halt print is 未暂停, not 运行中 ────────────────────────────────────────────────
test('AC7 (doc) — the no-.halt print is 未暂停 (control-plane), not 运行中 (state assertion)', () => {
  const tick = fs.readFileSync(TICK_DOC, "utf8");
  assert.ok(tick.includes("未暂停"), "the no-.halt branch must print 未暂停");
  assert.ok(!tick.includes('echo 运行中'), "the no-.halt branch must NOT print 运行中 (a control-plane absence read as a state assertion)");
  assert.ok(!/echo "运行中"|echo 运行中/.test(tick), "no residual 运行中 status-print in the tick doc");
});

// ── AC2 (gitignore): registry is gitignored same-shaped as gate-events.jsonl ──────────────────────
test('AC2 (gitignore) — .quay/loop-driver.jsonl is ignored by a rule same-shaped as gate-events.jsonl', () => {
  const r = spawnSync("git", ["check-ignore", "-v", ".quay/loop-driver.jsonl"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `git check-ignore must exit 0 (ignored), got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /loop-driver\.jsonl/, "must name the loop-driver.jsonl rule");
  const g = spawnSync("git", ["check-ignore", "-v", ".quay/gate-events.jsonl"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(g.status, 0, "gate-events.jsonl must also be ignored (same-shape control)");
  const driverRule = r.stdout.split("\t")[0];
  const gateRule = g.stdout.split("\t")[0];
  assert.match(driverRule, /\*\*\/\.quay\/loop-driver\.jsonl/, "the driver rule must be **/.quay/loop-driver.jsonl");
  assert.match(gateRule, /\*\*\/\.quay\/gate-events\.jsonl/, "the gate rule must be **/.quay/gate-events.jsonl (same shape)");
});
