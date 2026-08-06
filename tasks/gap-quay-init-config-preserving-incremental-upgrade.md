---
id: gap-quay-init-config-preserving-incremental-upgrade
title: "quay-init --loop upgrade for EXISTING downstream consumers either STOPS
  (config-conflict: archguard's config loop values ≠ template, no mechanism
  files laid down) or DESTROYS (--force overwrites config losing loop values) —
  archguard real run 2026-08-06 01:27 (tick #114): the just-done
  delivery-surface-grows (51/51) measured drift-REPORTING, NOT the next step
  'what to do AFTER drift is reported' — criterion reports green but misses the
  next step; child (archguard adopter) discovered it in a different usage
  posture (same as the bare-✖ shape); config confirmed intact (stopped before
  writing); fix: config-PRESERVING incremental upgrade entry (backup config,
  apply mechanism files, keep config values)"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**quay-init --loop 升级对已有下游消费者：要么停、要么毁配置——archguard 实跑（子代发现亲代盲区）。**

**【实测（archguard，2026-08-06 01:27，tick #114 + 报告 #11）】**：
- `quay init --loop` **不加 --force** ⇒ 停在 config-conflict（archguard 的 config 有 loop 值 ≠ 模板），
  **新机制文件一个都没铺下来**；
- **加 --force** ⇒ 覆盖 config，**丢掉 loop 值**（gap-quay-init-rewrites-an-executable 的形态）。
- ⇒ 对已有下游消费者，升级**要么停住、要么毁掉配置**。archguard 确认 config 完好（写入前就停了），
  建议加一个**保配置的增量升级入口**。

**【价值】**：外层 51 个测试测的是「**漂移能不能被报出来**」，archguard 撞到的是「**报出来之后怎么办**」——
判据报绿但漏了下一步，且是**子代在不同使用姿态下替亲代发现的**（同 archguard 上次发现裸 ✖ 假红的形态）。

**【裁定（外层）】另立一条**（不重开 done 的 delivery-surface-grows）：done 任务正确交付漂移检测 + 升级
路径的机制；**config 保留对已有消费者是后继需求**（升级的下一步），独立范围。

### 选定机制

1. config-preserving 增量升级入口：备份 config → 铺机制文件 → 保留 config 值
2. 已有消费者无需 --force（不毁 config）；fresh install 不受影响

## Acceptance Criteria

- [ ] AC1: 已有消费者 `quay init --loop`（不加 --force）铺下新机制文件且 **config 保留**（loop 值不变，实测）
- [ ] AC2: config 备份 + 恢复（升级前备份，失败回滚 config 不变）
- [ ] AC3: fresh install 路径不受影响（无 config 冲突）
- [ ] AC4: 与 gap-delivery-surface-grows（done）交叉标注——漂移报告已交付，本任务是「报后怎么办」
- [ ] AC5: 与 gap-quay-init-rewrites-an-executable 交叉标注（同 config 覆盖形态）

## Touches

- plugin/scripts/quay-init.sh（config-preserving 增量升级入口）
- plugin/test/（AC1/AC2 fixture）
- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md（AC4 交叉标注）

## Contract

measure   config_preserved = `bash <upgrade-with-config.sh> 2>&1 | grep -c 'config.*保留\|loop 值不变'` stdout 数字段
band      config_preserved >= 1（升级后 config loop 值不变）
invoke    `grep -n 'config-conflict\|--force\|backup\|保留' plugin/scripts/quay-init.sh`
control   已有消费者不加 --force 升级 ⇒ config 保留（AC1）；fresh install 无冲突（AC3）
resume    备份与升级分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T01:3xZ
changed: archguard 实跑（子代发现）立案——升级对已有消费者停/毁 config；51 测试测漂移报告非报后怎么办。
另立 config-preserving 增量升级（done 任务漂移检测正确，config 保留是后继）。
