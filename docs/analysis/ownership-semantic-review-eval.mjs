#!/usr/bin/env node
// ISOLATED EVALUATION of the ownership semantic review — cases + scorer.
//
// THE ISOLATION IS THE POINT. `plugin/fixtures/ownership-semantic-eval/` is added to the shared
// DENY_PATH_PATTERNS, so the investigation loop's read_file/grep cannot reach it, and NOTHING in the
// review path (`assembleOwnershipEvidence` / `ownershipFacts` / `reviewOwnership`) takes a label: the
// label is read HERE, by the scorer, after the review has already returned. A review that could see the
// answer would measure nothing (硬规则 4 推论三: a criterion only a fixture can satisfy is an echo).
//
// LABEL SOURCES, scored in SEPARATE buckets (never pooled):
//   human-approved  a cut a human landed and ruled correct (GOAL-034's own cut, GOAL-033's own cut)
//   human-rejected  a cut a human explicitly ruled OUT (GOAL-034's "stop widening the scope" signal)
//   derived         a production candidate whose label is DERIVED offline from a human ruling that covers
//                   its class, not from a ruling on this candidate
//   unlabeled       a production candidate nobody has ruled on — reported, never scored
// Only `human-*` cases enter the confusion readings; `derived` and `unlabeled` are listed as their own
// readings, because turning a derived label into a headline accuracy would be the same error as pooling them.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assembleOwnershipEvidence, ownershipFacts, reviewOwnership } from "./ownership-semantic-review.mjs";

export const EVAL_VERSION = "ownership-semantic-review-eval/1";
export const LABEL_SOURCES = Object.freeze(["human-approved", "human-rejected", "derived", "unlabeled"]);
/** The scorer's vocabulary. `approve` = the cut should be kept; `reject` = it should not. */
export const LABELS = Object.freeze(["approve", "reject"]);

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Load and structurally check a cases file. A malformed case is an ERROR, never a skipped row (硬规则 3b). */
export function loadCases(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const cases = Array.isArray(raw?.cases) ? raw.cases : null;
  if (!cases) return { ok: false, reason: "CASES_MISSING: the file carries no `cases` array", cases: [] };
  for (const c of cases) {
    if (!c.id || !c.commit || !c.scope_root || !Array.isArray(c.moves) || !c.moves.length) return { ok: false, reason: `CASE_MALFORMED:${c.id ?? "(no id)"}`, cases: [] };
    if (!LABEL_SOURCES.includes(c.label_source)) return { ok: false, reason: `LABEL_SOURCE_UNKNOWN:${c.id}:${c.label_source}`, cases: [] };
    if (c.label_source === "unlabeled" && c.label !== null) return { ok: false, reason: `UNLABELED_CASE_CARRIES_A_LABEL:${c.id}`, cases: [] };
    if (c.label_source !== "unlabeled" && !LABELS.includes(c.label)) return { ok: false, reason: `LABEL_UNKNOWN:${c.id}:${String(c.label)}`, cases: [] };
  }
  return { ok: true, reason: `OK:${cases.length} case(s)`, cases, case_file: path.resolve(file), sha256: sha256(JSON.stringify(raw)) };
}

/**
 * Score ONE review result against ONE label. The label enters HERE and nowhere earlier — this function is
 * the only place in the pipeline that is allowed to see it.
 *
 * ⛔ `abstain` and `not-evaluated` are counted SEPARATELY and are NOT "correct": a layer that abstains on
 *    everything is not a working layer, and calling abstention an accurate answer is how a useless judge
 *    scores 100%. FP = a positive case judged `reject`; FN = a negative case judged `review`.
 */
export function scoreCase({ label, label_source, review }) {
  const rec = review?.state === "evaluated" ? review.overall?.recommendation : "not-evaluated";
  const row = { recommendation: rec, outcome: null, counts_toward_confusion: false };
  if (!["review", "reject", "abstain"].includes(rec)) { row.outcome = "not-evaluated"; return row; }
  if (label == null || label_source === "unlabeled") { row.outcome = "unscored"; return row; }
  row.counts_toward_confusion = label_source === "human-approved" || label_source === "human-rejected";
  const wants = label === "approve" ? "review" : "reject";
  if (rec === "abstain") { row.outcome = "abstain"; return row; }              // never counted as correct
  if (rec === wants) { row.outcome = "correct"; return row; }
  row.outcome = rec === "reject" ? "false-positive" : "false-negative";
  return row;
}

/** Aggregate the per-case rows. Rates are reported ONLY when the denominator is large enough to carry one. */
export function summarize(rows) {
  const human = rows.filter((r) => r.counts_toward_confusion);
  const positives = human.filter((r) => r.label === "approve");
  const negatives = human.filter((r) => r.label === "reject");
  const count = (xs, o) => xs.filter((r) => r.outcome === o).length;
  const summary = {
    n_total: rows.length,
    by_label_source: Object.fromEntries(LABEL_SOURCES.map((s) => [s, rows.filter((r) => r.label_source === s).length])),
    human_labeled: {
      n: human.length,
      correct: count(human, "correct"),
      false_positives: count(human, "false-positive"),   // a POSITIVE case the review rejected
      false_negatives: count(human, "false-negative"),   // a NEGATIVE case the review accepted
      abstain: count(human, "abstain"),
      not_evaluated: count(human, "not-evaluated"),
      positives: { n: positives.length, of_which_false_positive: count(positives, "false-positive"), of_which_abstain: count(positives, "abstain") },
      negatives: { n: negatives.length, of_which_false_negative: count(negatives, "false-negative"), of_which_abstain: count(negatives, "abstain") },
    },
    // 小 n 只报读数不报比率: a rate over 2 human cases is not a rate, it is the two cases again.
    rates_reported: human.length >= 10,
    note: "abstain and not-evaluated are listed separately and are NOT counted as correct",
  };
  return summary;
}

/**
 * Run the whole set. `invokeJudge` is injected (the real tool-less launcher in production, a scripted fake
 * in the suite). `graph`/`graphFor` are optional: a case with no corresponding ArchGuard snapshot is
 * honestly reviewed with the graph half `not-evaluated`, never with a graph from a different tree.
 *
 * @returns {Promise<object>} per-case readings + the confusion readings. Every field a reader needs to
 *          re-derive the verdict is present: refs, facts, judge calls, bundle bytes, elapsed ms, prompt sha.
 */
export async function runEval({ cases, root, invokeJudge, graphFor = () => null, now = () => Date.now(), onCase = () => {} }) {
  const rows = [];
  for (const c of cases) {
    const t0 = now();
    let bundle = null, facts = null, review = null, error = null;
    try {
      const slice = { subject: c.subject ?? c.id, scope_root: c.scope_root, moves: c.moves };
      bundle = assembleOwnershipEvidence({ root, commit: c.commit, scopeRoot: c.scope_root, slice });
      facts = ownershipFacts(bundle, graphFor(c));
      review = await reviewOwnership({ bundle, facts, invokeJudge });
    } catch (e) { error = String(e?.message ?? e); }
    const elapsed_ms = now() - t0;
    const scored = scoreCase({ label: c.label, label_source: c.label_source, review: review ?? { state: "not-evaluated" } });
    const row = {
      id: c.id, commit: c.commit, scope_root: c.scope_root, n_moves: c.moves.length,
      label: c.label, label_source: c.label_source, label_note: c.label_note ?? null,
      state: review?.state ?? "not-evaluated",
      recommendation: scored.recommendation, outcome: scored.outcome,
      counts_toward_confusion: scored.counts_toward_confusion,
      confidence: review?.overall?.confidence ?? null,
      prompt_sha256: review?.prompt_sha256 ?? null,
      judge_calls: review?.judge_calls ?? 0,
      bundle_bytes: bundle?.bytes ?? null,
      bundle_truncations: bundle?.truncations?.length ?? null,
      elapsed_ms,
      error,
      moves: (review?.moves ?? []).map((m) => ({
        move_index: m.move_index, file: m.file, to: m.to, recommendation: m.recommendation,
        confidence: m.confidence, cause: m.cause, downgraded_from: m.downgraded_from,
        evidence_refs: m.evidence_refs, counter_evidence_refs: m.counter_evidence_refs,
        hypothesis: m.responsibility_hypothesis,
      })),
      mechanical_facts: (facts?.moves ?? []).map((m) => ({
        move_index: m.move_index, file: m.file, to: m.to,
        dest_boundary_violation: m.dest_boundary_violation,
        dest_boundary: { agreement: m.dest_boundary.agreement, boundary_source: m.dest_boundary.boundary_source, observed_out_size: m.dest_boundary.observed_out_size, graph_missing_edges: m.dest_boundary.graph_missing_edges, parse_missing_edges: m.dest_boundary.parse_missing_edges },
        transferred_dependencies: m.transferred_dependencies.map((t) => `${t.spec} -> ${t.resolved_dir ?? "?"}`),
        io_pull: m.io_pull.pulled.map((x) => x.spec),
        source_hollowing: m.source_hollowing.is_hollow,
        counter_evidence_ids: m.counter_evidence_ids,
      })),
    };
    rows.push(row);
    onCase(row);
  }
  return { eval_version: EVAL_VERSION, generated_at: new Date().toISOString(), rows, summary: summarize(rows) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
async function cli() {
  const { fileURLToPath } = await import("node:url");
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = process.argv.slice(2);
  const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const root = val("--root", REPO_ROOT);
  const casesFile = val("--cases", path.join(root, "plugin", "fixtures", "ownership-semantic-eval", "cases.json"));
  const graphFile = val("--graph", null);
  const outFile = val("--out", null);
  const repeat = args.includes("--repeat");            // re-run the human-labelled cases once, for consistency
  const role = val("--role", "meta-driver");

  const loaded = loadCases(casesFile);
  if (!loaded.ok) { process.stderr.write(`${loaded.reason}\n`); process.exit(2); }

  const graphs = new Map();
  const graphFor = (c) => {
    const f = c.graph_fixture ? path.join(root, c.graph_fixture) : graphFile;
    if (!f) return null;
    if (!graphs.has(f)) {
      try { graphs.set(f, JSON.parse(fs.readFileSync(f, "utf8"))?.extensions?.tsAnalysis?.moduleGraph ?? null); }
      catch { graphs.set(f, null); }
    }
    return graphs.get(f);
  };

  const { launchArgv, runAsync } = await import(path.join(root, "plugin", "scripts", "driver-runtime.ts"));
  // The SAME tool-less seam the investigation loop uses (`ownership-active-loop.mjs` CLI): no tools, no
  // slash commands, no session persistence, prompt on stdin. The judge is a pure completion.
  const invokeJudge = async (prompt) => {
    const argv = launchArgv(role, prompt, root, { promptViaStdin: true });
    argv.splice(argv.length - 1, 0, "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config");
    return runAsync(argv, { timeoutMs: 600_000, collectStderr: true, stdinData: prompt });
  };

  const result = await runEval({
    cases: loaded.cases, root, invokeJudge, graphFor,
    onCase: (r) => process.stderr.write(`  ${r.id}: ${r.state} -> ${r.recommendation} (${r.outcome}) judge=${r.judge_calls} bytes=${r.bundle_bytes} ${r.elapsed_ms}ms\n`),
  });
  result.case_file = loaded.case_file;
  result.case_file_sha256 = loaded.sha256;
  result.model_runtime = (() => { try { const argv = launchArgv(role, "", root, { promptViaStdin: true }); const i = argv.indexOf("--model"); return { role, model: i >= 0 ? argv[i + 1] : null }; } catch { return { role, model: null }; } })();

  if (repeat) {
    // CONSISTENCY READ on the human-labelled cases only: the same review, run twice. A judge that answers
    // differently on an identical bundle is a reading about the judge, not about the cut.
    const human = loaded.cases.filter((c) => c.label_source.startsWith("human-"));
    const second = await runEval({ cases: human, root, invokeJudge, graphFor });
    result.repeat = second.rows.map((r) => ({ id: r.id, first: result.rows.find((x) => x.id === r.id)?.recommendation ?? null, second: r.recommendation, confidence_second: r.confidence }));
  }

  const text = JSON.stringify(result, null, 1);
  if (outFile) fs.writeFileSync(outFile, text + "\n", "utf8");
  process.stdout.write(text + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
