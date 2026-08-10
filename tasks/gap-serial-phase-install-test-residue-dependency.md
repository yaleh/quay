---
id: gap-serial-phase-install-test-residue-dependency
title: "serial 相位 install 测试顺序残留依赖——install-config-driven-e2e 先跑（passed）后 quay-init-loop-core 在串行相位失败（AC2/AC4 init 退出非0）；两测试都做真实 quay-init --loop install，前者的 temp workspace/env 残留污染后者"
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

**serial 相位（并发 1，隔离）里两个 heavy install 测试出现顺序残留依赖：install-config-driven-e2e 先跑通过后，quay-init-loop-core 在同一 serial 相位失败（`✖ AC2 init must exit 0` + `✖ AC4 tick docs must NOT be residue-cleaned`）。两个测试都做真实 `quay-init --loop` install，前者的 temp workspace / 环境残留污染后者。**

### 实证（outer 2026-08-09 09:4x）

- **round-161（1570df21）serial 相位**：install-config-driven-e2e 先跑（`passed=true`, 126775ms），随后 quay-init-loop-core 失败（`passed=false`, 93966ms）。
- **失败签名**：`AssertionError: init must exit 0`（AC2 detection ladder）+ `tick docs must NOT be residue-cleaned`（AC4）。
- **单独跑 quay-init-loop-core 12/12 绿**（exit 0）；单独跑 install-config-driven-e2e 12/12 绿。
- **根因**：两个测试都建 temp workspace 跑 `quay-init --loop`（做真实 install + npm pack）。**serial 相位虽然并发 1，但两测试的 temp 目录 / 环境变量 / 共享状态在顺序执行时相互污染**——install-config 的残留（或其 install 遗留的 workspace）使 quay-init-loop-core 的 install 退出非 0。
- **这是 inner 的 load-flake 修复（把 install-config 从 lowconc 挪到 serial）引入的新顺序依赖**——原 lowconc 里它和 quay-init 不直接相邻，挪到 serial 后与 quay-init-loop-core 同相位相邻。

**为什么重要**：serial 相位的价值是「并发 1 完全隔离」——但隔离是**并发侧**隔离，不是**顺序侧**隔离。两个 install 测试同相位顺序执行仍互相污染。这是「隔离」的盲区。

**同教训交叉标注**：见 `tasks/gap-runner-grouping-ac7-nested-spawn-load-flake.md`——serial 组只解决并发侧隔离，不解决嵌套 spawn 自身负载敏感，同「隔离是并发侧不是顺序侧」教训。

**修的方向（实现归内层）**：
- 候选 A：**相位拆分**——serial 相位内部把 install 测试按「一个 temp workspace 族」分组，或把 quay-init 族移回 lowconc（但 lowconc 也有争抢，已证）。
- 候选 B：**测试内隔离强化**——每个 install 测试用**独立**的环境变量命名空间 + 彻底清理（`after()` 删干净 temp workspace），消除顺序残留。
- 候选 C：**serial 相位子顺序**——serial 内按「轻→重」排序，或 install 测试独占 serial 相位（其它 serial 测试移走）。
- 候选 D：**共享残留检查**——serial 相位开头/结尾跑 tmux-leak-scan 类残留检查，install 测试残留即报（防止静默污染下一测试）。

**验证锚**：修后，(a) round-162+ 连续 2 轮 serial 相位 quay-init-loop-core + install-config-driven-e2e 都绿；(b) 单独跑各自仍绿；(c) 顺序交换（quay-init 先、install-config 后）也不互污染。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-161 实证（serial 相位 install-config passed → quay-init-loop-core failed + 两测试单独跑绿 + 顺序依赖定位）（本任务 Proposal 已含；内层补顺序构造复现）
- [ ] AC2: **serial 相位两 install 测试不再互污染**——round-162+ 连续 2 轮 quay-init-loop-core + install-config-driven-e2e 都绿（外层 verification-round 验证）
- [x] AC3: **单独跑不回归**——两测试各自单独跑仍 12/12 绿
- [x] AC4: **顺序无关**——交换两测试执行顺序也不互污染（负控制）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 runner-grouping / serial 机制契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：serial 相位连续 2 轮两测试都绿（贴任务体）；顺序交换负控制
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/test/install-config-driven-e2e.test.mjs（测试内隔离强化——独立 env 命名空间 + 彻底清理）
- plugin/test/quay-init-loop-core.test.mjs（测试内隔离强化 / 容忍前置残留）
- scripts/test.sh（候选 A/C：serial 相位分组或顺序）
- tasks/gap-install-config-driven-e2e-load-flake.md（交叉标注——本任务是它挪 serial 后的顺序依赖副作用）
- tasks/gap-serial-phase-install-test-residue-dependency.md（自身：勾 AC + 贴证据）

## Contract

measure   serial_install_red_rounds_after_fix = `grep -c "quay-init-loop-core.*passed=false\|install-config-driven-e2e.*passed=false" .quay/full-suite.log` 的 stdout 数字
band      serial_install_red_rounds_after_fix = 0（连续 2 轮都绿）
invariant install_solo_green = 1（两测试单独跑恒 12/12 绿）
invariant install_order_independent = 1（交换执行顺序也不互污染）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/quay-init-loop-core.test.mjs` + `... packages/quay/test/install-config-driven-e2e.test.mjs`（各自单独跑贴回）
control   串行相位连续 2 轮两测试都绿；单独跑绿；顺序交换不污染
resume    相位拆分 / 测试隔离 / 残留检查分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-161 serial 相位顺序残留依赖——install-config passed → quay-init-loop-core failed，两测试单独跑绿；inner 的 load-flake 挪 serial 引入的顺序副作用；serial 隔离是并发侧不是顺序侧。实现归内层）

## Evidence（内层实现 2026-08-09）

**实现选择（候选 B：测试内隔离强化，worktree 于 round-159 base fc681f52）**：根因是 install-config-driven-e2e 的所有 install 之前**不传** `--worktree-root`，落到共享的 sibling-of-repo 默认 `/srv/target-worktrees`（一个固定、跨测试共享、磁盘上不存在所以**永远清不掉**的命名空间）；且默认 tmux session 是固定 `proj-0:0.0`（与 quay-init-loop 族 STANDARD_INIT_ARGS 共享）。serial 相位并发 1 但顺序相邻时，前一测试的共享命名空间残留污染后一测试。修复：
- `packages/quay/test/install-config-driven-e2e.test.mjs`：每个 install 注入**唯一** `--worktree-root`（`diskWorktreeRoot()`——磁盘-backed `/var/tmp/install-e2e-wt-*`，非 tmpfs，`after()` 追踪清理）+ **每 workspace 独立 tmux session**（`p-<basename-slice>-0:0.0`，两个 workspace 永不共享）。AC6/AC1「整段 loop 保留」升级路径用 `worktreeRoot: null`（不注入，保持 consumer 记录的 root）。
- `plugin/test/quay-init-loop-core.test.mjs`：注释固化隔离契约（该文件本就每 install 唯一 worktree root + 每测试 fresh workspace；固定 `proj-0:0.0` 现在只属于 loop 族）。
- `tasks/gap-install-config-driven-e2e-load-flake.md`：交叉标注（本任务是 load-flake 挪 serial 的顺序副作用；互为因果）。
- `scripts/test.sh` 未改——候选 A/C（相位分组/排序）经评估非必要，隔离强化已消除共享命名空间。

**AC1 复现固化（顺序构造）**：并发 1 下按 round-161 顺序 `install-config-driven-e2e.test.mjs` → `quay-init-loop-core.test.mjs` 连跑，修复后 **24/24 pass / 0 fail / EXIT=0（246.7s）**（/tmp/ordering-repro.log）。修复前共享命名空间签名已在任务体 Proposal 记录（round-161 passed→failed）。

**AC3 单独跑不回归**：两测试各自单独跑均 **12/12 绿**（修复前基线：install-config 259s exit 0；quay-init-loop-core 175s exit 0）。

**AC4 顺序无关（负控制）**：交换执行顺序 `quay-init-loop-core.test.mjs` → `install-config-driven-e2e.test.mjs`，并发 1 连跑，修复后 **24/24 pass / 0 fail / EXIT=0（311.7s）**（/tmp/ordering-reverse.log）。两序都绿证明不互污染。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-serial-phase-install-test-residue-dependency --allow-thin` → **exit 0**。静态检查 0 违规（test-framework-policy PASS、test-isolation 44 条全部基线内无新增、task-contract strict-subset no violations、adr016 0 违规、dead-code-after-return 0 违规）；测试 **24 pass / 0 fail / 0 cancelled / 0 skipped**（180.0s）。

**残留验证**：修复后两序连跑 + scoped 门跑完，`/var/tmp/install-e2e-wt-*` 0 残留（`after()` 清理生效）、`/tmp/install-e2e-*` 无 11:55 后新增、无 `proj-0` tmux session、`/srv/target-worktrees` 从未存在。

**AC2（serial 相位连续 2 轮绿）归外层 verification-round 验证**——内层只交付顺序无关 + 单独跑绿 + scoped 门绿。

**Re-verify 2026-08-10（本派发，develop head 06f4659c）**：实现已 fan-in 合入 develop（0aaddecd → 2793e1fb）。在 fresh worktree（fork develop @ 06f4659c，node_modules symlink 主检出）上复验：`bash scripts/test.sh --for-task gap-serial-phase-install-test-residue-dependency --allow-thin` → **exit 0**。静态检查 0 违规（test-isolation 44 条基线内无新增、task-contract strict-subset no violations、adr016 0、dead-code-after-return 0、superseded-capability PASS、test-impl-census 319 clean）；测试 **24 pass / 0 fail / 0 cancelled / 0 skipped（161.6s）**。隔离强化代码在位（`diskWorktreeRoot()` + per-workspace tmux session + `worktreeRoot:null` 升级路径）——develop 上 e21e7a54 尚未合入（仅 1 行 `@load-sensitive-entry` 标注，与隔离无关），故本复验直接证明当前 develop 上修复完整。
