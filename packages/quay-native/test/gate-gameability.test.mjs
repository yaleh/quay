// @test-group product
// QN-030 (iteration 20): live, executable proof of a permanent, structural
// boundary named in prose since iteration 2 (QN-005) and re-cited in
// iterations 9, 11, 12, 13, 16, 17, 18, 19: `store.js`'s `check()` gate
// mechanically verifies AC checkbox PRESENCE and CHECKED-STATE only — it
// never verifies that a checked box's underlying claim is actually TRUE.
//
// This test does NOT attempt to close that gap (it cannot be closed by a
// generic mechanical parser — see store.js's own comment near
// `artifactSections`/`MIN_SECTION_CHARS`: "not attempting semantic quality
// scoring (out of scope for a mechanical gate; that is what independent
// review/audit is for, per design §3/G3)"). It exists to convert a
// 9-iteration-old prose assertion into a concrete, reproducible artifact.
//
// IMPORTANT FOR FUTURE MAINTAINERS: the "PASS" assertions below encode the
// gate's *expected, permanent, structural* behavior. If a future change to
// store.js makes this test start FAILING (i.e. the gate starts rejecting a
// checked-but-false claim), that is not evidence of a regression in this
// test — it would mean check() started doing task-specific semantic
// verification, which is a bigger architectural change than a normal gate
// fix and should be a deliberate, separately-justified decision (see G3:
// "the gate is both contestant and judge" — semantic verification inside
// the gate itself would need its own independent review, not a quiet
// patch). Do not "fix" this test by making the gate reject false claims
// without reading design §3/G3 and this file's own header first.
//
// Run: node test/gate-gameability.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(__dirname, ".tmp-gate-gameability-test");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function reset() {
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
}

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

function main() {
  reset();
  const store = createStore(tasksDir);

  // --- Case 1: author->ready gate, a falsely-checked claim -------------
  //
  // The AC below contains one checkbox whose claim is a concrete, checkable
  // fact: "2 + 2 === 5". That claim is live-verified, in this very test, to
  // be false. The gate has no way to know this — it only counts checkbox
  // syntax — so it reports ok:true anyway. This is the gameability boundary,
  // demonstrated live, not merely asserted.
  const falseClaimIsActuallyFalse = 2 + 2 === 5; // live-verified, not assumed
  assert(
    falseClaimIsActuallyFalse === false,
    "sanity: the claim this fixture's checked AC box asserts is genuinely false"
  );

  store.write("GAME-A", {
    title: "author-ready-falsely-checked-claim",
    status: "todo",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] 2 + 2 === 5 (a provably false claim, checked anyway)\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("GAME-A");
    assert(r.gate === "author->ready", "GAME-A: gate is author->ready");
    assert(
      r.ok === true,
      "GAME-A: EXPECTED, STRUCTURAL BEHAVIOR — the gate reports ok:true " +
        "for a checked-but-false AC claim, because it only inspects " +
        "checkbox syntax, never claim truth. This is the " +
        "checkbox-count-gameability boundary, demonstrated live. A future " +
        "change that makes this assertion fail is not a bug fix in the " +
        "ordinary sense — read this file's header before changing store.js."
    );
  }

  // --- Case 2: execute->done gate, same boundary, on the ready->done path
  const secondFalseClaimIsActuallyFalse = "abc".length === 99; // live-verified
  assert(
    secondFalseClaimIsActuallyFalse === false,
    "sanity: the claim this fixture's checked AC box asserts is genuinely false"
  );

  store.write("GAME-B", {
    title: "execute-done-falsely-checked-claim",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] "abc".length === 99 (a provably false claim, checked anyway)\n` +
      `## DoD\n${substantive("DoD")}\n`,
  });
  {
    const r = store.check("GAME-B");
    assert(r.gate === "execute->done", "GAME-B: gate is execute->done");
    assert(
      r.ok === true,
      "GAME-B: EXPECTED, STRUCTURAL BEHAVIOR — same boundary on the " +
        "ready->done path: a checked-but-false AC claim still passes, " +
        "because the gate is a syntax counter, not a semantic verifier. " +
        "This is exactly why G3's independent, out-of-band audit is " +
        "mandatory and non-optional (protocol §6) -- the gate cannot, by " +
        "itself, ever be sufficient proof that native-Skill-driven work " +
        "was done correctly, only that it was described as done."
    );
  }

  // --- Case 3: negative control — an HONEST gate failure still works ----
  // (proves this test file isn't merely testing "the gate always passes";
  // it demonstrates the gate correctly rejects genuinely unchecked/missing
  // criteria, and ONLY the checked-but-false case slips through.)
  //
  // gap-both-gates-read-one-signal-so-done-costs-nothing: under the restored
  // ADR-001 semantics, an honestly-unchecked AC box no longer fails
  // author->ready (checked-state belongs to ready->done, AC3). The honest
  // failure control therefore moves to the execute->done gate, where the
  // DoD checked-state is read (AC7b): a ready task with a genuinely-
  // unchecked DoD box must still fail. This is exactly the shape the task's
  // main criterion demands, and it confirms the gate rejects honest
  // non-completion while only the checked-but-FALSE-claim case slips through.
  store.write("GAME-C", {
    title: "genuinely-unchecked-dod-control",
    status: "ready",
    body:
      `## Proposal\n${substantive("Proposal")}\n` +
      `## Plan\n${substantive("Plan")}\n` +
      `## AC\n- [x] a real, genuinely checked acceptance criterion\n` +
      `## DoD\n- [ ] a genuinely-unchecked definition-of-done item, honestly not done\n`,
  });
  {
    const r = store.check("GAME-C");
    assert(r.gate === "execute->done", "GAME-C: gate is execute->done");
    assert(
      r.ok === false,
      "GAME-C: control case — an honestly-unchecked DoD box still correctly " +
        "fails the execute->done gate (confirms this file is testing the " +
        "false-but-CHECKED gap specifically, not a broken gate that always " +
        "passes)"
    );
  }

  reset();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exitCode = 1;
  } else {
    console.log(
      "\nAll gate-gameability tests passed. The checkbox-count-" +
        "gameability boundary (asserted in prose since iteration 2, " +
        "QN-005) is now demonstrated live. This boundary is NOT a bug; " +
        "G3's independent out-of-band audit is the actual, permanent " +
        "compensating mechanism (protocol §6)."
    );
  }
}

main();
