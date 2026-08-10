---
id: gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap
title: ADR-016 的 md5(capture-pane) 禁令在出货的 plugin/loop/*.md 里被违反、检查器扫不到—— ① 检查器
  SHELL_EXT 只扫 .sh/.bash（:79），.md 有意豁免（散文）、但 .ts 也不扫（漏，非设计）； ②
  plugin/loop/orchestrator-loop-tick.md:309-310 与 manager-loop-tick.md:85
  是【指令】不是散文的 md5(capture-pane) bash 块，外层照着做即违规，run_static_checks 不拦； ③
  漂移：plugin/loop/manager-loop-tick.md（318 行）vs
  orchestration/manager-loop-tick.md（527 行） 同文档两副本分叉（CLAUDE.md 点名的 drift 形态）；管理者
  2026-08-08 实测报告（7c1ef5f3 只改了 orchestration/ 那份，plugin/ 归外层）；一般形态：机械检查器作用域边界 =
  同规则散文副本能安静违规处， 出货 .md 的 bash 块是【指令】与 .sh 同权，不该按散文豁免
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**ADR-016 的 md5(capture-pane) 禁令在出货的 `plugin/loop/*.md` 里被违反，检查器作用域扫不到。**

### 管理者 2026-08-08 实测报告（未修，不越界）

**① 检查器作用域**：`plugin/scripts/adr016-screen-use-check.ts:79`
`const SHELL_EXT = new Set([".sh", ".bash"])`（:150 唯一用法）⇒ 只扫 .sh/.bash。
.md 不扫（第 16-17 行注释是【有意】如此，为放过 ADR 自己的散文），但 **.ts 也不扫**——
这一条注释里没提，像是漏的，不像是设计的。

**② 违规点（都在 plugin/ 出货内容里）**：
- a) `plugin/loop/orchestrator-loop-tick.md:309-310`——可执行 bash 块：
  ```
  tmux capture-pane -p -t "$TMUX_SESSION" | md5sum; sleep 25
  tmux capture-pane -p -t "$TMUX_SESSION" | md5sum      # 两次相同 = 空闲
  ```
  正是 ADR-016:121-123 点名禁止的 md5(capture-pane) 族，且它是**指令**不是散文——
  外层照着做就会违规，而 run_static_checks 不会拦。
- b) `plugin/loop/manager-loop-tick.md:85`——同一形态（「两次 md5sum 相同 = 空闲」）。

**③ 附带发现（drift）**：`plugin/loop/manager-loop-tick.md` 318 行 vs
`orchestration/manager-loop-tick.md` 527 行，md5 不同——同一份 tick 文档两个副本已分叉。
CLAUDE.md 点名的形态：「content living in two places…fix the SOURCE, not just the artifact」。
管理者 2026-08-08 这一轮只改了 `orchestration/` 那份（7c1ef5f3），`plugin/` 那份没动——归外层/内层。

### 合规替代形态（管理者已实测可用）

底部区域 + 枚举态（ADR-016 Amendment 允许）：
```bash
tmux capture-pane -p -t <pane> | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle
```
实测判别力真实存在：inner 命中=1（busy）、outer 命中=0（idle）。
注意别写成 `-S -3`——`-S` 是【起始行】不是行数，负值进历史缓冲，取到的是「历史往前 3 行 → 屏幕
底部」一大段，首行是正文，取不到状态行 ⇒ 忙闲判别恒为「闲」。管理者自己两处文档都踩了这个，已改。

### 一般形态（值得进 ADR 或检查器注释）

**机械检查器的作用域边界，就是同一条规则的散文副本能安静违规的地方。**
出货的 `.md` 里的 bash 块是【指令】，与 `.sh` 同权，不该按散文豁免。

## Contract

```
measure md5_capture_pane_in_md = `grep -rnE "capture-pane.*md5sum|md5sum.*capture-pane" plugin/loop/ packages/quay/plugin/loop/ 2>/dev/null | wc -l` stdout 数字段
band md5_capture_pane_in_md = 0（修复后出货 .md 无 md5(capture-pane) 指令块；当前=2：orchestrator-loop-tick.md:309-310 + manager-loop-tick.md:85）
invoke `grep -rn "capture-pane" plugin/loop/*.md | grep md5sum`
control 负控制：ADR 自身散文（adr/ADR-016*.md 提到 md5(capture-pane)）不计数；合规替代形态（tail -3 | grep 'esc to interrupt'）不误报
resume 若中断，先跑 measure 确认当前违规数，不要假设已修
```

## Acceptance Criteria

- [x] AC1: **两处违规修复**——`plugin/loop/orchestrator-loop-tick.md`（实测合规块在 :473，
      修正说明 :477-479；任务书写时旧违规在 :309-310，行号随文档增长偏移）与
      `plugin/loop/manager-loop-tick.md:85` 的 md5(capture-pane) 指令块改为合规替代形态
      （`tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle`），外层照做不再违规。
      并行副本 `orchestration/orchestrator-loop-tick.md` 的同一指令块也已修正（drift 同步）
- [x] AC2: **检查器作用域补 .ts**——决策记录（非静默漏）：`.ts` 不扫，因 `stripShellComments`
      只建模 shell 注释（`#`）；TS 的 `//` 注释与字符串字面量会自匹配检查器自身（selftest
      内嵌该流），且仓内无可执行的 .ts 同形态（grep 验证）。注释写进
      `adr016-screen-use-check.ts` SHELL_EXT 处（:85-92）
- [x] AC3: **.md 指令块判定**——检查器扩展为扫描 tick 文档（`MD_TICK_DOCS` 白名单：
      plugin/loop/*-loop-tick.md + orchestration/*-loop-tick.md，与 instrument-failure-check
      同一文档集）的 **fenced ```bash 指令块**（代码位置检测，行号偏移回 .md 行）；散文仍豁免
      ——ADR 自身散文永不自匹配。负控制实证：注入 md5 到 fenced bash 块 ⇒ 检查器报出（见下）
- [x] AC4: **drift 修复**——`plugin/loop/manager-loop-tick.md:85-87` 与 `orchestration/manager-loop-tick.md`
      的 2026-08-08 更正（7c1ef5f3）同步（修 SOURCE 非 artifact）；关系确认：plugin/loop/* =
      出货通用模板（quay-init 铺设），orchestration/* = 本仓循环的工作副本——同文档两副本，
      非模板/部署位之外的第三种关系
- [x] AC5: 与 `gap-adr016-*` 既有任务族交叉标注（见任务体 Finding 段）

## Definition of Done

- [x] AC1-AC5 实跑输出贴任务体（违规改前后对照 + 检查器作用域 + drift 同步）

### 实跑输出（2026-08-10，gap-adr016-md5-ban-... 实施时）

**Measure（修复后）**——出货 tick 文档无 md5(capture-pane) 指令块：

```
$ grep -rnE "capture-pane.*md5sum|md5sum.*capture-pane" plugin/loop/ orchestration/*-loop-tick.md | wc -l
0
$ grep -rn "capture-pane" plugin/loop/*.md | grep md5sum   # invoke
（无输出，exit=1）⇒ md5_capture_pane_in_md = 0（修复前 = 2：orchestrator + manager 各一处）
```

**违规改前后对照**——`plugin/loop/manager-loop-tick.md:85-87`（修复后合规形态）：

```bash
tmux capture-pane -p -t "<pane>" | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle
```

`plugin/loop/orchestrator-loop-tick.md:473` 同形态，:477-479 有修正说明（指出上一版是整屏哈希
`md5(capture-pane)`、`-S -3` 陷阱）。旧违规形态（任务体 §Proposal 引述）：`tmux capture-pane -p -t
"$TMUX_SESSION" | md5sum; sleep 25` + `| md5sum  # 两次相同 = 空闲`。

**检查器（修复后，仓上扫描）**——作用域已含 tick 文档 bash 块：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts --root .
adr016-screen-use-check — 148 file(s) scanned (shell scripts + tick-doc bash blocks)
violations: 0
PASS: active whole-screen-hash violations (0) within band (0..1)
exit=0
```

**RED 证明（负控制：tick 文档 fenced bash 块注入 md5(capture-pane)）**——检查器真能拦住：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts --root <tmp>/adr016-fixture
adr016-screen-use-check — 1 file(s) scanned (shell scripts + tick-doc bash blocks)
violations: 2
  plugin/loop/orchestrator-loop-tick.md:3  tmux capture-pane -p -t "$TMUX_SESSION" | md5sum; sleep 25  [same-command]
  plugin/loop/orchestrator-loop-tick.md:4  tmux capture-pane -p -t "$TMUX_SESSION" | md5sum  [same-command]
FAIL: 2 active whole-screen-hash violations — band is 0..1 (new active violation detected)
exit=1
```

**检查器 selftest**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/adr016-screen-use-check.ts --selftest
adr016-screen-use-check --selftest: 8 passed, 0 failed
```

**scoped 测试**：`./scripts/test.sh --for-task gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap`
——`plugin/test/adr016-screen-use-check.test.mjs` **15/15 全绿**（0 fail），含 3 个 tick-doc AC3 用例
（fenced 块 RED / 散文豁免 GREEN / 合规替代形态 GREEN）。selector 对 6 条 Touches 只解析出 1 条到
测试文件（0.17 < 0.5）→ `test-selection-thin` 警告（exit 1）；这是**文档类任务固有**的薄选择
（tick 文档与任务文件没有 basename 配对的测试文件），`--allow-thin` 通过后同套测试仍 15/15 绿。
tick 文档的作用域覆盖由静态检查泳道承担：`@static-object plugin/loop/*-loop-tick.md
orchestration/*-loop-tick.md plugin/scripts/adr016-screen-use-check.ts plugin/test/adr016-screen-use-check.test.mjs`。

## Finding

**关系确认（AC4）**：`plugin/loop/*-loop-tick.md` 是**出货通用模板**（quay-init 铺设到目标项目），
`orchestration/*-loop-tick.md` 是**本仓循环的工作副本**——同文档两副本，非模板/部署位之外的第三
种关系。二者同源但已分叉（plugin/loop/manager-loop-tick.md 322 行 vs orchestration/manager-loop-tick.md
1596 行）。本任务按「修 SOURCE 非 artifact」把两副本的 md5(capture-pane) 指令都改为合规形态：
plugin/loop/orchestrator-loop-tick.md:473（旧 :338-339）、plugin/loop/manager-loop-tick.md:85、以及
并行副本 orchestration/orchestrator-loop-tick.md 的同一指令块。orchestration/manager-loop-tick.md
已在 7c1ef5f3 修过（2026-08-08），本任务把 plugin/ 副本拉到同一更正。

**检查器作用域（AC2/AC3）**：`.ts` 不扫是**决策记录**非静默漏——`stripShellComments` 只建模
shell 注释（`#`）；TS 的 `//` 注释/字符串字面量会自匹配检查器自身（selftest 内嵌该流），且仓内
无可执行的 .ts 同形态（grep 验证）。`.md` 扩展为扫描 `MD_TICK_DOCS` 白名单（plugin/loop/* +
orchestration/*-loop-tick.md，与 instrument-failure-check 同一文档集）的 **fenced ```bash 指令块**
（代码位置检测，行号偏移回 .md 行）；散文仍豁免——ADR 自身散文永不自匹配，本任务修正说明里
也用 `md5(capture-pane)` 写法而非逐字 `capture-pane | md5sum`（后者会被 measure grep 命中）。

**交叉标注（AC5）**：本任务族——`gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-
to-forbid`（裁定 A / ADR-016 Amendment / 检查器诞生）、`gap-pane-state-is-hashed-not-classified-so-
needs-input-is-unobservable`（session-liveness.sh 承载）、`gap-session-liveness-hashes-the-token-
counter-as-if-it-were-work`（busy 判据改 classifyPaneState）。本任务是这条族的「作用域边界」补完：
机械检查器的作用域边界，就是同一条规则的散文副本能安静违规的地方。

## Touches
- tasks/gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap.md（自身文件：self-touch，2026-08-08 内层补——缺此条不满足派发资格闸 step 4.5）
- plugin/loop/orchestrator-loop-tick.md（:473 合规形态 + 修正说明 :477-479）
- plugin/loop/manager-loop-tick.md（:85 改合规形态 + drift 同步）
- orchestration/orchestrator-loop-tick.md（同块并行副本同步）
- plugin/scripts/adr016-screen-use-check.ts（AC2/AC3：.ts 决策记录 + .md 指令块判定 + selftest）
- orchestration/manager-loop-tick.md（确认已修，作为 drift 的 SOURCE）
- plugin/test/adr016-screen-use-check.test.mjs（3 个 tick-doc AC3 用例 + 头注释更新）
- scripts/test.sh（adr016 检查器 @static-object 扩展含 tick 文档 + 检查器自身）
- tasks/gap-adr016-*（AC5 交叉标注，见 Finding 段）

## Dispatch review

reviewer: none
at: 2026-08-08T07:5xZ
changed: 管理者 2026-08-08 实测报告（检查器 SHELL_EXT 只扫 .sh/.bash、.md 有意豁免但 .ts 是漏；
  plugin/loop 两处 md5(capture-pane) 指令块；plugin/orchestration 两副本漂移）。外层独立复核：
  SHELL_EXT:79 确认 + 两处违规行确认 + 漂移 md5 确认（318 vs 527 行、cdc95626 vs bd1ac6f5）。
