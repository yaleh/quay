#!/usr/bin/env node
// Per-mode, per-group tables for the compact baseline, the rich-bundle run and the tool-replay run.
// Every compact/rich response is RESCORED here with the final evaluator (the in-run scores may predate an
// evaluator edit); tool-replay scores need the trace corpus, so those stored scores are used as-is.
// No single total is produced — each dimension is reported on its own.
//
// Usage: node docs/analysis/summarize-rich-and-tool.mjs [--json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreStageA, scoreStageB } from "./ownership-two-stage-evaluator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => (fs.existsSync(path.join(HERE, f)) ? JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8")) : null);
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const frac = (xs, pred) => `${xs.filter(pred).length}/${xs.length}`;

function rescored(run, mode) {
  if (!run.response) return null;
  if (mode === "tool") return { u: run.scores, f: run.scores_first_basis || run.scores };
  const variant = mode === "rich" ? "rich" : "stage";
  if (run.stage === "A") { const s = scoreStageA(run.case_id, run.response, undefined, { variant }); return { u: s, f: s }; }
  return { u: scoreStageB(run.case_id, run.response, undefined, { variant, sliceBasis: "union" }), f: scoreStageB(run.case_id, run.response, undefined, { variant, sliceBasis: "first" }) };
}

export function summarize(doc, mode) {
  const out = {};
  if (!doc) return out;
  for (const g of ["A", "B"]) {
    const runs = doc.runs.filter((r) => r.group === g);
    const rows = runs.map((r) => ({ r, s: rescored(r, mode) }));
    const A = rows.filter((x) => x.r.stage === "A");
    const B = rows.filter((x) => x.r.stage === "B");
    const evalA = A.filter((x) => x.s), evalB = B.filter((x) => x.s);
    out[g] = {
      runs: runs.length, not_evaluated: runs.filter((r) => !r.response).length,
      mean_latency_ms: mean(runs.map((r) => r.provenance.duration_ms)),
      mean_prompt_kb: mode === "tool" ? null : mean(runs.map((r) => r.provenance.prompt_bytes || r.provenance.prompt_chars)) / 1024,
      stageA: {
        n: evalA.length,
        valid_concern: frac(evalA, (x) => x.s.u.concern_validity.any_matches_expected),
        valid_ranked_first: frac(evalA, (x) => x.s.u.ranking.valid_concern_ranked_first),
        refs_all_resolve_or_grounded: mode === "tool" ? frac(A.filter((x) => x.r.trace_grounding), (x) => x.r.trace_grounding.grounded === x.r.trace_grounding.cited && x.r.trace_grounding.cited > 0) : frac(evalA, (x) => x.s.u.grounding.all_cited_refs_resolve),
        mean_distinct_refs: mean(evalA.map((x) => x.s.u.evidence_breadth.distinct_refs_cited)),
        unsupported_paths_not_shown: evalA.reduce((n, x) => n + x.s.u.unsupported_mentions.not_in_dossier, 0),
        unsupported_paths_nonexistent: evalA.reduce((n, x) => n + x.s.u.unsupported_mentions.nonexistent_at_cutoff, 0),
        per_case: Object.fromEntries(evalA.map((x) => [x.r.case_id, { valid: x.s.u.concern_validity.any_matches_expected, rank1: x.s.u.ranking.valid_concern_ranked_first, concerns: x.s.u.concerns_returned }])),
      },
      stageB: {
        n: evalB.length,
        investigate_vs_goal: frac(evalB, (x) => x.s.u.investigate_or_goal.agreement),
        granularity_union: evalB.map((x) => x.s.u.granularity.verdict),
        granularity_first: evalB.map((x) => x.s.f.granularity.verdict),
        sufficient_union: frac(evalB, (x) => x.s.u.granularity.verdict === "sufficient"),
        sufficient_first: frac(evalB, (x) => x.s.f.granularity.verdict === "sufficient"),
        slice_matches_reference_first: frac(evalB, (x) => x.s.f.slice.matches_reference),
        slice_matches_alternative_first: frac(evalB, (x) => x.s.f.slice.matches_alternative),
        scope_violation: frac(evalB, (x) => x.s.u.scope_discipline.violation),
        non_goals_present: frac(evalB, (x) => x.s.u.scope_discipline.non_goals_present),
        harness_5of5: frac(evalB, (x) => x.s.u.harnessability.complete),
        delta_quantified: frac(evalB, (x) => x.s.u.expected_delta_quality === "quantified"),
        falsifiability_substantive: frac(evalB, (x) => x.s.u.falsifiability === "substantive"),
        abandon_specific: frac(evalB, (x) => x.s.u.abandon_condition === "specific"),
        citations_resolve: mode === "tool" ? null : frac(evalB, (x) => x.s.u.evidence_citations_resolve === true),
        mean_distinct_refs: mean(evalB.map((x) => x.s.u.evidence_breadth.distinct_refs_cited)),
        unsupported_paths_not_shown: evalB.reduce((n, x) => n + x.s.u.unsupported_mentions.not_in_dossier, 0),
        unsupported_paths_nonexistent: evalB.reduce((n, x) => n + x.s.u.unsupported_mentions.nonexistent_at_cutoff, 0),
        per_case: Object.fromEntries(evalB.map((x) => [x.r.case_id, { ivg: x.s.u.investigate_or_goal.candidate, gran_union: x.s.u.granularity.verdict, gran_first: x.s.f.granularity.verdict, alt: x.s.f.slice.matches_alternative, ref: x.s.f.slice.matches_reference }])),
      },
    };
    if (mode === "tool") {
      const tr = runs.map((r) => r.trace_summary).filter(Boolean);
      out[g].trace = {
        mean_tool_calls: mean(tr.map((t) => t.tool_calls)), mean_distinct_files_read: mean(tr.map((t) => t.distinct_files_read)),
        mean_archq_calls: mean(tr.map((t) => t.archq_commands.length)), mean_grep_calls: mean(tr.map((t) => t.grep_patterns.length)),
        cap_hits: runs.filter((r) => r.cap_hit).length, timeouts: runs.filter((r) => r.timed_out).length,
        denied_attempts_total: tr.reduce((n, t) => n + t.denied_attempts.length, 0),
        grounded_refs: runs.filter((r) => r.trace_grounding).reduce((n, r) => n + r.trace_grounding.grounded, 0),
        cited_refs: runs.filter((r) => r.trace_grounding).reduce((n, r) => n + r.trace_grounding.cited, 0),
      };
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = { baseline_compact: summarize(read("ownership-two-stage-ab-results.json"), "stage"), rich_bundle: summarize(read("ownership-rich-ab-results.json"), "rich"), tool_replay: summarize(read("ownership-tool-replay-results.json"), "tool") };
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
}
