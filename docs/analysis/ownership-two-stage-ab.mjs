#!/usr/bin/env node
// A/B runtime+model harness for the TWO-STAGE benchmark.
//
// Reuses the runtime separation established by ownership-shadow-ab-runtime-model.mjs (fixture
// .quay/profiles.yml under a temp root; group B wrapped so the gateway env cannot silently
// rewrite `--model opus` to DeepSeek). The repo's real .quay/profiles.yml is NOT touched.
//
// ⛔ Same prompt bytes per (case, stage) for both groups — asserted via a per-cell prompt hash.
// ⛔ Stage A sees stage_a.json only; Stage B sees stage_b.json only. Neither sees reference.json.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchArgv, runAsync } from "../../plugin/scripts/driver-runtime.ts";
import { GROUPS, makeFixtureRoots } from "./ownership-shadow-ab-runtime-model.mjs";
import { listCases, stageAInstructions, stageBInstructions, scoreStageA, scoreStageB, CORPUS_ROOT } from "./ownership-two-stage-evaluator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.join(HERE, "ownership-two-stage-ab-results.json");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

function buildPrompt(doc) {
  return [
    `# ${doc.case_id} — stage ${doc.stage} (${doc.stage_name})`,
    `cutoff: ${doc.cutoff}  (${doc.cutoff_label})`,
    "",
    doc.task.instructions,
    "",
    "## EVIDENCE",
    JSON.stringify(
      doc.stage === "A"
        ? { context: doc.context }
        : { confirmed_concern: doc.confirmed_concern, investigation_findings: doc.investigation_findings, context: doc.context },
      null, 2
    ),
    "",
    "## CITE ONLY THESE evidence_refs",
    (doc.citable_evidence_refs || []).map((r) => `- ${r}`).join("\n"),
    "",
    "## Questions",
    ...doc.task.questions.map((q) => `- ${q}`),
    "",
    "## Required response JSON schema",
    JSON.stringify(doc.task.response_schema, null, 2),
  ].join("\n");
}

/** Fail-closed: unreadable output yields null, never a half-formed response. */
function parseJson(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  const cands = [];
  const f = stdout.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (f) for (const b of f) cands.push(b.replace(/```(?:json)?/g, ""));
  cands.push(stdout);
  for (const c of cands) {
    const s = c.indexOf("{"), e = c.lastIndexOf("}");
    if (s < 0 || e <= s) continue;
    try { const o = JSON.parse(c.slice(s, e + 1)); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* next */ }
  }
  return null;
}

async function runOne({ caseId, stage, group, roots, prompt }) {
  const t0 = Date.now();
  const argv = launchArgv(group.role, prompt, roots[group.id], { promptViaStdin: true });
  const r = await runAsync(argv, { timeoutMs: 600_000, collectStderr: true, stdinData: prompt });
  const ms = Date.now() - t0;
  const mi = argv.indexOf("--model");
  const parsed = r.error || (typeof r.status === "number" && r.status !== 0) ? null : parseJson(r.stdout);
  const rec = {
    case_id: caseId, stage, group: group.id,
    provenance: {
      role: group.role, profile: group.profile, launcher: argv[0],
      model_from_profile: group.model, model_flag_in_argv: mi >= 0 ? argv[mi + 1] : null,
      gateway_env_dropped: group.dropsGatewayEnv,
      prompt_sha256_16: sha(prompt), prompt_chars: prompt.length,
      started_at: new Date(t0).toISOString(), duration_ms: ms,
    },
    state: parsed ? "verified" : "not-evaluated",
    error: r.error ? String(r.error.message) : null,
    exit_status: r.status,
    response: parsed,
  };
  if (parsed) rec.scores = stage === "A" ? scoreStageA(caseId, parsed) : scoreStageB(caseId, parsed);
  return rec;
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
  const reps = arg("--reps", 1);
  const stages = process.argv.includes("--stage")
    ? [process.argv[process.argv.indexOf("--stage") + 1]]
    : ["A", "B"];

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "two-stage-ab-"));
  const roots = makeFixtureRoots(baseDir);
  const runs = [];

  for (const caseId of listCases()) {
    for (const stage of stages) {
      const doc = stage === "A" ? stageAInstructions(caseId) : stageBInstructions(caseId);
      const prompt = buildPrompt(doc);          // built ONCE per (case,stage), reused by both groups
      for (let rep = 1; rep <= reps; rep++) {
        for (const g of Object.values(GROUPS)) {
          process.stderr.write(`  ${caseId} stage${stage} ${g.id} rep${rep} ... `);
          const rec = await runOne({ caseId, stage, group: g, roots, prompt });
          rec.rep = rep;
          runs.push(rec);
          process.stderr.write(`${rec.state} ${rec.provenance.duration_ms}ms\n`);
          // Incremental flush: three earlier A/B runs were lost to session teardown because
          // output was written only at the end. Cheap insurance, and it makes a partial run usable.
          try { fs.writeFileSync(OUT_JSON + ".partial", JSON.stringify({ partial: true, runs }, null, 2)); } catch { /* ignore */ }
        }
      }
    }
  }

  const cells = {};
  for (const caseId of listCases()) for (const stage of stages) {
    const hs = [...new Set(runs.filter((r) => r.case_id === caseId && r.stage === stage).map((r) => r.provenance.prompt_sha256_16))];
    cells[`${caseId}:${stage}`] = { prompt_shas: hs, identical_across_groups: hs.length === 1 };
  }

  const out = {
    experiment: "two-stage GOAL-030..033 benchmark — runtime+model A/B",
    groups: { A: { launcher: GROUPS.A.launcher, model: GROUPS.A.model }, B: { launcher: GROUPS.B.launcher, model: GROUPS.B.model } },
    controls: {
      corpus: path.relative(path.resolve(HERE, "..", ".."), CORPUS_ROOT),
      profiles_carrier: "fixture .quay/profiles.yml under a temp root; repo carrier untouched",
      leakage: "stage A reads stage_a.json only; stage B reads stage_b.json only; reference.json is evaluator-side",
    },
    harness_self_test: { prompts_identical_across_groups_per_cell: Object.values(cells).every((v) => v.identical_across_groups), cells },
    reps, stages, runs,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");
  process.stderr.write(`\nwrote ${OUT_JSON}\nself-test: ${out.harness_self_test.prompts_identical_across_groups_per_cell}\n`);
  fs.rmSync(baseDir, { recursive: true, force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
