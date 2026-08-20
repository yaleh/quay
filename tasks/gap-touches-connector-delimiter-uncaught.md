---
id: gap-touches-connector-delimiter-uncaught
title: Touches 连接符 '+' 未被一条目一路径检查器捕获 + 检查器未接线（AC93/ac86/AC91 三次 anti-drift HARD
  FAIL 根因）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
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

## Plan 执行记录（2026-08-16 实现者）

- **②护栏（已做）**：`MULTI_PATH_SEPARATOR_RE` 补 ` \+ `；`PATH_TOKEN_RE` 补第三分支（`[\/\\][^\/\\]*[*?][^\/\\]*`——glob 通配也算 path-like，否则 AC86 形状 `scripts/test.sh + plugin/scripts/*` 的 `plugin/scripts/*` 不算路径、只数出一个 token 而不红）；检查器接进 `scripts/test.sh` run_static_checks（`@static-tier always` + `@static-scoped-mode subset-touched`，与 malformed-task-check 同形）；`main()` 补 `--strict-subset` 消费-忽略（同 malformed-task-check：全仓扫描不被收窄）。
- **①根治（不做，记录理由）**：`parseTouchEntries` **不拆**连接符。理由：① 它是 ADR-004 的 ONE parser，多个消费者（dispatch/touches-resolve/orthogonality/`(new)`-tag）依赖其「一条目=一行」契约，拆 ` + `/` / ` 是语义契约变更，需连带改 tag 提取与所有依赖测试；② 拆了反而**掩盖形态违规**——多路径 bullet 会被 parser「正确」解析成多个真实路径，checkTouchesPair 判不到藏匿路径的问题缓解了，但作者写坏形态的动机也消失，与检查器「一条目一路径」的强制目标相抵触；③ ②已把作者时违规变成硬 gate（接线即红），正确修法就是作者把 bullet 拆成一行一条，parser 无须容忍坏形态。
- **baseline 吸收（2026-08-16 一次性）**：接线 + ` + ` + glob-path 三改动使 DONE 历史任务的既有多路径 bullet 全部「新可见/会阻塞」。全部吸收进 shrink-only baseline（`docs/analysis/touches-one-entry-one-path-baseline.md`，8 ` / ` + 13 ` + ` + 2 `、` = 23）——它们是 done 任务、不在派发池、且超出本任务 Touches 授权去拆。从今起清单只缩不增；后续把任一任务拆成一条一 bullet 时删其条目并减 baseline-count。
- **测试**：`plugin/test/touches-one-entry-one-path-check.test.mjs` 新增判据2b（` + ` 正/负控制，含 AC86 glob 形状）；scan 测试改写为「全仓 0（历史全 baseline）+ 合成 ` + ` bullet 必红」；既有 15 条 + 新增 = 19 条全绿。
- **mutation case**：新增 `plugin/scripts/checker-mutation-cases/touches-one-entry-one-path-check.sh`（GREEN→注入 ` + ` bullet→RED→恢复→GREEN），`checker-mutation-check` uncovered=0。

## Acceptance Criteria

- [x] AC1: `MULTI_PATH_SEPARATOR_RE` 覆盖 ` + ` 分隔符，`+` 连接的多路径 bullet 被判 RED。
- [x] AC2: `touches-one-entry-one-path-check` 接进 run_static_checks（每轮执行，非孤儿）。
- [x] AC3: 负控制成立——`+` 连接的 bullet 回放必红；不红则本 AC 不成立。
- [x] AC4: 既有 touches-one-entry-one-path-check.test.mjs 测试全绿 + 新增 ` + ` 用例。

## Definition of Done

- [x] ` + ` 连接符被一条目一路径检查器捕获且检查器实际执行（run_static_checks 接线）；AC93/ac86/AC91 样式 bullet 回放 RED；既有测试绿。

## Touches

- plugin/scripts/touches-one-entry-one-path-check.ts（`MULTI_PATH_SEPARATOR_RE` 补 ` + `、`PATH_TOKEN_RE` 补 glob 分支、`main()` 补 `--strict-subset`）
- scripts/test.sh（接线 run_static_checks）
- plugin/test/touches-one-entry-one-path-check.test.mjs（新增 ` + ` 用例）
- plugin/scripts/checker-mutation-cases/touches-one-entry-one-path-check.sh（新增 mutation case——checker-mutation-check 要求每注册检查器有 case）
- docs/analysis/touches-one-entry-one-path-baseline.md（接线后历史 DONE 任务的多路径 bullet 一次性吸收：8+13+2=23）
- tasks/gap-touches-connector-delimiter-uncaught.md（自身）
