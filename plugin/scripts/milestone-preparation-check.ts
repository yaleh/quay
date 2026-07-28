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
import { extractSection } from "./task-schema.ts";

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
export function buildReceipt({ taskId, milestoneId, charterFile, taskFile, planFile, sourceFiles = [], review, planCheck, touches = [] }) {
  const taskText = fs.readFileSync(taskFile, "utf8");
  const proposalSection = extractSection(taskText, "Proposal") || "";
  const charterText = fs.readFileSync(charterFile, "utf8");
  const planText = fs.readFileSync(planFile, "utf8");
  const sources = {};
  for (const f of sourceFiles) sources[f] = sha256(fs.readFileSync(f, "utf8"));
  return {
    taskId,
    milestoneId,
    charterFile,
    planFile,
    hashes: {
      proposal: sha256(proposalSection.trim()),
      charter: sha256(charterText),
      plan: sha256(planText),
      sources,
    },
    review: review ?? { findings: 0 },
    planCheck: planCheck ?? { rounds: 1, findings: 0 },
    touches,
  };
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

  // Touch-set completeness: a real batch candidate whose checked Plan expands `## Touches` beyond
  // the task/charter declaration must be re-evaluated, not silently allowed through with the
  // stale narrower declaration.
  if (Array.isArray(declaredTouches) && Array.isArray(receipt.touches) && receipt.touches.length > 0) {
    const expanded = receipt.touches.filter((t) => !declaredTouches.includes(t));
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
    const { taskFile, charterFile, planFile, outFile, taskId, milestoneId, sourceFiles, reviewFindings, planCheckRounds, planCheckFindings, touches } = parsed;
    if (!taskFile || !charterFile || !planFile || !outFile || !taskId) {
      console.error("usage: node milestone-preparation-check.ts --build --task-id <id> --task <task.md> --charter <charter.md> --plan <plan.md> --out <receipt.json> [--milestone-id <M-id>] [--sources a,b,c] [--review-findings N] [--plancheck-rounds N] [--plancheck-findings N] [--touches a,b,c]");
      process.exit(2);
    }
    const receipt = buildReceipt({
      taskId, milestoneId, charterFile, taskFile, planFile,
      sourceFiles: sourceFiles || [],
      review: { findings: Number.isFinite(reviewFindings) ? reviewFindings : 0 },
      planCheck: { rounds: Number.isFinite(planCheckRounds) ? planCheckRounds : 1, findings: Number.isFinite(planCheckFindings) ? planCheckFindings : 0 },
      touches: touches || [],
    });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(receipt, null, 2) + "\n");
    console.log(`WROTE: ${outFile}`);
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
