// @test-group engine
// Tests for the DISCOVERY REFLECTION module (task gap-discovery-method-reflection-unified-trigger-and-
// candidate-generation, AC a–e + the no-hand-coding static control — plus the held-out LINEAGE /
// TEMPORAL-BINDING ACs of gap-discovery-method-generalization-lineage-and-temporal-binding). The
// contract under test: a bounded reflection trigger that turns the Experience ledger into
// `DiscoveryMethod` CANDIDATES — with a model seam that is injectable (a stub here, the hardened
// launcher in the real run), a kill switch that makes every entry point a no-op, budget that STOPS and
// REPORTS rather than silently truncating, and a `draft → active` promotion gate that a wrong
// cross-case prediction can never slip past — where the held-out case must sit OUTSIDE the candidate's
// whole method lineage AND be read at a commit where its expected verdict is actually true.
//
// ⛔ The static control at the bottom is the load-bearing one: it PINS the "no hand-coding the answer"
// requirement as a CHECKED property of the production source, so the property cannot rot back unnoticed.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DECISIONS, DEFAULT_BUDGET, NET_NEW_DISCOVERY_VALUE, REFLECTION_ATTEMPTS_REL,
  experienceSignature, groupExperiencesBySignature, selectExperiencesForReflection, resolveBudget,
  buildReflectionPrompt, buildGeneralizationPrompt, validateReflectionDecision, assembleCandidate,
  reflect, validateGeneralization, roleExpectedVerdicts,
  attemptsFile, readReflectionAttempts, recordReflectionAttempt,
  computeReflectionCost, learningQuality, independentLearningQuality, registryDigest, runReflectionRound,
  lineageVersions, checkLineageIsolation, validateEvaluationPin, checkTemporalBinding,
  gitIsAncestor, verifyStrippedPin, materializeStrippedPin, DISCOVERY_PIN_FORBIDDEN_DIRS,
  isPositiveCase, LINEAGE_MIN_SHARED_COMPONENTS,
  readGeneralizationVerdicts, recordGeneralizationVerdict, verdictsFile, VERDICT_KIND,
  APPLIES_VOCAB, OUTCOME_NOT_APPLICABLE, evidencePackForPin,
  // the GLOBAL CASE-IDENTITY INDEX (task gap-discovery-holdout-cross-experiment-leak-and-
  // contaminated-promotion): one identity per case, built from every carrier that can name one.
  CASE_IDENTITY_INDEX_REL, SEALED_SET_CONTAMINATED, HELD_OUT_PREVIOUSLY_USED,
  MIN_SHARED_CASE_COMPONENTS, LABEL_AFTER_PREREG, PREREG_AFTER_FIRST_CALL,
  caseComponentsOf, caseCollisions, checkSealedSetContamination, buildCaseIdentityIndex,
  caseIndexSha256, writeCaseIdentityIndex, readCaseIdentityIndex, caseIdentityIndexFile,
  readSealedSet, validateCaseLabelTiming, validateSealedSetBinding, caseLabelSha256, COLLISION_KINDS,
  firstUseOfSealedPath,
  // task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection: the reflection launcher's
  // argv carrier + the prompt's code-access block.
  reflectionLaunchArgv,
} from "../../docs/analysis/discovery-reflection.mjs";
import { hardenedArgv } from "../../docs/analysis/arch-hypothesis-generation.mjs";
import { GENERALIZATION_VERDICTS_REL } from "../../docs/analysis/discovery-experience-ledger.mjs";
import { subjectKey } from "../../docs/analysis/architecture-evidence-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(HERE, "..", "..", "docs", "analysis", "discovery-reflection.mjs");
const REPO_ROOT = path.resolve(HERE, "..", "..");

const tmpDirs = [];
const plainTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-reflection-")); tmpDirs.push(d); return d; };
/** A REAL git repo: every Discovery carrier resolves through `git rev-parse --git-common-dir` to the
 *  SHARED checkout, so a bare directory is no longer a usable fixture root (an unresolvable shared
 *  checkout is REFUSED by design). */
const mkTmp = () => { const d = plainTmp(); execFileSync("git", ["init", "-q", d], { stdio: "ignore" }); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

/** An EMPTY directory satisfies the stripped-pin predicate (nothing forbidden is present) — the cheap
 *  cwd for the cases that are about the LINEAGE/pin FIELD checks rather than about materialisation. */
const strippedTmp = () => mkTmp();

/** A minimal REAL git repo: a pre-fix commit that carries the methodology/state directories the strip
 *  must delete, the fix commit, and a later commit. Real git, real shas — so `git archive`, the
 *  `merge-base --is-ancestor` seam and the strip removal are exercised for real, not simulated. */
const mkGitRepo = () => {
  const dir = mkTmp();
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  git("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", "t.md"), "# t\n");
  fs.writeFileSync(path.join(dir, ".quay", "config.yml"), "providers: {}\n");
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "target.ts"), "export const x = 1;\n");
  git("add", "-A"); git("commit", "-qm", "pre-fix");
  const preFix = git("rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(dir, "plugin", "scripts", "target.ts"), "export const x = 2;\n");
  git("add", "-A"); git("commit", "-qm", "fix");
  const fix = git("rev-parse", "HEAD").trim();
  git("commit", "-q", "--allow-empty", "-m", "later");
  return { dir, preFix, fix, later: git("rev-parse", "HEAD").trim() };
};

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
  // `confirmed-negative` is NOT a positive case, so it binds no `fix_commit`; it still names the pin it
  // is read at, and the verifier still runs in a (here: empty, therefore stripped) tree rather than live.
  const heldOut = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", role: "confirmed-negative", source_ref: "outcome-heldout00000000", components: ["plugin/scripts/heldout.ts"], evaluation_pin: "1".repeat(40) });
  const pin = { pinDir: strippedTmp() };
  assert.deepEqual(roleExpectedVerdicts("confirmed-negative"), ["refuted"]);

  const wrong = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel({ invariant_holds: true, verdict: "supported", reasoning: "it looks fine" }), budget: {}, ...pin });
  assert.equal(wrong.ok, true);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.promoted, false, "a wrong prediction MUST NOT promote");
  assert.equal(wrong.candidate_after.status, "retired");
  assert.ok(wrong.retirement_reason && wrong.retirement_reason.length > 0, "a retired candidate carries a non-null retirement_reason");

  // A CORRECT prediction DOES promote (the positive control for the same gate).
  // ⛔ CHANGED by gap-discovery-evidence-level-teaching-vs-independent: a correct prediction only
  // reaches `active` on an `independent` verdict. The level is now DECLARED rather than implied —
  // a hold-out case sealed before the run and never used is exactly what `independent` names — and the
  // `promoted_to` reading says which state it reached.
  const right = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel({ invariant_holds: false, verdict: "refuted", reasoning: "the claim does not hold" }), budget: {}, evidenceLevel: "independent", ...pin });
  assert.equal(right.correct, true);
  assert.equal(right.promoted, true);
  assert.equal(right.evidence_level, "independent");
  assert.equal(right.promoted_to, "active");
  assert.equal(right.candidate_after.status, "active");
  assert.equal(right.candidate_after.retirement_reason, null);

  // An UNEVALUABLE reading (turn budget / unparseable) is NOT a refutation: stays `draft`, promoted:false.
  const unparseable = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel("no json here"), budget: {}, ...pin });
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

// ── AC(a–c): the held-out case must be outside the candidate's whole METHOD LINEAGE, not just the batch
//
// The defect reproduced here is the audit's finding #1: `shared-contract-divergence` v1 was seeded from
// evidence-store record `outcome-bb…`; v2 was "validated" against an Experience whose `source_ref` IS
// that record — i.e. against the same case, reached through a different version of the same method.

test("AC1(a): a held-out case whose source_ref sits in an EARLIER version's provenance ⇒ HELD_OUT_SHARES_LINEAGE (zero model calls)", async () => {
  const heldOut = expFixture({
    id: "experience-heldout0000000", case_id: "EXP-heldout", source_ref: "outcome-bb12a6858838e74b",
    components: ["plugin/scripts/heldout.ts"],
  });
  const v1 = methodFixture({ method_id: "shared-contract-divergence", version: 1, provenance_evidence: ["outcome-bb12a6858838e74b"] });
  const v2 = methodFixture({ method_id: "shared-contract-divergence", version: 2, provenance_evidence: ["experience-faninlock00000"] });

  // v2's OWN provenance does not carry the held-out ⇒ the pre-existing batch check passes, which is
  // exactly the hole: the leak is one version back, in the SAME method's lineage.
  const counter = { calls: 0 };
  const r = await validateGeneralization({ candidate: v2, heldOutCase: heldOut, registry: [v1, v2], model: stubModel({ verdict: "supported" }, counter), budget: {}, pinDir: strippedTmp() });
  assert.equal(counter.calls, 0, "a refused held-out case spends ZERO model calls");
  assert.equal(r.ok, false);
  assert.equal(r.called, false);
  assert.equal(r.refusal_code, "HELD_OUT_SHARES_LINEAGE");
  assert.equal(r.outcome, "not-evaluated", "a refusal is recorded as not-evaluated, never as a failed method");
  assert.equal(r.promoted, false);
  assert.equal(r.candidate_after.status, "draft", "a refusal NEVER retires the method");
  assert.deepEqual(r.candidate_after.provenance_evidence, ["experience-faninlock00000"], "the candidate is returned untouched");
  assert.deepEqual(r.lineage, ["shared-contract-divergence@2", "shared-contract-divergence@1"], "the WHOLE lineage was walked, candidate first");
  assert.deepEqual(r.lineage_hits.map((h) => h.kind), ["version_provenance"]);
  assert.equal(r.lineage_hits[0].ref, "outcome-bb12a6858838e74b");

  // POSITIVE CONTROL on the same predicate, inside the same test: drop v1 and the very same held-out
  // case is refused for its MISSING PIN instead — so the code above is the lineage, not a blanket no.
  const counter2 = { calls: 0 };
  const r2 = await validateGeneralization({ candidate: v2, heldOutCase: heldOut, registry: [v2], model: stubModel({ verdict: "supported" }, counter2), budget: {}, pinDir: strippedTmp() });
  assert.equal(r2.refusal_code, "NO_EVALUATION_PIN");
  assert.equal(counter2.calls, 0);
});

test("AC1(b): a held-out case sharing >= 2 components with a lineage SEED (a different record) is refused", async () => {
  const seed = expFixture({ id: "experience-seed00000000000", case_id: "EXP-seed", source_ref: "outcome-1111111111111111" });
  const candidate = methodFixture({ method_id: "shared-contract-divergence", version: 2, provenance_evidence: [seed.id] });
  // A DIFFERENT record (different id, different source_ref) describing the same two files.
  const sameDefect = expFixture({
    id: "experience-other0000000000", case_id: "EXP-other", source_ref: "outcome-2222222222222222",
    components: [...seed.components, "plugin/scripts/gamma.ts"],
  });
  const r = await validateGeneralization({ candidate, heldOutCase: sameDefect, registry: [candidate], experiences: [seed], model: stubModel({ verdict: "supported" }), budget: {}, pinDir: strippedTmp() });
  assert.equal(r.refusal_code, "HELD_OUT_SHARES_LINEAGE");
  assert.deepEqual(r.lineage_hits, [{ kind: "shared_components", ref: seed.id, shared: [...seed.components].sort() }]);

  // NEGATIVE CONTROL: ONE shared file is below the threshold — the same shape must NOT be refused for
  // lineage (it gets as far as its missing pin), so the >= 2 is a real discriminator, not a tautology.
  assert.equal(LINEAGE_MIN_SHARED_COMPONENTS, 2);
  const oneShared = expFixture({ id: "experience-one00000000000", case_id: "EXP-one", source_ref: "outcome-3333333333333333", components: [seed.components[0], "plugin/scripts/gamma.ts"] });
  const r2 = await validateGeneralization({ candidate, heldOutCase: oneShared, registry: [candidate], experiences: [seed], model: stubModel({ verdict: "supported" }), budget: {}, pinDir: strippedTmp() });
  assert.equal(r2.refusal_code, "NO_EVALUATION_PIN");

  // …and the one-hop RECORD path: the lineage version cites an Experience whose SOURCE is the held-out.
  const backPointer = expFixture({ id: "experience-via00000000000", case_id: "EXP-via", source_ref: sameDefect.source_ref, components: ["plugin/scripts/unrelated.ts"] });
  const r3 = await validateGeneralization({ candidate: methodFixture({ method_id: "m", version: 1, provenance_evidence: [backPointer.id] }), heldOutCase: sameDefect, registry: [], experiences: [backPointer], model: stubModel({ verdict: "supported" }), budget: {}, pinDir: strippedTmp() });
  assert.equal(r3.refusal_code, "HELD_OUT_SHARES_LINEAGE");
  assert.deepEqual(r3.lineage_hits.map((h) => h.kind), ["referenced_experience_source_ref"]);
});

test("AC1(c): a held-out case from an UNRELATED lineage is ACCEPTED and still promotes on a correct prediction", async () => {
  const repo = mkGitRepo();
  const pin = path.join(mkTmp(), "pin");
  assert.equal(materializeStrippedPin({ root: repo.dir, rev: repo.preFix, dir: pin }).ok, true);
  const heldOut = expFixture({
    id: "experience-heldout0000000", case_id: "EXP-heldout", role: "confirmed-negative",
    source_ref: "outcome-heldout00000000", components: ["plugin/scripts/heldout.ts"], evaluation_pin: repo.preFix,
  });
  const candidate = methodFixture({ method_id: "unrelated-method", version: 1, provenance_evidence: ["experience-someone00000000"] });
  const r = await validateGeneralization({ candidate, heldOutCase: heldOut, registry: [candidate], experiences: [], model: stubModel({ invariant_holds: false, verdict: "refuted" }), budget: {}, pinDir: pin, root: repo.dir, evidenceLevel: "independent" });
  assert.equal(r.outcome, "evaluated");
  assert.equal(r.refusal_code, null);
  assert.equal(r.called, true);
  assert.equal(r.promoted, true);
  assert.equal(r.promoted_to, "active");
  assert.equal(r.candidate_after.status, "active");
});

// ── AC(d–e): the expected verdict must be TRUE at the commit that is evaluated ─────────────────────
//
// The defect reproduced here is the audit's finding #2: the verifier read develop at a commit where the
// held-out case's fix had ALREADY landed, so the method's invariant holds there — the opposite of the
// verdict the case's historical role supplies — and the call was still graded "correct".

test("AC1(d): a held-out case with no `evaluation_pin` ⇒ NO_EVALUATION_PIN (its own refusal, zero calls)", async () => {
  const unpinned = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout" });   // role found-and-fixed
  assert.deepEqual(validateEvaluationPin(unpinned), { ok: false, reasons: ["NO_EVALUATION_PIN", "NO_FIX_COMMIT"] });
  // A POSITIVE case that names its pin but not its fix is refused for the fix ALONE (enumerated, 硬规则 3).
  assert.deepEqual(validateEvaluationPin({ role: "found-and-fixed", evaluation_pin: "a".repeat(40) }), { ok: false, reasons: ["NO_FIX_COMMIT"] });
  // A NEGATIVE case binds no fix — its pin alone completes the binding.
  assert.deepEqual(validateEvaluationPin({ role: "confirmed-negative", evaluation_pin: "a".repeat(40) }), { ok: true, reasons: [] });
  assert.equal(isPositiveCase("found-and-fixed"), true);
  assert.equal(isPositiveCase("confirmed-negative"), false, "a refuted claim was never a defect to fix");

  const counter = { calls: 0 };
  const r = await validateGeneralization({ candidate: methodFixture(), heldOutCase: unpinned, model: stubModel({ verdict: "supported" }, counter), budget: {}, pinDir: strippedTmp() });
  assert.equal(r.refusal_code, "NO_EVALUATION_PIN");
  assert.equal(counter.calls, 0, "a case that cannot say where its verdict is true spends ZERO model calls");
  assert.equal(r.promoted, false);
  assert.equal(r.candidate_after.status, "draft");
});

test("AC1(e): `fix_commit` being an ancestor of `evaluation_pin` ⇒ TEMPORAL_MISMATCH; the reverse order passes", async () => {
  const repo = mkGitRepo();
  // The real three-valued ancestry seam — `null` (could not determine) must NOT collapse into `false`.
  const isAncestor = gitIsAncestor(repo.dir);
  assert.equal(isAncestor(repo.fix, repo.later), true);
  assert.equal(isAncestor(repo.later, repo.fix), false);
  assert.equal(isAncestor("deadbeefdeadbeef", repo.later), null, "an unresolvable commit is NOT 'not an ancestor'");

  // THE AUDIT'S CASE: pin at a commit the fix has already reached.
  const tooLate = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", role: "found-and-fixed", components: ["plugin/scripts/heldout.ts"], evaluation_pin: repo.later, fix_commit: repo.fix });
  const t = checkTemporalBinding({ heldOutCase: tooLate, isAncestor });
  assert.equal(t.ok, false);
  assert.match(t.reason, /^TEMPORAL_MISMATCH:/);
  const counter = { calls: 0 };
  const r = await validateGeneralization({ candidate: methodFixture(), heldOutCase: tooLate, model: stubModel({ verdict: "supported" }, counter), budget: {}, pinDir: strippedTmp(), root: repo.dir, isAncestor });
  assert.equal(r.refusal_code, "TEMPORAL_MISMATCH");
  assert.equal(counter.calls, 0);
  assert.equal(r.outcome, "not-evaluated");
  assert.equal(r.candidate_after.status, "draft", "a mismatched PIN is not a failed method");

  // POSITIVE CONTROL: the SAME two commits in the other order (pin before the fix) bind correctly.
  const atFixTime = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", role: "found-and-fixed", components: ["plugin/scripts/heldout.ts"], evaluation_pin: repo.preFix, fix_commit: repo.fix });
  assert.equal(checkTemporalBinding({ heldOutCase: atFixTime, isAncestor }).ok, true);
  const ok = await validateGeneralization({ candidate: methodFixture(), heldOutCase: atFixTime, model: stubModel({ verdict: "supported" }), budget: {}, pinDir: strippedTmp(), root: repo.dir, isAncestor });
  assert.equal(ok.outcome, "evaluated");
  assert.equal(ok.promoted, true);
});

// ── AC(f): the verifier runs in a STRIPPED tree AT THE PIN — never the live checkout ───────────────

test("AC1(f): the verifier cwd is a stripped tree at the pin and the verdict records the evaluated commit", async () => {
  const repo = mkGitRepo();
  const pin = path.join(mkTmp(), "pin");
  const built = materializeStrippedPin({ root: repo.dir, rev: repo.preFix, dir: pin });
  assert.equal(built.ok, true);
  assert.deepEqual([...built.removed].sort(), [".quay", "tasks"], "the dirs PRESENT at the pin are the ones actually removed");
  assert.equal(built.stripped, true);
  assert.ok(!fs.existsSync(path.join(pin, "tasks")), "tasks/ is ABSENT from the pinned tree");
  assert.ok(!fs.existsSync(path.join(pin, ".quay")), ".quay/ is ABSENT from the pinned tree");
  assert.ok(fs.existsSync(path.join(pin, "plugin", "scripts", "target.ts")), "…and the CODE is still there");
  assert.deepEqual(DISCOVERY_PIN_FORBIDDEN_DIRS.filter((d) => fs.existsSync(path.join(REPO_ROOT, d))).sort(),
    [".quay", "adr", "archive", "docs", "experiments", "goals", "measurements", "meta", "milestones", "orchestration", "tasks"],
    "the live checkout carries EVERY forbidden dir, so running there is exactly what this refuses");

  // The SAME predicate, negatively: an unstripped directory is refused and NAMES what is present.
  const unstripped = mkTmp();
  fs.mkdirSync(path.join(unstripped, "tasks"));
  assert.equal(verifyStrippedPin(unstripped), "PIN_NOT_STRIPPED:tasks");
  assert.equal(verifyStrippedPin(pin), null);
  assert.equal(verifyStrippedPin(repo.dir, { repoRoot: repo.dir }), "PIN_IS_LIVE_CHECKOUT");
  assert.match(materializeStrippedPin({ root: repo.dir, rev: "deadbeefdeadbeef", dir: path.join(mkTmp(), "x") }).reason, /^PIN_MATERIALIZE_FAILED:/);

  const heldOut = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", role: "confirmed-negative", source_ref: "outcome-heldout00000000", components: ["plugin/scripts/heldout.ts"], evaluation_pin: repo.preFix });
  const candidate = methodFixture({ method_id: "unrelated-method", version: 1, provenance_evidence: ["experience-someone00000000"] });
  const r = await validateGeneralization({ candidate, heldOutCase: heldOut, registry: [candidate], model: stubModel({ invariant_holds: false, verdict: "refuted" }), budget: {}, pinDir: pin, root: repo.dir });
  assert.equal(r.outcome, "evaluated");
  assert.equal(r.verifier_cwd, pin, "the cwd the verifier was handed IS the pinned tree");
  assert.equal(r.evaluated_commit, repo.preFix, "the EVALUATED commit is recorded on the verdict");
  assert.ok(!fs.existsSync(path.join(r.verifier_cwd, "tasks")) && !fs.existsSync(path.join(r.verifier_cwd, ".quay")));

  // Handing it the LIVE checkout is its own refusal, with zero model calls.
  const counter = { calls: 0 };
  const live = await validateGeneralization({ candidate, heldOutCase: heldOut, registry: [candidate], model: stubModel({ verdict: "refuted" }, counter), budget: {}, pinDir: REPO_ROOT, root: REPO_ROOT });
  assert.equal(live.refusal_code, "PIN_IS_LIVE_CHECKOUT");
  assert.equal(counter.calls, 0);
  assert.equal(live.promoted, false);
});

test("lineageVersions walks every version of the method_id plus every `method:<id>@<v>` ref in provenance", () => {
  const v1 = methodFixture({ method_id: "m-a", version: 1, provenance_evidence: ["outcome-x"] });
  const v3 = methodFixture({ method_id: "m-a", version: 3, provenance_evidence: ["outcome-y"] });
  const other = methodFixture({ method_id: "m-b", version: 2, provenance_evidence: ["outcome-z"] });
  const unrelated = methodFixture({ method_id: "m-c", version: 1, provenance_evidence: ["outcome-v"] });
  const candidate = methodFixture({ method_id: "m-a", version: 4, provenance_evidence: ["method:m-b@2", "outcome-w"] });
  const lineage = lineageVersions(candidate, [v1, v3, other, unrelated, candidate]);
  assert.deepEqual(lineage.map((m) => `${m.method_id}@${m.version}`), ["m-a@4", "m-a@1", "m-a@3", "m-b@2"]);
  // A registry entry for an UNRELATED method is not dragged in.
  assert.ok(!lineage.some((m) => m.method_id === "m-c"), "m-c is neither the candidate's method_id nor a method:<id>@<v> ref");
  // The candidate is first, and never duplicated when it also appears in the registry.
  assert.equal(lineage[0], candidate);
  assert.equal(new Set(lineage).size, lineage.length);
  assert.deepEqual(checkLineageIsolation({ candidate, heldOutCase: expFixture({ id: "experience-nope000000000", source_ref: "outcome-nope" }), registry: [v1, v3, other], experiences: [] }), {
    ok: true, lineage: ["m-a@4", "m-a@1", "m-a@3", "m-b@2"], hits: [],
  });
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

  assert.deepEqual(learningQuality([]), { value: null, correct: 0, evaluated: 0, denominator: 0, not_evaluated: 0, not_applicable: 0, total: 0 });
  assert.deepEqual(learningQuality([{ correct: true }, { correct: false }, { correct: null }]),
    { value: 0.5, correct: 1, evaluated: 2, denominator: 2, not_evaluated: 1, not_applicable: 0, total: 3 });
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

// ── AC1(e) (task gap-discovery-method-record-tool-vs-subject-leak): the assembler STRIPS the subject ─
//
// The reflection prompt ASKS for instruments, but a request is not a guarantee: a model that answers
// "the tool I used was the file the finding is about" has said nothing about HOW TO LOOK. The strip is
// therefore mechanical, happens BEFORE the registry's validator sees the candidate, and is RECORDED —
// a candidate that silently lost half its tools would be indistinguishable from one the model never
// named them in (硬规则 3b).

test("AC1(e): assembleCandidate strips a subject file from `tools` and RECORDS what it stripped", () => {
  const seed = expFixture({
    id: "experience-seedcase000000", case_id: "EXP-seed", role: "found-and-fixed",
    components: ["plugin/scripts/alpha.ts", "plugin/scripts/beta.ts"],
  });
  const unit = { signature: experienceSignature(seed), experiences: [seed], representative: seed };
  const rec = decisionFixture({ operation_tools: ["alpha.ts", "arch-discovery-routine.ts"] });
  const candidate = assembleCandidate({ rec, unit, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });

  assert.deepEqual(candidate.operation.tools, ["arch-discovery-routine.ts"], "the subject file is not an instrument");
  assert.deepEqual(candidate.stripped_subject_tools, ["alpha.ts"], "…and what was removed is RECORDED, not silent");
  assert.deepEqual(candidate.provenance_evidence, [seed.id], "the strip is scoped by the candidate's own provenance");

  // The FULL path and the bare basename are the same file — both spellings are stripped.
  const bothWays = assembleCandidate({
    rec: decisionFixture({ operation_tools: ["plugin/scripts/beta.ts", "alpha.ts", "code-span-strip.ts"] }),
    unit, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z",
  });
  assert.deepEqual(bothWays.operation.tools, ["code-span-strip.ts"]);
  assert.deepEqual(bothWays.stripped_subject_tools, ["plugin/scripts/beta.ts", "alpha.ts"]);

  // Negative control on the SAME predicate: a decision naming only instruments strips NOTHING.
  const clean = assembleCandidate({ rec: decisionFixture(), unit, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });
  assert.deepEqual(clean.stripped_subject_tools, []);
  assert.deepEqual(clean.operation.tools, ["arch-discovery-routine.ts"]);

  // A unit with no components has no seed set: nothing is stripped (the strip is derived, not a ban list).
  const empty = assembleCandidate({
    rec: decisionFixture({ operation_tools: ["alpha.ts"] }),
    unit: { experiences: [expFixture({ id: "experience-nocomponents00", components: [] })] },
    registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z",
  });
  assert.deepEqual(empty.stripped_subject_tools, []);
});

test("AC1(e): the strip reaches the DECISION row — a model that names the subject files is visible, not silently repaired", async () => {
  const seed = expFixture({ id: "experience-seedcase000000", case_id: "EXP-seed", components: ["plugin/scripts/alpha.ts"] });
  const r = await reflect({
    experiences: [seed], registry: [], model: stubModel(decisionFixture({ operation_tools: ["alpha.ts", "arch-discovery-routine.ts"] })),
    budget: {}, nowIso: Date.parse("2026-10-12T00:00:00Z"),
  });
  assert.equal(r.ok, true);
  assert.equal(r.decisions.length, 1);
  const d = r.decisions[0];
  assert.equal(d.ok, true, d.reasons?.join(","));
  assert.deepEqual(d.stripped_subject_tools, ["alpha.ts"]);
  assert.deepEqual(d.candidate.operation.tools, ["arch-discovery-routine.ts"]);
  assert.deepEqual(d.candidate.stripped_subject_tools, ["alpha.ts"]);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// PERSISTENCE + THE VERDICT CARRIER (task gap-discovery-carriers-ephemeral-in-worktree)
//
// Two things are pinned here: (1) the attempt/verdict carriers resolve to the SHARED checkout, so a
// reflection round run inside a task worktree leaves state that survives the worktree; and (2) an
// EVALUATED verdict is RECORDED with a `verdict_ref` a draft→active promotion can cite — the registry's
// `PROMOTION_WITHOUT_VALID_GENERALIZATION` rule is only checkable because that ref resolves.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** A MAIN checkout plus a LINKED worktree, both real git checkouts under `os.tmpdir()`. */
const mkWorktreePair = () => {
  const main = mkTmp();
  const git = (...a) => execFileSync("git", ["-C", main, ...a], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  fs.writeFileSync(path.join(main, "seed.txt"), "seed\n");
  git("add", "-A"); git("commit", "-qm", "seed");
  const wt = path.join(plainTmp(), "wt");
  git("worktree", "add", "-q", "-b", "task/fixture", wt);
  return { main, worktree: wt };
};

test("AC2(a): the attempt + verdict carriers resolve to the MAIN checkout when written from a worktree", () => {
  const { main, worktree } = mkWorktreePair();
  const r = recordReflectionAttempt(worktree, { ts: "2026-10-12T00:00:00Z", signature: "sig-x", decision: "no-method", ok: true });
  assert.equal(r.ok, true, r.reasons?.join(","));
  assert.equal(attemptsFile(worktree), path.join(main, REFLECTION_ATTEMPTS_REL), "the attempt carrier is the MAIN checkout's");
  assert.equal(fs.existsSync(path.join(main, REFLECTION_ATTEMPTS_REL)), true);
  assert.equal(fs.existsSync(path.join(worktree, REFLECTION_ATTEMPTS_REL)), false, "…and NOT the worktree's");
  assert.equal(readReflectionAttempts(worktree).records.length, 1, "read back through the worktree root");

  const v = recordGeneralizationVerdict(worktree, { method_id: "m", held_out_case_id: "EXP-x", outcome: "evaluated", correct: true });
  assert.equal(v.ok, true, v.reasons?.join(","));
  assert.equal(verdictsFile(worktree), path.join(main, GENERALIZATION_VERDICTS_REL));
  assert.equal(readGeneralizationVerdicts(main).records.length, 1, "the verdict lands in the SAME shared checkout");

  // An unresolvable shared checkout is REFUSED here too — its own value, never a worktree-local file.
  const bare = plainTmp();
  const refused = recordReflectionAttempt(bare, { signature: "sig-y" });
  assert.equal(refused.ok, false);
  assert.equal(refused.appended, false);
  assert.match(refused.reasons[0], /^SHARED_CHECKOUT_UNRESOLVED:/);
  assert.deepEqual(fs.readdirSync(bare), [], "nothing was created under the unresolvable root");
});

test("AC2(f): an EVALUATED verdict is RECORDED with a verdict_ref; without a root it says so instead", async () => {
  const root = mkTmp();
  const heldOut = expFixture({
    id: "experience-heldout0000000", case_id: "EXP-heldout", role: "confirmed-negative",
    source_ref: "outcome-heldout00000000", components: ["plugin/scripts/heldout.ts"], evaluation_pin: "1".repeat(40),
  });
  const candidate = assembleCandidate({ rec: decisionFixture(), unit: { experiences: [expFixture({ id: "experience-inbatch000000" })] }, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });
  const pass = await validateGeneralization({
    candidate, heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }), budget: {}, pinDir: strippedTmp(), root,
  });
  assert.equal(pass.outcome, "evaluated");
  assert.equal(pass.correct, true);
  assert.equal(pass.verdict_recorded, true, "a root was given, so the verdict is on the carrier");
  assert.match(pass.verdict_ref, /^generalization_verdict-[0-9a-f]{16}$/);
  assert.equal(pass.lineage_ok, true, "the gate ran and passed");
  assert.equal(pass.temporal_ok, null, "`confirmed-negative` binds no fix_commit ⇒ the temporal gate was NEVER REACHED — null, not true (硬规则 3b)");

  const read = readGeneralizationVerdicts(root);
  assert.equal(read.ok, true);
  assert.equal(read.records.length, 1);
  const rec = read.records[0];
  assert.equal(rec.id, pass.verdict_ref, "the ref on the verdict IS the recorded line's id");
  assert.equal(rec.kind, VERDICT_KIND);
  assert.equal(rec.method_id, candidate.method_id);
  assert.equal(rec.held_out_case_id, "EXP-heldout");
  assert.equal(rec.outcome, "evaluated");
  assert.equal(rec.correct, true);
  assert.equal(rec.refusal_code, null);
  assert.equal(rec.lineage_ok, true);
  assert.equal(rec.temporal_ok, null);
  assert.equal(rec.promoted, true);
  assert.equal(rec.evaluation_pin, "1".repeat(40));

  // NO root ⇒ the verdict is returned untouched and NOTHING claims it was persisted.
  const noRoot = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }), budget: {}, pinDir: strippedTmp() });
  assert.equal(noRoot.outcome, "evaluated");
  assert.equal(noRoot.verdict_recorded, undefined, "no claim of persistence when there is nowhere to persist");
  assert.equal(readGeneralizationVerdicts(root).records.length, 1, "…and the carrier is unchanged");
});

test("AC2(f): a REFUSAL is not auto-recorded — the caller records it, and the two gate readings survive", async () => {
  const root = mkTmp();
  const heldOut = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", source_ref: "outcome-bb12a6858838e74b", components: ["plugin/scripts/heldout.ts"] });
  const v1 = methodFixture({ method_id: "shared-contract-divergence", version: 1, provenance_evidence: ["outcome-bb12a6858838e74b"] });
  const v2 = methodFixture({ method_id: "shared-contract-divergence", version: 2, provenance_evidence: ["experience-faninlock00000"] });
  const r = await validateGeneralization({ candidate: v2, heldOutCase: heldOut, registry: [v1, v2], model: stubModel({ verdict: "supported" }), budget: {}, pinDir: strippedTmp(), root });
  assert.equal(r.refusal_code, "HELD_OUT_SHARES_LINEAGE");
  assert.equal(r.lineage_ok, false, "the gate ran and FAILED");
  assert.equal(r.temporal_ok, null, "…and the temporal gate was never reached");
  assert.equal(readGeneralizationVerdicts(root).records.length, 0, "a refusal is a pre-condition on the READING, not a verdict on the method — nothing is recorded automatically");

  const recorded = recordGeneralizationVerdict(root, { ...r, method_id: v2.method_id, version: 2, held_out_case_id: heldOut.case_id });
  assert.equal(recorded.ok, true, recorded.reasons?.join(","));
  const rec = readGeneralizationVerdicts(root).records[0];
  assert.equal(rec.outcome, "not-evaluated");
  assert.equal(rec.refusal_code, "HELD_OUT_SHARES_LINEAGE");
  assert.equal(rec.correct, null, "an unevaluated verdict is null — never a fabricated false");
  assert.equal(rec.lineage_ok, false);
  assert.equal(rec.temporal_ok, null);

  // The record's required fields are enforced: a verdict with no method_id / no held-out case cannot
  // be recorded at all (so a promotion can never cite a half-identified verdict).
  assert.equal(recordGeneralizationVerdict(root, { method_id: "m", outcome: "evaluated" }).reasons[0], "VERDICT_HELD_OUT_CASE_ID_REQUIRED");
  assert.equal(recordGeneralizationVerdict(root, { held_out_case_id: "EXP-x" }).reasons[0], "VERDICT_METHOD_ID_REQUIRED");
  assert.equal(recordGeneralizationVerdict(root, null).reasons[0], "VERDICT_NOT_OBJECT");
  assert.equal(readGeneralizationVerdicts(root).records.length, 1, "none of the three malformed attempts was appended");
  // Re-recording the same verdict object is a DUPLICATE_ID no-op (content-addressed id).
  assert.equal(recordGeneralizationVerdict(root, { ...r, method_id: v2.method_id, version: 2, held_out_case_id: heldOut.case_id }).duplicate, true);
  assert.equal(readGeneralizationVerdicts(root).records.length, 1);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE FIXES of gap-discovery-method-generalization-failures-diagnosis-and-retest, each with the
// diagnosis reading that justified it.
//
//   (a) the reflection prompt shows the joined `domain_claim`, and the subject-strip still bars the
//       seed's own files from `operation.tools`;
//   (b) `applies:"no"` ⇒ `not-applicable` — neither correct nor retired;
//   (c) learning quality excludes not-applicable from its denominator and reports its count.
//   …plus the evidence pack that fixes the measured turn-budget exhaustion.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("FIX(a): the reflection prompt carries the joined `domain_claim`, and says so when there is none", () => {
  const claimed = expFixture({ domain_claim: "the writer and the checker declare the same field set independently", join_status: "linked" });
  const p1 = buildReflectionPrompt({ unit: { experiences: [claimed] }, registry: [], toolNames: [] });
  assert.ok(p1.includes("the writer and the checker declare the same field set independently"), "the claim reaches the model");
  assert.ok(p1.includes('"join_status": "linked"'));

  // A finding with NO recorded claim is VISIBLE as such — the model must not be able to read an absent
  // claim as an absent clause and invent one from the bookkeeping (硬规则 3b).
  const unjoined = expFixture({ domain_claim: null, join_status: "no-linked-claim-record" });
  const p2 = buildReflectionPrompt({ unit: { experiences: [unjoined] }, registry: [], toolNames: [] });
  assert.ok(p2.includes('"domain_claim": null'));
  assert.ok(p2.includes('"join_status": "no-linked-claim-record"'));
  assert.ok(p2.includes('answer \\"no-method\\"') || p2.includes('answer "no-method"'), "the rule that a claim-less finding yields no method is in the prompt");
  // Non-zero control on the SAME predicate: the two prompts really do differ.
  assert.notEqual(p1, p2);
});

test("FIX(a): the joined claim does NOT unbar the seed's files — the strip still runs on the same subject set", () => {
  const seed = expFixture({
    id: "experience-joinedseed0000", case_id: "EXP-joined",
    components: ["plugin/scripts/alpha.ts", "plugin/scripts/beta.ts"],
    // The claim text NAMES the subject files, exactly as a real joined claim does.
    domain_claim: "alpha.ts:40 and beta.ts:12 disagree about whether the second declaration is deliberate",
    join_status: "linked",
  });
  const unit = { signature: experienceSignature(seed), experiences: [seed], representative: seed };
  const candidate = assembleCandidate({
    rec: decisionFixture({ operation_tools: ["alpha.ts", "code-span-strip.ts", "plugin/scripts/beta.ts"] }),
    unit, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z",
  });
  assert.deepEqual(candidate.operation.tools, ["code-span-strip.ts"], "naming the subject files in the CLAIM does not make them instruments");
  assert.deepEqual(candidate.stripped_subject_tools, ["alpha.ts", "plugin/scripts/beta.ts"]);
  assert.deepEqual(candidate.provenance_evidence, [seed.id], "and the strip is still scoped by the seed's own provenance");
});

test("FIX(b): `applies:\"no\"` ⇒ `not-applicable` — neither correct, nor promoted, nor retired", async () => {
  const candidate = assembleCandidate({ rec: decisionFixture(), unit: { experiences: [expFixture({ id: "experience-inbatch000000" })] }, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });
  const heldOut = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", role: "found-and-fixed", source_ref: "outcome-heldout00000000", components: ["plugin/scripts/heldout.ts"], evaluation_pin: "1".repeat(40), fix_commit: "2".repeat(40) });
  const pin = { pinDir: strippedTmp(), isAncestor: () => false };
  assert.deepEqual(roleExpectedVerdicts("found-and-fixed"), ["supported"]);

  // The gate FIRES: the method's declared domain does not cover this case.
  const na = await validateGeneralization({
    candidate, heldOutCase: heldOut, budget: {}, ...pin,
    model: stubModel({ applies: "no", applies_reason: "the method keys on a verdict record; the target is source code with no record", verdict: "refuted" }),
  });
  assert.equal(na.ok, true);
  assert.equal(na.called, true, "the gate costs no extra call — it is answered inside the same one");
  assert.equal(na.outcome, OUTCOME_NOT_APPLICABLE);
  assert.equal(na.applies, "no");
  assert.equal(na.correct, null, "not-applicable is neither correct nor wrong");
  assert.equal(na.promoted, false);
  assert.equal(na.candidate_after.status, "draft", "the method is NOT retired — the whole point of the gate");
  assert.equal(na.retirement_reason, null);
  assert.equal(na.not_evaluated_reason, null, "it is not a failed reading either — a THIRD value");

  // CONTROL 1 — the gate does not swallow real failures. `applies:"yes"` with a wrong verdict retires.
  const wrong = await validateGeneralization({
    candidate, heldOutCase: heldOut, budget: {}, ...pin,
    model: stubModel({ applies: "yes", applies_reason: "it covers it", verdict: "refuted" }),
  });
  assert.equal(wrong.outcome, "evaluated");
  assert.equal(wrong.correct, false);
  assert.equal(wrong.candidate_after.status, "retired");
  assert.ok(wrong.retirement_reason.length > 0);

  // CONTROL 2 — a missing or out-of-vocabulary `applies` is `undetermined`, which PROCEEDS: "I could
  // not tell whether it applies" is not a licence to skip the test.
  const silent = await validateGeneralization({ candidate, heldOutCase: heldOut, budget: {}, ...pin, model: stubModel({ verdict: "refuted" }) });
  assert.equal(silent.applies, "undetermined");
  assert.equal(silent.outcome, "evaluated");
  const bogus = await validateGeneralization({ candidate, heldOutCase: heldOut, budget: {}, ...pin, model: stubModel({ applies: "maybe", verdict: "refuted" }) });
  assert.equal(bogus.applies, "undetermined");
  assert.equal(bogus.outcome, "evaluated");
  assert.deepEqual(APPLIES_VOCAB, ["yes", "no", "undetermined"]);
});

test("FIX(b): a `not-applicable` verdict is RECORDED (the diversion is countable) and cannot license a promotion", async () => {
  const root = mkTmp();
  const candidate = assembleCandidate({ rec: decisionFixture(), unit: { experiences: [expFixture({ id: "experience-inbatch000000" })] }, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });
  const heldOut = expFixture({ id: "experience-heldout0000000", case_id: "EXP-heldout", role: "found-and-fixed", source_ref: "outcome-heldout00000000", components: ["plugin/scripts/heldout.ts"], evaluation_pin: "1".repeat(40), fix_commit: "2".repeat(40) });
  const na = await validateGeneralization({
    candidate, heldOutCase: heldOut, root, budget: {}, pinDir: strippedTmp(), isAncestor: () => false,
    model: stubModel({ applies: "no", applies_reason: "outside the declared domain" }),
  });
  assert.equal(na.verdict_recorded, true, "the diversion is recorded, so a third party can recount it");
  const recorded = readGeneralizationVerdicts(root).records;
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].outcome, OUTCOME_NOT_APPLICABLE);
  assert.equal(recorded[0].applies, "no");
  assert.equal(recorded[0].correct, null);
  // The promotion rule's own predicate, applied to this recorded verdict: it does NOT pass.
  assert.equal(recorded[0].outcome === "evaluated" && recorded[0].correct === true, false, "a not-applicable line can never satisfy the promotion's `outcome:evaluated && correct:true`");
});

test("FIX(c): learning quality excludes not-applicable from the denominator and REPORTS its count", () => {
  const q = learningQuality([
    { outcome: "evaluated", correct: true },
    { outcome: "evaluated", correct: false },
    { outcome: OUTCOME_NOT_APPLICABLE, correct: null },
    { outcome: "not-evaluated", correct: null },
  ]);
  assert.equal(q.value, 0.5, "1 of the 2 APPLIED candidates was correct");
  assert.equal(q.denominator, 2, "correct / applicable-evaluated");
  assert.equal(q.correct, 1);
  assert.equal(q.not_applicable, 1, "the diversion is its own reported count, never folded into a ratio");
  assert.equal(q.not_evaluated, 1, "a failed READING is still counted separately from a non-applicable case");
  assert.equal(q.total, 4, "…and the four terms add up to what was fed in");

  // CONTROL on the same predicate: drop the not-applicable row and NOTHING else moves — so the
  // exclusion is the not-applicable arm and not a general amnesty.
  const without = learningQuality([{ outcome: "evaluated", correct: true }, { outcome: "evaluated", correct: false }, { outcome: "not-evaluated", correct: null }]);
  assert.deepEqual({ ...without, not_applicable: 1, total: 4 }, q);

  // Everything diverted ⇒ `null`, never a fabricated 0 (硬规则 3b).
  const allDiverted = learningQuality([{ outcome: OUTCOME_NOT_APPLICABLE }, { outcome: OUTCOME_NOT_APPLICABLE }]);
  assert.equal(allDiverted.value, null);
  assert.equal(allDiverted.denominator, 0);
  assert.equal(allDiverted.not_applicable, 2);
});

test("FIX(c-evidence-pack): the verifier prompt carries the deterministic pack, and `null` when it cannot be built", () => {
  // A real pin tree: two components whose shared symbol is declared in both.
  const pinDir = strippedTmp();
  fs.mkdirSync(path.join(pinDir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(pinDir, "plugin", "scripts", "alpha.ts"), "export const SHARED_FIELD_SET = 1;\nimport { b } from \"./beta.ts\";\n");
  fs.writeFileSync(path.join(pinDir, "plugin", "scripts", "beta.ts"), "export const SHARED_FIELD_SET = 2;\n");

  const pack = evidencePackForPin({ pinDir, components: ["plugin/scripts/alpha.ts", "plugin/scripts/beta.ts"], claim: "SHARED_FIELD_SET is declared in more than one module" });
  assert.ok(pack, "a pack IS built from a readable pin tree");
  assert.ok(pack.text.includes("DEF plugin/scripts/alpha.ts:"), "the definition line of the cited symbol is handed over");
  assert.ok(pack.text.includes("SHARED_FIELD_SET"));

  const prompt = buildGeneralizationPrompt({ candidate: methodFixture(), heldOutCase: expFixture(), evidencePack: pack });
  assert.ok(prompt.includes("DETERMINISTIC EVIDENCE PACK"), "…and it reaches the verifier prompt");
  assert.ok(prompt.includes("DEF plugin/scripts/beta.ts:"), "the SECOND declaration of the same symbol is shown — one line from one file cannot answer 'declared twice'");

  // The pack is deterministic: the same inputs render byte-identically.
  assert.equal(evidencePackForPin({ pinDir, components: ["plugin/scripts/alpha.ts", "plugin/scripts/beta.ts"], claim: "SHARED_FIELD_SET is declared in more than one module" }).text, pack.text);

  // `null` is its OWN value — an unbuildable pack must not render as a header over an empty body.
  assert.equal(evidencePackForPin({ pinDir, components: [], claim: "x" }), null);
  assert.equal(evidencePackForPin({ pinDir, components: ["plugin/scripts/does-not-exist.ts"], claim: "x" }), null);
  assert.equal(evidencePackForPin({ pinDir: null, components: ["plugin/scripts/alpha.ts"], claim: "x" }), null);
  const noPack = buildGeneralizationPrompt({ candidate: methodFixture(), heldOutCase: expFixture(), evidencePack: null });
  assert.ok(!noPack.includes("DETERMINISTIC EVIDENCE PACK"), "with no pack the prompt renders exactly as before");
  // Non-zero control on the same predicate: the prompt WITH a pack differs from the one without.
  assert.notEqual(prompt, noPack);
});

test("FIX(c-evidence-pack): the APPLICABILITY step is asked FIRST, and the prompt says not to force a verdict", () => {
  const p = buildGeneralizationPrompt({ candidate: methodFixture({ applicability: { domain_signals: ["a verdict record with an opaque evidence pointer"], preconditions: ["not where the store cannot resolve pointers"] } }), heldOutCase: expFixture({ components: ["plugin/scripts/alpha.ts"] }) });
  assert.ok(p.includes("STEP 1 — APPLICABILITY"), "the gate is step 1");
  assert.ok(p.indexOf("STEP 1 — APPLICABILITY") < p.indexOf("STEP 2"), "…and it comes before the prediction");
  assert.ok(p.includes('"applies": "yes" | "no" | "undetermined"'));
  assert.ok(p.includes("do NOT"), "the prompt forbids forcing a verdict outside the domain");
  // The method's OWN applicability is shown — the gate is answered against the method's declared domain,
  // not against the verifier's opinion of the files.
  assert.ok(p.includes("a verdict record with an opaque evidence pointer"));
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE GLOBAL CASE-IDENTITY INDEX (task gap-discovery-holdout-cross-experiment-leak-and-contaminated-
// promotion). Two methods were promoted on a sealed set in which eight of nine cases had been used
// before, and nothing in the pipeline could see it: the exclusion set held one earlier file plus the
// candidate's own seed provenance, and lineage matched on Experience *ids*. These cases pin the two
// halves of the fix — ONE identity per case built BEFORE pre-registration, and a per-case refusal as
// defence in depth. Every case below makes ZERO model calls.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** A synthetic sealed case. ⛔ Never a real run's case: the index is exercised over DATA, and no test
 *  needs a real id or a real component basename to do it (the production source must name neither). */
const sealedCaseFixture = (over = {}) => ({
  id: "CASE-fixture-alpha",
  role: "holdout-H",
  files: ["fixture-alpha.ts", "fixture-beta.ts"],
  provenance: { fix_commit: "f".repeat(40) },
  ...over,
});

/** An index over exactly the entries a test hands it — `buildCaseIdentityIndex` over injected,
 *  empty carriers, so nothing of the real repo leaks into the fixture. */
const mkIndex = (root, { sealedSets = [], ledgerRecords = [], registryHistory = [], verdictRecords = [] } = {}) =>
  buildCaseIdentityIndex(root, {
    sealedSets,
    ledger: { ok: true, records: ledgerRecords, malformed_lines: 0 },
    registry: { ok: true, history: registryHistory, latest: [], malformed_lines: 0 },
    verdicts: { ok: true, records: verdictRecords, malformed_lines: 0 },
  });

/** A candidate method (any method — the index check does not read the candidate). */
const anyCandidate = () => methodFixture({ method_id: "fixture-method", version: 1, provenance_evidence: ["experience-inbatch000000"] });

/** A held-out Experience the caller can shape freely; `evaluation_pin` is present so the refusal under
 *  test is never masked by the pin gate. */
const heldOutFixture = (over = {}) => expFixture({
  id: "experience-heldout0000000", case_id: "EXP-heldout", role: "confirmed-negative",
  source_ref: "outcome-heldout00000000", components: ["plugin/scripts/fixture-alpha.ts", "plugin/scripts/fixture-beta.ts"],
  evaluation_pin: "1".repeat(40), ...over,
});

test("AC(a): a case sharing >= REQUIRED components with a case in a DIFFERENT sealed file ⇒ HELD_OUT_PREVIOUSLY_USED", async () => {
  const root = mkTmp();
  const otherSource = "sealed:/fixtures/earlier/labels-earlier-sealed.json";
  const built = mkIndex(root, { sealedSets: [{ source: otherSource, first_use: "earlier", cases: [sealedCaseFixture()] }] });
  assert.equal(built.ok, true, built.reason);
  assert.equal(MIN_SHARED_CASE_COMPONENTS, 2, "the threshold is stated, not assumed");

  const heldOut = heldOutFixture();     // a DIFFERENT case id, the SAME two components
  const hits = caseCollisions(built.index, heldOut);
  assert.deepEqual(hits.map((h) => h.kind), ["shared_components"]);
  assert.equal(hits[0].source, otherSource, "the refusal names WHICH carrier condemned the case");
  assert.deepEqual(hits[0].shared, ["fixture-alpha.ts", "fixture-beta.ts"]);

  const counter = { calls: 0 };
  const r = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }, counter),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index,
  });
  assert.equal(counter.calls, 0, "a previously-used case spends ZERO model calls");
  assert.equal(r.ok, false);
  assert.equal(r.refusal_code, HELD_OUT_PREVIOUSLY_USED);
  assert.equal(r.outcome, "not-evaluated");
  assert.equal(r.promoted, false);
  assert.equal(r.candidate_after.status, "draft", "a refusal NEVER retires the method");
  assert.equal(r.previously_used_ok, false, "the gate ran and FAILED");
  assert.equal(r.lineage_ok, null, "…and the lineage gate was never reached (null, never false)");

  // NEGATIVE CONTROL on the SAME predicate: ONE shared component is below the threshold, so the same
  // shape is NOT refused for prior use — it gets as far as the verifier.
  const oneShared = heldOutFixture({ components: ["plugin/scripts/fixture-alpha.ts", "plugin/scripts/fixture-novel.ts"] });
  assert.deepEqual(caseCollisions(built.index, oneShared), []);
  const ok = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: oneShared, model: stubModel({ verdict: "refuted" }), budget: {},
    pinDir: strippedTmp(), caseIdentityIndex: built.index,
  });
  assert.equal(ok.outcome, "evaluated");
  assert.equal(ok.refusal_code, null);
});

test("AC(b): a case sharing ONLY a fix commit with an indexed case ⇒ refused", async () => {
  const root = mkTmp();
  const built = mkIndex(root, { sealedSets: [{ source: "sealed:/fixtures/earlier/labels-earlier-sealed.json", cases: [
    sealedCaseFixture({ id: "CASE-other-fix", files: ["fixture-unrelated.ts"], provenance: { fix_commit: "a".repeat(40) } }),
  ] }] });
  // A different id AND a disjoint component set — the fix commit is the only thing that ties them.
  const heldOut = heldOutFixture({ case_id: "EXP-heldout-fix", components: ["plugin/scripts/fixture-novel.ts"], fix_commit: "a".repeat(40) });
  const hits = caseCollisions(built.index, heldOut);
  assert.deepEqual(hits.map((h) => h.kind), ["shared_fix_commit"]);
  assert.deepEqual(hits[0].shared, ["a".repeat(40)]);

  const counter = { calls: 0 };
  const r = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }, counter),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index,
  });
  assert.equal(r.refusal_code, HELD_OUT_PREVIOUSLY_USED);
  assert.equal(counter.calls, 0);
});

test("AC(c): a case matching an EARLIER version's seed of a DIFFERENT method's lineage ⇒ refused", async () => {
  const root = mkTmp();
  const seed = expFixture({ id: "experience-seed00000000001", case_id: "EXP-seed-c",
    components: ["plugin/scripts/fixture-alpha.ts", "plugin/scripts/fixture-gamma.ts"] });
  const built = mkIndex(root, {
    ledgerRecords: [seed],
    // A method the candidate has nothing to do with; v1 was seeded from `seed`.
    registryHistory: [{ method_id: "unrelated-method", version: 1, provenance_evidence: [seed.id] }],
  });
  const heldOut = heldOutFixture({ case_id: "EXP-heldout-c", components: ["plugin/scripts/fixture-alpha.ts", "plugin/scripts/fixture-gamma.ts"] });
  const hits = caseCollisions(built.index, heldOut);
  // ⛔ The SEED arm is what makes this a lineage leak rather than "it is in the ledger": the source
  //    names the method version whose fitting material this case was.
  const seedHit = hits.find((h) => h.source === "registry-seed:unrelated-method@1");
  assert.ok(seedHit, `expected a registry-seed hit, got ${JSON.stringify(hits)}`);
  assert.equal(seedHit.source_kind, "registry-seed");
  assert.equal(seedHit.first_use, "unrelated-method@1");

  const counter = { calls: 0 };
  const r = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }, counter),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index,
  });
  assert.equal(r.refusal_code, HELD_OUT_PREVIOUSLY_USED);
  assert.equal(counter.calls, 0);
});

test("AC(d): a sealed set with ONE colliding case ⇒ SEALED_SET_CONTAMINATED naming it (zero model calls)", () => {
  const root = mkTmp();
  const built = mkIndex(root, { sealedSets: [{ source: "sealed:/fixtures/earlier/labels-earlier-sealed.json", cases: [sealedCaseFixture()] }] });
  const clean = sealedCaseFixture({ id: "CASE-fresh-1", files: ["fixture-novel.ts", "fixture-novel-2.ts"], provenance: { fix_commit: "b".repeat(40) } });
  const dirty = sealedCaseFixture({ id: "CASE-fresh-2" });   // collides on the two components

  const refused = checkSealedSetContamination(built.index, { sealedSet: { cases: [clean, dirty] } });
  assert.equal(refused.ok, false);
  assert.equal(refused.refusal_code, SEALED_SET_CONTAMINATED);
  assert.equal(refused.evaluated, 2, "the count of cases EXAMINED is reported");
  assert.equal(refused.colliding_cases, 1, "…and how many of them collided");
  assert.equal(refused.model_calls, 0, "pre-registration refusal is free");
  assert.equal(refused.index_sha256, built.index.sha256);
  assert.deepEqual(refused.table.map((t) => t.case_id), ["CASE-fresh-2"], "only the colliding case is listed");
  assert.match(refused.reason, /^SEALED_SET_CONTAMINATED:/);
  assert.ok(refused.reason.includes("CASE-fresh-2"));
  assert.ok(refused.reason.includes("shared_components"));
  assert.ok(!refused.reason.includes("CASE-fresh-1"), "the clean case is not named");

  // An index that was never supplied is its OWN refusal, never a pass (硬规则 3b).
  const noIndex = checkSealedSetContamination(null, { sealedSet: { cases: [dirty] } });
  assert.equal(noIndex.ok, false);
  assert.equal(noIndex.refusal_code, "CASE_INDEX_UNAVAILABLE");
});

test("AC(e): a genuinely unseen case is ACCEPTED — the rule is not 'refuse everything'", () => {
  const root = mkTmp();
  const built = mkIndex(root, { sealedSets: [{ source: "sealed:/fixtures/earlier/labels-earlier-sealed.json", cases: [sealedCaseFixture()] }] });
  const fresh = sealedCaseFixture({ id: "CASE-fresh", files: ["fixture-novel.ts", "fixture-novel-2.ts"], provenance: { fix_commit: "c".repeat(40) } });
  assert.deepEqual(caseCollisions(built.index, fresh), []);
  const res = checkSealedSetContamination(built.index, { sealedSet: { cases: [fresh] } });
  assert.equal(res.ok, true);
  assert.equal(res.refusal_code, null);
  assert.equal(res.colliding_cases, 0);
  assert.equal(res.evaluated, 1);
  // …and the same through the per-case gate: the verifier RUNS.
  return validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOutFixture({ case_id: "EXP-fresh", components: ["plugin/scripts/fixture-novel.ts"] }),
    model: stubModel({ verdict: "refuted" }), budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index,
  }).then((r) => {
    assert.equal(r.outcome, "evaluated");
    assert.equal(r.previously_used_ok, true, "the gate ran and PASSED — the value can take both");
  });
});

test("AC(a-labels): a diagnostic-public case collides on ONE shared component — the public channel is not a component identity", async () => {
  const root = mkTmp();
  const built = mkIndex(root, { sealedSets: [{ source: "sealed:/fixtures/earlier/labels-earlier-sealed.json", cases: [
    sealedCaseFixture({ id: "DIAG-fixture", role: "diagnostic-public:positive", files: ["fixture-alpha.ts", "fixture-delta.ts", "fixture-epsilon.ts"] }),
  ] }] });
  // ONE shared component (fixture-alpha.ts) — below the >= 2 arm, and refused all the same.
  const heldOut = heldOutFixture({ components: ["plugin/scripts/fixture-alpha.ts", "plugin/scripts/fixture-novel.ts"] });
  const hits = caseCollisions(built.index, heldOut);
  assert.deepEqual(hits.map((h) => h.kind), ["shared_diagnostic_component"]);
  assert.deepEqual(hits[0].shared, ["fixture-alpha.ts"]);
  const counter = { calls: 0 };
  const r = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }, counter),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index,
  });
  assert.equal(r.refusal_code, HELD_OUT_PREVIOUSLY_USED);
  assert.equal(counter.calls, 0);

  // The enumerable arm list, so a new arm cannot be added silently.
  assert.deepEqual([...COLLISION_KINDS], ["reused_case_id", "shared_fix_commit", "shared_components", "shared_diagnostic_component"]);
});

test("the index normalises components to BASENAMES and records the canonical identity of each case", () => {
  assert.deepEqual(caseComponentsOf({ files: ["plugin/scripts/a.ts", "plugin/scripts/a.ts", "./plugin/scripts/b.ts"] }), ["a.ts", "b.ts"]);
  // The `a`/`b` spelling some sealed files use is the same set as `files`.
  assert.deepEqual(caseComponentsOf({ a: ["x.ts"], b: ["y.ts", "z.ts"] }), ["x.ts", "y.ts", "z.ts"]);
  assert.deepEqual(caseComponentsOf({}), [], "a case naming no component has an EMPTY set — never a fabricated one");
  // A free-text provenance names its fix in prose; reading a commit out of prose would be a guess.
  assert.deepEqual(caseComponentsOf({ files: [], provenance: "fixed in commit deadbeef after the pin" }), []);
});

test("the index is a persisted artifact with its own sha256, and its sha is content-addressed over the KNOWLEDGE", () => {
  const root = mkTmp();
  const set = { source: "sealed:/fixtures/x/labels-x-sealed.json", cases: [sealedCaseFixture()] };
  const a = mkIndex(root, { sealedSets: [set] });
  const b = mkIndex(root, { sealedSets: [set] });
  assert.equal(a.sha256, b.sha256, "the same knowledge ⇒ the same sha (nothing about the build moment is hashed)");

  const w = writeCaseIdentityIndex(root, a.index);
  assert.equal(w.ok, true, w.reason);
  assert.equal(caseIdentityIndexFile(root), path.join(root, CASE_IDENTITY_INDEX_REL));
  const back = readCaseIdentityIndex(root);
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.sha256_matches, true, "the recorded sha still describes the file's content");
  assert.equal(back.index.entries.length, 1);

  // ONE added case moves the sha — it is a real reading of the content, not a constant.
  const moved = mkIndex(root, { sealedSets: [set, { source: "sealed:/fixtures/y/labels-y-sealed.json", cases: [sealedCaseFixture({ id: "CASE-fixture-beta" })] }] });
  assert.notEqual(moved.sha256, a.sha256);

  // ⛔ An index built from a registry read WITHOUT `history` would silently drop every method seed —
  // refused rather than served as a shorter answer (硬规则 3b). Same for an unreadable source.
  const noHistory = buildCaseIdentityIndex(root, {
    ledger: { ok: true, records: [], malformed_lines: 0 },
    registry: { ok: true, history: null, latest: [], malformed_lines: 0 },
    verdicts: { ok: true, records: [], malformed_lines: 0 },
  });
  assert.equal(noHistory.ok, false);
  assert.match(noHistory.reason, /^CASE_INDEX_REGISTRY_HISTORY_REQUIRED:/);
  const badVerdicts = buildCaseIdentityIndex(root, {
    ledger: { ok: true, records: [], malformed_lines: 0 },
    registry: { ok: true, history: [], latest: [], malformed_lines: 0 },
    verdicts: { ok: false, records: [], malformed_lines: 1 },
  });
  assert.equal(badVerdicts.ok, false);
  assert.match(badVerdicts.reason, /^CASE_INDEX_VERDICTS_UNREADABLE:/);
  assert.equal(badVerdicts.index, null);

  // An absent index is its OWN value, never an empty one (硬规则 3b).
  const missing = readCaseIdentityIndex(mkTmp());
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /^CASE_INDEX_MISSING:/);
  assert.equal(missing.index, null);
});

test("AC(h): a new case whose `labeled_at` FOLLOWS the pre-registration mtime ⇒ refused with zero model calls", async () => {
  const base = heldOutFixture({ case_id: "EXP-labelled" });
  const good = { ...base, labeled_by: "independent-labeller-1", labeled_at: "2026-10-12T00:30:00Z", prereg_mtime: "2026-10-12T01:00:00Z" };
  const now = Date.parse("2026-10-12T02:00:00Z");
  assert.deepEqual(validateCaseLabelTiming(good, { nowMs: now }), { ok: true, reasons: [], labeled_at: Date.parse("2026-10-12T00:30:00Z"), prereg_mtime: Date.parse("2026-10-12T01:00:00Z") });

  // ⛔ Distinct code per defect (硬规则 3): a missing labeller, a missing label time, a label written
  //    AFTER the pre-registration, and a pre-registration written after the first model call are four
  //    different failures and must not collapse into one.
  assert.deepEqual(validateCaseLabelTiming({ ...good, labeled_by: null }, { nowMs: now }).reasons, ["NO_LABELED_BY"]);
  assert.deepEqual(validateCaseLabelTiming({ ...good, labeled_at: "not-a-date" }, { nowMs: now }).reasons, ["NO_LABELED_AT"]);
  assert.deepEqual(validateCaseLabelTiming({ ...good, prereg_mtime: null }, { nowMs: now }).reasons, ["NO_PREREG_MTIME"]);
  assert.deepEqual(validateCaseLabelTiming({ ...good, labeled_at: "2026-10-12T01:30:00Z" }, { nowMs: now }).reasons, [LABEL_AFTER_PREREG]);
  assert.deepEqual(validateCaseLabelTiming(good, { nowMs: Date.parse("2026-10-12T00:45:00Z") }).reasons, [PREREG_AFTER_FIRST_CALL]);

  // Through the verifier: the self-declared labelled case is refused BEFORE any call.
  const late = { ...base, labeled_by: "independent-labeller-1", labeled_at: "2026-10-12T01:30:00Z", prereg_mtime: "2026-10-12T01:00:00Z" };
  const counter = { calls: 0 };
  const r = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: late, model: stubModel({ verdict: "refuted" }, counter),
    budget: {}, pinDir: strippedTmp(), nowMs: Date.parse("2026-10-12T02:00:00Z"),
  });
  assert.equal(counter.calls, 0);
  assert.equal(r.refusal_code, LABEL_AFTER_PREREG);
  assert.equal(r.outcome, "not-evaluated");
  assert.equal(r.promoted, false);
  // A case carrying NO labelling field is a legacy/derived Experience and is not asked for them.
  const legacy = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: base, model: stubModel({ verdict: "refuted" }), budget: {}, pinDir: strippedTmp(),
  });
  assert.equal(legacy.outcome, "evaluated");
});

test("AC(binding): the sealed-set binding gate requires the pin, the labeller, the label time, and the order", () => {
  const ok = { id: "CASE-bound", role: "holdout-negative", files: ["fixture-alpha.ts"], labeled_by: "labeller-1",
    labeled_at: "2026-10-12T00:30:00Z", evaluation_pin: "p".repeat(40) };
  const set = validateSealedSetBinding([ok], { preregMtimeMs: Date.parse("2026-10-12T01:00:00Z"), nowMs: Date.parse("2026-10-12T02:00:00Z") });
  assert.equal(set.ok, true, set.reasons.join(","));

  const positive = { ...ok, id: "CASE-pos", role: "found-and-fixed" };
  const noFix = validateSealedSetBinding([positive], { preregMtimeMs: Date.parse("2026-10-12T01:00:00Z"), nowMs: Date.parse("2026-10-12T02:00:00Z") });
  assert.deepEqual(noFix.reasons, ["SEALED_CASE_NO_FIX_COMMIT:CASE-pos"]);
  const withFix = validateSealedSetBinding([{ ...positive, fix_commit: "q".repeat(40) }], { preregMtimeMs: Date.parse("2026-10-12T01:00:00Z"), nowMs: Date.parse("2026-10-12T02:00:00Z") });
  assert.equal(withFix.ok, true, withFix.reasons.join(","));
  // …and the fix must DESCEND from the pin: a fix already in the tree at the pin cannot exhibit the defect.
  const mispinned = validateSealedSetBinding([{ ...positive, fix_commit: "q".repeat(40) }], {
    preregMtimeMs: Date.parse("2026-10-12T01:00:00Z"), nowMs: Date.parse("2026-10-12T02:00:00Z"), isAncestor: () => true,
  });
  assert.deepEqual(mispinned.reasons, ["SEALED_CASE_FIX_NOT_DESCENDANT_OF_PIN:CASE-pos"]);

  // The label digest ties a verdict to the EXACT claim it judged — editing the components or the pin
  // afterwards no longer matches.
  assert.equal(caseLabelSha256(ok), caseLabelSha256({ ...ok }));
  assert.notEqual(caseLabelSha256(ok), caseLabelSha256({ ...ok, evaluation_pin: "z".repeat(40) }));
});

test("AC(labels-recorded): an evaluated verdict records the label sha and the index sha it was checked against", async () => {
  const root = mkTmp();
  const built = mkIndex(root, { sealedSets: [{ source: "sealed:/fixtures/earlier/labels-earlier-sealed.json", cases: [sealedCaseFixture()] }] });
  const heldOut = heldOutFixture({ case_id: "EXP-labelled-2", components: ["plugin/scripts/fixture-novel.ts"],
    labeled_by: "labeller-1", labeled_at: "2026-10-12T00:30:00Z", prereg_mtime: "2026-10-12T01:00:00Z" });
  const r = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }), budget: {},
    pinDir: strippedTmp(), root, nowMs: Date.parse("2026-10-12T02:00:00Z"), caseIdentityIndex: built.index,
  });
  assert.equal(r.outcome, "evaluated");
  assert.equal(r.verdict_recorded, true);
  const rec = readGeneralizationVerdicts(root).records[0];
  assert.equal(rec.verdict_id ?? rec.id, r.verdict_ref);
  assert.equal(rec.label_sha256, caseLabelSha256(heldOut), "WHICH label was judged is on the verdict");
  assert.equal(rec.index_sha256, built.index.sha256, "…and WHICH index it was checked against");
  assert.equal(rec.previously_used_ok, true);
});

test("AC(real): the index over a REAL sealed file is built from that file's data, and its components are basenames", () => {
  const file = path.join(plainTmp(), "labels-real-sealed.json");
  fs.writeFileSync(file, JSON.stringify({ _note: "fixture", pin: "p".repeat(40), cases: [sealedCaseFixture()] }), "utf8");
  const read = readSealedSet(file);
  assert.equal(read.ok, true, read.reason);
  assert.equal(read.cases.length, 1);
  assert.equal(read.pin, "p".repeat(40));

  const root = mkTmp();
  const built = buildCaseIdentityIndex(root, {
    sealedSetPaths: [file],
    ledger: { ok: true, records: [], malformed_lines: 0 },
    registry: { ok: true, history: [], latest: [], malformed_lines: 0 },
    verdicts: { ok: true, records: [], malformed_lines: 0 },
  });
  assert.equal(built.ok, true, built.reason);
  assert.equal(built.entries.length, 1);
  assert.deepEqual(built.entries[0].components, ["fixture-alpha.ts", "fixture-beta.ts"]);
  assert.equal(built.entries[0].source_kind, "sealed");
  assert.equal(built.entries[0].source_line, 1);
  assert.equal(built.entries[0].first_use, firstUseOfSealedPath(file));

  // A file that cannot be read is its OWN value, never an empty case list.
  const broken = path.join(plainTmp(), "labels-broken-sealed.json");
  fs.writeFileSync(broken, "{ not json", "utf8");
  assert.match(readSealedSet(broken).reason, /^SEALED_SET_UNPARSEABLE:/);
  assert.deepEqual(readSealedSet(path.join(plainTmp(), "nope.json")).reason.startsWith("SEALED_SET_UNREADABLE:"), true);
  // A truly unreadable SOURCE inside a build refuses the whole build rather than shortening the index.
  const failed = buildCaseIdentityIndex(root, { sealedSetPaths: [broken] });
  assert.equal(failed.ok, false);
  assert.equal(failed.index, null);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE LEVEL (task gap-discovery-evidence-level-teaching-vs-independent, Plan items 2 and 4)
//
// The strict cross-experiment exclusion is a property of INDEPENDENT generalization experiments. A
// `teaching`/`transfer` case is allowed to reuse a known case on purpose — that is what those levels
// NAME — but then it must say which case it reused, and a pass at those levels can never reach
// `active` (it caps at the report-only `trial`, asserted in the registry suite). `unlabelled` gets no
// such exemption: "the caller declared nothing" must not open a door the declaration exists to shut.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("AC(d): a TRANSFER verdict reusing a known case is ACCEPTED at transfer level, and NAMES its source", async () => {
  const root = mkTmp();
  const built = mkIndex(root, { sealedSets: [{ source: "sealed:/fixtures/earlier/labels-earlier-sealed.json", cases: [sealedCaseFixture()] }] });
  assert.equal(built.ok, true, built.reason);
  // The held-out case IS a previously-used one (same two components, same defect) — the very shape the
  // `independent` path refuses outright.
  const heldOut = heldOutFixture();
  assert.deepEqual(caseCollisions(built.index, heldOut).map((h) => h.kind), ["shared_components"], "the case really is a reused one");

  // 1. Without a source case the exemption is refused, with ZERO model calls: "may reuse" is conditional
  //    on "says what it reused", and a reused case whose source is unnamed reads back as a fresh one.
  const blocked = { calls: 0 };
  const noSource = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }, blocked),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index, evidenceLevel: "transfer",
  });
  assert.equal(noSource.refusal_code, "SOURCE_CASE_REQUIRED");
  assert.equal(blocked.calls, 0, "a refusal spends zero model calls");
  assert.equal(noSource.previously_used_ok, null, "the exclusion gate was NOT run at this level — null, never false");

  // 2. With the source named, the SAME case IS evaluated: the exemption is real, not a softer refusal.
  const counter = { calls: 0 };
  const r = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }, counter),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index, root,
    evidenceLevel: "transfer", sourceCaseId: "EXP-known-source",
  });
  assert.equal(counter.calls, 1, "the verifier DID run — that is what 'accepted at transfer level' means");
  assert.equal(r.outcome, "evaluated");
  assert.equal(r.refusal_code, null);
  assert.equal(r.evidence_level, "transfer");
  assert.equal(r.source_case_id, "EXP-known-source");
  assert.equal(r.previously_used_ok, null, "the exclusion gate is not run at transfer level");
  assert.equal(r.lineage_ok, true, "…but the LINEAGE gate still runs: transfer is not a licence to self-grade");

  // …and the recorded carrier line carries both readings, so a third party can re-read WHICH level the
  // verdict was taken at and WHICH case it reused — the two things the promotion guard consults.
  const rec = readGeneralizationVerdicts(root).records[0];
  assert.equal(rec.evidence_level, "transfer");
  assert.equal(rec.source_case_id, "EXP-known-source");
  assert.equal(rec.correct, true);

  // 3. CONTROL: the SAME reused case with NO level declared is still refused outright — `unlabelled` is
  //    not a third exempt level, it is the strict arm (硬规则 3b: an absent label must not open a door).
  const strict = { calls: 0 };
  const unlabelled = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }, strict),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index, sourceCaseId: "EXP-known-source",
  });
  assert.equal(unlabelled.refusal_code, HELD_OUT_PREVIOUSLY_USED);
  assert.equal(strict.calls, 0);

  // 4. …and `independent` is the strict arm too: a level that claims no reuse may not reuse a case.
  const indep = await validateGeneralization({
    candidate: anyCandidate(), heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }),
    budget: {}, pinDir: strippedTmp(), caseIdentityIndex: built.index, evidenceLevel: "independent",
  });
  assert.equal(indep.refusal_code, HELD_OUT_PREVIOUSLY_USED);
});

test("AC(d-2): the evidence level is RECORDED on every verdict — a caller that declares none gets `unlabelled`", async () => {
  const root = mkTmp();
  const heldOut = expFixture({
    id: "experience-heldout0000000", case_id: "EXP-heldout", role: "confirmed-negative",
    source_ref: "outcome-heldout00000000", components: ["plugin/scripts/heldout.ts"], evaluation_pin: "1".repeat(40),
  });
  const candidate = assembleCandidate({ rec: decisionFixture(), unit: { experiences: [expFixture({ id: "experience-inbatch000000" })] }, registry: [], budget: {}, nowIso: "2026-10-12T00:00:00Z" });
  const v = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel({ verdict: "refuted" }), budget: {}, pinDir: strippedTmp(), root });
  assert.equal(v.evidence_level, "unlabelled", "no declaration ⇒ `unlabelled`, never a guess at a stronger level");
  assert.equal(readGeneralizationVerdicts(root).records[0].evidence_level, "unlabelled", "…and the recorded line says so explicitly");
  assert.equal(v.promoted_to, "trial", "a pass at an unlabelled level caps at the report-only `trial`");
  assert.equal(v.candidate_after.status, "trial");
});

test("AC(d-3): the independent-only metric EXCLUDES teaching/transfer verdicts, and says how many", () => {
  const verdicts = [
    { outcome: "evaluated", correct: true, evidence_level: "independent" },
    { outcome: "evaluated", correct: false, evidence_level: "independent" },
    { outcome: "evaluated", correct: true, evidence_level: "teaching", source_case_id: "EXP-taught" },
    { outcome: "evaluated", correct: true, evidence_level: "transfer", source_case_id: "EXP-known" },
    { outcome: "evaluated", correct: true },   // legacy: an absent level
  ];
  // The RAW reading is unchanged — it answers "how did the predictions do", which is a different
  // question from "how did the INDEPENDENT predictions do".
  assert.equal(learningQuality(verdicts).evaluated, 5);
  const indep = independentLearningQuality(verdicts);
  assert.equal(indep.evaluated, 2, "only the two independent verdicts are in the denominator");
  assert.equal(indep.value, 0.5);
  assert.equal(indep.excluded, 3, "the exclusion is REPORTED, not silent");
  assert.deepEqual(indep.by_evidence_level, { independent: 2, teaching: 1, transfer: 1, unlabelled: 1 });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// task gap-discovery-method-per-round-quota-verify-reserve-deep-reflection, Plan item 2
//   The reflection launcher may READ CODE, against a pinned stripped tree. Two properties are asserted
//   here, and BOTH must hold or the feature is decorative / leaks:
//     • the argv carrier puts the pin on the launcher's argv when (and only when) there is one;
//     • the prompt NAMES that tree — without it a launcher carrying Read,Grep,Glob is given tools and
//       told nothing about what they may read;
//     • and with NO code access the prompt is BYTE-IDENTICAL to the pre-change one, which is what makes
//       the no-tools arm a real baseline rather than a differently-worded variant.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const stubLaunchArgv = (role, prompt, root, opts) => ["claude", "-n", role, ...(opts.promptViaStdin === true ? ["-p"] : ["-p", prompt])];
const PIN_DIR = "/tmp/dm-reflect-pin-1a2b3c4d";

test("reflectionLaunchArgv — `--add-dir <pin>` exactly when a pin is given; otherwise byte-identical to hardenedArgv", () => {
  const withPin = reflectionLaunchArgv({ launchArgv: stubLaunchArgv, prompt: "P", root: "/r", tools: "Read,Grep,Glob", maxTurns: 10, pinDir: PIN_DIR, outputFormat: "stream-json" });
  assert.equal(withPin.filter((t) => t === "--add-dir").length, 1, "exactly one directory is added");
  assert.equal(withPin[withPin.indexOf("--add-dir") + 1], PIN_DIR, "…and it is the pin");
  assert.equal(withPin[withPin.length - 1], "-p", "⛔ inserted BEFORE the trailing prompt flag, so the argv shape is unchanged");
  assert.equal(withPin[withPin.indexOf("--tools") + 1], "Read,Grep,Glob");
  assert.equal(withPin[withPin.indexOf("--max-turns") + 1], "10");

  // ⛔ `null` / absent / EMPTY are the SAME reading: no tree was given, so no directory is added and the
  // argv is exactly what `hardenedArgv` produces (the pre-change shape).
  const expected = hardenedArgv(stubLaunchArgv, "P", "/r", { tools: "Read,Grep,Glob", maxTurns: 10, outputFormat: "stream-json" });
  for (const pin of [null, undefined, ""]) {
    const argv = reflectionLaunchArgv({ launchArgv: stubLaunchArgv, prompt: "P", root: "/r", tools: "Read,Grep,Glob", maxTurns: 10, pinDir: pin, outputFormat: "stream-json" });
    assert.deepEqual(argv, expected, `pinDir=${JSON.stringify(pin)} adds nothing — "no pin" must not be shaped like "a pin"`);
  }
});

test("buildReflectionPrompt — code access NAMES the pinned tree, stays a semantic question, and is byte-identical when absent", () => {
  const unit = { signature: "sig-1", experiences: [{ case_id: "c1", role: "negative", components: ["plugin/scripts/x.ts"], summary: "s" }], representative: { case_id: "c1" } };
  const withoutAccess = buildReflectionPrompt({ unit, registry: [], toolNames: ["arch-discovery-routine.ts"] });
  const withAccess = buildReflectionPrompt({ unit, registry: [], toolNames: ["arch-discovery-routine.ts"], codeAccess: { tools: "Read,Grep,Glob", pinDir: PIN_DIR } });

  assert.ok(!withoutAccess.includes(PIN_DIR), "no code access ⇒ no tree is named");
  assert.ok(withAccess.includes(PIN_DIR), "the tree the tools may read is NAMED — otherwise the tools are decorative");
  assert.ok(withAccess.includes("Read,Grep,Glob"), "…and the tools it is told it has");
  assert.match(withAccess, /Do NOT turn this into a scan/, "⛔ still a semantic question — never a scan recipe");
  assert.match(withAccess, /does THIS finding teach a/, "…the question itself is unchanged");
  // ⛔ The baseline arm must be a real baseline: the code-access block is ADDITIVE, and removing it gives
  // back EXACTLY the pre-change prompt (nothing else in the prompt was re-worded by this task).
  const stripped = withAccess.replace(/\nCODE ACCESS[\s\S]*?\n(?=\nRespond with ONE JSON object)/, "");
  assert.equal(stripped, withoutAccess, "removing the code-access block returns the pre-change prompt byte for byte");
  // The registry digest is still shown in both arms — code access must not have displaced prior knowledge.
  assert.ok(withAccess.includes("CURRENT METHOD REGISTRY"));
});
