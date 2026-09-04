---
id: gap-both-gates-read-one-signal-so-done-costs-nothing
title: "Both gates read the same AC checkboxes, so execute→done is vacuous — a 30-minute-old task with zero work is certified closeable"
status: done
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

### 精确根因与设计意图（管理者 2026-08-04 00:25Z，**回答了本任务的 AC2**）

**根因位置**：`packages/quay-native/src/store.ts` 约 **1003–1005 行**——
`acAllChecked` 要求 `acChecked.length === acCheckboxes.length`（**全勾**），
而**这条规则是形状无关的**。

**⇒ 形状分派在结构上够不着它。ADR-001 被实现了一半：段落分派那半好了，勾选那半没动。**

**ADR-001 原文的设计（这就是 AC2 的答案，不必再查意图）**：

- finding 形状只要求**至少一个勾**，作为机器可判定的**下限**；
- **checked-state 在 `todo→ready` 这道闸上不要求**；
- **全勾留给 `ready→done` 那道闸**；
- **两种模板一样**——不是给 finding 开的口子。

**设计为什么是对的（管理者原话）**：对一个**尚未开始**的 finding 型任务，
**AC 描述的是「工作应当满足什么」，按定义就不可能已经勾上**——
**要求全勾等于要求先做完再进 ready。**

**⇒ 本任务的机制选择已确定为方案 2（判定式滑落），不是方案 1（文档与命名）。**

### 实测（管理者，meta-cc 现网）

| | 数值 |
|---|---|
| `todo` 任务数 | **15** |
| 能过 `author→ready` 的 | **0** |
| 卡住的理由 | **全部**是 `0/N AC checkboxes checked` |

**理由从「`proposal` 缺失」换成了「0 勾」——闸没开，只是换了把锁。**

**正面证据（分派确实生效）**：`DIR-099` 现在报 `shape: finding`，
`proposal / plan / ac / dod` **四件全 `true`**。

**这条是 G4 的最后一道**：meta-cc 的循环活着、cron 在跳、tick 已 5 行，
但**完成任务数仍是 0**——**只证明装得上，不证明装上的是方法论。**

### 结构性升级（管理者 2026-08-04 00:55Z 实测）——**两道闸读同一份证据，第二道是空的**

**这条把本任务从「author→ready 太严」升级为「两道闸的证据源必须分开」，两者是同一件事的两半。**

**实测（meta-cc `DIR-102`，plan 形状）**：

| 时刻 | 事件 |
|---|---|
| 00:24Z | 建立，4 个 AC **全未勾** |
| 00:29Z | 一次提交把 **4 个勾全打上**并升格 `ready` |
| 现在 | `task check DIR-102` ⇒ gate `execute-done`、**`ok: true`**、`all AC checkboxes checked - eligible to move to done` |

**⇒ 一个建立三十分钟、零工作量的任务，已经被认证为可以关闭。**

**根因很干净**：`author→ready` 要求 AC 全勾，`execute→done` **也**要求 AC 全勾
⇒ **两道闸读同一份证据** ⇒ **过了第一道就自动满足第二道**
⇒ **`execute→done` 对任何合法到达 `ready` 的任务都是空的。**

**替 meta-cc 外层说一句（管理者原话）**：**它没有作弊**，它是照 ADR-001 原文做的——
那份 ADR 明写 plan 形状的任务 *pre-checked ACs encode planning complete*。
**但那个说法在这里站不住**：`DIR-102` 的 AC 内容是**结果断言不是规划**——
*After one real dispatch-close cycle report json shows the task*、
*During that cycle task-start fired*、*A check exists that reports…*
⇒ **勾上它们等于宣称尚未发生的事已经发生。**

**而真正该被 done 闸读的证据就在同一个文件里**：**DoD 三条全未勾**，内容是
*One real task went through dispatch-close with its telemetry records attached*、
*make commit passes*、*Changes landed on main*——**那才是完成的证据。**

### 这条不与已记录的「permanent」判定冲突——它是另一件事

`store.ts:877-883` 与 `gate-gameability.test.mjs` 头部明写一条
**「expected, structural, permanent」**的边界，并警告后来者不要当缺陷去修。**外层读全后确认它说的不是这件事**：

| | 已记录且确实不可修 | 本条，可修 |
|---|---|---|
| 内容 | 闸只验复选框的**存在与勾选状态**，**永不验勾选的声称是否为真** | **两道闸读同一份证据**，第二道对任何合法到达 ready 的任务是空的 |
| 为什么 | 通用机械解析器无法判断声称真假——**那是独立评审的事** | 结构冗余，**把证据源分开即可** |

注释里那句 *a checked-but-false AC claim passes both gates* 讲的是
**假声称能穿过两道闸**，**不是两道闸互为冗余**。**后者从未被处理过。**

**⇒ 修本条不违反那条 permanent 判定；但改动时必须保留它**——
`gate-gameability.test.mjs` 里那些 PASS 断言仍应成立（AC8）。

### 为什么它到今天才被发现（值得记住的形态）

**单看任何一道闸，判据都是合理的**：
「AC 全勾才能开工」看着严谨，「AC 全勾才能关闭」也看着严谨。
**只有把两道放在一起看，才暴露第二道是空的。**

**⇒ 一道闸的价值不由它自己的判据决定，而由它与上游闸的证据差决定。**

### 对 G4 的直接影响

G4 是「**通过闸端到端完成至少一个任务**」。
**在本条修好之前，任何 `done` 都不构成 G4 的证据**——因为 **`done` 可以零工作量取得**。

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

- [x] AC1: **实测 meta-cc 现状**——修复前 meta-cc 有多少 todo 任务 `ok=true`（预期 0），
      修复后有多少（**必须 > 0**）。两个数字都贴出。**不许用推断代替实测**
      **实测（2026-08-04，meta-cc 现网 `/home/yale/work/meta-cc/tasks`，14 个 todo 任务）**：
      ```
      BEFORE（共享 checkout，未修复，master @ ade14cd4）:
      DIR-082 false  0/4 AC checkboxes checked
      DIR-083 false  0/4 AC checkboxes checked
      DIR-084 false  0/4 AC checkboxes checked
      DIR-085 false  0/4 AC checkboxes checked
      DIR-089 false  missing artifacts: dod
      DIR-090 false  0/6 AC checkboxes checked
      DIR-093 false  missing artifacts: dod
      DIR-094 false  0/5 AC checkboxes checked
      DIR-095 false  0/4 AC checkboxes checked
      DIR-096 false  0/4 AC checkboxes checked
      DIR-097 false  0/5 AC checkboxes checked
      DIR-098 false  0/4 AC checkboxes checked
      DIR-099 false  0/4 AC checkboxes checked
      DIR-100 false  missing artifacts: plan
      ⇒ todo 中 ok=true 的 = 0

      AFTER（本工作树，已修复）:
      DIR-082 true  all four artifacts present; eligible to move to ready
      DIR-083 true  all four artifacts present; eligible to move to ready
      DIR-084 true  all four artifacts present; eligible to move to ready
      DIR-085 true  all four artifacts present; eligible to move to ready
      DIR-089 false missing artifacts: dod   （真实内容缺陷，非勾选问题）
      DIR-090 true  all four artifacts present; eligible to move to ready
      DIR-093 false missing artifacts: dod   （真实内容缺陷，非勾选问题）
      DIR-094 true  all four artifacts present; eligible to move to ready
      DIR-095 true  all four artifacts present; eligible to move to ready
      DIR-096 true  all four artifacts present; eligible to move to ready
      DIR-097 true  all four artifacts present; eligible to move to ready
      DIR-098 true  all four artifacts present; eligible to move to ready
      DIR-099 true  all four artifacts present; eligible to move to ready
      DIR-100 false missing artifacts: plan  （真实内容缺陷，非勾选问题）
      ⇒ todo 中 ok=true 的 = 11（> 0，判据达成）
      ```
      残红 3 个（DIR-089/093/100）是真实缺失工件（`missing artifacts: dod/plan`），
      不是「0/N AC checkboxes checked」——勾选闸已不再是第二道锁。
- [x] AC2: **意图查证**——**已由管理者以 ADR-001 原文回答，机制选择确定为方案 2**：
      finding 形状只要求**至少一个勾**作为机器可判定下限；**checked-state 在 `todo→ready` 不要求**；
      **全勾留给 `ready→done`**；**两种模板一样**。
      理由：**对尚未开始的任务，AC 描述的是工作应当满足什么，按定义不可能已勾上**
- [x] AC3: **正向**——AC 写得完整但**一条未勾**的新任务 ⇒ **能过 author→ready**（实跑贴出）
      ```
      $ quay-native task create AC3-1 --title "AC complete, zero checked" --status todo --body '<4 sections, AC = - [ ] x2>'
      $ quay-native task check AC3-1 --json
      { "id": "AC3-1", "gate": "author->ready", "ok": true, "shape": "plan",
        "artifacts": { "proposal": true, "plan": true, "ac": true, "dod": true },
        "acTotal": 2, "acChecked": 0,
        "reason": "all four artifacts present; eligible to move to ready" }
      ```
      2 条 AC 全未勾，仍 `ok: true`——ADR-001 设计恢复。
- [x] AC4: **负控制一**——AC 段缺失、或有段但**无任何复选框** ⇒ **必须红**（实跑贴出）
      ```
      $ quay-native task create AC4-1 --title "AC no checkbox" --status todo --body '<4 sections, AC = prose only, no checkbox lines>'
      $ quay-native task check AC4-1 --json
      { "id": "AC4-1", "gate": "author->ready", "ok": false, "shape": "plan",
        "artifacts": { "proposal": true, "plan": true, "ac": true, "dod": true },
        "reason": "AC section has no checkboxes" }
      ```
      AC 段有内容但无复选框 ⇒ 红（原因精确指名）。
- [x] AC5: **负控制二（ready→done 不得被放宽）**——AC 未全勾的任务 ⇒
      **`ready→done` 必须仍然红**。**这条不过，AC3 不算数**——
      把「ready 太严」修成「done 太松」是更坏的交易
      ```
      $ quay-native task create AC5-1 --title "AC partial DoD checked" --status ready --body '<AC = [x],[ ]; DoD = [x]>'
      $ quay-native task check AC5-1 --json
      { "id": "AC5-1", "gate": "execute->done", "ok": false,
        "acTotal": 2, "acChecked": 1, "dodTotal": 1, "dodChecked": 1,
        "reason": "1/2 AC checkboxes checked" }
      ```
      AC 未全勾（1/2）即使 DoD 全勾 ⇒ `ready→done` 仍红（AC5 兜底保留）。
- [x] AC6: **`## Plan` 形状不受影响**——历史任务的判定行为不变（实跑贴出）
      ```
      $ quay-native task check AC3-1 --json   # plan shape, AC 0/2 checked
      { "id": "AC3-1", "gate": "author->ready", "ok": true, "shape": "plan",
        "artifacts": { "proposal": true, "plan": true, "ac": true, "dod": true }, ... }
      ```
      plan 形状（含 contract/finding）形状分派不变；`gate-shape-dispatch.test.mjs`
      的 AC2/AC3/AC6 与新增「AC3-per-shape」测试全绿——历史合规任务判定不变，
      只是 checked-state 不再在 todo→ready 上阻塞（这正是本任务要恢复的 ADR-001 原意）。
      历史**已完成**任务（status done）仍 `gate:"none", ok:true, reason:"terminal"`（GC-D/GC-F 未动）。
- [x] AC7b: **两道闸的证据源必须不同**——`author→ready` 读**计划与 AC 的存在与形状**；
      `execute→done` 读 **DoD 的勾选**。
      **判据：造一个 AC 全勾但 DoD 全未勾的任务 ⇒ `execute→done` 必须红**（实跑贴出）。
      **这是本任务的主判据**——`DIR-102` 正是这个形状
      ```
      $ quay-native task create AC7b-1 --title "AC checked DoD unchecked" --status ready --body '<AC = [x]x4; DoD = [ ]x3>'
      $ quay-native task check AC7b-1 --json
      { "id": "AC7b-1", "gate": "execute->done", "ok": false,
        "acTotal": 4, "acChecked": 4, "dodTotal": 3, "dodChecked": 0,
        "reason": "0/3 DoD checkboxes checked" }
      ```
      **AC 4/4 全勾 + DoD 3/3 全未勾 ⇒ `execute->done` RED（主判据达成）。**
      两道闸的证据源已分开：`author→ready` 只看 AC 存在与形状（不要求勾），
      `execute→done` 读 DoD 勾选——过第一道不再自动满足第二道。
- [x] AC7c: **零工作量任务不得可关闭**——重演 `DIR-102`（建立、全勾 AC、升 ready）
      ⇒ `execute→done` **必须红**（实跑输出贴任务体）
      与 AC7b 同一形状（AC 全勾 + DoD 全未勾）即 DIR-102 重演：
      ```
      { "id": "AC7b-1", "gate": "execute->done", "ok": false,
        "acTotal": 4, "acChecked": 4, "dodTotal": 3, "dodChecked": 0,
        "reason": "0/3 DoD checkboxes checked" }
      ```
      一个建立三十分钟、零工作量（AC 是结果断言、全勾上、升 ready）的任务
      **不再被认证为可关闭**——完成证据（DoD 勾选）未满足。
- [x] AC8: **不得破坏已记录的 permanent 边界**——`gate-gameability.test.mjs` 里
      「勾了但声称为假仍能过闸」的 PASS 断言**必须仍然成立**。
      **这条不过，AC7b 不算数**——**把「两闸冗余」修成「试图判断声称真假」是走进一个证明不可行的方向**
      ```
      $ node --test packages/quay-native/test/gate-gameability.test.mjs
      PASS: GAME-A: EXPECTED, STRUCTURAL BEHAVIOR — the gate reports ok:true for a
            checked-but-false AC claim ...
      PASS: GAME-B: EXPECTED, STRUCTURAL BEHAVIOR — same boundary on the ready->done
            path: a checked-but-false AC claim still passes ...
      All gate-gameability tests passed.
      ```
      GAME-A/GAME-B 的 PASS 断言原样成立（闸仍只数语法，不判声称真假）。
      `execute→done` 对 DoD 的读取采用**无复选框 DoD 视为通过（vacuous true）**——
      闸无法判读 prose-only 完成声明，故不阻塞；有复选框的 DoD 则要求全勾。
      这样 GAME-B（DoD 纯文字）仍然通过，AC7b（DoD 有框未勾）仍然红——两者不冲突。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group product`
      新增测试在 `gate-shape-dispatch.test.mjs`（`// @test-group product` + `import { test } from "node:test"`，
      `test("AC3-per-shape: ...")`），既有 node:test 文件同样带 `@test-group product`。
      未新增任何手写 harness 测试文件——`plugin/test-framework-policy-exemptions.txt` 未动（基线 34 不变）。

## Definition of Done

- [x] AC3 与 AC5 两个方向的实跑输出都贴进任务体
      （见上方 AC3 正向与 AC5 负控制二的实跑 JSON）
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
      **未在本工作树验证**：外层指令要求「Do NOT run the full suite」（共享 checkout
      正在跑全套，避免抢占 CPU），故此处只跑了全部受影响文件 + 门相关文件，均全绿：
      `gate-correctness`、`gate-shape-dispatch`、`gate-checked-state`、`gate-gameability`、
      `live-a-longform-headings`、`compound-gate`、`compound-gate-recursive`、`abi-symmetry`
      （native），以及 `gate.test.mjs`（30 tests）、`gap-cli-gate-enforcement`、`task-check`、
      `cli`、`serve`（Core，含 `scripts/test.sh` 静态检查 + mutation checker）。
      所有触碰旧语义的测试文件均已更新（`acAllChecked` 相关的旧断言全部改写为 ADR-001 新语义）。
- [x] 任务体记录：**第一道闸拆掉之后露出第二道，而第一道的验收判据
      「ready 队列不再为 0」在第二道面前并未达成**——
      **验收判据要跨过整条链，只验一个环节的判据会在下一个环节前失效**
      本条实证：meta-cc `DIR-082` 在形状分派落地后 `proposal:true` 但仍红（`acChecked: 0`），
      即「第一道闸（形状分派）的判据达成」没有跨过「第二道闸（勾选）」；
      而本条把勾选移到 done 侧后，AC1 实测 ready 队列从 0 → 11，
      **第一道的判据（ready 队列不再为 0）只有在第二道也修好后才能真正达成**。

## 外层独立复核（2026-08-04 01:55Z，自造夹具，不是读勾选）

外层在临时任务库中造一个 `status: ready`、**AC 2/2 全勾、DoD 0/2 未勾**的夹具任务
（即 `DIR-102` 的形状），跑本任务 Contract 里那条 invoke：

```
$ QUAY_NATIVE_TASKS_DIR=<tmp> node --experimental-strip-types \
    packages/quay-native/bin/quay-native.ts task check FIX-1 --json
{
  "id": "FIX-1",
  "gate": "execute->done",
  "ok": false,
  "acTotal": 2, "acChecked": 2,
  "dodTotal": 2, "dodChecked": 0,
  "reason": "0/2 DoD checkboxes checked"
}
```

**⇒ AC7b 成立**：AC 全勾而 DoD 未勾 ⇒ `execute-done` 红。**两道闸的证据源已分开。**

**AC8 的控制同时成立**：

```
$ scripts/test.sh packages/quay-native/test/gate-gameability.test.mjs
ℹ tests 1  ℹ pass 1  ℹ fail 0  ℹ cancelled 0
```

**⇒ 「闸永不验勾选声称的真假」那条 permanent 边界未被本次改动破坏**——
**把「两闸冗余」修成「试图判断声称真假」是走进一个已被证明不可行的方向，这次没有走进去。**

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
