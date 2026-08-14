# touches-one-entry-one-path-baseline.md — shrink-only grandfather list for the Touches「一条目一路径」check
# (tasks/gap-touches-one-entry-one-path, 判据1/判据3).
#
# A Touches bullet must declare EXACTLY ONE path/glob entry. A bullet containing " / " (space-slash-
# space) declares ≥2 paths in one line; parseTouchEntriesWithTags then treats the whole line as ONE
# composite entry, which matches NO file on disk and HIDES each real path inside it from
# checkTouchesPair's overlap judgment (AC66's 3-path bullet hid orchestration/fast-mode-tick-core.md
# from AC78 — 判据3). The 10 in-scope tasks of gap-touches-one-entry-one-path are split to one entry
# per line. The legacy occurrences below are grandfathered HERE — the list can only get SHORTER:
# a task file NOT listed whose Touches carries the pattern is a NEW occurrence (a
# `touches-multi-path-bullet` violation in plugin/scripts/touches-one-entry-one-path-check.ts), and
# the baseline-count ceiling never grows. When a grandfathered task's Touches is split to single-path
# bullets, DELETE its entry here and decrement baseline-count.
#
# Format: one repo-root-relative task file per line (sorted).
# baseline-count: 8

tasks/gap-integration-content-fails-first-complete-tree-verification-fix-21.md
tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage.md
tasks/gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive.md
tasks/gap-manager-layer-no-verified-install-vector.md
tasks/gap-os-anchor-watchdog-lease-model-instead-of-absence-inference.md
tasks/gap-serial-group-recompose-nested-runner-criterion.md
tasks/gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles.md
tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md
