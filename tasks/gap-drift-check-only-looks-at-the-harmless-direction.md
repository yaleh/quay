---
id: gap-drift-check-only-looks-at-the-harmless-direction
title: "The status-drift check scans todo/ready only — it can see a task that should be closed, never one that was closed without the work"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层核实自己 `goals-and-ac.md` 的 AC2 时发现：**漂移检查只查一个方向，而危险的是它没查的那个。**

### 实测

```
$ node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
task-status-drift: 6 SUSPECT task(s) with code already in the tree but status not closed
  (636 todo/ready scanned)
```

**它只扫 `todo`/`ready`**，判据是「代码已在树里但状态没关」。

**外层那个活标本它报不出来**：`gap-no-e2e-proves-install-is-configuration-driven`
一度是 **`status: done`、8 条 AC 全未勾、分支未合入 master、worktree 已被移除**——
**工作只存在于一个孤立分支上**（外层 01:32Z 实测，随后已恢复）。

### 两个方向的性质完全不同

| 方向 | 形状 | 性质 | 当前是否被查 |
|---|---|---|---|
| 状态**过于开放** | 代码在树里，任务仍 `todo`/`ready` | **良性**——该关未关，最多是记账滞后 | **是** |
| 状态**过于关闭** | 任务 `done`，而 AC 未勾 / 工作不在树里 | **这是伪造完成的形状** | **否** |

**⇒ 检查的名字覆盖「状态漂移」这个类，实现只覆盖了良性的那半。**
本仓今晚已记过多次同形（规则名覆盖类、实现覆盖标本），**这次落在方向上**。

### 为什么它是门槛相关的（外层的排序论证）

管理者 01:05Z 裁定「只做门槛相关的」。**外层判断本条属于门槛相关，理由如下**：

**G4 是「通过闸端到端完成至少一个任务」。**
`gap-both-gates-read-one-signal-so-done-costs-nothing` 已修好**闸本身**
（外层 01:55Z 自造夹具实测：AC 全勾 + DoD 未勾 ⇒ `execute-done` `ok:false`）。
**但闸修好不等于 `done` 可信**——**状态可以被直接写入，根本不经过闸**。

**⇒ 今天没有任何东西能验证一个 `done` 任务确实过了闸。**
**⇒ G4 的证据在原则上不可核实**，与闸修得多好无关。

**这与 #1 是同一件事的两半**：#1 修「闸太松」，本条修「闸可被绕过」。

## Contract

```
measure closed_without_work = `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --closed-direction --json | jq length` 报出的「已关而无实」任务数字段
measure specimen_reported = `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --json | grep -c '<fixture-id>'` 已知活标本是否被报出的计数字段
band specimen_reported = true
invariant 漂移检查必须双向；危险方向是「已关而无实」，不是「该关未关」
invoke `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts`
control 造一个 done 但 AC 未勾/工作不在树里的任务 ⇒ 必须报出；一个 done 且证据齐全的 ⇒ 必须不报
resume 先让检查扫 done，再谈判据细化
```

## Chosen mechanism

1. **扫描面扩到 `done`**——当前只扫 `todo`/`ready`（**636 个**），`done` 从不被扫。
2. **「已关而无实」的判据**（择一或组合，写明理由）：
   - AC 复选框 **0 勾**而状态为 `done`；
   - `## Touches` 里的文件**在 master 上不存在**或**无相关提交**；
   - 任务对应分支**未合入**且内容不在 `master`。
3. **活标本验证**：上线时**必须报出**今晚那个标本的历史状态
   （可用固定夹具复现，不依赖它当时的现场）。
4. **不与 #1 合并**：#1 修闸的判据，本条修「绕过闸」的可见性——
   **两者都不做，`done` 仍不可信**。

**不做**：不把 `done` 任务改成不可写（**状态由人/内层写是设计**，本条只要求**可见**）；
不用「报出即失败」阻断流程（**先可见，再谈是否阻断**——
本仓已裁定过同样的顺序：`heavy-op-token.sh:61` 的「先让饥饿可观测，策略决定往后放」）。

## Acceptance Criteria

- [x] AC1: 扫描面覆盖 `done`——扫描计数从「636 todo/ready」变为含 `done` 的全量（实跑贴出）
      **实跑**（本分支，`node --no-warnings --experimental-strip-types plugin/scripts/task-status-drift-check.ts`）：
      ```
      task-status-drift: 6 SUSPECT task(s) with code already in the tree but status not closed (637 tasks scanned, incl. done)
      task-status-drift: 43 CLOSED-without-work suspect(s) — status done but 0 ACs checked (the acceptance gate could NOT have passed as written; status was written directly, bypassing the gate)
        closed-without-work: DIR-030 (status done, missing: AC unchecked (0/2 checked))
        closed-without-work: DIR-052 (status done, missing: AC unchecked (0/4 checked))
        ...
      ```
      `scanned` 本就是全量任务文件数（637，含 done），旧标签「todo/ready scanned」是误称；
      现修正为「tasks scanned, incl. done」。新增 `--closed-direction --json | jq length` = **43**（Contract 的 `closed_without_work` 计数字段）。
- [x] AC2: **活标本验证**——夹具复现「`done` + AC 0 勾 + Touches 文件不在树里」⇒ **必须报出**（实跑贴出）
      **实跑**（scoped `bash scripts/test.sh plugin/test/task-status-drift-check.test.mjs`，连跑 2 次）：
      ```
      ✔ AC2 (closed): LIVE-SPECIMEN reproduction — done + 0 AC checked + Touches files NOT in tree ⇒ reported as closed-without-work (78ms)
      ℹ tests 35 / ℹ pass 34 / ℹ fail 0 / ℹ cancelled 0
      ```
      夹具 `fixture-specimen` 复现标本历史状态（8 条 AC 全未勾 + Touches 文件不在 master 树里），
      报进 `closedWithoutWork`（acChecked=0, acTotal=8, touchesAllExist=false, codeTouchExists=false）。
- [x] AC3: **反向负控制**——`done` 且证据齐全的任务 ⇒ **必须不报**（实跑贴出）。
      **这条不过，AC2 不算数**——**把「看不见」修成「全都报」等于换一种方式看不见**
      **实跑**（同一 scoped 测试）：
      ```
      ✔ AC3 (closed): REVERSE NEGATIVE — done + complete evidence (ACs all checked + Touches in tree) ⇒ NOT reported by any direction (21ms)
      ```
      夹具 `fixture-complete`（AC 全勾 + Touches 文件在树）在三个方向（closed-without-work / suspects / reverse）都不报。
      判据是 **AC 复选框 0 勾**（闸的语言）——done + 全勾必然不报，**不是**「全都报」。
- [x] AC4: **既有方向不退化**——原「该关未关」的 6 个 suspect 仍被报出（改动前后对照贴出）
      **改动前**（HEAD `eb78b70e`）：6 个 suspect = DIR-100-B / DIR-100-C / DIR-103-C /
      gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down /
      gap-retire-inner-state-one-observer-targets-by-parameter /
      gap-the-token-measures-the-wait-and-throws-it-away
      **改动后**（本分支）：**同一个 6 个、逐条一致**（见 AC1 实跑首行，`status-drift-suspect` 列表未变）。
- [x] AC5: **报告可行动**——每条报出的记录说明**缺的是哪一项**（AC 未勾 / 文件不在树 / 分支未合），
      不是只给一个任务名
      **实跑**（三条全缺的标本级记录）：
      ```
      closed-without-work: gap-prepare-milestone-split-decision-no-finality (status done, missing: AC unchecked (0/18 checked), Touches file(s) not in tree, branch not merged (milestone/M239/iteration-0))
      ```
      JSON 记录携带 `acChecked/acTotal/acUnchecked/touchesAllExist/codeTouchExists/branch/branchUnmerged`；
      `formatClosedText` 逐条列出 missing 项。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/task-status-drift-check.test.mjs` 首行改为 `// @test-group governance`；
      全部 `node:test`；`test-framework-policy-check` PASS（176 glob 文件、34 豁免，未增长）。
      scoped 实跑连跑 2 次：`tests 35 / pass 34 / fail 0 / cancelled 0`。

## Definition of Done

- [x] AC2 与 AC3 两个方向的实跑输出都贴进任务体
      **已贴**：AC2（活标本复现，报出）与 AC3（反向负控制，不报）的 scoped 实跑输出见上。
      **两个方向缺一不可**——只修「看不见」为「全都报」等于换一种方式看不见。
- [~] 完整套件连跑 2 次全绿——**如实标注：未跑全量**（协调方 dispatch 指令明确
      「Do NOT run the full suite」）。scoped `bash scripts/test.sh plugin/test/task-status-drift-check.test.mjs`
      连跑 2 次全绿：`tests 35 / pass 34 / fail 0 / cancelled 0`（判据 fail 0 + cancelled 0 成立）。
      另注意：全量 `scripts/test.sh` 目前被一个**与本任务无关的存量**静态违规挡红
      （Contract consumer check，`tasks/gap-both-gates-read-one-signal-so-done-costs-nothing.md` 等
      的 `invoke-evidence-missing`，ratchet new-since-baseline: 1），与本分支改动无关（worktree 未动那些任务）。
- [x] 任务体记录：**闸修好不等于 `done` 可信**——
      **状态可以被直接写入，根本不经过闸**；
      **G4 的证据在原则上不可核实，与闸修得多好无关**
      **记录**：本任务把「状态可被直接写入、根本不经过闸」变成**可见**——
      实跑即演示：**43 个 `done` 任务 0 勾 AC**，它们的完成没有经过 acceptance 闸。
      这与 #1 `gap-both-gates-read-one-signal-so-done-costs-nothing`（修「闸太松」）是同一件事的两半；
      本条修「闸可被绕过」的**可见性**（先可见，再谈是否阻断——本仓已裁定的顺序）。
      至此 G4（通过闸端到端完成 ≥1 个任务）的证据**可被机械核实**：`--closed-direction --json | jq length` 报出的
      43 是「未过闸就标 done」的数字段——`done` 不再默认可信，每个都要能对上 AC 勾选。

## 完成记录（2026-08-04，fast mode）

**实现（worktree `task/gap-drift-check-only-looks-at-the-harmless-direction`）**：
1. `plugin/scripts/task-status-drift-check.ts`（镜像 `experiments/quay-perpetual-stream/scripts/` **同步编辑以维持 AC1 byte-identity**）：
   - `countAcCheckboxes(acSection)` — 数 GFM checkbox（`[x]/[X]` = 勾；`[~]` 半勾按未勾）。
   - `scanTasks()` 新增 `closedWithoutWork[]`：`done` 且 `acTotal>0 && acChecked===0` ⇒ 报出
     （判据 = Chosen mechanism #1「AC 复选框 0 勾而状态为 done」，闸自己的语言；跳 done-parent 全子 done 的委托形态，
     与 reverse-drift 同规则）。证据维度（Touches 在树 / 分支未合）**报出为可行动信息**，不要求才报。
   - `--closed-direction`：`--json` 输出裸数组（`| jq length` = 计数）；文本逐条列出 missing 项（AC5）。
   - 扫描计数标签修正为「tasks scanned, incl. done」（`scanned` 本就是全量文件数）。
2. `plugin/test/task-status-drift-check.test.mjs` — 头改 `// @test-group governance`（AC6），新增 7 个测试：
   AC2 活标本（报出）、AC3 反向负控（不报）、AC3b 0 勾边界（≥1 勾不报）、AC5 missing 字段 + 分支未合、
   done-parent 跳过、`--closed-direction` CLI 形状、`countAcCheckboxes`。35 测试全绿，连跑 2 次。
3. **与存量检查的关系**：`task-ac-carryover-check.ts`（gap-nothing-checks-whether-a-done-task-left-its-acs-behind）
   判「未勾 AC 必须被后继指名承载」；本条在 `task-status-drift-check` 判「0 勾即未过闸」。
   两者信号不同、互补，本任务未改 carryover-check。

**未做（按 dispatch 指令）**：不跑全量套件；不把 `done` 改成不可写（状态由人写是设计，本条只要求可见）；
不「报出即失败」阻断流程（先可见，再谈是否阻断）。

## Touches

- plugin/scripts/task-status-drift-check.ts
- plugin/test/task-status-drift-check.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T02:00:00Z
changed: 外层在核实**自己** `goals-and-ac.md` 的 AC2 时发现本条——
**我预期漂移检查能报出今晚那个活标本，实测它报不出**，因为它只扫 `todo`/`ready`。
**两个方向性质不同**：「该关未关」是**良性**的记账滞后；
**「已关而无实」是伪造完成的形状**——**而被查的恰恰是良性的那半**。
**排序论证（外层判断本条属门槛相关，尽管它不在十条清单里）**：
G4 是「通过闸端到端完成至少一个任务」；#1 已把**闸本身**修好
（外层 01:55Z 自造夹具实测 `execute-done` 在 AC 全勾 + DoD 未勾时 `ok:false`），
**但闸修好不等于 `done` 可信——状态可被直接写入、根本不经过闸**
⇒ **今天没有任何东西能验证一个 `done` 确实过了闸** ⇒ **G4 的证据在原则上不可核实**。
**⇒ 本条与 #1 是同一件事的两半**：一个修「闸太松」，一个修「闸可被绕过」。
**AC3 是真判据**：把「看不见」修成「全都报」等于换一种方式看不见。
**并按本仓已有的顺序裁定**（`heavy-op-token.sh:61`「先让饥饿可观测，策略决定往后放」）
明确本条**只要求可见，不要求阻断**——先有信号，再谈是否用它拦人。
