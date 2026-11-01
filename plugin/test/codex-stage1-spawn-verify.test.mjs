// @test-group engine
// plugin/test/codex-stage1-spawn-verify.test.mjs — gap-meta-codex-stage1-spawn-verify-sh
// (SPEC-codex-long-term-support-2026-10-29 §4.3 Task A, goal_ac AC-927) and
// gap-codex-mcp-cwd-any-root-spawn-verify:
// the codex-stage1-spawn-verify.sh self-check and its integration into selfcheck. Proves
// the configured quay MCP server actually SPAWNS + completes an MCP initialize handshake
// from the repo root (the launch point a TRACKED config can support — see .codex/config.toml),
// and that a bad cwd or a relative-args config with no cwd fails LOUD instead of silently
// "enabled but not running".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');
const spawnVerify = path.join(pluginDir, 'scripts', 'codex-stage1-spawn-verify.sh');
const selfcheck = path.join(pluginDir, 'scripts', 'codex-stage1-selfcheck.sh');
const config = path.join(repoRoot, '.codex', 'config.toml');

// A minimal repo-layout fixture that carries a COPY of the real spawn-verify script plus a
// chosen .codex/config.toml, so the negative arms exercise the script against a bad config
// without mutating the live repo config.
function makeFixture(configBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-spawn-fixture-'));
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages', 'quay'), { recursive: true });
  fs.copyFileSync(spawnVerify, path.join(root, 'plugin', 'scripts', 'codex-stage1-spawn-verify.sh'));
  fs.chmodSync(path.join(root, 'plugin', 'scripts', 'codex-stage1-spawn-verify.sh'), 0o755);
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), configBody);
  return root;
}

test('config pins NO machine-specific cwd for [mcp_servers.quay]', () => {
  const cfg = fs.readFileSync(config, 'utf8');
  assert.match(cfg, /^\[mcp_servers\.quay\]/m, 'must register [mcp_servers.quay]');
  // codex resolves a configured cwd as-is (absolute) or against the session cwd (relative),
  // and expands no placeholder — so a TRACKED config can only stay portable by declaring
  // none. An absolute cwd here is one machine's checkout path: it makes the server fail to
  // spawn on every other checkout (observed on CI, 2026-11-02), silently.
  assert.doesNotMatch(cfg, /^cwd\s*=\s*"/m,
    '.codex/config.toml is TRACKED — it must not pin a machine-specific cwd');
});

test('spawn-verify exits 0 from the repo root (real spawn + initialize)', () => {
  const r = spawnSync('bash', [spawnVerify], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(r.status, 0, `spawn-verify must exit 0 from the repo root; output:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /initialize handshake/);
  assert.match(r.stdout, /RESULT: PASS/);
});

test('spawn-verify still fails LOUD from a subdirectory (no silent "enabled but not running")', () => {
  // The narrowed guarantee, pinned mechanically: with the live (cwd-less) config the server
  // is only spawnable with the repo root as cwd. A subdirectory launch must be a LOUD
  // failure, never a silent no-op — that is the failure class SPEC §3.2 exists to end.
  const r = spawnSync('bash', [spawnVerify], { cwd: path.join(repoRoot, 'packages', 'quay'), encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'spawn-verify must exit non-zero from a subdirectory under the live config');
  assert.match(r.stdout, /RESULT: FAIL/);
});

test('spawn-verify exits non-zero when cwd points to a nonexistent path', () => {
  const fx = makeFixture(
    '[mcp_servers.quay]\n' +
    'command = "node"\n' +
    'args = ["packages/quay/bin/quay.ts", "mcp"]\n' +
    'cwd = "/nonexistent/definitely-not-here"\n'
  );
  try {
    const r = spawnSync('bash', [path.join(fx, 'plugin', 'scripts', 'codex-stage1-spawn-verify.sh')],
      { cwd: path.join(fx, 'packages', 'quay'), encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'spawn-verify must exit non-zero on a nonexistent cwd');
    assert.match(r.stdout, /RESULT: FAIL/);
  } finally {
    fs.rmSync(fx, { recursive: true, force: true });
  }
});

test('spawn-verify exits non-zero when args are relative and no cwd is set', () => {
  const fx = makeFixture(
    '[mcp_servers.quay]\n' +
    'command = "node"\n' +
    'args = ["packages/quay/bin/quay.ts", "mcp"]\n'
  );
  try {
    const r = spawnSync('bash', [path.join(fx, 'plugin', 'scripts', 'codex-stage1-spawn-verify.sh')],
      { cwd: path.join(fx, 'packages', 'quay'), encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'spawn-verify must exit non-zero for relative args + no cwd');
    assert.match(r.stdout, /RESULT: FAIL/);
  } finally {
    fs.rmSync(fx, { recursive: true, force: true });
  }
});

test('selfcheck runs the spawn-verify check (no longer config-only)', () => {
  const r = spawnSync('bash', [selfcheck], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(r.status, 0, `selfcheck must exit 0; output:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /spawn-verify: quay MCP server spawned \+ initialized/);
});
