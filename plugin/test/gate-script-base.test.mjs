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
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  emitPass,
  emitFail,
  emitNotEvaluated,
  emitVerdict,
  verdictExitCode,
  VERDICT_EXIT_CODE,
  flagValue,
  resolveRoot,
  createSelftest,
  readJsonLines,
  readJsonlLines,
} from "../scripts/gate-script-base.ts";

/** plugin/scripts — derived from THIS file's location so the source-scan control below cannot drift. */
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts");

/** The plugin/scripts TypeScript sources the two source-scan ratchets below read. */
function scriptTsFiles() {
  return fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts"));
}
function sourceOf(rel) {
  return fs.readFileSync(path.join(SCRIPTS_DIR, rel), "utf8");
}

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

// ── resolveRoot ─────────────────────────────────────────────────────────────────────────────────────
// The extraction under task gap-routine-semantic-dedup-scan-resolveroot (semantic-dedup-scan finding
// `resolveroot`, runId `semantic-dedup-scan-1790028867335`, verdict `real-duplication`): five checkers
// carried this byte-identical body. These tests pin the RESOLUTION RULE (not just "it compiles"),
// because the rule is what the five call sites inherited and must keep.

test("resolveRoot: absent flag ⇒ cwd, absolute", () => {
  assert.equal(resolveRoot(undefined), path.resolve(process.cwd()));
  assert.ok(path.isAbsolute(resolveRoot(undefined)));
});

test("resolveRoot: a RELATIVE value resolves against cwd, NOT against this module's directory", () => {
  // The decision this export encodes. A checker invoked from anywhere with `--root .` must land on
  // the caller's cwd; if the helper had used its own module dir (the `repoRoot()` convention) the
  // five call sites would silently scan plugin/scripts instead of the tree the user named.
  const got = resolveRoot(".");
  assert.equal(got, path.resolve(process.cwd()));
  assert.notEqual(got, SCRIPTS_DIR);
  assert.equal(resolveRoot("sub/dir"), path.resolve(process.cwd(), "sub/dir"));
});

test("resolveRoot: an ABSOLUTE value is returned as-is", () => {
  assert.equal(resolveRoot("/tmp/some/root"), path.resolve("/tmp/some/root"));
});

test("resolveRoot: an EMPTY-STRING value resolves to cwd (the 3b hazard flagValue documents is inert here)", () => {
  // `flagValue(args, "--root")` returns `""` (not undefined) when invoked as `--root ""`. That value
  // reaches `rootArg ?? cwd` unchanged — `??` falls back only on null/undefined — so the resolution is
  // `path.resolve("")`, which IS cwd. No silent-substitution defect, but recorded so it is a known
  // reading rather than an accident.
  assert.equal(resolveRoot(""), path.resolve(process.cwd()));
});

test("resolveRoot: the extracted body lives in the base ONLY — the five callers carry no private copy", () => {
  // The mechanical statement of the finding, kept as a regression guard: if a caller re-inlines the
  // body (or a sixth appears), this goes RED instead of quietly regrowing the duplication the routine
  // filed. The predicate is positional (the exact statement text), so a comment mentioning it does not
  // count.
  const BODY = "return path.resolve(rootArg ?? process.cwd());";
  const callers = [
    "concurrency-literal-check.ts",
    "instrument-failure-check.ts",
    "landing-target-check.ts",
    "suite-slot-ssot-check.ts",
    "task-file-bypass-check.ts",
  ];

  const hits = (file) => fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() === BODY).length;

  for (const caller of callers) {
    assert.equal(hits(path.join(SCRIPTS_DIR, caller)), 0, `${caller} re-inlined the body instead of importing resolveRoot`);
  }
  assert.equal(hits(path.join(SCRIPTS_DIR, "gate-script-base.ts")), 1, "the base must hold the body exactly once");

  // ... and each caller must actually IMPORT the shared one (a caller that merely deleted the private
  // copy without importing would still pass the count above, so this half is not redundant).
  for (const caller of callers) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, caller), "utf8");
    assert.match(src, /import \{[^}]*\bresolveRoot\b[^}]*\} from "\.\/gate-script-base\.ts"/, `${caller} does not import resolveRoot from the base`);
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

// ── readJsonLines ───────────────────────────────────────────────────────────────────────────────────
// The ledger reader extracted from SEVEN private copies, none imported (semantic-dedup-scan finding
// `readjsonlines-seven-defs-three-behaviors`, .quay/routine-findings.jsonl, runId
// `semantic-dedup-scan-1790118332027`, verdict `real-duplication`, requested action `extract`):
//   obligation-ledger.ts / obligation-ledger-check.ts / psi-failure-correlation-check.ts /
//   psi-window-join.ts / freshness-producer-coverage-check.ts / ready-pool-check.ts / trend-check.ts
// Same four-part shape as the resolveRoot guard above — single-source ratchet, negative control,
// semantics of the rule the call sites inherited, and a CONTROL pinning the ONE input where the
// retired copies disagreed.

/** The 7 modules that carried a private copy. The last two still NAME the symbol in their export
 *  surface (`export { readJsonLines }`) — a re-export, not a re-implementation; the ratchet below is
 *  what keeps that distinction honest. */
const READ_JSON_LINES_CONSUMERS = [
  "obligation-ledger.ts",
  "obligation-ledger-check.ts",
  "psi-failure-correlation-check.ts",
  "psi-window-join.ts",
  "freshness-producer-coverage-check.ts",
  "ready-pool-check.ts",
  "trend-check.ts",
];

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── single source (the ratchet — a redefinition turns this RED) ─────────────────────────────────────

test("readJsonLines: defined exactly ONCE under plugin/scripts (gate-script-base.ts)", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction readJsonLines\b/.test(sourceOf(f)));
  assert.deepEqual(
    defs,
    ["gate-script-base.ts"],
    `readJsonLines must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

// ── negative control ────────────────────────────────────────────────────────────────────────────────

test("readJsonLines: none of the 7 former carriers re-defines it, and each IMPORTS the shared one", () => {
  for (const f of READ_JSON_LINES_CONSUMERS) {
    assert.doesNotMatch(sourceOf(f), /\bfunction readJsonLines\b/, `${f} must not redefine readJsonLines`);
    // Deleting the private copy without importing the shared one would still pass the line above, so
    // this half is not redundant — it is the half that distinguishes "extracted" from "deleted".
    assert.match(
      sourceOf(f),
      /import \{[^}]*\breadJsonLines\b[^}]*\} from "\.\/gate-script-base\.ts"/,
      `${f} does not import readJsonLines from the base`,
    );
  }
});

test("readJsonLines: deleting the shared export makes a consumer import fail (the mechanism is real)", () => {
  // The "删了不红 ⇒ 假" control, same as gap-b3's: a consumer importing an ABSENT named export must
  // fail to link, and the SAME consumer must link once the export exists.
  withTempDir("readjsonlines-negctl-", (dir) => {
    fs.writeFileSync(path.join(dir, "gate-script-base.ts"), "export const OTHER = 1;\n");
    fs.writeFileSync(
      path.join(dir, "consumer.ts"),
      'import { readJsonLines } from "./gate-script-base.ts";\nconsole.log(readJsonLines);\n',
    );
    const missing = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], { cwd: dir, encoding: "utf8" });
    assert.notEqual(missing.status, 0, "a consumer importing an absent export must fail to link");

    fs.writeFileSync(path.join(dir, "gate-script-base.ts"), "export function readJsonLines() { return []; }\n");
    const present = spawnSync("node", ["--experimental-strip-types", "consumer.ts"], { cwd: dir, encoding: "utf8" });
    assert.equal(present.status, 0, "the same consumer links once the export is present");
  });
});

// ── semantics: the rule the 7 call sites now share ──────────────────────────────────────────────────

test("readJsonLines: absent / unreadable file ⇒ [] (fail-open, never a throw)", () => {
  withTempDir("readjsonlines-absent-", (dir) => {
    assert.deepEqual(readJsonLines(path.join(dir, "does-not-exist.jsonl")), []);
    // A DIRECTORY reads as EISDIR — still [] and still no throw.
    assert.deepEqual(readJsonLines(dir), []);
  });
});

test("readJsonLines: objects are returned; blank lines, malformed lines and non-object lines are skipped", () => {
  withTempDir("readjsonlines-semantics-", (dir) => {
    const file = path.join(dir, "ledger.jsonl");
    fs.writeFileSync(
      file,
      [
        '{"a":1}',
        "",
        "   ",
        '{"b":2}',
        "{oops not json",
        "42",
        '"a bare string"',
        "null",
        "true",
        "[1,2]",
        '{"c":3}',
      ].join("\n") + "\n",
    );
    assert.deepEqual(readJsonLines(file), [{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});

test("readJsonLines: a CRLF carrier yields the same rows as an LF one", () => {
  withTempDir("readjsonlines-crlf-", (dir) => {
    const lf = path.join(dir, "lf.jsonl");
    const crlf = path.join(dir, "crlf.jsonl");
    fs.writeFileSync(lf, '{"a":1}\n{"b":2}\n');
    fs.writeFileSync(crlf, '{"a":1}\r\n{"b":2}\r\n');
    assert.deepEqual(readJsonLines(crlf), readJsonLines(lf));
    assert.deepEqual(readJsonLines(crlf), [{ a: 1 }, { b: 2 }]);
  });
});

// ── CONTROL: the ONE input where the retired copies disagreed ───────────────────────────────────────

test("CONTROL: a top-level non-object line is where the retired copies diverged — and they agree everywhere else", () => {
  // The three retired behaviors, spelled out verbatim (from the 7 copies, before extraction):
  //   A: split("\n")  + NO guard                                      (4 copies)
  //   B: split(/\r?\n/) + `v && typeof v === "object"` — a TRUTHY check, so it admits ARRAYS  (2 copies)
  //   C: split("\n")  + `typeof r === "object" && r !== null && !Array.isArray(r)`  (1 copy)
  const parseWith = (text, splitRe, guard) => {
    const out = [];
    for (const line of text.split(splitRe)) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line);
        if (guard(v)) out.push(v);
      } catch {
        /* skip */
      }
    }
    return out;
  };
  const variantA = (t) => parseWith(t, "\n", () => true);
  const variantB = (t) => parseWith(t, /\r?\n/, (v) => v && typeof v === "object");
  const variantC = (t) => parseWith(t, "\n", (v) => typeof v === "object" && v !== null && !Array.isArray(v));

  // The decision under test: the canonical reader keeps C's guard, so `null`/`42`/`"x"` — which A and
  // B returned under a `Record<string, unknown>[]` return type every caller then indexes fields off —
  // are no longer rows.
  const nonObjects = "null\n42\n\"x\"\n[1,2]\ntrue\n";
  assert.deepEqual(variantA(nonObjects), [null, 42, "x", [1, 2], true], "A kept every non-object");
  assert.deepEqual(variantB(nonObjects), [[1, 2]], "B's truthy check kept the ARRAY (typeof [] === 'object')");
  assert.deepEqual(readJsonLines(fileOf(nonObjects)), [], "the canonical reader keeps none of them");
  // ...so the three are provably NON-interchangeable on this input — this test would fail if the
  // extraction had silently picked either permissive copy as the base.
  assert.notDeepEqual(variantA(nonObjects), variantB(nonObjects));
  assert.notDeepEqual(variantB(nonObjects), variantC(nonObjects));

  // ...and they AGREE on every input a real ledger writer can produce (an object per line, or a
  // corrupt/blank line), so the divergence is exactly one input wide and cannot be hiding a second.
  for (const input of [
    "",
    "\n",
    '{"a":1}\n',
    '{"a":1}\n{"b":2}\n',
    '{"a":1}\n\n{"b":2}\n',
    '{"a":1}\n{oops\n{"b":2}\n',
    '{"a":1}\r\n{"b":2}\r\n',
    '{"perFile":[1,2],"state":"red"}\n',
  ]) {
    assert.deepEqual(variantA(input), variantC(input), `A vs C diverged on ${JSON.stringify(input)}`);
    assert.deepEqual(variantB(input), variantC(input), `B vs C diverged on ${JSON.stringify(input)}`);
    assert.deepEqual(readJsonLines(fileOf(input)), variantC(input), `canonical vs C diverged on ${JSON.stringify(input)}`);
  }
});

test("CONTROL: the CRLF axis does NOT change the row set — the finding's CRLF clause does not reproduce", () => {
  // The finding's text says "a CRLF ledger yields different rows per caller". READ + MEASURED
  // 2026-09-22: that clause does NOT reproduce. `JSON.parse` treats a trailing `\r` as JSON
  // whitespace (the grammar's ws includes CR), and the blank-line test is `.trim()`-based, so both
  // split strategies return the same rows for every CRLF input. The two calls below are the direct
  // measurement; the loop is the general statement.
  assert.deepEqual(JSON.parse('{"a":1}\r'), { a: 1 }, "a trailing CR is JSON whitespace, not a parse error");
  const crlf = '{"a":1}\r\n{"b":2}\r\n';
  assert.deepEqual(parseRowsWithSplit(crlf, "\n"), parseRowsWithSplit(crlf, /\r?\n/));
  for (const text of ["", "\n", "\r\n", '{"a":1}\r\n', '{"a":1}\r\n\r\n{"b":2}\r\n', '{"a":1}\r\r\n', "42\r\n"]) {
    assert.deepEqual(
      parseRowsWithSplit(text, "\n"),
      parseRowsWithSplit(text, /\r?\n/),
      `the two split strategies diverged on ${JSON.stringify(text)} — the finding's clause would then be real`,
    );
  }
  // The canonical reader still takes the WIDER split: harmless (proved by the loop above) and it makes
  // the CRLF tolerance explicit rather than an accident of JSON.parse's whitespace rule.
  assert.deepEqual(readJsonLines(fileOf(crlf)), [{ a: 1 }, { b: 2 }]);
});

// ── readJsonlLines — the SENTINEL-PRESERVING sibling, also extracted ────────────────────────────────
// The SAME routine run that filed the finding behind the block above also emitted
// `readjsonllines-load-bearing-unparseable-sentinel` (runId semantic-dedup-scan-1790118332027) for a
// DIFFERENT symbol — `readJsonlLines` (note the extra `l`) — and then
// `byte-identical-body` (runId semantic-dedup-scan-1790592211995, verdict `real-duplication`) for its
// TWO private copies, with requested action `extract the counting variant; do NOT point both at
// readJsonLines whose fail-open form loses the malformed row`.
//
// So the disposition is: EXTRACT the pair into this same base (dedup), while keeping it a SEPARATE
// reader from `readJsonLines` (do not fold). The divergence stays load-bearing on two axes — absent
// file ⇒ `null` not `[]`; corrupt line ⇒ a `{__unparseable:true}` placeholder ROW not a skip — and
// folding the pair in would make `rows.some(r => r.__unparseable)` permanently false and silently
// pass two checkers (硬规则 3b — a judge that cannot read its input must not return the value shaped
// like "qualified").
//
// This test is the mechanical form of that boundary: the extraction is pinned as single-source +
// imported, AND the fold is pinned as forbidden. A later dedup pass that folds the pair in goes RED
// here instead of quietly disarming two checkers.

/** The two modules that carried a byte-identical private copy of `readJsonlLines`. */
const SENTINEL_READERS = ["direct-to-develop-bypass-check.ts", "fan-in-ff-protocol-check.ts"];

test("readJsonlLines: defined exactly ONCE under plugin/scripts (gate-script-base.ts)", () => {
  const defs = scriptTsFiles().filter((f) => /\bfunction readJsonlLines\b/.test(sourceOf(f)));
  assert.deepEqual(
    defs,
    ["gate-script-base.ts"],
    `readJsonlLines must have a single definition; found: ${defs.length ? defs.join(", ") : "none"}`,
  );
});

test("readJsonlLines: neither former carrier re-defines it, and each IMPORTS the shared one", () => {
  for (const f of SENTINEL_READERS) {
    const src = sourceOf(f);
    assert.doesNotMatch(src, /\bfunction readJsonlLines\b/, `${f} must not redefine readJsonlLines`);
    // Deleting the private copy without importing the shared one would still pass the line above, so
    // this half is not redundant — it is the half that distinguishes "extracted" from "deleted".
    assert.match(
      src,
      /import \{[^}]*\breadJsonlLines\b[^}]*\} from "\.\/gate-script-base\.ts"/,
      `${f} does not import readJsonlLines from the base`,
    );
    // ...and the fold is still forbidden: importing the LINE-DROPPING reader would disarm the
    // `__unparseable` branch its callers test for. (The name is a prefix of the other, so this regex
    // is what keeps the census exact.)
    assert.doesNotMatch(
      src,
      // `\b` after `readJsonLines` is what keeps this exact: it does NOT match the `readJsonlLines`
      // import the assertion above requires (`s`→`l` is not a word boundary).
      /import \{[^}]*\breadJsonLines\b[^}]*\} from "\.\/gate-script-base\.ts"/,
      `${f} must NOT be folded onto the line-dropping reader — that would disarm its unparseable check`,
    );
    // The sentinel stays consumed at the call sites (the branch the fold would kill).
    assert.match(src, /__unparseable/, `${f} must keep the __unparseable branch its callers test for`);
  }
  // ...and the two symbols are genuinely different names, which is why the census has to be exact:
  assert.notEqual("readJsonlLines", "readJsonLines");
});

test("readJsonlLines: absent / unreadable-by-absence file ⇒ null (NOT [], the deliberate divergence)", () => {
  withTempDir("readjsonllines-absent-", (dir) => {
    // The whole point of the sibling: `null` says "no carrier", `[]` (what readJsonLines gives) says
    // "carrier present but empty". The two callers branch on exactly this.
    assert.equal(readJsonlLines(path.join(dir, "does-not-exist.jsonl")), null);
    assert.notDeepEqual(readJsonlLines(path.join(dir, "does-not-exist.jsonl")), readJsonLines(path.join(dir, "does-not-exist.jsonl")));
  });
});

test("readJsonlLines: a corrupt line ⇒ a {__unparseable:true} PLACEHOLDER ROW, so row↔line counts stay comparable", () => {
  withTempDir("readjsonllines-sentinel-", (dir) => {
    const file = path.join(dir, "lock-events.jsonl");
    const lines = [
      '{"event":"acquire"}',
      "",                       // blank — skipped, by design (not a line a writer produces)
      "{oops not json",         // corrupt — the sentinel
      '{"event":"release"}',
    ];
    fs.writeFileSync(file, lines.join("\n") + "\n");
    const rows = readJsonlLines(file);
    assert.deepEqual(rows, [{ event: "acquire" }, { __unparseable: true }, { event: "release" }]);
    assert.equal(rows.some((r) => r && r.__unparseable), true, "the branch the callers test for is live");
    // THE control for this reader's reason to exist: the shared line-dropping reader returns the SAME
    // two rows with NO sentinel ⇒ `rows.some(r => r.__unparseable)` is permanently false there. That
    // is the disarm the boundary above forbids, measured rather than asserted.
    assert.deepEqual(readJsonLines(file), [{ event: "acquire" }, { event: "release" }]);
    assert.equal(readJsonLines(file).some((r) => r && r.__unparseable), false, "…and the fold would kill the branch");
  });
});

/** The retired permissive parse (no guard) — the row set a split strategy alone produces. */
function parseRowsWithSplit(text, splitRe) {
  const out = [];
  for (const line of text.split(splitRe)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Write `text` to a scratch ledger and hand back its path. ⛔ These dirs are NOT left behind: an
 *  un-removed temp dir per assertion is how /tmp accumulated thousands of stale fixture trees here. */
const SCRATCH_DIRS = [];
process.on("exit", () => {
  for (const d of SCRATCH_DIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort at exit */
    }
  }
});
function fileOf(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readjsonlines-fixture-"));
  SCRATCH_DIRS.push(dir);
  const file = path.join(dir, "ledger.jsonl");
  fs.writeFileSync(file, text);
  return file;
}
