---
id: gap-instrument-decay-baseline-red-exempt-unadjudicated
title: instrument-decay 仍报 baseline-red-exempt 分组 rate-stopped（count=79）：触发输入自
  bdb307a63 起结构上不可达，但 MANIFEST 无机器可读裁定
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

**现状读数**（2026-10-28，主检出 `/data/home/yale/work/quay`，HEAD `0175d9509`，分支 `author`；`instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`）：

```
ok:false evaluated:true decayedCount:1 adjudicatedCount:9 healthyCount:0 uncoveredCount:0
fan-in-step-trace.jsonl (freshest=2026-10-28T05:30:39.224Z, totalRecords=21144, groupCount=28)
  decayed: baseline-red-exempt   rate-stopped   count=79   lastWrite=2026-10-27T04:58:55.044Z
```

`baseline-red-exempt` 是 `fan-in-step-trace.jsonl` 里 Shape B 的伴生分组（不在 `expected[]` 里），写手在 `plugin/scripts/worker-fan-in.ts:3482-3487`：

```
baselineEquivalence = await runBaselineEquivalence(suiteLogText, failedTestFiles);
if (baselineEquivalence !== null && baselineEquivalence.verdict.kind === "exempt") {
  traceSuiteEvent("baseline-red-exempt", {...});
```

判定是纯函数 `compareFailureSignatures`（`worker-fan-in.ts:1420-1446`）：`exempt` ⇔ **task 侧红签名集合的每一个都逐字出现在 baseline 红签名集合里**。进入 A/B 的前提是「suite 真跑过且真红、本轮内重跑仍红」（`rerun.state !== "rerun-green"` 的分支）。

**为什么它停写——不是写手腐烂，是触发输入被一次修复清零了**：
- 直到 2026-10-27T04:58 为止，develop 的基线红集**非空**（末 8 条豁免的 reason 逐条写着 `1 red point(s)` / `2 red point(s)`），于是每一次红落地几乎都被等价放行：主路径 79 次、恢复阶梯路径另有 21 次（`suite-recovery-baseline-exempt`）。
- `bdb307a63`（2026-10-27T09:24:43Z，`fix(test): clear the cgroup AC3 deterministic red (host-relative, drop 4-core-era literals)`）清掉了那个持续红 ⇒ baseline 红集变空。
- 当前读数：`.quay/develop-red-set.json` = `{"develop":"0175d9509…","evaluatedAt":"2026-10-28T05:29:27.796Z","reds":[]}`；同一次 A/B（task `gap-routine-semantic-dedup-scan-is-ancestor-three-semantics`，2026-10-28T05:29:27.792Z）的 `baseline-red` 步读数 = `verdict:"hard-red", added:2, changed:0, baselineFiles:0, taskFiles:2, hardReason:"task-introduced-red"`。
- 结构后果：baseline 红集为空时，非空 task 红集**恒**不可能是它的子集 ⇒ `exempt` 结构上不可达，直到 develop 再出现持续红。A/B 只在 rerun 仍红时到达，所以「task 红集为空」这一唯一能让空 baseline 判 exempt 的情形走不到这里。

**窗口复核（证明窗口内没有任何一次「该写却没写」）**：
末次 `baseline-red-exempt`（`2026-10-27T04:58:55.044Z`）之后的载体读数（排除 `kind:"goal-merge"`）：
`suite-start=7`、`suite-end=6`（其中 `ok:false` 2 条）、`rerun=2`（`rerun-green` 1、`rerun-red` 1）、`baseline-red=1`、`ff=14`。
窗口内**只有 1 次 A/B 评估**，且它就是上面那次的 `hard-red / baselineFiles:0`。⛔ 没有出现「A/B 判了 exempt 而 step 没写」的形态。

**节奏读数**（证明不是「刚过 24h 阈值」的一次噪声，也证明它不是罕见分支）：

| 量 | 值 |
|---|---|
| 历史条数 | 79（2026-10-13T00:53:58.455Z → 2026-10-27T04:58:55.044Z） |
| 间隔中位数（全历史 / 末 40 / 末 30） | 0.58h / 0.93h / 0.91h |
| p90 / 全历史最大 | 12.40h / 99.0h（早期冷启动） |
| 当前间隔 | 24.6h（≈ 末 40 中位数的 26 倍，末 40 最大为 14.4h） |
| 全历史 A/B 判词分布（`baseline-red` 步） | `exempt` 100 / `hard-red` 55 / `not-evaluated` 21 |

⇒ **本组不是 `rare-by-design`**：它在 176 次 A/B 里占 100 次（其中主路径 79 次），是一条主流终端分支，只是当前输入条件被清空。分类是 **`conditional-on-input`**。

**机制缺陷（本条的落点）**：`CarrierSpec.adjudicated[]` 这个机器可读落点早已建好（`gap-fan-in-step-trace-rate-stopped-adjudication`，done），后续两条任务又为 11 个分组补了裁定——但 **`baseline-red-exempt` 至今没有任何裁定声明**。于是 Shape B 每轮把它重新报成 `decayed`，同一份人工取证被迫重做；「解释只活在散文里、不活在机制里」正是硬规则 5b 的兄弟实例遗漏形态。

⚠️ **近名陷阱（实现时必读）**：MANIFEST 里**已有一条** `suite-recovery-baseline-exempt` 的裁定（`worker-fan-in.ts:3385` 的恢复阶梯出口，21 次）。那是**另一个分组、另一条写手路径**。本条要加的是 `baseline-red-exempt`（`:3484` 的主路径出口，79 次）。两者不可合并、不可互相顶替——恢复阶梯内部的 exempt 判词写的是 `suite-recovery-baseline-exempt`，⛔ 不是 `baseline-red-exempt`。

<!-- dedup-ref --> **合并判断 = separate**：`task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts --touches plugin/test/instrument-decay-check.test.mjs --json` ⇒ `peers: []`、`mentions: []`（无 Touches 重叠的 open 任务）。open `gap-instrument-decay-postlanding-two-rounds`（ready）同处 instrument-decay 面，但它验的是「同一 pair 第二轮记 already-filed」的轮次账本读数，与「MANIFEST 缺少本组裁定」是两个机制，且不动这两个文件。

<!-- dedup-ref --> **prior-claim（都是 done；按当前载体复核，本组仍暗 ⇒ 本条不是重复立案，也不存在「旧任务已修好」）**：
- `gap-fan-in-step-trace-rate-stopped-adjudication`（done）—— 建 `adjudicated[]` 机制并声明 5 组，不含本组。
- `gap-instrument-decay-explained-absence-declarations`（done）—— 补 `suite-skip` / `suite-recovery` / `suite-recovery-blocked` 3 组，不含本组。
- `gap-instrument-decay-suite-recovery-groups-unadjudicated`（done）—— 补 `suite-incomplete` / `suite-recovery-accepted` / `suite-recovery-baseline-exempt` 3 组，**名字最近但仍是另一组**。
- `gap-develop-red-set-writer`（done）—— 建 `develop-red-set` 读数（本条用它证明 baseline 已空），不涉及本组裁定。
- `gap-fan-in-baseline-comparison-blind-to-spec-reporter-misparks-develop-wide-red`（done）—— 修 A/B 的签名解析，不涉及本组裁定。

## AC

- [ ] AC1（复现与前提）在 `--root /data/home/yale/work/quay` 上跑 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json --no-block`，贴出 `decayed[]` 里 `baseline-red-exempt` 的 `count` / `lastWrite` / `kind`，以及载体 `freshest` 与运行时刻。判据可假：若该组已不在 `decayed[]`（比如它又写过了），说明前提已变 ⇒ 停止，改为贴出 `companions[]` 里它的 `lastWrite` 并按「当前不暗」收口，⛔ 不得硬凑。
- [ ] AC2（写手在、输入缺席可证）贴出 `worker-fan-in.ts` 的三处现场：`:3482-3487`（A/B → `traceSuiteEvent("baseline-red-exempt")`）、`:1420-1446`（`compareFailureSignatures` 的 exempt 判据）、`:2903`（`baseline-red` 步的 `baselineFiles` 读数）；并用当前载体算出「末次 `baseline-red-exempt` 之后」的 A/B 记录条数与逐条 `verdict` / `baselineFiles`，以及窗口内 `suite-start` / `suite-end` / `rerun` 条数。断言：窗口内 ≥1 次 A/B，且没有任何一条「`verdict:"exempt"` 且同 task 上没有 `suite-recovery-baseline-exempt` 收尾」的记录（即没有主路径豁免被判出却没写 step）。判据可假：出现一条这样的记录 ⇒ 写手确实腐烂，「触发输入缺席」为假，本条改按写手修复收口，⛔ 不得以裁定掩盖。
- [ ] AC3（机制落点）在 `plugin/scripts/instrument-decay-check.ts` 的 `MANIFEST` 中，为 `fan-in-step-trace.jsonl` 描述符的 `adjudicated[]` 增加**一条** `conditional-on-input` 声明：`group: "baseline-red-exempt"`、`reason` 非空且写清「exempt ⇔ task 红集 ⊆ baseline 红集，baseline 空 ⇒ 结构上不可达」、`reviewAfter` 未过期、`conditionCmd` 非空。⛔ 条件读的必须是**触发输入**（窗口内 A/B 判词的形态），不是「本组多久没写」的二次包装；⛔ 不得与既有的 `suite-recovery-baseline-exempt` 裁定合并或复用。给出**正反两个控制**并贴出输出：① 正控制——当前真实载体上 `conditionCmd` exit 0 且该组进入 `adjudicated[]`；② 负控制——一个 fixture/临时载体，里面放一条「`baseline-red` 判了 `exempt`、却没有同 task 的 `baseline-red-exempt`（也没有 `suite-recovery-baseline-exempt` 收尾）」的记录，同一条件命令必须 exit≠0 且 detector 把该组放回 `decayed[]`。判据可假：若负控制下条件仍 exit 0，这条裁定是空转，不算完成。⛔ 两条陷阱必须在条件里显式处理：**(a)** 窗口内「一次 A/B 都没有」不得当作解释（空转真值）——必须要求 ≥1 次 A/B；**(b)** 恢复阶梯路径的 exempt 判词也会写一条 `baseline-red`（`:3371` + `:3390`），其后收尾是 `suite-recovery-baseline-exempt`，不得被当成「主路径豁免未落痕」。
- [ ] AC4（读数不消失）改后重跑 detector：`decayed[]` 中**不再含** `baseline-red-exempt`；该组出现在 `adjudicated[]` 且 `count` / `lastWrite` 与 AC1 完全一致（⛔ 不得因为「不算腐烂」就从读数里消失，硬规则 3b）；若执行时该组已恢复写入而落在 `companions[]`，改用 `--stale-seconds 1` 强制走 Shape B 路径再断言它落在 `adjudicated[]`（不是 `decayed[]`），并同时贴出 `count` / `lastWrite`。贴出 `--json` 输出中的 `decayed[]` 与 `adjudicated[]`。
- [ ] AC5（回归）`bash scripts/test.sh --for-task gap-instrument-decay-baseline-red-exempt-unadjudicated` 通过（含 `plugin/test/instrument-decay-check.test.mjs`，新增裁定与正/负控制都在其中）；贴出输出。

## DoD

- [ ] AC1–AC5 全绿；改动只在 `plugin/scripts/instrument-decay-check.ts` 与 `plugin/test/instrument-decay-check.test.mjs`，不新增第二套裁定表、不改 Shape B 的判定逻辑（只在描述符里增加声明——该文件头注写明的扩展点契约）。
- [ ] 真实载体上跑出 AC4 的读数（不是 fixture 回显）：`adjudicated[]` 里的这一条由**生产** `.quay/fan-in-step-trace.jsonl` 的实跑产生，并贴出运行时刻、载体 `freshest` 与该组的 `count` / `lastWrite`。

## Evidence

立案取证 2026-10-28，主检出 `/data/home/yale/work/quay`，HEAD `0175d9509`，分支 `author`。

- 载体读数：`totalRecords=21144`、`freshest=2026-10-28T05:30:39.224Z`、`groupCount=28`；`baseline-red-exempt` `count=79`、`lastWrite=2026-10-27T04:58:55.044Z`。
- 全历史 A/B 判词：`exempt` 100 / `hard-red` 55 / `not-evaluated` 21（`baseline-red` 步共 176 条）；主路径豁免 79 条 + 恢复阶梯豁免 21 条（`suite-recovery-baseline-exempt`）。
- 末次豁免之后的窗口：`suite-start=7`、`suite-end=6`（`ok:false` 2）、`rerun=2`（green 1 / red 1）、`baseline-red=1`（`hard-red`、`baselineFiles=0`）、`ff=14`。
- `.quay/develop-red-set.json` = `{"develop":"0175d9509…","evaluatedAt":"2026-10-28T05:29:27.796Z","reds":[]}`。
- `bdb307a63a3a661bb68f4de717379a8fd97f5eed`（2026-10-27T17:24:43+08:00，`fix(test): clear the cgroup AC3 deterministic red`）是 baseline 红集归零的落地提交。
- `task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts --touches plugin/test/instrument-decay-check.test.mjs --json` ⇒ `peers: []`、`mentions: []`。
- MANIFEST 现有 `adjudicated[]` 的 11 个 group：`verification-round-record` / `catch-up-develop` / `suite-rerun-green` / `suite-recovery-certified` / `suite-recovery-new-regression` / `suite-skip` / `suite-recovery` / `suite-recovery-blocked` / `suite-incomplete` / `suite-recovery-accepted` / `suite-recovery-baseline-exempt` —— **不含** `baseline-red-exempt`。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-baseline-red-exempt-unadjudicated.md