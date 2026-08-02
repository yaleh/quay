# 开发会话交接 (2) — 批次 1 收尾三项

**来源：** 编排会话对批次 1 的独立核查
**前一份：** `docs/analysis/dev-session-handoff-2026-08-02.md`

---

## 先说做对的

批次 1 全部完成，而且**采纳了并发建议**——1.4/1.5/1.6 都走 `Merge … — subagent implementation`，各自 subagent 实现后合并。这正是要的模式。

**AC 纪律已纠正**（上一份 handoff 的第 3.2 条）：

| 任务 | 上轮 | 本轮 |
|---|---|---|
| gap-green-test-baseline | 0/15 | **12/15** |
| gap-task-status-closeout-not-mechanized | 0/10 | **7/10** |
| gap-extract-mechanism-claims-calibration | 0/12 | **8/12** |
| DIR-124-A4 | — | **11/11** |

反向漂移检测已实现，`no-size-aware-routing-A` 状态已正确恢复为 `todo`。这两条都是上一份 handoff 点名的，都做到了。

---

## 需要纠正的一个模式（比单个 bug 重要）

三次了：

| 次序 | 交付的检测机制 | 它发现的真实问题 | 处置 |
|---|---|---|---|
| 1 | size-estimate RED 测试 | 任务 `done` 但代码从未落地 | **静音**（改成 self-skip） |
| 2 | golden replay phase-sequence 哨兵 | phase 序列被 M238 改动 | 曾被当作「预存失败」忽略（我也有责任） |
| 3 | `workflow-metadata-conformance` clause-14 | 6 个真实 metadata drift FAIL | **降级为 advisory** |

第 3 次的判断本身**是对的**——blocking clause 会让每个 milestone 的 DoD 门禁失败，commit message 也把理由写清楚了，比第 1 次的静音好得多。

但结果相同：**造了检测器，它正确报警，警报没人处理，机制不生效。**

要建立的习惯：**检测机制交付时，它发现的问题要么当场修，要么立刻建任务。降级/跳过只在两者都不可行时用，且必须同时建任务。**

---

## 收尾三项

### 1. 修 metadata drift，恢复 clause-14 为 blocking ⭐ 最优先

`plugin/scripts/workflow-metadata-conformance.mjs` 当前报 **6 个 FAIL**（3 类 × 2 镜像），全部是真实 drift：

```
execute-milestone.js（.claude/ 和 plugin/ 两个镜像）：
  1. phase 'Build-Evidence' 在 body（line 573）但不在 meta.phases  —— M238 加的
  2. meta.description 声称 outcome 'building'，但 body 无任何 return site 产生它
  3. body 返回 'revision-needed'，但 meta.description 未声明
```

都是改 `meta` 块的小改动。做完后：

- 把 `it0-dod-check.ts` 的 clause-14 从 advisory 恢复为 **blocking**（`82888ba7` 的反向操作）
- 验证 `workflow-metadata-conformance.mjs` 退出 0
- 验证 `it0-dod-check` 仍全绿

**WARN 级别的项（worktree 118 处引用未在 meta 提及、cache/resume 未提及、re-entrant phase 未标注）不在本次范围**——它们是 metadata 省略而非虚假声明。若你判断值得修，单独建任务，不要顺手扩大范围。

### 2. 补 `DIR-124-F-plancheck` 的 AC

本轮唯一 AC 0/8 的任务。逐条核对实现，勾选；勾不上的说明理由或把 status 改回 `ready`。

### 3. 关闭 7 个 `status-drift-suspect`

`plugin/scripts/task-status-drift-check.ts` 当前报：

```
DIR-103-C (ready, 4/4)
DIR-119-D2 (ready, 1/1)
DIR-119-D3 (ready, 9/10)
DIR-119-D4 (ready, 2/3)
gap-planauthor-shape-rules-not-injected (ready, 2/2)
gap-prepare-milestone-epoch-scope-change-grants-full-review (ready, 9/10)
gap-prepare-milestone-no-worktree-isolation (ready, 11/12)
```

逐个读代码确认，然后：

- 全部 AC 已由测试证明 → `done`（并勾 AC）
- 某条 AC 要求真实 dispatch 验证 → 保持 `ready`，**在任务体里写明还差什么**，这样它下次不会再被报为 suspect 而无人知道原因
- 代码其实没落地（假阳性）→ 保持原状，并在任务体记录为什么检测器误报（这是检测器的校准输入）

不要批量改状态——每个都要有读代码的依据。

---

## 保持的开发纪律（不变）

1. **读真实代码，不信任务体** —— 任务体可能与代码矛盾，已有多个实例
2. **RED/GREEN**，实现前先写测试
3. **独立子代理对抗审查**，要它反驳而非确认；它必须自己跑测试
4. **镜像字节一致**，`cmp -s A B` 验证
5. **任务内跑局部测试**，全量只在合并前跑一次（全量约 600s，跑两次就吃掉 1/3 的单任务预算）
6. **新增导出函数必须有生产调用点**，否则任务不算完成
7. **标 done 前逐条勾 AC**，勾不上就说明理由或改回 `ready`
8. **发现异常必须处置**——修，或建任务。不要静音、不要降级后就走
9. 每个任务独立提交，commit message 说明：改了什么机制、测试证据、镜像已同步、任务状态改成了什么

---

## 完成后

这三项完成后停下来报告，不要自动进入下一批次。下一批次（计量 → 测试选择 → 套件提速）已经建好任务，但要等确认。

三项都是小改，预计合计 30–40 分钟。若某一项展开后发现远超预期，停下来说明，不要硬做。
