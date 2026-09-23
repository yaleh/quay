// @test-group engine
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-09-20 child-spawn (spawns the checker-mutation entry once per case; hermetic temp fixture roots, no network)
// checker-mutation-check-characterization.test.mjs — gap-arch-tsify-checker-mutation-check-sh
// (SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §5 Phase 5.2).
//
// WHAT THIS FILE IS. A CHARACTERIZATION test, not a feature test. It pins the INPUT→OUTPUT contract
// of plugin/scripts/checker-mutation-check.sh (490 code lines) so that moving the program into
// TypeScript is a MECHANICALLY CHECKED equivalence instead of a rewrite nobody can diff. It is
// written and committed BEFORE the rewrite (AC1), and it stays green AFTER it — the rewrite target is
// still reached through the same `checker-mutation-check.sh` entry, so the same inputs must still
// produce the same outputs.
//
// WHY THE CONTRACT IS THE CASE-SCRIPT EXIT-CODE VOCABULARY. This script is the L_S instrument: the
// thing it exists to prove is that a checker goes RED under the defect it claims to catch. That proof
// travels through exactly one channel — the case script's exit code, mapped to
// pass / stayed-green / always-red / error (0 / 3 / 4 / 2). If a rewrite changed that mapping, the
// whole 「能取假」 guarantee would fail silently and in the SAME shape as 「一切正常」 (hard rule 3b).
// So this file drives a fixture root whose case files exit 0, 3, 4 and 2 and pins what the tool
// reports for each — the mapping is the contract.
//
// CAN THIS FILE TAKE FALSE? Yes — measured, not asserted (AC1's 取假 half). Injecting a single
// criterion change into the UNCHANGED bash (the `3) res="stayed-green"` arm rewritten so a
// mutation-that-stayed-green is classified `pass`) reddens the fixture assertions below; reverting
// restores green. Both runs are in the task Evidence.
//
// THE FIXTURE IS A HERMETIC ROOT, AND THE REAL TREE IS ALSO JUDGED. The fixture root is a temp dir
// carrying a minimal `run_static_checks()` registry plus one case file per verdict; it makes the
// vocabulary assertable without depending on any real checker's cost or current verdict. Two further
// blocks judge the REAL tree: the parsed manifest (AC1b: names + coverage + the "never hand-written"
// banner) and a real narrowed run through the shipped entry.
//
// ⛔ A MALFORMED CASE FILE IS THE ONE PLACE THE TWO IMPLEMENTATIONS DIVERGE, ON PURPOSE. The bash fed
// it to `bash` anyway: the parse error exits 2, the tool reports `error` and exits 1. The TypeScript
// implementation refuses to RUN a file it cannot parse (`bash -n`), reports `not-evaluated`, sets
// `evaluated:false` and exits 2. The assertions below therefore split into (a) the invariant BOTH
// must satisfy — never `pass`, never exit 0 — and (b) the strict post-rewrite value, asserted only
// when the implementation carries the wider vocabulary (the `evaluated` field). Both halves are real
// assertions; neither is a snapshot of "whatever it currently prints".
//
// Run:
//   scripts/test.sh plugin/test/checker-mutation-check-characterization.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "checker-mutation-check.sh");

// ── the script under test ───────────────────────────────────────────────────────────────────────────
// Default = the shipped ENTRY (`checker-mutation-check.sh`), which is what every caller in the tree
// invokes — before the rewrite it IS the implementation, after it is the thin wrapper around the TS.
// `CMC_UNDER_TEST` / `CMC_RUNNER` exist so the SAME assertions can be pointed at the pre-rewrite bash
// (the AC2 differential table, and the AC1 取假 run) ⛔ without a second copy of them.
const CMC_UNDER_TEST = process.env.CMC_UNDER_TEST ? path.resolve(process.env.CMC_UNDER_TEST) : DEFAULT_SCRIPT;
const CMC_RUNNER = process.env.CMC_RUNNER || (CMC_UNDER_TEST.endsWith(".ts") ? "node" : "bash");

function cmc(args, opts = {}) {
  const argv =
    CMC_RUNNER === "bash" ? [CMC_UNDER_TEST, ...args] : ["--experimental-strip-types", CMC_UNDER_TEST, ...args];
  return spawnSync(CMC_RUNNER === "bash" ? "bash" : "node", argv, { encoding: "utf8", timeout: 120_000, ...opts });
}

function cmcJson(args) {
  const r = cmc(args);
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`expected JSON stdout for ${args.join(" ")}; got: ${JSON.stringify(r.stdout)} stderr: ${r.stderr}`);
  }
  return { ...r, json };
}

// Temp-dir lifecycle: the carrier array + `after()` pattern (the house form — `tmp-leak-pairing-check`
// and `test-isolation-check` both judge this file, and a `process.on("exit")` teardown reads to them
// as NO cleanup at all).
const TEMP_ROOTS = [];
after(() => {
  for (const d of TEMP_ROOTS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});
function tempRoot(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_ROOTS.push(d);
  return d;
}

// ── the fixture root: a registry plus one case file per verdict ──────────────────────────────────────

const FAKE_CHECKERS = ["fake-pass", "fake-stayed-green", "fake-always-red", "fake-error"];

/** Build a hermetic repo root carrying a minimal parsed manifest and one case file per exit code.
 *  `extra` adds further case files by name → contents (used by the malformed/comment-only cases). */
function makeFixtureRoot({ extra = {}, register = FAKE_CHECKERS } = {}) {
  const root = tempRoot("cmc-char-");
  fs.mkdirSync(path.join(root, "plugin", "scripts", "checker-mutation-cases"), { recursive: true });
  const body = register.map((n) => `  run_checker "${n}" bash "\${repo_root}/plugin/scripts/${n}.sh" --check`).join("\n");
  fs.writeFileSync(
    path.join(root, "plugin", "scripts", "runner-static-gate.ts"),
    `#!/usr/bin/env bash\nrun_static_checks() {\n${body}\n}\n`,
  );
  const cases = {
    "fake-pass": 0,
    "fake-stayed-green": 3,
    "fake-always-red": 4,
    "fake-error": 2,
  };
  for (const [name, code] of Object.entries(cases)) {
    fs.writeFileSync(
      path.join(root, "plugin", "scripts", "checker-mutation-cases", `${name}.sh`),
      `#!/usr/bin/env bash\n# fixture case: always exits ${code}\nexit ${code}\n`,
    );
  }
  for (const [name, contents] of Object.entries(extra)) {
    fs.writeFileSync(path.join(root, "plugin", "scripts", "checker-mutation-cases", `${name}.sh`), contents);
  }
  return root;
}

/** The malformed case: `if` without `then`/`fi` — `bash` cannot even parse it. */
const MALFORMED_CASE = '#!/usr/bin/env bash\n# MALFORMED on purpose: the `if` never closes\nif [ "$1" = "x" ; then\n  echo hello\n';
/** A case file that parses fine and does nothing — exit 0 with no evidence of anything. */
const COMMENT_ONLY_CASE = "#!/usr/bin/env bash\n# this case file carries no code at all\n";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC2 (fixture half): the verdict vocabulary — one assertion per case-script exit code
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("verdict vocabulary: exit 0 → pass, 3 → stayed-green, 4 → always-red, 2 → error", () => {
  const root = makeFixtureRoot();
  const r = cmcJson(["--repo-root", root, "--run", "--json"]);
  const res = r.json.results;
  assert.equal(res["fake-pass"], "pass", "exit 0 must be reported as pass");
  assert.equal(res["fake-stayed-green"], "stayed-green", "exit 3 (defect present, checker still green) must be a FINDING, never a pass");
  assert.equal(res["fake-always-red"], "always-red", "exit 4 (restore still red) must be reported as always-red");
  assert.equal(res["fake-error"], "error", "exit 2 (case could not run) must be reported as error");
  // The counters travel with the verdicts, not separately from them.
  assert.equal(r.json.mutations_that_stayed_green, 1);
  assert.deepEqual(r.json.stayed_green, ["fake-stayed-green"]);
  assert.equal(r.json.mutations_that_always_red, 1);
  assert.deepEqual(r.json.always_red, ["fake-always-red"]);
  assert.equal(r.json.errors, 1);
  assert.deepEqual(r.json.error_names, ["fake-error"]);
  // A stayed-green / always-red / error is a violation: the gate must be non-zero.
  assert.notEqual(r.status, 0, "a fixture carrying a stayed-green case must not exit 0");
});

test("verdict vocabulary: the plain report names the stayed-green checker as THE FINDING", () => {
  const root = makeFixtureRoot();
  const r = cmc(["--repo-root", root, "--check"]);
  assert.match(r.stdout, /^MUTATION fake-stayed-green: stayed-green$/m);
  assert.match(r.stdout, /^mutations_that_stayed_green: 1$/m);
  assert.match(r.stdout, /^stayed-green \(defect present, checker still green\) — THE FINDINGS:$/m);
  assert.match(r.stdout, /^  - fake-stayed-green$/m);
  assert.match(r.stdout, /^mutations_that_always_red: 1$/m);
  assert.match(r.stdout, /^errors: 1$/m);
  assert.match(r.stdout, /^RESULT: FAIL /m);
  assert.notEqual(r.status, 0);
});

test("verdict vocabulary: an all-pass fixture exits 0 and reports uncovered = the two regression cases", () => {
  const root = makeFixtureRoot({ register: ["fake-pass"] });
  const r = cmcJson(["--repo-root", root, "--run", "--json"]);
  assert.equal(r.json.results["fake-pass"], "pass");
  assert.equal(r.json.mutations_that_stayed_green, 0);
  // The two AC5 regression cases are part of the whole-store self-check; this fixture has them
  // neither registered nor on disk, so they are reported UNCOVERED rather than silently skipped.
  assert.deepEqual(r.json.uncovered, [
    "regression-rename-negative-control-probe",
    "regression-live-telemetry-empty-activity",
  ]);
  // uncovered > 0 is a violation (a registered checker with no case can never slip through).
  assert.notEqual(r.status, 0, "an uncovered checker must fail the gate");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC3: a case file that cannot be evaluated is NEVER reported as a pass
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("AC3: a malformed case file is never reported as a pass (and the vocabulary is explicit)", () => {
  const root = makeFixtureRoot({ extra: { "fake-malformed": MALFORMED_CASE }, register: [...FAKE_CHECKERS, "fake-malformed"] });
  const r = cmcJson(["--repo-root", root, "--run", "--json"]);
  const verdict = r.json.results["fake-malformed"];
  // The INVARIANT both implementations satisfy: a file that cannot report a verdict is not a pass,
  // and the gate does not exit 0 while such a file is in the judged set.
  assert.notEqual(verdict, "pass", "an unparseable case file must never be reported as pass");
  assert.notEqual(r.status, 0, "an unevaluable case file must not leave the gate green");
  // The STRICT post-rewrite value: the wider vocabulary must be explicit and separable from `pass`
  // (hard rule 3b). Only asserted when the implementation carries it (`evaluated` is that marker).
  if (Object.prototype.hasOwnProperty.call(r.json, "evaluated")) {
    assert.equal(verdict, "not-evaluated", "the TS implementation must classify it not-evaluated");
    assert.equal(r.json.evaluated, false, "evaluated must be false when a case could not be evaluated");
    assert.deepEqual(r.json.not_evaluated, ["fake-malformed"]);
    assert.equal(r.status, 2, "the not-evaluated state exits 2 (this script's could-not-evaluate code)");
  }
});

test("AC3: a comment-only case file (parses, runs, proves nothing) is never reported as a pass", () => {
  const root = makeFixtureRoot({ extra: { "fake-noop": COMMENT_ONLY_CASE }, register: [...FAKE_CHECKERS, "fake-noop"] });
  const r = cmcJson(["--repo-root", root, "--run", "--json"]);
  const verdict = r.json.results["fake-noop"];
  if (Object.prototype.hasOwnProperty.call(r.json, "evaluated")) {
    // Post-rewrite: a case file with no code at all cannot report a verdict, so it is not one.
    assert.equal(verdict, "not-evaluated");
    assert.equal(r.status, 2);
  } else {
    // Pre-rewrite (bash): measured to report `pass` — this is the 3b hole the rewrite closes, and it
    // is recorded rather than asserted so the SAME file is green on both implementations.
    assert.equal(verdict, "pass", "the bash-classified value for a no-op case file (evidence, not a goal)");
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC1b: the manifest on the REAL tree — parsed, never hand-written
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("manifest: every registered checker has a mutation case (real tree, parsed from the registry)", () => {
  const r = cmcJson(["--list", "--json"]);
  assert.ok(r.json.checkers_total > 50, `expected the real manifest, got ${r.json.checkers_total} checkers`);
  assert.equal(r.json.checkers_with_mutation, r.json.checkers_total, "every registered checker must carry a case");
  assert.deepEqual(r.json.uncovered, []);
  for (const c of r.json.checkers) {
    assert.ok(c.source.includes("run_static_checks") || c.source.includes("ci"), `checker ${c.name} must carry a parsed source`);
    assert.equal(c.covered, true);
  }
  // This script is itself registered (its own mutation case is the meta-selfcheck).
  assert.ok(r.json.checkers.some((c) => c.name === "checker-mutation-check"));
});

test("manifest: the plain listing states the parse provenance and reports no uncovered checker", () => {
  const r = cmc(["--list"]);
  assert.match(r.stdout, /^checkers_total: \d+ \(parsed from run_static_checks \+ run_operational_checks \+ run_doc_checks \+ CI, never hand-written\)$/m);
  assert.match(r.stdout, /^uncovered: none$/m);
  assert.equal(r.status, 0);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC1 §manifest-is-parsed: a checker added to the registry appears without any edit to this script
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("manifest negative control: a checker added to run_static_checks appears in the manifest", () => {
  const root = makeFixtureRoot({ register: ["fake-pass", "fake-added-later"] });
  fs.writeFileSync(
    path.join(root, "plugin", "scripts", "checker-mutation-cases", "fake-added-later.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  const r = cmcJson(["--repo-root", root, "--list", "--json"]);
  const names = r.json.checkers.map((c) => c.name);
  assert.deepEqual(names, ["fake-added-later", "fake-pass"], "the manifest is the parsed registry, in sorted order");
  assert.equal(r.json.checkers_with_mutation, 2);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// Narrowing (--only) and the delta mode (--check-changed)
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("--only narrows the run, says so loudly, and excludes the regression cases by construction", () => {
  const root = makeFixtureRoot();
  const r = cmcJson(["--repo-root", root, "--run", "--json", "--only", "fake-pass"]);
  assert.deepEqual(r.json.checkers_executed, ["fake-pass"]);
  assert.deepEqual(r.json.only, ["fake-pass"]);
  assert.deepEqual(Object.keys(r.json.results), ["fake-pass"]);
  assert.equal(r.json.mutations_that_stayed_green, 0);
  assert.equal(r.status, 0, "a narrowed run with a behaving case exits 0");
});

test("--only with an unregistered name is a usage error, never a silent no-op", () => {
  const root = makeFixtureRoot();
  const r = cmc(["--repo-root", root, "--check", "--only", "no-such-checker"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--only names an unregistered checker: no-such-checker/);
});

test("--check-changed on a non-git root is NOT-EVALUATED with exit 0 (scoped-runner safe)", () => {
  const root = makeFixtureRoot();
  const r = cmc(["--repo-root", root, "--check-changed"]);
  assert.match(r.stdout, /NOT-EVALUATED .*no delta base/);
  assert.equal(r.status, 0, "NOT-EVALUATED must not abort an innocent scoped run");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// AC4: the mechanism mutates itself — breaking any of its three core behaviors must fail it
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("AC4: --selftest breaks the parser / the case loop / the RED arm and the gate fails each time", () => {
  const root = makeFixtureRoot();
  const r = cmc(["--repo-root", root, "--selftest"]);
  assert.match(r.stdout, /^PASS: empty-manifest injection fails the gate$/m);
  assert.match(r.stdout, /^PASS: skip-cases injection fails the gate$/m);
  assert.match(r.stdout, /^PASS: invert-red injection fails the gate$/m);
  assert.match(r.stdout, /--selftest: ALL PASS$/m);
  assert.equal(r.status, 0);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// The real tree, narrowed: the shipped entry drives a real checker's real case to a real verdict
// ════════════════════════════════════════════════════════════════════════════════════════════════════

test("real tree: the shipped entry runs this script's own mutation case to a pass", () => {
  const r = cmcJson(["--run", "--json", "--only", "checker-mutation-check"]);
  assert.equal(r.json.results["checker-mutation-check"], "pass", "the meta-selfcheck case must behave");
  assert.equal(r.json.mutations_that_stayed_green, 0);
  assert.equal(r.json.errors, 0);
  assert.equal(r.status, 0);
});

// ── @test-group engine / node:test (the policy this file must satisfy) ──────────────────────────────

test("this file declares @test-group engine and imports node:test", () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.match(src, /\/\/ @test-group engine/);
  assert.match(src, /import \{[^}]*test[^}]*\} from "node:test"/);
});
