---
id: gap-batch-merge-bypassed-integration-batch-merge-script
title: 批量合 integration→develop 绕过了
  integration-batch-merge.sh——7b1ac3a1（06:07:22）是 在主检出上 merge + HEAD 移动 +
  06:08:19 reset 完成的，而脚本头部自述 REF-LEVEL（git update-ref CAS / 临时 worktree
  merge），绝不碰主检出工作树；绕过路径丢掉脚本全部保护：CAS、共享文件冲突自动解、 真代码冲突
  fail-closed（author/committer 同 Yale Huang，三个 agent 同身份无法区分，不猜是谁）
status: needs-human
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**批量合 integration→develop 绕过了 `integration-batch-merge.sh`——一批合出现在主检出上，
不是脚本的 REF-LEVEL 路径。**

### 实测（管理者 2026-08-08 报告，外层独立复核）

合并 `7b1ac3a1`（2026-08-08 06:07:22 +0000，Merge integration→develop）：

- `git reflog HEAD -2`：
  ```
  HEAD@{0}: reset: moving to HEAD          ← 06:08:19 的 reset
  HEAD@{1}: 7b1ac3a1                        ← 主检出上的 merge
  ```
- `git reflog develop -1`：`7b1ac3a1 develop@{0}: `（merge 发生在 develop 的 reflog 里）
- 对照脚本头部（`plugin/scripts/integration-batch-merge.sh:36-37`）自述：
  "The helper performs a REF-LEVEL fast-forward (`git update-ref` with a CAS on the old develop tip)
  or a REF-LEVEL real merge (temp worktree → merge → CAS update-ref), so it **never touches the primary
  working tree** and never needs `integration`/`develop` checked out."

⇒ 实际路径是**在主检出上 merge、HEAD 移动、随后 reset**——绕过了脚本自带的三重保护：
1. **CAS**（`git update-ref` 对旧 develop tip 的比较交换——防止并发覆盖）；
2. **共享文件冲突自动解**（touch-declaration 不精确时靠它兜底）；
3. **真代码冲突 fail-closed**（`integration` 非 develop 后代且无 `--merge` / 真冲突 → 退出非 0、不移动任何 ref）。

author/committer 都是 Yale Huang（三个 agent 共用同一 git 身份），该字段无法区分是谁做的——外层不猜。

### 为什么这是缺陷

脚本的存在意义就是让「批量合」这一共享检出敏感操作走 REF-LEVEL（CAS + 不碰主工作树），
从而与并发安全、fail-closed 保证绑定。绕过它 = 这批合并没有 CAS、没有冲突保护、
在主检出留了 HEAD 移动 + reset 痕迹——下一批并发合可能与它冲突且无法被 CAS 发现。

### 范围

立项。根因是「谁、以什么路径执行了批量合」没有机械可查的执行者识别——`reflog` 只能事后看，
批量合是否走脚本没有 gate 拦。归属外层/内层设计：是否加"批量合必须通过脚本"的机械检查
（如合并前断言 `integration-batch-merge.sh` 的调用痕迹 / reflog 形态）。

## Contract

```
measure batch_merge_via_script = `git reflog develop -10 | grep -cE "reset: moving to HEAD"` stdout 数字段
band batch_merge_via_script = 0（修复后批量合不留主检出 reset 痕迹；当前=1 是绕过证据）
invoke `git reflog develop -10`
control 对照：脚本 REF-LEVEL 路径的合并不留主检出 reset；绕过路径留下（已实测 HEAD@{0}=reset）
resume 若中断，先跑 measure 确认 reflog 形态，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **绕过消除**——批量合 integration→develop 走 `integration-batch-merge.sh`（REF-LEVEL），
      主检出 reflog 无 `reset: moving to HEAD` 痕迹、无主检出 merge
- [ ] AC2: **执行者可查**——批量合是否走脚本有机械可查的识别（reflog 形态 / 脚本调用痕迹 / 日志），
      不再只能事后人工看
- [ ] AC3: 与 gap-merge-exposed-contract-violations-in-done-tasks（合并后首验暴露）、
      a862c914 merge 交叉标注——同类「合并路径未被机械看守」族

## Definition of Done

- [ ] AC1-AC3 实跑输出贴任务体（reflog 对照：绕过路径 vs 脚本路径）

## Touches
- plugin/scripts/integration-batch-merge.sh（或调用侧：批量合必须走脚本的机械检查）
- plugin/loop/orchestrator-loop-tick.md（3b 批量合步骤：加"走脚本"断言）
- tasks/gap-merge-exposed-contract-violations-in-done-tasks.md（AC3 交叉标注）

## Withdrawal (2026-08-08 07:1x)

**前提不成立，撤回。** 管理者 2026-08-08 实测复核后撤回原判定：
- reflog 的「空动作名 + reset: moving to HEAD」是脚本 REF-LEVEL 路径的**合法副作用**——脚本 291/358 行
  `git update-ref refs/heads/develop <new> <old>`（CAS 直接改 ref），而主检出正 checkout 在 develop 上，
  ref 被从下面换掉 → 主检出 HEAD 指向随之改变 → reset 是收拾动作。**不是手工 merge 的签名。**
- 脚本注释「never touches the primary checkout」说的是**不在主检出里执行 merge 操作**，不是
  ref 变动不会波及主检出 HEAD——之前把「不会在主检出执行」读成了「主检出不会有任何痕迹」。
- 批量合实际**走的就是脚本**（d8b35747 经 integration-batch-merge.sh --sync REF-LEVEL 完成，
  integration 重新成为 develop 祖先，与脚本路径一致）。

**结论：本任务前提（绕过脚本）不成立。** 若需保留，应改写为「reflog 形态的判定判据」类任务
（如何从 reflog 区分 REF-LEVEL 副作用 vs 真绕过），而非「绕过已发生」。

## 交叉标注（gap-batch-merge-gate-reads-stale-green，2026-08-08）

本任务（batch-merge-bypassed，已撤回——reflog 形态是 update-ref 副作用非绕过）与 stale-green 是批量合
家族两面：bypassed 管「批量合是否走脚本」（执行者识别，撤回后归 reflog 判据），stale-green 管「批量合
闸门判绿是否新鲜」（时间轴）。批量合的机械保护三件套：**闸门**（`gap-batch-merge-gate-reads-stale-green`，
何时合——新鲜度）/ **对象**（`gap-batch-merge-gate-validates-tip-not-merge-result`，合什么——合并结果）/
**执行路径**（本条，怎么合——走脚本 REF-LEVEL）。`integration-batch-merge.sh` 同时承载前两件（
`check_freshness_gate()` + `check_object_gate()`），执行路径由脚本 REF-LEVEL 语义保证。

## Dispatch review

reviewer: none
at: 2026-08-08T06:2xZ
changed: 管理者 2026-08-08 报告（7b1ac3a1 非脚本做的，主检出 merge+reset）；外层独立复核 reflog
  （HEAD@{0}=reset / HEAD@{1}=merge）与脚本头部 REF-LEVEL 自述——初判绕过证据成立。
  **2026-08-08 07:1x 撤回**：管理者实测复核推翻（reflog 形态 = update-ref 副作用非绕过），
  外层二次核实 reflog（develop@{1} 空动作名 + HEAD reset）与脚本 291/358 行 update-ref——撤回成立。
