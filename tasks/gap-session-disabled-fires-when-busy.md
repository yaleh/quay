---
id: gap-session-disabled-fires-when-busy
title: SESSION-DISABLED 在最忙时误报——三合取缺「忙时必假」的直接量，③ cache_read 单调恒真（manager 12:2xZ 报）
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

**（SESSION-DISABLED 复合判据在最忙时误报——manager 2026-08-14 12:2xZ 报，outer 读码确认）**。

**缺陷**：`plugin/scripts/session-liveness.sh` 的 SESSION-DISABLED 发射端三合取：
```bash
_sl_sat_disabled_verdict() {  # 三条件全满足 ⇒ emit，否则 hold
  if [ "$1" = "saturated" ] && [ "$2" = "1" ] && [ "$3" = "1" ]; then echo emit; else echo hold; fi
}
```
三合取 = ①`transcriptContextSaturation`（cache_read ≥ SATURATION_TOKENS=450000 且最后一条未应答） && ②`_sl_develop_silent`（develop 静默 ≥10min） && ③`_sl_worktree_set` 集合无变化。

**实测误报（manager 12:1xZ 事件，12:16Z）**：SESSION-DISABLED 触发，但当时 **5 个 worktree 在飞**、两层主会话 mtime 均 0 分钟前——**最忙的时候响了**。拆三合取：
- **③ `cache_read ≥ 450000` 是硬规则 4 形态**——monotonic、永不回落（manager 的 50MB transcript 早已超，只增）⇒ 对判别力贡献 = 0，**结构上不可能取假**。
- **①② 在「多任务同时实现」时同时翻真**——实现阶段不提交 develop（②真）、不建新 worktree（③真）⇒ **有效判别力实际只剩「develop 静默 ≥10min」一条**，而它恰在最忙时（多个实现子代理在飞）也真。

**判据1**：给 SESSION-DISABLED 复合判据加一条**「忙时必假」的直接量**把「忙」与「失能」分开——manager 建议两条方向：
```
在飞 worktree 内有活进程（忙 ⇒ 该条真 ⇒ 不报 DISABLED）
或 目标会话 transcript 距今 >T 无写入（失能 ⇒ 该条真 ⇒ 报 DISABLED）
```
选哪条由实现者按 direct-quantity 原则裁（外部可核、非自产、能取假）。
**判据2（能取假）**：现状三合取在「多任务实现中」回放 ⇒ 误报 DISABLED（真样本=manager 12:16Z 事件，5 worktree 在飞时响）⇒ 红；修复后同场景 ⇒ 不报（绿）。**且必须有一条【忙时必假】的合取项——验证它能在忙时取假，不是恒真**（硬规则 4：恒真合取项贡献零）。
**判据3**：`session-liveness.test.mjs`（SESSION-DISABLED 复合条件发射端，AC1-AC5）同步更新——AC3 负控制加「多任务实现中不报」用例；新合取项有独立测试（能取假）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿（含 session-liveness 家族）。

**不覆盖**：不改 SESSION-DISABLED 的语义（「饱和且随后指令未被响应」才报）；不改 SATURATION_TOKENS / SATURATION_SILENCE_MIN 阈值（阈值本身不是缺陷）；不引入新的 Monitor/事件。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 session-liveness.sh SESSION-DISABLED 发射端（:520-554）+ session-liveness.test.mjs（AC1-AC5）。
2. 判据1：加「忙时必假」直接量（活进程在 worktree / transcript 无写入）进三合取。
3. 判据2 能取假：manager 12:16Z 场景（多实现在飞）回放不报；单任务实现中不报；真失能（无活进程+静默）仍报。
4. 判据3：session-liveness.test.mjs 补用例。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：SESSION-DISABLED 加「忙时必假」直接量（活进程/transcript 无写入），忙与失能可区分。
- [ ] AC2 判据2 能取假：manager 12:16Z 场景（5 worktree 在飞）回放不报 DISABLED；真失能仍报；新合取项忙时取假。
- [ ] AC3 判据3：session-liveness.test.mjs 补「多实现中不报」负控制 + 新合取项测试。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] SESSION-DISABLED 不再最忙时误报：三合取补「忙时必假」直接量 + 回放 manager 12:16Z 场景绿 + session-liveness 家族测试全绿。

## Touches

- plugin/scripts/session-liveness.sh（SESSION-DISABLED 复合判据加忙时必假直接量）
- plugin/test/session-liveness.test.mjs（补负控制 + 新合取项测试）
- tasks/gap-session-disabled-fires-when-busy.md（自身）

## Evidence

（落地后回填）
