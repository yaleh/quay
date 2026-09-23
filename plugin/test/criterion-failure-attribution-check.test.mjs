// @test-group engine
// criterion-failure-attribution-check.test.mjs — unit + CLI tests for the criterion failure-attribution
// ratchet (tasks/gap-goal-criteria-bare-failing-exit-unattributable, GOAL-009 AC-241).
//
// Split by what it proves:
//   · the pure predicate (isBareFailureExitLine / maskHashComments) — POSITION-based judgment, with the
//     comment-mention and exit(10) negative controls (硬规则 2), plus BOTH forms of failure exit: the
//     direct `exit(1)` and the trailing computed `sys.exit(0 if ok else 1)` whose argument nests parens
//     (gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit — before the widening the
//     latter read as CLEAN, which is how AC-245 reached the production ledger unattributed).
//   · the pure ratchet (checkRatchet) — shrink-only: a fix is green, an addition is red.
//   · the CLI three-state contract — 0 pass / 1 red / 3 NOT-EVALUATED, pairwise distinct (硬规则 3b),
//     and the committed baseline artifact actually gates the REAL repo at 0.
//   · AC4's取证: count on the real repo == baseline; inject a bare fixture ⇒ +1; remove ⇒ restore.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  isBareFailureExitLine,
  hasTrailingComputedFailureExit,
  implicitFailureExitLines,
  errexitAbortSilentExits,
  bareFailureExitsOfCriterion,
  isSilentOnFailureSegment,
  splitTopLevelSegments,
  statusBearingStatement,
  maskHashComments,
  maskValueStrings,
  checkRatchet,
  enumerateBareFailureExits,
  readBaseline,
} from "../scripts/criterion-failure-attribution-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin/scripts/criterion-failure-attribution-check.ts");
const BASELINE_REL = "docs/analysis/criterion-failure-attribution.baseline.json";

const tmpDirs = [];
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function runCli(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
  });
}

/** A self-contained workspace: `count` in-domain criteria each carrying one bare failure exit. */
function makeRoot(count) {
  const root = mkTmp("cfac-");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/analysis"), { recursive: true });
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(
      path.join(root, `goals/AC-9${String(i).padStart(2, "0")}-fixture.md`),
      [
        "---",
        `id: AC-9${String(i).padStart(2, "0")}`,
        "status: active",
        "kind: criterion",
        "criterion: |",
        "  python3 - <<'P'",
        "  import sys",
        "  sys.exit(1)",
        "  P",
        "---",
        "",
      ].join("\n"),
    );
  }
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    JSON.stringify({ count, inDomain: count, entries: [], generatedAt: "2026-09-11T00:00:00.000Z" }, null, 2) + "\n",
  );
  return root;
}

// ── the predicate (硬规则 2 — position, not keyword) ────────────────────────────────────────────────

test("isBareFailureExitLine: a failure exit with no cause on its line is BARE", () => {
  for (const line of [
    "  if not upgraded: sys.exit(1)",
    "      sys.exit(1)",
    "  [ -e \"$f\" ] || exit 1",
    "  sys.exit(1 if bare else 0)", // the computed form — fails with no cause on its red branch
  ]) {
    assert.equal(isBareFailureExitLine(line), true, `expected BARE: ${line}`);
  }
});

test("isBareFailureExitLine: an attribution on the same line is NOT bare", () => {
  for (const line of [
    "  if not upgraded: sys.stderr.write(\"no site\\n\"); sys.exit(1)",
    "  print('why', file=sys.stderr) or sys.exit(1)",
    "  echo 'why' >&2; exit 1",
    "  if (bad) { console.error('why'); process.exit(1); }",
  ]) {
    assert.equal(isBareFailureExitLine(line), false, `expected ATTRIBUTED: ${line}`);
  }
});

test("isBareFailureExitLine — negative control: a COMMENT mentioning `exit 1` is not a failure exit", () => {
  // The exact shape that made this checker's first run self-trip on AC-241's own rationale comment.
  assert.equal(isBareFailureExitLine('  # AC-239: acceptance failed (exit 1) — criterion wrote no output'), false);
  assert.equal(isBareFailureExitLine("  grep -q ok f || exit 1  # a trailing note is still a bare failure exit"), true, "code BEFORE the # is still real");
});

test("isBareFailureExitLine — negative control: exit(10) / exit(0) / exit(3) are not failure exits", () => {
  for (const line of ["  sys.exit(10)", "  exit 3", "  sys.exit(0)", "  raise SystemExit(0)"]) {
    assert.equal(isBareFailureExitLine(line), false, `expected NOT a bare failure exit: ${line}`);
  }
});

test("maskHashComments is quote-aware — `#` inside a quoted string is data", () => {
  assert.equal(maskHashComments("  echo 'a#b' && exit 1"), "  echo 'a#b' && exit 1");
  assert.equal(maskHashComments("  exit 1  # why"), "  exit 1  ");
});

test("isBareFailureExitLine — negative control: a quoted VALUE holding `exit 1` is DATA, not an exit (AC-243)", () => {
  // The exact line that made the ratchet report the achieved, fully-attributable AC-243 as a regression
  // and block an unrelated task from landing (2026-09-11). AC-243's own failure exits all write stderr.
  const ac243 = '   \'const r=m.runAcceptance({command:"exit 1",cwd:".",timeoutMs:10000});\'';
  assert.equal(isBareFailureExitLine(ac243), false, "a string handed to an API as an argument is not a failure exit");
  assert.equal(isBareFailureExitLine("  local cmd='exit 1'"), false, "same for a shell value assignment");
});

test("isBareFailureExitLine — positive control: the value-position mask must NOT swallow a real exit", () => {
  // The exemption for quoted strings exists for THESE shapes; a value-position mask must leave them BARE.
  assert.equal(isBareFailureExitLine('  bash -c "exit 1"'), true, "`-c` makes the string a COMMAND, not a value");
  assert.equal(isBareFailureExitLine('  python3 -c "import sys; sys.exit(1)"'), true);
  assert.equal(isBareFailureExitLine('  x="$(exit 1)"'), true, "command substitution inside a value still EXECUTES");
  assert.equal(isBareFailureExitLine("  x=`exit 1`"), true);
});

test("maskValueStrings is pure and blanks only the value-position literal", () => {
  assert.equal(maskValueStrings('a:"exit 1",b:1'), 'a:        ,b:1');
  assert.equal(maskValueStrings('k="x"'), 'k=   ');
  assert.equal(maskValueStrings('echo "exit 1"'), 'echo "exit 1"', "not in value position ⇒ untouched");
});

// ── the TRAILING COMPUTED form (AC-245's blind spot, 2026-09-12) ────────────────────────────────────
// Before this widening, `sys.exit(0 if ok else 1)` read as CLEAN: the ratchet sat at 32 while AC-245
// entered the in-domain set in exactly this form and wrote an unattributable `fail` into the production
// ledger. "I cannot read this form" and "this criterion is clean" shared one output — hard rule 3b.

const AC245_CRITERION_LINE = `  sys.exit(0 if log and str(log[-1].get("reason") or "").strip() else 1)`;

test("isBareFailureExitLine — positive control: the TRAILING COMPUTED exit is a failure exit (AC-245)", () => {
  assert.equal(isBareFailureExitLine(AC245_CRITERION_LINE), true, "AC-245's own criterion line, verbatim");
  // The nested-paren requirement, stated as its own case: a pure regex cannot count to this `else`.
  assert.equal(isBareFailureExitLine('  sys.exit(0 if f(g(x), h(y) or []) else 1)'), true);
  assert.equal(isBareFailureExitLine("  sys.exit(0 if len(ok)>=1 else 1)"), true);
  assert.equal(isBareFailureExitLine("  sys.exit(0 if a else 2)"), true, "any non-zero tail, not just 1");
  assert.equal(hasTrailingComputedFailureExit(AC245_CRITERION_LINE.trim()), true, "the pure predicate agrees");
});

test("isBareFailureExitLine — negative control: the trailing-computed form's UNMATCHED tails", () => {
  assert.equal(isBareFailureExitLine("  sys.exit(0 if ok else 0)"), false, "always-0 never fails ⇒ must NOT be bare");
  assert.equal(isBareFailureExitLine("  sys.exit(0) if ok else 1"), false, "the `)` closes the call: `else 1` is NOT its argument");
  assert.equal(isBareFailureExitLine('  r=m.runAcceptance({command:"x else 1",cwd:".",timeoutMs:60000})'), false, "value-position string is DATA");
  assert.equal(isBareFailureExitLine('  cmd="sys.exit(0 if a else 1)"'), false, "same, via `=`");
});

test("isBareFailureExitLine — negative control: an attribution on the trailing-computed LINE clears it", () => {
  assert.equal(isBareFailureExitLine('  if not ok: sys.stderr.write("CAUSE=x\\n"); sys.exit(0 if ok else 1)'), false);
  assert.equal(isBareFailureExitLine("  [ -n \"$x\" ] || { echo why >&2; exit 1; }"), false, "`>&2` marks attribution");
});

test("isBareFailureExitLine — position control: the computed form in value position is still NOT masked out of a real exit", () => {
  // The value mask must not swallow a command substitution — the same rule the direct forms obey.
  assert.equal(isBareFailureExitLine('  x="$(sys.exit(0 if a else 1))"'), true);
});

// ── the IMPLICIT-EXIT class (2026-09-12, gap-criterion-attribution-blind-to-silent-terminal-command) ─
// The third form, and the one BOTH earlier revisions could not see: a criterion with NO exit statement
// at all, whose non-zero status is inherited from a trailing command. Every rule above asks a question
// ABOUT an exit statement ("does this exit line carry a cause?"), so this form matched nothing on every
// line ⇒ never enumerated ⇒ never baselined ⇒ the ratchet read 31 ≤ 32 / status=pass / exit 0 while the
// AC it guards (AC-241) was red in the production ledger. Measured on develop 2026-09-12: 13 in-domain
// criteria, each exiting 1 with ZERO bytes on both streams when false.

/** AC-172's criterion VERBATIM, before the 2026-09-12 rewrite: no `exit` anywhere; the trailing
 *  `grep -q` IS the failure exit (exit 1, and `-q` guarantees it writes nothing). */
const AC172_ORIGINAL_CRITERION = `node packages/quay/src/goal-store.ts list --status draft | grep -q '"id": "GOAL-'`;

test("implicitFailureExitLines — positive control: AC-172's ORIGINAL form is a failure exit (the blind spot)", () => {
  const hits = implicitFailureExitLines(AC172_ORIGINAL_CRITERION);
  assert.equal(hits.length, 1, `the trailing silent `+"`grep -q`"+` is the failure exit: ${JSON.stringify(hits)}`);
  assert.equal(hits[0].implicit, true);
  assert.equal(hits[0].line, 1);
});

test("implicitFailureExitLines — positive control: every shape the 2026-09-12 enumeration found", () => {
  const shapes = {
    "trailing grep -q through a pipe": "node x.ts | grep -q 'GOAL-001'",
    "trailing test": `test "$(node x.ts list | grep -c '"id": "AC-1[4-6][0-9]"')" -ge 27`,
    "trailing [": `[ "$(grep -l '^goal_ac:' tasks/*.md | wc -l)" -ge 3 ]`,
    "&& left of a NON-silent right branch": "test -f plugin/scripts/checker.ts && node plugin/scripts/checker.ts --json",
    "test -s && test": `test -s .quay/r.jsonl && test "$(grep -c v .quay/r.jsonl)" -ge 3`,
    "whole command to /dev/null": "node packages/quay/src/goal-store.ts get GOAL-001 >/dev/null 2>&1",
    "&> /dev/null": "node x.ts get GOAL-001 &>/dev/null",
    "an && chain of greps": "grep -qE 'a' f && grep -qE 'b' f",
  };
  for (const [name, criterion] of Object.entries(shapes)) {
    assert.ok(implicitFailureExitLines(criterion).length >= 1, `expected an implicit failure exit: ${name}`);
  }
});

test("implicitFailureExitLines — negative control: forms whose failure DOES write, or that cannot fail", () => {
  // A trailing command that writes on failure: its own error text is the cause ⇒ attributable.
  assert.deepEqual(implicitFailureExitLines("node --test plugin/test/x.test.mjs"), []);
  // `||` REMEDIATES: the silent predicate's failure is handled by the branch that writes the cause.
  assert.deepEqual(implicitFailureExitLines("grep -q X f || { echo CAUSE=missing >&2; exit 1; }"), []);
  // a value-position string is DATA (masked out by maskValueStrings), and it is not a shell command
  assert.deepEqual(implicitFailureExitLines('const r=m.runAcceptance({command:"exit 1",cwd:".",timeoutMs:1});'), []);
  // a bare trailing `exit 0` determines the status explicitly — nothing is inherited
  assert.deepEqual(implicitFailureExitLines("grep -q X f\nexit 0"), []);
  // a trailing assignment/comparison in a language runtime writes nothing on ITS failure path either,
  // but it is not in the silent-command class — over-reporting here is not free, so it is out
  assert.deepEqual(implicitFailureExitLines("python3 -c 'raise SystemExit(1)'"), []);
});

test("implicitFailureExitLines — the class is DISJOINT from the explicit forms (no double count)", () => {
  // An explicit (even attributed) failure exit anywhere ⇒ the inherited-status question is not asked.
  assert.deepEqual(implicitFailureExitLines('grep -q X f\necho CAUSE=x >&2\nexit 1'), []);
  assert.deepEqual(implicitFailureExitLines("sys.exit(1)"), []);
  assert.deepEqual(implicitFailureExitLines(AC245_CRITERION_LINE), []);
});

// ── THE ERREXIT-ABORT CLASS (2026-09-21, gap-ac241-errexit-abort-silent-failures-have-no-predicate) ──
// The SIXTH recurrence of AC-241. The five repairs before it all covered "the failure exit STATEMENT
// itself is silent"; this class is "the failure exit statements are all attributed, and the shell dies
// on a NON-exit statement before reaching them". Measured in the production ledger 2026-09-20T23:50:57Z:
// AC-286 carries three attributed `CAUSE=…` exits and still wrote ZERO bytes on both streams.

/** AC-286's criterion VERBATIM as it stood when it went red (the anchor is the pre-fix one; the shape is
 *  what matters — `set -euo pipefail` + an UNGUARDED assignment-with-command-substitution + attributed
 *  guards below it). */
const AC286_RED_CRITERION = [
  "bash <<'CRIT'",
  "set -euo pipefail",
  'SRC="plugin/scripts/worker-driver.ts"',
  'if [ ! -f "$SRC" ]; then',
  '  echo "CAUSE=source-absent" >&2; exit 1',
  "fi",
  "LINE=\"$(grep -nE 'const[[:space:]]+mergeTarget' \"$SRC\" | head -1)\"",
  'if [ -z "$LINE" ]; then',
  '  echo "CAUSE=default-assignment-not-found" >&2; exit 1',
  "fi",
  "CRIT",
].join("\n");

test("errexitAbortSilentExits — positive control: AC-286's RED form is a failure exit (the 6th blind spot)", () => {
  const hits = errexitAbortSilentExits(AC286_RED_CRITERION);
  assert.equal(hits.length, 1, `exactly the unguarded assignment: ${JSON.stringify(hits)}`);
  assert.equal(hits[0].line, 7, "…named by the LINE that aborts");
  assert.equal(hits[0].errexitAbort, true, "…and marked as the errexit class (a THIRD repair, not 'write a cause here')");
  // ⛔ It is INVISIBLE to the two older classes — that is the whole defect, pinned as a reading.
  assert.deepEqual(implicitFailureExitLines(AC286_RED_CRITERION), [], "class ② cannot see it (an explicit exit exists)");
  assert.equal(
    AC286_RED_CRITERION.split("\n").filter((l) => isBareFailureExitLine(l)).length,
    0,
    "class ① cannot see it either — the assignment contains no exit statement",
  );
});

test("errexitAbortSilentExits — the class is ADDITIVE: it fires although every exit is attributed", () => {
  // The previous five repairs all held while AC-241 stayed red BECAUSE class ② lives behind
  // `out.length === 0`. The third class must not inherit that mutex.
  const bare = bareFailureExitsOfCriterion(AC286_RED_CRITERION);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].errexitAbort, true);
});

test("errexitAbortSilentExits — negative controls: the GUARDED and NON-errexit forms are clean", () => {
  const clean = [
    // `|| true` INSIDE the substitution — measured: exit 0, the guard runs
    "set -euo pipefail\nLINE=\"$(grep -nE 'p' \"$f\" | head -1 || true)\"\nif [ -z \"$LINE\" ]; then echo CAUSE=x >&2; exit 1; fi",
    // `|| true` AFTER the assignment — measured: exit 0
    "set -euo pipefail\nLINE=\"$(grep -nE 'p' \"$f\" | head -1)\" || true\nif [ -z \"$LINE\" ]; then echo CAUSE=x >&2; exit 1; fi",
    // a CONDITION — POSIX exempts it from errexit, which is why this is the correct repair
    "set -euo pipefail\nif ! LINE=$(grep -nE 'p' \"$f\"); then echo CAUSE=x >&2; exit 1; fi",
    // no errexit at all
    "LINE=\"$(grep -nE 'p' \"$f\" | head -1)\"\nif [ -z \"$LINE\" ]; then echo CAUSE=x >&2; exit 1; fi",
    // substitution NOT in value position: the statement's status is `echo`'s
    "set -euo pipefail\necho \"$(grep -nE 'p' \"$f\" | head -1)\"",
    // a plain assignment cannot fail this way
    'set -euo pipefail\nSRC="plugin/scripts/worker-fan-in.ts"\nexit 0',
  ];
  for (const c of clean) {
    assert.deepEqual(errexitAbortSilentExits(c), [], `must be CLEAN (a false positive accuses a clean criterion): ${c}`);
  }
});

test("errexitAbortSilentExits — the errexit STATE MACHINE: `set +e` really disables, and only from its line on", () => {
  assert.deepEqual(errexitAbortSilentExits("set -e\nset +e\nLINE=\"$(cmd)\""), [], "`set +e` turns the class off");
  assert.equal(errexitAbortSilentExits("set -e\nset +e\nset -e\nLINE=\"$(cmd)\"").length, 1, "…and `set -e` turns it back on");
  assert.equal(errexitAbortSilentExits("set -o errexit\nLINE=\"$(cmd)\"").length, 1, "the long form counts too");
  assert.deepEqual(errexitAbortSilentExits("set -o pipefail\nset -u\nLINE=\"$(cmd)\""), [], "`set -o pipefail` alone is NOT errexit");
  assert.deepEqual(errexitAbortSilentExits("set -o errexit\nset +o errexit\nLINE=\"$(cmd)\""), [], "`set +o errexit` disables");
});

test("errexitAbortSilentExits — a guard on a LATER line of a MULTI-LINE statement is still seen", () => {
  // Read per PHYSICAL line, the guarded form below would read BARE — a detector accusing a clean
  // criterion (硬规则 3b). The statement is joined before its guards are judged.
  const guardedMulti = 'set -euo pipefail\nLINE="$(grep -nE\n\'p\'\n"$f" | head -1 || true)"\nif [ -z "$LINE" ]; then echo CAUSE=x >&2; exit 1; fi';
  assert.deepEqual(errexitAbortSilentExits(guardedMulti), [], "the guard on the closing line must be seen");
  const bareMulti = 'set -euo pipefail\nLINE="$(grep -nE\n\'p\'\n"$f" | head -1)"\nif [ -z "$LINE" ]; then echo CAUSE=x >&2; exit 1; fi';
  assert.equal(errexitAbortSilentExits(bareMulti).length, 1, "…and the unguarded multi-line form is still BARE");
  assert.equal(errexitAbortSilentExits(bareMulti)[0].line, 2, "reported at the line that OPENS the statement");
});

test("errexitAbortSilentExits — a MULTI-LINE condition region is exempt (its commands are not errexit-aborting)", () => {
  const crit = [
    "set -euo pipefail",
    "if [ -f x ] \\",
    "   && [ -f y ]; then",
    "  echo ok",
    "fi",
    "LINE=\"$(cmd || true)\"",
  ].join("\n");
  assert.deepEqual(errexitAbortSilentExits(crit), [], "the `if` region is a condition, and the trailing line is guarded");
});

test("isSilentOnFailureSegment — the silencers, and the segment that must NOT be one", () => {
  assert.equal(isSilentOnFailureSegment("grep -q 'x' f"), true);
  assert.equal(isSilentOnFailureSegment("test -f x"), true);
  assert.equal(isSilentOnFailureSegment('[ -n "$x" ]'), true);
  assert.equal(isSilentOnFailureSegment("node x.ts get GOAL-001 >/dev/null 2>&1"), true);
  assert.equal(isSilentOnFailureSegment("node x.ts get GOAL-001 &>/dev/null"), true);
  assert.equal(isSilentOnFailureSegment("node --test x.mjs"), false, "node --test writes its failures");
  assert.equal(isSilentOnFailureSegment("node x.ts list"), false);
  // ⛔ `2>&1` alone is NOT silence: stderr still reaches the stream the runner captures.
  assert.equal(isSilentOnFailureSegment("node x.ts list 2>&1"), false);
});

test("splitTopLevelSegments — opaque to `$( )`, so a `|` inside a substitution is not a pipe", () => {
  const segs = splitTopLevelSegments(`test "$(node x.ts list | grep -c 'y')" -ge 3`);
  assert.equal(segs.length, 1, "the whole thing is ONE segment: the substitution absorbs grep's status");
  assert.equal(segs[0].text.startsWith("test "), true);
  assert.deepEqual(
    splitTopLevelSegments("a && b | c ; d").map((s) => [s.text, s.nextOp]),
    [["a", "&&"], ["b", "|"], ["c", ";"], ["d", null]],
  );
});

test("statusBearingStatement — the LAST statement, with backslash continuations joined", () => {
  const two = statusBearingStatement("echo one\ngrep -qE 'a' f \\\n  && grep -qE 'b' f");
  assert.equal(two.text, "grep -qE 'a' f && grep -qE 'b' f");
  assert.equal(two.lineOf[0], 2, "the first character maps back to source line 2");
  // ⛔ not the whole script: an EARLIER statement's silence cannot become the script's status
  assert.deepEqual(implicitFailureExitLines("grep -q X f\nnode --test x.mjs"), []);
});

// ── the ratchet (shrink-only) ──────────────────────────────────────────────────────────────────────

test("checkRatchet: equal / shrunk is ok, grown is not (and names the added ACs)", () => {
  const enumOf = (ids) => ({ evaluated: true, inDomain: 5, bareLines: ids.length, bareAcs: ids.map((id) => ({ id, file: `${id}.md`, bareLines: [] })) });
  const base = { count: 2, inDomain: 5, entries: [{ id: "AC-A", file: "a", bareLines: [] }, { id: "AC-B", file: "b", bareLines: [] }], generatedAt: "" };
  assert.deepEqual(checkRatchet(enumOf(["AC-A", "AC-B"]), base), { ok: true, delta: 0, added: [], fixed: [] });
  const shrunk = checkRatchet(enumOf(["AC-A"]), base);
  assert.equal(shrunk.ok, true);
  assert.equal(shrunk.delta, -1);
  assert.deepEqual(shrunk.fixed, ["AC-B"]);
  const grown = checkRatchet(enumOf(["AC-A", "AC-B", "AC-C"]), base);
  assert.equal(grown.ok, false, "an ADDED bare-failure-exit criterion must be RED (the ratchet is shrink-only)");
  assert.deepEqual(grown.added, ["AC-C"]);
});

// ── the CLI three-state contract ────────────────────────────────────────────────────────────────────

test("CLI: baseline-consistent workspace ⇒ exit 0, one added bare criterion ⇒ exit 1, restore ⇒ exit 0 (AC4)", () => {
  const root = makeRoot(2);
  assert.equal(runCli(["--root", root]).status, 0, "baseline-consistent fixture must be GREEN");

  fs.writeFileSync(
    path.join(root, "goals/AC-999-fixture.md"),
    ["---", "id: AC-999", "status: active", "kind: criterion", "criterion: |", "  test -f /nonexistent || exit 1", "---", ""].join("\n"),
  );
  const injected = runCli(["--root", root, "--json"]);
  assert.equal(injected.status, 1, "an injected bare-failure-exit criterion must turn the ratchet RED");
  assert.equal(JSON.parse(injected.stdout).bareAcs, 3);

  fs.rmSync(path.join(root, "goals/AC-999-fixture.md"));
  assert.equal(runCli(["--root", root]).status, 0, "removing the injected criterion must restore GREEN");
});

test("CLI: a criterion in the TRAILING COMPUTED form makes the ratchet BITE (+1 / delta +1 / named), then release", () => {
  // AC3's two-way control, mechanical: the same injection that the PRE-widening checker read as
  // `bareAcs` unchanged / status=pass / id absent from `ids` (i.e. a silent pass) must now be RED.
  const root = makeRoot(1);
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    JSON.stringify(
      { count: 1, inDomain: 1, entries: [{ id: "AC-900", file: "AC-900-fixture.md", bareLines: [4] }], generatedAt: "2026-09-11T00:00:00.000Z" },
      null,
      2,
    ) + "\n",
  );
  assert.equal(runCli(["--root", root]).status, 0, "baseline-consistent fixture must start GREEN");

  fs.writeFileSync(
    path.join(root, "goals/AC-990-fixture.md"),
    ["---", "id: AC-990", "status: active", "kind: criterion", "criterion: |", AC245_CRITERION_LINE, "---", ""].join("\n"),
  );
  const injected = runCli(["--root", root, "--json"]);
  assert.equal(injected.status, 1, "the AC-245 form must turn the ratchet RED — the blind spot is closed");
  const out = JSON.parse(injected.stdout);
  assert.equal(out.bareAcs, 2, "baseline + 1");
  assert.equal(out.delta, 1);
  assert.deepEqual(out.added, ["AC-990"], "the injected id must be NAMED");

  fs.rmSync(path.join(root, "goals/AC-990-fixture.md"));
  assert.equal(runCli(["--root", root]).status, 0, "removing the injected criterion must restore GREEN");
});

test("CLI: AC-172's ORIGINAL implicit-exit form makes the ratchet BITE (+1 / delta +1 / named), then release", () => {
  // AC2's two-way control, mechanical and against a baseline of 0. Before this revision the SAME
  // injection read `bareAcs=0`, status=pass, exit=0 and the id was absent from `ids` — a silent pass,
  // while AC-172's unattributable fail went into the production ledger and turned AC-241 red.
  const root = makeRoot(0);
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    JSON.stringify({ count: 0, inDomain: 0, entries: [], generatedAt: "2026-09-11T00:00:00.000Z" }, null, 2) + "\n",
  );
  // baseline 0 with a zero-criterion goals/ is NOT-EVALUATED — put one attributable criterion in so the
  // fixture is readable, and keep the ratchet anchored at 0.
  fs.writeFileSync(
    path.join(root, "goals/AC-900-fixture.md"),
    ["---", "id: AC-900", "status: active", "kind: criterion", "criterion: |", "  exit 0", "---", ""].join("\n"),
  );
  assert.equal(runCli(["--root", root]).status, 0, "baseline-consistent fixture must start GREEN");

  fs.writeFileSync(
    path.join(root, "goals/AC-990-fixture.md"),
    ["---", "id: AC-990", "status: active", "kind: criterion", "criterion: |", `  ${AC172_ORIGINAL_CRITERION}`, "---", ""].join("\n"),
  );
  const injected = runCli(["--root", root, "--json"]);
  assert.equal(injected.status, 1, `the implicit-exit form must turn the ratchet RED: ${injected.stdout}${injected.stderr}`);
  const out = JSON.parse(injected.stdout);
  assert.equal(out.bareAcs, 1, "baseline 0 + 1");
  assert.equal(out.delta, 1);
  assert.deepEqual(out.added, ["AC-990"], "the injected id must be NAMED");

  fs.rmSync(path.join(root, "goals/AC-990-fixture.md"));
  assert.equal(runCli(["--root", root]).status, 0, "removing the injected criterion must restore GREEN");
});

test("CLI: AC-286's RED errexit-abort form makes the ratchet BITE (+1 / delta +1 / named), then release", () => {
  // The 6th recurrence's two-way control, mechanical and against a baseline of 0. Before this revision
  // the SAME injection read `bareAcs=0` / status=pass / exit=0 and the id was absent from `ids` — a
  // silent pass while the criterion wrote an unattributable fail into the append-only ledger.
  const root = makeRoot(0);
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    JSON.stringify({ count: 0, inDomain: 0, entries: [], generatedAt: "2026-09-11T00:00:00.000Z" }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "goals/AC-900-fixture.md"),
    ["---", "id: AC-900", "status: active", "kind: criterion", "criterion: |", "  exit 0", "---", ""].join("\n"),
  );
  assert.equal(runCli(["--root", root]).status, 0, "baseline-consistent fixture must start GREEN");

  fs.writeFileSync(
    path.join(root, "goals/AC-990-fixture.md"),
    ["---", "id: AC-990", "status: active", "kind: criterion", "criterion: |",
      ...AC286_RED_CRITERION.split("\n").map((l) => `  ${l}`), "---", ""].join("\n"),
  );
  const injected = runCli(["--root", root, "--json"]);
  assert.equal(injected.status, 1, `the errexit-abort form must turn the ratchet RED: ${injected.stdout}${injected.stderr}`);
  const out = JSON.parse(injected.stdout);
  assert.equal(out.bareAcs, 1, "baseline 0 + 1");
  assert.equal(out.delta, 1);
  assert.deepEqual(out.added, ["AC-990"], "the injected id must be NAMED");

  fs.rmSync(path.join(root, "goals/AC-990-fixture.md"));
  assert.equal(runCli(["--root", root]).status, 0, "removing the injected criterion must restore GREEN");
});

test("CLI: the errexit-abort class's GUARDED controls add no hit (bareAcs unchanged)", () => {
  const root = makeRoot(0);
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    JSON.stringify({ count: 0, inDomain: 0, entries: [], generatedAt: "2026-09-11T00:00:00.000Z" }, null, 2) + "\n",
  );
  const guarded = [
    "set -euo pipefail",
    "LINE=\"$(grep -nE 'p' \"$f\" | head -1 || true)\"",
    'if [ -z "$LINE" ]; then echo CAUSE=x >&2; exit 1; fi',
  ].join("\n");
  fs.writeFileSync(
    path.join(root, "goals/AC-900-fixture.md"),
    ["---", "id: AC-900", "status: active", "kind: criterion", "criterion: |",
      ...guarded.split("\n").map((l) => `  ${l}`), "---", ""].join("\n"),
  );
  const r = runCli(["--root", root, "--json"]);
  assert.equal(r.status, 0, `a GUARDED assignment must stay green: ${r.stdout}${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout).ids, []);
});

test("CLI: the implicit-exit class's three NEGATIVE controls add no hit (bareAcs unchanged)", () => {
  const root = makeRoot(0);
  fs.writeFileSync(
    path.join(root, "goals/AC-900-fixture.md"),
    ["---", "id: AC-900", "status: active", "kind: criterion", "criterion: |", "  exit 0", "---", ""].join("\n"),
  );
  const negatives = {
    "AC-980": "  node --test plugin/test/x.test.mjs", // writes its failures
    "AC-981": "  grep -q X f || { echo CAUSE=missing >&2; exit 1; }", // `||` remediates + attributes
    "AC-982": '  node x.ts get GOAL-001 2>&1', // `2>&1` alone is not silence
  };
  for (const [id, line] of Object.entries(negatives)) {
    fs.writeFileSync(
      path.join(root, `goals/${id}-fixture.md`),
      ["---", `id: ${id}`, "status: active", "kind: criterion", "criterion: |", line, "---", ""].join("\n"),
    );
  }
  const r = runCli(["--root", root, "--json"]);
  assert.equal(r.status, 0, `none of the three may be flagged: ${r.stdout}${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).bareAcs, 0);
  assert.deepEqual(JSON.parse(r.stdout).ids, []);
});

test("CLI 硬规则 3b: an unreadable goals/ ⇒ exit 3 NOT-EVALUATED, distinct from BOTH pass and red", () => {
  const root = makeRoot(1);
  fs.rmSync(path.join(root, "goals"), { recursive: true, force: true });
  const r = runCli(["--root", root]);
  assert.equal(r.status, 3, "unreadable input must be NOT-EVALUATED, never 0 (which would read as 'no bare exits')");
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 1);
  assert.match(r.stderr, /NOT-EVALUATED/);
});

test("CLI 硬规则 3b: a malformed / absent baseline ⇒ exit 3, never a silent '≤ baseline'", () => {
  const root = makeRoot(1);
  fs.writeFileSync(path.join(root, BASELINE_REL), "{ not json");
  const r = runCli(["--root", root]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /NOT-EVALUATED/);
  fs.rmSync(path.join(root, BASELINE_REL));
  assert.equal(runCli(["--root", root]).status, 3, "a MISSING baseline is also NOT-EVALUATED (the ratchet is not established)");
});

test("enumerateBareFailureExits: a goals dir holding only out-of-domain drafts is NOT-EVALUATED", () => {
  const root = mkTmp("cfac-draft-");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "goals/AC-901-fixture.md"),
    ["---", "id: AC-901", "status: draft", "kind: criterion", "criterion: |", "  sys.exit(1)", "---", ""].join("\n"),
  );
  const e = enumerateBareFailureExits(path.join(root, "goals"));
  assert.equal(e.evaluated, false, "zero in-domain criteria means the question could not be asked (硬规则 3b)");
});

// ── the committed artifact really gates the real repo ───────────────────────────────────────────────

test("the COMMITTED baseline gates the REAL repo at exit 0, and its count IS the live enumeration", () => {
  const r = runCli(["--root", REPO_ROOT, "--json"]);
  assert.equal(r.status, 0, `the real repo must be at/below its committed baseline: ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const committed = readBaseline(path.join(REPO_ROOT, BASELINE_REL));
  assert.ok(committed, "the committed baseline must exist and be well-shaped");
  // ⛔ NOT an equality assertion: the ratchet is SHRINK-ONLY, so a legitimate fix by ANY task lowers the
  // live count below the baseline and stays green. Asserting `===` turns every such fix into a red here
  // (measured 2026-09-11: AC-161's fix landed on develop ⇒ live 32 vs committed 33 ⇒ this test went red
  // while the checker itself was correctly green) — i.e. a test that fires on the BEST possible event.
  assert.ok(
    out.bareAcs <= committed.count,
    `the ratchet must hold: live ${out.bareAcs} > committed ${committed.count} — a new bare-failure-exit criterion landed`,
  );
  // The anti-drift intent is kept, just aimed at the right quantity: the CLI's number must be a LIVE
  // enumeration of goals/ on disk, not a constant someone typed. Compare it to an INDEPENDENT read of the
  // same tree through the library entry point (the CLI number is the one under test).
  const live = enumerateBareFailureExits(path.join(REPO_ROOT, "goals"));
  assert.equal(live.evaluated, true, "the direct enumeration must have been evaluable (硬规则 3b)");
  assert.equal(
    out.bareAcs,
    live.bareAcs.length,
    "the CLI's count must equal a direct enumeration of goals/ (⛔ not a constant that drifted)",
  );
  assert.ok(out.inDomain > 0, "the enumeration must have read a non-empty in-domain set");
});
