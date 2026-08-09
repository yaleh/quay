---
id: gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close
title: inner panel shows a FROZEN stale agent line after the bracket closed — a
  MISLEADING WINDOW before the panel self-cleans (NOT permanent — the panel
  cleared the observer-registry line by 03:37:32); observer-registry line read
  「Committing observer-registry task work 3h 5m 32s」 while the bracket was
  closed (d3fb2839, --task-end needs-human) and left inProgress at 03:22; in
  that window the frozen dead line is visually INDISTINGUISHABLE from a live
  agent without cross-time sampling (timer advance), so anyone glancing reads
  「agent ran 3h unfinished」 — same family as tonight's recurring "instrument
  can't distinguish opposite states" (stuck-vs-running → ended-vs-running)
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**inner 面板在括号关闭后仍显示冻结的旧 agent 行——同一实体，面板与遥测给出相反状态。**

### 实测（管理者 2026-08-07，三次采样 03:28:16 / 03:28:25 / 03:31:03）

- inner 面板那行**仍显示**「Committing observer-registry task work **3h 5m 32s**」，而该括号已闭合
  （d3fb2839，`--task-end needs-human`）、已不在 inProgress（外层复验确认）。
- **计时器 3h5m32s 一秒未动**，同屏其它 agent 计时正常前进（1h6m3s→1h6m37s、21m7s→21m41s）。
- 算术对得上：括号 ~00:14 开始，agent 跑 3h5m32s ⇒ ~03:22 结束，任务正是 **03:22:02 转 needs-human**。

### 危害（2026-08-07 03:3x 更正——不是永久留存，是清理前的误导窗口）

**在已死行【被清理之前】的那段窗口里，它与存活行外观完全相同**——唯一区别是计时是否前进，
而这需要跨时间两次采样才能分辨。三次采样（03:28:16 / 03:28:25 / 03:31:03）证实其计时器一秒未动、
同屏其它 agent 正常前进——在那段窗口内，区分「已结束」与「在运行」的唯一信号是计时前进，
而它需要跨时间采样。人正是在那段窗口里看到它并发问的。

**更正**：面板【会】自行清理已结束的 agent——observer-registry 行 03:37:32 已消失（面板只剩两个活跃
agent）。**不是「冻结时长永久留在面板上」**，而是【已死行在被清理前存在一段可观测的误导窗口】。
窗口长度未测（至少覆盖 03:28→03:31，到 03:37 前已清理；要精确需专门观测，不编造数字）。

### 与今晚反复出现的一族同形

仪器无法区分两个语义相反的状态。此前是「**卡死 vs 真在跑**」（管理者为此误判过两次），
现在是「**已结束 vs 在运行**」。两个方向都是同一个缺陷：**观测视图没有表达状态转换的机制**，
只能靠人跨时间采样猜。

### 相关但不同（不合并）

- `gap-closed-bracket-leaves-live-agent-consuming-slots`（括号关、agent 进程还活着，资源记账盲区）：
  那条的 agent 进程是**活的**（↑ 输出中）；本条的面板行是**死的**（计时冻结 = 进程已死）——方向相反，
  不合并。
- 本条是**显示/观测**缺陷：面板没在括号关闭时清掉/标记该行。

### 修复方向（接法留执行时）

1. **面板反映遥测状态**：括号关闭（--task-end）时，面板对应行应清除或打上「已结束」标记——
   不能让冻结行与存活行外观相同；
2. **或计时冻结即标记**：面板对 N 秒计时未动的 agent 行打「可能已结束/僵死」标记，无需跨时间采样
   即可分辨；
3. **机械可检出**：括号关闭后该 agent 行仍存在 ⇒ 应可被机械检出（与 instrument-failure 检出器族呼应）。

## Contract

```
measure stale_panel_lines = `tmux capture-pane -p -t quay-0:inner 2>/dev/null | grep -cE 'Committing|Running|Waiting|Execute|Checking|Monitoring|Verifying'` stdout 数字段（与 inProgress 对照的差异面）
invariant 面板上括号已关闭任务的 agent 行不得以「冻结计时」形态与存活行外观相同；观测视图必须表达状态转换
invoke `tmux capture-pane -p -t quay-0:inner 2>/dev/null | grep -E 'observer-registry|Committing'`
control 人为关闭一个括号后保留面板行 ⇒ 检测必须报出该行是冻结行（计时未动）；修复后该行被清除或标记
resume 若中断，先跑 measure 读当前面板残留行，再对照 inProgress 区分存活/冻结
```

## Acceptance Criteria

- [x] AC1: **面板表达状态转换**——括号关闭后对应 agent 行被清除或打「已结束」标记（不再与存活行外观相同）
- [x] AC2: **计时冻结可分辨**——面板对计时 N 秒未动的行打标记（或等价机制），无需跨时间采样
- [x] AC3: **负控制**——人为构造「括号关、面板行留」场景，必须能机械检出该冻结行
- [x] AC4: 与 `gap-closed-bracket-leaves-live-agent-consuming-slots`（agent 活方向）、
      `gap-manager-instrument-failures-need-mechanical-detection-not-carefulness`（仪器无法区分相反状态族）
      交叉标注——本族两个方向

## Implementation

**观测机制（状态转换表达）**：`plugin/scripts/inner-panel-stale-check.ts` —— 把「已结束 vs 在运行」
从「要跨时间采样猜」变成机械可读。两个信号：
1. **括号交叉引用（AC1/AC3，单样本）**：行里解析出的 taskId 不在遥测 `inProgress`（括号已关）但行仍在
   ⇒ 打 `ended` 标记；
2. **计时冻结（AC2，两样本）**：同一行两样本计时秒数未前进 ⇒ 打 `frozen` 标记——脚本自己采两个样本，
   人不需要跨时间采样。

**接线**：`plugin/skills/loop-driver/SKILL.md`（Record 步新增面板观测机制段）+ `plugin/loop/
fast-mode-loop-tick.md` 步骤 3（与 `--detect-stop` 同 `last-pane.txt`，每 tick 跑一次，exit 1 =
残留已结束/冻结行）。`plugin/test/inner-panel-stale-check.test.mjs` 14 项全绿。

### AC1 实跑（括号关、行留 → ended，exit 1）

```
$ node inner-panel-stale-check.ts --pane defect-pane.txt --report defect-report.json
inner panel stale-check: STALE
  agent lines: 3  live: 0  ended: 2  frozen: 0  stale: 2
  [ended  ] observer-registry  Committing 11132s  Committing observer-registry task work 3h 5m 32s
  [ended  ] manager-layer      Execute    8640s  Execute manager-layer task work 2h 24m
  [unknown] (no-task)          Waiting    -s     Waiting for full suite run #3 to complete
  STALE lines (bracket closed but line present / timer frozen):
    Committing observer-registry task work 3h 5m 32s
    Execute manager-layer task work 2h 24m
exit=1
```

（`defect-report.json`：observer-registry 已完成 needs-human、manager-layer 已完成 done、inProgress 空——复现
任务实测「observer-registry 括号已关、不在 inProgress、面板行仍在」。）

### AC2 实跑（两样本计时冻结 → frozen）

`defect-pane-after.txt` 与 before 完全相同（observer-registry 3h5m32s 一秒未动）；live-task 对照行
1h6m3s→1h6m37s 正常前进。JSON 输出：

```
verdict: STALE
ended:  ['Committing observer-registry task work 3h 5m 32s', 'Execute manager-layer task work 2h 24m']
frozen: ['Committing observer-registry task work 3h 5m 32s', 'Execute manager-layer task work 2h 24m']
live:   []
exit=1
```

负控制（计时前进的 live 行不得误报 frozen）：`Execute live-task task 1h 6m 3s` → after `1h 6m 37s` ⇒
`CLEAN`、exit 0（测试 `AC2 — a live line whose timer advanced...`）。

### AC3 实跑（人为构造「括号关、面板行留」⇒ 机械检出）

同 AC1 场景即 AC3 的构造：bracket 关（inProgress 空）而面板行留。观测器必须报 STALE、exit 1 —— 上面
AC1 输出已示（exit=1）。对应测试：`AC3 — CLI exit 1 when the frozen/ended line is present` 与
`AC3 — CLI JSON output carries the per-line state machine` 均绿。live 面板（quay-0:inner 实况，3 个
在飞 subagent 计时正常）实跑 `verdict: CLEAN, exit 0` —— 正控制成立。

### AC4 实跑（交叉标注）

- `tasks/gap-closed-bracket-leaves-live-agent-consuming-slots.md`：Touches 增加本任务交叉标注
  （同族反向：该任务是「括号关、agent 进程活」= 进程方向；本任务是「括号关、面板行冻结残留」= 显示方向，
  由同一观测机制表达「括号关 ≠ agent 退出/结束」）。
- `tasks/gap-manager-instrument-failures-need-mechanical-detection-not-carefulness.md`：Touches 增加
  本任务交叉标注（同族：散文规则被证无效、需机械检出；ended-vs-running 方向交给
  `inner-panel-stale-check.ts` 机械检出）。
- **反向已落地（2026-08-08，由本任务转达的缺口立案）**：同族的「管理者仪器失效五族」已由
  `plugin/scripts/instrument-failure-check.ts --gate` 机械检出（band ≥5 + shrink-only，已接入
  `scripts/test.sh` 静态 tier）——五族任何一族失去检出路径或新增失效形态都会使 gate 红。
  与 `inner-panel-stale-check.ts` 是同一设计族（观测失效 → 机械检出，而非散文规则）。

### 测试

- `scripts/test.sh plugin/test/inner-panel-stale-check.test.mjs` → 14/14 绿，fail 0 cancelled 0。
- `scripts/test.sh --for-task gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close --allow-thin`
  → scoped 静态层绿（task-contract-check 0 violations），inner-session-check 13/13 绿。
- 静态层独立验证：test-framework-policy / test-impl-census / test-isolation / drive-contract 全绿。

### 本执行验证（2026-08-08，机制在位——已修复，仅核验+记证）

**scoped 闸 + 相关文件**（按任务体「本任务只跑 scoped + 相关文件」）：

- `bash scripts/test.sh --for-task gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close --allow-thin`
  → **exit 0**：scoped 静态层绿（test-framework-policy-check / test-isolation-check /
  test-impl-census-check / task-contract-check 0 violations / drive-contract-check），
  `inner-panel-stale-check.test.mjs` **14/14 pass，fail 0 cancelled 0**。
- `bash scripts/test.sh plugin/test/inner-panel-stale-check.test.mjs` → 相关文件 14/14 绿。

**机制实测（2026-08-08，CLI 端到端）**：

1. **缺陷形状（AC1/AC3，单样本）**：括号关（`inProgress` 空）而面板行留
   （`Committing observer-registry task work 3h 5m 32s`）→
   `inner panel stale-check: STALE`，该行打 `[ended]`，**exit 1** —— 复现任务实测场景。
2. **计时冻结（AC2，两样本）**：observer-registry 行两样本计时 `11132s` 一秒未动 → 标 `frozen`（+`ended`）；
   live-task 对照行 `1h6m3s`→`1h6m37s` 正常前进 → **不误报**。JSON 输出 `verdict: STALE`，exit 1。
3. **正控制（两样本）**：全 live/前进行 → `CLEAN`，**exit 0**。
4. **实况面板（quay-0:inner，2026-08-08）**：5 个在飞 subagent（`--root` 读真实遥测）→ `CLEAN`，**exit 0** ——
   无冻结残留行，对活 agent 无误报（正控制成立，与任务体「实况 live 面板 CLEAN exit 0」一致）。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（含修复前后面板对照：冻结行 STALE exit 1 vs 实况 live 面板 CLEAN exit 0）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**留批量 fan-in 全量闸**（任务体注记：本任务只跑 scoped +
  相关文件；scoped + 相关文件已绿，见「本执行验证 2026-08-08」；全量连跑在 fan-in 全量闸核对）
- [x] 未来 N 次收尾中，不再出现「括号关、面板行冻结残留」的误导（或被机械检出）——观测器已接线，**已观测**：
  2026-08-08 缺陷形状复现 ⇒ 机械检出 STALE exit 1（「或被机械检出」分支成立）；实况面板 quay-0:inner CLEAN exit 0
  （无冻结残留、无误报）。未来收尾的纵向确认随批量 fan-in 全量闸继续。

## Touches
- plugin/skills/loop-driver/SKILL.md（Record 步接线面板观测机制，状态转换表达）
- plugin/scripts/inner-panel-stale-check.ts（新观测器：括号交叉引用 + 计时冻结检出）
- plugin/test/inner-panel-stale-check.test.mjs（新测试：AC1-AC4 14 项）
- plugin/loop/fast-mode-loop-tick.md（步骤 3 每 tick 面板冻结行观测）
- tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close.md（自身文件）
- tasks/gap-closed-bracket-leaves-live-agent-consuming-slots.md（交叉标注）
- tasks/gap-manager-instrument-failures-need-mechanical-detection-not-carefulness.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T03:3xZ
changed: 管理者 2026-08-07 观测发现（面板冻结行与遥测相反），请外层判断 → 裁定立案：同族（仪器无法区分
  相反状态）第二个方向 + 显示/观测缺陷，证据充分（3 采样计时冻结 + 算术核对 + 复验）。

## 交叉标注（2026-08-08，`gap-closed-bracket-leaves-live-agent-consuming-slots`）

**同族反向的两条：本任务「括号关、面板行冻结残留」是显示/观测方向；`gap-closed-bracket-leaves-live-
agent-consuming-slots`「括号关、agent 进程活」是进程方向。** 两方向都由「括号关 ≠ agent 退出/结束」
这个事实驱动：本任务的行冻结 = 已结束（进程退、计时停）；反向任务的 pane 行仍 ↑ 输出 = 进程还活着。
槽位记账的反向修复（`fast-mode-telemetry.ts --slots` 的 `closedButLive` / `occupied_slots`）是进程面
的机械检出，本任务的 `inner-panel-stale-check.ts` 是显示面的机械检出——同一记账/观测面、两个方向。
