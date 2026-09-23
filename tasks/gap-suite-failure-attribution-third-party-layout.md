---
id: gap-suite-failure-attribution-third-party-layout
title: suite 失败归因只认 quay 自身测试布局：第三方项目的 suite 红恒归因不出，被误判「没有 worker 能修的东西」
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-317
---
## Proposal

**机制（上游缺陷，develop 仍未修）**：`plugin/scripts/worker-driver.ts:1847` `failingTestFilesFromSuiteLog` 用
`/(?:^|\s|\/)((?:packages|plugin|experiments)\/[^\s]+\.test\.mjs)\s+passed=false\b/` 从 suite 日志提取失败测试文件。前缀集合和 `.test.mjs` 后缀是 **quay 自己仓库**的测试布局；第三方项目（`server/**/*.test.ts`、`src/**/*.test.tsx`）匹配恒为 0 ⇒ 返回 `[]` ⇒ `judgeRetryExemption`（`:2225`）判 `insufficient-data-fallback: "no failing test file extracted from the suite log"` ⇒ `:2406` 在 park needs-human 时写出「the suite log names nothing a worker could fix」。**这句话是一个肯定断言，但它的依据只是「解析器没读懂」**（硬规则 3b 的镜像：读不懂 ⇒ 伪装成判定）。

另有两个缺口：①不看已经指名了文件的 `not ok - <stage>: <rel>:<line>:<col>` 行；②`__PERFILE__ … lint passed=false` 中的 `lint` 是**伪文件名**（阶段名），不是测试文件。

**生产读数（claudecodeui `.quay/worker-round.jsonl`，2026-09-20→09-23）**：51 次 `retry_exemptions`，`failingTestFiles` 非空 **0 次**；归因不出波及 29 个不同任务。其中一例：真凶是一条可一行修的 barrel 导入 lint 错误（`not ok - lint: server/modules/launch-profiles/tests/model-context-window.test.ts:10:49: …`），任务却被 park，判词称「没有 worker 能修的东西」。

**修法（方向，实现者可调）**：
1. 不再硬编码路径前缀。取 `__PERFILE__` 行中 `passed=false` 前面的 token，按「它在 worktree 里是否是真实文件」分三类：真实测试文件 / 伪阶段名（lint、typecheck 等无路径 token）/ 无法识别。
2. 新增 `not ok - <stage>: <rel>[:<line>[:<col>]]` 行的解析，把阶段失败归到被指名的真实文件上。
3. 判词三态：归因成功 / 伪阶段失败但指名了文件（归到该文件）/ 解析器读不懂（判词写「parser extracted 0 of N failing lines」，⛔ 不再写「nothing a worker could fix」）。
4. 回归样本用 claudecodeui 的真实日志节选（`/data/home/yale/work/claudecodeui/scripts/__fixtures__/fan-in-suite-lint-failure.log`，复制进本仓库 fixture）。

<!-- dedup-ref -->相关但机制不同：`gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky`（done）建立了归因三态，本任务修它的**输入解析**；`gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker`（done）定义了归因不出时的**动作**，本任务让「归因不出」只在真的读不懂时出现。本任务是 GOAL-027 / AC-317 的承载 task。

## AC

- [x] `node --test plugin/test/worker-driver-retry-classification.test.mjs` 退出 0，且新增用例覆盖：①第三方布局 `__PERFILE__ duration_ms=1 server/x/y.test.ts passed=false end_ms=2` ⇒ 提取 `server/x/y.test.ts`；②`__PERFILE__ … lint passed=false` 单独出现 ⇒ 不把 `lint` 当测试文件；③同一日志中另有 `not ok - lint: server/a/b.test.ts:10:49: …` ⇒ 归因到 `server/a/b.test.ts`；④quay 自身布局（`plugin/test/x.test.mjs`，含 worktree 绝对路径形态）仍按原样提取（负控，不回归）。
- [x] 取假：把新解析逻辑回退到旧正则后，上述用例①③红（附实跑输出）。
- [x] `grep -n "names nothing a worker could fix" plugin/scripts/worker-driver.ts` 命中数为 0；「读不懂」分支的判词含解析器读到的失败行数 N（用例断言判词文本含 `0 of`）。
- [x] `bash scripts/test.sh --for-task gap-suite-failure-attribution-third-party-layout` 退出 0，且确实执行了 ≥1 个测试文件（非 thin）。

## DoD

真实落地判据：不是「fixture 用例绿」。实现落地 develop 并让第三方项目 driver 重启到含修复的版本后，GOAL-027 / AC-317 的判据（`quay goal gate AC-317`）在真实第三方生产载体上读出「已归因 ≥1」并 exit 0；在读到之前本任务可以 done，但 AC-317 保持未达成，且须在完成记录里写明第三方 driver 重启到的版本与时刻。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver-retry-classification.test.mjs
- plugin/test/worker-driver-fan-in-s04.test.mjs
- plugin/test/fixtures/suite-log-third-party-lint-failure.txt (new)
- tasks/gap-suite-failure-attribution-third-party-layout.md
