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

## Acceptance Criteria

- [x] AC1（能取假，分类）：8 个 `session-liveness-scd-*.test.mjs` 全部 `@test-group lowconc`（`grep -c '@test-group lowconc'` = 8，且无 `engine`）。
- [x] AC2（能取假，bucket 隔离）：`--buckets` 跑含 SCD 文件的桶时，SCD 文件在 ≤3 并发子相跑（结构或单测断言：`suite-lpt-runner.mjs` 或 test.sh bucket 路径按 `@test-group` 拆相，`lowconc` 文件不进主并发相）。
- [x] AC3（能取假，单测）：新增/扩展单测断言 bucket 路径把 `lowconc`/`serial` 文件路由到独立子相（改掉任一 ⇒ 测试红）。
- [x] AC4（能取假，回归）：`session-liveness-scd-fire.test.mjs` 与 `session-liveness-scd-progress.test.mjs` 在并发 ≥4 下连跑 3 次不 flake（用 `--test-concurrency=4` 显式压）。

## Definition of Done

SCD 族重新分类为 `lowconc`，bucket 路径像全量 suite 一样对 load-sensitive 测试降并发隔离，负载下不再 flake/hang。sweep 任务（已实现 `--sweep`，卡在 suite）与 retire-inner-session（suite hung）得以过 suite 落地。

## Touches

- plugin/test/session-liveness-scd-*.test.mjs（8 文件，`@test-group engine` → `lowconc`）
- scripts/test.sh（bucket 路径补 `@test-group` 分相）
- plugin/test/suite-bucket-load-sensitive-isolation.test.mjs（新增，bucket 隔离断言单测）
- tasks/gap-scd-load-sensitive-bucket-isolation.md（自身）
