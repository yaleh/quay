---
id: gap-suite-lpt-lookback-not-bucket-filtered
title: "LPT 滚动均值不按 bucket 过滤——P 桶轮次 lookback 被 M 桶占满 ⇒ P-only 文件查不到历史值被 `?? 0` 排到末尾（违反 LPT，生产 #595/#599 实证）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/suite-lpt-order.ts` `loadDurationAverages` 从 `verification-round.jsonl` 取「最近 N（默认 3）条带 `perFile` 的记录」算滚动均值时，`perFileRounds.slice(-rounds)` 取的是**全局最近 N 条，不按 `rec.buckets` 过滤**；`orderByLpt` 对查不到历史均值的文件用 `?? 0` 兜底排到序列末尾。

**触发（manager 独立复算，我读码复核确认）**：P 桶轮次 `#599` 的 lookback = `[596(M), 597(M), 598(M)]` 全 M ⇒ `packages/quay/test/*` 这批只属 P 桶的文件在均值表里查不到 ⇒ 当 0 处理 ⇒ 尽管真实耗时 90-260s，仍被排到轮次 35%-65% 处才启动。`#595` 同理（lookback 全 M）；对照 `#583` 正确（lookback 含 full 能查到）。跨 25 条 P 桶生产轮次验证：`violation ⟺ NOT(lookback含P或full)`，零例外。

**与已有任务关系**：`gap-m-bucket-long-tail-lpt-scheduling`（done）AC3/AC4 只在 M 桶场景验证过，从未测「P 桶轮次前置历史被 M 桶占满」的真实生产分布——是今日「AC 缺真实输入探针」族的又一实例（单一 bucket 场景做正例，没覆盖 bucket 轮次交替混合）。`gap-suite-lpt-full-bucket-run-selected`（ready）无关（管 `bucket_full=1` 零 LPT 路径；#595/#599 走已应用 LPT 的 `--buckets` 分支）。

## Plan

改 `loadDurationAverages` 为**逐文件取「该文件自己最近出现 N 次的记录」**（遍历历史直到凑够该 key 的 N 次命中），天然免疫「最近记录恰好不含该文件所属 bucket」；或按 bucket 分别维护滚动均值再合并（落笔方定）。`orderByLpt` 的 `?? 0` 兜底保留（真无历史的文件仍排末尾，那是正确语义）。顺手改 `scripts/test.sh:1401` 日志文案「M bucket reordered」→ bucket-agnostic 文案（该分支对 P/M/P+M 均生效，命名误导排查）。

## Acceptance Criteria

- [ ] AC1（能取假，lookback 跨 bucket 免疫，负控制）：「lookback 最近 N 条全来自另一 bucket」场景下，P-only 文件（真实 duration 90-260s）在均值表里查到非零历史值、不被 `?? 0` 排末尾——**当前实现先复现假**（文件被当 0 排末尾），**修复后转真**（按真实 duration 排）；（⛔ 修复后仍查不到 ⇒ 假）。
- [ ] AC2（能取假，生产回放）：用生产 `verification-round.jsonl` 的 `#599`（buckets=P，lookback=[596,597,598] 全 M）回放——修复后 `packages/quay/test/*` 长文件不再被排到 35%-65% 位置，按 duration 提前；（⛔ 仍被排末尾 ⇒ 假）。
- [ ] AC3（能取假，不回归）：正常/含 full 的 lookback（`#583` 对照：lookback=[580(M),581(M),582(full)]）排序不回归——仍按 duration 降序、ties 保持原序（`a.i-b.i` tiebreaker）；（⛔ 排序退化 ⇒ 假）。

## Definition of Done

`loadDurationAverages` 逐文件最近 N 次（或按 bucket 维护）落地；AC1-AC3 全勾；#599 生产回放 P-only 长文件不再迟到；正常场景排序不回归。

## Touches

- plugin/scripts/suite-lpt-order.ts（loadDurationAverages 逐文件/bucket 过滤）
- plugin/test/suite-lpt-order.test.mjs（lookback 跨 bucket 负控制 + 生产回放）
- scripts/test.sh（:1401 日志文案 bucket-agnostic 顺手改）
- tasks/gap-suite-lpt-lookback-not-bucket-filtered.md（自身）
