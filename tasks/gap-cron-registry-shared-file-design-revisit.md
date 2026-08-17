---
id: gap-cron-registry-shared-file-design-revisit
title: AC81 注册表双层共享文件设计复审——人裁定「inner cron 写该文件不合适」；outer-cron-registry.json
  名不符实（双层共享，非 outer 专属）；双写碰撞治标 vs 拆分/改名
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: plan
  depends_on:
    - gap-direct-to-develop-exclude-cron-registry-receipt
---
**type:** execution

## Proposal

**人裁定（2026-08-17 08:0xZ，manager 转述）**：「inner cron 写该文件是不合适的。」

**背景（manager 只读核实）**：`plugin/scripts/outer-cron-registry.json` 的 schema 本来就是**双层共享设计**——`note` 写「AC81 注册表收据（outer + inner 双层 CronCreate 锚）」，`layers: {inner, outer}`；outer 与 inner 各自的 tick 核心文档都指向它。⇒ **这不是意外碰撞，是 AC81 当初就定的设计**，只是文件名从来没从 `outer-cron-registry.json` 改过（名不符实）。

**这次暴露的更深问题**：`gap-direct-to-develop-exclude-cron-registry-receipt` 治的是「两层同时冷启动 → 各自 cron 重建直写同一收据 → bypass-check 误红」这个**症状**（发生率 3：f9577da1/167b7052/f882ad76）。但**「两层要不要写同一个文件」这个底层问题没有动**——以后任何类似的双层近同时写操作（不限于 cron 重建），排除集只能一个个补，治标不治本。

**候选方向（不判断，待 outer/inner + manager 裁定）**：
1. **拆成两个文件**（`inner-cron-registry.json` + `outer-cron-registry.json`，或目录）——各层写自己的，消除双写碰撞；但 AC81 四判据、anchor-check、observer-registry 等消费者全部要改，范围大。
2. **保留共享但换机制**（如按层分路径、或改为不被 bypass-check 误判的记账面形态）——不动双写本身。
3. **保持现状 + 排除集**（本轮已落地）——接受双写碰撞是结构性的、每次靠排除集兜底。

**⛔ 范围**：本任务**不做实现**，只做设计复审与裁定记录。方向确定后另立实现任务。

**能取假（⊢ 对照）**：复审结论必须落在任务体（选哪个方向 + 理由 + 影响面枚举），而不是停在「讨论过」。

## Plan

1. outer/inner 各读本任务 + `gap-direct-to-develop-exclude-cron-registry-receipt`（症状修复已 land）。
2. 枚举消费者：`outer-cron-registry.ts` / `outer-anchor-check.ts` / 双层 tick 文档 / 测试 pin 集。
3. 评估三方向的实现面与迁移成本。
4. 结论落盘（方向 + 理由 + 影响面），标 needs-human 等 manager 确认。

## Acceptance Criteria

- [x] AC1: 三个方向（拆分/换机制/保持+排除集）的权衡与影响面逐条写出。（已由 outer 裁定材料 A–F 覆盖，022198bd）
- [x] AC2: 裁定方向落盘（含理由），不悬空。（人 2026-08-17 08:2xZ 裁定，见下「## 人裁定落盘」）

## 人裁定落盘（2026-08-17 08:2xZ，manager 转述原话）

> **「遵循 manager 的实现，应用到 outer 和 inner。」** ⇒ 选**方案②（全局路径、per-layer、不进 git）**，非 inner 倾向的方案①（仓库内拆两文件）。needs-human 项已解决。

**精确规格（manager 实读自身实现推导，供实现任务直接照抄）**：
```
manager 实现:  QUAY_GLOBAL_DIR="${QUAY_GLOBAL_DIR:-$HOME/.quay-global}"
               HOME_DIR="${HOME_DIR:-${QUAY_GLOBAL_DIR}/manager}"
               STORE="${STORE:-${HOME_DIR}/loop-registry.txt}"
```
**⛔ 一处不能照抄、必须补的差异**：manager 是跨项目单例（一台机器一个），路径不需要按项目分片；**outer/inner 是按项目的**（quay/archguard/meta-cc 各有自己的 outer/inner）——照抄 `~/.quay-global/outer/loop-registry.txt` 字面路径会在多项目间互相覆盖（跨项目版的双写碰撞）。
**已核实本仓库现成路径分片方案**（`plugin/scripts/session-liveness.sh:1162`，非新发明）：
```bash
slug=$(printf '%s' "$root" | tr '/' '-')   # 与 ~/.claude/projects/<slug>/ 同一种打法
```
建议形态：`~/.quay-global/<repo-root-slug>/outer/loop-registry.txt` 与 `.../inner/loop-registry.txt`（按项目分片；具体命名归实现方定）。

**已核实的支撑事实（前几轮举证，此处不重复）**：判据入口 `checkVerify():295` 只读自己层，拆分/挪 git 不影响现有判据读取形状；git 版随 fork 携带陈旧快照（5 worktree 实测），全局路径消除；`outer-tick-log-check` / `AC80-INNER-ANCHOR` 等消费面切换后需同步改读新路径——**消费者迁移清单进另立的实现任务**（DoD 原文已写这条）。

**⊢ 后续**：按 DoD「若选换机制 ⇒ 另立实现任务（含消费者迁移清单）」——实现任务已另立：`gap-cron-registry-global-path-migration`（798c2566，含消费者迁移清单 + 审计线 jsonl + 分片 slug 约束）。本任务裁定记录已完成。

## Definition of Done

- [x] 设计复审完成，方向裁定落盘；若选拆分/换机制 ⇒ 另立实现任务（含消费者迁移清单）。（实现任务已立：gap-cron-registry-global-path-migration，798c2566）

## 裁定材料（outer 2026-08-17 08:1xZ 汇总，均经 outer 实读验证；供人/manager 裁定）

**A. 共享文件功能价值 = 0（manager 指出，outer 实读代码确认）**：`outer-cron-registry.ts` 判据入口 `checkVerify()` 只取 `registry.layers?.[layer]`（自己那一层）；全文件唯一遍历所有层的是 `formatShow()`（:508-513）——纯 CLI 展示函数，不参与任何判据。⇒ 两层从不读对方记录，共享一个文件的收益为零，代价是并发写碰撞 + bypass-check 误红 + fan-in add/add 冲突（今天全部实发）。

**B. 工作树陈旧快照（manager 指出，outer 实测 5 个 worktree 确认）**：git 跟踪的收据随 fork 携带的是 fork 那一刻的【陈旧快照】，cron 重建后 worktree 里的 cronId 全是死值——结构完整、JSON 合法，与「合格」同形（硬规则 3b）。实测：
```
worktree bootstrap / shell-concat（fork 早）:  inner=0ccb57cf✗ outer=4e88cb1b✗（全死）
worktree ac98:                                 inner=0ccb57cf✗ outer=a2360e1d✓
worktree l2 / direct-to-develop（近期 merge）: inner=09fabf33✓ outer=a2360e1d✓
主检出真值:                                    inner=09fabf33 outer=a2360e1d
```
⇒ 任何在旧 worktree 里跑 AC81 四判据的检查器，`idMatches` 判据输入是死 id。这正是硬规则 4b 形态：被测对象自己携带的量，在过期时恰好停止更新、与一切正常同形。

**C. 对照组（manager 指出，活着的负控制）**：manager 自己的 cron 注册表 `~/.quay-global/manager/loop-registry.txt`（全局绝对路径/单层/纯文本/不在 git）——任何 worktree 读到的是同一个文件 = 当前真值，不存在快照；不被 bypass-check 看见、不可能双写碰撞、不可能 add/add。今天三个症状在 manager 侧结构上不可能发生。

**D. 为何当初进 git（outer 查 AC81 历史）**：`gap-ac81-registry-receipt-and-four-criteria` 任务体只写「new，git 跟踪注册表收据」，**没有给理由**（f50db309 首次落地）——进 git 是默认选择不是论证结果。git 历史的实际功能：
1. 跨 worktree 可读——但如上 B，携带的是陈旧快照，**是缺陷不是优势**（满足「文件存在」不满足「值正确」）。
2. **收据变更留痕/审计线**——历史 6 笔全是「cron 随进程消失 → 重建 → 收据更新」提交（f882ad76/167b7052 提交信息即「为什么重建」），锚变更可 diff 可回溯。这是 git 版唯一真实的独有价值。

**E. 修正后的三方案对照（把「worktree 里读到的值」列补上——原对照漏了它）**：
```
                        双写碰撞  bypass误红  add/add  worktree里读到的值  审计线
① 仓库内拆两文件          消除     仍在        消除      ❌ 仍是陈旧快照      有
② 全局路径 per-layer      消除     消除        消除      ✅ 当前真值          需另配 jsonl
③ 保持共享+排除集(现状)   仍在     消除        仍在      ❌ 仍是陈旧快照      有
```
① 和 ③ 都没解决「worktree 读到死 cronId」——这个问题今天已在产生错误输入（尚未撞上红）。
**审计线可与全局路径共存**：全局文件存当前真值（判据读它），锚变更另写 append-only jsonl（审计读它）——`.quay/*.jsonl` 遍地都是该形态，不为审计线把当前值绑进 git。

**F. 范围纪律**：本任务仍只做设计复审与裁定记录，不做实现（沿用 ⛔ 范围）。

## Touches

- plugin/scripts/outer-cron-registry.json（设计对象，只读评估）
- plugin/scripts/outer-cron-registry.ts（消费者评估）
- plugin/scripts/outer-anchor-check.ts（消费者评估）
- orchestration/*-tick-core.md（双层文档指向评估）
- tasks/gap-cron-registry-shared-file-design-revisit.md（自身）
