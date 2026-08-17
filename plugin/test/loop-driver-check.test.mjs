// @test-group governance
// loop-driver-check.test.mjs — gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.
//
// The outer measured the defect end-to-end (not by reading code): loop-driver-check.sh reads a
// SELF-DECLARED registry (<root>/.quay/loop-driver.jsonl) that the tick doc never instructed writing,
// so a verbatim tick-doc cold start reports STALLED (exit 3), and the doc's STALLED remedy ("rebuild
// the cron") manufactures the very double-trigger the check exists to catch.
//
// Layer-1 fix (the parent task):
//   1. the tick doc's step 4 now WRITES the registry, verbatim same-source as the cold-start skill;
//   2. the .gitignore covers the registry (already in master, f263f12fb) — verified, not re-added;
//   3. the STALLED disposition now checks the registry before telling the human to rebuild the cron;
//   4. the .halt print is a control-plane reading (未暂停), not a state assertion (运行中).
// Layer-2 (THIS task — gap-loop-driver-check-ac3-layer2-cron-observability): the LIVE verdict is
// now based on an OBSERVABLE source, not just registry-line count. The pre-question was answered by
// experiment: a bash checker CANNOT see the session-internal cron list (CronList output lives in the
// session process; the only disk traces are historical transcript logs — grep-able for a DEAD
// session's CronCreate, which would be a false positive). What bash CAN see is the driver's
// last-alive evidence: git HEAD commit time, orchestration/tick-log.md mtime, .quay/verification-
// round.jsonl mtime, docs/analysis/*.md mtime (the same multi-source heartbeat session-liveness.sh
// uses). So a registry line whose driver has produced NO fresh observable activity (and whose
// registry is itself stale) now reports DEAD (exit 6), never LIVE — AC3's stale_registry_exit=0.
// A freshly-installed driver (registry just written, first tick not yet fired) still reports LIVE
// (cold-start grace: clean_start_exit=0 contract); a genuinely-alive driver (fresh observable
// activity) reports LIVE.
//
// Contract measures pinned here:
//   doc_registers      — grep -c "loop-driver.jsonl" plugin/loop/orchestrator-loop-tick.md >= 1
//   clean_start_exit   — executing the tick-doc step-4 write lines in a clean repo ⇒ check exit 0 (LIVE)
//   registry_ignored   — git check-ignore -v .quay/loop-driver.jsonl ⇒ exit 0, `**/.quay/...` shape
//   stale_registry_exit — stale construction (registry line + old registry mtime + no observable
//                        activity) ⇒ `bash loop-driver-check.sh --check 2>&1 | grep -c 'LIVE\|STALLED'` = 0
//   invoke             — grep -n 'CronList\|会话内\|可观测\|cron' plugin/scripts/loop-driver-check.sh
//   control            — two registry lines ⇒ DOUBLE-TRIGGER exit 4 (no regression)
//   invariant          — zero-driver repo (fresh clone, registry absent) ⇒ STALLED, never LIVE
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

function runCheck(root, args = []) {
  return spawnSync('bash', [CHECKER, ...args, root], { encoding: 'utf8' });
}

// The layer-2 stale construction: exactly one registry line (a cron driver that registered),
// but the registry itself is OLD and there is NO fresh observable last-alive evidence (no git
// repo / old commit, no tick-log, no verification-round, no docs/analysis). This is the
// "registry has a row but the driver died long ago" shape the parent task's AC3 describes.
function makeStaleRegistry(root, regAgeDays = 2) {
  writeRegistryPerDoc(root);                     // one registry line
  const reg = path.join(root, '.quay', 'loop-driver.jsonl');
  const past = Math.floor(Date.now() / 1000) - regAgeDays * 24 * 3600;
  fs.utimesSync(reg, past, past);                // registry itself stale (install long ago)
}

// The layer-2 fresh-observable-activity fixture: one registry line PLUS a fresh tick-log the
// driver writes every cycle — a genuinely-alive driver.
function makeAliveDriver(root) {
  writeRegistryPerDoc(root);
  fs.mkdirSync(path.join(root, 'orchestration'), { recursive: true });
  fs.writeFileSync(path.join(root, 'orchestration', 'tick-log.md'), `# tick ${Date.now()}\n`);
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
// The CONTRACT `registry_ignored` measure is `git check-ignore -v .quay/loop-driver.jsonl ⇒ exit 0,
// **/.quay shape`. Under the suite's integration worktree the gitignored `.quay` dir is often a
// SYMLINK (git refuses to check-ignore a pathspec "beyond a symbolic link" — exit 128, not 0), so
// the check-ignore path is NOT a reliable probe of the rule's existence in that setup. The rule is
// what the measure pins; verify it via git check-ignore when git can see through `.quay`, else fall
// back to reading `.gitignore` directly (same assertion: a `**/.quay/<file>` rule is present).
function assertGitignoreRule(rel) {
  const rule = `**/.quay/${path.basename(rel)}`;
  const esc = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r = spawnSync('git', ['check-ignore', '-v', rel], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status === 0) {
    assert.match(r.stdout, new RegExp(esc), `matched rule must be ${rule}`);
    return;
  }
  // git could not traverse `.quay` (symlink or other) — fall back to the textual .gitignore rule.
  const gi = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.ok(gi.split('\n').some((l) => l.trim() === rule),
    `git check-ignore failed (${r.stderr.trim()}) AND .gitignore lacks the ${rule} rule — the registry must be gitignored`);
}

test('AC2 — the registry is gitignored, same shape as gate-events.jsonl', () => {
  assertGitignoreRule(path.join('.quay', 'loop-driver.jsonl'));
  // Same family shape as gate-events.jsonl (`.gitignore:<n>:**/.quay/<file>`).
  assertGitignoreRule(path.join('.quay', 'gate-events.jsonl'));
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

// ── AC3 (layer-2): the stale construction must NOT report LIVE ────────────────────────────────────
test('AC3 (layer-2) — a registry line whose driver died reports DEAD (exit 6); the Contract measure stale_registry_exit = 0', () => {
  const ws = makeTmp();
  try {
    makeStaleRegistry(ws);                       // one line, registry 2 days old, no observable activity
    const c = runCheck(ws, ['--check']);         // the Contract measure's invocation
    assert.equal(c.status, 6, `stale registration must be DEAD (exit 6), got ${c.status}: ${c.stdout}${c.stderr}`);
    assert.match(c.stdout, /DEAD/, 'must report DEAD');
    // Contract band stale_registry_exit = 0: the output must contain NEITHER LIVE NOR STALLED.
    assert.doesNotMatch(c.stdout, /LIVE/, 'a stale registration must NOT report LIVE (AC3)');
    assert.doesNotMatch(c.stdout, /STALLED/, 'a stale registration must NOT report STALLED');
    const matches = (c.stdout.match(/LIVE|STALLED/g) || []).length;
    assert.equal(matches, 0, `stale_registry_exit must be 0, got ${matches}: ${c.stdout}`);
    // The positional form must agree with --check (same criterion).
    const cp = runCheck(ws);
    assert.equal(cp.status, 6, `positional form must also be DEAD, got ${cp.status}: ${cp.stdout}`);
    assert.doesNotMatch(cp.stdout, /LIVE|STALLED/, 'positional form must not report LIVE/STALLED either');
  } finally { cleanup(ws); }
});

// ── AC2 (layer-2): the criterion source is visible in the script (invoke) ─────────────────────────
test('invoke — the criterion source (CronList / 会话内 / 可观测 / cron) is visible in the script', () => {
  const src = fs.readFileSync(CHECKER, 'utf8');
  for (const kw of ['CronList', '会话内', '可观测', 'cron']) {
    assert.ok(src.includes(kw), `script must carry the criterion-source keyword '${kw}' (invoke contract)`);
  }
});

// ── AC2 (layer-2): a genuinely-alive driver still reports LIVE ────────────────────────────────────
test('AC2 (layer-2) — a genuinely-alive driver (registry line + fresh observable activity) reports LIVE (exit 0)', () => {
  const ws = makeTmp();
  try {
    makeAliveDriver(ws);                         // registry line + fresh tick-log
    const c = runCheck(ws, ['--check']);
    assert.equal(c.status, 0, `live driver must be LIVE (exit 0), got ${c.status}: ${c.stdout}${c.stderr}`);
    assert.match(c.stdout, /loop-driver: LIVE \(1\)/, 'must print the LIVE (1) line');
  } finally { cleanup(ws); }
});

// ── AC2 (layer-2): a fresh install (no tick yet) still reports LIVE (cold-start grace) ────────────
test('AC2 (layer-2) — a freshly-installed driver (registry just written, first tick not yet fired) still reports LIVE (cold-start grace)', () => {
  const ws = makeTmp();
  try {
    writeRegistryPerDoc(ws);                     // registry just written, NO observable activity yet
    const c = runCheck(ws, ['--check']);
    assert.equal(c.status, 0, `fresh install must be LIVE (exit 0), got ${c.status}: ${c.stdout}${c.stderr}`);
    assert.match(c.stdout, /loop-driver: LIVE \(1\)/, 'must print the LIVE (1) line');
  } finally { cleanup(ws); }
});

// ── AC3 (layer-2, doc-level): the doc-level stale-clear remedy is retained for operators ───────────
test('AC3 (layer-2) — the DOC-level stale-clear remedy is retained alongside the mechanical DEAD verdict', () => {
  // The tick doc and cold-start skill still instruct `rm -f <root>/.quay/loop-driver.jsonl` before a
  // re-cold-start — the operator-side cleanup. The mechanical stale detection is now the checker's
  // DEAD verdict (above); the doc remedy remains for the operator who must clear the old line.
  const tick = fs.readFileSync(TICK_DOC, 'utf8');
  const skill = fs.readFileSync(COLD_START, 'utf8');
  assert.match(skill, /rm -f <root>\/\.quay\/loop-driver\.jsonl/, 'cold-start skill must clear the stale registry');
  assert.match(tick, /rm -f <root>\/\.quay\/loop-driver\.jsonl/, 'tick doc must clear the stale registry before rebuild');
});

// ── AC99 (gap-ac99-webui-machine-readable-json): --json machine-readable interface ────────────────
// The Manager view reads loop-driver-check.sh --json. The JSON document must agree with the text
// verdict and exit code (production carrier, not a fixture — 硬规则④推论三).

test('AC99 — --json emits ONE valid JSON document agreeing with the text verdict/exit code', () => {
  const ws = makeTmp();
  try {
    // Fresh install → LIVE (exit 0), same as the text path.
    writeRegistryPerDoc(ws);
    const jr = spawnSync('bash', [CHECKER, '--json', ws], { encoding: 'utf8' });
    assert.equal(jr.status, 0, `live --json must exit 0; got ${jr.status}: ${jr.stdout}${jr.stderr}`);
    let j = JSON.parse(jr.stdout.trim());
    assert.equal(j.verdict, 'LIVE');
    assert.equal(j.exit_code, 0);
    assert.equal(j.driver_count, 1);
    assert.equal(j.mechanism, 'cron');
    assert.match(j.detail, /loop-driver: LIVE \(1\)/);

    // Zero-driver → STALLED (exit 3), JSON agrees.
    const ws2 = makeTmp();
    try {
      const sr = spawnSync('bash', [CHECKER, '--check', '--json', ws2], { encoding: 'utf8' });
      assert.equal(sr.status, 3, `stalled --json must exit 3; got ${sr.status}: ${sr.stdout}`);
      j = JSON.parse(sr.stdout.trim());
      assert.equal(j.verdict, 'STALLED');
      assert.equal(j.exit_code, 3);
      assert.equal(j.driver_count, 0);
      assert.equal(j.mechanism, null);
    } finally { cleanup(ws2); }

    // Text path (no --json) stays byte-identical for the existing consumers.
    const tr = runCheck(ws);
    assert.match(tr.stdout, /loop-driver: LIVE \(1\)/, 'text path unchanged');
  } finally { cleanup(ws); }
});
