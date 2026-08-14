---
id: gap-touches-one-entry-one-path
title: Touches「一条目一路径」形态要求——多路径挤一条 bullet 让 disjoint 判据失真（manager 2026-08-14 报，发生率 12）
status: ready
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

**（Touches 多路径 bullet —— manager 2026-08-14 09:0xZ 报；发生率 = 12，且是安全约束失真）**。

**缺陷**：多条任务的 Touches 把两个以上路径挤在同一个 `- ` bullet 里（`A / B / C（说明）`）。`touches-parser.ts` 的 `parseTouchEntriesWithTags` 按行取项（`^[-*]\s+(.+)$`），**整行当成一个 entry** ⇒ `checkTouchesPair` 拿组合串（如 `orchestration/orchestrator-tick-core.md / orchestration/manager-tick-core.md / orchestration/fast-mode-tick-core.md`）与另一任务的单路径（`orchestration/fast-mode-tick-core.md`）做字符串比较 ⇒ **判 disjoint（假）**。

**实测确认（2026-08-14，机器判据）**：AC66 的 Touches 第一条含 `fast-mode-tick-core.md`，但机器解析出的 entry path 是 `"orchestration/orchestrator-tick-core.md / orchestration/manager-tick-core.md / orchestration/fast-mode-tick-core.md"`（一整条）⇒ AC78（touch `orchestration/fast-mode-tick-core.md`）与其 `checkTouchesPair` 判 **disjoint**——**而真值：两者都编辑 `fast-mode-tick-core.md`，握手判重叠**。**若照机器判定派发，AC78 会与 AC66 并行编辑同一文件 ⇒ fan-in 冲突。这次靠手工判对掩盖了；下次没人手判就会真出。**

**一般形态（与目录级 Touches 同族，manager 已并）**：**【声明形态让判据失真】——disjoint 是安全约束不是偏好，它的输入被声明格式坑了。** 发生率：目录级 Touches（AC78 的 `.claude/workflows/`、AC66 的 `plugin/scripts/`）+ 多路径 bullet（本条 12）⇒ 同族 ≥2 形态。

**判据1（一条目一路径）**：Touches bullet 只允许一个路径/glob 条目；含 ` / `（空格-斜杠-空格）的多路径 bullet ⇒ 红。**产物是本来就该维护的 Touches 形态，不是新增打卡。**

**判据2（现有 12 条拆分）**：现有多路径 Touches 任务拆分成一条目一路径。**⚠️ 在飞任务的拆分归其分支**（AC66 在飞——develop 上改会撞 ff-only，同「任务在飞时任务体改动归任务分支」原则）；落地后/或随其分支拆分。

**判据3（能取假，真样本 D2）**：AC66 的三路径 bullet（真实，含 `fast-mode-tick-core.md`）回放 ⇒ 判据1 必须红；拆分后 ⇒ 绿。AC78 ∩ AC66 机器判定由「disjoint（假）」变「overlap（真）」⇒ 阻塞正确。

**判据4**：`checkTouchesPair` 对拆分后的条目返回真 overlap（AC78 ∩ AC66 含 `orchestration/fast-mode-tick-core.md`）。

**不覆盖**：不改 parser 本体（不引入「 / 」分裂——避免路径合法含 ` / ` 的歧义，先走形态要求+拆分）；不改 disjoint 判据本身。

**归属**：outer 立案；inner 实现（checker + 拆分）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 扫全仓 `tasks/*.md` 的 Touches 多路径 bullet（` / ` 模式），列清单（实测约 10 条真多路径 + 2 条正文含 / 的假阳性）。
2. 判据1：checker——Touches bullet 含 ` / ` 的多路径 ⇒ 红（复用 touches-parser.ts 的按行取项；负控制 fixture）。
3. 判据2：现有多路径任务拆分（done 任务可即时拆；在飞 AC66 拆归其分支）。
4. 判据3 能取假：AC66 三路径 bullet 回放红；拆分后绿；AC78∩AC66 机器判 overlap。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：Touches「一条目一路径」检查器落地（含 ` / ` 多路径 bullet ⇒ 红）+ 负控制 fixture。
- [ ] AC2 判据2：现有多路径 Touches 任务拆分（在飞 AC66 的拆分归其分支，不违反 ff-only）。
- [ ] AC3 判据3 能取假：AC66 三路径 bullet 真样本回放红；拆分后绿；AC78∩AC66 机器判 overlap（假 disjoint 被纠正）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] Touches 一条目一路径形态要求落地（checker）+ 现有多路径拆分 + AC78∩AC66 机器判据纠正为 overlap。

## Touches

- plugin/scripts/touches-one-entry-one-path-check.ts (new)（判据1 checker）
- plugin/test/touches-one-entry-one-path-check.test.mjs (new)
- tasks/（现有多路径 Touches 拆分——约 10 条；在飞 AC66 拆归其分支）
- tasks/gap-touches-one-entry-one-path.md（自身）

## Evidence

（落地后回填）
