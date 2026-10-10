---
id: META-013
title: 请裁定：一个任务三轮 exited-not-landed 的根因是一条【自指恒假】AC 判据（grep 的 token
  就在它自己那一行里）；AC-356 实际已 achieved、goal 已合并——需作者一行改词，执行者不可代改
status: proposed
handler: meta-driver
---
**只报告、不代裁** —— 阻塞点是我自己任务的 AC 文本，改它属作者面，不在执行者授权面内。已按纪律**未勾选、未改词、未自标 `（待外部）`**。

## 一、现象：同名任务第三次 exited-not-landed，理由逐字相同

`gap-ac356-criterion-environment-fatal-window-check-unsatisfiable`（status `ready`，AC 7/8）：

```
worker-outcome.jsonl  11:12:52  exited-not-landed  short_circuit=ac-not-checked
                      11:19:31  exited-not-landed  short_circuit=ac-not-checked
本轮（第三次派发）驱动头逐字：AC 未全勾（checked 7/8，剩余未勾 1）——续做只需验证并勾选 AC
```

fan-in 自己的闸读：

```
$ node --experimental-strip-types plugin/scripts/fan-in-ac-completion-gate.ts \
    --task gap-ac356-… --worktree …/quay-worktrees/gap-ac356-… --json
{"ok":false,"status":"fail","total":8,"checked":7,"unchecked":1,
 "message":"AC 未全勾（checked 7/8，剩余未勾 1 含非待外部项）——未翻 done"}
```

## 二、根因：那条 AC 的判据【结构上恒假】——它 grep 的 token 就在它自己那一行里

AC7 逐字：

```
- [ ] 无 corpus pin 变红：`grep -rn 'efIdx,efIdx+400' . | grep -v node_modules | grep -v '^./goals/'` 为空；读数进 `## Evidence`。
```

**该行自身含 `efIdx,efIdx+400`** ⇒ `grep -rn '<token>' .` 必然命中 `tasks/<本任务>.md`。实测（本轮）：

```
主检出 /data/home/yale/work/quay        命中 8 条
任务 worktree …/gap-ac356-…             命中 8 条
  全部是散文引用：本任务体 :27（Proposal 代码围栏）/ :64（AC2 行）/ :70（**AC7 本行**）/
                  :139 :278 :282 :283 :310（Evidence，上一轮所写）＋
                  tasks/goal-035-needs-human-transition-unify.md:93（已 done 的兄弟任务 Evidence）
可执行载体（plugin packages scripts orchestration experiments）：**0**
```

⇒ **AC 声明的性质是真的**（旧窗口片段已不在任何可执行载体里），但**它写的谓词在任一树上都不可能为空**。这正是硬规则 4（结构上不可能取真的读数不是测量）+ 硬规则 3b 镜像（仪器读不懂输入时返回了与「违规」同形的值）。

## 三、为什么现有机制没拦住它（这是可修的那一半）

`ready-pool-check.ts` 的 `UNSATISFIABLE_AC_DECLARATION_PHRASES` 是一个**闭集短语表**
（`不得由执行者代写` / `只能由人` / `合入 develop` / **`落地后`** …）。本条的形态是**自指 grep**，
**不在表内** ⇒ todo→ready 闸放行（`promotion-outcome.jsonl`：10:57:07 `todo->ready ok`）⇒ 进了 `ready`。
按硬规则 2（按位置判定）该形态只有 1 例（`grep -lE 'slice\([a-zA-Z]+, *[a-zA-Z]+\+' goals/*.md` ⇒ 1）
⇒ **不凭单例立新检测器**（硬规则 12），此处仅作观察项上报，⛔ 请不要 autoDrive 建一条新机制任务。

## 四、必须一并报告：本任务的实际目标【已经达成】，且求值根已变

上一轮以后发生了实质变化（上一轮的 Evidence 里没有这些读数）：

| 读数 | 值 |
|---|---|
| `…/quay-worktrees/goal-GOAL-035` | **已不存在**（`ls` ⇒ No such file or directory） |
| 原因 | `5752fa5e9 merge: goal/GOAL-035 into develop` |
| `quay goal show AC-356 --json` → `status` | **`achieved`**（`goal-driver` "I2: criterion pass"，`2026-10-10T11:07:41.616Z`） |
| `quay goal gate AC-356 --dry-run --root /data/home/yale/work/quay` | `verdict: "pass"`，`evaluationRoot: /data/home/yale/work/quay`（**已是主检出**，不再是 goal 工作树） |
| 记录里的 `criterion` | 已是**修好的**那份（含 `efIdx=wfText.indexOf("backoff.cause === \\x22environment-fatal\\x22")`） |

⇒ **本任务的 DoD（「AC-356 由 FALSE 变 TRUE」）已满足，判据修复已 landed 到 develop、AC-356 已 achieved。**
任务落不落地**不再有任何功能损失**，剩下的纯粹是这条 AC 的记账。

## 五、我为什么没有自己解开它（三条都试过，都不可做）

1. **⛔ 不勾** —— 判据字面为假，勾上就是把「没测到」记成「测到了」（硬规则 3b）。
2. **⛔ 不改词** —— 把 AC 改窄到能勾，是**作者**的决定；执行者改自己被判的判据，
   正是 `unsatisfiable-ac-requiring-authoring-loops-the-worker-driver` 禁止的自证形态。
3. **⛔ 不自标 `（待外部）`** —— AC7 不是「等一个外部绿轮」，它是**仪器坏了**；
   标注会让 `fan-in-ac-completion-gate` 判 `pass-external` 而放行，那才是真正的伪装。

## 六、请求的裁定（一行即可，作者/人）

三选一，都不需要我再改任何东西：

- **(A) 改词**（推荐，最小）：把 AC7 谓词换成可满足的仪器，例如
  `grep -rn 'efIdx,efIdx+400' plugin packages scripts orchestration experiments` ⇒ `0`（已实测 0）。
- **(B) 认账**：裁定 AC7 按「可执行载体为空」这一读数**已满足**，直接勾（本任务随即落地）。
- **(C) 关闭**：既然 AC-356 已 `achieved`、goal 已合并，把本任务作为 superseded 关掉。

⛔ **请不要重复立案**：这是同一条任务本身，没有第二个缺陷可立；
⛔ 也请不要据此给「自指 AC」建检测器（第四.三节：单例，硬规则 12）。

## 七、我这一侧的可核事实

- 本轮**未改任何 `plugin/scripts/**`、`plugin/test/**`、`packages/**`**；未重启任何生产进程；未合并 `goal/GOAL-035`。
- 任务 worktree 已 `git merge --no-edit develop`（干净，无冲突、无未合并路径）。
- 我**没有跑 scoped 门**，也**没有**写 scoped-gate cache：驱动对 ac-not-checked 走 `short_circuit`（见第一节两条 outcome），
  fan-in 在 ac-precheck 就停，跑门不会改变本轮结论 —— 若你认为该门仍需跑，请回我一句我再补。
