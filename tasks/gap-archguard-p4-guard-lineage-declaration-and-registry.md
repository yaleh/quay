---
id: gap-archguard-p4-guard-lineage-declaration-and-registry
title: 落地 P4 守卫谱系（guard-lineage-check.ts）——头部声明块 + verdict 记录流，165 个守卫中今天 0% 已声明守卫对象
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-checker-cost-jsonl-add-verdict-field
    - gap-archguard-p5-instrument-decay-standing-guard
---
**type:** execution

## Proposal

正本 `docs/proposals/archguard-generation-era-primitives.md` §3 P4（守卫谱系 Guard Lineage）已给出
定义（每个检测器机器可读地声明四元组 `⟨guards, wired-into, last-run, last-fired⟩`，工具核验前两项、
记录后两项）、计算方法、可证否的验收判据与反向判据。

依赖两个前置任务：
- [[gap-checker-cost-jsonl-add-verdict-field]] 提供 `verdict` 字段——P4 的"曾变红比例"今天算不出来，
  直接原因就是这个字段缺失（文档原文）；
- [[gap-archguard-p5-instrument-decay-standing-guard]] 的 `last-fired`/写入速率判断逻辑可直接复用，
  不重新实现一套时间序列分析。

两项须先落地本任务才能开工，本任务只做：① 守卫头部声明块（可复用现有
`plugin/scripts/capability-catalog.sh` 的登记位，新增字段声明该守卫"守的是什么对象/不变式"）；
② 把 verdict 记录流接进谱系查询。

## AC

- [x] AC1：对本仓库全部守卫（文档测量口径见 §2.3：`plugin/scripts/` + `experiments/quay-perpetual-stream/scripts/`
      + `plugin/gate-scripts/` 按目录去重、排除 worktree 与 gitignored 镜像，文档记录 165 个），现场
      重新枚举一遍（数字可能已随开发变化，以现场跑出的为准，不照抄文档旧数字），工具须能报出"已
      声明守卫对象的比例"（文档记述今天应为 0%，落地时须现场核实此值是否已变——本任务的 AC3 会让
      它变为非零，AC1 测的是本任务开工前的现状）
- [x] AC2：报出"窗口内曾变红的比例"（依赖 `verdict` 字段，若 [[gap-checker-cost-jsonl-add-verdict-field]]
      落地不完整则本 AC 标 `not-evaluated`，不得伪造非零值）
- [x] AC3：为至少 5 个真实守卫脚本补上声明块作为试点——建议选文档 §2.3"职责重叠"表里 3 组之一
      （如 `manager-tick-log-check.sh` vs `outer-tick-log-check.sh`）+ `checker-mutation-check.sh`
      这类预防性守卫，覆盖正反两种形态；声明后工具能逐个回答"该守卫的对象是否仍存在"
- [x] AC4（反向判据，文档已给）：不得把 `checker-mutation-check` 这类**预防性**守卫因"从未变红"报为
      可疑——判定必须同时采信 `last-fired` 与 `mutation-verified` 两项证据，须提供该负例的真实脚本
      输出
- [x] AC5：新增单测 `plugin/test/guard-lineage-check.test.mjs`，
      `node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs` exit 0

## DoD

AC1/AC2 的真实现场输出贴进任务体；AC3 的 5 个试点声明块真实写入对应脚本文件并被工具正确读出（贴
读出结果）。脚本接入 capability-catalog 登记。

### AC1 真实输出（2026-09-04 对主检出 `--root /home/yale/work/quay` 实跑，开工前现状）

主检出 capability-catalog.sh 尚无 GUARD_OBJECT 声明块 ⇒ 已声明守卫对象比例 = 0/174 = 0.0%。
现场重新枚举 = **174 个**（文档记 165，随开发增长 +9），按目录：plugin/scripts 123 +
experiments/quay-perpetual-stream/scripts 39 + plugin/gate-scripts 12。

```
== AC1 已声明守卫对象 — 0/174 = 0.0% ==
  total guards enumerated (三目录去重): 174
```

### AC2 真实输出（同一实跑，读主检出 `.quay/checker-cost.jsonl` 的 verdict 字段）

verdict 字段由 [[gap-checker-cost-jsonl-add-verdict-field]] 于同日落地，窗口内只有 56 条 verdict-bearing
行（全部 `pass`）⇒ 窗口内曾变红 = 0/174 = 0.0%。**非 not-evaluated**（verdict 字段已落地、真实可读），
也**未伪造非零值**（诚实报 0）。

```
== AC2 窗口内曾变红 — 0/174 = 0.0% ==
  window: 2026-09-04T13:04:58Z → 2026-09-04T17:47:50Z (56 verdict-bearing rows; 53437 pre-verdict rows ignored)
  fired (verdict:"fail"): none — 0 guards went red in the verdict-bearing window
```

### AC3 真实输出（`--root 主检出 --catalog 本 worktree 的 capability-catalog.sh`，5 个试点声明块写入后）

5 个试点声明块写在 `capability-catalog.sh` 的 `declare -A GUARD_OBJECT=(...)`（复用 catalog 登记位，
Touches 只声明 catalog 一处，不散落改各守卫脚本）。工具逐个回答对象存在性：2 个 file 对象
（`orchestration/manager-tick-log.md` / `orchestration/tick-log.md`，均 PRESENT——它们是与 checker-cost
同族的 gitignored 运行时文件，只存在于主检出）+ 3 个 invariant 对象（如实报 not-mechanically-checkable）。

```
== AC3 已声明守卫的对象存在性 — 5 declared ==
  checker-mechanical-spine-check.ts  [invariant]  —  invariant:every shipped checker conforms to the mechanical-spine contract ...
  checker-mutation-check.sh  [invariant]  —  invariant:every registered checker can be mutation-reddened (preventive ...)
  instrument-decay-check.ts  [invariant]  —  invariant:telemetry carriers under .quay/ keep writing ...
  manager-tick-log-check.sh  [file]  PRESENT  file:orchestration/manager-tick-log.md
  outer-tick-log-check.sh  [file]  PRESENT  file:orchestration/tick-log.md
```

### AC4 真实输出（同一实跑，反向判据负例）

`checker-mutation-check.sh` 是预防性守卫（从未变红），但因有 mutation case
（`checker-mutation-cases/checker-mutation-check.sh` ⇒ mutation-verified）被归入 **preventive**，**不在
suspicious** 名单——判定同时采信 `last-fired` 与 `mutation-verified` 两项证据。对照：`manager-tick-log-check.sh`
无 mutation case ⇒ 诚实归入 suspicious（证明判别力真实存在，不是把两者混为一谈）。

```
== AC4 反向判据 — disposition (只判已声明守卫) ==
  preventive (never-fired ∧ mutation-verified): 4
    checker-mechanical-spine-check.ts  — never-fired but mutation-verified ... — preventive, not suspicious
    checker-mutation-check.sh  — never-fired but mutation-verified ... — preventive, not suspicious
    instrument-decay-check.ts  — never-fired but mutation-verified ... — preventive, not suspicious
    outer-tick-log-check.sh  — never-fired but mutation-verified ... — preventive, not suspicious
  suspicious (never-fired ∧ ¬mutation-verified): 1
    manager-tick-log-check.sh  — never-fired and not mutation-verified — indistinguishable from a broken guard (P4 定义)
```

### AC5 真实输出

`node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs` → **8 pass / 0 fail, exit 0**。
单测覆盖 parseGuardObjects 的「遇 `)` 停、不读进后续数组」回归（首版 continue 而非 break 曾读成 310 条错值，
本 DoD 贴出的 5 declared 正确读数正是在该回归被单测钉住之后产出的）。

## Touches

- plugin/scripts/guard-lineage-check.ts（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本 + 试点声明块）
- plugin/test/guard-lineage-check.test.mjs（新增）
- tasks/gap-archguard-p4-guard-lineage-declaration-and-registry.md
