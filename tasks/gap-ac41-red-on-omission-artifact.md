---
id: gap-ac41-red-on-omission-artifact
title: 每条固化行为必须能指出「不做时哪个读数会变红」——指不出的视为未固化；实证：A15 裁定5 在 80
  行核里、每轮必读、阈值明确、计数器建好、catalog 已声明，仍连续 9 轮未被执行直到 .halt；今晚三次有效干预（.halt /
  ruling5_status 自报 / scope=worktree fan-in 闸）全部属这一类
status: ready
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

**每条固化下来的行为，必须能指出「不做时哪个读数会变红」；指不出的，视为未固化。** 固化 + 引用 + tick 解决的是「记不住」，解决不了「没人执行」。A15 裁定 5 在 80 行执行核里、每轮必读、阈值明确、计数器建好、capability-catalog 已声明，**仍连续 9 轮未被执行**，直到 manager 置 `.halt`。

**这是 AC41 判据 3（red-on-omission artifact）。** 今晚三次有效干预全部属这一类：
- `.halt`（manager 置，逼出 A15 裁定5 的执行）
- `ruling5_status` 自报字段（suite-health-last-run.json 里，自我诊断同时越过两门槛）
- `scope=worktree` fan-in 闸（第一个 subagent 的轮次 scope=worktree+green 才放行 merge）

### 实证（manager 2026-08-10 10:0x + outer 复核）

- **A15 裁定5 形态**：在 `orchestrator-tick-core.md` A15 ⑤（80 行执行核）、**每轮必读**、阈值明确（3 轮 / 再 3 轮）、计数器建好（gap-a15-ruling5-counter-missing，catalog 已声明）——**全部就位，仍连续 9 轮未执行**。
- **为什么**：A15 裁定5 的「守」与「不守」在记录上不可区分——没有「不做时会变红的读数」。它的判据靠外层自觉（读 Agent last ts），而自觉会漏。
- **三次有效干预的共性**：都让「没做」**变得可见**——`.halt`（不做就停）、`ruling5_status`（自报 violated）、`scope=worktree` fan-in 闸（无 worktree+green 就拒 merge）。
- **反面**：gap-a15-ruling5-counter-missing 建了计数器（判据 1/2 的产物），但计数器本身也需要「没跑它会变红」——否则计数器又是一个靠自觉跑的机制。

**为什么重要**：这是 AC41 的三条判据里最紧的一条——前两条（动作化 / 单一批文件）解决「条文质量」，这条解决「执行保障」。**行为固化的完整形态 = 条文（动作化）+ 单源（引用）+ 执行保障（不做会变红）**。缺第三条，前两条只是把条文写得更漂亮，仍会静默不执行。

### 选定机制方向（实现归 inner，判定归 outer）

1. **逐条审计**：对每条固化行为（执行核 C 段硬约束、A 段必读、skill 步骤、A15 裁定5 等），问「不做时哪个读数会变红」——给出具体的可核读数（文件字段 / 计数器 / 检查器 exit / 门事件）。
2. **补产物**：指不出的，造一个「不做会变红」的产物（如：该行为相关的状态文件 mtime 超时 ⇒ 检查器 exit 1；或账本字段缺失 ⇒ 门拒）。
3. **审计产物**：`red-on-omission-audit` 检查器（或复用现成）——逐条列出「行为 → 变红读数」，缺失的列为未固化。

**验证锚**：修后 (a) 每条固化行为有「不做时变红的读数」；(b) 缺失的列为未固化（机械列出）；(c) 至少 A15 裁定5 / scope=worktree 闸 / ruling5_status 三条被覆盖。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 A15 裁定5 全就位仍 9 轮未执行 + 三次有效干预共性（不做即可见）（本任务 Proposal 已含）
- [x] AC2: **逐条审计**——固化行为清单（执行核 C 段 / A 段 / skill 步骤 / A15 裁定5 等），每条标「不做时变红的读数」
- [x] AC3: **补产物**——指不出的行为补「不做会变红」的产物（状态 mtime 超时 / 字段缺失 / 门拒）
- [x] AC4: **审计可机械核**——`red-on-omission` 检查器（或复用）逐条列出行为→变红读数，缺失的列未固化
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：每条固化行为有变红读数（贴审计清单）；A15 裁定5 / scope=worktree 闸 / ruling5_status 三条被覆盖
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（A15 ⑤：裁定5 的执行保障——不做会变红的读数）
- plugin/scripts/red-on-omission-audit.ts（red-on-omission 审计检查器：逐条行为→变红读数，@static-tier；路径与本任务 Contract measure 一致）
- .quay/（状态文件：各行为的「不做会变红」产物——mtime/字段/门）
- orchestration/manager-phase-goal.md（AC41 判据 3 正本——本任务 Proposal 已引用）
- tasks/gap-a15-ruling5-counter-missing.md（交叉标注——计数器本身也需「不做会变红」）
- tasks/gap-suite-fix-scope-worktree-green-merge-gate.md（交叉标注——scope=worktree 闸是有效干预实例）
- tasks/gap-ac41-actionize-state-worded-clauses.md（交叉标注——同 AC41 判据 1）
- tasks/gap-ac41-coldstart-skill-reference-only.md（交叉标注——同 AC41 判据 2）
- tasks/gap-semantic-observer-judge-stopped-awaiting.md（交叉标注——变红产物判据的执行体：judge 输出 stopped:true 而本轮 tick-log 无对应升级记录 ⇒ 变红；AC41③ 的观测层实例）
- tasks/gap-red-on-omission-audit-needs-mutation-case.md（交叉标注——本检查器 e532d599 落地时没配 mutation case，checker-mutation 门 uncovered: 1；gap 任务已补 `checker-mutation-cases/red-on-omission-audit.sh`）
- tasks/gap-ac41-red-on-omission-artifact.md（自身：勾 AC + 贴证据）

## Contract

measure   behaviors_with_red_reading = `node --no-warnings --experimental-strip-types plugin/scripts/red-on-omission-audit.ts --root "$PWD" --json` 的 stdout 中 covered/uncov 数字
band      behaviors_with_red_reading = uncov = 0（每条固化行为有变红读数）
invariant a15_ruling5_has_red_reading = 1（A15 裁定5 不做 ⇒ 某读数变红）
invariant scope_worktree_gate_covered = 1（scope=worktree 闸有变红读数）
invariant ruling5_status_covered = 1（ruling5_status 自报字段有变红读数）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/red-on-omission-audit.ts --root "$PWD" --json`（贴审计清单：行为→变红读数）
control   每条有变红读数；A15 裁定5 / scope 闸 / ruling5_status 覆盖；缺失列未固化
resume    审计 / 补产物 / 检查器分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人裁定「同意上述意见」+ manager AC41 判据 3（第三条限定，人已裁定同意）。实证：A15 裁定5 全就位仍 9 轮未执行直到 .halt。三次有效干预（.halt / ruling5_status / scope=worktree 闸）共性=不做即可见。立案：每条固化行为必须能指出「不做时哪个读数会变红」。实现归 inner

### 修后实跑证据（2026-08-10，inner subagent）

**invoke**：`node --no-warnings --experimental-strip-types plugin/scripts/red-on-omission-audit.ts --root "$PWD" --json`

**measure**：`covered=18 uncov=0 band=0`；三条 Contract invariant 全 1：
`a15_ruling5_has_red_reading=1` / `scope_worktree_gate_covered=1` / `ruling5_status_covered=1`。

**covered（18 条固化行为 → 变红读数）**：
- `a15_ruling5`：A15 裁定5（连续 3 轮心跳缺失 ⇒ .halt；再 3 轮 ⇒ /clear）→ `suite-health-last-run.json` 的 `ruling5_status` 缺失/violated + A15 ② mtime 陈旧 ⇒ exit 1
- `scope_worktree_gate`：fan-in 前必须存在 ≥1 条 scope=worktree+state=green 轮次记录 → `verification-round.jsonl` 无该记录 ⇒ 门拒
- `ruling5_status`：每 tick 写 suite-health-last-run.json 的 ruling5_status 自报 → 字段缺失 ⇒ exit 1
- `a15_heartbeat_write` / `a17_semantic_judge`（redOnOmission exit 1）/ `a16_observe_inner_failure` / `a14_closure_pass` / `a13_inner_heartbeat` / `a10_closure_lag` / `a6_fixed_cap` / `a2_suite_chain` / `a1_monitor_mount` / `c1_delivery`（裸 send-keys 计数）/ `c2_pane_busy`（adr016 门）/ `c3_resource_gate`（WAIT 门）/ `c7_drive_text`（drive-contract 门）/ `c14_contract_check`（task-contract 门）/ `b2_closure_record`（--record 心跳）

**未固化（审计如实列出，AC41③ backlog）**：A4 / C4 / C5 / C6 / C8 / C9 / C10 / C11 / C12 / C13 / C15——它们还没有「不做会变红」的机械产物，列入审计清单待补（执行核 C 段头注释注明）。

**验证**：verify 是机械核对 tracked 文件（非自证）——删掉 `ruling5_status` 声明 ⇒ `a15_ruling5`+`ruling5_status` 转 uncov；空 root（无 tick core）⇒ exit 1。

**scoped 门**：`./scripts/test.sh --for-task gap-ac41-red-on-omission-artifact --allow-thin` → `tests 16 / pass 16 / fail 0 / cancelled 0`，EXIT 0；静态检查 `red-on-omission-audit: covered=18 uncov=0 (band 0)` 随 scoped 跑。
