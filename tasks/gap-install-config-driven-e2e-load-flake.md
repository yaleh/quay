---
id: gap-install-config-driven-e2e-load-flake
title: install-config-driven-e2e 间歇性负载红——2/3 轮 full red（round-152/155
  失败、round-152 验证轮绿），`✖ A1 两 workspace 字节一致` 在 lowconc 并发 3 下超时；单独跑 12/12 绿
status: done
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
- **与 `gap-runner-grouping-ac7-nested-spawn-load-flake` 同族**（交叉标注）：负载敏感重测试/嵌套 spawn 全量下轮换 flake（同族第 3 例）。

**为什么重要**：它是「真实 install 字节一致」的承重 e2e（config-driven install 的负控制），负载红会**间歇性挡批量合**（round-155 因此没绿，freshness 又加码）。不是假红，是「并发下 install 争抢」的真问题。

**交叉标注（gap-serial-phase-install-test-residue-dependency，2026-08-09）**：本任务候选 A 的落地（把 install-config 从 lowconc 挪到 serial，提交 e09089f3）是**顺序残留依赖的引入源头**——install-config 挪到 serial 后与 quay-init-loop-core 同相位相邻，round-161 出现 install-config passed → quay-init-loop-core failed（AC2/AC4）的顺序依赖。两个任务互为因果：本任务解决「并发 3 下 install 争抢」时把该文件送进 serial，serial 相位暴露了「并发 1 但顺序相邻」的残留依赖；后者（gap-serial-phase-install-test-residue-dependency）已在内层以**测试内隔离强化**修复（install-config 每 install 独立 `--worktree-root` + 每 workspace 独立 tmux session + `after()` 彻底清理）。本文件即那两个任务的负控制边界：隔离后连续 2 轮 serial 相位两 install 测试都绿。

**（cross-annotation 2026-08-09）候选 A 已落地并被系统化为整个 install/quay-init 家族的 serial 收编**：
`gap-install-family-tests-rotate-flakes-under-full-suite` 把 serial 判据从「nested-runner-only」扩展到
「real-install install/quay-init 家族」（round-160/161/162 每轮 flake 不同文件——drift-report/governance、
loop-core/serial、install-config/lowconc），本文件随家族一并移入 serial 并发 1 体制，并加
`// @load-sensitive heavy` + `KNOWN-LOAD-SENSITIVE` 机器可读标记（`known-load-sensitive.ts --list` 权威
清单）。serial 判据扩展的权威说明见 `plugin/loop/fast-mode-loop-tick.md`「serial 组的显式判据」。

**修的方向（实现归内层）**：
- 候选 A：**挪 serial 组**——install e2e 从 lowconc 挪到 serial（并发 1，完全隔离）。但 serial 判据是「nested-runner」，本测试不 spawn worker-pool ⇒ 需扩 serial 判据或另设。
- 候选 B：**组内隔离**——给 install 族单独一组（如 `install` 组，并发 1 或 2），与其他 hermetic 测试分开。
- 候选 C：**测试内减负载**——install 只跑一次（两个 workspace 共享一次 npm pack 产物）、或把 pack 产物缓存，减 install 次数。

### 选定的机制（内层 2026-08-09，候选 A：serial 判据扩展）

**采用候选 A**：install-config-driven-e2e 从 `lowconc`（并发 3）挪到 `serial`（并发 1，完全隔离）。
serial 判据从「仅 nested-runner」扩展为「nested-runner **或** install/quay-init 族」（扩展点：
scripts/test.sh 的 serial 组文档；本文件 GROUP NOTE 同步更新）。理由：
- 根因是 lowconc 并发 3 下与其它 hermetic 测试并行 install 争抢（实测单独跑 122s/12 绿、2/3 轮
  full red）——serial 并发 1 完全隔离，直接消除争抢面。
- 单独文件挪组对 runner-grouping 不变量全部兼容（partition 和、`files+serial==total`、
  AC6 拼接、serial 成员非零均保持——见下验证）。
- 候选 B（新建 install 组）会把组系统从 5 组扩到 6 组，触及 runner-grouping / test-coverage-check
  的组列表断言，冲击面大；候选 C（测试内减负载）单独不足以根治（node:test 无默认超时，失败签名
  是 install 子步在资源压力下返非 0，非纯超时——减 install 次数治不了子步失败）。A 是满足 AC2
  「并发 full-suite 不再失败」的最小冲击路径。

### 实现证据（内层 2026-08-09）

- 改动：`packages/quay/test/install-config-driven-e2e.test.mjs` `@test-group lowconc` → `serial`
  + GROUP NOTE 更新；`scripts/test.sh` serial 判据/描述注释扩展（无功能分支改动——serial 相位
  本就并发 1）。
- 单独跑（修复后基线，改动前后同一测试逻辑）：`node --no-warnings --experimental-strip-types
  --test packages/quay/test/install-config-driven-e2e.test.mjs` → **12/12 绿**，duration 122.7s。
- `--for-task` scoped 门：`bash scripts/test.sh --for-task gap-install-config-driven-e2e-load-flake
  --allow-thin` → **exit 0**（2026-08-09 实测）：scoped 静态检查全 PASS（test-framework-policy /
  test-isolation / test-impl-census / task-contract-check `violations: 0` / adr016-screen-use /
  dead-code-after-return），build_dist_once 绿，install test **12/12 绿**（fail 0 / cancelled 0，
  duration 238s——负载下比单独跑 122s 慢但绿）。
- runner-grouping 不变量（候选 A 兼容性）：install-config-driven-e2e 从 lowconc 移入 serial 后
  `product+engine+governance+serial+lowconc==total` 与 `--list-files+serial==total` 保持；
  runner-grouping.test.mjs 11/11 绿（AC10/AC3/AC6/serial 机制/AC0c 五组 anti-stomp 全过）。

**验证锚**：修后，(a) 连续 2 轮 full red 不再含 install-config-driven-e2e；(b) 单独跑仍 12/12 绿；(c) 负载场景（并发 full-suite）不再超时。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 2/3 轮 red + 单独跑绿 + 失败签名（✖ A1 字节一致 23s + duration_ms 186s）（本任务 Proposal 已含；内层补并发构造复现 = 单独跑实测 122.7s/12 绿对照，见「实现证据」）
- [x] AC2: **修复后连续 2 轮 full green 不含该文件**——负载下不再失败（外层 verification-round 验证；机制 = serial 并发 1 完全隔离——内层已验证串行收编在位：`// @test-group serial` + `// @load-sensitive heavy` + KNOWN-LOAD-SENSITIVE 家族、lowconc 已排除、serial 相位硬编码 cc1，见 Evidence）
- [x] AC3: **单独跑不回归**——`node --test` 单独跑仍 12/12 绿（2026-08-09 实测：12 pass / 0 fail，duration 122.7s）
- [x] AC4: **与 gap-lowconc-tmux-session-name-collision-race 交叉标注**——同族（hermetic 并行 install 争抢；已在 sibling 任务 AC6 追加交叉标注，并注明本任务因同族机制移入 serial）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 install / quay-init 相关契约检查；见「实现证据」）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [ ] 修后实跑：连续 2 轮 full green 不含该文件（贴任务体）——外层 verification-round 验证
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）——内层实测 exit 0 / 12 pass / 0 fail / 0 cancelled（见 Evidence）
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

## Evidence（内层 formalize 2026-08-09）

**剩余工作判定**：候选 A（serial 判据扩展）的机制部分已由本任务先前提交 e09089f3（install-config → serial，cc1）与
sibling `gap-install-family-tests-rotate-flakes-under-full-suite`（6668a4e8，whole install/quay-init 家族收编 + 判据扩展）落地，
工作树内无需新增代码改动。剩余 = AC2 串行隔离的**在位验证** + `--for-task` scoped 门复跑 + 勾 AC/贴证据。

**AC2 串行隔离在位验证（本任务提交实跑，工作树 `/home/yale/work/quay-worktrees/gap-install-config-driven-e2e-load-flake`）**：
1. 组别：`packages/quay/test/install-config-driven-e2e.test.mjs` 头 `// @test-group serial` + `// @load-sensitive heavy` +
   `KNOWN-LOAD-SENSITIVE`（`known-load-sensitive.ts --list` → `packages/quay/test/install-config-driven-e2e.test.mjs\theavy`）。
2. serial 相位硬编码并发 1：`scripts/test.sh` serial 相位 `node --test --test-concurrency=1 ...`（serial 隔离不变量，非可调 knob）。
3. lowconc 排除：`grep -rl "@test-group lowconc" packages/*/test plugin/test` 不含本文件（lowconc 成员 16 个，无 install-config）。
4. serial 判据权威说明：`plugin/loop/fast-mode-loop-tick.md`「serial 组的显式判据」round-162 扩展收录 real-install
   install/quay-init 家族；`scripts/test.sh` group_of 认 5 组、未知组 FAIL-CLOSED。

**`--for-task` scoped 门（2026-08-09 内层复跑）**：`bash scripts/test.sh --for-task gap-install-config-driven-e2e-load-flake --allow-thin`
→ **exit 0**。scoped 静态检查全 PASS：test-framework-policy / test-isolation（44 baselined，无新增）/ test-impl-census /
task-contract-check（`violations: 0`，strict-subset 含本任务 + sibling 任务）/ adr016-screen-use（0 违规）/ dead-code-after-return（0）。
build_dist_once 绿（quay + quay-native dist 写入工作树，非主检出）。install test **12/12 绿**：
```
ℹ tests 12    ℹ pass 12    ℹ fail 0    ℹ cancelled 0    ℹ skipped 0    ℹ todo 0
ℹ duration_ms 143914.768938
GATE_EXIT=0
```
（含此前 flaky 的 `✔ A1 — two workspaces with genuinely different derived test commands lay down byte-identical
product files (only the config differs)`，17.8s。）

**DoD 剩余（不勾，属外层 verification-round）**：`修后实跑：连续 2 轮 full green 不含该文件`（Contract measure
`install_e2e_red_rounds_after_fix` 需 full-suite 日志）+ 全量套件绿。

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-153 后续轮唯一失败 = install-config-driven-e2e 负载 flake——同一文件 2/3 轮 red、单独跑 12/12 绿、验证轮绿；`✖ A1 字节一致` 23s + duration 186s；KNOWN-LOAD-SENSITIVE 族，与 lowconc-race 同族。实现归内层）
