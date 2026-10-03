// build-evidence-gate.ts — M238: mechanical pre-Audit gate that validates BuildEvidenceManifest
// structural completeness and evidence-class compatibility. Registered as a workspace gate in
// .quay/config.yml. A gate failure dispatches zero Audit agents.
//
// Byte-identical mirror: plugin/scripts/build-evidence-gate.ts

import fs from "node:fs";
import path from "node:path";
// argvFlag (below) reads its tokens straight out of process.argv; the indexOf+next-arg algorithm now
// lives in gate-script-base.ts as `flagValue` (one of the copies in plugin/scripts;
// .quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
// `git` likewise comes from gate-script-base.ts (finding `git-helper-collector-gate`, runId
// semantic-dedup-scan-1790995446200) — this file's byte-identical private copy was removed.
import { flagValue, git } from "./gate-script-base.ts";
import type {
  BuildEvidenceManifest,
  EvidenceClass,
} from "./build-evidence-manifest.ts";
import {
  isEvidenceClassCompatible,
  validateManifestShape,
  sha256File,
} from "./build-evidence-manifest.ts";

// ── Gate return type ────────────────────────────────────────────────────────────────────────────────

export interface GateVerdict {
  ok: boolean;
  reason: string;
  reasonCode?: string;
  detail?: string;
}

// ── Deferral policy (self-contained, evidence-gate only — NOT a stub for DIR-124-D) ─────────────────

/** Self-contained deferral authorization policy map. Keyed by policy name. */
const DEFERRAL_POLICY: Record<string, { description: string; allowedReasons: string[] }> = {
  "cross-generation-not-yet-available": {
    description: "cross-generation proof requires a real next workflow run that has not yet occurred",
    allowedReasons: ["cross-generation-run-not-yet-occurred", "dependent-milestone-not-yet-executed"],
  },
  "external-service-unavailable": {
    description: "required evidence depends on an external service that is currently unavailable",
    allowedReasons: ["external-service-down", "upstream-api-unreachable"],
  },
};

function isAuthorizedDeferral(authorizedBy: string): boolean {
  if (!authorizedBy || authorizedBy === "none") return false;
  return authorizedBy in DEFERRAL_POLICY;
}

// ── Reason codes ────────────────────────────────────────────────────────────────────────────────────

const REASON_CODES = {
  MANIFEST_MISSING: "manifest-missing",
  MANIFEST_SCHEMA_UNKNOWN: "manifest-schema-unknown",
  CANDIDATE_COMMIT_INVALID: "candidate-commit-invalid",
  BUILD_ADMISSION_UNAVAILABLE: "build-admission-unavailable",
  NO_PLANNED_EVIDENCE: "no-planned-evidence",
  PLANNED_AC_UNMATCHED: "planned-ac-unmatched",
  REQUIRED_EVIDENCE_UNMET: "required-evidence-unmet",
  EVIDENCE_CLASS_MISMATCH: "evidence-class-mismatch",
  UNAUTHORIZED_DEFERRAL: "unauthorized-deferral",
  ARTIFACT_OUT_OF_ROOT: "artifact-out-of-root",
  ARTIFACT_HASH_MISMATCH: "artifact-hash-mismatch",
  DUPLICATE_AC_EVIDENCE: "duplicate-ac-evidence",
  CHANGED_FILES_MISMATCH: "changed-files-mismatch",
  GIT_FAILURE: "git-failure",
  GATE_INTERNAL_ERROR: "gate-internal-error",
} as const;

// ── git helpers — the fail-closed `git(args, cwd): GitResult` now lives in gate-script-base.ts
// (finding `git-helper-collector-gate`, routine semantic-dedup-scan, runId
// semantic-dedup-scan-1790995446200; this file's byte-identical local copy was removed) ─────────────

// ── Main gate function ──────────────────────────────────────────────────────────────────────────────

/**
 * Validate a BuildEvidenceManifest for structural completeness and evidence-class compatibility.
 * Designed to be called as a workspace gate via `quay gate --gate build-evidence <task-id>`.
 *
 * The gate reads the manifest from `<milestoneRoot>/build-evidence-manifest.json` where
 * milestoneRoot is resolved via the canonical gate_resolve_milestone_root rule.
 */
export function gateBuildEvidence(
  manifestPath: string,
  workspaceRoot: string,
  opts?: { advisoryMode?: boolean; milestoneRoot?: string }
): GateVerdict {
  // 1. Manifest file missing or unparseable
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: "manifest-missing", reasonCode: REASON_CODES.MANIFEST_MISSING, detail: `manifest not found at ${manifestPath}` };
  }

  let manifest: BuildEvidenceManifest;
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: "manifest-unparseable", reasonCode: REASON_CODES.MANIFEST_MISSING, detail: `manifest at ${manifestPath} is not valid JSON: ${(e as Error).message}` };
  }

  // 2. Structural validation (schema, duplicates, copied text, path traversal)
  const structuralErrors = validateManifestShape(manifest);
  for (const err of structuralErrors) {
    if (err.code === "manifest-schema-unknown") {
      return { ok: false, reason: "manifest-schema-unknown", reasonCode: REASON_CODES.MANIFEST_SCHEMA_UNKNOWN, detail: err.detail };
    }
    if (err.code === "candidate-commit-invalid") {
      return { ok: false, reason: "candidate-commit-invalid", reasonCode: REASON_CODES.CANDIDATE_COMMIT_INVALID, detail: err.detail };
    }
    if (err.code === "duplicate-ac-evidence") {
      return { ok: false, reason: "duplicate-ac-evidence", reasonCode: REASON_CODES.DUPLICATE_AC_EVIDENCE, detail: err.detail };
    }
    if (err.code === "no-second-authority") {
      return { ok: false, reason: "no-second-authority", reasonCode: "no-second-authority", detail: err.detail };
    }
    if (err.code === "artifact-out-of-root") {
      return { ok: false, reason: "artifact-out-of-root", reasonCode: REASON_CODES.ARTIFACT_OUT_OF_ROOT, detail: err.detail };
    }
  }

  // 3. buildAdmissionRef is null — check execution policy
  if (manifest.buildAdmissionRef === null) {
    // In advisory mode, skip this check; otherwise, fail-closed
    if (!opts?.advisoryMode) {
      return {
        ok: false,
        reason: "build-admission-unavailable",
        reasonCode: REASON_CODES.BUILD_ADMISSION_UNAVAILABLE,
        detail: "buildAdmissionRef is null and dependency is required by execution policy (not in advisory mode)",
      };
    }
  }

  // 4. plannedAcEvidence.length === 0 (non-vacuous) — only when admission is available
  if (manifest.buildAdmissionRef !== null && manifest.plannedAcEvidence.length === 0) {
    return { ok: false, reason: "no-planned-evidence", reasonCode: REASON_CODES.NO_PLANNED_EVIDENCE, detail: "plannedAcEvidence is empty but buildAdmissionRef is present" };
  }

  // 5. Every plannedAcEvidence row has a matching acEvidence row
  const acByKey = new Map<string, (typeof manifest.acEvidence)[number]>();
  for (const row of manifest.acEvidence) {
    const key = `${row.taskId}::${row.acIndex}`;
    if (acByKey.has(key)) {
      return { ok: false, reason: "duplicate-ac-evidence", reasonCode: REASON_CODES.DUPLICATE_AC_EVIDENCE, detail: `duplicate acEvidence row for ${key}` };
    }
    acByKey.set(key, row);
  }

  for (const plan of manifest.plannedAcEvidence) {
    const key = `${plan.taskId}::${plan.acIndex}`;
    if (!acByKey.has(key)) {
      return { ok: false, reason: "planned-ac-unmatched", reasonCode: REASON_CODES.PLANNED_AC_UNMATCHED, detail: `planned AC ${key} has no matching acEvidence row` };
    }
  }

  // 6. Check each acEvidence row for unmet / weaker-class / unauthorized deferral
  for (const row of manifest.acEvidence) {
    const key = `${row.taskId}::${row.acIndex}`;
    const planRow = manifest.plannedAcEvidence.find((p) => p.taskId === row.taskId && p.acIndex === row.acIndex);

    // 6a. Unmet disposition → hard block
    if (row.disposition === "unmet") {
      return { ok: false, reason: "required-evidence-unmet", reasonCode: REASON_CODES.REQUIRED_EVIDENCE_UNMET, detail: `${key}: disposition is unmet — ${row.detail}` };
    }

    // 6b. Evidence class weaker than required
    if (planRow && row.disposition === "satisfied") {
      const required: EvidenceClass = planRow.requiredClass;
      const actual: EvidenceClass = row.evidenceClass;
      if (!isEvidenceClassCompatible(required, actual)) {
        return {
          ok: false,
          reason: "evidence-class-mismatch",
          reasonCode: REASON_CODES.EVIDENCE_CLASS_MISMATCH,
          detail: `${key}: required ${required} but actual evidence is ${actual} (weaker in strict total order)`,
        };
      }
    }

    // 6c. Deferred with unauthorized authorization
    if (row.disposition === "deferred") {
      const authBy = (row as Record<string, unknown>).authorizedBy as string | undefined;
      if (!authBy || authBy === "none" || !isAuthorizedDeferral(authBy)) {
        return { ok: false, reason: "unauthorized-deferral", reasonCode: REASON_CODES.UNAUTHORIZED_DEFERRAL, detail: `${key}: disposition deferred but authorizedBy is "${authBy || ""}" — Build producer cannot self-exempt` };
      }
    }
  }

  // 7. Validate iterationArtifactRefs: path within milestone root, hash matches
  const milestoneRoot = opts?.milestoneRoot || path.dirname(manifestPath);
  for (const ref of manifest.iterationArtifactRefs) {
    const fullPath = path.resolve(milestoneRoot, ref.path);

    // 7a. Out of root check
    const relPath = path.relative(milestoneRoot, fullPath);
    if (relPath.startsWith("..") || path.isAbsolute(ref.path)) {
      return { ok: false, reason: "artifact-out-of-root", reasonCode: REASON_CODES.ARTIFACT_OUT_OF_ROOT, detail: `artifact path "${ref.path}" resolves outside milestone root` };
    }

    // 7b. Hash mismatch check
    if (fs.existsSync(fullPath)) {
      try {
        const actualHash = sha256File(fullPath);
        if (ref.hash && actualHash !== ref.hash) {
          return { ok: false, reason: "artifact-hash-mismatch", reasonCode: REASON_CODES.ARTIFACT_HASH_MISMATCH, detail: `artifact "${ref.path}": declared hash ${ref.hash}, actual hash ${actualHash}` };
        }
      } catch {
        // file became unreadable — treat as hash mismatch
        return { ok: false, reason: "artifact-hash-mismatch", reasonCode: REASON_CODES.ARTIFACT_HASH_MISMATCH, detail: `artifact "${ref.path}": cannot read file to verify hash` };
      }
    }
    // Missing files that are declared are not a hard block — they may be generated later
  }

  // 8. Changed files drift check: re-derive from git and compare. FAIL-CLOSED on git failure
  // (M265 mechanism 3): an empty baseCommit (collector git merge-base failure or hand-authored
  // manifest) OR a git diff command failure is a hard block — the drift check is never silently
  // skipped. A legitimately empty diff (baseCommit === candidateCommit → no changes) is NOT a block.
  if (!manifest.baseCommit) {
    return {
      ok: false,
      reason: "git-failure",
      reasonCode: REASON_CODES.GIT_FAILURE,
      detail: "baseCommit is empty — collector git merge-base failed or the manifest is hand-authored; changed-files drift check cannot be verified",
    };
  }
  if (manifest.candidateCommit) {
    const diff = git(["diff", "--numstat", `${manifest.baseCommit}..${manifest.candidateCommit}`], workspaceRoot);
    if (!diff.ok) {
      return {
        ok: false,
        reason: "git-failure",
        reasonCode: REASON_CODES.GIT_FAILURE,
        detail: `git diff --numstat ${manifest.baseCommit}..${manifest.candidateCommit} failed: ${diff.error}`,
      };
    }
    const currentFiles = new Map<string, { additions: number; deletions: number }>();
    for (const line of diff.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("\t");
      if (parts.length >= 3) {
        const a = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        if (!isNaN(a) && !isNaN(d)) {
          currentFiles.set(parts[2], { additions: a, deletions: d });
        }
      }
    }

    if (currentFiles.size !== manifest.changedFiles.length) {
      return {
        ok: false,
        reason: "changed-files-mismatch",
        reasonCode: REASON_CODES.CHANGED_FILES_MISMATCH,
        detail: `manifest has ${manifest.changedFiles.length} changed files, git shows ${currentFiles.size}`,
      };
    }

    for (const mf of manifest.changedFiles) {
      const cur = currentFiles.get(mf.path);
      if (!cur) {
        return {
          ok: false,
          reason: "changed-files-mismatch",
          reasonCode: REASON_CODES.CHANGED_FILES_MISMATCH,
          detail: `file "${mf.path}" is in manifest changedFiles but not in git diff`,
        };
      }
      if (cur.additions !== mf.additions || cur.deletions !== mf.deletions) {
        return {
          ok: false,
          reason: "changed-files-mismatch",
          reasonCode: REASON_CODES.CHANGED_FILES_MISMATCH,
          detail: `file "${mf.path}" add/del mismatch: manifest (+${mf.additions}/-${mf.deletions}), git (+${cur.additions}/-${cur.deletions})`,
        };
      }
    }
  }

  // All checks passed
  return { ok: true, reason: "all-gate-checks-passed" };
}

/**
 * QENG-compatible gate function. Consumed by the workspace gate registry.
 * Reads manifest from the task's extra.manifest field or the canonical path.
 */
export async function buildEvidenceGate(task: unknown, client: unknown): Promise<GateVerdict> {
  try {
    const t = task as Record<string, unknown>;
    const extra = (t.extra || {}) as Record<string, unknown>;
    const manifestPath = (extra.manifest || extra.manifestPath) as string | undefined;

    if (!manifestPath || typeof manifestPath !== "string") {
      return { ok: false, reason: "manifest-missing", reasonCode: REASON_CODES.MANIFEST_MISSING, detail: "no manifest path provided — set task.extra.manifest to the manifest file path" };
    }

    // Discover workspace root
    let workspaceRoot = process.cwd();
    try {
      const { discoverWorkspaceRoot } = await import("../../packages/quay/src/gate/config/loader.ts");
      const found = discoverWorkspaceRoot();
      if (found) workspaceRoot = found;
    } catch {
      // fall back to cwd
    }

    return gateBuildEvidence(manifestPath, workspaceRoot, { milestoneRoot: path.dirname(manifestPath) });
  } catch (e) {
    return { ok: false, reason: "gate-internal-error", reasonCode: REASON_CODES.GATE_INTERNAL_ERROR, detail: (e as Error).message };
  }
}

// ── CLI mode ────────────────────────────────────────────────────────────────────────────────────────

function cliFail(message: string): never {
  console.error(`FAIL: build-evidence — ${message}`);
  process.exit(1);
}

/** Arity-1 adapter over the shared `flagValue`: this module's tokens come from process.argv itself. */
const argvFlag = (name: string): string | undefined => flagValue(process.argv, name);

if (process.argv[1] != null && process.argv[1].endsWith("build-evidence-gate.ts")) {
  const manifestPath = argvFlag("--manifest");
  if (!manifestPath) cliFail("missing required --manifest <path>");

  const workspaceRoot = argvFlag("--workspace") || process.cwd();
  const advisoryMode = process.argv.includes("--advisory");

  const verdict = gateBuildEvidence(manifestPath, workspaceRoot, {
    advisoryMode,
    milestoneRoot: path.dirname(manifestPath),
  });

  if (verdict.ok) {
    console.log(`PASS: build-evidence — ${verdict.reason}`);
    process.exit(0);
  } else {
    console.log(`FAIL: build-evidence — ${verdict.reasonCode || verdict.reason} — ${verdict.detail || verdict.reason}`);
    process.exit(1);
  }
}
