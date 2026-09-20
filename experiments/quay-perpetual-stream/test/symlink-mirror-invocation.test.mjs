// @test-group engine
// symlink-mirror-invocation.test.mjs — gap-touches-orthogonality-symlink-isdirect-mismatch.
//
// PROBLEM this closes: `experiments/quay-perpetual-stream/scripts/`-mirrored symlinks into
// `plugin/scripts/` invoke a TypeScript CLI whose `isDirect` guard compared `process.argv[1]`
// (the symlink path, as-invoked) against `fileURLToPath(import.meta.url)` (Node's ESM loader
// realpath-resolves this to the symlink TARGET). These never compared equal via the symlink path,
// so `main()` never ran — the CLI silently exited 0 with zero output, indistinguishable from "ran
// and found nothing wrong". Fixed by routing every guard through `gate-script-base.ts`'s
// `isDirectEntry()`, now `fs.realpathSync`-based.
//
// This test does NOT hardcode the affected script names — it enumerates every symlink under
// `experiments/quay-perpetual-stream/scripts/` whose realpath target is a `.ts` file under
// `plugin/scripts/`, and for each one, invokes it via BOTH the symlink path and the real path with
// no arguments. The asserted CONTRACT is deliberately uniform, but it accounts for the legitimate
// divergences the original uniform assumption denied (two confirmed live 2026-08-02,
// `gap-symlink-mirror-invocation-test-contract-mismatch`; a third added 2026-09-20 by
// gap-version-stamp-generator-and-build-wiring — see bullet 2's ⛔ note):
//   1. NON-SILENT: a guard-firing CLI must print something — exit 0 with zero output is THE defect
//      class (a guard that never fires is indistinguishable from "ran and found nothing wrong").
//      Exit codes vary legitimately across scripts: most arg-requiring scripts print "Usage:" to
//      stderr and exit 2; config-wiring-check / drivable-workspace-check run a real default check
//      and exit 1 with a report; report tools with no required args print a "Usage:" block to
//      stdout and exit 0 (fast-mode-telemetry — B2-1 contract); and a REPORT-ONLY tool whose no-args
//      path IS its default run prints its report to stdout and exits 0 by design (the live instance:
//      task-status-drift-check.ts, `return 0; // ALWAYS 0 — report-only, never a gate`, invoked with
//      no arguments by the loop ticks — plugin/loop/orchestrator-loop-tick.md:117,
//      plugin/loop/fast-mode-loop-tick.md:100). An exit-0 no-args path is therefore accepted when it
//      says something on STDOUT — an interface listing OR a report; an exit-0 path that printed
//      only to stderr, or nothing at all, is rejected. Honest boundary
//      (ADR-review-1, task-sanctioned trade-off): the exit-0 proof is output-based, so a script that
//      printed via TOP-LEVEL code OUTSIDE the guard and exited 0 with byte-identical output via both
//      paths would also pass — the historical silent-no-op defect (exit 0, ZERO output, main() never
//      ran) is still caught loudly, which is the class this test exists to guard.
//      ⛔ The third shape was added 2026-09-19 by gap-arch-duplicate-copies-zero, whose conversion of
//      the 39 byte-identical mirrors to symlinks made this file DISCOVER them for the first time
//      (discovery is symlink-based: a mirror only enters the population once it IS a link).
//   2. EQUALITY: symlink-path and real-path stdout/stderr/exit must be byte-identical EXCEPT for
//      embedded clock fields (`\d{13}` ms-epoch values, e.g. milestone-worktree's `nowMs`) which
//      legitimately differ between two invocations milliseconds apart — these are redacted on both
//      sides before comparison. Honest boundary (ADR-review-1): the redaction is a general
//      `\d{13}`-run rule, so a NON-clock 13-digit difference would also be hidden (speculative
//      future script; none in the current population); every difference OUTSIDE a 13-digit run
//      still fails.
//      ⛔ A SECOND sanctioned stdout divergence, added 2026-09-20 by
//      gap-version-stamp-generator-and-build-wiring: a report-only tool whose no-args path prints
//      the repo's LIVE state cannot hold still while the loop advances it. `task-status-drift-check.ts`
//      is that tool — measured, two invocations minutes apart differed on exactly ONE line (its
//      STRANDED branch list, after a task branch was merged and another advanced) while the 67
//      closed-without-work and 9 reverse-drift lines that read the task store were byte-identical —
//      so that ONE block is redacted too (`redactLiveBranchState` below, scoped by its unique header
//      and trailer, pinned by its own unit test). stderr is NOT redacted: the report goes to stdout.
//      Honest boundary: a difference anywhere outside that block — including the empty-vs-full report
//      the silent-no-op class produces — still fails.
// A future script added with the same vulnerable guard shape (silent exit-0 no-op via the symlink
// path) is still caught automatically.
//
// Run:
//   node --experimental-strip-types --test experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The repo's ONE 按位置不按关键词 primitive (checker-lib.ts, 硬规则 2) — used by the discovery below
// so a guard MENTIONED in a comment or a doc string is not read as a guard.
import { buildNonCodeMask } from '../../../plugin/scripts/checker-lib.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'scripts');
const PLUGIN_SCRIPTS_DIR = path.join(REPO_ROOT, 'plugin', 'scripts');

// ── Discover: every symlink in SCRIPTS_DIR whose realpath is a .ts file under PLUGIN_SCRIPTS_DIR
// AND whose source CALLS a CLI entrypoint guard (isDirectEntry/isDirectInvocation) — this is
// the exact defect class (a guard that never fires via the symlink path), so a symlinked PURE
// LIBRARY module with no such guard (e.g. read-probe-spec.ts, confirmed by direct read to export
// functions with no main()/guard at all) is correctly out of scope, not a false negative. ────────
// The gate-script-base isDirectEntry form is now `isDirectEntry(import.meta, undefined, "<name>")`
// (bundler-friendly expectedBase arg, gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-
// the-artifact) — match the `import.meta` prefix so BOTH the 2-arg and 3-arg forms are discovered.
// ⛔ The match runs on a NON-CODE-MASKED copy of the source (checker-lib's buildNonCodeMask), not on
// the raw text: a bare regex over the raw file matched `gate-script-base.ts` — the module that
// DEFINES isDirectEntry — purely because its header comment quotes the retired
// "`isDirectEntry(import.meta)`" form. That file is a pure library with no CLI block, so its no-args
// invocation is legitimately silent and the "non-silent" assertion below was a FALSE RED on it (live
// 2026-09-19, found by gap-arch-duplicate-copies-zero once the conversion made the file discoverable
// at all). Masking is the same judgment the header's own read-probe-spec.ts exclusion makes by hand.
const GUARD_PATTERN = /isDirectEntry\(import\.meta|isDirectInvocation\(/;
function maskedSource(src) {
  const mask = buildNonCodeMask(src);
  let out = '';
  for (let i = 0; i < src.length; i++) out += mask[i] ? ' ' : src[i];
  return out;
}
const hasGuardAtCodePosition = (src) => GUARD_PATTERN.test(maskedSource(src));
function discoverMirroredTsSymlinks() {
  const found = [];
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    const symlinkPath = path.join(SCRIPTS_DIR, name);
    let stat;
    try { stat = fs.lstatSync(symlinkPath); } catch { continue; }
    if (!stat.isSymbolicLink()) continue;
    let real;
    try { real = fs.realpathSync(symlinkPath); } catch { continue; }
    if (!real.endsWith('.ts')) continue;
    if (!real.startsWith(PLUGIN_SCRIPTS_DIR + path.sep)) continue;
    let source;
    try { source = fs.readFileSync(real, 'utf8'); } catch { continue; }
    if (!hasGuardAtCodePosition(source)) continue;
    found.push({ name, symlinkPath, realPath: real });
  }
  return found;
}

// `--no-warnings` suppresses Node's own MODULE_TYPELESS_PACKAGE_JSON warning, which is unrelated
// to the isDirectEntry() logic under test and (confirmed live) appears non-deterministically
// across separately-spawned child processes under node:test's own runner — without this flag the
// symlink-vs-real stderr comparison below is flaky on noise, not on the real behavior.
function runNoArgs(scriptPath) {
  try {
    const stdout = execFileSync('node', ['--no-warnings', '--experimental-strip-types', scriptPath], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { stdout, stderr: '', status: 0 };
  } catch (e) {
    return { stdout: e.stdout ? e.stdout.toString() : '', stderr: e.stderr ? e.stderr.toString() : '', status: typeof e.status === 'number' ? e.status : 1 };
  }
}

// AC2: clock-field normalization. `Date.now()` (and other `\d{13}` ms-epoch values such as
// milestone-worktree's `nowMs`) legitimately differ between two separately-spawned invocations
// milliseconds apart, so byte-equality on the RAW output cannot hold for scripts that emit them.
// Redact every 13-digit run on BOTH sides before comparing. Deliberately general per the task
// (`\d{13}`-shaped clock fields) and safe in the current population (only `nowMs` matches).
// Honest boundary (ADR-review-1): a NON-clock 13-digit difference would also be redacted — a
// speculative future script emitting one would get a false negative; every difference OUTSIDE a
// 13-digit run is preserved and still fails (proven by the AC2 unit test below).
function redactClockFields(s) {
  return s.replace(/\d{13}/g, '<CLOCK>');
}

// AC2 (live-state): `task-status-drift-check.ts` is a REPORT-ONLY tool whose no-args path IS its
// default run, and what it reports is the repo's CURRENT branch state. Two invocations seconds apart
// on the live loop therefore do NOT necessarily see the same repo: a fan-in can merge a task branch,
// and a new one can be created or advanced, in that window — and those are precisely the lines the
// STRANDED block prints.
//
// Measured (2026-09-20, gap-version-stamp-generator-and-build-wiring — a task whose own delta touches
// no branch, no worktree and no task-store code): two invocations of the script MINUTES apart differed
// on exactly ONE line — `stranded: task/gap-ac271-… (has-commits, 4 commit(s) ahead, …)` had become
// `stranded: task/gap-ac272-… (has-commits, 1 commit(s) ahead, …)` after the first branch was merged
// by the loop — while the 67 closed-without-work and 9 reverse-drift lines, which read the task store,
// were byte-identical. Two invocations BACK-TO-BACK on a quiet repo are byte-identical. So the
// divergence is live branch state, not an invocation-path difference, and it is redacted here exactly
// as clock fields are above.
// Honest boundary (ADR-review-1): the redaction is scoped to that ONE block, anchored on its unique
// header (`^task-status-drift: N STRANDED branch(es)`) and trailer (`^  → human review: merge or
// adjudicate`). Every difference outside it — including the empty-vs-full report that the silent-no-op
// defect class produces — still fails, and the unit test below pins that boundary.
function redactLiveBranchState(s) {
  return s.replace(
    /^task-status-drift: \d+ STRANDED branch\(es\)[\s\S]*?^  → human review: merge or adjudicate[^\n]*\n/gm,
    '<LIVE-BRANCH-STATE>\n'
  );
}

// AC1 + AC4: the no-args signature a guard-firing symlinked CLI must present. A silent no-op
// (exit 0, zero output) is THE defect class this file exists to catch. Output is mandatory for any
// exit code; an exit-0 path is legitimate when it says something on STDOUT — either a deliberate
// "Usage:" block (the report-tool contract, e.g. fast-mode-telemetry's B2-1 no-args usage listing)
// OR a report, for a tool whose no-args path IS its default run and which is report-only by design
// (task-status-drift-check.ts: `return 0; // ALWAYS 0 — report-only, never a gate`; its no-args form
// is a production interface — the loop ticks call it exactly that way). An exit-0 path that printed
// only to STDERR, or nothing, is still rejected as indistinguishable from a silent no-op. See the
// header comment for the honest boundary: exit-0 proof is output-based (ADR-review-1).
function assertLegitimateNoArgsSignature(name, { status, stdout, stderr }) {
  const hasOutput = stdout.trim().length > 0 || stderr.trim().length > 0;
  assert.ok(hasOutput, `${name}: symlink-path invocation produced no output at all — guard did not fire (silent no-op, the original defect)`);
  if (status === 0) {
    assert.ok(stdout.trim().length > 0, `${name}: exited 0 with no args but printed nothing on stdout — indistinguishable from a silent no-op (guard did not fire)`);
  }
}

const discovered = discoverMirroredTsSymlinks();

test('discovers at least the 5 known-affected symlinked scripts (sanity check on the discovery mechanism itself)', () => {
  const names = discovered.map((d) => d.name).sort();
  for (const expected of ['touches-orthogonality-check.ts', 'anti-drift-touches-check.ts', 'routine-file-gate.ts', 'routine-scheduler.ts', 'serial-fanin-absorb.ts']) {
    assert.ok(names.includes(expected), `discovery missed ${expected} — found: ${names.join(', ')}`);
  }
});

for (const { name, symlinkPath, realPath } of discovered) {
  test(`[${name}] symlink-path invocation is non-silent (guard fired and produced output) — the exact failure mode this task closes`, () => {
    // Most target scripts require args and print "Usage:" to stderr and exit 2; config-wiring-
    // check.ts and drivable-workspace-check.ts run a real default check, exit 1, and report via
    // stderr; fast-mode-telemetry.ts is a report tool whose no-args path prints a "Usage:" block to
    // stdout and exits 0 (B2-1). All are legitimate "non-silent" signatures under
    // assertLegitimateNoArgsSignature — the decisive signal is "the guard fired and produced
    // output", NOT a single mandated exit code. The stdout/stderr/exit-code EQUALITY test below is
    // the stronger, stream-specific proof that the fix works identically via both invocation paths.
    assertLegitimateNoArgsSignature(name, runNoArgs(symlinkPath));
  });

  test(`[${name}] symlink-path and real-path invocations produce identical stdout/stderr/exit code (modulo clock fields)`, () => {
    const viaSymlink = runNoArgs(symlinkPath);
    const viaReal = runNoArgs(realPath);
    assert.equal(viaSymlink.status, viaReal.status, `${name}: exit code differs (symlink=${viaSymlink.status}, real=${viaReal.status})`);
    // AC2: redact `\d{13}` clock fields on BOTH sides so a script that embeds Date.now() (e.g.
    // milestone-worktree's `nowMs`) can still be proven identical via both invocation paths. Any
    // NON-clock difference OUTSIDE a 13-digit run in stdout/stderr still fails the assertion below.
    // AC2 (live-state): stdout additionally redacts the one block a report-only tool cannot hold still
    // — the branch-state STRANDED block — see redactLiveBranchState above for the measurement. stderr
    // is NOT redacted: the branch-state report goes to stdout, so redacting stderr would only weaken
    // the comparison.
    assert.equal(
      redactLiveBranchState(redactClockFields(viaSymlink.stdout)),
      redactLiveBranchState(redactClockFields(viaReal.stdout)),
      `${name}: stdout differs between symlink and real invocation`
    );
    assert.equal(redactClockFields(viaSymlink.stderr), redactClockFields(viaReal.stderr), `${name}: stderr differs between symlink and real invocation`);
  });
}

// AC2 support proof: clock-field redaction changes ONLY `\d{13}` values — a NON-clock difference
// OUTSIDE a 13-digit run between two outputs still fails equality, so the normalization is not a
// blanket weakening.
test('AC2: clock-field redaction preserves non-clock differences (no blanket weakening)', () => {
  assert.equal(redactClockFields('a{"nowMs":1785673919246}b'), 'a{"nowMs":<CLOCK>}b');
  assert.notEqual(redactClockFields('{"code":"missing-workspace"}'), redactClockFields('{"code":"missing-milestone"}'));
  assert.notEqual(redactClockFields('real-error'), redactClockFields('symlink-error'));
});

// AC2 (live-state) support proof: the branch-state redaction is SCOPED to the STRANDED block, so it
// cannot become a blanket weakening. A difference inside that block is swallowed (that is the point);
// a difference anywhere else, or an empty report, or a report missing the block entirely, still fails.
test('AC2: live-branch-state redaction is scoped to the STRANDED block', () => {
  const store = (id) => `task-status-drift: 1 CLOSED-without-work suspect(s) — …\n  closed-without-work: ${id} (status done)\n`;
  const stranded = (n, branch) =>
    `task-status-drift: ${n} STRANDED branch(es) — …\n  stranded: ${branch} (has-commits, 1 commit(s) ahead)\n  → human review: merge or adjudicate the branch; …\n`;
  // the measured divergence: the branch set moved between the two invocations ⇒ equal after redaction
  assert.equal(
    redactLiveBranchState(store('T-1') + stranded(1, 'task/a')),
    redactLiveBranchState(store('T-1') + stranded(2, 'task/b'))
  );
  // the block is actually consumed (a no-op predicate would pass the line above for the wrong reason)
  const redacted = redactLiveBranchState(store('T-1') + stranded(1, 'task/a'));
  assert.ok(redacted.includes('<LIVE-BRANCH-STATE>'), 'the block must be replaced by its marker');
  assert.ok(!redacted.includes('stranded:'), 'no stranded line may survive the redaction');
  assert.ok(redacted.includes('closed-without-work: T-1'), 'the task-store block must survive untouched');
  // a difference OUTSIDE the block still fails equality
  assert.notEqual(
    redactLiveBranchState(store('T-1') + stranded(1, 'task/a')),
    redactLiveBranchState(store('T-2') + stranded(1, 'task/a'))
  );
  // …and so does the defect class this file exists for: an empty report vs a full one
  assert.notEqual(redactLiveBranchState(''), redactLiveBranchState(store('T-1') + stranded(1, 'task/a')));
  // a block whose trailer is missing is NOT swallowed (strict comparison kept — the safe direction)
  assert.ok(
    redactLiveBranchState(store('T-1') + 'task-status-drift: 1 STRANDED branch(es) — …\n').includes('STRANDED branch(es)')
  );
});

// AC4 proof: the guard-never-fires defect class (exit 0 with zero output) STILL fails loudly, and
// exit 0 with arbitrary non-usage output is equally rejected (indistinguishable from a silent
// no-op). Only a deliberate "Usage:" block on stdout legitimizes an exit-0 no-args path. Honest
// boundary (ADR-review-1): the exit-0 proof is output-based, so an exit-0 script that printed
// "Usage:" from top-level code OUTSIDE the guard with byte-identical output via both paths would
// pass — that unusual shape is the task-sanctioned trade-off for admitting fast-mode-telemetry;
// the historical silent-no-op (exit 0, zero output) is the class that fails loudly here.
test('AC4: the silent no-op defect class (exit 0, no output) still fails loudly', () => {
  assert.throws(
    () => assertLegitimateNoArgsSignature('synthetic-silent.ts', { status: 0, stdout: '', stderr: '' }),
    /produced no output at all/,
  );
  // The exit-0 clause was widened 2026-09-19 (report-only tools): stdout output at exit 0 is now
  // admitted whether it is an interface listing or a report, so a stray "some noise" on stdout is
  // no longer caught HERE. Declared honestly (header + the assertion's own comment): the exit-0
  // proof is output-based. What the clause still catches — the residual defect shape — is an exit-0
  // path that said NOTHING on stdout (a silent no-op that happens to write to stderr):
  assert.throws(
    () => assertLegitimateNoArgsSignature('synthetic-stderr-only.ts', { status: 0, stdout: '', stderr: 'some noise' }),
    /printed nothing on stdout/,
  );
  // Sanity: the legitimate exit-0 shapes (usage listing / report-only default run) and a nonzero-exit
  // signature all pass.
  assert.doesNotThrow(() => assertLegitimateNoArgsSignature('synthetic-usage.ts', { status: 0, stdout: 'fast-mode-telemetry.ts\nUsage:\n  ...', stderr: '' }));
  assert.doesNotThrow(() => assertLegitimateNoArgsSignature('synthetic-report-only.ts', { status: 0, stdout: 'task-status-drift: 3 CLOSED-without-work suspect(s)\n', stderr: '' }));
  assert.doesNotThrow(() => assertLegitimateNoArgsSignature('synthetic-argreq.ts', { status: 2, stdout: '', stderr: 'Usage: foo.ts <bar>' }));
});
