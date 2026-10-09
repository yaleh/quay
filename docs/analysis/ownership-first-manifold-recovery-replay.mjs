#!/usr/bin/env node
// Deterministic (zero-LLM) feature extractor + fixed trigger rule for the manifold-recovery
// replay described in tasks/gap-ownership-first-manifold-recovery-replay.md. The 9 features and
// the >=6-of-9 pairwise-agreement trigger are declared here BEFORE being run against
// GOAL-031/032's content, so later runs cannot retroactively tune them.

import { readFileSync, writeFileSync, globSync } from "node:fs";

const FEATURES = [
  "has_archguard_before_after",
  "has_negative_control",
  "has_branch_selfhost_probe",
  "has_explicit_non_goals",
  "has_stop_signal_list",
  "has_three_state_exit_code",
  "sink_target_is_kernel",
  "human_activated",
  "merge_shape_single_commit",
];
const AGREEMENT_THRESHOLD = 6; // of 9 — fixed before inspecting GOAL-031/032

function extractFeatures(text) {
  const archguardMentions = (text.match(/ArchGuard/g) || []).length;
  // Extraction-bug fix, made BEFORE trusting any trigger result (same discipline as the
  // self-health backtest's meta-driver/meta-review rename fix): a known-true sample check
  // (`grep '^## .*非目标'` against all three real goal files) shows the actual heading text is
  // "## 范围与非目标" (scope+non-goals combined), not the bare "## 非目标" this regex first
  // assumed — the first draft silently read a real, present non-goals section as absent. Fixed
  // to match any line-start heading containing 非目标, regardless of what precedes it on the
  // heading line. The feature's DEFINITION (a non-goals heading with >=1 ⛔ bullet) is unchanged;
  // only the heading-matching mechanics were wrong.
  const hasNonGoalsHeading = /^##.*非目标/m.test(text);
  const nonGoalsSection = hasNonGoalsHeading ? text.split(/^##.*非目标.*$/m)[1]?.split(/\n##\s/)[0] || "" : "";
  const stopSignalHeading = /停止扩大范围的信号/.test(text);
  return {
    has_archguard_before_after: archguardMentions >= 2,
    has_negative_control: /负对照/.test(text),
    has_branch_selfhost_probe: /自举|selfhost|self-host/i.test(text),
    has_explicit_non_goals: hasNonGoalsHeading && /⛔/.test(nonGoalsSection),
    has_stop_signal_list: stopSignalHeading,
    has_three_state_exit_code: /退出码三态/.test(text) || /0\s*达成[\s\S]{0,40}1\s*未达成[\s\S]{0,60}3\s*未评估/.test(text),
    sink_target_is_kernel: /\bkernel\b/i.test(text),
    human_activated: /人\s*\d{4}-\d{2}-\d{2}\s*裁定|人\s*裁定/.test(text),
    merge_shape_single_commit: /恰好一个合并提交/.test(text),
  };
}

function pairwiseAgreement(vecA, vecB) {
  let agree = 0;
  for (const f of FEATURES) if (vecA[f] === vecB[f]) agree++;
  return agree;
}

function findGoalFile(id) {
  const matches = globSync(`goals/${id}-*.md`);
  if (matches.length !== 1) throw new Error(`expected exactly 1 match for ${id}, got ${matches.length}: ${matches.join(",")}`);
  return matches[0];
}

function run() {
  const ids = ["GOAL-030", "GOAL-031", "GOAL-032"];
  const files = {};
  const featureVectors = {};
  for (const id of ids) {
    const f = findGoalFile(id);
    files[id] = f;
    featureVectors[id] = extractFeatures(readFileSync(f, "utf8"));
  }

  const checkpoints = [];
  // Checkpoint 1: only GOAL-030 visible — structurally no pair to compare, trigger cannot fire.
  checkpoints.push({ checkpoint: 1, visible_goals: ["GOAL-030"], pairwise_agreement_scores: {}, trigger_fired: false });
  // Checkpoint 2: GOAL-030 + GOAL-031 visible.
  const agree2 = pairwiseAgreement(featureVectors["GOAL-030"], featureVectors["GOAL-031"]);
  checkpoints.push({
    checkpoint: 2,
    visible_goals: ["GOAL-030", "GOAL-031"],
    pairwise_agreement_scores: { "GOAL-030|GOAL-031": agree2 },
    trigger_fired: agree2 >= AGREEMENT_THRESHOLD,
  });
  // Checkpoint 3: all three visible — compute all 3 pairwise scores; trigger fires if ANY pair meets threshold.
  const agree3_01 = agree2;
  const agree3_02 = pairwiseAgreement(featureVectors["GOAL-030"], featureVectors["GOAL-032"]);
  const agree3_12 = pairwiseAgreement(featureVectors["GOAL-031"], featureVectors["GOAL-032"]);
  const scores3 = { "GOAL-030|GOAL-031": agree3_01, "GOAL-030|GOAL-032": agree3_02, "GOAL-031|GOAL-032": agree3_12 };
  checkpoints.push({
    checkpoint: 3,
    visible_goals: ["GOAL-030", "GOAL-031", "GOAL-032"],
    pairwise_agreement_scores: scores3,
    trigger_fired: Object.values(scores3).some((s) => s >= AGREEMENT_THRESHOLD),
  });

  const firstFired = checkpoints.find((c) => c.trigger_fired);
  const first_threshold_checkpoint = firstFired ? firstFired.checkpoint : null;

  return { featureVectors, checkpoints, first_threshold_checkpoint, files };
}

function verifyTrigger(resultsPath) {
  const stored = JSON.parse(readFileSync(resultsPath, "utf8"));
  const fv = stored.feature_vectors;
  const recomputed = [];
  recomputed.push({ checkpoint: 1, trigger_fired: false });
  const a2 = pairwiseAgreement(fv["GOAL-030"], fv["GOAL-031"]);
  recomputed.push({ checkpoint: 2, trigger_fired: a2 >= AGREEMENT_THRESHOLD });
  const a01 = a2;
  const a02 = pairwiseAgreement(fv["GOAL-030"], fv["GOAL-032"]);
  const a12 = pairwiseAgreement(fv["GOAL-031"], fv["GOAL-032"]);
  recomputed.push({ checkpoint: 3, trigger_fired: [a01, a02, a12].some((s) => s >= AGREEMENT_THRESHOLD) });

  let mismatch = false;
  for (let i = 0; i < 3; i++) {
    if (recomputed[i].trigger_fired !== stored.checkpoints[i].trigger_fired) {
      console.error(`MISMATCH at checkpoint ${i + 1}: recomputed=${recomputed[i].trigger_fired} stored=${stored.checkpoints[i].trigger_fired}`);
      mismatch = true;
    }
  }
  if (mismatch) process.exit(1);
  console.error("verify-trigger: recomputed checkpoints match stored checkpoints exactly");
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.includes("--verify-trigger")) {
  const inIdx = argv.indexOf("--in");
  verifyTrigger(argv[inIdx + 1]);
} else if (argv.includes("--extract")) {
  const outIdx = argv.indexOf("--out");
  const outPath = argv[outIdx + 1];
  const { featureVectors, checkpoints, first_threshold_checkpoint, files } = run();
  // contracts[] is populated separately (by hand, per the task's Plan step 5 — LLM-authored,
  // constrained to the extracted feature vectors only) and merged into this file afterward.
  const result = { feature_vectors: featureVectors, checkpoints, first_threshold_checkpoint, source_files: files, contracts: {} };
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.error(`first_threshold_checkpoint=${first_threshold_checkpoint}`);
  console.error(JSON.stringify(featureVectors, null, 2));
  process.exit(0);
} else {
  console.error("usage: --extract --out <path> | --verify-trigger --in <path>");
  process.exit(2);
}
