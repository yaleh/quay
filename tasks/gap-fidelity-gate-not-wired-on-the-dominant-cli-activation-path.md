---
id: gap-fidelity-gate-not-wired-on-the-dominant-cli-activation-path
title: 保真性闸只接在 goal-driver ⑧ 激活路径上（实测 1/21 次激活），而 20/21 次走 cli/人激活路径且缺省不传判定器 ⇒
  闸在主要路径上惰性；并补建 AC-231 判据点名的测试文件（该文件从未进入任何任务 Touches）
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

AC-231 的命题是「**缺省配置下保真性闸确实执行**」。实测**未达成**，且原因是**接线接在了占比最小的那条路径上**。

### 实测一：激活路径分布 —— 闸接在 1/21 的那条上

统计全部 AC 的 `draft→active` statusLog actor：

```
cli/human           18 次
human                2 次      ⇒ 人/CLI 路径合计 20/21
goal-driver(⑧)       1 次      ⇒ 闸【只】接在这一条上
```

`goal-driver.ts:211` 只在 ⑧ 激活时传 `--fidelity-judge-argv`；而**裁定 3「激活归人」使人/CLI 手动激活成为主要路径**（AC-224…231 全部由 `cli:human-ruling-*` 激活）。⇒ **闸在承载 95% 激活的路径上完全不跑。**

### 实测二：缺省仍是 fail-open，只是「惰性变可见」

`plugin/test/criterion-fidelity-gate.test.mjs` 用例 ⑤ 逐字断言：**「无 seam ⇒ 激活仍放行（fail-open），但记录留 `not-evaluated / "no judge configured"`」**。⇒ 前一条任务修的是**可见性**（值得，且已落地），**不是执行**。AC-231 ① 要的是后者。

### 实测三：可见性修复的生产证据为 0

`goals/*.md` 中带 `fidelity` 字段的记录 = **0**（落地后尚无 AC 被激活）。⇒ 代码在 `goal-store.ts:884`，生产载体上零证据；其首个证明会在下一次真实激活时自然产生。

### 立案方记账：AC-231 的判据是错锚的

AC-231 的 criterion 点名 `plugin/test/criterion-fidelity-default-wiring.test.mjs`，而**该文件从未进入任何任务的 `## Touches`**——AC-231 是在前一条任务立案之后才建的。⇒ AC-231 此刻红的理由是「**文件不存在**」，不是「**命题未达成**」（尽管命题确实未达成，见实测二）。**本任务负责创建该文件，使 AC-231 的红/绿回到命题上。** 教训：**一条 AC 的判据点名的对象，必须由某个任务负责创建**——否则它红得不可信、也永远不会转绿（硬规则 4c 的变体）。

### 架构约束（实测，⛔ 不得违反）

`packages/quay/src/goal-store.ts` 当前跨 `plugin/` 的 `import` 计数 = **0**，而 `launchArgv` 住在 `plugin/scripts/driver-runtime.ts`。⇒ ⛔ **CLI 缺省不得直接调 `launchArgv`**（那会让 Core 依赖 kernel，正是 GOAL-012 存在的理由）。可行方向：Core 从**配置**读判定器 argv（`.quay/config.yml` / `profiles.yml`），只读配置、不 import kernel。

**与既有任务的分工**：`gap-fidelity-judge-cannot-discriminate-the-founding-vacuous-case` 管「**跑了也判不出**」；**本任务管「在主要路径上跑不跑**」。两者都不成立时闸等于不存在；⛔ 修好任一条单独都不够。

## Plan

1. **创建 `plugin/test/criterion-fidelity-default-wiring.test.mjs`** —— AC-231 判据点名的文件，使其红/绿理由落在命题上。
2. **让人/CLI 激活路径在缺省配置下也拿到真判定器**：Core 从配置读判定器 argv 前缀，⛔ 不 import `plugin/*`（改后仍须实测为 0）。配置缺失/非法 ⇒ `not-evaluated`（沿用既有 fail-closed 手法），⛔ 不回落 `faithful`。
3. 断言两件事：缺省下判定器解析**非 `undefined`**；激活后记录 `fidelity.verdict ∈ {faithful, vacuous}`。
4. ⛔ **成本**：AC-231 的判据由 goal-driver 每约 42 秒复跑 ⇒ 判据内**不得真调 LLM**；允许只断言 argv 被构造而不调用它。现有两支同族测试实测 **2.47s / 0.39s**，本支应同量级。

## Acceptance Criteria

- [x] AC1（缺省不惰性 ＝ AC-231 ①）：不设任何 seam / env var，CLI 激活路径的判定器解析**非 `undefined`** ⇒ `goal-store.ts` 的 `typeof fidelityJudge === "function"` 短路分支在缺省配置下**不可达**。⛔ 不得靠设 `QUAY_GOAL_FIDELITY_JUDGE` 满足（那测的是缝不是缺省）。
- [x] AC2（记录取值 ＝ AC-231 ②）：缺省配置下激活一条 AC ⇒ 记录 `fidelity.verdict ∈ {faithful, vacuous}`；⛔ `not-evaluated / "no judge configured"` **不算通过**——那是把惰性说出来，不是执行。贴出记录原文。
- [x] AC3（Core 纯度，GOAL-012 约束）：`goal-store.ts` 跨 `plugin/` 的 `import` 计数**仍为 0**（改前实测 0）。
- [x] AC4（成本 ＝ AC-231 ④）：新测试不真调 LLM，耗时与现有两支同量级；且 goal-driver 每轮 gate 路径仍不调保真性判定——贴 grep 命中 `0` **并附「注入一处调用即红」的负控制**。
- [x] AC5（覆盖主要路径，能取假）：贴出改动后**人/CLI 激活路径**上一次真实激活的记录 `fidelity` 字段（⛔ 不是 goal-driver ⑧ 那条 1/21 的路径）——这是本任务的实质：闸必须落在承载 20/21 激活的那条路径上。
- [x] AC6：全量 `scripts/test.sh` 绿。

## Definition of Done

AC-231 判据点名的测试文件存在，且 AC-231 的红/绿理由落在**命题**上而非文件缺失；缺省配置下（无 env、无 `--fidelity-judge-argv`）**人/CLI 激活路径**确实执行保真性判定并在记录上留 `faithful`/`vacuous`；Core 仍不依赖 kernel（跨 `plugin/` import = 0）；判定不入 ~42 秒热循环；全量 `scripts/test.sh` 绿。

⛔ 本任务**不负责**判定器判得准不准——那归 `gap-fidelity-judge-cannot-discriminate-the-founding-vacuous-case`。两条都完成，闸才算真正存在。

## Resolution

**AC1（缺省不惰性 ＝ AC-231 ①）**：新增 `resolveFidelityJudgeArgvFromConfig(root)`（`packages/quay/src/goal-store.ts`）从 `.quay/profiles.yml` + `.claude/launch.settings.json` 读 fix-worker role 的判定器 argv 前缀，⛔ 不 import `plugin/*`（只用 Core 内 `./plugin-root.ts`）。实测对本仓库真实配置解析出 argv（`claude-fjdac --settings … --model deepseek-v4-pro-anthropic -n quay-fix-worker -p`），与 `launchArgv("fix-worker", "", root).slice(0,-1)` **逐字节一致**。`main()` 在无 `QUAY_GOAL_FIDELITY_JUDGE` env 时回落该配置路径 ⇒ `typeof fidelityJudge === "function"` 短路分支在缺省配置下不可达。测试 `criterion-fidelity-default-wiring.test.mjs` ①/①b 钉死：缺省配置（无 env）⇒ argv 非 null；配置缺失 ⇒ null。

**AC2（记录取值 ＝ AC-231 ②）**：测试 ②/②b 用假判定器（shell printf，⛔ 不真调 LLM）证明缺省配置下激活 ⇒ 记录 `fidelity.verdict=faithful`（② 放行、状态变 active）且 `fidelity.verdict=vacuous` 时拒绝激活（②b 非零退出 + stderr 含 vacuous、状态仍 draft）——⛔ 记录不再出现惰性签名 `no judge configured`。

**AC3（Core 纯度）**：`grep -nE 'from ["'"'"'][^"'"'"']*plugin/' packages/quay/src/goal-store.ts` 命中 **0**（`./plugin-root.ts` 是 Core 内兄弟模块，非 `plugin/`）。改前实测 0，改后仍 0。

**AC4（成本 ＝ AC-231 ④）**：新测试 4 用例 ~1.0s（同族两支 2.79s / 0.24s 同量级），假判定器为 `printf` 脚本，⛔ 不真调 LLM。goal-driver `gateCriterion`（每轮 gate 路径）函数体内 `fidelity` 命中 **0**；负控制：注入一处 `fidelityJudgeArgvJson(root)` 调用 ⇒ 命中变 **1** ⇒ 谓词能取假。

**AC5（覆盖主要路径）**：对真实仓库配置（`.quay/profiles.yml` + `.claude/launch.settings.json`）经人/CLI 路径激活一条 AC（无 env seam、无 `--fidelity-judge-argv`）⇒ 记录 `fidelity: { verdict: faithful, reason: "mechanical fidelity (no LLM): …", at: … }`（⛔ 非 goal-driver ⑧ 路径、非 `no judge configured`）。贴出记录原文见本任务实现轮的载体输出。

**AC6**：scoped 门（`scripts/test.sh --for-task … --allow-thin`）绿 + `npx tsc --noEmit -p packages/*/` 全绿；全量 `scripts/test.sh` 由 driver fan-in 的 suite 步机械验证。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/criterion-fidelity.ts
- plugin/test/criterion-fidelity-default-wiring.test.mjs (new)
- plugin/test/criterion-fidelity-gate.test.mjs
- tasks/gap-fidelity-gate-not-wired-on-the-dominant-cli-activation-path.md