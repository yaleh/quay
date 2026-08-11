---
id: gap-pane-classify-busy-truncated-by-column-width
title: "忙态判定不得只依赖单一字符串——两成因（A 列宽截断 esc to interru… / B 任务面板标志替换 esc to interrupt 缺失），任一都假空闲；A 67 列 inner、B 93 列 outer 恰在有 agent 跑时失效"
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`plugin/scripts/pane-state-classify.ts:114` 的 `BUSY_RE = /esc to interrupt/i` 要求完整字符串；当 tmux 窗口列宽不足时，TUI 把状态行省略成 `esc to interru…`，`BUSY_RE` 匹配不上 ⇒ inner 在忙（transcript 刚写）却被判空闲。**

### 实证（manager 2026-08-11 01:3x，三条读数互证）

- **① `pane-state-classify.ts:114`**：`const BUSY_RE = /esc to interrupt/i;` —— 要求完整字符串。
- **② `tmux list-windows`**：`quay-0:inner width=67` / `quay-0:outer width=93` / `quay-0:claude width=67`。
- **③ 实测 inner pane 底部**：`⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interru…` —— 状态行超过 67 列，TUI 省略成 `esc to interru…`，`BUSY_RE` 匹配不上。
- **后果**：inner 在忙（transcript 6 秒前刚写）却判空闲。outer 93 列够宽，同一代码从不暴露 ⇒ **同一分类器在两个窗口上行为不同，差别只是列宽**。
- **解释今晚一整晚的假空闲**：多次「三个 subagent 在跑、各烧 100k+ token，却报 SESSION-IDLE」此前归因 `statusArea()` 被 agent 列表挤掉——现在有更直接、可复现、可判定的解释：宽度截断。（两者可能并存，但这条可复现。）
- **时序**：OOM 杀 window 后 tmux 布局变化，窗口宽度掉到 67（此前见过完整 `esc to interrupt · ← 1 agent`）。

### 成因 B 补充（manager 2026-08-11 01:5x 实测，证否「只有列宽」假设）

- **outer 也报 MARKER-STALE，但成因与 inner 不同**：`quay-0:outer width=93`（够宽），底部区域实测：`⏵⏵ bypass permissions on · 1 monitor · ctrl+t to hide tasks · ← 1 agent · ↓ to manage` + `◯ execute-suite-fix  A15 … 28/28 agents done · 1h 0m 59s · ↓ 2.0m tokens · ⚠ Large workflow`。**完整串命中 0、截断前缀命中 0** ⇒ `esc to interrupt` **整个不在**，不是被截断。
- **成因 B 本质**：当 TUI 渲染任务/agent 列表时，状态行被换成 `1 monitor · ctrl+t to hide tasks · ← 1 agent · ↓ to manage`——忙态标志被**替换掉**而非截断。
- **结论**：假空闲有两个独立成因。`成因 A（inner 67 列）= 标志被省略号截断`；`成因 B（outer 93 列）= 渲染 agent/任务列表时标志缺失`。**成因 B 在宽窗口上照样假空闲，且恰发生在「有 agent 在跑」时——正是最需要判忙的那一刻。**

### 选定机制方向（实现归 inner，判定归 outer；manager 建议 + outer 裁定）

**忙态判定不得只依赖单一字符串，两条一起收：**
1. **容截断（成因 A）**：`BUSY_RE` 改为 `/esc to interr/i`（截断前缀），或先剥行尾省略号（`…`/`...`）再匹配完整串。与 ADR-016 不冲突——仍只读底部区域、仍按语义标志，不是整屏哈希。
2. **任务面板标志判忙（成因 B）**：当底部区域出现 `← N agent` / `N monitor` / `ctrl+t to hide tasks` 这类任务面板标志时，一律判忙——它们的存在本身就蕴含「有活在跑」。
3. **回归 fixture 两条都钉**：inner 67 列截断行（成因 A 样本）+ outer 上面那两行（成因 B 样本），都要求判 busy。

**验证锚**：修后 (a) 67 列截断文本（`esc to interru…`）判 busy；(b) 完整文本（`esc to interrupt`）判 busy；(c) outer 面板行（`1 monitor · ctrl+t to hide tasks · ← 1 agent`）判 busy；(d) 其它语义标志（waiting-input/permission-prompt）不误判；(e) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录两成因（A 截断 inner 67 列 / B 面板标志替换 outer 93 列）+ 假空闲后果（本任务 Proposal 已含）
- [ ] AC2: **判据容截断（成因 A）**——BUSY_RE 匹配截断前缀或先剥省略号；67 列截断文本判 busy
- [ ] AC3: **面板标志判忙（成因 B）**——`← N agent` / `N monitor` / `ctrl+t to hide tasks` 出现 ⇒ 判 busy；outer 面板行判 busy
- [ ] AC4: **回归 fixture 两条**——inner 67 列截断行 + outer 面板两行钉进 pane-state-classify 测试
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿；其它语义标志（waiting-input/permission-prompt）不误判

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：67 列截断文本判 busy + outer 面板行判 busy（贴输出）；完整文本判 busy
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/pane-state-classify.ts（BUSY_RE 容截断 + 剥省略号）
- plugin/test/pane-state-classify.test.mjs（新增 67 列截断 fixture 用例）
- tasks/gap-pane-classify-busy-truncated-by-column-width.md（自身：勾 AC + 贴证据）

## Contract

measure   busy_judgment_not_single_string = `grep -cE "esc to interr|省略号|hide tasks|← N agent|monitor.*ctrl\+t" plugin/scripts/pane-state-classify.ts` 的 stdout 数字
band      busy_judgment_not_single_string >= 1（判据已容截断 + 面板标志判忙）
invariant truncated_67col_busy = 1（67 列截断文本判 busy）
invariant panel_flags_busy = 1（`← N agent`/`N monitor`/`ctrl+t to hide tasks` ⇒ 判 busy）
invariant full_text_busy = 1（完整 esc to interrupt 判 busy）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --pane-text "⏵⏵ bypass permissions on · 1 monitor · ctrl+t to hide tasks · ← 1 agent · ↓ to manage" --json`（贴 busy 判定，成因 B）
control   截断文本判 busy；面板标志判 busy；完整文本判 busy；其它标志不误判
resume    BUSY_RE / 面板标志 / fixture / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 01:3x 三条读数互证——BUSY_RE 要完整串、inner 67 列、实测截断 esc to interru… ⇒ inner 忙判空闲（transcript 6s 前刚写）；outer 93 列同代码从不暴露。处方：判据容截断 + 67 列 fixture 回归。plugin/ 实现归 inner（outer 已修 orchestration/session-liveness.env 换活 transcript，65be44d5）。实现归 inner，判定归 outer
