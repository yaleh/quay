// @test-group lowconc
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-27 child-spawn (spawns real full-suite-runner.ts + fake-suite child; triage 判 other-task defer 而非 isolate-rerun — gap-full-suite-runner-test-poll-timeout-load-flake)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — every test spawns a
//   real node runner (full-suite-runner.ts) + a real bash fake-suite child; under full-suite concurrency
//   the runner bootstrap + child spawn is start/schedule-delayed and the wall-clock polls flaked
//   (gap-full-suite-runner-test-poll-timeout-load-flake: "poll timeout" under load 11.81 / 16 lanes).
//   The 5s polls were already raised to 20s (gap-suite-load-sampler-orphan-process); this annotation
//   closes the triage half — a failure must be classified load-sensitive (isolate-rerun), not
//   other-task (defer anti-livelock).

// full-suite-runner.test.mjs — runner verdict / state machine / red detection / reason axis / kill-hang / control. Split from gap-suite-file-split-two-longest; harness shared via ./helpers/full-suite-runner-harness.mjs.
// SPLIT from full-suite-runner.test.mjs by gap-suite-split-15-over-30s-test-files — shard 9/12 (7 tests). Shared fixtures: ./helpers/full-suite-runner-shards-harness.mjs (single source).

import { test } from "node:test";
import { CLOSURE_DECOMP_TASK_ID, CLOSURE_TASK, INNER_TICK, OUTER_TICK, RUNNER, after, assert, fakeSuite, fs, os, path, read, readState, redPayload, runCli, runRunner, waitExit } from "./helpers/full-suite-runner-shards-harness.mjs";

test("AC2/AC3 e2e — a RED/killed round's archived log still carries stderr __OVERHEAD__ phase lines (red round OVERHEAD non-zero)", async () => {
  // gap-red-round-loses-overhead-phase-decomposition: kill-on-red truncates the main phase BEFORE
  // test.sh's full 9-segment emit, so a red round historically archived ZERO __OVERHEAD__ lines.
  // With the partial fallback, test.sh emits the COMPLETED segments (serial/lowconc) with partial=1
  // to stderr BEFORE the kill; the runner must archive those lines even though the round is red and
  // the child is killed. This fake suite writes the partial-phase lines to stderr, reds early, then
  // goes silent so the runner's red-grace kill fires — the __OVERHEAD__ count must be non-zero.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-red-"));
  const { f, dir } = fakeSuite(
    'echo "__OVERHEAD__ lock_overhead_ms=42 partial=1"\n' +
      'echo "__OVERHEAD__ serial_phase_ms=639986 partial=1" >&2\n' +
      'echo "__OVERHEAD__ lowconc_phase_ms=271616 partial=1" >&2\n' +
      'echo "not ok 1 - boom"\n' +
      "sleep 5\n",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "300", QUAY_TEST_KILL_ON_RED: "1" } });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "runner exits non-zero on the red");
    const s = readState(root);
    assert.equal(s.state, "red", "the failure flipped red");
    const log = read(path.join(root, ".quay", "full-suite.log"));
    // The red round's phase decomposition is present DESPITE the kill — the whole point of AC2/AC3.
    assert.match(log, /__OVERHEAD__ lock_overhead_ms=42 partial=1/, "stderr partial line reached the archived log");
    assert.match(log, /__OVERHEAD__ serial_phase_ms=639986 partial=1/, "completed serial phase present on the red round");
    assert.match(log, /__OVERHEAD__ lowconc_phase_ms=271616 partial=1/, "completed lowconc phase present on the red round");
    assert.ok((log.match(/__OVERHEAD__/g) || []).length >= 3, "the red round's __OVERHEAD__ count is non-zero");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("AC5 e2e — a `tmux-leak-scan: FAIL` residual line (candidate C) flips red with failures non-empty (leak is a real residual)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-leak-"));
  // Candidate C merge semantics: the suite-tail leak scan reports a residual to the stream
  // (unconditional, no `&&` short-circuit in test.sh); the runner must recognize that FAIL line
  // as a REAL failure (not swallow it into the failures=[] catch-all).
  const { f, dir } = fakeSuite(
    'echo "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot; prefixes: skv-|session-liveness-|ol-tok-|enter-repro-):" >&2\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "tmux-leak-scan FAIL flips state to red (candidate C — leak is a real residual)");
    assert.equal(s.reason, "failed");
    assert.ok(redPayload(s).length >= 1, `the red payload carries the leak-scan residual (AC5); got ${JSON.stringify(s)}`);
    assert.match(redPayload(s)[0].line, /tmux-leak-scan: FAIL/, "the leak-scan FAIL line is the recorded failure");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});



test("AC3 — the inner stop-condition reads the outer suite-state; the inner doc has ZERO scripts/test.sh self-run literal", () => {
  const inner = read(INNER_TICK);
  // Inner reads the suite-state file and its `state` field (running/green => proceed, red => stop).
  assert.ok(inner.includes(".quay/full-suite-state.json"), "inner doc reads .quay/full-suite-state.json");
  assert.ok(inner.includes("`state`"), "inner doc reads the `state` field");
  assert.ok(inner.includes("running"), "inner doc handles running");
  assert.ok(inner.includes("green"), "inner doc handles green");
  assert.ok(inner.includes("red"), "inner doc handles red");
  // DoD grep: inner side has NO full-suite self-run literal.
  assert.ok(
    !inner.includes("scripts/test.sh"),
    "inner doc has NO scripts/test.sh literal (inner 零全量套件自跑 — DoD grep proof)",
  );
});


test("AC4 — the red-window ruling is explicit in the loop docs: RED => stop dispatch + hold fan-in", () => {
  const outer = read(OUTER_TICK);
  const inner = read(INNER_TICK);
  // The red state IS the stop-dispatch signal (outer writes it via the runner; inner reads it).
  assert.ok(outer.includes("stop-dispatch 信号"), "outer doc names the stop-dispatch signal (AC4)");
  assert.ok(outer.includes("红窗分诊"), "outer doc has the red-window triage section (AC4)");
  // GREEN/RUNNING => optimistic merge/dispatch (the point of eliminating the sync point).
  assert.ok(inner.includes("RUNNING 不等套件"), "inner doc proceeds on RUNNING (optimistic, AC4)");
  // RED => stop new dispatch AND hold completed-agent fan-in.
  assert.ok(
    inner.includes("暂缓已完成 agent 的 fan-in"),
    "inner doc holds fan-in on red (AC4) — only stopping dispatch lets a red tree keep accumulating",
  );
});


test("AC5 — the >=3min/<3min threshold rule + durationMs measurement hook are in both loop docs", () => {
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(doc.includes("3 分钟"), `${name} doc has the 3-minute threshold`);
    assert.ok(doc.includes("durationMs"), `${name} doc names durationMs as the measurement hook`);
  }
});


test("AC7 — the three batch-eliminating blocks (a/b/c) are cross-annotated in the closure-sync task and loop docs", () => {
  const closure = read(CLOSURE_TASK);
  assert.ok(
    closure.includes("gap-full-suite-belongs-to-outer-background-above-3-min"),
    "closure-sync task names the (a) suite block (cross-annotation)",
  );
  assert.ok(
    closure.includes(CLOSURE_DECOMP_TASK_ID),
    "closure-sync task names the (c) AC/evidence block",
  );
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(
      doc.includes(CLOSURE_DECOMP_TASK_ID),
      `${name} loop doc references the (c) closure-decomposition task id (AC7)`,
    );
  }
});

// ── Contract invoke (gap-full-suite-runner-marks-test-sh-gate-wait-as-failed) ──────────
// --wait-check is the ABORT-side twin of --fail-fast-check: it proves the gate-WAIT ⇒ aborted ⇒
// NO-stop-dispatch chain end-to-end via a runnable CLI control (the Contract's `measure` surface).



test("AC1 Contract invoke — `full-suite-runner.ts --wait-check` proves: test.sh gate-WAIT => red reason=aborted => NO stopSignal", async () => {
  const { code, out, err } = await runCli(RUNNER, ["--wait-check"]);
  assert.equal(code, 0, `--wait-check exits 0 when the ABORT chain works; got ${code}\n${out}\n${err}`);
  assert.match(out, /wait-check OK/, "verification line present");
  assert.match(out, /reason=aborted/, "gate-WAIT is reason=aborted (no correctness conclusion)");
  assert.match(out, /stopSignal=false/, "aborted-red must NOT stop dispatch (AC1)");
  assert.match(out, /SUITE-RED/, "SUITE-RED event still recorded (red noticed, routed by reason)");
});

// ── gap-full-suite-state-red-no-failure-detail-static-check-invisible Contract invoke ───────────────
// --static-check-check is the STATIC-CHECK-side twin of --fail-fast-check (test-failure chain) and
// --wait-check (abort chain): it proves the 20:48Z shape (task-contract-check ratchet violations ⇒
// the suite aborts before tests with violations=N / ceiling=C / newSinceBaseline=K in the log) now
// lands in the state file as machine-readable fields consumers read WITHOUT hand-digging the log.
