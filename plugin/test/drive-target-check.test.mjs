// @test-group engine
// drive-target-check.test.mjs — fail-closed pre-flight gate for tmux drive/observe targets
// (tasks/gap-drive-sent-to-manager-pane-not-inner — the three disciplines).
//
// Incident (2026-08-10): the outer loop drove the inner via `quay-0:0.0` — window 0 was `claude`
// (the MANAGER, pid 2983389), not inner (`quay-0:inner`, pid 2989409). 6 send-keys in 2
// dispatches all landed in the manager's input box, and the manager's transcript (b8dc91a6) was
// read as the inner's 26 times. Root cause: a numeric pane index substituted for an explicit
// window identity. This gate (plugin/scripts/drive-target-check.sh) makes that structurally
// impossible for every drive/observe script that calls it.
//
// Coverage map:
//   Discipline ① (window NAME, never an index) — a numeric pane/window index (`quay-0:0`,
//     `quay-0:0.0`, `1.0`) is rejected SYNTACTICALLY, before tmux is consulted (a pure string
//     check — no tmux server needed), even when the session exists and the index WOULD resolve to
//     the right window. Layout is mutable; the name is not.
//   Discipline ② (pre-verify before EVERY capture-pane/send-keys) — the target's resolved window
//     name must equal DRIVE_EXPECT_WINDOW_NAME (default `inner`). A real-but-wrong window (e.g.
//     the `claude` manager window) fails closed; a NON-existent window NAME (a typo like `innr` —
//     tmux's display-message silently resolves it to the session's ACTIVE window with rc=0, so
//     list-windows membership is required) fails closed too.
//   AC5 — node:test + // @test-group engine; the real-TUI carve-out uses hermetic sessions
//     only (newHermeticTmux — never the loop's own sessions, never kill-server).
//
// Run: scripts/test.sh plugin/test/drive-target-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { newHermeticTmux } from "./helpers/hermetic-tmux.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(__dirname, "..", "scripts", "drive-target-check.sh");


function uniqueName(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// NOTE: the env is passed through AS-IS (never `{...process.env, ...env}`) — h.env already carries
// process.env with the TMUX var DELETED (hermetic-tmux.mjs), and re-spreading process.env first
// would resurrect $TMUX and make the gate's bare `tmux` target the parent session instead of the
// hermetic socket. Spreading h.env directly keeps the deletion intact.
function run(args, env = {}) {
  return spawnSync("bash", [GATE, ...args], { encoding: "utf8", env });
}

// ── Discipline ①: numeric-index rejection (pure string check — no tmux needed) ────────────────────

test("① numeric-index: quay-0:0.0 is rejected (fail closed) without any tmux consultation", () => {
  const r = run(["quay-0:0.0"]);
  assert.equal(r.status, 1, `numeric index must exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /数字索引/, `must name the numeric-index rejection:\n${r.stderr}`);
});

test("① numeric-index: quay-0:0 (window index, no pane) is rejected", () => {
  const r = run(["quay-0:0"]);
  assert.equal(r.status, 1, `numeric index must exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /数字索引/);
});

test("① numeric-index: bare 1.0 (no session prefix) is rejected", () => {
  const r = run(["1.0"]);
  assert.equal(r.status, 1, `bare numeric index must exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /数字索引/);
});

test("① numeric-index: bare 0 is rejected", () => {
  const r = run(["0"]);
  assert.equal(r.status, 1, `bare numeric index must exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
});

// ── usage / env validation (no terminal surface) ──────────────────────────────────────────────────

test("usage: missing target exits 2 with a usage message, before any tmux", () => {
  const r = run([]);
  assert.equal(r.status, 2, `no args → exit 2, got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /用法|缺少目标/);
});

test("usage: --expect without a value exits 2", () => {
  const r = run(["quay-0:inner", "--expect"]);
  assert.equal(r.status, 2, `--expect without value → exit 2, got ${r.status}\n${r.stderr}`);
  assert.match(r.stderr, /--expect 需要窗口名/);
});

test("env: the expected window name defaults to the target's OWN window part (derived, never hardcoded inner), overridable via DRIVE_EXPECT_WINDOW_NAME", () => {
  // No tmux is needed for the default-value semantics. The default is derived from TARGET's window
  // part (after the last ':') — driving `session:outer` expects `outer`, `session:inner` expects
  // `inner` (human 2026-08-12 裁定: no hardcoded inner, so non-inner drives work). An explicit
  // DRIVE_EXPECT_WINDOW_NAME still overrides.
  const src = fs.readFileSync(GATE, "utf8");
  assert.match(src, /DRIVE_EXPECT_WINDOW_NAME:-\$\{TARGET##\*:\}/, "default expected window name derives from TARGET's window part");
  assert.match(src, /list-windows/, "window-part membership closes tmux's silent-active-window fallback");
});

// ── Discipline ②: real-TUI verification (hermetic sessions) ──────────────────────────────────────

test("② real-but-wrong window: a `claude` window targeted as the drive target fails closed (the exact incident shape)", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const session = uniqueName("dtc-claude");
  const h = newHermeticTmux("dtc-claude-");
  try {
    // window 0 = inner, window 1 = claude — mirroring the real quay-0 layout. The rename runs via
    // the hermetic socket (h.tmx), NOT inside the session (a nested bare `tmux` could not reach it).
    assert.equal(h.newSession(session, "sleep 30").status, 0);
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, "inner"]).status, 0);
    assert.equal(h.tmx(["new-window", "-d", "-t", session, "-n", "claude", "sleep 30"]).status, 0);
    // default expect now derives from TARGET (claude → expect claude, passes) — the incident guard
    // is the MISMATCH: target claude but explicitly expect=inner → fails closed.
    const r = run([`${session}:claude`, "--expect", "inner"], h.env);
    assert.equal(r.status, 1, `claude window with expect=inner must fail closed, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /窗口名/, `must report the resolved window name:\n${r.stderr}`);
    assert.match(r.stderr, /claude/, `must name the actual window (claude):\n${r.stderr}`);
  } finally {
    h.cleanup();
  }
});

test("② real-and-right window: a session window named `inner` passes when expect=inner", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const session = uniqueName("dtc-ok");
  const h = newHermeticTmux("dtc-ok-");
  try {
    assert.equal(h.newSession(session, "sleep 30").status, 0);
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, "inner"]).status, 0);
    const r = run([`${session}:inner`], { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "inner" });
    assert.equal(r.status, 0, `inner window with expect=inner must pass, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /OK/);
  } finally {
    h.cleanup();
  }
});

test("② lenient-fallback hole: a NON-existent window name (typo `innr`) fails closed even though display-message would resolve it to the active window", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const session = uniqueName("dtc-typo");
  const h = newHermeticTmux("dtc-typo-");
  try {
    // window 0 named `inner` and ACTIVE — a bare display-message on `<session>:innr` returns
    // `inner` (active) with rc=0; the list-windows membership check must still reject `innr`.
    assert.equal(h.newSession(session, "sleep 30").status, 0);
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, "inner"]).status, 0);
    const r = run([`${session}:innr`], { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "inner" });
    assert.equal(r.status, 1, `typo window name must fail closed, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /不是会话.*真实窗口名/, `must name the membership rejection:\n${r.stderr}`);
  } finally {
    h.cleanup();
  }
});

test("② numeric-index that WOULD resolve to a matching window is still rejected (discipline ① wins over a window-name match)", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const session = uniqueName("dtc-num");
  const h = newHermeticTmux("dtc-num-");
  try {
    // window 0 IS named `inner`, and we set expect=inner — yet the numeric index `:0` must still
    // be rejected: the discipline retires numeric indices regardless of what they resolve to.
    assert.equal(h.newSession(session, "sleep 30").status, 0);
    assert.equal(h.tmx(["rename-window", "-t", `${session}:0`, "inner"]).status, 0);
    const r = run([`${session}:0`], { ...h.env, DRIVE_EXPECT_WINDOW_NAME: "inner" });
    assert.equal(r.status, 1, `numeric index must fail closed even when it resolves to inner, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /数字索引/);
  } finally {
    h.cleanup();
  }
});

test("② nonexistent target (bare session and session:window) fails closed", { timeout: 30000 }, async (t) => {
  const tmuxV = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (tmuxV.error || tmuxV.status !== 0) {
    t.skip("tmux not available — skipping");
    return;
  }
  const h = newHermeticTmux("dtc-none-");
  try {
    const r1 = run([uniqueName("no-such-session")], h.env);
    assert.equal(r1.status, 1, `nonexistent session must fail closed, got ${r1.status}\n${r1.stdout}\n${r1.stderr}`);
    const r2 = run([`${uniqueName("no-such")}:inner`], h.env);
    assert.equal(r2.status, 1, `nonexistent session:window must fail closed, got ${r2.status}\n${r2.stdout}\n${r2.stderr}`);
  } finally {
    h.cleanup();
  }
});

