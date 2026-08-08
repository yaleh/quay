---
id: gap-permission-prompt-vs-dismissable-prompt-classifier
title: "classifyPaneState 把可忽略式提示/问卷当阻塞式 permission-prompt——恒判忙 ⇒ SESSION-IDLE 永不触发（manager 19:35Z 实测 + 外层核实）"
status: todo
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

- [ ] AC1: **复现固化**——任务体记录 manager 实测（19:35Z 问卷屏 → permission-prompt）+ 外层核实（当前问卷在底部区域外判 waiting-input；PERMISSION_PROMPT_RE 不含问卷字样）——确认位置依赖是误判来源（本任务 Proposal 已含）
- [ ] AC2: **可忽略提示不判忙**——问卷/可忽略提示（`(optional)` / `Dismiss`）出现时 classifyPaneState 判非 permission-prompt，实跑验证
- [ ] AC3: **真权限确认仍判忙**——阻塞式权限确认框（Allow/Deny/Yn）仍判 permission-prompt（负控制），既有 pane-state 测试全绿
- [ ] AC4: **退一步 WARN（若选候选 B）**——permission-prompt 持续 N 轮无 transcript 写入 ⇒ 报 WARN，不无限静默
- [ ] AC5: **位置无关（若选候选 C）**——问卷在屏上任意位置都识别为可忽略

## Definition of Done

- [ ] AC1–AC5 全部勾上（按选定的候选）
- [ ] 修后实跑：inner 显示问卷时 classifyPaneState 判非 permission-prompt；真权限框判 permission-prompt（两方向实跑贴任务体）
- [ ] 既有 pane-state-classify 测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

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
