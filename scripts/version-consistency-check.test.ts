/**
 * version-consistency-check.test — TDD tests for version-consistency-check.ts
 *
 * Run: node --experimental-strip-types --test scripts/version-consistency-check.test.ts
 *
 * ── THE JUDGMENT CHANGED (tasks/gap-version-single-source-root-file-and-resolver, 2026-09-20) ────
 * Was: `every carrier carries the identical version string` (internal consistency).
 * Is:  `every carrier == resolveVersion(VERSION, 'tracked')` (single source).
 * So EVERY fixture below must now carry a `VERSION` file as well as the 15 carriers: a fixture with
 * no source is not a "green tree with a missing detail", it is a tree the checker cannot judge at all
 * (mode:'error') — and a test suite that kept the old fixtures would be asserting the OLD judgment.
 * The two cases under "the single source is the judgment" are the load-bearing new ones: they pin the
 * half the old judgment was structurally blind to (a uniformly stale/incorrect carrier set).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  check,
  readVersions,
  suffixPolicyOf,
  JUDGMENT_LABEL,
  checkBundleTree,
  stampBundleTree,
  extractEmbeddedVersion,
  readEmbeddedVersion,
} from './version-consistency-check.ts';
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
    } else if (p === 'plugin/.claude-plugin/plugin.json') {
      writeFileSync(full, JSON.stringify({ version: v }, null, 2));
    } else if (p === 'package-lock.json') {
      // npm's lockfile carries FOUR version-bearing entries (the `packages/<dir>` workspace members),
      // not one field — added to the union by
      // gap-version-stamp-generator-and-build-wiring, which had to extend BOTH this fixture and
      // plugin/scripts/checker-mutation-cases/version-consistency-check.sh: an entry the fixture does
      // not build is not "a new dimension", it is a GREEN baseline that lands in mode:'error' and makes
      // the mutation case report the checker as always-red.
      writeFileSync(
        full,
        JSON.stringify(
          {
            name: 'quay-workspace',
            version: '0.1.0',
            lockfileVersion: 3,
            requires: true,
            packages: Object.fromEntries(
              LOCK_WORKSPACE_DIRS.map((d) => [`packages/${d}`, { version: v, license: 'MIT' }]),
            ),
          },
          null,
          2,
        ),
      );
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

/** A fixture whose 13 carriers all carry `carrierVersion`, with `VERSION` holding `base`. */
function consistentFixture(name: string, base: string, carrierVersion = `${base}${DEV_SUFFIX}`): string {
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = carrierVersion;
  return makeFixture(name, versions, { versionFile: base });
}

/**
 * Every carrier ENTRY the checker judges — 13 over 10 files. Held as entries (not files) so the count
 * assertions below pin the union size the judge actually walks: `package-lock.json` contributes four.
 * (Was 15 over 12 until 2026-09-20, when the two `marketplace.json` `plugins[].version` entries left
 * the table with the field itself — see ALL_PATHS's note.)
 */
const CARRIER_ENTRY_COUNT = 13;

/** The four `package-lock.json` workspace members whose `version` is a carrier entry. */
const LOCK_WORKSPACE_DIRS = ['quay', 'quay-native', 'quay-github', 'quay-backlog'];

const ALL_PATHS = [
  'packages/quay/package.json',
  'packages/quay-native/package.json',
  'packages/quay-github/package.json',
  'packages/quay-backlog/package.json',
  'plugin/.claude-plugin/plugin.json',
  'plugin/README.md',
  // ⛔ NO marketplace.json path here (2026-09-20): the two `plugins[].version` entries left the
  // carrier table when the field itself was deleted — real installs measured under an isolated
  // `CLAUDE_CONFIG_DIR` showed the CLI never reads it (the cache key comes from the fetched plugin's
  // own `plugin.json`). A marketplace advertising `9.9.9` against a `0.10.0-dev` manifest still
  // reports `0.10.0-dev`. See scripts/version-carriers.ts's table comment for the four readings.
  'plugin/vendor/quay/package.json',
  'plugin/VERSION',
  'delivery-manifest.json',
  // FOUR carrier entries in ONE file — see makeFixture's branch and CARRIER_ENTRY_COUNT.
  'package-lock.json',
];

// ── Unit tests ──────────────────────────────────────────────────────────

test('readVersions returns 15 entries for the real tree', () => {
  const entries = readVersions(repoRoot);
  assert.equal(entries.length, CARRIER_ENTRY_COUNT);
  for (const e of entries) {
    assert.ok(e.label.length > 0, `entry for ${e.path} has no label`);
  }
  // The four package-lock entries are ENTRIES, not a single "lockfile" entry: a union that judged the
  // lockfile once would still leave three workspace members unjudged, which is the gap this extension
  // closes (the file's four `packages/<dir>` members drifted together as one hand-edit before).
  const lockEntries = entries.filter((e) => e.path === 'package-lock.json');
  assert.equal(lockEntries.length, LOCK_WORKSPACE_DIRS.length);
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

// ── package-lock.json paths (gap-version-stamp-generator-and-build-wiring) ───────────────────
// The lockfile's four workspace members were OUTSIDE this union: `version-consistency-check` never
// read the file, so a bump that updated all 11 other carriers and left `package-lock.json` stale
// passed the gate. Same discipline as the README / plugin/VERSION / delivery-manifest pairs above —
// without an ONLY-this-carrier path, "the four entries were added" and "the four entries actually
// judge" are indistinguishable (hard rule 4).

/**
 * The lock entry's label. Spelled as `version-carriers.ts` spells it — and matched EXACTLY, never by
 * `includes`: `packages/quay-backlog` is also the label of the `packages/quay-backlog/package.json`
 * carrier, so a substring match silently asserts about the wrong carrier (measured: the first version
 * of this test passed its write and still read back the package.json entry's value).
 */
function lockLabel(dir: string): string {
  return `package-lock.json (packages/${dir})`;
}

function writeLock(tmp: string, dir: string, version: string): void {
  const raw = JSON.parse(readFileSync(resolve(tmp, 'package-lock.json'), 'utf-8'));
  raw.packages[`packages/${dir}`].version = version;
  writeFileSync(resolve(tmp, 'package-lock.json'), JSON.stringify(raw, null, 2));
}

test('check detects drift when ONLY ONE package-lock workspace entry moves (RED)', () => {
  const tmp = consistentFixture('lock-drift', '9.9.9');
  try {
    writeLock(tmp, 'quay-backlog', '9.9.8-dev');
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    const drifted = result.entries.find((e: any) => e.label === lockLabel('quay-backlog'));
    assert.ok(drifted, 'the packages/quay-backlog lock entry must be in the checked set');
    assert.equal(drifted.version, '9.9.8-dev');
    // ...and its three siblings must NOT have been dragged along: a genuine per-member read, not a
    // whole-file rewrite.
    for (const d of ['quay', 'quay-native', 'quay-github']) {
      const sib = result.entries.find((e: any) => e.label === lockLabel(d));
      assert.equal(sib?.version, '9.9.9-dev', `packages/${d} must be read independently`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check returns mode=error (NOT all-equal) when a package-lock entry has no semver', () => {
  const tmp = consistentFixture('lock-unparseable', '9.9.9');
  try {
    // A lockfile entry that CANNOT be read must not be shaped like one that agrees (hard rule 3b).
    const raw = JSON.parse(readFileSync(resolve(tmp, 'package-lock.json'), 'utf-8'));
    delete raw.packages['packages/quay-github'].version;
    writeFileSync(resolve(tmp, 'package-lock.json'), JSON.stringify(raw, null, 2));
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    const e = result.entries.find((x: any) => x.label === lockLabel('quay-github'));
    assert.ok(e?.error, 'the versionless lock entry must carry an error');
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

test('a marketplace `plugins[].version` is NOT judged any more — even a divergent one stays GREEN', () => {
  // Both dialects of the file, carrying a value that deliberately DISAGREES with the source. This is
  // the negative half of gap-version-marketplace-omit-and-spec-amendment: the field used to be a
  // judged carrier (this test used to assert it was judged), and the point of its removal is that a
  // marketplace entry can no longer redden — or, worse, silently agree with — the version gate.
  // ⛔ If someone re-adds the carrier, this test reddens, which is exactly the tripwire wanted: the
  // field is read by nothing (measured, see version-carriers.ts), so re-adding it re-creates a
  // hand-written literal that drifts unobserved.
  const tmp = consistentFixture('marketplace-not-carried', '1.0.0');
  try {
    const divergent = JSON.stringify({ plugins: [{ name: 'quay', version: '9.9.9' }] }, null, 2);
    mkdirSync(resolve(tmp, 'plugin/.claude-plugin'), { recursive: true });
    mkdirSync(resolve(tmp, '.claude-plugin'), { recursive: true });
    writeFileSync(resolve(tmp, 'plugin/.claude-plugin/marketplace.json'), divergent);
    writeFileSync(resolve(tmp, '.claude-plugin/marketplace.json'), divergent);

    const result = check(tmp);
    assert.equal(result.mode, 'all-equal');
    assert.equal(result.ok, true);
    // The union must not contain a marketplace entry at all (not merely "ignore it when agreeing").
    assert.equal(
      result.entries.filter((e: any) => e.path.includes('marketplace.json')).length,
      0,
      'marketplace.json must contribute NO carrier entry',
    );
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
  assert.equal(parsed.entries.length, CARRIER_ENTRY_COUNT);
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

// ── BUILD-TREE BUNDLE AXIS (gap-release-bundle-embeds-dev-version-after-stamp) ─────────────────
//
// THE DEFECT: a release build (`release/*`, or HEAD at tag `vX.Y.Z`) stamps the tree's CARRIERS
// bare (`X.Y.Z`), but the esbuild bundle still embeds `X.Y.Z-dev` — it was inlined at build time
// from the committed `packages/quay/package.json`, which is ALWAYS `-dev`. So `quay --version`
// reports the dev form while every carrier says released, and nothing saw it (`quay-init.sh`'s
// version grep swallows the suffix — hard rule 3b: "could not read" and "fine" looked identical).
//
// These cases pin all three values of the new judgment: the release-form fixture (carriers bare,
// bundle `-dev`) MUST redden AND name `dist/quay.js`; the same fixture with the embedded version
// matching MUST go green; and an anchor-less bundle MUST be NOT-EVALUATED with an exit code
// distinct from PASS. Without the RED case the gate could never take the false value (hard rule 4).

/** A minimal but structurally-honest esbuild bundle carrying the inlined `package_default` object. */
function bundleText(version: string | null): string {
  if (version === null) return '// a bundle that carries no inlined package version\nconsole.log(1);\n';
  return (
    'var package_default;\n' +
    'var init_package = __esm({\n' +
    '  "package.json"() {\n' +
    '    package_default = {\n' +
    '      name: "quay",\n' +
    `      version: "${version}",\n` +
    '      private: true\n' +
    '    };\n' +
    '  }\n' +
    '});\n'
  );
}

interface BundleTreeOpts {
  /** `plugin.json` version; `null` ⇒ write no manifest (unjudgeable). default '0.14.0' */
  manifest?: string | null;
  /** core bundle embedded version; `null` ⇒ no anchor. default '0.14.0-dev' */
  core?: string | null;
  /** `scripts/dist/<name>.js` → embedded version; `null` ⇒ no anchor. default {} */
  scripts?: Record<string, string | null>;
}

/** A build-layout tree (`.claude-plugin/plugin.json` + `vendor/quay/dist/quay.js` + optional scripts). */
function makeBundleTree(name: string, opts: BundleTreeOpts = {}): string {
  // Outside the checked-in tree: `checked-in-write-check.ts` judges the RESOLVED target path, so a
  // fixture must not create/delete entries under a checked-in path (see makeFixture's note above).
  const tmp = mkdtempSync(join(tmpdir(), `bundle-tree-${name}-`));
  const manifest = opts.manifest === undefined ? '0.14.0' : opts.manifest;
  const core = opts.core === undefined ? '0.14.0-dev' : opts.core;
  mkdirSync(resolve(tmp, 'vendor/quay/dist'), { recursive: true });
  if (manifest !== null) {
    mkdirSync(resolve(tmp, '.claude-plugin'), { recursive: true });
    writeFileSync(resolve(tmp, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'quay', version: manifest }, null, 2));
  }
  writeFileSync(resolve(tmp, 'vendor/quay/dist/quay.js'), bundleText(core));
  const scripts = opts.scripts ?? {};
  if (Object.keys(scripts).length > 0) {
    mkdirSync(resolve(tmp, 'scripts/dist'), { recursive: true });
    for (const [n, v] of Object.entries(scripts)) writeFileSync(resolve(tmp, `scripts/dist/${n}`), bundleText(v));
  }
  return tmp;
}

test('extractEmbeddedVersion reads the inlined package_default.version, not any other version token', () => {
  // The real bundle carries ~10 unrelated `version: "…"` tokens from vendored libs; an unanchored
  // match would pick the wrong one. This pins the anchoring.
  const raw = bundleText('0.14.0-dev') + 'var other = { version: "9.9.9" };\n';
  assert.equal(extractEmbeddedVersion(raw), '0.14.0-dev');
  assert.equal(extractEmbeddedVersion('// no anchor\n'), null);
});

test('[AC1] bundle gate REDDENS a release-form tree whose bundle still embeds -dev, and NAMES dist/quay.js', () => {
  const tmp = makeBundleTree('drift');
  try {
    const r = checkBundleTree(tmp);
    assert.equal(r.ok, false);
    assert.equal(r.mode, 'drift');
    assert.equal(r.expected, '0.14.0');
    const core = r.entries.find((e) => e.path.endsWith('dist/quay.js'));
    assert.ok(core, 'the Core bundle must be in the checked set');
    assert.equal(core?.version, '0.14.0-dev');
    // ...and the CLI names it (the AC's "点名 dist/quay.js").
    let status = 0;
    let out = '';
    try {
      execSync(`node --experimental-strip-types ${scriptPath} --bundle-tree ${tmp} 2>&1`, {
        encoding: 'utf-8',
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (e: any) {
      status = e.status;
      out = String(e.stdout ?? '');
    }
    assert.notEqual(status, 0, 'the gate must exit non-zero on a stale embedded version');
    assert.match(out, /BUNDLE-EMBEDDED: DRIFT DETECTED/);
    assert.ok(out.includes('dist/quay.js'), `output must name dist/quay.js:\n${out}`);
    assert.ok(out.includes('0.14.0-dev'), `output must name the stale version:\n${out}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('[AC2] bundle gate is GREEN once the embedded version matches plugin.json', () => {
  const tmp = makeBundleTree('consistent', { core: '0.14.0' });
  try {
    const r = checkBundleTree(tmp);
    assert.equal(r.mode, 'consistent');
    assert.equal(r.ok, true);
    const out = execSync(`node --experimental-strip-types ${scriptPath} --bundle-tree ${tmp} 2>&1`, {
      encoding: 'utf-8',
      cwd: repoRoot,
      stdio: 'pipe',
    });
    assert.ok(out.includes('BUNDLE-EMBEDDED: OK'), out.slice(0, 200));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('[AC2] an anchor-less bundle is NOT-EVALUATED with an exit code distinct from PASS', () => {
  const tmp = makeBundleTree('no-anchor', { core: null });
  try {
    const r = checkBundleTree(tmp);
    assert.equal(r.mode, 'not-evaluated');
    assert.equal(r.ok, false);
    const core = r.entries.find((e) => e.path.endsWith('dist/quay.js'));
    assert.ok(core?.error, 'the anchor-less core bundle must carry an error');
    // The exit code is what a build script keys on: neither 0 (pass) nor 1 (drift) may be reused.
    let status = 0;
    let out = '';
    try {
      execSync(`node --experimental-strip-types ${scriptPath} --bundle-tree ${tmp} 2>&1`, {
        encoding: 'utf-8',
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (e: any) {
      status = e.status;
      out = String(e.stdout ?? '');
    }
    assert.equal(status, 3, `an unevaluable bundle must exit 3, got ${status}`);
    assert.ok(out.includes('NOT-EVALUATED'), out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a script bundle under scripts/dist that embeds a stale version reddens (anchor-less siblings are skipped)', () => {
  const tmp = makeBundleTree('scripts', {
    core: '0.14.0',
    scripts: { 'send-to-session.js': '0.14.0-dev', 'plain.js': null },
  });
  try {
    const r = checkBundleTree(tmp);
    assert.equal(r.mode, 'drift');
    assert.equal(r.scriptsScanned, 2);
    assert.equal(r.scriptsEmbedded, 1, 'only the bundle that carries a version is embedded');
    const script = r.entries.find((e) => e.path === 'scripts/dist/send-to-session.js');
    assert.equal(script?.version, '0.14.0-dev');
    assert.ok(!r.entries.some((e) => e.path === 'scripts/dist/plain.js'), 'an anchor-less script is not judged');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('[AC4-(b)] stampBundleTree re-derives the embedded version(s) and the gate then passes', () => {
  const tmp = makeBundleTree('restamp', {
    manifest: '0.15.0',
    core: '0.14.0-dev',
    scripts: { 'send-to-session.js': '0.14.0-dev' },
  });
  try {
    assert.equal(checkBundleTree(tmp).mode, 'drift');
    const stamped = stampBundleTree(tmp);
    assert.deepEqual(stamped.errors, []);
    assert.deepEqual([...stamped.written].sort(), ['scripts/dist/send-to-session.js', 'vendor/quay/dist/quay.js']);
    assert.equal(checkBundleTree(tmp).mode, 'consistent');
    // The re-derived bundle really carries the tree's version (not just "the gate agrees with itself").
    assert.equal(readEmbeddedVersion(resolve(tmp, 'vendor/quay/dist/quay.js')).version, '0.15.0');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('bundle gate is NOT-EVALUATED when the tree has no readable plugin.json', () => {
  const tmp = makeBundleTree('no-manifest', { manifest: null, core: '0.14.0' });
  try {
    const r = checkBundleTree(tmp);
    assert.equal(r.mode, 'not-evaluated');
    assert.ok(r.expectedError, 'a tree with no manifest must name the missing expected version');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the Node-20-safe .mjs runner forwards the same verdict (floor-safe entry, no second implementation)', () => {
  // `plugin/scripts/{sync-vendor,publish-dist-branch}.sh` reach the checker through this runner, not
  // the `.ts` source (they run on the declared Node floor, where --experimental-strip-types is absent).
  // Without this case "the runner forwards `main`" and "the runner silently exits 0" are
  // indistinguishable — and the latter is precisely the hard-rule-3b shape a build gate must not have.
  const runnerPath = resolve(__dirname, 'version-consistency-check.mjs');
  const tmp = makeBundleTree('runner-drift');
  try {
    let status = 0;
    let out = '';
    try {
      execSync(`node ${runnerPath} --bundle-tree ${tmp} 2>&1`, { encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe' });
    } catch (e: any) {
      status = e.status;
      out = String(e.stdout ?? '');
    }
    assert.equal(status, 1, `the runner must forward the drift exit code, got ${status}:\n${out}`);
    assert.match(out, /BUNDLE-EMBEDDED: DRIFT DETECTED/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
