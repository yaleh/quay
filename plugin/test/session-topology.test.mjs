// @test-group lowconc
// GROUP NOTE (gap-serial-group-recompose-nested-runner-criterion): routed to `lowconc`, NOT `serial`.
// The serial group's ONLY criterion is nested-runner (a file that spawns its own worker-pool
// sub-suites via `node --test` / test.sh --for-task). This file made itself concurrency-safe — 9
// hermetic tmux signals (private socket via TMUX_TMPDIR + explicit -S argv), kill-session never
// kill-server — but had stayed serial: the isolation work was done, the grouping didn't follow. It
// does NOT spawn its own worker-pool sub-suite, so it belongs in lowconc (hermetic-but-load-
// sensitive), not serial.
// session-topology.test.mjs — gap-tmux-session-topology-no-factory-definition, AC1–AC5;
// two-window correction pinned by gap-manager-baked-into-project-topology-factory (manager is
// CROSS-PROJECT, NOT part of a project's topology).
//
// The two-window tmux session topology (<project>-N:outer / :inner) used to be a convention with
// no factory definition — the human hand-built meta-cc-3 / archguard-4 sessions measured to have
// ONLY a single bash window and no claude process. This test pins the shipped factory definition
// + the mechanisms that make cold start build the topology by definition:
//
//   AC1 — the definition ships in plugin/skills/session-topology/SKILL.md (invariant
//         project_topology_has_no_manager=1; invoke `grep -rn ':outer\|:inner' plugin/skills/`),
//         names both windows (Contract measure topology_windows >= 2), documents each layer's
//         launch command / who drives whom / what each layer mounts, and states manager is
//         cross-project (NOT a topology window — :manager is absent from the definition).
//   AC2 — quay-init --loop lays down the factory (quay-topology.sh) + check (topology-check.sh)
//         into a target project, byte-identical to the plugin source (config-driven install).
//   AC3 — topology-check.sh: two windows each with a claude process ⇒ ok:true (exit 0); a
//         single bash window (the meta-cc-3/archguard-4 failure shape) ⇒ both missing (exit
//         non-zero); a topology window that is a bare bash ⇒ no-claude (exit non-zero).
//   AC4 — cold-start/SKILL.md cross-annotates the session topology (TOPOLOGY-IN-PLACE key + the
//         factory/check references) — SKILL teaches the loop start, this task teaches the session
//         topology; together they are 装得上.
//   AC5 — this file is node:test + // @test-group lowconc (hermetic → lowconc, see GROUP NOTE).
// Plus: the factory's --dry-run emits the two-window plan; a real build creates the windows.
//
// All tmux work is on a HERMETIC server on a private socket (TMUX_TMPDIR + explicit -S argv),
// never the machine's real sessions. Cleanup kills each session it started (kill-session, never
// kill-server — gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
//
// Run:
//   scripts/test.sh plugin/test/session-topology.test.mjs
//   node --test plugin/test/session-topology.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// STAGE 1/3 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): the hermetic helper
// already stripped $TMUX + carried an explicit -S; route it through the tmux-session library so
// BOTH conditions are structural. The sockPath === null form stays a bare spawn (scoped
// kill-session of factory sessions on the default socket — never new-session/kill-server).
import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const TOPOLOGY_DEF = path.join(pluginDir, "skills", "session-topology", "SKILL.md");
const FACTORY = path.join(pluginDir, "scripts", "quay-topology.sh");
const CHECK = path.join(pluginDir, "scripts", "topology-check.sh");
const COLD_START = path.join(pluginDir, "skills", "cold-start", "SKILL.md");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

function makeTmp(prefix = "quay-topo-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A worktree root quay-init's validation ACCEPTS (a real disk path, not tmpfs — the sibling
// default of a /tmp test workspace is tmpfs and is correctly rejected fail-closed).
function diskWorktreeRoot() {
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") {
        return path.join(base, `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
      }
    } catch { /* try next base */ }
  }
  return path.join(os.tmpdir(), `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

function runInit(workspace, args = []) {
  const loop = args.includes("--loop");
  const extra = loop && !args.some((a) => a === "--worktree-root") ? ["--worktree-root", diskWorktreeRoot()] : [];
  return spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh"), ...extra, ...args],
    { cwd: workspace, encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir } });
}

// ── hermetic tmux (private socket; kill-session per created session, never kill-server) ─────────────
function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  return env;
}
function tmuxAt(sockPath, args, env) {
  if (sockPath) {
    return isolatedTmux(args, { socket: sockPath, env: env ?? process.env });
  }
  const r = spawnSync("tmux", args, { encoding: "utf8", env: env ?? process.env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function newHermetic(prefix = "quay-topo-") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sockDir = path.join(tmp, "sock");
  const socketBase = path.join(sockDir, `tmux-${process.getuid()}`);
  fs.mkdirSync(socketBase, { recursive: true, mode: 0o700 }); // tmux refuses a world-accessible socket dir
  const sockPath = path.join(socketBase, "default");
  const env = isolateTmuxEnv(sockDir);
  const started = new Set();
  return {
    tmp, sockDir, sockPath, env, started,
    newSession(name, cmd) {
      const r = tmuxAt(sockPath, ["new-session", "-d", "-s", name, cmd], env);
      if (r.status === 0) started.add(name);
      return r;
    },
    newWindow(sess, name, cmd) {
      return tmuxAt(sockPath, ["new-window", "-t", sess, "-n", name, cmd], env);
    },
    send(sess, text) {
      return tmuxAt(sockPath, ["send-keys", "-t", sess, text, "Enter"], env);
    },
    windowNames(sess) {
      const r = tmuxAt(sockPath, ["list-windows", "-t", sess, "-F", "#{window_name}"], env);
      return r.stdout.trim().split("\n").filter(Boolean);
    },
    cleanup() {
      // Kill EVERY session on this hermetic socket — not just the `started` set. Factory scripts
      // (quay-topology.sh --session topo-factory/topo-idem/…) invoked with the hermetic env create
      // sessions DIRECTLY on this socket, invisible to `started`; leaving them orphaned leaks the
      // server (删目录 ≠ 杀进程 — gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
      // The socket is private to this test (mkdtemp'd, isolated TMUX_TMPDIR + explicit -S), so
      // sweeping it cannot touch real sessions; per-session kill-session (never kill-server).
      const ls = tmuxAt(sockPath, ["list-sessions", "-F", "#{session_name}"], env);
      if (ls.status === 0 && ls.stdout.trim()) {
        for (const name of ls.stdout.trim().split("\n").filter(Boolean)) {
          tmuxAt(sockPath, ["kill-session", "-t", name], env);
        }
      }
      for (const name of started) {
        tmuxAt(sockPath, ["kill-session", "-t", name], env);
      }
      // TMUX_TMPDIR is NOT honored by tmux on this system (verified: a session spawned with
      // TMUX_TMPDIR set still lands on /tmp/tmux-<uid>/default), so the factory scripts
      // (quay-topology.sh --session topo-factory/topo-race/isc-factory) build on the DEFAULT
      // socket — the hermetic sweep above cannot reach them. Kill the named factory sessions
      // on the default socket explicitly (per-session kill-session, never kill-server). Scoped
      // to the factory names this file creates so a real user session is never touched.
      for (const fname of ["topo-factory", "topo-idem", "topo-race", "isc-factory"]) {
        tmuxAt(null, ["kill-session", "-t", fname], process.env);
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

// paneHasClaude — replicate the scripts' has_claude_child: any child of the pane shell whose
// /proc/<pid>/cmdline contains "claude" (the test plants `exec -a claude-probe sleep` children).
function paneHasClaude(env, session) {
  const p = spawnSync("tmux", ["list-panes", "-t", session, "-F", "#{pane_pid}"], { encoding: "utf8", env });
  if (p.status !== 0 || !p.stdout.trim()) return false;
  const ppid = p.stdout.trim().split("\n")[0];
  const kids = spawnSync("pgrep", ["-P", ppid], { encoding: "utf8" });
  for (const pid of (kids.stdout ?? "").trim().split("\n").filter(Boolean)) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
      if (cmd.includes("claude")) return true;
    } catch { /* best-effort */ }
  }
  return false;
}
async function waitForClaude(env, session, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paneHasClaude(env, session)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return paneHasClaude(env, session);
}

function runCheck(env, args = []) {
  return spawnSync("bash", [CHECK, ...args], { encoding: "utf8", env });
}

// ── AC1 — the factory definition ships in plugin/skills/ ───────────────────────────────────────────

test("AC1 — the two-window topology definition ships in plugin/skills/ (invariant project_topology_has_no_manager=1)", () => {
  assert.ok(fs.existsSync(TOPOLOGY_DEF), "plugin/skills/session-topology/SKILL.md must exist — the shipped definition, not quay-local");
  const src = fs.readFileSync(TOPOLOGY_DEF, "utf8");
  // Contract measure: topology_windows = grep -c 'outer\|inner' <定义文件> ≥ 2
  const count = (src.match(/outer|inner/g) || []).length;
  assert.ok(count >= 2, `definition must name outer/inner at least 2 times (got ${count})`);
  // Contract invoke: `grep -rn ':outer\|:inner' plugin/skills/` must hit the definition
  for (const w of [":outer", ":inner"]) {
    assert.ok(src.includes(w), `definition must use the ${w} window-addressing convention`);
  }
  // Invariant project_topology_has_no_manager: manager is CROSS-PROJECT, not a topology window.
  assert.ok(/cross-project|跨项目/i.test(src), "the definition must state manager is cross-project, not part of the project topology");
  assert.ok(!src.includes(":manager"), "the definition must NOT address a :manager topology window (manager is not part of project topology)");
});

test("AC1 — the definition documents each layer's command, who drives whom, and what each layer mounts", () => {
  const src = fs.readFileSync(TOPOLOGY_DEF, "utf8");
  // each layer's launch command comes from the checked-in launcher (not a hand-typed one-liner)
  assert.match(src, /quay-launch\.sh/, "each layer's launch command must reference quay-launch.sh (settings-crystallized)");
  assert.match(src, /launch\.settings\.json/, "the launch command source must be the checked-in settings file");
  // who drives whom: outer drives inner via send-keys
  assert.match(src, /send-keys/, "the definition must state that outer drives inner via send-keys");
  // what each layer mounts: monitor / cron for outer, work product for inner
  assert.match(src, /monitor|cron/i, "the definition must state what each layer mounts");
});

// ── AC2 — quay-init lays down the topology factory + check ─────────────────────────────────────────

test("AC2 — quay-init --loop lays down the topology factory + check, byte-identical to the plugin", () => {
  const ws = makeTmp();
  try {
    fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "scripts", "test.sh"), "#!/bin/bash\necho test\n", "utf8");
    const r = runInit(ws, ["--loop", "--root", ws, "--project", "topoproj",
      "--test-command", "node --test", "--tmux-session", "topoproj-0"]);
    assert.equal(r.status, 0, `quay-init --loop must exit 0:\n${r.stderr}`);
    for (const rel of ["plugin/scripts/quay-topology.sh", "plugin/scripts/topology-check.sh", "plugin/scripts/quay-launch.sh"]) {
      const laid = path.join(ws, rel);
      assert.ok(fs.existsSync(laid), `quay-init must lay down ${rel}`);
      const src = path.join(pluginDir, "scripts", path.basename(rel));
      assert.equal(fs.readFileSync(laid, "utf8"), fs.readFileSync(src, "utf8"),
        `${rel} must be byte-identical to the plugin source (config-driven install)`);
    }
  } finally { cleanup(ws); }
});

// ── AC3 — topology-check verification (positive / negative / mixed controls) ───────────────────────

test("AC3 — positive control: two windows each with a claude process ⇒ ok:true, exit 0", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    h.newSession("topo-pos", "bash");
    for (const role of ["outer", "inner"]) {
      h.newWindow("topo-pos", role, "bash");
      h.send(`topo-pos:${role}`, "exec -a claude-probe sleep 10000 &");
    }
    for (const role of ["outer", "inner"]) {
      assert.ok(await waitForClaude(h.env, `topo-pos:${role}`, 5000), `${role} must have a claude child before the check`);
    }
    const r = runCheck(h.env, ["--session", "topo-pos", "--json"]);
    assert.equal(r.status, 0, `two-window topology in place must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true, `must report ok:true:\n${r.stdout}`);
    assert.deepEqual(j.windows, { outer: "ok", inner: "ok" });
  } finally { h.cleanup(); }
});

test("AC3 — negative control: a single bash window (no claude) ⇒ both topology windows missing, exit non-zero (the meta-cc-3/archguard-4 failure shape)", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  try {
    h.newSession("topo-neg", "bash"); // only a bare bash window — no outer/inner
    const r = runCheck(h.env, ["--session", "topo-neg", "--json"]);
    assert.notEqual(r.status, 0, "a single-bash-window session must fail the check");
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.deepEqual(j.windows, { outer: "missing", inner: "missing" });
  } finally { h.cleanup(); }
});

test("AC3 — mixed: a topology window that is a bare bash (no claude) ⇒ no-claude, exit non-zero", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    h.newSession("topo-mix", "bash");
    h.newWindow("topo-mix", "outer", "bash"); // bare bash, no claude child
    h.newWindow("topo-mix", "inner", "bash");
    h.send("topo-mix:inner", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "topo-mix:inner", 5000), "inner must be alive");
    const r = runCheck(h.env, ["--session", "topo-mix", "--json"]);
    assert.notEqual(r.status, 0, "an incomplete topology must fail the check");
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.equal(j.windows.outer, "no-claude", "a bare-bash outer must be reported no-claude (window present, no claude process)");
    assert.equal(j.windows.inner, "ok");
  } finally { h.cleanup(); }
});

// ── AC4 — cold-start cross-annotation ──────────────────────────────────────────────────────────────

test("AC4 — cold-start/SKILL.md cross-annotates the session topology (TOPOLOGY-IN-PLACE + factory/check refs)", () => {
  const src = fs.readFileSync(COLD_START, "utf8");
  assert.match(src, /TOPOLOGY-IN-PLACE/, "the cold-start checklist must add the TOPOLOGY-IN-PLACE key");
  // 40→6 consolidation (SPEC-instruments-behind-one-entry.md) was reverted (7642849a,
  // gap-forty-to-six-remerge-needs-tests-updated-first): the cold-start skill drives the factory/check
  // via the canonical bare scripts `quay-topology.sh` / `topology-check.sh` (NOT the grouped entry
  // `quay-session.ts ...`). The test asserts the SAME command name the skill uses (AC2: docs and tests
  // must not each write their own). Re-instate the `quay-session.ts` forms when 40→6 is re-merged.
  assert.match(src, /quay-topology\.sh/, "cold-start must drive the topology factory (build by definition)");
  assert.match(src, /topology-check\.sh/, "cold-start must verify the topology via topology-check");
  assert.match(src, /session-topology/, "cold-start must cross-annotate the session-topology skill");
});

// ── the factory (quay-topology.sh): dry-run plan + real build ──────────────────────────────────────

test("factory — quay-topology.sh --dry-run emits the two-window plan; a real build creates the windows", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  try {
    const dry = spawnSync("bash", [FACTORY, "--session", "topo-factory", "--dry-run"], { encoding: "utf8", env: h.env });
    assert.equal(dry.status, 0, `dry-run must exit 0:\n${dry.stderr}`);
    for (const role of ["outer", "inner"]) {
      assert.match(dry.stdout, new RegExp(role), `dry-run must plan the ${role} window`);
    }
    // Position-based (window name, not substring): the dry-run plan must not contain a `-n manager`
    // window name or a `:manager` window address. A bare /manager/ substring would false-positive on
    // any repo/worktree path containing "manager" (e.g. this task's worktree dir).
    assert.ok(!/ -n manager(\s|")|:manager\b/.test(dry.stdout), `dry-run must NOT plan a manager window (got:\n${dry.stdout})`);
    // Real build with a harmless launch-command override (no real claude launched — the override
    // keeps the pane shell as the pane_pid so a claude-named child appears, mirroring the real
    // quay-launch.sh launch shape).
    const build = spawnSync("bash", [FACTORY, "--session", "topo-factory"], {
      encoding: "utf8",
      env: { ...h.env, TOPOLOGY_LAUNCH_CMD: "bash -c 'exec -a claude-probe sleep 10000 & wait'" },
    });
    assert.equal(build.status, 0, `build must exit 0:\n${build.stderr}`);
    const names = h.windowNames("topo-factory");
    for (const role of ["outer", "inner"]) {
      assert.ok(names.includes(role), `the factory must create the ${role} window (got: ${names.join(", ")})`);
    }
    assert.ok(!names.includes("manager"), `the factory must NOT create a manager window (got: ${names.join(", ")})`);
    // and the topology-check passes on the factory-built session (each window has a claude child).
    const r = runCheck(h.env, ["--session", "topo-factory", "--json"]);
    assert.equal(r.status, 0, `factory-built topology must pass the check:\n${r.stdout}\n${r.stderr}`);
  } finally { h.cleanup(); }
});

test("factory — idempotent on an EXISTING session (re-run must not error under set -u, leaves live claude windows alone)", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  try {
    const launch = { ...h.env, TOPOLOGY_LAUNCH_CMD: "bash -c 'exec -a claude-probe sleep 10000 & wait'" };
    // First run creates the session (outer first window + inner).
    const first = spawnSync("bash", [FACTORY, "--session", "topo-idem"], { encoding: "utf8", env: launch });
    assert.equal(first.status, 0, `first build must exit 0:\n${first.stderr}`);
    // Second run against the SAME session — the idempotent path (SESSION_EXISTED=1, FIRST unset).
    // Regression guard: the loop's `[ "$role" = "$FIRST" ]` must not hit "FIRST: unbound variable".
    const second = spawnSync("bash", [FACTORY, "--session", "topo-idem"], { encoding: "utf8", env: launch });
    assert.equal(second.status, 0, `re-run must exit 0 (no FIRST-unbound under set -u):\n${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /in-place: topo-idem:outer/, "re-run must leave the live outer window in place");
    assert.match(second.stdout, /in-place: topo-idem:inner/, "re-run must leave the live inner window in place");
    const names = h.windowNames("topo-idem");
    assert.deepEqual(names.filter((n) => n !== "topo-idem"), ["outer", "inner"], "windows must stay outer+inner (no manager, no duplicates)");
    // and the check still passes.
    const r = runCheck(h.env, ["--session", "topo-idem", "--json"]);
    assert.equal(r.status, 0, `idempotent-built topology must pass the check:\n${r.stdout}\n${r.stderr}`);
  } finally { h.cleanup(); }
});

// ── AC6 — single-flight lock: dual-creator race must not double-create (gap-manager-productization-
// five-constraints). Two CONCURRENT invocations against the same missing session both judge
// "missing" — without the lock both would create (two sessions, two window sets). With the lock the
// second waits, then sees the session already exists → in-place, not create. Atomic create test.
test("AC6 — single-flight lock: two concurrent creators → exactly ONE create-session / one window set", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  try {
    // Isolated lock dir so the test never contends with real /tmp locks (same session name as the
    // only shared key — both creators must resolve the SAME lock path to contend on it).
    const lockDir = path.join(h.tmp, "locks");
    fs.mkdirSync(lockDir, { recursive: true });
    const env = {
      ...h.env,
      TOPOLOGY_LAUNCH_CMD: "bash -c 'exec -a claude-probe sleep 10000 & wait'",
      TOPOLOGY_LOCK_DIR: lockDir,
      TOPOLOGY_LOCK_RETRIES: "50",
    };
    // Two concurrent spawns, same session, fresh (missing). Both race to acquire the lock.
    // Start both near-simultaneously via shell backgrounding so the race window is real.
    const r = spawnSync("bash", [
      "-c",
      `"$0" --session topo-race >"$1" 2>&1 & "$0" --session topo-race >"$2" 2>&1 & wait`,
      FACTORY, path.join(h.tmp, "a.out"), path.join(h.tmp, "b.out"),
    ], { encoding: "utf8", env });
    assert.equal(r.status, 0, `concurrent factory runs must both exit 0:\n${r.stderr}`);
    const outA = fs.readFileSync(path.join(h.tmp, "a.out"), "utf8");
    const outB = fs.readFileSync(path.join(h.tmp, "b.out"), "utf8");
    const all = `${outA}\n${outB}`;
    const createSessions = (all.match(/^create-session:/gm) || []).length;
    const createWindows = (all.match(/^create-window:/gm) || []).length;
    // Exactly one session create (the first to hold the lock); the second must NOT create a second.
    assert.equal(createSessions, 1, `dual creators must create exactly ONE session (got ${createSessions}):\n${all}`);
    // The only window create is inner (outer is the new session's first window). No duplicate.
    assert.equal(createWindows, 1, `dual creators must create exactly ONE window (inner), got ${createWindows}:\n${all}`);
    // AC6's core invariant is atomic creation: exactly one session + one window set, no duplicates.
    // (A relaunch by the second creator — the window present but its claude child not yet spawned —
    // is BENIGN idempotence, not a double-create: it re-sends the same launch command. The lock's
    // job is preventing a second session/window, which the counts above pin.)
    const names = h.windowNames("topo-race");
    assert.deepEqual(names.filter((n) => n !== "topo-race"), ["outer", "inner"], "window set must be outer+inner, no duplicates");
  } finally { h.cleanup(); }
});
