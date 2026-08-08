#!/usr/bin/env bash
# capability-catalog.sh — gap-eighty-two-shipped-checks-and-none-says-what-it-answers.
# A CAPABILITY CATALOG: every shipped check declares what QUESTION it makes askable.
#
# Organizing principle (the human's ruling, kept as the screening criterion):
#    一个能力 = 让一个原本不可机械提问的问题，变得可提问。
#    A capability = making an originally-unaskable question askable.
#    A checker that answers no question is not a capability — it is repo lint.
#
# The problem this kills: 82 scripts ship and not one declares what question it
# answers — capability was never missing, VISIBILITY was. A project installs quay and
# gets dozens of checks with nothing telling it what each one answers.
#
# ── The machine-readable field (AC1a) ─────────────────────────────────────────────
# Each delivered check has ONE machine-readable line declaring the question it makes
# askable. The field lives IN A SCRIPT (this one), never in the README (README drifts).
# The declaration table below is the SINGLE SOURCE OF TRUTH: `file` → the question it
# answers. The check set itself is DERIVED from the filesystem (the contract's
# `ls plugin/scripts/*.{sh,ts,mjs}` glob), never a hardcoded "82".
#
# ── The entry-point gate (AC1c) ───────────────────────────────────────────────────
# A new script entering the artifact that has NO declaration line here is reported as
# unclassified (`question: null`) and this script EXITS NON-ZERO. That is the mechanical
# "field must be present the moment a script enters the artifact" requirement — the only
# thing that stops the unclassified number growing before visibility exists. The catalog
# itself is in the table (it is the 87th check).
#
# ── The screening (AC2) ────────────────────────────────────────────────────────────
# NOT_SHIPPED below lists the exp5-legacy scripts whose existence is motivated only by
# THIS repo's history — they answer questions a target project does not ask. They are
# judged `ships: false` (do not ship with the artifact). The three named families
# (codex-stage1-selfcheck, it0-enforcement-with-design-check, audit-independence-check)
# must be so judged (AC2) — and they already do not ship under the derived LOOP_SCRIPTS.
#
# Usage:
#   bash plugin/scripts/capability-catalog.sh            # human-readable catalog
#   bash plugin/scripts/capability-catalog.sh --json     # machine-readable JSON array
#   bash plugin/scripts/capability-catalog.sh --table    # explicit human table
#   bash plugin/scripts/capability-catalog.sh --summary  # one summary line only
#   bash plugin/scripts/capability-catalog.sh --entry-surface [--summary|--json]
#                                                        # .sh delivery-form gate (AC3):
#                                                        #   every consumer-doc-referenced .sh must be
#                                                        #   declared public; exit 1 on a violation
#
# Exit status: 0 when every shipped check declares its question (unclassified == 0)
# AND (in --entry-surface mode) no internal .sh is referenced by consumer-facing docs;
# 1 when any check is unclassified (AC1c gate) or the delivery-form gate fails (AC3).
# The `--json` mode uses the same AC1c gate.
#
# Output shape (--json): a top-level JSON array of
#   {"file": "<basename>", "question": "<question>" | null, "ships": true|false}
# so the contract's measures work verbatim:
#   declared_questions = --json | jq '[.[]|select(.question)]|length'
#   shipped_checks     = ls plugin/scripts/*.{sh,ts,mjs} | wc -l
#   unclassified       = --json | jq '[.[]|select(.question==null)]|length'   (band 0)

set -euo pipefail

# Self-locate: works in the repo (plugin/scripts/capability-catalog.sh) AND in an
# installed target project (the laid-down copy at <workspace>/plugin/scripts/).
SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || true)"

# ── capability declarations (AC1a: ONE machine-readable line per shipped check) ────
# Format: [<basename>]="<the question this check makes askable>"
# A script missing here is UNCLASSIFIED → the catalog exits 1 (AC1c gate). Phrase each
# as a specific QUESTION, never the generic "checks correctness" (AC5 negative control:
# a catalog where every entry says "checks correctness" is indistinguishable from none).
declare -A QUESTION=(
  [adr016-screen-use-check.ts]="Is this tmux remote-drive usage compliant with ADR-016's screen-use carve-out?"
  [anti-drift-touches-check.ts]="Did the landed change touch exactly the files the task's ## Touches declared (and nothing else)?"
  [anti-gaming-guard.sh]="Is a candidate value surface machine-verifiable, capped and un-inflatable (no subjective gaming of the chart)?"
  [anti-gaming-guard.ts]="Is a candidate value surface machine-verifiable, capped and un-inflatable, with residual headroom adjudicated?"
  [assert-clean-tree.sh]="Is the working tree clean after a full-suite run?"
  [audit-independence-check.sh]="Is the audit gate independent of the contestant it judges?"
  [audit-independence-check.ts]="Is the audit gate independent of the contestant it judges (canonical implementation)?"
  [axis-generator.ts]="What range does each standing criterion quantify (time/scope/layer/instance/cost), and which axes remain unopened?"
  [build-evidence-collector.ts]="What evidence did the Build phase deterministically produce?"
  [build-evidence-gate.ts]="Is the Build evidence manifest valid before the Audit phase may proceed?"
  [build-evidence-manifest.ts]="Is a BuildEvidenceManifest well-formed?"
  [blocked-signal-check.sh]="Is an un-consumed blocked signal auto-escalated after the timeout window (no indefinite inner freeze)?"
  [candidate-contracts.ts]="Do the SELECT candidate contracts conform to their versioned schema?"
  [candidate-synthesis.ts]="Which milestone candidates does the coupling graph surface for the next cycle?"
  [cap-from-gate.sh]="What cap should the loop use for in-flight agents at the dispatch point (bash invocation of the adaptive-cap module)?"
  [cap-from-gate.ts]="What cap should the loop use for in-flight agents at the dispatch point (adaptive cap = f(resource-gate some avg300, hysteresis banded, no fixed cap)?"
  [capability-catalog.sh]="What question does each shipped check make askable, and is every check declared?"
  [manager-adopt.sh]="Is a project adopted into the manager's scope (healthy → noop, empty-shell → drive, missing → build the two-window topology)?"
  [manager-arm-loop.sh]="Is the manager's scheduling anchor armed (sentinel-clean + idempotent, zero-memory executable)?"
  [manager-observation-runtime-check.ts]="Does the outer session's runtime behavior observe/check the manager (PANE / TICKLOG / transcript reads) in violation of C3's never-create/drive/check constraint?"
  [manager-start.sh]="What does the manager's own start command do, independent of any single project (identity = cross-project, its own session + home)?"
  [manager-tick-log-check.sh]="Did the manager's previous tick leave a row in the tick log (the mechanical 'last tick didn't log' detector)?"
  [manager-tick-readings.ts]="What are the manager's tick readings (three-project state / resources / outer liveness / tick log / monitor versions) as one command?"
  [no-manager-tick-doc-check.ts]="Do the outer tick docs contain any create/drive/check manager step (C3 mechanical gate, by position not keyword)?"
  [quay-branch.ts]="Which branch/claim instrument does the consolidated branch/claim entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-check.ts]="Which task/document validation instrument does the consolidated check entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-deliver.ts]="Which delivery/preempt instrument does the consolidated deliver entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-dispatch.ts]="Which dispatch/concurrency instrument does the consolidated dispatch entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-entry-base.ts]="What is the shared dispatcher framework that the six grouped instrument entry points use to preserve each member's CLI byte-for-byte?"
  [quay-session.ts]="Which session/topology instrument does the consolidated session entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-suite.ts]="Which suite/gate instrument does the consolidated suite entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [suite-cutoff-verdict.mjs]="Is a full-suite log's failure class heavy-file at-risk / genuine dangling-Promise / cascade-victim, and which files are at-risk?"
  [checker-cost.sh]="What does each checker/gate execution actually cost — ms, its size dimension n, and the machine load at that moment (the pure-append cost ledger)?"
  [checker-cost-lib.sh]="Does a bash static-check invocation record its criterion's wall-clock cost (append-only, zero-judgment)?"
  [checker-cost.ts]="Did the checker record its own criterion cost to the checker-cost JSONL (pure-append, zero-judgment)?"
  [checker-mutation-check.sh]="Would each checker actually fail when its subject is mutated (the L_S instrument)?"
  [claim-task.sh]="Is a task/branch claimed by a specific machine (claim protocol, atomic CAS push)?"
  [claim-task.ts]="Which branch should a candidate task fork from under multi-machine claims (decideClaim)?"
  [codex-stage1-live-proof-check.ts]="Is there live, internally-consistent proof that a Codex Stage-1 session did real authorized work?"
  [codex-stage1-selfcheck.sh]="Is the DIR-121 Codex-adoption Stage-1 mechanical self-check satisfied?"
  [concurrent-batch-scheduler.ts]="Which ready tasks can be dispatched concurrently without touching overlapping files?"
  [config-wiring-check.ts]="Does every declared config field have exactly one wirer?"
  [coupling-graph.ts]="Which tasks are coupled by shared touches?"
  [dead-code-after-return-check.ts]="Does any shell function have executable statements AFTER a top-level return (dead code — the 2026-08-03 concurrency-pin shape)?"
  [dead-loop-check.sh]="Is a target project's loop alive or dead (L2 continuous-health: transcript user-msg or git commit window)?"
  [dead-loop-check.sh]="Is the loop ACTUALLY RUNNING (L2 continuous health) — a recent transcript user message or git commit in the last N minutes, INDEPENDENT of backlog emptiness (dead-loop vs healthy-idle)?"
  [derive-touches-heuristic.ts]="When a task body lacks a ## Touches section, what globs would a cheap scheduling-time heuristic derive for it?"
  [drivable-workspace-check.sh]="Is the workspace drivable by a loop (safe to hand to an autonomous driver)?"
  [drivable-workspace-check.ts]="Is the workspace drivable by a loop (canonical fail-closed gate)?"
  [drive-contract-check.ts]="When a drive text asserts a task order (X→Y), does it attach the checkTouchesPair output in the same text?"
  [execution-policy.ts]="Is an execution policy versioned and authorized for activation (minimal substrate for finding back-propagation)?"
  [fast-mode-telemetry.ts]="What did the fast mode actually do (telemetry events over a window)?"
  [fork-baseline.ts]="Should a task fork from develop or integration (dependency-based fork baseline)?"
  [finding-backpropagate.ts]="Should a finding be back-propagated to the earliest detector that could have caught it (Prepare/Execute feedback)?"
  [full-suite-runner.ts]="Is the full suite green, red, or still running, who ran it, and how long did it take (outer background async runner)?"
  [gate-dispatch-coverage.ts]="Is every registered gate dispatched somewhere (coverage report)?"
  [gate-script-base.ts]="Do TypeScript gate scripts share the framework primitives they need?"
  [git-lens-l-d-code-doc-ratio.ts]="How far is L_D (code:doc line-increment ratio) from its convergence target (ADR-007 lens)?"
  [git-lens-l-g-structural-drift.ts]="How much has the structure drifted from the generative-alignment baseline (ADR-007 L_G lens)?"
  [git-lens-l-s-behavior-variance.ts]="How stable is behavior under light mutation (ADR-007 L_S lens)?"
  [gate-script-lib.sh]="Do bash gate/selfcheck scripts share the framework primitives they need?"
  [inner-blocked-signal.ts]="Is the inner layer explicitly signalling that it is blocked?"
  [inner-forensics.mjs]="Did the inner layer run a given command, at second-granularity, with zero CPU interference?"
  [inner-idle-log.ts]="Why was the inner layer idle (append-only reason log)?"
  [inner-panel-stale-check.ts]="Is an agent line still on the panel after its bracket closed (ended-vs-running state transition, frozen-timer detection)?"
  [inbox-reader.sh]="Does the human channel's manager inbox have a mechanical reader that consumes every delivered message (delivered ≠ read otherwise)?"
  [inner-session-check.sh]="Is the inner session healthy / empty-shell / missing (three-state cold-start self-check)?"
  [instrument-failure-check.ts]="Which of the manager's five documented instrument-failure families does each shell command in the tick docs exhibit (grep self-match, zero-hit-as-absent, pipe-then-exit-status, ...)?"
  [integration-batch-merge.sh]="Can integration be batch-merged into develop (fast-forward + CAS, fail-closed)?"
  [integration-branch-model.ts]="Which ref should a task fork from — develop (independent) or integration (declared dependency / overlapping unverified work) — and is the integration→develop batch merge fast-forward-safe?"
  [it0-enforcement-with-design-check.sh]="Is every enforced rule backed by a design that explains it (ADR-011)?"
  [it0-enforcement-with-design-check.ts]="Is every enforced rule backed by a design that explains it (canonical gate)?"
  [it0-impl-row-check.sh]="Is every implementation row in a design-only milestone accounted for?"
  [it0-split-or-commit-check.sh]="Did the task either split or commit (no limbo)?"
  [it0-split-or-commit-check.ts]="Did the task either split or commit (single-source enforcement)?"
  [known-load-sensitive.ts]="Which test files are KNOWN-LOAD-SENSITIVE family members, and which kind (wall-clock / nested-spawn) does each declare?"
  [laydown-set-check.sh]="Is the cold-start derived-laydown-set green (lay-what-you-verify)?"
  [l1-delivery-surface-check.ts]="Is the SIX-category delivery surface complete — every category has a deliverable and its owning gap task is filed (SPEC §6 machine-readable list)?"
  [laydown-set-check.sh]="Are all scripts in the derived cold-start laydown set present, syntactically valid, and green (gate = lay what you verify)?"
  [loadbearing-test-gate.sh]="Is the load-bearing test present and passing before the milestone may land?"
  [loadbearing-test-gate.ts]="Is the load-bearing test gate satisfied (canonical implementation)?"
  [load-sensitive-release-check.ts]="Is every file being released from a red-window isolation-pass carrying the predeclared KNOWN-LOAD-SENSITIVE marker (predeclared load-sensitivity, not post-hoc isolation-pass release)?"
  [loop-driver-check.sh]="Is exactly one loop driver running, and is it the sanctioned cron?"
  [loop-shipping-exclusion-data.mjs]="What are the single-source old-path and exclusion entries that the loop-shipping scan and its inert-entry necessity check must not disagree on?"
  [measure-suite-reporter.mjs]="What is each test file's wall-clock duration (custom node:test reporter)?"
  [measure-suite.mjs]="What is the full suite's per-file and wall-clock duration profile?"
  [measure-trend-check.ts]="Is any test file's wall-clock duration growing across full-suite rounds (append-only measure-history.jsonl compare against the previous round)?"
  [monitor-mount-check.sh]="Is the loop monitor actually mounted and aimed at the right target (mounted + targetOk, per-observer streams — delivery is the owner's own Monitor stream)?"
  [monitor-mount-check.sh]="Is the loop monitor actually mounted, on the right target, and delivering events?"
  [needs-human-recheck.ts]="Is the needs-human measurement/aliveness axis live and accurate (the black-hole-human-dependency instrument)?"
  [observer-registry-check.sh]="Is every registered session-liveness observer still alive (registry vs /proc — the observer-kill must have an observer death detector)?"
  [os-anchor-install.sh]="Is the OS-level loop watchdog timer installed, active, and removable (the anchor that outlives any Claude session)?"
  [os-anchor-watchdog.sh]="Is the loop's OS-level anchor present for each project — session alive, and if not, re-spawned + driven with the cold-start text?"
  [pane-state-classify.ts]="What state is a Claude Code pane in (busy/idle/blocked)?"
  [periodic-push-backup.sh]="Can this repo's current branch be periodically pushed to the shared bare backup repo (non-force, idempotent)?"
  [pipe-exit-code-check.sh]="Does a pipeline propagate its last command's exit code correctly?"
  [portfolio-choice.ts]="Which non-overlapping milestone portfolio should the next cycle pursue?"
  [prefriction-count.sh]="How many newly-filed tasks had no triggering failure/alarm/contradiction at filing (the falsifiable pre-friction count)?"
  [preparation-feedback.ts]="What feedback should the preparation phase return to the proposer?"
  [prepare-admission-check.ts]="Is it safe for this milestone to acquire the single-flight admission lease?"
  [process-budget.sh]="What is the current test-process budget — how many throttle-able test workers are in use vs the nproc total?"
  [proposal-convergence.ts]="Has the proposal converged within the bounded review rounds?"
  [publish-dist-branch.sh]="Is the plugin bundle built and published to the dist branch?"
  [quay-init.sh]="What does quay-init lay into a fresh workspace, and is it byte-identical to the plugin?"
  [quay-launch.sh]="What is the exact per-role launch command (manager/outer/inner), materialized verbatim from the checked-in launch settings?"
  [quay-topology.sh]="Does the target tmux session have the two-window outer/inner topology built by definition (idempotent factory)? manager is cross-project, not per-project."
  [read-probe-spec.ts]="Is the probe spec well-formed and loadable?"
  [ready-pool-check.ts]="Is the ready pool the correct set of ready tasks (maintenance check)?"
  [real-target-verify.sh]="Is install/upgrade/cold-start verification passing against a REAL downstream workspace, not just synthetic mkdtemp fixtures?"
  [red-window-triage.ts]="Which suite failures are in the KNOWN-LOAD-SENSITIVE family (in-family vs not), what isolated-rerun command is issued, and what is the verdict?"
  [release-task.sh]="How does a machine release a task/branch claim?"
  [resource-gate.sh]="Is it resource-safe to start a heavy operation now?"
  [routine-file-gate.ts]="Is this routine finding novel, high-quality, and within rate limits?"
  [routine-scheduler.ts]="Which routine probes are due to run now?"
  [run-identity.ts]="What is this run's canonical identity (reproducible handle)?"
  [runtime-usage-inventory.ts]="What does the two-layer mode actually run, and is any of it unaccounted?"
  [select-static-checks-for-touches.ts]="Which static checks should a scoped run execute for this change's touched files (change-relevant tier)?"
  [select-tests-for-touches.ts]="Which tests should run for this task's ## Touches?"
  [self-report-vocab-audit.ts]="Do the inner's recent self-reports avoid batch-style vocabulary (reanchor convergence)?"
  [self-report-vocab-check.ts]="Has the inner layer's self-reported vocabulary drifted from the shipped semantics (reanchor convergence)?"
  [send-keys-reliable.sh]="Did the reliable five-step send-keys sequence land in the foreign session?"
  [send-keys-verified.sh]="Did the C-u → text → Enter send-keys sequence deliver to the target pane?"
  [serial-fanin-absorb.ts]="How should concurrent survivors be absorbed serially at fan-in?"
  [session-liveness-mount.sh]="Is a session-liveness observer mounted (one observer per consumer — who mounts owns its own stdout stream, no lock, no shared file)?"
  [session-liveness.sh]="Is a Claude Code session alive, busy, and within heartbeat (pure read-only observation, per-observer event stream)?"
  [session-bootstrap.sh]="Can a bare machine be bootstrapped into the named tmux layout with each window's claude process confirmed live (fail-closed by name)?"
  [session-liveness-mount.sh]="Is the session-liveness monitor mounted as the single observer?"
  [session-liveness.sh]="Is the inner Claude Code session alive, busy, and within heartbeat?"
  [slot-refill.ts]="Should a freed dispatch slot be refilled immediately (event-driven dispatch, completion-triggered)?"
  [slot-refill.sh]="Should a released slot be refilled from the ready pool now (bash invocation of the refill evaluator)?"
  [slot-refill.ts]="Should a released slot be refilled from the ready pool now (event-driven dispatch refill evaluator)?"
  [stage-receipt.ts]="Is a stage receipt valid per the canonical versioned schema family (FindingEnvelope / StageEvent / StageReceiptEnvelope / ReceiptValidationResult)?"
  [suite-state-trigger.ts]="Has the full-suite state changed to red or running, and has the outer been notified (the red-window auto-executor)?"
  [strategic-doc-staleness-check.ts]="Does a strategic doc reference a deleted path or a retired ADR mechanism?"
  [suite-state-trigger.ts]="Has the full-suite state changed to red or running, and has the outer been notified (the red-window auto-executor)?"
  [supervisor-bus.sh]="Can a cross-session message be delivered with sender identity (layer + project) through the ONE hardened delivery path, with the delivery event recorded as who → who → when → delivered in an attributable ledger?"
  [supervisor-bus-identity.sh]="Can a message's claimed sender identity be mechanically verified (an agent claiming from:human is REJECTED) and is the manager-inbox's delivered/consumed/unread visible to the tick?"
  [supervisor-deliver.sh]="Did a payload get delivered to a target Claude session, by intent, via the single hardened delivery implementation (deliver(target,payload) -> delivered|failed)?"
  [supervisor-observe.sh]="What is a target quay checkout's git/suite/session/process state right now, read-only and ssh-transport-agnostic (observe(target) -> {git_state, suite_state, session_state, process_state}, local/remote same shape)?"
  [supervisor-health.sh]="Is the supervisor base layer alive outside any Claude session (os-anchor timer + delivery/observe adapters + session liveness)?"
  [supervisor-preempt.sh]="Is the loop stopped at ANY point (preemptive .halt — process-level preempt(target) enforced in code, not just at a tick boundary)?"
  [supervisor-preempt-candidates.ts]="Is a task deterministically preemptible right now (queryable facts only: telemetry duration >90m + task status in-progress + not landed), and can it be preempted as a deterministic action (kill its subprocess tree + close its bracket + record a ledger event)?"
  [cross-machine-verify.sh]="Has every merge that landed on the tracked branches been cross-machine verified by a NON-participating machine, and what is the detection latency d (post_merge_latency_h) of the ones that have?"
  [sync-lag-check.sh]="Is local <fork-baseline> (develop) leading origin/<fork-baseline>, and has it been pushed (the cross-machine sync heartbeat + the event-driven push after a land closure)?"
  [sync-vendor.sh]="Is the plugin's vendored runtime in sync with the product build?"
  [task-ac-carryover-check.ts]="Do children carry over the parent's acceptance criteria?"
  [task-contract-check.ts]="Does the task's ## Contract match its declared measures and invariants (and is the ratchet shrinking)?"
  [task-schema-check.sh]="Is this task's authoring schema valid (canonical B2 check)?"
  [task-schema-check.ts]="Is this task's authoring schema valid (standalone CLI)?"
  [task-schema.ts]="Is a task body a valid quay task per the canonical schema?"
  [task-status-drift-check.ts]="Has any task's status drifted from its evidence?"
  [needs-human-recheck.ts]="Which needs-human tasks are stale or dead-retired (time-age + survival axis — the black hole is measurable)?"
  [stage-receipt.ts]="What is the durable hash-bound receipt for a workflow stage (control-plane kernel substrate)?"
  [workflow-journal.ts]="What is the durable stage journal for the workflow (control-plane kernel substrate)?"
  [test-file-snapshot.sh]="Does the current test-file set equal baseline + declared additions (relative-baseline)?"
  [test-file-baseline.ts]="What is the fork-baseline test-file snapshot a task's global-count assertion must be judged against (baseline ∪ declared touch additions, never an absolute count)?"
  [test-framework-policy-check.sh]="Do new tests use node:test, and is the exemption list shrinking (ratchet)?"
  [test-framework-policy-check.ts]="Do new tests use node:test and carry @test-group (mechanical policy)?"
  [test-impl-census-check.ts]="Are there test files whose tested implementation no longer exists (impl-deleted tests that should be removed with their implementation)?"
  [test-isolation-check.sh]="Is every test isolated per the test-isolation contract (and is the violation ratchet shrinking)?"
  [test-isolation-check.ts]="Is every test isolated per the contract (report-only scan)?"
  [tmux-isolated.sh]="Is TMUX unset before the test runs (isolation from the driver session)?"
  [tmux-leak-scan.sh]="Did a test run leak any tmux server or characteristic temp dir (suite-tail residual-leak assertion)?"
  [topology-check.sh]="Does the target tmux session have all three topology windows in place, each with a claude process (not a bare bash window)?"
  [touches-orthogonality-check.ts]="Do two milestones' ## Touches overlap?"
  [touches-parser.ts]="What files does this task's ## Touches declare?"
  [unverified-integration-task-ids.ts]="Which unverified task ids are pending on integration (develop..integration fan-in merges) to feed --overlaps-unverified (fixing the permanently-false overlap path)?"
  [trend-check.ts]="Is any quality axis trending worse than last time (suite per-test cost, early-RED detection latency, per-checker cost) over a window — even while each point is individually green (the point-in-time blind spot)?"
  [transcript-delivery-check.ts]="Did the reliable-send procedure deliver the transcript (delivery verdict)?"
  [tree-hygiene-check.sh]="Is the repo tree hygienic for the loop (no stray files or commits)?"
  [verify-delivery-surface.ts]="Is the complete six-category delivery surface actually delivered (L1 completeness)?"
  [trend-check.ts]="Is a standing criterion quantified as a trend over time, not a point-in-time snapshot (the TREND criterion)?"
  [verify-installed-executables.sh]="Is every installed executable byte-identical to its plugin source?"
  [vmeta-lag-check.sh]="How far is the V_meta consolidation lagging behind the evidence?"
  [vmeta-lag-check.ts]="How far is the V_meta consolidation lagging (canonical arithmetic)?"
  [wiring-coverage-check.ts]="Is every mechanism claim in a task body wired to a real mechanism?"
  [workflow-baseline-metrics.ts]="What are the workflow's mechanical baseline metrics?"
  [workflow-event-schema.mjs]="Is a stage event valid per the canonical schema?"
  [workflow-invariant-ownership.mjs]="Is every workflow invariant owned by exactly one owner?"
  [workflow-journal.ts]="What stage events were durably journaled for this milestone (append-only StageJournalStore under the canonical milestone root)?"
  [workflow-metadata-conformance.mjs]="Does the workflow's metadata match its executable driver?"
  [workflow-replay.ts]="Does the workflow replay byte-for-byte against its golden run?"
  [worktree-branch-hygiene-check.sh]="Is the worktree and branch state hygienic (no stale branches or stranded worktrees)?"
)

# ── exp5-legacy screening (AC2) ──────────────────────────────────────────────────
# Scripts whose existence is motivated ONLY by this repo's (exp5) history — they answer
# questions a target project does not ask. Judged `ships: false`: they do NOT ship with
# the artifact. The three named families MUST be here (AC2); they already do not ship
# under the derived LOOP_SCRIPTS (none is referenced by a shipped skill/tick doc).
declare -A NOT_SHIPPED=(
  [codex-stage1-selfcheck.sh]="exp5 legacy — the DIR-121 Codex-adoption self-check is motivated only by this repo's history"
  [it0-enforcement-with-design-check.sh]="exp5 legacy — the ADR-011 enforcement-with-design gate is an exp5-methodology invariant"
  [it0-enforcement-with-design-check.ts]="exp5 legacy — canonical implementation of the enforcement-with-design gate"
  [audit-independence-check.sh]="exp5 legacy — the DIR-032 audit-independence gate is an exp5-methodology invariant"
  [audit-independence-check.ts]="exp5 legacy — canonical implementation of the audit-independence gate"
)

# ── delivery-form declaration (gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form) ──
# The shipped artifact's delivery FORM for the plugin's bash tools was 86 loose .sh files — every
# one an independently-invocable surface, with NO argued decision about the entry count (Core ships
# as ONE bundled dist/quay.js; the plugin shipped as 86 loose scripts — asymmetry unargued).
# Human ruling 2026-08-06: the user should get a SMALL number of executable files. bash cannot be
# bundled into a single executable (unlike .ts via esbuild — the sibling task
# gap-shipped-ts-files-are-not-bundled-* owns that axis), so the .sh reachable form is
# "few entry points + internal parts not exposed": the CONSUMER-FACING set below is the ARGUED
# public .sh entry surface — the tools the shipped docs/skills (plugin/loop/*.md +
# plugin/skills/*/SKILL.md) tell a consumer/agent to invoke directly. EVERY other shipped .sh is an
# INTERNAL part: it exists to be called by other scripts/skills, never by a consumer, and it MUST
# NOT appear in consumer-facing operation docs.
#
# AC3 negative control (load-bearing): a .sh that appears in consumer-facing docs but is NOT
# declared here is an UNARGUED consumer-facing surface — the catalog exits non-zero and names it
# (`--entry-surface`). This is the mechanical "demotion is not verbal" check: an internal script
# that still shows up in consumer docs is a lie. The declared set is the argument; the doc-referenced
# set is the reality; the invariant is doc-referenced(.sh) ⊆ declared.
#
# Baseline (measured 2026-08-08 on the fresh 0.4.0 build): 94 loose .sh staged (64 scripts/ +
# 17 scripts/checker-mutation-cases/ fixtures + 12 gate-scripts/ + 1 sync.sh), of which the 23
# below are consumer-facing. Shrinking this set (converging toward the single `quay-tool <name>`
# dispatcher) is the intended direction; the gate enforces that the surface stays ARGUED (no
# undeclared growth — the 2026-08-06→08-08 drift 86→94 without any argued decision is the failure
# this gate exists to stop).
declare -A PUBLIC_ENTRYPOINTS=(
  [cap-from-gate.sh]="consumer-facing: the adaptive-cap gate invocation documented in the tick docs"
  [capability-catalog.sh]="consumer-facing: the visibility catalog itself — 'what does each installed check answer'"
  [claim-task.sh]="consumer-facing: the claim protocol command documented in the tick docs"
  [dead-loop-check.sh]="consumer-facing: the L2 dead-loop health command invoked by the cold-start and manager skills"
  [inner-session-check.sh]="consumer-facing: the three-state cold-start self-check invoked by the loop docs"
  [integration-batch-merge.sh]="consumer-facing: the integration→develop batch-merge command in the branch-model docs"
  [laydown-set-check.sh]="consumer-facing: the cold-start lay-what-you-verify gate invoked by the cold-start skill"
  [loop-driver-check.sh]="consumer-facing: the exactly-one-driver liveness check documented in the tick docs"
  [manager-arm-loop.sh]="consumer-facing: the manager scheduling-anchor command documented in the manager tick docs"
  [manager-tick-log-check.sh]="consumer-facing: the manager's last-tick-did-log detector in the manager tick docs"
  [monitor-mount-check.sh]="consumer-facing: the loop-monitor mount/aim check in the tick docs"
  [process-budget.sh]="consumer-facing: the total test-process budget authority consumed by test.sh / cap-from-gate / resource-gate"
  [quay-launch.sh]="consumer-facing today: the per-role launch command in 4 skill docs (demotion to skill-internal tracked by gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal)"
  [quay-topology.sh]="consumer-facing: the two-window topology factory in the tick docs"
  [release-task.sh]="consumer-facing: the claim-release command documented in the tick docs"
  [real-target-verify.sh]="consumer-facing: the real-downstream install/upgrade verification command in the verification-round docs"
  [resource-gate.sh]="consumer-facing: the resource-safety gate invoked by the tick docs before heavy ops"
  [send-keys-reliable.sh]="consumer-facing: the reliable send-keys sequence used by ADR-016 remote-drive"
  [session-bootstrap.sh]="consumer-facing: the bare-machine tmux bootstrap in the session-topology skill"
  [session-liveness-mount.sh]="consumer-facing: the per-observer session-liveness mount command in the tick docs"
  [session-liveness.sh]="consumer-facing: the session-alive/busy/heartbeat observer invoked by the tick docs"
  [slot-refill.sh]="consumer-facing: the event-driven slot-refill evaluator in the tick docs"
  [supervisor-bus.sh]="consumer-facing: the identity-attributable cross-session message bus (deliver with sender identity + attributable ledger)"
  [supervisor-bus-identity.sh]="consumer-facing: the sender-identity verification command in the manager docs"
  [supervisor-preempt.sh]="consumer-facing: the process-level preempt (.halt) command in the supervisor docs"
  [sync-lag-check.sh]="consumer-facing: the cross-machine sync heartbeat in the tick docs"
  [topology-check.sh]="consumer-facing: the three-window topology gate in the tick docs"
)

# ── derive the check set from the filesystem (never a hardcoded count) ────────────
SCRIPTS=()
for f in "$SELF_DIR"/*.sh "$SELF_DIR"/*.ts "$SELF_DIR"/*.mjs; do
  [ -f "$f" ] || continue
  SCRIPTS+=("$(basename "$f")")
done
mapfile -t SCRIPTS < <(printf '%s\n' "${SCRIPTS[@]}" | sort)

# ── mode selection ─────────────────────────────────────────────────────────────────
MODE=table
ENTRY_SURFACE_SUBMODE=""   # --entry-surface [--summary|--json]
case "${1:-}" in
  --json) MODE=json ;;
  --table) MODE=table ;;
  --summary) MODE=summary ;;
  --entry-surface)
    MODE=entry-surface
    case "${2:-}" in
      --json) ENTRY_SURFACE_SUBMODE=json ;;
      --summary) ENTRY_SURFACE_SUBMODE=summary ;;
      "") ;;
      *) echo "ERROR: unknown --entry-surface sub-argument: $2 (expected --json | --summary)" >&2; exit 2 ;;
    esac
    ;;
  --help|-h)
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "")
    ;;
  *)
    echo "ERROR: unknown argument: $1 (expected --json | --table | --summary | --entry-surface)" >&2
    exit 2
    ;;
esac

# ── build rows ─────────────────────────────────────────────────────────────────────
TOTAL=${#SCRIPTS[@]}
DECLARED=0
UNCLASSIFIED=0
SHIPPED=0
ROWS=""
for b in "${SCRIPTS[@]}"; do
  q="${QUESTION[$b]:-}"
  if [ -n "$q" ]; then
    DECLARED=$((DECLARED + 1))
  else
    UNCLASSIFIED=$((UNCLASSIFIED + 1))
  fi
  ships=true
  if [ -n "${NOT_SHIPPED[$b]:-}" ]; then
    ships=false
  else
    SHIPPED=$((SHIPPED + 1))
  fi
  # delivery-form surface (AC3): .sh in PUBLIC_ENTRYPOINTS is consumer-facing (public);
  # every other shipped .sh is an internal part. Non-.sh (.ts/.mjs) are a DIFFERENT axis
  # owned by gap-shipped-ts-files-are-not-bundled-* → surface null here.
  surface=null
  if [[ "$b" == *.sh ]]; then
    if [ -n "${PUBLIC_ENTRYPOINTS[$b]:-}" ]; then
      surface=public
    else
      surface=internal
    fi
  fi
  ROWS+="$b	$q	$ships	$surface"$'\n'
done

# ── delivery-form computation (AC3): which .sh do the consumer-facing docs reference? ──
# Self-locating: works in the repo AND in the staged package copy (package.sh runs this on the
# staged plugin). Consumer-facing operation docs = plugin/loop/*.md + plugin/skills/*/SKILL.md —
# the SAME surface the task contract's `consumer_facing_entrypoints` measure scans.
PLUGIN_ROOT="$(cd "${SELF_DIR}/.." 2>/dev/null && pwd || true)"
DOC_REFERENCED_SH=""
if [ -n "${PLUGIN_ROOT}" ] && [ -d "${PLUGIN_ROOT}/loop" ] && [ -d "${PLUGIN_ROOT}/skills" ]; then
  DOC_REFERENCED_SH="$(grep -ohE "plugin/scripts/[a-zA-Z0-9._-]+\.sh" \
    "${PLUGIN_ROOT}"/loop/*.md "${PLUGIN_ROOT}"/skills/*/SKILL.md 2>/dev/null \
    | sed 's|.*/||' | sort -u || true)"
fi

# Violations = doc-referenced .sh NOT declared public (an unargued consumer-facing surface).
VIOLATIONS=""
if [ -n "${DOC_REFERENCED_SH}" ]; then
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    if [ -z "${PUBLIC_ENTRYPOINTS[$b]:-}" ]; then
      VIOLATIONS+="$b"$'\n'
    fi
  done <<<"${DOC_REFERENCED_SH}"
fi

SH_SHIPPED=0
PUBLIC_SH=0
INTERNAL_SH=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  IFS=$'\t' read -r b q ships surface <<<"$line"
  if [ "$surface" = "public" ]; then PUBLIC_SH=$((PUBLIC_SH + 1)); fi
  if [ "$surface" = "internal" ]; then INTERNAL_SH=$((INTERNAL_SH + 1)); fi
  if [[ "$b" == *.sh ]]; then SH_SHIPPED=$((SH_SHIPPED + 1)); fi
done <<<"$ROWS"
DOC_REFERENCED_SH_COUNT=$(printf '%s\n' "${DOC_REFERENCED_SH}" | sed '/^$/d' | wc -l | tr -d ' ')
VIOLATION_COUNT=$(printf '%s\n' "${VIOLATIONS}" | sed '/^$/d' | wc -l | tr -d ' ')

# ── output ──────────────────────────────────────────────────────────────────────────
if [ "$MODE" = "json" ]; then
  python3 - "$ROWS" <<'PYEOF'
import json, sys
rows = sys.argv[1].splitlines()
entries = []
for line in rows:
    if not line:
        continue
    parts = line.split("\t")
    fname, q, ships, surface = parts[0], parts[1], parts[2], parts[3]
    entries.append({
        "file": fname,
        "question": q if q else None,
        "ships": ships == "true",
        "surface": surface if surface != "null" else None,
    })
json.dump(entries, sys.stdout, ensure_ascii=False, indent=2)
print()
PYEOF
elif [ "$MODE" = "entry-surface" ]; then
  if [ "$ENTRY_SURFACE_SUBMODE" = "json" ]; then
    python3 - "${SH_SHIPPED}" "${PUBLIC_SH}" "${INTERNAL_SH}" "${DOC_REFERENCED_SH_COUNT}" "${VIOLATIONS}" <<'PYEOF'
import json, sys
sh_shipped, public_sh, internal_sh = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
doc_ref_count, violations = int(sys.argv[4]), [v for v in sys.argv[5].splitlines() if v]
print(json.dumps({
    "sh_shipped": sh_shipped,
    "public_sh": public_sh,
    "internal_sh": internal_sh,
    "doc_referenced_sh": doc_ref_count,
    "violations": violations,
    "ok": len(violations) == 0,
}, indent=2))
PYEOF
  else
    echo "delivery form (.sh): ${SH_SHIPPED} shipped | ${PUBLIC_SH} declared consumer-facing | ${INTERNAL_SH} internal"
    echo "consumer-facing docs reference ${DOC_REFERENCED_SH_COUNT} distinct .sh"
    if [ "$VIOLATION_COUNT" -gt 0 ]; then
      echo "FAIL (AC3): ${VIOLATION_COUNT} internal .sh script(s) are referenced by consumer-facing docs — the demotion is verbal, not real:" >&2
      printf '%s\n' "${VIOLATIONS}" | sed '/^$/d' | sed 's/^/  /' >&2
      echo "  Declare each in PUBLIC_ENTRYPOINTS (capability-catalog.sh) OR remove the doc reference." >&2
    else
      echo "AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS"
    fi
  fi
elif [ "$MODE" = "summary" ]; then
  echo "capability-catalog: ${TOTAL} scripts | ${DECLARED} declared | ${UNCLASSIFIED} unclassified | ${SHIPPED} ship"
elif [ "$MODE" = "table" ]; then
  echo "capability catalog — what each shipped check answers (${SELF_DIR})"
  echo "---------------------------------------------------------------------------"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    IFS=$'\t' read -r b q ships <<<"$line"
    if [ "$ships" = "false" ]; then
      printf '  %-40s %s   [NOT SHIPPED — exp5 legacy]\n' "$b" "$q"
    else
      printf '  %-40s %s\n' "$b" "$q"
    fi
  done <<<"$ROWS"
  echo "---------------------------------------------------------------------------"
  echo "summary: ${TOTAL} scripts | ${DECLARED} declared | ${UNCLASSIFIED} unclassified | ${SHIPPED} ship"
  if [ "$UNCLASSIFIED" -gt 0 ]; then
    echo "FAIL (AC1c): ${UNCLASSIFIED} script(s) entered the artifact without a declared question." >&2
    echo "  Add a line to the QUESTION table in capability-catalog.sh, or the check is rejected." >&2
  fi
fi

# ── AC1c gate: unclassified > 0 ⇒ exit non-zero ────────────────────────────────────
if [ "$UNCLASSIFIED" -gt 0 ]; then
  exit 1
fi

# ── AC3 gate (delivery form): an internal .sh referenced by consumer-facing docs ⇒ exit 1 ──
# This is the load-bearing negative control: "demoted" must be real, not verbal. A .sh NOT
# declared public (PUBLIC_ENTRYPOINTS) that still appears in plugin/loop/*.md or
# plugin/skills/*/SKILL.md is an UNARGUED consumer-facing surface — the exact state this task
# exists to stop (86 loose scripts with no argued entry decision).
if [ "$MODE" = "entry-surface" ] && [ "$VIOLATION_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
