---
id: gap-ac194-reflog-action-vocabulary-incomplete
title: "AC-194 判据再变假：develop reflog 出现第三种 ref-level 落地拼法（`branch: Reset
  to`）不在分类词汇表内 ⇒ 2 条 unclassifiable ⇒ NOT-EVALUATED fail-closed（GOAL-007 三例之③
  的第二次「前提变更」）"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-194
---
## Proposal

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（三例之③）。本任务是 GOAL-007 题面（「判据变假而无人重评」）的**第二次实测实例**，来源是 goal 层每 ~42s 的 gate 报出 `fail`。

**当前读数（2026-09-15，生产工作树，逐字贴出非转述）**：

```
$ node packages/quay/src/goal-store.ts gate AC-194
  "verdict": "fail",
  "reason": "acceptance failed (exit 1) — AC-194 fail - plugin/scripts/direct-to-develop-bypass-check.ts
             did not pass (--baseline develop~100) unclassifiable-commits-in-range"

$ node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts \
    --root . --baseline develop~100 --json
  exit=3  evaluated=false  ok=true  reason="unclassifiable-commits-in-range"
  unclassifiableCommits=2
  classification={classified:98,total:100,ratio:0.98,firstParent:100,offSpine:566}
  unclassifiableSample=["bd24951b1e769bc3600aac3e7107f286306c502d",
                        "017d4f8f44e64b81f3b21d26461997b64a866fde"]
```

**根因（位置判定，不是推测）**：这 2 条正是 develop 最近的两个 tip。develop reflog 头三行：

```
$ git reflog show develop --format='%h %gd %gs' | head -3
bd24951b1 develop@{0} branch: Reset to HEAD
017d4f8f4 develop@{1} branch: Reset to HEAD
4c7a5509c develop@{2} push
```

`plugin/scripts/direct-to-develop-bypass-check.ts:394` 的 `isReflogFanIn` 只认 `push`（:395 `s === "push"`）与 `/Fast-forward/` 两种落地拼法；`:408` 的 `buildFanInBrackets` 因此对这两条既不产 `faninTips` 也不产括注 ⇒ `:429` `classifySpineLandingMode` 落到 `unclassifiable` ⇒ 硬规则③b fail-closed ⇒ `expect: exit 0` **结构上不可达**。判据的真值没变（没有 commit 在 develop 上被创建），变的是**读面**：`git branch -f develop <target>` 与 `git push . src:develop` / `git merge --ff-only` 在 DAG 上完全同形——都只把 develop ref 移到**已存在的** commit，都不创建 commit。

**两条都是纯快进、无历史改写（实测，非主张）**：`git merge-base --is-ancestor 4c7a5509c bd24951b1` ⇒ YES（4c7a5509c 是 bd24951b1 的祖先）。两次移动 `4c7a5509c→017d4f8f4→bd24951b1` 全部前向。

**该拼法的原文由探针实测**（⛔ 不凭记忆）：`git branch -f <b> 017d4f8f4` ⇒ `branch: Reset to 017d4f8f4`；`git branch -f <b> HEAD` ⇒ `branch: Reset to HEAD`，与 `develop@{0}/{1}` 逐字一致。

**为什么这条拼法会出现在生产上（不是野路子）**：`git branch -f develop <sha>` 是本仓库既有的 develop 落地/修复惯用法。meta-cc 会话记录里有把它当**同步兜底**的实例（2026-09-10，orangevps 第三方项目，逐字：`git fetch . main:develop 2>&1 || git branch -f develop main`）；常驻测试名也写着 "(no manual `git branch -f`)"（`plugin/test/driver-third-party-fixture.test.mjs:229`）。**5b 扫描（本任务当场跑，贴计数）**：`git reflog show develop --format='%gs' | sed 's/:.*//' | sort | uniq -c` ⇒ `push` 3217 / `commit` 432 / `merge task/<id>…` 多条 / `branch` **3**。即 `branch:` 形历史上一共出现 3 次（第三次是 `develop@{1558} branch: Reset to adea4c8d9…`，不在本窗），只有最近 2 次落进 `develop~100` 窗。

**与上一次修复的关系（为什么它没守住）**：`gap-ac194-bypass-check-unclassifiable-window`（done）把 unclassifiable 从 449 归零，做法是「first-parent spine + reflog 括注」——但**落地词汇表仍写死在 `isReflogFanIn` 的两种拼法上**，而常驻测试 `plugin/test/direct-to-develop-bypass-check.test.mjs:971-981` 逐字钉住旧词汇（含 `isReflogFanIn("reset: moving to HEAD~1")===false`），对「生产会写出第三种拼法」**结构上不可能发现**（硬规则④推论三：只能被 fixture 满足的判据不是测量；4c：判据的量须穿过所有中间层，这次的中间层是 reflog 的 action 词汇表本身）。所以本次除修分类外，**必须让「未分类的 action 形」在失败发生的那一刻被点名**，而不是让下一个人再从 `unclassifiable-commits-in-range` 反推。

**方向**：把分类从「两种拼法的白名单」改成**按结构判定**——action 以 `commit` 开头 ⇒ 直投（RED）；其余属于「把 ref 移到已存在 commit」的形 ⇒ **ref-level 落地**（与 `push` 同类，GREEN）；其余一律 `unclassifiable`（fail-closed 一律不放松）。ref-level 落地必须**可见而非静默豁免**：独立计数 + 其带入窗内的 first-parent commit 清单（`rev-list --first-parent P..T`）及这些 commit 的 code-surface 标记，⛔ 不得并入 fan-in 计数（那会把「不知道」伪装成「合格」）。

## Plan

1. **探针实测（⛔ 不凭记忆写字面量）**：在 `/tmp` 临时仓库对每种 ref-level 移动各跑一次，记录 git 写出的 reflog action **原文**：`git branch -f <b> <sha>`、`git branch -f <b> HEAD`、`git push . <src>:<b>`、`git fetch . <src>:<b>`、`git merge --ff-only`、`git reset --hard <sha>`（`<b>` 被检出时）。把命中原文逐条贴进任务体（硬规则②：引用一个计数前先打印它匹配到的实际内容）。
2. 改 `plugin/scripts/direct-to-develop-bypass-check.ts`：
   - 新增 pure 判定 `classifyReflogAction(gs)` → `"direct"` | `"refMove"` | `"unknown"`（按结构：`commit` 前缀 ⇒ direct；步骤 1 实测到的「移到已存在 commit」形 ⇒ refMove；其余 ⇒ unknown）。**判定只留一份**：`isReflogFanIn`/`buildFanInBrackets` 改为消费它（重命名或退役二选一，⛔ 不得两份谓词并存漂移）。
   - `buildFanInBrackets` 的 tip/括注改按 `refMove` 产（括注仍是 `P..T` 的 first-parent 集合，语义不变）。
   - `--json` 新增可读数：`classification.refMoveIntroduced`（每条 refMove 带入窗内的 first-parent sha 清单 + 各自是否 code-surface）、`classification.unclassifiedActionForms`（`[{form, count, sampleShas}]`）、`classification.nonForwardRefMoves`（P 非 T 祖先 ⇒ `P..T` 为空）。
   - **失败 reason 必须点名根因**：存在未分类形时 `reason` 为 `unsupported-reflog-action: <form>`（保留既有 `unclassifiable-commits-in-range` 作为并列信息），⛔ 不再只报计数。
   - 非前向 refMove（rewind）不得被计为「带入了 commit 的落地」（其引入集为空），且必须在输出中单独可见。
3. 更新文件头注释（落地拼法清单 + 三态语义），并更新 `plugin/scripts/capability-catalog.sh` 中 `[direct-to-develop-bypass-check.ts]` 的**失效前提**行——原文只写了「直接提交 = reflog action=commit 与 fan-in 的 merge … Fast-forward 可区分」，已不完整。
4. 双向负控制实跑并贴输出：正 —— `gate AC-194` 由 fail（本任务已记录）→ pass（`evaluated:true`、`unclassifiableCommits:0`、两条 tip 出现在 refMove 读数里）；反 1 —— `commit:` action 的 code-surface 直投 ⇒ 仍 exit 1；反 2 —— 喂一条未知 action 形 ⇒ 仍 exit 3 且 reason 点名该形；反 3 —— rewind 形 `branch: Reset to <older>` ⇒ 不计为带入 commit 的落地且输出可见。
5. 常驻测试 `plugin/test/direct-to-develop-bypass-check.test.mjs`：新增四条（每种实测拼法一条 + 未分类形点名一条 + rewind 一条），把 `:971-981` 钉住旧词汇的断言改为按结构判定；新用例在改动前红、改动后绿。
6. 变异用例 `plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh`：增一条 refMove 形 ⇒ GREEN、未知形 ⇒ NOT-EVALUATED 的分支（保持 checker「能取假」有常驻证据）。
7. `node packages/quay/bin/quay.ts task check gap-ac194-reflog-action-vocabulary-incomplete --json` 的 `missing` 为 `[]`。

## AC

- [ ] `node packages/quay/src/goal-store.ts gate AC-194` 在生产工作树 `verdict: "pass"`（贴输出，含 checker 的 `evaluated:true`、`unclassifiableCommits:0`）——⛔ 不是 fixture 注入、⛔ 不是把 `expect` 放宽
- [ ] 根因在失败那一刻可见（能取假的一半）：同一 checker 对含未知 action 形的输入仍 exit 3（NOT-EVALUATED），且 `reason` **逐字点名该 action 形**（改动前只报 `unclassifiable-commits-in-range` 计数，需事后取证才定位）
- [ ] 真直投仍红：回放/注入 `commit:` action 的 code-surface 直投 ⇒ 仍 exit 1（贴输出）
- [ ] 落地拼法由实测确定并贴出：探针仓库逐种跑出的 reflog action **原文**贴在任务体里（⛔ 无凭记忆字面量）；且 `git reflog show develop --format='%gs' | sed 's/:.*//' | sort | uniq -c` 里**每一种形**都有归属（贴计数）
- [ ] refMove 可见而非静默豁免：`--json` 给出 refMove 带入窗内的 first-parent sha 清单及 code-surface 标记——本次两条 tip `bd24951b1…`/`017d4f8f4…`（后者触 `plugin/scripts/registry-bare-filename-scan.ts`，是 code-surface）逐条可见，⛔ 不并入 fan-in 计数
- [ ] rewind 负控制：`branch: Reset to <older-sha>`（P 非 T 祖先）不被计为「带入 commit 的落地」（引入集为空）且在输出中单独可见
- [ ] 常驻测试：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs` 全绿；新增用例在改动前红（贴前后）
- [ ] `node packages/quay/bin/quay.ts task check gap-ac194-reflog-action-vocabulary-incomplete --json` 的 `missing` 为 `[]`

## DoD

`node packages/quay/src/goal-store.ts gate AC-194` 在生产工作树 `verdict: pass`，读的是真实 develop 载体（`unclassifiableCommits: 0`，两条 tip 在 refMove 读数里逐条可见）——不是把 `expect` 从 exit 0 放宽、不是把 refMove 静默豁免进 fan-in、不是只在 fixture 下 pass。同时证明判据仍能取假：未知 action 形 ⇒ exit 3 且 reason 点名该形；`commit:` code-surface 直投 ⇒ exit 1。常驻测试与变异用例都钉住 refMove 形与未知形两个方向。仅让 fixture 绿而生产 `gate AC-194` 仍 fail ⇒ 不算完成。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（结构判定 + refMove 读数 + 未分类形点名）
- plugin/test/direct-to-develop-bypass-check.test.mjs（实测拼法 + 未分类点名 + rewind 用例）
- plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh（refMove GREEN / 未知形 NOT-EVALUATED 分支）
- plugin/scripts/capability-catalog.sh（失效前提行：落地拼法清单）
- tasks/gap-ac194-reflog-action-vocabulary-incomplete.md（自身）
