// milestone-preparation-check.mjs — DIR-117 unit C. The mechanical checker for a
// `milestones/M<NN>/preparation.json` RECEIPT (never a second content source — see task-schema.ts's
// own single-source-of-truth discipline, applied here to the Proposal/Plan preparation pipeline).
//
// A receipt records SHA-256 hashes of every checked input at preparation time: the task's own
// `## Proposal` section, the charter file, the Plan file (`docs/plans/*.md`), and each source file
// the grounded Plan-check actually inspected — plus the review/plan-check verdicts (finding
// counts, round count) and the `touches` set the checked Plan declared.
//
// This module recomputes the SAME hashes against the CURRENT on-disk state of those same named
// inputs and compares. Any mismatch is a distinct, actionable, fail-closed reason — never a bare
// boolean. An input NOT named by the receipt (an "unrelated file") is never touched by this check
// at all, so it can never cause a false invalidation — freshness is scoped exactly to what the
// receipt itself declares it inspected.
//
// CLI:
//   node milestone-preparation-check.ts --task <task.md> --charter <charter.md> --receipt <receipt.json>
// Exit codes: 0 = PASS (receipt matches current state + zero findings); 1 = FAIL (see printed code);
// 2 = usage/environment error.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { extractSection, countBoxes } from "./task-schema.ts";
import { blockingOpen, validateConvergenceCounters, computeConvergenceMetrics, CACHEABLE_TERMINALS, validateTelemetryRecord } from "./proposal-convergence.ts";

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ── computeReceiptInputs — read the CURRENT state of every input a receipt names. ─────────────────
// `receipt.sources` is a map of {relativeOrAbsolutePath: <hash-at-preparation-time>}; this function
// re-reads each of those same paths now (never a path the receipt doesn't name) plus the task's
// own Proposal section, the charter file, and the Plan file the receipt recorded.
export function computeCurrentHashes({ taskFile, charterFile, receipt }) {
  const taskText = fs.readFileSync(taskFile, "utf8");
  const proposalSection = extractSection(taskText, "Proposal") || "";
  const charterText = fs.existsSync(charterFile) ? fs.readFileSync(charterFile, "utf8") : null;
  const planFile = receipt.planFile;
  const planText = planFile && fs.existsSync(planFile) ? fs.readFileSync(planFile, "utf8") : null;

  const sources = {};
  for (const srcPath of Object.keys(receipt.hashes?.sources || {})) {
    sources[srcPath] = fs.existsSync(srcPath) ? sha256(fs.readFileSync(srcPath, "utf8")) : null;
  }

  return {
    proposal: sha256(proposalSection.trim()),
    charter: charterText === null ? null : sha256(charterText),
    plan: planText === null ? null : sha256(planText),
    sources,
  };
}

// ── buildReceipt — helper for authoring a fresh, matching receipt (used by prepare-milestone and
// by this module's own fixtures). Not itself part of the check contract. ─────────────────────────
// `provenance` (DIR-117 iteration-2 item 2): records the REAL, distinct run identity (e.g. a
// `$CLAUDE_CODE_SESSION_ID` captured inside each phase's own agent dispatch, per the DIR-093
// pattern `execute-milestone.js`'s Audit phase already uses for `auditSessionId`) for every
// author/reviewer role — never a caller-asserted "trust me, this was independent" string.
// checkPreparation() below mechanically verifies DISTINCTNESS (reviewer != author, plan-checker !=
// plan-author), not merely presence.
// `ledgerFile` (DIR-125): the derived typed finding ledger written BESIDE the receipt (never a
// second copy of the Proposal/Plan — see proposal-convergence.ts's ledger entry shape). When
// given, its CURRENT on-disk content is sha256-hashed and bound into `hashes.ledger` so a later
// swap for a different ledger — or pairing this receipt with a Proposal edited after the fact —
// is caught by checkPreparation()'s `ledger-stale`/`ledger-missing` checks.
// `convergence` (DIR-125): the raw counters/metrics prepare-milestone.js's bounded loop recorded
// (fullSynthesisCount, deltaRounds, highRisk, terminalReason, timestamps, proposalHashes) —
// mechanically re-verified against policy caps by checkPreparation() via
// proposal-convergence.ts's validateConvergenceCounters(), never trusted as self-reported.
// `telemetryFile` (DIR-126-D/M203): mirrors `ledgerFile` verbatim — the committed
// milestones/prepare-telemetry/<taskId>/<recordId>.json record the Receipt phase's
// `_writeGenerationTelemetry` call already wrote BEFORE this `--build` dispatch runs. Hash-bound
// into `hashes.telemetry` the exact same way `ledgerFile` is hash-bound into `hashes.ledger`, so a
// later swap for a different/edited telemetry record is caught by checkPreparation()'s
// `telemetry-stale`/`telemetry-missing` checks (Claim A.5) rather than silently passing.
export function buildReceipt({ taskId, milestoneId, charterFile, taskFile, planFile, sourceFiles = [], review, planCheck, touches = [], provenance, ledgerFile, convergence, telemetryFile }) {
  const taskText = fs.readFileSync(taskFile, "utf8");
  const proposalSection = extractSection(taskText, "Proposal") || "";
  const charterText = fs.readFileSync(charterFile, "utf8");
  const planText = fs.readFileSync(planFile, "utf8");
  const sources = {};
  for (const f of sourceFiles) sources[f] = sha256(fs.readFileSync(f, "utf8"));
  const ledgerHash = ledgerFile ? sha256(fs.readFileSync(ledgerFile, "utf8")) : undefined;
  const telemetryHash = telemetryFile ? sha256(fs.readFileSync(telemetryFile, "utf8")) : undefined;
  return {
    taskId,
    milestoneId,
    charterFile,
    planFile,
    ledgerFile: ledgerFile ?? null,
    telemetryFile: telemetryFile ?? null,
    hashes: {
      proposal: sha256(proposalSection.trim()),
      charter: sha256(charterText),
      plan: sha256(planText),
      sources,
      ...(ledgerHash !== undefined ? { ledger: ledgerHash } : {}),
      ...(telemetryHash !== undefined ? { telemetry: telemetryHash } : {}),
    },
    review: review ?? { findings: 0 },
    planCheck: planCheck ?? { rounds: 1, findings: 0 },
    touches,
    provenance: provenance ?? null,
    convergence: convergence ?? null,
  };
}

// ── computeMetricsForReceipt — DIR-125 Requested-action item 10 / DoD instrumentation: the ONE
// mechanically-queryable surface for prepareWallTime/fullSynthesisCount/proposalReviewRounds/
// blockingFindingYield/proposalChurnRatio/reachedPlanAuthor "per candidate" — never left as
// "inferred from session prose". Reads a receipt (+ its bound ledger, if any) from disk and
// derives the metrics via proposal-convergence.ts's computeConvergenceMetrics (single-sourced, not
// reimplemented). Receipts built before DIR-125 (no `convergence` block) return `null` — there is
// nothing to derive metrics from, and this is reported as an explicit `code`, not a crash.
export function computeMetricsForReceipt({ receiptFile }) {
  if (!fs.existsSync(receiptFile)) {
    return { ok: false, code: "receipt-missing", message: `no preparation receipt found at ${receiptFile}` };
  }
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  if (!receipt.convergence) {
    return { ok: false, code: "convergence-not-recorded", message: "this receipt predates DIR-125 and has no 'convergence' block to derive metrics from" };
  }
  const ledger = receipt.ledgerFile && fs.existsSync(receipt.ledgerFile) ? JSON.parse(fs.readFileSync(receipt.ledgerFile, "utf8")) : [];
  const metrics = computeConvergenceMetrics({
    fullSynthesisCount: receipt.convergence.fullSynthesisCount,
    deltaRounds: receipt.convergence.deltaRounds,
    ledger,
    proposalHashes: receipt.convergence.proposalHashes,
    startedAtMs: receipt.convergence.startedAtMs,
    endedAtMs: receipt.convergence.endedAtMs,
    reachedPlanAuthor: receipt.convergence.reachedPlanAuthor,
    terminalReason: receipt.convergence.terminalReason,
  });
  return { ok: true, code: "metrics-ok", taskId: receipt.taskId, milestoneId: receipt.milestoneId, metrics };
}

// ── computeTouchesExpansion — single-sourced (DIR-117 iteration-2 item 4): the SAME expansion
// arithmetic checkPreparation() uses to detect a checked Plan's touch set outgrowing the task/
// charter's declared '## Touches', exported so concurrent-batch-scheduler.ts's real batch
// re-assembly loop can REUSE it (not reinvent it) to recompute a candidate's effective touch set
// before assembling a batch, rather than only detecting the drift in isolation after the fact.
export function computeTouchesExpansion(receiptTouches, declaredTouches) {
  if (!Array.isArray(declaredTouches) || !Array.isArray(receiptTouches) || receiptTouches.length === 0) {
    return { expanded: [] };
  }
  const expanded = receiptTouches.filter((t) => !declaredTouches.includes(t));
  return { expanded };
}

// ── _walkJsonFiles — DIR-126-E/M204: the ONE shared recursive `.json`-file enumeration primitive
// under a root directory. Factored OUT of queryTelemetryReport's former inline `walk()` closure so
// BOTH read-only modes over the telemetry tree — queryTelemetryReport (single-milestone query) and
// computeCapacityReport (whole-tree capacity aggregation) — share ONE traversal implementation,
// never two independently maintained directory walks (the exact "content living in two places"
// drift class this repo's CLAUDE.md names). Pure enumeration only: each CALLER keeps its own
// per-file contract (parse-and-silently-skip vs. parse-and-trace-the-failure). Traversal order is
// the filesystem's own readdir order, exactly as the pre-refactor inline walk had it, so
// queryTelemetryReport's external output is byte-for-byte unchanged by this extraction
// (regression-tested).
export function _walkJsonFiles(root) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(p);
      }
    }
  }
  walk(root);
  return files;
}

// ── queryTelemetryReport — DIR-126-D/M203 Claim B.1: the ONE read-only query mode over the
// committed milestones/prepare-telemetry/**/*.json tree. Filters by each record's own EMBEDDED
// `milestoneId` field, never by directory layout alone — layout is `taskId`-primary and a
// re-charter'd task can carry a different `milestoneId` across generations under the same
// directory. Zero matches is an explicit, typed result, never a crash and never an ambiguous
// empty-looking silent success (AC22). DIR-126-E/M204: its recursion now goes through the shared
// _walkJsonFiles primitive; its external contract (CLI flag, inputs, {ok, code} return shape,
// silent-skip-on-malformed-JSON, record order) is unchanged.
export function queryTelemetryReport({ workspace, milestoneId }) {
  const root = path.join(workspace, "milestones", "prepare-telemetry");
  const records = [];
  for (const p of _walkJsonFiles(root)) {
    try {
      const rec = JSON.parse(fs.readFileSync(p, "utf8"));
      if (rec && rec.milestoneId === milestoneId) records.push(rec);
    } catch {
      // Malformed telemetry file — skipped, never crashes the report query.
    }
  }
  if (records.length === 0) {
    return { ok: true, code: "no-records", milestoneId };
  }
  return { ok: true, code: "records-found", milestoneId, records };
}

// ── percentile — DIR-126-E/M204: nearest-rank percentile over an ASCENDING-sorted number array.
// Deliberately pinned to the nearest-rank definition (rank = ceil(p/100 · n), 1-based) — never an
// interpolated percentile — so the method carries no convention ambiguity and is named in every
// distribution block that uses it (`method: "nearest-rank"`). Deterministic: same input array,
// same value, every run. Returns null for an empty array.
export function percentile(sortedNumbers, p) {
  const n = sortedNumbers.length;
  if (n === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * n));
  return sortedNumbers[Math.min(rank, n) - 1];
}

// ── isCacheableTerminalShape — DIR-126-E/M204: the phase→terminalPhase bridge. A telemetry record
// stores its terminal as `{outcome, reason, phase, cacheable}` (field name `terminal.phase`), while
// proposal-convergence.ts's exported CACHEABLE_TERMINALS allowlist keys its entries on
// `terminalPhase`. _isCacheablePair is NOT exported and proposal-convergence.ts is outside this
// child's ## Touches, so this small bridge lives HERE — importing the real constant (never a
// hand-copied literal that could silently drift) and mapping `terminal.phase → terminalPhase`.
// The record's own self-reported `terminal.cacheable` is deliberately NOT consulted here: it is a
// per-record policy snapshot that can go stale when the allowlist changes; computeCapacityReport
// re-derives cacheability from the imported source of truth and surfaces any derived-vs-self-
// reported disagreement as a diagnostic entry (derived value governs classification).
export function isCacheableTerminalShape(terminal) {
  return CACHEABLE_TERMINALS.some((p) => p.terminalPhase === terminal?.phase && p.reason === terminal?.reason);
}

// ── computeCapacityReport — DIR-126-E/M204: the ONE read-only capacity aggregation over the two
// artifact populations DIR-126-A..D already produce and check in: milestones/prepare-telemetry/**
// *.json telemetry records (DIR-126-D's landed writer) and milestones/M*/preparation.json receipts
// (DIR-125's landed instrumentation). Reads ONLY checked-in artifacts — never Claude Code session
// JSONL (every live record carries sessionId: null, confirming no session data is reachable from
// the data itself).
//
// Load-bearing design invariants (each one a distinct task AC, each regression-tested):
//  - Two INDEPENDENT sample populations, joined BEST-EFFORT on embedded (taskId, milestoneId) —
//    pairing is NEVER required (the live telemetry↔receipt pairing rate is 0/11; requiring it
//    would report insufficient-samples against the entire real baseline).
//  - Two wall-time distributions, labeled and NEVER POOLED: receipt-side prepareWallTimeMs (full
//    prepare loop incl. PlanCheck, via the reused computeMetricsForReceipt →
//    computeConvergenceMetrics — never a second derivation) and telemetry-side proxy
//    (recordedAtMs − admission.acquiredAt, lease-acquire → record-write). They measure
//    semantically different intervals; one blended P50/P85 would fabricate a number neither
//    source supports.
//  - Content-generation discriminator is decision.kind ∈ {cold, resume} — NEVER
//    decision.createsContentGeneration, which is written inverted (kind === "resume") at
//    proposal-convergence.ts:664 and would misclassify the entire live corpus.
//  - contentAgentMs null (cold/resume under schemaVersion 2) is preserved as notMeasured — NEVER
//    coerced to 0; reuse-terminal/not-evaluated are the schema-guaranteed measuredZero buckets.
//  - Cacheability is RE-DERIVED from the imported CACHEABLE_TERMINALS via isCacheableTerminalShape
//    (never the record's self-reported flag; disagreement → diagnostic).
//  - Degenerate receipt intervals (startedAtMs === endedAtMs, both finite — the real M192/M195
//    shape) are excluded as "convergence-interval-degenerate" by an EXTERNAL exact-equality guard
//    composing OVER the reused computeConvergenceMetrics (which itself legitimately returns 0 for
//    that shape — DIR-125's callers depend on that contract).
//  - Output is byte-reproducible: NO generatedAtMs / wall-clock timestamp; every array sorted; the
//    same input tree produces byte-identical JSON, making the reproducibility AC diff-provable.
//  - Every exclusion is reasoned and traced (malformed-json, the validator's own codes e.g.
//    reuse-terminal-invalid, interval-fields-missing [PARTIAL — overlap analysis only],
//    no-convergence-block, convergence-interval-degenerate, caller-supplied --exclusions).
export function computeCapacityReport({ workspace, telemetryRoot, exclusions = [], minSamples = 3 }) {
  const exclusionsOut = [];
  const excludeById = new Map((exclusions || []).map((e) => [e.id, e.reason]));

  // ── Telemetry population: traverse via the shared _walkJsonFiles primitive, trace every parse/
  // validation failure into exclusions[] (a deliberate, flagged divergence from
  // queryTelemetryReport's silent-skip contract), validate every parsed record via the reused
  // exported validateTelemetryRecord (never a second, parallel validation routine). Aggregates
  // across ALL task IDs under the root by default — never one hardcoded taskId.
  const telemetrySamples = [];
  for (const p of _walkJsonFiles(telemetryRoot)) {
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      exclusionsOut.push({ population: "telemetry", id: path.basename(p).replace(/\.json$/, ""), path: p, reason: "malformed-json", detail: e.message });
      continue;
    }
    const id = (rec && rec.recordId) || path.basename(p).replace(/\.json$/, "");
    if (excludeById.has(id)) {
      exclusionsOut.push({ population: "telemetry", id, path: p, reason: String(excludeById.get(id)) });
      continue;
    }
    const v = validateTelemetryRecord(rec);
    if (!v.ok) {
      exclusionsOut.push({ population: "telemetry", id, path: p, reason: v.code, detail: v.message });
      continue;
    }
    telemetrySamples.push({ path: p, record: rec });
  }

  // ── Receipt population: every milestones/M*/preparation.json under the workspace, wall time via
  // the reused computeMetricsForReceipt → computeConvergenceMetrics (C4: never re-derived).
  const receiptSamples = [];
  const receiptRawById = new Map();
  const milestonesRoot = path.join(workspace, "milestones");
  const milestoneDirs = [];
  if (fs.existsSync(milestonesRoot)) {
    for (const entry of fs.readdirSync(milestonesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^M\d+$/.test(entry.name)) milestoneDirs.push(entry.name);
    }
  }
  milestoneDirs.sort();
  for (const m of milestoneDirs) {
    const receiptFile = path.join(milestonesRoot, m, "preparation.json");
    if (!fs.existsSync(receiptFile)) continue;
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    } catch (e) {
      exclusionsOut.push({ population: "receipt", id: receiptFile, path: receiptFile, reason: "malformed-json", detail: e.message });
      continue;
    }
    // Keep the raw taskId/milestoneId for the absorbed-task numerator even when this receipt is
    // excluded from wall-time stats below (file-presence identity, not stats eligibility).
    receiptRawById.set(receiptFile, { taskId: receipt.taskId ?? null, milestoneId: receipt.milestoneId || m });
    if (excludeById.has(receiptFile) || excludeById.has(m)) {
      exclusionsOut.push({ population: "receipt", id: receiptFile, path: receiptFile, reason: String(excludeById.get(receiptFile) ?? excludeById.get(m)) });
      continue;
    }
    const metricsResult = computeMetricsForReceipt({ receiptFile });
    if (!metricsResult.ok) {
      exclusionsOut.push({ population: "receipt", id: receiptFile, path: receiptFile, reason: metricsResult.code === "convergence-not-recorded" ? "no-convergence-block" : metricsResult.code });
      continue;
    }
    const c = receipt.convergence || {};
    // External degenerate-interval guard (C9): fires ONLY on exact startedAtMs === endedAtMs
    // equality with both finite — never on a short-but-distinct interval. This is the specific
    // guard keeping M195 (the receipt behind DIR-126's founding ~80-minute Finding) from silently
    // reporting prepareWallTimeMs: 0 once real aggregation exists.
    if (Number.isFinite(c.startedAtMs) && Number.isFinite(c.endedAtMs) && c.startedAtMs === c.endedAtMs) {
      exclusionsOut.push({ population: "receipt", id: receiptFile, path: receiptFile, reason: "convergence-interval-degenerate" });
      continue;
    }
    receiptSamples.push({
      path: receiptFile, milestoneId: receipt.milestoneId || m, taskId: receipt.taskId ?? null,
      highRisk: !!c.highRisk, prepareWallTimeMs: metricsResult.metrics.prepareWallTimeMs,
    });
  }

  const sortIds = (arr) => [...arr].sort((a, b) => String(a).localeCompare(String(b)));
  const telemetryIds = sortIds(telemetrySamples.map(({ record }) => record.recordId));
  const receiptIds = sortIds(receiptSamples.map(({ path: p }) => p));
  const sampleCount = telemetrySamples.length + receiptSamples.length;
  const sampleIds = sortIds([...telemetryIds, ...receiptIds]);
  const perPopulation = {
    telemetry: { count: telemetrySamples.length, sampleIds: telemetryIds },
    receipts: { count: receiptSamples.length, sampleIds: receiptIds },
  };

  const sortedExclusions = exclusionsOut.sort((a, b) =>
    [a.population, a.id, a.reason].join("\x00").localeCompare([b.population, b.id, b.reason].join("\x00")));

  // ── Sample-count gate: below --min-samples (default 3), combined OR per-population, no P50/P85.
  // Per-population counts are ALWAYS reported separately, never blended into one combined total
  // that could hide a thin population behind a fatter one. insufficient-samples is a normal,
  // successful report (the CLI exits 0), not a usage failure.
  if (sampleCount < minSamples || telemetrySamples.length < minSamples || receiptSamples.length < minSamples) {
    return { code: "insufficient-samples", minSamples, sampleCount, sampleIds, perPopulation, exclusions: sortedExclusions };
  }

  // ── Two wall-time distributions, labeled and never pooled.
  const dist = (values) => {
    if (values.length === 0) return { n: 0, minMs: null, p50Ms: null, p85Ms: null, maxMs: null, method: "nearest-rank" };
    const sorted = [...values].sort((a, b) => a - b);
    return { n: sorted.length, minMs: sorted[0], p50Ms: percentile(sorted, 50), p85Ms: percentile(sorted, 85), maxMs: sorted[sorted.length - 1], method: "nearest-rank" };
  };
  const proxyMsOf = (rec) =>
    Number.isFinite(rec.recordedAtMs) && Number.isFinite(rec.admission?.acquiredAt)
      ? rec.recordedAtMs - rec.admission.acquiredAt
      : null;
  const telemetryProxyValues = telemetrySamples.map(({ record }) => proxyMsOf(record)).filter((v) => v !== null);
  const receiptWallValues = receiptSamples.map(({ prepareWallTimeMs }) => prepareWallTimeMs).filter((v) => Number.isFinite(v));
  const wallTime = {
    receiptPrepareMs: dist(receiptWallValues),
    telemetryProxyMs: dist(telemetryProxyValues),
    note: "two unpooled distributions — receipt = full prepare loop incl. PlanCheck (computeConvergenceMetrics.prepareWallTimeMs); telemetry proxy = admission.acquiredAt → recordedAtMs (lease-acquire → record-write). Pooling them would fabricate a statistic neither source supports.",
  };

  // ── Agent-work buckets: measured / measuredZero / notMeasured, never blended; plus the
  // explicitly-labeled supplementary wallTimeProxyMinutes (never presented under the contentAgentMs
  // name). null is preserved as notMeasured, never coerced to 0.
  const agentWork = {
    measured: { count: 0, contentAgentMs: 0, recordIds: [] },
    measuredZero: { count: 0, recordIds: [] },
    notMeasured: { count: 0, recordIds: [] },
    wallTimeProxyMinutes: { n: telemetryProxyValues.length, totalMinutes: Number((telemetryProxyValues.reduce((a, b) => a + b, 0) / 60000).toFixed(3)) },
    note: "contentAgentDispatchCount/contentAgentMs are null for cold/resume under schemaVersion 2 — reported notMeasured, never coerced to 0. measuredZero = reuse-terminal/not-evaluated (write-time-guaranteed 0/0, validator-enforced).",
  };
  for (const { record } of telemetrySamples) {
    const kind = record.decision?.kind;
    if (kind === "reuse-terminal" || kind === "not-evaluated") {
      agentWork.measuredZero.count++;
      agentWork.measuredZero.recordIds.push(record.recordId);
    } else if (record.contentAgentMs === null || record.contentAgentDispatchCount === null) {
      agentWork.notMeasured.count++;
      agentWork.notMeasured.recordIds.push(record.recordId);
    } else {
      agentWork.measured.count++;
      agentWork.measured.contentAgentMs += record.contentAgentMs || 0;
      agentWork.measured.recordIds.push(record.recordId);
    }
  }
  agentWork.measuredZero.recordIds.sort();
  agentWork.notMeasured.recordIds.sort();
  agentWork.measured.recordIds.sort();

  // ── Per-stratum breakdowns (class / highRisk / terminal / decision), all task IDs, never one
  // hardcoded taskId. Telemetry strata carry the proxy distribution + content-agent summary;
  // highRisk additionally carries the receipt side (receipts record convergence.highRisk);
  // class/terminal/decision are telemetry-only concepts (receiptCount 0, receiptPrepareMs null).
  const perTask = {};
  const byStratum = { class: {}, highRisk: {}, terminal: {}, decision: {} };
  const stratumEntry = (obj, key) => (obj[key] ??= { telemetryCount: 0, receiptCount: 0, proxyValues: [], receiptWallValues: [], contentAgent: { measuredMs: null, measuredCount: 0, notMeasuredCount: 0, measuredZeroCount: 0 } });
  for (const { record } of telemetrySamples) {
    const kind = record.decision?.kind;
    const terminalKey = `${record.terminal?.phase}/${record.terminal?.reason}`;
    const proxy = proxyMsOf(record);
    for (const [strata, key] of [
      [byStratum.class, record.class ?? "unknown"],
      [byStratum.highRisk, String(!!record.highRisk)],
      [byStratum.terminal, terminalKey],
      [byStratum.decision, kind ?? "unknown"],
    ]) {
      const e = stratumEntry(strata, key);
      e.telemetryCount++;
      if (proxy !== null) e.proxyValues.push(proxy);
      if (kind === "reuse-terminal" || kind === "not-evaluated") e.contentAgent.measuredZeroCount++;
      else if (record.contentAgentMs === null || record.contentAgentDispatchCount === null) e.contentAgent.notMeasuredCount++;
      else {
        e.contentAgent.measuredCount++;
        e.contentAgent.measuredMs = (e.contentAgent.measuredMs || 0) + (record.contentAgentMs || 0);
      }
    }
    const t = (perTask[record.taskId ?? "unknown"] ??= { telemetryCount: 0, receiptCount: 0, telemetryRecordIds: [] });
    t.telemetryCount++;
    t.telemetryRecordIds.push(record.recordId);
  }
  for (const { taskId, highRisk, prepareWallTimeMs } of receiptSamples) {
    const e = stratumEntry(byStratum.highRisk, String(highRisk));
    e.receiptCount++;
    if (Number.isFinite(prepareWallTimeMs)) e.receiptWallValues.push(prepareWallTimeMs);
    const t = (perTask[taskId ?? "unknown"] ??= { telemetryCount: 0, receiptCount: 0, telemetryRecordIds: [] });
    t.receiptCount++;
  }
  const finalizeStratum = (e) => ({
    telemetryCount: e.telemetryCount,
    receiptCount: e.receiptCount,
    telemetryProxyMs: dist(e.proxyValues),
    receiptPrepareMs: e.receiptWallValues.length > 0 ? dist(e.receiptWallValues) : null,
    contentAgent: e.contentAgent,
  });
  for (const group of Object.values(byStratum)) for (const k of Object.keys(group)) group[k] = finalizeStratum(group[k]);
  for (const k of Object.keys(perTask)) {
    perTask[k].telemetryRecordIds.sort();
  }
  // Byte-reproducibility: object KEY order must not depend on filesystem readdir order — rebuild
  // every string-keyed map with sorted keys (JS preserves insertion order on stringify).
  const sortedKeys = (obj) => Object.fromEntries(Object.keys(obj).sort((a, b) => String(a).localeCompare(String(b))).map((k) => [k, obj[k]]));
  for (const gk of Object.keys(byStratum)) byStratum[gk] = sortedKeys(byStratum[gk]);
  const perTaskSorted = sortedKeys(perTask);

  // ── Terminal/decision yield + prepared/attempt ratio (eligible-content-generation denominator
  // shown alongside). not-evaluated is its OWN decision bucket, never folded into cold.
  const byDecisionKind = {};
  const byTerminalReason = {};
  let preparedCount = 0, splitOrPreflightRecommended = 0, terminalReused = 0, transientFailure = 0;
  for (const { record } of telemetrySamples) {
    const kind = record.decision?.kind ?? "unknown";
    byDecisionKind[kind] = (byDecisionKind[kind] || 0) + 1;
    const terminalKey = `${record.terminal?.phase}/${record.terminal?.reason}`;
    byTerminalReason[terminalKey] = (byTerminalReason[terminalKey] || 0) + 1;
    if (kind === "reuse-terminal") terminalReused++;
    else if (record.terminal?.reason === "prepared" || record.terminal?.outcome === "prepared") preparedCount++;
    else if (record.terminal?.reason === "split-recommended" || record.terminal?.reason === "preflight-rejected") splitOrPreflightRecommended++;
    else transientFailure++;
  }
  const attempts = telemetrySamples.length;
  const contentGenerationEligible = telemetrySamples.filter(({ record }) => ["cold", "resume", "reuse-terminal"].includes(record.decision?.kind)).length;
  const yield_ = {
    attempts,
    prepared: preparedCount,
    splitOrPreflightRecommended,
    terminalReused,
    transientFailure,
    preparedOverAttempt: attempts > 0 ? Number((preparedCount / attempts).toFixed(3)) : null,
    contentGenerationEligible,
    byDecisionKind: sortedKeys(byDecisionKind),
    byTerminalReason: sortedKeys(byTerminalReason),
  };

  // ── Best-effort join on embedded (taskId, milestoneId) — unpaired samples on either side still
  // contribute fully to their OWN population's stats (never dropped for lacking a pair).
  const telemetryKeys = new Set(telemetrySamples.map(({ record }) => `${record.taskId}\x00${record.milestoneId}`));
  const receiptKeys = new Set(receiptSamples.map((r) => `${r.taskId}\x00${r.milestoneId}`));
  const join = {
    paired: sortIds([...telemetryKeys].filter((k) => receiptKeys.has(k))).map((k) => k.replace("\x00", "/")),
    telemetryOnly: sortIds([...telemetryKeys].filter((k) => !receiptKeys.has(k))).map((k) => k.replace("\x00", "/")),
    receiptOnly: sortIds([...receiptKeys].filter((k) => !telemetryKeys.has(k))).map((k) => k.replace("\x00", "/")),
  };

  // ── absorbed-task/prepare-hour: numerator = distinct milestone dirs with BOTH preparation.json
  // AND absorb-entry.md (checked-in file presence only — zero MCP/provider calls; the AND matters,
  // milestones with absorb-entry.md alone do NOT qualify); denominator = summed reused
  // computeConvergenceMetrics wall-time HOURS over the convergence-bearing, non-degenerate subset
  // of exactly those receipts.
  const numeratorTaskIds = [];
  const denominatorReceiptPaths = [];
  let denominatorMs = 0;
  for (const m of milestoneDirs) {
    const dir = path.join(milestonesRoot, m);
    const receiptPath = path.join(dir, "preparation.json");
    if (!fs.existsSync(receiptPath) || !fs.existsSync(path.join(dir, "absorb-entry.md"))) continue;
    const rs = receiptSamples.find((r) => r.path === receiptPath);
    // Identity comes from the RAW receipt (even one excluded from wall-time stats as degenerate/
    // no-convergence), falling back to the milestone dir name only if the receipt has no taskId.
    const tid = receiptRawById.get(receiptPath)?.taskId ?? m;
    if (!numeratorTaskIds.includes(tid)) numeratorTaskIds.push(tid);
    if (rs && Number.isFinite(rs.prepareWallTimeMs)) {
      denominatorReceiptPaths.push(rs.path);
      denominatorMs += rs.prepareWallTimeMs;
    }
  }
  numeratorTaskIds.sort();
  denominatorReceiptPaths.sort();
  const denominatorHours = denominatorMs > 0 ? Number((denominatorMs / 3600000).toFixed(6)) : null;
  const absorbedTaskPerPrepareHour = {
    numeratorTaskIds,
    numeratorCount: numeratorTaskIds.length,
    denominatorHours,
    denominatorReceiptPaths,
    absorbedPerPrepareHour: denominatorHours ? Number((numeratorTaskIds.length / denominatorHours).toFixed(3)) : null,
  };

  // ── Concurrent duplicate-generation minutes: group telemetry records by their OWN admission.key
  // ("<workspace>::<taskId>" — reused, never synthesized), sum pairwise interval intersections.
  // A sequential retry starting at/after the prior terminal contributes exactly zero. Records
  // missing admission.acquiredAt/recordedAtMs are excluded from overlap analysis ONLY
  // (PARTIAL "interval-fields-missing" — they still count in decision/agent-work stats and the
  // sample count).
  const overlapIntervals = new Map();
  for (const { record, path: p } of telemetrySamples) {
    const key = record.admission?.key;
    if (!key) continue;
    const start = record.admission?.acquiredAt;
    const end = record.recordedAtMs;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      exclusionsOut.push({ population: "telemetry", id: record.recordId, path: p, reason: "interval-fields-missing", partial: true });
      continue;
    }
    (overlapIntervals.get(key) ?? overlapIntervals.set(key, []).get(key)).push({ recordId: record.recordId, start, end });
  }
  const overlapGroups = [];
  let concurrentDuplicateMs = 0;
  for (const [key, intervals] of [...overlapIntervals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (intervals.length < 2) continue;
    let groupMs = 0;
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        groupMs += Math.max(0, Math.min(intervals[i].end, intervals[j].end) - Math.max(intervals[i].start, intervals[j].start));
      }
    }
    concurrentDuplicateMs += groupMs;
    overlapGroups.push({ key, recordIds: sortIds(intervals.map((x) => x.recordId)), overlapMinutes: Number((groupMs / 60000).toFixed(3)) });
  }

  // ── Unchanged-stable-terminal recomputation: group by (taskId, hashes.{charter,taskContract,
  // proposal,reviewPolicy}) EXACT 4-tuple equality — NEVER terminal-shape alone (with 16 live
  // split-recommended records, shape-only grouping would misclassify every legitimate between-
  // rounds content revision as wasted work). Within a group, order by recordedAtMs ascending;
  // among records sharing a DERIVED-cacheable terminal (via the imported CACHEABLE_TERMINALS
  // bridge), each later one with decision.kind !== "reuse-terminal" is an avoidable recomputation;
  // a later reuse-terminal is a correct hit. Wasted work: the exact measured contentAgentMs when
  // non-null, else routed to notMeasured + proxy accounting — never a fabricated exact number.
  const recomputeGroups = new Map();
  for (const { record } of telemetrySamples) {
    const h = record.hashes || {};
    if (!h.charter || !h.taskContract || !h.proposal || !h.reviewPolicy) continue;
    const gk = [record.taskId ?? "unknown", h.charter, h.taskContract, h.proposal, h.reviewPolicy].join("\x00");
    (recomputeGroups.get(gk) ?? recomputeGroups.set(gk, []).get(gk)).push({
      recordId: record.recordId, recordedAtMs: Number.isFinite(record.recordedAtMs) ? record.recordedAtMs : Number.MAX_SAFE_INTEGER,
      kind: record.decision?.kind, cacheable: isCacheableTerminalShape(record.terminal), contentAgentMs: record.contentAgentMs,
      proxyMs: proxyMsOf(record),
    });
  }
  let unchangedTerminalRecomputations = 0;
  let wastedMeasuredContentAgentMs = null;
  let notMeasuredRecomputations = 0;
  let wallTimeProxyMinutesForNotMeasuredRecomputations = 0;
  let terminalReuseHits = 0;
  const terminalReuseHitRecordIds = [];
  const recomputationGroupEntries = [];
  for (const [gk, entries] of [...recomputeGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    entries.sort((a, b) => a.recordedAtMs - b.recordedAtMs || String(a.recordId).localeCompare(String(b.recordId)));
    const cacheables = entries.filter((e) => e.cacheable);
    const recomputationRecordIds = [];
    for (const e of entries) if (e.kind === "reuse-terminal") { terminalReuseHits++; terminalReuseHitRecordIds.push(e.recordId); }
    for (let i = 1; i < cacheables.length; i++) {
      const e = cacheables[i];
      if (e.kind === "reuse-terminal") continue; // a correct reuse of identical inputs — a hit, not waste
      unchangedTerminalRecomputations++;
      recomputationRecordIds.push(e.recordId);
      if (Number.isFinite(e.contentAgentMs)) {
        wastedMeasuredContentAgentMs = (wastedMeasuredContentAgentMs || 0) + e.contentAgentMs;
      } else {
        notMeasuredRecomputations++;
        if (e.proxyMs !== null) wallTimeProxyMinutesForNotMeasuredRecomputations += e.proxyMs;
      }
    }
    if (recomputationRecordIds.length > 0) {
      const [taskId, charter, taskContract, proposal, reviewPolicy] = gk.split("\x00");
      recomputationGroupEntries.push({
        taskId, hashes: { charter, taskContract, proposal, reviewPolicy },
        groupRecordIds: sortIds(entries.map((e) => e.recordId)),
        recomputationRecordIds: sortIds(recomputationRecordIds),
      });
    }
  }
  terminalReuseHitRecordIds.sort();

  // ── Cacheability diagnostics: derived (from the imported allowlist) vs the record's
  // self-reported terminal.cacheable. Disagreement is surfaced, never silently resolved either
  // way; the derived value governs classification above.
  const diagnostics = [];
  for (const { record } of telemetrySamples) {
    const derived = isCacheableTerminalShape(record.terminal);
    const selfReported = record.terminal?.cacheable === true;
    if (derived !== selfReported) {
      diagnostics.push({
        type: "cacheability-self-report-mismatch", recordId: record.recordId,
        terminal: `${record.terminal?.phase}/${record.terminal?.reason}`,
        derivedCacheable: derived, selfReportedCacheable: selfReported,
      });
    }
  }
  diagnostics.sort((a, b) => String(a.recordId).localeCompare(String(b.recordId)));

  // ── estimatedAvoidedAgentMinutes: computed ONLY when a comparable, same-class/highRisk,
  // non-reuse-terminal sample population with measured contentAgentMs exists — otherwise the
  // literal string "unknown" (savings are never fabricated).
  let estimatedAvoidedAgentMinutes = "unknown";
  if (unchangedTerminalRecomputations > 0) {
    let estimatedMs = 0;
    let estimable = true;
    for (const group of recomputationGroupEntries) {
      for (const rid of group.recomputationRecordIds) {
        const sample = telemetrySamples.find(({ record }) => record.recordId === rid)?.record;
        if (Number.isFinite(sample?.contentAgentMs)) continue; // already measured exactly above
        const comparables = telemetrySamples.filter(({ record }) =>
          record.class === sample?.class && record.highRisk === sample?.highRisk &&
          record.decision?.kind !== "reuse-terminal" && Number.isFinite(record.contentAgentMs));
        if (comparables.length === 0) { estimable = false; break; }
        estimatedMs += comparables.reduce((a, { record }) => a + record.contentAgentMs, 0) / comparables.length;
      }
      if (!estimable) break;
    }
    if (estimable) estimatedAvoidedAgentMinutes = Number((estimatedMs / 60000).toFixed(3));
  }

  exclusionsOut.sort((a, b) => [a.population, a.id, a.reason].join("\x00").localeCompare([b.population, b.id, b.reason].join("\x00")));

  return {
    code: "ok",
    minSamples,
    sampleCount,
    sampleIds,
    perPopulation,
    perTask: perTaskSorted,
    wallTime,
    byStratum,
    agentWork,
    yield: yield_,
    join,
    absorbedTaskPerPrepareHour,
    waste: {
      concurrentDuplicate: { totalMinutes: Number((concurrentDuplicateMs / 60000).toFixed(3)), groups: overlapGroups },
      unchangedTerminal: {
        recomputations: unchangedTerminalRecomputations,
        wastedMeasuredContentAgentMs,
        notMeasuredRecomputations,
        wallTimeProxyMinutesForNotMeasured: Number((wallTimeProxyMinutesForNotMeasuredRecomputations / 60000).toFixed(3)),
        terminalReuseHits,
        terminalReuseHitRecordIds,
        groups: recomputationGroupEntries,
      },
    },
    estimatedAvoidedAgentMinutes,
    diagnostics,
    exclusions: exclusionsOut,
  };
}

// ── parsePlanStages / validatePlanStructure — DIR-117 iteration-2 item 3: real structural Plan
// validation, replacing "Plan quality is entirely delegated to a never-yet-run LLM PlanCheck
// phase" (the iteration-0 REFUTED finding). A checked Plan's stages use a fixed, mechanically-
// parseable convention (the SAME shape `prepare-milestone.js`'s PlanAuthor prompt now instructs):
//
//   ### Stage <N>: <title>
//   - AC: <comma-separated 1-based indices into the task's own '## Acceptance Criteria' checklist>
//   - Files: <comma-separated real file paths>
//   - Command: <or "Check:" — the RED/implementation/GREEN mechanical check to run>
//
// This does not replace the grounded (LLM) PlanCheck review — it adds a REAL, mechanical floor
// under it: every declared AC index must map to >=1 stage, and every stage must name files and a
// check, or the Plan is rejected with a distinct, actionable code before a fixture can pass.
const STAGE_HEADER_RE = /^###\s+Stage\s+(\d+)\s*:\s*(.*)$/gm;

export function parsePlanStages(planText) {
  const text = String(planText ?? "");
  const headers = [...text.matchAll(STAGE_HEADER_RE)];
  const stages = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
    const block = text.slice(start, end);
    const acMatch = block.match(/^-\s*AC:\s*(.+)$/im);
    const filesMatch = block.match(/^-\s*Files:\s*(.+)$/im);
    const checkMatch = block.match(/^-\s*(?:Command|Check):\s*(.+)$/im);
    const ac = acMatch
      ? acMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n))
      : [];
    stages.push({
      number: Number(headers[i][1]),
      title: headers[i][2].trim(),
      ac,
      files: filesMatch ? filesMatch[1].trim() : "",
      check: checkMatch ? checkMatch[1].trim() : "",
    });
  }
  return stages;
}

export function validatePlanStructure(planText, acCount) {
  const stages = parsePlanStages(planText);
  if (stages.length === 0) {
    return { ok: false, code: "plan-no-stages", message: "checked Plan has no '### Stage <N>: ...' blocks — cannot verify AC-to-stage mapping mechanically" };
  }
  for (const s of stages) {
    if (s.ac.length === 0) {
      return { ok: false, code: "plan-stage-missing-ac", message: `Stage ${s.number} ("${s.title}") has no '- AC: ...' mapping` };
    }
    if (!s.files) {
      return { ok: false, code: "plan-stage-missing-files", message: `Stage ${s.number} ("${s.title}") has no '- Files: ...' entry` };
    }
    if (!s.check) {
      return { ok: false, code: "plan-stage-missing-command", message: `Stage ${s.number} ("${s.title}") has no '- Command:'/'- Check:' entry` };
    }
  }
  if (Number.isFinite(acCount) && acCount > 0) {
    const covered = new Set(stages.flatMap((s) => s.ac));
    const missing = [];
    for (let i = 1; i <= acCount; i++) if (!covered.has(i)) missing.push(i);
    if (missing.length > 0) {
      return { ok: false, code: "plan-ac-not-mapped", message: `task Acceptance Criteria item(s) #${missing.join(", #")} are not mapped to any Plan stage (task declares ${acCount} AC item(s))` };
    }
  }
  return { ok: true, code: "plan-structure-ok", message: `Plan has ${stages.length} stage(s), all ${acCount} task AC item(s) mapped` };
}

// ── checkProvenanceDistinctness — DIR-117 iteration-2 item 2: mechanically verifies the receipt
// records WHO ran each role (author/reviewer/plan-checker run identity present and identified).
// A receipt with NO provenance at all is a real, actionable gap (the exact iteration-0 REFUTED
// finding — "no field recording author/reviewer run identity at all") and fails closed rather
// than being silently treated as N/A.
//
// NOTE (2026-07-28, gap-provenance-sessionid-not-independence-signal): this function used to also
// assert the recorded session IDs were pairwise DISTINCT (reviewer's sessionId != any author's,
// plan-checker's != plan-author's), treating `$CLAUDE_CODE_SESSION_ID` as an independence signal.
// That check was a category error, copied without re-verifying its assumption from
// `audit-independence-check.ts`'s standalone-`Agent`-tool-dispatch use case (where distinct
// session IDs genuinely do indicate distinct contexts). It does not transfer to `prepare-
// milestone.js`'s `agent()` sub-dispatches: every `agent()` call inside one Workflow script run
// shares the SAME parent session ID by construction — confirmed empirically against a real M192
// receipt, where proposalAuthors/adjudicator/proposalReviewer/planAuthor/planCheckers all reported
// the identical session ID. That made the distinctness check 100%-reproducibly impossible to pass
// for ANY real dispatch — it was never testing independence, only re-deriving the (constant) fact
// that all sub-agents in one workflow run share a workflow-run id. The real independence guarantee
// for `agent()` sub-dispatches is `agent()`'s own structural fresh-context isolation (each call is
// a new agent instance with zero visibility into sibling agents' internal reasoning/tool-calls,
// only what gets written to shared state) — already guaranteed by the platform, needing no runtime
// re-verification here. Presence/identification of each role's run is still checked below.
export function checkProvenanceDistinctness(provenance) {
  if (!provenance || typeof provenance !== "object") {
    return { ok: false, code: "provenance-missing", message: "preparation receipt has no 'provenance' field — author/reviewer run identity was never recorded" };
  }
  const reviewerSession = provenance.proposalReviewer?.sessionId;
  const planAuthorSession = provenance.planAuthor?.sessionId;
  const planCheckerSessions = Array.isArray(provenance.planCheckers)
    ? provenance.planCheckers.map((p) => p?.sessionId).filter(Boolean)
    : [];

  if (!reviewerSession || !planAuthorSession || planCheckerSessions.length === 0) {
    return { ok: false, code: "provenance-incomplete", message: "preparation receipt's 'provenance' is missing a reviewer, plan-author, or plan-checker run identity" };
  }
  return { ok: true, code: "provenance-recorded", message: "reviewer/plan-author/plan-checker run identities are recorded" };
}

const NA_PLAN_RE = /^\s*N\/A\b/i;

// ── checkPreparation — the ONE assertion the `Prepared` gate calls. ────────────────────────────────
// Returns { ok, code, message } — never a bare boolean, always one actionable code.
export function checkPreparation({ taskFile, charterFile, receiptFile, declaredTouches }) {
  if (!fs.existsSync(receiptFile)) {
    return { ok: false, code: "receipt-missing", message: `no preparation receipt found at ${receiptFile}` };
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  } catch (e) {
    return { ok: false, code: "receipt-malformed", message: `preparation receipt is not valid JSON: ${e.message}` };
  }
  if (!receipt.hashes || !receipt.planFile) {
    return { ok: false, code: "receipt-malformed", message: "preparation receipt is missing required hashes/planFile fields" };
  }

  // Plan-reference check: the task's own `## Plan` must point at the receipt's checked planFile,
  // not remain `N/A`.
  const taskText = fs.readFileSync(taskFile, "utf8");
  const planSection = (extractSection(taskText, "Plan") || "").trim();
  if (NA_PLAN_RE.test(planSection)) {
    return { ok: false, code: "plan-not-checked", message: "task '## Plan' is still 'N/A' — preparation has not replaced it with a checked docs/plans/*.md reference" };
  }
  if (!planSection.includes(receipt.planFile) && !planSection.includes(path.basename(receipt.planFile))) {
    return { ok: false, code: "plan-reference-mismatch", message: `task '## Plan' does not reference the receipt's checked planFile (${receipt.planFile})` };
  }

  const current = computeCurrentHashes({ taskFile, charterFile, receipt });

  if (current.proposal !== receipt.hashes.proposal) {
    return { ok: false, code: "proposal-stale", message: "task '## Proposal' has changed since preparation — rerun the full Proposal→Plan preparation" };
  }
  if (receipt.hashes.charter != null && current.charter !== receipt.hashes.charter) {
    return { ok: false, code: "charter-stale", message: "charter file has changed since preparation — rerun the full Proposal→Plan preparation" };
  }
  if (current.plan !== receipt.hashes.plan) {
    return { ok: false, code: "plan-stale", message: "checked Plan file has changed since preparation — rerun the grounded Plan check" };
  }
  for (const [srcPath, hash] of Object.entries(receipt.hashes.sources || {})) {
    if (current.sources[srcPath] === null) {
      return { ok: false, code: "source-missing", message: `checked source file no longer exists: ${srcPath}` };
    }
    if (current.sources[srcPath] !== hash) {
      return { ok: false, code: "source-stale", message: `checked source file has changed since preparation: ${srcPath} — rerun the grounded Proposal/Plan review` };
    }
  }

  if ((receipt.review?.findings ?? 1) !== 0) {
    return { ok: false, code: "review-nonzero-findings", message: `grounded proposal review has ${receipt.review.findings} unresolved finding(s) — preparation cannot pass until findings reach zero` };
  }
  const rounds = receipt.planCheck?.rounds ?? 0;
  if (rounds > 3) {
    return { ok: false, code: "plancheck-rounds-exceeded", message: `Plan-check ran ${rounds} rounds (max 3 allowed by the standardized stopping rule)` };
  }
  if ((receipt.planCheck?.findings ?? 1) !== 0) {
    return { ok: false, code: "plancheck-nonzero-findings", message: `grounded Plan check has ${receipt.planCheck.findings} unresolved finding(s) — preparation cannot pass until F_i=0` };
  }

  // DIR-125 ledger hash-binding + mechanical convergence-cap re-check. Fully backward-compatible:
  // a receipt built before DIR-125 (no `ledgerFile`/`convergence`) skips this block entirely and
  // relies solely on the scalar `review.findings`/`planCheck.findings` checks above.
  if (receipt.ledgerFile) {
    if (!fs.existsSync(receipt.ledgerFile)) {
      return { ok: false, code: "ledger-missing", message: `preparation receipt names a finding ledger that no longer exists: ${receipt.ledgerFile}` };
    }
    const currentLedgerHash = sha256(fs.readFileSync(receipt.ledgerFile, "utf8"));
    if (currentLedgerHash !== receipt.hashes?.ledger) {
      return { ok: false, code: "ledger-stale", message: `finding ledger (${receipt.ledgerFile}) has changed since preparation, or this receipt has been paired with a ledger it did not build — rerun preparation` };
    }
    let ledger;
    try {
      ledger = JSON.parse(fs.readFileSync(receipt.ledgerFile, "utf8"));
    } catch (e) {
      return { ok: false, code: "ledger-malformed", message: `finding ledger is not valid JSON: ${e.message}` };
    }
    const openBlocking = blockingOpen(ledger);
    if (openBlocking.length > 0) {
      return { ok: false, code: "ledger-blocking-findings-open", message: `finding ledger still has ${openBlocking.length} open blocking finding(s) — preparation cannot pass until they are resolved or the ledger is superseded by a fresh receipt` };
    }
  }
  // DIR-126-D/M203 Claim A.5 — telemetry hash-binding, structurally identical to the receipt.ledgerFile
  // block above. Fully backward-compatible: a receipt built before DIR-126-D (no `telemetryFile`)
  // skips this block entirely — no existing M195/M197/M200/M201/M202-shaped fixture becomes
  // stricter. Instrumentation can never turn a failed preparation into a falsely-certified
  // `prepared`: a receipt naming a missing/mismatched telemetry record fails closed here, before
  // the final `{ok:true, code:"prepared"}` return below is ever reached.
  if (receipt.telemetryFile) {
    if (!fs.existsSync(receipt.telemetryFile)) {
      return { ok: false, code: "telemetry-missing", message: `preparation receipt names a telemetry record that no longer exists: ${receipt.telemetryFile}` };
    }
    const currentTelemetryHash = sha256(fs.readFileSync(receipt.telemetryFile, "utf8"));
    if (currentTelemetryHash !== receipt.hashes?.telemetry) {
      return { ok: false, code: "telemetry-stale", message: `telemetry record (${receipt.telemetryFile}) has changed since preparation, or this receipt has been paired with a telemetry record it did not build — rerun preparation` };
    }
  }
  if (receipt.convergence) {
    const convergenceResult = validateConvergenceCounters({
      highRisk: receipt.convergence.highRisk,
      fullSynthesisCount: receipt.convergence.fullSynthesisCount,
      deltaRounds: receipt.convergence.deltaRounds,
    });
    if (!convergenceResult.ok) {
      return { ok: false, code: convergenceResult.code, message: convergenceResult.message };
    }
  }

  // Provenance recorded (DIR-117 iteration-2 item 2): the receipt must record REAL
  // author/reviewer/plan-checker run identities — not merely assert it in prose. See
  // checkProvenanceDistinctness()'s own doc comment for why this no longer also asserts
  // session-ID distinctness.
  const provenanceResult = checkProvenanceDistinctness(receipt.provenance);
  if (!provenanceResult.ok) {
    return { ok: false, code: provenanceResult.code, message: provenanceResult.message };
  }

  // Structural Plan validation (DIR-117 iteration-2 item 3): every task AC item must map to >=1
  // named Plan stage with real files and a real check — mechanical, not delegated entirely to the
  // (separately still-required) grounded LLM PlanCheck phase.
  const planTextNow = fs.existsSync(receipt.planFile) ? fs.readFileSync(receipt.planFile, "utf8") : "";
  const acSection = extractSection(taskText, "Acceptance Criteria") || "";
  const { total: acCount } = countBoxes(acSection);
  const structureResult = validatePlanStructure(planTextNow, acCount);
  if (!structureResult.ok) {
    return { ok: false, code: structureResult.code, message: structureResult.message };
  }

  // Touch-set completeness: a real batch candidate whose checked Plan expands `## Touches` beyond
  // the task/charter declaration must be re-evaluated, not silently allowed through with the
  // stale narrower declaration. Single-sourced via computeTouchesExpansion (also reused by
  // concurrent-batch-scheduler.ts's real batch re-assembly loop — DIR-117 iteration-2 item 4).
  if (Array.isArray(declaredTouches) && Array.isArray(receipt.touches) && receipt.touches.length > 0) {
    const { expanded } = computeTouchesExpansion(receipt.touches, declaredTouches);
    if (expanded.length > 0) {
      return {
        ok: false,
        code: "touches-expanded",
        message: `checked Plan's touch set includes ${expanded.length} path(s) not in the declared '## Touches': ${expanded.join(", ")} — update the declaration and rerun final batch assembly before dispatch`,
      };
    }
  }

  return { ok: true, code: "prepared", message: `preparation receipt matches current state; review/plan-check both zero-finding (${rounds} round(s))` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { build: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--task") out.taskFile = argv[++i];
    else if (a === "--charter") out.charterFile = argv[++i];
    else if (a === "--receipt") out.receiptFile = argv[++i];
    else if (a === "--declared-touches") out.declaredTouchesFile = argv[++i];
    else if (a === "--build") out.build = true;
    else if (a === "--plan") out.planFile = argv[++i];
    else if (a === "--out") out.outFile = argv[++i];
    else if (a === "--task-id") out.taskId = argv[++i];
    else if (a === "--milestone-id") out.milestoneId = argv[++i];
    else if (a === "--sources") out.sourceFiles = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--review-findings") out.reviewFindings = Number(argv[++i]);
    else if (a === "--plancheck-rounds") out.planCheckRounds = Number(argv[++i]);
    else if (a === "--plancheck-findings") out.planCheckFindings = Number(argv[++i]);
    else if (a === "--touches") out.touches = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    // DIR-117 iteration-2 item 2 — real, distinct run-identity provenance (never a bare boolean
    // "trust me": each flag is a session id captured by that phase's OWN agent dispatch).
    else if (a === "--proposal-author-sessions") out.proposalAuthorSessions = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--adjudicator-session") out.adjudicatorSession = argv[++i];
    else if (a === "--review-session") out.reviewSession = argv[++i];
    else if (a === "--plan-author-session") out.planAuthorSession = argv[++i];
    else if (a === "--plancheck-sessions") out.planCheckSessions = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    // DIR-125 — the derived typed finding ledger (hash-bound into the receipt) and its convergence
    // counters/metrics (mechanically re-verified against policy caps, never trusted as-is).
    else if (a === "--ledger") out.ledgerFile = argv[++i];
    else if (a === "--convergence-json") out.convergenceJson = argv[++i];
    else if (a === "--metrics") out.metrics = true;
    // DIR-126-D/M203 Claim A.5/B.1 — telemetry hash-binding (--telemetry, mirrors --ledger) and the
    // read-only query mode (--telemetry-report <milestoneId>). --workspace is the root
    // queryTelemetryReport scans milestones/prepare-telemetry/ under (defaults to "." — the SAME
    // default proposal-convergence.ts's own CLI implicitly relies on via its own --workspace flag).
    else if (a === "--telemetry") out.telemetryFile = argv[++i];
    else if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--telemetry-report") out.telemetryReportMilestoneId = argv[++i];
    // DIR-126-E/M204 — the read-only capacity-aggregation mode: --capacity-report aggregates BOTH
    // checked-in artifact populations (telemetry records + preparation receipts) into P50/P85
    // wall-time distributions and the waste/yield/absorption statistics the throughput doc cites.
    // --telemetry-glob supports exactly the fixed '<root>/**/*.json' shape (no glob engine, no
    // fs.globSync — below the repo's Node-20 packaging floor); --exclusions is a caller-supplied
    // JSON array of {id, reason} entries; --min-samples (default 3) gates the insufficient-samples
    // path. Reuses the existing --workspace (default ".") and --out flags.
    else if (a === "--capacity-report") out.capacityReport = true;
    else if (a === "--telemetry-glob") out.telemetryGlob = argv[++i];
    else if (a === "--exclusions") out.exclusionsFile = argv[++i];
    else if (a === "--min-samples") out.minSamples = Number(argv[++i]);
  }
  return out;
}

// Realpath-based direct-invocation guard — mirror-symlink-safe (gap-config-wiring-check-symlink-
// noop / gap-touches-orthogonality-symlink-isdirect-mismatch pattern, reused not reinvented: raw
// `process.argv[1] === fileURLToPath(import.meta.url)` string equality never holds when this
// script is invoked via the `experiments/quay-perpetual-stream/scripts/` mirror symlink).
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    const invokedReal = fs.realpathSync(path.resolve(process.argv[1]));
    const moduleReal = fileURLToPath(import.meta.url);
    return invokedReal === moduleReal;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.build) {
    // ── --build mode: author a fresh receipt from the CURRENT state of the named inputs. Used by
    // the prepare-milestone workflow's Receipt phase (a single command instead of hand-rolled JSON) —
    // never a second implementation of the hashing logic (reuses buildReceipt() above).
    const {
      taskFile, charterFile, planFile, outFile, taskId, milestoneId, sourceFiles,
      reviewFindings, planCheckRounds, planCheckFindings, touches,
      proposalAuthorSessions, adjudicatorSession, reviewSession, planAuthorSession, planCheckSessions,
      ledgerFile, convergenceJson, telemetryFile,
    } = parsed;
    if (!taskFile || !charterFile || !planFile || !outFile || !taskId) {
      console.error("usage: node milestone-preparation-check.ts --build --task-id <id> --task <task.md> --charter <charter.md> --plan <plan.md> --out <receipt.json> [--milestone-id <M-id>] [--sources a,b,c] [--review-findings N] [--plancheck-rounds N] [--plancheck-findings N] [--touches a,b,c] [--proposal-author-sessions a,b] [--adjudicator-session id] [--review-session id] [--plan-author-session id] [--plancheck-sessions r1,r2] [--ledger ledger.json] [--convergence-json '{...}'] [--telemetry telemetry.json]");
      process.exit(2);
    }
    if (ledgerFile && !fs.existsSync(ledgerFile)) {
      console.error(`ERROR: --ledger file does not exist: ${ledgerFile}`);
      process.exit(2);
    }
    if (telemetryFile && !fs.existsSync(telemetryFile)) {
      console.error(`ERROR: --telemetry file does not exist: ${telemetryFile}`);
      process.exit(2);
    }
    let convergence = null;
    if (convergenceJson) {
      try {
        convergence = JSON.parse(convergenceJson);
      } catch (e) {
        console.error(`ERROR: --convergence-json is not valid JSON: ${e.message}`);
        process.exit(2);
      }
    }
    const provenance = (reviewSession || planAuthorSession || (planCheckSessions && planCheckSessions.length))
      ? {
          proposalAuthors: (proposalAuthorSessions || []).map((sessionId, i) => ({ authorIdx: i + 1, sessionId })),
          adjudicator: adjudicatorSession ? { sessionId: adjudicatorSession } : null,
          proposalReviewer: reviewSession ? { sessionId: reviewSession } : null,
          planAuthor: planAuthorSession ? { sessionId: planAuthorSession } : null,
          planCheckers: (planCheckSessions || []).map((sessionId, i) => ({ round: i + 1, sessionId })),
        }
      : null;
    const receipt = buildReceipt({
      taskId, milestoneId, charterFile, taskFile, planFile,
      sourceFiles: sourceFiles || [],
      review: { findings: Number.isFinite(reviewFindings) ? reviewFindings : 0 },
      planCheck: { rounds: Number.isFinite(planCheckRounds) ? planCheckRounds : 1, findings: Number.isFinite(planCheckFindings) ? planCheckFindings : 0 },
      touches: touches || [],
      provenance,
      ledgerFile: ledgerFile || undefined,
      convergence,
      telemetryFile: telemetryFile || undefined,
    });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(receipt, null, 2) + "\n");
    console.log(`WROTE: ${outFile}`);
    process.exit(0);
  }

  if (parsed.metrics) {
    // ── --metrics mode: DIR-125 mechanically-queryable convergence metrics for one candidate. ────
    if (!parsed.receiptFile) {
      console.error("usage: node milestone-preparation-check.ts --metrics --receipt <receipt.json>");
      process.exit(2);
    }
    const result = computeMetricsForReceipt({ receiptFile: parsed.receiptFile });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (parsed.telemetryReportMilestoneId) {
    // ── --telemetry-report <milestoneId> mode: DIR-126-D/M203 Claim B.1 read-only query. ─────────
    const result = queryTelemetryReport({ workspace: parsed.workspace || ".", milestoneId: parsed.telemetryReportMilestoneId });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (parsed.capacityReport) {
    // ── --capacity-report mode: DIR-126-E/M204 read-only capacity aggregation over BOTH checked-in
    // artifact populations (telemetry records under --telemetry-glob + milestones/M*/preparation.json
    // receipts). Exit 0 for BOTH `ok` and `insufficient-samples` (a normal, successful report, not
    // a usage failure); exit 2 only on a hard usage/environment error — matching this file's
    // existing parseArgs/exit-2 convention. The stdout JSON and the --out file carry the SAME
    // bytes, with NO generatedAtMs — byte-identical re-runs over the same input tree.
    const glob = parsed.telemetryGlob || "milestones/prepare-telemetry/**/*.json";
    if (!glob.endsWith("/**/*.json")) {
      console.error(`ERROR: --telemetry-glob must have the fixed shape '<root>/**/*.json', got: ${glob}`);
      process.exit(2);
    }
    const ws = parsed.workspace || ".";
    if (!fs.existsSync(ws)) {
      console.error(`ERROR: --workspace does not exist or is not readable: ${ws}`);
      process.exit(2);
    }
    let exclusions = [];
    if (parsed.exclusionsFile) {
      if (!fs.existsSync(parsed.exclusionsFile)) {
        console.error(`ERROR: --exclusions file does not exist: ${parsed.exclusionsFile}`);
        process.exit(2);
      }
      try {
        exclusions = JSON.parse(fs.readFileSync(parsed.exclusionsFile, "utf8"));
      } catch (e) {
        console.error(`ERROR: --exclusions file is not valid JSON: ${e.message}`);
        process.exit(2);
      }
      if (!Array.isArray(exclusions) || exclusions.some((e) => !e || typeof e.id === "undefined" || typeof e.reason === "undefined")) {
        console.error("ERROR: --exclusions file must be a JSON array of {id, reason} entries");
        process.exit(2);
      }
    }
    const globRoot = glob.slice(0, -"/**/*.json".length);
    const result = computeCapacityReport({
      workspace: ws,
      telemetryRoot: path.resolve(ws, globRoot),
      exclusions,
      minSamples: Number.isFinite(parsed.minSamples) ? parsed.minSamples : 3,
    });
    const json = JSON.stringify(result, null, 2);
    console.log(json);
    if (parsed.outFile) {
      fs.mkdirSync(path.dirname(parsed.outFile), { recursive: true });
      fs.writeFileSync(parsed.outFile, json + "\n");
    }
    process.exit(0);
  }

  const { taskFile, charterFile, receiptFile, declaredTouchesFile } = parsed;
  if (!taskFile || !charterFile || !receiptFile) {
    console.error("usage: node milestone-preparation-check.ts --task <task.md> --charter <charter.md> --receipt <receipt.json> [--declared-touches <file-with-one-glob-per-line>]");
    process.exit(2);
  }
  let declaredTouches;
  if (declaredTouchesFile && fs.existsSync(declaredTouchesFile)) {
    declaredTouches = fs.readFileSync(declaredTouchesFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  const result = checkPreparation({ taskFile, charterFile, receiptFile, declaredTouches });
  if (result.ok) {
    console.log(`PASS: ${result.code} — ${result.message}`);
    process.exit(0);
  } else {
    console.log(`FAIL: ${result.code} — ${result.message}`);
    process.exit(1);
  }
}
