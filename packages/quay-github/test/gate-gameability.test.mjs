// @test-group product
// QN-070 (iteration 69): GitHub-Provider port of QN-030's (iteration 20)
// gate-gameability regression test — live, executable proof that
// `github-client.js#checkGate()` shares the same permanent, structural
// boundary as native's own `store.js#check()` (see
// `packages/quay-native/test/gate-gameability.test.mjs` for the original):
// the gate mechanically verifies AC checkbox PRESENCE and CHECKED-STATE
// only — it never verifies that a checked box's underlying claim is
// actually TRUE.
//
// This is the first port of a methodology-verification artifact to the
// held-out GitHub Provider transfer target (protocol §5.2, decision §10
// item 4) since iteration 25's compound/epic gate port (QN-035) — every
// GitHub-side test-coverage closure since iteration 26 added coverage for
// behavior already tested or already symmetric between the two Providers;
// this instead closes a gap that had never been closed on the GitHub side
// at all: no test anywhere in this repository previously demonstrated this
// structural boundary against `checkGate()`.
//
// This test does NOT attempt to close the underlying gap (it cannot be
// closed by a generic mechanical parser, on either Provider — see the
// native original's own header, and github-client.js's `checkGate()`,
// which uses the identical mechanical `- \[[xX]\]` counting approach). It
// exists to convert the "same boundary applies on GitHub too" claim from an
// assumption into a concrete, reproducible artifact — matching the exact
// evidentiary standard the native original set at iteration 20.
//
// IMPORTANT FOR FUTURE MAINTAINERS: the "PASS" assertions below encode the
// gate's *expected, permanent, structural* behavior, identically to the
// native original's own warning. If a future change to `checkGate()` makes
// this test start FAILING (i.e. the gate starts rejecting a checked-but-
// false claim), that is not evidence of a regression in this test — it
// would mean `checkGate()` started doing task-specific semantic
// verification, a bigger architectural change than a normal gate fix,
// needing its own independent review (G3: "the gate is both contestant and
// judge"). Do not "fix" this test by making the gate reject false claims
// without reading design §3/G3, this file's header, and the native
// original's header first.
//
// Run: node test/gate-gameability.test.mjs
import { checkGate } from "../src/github-client.ts";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const substantive = (label) =>
  `${label} — this is real, substantive prose describing the ${label.toLowerCase()} in enough detail to exceed the minimum content threshold for this section, well past forty characters.`;

function main() {
  // --- Case 1 (GAME-A): author->ready gate, a falsely-checked claim -----
  //
  // The AC below contains one checkbox whose claim is a concrete, checkable
  // fact: "2 + 2 === 5". That claim is live-verified, in this very test, to
  // be false. `checkGate()` has no way to know this — it only counts
  // checkbox syntax via a regex — so it reports ok:true anyway. This is the
  // gameability boundary, demonstrated live on the GitHub Provider, not
  // merely assumed to transfer from the native original.
  const falseClaimIsActuallyFalse = 2 + 2 === 5; // live-verified, not assumed
  assert(
    falseClaimIsActuallyFalse === false,
    "sanity: the claim this fixture's checked AC box asserts is genuinely false"
  );

  const bodyA =
    `## Proposal\n${substantive("Proposal")}\n` +
    `## Plan\n${substantive("Plan")}\n` +
    `## AC\n- [x] 2 + 2 === 5 (a provably false claim, checked anyway)\n` +
    `## DoD\n${substantive("DoD")}\n`;
  {
    const r = checkGate({ id: "GAME-A", status: "todo", body: bodyA });
    assert(r.gate === "author->ready", "GAME-A: gate is author->ready");
    assert(
      r.ok === true,
      "GAME-A: EXPECTED, STRUCTURAL BEHAVIOR — checkGate() reports ok:true " +
        "for a checked-but-false AC claim, because it only inspects " +
        "checkbox syntax, never claim truth. This is the " +
        "checkbox-count-gameability boundary, demonstrated live on the " +
        "GitHub Provider. A future change that makes this assertion fail " +
        "is not a bug fix in the ordinary sense — read this file's header " +
        "and the native original's header before changing github-client.js."
    );
  }

  // --- Case 2 (GAME-B): execute->done gate, same boundary, ready->done --
  const secondFalseClaimIsActuallyFalse = "abc".length === 99; // live-verified
  assert(
    secondFalseClaimIsActuallyFalse === false,
    "sanity: the claim this fixture's checked AC box asserts is genuinely false"
  );

  const bodyB =
    `## Proposal\n${substantive("Proposal")}\n` +
    `## Plan\n${substantive("Plan")}\n` +
    `## AC\n- [x] "abc".length === 99 (a provably false claim, checked anyway)\n` +
    `## DoD\n${substantive("DoD")}\n`;
  {
    const r = checkGate({ id: "GAME-B", status: "ready", body: bodyB });
    assert(r.gate === "execute->done", "GAME-B: gate is execute->done");
    assert(
      r.ok === true,
      "GAME-B: EXPECTED, STRUCTURAL BEHAVIOR — same boundary on the " +
        "ready->done path, on the GitHub Provider: a checked-but-false AC " +
        "claim still passes, because checkGate() is a syntax counter, not " +
        "a semantic verifier. This is exactly why G3's independent, " +
        "out-of-band audit is mandatory and non-optional (protocol §6) for " +
        "Core and every Provider alike — the gate cannot, by itself, ever " +
        "be sufficient proof that native-Skill-driven work was done " +
        "correctly, only that it was described as done."
    );
  }

  // --- Case 3 (GAME-C): negative control — an HONEST gate failure works -
  // (proves this test file isn't merely testing "the gate always passes";
  // it demonstrates checkGate() correctly rejects genuinely unchecked
  // criteria, and ONLY the checked-but-false case slips through — the same
  // discipline the native original's GAME-C establishes.)
  const bodyC =
    `## Proposal\n${substantive("Proposal")}\n` +
    `## Plan\n${substantive("Plan")}\n` +
    `## AC\n- [ ] a real, unchecked criterion, long enough to clear the minimum-content threshold for this section\n` +
    `## DoD\n${substantive("DoD")}\n`;
  {
    const r = checkGate({ id: "GAME-C", status: "todo", body: bodyC });
    assert(r.gate === "author->ready", "GAME-C: gate is author->ready");
    assert(
      r.ok === false,
      "GAME-C: control case — an honestly-unchecked box still correctly " +
        "fails the gate (confirms this file is testing the false-but-" +
        "CHECKED gap specifically, not a broken gate that always passes)"
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exitCode = 1;
  } else {
    console.log(
      "\nAll gate-gameability tests passed on the GitHub Provider. The " +
        "checkbox-count-gameability boundary (proved native-only since " +
        "iteration 20, QN-030) is now demonstrated live on checkGate() " +
        "too. This boundary is NOT a bug; G3's independent out-of-band " +
        "audit is the actual, permanent compensating mechanism (protocol " +
        "§6), on both Providers alike."
    );
  }
}

main();
