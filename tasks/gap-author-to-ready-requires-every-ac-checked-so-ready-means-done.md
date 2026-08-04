---
id: gap-author-to-ready-requires-every-ac-checked-so-ready-means-done
title: "author→ready requires every AC checkbox checked, so a task can only become ready after it is finished — meta-cc's queue is still 0 behind the shape fix"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**这是第一道闸拆掉之后露出来的第二道。**

[[gap-the-dod-gate-encodes-a-retired-task-shape]] 已落地并生效：形状分派正确、
`## Finding` 现在计入 `proposal`、未知形状 fail-closed。
**但它自己贴出的实跑证据显示 meta-cc 仍然过不了闸**（该任务诚实地贴了失败输出）：

```
$ quay-native task check DIR-082 --json
{ "shape": "finding",
  "artifacts": { "proposal": true, "plan": true, "ac": true, "dod": true },
  "acTotal": 4, "acChecked": 0,
  "reason": "0/4 AC checkboxes checked" }
```

**`proposal` 已变成 `true`（管理者给定的那条判据达成），但闸仍然红——换了个理由。**

外层读码定位到判定式（`packages/quay-native/src/store.ts`，`author->ready` 分支）：

```
const ok = allArtifactsPresent && acAllChecked && contractKeysOk;
```

**`acAllChecked` 要求 AC 全部勾完**，而这一条**先于形状分派就存在**（QN-005 phase 2），
**不是上一条任务引入的**。

### 后果：ready 这个状态失去意义

本仓约定 AC 由**执行者在完成时逐条勾上**（外层今晚建的每条任务都是 `- [ ]` 起手）。
**⇒ 「全部勾完」等价于「这个任务做完了」。**
**⇒ `author→ready` 要求任务先做完才能变 ready ⇒ `ready` ≈ `done`，
这个状态不再表示任何东西。**

而 `todo→ready→done` 三态里，`ready` 本该表示的是
**「写得足够清楚，可以开工了」**——那是作者交付的东西，不是执行者交付的东西。

### 对 meta-cc 的实际影响（这是本条的紧急性来源）

管理者给的验收判据是「**41 个 Finding 模板任务全部可过闸，ready 队列不再为 0**」。
按上面的证据，**DIR-082 仍然不过闸** ⇒ **ready 队列很可能仍是 0**
⇒ **meta-cc 的循环仍然堵着，只是堵在第二道闸上。**

**必须实测确认，不许推断**——外层看不到 meta-cc 的任务库，
AC1 就是这条的判据。

## Contract

```
measure ready_eligible = `quay-native task check <id> --json` 中 ok=true 的 todo 任务数字段
measure ac_checked_ratio = 同一命令输出的 `acChecked/acTotal` 比值字段
band ready_eligible = >0
invariant ready 表示「写得足够清楚可以开工」，不表示「已经做完」
invoke `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check <id> --json`
control 一个 AC 写得完整但一条未勾的新任务 ⇒ 必须能过 author→ready；AC 段缺失或无复选框 ⇒ 必须红
resume 先确认 acAllChecked 出现在 author→ready 是不是本意，再改
```

## Chosen mechanism

**第一步是问「这是本意吗」，不是直接改。**

`acAllChecked` 出现在 `author->ready` 有两种可能，**处置完全不同**：

1. **是本意**（`ready` 在本仓确实表示「已完成待裁定」）⇒
   **那么错的是文档与命名**，应写明 `ready` 的真实语义，并给 meta-cc 一条真正的
   「可开工」判据；**不要动闸**。
2. **不是本意**（QN-005 phase 2 只想要求「AC 可机械检查」，即**至少有复选框**，
   却写成了「全部勾上」）⇒ **判定式应改为「存在至少一个复选框」**，
   `acAllChecked` 移到 `ready→done` 那一侧。

**外层倾向 2**，理由：同一文件里已有一条**独立**的失败分支专门处理
「有产物但没有复选框」（`allArtifactsPresent && !acHasCheckbox`），
**说明作者本来就把「有复选框」和「全勾上」当成两件事**；
把后者放在 author→ready 更像是滑落而非设计。**但这需要查 QN-005 的原始意图后再定。**

**不做**：不给 `task check` 加旁路/`--force`（与
[[gap-the-dod-gate-encodes-a-retired-task-shape]] 的裁定一致——本条的立案理由同样是「闸被绕过」）；
**不改任何任务的内容去迁就闸**（人已裁定）；
不在未确认意图前直接删 `acAllChecked`。

## Acceptance Criteria

- [ ] AC1: **实测 meta-cc 现状**——修复前 meta-cc 有多少 todo 任务 `ok=true`（预期 0），
      修复后有多少（**必须 > 0**）。两个数字都贴出。**不许用推断代替实测**
- [ ] AC2: **意图查证**——`acAllChecked` 出现在 `author->ready` 是不是 QN-005 的本意，
      给出证据（提交信息 / 测试 / ADR），并据此选择机制 1 或 2，**写明理由**
- [ ] AC3: **正向**——AC 写得完整但**一条未勾**的新任务 ⇒ **能过 author→ready**（实跑贴出）
- [ ] AC4: **负控制一**——AC 段缺失、或有段但**无任何复选框** ⇒ **必须红**（实跑贴出）
- [ ] AC5: **负控制二（ready→done 不得被放宽）**——AC 未全勾的任务 ⇒
      **`ready→done` 必须仍然红**。**这条不过，AC3 不算数**——
      把「ready 太严」修成「done 太松」是更坏的交易
- [ ] AC6: **`## Plan` 形状不受影响**——历史任务的判定行为不变（实跑贴出）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group product`

## Definition of Done

- [ ] AC3 与 AC5 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**第一道闸拆掉之后露出第二道，而第一道的验收判据
      「ready 队列不再为 0」在第二道面前并未达成**——
      **验收判据要跨过整条链，只验一个环节的判据会在下一个环节前失效**

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/gate-correctness.test.mjs
- packages/quay-native/test/gate-shape-dispatch.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T00:15:00Z
changed: 外层在核实 [[gap-the-dod-gate-encodes-a-retired-task-shape]] 的预登记判据时发现本条。
**上一条任务做得对且诚实**：形状分派实现忠实（注释逐字写着 `dispatch is not a waiver`、
未知形状 fail-closed），**并且它把 DIR-082 仍然失败的输出原样贴进了任务体**——
**没有隐藏，这一点很重要**。
**但它的 AC6 被勾上了，而 AC6 的后半句「41 个全部可过闸、ready 队列不再为 0」
被它自己贴出的证据否定**（`acChecked: 0` ⇒ `ok=false`）。
**外层判定：不重开上一条**——它的范围是形状分派，那部分做完了且做对了；
**新建本条**承接第二道闸。
**本条的第一步是问「这是本意吗」而不是直接改**：`acAllChecked` 出现在 `author->ready`
可能是设计（那时该改的是文档与命名），也可能是滑落（那时该改判定式）。
**外层倾向后者并给了证据**：同一文件里已有一条独立分支处理「有产物但没有复选框」，
**说明作者本来就把「有复选框」和「全勾上」当成两件事**。
**AC5 是真判据**：把「ready 太严」修成「done 太松」是更坏的交易。
**AC1 明令不许推断**：外层看不到 meta-cc 的任务库，
**「ready 队列不再为 0」必须实测，这正是上一条栽的地方**。
**教训写进 DoD**：**验收判据要跨过整条链**——
只验一个环节的判据，会在下一个环节前失效。
