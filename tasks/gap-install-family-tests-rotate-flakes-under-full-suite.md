---
id: gap-install-family-tests-rotate-flakes-under-full-suite
title: "quay-init/install 家族 29 个测试在全量套件下轮换性 flake——每轮不同文件（drift-report/governance、loop-core/serial、runtime-landing…）单独跑恒绿，逐测试打地鼠不收敛"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**quay-init/install 家族 29 个测试（做真实 `quay-init --loop` + `npm pack` install）在全量套件下轮换性 flake——每轮不同文件失败、单独跑恒绿。逐测试打地鼠（install-config → serial 组、loop-core → serial 残留、drift-report → ?）不收敛，是系统性负载问题。**

### 实证（outer 2026-08-09）

| round | 失败文件 | 组 | 签名 |
|---|---|---|---|
| 160 | quay-init-drift-report, runtime-landing, test-coverage-check, verify-delivery-surface | governance/serial | inventory drift（halt-check.sh 未重生成，已修） |
| 161 | quay-init-loop-core | serial | AC2 init exit≠0 + AC4 残留（serial 顺序残留，已立案） |
| 162 | quay-init-drift-report | governance | `✖ AC3 本地修改派生脚本列为 drift` (20s) |

**关键事实**：
- **全部单独跑恒绿**（drift-report 6/6、loop-core 12/12、runtime-landing 5/5、verify-delivery 13/13）。
- **组不同**：drift-report=governance、loop-core=serial、install-config=serial、runtime-landing=lowconc——**不是某一组的并发问题，是 install 家族本身在全量套件负载下轮换性超时/失败**。
- **29 个 install 家族测试**（`@test-group governance/lowconc/serial` + quay-init/npm-pack）：轮换失败样本，逐测试打地鼠不收敛。

**为什么重要**：install 家族是「真实 install 字节一致」的承重 e2e。轮换性 flake 使**每轮 full red 都不同文件**——红窗分诊、修复、复跑的成本线性上升（round-160/161/162 三次分诊三个不同文件），而根因是**全量套件负载下 install 子步（npm pack + 双 workspace install）资源争抢**。

**修的方向（实现归内层）**：
- 候选 A：**install 家族全隔离**——29 个 install 家族测试统一进 serial 或独立 install 组（并发 1），消除与其它 hermetic 测试的争抢。**冲击面**：serial 组 5→N，runner-grouping 不变量需核。
- 候选 B：**install 子步减负载**——npm pack 产物缓存共享（29 测试共享一次 pack）、install 只跑一次、临时 workspace 复用。**根治**：从「每次 install」到「每轮一次 pack + 共享」。
- 候选 C：**资源门**——install 家族测试前查资源（类似 resource-gate），资源不足时 skip（不 flake 直接 red）。**风险**：skip 变静默漏测。
- 候选 D：**load-sensitive 白名单**——参考 session-liveness 族的处理（KNOWN-LOAD-SENSITIVE 标记 + 隔离），install 家族同样处理。

**验证锚**：修后，(a) 连续 3 轮 full red 不再因 install 家族轮换（每轮 install 家族文件全绿）；(b) 单独跑仍恒绿；(c) 无 skip 静默漏测。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 3 轮 install 家族轮换失败（round-160/161/162 不同文件）+ 全部单独跑绿 + 29 家族规模（本任务 Proposal 已含；内层补：构造全量负载下 install 家族轮换失败）
- [ ] AC2: **install 家族连续 3 轮不再轮换失败**——每轮 install 家族文件全绿（外层 verification-round 验证）
- [ ] AC3: **单独跑不回归**——29 家族各单独跑仍绿
- [ ] AC4: **无静默漏测**——不通过 skip 逃过（负控制：每轮 install 家族确实被跑）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（runner-grouping / 组系统契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：连续 3 轮 install 家族全绿（贴任务体）；29 家族单独跑绿
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（候选 A/D：install 家族组别或 KNOWN-LOAD-SENSITIVE 隔离）
- plugin/scripts/（候选 B：npm pack 缓存 / install 复用）
- tasks/gap-install-config-driven-e2e-load-flake.md（交叉标注——本任务是它族类的系统化）
- tasks/gap-serial-phase-install-test-residue-dependency.md（交叉标注——同族不同表现）
- tasks/gap-install-family-tests-rotate-flakes-under-full-suite.md（自身：勾 AC + 贴证据）

## Contract

measure   install_family_red_rounds_after_fix = `grep -c "quay-init.*passed=false\|install-config.*passed=false\|runtime-landing.*passed=false\|drift-report.*passed=false" .quay/full-suite.log` 的 stdout 数字
band      install_family_red_rounds_after_fix = 0（连续 3 轮 install 家族全绿）
invariant install_family_solo_green = 1（29 家族各单独跑恒绿）
invariant install_family_no_silent_skip = 1（每轮 install 家族确实被跑，非 skip 逃过）
invoke    `node --no-warnings --experimental-strip-types --test <每个 install 家族文件>`（抽 3 个单独跑贴回）
control   连续 3 轮 install 家族全绿；单独跑绿；无 skip
resume    组别隔离 + pack 缓存 + 资源门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-160/161/162 三次分诊三个不同 install 家族文件——drift-report/governance、loop-core/serial、install-config/serial；全单独跑绿、29 家族规模；逐测试打地鼠不收敛 ⇒ 系统化负载问题。实现归内层）
