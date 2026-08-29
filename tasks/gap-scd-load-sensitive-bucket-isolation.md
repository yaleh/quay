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

## Discovered Issues（CONTINUE 轮发现，必须修）

1. **`group_of()` 未定义**：bucket 分相实现里用了 `group_of "$bf"` 给每个文件分类，但 `group_of()` 没在 test.sh 定义（grep 全无）→ `$(group_of "$bf")` 空串 → `case ""` 命中 `*` → 所有文件落主相，serial/lowconc 分相形同虚设、重分类也不生效。修法：定义 `group_of()`（读文件的 `// @test-group <group>` 注解返回该 group），或复用 test.sh 已有的 group 解析机制，**不要自造一个不存在的函数**。
2. **suite 非零退出但 fail 0**：fan-in 卡 `suite red`，但 suite 日志 `fail 0`（5407 pass）+ `tmux-leak-scan: clean`。修法：查退出码来源——是 `suite-lpt-runner.mjs` 在 fail 0 时仍非零退出，还是分相后 `bucket_code` 聚合逻辑把子相退出码传错。保证测试全绿 + leak-scan 干净时 `exit 0`。

## Acceptance Criteria

- [ ] AC1（能取假，分类）：8 个 `session-liveness-scd-*.test.mjs` 全部 `@test-group lowconc`（`grep -c '@test-group lowconc'` = 8，且无 `engine`）。
- [ ] AC2（能取假，bucket 隔离）：`--buckets` 跑含 SCD 文件的桶时，SCD 文件在 ≤3 并发子相跑（结构或单测断言：`suite-lpt-runner.mjs` 或 test.sh bucket 路径按 `@test-group` 拆相，`lowconc` 文件不进主并发相）。
- [ ] AC3（能取假，单测）：新增/扩展单测断言 bucket 路径把 `lowconc`/`serial` 文件路由到独立子相（改掉任一 ⇒ 测试红）。
- [ ] AC4（能取假，回归）：`session-liveness-scd-fire.test.mjs` 与 `session-liveness-scd-progress.test.mjs` 在并发 ≥4 下连跑 3 次不 flake（用 `--test-concurrency=4` 显式压）。
- [ ] AC5（能取假，group_of 定义）：`group_of` 在 test.sh 定义且能正确返回文件的 `@test-group`（grep `group_of()` 命中，且单测断言 engine/lowconc/serial 三态返回正确）。
- [ ] AC6（能取假，suite 退出码）：bucket 路径测试全绿（fail 0）+ leak-scan clean 时 `scripts/test.sh --buckets <scd任务>` 退出码 0（改掉任一 ⇒ 测试红）。

## Definition of Done

SCD 族重新分类为 `lowconc`，bucket 路径像全量 suite 一样对 load-sensitive 测试降并发隔离，负载下不再 flake/hang；`group_of` 正确实现；suite 测试全绿时退出码 0。sweep 任务（已实现 `--sweep`，卡在 suite）与 retire-inner-session（suite hung）得以过 suite 落地。

## Touches

- plugin/test/session-liveness-scd-*.test.mjs（8 文件，`@test-group engine` → `lowconc`）
- scripts/test.sh（bucket 路径补 `@test-group` 分相 + 定义 group_of）
- plugin/scripts/suite-lpt-runner.mjs（按 `@test-group` 拆子相，保持 LPT 序）
- plugin/test/ 对应单测（bucket 隔离断言）
- tasks/gap-scd-load-sensitive-bucket-isolation.md（自身）
