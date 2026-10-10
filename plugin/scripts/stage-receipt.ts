// stage-receipt.ts — DIR-124-B2 (M254): the versioned stage-receipt contract module.
// ONE authoritative schema family — FindingEnvelope, StageEvent, StageReceiptEnvelope,
// ReceiptValidationResult — guarded by a single CONTRACT_SCHEMA_VERSION const; a schema change is
// a new envelope version, never silent field drift (DD3). This module is the durable, hash-bound
// cross-stage contract: receipts bind base/candidate commits, workflow source path/hash/commit,
// runtime generation, and every material input hash (DD4/DD5), and fail closed on any of the
// eight AC6 hazard classes (wrong base, wrong candidate, modified Plan, stale named-workflow
// materialization, wrong runtime generation, missing artifact, moved candidate commit, tampered
// receipt).
//
// Byte-identical mirror: plugin/scripts/stage-receipt.ts
//
// Zero npm dependencies — Node.js built-ins only (node:fs, node:path, node:crypto,
// node:child_process). No build step; dispatched exclusively via the established
// `node --experimental-strip-types <abs path>/stage-receipt.ts <mode>` agent-dispatch pattern.
//
// Imports, never re-declares: the A1 20-field StageEvent shape and the stage/outcome/wait/
// isolation/dispatch VALUE vocabularies come from the sibling workflow-event-schema.mjs (A1 stays
// the single source of those constants — B2 owns only the field-set superset). The
// {hash, path, candidateCommit} Build evidence-manifest reference shape from
// build-evidence-manifest.ts's manifestRefForReceipt is consumed structurally, not duplicated.
//
// Export surfaces:
//   - Constants: CONTRACT_SCHEMA_VERSION
//   - Types: FindingEnvelope, StageEvent, StageReceiptEnvelope, ReceiptValidationResult,
//     BindReceiptInput, MigratePrepareLedgerResult
//   - Functions: buildReceiptEnvelope(input), bindReceipt(receipt, binding), validateReceipt(receipt),
//     validateEvidenceManifestRef(ref), rejectDuplicateAuthority(receipt), migratePrepareLedger(entry),
//     selftest()
//   - CLI: --validate-receipt '<json>' [--expected '<json>'], --evidence-manifest-ref '<{path,sha256}>',
//     --migrate-prepare-ledger '<entry-json>', --selftest, --json
//
// Fail-closed ReceiptValidationResult codes (ONE distinct code per AC6 hazard):
//   wrong-base, wrong-candidate, modified-plan, stale-workflow-materialization,
//   wrong-runtime-generation, missing-artifact, moved-candidate-commit, tampered-receipt,
//   empty-material-inputs, plus structural codes: receipt-not-object, schema-version-mismatch,
//   receipt-unknown-field (forward-compat structural drift).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { createSelftest, parseJsonArg, git, gitLastCommitForPath, serializeSortedJson } from "./gate-script-base.ts";
import {
  SCHEMA_VERSION as A1_SCHEMA_VERSION,
  VALID_STAGES,
  VALID_OUTCOMES,
  VALID_WAIT_REASONS,
  VALID_ISOLATION_MODES,
  VALID_DISPATCH_MODES,
  validateEvent,
} from "./workflow-event-schema.mjs";

// ── Contract version ──────────────────────────────────────────────────────────────────────────────────

/** Version of the envelope family. A schema change bumps this; never silent field drift (DD3). */
export const CONTRACT_SCHEMA_VERSION = "1";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * A durable cross-stage finding. Occurrence identity + stable recurrenceKey (the
 * `sha256(taskId::code).slice(0,12)` precedent), observer/earliest-detectable stage, subsystem/claim
 * reference, severity/blocking/everBlocking, bounded evidence references, material input hashes,
 * first/last generation, disposition/resolution, and the task-specific|profile|global
 * generalization. Generalization is DESCRIPTIVE METADATA — reuse is decided solely by recurrence
 * key + material input hashes, never by the generalization label.
 */
export interface FindingEnvelope {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  findingId: string;
  recurrenceKey: string;
  observerStage: string;
  subsystem: string;
  claimRef: string;
  severity: string;
  blocking: boolean;
  everBlocking: boolean;
  evidence: Array<{ path: string; sha256: string }>;
  materialInputHashes: Record<string, string>;
  firstSeenGeneration: number;
  lastSeenGeneration: number;
  disposition: string;
  resolution: string | null;
  generalization: "task-specific" | "profile" | "global";
  sourceRecordId?: string;
  sourceHashes?: Record<string, string>;
}

/**
 * The durable journal event: a field-for-field SUPERSET of the LANDED A1 20-field schema plus the
 * binding/provenance fields this contract needs. The 20 A1 fields are validated by the imported
 * validateEvent (A1 stays the single source of the 20-field shape); the superset fields are
 * validated here.
 */
export interface StageEvent {
  // A1 20-field schema (imported vocabulary — validated by validateEvent)
  schemaVersion: typeof A1_SCHEMA_VERSION;
  runId: string;
  candidateId: string;
  taskId: string;
  stage: string;
  attempt: number;
  timing: { queuedAtMs: number | null; startedAtMs: number | null; endedAtMs: number | null };
  agentLabel: string;
  commandIdentity: string | null;
  executionCwd: string;
  worktreePath: string | null;
  baseCommit: string | null;
  candidateCommit: string | null;
  outcome: string | null;
  waitReason: string | null;
  resourceClaim: string | null;
  observedWrites: string[];
  isolationMode: string | null;
  dispatchMode: string | null;
  recordedAtMs: number;
  // B2 binding/provenance superset
  eventId: string;
  workflowSourcePath: string;
  workflowSourceHash: string;
  workflowSourceCommit: string;
  runtimeGeneration: string;
  materialInputHashes: Record<string, string>;
  receiptRef: string | null;
  migratedFrom?: string | null;
  sourceRecordId?: string | null;
  sourceHashes?: Record<string, string> | null;
  // DIR-118 inert extension fields (declared but never read/acted on — DD10)
  landedAwaitingWiring?: never;
  postLandAuditRef?: string | null;
}

/**
 * The hash-bound cross-stage receipt. Identity + binding fields. A receipt with empty
 * materialInputHashes is NOT reusable (validateReceipt returns empty-material-inputs). The receipt
 * NEVER copies authoritative task/Proposal/charter/Plan content — only hashes + a bounded
 * evidence-manifest reference (DD8 / AC10).
 */
export interface StageReceiptEnvelope {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  receiptId: string;
  runId: string;
  candidateId: string;
  taskIds: string[];
  attempt: number;
  stage: string;
  outcome: string | null;
  baseCommit: string;
  candidateCommit: string | null;
  workflowSourcePath: string;
  workflowSourceHash: string;
  workflowSourceCommit: string;
  runtimeGeneration: string;
  materialInputHashes: Record<string, string>;
  evidenceManifestRef: { hash: string; path: string; candidateCommit: string } | null;
  recordedAtMs: number;
  contentHash: string;
  // DIR-118 inert extension fields (declared but never read/acted on — DD10)
  landedAwaitingWiring?: never;
  postLandAuditRef?: string | null;
}

/** Result of a fail-closed receipt validation. ok:true means ALL bindings hold. */
export interface ReceiptValidationResult {
  ok: boolean;
  code: string;
  detail: string;
}

/** Structural input for buildReceiptEnvelope. RunIdentity-shaped, but structural (DD12). */
export interface BindReceiptInput {
  runId: string;
  candidateId: string;
  taskIds: string[];
  attempt: number;
  stage: string;
  outcome?: string | null;
  baseCommit: string;
  candidateCommit?: string | null;
  workflowSourcePath: string;
  runtimeGeneration: string;
  materialInputHashes: Record<string, string>;
  evidenceManifestRef?: { hash: string; path: string; candidateCommit: string } | null;
  cwd?: string;
}

/** One-way proposal-ledger.json entry → FindingEnvelope adapter result. */
export interface MigratePrepareLedgerResult {
  ok: boolean;
  finding?: FindingEnvelope;
  code?: string;
  detail?: string;
}

// ── Error helper ─────────────────────────────────────────────────────────────────────────────────────

function receiptError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// ── sha256 helpers ───────────────────────────────────────────────────────────────────────────────────

export function sha256OfBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256OfString(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return sha256OfBuffer(buf);
}

// ── Deterministic canonical serialization (A1 emitEvent sorted-copy precedent) ──────────────────────

/**
 * Deterministic single-line JSON: top-level keys sorted; nested plain objects (timing,
 * materialInputHashes, evidenceManifestRef, sourceHashes) serialized with their own keys sorted, so
 * identical receipts serialize byte-identically regardless of key insertion order. Never lossy.
 *
 * The body now lives ONCE, in gate-script-base.ts's `serializeSortedJson` (routine
 * `semantic-dedup-scan`, finding `serializeidentity-serializereceipt`, runId
 * `semantic-dedup-scan-1791631645924` — its sibling call site is run-identity.ts's
 * `serializeIdentity`). The name stays exported because workflow-journal.ts and the receipt
 * contentHash both address it; the function is now a delegation, not a second implementation.
 */
export function serializeReceipt(receipt: StageReceiptEnvelope): string {
  return serializeSortedJson(receipt);
}

// ── git helpers — the shared fail-closed `git(args, cwd): GitResult` and `gitLastCommitForPath` now
// live in gate-script-base.ts. This file's byte-identical private `git()` and `deriveWorkflowSourceCommit`
// copies were removed (routine `semantic-dedup-scan`, finding `ident-fcdeccc5d81b054c`, runId
// `semantic-dedup-scan-1791142275270`) — the same extraction the sibling finding `git-helper-collector-gate`
// executed for build-evidence-collector.ts / build-evidence-gate.ts. ───────────────────────────────

function deriveBaseCommit(cwd: string): string {
  const result = git(["rev-parse", "HEAD"], cwd);
  if (!result.ok) {
    throw receiptError(
      "base-commit-unresolved",
      `git rev-parse HEAD failed in ${cwd} — an unbindable receipt is a validation failure`
    );
  }
  return result.stdout;
}

// ── buildReceiptEnvelope / bindReceipt (AC2) ───────────────────────────────────────────────────────

/**
 * Build a hash-bound StageReceiptEnvelope. Mechanically binds base/candidate commits, workflow
 * source path/hash/commit, runtime generation, and every material input hash. A receipt with empty
 * materialInputHashes is not reusable (validateReceipt → empty-material-inputs).
 */
export function buildReceiptEnvelope(input: BindReceiptInput): StageReceiptEnvelope {
  if (!input || typeof input !== "object") throw receiptError("input-not-object", "buildReceiptEnvelope requires an input object");
  if (typeof input.runId !== "string" || input.runId.trim() === "") throw receiptError("invalid-run-id", "runId must be a non-empty string");
  if (typeof input.candidateId !== "string" || input.candidateId.trim() === "") throw receiptError("invalid-candidate-id", "candidateId must be a non-empty string");
  if (!Array.isArray(input.taskIds) || input.taskIds.length === 0) throw receiptError("invalid-task-ids", "taskIds must be a non-empty array");
  if (!Number.isInteger(input.attempt) || input.attempt < 1) throw receiptError("invalid-attempt", `attempt must be a positive integer, got ${JSON.stringify(input.attempt)}`);
  if (typeof input.stage !== "string" || input.stage.trim() === "") throw receiptError("invalid-stage", "stage must be a non-empty string");
  if (typeof input.workflowSourcePath !== "string" || input.workflowSourcePath.trim() === "") {
    throw receiptError("invalid-workflow-source-path", "workflowSourcePath must be a non-empty string");
  }
  if (typeof input.baseCommit !== "string" || input.baseCommit.trim() === "") throw receiptError("invalid-base-commit", "baseCommit must be a non-empty string");
  if (input.materialInputHashes == null || typeof input.materialInputHashes !== "object" || Array.isArray(input.materialInputHashes)) {
    throw receiptError("invalid-material-input-hashes", "materialInputHashes must be an object");
  }

  const cwd = input.cwd || process.cwd();

  // Derive workflow source hash + commit (DD4 — hashes only, never content)
  const workflowSourceAbs = path.resolve(cwd, input.workflowSourcePath);
  if (!fs.existsSync(workflowSourceAbs)) {
    throw receiptError("workflow-source-missing", `workflow source not found: ${input.workflowSourcePath}`);
  }
  const workflowSourceHash = sha256File(workflowSourceAbs);
  const workflowSourceCommit = gitLastCommitForPath(cwd, input.workflowSourcePath);
  const runtimeGeneration = input.runtimeGeneration || sha256OfString(workflowSourceHash).slice(0, 12);

  const candidateCommit = input.candidateCommit ?? null;
  const receiptId = `${input.runId}::${input.stage}::${input.attempt}`;
  const recordedAtMs = Date.now();

  const receipt: StageReceiptEnvelope = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    receiptId,
    runId: input.runId,
    candidateId: input.candidateId,
    taskIds: [...input.taskIds],
    attempt: input.attempt,
    stage: input.stage,
    outcome: input.outcome ?? null,
    baseCommit: input.baseCommit,
    candidateCommit,
    workflowSourcePath: input.workflowSourcePath,
    workflowSourceHash,
    workflowSourceCommit,
    runtimeGeneration,
    materialInputHashes: { ...input.materialInputHashes },
    evidenceManifestRef: input.evidenceManifestRef ?? null,
    recordedAtMs,
    contentHash: "",
  };

  // contentHash binds every canonical field — tamper detection (AC6 hazard: tampered-receipt)
  const canonical = serializeReceipt(receipt);
  receipt.contentHash = sha256OfString(canonical);
  return receipt;
}

/** Pure, immutable re-derivation: returns a NEW receipt with candidateCommit set (SOLE bind site). */
export function bindReceipt(receipt: StageReceiptEnvelope, binding: { candidateCommit: string }): StageReceiptEnvelope {
  if (typeof binding?.candidateCommit !== "string" || binding.candidateCommit.trim() === "") {
    throw receiptError("invalid-candidate-commit", "candidateCommit must be a non-empty commit hash");
  }
  const next: StageReceiptEnvelope = { ...receipt, candidateCommit: binding.candidateCommit, contentHash: "" };
  const canonical = serializeReceipt(next);
  next.contentHash = sha256OfString(canonical);
  return next;
}

// ── validateReceipt (AC3 — the 8-hazard fail-closed matrix) ───────────────────────────────────────

const HAZARD_FIELDS = [
  "schemaVersion",
  "receiptId",
  "runId",
  "candidateId",
  "taskIds",
  "attempt",
  "stage",
  "outcome",
  "baseCommit",
  "candidateCommit",
  "workflowSourcePath",
  "workflowSourceHash",
  "workflowSourceCommit",
  "runtimeGeneration",
  "materialInputHashes",
  "evidenceManifestRef",
  "recordedAtMs",
  "contentHash",
] as const;

function okResult(): ReceiptValidationResult {
  return { ok: true, code: "ok", detail: "receipt is valid and bound to its run" };
}

function failResult(code: string, detail: string): ReceiptValidationResult {
  return { ok: false, code, detail };
}

/**
 * Fail-closed validation of a StageReceiptEnvelope. Returns ONE distinct code per AC6 hazard:
 *   wrong-base, wrong-candidate, modified-plan, stale-workflow-materialization,
 *   wrong-runtime-generation, missing-artifact, moved-candidate-commit, tampered-receipt,
 *   empty-material-inputs.
 * An `expected` object (optional) supplies the current candidate state: baseCommit,
 * candidateCommit, workflowSourceHash, runtimeGeneration, materialInputHashes. When provided, the
 * corresponding hazard checks are active; when absent, only structural + tamper + empty-input
 * checks run.
 */
export function validateReceipt(
  receipt: unknown,
  expected?: {
    baseCommit?: string;
    candidateCommit?: string;
    workflowSourceHash?: string;
    runtimeGeneration?: string;
    materialInputHashes?: Record<string, string>;
  }
): ReceiptValidationResult {
  if (receipt == null || typeof receipt !== "object" || Array.isArray(receipt)) {
    return failResult("receipt-not-object", "receipt must be a non-null JSON object");
  }
  const rec = receipt as Record<string, unknown>;

  for (const field of HAZARD_FIELDS) {
    if (!(field in rec)) {
      return failResult("receipt-unknown-field", `receipt missing required field "${field}"`);
    }
  }

  if (rec.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    return failResult("schema-version-mismatch", `schemaVersion "${String(rec.schemaVersion)}" is not "${CONTRACT_SCHEMA_VERSION}"`);
  }

  const material = rec.materialInputHashes as Record<string, unknown>;
  if (material == null || typeof material !== "object" || Object.keys(material).length === 0) {
    return failResult("empty-material-inputs", "a receipt with empty materialInputHashes is not reusable (non-vacuous receipts only)");
  }

  // ── tampered-receipt: recompute contentHash over canonical fields ──────────────────────────────
  const expectedHash = String(rec.contentHash);
  const recForCanonical = { ...rec, contentHash: "" } as unknown as StageReceiptEnvelope;
  const recomputed = sha256OfString(serializeReceipt(recForCanonical));
  if (recomputed !== expectedHash) {
    return failResult("tampered-receipt", `contentHash mismatch: recorded ${expectedHash}, recomputed ${recomputed} — receipt bytes were modified`);
  }

  // ── bindings vs expected current state ─────────────────────────────────────────────────────────
  if (expected) {
    if (expected.baseCommit != null && rec.baseCommit !== expected.baseCommit) {
      return failResult("wrong-base", `baseCommit ${String(rec.baseCommit)} does not match current base ${expected.baseCommit}`);
    }
    if (expected.candidateCommit != null) {
      if (rec.candidateCommit == null) {
        // wrong-candidate (AC6 hazard): the receipt was never bound to the candidate the current
        // run expects — it cannot prove THIS candidate.
        return failResult("wrong-candidate", "expected a bound candidateCommit but receipt has null — the receipt does not bind the run's candidate");
      }
      if (rec.candidateCommit !== expected.candidateCommit) {
        // moved-candidate-commit (AC6 hazard): the candidate was bound, but the commit moved since.
        return failResult("moved-candidate-commit", `candidateCommit moved: receipt ${String(rec.candidateCommit)} != current ${expected.candidateCommit}`);
      }
    }
    if (expected.workflowSourceHash != null && rec.workflowSourceHash !== expected.workflowSourceHash) {
      return failResult("stale-workflow-materialization", `workflowSourceHash ${String(rec.workflowSourceHash)} != installed ${expected.workflowSourceHash} — a stale materialized workflow body cannot be reused`);
    }
    if (expected.runtimeGeneration != null && rec.runtimeGeneration !== expected.runtimeGeneration) {
      return failResult("wrong-runtime-generation", `runtimeGeneration ${String(rec.runtimeGeneration)} != current ${expected.runtimeGeneration}`);
    }
    if (expected.materialInputHashes != null) {
      const recMat = rec.materialInputHashes as Record<string, string>;
      for (const [k, v] of Object.entries(expected.materialInputHashes)) {
        if (recMat[k] !== v) {
          const isPlan = k.includes("plan") || k.endsWith("Plan") || k.toLowerCase().includes("plan");
          const code = isPlan ? "modified-plan" : "material-input-changed";
          return failResult(code, `material input "${k}" hash changed: receipt ${String(recMat[k])} != current ${v}`);
        }
      }
    }
  }

  // ── missing-artifact: evidence-manifest ref hash-validates against the named file ──────────────
  const ref = rec.evidenceManifestRef as { path?: string; sha256?: string; hash?: string } | null;
  if (ref && typeof ref.path === "string" && ref.path.trim() !== "") {
    const refHash = ref.hash || ref.sha256;
    if (!refHash) {
      return failResult("missing-artifact", "evidenceManifestRef present but missing hash");
    }
    const abs = path.resolve(process.cwd(), ref.path);
    if (!fs.existsSync(abs)) {
      return failResult("missing-artifact", `evidence manifest not found at ${ref.path}`);
    }
    const actual = sha256File(abs);
    if (actual !== refHash) {
      return failResult("missing-artifact", `evidence manifest hash mismatch at ${ref.path}: expected ${refHash}, got ${actual}`);
    }
  }

  return okResult();
}

// ── validateEvidenceManifestRef (AC4) ──────────────────────────────────────────────────────────────

/**
 * Hash-validates a bounded Build evidence-manifest reference ({path, sha256} or {path, hash})
 * against the file it names, WITHOUT copying authoritative content. Fails closed on a
 * missing/mismatched file with a distinct code.
 */
export function validateEvidenceManifestRef(
  ref: { path: string; sha256?: string; hash?: string },
  cwd?: string
): ReceiptValidationResult {
  if (!ref || typeof ref !== "object") return failResult("ref-not-object", "evidence-manifest ref must be an object");
  if (typeof ref.path !== "string" || ref.path.trim() === "") return failResult("ref-path-missing", "evidence-manifest ref missing path");
  const refHash = ref.hash || ref.sha256;
  if (!refHash || typeof refHash !== "string" || refHash.trim() === "") {
    return failResult("ref-hash-missing", "evidence-manifest ref missing sha256/hash");
  }
  const abs = path.resolve(cwd || process.cwd(), ref.path);
  if (!fs.existsSync(abs)) {
    return failResult("missing-artifact", `evidence manifest not found at ${ref.path}`);
  }
  const actual = sha256File(abs);
  if (actual !== refHash) {
    return failResult("missing-artifact", `evidence manifest hash mismatch at ${ref.path}: expected ${refHash}, got ${actual}`);
  }
  return okResult();
}

// ── rejectDuplicateAuthority (AC4 — permanent negative control, extends validateManifestShape's
//    no-second-authority precedent) ─────────────────────────────────────────────────────────────────

const FORBIDDEN_CONTENT_FIELDS = [
  "requirementText",
  "acText",
  "proposalText",
  "charterText",
  "planText",
  "requirement",
  "criterion",
  "acceptanceCriteriaBody",
];

/**
 * Rejects a receipt (or finding) that embeds copied authoritative task/Proposal/charter/Plan
 * content. Receipts store hashes + a bounded evidence-manifest reference ONLY (DD8/AC10). This is a
 * permanent negative control — a fixture embedding copied requirement text must fail.
 */
export function rejectDuplicateAuthority(obj: unknown): ReceiptValidationResult {
  if (obj == null || typeof obj !== "object") return failResult("obj-not-object", "duplicate-authority check requires an object");
  const str = JSON.stringify(obj);
  for (const field of FORBIDDEN_CONTENT_FIELDS) {
    if (str.includes(`"${field}"`)) {
      return failResult("duplicate-authority", `object embeds copied authoritative content field "${field}" — the task file is the single source of truth`);
    }
  }
  return okResult();
}

// ── migratePrepareLedger (AC6/AC9 — one-way proposal-ledger.json entry → FindingEnvelope) ──────────

const LEDGER_TO_FINDING: Array<[string, string]> = [
  ["id", "findingId"],
  ["subsystem", "subsystem"],
  ["claimRef", "claimRef"],
  ["severity", "severity"],
  ["disposition", "disposition"],
  ["rootCauseKey", "recurrenceKey"],
  ["firstSeenRound", "firstSeenGeneration"],
  ["lastSeenRound", "lastSeenGeneration"],
];

/**
 * One-way adapter: proposal-ledger.json entry → FindingEnvelope. Preserves id/subsystem/claimRef/
 * severity/blocking/everBlocking/disposition/rootCauseKey/firstSeenRound/lastSeenRound + source
 * hashes. Never a reverse writer — a source that cannot be mapped errors; the adapter never edits
 * proposal-ledger.json.
 */
export function migratePrepareLedger(entry: Record<string, unknown>, opts?: { sourceRecordId?: string; sourceHashes?: Record<string, string> }): MigratePrepareLedgerResult {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, code: "entry-not-object", detail: "proposal-ledger entry must be an object" };
  }
  const finding: Record<string, unknown> = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    findingId: "",
    recurrenceKey: "",
    observerStage: "Receipt",
    subsystem: "",
    claimRef: "",
    severity: "info",
    blocking: false,
    everBlocking: false,
    evidence: [],
    materialInputHashes: {},
    firstSeenGeneration: 0,
    lastSeenGeneration: 0,
    disposition: "",
    resolution: null,
    generalization: "task-specific",
  };

  for (const [srcKey, dstKey] of LEDGER_TO_FINDING) {
    if (entry[srcKey] !== undefined) {
      finding[dstKey] = entry[srcKey];
    }
  }

  if (entry.evidence !== undefined) {
    const ev = entry.evidence;
    if (typeof ev === "string") {
      finding.evidence = [{ path: ev, sha256: "" }];
    } else if (Array.isArray(ev)) {
      finding.evidence = ev.map((e) => {
        if (typeof e === "string") return { path: e, sha256: "" };
        const o = e as Record<string, unknown>;
        return { path: String(o.path ?? ""), sha256: String(o.sha256 ?? o.hash ?? "") };
      });
    }
  }

  // blocking / everBlocking (accept booleans or "true"/"false" strings)
  if (entry.blocking !== undefined) finding.blocking = entry.blocking === true || entry.blocking === "true";
  if (entry.everBlocking !== undefined) finding.everBlocking = entry.everBlocking === true || entry.everBlocking === "true";

  // Resolution / summary mapping
  if (entry.resolution !== undefined) finding.resolution = entry.resolution;
  if (entry.status !== undefined && finding.resolution === null) {
    finding.resolution = entry.status === "resolved" ? "resolved" : entry.status;
  }

  if (opts?.sourceRecordId) finding.sourceRecordId = opts.sourceRecordId;
  if (opts?.sourceHashes) finding.sourceHashes = { ...opts.sourceHashes };

  if (!finding.findingId) return { ok: false, code: "entry-missing-id", detail: "proposal-ledger entry missing id" };
  if (!finding.recurrenceKey) {
    // derive a stable recurrenceKey from taskId::code when absent (same precedent as
    // proposal-convergence.ts: sha256(taskId::code).slice(0,12))
    finding.recurrenceKey = sha256OfString(`${String(entry.taskId ?? "")}::${String(entry.id ?? "")}`).slice(0, 12);
  }

  return { ok: true, finding: finding as unknown as FindingEnvelope };
}

// ── canReuseFinding (AC1 — recurrence does not permit reuse when material input hashes differ) ────

/**
 * Reuse decision for a FindingEnvelope: a prior finding may be reused for a new occurrence ONLY when
 * the stable recurrenceKey matches AND every material input hash matches. The
 * task-specific|profile|global generalization is DESCRIPTIVE METADATA and is never a reuse
 * predicate. Returns a fail-closed ReceiptValidationResult: ok:true means the prior finding is
 * reusable for the current occurrence; a same-recurrenceKey-different-material-input-hash fixture
 * must fail (B2-CLAIM-14 negative control).
 */
export function canReuseFinding(
  prior: unknown,
  current: { recurrenceKey: string; materialInputHashes: Record<string, string> }
): ReceiptValidationResult {
  if (prior == null || typeof prior !== "object" || Array.isArray(prior)) {
    return failResult("prior-not-object", "prior finding must be a non-null FindingEnvelope object");
  }
  const p = prior as Record<string, unknown>;
  if (typeof p.recurrenceKey !== "string") {
    return failResult("prior-missing-recurrence-key", "prior finding missing recurrenceKey");
  }
  if (p.materialInputHashes == null || typeof p.materialInputHashes !== "object") {
    return failResult("prior-missing-material-hashes", "prior finding missing materialInputHashes");
  }
  if (typeof current?.recurrenceKey !== "string") {
    return failResult("current-missing-recurrence-key", "current occurrence missing recurrenceKey");
  }
  if (current.materialInputHashes == null || typeof current.materialInputHashes !== "object") {
    return failResult("current-missing-material-hashes", "current occurrence missing materialInputHashes");
  }

  if (p.recurrenceKey !== current.recurrenceKey) {
    return failResult("recurrence-key-mismatch", `recurrenceKey ${String(p.recurrenceKey)} != ${current.recurrenceKey} — different finding, no reuse`);
  }

  const priorMat = p.materialInputHashes as Record<string, string>;
  const curMat = current.materialInputHashes;
  const priorKeys = Object.keys(priorMat).sort();
  const curKeys = Object.keys(curMat).sort();
  if (priorKeys.length !== curKeys.length) {
    return failResult("material-input-hash-mismatch", "material input hash sets differ in size — reuse not permitted");
  }
  for (let i = 0; i < curKeys.length; i++) {
    if (curKeys[i] !== priorKeys[i]) {
      return failResult("material-input-hash-mismatch", `material input key set differs: prior ${priorKeys.join(",")} vs current ${curKeys.join(",")}`);
    }
    if (priorMat[curKeys[i]] !== curMat[curKeys[i]]) {
      return failResult(
        "material-input-hash-mismatch",
        `material input "${curKeys[i]}" hash differs (prior ${priorMat[curKeys[i]]} vs current ${curMat[curKeys[i]]}) — a same-recurrenceKey finding with different material inputs is NOT reusable`
      );
    }
  }

  return okResult();
}

// ── Selftest ────────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases", collectFailures: true, dumpFailuresJson: true });
  const check = st.check;

  const savedCwd = process.cwd();
  // gap-stage-receipt-selftest-mkdtemp-requires-tmp-dir: `tmp/` is gitignored runtime state —
  // present in the primary checkout but ABSENT in a fresh worktree/CI checkout. mkdtempSync
  // under a non-existent parent throws ENOENT (round-52 suite-fix worktree). Ensure it exists.
  const tmpParent = path.join(savedCwd, "tmp");
  fs.mkdirSync(tmpParent, { recursive: true });
  const fixtureDir = fs.mkdtempSync(path.join(tmpParent, "stage-receipt-selftest-"));
  try {
    fs.mkdirSync(path.join(fixtureDir, "plugin", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "plugin", "workflows", "execute-milestone.js"), "# fixture\n");
    const materialPath = path.join(fixtureDir, "tasks", "T-1.md");
    fs.writeFileSync(materialPath, "# T-1\n");
    execSync("git init -q", { cwd: fixtureDir });
    execSync("git config user.email fixture@example.com", { cwd: fixtureDir });
    execSync("git config user.name fixture", { cwd: fixtureDir });
    execSync("git add -A", { cwd: fixtureDir });
    execSync("git commit -q -m fixture", { cwd: fixtureDir });
    process.chdir(fixtureDir);

    const baseCommit = deriveBaseCommit(fixtureDir);
    const input: BindReceiptInput = {
      runId: "M254::DIR-124-B2::1",
      candidateId: "M254",
      taskIds: ["DIR-124-B2"],
      attempt: 1,
      stage: "Build",
      baseCommit,
      workflowSourcePath: "plugin/workflows/execute-milestone.js",
      materialInputHashes: { "tasks/T-1.md": sha256File(materialPath) },
      cwd: fixtureDir,
    };
    const receipt = buildReceiptEnvelope(input);
    check("build-sets-contentHash", typeof receipt.contentHash === "string" && receipt.contentHash.length === 64, `contentHash=${receipt.contentHash.slice(0, 12)}…`);

    // valid receipt validates ok (no expected state → structural + tamper + non-vacuous)
    const v1 = validateReceipt(receipt);
    check("validate-valid-receipt", v1.ok, `code=${v1.code}`);

    // tampered receipt fails closed
    const tampered = { ...receipt, baseCommit: "deadbeef" };
    const v2 = validateReceipt(tampered);
    check("validate-tampered", !v2.ok && v2.code === "tampered-receipt", `code=${v2.code}`);

    // empty materialInputHashes not reusable
    const empty = { ...receipt, materialInputHashes: {}, contentHash: "" };
    const v3 = validateReceipt(empty);
    check("validate-empty-material", !v3.ok && v3.code === "empty-material-inputs", `code=${v3.code}`);

    // wrong-base via expected
    const v4 = validateReceipt(receipt, { baseCommit: "different" });
    check("validate-wrong-base", !v4.ok && v4.code === "wrong-base", `code=${v4.code}`);

    // wrong candidate commit via expected
    const v5 = validateReceipt(receipt, { candidateCommit: "beef0000" });
    check("validate-wrong-candidate", !v5.ok && v5.code === "wrong-candidate", `code=${v5.code}`);

    // bind + validate against matching candidate
    const bound = bindReceipt(receipt, { candidateCommit: "cafe1234" });
    const v6 = validateReceipt(bound, { candidateCommit: "cafe1234" });
    check("validate-bound-ok", v6.ok, `code=${v6.code}`);

    // duplicate authority negative control
    const dup = { ...receipt, requirementText: "tasks must do X" };
    const d1 = rejectDuplicateAuthority(dup);
    check("reject-duplicate-authority", !d1.ok && d1.code === "duplicate-authority", `code=${d1.code}`);

    // evidence-manifest ref: valid + missing
    const manifestPath = path.join(fixtureDir, "build-evidence-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: "1", candidateCommit: "cafe1234" }));
    const mhash = sha256File(manifestPath);
    const e1 = validateEvidenceManifestRef({ path: "build-evidence-manifest.json", sha256: mhash }, fixtureDir);
    check("evidence-ref-ok", e1.ok, `code=${e1.code}`);
    const e2 = validateEvidenceManifestRef({ path: "build-evidence-manifest.json", sha256: "0".repeat(64) }, fixtureDir);
    check("evidence-ref-mismatch", !e2.ok && e2.code === "missing-artifact", `code=${e2.code}`);

    // migratePrepareLedger one-way
    const ledgerEntry = {
      id: "bde091ab",
      subsystem: "Proposal DD10",
      severity: "blocker",
      blocking: false,
      everBlocking: true,
      disposition: "backlog",
      evidence: "grep -c selftest …",
      claimRef: "DD10",
      rootCauseKey: "proposal-factual-error",
      status: "resolved",
      firstSeenRound: 0,
      lastSeenRound: 1,
    };
    const m1 = migratePrepareLedger(ledgerEntry, { sourceRecordId: "bde091ab" });
    check("migrate-prepare-ledger-ok", m1.ok && m1.finding?.findingId === "bde091ab", `ok=${m1.ok}`);
    check("migrate-preserves-severity", m1.ok && m1.finding?.severity === "blocker", `severity=${m1.finding?.severity}`);
    check("migrate-preserves-everBlocking", m1.ok && m1.finding?.everBlocking === true, `everBlocking=${m1.finding?.everBlocking}`);

    // ── AC1 negative control: same recurrenceKey, different materialInputHashes → NOT reusable ─────
    const priorFinding: FindingEnvelope = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      findingId: "f-1",
      recurrenceKey: "abc123",
      observerStage: "Receipt",
      subsystem: "Proposal",
      claimRef: "DD10",
      severity: "blocker",
      blocking: false,
      everBlocking: true,
      evidence: [],
      materialInputHashes: { "tasks/T-1.md": "hash-a" },
      firstSeenGeneration: 0,
      lastSeenGeneration: 1,
      disposition: "backlog",
      resolution: null,
      generalization: "task-specific",
    };
    const reuseSame = canReuseFinding(priorFinding, { recurrenceKey: "abc123", materialInputHashes: { "tasks/T-1.md": "hash-a" } });
    check("reuse-same-key-same-hash", reuseSame.ok, `code=${reuseSame.code}`);
    const reuseDiffHash = canReuseFinding(priorFinding, { recurrenceKey: "abc123", materialInputHashes: { "tasks/T-1.md": "hash-b" } });
    check("reuse-same-key-diff-hash-fails", !reuseDiffHash.ok && reuseDiffHash.code === "material-input-hash-mismatch", `code=${reuseDiffHash.code}`);
    const reuseDiffKey = canReuseFinding(priorFinding, { recurrenceKey: "other", materialInputHashes: { "tasks/T-1.md": "hash-a" } });
    check("reuse-diff-key-fails", !reuseDiffKey.ok && reuseDiffKey.code === "recurrence-key-mismatch", `code=${reuseDiffKey.code}`);
  } finally {
    process.chdir(savedCwd);
    try {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort cleanup */
    }
  }
  return st.report();
}

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────────

function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj));
}

function usage(): string {
  return [
    "stage-receipt.ts — versioned stage-receipt contract module (DIR-124-B2 / M254)",
    "Usage:",
    "  node --experimental-strip-types stage-receipt.ts --validate-receipt '<receipt-json>' [--expected '<state-json>']",
    "  node --experimental-strip-types stage-receipt.ts --evidence-manifest-ref '<{path,sha256}>'",
    "  node --experimental-strip-types stage-receipt.ts --migrate-prepare-ledger '<entry-json>'",
    "  node --experimental-strip-types stage-receipt.ts --selftest",
    "",
    "Exit 0 on success / valid; exit 1 on validation failure (structured JSON on stdout).",
  ].join("\n");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  try {
    if (args.includes("--selftest")) {
      return selftest() ? 0 : 1;
    }

    if (args.includes("--validate-receipt")) {
      const idx = args.indexOf("--validate-receipt");
      const raw = args[idx + 1];
      if (raw == null) throw receiptError("validate-input-missing", "--validate-receipt requires a '<receipt-json>' argument");
      const receipt = parseJsonArg(raw, receiptError);
      let expected: { baseCommit?: string; candidateCommit?: string; workflowSourceHash?: string; runtimeGeneration?: string; materialInputHashes?: Record<string, string> } | undefined;
      const expIdx = args.indexOf("--expected");
      if (expIdx !== -1 && args[expIdx + 1] != null) {
        expected = parseJsonArg(args[expIdx + 1], receiptError) as typeof expected;
      }
      const result = validateReceipt(receipt, expected);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    if (args.includes("--evidence-manifest-ref")) {
      const idx = args.indexOf("--evidence-manifest-ref");
      const raw = args[idx + 1];
      if (raw == null) throw receiptError("ref-input-missing", "--evidence-manifest-ref requires a '<{path,sha256}>' argument");
      const ref = parseJsonArg(raw, receiptError) as { path: string; sha256?: string; hash?: string };
      const result = validateEvidenceManifestRef(ref);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    if (args.includes("--migrate-prepare-ledger")) {
      const idx = args.indexOf("--migrate-prepare-ledger");
      const raw = args[idx + 1];
      if (raw == null) throw receiptError("migrate-input-missing", "--migrate-prepare-ledger requires a '<entry-json>' argument");
      const entry = parseJsonArg(raw, receiptError) as Record<string, unknown>;
      const result = migratePrepareLedger(entry);
      printJson(result);
      return result.ok ? 0 : 1;
    }

    // eslint-disable-next-line no-unused-expressions
    usage();
    printJson({ ok: true, usage: "stage-receipt.ts" });
    return 0;
  } catch (err) {
    const e = err as Error & { code?: string };
    printJson({ ok: false, code: e.code || "stage-receipt-error", message: e.message });
    return 1;
  }
}

// ── Direct-entry check ──────────────────────────────────────────────────────────────────────────────

if (process.argv[1] != null && process.argv[1].endsWith("stage-receipt.ts")) {
  process.exitCode = main(process.argv);
}
