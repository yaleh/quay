---
id: gap-send-keys-reliable-false-fail-on-long-text-paste
title: send-keys-reliable.sh 的送达确认把成功的长文本/粘贴投递报成 FAIL——transcript 落成
  type=queue-operation + type=attachment（零条 type=user 纯字符串），checker 只认
  type=user+message.role=user 的纯字符串形态；假 FAIL 比真 FAIL 更贵（上游据它做反向决策）—— 管理者 05:39
  实测踩到，判据设计（是否纳入 queue-operation/attachment）是外层+内层设计决定
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`send-keys-reliable.sh` 的送达确认逻辑有误——会把成功的投递报成 FAIL。**

### 实测（管理者 2026-08-08 05:39，已发生）

管理者 05:39 那条消息（「两条我自己的错，先认再补」）脚本报 `FAIL——120s 有界轮询后
transcript 仍未出现内容匹配的真实 user`，但**消息实际送到了**（外层正在处理它）。查原始
jsonl（`~/.claude/projects/-home-yale-work-quay/3cc1c0b9-*.jsonl`）该内容落成了：

```
type=queue-operation  ts=2026-08-08T05:39:23.157Z
type=queue-operation  ts=2026-08-08T05:39:42.590Z
type=attachment       ts=2026-08-08T05:39:23.157Z  isSidechain=False
```

**零条 type=user 纯字符串记录。**

### 根因

`plugin/scripts/transcript-delivery-check.ts` 的送达判据（第 65-69 行）：

```ts
if (rec.type !== "user") continue;
if (rec.message?.role !== "user") continue;
...
if (typeof content === "string") { ... }
```

只认 `type === "user"` **且** `message.role === "user"` **且** content 为纯字符串（或 text 块）
的形态。但**至少在长文本/粘贴形态下，投递成功后就是落成 `queue-operation` + `attachment`**，
脚本对这种形态不识别，于是超时误报 FAIL。`orchestration/manager-tick-sending.md` 里写的
「唯一可靠判据是 type=user 且非 sidechain」**这句话本身也是错的**——同一形态。

### 代价（已实际发生，管理者 2026-08-08 量化）

管理者据这个假 FAIL ：
- 推翻了自己的等待器策略；
- 写了一条基于错误前提的判准（已撤回）；
- 在 tick-log 记了一条并不存在的违规；
- 把自己的送达纪律改坏了一版（从「用 meta-cc」错改成「手搓 grep jsonl」，已改回）。

**假 FAIL 比真 FAIL 更贵，因为它会让上游据此做出反向决策。**

### 第二次实测（05:54 同一形态，管理者补证据）

05:54 那封（README 候选 + 本缺陷报告）同样报 FAIL；实际落成 `queue-operation`(05:54:05) +
`queue-operation`(05:54:13) + `attachment`(05:54:05)，**零条 type=user**。外层 05:58:49 开始改
gap-readme-source-install 任务文件、05:59:32 写 .quay/drive-readme-dispatch.txt——响应的是这一封，
而管理者当时判它「真丢弃」、又补发了一次（05:59:50 那条重复记录就是补发）。**两次形态一致。**

### 正确判据（管理者已实测确定）

用 meta-cc 但**换 role 参数**：`mcp__meta-cc__query_session_content  role=all  session_id=<目标会话>
contains=<特征串>`。同一条消息实测 `role=user` 返 0、`role=all` 返 7。**meta-cc 一直能答，是 role
参数用错了。** 外层独立复核：3cc1c0b9 transcript 05:54 窗口 `type=user` 纯字符串 = 0、
`queue-operation`+`attachment` = 3——与管理者证据一致。

### 修法方向（归外层+内层设计，管理者不代设计）

可能方向：判据从 `type=user` 放宽到 `type in {user, queue-operation, attachment}`；或改用 meta-cc
`role=all` 做确认；或两者都要。**注意 `orchestration/manager-tick-sending.md` 和脚本内的判据是两份，
改一处会漂移——两份要同步改。**

### 人 06:1x 的方向（优先于「修准」——三态而非二态）

> 原话：「如果 send-keys-reliable.sh 要做准有困难，我可以接受它只是把失败的语义讲清楚，
> 例如区分明确的失败和『我没看清楚』。」

现在脚本把两件事压成同一个 FAIL：
- **(a) 明确失败**——发出去、对方忙、enqueue 后被 remove，真丢弃；
- **(b) 我没看清**——可能已送达，只是判据覆盖不到或轮询窗口内没落盘。

**这两者对调用方的后续动作完全相反**：(a) 该补发；(b) 补发就是重复投递。压成一个 FAIL ⇒
调用方无论怎么做都会在一半场景里出错。

**建议形状（具体归外层+内层设计）**：**三态而非二态**——
- **已确认送达** / **明确失败（有丢弃证据）** / **未确认（不知道，先查再决定）**。
- **第三态不该叫 FAIL**——今天所有下游错误决策都源于把第三态读成了第一种含义。

**三态可分辨性的实测证据（第 3 次样本）**：本缺陷报告那封本身报 FAIL 且 `role=all` 核实
零命中，是**真丢弃**（与前两次假 FAIL 形态不同）——说明三态是可分辨的，不是纸上谈兵。

### 范围

按管理者 §0 不改产品脚本，报到这里。**判据该怎么改（是否把 queue-operation/attachment 纳入、
还是查别的字段）、三态怎么落地是外层和内层的设计决定。** 本任务承载该设计 + 落地。

## Contract

```
measure false_fail_repro = `bash plugin/scripts/send-keys-reliable.sh <目标> "<长文本>" <目标 transcript.jsonl>` 退出码
band false_fail_repro = 0（修复后长文本投递必须报 delivered；当前必报 FAIL=1）
invoke `bash plugin/scripts/send-keys-reliable.sh "quay-0:0.0" "$(cat 一条长文本)" <manager-transcript.jsonl>`
control 修复后重放 manager 05:39 同形态（queue-operation+attachment）必为 delivered；真失败仍必须 FAIL（负控制）
resume 若中断，先跑 measure 确认长文本投递的退出码，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **三态设计（人 06:1x 方向，优先）**——脚本/判据改为三态：**已确认送达 / 明确失败（有丢弃
      证据）/ 未确认（不知道，先查再决定）**；第三态不叫 FAIL；写成设计说明贴任务体；不改产品脚本
      （§0）直到设计被外层采纳
- [ ] AC2: **假 FAIL 消除**——长文本/粘贴形态投递（如 manager 05:39/05:54 同形态）不再报「明确失败」
      （第三态：未确认或已确认），不再超时报 FAIL 并让调用方据它做反向决策
- [ ] AC3: **真丢弃仍可分辨**——manager 第 3 次样本（本缺陷报告那封，`role=all` 零命中 = 真丢弃）
      能被三态正确分类为「明确失败」或「未确认」；已确认送达不误报丢弃（负控制不丢）
- [ ] AC4: **回归**——既有成功形态（type=user 纯字符串）仍确认送达；既有已知失败形态仍正确分类
      （如 welcome-screen ghost、NBSP、hash 判据等已有用例）
- [ ] AC5: **文档订正**——`orchestration/manager-tick-sending.md` 的「唯一可靠判据是 type=user 且非
      sidechain」订正为与三态设计一致；与脚本内判据同步改（防漂移）
- [ ] AC6: 与 `gap-send-keys-reliable-*` 既有任务族交叉标注（welcome-screen / nbsp / hash-check）

## Definition of Done

- [ ] AC1-AC5 实跑输出贴任务体（长文本投递 exit 0 对照 + 负控制 + 回归）
- [ ] 判据设计被外层/内层采纳（设计说明而非仅修脚本）

## Touches
- plugin/scripts/transcript-delivery-check.ts（判据设计：queue-operation/attachment 形态）
- plugin/scripts/send-keys-reliable.sh（若判据设计需改调用侧）
- orchestration/manager-tick-sending.md（AC4 文档订正）
- plugin/test/transcript-delivery-check.test.mjs（AC2/AC3 回归用例）
- tasks/gap-send-keys-reliable-false-fail-on-long-text-paste.md（自身）

## Dispatch review

reviewer: none
at: 2026-08-08T06:0xZ
changed: 管理者 2026-08-08 05:39 实测踩到（假 FAIL，消息实际送达），按 §0 不改产品脚本报外层立案。
  外层独立核实：3cc1c0b9 transcript 05:39 窗口零条 type=user 纯字符串、只有 queue-operation+
  attachment 两条；transcript-delivery-check.ts:65-69 只认 type=user 纯字符串形态——根因确认。
