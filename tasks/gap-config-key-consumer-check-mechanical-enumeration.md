---
id: gap-config-key-consumer-check-mechanical-enumeration
title: 机械枚举交付配置键消费者——零消费者键（merge_target）接线或删除，config-key-consumer-check 可取假且 covered
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-235
---
## Proposal

AC-235（GOAL-015 退出条件③）有结构性缺口：要求「交付的每个配置键都有消费者，零消费者的键已接线或已删，由机械枚举证明」，但该机械枚举检查器 `plugin/scripts/config-key-consumer-check.ts` 尚不存在——立条时在仓库根干跑 exit 1（可评估且红，非 spawn 失败）。

立条已知实例：`merge_target` 全仓零读者（`grep -rn 'merge_target' plugin/scripts/*.ts packages/quay/src/*.ts` 排除测试后无命中），而 `plugin/scripts/quay-init.sh` 仍写入 `merge_target: integration`，下游 fan-in 记录 `mergeTarget: None`（实际合 develop）；对照组 `fork_baseline` 有真实消费者 `plugin/scripts/fork-baseline.ts`。二者的差别正是本判据要机械分开的东西。

相关任务（同区不同机制，供追溯）：`gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target`（done，把 fork_baseline/merge_target 两键写进 quay-init——merge_target 自此成为无消费者的死键）；`gap-dispatch-fork-does-not-read-config-fork-baseline`（done，证 fork_baseline 有消费者，即对照组）。本任务落地检查器并处理它发现的零消费者键，闭合 AC-235 三断言。

## Plan

1. 新建 `plugin/scripts/config-key-consumer-check.ts`：以 quay-init 写入下游 `.quay/config.yml` 的交付配置键为 writer 面，对每个键在消费者面 grep 读者；输出三态——has-consumer / no-consumer-to-wire / documented-with-reason（豁免必须带理由文本，⛔ 不是无理由 allowlist，对应 GOAL-015 风险 3）；no-consumer-to-wire 计数 > 0 ⇒ exit 1，`--json` 输出三态清单。
2. 处理 `merge_target`：优先删除 `plugin/scripts/quay-init.sh` 中该键写入及相邻 echo 文案（integration 分支全仓无创建点、零消费者）；保留 `fork_baseline`。若删除破坏下游兼容或驱动读取，则改为接线消费者，并在 AC 证据里给出可核证据。
3. 在 `scripts/test.sh` 的 `run_static_checks()` 注册该 checker（`run_checker "config-key-consumer-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/config-key-consumer-check.ts" --root "${repo_root}"`），使其进入 checker-mutation-check manifest。
4. 新建 `plugin/scripts/checker-mutation-cases/config-key-consumer-check.sh`：fixture 注入零消费者键 ⇒ checker RED；恢复消费者 ⇒ GREEN；使 `covered: true`。
5. 注册新脚本三面：`capability-catalog.sh` 六表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER-if-按需）；改 capability-catalog.sh 后跑 `quay-init-closure-ratchet.ts --reanchor`；若为 laid-down 脚本的传递依赖则加进 quay-init 显式 laydown 清单。
6. 全量 `scripts/test.sh` 绿；`checker-mutation-check.sh --list --json` 中该 checker `covered: true`。

## AC

- [x] `node --no-warnings --experimental-strip-types plugin/scripts/config-key-consumer-check.ts --root . --json` exit 0，且零消费者键计数为 0
- [x] `bash plugin/scripts/checker-mutation-check.sh --list --json` 输出含 `config-key-consumer-check` 且该条 `covered: true`（能取假；恒绿即假保证）
- [x] 枚举输出三态可区分：has-consumer / no-consumer-to-wire / documented-with-reason，豁免条目带理由文本可复核
- [x] `grep -rn 'merge_target' plugin/scripts/*.ts packages/quay/src/*.ts` 零命中，且 `plugin/scripts/quay-init.sh` 不再写入该键（或已接线消费者并给出证据）
- [x] mutation case 注入零消费者键 ⇒ checker RED，恢复 ⇒ GREEN（covered 的负控制证据）
- [x] `scripts/test.sh` 全量绿（含新 checker 注册、capability-catalog AC1c、closure-ratchet、checker-mutation-check）

## DoD

`config-key-consumer-check.ts --root . --json` 以机械枚举给出三态清单且 exit 0；`merge_target` 已从 writer 面删除（或已接线）；该 checker 在 `checker-mutation-check.sh --list --json` 中 `covered: true`；全量 suite 绿。

## Touches

- plugin/scripts/config-key-consumer-check.ts（新建）
- plugin/scripts/checker-mutation-cases/config-key-consumer-check.sh（新建）
- plugin/scripts/capability-catalog.sh（注册六表；改后需 quay-init-closure-ratchet --reanchor）
- docs/analysis/quay-init-closure-ratchet.baseline.json（re-anchor）
- plugin/scripts/quay-init.sh（删 merge_target 写入；必要时显式 laydown 清单）
- plugin/scripts/runner-static-gate.ts（run_static_checks 注册——AC128 hub 拆分后正本，非 scripts/test.sh）
- plugin/test/config-key-consumer-check.test.mjs（新建）
- plugin/test/quay-init.test.mjs（merge_target 断言改负控：键不再写入）
- tasks/gap-config-key-consumer-check-mechanical-enumeration.md（本任务）
