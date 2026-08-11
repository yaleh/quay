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
#
# Exit status: 0 when every shipped check declares its question (unclassified == 0);
# 1 when any check is unclassified (AC1c gate). The `--json` mode uses the same gate.
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
  [candidate-contracts.ts]="Do the SELECT candidate contracts conform to their versioned schema?"
  [candidate-synthesis.ts]="Which milestone candidates does the coupling graph surface for the next cycle?"
  [cap-from-gate.sh]="What cap should the loop use for in-flight agents at the dispatch point (bash invocation of the adaptive-cap module)?"
  [cap-from-gate.ts]="What cap should the loop use for in-flight agents at the dispatch point (adaptive cap = f(resource-gate some avg300, hysteresis banded, no fixed cap)?"
  [capability-catalog.sh]="What question does each shipped check make askable, and is every check declared?"
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
  [inbox-reader.sh]="Does the human channel's manager inbox have a mechanical reader that consumes every delivered message (delivered ≠ read otherwise)?"
  [inner-session-check.sh]="Is the inner session healthy / empty-shell / missing (three-state cold-start self-check)?"
  [integration-batch-merge.sh]="Can integration be batch-merged into develop (fast-forward + CAS, fail-closed)?"
  [integration-branch-model.ts]="Which ref should a task fork from — develop (independent) or integration (declared dependency / overlapping unverified work) — and is the integration→develop batch merge fast-forward-safe?"
  [it0-enforcement-with-design-check.sh]="Is every enforced rule backed by a design that explains it (ADR-011)?"
  [it0-enforcement-with-design-check.ts]="Is every enforced rule backed by a design that explains it (canonical gate)?"
  [it0-impl-row-check.sh]="Is every implementation row in a design-only milestone accounted for?"
  [it0-split-or-commit-check.sh]="Did the task either split or commit (no limbo)?"
  [it0-split-or-commit-check.ts]="Did the task either split or commit (single-source enforcement)?"
  [laydown-set-check.sh]="Is the cold-start derived-laydown-set green (lay-what-you-verify)?"
  [l1-delivery-surface-check.ts]="Is the SIX-category delivery surface complete — every category has a deliverable and its owning gap task is filed (SPEC §6 machine-readable list)?"
  [laydown-set-check.sh]="Are all scripts in the derived cold-start laydown set present, syntactically valid, and green (gate = lay what you verify)?"
  [loadbearing-test-gate.sh]="Is the load-bearing test present and passing before the milestone may land?"
  [loadbearing-test-gate.ts]="Is the load-bearing test gate satisfied (canonical implementation)?"
  [loop-driver-check.sh]="Is exactly one loop driver running, and is it the sanctioned cron?"
  [loop-shipping-exclusion-data.mjs]="What are the single-source old-path and exclusion entries that the loop-shipping scan and its inert-entry necessity check must not disagree on?"
  [measure-suite-reporter.mjs]="What is each test file's wall-clock duration (custom node:test reporter)?"
  [measure-suite.mjs]="What is the full suite's per-file and wall-clock duration profile?"
  [monitor-mount-check.sh]="Is the loop monitor actually mounted and aimed at the right target (mounted + targetOk, per-observer streams — delivery is the owner's own Monitor stream)?"
  [monitor-mount-check.sh]="Is the loop monitor actually mounted, on the right target, and delivering events?"
  [needs-human-recheck.ts]="Is the needs-human measurement/aliveness axis live and accurate (the black-hole-human-dependency instrument)?"
  [observer-registry.sh]="Is an observed target still alive/intentional — registered active/offline ONCE in the single observer-registry, and do all consumers (os-anchor-watchdog / session-liveness git-staleness + coverage / topology-check) reflect a decommission on their next read (class-level decommission + criterion invalidation)?"
  [os-anchor-install.sh]="Is the OS-level loop watchdog timer installed, active, and removable (the anchor that outlives any Claude session)?"
  [os-anchor-watchdog.sh]="Is the loop's OS-level anchor present for each project — session alive, and if not, re-spawned + driven with the cold-start text?"
  [pane-state-classify.ts]="What state is a Claude Code pane in (busy/idle/blocked)?"
  [periodic-push-backup.sh]="Can this repo's current branch be periodically pushed to the shared bare backup repo (non-force, idempotent)?"
  [pipe-exit-code-check.sh]="Does a pipeline propagate its last command's exit code correctly?"
  [portfolio-choice.ts]="Which non-overlapping milestone portfolio should the next cycle pursue?"
  [prefriction-count.sh]="How many newly-filed tasks had no triggering failure/alarm/contradiction at filing (the falsifiable pre-friction count)?"
  [preparation-feedback.ts]="What feedback should the preparation phase return to the proposer?"
  [prepare-admission-check.ts]="Is it safe for this milestone to acquire the single-flight admission lease?"
  [proposal-convergence.ts]="Has the proposal converged within the bounded review rounds?"
  [publish-dist-branch.sh]="Is the plugin bundle built and published to the dist branch?"
  [quay-init.sh]="What does quay-init lay into a fresh workspace, and is it byte-identical to the plugin?"
  [quay-launch.sh]="What is the exact per-role launch command (manager/outer/inner), materialized verbatim from the checked-in launch settings?"
  [quay-topology.sh]="Does the target tmux session have the two-window outer/inner topology built by definition (idempotent factory)? manager is cross-project, not per-project."
  [read-probe-spec.ts]="Is the probe spec well-formed and loadable?"
  [ready-pool-check.ts]="Is the ready pool the correct set of ready tasks (maintenance check)?"
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
  [supervisor-bus-identity.sh]="Can a message's claimed sender identity be mechanically verified (an agent claiming from:human is REJECTED) and is the manager-inbox's delivered/consumed/unread visible to the tick?"
  [supervisor-deliver.sh]="Did a payload get delivered to a target Claude session, by intent, via the single hardened delivery implementation (deliver(target,payload) -> delivered|failed)?"
  [supervisor-health.sh]="Is the supervisor base layer alive outside any Claude session (os-anchor timer + delivery/observe adapters + session liveness)?"
  [supervisor-preempt.sh]="Is the loop stopped at ANY point (preemptive .halt — process-level preempt(target) enforced in code, not just at a tick boundary)?"
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

# ── derive the check set from the filesystem (never a hardcoded count) ────────────
SCRIPTS=()
for f in "$SELF_DIR"/*.sh "$SELF_DIR"/*.ts "$SELF_DIR"/*.mjs; do
  [ -f "$f" ] || continue
  SCRIPTS+=("$(basename "$f")")
done
mapfile -t SCRIPTS < <(printf '%s\n' "${SCRIPTS[@]}" | sort)

# ── mode selection ─────────────────────────────────────────────────────────────────
MODE=table
case "${1:-}" in
  --json) MODE=json ;;
  --table) MODE=table ;;
  --summary) MODE=summary ;;
  --help|-h)
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "")
    ;;
  *)
    echo "ERROR: unknown argument: $1 (expected --json | --table | --summary)" >&2
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
  ROWS+="$b	$q	$ships"$'\n'
done

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
    fname, q, ships = parts[0], parts[1], parts[2]
    entries.append({
        "file": fname,
        "question": q if q else None,
        "ships": ships == "true",
    })
json.dump(entries, sys.stdout, ensure_ascii=False, indent=2)
print()
PYEOF
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
exit 0
