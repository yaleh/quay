---
id: gap-meta-active-but-failing
title: computeDivergences has no branch for status=active ∧ verdict=fail — a
  committed, measurably-failing AC produces no divergence at all
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
plugin/scripts/meta-driver.ts:495-504 skips non-commitment statuses, then covers active+pass (pass-but-unflipped), achieved+fail (achieved-but-failing) and any not-evaluated, but status=active ∧ verdict=fail falls through every branch and emits nothing — so this round's `divergences` is [] while AC-936 (status=active, verdict=fail, the only unachieved AC of the only active goal) has held `fail` for 290 consecutive `timeSeries` rounds (crossed:true), and it is the exact same class of silent fall-through that the `not-evaluated` branch above was added to fix.

本轮读数（divergences）= `[]`，采于 2026-11-08T10:45:02Z，由 meta-driver 机械采集。
涉及机制关键词：`active-but-failing`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --experimental-strip-types --input-type=module -e "const m = await import('./plugin/scripts/meta-driver.ts'); const d = m.computeDivergences([{id:'AC-T', title:null, goal:'GOAL-T', status:'active', criterion:'false', verdict:'fail', reason:'exit 1'}]); if (!Array.isArray(d) || d.length !== 1 || d[0].kind !== 'active-but-failing') { console.error(JSON.stringify(d)); process.exit(1); } console.log('ok');"` ⇒ computeDivergences returns exactly one divergence of kind `active-but-failing` for an active AC whose criterion fails (today it returns [], verified), and DIVERGENCE_HANDLER_KIND gains a matching entry — the Record<DivergenceKind,string> type makes the union addition fail to compile until the handler mapping is also decided.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence
- 判据实跑（worktree `/home/yale/work/quay-worktrees/gap-meta-active-but-failing`，实现提交 2e9971c3a）：输出 `ok`，exit 0。
- 判据能取假（负控，同一命令、只把实现里新增的那条 `active-but-failing` 分支删掉后重跑）：输出 `PRE-FIX (expected RED): []`，即旧实现下该判据红——判据不是恒绿的。
- `node --experimental-strip-types --test plugin/test/meta-driver.test.mjs`：tests 189 / pass 189 / fail 0（含新增 `active-but-failing` 判定、`DIVERGENCE_HANDLER_KIND` 映射、`DivergenceKind ↔ probe 规格` 三条及其负控）。
- DoD 第 2 条的口径：修的是既有通道 `computeDivergences`（divergences 唯一的产出点），未新建任何并行判定机制；同时把这条读数的消费侧（`plugin/probes/meta-driver.md` 的 kind 清单 / handler.kind 映射 / 回复 schema 枚举）补上，新增的测试从 `DivergenceKind` 联合体按位置取成员清单（⛔ 不手写清单），防止下一个新 kind 再次以未声明形态抵达语义半。
- L_D import-graph-check（worktree @ 2e9971c3a，`node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json`）：evaluated=true files=639 edges=1844 valueEdges=1680 typeEdges=164 valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 gateLayerViolations=0 notAnalyzed=10
- L_G：该轴仍暗,理由:本任务只给既有判定函数补一个分支与其消费侧声明，不新增模块/依赖边，也没有可归因的重复-抽象读数（未跑 detect_duplicates 就不编数值，硬规则 3b）。

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/probes/meta-driver.md`
- `tasks/gap-meta-active-but-failing.md`