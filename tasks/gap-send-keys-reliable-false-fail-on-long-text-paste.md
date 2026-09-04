---
id: gap-send-keys-reliable-false-fail-on-long-text-paste
title: send-keys-reliable.sh 的送达确认把成功的长文本/粘贴投递报成 FAIL——transcript 落成
  type=queue-operation + type=attachment（零条 type=user 纯字符串），checker 只认
  type=user+message.role=user 的纯字符串形态；假 FAIL 比真 FAIL 更贵（上游据它做反向决策）—— 管理者 05:39
  实测踩到，判据设计（是否纳入 queue-operation/attachment）是外层+内层设计决定
status: done
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
measure false_fail_repro = `bash plugin/scripts/send-keys-reliable.sh <目标> "<长文本>" <目标 transcript.jsonl>` 退出码 exit_code（三态：0=delivered · 1=failed(丢弃证据) · 3=unknown(未确认)）
band false_fail_repro = 0（修复后长文本投递必须 exit 0=delivered；当前必报 FAIL=1）
invoke `bash plugin/scripts/send-keys-reliable.sh "quay-0:0.0" "$(cat 一条长文本)" <manager-transcript.jsonl>`
control 修复后重放 manager 05:39 同形态（queue-operation+attachment，零条 type=user）必为 exit 0=delivered；真丢弃（queue-op remove 无物化）必须仍可分辨为 exit 1=failed 或 exit 3=unknown，且 DELIVERED 不误报丢弃（负控制不丢）
resume 若中断，先跑 measure 确认长文本投递的退出码，不要假设已修
```

## 设计说明：三态送达判据（AC1 落地）

**不再二态。** 原判据把「明确失败」和「我没看清」压成同一个 FAIL，调用方无论怎么反应都会在
一半场景里出错（假 FAIL 时补发=重复投递；真丢弃时不补发=永久丢失）。现改为三态：

| 态 | 判据（transcript 内） | 脚本 exit | 调用方动作 |
|---|---|---|---|
| **已确认送达 DELIVERED** | sent 文本出现在**物化形态**：真实 `type=user` 消息（纯字符串/text 块），或 `type=attachment`（`isSidechain !== true`，`attachment.prompt`/`content` 携带文本） | 0 | 不补发 |
| **明确失败 FAILED** | sent 文本**只**出现在 `queue-operation` `operation=remove`（入队后从未物化为 user/attachment 即被移除）——忙会话「enqueue 约 3 秒后 remove」的实测丢弃签名 | 1 | 可补发 |
| **未确认 UNKNOWN** | 两侧都没有证据（没匹配，或只有 enqueue 仍在排队） | 3 | **先核实再决定**（meta-cc `role=all`），**勿按 FAIL 补发** |

**优先级（负控制关键）**：`checkTranscriptDelivered` 先扫物化形态（user/attachment 命中即 DELIVERED），
再扫 queue-op remove（仅当无物化证据时判 FAILED），其余 UNKNOWN。**一旦物化，即使同内容
queue-op remove 同时存在也判 DELIVERED——已确认送达永不误报丢弃。**

**为什么 queue-op remove 单独可判 FAILED**：manager 05:39 真实顺序是 enqueue(05:39:23) →
remove(05:39:42) + attachment(05:39:42)，即**物化 attachment 与 remove 同时落盘**；而忙会话丢弃
签名是「enqueue 后约 3 秒 remove、无任何物化」。所以 remove 无物化 = 丢弃，物化存在 = 送达。
脚本侧对 FAILED 也继续轮询到有界期才最终判定（避免 remove 先落、attachment 稍后落盘的竞态），
在界点用最终一次 checker 运行区分 FAILED(exit 1) 与 UNKNOWN(exit 3)。

## 落地证据（2026-08-08 实跑）

**A. 假 FAIL 消除（measure false_fail_repro，主目标）**——真实长文本投递形态（queue-operation +
attachment，**零条 type=user**），脚本实测 exit **0**：

```
$ bash plugin/scripts/send-keys-reliable.sh <fixture-session> "long-paste-marker ... 一二三四五六七八九十" <transcript.jsonl>
send-keys-reliable: fresh session（transcript 无 user 消息）——SKIP 清屏循环，直接发送
send-keys-reliable: 已送达 …（transcript 出现内容匹配的送达证据：真实 user message 或 queued_command attachment）
state: delivered / delivered: true / matched_line: {"type":"attachment",…"prompt":"long-paste-marker …"}
EXIT=0
```
对照：修复前该形态 `type=user` 纯字符串 = 0，checker 只认它 → 120s 超时误报 FAIL=1。

**B. 负控制（真丢弃仍可分辨）**——忙会话丢弃签名（enqueue+remove，无物化），脚本实测 exit **1**：
```
$ RELIABLE_DELIVERY_VERIFY_S=8 … bash plugin/scripts/send-keys-reliable.sh <fixture-session> "discard-marker-…" <transcript.jsonl>
send-keys-reliable: FAILED——…只剩明确丢弃证据（queue-operation remove，从未物化为 user/attachment）；消息被丢弃，需人工/重发
state: failed / delivered: false / EXIT=1
```

**C. 第三态 UNKNOWN（不叫 FAIL）**——无任何证据（对应 manager 第 3 次样本 role=all 零命中），
脚本实测 exit **3** 并明确输出「先核实再决定，勿按 FAIL 补发」：
```
$ RELIABLE_DELIVERY_VERIFY_S=6 … bash plugin/scripts/send-keys-reliable.sh <fixture-session> "ghost-marker-…" <transcript.jsonl>
send-keys-reliable: UNKNOWN——…既无送达证据也无明确丢弃证据…先核实再决定（如 meta-cc role=all），勿按 FAIL 补发
state: unknown / delivered: false / EXIT=3
```

**D. 回归**——`plugin/test/send-keys-reliable.test.mjs` 29 pass（含既有 type=user 成功形态、fresh
welcome-screen ghost SKIP、NBSP 清屏、hash 判据零出现、AC2/AC1 真实 TUI e2e）；
`plugin/test/transcript-delivery-check.test.mjs`（新建）27 pass（AC2/AC3/AC4 + CLI 三态退出码）；
send-keys-verified 5 / l1-delivery-surface 6 / verify-delivery-surface 9 / adr016-screen-use 13 全过。
scoped 静态档 `scripts/test.sh --for-task … --allow-thin`：task-contract-check 0 violations。

**E. 文档订正（AC5）**——`orchestration/manager-tick-sending.md` 与脚本内判据**同一提交同步改**：
「唯一可靠判据是 type=user 且非 sidechain」订正为三态设计表 + meta-cc `role=all` 交叉验证判据
（≥1 条=已确认送达；0 条=未确认，先核实再补发）；「报 FAIL 时先核实再决定」段同步指向三态拆分。

## Acceptance Criteria

- [x] AC1: **三态设计（人 06:1x 方向，优先）**——脚本/判据改为三态：**已确认送达 / 明确失败（有丢弃
      证据）/ 未确认（不知道，先查再决定）**；第三态不叫 FAIL（exit 3=UNKNOWN）；设计说明已贴任务体
      （上方「设计说明：三态送达判据」）；产品脚本 `send-keys-reliable.sh` 的调用侧已按三态落地
- [x] AC2: **假 FAIL 消除**——长文本/粘贴形态投递（manager 05:39/05:54 同形态：queue-operation +
      attachment，零条 type=user）实测 exit 0=delivered，不再超时报 FAIL（证据 A）
- [x] AC3: **真丢弃仍可分辨**——manager 第 3 次样本（`role=all` 零命中 = 真丢弃）对应 UNKNOWN(exit 3)；
      忙会话丢弃签名（enqueue+remove 无物化）判 FAILED(exit 1)（证据 B/C）；已确认送达不误报丢弃
      （负控制：物化证据优先于同内容 remove，专项测试 + 证据 A/B）
- [x] AC4: **回归**——既有成功形态（type=user 纯字符串）仍 DELIVERED；既有已知失败形态仍正确分类
      （assistant-only / tool_result-only / 内容不匹配 / 空 sent text → 非 delivered；welcome-screen
      ghost SKIP、NBSP 清屏、hash 判据零出现均有既有用例守护）（证据 D）
- [x] AC5: **文档订正**——`orchestration/manager-tick-sending.md` 的「唯一可靠判据是 type=user 且非
      sidechain」已订正为三态设计；与脚本内判据**同一提交**同步改（防漂移）（证据 E）
- [x] AC6: 与 `gap-send-keys-reliable-*` 既有任务族交叉标注——`send-keys-reliable.test.mjs` 即既有
      welcome-screen-ghost / nbsp / hash-check 用例的回归宿主，本任务改动已在其上全绿

## Definition of Done

- [x] AC1-AC5 实跑输出贴任务体（长文本投递 exit 0 对照 + 负控制 + 回归 + 文档同步，见上方证据 A-E）
- [x] 判据设计被外层/内层采纳（设计说明而非仅修脚本——设计说明已贴任务体；三态实现 live on develop
      `send-keys-reliable.sh` exit 3 / `transcript-delivery-check.ts` state: delivered|failed|unknown；
      管理者 2026-08-08 裁定确认 tool_result 为可靠来源；外层 2026-08-08 复核采纳）

## Touches
- plugin/scripts/transcript-delivery-check.ts（判据设计：三态 + queue-operation/attachment 形态）
- plugin/scripts/send-keys-reliable.sh（三态退出码 0/1/3 落地：FAILED/UNKNOWN 拆分，界点最终判定）
- orchestration/manager-tick-sending.md（AC5 文档订正）
- plugin/test/transcript-delivery-check.test.mjs（新建，AC2/AC3/AC4 三态回归用例）
- plugin/test/send-keys-reliable.test.mjs（CLI 退出码断言随三态契约更新：no-match exit 1 → exit 3）
- tasks/gap-send-keys-reliable-false-fail-on-long-text-paste.md（自身）

## Dispatch review

reviewer: none
at: 2026-08-08T06:0xZ
changed: 管理者 2026-08-08 05:39 实测踩到（假 FAIL，消息实际送达），按 §0 不改产品脚本报外层立案。
  外层独立核实：3cc1c0b9 transcript 05:39 窗口零条 type=user 纯字符串、只有 queue-operation+
  attachment 两条；transcript-delivery-check.ts:65-69 只认 type=user 纯字符串形态——根因确认。
