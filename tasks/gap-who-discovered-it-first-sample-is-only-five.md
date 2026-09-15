---
id: gap-who-discovered-it-first-sample-is-only-five
title: 扩大「谁先发现」的样本——把 n=5 的定性观察变成几百例的分布
status: ready
labels:
  - gap
  - analysis
  - methodology
parent: null
children: []
extra: {}
---
## Finding

`docs/references/维度边界与结晶——从熔融实现中发现原则.md` §2.1 ① 给出一条相当强的结论：
「**人是唯一的样本外探测器**」，依据是 `orchestration/FINDING-tool-crystallization-quantified-2026-08-09.md`
的 **5 例中 3 例由人的追问首次揭发**，另 2 例自主循环的主动发现都发生在「正在处理另一件相关
的事、顺手核对」的场合。该文把这条列为「证据充分」，且它被后续多份文档引用为「形变的意图
必须由人供给（OOD 方向）」的支撑（同文 §0 / §3 的两体结构即建立其上）。**但 n=5** ——三例中
任一例换个归类，比例就从 3/5 变成 2/5；这个样本量支撑不起「唯一」。

`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §7 第 6 条把它列进「需要先补
仪器」：任务体里没有「发现路径」字段，要从正文与立案上下文抽取。因此第一步是造抽取途径并
**量出抽取本身的准确率**，第二步才是出占比——一个标注准确率未知的分类器给出的占比，既不能
推翻也不能支持原结论。

分类口径（四类，互斥穷尽）：①人的追问/裁定 ②自主循环的主动巡检 ③测试套件/闸门报红
④其它/判不出。判定依据取任务体的触发描述 + 立案提交的上下文（提交者、同批提交、相邻 tick
记录）。机械规则判不了的部分可用 LLM 标注，但标注方法与抽样复核准确率必须一起公示。

## Touches

- `plugin/scripts/discovery-path-classify.ts`
- `plugin/test/discovery-path-classify.test.mjs`
- `plugin/scripts/capability-catalog.sh`
- `plugin/scripts/task-file-bypass-check.ts`（只读 ratchet：本机件的一次 `git log -- tasks/` 读立案时刻被它按位置判为 LIVE-STORE 读取面，需按其既有 ALLOWLIST 先例登记 reason/expected；⛔ 不改其判据）
- `docs/analysis/who-found-it-first-distribution.md`
- `docs/references/维度边界与结晶——从熔融实现中发现原则.md`
- `tasks/gap-who-discovered-it-first-sample-is-only-five.md`

## Acceptance Criteria

- [ ] `node --experimental-strip-types plugin/scripts/discovery-path-classify.ts --emit-json` 对真实
      `tasks/gap-*.md` 全量输出 `{taskId, class, method, evidenceSpan}`，
      `class ∈ {human, loop-patrol, suite-gate, other}`、`method ∈ {rule, llm}`；判不出时必须落
      `other` 且 `evidenceSpan` 为空，**不得把判不出静默归进任一实质类**。
- [ ] 已分类任务数 ≥ 300（读真实 `tasks/` 目录，不是 fixture），stdout 同时打印四类条数与占比
      以及 `other` 占比。
- [ ] 人工复核 30 条（随机抽样，种子写进文档）：结果文档列出这 30 条的 taskId / 脚本判定 /
      人工判定并报一致率；一致率 <0.7 时不得用该分类给出任何占比结论，只能报「分类器不可用
      + 失败模式」。
- [ ] 文档给出时间趋势：按月（或按 08-11 前后两窗）分组的四类占比，并说明样本量随时间变化对
      趋势解读的限制。
- [ ] 文档明确回答原结论是否被推翻：把本次 human 类占比与原 3/5 并列比较，给出三选一结论
      （支持 / 不支持 / 样本不足以判定）。
- [ ] 若结论为「不支持」，`docs/references/维度边界与结晶——从熔融实现中发现原则.md` §2.1 ①
      的分级从「证据充分」改写为实测支持的档位，并在原处引用本次读数与文档路径；若为「支持」，
      同样回写实测样本量（n=?）取代 n=5 的依据。
- [ ] `bash scripts/test.sh --for-task gap-who-discovered-it-first-sample-is-only-five` 全绿，且
      `plugin/test/discovery-path-classify.test.mjs` 在该轮被实际选中执行（按测试名核对）。

## Definition of Done

占比读数取自**盘上真实任务体与真实 git 历史**，不接受 fixture 或注入数据：关掉测试 fixture 后
`--emit-json` 仍应对 ≥300 条真实任务给出同样的分类分布。一致率是**人工复核的真读数**，不是
脚本自评（脚本给自己打分是结构上不可取假的量）。回写 `维度边界与结晶` 那一步是本任务的交付物
之一，不是可选项——结论若推翻原文，必须当轮回写并在提交信息里点名被改的分级；若样本不足以
判定，也要把「n=5 依据未被扩大验证」写进原文的分级注记。文档与脚本落地 develop，含可复跑锚点
（命令行 + 日期 + develop tip SHA + 抽样种子）。
