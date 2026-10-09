---
id: gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file
title: stop-terminal 停派判词硬编码「attributed none to a
  file」——判定器已读到的失败文件被写成「一个也没归因出来」（实测 3 例）
status: todo
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

- [ ] AC1 判词如实（可得假）：对一条 `failingTestFiles` 非空 且 `signatures` 为空 的判定，`suiteAttributionEvidence()` 的输出**必须点名那些失败文件**，⛔ 不得出现 `attributed none to a file`。对照臂（同一次测试内）：`failingTestFiles` 为空 的判定，该句**仍须**出现。贴两条实际输出字符串。
- [ ] AC2 顺序（可得假）：构造一份「有 `__PERFILE__ … passed=false` 行、无任何 `AssertionError` 行、且该文件在本任务 delta **之外**」的 suite 日志夹具，`judgeRetryExemption` 的 verdict ⛔ 不得是 `insufficient-data-fallback`（必须已算出 delta 相关性）。对照臂：同一夹具把该文件放进本任务 `## Touches` ⇒ verdict 必须是 `own-defect-counted`。两臂 verdict 必须可区分。
- [ ] AC3 文件级复发回退（可得假）：签名取不到时，以**失败文件**为复发身份查跨任务复发；构造「同一文件在窗口内被另**一个**任务也点名为失败文件」的台账夹具 ⇒ verdict 为 `unrelated-flaky-exempt`。对照臂：窗口内只有本任务一条 ⇒ ⛔ 不得豁免（fail-closed 不变）。贴两臂 verdict 与 reason。
- [ ] AC4 不得回归既有三态：`ac-not-checked-shortcircuit` / `own-defect-counted` / `unrelated-flaky-exempt` / `insufficient-data-fallback` 四者在既有测试下全部仍可复现（贴既有测试文件名与 pass 数），且 `decideExitedNotLandedAction` 的 kind 分叉对 `insufficient-data-fallback` 之外的取值仍回 `count-and-retry`。
- [ ] AC5 scoped 门：`bash scripts/test.sh --for-task gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file --allow-thin` exit 0。
- [ ] AC6 生产读数（待外部——落地后）：本任务合入 develop **之后**新产生的 stop-terminal 判词中，「含 `attributed none to a file`」∧「同一轮 `retry_exemptions[0].failingTestFiles` 非空」的组合计数 **= 0**；前基线 **= 3**（见 Finding，三例已具名）。只计本任务落地之后的时间窗，且该计数可由 `## Finding` 给出的那条谓词命令复算、贴出实际输出（待外部）。

## DoD

判词必须改为**读得出就写读得出**：新输出的每一句都要能由 `RetryExemptionJudgment` 的字段复算，⛔ 不得保留任何硬编码的「没读到」断言。AC1/AC2/AC3 三条都必须**双向取假**（各含对照臂），只贴正向臂不算完成。⛔ 不得以放宽 fail-closed 换绿：动作分叉与重试上限语义逐字不变，本任务只改**读数**与**判定顺序**。既有四态测试不得减少、不得弱化。改动落地须经真实任务 worktree 执行与 fan-in；AC6 的生产读数只能在其后产生（待外部）。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-stop-terminal-reason-hardcodes-attributed-none-to-a-file.md