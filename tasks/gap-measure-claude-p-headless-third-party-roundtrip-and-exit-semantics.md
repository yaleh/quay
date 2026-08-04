---
id: gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics
title: claude -p headless mode has two unknowns official docs cannot answer —
  third-party-endpoint round-trip (gating) and stdin-open exit semantics — that
  decide whether the two-layer loop can migrate off tmux
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  depends_on: gap-adr-016-alternatives-rejected-one-shot-claim-is-factually-wrong
---

**type:** execution

## Proposal

管理者交办（依据 `orchestration/RESEARCH-claude-p-streaming-2026-08-04.md`，人指定方向的调研）。

调研已回答了官方文档能答的部分（Monitor 不可用 / cron 会话作用域 / 后台进程被杀 / 会话在 stdin
打开期间存活）。**剩下两个文档答不了的未知**，本任务**只**实测这两个——不是「查可用性」（已答完）。

### 未知 A（gating，决定整个方向生死）：第三方端点在 `-p` headless 下能否往返

官方文档**完全没有提及**第三方 Anthropic 兼容端点（DeepSeek 经 `ANTHROPIC_BASE_URL`）在 headless
模式下的支持——`headless.md`/`cli-reference.md` 都没写；只文档化了 Bedrock/Vertex/Foundry。
这是**文档空白，不是「已记载为不支持」**。**不能用则整个计划作废——这条必须先测。**

### 未知 B（决定「移植」还是「重新设计」）：stdin 保持打开时，退出语义是否改变

`headless.md` 原文：final result 返回**且 stdin 已关闭**之后才杀后台——两个条件并列。

- stdin 不关就不退出 ⇒ 现有并发派发模型（3 个在飞 subagent，跨小时）可**原样保留**（移植）
- 照退 ⇒ 内层并发必须改成「驱动进程起 N 个独立 `-p` 进程」（重新设计）

### ⚠️ 实钱风险（做任何实验前必读，写进 DoD）

`-p` 模式**只认 API key，不认 Pro/Max 订阅**。调研查到 **Max 订阅用户被无意导向 API 计费、产生
大额账单**的案例。**任何 `-p` 实验必须用 `claude-deepseek` 这类自带 key 的 launcher**，
**绝不能在 Anthropic 订阅态下裸跑 `claude -p`**。本任务不在管理者（Max）会话上做实验。

### 依赖关系

**AC1 不过则 AC2 不必做**（依赖写死）：AC1 证明不了第三方端点能往返，AC2 的退出语义就没有意义。

## Acceptance Criteria

- [ ] AC1（**gating**）: 用 `claude-deepseek -p`（自带 deepseek key 的 launcher）发一句话，经
      `ANTHROPIC_BASE_URL` 指向第三方端点，确认 headless 下**能往返**（stdout 收到模型回复）。
      **负控制**：同一条命令在 **key 缺失/未设置**的环境下运行**必须失败**——否则证明不了 key
      真的被用上了
- [ ] AC2（**仅在 AC1 过时做**）: stdin 保持打开 + 起一个后台 subagent；subagent 完成后，判
      `-p` 进程**是否仍存活**（判据是 `ps` 的进程存活，**不是日志文本**）。存活 ⇒ 现有并发模型可
      移植；退出 ⇒ 需重新设计
- [ ] AC3: 实验环境隔离——只在 scratch 环境（非 quay 开发树、非任何在飞 worktree）跑；
      **全程用 `claude-deepseek`，不用裸 `claude -p`**（订阅态实钱风险）
- [ ] AC4: 结果回写——把实测输出（往返回复 + 负控制失败输出；AC2 的进程存活/退出证据）逐字贴进
      本任务体，并在 `orchestration/RESEARCH-claude-p-streaming-2026-08-04.md` 第 3 节两条未知
      下补实测结论（若 AC1 失败：记录失败，跳过 AC2，标注「gating 未过」）

## Definition of Done

- [ ] AC1–AC4 全部勾上（AC1 失败则只勾 AC1/AC3/AC4，AC2 记「未做：AC1 未过」）
- [ ] AC1 的往返 + 负控制输出、AC2 的进程存活/退出证据逐字贴进本任务体
- [ ] 不产生任何账单——全程 `claude-deepseek`，无裸 `claude -p`

## Touches

- （本任务不改产品代码——纯实测）
- orchestration/RESEARCH-claude-p-streaming-2026-08-04.md（AC4 结果回写，改此文件）

## Contract

measure   roundtrip_ok = `claude-deepseek -p '回复 OK 即可'` stdout 的行数字段
band      roundtrip_ok = ≥1（收到模型回复即过；空输出 = 不过）
invariant launcher_is_deepseek = 1（命令必须是 claude-deepseek，含自带 key；裸 claude -p 即违规）
invoke    `claude-deepseek -p '回复 OK 即可'`
control   `env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY claude-deepseek -p '回复 OK'` ⇒ 必须失败（AC1 负控制）
resume    每步实测即贴任务体，中断从缺口续跑

## Dispatch review

reviewer: outer
at: 2026-08-04T15:5xZ
changed: 外层受管理者交办立案。四处收紧：
(1) **窄实测，只验两个未知**——不是「查可用性」（调研 §6 已答完）；AC1/AC2 之外无扩充；
(2) **AC1 gating 先行的依赖写死**——不过则 AC2 不做，避免在无意义的退出语义上花时间；
(3) **AC2 判据是进程存活不是日志**——调研 §3B 原文明确，日志文本会说谎（这也是 D 任务那族教训）；
(4) **实钱风险进 DoD 而非仅注释**——`claude-deepseek` 是硬性 invariant，裸 `claude -p` 即违规。
status: todo——排在 ADR-016 二次 Amendment（`gap-adr-016-alternatives-rejected-...`）之后，
因为本任务的结论要写进那次的理由修正；且需安全窗口（纯 scratch 实测，不碰在飞循环）。
