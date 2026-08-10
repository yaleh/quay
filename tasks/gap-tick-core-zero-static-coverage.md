---
id: gap-tick-core-zero-static-coverage
title: 执行核 0 静态覆盖——tick-core 在 scripts/test.sh @static-object 出现 0 次(覆盖的是
  plugin/loop/*-loop-tick.md 理由档案,不是 *-tick-core.md 执行核);今晚 AC30a(≤80)/
  指针目标存在/判准编号冲突 全被手工 wc -l/grep 发现零机械拦截;判准正本 §1.4e「换监视器
  要同步换判据,否则检查通过检查的是已不存在的东西」;处方=@static-object 加 orchestration/ *-tick-core.md +
  新检查器覆盖 ①各≤80(AC30a) ②指针目标存在 ③判准编号不与 B3 组冲突
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**执行核（orchestrator/manager/fast-mode `*-tick-core.md`，三层每轮真读的东西、AC30(a) 的判据对象）在静态检查层零覆盖：`scripts/test.sh` 的 @static-object 指向 `plugin/loop/*-loop-tick.md` 和 `orchestration/manager-loop-tick.md`（理由档案），不是 `*-tick-core.md`（执行核）。原因：执行核 2026-08-09 才建，静态检查 object 列表还指着旧文件。这正是判准正本 §1.4e 自己写的那条——「换监视器时这条检查一度还指着旧签名，等于换完就失去覆盖而不自知；换实现要同步换判据，否则『检查通过』检查的是一个已经不存在的东西」。**

### 实证（人 2026-08-10 指出 + outer 逐项核实）

- **零覆盖已证实**：`grep -c "tick-core" scripts/test.sh` = 0。threshold-scope-check 的 @static-object（scripts/test.sh:344）覆盖 `plugin/loop/fast-mode-loop-tick.md plugin/loop/orchestrator-loop-tick.md CLAUDE.md`——全是理由档案，不是执行核。
- **三个今晚被违反、全手工发现**：①AC30(a) 各执行核 ≤80 行——被违反时我手工 `wc -l` 发现；②指针目标文件存在——执行核引用正本路径，若目标删除无人拦；③判准编号不与 B3 组冲突（manager 曾用 `甲乙丙丁戊` 与判准 `①-⑤` 编号复用，缺席伪装成在场）。
- **判据A 的语义**（人 2026-08-10）：执行核是三层每轮真读的文件，静态检查的门应该覆盖它们——「生效线不是没有门，是门漏了执行核」。

**为什么重要**：门存在但漏了最该被门保护的对象——执行核。三处今晚的违规全凭手工 wc/grep 发现，零机械拦截。这是「检查通过」检查的是旧文件/不存在文件的静默失效。

### 选定机制方向（实现归 inner，判定归 outer）

1. **@static-object 补门**：`scripts/test.sh` 的 threshold-scope-check（或新增检查器）@static-object 加入 `orchestration/*-tick-core.md` **及四处禁令文档**（outer-brief-2026-08-04-third-restart.md / QUAY-OUTER-HANDOFF.md / exp6-phase1-sustained-unattended-operation.md / orchestrator-loop-tick.md 边界表）。
2. **新检查器覆盖四判据**：①三份各 ≤80 行（AC30a）；②执行核里引用的正本路径目标文件存在；③判准编号不与 B3 组冲突；④**禁令文本与执行核一致（manager 2026-08-10 加，CLAUDE.md:204 同形态）**——grep「不要自己用 `Agent`」「外层不直接改代码」若与核里的 `run_in_background: true` 同时存在即报（禁止文本必须带「收窄/理由=单一写入者/共享树」才放行）。
3. **接线**：`@static-tier always`（每轮必跑，与 capability-catalog --superseded-check 同款）。

**验证锚**：修后 (a) `grep -c tick-core scripts/test.sh` > 0；(b) 检查器对当前三份执行核跑通（80/80/80 + 指针存在 + 编号无冲突 + 禁令一致）；(c) 违例（临时把某核撑到 81 行 / 在禁令文档恢复无条件「外层不直接改代码」）能红。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录零覆盖实证（grep tick-core=0、@static-object 只指理由档案、§1.4e 自述）+ 四判据今晚全手工发现（本任务 Proposal 已含）
- [x] AC2: **@static-object 补门**——`orchestration/*-tick-core.md` + 四处禁令文档进静态检查覆盖面
- [x] AC3: **AC30a 检查**——三份执行核各 ≤80 行，违例红
- [x] AC4: **指针目标检查**——执行核引用路径目标文件存在，缺失红
- [x] AC5: **编号冲突检查**——判准编号不与 B3 组冲突，冲突红
- [x] AC6: **禁令一致性检查**——「不要自己用 Agent / 外层不直接改代码」与核 `run_in_background: true` 并存即报；禁令文本带「收窄/理由=单一写入者/共享树」放行
- [x] AC7: **@static-tier always 接线**——每轮必跑（非 change-only）
- [x] AC8: **既有不回归**——`--for-task` scoped 门绿

**invoke 证据（inner 2026-08-10 实测）**：`node --no-warnings --experimental-strip-types plugin/scripts/tick-core-static-check.ts --root "$REPO_ROOT"` 输出：

```
tick-core-static-check: AC3 lines manager-tick-core.md=80 / orchestrator-tick-core.md=80 / fast-mode-tick-core.md=80 (max 80)
tick-core-static-check: AC4 pointer targets OK
tick-core-static-check: AC5 B3 numbering OK
tick-core-static-check: AC6 prohibition consistent
tick-core-static-check: PASS — execution cores are statically covered.
```

**违例红（AC3 负控）**：把某核撑到 81 行 ⇒ exit 1 + `FAIL: orchestration/orchestrator-tick-core.md is 81 lines (> 80)`。
**违例红（AC6 负控）**：在禁令文档恢复无条件「外层不直接改代码」（无 收窄/单一写入者/共享树）⇒ exit 1 + `FAIL: … — 外层不直接改`。
**scoped 门**：`./scripts/test.sh --for-task gap-tick-core-zero-static-coverage --allow-thin` ⇒ `tests 12 · pass 12 · fail 0 · cancelled 0`，且 scoped 静态检查含 `tick-core-static-check … PASS`。

## Definition of Done

- [ ] AC1–AC8 全部勾上
- [ ] 修后实跑：三核 80/80/80 + 违例红（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（@static-object 加 orchestration/*-tick-core.md + 四处禁令文档 + @static-tier always 接线）
- plugin/scripts/tick-core-static-check.ts（AC30a ≤80 / 指针存在 / 编号冲突 / 禁令一致性 四判据）
- plugin/test/tick-core-static-check.test.mjs（AC3-AC8 测试）
- orchestration/orchestrator-tick-core.md（自身：若被执行核文件改动）
- orchestration/outer-brief-2026-08-04-third-restart.md（禁令一致性检查对象）
- orchestration/QUAY-OUTER-HANDOFF.md（禁令一致性检查对象）
- orchestration/exp6-phase1-sustained-unattended-operation.md（禁令一致性检查对象）
- orchestration/orchestrator-loop-tick.md（边界表——禁令一致性检查对象）
- tasks/gap-tick-core-zero-static-coverage.md（自身：勾 AC + 贴输出）

## Contract

measure   tick_core_static_coverage = `grep -c "tick-core" scripts/test.sh` 的 stdout 数字
band      tick_core_static_coverage >= 1（@static-object 覆盖执行核）
invariant ac30a_checked_mechanically = 1（AC30a ≤80 机械检查,非手工 wc）
invariant pointer_targets_checked = 1（指针目标存在检查）
invariant criterion_numbering_checked = 1（判准编号不与 B3 组冲突）
invariant prohibition_consistent = 1（禁令文本与执行核一致:禁止语+核内 run_in_background 并存即报）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/tick-core-static-check.ts --root "$REPO_ROOT" --check`（贴输出：80/80/80 + 违例红 + 禁令一致性）
control   补门覆盖执行核+禁令文档；四判据机械化；@static-tier always 每轮跑
resume    补门 / 检查器 / 接线 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人 2026-08-10 判据A——执行核 0 静态覆盖（tick-core 在 @static-object 0 次,覆盖的是理由档案）；AC30a/指针/编号 今晚全手工发现零机械拦截;§1.4e 自述即此。实现归 inner;outer 执行核已记判据B(快路径例外清单)
