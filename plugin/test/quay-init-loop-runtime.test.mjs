// @test-group engine
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e (quay-init → python3 children); install family flake rotation; re-split lowconc 2026-08-12 (fixture-amortized — gap-suite-tiering-kind-heavy-not-a-mechanism)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each --loop test spawns a real quay-init.sh → python3 children. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// GROUP NOTE (gap-serial-group-recompose-nested-runner-criterion → gap-install-family-tests-rotate-
// flakes-under-full-suite): routed to `serial`, not `lowconc`. The old criterion routed
// load-sensitive-but-not-nested files to lowconc; the family then rotated flakes across groups under
// full-suite load, so the serial criterion was extended to admit the install/quay-init family's
// real-install e2e and the family was consolidated into the concurrency-1 serial phase. The laydown
// template (one real install per file process) keeps each file's serial cost bounded.
// quay-init-loop-runtime.test.mjs — split out of quay-init-loop.test.mjs (2026-08-07 inner red-window
// fix). The original 54-test single file exhausted the node:test worker event loop under heavy
// blocking spawnSync (each --loop test spawns a real quay-init.sh → python3 children), self-failing
// at ~167s with 'Promise resolution is still pending'. Each split file keeps < ~19 tests, under the
// exhaustion threshold. Shared helpers live in quay-init-loop-helpers.mjs.
// gap-quay-init-laydown-dominant-red-suite-blocker root-cause verdict 2026-08-07.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTmp, cleanup, diskWorktreeRoot, runInit, extractRefs, declaredSet, pluginDir, laydownTemplate, laydownWorkspace } from "./quay-init-loop-helpers.mjs";

// AC1/AC2 — session-liveness.sh is laid down VERBATIM (cp, not render_substitutions); the
// per-project session is CONFIG, generated into orchestration/session-liveness.env.
test('AC1/AC2 — session-liveness.sh is copied verbatim; the session is generated config, not a script rewrite', () => {
  // AC2 (gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles) + the SHARED
  // prebuilt fixture (gap-quay-init-loop-tests-not-wired-to-shared-fixture AC1): this file's
  // install-as-setup tests copy from the SHARED content-addressed fixture — ONE real quay-init
  // --loop per SERIAL PHASE, not per FILE (quay-init-loop-helpers.mjs sharedFixture →
  // laydownTemplate → laydownWorkspace). The laid-down state is byte-identical to a fresh real
  // install, so the assertion surface is unchanged. The direct laydownTemplate() reference below
  // is the explicit shared-fixture wiring (AC1: this file hits sharedFixture/laydownTemplate).
  const template = laydownTemplate();
  assert.ok(template.ws && template.install, 'the shared prebuilt fixture must be serving this file (AC1)');
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const src = fs.readFileSync(path.join(pluginDir, 'scripts', 'session-liveness.sh'), 'utf8');
    const installed = fs.readFileSync(path.join(ws, 'plugin', 'scripts', 'session-liveness.sh'), 'utf8');
    assert.equal(installed, src, 'installed session-liveness.sh must be byte-identical to its source (cp, not render)');
    assert.ok(!installed.includes('__QUAY_TMUX_SESSION__'), 'the placeholder must not exist (AC1)');
    const envFile = fs.readFileSync(path.join(ws, 'orchestration', 'session-liveness.env'), 'utf8');
    assert.match(envFile, /SESSION_TMUX_SESSION=proj-0:0\.0/, 'the --tmux-session value must be written to the generated config');
    assert.ok(!installed.includes('proj-0'), 'the script itself must NOT carry the target session (config, not code)');
  } finally { cleanup(ws); }
});

// AC2 — no render_substitutions call in quay-init.sh acts on an executable: grep shows the script
// is only ever passed to copy_one. (The two remaining render_substitutions calls are tick docs.)
test('AC2 — quay-init.sh has no render_substitutions call targeting session-liveness.sh', () => {
  const initSrc = fs.readFileSync(path.join(pluginDir, 'scripts', 'quay-init.sh'), 'utf8');
  // The render_substitutions call sites must not reference the executable.
  assert.ok(!initSrc.includes('render_substitutions "$sl_src"'),
    'quay-init.sh must not render the session-liveness.sh executable');
  // The executable path is only ever copied verbatim.
  assert.ok(initSrc.includes('copy_one "$sl_src" "$sl_dst"'),
    'quay-init.sh must copy session-liveness.sh via copy_one (cp)');
});

// AC6 — the mechanical check runs as part of quay-init --loop and passes on a clean install.
test('AC6 — verify-installed-executables.sh runs inside quay-init --loop and passes (byte-identical executables)', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-installed-executables: OK/, 'quay-init must run the AC6 check and report OK');
    // Standalone re-run, matching what cold-start-e2e does.
    const v = spawnSync('bash', [path.join(pluginDir, 'scripts', 'verify-installed-executables.sh'), pluginDir, ws],
      { encoding: 'utf8' });
    assert.equal(v.status, 0, `verify must exit 0:\n${v.stderr}`);
    assert.match(v.stdout, /byte-identical/, 'verify must report the byte-identical invariant');
  } finally { cleanup(ws); }
});

// AC4 — bidirectional negative control: flip one byte in an installed executable ⇒ the check FAILS
// naming it; restore ⇒ the check PASSES again. A check that only ever reports "same" is the bug.
test('AC4 — the check fails when an installed executable drifts by one byte, and passes after restore', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const installed = path.join(ws, 'plugin', 'scripts', 'session-liveness.sh');
    // fail direction: simulate a future render path rewriting the installed executable by one byte.
    const buf = fs.readFileSync(installed);
    buf[0] ^= 0x01;
    fs.writeFileSync(installed, buf);
    const v = spawnSync('bash', [path.join(pluginDir, 'scripts', 'verify-installed-executables.sh'), pluginDir, ws],
      { encoding: 'utf8' });
    assert.notEqual(v.status, 0, 'verify must FAIL when an installed executable drifts by one byte');
    assert.match(v.stderr, /session-liveness\.sh/, 'the failure must name the drifted file');
    // restore direction.
    buf[0] ^= 0x01;
    fs.writeFileSync(installed, buf);
    const v2 = spawnSync('bash', [path.join(pluginDir, 'scripts', 'verify-installed-executables.sh'), pluginDir, ws],
      { encoding: 'utf8' });
    assert.equal(v2.status, 0, 'verify must PASS after restore (AC4 restore direction)');
  } finally { cleanup(ws); }
});

// ── AC7b: lay the runtime into the target + PATH-independent provider config ─────────────────────────
// gap-cold-start-...-eight-steps: the cold-started loop must NOT depend on the quay dev tree via
// PATH symlinks (quay-native → /home/yale/work/quay/packages/quay-native/dist/).
test('AC7b — --loop writes a .quay/config.yml whose provider mcp_entry is project-local absolute (never a PATH-resolved quay-native)', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const cfg = path.join(ws, '.quay', 'config.yml');
    assert.ok(fs.existsSync(cfg), '--loop must write a .quay/config.yml for a config-less target (AC7b)');
    const src = fs.readFileSync(cfg, 'utf8');
    // The provider's mcp_entry must be an absolute project-local path, not a bare `quay-native`.
    assert.ok(src.includes('mcp_entry'), 'config must declare the provider mcp_entry');
    assert.ok(src.includes(ws), 'config must reference the target project by absolute path');
    // Negative control: the COMMAND element must never be the bare `quay-native` (which PATH-resolves
    // to the dev-tree symlink). It must be an absolute path into the target.
    assert.ok(!/mcp_entry: \["node", "quay-native", "mcp"\]/.test(src),
      'config must not PATH-resolve a bare quay-native command — that is the dev-tree symlink dependency (AC7b negative control)');
    // The command must be an absolute project-local path into the laid-down SELF-CONTAINED native
    // provider bundle (.quay/runtime/bin/quay-native.js) — the runtime quay-init actually lays
    // down (gap-ac3b-prove-installed-quay-runs-without-dev-tree). The landing dir is .quay/runtime/
    // (quay's own namespace, never vendor/ — gap-the-runtime-has-nowhere-safe-to-land AC9). It must
    // NOT reference a bin/quay-native.ts source file that needs a node_modules quay/yaml/zod/sdk
    // (not laid down).
    assert.match(src, /mcp_entry: \["node", "\/[^"]*\/\.quay\/runtime\/bin\/quay-native\.js", "mcp"\]/,
      'the mcp_entry command must be an absolute project-local path into the laid-down provider runtime (self-contained bundle)');
    assert.ok(src.includes('QUAY_NATIVE_TASKS_DIR'), 'config must set the native tasks dir');
  } finally { cleanup(ws); }
});

// ── Vendor-runtime mechanism tests (AC1/AC7b/AC3/AC4): BEHAVIOR tests, NOT install-as-setup. Each
// builds a temp COPY of the plugin with a MODIFIED runtime state (bundles removed / stubbed
// sync-vendor / fake bundles / pre-existing config), then runs a real install against it. They
// cannot use the shared prebuilt fixture (a single fixed-config already-installed tree built from
// the REAL plugin) — the vendor-runtime mechanism under test needs a modified plugin source. These
// keep their real installs (and their fs.cpSync of pluginDir) by design.
test('AC1 — when the plugin has no built runtime bundles and auto-build cannot produce them, --loop FAILS CLOSED (exit non-zero, no complete)', () => {
  // Construct the no-bundle scenario deterministically: a temp COPY of the plugin with the Core
  // and native provider bundles removed (fresh-clone state — dist/ is gitignored). The real
  // pluginDir may have bundles (the full suite builds dist into it), so the test must not depend
  // on ambient build state. sync-vendor.sh is stubbed to FAIL deterministically, modelling an
  // auto-build that cannot produce the runtime (no packages/quay source tree in an installed
  // plugin cache). AC1 negative control: the pre-fix code WARNED and reported complete anyway.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'vendor', 'quay', 'dist', 'quay.js'), { force: true });
    fs.rmSync(path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js'), { force: true });
    // Deterministic build failure (the real sync-vendor.sh in a plugin-only copy would fail on
    // the missing packages/quay source tree, but that depends on the ambient parent dir — a stub
    // pins the failure mode).
    const syncStub = path.join(src, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, '#!/usr/bin/env bash\necho "[stub sync-vendor] cannot build: no source tree" >&2\nexit 1\n', 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.notEqual(r.status, 0, 'init must FAIL CLOSED (exit non-zero) when the vendor runtime is missing and auto-build cannot produce it');
      assert.doesNotMatch(r.stdout, /quay-init complete/, 'must NOT report complete with a broken mcp_entry (AC1 negative control)');
      assert.match(r.stderr, /vendor\/quay\/dist\/quay\.js/, 'must name the missing Core runtime bundle');
      assert.match(r.stderr, /vendor\/quay-native\/dist\/quay-native\.js/, 'must name the missing native provider runtime bundle');
      assert.match(r.stderr, /FAILS CLOSED/, 'the error must state the fail-closed resolution');
      assert.ok(!fs.existsSync(path.join(ws, '.quay', 'config.yml')),
        'must NOT write a config whose mcp_entry points at a missing runtime (the fail-closed fires before write_provider_config)');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

test('AC7b — a plugin source WITH built runtimes lays them into the target (project-local copies, config points at the native bundle)', () => {
  // Use a temp COPY of the plugin + fake built bundles, so the real worktree is never polluted.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    const fakeProviderYml = path.join(src, 'vendor', 'quay-native', 'provider.yml');
    fs.writeFileSync(fakeProviderYml, 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
      assert.match(r.stdout, /\.quay\/runtime\/bin\/quay\.js/, 'must report the Core runtime lay-down');
      assert.match(r.stdout, /\.quay\/runtime\/bin\/quay-native\.js/, 'must report the native provider runtime lay-down');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the Core runtime must be laid into the target project');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// fake built quay.js bundle\n',
        'the laid-down Core runtime must be byte-identical to the plugin source');
      const laidNative = path.join(ws, '.quay', 'runtime', 'bin', 'quay-native.js');
      assert.ok(fs.existsSync(laidNative), 'the native provider runtime must be laid into the target project');
      assert.equal(fs.readFileSync(laidNative, 'utf8'), '// fake built quay-native.js bundle\n',
        'the laid-down native runtime must be byte-identical to the plugin source');
      const laidProviderYml = path.join(ws, '.quay', 'runtime', 'provider.yml');
      assert.ok(fs.existsSync(laidProviderYml), 'provider.yml must be laid into the target project');
      assert.equal(fs.readFileSync(laidProviderYml, 'utf8'), 'id: native\nname: "quay-native"\n',
        'the laid-down provider.yml must be byte-identical to the plugin source');
      const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
      assert.match(cfg, /mcp_entry: \["node", "\/[^"]*\/\.quay\/runtime\/bin\/quay-native\.js", "mcp"\]/,
        'config must point the provider mcp_entry at the laid-down self-contained native bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// gap-the-runtime-has-nowhere-safe-to-land AC10 — the runtime is install-generated product, not
// source, so quay-init MUST write the .gitignore entry itself (never an instruction to the user —
// that is exactly the manual patch G0 bans). Idempotent + non-destructive.
// The "writes the entry itself" + "APPENDS" tests are BEHAVIOR tests of the install-time gitignore
// handling (need a fresh install with a pre-existing user gitignore), so they keep real installs;
// the "CREATES" test is install-as-setup and copies from the SHARED prebuilt fixture.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
test('AC10 — quay-init writes the .gitignore runtime entry itself; a pre-existing same-name entry is NOT duplicated and the user gitignore is NOT overwritten', () => {
  // gap-quay-init-loop-dedupe-real-install AC1: the initial installed state now comes from the
  // SHARED prebuilt fixture (laydownWorkspace — the fixture's own install already created a
  // .gitignore carrying the runtime entry), so this test no longer runs a FRESH install to set up.
  // A user note is added on top of the fixture's installed .gitignore, then the re-run exercises
  // the same skip-not-duplicate behavior (ensure_runtime_gitignore runs on every install, fresh
  // or re-run — line 587 ff). Coverage identical, one from-scratch install eliminated.
  const { ws } = laydownWorkspace();
  try {
    const giPath = path.join(ws, '.gitignore');
    const installed = fs.readFileSync(giPath, 'utf8'); // fixture's installed runtime entry
    // Pre-existing USER gitignore already carrying the entry + user content (entry from the
    // fixture install, user note added here).
    fs.writeFileSync(giPath, installed + '# user note\n', 'utf8');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const gi = fs.readFileSync(giPath, 'utf8');
    assert.ok(gi.includes('# user note'),
      'the user gitignore must be preserved (no overwrite — AC10 negative control)');
    assert.ok(gi.includes(installed.trimEnd()),
      'the installed runtime entry must be preserved (no duplicate write, no overwrite — AC10 negative control)');
    assert.match(r.stdout, /skipped: \.gitignore already carries/, 'must report the skip, not a write');
    const count = (gi.match(/^\.quay\/runtime\/$/gm) || []).length;
    assert.equal(count, 1, 'the runtime entry must appear exactly once (no duplicate)');
  } finally { cleanup(ws); }
});

test('AC10 — quay-init APPENDS the runtime gitignore entry when the target lacks it, preserving the user\'s other content', () => {
  // gap-quay-init-loop-dedupe-real-install AC1: initial state from the SHARED fixture; REMOVE the
  // fixture's installed runtime entry (keeping user content) to model a user gitignore WITHOUT the
  // entry, then re-run → the append path fires (ensure_runtime_gitignore runs on every install).
  // One from-scratch install eliminated; the append behavior itself is still a real install run.
  const { ws } = laydownWorkspace();
  try {
    const giPath = path.join(ws, '.gitignore');
    const lines = fs.readFileSync(giPath, 'utf8').split('\n')
      .filter((l) => !/^\.quay\/runtime\/$/.test(l) && !l.startsWith('# quay runtime'));
    const clean = lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    // A user .gitignore WITHOUT the entry → quay-init appends it, preserving user content.
    fs.writeFileSync(giPath, clean ? `${clean}\nnode_modules/\n` : 'node_modules/\n', 'utf8');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0']);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /appended: \.quay\/runtime\/ to \.gitignore/, 'must report the append');
    const gi = fs.readFileSync(giPath, 'utf8');
    assert.ok(gi.includes('node_modules/\n'), 'the user gitignore content must be preserved');
    assert.ok(gi.includes('.quay/runtime/\n'), 'the runtime entry must be present');
    assert.ok(gi.includes('# quay runtime'), 'the entry must carry a self-documenting comment');
  } finally { cleanup(ws); }
});

test('AC10 — quay-init CREATES the .gitignore when the target has none, and the entry covers the whole .quay/runtime/ dir', () => {
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /appended: \.quay\/runtime\/ to \.gitignore/, 'must report creating the entry');
    const gi = path.join(ws, '.gitignore');
    assert.ok(fs.existsSync(gi), 'a .gitignore must be created');
    const text = fs.readFileSync(gi, 'utf8');
    assert.ok(text.includes('.quay/runtime/\n'), 'the runtime entry must be present');
    // The landing dir is .quay/runtime/ (quay namespace, never vendor/ — AC9): the config file
    // .quay/config.yml is NOT ignored by the entry (only .quay/runtime/ is).
    assert.ok(!text.includes('.quay/config.yml'), 'config.yml must not be swallowed by the gitignore entry');
  } finally { cleanup(ws); }
});

// ── gap-vendor-runtime-not-in-git-clone-broken-mcp-entry (AC1/AC2/AC3) ───────────────────────────────
// The vendored runtime (plugin/vendor/quay/dist/quay.js + vendor/quay-native/dist/quay-native.js) is
// gitignored (bare `dist/` rule, M172), so a fresh plugin clone has no built bundles. quay-init must
// never WARN-and-report-complete with a broken mcp_entry (the pre-fix defect): it auto-builds via
// sync-vendor.sh (AC2) or FAILS CLOSED (AC1). AC3 adds a referenced-existence verify (the config's
// mcp_entry target must actually exist in the target).
test('AC2 — when the plugin lacks the built runtime but sync-vendor.sh can build it, quay-init AUTO-BUILDS and lays the runtime into the target (path 2)', () => {
  // Fresh-clone state: a temp COPY of the plugin with the gitignored bundles removed. sync-vendor.sh
  // is stubbed to SUCCEED and write the bundles (modelling the manager-verified path 2: npm install
  // postinstall → sync-vendor builds them, or a source tree present in the dev clone). quay-init must
  // detect the missing runtime, invoke sync-vendor.sh, re-find the bundles, and proceed to lay-down.
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'vendor', 'quay', 'dist', 'quay.js'), { force: true });
    fs.rmSync(path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js'), { force: true });
    const syncStub = path.join(src, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PLUGIN/vendor/quay/dist" "$PLUGIN/vendor/quay-native/dist"
printf '// auto-built quay.js\\n' > "$PLUGIN/vendor/quay/dist/quay.js"
printf '// auto-built quay-native.js\\n' > "$PLUGIN/vendor/quay-native/dist/quay-native.js"
printf 'id: native\\nname: "quay-native"\\n' > "$PLUGIN/vendor/quay-native/provider.yml"
echo "[stub sync-vendor] built"
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `init must succeed after the auto-build:\n${r.stderr}`);
      assert.match(r.stderr, /auto-built vendor runtime via sync-vendor\.sh/, 'must report the auto-build (AC2)');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the auto-built Core runtime must be laid into the target project');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// auto-built quay.js\n',
        'the laid-down Core runtime must be the auto-built bundle');
      const laidNative = path.join(ws, '.quay', 'runtime', 'bin', 'quay-native.js');
      assert.ok(fs.existsSync(laidNative), 'the auto-built native provider runtime must be laid into the target project');
      const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
      assert.match(cfg, /mcp_entry: \["node", "\/[^"]*\/\.quay\/runtime\/bin\/quay-native\.js", "mcp"\]/,
        'config must point the provider mcp_entry at the auto-built native bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

test('AC3 — after a successful lay-down, the referenced-existence verify reports OK (the mcp_entry target exists in the target)', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `init must succeed:\n${r.stderr}`);
      assert.match(r.stdout, /verify-provider-runtime-existence: OK/, 'the referenced-existence verify must report OK when the mcp_entry target exists (AC3)');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

test('AC3 — verify FAILS CLOSED when the provider mcp_entry references a runtime that does not exist in the target (referenced-existence negative control)', () => {
  // A PRE-EXISTING config whose mcp_entry references a path the lay-down will never create. quay-init
  // lays the bundles, preserves the existing provider config (it is the project's own), and the AC3
  // verify must catch the dangling mcp_entry instead of silently passing (the pre-fix "both verifies
  // passed" defect — verify only checked the landing set, never the referenced runtime).
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
        `providers:\n  native:\n    enabled: true\n    path: "${ws}/vendor/quay-native"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/nonexistent/runtime.js", "mcp"]\n`, 'utf8');
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the provider mcp_entry references a missing runtime (AC3 negative control)');
      assert.match(r.stderr, /referenced-runtime-missing/, 'must report the referenced-existence failure');
      assert.match(r.stderr, /nonexistent\/runtime\.js/, 'must name the missing referenced runtime file');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// gap-dist-runtime-not-self-contained-reads-external-package-json (AC4, upgrade-channel config
// migration): a PRE-EXISTING config from an OLD install can carry a provider mcp_entry pointing at a
// dev-tree source path (e.g. ./bin/quay-native.ts) that does NOT exist in the target. quay-init lays
// the install-state runtime (.quay/runtime/bin/quay-native.js) before writing the config, so a
// dangling reference to a QUAY runtime file must be MIGRATED to that install-state path (not left for
// the AC3 verify to fail closed forever — the "config already exists is never rewritten" upgrade
// hole). SCOPE GUARD: an arbitrary dangling path (e.g. nonexistent/runtime.js) is NOT migrated, so
// the AC3 negative control above keeps its fail-closed meaning.
test('AC4 — a pre-existing config whose mcp_entry points at a stale dev-tree runtime is migrated to the install-state path (upgrade channel)', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
    fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
    fs.writeFileSync(fakeDist, '// fake built quay.js bundle\n', 'utf8');
    const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
    fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
    fs.writeFileSync(fakeNativeDist, '// fake built quay-native.js bundle\n', 'utf8');
    fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
    const ws = makeTmp();
    try {
      // Old-install config: mcp_entry points at a dev-tree SOURCE path that does not exist in the target.
      fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
        `providers:\n  native:\n    enabled: true\n    path: "${ws}/bin"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/bin/quay-native.ts", "mcp"]\n`, 'utf8');
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', src]);
      assert.equal(r.status, 0, `quay-init must succeed after migrating the stale mcp_entry:\n${r.stderr}`);
      assert.match(r.stdout, /migrated: stale provider config/, 'must report the config migration (AC4)');
      assert.match(r.stdout, /verify-provider-runtime-existence: OK/, 'after migration the referenced-existence verify must pass');
      const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
      assert.ok(!cfg.includes(`${ws}/bin/quay-native.ts`), 'the stale dev-tree mcp_entry must no longer be present');
      assert.ok(!cfg.includes(`${ws}/bin`), 'the stale dev-tree provider path must no longer be present');
      assert.match(cfg, new RegExp(`${ws.replaceAll('/', '\\/')}/\.quay/runtime/bin/quay-native\\.js`),
        'the config mcp_entry must now point at the install-state runtime (.quay/runtime/bin/quay-native.js)');
      assert.match(cfg, new RegExp(`${ws.replaceAll('/', '\\/')}/\.quay/runtime`),
        'the config provider path must now point at the install-state provider dir (.quay/runtime)');
      // Other provider keys must be preserved (config migration, not a blank rewrite).
      assert.match(cfg, /enabled: true/, 'the existing provider enabled: true must be preserved');
      assert.match(cfg, /tasks_dir:/, 'the existing provider tasks_dir must be preserved');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

