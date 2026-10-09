---
id: gap-goal032-verdict-parser-kernel-extraction
title: GOAL-032 ①：抽取 parseBinaryVerdict 到
  kernel，parseFidelityVerdict/parseSemanticSufficiencyVerdict 改为薄包装
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-347
---
**type:** execution

## Proposal

GOAL-032 的第一块：新建 `packages/quay/src/kernel/verdict-parse.ts`，导出通用纯函数 `parseBinaryVerdict`，把 `parseFidelityVerdict`（`packages/quay/src/criterion-fidelity.ts:71-87`）与 `parseSemanticSufficiencyVerdict`（`plugin/scripts/goal-driver.ts:1142-1161`）各自的解析循环收敛成对这一个 kernel 函数的调用——**两者函数名/签名/返回类型/调用方调用方式一律不变**，只换内部实现。

**已完成的等价性调查（不在本任务重复）**：两函数算法逐字相同，仅合法值字面量不同（`faithful`/`vacuous` vs `covered`/`insufficient`），`criterion-fidelity.ts:27-28` 与其测试文件 `criterion-fidelity-historical-case.test.mjs:56` 均自述是对另一处的"verbatim"/"复刻"。详见 GOAL-032 body「背景」。

## Plan

1. 新建 `packages/quay/src/kernel/verdict-parse.ts`：

```ts
// packages/quay/src/kernel/verdict-parse.ts — kernel 单一实现：把判定器原始 stdout 解析成
// 三态 verdict（positive/negative/not-evaluated），fail-closed——合法值字面量由调用方传入，
// 解析算法本身领域无关（GOAL-032：criterion-fidelity.ts::parseFidelityVerdict 与
// goal-driver.ts::parseSemanticSufficiencyVerdict 收敛而来，原两处各自的循环逐字相同）。
// kernel 文件约束：只 import kernel 内部 + 裸说明符；本文件零依赖，天然满足。

/** 给定 stdout/exitCode 与合法的 positive/negative 字面量，解析出三态 verdict。
 *  fail-closed：非零退出、空输出、裸 token 不匹配、JSON 无 verdict 键、verdict 非法值 ⇒
 *  not-evaluated，绝不默认回落到 positive。*/
export function parseBinaryVerdict<P extends string, N extends string>(
  stdout: string | null,
  exitCode: number | null,
  positive: P,
  negative: N,
): P | N | "not-evaluated" {
  if (exitCode !== 0) return "not-evaluated";
  const text = (stdout ?? "").trim();
  if (text === positive || text === negative) return text as P | N;
  const candidates = [text, ...text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse()];
  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === "object" && (obj.verdict === positive || obj.verdict === negative)) {
        return obj.verdict as P | N;
      }
    } catch {
      /* non-JSON line, keep scanning upward */
    }
  }
  return "not-evaluated";
}
```

2. `packages/quay/src/criterion-fidelity.ts::parseFidelityVerdict` 改为薄包装：
```ts
export function parseFidelityVerdict(stdout: string | null, exitCode: number | null): FidelityVerdict {
  return parseBinaryVerdict(stdout, exitCode, "faithful", "vacuous");
}
```
（顶部新增 `import { parseBinaryVerdict } from "./kernel/verdict-parse.ts";`，原解析循环整段删除——不留第二份同形代码，⛔ 不是"新增一个调用，旧循环也留着"的半搬壳。）

3. `plugin/scripts/goal-driver.ts::parseSemanticSufficiencyVerdict` 同理：
```ts
export function parseSemanticSufficiencyVerdict(stdout: string | null, exitCode: number | null): SufficiencyVerdict {
  return parseBinaryVerdict(stdout, exitCode, "covered", "insufficient");
}
```
（新增 `import { parseBinaryVerdict } from "../../packages/quay/src/kernel/verdict-parse.ts";`，原解析循环整段删除。）

4. **两处调用方（`criterionFidelityVerdict`/`sampleSemanticSufficiency`）一行不改**——它们调的还是 `parseFidelityVerdict(res.stdout, res.exitCode)`/`parseSemanticSufficiencyVerdict(r.stdout, r.status)`，函数名、参数、返回类型完全不变，只是被调函数内部换了实现。

## Acceptance Criteria

- [x] `packages/quay/src/kernel/verdict-parse.ts` 存在，导出 `parseBinaryVerdict`，文件内 import 只有 kernel 内部路径或裸说明符（`grep -n "^import" packages/quay/src/kernel/verdict-parse.ts` 要么为空要么只匹配 `from "./` 或 `from "node:`）
- [x] `parseFidelityVerdict`/`parseSemanticSufficiencyVerdict` 两处均真实调用 `parseBinaryVerdict`（`grep -c "parseBinaryVerdict" packages/quay/src/criterion-fidelity.ts plugin/scripts/goal-driver.ts` 各自 ≥1），且各自原有的 JSON-scan 解析循环代码已整段删除（不是新增调用、旧循环并存）
- [x] 两处调用方（`criterionFidelityVerdict`/`sampleSemanticSufficiencyVerdict` 的调用点）逐字不变：`grep -q "parseFidelityVerdict(res.stdout, res.exitCode)" packages/quay/src/criterion-fidelity.ts` 与 `grep -q "parseSemanticSufficiencyVerdict(r.stdout, r.status)" plugin/scripts/goal-driver.ts` 均命中
- [x] 回归：`plugin/test/criterion-fidelity-gate.test.mjs`、`plugin/test/criterion-fidelity-default-wiring.test.mjs`、`plugin/test/criterion-fidelity-historical-case.test.mjs`、`plugin/test/goal-sufficiency-semantic-covered.test.mjs` 全绿，一字不改断言
- [x] 新增 `packages/quay/test/verdict-parse.test.mjs`（kernel 函数自己的单测）：覆盖裸 token / JSON / 末行向上扫描 / 非零退出 / 空输出 / 散文 / 无 verdict 键 / verdict 非法值 八种情形，且同一套用例对 `("faithful","vacuous")` 与 `("covered","insufficient")` 两组字面量各跑一遍（证明解析算法领域无关——⛔ 不是只测一组字面量就默认另一组也行）
- [x] 负对照（取假）：把 `parseBinaryVerdict` 内部"JSON 向上扫描"那段暂时注掉重跑新增单测 ⇒ 对应用例必须转红；改回原样重跑全绿——执行命令与两次结果进 `## Evidence`
- [x] `import-graph-check.ts --json` 的 `verdict.ok === true`（kernel 边界不回退；新增的 `plugin/scripts → packages/quay/src/kernel` 边是声明允许方向）
- [x] ⛔ 本任务不触碰 `plugin/scripts/drivers.yml`/`driver-config.ts`/`routine-file-gate.ts`/`probe-routine.ts`（正在自动运行的 routine-quota 两个任务的范围，`git diff --name-only develop` 对这四个文件必须为空）

## Definition of Done

`parseBinaryVerdict` 落地为 kernel 唯一实现，两个旧函数变薄包装、调用方零改动，既有测试一字不改全绿，新增单测证明算法领域无关且有负对照，kernel 边界与 routine-quota 隔离均核验通过。

## Touches

- packages/quay/src/kernel/verdict-parse.ts
- packages/quay/src/criterion-fidelity.ts
- plugin/scripts/goal-driver.ts
- packages/quay/test/verdict-parse.test.mjs
- tasks/gap-goal032-verdict-parser-kernel-extraction.md

## Evidence

实现（worktree `/home/yale/work/quay-worktrees/gap-goal032-verdict-parser-kernel-extraction`，分支 `task/gap-goal032-verdict-parser-kernel-extraction`，源提交 `ec0b1a8f7`）：

- 新建 kernel leaf `packages/quay/src/kernel/verdict-parse.ts`（零 import），导出 `parseBinaryVerdict`。
- `criterion-fidelity.ts::parseFidelityVerdict` → `return parseBinaryVerdict(stdout, exitCode, "faithful", "vacuous");`
- `goal-driver.ts::parseSemanticSufficiencyVerdict` → `return parseBinaryVerdict(stdout, exitCode, "covered", "insufficient");`
- 两处原 JSON-scan 解析循环整段删除（不是新增调用、旧循环并存）；两处调用方调用点逐字未改。
- 新增 `packages/quay/test/verdict-parse.test.mjs`。

AC 逐条核验（cwd = worktree）：

AC1 — kernel 文件存在、零越界 import：
```
$ grep -n "^import" packages/quay/src/kernel/verdict-parse.ts   # 无输出，exit 1
```
⇒ 空（零 import，天然满足 kernel 边界）。

AC2 — 两处真实调用、各自的旧解析循环已整段删除：
```
$ grep -c "parseBinaryVerdict" packages/quay/src/criterion-fidelity.ts plugin/scripts/goal-driver.ts
packages/quay/src/criterion-fidelity.ts:4
plugin/scripts/goal-driver.ts:3
$ grep -n -A2 "^export function parseFidelityVerdict" packages/quay/src/criterion-fidelity.ts
76:export function parseFidelityVerdict(stdout: string | null, exitCode: number | null): FidelityVerdict {
77-  return parseBinaryVerdict(stdout, exitCode, "faithful", "vacuous");
78-}
$ grep -n -A2 "^export function parseSemanticSufficiencyVerdict" plugin/scripts/goal-driver.ts
1150:export function parseSemanticSufficiencyVerdict(stdout: string | null, exitCode: number | null): SufficiencyVerdict {
1151-  return parseBinaryVerdict(stdout, exitCode, "covered", "insufficient");
1152-}
```
⇒ 两处均只剩一行薄包装调用，`const candidates = [text, ...` 与 `for (const cand of candidates)` 在这两个函数内已消失（criterion-fidelity.ts 内该模式 **0** 处）。

硬规则 5b 同载体普查（同一 stdout→verdict 解析模式，prod 树 `packages/*/src` + `plugin/scripts`）：
```
$ grep -rn "const candidates = \[text, \.\.\.text\.split" packages/*/src plugin/scripts
packages/quay/src/kernel/verdict-parse.ts:51            ← 新的单一实现
plugin/scripts/goal-driver.ts:1687                      ← parseObjectiveJudge（见下，非同形）
```
家族第三处 `plugin/scripts/goal-driver.ts:1681::parseObjectiveJudge`（`substantiated`/`unsubstantiated`）**未并入**，因为它**不是逐字同形**：返回类型是 `{verdict, field, value}`（携带指认字段），且用 `continue` 而非嵌套 `if` 语义。本任务 Plan/AC 只点名 `parseFidelityVerdict`/`parseSemanticSufficiencyVerdict` 两处，kernel 签名 `parseBinaryVerdict<P,N>: P|N|"not-evaluated"` 结构上表达不了它的额外负载 ⇒ **本次不收敛，登记为已知同族**（硬规则 5b：修好一处 ≠ 只此一处）。

AC3 — 调用点逐字不变：
```
$ grep -q "parseFidelityVerdict(res.stdout, res.exitCode)" packages/quay/src/criterion-fidelity.ts && echo HIT
HIT
$ grep -q "parseSemanticSufficiencyVerdict(r.stdout, r.status)" plugin/scripts/goal-driver.ts && echo HIT
HIT
```

AC4 — 四个既有测试文件全绿，断言一字未改：
```
$ node --experimental-strip-types --test plugin/test/criterion-fidelity-gate.test.mjs plugin/test/criterion-fidelity-default-wiring.test.mjs plugin/test/criterion-fidelity-historical-case.test.mjs plugin/test/goal-sufficiency-semantic-covered.test.mjs
ℹ tests 36 | ℹ pass 36 | ℹ fail 0
$ git diff --name-only develop -- plugin/test/criterion-fidelity-gate.test.mjs plugin/test/criterion-fidelity-default-wiring.test.mjs plugin/test/criterion-fidelity-historical-case.test.mjs plugin/test/goal-sufficiency-semantic-covered.test.mjs
（空 ⇒ 四个测试文件未被触碰）
```

AC5 — 新增 kernel 单测，八种情形 × 两组字面量：
```
$ node --experimental-strip-types --test packages/quay/test/verdict-parse.test.mjs
ℹ tests 31 | ℹ pass 31 | ℹ fail 0
```
同一套用例由 `LITERAL_PAIRS` 对 `("faithful","vacuous")` 与 `("covered","insufficient")` 各生成一遍，覆盖：裸 token（正/负/trim）· 单行 JSON（正/负）· 末行向上扫描（含 JSON 上方有非 JSON 尾行）· 非零退出 · null exitCode · 空/空白输出 · null stdout · 散文无 JSON · JSON 无 verdict 键 · verdict 非法值；另加一条「同一 stdout 按调用方字面量解析出不同 verdict」的领域无关断言。

AC6 — 负对照（取假）：把 `parseBinaryVerdict` 内部 JSON 向上扫描循环暂时禁用 ——
```
$ python3 -I - verdict-parse.ts   # 把 `for (const cand of candidates) {` 改为 `for (const cand of ([] /* AC6 NEGATIVE CONTROL: JSON upward-scan disabled */ as string[])) {`
$ node --experimental-strip-types --test packages/quay/test/verdict-parse.test.mjs
ℹ tests 31 | ℹ pass 20 | ℹ fail 11        # 11 条依赖 JSON 扫描的用例转红
$ cp .quay/ac6-verdict-parse.backup.ts packages/quay/src/kernel/verdict-parse.ts   # 还原（grep -c "NEGATIVE CONTROL" = 0）
$ node --experimental-strip-types --test packages/quay/test/verdict-parse.test.mjs
ℹ tests 31 | ℹ pass 31 | ℹ fail 0         # 还原后全绿
```
转红的 11 条：单行 JSON（正/负）× 2 组 = 4、末行向上扫描 × 2 组 = 4（含「JSON 上方有尾行」各 1）、非 JSON 行不中断扫描 × 2 组 = 2、领域无关断言 × 1，共 11。

AC7 — kernel 边界不回退：
```
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts --json --root <worktree>
"valueSccs": [], "typeSccs": [], "reverseEdges": [], "kernelChecked": true, "kernelViolations": [],
"verdict": { "ok": true, "kernelBlocked": false, ... }
```
新增边 `plugin/scripts/goal-driver.ts → packages/quay/src/kernel/verdict-parse.ts` 是声明允许方向（plugin → kernel），`reverseEdges` 仍 0。

AC8 — routine-quota 隔离：
```
$ git diff --name-only develop -- plugin/scripts/drivers.yml plugin/scripts/driver-config.ts plugin/scripts/routine-file-gate.ts plugin/scripts/probe-routine.ts
（空）
```

类型检查：
```
$ npx tsc --noEmit -p tsconfig.json ; echo "TSC_EXIT=$?"
TSC_EXIT=0
```
