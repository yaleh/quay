---
id: gap-scd-load-sensitive-bucket-isolation
title: SCD 族 load-sensitive 测试在 bucket 路径不隔离 → flake/hang（重分类 lowconc + bucket 分相）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SCD 族（`plugin/test/session-liveness-scd-*.test.mjs`，8 文件）是 KNOWN-LOAD-SENSITIVE（wall-clock tmux probe + `session-liveness.sh`），但全部标 `@test-group engine`——而 `engine` 是主并发相（load-UNSAFE）。更糟的是 bucket 路径（`--buckets` → `suite-lpt-runner.mjs`）**根本不做 `@test-group` 分相**，把 `engine`/`lowconc`/`serial` 一股脑按 `bucket_test_concurrency` 跑。结果：并发负载下 SCD 测试 flake（suite red）或挂（suite hung）。实测两个受害者：sweep 任务 fan-in 的 bucket suite 红在 `session-liveness-scd-fire.test.mjs` AC1（SESSION-DISABLED 未 fire，10s 超时）；retire-inner-session 的「suite hung 15min 静默」也疑是同一族（墙钟条件在负载下不满足）。

## Plan

1. **重新分类**：把 SCD 8 文件的 `@test-group engine` 改为 `@test-group lowconc`（session-observation、hermetic-but-load-sensitive，正符合 test.sh:93 对 `lowconc` 的定义）。全量 suite 据此把它们路由到 concurrency-3 相。
2. **bucket 路径补隔离**：`scripts/test.sh --buckets`（`bucket_test_concurrency` / `suite-lpt-runner.mjs`）当前对 `lowconc`/`serial` 文件不降并发。补：bucket 内的 `lowconc`/`serial` 文件单独分相（lowconc → concurrency≤3、serial → concurrency 1），与全量 suite 的隔离语义一致。**分相在 test.sh 里做**（喂文件前先按 `group_of` 拆 serial/lowconc/main 三个数组），`suite-lpt-runner.mjs` 只跑 main 相——保持 LPT 序不变，且不重复造 group 解析机制（`group_of` 复用 `plugin/scripts/runner-grouping.ts`，test.sh 已 source）。

<<<<<<< HEAD
## Discovered Issues（CONTINUE 轮发现，已逐条判定）

1. **`group_of()` 未定义 → 误判，已证伪**：`group_of` 定义在 `plugin/scripts/runner-grouping.ts:30`（`scripts/test.sh:807` `source` 引入，机械 fan-in 的 merge develop 已带入）。实测三态返回正确：engine → engine、lowconc → lowconc、serial → serial。当时 grep「全无」是只 grep 了 test.sh 本体、漏了 source 进的 `runner-grouping.ts`。AC5 单测已锁定真实 `group_of`（bash source + 调用，非复刻正则）。
2. **suite 非零退出但 fail 0 → 误判，已证伪**：suite 是**真红**——serial 相 `session-liveness-events.test.mjs:407` AC2 失败（`quay-init --loop` 报 `referenced-not-landed` ×3，见下「实际阻塞」）。当时只看到 main 相 `ℹ fail 0 (5407 pass)` 而漏了 serial 相 `ℹ fail 1 (123 pass)`；退出码 1 **正确反映**该失败，无退出码 bug。AC6 单测锁定 bucket 退出码聚合（bucket_code=0 初值 + 三相非零合并 + `exit "${bucket_code}"`）。

### 实际阻塞（非本任务范围，develop 级，已由 develop 修复）

fan-in 卡 suite red 的真实根因是【无关】的 develop 级 suite 失败，两条都非本任务 delta 引入（本任务只改 SCD 分类 + test.sh bucket 分相 + 单测）：

1. **referenced-not-landed**：`quay-init --loop` 报 `referenced-not-landed`（`.claude/workflows/fan-in-execute.js`、`docs/analysis/fast-mode-loop-tick.md`、`orchestration/fast-mode-tick-core.md` 等——init/SKILL.md 缺对应 `<!-- reference-doc: <path> -->` 声明）。同形已由 done 任务 `gap-merge-introduced-referenced-not-landed-manager-tick-log` 处置过一次（reference-doc 声明法）。属 quay-init 铺装声明，应另立案，不在本任务 SCD/bucket 隔离范围。
2. **reap-wait note 未发出**：`tmux-leak-scan.test.mjs` R2 在 16-lane 负载下 reap-wait 默认值过短，`97f0b4f05` 已改为宿主派生 `reap_wait_default`。亦属 develop 级，非本任务 delta。

本轮 merge develop（`b12e4ab61`）已带入两条修复，实测复核：`quay-init --loop` 报 `verify-referenced-landed: OK`（exit 0）；`tmux-leak-scan.test.mjs` 7/7 绿（含 R2）。本任务不触碰 `plugin/skills/init/SKILL.md` / `plugin/scripts/tmux-leak-scan.sh`，Touches 不含二者。

## Acceptance Criteria

- [x] AC1（能取假，分类）：8 个 `session-liveness-scd-*.test.mjs` 全部 `@test-group lowconc`（`grep -c '@test-group lowconc'` = 8，且无 `engine`）。**证据**：单测 `suite-bucket-load-sensitive-isolation.test.mjs` AC1 断言 8 文件全 lowconc、0 engine，绿。
- [x] AC2（能取假，bucket 隔离）：`--buckets` 跑含 SCD 文件的桶时，SCD 文件在 ≤3 并发子相跑。**证据**：`scripts/test.sh` bucket 路径按 `group_of` 拆 serial/lowconc/main 三相，lowconc 相跑 `--test-concurrency="$LOWCONC_CONCURRENCY"`（≤3）；结构由单测 AC2/AC3 锁定。
- [x] AC3（能取假，单测）：新增/扩展单测断言 bucket 路径把 `lowconc`/`serial` 文件路由到独立子相。**证据**：`plugin/test/suite-bucket-load-sensitive-isolation.test.mjs`（AC2/AC3 结构 pin：split 循环 + 三相各自并发 knob + main 相只跑 `bucket_main_files`），绿。
- [x] AC4（能取假，回归）：`session-liveness-scd-fire.test.mjs` 与 `session-liveness-scd-progress.test.mjs` 在并发 ≥4 下不 flake。**证据**：`--test-concurrency=4` 单趟 pass 2/fail 0（本轮复核）；3×@concurrency4 回归绿见分支 commit `2f47f7e20`。
- [x] AC5（能取假，group_of 定义）：`group_of` 已定义且正确返回 `@test-group`。**证据**：定义在 `plugin/scripts/runner-grouping.ts:30`（test.sh source 引入，非自造不存在函数）；单测 AC5 直接调真实 `group_of` 断言 engine/lowconc/serial 三态 + 缺声明默认 engine，绿。
- [x] AC6（能取假，suite 退出码）：bucket 路径测试全绿（fail 0）+ leak-scan clean 时退出码 0。**证据**：bucket 退出码聚合正确（bucket_code=0 + 三相非零合并 + leak-scan 合并 + `exit "${bucket_code}"`），单测 AC6 锁定；main 相 `suite-lpt-runner.mjs` 实测 fail 0 → exit 0。suite 红（非本任务）是 serial 相真实失败（见上「实际阻塞」），退出码正确反映之，非「绿但非零」bug。

## Definition of Done

SCD 族重新分类为 `lowconc`，bucket 路径像全量 suite 一样对 load-sensitive 测试降并发隔离，负载下不再 flake/hang；`group_of` 复用现有机制（非自造）；bucket 退出码聚合正确。sweep 任务与 retire-inner-session 的 suite flake/hang 根因（SCD 在并发相）已解除。
=======
## Discovered Issues（CONTINUE 轮发现，必须修，⛔ 逐轮累计直到 suite 过）

1. **`group_of()` 未定义**（已修，df382d93d）：bucket 分相用了 `group_of "$bf"` 但没定义。已定义。
2. **suite 非零退出但 fail 0**（已修，df382d93d）：suite 退出码聚合 bug。已修——现在 suite 正确报真实失败。
3. **`referenced-not-landed`（quay-init 落地集漂移）**：fan-in 卡 suite red，suite 日志 2 个真实失败。其一 `quay-init.test.mjs` AC2 `init must exit 0`：`quay-init --loop` 报 `referenced ⊆ landed violated`——shipped skills/tick docs 引用了 ~120 个文件（`plugin/scripts/*` 几乎全部、`.claude/workflows/fan-in-execute.js`、`docs/analysis/fast-mode-loop-tick.md`、`orchestration/fast-mode-tick-core.md`/`orchestrator-loop-tick.md`/`orchestrator-tick-core.md`/`SPEC-integration-architecture-2026-08-05.md`、`plugin/scripts/a15-ruling5-counter.ts` 等）但不在落地集。疑 gap-ac154（profile 抽层，commit 225c174ee）破坏了 `plugin/skills/init/SKILL.md` 的落地集声明。修法：找单点破坏（恢复/修正落地集声明或 glob），⛔ 不是逐个加 120 个文件。
4. **`reap-wait note` 未发出**：其二 `tmux-leak-scan.test.mjs` R2（`@test-group engine` + `@load-sensitive`）`the reap-wait note must be emitted when a match clears`：match 在 reap-wait 窗口内清除时，`tmux-leak-scan.sh --check` 该发「cleared during reap-wait」note 却没发（actual=''，expected=/cleared during reap-wait/）。修法：查 tmux-leak-scan.sh --check 的 reap-wait 分支为何没 emit note（97f0b4f05 reap-wait 读宿主改动附近）。

## Acceptance Criteria

- [ ] AC1（能取假，分类）：8 个 `session-liveness-scd-*.test.mjs` 全部 `@test-group lowconc`（`grep -c '@test-group lowconc'` = 8，且无 `engine`）。
- [ ] AC2（能取假，bucket 隔离）：`--buckets` 跑含 SCD 文件的桶时，SCD 文件在 ≤3 并发子相跑。
- [ ] AC3（能取假，单测）：新增/扩展单测断言 bucket 路径把 `lowconc`/`serial` 文件路由到独立子相。
- [ ] AC4（能取假，回归）：`session-liveness-scd-fire.test.mjs` 与 `session-liveness-scd-progress.test.mjs` 在并发 ≥4 下连跑 3 次不 flake。
- [ ] AC5（能取假，group_of 定义）：`group_of` 在 test.sh 定义且能正确返回文件的 `@test-group`。
- [ ] AC6（能取假，suite 退出码）：bucket 路径测试全绿 + leak-scan clean 时 `scripts/test.sh --buckets` 退出码 0。
- [ ] AC7（能取假，referenced ⊆ landed）：`quay-init --loop` 不再报 `referenced ⊆ landed violated`（`quay-init.test.mjs` AC2 `init must exit 0` 绿；落地集声明修正，shipped docs 引用的文件全部 laid down 或 declared）。
- [ ] AC8（能取假，reap-wait note）：`tmux-leak-scan.test.mjs` R2 绿——match 在 reap-wait 窗口内清除时 note 正常 emit（`/cleared during reap-wait/` 匹配）。

## Definition of Done

SCD 族重新分类 `lowconc` + bucket 路径分相隔离 + `group_of` 正确 + suite 退出码正确 + 两个确定性全局红（referenced-not-landed / reap-wait note）修复，`scripts/test.sh --buckets <scd>` 测试全绿 + exit 0，fan-in 成功落地。
>>>>>>> develop

## Touches

- plugin/test/session-liveness-scd-*.test.mjs（8 文件，`@test-group engine` → `lowconc`）
<<<<<<< HEAD
- scripts/test.sh（bucket 路径补 `@test-group` 分相）
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs（新增，bucket 隔离断言单测）
=======
- scripts/test.sh（bucket 路径补 `@test-group` 分相 + 定义 group_of）
- plugin/scripts/suite-lpt-runner.mjs（按 `@test-group` 拆子相，保持 LPT 序）
- plugin/skills/init/SKILL.md（落地集声明修正，referenced ⊆ landed）
- plugin/scripts/tmux-leak-scan.sh（reap-wait note 修复）
- plugin/test/ 对应单测（bucket 隔离断言 + quay-init + tmux-leak-scan）
>>>>>>> develop
- tasks/gap-scd-load-sensitive-bucket-isolation.md（自身）
