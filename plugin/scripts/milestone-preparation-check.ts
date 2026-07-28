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
import { blockingOpen, validateConvergenceCounters, computeConvergenceMetrics } from "./proposal-convergence.ts";

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
export function buildReceipt({ taskId, milestoneId, charterFile, taskFile, planFile, sourceFiles = [], review, planCheck, touches = [], provenance, ledgerFile, convergence }) {
  const taskText = fs.readFileSync(taskFile, "utf8");
  const proposalSection = extractSection(taskText, "Proposal") || "";
  const charterText = fs.readFileSync(charterFile, "utf8");
  const planText = fs.readFileSync(planFile, "utf8");
  const sources = {};
  for (const f of sourceFiles) sources[f] = sha256(fs.readFileSync(f, "utf8"));
  const ledgerHash = ledgerFile ? sha256(fs.readFileSync(ledgerFile, "utf8")) : undefined;
  return {
    taskId,
    milestoneId,
    charterFile,
    planFile,
    ledgerFile: ledgerFile ?? null,
    hashes: {
      proposal: sha256(proposalSection.trim()),
      charter: sha256(charterText),
      plan: sha256(planText),
      sources,
      ...(ledgerHash !== undefined ? { ledger: ledgerHash } : {}),
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

// ── checkProvenanceDistinctness — DIR-117 iteration-2 item 2: mechanically verifies the receipt's
// author/reviewer run identities are actually DISTINCT contexts, not merely present. A receipt
// with NO provenance at all is a real, actionable gap (the exact iteration-0 REFUTED finding —
// "no field recording author/reviewer run identity at all") and fails closed rather than being
// silently treated as N/A.
export function checkProvenanceDistinctness(provenance) {
  if (!provenance || typeof provenance !== "object") {
    return { ok: false, code: "provenance-missing", message: "preparation receipt has no 'provenance' field — author/reviewer run identity was never recorded" };
  }
  const authorSessions = Array.isArray(provenance.proposalAuthors)
    ? provenance.proposalAuthors.map((a) => a?.sessionId).filter(Boolean)
    : [];
  const adjudicatorSession = provenance.adjudicator?.sessionId;
  const reviewerSession = provenance.proposalReviewer?.sessionId;
  const planAuthorSession = provenance.planAuthor?.sessionId;
  const planCheckerSessions = Array.isArray(provenance.planCheckers)
    ? provenance.planCheckers.map((p) => p?.sessionId).filter(Boolean)
    : [];

  if (!reviewerSession || !planAuthorSession || planCheckerSessions.length === 0) {
    return { ok: false, code: "provenance-incomplete", message: "preparation receipt's 'provenance' is missing a reviewer, plan-author, or plan-checker run identity" };
  }
  const authorLikeSessions = [...authorSessions, adjudicatorSession].filter(Boolean);
  if (authorLikeSessions.includes(reviewerSession)) {
    return { ok: false, code: "provenance-not-distinct", message: "the proposal reviewer's run identity matches an author's/adjudicator's — review was not performed by a distinct context" };
  }
  if (planCheckerSessions.includes(planAuthorSession)) {
    return { ok: false, code: "provenance-not-distinct", message: "a plan-checker's run identity matches the plan-author's — Plan check was not performed by a distinct context" };
  }
  return { ok: true, code: "provenance-distinct", message: "reviewer/plan-checker run identities are recorded and distinct from their authors" };
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

  // Provenance distinctness (DIR-117 iteration-2 item 2): the receipt must record REAL,
  // mechanically-distinct author/reviewer run identities — not merely assert "distinct contexts"
  // in prose. See checkProvenanceDistinctness()'s own doc comment.
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
      ledgerFile, convergenceJson,
    } = parsed;
    if (!taskFile || !charterFile || !planFile || !outFile || !taskId) {
      console.error("usage: node milestone-preparation-check.ts --build --task-id <id> --task <task.md> --charter <charter.md> --plan <plan.md> --out <receipt.json> [--milestone-id <M-id>] [--sources a,b,c] [--review-findings N] [--plancheck-rounds N] [--plancheck-findings N] [--touches a,b,c] [--proposal-author-sessions a,b] [--adjudicator-session id] [--review-session id] [--plan-author-session id] [--plancheck-sessions r1,r2] [--ledger ledger.json] [--convergence-json '{...}']");
      process.exit(2);
    }
    if (ledgerFile && !fs.existsSync(ledgerFile)) {
      console.error(`ERROR: --ledger file does not exist: ${ledgerFile}`);
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
