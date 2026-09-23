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

## AC

- [ ] AC1（复现固化·两个方向都要有读数）用**同一个任务 + 同一份 suite 日志**构造两次调用，输入只差「窗口内其它任务日志的可读性」：①其它任务日志不可读 ⇒ `own-defect-counted`；②有一条可读 ⇒ `unrelated-flaky-exempt`。两次调用的输入与返回原文都贴
- [ ] AC2（归因，硬规则 4 推论四）说清那两条日志是**被谁删除/清理**的（点名机制/脚本/行），或证明它们**从未**写到该路径。⛔ 不得以「大概是被清理了」结案；给不出对照就降为假说
- [ ] AC3（修后·确定性）同一任务、同一份 suite 日志的判词**不得再取决于无关第三方任务日志的存亡**。方向二选一并在 AC 里说明：要么把签名随 outcome 记录一起留存（不再事后读日志），要么让「无法判定是否复发」成为一个**独立取值**（不与 `own-defect-counted` 同形，硬规则 3b）。贴修后两次调用的返回，必须**相同**
- [ ] AC4（负控制·两个方向）①签名**真的**跨 ≥2 个任务复发 ⇒ 仍给 `unrelated-flaky-exempt`（不得因本修法丧失豁免能力）；②签名只在本任务出现 ⇒ 仍记本任务。两读都贴
- [ ] AC5（生产读数）落地后时间窗内 `.quay/worker-round.jsonl` 中一条真实 `retry_exemptions[]` 记录（贴原文 + 时间戳，晚于落地提交），其 verdict 与「同一判定在另一窗口下的重放结果」一致
- [ ] AC6 `bash scripts/test.sh --for-task gap-unrelated-suite-red-exemption-unreachable` 绿

## DoD

真实落地：同一份输入在两个不同窗口下给出**相同**判词（AC3 的两次返回一致），且该一致性有生产 round 记录支撑（AC5）。⛔ 不以放宽豁免（把真缺陷也放行）换取确定性——AC4 ② 是这条的负控制。⛔ 不以「新增单测通过」代替生产 round 记录。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-unrelated-suite-red-exemption-unreachable.md
