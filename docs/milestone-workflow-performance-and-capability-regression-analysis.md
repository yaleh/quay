# Milestone workflow performance and capability-regression analysis

- **Status:** evidence-backed analysis; no runtime behavior is changed by this document.
- **Date:** 2026-07-28
- **Scope:** M185–M189 wall time, Build-phase critical paths, and capabilities lost or
  disconnected while `OUTER-LOOP.md` steps 4–7 were migrated into
  `execute-milestone.js`.
- **Primary implementation:** `.claude/workflows/execute-milestone.js` and its byte-identical
  `plugin/workflows/execute-milestone.js` mirror.
- **Related design:** `quay-milestone-workflow-stage-pipelining-and-leases.md`.

## 1. Executive summary

The six measured milestones were not slow for one reason. Their wall time combines:

1. necessary implementation work, especially M188 iteration 0 and M189;
2. Build and Audit independently repeating large test surfaces;
3. several canonical full-suite attempts being moved into the background by the Claude
   Bash tool's foreground timeout and then accidentally started again;
4. CPU/disk contention between concurrently active milestones;
5. fixed evidence, Audit, Gate, and Land costs that dominate small fixes; and
6. workflow capabilities that existed before or during the initial migration but were
   removed, only partially relocated, or left unwired.

The most important capability regression is now explicit and tracked by `DIR-123`:
ordinary `execute-milestone` Build agents edit and commit directly in the shared primary
checkout. Commit `4191a31` removed `isolation: 'worktree'` so that Audit and Gate could see
Build's changes. This repaired the immediate sequential pipeline by deleting the isolation
boundary instead of threading the candidate worktree/commit through later phases. As a
result, task-level `## Touches` orthogonality does not make two workflow dispatches safe to
run concurrently.

The next largest confirmed losses are:

- the Build prompt no longer performs real class routing;
- the development-class proposal→checked-Plan route is only being reintroduced through
  the new opt-in Prepared phase and is not yet mandatory;
- methodology/design milestones no longer receive independent dual iterations;
- the explicit TDD ≥80% and inner termination contracts disappeared;
- three Gate checks removed by DIR-097 were not all relocated to fan-in as promised;
- Verify caching exists in the workflow but is inert because callers do not supply or
  persist fingerprints/cache state;
- composite phase-DAG Build, read-only audit shards, deterministic Reconcile, and
  composite Land are still a fixture-tested island rather than the live execution path;
  this is already tracked by `DIR-119-D`; and
- the canonical full suite has no cross-workflow resource semaphore or single-run receipt,
  so higher milestone concurrency currently creates duplicated tests and timeout failures.

## 2. Sources and evidentiary limits

### 2.1 Workflow journals

The phase measurements come from:

```text
~/.claude/projects/-home-yale-work-quay/
  13efe277-45ff-4563-bcfe-fd2c3db3e2a5/workflows/
```

| Milestone | Workflow journal |
|---|---|
| M185 | `wf_08b323b0-52b.json` |
| M186 | `wf_2b0023f7-862.json` |
| M187 | `wf_6a22dc03-87a.json` |
| M188 iteration 0 | `wf_8e313652-b9d.json` |
| M188 iteration 1 | `wf_96e4cae2-0ad.json` |
| M189 | `wf_4f32d70f-1d7.json` |

The corresponding `agent-*.jsonl` files were inspected for the exact Build tool calls,
timestamps, commands, foreground timeouts, background-process polling, edits, test runs,
and commits.

### 2.2 Git history

The most relevant transition commits are:

| Commit | Meaning |
|---|---|
| `d9e7f18` | Initial migration of OUTER-LOOP steps 4–7 into `execute-milestone.js` |
| `a8bc64d` | Restored seven groups of invariants omitted by the initial migration |
| `6b0765e` | Attempted background Build dispatch plus script-body coordination |
| `549a3c3` | Replaced background inner-iteration dispatch with a synchronous Build agent |
| `4191a31` | Removed Build worktree isolation so Audit/Gate could see the result |
| `0282f0d` | Removed acceptance, impl-row, and audit-independence from Workflow Gate |
| `cf8b944` | Added per-check Verify cache protocol via workflow args |
| `082c69f` | Restored timeout discipline accidentally removed by `cf8b944` |
| `49995b1` | Added composite contracts/modules and prompt-level workflow guidance |
| `ea63c05` | Added the opt-in Prepared phase and lightweight `kind=gap` schema tier |

The raw Claude Code session files retained locally begin after the two critical
`549a3c3`/`4191a31` commits, so their original conversation is no longer available for
direct reconstruction. Their commit messages, before/after source, downstream task
resolutions, later workflow journals, and the retained 2026-07-28 session establish the
behavioral facts. The later session explicitly re-read the current workflow, observed no
worktree creation, and promoted the issue to `DIR-123`.

## 3. Measured phase distribution

Verify contains parallel agents, so its duration below is the longest Verify critical
path, not the sum of every agent.

| Milestone | Verify | Build | Audit | Gate | Land/handling | Build+Audit |
|---|---:|---:|---:|---:|---:|---:|
| M185 / DIR-116 | 1.60m | 25.13m | 10.14m | 0.34m | 7.82m | 77% |
| M186 / DIR-120 | 1.22m | 47.78m | 27.30m | 0.50m | 1.66m | 95% |
| M187 / gap-halt | 1.32m | 14.23m | 7.02m | 0.55m | 6.73m | 70% |
| M188 iteration 0 | 1.80m | 52.31m | 8.72m | 0.76m | 1.17m | 93% |
| M188 iteration 1 | 1.22m | 26.94m | 7.94m | 0.45m | 5.99m | 81% |
| M189 / DIR-119-B | 2.26m | 40.87m | 37.39m | 0.60m | 6.60m | 88% |

Workflow volume:

| Milestone | Workflow tool calls | Workflow tokens |
|---|---:|---:|
| M185 | 256 | 723,365 |
| M186 | 471 | 918,481 |
| M187 | 208 | 659,610 |
| M188 iteration 0 | 276 | 832,659 |
| M188 iteration 1 | 268 | 822,114 |
| M189 | 493 | 1,061,465 |

Audit often repeats Build's tests rather than consuming hash-bound Build receipts and
performing only independent, high-information refutations. M189 is the extreme: Audit
used 37.4 minutes and 184 tool calls, nearly matching Build's 40.9 minutes and 202 calls.

## 4. Build-phase critical-path analysis

### 4.1 Summary

| Milestone | Build | Calls | Tokens | Commit size | Dominant cause |
|---|---:|---:|---:|---:|---|
| M185 | 25.13m | 89 | 134K | 6 files, `+310/-11` | repeated/background full suites; reporting |
| M186 | 47.78m | 284 | 332K | 7 files, `+673/-3` | three full-suite attempts and failure attribution |
| M187 | 14.23m | 83 | 123K | 4 files, `+239/-12` | fixed workflow tax on a ~1-minute fix |
| M188 i0 | 52.31m | 167 | 309K | 25 files, `+3936/-6` | large implementation plus full-suite triage |
| M188 i1 | 26.94m | 134 | 231K | 9 files, `+771/-22` | follow-up re-runs nearly the entire surface |
| M189 | 40.87m | 202 | 308K | 29 files, `+4440/-57` | large implementation plus contended full suite |

### 4.2 M185

The Build agent started with the substantive scheduler/test diff already present. It
validated the dirty diff, fixtures, 23 sibling tests, and RED/GREEN replay, rather than
spending most of the interval authoring code.

It then launched `scripts/test.sh` multiple times:

- two calls hit the Bash tool's 120-second foreground limit and continued in the
  background;
- multiple `test.sh`/`node --test` processes coexisted;
- the agent spent time polling PIDs and output files;
- it eventually killed the inherited test processes and launched another canonical
  suite; and
- the final suite was still being monitored while evidence and the commit were produced.

The 25 minutes were therefore primarily test-process lifecycle, evidence-path discovery,
and report/commit work. This is the clearest example of “foreground timeout” being
mistaken for “test ended,” followed by a duplicate run.

### 4.3 M186

Approximate critical path:

| Segment | Wall time |
|---|---:|
| Trace configuration readers, drivers, gate registry, and symlink behavior | ~9m |
| Implement checker, 15 selftests, selfcheck, config changes, fail-closed halt | ~5–6m |
| Targeted select-preflight and loop-params tests | ~1m |
| Full-suite attempts, polling, isolated retries, failure attribution | ~30m |
| Final evidence update and commit | ~1m |

Two full-suite attempts were truncated by an outer foreground/wrapper timeout before a
third run completed all 537 tests. The completed run still had one pre-existing packaging
failure that required attribution. Coding was roughly 10–15% of Build wall time; test
execution and diagnosis were roughly 60–65%.

### 4.4 M187

The two core edits were made in about 75 seconds. RED/GREEN, DoD evidence, the full
31-test select-preflight surface, the canonical suite, the iteration report, and commit
consumed the remainder.

M186 and M187 started almost simultaneously in the same primary checkout. Their source
touches were mostly independent, but their test processes competed for the same CPU and
disk. A select-preflight run that took about 28 seconds earlier took about 72 seconds
under contention; the full suite moved into the background after 120 seconds. M187 is
the clearest example of a small code change paying a large fixed workflow tax.

### 4.5 M188 iteration 0

Approximate critical path:

| Segment | Wall time |
|---|---:|
| Design/pattern inspection | ~2m |
| Five core modules, fixtures, integration, SELECT wiring, mirrors | ~17m |
| Full-suite execution and waiting | ~24m |
| Fix two real ADR-001 sibling-test regressions | ~4m |
| Isolate six resource-timeout failures | ~4m |
| Final report/commit | ~1–2m |

The first 19 minutes produced most of 3,936 inserted lines. The long tail began only
after the canonical suite. Two failures were real: load-bearing modules lacked exact-name
sibling test files. Six failures were contention-induced timeouts and passed in isolation.

Running `loadbearing-test-gate.sh` immediately after creating each load-bearing module
would have found the two real regressions before paying for a full suite.

### 4.6 M188 iteration 1

The agent spent about five minutes re-reading the audit/AC gap, about five minutes
implementing cadence/dependency constraints and tests, and the remaining interval
re-running sibling tests, mirror/packaging checks, the live store, DoD, and canonical
suite.

This follow-up changed a narrow surface but received no evidence reuse from iteration 0.
The journal's `verifyCacheUpdates` was empty, and the workflow had no changed-file
invalidation protocol for Audit/Gate/Land. The result was 26.9 minutes for a fix whose
core implementation took roughly 4–5 minutes.

### 4.7 M189

Approximate critical path:

| Segment | Wall time |
|---|---:|
| Read contracts, workflow DSL, schema, mirrors, prior M188 output | ~6m |
| Generate composite modules and sibling tests | ~7m |
| Preflight, packaging, and workflow wiring | ~7m |
| Canonical suite under resource contention | ~18m |
| Isolated delivery/typecheck reruns | ~2.5m |
| Final evidence and commit | ~1m |

M189's code-generation throughput was high: 4,440 inserted lines across 29 files in a
40.9-minute Build. Three 60-second failures in the canonical suite were reproduced as
passes when the delivery and typecheck files ran in isolation. The avoidable part is
test scheduling, not implementation throughput.

## 5. Capability-regression timeline

### 5.1 Initial migration already omitted behavior

`d9e7f18` replaced roughly 356 lines of executable operator guidance with a 171-line
workflow. Forty minutes later, `a8bc64d` had to restore omitted invariants found by a
validation agent:

- dogfood evidence gate;
- `extra.acceptance` seeding;
- long-Build poll/wait discipline;
- deviation-log write-back;
- split-or-commit enforcement;
- explicit CONCERNS handling;
- needs-human reason validation;
- execution-provenance write-back;
- phi consolidation; and
- fail-closed handling for missing agent results.

This demonstrates that the migration was not behavior-preserving on its first pass. It
also means later “workflow exists” checks cannot establish parity with the old
OUTER-LOOP contract; each capability needs a production callsite or mechanical gate.

### 5.2 Synchronous Build removed more than background dispatch

`549a3c3` fixed a real runtime incompatibility: an agent running inside a Workflow could
not dispatch the harness-tracked background inner iteration assumed by DIR-074.

However, the replacement changed much more than coordination:

| Removed behavior | Current state |
|---|---|
| Development vs methodology/design class routing | Build prompt unconditionally says development-class |
| Mandatory proposal→checked-Plan before development | Prepared phase is opt-in; omitted receipt is accepted pending DIR-117-B |
| Methodology/design independent dual iteration | No equivalent live path |
| `baime:iteration-executor` specialization | Replaced by a general Build agent |
| TDD ≥80% hard gate | Replaced by generic “run tests” instruction |
| Five inner termination conditions | No live termination evaluator in Build |
| Background result identity (`harnessTaskId`, worktree path) | Removed from schema |
| Adaptive hang-detection protocol | Closed as moot after synchronous Build |

The inability to nest a background agent is a real Workflow-runtime limitation. It does
not imply that the semantic contracts in the other rows had to disappear. Nor does it
prevent the top-level orchestrator from dispatching several synchronous milestone
workflows concurrently once each owns an isolated worktree.

DIR-117/117-B is the partial restoration path for development preparation. No current
task was found that explicitly restores methodology-class dual iteration, the TDD
coverage threshold, or the termination contract.

### 5.3 Worktree isolation was removed instead of propagated

`4191a31` changed one option:

```diff
- { phase: 'Build', isolation: 'worktree',
+ { phase: 'Build',
```

Its commit message states the reason: Build changes in the isolated worktree were not
visible to Audit/Gate in the primary checkout. The sequential pipeline was repaired by
removing isolation rather than by returning a candidate commit/worktree path and making
Audit/Gate consume it.

Consequences:

- two Builds cannot safely overlap even with disjoint task touches;
- Audit/Gate can observe unrelated dirty primary-checkout state;
- a failed Build can leave shared uncommitted state;
- concurrent-mode Land still talks about merging a worktree that Build did not create;
- the scheduler's touches proof is disconnected from checkout isolation; and
- all potential cross-milestone stage pipelining is blocked at Build.

This is confirmed by M187–M191 journals and is tracked by `DIR-123`.

### 5.4 DIR-097 removed three gates but did not complete the relocation

`0282f0d` removed:

- acceptance/DoD meta-enforcer;
- impl-row; and
- audit-independence

from the Workflow Gate because they repeatedly failed inside workflow subagent
environments. The task and commit said they would run at outer-loop fan-in instead.

M145's independent Audit immediately found that the relocation was incomplete.
The current `OUTER-LOOP.md` fan-in runs audit-independence and anti-drift for concurrent
survivors, but it still does not run acceptance or impl-row. The serial path does not
pass through fan-in, so it also lacks the relocated audit-independence check.

The Audit agent does run `it0-dod-check.sh` itself, which recovers part of the acceptance
coverage, but this is not equivalent to a separate post-Audit Gate:

- the audited actor executes the gate used to validate its own write-back;
- serial Audit independence is not mechanically enforced at the current Land boundary;
- the documented “7 gates” and the implementation's current five-ish checks disagree.

This is a confirmed, still-open relocation gap, not merely stale prose.

### 5.5 Verify cache is implemented but operationally inert

`cf8b944` added the `cacheFingerprints`, `priorVerifyCache`, and
`verifyCacheUpdates` protocol. The Workflow runtime cannot read/hash inputs itself, so
the caller must compute fingerprints and persist returned updates.

Current callsites in `OUTER-LOOP.md` pass only task/charter/absorb/preparation fields.
No production caller supplies `cacheFingerprints` or `priorVerifyCache`, and the M185–
M189 journals all returned:

```json
{"verifyCacheUpdates": {}}
```

Therefore every retry and follow-up iteration performs a cold Verify. DIR-079's code
exists, but its performance capability is not wired end to end.

### 5.6 Composite execution contracts are not the live execution mechanism

M189 added `composite-build.ts`, `composite-audit.ts`,
`composite-reconcile.ts`, and `composite-land.ts`, but:

- Build remains one monolithic agent;
- Audit remains one monolithic, write-capable agent;
- there is no live Reconcile phase;
- manifests are hand-authored rather than synthesized from SELECT output; and
- per-task Gate failure is attributed to `_primaryTaskId`.

This is already fully captured by `DIR-119-D` and should not be duplicated as a new
task. It directly limits both correctness and concurrency: a read-only audit shard could
run widely in parallel, whereas the current Audit mutates tasks, absorb state, and
dashboard rows.

### 5.7 Test execution lost isolation at the resource layer

Worktrees would isolate source state, but not CPU, memory, ports, package caches, or
test workers. `scripts/test.sh` defaults to file concurrency 8. Concurrent milestones
can each launch their own eight-way full suite, and foreground timeout handling can
accidentally produce two suites within one Build.

Observed consequences:

- M186 required three canonical-suite attempts;
- M187 tests slowed while M186 ran;
- M188 iteration 0 had six contention timeouts;
- M189 had three contention timeouts and then spent ~132 seconds on isolated proof;
- M188 iteration 1 repeated a full suite for a narrow follow-up; and
- Build and Audit can each run the full suite against the same commit.

The stage-pipelining proposal already specifies resource semaphores, but no live global
full-suite semaphore or commit-bound authoritative test receipt exists. `DIR-112` also
tracks an independent hotspot: `cli.test.mjs` is about 236 seconds under the full
contended suite versus 109 seconds alone.

### 5.8 Path and invocation single-source regressions

Two current gaps amplify workflow cost and weaken safety:

1. `gap-build-phase-iteration-evidence-path-not-single-sourced`: Build hand-derives the
   evidence path while Audit/Land call `gate_resolve_milestone_root`. M179, M185, and
   M188 required after-the-fact moves.
2. `gap-touches-orthogonality-symlink-isdirect-mismatch`: five experiment-side symlink
   entrypoints silently no-op because `process.argv[1]` is compared to the real module
   path without `realpath`. This includes touches/anti-drift and fan-in infrastructure.

The second gap must precede `DIR-123`: real worktree concurrency must not rely on a
pre-dispatch or pre-merge safety check whose documented symlink invocation can silently
exit 0.

### 5.9 Documentation and executable contract drift

Several current descriptions still encode removed behavior:

- workflow `meta.description` advertises a `"building"` outcome that no active code path
  returns;
- Build's phase description still says “class-route + dispatch inner iteration”;
- `OUTER-LOOP.md` says Build uses an isolated worktree;
- `OUTER-LOOP.md` says seven Gate agents run;
- `OUTER-LOOP.md` says phases are cached/resumable, while per-check cache args are not
  supplied and external-state resume is explicitly unsafe;
- Land tells the agent to merge/prune an iteration worktree even on the default path
  where none exists; and
- the 2026-07-27 stage-pipelining proposal originally described worktree isolation as a
  current capability.

These are not cosmetic: they caused concurrency decisions to be made from capabilities
the executable path did not have.

## 6. Current recommendation order

After the current `DIR-117` / `DIR-122` / `DIR-119-D` / `DIR-119` chain completes, use
this order:

1. **`gap-touches-orthogonality-symlink-isdirect-mismatch`** — first. `DIR-123`
   depends on the touches and anti-drift checks being real through their documented
   invocation paths.
2. **`DIR-123` — real per-milestone worktree isolation** — high priority,
   immediately after the symlink/entrypoint fix.
3. **`gap-drain-dispose-body-corruption`** — completely disjoint from `DIR-123`;
   it may run between items 1 and 2, after them, or concurrently once a safe isolated
   execution path is available.
4. **`gap-build-phase-iteration-evidence-path-not-single-sourced`** — remove the
   recurring Build evidence-path repair tax.

This ordering is a dependency/safety order, not a value ranking:

- item 1 makes concurrency admission and anti-drift enforcement trustworthy;
- item 2 unlocks actual cross-milestone overlap;
- item 3 protects task bodies and can exploit disjoint execution;
- item 4 removes a recurrent but bounded evidence-path defect.

## 7. Follow-on gaps after the four-item sequence

These findings should be reconciled with existing tasks before filing anything new:

1. **Finish DIR-097's promised Gate relocation.** Define exactly where acceptance,
   impl-row, and audit-independence run for both serial and concurrent paths. Prefer a
   short fenced Reconcile/Land transaction rather than returning them to a context-poor
   workflow subagent.
2. **Wire DIR-079 cache end to end.** The caller must compute fingerprints, persist
   cache updates, and pass prior results. Add a real retry demonstration; code-path-only
   evidence has already proven insufficient.
3. **Add one authoritative full-suite receipt per candidate commit.** Build may produce
   it; Audit should validate its hashes and run risk-based independent samples instead of
   repeating the entire suite by default.
4. **Add a workspace-level heavy-test semaphore.** This is complementary to worktrees.
   Separate limits are needed for full suite, browser/port tests, package builds, and
   ordinary focused tests.
5. **Execute DIR-112 or otherwise address the CLI test hotspot.** Do not compensate for
   a 236-second contended file only by increasing timeouts.
6. **Restore or explicitly retire the semantic contracts removed with synchronous
   Build.** Decide separately for methodology dual iteration, TDD coverage threshold,
   and inner termination conditions; do not silently conflate them with the unsupported
   nested-background mechanism.
7. **Make documentation mechanically reflect the executable workflow.** At minimum,
   check phase names, supported outcomes, Gate labels/count, isolation mode, cache
   caller wiring, and worktree merge semantics.

## 8. Target architecture implied by the evidence

The evidence supports this boundary:

```text
top-level scheduler
  ├─ admits candidates using realpath-safe Touches/semantic-resource checks
  ├─ creates one worktree + candidate identity per milestone
  ├─ limits full-suite/browser/build resources with workspace semaphores
  └─ pipelines several milestone workflows

candidate workflow
  Prepare → Verify → Build → read-only Audit → local Gate
              │         │          │             │
              └──────── immutable, hash-bound receipts ────────┐
                                                               ▼
shared-checkout owner
  revalidate base + actual diff → deterministic Reconcile → atomic Land
```

Only the final shared-checkout owner should mutate lifecycle state, dashboard/backlog,
milestone counter, and master. Worktrees solve checkout collision; receipts eliminate
duplicate verification; semaphores solve resource collision; Reconcile separates
evidence production from state mutation.

## 9. Expected performance effect

Without reducing test coverage:

- M185/M187-like small fixes should fall most sharply because worktree setup and focused
  tests can overlap other milestones while fixed Land work remains short and serial;
- M186-like milestones should avoid duplicate canonical runs and incorrect timeout
  retries;
- M188 follow-ups should reuse unaffected Verify/Audit receipts through changed-input
  invalidation;
- M188 iteration 0/M189-like large implementations retain their necessary coding time
  but lose much of the contended full-suite and duplicate-Audit tail; and
- throughput improves only if worktree concurrency is paired with resource semaphores.
  Worktrees alone would make source concurrency safe while allowing every workflow to
  overload the same four-core host.

Conservative expected Build reductions from the measured traces:

| Milestone shape | Plausible reduction |
|---|---:|
| Small fix with full workflow tax (M185/M187) | 30–60% |
| Follow-up iteration with narrow invalidation (M188 i1) | 30–50% |
| Medium implementation with repeated suites (M186) | 30–50% |
| Large implementation (M188 i0/M189) | 20–35% |

These ranges are hypotheses to measure after `DIR-123`, cache wiring, and the full-suite
semaphore land. They are not acceptance evidence by themselves.
