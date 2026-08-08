---
id: gap-merge-introduced-referenced-not-landed-manager-tick-log
title: 合并引入回归：manager-loop-tick.md 引用 manager-tick-log.md，但铺装集缺它 → quay-init
  --loop 报 referenced-not-landed → 18 个 --loop 测试文件全挂（确定性，非 flake）
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**合并 integration→develop（a862c914）引入回归：`manager-loop-tick.md` 引用 `orchestration/manager-tick-log.md`，但 quay-init.sh 的铺装集（derive_loop_scripts）不含该文件 → quay-init --loop 报 `referenced-not-landed` → 18 个跑 --loop 的测试文件全部失败（真实失败 18，非并发 flake）。**

### 实测（合并后全量验证 788.9s red，00:08-00:21）

- 真实失败 18 文件（`__PERFILE__ passed=false`），全是 --loop / session-liveness / quay-session 家族；
- 共同断言：`FAIL (referenced-not-landed): orchestration/manager-tick-log.md — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md`；
- 错误信息自带修复指引：**「Add the script to the landing set, or declare the file self-create/reference-doc in plugin/skills/init/SKILL.md」**；
- 合并前 develop 无 manager-loop-tick.md（git ls-tree a862c914^1 = 0）、quay-init.sh 无引用（=0）→ **合并引入**；合并后 manager-loop-tick.md 有 3 处引用 manager-tick-log；
- manager-tick-log.md 在 develop 历史有（46ba6360 等，管理者加的，gitignored 运行时遥测）；
- 非并发 flake：isolated 跑 lock/gate-correctness 等 gate 族全部 passed=true（我初次统计误把 test-isolation 的 baselined 静态标记当失败——那些是 `fixed-path-write`/`process-exit-1` 的 baselined 项，非真失败）。

### 修复方向

1. **声明 reference-doc**：在 `plugin/skills/init/SKILL.md`（或对应的铺装声明文件）把 `orchestration/manager-tick-log.md` 声明为 reference-doc / self-create（它确实是运行时遥测文件，quay-init 不该铺它，但应声明它被引用）；
2. **或加进铺装集**：如果 manager-tick-log.md 应该被铺装到目标项目（它是管理者 tick-log 的模板？），加进 derive_loop_scripts 的铺装集。
3. **判定**：manager-tick-log.md 是 gitignored 的运行时遥测（.gitignore 已记「管理者 tick 记账进 gitignore」）——**它不该被铺装**，正确修法是声明 reference-doc（引用但非铺装目标）。
4. **负控制**：修复后 quay-init --loop 在 18 个失败文件上全部通过；全量三趟 fail 0 / cancelled 0。

## Contract

measure referenced_landed = `grep -c "manager-tick-log" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh 2>/dev/null` stdout 数字段（声明后应 ≥1——reference-doc 声明在场）
measure loop_green = `cd /tmp/quay-suite-int && timeout 120 bash scripts/test.sh --group lowconc 2>&1 | tail -3` stdout 数字段（修复后 lowconc 相位无失败）
band loop_green = 0（--loop 家族无失败）
invoke `bash scripts/test.sh --for-task gap-merge-introduced-referenced-not-landed-manager-tick-log 2>&1 | tail -3`
control 修复后 quay-init --loop 不再报 referenced-not-landed（18 文件全过）；全量三趟 fail 0 / cancelled 0
resume 若中断，先跑 measure 读声明在场 + lowconc 失败数

## Acceptance Criteria

- [ ] AC1: **reference-doc 声明**——manager-tick-log.md 在 init/SKILL.md（或铺装声明文件）声明为
      reference-doc / self-create（它不应被铺装，是 gitignored 运行时遥测）
- [ ] AC2: **--loop 家族恢复**——18 个失败文件 quay-init --loop 全部通过（referenced-not-landed 消失）
- [ ] AC3: **全栈并发 8 绿**——全量三趟 fail 0 / cancelled 0
- [ ] AC4: 与 gap-merge-exposed-contract-violations-in-done-tasks（合并后首次完整验证暴露）、
      a862c914 merge 交叉标注

## Definition of Done

- [ ] AC1-AC3 实跑输出贴任务体（声明前后、--loop 家族 18 文件对照、全量三趟绿）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/skills/init/SKILL.md 或对应铺装声明文件（manager-tick-log.md reference-doc 声明）
- plugin/scripts/quay-init.sh（若需要）
- tasks/gap-merge-exposed-contract-violations-in-done-tasks.md（AC4 交叉标注）
- tasks/gap-suite-state-split-across-worktree-and-gate.md（AC4 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T00:3xZ
changed: 合并后全量 red（788.9s，真实失败 18 文件）——红窗根因锁定：合并引入 manager-loop-tick.md 引用
  manager-tick-log.md，铺装集缺它 → referenced-not-landed → 18 个 --loop 文件全挂。非并发 flake
  （gate 族隔离 passed=true，初次统计被 test-isolation baselined 静态标记误导）。修法：manager-tick-log
  是 gitignored 运行时遥测，声明 reference-doc（非铺装目标）。
