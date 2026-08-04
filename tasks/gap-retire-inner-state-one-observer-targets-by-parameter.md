---
id: gap-observers-are-split-by-layer-not-by-surface
title: "The two observers are split by inner/outer in their names but by session/workspace in their code — the missing target parameter is what forces 3 mounts instead of 1"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

来源：`orchestration/SPEC-one-observer-two-surfaces.md`（**人 2026-08-04 的裁定**）。
人的原话：**观测应当用统一的工具，仅用参数调整行为。**

### 实测：命名说的是「内层/外层」，代码做的是「会话面/工作区面」

外层独立复核（`git grep` 对文件，**不扫进程**——避开本仓今日已栽四次的自匹配）：

| | `session-liveness.sh` | `inner-state.sh` |
|---|---|---|
| 行数 | **714** | **136** |
| `capture-pane` | 2 | **0** |
| `transcript` | 51 | **0** |
| `tmux` | 5 | **0** |
| `git` | **1**（:565 `git -C "$root" log -1`） | 5 |

**`inner-state.sh` 里 `tmux` 出现 0 次。**
`inner` 这个词在它里面只出现在**命名与注释**（外层按「含该词的行数」量得 11 行；
管理者按「出现次数」量得 17 次——**单位不同，不是分歧**）。

**脚本内没有任何机制要求被观测对象是内层**：
`INNER_STATE_WORK_ROOT`（:10）注释逐字写着 **「test seam for inner-state.test.mjs's」**，
:19 是 `cd "${INNER_STATE_WORK_ROOT:-$_INNER_STATE_DEFAULT_ROOT}"`
⇒ **生产调用从不设它，目标写死为主 checkout**。

**⇒ 它监测的是「一个正在跑快速模式的 checkout」——而外层的 checkout 也是。
真实划分是会话面 vs 工作区面，不是内层 vs 外层。**

### 后果：3 个挂载是参数缺失逼出来的，不是设计需要

| 工具 | 目标怎么给 | 三个项目要几个挂载 |
|---|---|---|
| 会话面 | `SESSION_TARGETS` **多目标参数** | **1** |
| 工作区面 | **写死主 checkout** | **3** |

**同一件事，一个工具做一次、另一个做三次，差别只在有没有参数。**

### 边界渗漏

`REPO-STALL`（**9 处**）与 `tick-log`（**3 处**）都长在 `session-liveness.sh` 里，
而 `inner-state.sh` 里两者均为 **0**。
`SESSION_HEARTBEATS` 读的 `tick-log.md` 同样是仓库信号。
**⇒ 两个工具都在读仓库 ⇒ 可能对同一件事给出不一致判断，而没人会发现。**

### 本任务推翻一条既有的「外层判定」——理由不是它错了，是它的前提到期了

`session-liveness.sh:20-25` 有一条明确的旧判定：**「改名为 REPO-STALL、不改源、不移出」**，
三条理由逐字如下，**逐条说明为什么现在不再成立**：

| 旧理由 | 现在的状态 |
|---|---|
| 1. 本工具已按项目轮询，多带一个仓库信号**边际成本为零** | **失效**：AC2 给工作区工具加了多目标参数后，仓库信号有了自己的常驻宿主；继续留在会话工具里**不再是零成本，而是两个工具都读仓库**——正是上面那处渗漏 |
| 2. 改成**会话面**信号只会与 `SESSION-IDLE` 重复 | **不适用**：新裁定不是把它变成会话面信号，是把它归到**工作区面** |
| 3. **移出需要另造一个常驻宿主，当前没有** | **前提被移除**：AC2/AC3 造出来的正是这个宿主 |

**⇒ 旧判定在当时是对的。本任务不是纠正一个错误，是它的第 3 条理由到期了。**
**这一段必须留在任务体里**——否则下一个人读到文件头那三条理由，会把它改回去。

## Contract

```
measure mount_total = `ps -eo args | grep -cE '[s]ession-liveness.sh|[w]orkspace-state.sh'` 的挂载进程数字段
measure git_in_session_tool = `grep -cE 'git ' plugin/scripts/session-liveness.sh` 的命中数字段
measure surfaces_self_sufficient = `bash plugin/scripts/workspace-state.sh --once && bash plugin/scripts/session-liveness.sh --once` 各自单独跑时本面结论是否完整的布尔字段
band mount_total = 2
invariant 同一件事只有一个工具，目标靠参数给；两个面各自自足，谁都不必读另一面的数据
invoke `bash plugin/scripts/workspace-state.sh --once`
control 只跑工作区工具 ⇒ 仍能给出完整的仓库面结论；只跑会话工具 ⇒ 仍能给出完整的会话面结论
resume 先加多目标参数并改名，再移仓库信号，最后验挂载数
```

## Chosen mechanism

**逐条落地 SPEC 的 AC1–AC5，顺序不可颠倒**（先给宿主，再搬东西）：

1. **AC1** `inner-state.sh` 更名为反映实际观测对象的名字（如 `workspace-state.sh`）。
2. **AC2** 工作区工具接受**多目标参数**（如 `WORKSPACE_ROOTS`，**与 `SESSION_TARGETS` 同形**：
   每行 `<名字> <路径>`）。**同形是关键**——两个工具的参数写法不同，就等于没统一。
3. **AC3（可判的收口）** AC2 之后，三个项目由 **1 个**工作区挂载覆盖，
   **总挂载数从 7 降到 2**。**这个数字就是判据。**
4. **AC4** 仓库面信号全部归工作区工具——`REPO-STALL` 与 `tick-log` 心跳从 `session-liveness` 移出；
   移出后 **`session-liveness.sh` 里 `git` 的命中数为 0**（**当前基线是 1**，:565）。
5. **AC5（负控制）** 两个工具**各自单独跑**都能给出完整的本面结论，
   **谁都不需要读另一面的数据**；**做不到就说明面没切干净**。

**明确不做（人的原话）**：**不要把两个脚本合并成一个。**
会话面要解析 tmux 与 transcript、工作区面要跑 git，**代码本来就该不同**。
**「统一工具」指的是「同一件事只有一个工具、目标靠参数给」，不是「所有观测塞进一个文件」。**

**另外不做**：不趁改名顺手扩大工作区工具的信号集（本任务只搬既有的两个仓库信号）；
不保留 `inner-state.sh` 作为兼容别名而不加说明（**留一个不说明的别名，就是留一个会被继续用的旧名字**）。

## Acceptance Criteria

- [ ] AC1: `inner-state.sh` 更名，新名字反映**实际观测对象**（工作区/checkout），
      **旧名字的处置写明**（删除，或保留为别名并标注「已更名，理由 X」）
- [ ] AC2: 工作区工具接受多目标参数，**格式与 `SESSION_TARGETS` 同形**（每行 `<名字> <路径>`），
      **不同形即判不通过**
- [ ] AC3: **可判的收口**——三个项目由 **1 个**工作区挂载覆盖，
      **`mount_total` 从 7 降到 2**（改动前后两个数字都实测贴出）
- [ ] AC4: `REPO-STALL` 与 `tick-log` 心跳移入工作区工具；
      **`session-liveness.sh` 的 `git` 命中数从 1 变为 0**（实跑输出贴任务体）
- [ ] AC5: **负控制（面是否切干净）**——**只跑工作区工具**⇒ 给出完整仓库面结论；
      **只跑会话工具**⇒ 给出完整会话面结论；**两者都不读另一面的数据**（两个方向都贴）
- [ ] AC6: **反向负控制（信号不得丢失）**——移动前后，
      `REPO-STALL` 在**同一个真实场景**下仍然会被报出（实跑输出贴任务体）。
      **这条不过，AC4 不算数**——**把边界渗漏修成信号丢失是更坏的交易**
- [ ] AC7: **旧判定的处置**——`session-liveness.sh` 文件头那三条「不移出」的理由
      **必须一并更新或删除**，不得留在原地与新行为矛盾
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC5 与 AC6 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体保留**旧判定为什么到期**那张表——
      **只写「现在要移出」而不写「当初为什么不移」，下一个人会照文件头的理由改回去**

## Touches

- plugin/scripts/inner-state.sh
- plugin/scripts/session-liveness.sh
- plugin/test/session-liveness.test.mjs
- plugin/scripts/quay-init.sh

## Dispatch review

reviewer: outer
at: 2026-08-04T00:25:00Z
changed: 人的裁定经管理者转达。**外层逐项复核，用 `git grep` 对文件而非扫进程**——
避开本仓今日已栽四次的自匹配（管理者两次、外层两次）。
**核对结果与管理者一致，两处需要写明的差异**：
其一，**`git` 在 `session-liveness.sh` 里是 1 处不是 0**（:565 `git -C "$root" log -1`）——
外层第一次用窄模式漏了它；**AC4 的基线因此是 1→0，不是 0→0**，
**基线写错的判据等于没有判据**。
其二，`inner` 的计数差异是**单位不同**（外层量「含该词的行数」11、管理者量「出现次数」17），
**不是分歧**。
**外层发现并处理了一件管理者未提的事**：`session-liveness.sh:20-25` 有一条**既有的外层判定**
明确写着「改名为 REPO-STALL、**不改源、不移出**」，并给了三条理由。
**本任务推翻它，但理由不是它错了**——逐条查过：理由 2（会与 SESSION-IDLE 重复）**不适用**
（新裁定归的是工作区面不是会话面）；理由 1（边际成本为零）**失效**
（有了多目标宿主后，留在会话工具里就是两个工具都读仓库）；
**理由 3（移出需要另造常驻宿主，当前没有）的前提被 AC2/AC3 直接移除**。
**⇒ 旧判定在当时是对的，到期的是它的第 3 条理由。**
**这一段与 AC7 一起写进任务**——**只写「现在要移出」而不写「当初为什么不移」，
下一个人读到文件头那三条理由会把它改回去**。
**AC6 是外层新增的真判据**：把边界渗漏修成信号丢失是更坏的交易。
**人的「不做」原样保留并加了解释**：不合并两个脚本——
统一指的是「同一件事只有一个工具、目标靠参数给」，不是「所有观测塞进一个文件」。
