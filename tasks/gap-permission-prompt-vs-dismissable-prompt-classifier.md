---
id: gap-permission-prompt-vs-dismissable-prompt-classifier
title: "classifyPaneState 把可忽略式提示/问卷当阻塞式 permission-prompt——恒判忙 ⇒ SESSION-IDLE 永不触发（manager 19:35Z 实测 + 外层核实）"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**classifyPaneState 的 `permission-prompt` 不区分「阻塞式权限确认」与「可忽略式提示/问卷」——可忽略提示被当忙，SESSION-IDLE 永不触发（与 D5 同族的观测面静默）。**

**manager 实测（2026-08-08 19:35Z，inner pane）**：屏幕底部显示 `● How is Claude doing this session? (optional) / 1: Bad 2: Fine 3: Good 0: Dismiss`——**可忽略的反馈问卷**。`classifyPaneState` 对该屏返回 **`{"state":"permission-prompt"}`** ⇒ 按 `_sl_pane_verdict` 判**忙**。

**发现路径**（manager 自述）：收到的 SESSION-RESUMED 里成因字段写「**权限确认框出现**」而非平常的 `esc to interrupt`——**成因字段暴露的，不是状态本身**。（§1.6 对 RESUMED 本不深查，因成因不同才看了一眼。）

**后果**：只要问卷显示着，该会话恒判忙 ⇒ **SESSION-IDLE 永不触发**——与今天追三小时的 D5 同族沉默（形状一样、门不一样）。问卷 `(optional)` + `0: Dismiss` 是可忽略的，真权限框无 dismiss 分支。

**外层核实（19:3x）**：当前 inner capture（问卷在第 41-42 行，**底部区域外**）判 `waiting-input`（不误判）；构造的问卷屏（含状态区）判 waiting-input/unknown。**PERMISSION_PROMPT_RE**（`/Do you want to proceed|Quick safety check|trust this folder|Enter to confirm|Grant access|Allow|Deny|Y\/n\b/i`）**不含问卷字样**。⇒ 当前实现问卷不在底部区域时正常；**manager 实测 permission-prompt 时问卷在底部区域**（滚动位置依赖），或屏有其它匹配元素——**位置依赖是误判的不稳定来源**。

**判据建议（manager，实现归内层）**：
1. **`permission-prompt` 应区分「阻塞式权限确认」与「可忽略式提示/问卷」**——后者不应构成忙。可用区分特征：问卷带 `(optional)` 与 `0: Dismiss` 选项，真权限框无 dismiss 分支。
2. **退一步判据**：`permission-prompt` 状态持续超过 N 轮仍无 transcript 写入 ⇒ 至少报一次 WARN，不能无限静默。

**修的方向（实现归内层，方向外层/manager 已定）**：
- 候选 A：**扩展 PERMISSION_PROMPT_RE 排除可忽略式**——`(optional)` / `Dismiss` / 问卷特征出现时判 waiting-input（非 permission-prompt），或加「可忽略提示」分支。
- 候选 B：**permission-prompt 加 transcript 交叉正控制**——permission-prompt 持续 N 轮无 transcript 写入 ⇒ 报 WARN（manager 退一步判据），不无限静默。
- 候选 C：**位置无关判定**——问卷/可忽略提示的识别不依赖底部区域位置（问卷在屏上任意位置都应识别）。

**验证锚**：修后，inner 显示问卷时（无论滚动位置）classifyPaneState 判非 permission-prompt（waiting-input 或 WARN），SESSION-IDLE 不受问卷阻断；真权限确认框仍判 permission-prompt（忙）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 manager 实测（19:35Z 问卷屏 → permission-prompt）+ 外层核实（当前问卷在底部区域外判 waiting-input；PERMISSION_PROMPT_RE 不含问卷字样）——确认位置依赖是误判来源（本任务 Proposal 已含）；内层补一份构造复现 fixture（questionnaire-dismissable-1.txt）并确认误判源是问卷自己的 `Enter to confirm` 键位 chrome 触发 PERMISSION_PROMPT_RE（见 Evidence）
- [x] AC2: **可忽略提示不判忙**——问卷/可忽略提示（`(optional)` / `Dismiss`）出现时 classifyPaneState 判非 permission-prompt（waiting-input），实跑验证（见 Evidence）
- [x] AC3: **真权限确认仍判忙**——阻塞式权限确认框（Allow/Deny/Yn）仍判 permission-prompt（负控制），既有 pane-state 测试全绿（20/20，见 Evidence）
- [x] AC4: **退一步 WARN（候选 B 已选）**——permission-prompt 持续 N 轮无 transcript 写入 ⇒ 报 WARN（`_sl_perm_prompt_warn_verdict` + 主循环接线，不无限静默），纯判据 + 主循环实跑测试（见 Evidence）
- [x] AC5: **位置无关（候选 C 未选，A+B 已覆盖等价语义）**——未选候选 C；位置依赖已由候选 A 在误判发生面（问卷在底部区域时）消除：同屏问卷在/不在底部区域都判非 permission-prompt（AC1/AC2 测试覆盖），不整屏扫描（ADR-016 boundary b）

## Definition of Done

- [x] AC1–AC5 全部勾上（按选定的候选：A+B 选定；AC5 属候选 C 未选——见 AC5 说明）
- [x] 修后实跑：inner 显示问卷时 classifyPaneState 判非 permission-prompt（waiting-input）；真权限框判 permission-prompt（两方向实跑贴任务体，见 Evidence）
- [x] 既有 pane-state-classify 测试 + 新增测试全绿（`--for-task` scoped，见 Evidence）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——批量合边界闸门（`gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`）：内层任务只跑 `--for-task` 选中集，全量套件由外层异步 verification-round 验证（见 Evidence）

## Touches

- plugin/scripts/pane-state-classify.ts（PERMISSION_PROMPT_RE 或加可忽略提示分支）
- plugin/test/（pane-state-classify 相关测试 + 新增）
- plugin/scripts/session-liveness.sh（若候选 B：permission-prompt 交叉正控制）
- tasks/gap-permission-prompt-vs-dismissable-prompt-classifier.md（自身：勾 AC + 贴证据）

## 实跑证据（2026-08-08 19:3xZ）

```bash
# manager 实测（19:35Z，inner pane）：问卷屏 → {"state":"permission-prompt"} → 判忙
# 外层核实（19:3x）：当前 inner capture 问卷在 41-42 行（底部区域外）→ waiting-input；
#   PERMISSION_PROMPT_RE = /Do you want to proceed|Quick safety check|trust this folder|Enter to
#   confirm|Grant access|Allow|Deny|Y\/n\b/i 不含问卷字样（How is Claude / optional / Dismiss）。
# ⇒ 位置依赖：问卷滚到底部区域时误判 permission-prompt（manager 实测），底部区域外时正常（外层核实）。
```

## Evidence（内层实现 2026-08-08）

**候选选定**：A（扩展 PERMISSION_PROMPT_RE 排除可忽略提示）+ B（permission-prompt 持续 N 轮无 transcript 写入 ⇒ WARN）。C 未选（整屏扫描违反 ADR-016 boundary b；位置依赖已在误判发生面由 A 消除）。

**AC1 复现固化**：补 fixture `plugin/test/fixtures/pane-states/questionnaire-dismissable-1.txt`（构造复现——fleet 无问卷 overlay 的字节级实录，按 manager 19:35Z 记录 + Claude Code 问卷自己的键位 chrome 重建）。误判源确认：问卷 footer 的 `↑/↓ navigate · Enter to confirm · Esc to cancel` 中 **`Enter to confirm` 命中 PERMISSION_PROMPT_RE**——修前同屏问卷在底部区域判 `permission-prompt`（busy），滚动出底部区域判 `waiting-input`（position dependence）；修后两种位置都判 `waiting-input`。实测：

```bash
# 修前（permission-prompt 误判——问卷在底部区域，Enter to confirm 命中）
echo '<问卷屏>' | node pane-state-classify.ts --classify | head -1   # permission-prompt
# 修后
node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --selfcheck   # 19 passed, 0 failed
```

**AC2/AC3 实跑（两方向）**：

```bash
$ bash plugin/scripts/session-liveness.sh --pane-state < questionnaire屏     # state=waiting-input busy=0
$ bash plugin/scripts/session-liveness.sh --pane-state < 真权限确认框屏       # state=permission-prompt busy=1
```

**AC4（候选 B）**：`session-liveness.sh` 新增 `PERM_PROMPT_WARN_ROUNDS`（默认 3）/ `PERM_PROMPT_TX_WINDOW`（默认 60s）+ 纯判据 `_sl_perm_prompt_warn_verdict` + 主循环每目标接线（`PERM_CONSEC` / `PREV_PERM_WARNED`，WARN 只去 stderr、每段一次、不改忙闲判据）+ `--perm-warn-verdict` 接缝。纯判据：`3 轮 + transcript 陈旧 120s` ⇒ warn；`3 轮 + 新鲜 10s` ⇒ ok（交叉正控制）；`2 轮` ⇒ ok；`无 transcript(-1)` ⇒ ok。主循环实跑：probe pane 显示 permission-prompt + 陈旧 transcript，3 轮后 stderr 报 `WARN … 连续 3 轮 permission-prompt 且 transcript 最近 Ns 未写入`。

**测试结果**：
- `plugin/test/pane-state-classify.test.mjs`：**20/20 绿**（含新增 AC1 复现/位置依赖、AC2 可忽略提示、AC3 负控制三测试 + questionnaire fixture）。
- `plugin/test/session-liveness-signals.test.mjs`：**30/30 绿**（含新增候选 B 纯判据 + 主循环接线两测试）。
- 既有 pane-state 相关测试（`blocked-signal-parameterized` / `ruling-required-wiring` 的 permission-prompt 断言）：不受影响——真权限框 fixture 无 dismissable 标记，仍判 permission-prompt。
- `--for-task gap-permission-prompt-vs-dismissable-prompt-classifier` scoped 门：见下方。

**DoD 全量套件说明**：全量套件是批量合边界闸门（`gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`），由外层异步 verification-round 验证（`FULL-SUITE-EXIT=0` / `cancelled 0`）；内层任务按 fast-mode-loop-tick 只跑 `--for-task` 选中集，不跑全量。此 DoD 项留待外层批量合闸门，非本任务 scoped 范围。

## Contract

measure   questionnaire_not_busy = inner 显示问卷时 `bash plugin/scripts/session-liveness.sh --pane-state` 判 state
band      questionnaire_not_busy = waiting-input 或 WARN（非 permission-prompt，SESSION-IDLE 不受阻）
invariant real_permission_still_busy = 1（真权限确认框仍判 permission-prompt，AC3 负控制）
invariant dismissable_detected = 1（问卷/可忽略提示被识别，不构成忙）
invoke    `bash plugin/scripts/session-liveness.sh --pane-state`（对 inner 问卷屏实跑贴回）
control   问卷屏 ⇒ 非 permission-prompt；真权限框 ⇒ permission-prompt（负控制）
resume    分类修正 + 测试 + 文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 19:35Z 实测 + 外层核实位置依赖；方向已定候选 A/B/C，实现与测试归内层）
