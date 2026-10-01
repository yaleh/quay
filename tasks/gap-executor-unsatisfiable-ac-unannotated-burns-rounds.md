---
id: gap-executor-unsatisfiable-ac-unannotated-burns-rounds
title: 执行者结构上勾不了的 AC（人工关卡 / 落地后才能满足）未带（待外部）标注就进了 ready——worker 做完其余全部仍被判「AC 未全勾」整轮作废
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：fan-in 的 AC 完成闸（`plugin/scripts/fan-in-ac-completion-gate.ts`，与 worker-driver 的 AC 未全勾短路同源）规定：未勾项若全部带 `（待外部）` 标注则可翻 done，未标注的未勾项默认算「待本任务」（fail-closed，`plugin/scripts/ready-pool-check.ts` `isExternalVerificationItem` 一带的注释写明）。这个默认是对的。缺口在撰写侧：一条 AC 的原文已经声明「执行者不得代写 / 只能由人写入 / 合入 develop 之后 / 落地后实测」，却没有带 `（待外部）` 标注，todo→ready 闸不拦 ⇒ 任务进 ready ⇒ worker 把能做的都做完，剩这一条结构上勾不了 ⇒ 每轮都判「AC 未全勾」，整轮作废，直到被停派。

**生产读数（claudecodeui，全期，用 develop reflog 回推预检时刻的任务体）**：「预检读数 == 各 ref 读数且 < 总数」共 38 轮；其中只漏 1 条的 15 轮按原文分族——
- 人工关卡 / 只能由人写入：6 轮（3 个任务各 2 轮）。逐字样本：`AC9 人评审门：ADR 的评审裁定已由人给出…这条 AC 不得由执行者代写`；`AC7 人工关卡——冒烟验收已由人确认：grep -q '^冒烟验收：通过' …该行只能由人 yale 写入，执行者不得代写`；`人工关卡——忙时输入基准已由人确认…该行只能由人 yale 写入`
- 落地后才能满足：3 轮。逐字样本：`AC6 真实落地（合入 develop 并推送 yaleh 之后）：触发 Desktop Release…`；`落地后实测复查：sqlite3 … 里 agent 档不再增长`
- 需要真实 fan-in 跑一轮：1 轮
- 下一轮才有读数：1 轮
- 普通可执行命令：4 轮
⇒ 15 轮里 10 轮（6 个任务）是执行者结构上勾不了的 AC。

**修法（方向，实现者可调；请先在方案 a / b 中取一并写明理由）**：
- a. todo→ready 闸（`ready-pool-check.ts`）增加一项机械检查：未勾 AC 项的正文若含「执行者不可满足」的声明而该项没有 `（待外部）` 标注，则该任务不具备晋升资格，并在 `--json` 的 candidates 条目里给出独立的原因字段（点名是哪一条）。判定必须按位置（只看 AC/DoD 段内的清单项正文，不看代码围栏、引用与其它段落——硬规则 2），声明词表是封闭枚举并写在一处。
- b. 不在机械闸里做词表匹配，改由 pool 质量语义闸（`pool-quality-judge` workflow）对每个候选任务判「是否存在执行者不可满足而未标注的 AC」，判 needs-work 时点名该条。
两案都要求：输出含「未评估」态（AC 段读不懂 ≠ 合格）；不改变 fan-in 完成闸对未标注项的 fail-closed 默认；⛔ 不让 worker 自己给 AC 加 `（待外部）` 标注（那是自我豁免）。
另：`plugin/skills/quay-file-task/SKILL.md` 第 3 步补一句撰写约定——人工关卡与落地后才能满足的 AC 必须带 `（待外部）` 标注，且标注须位于该项首行行尾。

<!-- dedup-ref -->相关但机制不同：`gap-fan-in-ac-precheck-before-suite`（done）与 `gap-worker-ac-check-shortcircuit`（done）让未全勾更早、更便宜地失败，本任务让这类任务不以未标注形态进入 ready。

## AC

- [ ] 所选方案的测试文件退出 0（方案 a：`node --test plugin/test/ready-pool-check-s22.test.mjs`；方案 b：对应 workflow 的测试），且新增用例以上面三条逐字样本为 fixture：未带 `（待外部）` 标注 ⇒ 判为不可晋升 / needs-work 且输出点名该条；同一条在首行行尾补上 `（待外部）` ⇒ 不再被该项检查拦下。
- [ ] 负控制：一条普通可执行 AC（样本：`node scripts/asr-second-adapter-check.mjs 退出 0`）未勾且未标注 ⇒ 不被本检查命中（本检查不得把所有未勾项都拦下）。
- [ ] 位置判定：声明词出现在 `## Proposal` 正文或代码围栏内、而 AC 清单项里没有 ⇒ 不命中（用例断言）。
- [ ] 未评估态：任务体没有可识别的 AC/DoD 段 ⇒ 输出为独立的未评估取值，断言它不等于「合格」取值。
- [ ] 取假：关闭新检查后，第一条 AC 的「未带标注」臂变绿放行（在 `## Evidence` 附实跑输出）。
- [ ] `grep -n "待外部" plugin/skills/quay-file-task/SKILL.md` 命中 ≥1，打印命中行。
- [ ] `bash scripts/test.sh --for-task gap-executor-unsatisfiable-ac-unannotated-burns-rounds` 退出 0，且确实执行了 ≥1 个测试文件（非 thin）。
- [ ] 存量读数：对本仓库当前 `tasks/*.md` 中 status 为 todo 或 ready 的任务跑一次新检查，把命中条数与前 3 条实际内容贴进 `## Evidence`（零命中时，先把检查对着上面三条逐字样本干跑一次证明它能命中）。

## DoD

真实落地判据不是「fixture 用例绿」：新检查在本仓库真实任务库上跑过一次并留下存量读数；带有执行者不可满足 AC 而未标注的任务，在进入 ready 之前就被点名，而不是在 worker 执行完之后以「AC 未全勾」作废整轮。第三方项目的效果须等其 driver 升级到含本修复的版本后才可观测，完成记录里写明这一点。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-s22.test.mjs
- plugin/skills/quay-file-task/SKILL.md
- tasks/gap-executor-unsatisfiable-ac-unannotated-burns-rounds.md
