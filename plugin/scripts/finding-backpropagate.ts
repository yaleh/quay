// finding-backpropagate.ts — the Prepare/Execute feedback back-propagation mechanism
// (gap-audit-findings-not-backpropagated-to-earlier-detectors).
//
// PROBLEM (the gap): a finding discovered by a LATER detector (Prepare review, PlanCheck,
// Acceptance Audit, Gate, Wiring Audit) dies in its ORIGINAL home. Nothing classifies its
// earliest-detectable stage, proves a detector against good/bad corpora, authorizes a
// profile/global policy scope, and then measures a later real catch — so the EARLIER detector
// stays blind to the class and fresh semantic review keeps consuming the same defect class.
//
// FIX (this module): a deterministic classification/review command consuming the canonical
// DIR-124-B FindingEnvelope (stage-receipt.ts) and emitting `task-specific|profile|global`,
// `earliestDetectableStage`, recurrence evidence, promotion decision, and an optional detector
// candidate; a RED/GREEN/ambiguous calibration proof; an AUTHORIZED back-propagation transition
// (via execution-policy.ts — the proposing observer can never self-activate, AC3); a policy-hash
// change + exact receipt invalidation (AC4); a false-positive/reopened control (AC8); and a
// metrics report reproducible from canonical receipts + DIR-126-D/E telemetry (AC7).
//
// Promotion is conservative (the Proposal's §7 model): a finding may move earlier ONLY when every
// fact it needs exists at the declared earlier stage; a runtime-only finding stays Audit/Wiring-
// Audit scoped (AC1). The originating observer is read-only: it records the finding and proposes a
// detector, but cannot approve or activate it.
//
// Zero npm dependencies — Node.js built-ins only (node:fs, node:path, node:crypto). No build
// step; dispatched via `node --experimental-strip-types <abs path>/finding-backpropagate.ts <mode>`.
//
// Export surfaces:
//   - Constants: DEFAULT_STAGE_ORDER, KNOWN_DETECTORS, BACKPROPAGATE_SCHEMA_VERSION
//   - Types: ClassificationResult, CalibrationResult, BackpropagationResult, ControlResult,
//     MetricsReport, DetectorCandidate, Corpora
//   - Functions: classifyFinding, detectAcCoverageCitations, runDetector, proveDetector,
//     backpropagate, controlFalsePositive, reportBackpropagationMetrics, selftest()
//   - CLI: --classify '<{finding,stageFacts}>', --detect-ac-citations '<task-text-file>',
//     --prove '<{detector,corpora}>', --backpropagate '<json>', --control-fp '<json>',
//     --metrics '<json>', --selftest
//
// Byte-identical mirror: plugin/scripts/finding-backpropagate.ts

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FindingEnvelope } from "./stage-receipt.ts";
import { sha256OfString, migratePrepareLedger } from "./stage-receipt.ts";
import { createSelftest, parseJsonArg } from "./gate-script-base.ts";
import {
  authorizeActivation,
  revokeActivation,
  invalidateReceiptsForPolicyChange,
  type PolicyDocument,
  type ReceiptPolicyBinding,
  type ActivationRequest,
} from "./execution-policy.ts";

// ── Contract version ────────────────────────────────────────────────────────────────────────────────

export const BACKPROPAGATE_SCHEMA_VERSION = "1" as const;

/** Canonical stage order — the "earlier" axis for back-propagation. */
export const DEFAULT_STAGE_ORDER = [
  "Proposal",
  "PlanCheck",
  "Verify",
  "Build",
  "Audit",
  "Gate",
  "WiringAudit",
  "PostLand",
] as const;

export const GENERALIZATIONS = ["task-specific", "profile", "global"] as const;

/** Common observer-stage spellings mapped to the canonical stage order (the proposal doc and
 * live findings use several: "Proposal review", "Acceptance Audit", "Wiring Audit", "Receipt"). */
export const OBSERVER_STAGE_ALIASES: Record<string, string> = {
  "proposal": "Proposal",
  "proposalreview": "Proposal",
  "proposal review": "Proposal",
  "prepare": "Proposal",
  "receipt": "PlanCheck",
  "plancheck": "PlanCheck",
  "verify": "Verify",
  "build": "Build",
  "audit": "Audit",
  "acceptanceaudit": "Audit",
  "acceptance audit": "Audit",
  "gate": "Gate",
  "wiringaudit": "WiringAudit",
  "wiring audit": "WiringAudit",
  "postland": "PostLand",
};

// ── Types ────────────────────────────────────────────────────────────────────────────────────────────

/** stage -> set of fact-keys available at that stage. A finding's required facts are the keys of
 * its materialInputHashes (path-bound, DIR-124-B canonical) plus any runtime-only facts the
 * finding depends on that exist at NO earlier stage. */
export type StageFacts = Record<string, string[]>;

export interface DetectorCandidate {
  detectorId: string;
  recurrenceKey: string;
  rule: string;
  stage: string;
}

export interface ClassificationResult {
  findingId: string;
  recurrenceKey: string;
  observerStage: string;
  generalization: (typeof GENERALIZATIONS)[number];
  /** The earliest stage (in DEFAULT_STAGE_ORDER) whose available facts are a superset of the
   * finding's required facts; null when the finding is runtime-only (no declared stage has them). */
  earliestDetectableStage: string | null;
  /** Required facts that could not be located at any declared stage (runtime-only). */
  missingFactsEverywhere: string[];
  /** Promotion to the (proposed) earlier stage is allowed. */
  promotionAllowed: boolean;
  rejectionReasons: string[];
  detectorCandidate: DetectorCandidate | null;
}

export interface Corpora {
  red: string[];
  green: string[];
  ambiguous: string[];
}

export interface CalibrationResult {
  ok: boolean;
  detectorId: string;
  rule: string;
  redHitRate: number;
  falsePositiveRate: number;
  ambiguousValidRate: number;
  red: Array<{ caught: boolean; detail: string }>;
  green: Array<{ flagged: boolean; detail: string }>;
  ambiguous: Array<{ flagged: boolean; detail: string }>;
}

export interface BackpropagationResult {
  ok: boolean;
  reason: string;
  activation: {
    ok: boolean;
    reason: string;
    policyBefore: string;
    policyAfter: string;
    detectorId: string;
    stage: string;
  };
  invalidation: {
    oldPolicyHash: string;
    newPolicyHash: string;
    invalidated: string[];
    unaffected: string[];
  } | null;
}

export interface ControlResult {
  ok: boolean;
  reason: string;
  revocation: {
    ok: boolean;
    reason: string;
    policyBefore: string;
    policyAfter: string;
    detectorId: string;
  };
  invalidation: {
    oldPolicyHash: string;
    newPolicyHash: string;
    invalidated: string[];
    unaffected: string[];
  } | null;
}

export interface MetricsReport {
  schemaVersion: typeof BACKPROPAGATE_SCHEMA_VERSION;
  totalFindings: number;
  generalizableFindings: number;
  promotedFindings: number;
  backPropagationRate: number | null;
  recurringFindings: number;
  /** recurrenceWaste — agent-minutes spent rediscovering an unchanged recurrenceKey, or
   * { value: null, unknown: true } when the checked-in telemetry lacks the cost field. */
  recurrenceWasteAgentMinutes: { value: number | null; unknown: boolean };
  tokenDelta: { value: number | null; unknown: boolean };
  unknownFields: string[];
}

// ── sha256 helper (re-export for tests) ─────────────────────────────────────────────────────────────

export { sha256OfString };

// ── Known detectors registry ─────────────────────────────────────────────────────────────────────────

/**
 * The ONE registry of back-propagatable detector rules. A finding whose recurrenceKey maps to a
 * known detector can propose it as its detectorCandidate; unknown keys propose nothing (the
 * classification still runs — a detector candidate is OPTIONAL).
 */
export const KNOWN_DETECTORS: Array<{ recurrenceKey: string; rule: string; stage: string; detectorId: string }> = [
  {
    // The REAL M208 finding class (proposal-ledger 55016c0b, rootCauseKey "ac7-checklist-missing"):
    // a Proposal's "### AC coverage mapping" cites an AC identifier (e.g. AC7) that does not exist
    // in the task's "## Acceptance Criteria" checklist. The recurrenceKey is the finding's own
    // stable rootCauseKey (sha256/precedent: proposal-convergence.ts), so a later real catch emits
    // the SAME recurrence identity (AC5). All inputs (the task file) exist at PlanCheck.
    recurrenceKey: "ac7-checklist-missing",
    rule: "detectAcCoverageCitations",
    stage: "PlanCheck",
    detectorId: "det-ac-coverage-citations",
  },
];

export function knownDetectorFor(recurrenceKey: string): DetectorCandidate | null {
  const k = KNOWN_DETECTORS.find((d) => d.recurrenceKey === recurrenceKey);
  if (!k) return null;
  return { detectorId: k.detectorId, recurrenceKey: k.recurrenceKey, rule: k.rule, stage: k.stage };
}

// ── classifyFinding (AC1 — deterministic classification + promotion rejection) ─────────────────────

/**
 * Deterministic classification of a canonical FindingEnvelope. Returns the earliest stage at which
 * ALL required facts exist, the generalization (task-specific | profile | global), and whether
 * promotion to the proposed earlier stage is allowed. Promotion is REJECTED (AC1) when:
 *   - a required fact exists at no declared stage (runtime-only → stays observer/Audit scoped); or
 *   - the proposed targetStage is earlier than the finding's earliestDetectableStage (the evidence
 *     does not exist at the proposed stage); or
 *   - the proposed targetStage is not strictly earlier than the finding's observer stage (there is
 *     no earlier detector to back-propagate to).
 */
export function classifyFinding(
  finding: FindingEnvelope,
  stageFacts: StageFacts,
  opts?: {
    targetStage?: string;
    stageOrder?: readonly string[];
    priorFindings?: Array<{ recurrenceKey: string }>;
    forceGeneralization?: (typeof GENERALIZATIONS)[number];
  }
): ClassificationResult {
  const stageOrder = opts?.stageOrder ?? DEFAULT_STAGE_ORDER;
  const observerStage = String(finding.observerStage ?? "");
  const recurrenceKey = String(finding.recurrenceKey ?? "");
  const requiredFacts = Object.keys(finding.materialInputHashes ?? {});

  const rejectionReasons: string[] = [];
  const missingFactsEverywhere: string[] = [];

  // AC2 complete-input proof: a finding with NO material input hashes is vacuously detectable at
  // every stage and proves nothing — promotion requires a non-empty, hash-bound input set.
  if (requiredFacts.length === 0) {
    rejectionReasons.push("no material input hashes (incomplete-input proof) — a finding must bind the inputs its class depends on before promotion");
  }

  // Earliest stage whose facts are a superset of the required facts.
  let earliestDetectableStage: string | null = null;
  for (const stage of stageOrder) {
    const available = new Set(stageFacts[stage] ?? []);
    const missing = requiredFacts.filter((f) => !available.has(f));
    if (missing.length === 0) {
      earliestDetectableStage = stage;
      break;
    }
  }
  if (earliestDetectableStage == null) {
    // A required fact exists at NO declared stage → runtime-only.
    for (const stage of stageOrder) {
      const available = new Set(stageFacts[stage] ?? []);
      for (const f of requiredFacts) {
        if (!available.has(f) && !missingFactsEverywhere.includes(f)) missingFactsEverywhere.push(f);
      }
    }
  }

  // Generalization (deterministic): recurrence evidence → profile; otherwise task-specific.
  const recurred =
    (typeof finding.firstSeenGeneration === "number" &&
      typeof finding.lastSeenGeneration === "number" &&
      finding.firstSeenGeneration < finding.lastSeenGeneration) ||
    (opts?.priorFindings ?? []).some((p) => p.recurrenceKey === recurrenceKey) ||
    (finding.everBlocking === true && (finding.severity === "blocker" || finding.severity === "major"));
  let generalization: (typeof GENERALIZATIONS)[number] = recurred ? "profile" : "task-specific";
  if (opts?.forceGeneralization) {
    if (!(GENERALIZATIONS as readonly string[]).includes(opts.forceGeneralization)) {
      rejectionReasons.push(`invalid-forceGeneralization: ${opts.forceGeneralization}`);
    } else {
      generalization = opts.forceGeneralization;
    }
  }

  const observerCanonical = OBSERVER_STAGE_ALIASES[String(observerStage ?? "").toLowerCase()] ?? observerStage;
  const earliestIdx = earliestDetectableStage != null ? stageOrder.indexOf(earliestDetectableStage) : -1;
  // The downstream escape point: an unchecked recurrence would otherwise surface at Audit/Wiring
  // Audit. Back-propagation is meaningful only to a stage strictly EARLIER than this.
  const auditIdx = stageOrder.indexOf("Audit");

  let promotionAllowed = false;
  if (requiredFacts.length === 0) {
    // complete-input proof failed (handled above) — never promote without material hashes.
    promotionAllowed = false;
  } else if (earliestDetectableStage == null) {
    rejectionReasons.push(
      `runtime-only: required fact(s) ${missingFactsEverywhere.join(", ") || "(none declared)"} exist at no declared stage — the finding remains ${observerCanonical || "Audit"}/Wiring-Audit scoped`
    );
  } else if (opts?.targetStage != null) {
    const targetIdx = stageOrder.indexOf(opts.targetStage);
    if (targetIdx === -1) {
      rejectionReasons.push(`unknown-targetStage: ${opts.targetStage}`);
    } else if (targetIdx < earliestIdx) {
      rejectionReasons.push(
        `required evidence does not exist at proposed earlier stage ${opts.targetStage}: facts ${requiredFacts.join(", ")} first exist at ${earliestDetectableStage}`
      );
    } else if (auditIdx !== -1 && targetIdx >= auditIdx) {
      rejectionReasons.push(
        `no back-propagation: proposed stage ${opts.targetStage} is not strictly earlier than the downstream Audit/Wiring-Audit detector`
      );
    } else {
      promotionAllowed = true;
    }
  } else if (auditIdx !== -1 && earliestIdx < auditIdx) {
    promotionAllowed = true;
  } else {
    rejectionReasons.push(
      `no earlier detector: earliest detectable stage ${earliestDetectableStage} is not strictly earlier than Audit`
    );
  }
  // Observer-stage is informational only (an upstream observer like ProposalReview can still be
  // back-propagated as RECURRENCE coverage so a future occurrence is caught at PlanCheck instead
  // of escaping to Audit). The AC1 evidence rule above is the sole promotion predicate.

  const detectorCandidate = promotionAllowed ? knownDetectorFor(recurrenceKey) : null;
  if (promotionAllowed && detectorCandidate == null) {
    rejectionReasons.push(`no known detector for recurrenceKey ${recurrenceKey} — promotion requires a detector candidate`);
    promotionAllowed = false;
  }

  return {
    findingId: String(finding.findingId ?? ""),
    recurrenceKey,
    observerStage,
    generalization,
    earliestDetectableStage,
    missingFactsEverywhere,
    promotionAllowed,
    rejectionReasons,
    detectorCandidate,
  };
}

// ── detectAcCoverageCitations (the concrete PlanCheck detector for the real M208 class) ─────────────

export interface AcCoverageCitationFinding {
  recurrenceKey: string;
  acIndex: number;
  checklistCount: number;
  detail: string;
}

export interface AcCoverageResult {
  ok: boolean;
  findings: AcCoverageCitationFinding[];
}

/**
 * PlanCheck detector for the real M208 finding class (rootCauseKey ac7-checklist-missing /
 * recurrenceKey ac7-checklist-missing): a "### AC coverage mapping" section cites an AC
 * identifier (AC<N>) that does not exist as a checkbox in the task's "## Acceptance Criteria"
 * section. The rule is mechanical:
 *   - AC<N> is present when N <= checklistCount OR the literal "AC<N>" token appears in the
 *     checklist section (tasks that label their checklist items);
 *   - a cited AC that is not present is a finding (load-bearing prose with no falsifiable AC).
 * A task with no mapping section is valid (nothing to check). A mapping citing AC1..ACN against an
 * N-item checklist is valid. This is the RED/GREEN predicate for the calibration corpora.
 */
export function detectAcCoverageCitations(taskText: string): AcCoverageResult {
  const lines = taskText.split(/\r?\n/);
  const findings: AcCoverageCitationFinding[] = [];

  const mappingStart = lines.findIndex((l) => /^###\s+AC coverage mapping/i.test(l.trim()));
  if (mappingStart === -1) return { ok: true, findings }; // no mapping → nothing to check

  // Mapping section: from the mapping heading to the next '## ' (h2) heading.
  const mappingLines: string[] = [];
  for (let i = mappingStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    mappingLines.push(lines[i]);
  }
  const mappingText = mappingLines.join("\n");

  // Acceptance Criteria section: from its heading to the next '## ' heading.
  const acStart = lines.findIndex((l) => /^##\s+Acceptance Criteria/i.test(l.trim()));
  let checklistCount = 0;
  const checklistText: string[] = [];
  if (acStart !== -1) {
    for (let i = acStart + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) break;
      checklistText.push(lines[i]);
      if (/^[-*]\s+\[[ xX]\]/.test(lines[i])) checklistCount++;
    }
  }
  const checklistJoined = checklistText.join("\n");

  const citedIndices = [...mappingText.matchAll(/AC(\d+)/g)].map((m) => Number(m[1]));
  for (const idx of citedIndices) {
    const presentByIndex = checklistCount > 0 && idx <= checklistCount;
    const presentByLabel = new RegExp(`\\bAC${idx}\\b`).test(checklistJoined);
    if (!presentByIndex && !presentByLabel) {
      findings.push({
        recurrenceKey: "ac7-checklist-missing",
        acIndex: idx,
        checklistCount,
        detail: `AC coverage mapping cites AC${idx} but the "## Acceptance Criteria" checklist has ${checklistCount} item(s) and no literal "AC${idx}" label — load-bearing prose with no falsifiable AC item to gate it`,
      });
    }
  }
  return { ok: findings.length === 0, findings };
}

// ── runDetector / proveDetector (AC2 — RED/GREEN/ambiguous calibration) ────────────────────────────

/** Dispatch a named detector rule over one input; the registry is fail-closed (unknown rule). */
export function runDetector(rule: string, input: string): { ok: boolean; detail: string } {
  switch (rule) {
    case "detectAcCoverageCitations": {
      const r = detectAcCoverageCitations(input);
      return { ok: r.ok, detail: r.ok ? "no missing AC citations" : r.findings.map((f) => f.detail).join(" | ") };
    }
    default:
      return { ok: false, detail: `unknown-rule: ${rule}` };
  }
}

/**
 * Calibration proof for a detector candidate. Requires: every RED corpus input is caught
 * (redHitRate === 1) and zero false positives on the known-good (green) + ambiguous-valid corpus
 * (falsePositiveRate === 0). A detector that cannot be proven this way is NOT eligible for
 * profile/global activation (AC2 + execution-policy calibration gate).
 */
export function proveDetector(detector: DetectorCandidate, corpora: Corpora): CalibrationResult {
  const red: CalibrationResult["red"] = [];
  const green: CalibrationResult["green"] = [];
  const ambiguous: CalibrationResult["ambiguous"] = [];

  for (const text of corpora.red) {
    const r = runDetector(detector.rule, text);
    red.push({ caught: !r.ok, detail: r.detail });
  }
  for (const text of corpora.green) {
    const r = runDetector(detector.rule, text);
    green.push({ flagged: !r.ok, detail: r.detail });
  }
  for (const text of corpora.ambiguous) {
    const r = runDetector(detector.rule, text);
    ambiguous.push({ flagged: !r.ok, detail: r.detail });
  }

  const redHitRate = corpora.red.length === 0 ? 0 : red.filter((r) => r.caught).length / corpora.red.length;
  const greenFlagged = green.filter((g) => g.flagged).length;
  const ambiguousFlagged = ambiguous.filter((a) => a.flagged).length;
  const totalNonRed = corpora.green.length + corpora.ambiguous.length;
  const falsePositiveRate = totalNonRed === 0 ? 0 : (greenFlagged + ambiguousFlagged) / totalNonRed;
  const ambiguousValidRate = corpora.ambiguous.length === 0 ? 1 : ambiguous.filter((a) => !a.flagged).length / corpora.ambiguous.length;

  const ok = redHitRate === 1 && falsePositiveRate === 0 && ambiguousValidRate === 1;
  return {
    ok,
    detectorId: detector.detectorId,
    rule: detector.rule,
    redHitRate,
    falsePositiveRate,
    ambiguousValidRate,
    red,
    green,
    ambiguous,
  };
}

// ── backpropagate (AC3/AC4 — authorized activation + exact receipt invalidation) ───────────────────

/**
 * The authorized back-propagation transition. Composes execution-policy.authorizeActivation (the
 * distinct authorized transition; the proposing observer can never self-activate — AC3) with the
 * exact receipt invalidation for the policy-hash change (AC4). Read-only on task/audit state — the
 * proposing observer records the finding and proposes the detector; only a policy-owner /
 * directive-owner can activate, and the Audit/Wiring Audit stays enabled (AC6).
 */
export function backpropagate(
  policy: PolicyDocument,
  finding: FindingEnvelope,
  detector: DetectorCandidate,
  calibration: CalibrationResult,
  request: { authorizer: { role: string; id: string }; receipts: ReceiptPolicyBinding[]; note?: string }
): BackpropagationResult {
  const activationRequest: ActivationRequest = {
    detector: { detectorId: detector.detectorId, recurrenceKey: detector.recurrenceKey, rule: detector.rule, stage: detector.stage },
    authorizer: request.authorizer,
    proposingObserverStage: finding.observerStage,
    calibrationOk: calibration.ok,
    calibrationRef: {
      red: calibration.red.length,
      green: calibration.green.length,
      ambiguous: calibration.ambiguous.length,
      redHitRate: calibration.redHitRate,
      falsePositiveRate: calibration.falsePositiveRate,
    },
    note: request.note,
  };
  const activation = authorizeActivation(policy, activationRequest);
  if (!activation.ok) {
    return {
      ok: false,
      reason: activation.reason,
      activation: {
        ok: false,
        reason: activation.reason,
        policyBefore: activation.policyBefore,
        policyAfter: activation.policyAfter,
        detectorId: detector.detectorId,
        stage: detector.stage,
      },
      invalidation: null,
    };
  }

  const invalidation = invalidateReceiptsForPolicyChange(activation.policyBefore, activation.policyAfter, { recurrenceKey: detector.recurrenceKey }, request.receipts);
  return {
    ok: true,
    reason: `back-propagated ${detector.recurrenceKey} to ${detector.stage}; ${invalidation.invalidated.length} affected receipt(s) invalidated`,
    activation: {
      ok: true,
      reason: activation.reason,
      policyBefore: activation.policyBefore,
      policyAfter: activation.policyAfter,
      detectorId: detector.detectorId,
      stage: detector.stage,
    },
    invalidation,
  };
}

// ── controlFalsePositive (AC8 — the false-positive / reopened-finding control) ─────────────────────

/**
 * AC8 control: a detector that later produces a false positive, or whose finding reopens, is
 * disabled/failed SAFELY. The rule is revoked from the active policy (policy hash changes) and the
 * receipts bound to the affected recurrence class under the old hash are invalidated. The control
 * never deletes evidence and never touches the independent Acceptance/Wiring Audit — it only
 * removes the activated rule from the policy.
 */
export function controlFalsePositive(
  policy: PolicyDocument,
  detector: DetectorCandidate,
  opts: { reason: string; actor: string; receipts: ReceiptPolicyBinding[] }
): ControlResult {
  const revocation = revokeActivation(policy, detector.detectorId, { reason: opts.reason, actor: opts.actor });
  if (!revocation.ok) {
    return {
      ok: false,
      reason: revocation.reason,
      revocation: {
        ok: false,
        reason: revocation.reason,
        policyBefore: revocation.policyBefore,
        policyAfter: revocation.policyAfter,
        detectorId: detector.detectorId,
      },
      invalidation: null,
    };
  }
  const invalidation = invalidateReceiptsForPolicyChange(revocation.policyBefore, revocation.policyAfter, { recurrenceKey: detector.recurrenceKey }, opts.receipts);
  return {
    ok: true,
    reason: `false-positive/reopened control: ${detector.detectorId} disabled; ${invalidation.invalidated.length} affected receipt(s) invalidated`,
    revocation: {
      ok: true,
      reason: revocation.reason,
      policyBefore: revocation.policyBefore,
      policyAfter: revocation.policyAfter,
      detectorId: detector.detectorId,
    },
    invalidation,
  };
}

// ── reportBackpropagationMetrics (AC7 — reproducible from canonical receipts + DIR-126-D/E telemetry)

/**
 * Metrics report reproducible from canonical receipts and DIR-126-D/E telemetry WITHOUT reading
 * private Claude session JSONL. Cost fields (agent-minutes, tokens) are read ONLY from checked-in
 * telemetry; when a field is absent from the canonical data it is reported as an EXPLICIT unknown
 * ({ value: null, unknown: true }), never fabricated.
 */
export function reportBackpropagationMetrics(opts: {
  findings: Array<Pick<FindingEnvelope, "findingId" | "recurrenceKey" | "generalization" | "firstSeenGeneration" | "lastSeenGeneration" | "observerStage">>;
  policy: PolicyDocument;
  telemetryFiles?: string[];
  cwd?: string;
}): MetricsReport {
  const unknownFields: string[] = [];
  const totalFindings = opts.findings.length;
  const generalizableFindings = opts.findings.filter((f) => f.generalization === "profile" || f.generalization === "global").length;
  const activeRecurrenceKeys = new Set(opts.policy.activatedDetectors.map((d) => d.recurrenceKey));
  const promotedFindings = opts.findings.filter((f) => activeRecurrenceKeys.has(f.recurrenceKey)).length;
  const recurringFindings = opts.findings.filter(
    (f) =>
      typeof f.firstSeenGeneration === "number" &&
      typeof f.lastSeenGeneration === "number" &&
      f.firstSeenGeneration < f.lastSeenGeneration
  ).length;

  const backPropagationRate = generalizableFindings === 0 ? null : promotedFindings / generalizableFindings;

  // Cost inputs: read ONLY from checked-in telemetry files (DIR-126-D/E schema v2).
  let contentAgentMs = 0;
  let sawContentAgentMs = false;
  let tokenTotal: number | null = null;
  let sawToken = false;
  for (const tf of opts.telemetryFiles ?? []) {
    const abs = path.resolve(opts.cwd ?? process.cwd(), tf);
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch {
      unknownFields.push(`telemetry-unreadable:${tf}`);
      continue;
    }
    const rec = data as Record<string, unknown>;
    if (typeof rec.contentAgentMs === "number") {
      contentAgentMs += rec.contentAgentMs;
      sawContentAgentMs = true;
    }
    if (typeof rec.tokenUsage === "number") {
      tokenTotal = (tokenTotal ?? 0) + rec.tokenUsage;
      sawToken = true;
    }
  }

  const recurrenceWasteAgentMinutes: MetricsReport["recurrenceWasteAgentMinutes"] = sawContentAgentMs
    ? { value: Math.round(contentAgentMs / 60000), unknown: false }
    : { value: null, unknown: true };
  if (!sawContentAgentMs) unknownFields.push("agent-minutes (contentAgentMs) absent from canonical telemetry");
  const tokenDelta: MetricsReport["tokenDelta"] = sawToken ? { value: tokenTotal, unknown: false } : { value: null, unknown: true };
  if (!sawToken) unknownFields.push("token delta absent from canonical telemetry");

  return {
    schemaVersion: BACKPROPAGATE_SCHEMA_VERSION,
    totalFindings,
    generalizableFindings,
    promotedFindings,
    backPropagationRate,
    recurringFindings,
    recurrenceWasteAgentMinutes,
    tokenDelta,
    unknownFields,
  };
}

// ── Selftest ─────────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases", collectFailures: true, dumpFailuresJson: true });
  const check = st.check;

  const redTask = [
    "### AC coverage mapping (DIR-117 mechanism-claim wiring)",
    "- **AC1 (…):** CLAIM: x.",
    "- **AC7 (diff-minimality: fix introduces zero new agent() dispatches):** CLAIM: y.",
    "## Acceptance Criteria",
    "- [x] item one",
    "- [x] item two",
    "- [x] item three",
    "- [x] item four",
    "- [x] item five",
    "- [x] item six",
  ].join("\n");
  const greenTask = [
    "### AC coverage mapping (DIR-117 mechanism-claim wiring)",
    "- **AC1:** CLAIM: x.",
    "- **AC2:** CLAIM: y.",
    "## Acceptance Criteria",
    "- [x] one",
    "- [x] two",
  ].join("\n");
  const ambiguousTask = [
    "## Acceptance Criteria",
    "- [x] one",
    "- [x] two",
  ].join("\n");

  const det: DetectorCandidate = { detectorId: "det-ac-coverage-citations", recurrenceKey: "ac7-checklist-missing", rule: "detectAcCoverageCitations", stage: "PlanCheck" };
  const cal = proveDetector(det, { red: [redTask], green: [greenTask], ambiguous: [ambiguousTask] });
  check("calibration-ok", cal.ok, `redHitRate=${cal.redHitRate} fpRate=${cal.falsePositiveRate}`);
  check("red-caught", cal.red[0].caught, cal.red[0].detail);

  // classify: M208-style eligible finding (task file exists at PlanCheck).
  const eligible: FindingEnvelope = {
    schemaVersion: "1",
    findingId: "55016c0b",
    recurrenceKey: "ac7-checklist-missing",
    observerStage: "ProposalReview",
    subsystem: "Proposal-Acceptance-Criteria-wiring",
    claimRef: "AC coverage mapping",
    severity: "major",
    blocking: false,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { "tasks/gap-build-phase-null-result-not-gated.md": sha256OfString("fixture") },
    firstSeenGeneration: 0,
    lastSeenGeneration: 1,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const stageFacts: StageFacts = {
    // The finalized "## Acceptance Criteria" checklist + "### AC coverage mapping" exist at
    // PlanCheck onward (a PlanCheck artifact), NOT at Proposal — so the earliest detectable stage
    // is PlanCheck and promotion to the PlanCheck detector is eligible.
    PlanCheck: ["tasks/gap-build-phase-null-result-not-gated.md"],
    Verify: ["tasks/gap-build-phase-null-result-not-gated.md"],
    Build: ["tasks/gap-build-phase-null-result-not-gated.md"],
  };
  const cls = classifyFinding(eligible, stageFacts, { targetStage: "PlanCheck" });
  check("m208-eligible", cls.promotionAllowed && cls.earliestDetectableStage === "PlanCheck", JSON.stringify(cls.rejectionReasons));
  check("m208-generalization", cls.generalization === "profile", cls.generalization);

  // classify: M192 runtime-only Build-null finding — promotion to PlanCheck REJECTED (AC1).
  const runtimeOnly: FindingEnvelope = {
    schemaVersion: "1",
    findingId: "m192-build-null",
    recurrenceKey: "build-null-result-accepted-as-success",
    observerStage: "Audit",
    subsystem: "Execute feedback-integrity",
    claimRef: "M192",
    severity: "blocker",
    blocking: true,
    everBlocking: true,
    evidence: [],
    materialInputHashes: { buildRuntimeResult: sha256OfString("null") },
    firstSeenGeneration: 0,
    lastSeenGeneration: 0,
    disposition: "backlog",
    resolution: null,
    generalization: "task-specific",
  };
  const runtimeFacts: StageFacts = {
    PlanCheck: ["tasks/M192.md"],
    Build: ["tasks/M192.md", "buildRuntimeResult"],
    Audit: ["tasks/M192.md", "buildRuntimeResult", "candidateCommit"],
  };
  const cls2 = classifyFinding(runtimeOnly, runtimeFacts, { targetStage: "PlanCheck" });
  check("m192-rejected", !cls2.promotionAllowed && cls2.rejectionReasons.some((r) => r.includes("does not exist at proposed earlier stage")), JSON.stringify(cls2.rejectionReasons));
  check("m192-earliest-build", cls2.earliestDetectableStage === "Build", String(cls2.earliestDetectableStage));

  // backpropagate: authorized owner activates; Audit cannot.
  const policy = createPolicyForSelfTest();
  const bpBad = backpropagate(policy, eligible, det, cal, {
    authorizer: { role: "Audit", id: "a1" },
    receipts: [],
  });
  check("audit-cannot-activate", !bpBad.ok, bpBad.reason);
  const bp = backpropagate(policy, eligible, det, cal, {
    authorizer: { role: "policy-owner", id: "p1" },
    receipts: [
      { receiptId: "r1", policyHash: policy.policyHash, recurrenceKey: "ac7-checklist-missing" },
      { receiptId: "r2", policyHash: policy.policyHash, recurrenceKey: "other-class" },
    ],
  });
  check("backpropagate-ok", bp.ok && bp.invalidation?.invalidated.length === 1, bp.reason);

  // controlFalsePositive (AC8).
  if (bp.ok && bp.activation.policyAfter) {
    const activePolicy = rebuildActivePolicy(policy, bp.activation.policyAfter, det, "policy-owner");
    const ctl = controlFalsePositive(activePolicy, det, {
      reason: "false positive on green corpus in M213",
      actor: "policy-owner",
      receipts: [{ receiptId: "r1", policyHash: activePolicy.policyHash, recurrenceKey: det.recurrenceKey }],
    });
    check("control-fp-ok", ctl.ok && ctl.revocation.ok && ctl.invalidation?.invalidated.length === 1, ctl.reason);
  }
  return st.report();
}

function createPolicyForSelfTest() {
  const policy: PolicyDocument = {
    schemaVersion: "1",
    policyVersion: "1",
    policyHash: "",
    profiles: {},
    activatedDetectors: [],
    history: [],
  };
  policy.policyHash = sha256OfString(JSON.stringify({ ...policy, policyHash: "" }));
  return policy;
}

function rebuildActivePolicy(base: PolicyDocument, newHash: string, det: DetectorCandidate, by: string): PolicyDocument {
  return {
    ...base,
    policyHash: newHash,
    activatedDetectors: [{ detectorId: det.detectorId, recurrenceKey: det.recurrenceKey, rule: det.rule, stage: det.stage, authorizedBy: by, authorizedAtMs: Date.now(), calibrationRef: null }],
  };
}

// ── CLI entry ─────────────────────────────────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "finding-backpropagate.ts — Prepare/Execute feedback back-propagation (gap-audit-findings-not-backpropagated-to-earlier-detectors)",
    "Usage:",
    "  node --experimental-strip-types finding-backpropagate.ts --classify '<{finding,stageFacts,targetStage?}>'",
    "  node --experimental-strip-types finding-backpropagate.ts --detect-ac-citations '<task-text-file>'",
    "  node --experimental-strip-types finding-backpropagate.ts --prove '<{detector,corpora}>'",
    "  node --experimental-strip-types finding-backpropagate.ts --backpropagate '<{policy,finding,detector,calibration,request}>'",
    "  node --experimental-strip-types finding-backpropagate.ts --control-fp '<{policy,detector,opts}>'",
    "  node --experimental-strip-types finding-backpropagate.ts --metrics '<{findings,policy,telemetryFiles?}>'",
    "  node --experimental-strip-types finding-backpropagate.ts --selftest",
    "",
    "Exit 0 on success / valid; exit 1 on validation failure (structured JSON on stdout).",
  ].join("\n");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  try {
    if (args.includes("--selftest")) return selftest() ? 0 : 1;

    if (args.includes("--classify")) {
      const { finding, stageFacts, targetStage } = parseJsonArg(args[args.indexOf("--classify") + 1]) as {
        finding: FindingEnvelope;
        stageFacts: StageFacts;
        targetStage?: string;
      };
      console.log(JSON.stringify(classifyFinding(finding, stageFacts, { targetStage })));
      return 0;
    }
    if (args.includes("--detect-ac-citations")) {
      const file = args[args.indexOf("--detect-ac-citations") + 1];
      const text = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      console.log(JSON.stringify(detectAcCoverageCitations(text)));
      return detectAcCoverageCitations(text).ok ? 0 : 1;
    }
    if (args.includes("--prove")) {
      const { detector, corpora } = parseJsonArg(args[args.indexOf("--prove") + 1]) as { detector: DetectorCandidate; corpora: Corpora };
      console.log(JSON.stringify(proveDetector(detector, corpora)));
      return proveDetector(detector, corpora).ok ? 0 : 1;
    }
    if (args.includes("--backpropagate")) {
      const { policy, finding, detector, calibration, request } = parseJsonArg(args[args.indexOf("--backpropagate") + 1]) as {
        policy: PolicyDocument;
        finding: FindingEnvelope;
        detector: DetectorCandidate;
        calibration: CalibrationResult;
        request: { authorizer: { role: string; id: string }; receipts: ReceiptPolicyBinding[]; note?: string };
      };
      console.log(JSON.stringify(backpropagate(policy, finding, detector, calibration, request)));
      return backpropagate(policy, finding, detector, calibration, request).ok ? 0 : 1;
    }
    if (args.includes("--control-fp")) {
      const { policy, detector, opts } = parseJsonArg(args[args.indexOf("--control-fp") + 1]) as {
        policy: PolicyDocument;
        detector: DetectorCandidate;
        opts: { reason: string; actor: string; receipts: ReceiptPolicyBinding[] };
      };
      console.log(JSON.stringify(controlFalsePositive(policy, detector, opts)));
      return controlFalsePositive(policy, detector, opts).ok ? 0 : 1;
    }
    if (args.includes("--metrics")) {
      const { findings, policy, telemetryFiles } = parseJsonArg(args[args.indexOf("--metrics") + 1]) as {
        findings: Array<Parameters<typeof reportBackpropagationMetrics>[0]["findings"][number]>;
        policy: PolicyDocument;
        telemetryFiles?: string[];
      };
      console.log(JSON.stringify(reportBackpropagationMetrics({ findings, policy, telemetryFiles })));
      return 0;
    }

    usage();
    console.log(JSON.stringify({ ok: true, usage: "finding-backpropagate.ts" }));
    return 0;
  } catch (err) {
    const e = err as Error;
    console.log(JSON.stringify({ ok: false, code: "finding-backpropagate-error", message: e.message }));
    return 1;
  }
}

if (process.argv[1] != null && process.argv[1].endsWith("finding-backpropagate.ts")) {
  process.exitCode = main(process.argv);
}
