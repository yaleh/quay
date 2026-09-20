/**
 * stamp-version.test — tests for the version GENERATOR (tasks/gap-version-stamp-generator-and-build-wiring).
 *
 * Run: node --experimental-strip-types --test scripts/stamp-version.test.ts
 *
 * ── WHAT THESE TESTS PIN ─────────────────────────────────────────────────────────────────────────
 * The generator's whole job is to make `version-consistency-check` green from `VERSION` alone. So the
 * load-bearing assertions are not about the generator's internals — they are about the PAIR:
 *   • one call after changing `VERSION` ⇒ the judge goes green (and no carrier was missed);
 *   • drifting ANY SINGLE carrier ⇒ `--check` names exactly that file (so "the carrier table is one
 *     table, shared with the judge" is measured per carrier, not asserted once).
 * The second half is the falsifiable one: a generator with a SHORTER table than the judge would still
 * pass the first half (the judge would redden on the missing carrier... unless it was missing from both).
 * Looping the drift over every carrier the JUDGE knows about, and requiring the generator to name each,
 * is what ties the two tables together (hard rule 4 — a criterion that cannot take the false value is
 * not a measurement; hard rule 3b — an entry the generator silently skips must not read as "done").
 *
 * The fixture is the REAL tree's carriers (paths come from the shared table; contents are copied),
 * not a hand-shaped stand-in: a fixture that mirrors the production shape can only prove "the generator
 * can write a fixture" (hard rule 4 推论三). Copying the real carriers means a carrier added to the
 * table but left out of the generator's reach fails HERE.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  VERSION_CARRIERS,
  carrierPaths,
  buildCarriers,
  readCarrierVersion,
} from './version-carriers.ts';
import { stamp, repoRoot, BUILD_TREE_PREFIX } from './stamp-version.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stampTs = resolve(__dirname, 'stamp-version.ts');
const stampMjs = resolve(__dirname, 'stamp-version.mjs');
const checkTs = resolve(__dirname, 'version-consistency-check.ts');

const tmpDirs: string[] = [];
test.after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** A copy of the REAL carrier tree (every table path + `VERSION`), so the fixture cannot drift from it. */
function copyRealCarrierTree(name: string): string {
  const dest = mkdtempSync(join(tmpdir(), `stamp-version-${name}-`));
  tmpDirs.push(dest);
  for (const rel of [...carrierPaths(), 'VERSION']) {
    const to = resolve(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(resolve(repoRoot, rel)));
  }
  return dest;
}

/** Run the source-form CLI (`--experimental-strip-types`) and return {status, stdout, stderr}. */
function runCli(entry: string, args: string[], opts: { node?: string[] } = {}) {
  const r = spawnSync(
    process.execPath,
    [...(opts.node ?? ['--experimental-strip-types']), entry, ...args],
    { encoding: 'utf-8', cwd: repoRoot },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ── The load-bearing pair: one call ⇒ the judge goes green ───────────────────────────────────

test('one stamp call after changing VERSION makes every carrier (and the judge) agree', () => {
  const tree = copyRealCarrierTree('tracked');
  // Start from a tree the generator has NOT touched for this value: move VERSION only, exactly as a
  // version bump does.
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  const before = runCli(checkTs, ['--root', tree]);
  assert.notEqual(before.status, 0, 'the pre-stamp tree must be RED (nothing has been stamped yet)');

  const out = runCli(stampTs, ['--root', tree]);
  assert.equal(out.status, 0, `stamp must succeed; stderr: ${out.stderr}`);

  // ALL carriers — enumerated from the shared table, not from a count in this test.
  for (const carrier of VERSION_CARRIERS) {
    const reading = readCarrierVersion(tree, carrier);
    assert.equal(reading.error, undefined, `${carrier.label}: ${reading.error}`);
    assert.equal(reading.version, '9.9.9-dev', `${carrier.label} was not stamped`);
  }
  const after = runCli(checkTs, ['--root', tree]);
  assert.equal(after.status, 0, `the judge must go GREEN after one stamp; got: ${after.stdout}\n${after.stderr}`);
  assert.match(after.stdout, /VERSION-CONSISTENCY: OK/);

  // Idempotent: a second run reports "wrote nothing" and stays green.
  const again = runCli(stampTs, ['--root', tree]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /wrote nothing/);
});

test('--check reports drift with file and before/after, and writes nothing', () => {
  const tree = copyRealCarrierTree('check');
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  const target = resolve(tree, 'packages/quay/package.json');
  const untouched = readFileSync(target, 'utf-8');

  const out = runCli(stampTs, ['--check', '--root', tree]);
  assert.equal(out.status, 1, 'drift must exit 1');
  assert.match(out.stdout, /STAMP-VERSION: DRIFT/);
  assert.match(out.stdout, /packages\/quay\/package\.json/, 'the drifting file must be named');
  assert.match(out.stdout, /-> 9\.9\.9-dev/, 'the before/after pair must be printed');
  assert.equal(readFileSync(target, 'utf-8'), untouched, '--check must not write');
});

// ── The table is ONE table: every carrier the judge knows, the generator can name ────────────

test('drifting ANY single carrier reddens --check and names THAT file (per-carrier loop)', () => {
  const tree = copyRealCarrierTree('per-carrier');
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  assert.equal(runCli(stampTs, ['--root', tree]).status, 0, 'baseline stamp must succeed');

  // Walk the JUDGE's carriers one at a time. For each: break it, require `--check` to be red AND to
  // name its file, then restore and require green. A carrier known to the judge but not to the
  // generator fails on the FIRST half; a carrier known to the generator but not the judge fails on the
  // second (the judge stays green while `--check` reports drift, which is impossible if they share one
  // table — but the assertion is made anyway, because "impossible by construction" is what a test is for).
  for (const carrier of VERSION_CARRIERS) {
    const abs = resolve(tree, carrier.path);
    const original = readFileSync(abs, 'utf-8');
    const span = carrier.locate(original);
    writeFileSync(abs, original.slice(0, span.start) + '1.1.1-dev' + original.slice(span.end));

    const drifted = runCli(stampTs, ['--check', '--root', tree]);
    assert.equal(drifted.status, 1, `${carrier.label}: drift after breaking it must exit 1`);
    assert.ok(
      drifted.stdout.includes(carrier.path),
      `${carrier.label}: --check must name ${carrier.path}; got:\n${drifted.stdout}`,
    );

    writeFileSync(abs, original);
    const restored = runCli(stampTs, ['--check', '--root', tree]);
    assert.equal(restored.status, 0, `${carrier.label}: restoring must return to green — ${restored.stdout}`);
  }
});

test('the shared table covers every carrier the JUDGE reports (same set, no divergence)', () => {
  const tree = copyRealCarrierTree('same-set');
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  assert.equal(runCli(stampTs, ['--root', tree]).status, 0);
  // The judge's own JSON output is the ground truth for "what the judge walks" — derive the paths from
  // it rather than from the table under test.
  const judged = runCli(checkTs, ['--root', tree, '--json']);
  assert.equal(judged.status, 0, judged.stderr);
  const parsed = JSON.parse(judged.stdout);
  const judgedSet = new Set(parsed.entries.map((e: any) => e.path));
  const generatorSet = new Set(carrierPaths());
  assert.deepEqual(
    [...judgedSet].sort(),
    [...generatorSet].sort(),
    'the generator and the judge must cover the same carrier FILES',
  );
  assert.equal(parsed.entries.length, VERSION_CARRIERS.length, 'entry count (package-lock contributes 4)');
});

// ── Fail-closed: an unreadable carrier aborts the WHOLE run ───────────────────────────────────

test('an unanchored carrier aborts the run and nothing is written (no partial stamp)', () => {
  const tree = copyRealCarrierTree('abort');
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  // A README with no parseable version sentence: the carrier cannot be read, so the run must not
  // stamp the other 14 either — a partially stamped tree reads as "the generator ran".
  const readme = resolve(tree, 'plugin/README.md');
  writeFileSync(readme, '# quay plugin\n\nNo version sentence here.\n');
  const pkg = resolve(tree, 'packages/quay/package.json');
  const pkgBefore = readFileSync(pkg, 'utf-8');

  const out = runCli(stampTs, ['--root', tree]);
  assert.equal(out.status, 1, `an unreadable carrier must fail the run; stdout: ${out.stdout}`);
  assert.match(out.stderr, /could not be judged; nothing was written/);
  assert.equal(readFileSync(pkg, 'utf-8'), pkgBefore, 'no carrier may be written when one is unreadable');
});

test('the readable half of the table is judged BEFORE any write (errors abort first)', () => {
  // Same shape as above, one carrier later in the table (delivery-manifest.json), to show the abort is
  // not an artifact of the README being first.
  const tree = copyRealCarrierTree('abort-late');
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  writeFileSync(resolve(tree, 'delivery-manifest.json'), '{"$schema":"delivery-manifest-v1"}\n');
  const pkg = resolve(tree, 'packages/quay/package.json');
  const pkgBefore = readFileSync(pkg, 'utf-8');
  assert.equal(runCli(stampTs, ['--root', tree]).status, 1);
  assert.equal(readFileSync(pkg, 'utf-8'), pkgBefore);
});

// ── build mode: the artifact tree, and NOT-EVALUATED ─────────────────────────────────────────

test('buildCarriers projects the table onto a plugin-rooted artifact tree', () => {
  const carriers = buildCarriers(BUILD_TREE_PREFIX);
  const paths = carriers.map((c) => c.path).sort();
  assert.deepEqual(paths, [
    '.claude-plugin/marketplace.json',
    '.claude-plugin/plugin.json',
    'README.md',
    'VERSION',
    'vendor/quay/package.json',
  ]);
  // The projection is DERIVED, so a carrier added under plugin/ appears here automatically — that is
  // the property distinguishing it from a second hand-written list.
  assert.equal(
    carriers.length,
    VERSION_CARRIERS.filter((c) => c.path.startsWith(`${BUILD_TREE_PREFIX}/`)).length,
  );
});

test('stamp writes the build form into an artifact tree (unit: no git needed)', () => {
  const tree = copyRealCarrierTree('build-write');
  // A dist/artifact tree has the PLUGIN layout at its root — stage it the way publish-dist-branch does.
  const dist = mkdtempSync(join(tmpdir(), 'stamp-version-dist-'));
  tmpDirs.push(dist);
  for (const c of buildCarriers(BUILD_TREE_PREFIX)) {
    const to = resolve(dist, c.path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(resolve(tree, `plugin/${c.path}`)));
  }
  const report = stamp({
    root: dist,
    carriers: buildCarriers(BUILD_TREE_PREFIX),
    expected: '9.9.9',
    mode: 'build',
    evaluated: true,
    reason: 'test',
    base: '9.9.9',
    write: true,
  });
  assert.equal(report.errors.length, 0);
  assert.ok(report.drift.length > 0, 'the copied carriers were -dev, so the build form must differ');
  assert.equal(readFileSync(resolve(dist, 'VERSION'), 'utf-8').trim(), '9.9.9');
  assert.equal(readFileSync(resolve(dist, 'README.md'), 'utf-8').includes('quay plugin v9.9.9 '), true);
  const pluginJson = JSON.parse(readFileSync(resolve(dist, '.claude-plugin/plugin.json'), 'utf-8'));
  assert.equal(pluginJson.version, '9.9.9');
});

test('NOT-EVALUATED writes nothing at all (build mode on an unjudgeable tree)', () => {
  const tree = copyRealCarrierTree('not-evaluated');
  const target = resolve(tree, 'packages/quay/package.json');
  const before = readFileSync(target, 'utf-8');
  const report = stamp({
    root: tree,
    carriers: VERSION_CARRIERS,
    expected: '',
    mode: 'build',
    evaluated: false,
    reason: 'detached HEAD with no version tag',
    base: '9.9.9',
    write: true,
  });
  assert.equal(report.evaluated, false);
  assert.equal(report.entries.length, 0);
  assert.equal(report.written.length, 0);
  assert.equal(readFileSync(target, 'utf-8'), before);
});

test('CLI --mode build on the real repo is judged against the real branch state', () => {
  // On any non-release branch (this worktree is on one) the build form equals the tracked form, so the
  // run is a GREEN no-op. The release/* reading is taken on a real temporary branch and recorded in the
  // task body — it cannot be faked from a unit test without also faking git.
  const out = runCli(stampTs, ['--mode', 'build', '--check']);
  if (out.status === 3) {
    // Detached HEAD with no version tag: NOT-EVALUATED is a legitimate reading of THIS tree, and the
    // point of the mode is that it says so instead of guessing `-dev`.
    assert.match(out.stderr, /NOT-EVALUATED/);
    return;
  }
  assert.equal(out.status, 0, `stderr: ${out.stderr}`);
  assert.match(out.stdout, /== 0\.10\.0-dev|already ==/);
});

// ── The Node-20-safe entry (scripts/stamp-version.mjs) forwards faithfully ───────────────────

test('stamp-version.mjs (the declared-Node-floor entry) runs the SAME implementation', () => {
  const tree = copyRealCarrierTree('mjs');
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  // No --experimental-strip-types: this entry must work on a Node that has no such flag (the declared
  // floor is `engines: >=20`, and `npx node@20 --experimental-strip-types` is literally `bad option`).
  const out = runCli(stampMjs, ['--root', tree], { node: [] });
  assert.equal(out.status, 0, `stderr: ${out.stderr}`);
  for (const carrier of VERSION_CARRIERS) {
    const r = readCarrierVersion(tree, carrier);
    assert.equal(r.version, '9.9.9-dev', `${carrier.label} not stamped through the mjs entry`);
  }
  const drifted = runCli(stampMjs, ['--check', '--root', tree], { node: [] });
  assert.equal(drifted.status, 0, 'a stamped tree must be green through the mjs entry too');
});

test('stamp-version.mjs propagates the CLI failure modes (drift ⇒ 1, usage ⇒ 2)', () => {
  const tree = copyRealCarrierTree('mjs-exit');
  // Unstamped tree with a moved VERSION ⇒ drift.
  writeFileSync(resolve(tree, 'VERSION'), '9.9.9\n');
  const drift = runCli(stampMjs, ['--check', '--root', tree], { node: [] });
  assert.equal(drift.status, 1, `expected the drift exit code through the runner; got ${drift.status}`);
  assert.match(drift.stdout, /STAMP-VERSION: DRIFT/);

  const usage = runCli(stampMjs, ['--nope'], { node: [] });
  assert.equal(usage.status, 2);
});

// ── The generator itself must not become a second source ─────────────────────────────────────

test('the runner carries no judgment of its own (it must not re-declare the version rules)', () => {
  const src = readFileSync(stampMjs, 'utf-8');
  // A second implementation in the runner would be a drift source nothing compares against the first.
  assert.ok(!/VERSION_CARRIERS|resolveVersion|carrierPaths/.test(src), 'the runner must not re-implement the table');
  assert.ok(!/plugin\/VERSION|delivery-manifest\.json|package-lock\.json/.test(src), 'the runner must not name carriers');
});

test('the carrier table is declared in exactly ONE scripts/*.ts module (AC2)', () => {
  // The literal probe the AC names, evaluated here rather than by hand: `packages/quay-backlog/package.json`
  // is a carrier path and must be spelled in exactly one non-test `scripts/*.ts` module.
  const hits: string[] = [];
  for (const f of carrierPaths()) {
    if (!f.startsWith('packages/')) continue;
    const res = spawnSync(
      'bash',
      ['-c', `grep -rln -- '${f}' scripts/*.ts | grep -v '\\.test\\.' || true`],
      { encoding: 'utf-8', cwd: repoRoot },
    );
    hits.push(...(res.stdout ?? '').split('\n').filter(Boolean));
  }
  const unique = [...new Set(hits)];
  assert.deepEqual(unique, ['scripts/version-carriers.ts'], `carrier paths must live in ONE module, got: ${unique.join(', ')}`);
  assert.ok(existsSync(resolve(repoRoot, 'scripts/version-carriers.ts')));
});
