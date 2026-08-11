---
id: gap-pane-classify-allow-bare-word-and-agent-list-masks-busy
title: pane-state-classify.ts 两缺陷（manager 对照实验机械证实，行号已定位）：①PERMISSION_PROMPT_RE
  裸词 Allow 无词边界（:59-60）——subagent 描述里的 --allow-thin 命中 ⇒ 满载会话判成
  permission-prompt；②statusArea 取底部最后两行（:97-101）——有 subagent 在飞时 agent
  列表渲染在状态行【下面】把 esc to interrupt 挤出两行窗口 ⇒ busy 判成 waiting-input（idle 掩盖 busy，与
  gap-session-liveness-busy-mask-idle 方向相反）；解释了今晚监视器 IDLE/RESUMED 振荡
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

**`plugin/scripts/pane-state-classify.ts` 有两个独立缺陷，manager 用对照实验机械证实（同一 pane 只改一个词），根因定位到具体行。该文件是三层 pane 读数的判据源（inner-blocked-signal / session-liveness / A4 两层忙闲），两缺陷使其在有 subagent 时全部不可信，并解释了今晚监视器 IDLE/RESUMED 的反复振荡。**

### 实证（manager 2026-08-10 对照实验 + outer 复核原始文件）

- **触发**：监视器报 inner「成因：权限确认框出现」。但 pane 实际显示 `✽ Flambéing… (11m 10s)`、`esc to interrupt`、**两个 subagent 在跑（16m43s/16m41s）**、`⏵⏵ bypass permissions on` —— **没有任何权限框**。
- **缺陷一（:59-60，裸词 `Allow` 无词边界、扫全区域）**：`PERMISSION_PROMPT_RE` = `/Do you want to proceed|Quick safety check|trust this folder|Enter to confirm|Grant access|Allow|Deny|Y\/n\b/i`。inner pane 底部有一行 subagent 描述 `◯ general-purpose  Running scoped gate without --allow-thin for …` ⇒ `--allow-thin` 里的 `allow` 命中裸词 `Allow`。
  - **对照实验（outer 复核，同一段 pane 只改这一个词）**：`--allow-thin` ⇒ `permission-prompt`（confidence 0.85）；`--thin-flag` ⇒ `waiting-input`（0.6）；**正控制**：真 `Quick safety check: trust this folder?` 仍 ⇒ `permission-prompt`（未削弱）。
  - **该文件自己的注释 :56-58 写着「Deliberately does NOT match the word "permissions"（真实 capture 曾正是栽在这个词上）」——修了一个关键词假阳性，留下七个。这是 CLAUDE.md 认识论硬规则 2「按位置判定，不按关键词」的直接反例。**
- **缺陷二（:97-101，独立且更严重，有 subagent 在飞时判不出 busy）**：`statusArea()` 取「底部区域的最后两行非空」，注释假设「状态行及其可能的续行」；但有 subagent 在飞时 TUI 把 agent 列表渲染在状态行【下面】：
  `⏵⏵ … esc to interrupt … ← 1 agent` / `● main` / `◯ general-purpose …` / `◯ general-purpose …` ⇒ 最后两行是 agent 列表，`esc to interrupt` 落在区域内但不在那两行 ⇒ `BUSY_RE` 判不到。
  - **对照实验（outer 复核）**：busy + 2 agent 列表 + ❯ gutter ⇒ `waiting-input`（0.6）；同一 pane 无 agent 列表 ⇒ `busy`（0.9）。上条实验里 `--thin-flag` 那次判成 `waiting-input` 而非 busy，就是这个缺陷单独作用的结果——**一个满载跑 2 个 subagent 的会话被读成「空闲等输入」**。
- **后果（manager 一并评估，outer 确认）**：
  ① 解释今晚监视器 IDLE/RESUMED 反复振荡——agent 起停时列表出现/消失，把状态行推出/拉回两行窗口，分类器在 busy 与 waiting-input 之间翻转；
  ② 三层所有 pane 读数（A4 两层忙闲、inner-blocked-signal、session-liveness）**在有 subagent 时全部不可信**；
  ③ 方向与 `tasks/gap-session-liveness-busy-mask-idle-with-subagents` 相反：那条讲 busy 掩盖 idle，**这条是 idle 掩盖 busy**；
  ④ 该文件 :81-94 长篇论证过 false-IDLE 风险（「a busy pane whose work line is scrolled out of the bottom region would read idle」）——方向预见到了，但没预见到**把状态行挤出去的是 agent 列表本身**。

**为什么重要**：pane-state-classify.ts 是三层 pane 读数的唯一判据源。今晚监视器振荡 + 「权限确认框出现」误报（实际无框）直接干扰了 inner-blocked 判定（A7）与忙闲读数（A4）。这是 C17 + 认识论硬规则 2 的又一次实例：关键词假阳性修了 `permissions` 漏了 `Allow`（无词边界），结构假设（状态行在最底部两行）被 TUI 的 agent 列表渲染打破。

### 选定机制方向（实现归 inner，判定归 outer）

1. **缺陷一修法方向**：`Allow` 改为带词边界/位置判定的形态——裸词 `Allow` 必须不命中子串（`--allow-thin` 里的是 flag 值不是对话框按钮）；`Grant access`/`Deny` 同族核查。**不能只加词边界**——`Deny`/`Allow` 可能出现在消息正文；应按「权限框形状」判定（如这些按钮词 + 无 dismissable 分支）或按位置（这些词出现在可操作按钮行）。
2. **缺陷二修法方向**：`statusArea()` 的「最后两行」假设被 agent 列表打破——需要把 `esc to interrupt` 的判定窗口从「最后两行」改为「底部区域内任意状态行」或显式跳过 agent 列表行（`● main` / `◯ general-purpose …` / `← N agent`）。注意 :81-94 的 false-IDLE 论证——不能退回整屏扫描（会重新引入「消息正文引述 esc」的假阳性），需精确排除 agent 列表行。
3. **三条 AC（manager 建议，防修一个漏另一个——该文件历史正是修了 `permissions` 漏了 `Allow`）**：
   - 正控制：真权限框（`Quick safety check` / `Do you want to proceed`）仍 ⇒ `permission-prompt`；
   - 负控制：含 `--allow-thin` 的 subagent 描述不得 ⇒ `permission-prompt`；
   - busy 控制：有 agent 列表（`● main` / `◯ general-purpose …`）在飞时仍 ⇒ `busy`（不得 waiting-input）。

**验证锚**：修后 (a) 缺陷一对照实验（`--allow-thin` ⇒ 非 permission-prompt；真权限框 ⇒ permission-prompt）通过；(b) 缺陷二对照实验（busy + 2 agent ⇒ busy；busy 无 agent ⇒ busy）通过；(c) 既有测试不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 manager 对照实验（缺陷一：--allow-thin vs --thin-flag；缺陷二：busy+agent vs busy）+ outer 复核（同一 pane 只改一词）+ 行号 :59-60 / :97-101（本任务 Proposal 已含）
- [x] AC2: **缺陷一修复**——`PERMISSION_PROMPT_RE` 裸词 `Allow`（及同族 `Deny`/`Grant access`）不再命中子串（`--allow-thin` 不误报）；真权限框仍判 permission-prompt（正控制）
      （`Allow`/`Deny` 的成对/行首形状判定已由前序任务 gap-pane-state-allow-deny-bare-word-false-positive
      commit 1b10bd02 落地；本任务增量：`Grant access` 同族收口为对话框问句形状 + 双侧测试。）
- [x] AC3: **缺陷二修复**——有 subagent 在飞（`● main` / `◯ general-purpose` / `← N agent` 在底部区域）时仍判 busy，不落 waiting-input；无 agent 时 busy 判定不回归
- [x] AC4: **位置判定不退回整屏**——`esc to interrupt` 判定窗口仍限状态行区域，不因修复退回整屏扫描（:81-94 false-IDLE 论证不回归）；消息正文引述「esc to interrupt」不得判 busy
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（含 pane-state-classify.test.mjs / inner-blocked-signal 相关测试）

## Evidence（inner 2026-08-11）

**Contract measures（任务体 Contract 四键全过）**：
```
allow_thin_not_permission  = unknown        （band: != 'permission-prompt' ✓）
busy_with_agents_is_busy   = busy           （band: == 'busy' ✓）
real_permission_still_prompt = 1            （invariant ✓）
quote_esc_not_busy          = 1             （invariant ✓）
```

**缺陷一对照实验（同一 pane 只改一词）**：
```
--allow-thin  → {"state":"unknown",...}
--thin-flag   → {"state":"unknown",...}
正控制 Quick safety check: trust this folder? → {"state":"permission-prompt","confidence":0.85,...}
```

**缺陷二对照实验**：
```
busy + 2 agent（● main / ◯ general-purpose 在状态行下面）→ {"state":"busy","confidence":0.9,...}
busy 无 agent 列表                                              → {"state":"busy","confidence":0.9,...}
```

**scoped 门**：`./scripts/test.sh --for-task gap-pane-classify-allow-bare-word-and-agent-list-masks-busy --allow-thin`
→ `ℹ tests 59 / pass 59 / fail 0 / cancelled 0`（exit 0）。`--for-task` 不带 `--allow-thin` 时 selector 报
`test-selection-thin (selector exit 1)`——Touches 7 项中 4 项为交叉标注 markdown（无对应测试文件），覆盖率
0.43<0.5，系 Touches 构成的固有属性（baseline 同此），非测试失败；选中集（pane-state-classify +
inner-blocked-signal）全绿。session-liveness-signals 的 busy-presence 用例单独跑绿（9s，真实 tmux 集成）。

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：缺陷一/缺陷二对照实验全过（贴输出）；真权限框正控制未削弱
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/pane-state-classify.ts（缺陷一 :59-60 `PERMISSION_PROMPT_RE` 裸词修复；缺陷二 :97-101 `statusArea` 窗口修复）
- plugin/test/pane-state-classify.test.mjs（AC2-AC4 测试：--allow-thin 负控制 / 真权限框正控制 / agent 列表 busy 控制 / 引述 esc 负控制）
- plugin/test/inner-blocked-signal.test.mjs（AC3 关联——inner-blocked-signal 读 pane-state-classify 的判据）
- tasks/gap-session-liveness-busy-mask-idle-with-subagents.md（交叉标注——同族，方向相反：那条 busy 掩盖 idle，这条 idle 掩盖 busy）
- tasks/gap-permission-prompt-vs-dismissable-prompt-classifier.md（交叉标注——permission-prompt 判定家族）
- tasks/gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable.md（交叉标注——pane 判定家族）
- tasks/gap-pane-classify-allow-bare-word-and-agent-list-masks-busy.md（自身：勾 AC + 贴证据）

## Contract

measure   allow_thin_not_permission = `node --no-warnings --experimental-strip-types --input-type=module -e "import{classifyPaneState}from'./plugin/scripts/pane-state-classify.ts';console.log(classifyPaneState('◯ general-purpose  Running scoped gate without --allow-thin for …').state)"` 的 stdout
band      allow_thin_not_permission != 'permission-prompt'（含 --allow-thin 的 subagent 描述不误报）
measure   busy_with_agents_is_busy = `node --no-warnings --experimental-strip-types --input-type=module -e "import{classifyPaneState}from'./plugin/scripts/pane-state-classify.ts';console.log(classifyPaneState(['⏵⏵ bypass permissions on','  esc to interrupt  ← 1 agent','  ● main','  ◯ general-purpose  running','❯'].join('\\n')).state)"` 的 stdout
band      busy_with_agents_is_busy = busy（有 agent 列表时仍判 busy）
invariant real_permission_still_prompt = 1（真权限框正控制不削弱）
invariant quote_esc_not_busy = 1（消息正文引述 esc to interrupt 不判 busy）
invoke    `node --no-warnings --experimental-strip-types --input-type=module -e "import{classifyPaneState}from'./plugin/scripts/pane-state-classify.ts';console.log(JSON.stringify(classifyPaneState(process.argv[1])))" <fixture>`（贴两类对照实验输出）
control   缺陷一/缺陷二对照实验全过；真权限框正控制；引述 esc 负控制；busy 判定不回归
resume    缺陷一 / 缺陷二 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 对照实验机械证实（同一 pane 只改一词），根因定位 :59-60（裸词 Allow 无词边界）与 :97-101（statusArea 最后两行被 agent 列表挤出）——outer 复核原始文件 + 复跑对照实验均确认。影响三层所有 pane 读数 + 今晚监视器振荡。立案：缺陷一/缺陷二 + 三条控制 AC。实现归 inner，判定归 outer
