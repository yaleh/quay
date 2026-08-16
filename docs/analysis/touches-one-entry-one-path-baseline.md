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
# GROWTH (2026-08-16, gap-touches-connector-delimiter-uncaught): the separator set was extended with
# " + " (space-plus-space — the AC93/ac86/AC91 fan-in case) AND glob wildcards became path-like
# (plugin/scripts/* — the AC86 shape), and the checker was WIRED into scripts/test.sh
# run_static_checks (it was an orphan — present + tested but never executed). Both changes made
# pre-existing multi-path bullets in DONE historical task files newly visible/blocking. Those 15
# occurrences (13 " + "-connected, incl. gap-suite-fix-red-baseline whose two tokens are BOTH
# extension-less globs, + the 2 "、" -connected already reported by the orphaned scan) are
# grandfathered HERE as pre-rule historical records — they are DONE tasks, out of the dispatch pool,
# and out of the wiring task's Touches scope to split. The 15 additions are the 2026-08-16 one-time
# absorption of that pre-existing debt; the list remains shrink-only from here on (a follow-up split
# of any of these removes its entry and decrements baseline-count). A NEW " + "/" / "/"、" / "，" / ","
# multi-path bullet on ANY task file not listed here is now a hard gate.
#
# Format: one repo-root-relative task file per line (sorted).
# baseline-count: 23

tasks/gap-checks-that-verify-an-empty-set-must-fail-closed.md
tasks/gap-closure-pass-has-no-lag-signal.md
tasks/gap-inner-self-wake-sleep-empty-slots-not-dispatch.md
tasks/gap-integration-content-fails-first-complete-tree-verification-fix-21.md
tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage.md
tasks/gap-loop-completion-path-produces-zero-gateevents.md
tasks/gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive.md
tasks/gap-manager-layer-no-verified-install-vector.md
tasks/gap-os-anchor-watchdog-lease-model-instead-of-absence-inference.md
tasks/gap-precommit-guard-merge-bypass.md
tasks/gap-r1-cannot-see-tests-writing-into-the-live-task-store.md
tasks/gap-round5-red-killtimeout-sigkill-and-capfromgate-seam-under-load.md
tasks/gap-serial-group-recompose-nested-runner-criterion.md
tasks/gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles.md
tasks/gap-serve-pid-derived-port-collision-family.md
tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md
tasks/gap-spec-p2-halt-three-layer-mechanical-enforcement.md
tasks/gap-spec-p2-quad-tuple-unified-emitter.md
tasks/gap-suite-fix-red-baseline-2026-08-16.md
tasks/gap-supervisor-message-bus-with-identity.md
tasks/gap-tmp-dir-leak-unpaired-mkdtemp-cleanup.md
tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md
tasks/gap-worktree-fork-baseline-always-integration.md
