---
id: gap-a13-heartbeat-refusal-write-invisible
title: "A13 结构修复——AC53 拒写只进旁路、主心跳不更新 ⇒ 活跃 inner 恒被判 DEAD；(甲) 判据取 max(主心跳, refusal ts) + (乙) 拒写也写主快照带 written:false"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：outer 2026-08-16 relay 的 A13 结构问题——「拒因恒『可派活』⇒ 主心跳永不更新 ⇒ A13 必 DEAD」。

**现状（三文件行为，实测 2026-08-16 21:3xZ）**：
```
writer inner-wakeup-heartbeat.ts：AC53 END-INVARIANT 闸在 should_refill=true + slots_free>0 +
  dispatchable_disjoint>0 时 REFUSE（exit 1）——拒写只 append {written:false, ts, refuse_reason}
  到旁路 inner-wakeup-heartbeat-refusals.jsonl（主 jsonl/json 保持纯净，不被污染）。
judge inner-wakeup-heartbeat-check.ts：只读主 .json 的 ts 判新鲜（age > 5400s ⇒ DEAD），
  不读 refusals 旁路。
```
**实证（21:30:10Z 实测）**：主 json ts=1786905010（=18:30:10Z，3h 前）⇒ age=10800s > 5400s ⇒ **A13 报 DEAD**；
refusals 末条 ts=1786911043（=20:10:43Z，79min 前）⇒ 若判据取 max ⇒ age=4770s < 5400s ⇒ **ALIVE**。
inner 该时段全程活跃（fan-in AC97/round8/派发）⇒ **A13 的 DEAD 是结构误报**——活跃但被闸拒写的工作
状态在主心跳上不可见（与 3b「读不懂伪装成通过」镜像：这里是「被拒写伪装成死了」）。

**根因**：AC53 拒写是【合法且频繁】的活跃信号（dispatchable work waits = inner 正忙），但该信号只落在
judge 不读的旁路 ⇒ 判据把「活跃拒写」误读成「死」。

**修复（两条，互为补充）**：
- **(甲) judge 侧（最小，零写入语义变更）**：`inner-wakeup-heartbeat-check.ts` 判新鲜改用
  `max(主 json ts, refusals jsonl 最新 ts)`——最近一次拒写也证 inner 活跃（拒写 = 想睡但被闸拦下继续干）。
- **(乙) writer 侧（更完整）**：`inner-wakeup-heartbeat.ts` 拒写时**也更新主 .json 快照**，带
  `written:false + refuse_reason`（jsonl 仍保持纯净；只动 legacy .json，其消费者 semantic-observer judge
  需兼容新字段）。使主心跳本身反映「活跃但被拒」而非「无声」。

**⛔ 不设数值阈值**：5400s（=3×1800s 心跳周期）是既有判据，不改。只改「取哪个 ts」。

**边界**：不改 AC53 闸逻辑（闸本身正确——「无合法出口睡在可派活之上」）；不改 jsonl 写入语义；
不给 A13 造第二个心跳载体（沿用既有 refusals 旁路）。

## Acceptance Criteria

- [x] AC1: **judge 判新鲜取 max(主 json ts, refusals 最新 ts)**——`inner-wakeup-heartbeat-check.ts` 读 refusals 旁路，
      两者取大。读生产载体（refusals jsonl 真实行），非 fixture。
- [x] AC2: **负控制（读真实数据）**：21:30:10Z 快照下（主 json 18:30 / refusals 末条 20:10），
      修复前判 DEAD、修复后判 ALIVE——同一输入两读数可区分。
- [x] AC3: **writer 拒写也更新主 .json 快照（带 written:false）**——`inner-wakeup-heartbeat.ts` 拒写路径
      写 `{ts, ..., written:false, refuse_reason}` 到主 .json（jsonl 不写）；semantic-observer judge 兼容新字段。
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿；judge/writer 的既有单测（
      inner-wakeup-heartbeat-check.test.mjs / inner-wakeup-heartbeat.test.mjs）不回归。

## Definition of Done

- [x] A13 在「inner 活跃但 AC53 拒写」状态下不再误报 DEAD（judge 取 max 生效）；拒写留痕到主心跳
      （written:false）；测试全绿。（待外部：A13 判据经外层跑一轮确认 ALIVE）

## Evidence

**实现（inner 2026-08-17）——judge 取 max + writer 拒写镜像，两条互补**：

- **(甲) judge** `plugin/scripts/inner-wakeup-heartbeat-check.ts`：
  - 新增纯函数 `latestRefusalTs(text)`（解析 refusals jsonl 文本，malformed 行跳过，返回最新有效 ts）、
    `readLatestRefusalTs(root)`（读 `<root>/.quay/inner-wakeup-heartbeat-refusals.jsonl`）、
    `maxFreshnessTs(heartbeat, refusalTs)`（取 max）、
    `judgeHeartbeatWithRefusal(nowSec, heartbeat, refusalTs, maxAge)`（判新鲜；输出带
    `freshnessSource: "heartbeat"|"refusal"`，硬规则 3b 区分「真心跳新鲜」与「拒写证活跃」）。
  - `main()` 判新鲜改用 `judgeHeartbeatWithRefusal`；JSON 输出新增 `freshnessSource` + `latestRefusalTs`。
  - 判据沿用 5400s，**不设新数值阈值**。
- **(乙) writer** `plugin/scripts/inner-wakeup-heartbeat.ts`：
  - `writeRefusal(root, refuseReason, extra, heartbeat)` 在 append 旁路 refusals jsonl 之外，**镜像到 legacy
    `.json` 快照** `{...heartbeat, written:false, ts, refuse_reason, ...extra}`（原子 temp+rename；ts 用拒写时刻=新鲜；
    完整结构化字段保留）。jsonl 仍只记成功写（保持纯净）。三条拒写路径（in-flight 缺失 / 机件不可验 /
    结束不变式违例）都传 `heartbeat`。
  - semantic-observer judge（legacy `.json` 消费者）只读它认识的键（blocked/stopped/awaiting/reason），
    新字段透明兼容——测试 `plugin/test/semantic-observer-judge.test.mjs` 23 项全绿。

**AC2 负控制（同一输入两读数）**——`inner-wakeup-heartbeat-check.test.mjs` A13 CLI 测试：
主 json ts=now−10800（3h，age>5400 ⇒ 单读 DEAD）；写入 refusals 末条 ts=now−4740（79min）后，
同一 heartbeat 文件判 **ALIVE**（`freshnessSource:"refusal"`, `ageSecs≈4740<5400`）；无 refusals 时判 **DEAD**。
纯函数层另有 8 项 A13 单测（latestRefusalTs / readLatestRefusalTs / maxFreshnessTs /
judgeHeartbeatWithRefusal 五态：recent-refusal-ALIVE、no-refusals-stale-DEAD、heartbeat-fresh、both-stale-DEAD、
missing-heartbeat+recent-refusal-ALIVE）。

**AC3 拒写留痕**——`inner-wakeup-heartbeat.test.mjs` A13 测试：构造结束不变式违例拒写后，
legacy `.json` 含 `written:false` + `refuse_reason:"inner-round-ended-with-dispatchable-work"` + 新鲜 ts +
全部 7 个 REQUIRED_HEARTBEAT_FIELDS；jsonl 无写入。in-flight 缺失拒写同理
（`refuse_reason:"end-invariant-gate-requires-in-flight"`）。

**测试结果**：
- `node --test plugin/test/inner-wakeup-heartbeat-check.test.mjs` — **88 项全绿**（既有 79 + 新 9）
- `node --test plugin/test/inner-wakeup-heartbeat.test.mjs` — **24 项全绿**（既有 22 + 新 2）
- `node --test plugin/test/semantic-observer-judge.test.mjs` — **23 项全绿**
- `npx tsc --noEmit -p tsconfig.json` — 无错误
- `bash scripts/test.sh --for-task gap-a13-heartbeat-refusal-write-invisible --allow-thin` — **EXIT=0**，
  scoped static 全 PASS，task-contract strict-subset 无违规，112 项测试全绿

## Touches

- plugin/scripts/inner-wakeup-heartbeat-check.ts（judge 判新鲜取 max(主 json, refusals)）
- plugin/scripts/inner-wakeup-heartbeat.ts（拒写也更新主 .json 快照，带 written:false）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（judge 新判据单测，负控制）
- plugin/test/inner-wakeup-heartbeat.test.mjs（writer 拒写留痕单测）
- tasks/gap-a13-heartbeat-refusal-write-invisible.md（自身）

## Test-Files

- plugin/test/inner-wakeup-heartbeat-check.test.mjs（98 项既有 + 新负控制）
- plugin/test/inner-wakeup-heartbeat.test.mjs（22 项既有 + 拒写留痕）
