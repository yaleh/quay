// @test-group engine
// plugin/test/codex-stage1-adapter.test.mjs — DIR-121 (Codex adoption Stage 1) adapter
// + negative-test suite. Mechanically proves the four Codex surfaces are present,
// minimal, single-sourced, and safe:
//
//   A. DISCOVERY/CONFIG/DRIFT (static):
//      - root AGENTS.md is non-empty and concise, and names the authority contract;
//      - both .agents/skills entries are discoverable, each SKILL.md has a valid
//        name/description;
//      - Claude/Codex directive lifecycle rules resolve to ONE canonical source
//        (scripts/agents-claude-drift-check.ts exits 0), and a drifted fixture makes
//        that check FAIL (negative);
//      - .codex/config.toml registers ONLY the quay stdio MCP server, no forbidden keys;
//      - the selfcheck script exits 0 (degrades gracefully if codex is absent).
//   B. CLI FALLBACK (no MCP): quay CLI list/view/check operate on a real temp store.
//   C. MCP OPERATOR TRANSACTION + NEGATIVES (real `quay mcp` subprocess):
//      list/get/check; matching-expectedStatus write persists; STALE-expectedStatus
//      write is REFUSED with content unchanged and a task_get proving no write (AC #5);
//      an unavailable/broken Quay MCP degrades to isError while the CLI still works.
//   D. SCHEMA-FAILURE negative: a placeholder task body fails task-schema-check.ts.
//   E. LIVE-PROOF validator: a complete, consistent evidence record passes; missing
//      fields, probe task ids, un-refused CAS, non-zero schema, unchanged edit hashes,
//      and scoped commits touching unrelated paths all FAIL non-zero.
//
// Run: node --test plugin/test/codex-stage1-adapter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');
const coreBin = path.join(repoRoot, 'packages', 'quay', 'bin', 'quay.ts');
const nativeBin = path.join(repoRoot, 'packages', 'quay-native', 'bin', 'quay-native.ts');
const nativeProviderDir = path.dirname(nativeBin);
const driftCheck = path.join(repoRoot, 'scripts', 'agents-claude-drift-check.ts');
const selfcheck = path.join(pluginDir, 'scripts', 'codex-stage1-selfcheck.sh');
const liveProofCheck = path.join(pluginDir, 'scripts', 'codex-stage1-live-proof-check.ts');
const schemaCheck = path.join(pluginDir, 'scripts', 'task-schema-check.ts');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}
function frontmatterField(text, key) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const km = m[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return km ? km[1].trim().replace(/^"|"$/g, '') : null;
}

// --- CLI helper: run quay Core CLI against a workspace cwd, parse stdout JSON ----
// Uses spawnSync (never throws on a nonzero exit) because some commands — notably
// `task check` — exit nonzero when the gate is unsatisfied while still printing their
// structured JSON result to stdout. Callers assert on {status, json} as appropriate.
function quayCli(args, cwd) {
  const r = spawnSync('node', [coreBin, ...args], { cwd, encoding: 'utf8' });
  const out = r.stdout || '';
  const start = out.search(/[\[{]/);
  let json = null;
  if (start !== -1) {
    try {
      json = JSON.parse(out.slice(start));
    } catch {
      json = null;
    }
  }
  return { status: r.status, json, raw: out };
}

// --- temp workspace with a real .quay/config.yml (provider map) + native store ---
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-stage1-ws-'));
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-stage1-tasks-'));
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.quay', 'config.yml'),
    [
      'providers:',
      '  native:',
      '    enabled: true',
      `    path: "${nativeProviderDir}"`,
      `    mcp_entry: ["node", "${nativeBin}", "mcp"]`,
      '    env:',
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir}"`,
      '',
    ].join('\n')
  );
  return { root, tasksDir };
}

async function connectMcp(cwd) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [coreBin, 'mcp'],
    cwd,
    env: process.env,
  });
  const client = new Client({ name: 'codex-stage1-test', version: '0.0.1' });
  await client.connect(transport);
  return { client, transport };
}

const VALID_BODY =
  '## Proposal\nA sufficiently long proposal section so the canonical-task-schema minimum-content check passes cleanly here.\n' +
  '## Plan\nN/A — fixture task for the DIR-121 Stage 1 adapter test; no staged plan required.\n' +
  '## Acceptance Criteria\n- [ ] a sufficiently long acceptance criterion line for the minimum-content check\n' +
  '## Definition of Done\n- [ ] a sufficiently long definition-of-done line for the minimum-content check\n';

// =================================================================================
// A. DISCOVERY / CONFIG / DRIFT (static)
// =================================================================================

test('A1: root AGENTS.md is non-empty, concise, and names the authority contract', () => {
  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  assert.ok(fs.existsSync(agentsPath), 'root AGENTS.md must exist');
  const text = read(agentsPath);
  assert.ok(text.trim().length > 0, 'AGENTS.md must be non-empty');
  const nonEmpty = text.split('\n').filter((l) => l.trim().length > 0).length;
  assert.ok(nonEmpty <= 120, `AGENTS.md must be concise (${nonEmpty} non-empty lines <= 120)`);
  // It must actually carry the authority/safety contract, not be a stub.
  for (const marker of [
    /Provider ABI/i,
    /task_list|MCP/i,
    /CLI fallback|packages\/quay\/bin\/quay\.ts/i,
    /human authorization/i,
    /readback/i,
    /task-schema-check|schema check/i,
    /scoped/i,
    /PROHIBITED-AUTONOMOUS-ACTIONS/,
  ]) {
    assert.ok(marker.test(text), `AGENTS.md must name: ${marker}`);
  }
});

test('A2: both .agents/skills entries are discoverable with valid name/description', () => {
  for (const skill of ['quay-task-operator', 'quay-directive']) {
    const skillMd = path.join(repoRoot, '.agents', 'skills', skill, 'SKILL.md');
    assert.ok(fs.existsSync(skillMd), `.agents/skills/${skill}/SKILL.md must be discoverable (via symlink)`);
    const text = read(skillMd);
    const name = frontmatterField(text, 'name');
    const desc = frontmatterField(text, 'description');
    assert.equal(name, skill, `${skill} SKILL.md must declare name: ${skill}`);
    assert.ok(desc && desc.length >= 20, `${skill} SKILL.md must have a substantive description`);
  }
});

test('A3: Codex directive surface resolves to ONE canonical source (no drift); .claude/skills/ directive retired', () => {
  // gap-ac166-second-copy-retirement: the .claude/skills/quay-directive symlink was a second copy
  // (retired → archived under archive/). Only .agents/skills/quay-directive remains as a symlink
  // into the canonical plugin/skills/quay-directive source.
  assert.ok(!fs.existsSync(path.join(repoRoot, '.claude', 'skills', 'quay-directive')), '.claude/skills/quay-directive must be retired (archived)');
  const agentsReal = fs.realpathSync(path.join(repoRoot, '.agents', 'skills', 'quay-directive', 'SKILL.md'));
  assert.ok(agentsReal.startsWith(fs.realpathSync(path.join(repoRoot, 'plugin', 'skills', 'quay-directive'))),
    'the shared canonical source must live under plugin/skills/quay-directive');
  // The operator surface likewise resolves into the canonical plugin source.
  const opReal = fs.realpathSync(path.join(repoRoot, '.agents', 'skills', 'quay-task-operator', 'SKILL.md'));
  assert.ok(opReal.startsWith(fs.realpathSync(path.join(repoRoot, 'plugin', 'skills', 'quay-task-operator'))),
    '.agents quay-task-operator must resolve under plugin/skills/quay-task-operator');
  // The host directive entry is a symlink (not an independent copy that could drift).
  assert.ok(fs.lstatSync(path.join(repoRoot, '.agents', 'skills', 'quay-directive')).isSymbolicLink(), '.agents/skills/quay-directive must be a symlink');
});

test('A4: mechanical drift check passes on the live repo (exit 0)', () => {
  const r = spawnSync('node', ['--experimental-strip-types', driftCheck], { encoding: 'utf8' });
  assert.equal(r.status, 0, `drift check must exit 0 on the live repo; output:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /no drift/i);
});

test('A5 (negative): drift check FAILS on a drifted fixture (divergent prohibited-actions)', () => {
  // Build a minimal fixture tree that reproduces the single-source layout, then break
  // AGENTS.md's prohibited-actions block so it disagrees with the canonical operator skill.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fixture-'));
  const mkSkill = (rel, body) => {
    const p = path.join(fixture, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  const prohibitedBlock =
    '<!-- PROHIBITED-AUTONOMOUS-ACTIONS -->\n' +
    '- no independent AC/DoD ticking\n- no task close or completion\n- no SELECT or execute milestone\n' +
    '- no worker launch\n- no merge, ABSORB, or schedule continuation\n' +
    '- no treating transcript/session evidence as authoritative state\n' +
    '<!-- /PROHIBITED-AUTONOMOUS-ACTIONS -->';
  const operatorBody =
    '---\nname: quay-task-operator\ndescription: "x".\n---\n# op\n\ncapability check; human authorization; semantic diff; ' +
    'expectedStatus; freshness re-read; readback; schema check; CLI fallback; scoped commit; fails closed; not atomic same-status body CAS; no autonomous lifecycle.\n' +
    prohibitedBlock + '\n';
  const directiveBody =
    '---\nname: quay-directive\ndescription: "x".\n---\n# d\nDIR-028 task-canonical; extra.schema v1; no file / no projection; real-landing Definition of Done; task_write.\n';
  mkSkill('plugin/skills/quay-task-operator/SKILL.md', operatorBody);
  mkSkill('plugin/skills/quay-directive/SKILL.md', directiveBody);
  // Host surfaces are symlinks to canonical (single-source), as in the real repo.
  fs.mkdirSync(path.join(fixture, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(fixture, '.agents', 'skills'), { recursive: true });
  fs.symlinkSync('../../plugin/skills/quay-directive', path.join(fixture, '.claude', 'skills', 'quay-directive'));
  fs.symlinkSync('../../plugin/skills/quay-directive', path.join(fixture, '.agents', 'skills', 'quay-directive'));
  fs.symlinkSync('../../plugin/skills/quay-task-operator', path.join(fixture, '.agents', 'skills', 'quay-task-operator'));
  // DRIFT: AGENTS.md drops one prohibited item (worker launch) — must be detected.
  const driftedAgents =
    '# AGENTS.md\ncapability check; human authorization; semantic diff; expectedStatus; freshness re-read; readback; ' +
    'schema check; CLI fallback; scoped commit; fails closed; not atomic same-status body CAS; no autonomous lifecycle.\n' +
    '<!-- PROHIBITED-AUTONOMOUS-ACTIONS -->\n' +
    '- no independent AC/DoD ticking\n- no task close or completion\n- no SELECT or execute milestone\n' +
    '- no merge, ABSORB, or schedule continuation\n' +
    '- no treating transcript/session evidence as authoritative state\n' +
    '<!-- /PROHIBITED-AUTONOMOUS-ACTIONS -->\n';
  fs.writeFileSync(path.join(fixture, 'AGENTS.md'), driftedAgents);

  const r = spawnSync('node', ['--experimental-strip-types', driftCheck, '--root', fixture], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'drift check must FAIL (nonzero) when AGENTS.md disagrees with the canonical operator skill');
  assert.match(r.stdout + r.stderr, /FAIL|DRIFT/i);
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('A6 (negative): drift check FAILS when a host surface is an independent copy, not a symlink', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fixture-copy-'));
  const prohibitedBlock =
    '<!-- PROHIBITED-AUTONOMOUS-ACTIONS -->\n- no independent AC/DoD ticking\n- no task close or completion\n' +
    '- no SELECT or execute milestone\n- no worker launch\n- no merge, ABSORB, or schedule continuation\n' +
    '- no treating transcript/session evidence as authoritative state\n<!-- /PROHIBITED-AUTONOMOUS-ACTIONS -->';
  const operatorBody = '---\nname: quay-task-operator\ndescription: "x".\n---\ncapability check human authorization semantic diff expectedStatus freshness re-read readback schema check CLI fallback scoped commit fails closed not atomic same-status body CAS no autonomous lifecycle\n' + prohibitedBlock;
  const directiveBody = '---\nname: quay-directive\ndescription: "x".\n---\nDIR-028 task-canonical extra.schema v1 no file no projection real-landing Definition of Done task_write\n';
  fs.mkdirSync(path.join(fixture, 'plugin/skills/quay-task-operator'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'plugin/skills/quay-directive'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'plugin/skills/quay-task-operator/SKILL.md'), operatorBody);
  fs.writeFileSync(path.join(fixture, 'plugin/skills/quay-directive/SKILL.md'), directiveBody);
  // .claude is a symlink (ok), but .agents is an INDEPENDENT COPY (drift hazard) — must fail.
  fs.mkdirSync(path.join(fixture, '.claude/skills'), { recursive: true });
  fs.symlinkSync('../../plugin/skills/quay-directive', path.join(fixture, '.claude/skills/quay-directive'));
  fs.mkdirSync(path.join(fixture, '.agents/skills/quay-directive'), { recursive: true });
  fs.writeFileSync(path.join(fixture, '.agents/skills/quay-directive/SKILL.md'), directiveBody + '\nDIVERGENT COPY\n');
  fs.symlinkSync('../../plugin/skills/quay-task-operator', path.join(fixture, '.agents/skills/quay-task-operator'));
  fs.writeFileSync(path.join(fixture, 'AGENTS.md'), '# AGENTS.md\ncapability check human authorization semantic diff expectedStatus freshness re-read readback schema check CLI fallback scoped commit fails closed not atomic same-status body CAS no autonomous lifecycle\n' + prohibitedBlock);

  const r = spawnSync('node', ['--experimental-strip-types', driftCheck, '--root', fixture], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'drift check must FAIL when .agents/skills/quay-directive is an independent copy, not a symlink to canonical');
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('A7: .codex/config.toml registers ONLY the quay stdio MCP server, no forbidden keys', () => {
  const cfg = read(path.join(repoRoot, '.codex', 'config.toml'));
  assert.match(cfg, /^\[mcp_servers\.quay\]/m, 'must register [mcp_servers.quay]');
  assert.match(cfg, /quay\.ts/, 'must invoke the existing quay.ts stdio server');
  // Strip comment lines, then assert none of the forbidden Stage-1 surfaces are configured.
  const body = cfg.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const forbidden of [/model\s*=/i, /reasoning/i, /\[sandbox/i, /approval_policy/i, /\[hooks/i, /automation/i, /telemetry/i, /otel/i, /model_providers/i, /meta[-_]cc/i]) {
    assert.ok(!forbidden.test(body), `.codex/config.toml must NOT configure a forbidden Stage-1 surface: ${forbidden}`);
  }
});

test('A8: codex-stage1-selfcheck.sh exits 0 (validates config; degrades if codex absent)', () => {
  const r = spawnSync('bash', [selfcheck], { encoding: 'utf8' });
  assert.equal(r.status, 0, `selfcheck must exit 0; output:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /RESULT: PASS/);
});

// A9/A10: the present-but-incompatible degrade path is MECHANICAL (A9) and the real
// config-defect path still FAILS (A10 negative) — a fake `codex` on PATH stands in for
// the two classes of installed codex, so the degrade is covered without a live tool.
function fakeCodex(binBody) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fake-bin-'));
  const p = path.join(bin, 'codex');
  fs.writeFileSync(p, binBody);
  fs.chmodSync(p, 0o755);
  return bin;
}

test('A9: selfcheck DEGRADES (exit 0) on present-but-incompatible codex (project config not loaded)', () => {
  // codex-cli 0.125.0 class: `codex mcp list` surfaces NO `quay` row because this version
  // never loads project-scoped .codex/config.toml MCP servers. The selfcheck must SKIP the
  // live proof with an explicit present-but-incompatible note — never a raw failure.
  const bin = fakeCodex(
    '#!/usr/bin/env bash\n' +
    'if [[ "$1" == "--version" ]]; then\n  echo "codex-cli 0.125.0"\n' +
    'elif [[ "$1" == "mcp" && "$2" == "get" ]]; then\n  echo "Error: No MCP server found." >&2\n  exit 1\n' +
    'elif [[ "$1" == "mcp" && "$2" == "list" ]]; then\n' +
    '  printf "%-16s  %-10s  %s\\n" "Name" "Command" "Status"\n' +
    '  printf "%-16s  %-10s  %s\\n" "archguard" "archguard" "enabled"\n' +
    '  printf "%-16s  %-10s  %s\\n" "playwright" "npx" "enabled"\n' +
    'else\n  echo "fake codex: unknown args: $*" >&2\n  exit 1\nfi\n'
  );
  try {
    const r = spawnSync('bash', [selfcheck], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 0, `selfcheck must exit 0 on present-but-incompatible codex; output:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /RESULT: PASS/);
    assert.match(r.stdout, /present-but-incompatible/);
    assert.match(r.stdout, /SKIP/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('A10 (negative): selfcheck still FAILS (exit 1) when codex loads the project config but rejects the quay server', () => {
  // A version that DOES surface a `quay` row in `codex mcp list` yet rejects `mcp get quay`
  // is a REAL config defect — it must FAIL, proving the degrade is scoped to the
  // project-config-not-loaded case and does not mask a broken config.
  const bin = fakeCodex(
    '#!/usr/bin/env bash\n' +
    'if [[ "$1" == "--version" ]]; then\n  echo "codex-cli 0.146.1"\n' +
    'elif [[ "$1" == "mcp" && "$2" == "get" ]]; then\n  echo "Error: quay server failed to start." >&2\n  exit 1\n' +
    'elif [[ "$1" == "mcp" && "$2" == "list" ]]; then\n' +
    '  printf "%-16s  %-10s  %s\\n" "Name" "Command" "Status"\n' +
    '  printf "%-16s  %-10s  %s\\n" "quay" "node" "enabled"\n' +
    'else\n  echo "fake codex: unknown args: $*" >&2\n  exit 1\nfi\n'
  );
  try {
    const r = spawnSync('bash', [selfcheck], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 1, `selfcheck must FAIL on a loaded-but-rejected quay server; output:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /RESULT: FAIL/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

// =================================================================================
// B. CLI FALLBACK (no MCP)
// =================================================================================

test('B1: CLI fallback — list/view/check operate on a real store without MCP', () => {
  const ws = makeWorkspace();
  execFileSync('node', [nativeBin, 'task', 'create', 'DIR-CLI-1', '--title', 'CLI fallback fixture',
    '--status', 'todo', '--labels', 'directive', '--body', VALID_BODY,
    '--extra', '{"schema":"v1","dirStatus":"pending"}'],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ws.tasksDir }, stdio: ['pipe', 'pipe', 'pipe'] });

  const list = quayCli(['task', 'list', '--label', 'directive', '--json'], ws.root);
  assert.equal(list.status, 0, 'CLI task list exits 0');
  const ids = (Array.isArray(list.json) ? list.json : list.json.tasks).map((t) => t.id);
  assert.ok(ids.includes('DIR-CLI-1'), 'CLI task list --label directive --json returns the directive task');

  const view = quayCli(['task', 'view', 'DIR-CLI-1', '--json'], ws.root);
  assert.equal(view.status, 0, 'CLI task view exits 0');
  const viewed = view.json.task ?? view.json;
  assert.equal(viewed.id, 'DIR-CLI-1', 'CLI task view returns the same task');
  assert.match(viewed.body, /## Proposal/, 'CLI-read body matches what was written');

  // `task check` runs the gate; the fixture task's gate is unsatisfied (fresh task), so
  // the exit code may be nonzero — the CLI-fallback point is that the command OPERATES
  // and returns a structured result, not that the gate passes.
  const check = quayCli(['task', 'check', 'DIR-CLI-1', '--json'], ws.root);
  assert.ok(check.json && typeof check.json === 'object', 'CLI task check returns a structured gate result (fallback operational)');
  fs.rmSync(ws.root, { recursive: true, force: true });
  fs.rmSync(ws.tasksDir, { recursive: true, force: true });
});

// =================================================================================
// C. MCP OPERATOR TRANSACTION + NEGATIVES (real `quay mcp` subprocess)
// =================================================================================

test('C1: MCP list/get/check + matching-expectedStatus write persists', async () => {
  const ws = makeWorkspace();
  execFileSync('node', [nativeBin, 'task', 'create', 'MCP-OP-1', '--title', 'operator fixture',
    '--status', 'todo', '--body', VALID_BODY],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ws.tasksDir }, stdio: ['pipe', 'pipe', 'pipe'] });

  const { client, transport } = await connectMcp(ws.root);
  try {
    const list = await client.callTool({ name: 'task_list', arguments: {} });
    assert.ok(list.isError !== true, 'task_list via MCP works');
    const get = await client.callTool({ name: 'task_get', arguments: { id: 'MCP-OP-1' } });
    assert.ok(get.isError !== true, 'task_get via MCP works');
    const chk = await client.callTool({ name: 'task_check', arguments: { id: 'MCP-OP-1' } });
    assert.ok(chk.isError !== true, 'task_check via MCP does not error (gate may report ok:false)');

    // Matching expectedStatus (CAS) succeeds and persists.
    const okWrite = await client.callTool({
      name: 'task_write',
      arguments: { id: 'MCP-OP-1', status: 'ready', expectedStatus: 'todo' },
    });
    assert.ok(okWrite.isError !== true, 'task_write with matching expectedStatus succeeds');
    const after = await client.callTool({ name: 'task_get', arguments: { id: 'MCP-OP-1' } });
    const afterTask = JSON.parse(after.structuredContent ? JSON.stringify(after.structuredContent) : after.content[0].text);
    const status = afterTask.task?.status ?? afterTask.status;
    assert.equal(status, 'ready', 'matching-CAS write persisted the new status');
  } finally {
    await transport.close();
    fs.rmSync(ws.root, { recursive: true, force: true });
    fs.rmSync(ws.tasksDir, { recursive: true, force: true });
  }
});

test('C2 (AC #5 negative): STALE expectedStatus write is REFUSED, content unchanged, task_get proves no write', async () => {
  const ws = makeWorkspace();
  const body = VALID_BODY + 'unique-marker-before\n';
  execFileSync('node', [nativeBin, 'task', 'create', 'MCP-CAS-1', '--title', 'cas fixture',
    '--status', 'ready', '--body', body],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ws.tasksDir }, stdio: ['pipe', 'pipe', 'pipe'] });

  const fileHash = () =>
    crypto.createHash('sha256').update(fs.readFileSync(path.join(ws.tasksDir, 'MCP-CAS-1.md'))).digest('hex');
  const beforeHash = fileHash();

  const { client, transport } = await connectMcp(ws.root);
  try {
    // Task is actually status=ready; pass a STALE expectedStatus=todo → must be refused.
    const conflict = await client.callTool({
      name: 'task_write',
      arguments: { id: 'MCP-CAS-1', status: 'done', expectedStatus: 'todo', body: VALID_BODY + 'STALE-WRITE-APPLIED\n' },
    });
    assert.equal(conflict.isError, true, 'stale-expectedStatus task_write returns isError:true (CAS conflict), not a silent write');
    const errText = JSON.stringify(conflict.content ?? conflict);
    assert.match(errText, /CAS|conflict|expected status/i, 'the error names the CAS conflict');

    // Content hash unchanged on disk.
    assert.equal(fileHash(), beforeHash, 'the task file content hash is unchanged after the refused write');

    // A follow-up task_get proves no write occurred (status still ready, body has no stale marker).
    const after = await client.callTool({ name: 'task_get', arguments: { id: 'MCP-CAS-1' } });
    const afterText = JSON.stringify(after.structuredContent ?? after.content);
    assert.match(afterText, /"ready"|ready/, 'task_get after the refused write still shows status ready');
    assert.ok(!afterText.includes('STALE-WRITE-APPLIED'), 'task_get proves the stale body write did NOT occur');
  } finally {
    await transport.close();
    fs.rmSync(ws.root, { recursive: true, force: true });
    fs.rmSync(ws.tasksDir, { recursive: true, force: true });
  }
});

test('C3 (negative): unavailable Quay MCP yields an explicit degraded result while the CLI fallback stays operational', async () => {
  // The project Quay MCP server (what Codex connects to) and the quay CLI are TWO
  // independent invocation paths. This proves both halves of the fallback contract:
  //   (a) when the Quay MCP tool surface cannot serve tasks, an MCP tool call returns
  //       isError:true — an EXPLICIT degraded result, not a crash or hang;
  //   (b) the quay CLI (a separate process the operator shells out to) remains fully
  //       operational for list/get/check on a healthy workspace.
  //
  // (a) a workspace whose provider connection is broken → `quay mcp` task_list isError.
  const broken = makeWorkspace();
  fs.writeFileSync(
    path.join(broken.root, '.quay', 'config.yml'),
    [
      'providers:',
      '  native:',
      '    enabled: true',
      `    path: "${nativeProviderDir}"`,
      '    mcp_entry: ["node", "/nonexistent/definitely-missing-mcp-entry.js", "mcp"]',
      '    env:',
      `      QUAY_NATIVE_TASKS_DIR: "${broken.tasksDir}"`,
      '',
    ].join('\n')
  );
  const { client, transport } = await connectMcp(broken.root);
  try {
    const tl = await client.callTool({ name: 'task_list', arguments: {} });
    assert.equal(tl.isError, true, 'with the Quay MCP tool surface unavailable, task_list returns isError:true (explicit degraded result, not a hang/crash)');
  } finally {
    await transport.close();
    fs.rmSync(broken.root, { recursive: true, force: true });
    fs.rmSync(broken.tasksDir, { recursive: true, force: true });
  }

  // (b) the CLI fallback is a SEPARATE invocation: it stays operational on a healthy
  // workspace even though the MCP path above is degraded.
  const ws = makeWorkspace();
  execFileSync('node', [nativeBin, 'task', 'create', 'CLI-UP-1', '--title', 'fallback fixture',
    '--status', 'todo', '--labels', 'directive', '--body', VALID_BODY],
    { env: { ...process.env, QUAY_NATIVE_TASKS_DIR: ws.tasksDir }, stdio: ['pipe', 'pipe', 'pipe'] });
  const list = quayCli(['task', 'list', '--label', 'directive', '--json'], ws.root);
  assert.equal(list.status, 0, 'CLI task list exits 0 (fallback operational)');
  const ids = (Array.isArray(list.json) ? list.json : list.json.tasks).map((t) => t.id);
  assert.ok(ids.includes('CLI-UP-1'), 'CLI fallback lists the task');
  const view = quayCli(['task', 'view', 'CLI-UP-1', '--json'], ws.root);
  assert.equal(view.status, 0, 'CLI task view exits 0 (fallback operational)');
  assert.equal((view.json.task ?? view.json).id, 'CLI-UP-1', 'CLI fallback gets the task');
  const check = quayCli(['task', 'check', 'CLI-UP-1', '--json'], ws.root);
  assert.ok(check.json && typeof check.json === 'object', 'CLI task check operates (structured result returned)');
  fs.rmSync(ws.root, { recursive: true, force: true });
  fs.rmSync(ws.tasksDir, { recursive: true, force: true });
});

test('C4: prohibited lifecycle authority is disclaimed by the operator contract and AGENTS.md (static boundary)', () => {
  const op = read(path.join(repoRoot, 'plugin', 'skills', 'quay-task-operator', 'SKILL.md'));
  const agents = read(path.join(repoRoot, 'AGENTS.md'));
  // The canonical prohibited-actions block must be present and complete in the operator skill.
  for (const item of [
    'no independent AC/DoD ticking',
    'no task close or completion',
    'no SELECT or execute milestone',
    'no worker launch',
    'no merge, ABSORB, or schedule continuation',
    'no treating transcript/session evidence as authoritative state',
  ]) {
    assert.ok(op.toLowerCase().includes(item.toLowerCase()), `operator skill must prohibit: ${item}`);
    assert.ok(agents.toLowerCase().includes(item.toLowerCase()), `AGENTS.md must prohibit: ${item}`);
  }
  // The operator must explicitly disclaim autonomous completion/lifecycle promotion.
  assert.match(op, /never sets `status: done`|never calls a lifecycle promotion/i, 'operator disclaims autonomous completion');
});

// =================================================================================
// D. SCHEMA-FAILURE negative
// =================================================================================

test('D1 (negative): a placeholder/invalid task body fails task-schema-check.ts', () => {
  const bad = path.join(os.tmpdir(), `codex-stage1-badtask-${process.pid}.md`);
  fs.writeFileSync(bad,
    '---\nid: DIR-BAD\nstatus: todo\nlabels:\n  - directive\nextra:\n  schema: v1\n  dirStatus: pending\n---\n' +
    '## Proposal\nstub\n## Plan\nN/A\n## Acceptance Criteria\n- [ ] x\n## Definition of Done\n- [ ] y\n' +
    '## Resolution\n<!-- filled at close -->\n');
  const r = spawnSync('node', [schemaCheck, bad], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `task-schema-check must FAIL a placeholder body; output:\n${r.stdout}`);
  fs.rmSync(bad, { force: true });
});

test('D2: a real, well-formed directive task passes task-schema-check.ts (control)', () => {
  // The task under implementation is itself the positive control: a genuine, full
  // directive (Finding + Requested action + runnable AC + real-landing DoD referencing
  // the standard clauses) must pass the canonical-task-schema check.
  const dir121 = path.join(repoRoot, 'tasks', 'DIR-121.md');
  assert.ok(fs.existsSync(dir121), 'tasks/DIR-121.md must exist in the workspace');
  const r = spawnSync('node', [schemaCheck, dir121], { encoding: 'utf8' });
  assert.equal(r.status, 0, `task-schema-check must PASS the real DIR-121 task; output:\n${r.stdout}`);
  assert.match(r.stdout, /PASS: .*DIR-121\.md — schema v1 conformant/);
});

// =================================================================================
// E. LIVE-PROOF validator (positive + negatives)
// =================================================================================

function evidenceFixture(overrides = {}) {
  const base = {
    codexSession: { ref: 'session:codex/abc123', version: 'codex-cli 0.146.0', trustedCheckout: true },
    loadedSurfaces: { agentsMd: true, skills: ['quay-task-operator', 'quay-directive'] },
    paths: { mcp: 'node packages/quay/bin/quay.ts mcp', cli: 'node packages/quay/bin/quay.ts task' },
    mutations: [
      {
        kind: 'edit', taskId: 'DIR-118', providerQualifiedId: 'native:DIR-118',
        authorizationRef: 'human:conv/2026-07-31#msg-42', beforeHash: 'aaa', afterHash: 'bbb',
        semanticDiff: '- old line\n+ new line', mcpReadback: true, cliReadback: true,
        schemaCheck: { command: 'node plugin/scripts/task-schema-check.ts tasks/DIR-118.md', exitCode: 0 },
        scopedCommit: { sha: 'deadbeef', filesChanged: ['tasks/DIR-118.md'], unrelatedChangesPreserved: true },
      },
      {
        kind: 'create', taskId: 'DIR-123', providerQualifiedId: 'native:DIR-123',
        authorizationRef: 'human:conv/2026-07-31#msg-57', beforeHash: null, afterHash: 'ccc',
        mcpReadback: true, cliReadback: true,
        schemaCheck: { command: 'node plugin/scripts/task-schema-check.ts tasks/DIR-123.md', exitCode: 0 },
        scopedCommit: { sha: 'feedface', filesChanged: ['tasks/DIR-123.md'], unrelatedChangesPreserved: true },
      },
    ],
    casNegative: { taskId: 'DIR-118', expectedStatus: 'todo', actualStatus: 'ready', refused: true, beforeHash: 'aaa', afterHash: 'aaa' },
  };
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function runLiveProof(record) {
  const f = path.join(os.tmpdir(), `codex-stage1-evidence-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(record, null, 2));
  const r = spawnSync('node', ['--experimental-strip-types', liveProofCheck, f], { encoding: 'utf8' });
  fs.rmSync(f, { force: true });
  return r;
}

test('E1: a complete, internally consistent evidence record passes (exit 0)', () => {
  const r = runLiveProof(evidenceFixture());
  assert.equal(r.status, 0, `live-proof-check must accept a complete record; output:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /LIVE-PROOF OK/);
});

test('E2 (negative): missing codex session reference fails', () => {
  const ev = evidenceFixture();
  ev.codexSession.ref = '';
  assert.notEqual(runLiveProof(ev).status, 0);
});

test('E3 (negative): a self-congratulatory CODEX-PROBE task id fails (no disposable probe)', () => {
  const ev = evidenceFixture();
  ev.mutations[1].taskId = 'CODEX-PROBE-1';
  const r = runLiveProof(ev);
  assert.notEqual(r.status, 0, 'a probe/fixture task id must be rejected');
  assert.match(r.stdout + r.stderr, /probe|fixture/i);
});

test('E4 (negative): an edit whose before/after hashes are identical fails', () => {
  const ev = evidenceFixture();
  ev.mutations[0].afterHash = ev.mutations[0].beforeHash; // no actual change
  assert.notEqual(runLiveProof(ev).status, 0);
});

test('E5 (negative): an un-refused stale-CAS probe fails', () => {
  const ev = evidenceFixture();
  ev.casNegative.refused = false;
  assert.notEqual(runLiveProof(ev).status, 0);
});

test('E6 (negative): a non-zero schema-check result fails', () => {
  const ev = evidenceFixture();
  ev.mutations[0].schemaCheck.exitCode = 1;
  assert.notEqual(runLiveProof(ev).status, 0);
});

test('E7 (negative): a scoped commit touching an unrelated path fails', () => {
  const ev = evidenceFixture();
  ev.mutations[0].scopedCommit.filesChanged = ['tasks/DIR-118.md', 'packages/quay/src/serve.js'];
  const r = runLiveProof(ev);
  assert.notEqual(r.status, 0, 'a commit touching unrelated files must be rejected');
});

test('E8 (negative): unrelatedChangesPreserved=false fails', () => {
  const ev = evidenceFixture();
  ev.mutations[0].scopedCommit.unrelatedChangesPreserved = false;
  assert.notEqual(runLiveProof(ev).status, 0);
});

test('E9 (negative): a record with no CREATE (only edits) fails', () => {
  const ev = evidenceFixture();
  ev.mutations = ev.mutations.filter((m) => m.kind !== 'create');
  assert.notEqual(runLiveProof(ev).status, 0);
});
