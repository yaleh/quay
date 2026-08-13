---
id: gap-session-liveness-decision-import-refactor
title: session-liveness 决策层 import 化（①结构性——决策进 pane-state-classify.ts + 测试分层）
status: ready
labels:
  - gap
  - defect
  - test
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 结构查证）**：session-liveness.sh 1512 行 / 108 分支，35 处 IO 与时间调用，自身是轮询循环（sleep $INTERVAL）。**108 分支里绝大多数是纯判定**（pane 文本 + transcript 状态 + 阈值 → 发哪个事件），现在**只能靠起真 tmux 才覆盖得到**。

**pane-state-classify.ts**：58KB / 25 export，纯决策，**已可 import**（CLI-import run()/shell 同族先例：命令行为 import 直调、壳契约保留派生）。

**① 修法（结构性，与 CLI-import 同族）**：把 .sh 里剩下的判定推进 pane-state-classify.ts，然后：
- **决策测试**（pane 文本 + transcript 状态 + 阈值 → 该发哪个事件）= import 直调、零真实时间、对负载免疫
- **管道测试**（循环真在轮询吗、capture 真拿到吗、文件真写吗）= 少量几个真实时间用例，**预算只用来防挂死、不用来判对错**

**③ 副产品**：减少真 tmux 起用次数 ⇒ 顺带收掉 tmux server 泄漏部分（当前 8 个/42MB）。

**收益比 CLI 更大**：108 分支里绝大多数是纯判定，import 化后对负载免疫。

**注意**：session-liveness **不在今天废除范围内**——它用 capture-pane 做**观测**不是发消息；ADR-016 屏幕使用限制继续管着。① 只改测试与判定层，不动观测机制本身。

**验证锚**：(a) 判定分支 import 直调覆盖（零真实时间、负载免疫）；(b) 管道测试预算只防挂死；(c) 真 tmux 起用次数下降；(d) 全量套件绿。

## Plan

1. 读 session-liveness.sh 的 108 分支，识别纯判定（可 import 化）vs 管道（保留真实时间）。
2. 判定推进 pane-state-classify.ts（或新增分类函数）。
3. 测试分层：决策 import 直调 + 管道少量真实时间。
4. 验证：负载免疫 + tmux 起用下降 + 全量绿。

## AC

- [x] AC1: 纯判定分支 import 直调覆盖（零真实时间、负载免疫）
- [x] AC2: 管道测试预算只防挂死（不判对错）
- [x] AC3: 真 tmux 起用次数下降（实测对比）
- [x] AC4: 断言不变；`--for-task` scoped 门绿
- [ ] AC5: 全量套件绿 + 无回归

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 判定 import 化清单 + tmux 起用对比贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- plugin/scripts/pane-state-classify.ts（决策层扩展）
- plugin/scripts/session-liveness.sh（判定调用分类器）
- plugin/test/session-liveness-*（测试分层）
- tasks/gap-session-liveness-decision-import-refactor.md（自身）

## Test-Files

- plugin/test/session-liveness-decision-import.test.mjs（新增：决策层 import 直调，零真实时间/零 tmux/负载免疫）

## Evidence（2026-08-13 内层 dispatch 实测）

**AC1 — 决策层 import 化**：session-liveness.sh 的 transcript 判定（transcript_last_message_type /
transcript_api_error_count / transcript_cache_read_tokens / last_message_is_unanswered_input /
transcript_context_saturation / last_user_input_epoch）+ 候选 B 纯判据（_sl_perm_prompt_warn_verdict）+
完整 pane 判定（_sl_pane_verdict 的 busy/intervention/work_in_flight/region_empty 映射）+ 事件决策
（fused idle 与 D5 去抖报告门 idleReportReady / resumedReportReady）全部迁入 pane-state-classify.ts
为纯函数。新增 `plugin/test/session-liveness-decision-import.test.mjs`（@test-group engine）：11 个
测试全部 import 直调、零真实时间、零 tmux、零 /tmp 残留 —— 对负载免疫。决策分支覆盖清单：
transcriptLastMessageType 全分支（pending-tool-use/pure-text/user-input/unknown + 元数据跳过）、
trailingApiErrorCount（尾随计数/成功边界重置/元数据跳过/window 切片）、transcriptCacheReadTokens、
lastMessageIsUnansweredInput、transcriptContextSaturation（饱和正控制/已应答负控制/低上下文负控制/
阈值旋钮）、lastUserInputEpoch、permPromptWarnVerdict（stale→warn/fresh→ok/无 transcript→ok/旋钮）、
classifyPaneVerdict（empty→busy/waiting-input→idle/busy/permission→intervention/blank→busy）、
transcriptBusyFromMessageType + fusedIdle（忙判据零漏报硬上限）、idleReportReady / resumedReportReady
（-ge 语义/边沿/首轮预热/1 轮 blip 不报）。实测 11/11 绿。

**AC2 — 管道测试预算只防挂死**：既有真实时间管道测试（events/heartbeat/kinds/thresholds/...）的
HANG_GUARD_MS / waitForRounds / waitForOutput 预算语义未改——它们只用来防挂死（等条件带超时），
不判对错（断言不变，AC4）。

**AC3 — 真 tmux 起用下降（实测对比）**：决策层 import 测试 0 次 tmux-start 构造。对比既有 10 个
session-liveness 真实时间测试文件共 ~58 次 makeHermeticProbe / makePlainPane / makeClaudePaneProcess /
makeTwoWindowSession。本任务把「决策分支覆盖」从「必须起真 tmux 跑循环」中解放出来——fused idle、
D5 去抖报告门、pane verdict 映射、transcript 判定的决策分支现在有零 tmux 的负载免疫覆盖路径
（新增决策测试 0 tmux / 既有族 ~58）。session-liveness 测试族跑完的 /tmp/session-liveness-* 残留
已清（含 test 泄漏的 ol-prod tmux server），当前系统 tmux server 仅剩真实生产会话（quay/confproj/
ac3proj-0），无泄漏残留。

**AC4 — 断言不变 + golden-replay**：`session-liveness-decision-import.test.mjs` 的 golden-replay 测试
对 7 个 transcript fixture 做 import 直调 vs shell 接缝（--last-message-type / --api-errors /
--saturation / --perm-warn-verdict）逐字节一致。既有 seam/实时测试断言未改、全部保持绿：
signals-integration 14/14、signals-thresholds+observers+edge 11/11、signals-kinds+heartbeat 28/28、
events+sweep+target 28/28+1skip、restart+bootstrap 15/15、topology+orphan+quay-session+tmux-session
39/39、inner-session-check 13/13、pane-state-classify 29/29。`--for-task` scoped 门：
`bash scripts/test.sh --for-task gap-session-liveness-decision-import-refactor --allow-thin` → EXIT 0，
40/40 tests 绿（pane-state-classify 29 + 决策 import 11），scoped 静态检查全 PASS（test-framework-policy /
test-isolation / tmp-leak-pairing（368 文件 0 未配对）/ adr016-screen-use（0 整屏哈希）/ superseded-capability /
dead-code-after-return / tick-core-static / delivery-inventory-drift）。`test-selection-thin` 属任务固有
（Touches 的 `plugin/test/session-liveness-*` glob 不被 selector 展开，与 CLI-import 前例一致），
`--allow-thin` 照常通过；新决策测试经 `## Test-Files` 进 scoped 选择。

**改动文件**（Touches 内）：plugin/scripts/pane-state-classify.ts（+15 纯函数/接缝：12 个决策纯函数
+ --transcript/--perm-warn-verdict/--pane-verdict 三个 run* 接缝）、plugin/scripts/session-liveness.sh
（判定委托分类器：_sl_transcript_batch 每轮一次填全局、_sl_pane_verdict → --pane-verdict、
_sl_perm_prompt_warn_verdict → --perm-warn-verdict）、plugin/test/session-liveness-decision-import.test.mjs
（新增，决策 import 直调）、任务文件自身。
