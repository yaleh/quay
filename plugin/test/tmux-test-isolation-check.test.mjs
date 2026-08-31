// @test-group engine
// tmux-test-isolation-check.test.mjs — unit tests for the tmux-isolation static checker
// (tasks/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe, STAGE 2 / AC3-AC4).
//
// AC3  — the check is MECHANICAL (not a prose rule): a test file that spawns real tmux with no
//        mechanism reference AND missing a mandatory isolation condition is reported.
// AC4  — the check has a NEGATIVE CONTROL (the shipped-verifiers lesson — "提及不构成调用点"):
//        a deliberately unqualified bare `tmux new-session` call in a test file MUST report red;
//        if it stayed green the check would equal not having a check.
//
// The mutation case (plugin/scripts/checker-mutation-cases/tmux-test-isolation-check.sh) exercises
// the same negative control against the REAL file scanner; this unit test exercises the pure
// scanFileText() predicate over constructed fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";

import { scanFileText } from "../scripts/tmux-test-isolation-check.ts";


// ── AC4 negative control: the bare unqualified shape MUST be red ────────────────────────────────

test("AC4 negative control: a bare `spawnSync(\"tmux\", [\"new-session\"...])` with NO isolation is RED", () => {
  const src = `import { spawnSync } from "node:child_process";
const r = spawnSync("tmux", ["new-session", "-d", "-s", "probe"], { encoding: "utf8" });
`;
  const res = scanFileText(src);
  assert.equal(res.isolated, false, "a bare tmux new-session with no isolation must be flagged");
  assert.ok(res.reasons.some((r) => /missing explicit -S/.test(r)), "must name the missing -S");
  assert.ok(res.reasons.some((r) => /missing env -u TMUX/.test(r)), "must name the missing env strip");
});

test("AC4 negative control: a bare `spawnSync('tmux', ['new-session'...])` (single-quoted) is RED", () => {
  const src = `const r = spawnSync('tmux', ['new-session', '-d', '-s', 'x'], { encoding: 'utf8' });\n`;
  const res = scanFileText(src);
  assert.equal(res.isolated, false);
});

test("AC4 negative control: a helper call `tmux([\"new-session\"...])` with no mechanism/no conditions is RED (the default-socket new-session shape is the crash path)", () => {
  const src = `function tmux(args) { return spawnSync("tmux", args, { encoding: "utf8" }); }
tmux(["new-session", "-d", "-s", "leaky"]);
`;
  const res = scanFileText(src);
  assert.equal(res.isolated, false, "a helper-created session on an unisolated socket must be flagged");
});

// ── Mechanism reference → GREEN ─────────────────────────────────────────────────────────────────

test("mechanism reference (import tmux-session) is GREEN even with a direct spawn", () => {
  const src = `import { tmux } from "../scripts/tmux-session.ts";
const r = spawnSync("tmux", ["-V"], { encoding: "utf8" });
tmux(["new-session", "-d", "-s", "x"]);
`;
  const res = scanFileText(src);
  assert.equal(res.isolated, true, "a file importing the tmux-session library is structurally isolated");
});

test("mechanism reference (import hermetic-tmux helper) is GREEN", () => {
  const src = `import { newHermeticTmux } from "./helpers/hermetic-tmux.mjs";
const h = newHermeticTmux(); h.newSession("x", "bash");
`;
  const res = scanFileText(src);
  assert.equal(res.isolated, true);
});

// ── Both conditions inline → GREEN ──────────────────────────────────────────────────────────────

test("both conditions inline (delete env.TMUX + quoted -S) is GREEN — the hand-rolled-but-correct shape", () => {
  const src = `const env = { ...process.env, TMUX_TMPDIR: sockDir };
delete env.TMUX;
const r = spawnSync("tmux", ["-S", sockPath, "new-session", "-d", "-s", "x"], { encoding: "utf8", env });
`;
  const res = scanFileText(src);
  assert.equal(res.isolated, true, "a file with BOTH conditions inline is not a crash risk");
});

test("both conditions inline (TMUX: undefined + quoted -S) is GREEN", () => {
  const src = `spawnSync("tmux", ["-S", sock, "ls"], { encoding: "utf8", env: { ...process.env, TMUX: undefined } });\n`;
  const res = scanFileText(src);
  assert.equal(res.isolated, true);
});

test("missing only ONE condition is RED (the guard's 'BOTH are required (AC1)')", () => {
  const src = `const r = spawnSync("tmux", ["-S", sock, "new-session", "-d", "-s", "x"], { encoding: "utf8" });\n`;
  const res = scanFileText(src);
  assert.equal(res.isolated, false, "explicit -S WITHOUT env strip is still a violation (both are required)");
  assert.ok(res.reasons.some((r) => /missing env -u TMUX/.test(r)));
});

// ── -V version probe is NOT a crash risk ────────────────────────────────────────────────────────

test("a `tmux -V` version probe alone is GREEN (no server is started)", () => {
  const src = `const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();
`;
  const res = scanFileText(src);
  assert.equal(res.isolated, true, "a pure -V availability probe starts no server");
});

