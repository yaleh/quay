---
id: gap-manager-cold-start-no-falsifiable-checklist
title: manager 冷启动无证伪判据 + 3 缺陷（idle-watch 不挂/判据指向不存在脚本/注册表≠真 cron）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人 2026-08-12 03:3x 要求立案**：manager 冷启动改进。outer 冷启动有 7 条可证伪判据（cold-start/SKILL.md observable consequences），manager 一条都没有——问题从这个不对称掉出来。

**缺陷 1：`manager-start.sh` 不挂 manager 自己的 idle-watch**——核 :512 矩阵规定那是管理者职责（6 分钟阈值）；boheidc 实测 manager 会话零 Monitor（pane 上那个 1 monitor 是 outer 的）。

**缺陷 2（更严重）：核里查该监视器的判据指向不存在的脚本 `idle-watch.sh`**——全库 find 零结果；真机制是 `session-liveness-mount.sh` + Monitor 工具任务（非独立进程）。同位置第二次换错仪器（上版 TaskList 已换过）。

**缺陷 3：「注册表说武装了」≠「真的有 cron」**——`manager-arm-loop.sh` 只维护 loop-registry.txt；真正的 CronCreate 必须在会话内做，无机件能外部核实。人冷启动后会得到「注册表说已武装、实际没有 cron」的 manager。

**缺陷 4：manager 冷启动没有可证伪完成判据**（outer 有 7 条，manager 0 条）。

**实现归 inner。**

**验证锚**：修后 (a) manager 冷启动有可证伪判据；(b) 核判据指向存在的脚本/机制；(c) 注册表与真 cron 可核实；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 4 缺陷实测（idle-watch 不挂 / 判据指向不存在脚本 / 注册表≠真 cron / 无证伪判据）（本任务 Proposal 已含）— 证据：Proposal §缺陷1–4 逐条记录；`plugin/test/manager-cold-start.test.mjs` AC1 测试 grep 任务体四短语全中
- [x] AC2: **可证伪判据**——manager 冷启动有 observable consequences（对齐 outer 7 条）— 证据：`plugin/skills/manager/SKILL.md` §7a 新增 7 键可证伪清单（SESSION-CREATED/HOME-CREATED/LOOP-ARMED/CRON-EVIDENCED/IDLE-WATCH-MOUNTED/MONITORS-DELIVERING/CHECKLIST-REPORTED）；`grep -c 'observable\|证伪\|判据' plugin/skills/manager/SKILL.md` = **14**（band ≥7 过）；`grep -c 'observable' plugin/skills/manager/SKILL.md` = **2**（invoke 过）；`manager-start.sh` 启动写 `<home>/cold-start-checklist.md` 七键脚手架
- [x] AC3: **判据指向真实机制**——核里查 idle-watch 的判据改用 session-liveness-mount.sh + Monitor 事件（非 pgrep 不存在的 idle-watch.sh）— 证据：① `plugin/loop/manager-tick-core.md` A10 改用 `monitor-mount-check.sh --json`（mounted+targetOk）+ `session-liveness.sh --once`（SESSION-STATUS）+ Monitor 事件流；② **活档案 `orchestration/manager-loop-tick.md` ①巡检块（原 `pgrep 'idle-watch.sh'` 所在行）同样改为真机制**（AC3 在活路径上闭合）；③ `manager-tick-core.test.mjs` no_false_instrument 测试断言覆盖两处（shipped core + live archive）
- [x] AC4: **注册表↔真 cron 核实**——manager 的 CronCreate 可外部核实（非只信 loop-registry.txt）— 证据：`manager-arm-loop.sh --verify-cron` 新增（注册表恰一条哨兵 ∧ `<home>/cron-evidence.jsonl` 会话内 CronCreate/CronList 证据 mechanism/sentinel/cronListCount≥1/atEpoch≥注册表 mtime）；`manager-tick-core.md` B4 记证据；`manager-arm-loop.test.mjs` 6 用例全绿
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿 — 证据：`bash scripts/test.sh --for-task gap-manager-cold-start-no-falsifiable-checklist` 退出 0；**20 pass / 0 fail / 0 cancelled**；静态检查全过（含 tick-core-static-check AC3 41/41 + AC4/AC5/AC6、task-contract-check no violations）；既有 manager-productization + manager-install-vector（14 用例）另行直跑全绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：manager 冷启动判据清单 + idle-watch 核实读数贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/manager-start.sh（挂 idle-watch + 可证伪判据）
- plugin/scripts/manager-arm-loop.sh（注册表↔真 cron 核实）
- plugin/loop/manager-tick-core.md（idle-watch 判据指向真实机制）
- orchestration/manager-loop-tick.md（AC3 live 位置：① 巡检块 pgrep → 真实机制；任务执行时补——原 Touches 漏列，agent 实际改动后合规化）
- plugin/skills/cold-start/SKILL.md（manager 冷启动判据对齐 outer 7 条）
- plugin/skills/manager/SKILL.md（§7a 可证伪清单——Contract measure/invoke 落点；原 Touches 漏列，agent 实际改动后合规化）
- plugin/test/（manager 冷启动用例）
- tasks/gap-manager-cold-start-no-falsifiable-checklist.md（自身：勾 AC + 贴证据）

## Test-Files

- plugin/test/manager-cold-start.test.mjs
- plugin/test/manager-start.test.mjs
- plugin/test/manager-arm-loop.test.mjs
- plugin/test/manager-tick-core.test.mjs

## Contract

measure   manager_checklist_count = `grep -c 'observable\|证伪\|判据' plugin/skills/manager/SKILL.md` 的 stdout 数字
band      manager_checklist_count >= 7（manager 冷启动判据对齐 outer 7 条）
invariant no_false_instrument = 1（核判据不指向不存在的 idle-watch.sh）
invariant registry_matches_cron = 1（loop-registry 与真 CronCreate 可核实一致）
invoke    `grep -c 'observable' plugin/skills/manager/SKILL.md`（贴判据计数）
control   可证伪判据；判据指向真实机制；注册表↔真 cron；既有不回归
resume    判据 / 真实机制 / 核实分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: 人 033505 要求立案（manager 冷启动改进）。4 缺陷由 manager boheidc 实测。实现归 inner。
