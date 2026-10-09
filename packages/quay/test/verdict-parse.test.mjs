// @test-group product
// verdict-parse.test.mjs — the kernel leaf `packages/quay/src/kernel/verdict-parse.ts`.
// (GOAL-032 ① / task gap-goal032-verdict-parser-kernel-extraction.)
//
// WHAT THIS FILE IS FOR. `parseBinaryVerdict` is the SINGLE implementation of the fail-closed
// "judge stdout → three-state verdict" parse loop that two callers converged onto:
//   · packages/quay/src/criterion-fidelity.ts::parseFidelityVerdict  (faithful / vacuous)
//   · plugin/scripts/goal-driver.ts::parseSemanticSufficiencyVerdict (covered / insufficient)
// The two callers differ ONLY in their legal-value literals. So the assertions here are:
//
//   (A) BEHAVIOR, run TWICE — once per literal pair. The point of the convergence is that the
//       ALGORITHM is domain-agnostic; a suite that only exercised `("faithful","vacuous")` would
//       pass on a kernel that silently hard-coded those literals, i.e. it would NOT prove the
//       generalization (硬规则 4 推论三: a criterion satisfied by an injected fixture proves
//       "can produce", not "is general"). Every case below is generated for BOTH pairs.
//
//   (B) FAIL-CLOSED (硬规则 3b) — the cases that matter are the ones that must NOT return a
//       positive verdict: non-zero exit, empty output, prose, a JSON object without a `verdict`
//       key, and a JSON object with an ILLEGAL verdict value. Each is asserted `not-evaluated`,
//       never the positive literal. A parser that defaulted to positive would be
//       indistinguishable from "everything is fine" — exactly the放水实现 the AC-212 origin warns of.
//
//   (C) LAST-LINE-UPWARD SCAN — the real judge (`claude -p`) may prefix explanatory prose, so the
//       JSON object is scanned from the LAST line upward. Asserted positively (a trailing JSON line
//       behind prose is read) and negatively (prose with no JSON anywhere is not).

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBinaryVerdict } from "../src/kernel/verdict-parse.ts";

// The two domain literal pairs the converged callers pass. Every behavioral case runs for each.
const LITERAL_PAIRS = [
  { label: "fidelity (faithful/vacuous)", positive: "faithful", negative: "vacuous" },
  { label: "sufficiency (covered/insufficient)", positive: "covered", negative: "insufficient" },
];

for (const { label, positive, negative } of LITERAL_PAIRS) {
  const P = positive;
  const N = negative;

  test(`${label}: bare positive token → positive`, () => {
    assert.equal(parseBinaryVerdict(P, 0, P, N), P);
  });

  test(`${label}: bare negative token → negative`, () => {
    assert.equal(parseBinaryVerdict(N, 0, P, N), N);
  });

  test(`${label}: bare token is trimmed before matching`, () => {
    assert.equal(parseBinaryVerdict(`  ${P}\n`, 0, P, N), P);
    assert.equal(parseBinaryVerdict(`\n\t${N}  \r\n`, 0, P, N), N);
  });

  test(`${label}: single-line JSON {"verdict":"<positive>"} → positive`, () => {
    assert.equal(parseBinaryVerdict(`{"verdict":"${P}"}`, 0, P, N), P);
  });

  test(`${label}: single-line JSON {"verdict":"<negative>"} → negative`, () => {
    assert.equal(parseBinaryVerdict(`{"verdict":"${N}"}`, 0, P, N), N);
  });

  test(`${label}: last-line-upward scan — trailing JSON behind prose is read`, () => {
    const stdout = [
      "Let me reason about the coverage of this criterion.",
      "The scan surface appears to include a directory never referenced by any pattern.",
      `{"verdict":"${N}"}`,
    ].join("\n");
    assert.equal(parseBinaryVerdict(stdout, 0, P, N), N);
  });

  test(`${label}: last-line-upward scan reaches a JSON line above non-JSON trailing lines`, () => {
    const stdout = [
      `{"verdict":"${P}"}`,
      "some trailing commentary that is not JSON",
    ].join("\n");
    assert.equal(parseBinaryVerdict(stdout, 0, P, N), P);
  });

  test(`${label}: non-zero exit → not-evaluated even with a valid verdict token`, () => {
    assert.equal(parseBinaryVerdict(P, 1, P, N), "not-evaluated");
    assert.equal(parseBinaryVerdict(`{"verdict":"${P}"}`, 137, P, N), "not-evaluated");
  });

  test(`${label}: null exit code (unknown) → not-evaluated`, () => {
    assert.equal(parseBinaryVerdict(P, null, P, N), "not-evaluated");
  });

  test(`${label}: empty / whitespace-only output → not-evaluated`, () => {
    assert.equal(parseBinaryVerdict("", 0, P, N), "not-evaluated");
    assert.equal(parseBinaryVerdict("   \n\t  \n", 0, P, N), "not-evaluated");
  });

  test(`${label}: null stdout → not-evaluated`, () => {
    assert.equal(parseBinaryVerdict(null, 0, P, N), "not-evaluated");
  });

  test(`${label}: prose with no JSON anywhere → not-evaluated (never falls back to positive)`, () => {
    const stdout = "I could not reach a conclusion about this criterion.";
    assert.equal(parseBinaryVerdict(stdout, 0, P, N), "not-evaluated");
  });

  test(`${label}: JSON object WITHOUT a verdict key → not-evaluated`, () => {
    assert.equal(parseBinaryVerdict(`{"reason":"looks fine to me"}`, 0, P, N), "not-evaluated");
    assert.equal(parseBinaryVerdict(`{"confidence":0.9}`, 0, P, N), "not-evaluated");
  });

  test(`${label}: JSON with an ILLEGAL verdict value → not-evaluated`, () => {
    assert.equal(parseBinaryVerdict(`{"verdict":"maybe"}`, 0, P, N), "not-evaluated");
    assert.equal(parseBinaryVerdict(`{"verdict":true}`, 0, P, N), "not-evaluated");
    // The OTHER domain's literal must not be accepted either — a kernel that hard-coded one pair
    // would leak the wrong domain's verdict here.
    const otherPositive = LITERAL_PAIRS.find((p) => p.positive !== P).positive;
    assert.equal(parseBinaryVerdict(`{"verdict":"${otherPositive}"}`, 0, P, N), "not-evaluated");
    assert.equal(parseBinaryVerdict(otherPositive, 0, P, N), "not-evaluated");
  });

  test(`${label}: non-JSON line elsewhere does not abort the upward scan`, () => {
    const stdout = ["not json at all", `{"verdict":"${N}"}`, "trailing"].join("\n");
    assert.equal(parseBinaryVerdict(stdout, 0, P, N), N);
  });
}

// The convergence's load-bearing claim, asserted structurally: the two callers pass DIFFERENT
// literals, so the same stdout must map to DIFFERENT verdicts. A kernel that accepted only one
// hard-coded pair would fail this.
test("domain-agnostic: the same prose+JSON stdout resolves per the caller's literals", () => {
  const stdout = "reasoning...\n" + `{"verdict":"covered"}`;
  assert.equal(parseBinaryVerdict(stdout, 0, "covered", "insufficient"), "covered");
  assert.equal(parseBinaryVerdict(stdout, 0, "faithful", "vacuous"), "not-evaluated");
});
