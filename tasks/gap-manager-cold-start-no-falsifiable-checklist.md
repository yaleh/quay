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

- [x] AC1: **复现固化**——任务体记录 4 缺陷实测（idle-watch 不挂 / 判据指向不存在脚本 / 注册表≠真 cron / 无证伪判据）（本任务 Proposal 已含）
- [x] AC2: **可证伪判据**——manager 冷启动有 observable consequences（对齐 outer 7 条）
- [x] AC3: **判据指向真实机制**——核里查 idle-watch 的判据改用 session-liveness-mount.sh + Monitor 事件（非 pgrep 不存在的 idle-watch.sh）
- [x] AC4: **注册表↔真 cron 核实**——manager 的 CronCreate 可外部核实（非只信 loop-registry.txt）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：manager 冷启动判据清单 + idle-watch 核实读数贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/manager-start.sh（挂 idle-watch + 可证伪判据）
- plugin/scripts/manager-arm-loop.sh（注册表↔真 cron 核实）
- plugin/loop/manager-tick-core.md（idle-watch 判据指向真实机制）
- plugin/skills/cold-start/SKILL.md（manager 冷启动判据对齐 outer 7 条）
- plugin/test/（manager 冷启动用例）
- packages/quay/bin/quay.ts（`manager start --check-idle-watch` / `manager arm --verify` CLI 透传）
- tasks/gap-manager-cold-start-no-falsifiable-checklist.md（自身：勾 AC + 贴证据）

## Test-Files

- `plugin/test/manager-cold-start.test.mjs`

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

## Evidence（inner 实现 2026-08-12）

### Contract measure（worktree 内实跑）

- `manager_checklist_count = grep -c 'observable\|证伪\|判据' plugin/skills/manager/SKILL.md` → **12**（band ≥ 7）
- `invoke grep -c 'observable' plugin/skills/manager/SKILL.md` → **2**（≥ 1）
- `no_false_instrument = 1`：`orchestration/manager-loop-tick.md` §1.b 的 idle-watch 判据已从
  `pgrep -af 'idle-watch\.sh'`（全库 find 零结果）改为 `session-liveness-mount.sh` + Monitor 事件，
  判据两条 = `monitor-mount-check.sh --json`（mounted+targetOk）+ `session-liveness.sh --once`
  （SESSION-STATUS 行）；`plugin/loop/manager-tick-core.md` A10 同步点明真机制、明令「别再把判据
  写回 pgrep 一个不存在的脚本」。
- `registry_matches_cron = 1`：`manager-arm-loop.sh` 新增 `--record-cron <id>`（agent 在 CronList 确认后
  把真实 cron id 写回注册表哨兵行）与 `--verify`（registry-verified exit 0 / registry-only exit 1）。
  实测：刚 arm 未 record → `registry-only`（exit 1）；record 后 → `registry-verified`（exit 0）。

### 修后实跑读数（贴出）

```
# 注册表↔真 cron 核实
$ bash plugin/scripts/manager-arm-loop.sh --store <t>/loop-registry.txt --verify
state          registry-only          # 刚 arm、未 record——「注册表说武装了」≠「真有 cron」
exit=1
$ bash plugin/scripts/manager-arm-loop.sh --store <t>/loop-registry.txt --record-cron cron_sim_001
$ bash plugin/scripts/manager-arm-loop.sh --store <t>/loop-registry.txt --verify --json
{"verified":true,"state":"registry-verified",...}

# idle-watch 核实读数（fail-closed：本 worktree 无常驻挂载 ⇒ mounted=false，正是该判据的负控）
$ bash plugin/scripts/manager-start.sh --check-idle-watch --json
{"mounted":false,"targetOk":false,"sessionStatusLines":1,"ok":false}
exit=1
```

### 测试（scoped 门 + 相关既有集）

- `scripts/test.sh --for-task gap-manager-cold-start-no-falsifiable-checklist --allow-thin` →
  静态检查全绿（tick-core-static-check PASS、delivery-inventory-drift PASS、build-dist + sync-vendor 完成），
  9/9 新测试 `manager-cold-start.test.mjs` 通过（AC2-AC5 钉扎）。
- 相关既有集（worktree 内，`node --test`）：manager-productization / manager-install-vector /
  manager-tick-readings / manager-observation-runtime-check / manager-tick-log-check / manager-layer-*
  → **73 pass + 24 pass**。monitor-mount-check.test.mjs 在补齐 gitignored `.quay/config.yml`（worktree 缺、
  主检出有）后 10/10 pass——非本改动回归，是 worktree 环境缺文件。

### 提交（分开）

idle-watch 挂载 / 注册表核实 / 判据化 / 测试分步 四组提交见 git log（本任务分支）。
