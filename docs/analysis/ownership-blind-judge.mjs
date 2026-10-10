#!/usr/bin/env node
// BLINDED SEMANTIC JUDGE — the second instrument for the ownership benchmark.
//
// WHY: the lexical matcher in ownership-two-stage-evaluator.mjs normalises token overlap by the SHORTER string,
// so a short counterfactual phrase ("Move only one of the two edges") is 100% "contained" in any long response.
// Observed: both models proposed the historically correct fix and were scored too-fragmented / too-broad,
// and Flash and Opus got IDENTICAL verdict vectors. Longer, richer answers saturate the matcher. A semantic
// judgement is exactly the part that should NOT be lexical (ADR-033: values requiring semantics come from a
// schema-constrained agent; aggregation stays plain JS).
//
// DESIGN
//   • judge = a THIRD model (Sonnet via the native login) — neither contestant, so no self-preference;
//   • BLIND: the judge never sees a group id, model name, mode, or run order (items are seeded-shuffled);
//   • CONTROLS: the judge also classifies candidates built from the GOLD (reference slice, an alternative,
//     the too-broad and too-fragmented counterfactuals). A judge that cannot call those correctly is not
//     measuring anything — control accuracy is reported next to every result;
//   • advisory: reported ALONGSIDE the lexical dimensions, never merged into a single score.
//
// Usage: node docs/analysis/ownership-blind-judge.mjs [--modes baseline,rich,tool] [--parallel 3]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { GROUPS, makeRootFor } from "./ownership-shadow-ab-runtime-model.mjs";
import { invokeGroup } from "./ownership-two-stage-ab.mjs";
import { reference, stageBInstructions } from "./ownership-two-stage-evaluator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "ownership-blind-judge-results.json");
const SRC = { baseline: "ownership-two-stage-ab-results.json", rich: "ownership-rich-ab-results.json", tool: "ownership-tool-replay-results.json" };
export const JUDGE = { ...GROUPS.B, id: "J", role: "ab-judge", model: "sonnet" };       // native login, gateway env dropped
const sha16 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// seeded shuffle (mulberry32) — blinding order is reproducible
function shuffle(arr, seed) {
  let a = seed >>> 0; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const o = arr.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o;
}
const clip = (s, n) => String(s ?? "").slice(0, n);

export const B_CLASSES = ["equivalent-to-reference", "alternative-valid", "too-broad", "too-fragmented", "defensible-but-different", "unsound"];
const A_CLASSES = ["matches-expected", "adjacent-defensible", "unrelated"];

export function judgePromptB(caseId, cand) {
  const sb = reference(caseId).stage_b_reference;
  return [
    "You are a strict, impartial reviewer of a proposed software-architecture work slice. Judge ONLY the CANDIDATE below against the GOLD. Wording differences do not matter; judge the concrete edits and their extent.",
    "",
    "## CONCERN BEING ADDRESSED", stageBInstructions(caseId).confirmed_concern,
    "",
    "## GOLD (a decision-maker's minimum-sufficient slice, and why)",
    `REFERENCE SLICE: ${clip(sb.reference_slice, 1800)}`,
    `WHY MINIMUM-SUFFICIENT: ${clip(sb.minimum_sufficiency_rationale, 1200)}`,
    "ALTERNATIVE VALID SLICES (also acceptable):", ...sb.alternative_valid_slices.map((s) => `- ${clip(s, 500)}`),
    "CLEARLY TOO BROAD (bundles more than needed):", ...sb.clearly_too_broad.map((s) => `- ${clip(s, 300)}`),
    "CLEARLY TOO FRAGMENTED (does less than the minimum, or splits into pieces that cannot be accepted independently):", ...sb.clearly_too_fragmented.map((s) => `- ${clip(s, 300)}`),
    "",
    "## CANDIDATE (the slice it recommends doing FIRST, plus its declared scope)",
    `RECOMMENDED SLICE: ${clip(cand.slice, 2200)}`,
    `IN SCOPE: ${clip(JSON.stringify(cand.in_scope || []), 1500)}`,
    `NON-GOALS: ${clip(JSON.stringify(cand.non_goals || []), 900)}`,
    "",
    "## TASK",
    `Classify the CANDIDATE's recommended slice as exactly one of: ${B_CLASSES.join(" | ")}.`,
    "- equivalent-to-reference: the same concrete edits (what moves / changes, and where) as the reference, in other words.",
    "- alternative-valid: concretely different but equally coherent and minimum-sufficient (e.g. one of the listed alternatives).",
    "- too-broad: bundles substantial independent work beyond the minimum-sufficient slice.",
    "- too-fragmented: does less than the minimum-sufficient slice, so the stated concern would NOT be resolved, or it splits into pieces that cannot be accepted independently.",
    "- defensible-but-different: not listed, but plausible and sufficient.",
    "- unsound: rests on a wrong premise or would not achieve the concern.",
    "Also: scope_ok = true iff IN SCOPE stays within a minimum-sufficient set and NON-GOALS exclude the broader moves in 'too broad'.",
    "Reply with ONE JSON object only: {\"slice_class\": <one of the six>, \"scope_ok\": true|false, \"concrete_edits_overlap_with_reference\": \"all\"|\"most\"|\"some\"|\"none\", \"reasoning\": \"<=60 words\"}",
  ].join("\n");
}

export function judgePromptA(caseId, cand) {
  const sa = reference(caseId).stage_a_reference;
  return [
    "You are a strict, impartial reviewer of an architecture-concern DISCOVERY. Judge ONLY the CANDIDATE against the EXPECTED concerns. Wording differences do not matter; judge whether the same underlying issue is identified.",
    "",
    "## EXPECTED CONCERNS (what a careful reader of that state should notice)", ...sa.expected_concerns.map((s) => `- ${clip(s, 500)}`),
    `ABSTAINING WOULD BE ACCEPTABLE HERE: ${sa.abstain_acceptable === true ? "yes" : "no"}`,
    "",
    "## CANDIDATE CONCERNS (in the order the candidate ranked them)", ...cand.concerns.map((c, i) => `${i + 1}. ${clip(c, 700)}`),
    "",
    "## TASK",
    `Classify the candidate's FIRST-ranked concern as exactly one of: ${A_CLASSES.join(" | ")}.`,
    "- matches-expected: identifies the same underlying issue as an expected concern.",
    "- adjacent-defensible: a different but genuinely real and relevant ownership/architecture concern in that state.",
    "- unrelated: not supported or not about ownership/architecture structure.",
    "Also: any_matches_expected = true iff ANY candidate concern matches an expected one.",
    "Reply with ONE JSON object only: {\"top_concern_class\": <one of the three>, \"any_matches_expected\": true|false, \"reasoning\": \"<=50 words\"}",
  ].join("\n");
}

function candidateFromResponse(caseId, stage, resp) {
  const concern = null;
  if (stage === "A") return { concerns: (resp.concerns || []).map((c) => c?.concern) };
  const s0 = (resp.candidate_slices || [])[0] || {};
  return { concern, slice: `${s0.title || ""} :: ${s0.description || ""} (recommended_first: ${resp.recommended_first || ""})`, in_scope: resp.scope?.in_scope, non_goals: resp.scope?.non_goals };
}

/** Candidates built from the GOLD itself, with the class a competent judge MUST return. */
export function controlItems() {
  const out = [];
  for (const caseId of ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"]) {
    const sb = reference(caseId).stage_b_reference;
    const mk = (kind, slice, expect) => ({ key: `control:${caseId}:${kind}`, control: true, kind, case_id: caseId, stage: "B", expect, cand: { slice, in_scope: [slice], non_goals: [] } });
    out.push(mk("reference", sb.reference_slice, ["equivalent-to-reference"]));
    out.push(mk("alternative", sb.alternative_valid_slices[0], ["alternative-valid", "equivalent-to-reference"]));
    out.push(mk("too-broad", sb.clearly_too_broad[0], ["too-broad"]));
    out.push(mk("too-fragmented", sb.clearly_too_fragmented[0], ["too-fragmented"]));
  }
  return out;
}

function collectItems(modes) {
  const items = [];
  for (const mode of modes) {
    const f = path.join(HERE, SRC[mode]);
    if (!fs.existsSync(f)) continue;
    for (const r of JSON.parse(fs.readFileSync(f, "utf8")).runs) {
      if (!r.response) continue;
      items.push({ key: `${mode}:${r.case_id}:${r.stage}:${r.group}:${r.rep || 1}`, mode, case_id: r.case_id, stage: r.stage, group: r.group, cand: candidateFromResponse(r.case_id, r.stage, r.response) });
    }
  }
  return items;
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const modes = arg("--modes", "baseline,rich,tool").split(",");
  const parallel = Number(arg("--parallel", 3));
  const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { judge: { launcher: JUDGE.launcher, model: JUDGE.model, blind: true }, results: {} };
  const items = shuffle([...controlItems(), ...collectItems(modes)], 20261009);
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "judge-"));
  const roots = { J: makeRootFor(baseDir, JUDGE) };
  const queue = items.filter((it) => prior.results[it.key]?.state !== "verified");   // failed/unparsed items are re-queued, never banked
  process.stderr.write(`  ${items.length} items (${items.filter((i) => i.control).length} controls), ${queue.length} to judge, parallel=${parallel}\n`);
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      const prompt = it.stage === "A" ? judgePromptA(it.case_id, it.cand) : judgePromptB(it.case_id, it.cand);
      // only the prompt reaches the judge: no key, mode, group, model or order
      const { rec } = await invokeGroup({ caseId: it.case_id, stage: it.stage, group: JUDGE, roots, prompt, timeoutMs: 300_000 });
      prior.results[it.key] = { key: it.key, control: !!it.control, kind: it.kind || null, expect: it.expect || null, mode: it.mode || null, case_id: it.case_id, stage: it.stage, group: it.group || null, prompt_sha: sha16(prompt), judge: rec.response, state: rec.state, duration_ms: rec.provenance.duration_ms };
      fs.writeFileSync(OUT, JSON.stringify(prior, null, 2) + "\n", "utf8");
      process.stderr.write(`  [${++done}/${done + queue.length}] ${it.key} ${rec.state}\n`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  fs.rmSync(baseDir, { recursive: true, force: true });
  process.stderr.write(`wrote ${OUT}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
