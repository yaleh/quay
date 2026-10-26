---
id: gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated
title: instrument-decay 的 suite-rerun-green 裁定把 rerun-not-evaluated 压成「原因消失」⇒
  每轮误报 rate-stopped；真实阻断是 task-granularity-advice AC6 自 2026-10-21T22:52Z 起持续基线红
status: todo
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

**现状读数**（2026-10-26T04:03Z，主检出 `/data/home/yale/work/quay`，HEAD `423c84fa7`，`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root . --carrier fan-in-step-trace.jsonl --json`）：

```
ok:false evaluated:true totalRecords:20571 freshest:2026-10-25T22:41:55.507Z groupCount:27 decayedCount:1
  suite-rerun-green  rate-stopped  count=79  lastWrite=2026-10-21T16:36:58.159Z
  detail: condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained
```

伴生分组仍在写（`ff` 1586 条 / `rerun` 313 条 / `baseline-red` 157 条；载体 freshest `2026-10-25T22:41:55.507Z`）⇒ 这是「这一组的读数暗了」，不是载体停写。

**直接成因不是「declared cause 消失」，而是裁定探针把三态压成布尔。** MANIFEST 里 `suite-rerun-green` 的 `conditional-on-input` 声明（由 `gap-fan-in-step-trace-rate-stopped-adjudication` 落地）写明的语义是：

> 条件读的是【最新一条 rerun 记录】：它一变绿、或不再点名该文件，本裁定立即失效。

但 `conditionCmd` 实际断言的是 `last.state === "rerun-red"`。载体尾部最后一条 `step==="rerun"` 记录是 **`state:"rerun-not-evaluated"`**（`ts=2026-10-25T22:39:24.256Z`，`exit:null`，`files[]` 仍含 `plugin/test/task-granularity-advice.test.mjs`）。`rerun-not-evaluated` 是写手自己明确保留的第三态（`worker-fan-in.ts` 的 `RerunState`；被 watchdog 中止 / 没有重跑命令 / 解析不出文件），语义是「没评估成」——**既不是绿，也不能当作原因消失**（硬规则 3b）。于是条件命令 exit 1，检测器把一条仍成立的裁定报成「原因已消失」。

**被声明的成因仍然成立（本轮实读）：**

1. `plugin/test/task-granularity-advice.test.mjs` 在当前 HEAD 仍红：`node --test plugin/test/task-granularity-advice.test.mjs` ⇒ 失败用例 `AC6 (production): the quay carrier yields a full 10-bin table with at least one sufficient bin`，断言消息 `at least one bin is under-sampled (otherwise the rule is vacuous)`。实读 `--report --json`：**10/10 bin 都是 `sufficient:true`**（最小 bin `<100` n=310；`population.measured=1443`）⇒ 这条「至少一个 bin 欠采样」的生产断言已随数据增长失效（测试的过期前提，不是产品回归）。
2. 该文件在 `.quay/baseline-red-rounds.jsonl` 的签名中出现 **27** 条，首 `2026-10-21T22:52:41.332Z`、末 `2026-10-25T20:18:25.581Z` ⇒ 持续 develop 基线红。
3. 以末次 green 为界，其后 `rerun` 记录 **90** 条：**84 `rerun-red` + 6 `rerun-not-evaluated` + 0 `rerun-green`**；其中 **87/90** 点名该基线红文件 ⇒ 绿分支仍不可达。

**节奏（不是 rare-by-design）**：`suite-rerun-green` 全历史 79 条、2026-10-11→10-21；相邻 green 间隔中位数 **0.71h**、全历史最大 **20.56h**；末次 green `2026-10-21T16:36:58.159Z` 距本轮已 **107.4h**（≈5.2× 历史最大、≈150× 中位数）⇒ 触发没有发生的时间**远超自身节奏**，按判据值得立案；写手路径 `worker-fan-in.ts:3184-3185` 仍在（`if (rerun.state === "rerun-green") traceSuiteEvent("suite-rerun-green", …)`），写手没有腐烂。

**修法方向（两部分，同一条因果链）：**

- **探针**：把 `suite-rerun-green` 的 `conditionCmd` 改成三态感知——最新 rerun 为 `rerun-red` **或** `rerun-not-evaluated`，且 `files` 仍含该基线红文件 ⇒ exit 0（explained-absent）；`rerun-green`、点名不再含该文件、没有 rerun 记录、或 state 缺失/未知 ⇒ exit 1。⛔ 不是放宽成「非绿即豁免」：未知态仍 fail-closed 到「报腐烂」。
- **真实阻断**：让 `plugin/test/task-granularity-advice.test.mjs` 的 AC6 生产断言不再依赖当前数据分布——把「至少一个 bin 欠采样」在**带已知欠采样 bin 的 hermetic fixture** 上断言（保留该分支被真实执行），生产用例保留它真正能保证的「10 bins / `population.measured>100` / ≥1 sufficient / 每 bin 字段形状」；恢复 develop 基线绿后，`rerun` 才有机会回到 `rerun-green`，本组才会重新写入。

<!-- dedup-ref --> 合并判断 = **separate**（`task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts plugin/test/instrument-decay-check.test.mjs plugin/test/task-granularity-advice.test.mjs --json` ⇒ `peers: []`、`mentions: []`）。同域不同机制：`gap-instrument-decay-dedup-reader-round-log-path`（todo）修的是立案去重台账读路径，不触碰本任务的文件。

<!-- dedup-ref --> prior-claim: `gap-fan-in-step-trace-rate-stopped-adjudication`（done）——它落地了本组的 `conditional-on-input` 裁定；本轮按硬规则 5b 在当前 HEAD 复核：载体仍暗、被声明成因仍成立、探针本身有缺陷 ⇒ done ≠ absent，故新立本案。`gap-instrument-decay-explained-absence-declarations`（done）落地了同族 3 条裁定（suite-skip / suite-recovery / suite-recovery-blocked），不涉及本组。

## AC

- [ ] AC1（现状复现，机器面）在主检出运行 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root . --carrier fan-in-step-trace.jsonl --json`，断言：`carriers[0].evaluated === true`；`decayed[]` 恰含 1 条 `{group:"suite-rerun-green", kind:"rate-stopped"}`，其 `count === 79`、`lastWrite === "2026-10-21T16:36:58.159Z"`、`detail` 匹配 `/condition command did not hold \(exit 1\)/`；`adjudicated[]` 中不含 `suite-rerun-green`。贴出 `carriers[0]` 的 `decayed` 与 `adjudicated[].group` 两段 JSON。判据可假：本组恢复写入、或探针修好后 `decayed[]` 变空，该读数即改变。
- [ ] AC2（被声明成因仍成立，三条实读）① `node --test plugin/test/task-granularity-advice.test.mjs` 退出码非 0，失败用例名含 `AC6 (production)`，失败消息含 `at least one bin is under-sampled`；② `.quay/baseline-red-rounds.jsonl` 中 `signature` 含 `plugin/test/task-granularity-advice.test.mjs` 的记录数 ≥ 27，首条 ts = `2026-10-21T22:52:41.332Z`、末条 ts ≥ `2026-10-25T20:18:25.581Z`；③ 以末次 `suite-rerun-green`（`2026-10-21T16:36:58.159Z`）为界，其后 `rerun` 记录数 = 90，状态分布 = `{rerun-red:84, rerun-not-evaluated:6, rerun-green:0}`，其中点名该文件的 ≥ 87。贴出三条命令与输出。判据可假：该文件转绿、或出现一条不含它的 `rerun` 记录，则被声明成因可能已消失，本任务前提须重判。
- [ ] AC3（探针缺陷的直接读数）打印载体尾部最后一条 `step==="rerun"` 记录的 `ts` / `state` / `exit` / `files`（含该文件），并运行 MANIFEST 中 `suite-rerun-green` 的**生产 `conditionCmd`** ⇒ `exit 1`。断言并解释：该记录 `state === "rerun-not-evaluated"`（不是 `rerun-red`、也不是 `rerun-green`），而声明语义只允许「变绿 / 不再点名」两种失效条件 ⇒ `conditionCmd` 的 `state==="rerun-red"` 合取项把第三态压成布尔（硬规则 3b）。贴出记录 JSON、条件命令原文、退出码。判据可假：若最新 rerun 是 `rerun-green` 或不再点名该文件，则 exit 1 是正确的，本任务前提须重判。
- [ ] AC4（探针修成三态感知 + 五条正负控制）修改 `plugin/scripts/instrument-decay-check.ts` 中 `suite-rerun-green` 的 `conditionCmd`：最新 rerun 为 `rerun-red` 或 `rerun-not-evaluated`，**且** `files` 含 `plugin/test/task-granularity-advice.test.mjs` ⇒ exit 0；`rerun-green`、`files` 不含该文件、无 rerun 记录、`state` 缺失/未知 ⇒ exit 1。在 `plugin/test/instrument-decay-check.test.mjs` 增加用例并贴出：① `lastRerunState:"rerun-red"` + 该文件 ⇒ `explained-absent`（既有正例）；② `lastRerunState:"rerun-not-evaluated"` + 该文件 ⇒ `explained-absent`（新增）；③ `rerun-green` ⇒ 回到 `decayed[]`（既有负控制仍绿）；④ `rerun-red` 但不含该文件 ⇒ 回到 `decayed[]`（新增负控制）；⑤ 无 rerun 记录 ⇒ 回到 `decayed[]`（新增负控制）。`node --test plugin/test/instrument-decay-check.test.mjs` 全绿并贴出 tests/pass/fail 计数。判据可假：任一负控制仍被豁免 ⇒ 探针过宽。
- [ ] AC5（恢复读数的真实阻断）`plugin/test/task-granularity-advice.test.mjs` 的 AC6 生产断言不再依赖当前数据分布：把「至少一个 bin 欠采样」的断言移到**带已知欠采样 bin 的 hermetic fixture** 上（保留该分支被真实执行），生产用例保留 `bins.length === 10`、`population.measured > 100`、`≥1 sufficient` 与每 bin 的字段形状；⛔ 不得直接删除该断言。`node --test plugin/test/task-granularity-advice.test.mjs` 退出码 0，且贴出 fixture 用例名与生产用例名。判据可假：若修复只是把断言改成恒真/删掉，fixture 用例无法指出哪个 bin 欠采样，即不算满足。
- [ ] AC6（不回归）`bash scripts/test.sh --for-task gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated --allow-thin` 退出码 0；贴出 scoped static checks 与命中文件的 tests/pass/fail。
- [ ] AC7（落地后的生产读数）合入 develop 之后的下一个真实 fan-in 轮次：若 `rerun` 点名的文件全绿，`.quay/fan-in-step-trace.jsonl` 出现一条新的 `suite-rerun-green`；否则同轮检测器 JSON 中 `suite-rerun-green` 不再出现在 `decayed[]` 而出现在 `adjudicated[]` 且 `condition.exitCode === 0`；贴出该轮 trace 记录（`ts`/`step`/`task`）与检测器 JSON 片段，以及窗口起点晚于的落地提交 sha。（待外部）

## DoD

- [ ] AC1–AC6 全绿；AC4 的五个正负控制与 AC5 的 fixture 用例都在真实测试文件里执行过（不是只写进任务体）。
- [ ] 探针修好之后，`suite-rerun-green` 的缺席在机器面上有正确归宿：成因仍成立 ⇒ `adjudicated[]` 的 `explained-absent`；成因消失 ⇒ `decayed[]` 的 `rate-stopped`。⛔ 不提供永久豁免（`reviewAfter` 仍为 `2026-11-22`）。
- [ ] AC5 修的是测试的**过期前提**而非产品行为：`--report --json` 的 10 个 bin 读数不变，且没有任何断言被改成恒真。
- [ ] AC7 的生产读数已贴出（待外部）。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- plugin/test/task-granularity-advice.test.mjs
- tasks/gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated.md

## Evidence

（执行者填写；本轮立案读数见 Proposal，取证命令与输出在 AC1–AC3 中逐条要求。）
