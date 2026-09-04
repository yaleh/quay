---
id: gap-archguard-p5-instrument-decay-standing-guard
title: 落地 P5 仪器腐烂常驻检测器（instrument-decay-check.ts）——伴生对照而非绝对速率阈值，覆盖全部 jsonl
  载体，须能抓到「写手分裂到另一文件」这类腐烂
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

正本 `docs/proposals/archguard-generation-era-primitives.md` §3 P5（仪器腐烂）+ 附录A 已给出可复用
的 python 聚合脚本骨架（"按 step 分组统计 `.quay/fan-in-step-trace.jsonl` 的 step-end 计数与末次
时刻"）。本任务把它从"手跑一次性诊断"升级为常驻守卫，并推广到全部 jsonl 载体，不止
`fan-in-step-trace.jsonl` 一个。

**本次立案时对 `fan-in-step-trace.jsonl` 案例的现场复核，发现一个比文档记述更精确的根因**（见
[[gap-fan-in-step-trace-suite-step-stopped-writing]]）：`suite` 相关步骤停写不是仪器本身坏了，而是
2026-08-28 commit `a5a301e03` 把这些步骤的 trace 调用改指向了另一个 per-run 持久化日志文件
（`fan-in-<task>-<runId>.log`），两个写手并存但只有一个被文档 §附录A 的诊断脚本读。**这正是文档 P5
"定义"里说的"写入速率归零，而产生路径仍在运行"的字面实例，只是产生路径没有真的停，是被复用到了
另一个文件。**

**⇒ 本任务实现的通用检测器必须能抓到这一类"载体 A 停写，但同一批事件其实转移去了载体 B"的腐烂**，
不能只做"绝对速率→0"的朴素判断——文档 P5 的反向判据本身也要求用"伴生对照"而非绝对速率阈值。

**实现 `plugin/scripts/instrument-decay-check.ts`**：对仓库内已知的 jsonl 运行时载体（`.quay/*.jsonl`，
含 `fan-in-step-trace.jsonl`/`checker-cost.jsonl`/`fan-in-lock-events.jsonl`/`verification-round.jsonl`
等）逐个建时间序列（按 event/step 分组的末次写入时刻），当某个分组的写入速率→0 而**同一份载体里的
其它分组仍在写**（伴生对照）时告警；不用绝对速率阈值。

## AC

- [x] AC1：对 `fan-in-step-trace.jsonl` 跑该检查器，须报出 `suite`/`suite-start`/`suite-end`/
      `suite-skip`/`ac-precheck` 相关分组停写，同时报出伴生分组（`merge-develop`/`typecheck`/
      `scoped-gate` 等）仍在写的对照证据——真实复现文档已知案例，且与
      [[gap-fan-in-step-trace-suite-step-stopped-writing]] 的现场发现一致
- [x] AC2（反向判据，文档已给）：不得把真正低频但仍在写的载体（如 `message-receipts.jsonl`）报为
      腐烂——用绝对速率阈值的实现必然踩这个，是判不通过的充分条件；须提供一个负例回归测例
- [x] AC3：新增单测 `plugin/test/instrument-decay-check.test.mjs`（用 fixture jsonl，不依赖真实
      `.quay/` 状态随时间漂移），`node --experimental-strip-types plugin/test/instrument-decay-check.test.mjs`
      exit 0
- [x] AC4：脚本接入某个常驻检查节奏（如作为 `checker-cost-lib.sh` `run_checker` 包裹的一员，或独立
      挂进 manager/outer 的例行巡检——具体挂点由实现时决定，但必须真的被某条执行路径调用，不能只是
      "存在但没人调"——本仓库自己就有"一个恒绿的检查比没有检查更贵"的前车之鉴，新检查器落地当轮
      就要证明自己被调用了，贴出接线点）

## DoD

AC1 的真实输出（对当前仓库跑出的，不是文档里旧的 2026-08-30 数字）贴进任务体，证明检测器独立
复现了文档已知的案例；脚本已接入执行路径（贴出调用点证据，如 `checker-cost.jsonl` 里出现该检查器
的记账行，或例行巡检脚本里可见的调用）。

### AC1 真实输出（2026-09-04 对共享检出 `.quay/` 实跑，exit 1）

```
INSTRUMENT-DECAY: .quay/fan-in-step-trace.jsonl — 4 group(s) stopped writing
  decayed: ac-precheck — never-wrote (0 records, expected — writer split to another file?)
  decayed: suite-start — never-wrote (0 records, expected — writer split to another file?)
  decayed: suite-end — never-wrote (0 records, expected — writer split to another file?)
  decayed: suite-skip — never-wrote (0 records, expected — writer split to another file?)
  companion (still writing): scoped-gate last=2026-09-04T12:23:13.967Z (49); doc-check last=2026-09-04T12:23:13.940Z (34); typecheck last=2026-09-04T12:22:49.240Z (50); anti-drift last=2026-09-04T12:22:48.251Z (50); merge-develop last=2026-09-04T12:22:47.887Z (52); ff last=2026-09-04T12:22:19.915Z (16)
```

独立复现了文档 §2.5 已知案例：ac-precheck/suite-start/suite-end/suite-skip 四条在共享载体为 0 条
（写手分裂到 per-run `fan-in-<task>-<runId>.log`），而 merge-develop/typecheck/scoped-gate 等伴生分组
仍在写——与 [[gap-fan-in-step-trace-suite-step-stopped-writing]] 的现场发现一致。

### AC4 接线点证据

- 接线点（例行巡检脚本里可见的调用）：`plugin/scripts/runner-static-gate.ts` `run_operational_checks()`
  末尾，紧跟 `suite-duration-exceed-check` 同款 report-only 接线：
  `run_checker "instrument-decay-check" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/instrument-decay-check.ts" --root "${main_root}" --no-block`
  （`--root "${main_root}"` 读共享检出的 gitignored 遥测载体；`--no-block` 报告但永不红整轮；默认 fail-closed
  留给按需诊断与未来 manager 闸。）
- `checker-cost.jsonl` 记账行（`run_checker` 实跑后落到共享检出，证明真被调用）：
  `{"name":"instrument-decay-check","ms":406,"n":1,"load":9.67,"at":"2026-09-04T12:24:37Z"}`

## Touches

- plugin/scripts/instrument-decay-check.ts（新增）
- plugin/test/instrument-decay-check.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- plugin/scripts/runner-static-gate.ts（AC4 接线：run_operational_checks 挂入）
- tasks/gap-archguard-p5-instrument-decay-standing-guard.md
