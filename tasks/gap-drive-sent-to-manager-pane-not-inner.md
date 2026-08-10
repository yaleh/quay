---
id: gap-drive-sent-to-manager-pane-not-inner
title: 外层驱动错投窗口——quay-0:0.0 是 claude/manager 非 inner(6 次 send-keys 两次派发全进
  manager 输入框)+26 次把 manager transcript(b8dc91a6)当 inner 读+confirmed-delivered
  无实证(send-keys 退出码 0 当送达)；worktree=0/AC 0/6/零进展的真因是驱动没到达非 inner 卡
  compact；三条纪律:窗口名 quay-0:inner 永不用索引/前置 display-message 校验/delivered 只认 inner
  信号
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**外层对 inner 的驱动全部打进了 manager 的 pane——`quay-0:0.0` 是窗口名 `claude`（manager，pid 2983389），不是 inner（`quay-0:1.0` / `quay-0:inner`，pid 2989409）。00:22:24Z 起 30 次 tmux 调用、其中 6 次 send-keys（两次 relation-sync 派发：00:44:44 和 00:52:21）全部进了 manager 的输入框，inner 一次都没收到。还把 manager 的 transcript（b8dc91a6-...jsonl）当 inner 读 26 次。这就是 worktree=0 / AC 0/6 / 零进展的全部原因——不是 inner 在 compact 下执行不动，是驱动根本没到达。三条纪律：①只用窗口名 `quay-0:inner`，永不用数字索引；②每次 capture-pane/send-keys 前 `tmux display-message -p -t <target> "#{window_name}"` 确认目标是 inner，不是就中止；③confirmed delivered 不得由 send-keys 退出码 0 或任何 transcript 推断——只认 inner 自己产生的信号：worktree 出现、commit、或 pane 回显文本且窗口名核实为 inner。**

### 实证（manager 2026-08-10 STOP + outer 复核）

- **pane 结构核实**：`tmux list-windows -t quay-0` → `0 claude / 1 inner / 2 outer`。`list-panes -a -t quay-0` → window=claude pane=0 pid=2983389（manager）/ window=inner pane=0 pid=2989409（inner）/ window=outer pane=0 pid=2989418（outer）。
- **错投记录**：本会话（7795bb75）自 00:22:24Z 起对 `quay-0:0.0` 发 30 次 tmux 调用，6 次 send-keys 两次派发（00:44:44、00:52:21）——全部进 manager 输入框。`grep -o "quay-0:[0-9.]*"` → 0.0×64 / 1.0×217 / 2.0×27。
- **错读记录**：26 次把 b8dc91a6-...jsonl（manager transcript）当 inner 读——inner 忙闲、in-flight、transcript 增长全部无效。
- **后果**：两次 relation-sync 派发 inner 一次没收到；manager 的 pane 显示我的派发文本（「这不是我发的。outer 又在占用这个信道。制止它。」）。而 inner 其实一直在自主工作——它已自行从 ready-pool 挑中 relation-sync（worktree `quay-worktrees/gap-relation-sync-load-flake-child-spawn-under-suite` 已出现 = inner 自己的信号），正在实现（"Reading known-load-sensitive.test.mjs" / "Reading cross-annotation Touches sections in five tasks"）。
- **本会话此前 232 次用对窗口名（quay-0:inner），00:22 起漂到数字索引**。

**为什么重要**：驱动错投 = 对 manager 的信道污染（manager 被迫处理我的派发文本）+ 对 inner 的静默丢失（inner 以为无驱动，自主排队处理）。这是「confirmed delivered」无实证的活例——send-keys 退出码 0 不等于送达。

### 选定机制方向（实现归内层，接法留执行时）

1. **纪律固化**（三条纪律，可机械检查）：
   - ① 只用窗口名 `quay-0:inner`，永不用数字索引——外层驱动/观测脚本统一窗口名，索引作废。
   - ② 每次 capture-pane/send-keys 前 `tmux display-message -p -t <target> "#{window_name}"` 确认 == inner，不是即中止。
   - ③ confirmed delivered 只认 inner 自己的信号（worktree 出现 / commit / pane 回显且窗口名核实 inner），不用 send-keys 退出码或 transcript 推断。
2. **接线**：外层驱动脚本/检查器固化三条纪律（如驱动前置校验窗口名、delivered 判定改读 inner 信号）。

**验证锚**：修后 (a) 驱动脚本前置校验窗口名，非 inner 即 fail-closed；(b) confirmed delivered 只认 inner 信号；(c) 无错投（grep 驱动目标无数字索引）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 pane 结构核实（0 claude/1 inner/2 outer + pid）+ 错投计数（30 次调用/6 次 send-keys/26 次错读 transcript）+ 后果（本任务 Proposal 已含）
- [ ] AC2: **窗口名纪律**——外层驱动/观测统一用 `quay-0:inner`，数字索引作废（脚本/文档）
- [ ] AC3: **前置校验**——每次 capture-pane/send-keys 前 `display-message` 确认 window_name==inner，非 inner 即中止（fail-closed）
- [ ] AC4: **delivered 实证**——confirmed delivered 只认 inner 自己的信号（worktree/commit/pane 回显+窗口名核实），不用 send-keys 退出码或 transcript 推断
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：驱动脚本前置校验（非 inner 即中止）+ 一次成功派发（inner 信号确认送达，贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/（外层驱动/观测脚本：窗口名校验 + delivered 判定改 inner 信号）
- orchestration/orchestrator-tick-core.md（三条纪律固化：窗口名纪律 + 前置校验 + delivered 实证）
- tasks/gap-drive-sent-to-manager-pane-not-inner.md（自身：勾 AC + 贴证据）

## Contract

measure   drive_target_verified = `grep -o "quay-0:[0-9.]*" <外层驱动日志> | sort -u` 的 stdout 里数字索引残留行数
band      drive_target_verified = 0（无数字索引残留——只用窗口名 quay-0:inner）
invariant no_drive_to_non_inner = 1（驱动前置校验，非 inner 即中止）
invariant delivered_requires_inner_signal = 1（confirmed delivered 只认 inner 信号）
invoke    `tmux display-message -p -t quay-0:inner "#{window_name}"`（== inner）+ 驱动脚本前置校验跑一次
control   窗口名校验生效；无数字索引；delivered 有 inner 信号
resume    纪律固化 / 前置校验 / delivered 实证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager STOP——错投窗口（quay-0:0.0=claude/manager 非 inner；6 次 send-keys 两次派发全进 manager 输入框）+ 错读 transcript（26 次把 b8dc91a6 当 inner）+ confirmed-delivered 无实证（send-keys 退出码 0 当送达）⇒ 立案。三缺陷：错投窗口 / 错读 transcript / delivered 无实证。实现归内层

## 同根标注（gap-session-identity-index-vs-explicit，2026-08-10）

26 次把 b8dc91a6（manager transcript）当 inner 读 = 「最新/索引启发式替代显式身份」的一个实例。
同根任务 `gap-session-identity-index-vs-explicit` 把同一根因修在 `inner-exec-mode-report.ts`：
缺省 `--session` 先反查 pane pid → session（显式身份），启发式仅 fallback 且报 WARN
（session_source ∈ pane-pid|config|arg|heuristic|none）。两条任务共同消灭「索引/最新替代显式身份」
这一类跨层错误。
