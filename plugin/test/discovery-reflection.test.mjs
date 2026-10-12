// @test-group engine
// Tests for the DISCOVERY REFLECTION module (task gap-discovery-method-reflection-unified-trigger-and-
// candidate-generation, AC a–e + the no-hand-coding static control). The contract under test: a
// bounded reflection trigger that turns the Experience ledger into `DiscoveryMethod` CANDIDATES — with
// a model seam that is injectable (a stub here, the hardened launcher in the real run), a kill switch
// that makes every entry point a no-op, budget that STOPS and REPORTS rather than silently truncating,
// and a `draft → active` promotion gate that a wrong cross-case prediction can never slip past.
//
// ⛔ The static control at the bottom is the load-bearing one: it PINS the "no hand-coding the answer"
// requirement as a CHECKED property of the production source, so the property cannot rot back unnoticed.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECISIONS, DEFAULT_BUDGET, NET_NEW_DISCOVERY_VALUE, REFLECTION_ATTEMPTS_REL,
  experienceSignature, groupExperiencesBySignature, selectExperiencesForReflection, resolveBudget,
  buildReflectionPrompt, buildGeneralizationPrompt, validateReflectionDecision, assembleCandidate,
  reflect, validateGeneralization, roleExpectedVerdicts,
  attemptsFile, readReflectionAttempts, recordReflectionAttempt,
  computeReflectionCost, learningQuality, registryDigest, runReflectionRound,
} from "../../docs/analysis/discovery-reflection.mjs";
import { subjectKey } from "../../docs/analysis/architecture-evidence-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(HERE, "..", "..", "docs", "analysis", "discovery-reflection.mjs");

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-reflection-")); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

/** A ledger-shaped Experience fixture. */
const expFixture = (over = {}) => ({
  kind: "experience",
  id: "experience-0123456789abcdef",
  case_id: "EXP-alpha",
  ts: "2026-10-12T00:00:00.000Z",
  role: "found-and-fixed",
  reported_by: "system",
  source_ref: "outcome-0123456789abcdef",
  evidence: [{ ref: "outcome-0123456789abcdef", sha256: "0".repeat(64) }],
  components: ["plugin/scripts/alpha.ts", "plugin/scripts/beta.ts"],
  summary: "an alpha writer and an alpha checker declare the same field set independently, so the two drift apart silently",
  ...over,
});

/** A method-registry record fixture (only the fields `registryDigest`/the validator read). */
const methodFixture = (over = {}) => ({
  kind: "method", id: "method-fixture", method_id: "shared-contract-divergence", version: 1,
  ts: "2026-10-12T00:00:00.000Z", provenance_evidence: ["experience-0123456789abcdef"],
  applicability: { domain_signals: ["duplicated declaration"], preconditions: ["two modules declare one contract"] },
  operation: { steps: ["read both declarations"], tools: ["arch-discovery-routine.ts"] },
  expected_invariant: "the two declarations agree field-for-field",
  falsification: "a single shared source is imported by both readers",
  cost_budget: { max_candidates: 1, max_model_calls: 1, max_wall_ms: 1000 },
  status: "draft", retirement_reason: null, supersedes: null,
  ...over,
});

/** A valid model decision that assembles into a candidate the registry validator accepts. */
const decisionFixture = (over = {}) => ({
  decision: "new",
  method_ref: null,
  method_id: "shared-contract-divergence",
  why_proposed: "two independently-declared copies of one contract is a class of defect that recurs across modules",
  evidence_pattern: "one semantic field set declared in more than one module without a shared source",
  transferable_operation: "locate both declarations, diff their field sets, and report any asymmetry",
  applicability_boundary: "does not apply when a single module is the only declaration site",
  expected_invariant: "every declaration of the same field set lists the same fields",
  falsification: "the second declaration imports the first, so there is only one source",
  counterexample: null,
  operation_tools: ["arch-discovery-routine.ts"],
  ...over,
});

/** A stub model that returns a fixed decision object as plain stdout, counting its calls. */
const stubModel = (obj, counter = null) => async () => {
  if (counter) counter.calls++;
  return { stdout: typeof obj === "string" ? obj : JSON.stringify(obj), status: 0 };
};

// ── AC(a): same-signature dedup into ONE reflection unit, with the count reported ────────────────

test("AC1(a): two experiences with the same subjectKey signature collapse into ONE unit, count reported", () => {
  const a = expFixture({ id: "experience-aaaaaaaaaaaaaaaa", case_id: "EXP-a" });
  const b = expFixture({ id: "experience-bbbbbbbbbbbbbbbb", case_id: "EXP-b" });   // identical role+components
  assert.equal(experienceSignature(a), experienceSignature(b), "same role+components ⇒ same signature");
  assert.equal(experienceSignature(a), subjectKey(a.role, a.components), "the signature REUSES the evidence store's subjectKey");

  const units = groupExperiencesBySignature([a, b]);
  assert.equal(units.length, 1, "one unit, not two");
  assert.equal(units[0].experiences.length, 2);

  const sel = selectExperiencesForReflection([a, b], []);
  assert.equal(sel.ok, true);
  assert.equal(sel.batch_size, 1, "the batch is ONE unit");
  assert.equal(sel.merged_within_batch, 1, "…and the merge is REPORTED, not silent");
  assert.equal(sel.units_evaluated, 1);

  // A different file set is a DIFFERENT signature ⇒ a separate unit (no over-merging).
  const c = expFixture({ id: "experience-cccccccccccccccc", case_id: "EXP-c", components: ["plugin/scripts/gamma.ts"] });
  const sel2 = selectExperiencesForReflection([a, b, c], []);
  assert.equal(sel2.batch_size, 2, "a distinct component set stays separate");
});

test("AC1(a): a signature already reflected-on in a PRIOR attempt is dropped, and reported", () => {
  const a = expFixture({ case_id: "EXP-a", components: ["plugin/scripts/alpha.ts"] });
  const prior = [{ kind: "reflection_attempt", signature: experienceSignature(a), ts: new Date().toISOString() }];
  const sel = selectExperiencesForReflection([a], prior);
  assert.equal(sel.batch_size, 0);
  assert.equal(sel.skipped_prior, 1, "the dedup is REPORTED, not silent");

  // `dedupWindow` narrows "prior": an OLD attempt outside the window does NOT suppress.
  const old = [{ signature: experienceSignature(a), ts: "2000-01-01T00:00:00.000Z" }];
  assert.equal(selectExperiencesForReflection([a], old, { dedupWindow: 60_000, nowMs: Date.parse("2026-10-12T00:00:00Z") }).batch_size, 1);
  // …and an attempt with an UNPARSEABLE ts suppresses (an unreadable window is not "never reflected").
  assert.equal(selectExperiencesForReflection([a], [{ signature: experienceSignature(a), ts: "not-a-date" }], { dedupWindow: 60_000 }).batch_size, 0);
});

test("AC1(a): `maxPerRun` caps the batch and the cap is REPORTED", () => {
  const xs = [1, 2, 3].map((n) => expFixture({ id: `experience-${"0".repeat(15)}${n}`, case_id: `EXP-${n}`, components: [`plugin/scripts/f${n}.ts`] }));
  const sel = selectExperiencesForReflection(xs, [], { maxPerRun: 2 });
  assert.equal(sel.batch_size, 2);
  assert.equal(sel.skipped_cap, 1);
});

// ── AC(b): the kill switch makes every entry point a no-op with ZERO model calls ──────────────────

test("AC1(b): enabled:false ⇒ reflect returns {ok:false,reason:'disabled'} and makes ZERO model calls", async () => {
  const counter = { calls: 0 };
  const r = await reflect({ experiences: [expFixture({})], registry: [], model: stubModel(decisionFixture(), counter), budget: { enabled: false } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "disabled");
  assert.equal(counter.calls, 0, "the kill switch is enforced BEFORE any call");
  assert.equal(r.model_calls, 0);

  const sel = selectExperiencesForReflection([expFixture({})], [], { budget: { enabled: false } });
  assert.deepEqual({ ok: sel.ok, reason: sel.reason }, { ok: false, reason: "disabled" });

  const vg = await validateGeneralization({ candidate: methodFixture(), heldOutCase: expFixture(), model: stubModel("{}", counter), budget: { enabled: false } });
  assert.equal(vg.ok, false);
  assert.equal(vg.reason, "disabled");
  assert.equal(counter.calls, 0, "validateGeneralization honours the kill switch too");
});

test("AC1(b): a malformed budget is REFUSED (its own reason), never silently coerced", () => {
  assert.deepEqual(resolveBudget({ enabled: "yes" }), { ok: false, reason: "BUDGET_INVALID:enabled-must-be-boolean" });
  assert.deepEqual(resolveBudget({ maxModelCalls: -1 }), { ok: false, reason: "BUDGET_INVALID:maxModelCalls-must-be-an-integer->=0" });
  assert.equal(resolveBudget({}).budget.maxModelCalls, DEFAULT_BUDGET.maxModelCalls);
});

// ── AC(c): exceeding maxModelCalls stops further calls and REPORTS how many were skipped ─────────

test("AC1(c): exceeding maxModelCalls mid-batch STOPS further calls and reports the skipped count", async () => {
  const units = [1, 2, 3].map((n) => expFixture({ id: `experience-${"0".repeat(15)}${n}`, case_id: `EXP-${n}`, components: [`plugin/scripts/f${n}.ts`] }));
  const counter = { calls: 0 };
  const r = await reflect({ experiences: units, registry: [], model: stubModel(decisionFixture(), counter), budget: { maxModelCalls: 1 } });
  assert.equal(r.ok, true);
  assert.equal(counter.calls, 1, "exactly the budgeted number of calls is made");
  assert.equal(r.model_calls, 1);
  assert.equal(r.skipped_budget, 2, "the two uncalled units are REPORTED, not silently dropped");
  const skipped = r.decisions.filter((d) => d.skipped === true);
  assert.equal(skipped.length, 2);
  for (const s of skipped) assert.deepEqual(s.reasons, ["BUDGET_MAX_MODEL_CALLS"]);
  // The batch is NOT silently truncated: every unit carries a decision row (called or skipped).
  assert.equal(r.decisions.length, 3);
});

// ── AC(d): a wrong cross-case prediction never silently promotes ──────────────────────────────────

test("AC1(d): a WRONG generalization prediction retires the candidate with a non-null reason (never promotes)", async () => {
  // The candidate was fitted on one experience; the held-out case's role demands "refuted".
  const candidate = assembleCandidate({ rec: decisionFixture(), unit: { experiences: [expFixture({ id: "experience-inbatch000000" })] }, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });
  const heldOut = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", role: "confirmed-negative" });
  assert.deepEqual(roleExpectedVerdicts("confirmed-negative"), ["refuted"]);

  const wrong = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel({ invariant_holds: true, verdict: "supported", reasoning: "it looks fine" }), budget: {} });
  assert.equal(wrong.ok, true);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.promoted, false, "a wrong prediction MUST NOT promote");
  assert.equal(wrong.candidate_after.status, "retired");
  assert.ok(wrong.retirement_reason && wrong.retirement_reason.length > 0, "a retired candidate carries a non-null retirement_reason");

  // A CORRECT prediction DOES promote (the positive control for the same gate).
  const right = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel({ invariant_holds: false, verdict: "refuted", reasoning: "the claim does not hold" }), budget: {} });
  assert.equal(right.correct, true);
  assert.equal(right.promoted, true);
  assert.equal(right.candidate_after.status, "active");
  assert.equal(right.candidate_after.retirement_reason, null);

  // An UNEVALUABLE reading (turn budget / unparseable) is NOT a refutation: stays `draft`, promoted:false.
  const unparseable = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel("no json here"), budget: {} });
  assert.equal(unparseable.correct, null);
  assert.equal(unparseable.promoted, false);
  assert.equal(unparseable.candidate_after.status, "draft", "an unmeasured reading leaves the candidate draft, never retired");
  assert.equal(unparseable.not_evaluated_reason, "UNPARSEABLE_MODEL_OUTPUT");
  assert.equal(unparseable.retirement_reason, null);
});

test("AC1(d): a held-out case INSIDE the candidate's own batch is refused (transfer is not self-grading)", async () => {
  const inBatch = expFixture({ id: "experience-inbatch000000" });
  const candidate = assembleCandidate({ rec: decisionFixture(), unit: { experiences: [inBatch] }, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });
  const r = await validateGeneralization({ candidate, heldOutCase: inBatch, model: stubModel({ verdict: "supported" }), budget: {} });
  assert.equal(r.ok, false);
  assert.equal(r.called, false);
  assert.match(r.reason, /^HELD_OUT_INSIDE_THE_BATCH:/);
});

// ── AC(e): `extends`/`composes` must name a method_ref that RESOLVES, or the record is refused ────

test("AC1(e): decision extends with an UNRESOLVED method_ref is REFUSED; a resolvable one is accepted", async () => {
  const registry = [methodFixture({ method_id: "shared-contract-divergence" })];

  const bad = validateReflectionDecision({ ...decisionFixture(), decision: "extends", method_ref: "does-not-exist" }, { registry });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.reasons, ["METHOD_REF_UNRESOLVED:does-not-exist-is-not-a-method_id-in-the-registry"]);

  const missing = validateReflectionDecision({ ...decisionFixture(), decision: "composes", method_ref: null }, { registry });
  assert.equal(missing.ok, false);
  assert.match(missing.reasons[0], /^METHOD_REF_REQUIRED:/);

  const good = validateReflectionDecision({ ...decisionFixture(), decision: "extends", method_ref: "shared-contract-divergence" }, { registry });
  assert.equal(good.ok, true);

  // Through reflect(): the unresolvable arm produces a REFUSAL row (not a silent candidate).
  const counter = { calls: 0 };
  const r = await reflect({ experiences: [expFixture({})], registry, model: stubModel({ ...decisionFixture(), decision: "extends", method_ref: "does-not-exist" }, counter), budget: {} });
  assert.equal(r.decisions.length, 1);
  assert.equal(r.decisions[0].ok, false);
  assert.match(r.decisions[0].reasons[0], /^METHOD_REF_UNRESOLVED:/);
  assert.equal(r.decisions[0].candidate, undefined, "no candidate is produced from a refused decision");

  // …and the resolvable arm appends a NEW VERSION of the existing method_id.
  const r2 = await reflect({ experiences: [expFixture({})], registry, model: stubModel({ ...decisionFixture(), decision: "extends", method_ref: "shared-contract-divergence" }), budget: {} });
  assert.equal(r2.decisions[0].ok, true, `expected acceptance, got ${r2.decisions[0].reasons?.join(",")}`);
  assert.equal(r2.decisions[0].candidate.method_id, "shared-contract-divergence");
  assert.equal(r2.decisions[0].candidate.version, 2, "a new version of the existing method_id");
  assert.equal(r2.decisions[0].candidate.status, "draft");
});

test("AC1(e)/(3): a `no-method` verdict is a REAL judgment (ok, no candidate), distinct from a refusal", async () => {
  const r = await reflect({ experiences: [expFixture({})], registry: [], model: stubModel({ decision: "no-method", method_id: null, why_proposed: "one-off with no transferable operation" }), budget: {} });
  assert.equal(r.decisions[0].ok, true);
  assert.equal(r.decisions[0].decision, "no-method");
  assert.equal(r.decisions[0].candidate, null);

  // `no-method` carrying a method_id is a contradiction ⇒ refused.
  const c = validateReflectionDecision({ decision: "no-method", method_id: "something" }, { registry: [] });
  assert.equal(c.ok, false);
  assert.match(c.reasons[0], /^METHOD_ID_FORBIDDEN:/);

  // An unparseable model output is a REFUSAL, not a `no-method` (hard rule 3b).
  const bad = await reflect({ experiences: [expFixture({})], registry: [], model: stubModel("no json"), budget: {} });
  assert.equal(bad.decisions[0].ok, false);
  assert.deepEqual(bad.decisions[0].reasons, ["UNPARSEABLE_MODEL_OUTPUT"]);
});

// ── prompt isolation: no cross-experience leakage at the PROMPT level ─────────────────────────────

test("prompt isolation: a unit's reflection prompt never carries a DIFFERENT unit's material", () => {
  const a = expFixture({ id: "experience-aaaaaaaaaaaaaaaa", case_id: "EXP-alpha-case", components: ["plugin/scripts/alpha_unique.ts"] });
  const b = expFixture({ id: "experience-bbbbbbbbbbbbbbbb", case_id: "EXP-beta-case", components: ["plugin/scripts/beta_unique.ts"], summary: "a beta-only summary that must not leak into the alpha prompt" });
  const units = groupExperiencesBySignature([a, b]);
  assert.equal(units.length, 2);
  const pa = buildReflectionPrompt({ unit: units[0], registry: [], toolNames: ["arch-discovery-routine.ts"] });
  assert.ok(pa.includes("EXP-alpha-case"));
  assert.ok(!pa.includes("EXP-beta-case"), "unit B's case_id must NOT appear in unit A's prompt");
  assert.ok(!pa.includes("beta_unique.ts"), "unit B's components must NOT appear in unit A's prompt");
  assert.ok(!pa.includes("beta-only summary"), "unit B's summary must NOT appear in unit A's prompt");
  // The registry IS shown in full (prior-round knowledge, not another batch member's answer).
  const pr = buildReflectionPrompt({ unit: units[0], registry: [methodFixture()], toolNames: [] });
  assert.ok(pr.includes("shared-contract-divergence"), "the full registry is shown to the model");
});

// ── carrier + metrics + orchestration ─────────────────────────────────────────────────────────────

test("the reflection-attempt carrier round-trips and then suppresses the next round's re-ask", () => {
  const root = mkTmp();
  const a = expFixture({ case_id: "EXP-a", components: ["plugin/scripts/alpha.ts"] });
  const r = recordReflectionAttempt(root, { ts: "2026-10-12T00:00:00Z", signature: experienceSignature(a), case_ids: ["EXP-a"], decision: "no-method", ok: true, skipped: false, candidate_method_id: null, reasons: [] });
  assert.equal(r.ok, true);
  assert.equal(attemptsFile(root), path.join(root, REFLECTION_ATTEMPTS_REL));
  const read = readReflectionAttempts(root);
  assert.equal(read.ok, true);
  assert.equal(read.records.length, 1);
  // The recorded attempt now suppresses the same signature on the next selection.
  assert.equal(selectExperiencesForReflection([a], read).batch_size, 0);
  // A refused attempt (no signature) appends nothing.
  assert.equal(recordReflectionAttempt(root, { decision: "no-method" }).ok, false);
  assert.equal(readReflectionAttempts(root).records.length, 1);
});

test("runReflectionRound reads the carriers, selects, reflects, and records one attempt per unit", async () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "discovery-experience-ledger.jsonl"),
    [expFixture({ id: "experience-aaaaaaaaaaaaaaaa", case_id: "EXP-a" }), expFixture({ id: "experience-bbbbbbbbbbbbbbbb", case_id: "EXP-b", components: ["plugin/scripts/beta.ts"] })].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const r = await runReflectionRound(root, { model: stubModel(decisionFixture()), budget: {} });
  assert.equal(r.ok, true);
  assert.equal(r.selection.batch_size, 2);
  assert.equal(r.ledger.records, 2);
  const attempts = readReflectionAttempts(root);
  assert.equal(attempts.records.length, 2, "one attempt recorded per reflected unit");
  // A second round finds nothing to do (both signatures were reflected-on).
  const r2 = await runReflectionRound(root, { model: stubModel(decisionFixture()), budget: {} });
  assert.equal(r2.selection.batch_size, 0);
  assert.equal(r2.selection.skipped_prior, 2);
});

test("metrics: reflection_cost sums present usage only; learning_quality is null when nothing was evaluated", () => {
  const cost = computeReflectionCost([
    { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, cost_usd: 0.01 },
    { usage: null, cost_usd: null },
  ], { wall_ms: 42 });
  assert.equal(cost.model_calls, 2);
  assert.equal(cost.tokens.input, 10, "an unmeasured call contributes nothing, never a fabricated 0 for a MEASURED total");
  assert.equal(cost.cost_usd, 0.01);
  assert.equal(cost.wall_ms, 42);

  // All-unmeasured ⇒ null (its own value), never 0.
  assert.equal(computeReflectionCost([{ usage: null, cost_usd: null }]).cost_usd, null);
  assert.equal(computeReflectionCost([{ usage: null }]).tokens.input, null);

  assert.deepEqual(learningQuality([]), { value: null, evaluated: 0, correct: 0, not_evaluated: 0 });
  assert.deepEqual(learningQuality([{ correct: true }, { correct: false }, { correct: null }]), { value: 0.5, evaluated: 2, correct: 1, not_evaluated: 1 });
  assert.equal(NET_NEW_DISCOVERY_VALUE, "not-yet-measured", "never 0 — 0 would read as 'measured and found nothing'");
});

test("registryDigest exposes exactly what the model needs (method_id/status/signals/operation/invariant)", () => {
  const d = registryDigest([methodFixture({ method_id: "m1" })]);
  assert.equal(d.length, 1);
  assert.deepEqual(Object.keys(d[0]).sort(), ["domain_signals", "expected_invariant", "method_id", "preconditions", "status", "steps"]);
});

// ── the static control: NO HAND-CODING THE ANSWER (the load-bearing AC) ───────────────────────────
// The reflection step must never be TOLD, nor hand-code, any specific symbol / file pair from the seed
// material. This reads the PRODUCTION source and asserts ZERO occurrences of any seed symbol — a
// mutation that pastes one in (even in a comment) turns this red, so the property cannot rot back.

test("static control: the production source contains ZERO occurrences of any seed symbol (no hand-coding)", () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  const SEED_SYMBOLS = ["probe-routine", "meta-driver", "checker-io", "fan-in-ff-protocol-check",
    "fan-in-queueing-model", "per-task-suite-record", "touches-parser"];
  for (const sym of SEED_SYMBOLS) {
    const hits = src.split("\n").map((l, i) => (l.includes(sym) ? i + 1 : null)).filter(Boolean);
    assert.deepEqual(hits, [], `seed symbol '${sym}' must not appear in the production logic (lines ${hits.join(",")})`);
  }
  // A non-zero control on the SAME predicate: the predicate CAN fire (so a zero is a real zero).
  assert.ok(src.includes("discovery-reflection"), "the predicate finds a token that IS present");
});
