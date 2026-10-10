#!/usr/bin/env node
// A/B runtime+model harness for the RICH EVIDENCE BUNDLE (dossier) benchmark.
//
//   A = claude-fjdac + v4.1flash-anthropic   (gateway → DeepSeek V4.1 Flash)
//   B = claude       + opus                   (native login; gateway env dropped so `opus` is really Opus)
//
// Same case, same cutoff, same prompt BYTES for both groups — asserted per cell via a prompt hash.
// Only rich_a.json / rich_b.json are read; reference.json / outcome.json are evaluator-side only.
// Reuses the runtime/model separation (fixture profiles under a temp root; the repo's
// .quay/profiles.yml is never touched) and the launch path of the compact two-stage harness.
//
// Usage: node docs/analysis/ownership-rich-ab.mjs [--reps N] [--stage A|B] [--case GOAL-032]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const sha16 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
import { GROUPS, makeFixtureRoots } from "./ownership-shadow-ab-runtime-model.mjs";
import { invokeGroup } from "./ownership-two-stage-ab.mjs";
import { listCases, richInstructions, scoreStageA, scoreStageB } from "./ownership-two-stage-evaluator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.join(HERE, "ownership-rich-ab-results.json");

/** One-line, human-readable provenance for a dossier section (what the model sees under each header). */
export function provenanceLine(p) {
  switch (p.kind) {
    case "git_file": return `source: git ${p.commit.slice(0, 12)}  ${p.path}${p.ranges ? `  lines ${p.ranges.map(([a, b]) => `${a}-${b}`).join(", ")}` : ""}${p.truncated ? "  (truncated)" : ""}`;
    case "git_grep": return `source: ${p.command}  →  ${p.hit_lines} lines${p.truncated ? " (truncated)" : ""}`;
    case "git_ls": return `source: ${p.command}`;
    case "archguard_derived": return `source: ${p.tool}; analysed tree ${p.analysis_commit.slice(0, 12)}; scanned code identical to the cutoff commit: ${p.scanned_code_identical_to_stage_commit ? "yes" : "no (" + p.differing_files_in_scanned_dirs.length + " unrelated files differ)"}; ${p.query}`;
    case "recorded_tool_output": return `source: recorded output of ${p.tool}; analysed tree ${p.analysis_commit.slice(0, 12)}${p.truncated ? " (truncated)" : ""}`;
    case "authored_findings": return `source: the decision-maker's own investigation notes as of T1 (not a code excerpt)`;
    default: return `source: ${p.kind}`;
  }
}

export function buildRichPrompt(doc) {
  const out = [
    `# ${doc.case_id} — stage ${doc.stage} (${doc.stage_name}) — RICH EVIDENCE DOSSIER`,
    `cutoff: ${doc.cutoff}  (${doc.cutoff_label});  repository commit at cutoff: ${doc.cutoff_commit.slice(0, 12)}`,
    "",
    doc.task.instructions,
    "",
  ];
  if (doc.confirmed_concern) out.push("## CONFIRMED CONCERN", doc.confirmed_concern, "");
  out.push("## EVIDENCE DOSSIER", "");
  for (const s of doc.dossier.sections) {
    out.push(`### [${s.id}] ${s.title}`, provenanceLine(s.provenance), "```", s.text, "```", "");
  }
  out.push(
    "## CITE ONLY THESE evidence_refs (dossier section ids)",
    doc.citable_evidence_refs.map((r) => `- ${r}`).join("\n"),
    "",
    "## Questions",
    ...doc.task.questions.map((q) => `- ${q}`),
    "",
    "## Required response JSON schema",
    JSON.stringify(doc.task.response_schema, null, 2),
  );
  return out.join("\n");
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const reps = Number(arg("--reps", 1));
  const onlyStage = arg("--stage", null);
  const onlyCase = arg("--case", null);
  const stages = onlyStage ? [onlyStage] : ["A", "B"];
  const cases = listCases().filter((c) => !onlyCase || c === onlyCase);

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rich-ab-"));
  const roots = makeFixtureRoots(baseDir);
  // --resume: three earlier runs of this family were lost to session teardown. Keep every banked cell whose
  // prompt hash still matches the CURRENT dossier (a regenerated dossier invalidates it) and run only the rest.
  const runs = [];
  if (process.argv.includes("--resume") && fs.existsSync(OUT_JSON + ".partial")) {
    runs.push(...JSON.parse(fs.readFileSync(OUT_JSON + ".partial", "utf8")).runs.filter((r) => r.state === "verified"));
    process.stderr.write(`  resumed ${runs.length} banked cells\n`);
  }
  const banked = (caseId, stage, g, rep, prompt) => runs.some((r) => r.case_id === caseId && r.stage === stage && r.group === g.id && r.rep === rep && r.provenance.prompt_sha256_16 === sha16(prompt));
  const flush = () => { try { fs.writeFileSync(OUT_JSON + ".partial", JSON.stringify({ partial: true, runs }, null, 2)); } catch { /* ignore */ } };

  for (const caseId of cases) for (const stage of stages) {
    const doc = richInstructions(caseId, stage);
    const prompt = buildRichPrompt(doc);                 // built ONCE per (case,stage), reused by both groups
    for (let rep = 1; rep <= reps; rep++) for (const g of Object.values(GROUPS)) {
      if (banked(caseId, stage, g, rep, prompt)) continue;
      process.stderr.write(`  ${caseId} stage${stage} ${g.id} rep${rep} (${(Buffer.byteLength(prompt) / 1024).toFixed(0)} KB) ... `);
      const { rec } = await invokeGroup({ caseId, stage, group: g, roots, prompt });
      rec.rep = rep; rec.mode = "rich-bundle";
      if (rec.response) {
        rec.scores = stage === "A" ? scoreStageA(caseId, rec.response, undefined, { variant: "rich" }) : scoreStageB(caseId, rec.response, undefined, { variant: "rich", sliceBasis: "union" });
        if (stage === "B") rec.scores_first_basis = scoreStageB(caseId, rec.response, undefined, { variant: "rich", sliceBasis: "first" });
      }
      runs.push(rec); flush();
      process.stderr.write(`${rec.state} ${rec.provenance.duration_ms}ms\n`);
    }
  }

  const cells = {};
  for (const caseId of cases) for (const stage of stages) {
    const hs = [...new Set(runs.filter((r) => r.case_id === caseId && r.stage === stage).map((r) => r.provenance.prompt_sha256_16))];
    cells[`${caseId}:${stage}`] = { prompt_shas: hs, identical_across_groups: hs.length === 1 };
  }
  const out = {
    experiment: "ownership benchmark — RICH EVIDENCE BUNDLE (dossier) — runtime+model A/B",
    mode: "rich-bundle",
    groups: { A: { launcher: GROUPS.A.launcher, model: GROUPS.A.model }, B: { launcher: GROUPS.B.launcher, model: GROUPS.B.model } },
    controls: {
      corpus: "plugin/fixtures/meta-driver-replay/GOAL-03x/rich_{a,b}.json",
      profiles_carrier: "fixture .quay/profiles.yml under a temp root; repo carrier untouched",
      leakage: "model sees rich_{a,b}.json only; reference.json / outcome.json are evaluator-side; integrity: plugin/test/ownership-rich-dossier.test.mjs",
      scoring: "no single total; per-dimension. Stage B recorded under two slice bases (union = comparable with the compact run, first = recommended slice only)",
    },
    harness_self_test: { prompts_identical_across_groups_per_cell: Object.values(cells).every((v) => v.identical_across_groups), cells },
    reps, stages, runs,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");
  process.stderr.write(`\nwrote ${OUT_JSON}\nself-test (identical prompts per cell): ${out.harness_self_test.prompts_identical_across_groups_per_cell}\n`);
  fs.rmSync(baseDir, { recursive: true, force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
