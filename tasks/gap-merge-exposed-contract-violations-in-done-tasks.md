---
id: gap-merge-exposed-contract-violations-in-done-tasks
title: 合并后完整 runner 静态检查首次覆盖 develop task 文件，暴露 3 个 done 任务的 5 个 Contract
  违规（gap-eighty-one AC8 自认未生效却勾 [x]；gap-no-inventory 3 格式违规；gap-serve-task-list
  invoke 证据缺）——静态检查门红，测试跑不到，修掉解阻塞
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**合并 integration→develop 后，完整套件 runner 的静态检查（run_static_checks，shared-gate）首次覆盖 develop 侧的 task 文件，暴露 3 个 done 任务的 Contract 违规。其中 1 条已由人裁决（2026-08-08，原话转达），落实须【只覆盖被裁决的那一条】，其余 4 条在基线内、维持现状。**

### 人的裁决（原话）

「可以勾上。不做通例，以后这样的例外还是要我判断。」—— 指 gap-eighty-one 的 AC8。
**勾保留、任务保持 done。这是一次性例外，不是新规则；以后同类情况仍要人判，不要据此自行放行。**

管理者实测佐证：AC8 命中的是「41:4 说明政策存在、未生效」——**是问题陈述，不是完成宣称**（AC8 结构 = 先写要关的口子、再写判据；一条写得好的 AC 本来就该这样）。正则区分不了「这是我要关的口子」和「我勾了但没做」⇒ 检查器此例是**假阳性**。

### 落实风险（管理者重点提醒）

`--reset-baseline` 是整体重设（注释明写 DELIBERATE one-shot re-baseline），当前棘轮 5 违规 / 3 任务。**若整体重设，会把另外 4 条未裁决的违规一并收编**——人没裁决过它们。**禁止整体 reset**；落实手段只放行 gap-eighty-one 一条。

### 违规清单与处置（精确）

| 文件 | 违规 | 处置 |
|---|---|---|
| gap-eighty-one...md | ac-ticked-self-admission | **人裁决：勾保留、done 保持。定点加进基线**（唯一被裁决项） |
| gap-no-inventory...md | contract-line-unknown / measure-no-command ×2 / measure-no-field | **已在基线**，维持现状，不碰 |
| gap-serve-task-list...md | invoke-evidence-missing | **已在基线**，维持现状，不碰 |

### 落实方式（定点，非整体）

基线文件 `docs/analysis/contract-violations.md` 当前 5 条（4 条既有 + dispatch-review-missing 1 条，全部 shrink-only 基线成员）。新增被裁决的 1 条：
`tasks/gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point.md: ac-ticked-self-admission`
并把 `# baseline-count: 5` → `6`（这是被裁决的增量，不是通例——人明确"不做通例"，此 ceiling 增量是本次裁决的一次性背书）。

**绝不**用 `--reset-baseline`（会重锚 ceiling 到当前违规集，把未裁决项编进新基线）。

## Contract

measure ratchet_green = `node --experimental-strip-types plugin/scripts/task-contract-check.ts --root /home/yale/work/quay --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([v for v in d.get('violations',[]) if v.get('ratchet')]))"` stdout 数字段（定点加基线后 ratchet 违规 = 0——被裁决项进基线、未裁决项仍在基线内）
band ratchet_green = 0（静态检查门绿）
invoke `bash scripts/test.sh --static-checks 2>&1 | tail -5`（只跑静态检查门）
control 静态检查门绿（仅 gap-eighty-one ac-ticked 定点进基线，未用整体 reset；gap-no-inventory / gap-serve-task-list 未被动）；全量套件能跑到测试阶段（selected N files > 0）
resume 若中断，先跑 measure 读 ratchet 违规数 + 确认 baseline-count 为 6 且只有 gap-eighty-one 是新增

## Acceptance Criteria

- [ ] AC1: **人裁决落实**——gap-eighty-one AC8 勾保留、任务 done 保持；ac-ticked-self-admission 定点加进
      `contract-violations.md` 基线（baseline-count 5→6）
- [ ] AC2: **不做通例**——仅被裁决的 1 条进基线；gap-no-inventory（3 条）/ gap-serve-task-list（1 条）
      维持基线现状，未用整体 `--reset-baseline`
- [ ] AC3: **静态检查门绿**——task-contract-check ratchet 违规 = 0；全量套件能跑到测试阶段
      （selected N files > 0）
- [ ] AC4: 与 gap-suite-state-split-across-worktree-and-gate（合并后首次全量覆盖 develop task 文件）、
      a862c914 merge 交叉标注

## Definition of Done

- [ ] AC1-AC3 实跑输出贴任务体（基线文件 diff 前后、ratchet 违规对照、静态检查门绿、全量跑到测试阶段）
- [ ] 全量套件三趟 fail 0 / cancelled 0（静态检查门不再挡）

## Touches
- docs/analysis/contract-violations.md（定点加 gap-eighty-one ac-ticked-self-admission，baseline-count 5→6）
- tasks/gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point.md（若需标注人裁决）
- tasks/gap-suite-state-split-across-worktree-and-gate.md（AC4 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T00:0xZ
changed: 人裁决（原话）：「可以勾上。不做通例，以后这样的例外还是要我判断。」AC8 勾保留、done 保持、
  一次性例外。落实风险：禁止整体 --reset-baseline（会把未裁决的 4 条一并收编）。定点加 gap-eighty-one
  一条进基线（baseline-count 5→6），其余 4 条基线内维持现状。
