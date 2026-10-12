#!/usr/bin/env node
// DISCOVERY REFLECTION — the reflection TRIGGER + CANDIDATE GENERATION for the self-bootstrapping
// Discovery Method loop (Phase 2: the first phase that actually LEARNS).
//
// WHAT IT ADDS, AND WHAT IT IS NOT (scope check, so this does not become a second scheduler):
//   It consumes the Experience ledger (Phase 1, `discovery-experience-ledger.mjs`) — BOTH sources,
//   `reported_by:"user"` and `reported_by:"system"`, with NO special-casing by source — and produces
//   `DiscoveryMethod` candidates in the Phase-0 registry (`discovery-method-registry.mjs`). It is a
//   bounded pure function + a thin CLI entry, called manually or by a test. ⛔ It wires nothing into
//   the routine track, defines no driver kind, and touches no `meta-*` module: continuous shadow
//   execution is a FOLLOW-ON task, sequenced after this output shape is proven real (the same
//   sequencing `arch-discovery-routine.ts` followed, which only existed after its two instruments had
//   landed and been hand-verified).
//
// ⛔ THE ONE HARD REQUIREMENT — NO HAND-CODING THE ANSWER. The reflection step is never TOLD, and never
//   hand-codes, any specific symbol / file pair / invariant class from the seed material. A pipeline
//   that only works because it was quietly told where to look is not a method — it is its own authors
//   re-doing what the original discovery already did. This forecloses the leak at TWO levels:
//     • CODE level: the PRODUCTION logic of this module contains ZERO literal occurrences of any seed
//       symbol. The static control in `plugin/test/discovery-reflection.test.mjs` pins that as a
//       CHECKED property (a mutation that hand-codes one turns the test red), so it cannot rot back.
//     • PROMPT level: one model call is made PER reflection unit, and the prompt carries ONLY that
//       unit's own material. It NEVER carries a DIFFERENT experience's components/summary from the
//       same batch (that would be "this looks like case X, go find something like it"). The registry
//       IS shown in full — it is PRIOR-round knowledge, not another batch member's answer, and the
//       model must actually read it to choose extend/compose vs new.
//
// ⛔ STRUCTURAL SANDBOX (same spirit as the evidence store / the registry / the ledger): no filing
//   machinery, no task/goal/AC, no status write, no detection, no routine wiring. Its ONLY persistence
//   is (a) append-only lines to `.quay/discovery-reflection-attempts.jsonl` — the record that lets the
//   NEXT round skip a signature already reflected on, so a model call is never re-spent on the same
//   question — and (b) `DiscoveryMethod` records, written THROUGH the registry's own `appendMethodRecord`
//   (this module never hand-writes the registry carrier).
//
// 硬规则 5b (a defect already fixed once must not be re-hand-rolled): the model-identity / cost
//   machinery is REUSED BY IMPORT from `arch-hypothesis-generation.mjs` (`modelCallFields` + the
//   stream-json parser + `callText` + `parseJsonObject`). A client guessing its own cost was fixed once;
//   a second hand-rolled copy here would reintroduce it.
//
// FAIL-CLOSED (硬规则 3b): a unit whose model output is unparseable, whose decision is out of the
//   vocabulary, whose `extends`/`composes` names a `method_ref` that does NOT resolve in the registry,
//   or whose assembled candidate fails the registry's OWN validator, is REFUSED with a distinct reason
//   and produces NO candidate. "I could not turn this into a method" must never be shaped like "I
//   decided there is no method" (that is `decision:"no-method"`, a real judgment) — they are different
//   `decision`/`reasons` shapes on read-back.
//
// ⛔ THE HELD-OUT CASE MUST BE OUTSIDE THE METHOD'S **LINEAGE**, AND THE VERDICT MUST BE READ AT THE
//   COMMIT WHERE IT IS TRUE (gap-discovery-method-generalization-lineage-and-temporal-binding, 2026-10-12).
//   A read-only audit of the landed Phase 2 found its only "generalization pass" invalid on two
//   independent grounds, and both are now refusals rather than silently-graded calls:
//     • LINEAGE — `shared-contract-divergence` v1 was seeded from evidence-store record
//       `outcome-bb…`; v3 of the SAME method came from that record's Experience in the same round;
//       v2 was "validated" against that same Experience and promoted. `checkLineageIsolation` walks
//       EVERY recorded version of the candidate's `method_id` (plus every method it names via
//       `method:<id>@<v>`), one hop through the Experiences those versions cite, and refuses
//       (`HELD_OUT_SHARES_LINEAGE`) on a shared record id/source_ref OR on >= 2 shared components.
//     • TIME — the verifier read develop `9a329772a`, where the case's fix (`706545794`) had already
//       landed; read there, the method's own invariant HOLDS, i.e. the correct verdict is the opposite
//       of the one the case's historical role supplies. `validateEvaluationPin` +
//       `checkTemporalBinding` require the case to name `evaluation_pin` (and, when positive,
//       `fix_commit`), require the fix NOT to be an ancestor of the pin, and REQUIRE the verifier to
//       run in a stripped detached tree at the pin (`materializeStrippedPin` / `verifyStrippedPin`) —
//       never the live checkout. The evaluated commit is recorded on the verdict.
//   Every one of those is a REFUSAL: `outcome:"not-evaluated"`, zero model calls, the candidate left
//   exactly as it was. A refused READING must never be shaped like a failed METHOD (硬规则 3b).
//
// ⛔ THE APPLICABILITY GATE AND THE EVIDENCE PACK (gap-discovery-method-generalization-failures-
//   diagnosis-and-retest, 2026-10-12). An independent regression run produced three trustworthy
//   generalization failures and ZERO correct generalizations; a read-only diagnosis (recorded in that
//   task's Diagnosis section) returned SUPPORTED for three hypotheses and REFUTED the fourth, and this
//   module now carries exactly the three fixes that diagnosis justifies:
//     • the reflection prompt shows the JOINED `domain_claim` (the claim lives in the evidence store's
//       hypothesis/counterexample records, not in the outcome) — see the ledger's `joinOutcomeToClaims`;
//     • `validateGeneralization` asks `applies` FIRST, in the same call. `applies:"no"` yields the
//       outcome `not-applicable`: neither correct nor wrong, neither promoting nor retiring. Measured:
//       every held-out in the failing run satisfied 0 of the record fields its method's
//       `domain_signals` key on, while every one of the candidates' own seeds satisfied them — so
//       "did not apply" was coming back wearing the shape of "predicted wrong";
//     • the verifier gets the DETERMINISTIC EVIDENCE PACK (`buildEvidencePack`, reused by import), not a
//       raised turn cap: one call in that run terminated on the turn budget (error_max_turns at 15
//       against a configured cap of 14). The pack's absence is its own value (`evidence_pack: null`).
//   ⛔ The FOURTH hypothesis (inverted label semantics) was REFUTED — all 13 label citations resolve
//   verbatim at the pin — and therefore carries NO fix here.
//
// BUDGET / KILL SWITCH, enforced IN THIS MODULE (not deferred to the later routine-wiring task):
//   `enabled`, `maxPerRun`, `maxModelCalls`, `maxWallMs`. `enabled:false` makes EVERY exported entry
//   point return `{ok:false, reason:"disabled"}` with ZERO model calls — the same contract SHAPE as
//   `arch-discovery-routine.ts`'s config gate, reused by CONVENTION, not by import (this module has no
//   driver dependency at load time).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// ── reuse, never re-derive ─────────────────────────────────────────────────────────────────────
// The ONE signature primitive (`subjectKey`), the content-addressing + carrier reader, the Experience
// ledger's role vocabulary, and the method registry's OWN validator + carrier — all imported. A second
// definition of any of them would be a second definition to keep in sync.
import { subjectKey, recordId, sha256 } from "./architecture-evidence-store.mjs";
import {
  ROLE_VERDICT_COMPAT, readExperienceLedger, DISCOVERY_CARRIERS, GENERALIZATION_VERDICTS_REL,
  GENERALIZATION_VERDICT_KIND, EXPERIENCE_LEDGER_REL, carrierFile, readCarrier, appendCarrierLine,
  resolveCarrierRoot,
  // The evidence level + the case-identity threshold, both declared ONCE in the base module so the
  // method registry's promotion guard reads the same values (task
  // gap-discovery-evidence-level-teaching-vs-independent).
  EVIDENCE_LEVELS, EVIDENCE_LEVEL_VALUES, UNLABELLED_EVIDENCE_LEVEL, INDEPENDENT_EVIDENCE_LEVEL,
  CASE_REUSE_EVIDENCE_LEVELS, SOURCE_CASE_REQUIRED, evidenceLevelOf, isIndependentEvidenceLevel,
  allowsCaseReuse, MIN_SHARED_CASE_COMPONENTS,
} from "./discovery-experience-ledger.mjs";
import {
  readMethodRegistry, validateMethodRecord, defaultToolNames,
  seedSetForRecord, basenameOf, provenanceSeeds, provenanceExperiences, REPO_ROOT,
} from "./discovery-method-registry.mjs";
// The model-identity / cost machinery + the hardened launcher argv, reused by import (硬规则 5b).
import {
  modelCallFields, callText, parseJsonObject,
  // ⛔ `parseVerifierStream` is re-exported below (see `export { parseVerifierStream }`): the ROUTINE
  // that owns the 24h reservation ledger has to read the realized `num_turns` off a finished call, and
  // the stream parser is the only thing that knows where that number lives. Re-exported rather than
  // re-implemented — a second stream parser would be a second thing to keep in sync (硬规则 5b).
  parseVerifierStream,
  importDriverRuntime, hardenedArgv, modelFromArgv,
  PIN_FORBIDDEN_DIRS,
  // The DETERMINISTIC evidence pack (Plan item 2c). Reused by import rather than re-derived: the
  // hypothesis-generation stage already assembles definition/import lines from a component set, and a
  // second implementation of "which lines are evidence" would be a second thing to keep in sync.
  buildEvidencePack,
} from "./arch-hypothesis-generation.mjs";

export const TOOL = "discovery-reflection";

/** The reflection-attempt log — declared in the ledger module's ONE carrier table, and resolved to
 *  the SHARED checkout so it survives a task worktree being torn down (the ledger module's header
 *  carries the full defect; the attempt log was one of the three carriers the audit found missing). */
export const REFLECTION_ATTEMPTS_REL = DISCOVERY_CARRIERS["discovery-reflection-attempts"].rel;
export const REFLECTION_ATTEMPT_KIND = DISCOVERY_CARRIERS["discovery-reflection-attempts"].kind;

/** The decision vocabulary. `no-method` is a REAL judgment (a model call DID happen and concluded the
 *  finding teaches nothing transferable) — distinct from a refusal, which carries `reasons` instead. */
export const DECISIONS = Object.freeze(["new", "extends", "composes", "no-method"]);

/** Default budget. ⛔ These are DEFAULTS, not measured optima: the only measured numbers in this task
 *  are the ones the real verification run recorded into the task's Evidence section. */
export const DEFAULT_BUDGET = Object.freeze({
  enabled: true,
  maxPerRun: 6,
  maxModelCalls: 8,
  maxWallMs: 600_000,
});

/** `net_new_discovery_value` is DEFINED now and explicitly LEFT UNMEASURED (硬规则 3b): it requires an
 *  ACTIVE method finding something in production OUTSIDE its own seed provenance, which only exists
 *  after the follow-on routine-wiring task runs. ⛔ Never `0` — `0` would read as "measured and found
 *  nothing", which is a different (and false) claim. */
export const NET_NEW_DISCOVERY_VALUE = "not-yet-measured";

// ── config gate (the `arch-discovery-routine.ts` contract SHAPE, reused by convention) ────────────

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isInt = (x) => Number.isInteger(x);
const supplied = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

/** Normalise a caller-supplied budget over the defaults. Pure. A bad value is REFUSED (its own
 *  reason) rather than silently coerced — a budget that cannot be read is not a licence to spend. */
export function resolveBudget(budget = {}) {
  const b = isObj(budget) ? budget : {};
  const out = { ...DEFAULT_BUDGET };
  for (const k of ["enabled"]) {
    if (supplied(b, k)) {
      if (typeof b[k] !== "boolean") return { ok: false, reason: `BUDGET_INVALID:${k}-must-be-boolean` };
      out[k] = b[k];
    }
  }
  for (const k of ["maxPerRun", "maxModelCalls", "maxWallMs"]) {
    if (supplied(b, k)) {
      if (!isInt(b[k]) || b[k] < 0) return { ok: false, reason: `BUDGET_INVALID:${k}-must-be-an-integer->=0` };
      out[k] = b[k];
    }
  }
  return { ok: true, budget: out };
}

/** The kill switch, in ONE place: every exported entry point consults this FIRST. Returns the refusal
 *  object (zero model calls made, zero work done) or `null` when the pipeline is live. */
function disabledGuard(budget) {
  const r = resolveBudget(budget);
  if (!r.ok) return { ok: false, reason: r.reason, model_calls: 0 };
  if (r.budget.enabled === false) return { ok: false, reason: "disabled", model_calls: 0 };
  return null;
}

// ── signature + grouping (the dedup unit) ─────────────────────────────────────────────────────────

/** A ledger entry's reflection signature — REUSES the evidence store's `subjectKey` (concern kind +
 *  the file set it names), never a re-derived string. The role is the "concern kind" and the ledger
 *  entry's `components` is the file set, which is exactly the identity the underlying evidence store
 *  already uses for anti-cheat isolation. */
export function experienceSignature(exp) {
  const role = isStr(exp?.role, 1) ? exp.role : "unknown";
  const components = Array.isArray(exp?.components) ? exp.components.filter((c) => isStr(c, 1)) : [];
  return subjectKey(role, components);
}

/**
 * Group ledger entries into reflection UNITS by signature. Two experiences that share a signature are
 * ONE unit (one model call) — reflecting twice on the same identity would spend a second call on the
 * same question. Pure; the input is not mutated. Returns units in first-seen order.
 * @param {object[]} experiences ledger records
 * @returns {{signature:string, experiences:object[], representative:object}[]}
 */
export function groupExperiencesBySignature(experiences) {
  const bySig = new Map();
  for (const e of Array.isArray(experiences) ? experiences : []) {
    if (!isObj(e)) continue;
    const sig = experienceSignature(e);
    if (!bySig.has(sig)) bySig.set(sig, { signature: sig, experiences: [], representative: e });
    bySig.get(sig).experiences.push(e);
  }
  return [...bySig.values()];
}

// ── selection (PURE: no model, no write) ──────────────────────────────────────────────────────────

const asRecords = (x) => (Array.isArray(x) ? x : (Array.isArray(x?.records) ? x.records : []));

/** A reflection UNIT as produced by `groupExperiencesBySignature` / `selectExperiencesForReflection`. */
const isUnit = (x) => isObj(x) && Array.isArray(x.experiences) && x.experiences.length > 0;

/**
 * Normalise a `reflect`/`select` argument into reflection UNITS. An array of ALREADY-FORMED units is
 * used as-is (that is what the selector hands over); anything else (raw ledger records, a `{selected}`
 * / `{records}` carrier read) is grouped by signature. `every(isUnit)` rather than `some` so a MIXED
 * array cannot half-work — a caller that mixes a unit with a raw record is normalised consistently.
 */
const toUnits = (x) => {
  const arr = Array.isArray(x) ? x
    : Array.isArray(x?.selected) ? x.selected
    : Array.isArray(x?.units) ? x.units
    : Array.isArray(x?.records) ? x.records
    : [];
  return arr.length > 0 && arr.every(isUnit) ? arr : groupExperiencesBySignature(arr);
};

/**
 * Select which experiences to reflect on this round. PURE.
 *
 *   1. group the ledger by signature (above);
 *   2. DROP any unit whose signature was already reflected-on in a PRIOR reflection-attempt record —
 *      dedup across rounds, so the same question never spends a second model call. `dedupWindow` (ms)
 *      narrows "prior" to attempts newer than `nowMs - dedupWindow`; `null` = ALL prior attempts
 *      count (the conservative default);
 *   3. cap the batch at `maxPerRun`.
 *
 * The skipped counts are RETURNED (reported, never silent): a truncated batch with no trace is exactly
 * the "empty slot with stock on the shelf" shape 硬规则 9 warns about.
 *
 * @param {object|object[]} ledger      ledger records, or the `readExperienceLedger(root)` result
 * @param {object|object[]} priorAttempts reflection-attempt records (or a `{records}` carrier read);
 *   the "prior reflection-attempt record" set the dedup is against
 * @param {object} [opts]
 * @param {number} [opts.maxPerRun]     batch cap (falls back to `budget.maxPerRun` / the default)
 * @param {number|null} [opts.dedupWindow] ms window; `null` (default) = all prior attempts suppress
 * @param {number} [opts.nowMs]         "now" for the window (injected for determinism in tests)
 * @param {object} [opts.budget]        the `{enabled,...}` budget (the kill switch is honoured here too)
 */
export function selectExperiencesForReflection(ledger, priorAttempts, opts = {}) {
  const guard = disabledGuard(opts.budget);
  if (guard) return guard;

  const budget = resolveBudget(opts.budget).budget;
  const maxPerRun = isInt(opts.maxPerRun) ? opts.maxPerRun : budget.maxPerRun;
  const dedupWindow = opts.dedupWindow === undefined ? null : opts.dedupWindow;
  const nowMs = isInt(opts.nowMs) ? opts.nowMs : Date.now();

  const attempts = asRecords(priorAttempts).filter(isObj);
  const priorSignatures = new Set();
  for (const a of attempts) {
    if (!isStr(a.signature, 1)) continue;
    if (dedupWindow === null) { priorSignatures.add(a.signature); continue; }
    const ts = Date.parse(String(a.ts ?? ""));
    // An attempt with an unparseable timestamp is NOT silently dropped from the dedup set: an
    // unreadable window must not read as "never reflected on" (硬规则 3b). It suppresses.
    if (!Number.isFinite(ts) || nowMs - ts < dedupWindow) priorSignatures.add(a.signature);
  }

  const units = toUnits(ledger);
  const selected = [];
  let skipped_prior = 0;
  let skipped_cap = 0;
  let merged_within_batch = 0;
  for (const u of units) if (u.experiences.length > 1) merged_within_batch += u.experiences.length - 1;
  for (const u of units) {
    if (priorSignatures.has(u.signature)) { skipped_prior++; continue; }
    if (selected.length >= maxPerRun) { skipped_cap++; continue; }
    selected.push(u);
  }
  return {
    ok: true,
    units_evaluated: units.length,
    selected,
    batch_size: selected.length,
    skipped_prior,
    skipped_cap,
    merged_within_batch,
    dedupWindow,
    maxPerRun,
  };
}

// ── the model seam helpers ────────────────────────────────────────────────────────────────────────

const modelCall = async (model, prompt) => {
  const r = await model(prompt);
  const stdout = String(r?.stdout ?? "");
  return { stdout, status: r?.status ?? null, error: r?.error ? String(r.error.message ?? r.error).slice(0, 200) : null };
};

// ── the registry view shown to the model ──────────────────────────────────────────────────────────

const latestMethods = (registry) => (Array.isArray(registry) ? registry : (Array.isArray(registry?.latest) ? registry.latest : [])).filter(isObj);

/** A COMPACT, semantic view of the registry the model reads — enough to decide extend/compose/replace
 *  vs new, without dumping the whole version history. */
export function registryDigest(registry) {
  return latestMethods(registry).map((m) => ({
    method_id: m.method_id,
    status: m.status,
    domain_signals: m.applicability?.domain_signals ?? [],
    preconditions: m.applicability?.preconditions ?? [],
    steps: m.operation?.steps ?? [],
    expected_invariant: m.expected_invariant ?? null,
  }));
}

// ── the reflection prompt (ONE unit per call — no cross-unit leakage) ─────────────────────────────

/**
 * Build the reflection prompt for ONE reflection unit. ⛔ It includes ONLY this unit's own experiences
 * (their `summary`/`components`/`role`) plus the FULL current method registry — never another unit's
 * material, which is what "this looks like case X, go find something like it" would be.
 *
 * @param {object} o
 * @param {object} o.unit          `{signature, experiences, representative}`
 * @param {object|object[]} o.registry
 * @param {string[]} o.toolNames   the allowed `operation.tools` vocabulary (the capability catalog)
 */
export function buildReflectionPrompt({ unit, registry, toolNames = [] }) {
  // ⛔ `domain_claim` IS THE POINT OF THE JOIN (Plan item 2a). Without it the model is shown the
  //   pipeline's own bookkeeping ("verifier verdict \"supported\" on subject hypgen:ownership|…") and
  //   induces methods ABOUT the bookkeeping — which is exactly what the 2026-10-12 round did. The claim
  //   is carried VERBATIM from the linked claim records; `join_status` says whether one was found, so a
  //   missing claim is visible to the model rather than silently absent (硬规则 3b).
  const experiences = (unit?.experiences ?? []).map((e) => ({
    case_id: e.case_id, role: e.role, reported_by: e.reported_by,
    components: e.components ?? [], summary: e.summary, evidence: (e.evidence ?? []).map((x) => x.ref),
    domain_claim: isStr(e.domain_claim, 1) ? e.domain_claim : null,
    join_status: isStr(e.join_status, 1) ? e.join_status : null,
  }));
  const digest = registryDigest(registry);
  return [
    "You are the REFLECTION step of an architecture-discovery pipeline.",
    "You are shown ONE finding (an \"Experience\") that a system produced, and the FULL current registry",
    "of reusable discovery METHODS. Decide whether this finding teaches a reusable, TRANSFERABLE method.",
    "",
    "RULES",
    "1. A method is a HOW-TO-LOOK for a CLASS of problem that applies to MANY unrelated findings — not a",
    "   restatement of this single finding. If the finding is a one-off with no transferable operation,",
    "   answer \"no-method\".",
    "2. A NEGATIVE result (a claim that was REFUTED) is NOT itself a new method. You may only use it as a",
    "   `counterexample` for a candidate grounded in a DIFFERENT finding, or answer \"no-method\". Never",
    "   invent a standalone method whose only content is \"this specific claim is false\".",
    "3. Prefer \"extends\"/\"composes\" against an EXISTING registry method when one already covers the class",
    "   (name it in `method_ref`); otherwise \"new\". If the registry is empty, only \"new\"/\"no-method\".",
    "4. Ground every candidate in the finding's OWN evidence. Do not propose a method that only makes sense",
    "   because you were told where the answer is.",
    "4b. `domain_claim` is what the finding CLAIMS about the system; `summary` is only the pipeline's own",
    "   bookkeeping about the record. Ground the method in `domain_claim`, never in the bookkeeping — a",
    "   method whose whole content is 'this record is hard to classify' is about the recording pipeline,",
    "   not about the architecture, and does not transfer. When `join_status` is not \"linked\" there IS no",
    "   recorded claim for this finding: answer \"no-method\" rather than inventing one from the bookkeeping.",
    "5. `operation.tools` MUST be chosen ONLY from the ALLOWED TOOLS list below (1-4 entries), and each",
    "   one MUST be an INSTRUMENT you would RUN to INSPECT code. The files a finding is ABOUT — the subject",
    "   being inspected, including any file named in the EXPERIENCE above — are NOT tools: naming one there",
    "   says only that you were told where to look, and the pipeline strips it before the record is made.",
    "",
    "EXPERIENCE (this unit):",
    JSON.stringify(experiences, null, 1),
    "",
    `CURRENT METHOD REGISTRY (${digest.length} method(s)):`,
    JSON.stringify(digest, null, 1),
    "",
    "ALLOWED TOOLS (operation.tools vocabulary):",
    JSON.stringify(toolNames),
    "",
    "Respond with ONE JSON object and NOTHING ELSE:",
    "{",
    '  "decision": "new" | "extends" | "composes" | "no-method",',
    '  "method_ref": <string|null>,        // for extends/composes: the method_id in the registry this builds on',
    '  "method_id": <string|null>,         // for a new method: a new kebab-case slug (no version suffix)',
    '  "why_proposed": <string>,           // why this finding teaches a transferable method (>= 40 chars)',
    '  "evidence_pattern": <string>,       // the OBSERVABLE pattern in the finding this method keys on',
    '  "transferable_operation": <string>, // the HOW-TO-LOOK step that transfers to other findings',
    '  "applicability_boundary": <string>, // the condition under which this method does NOT apply',
    '  "expected_invariant": <string>,     // what must be TRUE of any finding this method applies to',
    '  "falsification": <string>,          // the observation that would REFUTE the method',
    '  "counterexample": <string|null>,    // a look-alike finding that does NOT fit (may name a refuted case)',
    '  "operation_tools": [<string>]       // 1-4 entries chosen ONLY from ALLOWED TOOLS',
    "}",
  ].join("\n");
}

// ── the candidate assembler + decision validator ──────────────────────────────────────────────────

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** The next version for a method_id = (highest recorded version for it) + 1 — the registry's own
 *  monotonicity rule, computed here so the assembled candidate starts at a legal version. */
const nextVersion = (registry, methodId) => {
  const versions = latestMethods(registry).filter((m) => m.method_id === methodId).map((m) => m.version).filter(isInt);
  return versions.length ? Math.max(...versions) + 1 : 1;
};

/**
 * Validate a model DECISION against the registry + the decision vocabulary. PURE.
 * 硬规则: an `extends`/`composes` whose `method_ref` does not resolve in the registry is REFUSED with
 *  its own code — a candidate cannot "extend" a method that does not exist.
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function validateReflectionDecision(rec, { registry = [] } = {}) {
  if (!isObj(rec)) return { ok: false, reasons: ["DECISION_NOT_OBJECT"] };
  const reasons = [];
  if (!DECISIONS.includes(rec.decision)) reasons.push(`DECISION_NOT_IN_VOCAB:${String(rec.decision)}`);
  const known = new Set(latestMethods(registry).map((m) => m.method_id));

  if (rec.decision === "extends" || rec.decision === "composes") {
    if (!isStr(rec.method_ref, 1)) {
      reasons.push(`METHOD_REF_REQUIRED:decision=${rec.decision}-must-name-a-method_ref`);
    } else if (!known.has(rec.method_ref)) {
      reasons.push(`METHOD_REF_UNRESOLVED:${rec.method_ref}-is-not-a-method_id-in-the-registry`);
    }
  }
  if (rec.decision === "new" && !isStr(slug(rec.method_id), 3)) {
    reasons.push("METHOD_ID_REQUIRED:decision=new-must-name-a-method_id-slug");
  }
  if (rec.decision === "no-method" && rec.method_id != null) {
    reasons.push("METHOD_ID_FORBIDDEN:decision=no-method-cannot-name-a-method_id");
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Assemble a full `DiscoveryMethod` record from a model decision. Pure. The MECHANICAL fields
 * (version, ts, provenance, cost_budget, status, retirement_reason, supersedes) are filled HERE from
 * real data — the model is never asked to invent a version or a provenance id. `status` is ALWAYS
 * `"draft"`: this pipeline never mints an `active` method (that is `validateGeneralization`'s call).
 *
 * ⛔ TOOL ≠ SUBJECT (the other half of the registry's new refusal): a model that answers "the tool I
 * used was the file the finding is about" has said nothing about HOW TO LOOK, so the subject files are
 * STRIPPED from `operation.tools` here, BEFORE the registry's validator sees them. Stripping is
 * RECORDED (`stripped_subject_tools`), never silent: a candidate that quietly lost half its tools is
 * indistinguishable from one the model never named them in — and the prompted instruction is a request,
 * not a guarantee. The set the strip uses is the unit's OWN experiences, which ARE the candidate's
 * provenance (`provenance_evidence` below), so the pre-filter and the validator agree by construction.
 */
export function assembleCandidate({ rec, unit, registry, budget, nowIso }) {
  const b = resolveBudget(budget).budget;
  const isNew = rec.decision === "new";
  const method_id = isNew ? slug(rec.method_id) : String(rec.method_ref);
  // ⛔ Scoped to the experiences that actually CONTRIBUTE a provenance ref: an entry with no `id`
  // cannot appear in `provenance_evidence`, so it is not part of the seed set either — the pre-filter
  // and the validator's rule must agree exactly, or the assembler would strip more than the contract.
  const provenance_experiences = (unit?.experiences ?? []).filter((e) => isObj(e) && isStr(e.id, 1));
  const provenance = provenance_experiences.map((e) => e.id);
  // The subject basenames of THIS unit's own findings — the same derivation the registry performs from
  // the record's provenance, called with the experiences in hand rather than re-read from the ledger.
  const subjects = new Set(seedSetForRecord({ provenance_evidence: provenance }, provenance_experiences).component_basenames);
  const requestedTools = Array.isArray(rec.operation_tools) ? rec.operation_tools.filter((t) => isStr(t, 1)) : [];
  const stripped_subject_tools = requestedTools.filter((t) => subjects.has(basenameOf(t)));
  return {
    method_id,
    version: nextVersion(registry, method_id),
    ts: nowIso,
    provenance_evidence: provenance,
    applicability: {
      domain_signals: [rec.evidence_pattern].filter(isStr),
      preconditions: [rec.applicability_boundary].filter(isStr),
    },
    operation: {
      steps: [rec.transferable_operation].filter(isStr),
      tools: requestedTools.filter((t) => !subjects.has(basenameOf(t))),
    },
    // What was removed and why — on the RECORD, so the refusal is visible to a reviewer rather than
    // living only in this call's return value.
    stripped_subject_tools,
    expected_invariant: isStr(rec.expected_invariant, 10) ? rec.expected_invariant : "",
    falsification: isStr(rec.falsification, 1) ? rec.falsification : "",
    cost_budget: { max_candidates: b.maxPerRun, max_model_calls: b.maxModelCalls, max_wall_ms: b.maxWallMs },
    status: "draft",
    retirement_reason: null,
    // A new version of a `method_id` (the `extends`/`composes` arm) supersedes by VERSION, not by this
    // field; an unrelated method being replaced is a judgment this pipeline does not make, so `null`.
    supersedes: null,
    // The model's own narrative, carried so a reviewer can audit the decision without re-running it.
    reflection: {
      why_proposed: rec.why_proposed ?? null,
      evidence_pattern: rec.evidence_pattern ?? null,
      transferable_operation: rec.transferable_operation ?? null,
      applicability_boundary: rec.applicability_boundary ?? null,
      counterexample: isStr(rec.counterexample, 1) ? rec.counterexample : null,
      decision: rec.decision,
      method_ref: rec.method_ref ?? null,
    },
  };
}

// ── reflect: the ONE model-calling step ───────────────────────────────────────────────────────────

/**
 * Reflect on a batch of reflection units, producing one decision per unit.
 *
 * @param {object} o
 * @param {object[]} o.experiences   reflection UNITS (or raw experiences — grouped here if need be)
 * @param {object}   o.registry      the current method registry (`readMethodRegistry(root)` or an array)
 * @param {(prompt:string)=>Promise<{stdout:string}>} o.model  INJECTABLE model seam (no spawn in-logic)
 * @param {object}   [o.budget]      `{enabled,maxPerRun,maxModelCalls,maxWallMs}`
 * @param {string}   [o.root]        repo root used to resolve the capability-catalog default
 * @param {string}   [o.modelId]     the model the launcher was ASKED for (recorded as `requested_model`)
 * @param {number}   [o.nowMs]
 * @returns {Promise<object>} `{ok, decisions[], model_calls, skipped_budget, wall_ms, cost}`
 */
export async function reflect({ experiences, registry = [], model, budget = {}, root = null, modelId = null, nowMs = Date.now() } = {}) {
  const guard = disabledGuard(budget);
  if (guard) return guard;
  if (typeof model !== "function") return { ok: false, reason: "model-seam-missing", model_calls: 0 };

  const b = resolveBudget(budget).budget;
  const units = toUnits(experiences);
  const catalog = defaultToolNames(root ?? undefined);
  const toolNames = catalog.ok ? catalog.names : [];
  const t0 = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const decisions = [];
  const calls = [];
  let skipped_budget = 0;

  for (const unit of units) {
    const signature = unit.signature ?? experienceSignature(unit.representative ?? unit.experiences?.[0]);
    // Budget, consulted BEFORE each call: a breach STOPS further calls and is REPORTED, per unit.
    if (calls.length >= b.maxModelCalls) {
      skipped_budget++;
      decisions.push({ signature, case_ids: caseIds(unit), ok: false, skipped: true, reasons: ["BUDGET_MAX_MODEL_CALLS"], decision: null });
      continue;
    }
    if (Date.now() - t0 >= b.maxWallMs) {
      skipped_budget++;
      decisions.push({ signature, case_ids: caseIds(unit), ok: false, skipped: true, reasons: ["BUDGET_MAX_WALL_MS"], decision: null });
      continue;
    }

    const prompt = buildReflectionPrompt({ unit, registry, toolNames });
    const tCall = Date.now();
    const { stdout } = await modelCall(model, prompt);
    const fields = modelCallFields({ requested: modelId, stdout });
    const call = { ...fields, wall_ms: Date.now() - tCall };
    calls.push(call);

    const parsed = parseJsonObject(callText(stdout));
    const base = { signature, case_ids: caseIds(unit), model_call: call };

    if (!parsed) {
      decisions.push({ ...base, ok: false, decision: null, reasons: ["UNPARSEABLE_MODEL_OUTPUT"] });
      continue;
    }
    const v = validateReflectionDecision(parsed, { registry });
    if (!v.ok) {
      decisions.push({ ...base, ok: false, decision: parsed.decision ?? null, reasons: v.reasons });
      continue;
    }
    if (parsed.decision === "no-method") {
      // A REAL judgment: the model DID look and concluded nothing transfers. Distinct from a refusal.
      decisions.push({ ...base, ok: true, decision: "no-method", candidate: null, reflection: narrative(parsed) });
      continue;
    }
    const candidate = assembleCandidate({ rec: parsed, unit, registry, budget: b, nowIso });
    // The candidate is checked with the REGISTRY'S OWN validator (reused, never re-implemented): a
    // candidate that cannot be a legal registry record is refused here rather than persisted broken.
    // The seed set is resolved from the SAME ledger the unit came from (`root`), so the validator's
    // tool≠subject rule sees exactly the provenance `assembleCandidate` filtered against.
    const seeds = provenanceSeeds(root ?? REPO_ROOT, candidate);
    const cv = validateMethodRecord(candidate, { toolCatalog: toolNames, existing: latestMethods(registry), provenanceSeeds: seeds });
    if (!cv.ok) {
      decisions.push({ ...base, ok: false, decision: parsed.decision, reasons: cv.reasons, stripped_subject_tools: candidate.stripped_subject_tools });
      continue;
    }
    decisions.push({ ...base, ok: true, decision: parsed.decision, candidate, reflection: narrative(parsed), stripped_subject_tools: candidate.stripped_subject_tools });
  }

  return {
    ok: true,
    decisions,
    model_calls: calls.length,
    skipped_budget,
    wall_ms: Date.now() - t0,
    cost: computeReflectionCost(calls, { wall_ms: Date.now() - t0 }),
    tool_catalog: catalog.ok ? { ok: true, count: toolNames.length } : { ok: false, reason: catalog.reason },
  };
}

const caseIds = (unit) => (unit?.experiences ?? []).map((e) => e.case_id).filter(isStr);
const narrative = (r) => ({
  why_proposed: r.why_proposed ?? null,
  evidence_pattern: r.evidence_pattern ?? null,
  transferable_operation: r.transferable_operation ?? null,
  applicability_boundary: r.applicability_boundary ?? null,
  counterexample: isStr(r.counterexample, 1) ? r.counterexample : null,
});

// ── the held-out LINEAGE: a held-out case is outside the BATCH, but the batch is not the method ────
//
// ⛔ THE DEFECT THIS CLOSES (found by a read-only audit of the landed Phase 2, 2026-10-12): the first
//   "generalization pass" refused a held-out case only when its id appeared in the CANDIDATE VERSION's
//   own `provenance_evidence`. `shared-contract-divergence` v1 was seeded from evidence-store record
//   `outcome-bb…`; v3 of the SAME method was produced from that record's Experience in the same round;
//   v2 was then "validated" against that same Experience and promoted to `active`. The method's whole
//   LINEAGE — not one version of it — is what the held-out case has to be outside of.

/** Canonical in-provenance reference to another version of a method (`method:<id>@<version>`), the form
 *  a candidate uses to record that it was derived from a PRIOR method rather than from raw evidence. */
export const METHOD_REF_IN_PROVENANCE_RE = /^method:([^@]+)@(\d+)$/;

/**
 * Every recorded version that belongs to `candidate`'s lineage: all versions of its `method_id` in the
 * registry (whatever order they were written in), every method named by a `method:<id>@<v>` reference
 * in its `provenance_evidence`, and the candidate itself (which may not be in the registry yet).
 * Pure. The candidate is returned FIRST; the rest is deduplicated by `method_id@version`.
 */
export function lineageVersions(candidate, registry = []) {
  const all = (Array.isArray(registry) ? registry : (registry?.history ?? registry?.latest ?? [])).filter(isObj);
  const ids = new Set();
  if (isStr(candidate?.method_id, 1)) ids.add(candidate.method_id);
  for (const p of Array.isArray(candidate?.provenance_evidence) ? candidate.provenance_evidence : []) {
    const m = METHOD_REF_IN_PROVENANCE_RE.exec(String(p));
    if (m) ids.add(m[1]);
  }
  const key = (m) => `${m?.method_id ?? ""}@${isInt(m?.version) ? m.version : "?"}`;
  const out = [];
  const seen = new Set();
  const push = (m) => { if (isObj(m) && isStr(m.method_id, 1) && !seen.has(key(m))) { seen.add(key(m)); out.push(m); } };
  push(candidate);
  for (const m of all) if (ids.has(m.method_id)) push(m);
  return out;
}

/** Two records describing the same defect under different ids share at least this many components. */
export const LINEAGE_MIN_SHARED_COMPONENTS = 2;

/**
 * Is `heldOutCase` inside the candidate's LINEAGE (not merely inside the batch that minted it)?
 * PURE. Returns `{ok:true}` when the held-out case is genuinely outside, or
 * `{ok:false, reason:"HELD_OUT_SHARES_LINEAGE:…", hits:[…]}` naming EVERY path that fired (硬规则 3 —
 * a refusal enumerates what matched, it does not return a bare boolean).
 *
 * Two independent ways to share a lineage, because they are different defects with the same effect:
 *   • RECORD identity — the held-out's `id` or `source_ref` appears in any lineage version's
 *     `provenance_evidence`, or in the `provenance_evidence`/`source_ref` of an Experience those
 *     entries resolve to (one hop: the ledger record a lineage version cites is itself part of the
 *     lineage, and it can point back at the held-out's source).
 *   • DEFECT identity — the held-out's `components` share >= `LINEAGE_MIN_SHARED_COMPONENTS` files with
 *     a lineage SEED Experience's `components`. The same defect re-filed under a different record id
 *     is the same case.
 *
 * `experiences` is the ledger's record list (`readExperienceLedger(root).records`); an unresolvable
 * provenance entry is NOT dropped — the raw reference is still compared against the held-out's ids.
 */
export function checkLineageIsolation({ candidate, heldOutCase, registry = [], experiences = [] } = {}) {
  const lineage = lineageVersions(candidate, registry);
  const expById = new Map();
  for (const e of Array.isArray(experiences) ? experiences : []) if (isObj(e) && isStr(e.id, 1)) expById.set(e.id, e);

  const heldIds = [heldOutCase?.id, heldOutCase?.source_ref].filter((x) => isStr(x, 1));
  const heldComponents = Array.isArray(heldOutCase?.components) ? heldOutCase.components.filter((c) => isStr(c, 1)) : [];

  const hits = [];
  const seeds = [];
  const where = (v) => `${v?.method_id ?? "?"}@${isInt(v?.version) ? v.version : "?"}`;
  for (const v of lineage) {
    for (const p of Array.isArray(v.provenance_evidence) ? v.provenance_evidence : []) {
      if (!isStr(p, 1)) continue;
      if (heldIds.includes(p)) hits.push({ kind: "version_provenance", method: where(v), ref: p });
      const seed = expById.get(p);
      if (!seed) continue;
      seeds.push(seed);
      if (isStr(seed.source_ref, 1) && heldIds.includes(seed.source_ref)) {
        hits.push({ kind: "referenced_experience_source_ref", method: where(v), ref: seed.source_ref, via: p });
      }
      for (const q of Array.isArray(seed.provenance_evidence) ? seed.provenance_evidence : []) {
        if (isStr(q, 1) && heldIds.includes(q)) hits.push({ kind: "referenced_experience_provenance", method: where(v), ref: q, via: p });
      }
    }
  }
  for (const seed of seeds) {
    const shared = heldComponents.filter((c) => (Array.isArray(seed.components) ? seed.components : []).includes(c));
    if (shared.length >= LINEAGE_MIN_SHARED_COMPONENTS) {
      hits.push({ kind: "shared_components", ref: seed.id ?? seed.case_id ?? null, shared: shared.sort() });
    }
  }

  if (!hits.length) return { ok: true, lineage: lineage.map(where), hits: [] };
  const first = hits[0];
  const detail = first.kind === "shared_components"
    ? `shares-${first.shared.length}-components-(${first.shared.join(",")})-with-lineage-seed-${first.ref}`
    : `${first.kind}-${first.ref}-via-${first.method}`;
  return {
    ok: false,
    reason: `HELD_OUT_SHARES_LINEAGE:${heldOutCase?.id ?? "held-out"}-${detail}`,
    hits,
    lineage: lineage.map(where),
  };
}

// ── the EVALUATION PIN: a held-out case is only meaningful at a commit where its verdict is true ───
//
// ⛔ THE SECOND DEFECT THIS CLOSES: the Phase 2 verifier read develop `9a329772a`, where the fix for the
//   held-out case (`706545794`) had ALREADY landed. Read at that commit, the method's own invariant
//   "holds" — i.e. the correct verdict there is the OPPOSITE of the one the case's historical role
//   supplies. The verifier answered `supported` and was graded "correct" only because the expected
//   verdict came from the case's role, not from the code it was actually shown.
//   ⇒ The expected verdict must be TRUE at the commit that is evaluated. That commit is the case's
//   `evaluation_pin`, it must predate the fix, and it must be recorded on the verdict.

/** A "positive" case is one whose ground-truth verdict is a REAL finding (`supported`) — the class for
 *  which "the defect was there and was fixed" is meaningful, and which therefore needs a `fix_commit`. */
export const isPositiveCase = (role) => roleExpectedVerdicts(role).includes("supported");

/**
 * The static half of the temporal binding: the held-out case must NAME the two commits. PURE.
 * 硬规则 3b — a case that cannot say where its verdict is true is refused with its OWN code, never
 * silently evaluated at whatever the checkout happens to be.
 */
export function validateEvaluationPin(heldOutCase) {
  const reasons = [];
  if (!isStr(heldOutCase?.evaluation_pin, 1)) reasons.push("NO_EVALUATION_PIN");
  if (isPositiveCase(heldOutCase?.role) && !isStr(heldOutCase?.fix_commit, 1)) reasons.push("NO_FIX_COMMIT");
  return { ok: reasons.length === 0, reasons };
}

/**
 * The dynamic half: `fix_commit` must NOT be an ancestor of `evaluation_pin` — if it is, the fix was
 * already in the tree at the pin, so the pin cannot exhibit the defect the case claims.
 *
 * `isAncestor(ancestor, descendant)` returns `true` / `false` / `null` for "could not determine".
 * ⛔ The three-valued shape is load-bearing: a git failure that collapsed into `false` would read as
 * "the pin is fine" and let a mismatched case through (硬规则 3b).
 */
export function checkTemporalBinding({ heldOutCase, isAncestor } = {}) {
  const pin = heldOutCase?.evaluation_pin;
  const fix = heldOutCase?.fix_commit;
  if (!isStr(fix, 1)) return { ok: true, checked: false };   // a non-positive case names no fix
  if (typeof isAncestor !== "function") return { ok: false, reason: "ANCESTRY_CHECK_UNAVAILABLE:no-isAncestor-seam" };
  const r = isAncestor(fix, pin);
  if (r === true) {
    return { ok: false, checked: true, reason: `TEMPORAL_MISMATCH:fix_commit-${fix}-is-an-ancestor-of-evaluation_pin-${pin}-so-the-fix-had-already-landed-and-the-pin-cannot-exhibit-the-defect` };
  }
  if (r === null) return { ok: false, checked: true, reason: `EVALUATION_PIN_UNRESOLVED:could-not-decide-whether-${fix}-is-an-ancestor-of-${pin}` };
  return { ok: true, checked: true };
}

/** The real ancestry seam. `null` (not `false`) on any git failure — see `checkTemporalBinding`. */
export const gitIsAncestor = (root) => (ancestor, descendant) => {
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", String(ancestor), String(descendant)], { stdio: "ignore" });
    return true;
  } catch (e) {
    return e?.status === 1 ? false : null;   // git exits 1 for "not an ancestor"; anything else is a failure
  }
};

/**
 * Directories that must be ABSENT from the tree the verifier runs in. The four in the imported
 * `PIN_FORBIDDEN_DIRS` are the hypothesis-generation stage's contract; `experiments`, `meta` and `adr`
 * are this stage's ADDITION (the methodology layer reaches further than that stage's inventory scope
 * needed), so this is a SEPARATE, additive list rather than an edit of the dependency's contract.
 */
export const DISCOVERY_PIN_FORBIDDEN_DIRS = Object.freeze([...PIN_FORBIDDEN_DIRS, "experiments", "meta", "adr"]);

/**
 * Is `pinDir` a usable stripped pin? `null` when it is; otherwise the refusal reason. Same three-valued
 * discipline as `verifyCwdRefusal` in the hypothesis-generation stage: naming a directory proves nothing
 * about the tree, so the forbidden directories are enumerated BY POSITION and their presence is its own
 * refusal (硬规则 2/3). `PIN_IS_LIVE_CHECKOUT` is its own code — "never the live checkout" is the point.
 */
export function verifyStrippedPin(pinDir, { existsSync = fs.existsSync, repoRoot = null } = {}) {
  if (!isStr(pinDir, 1)) return "PIN_DIR_REQUIRED";
  if (repoRoot && path.resolve(pinDir) === path.resolve(repoRoot)) return "PIN_IS_LIVE_CHECKOUT";
  if (!existsSync(pinDir)) return `PIN_DIR_MISSING:${pinDir}`;
  const present = DISCOVERY_PIN_FORBIDDEN_DIRS.filter((d) => { try { return existsSync(path.join(pinDir, d)); } catch { return false; } });
  if (present.length) return `PIN_NOT_STRIPPED:${present.join(",")}`;
  return null;
}

/**
 * Materialise the WHOLE tree at `rev` into `dir`, then DELETE every forbidden top-level directory —
 * the materialisation half of the stripped-pin discipline (arch-hypothesis-generation.mjs archives only
 * its own inventory scope; this verifier reads arbitrary components, so it takes the whole tree).
 * `removed` reports WHICH directories were actually deleted, so "stripped" is a reading, not an
 * assumption. Failures are a refusal with git's/tar's own message — never an empty tree read as fine.
 */
export function materializeStrippedPin({ root, rev, dir } = {}) {
  if (!isStr(root, 1)) return { ok: false, reason: "PIN_ROOT_REQUIRED" };
  if (!isStr(rev, 1)) return { ok: false, reason: "PIN_REV_REQUIRED" };
  if (!isStr(dir, 1)) return { ok: false, reason: "PIN_DIR_REQUIRED" };
  try {
    // stderr is DROPPED rather than inherited: a bad rev is a normal refusal here, and git's "fatal:"
    // would otherwise be printed into whatever stream the caller is using for its own readings.
    const tar = execFileSync("git", ["-C", root, "archive", "--format=tar", rev], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] });
    fs.mkdirSync(dir, { recursive: true });
    // stdin MUST stay a pipe here: `input` is written to fd 0, so `"ignore"` would silently feed tar nothing.
    execFileSync("tar", ["-x", "-C", dir], { input: tar, maxBuffer: 1 << 26, stdio: ["pipe", "ignore", "ignore"] });
  } catch (e) {
    return { ok: false, reason: `PIN_MATERIALIZE_FAILED:${String(e?.message ?? e).slice(0, 200)}` };
  }
  const removed = [];
  for (const d of DISCOVERY_PIN_FORBIDDEN_DIRS) {
    const p = path.join(dir, d);
    if (!fs.existsSync(p)) continue;
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(d);
  }
  return { ok: true, dir, rev, removed, stripped: verifyStrippedPin(dir) === null };
}

// ── validateGeneralization: the cross-case test (the ONLY draft→active gate) ──────────────────────

/** The verdict a role's ground truth corresponds to — REUSES the ledger's own role↔verdict contract
 *  rather than re-declaring the mapping here (a second copy would drift). */
export const roleExpectedVerdicts = (role) => ROLE_VERDICT_COMPAT[role] ?? [];

/** The `applies` vocabulary of the applicability gate. `undetermined` is a REAL answer and is not the
 *  same as `no`: "this method does not cover the target" and "I could not tell whether it does" lead
 *  to opposite dispositions, and collapsing them would retire methods on the verifier's uncertainty
 *  (硬规则 3b). */
export const APPLIES_VOCAB = Object.freeze(["yes", "no", "undetermined"]);

/** The third outcome value, alongside `evaluated` / `not-evaluated`: the method was never applied
 *  because it does not cover the case. It is NOT a failed reading and NOT a failed method. */
export const OUTCOME_NOT_APPLICABLE = "not-applicable";

/** The report-only state a non-`independent` level may reach. Spelled once, so no reader has to
 *  remember which word the cap uses. */
export const PROMOTION_REPORT_ONLY_STATUS = "trial";

/**
 * THE LEVEL CAP — the promotion path's own decision, as a NAMED function.
 *
 * A correct prediction moves the candidate; WHICH state it moves to is decided here and nowhere else:
 * an `independent` verdict licenses `active`, and every OTHER level (`teaching`, `transfer`,
 * `production-open`, and `unlabelled` for a record that never declared one) caps at the report-only
 * `trial`, which `activeMethods()` never hands to a consumer.
 *
 * ⛔ WHY IT IS EXTRACTED (task gap-open-discovery-periodic-baseline-vs-guided-gain, AC (e)). A paired
 *   baseline-vs-guided gain round is `production-open` evidence and must NEVER be read as independent
 *   generalization evidence. That claim is only checkable against the REAL decision, so the decision
 *   is a function a caller can name and a test can call — not an inline ternary a test would have to
 *   re-implement (which would then agree with itself rather than with production).
 *
 * @param {unknown} level  any evidence level, or anything else (read through `evidenceLevelOf`, so an
 *                         absent/garbage value reads as `unlabelled` and takes the STRICT branch).
 * @returns {"active"|"trial"}
 */
export function promotionStatusForLevel(level) {
  return isIndependentEvidenceLevel(level) ? "active" : PROMOTION_REPORT_ONLY_STATUS;
}

/**
 * The verifier prompt. It asks for the APPLICABILITY decision FIRST, then — only if the method covers
 * the target — the blind prediction, WITHOUT telling the verifier that case's ground-truth role.
 *
 * ⛔ WHY THE GATE IS IN THE SAME CALL (gap-discovery-method-generalization-failures-diagnosis-and-retest,
 *   Plan item 2b). Measured on the 2026-10-12 regression run: of 4 candidate × held-out pairings, the
 *   methods' own `applicability` matched 0 of the required record fields on EVERY held-out, while the
 *   same predicate was satisfied by every one of their own seeds. With no gate, the verifier forced a
 *   verdict on cases outside the method's declared domain, and "did not apply" came back wearing the
 *   shape of "predicted wrong" — so all three were scored as failures and the candidates retired.
 *   Asking in the SAME call rather than a second one is deliberate: the gate must not cost a call, or
 *   it becomes the thing a budget-bound run drops first.
 *
 * @param {object} o
 * @param {object} o.candidate
 * @param {object} o.heldOutCase
 * @param {object|null} [o.evidencePack] the deterministic evidence pack (see `evidencePackForPin`),
 *   rendered verbatim when present. It is the SAME kind of pack the hypothesis-generation verifier
 *   already gets (`buildEvidencePack`), reused by import — a resource-bound reading failure is fixed by
 *   handing the verifier the definition and import lines, NOT by raising its turn cap.
 */
export function buildGeneralizationPrompt({ candidate, heldOutCase, evidencePack = null }) {
  return [
    "You are a VERIFIER. Apply ONE architecture-discovery method to a target file set and PREDICT the",
    "outcome. You are NOT told the expected answer: judge from the files themselves.",
    "",
    "METHOD:",
    JSON.stringify({
      method_id: candidate.method_id,
      steps: candidate.operation?.steps ?? [],
      applicability: candidate.applicability ?? null,
      expected_invariant: candidate.expected_invariant ?? null,
      falsification: candidate.falsification ?? null,
    }, null, 1),
    "",
    "TARGET FILE SET (read them with your tools):",
    JSON.stringify(heldOutCase?.components ?? []),
    ...(evidencePack && isStr(evidencePack.text, 1)
      ? ["", "DETERMINISTIC EVIDENCE PACK (assembled before this call — read it before the files):", evidencePack.text]
      : []),
    "",
    "STEP 1 — APPLICABILITY. Decide FIRST whether this method's `applicability` covers the target file",
    "set AT ALL. A method that keys on a class of artifact the target does not contain does NOT apply,",
    "however interesting the target is. If it does not apply, answer applies:\"no\" and STOP — do NOT",
    "force a verdict on a case outside the method's declared domain, because a verdict produced that way",
    "is a wrong prediction wearing a correct prediction's shape. Answer applies:\"undetermined\" only when",
    "you genuinely cannot tell whether it applies.",
    "",
    "STEP 2 — only when applies is \"yes\" or \"undetermined\": apply the method's steps to the file set and",
    "decide whether the method's `expected_invariant` HOLDS or is VIOLATED there.",
    "Respond with ONE JSON object and NOTHING ELSE:",
    "{",
    '  "applies": "yes" | "no" | "undetermined",',
    '  "applies_reason": <string>,        // why the method does, or does not, cover THIS file set',
    '  "invariant_holds": true | false,   // omit (or null) when applies is "no"',
    '  "verdict": "supported" | "refuted" | "undetermined",  // supported = invariant VIOLATED (a real finding); refuted = invariant holds (claim was false); undetermined = could not tell. Omit when applies is "no"',
    '  "reasoning": <string>',
    "}",
  ].join("\n");
}

/**
 * Run the cross-case generalization test for ONE candidate against a held-out Experience (one NOT in
 * the batch that produced the candidate). Runs the candidate's `operation.steps` as a bounded verifier
 * call (`--tools Read,Grep`, turn-budget discipline) against the held-out case's components, and asks
 * whether the prediction matches the case's KNOWN role.
 *
 * A candidate promotes `draft → active` ONLY on a correct prediction. A WRONG prediction retires it
 * (`status:"retired"` + a non-null `retirement_reason`); an UNEVALUABLE one (turn budget exhausted /
 * unparseable) leaves it `draft` with `promoted:false` and its own `not_evaluated_reason` — a
 * failed READING is never reported as a failed METHOD (硬规则 3b).
 *
 * ⛔ A REFUSAL IS NOT A VERDICT. Three pre-conditions gate the call, and each is a REFUSAL — the model
 * is never called, the candidate is NOT retired, and the outcome is recorded as `not-evaluated` with
 * the refusal's own code:
 *   • `HELD_OUT_PREVIOUSLY_USED` — the case is in the GLOBAL case-identity index (a use recorded in
 *     ANY carrier: an earlier sealed file, a method's seed set, a publicly-surfaced case). Runs only
 *     when the caller supplies a `caseIdentityIndex`; the verdict then carries
 *     `previously_used_ok: true|false|null` (`null` = no index supplied ⇒ the gate was NOT run);
 *   • `HELD_OUT_SHARES_LINEAGE`  — the held-out case is inside the candidate's whole lineage;
 *   • `NO_EVALUATION_PIN` / `NO_FIX_COMMIT` — the case cannot say at which commit its verdict is true;
 *   • `TEMPORAL_MISMATCH`        — the fix had already landed at the pin the case names;
 *   • `PIN_DIR_REQUIRED` / `PIN_NOT_STRIPPED` / `PIN_IS_LIVE_CHECKOUT` — the verifier was not given a
 *     stripped detached tree at the pin. Reading the LIVE checkout is how the Phase 2 pass graded a
 *     case against a tree in which its defect was already fixed.
 *
 * @param {object} o
 * @param {object} o.heldOutCase  the held-out Experience; carries `evaluation_pin` (and, for a positive
 *   case, `fix_commit`), the commits at which its expected verdict is TRUE and was made true
 * @param {string} o.pinDir    the STRIPPED tree at `evaluation_pin` the verifier must run in — built by
 *   `materializeStrippedPin`; the injected `model` seam must be launched with this as its cwd
 * @param {object[]} [o.experiences] the ledger records, used to resolve the lineage one hop
 * @param {(a:string,b:string)=>boolean|null} [o.isAncestor] ancestry seam (default: real git, needs `root`)
 * @param {string} [o.root]    repo root, for the default ancestry seam and the live-checkout refusal
 * @returns {Promise<object>} `{ok, called, outcome, evaluated_commit, verifier_cwd, refusal_code,
 *                              predicted_verdict, expected_verdicts, correct, promoted, candidate_after,
 *                              retirement_reason, not_evaluated_reason, model_call, lineage_ok,
 *                              temporal_ok, verdict_ref?}`
 *   `lineage_ok` / `temporal_ok` are the two gates the REGISTRY's promotion rule reads: `true` = ran
 *   and passed, `false` = ran and failed, `null` = never reached (硬规则 3b — never one value).
 *   With a `root`, an EVALUATED verdict is also RECORDED in the verdict carrier and the returned
 *   object carries its `verdict_ref` — the ref a `draft → active` promotion must cite
 *   (`PROMOTION_WITHOUT_VALID_GENERALIZATION` otherwise). A refusal is recorded only when the caller
 *   asks (`recordGeneralizationVerdict`), and then `verdict_recorded:false` says so.
 */
export async function validateGeneralization(opts = {}) {
  const verdict = await runGeneralization(opts);
  return maybeRecordGeneralizationVerdict(opts, verdict);
}

/**
 * RECORD an EVALUATED verdict into the verdict carrier, so a later draft→active promotion can cite it
 * and the registry can re-read what the verifier returned. Returns the verdict unchanged (plus
 * `verdict_ref`) when recorded.
 *
 * ⛔ Only `outcome:"evaluated"` is recorded AUTOMATICALLY. A REFUSAL is a pre-condition on the reading,
 *   not a verdict on the method, and a refusal's own record is the CALLER's explicit act
 *   (`recordGeneralizationVerdict`) — auto-recording it here would write carrier lines from every
 *   refusal path, including the paths that are refused before a case is even resolvable.
 * ⛔ No `root` ⇒ nothing is recorded and the verdict is returned untouched: `verdict_recorded:false`.
 *   A caller that cannot say where the carrier lives must not be told the verdict was persisted.
 */
function maybeRecordGeneralizationVerdict({ root, candidate, heldOutCase, caseIdentityIndex = null } = {}, verdict) {
  // `evaluated` and `not-applicable` are both RECORDED: both are readings a third party must be able to
  // re-read (how often the gate diverted is otherwise invisible), and neither can license a promotion —
  // the registry's rule requires `outcome:"evaluated" && correct:true`. A `not-evaluated` READING is
  // still the caller's explicit act: it says nothing about the method.
  if (!isStr(root, 1) || (verdict?.outcome !== "evaluated" && verdict?.outcome !== OUTCOME_NOT_APPLICABLE)) return verdict;
  const rec = recordGeneralizationVerdict(root, {
    ...verdict,
    method_id: isStr(candidate?.method_id, 1) ? candidate.method_id : null,
    version: Number.isInteger(verdict?.candidate_after?.version) ? verdict.candidate_after.version : null,
    held_out_case_id: heldOutCase?.case_id ?? heldOutCase?.id ?? null,
    evaluation_pin: isStr(heldOutCase?.evaluation_pin, 1) ? heldOutCase.evaluation_pin : null,
    // WHICH label was judged, and WHICH index it was checked against (Plan item 4: "the verdict
    // records the pin, the label sha and the index sha it was checked against"). Both are recorded so
    // a third party can re-read the exact inputs of the judgment instead of trusting its summary.
    label_sha256: heldOutCase ? caseLabelSha256(heldOutCase) : null,
    index_sha256: caseIdentityIndex?.sha256 ?? null,
  });
  return rec.ok
    ? { ...verdict, verdict_ref: rec.id, verdict_recorded: true }
    : { ...verdict, verdict_ref: null, verdict_recorded: false, verdict_record_reasons: rec.reasons };
}

/** Was the method APPLIED at all? `applies` is on every verdict this module returns; a verdict that
 *  never reached the model (a refusal) carries `null`. Placed here so the carrier and the metrics read
 *  the SAME predicate. */
const appliedOf = (v) => (v?.outcome === OUTCOME_NOT_APPLICABLE ? "no" : (isStr(v?.applies, 1) ? v.applies : null));

/** The SOURCE case a `teaching`/`transfer` verdict names — the known case its answer came from. The
 *  caller's explicit argument wins; otherwise the held-out case's own `source_case_id` is read. `null`
 *  when neither names one, which is the value the `SOURCE_CASE_REQUIRED` gate refuses on (Plan item 4). */
const sourceCaseIdOf = (heldOutCase, explicit) =>
  isStr(explicit, 1) ? String(explicit) : (isStr(heldOutCase?.source_case_id, 1) ? String(heldOutCase.source_case_id) : null);

async function runGeneralization({ candidate, heldOutCase, registry = [], model, budget = {}, modelId = null, nowMs = Date.now(), experiences = [], pinDir = null, isAncestor = null, root = null, caseIdentityIndex = null, evidenceLevel = null, sourceCaseId = null } = {}) {
  const guard = disabledGuard(budget);
  if (guard) return guard;
  if (typeof model !== "function") return { ok: false, reason: "model-seam-missing", called: false };
  if (!isObj(candidate) || !isStr(candidate.method_id, 1)) return { ok: false, reason: "CANDIDATE_INVALID:needs-a-method_id", called: false };
  if (!isObj(heldOutCase) || !isStr(heldOutCase.role, 1)) return { ok: false, reason: "HELD_OUT_INVALID:needs-an-experience-with-a-role", called: false };

  // EVERY refusal below shares ONE shape: no model call, no promotion, the candidate untouched, and the
  // outcome spelled `not-evaluated` — a refused READING, never a failed METHOD (硬规则 3b).
  // `gates` carries the two readings the PROMOTION rule names (`lineage_ok` / `temporal_ok`), so a
  // refusal is not just a code: `false` = the gate ran and failed, `null` = it was never reached.
  // Collapsing those two into one value is exactly the shape 硬规则 3b forbids.
  // The index gate's reading, three-valued like the other two: `true` = an index was supplied and
  // the case is not in it, `false` = supplied and the case IS in it, `null` = no index was supplied,
  // so the gate was never reachable (硬规则 3b — never collapsed into one value).
  //
  // ── THE EVIDENCE LEVEL, and what it buys the caller (Plan items 2 and 4, 2026-10-12 strategy) ────
  // The level is DECLARED by the caller and carried on every refusal and every verdict; it is never
  // inferred. Two things follow from it, and they are the whole reason it exists:
  //   • `teaching` / `transfer` may reuse a case the index already knows (the strict cross-experiment
  //     exclusion runs only for `independent`-and-unlabelled experiments) — at the price of NAMING the
  //     source case, so a reused case can never be read back as a fresh one;
  //   • a pass at any level but `independent` caps the candidate at `status:"trial"`, which is
  //     report-only: it never licenses `active` and is never handed to a consumer by `activeMethods()`.
  // ⛔ `unlabelled` gets the STRICT treatment, not the permissive one: "the caller declared nothing" is
  //   not a licence to reuse, and the exclusion gate stays armed (硬规则 3b — an unreadable/absent
  //   label must not open a door the label exists to keep shut).
  const level = evidenceLevelOf({ evidence_level: evidenceLevel });
  const reuseAllowed = allowsCaseReuse(level);
  const prevGate = { evidence_level: level, previously_used_ok: caseIdentityIndex && !reuseAllowed ? true : null };
  const refuse = (code, reason, gates = {}) => ({
    ok: false, called: false, outcome: "not-evaluated", refusal_code: code, reason,
    not_evaluated_reason: code, predicted_verdict: null, expected_verdicts: roleExpectedVerdicts(heldOutCase.role),
    correct: null, promoted: false, candidate_after: { ...candidate }, retirement_reason: null,
    evaluated_commit: null, verifier_cwd: null, model_call: null,
    lineage_ok: gates.lineage_ok ?? null, temporal_ok: gates.temporal_ok ?? null,
    previously_used_ok: gates.previously_used_ok ?? prevGate.previously_used_ok,
    // The DECLARED level travels on a refusal too (Plan item 1): the recorded refusal is what a later
    // reader consults to see WHICH level was attempted, and a refusal that dropped the level would
    // leave "this was refused because it was a teaching case" unreadable from the carrier.
    evidence_level: level,
    source_case_id: sourceCaseIdOf(heldOutCase, sourceCaseId),
  });

  // The held-out case must be OUTSIDE the batch that produced the candidate: a case the candidate was
  // fitted to proves nothing about transfer.
  const prov = Array.isArray(candidate.provenance_evidence) ? candidate.provenance_evidence : [];
  if (isStr(heldOutCase.id, 1) && prov.includes(heldOutCase.id)) {
    return refuse("HELD_OUT_INSIDE_THE_BATCH", `HELD_OUT_INSIDE_THE_BATCH:${heldOutCase.id}-is-already-a-provenance-member-of-${candidate.method_id}`, { lineage_ok: false });
  }
  const expected = roleExpectedVerdicts(heldOutCase.role);
  if (!expected.length) return refuse("HELD_OUT_ROLE_UNKNOWN", `HELD_OUT_ROLE_UNKNOWN:${heldOutCase.role}`);

  // …and not USED BEFORE anywhere the GLOBAL case-identity index can see. This is the per-case half
  // of the sealed-set gate: the set gate refuses a whole registration, this refuses ONE case that
  // reached a verifier by another path. It is also the ONLY check that can see a use recorded in a
  // DIFFERENT carrier (an earlier sealed file, a method's seed set, a publicly-surfaced case).
  // ⛔ THE LEVEL GATE ON THE EXCLUSION (Plan item 4): the strict cross-experiment exclusion runs for
  //   `independent` and for `unlabelled` — NOT for a declared `teaching`/`transfer` case, which is
  //   allowed to reuse a known case on purpose. A `teaching`/`transfer` case must then NAME its source,
  //   which is the price of the exemption and the thing that keeps a reused case from reading back as
  //   a fresh one. Both arms are refusals: no model call, no promotion.
  if (reuseAllowed) {
    if (!isStr(sourceCaseIdOf(heldOutCase, sourceCaseId), 1)) {
      const id = heldOutCase.case_id ?? heldOutCase.id ?? "held-out";
      // `previously_used_ok` stays `null` on this refusal: the exclusion gate was deliberately NOT run
      // for this level, and "not run" is its own value (硬规则 3b).
      return refuse(SOURCE_CASE_REQUIRED,
        `${SOURCE_CASE_REQUIRED}:${id}-is-judged-at-evidence_level=${level}-which-may-reuse-a-known-case-so-it-must-name-that-case-in-source_case_id`);
    }
  }
  if (caseIdentityIndex && !reuseAllowed) {
    const hits = caseCollisions(caseIdentityIndex, heldOutCase);
    if (hits.length > 0) {
      const id = heldOutCase.case_id ?? heldOutCase.id ?? "held-out";
      return {
        ...refuse(HELD_OUT_PREVIOUSLY_USED,
          `HELD_OUT_PREVIOUSLY_USED:${id}-is-known-to-the-case-identity-index:${hits.map(collisionLabel).join("+")}`,
          { previously_used_ok: false }),
        previously_used_hits: hits, index_sha256: caseIdentityIndex.sha256 ?? null,
      };
    }
  }

  // The label↔pre-registration↔first-call ORDERING (Plan item 4), when the case declares itself a
  // LABELLED new case. A case carrying none of the labelling fields is a legacy/derived Experience
  // and is not asked for them — the REQUIREMENT for a whole new sealed set lives in
  // `validateSealedSetBinding`; this gate is what stops a self-declared labelled case from being one
  // whose label was written after the answer was known.
  if (supplied(heldOutCase, "labeled_at") || supplied(heldOutCase, "labeled_by") || supplied(heldOutCase, "prereg_mtime")) {
    const timing = validateCaseLabelTiming(heldOutCase, { nowMs });
    if (!timing.ok) return refuse(timing.reasons[0], `CASE_LABEL_TIMING:${timing.reasons.join("+")}`, prevGate);
  }

  // …and outside the candidate's whole LINEAGE — a different version of the same method having been
  // seeded from this very case makes the "hold-out" a re-run of the fitting, not a test of transfer.
  const lineage = checkLineageIsolation({ candidate, heldOutCase, registry, experiences });
  if (!lineage.ok) return { ...refuse("HELD_OUT_SHARES_LINEAGE", lineage.reason, { lineage_ok: false }), lineage: lineage.lineage, lineage_hits: lineage.hits };
  const lineageOk = { lineage_ok: true, ...prevGate };

  // …and its expected verdict must be TRUE at a NAMED commit, which must predate the fix.
  const pinFields = validateEvaluationPin(heldOutCase);
  if (!pinFields.ok) return refuse(pinFields.reasons[0], `${pinFields.reasons[0]}:${heldOutCase.case_id ?? heldOutCase.id ?? "held-out"}-must-name-${pinFields.reasons.join("+")}`, lineageOk);
  const pinRefusal = verifyStrippedPin(pinDir, { repoRoot: root });
  if (pinRefusal) return refuse(pinRefusal.split(":")[0], `PIN_REFUSED:${pinRefusal}`, lineageOk);
  const temporal = checkTemporalBinding({ heldOutCase, isAncestor: isAncestor ?? (root ? gitIsAncestor(root) : null) });
  if (!temporal.ok) return refuse(temporal.reason.split(":")[0], temporal.reason, { ...lineageOk, temporal_ok: false });
  // `temporal.checked === false` is the case that binds no fix_commit (a non-positive case): the gate
  // was NOT evaluated, which is `null`, never `true`.
  const gatesOk = { ...lineageOk, temporal_ok: temporal.checked === true ? true : null };

  const evaluatedCommit = String(heldOutCase.evaluation_pin);
  // The deterministic evidence pack (Plan item 2c), built from the SAME stripped pin the verifier runs
  // in. `null` when it cannot be assembled — the prompt then renders exactly as it did before the pack
  // existed, and `evidence_pack: null` on the verdict says so rather than claiming a pack was supplied.
  const pack = evidencePackForPin({ pinDir, components: heldOutCase.components, claim: candidateClaim(candidate) });
  const prompt = buildGeneralizationPrompt({ candidate, heldOutCase, evidencePack: pack });
  const tCall = Date.now();
  const { stdout } = await modelCall(model, prompt);
  const call = { ...modelCallFields({ requested: modelId, stdout }), wall_ms: Date.now() - tCall };
  const parsed = parseJsonObject(callText(stdout));
  const nextV = nextVersion(registry, candidate.method_id);
  const ran = { evaluated_commit: evaluatedCommit, verifier_cwd: pinDir, evidence_pack: pack ? { lines: pack.lines.length, capped: pack.capped, counts: pack.counts } : null };

  // ── STEP 1, the applicability gate ──────────────────────────────────────────────────────────────
  // ⛔ `"no"` is the ONE value that diverts: the method does not cover the case, so there is nothing to
  //   predict. It is recorded as `not-applicable` — a THIRD outcome value, distinct from `evaluated`
  //   (a graded prediction) and from `not-evaluated` (a failed reading). It counts neither as correct
  //   nor as wrong and it neither promotes nor retires (硬规则 3b: "did not apply" must never share a
  //   shape with "predicted wrong" — that collapse is what retired three sound methods on 2026-10-12).
  //   A missing or out-of-vocabulary `applies` is `undetermined`, which PROCEEDS: "I could not tell
  //   whether it applies" is not a licence to skip the test.
  const applies = APPLIES_VOCAB.includes(parsed?.applies) ? String(parsed.applies) : "undetermined";
  const appliesReason = isStr(parsed?.applies_reason, 1) ? String(parsed.applies_reason) : null;
  if (applies === "no") {
    return {
      ok: true, called: true, outcome: OUTCOME_NOT_APPLICABLE, model_call: call, applies,
      applies_reason: appliesReason, predicted_verdict: null, expected_verdicts: expected,
      correct: null, promoted: false, promoted_to: null, candidate_after: { ...candidate, version: nextV },
      retirement_reason: null, not_evaluated_reason: null, refusal_code: null,
      reasoning: parsed?.reasoning ?? null,
      evidence_level: level, source_case_id: sourceCaseIdOf(heldOutCase, sourceCaseId), ...gatesOk, ...ran,
    };
  }

  if (!parsed || !isStr(parsed.verdict, 1)) {
    // NOT-EVALUATED (its own value): the reading failed, the METHOD was not refuted. Stays draft.
    return {
      ok: true, called: true, outcome: "not-evaluated", model_call: call, applies, applies_reason: appliesReason,
      predicted_verdict: null, expected_verdicts: expected, correct: null, promoted: false, promoted_to: null,
      candidate_after: { ...candidate }, retirement_reason: null, refusal_code: null,
      not_evaluated_reason: parsed ? "VERDICT_MISSING_IN_MODEL_OUTPUT" : "UNPARSEABLE_MODEL_OUTPUT",
      evidence_level: level, source_case_id: sourceCaseIdOf(heldOutCase, sourceCaseId),
      ...gatesOk, ...ran,
    };
  }
  const predicted = String(parsed.verdict);
  const correct = expected.includes(predicted);
  // ⛔ THE LEVEL CAP (Plan item 2). A correct prediction promotes the candidate — but only an
  //   `independent` verdict may promote it to `active`. Every other level (teaching, transfer,
  //   production-open, unlabelled) caps it at `trial`, a state that is REPORT-ONLY: it is never handed
  //   to a consumer (`activeMethods()` returns only `status:"active"`) and it is never shown as
  //   generalization. The candidate still moves (the reading is real) — it just moves to a state that
  //   cannot be mistaken for a proof.
  const promotedStatus = promotionStatusForLevel(level);
  if (correct) {
    return {
      ok: true, called: true, outcome: "evaluated", model_call: call, applies, applies_reason: appliesReason,
      predicted_verdict: predicted, expected_verdicts: expected, correct: true, promoted: true,
      promoted_to: promotedStatus,
      candidate_after: { ...candidate, version: nextV, status: promotedStatus, retirement_reason: null },
      retirement_reason: null, not_evaluated_reason: null, refusal_code: null, reasoning: parsed.reasoning ?? null,
      evidence_level: level, source_case_id: sourceCaseIdOf(heldOutCase, sourceCaseId),
      ...gatesOk, ...ran,
    };
  }
  const retirement_reason = `failed-generalization-on-${heldOutCase.case_id ?? heldOutCase.id ?? "held-out"}: predicted-${predicted}-but-role-${heldOutCase.role}-requires-${expected.join("|")}`;
  return {
    ok: true, called: true, outcome: "evaluated", model_call: call, applies, applies_reason: appliesReason,
    predicted_verdict: predicted, expected_verdicts: expected, correct: false, promoted: false,
    promoted_to: null,
    candidate_after: { ...candidate, version: nextV, status: "retired", retirement_reason },
    retirement_reason, not_evaluated_reason: null, refusal_code: null, reasoning: parsed.reasoning ?? null,
    evidence_level: level, source_case_id: sourceCaseIdOf(heldOutCase, sourceCaseId),
    ...gatesOk, ...ran,
  };
}

/** The claim text the evidence pack cites symbols from: the method's steps plus its invariant. */
function candidateClaim(candidate) {
  return [candidate?.operation?.steps ?? [], candidate?.expected_invariant ?? "", candidate?.applicability?.domain_signals ?? []].flat().join("\n");
}

/**
 * Assemble the DETERMINISTIC evidence pack for the held-out file set from the stripped pin, reusing the
 * hypothesis-generation stage's own pack builder (硬规则 5b — a second implementation of the same pack
 * is a second implementation to keep in sync).
 *
 * Returns `null` when the pack cannot be assembled (no pin dir, no component readable there, a builder
 * refusal). `null` is its OWN value: the caller records `evidence_pack: null`, which says "the verifier
 * read the files itself" rather than "a pack was supplied and was empty".
 *
 * @param {object} o
 * @param {string} o.pinDir      the STRIPPED tree at the pin the verifier runs in
 * @param {string[]} [o.components] the held-out case's repo-relative components
 * @param {string} [o.claim]     the text whose cited symbols the pack resolves
 */
export function evidencePackForPin({ pinDir, components = [], claim = "" } = {}) {
  if (!isStr(pinDir, 1) || !Array.isArray(components) || components.length === 0) return null;
  const sources = {};
  let read = 0;
  for (const c of components) {
    if (!isStr(c, 1)) continue;
    const rel = String(c).replace(/^\.\//, "");
    for (const candidatePath of [rel, path.posix.basename(rel)]) {
      const p = path.join(pinDir, candidatePath);
      try {
        if (!fs.statSync(p).isFile()) continue;
        sources[rel] = fs.readFileSync(p, "utf8");
        read++;
        break;
      } catch { /* not there under this spelling — try the other, then give up on this component */ }
    }
  }
  // A pack with no source at all would render as a header over an empty body — a "pack" that carries
  // nothing, which is exactly what 硬规则 3b forbids. Say `null` instead.
  if (read === 0) return null;
  const pack = buildEvidencePack({ components: components.map((c) => String(c)), claim, sources });
  return pack.lines.length > 0 ? pack : null;
}

// ── the reflection-attempt carrier (so the next round does not re-spend a call) ────────────────────

/** Absolute path of the attempt log under the SHARED checkout (null when unresolvable). */
export const attemptsFile = (root) => carrierFile(root, REFLECTION_ATTEMPTS_REL);

/** Read the reflection-attempt log. Unparseable lines are DROPPED and COUNTED (never silent). */
export const readReflectionAttempts = (root) => readCarrier(root, REFLECTION_ATTEMPTS_REL, REFLECTION_ATTEMPT_KIND);

/** Append ONE reflection-attempt record: WHICH signature was reflected on, and what came of it. This
 *  is the record `selectExperiencesForReflection` dedups against — without it a `no-method` verdict
 *  would be re-asked forever. */
export function recordReflectionAttempt(root, rec) {
  if (!isObj(rec) || !isStr(rec.signature, 1)) return { ok: false, reasons: ["ATTEMPT_SIGNATURE_REQUIRED"], appended: false };
  const withId = { id: rec.id ?? recordId(REFLECTION_ATTEMPT_KIND, rec), ...rec };
  return appendCarrierLine(root, REFLECTION_ATTEMPTS_REL, withId, { kind: REFLECTION_ATTEMPT_KIND });
}

// ── the generalization-VERDICT carrier (the evidence a draft→active promotion must cite) ──────────
//
// ⛔ WHY A CARRIER AT ALL (task gap-discovery-carriers-ephemeral-in-worktree): the registry now REFUSES
//   a `status:"active"` record that does not cite a recorded `validateGeneralization` verdict
//   (`PROMOTION_WITHOUT_VALID_GENERALIZATION`). A rule that says "cite a recorded verdict" is only a
//   real constraint if the verdicts are somewhere a THIRD PARTY can re-read them — otherwise the
//   promotion would carry an unfalsifiable claim about a call nobody can inspect. This carrier is that
//   place, and like every other Discovery carrier it resolves to the SHARED checkout.

export const VERDICT_KIND = GENERALIZATION_VERDICT_KIND;

/** Absolute path of the verdict carrier under the SHARED checkout (null when unresolvable). */
export const verdictsFile = (root) => carrierFile(root, GENERALIZATION_VERDICTS_REL);

/** Read the recorded verdicts. Unparseable lines are DROPPED and COUNTED (never silent). */
export const readGeneralizationVerdicts = (root) => readCarrier(root, GENERALIZATION_VERDICTS_REL, VERDICT_KIND);

/**
 * Record ONE `validateGeneralization` outcome as a verdict line, so a later promotion can CITE it and
 * a third party can re-read what the verifier actually returned.
 *
 * The normalized record keeps the fields a promotion is judged on, copied from the verdict itself —
 * never re-derived here: `method_id` / `version` (whose promotion this could license), `outcome`,
 * `correct`, `refusal_code`, and the two gate readings `lineage_ok` / `temporal_ok` (`null` = the gate
 * was never reached, which is a DIFFERENT value from `false`).
 *
 * A refusal verdict is recordable on purpose: it is what lets a refusal NAME why the cited evidence is
 * unusable (`HELD_OUT_SHARES_LINEAGE`, `TEMPORAL_MISMATCH`, …) instead of a bare "no valid evidence".
 *
 * @param {string} root
 * @param {object} verdict  the value `validateGeneralization` returned, plus (`method_id`, `version`)
 * @param {object} [opts] `{ts = Date.now()}`
 * @returns the `appendCarrierLine` result.
 */
export function recordGeneralizationVerdict(root, verdict, { ts = Date.now() } = {}) {
  if (!isObj(verdict)) return { ok: false, kind: VERDICT_KIND, reasons: ["VERDICT_NOT_OBJECT"], appended: false };
  if (!isStr(verdict.method_id, 1)) return { ok: false, kind: VERDICT_KIND, reasons: ["VERDICT_METHOD_ID_REQUIRED"], appended: false };
  if (!isStr(verdict.held_out_case_id, 1)) return { ok: false, kind: VERDICT_KIND, reasons: ["VERDICT_HELD_OUT_CASE_ID_REQUIRED"], appended: false };
  const rec = {
    ts: new Date(ts).toISOString(),
    method_id: verdict.method_id,
    version: Number.isInteger(verdict.version) ? verdict.version : null,
    held_out_case_id: verdict.held_out_case_id,
    called: verdict.called === true,
    outcome: isStr(verdict.outcome, 1) ? verdict.outcome : null,
    // The APPLICABILITY gate's answer, recorded on the carrier so the diversion rate is a reading a
    // third party can recount — `null` when the verdict predates the gate or never reached the model.
    applies: appliedOf(verdict),
    applies_reason: isStr(verdict.applies_reason, 1) ? verdict.applies_reason : null,
    refusal_code: isStr(verdict.refusal_code, 1) ? verdict.refusal_code : null,
    predicted_verdict: isStr(verdict.predicted_verdict, 1) ? verdict.predicted_verdict : null,
    expected_verdicts: Array.isArray(verdict.expected_verdicts) ? verdict.expected_verdicts : [],
    correct: verdict.correct === true ? true : (verdict.correct === false ? false : null),
    // The two gates the promotion rule names. `null` = not reached (a refusal earlier in the chain);
    // `false` = reached and failed. Never collapsed into one value (硬规则 3b).
    lineage_ok: verdict.lineage_ok === false ? false : (verdict.lineage_ok === true ? true : null),
    temporal_ok: verdict.temporal_ok === false ? false : (verdict.temporal_ok === true ? true : null),
    // The THIRD gate reading, on the same three-valued discipline: `true` = checked against a
    // case-identity index and not previously used, `false` = checked and previously used, `null` =
    // no index was supplied / never reached. A `false` here can never license a promotion.
    previously_used_ok: verdict.previously_used_ok === false ? false : (verdict.previously_used_ok === true ? true : null),
    // ── THE EVIDENCE LEVEL (Plan item 1) ────────────────────────────────────────────────────────────
    // ⛔ Normalised through `evidenceLevelOf`, so EVERY line written from here on carries an explicit
    //   level — a caller that declares none gets `unlabelled`, never an absent key and never
    //   `independent`. The promotion guard reads THIS field off the recorded line: a verdict recorded
    //   before the level existed reads back as `unlabelled` and can therefore never license `active`,
    //   which is the whole point (硬规则 6: a missing label is an absent claim, not a weak positive).
    evidence_level: evidenceLevelOf(verdict),
    // WHICH case a `teaching`/`transfer` verdict reused (Plan item 4). `null` for every other level —
    // an `independent` case shares nothing with the fitting material, so naming a source there would
    // be a claim the level itself contradicts.
    source_case_id: isStr(verdict.source_case_id, 1) ? String(verdict.source_case_id) : null,
    evaluation_pin: isStr(verdict.evaluation_pin, 1) ? verdict.evaluation_pin : null,
    evaluated_commit: isStr(verdict.evaluated_commit, 1) ? verdict.evaluated_commit : null,
    // The label digest and the index digest this verdict was produced against. `null` is its OWN
    // value: a verdict recorded before either existed, or by a caller that named neither, says so
    // rather than carrying a digest of nothing (硬规则 3b).
    label_sha256: isStr(verdict.label_sha256, 1) ? verdict.label_sha256 : null,
    index_sha256: isStr(verdict.index_sha256, 1) ? verdict.index_sha256 : null,
    promoted: verdict.promoted === true,
    retirement_reason: isStr(verdict.retirement_reason, 1) ? verdict.retirement_reason : null,
    not_evaluated_reason: isStr(verdict.not_evaluated_reason, 1) ? verdict.not_evaluated_reason : null,
  };
  // ⛔ The id is content-addressed over the verdict EXCEPT its recording time. A verdict's identity is
  //   what the verifier concluded; `ts` is when it was copied here. Including `ts` would make a caller
  //   that re-records the SAME verdict (e.g. re-checking a promotion) mint a fresh line every time,
  //   which is exactly the append this carrier's DUPLICATE_ID arm exists to make a no-op.
  const { ts: _ts, ...identity } = rec;
  const withId = { id: verdict.id ?? recordId(VERDICT_KIND, identity), ...rec };
  return appendCarrierLine(root, GENERALIZATION_VERDICTS_REL, withId, { kind: VERDICT_KIND });
}

// ── the GLOBAL CASE-IDENTITY INDEX (built BEFORE any pre-registration) ────────────────────────────
//
// ⛔ THE DEFECT THIS CLOSES (gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion,
//   2026-10-12). Two methods were promoted on the SAME sealed holdout set
//   (`labels-dt2-sealed.json`), and EIGHT of that set's nine cases had been used before: two were
//   teaching/seed cases (one of them the seed `shared-contract-divergence` v1 was built from), four
//   were earlier `E-HYPGEN-AB-1` holdouts, one was derived from a publicly-surfaced diagnostic, and
//   one was a Probe/Meta case mislabelled negative. The exclusion set the round actually consulted
//   held only ONE earlier file's cases plus the candidate's own seed provenance, and its lineage
//   matcher compared Experience **ids**. So a case that was the same DEFECT under a different id, in
//   a different file, or publicly discussed, was invisible.
//
// The fix is an INDEX OF CASE IDENTITY built from every carrier that can name a case, BEFORE any
// pre-registration, so "was this case used before?" is answered from data rather than from whichever
// file the round happened to remember:
//   • every sealed label file (the caller passes the paths — the glob is never hard-coded per case);
//   • every Experience used as a SEED by any method, at any version, across every method and its
//     `method:<id>@<v>` lineage (the seed set is the registry's OWN derivation, reused);
//   • every Experience in the ledger, including teaching and user cases;
//   • every case a sealed file marks `diagnostic-public` (the publicly-surfaced cases are an
//     INDEPENDENT leak channel — being discussed in the open is not a component identity);
//   • every held-out case named in the generalization-verdict carrier.
//
// Each entry records: the case id, its component set (BASENAMES — the same defect filed from another
// directory is the same case), its fix commit(s), the carrier it was read from and the line within
// it, its first-use experiment, and whether it is a diagnostic-public case.
//
// ⛔ AN IDENTITY, NOT A PRESENCE CHECK (硬规则 3b). A case that could not be read is its OWN value
// (`ok:false` + reason), never an empty index that reads exactly like "nothing has ever been used".
// Dually, a collision is ENUMERATED (`{kind, source, ref, shared}` per hit) so a refusal names WHICH
// carrier condemned the case and by which arm — never a bare boolean.
//
// ⛔ WHAT IS *NOT* A COLLISION CHANNEL. A verdict line that merely RECORDS a use of a case IN THE SET
//   UNDER TEST was written by that set's own run: at pre-registration time it cannot exist, so it is
//   not pre-existing knowledge. `caseCollisions` therefore skips the verdict entries naming the
//   candidate set's own ids (`ownUseCaseIds`) — otherwise a set would be condemned by its own
//   history, and the component/fix arms (the ones that catch the real leak) would never be the
//   reason.

/** Where the index lives, relative to the SHARED checkout. ⛔ NOT declared in the ledger's
 *  `DISCOVERY_CARRIERS`: that table is the append-only LINE carriers (`repairCarrier`'s "truncate a
 *  torn FINAL line" model addresses `.jsonl` appends), and this is a single JSON object rewritten
 *  atomically under a lock — the same reason `INGEST_WATERMARK_REL` is declared outside that table.
 *  The path still has exactly ONE definition. */
export const CASE_IDENTITY_INDEX_REL = ".quay/discovery-case-identity-index.json";

/** The one record kind the index object carries, so the file is self-describing on read-back. */
export const CASE_IDENTITY_INDEX_KIND = "case-identity-index";

/** Refusal code: the sealed set contains at least one case the index has already seen. */
export const SEALED_SET_CONTAMINATED = "SEALED_SET_CONTAMINATED";

/** Refusal code: a single held-out case is already in the index (defence in depth, per case). */
export const HELD_OUT_PREVIOUSLY_USED = "HELD_OUT_PREVIOUSLY_USED";

/** A case is a DIFFERENT case once fewer than this many of its components are shared. The same
 *  threshold the lineage check states (`LINEAGE_MIN_SHARED_COMPONENTS`) — the two must not disagree
 *  about when two case descriptions are the same defect.
 *  ⛔ IMPORTED (and re-exported) from the ledger module, where it moved with the evidence-level work:
 *  the method registry's quarantine arm reads the same rule and cannot import THIS module (this module
 *  imports the registry), so the ONE definition has to live below both of them. */
export { MIN_SHARED_CASE_COMPONENTS };

/** ⛔ Re-exported from the hypothesis-generation module for the ROUTINE's reservation ledger: a model
 *  call's realized `num_turns` exists ONLY inside the launcher's `stream-json` output, and this is the
 *  parser that knows where. The 24h ceiling counts SUBPROCESS INVOCATIONS; this is what lets each one
 *  also record what it actually spent underneath (or say `null` with a reason when the stream is not
 *  instrumented — never a silent 0, which would read as «this call was free»). */
export { parseVerifierStream };

/** The collision arms, as DATA, so a refusal can say which one fired and a test can enumerate them. */
export const COLLISION_KINDS = Object.freeze([
  "reused_case_id",              // the same case id, recorded by some other carrier
  "shared_fix_commit",           // the same fix commit — the same patch, whatever the id
  "shared_components",           // >= MIN_SHARED_CASE_COMPONENTS shared component basenames
  "shared_diagnostic_component", // ONE shared component with a publicly-surfaced (diagnostic) case
]);

/** Where an index entry came from — the "which channel" half of every collision record. */
export const CASE_SOURCE_KINDS = Object.freeze(["sealed", "ledger", "registry-seed", "verdict"]);

/** The keys a sealed case may spell its component list under. A file that names no component under
 *  any of them contributes NO components (a case about an unnamed thing is legal) — it is never
 *  silently filled with something. */
export const CASE_COMPONENT_KEYS = Object.freeze(["files", "a", "b", "components"]);

const isDiagnosticRole = (role) => isStr(role, 1) && String(role).startsWith("diagnostic-public");

/**
 * The COMPONENT set of one case, NORMALISED to basenames. PURE.
 *
 * ⛔ Basenames, not paths, and that is the whole point of arm (ii) of the counterexample set: the same
 * two files re-filed under a different directory are the same case, so a path-keyed index would pass
 * a copy that only moved house.
 * @returns {string[]} sorted, de-duplicated basenames
 */
export function caseComponentsOf(sealedCase) {
  const out = new Set();
  for (const k of CASE_COMPONENT_KEYS) {
    const v = sealedCase?.[k];
    if (!Array.isArray(v)) continue;
    for (const x of v) if (isStr(x, 1)) out.add(basenameOf(x));
  }
  return [...out].sort();
}

/** The raw paths a case names (kept alongside the basenames for the record, never matched on). */
export function caseComponentPathsOf(sealedCase) {
  const out = [];
  for (const k of CASE_COMPONENT_KEYS) {
    const v = sealedCase?.[k];
    if (!Array.isArray(v)) continue;
    for (const x of v) if (isStr(x, 1) && !out.includes(x)) out.push(x);
  }
  return out;
}

/**
 * The fix commit(s) a case records. PURE. ⛔ Only the MACHINE-READABLE form counts: `provenance` as an
 * object carrying `fix_commit` / `fix_commits`. A case whose provenance is free TEXT names its fix in
 * prose, and a regex over prose would be a guess wearing a reading's clothes (硬规则 4b) — so it
 * contributes no commit and its record says so by omission rather than by a fabricated value.
 */
export function fixCommitsOf(sealedCase) {
  const p = sealedCase?.provenance;
  const out = [];
  if (isObj(p)) {
    if (isStr(p.fix_commit, 1)) out.push(String(p.fix_commit));
    if (Array.isArray(p.fix_commits)) for (const c of p.fix_commits) if (isStr(c, 1)) out.push(String(c));
  }
  if (isStr(sealedCase?.fix_commit, 1)) out.push(String(sealedCase.fix_commit));
  return [...new Set(out)];
}

/** The 1-based line a record's `id` occupies in a `.jsonl` carrier — `null` when it is not found or
 *  the file cannot be read. A line number that cannot be read is `null`, never a fabricated `0`. */
export function lineOfRecord(file, id) {
  if (!isStr(file, 1) || !isStr(id, 1)) return null;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { if (JSON.parse(lines[i])?.id === id) return i + 1; } catch { /* unparseable lines are counted elsewhere */ }
  }
  return null;
}

/** The experiment label of a sealed file: its parent directory (the run that owns it) — derived from
 *  the path, never a literal, so no run's name is hand-coded into the production logic. */
export const firstUseOfSealedPath = (p) => path.basename(path.dirname(String(p)));

/**
 * Read ONE sealed label file. Fail-closed: an unreadable / unparseable / wrongly-shaped file is its
 * OWN value, never an empty case list (硬规则 3b).
 * @returns {{ok:true, cases:object[], pin:string|null, note:string|null, file:string, mtime_ms:number|null}
 *          |{ok:false, reason:string, cases:[], file:string}}
 */
export function readSealedSet(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return { ok: false, reason: `SEALED_SET_UNREADABLE:${file}:${e?.code ?? e?.message}`, cases: [], file }; }
  let doc;
  try { doc = JSON.parse(text); }
  catch { return { ok: false, reason: `SEALED_SET_UNPARSEABLE:${file}`, cases: [], file }; }
  if (!isObj(doc) || !Array.isArray(doc.cases)) {
    return { ok: false, reason: `SEALED_SET_SHAPE:${file}-needs-{cases:[...]}`, cases: [], file };
  }
  let mtime_ms = null;
  try { mtime_ms = fs.statSync(file).mtimeMs; } catch { mtime_ms = null; }
  return { ok: true, cases: doc.cases.filter(isObj), pin: isStr(doc.pin, 1) ? doc.pin : null,
    note: isStr(doc._note, 1) ? doc._note : null, file, mtime_ms };
}

/** One index ENTRY per case per source. The shape is fixed (same key order everywhere) so the index's
 *  sha256 is content-addressed over the KNOWLEDGE rather than over object key order. PURE. */
const identityEntry = ({ case_id, components = [], component_paths = [], fix_commits = [], source, source_kind, source_line = null, first_use = null, diagnostic_public = false }) => ({
  case_id: isStr(case_id, 1) ? String(case_id) : null,
  components: [...new Set(components)].sort(),
  component_paths: [...new Set(component_paths)].sort(),
  fix_commits: [...new Set(fix_commits)].sort(),
  source,
  source_kind,
  source_line,
  first_use,
  diagnostic_public: diagnostic_public === true,
});

/** The index entry for ONE sealed case. PURE. */
export function sealedCaseEntry(sealedCase, { source, source_kind = "sealed", source_line = null, first_use = null, source_file = null } = {}) {
  const file = source_file ?? source;
  return identityEntry({
    case_id: sealedCase?.id ?? sealedCase?.case_id ?? null,
    components: caseComponentsOf(sealedCase),
    component_paths: caseComponentPathsOf(sealedCase),
    fix_commits: fixCommitsOf(sealedCase),
    source, source_kind, source_line, first_use,
    diagnostic_public: isDiagnosticRole(sealedCase?.role),
  });
}

/** The index entry for ONE Experience (the ledger's own shape). PURE. */
export function experienceCaseEntry(experience, { source, source_kind = "ledger", source_line = null, first_use = null } = {}) {
  return identityEntry({
    case_id: experience?.case_id ?? experience?.id ?? null,
    components: (Array.isArray(experience?.components) ? experience.components : []).filter((c) => isStr(c, 1)).map(basenameOf),
    component_paths: (Array.isArray(experience?.components) ? experience.components : []).filter((c) => isStr(c, 1)),
    fix_commits: [],
    source, source_kind, source_line, first_use,
    diagnostic_public: false,
  });
}

/**
 * Build the GLOBAL CASE-IDENTITY INDEX. Reads the five sources named in the header and returns
 * `{ok, index, entries, sha256}`; ANY unreadable source is a refusal with its own reason, never a
 * shorter index (硬规则 3b — an index missing a source answers "was this used?" with "no").
 *
 * Every source can be INJECTED (`sealedSets`, `ledger`, `registry`, `verdicts`) so the builder is
 * testable without a filesystem, while the default reads the real carriers.
 *
 * @param {string} root  the caller's root; the carriers resolve to the SHARED checkout
 * @param {object} [o]
 * @param {string[]} [o.sealedSetPaths]  sealed label files to read from disk (the glob is the
 *   CALLER's — the builder never guesses a directory)
 * @param {{source:string, cases:object[], first_use?:string, file?:string}[]} [o.sealedSets]
 *   already-read sealed sets (injected; the shapes `readSealedSet` returns)
 * @param {object} [o.ledger]     a `readExperienceLedger(root)` value
 * @param {object} [o.registry]   a `readMethodRegistry(root, {history:true})` value
 * @param {object} [o.verdicts]   a `readGeneralizationVerdicts(root)` value
 * @param {number} [o.nowMs]
 */
export function buildCaseIdentityIndex(root, { sealedSetPaths = [], sealedSets = [], ledger = undefined, registry = undefined, verdicts = undefined, nowMs = Date.now() } = {}) {
  const entries = [];
  const sources = [];

  for (const p of sealedSetPaths) {
    const read = readSealedSet(p);
    if (!read.ok) return { ok: false, reason: read.reason, entries: [], index: null, sha256: null };
    sources.push(read.file);
    const rel = path.isAbsolute(String(p)) ? String(p) : String(p);
    read.cases.forEach((c, i) => entries.push(sealedCaseEntry(c, {
      source: `sealed:${rel}`, source_line: i + 1, first_use: firstUseOfSealedPath(read.file), source_file: read.file,
    })));
  }

  for (const s of sealedSets) {
    if (!isStr(s?.source, 1)) return { ok: false, reason: "SEALED_SET_SOURCE_REQUIRED", entries: [], index: null, sha256: null };
    sources.push(s.source);
    const cases = Array.isArray(s.cases) ? s.cases.filter(isObj) : [];
    cases.forEach((c, i) => entries.push(sealedCaseEntry(c, {
      source: s.source, source_line: i + 1, first_use: isStr(s.first_use, 1) ? s.first_use : s.source, source_file: s.file ?? null,
    })));
  }

  const led = ledger === undefined ? readExperienceLedger(root) : ledger;
  if (!led.ok) {
    return { ok: false, reason: `CASE_INDEX_LEDGER_UNREADABLE:${led.malformed_lines}-unparseable-line(s)-in-${EXPERIENCE_LEDGER_REL}`, entries: [], index: null, sha256: null };
  }
  sources.push(`ledger:${EXPERIENCE_LEDGER_REL}`);
  const ledgerPath = carrierFile(root, EXPERIENCE_LEDGER_REL);
  for (const e of led.records) {
    entries.push(experienceCaseEntry(e, {
      source: `ledger:${EXPERIENCE_LEDGER_REL}`, source_line: lineOfRecord(ledgerPath, e.id), first_use: "ledger",
    }));
  }

  const reg = registry === undefined ? readMethodRegistry(root, { history: true }) : registry;
  if (!reg.ok) {
    return { ok: false, reason: `CASE_INDEX_REGISTRY_UNREADABLE:${reg.malformed_lines}-unparseable-line(s)-in-${DISCOVERY_CARRIERS["discovery-method-registry"].rel}`, entries: [], index: null, sha256: null };
  }
  // ⛔ A registry read WITHOUT `history` returns `history: null` — reading that as "no seeds" would
  //   drop the whole seed source while the index still reported `ok` (硬规则 3b: a caller that asked
  //   the wrong question must be told, not quietly served a shorter answer).
  if (!Array.isArray(reg.history)) {
    return { ok: false, reason: "CASE_INDEX_REGISTRY_HISTORY_REQUIRED:read-the-registry-with-{history:true}-so-every-version's-seeds-are-in-the-index", entries: [], index: null, sha256: null };
  }
  const history = reg.history;
  const seedSources = new Set();
  for (const rec of history) {
    if (!isObj(rec)) continue;
    // The SEED set is the registry module's OWN derivation (`provenanceExperiences` resolves a
    // provenance entry on the record's `id` OR its `case_id`), reused rather than re-derived.
    for (const e of provenanceExperiences(rec, led.records)) {
      const src = `registry-seed:${rec.method_id}@${rec.version}`;
      seedSources.add(src);
      entries.push(experienceCaseEntry(e, { source: src, source_kind: "registry-seed", first_use: `${rec.method_id}@${rec.version}` }));
    }
  }
  for (const s of seedSources) sources.push(s);

  const ver = verdicts === undefined ? readGeneralizationVerdicts(root) : verdicts;
  // A partially-readable verdict carrier (`ok:false` with `reason` OR with unparseable lines) refuses
  // the build: the held-out cases it names are one of the five sources, and an index missing them
  // would answer "was this used?" with "no" (硬规则 3b).
  if (!ver.ok) {
    return { ok: false, reason: `CASE_INDEX_VERDICTS_UNREADABLE:${ver.reason ?? `${ver.malformed_lines}-unparseable-line(s)-in-${GENERALIZATION_VERDICTS_REL}`}`, entries: [], index: null, sha256: null };
  }
  sources.push(`verdict:${GENERALIZATION_VERDICTS_REL}`);
  const verdictPath = verdictsFile(root);
  for (const v of ver.records ?? []) {
    if (!isObj(v) || !isStr(v.held_out_case_id, 1)) continue;
    entries.push(identityEntry({
      case_id: v.held_out_case_id, components: [], component_paths: [], fix_commits: [],
      source: `verdict:${GENERALIZATION_VERDICTS_REL}`, source_kind: "verdict",
      source_line: lineOfRecord(verdictPath, v.id), first_use: "verdict", diagnostic_public: false,
    }));
  }

  // Deterministic order ⇒ a stable sha256 over the KNOWLEDGE (the same discipline the verdict id
  // uses: what is hashed is the content, never the moment it was read).
  const sorted = entries.slice().sort((a, b) =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
    (String(a.case_id) < String(b.case_id) ? -1 : String(a.case_id) > String(b.case_id) ? 1 : 0));
  const index = {
    kind: CASE_IDENTITY_INDEX_KIND,
    sources: [...new Set(sources)].sort(),
    counts: {
      entries: sorted.length,
      cases: new Set(sorted.map((e) => e.case_id).filter((c) => isStr(c, 1))).size,
      diagnostic_public: sorted.filter((e) => e.diagnostic_public).length,
      components: new Set(sorted.flatMap((e) => e.components)).size,
    },
    entries: sorted,
  };
  index.sha256 = caseIndexSha256(index);
  return { ok: true, index, entries: sorted, sha256: index.sha256 };
}

/** The index's content address: its sources + entries, NEVER `built_at` or the sha itself — so two
 *  builds over the same knowledge agree, and a changed entry moves it. */
export const caseIndexSha256 = (index) => sha256(JSON.stringify({ sources: index?.sources ?? [], entries: index?.entries ?? [] }));

/** Absolute path of the index under the SHARED checkout (null when unresolvable). */
export const caseIdentityIndexFile = (root) => carrierFile(root, CASE_IDENTITY_INDEX_REL);

/** Read the persisted index back. An absent file is its OWN value (硬规则 3b): "no index has been
 *  built" must not read as "an index that knows nothing". */
export function readCaseIdentityIndex(root) {
  const file = caseIdentityIndexFile(root);
  if (file === null) { const rr = resolveCarrierRoot(root); return { ok: false, reason: rr.reason, index: null, file: null }; }
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return { ok: false, reason: `CASE_INDEX_MISSING:${CASE_IDENTITY_INDEX_REL}:${e?.code ?? e?.message}`, index: null, file }; }
  let doc;
  try { doc = JSON.parse(text); }
  catch { return { ok: false, reason: `CASE_INDEX_UNPARSEABLE:${CASE_IDENTITY_INDEX_REL}`, index: null, file }; }
  if (!isObj(doc) || !Array.isArray(doc.entries)) return { ok: false, reason: `CASE_INDEX_SHAPE:${CASE_IDENTITY_INDEX_REL}`, index: null, file };
  const expected = caseIndexSha256(doc);
  // A recorded sha that disagrees with the content is REPORTED, not silently trusted: the index is
  // what a refusal cites, so "the file was edited after it was written" must be visible.
  return { ok: true, index: doc, file, sha256: doc.sha256 ?? null, sha256_matches: doc.sha256 === expected };
}

/**
 * Persist the index under the SHARED checkout, atomically (tmp + rename).
 *
 * ⛔ No lock, deliberately, and the reason is structural rather than convenient: the index is a
 *   DERIVED SNAPSHOT of the carriers, not an append-only log. `rename` is atomic, so two concurrent
 *   builders each land a WHOLE file (last writer wins) and a reader can never see a half-written
 *   index. A lost update therefore costs one redundant rebuild, which the next pre-registration
 *   performs anyway — whereas a lock that is not the carrier table's own would be a second locking
 *   discipline to keep in sync (硬规则 5b). The append-only line carriers keep their lock.
 */
export function writeCaseIdentityIndex(root, index, { now = Date.now() } = {}) {
  const file = caseIdentityIndexFile(root);
  if (file === null) { const rr = resolveCarrierRoot(root); return { ok: false, reason: rr.reason, file: null }; }
  if (!isObj(index) || !Array.isArray(index.entries)) return { ok: false, reason: "CASE_INDEX_SHAPE:needs-{entries:[...]}", file };
  const doc = { ...index, sha256: caseIndexSha256(index), written_at: new Date(now).toISOString() };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 1) + "\n", "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    return { ok: false, reason: `CASE_INDEX_WRITE_FAILED:${e?.code ?? e?.message}`, file };
  }
  return { ok: true, file, sha256: doc.sha256, index: doc };
}

/**
 * The collisions between ONE candidate case and the index. PURE. Returns EVERY hit (硬规则 3 — a
 * refusal enumerates what matched), each `{kind, source, source_kind, ref, shared?, first_use?}`.
 *
 * @param {object} index
 * @param {object} candidate  a sealed case (`files`/`a`/`b` + id + provenance) or an Experience
 * @param {object} [opts]
 * @param {string[]} [opts.ownUseCaseIds]  case ids belonging to the set UNDER TEST. A VERDICT entry
 *   that merely records a use of one of them was written by the candidate set's own run and is not
 *   pre-existing knowledge (see the header) — those entries are skipped. Ledger / sealed /
 *   registry-seed entries are NEVER skipped: those record the case being used as material, which is
 *   exactly the leak the index exists to catch.
 */
export function caseCollisions(index, candidate, { ownUseCaseIds = [] } = {}) {
  const own = new Set((Array.isArray(ownUseCaseIds) ? ownUseCaseIds : []).filter((x) => isStr(x, 1)));
  const caseId = candidate?.id ?? candidate?.case_id ?? null;
  const components = caseComponentsOf(candidate);
  const fixCommits = fixCommitsOf(candidate);
  const hits = [];
  for (const e of (Array.isArray(index?.entries) ? index.entries : [])) {
    if (!isObj(e)) continue;
    if (e.source_kind === "verdict" && isStr(e.case_id, 1) && own.has(e.case_id)) continue;
    const shared = components.filter((c) => e.components.includes(c));
    if (isStr(caseId, 1) && e.case_id === caseId) {
      hits.push({ kind: "reused_case_id", source: e.source, source_kind: e.source_kind, ref: e.case_id, first_use: e.first_use });
    }
    const sharedCommits = fixCommits.filter((f) => e.fix_commits.includes(f));
    if (sharedCommits.length > 0) {
      hits.push({ kind: "shared_fix_commit", source: e.source, source_kind: e.source_kind, ref: e.case_id, shared: sharedCommits, first_use: e.first_use });
    }
    if (shared.length >= MIN_SHARED_CASE_COMPONENTS) {
      hits.push({ kind: "shared_components", source: e.source, source_kind: e.source_kind, ref: e.case_id, shared, first_use: e.first_use });
    } else if (e.diagnostic_public && shared.length >= 1) {
      // ⛔ The threshold is ONE here, deliberately and only for the publicly-surfaced cases. The
      //   >= 2 arm assumes the collision channel is COMPONENT identity; a case that was discussed in
      //   the open reached the labeller through a channel no component set can represent, so ANY
      //   shared component means the new case may have been read off it.
      hits.push({ kind: "shared_diagnostic_component", source: e.source, source_kind: e.source_kind, ref: e.case_id, shared, first_use: e.first_use });
    }
  }
  return hits;
}

/** One collision, rendered for a refusal message: `kind:ref@source`. */
export const collisionLabel = (h) => `${h.kind}:${h.ref ?? "?"}@${h.source}${h.shared?.length ? `(${h.shared.join(",")})` : ""}`;

/**
 * The PRE-REGISTRATION gate. PURE over its inputs, ZERO model calls — a sealed set is refused before
 * any call is made, so a contaminated set can never buy a single verifier turn.
 *
 * @returns {{ok:boolean, refusal_code:string|null, reason:string|null, evaluated:number,
 *            colliding_cases:number, collisions:object[], model_calls:0, index_sha256:string|null}}
 */
export function checkSealedSetContamination(index, { sealedSet = null, cases = null, source = null } = {}) {
  const list = Array.isArray(cases) ? cases.filter(isObj) : (Array.isArray(sealedSet?.cases) ? sealedSet.cases.filter(isObj) : null);
  if (list === null) {
    return { ok: false, refusal_code: "SEALED_SET_INPUT_MISSING", reason: "SEALED_SET_INPUT_MISSING:needs-cases-or-a-sealed-set", evaluated: 0, colliding_cases: 0, collisions: [], model_calls: 0, index_sha256: index?.sha256 ?? null };
  }
  if (index === null || index === undefined || !Array.isArray(index?.entries)) {
    // ⛔ A missing index is its OWN refusal, never a pass: "I could not check" must not be shaped
    //   like "checked and clean" (硬规则 3b).
    return { ok: false, refusal_code: "CASE_INDEX_UNAVAILABLE", reason: "CASE_INDEX_UNAVAILABLE:no-index-was-supplied-so-contamination-cannot-be-decided", evaluated: list.length, colliding_cases: 0, collisions: [], model_calls: 0, index_sha256: null };
  }
  const ownUseCaseIds = list.map((c) => c.id ?? c.case_id).filter((x) => isStr(x, 1));
  const table = [];
  const collisions = [];
  for (const c of list) {
    const hits = caseCollisions(index, c, { ownUseCaseIds });
    if (hits.length === 0) continue;
    const caseId = c.id ?? c.case_id ?? "(unnamed-case)";
    table.push({ case_id: caseId, source, collisions: hits });
    for (const h of hits) collisions.push({ case_id: caseId, ...h });
  }
  if (collisions.length === 0) {
    return { ok: true, refusal_code: null, reason: null, evaluated: list.length, colliding_cases: 0, collisions: [], model_calls: 0, index_sha256: index.sha256 ?? null };
  }
  const detail = table.map((t) => `${t.case_id}[${t.collisions.map(collisionLabel).join("+")}]`).join(",");
  return {
    ok: false, refusal_code: SEALED_SET_CONTAMINATED,
    reason: `${SEALED_SET_CONTAMINATED}:${table.length}-of-${list.length}-case(s)-have-been-used-before:${detail}`,
    evaluated: list.length, colliding_cases: table.length, collisions, table,
    model_calls: 0, index_sha256: index.sha256 ?? null,
  };
}

// ── binding a NEW case to its label, its pin, and its result ─────────────────────────────────────
//
// Plan item 4. A sealed case is only evidence about a METHOD if three things are pinned: WHERE its
// expected verdict is true (`evaluation_pin` / `fix_commit`), WHO labelled it independently
// (`labeled_by`), and WHEN — the label must PRECEDE the pre-registration, which must precede the
// first model call. Without the ordering the sequence is unfalsifiable: a verdict can be written
// after seeing the method's answer and still look identical on read-back.

/**
 * The content address of a held-out case's LABEL — the exact claim the verdict was judged against:
 * which case, over which components, pinned at which commit, labelled by whom and when. The ORDERING
 * proves the label predates the run; this digest proves WHICH label the run read, so a case whose
 * components or pin were edited afterwards no longer matches the verdict that cites it.
 */
export const caseLabelSha256 = (heldOutCase) => sha256(JSON.stringify({
  case_id: heldOutCase?.case_id ?? heldOutCase?.id ?? null,
  components: caseComponentsOf(heldOutCase),
  evaluation_pin: heldOutCase?.evaluation_pin ?? null,
  fix_commit: heldOutCase?.fix_commit ?? null,
  labeled_by: heldOutCase?.labeled_by ?? null,
  labeled_at: heldOutCase?.labeled_at ?? null,
}));

export const NO_LABELED_BY = "NO_LABELED_BY";
export const NO_LABELED_AT = "NO_LABELED_AT";
export const NO_PREREG_MTIME = "NO_PREREG_MTIME";
export const LABEL_AFTER_PREREG = "LABEL_AFTER_PREREG";
export const PREREG_AFTER_FIRST_CALL = "PREREG_AFTER_FIRST_CALL";

/** Parse an ISO-8601 string / epoch-ms number to ms; `null` when it cannot be read. ⛔ An UNREADABLE
 *  timestamp is `null`, never `0` or `NaN` — `0` would compare as "long ago" and quietly pass. */
export function msOf(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (isStr(v, 4)) { const t = Date.parse(String(v)); return Number.isFinite(t) ? t : null; }
  return null;
}

/**
 * The label-timing gate for ONE case. PURE. Distinct code per failure (硬规则 3): a missing labeller,
 * a missing label time, a label written after the pre-registration, and a pre-registration written
 * after the first model call are four different defects.
 *
 * @param {object} heldOutCase  must carry `labeled_by` (an independent labeller id) and `labeled_at`
 *   when it is a NEW sealed case; `prereg_mtime` is the pre-registration time of its sealed set.
 * @param {object} [o]
 * @param {number} [o.preregMtimeMs]  set-level override for `prereg_mtime`
 * @param {number} [o.nowMs]          the FIRST MODEL CALL's time
 */
export function validateCaseLabelTiming(heldOutCase, { preregMtimeMs = null, nowMs = Date.now() } = {}) {
  const reasons = [];
  const labeledAt = msOf(heldOutCase?.labeled_at);
  const preregAt = Number.isFinite(preregMtimeMs) ? preregMtimeMs : msOf(heldOutCase?.prereg_mtime ?? heldOutCase?.preregistered_at);
  const labeledBy = heldOutCase?.labeled_by;
  if (!isStr(labeledBy, 1)) reasons.push(NO_LABELED_BY);
  if (labeledAt === null) reasons.push(NO_LABELED_AT);
  if (preregAt === null) reasons.push(NO_PREREG_MTIME);
  if (reasons.length) return { ok: false, reasons, labeled_at: labeledAt, prereg_mtime: preregAt };
  if (labeledAt > preregAt) reasons.push(LABEL_AFTER_PREREG);
  if (preregAt > nowMs) reasons.push(PREREG_AFTER_FIRST_CALL);
  return { ok: reasons.length === 0, reasons, labeled_at: labeledAt, prereg_mtime: preregAt };
}

/**
 * The per-case BINDING gate for a whole sealed set: each case must name its labeller and label time,
 * its `evaluation_pin`, and (for a POSITIVE case) its `fix_commit`, and its `labeled_at` must
 * precede the set's pre-registration mtime, which must precede the first model call. ZERO model
 * calls. PURE over its inputs.
 *
 * @param {object[]} cases
 * @param {object} [o]
 * @param {number} [o.preregMtimeMs]  the sealed set's pre-registration time (its file mtime)
 * @param {number} [o.nowMs]          the first model call's time
 * @param {(a:string,b:string)=>boolean|null} [o.isAncestor]  when supplied, a POSITIVE case's
 *   `fix_commit` must DESCEND from its `evaluation_pin` (the temporal binding, checked here so a
 *   mis-pinned case is refused before registration rather than at verification time).
 */
export function validateSealedSetBinding(cases, { preregMtimeMs = null, nowMs = Date.now(), isAncestor = null } = {}) {
  const list = (Array.isArray(cases) ? cases : []).filter(isObj);
  const reasons = [];
  const table = [];
  for (const c of list) {
    const caseId = c.id ?? c.case_id ?? "(unnamed-case)";
    const rs = [];
    const timing = validateCaseLabelTiming(c, { preregMtimeMs, nowMs });
    rs.push(...timing.reasons);
    if (!isStr(c.evaluation_pin, 1)) rs.push("SEALED_CASE_NO_EVALUATION_PIN");
    const positive = isPositiveCase(c.role);
    if (positive && !isStr(c.fix_commit, 1) && fixCommitsOf(c).length === 0) rs.push("SEALED_CASE_NO_FIX_COMMIT");
    const fix = isStr(c.fix_commit, 1) ? c.fix_commit : fixCommitsOf(c)[0] ?? null;
    if (typeof isAncestor === "function" && isStr(fix, 1) && isStr(c.evaluation_pin, 1)) {
      const r = isAncestor(fix, c.evaluation_pin);
      if (r === true) rs.push("SEALED_CASE_FIX_NOT_DESCENDANT_OF_PIN");
      else if (r === null) rs.push("SEALED_CASE_PIN_UNRESOLVED");
    }
    table.push({ case_id: caseId, ok: rs.length === 0, reasons: rs });
    for (const r of rs) reasons.push(`${r}:${caseId}`);
  }
  return { ok: reasons.length === 0, reasons, table, evaluated: list.length, model_calls: 0 };
}

// ── metrics (recorded, never asserted) ────────────────────────────────────────────────────────────

/**
 * Aggregate the cost of a set of model-call records (the `modelCallFields` projections). Tokens are
 * SUMMED only when present: a call whose stream reported no usage contributes `null`, and if EVERY
 * call is unmeasured the totals are `null` — never a fabricated zero (硬规则 3b/4b).
 */
export function computeReflectionCost(calls, { wall_ms = null } = {}) {
  const list = (Array.isArray(calls) ? calls : []).filter(isObj);
  const sum = (key) => {
    const vals = list.map((c) => (c.usage && Number.isFinite(c.usage[key]) ? c.usage[key] : (key === "cache_read_input_tokens" || key === "cache_creation_input_tokens" ? (c.usage?.[key] ?? null) : null)));
    const known = vals.filter((v) => typeof v === "number");
    return known.length ? known.reduce((a, b) => a + b, 0) : null;
  };
  const costs = list.map((c) => c.cost_usd).filter((v) => typeof v === "number");
  return {
    model_calls: list.length,
    tokens: {
      input: sum("input_tokens"),
      output: sum("output_tokens"),
      cache_read: sum("cache_read_input_tokens"),
      cache_creation: sum("cache_creation_input_tokens"),
    },
    cost_usd: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : null,
    wall_ms,
    measured_calls: list.length,
  };
}

/**
 * `learning_quality` — of the candidates that were actually APPLIED, the fraction that correctly
 * predicted the held-out case's role. Returns a REAL number when at least one generalization call was
 * made, `null` when none was (so the caller reports `not-evaluated`, never a fabricated 0 — 硬规则 3b).
 * A call that could not be evaluated (`correct === null`) is excluded from BOTH numerator and
 * denominator and counted in `not_evaluated`.
 *
 * ⛔ NOT-APPLICABLE IS NOT A FAILURE (Plan item 2b, gap-discovery-method-generalization-failures-
 *   diagnosis-and-retest). A verdict whose `outcome` is `not-applicable` says the method does not
 *   cover that case: it is excluded from the denominator, and its count is REPORTED as its own field
 *   so "the methods were never applicable" cannot hide inside a flattering ratio. On the 2026-10-12
 *   regression run the three failures were all of this shape and every one of them was scored as a
 *   wrong prediction.
 *
 * @returns {{value:number|null, correct:number, evaluated:number, denominator:number,
 *            not_evaluated:number, not_applicable:number, total:number}}
 *   `denominator` is `evaluated` spelled out, because "correct / applicable-evaluated" is the reading
 *   the report owes; `value` is `null` (not 0) when nothing was applied.
 */
/**
 * The INDEPENDENT-ONLY learning quality (Plan item 4: "`teaching` and `transfer` … are excluded from
 * every independent metric"). Same arithmetic as `learningQuality`, over the subset whose recorded
 * `evidence_level` is exactly `independent` — and it reports how many verdicts it EXCLUDED and at which
 * levels, so a shrinking denominator cannot hide inside a flattering ratio.
 *
 * ⛔ `learningQuality` itself is deliberately left alone: it is the raw per-verdict reading, and
 *   redefining it as "independent only" would silently turn every existing consumer's denominator into
 *   a different quantity. The two readings are different QUESTIONS, so they are different functions.
 * @returns {{value:number|null, correct:number, evaluated:number, denominator:number, not_evaluated:number,
 *            not_applicable:number, total:number, excluded:number, by_evidence_level:object}}
 */
export function independentLearningQuality(verdicts) {
  const list = (Array.isArray(verdicts) ? verdicts : []).filter(isObj);
  const byLevel = {};
  for (const v of list) {
    const l = evidenceLevelOf(v);
    byLevel[l] = (byLevel[l] ?? 0) + 1;
  }
  const independent = list.filter(isIndependentEvidenceLevel);
  return { ...learningQuality(independent), excluded: list.length - independent.length, by_evidence_level: byLevel };
}

export function learningQuality(verdicts) {
  const list = (Array.isArray(verdicts) ? verdicts : []).filter(isObj);
  const notApplicable = list.filter((v) => v.outcome === OUTCOME_NOT_APPLICABLE);
  const rest = list.filter((v) => v.outcome !== OUTCOME_NOT_APPLICABLE);
  const evaluated = rest.filter((v) => v.correct === true || v.correct === false);
  const correct = evaluated.filter((v) => v.correct === true).length;
  return {
    value: evaluated.length ? correct / evaluated.length : null,
    correct,
    evaluated: evaluated.length,
    denominator: evaluated.length,
    not_evaluated: rest.length - evaluated.length,
    not_applicable: notApplicable.length,
    total: list.length,
  };
}

// ── the round orchestrator (the "thin entry" the later routine-wiring task will call) ─────────────

/**
 * Run ONE bounded reflection round over a root: read ledger + registry + prior attempts, select,
 * reflect, and RECORD an attempt per unit so the next round skips it. Writes: the attempt carrier
 * only. Candidate PERSISTENCE (into the method registry) is the CALLER's call — this function returns
 * the decisions and lets the caller `appendMethodRecord` what it wants to keep.
 */
export async function runReflectionRound(root, { model, budget = {}, modelId = null, nowMs = Date.now() } = {}) {
  const guard = disabledGuard(budget);
  if (guard) return guard;
  const b = resolveBudget(budget).budget;
  const ledger = readExperienceLedger(root);
  const registry = readMethodRegistry(root, { history: true });
  const prior = readReflectionAttempts(root);
  const sel = selectExperiencesForReflection(ledger, prior, { budget: b, nowMs });
  if (!sel.ok) return sel;
  const res = await reflect({ experiences: sel.selected, registry, model, budget: b, root, modelId, nowMs });
  if (!res.ok) return res;
  for (const d of res.decisions) {
    recordReflectionAttempt(root, {
      ts: new Date(nowMs).toISOString(),
      signature: d.signature,
      case_ids: d.case_ids ?? [],
      decision: d.decision ?? null,
      ok: d.ok === true,
      skipped: d.skipped === true,
      candidate_method_id: d.candidate?.method_id ?? null,
      reasons: d.reasons ?? [],
    });
  }
  return {
    ...res,
    selection: { units_evaluated: sel.units_evaluated, batch_size: sel.batch_size, skipped_prior: sel.skipped_prior, skipped_cap: sel.skipped_cap, merged_within_batch: sel.merged_within_batch },
    ledger: { ok: ledger.ok, records: ledger.records.length, malformed_lines: ledger.malformed_lines },
    registry: { ok: registry.ok, methods: registry.latest.length, malformed_lines: registry.malformed_lines },
  };
}

// ── the real model seam (thin; the SAME hardened launcher the hypothesis-generation stage uses) ────

/**
 * Build a live model seam for a root. Returns `{ok:false, reason}` when the driver runtime cannot be
 * loaded — a refusal, never a silent no-op. `tools` is `""` for the reflection/reasoning call and
 * `Read,Grep` for the verifier call (the bounded-verifier discipline).
 */
export async function liveModelFactory({ root, tools = "", maxTurns = null, timeoutMs = 300_000 } = {}) {
  const rt = await importDriverRuntime();
  if (!rt.ok) return { ok: false, reason: rt.reason };
  const { launchArgv, runAsync } = rt.mod;
  const model = modelFromArgv(hardenedArgv(launchArgv, "", root, { tools, maxTurns })) ?? null;
  const run = async (prompt) => runAsync(
    hardenedArgv(launchArgv, prompt, root, { tools, maxTurns, outputFormat: "stream-json" }),
    { timeoutMs, collectStderr: true, stdinData: prompt },
  );
  return { ok: true, model, run };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

const argOf = (args, name, dflt = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };

async function cli(argv = process.argv.slice(2)) {
  const verb = argv[0];
  const args = argv.slice(1);
  const root = path.resolve(argOf(args, "--root", process.cwd()));
  if (verb === "--help" || verb === "-h" || !verb) { usage(); return 0; }
  const budget = {
    enabled: !args.includes("--disabled"),
    maxPerRun: Number(argOf(args, "--max-per-run", DEFAULT_BUDGET.maxPerRun)),
    maxModelCalls: Number(argOf(args, "--max-model-calls", DEFAULT_BUDGET.maxModelCalls)),
    maxWallMs: Number(argOf(args, "--max-wall-ms", DEFAULT_BUDGET.maxWallMs)),
  };
  if (verb === "reflect") {
    const live = await liveModelFactory({ root, tools: "", timeoutMs: Number(argOf(args, "--timeout-ms", 300_000)) });
    if (!live.ok) { console.error(`${TOOL}: ${live.reason}`); return 1; }
    const out = await runReflectionRound(root, { model: live.run, budget, modelId: live.model });
    console.log(JSON.stringify({ model: live.model, ...out }, null, 1));
    return out.ok ? 0 : 1;
  }
  console.error(`${TOOL}: unknown verb '${verb ?? ""}'`);
  usage();
  return 2;
}

function usage() {
  console.error(`${TOOL} — reflection trigger + candidate generation (Discovery Method Phase 2)`);
  console.error("  reflect --root <dir> [--max-per-run N] [--max-model-calls N] [--max-wall-ms N] [--disabled] [--timeout-ms N]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().then((c) => { process.exitCode = c; }).catch((e) => { console.error(e?.stack ?? String(e)); process.exitCode = 1; });
}
