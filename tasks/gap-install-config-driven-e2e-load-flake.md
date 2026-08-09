---
id: gap-install-config-driven-e2e-load-flake
title: "install-config-driven-e2e 间歇性负载红——2/3 轮 full red（round-152/155 失败、round-152 验证轮绿），`✖ A1 两 workspace 字节一致` 在 lowconc 并发 3 下超时；单独跑 12/12 绿"
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

**`packages/quay/test/install-config-driven-e2e.test.mjs` 是间歇性负载敏感——同一文件 2/3 轮 full red（round-152 59失败 含它、round-155 唯一失败就是它），但 round-152 验证轮（b7145e15）同一文件 GREEN；单独跑恒 12/12 绿。**

### 实证（outer 2026-08-09 07:5x）

| 轮 | 结果 | 失败签名 |
|---|---|---|
| round-152（b7145e15）验证轮 | **GREEN**（213/0） | 通过 |
| round-153 后续轮（16fdb364） | **RED**（212/1，唯一失败） | `✖ A1 — two workspaces with genuinely different derived test commands lay down byte-identical product files (only the config differs)` (23s) |
| 单独跑 | **12/12 绿**（exit 0） | 通过 |

**根因方向（KNOWN-LOAD-SENSITIVE 族，与 gap-lowconc-tmux-session-name-collision-race 同族）**：
- 该测试做**真实 `npm pack` + 两个 temp workspace install**（每 install 起 `quay-native mcp` + `npm install`），跑 `✖ A1` 子测试时 `duration_ms=186563`（3min+）——**低并发组（lowconc, 并发 3）里与其他 hermetic 测试并行时，install 慢 + 资源争抢 ⇒ 超时/失败**。
- 已标注 `// @test-group lowconc`（正确），但 lowconc 并发 3 下仍会争抢（两个 install 同时跑 + 主相位残留资源）。
- **与 `gap-lowconc-tmux-session-name-collision-race` 同族**：hermetic 但并行 install 互相干扰。

**为什么重要**：它是「真实 install 字节一致」的承重 e2e（config-driven install 的负控制），负载红会**间歇性挡批量合**（round-155 因此没绿，freshness 又加码）。不是假红，是「并发下 install 争抢」的真问题。

**修的方向（实现归内层）**：
- 候选 A：**挪 serial 组**——install e2e 从 lowconc 挪到 serial（并发 1，完全隔离）。但 serial 判据是「nested-runner」，本测试不 spawn worker-pool ⇒ 需扩 serial 判据或另设。
- 候选 B：**组内隔离**——给 install 族单独一组（如 `install` 组，并发 1 或 2），与其他 hermetic 测试分开。
- 候选 C：**测试内减负载**——install 只跑一次（两个 workspace 共享一次 npm pack 产物）、或把 pack 产物缓存，减 install 次数。

**验证锚**：修后，(a) 连续 2 轮 full red 不再含 install-config-driven-e2e；(b) 单独跑仍 12/12 绿；(c) 负载场景（并发 full-suite）不再超时。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 2/3 轮 red + 单独跑绿 + 失败签名（✖ A1 字节一致 23s + duration_ms 186s）（本任务 Proposal 已含；内层补并发构造复现）
- [ ] AC2: **修复后连续 2 轮 full green 不含该文件**——负载下不再失败（外层 verification-round 验证）
- [ ] AC3: **单独跑不回归**——`node --test` 单独跑仍 12/12 绿
- [ ] AC4: **与 gap-lowconc-tmux-session-name-collision-race 交叉标注**——同族（hermetic 并行 install 争抢）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 install / quay-init 相关契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：连续 2 轮 full green 不含该文件（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/test/install-config-driven-e2e.test.mjs（组别调整 / install 减负载 / pack 缓存）
- scripts/test.sh（候选 A/B：install 族组别或 serial 判据扩展）
- tasks/gap-lowconc-tmux-session-name-collision-race.md（AC4 交叉标注）
- tasks/gap-install-config-driven-e2e-load-flake.md（自身：勾 AC + 贴证据）

## Contract

measure   install_e2e_red_rounds_after_fix = `grep -c "install-config-driven-e2e.*passed=false" .quay/full-suite.log` 的 stdout 数字
band      install_e2e_red_rounds_after_fix = 0（连续 2 轮不再因它 red）
invariant install_e2e_solo_green = 1（单独跑恒 12/12 绿）
invariant install_e2e_parallel_no_race = 1（并发 full-suite 下不再超时/失败）
invoke    `node --no-warnings --experimental-strip-types --test packages/quay/test/install-config-driven-e2e.test.mjs`（单独跑贴回）
control   并发 full-suite ⇒ 该文件绿；单独跑 ⇒ 绿；构造高负载 ⇒ 不再超时
resume    组别调整 + 减负载分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-153 后续轮唯一失败 = install-config-driven-e2e 负载 flake——同一文件 2/3 轮 red、单独跑 12/12 绿、验证轮绿；`✖ A1 字节一致` 23s + duration 186s；KNOWN-LOAD-SENSITIVE 族，与 lowconc-race 同族。实现归内层）
