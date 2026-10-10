#!/usr/bin/env node
// Evaluator for the two-stage GOAL-030..033 benchmark.
//
// Design constraints it honours (from the design audit):
//   • The historical slice is NOT the only correct answer. A candidate that matches no reference
//     or alternative is flagged `novel` for manual review — not silently scored wrong.
//   • investigate-vs-goal is scored ONLY on the T1 stage, where the investigation is complete.
//   • granularity is falsifiable: counterfactual too-broad / too-fragmented sets make the
//     dimension able to come out false (the v1 corpus scored 4/4 "sufficient" vacuously).
//   • No single aggregate score. Structured per-dimension output only.
//   • Matching is rule-assisted; `manual_review` is surfaced wherever a lexical matcher is the
//     weak link, rather than pretending the number is semantic.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_ROOT = path.resolve(HERE, "..", "..", "plugin", "fixtures", "meta-driver-replay");

const STOP = new Set(["the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","day","get","has","him","his","how","man","new","now","old","see","two","way","who","boy","did","its","let","put","say","she","too","use","this","that","with","from","they","have","will","would","about","which","when","there","their","been","were","what","into","than","then"]);

export function tokenize(t) {
  return new Set(String(t || "").toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").split(/\s+/).filter((x) => x.length > 2 && !STOP.has(x)));
}
export function overlap(a, b) {
  const ta = tokenize(a), tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let i = 0; for (const t of ta) if (tb.has(t)) i++;
  return i / Math.min(ta.size, tb.size);
}

export function loadCase(caseId, file, root = CORPUS_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, caseId, file), "utf8"));
}
export function listCases(root = CORPUS_ROOT) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("GOAL-")).map((e) => e.name).sort();
}

export function stageAInstructions(caseId, root = CORPUS_ROOT) { return loadCase(caseId, "stage_a.json", root); }
export function stageBInstructions(caseId, root = CORPUS_ROOT) { return loadCase(caseId, "stage_b.json", root); }
/** The RICH-BUNDLE (dossier) variant of the same stage; same task, evidence = raw dossier sections. */
export function richInstructions(caseId, stage, root = CORPUS_ROOT) { return loadCase(caseId, stage === "A" ? "rich_a.json" : "rich_b.json", root); }
const stageDoc = (caseId, stage, variant, root, opts = {}) =>
  variant === "tool"
    // Repository/tool replay: there is no fixed ref list and no pre-assembled corpus. What the model "saw" is
    // exactly what its tools returned (opts.corpusText, built from the trace), and grounding is judged from the
    // trace by the runner, not from a citable-ref allow-list.
    ? { cutoff_commit: opts.cutoffCommit || null, citable_evidence_refs: null, __corpus: opts.corpusText || "" }
    : variant === "rich" ? richInstructions(caseId, stage, root) : stage === "A" ? stageAInstructions(caseId, root) : stageBInstructions(caseId, root);

/** Everything the model could legitimately have read, as one string (for unsupported-claim detection). */
export function visibleCorpusText(doc) {
  if (doc.__corpus !== undefined) return doc.__corpus;
  if (doc.dossier) return doc.dossier.sections.map((s) => s.text).join("\n") + "\n" + (doc.confirmed_concern || "");
  return JSON.stringify({ context: doc.context, confirmed_concern: doc.confirmed_concern, investigation_findings: doc.investigation_findings });
}

import { execFileSync } from "node:child_process";
const REPO_ROOT = path.resolve(HERE, "..", "..");
const existsAtCommit = (commit, p) => { try { execFileSync("git", ["-C", REPO_ROOT, "cat-file", "-e", `${commit}:${p}`], { stdio: "ignore" }); return true; } catch { return false; } };

const PATH_RE = /\b((?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|mjs|js|json|md|sh|ya?ml)|[A-Za-z0-9_-]+\.(?:ts|mjs))\b/g;

/** Unsupported-claim detection (objective): file paths a response asserts that the dossier never showed.
 *  Split in two so a model is not punished for knowing a real file:
 *    not_in_dossier        — path text absent from everything the model was shown
 *    nonexistent_at_cutoff — of those, paths that do NOT exist in the cutoff commit (and are not a bare
 *                            basename that exists somewhere). A PROPOSED new file also lands here; that is
 *                            why this is reported as a count + examples for review, never folded into a score. */
export function unsupportedMentions(resp, doc) {
  const corpus = visibleCorpusText(doc);
  const commit = doc.cutoff_commit || null;
  const seen = new Set(); const notShown = []; const nonexistent = [];
  const text = JSON.stringify(resp || {});
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[1]; if (seen.has(p)) continue; seen.add(p);
    if (corpus.includes(p)) continue;
    notShown.push(p);
    if (commit) {
      const base = p.includes("/") ? [p] : [];
      const exists = base.some((b) => existsAtCommit(commit, b)) || (!p.includes("/") && (() => { try { return execFileSync("git", ["-C", REPO_ROOT, "ls-tree", "-r", "--name-only", commit], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").some((f) => f.endsWith(`/${p}`) || f === p); } catch { return true; } })());
      if (!exists) nonexistent.push(p);
    }
  }
  return { distinct_paths_mentioned: seen.size, not_in_dossier: notShown.length, nonexistent_at_cutoff: nonexistent.length, examples_not_shown: notShown.slice(0, 8), examples_nonexistent: nonexistent.slice(0, 8), note: "a proposed NEW file legitimately lands in nonexistent_at_cutoff; review examples, do not treat as a score" };
}
export function reference(caseId, root = CORPUS_ROOT) { return loadCase(caseId, "reference.json", root); }

const BEST = 0.34; // token-overlap bar for "this names the same thing" — deliberately loose

/** Best overlap of `text` against any string in `candidates`, plus which one won. */
function bestMatch(text, candidates) {
  let best = 0, which = null;
  for (const c of candidates || []) {
    const s = overlap(c, text);
    if (s > best) { best = s; which = c; }
  }
  return { score: best, which };
}

// ── Stage A: discovery ────────────────────────────────────────────────────────────────────────
export function scoreStageA(caseId, resp, root = CORPUS_ROOT, opts = {}) {
  const variant = opts.variant || "stage";
  const ref = reference(caseId, root);
  const sa = ref.stage_a_reference || {};
  const doc = stageDoc(caseId, "A", variant, root, opts);
  const citable = doc.citable_evidence_refs ? new Set(doc.citable_evidence_refs) : null;   // null = free-form (tool variant)
  const concerns = Array.isArray(resp?.concerns) ? resp.concerns : [];

  const per = concerns.map((c) => {
    const text = `${c?.concern || ""}`;
    const m = bestMatch(text, sa.expected_concerns);
    const refs = Array.isArray(c?.evidence_refs) ? c.evidence_refs : [];
    const unresolved = citable ? refs.filter((r) => !citable.has(r)) : [];
    return {
      concern: text.slice(0, 160),
      matches_expected: m.score >= BEST,
      matched_reference: m.score >= BEST ? m.which : null,
      overlap: Number(m.score.toFixed(3)),
      evidence_refs: refs.length,
      unsupported_evidence_refs: unresolved,
      grounded: refs.length > 0 && unresolved.length === 0,
      needs_investigation: c?.needs_investigation === true,
      confidence: c?.confidence || null,
    };
  });

  const anyValid = per.some((p) => p.matches_expected);
  const abstained = (resp?.overall_assessment === "no_concern_visible") || concerns.length === 0;
  const abstainAcceptable = sa.abstain_acceptable === true;

  return {
    case_id: caseId, stage: "A",
    concerns_returned: concerns.length,
    concern_validity: { any_matches_expected: anyValid, per_concern: per },
    grounding: {
      all_cited_refs_resolve: per.every((p) => p.unsupported_evidence_refs.length === 0),
      unsupported_claims: per.flatMap((p) => p.unsupported_evidence_refs),
    },
    ranking: { valid_concern_ranked_first: per.length > 0 && per[0].matches_expected },
    abstention: {
      abstained,
      acceptable_here: abstainAcceptable,
      verdict: abstained ? (abstainAcceptable ? "correct_abstention" : "missed_a_visible_concern") : "proposed_concerns",
    },
    evidence_breadth: { distinct_refs_cited: new Set((resp?.concerns || []).flatMap((c) => c?.evidence_refs || [])).size, of_available: citable ? citable.size : null },
    unsupported_mentions: unsupportedMentions(resp, doc),
    man: per.some((p) => !p.matches_expected && p.overlap > 0.15) ? "manual_review_suggested" : null,
  };
}

// ── Stage B: decomposition ────────────────────────────────────────────────────────────────────
export function scoreStageB(caseId, resp, root = CORPUS_ROOT, opts = {}) {
  const variant = opts.variant || "stage";
  // sliceBasis: "union" (all candidate slices — what the original two-stage run used; the default so old and
  // new runs stay comparable) or "first" (only the RECOMMENDED, i.e. first, slice: a coherent answer legitimately
  // lists broader alternatives it is NOT recommending, and the union penalises exactly those answers).
  const sliceBasis = opts.sliceBasis || "union";
  const ref = reference(caseId, root);
  const sb = ref.stage_b_reference || {};
  const doc = stageDoc(caseId, "B", variant, root, opts);
  const citable = doc.citable_evidence_refs ? new Set(doc.citable_evidence_refs) : null;

  const slices = Array.isArray(resp?.candidate_slices) ? resp.candidate_slices : [];
  const allSliceText = slices.map((s) => `${s?.title || ""} ${s?.description || ""}`).join(" | ");
  const first = slices.length ? `${slices[0]?.title || ""} ${slices[0]?.description || ""}` : "";

  const judge = (text) => {
    const refM = bestMatch(text, [sb.reference_slice].filter(Boolean));
    const altM = bestMatch(text, sb.alternative_valid_slices);
    const broadM = bestMatch(text, sb.clearly_too_broad);
    const fragM = bestMatch(text, sb.clearly_too_fragmented);
    let g;
    if (broadM.score >= BEST && broadM.score > refM.score && broadM.score > altM.score) g = "too-broad";
    else if (fragM.score >= BEST && fragM.score > refM.score && fragM.score > altM.score) g = "too-fragmented";
    else if (refM.score >= BEST || altM.score >= BEST) g = "sufficient";
    else g = "unclassified_novel";
    return { refM, altM, broadM, fragM, g };
  };
  const byBasis = { union: judge(allSliceText), first: judge(first) };
  const { refM, altM, broadM, fragM, g: granularity } = byBasis[sliceBasis];
  const matchesReference = refM.score >= BEST;
  const matchesAlternative = altM.score >= BEST;

  const nonGoals = Array.isArray(resp?.scope?.non_goals) ? resp.scope.non_goals : [];
  const inScope = Array.isArray(resp?.scope?.in_scope) ? resp.scope.in_scope : [];
  const inScopeText = inScope.join(" ; ");
  // scope violation = the candidate puts an explicitly-out-of-scope thing IN scope
  const refNonGoals = (ref.scope_discipline?.non_goals || []).join(" ; ");
  const scopeViolation = inScopeText.length > 0 && (
    bestMatch(inScopeText, [refNonGoals]).score >= BEST ||
    bestMatch(inScopeText, sb.clearly_too_broad).score >= BEST
  );

  const h = resp?.harnessability || {};
  const harnessFields = ["inputs", "outputs", "constraints", "acceptance", "failure_mode"];
  const harnessPresent = harnessFields.filter((k) => String(h[k] || "").trim().length >= 15);

  const delta = String(resp?.expected_mechanical_delta || "");
  const negCtl = String(resp?.negative_control || "");
  const abandon = String(resp?.abandon_or_reconsider_condition || "");

  return {
    case_id: caseId, stage: "B",
    slice: {
      matches_reference: matchesReference,
      matches_alternative: matchesAlternative,
      novel_not_in_reference: !matchesReference && !matchesAlternative,
      reference_overlap: Number(refM.score.toFixed(3)),
      alternative_overlap: Number(altM.score.toFixed(3)),
      note: "auxiliary: the historical slice is one defensible answer among several, not the sole target",
    },
    granularity: {
      verdict: granularity,
      basis: sliceBasis,
      by_basis: { union: byBasis.union.g, first: byBasis.first.g },
      too_broad_overlap: Number(broadM.score.toFixed(3)),
      too_fragmented_overlap: Number(fragM.score.toFixed(3)),
    },
    investigate_or_goal: {
      candidate: resp?.investigate_or_goal || null,
      reference: sb.investigate_or_goal,
      agreement: resp?.investigate_or_goal === sb.investigate_or_goal,
      scored_at: "T1-decision-ready",
    },
    scope_discipline: {
      non_goals_present: nonGoals.length > 0,
      in_scope_count: inScope.length,
      violation: scopeViolation,
    },
    harnessability: { fields_present: `${harnessPresent.length}/5`, complete: harnessPresent.length === 5, missing: harnessFields.filter((k) => !harnessPresent.includes(k)) },
    expected_delta_quality: /\d/.test(delta) ? "quantified" : delta.trim().length >= 20 ? "qualitative_only" : "absent",
    falsifiability: negCtl.trim().length >= 40 ? "substantive" : negCtl.trim().length >= 15 ? "thin" : "absent",
    abandon_condition: abandon.trim().length >= 20 ? "specific" : "absent",
    evidence_citations_resolve: citable ? (Array.isArray(resp?.evidence_refs) ? resp.evidence_refs : []).every((r) => citable.has(r)) : null,
    evidence_breadth: { distinct_refs_cited: new Set(Array.isArray(resp?.evidence_refs) ? resp.evidence_refs : []).size, of_available: citable ? citable.size : null, refs_requested: variant !== "stage" },
    unsupported_mentions: unsupportedMentions(resp, doc),
    manual_review: granularity === "unclassified_novel" ? "candidate slice is novel — review whether it is a legitimate third decomposition" : null,
  };
}
