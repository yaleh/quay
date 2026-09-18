---
id: gap-mirror-measure-history-retire-dead-writer
title: mirror-measure-history.ts 是死写入器（唯一调用者 fan-in-execute step 4.5
  已删）却仍在册——catalog 6 行（含指着已不存在块的「谁按」）+ 编排文件清单 + 自带测试待连带处置
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**现象**：`plugin/scripts/mirror-measure-history.ts` 是 `gap-measure-history-detached-suite-mirror-write` 的产物（fan-in detached-suite 路径的 `measure-history.jsonl` 镜像写入器）。它的**唯一调用者已被删除**，但文件本体仍在树上、仍在 `capability-catalog.sh` 在册（6 行）、仍被编排文件清单收录、仍自带一个独立测试。

**本次立案现场核实（读码 + 命令，非转述）**：

1. **调用者已删，且删除处逐字留痕**：`plugin/workflows/fan-in-execute.js:796-802`——
   > 旧的三段 mirror 写（pre-verified-round-record / mirror-full-suite-state / mirror-measure-history）是「绕开 runner 的平行 harness」的嫁接，已删除（两套平行机制收敛为一）。

2. **有测试从反方向钉住它不得再被调用**：`plugin/test/fan-in-execute-paths-s04.test.mjs:152`
   `assert.ok(!p2.includes("mirror-measure-history.ts"), "phase-2 must NOT call mirror-measure-history.ts (the runner writes measure-history.jsonl)")`。

3. **生产者已接管**：`plugin/scripts/full-suite-runner.ts:152` import `landMeasureHistory` / `parsePerFileLines`（与该 writer 同一函数，故数据格式一致），并在 `:3830-3831` 自己写 `measure-history.jsonl`。机械 fan-in 的 suite 就是它跑的（`worker-driver.ts:4302-4307` 传 `--log-file`）。

4. **运行时零引用**：`grep -n mirror plugin/scripts/worker-driver.ts` 命中 40 行，全部属于 `mirror-full-suite-state.ts` / `mirrorMechanicalFanInSuiteState`；**`mirror-measure-history` 在该文件的命中数为 0**。

5. **它自己的 catalog「失效前提」行已判定条件成立**：`capability-catalog.sh:913` 逐字——
   > ……若 fan-in 两条路径都改为直接调用 full-suite-runner（本 writer 成为多余）或 measure-history 载体迁出 `.quay/`，本条退休。

   条件已由第 3 条满足。

6. **而 catalog 的「谁按」行指着一个已不存在的块**：`capability-catalog.sh:1946` 称
   > 谁按：fan-in-execute workflow step 4.5 的 `# mirror-history-block` 在 `full_suite_ran=true` 时按……

   全仓 `grep -rn "mirror-history-block"`（`*.js` / `*.ts` / `*.mjs`）**命中 0，exit 1**——该块不存在。

**⇒ 形态判定**：这是「死机件 **+** 一条看起来活、实际指着空气的登记行」。**登记行比文件本体更贵**——文件本体一眼可辨为孤立，而 `:1946` 会让审计者以为它正在被编排调用（硬规则 3b 的近亲：读不懂的对象被当作在场）。同类先例：`gap-fan-in-ff-merge-sh-retire-dead-shell-still-registered-live`（同样"仍在册、仍在树上、注释自称已退役"）。

**为什么现在立案而不是等"自然收敛"**：本仓库已有「迁移 = 创建 + 删除，只有创建被度量」的结论；该 writer 的**删除半边从未执行**，且**没有任何检查器会报出它**——catalog 登记齐全、测试绿、文件存在 ⇒ 所有机械读数都显示"正常"。

## Contract

**退役范围 = 三个面，缺一即「修好一个漏兄弟」（硬规则 5b）**：

| 面 | 落点 | 义务 |
|---|---|---|
| ① catalog 6 行 | `capability-catalog.sh` `:220 / :564 / :913 / :1262 / :1611 / :1946` | 整条退休。其中 `:1946`「谁按」因**无承继者**（runner 自己写）应**删除**，而非改指向 |
| ② 编排文件清单 | `select-static-checks-for-touches.ts:284` `FAN_IN_ORCHESTRATION_FILES` | 移除条目——留着会让任何"改了此文件"的任务被误判为碰到 fan-in 流水线，触发无谓 bootstrap |
| ③ 自带测试 + 基线 | `plugin/test/mirror-measure-history.test.mjs` + `docs/analysis/test-file-baseline.txt:550` | 删测试**并重生成基线**（`scripts/test.sh` 的 test-file-snapshot relative-baseline 把"测试文件消失"判红） |

**⛔ 明确不在范围（现场已核，勿误删/勿误改）**：

- `plugin/test/fan-in-execute-paths-s04.test.mjs:152` 的反面断言**必须保留**：它守的是"runner 是唯一 writer"，删掉本 writer 后该不变量**依然成立且依然必要**。
- `plugin/scripts/full-suite-runner.ts`（生产者）与 `plugin/scripts/measure-trend-check.ts`（消费者）：**不动功能**。`measure-trend-check.ts:250` 的注释（"called by plugin/scripts/mirror-measure-history.ts"）随本任务改准措辞即可。
- `plugin/workflows/fan-in-execute.js:796-802` 那段说明**是历史留痕，保留**。

**顺序义务**：先取「无真调用」证据，**再**删（见 AC1）。⛔ 不得先删后补证。

## AC

- [ ] AC1（删除前置证据，先做）：全仓 `grep -rn "mirror-measure-history\.ts"`（排除 `node_modules/` 与 `archive/`），把命中**逐条归类**为「真调用 / 注释 / 否定断言 / catalog 登记行 / 任务体 / 测试」，并断言**真调用数 = 0**；命令与完整输出贴进任务体。若发现真调用 ⇒ 本任务范围改为"先断真调用"，**不得直接删除**。
- [ ] AC2：`capability-catalog.sh` 的 6 行按上表处置，其中 `:1946` **删除**（不是改指向）。跑 `node --test plugin/test/capability-catalog.test.mjs` 绿；`bash plugin/scripts/capability-catalog.sh --summary` 与 `--entry-surface` / `--superseded-check` 均 PASS，且 `N scripts` 相应减 1（**读它自报的数，不要硬记**）。
- [ ] AC3：`select-static-checks-for-touches.ts` 的 `FAN_IN_ORCHESTRATION_FILES` 移除该条目；跑 `node --test plugin/test/select-static-checks-for-touches.test.mjs` 绿。
- [ ] AC4：删除 `plugin/scripts/mirror-measure-history.ts` 与 `plugin/test/mirror-measure-history.test.mjs`；用正本脚本重生成基线 `bash plugin/scripts/test-file-snapshot.sh --repo-relative snapshot docs/analysis/test-file-baseline.txt`，使基线不再含该测试文件。
- [ ] AC5：`measure-trend-check.ts:250` 注释改准（不再称被已删除文件调用）。
- [ ] AC6：`bash scripts/test.sh` 全量绿，含 capability-catalog / fan-in-execute-paths-s04 / test-file-snapshot 三处；命令与结果贴进任务体。

## DoD

**REAL LANDING 判据（不是"加个删除标记"）**：

- `git ls-files plugin/scripts/mirror-measure-history.ts plugin/test/mirror-measure-history.test.mjs` → **两行为空**（已 `git rm`，不在索引）。
- 全仓 `grep -rn 'mirror-measure-history'`（排除 `archive/` 与 `node_modules/`）**只剩历史留痕**（`fan-in-execute.js:796-802` 那段说明 + 本任务体），**无任何 catalog 登记行、无任何编排清单条目**。
- **反例对照（硬规则 4 推论四）**：删前 / 删后各取一次 `bash plugin/scripts/capability-catalog.sh --summary` 的 `N scripts`，须正好差 1；若不变 ⇒ 说明该条目本就不在计数内，须在任务体解释清楚。
- `bash scripts/test.sh` 一次真实全量绿的命令与结果贴进任务体。

## Touches

- plugin/scripts/mirror-measure-history.ts（删除）
- plugin/test/mirror-measure-history.test.mjs（删除）
- plugin/scripts/capability-catalog.sh
- plugin/scripts/select-static-checks-for-touches.ts
- plugin/scripts/measure-trend-check.ts（注释改准）
- docs/analysis/test-file-baseline.txt（重生成）
- tasks/gap-mirror-measure-history-retire-dead-writer.md