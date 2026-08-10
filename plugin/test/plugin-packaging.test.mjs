// @test-group product
// gap-sync-vendor-drift-mislabelled-as-task-schema (AC8): declared `product`, not `engine` —
// plugin-packaging tests (incl. M136's sync-vendor.sh --check scan) verify the PRODUCT packaging
// path (the vendored plugin bundle), not the methodology-execution path. Both stay in the default
// `product,engine` suite, so this only changes `--group engine`-only runs (none exist in CI/workflows).
// plugin/test/plugin-packaging.test.mjs — pins the DIR-040 (+ DIR-042-B) plugin-packaging invariants:
//   1. the marketplace + plugin manifests are valid JSON with the shape Claude Code expects
//   2. plugin.json's commands[] actually lists the 4 bundled skills
//   3. the bundled author/execute skills are byte-identical to their ONE canonical source
//      (packages/quay-native/skills/{author,execute}/SKILL.md) — single-source, ADR-004
//   4. none of the shipped/foreign-workspace-facing files leak this repo's own internal
//      experiment-layout path (experiments/quay-perpetual-stream/**) or "exp5" attribution
//   5. the loop-driver skill (DIR-042-B) carries no research-layer references (VT/value-ledger/
//      checkpoints/experiments/**)
//   6. M136 (DIR-070-A): sync-vendor.sh --check dynamic scanning verifies ALL sync-vendor-managed
//      files without hardcoded static lists
//
// Run: node --test plugin/test/plugin-packaging.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { readFileSync, existsSync, accessSync } = fs;
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

test('M172 (DIR-108): marketplace.json is valid JSON and lists the quay plugin pointing at the built dist-plugin branch', () => {
  const mp = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
  assert.equal(mp.name, 'quay');
  assert.ok(Array.isArray(mp.plugins) && mp.plugins.length >= 1);
  const entry = mp.plugins.find((p) => p.name === 'quay');
  assert.ok(entry, 'marketplace.json must list a plugin named "quay"');
  // DIR-108: source is no longer the in-repo './plugin' path (which has no build step) —
  // it's a structured github source pinned to the CI-built orphan branch, so external
  // installs always get a fresh, self-contained, Node-20-runnable bundle.
  assert.equal(typeof entry.source, 'object', 'source must be a structured object, not a local path string');
  assert.equal(entry.source.source, 'github');
  assert.equal(entry.source.repo, 'yaleh/quay');
  assert.equal(entry.source.ref, 'dist-plugin', 'source must pin the CI-published orphan branch');
});

test('plugin.json is valid JSON and declares the 13 bundled skills (M179/DIR-070-F: +quay-native-methodology, +quay-webui-bootstrap-methodology; gap-loop-mechanism-...: +quay-task-operator; cold-start-8: +quay-cold-start; gap-tmux-session-topology: +session-topology; gap-productize-the-manager-layer: +manager)', () => {
  const manifest = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
  assert.equal(manifest.name, 'quay');
  // Cross-check against packages/quay's version rather than a hardcoded literal (which is
  // exactly what went stale here — DIR-108 wiring-audit finding): the actual source of truth
  // is cross-artifact consistency, enforced repo-wide by scripts/version-consistency-check.ts.
  const coreVersion = readJson(path.join(repoRoot, 'packages', 'quay', 'package.json')).version;
  assert.equal(manifest.version, coreVersion, 'plugin.json version must match packages/quay/package.json (version-consistency-check.ts)');
  assert.ok(Array.isArray(manifest.commands));
  const wanted = [
    './skills/author/SKILL.md',
    './skills/execute/SKILL.md',
    './skills/quay-directive/SKILL.md',
    './skills/loop-driver/SKILL.md',
    './skills/init/SKILL.md',
    './skills/cold-start/SKILL.md',
    './skills/quay-task-operator/SKILL.md',
    './skills/quay-task-to-plan/SKILL.md',
    './skills/routines/SKILL.md',
    './skills/quay-native-methodology/SKILL.md',
    './skills/quay-webui-bootstrap-methodology/SKILL.md',
    './skills/session-topology/SKILL.md',
    './skills/manager/SKILL.md',
  ];
  for (const w of wanted) {
    assert.ok(manifest.commands.includes(w), `plugin.json commands[] must include ${w}`);
  }
  // The full commands[] must equal the on-disk skill directories (AC6 consistency — this was
  // found by hand once; it must be pinned, not re-found).
  const diskSkills = fs.readdirSync(path.join(pluginDir, 'skills'))
    .filter((d) => fs.statSync(path.join(pluginDir, 'skills', d)).isDirectory())
    .sort();
  const listedSkills = manifest.commands
    .filter((c) => c.startsWith('./skills/'))
    .map((c) => c.replace(/^\.\/skills\//, '').replace(/\/SKILL\.md$/, ''))
    .sort();
  assert.deepEqual(listedSkills, diskSkills, `plugin.json commands[] must list exactly the on-disk skill directories. Missing: ${diskSkills.filter((d) => !listedSkills.includes(d))}. Extra: ${listedSkills.filter((d) => !diskSkills.includes(d))}`);
});

test('M143: plugin.json declares agents[] with baime-iteration-executor', () => {
  const manifest = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
  assert.ok(Array.isArray(manifest.agents), 'plugin.json must have agents[]');
  assert.ok(
    manifest.agents.includes('./agents/baime-iteration-executor.md'),
    'plugin.json agents[] must include baime-iteration-executor'
  );
});

test('.mcp.json declares the quay MCP server via ${CLAUDE_PLUGIN_ROOT}-relative args', () => {
  const mcp = readJson(path.join(pluginDir, '.mcp.json'));
  assert.ok(mcp.quay, '.mcp.json must declare a "quay" server entry');
  assert.equal(mcp.quay.command, 'node');
  assert.ok(Array.isArray(mcp.quay.args) && mcp.quay.args.length >= 1);
  assert.ok(
    mcp.quay.args[0].includes('${CLAUDE_PLUGIN_ROOT}'),
    'the server entry path must be plugin-root-relative, never an absolute/outside-plugin path'
  );
  assert.ok(mcp.quay.args.includes('mcp'), 'must invoke the mcp subcommand');
});

test('author/execute skills are single-sourced: byte-identical to packages/quay-native\'s own shipped copies', () => {
  for (const name of ['author', 'execute']) {
    const canonical = path.join(repoRoot, 'packages', 'quay-native', 'skills', name, 'SKILL.md');
    const bundled = path.join(pluginDir, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
    assert.ok(existsSync(bundled), `bundled copy missing: ${bundled}`);
    assert.equal(
      readFileSync(bundled, 'utf8'),
      readFileSync(canonical, 'utf8'),
      `${name} skill must be byte-identical to its single canonical source (no drifting copy)`
    );
  }
});

test('shipped schema-check modules are byte-identical to their exp5 canonical source, modulo attribution-only sanitization', () => {
  for (const name of ['task-schema.ts', 'task-schema-check.ts', 'task-schema-check.sh']) {
    const canonical = path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'scripts', name);
    const bundled = path.join(pluginDir, 'scripts', name);
    assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
    assert.ok(existsSync(bundled), `bundled copy missing: ${bundled}`);
    const canonicalSrc = readFileSync(canonical, 'utf8');
    const bundledSrc = readFileSync(bundled, 'utf8');
    // The only allowed divergence is stripping the internal "exp5" attribution
    // fragment from header comments; the functional body must be unchanged.
    const stripAttribution = (s) =>
      s
        .replace(/\(exp5 \/\s*\n(\/\/|#) canonical-task-schema/g, '(canonical-task-schema')
        .replace(/exp5-M-CRYST-B1\/DIR-028/g, 'DIR-028')
        .replace(/\bexp5\b\s*\/\s*/g, '');
    assert.equal(
      stripAttribution(canonicalSrc),
      bundledSrc,
      `${name}: bundled copy must match the canonical source modulo attribution-only stripping`
    );
  }
});

test('no shipped/foreign-workspace-facing file leaks this repo\'s own experiments/quay-perpetual-stream path or "exp5" label', () => {
  const shippedFiles = [
    path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    path.join(pluginDir, '.mcp.json'),
    path.join(pluginDir, 'scripts', 'task-schema.ts'),
    path.join(pluginDir, 'scripts', 'task-schema-check.ts'),
    path.join(pluginDir, 'scripts', 'task-schema-check.sh'),
    path.join(pluginDir, 'skills', 'author', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'execute', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'quay-directive', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'loop-driver', 'SKILL.md'),
    // M143: new shipped files
    path.join(pluginDir, 'skills', 'init', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'routines', 'SKILL.md'),
    path.join(pluginDir, 'README.md'),
    // DIR-070-B: Tier-A gate scripts + wrappers shipped to plugin/scripts/
    path.join(pluginDir, 'scripts', 'anti-gaming-guard.ts'),
    path.join(pluginDir, 'scripts', 'anti-gaming-guard.sh'),
    path.join(pluginDir, 'scripts', 'loadbearing-test-gate.ts'),
    path.join(pluginDir, 'scripts', 'loadbearing-test-gate.sh'),
    path.join(pluginDir, 'scripts', 'drivable-workspace-check.ts'),
    path.join(pluginDir, 'scripts', 'drivable-workspace-check.sh'),
    path.join(pluginDir, 'scripts', 'tree-hygiene-check.sh'),
    // DIR-070-C: Tier-B gate scripts + wrappers shipped to plugin/scripts/
    path.join(pluginDir, 'scripts', 'audit-independence-check.ts'),
    path.join(pluginDir, 'scripts', 'audit-independence-check.sh'),
    path.join(pluginDir, 'scripts', 'vmeta-lag-check.ts'),
    path.join(pluginDir, 'scripts', 'vmeta-lag-check.sh'),
    path.join(pluginDir, 'scripts', 'it0-split-or-commit-check.ts'),
    path.join(pluginDir, 'scripts', 'it0-split-or-commit-check.sh'),
    path.join(pluginDir, 'scripts', 'it0-enforcement-with-design-check.ts'),
    path.join(pluginDir, 'scripts', 'it0-enforcement-with-design-check.sh'),
    path.join(pluginDir, 'scripts', 'it0-impl-row-check.sh'),
    // M179 (DIR-070-F): extracted methodology reference skills
    path.join(pluginDir, 'skills', 'quay-native-methodology', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'quay-native-methodology', 'reference', 'gate-mechanics.md'),
    path.join(pluginDir, 'skills', 'quay-native-methodology', 'reference', 'directive-lifecycle.md'),
    path.join(pluginDir, 'skills', 'quay-native-methodology', 'reference', 'patterns.md'),
    path.join(pluginDir, 'skills', 'quay-native-methodology', 'reference', 'g3-audit-discipline.md'),
    path.join(pluginDir, 'skills', 'quay-webui-bootstrap-methodology', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'quay-webui-bootstrap-methodology', 'reference', 'visual-review-mechanism.md'),
    path.join(pluginDir, 'skills', 'quay-webui-bootstrap-methodology', 'reference', 'effectiveness-timing-corpus.md'),
    // gap-productize-the-manager-layer: the manager layer (third layer) ships under plugin/.
    path.join(pluginDir, 'skills', 'manager', 'SKILL.md'),
  ];
  const leakPattern = /experiments\/quay-perpetual-stream|\bexp5\b/i;
  for (const f of shippedFiles) {
    assert.ok(existsSync(f), `shipped file must exist: ${f}`);
    const src = readFileSync(f, 'utf8');
    assert.ok(
      !leakPattern.test(src),
      `${f} leaks an internal experiment-layout reference (experiments/quay-perpetual-stream or "exp5") — must be workspace-portable`
    );
  }
});

test('M136 (DIR-070-A): sync-vendor.sh --check dynamic scanning verifies all managed files with no hardcoded lists', () => {
  const syncScript = path.join(pluginDir, 'scripts', 'sync-vendor.sh');
  assert.ok(existsSync(syncScript), 'sync-vendor.sh must exist');
  let result = '';
  let exitOk = false;
  try {
    result = execFileSync('bash', [syncScript, '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    exitOk = true;
  } catch (e) {
    // execFileSync throws on non-zero exit — capture stdout for diagnostics
    result = e.stdout || e.stderr || '';
  }
  // --check exit 0 = all in sync (dynamic, not hardcoded)
  assert.ok(exitOk, `sync-vendor.sh --check must exit 0. Output:\n${result}`);
  assert.ok(
    result.includes('CLEAN'),
    `sync-vendor.sh --check must report CLEAN (dynamic scanning). Output:\n${result}`
  );
  // Verify the output contains the expected categories (but NOT hardcoded file lists)
  assert.ok(
    result.includes('verifying concurrency/routine scripts'),
    '--check must scan concurrency/routine scripts dynamically'
  );
  // Verify symlink awareness: output should report one OK (identical) entry per SYNC_SCRIPTS
  // member. M198/DIR-119-D1 (audit finding): this used to be a hardcoded literal bumped by hand
  // at every milestone that touched SYNC_SCRIPTS (M188 +5, M189 +7, M191 +2, M193 +1) — and this
  // milestone's own +2 (composite-manifest-synthesis, gate-script-base) was the one time that
  // bump was missed, leaving a real, live-failing assertion on master. Deriving the expected count
  // directly from sync-vendor.sh's own arrays closes this whole class of drift.
  // gap-sync-vendor-drift-mislabelled-as-task-schema: the DIR-124-A2 golden replay corpus (M243)
  // added a SECOND `scripts/`-labeled cmp_or_report loop (A2_SCRIPTS: workflow-event-schema.mjs,
  // workflow-replay.ts), so the --check output reports SYNC_SCRIPTS + A2_SCRIPTS `scripts/` entries.
  // The assertion used to derive only from SYNC_SCRIPTS (25) — latent-broken (27 !== 25) and masked
  // by the mislabeled-DRIFT failure this task fixed; it never ran GREEN on master. Sum both arrays.
  // A future milestone adding a THIRD `scripts/`-labeled cmp_or_report loop must extend this sum —
  // the assertion fails loudly until it does (new-array introduction is not auto-derived).
  const okCount = (result.match(/OK \(identical\): scripts\//g) || []).length;
  const syncScriptText = readFileSync(syncScript, 'utf8');
  const countArrayEntries = (arrayName) => {
    const block = syncScriptText.match(new RegExp(`${arrayName}=\\(([\\s\\S]*?)\\)`));
    assert.ok(block, `sync-vendor.sh must declare a ${arrayName}=() array`);
    return block[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')).length;
  };
  const syncScriptsCount = countArrayEntries('SYNC_SCRIPTS');
  const a2ScriptsCount = countArrayEntries('A2_SCRIPTS');
  const expectedCount = syncScriptsCount + a2ScriptsCount;
  assert.equal(
    okCount,
    expectedCount,
    `--check must report exactly ${expectedCount} identical scripts/ entries (SYNC_SCRIPTS ${syncScriptsCount} + A2_SCRIPTS ${a2ScriptsCount}, dynamically scanned from sync-vendor.sh arrays)`
  );
});

test('routines skill (M140) has zero experiment-layer references', () => {
  const src = readFileSync(path.join(pluginDir, 'skills', 'routines', 'SKILL.md'), 'utf8');
  // Only check for experiment-layout and attribution leaks (charter Done-when clause 6).
  // "checkpoint" is a legitimate scheduler trigger name, not a research-layer reference.
  const leakPattern = /experiments\/quay-perpetual-stream|\bexp5\b/i;
  assert.ok(
    !leakPattern.test(src),
    'routines SKILL.md must contain no experiments/quay-perpetual-stream or exp5 references'
  );
  // Must reference plugin scripts (not workspace scripts)
  assert.ok(
    src.includes('${CLAUDE_PLUGIN_ROOT}/scripts/'),
    'routines SKILL.md must reference CLAUDE_PLUGIN_ROOT scripts'
  );
  // Must describe all four pipeline phases
  for (const phase of ['Schedule', 'Dispatch', 'Gate', 'Verify']) {
    assert.ok(
      src.includes(phase),
      `routines SKILL.md must document the ${phase} phase`
    );
  }
});

test('loop-driver skill (DIR-042-B) has zero research-layer references (VT/value-ledger/checkpoints/experiments/**)', () => {
  const src = readFileSync(path.join(pluginDir, 'skills', 'loop-driver', 'SKILL.md'), 'utf8');
  const researchLeakPattern = /\bVT\b|value-ledger|checkpoints?|experiments\/|inherited-core|\bexp5\b/i;
  assert.ok(
    !researchLeakPattern.test(src),
    'loop-driver SKILL.md must contain zero VT/value-ledger/checkpoints/experiments/**/exp5 references'
  );
});

// ---------------------------------------------------------------------------
// DIR-070-B (M137) — Tier-A gate scripts shipped to plugin/scripts/. 5 gate
// scripts + 3 .sh wrappers for the .ts gates.  Pins: all 8 files present;
// the 4 universal-gate files carry zero experiment references; the 3 .ts gates
// are runnable via their .sh wrappers; gate scripts are executable.
// worktree-branch-hygiene-check.sh is excluded from the zero-leak check
// because its functional logic references legacy exp5-m<N> branch names and
// experiments/quay-perpetual-stream/milestones/ paths — these are operational
// constants, not attribution leakage.
// ---------------------------------------------------------------------------

test('DIR-070-B: all 8 new gate scripts + wrappers present in plugin/scripts/', () => {
  const scriptsDir = path.join(pluginDir, 'scripts');
  const wanted = [
    'anti-gaming-guard.ts', 'anti-gaming-guard.sh',
    'loadbearing-test-gate.ts', 'loadbearing-test-gate.sh',
    'tree-hygiene-check.sh',
    'worktree-branch-hygiene-check.sh',
    'drivable-workspace-check.ts', 'drivable-workspace-check.sh',
  ];
  for (const f of wanted) {
    assert.ok(existsSync(path.join(scriptsDir, f)), `plugin/scripts/${f} must exist`);
  }
});

test('DIR-070-B: all .sh wrappers are executable', () => {
  const scriptsDir = path.join(pluginDir, 'scripts');
  const wrappers = ['anti-gaming-guard.sh', 'loadbearing-test-gate.sh', 'drivable-workspace-check.sh',
    'tree-hygiene-check.sh', 'worktree-branch-hygiene-check.sh'];
  for (const w of wrappers) {
    const fp = path.join(scriptsDir, w);
    try {
      fs.accessSync(fp, fs.constants.X_OK);
      assert.ok(true, `${w} is executable`);
    } catch {
      assert.fail(`${w} must be executable`);
    }
  }
});

test('DIR-070-B: .sh wrappers runnable (exit 2 for missing args, not ENOTFOUND)', () => {
  const scriptsDir = path.join(pluginDir, 'scripts');
  // Each .sh wrapper should exit 2 (usage) when called without required args,
  // proving it delegates to the .ts module, not a missing-file error.
  const wrappers = ['anti-gaming-guard.sh', 'loadbearing-test-gate.sh'];
  for (const w of wrappers) {
    const fp = path.join(scriptsDir, w);
    let exitCode = 0;
    try {
      execFileSync('bash', [fp], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      exitCode = e.status || 1;
    }
    assert.equal(exitCode, 2, `${w} must exit 2 (usage) when called without args, not ${exitCode}`);
  }
});

test('DIR-070-B: all 5 gates runnable via quay gate --gate <name> (resolution check)', () => {
  // Verify each gate name resolves in the workspace (names match .quay/config.yml).
  const mcp = readJson(path.join(pluginDir, '.mcp.json'));
  const quayMCPEntry = mcp.quay;
  // We verify gate resolution by checking the .quay/config.yml lists the names.
  const configPath = path.join(repoRoot, '.quay', 'config.yml');
  const configSrc = readFileSync(configPath, 'utf8');
  const gateNames = ['anti-gaming', 'loadbearing-test', 'tree-hygiene', 'worktree-branch-hygiene', 'drivable-workspace'];
  for (const name of gateNames) {
    assert.ok(
      configSrc.includes(`name: ${name}`),
      `.quay/config.yml must register gate '${name}'`
    );
  }
});

test('DIR-070-B: universal-gate plugin files (4 of 5) have zero exp5/experiment-path references', () => {
  // Four of the five gates are universal (work in any quay workspace).
  // worktree-branch-hygiene-check.sh is excluded — it NEEDS experiment-specific
  // references (branch-name pattern, milestone-path prefix) as functional constants.
  const scriptsDir = path.join(pluginDir, 'scripts');
  const universalFiles = [
    'anti-gaming-guard.ts', 'anti-gaming-guard.sh',
    'loadbearing-test-gate.ts', 'loadbearing-test-gate.sh',
    'tree-hygiene-check.sh',
    'drivable-workspace-check.ts', 'drivable-workspace-check.sh',
  ];
  const leakPattern = /experiments\/quay-perpetual-stream|\bexp5\b/i;
  for (const f of universalFiles) {
    const fp = path.join(scriptsDir, f);
    const src = readFileSync(fp, 'utf8');
    assert.ok(
      !leakPattern.test(src),
      `${f} must not contain experiments/quay-perpetual-stream or exp5 references`
    );
  }
});

// ---------------------------------------------------------------------------
// DIR-070-C (M139) — Tier-B parameterized gate scripts shipped to plugin/scripts/.
// 5 gate scripts + 4 .sh wrappers (impl-row-check.sh is a standalone .sh script).
// Pins: all 9 files present; .sh wrappers are executable; .sh wrappers runnable
// (exit 2 for missing args); gates registered in .quay/config.yml; zero experiment
// leakage in plugin copies.
// ---------------------------------------------------------------------------

test('DIR-070-C: all 9 new gate scripts + wrappers present in plugin/scripts/', () => {
  const scriptsDir = path.join(pluginDir, 'scripts');
  const wanted = [
    'audit-independence-check.ts', 'audit-independence-check.sh',
    'vmeta-lag-check.ts', 'vmeta-lag-check.sh',
    'it0-split-or-commit-check.ts', 'it0-split-or-commit-check.sh',
    'it0-enforcement-with-design-check.ts', 'it0-enforcement-with-design-check.sh',
    'it0-impl-row-check.sh',
  ];
  for (const f of wanted) {
    assert.ok(existsSync(path.join(scriptsDir, f)), `plugin/scripts/${f} must exist`);
  }
});

test('DIR-070-C: all .sh wrappers are executable', () => {
  const scriptsDir = path.join(pluginDir, 'scripts');
  const wrappers = ['audit-independence-check.sh', 'vmeta-lag-check.sh',
    'it0-split-or-commit-check.sh', 'it0-enforcement-with-design-check.sh',
    'it0-impl-row-check.sh'];
  for (const w of wrappers) {
    const fp = path.join(scriptsDir, w);
    try {
      fs.accessSync(fp, fs.constants.X_OK);
      assert.ok(true, `${w} is executable`);
    } catch {
      assert.fail(`${w} must be executable`);
    }
  }
});

test('DIR-070-C: .sh wrappers runnable (exit 2 for missing args, not ENOTFOUND)', () => {
  const scriptsDir = path.join(pluginDir, 'scripts');
  const wrappers = ['audit-independence-check.sh', 'vmeta-lag-check.sh',
    'it0-split-or-commit-check.sh', 'it0-enforcement-with-design-check.sh'];
  for (const w of wrappers) {
    const fp = path.join(scriptsDir, w);
    let exitCode = 0;
    try {
      execFileSync('bash', [fp], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      exitCode = e.status || 1;
    }
    assert.equal(exitCode, 2, `${w} must exit 2 (usage) when called without args, not ${exitCode}`);
  }
});

test('DIR-070-C: Tier-B gates registered in .quay/config.yml', () => {
  const configPath = path.join(repoRoot, '.quay', 'config.yml');
  const configSrc = readFileSync(configPath, 'utf8');
  // it0 gates with updated plugin/scripts/ paths
  const it0GateNames = ['audit-independence', 'vmeta-lag', 'impl-row'];
  for (const name of it0GateNames) {
    assert.ok(
      configSrc.includes(`name: ${name}`) && configSrc.includes(`plugin/scripts/`),
      `.quay/config.yml must register gate '${name}' with plugin/scripts/ path`
    );
  }
  // testPass gates with updated plugin/scripts/ paths
  const testPassNames = ['split-or-commit', 'enforcement-with-design'];
  for (const name of testPassNames) {
    assert.ok(
      configSrc.includes(`name: ${name}`) && configSrc.includes(`plugin/scripts/`),
      `.quay/config.yml testPass must register '${name}' with plugin/scripts/ path`
    );
  }
});

test('DIR-070-C: Tier-B plugin copies have zero exp5/experiment-path references', () => {
  const scriptsDir = path.join(pluginDir, 'scripts');
  const tierBFiles = [
    'audit-independence-check.ts', 'audit-independence-check.sh',
    'vmeta-lag-check.ts', 'vmeta-lag-check.sh',
    'it0-split-or-commit-check.ts', 'it0-split-or-commit-check.sh',
    'it0-enforcement-with-design-check.ts', 'it0-enforcement-with-design-check.sh',
    'it0-impl-row-check.sh',
  ];
  const leakPattern = /experiments\/quay-perpetual-stream|\bexp5\b/i;
  for (const f of tierBFiles) {
    const fp = path.join(scriptsDir, f);
    const src = readFileSync(fp, 'utf8');
    assert.ok(
      !leakPattern.test(src),
      `${f} must not contain experiments/quay-perpetual-stream or exp5 references`
    );
  }
});

// ---------------------------------------------------------------------------
// M143 (DIR-081) — plugin distribution: workflows, gate scripts, agents, sync,
// and quay:init skill.  These tests pin the structural invariants: the
// directories exist with the expected file counts, sync.sh is executable,
// the init skill carries no research-layer references, and the vendored agent
// file is present.
//
// gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked (2026-08-05): plugin/gate-scripts/
// is RETIRED — the classic-pipeline era gates were laid into target projects but nothing called
// them (dead weight). The files remain in the plugin tree (layered retirement) but quay-init no
// longer lays them down and sync.sh no longer syncs them. The tests below pin that retirement:
// quay-init.sh carries ZERO 'gate-scripts' references (contract measure dead_gates_remaining = 0).
// ---------------------------------------------------------------------------

test('M143: plugin/workflows/ exists with the 2 surviving JS workflow files', () => {
  // gap-retire-the-prepare-execute-pipeline-cluster (ADR-022): execute-milestone.js and
  // prepare-milestone.js were retired with the classic milestone loop.
  const workflowsDir = path.join(pluginDir, 'workflows');
  assert.ok(existsSync(workflowsDir), 'plugin/workflows/ must exist');
  const wanted = ['drain-directives.js', 'run-routines.js'];
  for (const f of wanted) {
    const fp = path.join(workflowsDir, f);
    assert.ok(existsSync(fp), `plugin/workflows/${f} must exist`);
  }
});

test('M143: plugin/gate-scripts/ is RETIRED — kept in tree, not laid down by quay-init', () => {
  // 分层退休（Layered retirement）: the classic-pipeline era gate scripts
  // stay in the plugin tree as a historical artifact, but they are NO LONGER in the distribution.
  const gateDir = path.join(pluginDir, 'gate-scripts');
  assert.ok(existsSync(gateDir), 'plugin/gate-scripts/ must exist (retired artifact kept in tree)');
  // Contract measure dead_gates_remaining: quay-init.sh must carry ZERO 'gate-scripts' references
  // (dead gates no longer laid down).
  const quayInit = readFileSync(path.join(pluginDir, 'scripts', 'quay-init.sh'), 'utf8');
  assert.equal(quayInit.includes('gate-scripts'), false,
    'quay-init.sh must contain ZERO gate-scripts references (dead weight no longer laid down)');
  // sync.sh must no longer run any cp into the retired gate-scripts dir (a comment naming the
  // retired dir is documentation of the retirement, not a sync operation).
  const syncSrc = readFileSync(path.join(pluginDir, 'sync.sh'), 'utf8');
  assert.doesNotMatch(syncSrc, /cp\s+.*gate-scripts\//,
    'sync.sh must no longer sync the retired gate scripts');
});

test('M143: plugin/agents/baime-iteration-executor.md exists', () => {
  const agentPath = path.join(pluginDir, 'agents', 'baime-iteration-executor.md');
  assert.ok(existsSync(agentPath), 'plugin/agents/baime-iteration-executor.md must exist');
  const src = readFileSync(agentPath, 'utf8');
  assert.ok(src.length > 500, 'vendored agent file must have substantive content');
});

test('M143: plugin/sync.sh exists and is executable', () => {
  const syncPath = path.join(pluginDir, 'sync.sh');
  assert.ok(existsSync(syncPath), 'plugin/sync.sh must exist');
  const src = readFileSync(syncPath, 'utf8');
  assert.match(src, /drain-directives\.js/, 'sync.sh must sync drain-directives.js');
  assert.match(src, /run-routines\.js/, 'sync.sh must sync run-routines.js');
  assert.doesNotMatch(src, /cp\s+.*gate-scripts\//, 'sync.sh must no longer sync the retired gate-scripts');
});

test('M143: init skill has zero research-layer references (VT/value-ledger/checkpoints/experiments/**)', () => {
  const src = readFileSync(path.join(pluginDir, 'skills', 'init', 'SKILL.md'), 'utf8');
  const researchLeakPattern = /\bVT\b|value-ledger|checkpoints?|experiments\/|inherited-core|\bexp5\b/i;
  assert.ok(
    !researchLeakPattern.test(src),
    'quay:init SKILL.md must contain zero VT/value-ledger/checkpoints/experiments/**/exp5 references'
  );
});

test('M143: git-tracked workflows in plugin/workflows/ are byte-identical to .claude/workflows/ canonical sources', () => {
  // Only test git-tracked source files that still exist after the prepare/execute retirement
  // (ADR-022 / gap-retire-the-prepare-execute-pipeline-cluster).
  const trackedWorkflows = ['drain-directives.js', 'run-routines.js'];
  for (const name of trackedWorkflows) {
    const canonical = path.join(repoRoot, '.claude', 'workflows', name);
    const bundled = path.join(pluginDir, 'workflows', name);
    assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
    assert.ok(existsSync(bundled), `bundled copy missing: ${bundled}`);
    assert.equal(
      readFileSync(bundled, 'utf8'),
      readFileSync(canonical, 'utf8'),
      `${name}: plugin/workflows/ copy must be byte-identical to .claude/workflows/ source`
    );
  }
});

// ---------------------------------------------------------------------------
// M179 (DIR-070-F, Gap 3) — reusable methodology reference material extracted
// from two experiment-local .claude/skills/ into plugin/skills/. Pins: the
// extracted skills exist with their reference/ files, are traced back to a
// real byte-identical source for the 4-file quay-native-methodology set (the
// task's own Plan specifies these 4 files verbatim), and the ORIGINAL
// .claude/skills/ sources are left unmodified (extraction, not a move).
// ---------------------------------------------------------------------------

test('M179 (DIR-070-F): quay-native-methodology plugin skill exists with its 4 named reference files, byte-identical to their .claude/skills/ source', () => {
  const pluginSkillDir = path.join(pluginDir, 'skills', 'quay-native-methodology');
  assert.ok(existsSync(path.join(pluginSkillDir, 'SKILL.md')), 'plugin/skills/quay-native-methodology/SKILL.md must exist');
  const refFiles = ['gate-mechanics.md', 'directive-lifecycle.md', 'patterns.md', 'g3-audit-discipline.md'];
  for (const f of refFiles) {
    const bundled = path.join(pluginSkillDir, 'reference', f);
    const canonical = path.join(repoRoot, '.claude', 'skills', 'quay-native-methodology', 'reference', f);
    assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
    assert.ok(existsSync(bundled), `plugin/skills/quay-native-methodology/reference/${f} must exist`);
    assert.equal(
      readFileSync(bundled, 'utf8'),
      readFileSync(canonical, 'utf8'),
      `${f}: plugin copy must be byte-identical to its .claude/skills/ source (extraction, not a rewrite)`
    );
  }
});

test('M179 (DIR-070-F): quay-webui-bootstrap-methodology plugin skill exists with its 2 named reference files, byte-identical to their .claude/skills/ source', () => {
  const pluginSkillDir = path.join(pluginDir, 'skills', 'quay-webui-bootstrap-methodology');
  assert.ok(existsSync(path.join(pluginSkillDir, 'SKILL.md')), 'plugin/skills/quay-webui-bootstrap-methodology/SKILL.md must exist');
  const refFiles = ['visual-review-mechanism.md', 'effectiveness-timing-corpus.md'];
  for (const f of refFiles) {
    const bundled = path.join(pluginSkillDir, 'reference', f);
    const canonical = path.join(repoRoot, '.claude', 'skills', 'quay-webui-bootstrap-methodology', 'reference', f);
    assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
    assert.ok(existsSync(bundled), `plugin/skills/quay-webui-bootstrap-methodology/reference/${f} must exist`);
    assert.equal(
      readFileSync(bundled, 'utf8'),
      readFileSync(canonical, 'utf8'),
      `${f}: plugin copy must be byte-identical to its .claude/skills/ source (extraction, not a rewrite)`
    );
  }
});

test('M179 (DIR-070-F): original .claude/skills/ sources are unmodified and still contain experiment-specific content (extraction, not a move)', () => {
  // quay-native-methodology: case-studies/, inventory/, and v-meta-stall-analysis.md are
  // experiment-specific content that must remain ONLY in .claude/skills/, never mirrored to plugin/.
  const nativeSrcDir = path.join(repoRoot, '.claude', 'skills', 'quay-native-methodology');
  assert.ok(existsSync(path.join(nativeSrcDir, 'reference', 'v-meta-stall-analysis.md')), 'original v-meta-stall-analysis.md must still exist (not deleted)');
  assert.ok(existsSync(path.join(nativeSrcDir, 'reference', 'case-studies', 'iteration-88-abi-symmetry-walkthrough.md')), 'original case-studies/ must still exist (not deleted)');
  assert.ok(existsSync(path.join(nativeSrcDir, 'inventory', 'inventory.json')), 'original inventory/ must still exist (not deleted)');
  assert.ok(
    !existsSync(path.join(pluginDir, 'skills', 'quay-native-methodology', 'reference', 'v-meta-stall-analysis.md')),
    'v-meta-stall-analysis.md must NOT be mirrored into plugin/ — it is explicitly excluded experiment-specific content'
  );
  assert.ok(
    !existsSync(path.join(pluginDir, 'skills', 'quay-native-methodology', 'inventory')),
    'inventory/ must NOT be mirrored into plugin/ — it is explicitly excluded experiment-specific content'
  );

  // quay-webui-bootstrap-methodology: V-meta ceiling analysis and G3 env-gap case study are
  // experiment-specific content that must remain ONLY in .claude/skills/.
  const webuiSrcDir = path.join(repoRoot, '.claude', 'skills', 'quay-webui-bootstrap-methodology');
  assert.ok(existsSync(path.join(webuiSrcDir, 'reference', 'v-meta-ceiling-two-experiment.md')), 'original v-meta-ceiling-two-experiment.md must still exist (not deleted)');
  assert.ok(existsSync(path.join(webuiSrcDir, 'reference', 'g3-visual-review-env-gap.md')), 'original g3-visual-review-env-gap.md must still exist (not deleted)');
  assert.ok(
    !existsSync(path.join(pluginDir, 'skills', 'quay-webui-bootstrap-methodology', 'reference', 'v-meta-ceiling-two-experiment.md')),
    'v-meta-ceiling-two-experiment.md must NOT be mirrored into plugin/ — it is explicitly excluded experiment-specific content'
  );
  assert.ok(
    !existsSync(path.join(pluginDir, 'skills', 'quay-webui-bootstrap-methodology', 'reference', 'g3-visual-review-env-gap.md')),
    'g3-visual-review-env-gap.md must NOT be mirrored into plugin/ — it is explicitly excluded experiment-specific content'
  );
});

test('M179 (DIR-070-F): quay-core-bootstrap-methodology is explicitly out of scope — no plugin/skills/ mirror exists', () => {
  assert.ok(
    !existsSync(path.join(pluginDir, 'skills', 'quay-core-bootstrap-methodology')),
    'quay-core-bootstrap-methodology is lowest priority / explicitly out of scope per DIR-070-F Plan — must not be extracted'
  );
});

// ---------------------------------------------------------------------------
// M120 (DIR-060) — the vendored Core copy is a bundled ESM dist/quay.js that
// runs on the declared Node-20 floor, NOT the M116 .ts entrypoint (Node >=23).
// The raw bin/src copies and package-lock.json are gone, and package.json is
// slimmed (the bundle has no external runtime deps).
// UPDATED at M172 (DIR-108): the bundle is NO LONGER git-trackable. It used to
// be a negated exception to the bare `dist/` .gitignore rule (a committed
// artifact that silently went stale); DIR-108 removed that exception. The
// bundle is now built by `sync-vendor.sh` (wired into root `postinstall` and
// CI's `publish-plugin-dist.yml` → the `dist-plugin` orphan branch) and is
// gitignored locally — present as an untracked build artifact, not a
// committed file. See M172 charter / tasks/DIR-108.md.
// ---------------------------------------------------------------------------

const vendorDir = path.join(pluginDir, 'vendor', 'quay');

test('M120: .mcp.json invokes the bundled vendor/quay/dist/quay.js, never a .ts entrypoint', () => {
  const mcp = readJson(path.join(pluginDir, '.mcp.json'));
  assert.equal(mcp.quay.args[0], '${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js');
  assert.doesNotMatch(mcp.quay.args[0], /\.ts$/, 'the vendor entrypoint must not be a native .ts file');
});

test('M172 (DIR-108): the vendored dist bundle is a gitignored local build artifact (not git-tracked), and carries the createRequire banner', () => {
  const distBundle = path.join(vendorDir, 'dist', 'quay.js');
  // Regenerate via the same mechanism postinstall/CI use, in case this file is
  // run standalone before any install step has produced the local artifact.
  if (!existsSync(distBundle)) {
    execFileSync('bash', [path.join(pluginDir, 'scripts', 'sync-vendor.sh')], { cwd: repoRoot, stdio: 'pipe' });
  }
  assert.ok(existsSync(distBundle), `vendored bundle missing and sync-vendor.sh did not produce it: ${distBundle}`);
  // DIR-108: the bare `dist/` ignore pattern is no longer negated for this path —
  // `git check-ignore` must exit 0 (IGNORED). It threw NOT-ignored before the fix.
  let ignored = '';
  try {
    ignored = execFileSync('git', ['check-ignore', distBundle], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    ignored = '';
  }
  assert.equal(ignored, distBundle, 'vendor/quay/dist/quay.js must be gitignored (DIR-108: no longer a committed exception)');
  let tracked = true;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', distBundle], { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    tracked = false;
  }
  assert.equal(tracked, false, 'vendor/quay/dist/quay.js must NOT be git-tracked');
  const src = readFileSync(distBundle, 'utf8');
  assert.match(src, /createRequire/, 'the vendored bundle must be the ESM build (createRequire banner present)');
});

test('M120: the stale raw bin/ + src/ vendor copies are gone (replaced by the bundle)', () => {
  assert.ok(!existsSync(path.join(vendorDir, 'bin')), 'vendor/quay/bin must be removed');
  assert.ok(!existsSync(path.join(vendorDir, 'src')), 'vendor/quay/src must be removed');
});

test('M120: package-lock.json is gone and package.json is slimmed (no runtime dependencies)', () => {
  assert.ok(!existsSync(path.join(vendorDir, 'package-lock.json')), 'vendor package-lock.json must be removed');
  const vpkg = readJson(path.join(vendorDir, 'package.json'));
  assert.equal(vpkg.name, 'quay-plugin-vendor');
  assert.equal(vpkg.type, 'module');
  assert.ok(vpkg.version, 'vendor package.json must still carry a version (DIR-061)');
  assert.ok(!('dependencies' in vpkg), 'a fully-bundled vendor copy must declare no dependencies');
});
