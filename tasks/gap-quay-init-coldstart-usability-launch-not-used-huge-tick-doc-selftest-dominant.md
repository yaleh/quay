---
id: gap-quay-init-coldstart-usability-launch-not-used-huge-tick-doc-selftest-dominant
title: quay-init 冷启动可用性三缺陷——①消费方未用铺下的 quay-launch.sh 起会话（outer 无 --settings、inner 名非角色约定）②铺下 tick 文档 126,895 字节（冷启动第一件事读它）③基础设施自检占掉冷启动绝大部分（ad-arm1 archguard 15 分钟 / 120.6k token 诊断 monitor 为什么不发事件 = 设计如此）（F4/F5/F6）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实测（manager 2026-08-11 15:2x，ad-arm1 真实消费方 archguard，ssh 实测非猜测）——AC16③ Level3 第一次真的在跑**：

**F4**：两个会话都不是用铺下来的 `quay-launch.sh` 起的（outer 进程无 `--settings`、inner 名为 `inner` 而非角色约定名）⇒ 冷启动脚本铺下来了但没被用，要么不好用要么不显眼。

**F5**：铺下的 tick 文档 **126,895 字节**（quay 自己的 manager-loop-tick 1647 行也才约 50KB）——消费方 inner 冷启动第一件事是读一个 126KB 文档。

**F6**：archguard 的 outer 冷启动花了 **15 分钟 / 120.6k token** 在诊断「session-liveness monitor 为什么不发事件」（答案是设计上只在状态转换时发），**基础设施自检占掉了冷启动绝大部分，不是在驱动开发**。

### 验证锚

修后 (a) 消费方冷启动用铺下的 `quay-launch.sh` 起会话（outer 带 --settings、inner 用角色约定名）；(b) 铺下 tick 文档体积可控（或冷启动引导不强制先读超大文档）；(c) 冷启动时间/ token 主要花在驱动开发而非基础设施自检（自检可跳过/并行/缩短）；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 ad-arm1 archguard 实测（F4 未用 quay-launch.sh / F5 126,895 字节 / F6 15min 120.6k token 自检）
- [x] AC2: **launch 可被消费方使用**——铺下的 quay-launch.sh 好用且显眼（冷启动文档指引用它）
- [x] AC3: **tick 文档体积可控**——消费方冷启动引导不强制读超大文档（或文档瘦身）
- [x] AC4: **自检不占主导**——冷启动自检可跳过/并行/缩短，主要时间花在驱动开发
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [ ] 修后实跑：ad-arm1 冷启动用铺下 launch + 体积/自检读数改善（外层 verification 实测）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（inner 2026-08-11 实跑）

**AC2 — launch 可被消费方使用**：
- `quay-init --loop` 现在铺下 `.claude/launch.settings.json` 默认模板（`plugin/.claude/launch.settings.json` → `<target>/.claude/launch.settings.json`），quay-launch.sh 不再 fail-closed（修前第三方案冷启动目标没有 settings 文件 ⇒ launcher 报 "launch settings file not found"）。
- 铺下模板经 launcher 实测 materialize 出 `--settings` + 角色约定名（F4 缺的那一半）：
  ```
  $ QUAY_LAUNCH_SETTINGS=plugin/.claude/launch.settings.json bash plugin/scripts/quay-launch.sh outer --dry-run
  claude --settings plugin/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false -n quay-outer
  $ QUAY_LAUNCH_SETTINGS=plugin/.claude/launch.settings.json bash plugin/scripts/quay-launch.sh inner --dry-run
  claude --settings plugin/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false -n quay-inner
  ```
- 冷启动文档显式指引用铺下的 launch：cold-start SKILL 7 处、orchestrator-loop-tick 7 处 `quay-launch.sh`；Contract measure `grep -c 'quay-launch.sh' <冷启动铺下文档>` ≥ 1 满足（7 ≥ 1）。

**AC3 — tick 文档体积可控（冷启动不强制先读超大文档）**：
- 内层冷启动第 4 读改为 `orchestration/fast-mode-tick-core.md`（≤80 行执行核），本文件（126,895 字节）降级为「完整理由档案，只在需要某判据 src: 行号时查」；外层冷启动第 1 读同样改为 `orchestration/orchestrator-tick-core.md`。
- fast-mode-loop-tick.md 冷启动段新增 F5 说明；orchestrator-loop-tick.md 冷启动第 1 步表格加 tick-core 指针行。

**AC4 — 自检不占主导**：
- cold-start SKILL 步骤 4 与判据 2（MONITORS-DELIVERING）改为**确定性 `--once` 缝**（`bash <root>/plugin/scripts/session-liveness.sh --once` → `SESSION-STATUS <name> alive=…`，秒级），明确「resident monitor 只在状态转换时发事件、稳定会话理应静默——不要等 ~90s 转换事件」（F6 的 15min/120.6k token 非问题）。
- orchestrator-loop-tick.md 冷启动 4c 加同一条 F6 交付判定说明。

**AC5 — 既有不回归（`--for-task` scoped 门绿）**：
```
$ bash scripts/test.sh --for-task gap-quay-init-coldstart-usability-launch-not-used-huge-tick-doc-selftest-dominant --allow-thin
✔ AC2 — the three exec-core docs are in the derived laydown set ...
✔ AC2-launch — --loop lays down .claude/launch.settings.json; the laid-down quay-launch.sh materializes --settings + role names
✔ AC3 — manager-tick-core.md is OPT-IN ...
✔ AC4 — the referenced⊆landed gate validates the three cores ...
✔ AC5 — --loop --manager lays all three cores ...
ℹ tests 5   ℹ pass 5   ℹ fail 0   ℹ cancelled 0
```
scoped 静态检查全绿：tick-core-static-check（AC3 src:N 100% / AC4 指针 / AC5 编号 / AC6 一致）、adr016-screen-use-check、superseded-capability、dead-code-after-return、delivery-inventory-drift gate 全 PASS。

## Touches

- plugin/scripts/quay-init.sh（冷启动引导文档 + 铺下 launch 的使用指引）
- plugin/skills/cold-start/SKILL.md（引导用铺下的 quay-launch.sh + 自检可跳过/并行）
- plugin/loop/*.md（tick 文档体积/冷启动引导）
- tasks/gap-quay-init-coldstart-usability-launch-not-used-huge-tick-doc-selftest-dominant.md（自身：勾 AC + 贴证据）

## Contract

measure   coldstart_uses_laid_launch = `grep -c 'quay-launch.sh' <冷启动铺下文档>` stdout 数字
band      coldstart_uses_laid_launch = ≥ 1（冷启动文档指引用铺下的 launch；实测 cold-start SKILL 7 处 / orchestrator-loop-tick 7 处）
invariant tick_doc_size_bounded = 1（铺下 tick 文档 ≤ 合理阈值，冷启动不强制先读——冷启动第 1 读改为 ≤80 行 tick-core）
invoke    `quay-init --loop` 到临时目标后量铺下文档字节 + 冷启动引导（贴证据；已铺 .claude/launch.settings.json 实测 dry-run 输出）
control   launch 可用；体积可控；自检不占主导；既有不回归
resume    launch 指引 / 文档体积 / 自检优化分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: ad-arm1 archguard 真实消费方 Level3 首跑实测 F4/F5/F6——冷启动可用性三缺陷（launch 未用 / 126KB tick 文档 / 自检占 15min 120.6k token）。实现归 inner，判定归 outer
