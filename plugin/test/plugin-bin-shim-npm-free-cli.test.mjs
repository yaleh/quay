// @test-group product
// plugin/test/plugin-bin-shim-npm-free-cli.test.mjs
//
// gap-ac261-plugin-bin-shim-missing-so-cli-needs-npm-global — pins `plugin/bin/quay`,
// the plugin form's CLI entry point.
//
// WHY IT EXISTS. Claude Code unconditionally puts `<plugin-root>/bin` on the Bash
// tool's PATH for every enabled plugin (measured 2026-09-02, recorded as T4 in
// orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §3a/§9 —
// "PATH 中已存在 `<plugin-root>/bin`，该目录尚不存在也照样在"). The directory did not
// exist, so a plugin-form install had no `quay` on PATH and README sent users to
// `npm install -g quay` for the CLI alone — even though the plugin already ships a
// self-contained, Node-≥20-runnable bundle at <plugin-root>/vendor/quay/dist/quay.js.
// The capability was present; the entry point was missing.
//
// WHAT IS ASSERTED, AND HOW EACH READING IS TAKEN (no fixture, no proxy):
//   AC1 — the three verbs run from a shell that has NO other `quay` reachable, with
//         `command -v quay` resolving to this shim (real PATH lookup, real process).
//         The npm-free property is not assumed: every PATH entry that itself holds an
//         executable `quay` is dropped, and a control asserts that with the shim's own
//         directory removed the name resolves to NOTHING — so the resolution above is
//         attributable to the shim and not to whatever the host happens to have.
//   AC2 — two readings, one per delivery channel, never inferred from each other:
//           (a) the git-tracked mode (`git ls-files -s` → 100755). This is the mode BOTH
//               channels start from — the dist-plugin branch rsyncs the working tree,
//               the npm channel `cp -R`s it — so a mode lost in the index is lost in both.
//               The end-to-end dist-plugin reading (`git ls-tree <dist-plugin> bin/quay`)
//               is produced by an actual publish run and recorded in the task's Evidence;
//               it is not re-run here because publishing builds the whole bundle.
//           (b) a REAL `npm pack` of the real shim file, read twice: the mode stored in
//               the tarball, and the file's executability after EXTRACTION (what the AC
//               asks for; tar applies the caller's umask for ordinary users).
//   AC5 — the negative control is built into the suite as a red/green pair on the same
//         axis: the shim's bytes copied to a temp dir at mode 644 are NOT invocable by
//         PATH lookup, at mode 755 they are. The manual `chmod 644 plugin/bin/quay`
//         red/green reading is recorded in the task's Evidence.
//
// Run: node --test plugin/test/plugin-bin-shim-npm-free-cli.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PLUGIN_DIR, '..');
const SHIM = path.join(PLUGIN_DIR, 'bin', 'quay');
const SHIM_DIR = path.join(PLUGIN_DIR, 'bin');
const VENDOR_ENTRY_REL = 'vendor/quay/dist/quay.js';
const VENDOR_ENTRY = path.join(PLUGIN_DIR, VENDOR_ENTRY_REL);

// The suite's scripts/test.sh builds the source dist once per run and mirrors it here
// (sync-vendor.sh --sync-dist), so the bundle is present on every path that runs this
// file. It is a hard precondition, not a soft skip: without it the shim genuinely
// cannot serve the CLI, and a silent pass would be a fake green.
const VENDOR_ENTRY_PRESENT = fs.existsSync(VENDOR_ENTRY);

const BASH = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'].find((p) => fs.existsSync(p)) || 'bash';

function fileMode(p) {
  return fs.statSync(p).mode & 0o777;
}

function hasExecutableQuay(dir) {
  try {
    fs.accessSync(path.join(dir, 'quay'), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Every PATH entry that does NOT itself carry an executable `quay`. Prepending the
// shim's directory to this list yields an environment in which the only reachable
// `quay` IS the shim — i.e. genuinely no npm-global install.
function pathEntriesWithoutACompetingQuay() {
  return (process.env.PATH || '')
    .split(':')
    .filter(Boolean)
    .filter((d) => d !== SHIM_DIR && !hasExecutableQuay(d));
}

// QUAY_PLUGIN_ROOT is dropped so the shim resolves the plugin root from its OWN
// location — the same thing an installed copy on a consumer machine does.
function npmFreeEnv(pathDirs) {
  const env = { ...process.env, PATH: pathDirs.join(':') };
  delete env.QUAY_PLUGIN_ROOT;
  return env;
}

function runIn(env, script, cwd) {
  return spawnSync(BASH, ['-c', script], { cwd, env, encoding: 'utf8', timeout: 120_000 });
}

// A minimal, self-contained workspace so the three verbs are read for what the SHIM
// does, not for the state of this checkout's gitignored .quay/config.yml. Same
// provider shape the repo's own config uses (README: "裸 tasks 目录不是合法 workspace"
// — config.yml is the provider map, so it is written here rather than left out).
function makeTempWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-shim-ws-'));
  fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'tasks'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, '.quay', 'config.yml'),
    [
      'providers:',
      '  native:',
      '    enabled: true',
      `    path: "${REPO_ROOT}/packages/quay-native"`,
      '    tasks_dir: "./tasks"',
      `    mcp_entry: ["node", "${REPO_ROOT}/packages/quay-native/bin/quay-native.ts", "mcp"]`,
      '    env:',
      '      QUAY_NATIVE_TASKS_DIR: "./tasks"',
      '',
    ].join('\n'),
  );
  return ws;
}

test('AC1/AC2: plugin/bin/quay exists, is executable, and dispatches to the vendored bundle', () => {
  assert.ok(VENDOR_ENTRY_PRESENT, `${VENDOR_ENTRY_REL} is missing — the shim has nothing to exec. ` +
    'It is a generated mirror: run scripts/test.sh (build_dist_once) or `bash plugin/scripts/sync-vendor.sh`.');
  const st = fs.statSync(SHIM); // absent => this throws, which IS the AC1 reading
  assert.ok(st.isFile(), `${SHIM} must be a regular file`);
  assert.ok((st.mode & 0o111) !== 0, `${SHIM} must be executable (mode ${fileMode(SHIM).toString(8)})`);

  const src = fs.readFileSync(SHIM, 'utf8');
  assert.ok(src.startsWith('#!'), 'the shim must carry a shebang so PATH lookup can exec it');
  assert.ok(
    src.includes(VENDOR_ENTRY_REL),
    `the shim must dispatch to ${VENDOR_ENTRY_REL} (the self-contained bundle), not to a raw .ts entrypoint`,
  );

  // AC2(a): the mode both delivery channels START FROM. `git ls-files -s` reports the
  // index mode ('100755'), which is what a checkout materialises and what the
  // dist-plugin rsync and the npm-channel `cp -R` both copy.
  const lsFiles = execFileSync('git', ['ls-files', '-s', '--', 'plugin/bin/quay'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  assert.ok(lsFiles.length > 0, 'plugin/bin/quay must be git-tracked (it is a shipped file, not a build artifact)');
  assert.ok(
    lsFiles.startsWith('100755'),
    `git must track plugin/bin/quay as 100755 so both channels start from an executable mode; got: ${lsFiles}`,
  );
  console.log(`# AC1/AC2(a): ${SHIM} mode=${fileMode(SHIM).toString(8)} · git index: ${lsFiles}`);
});

test('AC1: with no other quay on PATH, `quay` resolves to this shim and the three verbs exit 0', () => {
  assert.ok(VENDOR_ENTRY_PRESENT, `${VENDOR_ENTRY_REL} is missing — run scripts/test.sh or ` +
    '`bash plugin/scripts/sync-vendor.sh` before reading the CLI.');
  const dirs = [SHIM_DIR, ...pathEntriesWithoutACompetingQuay()];
  const env = npmFreeEnv(dirs);

  const which = runIn(env, 'command -v quay', REPO_ROOT);
  assert.equal(which.status, 0, `\`command -v quay\` found nothing with the shim dir on PATH.\nstderr: ${which.stderr}`);
  const resolved = which.stdout.trim();
  assert.equal(
    fs.realpathSync(resolved),
    fs.realpathSync(SHIM),
    `\`command -v quay\` must resolve to the plugin shim, got: ${resolved}`,
  );

  const ws = makeTempWorkspace();
  const readings = [];
  try {
    for (const verb of ['--help', 'config validate', 'task list']) {
      const r = runIn(env, `quay ${verb}`, ws);
      assert.equal(
        r.status,
        0,
        `"quay ${verb}" exited ${r.status} (signal ${r.signal})\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
      );
      readings.push(`${verb}=0`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  console.log(`# AC1: command -v quay -> ${resolved} · ${readings.join(' ')} · PATH dirs dropped (held another quay): ` +
    `${(process.env.PATH || '').split(':').filter(Boolean).length - pathEntriesWithoutACompetingQuay().length}`);
});

test('AC1 control: without the shim directory the same PATH resolves NO quay at all', () => {
  // The reading above is only worth something if the environment really had no other
  // `quay` to fall back on. Removing the shim's directory must make the name vanish —
  // if it does not, the previous test may have been measuring an npm-global install.
  const dirs = pathEntriesWithoutACompetingQuay();
  const env = npmFreeEnv(dirs);
  const which = runIn(env, 'command -v quay', REPO_ROOT);
  assert.notEqual(which.status, 0, `a quay is still reachable at ${which.stdout.trim()} without the plugin shim on PATH`);
  assert.equal(which.stdout.trim(), '', `expected no quay, got: ${which.stdout.trim()}`);
  console.log(`# AC1 control: shim dir removed -> command -v quay empty (rc=${which.status}) over ${dirs.length} PATH dirs`);
});

test('AC2(b): a real `npm pack` keeps plugin/bin/quay executable in the tarball and after extraction', () => {
  // The npm channel's mode is NOT determined by git — it goes through `cp -R`
  // (package.sh stages packages/quay/plugin/) and then npm pack. This reads that
  // mechanism on the REAL shim file: pack it, read the mode stored in the tarball,
  // then read executability after extraction (what a consumer actually gets).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-shim-npmpack-'));
  const pkgDir = path.join(tmp, 'pkg');
  const packed = path.join(pkgDir, 'plugin', 'bin', 'quay');
  try {
    fs.mkdirSync(path.dirname(packed), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'quay-shim-npm-channel-probe', version: '0.0.0', files: ['plugin'] }, null, 2),
    );
    fs.copyFileSync(SHIM, packed);
    fs.chmodSync(packed, fileMode(SHIM));

    const out = execFileSync('npm', ['pack', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const info = JSON.parse(out)[0];
    const tgz = path.join(pkgDir, info.filename);

    // (b1) the mode npm itself records for the packed entry (0o755 == 493)
    const packedEntry = info.files.find((f) => f.path === 'plugin/bin/quay');
    assert.ok(packedEntry, `npm pack must carry plugin/bin/quay; packed: ${info.files.map((f) => f.path).join(', ')}`);
    assert.ok(
      (packedEntry.mode & 0o111) !== 0,
      `npm must record an executable mode for plugin/bin/quay; got mode ${packedEntry.mode.toString(8)}`,
    );

    // (b2) the mode stored in the tarball itself
    const listing = execFileSync('tar', ['-tvzf', tgz], { encoding: 'utf8' });
    const line = listing.split('\n').find((l) => l.trim().endsWith('plugin/bin/quay'));
    assert.ok(line, `the npm tarball must carry plugin/bin/quay; tarball listing was:\n${listing}`);
    assert.match(
      line.trim(),
      /^-rwx/,
      `npm must store an executable mode for plugin/bin/quay; tarball entry was: ${line.trim()}`,
    );

    // (b3) what a consumer actually gets: executable AFTER extraction. npm tarballs
    // carry every path under a `package/` prefix, so that is where the file lands.
    const unpackDir = path.join(tmp, 'unpack');
    fs.mkdirSync(unpackDir);
    execFileSync('tar', ['-xzf', tgz, '-C', unpackDir]);
    const extracted = path.join(unpackDir, 'package', 'plugin', 'bin', 'quay');
    fs.accessSync(extracted, fs.constants.X_OK); // throws => not executable after unpack

    console.log(`# AC2(b): ${info.filename} entry mode=${packedEntry.mode.toString(8)} · tar: ${line.trim()} · extracted mode=${fileMode(extracted).toString(8)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC5 control: the executable bit is what makes the shim RUNNABLE (644 red / 755 green)', () => {
  // A red/green pair on the exact axis AC5 names, run without mutating the checkout:
  // the shim's own bytes in a temp directory. ⛔ The probe is EXECUTION, not `command -v`
  // — measured 2026-09-15: bash's `command -v` happily reports a mode-644 file (rc=0),
  // so an existence probe would have shown green on both halves and proven nothing.
  // Without the 644 half the 755 half would only show that bash can run a file, not that
  // the mode is load-bearing.
  // A throwaway plugin ROOT (so the shim's own `<root>/vendor/...` resolution works):
  // every top-level entry is symlinked, `bin/quay` is a real copy whose mode we flip.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-shim-mode-'));
  const binDir = path.join(tempRoot, 'bin');
  const copy = path.join(binDir, 'quay');
  try {
    fs.mkdirSync(binDir);
    for (const entry of fs.readdirSync(PLUGIN_DIR)) {
      if (entry === 'bin') continue;
      fs.symlinkSync(path.join(PLUGIN_DIR, entry), path.join(tempRoot, entry));
    }
    fs.copyFileSync(SHIM, copy);
    const dirs = [binDir, ...pathEntriesWithoutACompetingQuay()];
    const env = npmFreeEnv(dirs);

    fs.chmodSync(copy, 0o644);
    const red = runIn(env, 'quay --help', REPO_ROOT);
    assert.notEqual(red.status, 0, `a 644 shim must NOT be runnable, but "quay --help" exited 0`);
    assert.match(
      `${red.stdout}${red.stderr}`,
      /Permission denied/,
      `a 644 shim must fail with EACCES; got status ${red.status}, output:\n${red.stdout}${red.stderr}`,
    );

    fs.chmodSync(copy, 0o755);
    const green = runIn(env, 'quay --help', REPO_ROOT);
    assert.equal(green.status, 0, `a 755 shim must run.\n--- stdout ---\n${green.stdout}\n--- stderr ---\n${green.stderr}`);

    console.log(`# AC5 control: 644 -> rc=${red.status} (Permission denied) · 755 -> rc=${green.status} (ran)`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
