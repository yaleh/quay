// @test-group governance
// outer-liveness.test.mjs — automated positive controls for the cross-project outer-liveness
// monitor (plugin/scripts/outer-liveness.sh). The manager (quay-0:manager) built and verified it
// MANUALLY; this file turns those manual controls into tests, per rule 2 of
// orchestration/TOOLS-SESSION-HANDOFF.md: "干跑没有输出不是证据" — every criterion needs a
// known-triggering setup that demonstrably fires, because "no output" is indistinguishable from
// "it never reports".
//
// The monitor reports five event families:
//   OUTER-GONE/OUTER-BACK   the outer process vanished / returned
//   OUTER-STALL             alive but ≥STALL_MIN min with no new commit (not halted)
//   OUTER-LOOP-OVERDUE      tick-log mtime ≥OVERDUE_MIN (not halted) — loop may be dead
//   OUTER-IDLE/OUTER-RESUMED  adjacent rounds' pane hash equal = idle; reported within one
//                             polling interval of the transition
//
// How each criterion gets a POSITIVE control, and why that shape:
//   A. OUTER-IDLE/OUTER-RESUMED — the busy criterion is REDRAW-based: a busy Claude Code TUI
//      repaints a second-level elapsed timer, so the pane hash changes between rounds; an idle
//      pane is byte-stable. A fake probe whose cmdline merely contains "claude" passes outer_pid's
//      cmdline check but CANNOT redraw, so it can never produce the changing hash that IS the busy
//      signal. The manager's first positive control fell for exactly this (a /tmp/claude-probe bash
//      script); the fix is to drive a REAL Claude Code session — quay-0:probe (deepseek-v4-flash,
//      cwd /tmp, dedicated to this test, see TOOLS-SESSION-HANDOFF.md). Test A drives it: idle
//      baseline → a task that runs tens of seconds (`sleep 20` — flash answers light questions in
//      ~5s, so a short window would be missed by sparse sampling) → OUTER-RESUMED → back to idle →
//      OUTER-IDLE. Skips when the probe session is absent (CI / other machines).
//   B. OUTER-GONE/OUTER-BACK — pure process detection (outer_pid: first child of the pane shell
//      whose /proc/<pid>/cmdline contains "claude"). NOT redraw-dependent, so it runs hermetically
//      on an ISOLATED tmux socket with a real `sleep` whose argv[0] is "claude-probe" as the
//      claude-cmdline stand-in — no fake TUI involved, and it never touches the real projects.
//   C. OUTER-STALL — alive + a git repo whose HEAD committer date is ≥STALL_MIN minutes old, not
//      halted. Hermetic: isolated-socket stand-in + a temp repo with a backdated commit.
//   D. OUTER-LOOP-OVERDUE — alive + tick-log mtime ≥OVERDUE_MIN, not halted. Hermetic: isolated
//      stand-in + a temp tick file with an old mtime, via the OUTER_TICK_LOGS override (the
//      script's tick_log_for is hardcoded to the three real project paths, so it is not testable
//      without this override — the same reason OUTER_TARGETS exists).
//   E. halt-gating — STALL/OVERDUE are suppressed when <root>/.halt exists (a halted project not
//      advancing is expected); GONE is NOT suppressed. Hermetic.
//
// Process hygiene (handoff rules 2b/3): no pipelines feeding `$?`; no `pgrep -f` anywhere — the
// probe is found via /proc/<pid>/cmdline argv position exactly as outer_pid() does it. Every
// mkdtemp tmpdir is removed in a finally (test-isolation R6). Every hermetic tmux server lives on
// its own socket (TMUX_TMPDIR) so the real quay-0/archguard-2/meta-cc-4 sessions are untouchable.
//
// Run:
//   scripts/test.sh plugin/test/outer-liveness.test.mjs
//   node --test plugin/test/outer-liveness.test.mjs
//   scripts/test.sh --group governance plugin/test/outer-liveness.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "outer-liveness.sh");
const PROBE_TARGET = "quay-0:probe"; // the manager's real, dedicated probe session

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

function md5(s) {
  return createHash("md5").update(s).digest("hex").slice(0, 16);
}

function tmux(args, env) {
  const r = spawnSync("tmux", args, { encoding: "utf8", env: env ?? process.env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// isolateTmuxEnv: point bare `tmux` at a PRIVATE server socket, so the monitor and the probe
// setup can never resolve to the real quay-0 / archguard-2 / meta-cc-4 sessions.
function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  return env;
}

// paneHasClaudeChild — replicate outer_pid(): the first child of the pane shell whose
// /proc/<pid>/cmdline contains "claude". NOT `pgrep -f` (handoff rule 3: it would match this
// very command).
function paneHasClaudeChild(env, session) {
  const p = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env);
  if (p.status !== 0 || !p.stdout.trim()) return false;
  const kids = spawnSync("pgrep", ["-P", p.stdout.trim()], { encoding: "utf8" });
  const first = (kids.stdout ?? "").trim().split("\n").filter(Boolean)[0];
  if (!first) return false;
  try {
    // read /proc/<pid>/cmdline directly and collapse the NUL argv separators to spaces — never
    // pass a NUL through spawnSync argv (execve rejects it).
    const cmd = fs.readFileSync(`/proc/${first}/cmdline`, "utf8").replace(/\0/g, " ");
    return cmd.includes("claude");
  } catch {
    return false;
  }
}

async function waitForAlive(env, session, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paneHasClaudeChild(env, session)) return true;
    await sleep(100);
  }
  return paneHasClaudeChild(env, session);
}

// makeHermeticProbe(session) — a private tmux server + a pane whose shell owns a claude-cmdline
// child: a real `sleep` process with argv[0]="claude-probe", i.e. /proc cmdline = "claude-probe
// 10000". This is a process-detection stand-in, NOT a fake TUI: GONE/BACK/STALL/OVERDUE do not
// depend on TUI redraw, so a real TUI is not needed for them (only the busy criterion in test A is
// redraw-based and uses the real session).
function makeHermeticProbe(session) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "outer-liveness-"));
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  tmux(["send-keys", "-t", session, "exec -a claude-probe sleep 10000 &"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
  return {
    tmp,
    env,
    session,
    cleanup() {
      tmux(["kill-session", "-t", session], env);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

// spawnMonitor — run the REAL outer-liveness.sh with a fast test interval and overridable targets.
function spawnMonitor(env, targets, { tickLogs, stallMin = 1, overdueMin = 1, interval = 1, loopMin } = {}) {
  const monEnv = {
    ...env,
    OUTER_TARGETS: targets,
    INTERVAL: String(interval),
    STALL_MIN: String(stallMin),
    OVERDUE_MIN: String(overdueMin),
  };
  if (tickLogs) monEnv.OUTER_TICK_LOGS = tickLogs;
  if (loopMin !== undefined) monEnv.LOOP_MIN = String(loopMin);
  const child = spawn("bash", [SCRIPT], { env: monEnv });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return { child, output: () => out };
}

async function waitForOutput(mon, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(mon.output())) return true;
    await sleep(200);
  }
  return pattern.test(mon.output());
}

// makeBackdatedGitRepo — a temp git repo whose HEAD committer date is 2000, so
// `git -C <root> log -1 --format=%ct` is huge and the ≥STALL_MIN-minute criterion trips.
function makeBackdatedGitRepo(dir) {
  const env = { ...process.env, GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd, env });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  const add = git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir);
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"], dir);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
  const ct = git(["log", "-1", "--format=%ct"], dir);
  assert.ok(ct.status === 0 && Number(ct.stdout.trim()) < 1000000000, `commit must be backdated, got ${ct.stdout}`);
}

// ── availability guards ───────────────────────────────────────────────────────────────────────────

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ── Test A: OUTER-IDLE / OUTER-RESUMED on the REAL probe session ──────────────────────────────────

const realProbeAvailable = (() => {
  if (!tmuxAvailable) return false;
  return paneHasClaudeChild(process.env, PROBE_TARGET);
})();

test("OUTER-RESUMED then OUTER-IDLE fire when the real probe session goes busy then idle", {
  skip: realProbeAvailable
    ? false
    : `real probe session ${PROBE_TARGET} is not present/alive — run this on the manager box (orchestration/TOOLS-SESSION-HANDOFF.md)`,
  timeout: 180000,
}, async () => {
  const env = process.env;
  const captureText = () => tmux(["capture-pane", "-p", "-t", PROBE_TARGET], env).stdout;
  // 3 consecutive identical captures = idle (3× beats the 1s-timer alignment hazard of 2×).
  const waitStableHash = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    const last3 = [];
    while (Date.now() < deadline) {
      const h = md5(captureText());
      last3.push(h);
      if (last3.length > 3) last3.shift();
      if (last3.length === 3 && last3.every((x) => x === last3[0])) return h;
      await sleep(1000);
    }
    return null;
  };

  // 0. the probe must be idle before we drive it (it may be mid-answer from a prior run).
  const baseline = await waitStableHash(30000);
  assert.ok(baseline !== null, `probe must reach a stable idle baseline before driving (never settled in 30s)`);

  // tickLogs pins the tick path to a nonexistent file so tmin="?" under the noise gate
  // (OUTER-IDLE reports when tmin is unknown) — otherwise tmin reads the REAL quay tick-log mtime
  // and the IDLE event could be gated silent if the manager's loop happened to tick recently.
  const mon = spawnMonitor(env, `probe /tmp ${PROBE_TARGET}`, { tickLogs: `probe /nonexistent` });
  try {
    // 1. let the monitor establish its own idle baseline (≥2 rounds: PREV_HASH + PREV_IDLE=1).
    await sleep(3500);

    // 2. drive the probe busy with a task that runs tens of seconds (flash answers a light
    //    question in ~5s — at INTERVAL=1 a short window could be missed entirely).
    tmux(["send-keys", "-t", PROBE_TARGET, "C-u"], env);
    tmux(["send-keys", "-t", PROBE_TARGET, "运行 sleep 20 这条命令，等它结束后说 done"], env);
    tmux(["send-keys", "-t", PROBE_TARGET, "Enter"], env);

    // 3. the idle→busy transition must surface as OUTER-RESUMED within a few rounds.
    const resumed = await waitForOutput(mon, /OUTER-RESUMED probe/, 20000);
    assert.ok(resumed, `OUTER-RESUMED must fire when the probe goes busy:\n${mon.output()}`);

    // 4. wait for the probe to come back idle (busy task done, answer rendered, prompt stable).
    const settled = await waitStableHash(50000);
    assert.ok(settled !== null, `probe must return to a stable idle state after the busy task`);

    // 5. the busy→idle transition must surface as OUTER-IDLE within a few rounds of settling.
    const idle = await waitForOutput(mon, /OUTER-IDLE probe/, 15000);
    assert.ok(idle, `OUTER-IDLE must fire when the probe returns idle:\n${mon.output()}`);

    // 6. ordering: the busy transition precedes the idle transition.
    const out = mon.output();
    const rIdx = out.indexOf("OUTER-RESUMED");
    const iIdx = out.indexOf("OUTER-IDLE");
    assert.ok(rIdx !== -1 && iIdx !== -1 && rIdx < iIdx, `OUTER-RESUMED must precede OUTER-IDLE:\n${out}`);
  } finally {
    mon.child.kill("SIGKILL");
    tmux(["send-keys", "-t", PROBE_TARGET, "C-u"], env); // leave the probe at a clean prompt
    await sleep(500);
  }
});

// ── Test B: OUTER-GONE / OUTER-BACK (hermetic) ─────────────────────────────────────────────────────

test("OUTER-GONE then OUTER-BACK fire when the probe's claude process vanishes and returns", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-gone");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe claude child must be alive before the monitor starts");
    const mon = spawnMonitor(p.env, `gone ${p.tmp} ${p.session}`, {});
    try {
      await sleep(2500); // ≥2 rounds: PREV_ALIVE=1 baseline
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env); // make it disappear
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /OUTER-GONE gone/, 6000), `OUTER-GONE must fire:\n${mon.output()}`);
      tmux(["send-keys", "-t", p.session, "exec -a claude-probe sleep 10000 &"], p.env); // bring it back
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /OUTER-BACK gone/, 6000), `OUTER-BACK must fire:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    }
  } finally {
    p.cleanup();
  }
});

// ── Test C: OUTER-STALL (hermetic) ─────────────────────────────────────────────────────────────────

test("OUTER-STALL fires when alive but the repo HEAD commit is ≥STALL_MIN old (not halted)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-stall");
  const gitRoot = path.join(p.tmp, "repo");
  try {
    fs.mkdirSync(gitRoot, { recursive: true });
    makeBackdatedGitRepo(gitRoot);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `stall ${gitRoot} ${p.session}`, { stallMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /OUTER-STALL stall/, 6000), `OUTER-STALL must fire:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    }
  } finally {
    p.cleanup();
  }
});

// ── Test D: OUTER-LOOP-OVERDUE (hermetic) ──────────────────────────────────────────────────────────

test("OUTER-LOOP-OVERDUE fires when the tick-log mtime is ≥OVERDUE_MIN old (not halted)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-overdue");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n");
    const old = spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.equal(old.status, 0, `touch -d failed: ${old.stderr}`);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `overdue ${p.tmp} ${p.session}`, { tickLogs: `overdue ${tick}`, overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /OUTER-LOOP-OVERDUE overdue/, 6000), `OUTER-LOOP-OVERDUE must fire:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    }
  } finally {
    p.cleanup();
  }
});

// ── Test E: .halt gating (hermetic) ────────────────────────────────────────────────────────────────

test(".halt suppresses OUTER-STALL and OUTER-LOOP-OVERDUE, but NOT OUTER-GONE", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-halt");
  const gitRoot = path.join(p.tmp, "repo");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.mkdirSync(gitRoot, { recursive: true });
    makeBackdatedGitRepo(gitRoot);
    fs.writeFileSync(path.join(gitRoot, ".halt"), ""); // halted: not advancing is expected
    fs.writeFileSync(tick, "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");

    const mon = spawnMonitor(p.env, `halted ${gitRoot} ${p.session}`, { tickLogs: `halted ${tick}`, stallMin: 1, overdueMin: 1 });
    try {
      await sleep(4000); // ≥3 rounds — STALL/OVERDUE would have fired by now if not gated
      const out = mon.output();
      assert.ok(!/OUTER-STALL/.test(out), `STALL must be suppressed for a halted project:\n${out}`);
      assert.ok(!/OUTER-LOOP-OVERDUE/.test(out), `OVERDUE must be suppressed for a halted project:\n${out}`);
      // the monitor is not globally silent: GONE still fires despite the halt.
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /OUTER-GONE halted/, 6000), `GONE must still fire when halted:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    }
  } finally {
    p.cleanup();
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 产品化（SPEC-outer-liveness-productization.md，AC1-AC9）与噪声标定（管理者 3 周期数据）
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// AC1  plugin 源副本无绝对路径/具体会话名（grep /home/yale|quay-0:|archguard-2:|meta-cc-4: 无命中）。
// AC2  quay-init --loop 用已有参数（--tmux-session）把会话占位符替换进铺出的副本；全文无 quay 字面。
// AC3  零配置可用：铺出的脚本不带参数直接跑，识别本项目自己的外层。
// AC5  四个阈值写进随包外层 tick 文档（不只活在脚本注释里）。
// AC6  目标项目没有 tick 日志时不崩（新项目第一次跑必然没有）——OVERDUE 静默、其余事件正常。
// AC7  冷启动 e2e 是实跑断言（--once 接缝），不只断言文件存在。
// AC9  管理者的三项目配置在 orchestration/outer-liveness.env，不进 plugin；脚本启动时 source 它。
// 噪声  OUTER-IDLE 在 tick 时距 < LOOP_MIN（刚记完 tick 的正常收尾）时静默；≥ LOOP_MIN 或未知才报。
//       OUTER-RESUMED 保留不静默（唯一正向信号）。两个正控制：旧 tick→报、新 tick→静默。

function makeTmp(prefix = "ol-prod-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function runInit(workspace, args, pluginRoot = path.resolve(__dirname, "..")) {
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

// busy-loop controls for a hermetic probe (claude child is job %1; the busy loop is job %2).
function startBusyLoop(env, session) {
  tmux(["send-keys", "-t", session, "while true; do date +%s.%N; sleep 0.2; done &"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
}
function stopBusyLoop(env, session) {
  tmux(["send-keys", "-t", session, "kill %2"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
}

async function waitForPaneStable(env, session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const last3 = [];
  while (Date.now() < deadline) {
    const h = md5(tmux(["capture-pane", "-p", "-t", session], env).stdout);
    last3.push(h);
    if (last3.length > 3) last3.shift();
    if (last3.length === 3 && last3.every((x) => x === last3[0])) return h;
    await sleep(1000);
  }
  return null;
}

// ── AC1: plugin source is clean ────────────────────────────────────────────────────────────────────

test("AC1 — plugin/scripts/outer-liveness.sh has no absolute paths or specific session names", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!/(\/home\/yale|quay-0:|archguard-2:|meta-cc-4:)/.test(src),
    "source must not reference /home/yale or the three projects' specific tmux sessions");
});

// ── AC2: quay-init lays it down with the target substituted ─────────────────────────────────────────

test("AC2 — quay-init --loop lays down outer-liveness.sh with the target session substituted and no quay literals", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ["--loop", "--root", ws, "--project", "myproj",
      "--test-command", "npm test", "--tmux-session", "myproj-0:0.0", "--repo-root", "/srv/target"]);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const laid = fs.readFileSync(path.join(ws, "plugin", "scripts", "outer-liveness.sh"), "utf8");
    assert.ok(!laid.includes("__QUAY_TMUX_SESSION__"), "the session placeholder must be substituted");
    assert.ok(laid.includes("myproj-0"), "the target session must appear (default target <session>:outer)");
    assert.ok(!laid.includes("/home/yale/work/quay"), "no quay dev-root leak");
    assert.ok(!laid.includes("scripts/test.sh"), "no quay test-command leak");
  } finally { cleanup(ws); }
});

// ── AC3/AC7: cold-start real run via the --once seam ───────────────────────────────────────────────

test("AC3/AC7 — the laid-down script, run --once, identifies THIS project's own outer (real run, not file-exists)", async () => {
  const ws = makeTmp();
  const sockDir = path.join(ws, "sock"); fs.mkdirSync(sockDir, { recursive: true });
  const env = { ...process.env, TMUX_TMPDIR: sockDir }; delete env.TMUX;
  try {
    const r = runInit(ws, ["--loop", "--root", ws, "--project", "proj",
      "--test-command", "node --test", "--tmux-session", "ol-cold:0.0"]);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // this project's own outer = <session>:outer window (the default-target convention).
    const ns = tmux(["new-session", "-d", "-s", "ol-cold", "-n", "outer", "bash"], env);
    assert.equal(ns.status, 0, `new-session failed: ${ns.stderr}`);
    tmux(["send-keys", "-t", "ol-cold:outer", "exec -a claude-probe sleep 10000 &"], env);
    tmux(["send-keys", "-t", "ol-cold:outer", "Enter"], env);
    assert.ok(await waitForAlive(env, "ol-cold", 5000), "this project's outer must be alive before the cold-start run");
    const once = spawnSync("bash", [path.join(ws, "plugin", "scripts", "outer-liveness.sh"), "--once"], {
      encoding: "utf8", env: { ...env, OUTER_ROOT: ws },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.ok(once.stdout.includes("OUTER-STATUS") && once.stdout.includes("alive=1"),
      `must identify this project's own outer as alive:\n${once.stdout}`);
  } finally {
    tmux(["kill-session", "-t", "ol-cold"], env);
    cleanup(ws);
  }
});

// ── AC6: no tick log must not crash, OVERDUE silent, other events fine ─────────────────────────────

test("AC6 — no tick log: OUTER-LOOP-OVERDUE stays silent, other events work, no crash", async () => {
  const p = makeHermeticProbe("ol-notick");
  try {
    const mon = spawnMonitor(p.env, `notick ${p.tmp} ${p.session}`,
      { tickLogs: `notick ${path.join(p.tmp, "nope.md")}`, overdueMin: 1 });
    try {
      await sleep(4000);
      assert.ok(!/OUTER-LOOP-OVERDUE/.test(mon.output()), `OVERDUE must be silent without a tick log:\n${mon.output()}`);
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /OUTER-GONE notick/, 6000), `GONE must still fire:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    }
  } finally {
    p.cleanup();
  }
});

// ── AC9: manager config lives in orchestration/outer-liveness.env, sourced at startup ───────────────

test("AC9 — manager's 3-project config lives in orchestration/outer-liveness.env, not the script; it is sourced when OUTER_TARGETS is unset", async () => {
  const realEnv = fs.readFileSync(path.resolve(__dirname, "..", "..", "orchestration", "outer-liveness.env"), "utf8");
  assert.ok(realEnv.includes("OUTER_TARGETS="), "orchestration/outer-liveness.env must carry OUTER_TARGETS");
  assert.ok(realEnv.includes("quay-0:outer") && realEnv.includes("archguard-2:outer") && realEnv.includes("meta-cc-4:outer"),
    "the env file must carry the three-project topology");
  assert.ok(!fs.readFileSync(SCRIPT, "utf8").includes("quay-0:"), "the script must NOT carry the topology (moved out to orchestration/)");

  const ws = makeTmp();
  const sockDir = path.join(ws, "sock"); fs.mkdirSync(sockDir, { recursive: true });
  const env = { ...process.env, TMUX_TMPDIR: sockDir }; delete env.TMUX;
  try {
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    const ns = tmux(["new-session", "-d", "-s", "ol-env", "-n", "outer", "bash"], env);
    assert.equal(ns.status, 0, `new-session failed: ${ns.stderr}`);
    tmux(["send-keys", "-t", "ol-env:outer", "exec -a claude-probe sleep 10000 &"], env);
    tmux(["send-keys", "-t", "ol-env:outer", "Enter"], env);
    assert.ok(await waitForAlive(env, "ol-env", 5000), "the env-file target outer must be alive before the run");
    fs.writeFileSync(path.join(ws, "orchestration", "outer-liveness.env"),
      `OUTER_TARGETS="envproj ${ws} ol-env:outer"\n`, "utf8");
    const once = spawnSync("bash", [SCRIPT, "--once"], { encoding: "utf8", env: { ...env, OUTER_ROOT: ws } });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stdout, /OUTER-STATUS envproj alive=1/, `must source the env-file targets:\n${once.stdout}`);
  } finally {
    tmux(["kill-session", "-t", "ol-env"], env);
    cleanup(ws);
  }
});

// ── AC5: thresholds documented in the shipped outer tick doc ────────────────────────────────────────

test("AC5 — the shipped outer tick doc documents the four thresholds", () => {
  const doc = fs.readFileSync(path.resolve(__dirname, "..", "loop", "orchestrator-loop-tick.md"), "utf8");
  for (const t of ["INTERVAL", "STALL_MIN", "LOOP_MIN", "OVERDUE_MIN"]) {
    assert.ok(doc.includes(t), `the outer tick doc must document ${t} (AC5: a parameter only its author can tune is not a parameter)`);
  }
});

// ── 噪声标定（管理者 3 周期数据）：OUTER-IDLE 静默/报出的两个正控制 ─────────────────────────────────

test("noise gate — an idle transition with an OLD tick log IS reported (idle but no tick = anomaly)", async () => {
  const p = makeHermeticProbe("ol-gate-old");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `gate ${p.tmp} ${p.session}`, { tickLogs: `gate ${tick}`, interval: 1, loopMin: 5 });
    try {
      await sleep(2500); // idle baseline: PREV_IDLE=1
      startBusyLoop(p.env, p.session);
      assert.ok(await waitForOutput(mon, /OUTER-RESUMED gate/, 8000), `RESUMED must fire on busy:\n${mon.output()}`);
      stopBusyLoop(p.env, p.session);
      const stable = await waitForPaneStable(p.env, p.session, 15000);
      assert.ok(stable !== null, "pane must return to a stable idle state");
      assert.ok(await waitForOutput(mon, /OUTER-IDLE gate/, 10000),
        `IDLE must fire when the tick is stale (idle but no tick):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    }
  } finally {
    p.cleanup();
  }
});

test("noise gate — an idle transition with a FRESH tick log is SILENT (healthy cycle end)", async () => {
  const p = makeHermeticProbe("ol-gate-fresh");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n"); // mtime = now → tmin ≈ 0, well under LOOP_MIN=5
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `gate ${p.tmp} ${p.session}`, { tickLogs: `gate ${tick}`, interval: 1, loopMin: 5 });
    try {
      await sleep(2500); // idle baseline: PREV_IDLE=1
      startBusyLoop(p.env, p.session);
      assert.ok(await waitForOutput(mon, /OUTER-RESUMED gate/, 8000), `RESUMED must fire on busy (monitor is tracking):\n${mon.output()}`);
      stopBusyLoop(p.env, p.session);
      const stable = await waitForPaneStable(p.env, p.session, 15000);
      assert.ok(stable !== null, "pane must return to a stable idle state");
      await sleep(3500); // ≥3 rounds after stability — IDLE would have fired by now if not gated
      assert.ok(!/OUTER-IDLE/.test(mon.output()),
        `IDLE must be SILENT when the tick is fresh (healthy cycle end, noise gate):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    }
  } finally {
    p.cleanup();
  }
});
