// @test-group lowconc
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — the rehearsal
// test below runs a real quay-init --loop project + a real --task-start; it passes isolated under low
// load but may fail under concurrent-suite load (gap-load-sensitive-session-family-confounds-step-three,
// 2026-08-04). A full-suite failure here is NOT a real regression by default: re-run this file alone
// (low load) before concluding anything.
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (B-class real wall-clock wait — real quay-init --loop + --task-start) so it runs in
// the concurrency-1 serial phase, never competing with the concurrency-8 main body.
// cold-start-skill.test.mjs — gap-cold-start-needs-a-human-to-dictate-eight-steps, phase 2 (AC5 +
// merged telemetry AC + AC8c observable-consequences checklist).
//
// Pins the cold-start skill's agent-executed contract:
//   AC5  — plugin/skills/cold-start/SKILL.md no longer instructs a monitor mount (the observer was
//          retired 2026-09-03), and no longer references the retired observer scripts (a nohup'd
//          process is identical in `ps` but its output goes to a file — nobody is notified).
//          "事件送得到" not "进程在跑".
//   telemetry AC — the skill asserts a real --task-start record in <root>/.workflow-events/ and
//          treats a missing record as "not connected" (commits/tick-log do NOT substitute).
//   AC8c — the skill defines "observable consequences" as a concrete seven-key checklist
//          (CRON-CREATED / INNER-DRIVEN /
//          TELEMETRY-RECORD / FIRST-TASK / TOPOLOGY-IN-PLACE), so "same command, same results
//          on any model" is falsifiable rather than prose.
//   AC1 correction — the skill EXPLICITLY drives inner (send-keys-reliable.sh + the
//          transcript-delivery-check.ts verdict), never treats the inner start as a side effect
//          of outer guidance; the superseded whole-pane-hash criterion is NOT taught (AC2/AC3).
//
// Plus a mechanical rehearsal: a quay-init --loop temp project + a real `--task-start` call must
// produce the .workflow-events/ record the skill's step 8 asserts — the wiring the skill relies
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

test('AC5 — the retired observer mount is gone: the skill no longer instructs a Monitor mount', () => {
  assert.ok(!/Monitor\(\{command:.*session-liveness-mount\.sh/s.test(skillSrc),
    'the skill must NOT instruct a Monitor for the retired observer mount entry');
  assert.ok(!/session-liveness\.sh/.test(skillSrc),
    'the skill must not reference the retired observer script');
  assert.ok(!/monitor-mount-check\.sh/.test(skillSrc),
    'the skill must not reference the retired mount check');
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
test('AC8c — the skill defines the observable-consequences checklist as a concrete five-key list', () => {
  for (const key of [
    'CRON-CREATED',
    'INNER-DRIVEN', 'TELEMETRY-RECORD', 'FIRST-TASK', 'TOPOLOGY-IN-PLACE',
  ]) {
    assert.ok(skillSrc.includes(key), `the observable-consequences checklist must define ${key}`);
  }
  assert.match(skillSrc, /falsifiable/, 'the checklist must be stated as the falsifiable definition of "same results"');
  assert.match(skillSrc, /all five/, 'the skill must require ALL five consequences, not a subset');
});

// ── AC1 correction: the inner start is DRIVEN, never assumed as a side effect ────────────────────────
test('AC1 correction — the skill explicitly drives inner via send-keys-reliable.sh (reliable-send), not as a side effect', () => {
  assert.match(skillSrc, /send-keys-reliable\.sh/s, 'the skill must drive inner via send-keys-reliable.sh (reliable-send)');
  assert.ok(!/send-keys-verified\.sh/.test(skillSrc), 'the skill must NOT reference the superseded send-keys-verified.sh (outer ruling F)');
  assert.match(skillSrc, /EXPLICIT, never a side effect|not assumed as a side effect/i,
    'the skill must state the inner start is explicit, never assumed');
});

test('AC2 — the skill teaches the reliable-send delivery criterion (transcript user message), with zero pane-hash criterion', () => {
  assert.match(skillSrc, /transcript-delivery-check\.ts/s, 'the skill must reference the transcript-delivery-check.ts pure verdict');
  assert.match(skillSrc, /send-keys-reliable\.sh/s, 'the skill must teach send-keys-reliable.sh (reliable-send)');
  assert.match(skillSrc, /CRYSTALLIZED-reliable-send-2026-08-04\.md/s, 'the skill must cross-reference the crystallized reliable-send doc (AC3)');
  assert.match(skillSrc, /outer-rulings-2026-08-04-A-F\.md/s, 'the skill must cross-reference outer ruling F (AC3)');
  assert.ok(!/send-keys-verified\.sh/.test(skillSrc), 'send-keys-verified.sh must be gone from the skill (AC2, 0 hits)');
  assert.ok(!/pane hash/.test(skillSrc), 'the "pane hash" criterion must be gone from the skill (AC2, 0 hits)');
});

// ── Mechanical rehearsal: a real --task-start in a quay-init --loop project produces the record ───────
// The skill's step 8 asserts `<root>/.workflow-events/*.jsonl` carries a --task-start record. That
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
    // The record the skill's step 8 greps for must actually exist in the target project.
    const eventsDir = path.join(ws, '.workflow-events');
    assert.ok(fs.existsSync(eventsDir), '.workflow-events/ must be created by --task-start');
    const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(files.length > 0, '--task-start must write a .workflow-events/*.jsonl file');
    const record = fs.readFileSync(path.join(eventsDir, files[0]), 'utf8');
    assert.match(record, /task-start|taskId/, 'the record must carry the task-start event shape');
  } finally { cleanup(ws); }
});

// ── Recovery branch (gap-cold-start-skill-has-no-recovery-branch) ─────────────────────────────────
// The cold-start skill has exactly one path: "mechanism not laid down → lay down → mount → cron →
// drive → prove." It had NO branch for a workspace whose last run crashed mid-flight leaving real
// state behind (the two real OOM recoveries). The recovery branch (steps 0a/0b) routes to a
// recovery procedure when mid-flight state exists and to the unchanged fresh-start path when it
// does not, reusing the EXISTING detection tools (task-status-drift-check.ts / fast-mode-telemetry
// --report / git worktree list + git branch) — zero new detection logic.

// Contract measure: recovery_branch = `grep -c 'recovery' SKILL.md` ≥ 1.
test('recovery — the skill defines a recovery branch distinct from the fresh-start branch (Contract: recovery ≥ 1)', () => {
  const recoveryMentions = (skillSrc.match(/recovery/g) || []).length;
  assert.ok(recoveryMentions >= 1, `SKILL.md must mention 'recovery' at least once (got ${recoveryMentions})`);
  assert.match(skillSrc, /### 0a\. Mid-flight state check/, 'the skill must define the recovery-vs-fresh-start routing');
  assert.match(skillSrc, /### 0b\. Recovery branch/, 'the skill must have a recovery-branch section');
  // Invariant fresh_start_preserved: the recovery branch does NOT replace the fresh-start path.
  assert.match(skillSrc, /### 1\. Locate root, project, session/, 'the fresh-start steps must remain');
});

test('recovery AC1/AC4 — the routing is stated in BOTH directions (recovery on mid-flight state; fresh-start when clean — never false-positive)', () => {
  assert.match(skillSrc, /if and only\s+if/, 'the routing must be a checkable iff');
  assert.match(skillSrc, /All three\s+clean/, 'a clean result must route to fresh-start');
  assert.match(skillSrc, /negative control/, 'the negative control must be named');
  assert.match(skillSrc, /never false-positive into recovery/, 'a clean workspace must not take the recovery branch');
});

test('recovery AC2 — the three state classes are enumerated via EXISTING tools, not new detection logic', () => {
  // State class ③ — status drift: reuses task-status-drift-check.ts.
  assert.match(skillSrc, /task-status-drift-check\.ts/, 'state class ③ must reuse task-status-drift-check.ts');
  // State class ② — ghost telemetry: reuses fast-mode-telemetry.ts --report --json.
  assert.match(skillSrc, /fast-mode-telemetry\.ts --report --json/, 'state class ② must reuse fast-mode-telemetry.ts --report');
  // State class ① — orphaned worktree/branch: reuses git worktree list + git branch --list "task/*".
  assert.match(skillSrc, /git worktree list/, 'the orphaned-worktree check must reuse git worktree list');
  assert.match(skillSrc, /branch --list "task\/\*"/, 'the orphaned-branch check must reuse git branch --list "task/*"');
  // Reuse is stated — no new detection.
  assert.match(skillSrc, /existing tools only/, 'the recovery branch must state it reuses existing tools');
  assert.match(skillSrc, /no new detection/i, 'the skill must state zero new detection logic');
});

test('recovery AC3 — the recovery branch converges into the SAME AC8c checklist, no second acceptance framework', () => {
  assert.match(skillSrc, /SAME AC8c/, 'the recovery branch must converge into the same AC8c observable-consequences checklist');
  assert.match(skillSrc, /no second acceptance framework/, 'no separate acceptance criteria may be invented');
  assert.match(skillSrc, /all three come back clean/i, 'convergence must be gated on all three checks clean');
});

test('recovery — ghost-telemetry resolution deletes the record when verified done/still-todo, never backfills a fabricated --task-end', () => {
  assert.match(skillSrc, /NEVER backfill a plausible-but-fabricated `--task-end`/, 'the skill must forbid fabricating a --task-end');
  assert.match(skillSrc, /DELETE the ghost record/, 'the resolution must delete the ghost record');
  assert.match(skillSrc, /verify against the task's REAL state/i, 'the resolution must verify real task state first');
});

// ── Recovery routing rehearsal (AC1/AC4, both directions) ──────────────────────────────────────────
// The routing decision the skill documents (step 0a) is: recovery iff the mechanism is laid down AND
// any of the three checks reports a non-empty finding; all clean ⇒ fresh-start. This rehearsal drives
// the two extremes with the EXISTING tool the skill names for state class ② (fast-mode-telemetry
// --report): a ghost `--task-start` record (an inProgress entry whose taskId has NO in-flight worktree)
// must route to recovery; an empty .workflow-events must route to fresh-start (the negative control).
function gitWorktreeHas(root, taskId) {
  const wt = spawnSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  if (wt.status !== 0) return false;
  return wt.stdout.includes(`quay-worktrees/${taskId}`);
}
test('recovery routing rehearsal — a ghost --task-start routes to recovery; a clean workspace routes to fresh-start (AC1/AC4)', () => {
  const root = diskWorktreeRoot(); // disk-backed (not tmpfs)
  fs.mkdirSync(path.join(root, '.workflow-events'), { recursive: true });
  try {
    // git init so `git branch --list "task/*"` / `git worktree list` are meaningful and hermetic.
    const gi = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' });
    assert.equal(gi.status, 0, `git init must succeed:\n${gi.stderr}`);

    // NEGATIVE CONTROL (AC4): a clean workspace (no .workflow-events records) → fresh-start.
    const clean = spawnSync('node', ['--experimental-strip-types',
      path.join(pluginDir, 'scripts', 'fast-mode-telemetry.ts'),
      '--report', '--json', '--root', root], { cwd: root, encoding: 'utf8' });
    assert.equal(clean.status, 0, `clean --report must succeed:\n${clean.stderr}`);
    const cleanReport = JSON.parse(clean.stdout);
    assert.ok(Array.isArray(cleanReport.inProgress), 'clean report must carry inProgress[]');
    const cleanGhost = cleanReport.inProgress.filter((r) => !gitWorktreeHas(root, r.taskId));
    assert.equal(cleanGhost.length, 0,
      'a clean workspace must have zero ghost telemetry records → routes to fresh-start, never recovery');

    // POSITIVE CONTROL (AC1): a ghost --task-start record (taskId with NO in-flight worktree) → recovery.
    const ts = spawnSync('node', ['--experimental-strip-types',
      path.join(pluginDir, 'scripts', 'fast-mode-telemetry.ts'),
      '--task-start', '--taskId', 'ghost-task', '--root', root], { cwd: root, encoding: 'utf8' });
    assert.equal(ts.status, 0, `--task-start must succeed:\n${ts.stderr}`);
    const dirty = spawnSync('node', ['--experimental-strip-types',
      path.join(pluginDir, 'scripts', 'fast-mode-telemetry.ts'),
      '--report', '--json', '--root', root], { cwd: root, encoding: 'utf8' });
    assert.equal(dirty.status, 0, `dirty --report must succeed:\n${dirty.stderr}`);
    const dirtyReport = JSON.parse(dirty.stdout);
    const ghost = dirtyReport.inProgress.filter((r) => r.taskId === 'ghost-task' && !gitWorktreeHas(root, r.taskId));
    assert.equal(ghost.length, 1,
      'a ghost --task-start must surface in inProgress[] with no worktree → the routing takes the recovery branch');
  } finally { cleanup(root); }
});
