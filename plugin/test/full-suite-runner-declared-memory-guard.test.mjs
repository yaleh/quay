// @test-group engine
// full-suite-runner-declared-memory-guard.test.mjs —
//   gap-suite-declared-memory-max-swallowed-by-shared-host-split.
//
// A DECLARED suite ceiling (`.quay/config.yml` `suite: memory_max:` / `QUAY_SUITE_MEMORY_MAX`) was
// SILENTLY SWALLOWED by the shared-host multi-scope split: on this host the split (`sharedHostCeilingBytes`,
// N=17 sibling scopes) is 26.00 GiB, which is BELOW what an operator may write down (人 2026-10-15 裁定:
// 32G is acceptable) — so the declaration never took effect (`bound: "host-guard"`).
//
// The fix (人 2026-10-15 裁定) selects the guardrail BY THE PROVENANCE OF THE DECLARATION — an explicit
// declaration is bounded by the PROJECT-BLIND fraction (0.25 × effective host total), the project-blind
// DEFAULT keeps the multi-scope split. `sharedHostCeilingBytes`, the 0.25 fraction and the default `16G`
// are all untouched. The canonical statement lives in `suiteHostGuard`'s block comment in
// plugin/scripts/full-suite-runner.ts — ⛔ not re-stated here (硬规则 5b).
//
// WHY INJECTED READINGS: the three ACs are written against the 2026-10-15 read-only readings of THIS
// host (247.0 GiB total / 17 sibling scopes). They are INJECTED, not read from the running host, so the
// numbers hold on any machine — the same discipline as the anchor/suite envelope unit tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The shared-host split's ONE implementation lives in driver-runtime.ts (⛔ no second copy of the
// formula here — 硬规则 5b); the project-blind fraction's ONE implementation lives in Core's leaf.
import { sharedHostCeilingBytes, listSharedHostScopes } from "../scripts/driver-runtime.ts";
import { defaultScopeMemoryMax, SCOPE_ENVELOPE_HOST_FRACTION } from "../../packages/quay/src/systemd-scope.ts";
import {
  suiteHostGuard,
  suiteMemoryMax,
  resolveSuiteMemoryMax,
  readEffectiveTotalMemBytes,
  SUITE_MEMORY_MAX_DEFAULT,
} from "../scripts/full-suite-runner.ts";

const GIB = 1024 ** 3;

/** The 2026-10-15 readings the ACs are written against: `os.totalmem()` = 247.0 GiB, 17 sibling scopes.
 *  ⛔ Injected — a reading taken from the host running the suite would make these ACs host-dependent. */
const AC_TOTAL_BYTES = 265_182_715_904; // 247.0 GiB
const AC_SIBLING_SCOPES = 17;
/** `defaultScopeMemoryMax(247.0 GiB, 0.25)` = the project-blind guardrail (≈ 61.74 GiB). */
const AC_PROJECT_BLIND_BYTES = 66_295_676_928;
/** `sharedHostCeilingBytes(247.0 GiB, 17)` = the multi-scope fair share (26.00 GiB, floor-dominated). */
const AC_SPLIT_BYTES = 27_917_287_424;
/** `32G` in bytes — the declaration 人 2026-10-15 裁定 acceptable. */
const DECLARED_32G = 34_359_738_368;

test("AC1 — a DECLARED 32G ceiling is not swallowed: the guardrail is the PROJECT-BLIND fraction", () => {
  const declared = { value: "32G", source: "env" };
  const guard = suiteHostGuard({ effectiveTotalMemBytes: AC_TOTAL_BYTES, declared, siblingScopeCount: AC_SIBLING_SCOPES });
  assert.equal(guard.rule, "project-blind", "a declaration (config/env) ⇒ the project-blind rule");
  assert.equal(guard.hostGuardBytes, AC_PROJECT_BLIND_BYTES, "0.25 × the effective host total, page-aligned");
  assert.equal(
    guard.hostGuardBytes,
    Number(defaultScopeMemoryMax(AC_TOTAL_BYTES, SCOPE_ENVELOPE_HOST_FRACTION)),
    "…and it IS the shared pure derivation (⛔ no second fraction in this file)",
  );
  assert.notEqual(guard.hostGuardBytes, AC_SPLIT_BYTES, "…and ⛔ NOT the multi-scope split");

  const decision = suiteMemoryMax({ effectiveTotalMemBytes: AC_TOTAL_BYTES, declared, hostGuard: guard });
  assert.equal(decision.memoryMax, String(DECLARED_32G), "the declared 32G is the applied ceiling");
  assert.equal(decision.bound, "declared", "⛔ not silently lowered to the 26 GiB split");
  assert.equal(decision.reason, null, "nothing clamped it ⇒ no clamp reason");
  // The pre-fix behaviour this pins: the split is BELOW the declaration, which is exactly why the
  // declaration used to vanish. If the split ever rose above 32G this AC's discriminating power
  // disappears — assert the premise, not just the conclusion (硬规则 4 推论四).
  assert.ok(AC_SPLIT_BYTES < DECLARED_32G, `the 26 GiB split is below the declared 32G (${AC_SPLIT_BYTES})`);
});

test("AC2 — the DEFAULT is UNCHANGED: the multi-scope split still bounds it and 16G still applies", () => {
  const declared = { value: SUITE_MEMORY_MAX_DEFAULT, source: "default" };
  assert.equal(declared.value, "16G", "the shipped default really is 16G (⛔ not restated as a literal below)");
  const guard = suiteHostGuard({ effectiveTotalMemBytes: AC_TOTAL_BYTES, declared, siblingScopeCount: AC_SIBLING_SCOPES });
  assert.equal(guard.rule, "shared-host-split", "the project-blind DEFAULT keeps the multi-scope split");
  assert.equal(guard.hostGuardBytes, AC_SPLIT_BYTES, "26.00 GiB — the value the host's 17 sibling scopes produce");
  assert.equal(
    guard.hostGuardBytes,
    sharedHostCeilingBytes(AC_TOTAL_BYTES, AC_SIBLING_SCOPES),
    "…byte-identical to the shared split (the default path is untouched by this fix)",
  );
  assert.equal(AC_SPLIT_BYTES, 26 * GIB, "the split really is 26 GiB, not a near-miss");
  assert.ok(AC_SPLIT_BYTES < AC_PROJECT_BLIND_BYTES, "the split is the TIGHTER of the two ⇒ choosing it is a real choice");

  const decision = suiteMemoryMax({ effectiveTotalMemBytes: AC_TOTAL_BYTES, declared, hostGuard: guard });
  assert.equal(decision.memoryMax, String(16 * GIB), "the default 16G still applies, in bytes");
  assert.equal(decision.bound, "declared", "16G < the 26 GiB guardrail, so the declared default is what binds");
});

test("AC3 — a declaration ABOVE the project-blind fraction is still clamped, with a NAMED reason", () => {
  const declared = { value: "80G", source: "env" };
  assert.ok(80 * GIB > AC_PROJECT_BLIND_BYTES, "the fixture declaration really is above the project-blind upper bound");
  const guard = suiteHostGuard({ effectiveTotalMemBytes: AC_TOTAL_BYTES, declared, siblingScopeCount: AC_SIBLING_SCOPES });
  assert.equal(guard.rule, "project-blind", "the guard is still selected by provenance — it did not become the split");

  const decision = suiteMemoryMax({ effectiveTotalMemBytes: AC_TOTAL_BYTES, declared, hostGuard: guard });
  assert.equal(decision.bound, "host-guard", "an above-host declaration is the host-guard case");
  assert.equal(decision.memoryMax, String(AC_PROJECT_BLIND_BYTES), "the PROJECT-BLIND bound applies (⛔ not the 26 GiB split)");
  assert.equal(Number(decision.memoryMax), decision.hostGuardBytes, "the applied ceiling IS the guardrail it was clamped to");
  assert.ok(typeof decision.reason === "string" && decision.reason.length > 0, "⛔ a bare clamp with no reason is not evidence");
  assert.match(decision.reason, /exceeds the host-relative guardrail/, "the clamp says what happened");
  assert.match(decision.reason, /guard rule: project-blind/, "…and NAMES the rule that produced the upper bound");
});

test("AC1 (production wiring) — resolveSuiteMemoryMax routes a DECLARED ceiling through the project-blind guard", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-declared-guard-"));
  const saved = process.env.QUAY_SUITE_MEMORY_MAX;
  process.env.QUAY_SUITE_MEMORY_MAX = "32G";
  try {
    const resolved = resolveSuiteMemoryMax(dir);
    assert.equal(resolved.declared, "32G", "the declaration reached the resolver (the knob is the mechanism)");
    assert.equal(resolved.declaredSource, "env", "…and is labelled as a declaration, not as the default");
    // N-INDEPENDENT oracle: the project-blind value does not depend on the sibling-scope count, so this
    // assertion is stable even if a scope appears/disappears between the resolver's read and this one.
    const projectBlind = Number(defaultScopeMemoryMax(readEffectiveTotalMemBytes(), SCOPE_ENVELOPE_HOST_FRACTION));
    assert.equal(resolved.hostGuardBytes, projectBlind, "the guardrail IS the project-blind value ⇒ the wiring is real");
    const split = sharedHostCeilingBytes(readEffectiveTotalMemBytes(), listSharedHostScopes().count);
    if (split !== projectBlind) {
      assert.notEqual(resolved.hostGuardBytes, split, "⛔ and NOT the multi-scope split (this host can tell them apart)");
    }
    // The applied ceiling follows the declaration, bounded by whichever guard THIS host derives.
    assert.equal(Number(resolved.memoryMax), Math.min(DECLARED_32G, projectBlind));
    assert.equal(resolved.bound, DECLARED_32G <= projectBlind ? "declared" : "host-guard");
  } finally {
    if (saved === undefined) delete process.env.QUAY_SUITE_MEMORY_MAX;
    else process.env.QUAY_SUITE_MEMORY_MAX = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 (production wiring, negative control) — an UNDECLARED ceiling still goes through the multi-scope split", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-default-guard-"));
  const saved = process.env.QUAY_SUITE_MEMORY_MAX;
  delete process.env.QUAY_SUITE_MEMORY_MAX;
  try {
    const total = readEffectiveTotalMemBytes();
    const nBefore = listSharedHostScopes().count;
    const resolved = resolveSuiteMemoryMax(dir);
    const nAfter = listSharedHostScopes().count;
    assert.equal(resolved.declaredSource, "default", "no declaration ⇒ the default is in play");
    assert.equal(resolved.declared, SUITE_MEMORY_MAX_DEFAULT);
    assert.equal(resolved.memoryMax, String(16 * GIB), "the default 16G is what applies, unchanged");
    assert.ok(
      resolved.hostGuardBytes <= Number(defaultScopeMemoryMax(total, SCOPE_ENVELOPE_HOST_FRACTION)),
      "a non-declared ceiling is never guarded more loosely than the project-blind fraction",
    );
    if (nBefore !== null && nBefore === nAfter) {
      // The split is stable across the resolver's read ⇒ assert the exact rule that produced the guard.
      assert.equal(resolved.hostGuardBytes, sharedHostCeilingBytes(total, nBefore), "the DEFAULT path still goes through the split");
    }
  } finally {
    if (saved === undefined) delete process.env.QUAY_SUITE_MEMORY_MAX;
    else process.env.QUAY_SUITE_MEMORY_MAX = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
