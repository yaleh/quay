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
// BUDGET / KILL SWITCH, enforced IN THIS MODULE (not deferred to the later routine-wiring task):
//   `enabled`, `maxPerRun`, `maxModelCalls`, `maxWallMs`. `enabled:false` makes EVERY exported entry
//   point return `{ok:false, reason:"disabled"}` with ZERO model calls — the same contract SHAPE as
//   `arch-discovery-routine.ts`'s config gate, reused by CONVENTION, not by import (this module has no
//   driver dependency at load time).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ── reuse, never re-derive ─────────────────────────────────────────────────────────────────────
// The ONE signature primitive (`subjectKey`), the content-addressing + carrier reader, the Experience
// ledger's role vocabulary, and the method registry's OWN validator + carrier — all imported. A second
// definition of any of them would be a second definition to keep in sync.
import { subjectKey, sha256, recordId, readRecords } from "./architecture-evidence-store.mjs";
import { EXPERIENCE_ROLES, ROLE_VERDICT_COMPAT, readExperienceLedger } from "./discovery-experience-ledger.mjs";
import {
  readMethodRegistry, validateMethodRecord, defaultToolNames, METHOD_STATUSES,
} from "./discovery-method-registry.mjs";
// The model-identity / cost machinery + the hardened launcher argv, reused by import (硬规则 5b).
import {
  modelCallFields, callText, parseJsonObject,
  importDriverRuntime, hardenedArgv, modelFromArgv,
} from "./arch-hypothesis-generation.mjs";

export const TOOL = "discovery-reflection";

/** The ONE carrier this module appends to: the reflection-attempt log. Gitignored family, same
 *  convention as the evidence store / the ledger (runtime state, never git-tracked). */
export const REFLECTION_ATTEMPTS_REL = path.posix.join(".quay", "discovery-reflection-attempts.jsonl");
export const REFLECTION_ATTEMPT_KIND = "reflection_attempt";

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
const nonWs = (s) => String(s ?? "").replace(/\s+/g, "").length;

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
  const experiences = (unit?.experiences ?? []).map((e) => ({
    case_id: e.case_id, role: e.role, reported_by: e.reported_by,
    components: e.components ?? [], summary: e.summary, evidence: (e.evidence ?? []).map((x) => x.ref),
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
    "5. `operation.tools` MUST be chosen ONLY from the ALLOWED TOOLS list below (1-4 entries).",
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
 */
export function assembleCandidate({ rec, unit, registry, budget, nowIso }) {
  const b = resolveBudget(budget).budget;
  const isNew = rec.decision === "new";
  const method_id = isNew ? slug(rec.method_id) : String(rec.method_ref);
  const provenance = (unit?.experiences ?? []).map((e) => e.id).filter(isStr);
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
      tools: Array.isArray(rec.operation_tools) ? rec.operation_tools.filter((t) => isStr(t, 1)) : [],
    },
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
 * @param {number}   [o.nowMs]
 * @returns {Promise<object>} `{ok, decisions[], model_calls, skipped_budget, wall_ms, cost}`
 */
export async function reflect({ experiences, registry = [], model, budget = {}, root = null, nowMs = Date.now() } = {}) {
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
    const fields = modelCallFields({ requested: null, stdout });
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
    const cv = validateMethodRecord(candidate, { toolCatalog: toolNames, existing: latestMethods(registry) });
    if (!cv.ok) {
      decisions.push({ ...base, ok: false, decision: parsed.decision, reasons: cv.reasons });
      continue;
    }
    decisions.push({ ...base, ok: true, decision: parsed.decision, candidate, reflection: narrative(parsed) });
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

// ── validateGeneralization: the cross-case test (the ONLY draft→active gate) ──────────────────────

/** The verdict a role's ground truth corresponds to — REUSES the ledger's own role↔verdict contract
 *  rather than re-declaring the mapping here (a second copy would drift). */
export const roleExpectedVerdicts = (role) => ROLE_VERDICT_COMPAT[role] ?? [];

/** The verifier prompt: PREDICT the outcome of applying `candidate` to the held-out case's files,
 *  WITHOUT being told that case's ground-truth role (a blind prediction, not a self-graded answer). */
export function buildGeneralizationPrompt({ candidate, heldOutCase }) {
  return [
    "You are a VERIFIER. Apply ONE architecture-discovery method to a target file set and PREDICT the",
    "outcome. You are NOT told the expected answer: judge from the files themselves.",
    "",
    "METHOD:",
    JSON.stringify({
      method_id: candidate.method_id,
      steps: candidate.operation?.steps ?? [],
      expected_invariant: candidate.expected_invariant ?? null,
      falsification: candidate.falsification ?? null,
    }, null, 1),
    "",
    "TARGET FILE SET (read them with your tools):",
    JSON.stringify(heldOutCase?.components ?? []),
    "",
    "Apply the method's steps to that file set. Decide whether the method's `expected_invariant` HOLDS",
    "or is VIOLATED there.",
    "Respond with ONE JSON object and NOTHING ELSE:",
    "{",
    '  "invariant_holds": true | false,',
    '  "verdict": "supported" | "refuted" | "undetermined",  // supported = invariant VIOLATED (a real finding); refuted = invariant holds (claim was false); undetermined = could not tell',
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
 * @returns {Promise<object>} `{ok, called, predicted_verdict, expected_verdicts, correct, promoted,
 *                              candidate_after, retirement_reason, not_evaluated_reason, model_call}`
 */
export async function validateGeneralization({ candidate, heldOutCase, registry = [], model, budget = {}, nowMs = Date.now() } = {}) {
  const guard = disabledGuard(budget);
  if (guard) return guard;
  if (typeof model !== "function") return { ok: false, reason: "model-seam-missing", called: false };
  if (!isObj(candidate) || !isStr(candidate.method_id, 1)) return { ok: false, reason: "CANDIDATE_INVALID:needs-a-method_id", called: false };
  if (!isObj(heldOutCase) || !isStr(heldOutCase.role, 1)) return { ok: false, reason: "HELD_OUT_INVALID:needs-an-experience-with-a-role", called: false };

  // The held-out case must be OUTSIDE the batch that produced the candidate: a case the candidate was
  // fitted to proves nothing about transfer.
  const prov = Array.isArray(candidate.provenance_evidence) ? candidate.provenance_evidence : [];
  if (isStr(heldOutCase.id, 1) && prov.includes(heldOutCase.id)) {
    return { ok: false, called: false, reason: `HELD_OUT_INSIDE_THE_BATCH:${heldOutCase.id}-is-already-a-provenance-member-of-${candidate.method_id}` };
  }
  const expected = roleExpectedVerdicts(heldOutCase.role);
  if (!expected.length) return { ok: false, called: false, reason: `HELD_OUT_ROLE_UNKNOWN:${heldOutCase.role}` };

  const prompt = buildGeneralizationPrompt({ candidate, heldOutCase });
  const tCall = Date.now();
  const { stdout } = await modelCall(model, prompt);
  const call = { ...modelCallFields({ requested: null, stdout }), wall_ms: Date.now() - tCall };
  const parsed = parseJsonObject(callText(stdout));
  const nextV = nextVersion(registry, candidate.method_id);

  if (!parsed || !isStr(parsed.verdict, 1)) {
    // NOT-EVALUATED (its own value): the reading failed, the METHOD was not refuted. Stays draft.
    return {
      ok: true, called: true, model_call: call, predicted_verdict: null, expected_verdicts: expected,
      correct: null, promoted: false, candidate_after: { ...candidate }, retirement_reason: null,
      not_evaluated_reason: parsed ? "VERDICT_MISSING_IN_MODEL_OUTPUT" : "UNPARSEABLE_MODEL_OUTPUT",
    };
  }
  const predicted = String(parsed.verdict);
  const correct = expected.includes(predicted);
  if (correct) {
    return {
      ok: true, called: true, model_call: call, predicted_verdict: predicted, expected_verdicts: expected,
      correct: true, promoted: true,
      candidate_after: { ...candidate, version: nextV, status: "active", retirement_reason: null },
      retirement_reason: null, not_evaluated_reason: null, reasoning: parsed.reasoning ?? null,
    };
  }
  const retirement_reason = `failed-generalization-on-${heldOutCase.case_id ?? heldOutCase.id ?? "held-out"}: predicted-${predicted}-but-role-${heldOutCase.role}-requires-${expected.join("|")}`;
  return {
    ok: true, called: true, model_call: call, predicted_verdict: predicted, expected_verdicts: expected,
    correct: false, promoted: false,
    candidate_after: { ...candidate, version: nextV, status: "retired", retirement_reason },
    retirement_reason, not_evaluated_reason: null, reasoning: parsed.reasoning ?? null,
  };
}

// ── the reflection-attempt carrier (so the next round does not re-spend a call) ────────────────────

export const attemptsFile = (root) => path.join(root, REFLECTION_ATTEMPTS_REL);

/** Read the reflection-attempt log. Unparseable lines are DROPPED and COUNTED (never silent). */
export function readReflectionAttempts(root) {
  const file = attemptsFile(root);
  const { records, malformed_lines } = readRecords(file);
  return { ok: malformed_lines === 0, records: records.filter((r) => isObj(r) && r.kind === REFLECTION_ATTEMPT_KIND), malformed_lines, file };
}

/** Append ONE reflection-attempt record: WHICH signature was reflected on, and what came of it. This
 *  is the record `selectExperiencesForReflection` dedups against — without it a `no-method` verdict
 *  would be re-asked forever. */
export function recordReflectionAttempt(root, rec) {
  if (!isObj(rec) || !isStr(rec.signature, 1)) return { ok: false, reasons: ["ATTEMPT_SIGNATURE_REQUIRED"], appended: false };
  const withId = { id: rec.id ?? recordId(REFLECTION_ATTEMPT_KIND, rec), ...rec };
  const file = attemptsFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ kind: REFLECTION_ATTEMPT_KIND, ...withId }) + "\n", "utf8");
  return { ok: true, kind: REFLECTION_ATTEMPT_KIND, id: withId.id, file, record: withId };
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
 * `learning_quality` — of the candidates that REACHED a `validateGeneralization` call, the fraction
 * that correctly predicted the held-out case's role. Returns a REAL number when at least one
 * generalization call was made, `null` when none was (so the caller reports `not-evaluated`, never a
 * fabricated 0 — 硬规则 3b). A call that could not be evaluated (`correct === null`) is excluded from
 * BOTH numerator and denominator and counted in `not_evaluated`.
 */
export function learningQuality(verdicts) {
  const list = (Array.isArray(verdicts) ? verdicts : []).filter(isObj);
  const evaluated = list.filter((v) => v.correct === true || v.correct === false);
  const correct = evaluated.filter((v) => v.correct === true).length;
  return {
    value: evaluated.length ? correct / evaluated.length : null,
    evaluated: evaluated.length,
    correct,
    not_evaluated: list.length - evaluated.length,
  };
}

// ── the round orchestrator (the "thin entry" the later routine-wiring task will call) ─────────────

/**
 * Run ONE bounded reflection round over a root: read ledger + registry + prior attempts, select,
 * reflect, and RECORD an attempt per unit so the next round skips it. Writes: the attempt carrier
 * only. Candidate PERSISTENCE (into the method registry) is the CALLER's call — this function returns
 * the decisions and lets the caller `appendMethodRecord` what it wants to keep.
 */
export async function runReflectionRound(root, { model, budget = {}, nowMs = Date.now() } = {}) {
  const guard = disabledGuard(budget);
  if (guard) return guard;
  const b = resolveBudget(budget).budget;
  const ledger = readExperienceLedger(root);
  const registry = readMethodRegistry(root, { history: true });
  const prior = readReflectionAttempts(root);
  const sel = selectExperiencesForReflection(ledger, prior, { budget: b, nowMs });
  if (!sel.ok) return sel;
  const res = await reflect({ experiences: sel.selected, registry, model, budget: b, root, nowMs });
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
    const out = await runReflectionRound(root, { model: live.run, budget });
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
