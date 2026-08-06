---
id: gap-residue-check-crystallized-as-tool-mode
title: "\"box has text vs actually submitted\" must be a tool judgment, not role
  memory — add a --check-residue mode (empty / real-unsubmitted-text /
  ghost-suggestion-only) reusing D's bottom-region + shape"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人裁定（2026-08-05，经管理者转达）：**「框里有字 vs 真的提交了」这个判断不该靠角色记住去区分，
要结晶到工具、更可靠且算力更省。**

### 背景（外层实锤的失效）

今晚多次因读输入框文字误判内层行动：
- R2 AC8 反向踩坑——把框内备忘读成「已提交的行动」（`产品机制自我修正闭环运转` 是 false claim，
  transcript 核实 0 命中）；
- 可靠发送故障 6——ghost-suggestion 无法硬清空（C-u/C-a+C-k 循环 pane 不变），被误读为真残留。

**判据靠人/角色目测 = 每次失败都在复读同一形态。** 人裁定：把它做成工具。

### 选定机制

**在 `pane-state-classify.ts`（复用 D 的底部区域 + 形状判断）新增 `--check-residue` 模式**：

```
输入: pane 文本（或 tmux 目标，运行时探针）
输出: empty | real-unsubmitted-text | ghost-suggestion-only
```

- **empty**：输入框行为 `❯ `（无内容）。
- **real-unsubmitted-text**：输入框有文本，且 **C-u 能清掉**（运行时探针：capture → C-u → capture，
  文本消失 = 真输入残留）。
- **ghost-suggestion-only**：输入框有文本，且 **C-u 清不掉**（pane 逐字不变 = gray ghost-suggestion，
  故障 6 判据机械化）。

**运行时探针是判据**：静态 pane 文本无法区分「真输入」与「ghost」（plain-text capture 无样式信息），
区分只能靠 C-u 清除行为（故障 6 的判定：C-u 循环 N 次 pane 不变 ⇒ ghost）。工具把这条判据从
「角色目测」变成「命令产物」。

## Acceptance Criteria

- [ ] AC1: `pane-state-classify.ts --check-residue` 存在——给定 pane 文本/目标，输出三态之一
      （empty / real-unsubmitted-text / ghost-suggestion-only），复用 `bottomRegion` 与五态形状逻辑
- [ ] AC2: **运行时探针（fault-6 判据机械化）**——real-unsubmitted 的判定包含「C-u 后文本消失」；
      ghost 的判定包含「C-u 循环 N 次 pane 逐字不变」（探针有界、fail-loud）
- [ ] AC3: 夹具三态各 ≥1 张真实录制（empty 输入框 / 真输入未提交 / ghost-suggestion 占位），附录制来源
- [ ] AC4: **负控制（双向）**——真输入残留 ⇒ C-u 清掉 ⇒ 判 real-unsubmitted；ghost ⇒ C-u 不清 ⇒ 判
      ghost-suggestion-only（两次实跑贴任务体）
- [ ] AC5: 与 transcript 交叉验证——判 real-unsubmitted 后，查 transcript 确认该文本**未**作为 user
      message 出现（若已提交则判错）；判 ghost 后，transcript 同样无该文本（实跑贴出）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group engine`（与 D 同类）
- [ ] AC7: 标注与故障 6 的关系——结晶文档故障 6 的运行时判定逻辑由此工具承载（源头消除后仍作历史兜底）

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC4/AC5 实跑输出逐字贴任务体
- [ ] 一次真实使用：外层驱动内层后用 `--check-residue` 判内层框态，结果与 transcript 一致（非构造）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-residue-check-crystallized-as-tool-mode.md
- plugin/scripts/pane-state-classify.ts
- plugin/test/pane-state-classify.test.mjs（或新增 residue-check 测试）
- plugin/test/fixtures/pane-states/（补三态夹具）
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（AC7 标注）

## Contract

measure   residue_state = `node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue <pane.txt|target>` stdout 的 state 字段
band      residue_state = empty|real-unsubmitted-text|ghost-suggestion-only（恰好三态之一）
invariant runtime_probe_is_judgment = 1（真输入 vs ghost 靠 C-u 清除行为判，不靠静态文本）
invoke    `node --experimental-strip-types plugin/scripts/pane-state-classify.ts --check-residue <pane.txt>`
control   真输入⇒C-u 清掉⇒real；ghost⇒C-u 不清⇒ghost（AC4 双向）
resume    模式实现与夹具分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T00:1xZ
changed: 外层受人裁定立案。四处收紧：
(1) **运行时探针是判据**——plain-text 无样式信息，静态无法分 ghost/真输入，只能靠 C-u 清除行为
（故障 6 判据机械化，从角色目测变命令产物）；
(2) **AC5 与 transcript 交叉**——判 real-unsubmitted 后必须确认 transcript 无该文本，否则「真输入
残留」与「已提交」混淆（今晚的 R2 AC8 反向坑）；
(3) **AC3 夹具真实录制**——三态各 ≥1 张，附录制来源（E 的纯函数纪律：夹具是录的 .txt）；
(4) **AC7 与故障 6 挂钩**——运行时判定逻辑由本工具承载，源头消除后仍作历史兜底。
status: todo——排 gap-init-ships（管理者优先裁定，卡自建目标）之后。
