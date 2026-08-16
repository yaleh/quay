---
id: gap-direct-bypass-check-quoted-path-false-positive
title: direct-to-develop-bypass-check 对非 ASCII 文件名误判——git quotes 使 ^docs/
  排除失效（2fdb6e32 false positive）
status: ready
labels: []
parent: null
children: []
extra: {}
---
---
id: gap-direct-bypass-check-quoted-path-false-positive
title: "direct-to-develop-bypass-check 对非 ASCII 文件名误判——git quotes 使 ^docs/ 排除失效（2fdb6e32 Web UI 设计正本 false positive）"
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

**判据正本（直接引用，勿转述）**：无独立 manager-phase-goal 段——本任务由 inner 2026-08-16 立案，源证 = select-preflight fan-in 被 direct-to-develop-bypass-check 误挡。

**实测（2026-08-16，select-preflight fan-in full suite）**：
```
fan-in 全量 suite 在静态检查 direct-to-develop-bypass-check 红（fail-closed）。
红源：develop 上 2fdb6e32「manager: 落盘 Web UI 改进版设计正本」被标记 bypass=TRUE。
但该提交只 touch docs/design/quay-webui-improved-2026-08-16/Quay改进版WebUI.dc.html
（design-internal，^docs/ 排除本应豁免）。
```

**根因（fan-in subagent 实读 + 本任务核实，非猜测）**：
`plugin/scripts/direct-to-develop-bypass-check.ts` L92 排除正则 `^(?:tasks\/|docs\/|...)/` 对**非 ASCII 文件名**失效——`git diff --name-only` 对含非 ASCII 的文件名输出**带引号**（`"docs/design/.../Quay改进版WebUI.dc.html"`），前导引号使 `^docs\/` 匹配失败 ⇒ 该文件被误判为 code-surface ⇒ bypass=TRUE。

**⇒ 这是 bypass-check 的 quoted-path 处理 bug**：`^docs/` 排除无法识别被 git quotes 包裹的非 ASCII 路径。

**⛔ 独立于 08e8ec55**（release 0.5.0 genuine bypass，归 owning layer 裁定）——本任务只修 2fdb6e32 类的 quoted-path false-positive。修它**不 unblock** select-preflight fan-in（08e8ec55 仍在），但修掉一个真实检测缺陷。

## Plan

1. 实读 `plugin/scripts/direct-to-develop-bypass-check.ts` L92 排除正则 + git diff 输出解析（L277/L326 附近）。
2. 确认非 ASCII 文件名在 git 输出里的 quoted 形态（`git diff --name-only` 对含非 ASCII 的路径加引号）。
3. 修：解析 git 输出时去掉 quotes（或让排除正则容忍前导引号），使 `^docs/` 等排除对非 ASCII 路径生效。
4. **负控制**：构造一个 `docs/` 下非 ASCII 文件名的提交 ⇒ bypass-check 必须不红（豁免）；构造一个 code-surface 非 ASCII 文件名 ⇒ 必须红。

## Acceptance Criteria

- [ ] AC1: 非 ASCII 文件名在 `docs/` 下被排除正则正确豁免（git quoted 路径处理）。
- [ ] AC2: code-surface 非 ASCII 文件名仍被标记 bypass（不误放）。
- [ ] AC3: 负控制成立——2fdb6e32 类（docs/ 非 ASCII）不红；真实 code 非 ASCII 红。
- [ ] AC4: 既有 bypass-check 测试全绿 + 新增 quoted-path 用例。

## Definition of Done

- [ ] bypass-check 对非 ASCII 文件名的排除判定正确（docs/ 豁免、code 标记）；负控制 + 既有测试绿。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（quoted-path 处理）
- plugin/test/direct-to-develop-bypass-check.test.mjs（新增非 ASCII 用例）
- tasks/gap-direct-bypass-check-quoted-path-false-positive.md（自身）