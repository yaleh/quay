#!/usr/bin/env node
// Ownership-first manifold recovery replay — deterministic, zero-LLM feature extractor + a
// pre-declared trigger test. See tasks/gap-ownership-first-manifold-recovery-replay.md.
//
// WHAT THIS MEASURES
//
// GOAL-030, GOAL-031 and GOAL-032 each self-declare as "isomorphic to the previous one". This
// script asks a narrow, falsifiable question: given a FIXED set of 9 boolean features and a
// FIXED trigger rule, at which replay checkpoint (seeing only {030}, then {030,031}, then
// {030,031,032}) does the trigger first fire? It is a test of an *extraction* procedure, not a
// narrative about what someone could have noticed.
//
// THE 9 FEATURES AND THE TRIGGER ARE DECLARED BELOW, BEFORE ANY RESULT IS COMPUTED.
// No feature definition and no threshold was added, removed, or retuned after the first run.
// A feature that comes out false is reported false — it is never "fixed" by widening its regex.
//
// WHAT THIS DOES NOT DO (see also the task's non-goals)
//   * no RoutineSpec is registered, no live proposer runs, no driver-candidate task is filed;
//   * it never imports, writes or reads anything under plugin/ (it is a pure consumer of the
//     three goal markdown bodies plus the results file it writes);
//   * the LLM-authored contracts below are NOT a production input — they are an inert artifact.
//
// USAGE
//   node docs/analysis/ownership-first-manifold-recovery-replay.mjs --extract --out <path>
//   node docs/analysis/ownership-first-manifold-recovery-replay.mjs --verify-trigger --in <path>
//
// --extract runs the extractor over the real goal files, applies the trigger at each of the
// three checkpoints, and writes results.json. --verify-trigger independently RECOMPUTES the
// trigger from the stored feature vectors using the same fixed rule and fails (exit 1) if the
// stored checkpoint verdicts disagree — that is the anti-retrofit check: it makes it impossible
// to have written "the trigger fired at ②" into the summary while the stored vectors say ③.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

// ---------------------------------------------------------------------------------------------
// FIXED FEATURE SET (declared before running; order is part of the contract with results.json)
// ---------------------------------------------------------------------------------------------

// Each feature is a boolean. `evidence` records, per goal, the first matching source line(s) so
// a reviewer can `grep` the substring and confirm the extraction is a reading of the real file
// rather than a constructed sample (see the task's DoD).
const FEATURES = [
  {
    key: "has_archguard_before_after",
    description:
      "body names an ArchGuard instrument reading taken both before and after the change: an " +
      "`archguard` mention AND a before-baseline line AND a separate after/post-baseline or " +
      "explicit before/after-comparison line. All three arms are required so that a goal " +
      "carrying only a before-baseline cannot satisfy a feature whose name says 'before AND after'",
    apply: (ctx) => {
      const armAg = ctx.firstMatchLine(/archguard/i);
      const armBefore = ctx.firstMatchLine(/(前基线|before\s*基线)/i);
      const armAfter = ctx.firstMatchLine(/(后基线|after\s*基线|前后对比|前后读数|before\s*\/\s*after)/i);
      return {
        value: Boolean(armAg && armBefore && armAfter),
        evidence: compact([armAg, armBefore, armAfter]),
      };
    },
  },
  {
    key: "has_negative_control",
    description: "body contains a deliberately-constructed negative control (负对照)",
    apply: (ctx) => {
      const hits = ctx.matchLines(/负对照/, 3);
      return { value: hits.length > 0, evidence: hits };
    },
  },
  {
    key: "has_branch_selfhost_probe",
    description:
      "body names the branch self-host technique (自举 / selfhost) — proving the code running " +
      "on the branch is the branch's own code",
    apply: (ctx) => {
      const hits = ctx.matchLines(/自举|selfhost/i, 3);
      return { value: hits.length > 0, evidence: hits };
    },
  },
  {
    key: "has_explicit_non_goals",
    description:
      "body carries an explicit 非目标 (non-goal) block holding at least one ⛔ bullet — the " +
      "mechanically-countable fence that bounds the slice",
    apply: (ctx) => {
      const block = ctx.nonGoalBlock;
      if (block === null) return { value: false, evidence: [] };
      // A real bullet carrying ⛔ — not the `非目标（⛔ 有意排除）：` marker line itself.
      const hits = block.lines.filter((l) => /^\s*[-*]\s*.*⛔/.test(l.text));
      return { value: hits.length > 0, evidence: compact(hits.slice(0, 3)) };
    },
  },
  {
    key: "has_stop_signal_list",
    description:
      "body carries a 停止扩大范围的信号-shaped heading — a pre-declared list of signals that " +
      "stop the scope from growing",
    apply: (ctx) => {
      const hits = ctx.matchLines(/停止扩大范围的信号/, 2);
      return { value: hits.length > 0, evidence: hits };
    },
  },
  {
    key: "has_three_state_exit_code",
    description:
      "body declares a three-state exit code — 0 达成 / 1 未达成 (with CAUSE=) / 3 未评估 — " +
      "so that 'not evaluated' cannot be confused with 'achieved'",
    apply: (ctx) => {
      const m = /0\s*达成[\s\S]{0,120}?1\s*未达成[\s\S]{0,120}?3\s*未评估/.exec(ctx.body);
      if (!m) return { value: false, evidence: [] };
      const line = ctx.bodyLineOfOffset(m.index);
      return { value: true, evidence: compact([line]) };
    },
  },
  {
    key: "sink_target_is_kernel",
    description:
      "the goal's POSITIVE scope (the 范围 block up to the 非目标 marker) or its 退出条件 names " +
      "a kernel/<module>.ts artifact as the destination it creates/sinks into. Positional, not " +
      "keyword: a kernel path named only inside 背景 or inside the ⛔ 非目标 fence does NOT " +
      "count (GOAL-031 names kernel/task-transition.ts only to exclude it)",
    apply: (ctx) => {
      const zones = [ctx.positiveScope, ctx.exitCondition].filter(Boolean);
      const hits = [];
      for (const z of zones) {
        const h = z.lines.find((l) => /kernel\/[A-Za-z0-9._-]+\.ts/.test(l.text));
        if (h) hits.push(h);
      }
      return { value: hits.length > 0, evidence: compact(hits) };
    },
  },
  {
    key: "human_activated",
    description:
      "the frontmatter attributes the goal to a human ruling — a `人` attribution carrying a " +
      "date (人 YYYY-MM-DD) in `origin` or a `statusLog` reason. NOTE: this is the PRINCIPLED, " +
      "broad reading of the feature name (all three goals were in fact human-activated). A " +
      "narrower `人.*裁定` reading is reported separately under `sensitivity` because it is " +
      "lexically stricter than the property the feature name denotes.",
    apply: (ctx) => {
      const hits = ctx.matchLines(/人\s*20\d{2}-\d{2}-\d{2}/, 2, ctx.frontmatterLines);
      return { value: hits.length > 0, evidence: hits };
    },
  },
  {
    key: "merge_shape_single_commit",
    description:
      "body requires the goal to land as exactly one merge commit (恰好一个合并提交) — the " +
      "branch's internal commits must not leak onto develop's first-parent chain",
    apply: (ctx) => {
      const hits = ctx.matchLines(/恰好一个合并提交/, 2);
      return { value: hits.length > 0, evidence: hits };
    },
  },
];

// A second, narrower reading of `human_activated`, computed only for the sensitivity report.
// Kept out of the primary vector so that it cannot silently move the trigger.
const SENSITIVITY_FEATURE = {
  key: "human_ruling_verb_in_frontmatter",
  description:
    "narrow reading: frontmatter matches `人.*裁定` (the example pattern named in the task). " +
    "GOAL-030 quotes the human (「现在开始执行…」) and GOAL-031 says 指令 rather than 裁定, so " +
    "this narrower predicate is expected to be false for both.",
  apply: (ctx) => {
    const joined = ctx.frontmatterLines.map((l) => l.text).join(" ");
    const ok = /人.*裁定/.test(joined);
    return { value: ok, evidence: ctx.matchLines(/人.*裁定/, 2, ctx.frontmatterLines) };
  },
};

// ---------------------------------------------------------------------------------------------
// FIXED TRIGGER RULE (declared before running)
// ---------------------------------------------------------------------------------------------

const TOTAL_FEATURES = FEATURES.length; // 9
const MIN_AGREEMENT = 6; // a recurring-axis candidate is proposable iff some visible pair agrees on >= 6 of 9

// Checkpoints are progressive visibility over the three goals in id order.
const CHECKPOINT_VISIBILITY = [
  ["GOAL-030"],
  ["GOAL-030", "GOAL-031"],
  ["GOAL-030", "GOAL-031", "GOAL-032"],
];

// ---------------------------------------------------------------------------------------------
// LLM-AUTHORED CANDIDATE CONTRACT (the ONLY non-mechanical value in this file)
// ---------------------------------------------------------------------------------------------
//
// WHERE THIS CAME FROM. After --extract ran, the trigger first fired at checkpoint 2 (see
// results.json -> first_threshold_checkpoint). Only then was this contract synthesized, from the
// extracted feature vectors of the visible goals alone (not from a fresh re-read of the prose).
// Because the trigger already held at ②, a second contract was regenerated at ③ for comparison.
//
// THE GUARD. Every contract declares `synthesized_at_checkpoint`; the extractor refuses to run
// if a contract's declared checkpoint is later than the computed first firing checkpoint (i.e.
// you cannot claim a contract was synthesized at ② if the trigger did not fire until ③). A
// contract declaring `regenerated_for_comparison: true` must be at a later checkpoint than the
// first firing one. This is the enforceable half of the anti-retrofit property; the
// unenforceable half (that the feature set was fixed before the goal bodies were read at all) is
// stated plainly in the .md writeup's limitations section.
const CONTRACTS = {
  checkpoint_2: {
    synthesized_at_checkpoint: 2,
    visible_goals: ["GOAL-030", "GOAL-031"],
    synthesized_inputs: "the two extracted 9-feature boolean vectors only",
    confidence:
      "medium — 2 samples, pairwise agreement 7/9; two features (has_negative_control, " +
      "sink_target_is_kernel) are held by one sample and not the other, so they enter the " +
      "contract as supported-but-not-uniform rather than as invariants",
    feature_support: {
      has_archguard_before_after: "2/2",
      has_negative_control: "1/2",
      has_branch_selfhost_probe: "2/2",
      has_explicit_non_goals: "2/2",
      has_stop_signal_list: "2/2",
      has_three_state_exit_code: "2/2",
      sink_target_is_kernel: "1/2",
      human_activated: "2/2",
      merge_shape_single_commit: "2/2",
    },
    owner_concern:
      "Recurring ownership defects in the task/goal lifecycle surface that are observable " +
      "through ArchGuard: one reading or one vocabulary is computed in more than one place (a " +
      "duplicated decision function, a dispersed string literal, a write whose layer does not " +
      "own the decision). Each recurrence is retired by moving that single decision to its " +
      "correct owning layer in a minimally-scoped slice, leaving runtime semantics and every " +
      "out-of-scope writer byte-identical.",
    scope: {
      owned_reading_classes: [
        "ArchGuard before/after instrument readings (detect_duplicates groups, get_literal_dispersion values, package/layer edge strengths)",
        "three-state criterion exit codes (0 达成 / 1 未达成 with CAUSE= / 3 未评估)",
        "goal-branch merge-shape readings (exactly one merge commit on develop's first-parent chain; internal commits do not leak)",
        "branch self-host identity readings (the resolved realpath of a loaded module lies inside the branch worktree, not the main checkout)",
      ],
      owned_mechanisms_or_paths: [
        "the goal-branch lifecycle (create from develop tip, one worktree per task, catch up develop before landing, land as one merge commit)",
        "the explicit ⛔ non-goal fence declared per goal and mechanically counted",
        "the human activation ruling recorded in the goal frontmatter's origin field",
        "the branch self-host probe technique (realpath identity of the modules actually loaded)",
        "the owning-layer routing decision — kernel is one instantiation, an already-canonical existing module is another",
      ],
    },
    inputs: [
      "an ArchGuard before-baseline reading of the affected signal, taken on the pre-change tree",
      "the inventory of which module is ALREADY the single source of truth for the affected vocabulary",
      "the per-file positional enumeration of residual occurrences, each classified as real-defect / canonical-declaration / exempted / cross-vocabulary false-positive",
      "the human activation ruling text",
    ],
    forbidden_actions: [
      "⛔ do not widen the slice past the enumerated occurrences",
      "⛔ do not create a second canonical declaration of a vocabulary that already has one",
      "⛔ do not change runtime semantics, allowed lifecycle edges, or any out-of-scope writer",
      "⛔ do not import or depend on artifacts that exist only on an unmerged sibling goal branch",
      "⛔ do not add edges to layers.yml, clear directory cycles, or split large files",
      "⛔ do not touch production driver processes or the production .quay/ and tasks/ state",
    ],
    success_metrics: [
      "the ArchGuard after-reading is comparable to the before-reading and the targeted signal strictly improves, with every residual accounted for by a recorded non-defect reason",
      "a deliberately-constructed negative control flips the reading the wrong way when the mechanism is removed — proving the metric measures the change and is not a fixture echo",
      "all pre-existing tests plus any added characterization test are green on the branch tip, and import-graph-check ratchets do not regress",
      "the goal lands on develop as exactly one merge commit whose second parent is the goal branch tip",
      "branch self-host identity is demonstrated: the resolved realpath of the loaded modules lies inside the branch worktree",
    ],
    replay_dataset: ["goals/GOAL-030-*.md", "goals/GOAL-031-*.md"],
    stop_retire_criteria: [
      "code-identity false positive: self-host or module resolution escapes to the main checkout",
      "production pollution: a sandbox run mutates the production .quay/ or tasks/",
      "isolation loss: this goal's commits appear on develop's first-parent chain, or a landed task is re-dispatched",
      "an unmerged sibling goal branch becomes a dependency, or layers.yml must gain an edge",
      "baseline drift: characterization snapshots or golden samples change without an explanation from the slice",
      "sustained manual patching outside the task mechanism",
    ],
  },

  checkpoint_3: {
    synthesized_at_checkpoint: 3,
    regenerated_for_comparison: true,
    visible_goals: ["GOAL-030", "GOAL-031", "GOAL-032"],
    synthesized_inputs: "the three extracted 9-feature boolean vectors only",
    confidence:
      "medium-high — 3 samples; the axis reconfirms and scope does not change. The SAME two " +
      "features remain non-uniform (has_negative_control 2/3, sink_target_is_kernel 2/3), so the " +
      "third sample adds confidence without upgrading either into a claimed invariant",
    feature_support: {
      has_archguard_before_after: "3/3",
      has_negative_control: "2/3",
      has_branch_selfhost_probe: "3/3",
      has_explicit_non_goals: "3/3",
      has_stop_signal_list: "3/3",
      has_three_state_exit_code: "3/3",
      sink_target_is_kernel: "2/3",
      human_activated: "3/3",
      merge_shape_single_commit: "3/3",
    },
    delta_from_checkpoint_2:
      "scope unchanged (no reading class, mechanism or forbidden action added or removed); " +
      "confidence raised medium → medium-high; replay_dataset extended with GOAL-032; and one " +
      "finding recorded that the ② contract could not have seen — sink_target_is_kernel is " +
      "2/3, not 3/3: GOAL-031 sinks its vocabulary into an ALREADY-canonical existing module " +
      "(plugin/scripts/task-status.ts), not into kernel. The axis is therefore 'route the " +
      "decision to its correct owning layer', NOT 'sink to kernel'.",
    owner_concern:
      "Recurring ownership defects in the task/goal lifecycle surface that are observable " +
      "through ArchGuard: one reading or one vocabulary is computed in more than one place (a " +
      "duplicated decision function, a dispersed string literal, a write whose layer does not " +
      "own the decision). Each recurrence is retired by moving that single decision to its " +
      "correct owning layer in a minimally-scoped slice, leaving runtime semantics and every " +
      "out-of-scope writer byte-identical.",
    scope: {
      owned_reading_classes: [
        "ArchGuard before/after instrument readings (detect_duplicates groups, get_literal_dispersion values, package/layer edge strengths)",
        "three-state criterion exit codes (0 达成 / 1 未达成 with CAUSE= / 3 未评估)",
        "goal-branch merge-shape readings (exactly one merge commit on develop's first-parent chain; internal commits do not leak)",
        "branch self-host identity readings (the resolved realpath of a loaded module lies inside the branch worktree, not the main checkout)",
      ],
      owned_mechanisms_or_paths: [
        "the goal-branch lifecycle (create from develop tip, one worktree per task, catch up develop before landing, land as one merge commit)",
        "the explicit ⛔ non-goal fence declared per goal and mechanically counted",
        "the human activation ruling recorded in the goal frontmatter's origin field",
        "the branch self-host probe technique (realpath identity of the modules actually loaded)",
        "the owning-layer routing decision — the correct layer may be kernel OR an already-canonical existing module (GOAL-031 uses the latter)",
      ],
    },
    inputs: [
      "an ArchGuard before-baseline reading of the affected signal, taken on the pre-change tree",
      "the inventory of which module is ALREADY the single source of truth for the affected vocabulary",
      "the per-file positional enumeration of residual occurrences, each classified as real-defect / canonical-declaration / exempted / cross-vocabulary false-positive",
      "the human activation ruling text",
      "an equivalence investigation when the defect is a suspected duplicate, recorded BEFORE the goal is created (equivalent vs intentionally-divergent)",
    ],
    forbidden_actions: [
      "⛔ do not widen the slice past the enumerated occurrences",
      "⛔ do not create a second canonical declaration of a vocabulary that already has one",
      "⛔ do not change runtime semantics, allowed lifecycle edges, or any out-of-scope writer",
      "⛔ do not import or depend on artifacts that exist only on an unmerged sibling goal branch",
      "⛔ do not add edges to layers.yml, clear directory cycles, or split large files",
      "⛔ do not touch production driver processes or the production .quay/ and tasks/ state",
    ],
    success_metrics: [
      "the ArchGuard after-reading is comparable to the before-reading and the targeted signal strictly improves, with every residual accounted for by a recorded non-defect reason",
      "a deliberately-constructed negative control flips the reading the wrong way when the mechanism is removed — proving the metric measures the change and is not a fixture echo",
      "all pre-existing tests plus any added characterization test are green on the branch tip, and import-graph-check ratchets do not regress",
      "the goal lands on develop as exactly one merge commit whose second parent is the goal branch tip",
      "branch self-host identity is demonstrated: the resolved realpath of the loaded modules lies inside the branch worktree",
    ],
    replay_dataset: ["goals/GOAL-030-*.md", "goals/GOAL-031-*.md", "goals/GOAL-032-*.md"],
    stop_retire_criteria: [
      "code-identity false positive: self-host or module resolution escapes to the main checkout",
      "production pollution: a sandbox run mutates the production .quay/ or tasks/",
      "isolation loss: this goal's commits appear on develop's first-parent chain, or a landed task is re-dispatched",
      "an unmerged sibling goal branch becomes a dependency, or layers.yml must gain an edge",
      "baseline drift: characterization snapshots or golden samples change without an explanation from the slice",
      "sustained manual patching outside the task mechanism",
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Markdown -> feature context
// ---------------------------------------------------------------------------------------------

function compact(arr) {
  return arr.filter(Boolean);
}

function numberedLines(text) {
  return text.split("\n").map((t, i) => ({ line: i + 1, text: t }));
}

// The body is everything after the YAML frontmatter. Line numbers reported are 1-based over the
// WHOLE file, so a reviewer's `grep -n` output matches the evidence verbatim.
function splitFrontmatter(text) {
  const lines = numberedLines(text);
  if (lines[0] && lines[0].text.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].text.trim() === "---") {
        return { frontmatterLines: lines.slice(0, i + 1), bodyLines: lines.slice(i + 1) };
      }
    }
  }
  return { frontmatterLines: [], bodyLines: lines };
}

// Level-2 sections: `## <heading>` up to the next `## `.
function sectionsOf(bodyLines) {
  const out = [];
  let cur = null;
  for (const l of bodyLines) {
    if (/^##\s+/.test(l.text)) {
      if (cur) out.push(cur);
      cur = { heading: l.text.replace(/^##\s+/, "").trim(), headingLine: l.line, lines: [] };
    } else if (cur) {
      cur.lines.push(l);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function sectionByHeadingMarker(sections, marker) {
  return sections.find((s) => s.heading.includes(marker)) || null;
}

// Non-goal block: from the first line mentioning 非目标 to the nearest enclosing `## ` heading
// (or EOF). Works whether 非目标 is its own heading or a bolded paragraph inside 范围与非目标.
function nonGoalBlockOf(bodyLines) {
  const start = bodyLines.findIndex((l) => l.text.includes("非目标"));
  if (start === -1) return null;
  const lines = [];
  for (let i = start; i < bodyLines.length; i++) {
    if (i > start && /^##\s+/.test(bodyLines[i].text)) break;
    lines.push(bodyLines[i]);
  }
  return { lines };
}

// Positive scope: the 范围 section's content, truncated at the 非目标 marker. This is what keeps
// a kernel path named only inside the ⛔ fence from satisfying `sink_target_is_kernel`.
function positiveScopeOf(sections) {
  const sec = sectionByHeadingMarker(sections, "范围");
  if (!sec) return null;
  const cut = sec.lines.findIndex((l) => l.text.includes("非目标"));
  return { lines: cut === -1 ? sec.lines : sec.lines.slice(0, cut) };
}

function makeContext(text) {
  const { frontmatterLines, bodyLines } = splitFrontmatter(text);
  const sections = sectionsOf(bodyLines);
  const body = bodyLines.map((l) => l.text).join("\n");
  const ctx = {
    text,
    body,
    frontmatterLines,
    bodyLines,
    sections,
    nonGoalBlock: nonGoalBlockOf(bodyLines),
    positiveScope: positiveScopeOf(sections),
    exitCondition: sectionByHeadingMarker(sections, "退出条件"),
    // Map an offset inside the joined body back to the real 1-based file line, so evidence line
    // numbers line up with a reviewer's `grep -n` on the original file.
    bodyLineOfOffset(offset) {
      let count = 0;
      for (const l of bodyLines) {
        count += l.text.length + 1;
        if (count > offset) return l;
      }
      return bodyLines.length ? bodyLines[bodyLines.length - 1] : null;
    },
    matchLines(re, limit, lines) {
      const pool = lines || bodyLines;
      const hits = [];
      for (const l of pool) {
        if (re.test(l.text)) {
          hits.push(l);
          if (hits.length >= limit) break;
        }
      }
      return hits;
    },
    firstMatchLine(re, lines) {
      return this.matchLines(re, 1, lines)[0] || null;
    },
  };
  return ctx;
}

function extractVector(ctx, features) {
  const vector = {};
  const evidence = {};
  for (const f of features) {
    const { value, evidence: ev } = f.apply(ctx);
    vector[f.key] = value;
    evidence[f.key] = ev.map((l) => ({ line: l.line, text: l.text.trim().slice(0, 240) }));
  }
  return { vector, evidence };
}

// ---------------------------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------------------------

function agreement(a, b, keys) {
  let n = 0;
  for (const k of keys) if (Boolean(a[k]) === Boolean(b[k])) n++;
  return n;
}

// Returns one entry per checkpoint. `trigger_evaluated` distinguishes "we looked and it did not
// fire" from "we could not look at all" (a single visible goal gives no pair to compare) — an
// unevaluated checkpoint shares the output shape of a negative one, so it gets its own field
// rather than being silently reported as `false` (hard rule 3b).
function computeCheckpoints(vectors, keysByGoal, visibility) {
  const out = [];
  for (let i = 0; i < visibility.length; i++) {
    const visible = visibility[i];
    const pairs = [];
    for (let a = 0; a < visible.length; a++) {
      for (let b = a + 1; b < visible.length; b++) {
        const ga = visible[a];
        const gb = visible[b];
        const vecA = vectors[ga];
        const vecB = vectors[gb];
        if (!vecA || !vecB) continue;
        pairs.push({
          pair: `${ga}|${gb}`,
          agree: agreement(vecA, vecB, keysByGoal),
          of: keysByGoal.length,
        });
      }
    }
    const entry = {
      checkpoint: i + 1,
      visible_goals: visible,
      pairwise_agreement_scores: pairs,
      max_agreement: pairs.length ? Math.max(...pairs.map((p) => p.agree)) : null,
    };
    if (pairs.length === 0) {
      entry.trigger_evaluated = false;
      entry.trigger_fired = false;
      entry.reason =
        "insufficient-samples: 1 visible goal yields 0 comparable pairs, so the pairwise-agreement trigger is not evaluable here (NOT 'not yet fired')";
    } else {
      entry.trigger_evaluated = true;
      entry.trigger_fired = pairs.some((p) => p.agree >= MIN_AGREEMENT);
    }
    out.push(entry);
  }
  return out;
}

function firstFiringCheckpoint(checkpoints) {
  const hit = checkpoints.find((c) => c.trigger_fired === true);
  return hit ? hit.checkpoint : null;
}

// ---------------------------------------------------------------------------------------------
// Extract mode
// ---------------------------------------------------------------------------------------------

function resolveGoalFiles() {
  const dir = join(REPO_ROOT, "goals");
  const names = readdirSync(dir);
  const out = {};
  for (const id of ["GOAL-030", "GOAL-031", "GOAL-032"]) {
    const match = names.find((n) => n.startsWith(id + "-") && n.endsWith(".md"));
    if (!match) throw new Error(`missing goal file for ${id} under ${dir}`);
    out[id] = match;
  }
  return out;
}

function runExtract(outPath) {
  const files = resolveGoalFiles();
  const vectors = {};
  const evidenceByGoal = {};
  const sourceFiles = {};
  const contexts = {};
  for (const [id, name] of Object.entries(files)) {
    const text = readFileSync(join(REPO_ROOT, "goals", name), "utf8");
    const ctx = makeContext(text);
    contexts[id] = ctx;
    const { vector, evidence } = extractVector(ctx, FEATURES);
    vectors[id] = vector;
    evidenceByGoal[id] = evidence;
    sourceFiles[id] = `goals/${name}`;
  }

  const keys = FEATURES.map((f) => f.key);
  const checkpoints = computeCheckpoints(vectors, keys, CHECKPOINT_VISIBILITY);
  const first = firstFiringCheckpoint(checkpoints);

  // Sensitivity: the same pipeline under a narrower reading of `human_activated`. Reported
  // separately; it can never move the primary trigger.
  const narrowVectors = {};
  for (const id of Object.keys(vectors)) {
    const { value } = SENSITIVITY_FEATURE.apply(contexts[id]);
    narrowVectors[id] = { ...vectors[id], human_activated: value };
  }
  const narrowCheckpoints = computeCheckpoints(narrowVectors, keys, CHECKPOINT_VISIBILITY);
  const narrowFirst = firstFiringCheckpoint(narrowCheckpoints);

  // Contract guard: you may not declare a contract at a checkpoint that never fired, nor a
  // "regenerated" contract at or before the first firing checkpoint.
  const contractErrors = [];
  for (const [name, c] of Object.entries(CONTRACTS)) {
    if (first === null) {
      contractErrors.push(`${name}: trigger never fired, but a contract is declared`);
      continue;
    }
    const declared = c.synthesized_at_checkpoint;
    if (c.regenerated_for_comparison) {
      if (!(declared > first)) {
        contractErrors.push(
          `${name}: regenerated_for_comparison contract must be at a checkpoint AFTER the first firing one (${first}), got ${declared}`,
        );
      }
    } else if (declared !== first) {
      contractErrors.push(
        `${name}: claims synthesis at checkpoint ${declared}, but the trigger first fired at ${first}`,
      );
    }
  }

  const results = {
    task: "gap-ownership-first-manifold-recovery-replay",
    generated_by: "docs/analysis/ownership-first-manifold-recovery-replay.mjs",
    mode: "deterministic extraction; the only non-mechanical value is `contracts`, authored by an LLM after extraction and guarded by `synthesized_at_checkpoint`",
    source_files: sourceFiles,
    feature_definitions: Object.fromEntries(FEATURES.map((f) => [f.key, f.description])),
    trigger_rule: {
      kind: "pairwise-agreement",
      total_features: TOTAL_FEATURES,
      min_agreement: MIN_AGREEMENT,
      declared:
        "a recurring-axis candidate is proposable at a checkpoint iff the visible goals' feature vectors pairwise agree on >= 6 of 9 features; a checkpoint with fewer than 2 visible goals is not evaluable",
      checkpoints: CHECKPOINT_VISIBILITY.map((v, i) => ({ checkpoint: i + 1, visible_goals: v })),
    },
    feature_vectors: vectors,
    feature_evidence: evidenceByGoal,
    checkpoints,
    first_threshold_checkpoint: first,
    contracts: CONTRACTS,
    sensitivity: {
      note: "hides nothing and moves nothing: the primary trigger above uses the principled broad reading of human_activated. This block recomputes the same pipeline with the narrower `人.*裁定` reading named in the task, purely to show the answer is not an artifact of that choice.",
      definition: SENSITIVITY_FEATURE.description,
      feature_vectors: narrowVectors,
      checkpoints: narrowCheckpoints,
      first_threshold_checkpoint: narrowFirst,
    },
    contract_guard: { ok: contractErrors.length === 0, errors: contractErrors },
    interpretation:
      first === null
        ? "the fixed rule never fired on this dataset — reported honestly, with no retrofitted narrative"
        : `the fixed >=${MIN_AGREEMENT}-of-${TOTAL_FEATURES} pairwise-agreement rule first fires at checkpoint ${first} (visible goals: ${CHECKPOINT_VISIBILITY[first - 1].join(", ")})`,
  };

  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  if (contractErrors.length) {
    console.error("contract guard FAILED:");
    for (const e of contractErrors) console.error("  - " + e);
    process.exit(1);
  }
  console.log(`wrote ${outPath}`);
  console.log(`feature_vectors: ${Object.keys(vectors).join(", ")}`);
  for (const c of checkpoints) {
    console.log(
      `checkpoint ${c.checkpoint}: visible=[${c.visible_goals.join(",")}] ` +
        `scores=[${c.pairwise_agreement_scores.map((p) => `${p.pair}:${p.agree}/${p.of}`).join(", ") || "none"}] ` +
        `evaluated=${c.trigger_evaluated} fired=${c.trigger_fired}`,
    );
  }
  console.log(`first_threshold_checkpoint: ${first === null ? "null" : first}`);
}

// ---------------------------------------------------------------------------------------------
// Verify mode — independent recomputation from the stored vectors (anti-retrofit)
// ---------------------------------------------------------------------------------------------

function runVerify(inPath) {
  const results = JSON.parse(readFileSync(inPath, "utf8"));
  const keys = FEATURES.map((f) => f.key);
  const vectors = results.feature_vectors || {};
  const ids = Object.keys(vectors).sort();
  const problems = [];

  for (const id of ids) {
    const missing = keys.filter((k) => typeof vectors[id][k] !== "boolean");
    if (missing.length) problems.push(`${id}: non-boolean/missing features: ${missing.join(", ")}`);
  }

  const recon = computeCheckpoints(vectors, keys, CHECKPOINT_VISIBILITY);
  const stored = results.checkpoints || [];
  if (stored.length !== recon.length) {
    problems.push(`checkpoints length ${stored.length} != recomputed ${recon.length}`);
  }
  for (let i = 0; i < Math.min(stored.length, recon.length); i++) {
    const s = stored[i];
    const r = recon[i];
    if (s.visible_goals.join(",") !== r.visible_goals.join(",")) {
      problems.push(`checkpoint ${i + 1}: visible_goals ${s.visible_goals} != ${r.visible_goals}`);
    }
    if (Boolean(s.trigger_fired) !== r.trigger_fired) {
      problems.push(
        `checkpoint ${i + 1}: stored trigger_fired=${s.trigger_fired} but recomputed=${r.trigger_fired} (RETROFIT DETECTED)`,
      );
    }
    if (Boolean(s.trigger_evaluated) !== r.trigger_evaluated) {
      problems.push(
        `checkpoint ${i + 1}: stored trigger_evaluated=${s.trigger_evaluated} but recomputed=${r.trigger_evaluated}`,
      );
    }
    const sa = (s.pairwise_agreement_scores || []).map((p) => `${p.pair}:${p.agree}`).join(",");
    const ra = r.pairwise_agreement_scores.map((p) => `${p.pair}:${p.agree}`).join(",");
    if (sa !== ra) problems.push(`checkpoint ${i + 1}: scores stored=[${sa}] != recomputed=[${ra}]`);
  }

  const reconFirst = firstFiringCheckpoint(recon);
  if (reconFirst !== results.first_threshold_checkpoint) {
    problems.push(
      `first_threshold_checkpoint stored=${results.first_threshold_checkpoint} recomputed=${reconFirst}`,
    );
  }

  // Contracts must be consistent with the recomputed first firing checkpoint (the guard, re-run
  // here so a hand-edited results.json cannot smuggle in a retrofitted contract).
  const contracts = results.contracts || {};
  if (Object.keys(contracts).length === 0) problems.push("contracts: none present");
  const required = [
    "owner_concern",
    "scope",
    "inputs",
    "forbidden_actions",
    "success_metrics",
    "replay_dataset",
    "stop_retire_criteria",
  ];
  for (const [name, c] of Object.entries(contracts)) {
    for (const k of required) {
      const v = c[k];
      const empty =
        v === undefined ||
        v === null ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0) ||
        (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
      if (empty) problems.push(`${name}: field ${k} missing or empty`);
    }
    const declared = c.synthesized_at_checkpoint;
    if (reconFirst === null) {
      problems.push(`${name}: trigger never fires but a contract is declared`);
    } else if (c.regenerated_for_comparison) {
      if (!(declared > reconFirst)) {
        problems.push(
          `${name}: regenerated contract must be after first firing checkpoint ${reconFirst}, got ${declared}`,
        );
      }
    } else if (declared !== reconFirst) {
      problems.push(
        `${name}: claims synthesis at checkpoint ${declared}, but the trigger first fires at ${reconFirst}`,
      );
    }
  }

  if (problems.length) {
    console.error("verify-trigger FAILED:");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(
    `verify-trigger OK: recomputed from ${ids.length} stored feature vector(s); ` +
      `checkpoints=${recon.map((c) => (c.trigger_evaluated ? String(c.trigger_fired) : "not-evaluated")).join(",")}; ` +
      `first_threshold_checkpoint=${reconFirst === null ? "null" : reconFirst}; ` +
      `contracts=${Object.keys(contracts).length}`,
  );
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function main(argv) {
  const args = { mode: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--extract") args.mode = "extract";
    else if (a === "--verify-trigger") args.mode = "verify";
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--in") args.in = argv[++i];
  }
  if (args.mode === "extract") {
    runExtract(args.out || join(HERE, "ownership-first-manifold-recovery-replay.results.json"));
  } else if (args.mode === "verify") {
    runVerify(args.in || join(HERE, "ownership-first-manifold-recovery-replay.results.json"));
  } else {
    console.error("usage: --extract [--out <path>] | --verify-trigger [--in <path>]");
    process.exit(2);
  }
}

main(process.argv.slice(2));
