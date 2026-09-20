// @test-group engine
// quay-init-loop.test.mjs — gap-quay-init-never-commits-broken-committed-state (AC1-AC3), rewritten for
// the gap-quay-init-closure-shrink-body closed-set contract.
//
// quay-init 铺文件但从不 commit ⇒ consumer 仓库的 committed 态自洽与否纯属运气。本文件断言交付契约：
// 铺完自动 commit（`chore(quay-init):` 前缀，AC1）；fresh-clone + quay-init ⇒ 闭集文件完整（无 broken
// committed 态，AC2）；已有未提交改动时不静默覆盖（非交互拒绝 + --auto-commit-confirm 只 stage 闭集路径，
// AC3）。收缩后，「机制文件」= 六项闭集（.quay/config.yml / .quay/profiles.yml / .gitignore /
// .claude/launch.settings.json / .claude/settings.json / tasks/），不再是 plugin/scripts 副本。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTmp, cleanup, runInit, pluginDir } from "./quay-init-loop-helpers.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : "";
}

function gitWorkspace() {
  const ws = makeTmp("quay-init-git-");
  const init = spawnSync("git", ["init", "-q"], { cwd: ws, encoding: "utf8" });
  if (init.status !== 0) { cleanup(ws); throw new Error(`git init failed: ${init.stderr}`); }
  spawnSync("git", ["config", "user.name", "quay-init test"], { cwd: ws, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "quay-init-test@example.com"], { cwd: ws, encoding: "utf8" });
  fs.writeFileSync(path.join(ws, "README.md"), "# fixture\n");
  fs.writeFileSync(path.join(ws, "app.txt"), "v1\n");
  spawnSync("git", ["add", "README.md", "app.txt"], { cwd: ws, encoding: "utf8" });
  const cm = spawnSync("git", ["commit", "-qm", "initial"], { cwd: ws, encoding: "utf8" });
  if (cm.status !== 0) { cleanup(ws); throw new Error(`initial commit failed: ${cm.stderr}`); }
  return ws;
}

function cloneOf(ws) {
  const dst = makeTmp("quay-init-clone-");
  fs.rmSync(dst, { recursive: true, force: true });
  const cl = spawnSync("git", ["clone", "-q", ws, dst], { encoding: "utf8" });
  if (cl.status !== 0) { cleanup(dst); throw new Error(`git clone failed: ${cl.stderr}`); }
  return dst;
}

const INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];

// The committed closed-set members (tasks/ and goals/ are empty dirs at laydown, so git tracks
// nothing under them — only the FILES are tracked).
const CLOSED_SET_TRACKED = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json",
];

// ── AC1: auto-commit with a chore(quay-init): prefix commits the closed-set files ───────────────────
test('AC1 — quay-init auto-commits the laid-down closed-set files with a chore(quay-init): prefix', () => {
  const ws = gitWorkspace();
  try {
    const r = runInit(ws, [...INIT_ARGS(ws), "--auto-commit-confirm"]);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /auto-commit: committed/, 'must report the auto-commit');
    const log = git(ws, ["log", "--oneline", "-3"]);
    assert.match(log, /chore\(quay-init\)/, 'the auto-commit must use the chore(quay-init): prefix');
    const tracked = git(ws, ["ls-files"]);
    for (const f of CLOSED_SET_TRACKED) {
      assert.ok(tracked.includes(f), `the committed tree must carry ${f}`);
    }
    // The retired copy surface must NOT be committed.
    assert.ok(!tracked.includes("plugin/scripts/resource-gate.sh"), 'no plugin/scripts copy is committed');
    assert.ok(!/orchestration\//.test(tracked), 'no orchestration/ copy is committed');
  } finally { cleanup(ws); }
});

// ── AC2: fresh-clone carries the closed-set files (no broken committed state) ────────────────────────
test('AC2 — a fresh clone of the committed state carries the full closed-set files', () => {
  const ws = gitWorkspace();
  try {
    const r = runInit(ws, [...INIT_ARGS(ws), "--auto-commit-confirm"]);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const clone = cloneOf(ws);
    try {
      const committed = git(clone, ["ls-files"]);
      for (const f of CLOSED_SET_TRACKED) {
        assert.ok(committed.includes(f), `fresh-clone committed tree must carry ${f}`);
      }
      assert.equal(git(clone, ["status", "--porcelain"]), "", 'fresh clone working tree must be clean');
    } finally { cleanup(clone); }
  } finally { cleanup(ws); }
});

// ── AC3: pre-existing uncommitted changes are NOT silently swept ─────────────────────────────────────
test('AC3 — pre-existing uncommitted changes: non-interactive declines; --auto-commit-confirm commits ONLY the closed-set files', () => {
  const ws = gitWorkspace();
  try {
    fs.writeFileSync(path.join(ws, "notes.txt"), "user note\n");
    fs.writeFileSync(path.join(ws, "app.txt"), "v2\n");

    // Run 1 — non-interactive, no confirm flag: DECLINE, never silently sweep.
    const r1 = runInit(ws, INIT_ARGS(ws));
    assert.equal(r1.status, 0, `declined run must still exit 0 (laydown succeeded):\n${r1.stderr}`);
    assert.match(r1.stderr, /DECLINED \(non-interactive/, 'non-interactive without confirm must decline the auto-commit');
    assert.ok(!/chore\(quay-init\)/.test(git(ws, ["log", "--oneline", "-3"])), 'must NOT commit without confirmation');
    assert.equal(fs.readFileSync(path.join(ws, "notes.txt"), "utf8"), "user note\n", 'pre-existing untracked file survives');
    assert.equal(fs.readFileSync(path.join(ws, "app.txt"), "utf8"), "v2\n", 'pre-existing tracked edit survives');

    // Run 2 — explicit confirmation: commits ONLY quay-init's closed-set paths; pre-existing stays out.
    const r2 = runInit(ws, [...INIT_ARGS(ws), "--auto-commit-confirm"]);
    assert.equal(r2.status, 0, `confirmed run must exit 0:\n${r2.stderr}`);
    assert.match(r2.stdout, /auto-commit: committed/, 'confirmed run must commit');
    assert.match(git(ws, ["log", "--oneline", "-3"]), /chore\(quay-init\)/, 'chore(quay-init) commit must exist after confirmation');
    const status = git(ws, ["status", "--porcelain"]);
    assert.match(status, /notes\.txt/, 'notes.txt must stay uncommitted (not swept into the quay-init commit)');
    assert.match(status, /app\.txt/, 'app.txt must stay uncommitted (not swept into the quay-init commit)');
  } finally { cleanup(ws); }
});

// ── non-git workspace: auto-commit is a no-op; the laydown still succeeds ────────────────────────────
test('AC1/control — a non-git workspace skips auto-commit but still lays the closed-set files down', () => {
  const ws = makeTmp("quay-init-nongit-");
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `non-git laydown must still exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /auto-commit: SKIP \(not a git repository/, 'must skip auto-commit in a non-git workspace');
    assert.ok(fs.existsSync(path.join(ws, ".quay", "config.yml")), 'the closed-set config is laid down');
    assert.ok(fs.existsSync(path.join(ws, ".claude", "settings.json")), 'the closed-set .claude/settings.json is laid down');
    assert.ok(fs.existsSync(path.join(ws, "goals")), 'goals/ is laid down (dual carrier)');
  } finally { cleanup(ws); }
});

// ── --dry-run: never commits (nothing was written) ───────────────────────────────────────────────────
test('AC1/control — --dry-run never auto-commits', () => {
  const ws = gitWorkspace();
  try {
    const r = runInit(ws, [...INIT_ARGS(ws), "--dry-run"]);
    assert.equal(r.status, 0, `dry-run must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /auto-commit: SKIP \(--dry-run/, 'dry-run must skip auto-commit');
    assert.ok(!/chore\(quay-init\)/.test(git(ws, ["log", "--oneline", "-3"])), 'dry-run must not create any commit');
  } finally { cleanup(ws); }
});

// ── AC5 (gap-quay-init-config-heredoc-comment-backtick-executes-cli): every UNQUOTED heredoc body in
// quay-init.sh must be substitution-inert. An unquoted heredoc expands ${...} — which the fresh-install
// config writer needs — and that same expansion ALSO runs `$(...)` and backticks. A comment carrying a
// backtick therefore executes a real command and splices its stdout into the generated .quay/config.yml
// ⇒ the artifact stops being valid YAML, and (measured) three install-family tests go red on develop
// for EVERY code-delta task. Source-level invariant, so nothing has to be installed to check it.
const SUBSTITUTION_HAZARD = /[`]|\$\(/;

/** Enumerate heredocs in a shell script: [openerLine, delimiter, quoted, bodyLines]. */
function heredocs(src) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /<<(-?)(["']?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && lines[j].trim() !== m[3]; j++) body.push(lines[j]);
    out.push({ line: i + 1, delim: m[3], quoted: m[2] !== "", body });
    i = j;
  }
  return out;
}

test('AC5 — no unquoted heredoc body in quay-init.sh carries a backtick or command substitution', () => {
  const src = fs.readFileSync(path.join(pluginDir, "scripts", "quay-init.sh"), "utf8");
  const all = heredocs(src);
  // The scan is only meaningful if it found the heredocs that MATTER — a parser that matches
  // nothing, or that stops early, would otherwise report a vacuous pass (硬规则 3b: "cannot
  // evaluate" must not share an output with "fine"). The guard is therefore PURPOSE-shaped, not a
  // count: (a) the scan must actually reach the CONFIG WRITER's body (proved by a marker only that
  // body carries), and (b) that writer must be the UNQUOTED one — its body is the only one whose
  // backticks/`$( )` are evaluated. A count threshold was the previous shape and went stale the
  // moment the eight python heredocs left the file (gap-arch-quay-init-sh-python-heredocs-to-native):
  // it red-lit a correct port for having FEWER heredocs, which is the direction this task is for.
  const allBodies = all.flatMap((h) => h.body).join("\n");
  assert.ok(
    allBodies.includes("# .quay/config.yml — generated by quay-init"),
    `heredoc scan never reached the config writer's body (found ${all.length} heredoc(s)) — the parser is broken or stopped early`,
  );
  const unquoted = all.filter((h) => !h.quoted);
  assert.ok(unquoted.length >= 1, 'the fresh-install config writer IS an unquoted heredoc — if this is 0 the parser is broken');
  const violations = [];
  for (const h of unquoted) {
    h.body.forEach((b, k) => {
      if (SUBSTITUTION_HAZARD.test(b)) violations.push(`:${h.line + 1 + k} (delim ${h.delim}): ${b.trim()}`);
    });
  }
  assert.deepEqual(
    violations, [],
    `unquoted heredocs execute backticks/$( ) even inside comments — an executed command's stdout is spliced into the written file:\n${violations.join("\n")}`,
  );
});
