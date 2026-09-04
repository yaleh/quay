// @test-group engine
// gate-script-base.test.mjs — the three-state verdict emission contract
// (plugin/scripts/gate-script-base.ts, tasks/gap-gate-script-base-behavior-contract-unusable).
//
// The base's behavior contract is the three-state verdict output layer: PASS (exit 0) / FAIL (exit 1)
// / NOT-EVALUATED (exit 3 — the harness-canonical third state, gap-not-evaluated-harness-third-state).
// emitPass/emitFail/emitNotEvaluated each take an optional structured `detail` that is merged into the
// `--json` output, so a checker expresses a violations list / structured verdict without hand-rolling
// JSON.stringify, and each RETURNS the exit code (the base owns the verdict→exit-code mapping).
//
// Run:
//   node --no-warnings --test --experimental-strip-types plugin/test/gate-script-base.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emitPass,
  emitFail,
  emitNotEvaluated,
  emitVerdict,
  verdictExitCode,
  VERDICT_EXIT_CODE,
} from "../scripts/gate-script-base.ts";

function captureStream(stream, fn) {
  const orig = process[stream].write;
  const chunks = [];
  process[stream].write = (chunk) => { chunks.push(chunk); return true; };
  try {
    return { value: fn(), out: () => chunks.join("") };
  } finally {
    process[stream].write = orig;
  }
}

// ── three-state human output + exit code ────────────────────────────────────────────────────────────

test("emitPass: human 'PASS: <message>' to stdout, returns 0", () => {
  const { value, out } = captureStream("stdout", () => emitPass("all checks green"));
  assert.equal(out().trim(), "PASS: all checks green");
  assert.equal(value, 0);
});

test("emitFail: human 'FAIL: <message>' to stdout, returns 1", () => {
  const { value, out } = captureStream("stdout", () => emitFail("test failed"));
  assert.equal(out().trim(), "FAIL: test failed");
  assert.equal(value, 1);
});

test("emitNotEvaluated: human 'NOT-EVALUATED: <message>', returns 3 (hard rule 3b third state)", () => {
  const { value, out } = captureStream("stdout", () => emitNotEvaluated("no input to evaluate"));
  assert.equal(out().trim(), "NOT-EVALUATED: no input to evaluate");
  assert.equal(value, 3);
});

test("VERDICT_EXIT_CODE maps pass→0, fail→1, not-evaluated→3", () => {
  assert.deepEqual({ ...VERDICT_EXIT_CODE }, { pass: 0, fail: 1, "not-evaluated": 3 });
  assert.equal(verdictExitCode("pass"), 0);
  assert.equal(verdictExitCode("fail"), 1);
  assert.equal(verdictExitCode("not-evaluated"), 3);
});

// ── --json structured verdict ──────────────────────────────────────────────────────────────────────

test("emitVerdict --json: { status, ok, message } + merged structured detail", () => {
  const { value, out } = captureStream("stdout", () =>
    emitVerdict({ status: "fail", message: "3 violations", detail: { violations: [{ id: "a" }, { id: "b" }], count: 3 } }, { json: true }),
  );
  const parsed = JSON.parse(out());
  assert.equal(parsed.status, "fail");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.message, "3 violations");
  assert.deepEqual(parsed.violations, [{ id: "a" }, { id: "b" }]);
  assert.equal(parsed.count, 3);
  assert.equal(value, 1);
});

test("emitPass --json: ok derived from status=pass", () => {
  const { out } = captureStream("stdout", () => emitPass("ok", { checked: 4, total: 4 }, { json: true }));
  const parsed = JSON.parse(out());
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.checked, 4);
  assert.equal(parsed.total, 4);
});

test("emitNotEvaluated --json: ok=false AND status=not-evaluated (distinct from both pass and fail)", () => {
  const { out } = captureStream("stdout", () => emitNotEvaluated("unreadable", { reason: "ENOENT" }, { json: true }));
  const parsed = JSON.parse(out());
  assert.equal(parsed.status, "not-evaluated");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, "ENOENT");
});

test("emitVerdict --json: an array detail is serialized under `detail` (not spread)", () => {
  const { out } = captureStream("stdout", () => emitVerdict({ status: "fail", message: "bad", detail: ["a", "b"] }, { json: true }));
  const parsed = JSON.parse(out());
  assert.deepEqual(parsed.detail, ["a", "b"]);
});

test("emitVerdict: detail wins over no conflicting status/ok/message keys (base owns the vocabulary)", () => {
  // A caller-supplied `status`/`ok`/`message` in the detail must NOT override the base's verdict fields.
  const { out } = captureStream("stdout", () =>
    emitVerdict({ status: "pass", message: "good", detail: { status: "fail", ok: false, message: "spoofed" } }, { json: true }),
  );
  const parsed = JSON.parse(out());
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.message, "good");
});

test("emitVerdict: stream=stderr routes the verdict line to stderr", () => {
  const { out } = captureStream("stderr", () => emitFail("to stderr", undefined, { stream: "stderr" }));
  assert.equal(out().trim(), "FAIL: to stderr");
});
