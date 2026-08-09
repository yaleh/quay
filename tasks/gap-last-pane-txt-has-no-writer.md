---
id: gap-last-pane-txt-has-no-writer
title: "`.quay/last-pane.txt` 是没有写入者的死文件——mtime 4h 陈旧、无任何脚本写它（只有测试 fixture
  提及），A7 对着死快照永远判 busy/reset/0/3，inner 卡多久都不写块"
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

**`.quay/last-pane.txt` 是没有写入者的死文件——mtime 12:07:36（已 4 小时未更新），grep plugin/scripts 全部 .sh/.ts 无任何脚本写它（只有 checker-mutation-case 一个测试 fixture 提及）。A7 `inner-blocked-signal.ts --detect-stop --pane .quay/last-pane.txt` 对着这个死快照判 `pane_decision=busy branch=reset consecutive=0/3`——永远 busy、永远 reset、永远攒不到 3，inner 卡多久都不会写块。「看 inner 卡住没有」的机制存在但读到的是死数据。**

### 实证（manager 2026-08-09 实测 + outer 复核）

- **mtime 12:07:36 vs 此刻 16:03:32**：4 小时未更新。
- **内容对不上**：文件里写 `6 monitors still running`，inner 实况 pane 是 `1 shell`。
- **无写入者**：`grep -rln "last-pane.txt" plugin/scripts/ scripts/` 只命中 `checker-mutation-cases/manager-observation-runtime-check.sh`（一个测试 fixture 目录），无任何 `> .quay/last-pane.txt` / `capture-pane ... last-pane` 的写入点。只有若干 .md 文档提到它。
- **后果**：A7 判据是死的——`pane_decision=busy branch=reset consecutive=0/3`，永不触发停止条件。inner 卡在权限对话框/选择框多久，外层都看不到。

**为什么重要**：这是「机制存在但读死数据」——外层看 inner 停摆的机制（A7）实际不可用，属于 manager 说的「读数在场没被判」族的机制根。`1/4` 是读数在但没被判；这是读数（快照）本身没写入者，比没被判更底层。

**修的方向（实现归内层）**：
- 候选 A：**补写入者**——谁 capture pane、多久一次、写哪。应有一个常驻/每 tick 的 capture 把 inner pane 实况写进 `.quay/last-pane.txt`（如 capture-pane 每 30s 或 inner tick 时写）。
- 候选 B：**A7 改读活源**——`inner-blocked-signal.ts` 直接 `capture-pane` 实时读，不依赖磁盘快照（消除「快照陈旧」整类）。
- 候选 C：**移除死文件依赖**——A7 改为读 session-liveness 的实时输出或直接 pane，`.quay/last-pane.txt` 若不再被写就从判据链删除。

**验证锚**：修后，(a) `.quay/last-pane.txt` 有真实写入者（mtime 新鲜或改读活源）；(b) inner 停在 permission-prompt 时 A7 能检测（不再永远 reset）；(c) 正常忙碌不误报。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（mtime 4h 陈旧 + 无写入者 + A7 永远 reset + 内容对不上）（本任务 Proposal 已含；内层补：跑 A7 复现永远 reset）
- [x] AC2: **写入者补齐或改读活源**——`.quay/last-pane.txt` 有真实写入（mtime 新鲜）或 `inner-blocked-signal.ts` 改实时 capture-pane 读 pane（候选 A/B 任一）
- [x] AC3: **停止条件可触发**——inner 停在 permission-prompt/waiting-input 时 A7 能攒到连续 3 次并写块（不再永远 busy/reset）
- [x] AC4: **正常忙碌不误报**——inner 正常干活时不误触发停止（负控制）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 inner-blocked / pane 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造 inner 停 permission-prompt ⇒ A7 检测到并写块；mtime 新鲜（贴任务体）（hermetic：liveCaptureFn 注入 `PERMISSION_PANE` fixture ⇒ `source=live` + condition；实况 invoke 见 Evidence——不驱动真实 inner 到对话框以免干扰在飞任务）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/inner-blocked-signal.ts（候选 B：改实时 capture-pane 读 pane，或候选 A 的写入者）
- plugin/scripts/session-liveness.sh 或调度（候选 A：写入者——capture 频次 + 落盘）
- orchestration/orchestrator-tick-core.md（A7 判据——核实改读活源后文档同步）
- tasks/gap-last-pane-txt-has-no-writer.md（自身：勾 AC + 贴证据）

## Test-Files

- plugin/test/blocked-signal-parameterized.test.mjs（候选 B 的活源回退测试：stale/absent 快照 → source=live，liveCaptureFn 注入缝，no-terminal-session 纪律）

## Contract

measure   last_pane_staleness = `stat -c %Y .quay/last-pane.txt` 的 mtime 距 now 的秒数（或 inner-blocked-signal 判据是否可触发）
band      last_pane_staleness = ≤ 300s（新鲜；或改读活源后不依赖此文件）
invariant blocked_detectable = 1（inner 停 permission-prompt ⇒ A7 能检测写块）
invariant busy_not_false_positive = 1（正常忙碌不误报）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target inner --pane .quay/last-pane.txt`（修后实跑贴回）
control   inner 停 ⇒ 可检测；正常忙 ⇒ 不误报；mtime 新鲜
resume    写入者 / 活源改造 / 判据链清理分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 实测：last-pane.txt 无写入者 4h 陈旧，A7 永远 reset 看不到 inner 卡住；同 ADR-033「读数无法表达关键区别」源。实现归内层）

## Evidence（内层实现 2026-08-09）

**实现选候选 B（改读活源）**：`plugin/scripts/inner-blocked-signal.ts` 的 `observePaneForRuling` 现在对
**stale（mtime > 300s）/ absent 的 `--pane` 快照不再信任**，改读 LIVE `tmux capture-pane -p -t <target>`
（与 `session-liveness.sh` 同一个只读原语），消除「死快照」整类。tmux target 解析是显式配置、绝不猜：
`--tmux-target` > env `INNER_BLOCKED_TMUX_TARGET`/`SESSION_TMUX_TARGET` > `SESSION_TMUX_SESSION`
（env 或 `<root>/orchestration/session-liveness.env`）→ `<session>:<target>`；无配置则 live 不可用。
既无新鲜文件又无 live 源 ⇒ 观察判 `unreadable`（计数 reset，绝不在陈旧数据上误报）。`pane_decision`
行新增 `source=file|live` 作为验证锚。测试通过 `liveCaptureFn` 注入缝 + `tmuxTarget` 参数做无终端
(no-terminal-session) 的 hermetic 验证。

### AC1 复现固化——跑 A7 复现「永远 reset」

构造任务描述的原始死快照（内容 `6 monitors still running`，mtime 4 小时前，无 live 配置），新代码
**拒绝该快照**（不再 busy-classified）：

```text
mtime: 2026-08-09 12:41:40 +0000   # 4h 陈旧，正是任务描述的「内容对不上」形状
$ INNER_BLOCKED_TMUX_TARGET= SESSION_TMUX_SESSION= node ... --detect-stop --target inner --pane /tmp/stale-repro-ws/.quay/last-pane.txt
detect-stop: target=inner signal=.quay/inner-blocked.json
detect-stop: pane_decision=unreadable branch=reset consecutive=0/3
detect-stop: no stop condition; no block
```

旧代码把这份陈旧 busy 内容当实况 → `busy/reset/0/3` 永远不攒；新代码不读死快照 → `unreadable/reset`，
同样不误报但原因不同（快照不受信，不是「忙」）。

### AC2 改读活源——Contract invoke 行实跑（stale/absent 快照 → source=live）

任务体 `invoke` 行实跑（worktree 里 `.quay/last-pane.txt` 不存在 → absent 快照 → live 回退，实际
capture 到 inner 实时 pane）：

```text
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target inner --pane .quay/last-pane.txt
detect-stop: target=inner signal=.quay/inner-blocked.json
detect-stop: pane_decision=waiting-input branch=reset consecutive=0/3 source=live
detect-stop: no stop condition; no block
```

`source=live` 证明观察者读的是**实时 pane** 而非磁盘快照；`branch=reset` 因 inner 正在等自己的后台
agent（状态区「← N agent」消歧，良性空闲），正确不累积——这正是 AC4 的实况负控制。

### AC3 停止条件可触发（blocked_detectable）——hermetic 测试证明

inner 停在 permission-prompt/waiting-input 时，A7 能攒够连续采样并写块（不再永远 reset）：
- `candidate B — ABSENT --pane file + live capture success ⇒ source=live`：absent 快照 + live
  `PERMISSION_PANE` ⇒ `source=live`、`state=permission-prompt`、`samples=1` 即出 condition（写块）。
- `candidate B — AC2 with a LIVE source: two consecutive live samples reach the threshold and write`：
  live 源两次连续 waiting-input 采样到 2/2 ⇒ 出 condition（旧缺陷正是「永远攒不到 3」）。

### AC4 正常忙碌不误报（busy_not_false_positive）——hermetic 负控制 + 实况

- `candidate B — busy is never a false positive from a LIVE source`：live `BUSY_PANE` ⇒ `needsInput=false`、
  `condition=null`、计数 reset。
- 实况：上述 invoke 行里 inner 在忙（等后台 agent）⇒ `branch=reset consecutive=0/3`，未误报。

### AC5 scoped 门绿 + 新增测试全绿

`bash scripts/test.sh --for-task gap-last-pane-txt-has-no-writer --allow-thin`（worktree 内）：

```text
warning: test-selection-thin: task gap-last-pane-txt-has-no-writer resolved tests for 1/4 Touches entries (0.25) < 0.5; pass --allow-thin to run anyway
task-contract-check: no violations.
violations: 0 unique across 0 task(s); info findings (non-ratchet, pre-opt-in baseline): 0
strategic-doc-staleness-check — 108 strategic doc(s) scanned ... PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline
tests 62, pass 62, fail 0, cancelled 0
```

- **62 tests / 62 pass / 0 fail / exit 0**：`inner-blocked-signal.test.mjs`（35，既有）+ `blocked-signal-parameterized.test.mjs`
  （27，含 **9 个新增 candidate B 测试**——stale→live、fresh→file 且 live 不被调用、stale+live-fail→unreadable、
  absent→live、无 pane 无 target→unobserved、live 累积 AC2、live busy 负控制、CLI stale 无 live→unreadable、
  `resolveTmuxTarget` 优先级）。
- 新增测试经任务体 `## Test-Files` 声明（selector rule 4）进入 scoped 选择——基线配对
  (`inner-blocked-signal.ts` → `inner-blocked-signal.test.mjs`) 看不到参数化文件。
- 静态检查：`task-contract-check` 0 违规；`strategic-doc-staleness-check` 无新增 stale。
- 全量套件红窗由外层 verification-round 验证（本任务不跑全量）。

### 文档同步（Touches）

- `orchestration/orchestrator-tick-core.md` A7 行：判据补「`--pane` 快照 ≥300s 陈旧或缺失时**改读活
  capture-pane**（stdout 带 `source=live`，不依赖磁盘快照）」。

### 未做（按任务约束）

- 候选 A（给 `.quay/last-pane.txt` 补写入者）：未做——候选 B 已消除对快照的依赖，band 判据「改读活源后
  不依赖此文件」满足。
- 全量套件：外层 verification-round 验证（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）。
