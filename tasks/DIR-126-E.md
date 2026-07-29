---
id: DIR-126-E
title: Recalibrate the prepare-milestone capacity model from real telemetry
  (--capacity-report aggregation) — fifth and final child of DIR-126's split
status: todo
labels:
  - milestone-candidate
  - human-steered
  - priority:urgent
parent: DIR-126
children: []
extra:
  schema: v1
  dirStatus: applied
  rank: 0
  urgency: urgent
---

**type:** execution

## Proposal

Replace `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md`'s flat "15-25 minute"
Prepare planning assumption with a real, reproducible measured distribution, computed by a checked-
in aggregation command over [[DIR-126-D]]'s committed telemetry records. Fifth and final child of
DIR-126's 5-way split. Depends on [[DIR-126-D]] (aggregation has nothing to aggregate until
telemetry exists and has been exercised in production) and structurally on >= 3 real post-D
preparation generations existing (this task's own DoD requirement).

### Problem framing (re-verified live against the current tree, 2026-07-29)

`docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` states "15-25 minutes" as the
Prepare planning range, folded into an 85-95 minute per-task total. DIR-126's own Finding measured
M195's successful Prepare at ~80 minutes (57 of them PlanCheck alone) — 3-5x the documented
assumption — with no P50/P85 distribution, no `prepared/attempt` ratio, and no duplicate-generation
accounting anywhere in the checked-in doc, and no checked-in command anywhere under
`experiments/quay-perpetual-stream/scripts/` produces one from telemetry.

### Chosen mechanism

New `--capacity-report --telemetry-glob 'milestones/prepare-telemetry/**/*.json'` aggregation mode
on `milestone-preparation-check.ts` (+ `plugin/scripts/` mirror), scanning every telemetry record
DIR-126-D produces plus its paired `milestones/*/preparation.json` receipt, emitting:

- Dispatch-attempt count and acquired/content-generation count (a contention or
  `reuse-terminal` attempt is not mislabeled as a newly executed content generation).
- P50/P85 Prepare wall time and summed agent-minutes, broken down by
  `class`/`highRisk`, terminal outcome/reason, and [[DIR-126-C]] decision
  (`cold|resume|reuse-terminal`; pre-decision contention is reported separately as
  `not-evaluated`, never folded into cold).
- Mechanical-runner versus content-generation/review agent dispatch counts/minutes, including the
  invariant that `reuse-terminal` consumes zero content agents.
- `prepared/attempt` ratio (successful terminal outcomes over eligible dispatch attempts), with the
  acquired-content-generation denominator also shown so contention/reuse attempts cannot obscure
  interpretation.
- Terminal/decision yield by reason (prepared, unique split/preflight decision, reused terminal,
  transient failure), so valuable non-`prepared` outcomes are visible without relabeling them as
  success.
- `absorbed-task/prepare-hour`.
- **Concurrent duplicate-generation minutes**, computed only as the intersection of two acquired
  generation time intervals for the same `(workspace, taskId)`; a legitimate sequential retry
  whose interval starts after the prior terminal contributes zero.
- **Unchanged-stable-terminal recomputation**, counted separately when a generation repeats a
  cacheable `split-recommended`/`preflight-rejected` decision with identical
  task/Proposal/charter/review-policy hashes instead of using [[DIR-126-C]]'s `reuse-terminal`.
  Report both occurrences and the observed content-agent minutes spent by those avoidable reruns.
- `reuse-terminal` hit count and exact suppressed content-agent dispatch count. Any
  "estimated avoided agent-minutes" is model-derived from a named comparable-sample median,
  explicitly labeled estimated with its method/sample IDs, never presented as observed savings.
- Explicit exclusions: fixture/forced-recovery telemetry records (e.g. [[DIR-126-A]]'s
  `--force-release` recoveries), listed by id, never silently dropped from the sample count.

The throughput doc (`docs/proposals/quay-milestone-workflow-throughput-capacity-model.md`) is
regenerated from this command's real output, replacing the flat "15-25 minute" line with the
reproduced distribution and its sample provenance (raw sample IDs, terminal outcomes, explicit
exclusions — never a bare summary number with no way to trace it back to real artifacts).

### Key design decisions

- **Aggregation reads only checked-in artifacts** (telemetry records + receipts), never Claude Code
  session JSONL — the same "no `~/.claude/projects/**.jsonl` parsing" bar [[DIR-126-D]]'s own AC
  already establishes, extended here to the aggregation layer.
- **Concurrency and unchanged-input recomputation are different waste classes** — concurrency is
  interval overlap that A prevents; unchanged stable-terminal recomputation is a sequential,
  hash-identical rerun that C prevents. A second generation by itself is not a duplicate.
- **Wall time and agent work are both reported** — parallel authors can reduce wall time while
  increasing summed agent-minutes; reporting only one would misstate capacity.
- **Mechanical runners and content agents remain separate** — B can reject cheaply only if the
  report shows content work stayed at zero; C's terminal reuse has the same invariant.
- **Savings are not fabricated** — suppressed dispatch count is exact from telemetry. Avoided
  minutes are shown only as an explicitly estimated counterfactual with a reproducible comparable
  sample set; otherwise the field is `unknown`.
- **Exclusions are explicit and listed by id, never silently dropped** — a fixture or forced-
  recovery run must not silently inflate or deflate the real production sample count; the report's
  own `exclusions` field is the audit trail for what was left out and why.
- **LOC/duration stay descriptive output only, never a productivity target** — matches DIR-126's own
  parent-level Non-goals; this child's report characterizes throughput, it does not become an
  incentive to game line counts or wall-clock time at the expense of quality.
- **The throughput doc is regenerated from the command's real output, not hand-edited to match a
  desired narrative** — the doc's own provenance section must cite the real sample IDs the command
  actually read, so a later reader can re-run the same command and get the same numbers.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Fewer than 3 real post-D telemetry samples exist | `--capacity-report` reports `insufficient-samples` explicitly, not a misleadingly-precise distribution from too few points |
| A telemetry record is malformed/unreadable | excluded from the sample count, listed explicitly in `exclusions` with the reason, never silently skipped without a trace |
| A fixture/forced-recovery record is included in the glob | excluded from production statistics, listed explicitly in `exclusions` |
| Concurrent overlap minutes computed as non-zero post-A-enforcement | reported as-is (a real finding), never suppressed or explained away by the report itself |
| A sequential retry starts after the prior terminal | zero concurrent-duplicate minutes; still eligible for unchanged-terminal-recomputation analysis |
| Identical cacheable terminal is recomputed instead of reused post-C | occurrence and observed wasted content-agent minutes reported as-is |
| Avoided-minute counterfactual lacks comparable real samples | `estimatedAvoidedAgentMinutes: "unknown"`; never fabricate an exact saving |

### Compatibility

Purely additive: a new CLI mode on an existing script, plus a doc rewrite. No existing
`milestone-preparation-check.ts` check changes shape or becomes stricter. Both the script mirror
and the throughput doc stay in the same repo-relative locations. `plugin/` mirror stays
byte-identical via the existing vendor-sync mechanism.

### Risks

- **Cross-mechanism sequencing dependency (inherited from the parent's own Risks):** this child
  cannot produce real data until [[DIR-126-A]] through [[DIR-126-D]] are landed and exercised — the
  parent's own DoD "at least 3 post-change real preparation generations of different terminal
  shapes" is the natural gate for this, not an independent parallel workstream. This child's own
  dispatch should not begin in earnest until that sample threshold is realistically reachable.
- **Too few real samples produce a misleadingly precise-looking P50/P85** — mitigated by the
  explicit `insufficient-samples` default above rather than silently reporting a distribution from
  2-3 points as if it were statistically meaningful.

### Non-goals

Not implementing [[DIR-126-A]] through [[DIR-126-D]]'s own mechanisms — this child only aggregates
and reports on their real output. Not a general-purpose analytics/dashboard system — scoped
specifically to the Prepare-stage capacity questions DIR-126's own AC names. LOC/duration are
descriptive output only, never a productivity target (restated from the parent's own Non-goals,
binding on this child specifically since it is the one that produces the report).

## Plan

N/A — directive-class child resolved via a human-steered milestone. Depends on [[DIR-126-A]],
[[DIR-126-B]], [[DIR-126-C]], [[DIR-126-D]] all being `done`, and on >= 3 real post-D preparation
generations existing.

## Finding

1. `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` (confirmed by direct read)
   states "15-25 minutes" with no supporting distribution, sample count, or provenance.
2. DIR-126's own Finding measured M195's real Prepare at ~80 minutes (57 of them PlanCheck alone) —
   directly contradicting the documented assumption, with no checked-in mechanism to reproduce that
   number or track it going forward.
3. No command anywhere under `experiments/quay-perpetual-stream/scripts/` aggregates capacity
   statistics from any artifact today (confirmed via grep for `capacity-report`/`P50`/`P85` across
   the scripts directory — zero matches prior to this child).

## Requested action

1. Add `--capacity-report --telemetry-glob 'milestones/prepare-telemetry/**/*.json'` to
   `milestone-preparation-check.ts` (+ `plugin/scripts/` mirror) per the Chosen mechanism above.
2. Regenerate `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` from the
   command's real output against real post-[[DIR-126-D]] telemetry, replacing the flat 15-25 minute
   assumption with the reproduced distribution, sample provenance, and explicit exclusions.
3. Add real test fixtures: a report over >= 3 real-shaped samples producing correct P50/P85/ratios,
   an insufficient-samples case, a malformed-record-excluded case, overlapping-vs-sequential
   two-generation interval cases, an identical-terminal recomputation case, and a
   `reuse-terminal` zero-content-agent case.
4. Real regression proof: run `--capacity-report` against the real telemetry accumulated from
   [[DIR-126-A]] through [[DIR-126-D]]'s own real landing dispatches (plus this child's own), and
   confirm the throughput doc's numbers trace back to those real, checked-in sample IDs.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `--capacity-report` is a real, reachable CLI mode on `milestone-preparation-check.ts`
  (both mirrors) — not `--selftest`-only reachability. This item alone, if unmet, fails the whole
  child regardless of how many other items pass.
- [ ] **Capacity report is reproducible:** the command, re-run against the same checked-in telemetry
  + receipt artifacts, emits sample count, P50/P85 wall time and summed agent-minutes by
  `class`/`highRisk`/terminal/decision, mechanical-vs-content dispatch work,
  `prepared/attempt`, terminal/decision yield, `absorbed-task/prepare-hour`, concurrent overlap
  minutes, unchanged-terminal recomputation, terminal-reuse hits, and explicit exclusions —
  confirmed via a real `git diff`-visible run, not session transcript prose. The
  throughput-capacity document is updated from that output and no longer asserts 15-25 minutes as
  the general default without supporting current samples.
- [ ] **Sample provenance is real and traceable:** the regenerated throughput doc cites real sample
  IDs a reader can independently locate under `milestones/prepare-telemetry/`, not a bare summary
  number.
- [ ] **Duplicate-generation minutes mean real overlap:** an overlapping two-generation sequence
  for the same `(workspace, taskId)` produces the exact interval-intersection minutes; a sequential
  retry beginning after the prior terminal and a single generation both produce zero.
- [ ] **C efficiency is measured separately:** an identical hash/policy cacheable terminal that is
  recomputed increments `unchangedTerminalRecomputations` and observed wasted content-agent work;
  a correct `reuse-terminal` increments the hit count and records zero content agents. Estimated
  avoided minutes are either reproducibly labeled/model-derived or `unknown`.
- [ ] **Feedback-efficiency inputs are exported, Prepare-scoped:** the report includes
  cold/resume/reuse-terminal agent-minute and token distributions, finding novelty/recurrence,
  recurrence waste, and the raw numerator/denominator fields needed to compute Prepare escape rate
  later. It does not claim end-to-end verified value or an Execute escape rate from Prepare-only
  evidence.
- [ ] The machine-readable report preserves raw sample IDs, stage/terminal strata, exclusions, and
  unknowns so a later Prepare-to-post-Land evaluation can consume it without scraping the
  regenerated prose document.
- [ ] **Insufficient-sample honesty:** a fixture with fewer than 3 samples produces the explicit
  `insufficient-samples` result, not a misleadingly precise distribution.
- [ ] Canonical and `plugin/` mirrors of `milestone-preparation-check.ts` and its test file are
  byte-identical — `cmp`/`sync-vendor.sh --check`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real, non-fixture `--capacity-report` run against real post-[[DIR-126-D]] telemetry is
  exercised end to end with command output, not asserted, and the throughput doc is regenerated
  from that real output.
- [ ] At least three post-change real preparation generations of different terminal shapes
  (inherited from the parent's own DoD) are the real sample set this child's report is proven
  against — not a synthetic-only demonstration.
- [ ] The real sample set includes or is supplemented by C's real `reuse-terminal` proof, and the
  report demonstrates zero content-agent work for that decision without weakening independent
  review for cold/resume generations.
- [ ] A fresh independent audit confirms the report's numbers trace back to real, checked-in
  telemetry artifacts, not session prose or hand-edited documentation.

## Human verification when exp5 marks this DIR done

1. Can capacity and bottleneck conclusions now be reproduced without inspecting private Claude
   session logs?
2. Does the throughput doc's own provenance let a reader independently verify the numbers against
   real checked-in artifacts?
3. Are concurrent overlap and unchanged-terminal recomputation both zero after A/C enforcement
   (or every exception explicitly identified), without misclassifying valid sequential retries?
4. Does the report expose reusable cost/recurrence inputs without pretending Prepare-only
   telemetry measures complete delivered value?

## Touches

- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts`
- `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
- `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`
