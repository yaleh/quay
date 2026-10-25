---
id: gap-instrument-decay-explained-absence-declarations
title: instrument-decay 的 3 个 rate-stopped 分组（suite-skip / suite-recovery /
  suite-recovery-blocked）经查全是「已解释缺席」，但 MANIFEST 没有机器可读裁定 ⇒ 常驻检测器每轮重报、人工取证重做
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

**现状读数**（2026-10-25T05:01Z，主检出 `/data/home/yale/work/quay`，HEAD `8b4c0ac75`）：

```
node --experimental-strip-types plugin/scripts/instrument-decay-check.ts \
  --root /data/home/yale/work/quay --carrier fan-in-step-trace.jsonl --json
⇒ ok:false evaluated:true totalRecords:20025 freshest:2026-10-24T23:25:07.034Z groupCount:27 decayedCount:3
  suite-skip              rate-stopped  count 79   lastWrite 2026-10-23T08:42:04.648Z
  suite-recovery          rate-stopped  count 121  lastWrite 2026-10-23T23:15:27.308Z
  suite-recovery-blocked  rate-stopped  count 44   lastWrite 2026-10-23T23:15:27.308Z
```

全 MANIFEST 运行：`decayedCount:3 / adjudicatedCount:5 / healthyCount:4 / uncoveredCount:2`——**这 3 组就是当前整个 workspace 的唯一 decay**。

**逐组取证（2026-10-25 实读；结论：三组都是 conditional-on-input 的「已解释缺席」，不是写手腐烂）**

1. **`suite-skip`** —— 写手在 `plugin/scripts/worker-fan-in.ts:3265`（`traceSuiteEvent("suite-skip", …)`），触发是 `needSuite === false`（`worker-fan-in.ts:2716`：`codeDelta === ""` 的 doc-only delta，或 `reuseSkip` 的 develop-advance-doc-only-reuse）。
   - 写手路径在，且**最后一次写入本身就是一次真实触发**：该次任务（`gap-goal911-exit-condition3-unencapsulated-e2e-uncovered`）的 per-run 日志逐字记着 `"step":"delta" … "reason":"doc-only delta → skip suite"`。
   - 此后载体里有 **22 次任务落地**（各有 `ff`），**每一次**的 per-run delta 读数都是 code delta（例如 `code delta (plugin/scripts/worker-fan-in.ts\nplugin/test/worker-driver-fan-in-s09.test.mjs) → run suite`），doc-only 落地 = **0** ⇒ 跳过分支的输入确实没有发生。
   - 节奏：79 条自 2026-09-17 起；最近 20 个间隔中位数 **4.1h**、全历史最大 **117.4h**；当前 38.7h **仍在自身历史包络内**。

2. **`suite-recovery`** —— 写手在 `worker-fan-in.ts:3042` / `:3051`，触发是某个恢复档返回 `no-conclusion` 或 `incomplete`（**降档**）。
   - 最后一次写入之后：`suite-incomplete` 发生 **2** 次（2026-10-24T00:01:07.835Z、2026-10-24T15:43:31.916Z，均 `oom-killed`）；**两次恢复轮都在第一档（concurrency 64）就产出完整判词**，经 `suite-recovery-baseline-exempt` + `suite-recovery-accepted` 落地（00:15:35.319Z、16:01:38.391Z）。**降档次数 = 0** ⇒ 该组自己的触发确实没有发生。
   - 121 条几乎全部来自 2026-10-23 的 OOM 风暴（当日 `suite-incomplete` 32 次 ⇒ `suite-recovery` 65 条 / `blocked` 24 条）；2026-10-24 只有 2 次 incomplete 且都首档成功 ⇒ 0 / 0。**读数下降是 OOM 修复的结果**（`gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency`、`gap-suite-oom-lane-scaled-ladder-floor-32-no-lower-rung`），不是写手停摆。

3. **`suite-recovery-blocked`** —— 写手在 `worker-fan-in.ts:3135`，触发是 `certifiedRun === null`（阶梯耗尽、没有任何一档认证）。
   - 同一窗口的 2 次恢复轮都经 baseline-exempt 认证 ⇒ `certifiedRun !== null` ⇒ 触发未发生。
   - 节奏：44 条自 2026-10-14 起；最近 20 个间隔中位数 **0.6h**、**全历史最大 1.8h**；当前约 24h **远超自身历史最大间隔**——按「触发是否远超自身节奏」这一条，本组满足「值得立案」的判据（`suite-skip` 则仍在包络内；两者的结论都是 rare-by-design/conditional-on-input，**均非 writer rot**）。

**缺陷（机制，不是症状）**：`instrument-decay-check.ts` 的 Shape B 唯一判据是「末次写入比载体最新老超过 `--stale-seconds`」，它无法区分「按设计/条件性缺席」与「写手腐烂」（硬规则 3b）。上一轮 `gap-fan-in-step-trace-rate-stopped-adjudication`（done）已经造出正确的机器可读落点 `CarrierSpec.adjudicated[]`（`group` / `kind` / `reason` / `conditionCmd` / `reviewAfter`），但**只声明了 5 个分组**；本任务点名的 3 个「已解释缺席」没有声明 ⇒ 常驻检测器每轮把它们重报为 `decayed`，并要求每轮重做同一份人工取证。同一批分组已经在 2026-10-22 的 content-dark 任务、2026-10-23 的 adjudication 任务上被人工裁定过两次——**这是第三次**。这正是「解释只活在散文里、不活在机制里」的漂移。

**修法方向**：给这 3 个分组补 `adjudicated` 声明，全部用 **`conditional-on-input`**（⛔ 不是 `rare-by-design` 的无条件豁免）：
- 每条 `conditionCmd` 必须**可执行、只读、亚秒级、可证伪**：读载体尾部，判断「该分组缺席的直接成因在最近窗口里是否仍成立」。条件 `exit 0` ⇒ `explained-absent`；`exit≠0` ⇒ 回到 `decayed[]`。
- `reviewAfter` 必填且有界（例如 +28 天），过期自动回到 `decayed[]`。
- 被裁定的分组**仍出现在 `adjudicated[]` 并带真实 `count` / `lastWrite`**，⛔ 不从读数里消失。
- 更新 `plugin/test/instrument-decay-check.test.mjs` 里钉住生产 MANIFEST 的用例（当前钉 5 条），并加负控制。

条件命令的建议形态（实现者可调整，但必须满足上面的性质）：
- `suite-recovery` / `suite-recovery-blocked`：取载体尾部的最后一次 `suite-incomplete`；断言其后存在 `suite-recovery-accepted` 或 `suite-recovery-baseline-exempt`，且两者之间**没有** `suite-recovery`（降档）记录 ⇒ 恢复轮首档认证、这两组缺席已解释。
- `suite-skip`：取最后一次 `suite-skip` 之后的窗口；断言每个含 `ff` 的 runId 也都含 `suite-start`（全部落地都跑了全量 suite，没有 doc-only delta）⇒ 跳过分支的输入不存在。

<!-- dedup-ref --> 合并判断 = **separate**：open `gap-instrument-decay-dedup-reader-round-log-path`（todo，已有在飞 worktree）与本任务同属 instrument-decay 子系统，但机制不同——那条修「去重台账读错路径 ⇒ 同一 pair 每轮重新 spawn」，本条修「MANIFEST 缺少已解释缺席的声明 ⇒ 同三个分组每轮重报、人工取证重做」。Touches 不重叠（它改 `quality-gate-driver.ts`，本条改 `instrument-decay-check.ts` + 其测试），`task-granularity-advice.ts` 对本任务 Touches 返回 `peers: []`。

**prior-claim**（DONE，均已在当前 HEAD / 真实载体上复核）：
- `gap-fan-in-step-trace-rate-stopped-adjudication`（done）—— 造出 `adjudicated[]` 机制并裁定 5 个分组；本任务点名的 3 个**不在**其 5 条声明里，载体当前仍把它们报为 `decayed`（硬规则 5b：done ≠ absent）。
- `gap-instrument-decay-check-unwired-and-blind-to-content-dark`（done）—— 曾把 `suite-recovery-blocked` 记作「稀有但活着，不立案」；那是散文裁定，没有机制落点，故本任务重报。
- `gap-instrument-decay-postlanding-two-rounds`（ready）/ `gap-instrument-decay-dedup-reader-round-log-path`（todo）—— 同子系统、不同机制，见上。

## AC

- [ ] AC1（现状复现 + 全量对照）在主检出实读并贴出 JSON：`--carrier fan-in-step-trace.jsonl` ⇒ `evaluated:true`、`decayed[]` 含本任务点名的 3 个 `rate-stopped` 分组（若期间**新增**其它分组，逐一同样取证并纳入本任务的声明集合），且 `adjudicated[]` 中**不含**这 3 个分组；同时贴出全 MANIFEST 运行读数（当前 `decayedCount:3 / adjudicatedCount:5 / healthyCount:4 / uncoveredCount:2`）。判据可假：任一分组恢复写入或载体被清空时该读数改变。
- [ ] AC2（写手路径存在 + 触发普查，逐组贴命令与数字）① `grep -n 'traceSuiteEvent("suite-skip"' plugin/scripts/worker-fan-in.ts` 命中，且 `needSuite` 判定分支仍在；统计最后一次 `suite-skip` 之后含 `ff` 的 runId 数 = N、其中含 `suite-start` 的 = N、doc-only 落地 = 0。② 统计最后一次 `suite-recovery` 之后 `suite-incomplete` 次数（≥1）、`suite-recovery`（降档）次数 = 0、`suite-recovery-accepted`/`suite-recovery-baseline-exempt` 次数 ≥1。③ 统计同一窗口 `suite-recovery-blocked` 次数 = 0，且每次 `suite-incomplete` 之后都有认证事件。三条合起来证明「触发条件未发生、写手路径仍在」，即不是腐烂。
- [ ] AC3（声明落地 + 真实载体读数）`MANIFEST` 中 fan-in-step-trace 的 `adjudicated[]` 新增上述 3 条 `conditional-on-input` 声明（每条带非空 `reason`、未来 `reviewAfter`、可执行 `conditionCmd`）。在真实 `.quay/fan-in-step-trace.jsonl` 上运行检测器：3 组**不在** `decayed[]`，而出现在 `adjudicated[]`，`state:"explained-absent"`、`condition.exitCode:0`，且各自仍带真实 `count` 与 `lastWrite`（⛔ 不从读数里消失）；贴出 JSON 片段。
- [ ] AC4（三条负控制，全部贴读数）① 把任一 `reviewAfter` 改到过去 ⇒ 该组回到 `decayed[]`，`detail` 点名过期；② 把任一 `conditionCmd` 换成 `exit 1` ⇒ 该组回到 `decayed[]`，`detail` 点名条件不成立；③ 构造一个「含 `ff` 但没有 `suite-start` 的 runId」的合成载体 ⇒ `suite-skip` 的声明**不**豁免它。三项在 `plugin/test/instrument-decay-check.test.mjs` 各有对应用例；贴出用例名与 `node --test` 的通过数。
- [ ] AC5（回归 + 读数面）更新钉住生产 MANIFEST 的既有用例（当前断言 5 条裁定），使其断言本任务后的完整裁定集合，且**不**把「已裁定」当成「载体健康」；`bash scripts/test.sh --for-task gap-instrument-decay-explained-absence-declarations` 绿；贴出尾部逐字计数。
- [ ] AC6（生产轮次读数）合入 `develop` 之后的下一个真实 `instrument_decay` 质量轮次上读 `.quay/quality-round.jsonl`：该轮 `decayed` 不含这 3 组，`reason` 可见 `adjudicated` 计数，且 pair `fan-in-step-trace.jsonl|rate-stopped` 的 filing 语义未被永久豁免。贴出该轮 `ts` / `reason` / `filings` 与窗口起点晚于的落地提交 sha（待外部）

## DoD

- [ ] AC1–AC5 全绿并贴出实读证据；AC6 的生产轮次读数已贴出（待外部）。
- [ ] **真实落地**：常量不止活在测试里——在**主检出的真实载体**上、不带任何 fixture / 注入切换跑一次检测器，得到这 3 组不在 `decayed[]` 而带真实读数出现在 `adjudicated[]`（若该时刻另有分组变暗，逐一具名报告，⛔ 不得静默忽略，也不得因此判本条失败），并把命令与输出贴进 Evidence。fixture / 注入数据满足不算（硬规则 4 推论三）。
- [ ] 声明**可过期、不可永久化**：`reviewAfter` 全部是未来的具体时刻；把任一改到过去都能让对应分组回到 `decayed[]`（AC4 ① 即该判据）。
- [ ] ⛔ 不为让读数变绿而删分组、删 `expected` 词表项或加「永久豁免」开关；「不算腐烂」不得等于「从读数里消失」。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-explained-absence-declarations.md
