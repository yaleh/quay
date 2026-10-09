---
id: gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file
title: stop-terminal 停派判词硬编码「attributed none to a
  file」——判定器已读到的失败文件被写成「一个也没归因出来」（实测 3 例）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**停派判词与判定器自己的读数相反。** `plugin/scripts/worker-driver.ts` 的 `suiteAttributionEvidence(exemption)` **硬编码**了 `parser extracted 0 of N failing lines and attributed none to a file`，⛔ 从不读 `exemption.failingTestFiles`。于是当判定器**读到了**失败文件、只是因为日志里没有 `AssertionError` 行而取不到断言签名时（`judgeRetryExemption` 在「signatures.length === 0」处**提前返回** `insufficient-data-fallback`），写进 `## Needs-Human` 的判词却说「attributed none to a file」。

**实测发生率（硬规则 12：先给读数，不给前置）**：`.quay/worker-round.jsonl` 全量 **45** 条 `stop-terminal` 中，**41** 条为「could not be attributed to any failing test file」；其中 **3** 条的判词写「attributed none to a file」**而同一轮 `retry_exemptions[0].failingTestFiles` 非空**（点名了 ≥1 个失败文件）：

- `2026-09-23T16:05:21Z` `gap-ac179-criterion-cmdline-port-literal-stale`（16 个失败文件）
- `2026-10-07T08:22:28Z` `gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script`（`plugin/test/task-granularity-advice.test.mjs`；exemption reason「no assertion signature extracted from the suite log」）
- `2026-10-09T02:48:17Z` `gap-direct-to-develop-bypass-check-git-fixture-cost`（`plugin/test/shipped-entry-runnable.test.mjs`；同上 reason）

一条命令可复算：以 `stop-terminal` ∧ 判词含 `attributed none to a file` ∧ `retry_exemptions[0].failingTestFiles` 非空 为谓词扫 `.quay/worker-round.jsonl`。

**为什么危险**：这是硬规则 3b 的教科书形态——「读不懂输入」与「读到了但归不了类」**共用同一句输出**，且方向相反。人读到「attributed none to a file」会去找解析器缺陷（2026-10-09 manager 复核一开始正是如此，花了数轮才推翻），而真相是「日志确实点名了文件，只是该文件与本任务无关」。它把一个**可豁免的外来 flake** 写成 `infra/contract suspected, not an implementable defect`，把外来红记成不可修缺陷。

**同源的第二处（判定顺序）**：`judgeRetryExemption` 把「断言签名」闸排在「delta 相关性」闸**之前**——`signatures.length === 0` 处提前返回，而 `classifyDeltaRelatedness` 在其**后**。对**整文件死掉**的红（spawn 失败 / ENOENT / OOM / 超时；日志里没有 `AssertionError`），相关性**从不被计算**，哪怕该文件明显不在本任务 delta 内。⇒ 这一类恒落 `insufficient-data-fallback`，两轮即 `stop-terminal`（`decideExitedNotLandedAction` 只对 `insufficient-data-fallback` 走 stop-terminal）。

**粗一级的证据已在手却未被动用**：同一文件跨**不同任务**复发，本身就是「外来 flake」的证据。`aggregateRerunFlakes()` **已经在算它**（按失败文件聚合、跨任务计数），但其自身注释写明它是「只读观测面，不参与任何控制流」。⇒ 签名取不到时，应以**文件**为复发身份回退。

**⚠️ 本条不主张放宽 fail-closed**：动作不变（照常计数、照常受重试上限约束）。主张的是**读数如实**（判词不得说反话）与**顺序正确**（能算的相关性先算）。

## AC

- [x] AC1 判词如实（可得假）：对一条 `failingTestFiles` 非空 且 `signatures` 为空 的判定，`suiteAttributionEvidence()` 的输出**必须点名那些失败文件**，⛔ 不得出现 `attributed none to a file`。对照臂（同一次测试内）：`failingTestFiles` 为空 的判定，该句**仍须**出现。贴两条实际输出字符串。
- [x] AC2 顺序（可得假）：构造一份「有 `__PERFILE__ … passed=false` 行、无任何 `AssertionError` 行、且该文件在本任务 delta **之外**」的 suite 日志夹具，`judgeRetryExemption` 的 verdict ⛔ 不得是 `insufficient-data-fallback`（必须已算出 delta 相关性）。对照臂：同一夹具把该文件放进本任务 `## Touches` ⇒ verdict 必须是 `own-defect-counted`。两臂 verdict 必须可区分。
- [x] AC3 文件级复发回退（可得假）：签名取不到时，以**失败文件**为复发身份查跨任务复发；构造「同一文件在窗口内被另**一个**任务也点名为失败文件」的台账夹具 ⇒ verdict 为 `unrelated-flaky-exempt`。对照臂：窗口内只有本任务一条 ⇒ ⛔ 不得豁免（fail-closed 不变）。贴两臂 verdict 与 reason。
- [x] AC4 不得回归既有三态：`ac-not-checked-shortcircuit` / `own-defect-counted` / `unrelated-flaky-exempt` / `insufficient-data-fallback` 四者在既有测试下全部仍可复现（贴既有测试文件名与 pass 数），且 `decideExitedNotLandedAction` 的 kind 分叉对 `insufficient-data-fallback` 之外的取值仍回 `count-and-retry`。
- [x] AC5 scoped 门：`bash scripts/test.sh --for-task gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file --allow-thin` exit 0。
- [x] AC6 生产载体回放（双向取假）：以 `.quay/worker-round.jsonl` 中 `## Finding` 具名的 3 条既有实例（2026-09-23 `gap-ac179-criterion-cmdline-port-literal-stale` / 2026-10-07 `gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script` / 2026-10-09 `gap-direct-to-develop-bypass-check-git-fixture-cost`）为输入，跑**改动后**的停止判词生成路径，产出文本里「attributed none to a file」的出现次数必须 **= 0**（前基线 = 3）。对照臂：同一批输入跑**改动前**的实现（本任务分支的父提交），必须复现 **3**。两臂各贴实际命令与实际输出，⛔ 不是转述。

## DoD

判词必须改为**读得出就写读得出**：新输出的每一句都要能由 `RetryExemptionJudgment` 的字段复算，⛔ 不得保留任何硬编码的「没读到」断言。AC1/AC2/AC3 三条都必须**双向取假**（各含对照臂），只贴正向臂不算完成。⛔ 不得以放宽 fail-closed 换绿：动作分叉与重试上限语义逐字不变，本任务只改**读数**与**判定顺序**。既有四态测试不得减少、不得弱化。改动落地须经真实任务 worktree 执行与 fan-in；AC6 回放的是**既有**生产台账（真实记录，⛔ 不是夹具），两臂都必须贴实际输出。

## Evidence

**实现**（分支 `task/gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file`，worktree `/data/home/yale/work/quay-worktrees/gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file`）：`632ce5502`（实现）+ `034a9ddf9`（测试逐臂打印证据）。改动只在 `plugin/scripts/worker-driver.ts` + `plugin/test/worker-driver.test.mjs` 两文件。

**AC1** — `suiteAttributionEvidence()` 两臂实际输出（测试自带打印，⛔ 非手抄）：
- 臂 A（`failingTestFiles` 非空）: `parser attributed 2 failing file(s) in this round: plugin/test/whole-file-dead.test.mjs, plugin/test/another-dead.test.mjs (of 3 failing line(s) parsed)`
- 臂 B（`failingTestFiles` 为空）: `parser extracted 0 of 3 failing lines and attributed none to a file`
- 另有走生产路径的一臂（`judgeRetryExemption` → `decideExitedNotLandedAction` 的 stop-terminal 判词）：判词点名 `plugin/test/whole-file-dead.test.mjs`，⛔ 不含 `attributed none to a file`。

**AC2** — 同一夹具两臂 verdict + reason（只差该失败文件是否在本任务 `## Touches`）：
- 臂 A（在 delta 外）: `unrelated-flaky-exempt` — `this round's suite log carried no assertion signature, so recurrence used the failing-file identity: file(s) plugin/test/whole-file-dead.test.mjs were attributed to this round but are outside this task's Touches/diff, and recurred across ≥2 distinct tasks in window (other: gap-b)`
- 臂 B（在 Touches 内）: `own-defect-counted` — `failing test plugin/test/whole-file-dead.test.mjs is in this task's Touches/diff (own defect)`
- ⛔ 两臂均非 `insufficient-data-fallback`，且两臂 verdict 互异。

**AC3** — 三臂 verdict + reason：
- 臂 A（另一任务同点名**同一文件**）: `unrelated-flaky-exempt` — `… file(s) plugin/test/whole-file-dead.test.mjs … are outside this task's Touches/diff, and recurred across ≥2 distinct tasks in window (other: gap-b)`
- 臂 B（窗口内只有本任务）: `insufficient-data-fallback` — `failing file(s) plugin/test/whole-file-dead.test.mjs are outside this task's Touches/diff, but no assertion signature was extracted from the suite log and the failing-file-identity recurrence fallback found no cross-task evidence (cannot attribute; fail-closed count; no other suite-red attempt in window to compare against)`
- 臂 C（另一任务点名**别的**文件）: `insufficient-data-fallback` — `… 1 other suite-red attempt(s) in window, 1 carried recorded failing-file lists and none named a file this round attributed`
- ⛔ 臂 B/C 均不豁免（fail-closed 不变：照常计数 + 有界重试 + 停派，动作语义逐字未动）。

**AC4** — 既有测试逐文件实跑（`node --no-warnings --experimental-strip-types --test <file>`）：
- `plugin/test/worker-driver-retry-classification.test.mjs` **30/30**（四态取值全在：`insufficient-data-fallback` / `own-defect-counted` / `unrelated-flaky-exempt` / `ac-not-checked-shortcircuit`）
- `plugin/test/worker-driver-fan-in-s04.test.mjs` **10/10**（硬规则 3b 四态测试**逐字未改**，仍绿）
- `plugin/test/worker-driver-fan-in-s03.test.mjs` **10/10**、`plugin/test/worker-driver-fan-in-s07.test.mjs` **15/15**、`plugin/test/worker-driver.test.mjs` **129/129**
- kind 分叉：新增测试 `AC4（kind 分叉不回归）` 对 `ac-not-checked-shortcircuit` / `own-defect-counted` / `unrelated-flaky-exempt` / `static-phase-attributed` 四值逐一断言仍回 `count-and-retry`。

**AC5** — `bash scripts/test.sh --for-task gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file --allow-thin` ⇒ **EXIT=0**（scoped 静态检查全绿 + 129 pass / 0 fail）。

**AC6** — 生产载体回放（两臂实际命令与实际输出）：
- 命令：`node --no-warnings --experimental-strip-types /tmp/sde-ac6-replay.mjs`（读主检出 `.quay/worker-round.jsonl`；AFTER 臂 import worktree 的 `plugin/scripts/worker-driver.ts`；BEFORE 臂 import `git show 1025ab9512de3e7b260214d2360a4b035ca80957:plugin/scripts/worker-driver.ts`（= 本任务分支父提交）落到 worktree 内的临时副本；两臂都走公开入口 `decideExitedNotLandedAction` 的 stop-terminal 判词生成路径，用一个「只提供一条更早的归因不出 prior」的最小 root 走到该分支。）
- step 1/2 扫描（谓词 = `## Finding` 逐字）：`stop-terminal ∧ 判词含 «attributed none to a file» ⇒ 4 条`；其中 `∧ retry_exemptions[0].failingTestFiles 非空 ⇒ 3 条`（= 前基线 3）。
- 回放输入构造（逐字段可核）：`verdict` 与 `suiteFailingLines` ← 该轮 stop 记录（`exited_not_landed_stops[].verdict` + 同一轮判词里的 `0 of N failing lines` 的 N——driver 内存里的 N 未持久化，但其读数逐字写在同一轮判词里）；`failingTestFiles` ← 该轮 `retry_exemptions[0]`（`## Finding` 谓词点名的那个字段）。
- BEFORE（父提交）: 3 条判词各出现 1 次 ⇒ **TOTAL occurrences of "attributed none to a file": 3**
- AFTER（改动后）: 3 条判词各出现 0 次，改为点名文件（如 `parser attributed 1 failing file(s) in this round: plugin/test/task-granularity-advice.test.mjs (of 4 failing line(s) parsed)`）⇒ **TOTAL occurrences of "attributed none to a file": 0**
- ⚠️ 如实标注两点：①2026-09-23 那一轮的 `retry_exemptions[0]` 是**同轮的另一任务**（`gap-ac288-…`，16 个失败文件），而该轮 stop 判词文本由 stop 任务自身（`gap-ac179-…`，其 `failingTestFiles=[]`）产生——`## Finding` 的谓词是**轮级**的，回放按它点名的 `retry_exemptions[0]` 取输入；②同谓词另有一条（2026-09-29 `gap-ac292-…`）其 `rex[0].failingTestFiles` 为空，不属具名的 3 条，故未计入。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file.md
