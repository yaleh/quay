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
// no arguments. The asserted CONTRACT is deliberately uniform, but it accounts for the two
// legitimate divergences the original uniform assumption denied (confirmed live 2026-08-02,
// `gap-symlink-mirror-invocation-test-contract-mismatch`):
//   1. NON-SILENT: a guard-firing CLI must print something — exit 0 with zero output is THE defect
//      class (a guard that never fires is indistinguishable from "ran and found nothing wrong").
//      Exit codes vary legitimately across scripts: most arg-requiring scripts print "Usage:" to
//      stderr and exit 2; config-wiring-check / drivable-workspace-check run a real default check
//      and exit 1 with a report; report tools with no required args print a "Usage:" block to
//      stdout and exit 0 (fast-mode-telemetry — B2-1 contract). An exit-0 no-args path is only
//      accepted when it prints a deliberate "Usage:" block on stdout. Honest boundary
//      (ADR-review-1, task-sanctioned trade-off): the exit-0+`Usage:` proof is output-based, so a
//      script that printed "Usage:" via TOP-LEVEL code OUTSIDE the guard and exited 0 with
//      byte-identical output via both paths would also pass — the historical silent-no-op defect
//      (exit 0, ZERO output, main() never ran) is still caught loudly, which is the class this
//      test exists to guard.
//   2. EQUALITY: symlink-path and real-path stdout/stderr/exit must be byte-identical EXCEPT for
//      embedded clock fields (`\d{13}` ms-epoch values, e.g. milestone-worktree's `nowMs`) which
//      legitimately differ between two invocations milliseconds apart — these are redacted on both
//      sides before comparison. Honest boundary (ADR-review-1): the redaction is a general
//      `\d{13}`-run rule, so a NON-clock 13-digit difference would also be hidden (speculative
//      future script; none in the current population); every difference OUTSIDE a 13-digit run
//      still fails.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'experiments', 'quay-perpetual-stream', 'scripts');
const PLUGIN_SCRIPTS_DIR = path.join(REPO_ROOT, 'plugin', 'scripts');

// ── Discover: every symlink in SCRIPTS_DIR whose realpath is a .ts file under PLUGIN_SCRIPTS_DIR
// AND whose source contains a CLI entrypoint guard (isDirectEntry/isDirectInvocation) — this is
// the exact defect class (a guard that never fires via the symlink path), so a symlinked PURE
// LIBRARY module with no such guard (e.g. read-probe-spec.ts, confirmed by direct read to export
// functions with no main()/guard at all) is correctly out of scope, not a false negative. ────────
// The gate-script-base isDirectEntry form is now `isDirectEntry(import.meta, undefined, "<name>")`
// (bundler-friendly expectedBase arg, gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-
// the-artifact) — match the `import.meta` prefix so BOTH the 2-arg and 3-arg forms are discovered.
const GUARD_PATTERN = /isDirectEntry\(import\.meta|isDirectInvocation\(/;
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
    if (!GUARD_PATTERN.test(source)) continue;
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

// AC1 + AC4: the no-args signature a guard-firing symlinked CLI must present. A silent no-op
// (exit 0, zero output) is THE defect class this file exists to catch. Output is mandatory for any
// exit code; an exit-0 path is only legitimate when it prints a deliberate "Usage:" block on stdout
// (the report-tool contract, e.g. fast-mode-telemetry's B2-1 no-args usage listing) — any other
// exit-0-with-output (arbitrary non-usage noise) is rejected as indistinguishable from a silent
// no-op. See the header comment for the honest boundary: exit-0 proof is output-based (ADR-review-1).
function assertLegitimateNoArgsSignature(name, { status, stdout, stderr }) {
  const hasOutput = stdout.trim().length > 0 || stderr.trim().length > 0;
  assert.ok(hasOutput, `${name}: symlink-path invocation produced no output at all — guard did not fire (silent no-op, the original defect)`);
  if (status === 0) {
    assert.match(stdout, /Usage:/, `${name}: exited 0 with no args but printed no "Usage:" block on stdout — indistinguishable from a silent no-op (guard did not fire)`);
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
    assert.equal(redactClockFields(viaSymlink.stdout), redactClockFields(viaReal.stdout), `${name}: stdout differs between symlink and real invocation`);
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
  assert.throws(
    () => assertLegitimateNoArgsSignature('synthetic-noise.ts', { status: 0, stdout: 'some noise', stderr: '' }),
    /no "Usage:" block on stdout/,
  );
  // Sanity: the legitimate exit-0 usage signature and a nonzero-exit signature both pass.
  assert.doesNotThrow(() => assertLegitimateNoArgsSignature('synthetic-usage.ts', { status: 0, stdout: 'fast-mode-telemetry.ts\nUsage:\n  ...', stderr: '' }));
  assert.doesNotThrow(() => assertLegitimateNoArgsSignature('synthetic-argreq.ts', { status: 2, stdout: '', stderr: 'Usage: foo.ts <bar>' }));
});
