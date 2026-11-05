---
id: gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated
title: >-
  instrument-decay 报 7 个 rate-stopped 分组（anti-drift-land / ac-gate / ff / rerun
  / dark-axis /
    slice-readings-post 无裁定 + suite-rerun-green 裁定条件又过期）：真实成因是 2026-11-04T16:06 起 task-introduced
    红（full-suite-runner-cgroup）挡死落地、无 fan-in 穿过 suite 闸
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状读数**（2026-11-06，主检出 `/data/home/yale/work/quay`，HEAD `7320e3745`，分支 `author`；`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`）：

```
ok:false evaluated:true decayedCount:7 adjudicatedCount:8
fan-in-step-trace.jsonl (freshest=2026-11-05T16:44:17.658Z, totalRecords=23951, groupCount=29)
  decayed:
    anti-drift-land     rate-stopped count=1836 lastWrite=2026-11-04T16:06:54.996Z
    ac-gate             rate-stopped count=1836 lastWrite=2026-11-04T16:06:55.292Z
    ff                  rate-stopped count=1820 lastWrite=2026-11-04T16:06:55.458Z
    rerun               rate-stopped count=381  lastWrite=2026-11-04T16:06:52.969Z
    suite-rerun-green   rate-stopped count=98   lastWrite=2026-11-04T16:06:52.969Z
                        detail: condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained
    dark-axis           rate-stopped count=386  lastWrite=2026-11-04T16:06:55.303Z
    slice-readings-post rate-stopped count=183  lastWrite=2026-11-04T16:06:55.356Z
```

这 7 个分组都在 `2026-11-04T16:06:52–55` 这个 ~3 秒窗口内最后一次写入，而伴生分组（merge-develop / typecheck / scoped-gate / doc-check / suite-start / suite-end / suite-incomplete / baseline-red / develop-red-set / suite-recovery-blocked）此后仍在写。它们分属两类成因，都不是写手腐烂：

**第一类（5 个，suite 绿之后的落地步骤）**：anti-drift-land（worker-fan-in.ts:3674）、ac-gate（:3676）、ff（:3710/:3724）、dark-axis（worker-fan-in-hooks.ts:264–272，pre-flip 钩子）、slice-readings-post（:351，post-flip 钩子）。这五步在 `runMechanicalFanIn` 里位于 suite 绿块之后（suite 放行 → anti-drift-land → ac-gate → runFanInHooks{pre:dark-axis, flip, post:slice-readings-post} → ff）。自 `2026-11-04T16:06` 起，任务 `gap-arbitrary-semantics-unenforced-carriers` 的每一轮 fan-in 都在 suite 闸被挡回：suite-end ok:false → suite-incomplete（oom-killed / incomplete）→ 恢复阶梯 → suite-recovery-blocked（"recovery red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-cgroup.test.mjs … needs a code fix"）。⇒ 没有任何一轮落地穿过 suite 闸，这五步的结构性触发（suite 放行）没有再发生，写手路径原样在场。

**第二类（2 个，suite 红路径上的重跑步骤）**：rerun（worker-fan-in.ts:2856/:2877）只在「suite 红 + 非 inconclusive + 失败文件解析出 ≥1 个点名文件」时写；suite-rerun-green（:3590）只在 rerun 转绿时写。当前的红是 OOM/incomplete 形态，由恢复阶梯在 rerun 之前接管（`if (!recoveredCertified) { const inconclusive = ...; if (inconclusive) return ...; failedTestFiles = readFailedTestFiles(...); rerun = await runInRoundRerun(...) }`）——恢复阶梯耗尽直接 `return failSuite`，永远走不到 rerun。⇒ 自 `2026-11-04T16:06:52.969Z`（末次 suite-rerun-green）之后 `rerun` 记录 0 条。

**suite-rerun-green 的裁定条件又过期（第三处缺陷）**：它已有一条 `conditional-on-input` 裁定（`gap-fan-in-step-trace-rate-stopped-adjudication` 落地、`gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated` + `gap-instrument-decay-suite-rerun-green-file-pin-expired` 两次修过条件），其条件命令要求「末次 green 之后 ≥1 条 rerun」（⛔ 不用「零 rerun」空转真值换绿）。但现在的结构事实是 rerun 本身不可达（见第二类），窗口内 rerun = 0 ⇒ 条件 exit 1，把「声明成因消失」误报出来——与 `gap-instrument-decay-baseline-red-exempt-condition-stale-proxy` 同族：条件读的是过期代理量，不是触发输入本身。

**修法方向**：不给 7 个分组永久豁免，也不手改 Shape B 判定逻辑。在 MANIFEST 的 `adjudicated[]` 里为 6 个无裁定的分组加 `conditional-on-input` 裁定，条件读【触发输入】：
- 第一类 5 组：窗口（末次写入之后）内必须 ≥1 次落地尝试（merge-develop/suite-start 在场，⛔ 零尝试 = loop 死 = exit 1），且窗口内没有一次 suite 放行（suite-end ok:true / suite-skip / suite-rerun-green / baseline-red-exempt / suite-recovery-accepted）——没有放行 ⇒ 缺席已解释 exit 0；有放行而本组没写 ⇒ 写手腐烂 exit 1。
- rerun：窗口内每一次 suite-end ok:false 都必须伴随 suite-incomplete（即红全是 OOM/incomplete 形态、恢复阶梯接管）；出现一条没有 suite-incomplete 的普通红（本该走到 rerun）而 rerun 没写 ⇒ exit 1。
- suite-rerun-green：把条件从「≥1 条 rerun」改成读 rerun 的可达性——窗口内 rerun 记录 0 条时，必须证成「红全是 OOM/incomplete（suite-incomplete 在场、恢复阶梯接管）」；rerun 记录非 0 时沿用现有三态判据（出现 rerun-green 而没有 suite-rerun-green ⇒ exit 1）。同时更新 MANIFEST 该条 `reason` 为机制本身，不点名当前红文件实例。

<!-- dedup-ref --> prior-claim（done，非重复立案）：suite-rerun-green 的原始裁定与两次条件修复 = `gap-fan-in-step-trace-rate-stopped-adjudication`、`gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated`、`gap-instrument-decay-suite-rerun-green-file-pin-expired`；按硬规则 5b 在当前 HEAD 复核：载体仍暗（`decayed[]` 仍含 suite-rerun-green、detail 仍 `condition command did not hold`）⇒ done ≠ absent，本组是「裁定条件过期」的再腐烂，不是重复。其余 6 组（anti-drift-land/ac-gate/ff/rerun/dark-axis/slice-readings-post）无既有任务裁定过它们，属新暗组。同族先例（同 shape、不同分组）：`gap-instrument-decay-explained-absence-declarations`、`gap-instrument-decay-suite-recovery-groups-unadjudicated`、`gap-instrument-decay-baseline-red-exempt-unadjudicated`、`gap-instrument-decay-baseline-red-exempt-condition-stale-proxy`（均为 done）。

<!-- dedup-ref --> 合并判断 = separate：`task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts --touches plugin/test/instrument-decay-check.test.mjs --json` 的 `peers[]` 为空——无 open 任务 Touches 重叠。

## AC

- [x] AC1（现状复现，机器面）主检出跑 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`，断言 `decayed[]` 恰含 7 条 `kind:"rate-stopped"`，分组 = {anti-drift-land, ac-gate, ff, rerun, suite-rerun-green, dark-axis, slice-readings-post}，各自 count/lastWrite 与本 Proposal 读数一致（若期间有落地穿过 suite 闸，该组会恢复写入、读数自然改变——以实跑为准并说明差异），且 `suite-rerun-green` 的 `detail` 匹配 `/condition command did not hold \(exit 1\)/`、`adjudicated[]` 不含这 7 组。贴出 `decayed[]` 全文。判据可假：若探针已修好或本组恢复写入，该读数即改变。
- [x] AC2（第一类 5 组：写手在场 + 触发未发生，实读）① 贴出 worker-fan-in.ts:3674/:3676/:3710/:3724 与 worker-fan-in-hooks.ts:264–272/:351 的写手现场；② 用当前载体列出 `2026-11-04T16:06:55.500Z` 之后的全部 step 记录，断言每一次落地尝试都终止于 `suite-end ok:false` + `suite-incomplete` + `suite-recovery-blocked`，窗口内 anti-drift-land / ac-gate / ff / dark-axis / slice-readings-post 记录 0 条。判据可假：若窗口内出现一条 suite 放行（suite-end ok:true / suite-skip / suite-rerun-green / baseline-red-exempt / suite-recovery-accepted）而五组没写 ⇒ 触发已发生、写手真腐烂，本条改按写手修复收口。
- [x] AC3（第二类 2 组：rerun 不可达 + suite-rerun-green 条件过期，实读）① 贴出 worker-fan-in.ts:2856/:2877 写手现场；② 手动跑 `suite-rerun-green` 的 `conditionCmd`，断言 exit 1；③ 用当前载体证明「末次 suite-rerun-green（2026-11-04T16:06:52.969Z）之后 rerun 记录 0 条」且「窗口内每一条 suite-end ok:false 都伴随 suite-incomplete」（即红全是 OOM/incomplete 形态、恢复阶梯在 rerun 之前接管）。
- [x] AC4（机制落点 + 正负控制）在 `plugin/scripts/instrument-decay-check.ts` 的 MANIFEST `adjudicated[]` 里：为 anti-drift-land/ac-gate/ff/dark-axis/slice-readings-post 加第一类 `conditional-on-input` 裁定（条件 = 窗口内 ≥1 次落地尝试 + 无 suite 放行 ⇒ exit 0；零尝试或有放行而本组没写 ⇒ exit 1）；为 rerun 加第二类裁定（每次 suite-end ok:false 都伴随 suite-incomplete ⇒ exit 0；出现无 suite-incomplete 的普通红而 rerun 没写 ⇒ exit 1）；修 `suite-rerun-green` 的条件命令与 `reason`（rerun 0 条时读 OOM/incomplete 可达性，rerun 非 0 时沿用三态判据）。在 `plugin/test/instrument-decay-check.test.mjs` 增加用例并贴出正负控制：① 正控制——当前真实生产载体上 7 条 conditionCmd 均 exit 0、7 组进入 `adjudicated[]`（`state:"explained-absent"`、count/lastWrite 与 AC1 一致）；② 负控制——窗口内一条 suite 放行而第一类某组没写 ⇒ exit 1 回 `decayed[]`；③ 负控制——零落地尝试 ⇒ exit 1；④ 负控制——一条无 suite-incomplete 的普通红而 rerun 没写 ⇒ exit 1；⑤ 负控制——窗口内一条 rerun-green 而无 suite-rerun-green ⇒ exit 1。
- [x] AC5（读数不消失）改后重跑 detector：`decayed[]` 不再含这 7 组；7 组出现在 `adjudicated[]` 且 count/lastWrite 与 AC1 一致（⛔ 不得因「不算腐烂」从读数消失，硬规则 3b）。贴出 `--json` 的 `decayed[]` 与 `adjudicated[]`。
- [x] AC6（回归）`bash scripts/test.sh --for-task gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated` 通过（含 `plugin/test/instrument-decay-check.test.mjs`）；贴出 scoped 静态检查与命中文件的 tests/pass/fail。

## DoD

- [x] AC1–AC6 全绿；改动只在 `plugin/scripts/instrument-decay-check.ts` 与 `plugin/test/instrument-decay-check.test.mjs`（+ 任务文件经 `task_write`），不改 Shape B 判定逻辑、不新增第二套裁定表——只改 MANIFEST 的 `adjudicated[]`（+ 条件命令常量）与对应 `reason` 文本。
- [x] 真实载体上跑出 AC5 的读数（不是 fixture 回显）：`adjudicated[]` 里这 7 条由生产 `.quay/fan-in-step-trace.jsonl` 的实跑产生，并贴出运行时刻、载体 `freshest` 与 count/lastWrite。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated.md

## Dark Axis

- 该轴仍暗，理由：本任务只改 instrument-decay-check.ts 的 MANIFEST `adjudicated[]` 与条件命令常量、`reason` 文本 + 测试夹具，不新增依赖/环/模块，无 L_D/L_G 读数可采。


## Evidence

**运行时刻** 2026-11-05T17:47:21Z；载体 `fan-in-step-trace.jsonl` `freshest=2026-11-05T16:44:17.658Z`（改前改后同一份生产载体，未写任何 fixture）。

**AC1 现状复现（改前，主检出 `--carrier fan-in-step-trace.jsonl --json --no-block`）**：`ok:false evaluated:true decayedCount:7`，`decayed[]` 恰含 7 条 `kind:"rate-stopped"`，分组/count/lastWrite 与本 Proposal 读数逐字一致：
- `anti-drift-land` count=1836 lastWrite=2026-11-04T16:06:54.996Z
- `ac-gate` count=1836 lastWrite=2026-11-04T16:06:55.292Z
- `ff` count=1820 lastWrite=2026-11-04T16:06:55.458Z
- `rerun` count=381 lastWrite=2026-11-04T16:06:52.969Z
- `suite-rerun-green` count=98 lastWrite=2026-11-04T16:06:52.969Z，detail 匹配 `/condition command did not hold \(exit 1\)/`
- `dark-axis` count=386 lastWrite=2026-11-04T16:06:55.303Z
- `slice-readings-post` count=183 lastWrite=2026-11-04T16:06:55.356Z

**AC2 写手现场 + 窗口实读**：五组写手原样在场（`worker-fan-in.ts:3674` / `:3676` / `:3710`+`:3724`，`worker-fan-in-hooks.ts:264-272` / `:351`；本任务未改这些文件）。`2026-11-04T16:06:55.500Z` 之后全部 step：3 次落地尝试（merge-develop/suite-start，task=gap-arbitrary-semantics-unenforced-carriers），每次终止于 `suite-end ok:false` → `suite-incomplete` → `suite-recovery-blocked`；窗口内这五组记录 0 条、无一次 suite 放行（suite-end ok:true / suite-skip / suite-rerun-green / baseline-red-exempt / suite-recovery-accepted 均 0）。

**AC3 第二类实读**：写手 `worker-fan-in.ts:2856` / `:2877` 在场。旧 `suite-rerun-green` conditionCmd 手动跑 `sh -c` 得 `exit=1`；`2026-11-04T16:06:52.969Z`（末次 suite-rerun-green）之后 rerun 记录 0 条，且窗口内每条 `suite-end ok:false` 都伴随同 task 的 `suite-incomplete`（3/3，间隔 2–11ms）。

**AC5 读数不消失（改后重跑 detector，`--carrier fan-in-step-trace.jsonl --json --no-block`）**：`ok:true decayedCount:0`，`decayed[]` 不再含这 7 组；7 组全部进入 `adjudicated[]`（`state:"explained-absent"`，count/lastWrite 与 AC1 一致，condition 各自 `exit=0`）：
- `anti-drift-land`(1836) / `ac-gate`(1836) / `ff`(1820) / `dark-axis`(386) / `slice-readings-post`(183) / `rerun`(381) / `suite-rerun-green`(98)，lastWrite 逐字与 AC1 一致。

**AC6 回归**：`bash scripts/test.sh --for-task gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated --allow-thin` exit 0；命中文件 `plugin/test/instrument-decay-check.test.mjs` 64 tests / 64 pass / 0 fail，scoped 静态检查全 PASS（含 test-framework-policy / test-isolation / tmp-leak-pairing / task-contract / malformed-task / touches-one-entry-one-path 等）。