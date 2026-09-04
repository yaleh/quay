---
id: gap-meta-cc-include-subagents-content-search-ineffective
title: meta-cc `include_subagents=true` 对内容搜索无效——只搜主会话自身（实证三针测），参数名误导（硬规则 3b 形态）
status: superseded
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 实证发现（人裁定 outer 处理）。

**实证（三针测，非引用旧结论）**：一个只在某 subagent transcript（`agent-ae473dc634b1b8c0f.jsonl`，79 行，
2026-08-16T05:00-05:06Z）里出现的短语：
```
grep 直接确认：该文件真实存在这段内容
query_session_content(role=all, contains=<针>, session_id=<主会话>, include_subagents=true)
  → 返回 21 条命中
逐条核对这 21 条的 uuid：全部能在【主会话自己的 jsonl】里 grep 到
反向核对：这些 uuid 一条都不在那个 subagent 文件里出现
```
**⇒ `include_subagents=true` 对内容搜索无实际效果**——只搜主会话自身 transcript，一步没进 `subagents/*.jsonl`。
命中的 21 条是主会话后续讨论里也提过同一段，不是 meta-cc 真读到了子会话文件。

**配套**：`inspect_session_files` 传显式路径能正确读元数据（size/line_count/record_types/time_range），
但只给元数据，不能做内容搜索。**⇒ 现状：能列出子会话文件存在、能对已知路径读元数据，但没有任何机制能
对子会话/workflow 内容做搜索**——`include_subagents=true` 参数名会让人误以为它管用，是「比没有该功能
更贵的形态」（硬规则 3b，CLAUDE.md 已记录的同类模式）。

**与 AC88 关联**：B/C 测试项目 tasks/ 空——本分析用作其首个种子任务（真实、安全只读、有价值）。

## Plan

1. 改进建议二选一（meta-cc 侧）：
   - ① 让 `include_subagents=true` 真正生效：为真时把 `<session>/subagents/*.jsonl` 和
     `<session>/subagents/workflows/**/*.jsonl` 也纳入内容搜索范围。
   - ② 退而求其次：给 `query_session_content` 加「对显式文件列表做内容搜索」能力
     （`inspect_session_files` 已接受显式路径但只给元数据）——先 find 枚举子会话/workflow 文件，
     再对显式路径做 pattern/contains 搜索，不用手工 grep。
2. 判据能取假：修后用三针测重验——针只在子会话文件的短语，`query_session_content` 必须能搜到它
   （现为 0）。

## Acceptance Criteria

- [ ] AC1: 三针测重验——只在子会话文件的针，include_subagents=true 后内容搜索能命中（现为 0）。
- [ ] AC2: 改进建议①或②落地其一（meta-cc 侧），文档同步。
- [ ] AC3: 「include_subagents 参数名误导」的形态消除——参数生效或明确标注其限制。

## Definition of Done

- [ ] meta-cc 能对子会话/workflow 内容做搜索（或明确文档化限制），三针测重验通过。

## Touches

- meta-cc 侧（query_session_content / inspect_session_files 实现——归 meta-cc 仓库）
- tasks/gap-meta-cc-include-subagents-content-search-ineffective.md（自身）

## Routing（2026-08-16 15:4xZ）

**状态：needs-human**。inner 判不可派：Touches 全在 meta-cc 仓库（query_session_content / inspect_session_files
实现），quay worktree 内无对应文件可实现（建 worktree 只是空壳）。meta-cc 是 marketplace MCP 服务器
（owner 维护），无 quay 侧实现路径。**需人决定**：①在 meta-cc 自身项目立案实施，或 ②由 owner 直接改 meta-cc
（本任务只作需求/复现载体）。⛔ 不在 quay 快模式池内派发。

## Superseded

**人 2026-08-16 15:5xZ 裁定**：本任务取消——不是 quay 项目的任务（Touches 全在 meta-cc 仓库，
quay 侧无实现面可动）。原分析内容有效，执行体归 owner 另行在 meta-cc 项目处理，不在 quay 任务池挂等。
