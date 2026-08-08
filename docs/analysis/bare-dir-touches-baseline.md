# bare-dir-touches-baseline.md — shrink-only grandfather list for the bare-directory + uncertain-annotation Touches check
# (tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool, AC1).
#
# A Touches entry must NOT declare a BARE DIRECTORY with an UNCERTAIN annotation ('若成脚本' / '或等价' /
# '可能'). A bare dir expands to EVERYTHING under it — a SPECULATIVE broad declaration that collides with
# every other task touching that dir (measured: branch-model's `plugin/scripts/（…，若成脚本）` expanded to
# 100+ files and sank 5/6 pool candidates). Rule: declare a CONCRETE path, or PRE-CLAIM an explicit
# candidate path (e.g. `plugin/scripts/branch-helper.sh`), never a bare dir with '若成脚本'-style
# uncertainty. The legacy occurrences below are grandfathered HERE — the list can only get SHORTER:
# a task file NOT listed whose Touches carries the pattern is a NEW occurrence (a `bare-dir-uncertain-touch`
# violation in task-contract-check.ts), and the baseline-count ceiling never grows. When a grandfathered
# task's Touches is narrowed to concrete paths, DELETE its entry here and decrement baseline-count.
#
# Format: one repo-root-relative task file per line (sorted).
# baseline-count: 14

tasks/gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async.md
tasks/gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite.md
tasks/gap-complete-delivery-surface-spec-and-l1-verification.md
tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md
tasks/gap-global-count-assertions-fragile-relative-baseline.md
tasks/gap-inner-has-no-periodic-anchor-prose-only-drives-drift.md
tasks/gap-manager-productization-five-constraints.md
tasks/gap-os-anchor-watchdog-lease-model-instead-of-absence-inference.md
tasks/gap-suite-concurrency-4-vs-8-measurement.md
tasks/gap-supervisor-base-layer-outside-sessions-architecture.md
tasks/gap-supervisor-step-5-message-bus-with-identity.md
tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md
tasks/gap-worktree-node-modules-inconsistent-self-verify.md
tasks/gap-worktree-scoped-runs-consume-resources-but-produce-no-signal.md
