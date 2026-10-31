---
id: gap-instrument-decay-baseline-red-exempt-condition-stale-proxy
title: instrument-decay 的 baseline-red-exempt
  裁定条件把「baselineFiles===0」当结构理由——baseline 重现红集后恒误报 rate-stopped；真实触发是「窗口内没有 A/B
  判 exempt」
status: done
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

**现状读数**（2026-10-30T23:26Z，主检出 `/data/home/yale/work/quay`，HEAD `748d0c609`，分支 `author`；`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`）：

```
ok:false evaluated:true decayedCount:1 adjudicatedCount:5
fan-in-step-trace.jsonl (freshest=2026-10-30T23:26:34.517Z, totalRecords=22040, groupCount=28)
  decayed: baseline-red-exempt  rate-stopped  count=83  lastWrite=2026-10-29T17:24:11.160Z
  detail: condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained
```

`baseline-red-exempt` 是 `fan-in-step-trace.jsonl` 里 Shape B 的伴生分组（不在 `expected[]`），写手 `plugin/scripts/worker-fan-in.ts:3486-3488`：`runBaselineEquivalence(...)` → `verdict.kind === "exempt"` → `traceSuiteEvent("baseline-red-exempt", ...)`。它已有一条 `conditional-on-input` 裁定（由 `gap-instrument-decay-baseline-red-exempt-unadjudicated` 落地），条件命令是 `BASELINE_RED_EXEMPT_TRIGGER_CMD`。本条报的不是「没有裁定」，是**裁定探针自身过期**——条件命令现在 exit 1，把一条仍成立的裁定误报成「declared cause 消失」。

**直接成因（本轮实读，不是写手腐烂）**：`BASELINE_RED_EXEMPT_TRIGGER_CMD` 的第 ② 检查是
`if(nums.some(r=>r.baselineFiles!==0))process.exit(1)`——它把「**baseline 红集为空 ⇒ exempt 结构不可达**」
这个特定结构理由写死进了条件。但末次 `baseline-red-exempt`（`2026-10-29T17:24:11.160Z`）之后的窗口里有 4 条
`baseline-red`（A/B）记录，其中前两条 `baselineFiles=2`（develop 的基线红集重新变非空），于是第 ② 检查
`baselineFiles!==0` 命中 ⇒ exit 1。

而窗口内这 4 条 A/B **全部是 `hard-red`**（`added>0`，task 引入了基线之外的新红）——没有一条判 `exempt`：

| ts | task | verdict | baselineFiles | taskFiles | added |
|---|---|---|---|---|---|
| 2026-10-29T23:01:15.427Z | gap-goal912-merge-suite-gitignore-blanket-and-l1-test-stale | hard-red | 2 | 5 | 5 |
| 2026-10-29T23:43:42.676Z | gap-goal-branch-unmerged-goal-912 | hard-red | 2 | 3 | 2 |
| 2026-10-30T07:02:25.404Z | gap-quay-init-codex-host-trio-laydown | hard-red | 0 | 1 | 1 |
| 2026-10-30T12:09:58.405Z | gap-codex-plugin-json-version-not-a-carrier | hard-red | 0 | 15 | 15 |

⇒ 分组缺席的**真实**解释是「窗口内没有一次 A/B 判 `exempt`」，写手没有腐烂。第 ③ 检查（写手腐烂守卫：
每条 `exempt` 的 `baseline-red` 必须等到同 task 的 `baseline-red-exempt` / `suite-recovery-baseline-exempt` 收尾）
在窗口内 0 条 exempt 的情况下本来就 `bad=0`、exit 0。是第 ② 检查这个**过期的代理量**把读数打红：它把
「baseline 为空」与「exempt 不可达」等同，而 baseline 非空 + task 引入新红时 exempt 同样不可达（`exempt ⇔
task 红集 ⊆ baseline 红集`，`added>0` 即不满足）。「被声明成因消失」是**条件读错了量**，不是成因真的消失。

**写手路径仍在（当前 HEAD 实读）**：`worker-fan-in.ts:3486-3488` 的
`if (baselineEquivalence !== null && baselineEquivalence.verdict.kind === "exempt") { traceSuiteEvent("baseline-red-exempt", {...}); }`
原样在场；末次 exempt A/B（`2026-10-29T17:24:09.972Z`，task `gap-full-suite-runner-cgroup-ac3-live-carrier-double-read-race`）
后紧跟本组写入（`17:24:11.160Z`）⇒ 配对完好，写手未停。

**节奏**：本组不是 `rare-by-design`（前任务已定：`baseline-red` 步全历史 exempt 100 / hard-red 55 / not-evaluated 21，
是一条主流终端分支）。触发（A/B 判 exempt）自 `2026-10-29T17:24` 起没有再发生，因为窗口内 A/B 全部 hard-red。

**修法方向**：把 `BASELINE_RED_EXEMPT_TRIGGER_CMD` 的判定从「baseline 为空」这个**特例代理**改成**一般触发**——
窗口（末次 `baseline-red-exempt` 之后）≥1 条 A/B；`baselineFiles` 字段可读（缺值/读不懂 ⇒ exit 1，fail-closed 守卫**保留**）；
**删除** `baselineFiles!==0 ⇒ exit 1` 这一条（它把「baseline 非空」误当成「exempt 可达」）；写手腐烂守卫（第 ③ 检查）
保持不动——它就是「没有 A/B 判 exempt 而没有对应收尾」的一般形态。同时更新 MANIFEST 里该条裁定的 `reason`
文本：不再点名「当前 reds=[]」这个会随修/坏翻转的实例，改为机制本身（`exempt ⇔ task 红集 ⊆ baseline 红集`，
absence 的解释是「窗口内没有 A/B 判 exempt」，与 baseline 是否为空无关）。

<!-- dedup-ref --> 合并判断 = separate：`task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts --touches plugin/test/instrument-decay-check.test.mjs --json` 无 Touches 重叠的 open 任务；open `gap-instrument-decay-postlanding-two-rounds`（ready）同处 instrument-decay 面，但验的是「同一 pair 第二轮记 already-filed」的轮次账本读数，与本条「baseline-red-exempt 条件命令过期代理」是两个机制。

<!-- dedup-ref --> prior-claim: `gap-instrument-decay-baseline-red-exempt-unadjudicated`（done）——它落地了本组的 `conditional-on-input` 裁定与 `BASELINE_RED_EXEMPT_TRIGGER_CMD`；本轮按硬规则 5b 在当前 HEAD 复核：载体仍暗（`decayed[]` 仍含本组）、但成因已从「没有裁定」变成「裁定条件过期代理」⇒ done ≠ absent，故新立本案，不是重复立案。同族先例（同 shape、不同分组）：`gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated`（done，把三态压成布尔）、`gap-instrument-decay-suite-rerun-green-file-pin-expired`（done，文件 pin 过期）——两者都是「conditional-on-input 条件命令读错量」的修复先例。

## AC

- [x] AC1（现状复现，机器面）在主检出运行 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`，断言：`decayed[]` 恰含 1 条 `{group:"baseline-red-exempt", kind:"rate-stopped"}`，其 `count === 83`、`lastWrite === "2026-10-29T17:24:11.160Z"`、`detail` 匹配 `/condition command did not hold \(exit 1\)/`；`adjudicated[]` 不含 `baseline-red-exempt`。贴出 `decayed` 与该组在 `companions` 之外的状态。判据可假：若探针已修好或本组恢复写入，该读数即改变。
- [x] AC2（写手在、触发未发生，三条实读）① 贴出 `worker-fan-in.ts:3486-3488` 的 `baseline-red-exempt` 写手现场；② 用当前载体算出「末次 `baseline-red-exempt` 之后」的 `baseline-red`（A/B）记录条数与逐条 `verdict` / `baselineFiles` / `taskFiles` / `added`，断言窗口内 ≥1 条 A/B、且**没有一条 `verdict==="exempt"`**；③ 末次 exempt A/B（`verdict==="exempt"`）后紧跟同 task 的 `baseline-red-exempt` 写入（配对完好）。判据可假：若窗口内出现一条 `verdict==="exempt"` 却没有同 task 收尾 ⇒ 写手真腐烂，「触发未发生」为假，本条改按写手修复收口。
- [x] AC3（机制落点 + 正负控制）修改 `BASELINE_RED_EXEMPT_TRIGGER_CMD`：**删除** `baselineFiles!==0 ⇒ exit 1`，**保留**「窗口 ≥1 条 A/B」与「`baselineFiles` 字段可读（缺值 ⇒ exit 1）」两个 fail-closed 守卫，写手腐烂守卫（每条 exempt 必须同 task 收尾）不变；并更新 MANIFEST 该条 `reason` 为机制本身（不点名当前 reds 实例）。在 `plugin/test/instrument-decay-check.test.mjs` 增加用例并贴出正负控制：① 正控制——当前真实生产载体上 `conditionCmd` exit 0、该组进入 `adjudicated[]`（`state:"explained-absent"`、`count=83`、`lastWrite` 不变）；② 负控制——窗口内一条 `baseline-red` `verdict:"exempt"` 无同 task 收尾 ⇒ exit 1、回 `decayed[]`；③ 负控制——窗口内 0 条 A/B ⇒ exit 1；④ 负控制——A/B 缺 `baselineFiles` 字段 ⇒ exit 1；⑤ 正控制（新场景）——窗口内 A/B 全 hard-red 但 `baselineFiles` 非 0（如 =2）⇒ exit 0（这是本条修的核心：baseline 非空不再误报）。判据可假：任一负控制仍被豁免 ⇒ 探针过宽；正控制 ⑤ 仍 exit 1 ⇒ 修法没生效。
- [x] AC4（读数不消失）改后重跑 detector：`decayed[]` 不再含 `baseline-red-exempt`；该组出现在 `adjudicated[]` 且 `count` / `lastWrite` 与 AC1 完全一致（⛔ 不得因「不算腐烂」从读数消失，硬规则 3b）。贴出 `--json` 的 `decayed[]` 与 `adjudicated[]`。
- [x] AC5（回归）`bash scripts/test.sh --for-task gap-instrument-decay-baseline-red-exempt-condition-stale-proxy` 通过（含 `plugin/test/instrument-decay-check.test.mjs`）；贴出 scoped 静态检查与命中文件的 tests/pass/fail。

## DoD

- [x] AC1–AC5 全绿；改动只在 `plugin/scripts/instrument-decay-check.ts` 与 `plugin/test/instrument-decay-check.test.mjs`（+ 任务文件经 `task_write`），不改 Shape B 判定逻辑、不新增第二套裁定表——只改 `BASELINE_RED_EXEMPT_TRIGGER_CMD` 常量与 MANIFEST 该条 `reason` 文本。
- [x] 真实载体上跑出 AC4 的读数（不是 fixture 回显）：`adjudicated[]` 里的这一条由生产 `.quay/fan-in-step-trace.jsonl` 的实跑产生，并贴出运行时刻、载体 `freshest` 与 `count` / `lastWrite`。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-baseline-red-exempt-condition-stale-proxy.md

## Dark Axis

- 该轴仍暗,理由:本任务只改 instrument-decay-check.ts 的 BASELINE_RED_EXEMPT_TRIGGER_CMD 条件命令与 MANIFEST reason 文本 + 测试夹具，不新增依赖/环/模块，无 L_D/L_G 读数可采。