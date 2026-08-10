---
id: gap-drive-sent-to-manager-pane-not-inner
title: 外层驱动错投窗口——quay-0:0.0 是 claude/manager 非 inner(6 次 send-keys 两次派发全进
  manager 输入框)+26 次把 manager transcript(b8dc91a6)当 inner 读+confirmed-delivered
  无实证(send-keys 退出码 0 当送达)；worktree=0/AC 0/6/零进展的真因是驱动没到达非 inner 卡
  compact；三条纪律:窗口名 quay-0:inner 永不用索引/前置 display-message 校验/delivered 只认 inner
  信号
status: done
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

- [x] AC1: **复现固化**——任务体记录 pane 结构核实（0 claude/1 inner/2 outer + pid）+ 错投计数（30 次调用/6 次 send-keys/26 次错读 transcript）+ 后果（本任务 Proposal 已含；实证 2026-08-10 复核：`tmux list-windows -t quay-0` → `0 claude 2983389 / 1 inner 2989409 / 2 outer 2989418`，与 Proposal 记录一致）
- [x] AC2: **窗口名纪律**——外层驱动/观测统一用 `quay-0:inner`，数字索引作废（`drive-target-check.sh` 结构性拒绝 `0`/`0.0`/`1.0`；send-keys-reliable/supervisor-deliver 默认期望窗口名 `inner`；orchestrator-tick-core.md C16 + A4 固化）
- [x] AC3: **前置校验**——每次 capture-pane/send-keys 前 `display-message` 确认 window_name==inner，非 inner 即中止（fail-closed）：`drive-target-check.sh` 已接进 send-keys-reliable.sh step 0 与 supervisor-deliver.sh fresh 路径，数字索引在 tmux 调用前即被拒；测试证明「非 inner 窗口 → exit 1 且 transcript 无任何发送」）
- [x] AC4: **delivered 实证**——confirmed delivered 只认窗口名校验后的 inner 自身 committed 信号（transcript 内容匹配真实 user 消息 / worktree 出现 / commit），不因 send-keys 退出码 0、pane 回显、或「某个 transcript 在增长」（manager 的 b8dc91a6 正是错读对象）判送达——C16 纪律③固化，前置校验保证 transcript 属于被核实的 inner）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（79 tests / 0 fail / 0 cancelled / exit 0）

## Implementation evidence（inner 2026-08-10）

**前置校验 gate（`drive-target-check.sh`，接进 send-keys-reliable step 0 + supervisor-deliver fresh 路径）——真实 quay-0 会话实跑：**

```
$ tmux display-message -p -t quay-0:inner "#{window_name}"        # Contract invoke
inner                                                                # rc=0
$ bash plugin/scripts/drive-target-check.sh quay-0:inner
drive-target-check: OK——目标 'quay-0:inner' 窗口名 'inner' == 期望 'inner'      # rc=0
$ bash plugin/scripts/drive-target-check.sh quay-0:0.0             # 数字索引（事故原形）
drive-target-check: FAIL——目标 'quay-0:0.0' 使用数字索引……索引作废             # rc=1
$ bash plugin/scripts/drive-target-check.sh quay-0:claude          # 错投窗口（claude=manager）
drive-target-check: FAIL——目标 'quay-0:claude' 的窗口名是 'claude'，期望 'inner' # rc=1
```

**三条纪律接线：**
- ① 窗口名纪律：`drive-target-check.sh` 对 `^[0-9]+(\.[0-9]+)?$` 的窗口部分结构性拒绝（不依赖 tmux），`quay-0:0`/`quay-0:0.0`/`1.0` 一律 exit 1；`os-anchor-watchdog.sh` 驱动 outer 窗口时显式 `DRIVE_EXPECT_WINDOW_NAME="$outer"`。
- ② 前置校验：`send-keys-reliable.sh` step 0 与 `supervisor-deliver.sh` fresh 路径在**任何 send-keys/capture-pane 之前**跑 gate；还补了 `list-windows` 真实窗口名校验——tmux `display-message` 对不存在的窗口名会静默落到活动窗口（typo `innr` 若活动窗口恰是 inner 会误过），成员校验封死该洞。
- ③ delivered 实证：`transcript-delivery-check.ts` 仍是唯一送达判定（窗口名校验后的 inner 自身 committed 信号）；C16 纪律③ 明确「不因 send-keys 退出码 0 / pane 回显 / transcript 在增长」判送达。

**scoped 门（AC5）**：`./scripts/test.sh --for-task gap-drive-sent-to-manager-pane-not-inner` → `ℹ tests 79 / pass 79 / fail 0 / cancelled 0 / exit 0`。新增测试：`drive-target-check.test.mjs`（12 用例）、send-keys-reliable.test.mjs 新增 2 条 fail-closed 用例（非 inner 中止不发送 / 数字索引拒绝）。

**capability-catalog 登记**：`drive-target-check.sh` 登记进唯一清单（declaration/cadence/invalidation/last-reaffirmed/matching/consumer-facing 六处），AC1c gate 通过。

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：驱动脚本前置校验（非 inner 即中止）+ 一次成功派发（inner 信号确认送达，贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/drive-target-check.sh（新增：fail-closed 前置校验 gate——数字索引拒绝 + display-message 窗口名校验 + list-windows 真实窗口名校验）
- plugin/scripts/send-keys-reliable.sh（step 0 前置校验接线：send-keys 前跑 gate，非 inner 即中止）
- plugin/scripts/supervisor-deliver.sh（fresh 路径前置校验接线）
- plugin/scripts/os-anchor-watchdog.sh（DRIVE_EXPECT_WINDOW_NAME=outer 覆盖——watchdog 驱动 outer 窗口）
- plugin/scripts/capability-catalog.sh（新机制登记进唯一清单——AC1c gate：未声明问题的脚本进 artifact 会 exit 1）
- orchestration/orchestrator-tick-core.md（三条纪律固化 C16 + A4 观察目标 quay-0:inner）
- tasks/gap-drive-sent-to-manager-pane-not-inner.md（自身：勾 AC + 贴证据）

## Test-Files

- plugin/test/drive-target-check.test.mjs（新增：12 用例——数字索引拒绝/窗口名匹配/typo 真实窗口名校验/真实-TUI e2e）
- plugin/test/send-keys-reliable.test.mjs（既有 e2e 适配 + 新增 2 条 fail-closed 用例：非 inner 中止不发送/数字索引拒绝）
- plugin/test/supervisor-deliver.test.mjs（既有 e2e 适配 DRIVE_EXPECT_WINDOW_NAME）
- plugin/test/supervisor-bus.test.mjs（既有 e2e 适配 DRIVE_EXPECT_WINDOW_NAME）

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
