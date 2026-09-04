# dod-suite-line-baseline.md — shrink-only grandfather list for the DoD full-suite-demand check
# (tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge, AC2).
#
# The full-suite-green criterion is correctly the BATCH-MERGE BOUNDARY gate (fast-mode-loop-tick.md
# 红窗规则: red blocks $MERGE_TARGET→$FORK_BASELINE); the TASK-level duplicate in `## Definition of
# Done` (「完整套件连跑 2 次全绿」) couples every task to a slow global signal it cannot control.
# NEW tasks must NOT carry this demand. The legacy occurrences are grandfathered HERE — the list can
# only get SHORTER: a task NOT listed whose DoD carries the demand is a new violation
# (task-contract-check.ts `dod-suite-line`), and the baseline-count ceiling never grows. When a
# task is closed and its DoD line removed, DELETE its entry here and decrement baseline-count.
#
# Format: one repo-root-relative task file per line (sorted).
# baseline-count: 86

tasks/gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards.md
tasks/gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second.md
tasks/gap-a-widened-wait-window-was-closed-on-evidence-that-cannot-discriminate.md
tasks/gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect.md
tasks/gap-both-gates-read-one-signal-so-done-costs-nothing.md
tasks/gap-checkers-have-never-been-shown-to-fail.md
tasks/gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github.md
tasks/gap-cli-quay-init-collides-with-the-canonical-slash-quay-init.md
tasks/gap-closed-bracket-leaves-live-agent-consuming-slots.md
tasks/gap-cold-start-e2e-installs-from-a-copy-and-nothing-runs-it.md
tasks/gap-cold-start-needs-a-human-to-dictate-eight-steps.md
tasks/gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived.md
tasks/gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed.md
tasks/gap-cross-machine-readonly-observation-orchestration-not-a-tool.md
tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes.md
tasks/gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible.md
tasks/gap-drift-check-only-looks-at-the-harmless-direction.md
tasks/gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point.md
tasks/gap-eighty-two-shipped-checks-and-none-says-what-it-answers.md
tasks/gap-exclusion-lists-have-no-necessity-check.md
tasks/gap-green-verdict-never-expires-411-minutes-and-187-commits-later-still-green.md
tasks/gap-init-guesses-the-tmux-session-and-writes-the-guess-into-the-monitor.md
tasks/gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down.md
tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close.md
tasks/gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them.md
tasks/gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling.md
tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage.md
tasks/gap-live-cannot-tell-a-dead-loop-from-an-unwired-one.md
tasks/gap-liveness-mounting-is-a-single-flight-role-with-no-owner.md
tasks/gap-load-sensitive-session-family-confounds-step-three.md
tasks/gap-loop-mechanism-lives-outside-the-package-and-cannot-ship.md
tasks/gap-manager-instrument-failures-need-mechanical-detection-not-carefulness.md
tasks/gap-manager-skill-missing-mandatory-tool-reuse-checklist.md
tasks/gap-manager-tick-log-append-trips-suite-after-dirty-tree-assertion.md
tasks/gap-manager-tick-mechanical-checks-are-eight-loose-bash-blocks-in-prose.md
tasks/gap-mkdtemp-rooted-in-the-shared-checkout-dirties-the-tree.md
tasks/gap-no-e2e-proves-install-is-configuration-driven.md
tasks/gap-no-post-merge-cross-machine-verification-detection-latency-is-luck.md
tasks/gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses.md
tasks/gap-nothing-checks-whether-a-done-task-left-its-acs-behind.md
tasks/gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right.md
tasks/gap-npm-install-does-not-register-the-plugin-with-claude-code.md
tasks/gap-observer-registry-target-decommission-and-criterion-invalidation.md
tasks/gap-one-unparseable-task-takes-down-the-whole-board.md
tasks/gap-prefriction-trigger-regex-too-broad-signal-is-dead.md
tasks/gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target.md
tasks/gap-quay-init-rewrites-an-executable-instead-of-generating-config.md
tasks/gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal.md
tasks/gap-r1-cannot-see-tests-writing-into-the-live-task-store.md
tasks/gap-readme-source-install-commands-are-all-broken-quay-js-does-not-exist.md
tasks/gap-retire-inner-state-one-observer-targets-by-parameter.md
tasks/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools.md
tasks/gap-session-liveness-cannot-see-context-saturation-alive-but-cannot-take-input.md
tasks/gap-session-liveness-hashes-the-token-counter-as-if-it-were-work.md
tasks/gap-session-liveness-heartbeat-freezes-for-the-whole-task.md
tasks/gap-session-liveness-stage-2-screen-signal-and-payload.md
tasks/gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form.md
tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md
tasks/gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check.md
tasks/gap-suite-cutoff-what-tears-test-process-at-session-topology.md
tasks/gap-suite-speed-under-a-297-second-sigma.md
tasks/gap-task-list-route-is-linear-in-task-count.md
tasks/gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter.md
tasks/gap-tasksperhour-counts-halted-time-as-slow-work.md
tasks/gap-test-concurrency-cap-does-not-scope-nested-spawns.md
tasks/gap-the-blocked-channel-has-a-writer-nobody-calls.md
tasks/gap-the-dod-gate-encodes-a-retired-task-shape.md
tasks/gap-the-finding-shape-still-requires-a-plan-section.md
tasks/gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.md
tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md
tasks/gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger.md
tasks/gap-the-only-token-waiter-refuses-to-wait-at-all.md
tasks/gap-the-runtime-has-nowhere-safe-to-land.md
tasks/gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs.md
tasks/gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency.md
tasks/gap-the-tick-doc-ships-three-contradictory-loop-drivers.md
tasks/gap-the-token-measures-the-wait-and-throws-it-away.md
tasks/gap-the-token-watches-the-shell-that-asked-not-the-work-that-runs.md
tasks/gap-tmp-leak-is-live-r6-absolves-a-file-for-one-cleanup-call.md
tasks/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe.md
tasks/gap-token-status-reports-a-dead-holder-as-busy.md
tasks/gap-token-wait-times-are-printed-once-and-never-landed.md
tasks/gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model.md
tasks/gap-two-thirds-of-a-task-is-polling-a-suite-log.md
tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md
tasks/gap-worktree-scoped-runs-consume-resources-but-produce-no-signal.md
