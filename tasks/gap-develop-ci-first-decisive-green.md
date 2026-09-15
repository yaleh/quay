---
id: gap-develop-ci-first-decisive-green
title: develop 上 CI 首次 decisive 绿：落地 .quay/ci-runs.jsonl 采集器（testFiles 派生 + 历史回填
  + 生产接线）并把 11 个 CI-only 红修到可移植（AC-265）
status: todo
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-265
---
**type:** execution

## Finding

**缺口一｜AC-265 的判据今天连第一行都过不去：它读的两件东西都不存在（仪器缺位）**

2026-09-15 实测（主检出）：

```
$ ls plugin/scripts/ci-runs-collect.ts        → No such file or directory
$ ls .quay/ci-runs.jsonl                      → No such file or directory
$ python3 <AC-265 的 criterion: 块>            → CAUSE=collector-not-landed — no commit touches
      plugin/scripts/ci-runs-collect.ts => the CI-conclusion collector does not exist, so there
      is no post-landing window to read …                                            EXIT=1
```

判据第一步是 `git log -1 --format=%cI -- plugin/scripts/ci-runs-collect.ts`。该文件从未被提交过
⇒ 判据在「窗口」二字之前就退出，**它后面的两臂——载体读数与 testFiles 反作弊关系——一次也没有被执行过**。
⇒ 今天「AC-265 未被满足」与「AC-265 无法被评估」在读法上同形（硬规则 3b 的形态）。

**缺口二｜develop 上 CI 从未绿过——这是待达成的新状态，不是待恢复的旧状态**

```
$ gh run list --workflow ci.yml --branch develop --limit 100 --json conclusion,createdAt
total 92  {'failure': 52, 'cancelled': 40}     decisive 52   success 0
window 2026-08-16T16:20:54Z -> 2026-09-15T02:38:35Z
```

最后一次 decisive run `34921960393`（2026-09-15T02:38:35Z，18m11s，exit 1）：`test` job 的 `Run tests`
步在 `__GROUP__ concurrency=8 files=631` 下 **11 个测试文件 passed=false**（同 run 的
`dist-verify-node-floor` / `version-consistency` 两个 job 是绿的）：

| # | 文件 | CI 里的失败读数（节选） | 本机主检出实跑 |
|---|---|---|---|
| 1 | plugin/test/axis-generator.test.mjs | `AssertionError: Committer identity unknown`（exit 128） | exit 0 |
| 2 | plugin/test/launch-settings.test.mjs | `claude --settings must exit 0`（actual: null） | exit 0 |
| 3 | plugin/test/outer-cron-registry.test.mjs | `actual '/tmp/fake-global/-home-runner-work-quay-quay'` vs `expected '…-home-yale-work-quay'` | exit 0 |
| 4 | plugin/test/prod-data-audit.test.mjs | `checker-cost.jsonl@/home/runner/work/quay/quay/.quay/checker-cost.jsonl`（不存在） | exit 0 |
| 5 | plugin/test/direct-to-develop-bypass-check.test.mjs | `AC3 回放·CLI … reflog 被 gc 剪`；`部分可分类 ⇒ 0 < ratio < 1` | exit 0（58 pass / 0 fail） |
| 6 | plugin/test/long-term-guarantee-goal-backed-check.test.mjs | `default run must be green, got status=1` | exit 0（11 pass） |
| 7 | packages/quay-native/test/goal-ac-write-face.test.mjs | `default run must be green, got 1` | exit 0（12 pass） |
| 8 | packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs | `fan-in bar renders ≥1 <rect> from real worker-outcome.jsonl` | 未实跑 |
| 9 | packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs | `real production data renders ≥1 fanin segment in the page` | 未实跑 |
| 10 | packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs | `develop label appears on exactly one commit (got 0, was 6)` | 未实跑 |
| 11 | packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs | 同上（`data layer unchanged`） | 未实跑 |

第 1–7 条在本机主检出逐条实跑（`node --test <file>`）全部 exit 0 / fail 0 ⇒ 这些红**不是本机也红的真缺陷**，
而是**只在裸检出（bare checkout）里成立的环境差**：缺 git committer identity、缺 `claude` CLI、
缺 gitignored 的 `.quay/*.jsonl` 生产载体、缺 reflog、以及把本机绝对路径写进了期望值。
第 8–11 条**未实跑**，只作为「待分类」列出；执行时逐条给读数，⛔ 不许照抄本表的推断。

**缺口三｜反作弊关系需要的两个量今天没有任何生产者（最容易漏的一条）**

判据要求 green run 的 `testFiles` ≥ **紧邻前一次** decisive run 的 `testFiles`，两者都必须是**整数**
（否则 `green-run-missing-testFiles` / `preceding-run-missing-testFiles`），且 green 若是最早一条
decisive run 则直接 `no-preceding-decisive-run`。⇒ 采集器必须同时做到三件今天不存在的事：

① **派生** `testFiles`：实测读数在 run 日志的 `__GROUP__ concurrency=8 files=631` 行，**不是** run
元数据里现成的字段；
② **回填历史 decisive run**：只记落盘之后的 run，green 在 `rows` 里就是第 0 条，判据必然死在
`no-preceding-decisive-run`；
③ **口径与判据逐字对齐**：`workflow` 必须写成 `"CI"` 或 `"ci.yml"`——`gh` 的 `workflowName` 值是
`CI`，写成 `.github/workflows/ci.yml` 这类**路径**会被判据的 `not in (None,"ci.yml","CI")` **静默跳过**
（`rows` 空 ⇒ 报 `no-decisive-run-after-landing`，而真因是字段口径）；`ts` 必须是 **run 自己的时刻**
（⛔ 不是采集时刻）；`conclusion` 只在 `success|failure` 里取值（cancelled 按设计不计）。

**缺口四｜没有任何任务承接它**：全仓 grep `ci-runs.jsonl` 只有两条 GOAL-020 兄弟任务提到它，
且那两条的 `goal_ac` 分别是 AC-266 / AC-269。

<!-- dedup-ref -->
**与兄弟任务的关系（traceability，仅作线索，不构成任何排序或门槛）**：`gap-ci-red-attribution-classifier`（AC-269）
在写面上接归因字段、`gap-release-run-tests-hangs-on-shared-mcp-client-leak`（AC-266）修 release job 的超时泄漏
——两条都不产出「develop 首次 decisive 绿」。本案的写面 `plugin/scripts/ci-runs-collect.ts` 已被 AC-269 的
Requested action 第 4 条逐字引用为「由 AC-265 的产出」；两条任务在 Touches 上重合同一个文件是预期行为
（会串行，不会冲突）。

## Requested action

1. **落地 `plugin/scripts/ci-runs-collect.ts`**：把 CI run 归一化成载体记录 append 进 `.quay/ci-runs.jsonl`
   （append-only），字段口径见 Finding 缺口三。**首次运行要回填**（`gh run list` 按分支/工作流取历史
   decisive run），否则判据没有「紧邻前一次」可比较。**gh 可达性要显式解决**（driver 的 PATH 不保证含
   `~/.local/bin`），且 gh 不可达时必须留下**可区分**的读数（⛔ 不是静默写 0 条——那是硬规则 3b 的形态）。
   **成本要有上界**：回填只对必要的 run 拉日志，把实测耗时贴出来。
2. **接进一条真实生产调用路径**（⛔ 只提供手工 CLI 面不算接线）。指定路径：**goal-driver 的每轮**
   （同族先例：它每轮写 `.quay/goal-round.jsonl`；AC-265 本就是它每轮要评的判据之一）。若执行时发现
   更合适的活路径可改用，但必须在 Evidence 里写明选了哪条、为什么，并给出 `file:line` 调用点。
3. **让 develop 真的 decisive 绿**：对 Finding 表里 11 条逐一处置。**首选可移植修法**——期望值从当前
   环境派生（⛔ 不是把本机常量改成 CI 常量）、给缺依赖的测试加**以依赖缺席为条件**的 skip 守卫、
   对 gitignored 生产载体的断言改成「载体缺席时自造夹具」。⛔ 不删测试文件、不缩 `scripts/test.sh` 的 glob、
   不把断言删空。若某条在裸检出里**确实**是真缺陷（不是环境差），修缺陷而不是加跳过。
4. **触发并核实一次真实 develop run**：`gh run watch <id>`（实测 18–25 分钟）。⛔「本地套件绿了」不是证据。
5. **登记义务**（新增 `plugin/scripts/*.ts` 会同时踩多张闸，且它们的报错症状与真因**不同形**）：
   `capability-catalog.sh` 的声明表（键 = basename；六张表 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/
   MATCHING/CONSUMER；⛔ 值里不得含反引号或 `$(`）；CADENCE 必须与第 2 条的真实调用点一致——声明「每轮」
   而无调用点 ⇒ `rhythm-consumer-check` 判据1 红，CONSUMER 行缺失 ⇒ 判据2 红；quay-init closure ratchet 的
   提交基线 `docs/analysis/quay-init-closure-ratchet.baseline.json` 若因新增脚本超基线，按该检查器的
   `--reanchor` 重锚并贴出读数。**这些义务的逐字正本在各脚本自己的头注释里，不在本任务体内复制。**
6. **载体的归宿**：决定 `.quay/ci-runs.jsonl` 是 gitignored 运行时产物（同 `.quay/goal-round.jsonl` 族）
   还是 tracked，并**当场落实**——⛔ 不要让它以「未跟踪的脏文件」形态长期存在（脏树会挡 fan-in 与守卫）。
   决定与理由写进 Evidence。
7. **5b 扫描（先数再改）**：全仓搜「只在裸检出里红」的同类测试（同一形态的兄弟实例常在同目录）与载体路径的
   写入口，把命中数与前 3 条逐条贴出，每个命中的处置逐条列出。⛔ 只修被 CI 报出来的 11 条、不扫同类，
   就是 5b 的典型违反。
8. **收尾**：`bash scripts/test.sh --for-task gap-develop-ci-first-decisive-green` 绿。

## Acceptance Criteria

- [ ] **AC1（仪器落地，能取假）**：`plugin/scripts/ci-runs-collect.ts` 存在且 `git log -1 --format=%cI -- plugin/scripts/ci-runs-collect.ts` 非空；逐字重跑 AC-265 的 criterion（代码在 `goals/AC-265-goal.md` 的 `criterion:` 块内），贴出 exit code 与 stderr 全文，**必须不再是 `CAUSE=collector-not-landed`**。立案基线：文件不存在、判据 exit 1。
- [ ] **AC2（载体口径 + 字段能取假）**：真实采集后 `.quay/ci-runs.jsonl` 存在，贴出 ≥3 条记录的 `ts/branch/workflow/conclusion/runId/testFiles` 逐字，且每条 decisive develop run 的 `testFiles` 是**整数**。**负控制**：造一份缺 `__GROUP__` 行的输入（或等价对照），证明 `testFiles` 取「缺失」而**不是**回落到一个常量——一个恒值的字段会让反作弊关系退化成恒等式（硬规则 4）。
- [ ] **AC3（回填，判据的死因之一）**：载体中存在 `ts` **早于**采集器落地提交的 decisive develop run；打印落地前后各多少条、以及 green run 的「紧邻前一次 decisive run」的 `runId` 与 `testFiles`。⛔ 只报「判据 exit 0」而不报这个配对，区分不了「有关系可比」与「恰好在第 0 条上没得比」。
- [ ] **AC4（生产接线，非手工）**：采集器的调用点有 `file:line` 证据，并贴出一条**由该路径写入**（⛔ 不是手工 `node …` 跑出来）的载体记录及其时刻，以及该轮日志/事件里对应的调用痕。
- [ ] **AC5（真交付：develop 首次 decisive 绿）**：落地后存在一次 `branch=develop`、`conclusion=success` 的 CI run；贴出 `gh run view <id>` 的结论、其 `testFiles` 与紧邻前一次的 `testFiles`，以及 **AC-265 判据 exit 0** 的全文（落 `.quay/` 一个证据文件并在 Evidence 引用）。
- [ ] **AC6（⛔ 绿不是靠少跑测试换的）**：①绿 run 的 `__GROUP__ … files=N` ≥ 紧邻前一次 decisive run 的同读数（逐字贴）；②`git show --stat` 证明落地提交**没有删除或改名任何 `*.test.mjs`**、也没有缩小 `scripts/test.sh` 的 glob；③Finding 表 11 条逐条给出处置与**修前/修后**读数（`node --test <file>` 的 exit/tests/pass/fail/skip）；凡用 skip 守卫的，必须证明该守卫**以依赖缺席为条件**且**依赖在场时不触发**（正控制：本机跑同一条，skipped 计数不变）。
- [ ] **AC7（登记 + scoped 门）**：`bash plugin/scripts/capability-catalog.sh --entry-surface` 与 `node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check --root .` 均 exit 0；`bash scripts/test.sh --for-task gap-develop-ci-first-decisive-green` 绿。

## Definition of Done

- [ ] AC1–AC7 全勾；每条读数都是在本任务 worktree / 真 CI 上跑出来的，⛔ 不自述结论、不省掉失败读数与反例。
- [ ] **REAL LANDING（DIR-026 Reading A）**：交付的不是「仓库里多了一个采集脚本」，而是**载体 `.quay/ci-runs.jsonl` 里真实存在一条 develop 的 decisive green 记录，且它与紧邻前一次 decisive run 的 `testFiles` 关系成立**——判据 AC-265 在真载体上 exit 0。fixture / 注入数据不算（硬规则 4 推论三）。
- [ ] **反例判据**：若判据的 exit 0 由 fixture 或手工写入的载体记录达成、而不是由生产采集 + 真 CI run 达成，本任务**未达成**——执行时须能指出「这条 green 记录是哪一次真实 run 的 `runId`」。
- [ ] 若某次 run 因 25 分钟 job 超时被杀（`timedOut`），如实记为时间预算问题并给出该 run 的读数，⛔ 不把它包装成「已绿」。
- [ ] 11 条的处置表 + 5b 扫描的命中数与前 3 条，逐条落 Evidence。

## Touches

- plugin/scripts/ci-runs-collect.ts (new)
- plugin/test/ci-runs-collect.test.mjs (new)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/goal-driver.ts
- .gitignore
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/test/axis-generator.test.mjs
- plugin/test/launch-settings.test.mjs
- plugin/test/outer-cron-registry.test.mjs
- plugin/test/prod-data-audit.test.mjs
- plugin/test/direct-to-develop-bypass-check.test.mjs
- plugin/test/long-term-guarantee-goal-backed-check.test.mjs
- packages/quay-native/test/goal-ac-write-face.test.mjs
- packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs
- packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs
- tasks/gap-develop-ci-first-decisive-green.md
