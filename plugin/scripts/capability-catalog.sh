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
#   bash plugin/scripts/capability-catalog.sh --superseded-check
#                                                        # superseded-capability gate (AC5):
#                                                        #   every SUPERSEDED entry must NOT exist in
#                                                        #   plugin/scripts, plugin/test, packages/*/plugin
#                                                        #   nor be taught in SKILL/README; exit 1 otherwise
#
# Exit status: 0 when every shipped check declares its question (unclassified == 0)
# AND no data value contains a command-substitution pattern (AC5 gate — backtick or $()
# in a double-quoted value would execute at load time) AND (in --entry-surface mode) no
# internal .sh is referenced by consumer-facing docs;
# 1 when any check is unclassified (AC1c gate), the AC5 gate fires, or the delivery-form
# gate fails (AC3). The `--json` mode uses the same AC1c/AC5 gates.
#
# Output shape (--json): a top-level JSON array of
#   {"file": "<basename>", "question": "<question>" | null, "ships": true|false}
# so the contract's measures work verbatim:
#   declared_questions = --json | jq '[.[]|select(.question)]|length'
#   shipped_checks     = ls plugin/scripts/*.{sh,ts,mjs} | wc -l
#   unclassified       = --json | jq '[.[]|select(.question==null)]|length'   (band 0)

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail

# Self-locate: works in the repo (plugin/scripts/capability-catalog.sh) AND in an
# installed target project (the laid-down copy at <workspace>/plugin/scripts/).
SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
SELF_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd || true)"

# ── AC5 gate (no command substitution in data values) — fail-fast BEFORE any array ──
# assignment: a backtick or $( inside a double-quoted data value is EXECUTED by bash during
# the assignment, punching through the data/code boundary (round 143 red — a backtick
# `bash scripts/test.sh --static-checks-doc` in QUESTION[precommit-guard.ts] ran the whole
# doc-check suite on every catalog load and its multiline output broke the tab-separated
# ROWS structure → --json IndexError). Static scan of the SOURCE TEXT (not the evaluated
# values) so the injection point itself is caught before it executes. A data value line is
# `  [name]="..."` (two-space indent); comment lines (leading `#`) are not data values.
_cs_violations="$(grep -nE '^  \[[^]]+\]="[^"]*(`|\$\()' "${SELF_DIR}/capability-catalog.sh" || true)"
if [ -n "${_cs_violations}" ]; then
  echo "FAIL (AC5 no-command-substitution): a data value in capability-catalog.sh contains a command-substitution pattern (backtick or \$( ) inside a double-quoted value)." >&2
  echo "  It would execute at load time and break the tab-separated ROWS — write the command as plain text." >&2
  printf '%s\n' "${_cs_violations}" | sed 's/^/  /' >&2
  exit 1
fi
unset _cs_violations

# ── capability declarations (AC1a: ONE machine-readable line per shipped check) ────
# Format: [<basename>]="<the question this check makes askable>"
# A script missing here is UNCLASSIFIED → the catalog exits 1 (AC1c gate). Phrase each
# as a specific QUESTION, never the generic "checks correctness" (AC5 negative control:
# a catalog where every entry says "checks correctness" is indistinguishable from none).
declare -A QUESTION=(
  [a15-ruling5-counter.ts]="Is A15 裁定5 (suite-health 心跳缺失) mechanically counted — ticks since the outer's last Agent tool_use (read from the outer session transcript + tick-log), >=3 ⇒ 应 .halt / >=6 ⇒ 应 /clear?"
  [ac36-sortkey-criterion-check.ts]="Did AC36 判据② hold mechanically — the delivery-critical task strictly moved forward, same-family non-DC kept their relative order, and blocking_suite still ranks above delivery_critical (two slot-refill runs' ranking compared)?"
  [adr016-screen-use-check.ts]="Is this tmux remote-drive usage compliant with ADR-016's screen-use carve-out?"
  [anti-drift-touches-check.ts]="Did the landed change touch exactly the files the task's ## Touches declared (and nothing else)?"
  [anti-gaming-guard.sh]="Is a candidate value surface machine-verifiable, capped and un-inflatable (no subjective gaming of the chart)?"
  [anti-gaming-guard.ts]="Is a candidate value surface machine-verifiable, capped and un-inflatable, with residual headroom adjudicated?"
  [assert-clean-tree.sh]="Is the working tree clean after a full-suite run?"
  [audit-independence-check.sh]="Is the audit gate independent of the contestant it judges?"
  [audit-independence-check.ts]="Is the audit gate independent of the contestant it judges (canonical implementation)?"
  [accounting-emit-layer-map.ts]="What is the per-layer mechanism membership table the unified four-tuple emitter reads — cap-from-gate/slot-refill 归 inner, closure-lag-check 归 outer, manager its own (manager-tick-log/Workflow/session-liveness) — so each layer's accounting-emit reports only its own mechanisms (AC39)?"
  [accounting-emit.ts]="What is this layer's SPEC §2.5 ledger four-tuple — ① each claimed mechanism's last real execution time vs its claimed period, ② occupancy (in-flight/effective_cap), ③ write target, ④ the canonical ledger line — in ONE unified, layer-identical schema, with any missing field mechanically reported (缺值 = 未执行)?"
  [accounting-emit-layer-map.ts]="Which mechanisms belong to which layer (outer/inner/manager) — the single-source layer→mechanisms mapping that accounting-emit reads, so each layer emits its own mechanisms' real readings instead of a default install of the wrong layer's mechanisms?"
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
  [blocked-signal-check.sh]="Is an un-consumed blocked signal auto-escalated after the timeout window (no indefinite inner freeze)?"
  [manager-adopt.sh]="Is a project adopted into the manager's scope (healthy → noop, empty-shell → drive, missing → build the two-window topology)?"
  [manager-arm-loop.sh]="Is the manager's scheduling anchor armed (sentinel-clean + idempotent, zero-memory executable)?"
  [manager-observation-runtime-check.ts]="Does the outer session's runtime behavior observe/check the manager (PANE / TICKLOG / transcript reads) in violation of C3's never-create/drive/check constraint?"
  [manager-start.sh]="What does the manager's own start command do, independent of any single project (identity = cross-project, its own session + home)?"
  [manager-tick-log-check.sh]="Did the manager's previous tick leave a row in the tick log (the mechanical 'last tick didn't log' detector)?"
  [manager-tick-readings.ts]="What are the manager's tick readings (three-project state / resources / outer liveness / tick log / monitor versions) as one command?"
  [no-manager-tick-doc-check.ts]="Do the outer tick docs contain any create/drive/check manager step (C3 mechanical gate, by position not keyword)?"
  [obligation-ledger.ts]="What is the DERIVED obligation set for a round, with each obligation's age, the undischarged set sorted by age DESC, the escalation verdict (oldest-undischarged age vs threshold), and whether the round can close (no undischarged undeferred live obligation)?"
  [obligation-ledger-check.ts]="Is the obligation ledger's integrity mechanically sound — derived ids stable (obligation_set_derived=1), age monotonic across live rounds, and no round recorded canClose:true while a live+undischarged obligation exists (强行闭轮)?"
  [obligation-discharge-agent.ts]="Does a discharge/defer verdict conform to the schema'd semantic contract (ADR-033) — discharged:true needs who+why, discharged:false MUST carry defer_reason + unblock_condition (a silent skip is rejected)?"
  [outer-tick-log-check.sh]="Does the outer's last tick row writing no-action carry the five-inequality evidence with all five false (B13: no-action legal only when every inequality is false)?"
  [quay-branch.ts]="Which branch/claim instrument does the consolidated branch/claim entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-check.ts]="Which task/document validation instrument does the consolidated check entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-deliver.ts]="Which delivery/preempt instrument does the consolidated deliver entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-dispatch.ts]="Which dispatch/concurrency instrument does the consolidated dispatch entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-entry-base.ts]="What is the shared dispatcher framework that the six grouped instrument entry points use to preserve each member's CLI byte-for-byte?"
  [quay-session.ts]="Which session/topology instrument does the consolidated session entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [quay-suite.ts]="Which suite/gate instrument does the consolidated suite entry point dispatch to (grouped entry, byte-for-byte CLI preservation)?"
  [suite-cutoff-verdict.mjs]="Is a full-suite log's failure class heavy-file at-risk / genuine dangling-Promise / cascade-victim, and which files are at-risk?"
  [suite-execution-form-counter.ts]="Is the suite execution form silently rolled back to main-session-direct — 执行形态 = launch Bash tool_use 落在哪类 transcript 文件（主会话/agent/workflow 三类互斥，[startedAt ± ε] 窗匹配），invariant「近 N 轮已分类形态 ≥2 类」能取假（gap-a19-evidence-field-does-not-match-measured-object 重写；runner 字段已降级非执行面取证）?"
  [checker-cost.sh]="What does each checker/gate execution actually cost — ms, its size dimension n, and the machine load at that moment (the pure-append cost ledger)?"
  [checker-cost-lib.sh]="Does a bash static-check invocation record its criterion's wall-clock cost (append-only, zero-judgment)?"
  [checker-cost.ts]="Did the checker record its own criterion cost to the checker-cost JSONL (pure-append, zero-judgment)?"
  [checker-mutation-check.sh]="Would each checker actually fail when its subject is mutated (the L_S instrument)?"
  [claim-task.sh]="Is a task/branch claimed by a specific machine (claim protocol, atomic CAS push)?"
  [claim-task.ts]="Which branch should a candidate task fork from under multi-machine claims (decideClaim)?"
  [closure-lag-check.sh]="Is the outer's async closure pass running on schedule — not-yet-flipped backlog under threshold and the last closure-pass trace fresh (the closure-lag signal; also writes the trace via --record)? Also the unified telemetry bracket-close point: --close-task closes one task's open bracket at terminal routing (needs-human/done) and at DEFER (--outcome deferred, gap-over90-clock-measures-queue-time-not-work-time), and --close-terminal mechanically closes every inProgress bracket whose task is terminal (gap-needs-human-routing-does-not-close-bracket)?"
  [provision-verify-worktree.sh]="Has a fresh verify worktree been provisioned with the gitignored runtime symlinks (node_modules + .quay/config.yml) it needs to run the full suite — the shared step for both the suite-fix subagent and the outer takeover path?"
  [codex-stage1-live-proof-check.ts]="Is there live, internally-consistent proof that a Codex Stage-1 session did real authorized work?"
  [codex-stage1-selfcheck.sh]="Is the DIR-121 Codex-adoption Stage-1 mechanical self-check satisfied?"
  [commit-message-verified-check.ts]="Does any commit in the live window make a 'verified'-class assertion (all syntax verified / 验证通过 / 已验证) WITHOUT a reproducible verification command/reference (script path / test invocation / result counts / verifiedCommit= / backtick command)?"
  [concurrency-literal-check.ts]="Is every concurrency numeric literal (cap/slot/lane/CPU-quota count) at the single definition point (QUAY_MAX_TASK_SUBAGENTS / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION env reads) or explicitly declared as a fallback (concurrency-default-fallback marker) — 硬规则 4 推论二 enforcement, by POSITION not keyword?"
  [concurrent-batch-scheduler.ts]="Which ready tasks can be dispatched concurrently without touching overlapping files?"
  [config-wiring-check.ts]="Does every declared config field have exactly one wirer?"
  [coupling-graph.ts]="Which tasks are coupled by shared touches?"
  [dead-code-after-return-check.ts]="Does any shell function have executable statements AFTER a top-level return (dead code — the 2026-08-03 concurrency-pin shape)?"
  [dead-loop-check.sh]="Is a target project's loop alive or dead (L2 continuous-health: transcript user-msg or git commit window)?"
  [dead-loop-check.sh]="Is the loop ACTUALLY RUNNING (L2 continuous health) — a recent transcript user message or git commit in the last N minutes, INDEPENDENT of backlog emptiness (dead-loop vs healthy-idle)?"
  [derive-touches-heuristic.ts]="When a task body lacks a ## Touches section, what globs would a cheap scheduling-time heuristic derive for it?"
  [delivery-inventory-drift-gate.sh]="Did this change ADD/DELETE a file under plugin/scripts/ WITHOUT updating the outline §6 DELIVERY-INVENTORY snapshot in the same change (the 2026-08-10 red family's root cause)?"
  [develop-deliver-tgz.sh]="After a develop merge, was a FRESH hardware-independent quay .tgz built at the develop tip and delivered+verified (quay serve http_code=200) on the verification machines B/C — DIR-123 每次 merge 后自动 deliver 机制?"
  [drivable-workspace-check.sh]="Is the workspace drivable by a loop (safe to hand to an autonomous driver)?"
  [drivable-workspace-check.ts]="Is the workspace drivable by a loop (canonical fail-closed gate)?"
  [drive-contract-check.ts]="When a drive text asserts a task order (X→Y), does it attach the checkTouchesPair output in the same text?"
  [drive-target-check.sh]="Does a tmux drive/observe target resolve to the expected window (default inner) — the fail-closed pre-flight gate: numeric pane/window indices are rejected, the window NAME must match DRIVE_EXPECT_WINDOW_NAME, and the window part must be a real window in the session (gap-drive-sent-to-manager-pane-not-inner)? [FALLBACK delivery — native cross-session SendMessage is the default]"
  [external-dogfooding-check.ts]="Is the external-dogfooding routine's contract satisfied (cadence, drivable foreign target, tmux remote-drive surface, evidence-backed directive finding)?"
  [execution-policy.ts]="Is an execution policy versioned and authorized for activation (minimal substrate for finding back-propagation)?"
  [fan-in-runid-check.ts]="Does the latest fan-in merge commit carry a runId (so telemetry taskId → git branch is mechanically traceable — the 6%-join fix, gap-task-telemetry-6-percent-join)?"
  [fast-mode-telemetry.ts]="What did the fast mode actually do (telemetry events over a window)?"
  [fan-in-runid-check.ts]="Does the fan-in merge commit under inspection carry a telemetry runId at the fixed position-parseable location — the bridge that makes git landing records and telemetry records joinable (the 6% join-rate defect), with a missing runId or missing fan-in commit reported fail-closed?"
  [fork-baseline.ts]="Should a task fork from develop or integration — dependency-based by default (ref-aware); --force-integration RETIRED (exit 2, gap-worktree-fork-baseline-always-integration: quay's dispatch forks every worktree from \$FORK_BASELINE, drift absorbed by the A6 rebase-rerun loop)?"
  [finding-backpropagate.ts]="Should a finding be back-propagated to the earliest detector that could have caught it (Prepare/Execute feedback)?"
  [full-suite-runner.ts]="Is the full suite green, red, or still running, who ran it, and how long did it take (outer background async runner)?"
  [gate-dispatch-coverage.ts]="Is every registered gate dispatched somewhere (coverage report)?"
  [gate-script-base.ts]="Do TypeScript gate scripts share the framework primitives they need?"
  [gate-staleness-check.sh]="Is the gate ledger fresh — last GateEvent within the claimed period (the SPEC §7 '机制在跑 vs 机制存在' signal)?"
  [gate-staleness-check.ts]="Is the gate ledger fresh — last GateEvent within the claimed period (the SPEC §7 'mechanism running vs mechanism existing' signal)?"
  [git-lens-l-d-code-doc-ratio.ts]="How far is L_D (code:doc line-increment ratio) from its convergence target (ADR-007 lens)?"
  [git-lens-l-g-structural-drift.ts]="How much has the structure drifted from the generative-alignment baseline (ADR-007 L_G lens)?"
  [git-lens-l-s-behavior-variance.ts]="How stable is behavior under light mutation (ADR-007 L_S lens)?"
  [gate-script-lib.sh]="Do bash gate/selfcheck scripts share the framework primitives they need?"
  [halt-check.sh]="Is the layer halted at the unified .halt check point (SPEC 2.8), and is an unmarked stall (no .halt + >24h no output) mechanically reported?"
  [inner-blocked-signal.ts]="Is the inner layer explicitly signalling that it is blocked?"
  [inner-exec-mode-report.ts]="How many main-thread product-file Edits did the inner layer make this round, versus how many Agent dispatches (inner exec-mode report)?"
  [inner-forensics.mjs]="Did the inner layer run a given command, at second-granularity, with zero CPU interference?"
  [inner-idle-log.ts]="Why was the inner layer idle (append-only reason log)?"
  [inner-panel-stale-check.ts]="Is an agent line still on the panel after its bracket closed (ended-vs-running state transition, frozen-timer detection)?"
  [inbox-reader.sh]="Does the human channel's manager inbox have a mechanical reader that consumes every delivered message (delivered ≠ read otherwise)?"
  [inner-session-check.sh]="Is the inner session healthy / empty-shell / missing (three-state cold-start self-check)?"
  [instrument-failure-check.ts]="Which of the manager's five documented instrument-failure families does each shell command in the tick docs exhibit (grep self-match, zero-hit-as-absent, pipe-then-exit-status, ...)?"
  [inner-wakeup-heartbeat-check.ts]="Is the inner ScheduleWakeup fallback heartbeat fresh — .quay/inner-wakeup-heartbeat.json ts within 3 tick periods (5400s) — or dead (inner 兜底心跳断)?"
  [inner-wakeup-heartbeat.ts]="Does the inner layer WRITE the structured wakeup heartbeat — .quay/inner-wakeup-heartbeat.json with the minimal field set (ts/runIds/blocked/budgetHit/effectiveCap/agentDispatches/delaySeconds), fail-closed against a shrunk shape (inner 兜底心跳写入方)?"
  [integration-batch-merge.sh]="Can integration be batch-merged into develop (fast-forward + CAS, fail-closed)?"
  [integration-branch-model.ts]="Which ref should a task fork from — develop (independent) or integration (declared dependency / overlapping unverified work) — and is the integration→develop batch merge fast-forward-safe? NOTE (gap-worktree-fork-baseline-always-integration): forkBaseline() has ZERO production callers (confirmed 2026-08-13); under the new model fork baseline = \$FORK_BASELINE (all tasks from develop), module slated for retirement per AC52."
  [it0-enforcement-with-design-check.sh]="Is every enforced rule backed by a design that explains it (ADR-011)?"
  [it0-enforcement-with-design-check.ts]="Is every enforced rule backed by a design that explains it (canonical gate)?"
  [it0-impl-row-check.sh]="Is every implementation row in a design-only milestone accounted for?"
  [it0-split-or-commit-check.sh]="Did the task either split or commit (no limbo)?"
  [it0-split-or-commit-check.ts]="Did the task either split or commit (single-source enforcement)?"
  [judgment-consumer-check.ts]="For every mechanical judgment in the registry, is there an ACTION that consumes it (判据→消费动作), and is a judgment with no mechanically-verifiable consumer listed unfinished (never silently green)?"
  [known-load-sensitive.ts]="Which test files are KNOWN-LOAD-SENSITIVE family members, and which kind (wall-clock / nested-spawn) does each declare?"
  [laydown-set-check.sh]="Is the cold-start derived-laydown-set green (lay-what-you-verify)?"
  [l1-delivery-surface-check.ts]="Is the SIX-category delivery surface complete — every category has a deliverable and its owning gap task is filed (SPEC §6 machine-readable list)?"
  [laydown-set-check.sh]="Are all scripts in the derived cold-start laydown set present, syntactically valid, and green (gate = lay what you verify)?"
  [loadbearing-test-gate.sh]="Is the load-bearing test present and passing before the milestone may land?"
  [loadbearing-test-gate.ts]="Is the load-bearing test gate satisfied (canonical implementation)?"
  [load-sensitive-release-check.ts]="Is every file being released from a red-window isolation-pass carrying the predeclared KNOWN-LOAD-SENSITIVE marker (predeclared load-sensitivity, not post-hoc isolation-pass release)?"
  [live-repo-literal-assert-check.ts]="Does any test run git against the LIVE repo root (cwd=REPO_ROOT) AND assert a literal number against the git output — the idempotency criterion (活仓库字面断言 ⇒ 违规)?"
  [loop-complete-task.ts]="When the loop completes a task (fan-in + status done), does it record a complete-pass GateEvent through the SAME gate engine the CLI uses (gate-events.jsonl non-empty + quay gate-log <task> readable) — the mechanical ready→done flip the outer 1b calls via QENG runCompleteLoop instead of a direct status write (gap-loop-completion-path-produces-zero-gateevents)?"
  [loop-driver-check.sh]="Is exactly one loop driver running, and is it the sanctioned cron?"
  [loop-shipping-exclusion-data.mjs]="What are the single-source old-path and exclusion entries that the loop-shipping scan and its inert-entry necessity check must not disagree on?"
  [measure-suite-reporter.mjs]="What is each test file's wall-clock duration (custom node:test reporter)?"
  [measure-suite.mjs]="What is the full suite's per-file and wall-clock duration profile?"
  [measure-trend-check.ts]="Is any test file's wall-clock duration growing across full-suite rounds (append-only measure-history.jsonl compare against the previous round)?"
  [monitor-mount-check.sh]="Is the loop monitor actually mounted and aimed at the right target (mounted + targetOk, per-observer streams — delivery is the owner's own Monitor stream)?"
  [monitor-mount-check.sh]="Is the loop monitor actually mounted, on the right target, and delivering events?"
  [needs-human-recheck.ts]="Is the needs-human measurement/aliveness axis live and accurate (the black-hole-human-dependency instrument)?"
  [observer-registry-check.sh]="Is every registered session-liveness observer still alive (registry vs /proc — the observer-kill must have an observer death detector)?"
  [observer-registry.sh]="Is an observed target still alive/intentional — registered active/offline ONCE in the single observer-registry, and do all consumers (os-anchor-watchdog / session-liveness git-staleness + coverage / topology-check) reflect a decommission on their next read (class-level decommission + criterion invalidation)?"
  [os-anchor-install.sh]="Is the OS-level loop watchdog timer installed, active, and removable (the anchor that outlives any Claude session)?"
  [os-anchor-watchdog.sh]="Is the loop's OS-level anchor present for each project — session alive, and if not, re-spawned + driven with the cold-start text?"
  [pane-state-classify.ts]="What state is a Claude Code pane in (busy/idle/blocked)?"
  [periodic-push-backup.sh]="Can this repo's current branch be periodically pushed to the shared bare backup repo (non-force, idempotent)?"
  [pipe-exit-code-check.sh]="Does a pipeline propagate its last command's exit code correctly?"
  [portfolio-choice.ts]="Which non-overlapping milestone portfolio should the next cycle pursue?"
  [precommit-guard.ts]="At commit/merge time: ① do the DOC-CLASS checks pass (AC51 断言面拆分 — doc consistency checks moved out of the full suite into pre-commit: bash scripts/test.sh --static-checks-doc, seconds-level feedback instead of an 8-minute round, and editing docs no longer makes a running round red)? ② is a commit OR a merge being made while a suite round is running (state=running in .quay/full-suite-state.json) AND it touches CODE-class assertion-surface files (the doc files are excluded via run_doc_checks' @static-class doc objects; plugin/scripts/judged-object-registry.json; missing/empty falls back to the narrowed surface tasks/** + plugin/loop/** + scripts/test.sh @static-object aggregate minus doc-class) — the pre-commit AND pre-merge-commit guard that makes 'no commits/merges during a round' mechanically enforced for ALL writers (outer/manager/inner; git merge --no-ff does NOT fire pre-commit, so --install-hook also wires pre-merge-commit with --merge, gap-precommit-guard-merge-bypass), fail-loud on a missing/null state file, with an explicit --allow-dirty-round override that does NOT bypass doc-check failures?"
  [prefriction-count.sh]="How many newly-filed tasks had no triggering failure/alarm/contradiction at filing (the falsifiable pre-friction count)?"
  [preparation-feedback.ts]="What feedback should the preparation phase return to the proposer?"
  [prepare-admission-check.ts]="Is it safe for this milestone to acquire the single-flight admission lease?"
  [pool-quality-judge.ts]="Should the pool 任务质量语义闸 run — the mechanical triggers (pool>25 / 最久未复核>48h / 每 10 轮) + pool enumeration + per-task mechanical AC input + verdict aggregation (ready/needs-work/should-remove/uncertain, should-remove → 撤出/重定范围) — the deterministic half of the ADR-033 pool-quality-judge workflow (gap-pool-quality-semantic-gate)?"
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
  [release-freshness-check.sh]="Is the latest release FRESH — how far develop has run ahead of the latest release tag (重切触发, release_ahead vs recut threshold) and does the release 产物 tree drift from develop's mechanism set (漂移闸, drift_dirs)?"
  [release-task.sh]="How does a machine release a task/branch claim?"
  [resource-gate.sh]="Is it resource-safe to start a heavy operation now?"
  [process-budget.sh]="What is the current test-process budget — how many throttle-able test workers are in use vs the nproc total?"
  [routine-file-gate.ts]="Is this routine finding novel, high-quality, and within rate limits?"
  [routine-scheduler.ts]="Which routine probes are due to run now?"
  [run-identity.ts]="What is this run's canonical identity (reproducible handle)?"
  [runtime-usage-inventory.ts]="What does the two-layer mode actually run, and is any of it unaccounted?"
  [select-static-checks-for-touches.ts]="Which static checks should a scoped run execute for this change's touched files (change-relevant tier)?"
  [select-tests-for-touches.ts]="Which tests should run for this task's ## Touches?"
  [self-report-vocab-audit.ts]="Do the inner's recent self-reports avoid batch-style vocabulary (reanchor convergence)?"
  [semantic-observer-judge.ts]="Is the inner/outer layer semantically stopped and awaiting an external action — reading FREE TEXT (heartbeat reason + tick report transcript), not just structured fields — outputting {stopped, awaiting, needs, contradictsStructured, confidence}, where contradictsStructured names the failure (structured says blocked=[], free text says 'dispatch stopped, awaiting outer /clear')?"
  [red-on-omission-audit.ts]="Is every solidified behavior able to point at a reading that turns RED when it is NOT done (AC41 判据 3) — the registry lists each behavior → redReading and mechanically verifies the reading is declared in the workspace; missing readings are listed 未固化 (uncov>0 ⇒ exit 1), with a15_ruling5 / scope_worktree_gate / ruling5_status as invariants?"
  [self-report-vocab-check.ts]="Has the inner layer's self-reported vocabulary drifted from the shipped semantics (reanchor convergence)?"
  [send-keys-reliable.sh]="Did the reliable five-step send-keys sequence land in the foreign session? [FALLBACK delivery — native cross-session SendMessage is the default]"
  [serial-fanin-absorb.ts]="How should concurrent survivors be absorbed serially at fan-in?"
  [session-liveness-mount.sh]="Is a session-liveness observer mounted (one observer per consumer — who mounts owns its own stdout stream, no lock, no shared file)?"
  [session-liveness.sh]="Is a Claude Code session alive, busy, and within heartbeat (pure read-only observation, per-observer event stream)?"
  [session-bootstrap.sh]="Can a bare machine be bootstrapped into the named tmux layout with each window's claude process confirmed live (fail-closed by name)?"
  [session-liveness-sweep.mjs]="What per-run /tmp/quay-run-* namespace residue should be cleaned (fs-only owner-liveness sweepers the full-suite-runner calls before/after the suite — runtime imports MUST live in a shipped module, not the test helper which package.sh excludes)?"
  [session-liveness-mount.sh]="Is the session-liveness monitor mounted as the single observer?"
  [session-liveness.sh]="Is the inner Claude Code session alive, busy, and within heartbeat?"
  [orphan-session-check.ts]="Are there live claude sessions whose workspace has been deleted/orphaned — claude --settings <path> processes whose workspace dir no longer exists (the 4-orphan 109-120h leak; orphan_count>0 ⇒ red)?"
  [slot-free-trigger.ts]="Is a dispatch slot free while dispatchable work waits (in_flight<cap ∧ dispatchable>0), and has the outer been notified to drive inner refill (the empty-slot event executor)?"
  [slot-refill.ts]="Should a freed dispatch slot be refilled immediately (event-driven dispatch, completion-triggered)? Also which ready-pool candidates were DEFERRED this round and why (deferred array — gap-over90-clock-measures-queue-time-not-work-time: the tick closes their open brackets via closure-lag-check.sh --close-task --outcome deferred so the queue segment never counts toward OVER90)?"
  [slot-refill.sh]="Should a released slot be refilled from the ready pool now (bash invocation of the refill evaluator)?"
  [slot-refill.ts]="Should a released slot be refilled from the ready pool now (event-driven dispatch refill evaluator)?"
  [stage-receipt.ts]="Is a stage receipt valid per the canonical versioned schema family (FindingEnvelope / StageEvent / StageReceiptEnvelope / ReceiptValidationResult)?"
  [stale-ready-audit.ts]="Which ready tasks carry a non-empty ## Evidence + ≥1 checked AC — stale-ready candidates whose work was fan-in merged but whose status was never flipped to done (the outer's per-tick stale-ready reading; list for the outer to flip, read-only)?"
  [suite-state-trigger.ts]="Has the full-suite state changed to red or running, and has the outer been notified (the red-window auto-executor)?"
  [state-worded-clause-check.ts]="Is every executable clause in the three tick-cores an ACTION + mechanically verifiable product (run THIS command, wait for THAT reading), never a result state (自测绿/确保/保证/直到…绿), band 0?"
  [strategic-doc-staleness-check.ts]="Does a strategic doc reference a deleted path or a retired ADR mechanism?"
  [tick-core-static-check.ts]="Are the three execution cores (orchestration/*-tick-core.md) fully covered by (src:N) references (target 100% — AC30(a) RETIRED the ≤80-line ceiling, the measure is now (src:N) coverage), every pointer target existing, the B3 group numbering (甲乙丙丁戊) distinct from the criteria numbering (①-⑤), and the four prohibition docs consistent with the cores' run_in_background dispatch?"
  [suite-state-trigger.ts]="Has the full-suite state changed to red or running, and has the outer been notified (the red-window auto-executor)?"
  [supervisor-bus.sh]="Can a cross-session message be delivered with sender identity (layer + project) through the ONE hardened delivery path, with the delivery event recorded as who → who → when → delivered in an attributable ledger?"
  [supervisor-bus-identity.sh]="Can a message's claimed sender identity be mechanically verified (an agent claiming from:human is REJECTED) and is the manager-inbox's delivered/consumed/unread visible to the tick?"
  [supervisor-deliver.sh]="Did a payload get delivered to a target Claude session, by intent, via the single hardened delivery implementation (deliver(target,payload) -> delivered|failed)? [FALLBACK delivery — native cross-session SendMessage is the default]"
  [supervisor-observe.sh]="What is a target quay checkout's git/suite/session/process state right now, read-only and ssh-transport-agnostic (observe(target) -> {git_state, suite_state, session_state, process_state}, local/remote same shape)?"
  [supervisor-health.sh]="Is the supervisor base layer alive outside any Claude session (os-anchor timer + delivery/observe adapters + session liveness)?"
  [supervisor-preempt.sh]="Is the loop stopped at ANY point (preemptive .halt — process-level preempt(target) enforced in code, not just at a tick boundary)?"
  [supervisor-preempt-candidates.ts]="Is a task deterministically preemptible right now (queryable facts only: telemetry duration >90m + task status in-progress + not landed), and can it be preempted as a deterministic action (kill its subprocess tree + close its bracket + record a ledger event)?"
  [cross-machine-verify.sh]="Has every merge that landed on the tracked branches been cross-machine verified by a NON-participating machine, and what is the detection latency d (post_merge_latency_h) of the ones that have?"
  [sync-lag-check.sh]="Is local <fork-baseline> (develop) leading origin/<fork-baseline>, and has it been pushed (the cross-machine sync heartbeat + the event-driven push after a land closure)?"
  [sync-vendor.sh]="Is the plugin's vendored runtime in sync with the product build?"
  [malformed-task-check.ts]="Are any task files malformed (frontmatter failed to parse — the silent-vanish defect that drops a task from the whole store with only a task-list Warning)?"
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
  [threshold-scope-check.ts]="Does a driver doc's quantified stop-condition name its set AND window, and does every backtick-named path resolve (three-layer judgment, placeholder-skipped, with the violations ratchet shrinking)?"
  [test-isolation-check.sh]="Is every test isolated per the test-isolation contract (and is the violation ratchet shrinking)?"
  [test-isolation-check.ts]="Is every test isolated per the contract (report-only scan)?"
  [threshold-scope-check.ts]="Does a driver doc's quantified stop-condition name its set AND window, and does every backtick-named path resolve (three-layer judgment, placeholder-skipped, with the violations ratchet shrinking)?"
  [tmp-leak-pairing-check.sh]="Is every mkdtemp/mkdtempSync result in a test file paired with a cleanup (rmSync / after() carrier / caller-cleans-return) — the /tmp-leak gate (thin wrapper delegating to tmp-leak-pairing-check.ts)?"
  [tmp-leak-pairing-check.ts]="Is every mkdtemp/mkdtempSync result in a test file paired with a cleanup — the mechanical /tmp-leak detector (BLOCKS on any unpaired mkdtemp, unlike test-isolation-check's baselined R6)?"
  [tmux-isolated.sh]="Is TMUX unset before the test runs (isolation from the driver session)?"
  [tmux-leak-scan.sh]="Did a test run leak any tmux server or characteristic temp dir (suite-tail residual-leak assertion)?"
  [tmux-session.ts]="Is a test's tmux invocation isolated to a private socket (explicit -S + $TMUX stripped — both mandatory conditions structural)?"
  [tmux-test-isolation-check.ts]="Does any test file spawn real tmux without an isolation mechanism or both mandatory conditions (the bare default-socket crash path)?"
  [topology-check.sh]="Does the target tmux session have all three topology windows in place, each with a claude process (not a bare bash window)?"
  [touches-orthogonality-check.ts]="Do two milestones' ## Touches overlap?"
  [touches-parser.ts]="What files does this task's ## Touches declare?"
  [unverified-integration-task-ids.ts]="Which unverified task ids are pending on integration (develop..integration fan-in merges) to feed --overlaps-unverified (fixing the permanently-false overlap path)?"
  [trend-check.ts]="Is any quality axis trending worse than last time (suite per-test cost, early-RED detection latency, per-checker cost) over a window — even while each point is individually green (the point-in-time blind spot)?"
  [transcript-delivery-check.ts]="Did the reliable-send procedure deliver the transcript (delivery verdict)? [FALLBACK delivery — native cross-session SendMessage is the default]"
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
  [checker-lib.ts]="Do the shared checker primitives — matchAtCommandPosition (按位置不按关键词) and enumerativeExistence (枚举式存在性) — behave correctly, so a new checker stops re-implementing them?"
  [mechanism-vitality-check.ts]="Which shipped mechanisms are zero-call past 3x their declared cadence (待表态), have a stale last-reaffirmed stamp (待重新确认), or lack a 失效前提 field (entry-gate reject)?"
  [md-deletion-token-evaporation-check.sh]="Did any commit net-deleting ≥50 lines from *.md leave deleted-content unique tokens (identifiers/paths/专名) with ZERO occurrence in the post-delete repo (来源完备性整段蒸发)?"
)

# ── CADENCE (cadence declaration (②a, gap-crystallization-five-directions) — every declared check declares how often it is supposed to run; 零调用 > 3× 声明周期 → 待表态 (not a uniform day count)) ──
declare -A CADENCE=(
  [a15-ruling5-counter.ts]="每轮"
  [ac36-sortkey-criterion-check.ts]="按需"
  [accounting-emit.ts]="每轮"
  [accounting-emit-layer-map.ts]="每轮"
  [adr016-screen-use-check.ts]="每轮"
  [anti-drift-touches-check.ts]="按需"
  [anti-gaming-guard.sh]="冷启动"
  [anti-gaming-guard.ts]="冷启动"
  [assert-clean-tree.sh]="每轮"
  [audit-independence-check.sh]="按需"
  [audit-independence-check.ts]="按需"
  [axis-generator.ts]="按需"
  [blocked-signal-check.sh]="每轮"
  [build-evidence-collector.ts]="每里程碑"
  [build-evidence-gate.ts]="每里程碑"
  [build-evidence-manifest.ts]="每里程碑"
  [candidate-contracts.ts]="每里程碑"
  [candidate-synthesis.ts]="每里程碑"
  [cap-from-gate.sh]="每轮"
  [cap-from-gate.ts]="每轮"
  [capability-catalog.sh]="每轮"
  [checker-cost-lib.sh]="每红窗"
  [checker-cost.sh]="每红窗"
  [checker-cost.ts]="每红窗"
  [checker-lib.ts]="按需"
  [checker-mutation-check.sh]="每轮"
  [claim-task.sh]="按需"
  [claim-task.ts]="按需"
  [closure-lag-check.sh]="每轮"
  [codex-stage1-live-proof-check.ts]="按需"
  [codex-stage1-selfcheck.sh]="按需"
  [commit-message-verified-check.ts]="每轮"
  [concurrency-literal-check.ts]="每轮"
  [concurrent-batch-scheduler.ts]="每里程碑"
  [config-wiring-check.ts]="按需"
  [coupling-graph.ts]="每里程碑"
  [cross-machine-verify.sh]="每轮"
  [dead-code-after-return-check.ts]="每轮"
  [dead-loop-check.sh]="每轮"
  [derive-touches-heuristic.ts]="每里程碑"
  [delivery-inventory-drift-gate.sh]="每轮"
  [develop-deliver-tgz.sh]="每轮"
  [drivable-workspace-check.sh]="按需"
  [drivable-workspace-check.ts]="按需"
  [drive-contract-check.ts]="每轮"
  [drive-target-check.sh]="每轮"
  [execution-policy.ts]="每里程碑"
  [external-dogfooding-check.ts]="按需"
  [fan-in-runid-check.ts]="按需"
  [fast-mode-telemetry.ts]="每轮"
  [fan-in-runid-check.ts]="按需"
  [finding-backpropagate.ts]="每里程碑"
  [fork-baseline.ts]="每里程碑"
  [full-suite-runner.ts]="每轮"
  [gate-dispatch-coverage.ts]="每轮"
  [gate-script-base.ts]="按需"
  [gate-script-lib.sh]="按需"
  [gate-staleness-check.sh]="每轮"
  [gate-staleness-check.ts]="每轮"
  [git-lens-l-d-code-doc-ratio.ts]="按需"
  [git-lens-l-g-structural-drift.ts]="按需"
  [git-lens-l-s-behavior-variance.ts]="按需"
  [halt-check.sh]="每轮"
  [inbox-reader.sh]="每轮"
  [inner-blocked-signal.ts]="每轮"
  [inner-exec-mode-report.ts]="每轮"
  [inner-forensics.mjs]="每轮"
  [inner-idle-log.ts]="每轮"
  [inner-panel-stale-check.ts]="每轮"
  [inner-session-check.sh]="每轮"
  [inner-wakeup-heartbeat-check.ts]="每轮"
  [inner-wakeup-heartbeat.ts]="每轮"

  [instrument-failure-check.ts]="每轮"
  [integration-batch-merge.sh]="按需"
  [integration-branch-model.ts]="按需"
  [it0-enforcement-with-design-check.sh]="按需"
  [it0-enforcement-with-design-check.ts]="按需"
  [it0-impl-row-check.sh]="按需"
  [it0-split-or-commit-check.sh]="每轮"
  [it0-split-or-commit-check.ts]="按需"
  [judgment-consumer-check.ts]="按需"
  [known-load-sensitive.ts]="按需"
  [l1-delivery-surface-check.ts]="每轮"
  [laydown-set-check.sh]="按需"
  [load-sensitive-release-check.ts]="每轮"
  [live-repo-literal-assert-check.ts]="每轮"
  [loadbearing-test-gate.sh]="每红窗"
  [loadbearing-test-gate.ts]="每红窗"
  [loop-complete-task.ts]="每轮"
  [loop-driver-check.sh]="每轮"
  [loop-shipping-exclusion-data.mjs]="按需"
  [manager-adopt.sh]="每轮"
  [manager-arm-loop.sh]="每轮"
  [manager-observation-runtime-check.ts]="每轮"
  [manager-start.sh]="每轮"
  [manager-tick-log-check.sh]="每轮"
  [manager-tick-readings.ts]="每轮"
  [md-deletion-token-evaporation-check.sh]="按需"
  [measure-suite-reporter.mjs]="每轮"
  [measure-suite.mjs]="每轮"
  [measure-trend-check.ts]="每轮"
  [mechanism-vitality-check.ts]="每轮"
  [monitor-mount-check.sh]="每轮"
  [needs-human-recheck.ts]="每里程碑"
  [no-manager-tick-doc-check.ts]="每轮"
  [observer-registry-check.sh]="按需"
  [observer-registry.sh]="每轮"
  [os-anchor-install.sh]="每轮"
  [os-anchor-watchdog.sh]="每轮"
  [outer-tick-log-check.sh]="每轮"
  [pane-state-classify.ts]="每轮"
  [periodic-push-backup.sh]="每轮"
  [pipe-exit-code-check.sh]="按需"
  [portfolio-choice.ts]="每里程碑"
  [precommit-guard.ts]="每轮"
  [prefriction-count.sh]="每轮"
  [preparation-feedback.ts]="每里程碑"
  [prepare-admission-check.ts]="每里程碑"
  [pool-quality-judge.ts]="按需"
  [process-budget.sh]="每轮"
  [provision-verify-worktree.sh]="每红窗"
  [proposal-convergence.ts]="每里程碑"
  [publish-dist-branch.sh]="冷启动"
  [quay-branch.ts]="按需"
  [quay-check.ts]="按需"
  [quay-deliver.ts]="按需"
  [quay-dispatch.ts]="按需"
  [quay-entry-base.ts]="按需"
  [quay-init.sh]="冷启动"
  [quay-launch.sh]="冷启动"
  [quay-session.ts]="按需"
  [quay-suite.ts]="按需"
  [quay-topology.sh]="每轮"
  [read-probe-spec.ts]="每里程碑"
  [ready-pool-check.ts]="每里程碑"
  [real-target-verify.sh]="冷启动"
  [red-window-triage.ts]="每轮"
  [release-freshness-check.sh]="每里程碑"
  [release-task.sh]="按需"
  [resource-gate.sh]="每轮"
  [routine-file-gate.ts]="每里程碑"
  [routine-scheduler.ts]="每里程碑"
  [run-identity.ts]="每里程碑"
  [runtime-usage-inventory.ts]="每轮"
  [select-static-checks-for-touches.ts]="按需"
  [select-tests-for-touches.ts]="按需"
  [self-report-vocab-audit.ts]="每轮"
  [self-report-vocab-check.ts]="每轮"
  [send-keys-reliable.sh]="每轮"
  [serial-fanin-absorb.ts]="每轮"
  [session-bootstrap.sh]="每轮"
  [session-liveness-mount.sh]="每轮"
  [session-liveness-sweep.mjs]="每轮"
  [session-liveness.sh]="每轮"
  [slot-free-trigger.ts]="每轮"
  [orphan-session-check.ts]="每轮"
  [slot-refill.sh]="每轮"
  [slot-refill.ts]="每轮"
  [stage-receipt.ts]="每里程碑"
  [stale-ready-audit.ts]="每轮"
  [strategic-doc-staleness-check.ts]="每轮"
  [tick-core-static-check.ts]="每轮"
  [suite-cutoff-verdict.mjs]="每轮"
  [suite-execution-form-counter.ts]="每轮"
  [state-worded-clause-check.ts]="每轮"
  [suite-state-trigger.ts]="每轮"
  [supervisor-bus-identity.sh]="每轮"
  [supervisor-bus.sh]="每轮"
  [supervisor-deliver.sh]="每轮"
  [supervisor-health.sh]="每轮"
  [supervisor-observe.sh]="每轮"
  [supervisor-preempt-candidates.ts]="每轮"
  [supervisor-preempt.sh]="每轮"
  [sync-lag-check.sh]="每轮"
  [sync-vendor.sh]="每轮"
  [malformed-task-check.ts]="每轮"
  [task-ac-carryover-check.ts]="每轮"
  [task-contract-check.ts]="每轮"
  [task-schema-check.sh]="每里程碑"
  [task-schema-check.ts]="每里程碑"
  [task-schema.ts]="每里程碑"
  [task-status-drift-check.ts]="每轮"
  [test-file-baseline.ts]="每红窗"
  [test-file-snapshot.sh]="每红窗"
  [test-framework-policy-check.sh]="每轮"
  [test-framework-policy-check.ts]="每轮"
  [test-impl-census-check.ts]="每轮"
  [test-isolation-check.sh]="每轮"
  [test-isolation-check.ts]="每轮"
  [threshold-scope-check.ts]="每轮"
  [tmp-leak-pairing-check.sh]="每轮"
  [tmp-leak-pairing-check.ts]="每轮"
  [tmux-isolated.sh]="按需"
  [tmux-leak-scan.sh]="按需"
  [tmux-session.ts]="按需"
  [tmux-test-isolation-check.ts]="按需"
  [topology-check.sh]="每轮"
  [touches-orthogonality-check.ts]="每里程碑"
  [touches-parser.ts]="每里程碑"
  [transcript-delivery-check.ts]="每轮"
  [tree-hygiene-check.sh]="每轮"
  [trend-check.ts]="每轮"
  [unverified-integration-task-ids.ts]="每里程碑"
  [verify-delivery-surface.ts]="每轮"
  [verify-installed-executables.sh]="冷启动"
  [vmeta-lag-check.sh]="按需"
  [vmeta-lag-check.ts]="按需"
  [wiring-coverage-check.ts]="每里程碑"
  [workflow-baseline-metrics.ts]="每里程碑"
  [workflow-event-schema.mjs]="每里程碑"
  [workflow-invariant-ownership.mjs]="每里程碑"
  [workflow-journal.ts]="每里程碑"
  [workflow-metadata-conformance.mjs]="每里程碑"
  [workflow-replay.ts]="每里程碑"
  [worktree-branch-hygiene-check.sh]="每轮"
  [obligation-discharge-agent.ts]="按需"
  [obligation-ledger-check.ts]="每轮"
  [obligation-ledger.ts]="每轮"
  [semantic-observer-judge.ts]="按需"
  [red-on-omission-audit.ts]="每轮"

)

# ── INVALIDATION (invalidation-precondition declaration (①) — every hard constraint / mechanism declaration carries a 失效前提 field; when a testable precondition can be written, write it, when not, mark the explicit '无可测前提，靠周期复核' (标出来别假装有). Missing field = entry-gate reject below) ──
declare -A INVALIDATION=(
  [a15-ruling5-counter.ts]="失效前提：外层仍通过 transcript 心跳判执行；若执行面 API 化不再依赖 Agent tool_use 时间戳（不再有 transcript 可读），本条退休"
  [ac36-sortkey-criterion-check.ts]="失效前提：slot-refill --json 仍暴露 ranking 数组（移除或改形状则判据② 失去机械读面，本条失效）"
  [accounting-emit.ts]="无可测前提，靠周期复核"
  [accounting-emit-layer-map.ts]="失效前提：accounting-emit.ts 仍从 layer-map 解析每层机制（若映射内联回 emitter / 每层硬编码 / 改由 provider 声明，本条失去机械读面，退休）"
  [adr016-screen-use-check.ts]="失效前提：远程驱动仍通过 tmux capture-pane 观测（ADR-016 仍生效）；若驱动面改为非 TUI 协议，本条退休"
  [anti-drift-touches-check.ts]="无可测前提，靠周期复核"
  [anti-gaming-guard.sh]="无可测前提，靠周期复核"
  [anti-gaming-guard.ts]="无可测前提，靠周期复核"
  [assert-clean-tree.sh]="无可测前提，靠周期复核"
  [audit-independence-check.sh]="无可测前提，靠周期复核"
  [audit-independence-check.ts]="无可测前提，靠周期复核"
  [axis-generator.ts]="无可测前提，靠周期复核"
  [blocked-signal-check.sh]="无可测前提，靠周期复核"
  [build-evidence-collector.ts]="无可测前提，靠周期复核"
  [build-evidence-gate.ts]="无可测前提，靠周期复核"
  [build-evidence-manifest.ts]="无可测前提，靠周期复核"
  [candidate-contracts.ts]="无可测前提，靠周期复核"
  [candidate-synthesis.ts]="无可测前提，靠周期复核"
  [cap-from-gate.sh]="无可测前提，靠周期复核"
  [cap-from-gate.ts]="无可测前提，靠周期复核"
  [capability-catalog.sh]="失效前提：仓库仍以脚本文件系统为交付面（plugin/scripts/*.{sh,ts,mjs}）；若交付形式改为单一打包产物（脚本不再是独立文件），本条的表驱动判定不再适用"
  [checker-cost-lib.sh]="无可测前提，靠周期复核"
  [checker-cost.sh]="无可测前提，靠周期复核"
  [checker-cost.ts]="无可测前提，靠周期复核"
  [checker-lib.ts]="失效前提：仍有检查器需要位置判定/枚举式存在性原语；若无任何 import 者，本条按 ④ 失效"
  [checker-mutation-check.sh]="无可测前提，靠周期复核"
  [claim-task.sh]="无可测前提，靠周期复核"
  [claim-task.ts]="无可测前提，靠周期复核"
  [closure-lag-check.sh]="无可测前提，靠周期复核"
  [codex-stage1-live-proof-check.ts]="无可测前提，靠周期复核"
  [codex-stage1-selfcheck.sh]="无可测前提，靠周期复核"
  [commit-message-verified-check.ts]="失效前提：提交消息仍以自然语言文本承载已验证断言（git 仍是历史载体）；若提交消息面改为结构化元数据（验证命令成为独立字段而非消息文本），本条退休"
  [concurrency-literal-check.ts]="失效前提：并发值全部从唯一定义点（QUAY_MAX_* env 读）派生且无人再写字面量；若并发配置整体迁出代码面（如纯配置化且无 fallback 字面量），本条退休"
  [concurrent-batch-scheduler.ts]="无可测前提，靠周期复核"
  [config-wiring-check.ts]="无可测前提，靠周期复核"
  [coupling-graph.ts]="无可测前提，靠周期复核"
  [cross-machine-verify.sh]="无可测前提，靠周期复核"
  [dead-code-after-return-check.ts]="无可测前提，靠周期复核"
  [dead-loop-check.sh]="无可测前提，靠周期复核"
  [derive-touches-heuristic.ts]="无可测前提，靠周期复核"
  [delivery-inventory-drift-gate.sh]="失效前提：outline §6 DELIVERY-INVENTORY 仍是 verify-delivery-surface --inventory 的派生快照且 plugin/scripts 仍按目录计数；若计数改为单一打包产物/取消目录计数，本条退休"
  [develop-deliver-tgz.sh]="失效前提：投递面仍为 B/C 两台 ssh 可达的验证机且 quay 仍以硬件无关 .tgz 分发；若投递面迁出 ssh/tmux 协议或产物改回 arch-bound SEA，本条退休"
  [drivable-workspace-check.sh]="无可测前提，靠周期复核"
  [drivable-workspace-check.ts]="无可测前提，靠周期复核"
  [drive-contract-check.ts]="失效前提：外层仍以驱动文本（drive text）派发/steer 任务；若派发改为纯 API/结构化消息（无 prose drive text），本条退休"
  [drive-target-check.sh]="失效前提：外层仍通过 tmux 远程驱动/观测别的 Claude 会话；若投递/观测面迁出 TUI（全 API 化），本条退休"
  [execution-policy.ts]="无可测前提，靠周期复核"
  [external-dogfooding-check.ts]="无可测前提，靠周期复核"
  [fan-in-runid-check.ts]="失效前提：遥测 taskId → git 分支的可回溯桥仍由 fan-in 提交信息承载 runId；若改走独立 manifest（非提交信息），本条退休"
  [fast-mode-telemetry.ts]="无可测前提，靠周期复核"
  [fan-in-runid-check.ts]="失效前提：fan-in 提交仍通过 git merge 落地且提交信息可见（若 fan-in 不再产生带 subject 的 merge 提交，本条失去机械读面，退休）"
  [finding-backpropagate.ts]="无可测前提，靠周期复核"
  [fork-baseline.ts]="无可测前提，靠周期复核"
  [full-suite-runner.ts]="无可测前提，靠周期复核"
  [gate-dispatch-coverage.ts]="无可测前提，靠周期复核"
  [gate-script-base.ts]="失效前提：仍有 TypeScript gate 脚本共享框架原语；若无 .ts import 者，本条按 ④ 失效"
  [gate-script-lib.sh]="失效前提：仍有 bash gate/selfcheck 脚本共享框架原语；若无 .sh source 者，本条按 ④ 失效"
  [gate-staleness-check.sh]="无可测前提，靠周期复核"
  [gate-staleness-check.ts]="无可测前提，靠周期复核"
  [git-lens-l-d-code-doc-ratio.ts]="无可测前提，靠周期复核"
  [git-lens-l-g-structural-drift.ts]="无可测前提，靠周期复核"
  [git-lens-l-s-behavior-variance.ts]="无可测前提，靠周期复核"
  [halt-check.sh]="无可测前提，靠周期复核"
  [inbox-reader.sh]="失效前提：仍存在 delivered→consumed 收件箱协议；若协议迁移，本条退休"
  [inner-blocked-signal.ts]="无可测前提，靠周期复核"
  [inner-exec-mode-report.ts]="无可测前提，靠周期复核"
  [inner-forensics.mjs]="无可测前提，靠周期复核"
  [inner-idle-log.ts]="无可测前提，靠周期复核"
  [inner-panel-stale-check.ts]="无可测前提，靠周期复核"
  [inner-session-check.sh]="无可测前提，靠周期复核"
  [inner-wakeup-heartbeat-check.ts]="失效前提：inner 自排程仍写心跳文件；若改由 harness 直接上报，本条退休"
  [inner-wakeup-heartbeat.ts]="失效前提：inner 自排程仍以脚本写心跳文件；若改由 harness 直接上报，本条退休"

  [instrument-failure-check.ts]="失效前提：tick 文档仍以 shell 命令承载判据；若判据迁出 shell，本条退休"
  [integration-batch-merge.sh]="无可测前提，靠周期复核"
  [integration-branch-model.ts]="无可测前提，靠周期复核"
  [it0-enforcement-with-design-check.sh]="无可测前提，靠周期复核"
  [it0-enforcement-with-design-check.ts]="无可测前提，靠周期复核"
  [it0-impl-row-check.sh]="无可测前提，靠周期复核"
  [it0-split-or-commit-check.sh]="无可测前提，靠周期复核"
  [it0-split-or-commit-check.ts]="无可测前提，靠周期复核"
  [judgment-consumer-check.ts]="失效前提：判据仍以脚本/执行核文档承载且 registry 存在；若判据体系改为纯 API/结构化消息（无 prose 判据），本条退休"
  [known-load-sensitive.ts]="无可测前提，靠周期复核"
  [l1-delivery-surface-check.ts]="无可测前提，靠周期复核"
  [laydown-set-check.sh]="无可测前提，靠周期复核"
  [load-sensitive-release-check.ts]="无可测前提，靠周期复核"
  [live-repo-literal-assert-check.ts]="无可测前提，靠周期复核（测试若全部改为 git-init 临时仓或相对断言，则无活仓库字面断言可检，本条失效）"
  [loadbearing-test-gate.sh]="无可测前提，靠周期复核"
  [loadbearing-test-gate.ts]="无可测前提，靠周期复核"
  [loop-complete-task.ts]="loop 收尾（外层 1b 翻 done）不再调本脚本而改回直接写 status: done（grep orchestrator-loop-tick.md / orchestrator-tick-core.md 的 loop-complete-task.ts 调用消失）⇒ 无 GateEvent 缺陷复发"
  [loop-driver-check.sh]="无可测前提，靠周期复核"
  [loop-shipping-exclusion-data.mjs]="无可测前提，靠周期复核"
  [manager-adopt.sh]="无可测前提，靠周期复核"
  [manager-arm-loop.sh]="无可测前提，靠周期复核"
  [manager-observation-runtime-check.ts]="无可测前提，靠周期复核"
  [manager-start.sh]="无可测前提，靠周期复核"
  [manager-tick-log-check.sh]="无可测前提，靠周期复核"
  [manager-tick-readings.ts]="无可测前提，靠周期复核"
  [md-deletion-token-evaporation-check.sh]="失效前提：批量删除仍以 git 提交为单位可审计；若删除改走 API，本条退休"
  [measure-suite-reporter.mjs]="无可测前提，靠周期复核"
  [measure-suite.mjs]="无可测前提，靠周期复核"
  [measure-trend-check.ts]="无可测前提，靠周期复核"
  [mechanism-vitality-check.ts]="失效前提：catalog 仍声明 cadence/失效前提/last-reaffirmed 字段且仓库仍以 git 为唯一权威历史；若这些字段被移除或历史源变更，本条退休"
  [monitor-mount-check.sh]="无可测前提，靠周期复核"
  [needs-human-recheck.ts]="无可测前提，靠周期复核"
  [no-manager-tick-doc-check.ts]="失效前提：外层 tick 文档仍可能含 create/drive/check manager 步骤；若 manager 职责迁移出外层文档，本条退休"
  [observer-registry-check.sh]="无可测前提，靠周期复核"
  [observer-registry.sh]="失效前提：观测者目标仍登记于单一 observer-registry.conf 且消费者每次读它；若回归各自维护目标列表（不再读单一注册表），本条退休"
  [os-anchor-install.sh]="无可测前提，靠周期复核"
  [os-anchor-watchdog.sh]="无可测前提，靠周期复核"
  [outer-tick-log-check.sh]="无可测前提，靠周期复核"
  [pane-state-classify.ts]="失效前提：仍用 tmux capture-pane 观测 pane；若观测面迁移出 TUI，本条退休"
  [periodic-push-backup.sh]="无可测前提，靠周期复核"
  [pipe-exit-code-check.sh]="无可测前提，靠周期复核"
  [portfolio-choice.ts]="无可测前提，靠周期复核"
  [precommit-guard.ts]="失效前提：提交路径仍经 git commit 与 .git/hooks/pre-commit（git 仍是唯一提交载体）；若提交面改为非 git 传输，或 pre-commit 钩子被全局禁用（core.hooksPath 重定向 / --no-verify 成常规绕过），本条退休"
  [prefriction-count.sh]="无可测前提，靠周期复核"
  [preparation-feedback.ts]="无可测前提，靠周期复核"
  [prepare-admission-check.ts]="无可测前提，靠周期复核"
  [pool-quality-judge.ts]="失效前提：pool 质量仍由 schema'd agent 判定（ADR-033，判定在 .claude/workflows/pool-quality-judge.js）；若质量判定改为纯机械或取消 pool 语义闸，本条退休"
  [process-budget.sh]="无可测前提，靠周期复核"
  [provision-verify-worktree.sh]="无可测前提，靠周期复核"
  [proposal-convergence.ts]="无可测前提，靠周期复核"
  [publish-dist-branch.sh]="无可测前提，靠周期复核"
  [quay-branch.ts]="无可测前提，靠周期复核"
  [quay-check.ts]="无可测前提，靠周期复核"
  [quay-deliver.ts]="无可测前提，靠周期复核"
  [quay-dispatch.ts]="无可测前提，靠周期复核"
  [quay-entry-base.ts]="无可测前提，靠周期复核"
  [quay-init.sh]="无可测前提，靠周期复核"
  [quay-launch.sh]="无可测前提，靠周期复核"
  [quay-session.ts]="无可测前提，靠周期复核"
  [quay-suite.ts]="无可测前提，靠周期复核"
  [quay-topology.sh]="无可测前提，靠周期复核"
  [read-probe-spec.ts]="无可测前提，靠周期复核"
  [ready-pool-check.ts]="无可测前提，靠周期复核"
  [real-target-verify.sh]="无可测前提，靠周期复核"
  [red-window-triage.ts]="无可测前提，靠周期复核"
  [release-freshness-check.sh]="失效前提：release 仍以 git tag 树对比 develop 机制集（DELIVERY_INVENTORY 目录计数镜像，verify-delivery-surface.ts 为单源）且 recut 阈值可配置；若 release 产物取消目录计数或交付面迁出 git 树对比，本条退休"
  [release-task.sh]="无可测前提，靠周期复核"
  [resource-gate.sh]="无可测前提，靠周期复核"
  [routine-file-gate.ts]="无可测前提，靠周期复核"
  [routine-scheduler.ts]="无可测前提，靠周期复核"
  [run-identity.ts]="无可测前提，靠周期复核"
  [runtime-usage-inventory.ts]="无可测前提，靠周期复核"
  [select-static-checks-for-touches.ts]="无可测前提，靠周期复核"
  [select-tests-for-touches.ts]="无可测前提，靠周期复核"
  [self-report-vocab-audit.ts]="无可测前提，靠周期复核"
  [self-report-vocab-check.ts]="无可测前提，靠周期复核"
  [send-keys-reliable.sh]="无可测前提，靠周期复核"
  [serial-fanin-absorb.ts]="无可测前提，靠周期复核"
  [session-bootstrap.sh]="无可测前提，靠周期复核"
  [session-liveness-mount.sh]="无可测前提，靠周期复核"
  [session-liveness-sweep.mjs]="无可测前提，靠周期复核"
  [session-liveness.sh]="无可测前提，靠周期复核"
  [slot-free-trigger.ts]="无可测前提，靠周期复核"
  [orphan-session-check.ts]="无可测前提，靠周期复核"
  [slot-refill.sh]="无可测前提，靠周期复核"
  [slot-refill.ts]="无可测前提，靠周期复核"
  [stage-receipt.ts]="无可测前提，靠周期复核"
  [stale-ready-audit.ts]="无可测前提，靠周期复核"
  [strategic-doc-staleness-check.ts]="无可测前提，靠周期复核"
  [tick-core-static-check.ts]="失效前提：三层执行核仍以 markdown prose 承载执行路径；若改为结构化/机器可读数据，本条退休"
  [suite-cutoff-verdict.mjs]="无可测前提，靠周期复核"
  [suite-execution-form-counter.ts]="失效前提：launch Bash tool_use 的 transcript 文件类别仍是执行形态的判据源（主会话/agent/workflow 三类路径互斥，[startedAt ± ε] 窗匹配）；若执行形态改为其它记录面（如套件由 suite-state-trigger 之外的机件启动、或 transcript 文件布局变更），本条逻辑需同步"
  [state-worded-clause-check.ts]="失效前提：三份 tick-core 仍以 prose 承载可执行条款；若改为结构化数据，本条退休"
  [suite-state-trigger.ts]="无可测前提，靠周期复核"
  [supervisor-bus-identity.sh]="无可测前提，靠周期复核"
  [supervisor-bus.sh]="无可测前提，靠周期复核"
  [supervisor-deliver.sh]="失效前提：跨会话投递仍走单条硬化实现；若投递面迁移出 bash（全 API 化），本条退休"
  [supervisor-health.sh]="无可测前提，靠周期复核"
  [supervisor-observe.sh]="无可测前提，靠周期复核"
  [supervisor-preempt-candidates.ts]="无可测前提，靠周期复核"
  [supervisor-preempt.sh]="无可测前提，靠周期复核"
  [sync-lag-check.sh]="无可测前提，靠周期复核"
  [sync-vendor.sh]="无可测前提，靠周期复核"
  [malformed-task-check.ts]="失效前提：store 不再经 listWithMalformed() 以返回值暴露 malformed 信号（改回 list() 直接 throw 或静默跳过），检查器读不到该信号，把缺失读成『无 malformed』"
  [task-ac-carryover-check.ts]="无可测前提，靠周期复核"
  [task-contract-check.ts]="无可测前提，靠周期复核"
  [task-schema-check.sh]="无可测前提，靠周期复核"
  [task-schema-check.ts]="无可测前提，靠周期复核"
  [task-schema.ts]="无可测前提，靠周期复核"
  [task-status-drift-check.ts]="无可测前提，靠周期复核"
  [test-file-baseline.ts]="无可测前提，靠周期复核"
  [test-file-snapshot.sh]="无可测前提，靠周期复核"
  [test-framework-policy-check.sh]="失效前提：同上（.sh 壳调用 .ts 实现）"
  [test-framework-policy-check.ts]="失效前提：仓库仍同时存在 node:test 与手写 harness 两种测试风格；若手写 harness 全部迁移完（豁免清单缩到 0），本条退休"
  [test-impl-census-check.ts]="无可测前提，靠周期复核"
  [test-isolation-check.sh]="无可测前提，靠周期复核"
  [test-isolation-check.ts]="无可测前提，靠周期复核"
  [threshold-scope-check.ts]="失效前提：驱动文档仍含量化停止条件；若停止条件迁出驱动文档，本条退休"
  [tmp-leak-pairing-check.sh]="无可测前提，靠周期复核"
  [tmp-leak-pairing-check.ts]="无可测前提，靠周期复核"
  [tmux-isolated.sh]="无可测前提，靠周期复核"
  [tmux-leak-scan.sh]="无可测前提，靠周期复核"
  [tmux-session.ts]="无可测前提，靠周期复核"
  [tmux-test-isolation-check.ts]="无可测前提，靠周期复核"
  [topology-check.sh]="无可测前提，靠周期复核"
  [touches-orthogonality-check.ts]="无可测前提，靠周期复核"
  [touches-parser.ts]="无可测前提，靠周期复核"
  [transcript-delivery-check.ts]="无可测前提，靠周期复核"
  [tree-hygiene-check.sh]="无可测前提，靠周期复核"
  [trend-check.ts]="无可测前提，靠周期复核"
  [unverified-integration-task-ids.ts]="无可测前提，靠周期复核"
  [verify-delivery-surface.ts]="无可测前提，靠周期复核"
  [verify-installed-executables.sh]="无可测前提，靠周期复核"
  [vmeta-lag-check.sh]="无可测前提，靠周期复核"
  [vmeta-lag-check.ts]="无可测前提，靠周期复核"
  [wiring-coverage-check.ts]="无可测前提，靠周期复核"
  [workflow-baseline-metrics.ts]="无可测前提，靠周期复核"
  [workflow-event-schema.mjs]="无可测前提，靠周期复核"
  [workflow-invariant-ownership.mjs]="无可测前提，靠周期复核"
  [workflow-journal.ts]="无可测前提，靠周期复核"
  [workflow-metadata-conformance.mjs]="无可测前提，靠周期复核"
  [workflow-replay.ts]="无可测前提，靠周期复核"
  [worktree-branch-hygiene-check.sh]="无可测前提，靠周期复核"
  [obligation-discharge-agent.ts]="失效前提：义务裁决仍由 discharge/defer agent 判定；若改为纯机械判定或取消义务裁决，本条退休"
  [obligation-ledger-check.ts]="失效前提：义务账本仍由 obligation-ledger.ts 派生；若派生并入他处或账本文件删除，本条退休"
  [obligation-ledger.ts]="失效前提：轮次仍产生义务账本；若义务跟踪改为别处，本条退休"
  [semantic-observer-judge.ts]="失效前提：inner/outer 状态仍以自由文本（心跳 reason + tick 报告）承载；若观测面改为纯结构化 schema 且无自由文本，本条退休"
  [red-on-omission-audit.ts]="失效前提：执行核仍以 tick-core 文档固化行为；若行为固化面迁出 tick-core/plugin-scripts 文件系统，本条退休"

)

# ── LAST_REAFFIRMED (last-reaffirmed stamp (③) — the date someone last looked at this mechanism and stamped it; 超 N 天未被任何调用/检查/复核触及 → 待重新确认 (只看一眼盖章, 不判断对错)) ──
declare -A LAST_REAFFIRMED=(
  [a15-ruling5-counter.ts]="2026-08-10"
  [ac36-sortkey-criterion-check.ts]="2026-08-11"
  [accounting-emit.ts]="2026-08-10"
  [accounting-emit-layer-map.ts]="2026-08-12"
  [adr016-screen-use-check.ts]="2026-08-10"
  [anti-drift-touches-check.ts]="2026-08-10"
  [anti-gaming-guard.sh]="2026-08-10"
  [anti-gaming-guard.ts]="2026-08-10"
  [assert-clean-tree.sh]="2026-08-10"
  [audit-independence-check.sh]="2026-08-10"
  [audit-independence-check.ts]="2026-08-10"
  [axis-generator.ts]="2026-08-10"
  [blocked-signal-check.sh]="2026-08-10"
  [build-evidence-collector.ts]="2026-08-10"
  [build-evidence-gate.ts]="2026-08-10"
  [build-evidence-manifest.ts]="2026-08-10"
  [candidate-contracts.ts]="2026-08-10"
  [candidate-synthesis.ts]="2026-08-10"
  [cap-from-gate.sh]="2026-08-10"
  [cap-from-gate.ts]="2026-08-10"
  [capability-catalog.sh]="2026-08-10"
  [checker-cost-lib.sh]="2026-08-10"
  [checker-cost.sh]="2026-08-10"
  [checker-cost.ts]="2026-08-10"
  [checker-lib.ts]="2026-08-10"
  [checker-mutation-check.sh]="2026-08-10"
  [claim-task.sh]="2026-08-10"
  [claim-task.ts]="2026-08-10"
  [closure-lag-check.sh]="2026-08-10"
  [codex-stage1-live-proof-check.ts]="2026-08-10"
  [codex-stage1-selfcheck.sh]="2026-08-10"
  [commit-message-verified-check.ts]="2026-08-12"
  [concurrency-literal-check.ts]="2026-08-13"
  [concurrent-batch-scheduler.ts]="2026-08-10"
  [config-wiring-check.ts]="2026-08-10"
  [coupling-graph.ts]="2026-08-10"
  [cross-machine-verify.sh]="2026-08-10"
  [dead-code-after-return-check.ts]="2026-08-10"
  [dead-loop-check.sh]="2026-08-10"
  [derive-touches-heuristic.ts]="2026-08-10"
  [delivery-inventory-drift-gate.sh]="2026-08-10"
  [develop-deliver-tgz.sh]="2026-08-11"
  [drivable-workspace-check.sh]="2026-08-10"
  [drivable-workspace-check.ts]="2026-08-10"
  [drive-contract-check.ts]="2026-08-10"
  [drive-target-check.sh]="2026-08-10"
  [execution-policy.ts]="2026-08-10"
  [external-dogfooding-check.ts]="2026-08-10"
  [fan-in-runid-check.ts]="2026-08-12"
  [fast-mode-telemetry.ts]="2026-08-10"
  [fan-in-runid-check.ts]="2026-08-12"
  [finding-backpropagate.ts]="2026-08-10"
  [fork-baseline.ts]="2026-08-10"
  [full-suite-runner.ts]="2026-08-10"
  [gate-dispatch-coverage.ts]="2026-08-10"
  [gate-script-base.ts]="2026-08-10"
  [gate-script-lib.sh]="2026-08-10"
  [gate-staleness-check.sh]="2026-08-10"
  [gate-staleness-check.ts]="2026-08-10"
  [git-lens-l-d-code-doc-ratio.ts]="2026-08-10"
  [git-lens-l-g-structural-drift.ts]="2026-08-10"
  [git-lens-l-s-behavior-variance.ts]="2026-08-10"
  [halt-check.sh]="2026-08-10"
  [inbox-reader.sh]="2026-08-10"
  [inner-blocked-signal.ts]="2026-08-10"
  [inner-exec-mode-report.ts]="2026-08-10"
  [inner-forensics.mjs]="2026-08-10"
  [inner-idle-log.ts]="2026-08-10"
  [inner-panel-stale-check.ts]="2026-08-10"
  [inner-session-check.sh]="2026-08-10"
  [inner-wakeup-heartbeat-check.ts]="2026-08-10"
  [inner-wakeup-heartbeat.ts]="2026-08-11"

  [instrument-failure-check.ts]="2026-08-10"
  [integration-batch-merge.sh]="2026-08-10"
  [integration-branch-model.ts]="2026-08-10"
  [it0-enforcement-with-design-check.sh]="2026-08-10"
  [it0-enforcement-with-design-check.ts]="2026-08-10"
  [it0-impl-row-check.sh]="2026-08-10"
  [it0-split-or-commit-check.sh]="2026-08-10"
  [it0-split-or-commit-check.ts]="2026-08-10"
  [judgment-consumer-check.ts]="2026-08-11"
  [known-load-sensitive.ts]="2026-08-10"
  [l1-delivery-surface-check.ts]="2026-08-10"
  [laydown-set-check.sh]="2026-08-10"
  [load-sensitive-release-check.ts]="2026-08-10"
  [live-repo-literal-assert-check.ts]="2026-08-13"
  [loadbearing-test-gate.sh]="2026-08-10"
  [loadbearing-test-gate.ts]="2026-08-10"
  [loop-complete-task.ts]="2026-08-11"
  [loop-driver-check.sh]="2026-08-10"
  [loop-shipping-exclusion-data.mjs]="2026-08-10"
  [manager-adopt.sh]="2026-08-10"
  [manager-arm-loop.sh]="2026-08-10"
  [manager-observation-runtime-check.ts]="2026-08-10"
  [manager-start.sh]="2026-08-10"
  [manager-tick-log-check.sh]="2026-08-10"
  [manager-tick-readings.ts]="2026-08-10"
  [md-deletion-token-evaporation-check.sh]="2026-08-10"
  [measure-suite-reporter.mjs]="2026-08-10"
  [measure-suite.mjs]="2026-08-10"
  [measure-trend-check.ts]="2026-08-10"
  [mechanism-vitality-check.ts]="2026-08-10"
  [monitor-mount-check.sh]="2026-08-10"
  [needs-human-recheck.ts]="2026-08-10"
  [no-manager-tick-doc-check.ts]="2026-08-10"
  [observer-registry-check.sh]="2026-08-10"
  [observer-registry.sh]="2026-08-10"
  [os-anchor-install.sh]="2026-08-10"
  [os-anchor-watchdog.sh]="2026-08-10"
  [outer-tick-log-check.sh]="2026-08-10"
  [pane-state-classify.ts]="2026-08-10"
  [periodic-push-backup.sh]="2026-08-10"
  [pipe-exit-code-check.sh]="2026-08-10"
  [portfolio-choice.ts]="2026-08-10"
  [precommit-guard.ts]="2026-08-12"
  [prefriction-count.sh]="2026-08-10"
  [preparation-feedback.ts]="2026-08-10"
  [prepare-admission-check.ts]="2026-08-10"
  [pool-quality-judge.ts]="2026-08-10"
  [process-budget.sh]="2026-08-10"
  [provision-verify-worktree.sh]="2026-08-10"
  [proposal-convergence.ts]="2026-08-10"
  [publish-dist-branch.sh]="2026-08-10"
  [quay-branch.ts]="2026-08-10"
  [quay-check.ts]="2026-08-10"
  [quay-deliver.ts]="2026-08-10"
  [quay-dispatch.ts]="2026-08-10"
  [quay-entry-base.ts]="2026-08-10"
  [quay-init.sh]="2026-08-10"
  [quay-launch.sh]="2026-08-10"
  [quay-session.ts]="2026-08-10"
  [quay-suite.ts]="2026-08-10"
  [quay-topology.sh]="2026-08-10"
  [read-probe-spec.ts]="2026-08-10"
  [ready-pool-check.ts]="2026-08-10"
  [real-target-verify.sh]="2026-08-10"
  [red-window-triage.ts]="2026-08-10"
  [release-freshness-check.sh]="2026-08-11"
  [release-task.sh]="2026-08-10"
  [resource-gate.sh]="2026-08-10"
  [routine-file-gate.ts]="2026-08-10"
  [routine-scheduler.ts]="2026-08-10"
  [run-identity.ts]="2026-08-10"
  [runtime-usage-inventory.ts]="2026-08-10"
  [select-static-checks-for-touches.ts]="2026-08-10"
  [select-tests-for-touches.ts]="2026-08-10"
  [self-report-vocab-audit.ts]="2026-08-10"
  [self-report-vocab-check.ts]="2026-08-10"
  [send-keys-reliable.sh]="2026-08-10"
  [serial-fanin-absorb.ts]="2026-08-10"
  [session-bootstrap.sh]="2026-08-10"
  [session-liveness-mount.sh]="2026-08-10"
  [session-liveness-sweep.mjs]="2026-08-13"
  [session-liveness.sh]="2026-08-10"
  [slot-free-trigger.ts]="2026-08-11"
  [orphan-session-check.ts]="2026-08-12"
  [slot-refill.sh]="2026-08-10"
  [slot-refill.ts]="2026-08-10"
  [stage-receipt.ts]="2026-08-10"
  [stale-ready-audit.ts]="2026-08-12"
  [strategic-doc-staleness-check.ts]="2026-08-10"
  [tick-core-static-check.ts]="2026-08-10"
  [suite-cutoff-verdict.mjs]="2026-08-10"
  [suite-execution-form-counter.ts]="2026-08-13"
  [state-worded-clause-check.ts]="2026-08-10"
  [suite-state-trigger.ts]="2026-08-10"
  [supervisor-bus-identity.sh]="2026-08-10"
  [supervisor-bus.sh]="2026-08-10"
  [supervisor-deliver.sh]="2026-08-10"
  [supervisor-health.sh]="2026-08-10"
  [supervisor-observe.sh]="2026-08-10"
  [supervisor-preempt-candidates.ts]="2026-08-10"
  [supervisor-preempt.sh]="2026-08-10"
  [sync-lag-check.sh]="2026-08-10"
  [sync-vendor.sh]="2026-08-10"
  [malformed-task-check.ts]="2026-08-13"
  [task-ac-carryover-check.ts]="2026-08-10"
  [task-contract-check.ts]="2026-08-10"
  [task-schema-check.sh]="2026-08-10"
  [task-schema-check.ts]="2026-08-10"
  [task-schema.ts]="2026-08-10"
  [task-status-drift-check.ts]="2026-08-10"
  [test-file-baseline.ts]="2026-08-10"
  [test-file-snapshot.sh]="2026-08-10"
  [test-framework-policy-check.sh]="2026-08-10"
  [test-framework-policy-check.ts]="2026-08-10"
  [test-impl-census-check.ts]="2026-08-10"
  [test-isolation-check.sh]="2026-08-10"
  [test-isolation-check.ts]="2026-08-10"
  [threshold-scope-check.ts]="2026-08-10"
  [tmp-leak-pairing-check.sh]="2026-08-12"
  [tmp-leak-pairing-check.ts]="2026-08-12"
  [tmux-isolated.sh]="2026-08-10"
  [tmux-leak-scan.sh]="2026-08-10"
  [tmux-session.ts]="2026-08-10"
  [tmux-test-isolation-check.ts]="2026-08-10"
  [topology-check.sh]="2026-08-10"
  [touches-orthogonality-check.ts]="2026-08-10"
  [touches-parser.ts]="2026-08-10"
  [transcript-delivery-check.ts]="2026-08-10"
  [tree-hygiene-check.sh]="2026-08-10"
  [trend-check.ts]="2026-08-10"
  [unverified-integration-task-ids.ts]="2026-08-10"
  [verify-delivery-surface.ts]="2026-08-10"
  [verify-installed-executables.sh]="2026-08-10"
  [vmeta-lag-check.sh]="2026-08-10"
  [vmeta-lag-check.ts]="2026-08-10"
  [wiring-coverage-check.ts]="2026-08-10"
  [workflow-baseline-metrics.ts]="2026-08-10"
  [workflow-event-schema.mjs]="2026-08-10"
  [workflow-invariant-ownership.mjs]="2026-08-10"
  [workflow-journal.ts]="2026-08-10"
  [workflow-metadata-conformance.mjs]="2026-08-10"
  [workflow-replay.ts]="2026-08-10"
  [worktree-branch-hygiene-check.sh]="2026-08-10"
  [obligation-discharge-agent.ts]="2026-08-10"
  [obligation-ledger-check.ts]="2026-08-10"
  [obligation-ledger.ts]="2026-08-10"
  [semantic-observer-judge.ts]="2026-08-10"
  [red-on-omission-audit.ts]="2026-08-10"

)

# ── MATCHING (matching-method declaration (④) — how this checker judges: position (按位置不按关键词) | keyword | enumerative (枚举式存在性) | n/a (non-judgment lib/data). New checkers MUST declare which matching they use) ──
declare -A MATCHING=(
  [a15-ruling5-counter.ts]="enumerative"
  [ac36-sortkey-criterion-check.ts]="position"
  [accounting-emit.ts]="keyword"
  [accounting-emit-layer-map.ts]="position"
  [adr016-screen-use-check.ts]="position"
  [anti-drift-touches-check.ts]="keyword"
  [anti-gaming-guard.sh]="keyword"
  [anti-gaming-guard.ts]="keyword"
  [assert-clean-tree.sh]="keyword"
  [audit-independence-check.sh]="keyword"
  [audit-independence-check.ts]="keyword"
  [axis-generator.ts]="keyword"
  [blocked-signal-check.sh]="keyword"
  [build-evidence-collector.ts]="keyword"
  [build-evidence-gate.ts]="keyword"
  [build-evidence-manifest.ts]="keyword"
  [candidate-contracts.ts]="keyword"
  [candidate-synthesis.ts]="keyword"
  [cap-from-gate.sh]="keyword"
  [cap-from-gate.ts]="keyword"
  [capability-catalog.sh]="keyword"
  [checker-cost-lib.sh]="n/a"
  [checker-cost.sh]="keyword"
  [checker-cost.ts]="keyword"
  [checker-lib.ts]="position"
  [checker-mutation-check.sh]="enumerative"
  [claim-task.sh]="keyword"
  [claim-task.ts]="keyword"
  [closure-lag-check.sh]="keyword"
  [codex-stage1-live-proof-check.ts]="keyword"
  [codex-stage1-selfcheck.sh]="keyword"
  [commit-message-verified-check.ts]="position"
  [concurrency-literal-check.ts]="position"
  [concurrent-batch-scheduler.ts]="keyword"
  [config-wiring-check.ts]="keyword"
  [coupling-graph.ts]="keyword"
  [cross-machine-verify.sh]="keyword"
  [dead-code-after-return-check.ts]="position"
  [dead-loop-check.sh]="keyword"
  [derive-touches-heuristic.ts]="keyword"
  [delivery-inventory-drift-gate.sh]="position"
  [develop-deliver-tgz.sh]="position"
  [drivable-workspace-check.sh]="keyword"
  [drivable-workspace-check.ts]="keyword"
  [drive-contract-check.ts]="position"
  [drive-target-check.sh]="position"
  [execution-policy.ts]="keyword"
  [external-dogfooding-check.ts]="keyword"
  [fan-in-runid-check.ts]="position"
  [fast-mode-telemetry.ts]="keyword"
  [fan-in-runid-check.ts]="position"
  [finding-backpropagate.ts]="keyword"
  [fork-baseline.ts]="keyword"
  [full-suite-runner.ts]="keyword"
  [gate-dispatch-coverage.ts]="enumerative"
  [gate-script-base.ts]="n/a"
  [gate-script-lib.sh]="n/a"
  [gate-staleness-check.sh]="keyword"
  [gate-staleness-check.ts]="keyword"
  [git-lens-l-d-code-doc-ratio.ts]="keyword"
  [git-lens-l-g-structural-drift.ts]="keyword"
  [git-lens-l-s-behavior-variance.ts]="keyword"
  [halt-check.sh]="keyword"
  [inbox-reader.sh]="keyword"
  [inner-blocked-signal.ts]="keyword"
  [inner-exec-mode-report.ts]="keyword"
  [inner-forensics.mjs]="keyword"
  [inner-idle-log.ts]="keyword"
  [inner-panel-stale-check.ts]="keyword"
  [inner-session-check.sh]="keyword"
  [inner-wakeup-heartbeat-check.ts]="n/a"
  [inner-wakeup-heartbeat.ts]="n/a"

  [instrument-failure-check.ts]="position"
  [integration-batch-merge.sh]="keyword"
  [integration-branch-model.ts]="keyword"
  [it0-enforcement-with-design-check.sh]="keyword"
  [it0-enforcement-with-design-check.ts]="keyword"
  [it0-impl-row-check.sh]="keyword"
  [it0-split-or-commit-check.sh]="keyword"
  [it0-split-or-commit-check.ts]="keyword"
  [judgment-consumer-check.ts]="enumerative"
  [known-load-sensitive.ts]="keyword"
  [l1-delivery-surface-check.ts]="enumerative"
  [laydown-set-check.sh]="keyword"
  [load-sensitive-release-check.ts]="keyword"
  [live-repo-literal-assert-check.ts]="position"
  [loadbearing-test-gate.sh]="keyword"
  [loadbearing-test-gate.ts]="keyword"
  [loop-complete-task.ts]="keyword"
  [loop-driver-check.sh]="keyword"
  [loop-shipping-exclusion-data.mjs]="n/a"
  [manager-adopt.sh]="keyword"
  [manager-arm-loop.sh]="keyword"
  [manager-observation-runtime-check.ts]="keyword"
  [manager-start.sh]="keyword"
  [manager-tick-log-check.sh]="keyword"
  [manager-tick-readings.ts]="keyword"
  [md-deletion-token-evaporation-check.sh]="enumerative"
  [measure-suite-reporter.mjs]="n/a"
  [measure-suite.mjs]="n/a"
  [measure-trend-check.ts]="enumerative"
  [mechanism-vitality-check.ts]="position"
  [monitor-mount-check.sh]="keyword"
  [needs-human-recheck.ts]="keyword"
  [no-manager-tick-doc-check.ts]="position"
  [observer-registry-check.sh]="keyword"
  [observer-registry.sh]="keyword"
  [os-anchor-install.sh]="keyword"
  [os-anchor-watchdog.sh]="keyword"
  [outer-tick-log-check.sh]="keyword"
  [pane-state-classify.ts]="keyword"
  [periodic-push-backup.sh]="keyword"
  [pipe-exit-code-check.sh]="keyword"
  [portfolio-choice.ts]="keyword"
  [precommit-guard.ts]="enumerative"
  [prefriction-count.sh]="keyword"
  [preparation-feedback.ts]="keyword"
  [prepare-admission-check.ts]="keyword"
  [pool-quality-judge.ts]="enumerative"
  [process-budget.sh]="keyword"
  [provision-verify-worktree.sh]="enumerative"
  [proposal-convergence.ts]="keyword"
  [publish-dist-branch.sh]="keyword"
  [quay-branch.ts]="keyword"
  [quay-check.ts]="keyword"
  [quay-deliver.ts]="keyword"
  [quay-dispatch.ts]="keyword"
  [quay-entry-base.ts]="keyword"
  [quay-init.sh]="keyword"
  [quay-launch.sh]="keyword"
  [quay-session.ts]="keyword"
  [quay-suite.ts]="keyword"
  [quay-topology.sh]="keyword"
  [read-probe-spec.ts]="keyword"
  [ready-pool-check.ts]="keyword"
  [real-target-verify.sh]="keyword"
  [red-window-triage.ts]="keyword"
  [release-freshness-check.sh]="position"
  [release-task.sh]="keyword"
  [resource-gate.sh]="keyword"
  [routine-file-gate.ts]="keyword"
  [routine-scheduler.ts]="keyword"
  [run-identity.ts]="n/a"
  [runtime-usage-inventory.ts]="keyword"
  [select-static-checks-for-touches.ts]="keyword"
  [select-tests-for-touches.ts]="keyword"
  [self-report-vocab-audit.ts]="position"
  [self-report-vocab-check.ts]="position"
  [send-keys-reliable.sh]="keyword"
  [serial-fanin-absorb.ts]="keyword"
  [session-bootstrap.sh]="keyword"
  [session-liveness-mount.sh]="keyword"
  [session-liveness-sweep.mjs]="n/a"
  [session-liveness.sh]="keyword"
  [slot-free-trigger.ts]="keyword"
  [orphan-session-check.ts]="position"
  [slot-refill.sh]="keyword"
  [slot-refill.ts]="keyword"
  [stage-receipt.ts]="n/a"
  [stale-ready-audit.ts]="keyword"
  [strategic-doc-staleness-check.ts]="position"
  [tick-core-static-check.ts]="position"
  [suite-cutoff-verdict.mjs]="keyword"
  [suite-execution-form-counter.ts]="enumerative"
  [state-worded-clause-check.ts]="position"
  [suite-state-trigger.ts]="keyword"
  [supervisor-bus-identity.sh]="keyword"
  [supervisor-bus.sh]="keyword"
  [supervisor-deliver.sh]="keyword"
  [supervisor-health.sh]="keyword"
  [supervisor-observe.sh]="keyword"
  [supervisor-preempt-candidates.ts]="keyword"
  [supervisor-preempt.sh]="keyword"
  [sync-lag-check.sh]="keyword"
  [sync-vendor.sh]="keyword"
  [malformed-task-check.ts]="enumerative"
  [task-ac-carryover-check.ts]="enumerative"
  [task-contract-check.ts]="enumerative"
  [task-schema-check.sh]="keyword"
  [task-schema-check.ts]="keyword"
  [task-schema.ts]="n/a"
  [task-status-drift-check.ts]="position"
  [test-file-baseline.ts]="n/a"
  [test-file-snapshot.sh]="keyword"
  [test-framework-policy-check.sh]="keyword"
  [test-framework-policy-check.ts]="position"
  [test-impl-census-check.ts]="keyword"
  [test-isolation-check.sh]="keyword"
  [test-isolation-check.ts]="enumerative"
  [threshold-scope-check.ts]="position"
  [tmp-leak-pairing-check.sh]="keyword"
  [tmp-leak-pairing-check.ts]="position"
  [tmux-isolated.sh]="keyword"
  [tmux-leak-scan.sh]="keyword"
  [tmux-session.ts]="keyword"
  [tmux-test-isolation-check.ts]="position"
  [topology-check.sh]="keyword"
  [touches-orthogonality-check.ts]="keyword"
  [touches-parser.ts]="n/a"
  [transcript-delivery-check.ts]="keyword"
  [tree-hygiene-check.sh]="keyword"
  [trend-check.ts]="enumerative"
  [unverified-integration-task-ids.ts]="keyword"
  [verify-delivery-surface.ts]="enumerative"
  [verify-installed-executables.sh]="keyword"
  [vmeta-lag-check.sh]="keyword"
  [vmeta-lag-check.ts]="keyword"
  [wiring-coverage-check.ts]="keyword"
  [workflow-baseline-metrics.ts]="n/a"
  [workflow-event-schema.mjs]="n/a"
  [workflow-invariant-ownership.mjs]="n/a"
  [workflow-journal.ts]="n/a"
  [workflow-metadata-conformance.mjs]="n/a"
  [workflow-replay.ts]="keyword"
  [worktree-branch-hygiene-check.sh]="keyword"
  [obligation-discharge-agent.ts]="enumerative"
  [obligation-ledger-check.ts]="enumerative"
  [obligation-ledger.ts]="enumerative"
  [semantic-observer-judge.ts]="keyword"
  [red-on-omission-audit.ts]="keyword"
)
# ── superseded capability table (gap-retired-script-still-callable, human ruling 2026-08-10) ──
# One capability = ONE implementation. A superseded implementation must NOT exist in the
# executable layer (plugin/scripts, plugin/test, packages/*/plugin vendored copies) and must NOT
# be taught in SKILL/README positions (target state ①/②/⑤ — 一个能力=一个实现,被取代的实现不存在于
# 仓库,不被教学;历史留在记录层 ADR/任务体/结晶文档). This table is the RECORD of what was removed and
# why; `--superseded-check` asserts the invariant mechanically every run (wired into
# run_static_checks in scripts/test.sh), so a deleted implementation can never silently regrow.
declare -A SUPERSEDED=(
  [send-keys-verified.sh]="REMOVED 2026-08-10 (gap-retired-script-still-callable, human ruling) — superseded by send-keys-reliable.sh under outer ruling F (2026-08-04); its md5 pane-hash criterion is ADR-016-forbidden. Deleted with its test (send-keys-verified.test.mjs) and leak doc (send-keys-verified-test-leaks-tmux-servers.md). Crystallization residue poisons context — the implementation must NOT exist."
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
  [closure-lag-check.sh]="consumer-facing: the closure-pass lag signal + trace-writer documented in the tick docs (1b 异步收尾例程)"
  [dead-loop-check.sh]="consumer-facing: the L2 dead-loop health command invoked by the cold-start and manager skills"
  [drive-target-check.sh]="consumer-facing: the fail-closed drive/observe target pre-flight gate (window name, never a numeric index) — the outer verifies quay-0:inner before any capture-pane/send-keys (C16, gap-drive-sent-to-manager-pane-not-inner)"
  [gate-staleness-check.sh]="consumer-facing: the gate-ledger freshness signal (last GateEvent vs claimed period) invoked by the goal-store Contract"
  [inner-session-check.sh]="consumer-facing: the three-state cold-start self-check invoked by the loop docs"
  [halt-check.sh]="consumer-facing: the three-layer unified .halt check command in the tick docs"
  [integration-batch-merge.sh]="consumer-facing: the integration→develop batch-merge command in the branch-model docs"
  [laydown-set-check.sh]="consumer-facing: the cold-start lay-what-you-verify gate invoked by the cold-start skill"
  [loop-driver-check.sh]="consumer-facing: the exactly-one-driver liveness check documented in the tick docs"
  [manager-arm-loop.sh]="consumer-facing: the manager scheduling-anchor command documented in the manager tick docs"
  [manager-start.sh]="consumer-facing: the bare-metal manager cold-start vector (quay manager start after npm i -g; gap-manager-layer-no-verified-install-vector AC2) documented in the manager skill"
  [manager-adopt.sh]="consumer-facing: the manager's per-project adopt command (quay manager adopt <root>) documented in the manager skill (C5: start 与 adopt 分开)"
  [manager-tick-log-check.sh]="consumer-facing: the manager's last-tick-did-log detector in the manager tick docs"
  [outer-tick-log-check.sh]="consumer-facing: the outer's no-action-must-carry-all-five-false-evidence detector (B8/B13) in the orchestrator tick docs"
  [monitor-mount-check.sh]="consumer-facing: the loop-monitor mount/aim check in the tick docs"
  [observer-registry.sh]="consumer-facing: the single observer-registry heartbeat (--audit) invoked unconditionally every tick in the loop docs (fast-mode 4c / orchestrator 3d)"
  [process-budget.sh]="consumer-facing: the total test-process budget authority consumed by test.sh / cap-from-gate / resource-gate"
  [provision-verify-worktree.sh]="consumer-facing: provision a fresh verify worktree (node_modules + .quay/config.yml symlinks) so it can run the full suite — used by A15 ④ both paths"
  [quay-launch.sh]="consumer-facing: the per-role launch command materializing the checked-in launch settings — documented as the launch surface in the cold-start skill + orchestrator-loop-tick (gap-quay-init-coldstart-usability-launch-not-used-huge-tick-doc-selftest-dominant AC2/Contract; re-instated 2026-08-11, superseding the 2026-08-06 demotion-to-internal of gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal)"
  [quay-topology.sh]="consumer-facing: the two-window topology factory in the tick docs"
  [release-task.sh]="consumer-facing: the claim-release command documented in the tick docs"
  [real-target-verify.sh]="consumer-facing: the real-downstream install/upgrade verification command in the verification-round docs"
  [resource-gate.sh]="consumer-facing: the resource-safety gate invoked by the tick docs before heavy ops"
  [send-keys-reliable.sh]="consumer-facing: the reliable send-keys sequence used by ADR-016 remote-drive"
  [session-bootstrap.sh]="consumer-facing: the bare-machine tmux bootstrap in the session-topology skill"
  [supervisor-deliver.sh]="consumer-facing: the single hardened cross-session delivery implementation (deliver(target,payload)) documented in the tick docs / drive-contract (AC37 核随包走引用)"
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
  --superseded-check)
    MODE=superseded-check
    ;;
  "")
    ;;
  *)
    echo "ERROR: unknown argument: $1 (expected --json | --table | --summary | --entry-surface | --superseded-check)" >&2
    exit 2
    ;;
esac

# ── superseded-capability check (AC5: 一个能力=一个实现,被取代的实现不存在于仓库,不被教学) ──
# Asserts the SUPERSEDED table invariant: every superseded implementation must NOT exist in the
# executable layer (plugin/scripts, plugin/test, packages/*/plugin vendored copies) and must NOT
# be taught in SKILL/README positions. Wired into run_static_checks (scripts/test.sh) so a
# deleted superseded implementation can never silently regrow. Exit 0 = every superseded
# capability is gone and untaught; 1 = at least one still exists / is still taught.
if [ "$MODE" = "superseded-check" ]; then
  REPO_ROOT="$(cd "${SELF_DIR}/../.." 2>/dev/null && pwd || true)"
  viol=""
  for b in "${!SUPERSEDED[@]}"; do
    stem="${b%.*}"
    # (1) executable layer — plugin/scripts/<name>
    if [ -f "${REPO_ROOT}/plugin/scripts/${b}" ]; then
      viol+="  plugin/scripts/${b} — superseded implementation still exists"$'\n'
    fi
    # (2) vendored copies — packages/*/plugin/scripts/<name>
    for v in "${REPO_ROOT}"/packages/*/plugin/scripts/"${b}"; do
      if [ -f "$v" ]; then
        viol+="  ${v#${REPO_ROOT}/} — superseded vendored copy still exists"$'\n'
      fi
    done
    # (3) test layer — plugin/test/<name> and plugin/test/<stem>.test.mjs
    if [ -f "${REPO_ROOT}/plugin/test/${b}" ]; then
      viol+="  plugin/test/${b} — superseded test still exists"$'\n'
    fi
    if [ -f "${REPO_ROOT}/plugin/test/${stem}.test.mjs" ]; then
      viol+="  plugin/test/${stem}.test.mjs — superseded test still exists"$'\n'
    fi
    # (4) SKILL/README teaching positions must NOT teach the superseded capability
    for tf in "${REPO_ROOT}"/plugin/skills/*/SKILL.md "${REPO_ROOT}/plugin/README.md" "${REPO_ROOT}/README.md" "${REPO_ROOT}"/packages/*/README.md; do
      [ -f "$tf" ] || continue
      if grep -q -- "${stem}" "$tf"; then
        viol+="  ${tf#${REPO_ROOT}/} teaches the superseded capability ${b} (stem ${stem})"$'\n'
      fi
    done
  done
  if [ -n "$viol" ]; then
    echo "FAIL (superseded-capability check): a superseded implementation must NOT exist in the executable layer nor be taught:" >&2
    printf '%s' "$viol" >&2
    exit 1
  fi
  echo "superseded-capability check: PASS — every superseded capability is removed from the executable layer and not taught (${#SUPERSEDED[@]} superseded)"
  exit 0
fi

# ── build rows ─────────────────────────────────────────────────────────────────────
TOTAL=${#SCRIPTS[@]}
DECLARED=0
UNCLASSIFIED=0
SHIPPED=0
MISSING_CADENCE=0
MISSING_INVALIDATION=0
MISSING_LAST_REAFFIRMED=0
MISSING_MATCHING=0
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
  # 熔融-结晶张力五方向 ①②③④ per-entry attributes. A DECLARED script missing cadence /
  # invalidation / last-reaffirmed / matching is an entry-gate reject (below), NOT silently
  # defaulted — 缺字段=入口闸拒绝 (照 capability-catalog 已有 AC1c 做法).
  cadence="${CADENCE[$b]:-}"
  invalidation="${INVALIDATION[$b]:-}"
  last_reaffirmed="${LAST_REAFFIRMED[$b]:-}"
  matching="${MATCHING[$b]:-}"
  if [ -n "$q" ]; then
    if [ -z "$cadence" ]; then MISSING_CADENCE=$((MISSING_CADENCE + 1)); fi
    if [ -z "$invalidation" ]; then MISSING_INVALIDATION=$((MISSING_INVALIDATION + 1)); fi
    if [ -z "$last_reaffirmed" ]; then MISSING_LAST_REAFFIRMED=$((MISSING_LAST_REAFFIRMED + 1)); fi
    if [ -z "$matching" ]; then MISSING_MATCHING=$((MISSING_MATCHING + 1)); fi
  fi
  ROWS+="$b	$q	$ships	$surface	$cadence	$invalidation	$last_reaffirmed	$matching"$'\n'
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
  IFS=$'\t' read -r b q ships surface _cad _inv _lr _mat <<<"$line"
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
    cadence = parts[4] if len(parts) > 4 else ""
    invalidation = parts[5] if len(parts) > 5 else ""
    last_reaffirmed = parts[6] if len(parts) > 6 else ""
    matching = parts[7] if len(parts) > 7 else ""
    entries.append({
        "file": fname,
        "question": q if q else None,
        "ships": ships == "true",
        "surface": surface if surface != "null" else None,
        "cadence": cadence if cadence else None,
        "invalidation": invalidation if invalidation else None,
        "last_reaffirmed": last_reaffirmed if last_reaffirmed else None,
        "matching": matching if matching else None,
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
    IFS=$'\t' read -r b q ships _surface _cad _inv _lr _mat <<<"$line"
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

# ── 熔融-结晶张力五方向 entry gate (①②④): a DECLARED script missing cadence / invalidation /
# last-reaffirmed / matching is rejected — 缺字段=入口闸拒绝, 照 capability-catalog 已有 AC1c 做法.
# 这一条把「结晶时写失效前提/周期」从纪律变成入口闸: 新脚本进 artifact 时作者必须声明这四个字段,
# 否则该脚本的 entry 被拒。无默认值兜底 — 有默认值就是假装字段在场。
if [ "$MISSING_CADENCE" -gt 0 ] || [ "$MISSING_INVALIDATION" -gt 0 ] || \
   [ "$MISSING_LAST_REAFFIRMED" -gt 0 ] || [ "$MISSING_MATCHING" -gt 0 ]; then
  echo "FAIL (entry-gate, gap-crystallization-five-directions): a declared check is missing a required crystallization field." >&2
  if [ "$MISSING_CADENCE" -gt 0 ]; then echo "  ${MISSING_CADENCE} check(s) lack cadence: (每轮|每红窗|每里程碑|冷启动|按需) — add a CADENCE row." >&2; fi
  if [ "$MISSING_INVALIDATION" -gt 0 ]; then echo "  ${MISSING_INVALIDATION} check(s) lack 失效前提 (invalidation) — add an INVALIDATION row (testable precondition, or '无可测前提，靠周期复核')." >&2; fi
  if [ "$MISSING_LAST_REAFFIRMED" -gt 0 ]; then echo "  ${MISSING_LAST_REAFFIRMED} check(s) lack last-reaffirmed — add a LAST_REAFFIRMED row (YYYY-MM-DD)." >&2; fi
  if [ "$MISSING_MATCHING" -gt 0 ]; then echo "  ${MISSING_MATCHING} check(s) lack matching method — add a MATCHING row (position|keyword|enumerative|n/a)." >&2; fi
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
