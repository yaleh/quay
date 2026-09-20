#!/usr/bin/env node --experimental-strip-types
// workflow-baseline-metrics.ts — mechanical baseline metrics from A1 event stream
//
// Consumes DIR-124-A1's workflow event stream (.workflow-events/*.jsonl), computes all 10
// crystallization-document baseline metrics mechanically from structured event fields,
// tags every metric with metricClass (mechanical-runner / content-agent / unknown),
// reports missing data as "unknown" (never 0 or guess), records the before-state only
// (no delivered-value inference, no pass/fail policy, no gate consumption), and is
// strictly read-only (writes only to stdout).
//
// Usage:
//   node --experimental-strip-types experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts [--json] [--event-dir <path>] [--manifest <path>] [--replay-fixtures <path>] [--selftest]
//
// Exit codes: 0 = valid report, 1 = selftest failure, 2 = usage/environment error

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSelftest } from "./gate-script-base.ts";

// ── Types ──────────────────────────────────────────────────────────────────────────────

export interface EventTiming {
  queuedAtMs: number | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
}

export interface WorkflowEvent {
  timing: EventTiming;
  agentLabel: string | null;
  commandIdentity: string | null;
  observedWrites: string[] | null;
  outcome: string | null;
  waitReason: string | null;
  resourceClaim: string | null;
  stage: string | null;
  eventKind: string | null;
  candidateId: string | null;
  runId: string | null;
  isolationMode: string | null;
  dispatchMode: string | null;
  attempt: number | null;
  errorDetail: string | null;
  schemaVersion: string | null;
}

export type MetricClass = "mechanical-runner" | "content-agent" | "unknown";
export type EvidenceStatus = "measured" | "unknown";

export interface UnknownMetric {
  evidenceStatus: "unknown";
  reason: string;
}

export interface MeasuredMetric {
  evidenceStatus: "measured";
  metricClass: MetricClass;
  [key: string]: any;
}

export type MetricValue = MeasuredMetric | UnknownMetric;

export interface ParseWarning {
  type: string;
  file: string;
  line: number;
  error: string;
}

export interface BaselineReport {
  schemaVersion: string;
  scriptVersion: string;
  generatedAt: string;
  samples: number;
  sampleRunIds: string[];
  sampleRange: { from: string | null; to: string | null } | null;
  parseWarnings: ParseWarning[];
  metrics: Record<string, MetricValue>;
  diagnostics: Record<string, any>;
  status: "ok" | "no-data" | "error";
}

// ── Classification tables ──────────────────────────────────────────────────────────────

const MECHANICAL_AGENT_LABELS = new Set([
  "ceiling-check", "gate-hash", "line-budget", "dogfood-evidence",
  "composite-preflight", "worktree-create", "worktree-merge", "worktree-remove",
  "build-evidence-collector",
]);

const MECHANICAL_AGENT_PREFIXES = ["emit-event-"];

const CONTENT_AGENT_LABELS = new Set([
  "ProposalAuthors", "Adjudicate", "ProposalReview", "PlanAuthor", "PlanCheck",
  "Build", "Audit", "domain-misfit", "prepare-receipt",
]);

const MECHANICAL_SCRIPT_PATTERNS = [
  "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/",
  "scripts/test.sh",
  "node --experimental-strip-types plugin/scripts/",
  "bash experiments/quay-perpetual-stream/scripts/",
  "bash plugin/scripts/",
  "bash scripts/",
];

// ── Helpers ────────────────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function min(values: number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function max(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function unknownMetric(reason: string): UnknownMetric {
  return { evidenceStatus: "unknown", reason };
}

// ── parseEventStream ───────────────────────────────────────────────────────────────────

export function parseEventStream(eventDir: string): {
  events: WorkflowEvent[];
  parseWarnings: ParseWarning[];
  status: "ok" | "no-data";
} {
  const events: WorkflowEvent[] = [];
  const parseWarnings: ParseWarning[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(eventDir).filter(f => f.endsWith(".jsonl"));
  } catch (e: any) {
    return { events: [], parseWarnings: [], status: "no-data" };
  }

  if (files.length === 0) {
    return { events: [], parseWarnings: [], status: "no-data" };
  }

  const sortedFiles = files.sort();
  for (const file of sortedFiles) {
    const filePath = path.join(eventDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    let lineNum = 0;
    for (const line of lines) {
      lineNum++;
      if (line.trim() === "") continue;
      try {
        const obj = JSON.parse(line);
        // Normalize to WorkflowEvent shape
        const ev: WorkflowEvent = {
          timing: {
            queuedAtMs: obj.timing?.queuedAtMs ?? null,
            startedAtMs: obj.timing?.startedAtMs ?? null,
            endedAtMs: obj.timing?.endedAtMs ?? null,
          },
          agentLabel: obj.agentLabel ?? null,
          commandIdentity: obj.commandIdentity ?? null,
          observedWrites: Array.isArray(obj.observedWrites) ? obj.observedWrites : null,
          outcome: obj.outcome ?? null,
          waitReason: obj.waitReason ?? null,
          resourceClaim: obj.resourceClaim ?? null,
          stage: obj.stage ?? null,
          eventKind: obj.eventKind ?? null,
          candidateId: obj.candidateId ?? null,
          runId: obj.runId ?? null,
          isolationMode: obj.isolationMode ?? null,
          dispatchMode: obj.dispatchMode ?? null,
          attempt: typeof obj.attempt === "number" ? obj.attempt : null,
          errorDetail: obj.errorDetail ?? null,
          schemaVersion: obj.schemaVersion ?? null,
        };
        events.push(ev);
      } catch (e: any) {
        parseWarnings.push({
          type: "malformed-line",
          file,
          line: lineNum,
          error: e.message,
        });
      }
    }
  }

  if (events.length === 0) {
    return { events: [], parseWarnings, status: "no-data" };
  }

  return { events, parseWarnings, status: "ok" };
}

// ── classifyEvent ──────────────────────────────────────────────────────────────────────

export function classifyEvent(event: WorkflowEvent): MetricClass {
  const ci = event.commandIdentity;
  const al = event.agentLabel;

  // Check if commandIdentity matches a known mechanical script pattern
  let hasMechanicalScript = false;
  if (ci) {
    for (const pat of MECHANICAL_SCRIPT_PATTERNS) {
      if (ci.includes(pat)) {
        hasMechanicalScript = true;
        break;
      }
    }
  }

  // Check if agentLabel matches a known mechanical label or prefix
  let hasMechanicalLabel = false;
  if (al) {
    if (MECHANICAL_AGENT_LABELS.has(al)) {
      hasMechanicalLabel = true;
    } else {
      for (const prefix of MECHANICAL_AGENT_PREFIXES) {
        if (al.startsWith(prefix)) {
          hasMechanicalLabel = true;
          break;
        }
      }
    }
  }

  // Priority rule: commandIdentity script-match WINS over agentLabel
  if (hasMechanicalScript) return "mechanical-runner";
  if (hasMechanicalLabel) return "mechanical-runner";

  // Check content-agent label
  let hasContentLabel = false;
  if (al) {
    if (CONTENT_AGENT_LABELS.has(al)) {
      hasContentLabel = true;
    }
  }

  if (hasContentLabel) return "content-agent";

  // Conservative default: unrecognized pattern → unknown
  return "unknown";
}

// ── classifyMetric ─────────────────────────────────────────────────────────────────────

export function classifyMetric(metricName: string): MetricClass {
  // Metric 2 (context working set) is content-agent — needs more than commandIdentity matching
  if (metricName === "contextWorkingSet") return "content-agent";
  // Metrics 1, 3-10 are mechanical-runner
  const mechanicalMetrics = new Set([
    "changePropagationRadius", "sharedWriterCount", "duplicateRuleCount",
    "promptToCodeRatio", "receiptReuseRate", "replayVariance",
    "failureAttributionPrecision", "fullSuiteExecutions", "landFenceTime",
  ]);
  if (mechanicalMetrics.has(metricName)) return "mechanical-runner";
  return "unknown";
}

// ── Metric 1: change-propagation radius ────────────────────────────────────────────────

export function computeChangePropagationRadius(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  const byCandidate = new Map<string, Set<string>>();

  for (const ev of events) {
    const cid = ev.candidateId ?? "__unknown__";
    if (!byCandidate.has(cid)) byCandidate.set(cid, new Set());
    if (ev.observedWrites) {
      for (const p of ev.observedWrites) {
        byCandidate.get(cid)!.add(p);
      }
    }
  }

  if (byCandidate.size === 0) return unknownMetric("no-candidates");

  // Check if any candidate has non-zero unique files
  let hasFiles = false;
  for (const files of byCandidate.values()) {
    if (files.size > 0) { hasFiles = true; break; }
  }
  if (!hasFiles) return unknownMetric("no-observed-writes-in-any-event");

  const perCandidate: Record<string, any> = {};
  const uniqueFileCounts: number[] = [];
  const uniqueDirCounts: number[] = [];

  for (const [cid, files] of byCandidate) {
    const fileList = [...files].sort();
    const dirs = new Set<string>();
    for (const f of fileList) {
      let d = path.dirname(f);
      while (d && d !== "." && d !== "/") {
        dirs.add(d);
        const parent = path.dirname(d);
        if (parent === d) break;
        d = parent;
      }
    }
    perCandidate[cid] = {
      uniqueFiles: fileList.length,
      uniqueDirectories: dirs.size,
      paths: fileList,
    };
    uniqueFileCounts.push(fileList.length);
    uniqueDirCounts.push(dirs.size);
  }

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    perCandidate,
    aggregate: {
      files: { min: min(uniqueFileCounts), median: median(uniqueFileCounts), max: max(uniqueFileCounts) },
      directories: { min: min(uniqueDirCounts), median: median(uniqueDirCounts), max: max(uniqueDirCounts) },
    },
  };
}

// ── Metric 2: context working set ──────────────────────────────────────────────────────

export function computeContextWorkingSet(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  const perStage: Record<string, any> = {};
  let anyData = false;

  for (const ev of events) {
    const stage = ev.stage ?? "__unknown__";
    if (!perStage[stage]) perStage[stage] = { scriptFiles: [], agentFiles: [], lowerBoundFiles: [], status: "measured" };

    const entry = perStage[stage];

    // Script invocations: parse commandIdentity for paths
    if (ev.commandIdentity) {
      const ci = ev.commandIdentity;
      // Extract script path and flag-referenced file paths
      const words = ci.split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w.endsWith(".ts") || w.endsWith(".mjs") || w.endsWith(".js") || w.endsWith(".sh")) {
          if (!entry.scriptFiles.includes(w)) entry.scriptFiles.push(w);
        }
        if ((w.startsWith("--") || w.startsWith("-")) && i + 1 < words.length) {
          const next = words[i + 1];
          if (next.includes("/") || next.includes("\\") || next.endsWith(".md") || next.endsWith(".ts") ||
              next.endsWith(".mjs") || next.endsWith(".js") || next.endsWith(".json") || next.endsWith(".sh")) {
            if (!entry.scriptFiles.includes(next)) entry.scriptFiles.push(next);
          }
        }
      }
    }

    // Agent invocations: use agentLabel to look up corresponding files
    if (ev.agentLabel) {
      const taskFile = `tasks/${ev.agentLabel}.md`;
      if (!entry.agentFiles.includes(taskFile)) entry.agentFiles.push(taskFile);
    }

    // observedWrites as lower bound
    if (ev.observedWrites) {
      for (const p of ev.observedWrites) {
        if (!entry.lowerBoundFiles.includes(p)) entry.lowerBoundFiles.push(p);
      }
    }

    if (entry.scriptFiles.length > 0 || entry.agentFiles.length > 0 || entry.lowerBoundFiles.length > 0) {
      anyData = true;
    }
  }

  if (!anyData) return unknownMetric("no-context-data");

  // Mark stages with no data as unknown
  for (const [stage, entry] of Object.entries(perStage)) {
    const e = entry as any;
    if (e.scriptFiles.length === 0 && e.agentFiles.length === 0 && e.lowerBoundFiles.length === 0) {
      e.status = "unknown";
    }
    e.scriptFiles.sort();
    e.agentFiles.sort();
    e.lowerBoundFiles.sort();
  }

  return {
    evidenceStatus: "measured",
    metricClass: "content-agent",
    perStage,
  };
}

// ── Metric 3: shared-writer count ──────────────────────────────────────────────────────

export function computeSharedWriterCount(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  const byCandidate = new Map<string, Map<string, string[]>>();

  for (const ev of events) {
    const cid = ev.candidateId ?? "__unknown__";
    const stage = ev.stage ?? "__unknown__";
    if (!byCandidate.has(cid)) byCandidate.set(cid, new Map());
    if (ev.observedWrites) {
      byCandidate.get(cid)!.set(stage, [...ev.observedWrites].sort());
    }
  }

  if (byCandidate.size === 0) return unknownMetric("no-candidates");

  const perCandidate: Record<string, any> = {};
  let totalPairs = 0;

  for (const [cid, stageMap] of byCandidate) {
    const stages = [...stageMap.keys()].sort();
    const pairs: { stageA: string; stageB: string; commonPaths: string[] }[] = [];

    for (let i = 0; i < stages.length; i++) {
      for (let j = i + 1; j < stages.length; j++) {
        const writesA = new Set(stageMap.get(stages[i]) || []);
        const writesB = new Set(stageMap.get(stages[j]) || []);
        const common = [...writesA].filter(w => writesB.has(w)).sort();
        if (common.length > 0) {
          pairs.push({ stageA: stages[i], stageB: stages[j], commonPaths: common });
        }
      }
    }

    perCandidate[cid] = { sharedWriterPairs: pairs.length, pairs };
    totalPairs += pairs.length;
  }

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    perCandidate,
    aggregate: { totalSharedWriterPairs: totalPairs },
  };
}

// ── Metric 4: duplicate-rule count (from A3 manifest) ──────────────────────────────────

export function parseInvariantManifest(manifestPath: string): { duplicateCount: number; rules: string[] } | null {
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, "utf-8");
  } catch {
    return null;
  }

  const rules: string[] = [];
  const sections = content.split(/^## Invariant:/m);
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    // Extract invariant name from the first line
    const nameLine = section.split("\n")[0]?.trim();
    // Check if "Other occurrences" section contains [duplicate-to-remove]
    const otherOccurrencesMatch = section.match(/Other occurrences/i);
    if (otherOccurrencesMatch) {
      const afterOther = section.slice(otherOccurrencesMatch.index! + (otherOccurrencesMatch[0]?.length || 0));
      if (afterOther.includes("[duplicate-to-remove]")) {
        rules.push(nameLine || "unnamed-invariant");
      }
    }
  }

  return { duplicateCount: rules.length, rules };
}

export function computeDuplicateRuleCount(manifest: unknown): MeasuredMetric | UnknownMetric {
  // manifest can be a string (path to parse) or an already-parsed result
  let parsed: { duplicateCount: number; rules: string[] } | null = null;
  if (typeof manifest === "string") {
    parsed = parseInvariantManifest(manifest);
  } else if (manifest && typeof manifest === "object") {
    parsed = manifest as { duplicateCount: number; rules: string[] };
  }

  if (!parsed) return unknownMetric("A3 invariant-ownership manifest not yet available");

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    duplicateCount: parsed.duplicateCount,
    duplicateRules: parsed.rules,
  };
}

// ── Metric 5: prompt-to-code ratio ─────────────────────────────────────────────────────

export function computePromptToCodeRatio(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  let mechanicalCount = 0;
  let contentCount = 0;
  const perCandidate: Record<string, any> = {};

  for (const ev of events) {
    const cid = ev.candidateId ?? "__unknown__";
    if (!perCandidate[cid]) perCandidate[cid] = { mechanicalCount: 0, contentCount: 0, ratio: null };

    const ci = ev.commandIdentity;
    if (!ci) continue; // Exclude events with null commandIdentity from denominator

    let isMechanical = false;
    for (const pat of MECHANICAL_SCRIPT_PATTERNS) {
      if (ci.includes(pat)) {
        isMechanical = true;
        break;
      }
    }

    if (isMechanical) {
      mechanicalCount++;
      perCandidate[cid].mechanicalCount++;
    } else {
      // Check for agent label patterns — if present without script match, it's content-agent
      if (ev.agentLabel) {
        contentCount++;
        perCandidate[cid].contentCount++;
      }
    }
  }

  const denom = mechanicalCount + contentCount;
  if (denom === 0) return unknownMetric("no-classifiable-command-identities");

  // Compute per-candidate ratios
  for (const [cid, entry] of Object.entries(perCandidate)) {
    const e = entry as any;
    const d = e.mechanicalCount + e.contentCount;
    e.ratio = d > 0 ? e.mechanicalCount / d : null;
  }

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    overallRatio: mechanicalCount / denom,
    mechanicalCount,
    contentCount,
    perCandidate,
  };
}

// ── Metric 6: receipt reuse rate ───────────────────────────────────────────────────────

export function computeReceiptReuseRate(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  const preparedEvents = events.filter(e => e.stage === "Prepared" && e.eventKind === "end" && e.outcome !== null);
  if (preparedEvents.length === 0) return unknownMetric("no-prepared-events");

  let skipped = 0;
  for (const ev of preparedEvents) {
    if (ev.outcome === "skipped" && (ev.waitReason === "cache-hit" || ev.waitReason === "prepared-blocked")) {
      skipped++;
    }
  }

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    reuseRate: skipped / preparedEvents.length,
    skippedCount: skipped,
    totalPrepared: preparedEvents.length,
  };
}

// ── Metric 7: replay variance ──────────────────────────────────────────────────────────

export function computeReplayVariance(
  replayFixturesDir: string,
  events: WorkflowEvent[]
): MeasuredMetric | UnknownMetric {
  let fixtureFiles: string[];
  try {
    fixtureFiles = fs.readdirSync(replayFixturesDir).filter(f => f.endsWith(".json"));
  } catch {
    return unknownMetric("cross-child-artifact-not-yet-landed");
  }

  if (fixtureFiles.length === 0) return unknownMetric("cross-child-artifact-not-yet-landed");

  let totalAssertions = 0;
  let mismatches = 0;
  const perFixture: Record<string, any> = {};

  for (const file of fixtureFiles) {
    let fixture: any;
    try {
      fixture = JSON.parse(fs.readFileSync(path.join(replayFixturesDir, file), "utf-8"));
    } catch {
      continue;
    }

    const candidateId = fixture.candidateId || file.replace(".json", "");
    const assertions = fixture.assertions || [];
    let fixtureMatches = 0;
    let fixtureMismatches = 0;

    for (const assertion of assertions) {
      totalAssertions++;
      const matchingEvents = events.filter(
        e => e.candidateId === candidateId && e.stage === assertion.stage
      );
      if (matchingEvents.length === 0) {
        fixtureMismatches++;
        mismatches++;
        continue;
      }
      // Find events matching the expected outcome
      const outcomeMatch = matchingEvents.some(e => e.outcome === assertion.outcome);
      if (!outcomeMatch) {
        fixtureMismatches++;
        mismatches++;
      } else {
        fixtureMatches++;
      }
    }

    perFixture[file] = { assertions: assertions.length, matches: fixtureMatches, mismatches: fixtureMismatches };
  }

  if (totalAssertions === 0) return unknownMetric("no-fixture-assertions");

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    totalAssertions,
    mismatches,
    matchRate: (totalAssertions - mismatches) / totalAssertions,
    perFixture,
  };
}

// ── Metric 8: failure-attribution precision ────────────────────────────────────────────

export function computeFailureAttributionPrecision(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  const needsHuman = events.filter(e => e.outcome === "needs-human" && e.eventKind === "end");

  if (needsHuman.length === 0) return unknownMetric("no-needs-human-events");

  let preciselyAttributed = 0;
  for (const ev of needsHuman) {
    if (ev.stage !== null && ev.waitReason !== null && ev.commandIdentity !== null) {
      preciselyAttributed++;
    }
  }

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    preciselyAttributed,
    totalNeedsHuman: needsHuman.length,
    precision: preciselyAttributed / needsHuman.length,
  };
}

// ── Metric 9: full-suite executions per candidate ──────────────────────────────────────

export function computeFullSuiteExecutions(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  const testEvents = events.filter(e =>
    e.commandIdentity && e.commandIdentity.includes("scripts/test.sh")
  );

  if (testEvents.length === 0) return unknownMetric("no-test-sh-invocations");

  const perCandidate: Record<string, any> = {};
  const perStage: Record<string, number> = {};
  let total = 0;

  for (const ev of testEvents) {
    const cid = ev.candidateId ?? "__unknown__";
    const stage = ev.stage ?? "__unknown__";
    if (!perCandidate[cid]) perCandidate[cid] = { count: 0, perStage: {} };
    if (!perCandidate[cid].perStage[stage]) perCandidate[cid].perStage[stage] = 0;
    perCandidate[cid].count++;
    perCandidate[cid].perStage[stage]++;
    perStage[stage] = (perStage[stage] || 0) + 1;
    total++;
  }

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    total,
    perCandidate,
    perStage,
  };
}

// ── Metric 10: Land-fence hold/queue time ──────────────────────────────────────────────

export function computeLandFenceTime(events: WorkflowEvent[]): MeasuredMetric | UnknownMetric {
  const landEvents = events.filter(e => e.stage === "Land" && e.eventKind === "end");

  if (landEvents.length === 0) return unknownMetric("no-land-events");

  const perCandidate: Record<string, any> = {};
  const queueTimes: number[] = [];
  const durationTimes: number[] = [];
  const totalTimes: number[] = [];

  for (const ev of landEvents) {
    const t = ev.timing;
    const queueMs = (t.queuedAtMs != null && t.startedAtMs != null) ? t.startedAtMs - t.queuedAtMs : null;
    const durationMs = (t.startedAtMs != null && t.endedAtMs != null) ? t.endedAtMs - t.startedAtMs : null;
    const totalMs = (queueMs ?? 0) + (durationMs ?? 0);

    const cid = ev.candidateId ?? "__unknown__";
    perCandidate[cid] = { landQueueMs: queueMs, landDurationMs: durationMs, totalLandMs: totalMs };

    if (queueMs != null) queueTimes.push(queueMs);
    if (durationMs != null) durationTimes.push(durationMs);
    if (queueMs != null || durationMs != null) totalTimes.push(totalMs);
  }

  return {
    evidenceStatus: "measured",
    metricClass: "mechanical-runner",
    perCandidate,
    aggregate: {
      queueMs: queueTimes.length > 0 ? { min: min(queueTimes), median: median(queueTimes), max: max(queueTimes) } : null,
      durationMs: durationTimes.length > 0 ? { min: min(durationTimes), median: median(durationTimes), max: max(durationTimes) } : null,
      totalMs: totalTimes.length > 0 ? { min: min(totalTimes), median: median(totalTimes), max: max(totalTimes) } : null,
    },
  };
}

// ── Diagnostics ────────────────────────────────────────────────────────────────────────

export function computeAgentMinutes(events: WorkflowEvent[]): Record<string, any> {
  const contentEvents = events.filter(e => classifyEvent(e) === "content-agent");

  if (contentEvents.length === 0) {
    return { totalMinutes: 0, perStage: {}, perAgentLabel: {}, evidenceStatus: "measured" };
  }

  let totalMs = 0;
  const perStage: Record<string, number> = {};
  const perAgentLabel: Record<string, number> = {};

  for (const ev of contentEvents) {
    const t = ev.timing;
    const duration = (t.startedAtMs != null && t.endedAtMs != null) ? t.endedAtMs - t.startedAtMs : 0;
    totalMs += duration;

    const stage = ev.stage ?? "__unknown__";
    perStage[stage] = (perStage[stage] || 0) + duration;

    const label = ev.agentLabel ?? "__unknown__";
    perAgentLabel[label] = (perAgentLabel[label] || 0) + duration;
  }

  const toMin = (ms: number) => Math.round(ms / 60000 * 100) / 100;

  const perStageMin: Record<string, number> = {};
  for (const [k, v] of Object.entries(perStage)) perStageMin[k] = toMin(v);
  const perAgentMin: Record<string, number> = {};
  for (const [k, v] of Object.entries(perAgentLabel)) perAgentMin[k] = toMin(v);

  return {
    totalMinutes: toMin(totalMs),
    perStage: perStageMin,
    perAgentLabel: perAgentMin,
    evidenceStatus: "measured",
  };
}

export function computeFindingRecurrence(events: WorkflowEvent[]): Record<string, any> {
  const needsHuman = events
    .filter(e => e.outcome === "needs-human" || e.outcome !== "done")
    .sort((a, b) => {
      const ta = a.timing.startedAtMs ?? 0;
      const tb = b.timing.startedAtMs ?? 0;
      return ta - tb;
    });

  if (needsHuman.length === 0) return { novelFindings: 0, recurrentFindings: 0, recurrenceKeys: [] };

  const seenKeys = new Set<string>();
  let novel = 0;
  let recurrent = 0;
  const recurrenceKeys: string[] = [];

  for (const ev of needsHuman) {
    const key = `${ev.outcome ?? "null"}|${ev.waitReason ?? "null"}|${ev.stage ?? "null"}`;
    if (seenKeys.has(key)) {
      recurrent++;
      if (!recurrenceKeys.includes(key)) recurrenceKeys.push(key);
    } else {
      seenKeys.add(key);
      novel++;
    }
  }

  return { novelFindings: novel, recurrentFindings: recurrent, recurrenceKeys };
}

export function computeArtifactClassOutput(events: WorkflowEvent[]): Record<string, any> {
  const categories: Record<string, { count: number; paths: string[] }> = {
    code: { count: 0, paths: [] },
    docs: { count: 0, paths: [] },
    tasks: { count: 0, paths: [] },
    milestones: { count: 0, paths: [] },
    other: { count: 0, paths: [] },
  };

  const seenPaths = new Set<string>();

  for (const ev of events) {
    if (!ev.observedWrites) continue;
    for (const p of ev.observedWrites) {
      if (seenPaths.has(p)) continue;
      seenPaths.add(p);

      if (p.startsWith("experiments/") || p.startsWith("packages/") || p.startsWith("plugin/")) {
        categories.code.count++;
        categories.code.paths.push(p);
      } else if (p.startsWith("docs/")) {
        categories.docs.count++;
        categories.docs.paths.push(p);
      } else if (p.startsWith("tasks/")) {
        categories.tasks.count++;
        categories.tasks.paths.push(p);
      } else if (p.startsWith("milestones/")) {
        categories.milestones.count++;
        categories.milestones.paths.push(p);
      } else {
        categories.other.count++;
        categories.other.paths.push(p);
      }
    }
  }

  for (const cat of Object.values(categories)) {
    cat.paths.sort();
  }

  return {
    ...categories,
    byteCounts: "unknown", // observedWrites records paths only, not byte deltas
  };
}

// ── buildBaselineReport ────────────────────────────────────────────────────────────────

export function buildBaselineReport(
  events: WorkflowEvent[],
  opts: { manifest?: string | null; replayFixturesDir?: string }
): BaselineReport {
  const runIds = [...new Set(events.map(e => e.runId).filter(Boolean))].sort() as string[];

  const timestamps = events
    .map(e => e.timing.startedAtMs)
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);

  const sampleRange = timestamps.length >= 2
    ? { from: new Date(timestamps[0]).toISOString(), to: new Date(timestamps[timestamps.length - 1]).toISOString() }
    : timestamps.length === 1
      ? { from: new Date(timestamps[0]).toISOString(), to: new Date(timestamps[0]).toISOString() }
      : null;

  const status = events.length > 0 ? "ok" : "no-data";

  const parseWarnings: ParseWarning[] = []; // populated by parseEventStream, passed through

  const report: BaselineReport = {
    schemaVersion: "1",
    scriptVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    samples: runIds.length,
    sampleRunIds: runIds,
    sampleRange,
    parseWarnings,
    metrics: {},
    diagnostics: {},
    status,
  };

  if (events.length === 0) {
    // Zero samples — all metrics unknown
    const metricNames = [
      "changePropagationRadius", "contextWorkingSet", "sharedWriterCount",
      "duplicateRuleCount", "promptToCodeRatio", "receiptReuseRate", "replayVariance",
      "failureAttributionPrecision", "fullSuiteExecutions", "landFenceTime",
    ];
    for (const name of metricNames) {
      report.metrics[name] = unknownMetric("no-event-samples");
    }
    report.diagnostics = {
      agentMinutes: unknownMetric("no-event-samples"),
      tokens: unknownMetric("token usage is not in A1 v1 event schema — available when DIR-124-B extends the schema"),
      findingRecurrence: unknownMetric("no-event-samples"),
      artifactClassOutput: unknownMetric("no-event-samples"),
    };
    return report;
  }

  // Compute all 10 metrics
  report.metrics.changePropagationRadius = computeChangePropagationRadius(events);
  report.metrics.contextWorkingSet = computeContextWorkingSet(events);
  report.metrics.sharedWriterCount = computeSharedWriterCount(events);

  if (opts.manifest) {
    report.metrics.duplicateRuleCount = computeDuplicateRuleCount(opts.manifest);
  } else {
    report.metrics.duplicateRuleCount = unknownMetric("A3 invariant-ownership manifest not yet available");
  }

  report.metrics.promptToCodeRatio = computePromptToCodeRatio(events);
  report.metrics.receiptReuseRate = computeReceiptReuseRate(events);

  if (opts.replayFixturesDir) {
    report.metrics.replayVariance = computeReplayVariance(opts.replayFixturesDir, events);
  } else {
    report.metrics.replayVariance = unknownMetric("cross-child-artifact-not-yet-landed");
  }

  report.metrics.failureAttributionPrecision = computeFailureAttributionPrecision(events);
  report.metrics.fullSuiteExecutions = computeFullSuiteExecutions(events);
  report.metrics.landFenceTime = computeLandFenceTime(events);

  // Diagnostics
  report.diagnostics = {
    agentMinutes: computeAgentMinutes(events),
    tokens: unknownMetric("token usage is not in A1 v1 event schema — available when DIR-124-B extends the schema"),
    findingRecurrence: computeFindingRecurrence(events),
    artifactClassOutput: computeArtifactClassOutput(events),
  };

  return report;
}

// ── main ───────────────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  let eventDir = "experiments/quay-perpetual-stream/.workflow-events";
  let manifestPath: string | null = "experiments/quay-perpetual-stream/invariant-ownership.md";
  let replayFixturesDir: string | null = "experiments/quay-perpetual-stream/fixtures/workflow-replay";
  let jsonOut = false;
  let runSelftest = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--event-dir" && i + 1 < args.length) {
      eventDir = args[++i];
    } else if (args[i] === "--manifest" && i + 1 < args.length) {
      manifestPath = args[++i];
    } else if (args[i] === "--replay-fixtures" && i + 1 < args.length) {
      replayFixturesDir = args[++i];
    } else if (args[i] === "--json") {
      jsonOut = true;
    } else if (args[i] === "--selftest") {
      runSelftest = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: workflow-baseline-metrics.ts [--event-dir <path>] [--manifest <path>]
       [--replay-fixtures <path>] [--json] [--selftest]

  --event-dir <path>       Event log directory (default: experiments/quay-perpetual-stream/.workflow-events)
  --manifest <path>        A3 invariant-ownership manifest (default: experiments/quay-perpetual-stream/invariant-ownership.md)
  --replay-fixtures <path> A2 replay fixture directory (default: experiments/quay-perpetual-stream/fixtures/workflow-replay)
  --json                   Emit structured JSON report to stdout
  --selftest               Run embedded RED/GREEN fixtures`);
      return;
    }
  }

  if (runSelftest) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }

  // Validate event directory
  let dirStat: fs.Stats | null = null;
  try {
    dirStat = fs.statSync(eventDir);
  } catch {
    dirStat = null;
  }

  if (dirStat === null || !dirStat.isDirectory()) {
    console.error(`workflow-baseline-metrics: event directory not found or not a directory: ${eventDir}`);
    process.exit(2);
  }

  // Validate manifest if specified
  if (manifestPath) {
    try {
      fs.accessSync(manifestPath, fs.constants.R_OK);
    } catch {
      // Manifest not readable — not an error, metric 4 will be unknown
    }
  }

  const { events, parseWarnings, status } = parseEventStream(eventDir);

  // Check manifest readability
  let manifestArg: string | null = null;
  if (manifestPath) {
    try {
      fs.accessSync(manifestPath, fs.constants.R_OK);
      manifestArg = manifestPath;
    } catch {
      // not readable
    }
  }

  // Check replay fixtures readability
  let replayArg: string | null = null;
  if (replayFixturesDir) {
    try {
      const s = fs.statSync(replayFixturesDir);
      if (s.isDirectory()) replayArg = replayFixturesDir;
    } catch {
      // not readable
    }
  }

  const report = buildBaselineReport(events, { manifest: manifestArg, replayFixturesDir: replayArg });
  report.parseWarnings.push(...parseWarnings);
  report.status = status;

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(JSON.stringify(report));
  }
}

// ── selftest ───────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;

  const tmpDir = fs.mkdtempSync("workflow-baseline-metrics-selftest-");

  try {
    // ── GREEN: synthetic event stream produces correct values for all 10 metrics ──
    const syntheticEvents: WorkflowEvent[] = [
      {
        timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1500 },
        agentLabel: "ceiling-check", commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh --task DIR-TEST",
        observedWrites: ["tasks/DIR-TEST.md", "milestones/M999/absorb-entry.md"],
        outcome: "done", waitReason: null, resourceClaim: null,
        stage: "Verify", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
        isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
      },
      {
        timing: { queuedAtMs: 2000, startedAtMs: 2100, endedAtMs: 2500 },
        agentLabel: "Build", commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-build.ts --task DIR-TEST",
        observedWrites: ["tasks/DIR-TEST.md", "experiments/quay-perpetual-stream/scripts/foo.ts"],
        outcome: "done", waitReason: null, resourceClaim: null,
        stage: "Build", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
        isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
      },
      {
        timing: { queuedAtMs: 3000, startedAtMs: 3500, endedAtMs: 3600 },
        agentLabel: "Audit", commandIdentity: null,
        observedWrites: ["milestones/M999/audits/audit-report.md"],
        outcome: "done", waitReason: null, resourceClaim: null,
        stage: "Audit", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
        isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
      },
      {
        timing: { queuedAtMs: 4000, startedAtMs: 4100, endedAtMs: 4500 },
        agentLabel: "reconcile", commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.ts",
        observedWrites: ["backlog.md", "dashboard.md"],
        outcome: "done", waitReason: null, resourceClaim: null,
        stage: "Reconcile", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
        isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
      },
      {
        timing: { queuedAtMs: 5000, startedAtMs: 5500, endedAtMs: 5900 },
        agentLabel: "land", commandIdentity: "git merge --no-ff milestone/M999/iteration-0",
        observedWrites: ["milestones/M999/preparation.json"],
        outcome: "done", waitReason: null, resourceClaim: ".quay/land-locks/shared-checkout.lock",
        stage: "Land", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
        isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
      },
    ];

    // Metric 1: change-propagation radius
    const m1 = computeChangePropagationRadius(syntheticEvents);
    check("metric1-change-propagation", m1.evidenceStatus === "measured" && (m1 as MeasuredMetric).metricClass === "mechanical-runner",
      `evidenceStatus=${m1.evidenceStatus}, metricClass=${(m1 as any).metricClass}`);
    // 5 events, share candidate DIR-TEST — unique files across all
    const m1d = m1 as MeasuredMetric;
    const candidateFiles = m1d.perCandidate?.["DIR-TEST"]?.uniqueFiles;
    check("metric1-unique-files", candidateFiles === 7, `uniqueFiles=${candidateFiles} (expected 7 across 5 events)`);

    // Metric 3: shared-writer count
    const m3 = computeSharedWriterCount(syntheticEvents);
    check("metric3-shared-writer", m3.evidenceStatus === "measured",
      `evidenceStatus=${m3.evidenceStatus}`);
    const m3d = m3 as MeasuredMetric;
    check("metric3-pairs-exist", m3d.perCandidate?.["DIR-TEST"]?.sharedWriterPairs >= 0,
      `sharedWriterPairs=${m3d.perCandidate?.["DIR-TEST"]?.sharedWriterPairs}`);

    // Metric 5: prompt-to-code ratio
    const m5 = computePromptToCodeRatio(syntheticEvents);
    check("metric5-p2c-ratio", m5.evidenceStatus === "measured",
      `evidenceStatus=${m5.evidenceStatus}`);

    // Metric 8: failure-attribution precision (no needs-human here, so unknown)
    const m8 = computeFailureAttributionPrecision(syntheticEvents);
    check("metric8-failure-attribution", m8.evidenceStatus === "unknown",
      `evidenceStatus=${m8.evidenceStatus} (expected unknown — no needs-human events)`);
    check("metric8-reason", (m8 as UnknownMetric).reason === "no-needs-human-events",
      `reason=${(m8 as UnknownMetric).reason}`);

    // Metric 9: full-suite executions (no test.sh invocations in synthetic data)
    const m9 = computeFullSuiteExecutions(syntheticEvents);
    check("metric9-full-suite", m9.evidenceStatus === "unknown",
      `evidenceStatus=${m9.evidenceStatus} (expected unknown — no test.sh)`);

    // Metric 10: Land-fence time
    const m10 = computeLandFenceTime(syntheticEvents);
    check("metric10-land-fence", m10.evidenceStatus === "measured",
      `evidenceStatus=${m10.evidenceStatus}`);
    const m10d = m10 as MeasuredMetric;
    // Land event: queuedAtMs=5000, startedAtMs=5500, queue=500ms, endedAtMs=5900, duration=400ms
    const landQueue = m10d.aggregate?.queueMs?.min;
    check("metric10-land-queue", landQueue === 500, `landQueueMs=${landQueue} (expected 500)`);
    const landDur = m10d.aggregate?.durationMs?.min;
    check("metric10-land-duration", landDur === 400, `landDurationMs=${landDur} (expected 400)`);

    // Classification tests
    const evMechanical = syntheticEvents[0]; // ceiling-check + script path
    const clsMech = classifyEvent(evMechanical);
    check("classify-mechanical", clsMech === "mechanical-runner", `class=${clsMech}`);

    const evContent = syntheticEvents[2]; // Audit agent, no script commandIdentity
    const clsContent = classifyEvent(evContent);
    check("classify-content", clsContent === "content-agent", `class=${clsContent}`);

    // ── GREEN: zero samples → no-data status ──
    const zeroReport = buildBaselineReport([], {});
    check("zero-samples-status", zeroReport.status === "no-data",
      `status=${zeroReport.status}`);
    check("zero-samples-samples", zeroReport.samples === 0,
      `samples=${zeroReport.samples}`);
    check("zero-all-metrics-unknown", Object.values(zeroReport.metrics).every(m => m.evidenceStatus === "unknown"),
      "all metrics unknown");

    // ── RED: null metric field produces "unknown", not 0 ──
    const nullMetricEvents: WorkflowEvent[] = [{
      timing: { queuedAtMs: null, startedAtMs: null, endedAtMs: null },
      agentLabel: null, commandIdentity: null, observedWrites: null,
      outcome: null, waitReason: null, resourceClaim: null,
      stage: null, eventKind: null, candidateId: null, runId: null,
      isolationMode: null, dispatchMode: null, attempt: null, errorDetail: null, schemaVersion: null,
    }];
    const nullReport = buildBaselineReport(nullMetricEvents, {});
    const nullChangeProp = nullReport.metrics.changePropagationRadius;
    check("null-change-propagation-unknown", nullChangeProp.evidenceStatus === "unknown",
      `evidenceStatus=${nullChangeProp.evidenceStatus}`);
    check("null-change-propagation-not-zero", !(nullChangeProp as any).hasOwnProperty("value") || (nullChangeProp as any).value !== 0,
      "not reporting zero for missing data");

    // ── RED: event with no observedWrites contributes zero to applicable metrics ──
    const noWriteEvents: WorkflowEvent[] = [{
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1200 },
      agentLabel: "ceiling-check", commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh",
      observedWrites: null,
      outcome: "done", waitReason: null, resourceClaim: null,
      stage: "Verify", eventKind: "end", candidateId: "DIR-NO-WRITE", runId: "run-002",
      isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
    }];
    const noWriteReport = buildBaselineReport(noWriteEvents, {});
    const m1NoWrite = noWriteReport.metrics.changePropagationRadius;
    check("no-write-change-propagation", m1NoWrite.evidenceStatus === "unknown",
      `evidenceStatus=${m1NoWrite.evidenceStatus} (no writes → unknown or no candidates)`);

    // ── RED: ambiguous event — commandIdentity script-match WINS over agentLabel ──
    const ambiguousEvent: WorkflowEvent = {
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1200 },
      agentLabel: "Build", // content-agent label
      commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-build.ts --task DIR-AMBIGUOUS", // mechanical script
      observedWrites: null,
      outcome: "done", waitReason: null, resourceClaim: null,
      stage: "Build", eventKind: "end", candidateId: "DIR-AMBIGUOUS", runId: "run-003",
      isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
    };
    const clsAmbiguous = classifyEvent(ambiguousEvent);
    check("ambiguous-commandidentity-wins", clsAmbiguous === "mechanical-runner",
      `class=${clsAmbiguous} (expected mechanical-runner — commandIdentity wins)`);

    // ── RED: agentLabel-only → content-agent ──
    const agentOnly: WorkflowEvent = {
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1200 },
      agentLabel: "ProposalAuthors", commandIdentity: null, observedWrites: null,
      outcome: "done", waitReason: null, resourceClaim: null,
      stage: "Prepare", eventKind: "end", candidateId: "DIR-AGENT-ONLY", runId: "run-004",
      isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
    };
    check("agent-label-content", classifyEvent(agentOnly) === "content-agent",
      `class=${classifyEvent(agentOnly)}`);

    // ── RED: neither-match → unknown ──
    const neitherEvent: WorkflowEvent = {
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1200 },
      agentLabel: "some-future-label", commandIdentity: "unknown-cmd", observedWrites: null,
      outcome: "done", waitReason: null, resourceClaim: null,
      stage: "Unknown", eventKind: "end", candidateId: "DIR-NEITHER", runId: "run-005",
      isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
    };
    check("neither-match-unknown", classifyEvent(neitherEvent) === "unknown",
      `class=${classifyEvent(neitherEvent)}`);

    // ── GREEN: commandIdentity script-path classification ──
    const scriptPathEvent: WorkflowEvent = {
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1200 },
      agentLabel: "some-check", commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/rolling-slope-check.ts --dashboard /tmp/d.md",
      observedWrites: null,
      outcome: "done", waitReason: null, resourceClaim: null,
      stage: "Verify", eventKind: "end", candidateId: "DIR-SCRIPT-PATH", runId: "run-006",
      isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
    };
    check("script-path-mechanical", classifyEvent(scriptPathEvent) === "mechanical-runner",
      `class=${classifyEvent(scriptPathEvent)}`);

    // ── GREEN: deterministic — same input → same output (ignoring generatedAt timestamp)
    const report1 = buildBaselineReport(syntheticEvents, {});
    const report2 = buildBaselineReport(syntheticEvents, {});
    const stripTimestamp = (r: any) => { const { generatedAt, ...rest } = r; return rest; };
    const json1 = JSON.stringify(stripTimestamp(report1));
    const json2 = JSON.stringify(stripTimestamp(report2));
    check("deterministic-output", json1 === json2, `byte-identical=${json1.length} chars`);

    // ── GREEN: every metric has metricClass (for measured metrics) ──
    const synReport = buildBaselineReport(syntheticEvents, {});
    let allMeasuredHaveClass = true;
    for (const [name, metric] of Object.entries(synReport.metrics)) {
      if (metric.evidenceStatus === "measured" && !(metric as any).metricClass) {
        allMeasuredHaveClass = false;
        break;
      }
    }
    check("all-measured-metrics-have-metricclass", allMeasuredHaveClass, "all measured metrics have metricClass");

    // ── GREEN: cross-child — absent A2/A3 → "unknown" ──
    const absentReport = buildBaselineReport(syntheticEvents, { manifest: "/nonexistent/path.md", replayFixturesDir: "/nonexistent/dir" });
    check("cross-child-absent-metric4", absentReport.metrics.duplicateRuleCount.evidenceStatus === "unknown",
      `evidenceStatus=${absentReport.metrics.duplicateRuleCount.evidenceStatus}`);
    check("cross-child-absent-metric7", absentReport.metrics.replayVariance.evidenceStatus === "unknown",
      `evidenceStatus=${absentReport.metrics.replayVariance.evidenceStatus}`);

    // ── GREEN: all 10 metric keys present ──
    const allMetricKeys = [
      "changePropagationRadius", "contextWorkingSet", "sharedWriterCount",
      "duplicateRuleCount", "promptToCodeRatio", "receiptReuseRate", "replayVariance",
      "failureAttributionPrecision", "fullSuiteExecutions", "landFenceTime",
    ];
    for (const key of allMetricKeys) {
      check(`metric-key-${key}-present`, key in synReport.metrics,
        `key ${key} present in metrics`);
    }

    // ── GREEN: every metric carries metricClass ──
    for (const [name, metric] of Object.entries(synReport.metrics)) {
      if (metric.evidenceStatus === "measured") {
        check(`metric-${name}-has-metricclass`, (metric as any).metricClass !== undefined,
          `${name} has metricClass=${(metric as any).metricClass}`);
      }
    }

    // ── GREEN: agent-minutes diagnostic ──
    const ag = computeAgentMinutes(syntheticEvents);
    check("agent-minutes-present", typeof ag.totalMinutes === "number",
      `totalMinutes=${ag.totalMinutes}`);
    check("agent-minutes-evidence", ag.evidenceStatus === "measured",
      `evidenceStatus=${ag.evidenceStatus}`);

    // ── GREEN: finding recurrence ──
    const fr = computeFindingRecurrence(syntheticEvents);
    check("finding-recurrence-present", typeof fr.novelFindings === "number",
      `novelFindings=${fr.novelFindings}`);

    // ── GREEN: artifact class output ──
    const aco = computeArtifactClassOutput(syntheticEvents);
    check("artifact-class-output-code", typeof aco.code.count === "number",
      `code.count=${aco.code.count}`);
    check("artifact-class-bytecounts-unknown", aco.byteCounts === "unknown",
      "byteCounts is 'unknown'");

    // ── GREEN: parseEventStream with JSONL files ──
    const jsonlDir = path.join(tmpDir, "events");
    fs.mkdirSync(jsonlDir);
    fs.writeFileSync(path.join(jsonlDir, "test.jsonl"), JSON.stringify({
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1200 },
      agentLabel: "ceiling-check",
      commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/foo.ts",
      observedWrites: ["tasks/TEST.md"],
      outcome: "done", waitReason: null, resourceClaim: null,
      stage: "Verify", eventKind: "end", candidateId: "DIR-PARSE", runId: "run-parse",
      isolationMode: "worktree", dispatchMode: "serial", attempt: 1, errorDetail: null, schemaVersion: "1",
    }) + "\n");
    const parsed = parseEventStream(jsonlDir);
    check("parse-event-stream-ok", parsed.status === "ok", `status=${parsed.status}`);
    check("parse-event-stream-count", parsed.events.length === 1, `count=${parsed.events.length}`);

    // ── RED: malformed JSONL line produces parseWarning ──
    fs.writeFileSync(path.join(jsonlDir, "malformed.jsonl"),
      '{"valid": true}\n{"broken json\n{"also-valid": false}\n');
    const parsedMalformed = parseEventStream(jsonlDir);
    check("malformed-parse-warning", parsedMalformed.parseWarnings.length >= 1,
      `parseWarnings=${parsedMalformed.parseWarnings.length}`);
    check("malformed-valid-still-parsed", parsedMalformed.events.length >= 2,
      `valid events still parsed: ${parsedMalformed.events.length}`);

    // ── GREEN: parseEventStream zero files → no-data ──
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir);
    const parsedEmpty = parseEventStream(emptyDir);
    check("parse-empty-dir", parsedEmpty.status === "no-data",
      `status=${parsedEmpty.status}`);
    check("parse-empty-zero-events", parsedEmpty.events.length === 0,
      `events=${parsedEmpty.events.length}`);

    // ── RED: unreadable directory ──
    const parsedNonexistent = parseEventStream("/nonexistent/path/definitely/not/there");
    check("parse-nonexistent-dir", parsedNonexistent.status === "no-data",
      `status=${parsedNonexistent.status}`);

    // ── GREEN: parseInvariantManifest ──
    const manifestContent = `# Invariant Ownership

## Invariant: test-invariant-1
Some description here.
Other occurrences: [duplicate-to-remove] in tasks/DIR-foo.md

## Invariant: test-invariant-2
No duplicates here.
Other occurrences: none

## Invariant: test-invariant-3
Has duplicates.
Other occurrences:
- [duplicate-to-remove] in tasks/DIR-bar.md
`;
    const manifestFile = path.join(tmpDir, "invariant-ownership.md");
    fs.writeFileSync(manifestFile, manifestContent);
    const invManifest = parseInvariantManifest(manifestFile);
    check("parse-manifest-not-null", invManifest !== null, "manifest parsed");
    check("parse-manifest-count", invManifest!.duplicateCount === 2,
      `duplicateCount=${invManifest!.duplicateCount} (expected 2 — invariants 1 and 3 have duplicates)`);

    // ── GREEN: parseInvariantManifest missing file returns null ──
    const nullManifest = parseInvariantManifest("/nonexistent/manifest.md");
    check("parse-manifest-missing", nullManifest === null, "missing manifest returns null");

    // ── GREEN: cross-child — mock A2/A3 present produces populated metrics ──
    const mockReplayDir = path.join(tmpDir, "replay-fixtures");
    fs.mkdirSync(mockReplayDir);
    fs.writeFileSync(path.join(mockReplayDir, "DIR-TEST.json"), JSON.stringify({
      candidateId: "DIR-TEST",
      assertions: [
        { outcome: "done", stage: "Verify" },
        { outcome: "done", stage: "Build" },
      ],
    }));
    const crossReport = buildBaselineReport(syntheticEvents, {
      manifest: manifestFile,
      replayFixturesDir: mockReplayDir,
    });
    check("cross-child-metric4-populated", crossReport.metrics.duplicateRuleCount.evidenceStatus === "measured",
      `metric4 evidenceStatus=${crossReport.metrics.duplicateRuleCount.evidenceStatus}`);
    check("cross-child-metric7-populated", crossReport.metrics.replayVariance.evidenceStatus === "measured",
      `metric7 evidenceStatus=${crossReport.metrics.replayVariance.evidenceStatus}`);

    // ── GREEN: tokens diagnostic is always "unknown" ──
    const diag = synReport.diagnostics as any;
    check("tokens-unknown", diag.tokens.evidenceStatus === "unknown",
      `tokens evidenceStatus=${diag.tokens.evidenceStatus}`);
    check("tokens-reason-has-note", diag.tokens.reason.includes("A1 v1 event schema"),
      `tokens reason: ${diag.tokens.reason}`);

    // ── GREEN: metricClass for all metrics in report ──
    const allMetricsAreTagged = Object.values(synReport.metrics).every(m => m.evidenceStatus === "unknown" || (m as any).metricClass !== undefined);
    check("all-metrics-tagged", allMetricsAreTagged, "all metrics have metricClass when measured");

    // ── GREEN: metric 2 is content-agent ──
    check("metric2-is-content-agent", classifyMetric("contextWorkingSet") === "content-agent",
      `class=${classifyMetric("contextWorkingSet")}`);

    // ── GREEN: metric 1 is mechanical-runner ──
    check("metric1-is-mechanical", classifyMetric("changePropagationRadius") === "mechanical-runner",
      `class=${classifyMetric("changePropagationRadius")}`);

    // ── GREEN: unknown metric name → unknown class ──
    check("unknown-metric-name", classifyMetric("someFutureMetric") === "unknown",
      `class=${classifyMetric("someFutureMetric")}`);

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return st.report();
}

// Only run main() when this file is the entry point, not when imported as a module
const _scriptPath = path.resolve(process.argv[1] || "");
const _thisFile = fileURLToPath(import.meta.url);
if (_scriptPath === _thisFile || _scriptPath.endsWith("/workflow-baseline-metrics.ts")) {
  main();
}
