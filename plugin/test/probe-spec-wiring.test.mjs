// @test-group engine
// probe-spec-wiring.test.mjs — DIR-056: verifies that readProbeSpec and
// resolveRoutineAction are correctly wired for probe-spec-based routines.
// Tests the plugin's own copies (plugin/scripts/), never the exp5 path.
//
// Run: node --test plugin/test/probe-spec-wiring.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');

import { readProbeSpec } from '../scripts/read-probe-spec.ts';
import { resolveRoutineAction } from '../scripts/routine-scheduler.ts';
import { resolveKernelPluginRoot } from '../scripts/driver-runtime.ts';
import { probeRoutinesFromConfig, resolveProbeSpecRoot } from '../scripts/probe-routine.ts';

// ── T1: malformed YAML frontmatter → PROBE-SPEC FAIL-CLOSED ──────────────────
test('readProbeSpec: malformed YAML frontmatter → throws PROBE-SPEC FAIL-CLOSED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t1-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    fs.writeFileSync(path.join(probesDir, 'bad-yaml.md'), '---\n: invalid: yaml: [\n---\nObjective text\n');
    await assert.rejects(
      async () => readProbeSpec('bad-yaml', tmpDir),
      (err) => {
        assert.ok(err.message.includes('PROBE-SPEC FAIL-CLOSED'), `expected PROBE-SPEC FAIL-CLOSED, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── T2: missing instrument field → PROBE-SPEC FAIL-CLOSED ───────────────────
test('readProbeSpec: missing instrument field → throws PROBE-SPEC FAIL-CLOSED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t2-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    fs.writeFileSync(path.join(probesDir, 'no-instrument.md'), '---\nfallback: none\n---\nObjective text\n');
    await assert.rejects(
      async () => readProbeSpec('no-instrument', tmpDir),
      (err) => {
        assert.ok(err.message.includes('PROBE-SPEC FAIL-CLOSED'), `expected PROBE-SPEC FAIL-CLOSED, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── T3: file not found → PROBE-SPEC FAIL-CLOSED ─────────────────────────────
test('readProbeSpec: file not found → throws PROBE-SPEC FAIL-CLOSED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t3-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    // Do NOT create the file — it should not be found
    await assert.rejects(
      async () => readProbeSpec('nonexistent', tmpDir),
      (err) => {
        assert.ok(err.message.includes('PROBE-SPEC FAIL-CLOSED'), `expected PROBE-SPEC FAIL-CLOSED, got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── T4: all 4 shipped probe specs parse successfully ─────────────────────────
// DIR-070 (M-DIR119-C-CANARY, 2026-07-27) AC8 re-verification: this list previously named only 3
// probes, silently excluding `browser-explorer` (DIR-069/M138) from the "all shipped probe specs
// parse" check ever since it shipped — a real, found gap (not asserted), fixed here so the 4th
// probe is exercised by the SAME end-to-end wiring test as the other 3, not merely present on
// disk. `plugin/probes/` is re-globbed (not hand-listed) so a future 5th probe can't repeat this.
test('all shipped probe specs parse → valid { instrument, output_routing.default, objective }', () => {
  const probesDir = path.join(pluginRoot, 'probes');
  const names = fs.readdirSync(probesDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
  assert.ok(names.includes('browser-explorer'), 'browser-explorer.md (DIR-069) must be discovered');
  assert.ok(names.length >= 4, `expected >=4 shipped probes, found: ${JSON.stringify(names)}`);
  for (const name of names) {
    const spec = readProbeSpec(name, pluginRoot);
    assert.ok(typeof spec.instrument === 'string' && spec.instrument.length > 0,
      `${name}: instrument must be a non-empty string, got: ${JSON.stringify(spec.instrument)}`);
    assert.ok(spec.output_routing && typeof spec.output_routing === 'object' && !Array.isArray(spec.output_routing),
      `${name}: output_routing must be an object`);
    assert.ok(typeof spec.output_routing.default === 'string' && spec.output_routing.default.length > 0,
      `${name}: output_routing.default must be a non-empty string`);
    assert.ok(typeof spec.objective === 'string' && spec.objective.length > 0,
      `${name}: objective must be non-empty string`);
  }
});

// ── T5: resolveRoutineAction dispatch: back-compat ───────────────────────────
test('resolveRoutineAction({dispatch:"some-action"}, "/fake/root") → {kind:"dispatch", action:"some-action"}', () => {
  const r = resolveRoutineAction({ name: 'test-routine', trigger: 'every(1)', dispatch: 'some-action' }, '/fake/root');
  assert.equal(r.kind, 'dispatch');
  assert.equal(r.action, 'some-action');
});

// ── T6: resolveRoutineAction probe: form ─────────────────────────────────────
test('resolveRoutineAction({probe:"self-validation"}, "/fake/root") → {kind:"probe", name:"self-validation"}', () => {
  const r = resolveRoutineAction({ name: 'test-routine', trigger: 'every(1)', probe: 'self-validation' }, '/fake/root');
  assert.equal(r.kind, 'probe');
  assert.equal(r.name, 'self-validation');
  assert.equal(r.pluginRoot, '/fake/root');
});

// ── T7: probe: takes priority over dispatch: when both present ───────────────
test('resolveRoutineAction({probe:"arch",dispatch:"old-action"}, "/fake/root") → probe wins', () => {
  const r = resolveRoutineAction(
    { name: 'test-routine', trigger: 'every(1)', probe: 'arch', dispatch: 'old-action' },
    '/fake/root'
  );
  assert.equal(r.kind, 'probe', `expected probe to win; got kind="${r.kind}"`);
  assert.equal(r.name, 'arch');
});

// ── T8: output_routing merge — default preserved, spec values merged ─────────
test('readProbeSpec with output_routing:{defect:"milestone-candidate"} → merged output_routing preserves default', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-spec-t8-'));
  try {
    const probesDir = path.join(tmpDir, 'probes');
    fs.mkdirSync(probesDir);
    fs.writeFileSync(
      path.join(probesDir, 'custom-routing.md'),
      '---\ninstrument: none\noutput_routing:\n  defect: milestone-candidate\n---\nObjective text\n'
    );
    const spec = readProbeSpec('custom-routing', tmpDir);
    assert.deepEqual(spec.output_routing, {
      default: 'milestone-candidate',
      defect: 'milestone-candidate',
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root
//
// 缺陷：quality-gate-driver 装配 probe 轨道时把规格根钉在 `<workspace>/plugin`（项目根），而 probe
// 规格随**插件**发布、住在插件安装根下。第三方宿主（quay-init 之后没有 vendored `plugin/`）⇒ 每条
// 声明都会被 `readProbeSpec` 判 `PROBE-SPEC FAIL-CLOSED`，整条轨道静默不跑。
// 修法：规格根 = `resolveProbeSpecRoot()`（= 本 kernel 的 plugin root；`QUAY_PLUGIN_ROOT` 是测试缝）。
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ── AC1：位置判定（⛔ 关键词）+ 双向负控制 ────────────────────────────────────────────────────
// 只看代码位置：注释里复述旧写法不算命中（硬规则 2）。负控制是**同一谓词**对改前 develop 的那一行
// 必须命中——否则一个恒零的 grep 也会"通过"。
const ROOT_ANCHORED_PROBE_ROOT_RE = /pluginRoot:\s*path\.join\(\s*rootDir\s*,\s*"plugin"\s*\)/;

function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function namesRootAnchoredProbeRoot(src) {
  return ROOT_ANCHORED_PROBE_ROOT_RE.test(codeOnly(src));
}

test('AC1 — driver no longer anchors the probe spec root at <rootDir>/plugin (predicate is falsifiable)', () => {
  const src = fs.readFileSync(path.join(pluginRoot, 'scripts', 'quality-gate-driver.ts'), 'utf8');
  assert.equal(
    namesRootAnchoredProbeRoot(src),
    false,
    'quality-gate-driver.ts must not pass pluginRoot: path.join(rootDir, "plugin") to the probe track',
  );

  // 负控制（非零侧）：改前 develop 的 callsite 逐字放进同一谓词 ⇒ 必须命中。
  const preFixCallsite = [
    '  const probeSelection = probeRoutinesFromConfig(rootDir, {',
    '    pluginRoot: path.join(rootDir, "plugin"),',
    '    probeTimeoutMs,',
    '  });',
  ].join('\n');
  assert.equal(namesRootAnchoredProbeRoot(preFixCallsite), true, 'predicate must fire on the pre-fix callsite');

  // 负控制（位置侧）：注释里复述旧写法不算命中。
  assert.equal(
    namesRootAnchoredProbeRoot('// 旧写法 `pluginRoot: path.join(rootDir, "plugin")` 已删\n'),
    false,
    'comment mentions must not count as a hit',
  );

  // 生产 callsite 不再自带 pluginRoot 参数（根由 probe-routine 的单一入口解析）。
  const call = src.match(/probeRoutinesFromConfig\(rootDir, \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(call, 'production callsite probeRoutinesFromConfig(rootDir, {...}) must exist');
  assert.equal(/pluginRoot\s*:/.test(call[1]), false, 'production callsite must delegate pluginRoot to resolveProbeSpecRoot()');
});

// ── AC2：第三方宿主（无 plugin/probes/）——规格改从插件根解析 ─────────────────────────────────
/** 一个**第三方宿主**形状的工作区：有 `.quay/config.yml` 的 `loop.routines:`，但**没有** `plugin/`。 */
function makeThirdPartyRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  fs.writeFileSync(path.join(root, '.quay', 'config.yml'), [
    'loop:',
    '  routines:',
    '    - name: architecture-analysis',
    '      trigger: interval:1440m',
    '      probe: architecture-analysis',
    '',
  ].join('\n'), 'utf8');
  spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf8' });
  return root;
}

const CONTRACT_OUTPUT = '{"findings":[],"shards":1,"inventory":{"files":0},"notes":"fixture"}';

test('AC2 — third-party host: probe spec resolves under the PLUGIN root, and the pre-fix root fails closed', async () => {
  const root = makeThirdPartyRoot('probe-spec-tp-');
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = pluginRoot; // 独立插件根（与本仓库项目根不同：root 下无 plugin/）
  try {
    assert.equal(fs.existsSync(path.join(root, 'plugin')), false, 'fixture must NOT carry a vendored plugin/');

    // 改前语义（显式传 <root>/plugin，即修复前 callsite 的实参）：规格读不到 ⇒ not-evaluated + FAIL-CLOSED。
    const before = probeRoutinesFromConfig(root, {
      pluginRoot: path.join(root, 'plugin'),
      probeTimeoutMs: 5_000,
    });
    assert.equal(before.routines.length, 1, 'the declared routine is assembled either way');
    const beforeFact = (await before.routines[0].run({}))[0];
    assert.equal(beforeFact.state, 'not-evaluated');
    assert.match(
      beforeFact.reason,
      /PROBE-SPEC FAIL-CLOSED: probe spec not found at .*plugin[\\/]probes[\\/]architecture-analysis\.md/,
      `pre-fix root must fail closed on the project-root path; got: ${beforeFact.reason}`,
    );

    // 改后：生产入口不传 pluginRoot ⇒ resolveProbeSpecRoot() = 插件根 ⇒ 规格读得到，例程真的跑到 spawn。
    const after = probeRoutinesFromConfig(root, {
      probeTimeoutMs: 5_000,
      probeArgv: () => [process.execPath, '-e', 'process.exit(0)'],
      spawnFn: async () => ({ status: 0, stdout: CONTRACT_OUTPUT, stderr: '', error: null }),
      filingEnabled: false,
    });
    assert.equal(after.pluginRoot, pluginRoot, 'resolved spec root must be the kernel plugin root, not <root>/plugin');
    assert.equal(after.routines.length, 1);
    const afterFact = (await after.routines[0].run({}))[0];
    assert.equal(afterFact.state, 'verified', `probe should run from the plugin root; got ${afterFact.state}: ${afterFact.reason}`);
    assert.equal(afterFact.value.fired, true);
    assert.equal(afterFact.value.probe, 'architecture-analysis');
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2 反向：本仓库（有 plugin/）行为不变 ──────────────────────────────────────────────────
test('AC2 reverse — source checkout (has plugin/) resolves to <repo>/plugin exactly as before', () => {
  const prev = process.env.QUAY_PLUGIN_ROOT;
  delete process.env.QUAY_PLUGIN_ROOT;
  try {
    const resolved = resolveProbeSpecRoot();
    assert.equal(
      fs.realpathSync(resolved),
      fs.realpathSync(pluginRoot),
      'in the source checkout the kernel plugin root IS <repo>/plugin (regression: unchanged behavior)',
    );
    // 同一根继续供给规格正文（不是只换了个字符串）。
    const spec = readProbeSpec('architecture-analysis', resolved);
    assert.ok(spec.objective.length > 0);
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = prev;
  }
});

// ── AC3：单一解析根（复用 resolveKernelPluginRoot，⛔ 不另造第二套）────────────────────────────
test('AC3 — the probe spec root is the kernel plugin root (single implementation, explicit override wins)', () => {
  assert.equal(
    resolveProbeSpecRoot(),
    resolveKernelPluginRoot(),
    'default must be exactly the existing kernel resolver — no second implementation',
  );
  assert.equal(resolveProbeSpecRoot('/explicit/plugin/root'), '/explicit/plugin/root');
  assert.equal(resolveProbeSpecRoot(''), resolveKernelPluginRoot(), 'blank override is not an override');
});

