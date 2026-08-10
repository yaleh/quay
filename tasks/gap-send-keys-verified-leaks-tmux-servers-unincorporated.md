---
id: gap-send-keys-verified-leaks-tmux-servers-unincorporated
title: send-keys-verified.test.mjs 未收编且泄漏 tmux
  server——KNOWN-LOAD-SENSITIVE=0、@test-group lowconc；docs/analysis 已记录 144 个孤儿
  tmux 进程(136 skv-ok,~670-811MB,清理只删目录不杀服务端)；按
  install-family/create/proposal-convergence/relation-sync 同一套路收编(标注+进
  known-load-sensitive+清理杀服务端)——开门第一步,修泄漏源让套件干净、绿更快、放掉 169
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**`plugin/test/send-keys-verified.test.mjs` 现在 `@test-group lowconc` 但 KNOWN-LOAD-SENSITIVE=0（`plugin/scripts/known-load-sensitive.ts` 无条目）——而 `docs/analysis/send-keys-verified-test-leaks-tmux-servers.md`（2026-08-04）已记录它泄漏 tmux server（144 个孤儿进程，136 个 skv-ok，~670-811MB 内存）。按 install-family / create-mcp / proposal-convergence / relation-sync 同一套路收编：加 KNOWN-LOAD-SENSITIVE + @load-sensitive 标注 + 隔离清理杀服务端（非只删目录）。这是开门的第一步——修掉这个泄漏源，套件更干净，绿更快。**

### 实证（manager 2026-08-10 收窄指示 + outer 复核）

- **send-keys-verified.test.mjs**：`@test-group lowconc`，known-load-sensitive.ts 条目 **0**。
- **泄漏文档已存在**：`docs/analysis/send-keys-verified-test-leaks-tmux-servers.md`（2026-08-04）——`pgrep -af '^tmux'` 命中 144 个 `tmux new-session -d -s <name> bash` 进程，136 个 skv-ok；全部创建于 00:37–00:44Z 7 分钟窗口；合计 ~670–811MB 内存。根因：**隔离清理只删目录，不杀服务端**。
- **同族收编先例**：install-family（round 162 收编进 serial + KNOWN-LOAD-SENSITIVE）、create-mcp（round-188 后收编）、proposal-convergence（round-164 后收编）、relation-sync（round-209 后收编）——都是「真实子进程/真实 tmux 服务端」在套件负载下泄漏/轮换红。
- **开门策略（manager 收窄指示）**：瓶颈在交付侧（169 排红门后），力气放在开门上——修掉 send-keys-verified 泄漏源，套件更干净，绿更快，走 MERGE-TO-VERIFIED-COMMIT 放掉 169。保持 1-2 在飞，不填满 cap。

**为什么重要**：send-keys-verified 泄漏 144 个 tmux 服务端进程占 ~700MB 内存——这在串行/lowconc 相加重负载，可能推高其它测试的失败率（红窗分母）。收编它（隔离 + 杀服务端）是「减少红窗分母」的又一实例，且是开门的直接动作。

### 选定机制方向（实现归内层，接法留执行时）

1. **收编**：`send-keys-verified.test.mjs` 加 `// KNOWN-LOAD-SENSITIVE` + `// @load-sensitive tmux-server`（或等价 kind）+ 进 `known-load-sensitive.ts` 条目 → runner 路由到隔离相位。
2. **隔离清理杀服务端**：清理逻辑不只删目录，还杀本测试创建的 tmux 服务端（`tmux kill-session` 或按名字杀）——修掉 144 孤儿进程泄漏。
3. **家族交叉标注**：与 install-family / create-mcp / proposal-convergence / relation-sync 同族（真实子进程/服务端泄漏）。

**验证锚**：修后 (a) 收编后套件内无 send-keys-verified 泄漏（无孤儿 tmux 进程）；(b) solo 恒绿；(c) 泄漏文档更新或标注已修。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（KNOWN-LOAD-SENSITIVE=0、泄漏文档 144 进程/700MB、同族收编先例）（本任务 Proposal 已含）
- [ ] AC2: **收编**——`send-keys-verified.test.mjs` 加 KNOWN-LOAD-SENSITIVE + @load-sensitive 标注 + known-load-sensitive.ts 条目
- [ ] AC3: **隔离清理杀服务端**——清理逻辑杀本测试创建的 tmux 服务端（非只删目录），无孤儿进程泄漏
- [ ] AC4: **家族交叉标注**——install-family/create-mcp/proposal-convergence/relation-sync 同族
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿；solo 恒绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：收编后无孤儿 tmux 进程（贴任务体）；solo 绿
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/send-keys-verified.test.mjs（KNOWN-LOAD-SENSITIVE + @load-sensitive + 清理杀服务端）
- plugin/scripts/known-load-sensitive.ts（新增 send-keys-verified 条目）
- docs/analysis/send-keys-verified-test-leaks-tmux-servers.md（标注已修/更新）
- plugin/test/known-load-sensitive.test.mjs（AC2 条目测试）
- tasks/gap-install-family-tests-rotate-flakes-under-full-suite.md（交叉标注——同族）
- tasks/gap-create-mcp-suite-context-flake-after-speedup-rework.md（交叉标注——同族）
- tasks/gap-proposal-convergence-load-flake-20-child-concurrency.md（交叉标注——同族）
- tasks/gap-relation-sync-load-flake-child-spawn-under-suite.md（交叉标注——同族）
- tasks/gap-send-keys-verified-leaks-tmux-servers-unincorporated.md（自身：勾 AC + 贴证据）

## Contract

measure   orphan_tmux_after_suite = `pgrep -af '^tmux new-session' | grep -c 'skv-'` 的 stdout 数字
band      orphan_tmux_after_suite = 0（收编+清理杀服务端后无孤儿 tmux）
invariant send_keys_verified_solo_green = 1（单独跑恒绿）
invariant cleanup_kills_server_not_just_dir = 1（清理杀服务端）
invoke    `node --no-warnings --experimental-strip-types --test plugin/test/send-keys-verified.test.mjs`（单独跑贴回）+ `pgrep -af '^tmux new-session' | grep -c skv-`（贴 0）
control   无孤儿 tmux；solo 绿；清理杀服务端
resume    收编 / 清理杀服务端分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 收窄指示——send-keys-verified 按 install-family/create/proposal-convergence/relation-sync 同一套路收编（KNOWN-LOAD-SENSITIVE=0 + 泄漏文档已记录 144 tmux 孤儿进程 700MB）。开门策略：修泄漏源让套件更干净、绿更快、走 MERGE-TO-VERIFIED-COMMIT 放掉 169。保持 1-2 在飞。实现归内层
