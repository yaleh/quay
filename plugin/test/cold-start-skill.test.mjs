// @test-group governance
// cold-start-skill.test.mjs — gap-cold-start-needs-a-human-to-dictate-eight-steps, phase 2 (AC5 +
// merged telemetry AC + AC8c observable-consequences checklist).
//
// Pins the cold-start skill's agent-executed contract:
//   AC5  — plugin/skills/cold-start/SKILL.md instructs mounting BOTH monitors (inner-state.sh +
//          session-liveness.sh) via the Monitor tool, and explicitly forbids nohup (a nohup'd
//          process is identical in `ps` but its output goes to a file — nobody is notified).
//          "事件送得到" not "进程在跑".
//   telemetry AC — the skill asserts a real --task-start record in <root>/.workflow-events/ and
//          treats a missing record as "not connected" (commits/tick-log do NOT substitute).
//   AC8c — the skill defines "observable consequences" as a concrete six-key checklist
//          (MONITORS-MOUNTED / MONITORS-DELIVERING / CRON-CREATED / INNER-DRIVEN /
//          TELEMETRY-RECORD / FIRST-TASK), so "same command, same results on any model" is
//          falsifiable rather than prose.
//   AC1 correction — the skill EXPLICITLY drives inner (send-keys-verified.sh), never treats the
//          inner start as a side effect of outer guidance.
//
// Plus a mechanical rehearsal: a quay-init --loop temp project + a real `--task-start` call must
// produce the .workflow-events/ record the skill's step 7 asserts — the wiring the skill relies
// on, checked in a throwaway project (no live session needed).
//
// Run:
//   scripts/test.sh plugin/test/cold-start-skill.test.mjs
//   node --test plugin/test/cold-start-skill.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');

function makeTmp(prefix = 'cold-start-skill-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A worktree root quay-init's validation ACCEPTS: a real disk path, not tmpfs. /tmp is tmpfs on
// dev boxes and the sibling-of-repo default for a /tmp workspace would be rejected fail-closed
// (gap-the-shipped-tick-doc-... AC3). /var/tmp is the disk-backed tmp on Linux; prefer it.
function diskWorktreeRoot() {
  for (const base of ['/var/tmp', os.tmpdir()]) {
    try {
      const t = spawnSync('stat', ['-f', '-c', '%T', base], { encoding: 'utf8' });
      if (t.status === 0 && t.stdout.trim() !== 'tmpfs') {
        return path.join(base, `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
      }
    } catch { /* try next base */ }
  }
  return path.join(os.tmpdir(), `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

const skillPath = path.join(pluginDir, 'skills', 'cold-start', 'SKILL.md');
const skillSrc = fs.readFileSync(skillPath, 'utf8');

// ── AC5: agent-executed via the Monitor tool, never nohup ───────────────────────────────────────────
test('AC5 — the cold-start skill exists, is a Monitor-based agent skill, and is registered in plugin.json', () => {
  assert.ok(fs.existsSync(skillPath), 'plugin/skills/cold-start/SKILL.md must exist');
  // Frontmatter: name + the tool the agent is allowed to call (Monitor must be present so the
  // agent CAN mount monitors — a skill that cannot call Monitor cannot be the AC5 mechanism).
  assert.match(skillSrc, /^name:\s*quay-cold-start/m, 'skill name must be quay-cold-start');
  const fm = skillSrc.match(/^allowed-tools:\s*(.+)$/m);
  assert.ok(fm, 'skill must declare allowed-tools');
  assert.ok(fm[1].includes('Monitor'), 'allowed-tools must include Monitor (the agent must be able to mount monitors)');
  assert.ok(fm[1].includes('CronCreate'), 'allowed-tools must include CronCreate (the skill re-creates the 20-min cron)');
  // Registered in plugin.json commands[] (plugin-packaging.test.mjs enforces the exact set).
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(manifest.commands.includes('./skills/cold-start/SKILL.md'),
    'plugin.json commands[] must register the cold-start skill');
});

test('AC5 — the skill mounts BOTH monitors via the Monitor tool (inner-state + session-liveness)', () => {
  assert.match(skillSrc, /Monitor\(\{command:.*inner-state\.sh/s,
    'the skill must instruct a Monitor for inner-state.sh');
  assert.match(skillSrc, /Monitor\(\{command:.*session-liveness-mount\.sh/s,
    'the skill must instruct a Monitor for the single-flight mount entry session-liveness-mount.sh (AC20)');
  assert.match(skillSrc, /persistent:\s*true/s,
    'both monitors must be persistent (outlive the current turn)');
  // The judgment is "events delivered to THIS session", not "process running".
  assert.match(skillSrc, /DELIVERED to this session/s,
    'the skill must state the delivered-event criterion');
});

test('AC5 — the skill explicitly forbids nohup (a nohup process is indistinguishable in ps but notifies nobody)', () => {
  assert.match(skillSrc, /nohup/s, 'the skill must name the nohup anti-pattern so a reader cannot miss it');
  assert.match(skillSrc, /Never use nohup/s, 'the skill must explicitly forbid nohup');
  // The skill presents nohup ONLY as the thing not to do — the forbidding sentence is the only
  // "nohup" imperative; the monitors are mounted via the Monitor tool, not backgrounded.
  assert.ok(skillSrc.includes('STOP — that is the anti-pattern this skill exists'),
    'the skill must tell the agent to STOP rather than nohup');
});

// ── Telemetry AC: the "loop is up" proof is a real .workflow-events/ --task-start record ─────────────
test('telemetry AC — the skill asserts a real --task-start record in .workflow-events/ and treats a missing one as not-connected', () => {
  assert.match(skillSrc, /\.workflow-events\//, 'the skill must reference the target .workflow-events/ dir');
  assert.match(skillSrc, /--task-start/, 'the skill must reference the --task-start telemetry record');
  assert.ok(skillSrc.includes('never recorded its own start'),
    'the skill must state that commits/tick-log do NOT substitute for the telemetry record');
  assert.match(skillSrc, /has NOT connected/, 'a missing record must be reported as not-connected');
});

// ── AC8c: the observable-consequences checklist is concrete and falsifiable ──────────────────────────
test('AC8c — the skill defines the observable-consequences checklist as a concrete six-key list', () => {
  for (const key of [
    'MONITORS-MOUNTED', 'MONITORS-DELIVERING', 'CRON-CREATED',
    'INNER-DRIVEN', 'TELEMETRY-RECORD', 'FIRST-TASK',
  ]) {
    assert.ok(skillSrc.includes(key), `the observable-consequences checklist must define ${key}`);
  }
  assert.match(skillSrc, /falsifiable/, 'the checklist must be stated as the falsifiable definition of "same results"');
  assert.match(skillSrc, /all six/, 'the skill must require ALL six consequences, not a subset');
});

// ── AC1 correction: the inner start is DRIVEN, never assumed as a side effect ────────────────────────
test('AC1 correction — the skill explicitly drives inner via send-keys-verified.sh, not as a side effect', () => {
  assert.match(skillSrc, /send-keys-verified\.sh/s, 'the skill must drive inner via send-keys-verified.sh');
  assert.match(skillSrc, /EXPLICIT, never a side effect|not assumed as a side effect/i,
    'the skill must state the inner start is explicit, never assumed');
});

// ── Mechanical rehearsal: a real --task-start in a quay-init --loop project produces the record ───────
// The skill's step 7 asserts `<root>/.workflow-events/*.jsonl` carries a --task-start record. That
// assertion is only meaningful if the laid-down mechanism actually produces it — checked here in a
// throwaway project (no live session, no monitor mount needed).
test('rehearsal — a real --task-start against a quay-init --loop project writes the .workflow-events/ record the skill asserts', () => {
  const ws = makeTmp();
  try {
    const init = spawnSync('bash', [path.join(pluginDir, 'scripts', 'quay-init.sh'),
      '--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
      '--worktree-root', diskWorktreeRoot(), '--tmux-session', 'proj-0:0.0'],
      { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir } });
    assert.equal(init.status, 0, `quay-init --loop must succeed:\n${init.stderr}`);
    const ts = spawnSync('node', ['--experimental-strip-types',
      path.join(ws, 'plugin', 'scripts', 'fast-mode-telemetry.ts'),
      '--task-start', '--taskId', 'cold-start-rehearsal', '--root', ws],
      { cwd: ws, encoding: 'utf8' });
    assert.equal(ts.status, 0, `--task-start must succeed:\n${ts.stderr}`);
    // The record the skill's step 7 greps for must actually exist in the target project.
    const eventsDir = path.join(ws, '.workflow-events');
    assert.ok(fs.existsSync(eventsDir), '.workflow-events/ must be created by --task-start');
    const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(files.length > 0, '--task-start must write a .workflow-events/*.jsonl file');
    const record = fs.readFileSync(path.join(eventsDir, files[0]), 'utf8');
    assert.match(record, /task-start|taskId/, 'the record must carry the task-start event shape');
  } finally { cleanup(ws); }
});
