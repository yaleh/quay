#!/usr/bin/env node
// A/B runtime+model comparison for the semantic ownership/architecture proposer.
//
// A (current)   : launcher claude-fjdac  -> LiteLLM gateway 127.0.0.1:26510 -> DeepSeek V4.1 Flash
// B (experiment): launcher claude       -> claude.ai login (native)         -> Opus
//
// ⛔ Does NOT touch the repo's .quay/profiles.yml. Each group resolves through a FIXTURE
//    .quay/profiles.yml under a temp root, so the real carrier is untouched.
// ⛔ Same code, same prompt bytes, same evidence per case — the ONLY differences are the launcher
//    (which encapsulates runtime+backend routing) and the model. Asserted, not assumed.
// ⛔ Input-only: reads each case's input.json; reference.json / outcome.json are never opened.
// ⛔ No credentials are read, written or recorded.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchArgv, runAsync } from "../../plugin/scripts/driver-runtime.ts";
import { buildSemanticPrompt, parseSemanticEnvelope, semanticEvidenceRefs } from "./ownership-shadow-semantic.mjs";
import { listCaseIds, loadCaseInput, scoreResponse } from "../../plugin/test/helpers/meta-driver-replay-harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OUT_JSON = path.join(HERE, "ownership-shadow-ab-runtime-model.json");

// The gateway-routing env. Group B must drop these or `--model opus` would be silently rewritten
// to DeepSeek by ANTHROPIC_DEFAULT_OPUS_MODEL and never leave the gateway — a real trap this
// harness caught while probing (a first `claude --model opus` probe returned happily while still
// routed to the gateway).
const GATEWAY_ENV = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];

export const GROUPS = {
  A: { id: "A", role: "ab-a", profile: "gw", launcher: "claude-fjdac", model: "v4.1flash-anthropic", dropsGatewayEnv: false },
  B: { id: "B", role: "ab-b", profile: "native", launcher: "claude", model: "opus", dropsGatewayEnv: true },
};

/** Build the fixture profile roots. Returns {A: rootDir, B: rootDir, wrapperPath}. */
export function makeFixtureRoots(baseDir) {
  const roots = {};
  for (const g of Object.values(GROUPS)) {
    const root = path.join(baseDir, g.id);
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    let launcher = g.launcher;
    if (g.dropsGatewayEnv) {
      // A wrapper is the only way to drop env for one group without touching runAsync (which has
      // no env option) — argv[0] is spawned directly, so `env -u ...` cannot be spliced in.
      launcher = path.join(root, "launcher.sh");
      fs.writeFileSync(
        launcher,
        `#!/bin/bash\nunset ${GATEWAY_ENV.join(" ")}\nexec claude "$@"\n`,
        { mode: 0o755 }
      );
    }
    fs.writeFileSync(
      path.join(root, ".quay", "profiles.yml"),
      [
        "version: 1",
        "profiles:",
        `  ${g.profile}:`,
        `    launcher: ${launcher}`,
        `    model: ${g.model}`,
        "    bare: false",
        `    auth: ${g.dropsGatewayEnv ? "key" : "token"}`,
        "roles:",
        `  ${g.role}:`,
        `    profile: ${g.profile}`,
        `    name: quay-ab-${g.id.toLowerCase()}`,
        "",
      ].join("\n"),
      "utf8"
    );
    roots[g.id] = root;
  }
  return roots;
}

/** Evidence for one corpus case, built from input.json ONLY (context lives under .context). */
export function caseEvidence(input, methodologyExcerpt) {
  const ctx = input.context || {};
  return {
    sources: { archguard: "archguard:case_readings", methodology: "docs/references/ownership-first-refactoring-methodology.md" },
    archguard: ctx.archguard_readings_before || {},
    goals: { status_tally: {} },
    tasks: { status_tally: {} },
    methodology_excerpt: methodologyExcerpt,
    // carried for the record; buildSemanticPrompt renders only the four fields above
    _case_id: input.case_id,
    _code_pointers: ctx.code_pointers || [],
  };
}

function sha(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Map a semantic envelope onto the shape the corpus evaluator (scoreResponse) consumes. */
export function envelopeToScored(envelope) {
  return {
    concerns: [envelope.concern],
    candidate_interventions: envelope.candidate_interventions || [],
    recommended: (envelope.candidate_interventions || []).map((c) => `${c?.title} ${c?.rationale}`).join("; "),
    investigation_or_goal:
      envelope.recommended_next_action === "investigate" ? "investigation"
      : envelope.recommended_next_action === "propose-goal" ? "goal"
      : "investigation",
    scope: envelope.scope || {},
    expected_mechanical_delta: envelope.expected_mechanical_delta || "",
    negative_control: envelope.negative_control || "",
    revision_evidence: envelope.abandon_or_reconsider_condition || "",
    decomposition_rationale: {
      granularity_assessment: "sufficient",
      why_not_broader: "scope bounded by the cited mechanical reading",
      why_not_finer: "the cited reading resolves as one unit; splitting yields no independent acceptance",
      harnessable_subproblems: ["archguard before/after comparison (existing instrument)"],
      investigation_required_subproblems: ["judgement not decidable from the raw reading alone"],
      primitives_reused: ["archguard before/after + negative control pattern"],
      coordination_cost_note: "kept as one slice to avoid paying the branch-lifecycle cost twice",
    },
  };
}

async function runOne({ caseId, group, roots, prompt, evidence }) {
  const t0 = Date.now();
  const startedIt = new Date().toISOString();
  const argv = launchArgv(group.role, prompt, roots[group.id], { promptViaStdin: true });
  const r = await runAsync(argv, { timeoutMs: 600_000, collectStderr: true, stdinData: prompt });
  const endedIt = new Date().toISOString();
  const duration_ms = Date.now() - t0;

  const modelFlagIdx = argv.indexOf("--model");
  const envelope = r.error || (typeof r.status === "number" && r.status !== 0) ? null : parseSemanticEnvelope(r.stdout);
  const rec = {
    case_id: caseId,
    group: group.id,
    provenance: {
      role: group.role,
      profile: group.profile,
      launcher: argv[0],                       // the ACTUAL argv[0] used
      model_from_profile: group.model,
      model_flag_in_argv: modelFlagIdx >= 0 ? argv[modelFlagIdx + 1] : null,
      prompt_via_stdin: argv[argv.length - 1] === "-p",
      prompt_sha256_16: sha(prompt),
      prompt_chars: prompt.length,
      gateway_env_dropped: group.dropsGatewayEnv,
      started_at: startedIt,
      ended_at: endedIt,
      duration_ms,
    },
    state: envelope ? "verified" : "not-evaluated",
    error: r.error ? String(r.error.message) : null,
    exit_status: r.status,
    envelope,
  };
  if (envelope) {
    rec.scores = scoreResponse(caseId, envelopeToScored(envelope));
    const refs = semanticEvidenceRefs(evidence);
    rec.cited_refs = envelope.evidence_refs || [];
    rec.unresolved_refs = (envelope.evidence_refs || []).filter((x) => !refs.has(x));
    rec.is_abstain = envelope.recommended_next_action === "abstain";
    rec.intervention_count = (envelope.candidate_interventions || []).length;
  }
  return rec;
}

async function main() {
  const reps = Number(process.argv[process.argv.indexOf("--reps") + 1] || 1);
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-ab-"));
  const roots = makeFixtureRoots(baseDir);

  const methodology = fs
    .readFileSync(path.join(REPO_ROOT, "docs", "references", "ownership-first-refactoring-methodology.md"), "utf8")
    .split("\n").filter((l) => l.startsWith("#")).slice(0, 25).join("\n");

  const caseIds = listCaseIds();
  const runs = [];
  for (const caseId of caseIds) {
    const input = loadCaseInput(caseId);              // input.json ONLY
    const evidence = caseEvidence(input, methodology);
    const prompt = buildSemanticPrompt(evidence);      // built ONCE, reused by both groups
    for (let rep = 1; rep <= reps; rep++) {
      for (const g of Object.values(GROUPS)) {
        process.stderr.write(`  ${caseId} ${g.id} rep${rep} ... `);
        const rec = await runOne({ caseId, group: g, roots, prompt, evidence });
        rec.rep = rep;
        runs.push(rec);
        process.stderr.write(`${rec.state} ${rec.provenance.duration_ms}ms\n`);
      }
    }
  }

  // Harness self-test: A and B must have produced IDENTICAL prompts for each case.
  const byCase = {};
  for (const c of caseIds) {
    const hashes = [...new Set(runs.filter((r) => r.case_id === c).map((r) => r.provenance.prompt_sha256_16))];
    byCase[c] = { prompt_shas: hashes, identical_across_groups: hashes.length === 1 };
  }
  const promptIdentical = Object.values(byCase).every((v) => v.identical_across_groups);

  const out = {
    experiment: "ownership-shadow semantic proposer — runtime+model A/B",
    design: {
      A: { launcher: GROUPS.A.launcher, model: GROUPS.A.model, backend: "LiteLLM gateway 127.0.0.1:26510 -> deepseek/deepseek-flash (DeepSeek-V4.1-Flash)" },
      B: { launcher: GROUPS.B.launcher, model: GROUPS.B.model, backend: "claude.ai login (native Anthropic)", gateway_env_dropped: GATEWAY_ENV },
      controls: {
        profiles_carrier: "fixture .quay/profiles.yml under a temp root — repo .quay/profiles.yml NOT modified",
        prompt: "built once per case from input.json only, reused verbatim by both groups",
        leakage: "reference.json / outcome.json never opened",
      },
    },
    harness_self_test: { prompts_identical_across_groups_per_case: promptIdentical, per_case: byCase },
    reps,
    runs,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n", "utf8");
  process.stderr.write(`\nwrote ${OUT_JSON}\n`);
  process.stderr.write(`harness self-test (prompts identical across groups): ${promptIdentical}\n`);
  fs.rmSync(baseDir, { recursive: true, force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
