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
// no arguments (every target script exits 2 with a "Usage:" line on stderr when its guard fires;
// none support `--help`; none write to stdout on the no-args path — confirmed live 2026-07-31).
// This means a future script added with the same vulnerable guard shape is caught automatically.
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
const GUARD_PATTERN = /isDirectEntry\(import\.meta\)|isDirectInvocation\(/;
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

const discovered = discoverMirroredTsSymlinks();

test('discovers at least the 5 known-affected symlinked scripts (sanity check on the discovery mechanism itself)', () => {
  const names = discovered.map((d) => d.name).sort();
  for (const expected of ['touches-orthogonality-check.ts', 'anti-drift-touches-check.ts', 'routine-file-gate.ts', 'routine-scheduler.ts', 'serial-fanin-absorb.ts']) {
    assert.ok(names.includes(expected), `discovery missed ${expected} — found: ${names.join(', ')}`);
  }
});

for (const { name, symlinkPath, realPath } of discovered) {
  test(`[${name}] symlink-path invocation is non-silent (some output, nonzero exit) — the exact failure mode this task closes`, () => {
    // Most target scripts require args and print "Usage:" to stderr with no args; config-wiring-
    // check.ts runs a real default check with no required args and reports via stdout instead —
    // both are legitimate "non-silent" signatures. The decisive signal is exit code plus SOME
    // output, not which stream carries it; the stdout/stderr/exit-code EQUALITY test below is the
    // stronger, stream-specific proof that the fix works identically via both invocation paths.
    const viaSymlink = runNoArgs(symlinkPath);
    assert.notEqual(viaSymlink.status, 0, `${name}: symlink-path invocation exited 0 with no args — guard did not fire (silent no-op, the original defect)`);
    assert.ok(viaSymlink.stdout.trim().length > 0 || viaSymlink.stderr.trim().length > 0, `${name}: symlink-path invocation produced no output at all — guard did not fire`);
  });

  test(`[${name}] symlink-path and real-path invocations produce identical stdout/stderr/exit code`, () => {
    const viaSymlink = runNoArgs(symlinkPath);
    const viaReal = runNoArgs(realPath);
    assert.equal(viaSymlink.status, viaReal.status, `${name}: exit code differs (symlink=${viaSymlink.status}, real=${viaReal.status})`);
    assert.equal(viaSymlink.stdout, viaReal.stdout, `${name}: stdout differs between symlink and real invocation`);
    assert.equal(viaSymlink.stderr, viaReal.stderr, `${name}: stderr differs between symlink and real invocation`);
  });
}
