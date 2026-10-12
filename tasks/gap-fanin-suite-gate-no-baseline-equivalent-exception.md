---
id: gap-fanin-suite-gate-no-baseline-equivalent-exception
title: fan-in 的 suite 步没有"已证明与 develop 基线等价的既存红"豁免档，导致多个独立修复互为落地门槛（三任务循环死锁实例）
status: todo
labels:
  - gap
  - infra
parent: null
children: []
extra:
  schema: execution
---
## Proposal

本次在兄弟项目 quay-fleet 观测到一次真实的三方循环死锁：三个独立任务（`fleet-p2-dogfood-d2-d3-epoch-bound-and-d3b-scope-fix`、`fleet-p2-authority-countersign-reachable`、`fleet-p2-needs-human-autoresume-mechanism`）各自完整实现并验证了对**同一棵 develop 上三个既存红测试之一**的修复（各自 4-6 条 AC 全部勾选、各自独立 A/B 证明零回归），但没有一个能让自己的 `node --test` 全量退出码 0——因为另外两个红点仍然存在于 develop，而 fan-in 的 suite 步要求全量套件 0 红，没有"这个红点是既存的、与我的 diff 无关、我已经证明过"这一档。三者互为落地门槛：谁先合都会被另外两个挡住，而把多个任务的分支合并进同一个工作树去"一次做完"会被 `anti-drift`（它按 `git log --not develop develop` 的**提交历史**判断"本任务动了哪些文件"，不是按 `## Touches`）判成 out-of-declared，且会把未验收的工作经由本任务不透明地送进 develop。

这不是安全判据问题——三个任务都没有放宽任何验收标准，都严格拒绝了伪造台账行、放宽判据措辞、滥用（待外部）标记、挪动评估窗口等捷径。这是一个**落地顺序/机制缺口**问题：`worker-driver.ts` 的 suite 步目前只有两种结局（全绿 / 红），没有第三种"已证明的既存红、不是本次新增、不会让 develop 变得更差"。

**顺带发现一条可能相关的版本滞后**：本项目（quay）自己的 `gap-park-reason-mislabels-ac-precheck-as-suite-red`（已 done）修复过"AC 未全勾短路被误标成 suite 红、归因不出"的问题，但 quay-fleet 项目观测到的真实 needs-human 记录（`fleet-p2-wake-claimable-budget`/`fleet-p2-needs-human-autoresume-mechanism`）里仍然出现一字不差的症状（"exited-not-landed 失败无法归因...parser extracted 0 of 0 failing lines"）。怀疑是因为 quay-fleet 使用的是插件缓存版本 `~/.claude/plugins/cache/quay/quay/0.19.0/`，而这条修复可能只存在于本项目（quay）自己的 dev 检出里、尚未发布到该缓存版本——如果属实，升级 quay-fleet 的插件版本本身也能解决一部分现象（但不解决本任务提议的"既存红豁免"这个缺口，两者是独立的）。本任务不对这条滞后做结论，只如实记录供实现者核实。

## 期望能力（设计方向，供实现者细化）

1. **机器执行的 A/B，不是 prose 声明**：fan-in 在 suite 步红时，自动用同一提交点起一个 detached worktree @ develop，重跑**相同**的失败测试集，比对失败测试 id 与断言文本是否逐字相同。只有完全相同的红点集合才可能进入"既存"豁免档；任何新增或变化的红点仍然硬红，不豁免。
2. **只允许"不变差"，不允许"打折"**：豁免的唯一后果是允许本次 fan-in 在"既存红点集合不变"的前提下继续推进（typecheck/ff 等后续步骤），⛔ 不允许清空/减少对**新增**红点的任何容忍度，也不允许这档豁免被用来放行真正由本次 diff 引入的红。
3. **强制的落地后复验**：ff 到 develop 之后，立即对 develop HEAD 重跑一次全量套件并记录读数（不要求这次必须 0 红——只要求这个读数被记下来、可审计，供下一个任务的 A/B 复用，避免每个任务都要重新发现同一个既存红）。
4. **电路断路器**：若同一个任务连续 N 轮（N 可配置，建议与现有 `RETRY_CAP_DEFAULT` 对齐）都因**同一个失败签名**（同一组既存红点 id）被挡在 suite 步，且该签名在人工/Manager 介入前没有变化，停止自动重派（现有机制对 `ac-not-checked-shortcircuit` 已有类似的"烧到 RETRY_CAP 转 needs-human"行为，但目前**没有**对"suite 步连续撞同一个签名"做同样的识别与停止——它会继续 count-and-retry，而不会主动提示"这是一个三方循环死锁，需要人决定落地顺序"）。
5. **明确非目标**：不改变任何既存判据（D1-D5、authority 的拒绝面等）的实质要求；不允许"既存红"这一档被滥用成通用的 suite 豁免；不与现有 `isOuterVerificationItem` 合并或复用（那是 AC-completion 语义的出口，本提案是 suite-gate 本身的出口，两者必须分开，`isBodyLanded` 等读 `isOuterVerificationItem` 的下游逻辑不应意外读到这一档）。

## AC（草拟，由实现者细化为可执行断言）

- [ ] 一个正控夹具：两个任务分支各修一个既存红，suite 步能在"既存红点集合逐字不变"时继续推进，不是硬红
- [ ] 一个负控夹具：任务分支自己新增了一个不在既存红点集合里的失败，不得被豁免
- [ ] 一个负控夹具：既存红点的断言文本发生变化（即使测试 id 相同），不得被当成"同一个"豁免
- [ ] 电路断路器夹具：连续 N 轮同一签名 ⇒ 停止自动重派，产出可读的"循环死锁"诊断（哪几个任务、各自持有哪个红点的修复、建议的落地顺序）
- [ ] 真实验证：在一个真实或接近真实的仓库状态上复现本次 quay-fleet 的三方死锁形态（或等价的双任务形态），证明新机制能把其中至少一个解放出来而不绕过任何既存判据

## DoD

真实复现过一次"N 个任务互为落地门槛"的场景，证明新机制能机械地（不是人工 argue）区分"既存红、可继续"与"新增红、仍然拦截"，且落地后强制复验读数留痕。

## Touches

（留给实现者按 worker-driver.ts 的真实结构填写——本任务由 quay-fleet 项目的巡检会话代为登记，不熟悉 quay 项目内部实现细节，不代填 Touches）

## Origin

2026-10-12，由 quay-fleet 项目的巡检会话发现并登记：三个真实任务（见上）各自独立修复、独立验证、零回归，却因为 fan-in 的 suite 步没有"既存红豁免"机制而互相卡死。详细读数见 quay-fleet 项目 `tasks/fleet-p2-dogfood-d2-d3-epoch-bound-and-d3b-scope-fix.md` 的「Worker 轮次记录」第三、四轮（§8/§9），含逐字的 A/B 对照、anti-drift 的提交历史判定机制、以及"把三处红点全部合并进同一分支"为何被正确拒绝的论证。

查重核实（2026-10-12）：`gap-executor-unsatisfiable-ac-unannotated-burns-rounds`（已 done，修的是未标注待外部的不可满足 AC）与 `gap-park-reason-mislabels-ac-precheck-as-suite-red`（已 done，修的是 AC 短路被误标成 suite 红）均与本提案不同——两者都是"误判"类缺口，本提案是"真红但已证明既存、需要落地顺序豁免"这个全新的机制缺口，三者不重叠。
