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
  flagValue,
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

// ── flagValue ─────────────────────────────────────────────────────────────────────────────────────
// The ~54 hand-written copies this export replaced all shared ONE algorithm; this section pins the
// ONE input where they did not agree (an empty-string value) so the choice is a recorded decision
// rather than an accident of whichever copy was picked as the base.

test("flagValue: returns the token after the flag", () => {
  assert.equal(flagValue(["--task", "GAP-1", "--root", "/tmp"], "--task"), "GAP-1");
  assert.equal(flagValue(["--task", "GAP-1", "--root", "/tmp"], "--root"), "/tmp");
});

test("flagValue: absent flag ⇒ undefined", () => {
  assert.equal(flagValue(["--task", "GAP-1"], "--root"), undefined);
  assert.equal(flagValue([], "--root"), undefined);
});

test("flagValue: flag present but LAST (no token after it) ⇒ undefined", () => {
  // The bounds-checked copies (`i >= 0 && i + 1 < args.length`) and the unchecked ones agree here:
  // `argv[idx + 1]` past the end is `undefined` too.
  assert.equal(flagValue(["--task", "GAP-1", "--verbose"], "--verbose"), undefined);
});

test("flagValue: a flag-looking token used as ANOTHER flag's value is matched first (indexOf, preserved)", () => {
  // Every copy had this property, so the extraction keeps it: `indexOf` finds the FIRST occurrence
  // and does not know which token is a value. `--name` here is `--task`'s value, and is still read
  // back as `--name`'s own value. Recorded so a future "fix" is a deliberate behavior change, not a
  // silent one.
  assert.equal(flagValue(["--task", "--name", "x"], "--name"), "x");
});

test("flagValue: does NOT accept the `--flag=value` spelling (the copies did not either)", () => {
  assert.equal(flagValue(["--task=GAP-1"], "--task"), undefined);
});

test("CONTROL: an empty-string value reads as `\"\"`, and is NOT indistinguishable from absent", () => {
  // The decision under test. The majority form returned `""`; the falsy form
  // (`idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined`) returned `undefined`. We kept the
  // majority, because the falsy form makes a value the caller DID pass read as "not given", after
  // which `?? default` silently substitutes the default (硬规则 3b).
  assert.equal(flagValue(["--task", ""], "--task"), "");

  // The retired predicate, spelled out here so the two are provably NON-interchangeable on this
  // input — i.e. this test would fail if the extraction had silently picked the other copy as base.
  const retiredFalsyForm = (argv, name) => {
    const idx = argv.indexOf(name);
    return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
  };
  assert.equal(retiredFalsyForm(["--task", ""], "--task"), undefined);

  // ... and they AGREE everywhere else (empty argv / absent flag), so the divergence is exactly one
  // input wide and cannot be hiding a second one.
  for (const argv of [[], ["--task"], ["--task", "GAP-1"], ["--other", ""]]) {
    assert.equal(flagValue(argv, "--task"), retiredFalsyForm(argv, "--task"), `divergence beyond the empty-string input for ${JSON.stringify(argv)}`);
  }
});
