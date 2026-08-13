---
id: gap-phase-overlap-two-phase-parallel-exploration
title: 两相重叠探索（serial+lowconc 并行，各 conc=6）——预期 −154s/轮（~−34%）；一键回退 + 前后对照 + basename 归一；等吞吐观察窗口结束再动
status: ready
labels:
  - gap
  - exploration
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**人 2026-08-13 08:5xZ 裁定：方案 A（两相重叠）【可以探索】——探索不是直接实施。**
```
serial 与 lowconc 并行跑，各自仍 conc=6，机器级 12 < 16 核
窗口 177+154=331s → max(177,154)=177s ⇒ 预期 −154s/轮（约 −34%）
前提已核：@test-group 使文件集按构造不相交；test.sh 自记 "independent, read-only, share no state"
```

**🛑 人裁【暂不动】的三项（不立案、不派，证据留 tick-log 08:4xZ，重启直接取用不重测）**：
判决后仍在跑 24.9% / 同 commit 重复验证 21.8% / 轮间空转 30% · develop 被饿死（develop..integration 2→4→5→12）· CPU steal 16%。
理由：AC42-AC53 落地后形态完全不同，现在优化 = 优化一个即将消失的结构。

## 探索约束（manager 2026-08-13，写死——缺任一条不算探索）

1. **时机**：等第二次吞吐观察窗口结束再动（manager 起了一个 ≥30 分钟的只读观察 subagent，正在测当前相调度的基线；在它跑完前改相调度会把它污染成混合体，报告作废）。manager 完成时通知。
2. **一键回退开关**（配置/flag），不是重写调度——探索的定义就是「可能要退回来」。
3. **对照量 = `__OVERHEAD__` 的相耗时**（绿轮的 `serial_phase_ms + lowconc_phase_ms` 之和，前后各 ≥5 轮），**不是整轮墙钟**（红轮污染极重：round 124/125/126 = 526s/559s/1063s，round 126 墙钟与 CPU 双双 2× 成因未知）。
4. **判据跑之前写死，前后对照非绝对阈值**（硬规则4推论：成本结构未知前不设阈值）：
   - 收益侧：serial+lowconc 合计相耗时下降 ≥30%（预期 331→177）。
   - 代价侧：① cancelled 计数不上升 ② load-sensitive 族（real-install，今晚最大失败族 123 条）红率不上升。
   - 任一代价侧上升 ⇒ 立即回退，并把读数记进 tick-log（不是「感觉变差了」）。
5. **一次只上一个变量**——不同时改 `DEFAULT_SERIAL_CONCURRENCY` / `DEFAULT_LOWCONC_CONCURRENCY` 那两个 6。（那两处注释漂移 :1354/:1356 写 "=2 / =3" 而代码是 6——可顺手修注释，不改值。）
6. **basename 归一**：`__PERFILE__` 按 basename 聚合（manager 自捕：按全路径聚合得 1179 个「文件」、真值 ~360——同一测试文件在多个 verify-round worktree 路径下各算一条）。前后对照不归一 ⇒ 可能得出相反结论。
7. **CPU steal 混杂变量控制（manager 2026-08-13 第二次观察报告 + 同日撤回修正）**：宿主级 steal 升至 **48%**（`/proc/stat` jiffies 差分 n=79 中位 48%、mpstat 39%、30 分钟持续；systemd-detect-virt=kvm · 16 vCPU 多租户争抢，本仓代码修不了）。**方案 A 前后对照前各记一次 steal（`/proc/stat` 差分，≥2 工具），若前后 steal 不在同一量级，该次对照作废重做**。**⚠️ 撤回「±500s / 噪声淹没信号」**（manager 2026-08-13 撤：±500s 取自红轮极差、混入已确认污染轮 129 与推断轮 126/128——做对照须用绿轮）：**绿轮真实分布（n=68，按 startedAt 过滤）中位 440s · p10 383 · p90 559 · 极差 621 ⇒ p10–p90 宽 176s ≈ ±88s**。修正后判断：−154s 与自然波动同量级但**更大**；≥5 轮取中位数的标准误 ≈ 176/√5/2 ≈ 39s ⇒ **154s 效应可检出**。steal 列仍须记（p90=559 vs 中位 440，上尾真实存在）——记它是为了分辨「改动没用 vs 被宿主吃掉」，不是因为它淹没信号。
8. **steal 中位数列（manager 2026-08-13 追加，③比上一条更强）**：空闲基线 steal 就有 **24%**（低负载自然实验：三个 5s 窗 24.1/25.0/23.9%，idle≈63%、load1≈3.3、真 runner=1），高负载 48%——**我们负载会【放大】它但不是成因**（与 burst/entitlement 限流形态一致；"credit 耗尽 vs 宿主超卖" 仍未区分，**不得写成已知结论**）。⇒ 前后对照表**除前后各测一点外，再给 ≥5 轮每轮的 steal 中位数加一列**——将来对照失败能分辨「改动没用」还是「被宿主吃掉」。空闲 24% ≫ 首报 16.2%（高约 50%）⇒ 宿主争抢本身在恶化。

## Plan

1. 等吞吐观察窗口结束（manager 通知）→ 落一键回退开关（配置/flag）→ 跑两相重叠。
2. 前后各取 ≥5 绿轮：`serial_phase_ms + lowconc_phase_ms` 合计相耗时（basename 归一）。
3. 对照判据④：收益 ≥30% + 代价侧不升；任一升 ⇒ 回退 + 记读数。
4. 一次上一个变量。

## AC

- [ ] AC1: 一键回退开关落地（配置/flag，非重写调度）
- [ ] AC2: 前后对照——绿轮 serial+lowconc 合计相耗时（basename 归一，各 ≥5 轮）

**降为记录量（人 2026-08-13 裁定「可以放松。suite 耗时的改进我已认可」，覆盖 manager 上一条建议）。**历史说明**：曾要求差值可判（先例 gap-suite-concurrency-4-vs-8-measurement：20–63s 噪声带内 34s 判不可判定；叠加全局轮争抢分辨力更低）——当时为拿可判结论有「排静默窗口 / 明写不可判定」二选一；人认可改进后不再需要可判结论，降为记录量**：贴读数即可，**不要求差值可判**；**不得因「差值落在噪声带内」而判任务不成立**（改进已被人认可，不需测量证明）；**不为此追加轮次**（「各 ≥5 轮」采样量可放宽）。**不删测量**——读数仍贴，只是不再决定任务成败（删掉会让后来的人以为从未测过；降为记录量留下「测过、当时不可判」的痕迹）。**后果（记一次）**：相级耗时回归（某一相变慢）不再有判据能抓到——全轮墙钟仍逐轮记在 verification-round.jsonl，粗粒度回归还看得见，丢的是「哪一相变慢」的归因；人已认可当前改进，这是接受的代价，不需要补偿机制。- [ ] AC3: 判据跑前写死 + 前后对照：收益 ≥30% / 代价侧（cancelled + real-install 红率）不升
- [ ] AC4: 一次一个变量；`:1354/:1356` 注释漂移顺手修（不改值）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 前后对照样例贴出（绿轮 serial+lowconc 相耗时，basename 归一）
- [ ] 全量套件绿

## Touches

- scripts/test.sh（相调度开关）
- plugin/scripts/full-suite-runner.ts（__OVERHEAD__ 相耗时，如需）
- tasks/gap-phase-overlap-two-phase-parallel-exploration.md（自身）
