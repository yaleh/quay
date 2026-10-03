// build-evidence-collector.ts — M238: deterministic post-Build evidence collector for both
// singleton and composite Build paths. Derives git fields mechanically, reconciles planned vs.
// actual evidence rows, produces BuildEvidenceManifest JSON.
//
// Byte-identical mirror: plugin/scripts/build-evidence-collector.ts

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
  ChangedFile,
  TestRun,
  AcEvidenceRow,
  RuntimeEvidence,
  DeferredOrUnmetEntry,
  IterationArtifactRef,
  EvidenceClass,
  PlannedAcEvidence,
} from "./build-evidence-manifest.ts";
import {
  sha256File,
  resolveMilestoneRoot,
  isEvidenceClassCompatible,
} from "./build-evidence-manifest.ts";
import {
  mapEvidenceToTasks,
  type PhaseEvidence,
  type TaskEvidenceReport,
  type CompositePhase,
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
  compositeManifestFile?: string; // CompositeManifest envelope {manifest:{phases}} (composite path)
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
  gitFailureDetail?: string;
}

// ── git helpers — the fail-closed `git(args, cwd): GitResult` now lives in gate-script-base.ts
// (finding `git-helper-collector-gate`, routine semantic-dedup-scan, runId
// semantic-dedup-scan-1790995446200; this file's byte-identical local copy was removed) ─────────────

function parseNumstat(output: string): ChangedFile[] {
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

interface GitDerivation {
  baseCommit: string;
  changedFiles: ChangedFile[];
  gitFailed: boolean;
  gitFailureDetail: string;
}

/**
 * Mechanically derive baseCommit + changedFiles from git, FAILING CLOSED on a git command failure.
 * A legitimately empty diff (baseCommit === candidateCommit → no changes) is NOT a failure.
 */
function deriveGitState(candidateCommit: string, workspaceRoot: string): GitDerivation {
  if (!candidateCommit) {
    return { baseCommit: "", changedFiles: [], gitFailed: true, gitFailureDetail: "missing candidate commit" };
  }
  // Supported execution environment is a full clone with an `origin/master` ref (the workflow's
  // Build runs on `master`-derived branches; worktrees share the primary's refs). An absent
  // `origin/master` or an unknown candidate commit is a REAL failure — fail closed rather than
  // emit an un-derivable baseCommit/changedFiles manifest (M265). This is a documented accepted
  // limitation: unsupported environments (no remote/fetch) block instead of silently skipping.
  const mergeBase = git(["merge-base", "origin/master", candidateCommit], workspaceRoot);
  if (!mergeBase.ok || !mergeBase.stdout) {
    return {
      baseCommit: "",
      changedFiles: [],
      gitFailed: true,
      gitFailureDetail: `git merge-base origin/master ${candidateCommit} failed: ${mergeBase.error || "empty result"}`,
    };
  }
  const baseCommit = mergeBase.stdout;
  const diff = git(["diff", "--numstat", `${baseCommit}..${candidateCommit}`], workspaceRoot);
  if (!diff.ok) {
    return {
      baseCommit,
      changedFiles: [],
      gitFailed: true,
      gitFailureDetail: `git diff --numstat ${baseCommit}..${candidateCommit} failed: ${diff.error}`,
    };
  }
  return { baseCommit, changedFiles: parseNumstat(diff.stdout), gitFailed: false, gitFailureDetail: "" };
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

// ── per-phase evidence / iteration-report consumption (M264 mechanism 2) ──────────────────────────────

/**
 * Read the composite per-phase evidence file. Accepts a BARE `PhaseEvidence[]` (the shape
 * build-integrate writes to /tmp/composite-build-evidence-<M>-<T>.json).
 */
function readPhaseEvidence(filePath: string | undefined): PhaseEvidence[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PhaseEvidence =>
        !!e && typeof e === "object" && typeof (e as { phaseId?: unknown }).phaseId === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Read the composite manifest envelope and unwrap `.manifest.phases` (the `CompositePhase[]`
 * from composite-build.ts / composite-manifest-synthesis.ts) — the task→phase membership map.
 */
function readCompositePhases(filePath: string | undefined): CompositePhase[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const phases = (envelope as { manifest?: { phases?: unknown } })?.manifest?.phases;
    return Array.isArray(phases) ? (phases as CompositePhase[]) : [];
  } catch {
    return [];
  }
}

/**
 * Read the iteration report text — explicit `--iteration-report` path, falling back to the
 * canonical `<milestoneRoot>/iterations/iteration-0.md` when the flag is absent.
 */
function readIterationReportText(iterationReport: string | undefined, milestoneRoot: string): string {
  const candidates = [iterationReport, path.join(milestoneRoot, "iterations", "iteration-0.md")];
  for (const file of candidates) {
    if (!file) continue;
    if (!fs.existsSync(file)) continue;
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      // unreadable — try next candidate
    }
  }
  return "";
}

interface ParsedIterationEvidence {
  files: string[];
  commits: string[];
  tests: string[];
  hasEvidence: boolean;
}

/**
 * An explicit, structured real-workflow declaration (e.g. "- **Real-workflow evidence:** <path>"
 * or "Evidence class: real-workflow"). This is the ONLY prose form that credits the
 * "real-workflow" evidence class — incidental words like "journal" / "workflow run" do not.
 */
function hasExplicitRealWorkflow(reportText: string): boolean {
  return (
    /(?:^|\n)\s*(?:[-*]\s*)?\*{0,2}Real[- ]?workflow(?:\s+evidence)?\s*:/im.test(reportText) ||
    /\bevidence[- ]class\s*:\s*real[- ]workflow\b/i.test(reportText)
  );
}

/**
 * Deterministic (heuristic) extraction of evidence claims from a free-form iteration report.
 * These are ATTRIBUTED build-agent claims (producer: "build-agent"), NOT verified facts — the
 * gate/Audit enforce evidence-class compatibility and independently check the raw artifacts.
 */
function parseIterationReportEvidence(reportText: string): ParsedIterationEvidence {
  const files = new Set<string>();
  const commits = new Set<string>();
  const tests = new Set<string>();
  for (const raw of reportText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // Commit hashes (7-40 hex chars).
    for (const m of line.matchAll(/\b[0-9a-f]{7,40}\b/g)) commits.add(m[0]);

    // Test evidence: a test file/command token, or a "Tests:" line, or a test-result line.
    if (
      /(?:\.test\.mjs|\.test\.ts|\.test\.js|test\.sh|scripts\/test\.sh|npm test|node --test|vitest)/.test(line) ||
      /^\*{0,2}\s*\**Tests?\s*:/i.test(line) ||
      (/\b(GREEN|PASS|FAIL)\b/i.test(line) && /\btests?\b/i.test(line))
    ) {
      tests.add(line.replace(/^[-*\s]+/, "").trim());
    }

    // "Files changed:" lines (bullet-prefixed or plain) → the leading path token(s).
    const filesChanged = line.match(/(?:^|\n)\s*(?:[-*]\s*)?\*{0,2}Files?\s+changed\s*:\s*(.+)/i);
    if (filesChanged) {
      for (const part of filesChanged[1].split(/[,;]/)) {
        const token = part.trim().split(/\s+/)[0];
        if (token && token !== "+") files.add(token);
      }
    }

    // Generic repo path tokens.
    for (const m of line.matchAll(/(?:packages|experiments|plugin|docs|tasks|scripts|\.claude)\/[A-Za-z0-9_./-]+/g)) {
      files.add(m[0]);
    }
  }
  return {
    files: [...files],
    commits: [...commits],
    tests: [...tests],
    hasEvidence: files.size > 0 || commits.size > 0 || tests.size > 0 || hasExplicitRealWorkflow(reportText),
  };
}

/**
 * Conservative evidence-class inference. A "real-workflow" class is ONLY credited from an
 * EXPLICIT, structured declaration in the iteration report (e.g. "Real-workflow evidence: <path>"
 * or "Evidence class: real-workflow") — never from incidental prose words like "journal", "live
 * run", or "workflow run" (those would be fail-open: a report describing any ordinary activity
 * could upgrade source/unit evidence to real-workflow, defeating the evidence-class gate).
 * Tests were run → "unit"; otherwise "source". The gate re-checks class compatibility, so a
 * weaker-than-required inference still blocks (never fail-open).
 */
function inferEvidenceClass(tests: string[], reportText: string): EvidenceClass {
  if (hasExplicitRealWorkflow(reportText)) return "real-workflow";
  if (tests.length > 0) return "unit";
  return "source";
}

/** Build acEvidence actual rows from per-task reports produced by mapEvidenceToTasks (composite). */
function buildActualRowsFromPerPhaseEvidence(
  plannedAcEvidence: PlannedAcEvidence[],
  reports: TaskEvidenceReport[],
  reportText: string,
): AcEvidenceRow[] {
  const reportByTask = new Map(reports.map((r) => [r.taskId, r]));
  const rows: AcEvidenceRow[] = [];
  for (const planned of plannedAcEvidence) {
    const report = reportByTask.get(planned.taskId);
    if (!report) continue;
    const hasEvidence = report.files.length > 0 || report.commits.length > 0 || report.tests.length > 0;
    if (!hasEvidence) continue;
    rows.push({
      taskId: planned.taskId,
      acIndex: planned.acIndex,
      disposition: "satisfied",
      evidenceClass: inferEvidenceClass(report.tests, reportText),
      producer: "build-agent",
      actualCommand: report.tests.join(", "),
      actualArtifact: report.files.join(", "),
      artifactHash: "",
      detail: `per-phase evidence (producer: build-agent): phases=${report.phaseIds.join(",")} commits=${report.commits.join(",")}`,
    });
  }
  return rows;
}

/** Build acEvidence actual rows from the width-1 iteration report (single task per milestone run). */
function buildActualRowsFromIterationReport(
  plannedAcEvidence: PlannedAcEvidence[],
  reportText: string,
): AcEvidenceRow[] {
  const parsed = parseIterationReportEvidence(reportText);
  if (!parsed.hasEvidence) return [];
  const rows: AcEvidenceRow[] = [];
  for (const planned of plannedAcEvidence) {
    rows.push({
      taskId: planned.taskId,
      acIndex: planned.acIndex,
      disposition: "satisfied",
      evidenceClass: inferEvidenceClass(parsed.tests, reportText),
      producer: "build-agent",
      actualCommand: parsed.tests.join(", "),
      actualArtifact: parsed.files.join(", "),
      artifactHash: "",
      detail: `iteration report evidence (producer: build-agent): commits=${parsed.commits.join(",")}`,
    });
  }
  return rows;
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
    compositeManifestFile,
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

  // Derive git fields mechanically — FAIL CLOSED on a git command failure (M265 mechanism 3):
  // never emit a manifest with empty baseCommit/changedFiles caused by git merge-base/diff failing.
  const gitState = deriveGitState(candidateCommit, workspaceRoot);
  if (gitState.gitFailed) {
    return {
      ok: false,
      manifestPath: output,
      reason: "git-failure",
      gitFailureDetail: gitState.gitFailureDetail,
    };
  }
  const { baseCommit, changedFiles } = gitState;

  // Read admission decision
  const { decision, decisionFile, decisionHash } = readAdmissionDecision(admissionDecisionFile);

  // FAIL-CLOSED (gap-m264-build-evidence-regress-flaky, 2026-08-03): if an admission decision FILE
  // was explicitly provided but could not be read/parsed, that is an ERROR, not "no admission" —
  // silently proceeding would emit an EMPTY acEvidence manifest (buildAdmissionRef: null, no planned
  // rows) that the gate vacuously passes in advisory mode, silently dropping every evidence
  // requirement for a real milestone run. Missing admission is only legitimate when the caller did
  // NOT pass a path (width-1 / no-admission flows keep buildAdmissionRef null on purpose).
  if (admissionDecisionFile && !decision) {
    return {
      ok: false,
      manifestPath: output,
      reason: "admission-decision-unreadable",
      gitFailureDetail: `admission decision file provided but unreadable: ${admissionDecisionFile}`,
    };
  }

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

  // ── Consume per-phase evidence / iteration report into acEvidence rows (M264 mechanism 2) ──
  const phaseEvidence = readPhaseEvidence(perPhaseEvidenceFile);
  const phases = readCompositePhases(compositeManifestFile);
  const reportText = readIterationReportText(iterationReport, milestoneRoot);

  let actualRows: AcEvidenceRow[] = [];
  if (phaseEvidence.length > 0) {
    // Composite path: map per-phase evidence back to tasks via the shared mapEvidenceToTasks.
    // Requires the task→phase map (phases). Without it, per-phase evidence cannot be attributed
    // to tasks → leave all planned rows unmatched (fail-closed), never mis-credit taskIds[0].
    const taskReports = phases.length > 0
      ? mapEvidenceToTasks(phases, phaseEvidence)
      : [];
    actualRows = buildActualRowsFromPerPhaseEvidence(plannedAcEvidence, taskReports, reportText);
  } else if (!composite && reportText.trim() !== "") {
    // Width-1 path ONLY: iteration report evidence claims. A composite milestone must attribute
    // evidence per-phase; falling back to the single aggregate iteration report would credit every
    // member task from un-attributed evidence (fail-open).
    actualRows = buildActualRowsFromIterationReport(plannedAcEvidence, reportText);
  }

  // Reconcile planned vs actual evidence (real consumed rows — never the empty-array stub).
  const acEvidence = reconcileEvidence(plannedAcEvidence, actualRows);

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

/** Arity-1 adapter over the shared `flagValue`: this module's tokens come from process.argv itself. */
const argvFlag = (name: string): string | undefined => flagValue(process.argv, name);

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
    compositeManifestFile: argvFlag("--composite-manifest"),
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
    console.log(
      JSON.stringify({
        ok: false,
        manifestPath: result.manifestPath,
        reason: result.reason,
        ...(result.gitFailureDetail ? { gitFailureDetail: result.gitFailureDetail } : {}),
      }),
    );
    process.exit(1);
  }
}
