---
id: gap-retry-exemption-signature-keeps-volatile-values
title: 重试豁免判不出复发：签名归一化只折叠空白，pid/ms/路径留在签名里 ⇒ 同一缺陷跨任务产生不同签名 ⇒ 已判「与本任务无关」的 suite
  red 仍被计入该任务重试上限
status: todo
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

- [ ] AC1（能取假·改前读数）：贴出**同一缺陷在 ≥2 个不同任务上产生的签名互不相同**的真实读数（签名文本 + 各自出处 log 路径），并逐条跑 `judgeRetryExemption` 得到 `own-defect-counted` + `recurredTasks: []`。⛔ 不得用构造的 outcome 记录代替现场记录。
- [ ] AC2（正控制·同一缺陷跨任务必须豁免）：改后，对**同一缺陷**在 2 个不同任务上的两条真实记录，`judgeRetryExemption` 必须返回非 `own-defect-counted`（贴 verdict + `recurredTasks` 非空）。
- [ ] AC3（反向控制·不同缺陷必须不豁免）：构造两个**不同**缺陷（例如数字/路径被折叠后仍不同的两种失败）在 2 个任务上的记录 ⇒ 必须**仍** `own-defect-counted`。判据能取假：把归一化写过头（例如抹掉整个签名）⇒ 本条立刻翻红。
- [ ] AC4（硬规则 3b：读不懂不得与「豁免」同形）：签名提取失败 / suite log 读不到 / outcome 记录缺字段时，verdict 必须仍落在 `insufficient-data-fallback`（照常计数），⛔ 不得因为「判不出来」而放行。贴该分支的实际取值。
- [ ] AC5（硬规则 5b：同一形态的兄弟点枚举）：把「判据用**逐字文本**做身份，而文本含易变量」这个形态在同一载体里枚举（`assertionSignaturesFromSuiteLog` 的全部消费者 + 其它以文本签名做去重/复发的判定），贴**命中数**与前 3 条实际内容。

## Definition of Done

- [ ] 真落地（DIR-026 Reading A）：用**现场的真实 suite 日志与 outcome 记录**跑一次判定，得到非 `own-defect-counted` 的 verdict（⛔ 不是夹具回声）；并贴一次 `own-defect-counted` 的反向读数证明该机制仍在计数真缺陷。
- [ ] 落点映射：签名归一化的**唯一**正本点（`assertionSignaturesFromSuiteLog`）与其消费者（`recurringSignatureTasks` / `judgeRetryExemption`）的一致性核对，⛔ 不留第二份「哪些字符算易变量」的清单。
- [ ] 在 `plugin/test/worker-driver-fan-in.test.mjs` 里留下双向控制的用例（同一缺陷豁免 ∧ 不同缺陷不豁免）。
