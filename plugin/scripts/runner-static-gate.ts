# runner-static-gate.ts — the static-gate (checker registry) family, extracted from scripts/test.sh
# (gap-ac128-hub-split-harness-concerns).
#
# WHY A SEPARATE FILE: scripts/test.sh is a HUB file (any change forces the full suite). The static-gate
# family (run_static_checks — the CODE-CLASS checker registry; run_operational_checks — the
# OPERATIONAL-CLASS runtime-state checker registry; and resource_gate_check — the pre-suite
# resource-gate consultation) is HARNESS-CRITICAL, so this file is ALSO a hub (listed in
# suite-bucket-hub-list.ts HUB_FILES). Extracting the three functions out of the monolith shrinks it WITHOUT
# weakening the hub rule (a change here still forces the full suite, which is correct: the static gate
# must be fully verified).
#
# Moved verbatim from scripts/test.sh: run_static_checks (the checker registry; every `# @static-tier`
# / `# @static-object` annotation is the SINGLE SOURCE select-static-checks-for-touches.ts and
# checker-mutation-check.sh parse — they now parse THIS file) and resource_gate_check (the AC7
# full-suite resource-gate consultation). This file is SOURCED by scripts/test.sh — bash does not care
# about the extension, and `.ts` is what keeps the registry parseable by the same parsers that read the
# annotations. run_checker / run_checker_parallel_wait resolve from checker-cost-lib.sh (sourced by
# test.sh before this file); repo_root / main_root resolve from test.sh's globals at call time.

# run_static_checks — the repo-wide CODE-CLASS invariants (machine-independent, valid in ANY
# checkout) that run on EVERY FULL-SUITE-mode test-running invocation (the default, --group,
# flags-only, explicit files) AND on `--static-checks`, independent of which test files were
# requested (fast; the metadata modes --list-groups/--list-files skip them). CI inherits them
# because its only test step is `bash scripts/test.sh`.
#
# DOC-CLASS SPLIT (AC51 断言面拆分, gap-ac51-assertion-surface-split, SPEC §13): the doc-consistency
# checkers (strategic-doc-staleness / drive-contract / threshold-scope / state-worded-clause /
# red-on-omission / tick-core-static / instrument-failure) have MOVED OUT of this function into
# run_doc_checks() below — their home is now the pre-commit moment (`--static-checks-doc`, wired
# into plugin/scripts/precommit-guard.ts), NOT the full-suite gate. Because they no longer run in
# the suite, editing a doc in the main checkout no longer makes any running round red, and doc
# errors surface in seconds at commit time instead of after an 8-minute round. run_static_checks
# here is the CODE-class gate only.
#
# OPERATIONAL-CLASS SPLIT (2026-09-02 passive-machine ruling — 执行 suite 测试不应依赖本项目运行态,
# manager/outer/inner/driver 全算): the runtime-state checkers (outer-tick-log / worktree-node-modules /
# suite-bucket-drift / obligation-ledger / fan-in-workflow-retirement /
# per-task-suite-record / fan-in-ff-protocol / fan-in-materialize /
# suite-duration-exceed) read the loop's LIVE runtime state (tick telemetry, runtime ledgers, live
# task worktrees, develop reflog, SDK-materialized workflow records). They have MOVED OUT of this
# function into run_operational_checks() below — home is the explicit opt-in
# `scripts/test.sh --static-checks-operational` on the ACTIVE host, NOT the full-suite gate: a passive
# checkout must go green on code alone. NOT re-wired into any automatic cadence (outer retiring; drift
# of these checks accepted). They REMAIN in the mutation manifest (checker-mutation-check.sh parses
# run_operational_checks) so the L_S instrument is not weakened — same shape as the DOC-class split
# above. Each operational block carries `# @static-class operational`.
# ⛔ TWO MEMBERS LEFT THIS LIST 2026-09-13 (tasks/gap-correctness-checkers-opt-in-not-default-suite-
# member): dispatch-record-fingerprint-reason-check and direct-to-develop-bypass-check are BACK in
# run_static_checks() — the ruling's rationale (a passive checkout must go green on code alone) is a
# property of the CARRIER each checker reads, and both of these are VACUOUS-SAFE on an absent runtime
# state by their own design (measured against a bare repo: exit 0 / exit 3-never-fatal). Their default
# reachability had been ZERO, which made the writer's only fingerprint detector and the only
# direct-develop-bypass detector unreachable in production. Full argument at their new home.
# MEMBER COUNT (tasks/gap-checker-claim-vs-actual-cadence-and-count-drift): each registry's count
# is declared by a `# @checker-count <N>` annotation sitting on the function it describes, and is
# machine-checked against the function body's run_checker entries by
# plugin/scripts/checker-count-drift-check.ts (a mismatch is RED). Prose must NOT restate the number
# — this header used to claim 35 while the body held 58, and nothing could tell.
#
# SCOPED TIER (gap-scoped-runs-pay-full-static-check-overhead, AC1/AC2/AC6): TASK-scoped runs
# (`--for-task <id>` / `--scoped <id>`) do NOT pay this full set every time — they run the
# change-relevant subset (run_scoped_static_checks_sel below): checkers whose object intersects
# the task's `## Touches` plus the ## Contract consumer on the touched task files, SKIPPING
# checker-mutation-check (~13s) and the unrelated repo-level ratchets. The complete set here is
# unchanged by the tier (AC2 — the full-suite gate is NOT weakened); a scoped skip is DEFERRED to
# the full-suite gate, never dropped (AC4-ii: scoped = fast feedback on the change; full = complete
# gate). Each checker carries a `# @static-tier <always|change|full>` + `# @static-object <glob>…`
# annotation (and an optional `# @static-class <doc|operational>` class marker) that
# select-static-checks-for-touches.ts parses (the SAME single source checker-mutation-check.sh
# parses — never a hand-maintained list, AC3).
# @checker-count 63 — the number of run_checker entries in the FUNCTION BELOW (counted by
# plugin/scripts/checker-count-drift-check.ts). Adding/removing a checker means updating this line,
# and the check is what tells you; do not restate the number in prose.
run_static_checks() {
  # QUAY_TEST_NESTED — set by mark_nested() right before the outer suite's node --test. A nested
  # invocation (a test that spawns scripts/test.sh) inherits it and skips the whole-store checks
  # the OUTER suite already ran at its start (gap-suite-speed-under-a-297-second-sigma). Same-root
  # guard: a nested run in a DIFFERENT worktree keeps its own checks.
  if [ "${QUAY_TEST_NESTED:-}" = "1" ] && [ "${QUAY_TEST_NESTED_ROOT:-}" = "${repo_root}" ]; then
    echo "scripts/test.sh: QUAY_TEST_NESTED=1 — skipping static checks (nested invocation; outer suite ran them)"
    return 0
  fi
  # QUAY_TEST_SKIP_STATIC_CHECKS=1 — set by 0-match / pure-selector NESTED invocations (same shape as
  # QUAY_TEST_SKIP_DIST_BUILD): the outer suite already ran these whole-store checks at its start, and
  # a nested smoke run that matches 0 tests does not re-verify them. Skipping avoids a real race: a
  # sibling test's transient untracked fixture (runner-grouping AC7's zz-*-undeclared.test.mjs) can
  # appear as a spurious "NEW file without @test-group" to test-framework-policy-check if it exists
  # during this window (surfaced 2026-08-03 in the stranded+parser combined suite).
  if [ "${QUAY_TEST_SKIP_STATIC_CHECKS:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_STATIC_CHECKS=1 — skipping static checks (nested 0-match/smoke run; outer suite ran them)"
    return 0
  fi
  # Parallel execution (gap-run-static-checks-zero-concurrency-can-parallelize): the CODE-class
  # checkers below (count declared by this function's own `# @checker-count` annotation — as are the
  # OPERATIONAL-class count on run_operational_checks and the DOC-class count on run_doc_checks in
  # scripts/test.sh, both machine-checked by plugin/scripts/checker-count-drift-check.ts) are
  # independent, read-only, and share no state — the
  # sequential run was structural zero-concurrency. RUN_CHECKER_PARALLEL=1 makes run_checker launch
  # each checker in the BACKGROUND,
  # bounded to STATIC_CHECK_CONCURRENCY (default nproc — "读 nproc"; set the env var for a fixed N).
  # The trailing run_checker_parallel_wait waits for all and fails closed (non-zero exit, set -e
  # abort) on ANY checker failure (AC3 — a failing checker's output + name are visible, never masked
  # by siblings), and every checker's cost row is still appended (AC4 — run_checker's
  # checker_cost_append completes before the wait observes it). The scoped tier leaves this unset.
  RUN_CHECKER_PARALLEL=1
  echo "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) =="
  # @static-tier full  (whole-store ratchet — deferred to the full-suite gate in scoped mode)
  run_checker "it0-split-or-commit-check" bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" "${repo_root}"
  echo "== split-or-commit delta-scoped companion (gap-it0-split-or-commit-check-needs-change-tier-companion) =="
  # A change-tier companion to the FULL-tier whole-store ratchet directly above (which is left
  # byte-unchanged — deferred, never dropped): the SAME script in `--changed` mode, which derives
  # THE DELTA's task files from git (never from ## Touches) and judges ONLY those plus their 1-hop
  # neighbour closure (children / parent / depends_on). The full-tier pass judges the whole task
  # tree, so a relation broken by one task reddens an UNRELATED task's fan-in while the task that
  # broke it ships scoped-green — measured 17 such fan-in reds in .quay/verification-round.jsonl
  # (first 2026-08-13T14:24:11Z, last 2026-09-04T08:16:12Z; 17/17 rounds tests==0 ∧ fail==0, i.e.
  # pure static red). This is the repo's既定解法 for exactly this defect class, not a new invention:
  # `quay-init-closure-ratchet-stale` (:571-573 above) is the same shape and drove that checker's
  # fan-in reds 35 → 0 after 2026-09-06. Cost is ∝ the delta's fan-out (measured 0.06–0.09 s for a
  # 1-task delta), NOT the whole-store pass (measured 0.49 s for 2090 tasks) — which is why the
  # full-tier pass is NOT simply moved forward (that would add its whole-store cost to every task).
  # Attribution: the full tier was deferred precisely because its red is NOT guaranteed to come from
  # this delta (whole-store); a delta-narrowed run's red IS attributable by construction (a violation
  # is reported only when one of the tasks IT NAMES is a delta task), which is what绕开s the
  # attribution problem instead of ignoring it.
  # ⛔ NOT-EVALUATED is an explicit line + exit 0, never exit 3: the scoped runner evals raw commands
  # under `set -euo pipefail`, so exit 3 would ABORT an innocent task whose delta carries no task
  # file. Same scoped-safe convention as suite-bucket-drift-check.
  # ⚠️ `@static-object tasks/` means this is selected for every task-file delta (the selector always
  # appends `tasks/<id>.md` in --task mode, select-static-checks-for-touches.ts:834) — the store IS
  # this checker's carrier, and `landing-target-check` (:307) carries the identical object at the
  # same tier. It is NOT `always` tier: a delta with no task file (any --touches file-list outside
  # `tasks/`) selects nothing here. What keeps the per-task cost affordable is the delta-scoped
  # loading (① above), not a narrower trigger.
  # @static-tier change
  # @static-object tasks/ plugin/scripts/runner-static-gate.ts plugin/scripts/it0-split-or-commit-check.ts plugin/scripts/it0-split-or-commit-check.sh plugin/scripts/checker-mutation-cases/it0-split-or-commit-check.sh
  run_checker "it0-split-or-commit-check-changed" bash "${repo_root}/plugin/scripts/it0-split-or-commit-check.sh" --changed "${repo_root}"
  echo "== checker mechanical-spine check (gap-b1-mechanical-spine-doc-checker, AC1/AC2/AC3) =="
  # Mechanical spine (B1, SPEC-checker-mechanical-spine-contract-2026-08-28.md): every checker's
  # exit-code vocabulary must be within {0,1,2,3} (0=PASS, 1=FAIL, 2=usage/env-error,
  # 3=NOT-EVALUATED) and a --json claim must actually emit JSON. A NEW violation (not on the
  # shrink-only exemption list plugin/scripts/checker-mechanical-spine-exemptions.json) or an ADDED
  # exemption entry red-lights the commit (set -euo pipefail abort) — a fixed file can never
  # silently drift back. Whole-store scan of the checker corpus (plugin/scripts/*-check.{ts,sh}),
  # cheap (read 110 files + regex). Negative/positive controls:
  # plugin/scripts/checker-mutation-cases/checker-mechanical-spine-check.sh + the checker's own
  # plugin/test/checker-mechanical-spine-check.test.mjs.
  # @static-tier full  (whole-store ratchet — deferred to the full-suite gate in scoped mode)
  run_checker "checker-mechanical-spine-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/checker-mechanical-spine-check.ts" --root "${repo_root}"
  echo "== test-framework-policy check (gap-no-test-framework-policy-for-new-tests, AC1/AC3-AC5) =="
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "test-framework-policy-check" bash "${repo_root}/plugin/scripts/test-framework-policy-check.sh" "${repo_root}"
  echo "== @test-group downgrade check (gap-test-group-downgrade-no-guard, AC1/AC2/AC3) =="
  # A LEGAL-but-degrading @test-group re-tag (product/engine → serial/lowconc) silently
  # removes a test from the default {product,engine} set (serial/lowconc drop
  # out of the default concurrency body) — previously NO check reported it. This checker requires a
  # commit-message reason marker ("@test-group-downgrade") for any default-set escape after the
  # enforcement baseline (8ea050c7 — develop HEAD when the guard landed); uncommitted escapes always
  # fail (commit with the marker first). Wired here (AC3) so EVERY test-running invocation and CI —
  # whose only test step is `bash scripts/test.sh` — inherits it. Also invoked from
  # check_group_declarations (AC1, the declarations guard's pre-flight + metadata-mode call sites).
  # Negative/positive controls: plugin/scripts/checker-mutation-cases/test-group-downgrade-check.sh
  # (temp-git-repo fixture, real git output) + the checker's own --selftest.
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "test-group-downgrade-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/test-group-downgrade-check.ts" --root "${repo_root}"
  echo "== test-isolation contract check (gap-test-isolation-contract-is-unwritten, AC1-AC6) =="
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "test-isolation-check" bash "${repo_root}/plugin/scripts/test-isolation-check.sh" "${repo_root}"
  echo "== tmp-leak pairing check (gap-tmp-leak-... 2026-08-12 /tmp audit: 3389 dirs / 1.1GB) =="
  # Mechanical "修完不复发" gate: every mkdtemp/mkdtempSync result in a test file MUST be paired with
  # a cleanup (rmSync / after() carrier / caller-cleans-return). BLOCKS (exit 1) on any unpaired
  # mkdtemp — unlike test-isolation-check's R6 rule, which reports the same class but is baselined
  # (报出而不阻断). The corpus is at ZERO unpaired mkdtemps after the leak fix; a regression goes RED
  # and aborts the suite (set -euo pipefail), so a fixed file can never silently re-leak.
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "tmp-leak-pairing-check" bash "${repo_root}/plugin/scripts/tmp-leak-pairing-check.sh" "${repo_root}"
  echo "== test-impl-census check (gap-experiment-legacy-reclaim-and-touches-heuristic AC5) =="
  # Mechanized criterion "被测实现不存在的测试文件随实现删除": a test file that imports a
  # scripts/<name> module that exists NOWHERE (plugin/scripts, experiments/scripts, repo scripts/
  # or the adjacent package scripts) is an impl-deleted test — the census measured 15 such files
  # still running every full suite. exit 1 red-lights the commit (set -euo pipefail) so a script
  # deleted/reclaimed without its test delete can never silently re-accumulate.
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "test-impl-census-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/test-impl-census-check.ts" --root "${repo_root}"
  echo "== checked-in-tree write check (gap-suite-glob-universe-fixture-write-toctou) =="
  # THE INVARIANT: 测试不得在已签入路径下创建或删除条目；一切临时产物落在进程私有临时目录.
  # Its judge (checked-in-write-check.ts) was built by gap-fixture-dir-write-races-whole-tree-copy
  # and then NEVER WIRED: `grep -n 'checked-in-write' runner-static-gate.ts` was 0 hits, so the
  # invariant had no executor in the suite and its SECOND instance survived — a fixture created and
  # deleted at `plugin/test/__no-group-fixture__.test.mjs`, i.e. INSIDE the SUITE_GLOBS universe
  # (`plugin/test/*.test.mjs`), so a concurrent enumerator (listSuiteFiles → readFileSync per path in
  # suite-bucket-reattr-ratchet-check.ts) hit ENOENT and the whole fan-in suite reddened on an
  # UNRELATED landing task (round 1637, 2026-09-13T11:05:03Z, commit dab664bc4). Registering it here
  # is what turns the invariant from prose into an executor.
  # --changed (DELTA-SCOPED), NOT a full sweep: this judge RUNS each input (that is what makes it a
  # position-based runtime judge rather than the discarded 605-false-positive source scanner), so its
  # cost is ~1s–60s PER FILE and the corpus is 336 files under plugin/test alone — sweeping it here
  # would cost more than the suite it guards. Delta is the repo's既定 answer for this shape (the same
  # `--changed` / `--check-changed` companion convention as it0-split-or-commit-check and
  # checker-mutation-check): a new or edited test file is judged at its OWN landing. An empty delta
  # reports NOT-EVALUATED (never PASS) and exits 0 — scoped-safe, because the scoped runner evals raw
  # commands under `set -euo pipefail` and exit 3 would abort an innocent task whose delta carries no
  # test file. The full sweep stays available manually: `--dir plugin/test`.
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/
  run_checker "checked-in-write-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/checked-in-write-check.ts" --changed --root "${repo_root}"
  echo "== ## Contract consumer check (gap-dispatch-gate-has-no-checklist-and-no-trace, AC6) =="
  # gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed: this checker had NO runner — its
  # shrink-only ratchet list (docs/analysis/contract-violations.md) grew 1 -> 12 unnoticed because
  # the only consumer was an ad-hoc pre-dispatch run. Wiring it here (same place as the other three
  # whole-store checkers) gives every test-running invocation — and CI, which inherits it via its
  # single `bash scripts/test.sh` step — the ratchet enforcement for free. exit 1 on ratchet growth
  # aborts the suite (set -euo pipefail), so a NEW violation red-lights the commit, not the dispatch.
  # --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①): this is
  # a TASK-FILE checker (it scans tasks/*.md Contract/AC syntax) — a task-file syntax issue is a
  # DIFFERENT risk class from "is the product code usable", so it must NOT stop the product-verification
  # round. --no-block records new violations in the grow-only ledger (.quay/task-file-violation-ledger.jsonl,
  # 只增不减 记账) but exits 0; the round proceeds to the test phase. Product-code checkers below keep
  # their blocking exit. The checker's DEFAULT mode (no --no-block) still blocks for maintenance/mutation.
  # @static-tier always
  # @static-scoped-mode subset-touched
  run_checker "task-contract-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/task-contract-check.ts" --root "${repo_root}" --no-block
  echo "== AC-carryover check (gap-nothing-checks-whether-a-done-task-left-its-acs-behind, AC6) =="
  # @static-tier full  (whole-store ratchet — deferred to the full-suite gate in scoped mode)
  # A done task may leave ACs unchecked ONLY if a successor `## Carries` section names them — the
  # gate on the gates: nothing previously noticed a done task closing with half its ACs unchecked and
  # no carrier (measured 2026-08-03: session-liveness closed done with 8/16 unchecked, stage-2
  # existed only because the outer happened to look). Wired here (same site as task-contract-check)
  # so CI — whose only test step is `bash scripts/test.sh` — inherits it for free. The legacy
  # baseline (docs/analysis/task-ac-carryover-baseline.md) is shrink-only: exit 1 on a NEW unowned
  # AC aborts the suite (set -euo pipefail), red-lighting a done task that just closed with
  # uncarried ACs instead of letting it merge silently.
  # --no-block (gap-task-file-static-syntax-should-not-block-product-verification, option ①): same
  # degradation as task-contract-check above — a NEW unowned AC is ledgered (grow-only) but does not
  # stop the verification round (task-file syntax ≠ product-code availability).
  run_checker "task-ac-carryover-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/task-ac-carryover-check.ts" --root "${repo_root}" --no-block
  echo "== malformed-task check (gap-malformed-task-silent-vanish-no-alert, AC1-AC3) =="
  # A task file whose frontmatter fails to parse is SILENTLY REMOVED from the whole store — the
  # only signal is a `quay task list` Warning line that NO checker read (invisible ≡ non-existent,
  # hard rule ④; live sample 2026-08-13: `title: [封存] …` dropped the file from 1075→1074 listed,
  # slot-refill hit it 0 times, `task edit` said "task does not exist yet"). This checker consumes
  # the store's OWN malformed array (store.listWithMalformed(), the same producer the Warning
  # reads) and turns a non-empty malformed list RED (exit 1, set -euo pipefail abort), printing
  # each excluded file + parser error. Complements 57c30fdf (gap-serve-task-list-dies-on-one-
  # malformed-task): that fix stopped the server 500ing on one bad file; this makes the SAME signal
  # a failing gate on the consumer that actually guards commits. BLOCKS (unlike the --no-block
  # task-file syntax checkers) because a malformed task is a SILENT REMOVAL, not a syntax nit.
  # Whole-store scan, cheap at ~1.1k tasks.
  # @static-tier always
  # @static-scoped-mode subset-touched
  run_checker "malformed-task-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/malformed-task-check.ts" --root "${repo_root}"
  echo "== Touches one-entry-one-path check (gap-touches-connector-delimiter-uncaught, AC1-AC4) =="
  # A ## Touches bullet must declare EXACTLY ONE path/glob entry; a bullet carrying a path-separating
  # delimiter (" / " / " + " / "、" / "，" / ",") declares ≥2 REAL paths in one line, which the ONE
  # parser (parseTouchEntriesWithTags) reads as ONE composite entry — matching no file on disk and
  # HIDING each real path from checkTouchesPair's overlap judgment (AC66→AC78 判据3; AC93/ac86/AC91
  # anti-drive HARD FAIL — the " + " connector was NOT in the delimiter set, so all three slipped
  # author time). Wired here (same site as the other whole-store task-file checkers) because it was
  # an ORPHAN — present + unit-tested but never executed, so the three + fan-in slips passed author
  # time (硬规则⑨ 可见性≠执行: the checker existed but no run_static_checks consumer called it).
  # BLOCKS (exit 1) on any non-grandfathered multi-path bullet (set -euo pipefail abort), so a new
  # " + "/" / "/"、" / "，" / "," bullet red-lights the commit; the shrink-only baseline
  # (docs/analysis/touches-one-entry-one-path-baseline.md) absorbs the pre-rule DONE debt (8 " / "
  # + 13 " + " + 2 "、" = 23). Whole-store scan, cheap at ~1.1k tasks.
  # @static-tier always
  # @static-scoped-mode subset-touched
  run_checker "touches-one-entry-one-path-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/touches-one-entry-one-path-check.ts" --root "${repo_root}"
  echo "== ADR-016 screen-use check (gap-adr-016-carve-out-permits-the-whole-screen-hash, AC3) =="
  # ADR-016 Amendment 2026-08-04 boundary (c): whole-screen equality/hash of capture-pane is
  # forbidden. Code-position detection (a capture-pane result flowing into md5sum/sha1sum/cksum in
  # a shell script OR a fenced ```bash instruction block of a shipped/live tick doc), band 0..1
  # (the ONE active legacy observer — session-liveness.sh — is carried by the sibling task; a NEW
  # active violation red-lights the commit). Tick docs are scanned for their bash blocks because
  # shipped .md instruction blocks are same-weight as .sh (gap-adr016-md5-ban-violated-in-shipped-
  # md-and-checker-scope-gap AC3).
  # @static-tier change
  # @static-object **/*.sh **/*.bash plugin/loop/*-loop-tick.md orchestration/*-loop-tick.md plugin/scripts/adr016-screen-use-check.ts plugin/test/adr016-screen-use-check.test.mjs
  run_checker "adr016-screen-use-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/adr016-screen-use-check.ts" --root "${repo_root}"
  # AC66 A22 agent-id check RETIRED (AC135, 2026-08-22): A22 供给侧心跳已退役，晋升由 promotion-driver
  # 承接；其「tick-log A22 读数行带 agent 标识」判据失去对象 → checker + test + mutation case 一并移除。
  echo "== superseded-capability check (gap-retired-script-still-callable, AC5) =="
  # One capability = ONE implementation. A superseded implementation (the SUPERSEDED table in
  # capability-catalog.sh — currently send-keys-verified.sh, deleted 2026-08-10 under human ruling)
  # must NOT exist in the executable layer (plugin/scripts, plugin/test, packages/*/plugin vendored
  # copies) and must NOT be taught in SKILL/README positions. This mode asserts the invariant every
  # run, so a deleted superseded implementation can never silently regrow (target state ⑤).
  # @static-tier always
  run_checker "superseded-capability-check" bash "${repo_root}/plugin/scripts/capability-catalog.sh" --superseded-check
  echo "== dead-code-after-return check (gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived, AC6) =="
  # The 2026-08-03 TEMPORARY pin shape (`echo 8; return 0; <formula>` — a statement after a top-level
  # return) is the drift that made docs/ACs/tests report "derived" while the code returned a constant.
  # This checker bans that form across all shell scripts; a NEW instance red-lights the commit.
  # @static-tier change
  # @static-object **/*.sh **/*.bash
  run_checker "dead-code-after-return-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/dead-code-after-return-check.ts" --root "${repo_root}"
  echo "== concurrency-literal-only-at-definition-points check (gap-concurrency-literal-only-at-definition-points, AC1-AC3) =="
  # 并发数值字面量只允许在唯一定义点（QUAY_MAX_TASK_SUBAGENTS / QUAY_MAX_CONCURRENT_SUITES /
  # QUAY_MAX_OVERSUBSCRIPTION —— 人 2026-08-13 框架的旋钮 ①②③）或显式声明的回退默认
  # （`concurrency-default-fallback` 标记注释）；未声明的并发字面量 = 违规（禁「悄悄写死」,
  # 不禁「有理由的默认值」—— CLAUDE.md 硬规则 4 推论二 enforcement）。按位置判定（checker-lib
  # buildNonCodeMask）—— 注释/字符串/正则里拼写该模式不报。exit 1 违规即红（set -euo pipefail）,
  # 一个新写死的并发数在提交时刻红,不用等换机器才暴露。
  # @static-tier change
  # @static-object plugin/scripts/ scripts/ plugin/scripts/concurrency-literal-check.ts plugin/test/concurrency-literal-check.test.mjs
  run_checker "concurrency-literal-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/concurrency-literal-check.ts" --gate --root "${repo_root}"
  echo "== target-identity-literal check (gap-ac226-target-identity-literal-check, GOAL-012 B 域) =="
  # TARGET 域（GOAL-012 B 域）：shipped kernel 把逐项目不同的身份（分支名 / test_command / tasks_dir）
  # 写成无 override 通道的裸字面量、而非从目标项目 config / 运行时 git 状态派生。判别标准（写进实现，
  # ⛔ 不留给读者意会）：逐项目不同 ∧ 无 override 通道；合法默认值（develop/integration/master/tasks/
  # HEAD——逐项目不变）不误报。按位置判定（buildNonCodeMask——注释/字符串里拼写不报）。exit 1 违规即红
  # （set -euo pipefail），一个把目标身份写死的裸字面量在提交时刻红，不用等换第三方项目才暴露。
  # @static-tier change
  # @static-object plugin/scripts/ packages/quay/src/ plugin/scripts/target-identity-literal-check.ts plugin/test/target-identity-literal-check.test.mjs
  run_checker "target-identity-literal-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/target-identity-literal-check.ts" --root "${repo_root}"
  echo "== worktree-namespace literal check (gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root, AC3) =="
  # 工作区命名空间字面量不得重生：读侧只能经单一入口 packages/quay/src/worktree-namespace.ts
  # （DEFAULT_WORKTREE_NAMESPACE_NAME 的回落分支），第二处双引号字面量 = 又一次「写用 config、读用硬编码」。
  # 谓词即 AC 自己的 grep（对两个扫描根数双引号命中数 ≤1，且唯一命中必须落在该声明处）；
  # 非引号出现（path 正则 / 注释 / 散文）只报 advisory 计数、永不判红（硬规则 5b 兄弟可见性）。
  # 本例检查器自身【不含】该字面量（搜的是 JSON.stringify(常量)），故不会把自己算成第二处。
  # @static-tier change
  # @static-object packages/quay/src/ plugin/scripts/ plugin/scripts/worktree-namespace-literal-check.ts plugin/test/worktree-namespace-literal-check.test.mjs
  run_checker "worktree-namespace-literal-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/worktree-namespace-literal-check.ts" --root "${repo_root}"
  echo "== freshness-producer coverage check (gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger, AC7) =="
  # AC-214 要求七个「载体型主体」的证据距 develop tip ≤ K 交付面提交，而**刷新动作曾无触发器**：
  # 4 次转红 / 5 天，每次一次性人工重跑关闭、每次关闭后重新越界。本检查判的是**刷新机制的完备性**
  # （不是新鲜度）：载体里出现过的主体是否每一个都在单源映射 plugin/freshness-producers.json 里登记了
  # 产出者、登记的那些是否真有载体记录，并与 criterion 自己写出的 .quay/goal-freshness-margin.json
  # 的 subjects 双向对照（那一侧能看见「产出者从未跑过、载体里根本没记录」的主体 —— 09-13 的形态）。
  # 载体是 gitignored 运行时态：**缺席 ⇒ exit 0 且 evaluated:false**（可区分的 NOT-EVALUATED，⛔ 不与
  # 合格同形；硬规则 3b），故被动检出（无 .quay/ 载体）照样在代码面绿；映射缺失/损坏 ⇒ exit 2 fail-closed。
  # @static-tier change
  # @static-object plugin/freshness-producers.json plugin/scripts/freshness-producer-coverage-check.ts plugin/test/freshness-producer-coverage-check.test.mjs
  run_checker "freshness-producer-coverage-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/freshness-producer-coverage-check.ts" --root "${repo_root}"
  echo "== task-file-bypass check (gap-adr013-gate-blind-spots-and-task-bypass-ratchet, AC4/AC5) =="
  # Fail-closed ratchet on direct `tasks/*.md` access outside the Provider ABI: a `tasks/` path literal
  # used as the argument of a file-operation (fs.* / readFileSync / writeFileSync / execFileSync /
  # spawnSync / git-show-on-task-path / shell grep-cat-test) in a file OUTSIDE the ALLOWLIST is a NEW
  # bypass → exit 1. The ALLOWLIST (exported constant, one entry per line) is the baseline of today's
  # known, currently-necessary bypass sites — the sibling tasks
  # gap-task-ops-consolidate-driver-frontmatter-writers / gap-quay-task-consolidated-subagent /
  # gap-worker-prompt-ac-check-via-abi-not-hand-edit shrink it; an allowlisted file's hit-count drift is
  # a WARN (not a fail), so shrinking the allowlist is a deliberate, reviewed edit, never a silent
  # capability loss. Positional (hard rule 2): a tasks/ string used as a search needle / path-prefix
  # classification / comment mention / a call spelled inside a string literal does NOT report.
  # @static-tier change
  # @static-object packages/quay/src/ plugin/ plugin/scripts/task-file-bypass-check.ts plugin/test/task-file-bypass-check.test.mjs
  run_checker "task-file-bypass-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/task-file-bypass-check.ts" --gate --root "${repo_root}"
  echo "== suite-slot SSoT check (gap-suite-concurrency-ff-gate-and-slot-ssot, AC4 行为层不变量) =="
  # suite 并发量「能跑几个 suite」的单一定义点行为层不变量:
  #   I1 — fan-in-ff-merge.sh 代码不含 'full-suite.lock' 读取 (ff 闸只读本任务 capture, AC1 收窄)
  #   I2 — 全仓代码无 'full-suite.lock.<数字>' 字面量 / FULL_SUITE_LOCK_<数字> 变量 (槽路径由 canonical
  #        以循环变量生成; 直接对着表现形式, 不依赖谁读 S — 字面量扫描器看不见结构性编码的缺陷形态)
  #   I3 — 四处消费者 (test.sh / full-suite-runner.ts / worktree-process-reaper.ts / ff-merge) 读唯一实现
  #   I4 — bash canonical 与 TS canonical 槽数一致 (跨语言漂移检测)
  # 每条都能取假 (I2 已实测: 模板字面量/字符串/变量名三形态均红; 注释屏蔽)。exit 1 任一 RED 即红。
  # @static-tier change
  # @static-object plugin/scripts/ scripts/ plugin/scripts/suite-slot-ssot-check.ts plugin/scripts/suite-lock-slots.ts plugin/scripts/suite-slot-lib.sh plugin/test/suite-slot-ssot-check.test.mjs
  run_checker "suite-slot-ssot-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/suite-slot-ssot-check.ts" --gate --root "${repo_root}"
  echo "== suite-bucket reattribution ratchet (gap-suite-bucket-dynamic-truth-drift-detector, ③-AC6/③-AC7/③-AC8) =="
  # AC121 把 230 个调 test.sh 的测试逐条重归属为 S|M（.quay/suite-bucket-reattribution.jsonl），但覆盖保证是
  # 一次性人工声称（"重扫=0"），非机械 ratchet。本检查让「漏判」变响：新增一个静态纯 S（bucketSetOf={S}，
  # 仅 scripts/test.sh 提及为 subject）且未入重归因的测试 ⇒ RED（第 1 层，阻断——AC121 误归 S 的漏测形态，
  # 基线=0）；含 S 信号但非纯 S（S+M/P+S/P+S+M）未入重归因 ⇒ 只报计数不阻断（第 2 层，留痕——过度选择是
  # 安全方向，现状 14）。重归因文件缺失 ⇒ NOT-EVALUATED（exit 3，硬规则 3b——永不与「0 漏判」同形）。
  # 第 3 层（阻断，③-AC8，gap-suite-bucket-zombie-check-bills-the-next-unrelated-task）：重归因【条目】所指的是
  # 已不存在的 suite 测试文件 ⇒ ZOMBIE ⇒ RED。该条件原先只由本文件的单测 ③-AC8 判定（= 只在全量套件的某一轮里判），
  # 于是「删/归档了某个 suite 测试文件却没同步删条目」的那个变更在【自己那一刻】拿不到任何信号，要等数小时后自己那轮
  # 全量套件才知道，并额外付一次「清僵尸条目」的补提交（生产记录：651 perFile runs / 10 fails，横跨 8 个任务，每次红后
  # 都跟着一条清条目提交）。判定移进 checker 后它落在本 checker 自己的面上——@static-tier change，scripts/test.sh 在
  # scoped 轮里按 @static-object 选中它 ⇒ 制造僵尸的那个变更在自己的 scoped 门就被判红（秒级），而不是等自己那轮全量。
  # ⚠️ 立案时的前提「红落在下一个【无关】任务身上」**已被实测证否**（10/10 红的成因提交就是记账任务自己的）——
  # 形态是【迟到】不是【错位】；本条注释与 checker 头注释都以实测为准，不要再复述那个前提。
  # mutation case: 纯 S 已重归属 → 绿；移除归属 → 红（第 1 层）；删掉条目所指的文件而保留条目 → 红（第 3 层）；恢复 → 绿。
  # @static-tier change
  # @static-object .quay/suite-bucket-reattribution.jsonl plugin/scripts/suite-bucket-reattr-ratchet-check.ts plugin/test/suite-bucket-reattr-ratchet-check.test.mjs plugin/test/ experiments/*/test/ packages/*/test/
  run_checker "suite-bucket-reattr-ratchet-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/suite-bucket-reattr-ratchet-check.ts" --gate --root "${repo_root}"
  echo "== landing-target branch-consistency check (gap-landing-target-branch-consistency-check, AC1-AC4) =="
  # 任务落地目标分支必须 == 当前前锋分支（develop..integration=0 不变式；机制家族第 4 次——「落地路径」
  # 字段与当前分支模型的一致性没有消费者）。前锋分支由 git 关系读宿主推出（integration ⊆ develop ⇒
  # develop; develop ⊆ integration ⇒ integration; 发散 ⇒ 模型损坏 fail-closed）——不硬编码分支名,
  # 分支模型迁移时同一公式自动跟随（AC2）。扫描任务体作者面（title/Proposal/Plan/Contract/Finding）
  # 的落地目标表述（合入 X / merge 到 X / 落到 X / 落地 X, X 必须是真实分支名——"落地 ADR-016" /
  # "merge into 1" 不是落地目标）; 历史记录（已/经/由/被 + 后/前）、否定（未/不/勿）、引例（「合入 X」）
  # 与显式 `landing-exception:` 例外（AC4 的「本次例外何时清回 0」说明）不算声明。exit 1 目标≠前锋即红
  # （set -euo pipefail）—— 一条新写的错误落地目标在提交时刻红,不靠手工勾选表。mutation case:
  # plugin/scripts/checker-mutation-cases/landing-target-check.sh（基线→注入→恢复→例外→模型迁移）。
  # @static-tier change
  # @static-object tasks/ scripts/test.sh plugin/scripts/landing-target-check.ts plugin/scripts/checker-mutation-cases/landing-target-check.sh
  run_checker "landing-target-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/landing-target-check.ts" --gate --root "${repo_root}"
  echo "== commit-message verified-claim check (gap-commit-message-claims-verified-without-verification, AC11) =="
  # Commit messages are an AC11 carrier: merge commit 8e2e49b9's message claimed "all syntax
  # verified" while carrying real merge corruption (trend-check.ts duplicated 2×, 8 task
  # frontmatters unparseable) — history is NOT re-verified by later readers, so a bare
  # verified-claim in a commit message is more dangerous than one in a task body/tick row.
  # This checker scans the live window (git log -n 100 from the repo root — ≈2 days at the
  # fast-mode loop's ~40-50 commits/day, far beyond the original 7h41m discovery delay) and
  # flags any commit whose message makes a "verified"-class ASSERTION without a reproducible
  # verification command/reference (script path / test invocation / result counts /
  # verifiedCommit= / backtick command). Judgment is POSITIONAL: a task-id
  # (gap-…-verified-…), a descriptive "re-verify", a negation ("unverified"), or a CITED claim
  # ("… claims 'all syntax verified'") is not an assertion. Exit 1 red-lights the commit
  # (set -euo pipefail), so a new bare verified-claim reddens at the next test run — not after
  # a 7h41m discovery delay. Negative control + mutation case:
  # plugin/test/commit-message-verified-check.test.mjs + checker-mutation-cases/<name>.sh.
  # @static-tier change
  # @static-object plugin/scripts/commit-message-verified-check.ts plugin/test/commit-message-verified-check.test.mjs scripts/test.sh
  run_checker "commit-message-verified-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/commit-message-verified-check.ts" --root "${repo_root}"
  echo "== judgment-consumer check (gap-judgment-computed-not-wired-to-action, AC2/AC3) =="
  # The 判据→消费动作 audit — the class-level discipline "每个机械判据必须有消费它的动作" made
  # mechanical. The registry (plugin/scripts/judgment-consumer-check.ts) lists every audited judgment
  # with the action that consumes it; a judgment declared `wired` whose consumer patterns do not
  # verify is the exact defect class (2026-08-10: deficit / not-yet-flipped / self-touch-scan — the
  # signal was computed, nothing acted on it) and red-lights the commit. A judgment with no consumer
  # is listed `unfinished` (never silently green). Exit 1 on drift (wired-but-missing or
  # unfinished-but-stale) aborts the suite. The mutation case exercises the wired→missing→restore
  # direction; plugin/test/judgment-consumer-check.test.mjs asserts the full-registry audit.
  # @static-tier change
  # @static-object orchestration/orchestrator-tick-core.md plugin/loop/fast-mode-tick-core.md plugin/scripts/judgment-consumer-check.ts plugin/scripts/ready-pool-check.ts plugin/scripts/slot-refill.ts plugin/scripts/touches-orthogonality-check.ts plugin/scripts/closure-lag-check.sh plugin/scripts/obligation-ledger.ts plugin/test/judgment-consumer-check.test.mjs
  run_checker "judgment-consumer-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/judgment-consumer-check.ts" --root "${repo_root}"
  echo "== cap-counts-subagents check (gap-ac76-cap-counts-subagents-not-worktrees, AC1-AC6) =="
  # AC76 (人 2026-08-14 07:3xZ/09:1xZ 裁定): cap 的被计量对象 = 并发 subagent, 禁 worktree 代理.
  # A full day of in-flight readings used `git worktree list | grep -c` — wrong in both directions
  # (07:2xZ wt=4/sub=2 ⇒ 高估 2; 07:4xZ wt=1/sub=2 ⇒ 低估 1). This checker makes the criteria
  # mechanical: 判据1 slot-refill.ts 正本点名被计量对象+禁 worktree 代理; 判据2 第三方读法 =
  # <session>/subagents/agent-*.jsonl 近 N 分钟写入数; 判据3 真样本回放红 (worktree≠subagent); 判据4
  # 报数带计法; 判据5 C24-1/2/3 在飞派生退役为显式标注 (RETIRED (AC76 C24-N)); 判据6 /live 三条 done
  # (AC66/AC72/AC73) 误报在跑真样本回放红. GREEN by construction when none of the criteria's inputs
  # are violated; RED on any worktree/telemetry-bracket in-flight proxy form or a missing C24
  # annotation.
  # @static-tier change
  # @static-object plugin/scripts/slot-refill.ts plugin/scripts/fast-mode-telemetry.ts plugin/scripts/inner-wakeup-heartbeat-check.ts plugin/scripts/cap-counts-subagents-check.ts plugin/test/cap-counts-subagents-check.test.mjs
  run_checker "cap-counts-subagents-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/cap-counts-subagents-check.ts" --root "${repo_root}"
  echo "== delivery-inventory drift gate (gap-drift-gate-covers-only-plugin-scripts-not-workflows, AC2) =="
  # The file-set change gate on the plugin/workflows mirror: `--diff-filter=AD` on .claude/workflows/
  # — git committed range + working-tree staged/unstaged/untracked — is the ONLY trigger; when it
  # fires, the SAME change set must mirror into plugin/workflows/. Content-only edits to existing
  # workflows do NOT trigger (invariant content_only_change_skipped = 1). FAIL-closed: a
  # .claude/workflows A/D without a plugin/workflows mirror touch exits 1. The ORIGINAL trigger on
  # the outline §6 DELIVERY-INVENTORY snapshot is RETIRED (gap-delivery-inventory-check-time-computation):
  # the snapshot is now computed at check time by verify-delivery-surface.ts --inventory, so there is
  # nothing for a plugin/scripts A/D to co-touch.
  # @static-tier change
  # @static-object .claude/workflows/ plugin/workflows/
  run_checker "delivery-inventory-drift-gate" bash "${repo_root}/plugin/scripts/delivery-inventory-drift-gate.sh" --root "${repo_root}"
  echo "== capability-manifest check (gap-delivery-manifest-capability-map, AC1-AC4) =="
  # Bidirectional capability↔delivery-manifest enumeration: every SOURCE capability (driver kind /
  # CLI top-level command / MCP server) must be REGISTERED in delivery-manifest.json's capabilities
  # array, and every registered capability must still exist in source. The AC-202 root cause
  # (gap-driver-kinds-table-literal-not-in-dist-entry) was that packaging/closure checks are
  # scan-references heuristics — a NEW literal table/file is structurally invisible to them; a
  # capability INVENTORY (the manifest) to diff against closes that blind spot. exit 1 = unregistered
  # /stale; exit 2 = NOT-EVALUATED (source/manifest unreadable — never conflated with "0 drift").
  # @static-tier change
  # @static-object delivery-manifest.json plugin/scripts/driver-runtime.ts packages/quay/bin/quay.ts packages/quay/src/mcp-server.ts packages/quay-native/src/mcp-server.ts packages/quay-github/src/mcp-server.ts packages/quay-backlog/src/mcp-server.ts plugin/scripts/capability-manifest-check.ts plugin/test/capability-manifest-check.test.mjs plugin/scripts/checker-mutation-cases/capability-manifest-check.sh
  run_checker "capability-manifest-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/capability-manifest-check.ts" --root "${repo_root}"
  echo "== checker-mutation check (gap-checkers-have-never-been-shown-to-fail, AC1-AC6) =="
  # The L_S instrument: mutation-test the checkers THEMSELVES, not product code. The manifest is
  # parsed from THIS function + CI (never hand-written), so a checker added here (or to a CI
  # workflow) appears in the manifest automatically and, until it gets a mutation case in
  # plugin/scripts/checker-mutation-cases/, this gate FAILS — "a new checker with no mutation
  # case" can never silently slip through (AC1b). --check runs every registered checker's
  # mutation case (inject the defect it claims to catch → the checker MUST go red; restore →
  # green) plus the two AC5 regression cases (the #6 zero-dependency-probe rename control and
  # the #10 activity-present-telemetry-empty /live direction). `mutations_that_stayed_green`
  # must be 0 (AC3), and the mechanism also mutates itself (AC4, --selftest).
  # @static-tier full  (the ~13s meta-check on the checkers THEMSELVES — deferred to the full-suite gate)
  run_checker "checker-mutation-check" bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check
  echo "== checker-mutation change-tier companion (gap-checker-mutation-check-has-no-change-tier-companion) =="
  # A change-tier companion to the FULL-tier whole-store mutation check directly above (which is left
  # byte-unchanged — deferred, never dropped): the same script in `--check-changed` mode, which derives
  # the checker carriers of THIS delta from git and runs ONLY their mutation cases. The full-tier check
  # measured 55.6s (median of the last 7 `.quay/checker-cost.jsonl` rows) and runs in the full suite
  # only, so a mutation case broken by a task reddened an UNRELATED task's fan-in while the task that
  # broke it shipped scoped-green — measured 8 such fan-in reds, the last at 2026-09-13T04:41:32Z
  # (`STATIC_CHECK_FAILED: checker-mutation-check` in .quay/verification-round.jsonl). This is the
  # repo's既定解法 for exactly this defect class, not a new invention: `quay-init-closure-ratchet-stale`
  # (:571-573 above) is the same shape and drove that checker's fan-in reds 35 → 0 after 2026-09-06.
  # Cost is ∝ the delta's carriers (measured 0.5s for 1 carrier), NOT the 55.6s whole-store pass —
  # which is why the full-tier check is NOT simply moved forward (that would add 55.6s to every task).
  # Attribution: the full tier was deferred precisely because its red is NOT guaranteed to come from
  # this delta (whole-store / meta-check); a delta-narrowed run's red IS attributable by construction.
  # The @static-object is the checker carriers + the manifest source: an edited checker script, an
  # edited mutation case, or the registry itself (runner-static-gate.ts / scripts/test.sh / CI, whose
  # change can add a NEW checker — the companion then also re-verifies manifest-wide coverage, so
  # "a new checker with no mutation case" reds at ITS OWN task instead of at a stranger's fan-in).
  # ⛔ NOT-EVALUATED is an explicit line + exit 0, not exit 3: the scoped runner evals raw commands
  # under `set -euo pipefail`, so exit 3 would ABORT an innocent task whose Touches name a checker but
  # whose git delta does not contain one (Touches ⊋ delta is normal). Same scoped-safe convention as
  # suite-bucket-drift-check. Pinned by plugin/test/select-static-checks-for-touches.test.mjs
  # (tier/object parse vs --list, with an injected-inconsistency red control).
  # @static-tier change
  # @static-object plugin/scripts/runner-static-gate.ts scripts/test.sh plugin/scripts/checker-mutation-check.sh plugin/scripts/checker-mutation-cases/ .github/workflows/
  run_checker "checker-mutation-check-changed" bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check-changed --repo-root "${repo_root}"
  echo "== check-set-after-change check (gap-check-set-after-change-diff-nameonly-intersect-judged-objects, A0b③) =="
  # After editing a file, which tests run is computed mechanically as git diff --name-only ∩ the
  # test/checker's SELF-DECLARED judged objects (`@judges <glob>…` in the file header — no central
  # table; 判据放在被约束者身上). Regression gate: a change to plugin/loop/manager-tick-core.md
  # (the shipped copy) MUST select the test that judges the copy (quay-init-loop-consumer-doc-refs,
  # which declares `@judges plugin/loop/*`) and MUST NOT select tick-core-static-check (which
  # judges orchestration/*-tick-core.md); a change to orchestration/manager-tick-core.md MUST
  # select tick-core-static-check. This is the pre-commit gate that would have blocked the manager's
  # 12a6b18b cp error chain (ran tick-core-static-check on the copy, the real judge never ran) —
  # the criterion fires on the mechanically computed set, not on the full-suite round.
  # @static-tier change
  # @static-object plugin/scripts/check-set-after-change-check.ts plugin/scripts/checker-mutation-cases/check-set-after-change-check.sh plugin/test/quay-init-loop-consumer-doc-refs.test.mjs plugin/scripts/tick-core-static-check.ts
  run_checker "check-set-after-change-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/check-set-after-change-check.ts" --root "${repo_root}"
  echo "== dispatch-preference check (tasks/gap-ac54-dispatch-preference-file, AC54 判据1/判据2) =="
  # The dispatch-preference file (orchestration/dispatch-preference.md) is the single git-visible
  # source of "who inner dispatches first" (SPEC-dispatch-ordering-semantic-2026-08-13 §4.4). AC54
  # 判据1: the file must be git-visible (NOT under the gitignored .quay/) AND carry all three
  # sections — 默认段 / 覆盖段 / 维护者字段. AC54 判据2 (falsifiable, negative control): deleting ANY
  # one section ⇒ this checker must go RED — pinned by plugin/test/dispatch-preference-check.test.mjs
  # (three missing-section samples all exit 1). Blocks (exit 1) on a missing/thin section so a broken
  # preference file can never silently leave inner dispatching by a mangled tendency.
  # @static-tier change
  # @static-object orchestration/dispatch-preference.md plugin/scripts/dispatch-preference-check.ts
  run_checker "dispatch-preference-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/dispatch-preference-check.ts" --root "${repo_root}"
  echo "== spec-declaration-point check (tasks/gap-spec-declaration-point-mechanical-check, AC1/AC2) =="
  # Every on-disk orchestration/SPEC-*.md must be declared at EVERY known SPEC declaration point. The
  # declaration-point SET is grep-DERIVED — a file under plugin/skills/** referencing
  # `orchestration/SPEC-` (manager SKILL index + init SKILL reference-doc today) — never a hardcoded
  # path list (AC2), so a THIRD declaration point is enforced automatically. A new SPEC missing from
  # any point ⇒ RED (AC1: the bdf8b13d 漏索引 → AC6 红 / 01d4f4e8 补索引漏 reference-doc →
  # referenced-not-landed 红 class). Zero declaration points ⇒ NOT-EVALUATED (exit 2, never conflated
  # with green — hard rule 3b: a check that found nothing to verify must not report PASS). Mutation
  # case + unit tests carry the negative control.
  # @static-tier change
  # @static-object orchestration/SPEC-*.md plugin/skills/** plugin/scripts/spec-declaration-point-check.ts plugin/test/spec-declaration-point-check.test.mjs plugin/scripts/checker-mutation-cases/spec-declaration-point-check.sh
  run_checker "spec-declaration-point-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/spec-declaration-point-check.ts" --root "${repo_root}"
  echo "== skill allowed-tools namespace check (tasks/gap-skill-allowed-tools-plugin-namespace, AC2/AC4) =="
  # `allowed-tools` is exact-string matching, no prefix alias (SPEC §3c) — the quay MCP server ships as a
  # plugin so a correctly-onboarded downstream project sees ONLY `mcp__plugin_quay_quay__*`, and the bare
  # `mcp__quay__*` list in plugin/skills/{loop-driver,routines}/SKILL.md fires for no supported channel. This
  # checker makes the invariant mechanical (SPEC §8 AC2): every `mcp__` tool name in plugin/skills/*/SKILL.md
  # must be `mcp__plugin_quay_quay__*`. POSITIONAL (hard rule 2): only the `allowed-tools` frontmatter field
  # value is judged — prose/body mentions do NOT count. exit 1 on a bare/mis-namespaced name (set -euo
  # pipefail abort) so the next skill author writing a bare name reddens the commit, not ships a dead list.
  # NOT-EVALUATED (exit 3) when no skills dir / no SKILL.md (hard rule 3b). Negative control + mutation case:
  # plugin/test/allowed-tools-plugin-prefix-check.test.mjs + checker-mutation-cases/<name>.sh.
  # @static-tier change
  # @static-object plugin/skills/** plugin/scripts/allowed-tools-plugin-prefix-check.ts plugin/test/allowed-tools-plugin-prefix-check.test.mjs plugin/scripts/checker-mutation-cases/allowed-tools-plugin-prefix-check.sh
  run_checker "allowed-tools-plugin-prefix-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/allowed-tools-plugin-prefix-check.ts" --root "${repo_root}"
  echo "== retired-clause check (gap-ac58-retired-clauses-delete-and-archive, AC58 判据1-3) =="
  # AC58 退役即迁出 enforcement: the registry (the 落点映射) records every retired clause/annotation
  # migrated OUT of the high-frequency files INTO orchestration/archive/AC58-retired-clauses.md#<id>.
  # CHECK-A (判据1): each marker must be ABSENT from its source file (retired body removed — only a
  #   one-line pointer may remain). CHECK-B (判据2, 硬规则⑤): each marker must be PRESENT in the
  #   archive (全部有家). A marker in source-but-not-archive = the 判据3 负控 sample ⇒ RED (exit 1,
  #   set -euo pipefail abort). Mutation case + unit tests carry the negative control.
  # @static-tier change
  # @static-object orchestration/orchestrator-tick-core.md plugin/loop/orchestrator-loop-tick.md plugin/loop/fast-mode-loop-tick.md CLAUDE.md plugin/scripts/integration-batch-merge.sh orchestration/SPEC-branching-model-integration-branch-2026-08-05.md orchestration/archive/AC58-retired-clauses.md plugin/scripts/retired-clause-check.ts plugin/scripts/checker-mutation-cases/retired-clause-check.sh plugin/test/retired-clause-check.test.mjs
  run_checker "retired-clause-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/retired-clause-check.ts" --root "${repo_root}"
  echo "== outer-retirement-precondition check (gap-b0-retirement-precondition-checker-call-surface, SPEC §2.3b B0) =="
  # B0 退役前置 (SPEC §2.3b): 退役 outer 前，枚举 outer 执行核 (orchestrator-tick-core.md) 直接引用的
  # `-check.{ts,sh}` checker，逐个判定留存调用面（static-gate 注册表 / 外部代码引用，传递闭包）。
  # 只被退役层引用（orphan）的 checker 必须带 RETIRED-WITH-RETIRING-LAYER 标记 = 显式退役；无标记 ⇒
  # RED (exit 1, fail-closed) — 退役后静默孤儿被前置挡住。NOT-EVALUATED (exit 3) 当执行核缺失/零引用
  # （独立取值，非通过，硬规则 3b/4）。负控制由 mutation case + 单测钉住。真实仓库当前 N=0
  # （outer-anchor-check.ts 带标记）。whole-store 引用扫描 ⇒ full（scoped 模式推迟到 full-suite 门）。
  # @static-tier full
  run_checker "outer-retirement-precondition-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/outer-retirement-precondition-check.ts" --root "${repo_root}"
  echo "== registry-bare-filename-scan check (tasks/gap-dead-set-registry-bare-filename-scan, SPEC §12f) =="
  # AC156 裸文件名扫描 (SPEC §12f): 注册表/清单载体里以裸文件名登记的脚本（quay-deliver.ts MEMBERS
  #   file: 字段、*.json 清单键/值）是 §12e 闭包漏掉的引用形式。--check 模式判两件：① 真样本 canary
  #   （supervisor-bus-identity.sh 必须被 quay-deliver.ts 以裸文件名引用——证明扫描器载体检测+匹配在
  #   活仓库上没坏）；② 死集一致性（docs/analysis/dead-set-recomputed.json 的 after.dead 不得含任何被
  #   裸文件名引用的脚本）。NOT-EVALUATED (exit 3) 当死集文件缺失/不可解析（独立取值，硬规则 3b）。
  #   负控制由 mutation case + 单测钉住。whole-store 扫描 ⇒ full（scoped 模式推迟到 full-suite 门）。
  # @static-tier full
  run_checker "registry-bare-filename-scan" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/registry-bare-filename-scan.ts" --check --root "${repo_root}"
  echo "== ac61-staleness-disposition check (tasks/gap-ac61-staleness-list-item-disposition, AC61 判据1-3 + DoD 负控制) =="
  # AC61 清单逐条处置 enforcement: the task file's `## AC61 处置记录` section must carry a record for
  # EVERY A-1..A-7 / B-1..B-4 item (迁出带落点映射 或 经核实仍有效+读数). CHECK-A (判据1/DoD 负控):
  # any item missing a record, or a 迁出 record without a landing-point / a 核实 record without a
  # 读数 ⇒ RED. CHECK-B (判据2): the two enforced loop docs' `integration` hits must ALL be classified
  # (one row per hit) — not just counted. CHECK-C (判据3): the inner fast-mode-tick-core C7 live
  # instruction (integration-branch-model.ts --overlaps-unverified) must be GONE from both core copies.
  # Mutation case + unit tests carry the negative control (AC49 判据1 D2 attribution).
  # @static-tier change
  # @static-object tasks/gap-ac61-staleness-list-item-disposition.md plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md plugin/loop/fast-mode-tick-core.md orchestration/fast-mode-tick-core.md orchestration/archive/AC58-retired-clauses.md plugin/scripts/ac61-staleness-disposition-check.ts plugin/scripts/checker-mutation-cases/ac61-staleness-disposition-check.sh plugin/test/ac61-staleness-disposition-check.test.mjs
  run_checker "ac61-staleness-disposition-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/ac61-staleness-disposition-check.ts" --root "${repo_root}"
  echo "== recommended de-order check (tasks/gap-ac56-recommended-deordered, AC56 判据1/判据2/判据3) =="
  # AC56 去锚: the dispatch-facing `recommended` array must NOT carry a meaningful priority order (an
  # inner reading "the mechanism's first pick" gets anchored — SPEC §5). 判据1: a length>1 `recommended`
  # must be lexicographic (dictionary order) AND the output must carry an explicit "order meaningless"
  # annotation (recommended_order / recommended_unordered). 判据2 (falsifiable): a 1/cost-sorted
  # (priority) order is NOT lexicographic ⇒ RED. 判据3 (anti-只改文案): the checker reads the OUTPUT
  # ITSELF — a comment claiming "序无意义" while the array still encodes a priority order fails the
  # lexicographic check. Pinned by plugin/test/ac56-recommended-deordered-check.test.mjs + the mutation
  # case (priority-order ⇒ RED, missing-annotation ⇒ RED).
  # @static-tier change
  # @static-object plugin/scripts/slot-refill.ts plugin/scripts/ac56-recommended-deordered-check.ts plugin/test/ac56-recommended-deordered-check.test.mjs plugin/scripts/checker-mutation-cases/ac56-recommended-deordered-check.sh
  run_checker "ac56-recommended-deordered-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/ac56-recommended-deordered-check.ts" --root "${repo_root}"
  echo "== preference-notification check (tasks/gap-ac57-preference-change-notification, AC57 通知面) =="
  # AC57 义务 (phase-goal 逐字): 倾向变更的通知**不得包含倾向内容本身**，只说「倾向变了，去重读」+ 指纹。
  # 可核载体 (发送侧留痕, 落地方设计 — SPEC §7 不规定): orchestration/preference-notification-log.md —
  # git 可见; 发送者 (manager) 每次 SendMessage 倾向变更通知时把通知的确切文本逐字追加进「## 留痕记录」段。
  # AC57 能取假 (manager 7e7aa61b, AC49 判据1 标准): 拿一条真实的倾向变更通知回放——若它携带了倾向内容本身
  # ⇒ 必须报红 — pinned by plugin/test/preference-notification-check.test.mjs (模板+指纹全绿; 模板+逐字
  # 倾向行负控制全红)。Blocks (exit 1) on: 模板段未记录通知语/指纹占位, 或任一留痕记录泄漏倾向内容, 或
  # 记录指纹不匹配当前倾向文件的 git blob hash — 一条带内容的通知绝不能静默混进 inner 的上下文。
  # @static-tier change
  # @static-object orchestration/preference-notification-log.md orchestration/dispatch-preference.md plugin/scripts/preference-notification-check.ts
  run_checker "preference-notification-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/preference-notification-check.ts" --root "${repo_root}"
  echo "== ac69-slot-queue-gap check (tasks/gap-ac69-suite-slot-full-should-queue-not-wait, AC1 + DoD) =="
  # AC69 先量再改 enforcement: the「槽释放→下次派发差值」measurement record
  # (docs/analysis/ac69-slot-release-vs-dispatch-gap.json) must be LANDED and structurally complete
  # (task/measuredAt/dataSource/method/stats.medianSeconds/conclusion/conclusionReason all present,
  # conclusion ∈ maintain|change) — a task whose AC says「已测」needs a mechanical product (硬规则 9:
  # 可见性 ≠ 执行). Absent/corrupt record ⇒ NOT-EVALUATED (exit 2/3), distinct from 合格 (exit 0) —
  # 硬规则 3b: 读不懂输入不得返回与合格同形的值. The checker validates the COMMITTED record; it does
  # NOT recompute live .quay/ data (gitignored, worktree 副本) — the measurement itself is the
  # documented analysis in the record's dataSource/method. Mutation case + unit tests carry the
  # negative control (delete record / drop conclusion ⇒ RED, restore ⇒ GREEN).
  # @static-tier change
  # @static-object docs/analysis/ac69-slot-release-vs-dispatch-gap.json plugin/scripts/ac69-slot-queue-gap-check.ts plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh plugin/test/ac69-slot-queue-gap-check.test.mjs
  run_checker "ac69-slot-queue-gap-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/ac69-slot-queue-gap-check.ts" --root "${repo_root}"
  echo "== mirror-pair-drift-check (gap-mirror-pair-drift-policy-plugin-scripts-experiments — plugin/scripts/ vs experiments/quay-perpetual-stream/scripts/ 镜像漂移) =="
  # The general mirror-pair drift gate: plugin/scripts/ and experiments/quay-perpetual-stream/scripts/
  # carry 40 real-file copies (21 more same-name entries are experiments→plugin SYMLINKS — single-source
  # references that cannot drift, excluded). The only prior drift checkers were PINNED single-file-pair
  # lists (workflows-dual-copy / suite-bucket); this checker AUTO-DISCOVERS every same-basename
  # REAL-FILE pair and byte-compares them, so a future copy drift (any extension) goes RED without
  # anyone remembering to add the filename to a list (doc §2.2/§2.8 R6/R7). The 12 syncable copies
  # were re-synced (experiments ← plugin, the canonical layer); the 2 structural copies
  # (tree-hygiene-check.sh / worktree-branch-hygiene-check.sh — repo-root resolution is directory-depth
  # -dependent, so byte-identity is the WRONG invariant) are allow-listed with a sha256 signature: a
  # drift whose signature MATCHES the allow-list is ALLOWED (visible, not red), but if either side's
  # sha256 changes the drift EXPANDED ⇒ RED (the exemption is re-checked, never a blind pass). Exit 1 on
  # any unexempted/expanded drift; exit 3 (NOT-EVALUATED) when the experiments mirror dir is absent.
  # @static-tier change
  # @static-object plugin/scripts/ experiments/quay-perpetual-stream/scripts/ plugin/scripts/mirror-pair-drift-check.ts plugin/scripts/mirror-pair-drift-allowlist.json plugin/test/mirror-pair-drift-check.test.mjs
  run_checker "mirror-pair-drift-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/mirror-pair-drift-check.ts" --root "${repo_root}"
  echo "== primitives-drift-check (gap-ac253-session-primitives-shared-layer-adoption — packages/quay/src/primitives/*.mjs vs the pinned quay-fleet blob) =="
  # The four session read/write primitives are a DELIBERATE two-copy arrangement (quay-fleet is the
  # reference; this repo carries the copy its product + scripts consume). Two copies without a
  # mechanical check is the failure mode SPEC §3.3 names ("唯一不可接受的是第二份手写实现"), and the
  # fleet working tree moves — the four files changed on the day the copy was taken. This checker
  # re-reads BOTH sides every run against a pinned SHA + four sha256 values and reports THREE states:
  # exit 0 = consistent; exit 1 = drift (either side, reported per file with both hashes); exit 3 =
  # NOT-EVALUATED when the fleet repo / pinned SHA is unreachable — never conflated with "consistent"
  # (硬规则 3b; run_checker passes exit 3 through as STATIC_CHECK_NOT_EVALUATED, so an unrelated
  # machine without the fleet checkout does not inherit a fabricated red OR a fabricated green).
  # @static-tier change
  # @static-object packages/quay/src/primitives/ plugin/scripts/primitives-drift-check.ts plugin/scripts/primitives-drift-manifest.json plugin/test/primitives-drift-check.test.mjs
  run_checker "primitives-drift-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/primitives-drift-check.ts" --root "${repo_root}"
  echo "== rhythm-consumer-check (gap-ac73 判据1/2/3 — cadence consumer contract gate) =="
  # AC73's own checker — the rhythm column's consumer contract: non-按需 mechanisms must have a
  # call site in test.sh / an execution core (or wired elsewhere, or baselined), 按需 mechanisms
  # must declare WHO presses them under WHAT conditions, and --no-block checkers must declare WHO
  # reads their output and acts. Wired here so it is NOT another zero-caller judge (the disease it
  # cures). Exit 1 on any 判据1/2/3 violation.
  # @static-tier change
  # @static-object plugin/scripts/capability-catalog.sh plugin/scripts/rhythm-consumer-check.ts plugin/test/rhythm-consumer-check.test.mjs scripts/test.sh orchestration/*-tick-core.md plugin/loop/*-tick-core.md
  run_checker "rhythm-consumer-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/rhythm-consumer-check.ts" --check --root "${repo_root}"
  echo "== gitignore runtime-artifact coverage check (gap-quay-init-gitignore-misses-quay-runtime-artifacts-outside-dot-quay) =="
  # The anti-drift binding for the SINGLE SOURCE of quay's runtime-artifact ignore list: the patterns
  # quay MARKS in its own .gitignore (a comment line carrying "@quay-runtime-artifact" directly above
  # the pattern) must equal the patterns of plugin/scripts/quay-runtime-artifacts.txt — the manifest
  # quay-init writes into a consumer project's .gitignore and the fan-in ff reads for its clean-tree
  # judgment. Drift REDs in either direction: marked-but-unabsent ⇒ quay-init would not ignore it in a
  # consumer project (the measured quay-fleet defect: a 55/55-green task whose ff could never land);
  # present-but-unmarked ⇒ an unreferenced rule nobody can trace. An unreadable manifest is
  # NOT-EVALUATED (exit 3) — never conflated with "no drift" (硬规则 3b).
  # @static-tier change
  # @static-object .gitignore plugin/scripts/quay-runtime-artifacts.txt plugin/scripts/gitignore-runtime-coverage-check.ts plugin/test/gitignore-runtime-coverage-check.test.mjs
  run_checker "gitignore-runtime-coverage-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/gitignore-runtime-coverage-check.ts" --root "${repo_root}"
  echo "== test-file-snapshot relative-baseline check (gap-test-file-snapshot-no-production-caller, AC1) =="
  # The 「删测试文件必红」 relative-baseline criterion — a COMMITTED repo-relative baseline
  # (docs/analysis/test-file-baseline.txt) records the canonical test-file set
  # (scripts/test.sh --list-files — the single source of truth); this check asserts current ⊇
  # baseline — ADDITIONS since the baseline are ALLOWED (a concurrent merge adding a test file is
  # the B3-2 scenario gap-global-count-assertions-fragile-relative-baseline cures), a REMOVAL is a
  # REAL regression and red-lights the commit (set -euo pipefail abort). --repo-relative normalizes
  # to repo-root-relative so the SAME committed baseline is portable across worktrees / the main
  # checkout / CI (the canonical --list-files output is absolute realpaths — machine-/worktree-
  # specific, and would read every baseline file as "REMOVED" in any other tree). Baseline refresh
  # on a LEGITIMATE test-file removal:
  #   bash plugin/scripts/test-file-snapshot.sh --repo-relative snapshot docs/analysis/test-file-baseline.txt
  # then commit the updated baseline. Wired here as a code-class 每轮 gate (the zero-wiring disease
  # this task cures: the script existed + was unit-tested but had NO production caller — hard rule
  # 3b's "看起来覆盖了、实际未接线的检查").
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/ experiments/*/test/ scripts/test.sh plugin/scripts/test-file-snapshot.sh
  run_checker "test-file-snapshot-check" bash "${repo_root}/plugin/scripts/test-file-snapshot.sh" --repo-relative check "${repo_root}/docs/analysis/test-file-baseline.txt"
  echo "== quay-init laydown footprint ratchet (gap-quay-init-closure-assertion-first, SPEC AC168 判据先行) =="
  # AC168 判据先行 (SPEC §8 AC3/AC4 — 安装写入闭集): the shrink-only ratchet over the REAL
  # `quay-init --all --loop --manager` laydown footprint (files + bytes). Baseline = the measured
  # current footprint (recorded in the task body; §2.9 measured 142 files / 7.1 MB — the current value
  # is lower after mechanism-layer script retirements). 只许降不许升 — any change that makes quay-init
  # lay ONE MORE file/byte goes RED immediately; the closure shrink (AC168 body) later walks the
  # baseline down to the §6 闭集. The measurement is the PRODUCTION CARRIER: the checker RUNS a real
  # laydown into a fresh temp target (never reads derive_loop_scripts' static derivation, never a
  # fixture — SPEC AC4 反例判据). NOT-EVALUATED (exit 3) when the laydown cannot run (硬规则 3b:
  # 读不懂输入 ≠ 合格). Negative controls (baseline-1 ⇒ RED / baseline+1 ⇒ GREEN) pinned by
  # plugin/test/quay-init-closure-ratchet.test.mjs + checker-mutation-cases/quay-init-closure-ratchet.sh.
  # @static-tier full  (whole-store ratchet — deferred to the full-suite gate in scoped mode)
  run_checker "quay-init-closure-ratchet" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/quay-init-closure-ratchet.ts" --gate --root "${repo_root}"
  echo "== quay-init laydown footprint re-anchor freshness (gap-quay-init-closure-ratchet-manual-reanchor-recurs) =="
  # A change-tier companion to the full-tier byte ratchet above: CHEAP (hashes the laydown SOURCE
  # tree — no real laydown) and detects "a laydown source file changed but the committed baseline
  # was not re-anchored" at the CHANGER's own scoped gate, instead of at an unrelated task's
  # full-suite fan-in (the 8th-recurrence defect this task closes). Exit 1 when the current source
  # fingerprint differs from docs/analysis/quay-init-closure-ratchet.baseline.json (stale — run
  # `node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor`); exit 3
  # (NOT-EVALUATED) when the baseline/set cannot be read. The full-tier ratchet (above) still measures
  # the REAL laydown and still reds on true bloat (negative control — never relaxed into constant-true).
  # Pinned by plugin/test/quay-init-closure-ratchet.test.mjs (stale on a changed source; fresh after
  # re-anchor). Object = the precise laydown source dirs (NOT all of plugin/scripts — ~200 harness
  # scripts there are not laid down; the derived set + wholesale dirs are the fingerprint scope).
  # @static-tier change
  # @static-object plugin/scripts/ plugin/workflows/ plugin/agents/ plugin/probes/ plugin/loop/ plugin/.claude/ orchestration/
  run_checker "quay-init-closure-ratchet-stale" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/quay-init-closure-ratchet.ts" --check-stale --root "${repo_root}"
  echo "== profiles role coverage check (gap-quay-init-profiles-template-omits-every-role-the-drivers-request) =="
  # Every profile role a driver asks for must exist in the carrier a REAL init produces. The
  # assertion object is init's OUTPUT (a temp workspace initialized by the Core CLI), never a
  # template file: the defect this closes was a "fixed" carrier that the init path never used, and
  # its acceptance was green the whole time. The shipped carrier is compared against that output so
  # a one-sided edit to either template goes RED, and a retired role (inner) is a FAIL rather than
  # a remark. No init artifact obtainable ⇒ exit 3 (NOT-EVALUATED), never a green it did not earn.
  # Pinned by plugin/test/profiles-role-coverage-check.test.mjs +
  # plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh (four red controls).
  # @static-tier change
  # @static-object plugin/scripts/quay-init.sh plugin/.quay/profiles.yml packages/quay/src/init.ts
  run_checker "profiles-role-coverage-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/profiles-role-coverage-check.ts" --check --root "${repo_root}"
  echo "== goal-driver task-boundary check (DIR-131, gap-goal-driver-task-boundary-check) =="
  # goal/task 职责边界防回归（DIR-131）：goal-driver.ts 不得出现 task 写路径调用点——task_write /
  # lifecycle_promote / lifecycle_retreat / lifecycle_complete 或指向 tasks/ 的 fs.write*/writeFileSync。
  # 按位置判定（屏蔽注释与字符串字面量，硬规则 2）；负控制由单测 + mutation case 钉住（硬规则 3b/4）。
  # 单文件（goal-driver.ts）判定 ⇒ change（scoped 模式在 task Touches 命中 goal-driver.ts 时运行）。
  # @static-tier change
  # @static-object plugin/scripts/goal-driver.ts plugin/scripts/goal-driver-task-boundary-check.ts plugin/test/goal-driver-task-boundary-check.test.mjs plugin/scripts/checker-mutation-cases/goal-driver-task-boundary-check.sh
  run_checker "goal-driver-task-boundary-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/goal-driver-task-boundary-check.ts" --root "${repo_root}"
  echo "== kernel-sibling-resolution check (GOAL-012 A 域, gap-ac224-kernel-sibling-resolution-check-mutation-covered) =="
  # KERNEL 域 naive sibling 解析检查器：shipped kernel 把自己的 sibling 脚本锚在 naive `__dirname` /
  # target root / 模板字符串而非经 resolveKernelSibling/resolveKernelPluginRoot 即违规（AC-203 前例）。
  # Whole-store 扫描（plugin/scripts + packages/quay/src），DEV-TREE-ONLY 豁免标记带理由可复核。
  # ⛔ 落在 full（不 scoped）——全店枚举，不随单任务 Touches 收窄。
  # Fail-closed（不带 --no-block）：AC-225 迁移已归零（实测 --root . --json ⇒ violations: [] / total: 0），
  #   枚举归零这一半由此重新有强制力——新落一处 naive __dirname / 跨包源码锚点即红，与 B 域
  #   target-identity-literal-check（:252，fail-closed）对称。负控制由 scoped-static-checks.test.mjs 的
  #   注册行断言（不得带 --no-block）+ 注入即红干跑钉住（硬规则 3/4）。
  # @static-tier full
  run_checker "kernel-sibling-resolution-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/kernel-sibling-resolution-check.ts" --root "${repo_root}" --json
  echo "== config-key-consumer check (GOAL-015 退出条件③ / AC-235, gap-config-key-consumer-check-mechanical-enumeration) =="
  # 交付配置键消费者枚举：quay-init 写入下游 .quay/config.yml loop: 的每个键都必须有代码消费者
  # （零消费者的键已接线或已删）。writer 面机械派生自 quay-init.sh（heredoc + python 升级写手），
  # consumer 面机械 grep（plugin/scripts/*.ts + packages/quay/src/*.ts，排除测试与自身）——与 AC-235
  # 判据同一口径。三态可区分（has-consumer / no-consumer-to-wire / documented-with-reason），豁免必须
  # 带理由文本（GOAL-015 风险 3，⛔ 不是无理由 allowlist）。no-consumer-to-wire > 0 ⇒ exit 1。
  # ⛔ 落在 full（不 scoped）——全店枚举，不随单任务 Touches 收窄。负控制由 mutation case 注入孤儿键即
  # 红钉住（硬规则 3/4）。
  # @static-tier full
  run_checker "config-key-consumer-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/config-key-consumer-check.ts" --root "${repo_root}"
  echo "== provider-binding resolvability check (gap-pre-fix-upgraded-project-unresolvable-binding-undetected) =="
  # 项目的 provider 绑定能否【不借助外部 $PATH 辅助】解析出自己的 runtime？升级到 ba960f503 之前的
  # 项目停在 mcp_entry: [quay-native, mcp] 裸名形态上——裸名只能由 OS $PATH（或 cwd）查找满足 ⇒ 该
  # 项目能不能读自己的任务板取决于「跑它的那台机器恰好有什么」，而没有任何检查会报出来（实测两个
  # 现场：orangevps /home/yale/quay-verify-upgrade-{9eda8c70,1c202737}-root，`spawn quay-native ENOENT`）。
  # ⚠️ 判据【按形态】而非「在本机解析得开」——packages/quay/src/config-validate.ts:648 的 isPathBinary 正是
  # 这个盲点的产品形态（token 在本进程 $PATH 上解析得开就报合格）。故本检查【刻意不查 $PATH】：裸名恒红，
  # 与「恰好解析得开」无关；相对 token 按产品自己的口径对 provider.path 解析（cli/shared.ts:175，⛔ 不是对
  # workspace root —— 否则本仓库自己的 ./bin/quay-native.ts 会被误报）。三态可区分：path-resolved（合格）/
  # bare-path-name·dangling-*（红）/ no-mcp-entry·unrecognized-shape（NOT-EVALUATED，⛔ 不与合格同形）。
  # 负控制由 mutation case（含 $PATH shim 反例：裸名 + shim 仍须红）钉住（硬规则 3/4）。
  # ⚠️ `.quay/config.yml` 是 gitignored（.gitignore 的 `/.quay/config.yml`）⇒ 它【永远不会】出现在 scoped
  # 门的 delta 里。故除判据对象本身外，把本检查自己的实现/负控制/单测一并列进 @static-object——这样
  # 「改这个检查器」才会让 scoped 门选中它（与 per-task-suite-record-check / release-freshness-check 同形）。
  # ⛔ 未列入则本检查在 scoped 门恒被 defer（只在 full 门跑）——不是漏跑，但反馈慢一整轮。
  # 登记 `.quay/config.yml` 的副作用（isDocPath 先查注册表再查 DOC_SURFACES ⇒ 该路径由 doc 变 code）是
  # 设计使然、非缺陷，与 docs/analysis/ac69-slot-release-vs-dispatch-gap.json 在 docs/ 面下同为 code 同类；
  # plugin/test/fan-in-execute-paths.test.mjs 的 doc-delta fixture 已随之改用一个真正 doc-only 的 .quay/ 采样路径。
  # @static-tier change
  # @static-object .quay/config.yml plugin/scripts/provider-binding-resolvability-check.ts plugin/scripts/checker-mutation-cases/provider-binding-resolvability-check.sh plugin/test/provider-binding-resolvability-check.test.mjs
  run_checker "provider-binding-resolvability-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/provider-binding-resolvability-check.ts" --root "${repo_root}"
  echo "== host-repo-surface ratchet (GOAL-015 退出条件④ / AC-236, gap-host-repo-surface-ratchet) =="
  # 本仓库表层单调棘轮：CLI 动词集（quay.ts --help 真实输出，⛔ 不读源码字面量——同时证明入口本身跑得起来）、
  # web 路由集（serve-handlers.ts + serve.ts 的 url.pathname === "…" 位置命中）、有消费者的配置键集
  # （config-key-consumer-check.ts --json 的 has-consumer，复用既有机件）三者逐一与已提交基线比对，
  # 基线 ⊆ 当前才 exit 0——新增允许、删除/改名转红。⛔ 守的是 AC-233 修法会删掉 packages/quay/bin/quay.ts
  # 这个本仓库自己的开发入口（CLAUDE.md Commands 段记的正本），删文件不产生失败断言（硬规则 3b）。
  # 三态可区分：基线缺失 ⇒ exit 1（任务没做完）；源文件读不到 / 入口 spawn 失败 ⇒ exit 3 NOT-EVALUATED
  # （stderr，硬规则 3b）。⛔ 落在 full（不 scoped）——全店枚举，不随单任务 Touches 收窄。负控制由
  # mutation case 注入缩水即红钉住（硬规则 3/4）。
  # @static-tier full
  run_checker "host-repo-surface-ratchet" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/host-repo-surface-ratchet.ts" --root "${repo_root}"
  echo "== criterion failure attribution check (GOAL-009 AC-241, gap-goal-criteria-bare-failing-exit-unattributable) =="
  # 判据失败出口的可归因性棘轮：机械枚举 goals/AC-*.md 中 status ∈ {active, achieved}（I5 复验域，
  # achieved 的 AC 转红同样写台账）且有 criterion 的记录，逐行报出「失败退出不写成因」的条数——
  # 失败退出 = 非注释行的 exit 1 / sys.exit(1)（含 sys.exit(1 if x else 0)）；不写成因 = 同一行无
  # stderr / >&2 / console.error。⛔ 注释里的提及不算命中（硬规则 2，按位置判定）；字符串【不】屏蔽
  # （shell 判据里 bash -c "exit 1" 真的会 exit 1，屏蔽字符串会制造假阴性）。
  # 基线锚在 --capture 实测值（docs/analysis/criterion-failure-attribution.baseline.json），只许降不许升
  # ——修好一条即降，判据新增/修改出裸失败退出即升 ⇒ 红。⛔ 不以归零为目标（硬规则 12：别用未测量的
  # 残差挡住可达目标）。三态可区分：基线缺失/读不懂 goals/ ⇒ exit 3 NOT-EVALUATED（硬规则 3b）。
  # 负控制由 mutation case 注入一条裸失败退出即红钉住（硬规则 3/4）。
  # ⛔ `goals/` 刻意【不】登记为 @static-object：本检查器确实读 goals/，但登记一个目录 glob 会命中
  # goals/ 下的每条路径，而 `isDocPath` 的注册表覆盖【先于】DOC_SURFACES 生效 ⇒ 整个 goals/ 面由
  # doc 翻成 CODE（实测：plugin/test/fan-in-execute-paths.test.mjs 的「① REAL doc delta」红，
  # `pure-doc delta must produce empty code_delta, got: "goals/AC-999-fake.md"`）。DOC_SURFACES 里的
  # `goals/` 是另一个任务（gap-doc-surfaces-missing-goals-prefix）钉过的结论，那条优先。代价诚实记下：
  # **只改 goals/ 的分支 code_delta 为空 ⇒ 跳过全量 suite ⇒ 本检查器那一轮不跑**；覆盖来自
  # ①本检查器自身文件（脚本/基线/mutation case/单测）被触碰时的 scoped 子集，②任何一次真正跑起来的全量
  # suite（run_static_checks 里本行无条件执行）。⛔ 不要为了补这个洞把目录 glob 加回来。
  # @static-tier change
  # @static-object plugin/scripts/criterion-failure-attribution-check.ts docs/analysis/criterion-failure-attribution.baseline.json plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh plugin/test/criterion-failure-attribution-check.test.mjs
  run_checker "criterion-failure-attribution-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/criterion-failure-attribution-check.ts" --root "${repo_root}"
  echo "== enum surface parity check (ADR-036, gap-enum-surfaces-hand-copied-across-cli-web-docs) =="
  # 同一件枚举事实在多处表层（实现常量 / CLI 帮助 / Web 控制面 / MCP 工具描述 / 项目文档）的副本必须
  # 一致 —— 此前【无人守】，实测 driver kind 一个事实有 7 处副本、4 种取值，GOAL_STATUSES 与
  # VALID_GOAL_STATUSES 取值已经不同。检查器持显式登记表做两向差集（exact / subset+代码处豁免注释），
  # 并识别「派生化」表层（规范 2 的更强形态）。三态：0 PASS / 1 RED（未豁免违规或台账【增长】）/
  # 3 NOT-EVALUATED（权威或面读不出 —— ⛔ 不与「一致」共用输出，硬规则 3b）。已知漂移用 shrink-only
  # 台账报出而不阻断（范围边界：文档面与 driver 帮助的存量归位由别的任务承接）。
  # ⛔ @static-object 刻意【不】登记 CLAUDE.md / plugin/skills/**：它们是 DOC_SURFACES 路径，登记会让
  # isDocPath 把它们由 doc 翻成 CODE，打红别的测试（同 criterion-failure-attribution-check 上方的实证坑）。
  # 诚实记下覆盖代价：只改那两个文档面的 delta 会让本检查器在 scoped 轮缺席；覆盖来自
  # ①本检查器自身文件被触碰时的 scoped 子集，②任何一次真正跑起来的全量 suite（本行无条件执行）。
  # @static-tier change
  # @static-object plugin/scripts/enum-surface-parity-check.ts plugin/scripts/checker-mutation-cases/enum-surface-parity-check.sh plugin/test/enum-surface-parity-check.test.mjs plugin/scripts/driver-runtime.ts plugin/scripts/driver-config.ts plugin/scripts/start-drivers.ts plugin/scripts/task-status.ts packages/quay/src/abi.ts packages/quay/src/goal-store.ts packages/quay/src/serve-sessions.ts packages/quay/src/cli/driver.ts packages/quay/src/cli/help.ts packages/quay/src/serve-goal.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts packages/quay/src/mcp-handlers.ts packages/quay-native/src/mcp-server.ts
  run_checker "enum-surface-parity-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/enum-surface-parity-check.ts" --root "${repo_root}"
  # ── PROMOTED BACK FROM THE OPERATIONAL TIER: the two CORRECTNESS checkers whose default
  # reachability was ZERO (tasks/gap-correctness-checkers-opt-in-not-default-suite-member) ─────────
  #
  # WHY THESE TWO ARE NOT IN run_operational_checks ANY MORE (the promotion's whole argument): the
  # 2026-09-02 passive-machine ruling MOVED the runtime-state checkers out of this function so a
  # passive checkout (CI / dev / replica / fresh worktree) goes green on CODE ALONE. That rationale
  # is a property of the CARRIER each checker reads, and it does NOT hold for these two — both are
  # VACUOUS-SAFE on an absent runtime state BY THEIR OWN DESIGN, so adding them back cannot redden a
  # passive machine (MEASURED, not asserted — both were run against a bare empty git repo):
  #   · dispatch-record-fingerprint-reason-check → absent orchestration/dispatch-record.jsonl =
  #     "no dispatches recorded, nothing to verify" ⇒ EXIT 0 (a green, not a NOT-EVALUATED).
  #   · direct-to-develop-bypass-check → no `develop` ref / no reflog ⇒ rev-list-unreadable ⇒ EXIT 3
  #     NOT-EVALUATED, and run_checker/run_checker_parallel_wait both treat exit 3 as a THIRD state
  #     (STATIC_CHECK_NOT_EVALUATED line, never fail-closed) — so it cannot red a passive machine.
  # Meanwhile the SAME two checkers are exactly the ones whose absence let real defects through:
  #   · dispatch-record.ts is fail-closed on a missing/thin REASON but only WARNS on an uncomputable
  #     FINGERPRINT (:157/:164-168) ⇒ an empty-fingerprint record CAN land on disk; this checker is
  #     the ONLY post-hoc detector for that shape.
  #   · direct-to-develop-bypass-check is the ONLY detector for a direct develop commit that bypasses
  #     fan-in's ff-lock / anti-drift-touches / AC-completion gates (11b / C17 write-ownership).
  # Leaving both opt-in made them "existing but never run" — the mirror of 硬规则 3b (a checker that
  # never executes is, in the record, indistinguishable from one that always passes).
  #
  # CORROBORATION — the capability catalog already declared this home. capability-catalog.sh's 谁按
  # table said of direct-to-develop-bypass-check.ts: "谁按：run_static_checks 每轮自动按（code-class
  # gate）", and the cadence table declared BOTH checkers "每轮". Those claims were FALSE for as long as
  # the two sat in the opt-in tier — the declared consumer and the actual registration disagreed, and
  # nothing checked it (the drift class tasks/gap-checker-claim-vs-actual-cadence-and-count-drift
  # owns). This move repairs the drift by making the wiring match the declaration, rather than by
  # weakening the declaration to match a checker nobody ran. It also fixes the catalog's other reading:
  # capability-catalog.sh's 消费方 note for direct-to-develop-bypass-check.ts described consumers
  # reading a run_static_checks output that never existed.
  #
  # 硬规则 4 (an unrun check is not a measurement): the two mutation cases already existed and already
  # ran here (checker-mutation-check, --check + --check-changed above) — but a mutation case exercises
  # the checker against a FIXTURE, so it only ever proved the LOGIC can go red. It never once ran the
  # checkers against PRODUCTION state. This wiring is the missing half: the same checkers now judge
  # the REAL carriers on every full-suite invocation (⇒ every fan-in), not a temp repo.
  echo "== dispatch-record fingerprint+reason check — PRODUCTION carrier (AC55 判据1/判据3) =="
  # @static-tier change
  # @static-object orchestration/dispatch-record.jsonl orchestration/dispatch-preference.md plugin/scripts/dispatch-record.ts plugin/scripts/dispatch-record-fingerprint-reason-check.ts plugin/test/dispatch-record-fingerprint-reason-check.test.mjs
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): orchestration/dispatch-record.jsonl
  # is MAIN-checkout gitignored runtime state, absent from the one-shot verify worktree. Pointing --root at
  # the main checkout makes a worktree round read the SAME carrier a main run reads ⇒ the check is NOT
  # vacuous exactly in the fan-in path that matters (verdicts identical; on a main run main_root ==
  # repo_root ⇒ unchanged). Same pattern as the other runtime-carrier readers below.
  run_checker "dispatch-record-fingerprint-reason-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/dispatch-record-fingerprint-reason-check.ts" --root "${main_root}"
  echo "== direct-to-develop-bypass-check — PRODUCTION develop (11b/C17 越权直改面) =="
  # @static-tier change
  # @static-object plugin/scripts/direct-to-develop-bypass-check.ts plugin/test/direct-to-develop-bypass-check.test.mjs
  # --root main_root: develop reflog + lock events are MAIN-checkout state, absent from the one-shot
  # verify worktree (same reason as above).
  # ⛔ --baseline MUST STAY INSIDE THE DEVELOP REFLOG HORIZON. This was the wiring's real defect when
  # this promotion was made: it passed a FIXED enforcement-boundary sha (b11ce720…) that develop had
  # since run 5147 first-parent commits past, while the develop reflog only reaches back 4692 — so 455
  # spine commits fell outside any reflog bracket, `unclassifiable-commits-in-range` fired
  # UNCONDITIONALLY, and the checker answered exit 3 NOT-EVALUATED on the ACTIVE host FOREVER (measured
  # 2026-09-13). That is why the promotion alone was not enough: wiring a permanently-NOT-EVALUATED
  # checker is the same defect class this task exists to cure (a line in every suite log that looks
  # like a verdict and never is one). `develop~100` is the window this checker's own design and the
  # GOAL AC-194 validation use (header: "develop~100 窗 unclassifiable 归零、AC-194 expect: exit 0
  # 可达"; goals/AC-194-no-direct-to-develop-bypass.md gates with --baseline develop~100 ⇒ verdict
  # pass). Before this fix the GATE and the GUARANTEE read the SAME invariant through two different
  # windows and disagreed: AC-194 = pass, gate = NOT-EVALUATED. The gate now measures what the
  # guarantee measures. A fixed sha is a literal whose validity depends on how far develop has run
  # since — 硬规则 4 推论二 (read the host, don't freeze a value that silently expires).
  run_checker "direct-to-develop-bypass-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/direct-to-develop-bypass-check.ts" --root "${main_root}" --baseline develop~100 --json
  echo "== checker-count-drift-check — each registry's declared count vs its measured run_checker entries =="
  # @static-tier change
  # @static-object plugin/scripts/runner-static-gate.ts scripts/test.sh plugin/scripts/checker-count-drift-check.ts plugin/scripts/checker-mutation-cases/checker-count-drift-check.sh plugin/test/checker-count-drift-check.test.mjs
  # This checker is the one that would have caught THIS file's own header claiming 35 checkers while
  # the body held 58 (tasks/gap-checker-claim-vs-actual-cadence-and-count-drift). It reads the
  # `# @checker-count <N>` annotation on each registry function and counts that function body's
  # run_checker entries — declared≠measured ⇒ exit 1; annotation/function unreadable ⇒ exit 3
  # (NOT-EVALUATED, never silently PASS; 硬规则 3b).
  run_checker "checker-count-drift-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/checker-count-drift-check.ts" --root "${repo_root}"
  echo "== gate-event-coverage-check — 每日「落地 ⇒ complete GateEvent」覆盖率（PRODUCTION carrier） =="
  # @static-tier change
  # @static-object plugin/scripts/gate-event-coverage-check.ts plugin/scripts/checker-mutation-cases/gate-event-coverage-check.sh plugin/test/gate-event-coverage-check.test.mjs plugin/workflows/fan-in-execute.js plugin/scripts/worker-driver.ts
  # --root main_root + --days 1: BOTH are load-bearing, not defaults (gap-complete-gateevent-coverage-
  # has-a-residual-gap AC4).
  #   --root main_root —— 载体 <root>/.quay/gate-events.jsonl 是 MAIN-checkout 的 gitignored 运行时状态，
  #     一次性 verify worktree 里**不存在**。指向 repo_root 会让它在每个 worktree 轮里恒定 exit 3
  #     NOT-EVALUATED —— 那正是上面 direct-to-develop-bypass-check 注释点名的缺陷类：「一个永远
  #     NOT-EVALUATED 的检查器与一个恒绿的检查器在记录上同形」（硬规则 3b/9）。指向 main_root ⇒ 读到
  #     的是生产那一份，判据**能取假**。
  #   --days 1 —— AC4 的字面读法是**当日**覆盖率。窗口 3 天会把某一天的漏记变成持续 3 天的红、挡住
  #     无关任务的 fan-in（本仓已记过这类「成本落在无关任务头上」的缺陷）；1 天把影响面限制在次日。
  #   无载体 / 零落地 ⇒ exit 3（run_checker 认第三态，不 fail-closed 不 abort 套件）。
  run_checker "gate-event-coverage-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/gate-event-coverage-check.ts" --root "${main_root}" --days 1 --gate
  echo "== release-glob MCP-client close check (gap-release-run-tests-hangs-on-shared-mcp-client-leak, GOAL-020 AC-266) =="
  # The release job's `Run tests` step runs a hand-scoped glob with NO GH_TOKEN. A test file in that
  # glob that closes its `quay mcp` client on the happy path only leaks the child on any throwing
  # block, and `node --test` then never exits — measured in the release channel as 30m21s / 30m17s
  # against `timeout-minutes: 30`, i.e. the gate degraded from "reports red" to "reports nothing".
  # Code-class, not operational: it reads ONLY checked-in files (the workflow + the glob's test
  # files), no live loop state — so it belongs here, not in run_operational_checks.
  # The object is the RELEASE surface itself: the glob is DERIVED from release.yml's `Run tests` step
  # (never hardcoded), and the predicate is per-binding (`const { client: X } = await connectStdio(…)`
  # must have X.close() inside a `finally`), position-based with `//` comments stripped.
  # 0 = every binding closed on the throwing path; 1 = a leak, named by file:line; 3 = NOT-EVALUATED
  # for an unreadable workflow / step / zero-file glob / zero bindings — never 0 (硬规则 3b:
  # "nothing was checked" must not render as "all clients are closed"). The non-destructuring
  # bindings it deliberately does NOT judge are printed as a count on every run.
  # @static-tier change
  # @static-object .github/workflows/release.yml packages/quay/test/ packages/quay-native/test/ plugin/scripts/release-test-client-close-check.ts plugin/scripts/checker-mutation-cases/release-test-client-close-check.sh
  # --root repo_root, NOT main_root: every input is a CHECKED-IN file (the workflow + the glob's test
  # files), so the verdict must be about the tree under test. Pointing it at main_root would make the
  # fan-in/verify worktree judge the MAIN checkout's copy instead — measured 2026-09-15: the first
  # wiring used main_root and this very check went RED inside its own task's worktree, because the
  # main checkout (branch `author`) had not yet received the fix the worktree was carrying.
  run_checker "release-test-client-close-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/release-test-client-close-check.ts" --root "${repo_root}"
  # gap-first-green-release-and-master-ff (GOAL-020 AC-274, SPEC §6.1 invariant 3): `advance-master`
  # is the ONE job allowed to move `master`, and its `needs:` list is the only thing that keeps that
  # from happening on a half-green release — GitHub skips a job whose dependency did not succeed, so
  # fail-closed is default behaviour rather than code. But the list is written by HAND, and §6.1 names
  # the rot exactly: add a 7th job to release.yml, forget it here, and master advances on a release
  # that was never fully green. §6.1 requires this assertion in the SAME batch as the job.
  # Code-class, not operational: it reads ONLY the checked-in workflow (no live loop state, no git
  # history), so it belongs here rather than in run_operational_checks. The job key set is DERIVED
  # from the file on every run — nothing is hardcoded, because a hardcoded list of the six names would
  # be a copy that drifts from the thing it copies, i.e. this checker's own defect.
  # 0 = needs covers every other job; 1 = a job is missing (named); 3 = NOT-EVALUATED for an absent
  # workflow / unreadable `jobs:` / zero jobs / no advance-master job / an unreadable `needs:` value —
  # never 0 (硬规则 3b). ⛔ An ABSENT `needs:` is a FAIL, not a NOT-EVALUATED: a job with no
  # dependencies moves master on ANY release run, which is readable and is the worst reading.
  # --root repo_root, NOT main_root, for the same reason as the checker above: the only input is a
  # CHECKED-IN file, so the verdict must be about the tree under test (this task's own worktree
  # carries the job before the main checkout does).
  # @static-tier change
  # @static-object .github/workflows/release.yml plugin/scripts/release-master-advance-needs-check.ts plugin/scripts/checker-mutation-cases/release-master-advance-needs-check.sh
  run_checker "release-master-advance-needs-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/release-master-advance-needs-check.ts" --root "${repo_root}"
  # Wait for all parallelized checkers and fail closed if any failed (see the RUN_CHECKER_PARALLEL
  # note at the top of this function — AC3 failure visibility, AC4 cost-ledger completeness).
  run_checker_parallel_wait
}
# run_operational_checks — the OPERATIONAL-CLASS (runtime-state) checker registry: the checks
# that read the autonomous loop's LIVE runtime state (tick telemetry, runtime ledgers, live
# dispatched task worktrees, develop reflog, SDK-materialized workflow records). They have NO
# meaning on a machine where the loop is not running — a passive checkout (CI / dev / replica /
# fresh worktree) must go green on code alone. MOVED OUT of run_static_checks under the 2026-09-02
# passive-machine ruling (执行 suite 测试不应依赖本项目运行态 — manager/outer/inner/driver 全算): home is
# the explicit opt-in `scripts/test.sh --static-checks-operational` on the ACTIVE host, NOT the
# full-suite gate. NOT re-wired into any automatic cadence (outer retiring; drift of these checks
# accepted). They REMAIN in the mutation manifest (checker-mutation-check.sh parses
# run_operational_checks) so the L_S instrument is not weakened — same shape as the DOC-class split
# under AC51.
  # ⛔ PROMOTED OUT (2026-09-13, tasks/gap-correctness-checkers-opt-in-not-default-suite-member):
  # dispatch-record-fingerprint-reason-check and direct-to-develop-bypass-check used to live here and
  # have MOVED INTO run_static_checks() (see the promotion block at the end of that function for the
  # full argument). They satisfy the L_S instrument just as well from there (checker-mutation-check.sh
  # parses BOTH functions, so their mutation cases were never in question) — what the move restores is
  # PRODUCTION reachability, which is the one thing this tier could not provide: an opt-in tier with no
  # automatic caller is "existing but never run", indistinguishable in the record from always-passing.
# @checker-count 11 — the number of run_checker entries in the FUNCTION BELOW (counted by
# plugin/scripts/checker-count-drift-check.ts; same contract as the annotation on run_static_checks).
run_operational_checks() {
  RUN_CHECKER_PARALLEL=1
  echo "== operational-class static checks (explicit opt-in — scripts/test.sh --static-checks-operational; NOT part of the full-suite gate) =="
  echo "== worktree node_modules readiness (gap-worktree-node-modules-inconsistent-self-verify) =="
  # Mechanized invariant "every dispatched task worktree can self-verify": a task worktree whose
  # node_modules is absent fails closed at the build phase (Cannot find package esbuild) and its
  # verification silently falls back to the shared checkout where mutations land — the exact
  # inconsistency this gap task closes. REPORT-ONLY (exit 0) by default: a peer task's worktree
  # mid-setup is a transient state, so a hard-fail here would red the suite for the wrong reason;
  # the "missing ⇒ report" output makes the invariant observable on every full-suite run. --fail
  # (manual) flips it to fail-closed. dispatch-worktree-setup.sh is the mechanism that prevents
  # the missing state; this checker makes the prevention observable.
  # @static-tier full  (whole-store observability — deferred to the full-suite gate in scoped mode)
  # @static-class operational
  run_checker "worktree-node-modules-check" bash "${repo_root}/plugin/scripts/worktree-node-modules-check.sh" --root "${repo_root}"
  echo "== outer tick-log no-action evidence check (gap-no-action-requires-evidence-mechanical-check, manager 2026-08-09) =="
  # The outer's `no-action` verdict must CARRY the five-inequality evidence (B13), re-measured by the
  # checker itself (never trusts the line's numbers). Wired per its own 约束② ("必须接 run_static_checks
  # 不依赖会话意志") — built 2026-08-09, never wired until 2026-08-13. 2026-08-13 manager cut:
  # step-1 anchor follows the REAL tick-log bullet form (`- \`HH:MMZ\``, not ###); the five-inequality
  # EVIDENCE fields are structured (step 2, queued after AC47) — so this step-1 wiring finds the recent
  # tick section and self-checks it, but does NOT yet enforce the structured evidence rows.
  # @static-tier change
  # @static-class operational
  run_checker "outer-tick-log-check" bash "${repo_root}/plugin/scripts/outer-tick-log-check.sh" --root "${repo_root}"
  echo "== suite-bucket static-vs-truth drift check (gap-suite-bucket-dynamic-truth-drift-detector, ③-AC1/③-AC2) =="
  # 桶归因静态闭包是代理——变量 path.join 构造的 subject 对静态不可见 (worktree-root-fs-check 静态归 S、
  # 运行时触达 plugin/scripts/quay-init.sh 归 M)。本检查把「漏选」变响: 静态非空且动态真值触达静态未覆盖
  # 的桶 ⇒ RED (static-vs-truth-drift)。动态真值来自 trace 缓存 (.quay/suite-fs-trace.jsonl, suite-fs-trace.ts
  # 采集); 缓存缺失 ⇒ NOT-EVALUATED (exit 0 但可区分输出, 硬规则 3b——永不与「0 drift」同形)。每条能取假
  # (mutation case: 静态 S + 动态 M 必红; 恢复必绿)。
  # @static-tier change
  # @static-class operational
  # @static-object plugin/scripts/ plugin/test/ scripts/test.sh
  run_checker "suite-bucket-drift-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/suite-bucket-drift-check.ts" --gate --root "${repo_root}"
  echo "== obligation-ledger check (gap-obligation-ledger-mechanization, AC2-AC5 top-level audit) =="
  # The obligation-ledger integrity audit — the top-level audit the known weakness demands ("台账由
  # 本层写、上层审；顶层审计 = 人 + 接进套件静态检查的机械核对"). Mechanically verifies on the
  # checked ledger: (1) obligation_set_derived=1 — every obligation id equals the deterministic
  # derivation of its generator key (a hand-written id is the "作者写义务集" shape); (2) band — age
  # is monotonic across consecutive live rounds (never drops, never jumps); (3)
  # round_cannot_close_with_undischarged=1 — a round recorded canClose:true while a live+undischarged
  # obligation exists is the 强行闭轮 shape and red-lights the commit. Fail-open on an ABSENT ledger
  # (mechanism not yet adopted); fail-closed on a present one.
  # @static-tier change
  # @static-class operational
  # @static-object plugin/scripts/obligation-ledger.ts plugin/scripts/obligation-ledger-check.ts plugin/scripts/obligation-discharge-agent.ts plugin/test/obligation-ledger.test.mjs plugin/test/obligation-ledger-check.test.mjs
  run_checker "obligation-ledger-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/obligation-ledger-check.ts" --root "${repo_root}"
  echo "== fan-in-workflow-retirement check (gap-fan-in-workflow-retirement-guard, L3 退役防回归) =="
  # fan-in-execute.js workflow 退役防回归：①双副本路径不存在 + 引用面归零（归档白名单除外）——
  # 双副本仍在 ⇒ NOT-EVALUATED (exit 3，P3 未删，才可判)；删净后引用未清零 ⇒ RED (exit 1)。②lock-events
  # 非 wk-prod- 前缀 acquire 计数=0（窗口从 L1 落地起）——出现即 RED (exit 3 是文件缺失，非通过)。
  # 负控制由单测钉住。whole-store 引用扫描 ⇒ full（scoped 模式推迟到 full-suite 门）。
  # @static-tier full
  # @static-class operational
  run_checker "fan-in-workflow-retirement-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/fan-in-workflow-retirement-check.ts" --root "${repo_root}"
  # ⛔ MOVED to run_static_checks() (2026-09-13, tasks/gap-correctness-checkers-opt-in-not-default-
  # suite-member): "dispatch-record fingerprint+reason check" now runs on the default full-suite gate.
  # The AC55 判据1/判据3 rationale (a REAL record missing fingerprint OR reason MUST go RED; the writer
  # is fail-closed on a thin reason but only WARNS on an uncomputable fingerprint) is preserved VERBATIM
  # at its new home — read it there, not here (single source; a copy here would drift).
  echo "== per-task-suite-record check (tasks/gap-ac72-cert-mechanism-retire, AC72 判据2/判据3) =="
  # AC72 判据2: every per-task FULL-suite run must land ONE third-party-readable record
  # (taskId/runId/state/laneCount/durationMs/failed-files/起止时刻) in the SHARED checkout's
  # .quay/per-task-suite-records.jsonl — NOT the worktree's fork-inherited full-suite-state copy.
  # 判据2 shape: a record that EXISTS but is malformed/partial ⇒ RED (硬规则 3b: 读不懂 ≠ 合格); absent
  # file ⇒ NOT-EVALUATED (nothing recorded yet — never conflated with green). 判据3 能取假: the AC57 7
  # real cert rounds replayed against the (empty) record set must go RED — pinned by
  # plugin/test/per-task-suite-record-check.test.mjs (real-sample replay + malformed-shape negative
  # controls). Default live run = shape check only; --replay-real-samples is the explicit audit.
  # @static-tier change
  # @static-class operational
  # @static-object .quay/per-task-suite-records.jsonl plugin/scripts/per-task-suite-record.ts plugin/scripts/per-task-suite-record-check.ts
  run_checker "per-task-suite-record-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/per-task-suite-record-check.ts" --root "${repo_root}"
  echo "== fan-in-ff-protocol-check (AC62 判据2/判据3 — zero-wiring family, gap-ac73) =="
  # AC62's protocol checker was delivered with ZERO callers (test.sh=0, tick-cores=0) while the
  # catalog declared it 「按需」 — for a protocol checker 「按需」==「从不」, nobody runs it at the
  # moment of violation, so 判据2 (non-ff fan-in merge on develop) was structurally unable to go red
  # (gap-ac73-catalog-rhythm-consumer-check). Wired here as a code-class 每轮 gate: it scans
  # <baseline>..<develop> for non-ff fan-in merges, checks the lock-hold intervals never overlap a
  # suite run, and validates ff-retry-record shape. Baseline advanced 2026-08-16 09:2xZ to 19fea6f0
  # (develop HEAD then) — the A15 ④ execute-suite-fix workflow's sanctioned non-ff fan-in merge
  # 679ac913 + the AC85/90/93 + drift fan-in merges since cd4f49b4 are all legitimate (verified: 127
  # merges in range are fan-in/resolve subjects, no bypasses); a NEW non-ff fan-in merge AFTER
  # 19fea6f0 is RED (AC62 判据2 mechanically checkable). Prior baseline cd4f49b4 was the develop HEAD
  # at enforcement (gap-ac73); the 7 pre-adoption non-ff fan-ins are documented debt (AC64/AC68/…).
  # @static-tier change
  # @static-class operational
  # @static-object orchestration/SPEC-fan-in-ff-merge-lock-2026-08-14.md plugin/scripts/fan-in-ff-protocol-check.ts plugin/scripts/fan-in-ff-merge.sh plugin/test/fan-in-ff-protocol-check.test.mjs
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): the lock-events/suite-state/
  # retry-record carriers it reads are MAIN-checkout gitignored runtime state, absent from the one-shot
  # verify worktree. Pointing --root at the main checkout makes the worktree round read the SAME data
  # as a main run ⇒ verdicts identical (AC3); on a main run main_root == repo_root ⇒ unchanged (AC2).
  run_checker "fan-in-ff-protocol-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/fan-in-ff-protocol-check.ts" --root "${main_root}" --baseline 19fea6f0 --json
  echo "== fan-in-materialize-check (gap-workflow-scriptpath-materialize-falls-back-main — workflow scriptPath 静默回退主检出版) =="
  # Detects the M176-family materialization fallback: a bootstrap-HIT fan-in dispatched with
  # scriptPath=<worktree>/plugin/workflows/fan-in-execute.js must run the WORKTREE version (so the
  # task's own fix to the pipeline is verified by its own fan-in), but the SDK sometimes silently
  # materializes the MAIN checkout version. This checker reads the PRODUCTION CARRIER — the SDK-written
  # ~/.claude/projects/<slug>/<session>/workflows/wf_*.json records (which carry BOTH the passed
  # scriptPath AND the materialized script content) — and verifies the materialized script matches the
  # worktree version. DECISIVE when the worktree file is on disk (in-flight / just-fan-in'd); for GONE
  # worktrees it reconstructs the worktree states from .workflow-events + git and is conservative
  # (intermediate/partial ⇒ NOT-EVALUATED, never RED — 硬规则 3b). RED on a proven fallback (the
  # materialized script equals the pre-task base while the task's own commits touched the workflow).
  # @static-tier change
  # @static-class operational
  # @static-object plugin/scripts/fan-in-materialize-check.ts plugin/scripts/select-static-checks-for-touches.ts plugin/workflows/fan-in-execute.js plugin/test/fan-in-materialize-check.test.mjs
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): the wf_*.json records +
  # .workflow-events + task Touches this checker audits are MAIN-checkout state, absent from the
  # one-shot verify worktree. Pointing --root at the main checkout makes the worktree round read the
  # SAME data as a main run ⇒ verdicts identical; on a main run main_root == repo_root ⇒ unchanged.
  run_checker "fan-in-materialize-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/fan-in-materialize-check.ts" --root "${main_root}" --json
  # ⛔ MOVED to run_static_checks() (2026-09-13, tasks/gap-correctness-checkers-opt-in-not-default-
  # suite-member): "direct-to-develop-bypass-check" now runs on the default full-suite gate, with the
  # baseline corrected from the aged fixed sha to the `develop~100` window AC-194 itself measures. The
  # full rationale (why the passive-machine split did not apply to it, why a frozen baseline silently
  # expires, and what the two-window disagreement looked like) is preserved VERBATIM at its new home.
  echo "== suite-duration-exceed check (gap-suite-duration-exceed-check-not-wired, AC4 independent signal) =="
  # AC101's 600s target had two de-facto sentinels (the 10min foreground cap + the duration ledger)
  # that the pre-verified-suite path bypassed — round227 ran 936.5s with NO alert. This checker reads
  # the ledger and goes RED (exit 1, SUITE-DURATION-EXCEEDED) when the latest round exceeds the limit.
  # It was BUILT (2026-08-17) but had ZERO callers (grep 零命中 — 能取假却无调用者, the zero-wiring
  # family rhythm-consumer-check cures). Wired here REPORT-ONLY via --no-block: it is a TREND
  # observation (a stale/over-long PAST round must not red the CURRENT suite — the ledger's latest
  # round is 600s+ so a blocking wire would halt every round), so the verdict is printed
  # (SUITE-DURATION-EXCEEDED stays visible in the suite log) but never exits non-zero. The DEFAULT
  # (no --no-block) stays fail-closed for the AC2 negative control / on-demand diagnosis. CI inherits
  # it for free (its only test step is `bash scripts/test.sh`).
  # @static-tier full  (whole-store observability — deferred to the full-suite gate in scoped mode)
  # @static-class operational
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): the verification-round.jsonl
  # ledger is MAIN-checkout gitignored runtime state, absent from the one-shot verify worktree.
  # Pointing --root at the main checkout makes the worktree round read the SAME ledger as a main run
  # (verdicts identical); on a main run main_root == repo_root ⇒ unchanged.
  run_checker "suite-duration-exceed-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/suite-duration-exceed-check.ts" --root "${main_root}" --no-block
  echo "== instrument-decay-check (gap-archguard-p5-instrument-decay-standing-guard, P5 instrument-decay detector) =="
  # docs/proposals/archguard-generation-era-primitives.md §3 P5: a telemetry carrier's group stops
  # writing while its companion groups in the SAME carrier keep writing (writer split / rate → 0).
  # The canonical case: fan-in-step-trace.jsonl's ac-precheck/suite-start/suite-end/suite-skip went
  # to the per-run fan-in-<task>-<runId>.log under a5a301e03 while merge-develop/typecheck/scoped-gate
  # still write the shared carrier — "没有任何机制发现它" (§2.5). Companion contrast, NOT an absolute
  # rate threshold (a low-frequency single-stream carrier like message-receipts.jsonl must not trip).
  # Wired REPORT-ONLY via --no-block: the decay it reports is the PAST/current shared-carrier state
  # (the sibling fix gap-fan-in-step-trace-suite-step-stopped-writing may still be in flight), so a
  # blocking wire would red the current suite for a transient peer-task state. The DEFAULT (no
  # --no-block) stays fail-closed for on-demand diagnosis / a future manager gate. CI inherits it free
  # (the operational tier's only invocation is `bash scripts/test.sh --static-checks-operational`).
  # @static-tier full  (whole-store observability — deferred to the full-suite gate in scoped mode)
  # @static-class operational
  # @static-object .quay/fan-in-step-trace.jsonl .quay/fan-in-lock-events.jsonl plugin/scripts/instrument-decay-check.ts plugin/test/instrument-decay-check.test.mjs
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): the fan-in-step-trace /
  # lock-events carriers are MAIN-checkout gitignored runtime state, absent from the one-shot verify
  # worktree. Pointing --root at the main checkout makes the worktree round read the SAME carriers as
  # a main run (verdicts identical); on a main run main_root == repo_root ⇒ unchanged.
  run_checker "instrument-decay-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/instrument-decay-check.ts" --root "${main_root}" --no-block
  echo "== release-freshness deliver-orphan detector (gap-deliver-verification-trigger-orphaned-after-land-path-migration, AC4/AC5) =="
  # The deliver orphan detector: how far develop has run ahead of the last cross-host deliver
  # (.quay/develop-deliver-state.json, written by develop-deliver-tgz.sh). stale OR not-evaluated
  # (state file missing / unreadable) ⇒ exit 1 (RED) — the "file absent" state is NOT 合格 (硬规则 3b;
  # that silence is how the trigger went 18 days orphaned with nothing red). Fail-closed (no --no-block):
  # a stale/missing deliver is a persistent "the trigger stopped" condition, not a transient round
  # state — the ACTIVE host's opt-in `--static-checks-operational` SHOULD go red until the trigger
  # runs again. Not in the full-suite gate (operational class), so a passive checkout stays green on
  # code alone.
  # @static-tier full  (whole-store runtime-state observability — deferred to the full-suite gate in scoped mode)
  # @static-class operational
  # @static-object .quay/develop-deliver-state.json plugin/scripts/release-freshness-check.sh plugin/scripts/develop-deliver-tgz.sh plugin/scripts/checker-mutation-cases/release-freshness-check.sh plugin/test/release-freshness-check.test.mjs
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): the .quay/develop-deliver-state.json
  # carrier is MAIN-checkout gitignored runtime state, absent from the one-shot verify worktree.
  run_checker "release-freshness-check" bash "${repo_root}/plugin/scripts/release-freshness-check.sh" --root "${main_root}" --deliver --json
  # Wait for all parallelized checkers and fail closed if any failed (same barrier as
  # run_static_checks — AC3 failure visibility, AC4 cost-ledger completeness).
  run_checker_parallel_wait
}


# resource_gate_check — consult the shared resource gate BEFORE a FULL-SUITE (glob-based default)
# run (gap-no-resource-awareness-heavy-ops-run-blind, AC7). WAIT → the gate printed the numbers,
# this exits non-zero — NEVER silently wait (silent wait is indistinguishable from a hang).
# Scoped paths (explicit files, --for-task, non-default --group) skip the gate — they are the
# verification path that must stay usable under load. QUAY_TEST_SKIP_RESOURCE_GATE=1 is the
# test-only escape for a nested runner invoked inside an outer suite.
resource_gate_check() {
  if [ "${QUAY_TEST_SKIP_RESOURCE_GATE:-}" = "1" ]; then
    echo "scripts/test.sh: QUAY_TEST_SKIP_RESOURCE_GATE=1 — skipping resource gate (nested runner)"
    return 0
  fi
  echo "== resource gate (gap-no-resource-awareness-heavy-ops-run-blind) =="
  if ! bash "${repo_root}/plugin/scripts/resource-gate.sh" --for full-suite; then
    echo "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO." >&2
    exit 1
  fi
}
