// @test-group lowconc
// @load-sensitive wall-clock
// session-liveness.test.mjs — SESSION-DISABLED 复合条件发射端
// (gap-session-saturated-composite-condition-emitter, 2026-08-13)
//
// The task's spec (manager 2026-08-13, 选 A): the SESSION-SATURATED emitter reported ONE component
// of the judgment (context size proxy), so every reader had to re-derive the real assertion on each
// event. The judgment is now moved INTO the emitter, and the event renamed to match the actual
// assertion — 「失能/disabled」, not merely 「饱和/saturated」. SESSION-DISABLED is emitted ONLY when
// the composite holds:
//   ① 饱和 —— cache_read_input_tokens ≥ SATURATION_TOKENS && 最后一条未应答 user 输入
//   && ② 该层 develop 提交静默 ≥ T（T = SATURATION_SILENCE_MIN，env 可配，非字面量 30）
//   && ③ 在飞 worktree 集合无变化（集合差手法，不用时间戳；首轮无基线 ⇒ 判「有变化」）
//   && ④ 在飞【链接】worktree 无活进程（忙时必假直接量，gap-session-disabled-fires-when-busy
//        2026-08-14：原三合取在最忙时误报——develop 静默与集合无变化在多任务实现中同时翻真，
//        第④条用 /proc/<pid>/cwd 把「忙」（worktree 有活进程 ⇒ 取假）与「失能」（无活进程）分开）
//
// Coverage map (task ACs):
//   AC1 — emit only when all four hold (all-four fires; unsaturated doesn't)
//   AC2 — T configurable via SATURATION_SILENCE_MIN env (not a hardcoded literal 30) and actually
//         gates emission (T=1 with a 2min-old develop emits; T=100 with the same develop does not)
//   AC3 — event name is the disabled form (SESSION-DISABLED, 失能); negative controls: saturated-
//         but-develop-active ⇒ no emit; saturated+silent-but-in-flight-changing ⇒ no emit;
//         multi-task implementation in progress (5 worktrees + live processes, manager 12:16Z
//         replay) ⇒ no emit
//   AC4 — not turned off: true saturation-to-disabled still emits (AC1 positive); not constant-
//         emitting: exactly ONE emission per disabled spell (edge-trigger over ≥3 further rounds)
//   AC5 — existing tests stay green (the rename ripple in session-liveness-signals-kinds.test.mjs
//         tracks the spec-mandated SESSION-SATURATED → SESSION-DISABLED); scoped gate green
//   新④ — 忙时必假合取项能取假（AC1/判据2）：worktree 有活进程 ⇒ 不报；活进程消失（真失能）⇒ 报
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the /tmp prefix
// "session-liveness-scd-" (setProbeTmpPrefix) and the after() sweeps ONLY it (+ ol-prod-), so this
// file can never delete a sibling file's active probe dir.
//
// Run: scripts/test.sh plugin/test/session-liveness.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  SCRIPT, tmuxAvailable, setProbeTmpPrefix, sweepTmp, reapLiveOwners,
  makeHermeticProbe, waitForAlive, spawnMonitor, waitForOutput, waitForRounds,
  writeTranscript, assistantUsageRecord, userInputRecord, isoAgo, HANG_GUARD_MS,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-");

after(() => {
  reapLiveOwners();
  sweepTmp("session-liveness-scd-", "ol-prod-");
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

// A temp git repo whose develop branch points at a commit dated `backdateMin` minutes ago.
// backdateMin=0 → develop commit is NOW (active); backdateMin>0 → develop is silent for that long.
function makeRepoWithDevelop(dir, { backdateMin = 0 } = {}) {
  const env = { ...process.env };
  if (backdateMin > 0) {
    const when = new Date(Date.now() - backdateMin * 60000).toISOString();
    env.GIT_AUTHOR_DATE = when;
    env.GIT_COMMITTER_DATE = when;
  }
  const git = (args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  fs.mkdirSync(dir, { recursive: true });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", "."]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  assert.equal(git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."]).status, 0, "git add failed");
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c"]);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
  assert.equal(git(["branch", "develop"]).status, 0, "git branch develop failed");
  return dir;
}

function addWorktree(repoDir, wtDir, branch) {
  const git = (args) => spawnSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });
  const r = git(["worktree", "add", wtDir, "-b", branch]);
  assert.equal(r.status, 0, `worktree add ${branch} failed: ${r.stderr}`);
}

function removeWorktrees(repoDir, wtDirs) {
  const git = (args) => spawnSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });
  for (const d of wtDirs) {
    git(["worktree", "remove", "--force", d]);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

// A transcript fixture that the classifier reads as `saturated` (high cache_read + unanswered user
// input), same shape as the existing stage-4 fixtures. backdate 1 min so FRESH_SECS' MARKER-STALE
// cross-positive-control does not fire (that is an unrelated existing event).
function saturatedTranscript(p, name) {
  const f = path.join(p.tmp, `${name}.jsonl`);
  writeTranscript(f, [assistantUsageRecord(isoAgo(0.1), 600000), userInputRecord(isoAgo(0.05))], 1);
  return f;
}

// ── AC1/AC4 positive — all three hold ⇒ emit, exactly once per disabled spell ────────────────────

test("AC1/AC4 — SESSION-DISABLED fires when 饱和 && develop 静默 ≥T && 在飞 worktree 集合无变化 && 无活进程 (all four hold); exactly one emission per spell (edge-trigger)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-a");
  const repo = path.join(p.tmp, "repo");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent ≥ default T=10
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-a ${repo} ${p.session}`, { transcripts: `scd-a ${satX}` });
    try {
      // Round 1 has no worktree baseline → hold; round 2 (stable empty change) → emit.
      assert.ok(await waitForOutput(mon, /SESSION-DISABLED scd-a/, 10000),
        `AC1: all-three composite MUST fire SESSION-DISABLED:\n${mon.output()}`);
      // AC3: the event states the disabled assertion (失能), not merely 饱和.
      assert.ok(/失能|disabled/.test(mon.output()),
        `SESSION-DISABLED must state the disabled assertion:\n${mon.output()}`);
      // AC4 edge: exactly one emission; keep running ≥3 more rounds and confirm no re-emit.
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must keep running ≥3 rounds for the no-re-emit check:\n${mon.output()}`);
      const emits = (mon.output().match(/SESSION-DISABLED scd-a/g) || []).length;
      assert.equal(emits, 1,
        `AC4: exactly one SESSION-DISABLED per disabled spell, got ${emits}:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

// ── AC3 negative — 饱和但 develop 活跃 ⇒ 不发 ─────────────────────────────────────────────────────

test("AC3 负控制 — 饱和但 develop 活跃 ⇒ 不发 (saturated but develop has a fresh commit < T)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-b");
  const repo = path.join(p.tmp, "repo");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 0 });    // develop commit NOW → active (age < T)
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-b ${repo} ${p.session}`, { transcripts: `scd-b ${satX}` });
    try {
      // ≥4 rounds: were the silence sub-condition wrongly passing, the edge would fire by round 2.
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-b/.test(mon.output()),
        `saturated-but-develop-active MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

// ── AC3 negative — 饱和且静默但在飞变 ⇒ 不发 ─────────────────────────────────────────────────────

test("AC3 负控制 — 饱和且静默但在飞变 ⇒ 不发 (in-flight worktree set changes every round)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-c");
  const repo = path.join(p.tmp, "repo");
  const wt1 = path.join(p.tmp, "wt1");
  const wt2 = path.join(p.tmp, "wt2");
  const wt3 = path.join(p.tmp, "wt3");
  const wt4 = path.join(p.tmp, "wt4");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    addWorktree(repo, wt1, "wt-1");                    // in-flight set is non-empty at mount
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // INTERVAL=2 so each waitForRounds leaves a ≥2s window to add the next worktree before the
    // next round reads the set — the set CHANGES every round, so sub-condition ③ must stay false.
    const mon = spawnMonitor(p.env, `scd-c ${repo} ${p.session}`,
      { transcripts: `scd-c ${satX}`, interval: 2 });
    try {
      assert.ok(await waitForRounds(mon, 1, HANG_GUARD_MS), `round 1 must complete:\n${mon.output()}`);
      addWorktree(repo, wt2, "wt-2");
      assert.ok(await waitForRounds(mon, 2, HANG_GUARD_MS), `round 2 must complete:\n${mon.output()}`);
      addWorktree(repo, wt3, "wt-3");
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS), `round 3 must complete:\n${mon.output()}`);
      addWorktree(repo, wt4, "wt-4");
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS), `round 4 must complete:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-c/.test(mon.output()),
        `saturated+silent but in-flight set changing MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
      removeWorktrees(repo, [wt1, wt2, wt3, wt4]);
    }
  } finally {
    p.cleanup();
  }
});

// ── AC1 negative — 不满足不发（不饱和）────────────────────────────────────────────────────────────

test("AC1 负控制 — 不饱和 ⇒ 不发 (unsaturated, even with silent develop + stable worktrees)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-d");
  const repo = path.join(p.tmp, "repo");
  const unsatX = path.join(p.tmp, "unsat.jsonl");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    writeTranscript(unsatX, [assistantUsageRecord(isoAgo(0.1), 1000), userInputRecord(isoAgo(0.05))], 1); // low cache → unsaturated
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-d ${repo} ${p.session}`, { transcripts: `scd-d ${unsatX}` });
    try {
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-d/.test(mon.output()),
        `unsaturated MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

// ── AC2 — SATURATION_SILENCE_MIN is env-configurable (not a hardcoded literal) and gates emission ─

test("AC2 — SATURATION_SILENCE_MIN is env-configurable (default not the forbidden literal 30) and actually gates the composite", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // static: the script reads the env var with a default (same form as SATURATION_TOKENS), and the
  // default is NOT the forbidden literal 30.
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /SATURATION_SILENCE_MIN=\$\{SATURATION_SILENCE_MIN:-[0-9]+\}/,
    "SATURATION_SILENCE_MIN must be env-configurable with a numeric default (same form as SATURATION_TOKENS)");
  assert.ok(!/SATURATION_SILENCE_MIN=\$\{SATURATION_SILENCE_MIN:-30\}/.test(src),
    "the default must NOT be the forbidden literal 30");

  // runtime: a develop commit 2 min old is SILENT under T=1 (emits) but ACTIVE under T=100 (does not).
  const p = makeHermeticProbe("ol-scd-e");
  const repo = path.join(p.tmp, "repo");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 2 });    // develop 2 min old
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // (a) T=1: 2min ≥ 1 ⇒ silent ⇒ all three hold ⇒ emit.
    const mon1 = spawnMonitor({ ...p.env, SATURATION_SILENCE_MIN: "1" },
      `scd-e1 ${repo} ${p.session}`, { transcripts: `scd-e1 ${satX}` });
    try {
      assert.ok(await waitForOutput(mon1, /SESSION-DISABLED scd-e1/, 10000),
        `T=1 with a 2min-old develop MUST emit:\n${mon1.output()}`);
    } finally {
      mon1.child.kill("SIGKILL"); mon1.cleanup();
    }
    // (b) T=100: 2min < 100 ⇒ active ⇒ hold (the config value actually gates, not a literal).
    const mon2 = spawnMonitor({ ...p.env, SATURATION_SILENCE_MIN: "100" },
      `scd-e2 ${repo} ${p.session}`, { transcripts: `scd-e2 ${satX}` });
    try {
      assert.ok(await waitForRounds(mon2, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon2.output()}`);
      assert.ok(!/SESSION-DISABLED scd-e2/.test(mon2.output()),
        `T=100 with a 2min-old develop MUST NOT emit (config gates the composite):\n${mon2.output()}`);
    } finally {
      mon2.child.kill("SIGKILL"); mon2.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

// ── 新④ 合取项能取假（gap-session-disabled-fires-when-busy，AC1/判据2）─────────────────────────────
// 忙时必假直接量 = 在飞【链接】worktree 内有活进程（/proc/<pid>/cwd 解析）。本测试证明它【能取假】：
// 同一稳定场景（饱和 + develop 静默 + 在飞集合无变化）下，worktree 有活进程 ⇒ 不报 DISABLED；活进程
// 消失（真失能）⇒ 报。没有该合取项时这个场景本来就该报——故「不报」只能归因于新合取项取假（硬规则 4：
// 恒真合取项贡献零）。

test("新④ 能取假 — 忙时 worktree 有活进程 ⇒ 不报 DISABLED；活进程消失（真失能）⇒ 报 (conjunct can take false)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-g");
  const repo = path.join(p.tmp, "repo");
  const wt = path.join(p.tmp, "wt1");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    addWorktree(repo, wt, "wt-1");                     // stable in-flight linked worktree
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-g ${repo} ${p.session}`, { transcripts: `scd-g ${satX}` });
    const live = spawn("sleep", ["10000"], { cwd: wt, stdio: "ignore" });
    try {
      // busy phase: a live process with cwd inside the linked worktree → ④ takes false → hold.
      // Round 1 has no worktree baseline (③=0); by round 2 ③=1 && ① && ② all hold — WITHOUT ④ the
      // old composite would already emit, so "no emit" is attributable to ④ being false (busy).
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must complete busy-phase rounds:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-g/.test(mon.output()),
        `busy (live process in linked worktree) MUST NOT emit SESSION-DISABLED — ④ is false:\n${mon.output()}`);
      // true-disabled phase: the worktree process dies → ④ flips true → the composite emits.
      live.kill("SIGKILL");
      assert.ok(await waitForOutput(mon, /SESSION-DISABLED scd-g/, 10000),
        `after the worktree process dies (no longer busy) the disabled composite MUST emit — ④ can take true:\n${mon.output()}`);
    } finally {
      live.kill("SIGKILL");
      mon.child.kill("SIGKILL"); mon.cleanup();
      removeWorktrees(repo, [wt]);
    }
  } finally {
    p.cleanup();
  }
});

// ── AC3 负控制 — 多任务实现中不报（manager 12:16Z replay，gap-session-disabled-fires-when-busy）─────
// 真样本：5 个 worktree 在飞、主会话 mtime 0 分钟前（最忙时误报 DISABLED）。回放：5 个稳定链接
// worktree + 其中挂活进程 = 多任务实现中。饱和 + develop 静默 + 在飞集合稳定 ⇒ 旧三合取会响；
// 新合取项 ④ 在忙时取假 ⇒ 不响。

test("AC3 负控制 — 多任务实现中不报 (manager 12:16Z: 5 worktrees 在飞 + 忙活进程，replay)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-f");
  const repo = path.join(p.tmp, "repo");
  const wts = [1, 2, 3, 4, 5].map((i) => path.join(p.tmp, `wt${i}`));
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    for (const [i, wt] of wts.entries()) addWorktree(repo, wt, `wt-${i + 1}`);  // 5 in-flight, STABLE
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-f ${repo} ${p.session}`, { transcripts: `scd-f ${satX}` });
    const live = spawn("sleep", ["10000"], { cwd: wts[0], stdio: "ignore" });
    try {
      // Round 1 has no baseline (③=0); by round 2 ① && ② && ③ all hold — the OLD composite would
      // emit here; only ④ (busy, live process in wt1) holds it. Run ≥4 rounds to be load-robust.
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-f/.test(mon.output()),
        `multi-task implementation in progress (5 stable worktrees + live process) MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      live.kill("SIGKILL");
      mon.child.kill("SIGKILL"); mon.cleanup();
      removeWorktrees(repo, wts);
    }
  } finally {
    p.cleanup();
  }
});
