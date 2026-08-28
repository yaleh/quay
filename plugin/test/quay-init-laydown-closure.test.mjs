// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e; install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop install subprocess tree. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init-laydown-closure.test.mjs — gap-laydown-derivation-is-sensitive-to-reference-spelling-
// dependency-closure (AC1/AC2/AC3/AC4).
//
// The --loop laydown set is DERIVED from the shipped mechanism docs' OWN references at BOTH
// spellings (path-prefixed AND bare filename) PLUS the laid-down scripts' TRANSITIVE SIBLING
// DEPENDENCIES — so the laid-down mechanism is functional and reference-spelling-independent.
// This pins:
//   AC1 (b, dependency closure) — send-keys-reliable.sh:41 / inner-session-check.sh:43 reference
//       `transcript-delivery-check.ts` via ${SCRIPT_DIR}/, and cap-from-gate.sh:13 references
//       cap-from-gate.ts. All three siblings must be laid down (铺了消费者必然铺依赖).
//   AC1/AC3 negative — removing transcript-delivery-check.ts from the plugin ⇒ the install FAILS
//       with dependency-not-landed (the bare-referenced script is now in the verification surface;
//       checker and checked share the same spelling-independent derivation — no shared blind spot).
//   AC2 (a, bare-filename resolution) — a MECHANISM-corpus doc (cold-start/SKILL.md) writing a
//       bare `<name>.<ext>` (no plugin/scripts/ prefix) that exists under plugin/scripts/ is laid
//       down and verify passes (文档写裸文件名不再静默漏铺).
//   AC3 — the shipped cold-start bare reference (transcript-delivery-check.ts) resolves under
//       plugin/scripts/, lands, and verify passes; the verify surface covers it.
//   AC4 — send-keys-reliable.sh FAILS LOUD at startup when its CHECKER is missing (exit 1 + named
//       error), never a silent assignment.
//   AC7 — this file is node:test + // @test-group serial.
//
// Run:
//   scripts/test.sh plugin/test/quay-init-laydown-closure.test.mjs
//   node --test plugin/test/quay-init-laydown-closure.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// AC3 (gap-serial-install-family-shared-prebuilt-fixture): the install-as-setup test below copies a
// fresh installed root from the SHARED prebuilt fixture instead of a per-test real install.
import { laydownWorkspace } from './quay-init-loop-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');

// NOTE (gap-install-family-tests-rotate-flakes-under-full-suite): this file left the governance
// group for the serial phase — the real tests ALWAYS run (no self-skip wrapper; the serial phase
// runs them at concurrency 1 in the default full-suite run).
const _worktreeTestRoots = [];
after(() => {
  for (const d of _worktreeTestRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
function diskWorktreeRoot() {
  let dir = null;
  for (const base of ['/var/tmp', os.tmpdir()]) {
    try {
      const t = spawnSync('stat', ['-f', '-c', '%T', base], { encoding: 'utf8' });
      if (t.status === 0 && t.stdout.trim() !== 'tmpfs') { dir = fs.mkdtempSync(path.join(base, 'quay-wt-test-')); break; }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-wt-test-'));
  _worktreeTestRoots.push(dir);
  return dir;
}

function makeTmp(prefix = 'laydown-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function runInit(workspace, args = [], pluginRoot = pluginDir) {
  // --loop tests need an explicit disk worktree root (the default sibling-of-repo of a /tmp test
  // workspace is tmpfs and is correctly rejected). Inject one BEFORE the caller's args so an
  // explicit --worktree-root in args wins (last flag wins in the parser).
  const loop = args.includes('--loop');
  const extra = loop && !args.some((a) => a === '--worktree-root') ? ['--worktree-root', diskWorktreeRoot()] : [];
  return spawnSync('bash', [path.join(pluginRoot, 'scripts', 'quay-init.sh'), ...extra, ...args],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
}

const INIT_ARGS = (ws) => ['--loop', '--root', ws, '--project', 'proj',
  '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];

// ── AC1 (b) dependency closure: consumers pull their same-dir siblings in ─────────────────────────
test('AC1 — dependency closure: transcript-delivery-check.ts + cap-from-gate.ts are laid down (sibling deps of laid-down consumers)', () => {
  // AC3 (gap-serial-install-family-shared-prebuilt-fixture): the install is pure setup — copy it
  // from the shared prebuilt fixture (the source-reference assertions below read pluginDir directly).
  const { ws, install: r } = laydownWorkspace();
  try {
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // The consumers ARE laid down (prefix-derived / explicit).
    for (const s of ['send-keys-reliable.sh', 'inner-session-check.sh', 'cap-from-gate.sh']) {
      assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', s)), `consumer must be laid down: plugin/scripts/${s}`);
    }
    // Their ${SCRIPT_DIR} siblings must be laid down too (铺了消费者必然铺依赖).
    for (const s of ['transcript-delivery-check.ts', 'cap-from-gate.ts']) {
      assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', s)), `sibling dependency must be laid down: plugin/scripts/${s}`);
    }
    // The source scripts actually reference their siblings (the test pins the mechanism, not a fixture).
    const sendKeys = fs.readFileSync(path.join(pluginDir, 'scripts', 'send-keys-reliable.sh'), 'utf8');
    assert.match(sendKeys, /\$\{SCRIPT_DIR\}\/transcript-delivery-check\.ts/, 'send-keys-reliable.sh must reference its sibling checker');
    const capGate = fs.readFileSync(path.join(pluginDir, 'scripts', 'cap-from-gate.sh'), 'utf8');
    assert.match(capGate, /\$SCRIPT_DIR\/cap-from-gate\.ts/, 'cap-from-gate.sh must reference its sibling runner');
  } finally { cleanup(ws); }
});

// AC1/AC3 negative — the bare-referenced sibling is now in the verification surface: removing it
// from the plugin makes the install FAIL (dependency-not-landed), never a silent broken laydown.
test('AC1/AC3 negative — removing transcript-delivery-check.ts from the plugin makes --loop FAIL (dependency-not-landed)', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.rmSync(path.join(src, 'scripts', 'transcript-delivery-check.ts'), { force: true });
    const ws = makeTmp();
    try {
      const r = runInit(ws, INIT_ARGS(ws), src);
      assert.notEqual(r.status, 0, '--loop must FAIL when a laid-down script\'s sibling dependency cannot land');
      assert.match(r.stderr, /dependency-not-landed/, 'must use the dependency-not-landed category');
      assert.match(r.stderr, /transcript-delivery-check\.ts/, 'must name the missing sibling dependency');
      assert.match(r.stderr, /send-keys-reliable\.sh/, 'must name the consumer script');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ── AC2 (a) bare-filename resolution in the mechanism corpus ──────────────────────────────────────
test('AC2 — a mechanism-corpus doc writing a BARE filename (no prefix) that exists under plugin/scripts/ is laid down + verify passes', () => {
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    // A NEW mechanism script (exists in the plugin, NOT otherwise derivable).
    const bareScript = path.join(src, 'scripts', 'laydown-bare-check.sh');
    fs.writeFileSync(bareScript, '#!/usr/bin/env bash\necho bare-resolved-mechanism\n', 'utf8');
    fs.chmodSync(bareScript, 0o755);
    // The cold-start skill (mechanism corpus) references it by BARE filename — no plugin/scripts/ prefix.
    const coldStart = path.join(src, 'skills', 'cold-start', 'SKILL.md');
    fs.appendFileSync(coldStart, '\nBare-filename mechanism reference: `laydown-bare-check.sh` (bare, no prefix — the derivation must resolve it).\n', 'utf8');
    const ws = makeTmp();
    try {
      const r = runInit(ws, INIT_ARGS(ws), src);
      assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
      assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'laydown-bare-check.sh')),
        'the bare-filename-referenced script must be laid down (AC2)');
      assert.match(r.stdout, /verify-referenced-landed: OK/, 'verify must pass with the bare-ref\'d script landed');
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ── AC3 the verify surface now covers the bare reference (no shared blind spot) ───────────────────
test('AC3 — the shipped cold-start bare reference resolves + lands; the verify surface covers it (no shared blind spot)', () => {
  const coldStart = fs.readFileSync(path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md'), 'utf8');
  // The bare-filename reference the task's causal chain rode on (可留 — kept, now caught + marked):
  assert.match(coldStart, /`transcript-delivery-check\.ts`/, 'cold-start must still carry the bare-filename reference');
  assert.ok(fs.existsSync(path.join(pluginDir, 'scripts', 'transcript-delivery-check.ts')),
    'the bare-referenced script must exist under plugin/scripts/ (the existence-resolution surface)');
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'transcript-delivery-check.ts')),
      'the bare-referenced script must be laid down (both the laydown AND verify use the expanded derivation)');
    assert.match(r.stdout, /verify-referenced-landed: OK/, 'verify must pass');
  } finally { cleanup(ws); }
});

// ── AC4 send-keys-reliable.sh fail-loud precondition ─────────────────────────────────────────────
test('AC4 — send-keys-reliable.sh FAILS LOUD at startup when its CHECKER is missing (never a silent assignment)', () => {
  const tmp = makeTmp();
  try {
    const scriptDir = path.join(tmp, 'plugin', 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    const script = path.join(scriptDir, 'send-keys-reliable.sh');
    fs.copyFileSync(path.join(pluginDir, 'scripts', 'send-keys-reliable.sh'), script);
    fs.chmodSync(script, 0o755);
    // NO transcript-delivery-check.ts in the temp script dir — the CHECKER is missing.
    const r = spawnSync('bash', [script], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'must exit 1 (fail loud) when the CHECKER is missing');
    assert.match(r.stderr, /transcript-delivery-check\.ts/, 'must name the missing checker');
    assert.match(r.stderr, /fail loud/, 'must state the fail-loud resolution');
  } finally { cleanup(tmp); }
});
