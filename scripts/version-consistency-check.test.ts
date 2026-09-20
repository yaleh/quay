/**
 * version-consistency-check.test — TDD tests for version-consistency-check.ts
 *
 * Run: node --experimental-strip-types --test scripts/version-consistency-check.test.ts
 *
 * ── THE JUDGMENT CHANGED (tasks/gap-version-single-source-root-file-and-resolver, 2026-09-20) ────
 * Was: `every carrier carries the identical version string` (internal consistency).
 * Is:  `every carrier == resolveVersion(VERSION, 'tracked')` (single source).
 * So EVERY fixture below must now carry a `VERSION` file as well as the 11 carriers: a fixture with
 * no source is not a "green tree with a missing detail", it is a tree the checker cannot judge at all
 * (mode:'error') — and a test suite that kept the old fixtures would be asserting the OLD judgment.
 * The two cases under "the single source is the judgment" are the load-bearing new ones: they pin the
 * half the old judgment was structurally blind to (a uniformly stale/incorrect carrier set).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { check, readVersions, suffixPolicyOf, JUDGMENT_LABEL } from './version-consistency-check.ts';
import { readBaseVersion, DEV_SUFFIX } from './resolve-version.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const scriptPath = resolve(__dirname, 'version-consistency-check.ts');

interface FixtureOpts {
  /**
   * Body written to `VERSION`. `null` ⇒ write NO VERSION file (the unjudgeable-tree case).
   * Default: the common carrier version with any `-dev` suffix stripped — i.e. the fixture is
   * self-consistent with the new judgment unless a case says otherwise.
   */
  versionFile?: string | null;
}

function makeFixture(name: string, versions: Record<string, string>, opts: FixtureOpts = {}): string {
  // Fixtures live OUTSIDE the checked-in tree. `checked-in-write-check.ts` interposes on the fs
  // write verbs and judges the RESOLVED TARGET PATH: a test must not create or delete entries under
  // a checked-in path (the repository tree is simultaneously another test's/tool's INPUT — a copier
  // that already readdir'd it then fails stat on an entry removed in between). The earlier
  // `resolve(repoRoot, 'test/fixtures/…')` form was a live violation: 184 checked-in writes in one
  // run. os.tmpdir() is process-private and exempt by construction, and mkdtemp gives each call its
  // own directory so parallel runs cannot collide.
  const tmp = mkdtempSync(join(tmpdir(), `version-consistency-${name}-`));
  const dirs = new Set<string>();
  for (const p of Object.keys(versions)) {
    dirs.add(resolve(tmp, dirname(p)));
  }
  for (const d of dirs) mkdirSync(d, { recursive: true });
  for (const [p, v] of Object.entries(versions)) {
    const full = resolve(tmp, p);
    if (p === 'plugin/README.md') {
      // Prose carrier — the fixture MUST carry a parseable `quay plugin v<semver>` sentence, or the
      // README entry lands in mode:'error' and every GREEN assertion below becomes a false red.
      writeFileSync(full, `# quay plugin\n\nquay plugin v${v} — test fixture.\n`);
    } else if (p === 'plugin/VERSION') {
      // Plain-text stamp — same trap as the README: a fixture that does not write it leaves the entry
      // in mode:'error', turning every GREEN assertion below into a false red (hard rule 3b).
      writeFileSync(full, `${v}\n`);
    } else if (p.includes('marketplace.json')) {
      writeFileSync(full, JSON.stringify([{ name: 'quay', version: v }], null, 2));
    } else if (p === 'plugin/.claude-plugin/plugin.json') {
      writeFileSync(full, JSON.stringify({ version: v }, null, 2));
    } else if (p === 'delivery-manifest.json') {
      // Version-bearing JSON field like the package.json files, but its own fixture branch keeps the
      // shape honest (a `$schema` + `artifacts` body, not a package.json stand-in).
      writeFileSync(full, JSON.stringify({ $schema: 'delivery-manifest-v1', version: v, artifacts: { 'npm-tarballs': [] } }, null, 2));
    } else {
      // package.json
      const name = p.split('/').slice(-2, -1)[0] || 'unknown';
      writeFileSync(full, JSON.stringify({ name, version: v }, null, 2));
    }
  }
  // The SINGLE SOURCE. `null` means "this tree has no VERSION" — the unjudgeable case.
  const written = opts.versionFile !== undefined ? opts.versionFile : (versions[ALL_PATHS[0]] ?? '').replace(/-dev$/, '');
  if (written !== null) writeFileSync(resolve(tmp, 'VERSION'), `${written}\n`);
  return tmp;
}

/** A fixture whose 11 carriers all carry `carrierVersion`, with `VERSION` holding `base`. */
function consistentFixture(name: string, base: string, carrierVersion = `${base}${DEV_SUFFIX}`): string {
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = carrierVersion;
  return makeFixture(name, versions, { versionFile: base });
}

const ALL_PATHS = [
  'packages/quay/package.json',
  'packages/quay-native/package.json',
  'packages/quay-github/package.json',
  'packages/quay-backlog/package.json',
  'plugin/.claude-plugin/plugin.json',
  'plugin/README.md',
  'plugin/.claude-plugin/marketplace.json',
  '.claude-plugin/marketplace.json',
  'plugin/vendor/quay/package.json',
  'plugin/VERSION',
  'delivery-manifest.json',
];

// ── Unit tests ──────────────────────────────────────────────────────────

test('readVersions returns 11 entries for the real tree', () => {
  const entries = readVersions(repoRoot);
  assert.equal(entries.length, 11);
  for (const e of entries) {
    assert.ok(e.label.length > 0, `entry for ${e.path} has no label`);
  }
});

test('readVersions returns errors for missing files', () => {
  const entries = readVersions('/nonexistent/path/xyz');
  for (const e of entries) {
    assert.ok(e.error, `entry ${e.label} should have an error for nonexistent path`);
  }
});

test('check returns all-equal on the real tree, judged against the real VERSION (GREEN)', () => {
  const src = readBaseVersion(repoRoot);
  assert.ok(src.base, `this repo must carry a readable root VERSION: ${src.error ?? ''}`);
  const result = check(repoRoot);
  assert.equal(result.mode, 'all-equal');
  assert.equal(result.ok, true);
  assert.equal(result.uniqueVersions.length, 1, `expected 1 unique version, got ${result.uniqueVersions.length}: ${result.uniqueVersions.join(', ')}`);
  // The judgment is against the SOURCE, not merely against internal equality. Asserted against the
  // source read at THIS moment, so bumping VERSION does not red this test.
  assert.equal(result.sourceBase, src.base);
  assert.equal(result.expectedVersion, `${src.base}${DEV_SUFFIX}`);
  assert.equal(result.uniqueVersions[0], result.expectedVersion);
});

// ── The single source IS the judgment (the half the old judgment could not see) ──────────────
// Both cases below were GREEN under the old "carriers agree with each other" rule. Without them,
// "the judgment was changed to ==resolveVersion(...)" and "the judgment is still all-equal" are
// indistinguishable (hard rule 4: a criterion that cannot take the false value is not a measurement).

test('check reddens a UNIFORMLY STALE tree — carriers agree with each other, none with the source', () => {
  const tmp = consistentFixture('uniformly-stale', '9.9.9', '0.5.0-dev');
  try {
    const result = check(tmp);
    assert.equal(result.ok, false, 'a carrier set that equals itself but not the source must be RED');
    assert.equal(result.mode, 'drift');
    assert.equal(result.uniqueVersions.length, 1, 'internal consistency is exactly what is NOT being judged');
    assert.equal(result.uniqueVersions[0], '0.5.0-dev');
    assert.equal(result.expectedVersion, '9.9.9-dev');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check reddens a UNIFORMLY BARE tree when the source says -dev', () => {
  const tmp = consistentFixture('uniformly-bare', '9.9.9', '9.9.9');
  try {
    const result = check(tmp);
    assert.equal(result.ok, false, 'a uniformly de-suffixed tree is not the tracked form');
    assert.equal(result.mode, 'drift');
    assert.equal(result.suffixPolicy, 'all-bare');
    assert.equal(result.expectedVersion, '9.9.9-dev');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check is GREEN when every carrier == resolveVersion(VERSION,"tracked")', () => {
  const tmp = consistentFixture('consistent', '9.9.9');
  try {
    const result = check(tmp);
    assert.equal(result.mode, 'all-equal');
    assert.equal(result.ok, true);
    assert.deepEqual(result.uniqueVersions, ['9.9.9-dev']);
    assert.equal(result.expectedVersion, '9.9.9-dev');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── An unreadable/missing SOURCE is mode:'error', never a verdict ────────────────────────────
// (AC5's unit half: the checker must be readable of the production carrier, and when it cannot read
// it, it must not answer "consistent".)

test('check returns mode=error when VERSION is MISSING (no source ⇒ no verdict)', () => {
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = '9.9.9-dev';
  const tmp = makeFixture('no-source', versions, { versionFile: null });
  try {
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    assert.ok(result.sourceError, 'a missing VERSION must be named');
    assert.equal(result.expectedVersion, '', 'no source ⇒ no expected value (not an empty version)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check returns mode=error when VERSION is malformed (suffixed / not a semver)', () => {
  const tmp = consistentFixture('malformed-source', '9.9.9-dev');
  try {
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    assert.ok(result.sourceError);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Carrier drift ───────────────────────────────────────────────────────────────────────────

test('check detects single-entry drift (RED after one drift)', () => {
  const tmp = consistentFixture('drifted', '9.9.9');
  try {
    writeFileSync(resolve(tmp, 'plugin/vendor/quay/package.json'), JSON.stringify({ name: 'quay', version: '0.0.1' }, null, 2));
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    const drifted = result.entries.find((e: any) => e.path === 'plugin/vendor/quay/package.json');
    assert.ok(drifted);
    assert.equal(drifted.version, '0.0.1');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── README-only paths (gap-ac169-readme-version-not-in-version-consistency-set) ─────────────
// The pre-existing cases above only mutate a JSON machine field. Without these two, "the README
// entry was added" and "the README entry actually judges" are indistinguishable (hard rule 4:
// a criterion that cannot take the false value is not a measurement).

test('check detects drift when ONLY plugin/README.md moves (RED)', () => {
  const tmp = consistentFixture('readme-drift', '9.9.9');
  try {
    writeFileSync(resolve(tmp, 'plugin/README.md'), '# quay plugin\n\nquay plugin v9.9.8-dev — test fixture.\n');
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    const drifted = result.entries.find((e: any) => e.path === 'plugin/README.md');
    assert.ok(drifted, 'README entry must be in the checked set');
    assert.equal(drifted.version, '9.9.8-dev');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check returns mode=error (NOT all-equal) when README has no parseable version line', () => {
  const tmp = consistentFixture('readme-unparseable', '9.9.9');
  try {
    // A README that CANNOT be read must not be shaped like a README that agrees.
    writeFileSync(resolve(tmp, 'plugin/README.md'), '# quay plugin\n\nNo version sentence here.\n');
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    const e = result.entries.find((x: any) => x.path === 'plugin/README.md');
    assert.ok(e?.error, 'the unparseable README must carry an error');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── plugin/VERSION-only paths (gap-ac259-version-union-lockstep-and-host-install-readings) ──
// Same discipline as the README pair above, for the other non-JSON member of the union. Without these
// two, "plugin/VERSION was added to VERSION_ENTRIES" and "plugin/VERSION actually participates in the
// judgment" are indistinguishable (hard rule 4) — and the file's absence from this set is precisely
// how 6bf000622 shipped a green checker with plugin/VERSION left at 0.5.0.

test('check detects drift when ONLY plugin/VERSION moves (RED)', () => {
  const tmp = consistentFixture('version-stamp-drift', '9.9.9');
  try {
    writeFileSync(resolve(tmp, 'plugin/VERSION'), '9.9.8-dev\n');
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    const drifted = result.entries.find((e: any) => e.path === 'plugin/VERSION');
    assert.ok(drifted, 'plugin/VERSION entry must be in the checked set');
    assert.equal(drifted.version, '9.9.8-dev');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check returns mode=error (NOT all-equal) when plugin/VERSION holds no semver', () => {
  const tmp = consistentFixture('version-stamp-unparseable', '9.9.9');
  try {
    // A stamp that CANNOT be read must not be shaped like a stamp that agrees.
    writeFileSync(resolve(tmp, 'plugin/VERSION'), 'not-a-version\n');
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    const e = result.entries.find((x: any) => x.path === 'plugin/VERSION');
    assert.ok(e?.error, 'the unparseable stamp must carry an error');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── -dev suffix discipline (SPEC §4.3 option ii; gap-develop-version-union-missing-dev-suffix) ──
// Hard rule 4: "the union is all-or-none" is only a measurement if it can take the FALSE value.
// The GREEN half is not enough on its own — a checker that never reddens looks exactly like one
// that judges (hard rule 3b), so a mixed-suffix case is pinned here alongside the uniform one.

test('check keeps the README suffix verbatim on a uniformly -dev-suffixed fixture (GREEN)', () => {
  const tmp = consistentFixture('suffixed-unified', '9.9.9');
  try {
    const result = check(tmp);
    // The README entry is the one that goes wrong here if its capture group does not span the
    // suffix: with the old regex `/^quay plugin v(\d+\.\d+\.\d+)\b/m` this fixture reads the
    // README as bare `9.9.9` ⇒ mode:'drift'. So this assertion is falsifiable by construction.
    assert.equal(result.mode, 'all-equal');
    assert.equal(result.ok, true);
    assert.deepEqual(result.uniqueVersions, ['9.9.9-dev']);
    assert.equal(result.suffixPolicy, 'all-suffixed');
    const readme = result.entries.find((e: any) => e.path === 'plugin/README.md');
    assert.equal(readme?.version, '9.9.9-dev', 'README extractor must carry the -dev suffix through verbatim');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check reddens a HALF-applied -dev bump and names both forms (RED)', () => {
  const tmp = consistentFixture('suffix-mixed', '9.9.9');
  try {
    writeFileSync(resolve(tmp, 'plugin/VERSION'), '9.9.9\n'); // ONE member left bare — the half-bump AC-272 is about
    const result = check(tmp);
    assert.equal(result.ok, false);
    assert.equal(result.mode, 'drift');
    assert.equal(result.suffixPolicy, 'mixed');
    assert.deepEqual([...result.uniqueVersions].sort(), ['9.9.9', '9.9.9-dev']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── delivery-manifest.json-only paths (gap-release-cut-via-workflow-dispatch) ────────────────
// Same discipline as the README and plugin/VERSION pairs above. This file was the ONE remaining
// version-bearing member outside the set, and it drifted exactly as they did (0.4.0 -> 0.5.0 at
// 08e8ec55f, then left at 0.5.0 through the 0.6.x/0.7.x bumps) — invisible here, fatal on the release
// path, where delivery-manifest-check.ts exact-matches `quay-sea-${manifest.version}-${platform}`
// against the assets a run really published. Without these two, "the entry was added" and "the entry
// actually judges" are indistinguishable (hard rule 4).

test('check detects drift when ONLY delivery-manifest.json moves (RED)', () => {
  const tmp = consistentFixture('delivery-manifest-drift', '9.9.9');
  try {
    writeFileSync(resolve(tmp, 'delivery-manifest.json'), JSON.stringify({ $schema: 'delivery-manifest-v1', version: '9.9.8-dev' }, null, 2));
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    const drifted = result.entries.find((e: any) => e.path === 'delivery-manifest.json');
    assert.ok(drifted, 'delivery-manifest.json entry must be in the checked set');
    assert.equal(drifted.version, '9.9.8-dev');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('suffixPolicyOf is three-state: all-bare is NOT mixed, unreadable is NOT a policy', () => {
  assert.equal(suffixPolicyOf(['1.0.0', '2.0.0']), 'all-bare');
  assert.equal(suffixPolicyOf(['1.0.0-dev', '2.0.0-dev']), 'all-suffixed');
  assert.equal(suffixPolicyOf(['1.0.0-dev', '2.0.0']), 'mixed');
  // An empty read is NOT-EVALUATED, never 'all-bare' (hard rule 3b: "could not read" must not wear
  // the same value as "read and it was fine").
  assert.equal(suffixPolicyOf([]), 'not-evaluated');
  // The unreadable-tree path must report not-evaluated rather than a policy.
  assert.equal(check('/nonexistent/path/xyz').suffixPolicy, 'not-evaluated');
});

test('check returns mode=error (NOT all-equal) when delivery-manifest.json holds no semver', () => {
  const tmp = consistentFixture('delivery-manifest-unparseable', '9.9.9');
  try {
    // A manifest that CANNOT be read must not be shaped like a manifest that agrees.
    writeFileSync(resolve(tmp, 'delivery-manifest.json'), JSON.stringify({ $schema: 'delivery-manifest-v1', version: 'not-a-version' }, null, 2));
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    const e = result.entries.find((x: any) => x.path === 'delivery-manifest.json');
    assert.ok(e?.error, 'the unparseable manifest must carry an error');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check handles marketplace.json with { plugins: [...] } wrapper', () => {
  const ver = '1.0.0-dev';
  const tmp = consistentFixture('plugins-wrapper', '1.0.0', ver);
  try {
    // Rewrite marketplace files with wrapper format
    const m1 = JSON.stringify({ plugins: [{ name: 'quay', version: ver }] }, null, 2);
    writeFileSync(resolve(tmp, 'plugin/.claude-plugin/marketplace.json'), m1);
    writeFileSync(resolve(tmp, '.claude-plugin/marketplace.json'), m1);
    const result = check(tmp);
    assert.equal(result.mode, 'all-equal');
    assert.equal(result.ok, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── CLI integration tests ───────────────────────────────────────────────

test('CLI --json exits 0 with JSON output even on drift', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} --json`, {
    encoding: 'utf-8',
    cwd: repoRoot,
  });
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.ok, 'boolean');
  assert.ok(Array.isArray(parsed.entries));
  assert.equal(parsed.entries.length, 11);
  assert.ok(Array.isArray(parsed.uniqueVersions));
  assert.equal(typeof parsed.expectedVersion, 'string');
  assert.equal(typeof parsed.sourceBase, 'string');
});

test('CLI exits 0 on the real tree (post-unification GREEN)', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} 2>&1`, {
    encoding: 'utf-8',
    cwd: repoRoot,
    stdio: 'pipe',
  });
  assert.ok(out.includes('VERSION-CONSISTENCY: OK'), `expected OK in output, got: ${out.slice(0, 200)}`);
});

test('CLI prints WHAT it compared — the == resolveVersion(VERSION,\'tracked\') carrier lines (AC3)', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} 2>&1`, {
    encoding: 'utf-8',
    cwd: repoRoot,
    stdio: 'pipe',
  });
  // The output must state the comparison, not just a count: a reader (and the AC) re-derives the
  // verdict from the printed carrier readings.
  assert.ok(
    out.includes(`== ${JUDGMENT_LABEL}`),
    `expected the judgment literal in the output, got: ${out.slice(0, 300)}`,
  );
  // The first three carriers' ACTUAL readings are on their own lines.
  let seen = 0;
  for (const line of out.split('\n')) {
    if (line.endsWith(`== ${JUDGMENT_LABEL}`)) seen++;
  }
  assert.ok(seen >= 3, `expected at least 3 carrier comparison lines, saw ${seen}:\n${out}`);
});

test('CLI exits non-zero on a fixture with NO VERSION (the checker reads the production carrier)', () => {
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = '1.2.3-dev';
  const tmp = makeFixture('cli-no-source', versions, { versionFile: null });
  try {
    execSync(`node --experimental-strip-types ${scriptPath} --root ${tmp}`, { encoding: 'utf-8', stdio: 'pipe' });
    assert.fail('a tree with no VERSION must not be reported consistent');
  } catch (e: any) {
    assert.notEqual(e.status, 0);
    assert.match(String(e.stdout ?? ''), /VERSION-CONSISTENCY: ERROR/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI exits 0 on a consistent fixture', () => {
  const tmp = consistentFixture('cli-green', '1.2.3');
  try {
    // Redirect stderr to stdout since the script writes to stderr
    const out = execSync(`node --experimental-strip-types ${scriptPath} --root ${tmp} 2>&1`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    assert.ok(out.includes('VERSION-CONSISTENCY: OK'), `expected OK in output, got: ${out.slice(0, 200)}`);
    assert.ok(out.includes(`== ${JUDGMENT_LABEL}`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
