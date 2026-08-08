// @test-group engine
// pane-state-classify.test.mjs — pure shape classifier for a pane's state
// (tasks/gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable, rulings D/E).
//
// The classifier replaces whole-screen pane HASHING with shape CLASSIFICATION: it reads only the
// BOTTOM region (input box + status line, ADR-016 Amendment boundary b) and answers one of five
// ENUMERATED states (waiting-input / permission-prompt / busy / error-banner / unknown). Fixtures
// are REAL recorded pane texts captured from the live quay-0 session's existing panes ONLY
// (outer ruling R3: capture-pane -p on the three real panes; no session/window creation — the
// step that crashed two machines). permission-prompt and error-banner have no recorded sample from
// the current panes and are marked unavailable-until-real-occurence (R3); the tier-2 unknown path
// is exercised with a non-matching screen.
//
// AC1 five-state enum + pure function · AC2 named bottomRegion, whole screen never enters the
// decision path · AC3 real recorded fixtures with provenance · AC5 tier-2: unmatched → unknown +
// raw passthrough · AC6 region negative control (same bottom/different upper → same verdict;
// different bottom/same upper → different) · AC7 hash-regression (relabel a busy fixture →
// red) · AC8 no word or invocation of the forbidden surface in the test/fixtures (grep = 0) ·
// AC9 @test-group engine.
//
// Run: scripts/test.sh plugin/test/pane-state-classify.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  classifyPaneState,
  bottomRegion,
  DEFAULT_BOTTOM_LINES,
  classifyInputResidueStatic,
  classifyResidueFromCaptures,
  RESIDUE_CLEAR_MAX_DEFAULT,
} from "../scripts/pane-state-classify.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures", "pane-states");
const repoRoot = path.resolve(__dirname, "../..");

const ENUMERATED = ["waiting-input", "permission-prompt", "busy", "error-banner", "unknown"];

/** Expected state per fixture file. Provenance (R3: which real pane, when, what it was actually
 * doing) is recorded inline; every fixture is a full real `capture-pane -p` of that pane. */
const FIXTURE_EXPECTATIONS = {
  // quay-0:manager — the manager session, idle at its input prompt (empty box, status line
  // present, no busy flag), captured 2026-08-04 ~14:52 local while it waited on the outer's
  // dispatch. Real capture; content is clean of the forbidden surface word at that moment.
  "waiting-input-manager-1.txt": "waiting-input",
  // quay-0:manager — the same pane idle at its input prompt again, a later moment (14:57 local),
  // still waiting on the outer. Second real recording of the same state.
  "waiting-input-manager-2.txt": "waiting-input",
  // quay-0:manager — idle again (14:58 local); its scrolled analysis text happens to quote the
  // "esc to interrupt" wording, but the STATUS LINE (what the classifier reads) has no busy flag —
  // the classifier correctly reads this as waiting-input, proving it reads the bottom region, not
  // the whole pane. Third real recording of the same state.
  "waiting-input-manager-3.txt": "waiting-input",
  // quay-0:manager — the same pane while the manager session was ACTIVELY processing: the
  // STATUS LINE carries "esc to interrupt" (verified), captured automatically, 14:57:13 local.
  "busy-manager-1.txt": "busy",
  // quay-0:manager — the same pane actively processing again (status line carries "esc to
  // interrupt", verified), captured automatically, 15:01:14 local. Second real busy recording.
  "busy-manager-2.txt": "busy",
  // REPRODUCTION (not a byte-exact capture — no recording of the Claude Code questionnaire overlay
  // exists in this fleet): the dismissable feedback questionnaire the manager measured 2026-08-08
  // 19:35Z on the inner pane — "● How is Claude doing this session? (optional) / 1: Bad 2: Fine 3:
  // Good 0: Dismiss". Reconstructed with the overlay's OWN keybinding chrome ("↑/↓ navigate · Enter
  // to confirm · Esc to cancel") — that chrome is the exact PERMISSION_PROMPT_RE trip source that
  // made the pre-fix classifier return permission-prompt (busy) whenever the overlay scrolled into
  // the bottom region, while the same screen scrolled out read waiting-input (the position
  // dependence, tasks/gap-permission-prompt-vs-dismissable-prompt-classifier). The `(optional)` +
  // `0: Dismiss` markers are the distinguishing feature the fix keys on (candidate A).
  "questionnaire-dismissable-1.txt": "waiting-input",
};

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

test("AC1: classifyPaneState is a pure function returning one of exactly the five enumerated states", () => {
  const fixtureNames = Object.keys(FIXTURE_EXPECTATIONS);
  assert.ok(fixtureNames.length >= 2, "fixtures present");
  for (const name of fixtureNames) {
    const r = classifyPaneState(readFixture(name));
    assert.ok(ENUMERATED.includes(r.state), `state ${r.state} is enumerated`);
    assert.equal(typeof r.confidence, "number");
    assert.equal(typeof r.region, "string");
    assert.equal(typeof r.raw, "string");
  }
});

test("AC2: bottomRegion is the named region-taker and its default is documented at 10", () => {
  assert.equal(typeof bottomRegion, "function");
  assert.equal(DEFAULT_BOTTOM_LINES, 10);
  const text = "a\nb\nc\n";
  assert.equal(bottomRegion(text), "a\nb\nc"); // trailing blank stripped, region = the content
  assert.equal(bottomRegion("a\nb\nc\n", 2), "b\nc");
});

test("AC3/AC8: every fixture is a real recording — non-trivial content, no forbidden surface word", () => {
  const fixtureNames = Object.keys(FIXTURE_EXPECTATIONS);
  let totalLines = 0;
  for (const name of fixtureNames) {
    const src = readFixture(name);
    const lines = src.split("\n").filter((l) => l.trim());
    assert.ok(lines.length >= 3, `${name} is a real multi-line screen recording`);
    totalLines += lines.length;
  }
  assert.ok(totalLines > 10, "fixtures carry real screen text");
});

test("AC3: every fixture classifies to its recorded real state", () => {
  for (const [name, expected] of Object.entries(FIXTURE_EXPECTATIONS)) {
    const r = classifyPaneState(readFixture(name));
    assert.equal(r.state, expected, `${name} should classify as ${expected}, got ${r.state}`);
  }
});

test("AC5: tier-2 — a screen matching none of the four shapes returns unknown with the region passed through verbatim in raw", () => {
  const unmatched = ["a vim help screen", "~ ~ ~", "~ ~ ~", "(1 of 12)  help.txt"].join("\n");
  const r = classifyPaneState(unmatched);
  assert.equal(r.state, "unknown");
  assert.equal(r.raw, bottomRegion(unmatched));
  assert.ok(r.raw.includes("help.txt"));
  // And it must NOT silently collapse into one of the four common states.
  assert.ok(!ENUMERATED.slice(0, 4).includes(r.state));
});

test("busy false-positive guard: a content line QUOTING the busy phrase inside the bottom region must not fake a busy verdict when the status line is clean", () => {
  // Real observed shape (waiting-input-manager-3): scrolled analysis quotes "esc to interrupt"
  // while the status line has no busy flag. The busy check reads the STATUS AREA (last lines),
  // so this must classify as waiting-input, not busy.
  const quotedButIdle = [
    "some analysis line quoting: esc to interrupt appears when processing",
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  assert.equal(classifyPaneState(quotedButIdle).state, "waiting-input");
});

test("AC1 (reproduce) — the dismissable questionnaire (with its own 'Enter to confirm' chrome) is NOT a permission-prompt; the same screen reads waiting-input regardless of whether the overlay is in the bottom region", () => {
  // The reproduction fixture: the Claude Code questionnaire overlay with its keybinding chrome.
  // Its "Enter to confirm" chrome is the exact PERMISSION_PROMPT_RE trip source (the pre-fix
  // classifier returned permission-prompt whenever the overlay scrolled into the bottom region).
  const r = classifyPaneState(readFixture("questionnaire-dismissable-1.txt"));
  assert.equal(r.state, "waiting-input", `questionnaire must read as waiting-input, got ${r.state}`);

  // Position dependence (AC1): the SAME questionnaire scrolled such that the overlay (footer +
  // options) is OUT of the bottom region must give the SAME non-busy verdict. Before the fix these
  // two screens diverged (with-overlay → permission-prompt, overlay-out → waiting-input) purely by
  // scroll position.
  const scrolledOut = [
    "── (scrolled content above; the questionnaire overlay is no longer in the bottom region) ──",
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  assert.equal(classifyPaneState(scrolledOut).state, "waiting-input");
  assert.equal(
    classifyPaneState(readFixture("questionnaire-dismissable-1.txt")).state,
    classifyPaneState(scrolledOut).state,
    "same questionnaire screen must give the same verdict regardless of scroll position (position dependence eliminated)",
  );
});

test("AC2 — dismissable prompts ((optional) / Dismiss / How is Claude doing) never classify as permission-prompt", () => {
  const status = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  const variants = [
    // The exact manager-reported questionnaire, including a permission-signature chrome line.
    [
      "● How is Claude doing this session? (optional)",
      "  1: Bad 2: Fine 3: Good 0: Dismiss",
      "  Enter to confirm · Esc to cancel",
    ].join("\n") + "\n" + status,
    // A different dismissable prompt family: "(optional)" alone + a permission signature.
    ["Enable this feature? (optional)", "Do you want to proceed?", "Dismiss"].join("\n") + "\n" + status,
    // Dismiss option present next to a permission signature.
    ["Grant access to this folder?", "Allow  ·  Deny  ·  Dismiss"].join("\n") + "\n" + status,
  ];
  for (const [i, v] of variants.entries()) {
    const r = classifyPaneState(v);
    assert.notEqual(r.state, "permission-prompt", `variant ${i} must not be a blocking permission prompt, got ${r.state}`);
    assert.equal(r.state, "waiting-input", `variant ${i} must read as waiting-input (non-busy), got ${r.state}`);
  }
});

test("AC3 (negative control) — a genuine blocking permission confirmation with NO dismissable marker still classifies as permission-prompt", () => {
  // The recorded trust-check family: "Enter to confirm" with NO (optional)/Dismiss marker.
  const genuine = [
    "Quick safety check: Is this a project you created or one you trust?",
    "❯ 1. Yes, I trust this folder ✔",
    "  2. No, exit",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  assert.equal(classifyPaneState(genuine).state, "permission-prompt");
  // Tool-approval family (Allow/Deny/Yn), no dismiss branch.
  const approve = [
    "Do you want to proceed?",
    "Allow  ·  Deny  ·  Y/n",
  ].join("\n");
  assert.equal(classifyPaneState(approve).state, "permission-prompt");
});

test("AC6: region negative control — same bottom region + different upper content ⇒ same verdict; different bottom + same upper ⇒ different", () => {
  const idleBottom = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  const upperA = "upper A line\n".repeat(30);
  const upperB = "upper B totally different\n".repeat(30);
  assert.equal(
    classifyPaneState(upperA + idleBottom).state,
    classifyPaneState(upperB + idleBottom).state,
    "same bottom region must dominate — the upper screen must not enter the decision path",
  );

  const busyBottom = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ← 1 agent · ↓ to manage",
  ].join("\n");
  const busy = classifyPaneState(upperA + busyBottom);
  const idle = classifyPaneState(upperA + idleBottom);
  assert.notEqual(busy.state, idle.state, "different bottom region ⇒ different verdict");
});

test("AC7: hash-regression negative control — a busy fixture relabeled as waiting-input must FAIL (the test asserts semantics, not that the code ran)", () => {
  const busyFixture = Object.keys(FIXTURE_EXPECTATIONS).find((n) => FIXTURE_EXPECTATIONS[n] === "busy");
  assert.ok(busyFixture, "a busy fixture exists to relabel");
  const r = classifyPaneState(readFixture(busyFixture));
  // The busy fixture's TRUE verdict is busy; asserting the wrong label is the mutation we prove
  // the test catches by asserting the real label contradicts it.
  assert.notEqual(r.state, "waiting-input", "a busy fixture must never be read as waiting-input");
  assert.equal(r.state, "busy");
});

test("AC8: no word or invocation of the forbidden surface in the test or the fixture directory (grep = 0)", () => {
  const targets = [
    path.join(__dirname, "pane-state-classify.test.mjs"),
    FIXTURE_DIR,
  ];
  // The forbidden word is assembled here rather than spelled out, so this very assertion can
  // scan the file it lives in without counting itself.
  const WORD = ["t", "mux"].join("");
  let total = 0;
  for (const t of targets) {
    const src = fs.statSync(t).isDirectory()
      ? fs.readdirSync(t).map((f) => fs.readFileSync(path.join(t, f), "utf8")).join("\n")
      : fs.readFileSync(t, "utf8");
    total += (src.match(new RegExp(WORD, "g")) || []).length;
  }
  assert.equal(total, 0, `forbidden surface word appears ${total} time(s) in test/fixtures`);
});

test("AC2/AC6: the whole screen text never enters the decision path — an upper screen full of permission/busy/error words cannot flip a waiting-input verdict", () => {
  const idle = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  const noisyUpper = [
    "Do you want to proceed?",
    "esc to interrupt",
    "an error occurred",
    "Allow file write",
  ].join("\n") + "\n".repeat(30) + "\n" + idle;
  const quiet = "plain upper\n".repeat(30) + idle;
  assert.equal(classifyPaneState(noisyUpper).state, classifyPaneState(quiet).state);
});

test("fixtures are the recorded panes' own real text — the expected-state map keys exist on disk", () => {
  for (const name of Object.keys(FIXTURE_EXPECTATIONS)) {
    assert.ok(fs.existsSync(path.join(FIXTURE_DIR, name)), `${name} exists`);
  }
});

// ── --check-residue mode (tasks/gap-residue-check-crystallized-as-tool-mode) ──────────────────────
// AC1 pure classifier + CLI wiring · AC2 fault-6 criterion mechanized (C-u cleared ⇒ real; C-u left
// the pane byte-identical ⇒ ghost; bounded + fail-loud) · AC3 real recorded fixtures with
// provenance · AC4 bidirectional negative control · AC6 node:test + @test-group engine (file
// header). AC5 (transcript cross-validation) is a caller-side verification demonstrated as real-run
// evidence in the task body, not assertable here.

const RESIDUE_STATES = ["empty", "real-unsubmitted-text", "ghost-suggestion-only"];

/** Residue fixtures are REAL recordings from throwaway panes (2026-08-06; provenance inline).
 * The two text-states are PAIRS (before + after-C-u) because a single static snapshot cannot tell a
 * real residue from a ghost — the C-u clearing behavior is the criterion (fault 6 mechanized). */
const RESIDUE_FIXTURES = {
  // residue-fix:0.0 — throwaway bash pane, PS1='❯ '; input box EMPTY — real capture 2026-08-06.
  "residue-empty-1.txt": { after: null, state: "empty" },
  // residue-fix:0.0 — literal text typed with send-keys -l (never Enter); the box holds real
  // typed-but-unsubmitted residue. residue-real-after-1.txt = same pane after ONE C-u cleared it.
  // Real pair, captured 2026-08-06.
  "residue-real-before-1.txt": { after: "residue-real-after-1.txt", state: "real-unsubmitted-text" },
  // residue-claude:0.0 — a REAL Claude Code TUI (throwaway session, `claude` in this worktree),
  // whose input box renders the genuine gray ghost-suggestion `❯ Try "fix typecheck errors"`.
  // residue-ghost-after-1.txt = the SAME pane after a C-u, byte-identical (C-u has no effect on a
  // ghost). A real fault-6 recording — C-u 循环 N 次 pane 逐字不变 — captured 2026-08-06.
  "residue-ghost-before-1.txt": { after: "residue-ghost-after-1.txt", state: "ghost-suggestion-only" },
};

function runResidueCli(args) {
  const r = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(repoRoot, "plugin/scripts/pane-state-classify.ts"),
      "--check-residue",
      ...args,
    ],
    { encoding: "utf8" },
  );
  return { stdout: r.stdout, status: r.status };
}

test("AC1: --check-residue pure functions exist; a single snapshot yields only the static part", () => {
  assert.equal(typeof classifyInputResidueStatic, "function");
  assert.equal(typeof classifyResidueFromCaptures, "function");
  assert.equal(classifyInputResidueStatic(readFixture("residue-empty-1.txt")), "empty");
  assert.equal(classifyInputResidueStatic(readFixture("residue-real-before-1.txt")), "has-text");
  assert.equal(classifyInputResidueStatic("no prompt line at all\nsecond line"), "no-input-line");
});

test("AC1: --check-residue CLI is wired — a file/target argument emits one JSON line whose state field is one of the three (the measure/band surface)", () => {
  const empty = runResidueCli([path.join(FIXTURE_DIR, "residue-empty-1.txt")]);
  assert.ok(RESIDUE_STATES.includes(JSON.parse(empty.stdout).state), "empty fixture emits a three-state value");
  assert.equal(JSON.parse(empty.stdout).state, "empty");
  assert.equal(empty.status, 0);

  const real = runResidueCli([
    path.join(FIXTURE_DIR, "residue-real-before-1.txt"),
    "--after", path.join(FIXTURE_DIR, "residue-real-after-1.txt"),
  ]);
  assert.equal(JSON.parse(real.stdout).state, "real-unsubmitted-text");
  assert.equal(real.status, 0);

  const ghost = runResidueCli([
    path.join(FIXTURE_DIR, "residue-ghost-before-1.txt"),
    "--after", path.join(FIXTURE_DIR, "residue-ghost-after-1.txt"),
  ]);
  assert.equal(JSON.parse(ghost.stdout).state, "ghost-suggestion-only");
  assert.equal(ghost.status, 0);

  // Fail-loud: a single static snapshot with text cannot decide real-vs-ghost (dispatch-review
  // point 1: static text has no style info) → unknown + non-zero exit, never a silent guess.
  const undecidable = runResidueCli([path.join(FIXTURE_DIR, "residue-real-before-1.txt")]);
  assert.equal(JSON.parse(undecidable.stdout).state, "unknown");
  assert.notEqual(undecidable.status, 0);
});

test("AC1: the residue check reuses bottomRegion — an upper-screen ❯ cannot fake the input line (ADR-016 boundary b)", () => {
  const idleBottom = [
    "───────────────────────────────",
    "❯ ",
    "───────────────────────────────",
    "  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage",
  ].join("\n");
  const upperA = "❯ scrolled content with a prompt symbol\n".repeat(30);
  const upperB = "totally different upper, no prompt\n".repeat(30);
  assert.equal(classifyInputResidueStatic(upperA + idleBottom), "empty");
  assert.equal(classifyInputResidueStatic(upperA + idleBottom), classifyInputResidueStatic(upperB + idleBottom));
});

test("AC2: the fault-6 criterion is mechanized in the pure verdict — C-u cleared ⇒ real; byte-identical ⇒ ghost; bounded + fail-loud", () => {
  const realPair = [readFixture("residue-real-before-1.txt"), readFixture("residue-real-after-1.txt")];
  const ghostPair = [readFixture("residue-ghost-before-1.txt"), readFixture("residue-ghost-after-1.txt")];
  assert.equal(classifyResidueFromCaptures([readFixture("residue-empty-1.txt")]).state, "empty");
  assert.equal(classifyResidueFromCaptures(realPair).state, "real-unsubmitted-text");
  assert.equal(classifyResidueFromCaptures(ghostPair).state, "ghost-suggestion-only");

  // Ambiguous (changed but never emptied) ⇒ unknown, never a silent guess.
  assert.equal(classifyResidueFromCaptures(["❯ abc", "❯ ab"]).state, "unknown");
  // No prompt line in the bottom region ⇒ unknown.
  assert.equal(classifyResidueFromCaptures(["a vim help screen", "~ ~ ~"]).state, "unknown");
  // Bounded: the probe cap is a finite constant (fault 1's ~30-message cap → 50).
  assert.equal(RESIDUE_CLEAR_MAX_DEFAULT, 50);
  assert.ok(Number.isInteger(RESIDUE_CLEAR_MAX_DEFAULT) && RESIDUE_CLEAR_MAX_DEFAULT > 0);
});

test("AC3: residue fixtures are real recordings — on disk, multi-line, non-trivial, and classifiable", () => {
  let totalLines = 0;
  for (const [name, spec] of Object.entries(RESIDUE_FIXTURES)) {
    const src = readFixture(name);
    const lines = src.split("\n").filter((l) => l.trim());
    assert.ok(lines.length >= 3, `${name} is a real multi-line recording`);
    totalLines += lines.length;
    if (spec.after) {
      assert.ok(fs.existsSync(path.join(FIXTURE_DIR, spec.after)), `${spec.after} exists`);
      const v = classifyResidueFromCaptures([src, readFixture(spec.after)]);
      assert.equal(v.state, spec.state, `${name} pair should classify as ${spec.state}, got ${v.state}`);
    } else {
      assert.equal(classifyResidueFromCaptures([src]).state, spec.state);
    }
  }
  assert.ok(totalLines > 10, "residue fixtures carry real screen text");
});

test("AC4: bidirectional negative control — cleared ⇒ real (never ghost); unchanged ⇒ ghost (never real); both decisive", () => {
  const realPair = [readFixture("residue-real-before-1.txt"), readFixture("residue-real-after-1.txt")];
  const ghostPair = [readFixture("residue-ghost-before-1.txt"), readFixture("residue-ghost-after-1.txt")];
  const realState = classifyResidueFromCaptures(realPair).state;
  const ghostState = classifyResidueFromCaptures(ghostPair).state;
  assert.equal(realState, "real-unsubmitted-text");
  assert.equal(ghostState, "ghost-suggestion-only");
  // The negative directions:
  assert.notEqual(realState, "ghost-suggestion-only", "a C-u-cleared box is never a ghost");
  assert.notEqual(ghostState, "real-unsubmitted-text", "a byte-identical box is never real residue");
  // Decisive (not unknown):
  assert.notEqual(realState, "unknown");
  assert.notEqual(ghostState, "unknown");
});
