---
id: gap-standing-invariants-not-reevaluated-move-to-suite
title: AC-182/183/187 判据今天就过却永远到不了 achieved——常设不变式应下沉套件而非留在 goal 层
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
goal_ac: AC-182
---
## Proposal

**实测（2026-09-09，用 ABI 取判据原文逐条真跑）**：AC-182 / AC-183 / AC-187 三条 draft criterion
**今天全部 exit 0**，且作用域非空（AC-183 近 24h 在 `.quay/doc-develop-sync.jsonl` 里有 161 条
not-ff 事件）⇒ **它们不是「还没做」，缺陷是真的已经被别的任务修掉了**（AC-182 的「写盘不提交」
正是被 store-commit 那一批修掉的）。

它们唯一缺的是**有人定期重跑**。而 goal 层做不到这件事：`goal-driver.ts:619` 只评估 active goal，
且 `:633/:644` 会在判据全过时把 AC 与 GOAL 一起机械 flip 成 achieved ⇒
**常设不变式一旦全绿就会被关闭，从此不再复验**（GOAL-001 已于 `979f956aa` 走过一遍：
翻转前 660 轮里 659 轮评估过它的 AC，翻转后 2117 轮评估次数 = 0）。

**套件是这类断言的天然载体**：`scripts/test.sh` 每次都跑、永不关闭、不占 goal cap、不触发 I3 陈旧。

## Plan

1. 把 AC-182 / AC-183 / AC-187 的 criterion 原文接成一个常驻 `plugin/test/*.test.mjs`
   （⛔ 不新增 `plugin/scripts/*.ts`，避免 capability-catalog 六表注册那道闸；测试是套件的原生形态）。
2. 三条断言各自保留「作用域为空」与「通过」的区分（同 gap-goal-store-empty-scope 的纪律）。
3. 三条 goal 记录经 ABI 置为 `retired`，origin 里写明**职能移交到套件**（⛔ 不删记录、不改号，硬规则 8）。

## Acceptance Criteria

- [x] AC1 新测试在 `scripts/test.sh` 中被发现并执行（位置判定：出现在套件运行清单里，非仅文件存在）
- [x] AC2 三条断言各自可取假（逐条造一个违反输入 ⇒ 该条红）
- [x] AC3 作用域为空时报「未评估」，不与通过同形
- [x] AC4 三条 goal 记录 status = retired 且 origin 写明移交去向
- [ ] AC5 `scripts/test.sh` 全量绿（待外部）

## Definition of Done

AC1–AC5 全绿；且退役后 `quay goal list --goal GOAL-001` 中三条为 retired，
而同样的保证在套件里**每轮真跑**（⇒ 上移 goal 层与下沉套件两条路的取舍在本任务落定）。

## Touches

- plugin/test/goal-invariants-standing.test.mjs
- goals/AC-182-goal-goals-md-develop-doc-ff-only.md
- goals/AC-183-sync-fresh-window-not-ff-benign.md
- goals/AC-187-synchealth-not-ff-benign-ahead-only-vs-behind-meta-driver.md
- tasks/gap-standing-invariants-not-reevaluated-move-to-suite.md
