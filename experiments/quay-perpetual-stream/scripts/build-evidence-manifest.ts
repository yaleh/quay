// build-evidence-manifest.ts — M238: canonical BuildEvidenceManifest schema, validation, and
// hash-binding. Single source of truth for the manifest shape; every production and test consumer
// imports from here.
//
// Byte-identical mirror: plugin/scripts/build-evidence-manifest.ts

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSelftest } from "./gate-script-base.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export type EvidenceClass = "source" | "unit" | "integration" | "real-workflow" | "cross-generation";

/** Strict total order: source < unit < integration < real-workflow < cross-generation */
const EVIDENCE_CLASS_ORDER: Record<EvidenceClass, number> = {
  source: 0,
  unit: 1,
  integration: 2,
  "real-workflow": 3,
  "cross-generation": 4,
};

export type AcDisposition = "satisfied" | "deferred" | "unmet" | "superseded";
export type Producer = "mechanical" | "build-agent";
export type TestScope = "affected" | "module" | "mirror" | "full-suite" | "integration";
export type ArtifactKind = "iteration-report" | "test-log" | "build-log" | "audit-artifact" | "other";

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface TestRun {
  command: string;
  exitCode: number;
  outputPath: string;
  scope: TestScope;
}

export interface PlannedAcEvidence {
  taskId: string;
  acIndex: number;
  requiredClass: EvidenceClass;
  plannedCommand: string;
  plannedArtifact: string;
}

export interface AcEvidenceRow {
  taskId: string;
  acIndex: number;
  disposition: AcDisposition;
  evidenceClass: EvidenceClass;
  producer: Producer;
  actualCommand: string;
  actualArtifact: string;
  artifactHash: string;
  detail: string;
}

export interface RuntimeEvidence {
  producer: "build-agent"; // always "build-agent" by construction
  claim: string;
  artifactRef: string;
}

export interface DeferredOrUnmetEntry {
  taskId: string;
  acIndex: number;
  reason: string;
  authorizedBy: string;
}

export interface IterationArtifactRef {
  path: string;
  hash: string;
  kind: ArtifactKind;
}

export interface BuildEvidenceManifest {
  schemaVersion: string;
  runIdentity: {
    milestoneId: string;
    taskIds: string[];
    composite: boolean;
    attempt: number;
    sessionId: string;
  };
  buildAdmissionRef: {
    decisionFile: string;
    decisionHash: string;
  } | null;
  baseCommit: string;
  candidateCommit: string;
  changedFiles: ChangedFile[];
  testsRun: TestRun[];
  plannedAcEvidence: PlannedAcEvidence[];
  acEvidence: AcEvidenceRow[];
  runtimeEvidence: RuntimeEvidence[];
  deferredOrUnmet: DeferredOrUnmetEntry[];
  iterationArtifactRefs: IterationArtifactRef[];
}

// ── Evidence class compatibility ────────────────────────────────────────────────────────────────────

/**
 * Mechanical comparison against the strict total order.
 * Returns true iff actual >= required in the ordering source < unit < integration < real-workflow < cross-generation.
 */
export function isEvidenceClassCompatible(required: EvidenceClass, actual: EvidenceClass): boolean {
  return (EVIDENCE_CLASS_ORDER[actual] ?? -1) >= (EVIDENCE_CLASS_ORDER[required] ?? 0);
}

// ── planEvidenceRows ────────────────────────────────────────────────────────────────────────────────

/**
 * Consume exactly ONE BuildAdmissionDecision.requiredEvidence[] and produce plannedAcEvidence[].
 * Rejects duplicate {taskId, acIndex} mappings and copied requirement text.
 */
export function planEvidenceRows(
  requiredEvidence: Array<{ taskId: string; acIndex: number; requiredClass: EvidenceClass; plannedCommand?: string; plannedArtifact?: string }>
): { rows: PlannedAcEvidence[]; errors: Array<{ taskId: string; acIndex: number; reason: string }> } {
  const seen = new Set<string>();
  const rows: PlannedAcEvidence[] = [];
  const errors: Array<{ taskId: string; acIndex: number; reason: string }> = [];

  for (const req of requiredEvidence) {
    const key = `${req.taskId}::${req.acIndex}`;
    if (seen.has(key)) {
      errors.push({ taskId: req.taskId, acIndex: req.acIndex, reason: "duplicate-ac" });
      continue;
    }
    seen.add(key);

    rows.push({
      taskId: req.taskId,
      acIndex: req.acIndex,
      requiredClass: req.requiredClass,
      plannedCommand: req.plannedCommand ?? "",
      plannedArtifact: req.plannedArtifact ?? "",
    });
  }

  return { rows, errors };
}

// ── validateManifestShape ───────────────────────────────────────────────────────────────────────────

export interface ValidationError {
  code: string;
  detail: string;
}

/**
 * Structural validation: rejects duplicate AC mappings, copied requirement text, and schema violations.
 * The manifest schema structurally prohibits requirement text fields.
 */
export function validateManifestShape(m: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!m || typeof m !== "object") {
    errors.push({ code: "manifest-not-object", detail: "manifest must be a JSON object" });
    return errors;
  }

  const manifest = m as Record<string, unknown>;

  // schemaVersion required
  if (typeof manifest.schemaVersion !== "string" || manifest.schemaVersion.trim() === "") {
    errors.push({ code: "manifest-schema-unknown", detail: `schemaVersion must be a non-empty string, got ${typeof manifest.schemaVersion}` });
  } else if (!["1"].includes(manifest.schemaVersion)) {
    errors.push({ code: "manifest-schema-unknown", detail: `unknown schemaVersion "${manifest.schemaVersion}" — known versions: 1` });
  }

  // candidateCommit required and valid SHA-like
  if (typeof manifest.candidateCommit !== "string" || manifest.candidateCommit.trim() === "") {
    errors.push({ code: "candidate-commit-invalid", detail: "candidateCommit must be a non-empty string" });
  }

  // Check for copied requirement text (no-second-authority)
  const manifestStr = JSON.stringify(manifest);
  const forbiddenFields = ["requirementText", "acText", "requirement", "criterion"];
  for (const field of forbiddenFields) {
    if (manifestStr.includes(`"${field}"`)) {
      errors.push({ code: "no-second-authority", detail: `manifest contains forbidden field "${field}" — requirement text must not be copied; task file is the single source of truth` });
    }
  }

  // Validate acEvidence[]: no duplicate {taskId, acIndex}
  if (Array.isArray(manifest.acEvidence)) {
    const seen = new Set<string>();
    for (let i = 0; i < (manifest.acEvidence as unknown[]).length; i++) {
      const row = (manifest.acEvidence as unknown[])[i] as Record<string, unknown> | undefined;
      if (!row) continue;
      const key = `${row.taskId}::${row.acIndex}`;
      if (seen.has(key)) {
        errors.push({ code: "duplicate-ac-evidence", detail: `duplicate AC evidence row for ${row.taskId} AC ${row.acIndex} at index ${i}` });
      }
      seen.add(key);

      // Check disposition field
      if (typeof row.disposition !== "string" || !["satisfied", "deferred", "unmet", "superseded"].includes(row.disposition as string)) {
        errors.push({ code: "invalid-disposition", detail: `row ${key} has invalid disposition: ${row.disposition}` });
      }

      // Check evidenceClass field
      if (typeof row.evidenceClass !== "string" || !(row.evidenceClass as string in EVIDENCE_CLASS_ORDER)) {
        errors.push({ code: "invalid-evidence-class", detail: `row ${key} has invalid evidenceClass: ${row.evidenceClass}` });
      }
    }
  }

  // Validate iterationArtifactRefs[]: paths must not be absolute (relative to milestone root)
  if (Array.isArray(manifest.iterationArtifactRefs)) {
    for (const ref of manifest.iterationArtifactRefs as unknown[]) {
      const r = ref as Record<string, unknown> | undefined;
      if (!r) continue;
      if (typeof r.path === "string" && (r.path.startsWith("/") || r.path.includes(".."))) {
        errors.push({ code: "artifact-out-of-root", detail: `artifact path contains traversal or absolute path: ${r.path}` });
      }
    }
  }

  return errors;
}

// ── manifestRefForReceipt ───────────────────────────────────────────────────────────────────────────

export interface ManifestRef {
  hash: string;
  path: string;
  candidateCommit: string;
}

/**
 * Produce {hash, path, candidateCommit} for DIR-124-B receipt binding.
 * hash is sha256 of the canonical JSON bytes.
 */
export function manifestRefForReceipt(manifest: BuildEvidenceManifest, manifestPath: string): ManifestRef {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(manifest).sort()) {
    sorted[key] = (manifest as Record<string, unknown>)[key];
  }
  const canonicalJson = JSON.stringify(sorted);
  const hash = createHash("sha256").update(canonicalJson).digest("hex");
  return {
    hash,
    path: manifestPath,
    candidateCommit: manifest.candidateCommit,
  };
}

// ── sha256 helper ───────────────────────────────────────────────────────────────────────────────────

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256String(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ── gate-script-lib resolution (replicated from gate-script-lib.sh lines 137-162) ────────────────────

/**
 * Resolve milestone root path — THE single authoritative rule.
 * Milestone >= 130 → milestones/M<NN>; < 130 → experiments/quay-perpetual-stream/milestones/M<NN>.
 */
export function resolveMilestoneRoot(workspaceRoot: string, milestoneId: string): string {
  const trimmed = milestoneId.replace(/^M/i, "").replace(/-.*$/, "");
  const num = parseInt(trimmed, 10);
  if (isNaN(num)) throw new Error(`cannot parse milestone number from "${milestoneId}"`);
  const base = num >= 130 ? "milestones" : "experiments/quay-perpetual-stream/milestones";
  return path.join(workspaceRoot, base, `M${num}`);
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;

  // Evidence class ordering
  check("source<unit", isEvidenceClassCompatible("source", "unit"), "unit >= source");
  check("source<real-workflow", isEvidenceClassCompatible("source", "real-workflow"), "real-workflow >= source");
  check("unit<cross-generation", isEvidenceClassCompatible("unit", "cross-generation"), "cross-generation >= unit");
  check("source<source", isEvidenceClassCompatible("source", "source"), "source >= source (same class)");
  check("real-workflow>source", !isEvidenceClassCompatible("real-workflow", "source"), "source < real-workflow (reversed)");
  check("cross-generation>integration", !isEvidenceClassCompatible("cross-generation", "integration"), "integration < cross-generation (reversed)");

  // planEvidenceRows: normal case
  {
    const { rows, errors } = planEvidenceRows([
      { taskId: "T1", acIndex: 0, requiredClass: "unit", plannedCommand: "npm test" },
      { taskId: "T1", acIndex: 1, requiredClass: "real-workflow", plannedCommand: "node workflow.js" },
      { taskId: "T2", acIndex: 0, requiredClass: "integration" },
    ]);
    check("plan-rows-count", rows.length === 3 && errors.length === 0, `${rows.length} rows, ${errors.length} errors`);
    check("plan-row-0-taskId", rows[0].taskId === "T1", rows[0].taskId);
    check("plan-row-2-no-plannedCommand", rows[2].plannedCommand === "", `plannedCommand="${rows[2].plannedCommand}"`);
  }

  // planEvidenceRows: duplicate
  {
    const { rows, errors } = planEvidenceRows([
      { taskId: "T1", acIndex: 0, requiredClass: "source" },
      { taskId: "T1", acIndex: 0, requiredClass: "unit" },
    ]);
    check("plan-duplicate-detected", errors.length === 1 && errors[0].reason === "duplicate-ac", `errors=${JSON.stringify(errors)}`);
    check("plan-duplicate-only-first-row", rows.length === 1, `rows=${rows.length} (second row excluded)`);
  }

  // planEvidenceRows: empty
  {
    const { rows, errors } = planEvidenceRows([]);
    check("plan-empty-input", rows.length === 0 && errors.length === 0, "empty in -> empty out");
  }

  // validateManifestShape: valid minimal manifest
  {
    const errors = validateManifestShape({
      schemaVersion: "1",
      candidateCommit: "abc123",
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "sess-1" },
      buildAdmissionRef: null,
      baseCommit: "def456",
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    });
    check("validate-valid-minimal", errors.length === 0, JSON.stringify(errors));
  }

  // validateManifestShape: missing schemaVersion
  {
    const errors = validateManifestShape({ candidateCommit: "abc" });
    check("validate-missing-schema", errors.some((e) => e.code === "manifest-schema-unknown"), JSON.stringify(errors));
  }

  // validateManifestShape: missing candidateCommit
  {
    const errors = validateManifestShape({ schemaVersion: "1" });
    check("validate-missing-candidate", errors.some((e) => e.code === "candidate-commit-invalid"), JSON.stringify(errors));
  }

  // validateManifestShape: duplicate acEvidence
  {
    const errors = validateManifestShape({
      schemaVersion: "1",
      candidateCommit: "abc123",
      acEvidence: [
        { taskId: "T1", acIndex: 0, disposition: "satisfied", evidenceClass: "unit", producer: "mechanical", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "" },
        { taskId: "T1", acIndex: 0, disposition: "unmet", evidenceClass: "source", producer: "build-agent", actualCommand: "", actualArtifact: "", artifactHash: "", detail: "" },
      ],
    });
    check("validate-duplicate-ac-evidence", errors.some((e) => e.code === "duplicate-ac-evidence"), JSON.stringify(errors));
  }

  // validateManifestShape: copied requirement text (no-second-authority)
  {
    const errors = validateManifestShape({
      schemaVersion: "1",
      candidateCommit: "abc123",
      acEvidence: [],
      requirementText: "The system must do X",
    });
    check("validate-no-second-authority", errors.some((e) => e.code === "no-second-authority"), JSON.stringify(errors));
  }

  // validateManifestShape: artifact path traversal
  {
    const errors = validateManifestShape({
      schemaVersion: "1",
      candidateCommit: "abc123",
      acEvidence: [],
      iterationArtifactRefs: [{ path: "../../etc/passwd", hash: "abc", kind: "other" }],
    });
    check("validate-artifact-out-of-root", errors.some((e) => e.code === "artifact-out-of-root"), JSON.stringify(errors));
  }

  // manifestRefForReceipt: deterministic hash
  {
    const m: BuildEvidenceManifest = {
      schemaVersion: "1",
      runIdentity: { milestoneId: "M238", taskIds: ["T1"], composite: false, attempt: 1, sessionId: "sess-1" },
      buildAdmissionRef: null,
      baseCommit: "def456",
      candidateCommit: "abc123",
      changedFiles: [],
      testsRun: [],
      plannedAcEvidence: [],
      acEvidence: [],
      runtimeEvidence: [],
      deferredOrUnmet: [],
      iterationArtifactRefs: [],
    };
    const ref1 = manifestRefForReceipt(m, "/tmp/test-manifest.json");
    const ref2 = manifestRefForReceipt(m, "/tmp/test-manifest.json");
    check("receipt-ref-deterministic", ref1.hash === ref2.hash, `hash=${ref1.hash}`);
    check("receipt-ref-has-path", ref1.path === "/tmp/test-manifest.json", ref1.path);
    check("receipt-ref-has-candidate", ref1.candidateCommit === "abc123", ref1.candidateCommit);

    // Changing a field changes hash
    const m2 = { ...m, candidateCommit: "xyz789" };
    const ref3 = manifestRefForReceipt(m2, "/tmp/test-manifest.json");
    check("receipt-ref-different-on-change", ref1.hash !== ref3.hash, `${ref1.hash} vs ${ref3.hash}`);
  }

  // sha256File / sha256String (smoke)
  {
    const h = sha256String("hello");
    check("sha256-smoke", h.length === 64 && /^[0-9a-f]+$/.test(h), h);
  }

  // resolveMilestoneRoot
  {
    const r130 = resolveMilestoneRoot("/ws", "M130");
    check("resolve-M130", r130 === "/ws/milestones/M130", r130);
    const r129 = resolveMilestoneRoot("/ws", "M129");
    check("resolve-M129", r129 === "/ws/experiments/quay-perpetual-stream/milestones/M129", r129);
    const r238slug = resolveMilestoneRoot("/ws", "M238-gap-build-evidence");
    check("resolve-M238-slug", r238slug === "/ws/milestones/M238", r238slug);
    try {
      resolveMilestoneRoot("/ws", "bad");
      check("resolve-bad-throws", false, "should have thrown");
    } catch {
      check("resolve-bad-throws", true, "threw as expected");
    }
  }
  return st.report();
}

// ── Composite evidence mapping (extracted from the retired composite-build.ts / composite-contracts.ts
// at gap-retire-the-prepare-execute-pipeline-cluster) — build-evidence-collector.ts's ONLY surviving
// consumer of the composite phase model. The composite pipeline is retired (ADR-022); these three
// types + the pure mapping function are the single piece of it the build-evidence machinery still needs.
// Single-sourced HERE so build-evidence-collector.ts can keep mapping per-phase evidence back to tasks
// without importing the retired composite modules. ────────────────────────────────────────────────

export interface CompositePhase {
  id: string;
  /** Tasks whose work this phase covers. length > 1 = a shared/overlapping phase. */
  taskIds: string[];
  /** Phase ids that must complete before this phase may start. */
  requires: string[];
  /** Audit shard ids that cover this phase. */
  auditShardIds: string[];
  /** REQUIRED when taskIds.length > 1 — the integration invariant this shared phase upholds. */
  integrationInvariant?: string;
}

export interface PhaseEvidence {
  phaseId: string;
  files: string[];
  commits: string[];
  tests: string[];
}

export interface TaskEvidenceReport {
  taskId: string;
  files: string[];
  commits: string[];
  tests: string[];
  phaseIds: string[];
}

export function mapEvidenceToTasks(phases: CompositePhase[], evidence: PhaseEvidence[]): TaskEvidenceReport[] {
  const byTask = new Map<string, TaskEvidenceReport>();
  const evidenceByPhase = new Map(evidence.map((e) => [e.phaseId, e]));
  for (const p of phases) {
    const ev = evidenceByPhase.get(p.id);
    if (!ev) continue;
    for (const taskId of p.taskIds) {
      if (!byTask.has(taskId)) byTask.set(taskId, { taskId, files: [], commits: [], tests: [], phaseIds: [] });
      const rec = byTask.get(taskId)!;
      rec.files.push(...ev.files);
      rec.commits.push(...ev.commits);
      rec.tests.push(...ev.tests);
      rec.phaseIds.push(p.id);
    }
  }
  for (const rec of byTask.values()) {
    rec.files = [...new Set(rec.files)];
    rec.commits = [...new Set(rec.commits)];
    rec.tests = [...new Set(rec.tests)];
  }
  return [...byTask.values()];
}

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────────

if (process.argv[1] != null && process.argv[1].endsWith("build-evidence-manifest.ts")) {
  if (process.argv.includes("--selftest")) {
    process.exitCode = selftest() ? 0 : 1;
  }
}
