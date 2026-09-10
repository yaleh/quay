---
id: gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests
title: 保真性闸在生产里从不触发（judge 未接线 ⇒ fail-open 且字段缺失与「判过且放行」同形），且 AC-230 的历史判决由测试
  stub 自算而非真判定器给出
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-231
---
## Proposal

GOAL-013 的保真性闸已落地（`goal-store.ts:792-808` P6b + `criterion-fidelity.ts`，AC-229/AC-230 已 achieved）。**但实测两处使它此刻不构成保证。**

### 缺陷 A —— 闸在生产里从不触发，且「从不触发」与「触发了且放行」在载体上同形

`goal-store.ts:797` 的触发条件含 `&& typeof fidelityJudge === "function"`；judge 唯一来源是 env var `QUAY_GOAL_FIDELITY_JUDGE`（`:1033`）。注释逐字承认：**「Unset ⇒ fidelityJudge undefined ⇒ the pre-GOAL-013 activation path is verbatim unchanged (fails-open)」**。

**实测该 env var 的生产接线点 = 0**（排除测试与定义处）：

```
QUAY_GOAL_FIDELITY_JUDGE     非测试非定义处命中 = 0     ← 本缺陷
正控制（同一谓词，已知被接线的 var）：
QUAY_NATIVE_TASKS_DIR        非测试非定义处命中 = 263
QUAY_TEST_CGROUP_SCRIPT      非测试非定义处命中 = 4
在跑的 driver 进程 /proc/<pid>/environ：3 个进程命中均 = 0
```

⇒ 零计数已配对正控制（硬规则 2 的零计数半边：谓词对已知为真样本返回非零 ⇒ 这个 0 是真 0，不是恒零）。**今天每一次真实 AC 激活都走 `fidelityJudge === undefined` 分支，闸完全不跑。**

**更坏的一半是不可见**：不跑时 `frontmatter.fidelity` **字段根本不写**。⇒ 一条记录上「闸跑过且判 faithful」与「闸从未跑」的区别是**字段有无**，而字段缺失也可能是别的原因 ⇒ 与硬规则 3b 冲突（读不懂/没配置 不得与合格同形）。

**同仓库已有正确形态可抄**——`goal-driver.ts:426-449` 的充分性判定：`sufficiencyCmd` **只是测试缝**，**缺省走 `launchArgv("fix-worker")` 真 LLM**，且 `launchArgv` 抛错 ⇒ `not-evaluated`，⛔ 不回落 `covered`。**保真性闸把这个模式反了过来**：缝缺席不是走真判定器，而是**跳过整个闸**。

### 缺陷 B —— AC-230 的「真实历史判 vacuous」是测试自算的，不是判定器判的

`plugin/test/criterion-fidelity-historical-case.test.mjs:67`：

```js
return { stdout: JSON.stringify({ verdict: hasCrossPackage ? 'faithful' : 'vacuous' }), exitCode: 0 };
```

**verdict 由测试自己按夹具算出、再喂回解析器。** ⇒ 该测试证明的是「管道通 + 两个逐字历史夹具可区分 + 读不懂 fail-closed」，**没有证明「真的语义判定会把 AC-225 扩面前的判据判成 vacuous」**。夹具是真历史（372L/420L 逐字 vendor），**判决是合成的**——正是 AC-230 自己 expect 里要禁的形态（硬规则 4 推论三：只能被注入数据满足的判据只证明「能产出」，不证明「已产出」）。

### 立案方的记账

缺陷 A 的诱因来自**我自己写的 AC3**（「既有激活路径**逐字不变**」）——满足它最省事的实现就是让新闸默认不跑。**一条要求「既有路径逐字不变」的 AC，会激励把新机制做成惰性的**；正确写法应同时要求「新机制在缺省配置下**确实执行**」。这条教训随本任务记入。

**约束（实测）**：`packages/quay/src/goal-store.ts` 当前 `import` 中跨 `plugin/` 的计数 = **0**，而 `launchArgv` 住在 `plugin/scripts/driver-runtime.ts`。⇒ ⛔ **不得为接线让 Core 去 import kernel**——那正是 GOAL-012 存在的理由。真判定器的接线点应在**调用方**，Core 侧只负责「没配置就说实话」。

## Plan

1. **可见性（Core 内，必做且独立成立）**：judge 未配置时，激活路径必须在记录上留下**可区分取值**（形如 `fidelity: { verdict: "not-evaluated", reason: "no judge configured" }`），⛔ 不是字段缺失。此步让「闸从未跑」在载体上与「跑过且放行」不同形，且**不改变放行/拦截行为** ⇒ 零破坏性。
2. **接线真判定器**：按 `goal-driver.ts` 充分性判定的既有先例（缺省真 LLM、缝仅测试用、判不出 ⇒ `not-evaluated` 不回落合格）把真判定器接到**调用方**。⛔ Core 不得 import `plugin/*`（改后仍须实测为 0）。
3. **取真实判决读数**：用**真判定器**对两个逐字历史夹具各跑一次，记录原始输出与 verdict。
4. ⛔ 全程不得把判定接进 goal-driver 每轮约 42 秒的 gate 路径（否则重演 `gap-goal-gate-timestamp-commit-flood`）。

**若接线落在 Core 之外**（如 `plugin/scripts/goal-driver.ts` / `driver-runtime.ts`），实现者须先按纪律扩 `## Touches` 再改，⛔ 不得越界改未声明文件。

## Acceptance Criteria

- [x] AC1（可见性，能取假）：**未配置** judge 时激活一条 AC ⇒ 记录上出现可区分取值（`fidelity.verdict = "not-evaluated"` + reason 指明未配置）；⛔ 字段缺失不算通过。负控制：**配置了** judge 时该取值为 `faithful`/`vacuous` 之一。两个方向各贴一次记录原文。—— ✅ 两方向记录原文见 `## Evidence` AC1；实现 = `goal-store.ts` P6b 的 else 分支；gate 测试 ⑤ 守着。
- [x] AC2（接线，读生产载体）：真判定器在生产激活路径上**被实际调用**——贴出**非测试、非定义处**的接线点 ≥ 1（**当前实测为 0**；零计数须配正控制：同一谓词对 `QUAY_NATIVE_TASKS_DIR` 返回 263 ⇒ 谓词非恒零）。且 `goal-store.ts` 跨 `plugin/` 的 import 计数**仍为 0**（改前实测 0）。—— ✅ 接线点 = `plugin/scripts/goal-driver.ts` ⑧ 激活步：`fidelityJudgeArgvJson(root)`（=`launchArgv("fix-worker","",root).slice(0,-1)` 真 LLM argv 前缀）→ `writeGoalStatus(...,{fidelityJudgeArgv})` → `--fidelity-judge-argv`；`goal-store.ts` 跨 `plugin/` import 计数实测 **0**（见 Evidence）。
- [x] AC3（判准，**真读数非 stub**）：已用**真判定器**（`launchArgv("fix-worker")`）对 `kernel-sibling-pre-aca7a0511.ts` 与 `-post-` 两个逐字夹具各跑一次并 vendor 原始输出——**实测判决 = pre `faithful`、post `faithful`（⛔ 未复现「扩面前 vacuous」预期）**。按本条「若真判定器给出的判决与预期不符，如实记录并降为发现」处理：真判定器把「能取假」判 faithful、不把「覆盖不全」判 vacuous——原 stub 自算的「扩面前 vacuous」并非真判定器的实际判决；原始输出 vendor 进 `plugin/test/fixtures/criterion-fidelity/real-judge-{pre,post}.stdout.txt`，测试钉到真读数（⛔ 不再自算）。见 Evidence。
- [x] AC4（不入热循环，能取假）：goal-driver 每轮 gate 路径**不调**保真性判定——`gateCriterion` 内 fidelity 引用 grep = **0**，负控制：注入一处调用 ⇒ 0→1。`fidelityJudgeArgvJson` 调用点仅在 ⑧ 激活步（`:1010`），不在 ① 每轮 criterion gate 路径。见 Evidence。
- [ ] AC5：全量 `scripts/test.sh` 绿（待外部）

## Definition of Done

「闸从未跑」在载体上与「闸跑过且放行」**不同形**；真判定器在生产激活路径上被实际调用，且 Core 仍不依赖 kernel（跨 `plugin/` import = 0）；AC-225 那个真实历史案例的判决由**真判定器**给出并留有原始输出，⛔ 不是测试自算；判定不进 ~42 秒热循环；全量 `scripts/test.sh` 绿。

⛔ 本任务完成的标志**不是**「测试都绿」——AC-229/AC-230 的测试当前就全绿，而闸在生产里一次都没跑过。

## Evidence

- **AC1（可见性，两方向记录原文）**——未配置 judge（无 `QUAY_GOAL_FIDELITY_JUDGE` 无 `--fidelity-judge-argv`）：
  ```
  fidelity:
    verdict: not-evaluated
    reason: no judge configured
    at: 2026-09-10T12:11:56.730Z
  ```
  配置 judge（`QUAY_GOAL_FIDELITY_JUDGE='node -e process.stdout.write(JSON.stringify({verdict:"faithful"}))'`）：
  ```
  fidelity:
    verdict: faithful
    reason: "fidelity judge: faithful"
    at: 2026-09-10T12:11:57.499Z
  ```
- **AC2（接线点 + 跨 plugin import）**：接线点 = `plugin/scripts/goal-driver.ts` ⑧ 激活步（`:1008-1016`）：`fidelityJudgeArgvJson(root)` → `launchArgv("fix-worker","",root).slice(0,-1)` 真 LLM argv 前缀 → `writeGoalStatus(..., {fidelityJudgeArgv})` → `--fidelity-judge-argv` 传给 goal-store，由 goal-store 的 `criterionFidelityVerdict` 跑真判定。`packages/quay/src/goal-store.ts` 跨 `plugin/` import 计数 = **0**（逐条 import 已核对：node 内建 / yaml / 同包 `./` 相对，无 `plugin/`）。
- **AC3（真判定器读数，⛔ 非 stub）**：真判定器（deepseek-v4-pro-anthropic 经 `launchArgv("fix-worker")`）对 pre/post 两夹具各跑一次，exit 0、原始输出均 `{"verdict":"faithful"}`——**pre=faithful、post=faithful**。⛔ 未复现「扩面前 vacuous」预期 ⇒ 按 AC3 降为发现。原始输出已 vendor 进 `plugin/test/fixtures/criterion-fidelity/real-judge-{pre,post}.stdout.txt`。
- **AC4（不入热循环）**：`gateCriterion`（每轮 criterion gate 路径）内 fidelity 引用 grep = **0**；负控制：往 `gateCriterion` 注入一处 `fidelityJudgeArgvJson` 调用后同谓词 = **1**（0→1，谓词能取非零）。`fidelityJudgeArgvJson` 调用点仅在 ⑧ 激活步（`goal-driver.ts:1010`）。

## Touches

- packages/quay/src/goal-store.ts
- plugin/scripts/goal-driver.ts
- plugin/test/criterion-fidelity-gate.test.mjs
- plugin/test/criterion-fidelity-historical-case.test.mjs
- plugin/test/fixtures/criterion-fidelity/real-judge-pre.stdout.txt
- plugin/test/fixtures/criterion-fidelity/real-judge-post.stdout.txt
- tasks/gap-fidelity-judge-unwired-in-production-and-verdict-stubbed-in-tests.md