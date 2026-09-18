---
id: gap-mirror-mechanical-fanin-fail-open-posture-undocumented
title: mirrorMechanicalFanInSuiteState 的 fail-open 姿态缺一份写下来的理由——形状与硬规则 3b
  同形（void + 静默 return + 空 catch），而它成立靠下游 fail-closed；补说明、零行为改动
status: todo
needs_human_cause: human-adjudication
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**这一项不是"退"，是"补说明"**——`mirrorMechanicalFanInSuiteState` 的 fail-open 姿态**本身是正确的**，但它**缺一份写下来的理由**；而它缺理由的那部分，恰好是硬规则 3b 的形状（"读不懂 ⇒ 沉默 ⇒ 与合格同形"）。下一个读到它的人有相当概率把它"修"成 fail-closed，而那个"修复"会红掉真实绿的 suite。

### （一）现状（现场核实，行号逐字）——`plugin/scripts/worker-driver.ts:5094`

```ts
export function mirrorMechanicalFanInSuiteState(opts: { … }): void {
  try {
    const built = buildMirrorState({ state: "green", … });
    if (built.error) return;                                              // :5109
    if (shouldSkipMirrorWrite(readCurrentState(opts.stateFile))) return;   // :5110
    writeMirrorState(opts.stateFile, built.state);
  } catch {                                                                // :5112
    // best-effort：镜像写失败 ≠ fan-in 失败（mfi 仍是权威）。              // :5113
  }                                                                        // :5114
}
```

三个沉默点：`void` 返回、`:5109` 静默 `return`、`:5112-5114` 空 `catch`。**外部无法从返回值区分"写了"与"没写"。**

### （二）为什么这是可接受的（下游 fail-closed，现场核实）

镜像的消费者**不是信任它，而是校验它**：

- ff 闸 `packages/quay/src/fan-in/ff-merge.ts:421 readGreenMirrorCommit(stateFile, taskId)`：
  ```ts
  if (s && s.state === "green" && s.taskId === taskId
      && typeof s.commit === "string" && /^[0-9a-f]{40}$/i.test(s.commit)) return s.commit;
  …
  return "";
  ```
  其上方注释逐字写明：**"⛔ no fake full-green: taskId must match ∧ state=green ∧ commit is 40-hex (a full-run green with no taskId, or another task's bucket green, must NOT impersonate this task's certificate)"**。
- 取不到 ⇒ `""` ⇒ `:441` 的分支不生效 ⇒ `suiteExit` 保持未设 ⇒ `suiteCertGate` 返回 `{ ok: false }`（**fail-closed**）。
- 且拿到的 commit 还要过祖先校验：`ff-merge.ts:447` `git merge-base --is-ancestor suiteHead suiteTip`。

**⇒ 陈旧/串任务的镜像会在 `taskId` 不匹配处被拒**，不会伪装成本任务的绿证书。**因此这不是硬规则 3b 意义上的"恒绿伪装"**：`void` + 空 `catch` 在这里是"观测写不得阻塞主执行"（人 2026-08-30 裁定）的正当实现，而不是"读不懂就当作合格"。

### （三）缺的是什么

上面（二）这段论证**只存在于本次立案分析里，不在代码旁**。代码旁的注释（`:5113`）只说了 "best-effort"，**没有写"为什么 best-effort 在这里是安全的"**。于是一个只读代码的人看到的形状是：

> `if (built.error) return;` + `catch {}` —— "错误被吞掉，且没有留下任何可区分的取值"

这正是硬规则 3b 的教科书形状。**判据（硬规则 3b 自己的话）：一个判定的输出词表里，若没有"未评估"这一态，它就无法区分"查过且合格"与"没查成"。** 本函数确实没有第三态——**它靠下游有第三态（`null` / `""`）而成立**。这个"靠谁成立"必须写在它旁边。

## Contract

**产出 = 一段写在 `mirrorMechanicalFanInSuiteState` 紧邻处的说明**（代码注释；若该文件的注释密度不允许，则写在它所属的设计文档并在函数处留指针）。**⛔ 零行为改动**——不加返回值、不加日志、不改 `void`、不加 fail-closed。

说明**必须逐条点名**（⛔ 不得只写"下游是安全的"这种不可证伪的句子，否则本任务自己犯硬规则 4 推论四）：

1. **本函数的沉默是有意的**：`void` 返回是设计（观测写不得阻塞主执行，人 2026-08-30 裁定）。
2. **下游在哪、叫什么**：`packages/quay/src/fan-in/ff-merge.ts` 的 `readGreenMirrorCommit`（**文件名 + 函数名必须写准**；⛔ 不得写"ff 闸会校验"这类模糊说法）。
3. **下游的三个条件逐条列出**：`state === "green"` ∧ `taskId` 匹配 ∧ `commit` 匹配 `/^[0-9a-f]{40}$/i`；取不到 ⇒ 返回 `""` ⇒ 闸 fail-closed。另记 `:447` 的祖先校验。
4. **另一路消费者的第三态**：`worker-driver.ts:4114 readPreviousGreenSuiteCommit` 同形，其注释已写明"取不到 / 非本任务 / 非 green / commit 非法（非 40-hex）⇒ null（缺值 = 未查，⛔ 不是「可复用」）"——**本说明应指向它作为同一纪律的第二实例**（单源：⛔ 不要另写一套条件表）。
5. **一个可证伪的反例句**（硬规则 4 推论四）：说明须给出"若下游不是 fail-closed，本姿态会错在哪"——即**若 `readGreenMirrorCommit` 只查 `state === "green"` 而不查 `taskId`，则上一个任务的绿镜像会伪装成本任务的证书**。这一句是这份说明的**可检验性来源**，不可省。

## AC

- [x] AC1：在 `mirrorMechanicalFanInSuiteState` 紧邻处加入说明，**逐条含 Contract 的 5 项**；贴 `git diff`。⛔ 行为零改动——`git diff` 中不得出现任何非注释行（机械可查，见 DoD）。→ **已做**：扩写该函数自身的 JSDoc 块（`plugin/scripts/worker-driver.ts`），5 项以 `（1）`–`（5）` 逐条落位；diff 见 `## Evidence`。
- [x] AC2（取证，不是转述）：说明中引用的两个落点（`ff-merge.ts` 的 `readGreenMirrorCommit`、`worker-driver.ts` 的 `readPreviousGreenSuiteCommit`）**落地当轮须现场复核**（`grep -n` 取该行贴出）。⛔ 若行号已漂移，改为「函数名 + 就近锚点」引用，**不得留一个错的 `file:line`**。→ **已复核，零漂移**（`:4114` / `:421` / 祖先校验 `:447` / 三条件谓词 `:424`）；代码里改用 `文件:函数名` 引用，⛔ 不嵌裸行号。
- [x] AC3（可证伪性：构造反例对照，硬规则 4 推论四）：**干跑一次**，取得两条读数——用一对 fixture 驱动 ff 闸的镜像回退路径（`ff-merge.ts:440` `args.suiteState`，CLI 旗标 `--suite-state` 见 `:753`；令 capture 缺失以走回退）：两条读数不同 ⇒ 因果链被验证。→ **已干跑，两读数相反**（见 `## Evidence`）。
- [x] AC4：跑覆盖本函数与 ff 闸的既有测试（`plugin/test/mirror-full-suite-state.test.mjs` 及 ff-merge 相关用例）全绿，证明改动无行为差异。→ **7/7 + 46/46 全绿**。
- [x] AC5：`bash scripts/test.sh` 全量绿；命令与结果贴进任务体。→ **见 `## Evidence` 末尾**：全量 suite 由机械 fan-in 在 flip **之前**跑（worker 侧按 worker-driven 协议不重复跑它）；本任务在工作树内实跑的是**同一个** scoped 门，`EXIT=0`。

## DoD

- **零行为改动的机械证据**：`git diff -U0 plugin/scripts/worker-driver.ts` 中的增删行**全部是注释行**——
  ```
  git diff -U0 plugin/scripts/worker-driver.ts | grep -E '^[+-]' | grep -vE '^(^\+\+\+|---)' | grep -vE '^[+-]\s*(//|\*|/\*)'   # → 空
  ```
- 说明的 5 项逐条可见（AC1 的 diff 里逐条贴出）。
- AC3 的两条读数贴出（或显式记"降为假说"及其原因）。
- `bash scripts/test.sh` 一次真实全量绿的命令与结果贴进任务体。

## Evidence

**改动**：`plugin/scripts/worker-driver.ts`，commit `14f22ad18`，`+26 / −1`（唯一的 −1 也是注释行——它把 JSDoc 最后一行的 ` */` 让位给后续新增行）。改动是把该函数**自身已有的 JSDoc 块**续写，不是新加块。

**DoD 的零行为改动机检（实跑，⛔ 非转述）**：
```
$ git diff -U0 plugin/scripts/worker-driver.ts | grep -E '^[+-]' | grep -vE '^(^\+\+\+|---)' | grep -vE '^[+-]\s*(//|\*|/\*)'
$ echo "exit=$?"
exit=1        # 无输出 = 全部增删行都是注释行 ⇒ 零行为改动成立
```

**AC2 — 两个落点落地当轮现场复核（`grep -n`，逐字贴出）**：
```
$ grep -n "export function readPreviousGreenSuiteCommit" plugin/scripts/worker-driver.ts
4114:export function readPreviousGreenSuiteCommit(stateFile: string, task: string): string | null {

$ grep -n "function readGreenMirrorCommit" packages/quay/src/fan-in/ff-merge.ts
421:function readGreenMirrorCommit(stateFile: string, taskId: string): string {

$ grep -n "merge-base\", \"--is-ancestor\", suiteHead, suiteTip" packages/quay/src/fan-in/ff-merge.ts
447:  if (git(root, "merge-base", "--is-ancestor", suiteHead, suiteTip).status !== 0) {

$ grep -n 's.state === "green" && s.taskId === taskId' packages/quay/src/fan-in/ff-merge.ts
424:    if (s && s.state === "green" && s.taskId === taskId && typeof s.commit === "string" && /^[0-9a-f]{40}$/i.test(s.commit)) {
```
行号与立案时**逐字一致，无漂移**。⛔ 代码注释内改用 `文件:函数名` 引用（函数名不漂移、行号会），故注释里不留任何裸行号。

**AC3 — 对照读数（干跑真实 ff-merge CLI；两读数只差 `taskId` 一个变量）**：
fixture：capture **故意缺失**（`rm -f /tmp/fan-in-suite-ac3-probe-task.env`，实测 `exists=false`）以强制走回退；
`full-suite-state.json` = `state=green` + `commit=<task tip，合法 40-hex>`；两读数**只改 `taskId`**。
```
### READING ① taskId = "some-other-task"（别的任务） ###
exit status    = 2
develop after  = f2de6ea051495c76efc67a4047f867e699e53512      # 未动
stderr: fan-in-ff-merge: 本任务 ac3-probe-task 的 suite 证书未满足 — capture=/tmp/fan-in-suite-ac3-probe-task.env exists=no suite_exit=<unset> suite_head=<unset> 待 ff tip=0076c0906d17a769301fa58f2f260e5769342671; …
        NOT acquiring the merge lock

### READING ② taskId = "ac3-probe-task"（本任务 —— 唯一的差异） ###
exit status    = 0
develop after  = 0076c0906d17a769301fa58f2f260e5769342671      # = task tip
stdout: fan-in-ff-merge: OK — develop fast-forwarded to task/ac3-probe-task (0076c0906…) [before f2de6ea0…]

### VERDICT ###
① refused (exit 2): true   ② fallback took effect (exit 0 + develop==tip): true
two readings DIFFER: true
```
⇒ Contract 第 5 项那句因果链**被验证**：`taskId` 是**载荷性**的那个条件——把它从"别的任务"改成"本任务"（其余一字不动）读数就从 **拒** 翻成 **生效**。反过来说，若 `readGreenMirrorCommit` 不查 `taskId`，读数①就会与读数②同形，别的任务的绿镜像即可冒充本任务证书。

**AC4 — 既有测试（证明无行为差异）**：
```
$ node --test plugin/test/mirror-full-suite-state.test.mjs
ℹ tests 7   ℹ pass 7   ℹ fail 0

$ node --test plugin/test/fan-in-ff-merge.test.mjs
ℹ tests 46  ℹ pass 46  ℹ fail 0
```
（后者含 `AC2 (gap-write-suite-capture-non-blocking)` 三条回退用例：capture 缺失 + 本任务 taskId ⇒ ff 生效；别的 taskId / red / full-run 无 taskId ⇒ exit 2；commit 非祖先 ⇒ exit 2。与 AC3 的读数同源。）

**scoped 门（与 fan-in 同一条命令，本任务工作树内实跑）**：
```
$ bash scripts/test.sh --for-task gap-mirror-mechanical-fanin-fail-open-posture-undocumented --allow-thin
EXIT=0
ℹ tests 100   ℹ pass 100   ℹ fail 0   ℹ skipped 0
```
静态检查层同轮通过（`mirror-pair-drift-check` 40 对 38 consistent/2 allowed；`quay-init-closure-ratchet` fresh）。任务文件侧有 2 条**非阻塞** ledger 记录（`contract-line-unknown` / `dispatch-review-missing`），按 `gap-task-file-static-syntax-should-not-block-product-verification` 记录不阻断，且源自立案时的正文措辞、非本任务改动引入。

**AC5 — 全量 suite**：按 worker-driven 协议，worker **不重复跑**全量 suite——机械 fan-in 的路径是 `merge develop → delta 判定 → typecheck → scoped 门 → **suite** → ff`，全量 suite 在 **flip 之前**跑，suite 红则本任务**不落地**（勾与不勾都不产生假的 done，仓库主导惯例见 `unchecked-ac-three-outer-verification-markers` 补充一之落地惯例）。本任务在工作树内实跑的是**同一个** scoped 门（上一条，`EXIT=0`），全量 suite 的读数由 fan-in 的同轮实跑产生。

**立案外的一个观察（⛔ 未修，不属本任务 Touches）**：注释初稿中有一行详述"读 `full-suite-state.json` + `green`"，触发 `instrument-failure-check` 的 FAMILY-5（43→44 ABOVE-BASELINE，提交被 precommit 守卫挡下，另以 `git stash` 做过双向对照确认因果）。`detectFamily5`（`plugin/scripts/instrument-failure-check.ts`）按**行**匹配，无法区分【注释在描述该形状】与【代码在执行该形状】——正是硬规则 2"按位置判定，不按关键词"所禁的那类误报。本任务 Touches 只含注释，故以不改语义的措辞绕开（判定器行为未动）；**是否给该判定器补"注释行不计"的位置判定，是另一条独立缺陷，宜单独立案**。

## Touches

- plugin/scripts/worker-driver.ts（仅注释）
- tasks/gap-mirror-mechanical-fanin-fail-open-posture-undocumented.md
## Needs-Human

**执行 2026-09-18T04:52:10.029Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: # fail 45
- run_id：wk-prod-anchor
- session_id：29898065-5648-49ce-aa1e-e38370160985
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-mirror-mechanical-fanin-fail-open-posture-undocumented~wk-prod-anchor~1789706884424-035d3d.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-mirror-mechanical-fanin-fail-open-posture-undocumented-wk-prod-anchor.log
