---
id: gap-verify-referenced-landed-concurrency-hardening
title: verify_referenced_landed 并发假阳性（gap-lowconc AC3 声称已加固但单次重试不足）：合并后验证 4
  文件全误报已声明 reference-doc（隔离全过），cc3 高负载下多 --loop 并发读 init/SKILL.md 不完整
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**合并后全量验证 red（4 文件）全部为 verify_referenced_landed 的【并发假阳性】——隔离全过，真实代码绿。gap-lowconc AC3 声称已加固（re-read 重试），但单次重试在 cc3 高负载下不足，多个 --loop 测试并发同时误报已声明的 reference-doc。**

### 实测（合并后验证 01:47 red，4 文件）

- **main 组 1 个**：session-liveness.test.mjs AC4（observers with DIFFERENT LOOP_MIN）——隔离 pass 1/0（--test-name-pattern 跑 13.1s pass）；
- **lowconc 3 个**：install-config-driven-e2e（隔离 10/0）、quay-init-loop-driver、quay-init-loop-vendor（隔离 7/0）；
- referenced-not-landed 报 5 路径：contract-violations.md、CRYSTALLIZED-reliable-send、SPEC-branching-model、escalations、outer-phase-goal——**全部已在 init/SKILL.md 声明**（grep 各 ≥1）；
- 根因：quay-init.sh verify_referenced_landed 在 cc3 并发下读 init/SKILL.md 不完整，误报已声明文件。重试逻辑（908-914 行：首查失败后 re-read 再查，确认则 continue）**逻辑正确但单次重试在高负载下仍可能读到不完整**。

### 已知背景

- gap-lowconc AC3 声称已加固（"re-reads self-create/reference-doc declarations + re-checks"），但本轮 4 文件并发误报证明**加固不足**；
- gap-lowconc AC2 记录"observed once at cc3"——本轮从 1 次变 4 文件，负载更高时单次重试不够；
- 这是"声称已修但实际未充分生效"实例（verify 并发加固）。

### 处置方向

1. **verify 并发加固**：verify_referenced_landed 的声明读取改为多级重试（如 3 次递增退避），或对 init/SKILL.md 读取用快照/加锁避免瞬时不完整；
2. **或把声明读取原子化**：一次读入后 grep 多路径（避免每次 grep 单独读文件，多次读之间并发写入撕裂）；
3. **负控制**：真实未声明文件仍 fail（不 mask 真 drift）；高负载 cc3 下已声明文件不再误报。

**不回滚**（失败是假阳性，真实代码绿）。

## Contract

measure verify_green = `cd /tmp/quay-suite-int && timeout 120 node --test plugin/test/quay-init-loop-vendor.test.mjs 2>&1 | grep -E "^ℹ fail"` stdout 数字段（修复后 fail 0）
measure no_false_pos = `cd /tmp/quay-suite-int && timeout 120 node --test plugin/test/install-config-driven-e2e.test.mjs 2>&1 | grep -E "^ℹ fail"` stdout 数字段（修复后 fail 0）
band verify_green = fail 0 且 no_false_pos = fail 0
invoke `bash scripts/test.sh --for-task gap-verify-referenced-landed-concurrency-hardening 2>&1 | tail -3`
control 高负载 cc3 下已声明文件不误报（多个 --loop 并发跑 install/vendor/driver 全过）；真实未声明仍 fail；全量三趟 fail 0 / cancelled 0
resume 若中断，先跑 measure 读两文件 fail 数

## Acceptance Criteria

- [ ] AC1: **verify 并发加固**——verify_referenced_landed 声明读取多级重试/原子化；高负载 cc3 下不再误报
- [ ] AC2: **负控制**——真实未声明文件仍 fail（不 mask 真 drift）
- [ ] AC3: **全栈并发 8 绿**——合并后代码全量三趟 fail 0 / cancelled 0（含 serial 趟）
- [ ] AC4: 与 gap-lowconc-tmux-session-name-collision-race（AC3 声称已加固但不足）、
      gap-post-merge-verification-failure-batch（同批次失败）交叉标注

## Definition of Done

- [ ] AC1-AC3 实跑输出贴任务体（加固前后高负载 cc3 对照、负控制、全量三趟绿）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/scripts/quay-init.sh（verify_referenced_landed 声明读取加固：多级重试/原子化）
- tasks/gap-lowconc-tmux-session-name-collision-race.md（AC4 交叉标注）
- tasks/gap-post-merge-verification-failure-batch.md（AC4 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T01:5xZ
changed: 合并后验证 4 文件失败全为 verify 并发假阳性（隔离全过：session-liveness AC4 1/0、install-config 10/0、
  loop-vendor 7/0）。referenced-not-landed 报 5 个已声明路径。gap-lowconc AC3 声称已加固但单次重试在
  cc3 高负载不足。建任务加固（多级重试/原子化读取），不回滚（假阳性非真回归）。
