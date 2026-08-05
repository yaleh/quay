// @test-group engine
// plugin-vendor-standalone.test.mjs — M120 Stage 3.2 (DIR-060).
//
// Proves the vendored Core bundle runs STANDALONE with ZERO node_modules and
// ZERO sibling files: copy dist/quay.js ALONE into an isolated scratch dir that
// has NO node_modules anywhere and NO package.json beside the bundle, then run
// --help / --version and a raw MCP `initialize` round-trip against the copy.
// This mirrors how Claude Code copies only the plugin/ subtree into its install
// cache (no repo node_modules follows it).
//
// gap-dist-runtime-not-self-contained-reads-external-package-json made the
// plan's original "copy dist/quay.js alone" wording TRUE: src/version.ts now
// EMBEDS the version at build time (esbuild json loader inlines package.json),
// so the bundle no longer reads a sibling package.json at runtime. The old
// GROUNDED REFINEMENT ("copying quay.js truly alone crashes on the version
// read") was pinned to the pre-fix behavior and is now obsolete — this test
// asserts the fixed behavior: the single loose bundle runs standalone.
//
// Coverage (ROUND-2 correction): this is a new `.test.mjs` file (code branch of
// the classifier), so its own coverage IS measured and pasted — expected ~100%
// (a linear sequence of copy + subprocess-invocation assertions). NOTE
// (disclosed, not a waiver): Node's --experimental-test-coverage EXCLUDES the
// test file it is executing from its own report and cannot reach into the
// spawned external bundle; the measurable evidence of full execution is that
// every subtest passes.
//
// Run: node --test --experimental-test-coverage plugin/test/plugin-vendor-standalone.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');
const vendorDir = path.join(pluginDir, 'vendor', 'quay');
// The Core mcp server calls loadConfig() at startup (providers connect only
// LAZILY, on tool calls — never during `initialize`), so the standalone run
// needs a parseable .quay/config.yml with an enabled provider. Its mcp_entry
// points at the repo's native provider but is never spawned by `initialize`.
const nativeBin = path.join(repoRoot, 'packages', 'quay-native', 'bin', 'quay-native.ts');
const nativeProviderDir = path.dirname(nativeBin);

function writeConfig(root, tasksDir) {
  mkdirSync(path.join(root, '.quay'), { recursive: true });
  writeFileSync(
    path.join(root, '.quay', 'config.yml'),
    [
      'providers:',
      '  native:',
      '    enabled: true',
      `    path: "${nativeProviderDir.replaceAll('\\', '\\\\')}"`,
      `    tasks_dir: "${tasksDir.replaceAll('\\', '\\\\')}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll('\\', '\\\\')}", "mcp"]`,
      '    env:',
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll('\\', '\\\\')}"`,
      '',
    ].join('\n')
  );
}

// Copy dist/quay.js ALONE into an isolated scratch dir — no package.json, no
// node_modules anywhere (gap-dist-runtime-not-self-contained-reads-external-
// package-json: the bundle must run standalone because version.ts embeds the
// version at build time, so a sibling package.json is NOT a runtime dependency).
function isolatedCopy() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'quay-m120-vendor-standalone-'));
  const copy = path.join(root, 'vendor-quay');
  mkdirSync(path.join(copy, 'dist'), { recursive: true });
  copyFileSync(path.join(vendorDir, 'dist', 'quay.js'), path.join(copy, 'dist', 'quay.js'));
  return { root, bundle: path.join(copy, 'dist', 'quay.js') };
}

function hasNodeModules(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules') return true;
        stack.push(path.join(d, e.name));
      }
    }
  }
  return false;
}

test('vendor bundle runs --help / --version from an isolated copy with zero node_modules AND zero package.json', () => {
  const { root, bundle } = isolatedCopy();
  try {
    assert.ok(!hasNodeModules(root), 'the isolated copy must contain NO node_modules');
    assert.ok(!existsSync(path.join(root, 'vendor-quay', 'package.json')), 'the isolated copy must have NO package.json beside the bundle');
    const help = execFileSync('node', [bundle, '--help'], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, NODE_PATH: '' },
    });
    assert.match(help, /Usage/, 'the standalone vendor bundle must print usage');
    // gap-dist-runtime-not-self-contained-reads-external-package-json: --version
    // must print the real version from the BUILD-TIME-inlined constant, with no
    // sibling package.json to read — the pre-fix bundle crashed with ENOENT here.
    const version = execFileSync('node', [bundle, '--version'], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, NODE_PATH: '' },
    }).trim();
    assert.match(version, /^\d+\.\d+\.\d+$/, '--version must print a semver version (build-time inlined, no ENOENT)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vendor bundle serves a raw MCP initialize round-trip standalone', async () => {
  const { root, bundle } = isolatedCopy();
  const tasksDir = path.join(root, 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  writeConfig(root, tasksDir);
  const child = spawn('node', [bundle, 'mcp'], {
    cwd: root,
    env: { ...process.env, NODE_PATH: '' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  try {
    const initReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'm120-vendor', version: '0' } },
    };
    const result = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('MCP initialize timed out')), 15000);
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        for (const line of buf.split('\n')) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === 1 && msg.result) { clearTimeout(timer); resolve(msg.result); return; }
          } catch { /* partial line */ }
        }
      });
      child.on('error', reject);
      child.stdin.write(JSON.stringify(initReq) + '\n');
    });
    assert.ok(result.protocolVersion, 'initialize result must carry a protocolVersion');
    assert.ok(result.serverInfo && result.serverInfo.name, 'initialize result must carry serverInfo.name');
  } finally {
    child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

test('sanity: the bundle is the ESM build (createRequire banner) — the reason it needs no deps', () => {
  const src = readFileSync(path.join(vendorDir, 'dist', 'quay.js'), 'utf8');
  assert.match(src, /createRequire/);
  assert.ok(!existsSync(path.join(vendorDir, 'node_modules')), 'the committed vendor tree must ship no node_modules');
});
