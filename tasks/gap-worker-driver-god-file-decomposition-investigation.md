---
id: gap-worker-driver-god-file-decomposition-investigation
title: worker-driver.ts（4435 行/140 导出，全仓最大杂物袋，仍在长）——先做消费者分组调查、产出可执行拆分方案，不直接动手拆
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

`docs/proposals/archguard-generation-era-primitives.md` §2.2 报出 `worker-driver.ts` 是全仓"最大
杂物袋"：文档测量时 4 364 行 / 135 个导出（每 42 行一个导出）；§2.8 R10 额外指出它是全组**唯一**
一个既被广泛消费又广泛消费别人的实体（入度 19 / 出度 24，"双向缠结"）。

**本次立案时现场重新测量：`wc -l` = 4435 行，`grep -c "^export "` = 140 个导出**——比文档测量时
又长了 71 行、5 个导出，验证了 §2.7"只有一边在施工"的判断（机制层持续沉积，产品层几乎不动）。

这个文件同时也是本批任务里 A1（`write_state_file`/CONFLICT 分支）与 A2（`trace()`/`appendFanInTrace`
写手分裂）两个真实 bug 的载体——**两个独立缺陷恰好都落在这同一个文件的不同区域**，是"改同一个巨型
文件的不同角落"这种耦合风险的一个具体佐证，不是巧合推断。

**本任务不直接动手拆分**——140 个导出里哪些真的互相纠缠（共享闭包私有状态、彼此调用）、哪些是
可以安全外移的独立单元，在没有先做过消费者分组调查之前无法判断；文档 §2.8 R10 描述的"双向缠结"
提示拆分风险可能不低。本任务的产出是一份**可执行的调查结论**（拆分方案，或"不该拆"的具体证据），
供后续任务直接引用作为其 Proposal 依据，而不是这次就动代码。

## AC

- [ ] AC1：现场重新核实 `worker-driver.ts` 的行数与导出数（`wc -l` + `grep -c "^export "`），作为
      调查基线，贴出真实命令与输出
- [ ] AC2：用 archguard（`get_dependents`/`find_callers`，或等价的仓库内 grep）对全部 140 个导出
      逐一列出"被哪些外部文件消费"，产出一张表：导出名 → 消费者文件集合 → 该导出所属的功能区域
      （如"suite 决策"/"CONFLICT 与 state 记账"/"trace 写手"/"fan-in 锁"等——初步分区可参考本批
      A1/A2 两个 bug 涉及的区域作为起点，但不应假设分区已经完备）
- [ ] AC3：识别互相纠缠的导出组（在同一函数体内互相调用、共享模块级私有状态的导出集合），与真正
      独立、可安全外移到单独文件的导出组分开列出——两类都要有具体依据（贴出调用关系或共享变量名），
      不能是"看起来相关"这种无法验证的归类
- [ ] AC4：基于 AC2/AC3，产出至少一个具体、可执行的拆分方案：候选子模块清单、各自包含哪些导出、
      模块间依赖关系、每个候选子模块的行数估计
- [ ] AC5（反向判据）：若调查结论是"当前不值得拆"（例如导出高度纠缠、拆分收益低于引入的耦合面
      风险），必须给出可检验的具体证据支持这个结论（如纠缠导出占比、共享状态的具体清单），不能
      是"看起来复杂所以不拆"这种无法证伪的结论——无论结论是哪种，都必须可被下一个读者独立核实

## DoD

AC2 的完整消费者分组表、AC3 的纠缠对清单、AC4 的拆分方案（或 AC5 的"不拆"证据）落盘为
`docs/analysis/worker-driver-decomposition-investigation.md`，内容详尽到足以让后续任务直接把它
当作 Proposal 依据使用而无需重新调查。本任务不修改 `worker-driver.ts` 本身。

## Touches

- docs/analysis/worker-driver-decomposition-investigation.md（新增，调查产物）
- tasks/gap-worker-driver-god-file-decomposition-investigation.md
