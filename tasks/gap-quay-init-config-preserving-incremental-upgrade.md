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
status: ready
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
- [ ] AC6: **A3 夹具覆盖配置分歧**——`install-config-driven-e2e.test.mjs` 的升级夹具不再只用「配置与模板
      一致的干净 old-install」（合成样本），新增一个**有机演化消费者**形态：工作区有自定义 loop 值 ≠ 模板
      （模拟 archguard 式真实下游），验证升级保留 config loop 值且铺下机制文件（AC1 的真实形态回归测试）
      → 合成侧可测 archguard 撞到的 config-conflict 形态；这是 2026-08-06 裁定「两者都要」的合成侧一半
- [ ] AC7: **下游适配验收**（archguard 报告 #12 生态位盲区）——升级铺到下游后，①②③盲区逐项适配测试：
      ①claim-task 单机无共享裸仓 fail-closed 不误判；②slot-refill cap 阈值与下游资格形状可配；③
      self-report-vocab 词汇版本漂移不误判不收敛。④（taskWorkLanded checkbox 信号）已核实为
      archguard 对 quay 机制的误解（第三信号是 git-history 非 checkbox），不列入。

## Definition of Done

- [ ] AC1-AC5 全勾（已有消费者 quay init --loop 铺新机制且 config 保留；config 备份+恢复失败回滚；fresh install 无冲突；与 delivery-surface-grows 交叉标注——报后怎么办；与 quay-init-rewrites-an-executable 交叉标注）
- [ ] config 保留实测（loop 值不变）+ 备份恢复实测
- [ ] scoped 门 `scripts/test.sh --for-task gap-quay-init-config-preserving-incremental-upgrade` 绿

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

## 验证范围裁定补充（2026-08-06 01:5xZ，外层——判据 vs 现实：范围不是频率）

**实测**：`install-config-driven-e2e.test.mjs` A3 断言正是 archguard 撞到的场景（old-install 升级到全新
产品文件），6/6 全绿含 A3（29s）——而 archguard 35 分钟前真实跑 `quay init --loop` 停 config-conflict、
零文件铺下。**同一场景：合成夹具绿、真实下游撞墙**。

**根因（范围不是频率）**：A3 用 mkdtemp 造的临时工作区（6 处 mkdtemp/tmpdir/fixture），其 old-install 是
自己刚造的、配置与模板一致的干净样本；archguard 是真实演化过的消费者（.quay/config.yml 有自己的 loop
值 ≠ 模板）。**冲突来自「这个项目真的用过、真的改过配置」——合成夹具造不出这个状态**。该文件头注释
写明是 RED-FIRST 落地（当初红的就是 conflict-skip），后来改绿但没覆盖真实下游的配置分歧。

**裁定（人方向「更频繁验证」+ 管理者意见）——两者都要**：
1. **扩 A3 夹具覆盖配置分歧**（造一个有自定义 loop 值 ≠ 模板的工作区，验证升级保留它）——合成侧可测；
2. **真实下游加入验证目标**（archguard / meta-cc / B 机）——高频验证真实工作区，跑一万次 mkdtemp 也
   撞不到有机分歧，只有真实目标能。

**只提高频率不改验证对象 = 跑一万次也撞不到那个状态。**

## archguard 生态位盲区裁定（2026-08-06 04:3xZ，管理者转达 archguard 报告 #12）

**archguard 对 8 个新机制做静态判据×生态位矩阵，报 4 个盲区。外层逐项核实：**

| 盲区 | archguard 判断 | 外层核实 | 裁定 |
|---|---|---|---|
| ①claim-task 两机认领 | 单机无共享裸仓不适用 | 成立（claim-task 无 remote 时 fail-closed，但单机照搬语义不通） | **真实** |
| ②slot-refill 槽位回填 | cap=3 阈值不匹配 + 治本 AC 改派发资格形状 | 部分成立（cap 可配，但资格形状差异真实） | **部分** |
| ③self-report-vocab-audit | 新工厂语义 vs 旧文档版本 0.3.13 误判 | 成立（词汇版本漂移） | **真实** |
| ④taskWorkLanded 第三信号 | 「AC checkbox 计数 countAcCheckboxes」误判 not-yet-flipped | **错判**——quay taskWorkLanded 第三信号是 **git-history of specific Touches paths**（task-status-drift-check.ts:356-365），非 checkbox；ready-pool-check.ts:14-15/177 明确「不依赖 AC checkbox state（fan-in 不勾框）」 | **不成立** |

**裁定：并入本任务作为适配验收 AC，不单独立案。** 理由：本任务修复后正是「机制铺到下游」的时刻，
适配测试是其自然验收维度；①②③是升级后的适配验收项，④是 archguard 对 quay 机制的误解（已澄清）。
**元结论成立**：机制不会自动适配已有下游——config-preserving 实现后需逐项适配测试，不直接照搬判据。
