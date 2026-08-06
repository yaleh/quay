// @test-group governance
// quay-init-laydown-closure.test.mjs — gap-laydown-derivation-is-sensitive-to-reference-spelling-
// dependency-closure (AC1/AC2/AC3 fixture).
//
// The derived laydown set (plugin/scripts/quay-init.sh derive_loop_scripts) was SENSITIVE TO
// REFERENCE SPELLING: a script referenced by bare filename (no `plugin/scripts/` prefix) silently
// never shipped, AND the verify check (verify_referenced_landed) shared the same prefix-only
// derivation — so the checker could never see the missing script it was supposed to catch (shared
// blind spot). Manager's self-inflicted instance: cold-start/SKILL.md + orchestrator-loop-tick.md
// reference `transcript-delivery-check.ts` by BARE NAME, so it was never laid down, while its
// consumer send-keys-reliable.sh WAS laid down (prefixed). The laid-down delivery-verification was
// broken from first use.
//
// Fix (chosen mechanism, (b) PRIMARY + (a) auxiliary):
//   AC1 (b) dependency closure — a laid-down script that references a same-dir sibling via a
//          script-dir variable (`${SCRIPT_DIR}/transcript-delivery-check.ts`) forces that sibling
//          into the set. Content-level (the validator is the SCRIPT, not the doc wording), so it
//          catches the whole class (a) can never see. Regression control: send-keys-reliable.sh:41.
//   AC2 (a) bare-name existence-resolution — a bare script name in a TICK DOC (the target's runtime
//          instruction set, laid down) resolves under plugin/scripts/. Scoped to tick docs: skills'
//          bare names are ambiguous prose (meta-examples like send-keys-verified.sh, plugin-root
//          refs, the installer) and resolving them would RE-DERIVE retired/dev-tree scripts.
//   AC3 verify blind-spot — verify_referenced_landed's referenced-set derivation is extended to the
//          same prefix + bare-name ruler, so the checker no longer shares the blind spot.
//   AC4 send-keys-reliable.sh fail-loud — a missing CHECKER exits 1 at startup (tested in
//          send-keys-reliable.test.mjs, same gap).
//
// Contract:
//   measure   dependency_closure_gaps = `bash plugin/scripts/quay-init.sh --check-dependency-closure`
//             stdout 数字段（已铺但依赖未铺的脚本数）
//   band      dependency_closure_gaps = 0（铺了消费者必然铺依赖；send-keys-reliable 补齐后为 0）
//   invariant closure_not_documentation = 1（校验对象是脚本内容 [SCRIPT_DIR 引用]，非文档措辞）
//   invoke    `grep -n 'transcript-delivery-check' plugin/scripts/send-keys-reliable.sh plugin/scripts/quay-init.sh`
//   control   构造裸文件名引用脚本（缺前缀）⇒ 派生抓到 + verify 抓到（AC2/AC3）；CHECKER 缺失 ⇒ fail-loud（AC4 负向）
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const INIT = path.join(pluginDir, 'scripts', 'quay-init.sh');
const SEND_KEYS = path.join(pluginDir, 'scripts', 'send-keys-reliable.sh');
const TRANSCRIPT_CHECKER = path.join(pluginDir, 'scripts', 'transcript-delivery-check.ts');

function makeTmp(prefix = 'qic-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A disk (non-tmpfs) worktree root the --loop validation accepts (same pattern as
// quay-init-loop.test.mjs). Dirs land in a carrier array cleaned by the after() hook.
const _wtRoots = [];
after(() => {
  for (const d of _wtRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
function diskWorktreeRoot() {
  let dir = null;
  for (const base of ['/var/tmp', os.tmpdir()]) {
    try {
      const t = spawnSync('stat', ['-f', '-c', '%T', base], { encoding: 'utf8' });
      if (t.status === 0 && t.stdout.trim() !== 'tmpfs') { dir = fs.mkdtempSync(path.join(base, 'quay-wt-qic-')); break; }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quay-wt-qic-'));
  _wtRoots.push(dir);
  return dir;
}

function runInit(workspace, args = [], pluginRoot = pluginDir) {
  const loop = args.includes('--loop');
  const extra = loop && !args.some((a) => a === '--worktree-root') ? ['--worktree-root', diskWorktreeRoot()] : [];
  return spawnSync('bash', [INIT, ...extra, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

const LOOP_ARGS = (ws) => ['--loop', '--root', ws, '--project', 'proj',
  '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];

// ── AC1 (b) dependency closure: real-plugin regression control ─────────────────────────────────────
// The manager's instance: send-keys-reliable.sh (prefixed → derived) references
// transcript-delivery-check.ts ONLY by bare name in the docs AND by ${SCRIPT_DIR}/... in its own
// content. After the closure fix, a --loop install MUST lay the checker down and verify MUST pass.
test('AC1 — a real --loop install lays down transcript-delivery-check.ts (the bare-name-referenced sibling of send-keys-reliable.sh)', () => {
  const ws = makeTmp();
  try {
    assert.ok(fs.existsSync(TRANSCRIPT_CHECKER), 'the checker must exist in the plugin (it is the missing delivery)');
    const r = runInit(ws, LOOP_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'send-keys-reliable.sh')),
      'the consumer must be laid down');
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'transcript-delivery-check.ts')),
      'the checker sibling must be laid down (dependency closure of send-keys-reliable.sh:41)');
    assert.match(r.stdout, /verify-referenced-landed: OK/,
      'verify must pass — the bare-name-referenced script is now in the referenced set AND landed');
    // Contract invoke: the consumer → checker reference is content-level, mechanically visible.
    const sk = fs.readFileSync(SEND_KEYS, 'utf8');
    assert.match(sk, /\$\{SCRIPT_DIR\}\/transcript-delivery-check\.ts/,
      'send-keys-reliable.sh must reference the checker via ${SCRIPT_DIR}/ (the closure signal)');
  } finally { cleanup(ws); }
});

// ── AC1 (b): closure is CONTENT-based, spelling-independent ────────────────────────────────────────
// A consumer script referenced by FULL PREFIX in a skill, whose sibling dep is referenced NOWHERE
// in any doc (no prefix, no bare name) — the closure must still force the sibling in. The validator
// is the script content, not the doc wording (invariant closure_not_documentation = 1).
test('AC1 — closure forces a sibling in even when NO doc references it by any spelling (content-level, spelling-independent)', () => {
  const src = makeTmp();
  const ws = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.writeFileSync(path.join(src, 'scripts', 'closure-consumer.sh'),
      '#!/usr/bin/env bash\nSCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nCHECKER="${SCRIPT_DIR}/closure-dep.ts"\n# fixture: consumer references a sibling NO doc names\n', 'utf8');
    fs.writeFileSync(path.join(src, 'scripts', 'closure-dep.ts'),
      '// closure-dep.ts — fixture sibling, referenced only by ${SCRIPT_DIR} in closure-consumer.sh\n', 'utf8');
    // A skill references the CONSUMER by full prefix (that is the only doc trace of the pair).
    fs.appendFileSync(path.join(src, 'skills', 'cold-start', 'SKILL.md'),
      '\nbash <root>/plugin/scripts/closure-consumer.sh --fixture\n', 'utf8');

    const r = runInit(ws, LOOP_ARGS(ws), src);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'closure-consumer.sh')),
      'the consumer (prefix-referenced) must be laid down');
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'closure-dep.ts')),
      'the sibling dep must be laid down by CLOSURE alone — it is referenced nowhere in any doc');
  } finally { cleanup(ws); cleanup(src); }
});

// ── AC2 (a): a bare-name reference in a TICK DOC is existence-resolved ─────────────────────────────
// The target's runtime instruction set (loop/*.md, laid down) writes a script name with NO prefix —
// that must no longer silently miss (manager's orchestrator-loop-tick.md `transcript-delivery-check.ts`).
test('AC2 — a bare-name reference in a tick doc is derived (existence-resolved under plugin/scripts/)', () => {
  const src = makeTmp();
  const ws = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.writeFileSync(path.join(src, 'scripts', 'bare-dep.ts'),
      '// bare-dep.ts — fixture, referenced only by bare name in a tick doc\n', 'utf8');
    // A NEW tick doc (laid down into the target) names bare-dep.ts with NO plugin/scripts/ prefix.
    fs.writeFileSync(path.join(src, 'loop', 'fixture-bare.md'),
      'Run the check: `bash plugin/scripts/bare-consumer.sh` (the bare-dep.ts verdict).\n', 'utf8');
    fs.writeFileSync(path.join(src, 'scripts', 'bare-consumer.sh'),
      '#!/usr/bin/env bash\n# bare-consumer.sh — fixture consumer, prefix-referenced; bare-dep.ts is not its sibling\n', 'utf8');

    const r = runInit(ws, LOOP_ARGS(ws), src);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(ws, 'plugin', 'scripts', 'bare-dep.ts')),
      'the bare-name-referenced script must be laid down (AC2 existence-resolution)');
    assert.match(r.stdout, /verify-referenced-landed: OK/,
      'verify must ACK the bare-name ref (AC3: the checker no longer ignores the class)');
  } finally { cleanup(ws); cleanup(src); }
});

// ── AC3: verify's referenced set now INCLUDES bare-name tick-doc refs (no shared blind spot) ───────
// Replicate verify_referenced_landed's NEW referenced-set derivation (prefix + tick-doc bare-name)
// and assert the bare-name-referenced script is IN it — the checker can now SEE the class it was
// blind to. Also guard the scoping: a bare-name mention in a SKILL (retired/dev-tree) must NOT be a
// derivation trigger (the layer-retirement invariant holds).
test('AC3 — the referenced set now includes the bare-name ref (checker no longer shares the blind spot); skill bare names stay out', () => {
  // Replicate verify_referenced_landed's extended derivation: prefix refs + tick-doc bare names.
  const files = [];
  for (const d of fs.readdirSync(path.join(pluginDir, 'skills'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(pluginDir, 'skills', d.name, 'SKILL.md');
    if (fs.existsSync(f)) files.push(f);
  }
  const loopDir = path.join(pluginDir, 'loop');
  for (const f of fs.readdirSync(loopDir)) {
    if (f.endsWith('.md')) files.push(path.join(loopDir, f));
  }
  const refs = new Set();
  const prefixRe = /(?:plugin\/scripts|orchestration|docs\/analysis)\/[a-zA-Z0-9._-]+/g;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = prefixRe.exec(text)) !== null) refs.add(m[0]);
  }
  // tick-doc bare-name refs, existence-resolved (the AC3 extension).
  for (const f of fs.readdirSync(loopDir)) {
    if (!f.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(loopDir, f), 'utf8');
    const bareRe = /[a-zA-Z0-9._-]+\.(?:sh|ts|mjs|js|mts|cjs)/g;
    let m;
    while ((m = bareRe.exec(text)) !== null) {
      const b = m[0];
      if (fs.existsSync(path.join(pluginDir, 'scripts', b))) refs.add(`plugin/scripts/${b}`);
    }
  }
  // The checker (bare in orchestrator-loop-tick.md) must be IN the referenced set.
  assert.ok(refs.has('plugin/scripts/transcript-delivery-check.ts'),
    'the bare-name-referenced checker must be in verify\'s referenced set (AC3: no shared blind spot)');
  // Scoping guard: send-keys-verified.sh is bare-name-mentioned ONLY in a SKILL (init/SKILL.md
  // meta-example) — it must NOT be in the referenced set, so the layer-retirement holds.
  assert.ok(!refs.has('plugin/scripts/send-keys-verified.sh'),
    'a skill-only bare-name mention must NOT become a referenced file (retired scripts stay retired)');
});

// ── Contract measure: dependency_closure_gaps = 0 on the fixed plugin ──────────────────────────────
test('Contract — `--check-dependency-closure` reports dependency_closure_gaps: 0 (band 0)', () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ['--check-dependency-closure', '--root', ws]);
    assert.equal(r.status, 0, `--check-dependency-closure must exit 0:\n${r.stderr}`);
    const m = r.stdout.match(/dependency_closure_gaps:\s*(\d+)/);
    assert.ok(m, `parseable dependency_closure_gaps field must exist:\n${r.stdout}`);
    assert.equal(Number(m[1]), 0, 'the fixed repo must have ZERO dependency-closure gaps (consumer always ships with its dependency)');
  } finally { cleanup(ws); }
});

// ── Contract negative control: a laid-down script referencing a MISSING sibling ⇒ gaps > 0 ────────
// Construct a consumer that IS in the laydown set (prefix-referenced) whose same-dir sibling is
// referenced via ${SCRIPT_DIR}/ but does NOT exist in plugin/scripts/ ⇒ the closure cannot add it, so
// the measure reports the gap and exits 1 (the check is a real gate — "铺了消费者必须铺依赖"，依赖缺失
// 时 fail loud，与 AC4 同一精神). This is the closure-gap regression guard: if the closure pass or a
// sibling ever breaks, a gap appears instead of a silent broken delivery.
test('Contract control — a laid-down script referencing a sibling missing from the plugin reports a gap (exit 1)', () => {
  const src = makeTmp();
  const ws = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    fs.writeFileSync(path.join(src, 'scripts', 'orphan-sibling.sh'),
      '#!/usr/bin/env bash\nSCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nORPHAN_CHECKER="${SCRIPT_DIR}/orphan-ghost.ts"\n# fixture consumer, prefix-referenced below\n', 'utf8');
    // orphan-ghost.ts deliberately NOT created under scripts/ — the dependency cannot ship.
    assert.ok(!fs.existsSync(path.join(src, 'scripts', 'orphan-ghost.ts')),
      'the ghost sibling must not exist (the defect under test)');
    fs.appendFileSync(path.join(src, 'skills', 'cold-start', 'SKILL.md'),
      '\nbash <root>/plugin/scripts/orphan-sibling.sh --fixture\n', 'utf8');

    const r = runInit(ws, ['--check-dependency-closure', '--root', ws], src);
    assert.equal(r.status, 1, `the check must FAIL (exit 1) on a dependency that cannot ship:\n${r.stdout}\n${r.stderr}`);
    const m = r.stdout.match(/dependency_closure_gaps:\s*(\d+)/);
    assert.ok(m, `parseable field must exist:\n${r.stdout}`);
    assert.equal(Number(m[1]), 1, 'must report exactly ONE gap (orphan-ghost.ts — missing from plugin)');
    assert.match(r.stderr, /orphan-ghost\.ts/, 'the gap must name the missing sibling');
  } finally { cleanup(ws); cleanup(src); }
});
