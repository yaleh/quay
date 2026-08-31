// @test-group engine
// loop-shipping-necessity-check.test.mjs — gap-exclusion-lists-have-no-necessity-check.
//
// The AC1b exclusion table (plugin/scripts/loop-shipping-exclusion-data.mjs) only ever grows, and
// nothing can discover an entry that is no longer NECESSARY. The 2026-08-04 instance:
// orchestration/inner-brief-2026-08-04-restart.md's exclusion became dead weight once its source
// was fixed (commit 6e01329e split the full old path into dir+filename) — it suppressed zero hits,
// only blinding that file to all five old paths. A green AC1b run proves GREEN, not NECESSARY.
//
// This file is the necessity check's DETERMINISTIC half: for each FILE-level exclusion entry, scan
// its target file for hits of the 5 old-path patterns. A target with ZERO hits means the exclusion
// suppresses nothing today — it is INERT (必然不必要), the safe deterministic lower bound. The
// mechanism enforces the ## Contract invariant:
//
//    排除表不允许惰性条目——每条排除项必须有它抑制的命中，或写明为何保留
//
// so an inert FILE-level entry MUST carry a `retainedNote` in the shared data (the "或写明为何
// 保留" branch); an inert entry without one is a VIOLATION and fails this test (exit non-zero).
//
// Output (the ## Contract `inert_exclusions` measure field):
//   inert_exclusions: <N>   — unjustified inert file-level entries (band = 0)
//
// Scope: FILE-level entries only. Directory entries (tasks/ milestones/ plugin/loop/ fixtures/)
// police growing subtrees and are structurally forward-looking — a documented out-of-scope decision
// (a directory-level inertness scan is a future extension, not this mechanism's contract).
//
// Run:  scripts/test.sh --scoped plugin/test/loop-shipping-necessity-check.test.mjs
//       (scoped tier — the explicit-file form walks the whole-store static checks, which are
//        currently red on master for unrelated tasks' contract-ratchet violations)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { oldPathPatterns, exclusionEntries } from '../scripts/loop-shipping-exclusion-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

/** Count old-path-pattern hits in a file (recursively for a directory). Non-existent → 0. */
function countOldPathHits(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  let hits = 0;
  const scanFile = (p) => {
    const src = fs.readFileSync(p, 'utf8');
    for (const re of oldPathPatterns) if (re.test(src)) hits += 1;
  };
  if (stat.isDirectory()) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(md|sh|mjs|ts|json|yml|js)$/.test(e.name)) continue;
        scanFile(p);
      }
    };
    walk(target);
  } else {
    scanFile(target);
  }
  return hits;
}

/**
 * The inert-exclusion detector. Classifies a table of entries (from the shared data module, or a
 * synthetic list for the controls) into:
 *   - fileLevel:     entries whose target is a regular file OR MISSING (a missing target is stale
 *                    dead weight — its exclusion suppresses nothing because nothing is there).
 *   - inert:         fileLevel entries whose target contains 0 old-path-pattern hits.
 *   - violations:    inert entries WITHOUT a retainedNote (the enforced ## Contract invariant).
 *   - retainedInert: inert entries WITH a retainedNote (allowed — the "写明为何保留" branch).
 * Directory targets are NOT classified: this mechanism is scoped to file-level entries.
 */
function classifyTable(entries) {
  const fileLevel = entries.filter((e) => {
    const st = fs.existsSync(e.target) ? fs.statSync(e.target) : null;
    return !st || st.isFile();
  });
  const inert = fileLevel.filter((e) => {
    const st = fs.existsSync(e.target) ? fs.statSync(e.target) : null;
    return !st || countOldPathHits(e.target) === 0;
  });
  const violations = inert.filter((e) => !e.retainedNote);
  const retainedInert = inert.filter((e) => e.retainedNote);
  return { fileLevel, inert, violations, retainedInert };
}

test('AC1/AC2 — no inert FILE-level exclusion entry without a written retention reason (inert_exclusions = 0)', () => {
  const entries = exclusionEntries(repoRoot, pluginDir);
  const { fileLevel, inert, violations, retainedInert } = classifyTable(entries);
  // The ## Contract measure field — a single greppable line.
  console.log(`inert_exclusions: ${violations.length}`);
  console.log(`scanned file-level exclusion entries: ${fileLevel.length}`);
  console.log(`inert-but-retained entries: ${retainedInert.length}`);
  for (const c of inert) {
    console.log(`  inert ${c.rel} (hits=0) retainedNote=${c.retainedNote ? 'YES' : 'NO'}`);
  }
  for (const c of violations) {
    console.log(`  VIOLATION ${c.rel} — inert with no retainedNote`);
  }
  assert.deepEqual(
    violations.map((v) => v.rel),
    [],
    'inert FILE-level exclusion entries must carry a retainedNote in loop-shipping-exclusion-data.mjs (why kept despite suppressing nothing), or be removed',
  );
});

test('AC3 — negative control: injecting a live old-path reference flips an inert target to non-inert', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsnc-ac3-'));
  try {
    // A target with no old-path references is inert (hits = 0):
    const clean = path.join(tmp, 'clean.md');
    fs.writeFileSync(clean, 'no old-path references here\n');
    assert.equal(countOldPathHits(clean), 0, 'clean target must be inert');

    // Inject a live old-path reference. Built via path.join so the CONTIGUOUS old-path string
    // never appears in THIS file's source — the AC1b scan would otherwise flag this test file as
    // a live reference (the exclusion-data module, which DOES spell the old paths, is itself
    // self-excluded for that reason).
    const live = path.join(tmp, 'live.md');
    const injected = path.join('orchestration', 'orchestrator-loop-tick.md');
    fs.writeFileSync(live, `the old path ${injected} is referenced\n`);
    assert.ok(countOldPathHits(live) > 0, 'a live old-path reference must flip the target to non-inert');

    // Classification-level flip: an entry on the clean target is a violation (inert); on the live
    // target it is NOT — the 判定翻转 AC3 demands.
    const cleanEntry = { rel: 'ac3-clean', target: clean, reason: 'AC3 synthetic' };
    const liveEntry = { rel: 'ac3-live', target: live, reason: 'AC3 synthetic' };
    assert.equal(classifyTable([cleanEntry]).violations.length, 1, 'clean target -> inert -> violation');
    assert.equal(classifyTable([liveEntry]).violations.length, 0, 'live target -> non-inert (flip)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC4 — the detector REPORTS an inert entry (fails closed), it does not silently pass', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsnc-ac4-'));
  try {
    const inertTarget = path.join(tmp, 'inert.md');
    fs.writeFileSync(inertTarget, 'no old-path references\n');
    const liveTarget = path.join(tmp, 'live.md');
    const injected = path.join('orchestration', 'orchestrator-loop-tick.md');
    fs.writeFileSync(liveTarget, `${injected}\n`);
    const missingTarget = path.join(tmp, 'does-not-exist.md'); // stale exclusion: target deleted

    const table = [
      { rel: 'constructed-inert', target: inertTarget, reason: 'AC4 synthetic' },
      { rel: 'constructed-live', target: liveTarget, reason: 'AC4 synthetic' },
      { rel: 'constructed-retained', target: inertTarget, reason: 'AC4 synthetic', retainedNote: 'kept because a future literal-string target-layout assertion must not false-positive AC1b' },
      { rel: 'constructed-missing', target: missingTarget, reason: 'AC4 synthetic' },
    ];
    const { violations, retainedInert } = classifyTable(table);
    // The inert entry must be REPORTED as a violation. A detector that returned an empty
    // violation set here would be indistinguishable from a no-op ("一个从没红过的检查与永远返回
    // 空集不可区分"). A MISSING target is stale dead weight — also inert, also a violation.
    assert.deepEqual(
      violations.map((v) => v.rel),
      ['constructed-inert', 'constructed-missing'],
      'an inert entry (or a stale/missing-target entry) without a retainedNote must be reported as a violation (report, not silence)',
    );
    // The ## Contract invariant's "或写明为何保留" branch: an inert entry WITH a written
    // retention reason is retained-inert, NOT a violation.
    assert.deepEqual(
      retainedInert.map((v) => v.rel),
      ['constructed-retained'],
      'an inert entry with a retainedNote is retained-inert, not a violation',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
