---
id: gap-meta-filedecisions-goal-write-omits-body
title: fileDecisions 建 GOAL 时不传 --body ⇒ decision 通道自 body≥40 引入（80d12fe42,
  09-08）后结构性损坏：GOAL-013 exit 2 未落地，盲区类问题失去唯一出路
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**缺陷（实测，非主张）**：`plugin/scripts/meta-driver.ts:1377` 的 `fileDecisions` 在 `carrier=goal` 分支构造 argv 时只传 `--title` 与 `--origin`：

```
const argv = goalStoreArgv(root, ["write", id, "--title", item.title, "--origin", origin]);
```

而 `packages/quay/src/goal-store.ts:735` 对 GOAL 记录要求 `body` ≥ `MIN_GOAL_BODY_CHARS`(=40) 非空白字符，并明写「`origin` is only a provenance citation, not the body」。⇒ **decision 通道的 goal 载体在构造上不可能落地**：每一条 `carrier=goal` 的决策都以 `exit 2` 失败。`goal-store write` 本身**支持** `--body`（其 usage 行已列出该参数），故缺的是**调用侧参数**，不是 store 能力缺失。

**定因是 before/after 对照，不是解释（硬规则 4 推论四）**：body≥40 要求由 `80d12fe42`（2026-09-08T09:48:13Z，任务 `gap-goal-record-completeness-undefined`）引入。
- **引入前**：2026-09-06T14:40:34Z 一轮经同一代码路径成功落地 `GOAL-006`（轮载体 `decisionsRouted: ["GOAL-006"]`）。
- **引入后**：2026-09-10T09:29:42Z 一轮 `decisionsOffered: 1, decisionsRouted: []`，reason = `goal write failed (exit 2): GOAL-013 is a GOAL record and requires a body of ≥40 non-whitespace chars`；`goals/GOAL-013*` 在盘上不存在。
⇒ 同一代码路径在该提交前后给出**相反**结果 ⇒ 是那次提交的回归，不是偶发。

**为何潜伏 2 天无人撞**：decision 通道全历史只被使用 **4 次**（`.quay/meta-driver-round.jsonl` 全量统计：2 落地 / 2 被拒），其中 `carrier=goal` 只用过 **2 次**——09-06 成功、09-10 失败。低使用频次 ≠ 低严重性，见下。

**为何 goal-driver 不受影响**：body 必填是 **create-only**（`if (!existingFile)`，当初即为放行 driver 的 status-only flip）⇒ 翻状态照常，**只有新建 GOAL 会死**。这解释了为何所有 driver 心跳与 AC 翻转读数全绿而通道已断。

**后果不是「少了个功能」**：decision 通道是 meta-driver 遇到**自身读数盲区**时**唯一**的出路——`autoDrive` 强制 `evidenceKey` 必须在**本轮读数**里解析得出，故一个盲区类问题在构造上不可能走 autoDrive（meta-driver 自己在 META-005 的答复里认出了这一点：「②的失败计数不在我任何现有读数里…无法用 evidenceKey 落地 autoDrive」）。通道坏着 ⇒ 它遇到盲区只能沉默，而**沉默与「没有盲区」在记录上同形**（硬规则 3b）。

**修法**：给 `fileDecisions` 的 goal 分支补 `--body`，并把**正文与出处分离**——新增 `renderDecisionBody(item)` 产出 GOAL 契约要求的三段（背景 / 范围与非目标 / 退出条件），`renderDecisionOrigin` 保持只做出处引用。⛔ 不是把 origin 复制进 body（那会让两字段互为副本，正是 store 契约明文拒绝的形态）。

**相关但不同机制（供追溯，非重复）**：`gap-goal-store-backfill-legacy-empty-body`（done）修的是**存量数据回填**，`if (!existingFile)` 的 create-only 限定也在那条里说明，均不涉及 meta-driver 的调用侧 argv。

## AC

- [x] `node --no-warnings --experimental-strip-types --test plugin/test/meta-driver.test.mjs` exit 0，且其中新增用例断言 `fileDecisions` 的 goal 分支构造出的 argv **含 `--body`** 且其值 ≥40 非空白字符
- [x] `renderDecisionBody` 单测：产出的三段（背景 / 范围与非目标 / 退出条件）各非空、合计 ≥40 非空白字符，且**不等于** `renderDecisionOrigin` 的产出（负控制：两者若相同则测试红——防「把 origin 复制进 body」这种伪修复）
- [x] 端到端经**真 goal-store**（非 mock、非 fixture 注入）跑一条 `carrier=goal` 的 decision ⇒ 目标目录下出现该 GOAL 文件、其 `body` ≥40 非空白字符、命令 exit 0
- [x] **突变负控制**：把 argv 里的 `--body` 去掉后重跑上述用例 ⇒ **必须变红**（证明判据能取假；⛔ 恒绿的检查不算保证）
- [x] `bash scripts/test.sh` exit 0

## DoD

- [x] 一条 `carrier=goal` 的 decision 经**真实 goal-store** 落地成一个 body ≥40 非空白字符的 draft GOAL，且该验证**在关掉任何测试注入缝后仍成立**（硬规则 4 推论三：只能被 fixture/注入满足的判据不是测量，只是回声）
- [x] 失败路径仍 fail-closed 且**取值可区分**：body 不足 / store 拒写时 `decisions[].accepted=false` 且 `reason` 与成功态不同形，并逐条留痕进 `.quay/meta-driver-round.jsonl`（⛔ 不静默吞——本缺陷能被发现正是因为这条留痕已经做对了）
- [x] `GOAL-013`（本次失败的那条决策）的最终去向已在本任务体记明：**已由人手工落地**——人于 2026-09-10T10:10:49Z（commit `19019927b`）将该决策手工落地为 `GOAL-014`（draft，body 三段齐备），其 origin 已逐字记明编号沿革（meta-driver 于 09:29:42Z 尝试落地 GOAL-013 因缺 `--body` exit 2；其后 GOAL-013 被另一会话用于「判据保真性」，故本条改用 GOAL-014）。⛔ 不留悬空。

## Touches

- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-filedecisions-goal-write-omits-body.md`