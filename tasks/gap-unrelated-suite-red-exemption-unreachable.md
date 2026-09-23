---
id: gap-unrelated-suite-red-exemption-unreachable
title: '"与 delta 无关"的重试豁免当前不可达——跨任务签名复发要读的其它任务 suite 日志已不在盘上'
status: todo
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

`judgeRetryExemption` 在判出「所有失败测试文件都与本任务 delta 无关」之后，仍要求断言签名**跨 ≥2 个不同任务复发**（`recurringSignatureTasks`，`:2162`）才给 `unrelated-flaky-exempt`；否则落到 `own-defect-counted`（fail-closed 计数）。

而 `recurringSignatureTasks` 要读**其它任务**的 suite 日志（`fs.readFileSync(a.suiteLog)`）。实测（本机，48h 窗口）：`suiteRedAttemptsInWindow` 返回 5 条记录，其中 2 条属其它任务，而**这两条的日志文件都已不在盘上**：

```
gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires  → /data/home/yale/work/quay/.quay/fan-in-suite-…-1790120062075-44cf74.log  exists=false
gap-quay-init-sh-no-single-naming-point                            → /data/home/yale/work/quay/.quay/fan-in-suite-…-1790136256016-3a54d0.log  exists=false
（本任务自己的 3 条 exists=true）
```

⇒ 跨任务复发**结构上不可能被观测**，`recurredTasks` 恒为 `[]`。真实 outcome 形状下的判词（`gap-quay-init-install-steps-invalid-and-spec-4b-dev-slot`）：

```
verdict: "own-defect-counted"
reason: "failing tests unrelated to this task's delta, but the assertion signature did not recur across ≥2 distinct tasks in the window (fail-closed count)"
failing: [laydown-set-check, develop-deliver-tgz-evidence-transport, arch-coverage-report, outer-tick-log-check, direct-to-develop-bypass-check]
recurred: []
```

⇒ 「不相关」这条豁免**当前不可达**：每一个与 delta 无关的红都被记到任务自己头上，任务烧完重试上限后被标 needs-human。这正是当前三个 needs-human 任务的共同终点。

## AC

- [ ] AC1（复现固化）贴出上述 5 条窗口记录的 raw `suiteLog` 路径 + 逐条 `fs.existsSync` 读数（2 条 false），以及真实 outcome 形状下的判词 JSON 原文
- [ ] AC2（归因，硬规则 4 推论四）说清那两条日志**是被谁删除/清理的**（点名机制/脚本/行），或证明它们**从未**写到该路径。⛔ 不得以"大概是被清理了"结案——给不出对照就降为假说，不得作为结论
- [ ] AC3（修后）在同样"其它任务日志不可读"的输入下，判词不得再把与 delta 无关的红记到本任务头上：给出**可区分的第三取值**，或让签名复发不再依赖**已消失的**日志（例如把签名随 outcome 记录一起留存，而不是事后读日志）。贴调用与返回原文
- [ ] AC4（负控制·两个方向）①签名**真的**跨 2 个任务复发 ⇒ 仍给 `unrelated-flaky-exempt`（不得因本修法而失去豁免能力）；②签名只在本任务出现 ⇒ 仍记本任务。两读都贴
- [ ] AC5（生产读数）落地后时间窗内 `.quay/worker-round.jsonl` 中一条真实 `retry_exemptions[]` 记录（贴原文 + 时间戳），其 verdict 不再是"与 delta 无关却记到本任务"
- [ ] AC6 `bash scripts/test.sh --for-task gap-unrelated-suite-red-exemption-unreachable` 绿

## DoD

真实落地：在真实 round 记录里，一个与 delta 无关的红不再被记到任务头上（AC5）。⛔ 不以"新增单测通过"代替生产 round 记录；⛔ 不以放宽豁免（把真缺陷也放行）换取可达性——AC4 ② 是这条的负控制。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-unrelated-suite-red-exemption-unreachable.md
