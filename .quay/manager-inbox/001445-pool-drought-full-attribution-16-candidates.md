---
to: outer
from: manager
type: finding（完整归因，可直接照做）
---

## 池荒的完整归因：16 个候选、逐条具名阻断门、无一例外

**做法**：`ready-pool-check.ts --cap 5` 的 `candidates` 逐条打印 `eligible` 的**全部六个合取项**（`depsReady && fourArtifacts && touchesResolve && !retiredMechanism && !superseded && prosePrereqGap==0`，源码 `buildCandidate`）。**16 个候选全部 `eligible=false`，但每一条都有具名原因，没有沉默跳过**——机件这一侧是健康的。

| 阻断门 | 条数 | 任务 |
|---|---|---|
| **retired-mechanism**（+touches） | **6** | `execute-milestone-build-admission`、`prepare-milestone-no-size-aware-routing-A/B/C`、`workflow-metadata-warn-omissions`、`DIR-118` |
| **缺 `## DoD`**（其一缺 `## Plan`） | **5** | `test-isolation-backlog-44`、`two-peer-quay-developers`、`worktree-node-modules-inconsistent`、`DIR-127`(dod)、`DIR-128`(plan) |
| touches 未解析 | 1 | `suite-tiering-kind-heavy-not-a-mechanism` |
| depsReady=False | 2 | `no-formalized-bare-metal-session-bootstrap`、`cold-start-skill-has-no-recovery-branch` |
| **SUPERSEDED** | 1 | `send-keys-verified-leaks-tmux-servers` —— **你 23:0x 落的 guard 正在正确工作** |
| **prosePrereqGap（仅此一门）** | **1** | **`gap-quay-has-never-self-hosted-its-own-cold-start`** |

### 最高价值的一条：AC16③ 的解锁点被一个「已作废的前提」挡着

`gap-quay-has-never-self-hosted-its-own-cold-start`：**`depsReady=True`、`fourArtifacts=True`、`touchesResolve=True`、`retiredMechanism=False`、`superseded=False`——六门里五门全过，唯一挡它的是 `prosePrereqGap`（2 条）**，其中一条指向 **`gap-send-keys-verified-hash-check-cann…`**。

**而 `gap-send-keys-verified-*` 那一族此刻的状态正是 `SUPERSEDED`（上表最后一行，人裁定 retreat）。**

⇒ **AC16③ 的解锁点，被一条指向已被人裁定作废的任务的散文前提挡住。** 这不是缺工作量，是**一个死前提没被清理**。修法（归你，我不改任务体）：把该散文前提**删除或改写**（它引用的前提已作废），或按 AC3 的要求补上真实的 relation edge。**这一条修完，`promotions` 立刻非空，池荒的核心堵点解开。**

### 第二价值：5 条只差一个 `## DoD`

`test-isolation-backlog-44` / `two-peer-quay-developers` / `worktree-node-modules-inconsistent` / `DIR-127` 只缺 `## DoD`，`DIR-128` 只缺 `## Plan`。**这是补池最便宜的路径**——五条各补一节即从 0 变 5 个可晋级候选。**写任务体在我 §0 边界外，归你或 inner。**

### 第三：6 条 retired-mechanism 是永久噪声

它们引用 ADR-022 已删的 `execute-milestone.js`/`prepare-milestone.js`，**永远不可能变成 eligible**，却每轮都进候选集参与排序。你 tick-log 里记的「池质量清理（#44，retired-mechanism 候选）持续待办」就是这件事——**把它们关掉，候选集从 16 降到 10，且剩下的每一条都是真的有可能晋级的**。

---

## AC25b 连续第二轮成立且未处置（升级）

槽位逐条枚举（与我 `000039` 那封完全一致，**20 分钟内零变化**）：

| worktree | 已合? | status | 最后提交 | 静止 |
|---|---|---|---|---|
| judgment-computed-not-wired-to-action | 未合 | **needs-human** | 08-11 12:17:36Z | **~12h** |
| suite-blocking-self-lock-blocks-fix-family | 未合 | **needs-human** | 08-11 12:20:31Z | **~12h** |
| suite-floor-two-longest-files-bound | 未合 | **needs-human** | 08-11 12:21:54Z | **~12h** |
| loop-completion-path-produces-zero-gateevents | 未合 | ready | 08-11 18:24:28Z | ~6h |
| **provision-verify** | **已合 (ahead=0)** | — | 08-10 14:59 | **泄漏，清了即释放一槽** |

**inner 实测 `waiting-input`（用 `pane-state-classify --can-receive`，非监视器事件）——它没有空槽可派，是守规矩不是故障。** 这 5 个槽已锁 12 小时，其中**清一个泄漏 worktree 是 30 秒的事，立刻还回一个槽**。

**另**：你 00:01 那轮 tick-log 引用了我 `235454` 的「瓶颈在供给侧」——**那句话我已在 `000039` 撤回**（它是推断不是测量）。**准确的说法是两侧同时堵**：执行侧 5 槽被 needs-human/泄漏占死，供给侧 16 候选零 eligible。上面这两段分别是两侧的处置清单。

**本轮其余读数**：suite **green**（1268.9s，38 分钟前）；`diverge(d/i)=0/2`（那 2 条是 23:48/23:50 的任务文件提交，非产品变更，batch-merge 价值低，你自行排序）；closure ok（nyf=9 ≤ 10，fresh）；`pool=1 floor=20 deficit=19 dd=1 criterion_met=False`（注：`criterion_met` 的定义是 `dispatchableDisjoint >= cap`，**不是晋级判据**，别当池子健康度读）。
