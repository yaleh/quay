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
2. **bucket 路径补隔离**：`scripts/test.sh --buckets`（`bucket_test_concurrency` / `suite-lpt-runner.mjs`）当前对 `lowconc`/`serial` 文件不降并发。补：bucket 内的 `lowconc`/`serial` 文件单独分相（lowconc → concurrency≤3、serial → concurrency 1），与全量 suite 的隔离语义一致。`suite-lpt-runner.mjs` 需能按 `@test-group` 拆子相（或 test.sh 在喂文件前先拆，保持 LPT 序不变）。

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

## Touches

- plugin/test/session-liveness-scd-*.test.mjs（8 文件，`@test-group engine` → `lowconc`）
- scripts/test.sh（bucket 路径补 `@test-group` 分相 + 定义 group_of）
- plugin/scripts/suite-lpt-runner.mjs（按 `@test-group` 拆子相，保持 LPT 序）
- plugin/skills/init/SKILL.md（落地集声明修正，referenced ⊆ landed）
- plugin/scripts/tmux-leak-scan.sh（reap-wait note 修复）
- plugin/test/ 对应单测（bucket 隔离断言 + quay-init + tmux-leak-scan）
- tasks/gap-scd-load-sensitive-bucket-isolation.md（自身）
