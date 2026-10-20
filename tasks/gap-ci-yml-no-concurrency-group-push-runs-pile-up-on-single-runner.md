---
id: gap-ci-yml-no-concurrency-group-push-runs-pile-up-on-single-runner
title: ci.yml 没有 concurrency：develop 每次推送都排一整套 CI，单台 runner 下到达速率 > 处理速率，过期提交的
  run 占满队列
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：2026-10-20 的 CI 排队调查（人要求立案方案 B）。

**实测（2026-10-20，UTC，develop 的 push 触发 CI）**：
- 到达：约 48 个推送，逐小时 `1,1,8,2,5,9,9,8,1,4`，高峰 8–9 个/小时；
- 处理：单台 EPHEMERAL runner（`tokyo-alpha-1`）串行，已完成 31 个，约 3 个/小时；`test` job 中位 15 分钟（n=30，范围 12–25，25 为 `timeout-minutes` 上限）；
- 积压：到达减已完成 = 18 个排队，与队列实测一致；即使没有新推送也要约 6 小时才能清空；
- 成本无差别：只改 `tasks/` 的推送 26/47，其 `test` 中位 14 分钟，含代码的推送 15 分钟，没有快速通道。

**机制（按位置）**：`.github/workflows/ci.yml` 的 `on:` 为 `push` 与 `pull_request`（`branches: [master, develop]`）加 `schedule` 加 `workflow_dispatch`，**没有顶层 `concurrency:`，也没有 `paths` / `paths-ignore`**（`git log -S 'concurrency:' -- .github/workflows/ci.yml` 与 `-S 'cancel-in-progress'` 均无历史）。每次推送都排一整套完整 CI，哪怕它对应的提交已被后面的提交取代。

**事实上的"顶替"一直是手工的**：2026-10-20 手工用 `gh run cancel` 取消了 15 个过期排队 run，保留 develop 末端那个；`plugin/scripts/ci-runs-collect.ts` 的注释写着 "cancelled 占 develop run 的 ~43%（被后续 push 顶替）"，但 `plugin/scripts` 与 `.github/workflows` 内 grep `gh run cancel` / `cancel-in-progress` 均无命中，即仓库里没有任何自动取消机制，那些取消只能是手工或超时。本任务把这件事从手工变成机制（硬规则 9：守与不守在记录上无法区分的事，就造产物）。

**方案 B**：在 ci.yml 顶层加 `concurrency`，`group` 为 `ci-${{ github.event_name }}-${{ github.ref }}`，**不设 `cancel-in-progress`**。GitHub 语义：同组内已有 run 在执行时，新 run 进入 pending，**此前的 pending 被取消**，正在执行的 run 不被打断；每组最多 1 个在跑加 1 个待跑。不设 `cancel-in-progress` 的理由：它会杀掉正在跑的 `test`（约 15 分钟的工作），而正在执行的 run 恰是产出 decisive 读数的那个。`group` 带 `event_name` 的理由：避免推送把 `schedule` 的渠道断言或手动 `workflow_dispatch` 当作可顶替的对象。

**实现时要留意的后果**：
1. 中间提交不再各有一次 CI 读数（它们的 run 以 cancelled 结束）。`ci-runs-collect.ts` 按设计不把 cancelled 记作 decisive，所以"取得 decisive 读数"这类判据不受影响，但任何"每个提交都有一次 CI 读数"的假设都不再成立；worker 要在 `## Evidence` 里列出这类消费者。
2. 红灯率与本任务无关：同日 `test` 失败 13/30（只改 `tasks/` 的 7/17，含代码的 5/11），原因未调查，⛔ 本任务不处理。
3. 未验证：fan-in 在代码进入 develop 之前已跑过全量 suite，CI 的 `test` 在代码推送上可能是重复验证，两者配置是否等价没有核对，⛔ 不得据此在本任务里删减 CI。
4. `paths-ignore` 方案已评估并否决：本仓测试会读 `tasks/`、`goals/`、`orchestration/` 等目录（曾出现任务体里的 `status:` 行让多个套件变红），不能把"只改 tasks/"当作与测试无关。

先例：`plugin/test/ci-runner-container-recycle.test.mjs` 是"按位置断言某个 CI 配置性质"的同类测试；YAML 解析复用 `plugin/scripts/workflow-runner-self-hosted-check.ts` 所用的那套实现，⛔ 不要用 grep 判定（硬规则 2）。

## AC

- [x] AC0（worktree 内可验）：新增 `plugin/test/ci-workflow-concurrency.test.mjs`，把 ci.yml 解析成 YAML 后按位置断言：顶层存在 `concurrency` 映射；其 `group` 表达式同时含 `github.event_name` 与 `github.ref`；`cancel-in-progress` 缺省或为 false；该测试 exit 0
- [x] AC1（变异对照）：依次做三种变异——删去整个 `concurrency` 块、去掉 `group` 里的 `github.event_name`、把 `cancel-in-progress` 设为 true——每一种都必须使 AC0 的测试变红；把三次变红输出贴进本任务 `## Evidence`
- [x] AC2（不回归）：钉住 ci.yml 的既有测试仍全绿，至少 `plugin/test/workflow-runner-self-hosted-check.test.mjs`、`plugin/test/gate-dispatch-coverage.test.mjs`、`plugin/test/ci-runs-collect.test.mjs`、`plugin/test/ci-runner-container-recycle.test.mjs`；逐个贴出 exit 码
- [x] AC3（消费者清单）：在 `plugin/`、`packages/`、`scripts/`、`.github/` 范围内 grep `ci-runs.jsonl`、`gh run list`、`decisive`，在 `## Evidence` 列出所有假设"每个提交都有一次 CI 读数"的消费者，逐条给出结论（不受影响 / 受影响并说明）；只报被点名的一处不算完成（硬规则 5b）
- [ ] AC4（读生产载体，真实推送突发）：本变更进入 develop 之后，在 runner 忙碌期间连续推送 ≥3 次，读 `gh api repos/yaleh/quay/actions/runs` 确认同组内最多 1 个 pending、其余被顶替的 run 为 cancelled 且未启动任何 job；贴 run id 与读数（待外部）
- [ ] AC5（读生产载体，隔离性）：同一时段内一次 `schedule` 或 `workflow_dispatch` 触发的 CI 没有被推送顶替（其结论不是因推送而 cancelled）；贴读数（待外部）
- [ ] AC6（读生产载体，积压）：本变更进入 develop 之后的下一个推送高峰（≥6 个推送/小时）里，push 触发的 CI 排队数峰值 ≤ 1；贴逐 5 分钟采样（待外部）

## DoD

真实落地：在 tokyo-alpha 生产 runner 上，一次真实的推送突发里，过期提交的 CI run 被机械顶替（AC4 读数为证）而不是靠人手 `gh run cancel`，且正在执行的 `test` 没有被打断、schedule/dispatch 触发的 CI 没有被误顶替。仅"测试存在"不算达标。⛔ 不得为使读数好看而设 `cancel-in-progress: true`，也不得对 `tasks/` 推送跳过 `test`。

## Touches

- .github/workflows/ci.yml
- plugin/test/ci-workflow-concurrency.test.mjs
- tasks/gap-ci-yml-no-concurrency-group-push-runs-pile-up-on-single-runner.md

## Evidence

> 实现 2026-10-20，worktree `/home/yale/work/quay-worktrees/gap-ci-yml-no-concurrency-group-push-runs-pile-up-on-single-runner`，
> 分支 `task/gap-ci-yml-no-concurrency-group-push-runs-pile-up-on-single-runner`（commit `363a7f1a3`）。

### 变更（按位置）

`.github/workflows/ci.yml` 顶层（`on:` 与 `jobs:` 之间）新增：

```yaml
concurrency:
  group: ci-${{ github.event_name }}-${{ github.ref }}
```

`cancel-in-progress` **不写**（缺省即"不打断正在运行的 run"）——写了它就等于杀掉正在跑的 `test`（约 15 分钟），
而正在跑的 run 恰是产出 decisive 读数的那个。`group` 带 `github.event_name` 使 push 不能顶替
`schedule` / `workflow_dispatch` 触发的 run。⛔ 没有动 `on:`、没有加 `paths-ignore`（Proposal 第 4 条已否决）。

### AC0 —— 按位置断言（`plugin/test/ci-workflow-concurrency.test.mjs`）

用 `yaml` 包解析 `.github/workflows/ci.yml`（与 `plugin/scripts/workflow-runner-self-hosted-check.ts`
的 `loadYamlParser` 同一个实现），只读**解析后的文档**：注释在解析阶段就消失，所以"注释里提到
`concurrency`"在结构上不可能满足断言（硬规则 2）。判定读**顶层** `doc.concurrency`（不是某个 job 下的），
要求它是 mapping、`group` 同时含 `github.event_name` 与 `github.ref`（负前瞻排除 `github.ref_name` 这类更长标识符）、
`cancel-in-progress` 缺省或 false。失败**枚举**输出（硬规则 3：布尔会把"块没了 / group 写错 /
cancel-in-progress=true"压成同一个红）。

```
$ node --test plugin/test/ci-workflow-concurrency.test.mjs
✔ AC0 — ci.yml carries a top-level `concurrency` mapping
✔ AC0 — the concurrency group keys on BOTH the event and the ref
✔ AC0 — `cancel-in-progress` is absent or false (never true)
✔ AC0 — the whole predicate passes on the real ci.yml
✔ AC1 — mutation control: remove the whole `concurrency` block must turn the predicate RED
✔ AC1 — mutation control: drop `github.event_name` from the group must turn the predicate RED
✔ AC1 — mutation control: set `cancel-in-progress: true` must turn the predicate RED
ℹ tests 7 · ℹ pass 7 · ℹ fail 0
exit 0
```

### AC1 —— 变异对照（三次，真实文件上的真实红）

每次变异直接改工作树里的 `.github/workflows/ci.yml` → 跑同一个测试文件 → `git checkout --` 复原。
三次都是 `exit=1`，复原后 `git status --short` 为空。测试文件底部另有一组**常驻**变异对照
（对同一份真实文档做对象级变异，并先断言"变异真的改了文档"），所以这三个方向不会在后续重写中悄悄失效。

**变异 1 —— 删去整个 `concurrency` 块**（`exit=1`）：

```
✖ AC0 — ci.yml carries a top-level `concurrency` mapping
  AssertionError: ci.yml must carry a top-level `concurrency:` MAPPING (not a job-level one, not a bare string)
✖ AC0 — the whole predicate passes on the real ci.yml
    - top-level `concurrency:` is ABSENT — every push still enqueues a whole workflow, so an intermediate
      commit's run occupies the single runner behind the commit that superseded it
ℹ tests 7 · ℹ pass 2 · ℹ fail 5
```

**变异 2 —— 去掉 `group` 里的 `github.event_name`**（`exit=1`）：

```
✖ AC0 — the concurrency group keys on BOTH the event and the ref
✖ AC0 — the whole predicate passes on the real ci.yml
    - `concurrency.group` ("ci-${{  }}-${{ github.ref }}") does not contain `github.event_name` — a push
      would supersede a queued `schedule` tick or `workflow_dispatch` run and silently delete that reading
ℹ tests 7 · ℹ pass 4 · ℹ fail 3
```

**变异 3 —— `cancel-in-progress: true`**（`exit=1`）：

```
✖ AC0 — `cancel-in-progress` is absent or false (never true)
  AssertionError: `cancel-in-progress` must be ABSENT or false — the running `test` must not be killed (got true)
✖ AC0 — the whole predicate passes on the real ci.yml
    - `concurrency.cancel-in-progress` is true — it must be ABSENT or false: true kills the RUNNING `test`
      (~15 min), and the running run is the one that yields the decisive reading
ℹ tests 7 · ℹ pass 5 · ℹ fail 2
```

### AC2 —— 既有 ci.yml 测试不回归（逐个 exit 码）

| 测试文件 | exit | pass | fail |
|---|---|---|---|
| `plugin/test/workflow-runner-self-hosted-check.test.mjs` | 0 | 7 | 0 |
| `plugin/test/gate-dispatch-coverage.test.mjs` | 0 | 12 | 0 |
| `plugin/test/ci-runs-collect.test.mjs` | 0 | 60 | 0 |
| `plugin/test/ci-runner-container-recycle.test.mjs` | 0 | 2 | 0 |
| `plugin/test/ci-runner-env-prereqs.test.mjs`（额外：它直接解析 ci.yml） | 0 | 6 | 0 |

### AC3 —— 消费者清单

grep 范围 `plugin/ packages/ scripts/ .github/`（排除 `vendor/`），先给机械读数再逐条结论：

- `ci-runs.jsonl`：`plugin/` 13 个文件、`packages/` **0**、`scripts/` **0**、`.github/` **1**（`release.yml:542`，注释）。
- `gh run list`：**1** 处（`plugin/scripts/release-cut.mjs:802`，一条给人看的兜底消息字符串）。
- `gh run cancel`：**0** 处（除本任务新测试里的叙述性注释）。
- `decisive`：生产代码 4 处（`ci-runs-collect.ts`、`release-cut.mjs`、`goal-driver.ts`、`drivers.yml` 注释）；
  其余命中是同一个词的另一义（"决定性的判断"），与 CI 读数无关：`fan-in-materialize-check.ts:21`、
  `task-status-drift-check.ts:909`、`criterion-fidelity.ts:181`、`version-carriers.ts:177`。

逐条结论：

1. `plugin/scripts/ci-runs-collect.ts`（**唯一写面**）——记录 `conclusion ∈ {success,failure,cancelled}`；
   `decisive` 只取 `success|failure`，cancelled 记录不拉日志、不记分。**不受影响**：本变更的预期产物
   正是 cancelled 记录变多，采集器每轮仍然写记录，`collection-stalled` 不会因此误报。
   附注：`:584` / `:1397` 的注释"cancelled 约占 develop run 的 43%"会**偏小**（顶替机械化后占比上升）
   ——那是散文读数，不是判据。
2. `plugin/scripts/goal-driver.ts` —— 每轮调 `collectForRound` 并写 `ciRuns` 三态痕；不假设"每个提交一条"。**不受影响**。
3. `plugin/scripts/release-cut.mjs` —— `lastDecisiveCiRun` 明确排除 cancelled
   （`decisive = conclusion ∈ {success,failure}`，注释写明 `cancelled` 不是裁决）。**不受影响**。
4. `plugin/scripts/ci-red-attribute.ts` —— 只对 `conclusion=failure` 的记录做归因，cancelled 不参与。**不受影响**。
5. `goals/AC-265`（落地后存在一次 decisive develop run）、`AC-269`（落地后记录存在 + failure 带归因）——
   按 `conclusion` 过滤，或只要求"存在一条 decisive"。**不受影响**。
6. `goals/AC-267 / AC-268 / AC-270 / AC-274` —— 读 release run 且按 conclusion 过滤；push 合并不触及 release 渠道
   （`group` 带 `event_name` 也正是为了不误顶替 dispatch/schedule）。**不受影响**。
7. **`goals/AC-281`（superseded）** —— 它取"立案后**最新一次** develop CI run"，**没有** decisive 过滤，
   再要求其 `test` job `conclusion == success`。合流后最新的载体行可能是一条 `cancelled` 的顶替 run ⇒
   会瞬时给出 `latest-run-not-green` / `no-test-job-in-latest-run`。**受影响**（若重新锚定，需加 decisive 过滤；
   本任务不改判据）。
8. **`goals/AC-282`（superseded）** —— 同一"最新一次 run"读法，读该 run 的 `prereqProvision`；cancelled run 的
   test job 可能没有该派生字段 ⇒ `no-test-job-in-latest-run` / `prereq-provision-not-recorded`。
   **受影响**（同上；它自己的正文已标注窗口会闪）。
9. `.github/workflows/release.yml:542` —— `ci-runs.jsonl` 只出现在解释 `needs:` 为何包含
   `create-github-release` 的**注释**里，不读载体。**不受影响**（硬规则 2：注释不算命中）。
10. `plugin/scripts/drivers.yml:54-55` —— 采集开关 `ci_runs_collect` 的声明与注释，不是读数。**不受影响**。
11. `plugin/scripts/capability-catalog-declarations.json` —— 上述脚本的登记/失效前提文本。**不受影响**。
12. `packages/`、`scripts/` —— `ci-runs.jsonl` 0 命中；`decisive` 的命中都是别义。**不受影响**。
13. 测试侧（`plugin/test/ci-runs-collect.test.mjs`、`ci-red-attribute.test.mjs`、`release-cut.test.mjs`、
    `goal-driver-s0*.test.mjs`）——用 fixture 或显式构造的载体行，不读生产载体。**不是生产消费者**。

### 待外部

AC4 / AC5 / AC6 需要本变更先进入 develop 并触发真实推送突发，执行者在 worktree 内无法满足；
它们已按 `（待外部）` 标注（`awaiting-verification` 形态），DoD 的"真实落地"同样待这些读数。
