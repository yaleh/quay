---
id: gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker
title: suite 红但归因不出任何测试文件时 driver 仍照常重派 worker —— 把契约/基建问题伪装成实现问题，每次烧一轮会话
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: v1
---
## Proposal

**现象（第三方项目 quay-fleet，连续两轮，日志逐字节相同）**：某任务的机械 fan-in 在 `suite` 步骤红：

```
.quay/fan-in-suite-<task>~wk-prod-…~1789293541539-b755ba.log
.quay/fan-in-suite-<task>~wk-prod-…~1789293926366-23c49f.log
（diff 两文件 = 空输出，逐字节相同）

  == quay-fleet test: 1 file(s) ==
  Could not find 'fleet-agent-sessions-transcript-endpoint'
  # tests 0 / # pass 0 / # fail 1 / # cancelled 0
  # suite red failed
```

**driver 自己知道它判不出这次失败**——`worker-round.jsonl` 连续两轮记着：

```
round 30: retry_exemptions[0] = { verdict: "insufficient-data-fallback",
                                  reason: "no failing test file extracted from the suite log" }
round 32: 同上，逐字相同
```

**但它照样重派。** 同一任务的派发时间戳三次：

```
in_flight_task_starts:  09:50:05.114Z   09:59:26.664Z   10:05:59.359Z
```

⇒ **三轮 worker，每轮一个完整的 `claude -p` 会话**，各自读同一份错误日志，而那份日志里**没有任何它能修的东西**——失败根本不在被测代码里（真因是 suite 的调用参数，见「近因」段）。

**缺陷的要害不是失败本身，是失败的分类与后续动作脱节**：
`insufficient-data-fallback` 这个 verdict 名字本身说明设计者知道「数据不足以归因」，
**但 fallback 的动作是「照常重派」**。而「从 suite 日志里提取不出任何失败的测试文件」这件事，
恰恰是**「问题不在被测代码里」的强信号**——正常的测试失败一定能归因到某个文件。
把这个信号当成「实现有问题，让 worker 再试一次」，是把一个契约/基建问题伪装成了实现问题。

**这与本工作区的既有纪律同源**：一个「读不懂」的状态不得与「合格」同形（硬规则 3b）。
这里的变体是：一个**「读不懂」的状态不得触发与「已读懂且判定为实现缺陷」相同的动作**。
driver 在读数上是诚实的（它如实记了 `insufficient-data-fallback`），
**坏在动作没有跟着读数分叉**。

**近因（已在 adopter 侧缓解，但不改变本缺陷）**：`worker-driver.ts` 的 suite 步骤用 quay 自己的内部 flag
（`--buckets <task-id> --root <wt> --state-dir … --runner … --log-file … --run-id …`）调用第三方项目
在 `loop.test_command` 里声明的命令。该项目的 `scripts/test.sh` 不认识 `--buckets` 这个**带值** flag，
只 shift 掉 flag、把值留给下一轮，于是 `<task-id>` 落进「位置参数当测试文件收」的兜底分支。
adopter 侧已加固（丢弃 quay 已知带值 flag + 位置参数不存在则跳过），但**换一个没做这层防御的
adopter 项目，同样的三轮空烧会重演**——因为 driver 的分类→动作链路没变。

**影响面**：任何 adopter 项目，只要 suite 因**非测试失败**的原因红（参数不兼容、runner 环境问题、
日志格式不被识别……），都会被判 `insufficient-data-fallback` 并进入重派循环，
直到撞上重试上限。每一轮的代价是一个完整的 Claude 会话，而成功率为零
（worker 无法从一份不含可修对象的日志里修出任何东西）。

> **实测触发面（2026-09-13，全量而非抽样）**：本缺陷不是第三方项目的边缘情形。
> 对 quay **自己仓库** `.quay/worker-round.jsonl` 的 `retry_exemptions` 做全量统计，
> 291 条判定中 **`insufficient-data-fallback` 占 127 条（44%）**，
> 与 `own-defect-counted`（136 条，47%）几乎持平。
> ⇒ **接近一半的 suite-red 重试判定，走的正是「判不出归因却照常重派」这条路径。**
> 相关任务 `gap-retry-exemption-signature-keeps-volatile-values` 的 DoD 里那个
> 「29 条中 24 条」是更早的抽样快照，方向一致、量级更小；以本条全量读数为准。

## Plan

> **⚠️ 与 `gap-retry-exemption-signature-keeps-volatile-values` 的 AC4 不矛盾，实现者必须显式区分两件事**：
> 那条 AC4 钉的是「签名提取失败 ⇒ verdict 仍落 `insufficient-data-fallback`、**照常计入重试预算**，
> ⛔ 不得因判不出而放行」——管的是**计数/归责**。
> 本任务管的是**同一 verdict 下的后续动作：是否再派一个 worker**。
> **「仍照常计数」∧「不再重派」可以同时成立**，且正是本任务要的终态：
> 预算照扣（不放行），但不再拿一个新会话去撞同一堵墙。

1. **让动作跟着读数分叉**：`insufficient-data-fallback`（以及任何「无法归因到具体失败测试文件」的
   verdict）不得走与「已归因的实现缺陷」相同的重派路径。至少要做到：**不重派**，
   把任务标为需要人判（或一个明确的「基建/契约疑似」终态），并在载体上写清「为什么判不出」。
2. **保留一次重试的余地但必须有上限且可区分**：若认为首次失败可能是瞬时的，允许**至多一次**重试；
   第二次仍归因不出 ⇒ 停止，⛔ 不得继续。当前实测是三次，且第 2、3 次的日志与第 1 次逐字节相同——
   **相同签名的重复失败必须被识别为「重试无效」**。
3. **把「日志签名相同」做成一个可用的判据**：连续两轮 suite 日志内容哈希一致 ⇒ 重试不可能改变结果，
   直接停止。这比任何启发式都硬。
4. **文档化 `loop.test_command` 契约**（附带，同一根源）：quay 会给 adopter 的 test_command 附加哪些
   内部 flag、adopter 必须如何容忍它们。当前这条契约在任何 adopter 面向的文档里都没有写明，
   而 `quay-init` 生成的项目也没有给出带防御的 test_command 示例。

## Acceptance Criteria

- [x] AC1（负控制，改前必须红）：构造一个 suite 日志，其内容无法归因到任何测试文件
      （例如只含 `Could not find '<something>'` 与 `# suite red failed`）。改前：driver 判
      `verdict="insufficient-data-fallback"` **且仍然重派**；改后：同一输入下**不重派**，
      任务进入需人判/基建疑似终态，载体记录该判定与理由。
      〔实测：pre-fix 驱动换入同一夹具 = 3 次派发 / 理由「重试上限」；post-fix = 2 次 / 理由「基建·契约疑似」；
      另见 DoD 实测段（真实第三方项目上 1 次派发即停）。用例：`worker-driver-retry-classification.test.mjs`〕
- [x] AC2：连续两轮 suite 日志内容哈希相同 ⇒ 第三轮不得发生。断言：给定两份相同日志的历史，
      重派计数停在 2。双向控制：两份日志不同时，允许继续（不得因本改动把正常重试也掐死）。
      〔实测：哈希判据用例发火且理由点名 sha256；双向控制证「内容不同 ⇒ 该判据不发火」；
      另有负控制证「已归因的实现缺陷即便日志逐字节相同也照常计数重派」；集成用例派发数停在 2〕
- [x] AC3：`insufficient-data-fallback` 与「已归因到具体失败文件」两种 verdict 在**后续动作**上
      可区分——静态或运行时断言两者不共用同一条重派分支。
      〔实测：`decideExitedNotLandedAction` 返回 `kind ∈ {count-and-retry, stop-terminal}`；
      同一份历史下换 verdict 得不同 kind；调用点按 kind 分叉（源码断言）〕
- [x] AC4：`loop.test_command` 的契约（quay 附加的内部 flag 清单 + adopter 的容忍义务）出现在
      adopter 可见的文档中，且 `quay-init` 生成的示例/模板体现该防御。断言该文档段落存在且
      逐字列出当前实际附加的 flag 集合（与 `worker-driver.ts` 的 suite 步骤保持一致，
      建议由一条静态检查钉住两者一致，否则又是一处会漂移的双副本）。
      〔实测：`plugin/skills/init/SKILL.md` 的 `## loop.test_command contract` 段逐字列出六个 flag；
      判据从 `defaultMechanicalSuiteCommand()` 的真实 argv 派生该集合（⛔ 不写第二份副本），
      少写一个 flag 即红；`quay-init` 真实落盘生成的 `.quay/config.yml` 带同一条义务的注记（同一用例断言）〕
- [ ] AC5：全量 `scripts/test.sh` 绿（待外部：全量套件绿由 fan-in 的 suite 步验证；本层按派发约定不跑全量套件）

## Definition of Done

在一个**真实的第三方项目**上（非 fixture）制造一次「suite 红且归因不出测试文件」的 fan-in，
观察到：**worker 被派发的次数 ≤ 2**，且任务进入一个明确的、人能看懂的终态
（而不是继续重派直到重试上限）。fixture 满足不算数（硬规则 4 推论三）。

## DoD 实测（真实第三方项目，⛔ 非 fixture）

**项目**：`quay-fleet`（真实第三方 adopter，非本仓库）。实验在其**副本**上做——原地跑会与该项目
自己的常驻 driver 抢同一份仓库与 worktree；副本 = 真实代码 + 真实 `.quay/` 生产载体（含该缺陷的
**真实事故记录**：两轮 suite-red outcome + 两份逐字节相同的 suite 日志）。
**基线**：副本 develop 固定在 `bb7d71d` —— 事故第一轮（09:59:12Z）那一刻的真实 develop tip；
其 `scripts/test.sh` 尚未加固（`grep -c buckets = 0`），正是事故的成因版本（加固提交是事后
`fe2260d`/`8fc7496`）。

**观测（重放真实事故）**：把事故任务 `fleet-agent-sessions-transcript-endpoint` 置回 `ready` 并派发。
机械 fan-in 真的跑到底并在 **`step=suite`** 红，日志与事故日志 payload 逐字同形：

```
== quay-fleet test: 1 file(s) ==
Could not find 'fleet-agent-sessions-transcript-endpoint'
# tests 0 / # pass 0 / # fail 1 / # cancelled 0
# suite red failed
```

（副本新日志 sha256 `b18b32ebbe0e…`（= round 记录里 `suiteLogHash` 的取值）；事故日志 sha256
`c4deb91183bb…`；两者仅差 quay 后加的 `SUITE-RUN-START` 前导行，payload 逐字节相同。）

**读数**：`dispatches = 1`（≤2 ✓）；`decisions[0].kind = stop-terminal`、`verdict = insufficient-data-fallback`；
任务终态 `needs-human`（`committed: true`），注记可读并带真因指针：

```
## Needs-Human
- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，
  ⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file …
- 失败步/判词：step=suite: # fail 1
- suite 日志：<绝对路径>
```

**对照（改前）**：同一夹具换回 pre-fix `worker-driver.ts` 实测派发 **3 次**、注记退化为
「连续 3 次 exited-not-landed（重试上限）」、无 `exited_not_landed_stops` 载体。

**机制旁证**：宿主过载时 quay 的 runner 会 `SUITE-NOT-RUN`（resource-gate 拒跑）——该日志同样不点名
任何失败测试文件，本改动把它判为 `stop-terminal` 而非重派，与缺陷陈述的范围（「runner 环境问题」
亦属「非测试失败的红」）一致。

**⛔ 未被本观测覆盖**：adopter 加固（`fe2260d`）**之后**的项目不再自然复现该 suite 红 ⇒ 「已加固项目」
这一支由单元/集成用例与负控制（own-defect 路径不受影响）覆盖，不由本实测覆盖。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/quay-init.sh
- plugin/test/worker-driver-retry-classification.test.mjs
- plugin/skills/init/SKILL.md
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker.md

⚠️ `plugin/test/worker-driver-retry-classification.test.mjs` 是**新文件**——同族既有用例都在
`plugin/test/worker-driver-fan-in.test.mjs`。**若实现者选择把用例并入既有文件，必须同步改上面的 Touches**，
否则 `--for-task` scoped 门取不到它（声明与实际改动漂移）。

⚠️ AC4 的实现面（`quay-init.sh` 的 config 模板 + `SKILL.md`）与随之必须 re-anchor 的
`quay-init-closure-ratchet.baseline.json` 亦已登记（`--reanchor` 后 footprint 未涨：3 files / 568 bytes）。
