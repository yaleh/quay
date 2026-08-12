# outer 在飞协调状态（2026-08-12 21:20Z 刷新——ADR-009：须跨压缩存活）

> **本文件有效期 = 到下一次终态轮次为止，过期即重写。** 压缩/新会话后先读此文件再决定动作。
> 源：外层会话 902b4528（session 可能饱和/压缩，此文件是锚）。
> **快状态一律读命令不读快照**（manager 2026-08-12：「写命令永不过期，抄本从写下就过期」）——下文快状态都是命令。

## 当前快状态（读命令，不要信任何写在纸上的数字）

```bash
git rev-list --left-right --count develop...integration    # 两线分歧（应为 0/0 或小值）
jq -r '.state + " vc=" + (.verifiedCommit // "?")' .quay/full-suite-state.json   # 当前轮状态
git log --oneline -3 develop                               # develop 头
```

## 慢状态（协议/决策/未决问题——散文，这些不会每 8 分钟变）

- **pre-commit 守卫（priority #1）已派发 inner**：gap-precommit-guard-running-round-rejects-assertion-surface-commits
  （promote ready，Touches 已补具体路径：plugin/scripts/precommit-guard.ts + plugin/scripts/judged-object-registry.json，
  守卫读注册表、缺失/空回退全 tracked 文件 fail-closed）。inner 实现中，fan-in 待验。
- **协议**：round 期间零提交——参与方包括 outer/manager/inner 三层的全部提交（不靠约定靠 pre-commit 守卫机制化）。
  **失效条件**：守卫落地生效。
- **post-merge 派发序列**（inner 依次实现，每个 fan-in 后验）：pre-commit 守卫（进行中）→
  ts-typecheck 闸 → 派发闸盲区 → src:N 指针 → verifiedCommit 门（含相等闸 AC5）→ 并发写 FP → A0b③（含源+副本断言 AC5）。
- **verifiedCommit 相等闸**已并入 gap-suite-start-verifies-target-commit（AC5）——防重复验同一棵树（round 62 实证），不调 IDLE-GREEN 阈值。

## 已完成的弧线（不要再等/再做）

- ✅ **round 59→66 全链**：manager cp 回归（12a6b18b 两次损害）→ c9b9716d + 1d75ac00（副本还原）+
  30de8f94（source sync 反向搬运）→ rounds 61/63/64/65/66 绿 → 多轮 batch-merge 全部落 develop。
- ✅ **收尾**：#61 + mcp + dead-loop + stranded-check 全部 flip done（rounds 63/64/65 认证实现）。
- ✅ **pre-commit 守卫**已 promote ready + 派发 inner（Touches 补路径）。

## 关键机制发现（2026-08-12，已立案）

- pre-commit 守卫（priority #1）：三实证——约定无产物 / 事后难区分 / 参与方不完整（inner 30s/笔，结构性）。
- 同步方向：源与副本关系被搞反时（副本更丰富），单向同步同时做两件事。更正前提须回滚其产物。
- 快状态写命令不写快照（抄本腐烂，与 (src:N) 指针腐烂同族）。

## 已知事项

- 无在效冻结。三项目运行中。
- `undefined`（repo 根 300KB 残留）等未跟踪残留：起跑前快照捕获，不新增即可。
