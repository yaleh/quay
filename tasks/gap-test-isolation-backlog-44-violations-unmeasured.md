---
id: gap-test-isolation-backlog-44-violations-unmeasured
title: "test-isolation contract check has 44 standing violations (fixed-path-write=12 process-exit-1=7 mkdtemp-no-cleanup=21 ...) that pre-date tonight's merges — confirmed identical count in round1 log (192 glob vs 219 now, same 44) — the check runs but its backlog is UNMEASURED: no baseline/ratchet, so 44 reds are just 'existing noise' and new violations are indistinguishable from old (red-window triage had to diff against a rotated-out round1 log by hand); fix: baseline the 44, add a shrink-only ratchet or per-category count like the test-framework-policy list"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**test-isolation 检查有 44 个常驻违规，但它的积压从未被度量——红窗分诊无法区分新旧。**

**【实测（2026-08-06 03:05 红窗分诊）】**：全量套件启动即红——`test-isolation-check` 报
**44 个 current violations**（fixed-path-write=12 / shared-build-artifact-write=1 / spawns-test-sh=3 /
process-exit-1=7 / mkdtemp-no-cleanup=21 / live-data-dir-write=0 / shared-root-mkdtemp=0）。分诊时
需判断「本轮 merge 引入还是既有积压」——**对比 rotated-out 的 round1 日志（192 glob）才发现同样 44 个**
（既有），靠手工 diff 两个日志文件，没有任何机械基线。

**【根因】**：test-isolation-check **报数但不设基线/棘轮**——44 个 red 是「已知噪音」，每次全量都红，
新违规混在里面不可区分。对比 test-framework-policy（有 shrink-only 棘轮 + ceiling + git-HEAD strict-
subset），test-isolation 缺同款机制。

**【价值】**：没有基线，「全量套件绿」= 假目标（static-check 一启动就红，测试层根本没跑到）。
44 个是历史遗留（round1 与今晚同数），但**类别分布**（mkdtemp-no-cleanup=21 最重）指向可批量修复的
清理方向。

### 选定机制

1. **基线 44 个**：把 44 个违规文件列为已知基线（类似 test-framework-policy-exemptions.txt）
2. **加 shrink-only 棘轮**：新违规可被报出但不得增加净数（或按类别计数，如 mkdtemp-no-cleanup 单独
   一条清理线）
3. 清理方向：mkdtemp-no-cleanup=21（占一半）是最高杠杆——批量加 cleanup

## Acceptance Criteria

- [ ] AC1: test-isolation 44 个违规有机械基线（已知基线列表，非每次红）
- [ ] AC2: shrink-only 棘轮——新违规触发检查红，既有积压不阻塞（除非净增）
- [ ] AC3: 与 gap-test-framework-policy（done）交叉标注——同款棘轮机制的第二个消费者
- [ ] AC4: 与 gap-test-isolation-contract-is-unwritten 交叉标注（检查器来源任务）

## Touches

- plugin/scripts/test-isolation-check.ts（基线 + 棘轮逻辑）
- plugin/test-framework-policy-exemptions.txt 或等价基线文件（模式复用）
- tasks/gap-test-framework-policy-for-new-tests.md（AC3 交叉标注）

## Contract

measure   iso_violations = `bash plugin/scripts/test-isolation-check.ts` stdout 的 violation 总数
band      iso_violations <= 44（基线；shrink-only 棘轮：净增即红）
invoke    `bash plugin/scripts/test-isolation-check.ts`
control   既有 44 不阻塞（AC2）；新违规触发红（AC2）
resume    基线与棘轮分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T03:1xZ
changed: 红窗分诊立案——test-isolation 44 违规无基线，全量每次启动即红（static-check 层），
靠手工 diff round1 日志确认既有。管理者可确认后派发。
