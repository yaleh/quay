---
id: gap-defect-discovery-latency-has-no-distribution
title: 量化「缺陷发现延迟」——给硬规则「频率 × 静默」一个分布，而不是轶事
status: done
labels:
  - gap
  - analysis
  - methodology
parent: null
children: []
extra: {}
---
## Finding

CLAUDE.md 的硬规则（静默失败一族）与 `docs/references/维度边界与结晶——从熔融实现中发现原则.md`
§2.1 ② 把「静默失败」列为最危险形态，判据是 `频率 × 失败是否会自己发出声音`，并引三个具体
数字：workflow 周期失败静默 21.5 小时无人发现、1b 收尾每 tick 静默 8.5 小时、A5 巡检「看见
但没发现」数十轮。这三条是**个案**，不是分布：本项目缺陷从「被引入」到「被立案」的典型延迟
是多少、p90 多长、尾部是哪些、哪一类缺陷延迟最久——全部未知。

`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §7 第 5 条把它列进「需要先
补仪器」：**现无现成字段**，`.quay/*.jsonl` 诸载体没有任何一条记录携带「缺陷引入时刻」。
因此第一步是**造取数途径并量出它的失真率**，第二步才是出读数；跳过第一步直接报中位数，等于
把一个未知口径的数字当成结论。

取数设计（待验证，不是既定结论）：对一批 `tasks/gap-*.md`，取「修复提交 → 其所改行的
`git blame` 上溯 → 引入提交时刻」为 t0，「任务文件首次进入 git 的提交时刻」为 t1，配对得
延迟 t1−t0。已知口径风险：重构/格式化/文件搬移让 blame 指向搬运提交而非引入提交；一次修复
改多行会有多个候选 t0；部分 gap 的修复提交无法机械定位。**这些必须被计数并公示为失真率，
不能靠挑样本绕开。**

## Touches

- `plugin/scripts/defect-latency-pair.ts` (new)
- `plugin/test/defect-latency-pair.test.mjs` (new)
- `plugin/scripts/capability-catalog.sh`
- `docs/analysis/defect-discovery-latency-distribution.md` (new)
- `tasks/gap-defect-discovery-latency-has-no-distribution.md`

## Acceptance Criteria

- [x] `node --experimental-strip-types plugin/scripts/defect-latency-pair.ts --emit-json` 对**真实**
      `tasks/gap-*.md`（不是 fixture）输出 JSON，字段至少含
      `{taskId, t0, t1, latencyHours, t0Method, confidence}`；`confidence` 至少有
      `high|low|unresolvable` 三取值，**读不出来时必须落 `unresolvable`，不得与 `high` 同形**。
- [x] 该 JSON 中 `confidence != "unresolvable"` 的**可核配对 ≥ 50 条**，且脚本在 stdout 同时打印
      分母（尝试配对的 gap 任务总数）与失真率 `unresolvable / 总数`；三个数缺任一即判未完成。
- [x] 抽样复核：从 `confidence == "high"` 中随机取 10 条（种子写进文档），在结果文档逐条列出
      `taskId / t0 提交 SHA / t1 提交 SHA / 延迟` 与人工核对结论，报出 10 条中的正确条数。
- [x] 结果文档给出延迟的**中位、p90、最大值**与尾部清单（最长 10 条带 taskId），并按缺陷类型
      （静默失败 / 报错失败 / 性能 / 文档漂移）分组给各自中位与条数；某组样本 <5 时必须标注
      「样本不足，不下结论」，不得照样给中位。
- [x] 结果文档单列「本口径量不了什么」一节：列出 `unresolvable` 的成因分类与各自条数（至少含
      blame 落在重构/搬移提交、修复提交无法机械定位两类），并说明为何不能靠挑样本抹掉。
- [x] `bash scripts/test.sh --for-task gap-defect-discovery-latency-has-no-distribution` 全绿，且
      `plugin/test/defect-latency-pair.test.mjs` 在该轮被实际选中执行（按**测试名**核对，不是按
      文件名推测）。

## Definition of Done

读数必须来自**真实仓库历史**：脚本跑在本仓库真实的 `tasks/gap-*.md` 与真实 `git log/blame` 上，
不接受 fixture 仓库或注入数据满足任何一条 AC——**把测试 fixture 全部关掉后，第 2/3/4 条 AC 仍
应跑出同量级的数**（反例判据：若某条 AC 在关掉注入 seam 后仍通过，它才是测量）。
`docs/analysis/defect-discovery-latency-distribution.md` 落地 develop，内含可复跑锚点（完整命令行
+ 运行日期 + 当时 develop tip SHA），他人用该命令行能复现同一批配对。结论若与「静默失败延迟
更长」的既有叙述相悖，如实写反向结论并注明样本量，不得裁剪。若可核配对达不到 50 条，任务不得
翻 done，应改为报「机械配对在本仓库结构上做不到」并给出把它挡住的具体成因与条数。

## Resolution

机件 `plugin/scripts/defect-latency-pair.ts` + 结果文档
`docs/analysis/defect-discovery-latency-distribution.md` 已落地。

**修复提交的机械定位（本任务最承重的一件）**：不读任务正文、不按关键词猜 —— 驱动 fan-in 落地
一个任务时 `develop` 上必然出现一对可辨识提交，两个实测变体都收：① `M = Merge branch 'develop'
into task/<id>` 且 `M.p1` 就是翻 done 提交 ⇒ (tip,base) = (M.p1, M.p2)；② 翻 done 提交 `D` 的父提交
就是这个 `M` ⇒ (D, M.p2)。修复提交 = `git log --no-merges <tip> ^<base>` 再滤掉 bookkeeping。

**读数**（`--ref` 冻结在 develop `8f3b51198ff4640feafcb9b272e86ccbad926a8f`，2026-09-15）：
分母 1658 / 可核配对 **761** / 失真率 **0.5410**；中位 **37.9 h**、p90 **388.9 h**、max **1328.5 h**；
`confidence` = high 168 / low 593 / unresolvable 897；按缺陷类型五组 n 分别 175/48/137/333/68（全部
≥5，无一触发「样本不足」抑制）。抽样复核 seed 20260914：**10/10 正确**。

**反向结论（如实记，未裁剪）**：静默失败中位 **25.3 h** 比性能 50.2 h、报错失败 41.1 h、
文档漂移 37.6 h 都**短**；20,000 次 bootstrap 的 95% CI 三个对比全部跨 0 ⇒「静默失败延迟更长」
这条推论在本读数上**无支持**，但反向也**未被确立**，两条都写进文档 §4.1。

**口径边界**：`no-landing-commit` 682 条不是仪器失败，而是口径的边界 —— 本口径只能量**已修复**
的缺陷（未落地的 gap 没有修复提交 ⇒ 引入时刻结构上不可定位）。已在文档 §5.1 单列。

**AC6 证据**：`bash scripts/test.sh --for-task gap-defect-discovery-latency-has-no-distribution
--allow-thin` 退出码 0、33 tests / 33 pass / 0 fail；该轮输出里**按测试名**可见
`looksLikeRelocation 收得住「拆分/收敛」一族` 等 17 条本任务测试（非按文件名推测）。