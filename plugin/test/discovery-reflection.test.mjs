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
  computeReflectionCost, learningQuality, registryDigest, runReflectionRound,
  lineageVersions, checkLineageIsolation, validateEvaluationPin, checkTemporalBinding,
  gitIsAncestor, verifyStrippedPin, materializeStrippedPin, DISCOVERY_PIN_FORBIDDEN_DIRS,
  isPositiveCase, LINEAGE_MIN_SHARED_COMPONENTS,
} from "../../docs/analysis/discovery-reflection.mjs";
import { subjectKey } from "../../docs/analysis/architecture-evidence-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(HERE, "..", "..", "docs", "analysis", "discovery-reflection.mjs");
const REPO_ROOT = path.resolve(HERE, "..", "..");

const tmpDirs = [];
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-reflection-")); tmpDirs.push(d); return d; };
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
  const right = await validateGeneralization({ candidate, heldOutCase: heldOut, model: stubModel({ invariant_holds: false, verdict: "refuted", reasoning: "the claim does not hold" }), budget: {}, ...pin });
  assert.equal(right.correct, true);
  assert.equal(right.promoted, true);
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
  const r = await validateGeneralization({ candidate, heldOutCase: heldOut, registry: [candidate], experiences: [], model: stubModel({ invariant_holds: false, verdict: "refuted" }), budget: {}, pinDir: pin, root: repo.dir });
  assert.equal(r.outcome, "evaluated");
  assert.equal(r.refusal_code, null);
  assert.equal(r.called, true);
  assert.equal(r.promoted, true);
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
