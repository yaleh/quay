---
id: gap-fan-in-fix-scope-gate-slice-line-anchor
title: fan-in-execute.js fix-scope gate 切片 lastIndexOf 裸 substring → 行首锚定（inline 提及误切 __PERFILE__）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：inner 上报 clear defect（hub-strip fan-in 阶段实测，独立于 hub-strip 结果）+ manager 授权立案。

**证据（能取假）**：`fan-in-execute.js:276` `const _roundMk = logText.lastIndexOf("__FANIN_SUITE_START__")`——裸 substring 匹配，会命中测试输出里【行内】提及该标记的文本。gap-wiring-B 测试名（suite log 第 12882 行）含 `__FANIN_SUITE_START__` 字样，把 5 条真实 `__PERFILE__ passed=false`（第 4946–11826 行）全部切掉 ⇒ 产出假「checker-misreport」（硬规则 3b：读不懂输入却返回合格同形）。

**⊢ 正确做法已有先例**：`fan-in-execute.js:280` 的 `__PERFILE__` regex 已是 `/^__PERFILE__ ...$/gm` 行首锚定；gap-wiring-B 测试（第 12868 行）已断言「anchored line-start marker」；生产 `parsePerFileLines` 是对的——唯独 workflow prompt 里的 gate inline slice（`lastIndexOf` 裸 substring）是陈旧版。

**为什么 inner 执行**：改 `.claude/workflows/fan-in-execute.js`（fan-in 工作流）属产品/工作流代码 → inner 域。

## Plan

1. 把 `fan-in-execute.js:276` 的 `lastIndexOf("__FANIN_SUITE_START__")` 改为行首锚定（`/^__FANIN_SUITE_START__[^\n]*$/gm` 取最后一个行首匹配，与 gap-wiring-B 断言 + parsePerFileLines 一致）。
2. 负控制验证：含 inline `__FANIN_SUITE_START__` 字样的测试输出不再切掉其后的真实 `__PERFILE__ passed=false` 行。
3. fan-in（AC78 workflow，bootstrap 自举）land。

## Acceptance Criteria

- [ ] AC1：gate slice 改为行首锚定，裸 substring `lastIndexOf("__FANIN_SUITE_START__")` 不再用于切分。
- [ ] AC2（能取假，负控制）：测试名/输出含 inline `__FANIN_SUITE_START__` 字样 ⇒ 真实 `__PERFILE__ passed=false` 行仍被正确分诊（不产出假 checker-misreport）。

## Definition of Done

- [ ] slice 行首锚定 + 负控制通过 + 全量/相关 scoped 绿；AC1-2 全勾；land 到 develop。

## Touches

- .claude/workflows/fan-in-execute.js（fix-scope gate inline slice）
- tasks/gap-fan-in-fix-scope-gate-slice-line-anchor.md（自身）
