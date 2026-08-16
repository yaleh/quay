---
id: gap-touches-connector-delimiter-uncaught
title: Touches 连接符 '+' 未被一条目一路径检查器捕获 + 检查器未接线（AC93/ac86/AC91 三次 anti-drift HARD
  FAIL 根因）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
---
id: gap-touches-connector-delimiter-uncaught
title: "Touches 连接符 '+' 未被一条目一路径检查器捕获 + 检查器未接线（AC93/ac86/AC91 三次 anti-drift HARD FAIL 根因）"
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

**判据正本（直接引用，勿转述）**：无独立 manager-phase-goal 段——本任务由 inner 2026-08-16 立案，源证 = 三次同形 fan-in HARD FAIL。

**实测（三次同形，2026-08-16）**：
```
AC93：Touches bullet 用 " / " 连接 7 路径 ⇒ parseTouches 读成单一 glob ⇒ anti-drift HARD FAIL
ac86：Touches bullet 用 " + " 连接 scripts/test.sh 与 plugin/scripts/* ⇒ 同上
AC91：Touches 两处 " + " 连接（2 文件 + 5 文件）⇒ 同上
```
**根因（已实读代码，非猜测）**：
1. `plugin/scripts/touches-one-entry-one-path-check.ts:73` `MULTI_PATH_SEPARATOR_RE = / \/ |、|，|,/` —— **缺 ` + `（space-plus-space）分隔符**，所以 `+` 连接的多路径 bullet 不被判为「一条目多路径」。
2. **该检查器从未接线**——`scripts/test.sh` 的 run_static_checks / scoped tier 里 grep 不到 `touches-one-entry-one-path` 引用 ⇒ 是孤儿检查器（只有测试文件 `plugin/test/touches-one-entry-one-path-check.test.mjs`，从未被执行）。这是硬规则⑨「可见性≠执行」+ 硬规则②「按位置判定」的教科书实例：检查器存在（可见）、有测试，但从未进套件（不可执行）。
3. `plugin/scripts/touches-parser.ts` `parseTouchEntries` 按行拆 bullet、不拆任何连接符 ⇒ 连接符 bullet 整串当一个 entry。

**⇒ 修法（外层 2026-08-16 裁定：①根治 + ②防再犯两者都做，归实现者判断）**：
- **②护栏（最小侵入，先做）**：`MULTI_PATH_SEPARATOR_RE` 补 ` + ` 分隔符；**把 `touches-one-entry-one-path-check.ts` 接进 `scripts/test.sh` 的 run_static_checks**（每轮执行）。
- **①根治（可选，实现者判断）**：`parseTouchEntries` 是否应拆连接符（` + ` / ` / `）——**⚠️ 需谨慎**：parseTouchEntries 是 ONE parser，多处依赖（dispatch/touches-resolve/orthogonality），拆它改变语义可能影响现有逻辑。若拆，必须有测试覆盖 + 负控制；若判断风险大于收益，可只做②，并在任务体记录「①不做」的理由。

## Plan

1. `plugin/scripts/touches-one-entry-one-path-check.ts` `MULTI_PATH_SEPARATOR_RE` 补 ` + `（space-plus-space）。
2. 接线 `touches-one-entry-one-path-check` 进 `scripts/test.sh` run_static_checks（确认正确的 wrapper 调用方式——看 `run_checker` 用法）。
3. （可选）评估 `parseTouchEntries` 是否拆连接符——拆则加测试 + 负控制；不拆则记录理由。
4. **负控制**：构造一个 Touches bullet 用 ` + ` 连接两路径 ⇒ 检查器必须红；`+` 连接的 AC93/ac86/AC91 样式 bullet 回放必须红。

## Acceptance Criteria

- [ ] AC1: `MULTI_PATH_SEPARATOR_RE` 覆盖 ` + ` 分隔符，`+` 连接的多路径 bullet 被判 RED。
- [ ] AC2: `touches-one-entry-one-path-check` 接进 run_static_checks（每轮执行，非孤儿）。
- [ ] AC3: 负控制成立——`+` 连接的 bullet 回放必红；不红则本 AC 不成立。
- [ ] AC4: 既有 touches-one-entry-one-path-check.test.mjs 测试全绿 + 新增 ` + ` 用例。

## Definition of Done

- [ ] ` + ` 连接符被一条目一路径检查器捕获且检查器实际执行（run_static_checks 接线）；AC93/ac86/AC91 样式 bullet 回放 RED；既有测试绿。

## Touches

- plugin/scripts/touches-one-entry-one-path-check.ts（`MULTI_PATH_SEPARATOR_RE` 补 ` + `）
- scripts/test.sh（接线 run_static_checks）
- plugin/test/touches-one-entry-one-path-check.test.mjs（新增 ` + ` 用例）
- tasks/gap-touches-connector-delimiter-uncaught.md（自身）