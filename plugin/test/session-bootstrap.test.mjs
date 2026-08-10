// @test-group product
// session-bootstrap.test.mjs — gap-no-formalized-bare-metal-session-bootstrap, AC1–AC5.
//
// The step BEFORE quay:cold-start (a tmux window layout with a Claude Code process live in each
// pane) used to have zero formalized product — tonight's manager/inner/outer windows were all
// hand-typed tmux commands with no record. This test pins plugin/scripts/session-bootstrap.sh:
//
//   AC1 — running against bare tmux (no windows) produces the named layout, each window's
//         claude process confirmed live (real process-detection via /proc, not "command sent").
//   AC2 — idempotent: re-running against an already-built session does not duplicate windows or
//         kill/restart already-live processes (the SAME pane pid survives the re-run).
//   AC3 — a window whose process fails to start is reported BY NAME, the script exits non-zero,
//         and the other window is still named too (nothing silently half-built).
//   AC4 — quay:cold-start's own precondition check ("inner session reachable",
//         `tmux list-panes -t <session>`) can run immediately after, with the session name read
//         from <root>/orchestration/session-liveness.env (no extra manual step).
//   AC5 — this file is node:test + `// @test-group product`; and cold-start/SKILL.md cross-
//         references session-bootstrap.sh (the wiring).
// Plus: layout validation (unknown role → exit 2) and --dry-run (plan, no changes).
//
// All tmux work is on a HERMETIC server on a PRIVATE socket, addressed by EXPLICIT `-S <path>`
// on every tmux call (the script's `--socket` override — the environment ignores TMUX_TMPDIR, so
// env-only isolation would bleed into the machine's real sessions). Cleanup kills each session it
// started (kill-session, never kill-server — gap-tests-leak-tmux-servers-main-resource-pressure-
// and-crash-cause) and removes its tmp dir.
//
// Run:
//   scripts/test.sh plugin/test/session-bootstrap.test.mjs
//   scripts/test.sh --for-task gap-no-formalized-bare-metal-session-bootstrap

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// STAGE 1 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): the local hermetic
// helper had explicit `-S` but did NOT strip $TMUX — under an inherited $TMUX the `-S`-less
// subprocesses of session-bootstrap.sh (env-only resolution) could still reach the default server.
// Delegating the helper's tmux() to the tmux-session library makes BOTH conditions structural
// (explicit -S + $TMUX-stripped env).
import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const BOOTSTRAP = path.join(pluginDir, "scripts", "session-bootstrap.sh");
const COLD_START = path.join(pluginDir, "skills", "cold-start", "SKILL.md");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ── hermetic tmux: PRIVATE socket, explicit `-S` on every call ─────────────────────────────────────
function newHermetic(prefix = "quay-sb-") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sockPath = path.join(tmp, `tmux-${process.getuid()}`, "default");
  fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 }); // tmux refuses a world-accessible socket dir
  const started = new Set();
  return {
    tmp, sockPath, started,
    tmux(args) {
      return isolatedTmux(args, { socket: this.sockPath });
    },
    newSession(name, cmd) {
      const r = this.tmux(["new-session", "-d", "-s", name, cmd]);
      if (r.status === 0) this.started.add(name);
      return r;
    },
    windowNames(sess) {
      const r = this.tmux(["list-windows", "-t", sess, "-F", "#{window_name}"]);
      return r.stdout.trim().split("\n").filter(Boolean);
    },
    // pane pid of a window (by NAME — pane indices drift, window names do not).
    panePid(sess, role) {
      const r = this.tmux(["list-panes", "-t", `${sess}:${role}`, "-F", "#{pane_pid}"]);
      return r.status === 0 ? (r.stdout.trim().split("\n")[0] || "") : "";
    },
    cleanup() {
      // Kill EVERY session on this hermetic socket — not just the `started` set. The bootstrap
      // script (--socket <this.sockPath>) creates sessions DIRECTLY on this socket, invisible to
      // `started`; leaving them orphaned leaks the server (删目录 ≠ 杀进程 —
      // gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause). The socket is private
      // to this test (mkdtemp'd, explicit -S), so sweeping it cannot touch real sessions;
      // per-session kill-session (never kill-server).
      const ls = this.tmux(["list-sessions", "-F", "#{session_name}"]);
      if (ls.status === 0 && ls.stdout.trim()) {
        for (const name of ls.stdout.trim().split("\n").filter(Boolean)) {
          this.tmux(["kill-session", "-t", name]);
        }
      }
      for (const name of this.started) {
        this.tmux(["kill-session", "-t", name]);
      }
      try { fs.rmSync(this.tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

// fakeRoot — a project root quay-init's layout would accept: session-liveness.env naming the
// session (what AC4 reads through, no --session passed).
function fakeRoot(sess) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-sb-root-"));
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(dir, "orchestration", "session-liveness.env"), `SESSION_TMUX_SESSION=${sess}\n`, "utf8");
  return dir;
}

const LIVE_CMD = "bash -c 'exec -a claude-probe sleep 10000 & wait'"; // a claude-cmdline stand-in (session-topology's shape)
const FAIL_CMD = "bash -c 'sleep 10000 & wait'";                      // a process, but NOT a claude process → liveness must fail

function runBootstrap(root, layout, args = [], env = {}) {
  return spawnSync("bash", [BOOTSTRAP, root, layout, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

// FAILED/error lines go to stderr; the happy-path lines go to stdout — assert on BOTH.
function out(r) {
  return `${r.stdout}\n${r.stderr}`;
}

// ── AC1 — bare tmux → named layout, each window's claude process confirmed live ────────────────────

test("AC1 — bare tmux produces the named layout with every window's claude process live", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  const root = fakeRoot("sb-ac1");
  try {
    const r = runBootstrap(root, "inner/outer", ["--socket", h.sockPath], {
      SESSION_BOOTSTRAP_LAUNCH_CMD: LIVE_CMD,
    });
    assert.equal(r.status, 0, `bootstrap must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /bootstrap ok: sb-ac1 layout 'inner outer' all windows live/, "must report the full layout as live");
    const names = h.windowNames("sb-ac1");
    assert.deepEqual(names, ["inner", "outer"], `must build exactly inner+outer (got: ${names.join(", ")})`);
    // liveness is a REAL process check: each window has a non-empty pane pid (a live pane shell).
    for (const role of ["inner", "outer"]) {
      assert.ok(h.panePid("sb-ac1", role), `window ${role} must have a live pane after bootstrap`);
    }
  } finally {
    h.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — manager/inner/outer layout builds all three windows live", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  const root = fakeRoot("sb-mgr");
  try {
    const r = runBootstrap(root, "manager/inner/outer", ["--socket", h.sockPath], {
      SESSION_BOOTSTRAP_LAUNCH_CMD: LIVE_CMD,
    });
    assert.equal(r.status, 0, `bootstrap must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(h.windowNames("sb-mgr"), ["manager", "inner", "outer"]);
    assert.match(r.stdout, /all windows live/);
  } finally {
    h.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC2 — idempotent re-run: no duplicates, live processes NOT restarted ──────────────────────────

test("AC2 — re-running against an already-built session does not duplicate windows or restart live processes", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  const root = fakeRoot("sb-idem");
  try {
    const env = { SESSION_BOOTSTRAP_LAUNCH_CMD: LIVE_CMD };
    const first = runBootstrap(root, "inner/outer", ["--socket", h.sockPath], env);
    assert.equal(first.status, 0, `first build must exit 0:\n${first.stdout}\n${first.stderr}`);
    const pids1 = { inner: h.panePid("sb-idem", "inner"), outer: h.panePid("sb-idem", "outer") };
    assert.ok(pids1.inner && pids1.outer, "both windows must have live panes after the first build");

    const second = runBootstrap(root, "inner/outer", ["--socket", h.sockPath], env);
    assert.equal(second.status, 0, `re-run must exit 0:\n${second.stdout}\n${second.stderr}`);
    // no duplicates: exactly inner+outer, in the same order.
    assert.deepEqual(h.windowNames("sb-idem"), ["inner", "outer"], "re-run must not duplicate windows");
    // no restart: the SAME pane pid is still the live one (the re-run left the window alone).
    for (const role of ["inner", "outer"]) {
      assert.equal(h.panePid("sb-idem", role), pids1[role],
        `re-run must NOT restart ${role} (pane pid changed ${pids1[role]} -> ${h.panePid("sb-idem", role)})`);
    }
    assert.match(second.stdout, /in-place: sb-idem:inner/, "re-run must report inner as in-place (not relaunch)");
    assert.match(second.stdout, /in-place: sb-idem:outer/, "re-run must report outer as in-place (not relaunch)");
  } finally {
    h.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC3 — a window whose process fails is reported by name, non-zero exit, others named too ────────

test("AC3 — a window whose process fails to start is reported by name; script exits non-zero; the other window is named too", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  const root = fakeRoot("sb-ac3");
  try {
    // inner's launch produces a process but NOT a claude process → liveness must fail.
    const r = runBootstrap(root, "inner/outer", ["--socket", h.sockPath, "--wait", "3"], {
      SESSION_BOOTSTRAP_LAUNCH_CMD: LIVE_CMD,
      SESSION_BOOTSTRAP_LAUNCH_CMD_INNER: FAIL_CMD,
    });
    assert.notEqual(r.status, 0, `a failed window must make the script exit non-zero:\n${out(r)}`);
    assert.match(out(r), /FAILED: sb-ac3:inner/, "the failing window must be reported BY NAME");
    assert.match(out(r), /verified: sb-ac3:outer/, "the passing window must ALSO be named (no silent half-build)");
    assert.match(out(r), /bootstrap FAILED: sb-ac3 layout 'inner outer'/, "the final summary must name the layout");
  } finally {
    h.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC4 — cold-start's precondition ("inner session reachable") runs immediately after ─────────────

test("AC4 — cold-start's inner-session-reachable precondition passes right after, session name from session-liveness.env", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  const root = fakeRoot("sb-ac4");
  try {
    // NO --session: the script must read the session name from <root>/orchestration/session-liveness.env.
    const r = runBootstrap(root, "inner/outer", ["--socket", h.sockPath], {
      SESSION_BOOTSTRAP_LAUNCH_CMD: LIVE_CMD,
    });
    assert.equal(r.status, 0, `bootstrap must exit 0:\n${r.stdout}\n${r.stderr}`);
    // The cold-start precondition is exactly `tmux list-panes -t <session>` (the session the env names).
    const check = h.tmux(["list-panes", "-t", "sb-ac4"]);
    assert.equal(check.status, 0, `cold-start's precondition (tmux list-panes -t <session>) must succeed immediately after:\n${check.stderr}`);
    const inner = h.tmux(["list-panes", "-t", "sb-ac4:inner"]);
    assert.equal(inner.status, 0, "the inner window must be reachable by name (tmux list-panes -t <session>:inner)");
  } finally {
    h.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── AC5 — test-framework + cold-start wiring ───────────────────────────────────────────────────────

test("AC5 — this file is node:test and declares // @test-group product", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /@test-group\s+product/, "must declare // @test-group product (the scripts-test convention)");
  assert.match(src, /import \{ test \} from "node:test"/, "must use node:test");
});

test("AC5 — cold-start/SKILL.md wires session-bootstrap.sh in as the bare-metal step", () => {
  const src = fs.readFileSync(COLD_START, "utf8");
  // 40→6 consolidation (SPEC-instruments-behind-one-entry.md) was reverted (7642849a,
  // gap-forty-to-six-remerge-needs-tests-updated-first): the cold-start skill references the
  // canonical bare script `session-bootstrap.sh` (NOT the grouped entry `quay-session.ts
  // session-bootstrap`). The test asserts the SAME command name the skill uses (AC2: docs and tests
  // must not each write their own). Re-instate the `quay-session.ts` form when 40→6 is re-merged.
  assert.match(src, /session-bootstrap\.sh/, "cold-start must reference the bootstrap command (the formalized bare-metal step)");
  assert.match(src, /bare-?metal|裸机/i, "cold-start must name the bare-metal step it formalizes");
});

// ── validation + dry-run ───────────────────────────────────────────────────────────────────────────

test("layout validation — an unknown role is rejected (exit 2)", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  const root = fakeRoot("sb-bad");
  try {
    const r = runBootstrap(root, "manager/wrong", ["--socket", h.sockPath], { SESSION_BOOTSTRAP_LAUNCH_CMD: LIVE_CMD });
    assert.equal(r.status, 2, `an unknown layout role must exit 2:\n${out(r)}`);
    assert.match(out(r), /unknown layout role: 'wrong'/, "must name the offending role");
  } finally {
    h.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--dry-run emits the build plan and changes nothing", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  const root = fakeRoot("sb-dry");
  try {
    const r = runBootstrap(root, "inner/outer", ["--socket", h.sockPath, "--dry-run"], {
      SESSION_BOOTSTRAP_LAUNCH_CMD: LIVE_CMD,
    });
    assert.equal(r.status, 0, `dry-run must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /would-create-session: tmux new-session -d -s sb-dry -n inner/, "dry-run must plan the first (session-creating) window");
    assert.match(r.stdout, /would-create-window: tmux new-window -t sb-dry -n outer/, "dry-run must plan the second window");
    assert.match(r.stdout, /dry-run: layout 'inner outer' on sb-dry \(no changes made\)/, "dry-run must state no changes are made");
    // nothing was actually created: the session must not exist.
    const ls = h.tmux(["has-session", "-t", "sb-dry"]);
    assert.notEqual(ls.status, 0, "dry-run must NOT create the session");
  } finally {
    h.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
