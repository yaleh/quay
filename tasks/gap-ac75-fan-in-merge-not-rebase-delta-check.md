---
id: gap-ac75-fan-in-merge-not-rebase-delta-check
title: AC75 fan-in 无锁段第1步 rebase→merge + 新增 delta 断言面判定（人 07:0xZ 裁定）
status: todo
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

**AC75（fan-in 无锁段 rebase→merge + delta 断言面判定 —— 人 2026-08-14 07:0xZ 逐字「既然 develop 的变更很少，那么应该优先做 merge 而不是 rebase，而且应判断 develop 的变更是否需要再次跑 suite 测试」）**。

**判据是【重验成本】，不是历史形态（manager ②）**：
```
rebase   分支每个 commit 被重写 ⇒ 整条分支成"新组合" ⇒ 之前跑绿的结果【全部作废】⇒ 只能无条件重跑全量 suite（~390s）
merge    分支 commit 原样保留，只多一个 merge commit ⇒ 【新的只有那个 delta】⇒ 可以问「这个 delta 碰没碰断言面」⇒ 多数情况【不需要重跑】
```
**而 develop 的 delta 恰恰小且多为非代码**（构成：`tasks/` 58 · `manager:` 28 · `telemetry` 15 · `docs` 6 · `core` 6 · `inner` 5 · `fix` 4 · `test` 3 · `gitignore` 2）⇒ **绝大多数根本不触及套件断言面。**

**SPEC §7 活锁账随之翻转**：ff 失败**频率**不变（develop 前进快），但**每次失败代价从「必然 ~390s」降为「多数情况秒级」**——§7b「重试代价必须按整段算」只在 rebase 路径下成立（manager 已在 SPEC 标注）。

**manager 自记的错（④，写进 SPEC §1b）**：查「实现 rebase 11 次 / SPEC 写 merge 0 次」就以「实现为准」把 SPEC 改成 rebase——**把「实现在做什么」当成了「什么是对的」，没问哪个更好**；而 SPEC §3 自己就论证过 merge 路径（「第 1 步之后分支 tip 是以 develop@Y 为父的 merge commit ⇒ ff 成立」）⇒ **改掉的是一份自洽设计，去迁就一份没人审过的实现**。**判据：发现 SPEC 与实现分歧时先问【哪个更好】，不得默认以实现为准——分歧只说明有一处没被判据读到（AC73 族）。**

**AC67 判据2 已达成（manager ⑦，第一条真实 ff 重试记录）**：
```
{"taskId":"gap-ac67-…","attempt":1,"developHead":"24bcad50…","ts":"2026-08-14T06:38:45Z",
 "runId":"fm-gap-ac67-…","agentId":"aab2d14d10a762ff4","mergeTarget":"develop",
 "error":"hint: Diverging branches can't be fast-forwarded…"}
agentId aab2d14d 对应 bc1a438b/subagents/agent-aab2d14d10a762ff4.jsonl = 【subagent，非主会话】⇒ 执行者确已搬进 subagent
锁事件 acquire/release 同一秒、同 pid、同 runId ⇒ 持锁 0 秒（SPEC §2 毫秒级）✓
```

**判据（manager ⑥，实现面三处）**：
- **判据1（无锁段第 1 步 rebase→merge）**：`fast-mode-tick-core.md` A6 无锁段第 1 步 + `fan-in-ff-merge.sh` 重试路径文案——rebase 改 merge（inner 现行 11 次全是 rebase）。
- **判据2（新增 delta 断言面判定，fail-closed）**：无锁段第 2 步——merge 后判断「这次 develop delta 要不要重跑 suite」：看 delta 是否触及断言面（复用 AC51 的 doc/代码分类）；判不出 ⇒ **fail-closed 重跑**（硬规则 3b：判不出必须与不需要有不同取值）；不设阈值（硬规则 4）。
- **判据3（能取假）**：回放「纯 doc 却重跑」或「含代码却跳过」必须红——D2 真样本。
- **判据4（AC67 判据2 达成留档）**：第一条真实重试记录（五字段 + agentId + mergeTarget + error）作为 AC67 判据2 证据，已核 agentId=subagent。

**⚠️ 时点（manager ⑥）**：**AC67 正在飞、其 subagent 正在实现 fan-in 四件**——判据1/2 越早并入越好，晚了又是「已按旧判据交付」（与 AC6 那次同形）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SPEC §1/§1b/§1c（manager 已改 078fb93a）+ A6 无锁段第 1/2 步 + fan-in-ff-merge.sh 重试路径。
2. 判据1：A6 第 1 步 rebase→merge（C17 外层落盘 + inner 分支内改调用形态）。
3. 判据2：新增第 2 步 delta 断言面判定（复用 AC51 doc/代码分类）+ fail-closed。
4. 判据3：能取假——纯 doc 却重跑 / 含代码却跳过 必须红（D2）。
5. 判据4：AC67 第一条重试记录留档作判据2 证据。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：A6 无锁段第 1 步 rebase→merge（实现 + SPEC 一致）。
- [ ] AC2 判据2：新增 delta 断言面判定（复用 AC51 分类）+ fail-closed（判不出=重跑，硬规则 3b）；不设阈值。
- [ ] AC3 判据3 能取假：纯 doc 却重跑 / 含代码却跳过 回放必须红（D2 真样本）。
- [ ] AC4 判据4：AC67 第一条重试记录（五字段 + agentId=subagent + 锁毫秒级）留档作判据2 证据。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 无锁段 rebase→merge + delta 断言面判定（fail-closed）+ 重试路径文案更新 + AC67 判据2 证据留档。

## Touches

- orchestration/fast-mode-tick-core.md（A6 无锁段第 1 步 rebase→merge + 第 2 步 delta 判定——C17 外层落盘）
- plugin/loop/fast-mode-tick-core.md（A6 双副本同改——AC73 判据4）
- plugin/scripts/fan-in-ff-merge.sh（重试路径文案：rebase→merge + delta 判定说明）
- plugin/scripts/fan-in-ff-executor-check.ts（新检查器/判据——rebase 检出 + delta 判定 fail-closed + 真样本回放）
- plugin/test/fan-in-ff-executor-check.test.mjs（负控制 fixture）
- tasks/gap-ac75-fan-in-merge-not-rebase-delta-check.md（自身）

## Evidence

（落地后回填）
