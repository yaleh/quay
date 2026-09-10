---
id: gap-ac227-third-party-capability-degradation
title: C域「能力不存在」独立取值 + 防降级回流污染：hermetic 双向测试
  third-party-capability-degradation（AC-227）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-227
---
## Proposal

正本判据 `goals/AC-227-能力不存在-有独立取值且不回流污染本仓库-降级必须可见-goal-012-退出条件②④.md`（goal=GOAL-012，2026-09-10 人裁定三条后授权激活）。exit 0 = hermetic 双向测试 `plugin/test/third-party-capability-degradation.test.mjs` 跑通：

- **正向**：测试自建一致性目标（无 `scripts/test.sh`、只有 `.quay/config.yml` 的 `loop.test_command`），直接调用 fan-in 三步的命令构造/降级判定函数（`docCheckCommandFor` / `resolveScopedGateCommand` / `defaultMechanicalSuiteCommand`），断言三步各产一个「能力不存在」的独立取值（可区分的 skipped/capability-absent），且构造出的命令不含 exit 127。
- **反向（防降级回流污染）**：在本仓库形态（`scripts/test.sh` 存在）上，同样三步仍真跑、命令与迁移前逐字一致。
- **hermetic**：测试自建 mkdtemp 目标目录，⛔ 不读 `.quay/fan-in-step-trace.jsonl` 等生产载体、不要求任何真实 fan-in 跑过（真实世界一次性证明归 GOAL-009 AC-207，周期复证归例行监控——人 2026-09-10 裁定②两轨）。

**现状（实测，位置判定）**：判据命名的测试文件 `plugin/test/third-party-capability-degradation.test.mjs` 不存在；criterion exit 1。降级机制本身已由 `gap-driver-fanin-hardcoded-test-sh-third-party`（done）落地于 `plugin/scripts/worker-driver.ts`——`docCheckCommandFor`（第三方 ⇒ null 跳过）、`resolveScopedGateCommand`（第三方 ⇒ 委托 `loop.test_command` / 皆无 ⇒ `{kind:"skip",reason:"third-party-no-scoped-tooling"}`）、`defaultMechanicalSuiteCommand`（第三方 ⇒ 委托 test_command / 皆无 ⇒ **仍 `exit 127`**）。无任务认领 `goal_ac: AC-227`（grep tasks/ = 0）。

**修法**：建 hermetic 双向测试 + 消除残余 exit 127。GOAL-012 退出条件②「不再以 exit 127 的形态出现」——`defaultMechanicalSuiteCommand` 的「无 test.sh 且无 test_command」分支（`worker-driver.ts:3545`）仍是「能力不存在 ⇒ exit 127」的活实例，须改为不 exit 127 的可区分取值（沿用 scoped-gate 的 `{kind:"skip",reason}` 形态或等价 fail-closed 标记）。

**与既有任务的关系（机制去重）**：`gap-driver-fanin-hardcoded-test-sh-third-party`（done）已建降级机制 + 分片单测（`worker-driver.test.mjs` / `worker-driver-fan-in.test.mjs` 已覆盖「有 test_command ⇒ 委托」「有 test.sh ⇒ 逐字一致」）；本任务补的是**判据命名的 hermetic 双向测试文件**（criterion 的机器判定面）+ 消除残余 exit 127（该分支为「两者皆无」，不在既有测试的正向场景内）。⛔ 非重复——补 criterion 这一闸。

## Plan

1. 建 `plugin/test/third-party-capability-degradation.test.mjs`（hermetic，`node --test` 直接可跑）：正向 mkdtemp 自建目标（无 `scripts/test.sh`、`.quay/config.yml` 写 `loop.test_command: node --test`），直接调用 `docCheckCommandFor` / `resolveScopedGateCommand`（`scopedGateCommandFor`）/ `defaultMechanicalSuiteCommand`，断言三步各产「能力不存在」独立取值（doc-check ⇒ skip；scoped-gate/suite ⇒ 委托 test_command 而非 `scripts/test.sh`/`full-suite-runner`），且 argv 不含 exit 127；反向负控制建本仓库形态目录（有 `scripts/test.sh`），断言三步命令与迁移前逐字一致（`bash <dir>/scripts/test.sh --static-checks-doc`、`bash <dir>/scripts/test.sh --for-task <task> --allow-thin`、full-suite-runner argv），⛔ 断言降级不回流。⛔ 全程不读生产载体、不 spawn 真实 fan-in。
2. 消除残余 exit 127：`worker-driver.ts` `defaultMechanicalSuiteCommand`「无 test.sh 且无 test_command」分支（`:3545`）改为不 exit 127 的可区分 fail-closed 取值（对齐退出条件②）；同步更新 `plugin/test/worker-driver.test.mjs:614` 断言到新形态。
3. 干跑 AC-227 criterion 至 exit 0（`node --no-warnings --experimental-strip-types --test plugin/test/third-party-capability-degradation.test.mjs`）。
4. `scripts/test.sh:792` glob `plugin/test/*.test.mjs` 已自动收录新测试文件（⛔ 无需登记，以 suite 实测为准）。

## Touches

- `plugin/test/third-party-capability-degradation.test.mjs`
- `plugin/scripts/worker-driver.ts`
- `plugin/test/worker-driver.test.mjs`
- `tasks/gap-ac227-third-party-capability-degradation.md`

## Acceptance Criteria

- [x] AC1 判据翻转：`node --no-warnings --experimental-strip-types --test plugin/test/third-party-capability-degradation.test.mjs` exit 0；贴完整输出（含正向+反向断言名）。
- [x] AC2 正向 hermetic：同一测试自建目标（无 `scripts/test.sh`、只有 `loop.test_command`）上，doc-check / scoped-gate / suite 三步命令构造函数各产「能力不存在」独立取值（doc-check ⇒ skip；scoped-gate/suite ⇒ 委托 test_command），且 argv 不含 exit 127；贴断言名与通过片段。
- [x] AC3 反向负控制：同一测试在本仓库形态（有 `scripts/test.sh`）上，三步命令与迁移前逐字一致（doc-check=`bash <dir>/scripts/test.sh --static-checks-doc`、scoped-gate=`bash <dir>/scripts/test.sh --for-task <task> --allow-thin`、suite=full-suite-runner argv）；贴断言名与通过片段。
- [x] AC4 残余 exit 127 消除：`grep -c 'exit 127' plugin/scripts/worker-driver.ts` = 0（⛔ 能力不存在不再以 exit 127 形态出现——GOAL-012 退出条件②）；且 `grep -c 'third-party-no-test-tooling' plugin/scripts/worker-driver.ts` ≥ 1（可区分取值仍在）；且 `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` 仍绿；贴三个读数。

## Definition of Done

AC1–AC4 全绿；AC-227 criterion exit 0。hermetic 双向测试落地（正向：三域降级取独立取值、无 exit 127；反向：本仓库逐字不变、降级不回流），残余 exit 127 消除（能力不存在不再以 exit 127 形态出现，退出条件②）。⛔ 不读生产载体、不要求真实 fan-in——真实世界证明归 GOAL-009 AC-207、周期复证归例行监控（人 2026-09-10 裁定②两轨分工）。