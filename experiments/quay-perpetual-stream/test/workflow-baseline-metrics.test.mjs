// Unit tests for workflow-baseline-metrics.ts — the baseline metrics emission script
// (DIR-124-A5). Mirrors the chart2-s1-distribution-reliability.test.mjs style:
// node:test + node:assert/strict, imports the pure functions, unit tests + CLI
// subprocess test. RED-first discipline — the fix for any failing case belongs
// in the MODULE, never in the fixtures.
//
// Run:
//   node --experimental-strip-types --test experiments/quay-perpetual-stream/test/workflow-baseline-metrics.test.mjs
//
// Stage 1 AC coverage: 1, 2, 3, 5, 8, 10, 12, 13, 14, 15, 17

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEventStream,
  classifyEvent,
  classifyMetric,
  computeChangePropagationRadius,
  computeContextWorkingSet,
  computeSharedWriterCount,
  computeDuplicateRuleCount,
  computePromptToCodeRatio,
  computeReceiptReuseRate,
  computeReplayVariance,
  computeFailureAttributionPrecision,
  computeFullSuiteExecutions,
  computeLandFenceTime,
  computeAgentMinutes,
  computeFindingRecurrence,
  computeArtifactClassOutput,
  buildBaselineReport,
  parseInvariantManifest,
  selftest,
} from "../scripts/workflow-baseline-metrics.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "workflow-baseline-metrics.ts");

function mkSyntheticEvent(overrides) {
  return {
    timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1500 },
    agentLabel: null, commandIdentity: null, observedWrites: null,
    outcome: null, waitReason: null, resourceClaim: null,
    stage: null, eventKind: null, candidateId: null, runId: null,
    isolationMode: null, dispatchMode: null, attempt: null, errorDetail: null,
    schemaVersion: "1",
    ...overrides,
  };
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// parseEventStream
// ═══════════════════════════════════════════════════════════════════════════════════════

test("parseEventStream: zero jsonl files → no-data", () => {
  const dir = tmpDir("wbm-parse-");
  try {
    const result = parseEventStream(dir);
    assert.equal(result.status, "no-data");
    assert.equal(result.events.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseEventStream: valid jsonl → parsed events", () => {
  const dir = tmpDir("wbm-parse-");
  try {
    fs.writeFileSync(path.join(dir, "run-001.jsonl"), JSON.stringify({
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1500 },
      agentLabel: "ceiling-check",
      commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/foo.ts",
      observedWrites: ["tasks/TEST.md"],
      outcome: "done",
      stage: "Verify",
      eventKind: "end",
      candidateId: "DIR-TEST",
      runId: "run-001",
      schemaVersion: "1",
    }) + "\n");
    const result = parseEventStream(dir);
    assert.equal(result.status, "ok");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].agentLabel, "ceiling-check");
    assert.equal(result.events[0].candidateId, "DIR-TEST");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseEventStream: malformed JSONL line → skipped with parseWarning", () => {
  const dir = tmpDir("wbm-parse-");
  try {
    fs.writeFileSync(path.join(dir, "mixed.jsonl"),
      '{"valid": true}\n{broken json\n{"also-valid": false}\n');
    const result = parseEventStream(dir);
    assert.equal(result.status, "ok");
    assert.ok(result.events.length >= 2, "valid lines still parsed");
    assert.ok(result.parseWarnings.length >= 1, "malformed line produces warning");
    const warning = result.parseWarnings[0];
    assert.equal(warning.type, "malformed-line");
    assert.equal(warning.file, "mixed.jsonl");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseEventStream: nonexistent directory → no-data", () => {
  const result = parseEventStream("/nonexistent/path/wbm-test");
  assert.equal(result.status, "no-data");
  assert.equal(result.events.length, 0);
});

test("parseEventStream: all-lines-corrupt → no-data", () => {
  const dir = tmpDir("wbm-parse-");
  try {
    fs.writeFileSync(path.join(dir, "corrupt.jsonl"), "{not json at all\n{also not json\n");
    const result = parseEventStream(dir);
    assert.equal(result.status, "no-data");
    assert.equal(result.events.length, 0);
    assert.ok(result.parseWarnings.length >= 2, "all corrupt lines produce warnings");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// classifyEvent
// ═══════════════════════════════════════════════════════════════════════════════════════

test("classifyEvent: mechanical agent label → mechanical-runner", () => {
  const ev = mkSyntheticEvent({ agentLabel: "ceiling-check" });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

test("classifyEvent: mechanical agent label gate-hash → mechanical-runner", () => {
  const ev = mkSyntheticEvent({ agentLabel: "gate-hash" });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

test("classifyEvent: emit-event-* prefix → mechanical-runner", () => {
  const ev = mkSyntheticEvent({ agentLabel: "emit-event-verify" });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

test("classifyEvent: content agent label ProposalAuthors → content-agent", () => {
  const ev = mkSyntheticEvent({ agentLabel: "ProposalAuthors" });
  assert.equal(classifyEvent(ev), "content-agent");
});

test("classifyEvent: content agent label Build → content-agent", () => {
  const ev = mkSyntheticEvent({ agentLabel: "Build" });
  assert.equal(classifyEvent(ev), "content-agent");
});

test("classifyEvent: content agent label Audit → content-agent", () => {
  const ev = mkSyntheticEvent({ agentLabel: "Audit" });
  assert.equal(classifyEvent(ev), "content-agent");
});

test("classifyEvent: unrecognized label → unknown", () => {
  const ev = mkSyntheticEvent({ agentLabel: "some-future-label" });
  assert.equal(classifyEvent(ev), "unknown");
});

test("classifyEvent: null label, null commandIdentity → unknown", () => {
  const ev = mkSyntheticEvent({ agentLabel: null, commandIdentity: null });
  assert.equal(classifyEvent(ev), "unknown");
});

test("classifyEvent: mechanical script path in commandIdentity → mechanical-runner", () => {
  const ev = mkSyntheticEvent({
    commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/foo.ts --flag /tmp/x.md",
    agentLabel: null,
  });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

test("classifyEvent: scripts/test.sh in commandIdentity → mechanical-runner", () => {
  const ev = mkSyntheticEvent({
    commandIdentity: "bash scripts/test.sh",
    agentLabel: null,
  });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

test("classifyEvent: ambiguous — commandIdentity script-match WINS over agentLabel (AC14 boundary-ambiguity)", () => {
  const ev = mkSyntheticEvent({
    agentLabel: "Build",
    commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-build.ts --task DIR-X",
  });
  assert.equal(classifyEvent(ev), "mechanical-runner", "commandIdentity script-match must win over agentLabel");
});

test("classifyEvent: agentLabel-only → content-agent (AC14 agent-only)", () => {
  const ev = mkSyntheticEvent({
    agentLabel: "PlanCheck",
    commandIdentity: null,
  });
  assert.equal(classifyEvent(ev), "content-agent");
});

test("classifyEvent: neither-match → unknown (AC14 neither-match)", () => {
  const ev = mkSyntheticEvent({
    agentLabel: "someUnrecognizedLabel",
    commandIdentity: "someUnrecognizedCommand",
  });
  assert.equal(classifyEvent(ev), "unknown");
});

test("classifyEvent: all known mechanical agent labels", () => {
  const labels = [
    "ceiling-check", "gate-hash", "line-budget", "dogfood-evidence",
    "composite-preflight", "worktree-create", "worktree-merge", "worktree-remove",
    "build-evidence-collector",
  ];
  for (const label of labels) {
    const ev = mkSyntheticEvent({ agentLabel: label });
    assert.equal(classifyEvent(ev), "mechanical-runner", `label ${label} must be mechanical-runner`);
  }
});

test("classifyEvent: all known content-agent labels", () => {
  const labels = [
    "ProposalAuthors", "Adjudicate", "ProposalReview", "PlanAuthor", "PlanCheck",
    "Build", "Audit", "domain-misfit", "prepare-receipt",
  ];
  for (const label of labels) {
    const ev = mkSyntheticEvent({ agentLabel: label, commandIdentity: null });
    assert.equal(classifyEvent(ev), "content-agent", `label ${label} must be content-agent`);
  }
});

test("classifyEvent: commandIdentity with plugin/scripts path → mechanical-runner", () => {
  const ev = mkSyntheticEvent({
    commandIdentity: "node --experimental-strip-types plugin/scripts/concurrent-batch-scheduler.ts",
  });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

test("classifyEvent: bash experiments/... path → mechanical-runner", () => {
  const ev = mkSyntheticEvent({
    commandIdentity: "bash experiments/quay-perpetual-stream/scripts/gate-hash-check.sh",
  });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// classifyMetric
// ═══════════════════════════════════════════════════════════════════════════════════════

test("classifyMetric: mechanical metrics", () => {
  const mechanical = [
    "changePropagationRadius", "sharedWriterCount", "duplicateRuleCount",
    "promptToCodeRatio", "receiptReuseRate", "replayVariance",
    "failureAttributionPrecision", "fullSuiteExecutions", "landFenceTime",
  ];
  for (const name of mechanical) {
    assert.equal(classifyMetric(name), "mechanical-runner", `${name} must be mechanical-runner`);
  }
});

test("classifyMetric: contextWorkingSet → content-agent", () => {
  assert.equal(classifyMetric("contextWorkingSet"), "content-agent");
});

test("classifyMetric: unrecognized → unknown", () => {
  assert.equal(classifyMetric("someFutureMetric"), "unknown");
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// Synthetic events for metric tests
// ═══════════════════════════════════════════════════════════════════════════════════════

const SYNTHETIC_EVENTS = [
  mkSyntheticEvent({
    timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1500 },
    agentLabel: "ceiling-check",
    commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh --task DIR-TEST",
    observedWrites: ["tasks/DIR-TEST.md", "milestones/M999/absorb-entry.md"],
    outcome: "done",
    stage: "Verify", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
    isolationMode: "worktree", dispatchMode: "serial", attempt: 1, schemaVersion: "1",
  }),
  mkSyntheticEvent({
    timing: { queuedAtMs: 2000, startedAtMs: 2100, endedAtMs: 2500 },
    agentLabel: "Build",
    commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-build.ts --task DIR-TEST",
    observedWrites: ["tasks/DIR-TEST.md", "experiments/quay-perpetual-stream/scripts/foo.ts"],
    outcome: "done",
    stage: "Build", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
    isolationMode: "worktree", dispatchMode: "serial", attempt: 1, schemaVersion: "1",
  }),
  mkSyntheticEvent({
    timing: { queuedAtMs: 3000, startedAtMs: 3500, endedAtMs: 3600 },
    agentLabel: "Audit",
    observedWrites: ["milestones/M999/audits/audit-report.md"],
    outcome: "needs-human", waitReason: "split-or-commit-failure",
    stage: "Audit", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
    isolationMode: "worktree", dispatchMode: "serial", attempt: 1, schemaVersion: "1",
  }),
  mkSyntheticEvent({
    timing: { queuedAtMs: 5000, startedAtMs: 5500, endedAtMs: 5900 },
    agentLabel: "land",
    commandIdentity: "git merge --no-ff milestone/M999/iteration-0",
    observedWrites: ["milestones/M999/preparation.json"],
    outcome: "done",
    resourceClaim: ".quay/land-locks/shared-checkout.lock",
    stage: "Land", eventKind: "end", candidateId: "DIR-TEST", runId: "run-001",
    isolationMode: "worktree", dispatchMode: "serial", attempt: 1, schemaVersion: "1",
  }),
];

// ═══════════════════════════════════════════════════════════════════════════════════════
// Metrics 1-10: unit tests
// ═══════════════════════════════════════════════════════════════════════════════════════

test("computeChangePropagationRadius: from synthetic events", () => {
  const r = computeChangePropagationRadius(SYNTHETIC_EVENTS);
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.metricClass, "mechanical-runner");
  assert.ok(r.perCandidate["DIR-TEST"]);
  assert.ok(r.perCandidate["DIR-TEST"].uniqueFiles > 0);
  assert.ok(r.aggregate.files.max > 0);
});

test("computeChangePropagationRadius: empty events → unknown", () => {
  const r = computeChangePropagationRadius([]);
  assert.equal(r.evidenceStatus, "unknown");
});

test("computeContextWorkingSet: from synthetic events", () => {
  const r = computeContextWorkingSet(SYNTHETIC_EVENTS);
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.metricClass, "content-agent");
});

test("computeSharedWriterCount: from synthetic events", () => {
  const r = computeSharedWriterCount(SYNTHETIC_EVENTS);
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.metricClass, "mechanical-runner");
  assert.ok(r.perCandidate["DIR-TEST"]);
});

test("computeSharedWriterCount: empty events → unknown", () => {
  const r = computeSharedWriterCount([]);
  assert.equal(r.evidenceStatus, "unknown");
});

test("computePromptToCodeRatio: from synthetic events", () => {
  const r = computePromptToCodeRatio(SYNTHETIC_EVENTS);
  assert.equal(r.evidenceStatus, "measured");
});

test("computeReceiptReuseRate: from synthetic events (no Prepared events)", () => {
  const r = computeReceiptReuseRate(SYNTHETIC_EVENTS);
  assert.equal(r.evidenceStatus, "unknown");
});

test("computeReceiptReuseRate: with Prepared events", () => {
  const events = [
    mkSyntheticEvent({
      timing: { queuedAtMs: 1000, startedAtMs: 1000, endedAtMs: 1000 },
      outcome: "skipped", waitReason: "cache-hit",
      stage: "Prepared", eventKind: "end", candidateId: "DIR-X", runId: "run-x",
    }),
    mkSyntheticEvent({
      timing: { queuedAtMs: 2000, startedAtMs: 2000, endedAtMs: 2000 },
      outcome: "done", waitReason: null,
      stage: "Prepared", eventKind: "end", candidateId: "DIR-Y", runId: "run-y",
    }),
  ];
  const r = computeReceiptReuseRate(events);
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.reuseRate, 0.5);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.totalPrepared, 2);
});

test("computeFailureAttributionPrecision: no needs-human → unknown", () => {
  const r = computeFailureAttributionPrecision([]);
  assert.equal(r.evidenceStatus, "unknown");
});

test("computeFailureAttributionPrecision: needs-human events", () => {
  const events = [
    mkSyntheticEvent({
      timing: { queuedAtMs: 1000, startedAtMs: 1000, endedAtMs: 1000 },
      stage: "Audit", waitReason: "split-or-commit",
      commandIdentity: "node experiments/scripts/foo.ts",
      outcome: "needs-human",
      eventKind: "end", candidateId: "DIR-FAIL", runId: "run-fail",
    }),
  ];
  const r = computeFailureAttributionPrecision(events);
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.precision, 1.0);
  assert.equal(r.totalNeedsHuman, 1);
  assert.equal(r.preciselyAttributed, 1);
});

test("computeFullSuiteExecutions: no test.sh → unknown", () => {
  const r = computeFullSuiteExecutions(SYNTHETIC_EVENTS);
  assert.equal(r.evidenceStatus, "unknown");
});

test("computeFullSuiteExecutions: with test.sh", () => {
  const events = [
    mkSyntheticEvent({
      timing: { queuedAtMs: 1000, startedAtMs: 1000, endedAtMs: 1000 },
      commandIdentity: "bash scripts/test.sh",
      stage: "Verify", eventKind: "end", candidateId: "DIR-X", runId: "run-x",
    }),
    mkSyntheticEvent({
      timing: { queuedAtMs: 2000, startedAtMs: 2000, endedAtMs: 2000 },
      commandIdentity: "bash scripts/test.sh packages/quay/test/gate.test.mjs",
      stage: "Build", eventKind: "end", candidateId: "DIR-X", runId: "run-x",
    }),
  ];
  const r = computeFullSuiteExecutions(events);
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.total, 2);
});

test("computeLandFenceTime: from synthetic", () => {
  const r = computeLandFenceTime(SYNTHETIC_EVENTS);
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.metricClass, "mechanical-runner");
  assert.ok(r.aggregate.queueMs);
  assert.equal(r.aggregate.queueMs.min, 500);
  assert.equal(r.aggregate.durationMs.min, 400);
  assert.equal(r.aggregate.totalMs.min, 900);
});

test("computeLandFenceTime: no land events → unknown", () => {
  const r = computeLandFenceTime([]);
  assert.equal(r.evidenceStatus, "unknown");
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ═══════════════════════════════════════════════════════════════════════════════════════

test("computeAgentMinutes: from synthetic events", () => {
  const r = computeAgentMinutes(SYNTHETIC_EVENTS);
  assert.ok(typeof r.totalMinutes === "number");
  assert.ok(r.totalMinutes >= 0);
});

test("computeAgentMinutes: empty events → zero", () => {
  const r = computeAgentMinutes([]);
  assert.equal(r.totalMinutes, 0);
});

test("computeFindingRecurrence: from synthetic events", () => {
  const r = computeFindingRecurrence(SYNTHETIC_EVENTS);
  assert.ok(typeof r.novelFindings === "number");
  assert.ok(typeof r.recurrentFindings === "number");
});

test("computeArtifactClassOutput: from synthetic events", () => {
  const r = computeArtifactClassOutput(SYNTHETIC_EVENTS);
  assert.ok(r.code.count >= 0);
  assert.ok(r.tasks.count >= 0);
  assert.ok(r.milestones.count >= 0);
  assert.equal(r.byteCounts, "unknown");
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// buildBaselineReport
// ═══════════════════════════════════════════════════════════════════════════════════════

test("buildBaselineReport: full report from synthetic events", () => {
  const report = buildBaselineReport(SYNTHETIC_EVENTS, {});
  assert.equal(report.schemaVersion, "1");
  assert.equal(report.scriptVersion, "1.0.0");
  assert.equal(report.status, "ok");
  assert.equal(report.samples, 1);
  assert.ok(report.generatedAt);

  const keys = Object.keys(report.metrics);
  assert.equal(keys.length, 10);
});

test("buildBaselineReport: zero events → no-data with all metrics unknown", () => {
  const report = buildBaselineReport([], {});
  assert.equal(report.status, "no-data");
  assert.equal(report.samples, 0);

  for (const metric of Object.values(report.metrics)) {
    assert.equal(metric.evidenceStatus, "unknown");
  }
  assert.equal(report.diagnostics.tokens.evidenceStatus, "unknown");
  assert.ok(report.diagnostics.tokens.reason.includes("A1 v1 event schema"));
});

test("buildBaselineReport: deterministic — same input → byte-identical JSON (ignoring generatedAt)", () => {
  const r1 = buildBaselineReport(SYNTHETIC_EVENTS, {});
  const r2 = buildBaselineReport(SYNTHETIC_EVENTS, {});
  // Strip generatedAt timestamps before comparing (they differ by ~ms)
  const { generatedAt: g1, ...rest1 } = r1;
  const { generatedAt: g2, ...rest2 } = r2;
  assert.deepEqual(rest1, rest2);
});

test("buildBaselineReport: all 10 metric names", () => {
  const report = buildBaselineReport(SYNTHETIC_EVENTS, {});
  const expectedKeys = [
    "changePropagationRadius", "contextWorkingSet", "sharedWriterCount",
    "duplicateRuleCount", "promptToCodeRatio", "receiptReuseRate", "replayVariance",
    "failureAttributionPrecision", "fullSuiteExecutions", "landFenceTime",
  ];
  for (const key of expectedKeys) {
    assert.ok(key in report.metrics, `metric ${key} must be present`);
  }
});

test("buildBaselineReport: every measured metric has metricClass", () => {
  const report = buildBaselineReport(SYNTHETIC_EVENTS, {});
  for (const [name, metric] of Object.entries(report.metrics)) {
    if (metric.evidenceStatus === "measured") {
      assert.ok(metric.metricClass !== undefined, `${name} must have metricClass`);
      assert.ok(
        ["mechanical-runner", "content-agent", "unknown"].includes(metric.metricClass),
        `${name} metricClass must be valid`
      );
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// Cross-child (A2, A3)
// ═══════════════════════════════════════════════════════════════════════════════════════

test("buildBaselineReport: metric 4 unknown when manifest absent", () => {
  const report = buildBaselineReport(SYNTHETIC_EVENTS, { manifest: "/nonexistent/manifest.md" });
  assert.equal(report.metrics.duplicateRuleCount.evidenceStatus, "unknown");
});

test("buildBaselineReport: metric 4 populated when manifest present", () => {
  const dir = tmpDir("wbm-cross-");
  try {
    const manifestFile = path.join(dir, "invariant-ownership.md");
    fs.writeFileSync(manifestFile, `## Invariant: test-invariant\nOther occurrences: [duplicate-to-remove] somewhere\n`);
    const report = buildBaselineReport(SYNTHETIC_EVENTS, { manifest: manifestFile });
    assert.equal(report.metrics.duplicateRuleCount.evidenceStatus, "measured");
    assert.equal(report.metrics.duplicateRuleCount.duplicateCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildBaselineReport: metric 7 unknown when fixtures absent", () => {
  const report = buildBaselineReport(SYNTHETIC_EVENTS, { replayFixturesDir: "/nonexistent/dir" });
  assert.equal(report.metrics.replayVariance.evidenceStatus, "unknown");
});

test("buildBaselineReport: metric 7 populated when fixtures present", () => {
  const dir = tmpDir("wbm-cross-");
  try {
    const replayDir = path.join(dir, "replay-fixtures");
    fs.mkdirSync(replayDir, { recursive: true });
    fs.writeFileSync(path.join(replayDir, "DIR-TEST.json"), JSON.stringify({
      candidateId: "DIR-TEST",
      assertions: [{ outcome: "done", stage: "Verify" }, { outcome: "done", stage: "Build" }],
    }));
    const report = buildBaselineReport(SYNTHETIC_EVENTS, { replayFixturesDir: replayDir });
    assert.equal(report.metrics.replayVariance.evidenceStatus, "measured");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// parseInvariantManifest
// ═══════════════════════════════════════════════════════════════════════════════════════

test("parseInvariantManifest: counts duplicates", () => {
  const dir = tmpDir("wbm-manifest-");
  try {
    const manifestFile = path.join(dir, "invariant-ownership.md");
    fs.writeFileSync(manifestFile, [
      "## Invariant: rule-1",
      "Some description.",
      "Other occurrences: [duplicate-to-remove] in tasks/DIR-foo.md",
      "",
      "## Invariant: rule-2",
      "No duplicates.",
      "Other occurrences: none",
      "",
      "## Invariant: rule-3",
      "Has duplicates.",
      "Other occurrences:",
      "- [duplicate-to-remove] in tasks/DIR-bar.md",
      "- [duplicate-to-remove] in tasks/DIR-baz.md",
    ].join("\n"));
    const result = parseInvariantManifest(manifestFile);
    assert.ok(result !== null);
    assert.equal(result.duplicateCount, 2, "rule-1 and rule-3 have duplicates");
    assert.equal(result.rules.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseInvariantManifest: missing file → null", () => {
  const result = parseInvariantManifest("/nonexistent/manifest.md");
  assert.equal(result, null);
});

test("parseInvariantManifest: no duplicates → zero count", () => {
  const dir = tmpDir("wbm-manifest-");
  try {
    const manifestFile = path.join(dir, "invariant-ownership.md");
    fs.writeFileSync(manifestFile, "## Invariant: rule-only\nNo duplicates here.\nOther occurrences: none\n");
    const result = parseInvariantManifest(manifestFile);
    assert.ok(result !== null);
    assert.equal(result.duplicateCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// computeDuplicateRuleCount
// ═══════════════════════════════════════════════════════════════════════════════════════

test("computeDuplicateRuleCount: null manifest → unknown", () => {
  const r = computeDuplicateRuleCount(null);
  assert.equal(r.evidenceStatus, "unknown");
});

test("computeDuplicateRuleCount: from parsed manifest", () => {
  const r = computeDuplicateRuleCount({ duplicateCount: 3, rules: ["a", "b", "c"] });
  assert.equal(r.evidenceStatus, "measured");
  assert.equal(r.duplicateCount, 3);
  assert.deepEqual(r.duplicateRules, ["a", "b", "c"]);
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// CLI subprocess tests
// ═══════════════════════════════════════════════════════════════════════════════════════

test("CLI: --selftest exits 0", () => {
  try {
    const result = execFileSync(
      "node", ["--experimental-strip-types", SCRIPT, "--selftest"],
      { encoding: "utf-8" }
    );
    assert.ok(result.includes("SELFTEST"), "output should contain SELFTEST");
    assert.ok(result.includes("PASS"), "selftest should pass");
  } catch (e) {
    assert.fail(`selftest should exit 0, got exit ${e.status}: ${e.stderr || e.message}`);
  }
});

test("CLI: --json with empty event dir → no-data status", () => {
  const dir = tmpDir("wbm-cli-");
  try {
    const result = execFileSync(
      "node", ["--experimental-strip-types", SCRIPT, "--json", "--event-dir", dir],
      { encoding: "utf-8" }
    );
    const report = JSON.parse(result);
    assert.equal(report.status, "no-data");
    assert.equal(report.samples, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --json with event data → ok status", () => {
  const dir = tmpDir("wbm-cli-");
  try {
    fs.writeFileSync(path.join(dir, "test.jsonl"), JSON.stringify({
      timing: { queuedAtMs: 1000, startedAtMs: 1100, endedAtMs: 1500 },
      agentLabel: "ceiling-check",
      commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/foo.ts",
      observedWrites: ["tasks/TEST.md"],
      outcome: "done",
      stage: "Verify", eventKind: "end", candidateId: "DIR-TEST", runId: "run-test",
      isolationMode: "worktree", dispatchMode: "serial", schemaVersion: "1",
    }) + "\n");
    const result = execFileSync(
      "node", ["--experimental-strip-types", SCRIPT, "--json", "--event-dir", dir],
      { encoding: "utf-8" }
    );
    const report = JSON.parse(result);
    assert.equal(report.status, "ok");
    assert.ok(report.samples >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: nonexistent event dir → exit 2", () => {
  try {
    execFileSync(
      "node", ["--experimental-strip-types", SCRIPT, "--json", "--event-dir", "/nonexistent/path/wbm"],
      { encoding: "utf-8", stdio: "pipe" }
    );
    assert.fail("should have exited non-zero");
  } catch (e) {
    assert.equal(e.status, 2, `expected exit 2, got ${e.status}`);
  }
});

test("CLI: --help returns usage info", () => {
  const result = execFileSync(
    "node", ["--experimental-strip-types", SCRIPT, "--help"],
    { encoding: "utf-8" }
  );
  assert.ok(result.includes("Usage:"), "help includes usage");
  assert.ok(result.includes("--event-dir"), "help mentions --event-dir");
  assert.ok(result.includes("--selftest"), "help mentions --selftest");
});

test("CLI: emits valid JSON with --json flag", () => {
  const dir = tmpDir("wbm-cli-");
  try {
    const result = execFileSync(
      "node", ["--experimental-strip-types", SCRIPT, "--json", "--event-dir", dir],
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(result);
    assert.equal(typeof parsed, "object");
    assert.equal(parsed.schemaVersion, "1");
    assert.ok(Array.isArray(parsed.parseWarnings));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// selftest function
// ═══════════════════════════════════════════════════════════════════════════════════════

test("selftest: returns true", () => {
  const result = selftest();
  assert.equal(result, true, "selftest should return true");
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// AC15: metricClass/agentLabel/commandIdentity
// ═══════════════════════════════════════════════════════════════════════════════════════

test("AC15: every metric in report carries metricClass when measured", () => {
  const report = buildBaselineReport(SYNTHETIC_EVENTS, {});
  for (const [name, metric] of Object.entries(report.metrics)) {
    if (metric.evidenceStatus === "measured") {
      assert.ok("metricClass" in metric, `${name} has metricClass`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// AC10: malformed JSONL line is skipped with parseWarning, does not invalidate stream
// ═══════════════════════════════════════════════════════════════════════════════════════

test("AC10: malformed line skipped, valid lines still processed", () => {
  const dir = tmpDir("wbm-ac10-");
  try {
    fs.writeFileSync(path.join(dir, "mixed.jsonl"),
      '{"agentLabel":"a1","stage":"Verify","outcome":"done"}\n{broken line\n{"agentLabel":"a2","stage":"Build","outcome":"done"}\n');
    const result = parseEventStream(dir);
    assert.equal(result.events.length, 2, "two valid lines parsed");
    assert.equal(result.parseWarnings.length, 1, "one parse warning");
    assert.equal(result.status, "ok", "stream not invalidated by single corrupt line");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// AC17: commandIdentity script-path classification
// ═══════════════════════════════════════════════════════════════════════════════════════

test("AC17: commandIdentity with experiments/scripts/ path → mechanical-runner", () => {
  const ev = mkSyntheticEvent({
    commandIdentity: "node --experimental-strip-types experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts --json",
    agentLabel: null,
  });
  assert.equal(classifyEvent(ev), "mechanical-runner");
});

test("AC17: content-agent label only without script path → NOT mechanical-runner", () => {
  const ev = mkSyntheticEvent({
    agentLabel: "ProposalAuthors",
    commandIdentity: "some agent-driven task editing",
  });
  const cls = classifyEvent(ev);
  assert.notEqual(cls, "mechanical-runner", "content-agent label without script path should not be mechanical-runner");
});
