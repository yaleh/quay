---
id: gap-routine-semantic-dedup-scan-check-harness-three-incompatible-shapes
title: "semantic-dedup-scan: 26 copies of one selftest harness split across
  three mutually incompatible shapes: counters-only (11),
  allPassed+required-detail (10), allPassed+failures[] acc"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
26 copies of one selftest harness split across three mutually incompatible shapes: counters-only (11), allPassed+required-detail (10), allPassed+failures[] accumulator (5); 8 of 11 body#3 copies already import gate-script-base.ts, and adr/ADR-018 itself names DIR-091 as the extraction mandate.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789723686226` · ts `2026-09-18T09:28:06.226Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`check`
- 涉及文件：
- `plugin/scripts/adr016-screen-use-check.ts:286`
- `plugin/scripts/build-evidence-manifest.ts:283`
- `plugin/scripts/execution-policy.ts:336`
- `plugin/scripts/config-wiring-check.ts:451`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition（复核与处置）

**结论：修掉（extract 已落地）。** 26 份手写副本 → 25 份收敛到 `gate-script-base.ts#createSelftest`，剩 1 份
有明确不合并理由（§3）。finding 列的 4 个文件是**每形状一个样本**，全量面见 `## Touches`。

### 1. 复核：finding 成立，且它的「26」经独立谓词复核后是准的（我第一遍只数到 24，漏了 2）

谓词：每个 `plugin/scripts/*.{ts,mjs,js}` 里 `function check(` / `const|let check =` 的**声明**，按它所属
selftest 函数里紧跟的计数器分类（脚本见 §5，`node census.mjs <git-rev|WORKTREE>`）：

```
origin/develop 1da27dfcc（真基准）: 29 declaration(s), 0 createSelftest adopter(s)
  counters         11  adr016-screen-use-check / commit-message-verified-check / config-wiring-check /
                        dead-code-after-return-check / pane-state-classify / rhythm-consumer-check /
                        test-framework-policy-check / test-group-downgrade-check / test-isolation-check /
                        tmp-leak-pairing-check / transcript-delivery-check
  cases             8  build-evidence-manifest / candidate-contracts / candidate-synthesis / coupling-graph /
                        portfolio-choice / preparation-feedback / workflow-baseline-metrics / workflow-event-schema.mjs
  cases+failures[]  5  execution-policy / finding-backpropagate / run-identity / stage-receipt / workflow-journal
  cases(period)     2  drivable-workspace-check / external-dogfooding-check
  other（非本族）     3  capability-manifest-check / goal-driver / packaging-hygiene-check
WORKTREE（本分支）              :  4 declaration(s), 26 createSelftest adopter(s)
  cases             1  candidate-contracts（见 §3）
  other（非本族）     3  capability-manifest-check / goal-driver / packaging-hygiene-check
```

⇒ **26 ≠ 29：3 个是谓词假阳性**——`capability-manifest-check.ts:150` 与 `packaging-hygiene-check.ts:177` 的
`export function check(` 是**检查器入口**不是 selftest 断言助手；`goal-driver.ts:1711` 的 `const check =` 是
`verifyObjectiveAssertion(...)` 的**局部量**。⇒ 真实族 = 26，**与 finding 记的 26 一致**（它的三形状 11/10/5
把本节的 `cases 8 + cases(period) 2` 合成 10）。

**⚠️ 我第一遍只找到 24**：因为我的初筛谓词要求文件里出现字面量 `selftest`，而
`pane-state-classify.ts` / `transcript-delivery-check.ts` 的函数名叫 **`selfcheck`**、总结行是
`--selfcheck: N passed, M failed` —— 同一族、另一种拼写。是 §1 的独立谓词（按**声明位置**而非关键词，
硬规则 2）把它们捞出来的，**不是靠记忆补上的**。

### 2. 处置：三种形状不是「一律合并」，而是**一份实现 + 三个被命名的拼写**

`createSelftest(opts)` 收进 `gate-script-base.ts`（DIR-091/M152 已建的正本模块，它此前只提取了
parseArgs / verdict 发射 / requireArg / isDirectEntry，**⛔ 没有 harness** —— 见 §4）。`flavor` 是**普查结果
不是偏好旋钮**：

| flavor | 逐例行 | 总结行 | 裁决 |
|---|---|---|---|
| `counters` | 仅失败：`FAIL: <name>[ — <detail>]` → **stderr** | `\n<label> --<verb>: N passed, M failed` → stdout | `fail === 0` |
| `cases` | `SELFTEST PASS: …` → stdout / `SELFTEST FAIL: …` → stderr | `\nSELFTEST: all fixture cases PASS \| SOME FIXTURES FAILED` → stdout | `allPassed` |
| `cases-period` | 同上 | `SELFTEST: all fixture cases PASS.` → stdout / `SELFTEST: one or more fixture cases FAILED.` → **stderr** | `allPassed` |

`verb`（`selftest` \| `selfcheck`）与 `cases-period` 是**被保留的拼写**，⛔ 不是遗漏：`cases-period` 的句点是
**别处测试钉住的**（`plugin/test/external-dogfooding-check.test.mjs:172` 匹配 `/SELFTEST: all fixture cases PASS\./`），
而 25 份脚本的 stdout 是**被人和下游读的发布面**，抽取不该顺手改写任何一份的输出。
`collectFailures` / `dumpFailuresJson` 是那 5 份 accumulator 的形状（多一行 `JSON.stringify({ ok: false, failures })`）。

调用点形态：保留本地名 `const check = st.check;` ⇒ **几百个断言调用点一个字没动**；尾部一两行
`return st.report();` 取代「总结行 + return」。`detail` **故意不给默认值** —— 副本之间恰在这一格分歧（见控制项）。

### 3. ⛔ 明确【没有】合并的残余，及理由

| 残余 | 量 | 为什么不并入 |
|---|---|---|
| `candidate-contracts.ts` | 1 份（`cases`） | **它是被声明为「无依赖」的纯契约模块**：`candidate-contracts.ts:268` 写着「Avoid importing gate-script-base.ts here to keep this module dependency-free (pure contracts)」，它连 `isDirectEntry` 都自带 `isDirectEntryFallback()` 而**不 import**。并入 harness ＝ 让它依赖 TS 运行时模块，与它自己的不变量冲突 ⇒ 这是一个**架构决策**（要不要保留无依赖契约层），不属 dedup。留待独立任务。 |
| 谓词假阳性 3 个 | — | 见 §1，不是本族成员。 |

### 4. 机制失败在哪一步（AC2 的「已有机制在管、失败在哪一步」）

本次**已修掉**，但失败点值得记，否则会复发：
- **DIR-091 / M152 的框架只提取了「入口周边」**（parseArgs、verdict 发射、requireArg、isDirectEntry），
  **harness 这一块在它的清单之外** —— 于是 8 个月后同一条例程把同一模块的下一块重新报了出来。
  抽取「一个模块的公共件」时按**声明族**枚举（如本节 §1 的谓词），否则**下一族的副本不会被这次抽取顺带消掉**。
- **没有任何检查器把「新 gate 必须用 base 的 harness」变机械的**（现状靠自觉，硬规则 9）。本次只在
  `plugin/test/gate-script-base.test.mjs` 钉住了 harness 自己的契约（含一格 CONTROL），**没有**造新检查器
  —— 造它要动 capability-catalog 的六行登记 + 三个检查器义务，属另一件事（见 §5 遗留）。

### 5. 可核读数（复现方法）

**① 普查谓词**（`node census.mjs <git-rev|WORKTREE>`；本节 §1 的两个读数就是它的输出）：

```js
// census.mjs — node census.mjs <git-rev|WORKTREE>
import { execFileSync } from "node:child_process"; import fs from "node:fs";
const rev = process.argv[2];
const files = rev === "WORKTREE"
  ? fs.readdirSync("plugin/scripts").filter(f => /\.(ts|mjs|js)$/.test(f)).map(f => `plugin/scripts/${f}`)
  : execFileSync("git", ["ls-tree","-r","--name-only",rev,"--","plugin/scripts"],{encoding:"utf8"}).trim().split("\n").filter(f => /\.(ts|mjs|js)$/.test(f));
const read = f => rev === "WORKTREE" ? fs.readFileSync(f,"utf8") : execFileSync("git",["show",`${rev}:${f}`],{encoding:"utf8"});
const shapes={}; let copies=0, adopters=0;
for (const f of files) { const src = read(f);
  if (/createSelftest\(/.test(src)) { adopters++; continue; }
  const m = /(?:function\s+check\s*\(|(?:const|let)\s+check\s*=)/.exec(src); if (!m) continue;
  const before = src.slice(0,m.index), tail = src.slice(m.index, m.index+4000);
  const counters = /let pass = 0;/.test(tail) || /let pass = 0;/.test(before.slice(-2000));
  const allPassed = /let allPassed = true;/.test(before.slice(-2000));
  const failures = /failures\.push/.test(tail), period = /all fixture cases PASS\./.test(src);
  const s = counters ? "counters" : !allPassed ? "other" : failures ? "cases+failures[]" : period ? "cases(period)" : "cases";
  (shapes[s] ??= []).push(f); copies++; }
console.log(`${rev}: ${copies} declaration(s), ${adopters} createSelftest adopter(s)`);
for (const [s,v] of Object.entries(shapes)) console.log(`  ${s} ${v.length}  ${v.join(", ")}`);
```

**② 行为对照（能取假的量）**：26 个已迁移脚本的 `--selftest` / `--selfcheck` CLI **改动前 vs 改动后**逐字节比较
（stdout、stderr、exit code；基线与对照各跑两次以区分「我改坏了」与「fixture 自己带随机量」）：

```
26/26  stdout 与 exit code 逐字节一致
       ├─ 其中 22 个连 stderr 也逐字一致
       ├─ 4 个 stdout 有差、但**同一改动后状态连跑两次也彼此不同** ⇒ fixture 自带 run-varying 值，是控制的噪声底：
       │    config-wiring-check（mkdtemp 后缀）/ execution-policy（hash）/ stage-receipt（contentHash）/ workflow-journal（mkdtemp 后缀）
       └─ 1 个 stderr 多 4 行：workflow-event-schema.mjs 现在 import 了 .ts 正本 ⇒ node 打印标准的
          MODULE_TYPELESS_PACKAGE_JSON 警告。**实测**：它 stdout 与 exit 逐字不变；该警告是**全仓库每个
          .ts 脚本本来就有的**（基线里其余 25 个的 stderr 各带同一段），只有这个 .mjs 此前因为不 import
          任何 .ts 而独享「零 stderr」。⇒ 是**与全仓库拉平**，不是新增噪声。
```

⇒ 若抽取时误改了任何一份的打印形状 / 流 / 裁决，该数会下降。**⚠️ 它是可证伪的、不是回显**：写这行字的
过程中它真的抓到了 1 个真错（`workflow-event-schema.mjs` 的 fixture IIFE 里残留 `return allPassed;`
⇒ `ReferenceError` ⇒ exit 1），已修（改为 `st.allPassed`）。

**③ harness 自身的契约**：`plugin/test/gate-script-base.test.mjs` 新增 8 个用例，把三种 flavor 的
**逐字输出 + 流 + 裁决**钉住，含一格 **CONTROL**：`detail` 缺省时 `cases` 渲染成字面量 `undefined`、
`counters` 渲染成无后缀 —— 两形状在**这一个输入**上可区分、在其余输入上同形。⇒ 任何「顺手把它统一成一种
拼写」的改动会当场变红（硬规则 3b 的形态：不给出「未评估」/不承认分歧的合并会把两形状悄悄压成一个）。

### 6. 遗留（⛔ 不以「已注意到」结案，故写成可执行的下一步）

- `candidate-contracts.ts` 的无依赖不变量是否保留 —— **独立任务**，需先裁定「纯契约层要不要引入 TS 运行时依赖」。
- 「新 gate 必须用 base 的 harness」**没有机械闸**（§4）—— **独立任务**，落点候选是 `gate-dispatch-coverage.ts`
  附近的采纳率读数或 `plugin/scripts/gate-script-base.ts` 头注释所指的家族普查，需按新检查器的三项义务落地。
  本任务**不做**：⛔ 不冒充已做。

### 7. 落地时追加的一处 Touches（本任务撰写时未预见，由 fan-in 的全量 suite 暴露）

fan-in 全量 suite 抓到**一个由本次抽取直接造成的红**：`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`
的 `drop-gate-script-base` 控制项，把「shipped .ts 中 VALUE-import `./gate-script-base.ts` 的个数」**钉成了字面量 `2`**；
`pane-state-classify.ts` 采纳 harness 后该数变 **3** ⇒ 控制项红（实测 `violations=3`，三行 IMPORT-UNSHIPPED 逐个具名）。

修法：把该数改为**按消费者推导**（在 JS 里镜像 `transport_flat_files` / `transport_imports_of`），与该文件自身
`consumerRefs` 一段已写明的纪律一致 —— 「⛔ 不钉字面量；字面量过期后的失败形状与真违规不可区分，而『可区分』
正是那条测试存在的理由」。**这是同一条纪律的第 4 个实例**（该文件已经为 `5` 与 mode 数各踩过一次）。

**负控制（该数承重、非回声）**：把推导值改成 `.slice(0, 2)` ⇒ 该用例当场红并打印
`…must equal the CONSUMER's own value-importers of it (2: pane-state-classify.ts, quay-init-closure-assertion.ts)`（实测）。
⇒ 该断言仍可证伪：实现少算一个 importer、或把 type-only import 误算进去，两种漂移都会让它红。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `check-harness-three-incompatible-shapes`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789723686226`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/adr016-screen-use-check.ts`
- `plugin/scripts/build-evidence-manifest.ts`
- `plugin/scripts/candidate-synthesis.ts`
- `plugin/scripts/commit-message-verified-check.ts`
- `plugin/scripts/config-wiring-check.ts`
- `plugin/scripts/coupling-graph.ts`
- `plugin/scripts/dead-code-after-return-check.ts`
- `plugin/scripts/drivable-workspace-check.ts`
- `plugin/scripts/execution-policy.ts`
- `plugin/scripts/external-dogfooding-check.ts`
- `plugin/scripts/finding-backpropagate.ts`
- `plugin/scripts/pane-state-classify.ts`
- `plugin/scripts/portfolio-choice.ts`
- `plugin/scripts/preparation-feedback.ts`
- `plugin/scripts/rhythm-consumer-check.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/test-framework-policy-check.ts`
- `plugin/scripts/test-group-downgrade-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `plugin/scripts/tmp-leak-pairing-check.ts`
- `plugin/scripts/transcript-delivery-check.ts`
- `plugin/scripts/workflow-baseline-metrics.ts`
- `plugin/scripts/workflow-event-schema.mjs`
- `plugin/scripts/workflow-journal.ts`
- `experiments/quay-perpetual-stream/scripts/gate-script-base.ts`
- `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts`
- `experiments/quay-perpetual-stream/scripts/candidate-synthesis.ts`
- `experiments/quay-perpetual-stream/scripts/coupling-graph.ts`
- `experiments/quay-perpetual-stream/scripts/execution-policy.ts`
- `experiments/quay-perpetual-stream/scripts/finding-backpropagate.ts`
- `experiments/quay-perpetual-stream/scripts/portfolio-choice.ts`
- `experiments/quay-perpetual-stream/scripts/preparation-feedback.ts`
- `experiments/quay-perpetual-stream/scripts/run-identity.ts`
- `experiments/quay-perpetual-stream/scripts/stage-receipt.ts`
- `experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts`
- `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs`
- `experiments/quay-perpetual-stream/scripts/workflow-journal.ts`
- `plugin/test/gate-script-base.test.mjs`
- `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-check-harness-three-incompatible-shapes.md`