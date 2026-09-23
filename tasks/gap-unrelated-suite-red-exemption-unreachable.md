---
id: gap-unrelated-suite-red-exemption-unreachable
title: suite-red 豁免依赖「窗口内恰好有 ≥2 个任务的日志可读」——同一份不相关的红，有时豁免、有时记到任务头上
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`judgeRetryExemption` 在判出「所有失败测试文件都与本任务 delta 无关」之后，仍要求断言签名**跨 ≥2 个不同任务复发**（`recurringSignatureTasks`，`worker-driver.ts:2162`）才给 `unrelated-flaky-exempt`；否则落到 `own-defect-counted`（fail-closed 计数，烧重试上限后标 needs-human）。

`recurringSignatureTasks` 要读**其它任务**的 suite 日志（`fs.readFileSync(a.suiteLog)`）。于是**同一个任务、同一份 suite 日志，判词取决于无关第三方任务的日志是否还活着**。

实测（本机，同一 commit，相隔数十分钟的两次调用；输入只有窗口内容不同）：

**第一次**——窗口内 5 条记录，两条属其它任务，而这两条的日志都已不在盘上：
```
gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires  → .quay/fan-in-suite-…-1790120062075-44cf74.log  exists=false
gap-quay-init-sh-no-single-naming-point                            → .quay/fan-in-suite-…-1790136256016-3a54d0.log  exists=false
verdict: "own-defect-counted"
reason:  "failing tests unrelated to this task's delta, but the assertion signature did not recur across ≥2 distinct tasks in the window (fail-closed count)"
recurred: []
```

**第二次**——窗口内 6 条记录，`gap-ac179-criterion-cmdline-port-literal-stale` 的日志已可读：
```
verdict: "unrelated-flaky-exempt"
reason:  signature(s) … recurred across ≥2 distinct tasks in window (other: gap-ac179-criterion-cmdline-port-literal-stale)
recurred: ["gap-ac179-criterion-cmdline-port-literal-stale"]
```
（反向亦然：对 ac179 自己跑同一次判定，`recurred` 指向 `gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot`，17 个失败文件同样豁免。）

**⚠️ 立案结论更正（必须保留本节，不得删）**：本任务立案时写的是「跨任务复发结构上不可能被观测 ⇒ 豁免当前不可达」。**该结论已被上面的第二次实测推翻**。真实缺陷不是「不可达」，而是**不确定性**：一个驱动重试记账的判定，其结果取决于**无关第三方任务**的日志存活情况。硬规则 4 推论四：一个能**解释**现象的说法不是被**检验**的结论——原结论只取到了「不可达」那一侧的读数就投递了。

**它解释了什么**：三个 needs-human 任务的终点都是这条路径——在其它任务日志不可读的窗口里，与 delta 无关的红被记到任务自己头上。

## 判词不确定性两方向复现（AC1 改前读数，`ac-repro-prefix.mjs`，改前代码 + 同任务同日志、唯一差异 = 其它任务日志可读性）

夹具：任务 `gap-a`（Touches 与失败测试无关）+ 同一份 `fan-in-suite-gap-a.log` + 窗口内两条其它任务记录（gap-b/gap-c，各自日志同签名）。

```
窗口② 其它任务日志 exists=true  → verdict="unrelated-flaky-exempt"  recurred=["gap-b","gap-c"]
窗口① 其它任务日志 exists=false → verdict="own-defect-counted"      recurred=[]
判词是否取决于无关第三方任务日志的存亡 → 不同（缺陷：不确定性）
```
取假器（把**改后**生产写入形态的记录「带 suiteSignatures」喂给**改前**代码，`HEAD 28c5f263e`）：两次调用仍分叉（`unrelated-flaky-exempt` vs `own-defect-counted`）⇒ 分叉由**判定逻辑**造成，不由夹具造成 ⇒ 新增用例的 `deepEqual(pruned, readable)` 在改前必红。

## AC

- [x] AC1（复现固化·两个方向都要有读数）用**同一个任务 + 同一份 suite 日志**构造两次调用，输入只差「窗口内其它任务日志的可读性」：①其它任务日志不可读 ⇒ `own-defect-counted`；②有一条可读 ⇒ `unrelated-flaky-exempt`。两次调用的输入与返回原文都贴

  **读数**：改前两方向原文见上节（逐字）。改前代码 + 改后记录形态的取假器读数：窗口② `unrelated-flaky-exempt` / 窗口① `own-defect-counted` ⇒ 分叉。**改后**同一夹具两次调用 `verdict`+`recurredTasks` 逐字相同（`unrelated-flaky-exempt` / `["gap-b","gap-c"]`）。固化进 `plugin/test/worker-driver.test.mjs` 的 `AC1+AC3` 用例（断言 `deepEqual(windowPruned, windowReadable)`，⛔ 只比 verdict 会漏掉「同 verdict 但理由不同」）。

- [x] AC2（归因，硬规则 4 推论四）说清那两条日志是**被谁删除/清理**的（点名机制/脚本/行），或证明它们**从未**写到该路径。⛔ 不得以「大概是被清理了」结案；给不出对照就降为假说

  **归因（点名到行）**：`pruneTaskSuiteLogs`（`plugin/scripts/worker-fan-in.ts:1046`，`fs.rmSync` 删除 `<root>/.quay/fan-in-suite-<task>~*.log`），**唯一生产调用点** = `worker-fan-in.ts:1628`，位于 `runMechanicalFanIn`（:1132）第 9.5 步「ff 成功后的清理」——**任务落地即删掉它自己的红 attempt 日志**（防 `.quay/` 无限堆积）。全仓无第二个删 `fan-in-suite-*.log` 的生产点（其余命中均为测试里 `/tmp/fan-in-suite-*` 旧路径的 teardown）。

  **对照（可证伪，0 反例）**：对真账本 48h 窗口内**全部 27 条** suite-red 记录，预测「日志被删 ⇔ 该任务已落地(status=done)」：
  ```
  logExists=false | status=done        → 2 条（gap-routine-semantic-dedup-scan-…、gap-quay-init-sh-no-single-naming-point）
  logExists=true  | status=needs-human → 10 条
  logExists=true  | status=ready       → 15 条
  预测成立（全 27 条无例外）: true
  ```
  ⇒ 两条缺失日志正是窗口内**唯二已落地**的任务；25 条仍在盘上的日志全部属于**未落地**的任务。若「从未写到该路径」为真，缺失应与 status 无关（且应有 ready/needs-human 的缺失者）——实测 0 例。

- [x] AC3（修后·确定性）同一任务、同一份 suite 日志的判词**不得再取决于无关第三方任务日志的存亡**。方向二选一并在 AC 里说明：要么把签名随 outcome 记录一起留存（不再事后读日志），要么让「无法判定是否复发」成为一个**独立取值**（不与 `own-defect-counted` 同形，硬规则 3b）。贴修后两次调用的返回，必须**相同**

  **方向 = 前者（签名随 outcome 记录留存，不再事后读日志）**。签名在**写记录那一刻**由 `withRecordedSuiteSignatures`（`worker-driver.ts`）从 suite 日志抽出，落进 append-only、不轮转的 `worker-outcome.jsonl` 的 `mechanical_fan_in.suiteSignatures`；`recurringSignatureTasks` 此后**只消费记录内留存签名**（⛔ 全文不再 `readFileSync` 任何第三方 suite 日志）。唯一生产写入点 = `runOneWorker` 的 `baseOutcome`（`worker-driver.ts`，全仓 `mechanical_fan_in` 仅此一处写）。三态写入（硬规则 3b）：非 suite 步 ⇒ **不加字段**（不适用）/ 有 suiteLog 读不出 ⇒ `null` / 读出 ⇒ `string[]`（可为 `[]`）。

  **修后读数**（同夹具、唯一差异 = 日志存亡）：窗口② = 窗口① = `unrelated-flaky-exempt`，`recurredTasks=["gap-b","gap-c"]`，`deepEqual` 成立。**真账本重放**（只读 live `.quay/`，两窗口 = 记录时刻 / 记录时刻+6h）：`gap-ac179-…` 与 `gap-ac293-…` 两条真记录的 **verdict 两窗相同**（分别 `insufficient-data-fallback` / `own-defect-counted`）。

  ⚠️ **如实报出过渡期读数（⛔ 不藏）**：真账本窗口内 27 条 suite-red 记录中，**带「写入时留存签名」的记录数 = 0**（全是改前写下的形态），仍在盘上的日志 25 条。⇒ 落地后的一段时间内，复发证据暂时为空 ⇒ 与 delta 无关的红 fail-closed 照常计数（比改前**更紧**，方向安全：⛔ 不是放宽豁免）。该收紧随改后记录累积自愈（窗口 48h 滚动淘汰旧记录），且**收紧不是「丧失豁免能力」**——AC4① 证明带签名的记录仍正确豁免。根治过渡期的替代修法是「在 prune 时把被删日志的签名落入耐久索引」，但那要改 `worker-fan-in.ts`（本任务 Touches 外），故本任务只报出该残余，不顺手扩面。

  判词的证据基础两态可区分（硬规则 3b）：窗口内**没有**带签名的记录 ⇒ `… none carried a recorded signature (legacy/pre-recording) — recurrence unevaluable, not evaluated-and-negative`；有但没匹配 ⇒ `… N carried recorded signatures and none matched`。两者动作同义（照常计数），读数不同形（有对照用例断言 `j.reason !== j2.reason`）。

- [x] AC4（负控制·两个方向）①签名**真的**跨 ≥2 个任务复发 ⇒ 仍给 `unrelated-flaky-exempt`（不得因本修法丧失豁免能力）；②签名只在本任务出现 ⇒ 仍记本任务。两读都贴

  **①（豁免能力保留）**：第三方日志**从未在盘上**、签名只存在于记录内 ⇒ `unrelated-flaky-exempt`，`recurredTasks=["gap-b","gap-c"]`（⛔ 不是靠放宽阈值换确定性）。
  **②（真缺陷不放行）**：第三方日志存在但命中**别的**签名 ⇒ `own-defect-counted`，`recurredTasks=[]`。

- [x] AC5（生产读数）落地后时间窗内 `.quay/worker-round.jsonl` 中一条真实 `retry_exemptions[]` 记录（贴原文 + 时间戳，晚于落地提交），其 verdict 与「同一判定在另一窗口下的重放结果」一致

  **真 driver 端到端一轮**（第三方形态 scratch workspace：无 `scripts/test.sh`、suite 走自己的 `loop.test_command`；AC 全勾故不走 acShortCircuit；scoped 门绿 / 全量 suite 红）。写入面与判词面都是生产代码路径：

  (a) `worker-outcome.jsonl`（真 driver 写盘）`mechanical_fan_in` 里**真的写入了留存签名**：
  ```
  ts=2026-09-23T16:09:36.267Z task=gap-ac5-probe final_state=exited-not-landed
  mechanical_fan_in: { outcome:"red", step:"suite", suiteLog:"fan-in-suite-gap-ac5-probe~fm-…~1790179748267-3b7466.log",
                       suiteSignatures: ["ac5 probe must be alive"] }
  ```
  (b) 真 `.quay/worker-round.jsonl` 记录（同一 workspace，真 driver 写）：
  ```
  {"ts":"2026-09-23T16:09:36.458Z","round":2,"retry_exemptions":[{
     "task":"gap-ac5-probe",
     "verdict":"unrelated-flaky-exempt",
     "reason":"signature(s) ac5 probe must be alive recurred across ≥2 distinct tasks in window (other: gap-other)",
     "failingTestFiles":["plugin/test/oth.test.mjs"],
     "recurredTasks":["gap-other"]}]}
  ```
  (c) 同一判定在另一窗口下的重放：`round 记录 verdict = unrelated-flaky-exempt` / `重放(记录时刻) = unrelated-flaky-exempt` / `重放(记录时刻+6h) = unrelated-flaky-exempt` ⇒ **三者一致 true**（且 `reason` 逐字相同）。

  ⚠️ **载体选择如实记（⛔ 不假装）**：**未**写 live 项目 `/data/home/yale/work/quay/.quay/worker-round.jsonl`——本仓库生产 loop 此刻在跑（`worker-driver.ts --mechanical-fan-in --task gap-ac255-… --root /data/home/yale/work/quay` 在飞），往在跑的 loop 的 round 载体塞外来记录会扰动它的 round/stop 状态读取。故该读数落在 **scratch workspace 自己的 `.quay/worker-round.jsonl`**：同一个生产写入者（worker-driver 常驻环）、同一路径约定、同一记录格式、同一判词函数。判词的**输入**侧另有真账本重放（AC3 节）锚在 live 数据上。

- [ ] AC6 `bash scripts/test.sh --for-task gap-unrelated-suite-red-exemption-unreachable` 绿

## DoD

真实落地：同一份输入在两个不同窗口下给出**相同**判词（AC3 的两次返回一致），且该一致性有生产 round 记录支撑（AC5）。⛔ 不以放宽豁免（把真缺陷也放行）换取确定性——AC4 ② 是这条的负控制。⛔ 不以「新增单测通过」代替生产 round 记录。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/helpers/worker-driver-fan-in-harness.mjs
- tasks/gap-unrelated-suite-red-exemption-unreachable.md
