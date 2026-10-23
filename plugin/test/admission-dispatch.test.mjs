// @test-group engine
// AC-925 criterion — the Planner's C1 entry bar DISPATCHES on the registry's `admission` field
// (task gap-ac925-admission-dispatch-criterion-test, GOAL-911).
//
// WHY THIS FILE EXISTS SEPARATELY. The dispatch mechanism landed under AC-918 and is covered there by
// `ownership-active-limited-proposal.test.mjs` (AC918-1..5). AC-925's own acceptance evidence needs a
// carrier that can take the FALSE value on its own, so this file asserts the dispatch through a
// DIFFERENT instrument than AC918 does — and ⛔ imports no part of that test file (two criteria sharing
// one import would be one criterion wearing two names):
//
//   (i)   a COUNTING `semanticAdmission` spy — the mechanical route must invoke the judge ZERO times,
//         not merely produce a mechanical-looking answer (a silent extra confirmation is invisible to
//         an assertion that only reads the verdict);
//   (ii)  a SYNTHETIC registry entry that keeps the real package-cycle readers/threshold and varies
//         ONLY `kind` × `admission` — a 2×2 cross control that separates "reads the admission field"
//         from "the kind name happens to route here";
//   (iii) a MODULE SEAM (`QUAY_ADMISSION_DISPATCH_MODULE`, default = the real module) so AC-925's
//         negative control can run THIS SAME FILE against a mutated copy of the module in a temp dir.
//         ⛔ The real tree is never mutated: the seam only changes what is imported, never what is
//         written. Without the seam the negative control could only be a claim ("this would fail"),
//         which is exactly the fixture-echo shape 硬规则 4 推论三 rules out.
//
// The fixtures are built HERE (not imported): a legal computed delta, three live production records,
// `decision_memory:{status:"not-known"}`, evidence refs + a machine-written envelope. They are shaped
// like the loop's carrier records because `evaluateEntryBar` is pure over that shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const REAL_MODULE_PATH = path.join(REPO, "docs/analysis/ownership-active-limited-proposal.mjs");

// ── the seam (see (iii) above). Default: the module in THIS tree. ───────────────────────────────────
const SEAM_ENV = "QUAY_ADMISSION_DISPATCH_MODULE";
const MODULE_PATH = process.env[SEAM_ENV] ? path.resolve(process.env[SEAM_ENV]) : REAL_MODULE_PATH;
const underTest = await import(pathToFileURL(MODULE_PATH).href);

const {
  CONDITIONS,
  CONCERN_ADMISSIONS,
  CONCERN_KIND_REGISTRY,
  CONCERN_KIND_IN_SCOPE,
  evaluateEntryBar,
  concernKindEntry,
} = underTest;

// ── fixtures (self-built; ⛔ no import from any other test file) ─────────────────────────────────────
const goodDelta = () => ({
  status: "evaluated",
  delta: {
    before: { scc_size: 6, members: ["", "cli", "fan-in", "gate", "gate/config", "gate/factories"] },
    after: { scc_size: 4, members: ["", "gate", "gate/config", "gate/factories"] },
    left: ["cli", "fan-in"],
    removed_edges: [{ from: "cli", to: "fan-in", names: ["probeInstruments"] }],
    added_edges: [],
  },
  negative_control: {
    falsified: true,
    restore_edges: [{ from: "cli", to: "fan-in" }],
    members_after_restore: ["", "cli", "fan-in", "gate", "gate/config", "gate/factories"],
  },
  provenance: { provenance_consistency: { status: "match" } },
});

const rec = (over = {}) => ({
  run_id: "live:1",
  label: "live",
  commit: "abc1234567890def",
  ts_iso: "2026-10-11T00:00:00Z",
  concern_kind: CONCERN_KIND_IN_SCOPE,
  slice_delta: goodDelta(),
  decision_memory: { status: "not-known" },
  envelope: {
    evidence_refs: ["ev-1", "ev-2"],
    expected_mechanical_delta: "ArchGuard slice-delta (computed): cycle size 6 -> 4",
  },
  evidence: [{ id: "ev-1" }, { id: "ev-2" }],
  subject_files: ["packages/quay/src/cli/driver.ts", "packages/quay/src/cli/driver-vocab.ts"],
  ...over,
});

/** Three consecutive live runs carrying the SAME computed delta — enough for the mechanical route to
 *  clear C4 (streak=3, occurrences=3 ≥ the registry's threshold). The semantic route never reads them;
 *  that asymmetry is the point of AC925-2. */
const productionStreak = (kind) =>
  ["s1", "s2", "s3"].map((n) => rec({ run_id: `live:${n}`, concern_kind: kind }));

/** A counting spy. Its IMPLEMENTATION admits (so a wrongly-consulted judge cannot hide behind a
 *  refusal) — the only thing it reports is HOW MANY TIMES it was called, and with what. */
const countingJudge = (impl) => {
  const calls = [];
  const judge = (record, entry) => {
    calls.push({ record, kind: entry?.kind ?? null });
    return impl ? impl(record, entry) : undefined;
  };
  judge.calls = calls;
  return judge;
};

// ── AC1/AC2: the MECHANICAL route — confirmed by the delta path, judge called ZERO times ────────────
test("AC925-1(mechanical): the real package-cycle route clears C1-C4 through the delta path and never invokes the judge", () => {
  const entry = concernKindEntry(CONCERN_KIND_IN_SCOPE);
  assert.equal(entry?.admission, CONCERN_ADMISSIONS.MECHANICAL, "the real package-cycle entry is mechanical");

  const judge = countingJudge(() => ({
    admit: true,
    verdict: "confirmed",
    counterfactual: "this judge must never be consulted on the mechanical route",
  }));
  const records = productionStreak(CONCERN_KIND_IN_SCOPE);
  const v = evaluateEntryBar(records, { semanticAdmission: judge });

  // (a) the counting assertion — the FALSE value this criterion can take: one call is a red.
  assert.equal(judge.calls.length, 0, `⛔ the mechanical route invoked the semantic judge ${judge.calls.length} time(s); the delta path is authoritative and no semantic confirmation may run`);

  // (b) it really was the delta path, all four conditions in order.
  assert.equal(v.eligible, true, v.reason);
  assert.deepEqual(v.matchedConditions, [CONDITIONS.KIND, CONDITIONS.DELTA, CONDITIONS.MEMORY, CONDITIONS.STREAK]);
  assert.ok(v.matchedConditions.includes(CONDITIONS.DELTA), "the computed delta is matched");
  assert.equal(v.streak.length, 3);
  assert.match(v.reason, /^ELIGIBLE:concern_kind=package-cycle/);
  assert.equal(v.reason.includes("admission=semantic-judged"), false, "the mechanical verdict must not claim the semantic route");
});

// ── AC3: the SEMANTIC-JUDGED route — a perfect mechanical delta is a CLUE, never a confirmation ─────
const SYNTHETIC_KIND = "ac925-synthetic-semantic";
/** The real package-cycle entry, re-labelled: same readers / threshold / mechanized=true, so the
 *  mechanical path COULD clear C2-C4 for it. Only `kind` and `admission` differ. */
const syntheticEntry = (kind, admission) => {
  const base = concernKindEntry(CONCERN_KIND_IN_SCOPE);
  return { ...base, kind, admission };
};
const registryWith = (...entries) => [
  ...CONCERN_KIND_REGISTRY.filter((e) => e.kind !== CONCERN_KIND_IN_SCOPE),
  ...entries,
];

test("AC925-2(semantic-judged): a perfect mechanical delta never confirms a semantic-judged kind", () => {
  const registry = registryWith(syntheticEntry(SYNTHETIC_KIND, CONCERN_ADMISSIONS.SEMANTIC_JUDGED));
  const records = productionStreak(SYNTHETIC_KIND);
  // bait: the SAME legal, computed, falsifiable control, provenance-matched delta the mechanical test uses
  assert.deepEqual(records[0].slice_delta, goodDelta());

  // (a) NO judge injected ⇒ its OWN value, and no mechanical condition may be matched.
  const absent = evaluateEntryBar(records, { registry });
  assert.equal(absent.eligible, false, absent.reason);
  assert.ok(absent.reason.startsWith("CONDITION_1_SEMANTIC_NOT_EVALUATED:"), absent.reason);
  assert.match(absent.reason, new RegExp(SYNTHETIC_KIND));
  assert.equal(absent.matchedConditions.includes(CONDITIONS.DELTA), false, "⛔ the delta was read on the semantic route");
  assert.equal(absent.matchedConditions.includes(CONDITIONS.MEMORY), false, "⛔ the memory was read on the semantic route");
  assert.equal(absent.matchedConditions.includes(CONDITIONS.STREAK), false, "⛔ the streak was read on the semantic route");
  assert.equal(absent.streak.length, 0);

  // (b) an admitting judge WITH a counterfactual ⇒ eligible, C1 is the ONLY matched condition.
  const judge = countingJudge(() => ({
    admit: true,
    verdict: "confirmed",
    counterfactual: "if the state were owned by its declaring module, the judge would return admit:false",
  }));
  const confirmed = evaluateEntryBar(records, { registry, semanticAdmission: judge });
  assert.equal(judge.calls.length, 1, "the semantic route consults the judge exactly once");
  assert.equal(judge.calls[0].kind, SYNTHETIC_KIND, "the judge is handed the entry that routed here");
  assert.equal(confirmed.eligible, true, confirmed.reason);
  assert.deepEqual(confirmed.matchedConditions, [CONDITIONS.KIND], "only C1 is matched — no mechanical signal was consumed");
  assert.match(confirmed.reason, /admission=semantic-judged/);

  // (c) a refusing judge ⇒ a NAMED refusal carrying its verdict (not "not evaluated").
  const refused = evaluateEntryBar(records, { registry, semanticAdmission: () => ({ admit: false, verdict: "refuted" }) });
  assert.equal(refused.eligible, false);
  assert.ok(refused.reason.startsWith(`CONDITION_1_SEMANTIC_REFUSED:concern_kind=${SYNTHETIC_KIND} verdict=refuted`), refused.reason);
  assert.equal(refused.matchedConditions.includes(CONDITIONS.DELTA), false);
});

// ── AC4: the dispatch reads `admission`, not the kind's SPELLING (2×2 cross control) ────────────────
test("AC925-3(dispatch-by-admission): the 2x2 cross control — admission decides, the kind name does not", () => {
  const KIND_A = "ac925-cross-a";
  const KIND_B = "ac925-cross-b";   // the SAME shape under a different kind spelling
  const cells = [
    { admission: CONCERN_ADMISSIONS.MECHANICAL, kind: KIND_A },
    { admission: CONCERN_ADMISSIONS.SEMANTIC_JUDGED, kind: KIND_A },
    { admission: CONCERN_ADMISSIONS.MECHANICAL, kind: KIND_B },
    { admission: CONCERN_ADMISSIONS.SEMANTIC_JUDGED, kind: KIND_B },
  ];
  const rows = cells.map(({ admission, kind }) => {
    const registry = registryWith(syntheticEntry(kind, admission));
    // identical records in every cell — only the ENTRY's admission (and the kind's spelling) moves
    const v = evaluateEntryBar(productionStreak(kind), { registry });
    return { admission, kind, eligible: v.eligible, reasonPrefix: v.reason.slice(0, v.reason.indexOf(":") + 1) || v.reason.slice(0, 32) };
  });
  console.log(`AC925 cross-control table ${JSON.stringify(rows)}`);

  // ① flipping ONLY `admission` flips the route, for EACH kind spelling
  for (const kind of [KIND_A, KIND_B]) {
    const mech = rows.find((r) => r.kind === kind && r.admission === CONCERN_ADMISSIONS.MECHANICAL);
    const sem = rows.find((r) => r.kind === kind && r.admission === CONCERN_ADMISSIONS.SEMANTIC_JUDGED);
    assert.equal(mech.eligible, true, `${kind}: mechanical admission must clear the bar through the delta path`);
    assert.equal(mech.reasonPrefix, "ELIGIBLE:");
    assert.equal(sem.eligible, false, `${kind}: semantic-judged admission must NOT be mechanically confirmed`);
    assert.equal(sem.reasonPrefix, "CONDITION_1_SEMANTIC_NOT_EVALUATED:");
  }
  // ② replacing the KIND NAME while holding `admission` fixed changes nothing — so the branch is not
  //    keyed on the spelling (a name-keyed dispatch would make one of these pairs disagree).
  for (const admission of [CONCERN_ADMISSIONS.MECHANICAL, CONCERN_ADMISSIONS.SEMANTIC_JUDGED]) {
    const a = rows.find((r) => r.kind === KIND_A && r.admission === admission);
    const b = rows.find((r) => r.kind === KIND_B && r.admission === admission);
    assert.deepEqual([a.eligible, a.reasonPrefix], [b.eligible, b.reasonPrefix], `admission=${admission}: the kind's spelling must not move the dispatch`);
  }
});
