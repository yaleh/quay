---
id: gap-verify-deliver-coldstart-l2-proc-ok-false-positive
title: verify-deliver-coldstart.sh L2 活性判据假阳性：proc_ok 单独撑起通过，未判信任弹窗（硬规则 4b）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 01:5xZ 实测（SSH 到 B/C 直接核实）——AC107 ③ 冷启动活性判据假阳性。**已 retreat AC107 done→ready**（①install ②quay-init 证据扎实，③假阳性待重验）。

**缺陷**：`plugin/scripts/verify-deliver-coldstart.sh:197-206` `L2_OK = git_recent || wt_recent || proc_ok`——`proc_ok` 只检测 `/proc/<pid>/cwd` 落在项目根的 claude/node 进程 ≥2，**不区分「进程刚 spawn 卡在信任弹窗」vs「真的在跑 outer/inner tick 循环」**。实测 B/C 两台机 4 个 claude 进程从 spawn 起卡在 "Quick safety check: Is this a project you created or one you trust?" 弹窗 6.2+ 小时（etimes 与 AC107 verify 时刻几乎同秒），`coldstart_live=yes` 完全由 proc_ok 撑起，另两个真信号（git_recent/wt_recent）都是 0。**违反 AC107 任务体取假条件 (c)「⛔不得用『进程存在』代理量（硬规则 4b）」**——判据被自己的实现违反了。

**现成机制可复用**（不必新造）：
- `plugin/scripts/pane-state-classify.ts:101` 已有 `permission-prompt` 分类器，识别 `Quick safety check|trust this folder|Enter to confirm` 特征串
- `plugin/scripts/session-liveness.sh` 已把该弹窗归类为 `SESSION-INTERVENTION-REQUIRED`

**为什么 inner 执行**：verify-deliver-coldstart.sh 属 plugin/scripts/ 产品代码 → inner 域（D 段边界）。

## Plan

1. 修 `verify-deliver-coldstart.sh` 的 L2 判定：`proc_ok` 不作为单独充分条件，或加「已通过启动弹窗」直接量（复用 pane-state-classify / session-liveness 的弹窗识别）。
2. 重新对 B/C 跑完整三步验证（真实冷启动活性）。
3. B/C 机上现有 2 个卡死 claude 进程：inner 判断回应弹窗或 kill 重来。

## Acceptance Criteria

- [x] AC1: `verify-deliver-coldstart.sh` 的 L2 活性判定不再单独由 proc_ok 撑起——加「已通过启动弹窗」直接量（复用 pane-state-classify 的 permission-prompt 识别），或 proc_ok 改为非充分条件。
      **验证**：`--selfcheck` 新增三条控制带全绿——`prompt-blocked(procs=2,prompt=1) L2_OK=0 COLDSTART_LIVE=no`（负向：进程在但卡弹窗 ⇒ proc_ok 不得撑起）、`prompt-passed(procs=2,prompt=0) L2_OK=1 COLDSTART_LIVE=yes`（正向）、`pane-verdict-permission-intervention=1`（复用 wiring：pane-state-classify --pane-verdict 把真实信任弹窗 fixture 判为 intervention）。实现：`probe_startup_prompt()` 复用 pane-state-classify.ts:101 的 permission-prompt 分类器（经 `--pane-verdict` 接缝，与 session-liveness.sh 同一判定源）扫 outer/inner 窗口 pane；`coldstart_verdict` 的 proc_ok 要求 `L2_LAYER_PROCESS_CWD>=2 && L2_STARTUP_PROMPT=0`。测试文件新增三条断言。详见提交。
- [ ] AC2: 负控制落在生产载体——重新对 B/C 跑完整三步，`coldstart_live=yes` 只在进程真正通过信任弹窗进入 tick 循环时成立（读真实证据 json，非 fixture）。
- [ ] AC3: B/C 卡死进程已处置（回应弹窗或 kill 重来，inner 判断）。
- [ ] AC4: 全量 suite 绿。

## Definition of Done

- [ ] L2 活性判据修复（proc_ok 不再单独充分）；B/C 重新验证真实通过（读真实证据 json）；卡死进程已处置。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh（L2 判定修复）
- plugin/test/verify-deliver-coldstart.test.mjs（L2_STARTUP_PROMPT 回归断言 + AC1 三控制带）
- .quay/productization-verification.jsonl（AC107 记录更新/标注）
- tasks/gap-verify-deliver-coldstart-l2-proc-ok-false-positive.md（自身）
