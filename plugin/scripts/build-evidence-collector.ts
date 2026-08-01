// build-evidence-collector.ts — M238: deterministic post-Build evidence collector for both
// singleton and composite Build paths. Derives git fields mechanically, reconciles planned vs.
// actual evidence rows, produces BuildEvidenceManifest JSON.
//
// Byte-identical mirror: plugin/scripts/build-evidence-collector.ts

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  BuildEvidenceManifest,
  ChangedFile,
  TestRun,
  AcEvidenceRow,
  RuntimeEvidence,
  DeferredOrUnmetEntry,
  IterationArtifactRef,
  EvidenceClass,
} from "./build-evidence-manifest.ts";
import {
  sha256File,
  resolveMilestoneRoot,
  isEvidenceClassCompatible,
} from "./build-evidence-manifest.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface CollectorOpts {
  buildResult: {
    outcome: string;
    taskId?: string;
    mergeCommit?: string;
    iterationCount?: number;
  };
  admissionDecisionFile?: string; // path to BuildAdmissionDecision JSON
  milestoneRoot: string;
  workspaceRoot: string;
  perPhaseEvidenceFile?: string; // PhaseEvidence[] JSON (composite path)
  iterationReport?: string; // path to iteration-0.md (width-1 path)
  testsRun?: TestRun[]; // pre-collected test results
  runtimeClaims?: RuntimeEvidence[]; // agent-declared claims
  milestoneId: string;
  taskIds: string[];
  composite: boolean;
  attempt: number;
  sessionId: string;
  output: string; // where to write the manifest JSON
}

export interface CollectorResult {
  ok: boolean;
  manifestPath: string;
  manifest?: BuildEvidenceManifest;
  reason?: string;
}

// ── git helpers ─────────────────────────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  try {
    return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    return "";
  }
}

function deriveBaseCommit(candidateCommit: string, workspaceRoot: string): string {
  if (!candidateCommit) return "";
  const result = git(["merge-base", "origin/master", candidateCommit], workspaceRoot);
  return result || "";
}

function deriveChangedFiles(baseCommit: string, candidateCommit: string, workspaceRoot: string): ChangedFile[] {
  if (!baseCommit || !candidateCommit) return [];
  const output = git(["diff", "--numstat", `${baseCommit}..${candidateCommit}`], workspaceRoot);
  if (!output) return [];
  const files: ChangedFile[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 3) {
      const additions = parseInt(parts[0], 10);
      const deletions = parseInt(parts[1], 10);
      if (!isNaN(additions) && !isNaN(deletions)) {
        files.push({ path: parts[2], additions, deletions });
      }
    }
  }
  return files;
}

// ── artifact collection ─────────────────────────────────────────────────────────────────────────────

function collectIterationArtifacts(milestoneRoot: string): IterationArtifactRef[] {
  const refs: IterationArtifactRef[] = [];
  const iterationsDir = path.join(milestoneRoot, "iterations");
  const auditsDir = path.join(milestoneRoot, "audits");

  function scanDir(dir: string, kind: IterationArtifactRef["kind"]): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(milestoneRoot, fullPath);
      try {
        const hash = sha256File(fullPath);
        refs.push({ path: relPath, hash, kind });
      } catch {
        // file became unreadable — skip
      }
    }
  }

  scanDir(iterationsDir, "iteration-report");
  scanDir(auditsDir, "audit-artifact");
  return refs;
}

// ── evidence reconciliation ─────────────────────────────────────────────────────────────────────────

function reconcileEvidence(
  plannedRows: Array<{ taskId: string; acIndex: number; requiredClass: EvidenceClass; plannedCommand: string; plannedArtifact: string }>,
  actualRows: AcEvidenceRow[],
): AcEvidenceRow[] {
  const actualByKey = new Map<string, AcEvidenceRow>();
  for (const row of actualRows) {
    actualByKey.set(`${row.taskId}::${row.acIndex}`, row);
  }

  const result: AcEvidenceRow[] = [];
  for (const planned of plannedRows) {
    const key = `${planned.taskId}::${planned.acIndex}`;
    const actual = actualByKey.get(key);
    if (actual) {
      result.push(actual);
    } else {
      result.push({
        taskId: planned.taskId,
        acIndex: planned.acIndex,
        disposition: "unmet",
        evidenceClass: "source",
        producer: "mechanical",
        actualCommand: "",
        actualArtifact: "",
        artifactHash: "",
        detail: `planned evidence row unmatched — no actual evidence row found for ${planned.taskId} AC ${planned.acIndex}`,
      });
    }
  }

  return result;
}

// ── admission decision reading ──────────────────────────────────────────────────────────────────────

interface AdmissionRequiredEvidence {
  taskId: string;
  acIndex: number;
  requiredClass: EvidenceClass;
  plannedCommand?: string;
  plannedArtifact?: string;
}

interface AdmissionDecision {
  requiredEvidence?: AdmissionRequiredEvidence[];
}

function readAdmissionDecision(filePath: string | undefined): {
  decision: AdmissionDecision | null;
  decisionFile: string;
  decisionHash: string;
} {
  if (!filePath || !fs.existsSync(filePath)) {
    return { decision: null, decisionFile: "", decisionHash: "" };
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const decision = JSON.parse(content) as AdmissionDecision;
    const hash = sha256File(filePath);
    return { decision, decisionFile: filePath, decisionHash: hash };
  } catch {
    return { decision: null, decisionFile: "", decisionHash: "" };
  }
}

// ── main collector ──────────────────────────────────────────────────────────────────────────────────

export function collectBuildEvidence(opts: CollectorOpts): CollectorResult {
  const {
    buildResult,
    admissionDecisionFile,
    milestoneRoot,
    workspaceRoot,
    perPhaseEvidenceFile,
    iterationReport,
    testsRun = [],
    runtimeClaims = [],
    milestoneId,
    taskIds,
    composite,
    attempt,
    sessionId,
    output,
  } = opts;

  // Validate build result
  if (!buildResult || buildResult.outcome !== "done") {
    return { ok: false, manifestPath: output, reason: "build-outcome-not-done" };
  }

  const candidateCommit = buildResult.mergeCommit || "";
  if (!candidateCommit) {
    return { ok: false, manifestPath: output, reason: "missing-merge-commit" };
  }

  // Derive git fields mechanically
  const baseCommit = deriveBaseCommit(candidateCommit, workspaceRoot);
  const changedFiles = deriveChangedFiles(baseCommit, candidateCommit, workspaceRoot);

  // Read admission decision
  const { decision, decisionFile, decisionHash } = readAdmissionDecision(admissionDecisionFile);

  // Build planned evidence rows from admission decision
  let plannedAcEvidence = decision?.requiredEvidence
    ? decision.requiredEvidence.map((req) => ({
        taskId: req.taskId,
        acIndex: req.acIndex,
        requiredClass: req.requiredClass,
        plannedCommand: req.plannedCommand ?? "",
        plannedArtifact: req.plannedArtifact ?? "",
      }))
    : [];

  // Collect iteration artifacts
  const iterationArtifactRefs = collectIterationArtifacts(milestoneRoot);

  // Reconcile planned vs actual evidence
  const acEvidence = reconcileEvidence(plannedAcEvidence, []);

  // Collect deferred/unmet entries
  const deferredOrUnmet: DeferredOrUnmetEntry[] = acEvidence
    .filter((r) => r.disposition === "deferred" || r.disposition === "unmet")
    .map((r) => ({
      taskId: r.taskId,
      acIndex: r.acIndex,
      reason: r.detail,
      authorizedBy: r.disposition === "deferred" ? (r as Record<string, unknown>).authorizedBy as string || "" : "",
    }));

  const manifest: BuildEvidenceManifest = {
    schemaVersion: "1",
    runIdentity: {
      milestoneId,
      taskIds,
      composite,
      attempt,
      sessionId,
    },
    buildAdmissionRef: decision
      ? { decisionFile, decisionHash }
      : null,
    baseCommit,
    candidateCommit,
    changedFiles,
    testsRun,
    plannedAcEvidence,
    acEvidence,
    runtimeEvidence: runtimeClaims.map((c) => ({
      producer: "build-agent" as const,
      claim: c.claim,
      artifactRef: c.artifactRef,
    })),
    deferredOrUnmet,
    iterationArtifactRefs,
  };

  // Write manifest
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(manifest, null, 2), "utf8");
  } catch (e) {
    return { ok: false, manifestPath: output, reason: `cannot write manifest: ${(e as Error).message}` };
  }

  return { ok: true, manifestPath: output, manifest };
}

// ── CLI mode ────────────────────────────────────────────────────────────────────────────────────────

function cliFail(message: string): never {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function argvFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function argvFlags(name: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && i + 1 < process.argv.length) {
      result.push(process.argv[++i]);
    }
  }
  return result;
}

if (process.argv[1] != null && process.argv[1].endsWith("build-evidence-collector.ts")) {
  const output = argvFlag("--output");
  if (!output) cliFail("missing required --output <path>");

  const milestoneRoot = argvFlag("--milestone-root");
  if (!milestoneRoot) cliFail("missing required --milestone-root <path>");

  const workspaceRoot = argvFlag("--workspace") || process.cwd();

  let buildResult: CollectorOpts["buildResult"];
  const buildResultRaw = argvFlag("--build-result");
  if (buildResultRaw) {
    try {
      buildResult = JSON.parse(buildResultRaw);
    } catch {
      cliFail(`--build-result is not valid JSON: ${buildResultRaw}`);
    }
  } else {
    cliFail("missing required --build-result <json>");
  }

  const milestoneId = argvFlag("--milestone-id") || "";
  const taskIdsRaw = argvFlag("--task-ids");
  const taskIds = taskIdsRaw ? JSON.parse(taskIdsRaw) : [buildResult.taskId || ""];
  const composite = argvFlag("--composite") === "true";
  const attempt = parseInt(argvFlag("--attempt") || "1", 10);
  const sessionId = argvFlag("--session-id") || "";

  const testsRunRaw = argvFlag("--tests-run");
  let testsRun: TestRun[] = [];
  if (testsRunRaw) {
    try {
      testsRun = JSON.parse(testsRunRaw);
    } catch {
      // non-fatal: proceed with empty testsRun
    }
  }

  const runtimeClaimsRaw = argvFlag("--runtime-claims");
  let runtimeClaims: RuntimeEvidence[] = [];
  if (runtimeClaimsRaw) {
    try {
      runtimeClaims = JSON.parse(runtimeClaimsRaw);
    } catch {
      // non-fatal
    }
  }

  const result = collectBuildEvidence({
    buildResult,
    admissionDecisionFile: argvFlag("--admission-decision"),
    milestoneRoot,
    workspaceRoot,
    perPhaseEvidenceFile: argvFlag("--per-phase-evidence"),
    iterationReport: argvFlag("--iteration-report"),
    testsRun,
    runtimeClaims,
    milestoneId,
    taskIds: Array.isArray(taskIds) ? taskIds : [taskIds],
    composite,
    attempt,
    sessionId,
    output,
  });

  if (result.ok) {
    console.log(JSON.stringify({ ok: true, manifestPath: result.manifestPath }));
  } else {
    console.log(JSON.stringify({ ok: false, manifestPath: result.manifestPath, reason: result.reason }));
    process.exit(1);
  }
}
