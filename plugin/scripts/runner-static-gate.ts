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

# run_static_checks — the repo-wide CODE-CLASS invariants (35 checkers — machine-independent, valid
# in ANY checkout) that run on EVERY FULL-SUITE-mode test-running invocation (the default, --group,
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
# manager/outer/inner/driver 全算): the 11 runtime-state checkers (outer-tick-log / worktree-node-modules /
# suite-bucket-drift / obligation-ledger / fan-in-workflow-retirement / dispatch-record-fingerprint-reason /
# per-task-suite-record / fan-in-ff-protocol / fan-in-materialize / direct-to-develop-bypass /
# suite-duration-exceed) read the loop's LIVE runtime state (tick telemetry, runtime ledgers, live
# task worktrees, develop reflog, SDK-materialized workflow records). They have MOVED OUT of this
# function into run_operational_checks() below — home is the explicit opt-in
# `scripts/test.sh --static-checks-operational` on the ACTIVE host, NOT the full-suite gate: a passive
# checkout must go green on code alone. NOT re-wired into any automatic cadence (outer retiring; drift
# of these checks accepted). They REMAIN in the mutation manifest (checker-mutation-check.sh parses
# run_operational_checks) so the L_S instrument is not weakened — same shape as the DOC-class split
# above. Each operational block carries `# @static-class operational`.
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
  # checkers below (35; the 11 OPERATIONAL-class checkers moved to run_operational_checks under the
  # 2026-09-02 passive-machine ruling; the 7 DOC-class moved to run_doc_checks under AC51 —
  # gap-ac51-assertion-surface-split) are independent, read-only, and share no state — the
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
  echo "== suite-bucket reattribution ratchet (gap-suite-bucket-dynamic-truth-drift-detector, ③-AC6/③-AC7) =="
  # AC121 把 230 个调 test.sh 的测试逐条重归属为 S|M（.quay/suite-bucket-reattribution.jsonl），但覆盖保证是
  # 一次性人工声称（"重扫=0"），非机械 ratchet。本检查让「漏判」变响：新增一个静态纯 S（bucketSetOf={S}，
  # 仅 scripts/test.sh 提及为 subject）且未入重归因的测试 ⇒ RED（第 1 层，阻断——AC121 误归 S 的漏测形态，
  # 基线=0）；含 S 信号但非纯 S（S+M/P+S/P+S+M）未入重归因 ⇒ 只报计数不阻断（第 2 层，留痕——过度选择是
  # 安全方向，现状 14）。重归因文件缺失 ⇒ NOT-EVALUATED（exit 3，硬规则 3b——永不与「0 漏判」同形）。
  # mutation case: 纯 S 已重归属 → 绿；移除归属 → 红；恢复 → 绿。
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
  # plugin/test/skill-allowed-tools-namespace-check.test.mjs + checker-mutation-cases/<name>.sh.
  # @static-tier change
  # @static-object plugin/skills/** plugin/scripts/skill-allowed-tools-namespace-check.ts plugin/test/skill-allowed-tools-namespace-check.test.mjs plugin/scripts/checker-mutation-cases/skill-allowed-tools-namespace-check.sh
  run_checker "skill-allowed-tools-namespace-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/skill-allowed-tools-namespace-check.ts" --root "${repo_root}"
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
  echo "== workflows-dual-copy-drift-check (gap-workflows-dual-copy-drift-unchecked — .claude/workflows/ vs plugin/workflows/ 双副本漂移) =="
  # The five dual-copy workflow files (drain-directives / fan-in-execute / run-routines /
  # execute-suite-fix / pool-quality-judge — AC91 added the last two: the shipped
  # orchestrator-tick-core.md references them, so the plugin/workflows/ mirror must carry them) live
  # in BOTH .claude/workflows/ (what runs here) and plugin/workflows/ (what quay-init --workflows
  # ships to installed targets). A one-sided edit (改正本而落地副本不跟 — the A6/fan-in-execute.js class)
  # previously had NO consumer that went red: the shipped workflow script silently went stale. This
  # is the workflows-copy of the execution-core drift gate (orchestration/*-tick-core.md vs
  # plugin/loop/*-tick-core.md, tick-core-static-check --check-drift) — AC73 判据4 boundary extended
  # to the workflows dual-copy. Wired here as a code-class 每轮 gate; exit 1 on any pair drift.
  # @static-tier change
  # @static-object .claude/workflows/* plugin/workflows/* plugin/scripts/workflows-dual-copy-drift-check.ts plugin/test/workflows-dual-copy-drift-check.test.mjs
  run_checker "workflows-dual-copy-drift-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/workflows-dual-copy-drift-check.ts" --root "${repo_root}"
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
  echo "== rhythm-consumer-check (gap-ac73 判据1/2/3 — cadence consumer contract gate) =="
  # AC73's own checker — the rhythm column's consumer contract: non-按需 mechanisms must have a
  # call site in test.sh / an execution core (or wired elsewhere, or baselined), 按需 mechanisms
  # must declare WHO presses them under WHAT conditions, and --no-block checkers must declare WHO
  # reads their output and acts. Wired here so it is NOT another zero-caller judge (the disease it
  # cures). Exit 1 on any 判据1/2/3 violation.
  # @static-tier change
  # @static-object plugin/scripts/capability-catalog.sh plugin/scripts/rhythm-consumer-check.ts plugin/test/rhythm-consumer-check.test.mjs scripts/test.sh orchestration/*-tick-core.md plugin/loop/*-tick-core.md
  run_checker "rhythm-consumer-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/rhythm-consumer-check.ts" --check --root "${repo_root}"
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
  echo "== dispatch-record fingerprint+reason check (tasks/gap-ac55-dispatch-record-fingerprint-reason, AC55 判据1/判据3) =="
  # AC55 判据1: EVERY dispatch record must carry ① the dispatch-preference file's content fingerprint
  # (git blob hash — "用的是哪一版") AND ② a one-sentence "为什么选它" ("按倾向选还是随便选") — the
  # SPEC §4.3 产物, the 承重 part (C17): without it "读了没读" is indistinguishable in records and the
  # design relies on willpower (SPEC §4.2 empirical: manager's `A0b⑤(b)` skipped 4 rounds). AC55
  # 判据3 (falsifiable): a REAL dispatch record missing fingerprint OR missing reason MUST go RED —
  # pinned by plugin/test/dispatch-record-fingerprint-reason-check.test.mjs (real-record negative
  # controls) + the mutation case. The writer (dispatch-record.ts) is fail-closed on a missing/thin
  # reason; this checker independently judges every record in the runtime log
  # (orchestration/dispatch-record.jsonl, gitignored). Absent file = nothing dispatched = PASS.
  # @static-tier change
  # @static-class operational
  # @static-object orchestration/dispatch-record.jsonl orchestration/dispatch-preference.md plugin/scripts/dispatch-record.ts plugin/scripts/dispatch-record-fingerprint-reason-check.ts plugin/test/dispatch-record-fingerprint-reason-check.test.mjs
  run_checker "dispatch-record-fingerprint-reason-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/dispatch-record-fingerprint-reason-check.ts" --root "${repo_root}"
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
  # scriptPath=<worktree>/.claude/workflows/fan-in-execute.js must run the WORKTREE version (so the
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
  # @static-object plugin/scripts/fan-in-materialize-check.ts plugin/scripts/select-static-checks-for-touches.ts .claude/workflows/fan-in-execute.js plugin/test/fan-in-materialize-check.test.mjs
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): the wf_*.json records +
  # .workflow-events + task Touches this checker audits are MAIN-checkout state, absent from the
  # one-shot verify worktree. Pointing --root at the main checkout makes the worktree round read the
  # SAME data as a main run ⇒ verdicts identical; on a main run main_root == repo_root ⇒ unchanged.
  run_checker "fan-in-materialize-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/fan-in-materialize-check.ts" --root "${main_root}" --json
  echo "== direct-to-develop-bypass-check (gap-direct-to-develop-bypasses-fan-in-gates — 直接提交 develop 绕过 fan-in 机件) =="
  # 直接提交 develop（reflog action = commit，区别于 fan-in 的 merge … Fast-forward）∧ 触及代码/断言面
  # ∧ 不在 ff-lock 时间窗内 ⇒ RED（11b/C17 写所有权/越权直改面）。排除集（denominator 谓词）与
  # 25 vs 30 的差异记录在任务体 + 检测器头注释：设计内 = 记账/转向/遥测面 + manager 独占（.claude/、
  # CLAUDE.md）+ 基础设施（.gitignore/.github/）+ 热修 fan-in 机件本身（plugin/scripts|test/fan-in-*）；
  # 代码面含 plugin/skills/**/*.md（SKILL.md 是产品交付面，7e64a86b 因此报红）。基线 = b11ce720
  # （AC65 声明形态落地点，enforcement 落点 develop HEAD）——pre-form 历史欠账（含 9f57e336/102cbf31/
  # 02b2b2fc 的 outer 直提，当时一条命令验证过）已文档化不重扫，只扫基线后的新直接提交；form 后提交
  # 必须带 `AC65:` + `AC65-Verified:`（同 fan-in-ff-protocol-check --baseline cd4f49b4 模式）。锁事件
  # 缺失 = 可读空（full-suite worktree 无 .quay/ 运行时态），malformed/unpaired = NOT-EVALUATED（硬规则 3b）。
  # @static-tier change
  # @static-class operational
  # @static-object plugin/scripts/direct-to-develop-bypass-check.ts plugin/test/direct-to-develop-bypass-check.test.mjs
  # --root main_root (gap-gitignored-carriers-absent-in-verify-worktree): develop reflog + lock events
  # are MAIN-checkout state, absent from the one-shot verify worktree. Pointing --root at the main
  # checkout gives the worktree round the SAME reflog + lock-events as a main run ⇒ verdicts identical
  # (AC3); on a main run main_root == repo_root ⇒ unchanged (AC2).
  run_checker "direct-to-develop-bypass-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/direct-to-develop-bypass-check.ts" --root "${main_root}" --baseline b11ce7202b46406d5d5bc82ef7b4c030c4aed05b --json
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
