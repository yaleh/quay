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
  createSelftest,
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

/** Capture BOTH streams around fn — the selftest harness splits PASS (stdout) from FAIL (stderr). */
function captureBoth(fn) {
  const so = process.stdout.write;
  const se = process.stderr.write;
  const out = [];
  const err = [];
  process.stdout.write = (c) => { out.push(c); return true; };
  process.stderr.write = (c) => { err.push(c); return true; };
  try {
    return { value: fn(), out: () => out.join(""), err: () => err.join("") };
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
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

// ── createSelftest ──────────────────────────────────────────────────────────────────────────────────
// The harness that replaced the 24 hand-written per-gate copies
// (semantic-dedup-scan finding `check-harness-three-incompatible-shapes`). Every assertion below is a
// VERBATIM output contract, because those outputs are what the copies produced and at least one is
// asserted by another test in the suite — a "cleaner" re-wording here would silently change a gate's
// published output. `flavor` names the observed spellings; it is a census, not a preference knob.

test("createSelftest flavor=counters: pass is silent, fail prints to STDERR, summary to STDOUT", () => {
  const st = createSelftest({ flavor: "counters", label: "demo-check" });
  const good = captureBoth(() => st.check("a-ok", true, "detail-that-passes-is-not-printed"));
  assert.equal(good.out(), "", "counters: a passing case prints nothing");
  assert.equal(good.err(), "");
  const bad = captureBoth(() => st.check("b-bad", false, "why"));
  assert.equal(bad.out(), "", "counters: FAIL goes to stderr, not stdout");
  assert.equal(bad.err(), "FAIL: b-bad — why\n");
  assert.deepEqual([st.pass, st.fail], [1, 1]);
  const rep = captureBoth(() => st.report());
  assert.equal(rep.value, false, "verdict is fail===0");
  assert.equal(rep.out(), "\ndemo-check --selftest: 1 passed, 1 failed\n");
  assert.equal(rep.err(), "", "the summary is a stdout line even when the verdict is fail");
});

test("createSelftest flavor=counters: an OMITTED detail renders as a bare FAIL line (no ' — ' suffix)", () => {
  const st = createSelftest({ flavor: "counters", label: "demo-check" });
  const { err } = captureBoth(() => st.check("no-detail", false));
  assert.equal(err(), "FAIL: no-detail\n");
});

test("createSelftest flavor=cases: PASS on stdout, FAIL on stderr, '\\nSELFTEST: …' summary on stdout", () => {
  const st = createSelftest({ flavor: "cases" });
  const good = captureBoth(() => st.check("g", true, "because"));
  assert.equal(good.out(), "SELFTEST PASS: g — because\n");
  assert.equal(good.err(), "");
  const bad = captureBoth(() => st.check("f", false, "nope"));
  assert.equal(bad.out(), "", "cases: a failing case does not also print a PASS line");
  assert.equal(bad.err(), "SELFTEST FAIL: f — nope\n");
  assert.equal(st.allPassed, false);
  const rep = captureBoth(() => st.report());
  assert.equal(rep.value, false);
  assert.equal(rep.out(), "\nSELFTEST: SOME FIXTURES FAILED\n");
});

test("createSelftest flavor=cases: the all-pass summary spelling is 'all fixture cases PASS'", () => {
  const st = createSelftest({ flavor: "cases" });
  st.check("g", true, "");
  const rep = captureBoth(() => st.report());
  assert.equal(rep.value, true);
  assert.equal(rep.out(), "\nSELFTEST: all fixture cases PASS\n");
});

test("createSelftest flavor=cases-period: summary carries the period AND the fail sentence goes to STDERR", () => {
  // external-dogfooding-check.ts / drivable-workspace-check.ts spell it this way, and
  // plugin/test/external-dogfooding-check.test.mjs matches /SELFTEST: all fixture cases PASS\./ —
  // so the period is load-bearing, not cosmetic.
  const pass = createSelftest({ flavor: "cases-period" });
  pass.check("g", true, "");
  const p = captureBoth(() => pass.report());
  assert.equal(p.value, true);
  assert.equal(p.out(), "SELFTEST: all fixture cases PASS.\n");

  const fail = createSelftest({ flavor: "cases-period" });
  fail.check("f", false, "x");
  const f = captureBoth(() => fail.report());
  assert.equal(f.value, false);
  assert.equal(f.out(), "", "cases-period: the fail sentence is NOT on stdout");
  assert.equal(f.err(), "SELFTEST: one or more fixture cases FAILED.\n");
});

test("createSelftest collectFailures/dumpFailuresJson: {name,detail} accumulated and dumped only on fail", () => {
  const st = createSelftest({ flavor: "cases", collectFailures: true, dumpFailuresJson: true });
  st.check("ok", true, "");
  st.check("bad-1", false, "first");
  st.check("bad-2", false, "second");
  assert.deepEqual(st.failures, [{ name: "bad-1", detail: "first" }, { name: "bad-2", detail: "second" }]);
  const rep = captureBoth(() => st.report());
  assert.equal(rep.value, false);
  assert.equal(
    rep.out(),
    "\nSELFTEST: SOME FIXTURES FAILED\n" + JSON.stringify({ ok: false, failures: [{ name: "bad-1", detail: "first" }, { name: "bad-2", detail: "second" }] }) + "\n",
  );

  const clean = createSelftest({ flavor: "cases", collectFailures: true, dumpFailuresJson: true });
  clean.check("ok", true, "");
  const c = captureBoth(() => clean.report());
  assert.equal(c.value, true);
  assert.equal(c.out(), "\nSELFTEST: all fixture cases PASS\n", "no JSON line when everything passed");
  assert.deepEqual(clean.failures, []);
});

// CONTROL — the one input where the retired copies DISAGREED. Two of the three shapes rendered an
// omitted `detail` differently: "cases" printed the literal `undefined` (the interpolated value of a
// missing argument), "counters" printed no suffix at all. A harness that "tidied" this into one
// spelling would change the published output of whichever shape it did not come from, so the two are
// asserted to be provably NON-interchangeable on this input and identical everywhere else.
test("CONTROL: an omitted detail is NOT a shared spelling — 'cases' says undefined, 'counters' says nothing", () => {
  const cases = createSelftest({ flavor: "cases" });
  const c = captureBoth(() => cases.check("omitted", false));
  const counters = createSelftest({ flavor: "counters", label: "demo" });
  const k = captureBoth(() => counters.check("omitted", false));
  assert.equal(c.err(), "SELFTEST FAIL: omitted — undefined\n");
  assert.equal(k.err(), "FAIL: omitted\n");
  assert.notEqual(c.err(), k.err(), "the two shapes must stay distinguishable on an omitted detail");
  // …and on a PRESENT detail the same input produces each shape's own (also different) spelling —
  // the divergence is in the prefix, not in the detail handling alone.
  const c2 = createSelftest({ flavor: "cases" });
  const c2o = captureBoth(() => c2.check("present", false, "d"));
  const k2 = createSelftest({ flavor: "counters", label: "demo" });
  const k2o = captureBoth(() => k2.check("present", false, "d"));
  assert.equal(c2o.err(), "SELFTEST FAIL: present — d\n");
  assert.equal(k2o.err(), "FAIL: present — d\n");
});

test("createSelftest: the verdict is a function of the INPUT, not the harness (RED control)", () => {
  // A harness whose verdict is constant would be structurally incapable of taking a false value
  // (hard rule 4). Both directions are asserted on the SAME harness instance shape.
  const failing = createSelftest({ flavor: "cases" });
  failing.check("x", false, "");
  assert.equal(captureBoth(() => failing.report()).value, false);
  const passing = createSelftest({ flavor: "cases" });
  passing.check("x", true, "");
  assert.equal(captureBoth(() => passing.report()).value, true);
});
