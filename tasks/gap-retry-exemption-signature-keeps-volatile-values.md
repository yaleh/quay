---
id: gap-retry-exemption-signature-keeps-volatile-values
title: 重试豁免判不出复发：签名归一化只折叠空白，pid/ms/路径留在签名里 ⇒ 同一缺陷跨任务产生不同签名 ⇒ 已判「与本任务无关」的 suite
  red 仍被计入该任务重试上限
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
depends_on: []
---
## Finding

**一句话**：重试豁免机制（`judgeRetryExemption`）会把一个**它自己已判定「与本任务 delta 无关」**的 suite red **照样计入该任务的重试次数** —— 因为它的复发判据是 AssertionError 的**逐字文本签名**，而最常见的那类失败（断言里带 pid / 毫秒 / 路径）**每次运行都产生一个新签名** ⇒ 「≥2 个不同任务命中**同一**签名」**结构上永不成立**。结果是：这个为「不相关 flaky 不该压垮受害任务」而造的机制，对最需要它的那一半失败恒空（硬规则 4：一个结构上不可能取真的判据，不是测量）。

### 机制（读码可得，本轮已逐行核过）

- `plugin/scripts/worker-driver.ts` 的 `assertionSignaturesFromSuiteLog`：正则取 `AssertionError(…): (.+)$` 后**只做空白折叠**（`.replace(/\s+/g, " ")`）⇒ **pid、毫秒数、路径、端口全部留在签名里**。
- `recurringSignatureTasks`：「窗口内命中**同一签名**的**其它**不同任务 id 并集」⇒ 签名逐字不等 ⇒ 空集。
- `judgeRetryExemption`：空集 ⇒ `verdict = "own-defect-counted"`（fail-closed 照常计数）。

### 干跑读数（本轮实测，⛔ 非引述、非构造）

**同一个生产缺陷、同一台机、同一天、同一个测试文件**，在**3 个任务**的 suite log 里各产生了一个签名（逐字）：

```
gap-quay-server-lightweight-peer-identity-spike  05:30  未确认存活 ⇒ 非零退出：started: supervisor pid=2765126 kind=promotion run_id=dr-ac4-short driver pid=2765880 confirmed_ms=1045
gap-ac203-two-distinct-kinds-no-production-run   06:51  未确认存活 ⇒ 非零退出：started: supervisor pid=955396 kind=promotion run_id=dr-ac4-short driver pid=955909 confirmed_ms=1044
gap-ac203-two-distinct-kinds-no-production-run   06:13  慢启动的确认耗时确实 > 窗口(1s)：confirmed_ms=530
```

⇒ **3 条互不相同**。第二、三条其实是**同一个缺陷的两种表现**（都是 `plugin/test/driver-runtime.test.mjs` 的 AC4），却连彼此都不匹配。

对本人所在任务的两条真实 outcome 记录逐条跑 `judgeRetryExemption`（读 `.quay/worker-outcome.jsonl`，非构造）：

```json
{"verdict":"own-defect-counted",
 "reason":"failing tests unrelated to this task's delta, but the assertion signature did not recur across ≥2 distinct tasks in the window (fail-closed count)",
 "failingTestFiles":["plugin/test/driver-runtime.test.mjs"],
 "signatures":["未确认存活 ⇒ 非零退出：started: supervisor pid=955396 kind=promotion run_id=dr-ac4-short driver pid=955909 confirmed_ms=1044"],
 "recurredTasks":[]}
```

⇒ **机制在同一句话里同时说了两件事：「failing tests unrelated to this task's delta」（判词认了与我无关）∧ 按 `own-defect` 计数。** 两句之间的分叉点**只有**签名复发这一个条件。这就是本条的缺陷面。

### 影响面（发生率不是推测）

- 2026-09-13 04:42–07:09 的 **5 次 `step=suite` 的 `exited-not-landed`** 里，**4 次是同一个文件** `plugin/test/driver-runtime.test.mjs`，跨 **3 个任务**（`gap-quay-server-lightweight-peer-identity-spike` / `gap-ac203-two-distinct-kinds-no-production-run` ×2 / `gap-checker-mutation-check-has-no-change-tier-companion`）——**这 4 次全部按 own-defect 计数**。
- `RETRY_CAP_DEFAULT = 3` ⇒ 受害任务第 3 次因这个无关文件失败即被翻 `needs-human`（本人所在任务本轮已 **2/3**）。
- 一般形态：**凡断言文本含易变量的失败都拿不到豁免**；而在本仓库这类断言极常见（pid / ms / 时长 / 路径 / 端口）。⇒ 豁免只对「文本逐字稳定」的失败生效，正是最不需要它的那一半。

### 候选修法（⛔ 留给出题者判定；本条不预设）

1. 签名归一化时把**易变量折叠为占位**（数字串 → `N`、十六进制 → `HEX`、绝对路径 → `P`）。
2. 或把复发判据从「签名文本」换成「（失败文件, 断言模板）二元组」。

⚠️ **两种都必须配双向控制**：同一缺陷跨任务 ⇒ **必须**豁免；两个**不同**缺陷 ⇒ **必须不**豁免。少了后者就会把「归一化过度」变成「假豁免」——那是硬规则 3b 的镜像面（不得把「读不懂/读不准」变成「合格」，这里是把「不同」变成「同一」）。

⛔ **不属于本条**：`plugin/test/driver-runtime.test.mjs` 为什么红（那是生产缺陷，已另立 `gap-driver-start-false-confirms-unsettled-driver`）。**本条只治「红了之后被算到谁头上」**——两者机制不同，⛔ 不合并。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver-fan-in.test.mjs
- tasks/gap-retry-exemption-signature-keeps-volatile-values.md

## Acceptance Criteria

- [x] AC1（能取假·改前读数）：贴出**同一缺陷在 ≥2 个不同任务上产生的签名互不相同**的真实读数（签名文本 + 各自出处 log 路径），并逐条跑 `judgeRetryExemption` 得到 `own-defect-counted` + `recurredTasks: []`。⛔ 不得用构造的 outcome 记录代替现场记录。

> 读数（改前语义 = develop 的 `worker-driver.ts`，逐条跑现场记录，出处 `.quay/worker-outcome.jsonl`；suite log 在 `/home/yale/work/quay/.quay/`）——**同一缺陷（`driver-runtime.test.mjs` AC4）4 条互不相同的签名，跨 4 条记录 / 3 个任务**：
> ```
> 05:30:45Z gap-quay-server-lightweight-peer-identity-spike   pid=2765126 … driver pid=2765880 confirmed_ms=1045   log …~1789275933429-d56cf1.log
> 06:13:33Z gap-ac203-two-distinct-kinds-no-production-run    慢启动的确认耗时确实 > 窗口(1s)：confirmed_ms=530      log …~1789278698343-8f4ee5.log
> 06:51:29Z gap-ac203-two-distinct-kinds-no-production-run    pid=955396  … driver pid=955909  confirmed_ms=1044   log …~1789280952747-76cd18.log
> 07:09:29Z gap-checker-mutation-check-has-no-change-tier-…   pid=1459682 … driver pid=1460736 confirmed_ms=1025   log …~1789281013502-53a322.log
> 07:23:15Z gap-watchdog-killed-round-writes-no-verification… pid=1964177 … driver pid=1964772 confirmed_ms=1045   log …~1789282115471-5eb646.log
> ```
> 逐条 `judgeRetryExemption`：**全部 `own-defect-counted` ∧ `recurredTasks: []`**（06:51 那条与题面 JSON 逐字一致）。⛔ 无一条由构造的 outcome 记录得出。

- [x] AC2（正控制·同一缺陷跨任务必须豁免）：改后，对**同一缺陷**在 2 个不同任务上的两条真实记录，`judgeRetryExemption` 必须返回非 `own-defect-counted`（贴 verdict + `recurredTasks` 非空）。

> 改后读数（同一脚本，只换了 worktree 里的 `worker-driver.ts`）：`gap-ac203-two-distinct-kinds-no-production-run` @06:51 的**现场**记录 ⇒
> `verdict = unrelated-flaky-exempt`，`recurredTasks = ["gap-quay-server-lightweight-peer-identity-spike","gap-checker-mutation-check-has-no-change-tier-companion","gap-watchdog-killed-round-writes-no-verification-round-record"]`（**3 个真实其它任务**，证据是它们各自**现场**的 suite log）。两条真实记录 = `peer-identity-spike@05:30`（log `…d56cf1.log`）与 `ac203@06:51`（log `…76cd18.log`）；被判定的是后者，前者作为跨任务复发证据被扫到。
> ⚠️ 诚实附注：`peer-identity-spike@05:30` / `watchdog@07:23` / `checker-mutation-check@07:09` **自身**今日仍判 `own-defect-counted`——因为它们走的是**先于签名分支**的「失败文件在 Touches/diff」分支（其分支 delta 含 `driver-runtime.test.mjs`，或自身 Touches 内的 `scoped-static-checks.test.mjs` 也红了）。本条只治签名分支，⛔ 不改那条分支。

- [x] AC3（反向控制·不同缺陷必须不豁免）：构造两个**不同**缺陷（例如数字/路径被折叠后仍不同的两种失败）在 2 个任务上的记录 ⇒ 必须**仍** `own-defect-counted`。判据能取假：把归一化写过头（例如抹掉整个签名）⇒ 本条立刻翻红。

> 用例 `AC3 (反向控制) — 两个【不同】缺陷（易变量各异）跨 2 任务 ⇒ 仍 own-defect-counted（⛔ 归一化过头即红）`。两个缺陷措辞不同、**都**带 pid/绝对路径：A `probe must be alive: pid=1234 at /…/gap-a/…`、B `queue depth exceeded: pid=9999 at /…/gap-b/…` ⇒ verdict `own-defect-counted` ∧ `recurredTasks: []`。
> **取假器（同一用例内的显式断言）**：`assert.notEqual(normalizeAssertionSignature(A), normalizeAssertionSignature(B))` —— 归一化写过头（抹掉签名 / 把量折成恒等）⇒ 这两条相等 ⇒ 本用例红。

- [x] AC4（硬规则 3b：读不懂不得与「豁免」同形）：签名提取失败 / suite log 读不到 / outcome 记录缺字段时，verdict 必须仍落在 `insufficient-data-fallback`（照常计数），⛔ 不得因为「判不出来」而放行。贴该分支的实际取值。

> 用例 `AC4 (硬规则 3b)` 贴出的四个分支实际取值：① 退化签名（`1 !== 2` ⇒ `<n> !== <n>`，除占位符外无字母）⇒ `insufficient-data-fallback`；② 日志里一条 `AssertionError` 都没有 ⇒ `insufficient-data-fallback`；③ suite log 读不到 ⇒ `insufficient-data-fallback`；④ outcome 缺 `mechanical_fan_in` ⇒ `insufficient-data-fallback`。每一条都另配 `assert.notEqual(verdict, "unrelated-flaky-exempt")`（「判不出 ≠ 判为无关」）。
> 现场读数：48h 窗内 29 条 suite-red 记录里 **24 条**落 `insufficient-data-fallback`（日志已被清理，或两条最新日志为 **0 字节**）——**0 条**因「判不出来」变成 `unrelated-flaky-exempt`。

- [x] AC5（硬规则 5b：同一形态的兄弟点枚举）：把「判据用**逐字文本**做身份，而文本含易变量」这个形态在同一载体里枚举（`assertionSignaturesFromSuiteLog` 的全部消费者 + 其它以文本签名做去重/复发的判定），贴**命中数**与前 3 条实际内容。

> **谓词**：一个**由自由文本派生的字符串**被当作**身份**使用（去重 / 跨任务复发 / 聚合 / 稳定 ID），而该文本含**每次运行都可能变的量**。扫描 `plugin/scripts/**` + `experiments/**/scripts/**`（⛔ 排除测试与 node_modules）。
> **命中数 = 4 个真同胞**（按位置判定），另有 **2 个字面同名形但按位置无比较点 ⇒ 不算**：
> ```
> ① worker-driver.ts:1895 assertionSignaturesFromSuiteLog  身份用于【跨任务复发】——消费者 recurringSignatureTasks:1969 + judgeRetryExemption:2020（这正是本条缺陷；两消费者现全部经唯一正本点）
> ② meta-driver.ts:611 errorSignature                       身份用于【会话错误聚合】——消费点 :638（已自行折 hex/数字/路径/引文；⛔ 不合并：它截断 200 字符 + 折长引文，会削弱断言身份）
> ③ agent-panel-classify.ts:49 stripTimer                   身份用于【面板行去重】——消费点 :140 `stripTimer(bl.raw) === stripTimer(a.raw)`（已折 `N[hms]` 时长 token）
> ④ proposal-convergence.ts:64 normalizeKey（+ experiments/…/proposal-convergence.ts:1548 normalize） 身份用于【提案稳定 ID / 仅措辞变更判定】——只折空白+小写；输入是散文句而非逐运行量 ⇒ 同形但失效模式不同 ⇒ 记为观察项，⛔ 不在本条改
> ✗ psi-failure-correlation-check.ts:533 extractErrorSignature  字面叫 signature，但**只被打印/入记录、无任何比较点** ⇒ 按位置判定不算
> ✗ worker-driver.ts:2439/3003 cmdlineFingerprint               `argv.join(" ")`，本载体里同样**只写不比较** ⇒ 不算
> ```
> 前 3 条实际内容（源码逐字）已在提交信息与 `plugin/test/worker-driver-fan-in.test.mjs` 的 `DoD (落点映射·机械)` 用例中留痕。

## Definition of Done

- [x] 真落地（DIR-026 Reading A）：用**现场的真实 suite 日志与 outcome 记录**跑一次判定，得到非 `own-defect-counted` 的 verdict（⛔ 不是夹具回声）；并贴一次 `own-defect-counted` 的反向读数证明该机制仍在计数真缺陷。

> 非夹具读数：`gap-ac203-two-distinct-kinds-no-production-run` @06:51 的真实 outcome 记录 + 三条真实 suite log ⇒ `unrelated-flaky-exempt`（见 AC2）。反向读数（机制仍在计真缺陷）：`gap-checker-mutation-check-has-no-change-tier-companion` @07:09 ⇒ `own-defect-counted`，理由 `failing test plugin/test/scoped-static-checks.test.mjs is in this task's Touches/diff (own defect)`——它**自己 Touches 内的测试文件**红了，照常计数；29 条窗内记录里 4 条 `own-defect-counted` / 1 条 `unrelated-flaky-exempt` / 24 条 `insufficient-data-fallback`。

- [x] 落点映射：签名归一化的**唯一**正本点（`assertionSignaturesFromSuiteLog`）与其消费者（`recurringSignatureTasks` / `judgeRetryExemption`）的一致性核对，⛔ 不留第二份「哪些字符算易变量」的清单。

> 归一化实体只有一处：`normalizeAssertionSignature`（worker-driver.ts:1874），由 `assertionSignaturesFromSuiteLog`（:1895）调用；两个消费者（:1969 / :2020）都只拿到**已归一化**签名，⛔ 不各自再折一次。这条**做成了机械判据**而非散文承诺：用例 `DoD (落点映射·机械)` 读源码断言「提取点恰 1 处 / 归一化函数恰 1 处定义 / 空白归一化恰 1 处（第二处 = 第二份清单）/ `assertionSignaturesFromSuiteLog(` 恰 3 次 = 1 定义 + 2 消费者」。后来有人另拼一份签名逻辑 ⇒ 立刻红。

- [x] 在 `plugin/test/worker-driver-fan-in.test.mjs` 里留下双向控制的用例（同一缺陷豁免 ∧ 不同缺陷不豁免）。

> `AC2 (正控制)`（同一缺陷易变量各异跨 2 任务 ⇒ `unrelated-flaky-exempt`）∧ `AC3 (反向控制)`（两个不同缺陷 ⇒ 仍 `own-defect-counted`）。**红控制已跑**：把归一化换回改前语义（只折空白）重跑 ⇒ `AC2 (正控制)` 与 `normalizeAssertionSignature` 单测**红**，`AC3 (反向控制)` 与三态控制**保持绿**（反向控制本就该在改前改后都绿，它防的是归一化**过头**）⇒ 新用例确实在测这条缺陷，不是恒绿。改后 12 个相关用例全绿。
