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
// INTERPRETER RESOLUTION (gap-ac261-shim-node-autodetect-nvm-fallback) — three tests
// at the end of this file. The shim used to treat `command -v node` as the whole
// check, so on an nvm machine (no /usr/bin/node) it exited 127 with the bundle
// sitting right there — which is exactly the minimal-PATH reading AC-261 takes, and
// why that gate read `verdict: fail` until this fix. Their $HOME is a FIXTURE, so
// they pin the shim's behaviour rather than this host's nvm layout:
//   (a) no node on PATH + four nvm versions → the shim execs the NEWEST one that
//       clears the >= 20 floor, and hands it the vendored bundle. The fixture
//       includes v9.1.0 deliberately: "v9" sorts above "v24" as a string, so a name
//       sort would run v9 and this reading catches that.
//   (b) a tree with only v18 → NOT exec'd, and the shim names the version it found
//       instead of claiming node is absent.
//   (c) the negative control: with no nvm tree under HOME (empty, and non-existent)
//       the shim still exits 127 with the friendly message — the fallback must never
//       turn a genuinely node-less machine into a fake success.
//
// Run: node --test plugin/test/plugin-bin-shim-npm-free-cli.test.mjs
import { after, test } from 'node:test';
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

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasExecutableQuay(dir) {
  return isExecutable(path.join(dir, 'quay'));
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

// ...and additionally carrying no executable `node`, i.e. the configuration the
// interpreter fallback exists for: the only `quay` reachable is the shim, and the
// only interpreter the shim can use is one it finds for itself.
//
// ⚠️ "No `node` on PATH" must not be implemented by DROPPING the whole directory that carries
// `node`: a directory holding `node` is usually the system bin dir, and it is also what holds
// `bash` (the shim's `#!/usr/bin/env bash` shebang) and the coreutils the shim calls (`dirname`,
// `readlink`). On ubuntu-latest and on developer machines `/usr/bin` has a `bash` and no `node`, so
// dropping it was harmless; the self-hosted tokyo-alpha image ships a `/usr/bin/node`, so `/usr/bin`
// was dropped and every reading below died before reaching the logic under test — with
// `/usr/bin/env: 'bash': No such file or directory` (exit 127) when bash went missing, or with
// `/…/plugin/bin/quay: line 43: dirname: command not found` once it was restored by hand.
// Measured at one commit: this file is green where `/usr/bin` has no `node`, and 3 of its tests are
// red where it does. So the fixture MIRRORS each such directory minus `node`/`quay` instead of
// removing it: the premise (`command -v node` must fail — asserted, not assumed, below) still holds
// while the interpreter and the coreutils the shim needs stay reachable.
const _mirrorDirs = new Map();
const _mirrorHandles = [];
// The carrier-array + after() shape the tmp-leak-pairing-check recognises (a process.on("exit")
// handler is not a cleanup region to that checker, even though it does clean up).
after(() => {
  for (const d of _mirrorHandles) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function dirWithoutNode(dir) {
  if (_mirrorDirs.has(dir)) return _mirrorDirs.get(dir);
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "quay-shim-shadow-"));
  for (const entry of fs.readdirSync(dir)) {
    if (entry === "node" || entry === "quay") continue;
    try { fs.symlinkSync(path.join(dir, entry), path.join(mirror, entry)); } catch { /* unreadable entry: not needed */ }
  }
  _mirrorHandles.push(mirror);
  _mirrorDirs.set(dir, mirror);
  return mirror;
}

function pathEntriesWithoutQuayOrNode() {
  return pathEntriesWithoutACompetingQuay()
    .map((d) => (isExecutable(path.join(d, "node")) ? dirWithoutNode(d) : d));
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

// A synthetic $HOME holding an nvm tree, one real executable per version — so the
// shim's `-x` probe and its `exec` meet an actual program, not a stub the test
// asserts about by proxy. Each fake prints the version it was built for AND its
// argv, which is how the readings below tell WHICH interpreter the shim chose and
// WHAT it handed to it.
function makeNvmHome(versions) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-shim-nvm-'));
  for (const v of versions) {
    const bin = path.join(home, '.nvm', 'versions', 'node', v, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\necho "FAKE-NODE ${v} $*"\n`);
    fs.chmodSync(path.join(bin, 'node'), 0o755);
  }
  return home;
}

// A PATH with no `quay` other than the shim AND no `node` at all, plus the given
// $HOME. NVM_DIR is dropped so the fixture's HOME is the ONLY nvm tree in reach:
// leaving an inherited NVM_DIR set would let a probe that honours it read the
// host's real nvm instead, and the fixture would quietly become a no-op that still
// prints a passing line.
function noNodeEnv(home) {
  const dirs = [SHIM_DIR, ...pathEntriesWithoutQuayOrNode()];
  const env = { ...process.env, PATH: dirs.join(':'), HOME: home };
  delete env.QUAY_PLUGIN_ROOT;
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.NVM_DIR;
  return env;
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

// ---------------------------------------------------------------------------
// Interpreter resolution (gap-ac261-shim-node-autodetect-nvm-fallback).
//
// AC-261 runs `quay --version` on a minimal PATH — `<repo>/plugin/bin:/usr/bin:/bin`
// — and on a machine whose Node comes from nvm there is no /usr/bin/node at all, so
// the shim exited 127 with the bundle sitting right there. Measured 2026-09-16 on
// this host: the goal gate for AC-261 read `verdict: fail … exited 127` before the
// fix and `verdict: pass` after it.
//
// These tests take the same reading with the host's own nvm factored OUT — HOME is a
// fixture — so they pin the SHIM's behaviour rather than this machine's nvm layout.
// ---------------------------------------------------------------------------

test('AC1(nvm fallback): with no node on PATH the shim execs the newest Node under ~/.nvm, floor respected', () => {
  assert.ok(VENDOR_ENTRY_PRESENT, `${VENDOR_ENTRY_REL} is missing — run scripts/test.sh or ` +
    '`bash plugin/scripts/sync-vendor.sh` before reading the CLI.');
  // v9.1.0 is the trap, not decoration: a lexicographic compare puts "v9.1.0" ABOVE
  // "v24.19.0", so a probe that sorted names — or trusted `ls` order — would run v9
  // and this assertion is what catches it. v18.20.0 is the floor: present, and the
  // shim must not fall back to it.
  const home = makeNvmHome(['v9.1.0', 'v18.20.0', 'v20.11.1', 'v24.19.0']);
  try {
    const env = noNodeEnv(home);

    // The premise, asserted rather than assumed: if a `node` were reachable on this
    // PATH the shim would take the PATH branch and the reading below would say
    // nothing about the fallback at all.
    const which = runIn(env, 'command -v node', REPO_ROOT);
    assert.notEqual(which.status, 0, `the fixture PATH must carry NO node, but one resolved at ${which.stdout.trim()}`);

    const r = runIn(env, 'quay --version', REPO_ROOT);
    assert.equal(r.status, 0, `"quay --version" exited ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
    assert.match(r.stdout, /FAKE-NODE v24\.19\.0 /, `the shim must run the NEWEST nvm Node; got:\n${r.stdout}${r.stderr}`);
    assert.ok(
      r.stdout.includes(VENDOR_ENTRY),
      `the interpreter the shim found must receive the vendored bundle; got:\n${r.stdout}`,
    );
    console.log(`# AC1(nvm fallback): no node on PATH · picked ${r.stdout.trim().split(' ')[1]} of v9.1.0/v18.20.0/v20.11.1/v24.19.0`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('AC1(nvm fallback): an nvm tree with only an older Node is NOT exec\'d — the shim names what it found', () => {
  // The floor has to be a floor. Running v18 would swap a clear "needs >= 20" for a
  // crash inside the bundle, and reporting "not found" would claim a node-less
  // machine that is not node-less — the exact misdiagnosis this task exists to fix.
  const home = makeNvmHome(['v18.20.0']);
  try {
    const env = noNodeEnv(home);
    const r = runIn(env, 'quay --version', REPO_ROOT);
    assert.equal(r.status, 127, `an under-floor Node must not run; got rc=${r.status}, stdout:\n${r.stdout}`);
    assert.doesNotMatch(r.stdout, /FAKE-NODE/, 'the shim must not exec a Node below the floor');
    assert.match(r.stderr, /v18\.20\.0/, `the message must name the version it found; got:\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /not found on PATH/, `"not found" would be false — it was found; got:\n${r.stderr}`);
    console.log(`# AC1(nvm fallback): only v18 present -> rc=${r.status} · ${r.stderr.trim()}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('AC3 control: with no nvm tree under HOME either, the shim still exits 127 with the friendly message', () => {
  // The fallback must not turn a genuinely node-less machine into a fake success.
  // Two shapes of "no nvm tree": a HOME that exists and is empty (the literal AC3
  // case) and a HOME that does not exist at all (the shim's own `-d` guard).
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-shim-nonvm-'));
  try {
    for (const [label, home] of [['existing empty HOME', emptyHome], ['non-existent HOME', path.join(emptyHome, 'absent')]]) {
      const env = noNodeEnv(home);
      const r = runIn(env, 'quay --version', REPO_ROOT);
      assert.equal(r.status, 127, `${label}: must exit 127, got rc=${r.status}, stdout:\n${r.stdout}`);
      assert.doesNotMatch(r.stdout, /FAKE-NODE/, `${label}: nothing must be exec'd`);
      assert.match(r.stderr, /node not found on PATH/, `${label}: friendly diagnosis expected; got:\n${r.stderr}`);
      console.log(`# AC3 control: ${label} -> rc=${r.status} · ${r.stderr.trim()}`);
    }
  } finally {
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});
