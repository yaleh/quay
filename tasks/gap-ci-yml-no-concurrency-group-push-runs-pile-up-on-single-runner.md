---
id: gap-ci-yml-no-concurrency-group-push-runs-pile-up-on-single-runner
title: ci.yml 没有 concurrency：develop 每次推送都排一整套 CI，单台 runner 下到达速率 > 处理速率，过期提交的
  run 占满队列
status: todo
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

- [ ] AC0（worktree 内可验）：新增 `plugin/test/ci-workflow-concurrency.test.mjs`，把 ci.yml 解析成 YAML 后按位置断言：顶层存在 `concurrency` 映射；其 `group` 表达式同时含 `github.event_name` 与 `github.ref`；`cancel-in-progress` 缺省或为 false；该测试 exit 0
- [ ] AC1（变异对照）：依次做三种变异——删去整个 `concurrency` 块、去掉 `group` 里的 `github.event_name`、把 `cancel-in-progress` 设为 true——每一种都必须使 AC0 的测试变红；把三次变红输出贴进本任务 `## Evidence`
- [ ] AC2（不回归）：钉住 ci.yml 的既有测试仍全绿，至少 `plugin/test/workflow-runner-self-hosted-check.test.mjs`、`plugin/test/gate-dispatch-coverage.test.mjs`、`plugin/test/ci-runs-collect.test.mjs`、`plugin/test/ci-runner-container-recycle.test.mjs`；逐个贴出 exit 码
- [ ] AC3（消费者清单）：在 `plugin/`、`packages/`、`scripts/`、`.github/` 范围内 grep `ci-runs.jsonl`、`gh run list`、`decisive`，在 `## Evidence` 列出所有假设"每个提交都有一次 CI 读数"的消费者，逐条给出结论（不受影响 / 受影响并说明）；只报被点名的一处不算完成（硬规则 5b）
- [ ] AC4（读生产载体，真实推送突发）：本变更进入 develop 之后，在 runner 忙碌期间连续推送 ≥3 次，读 `gh api repos/yaleh/quay/actions/runs` 确认同组内最多 1 个 pending、其余被顶替的 run 为 cancelled 且未启动任何 job；贴 run id 与读数（待外部）
- [ ] AC5（读生产载体，隔离性）：同一时段内一次 `schedule` 或 `workflow_dispatch` 触发的 CI 没有被推送顶替（其结论不是因推送而 cancelled）；贴读数（待外部）
- [ ] AC6（读生产载体，积压）：本变更进入 develop 之后的下一个推送高峰（≥6 个推送/小时）里，push 触发的 CI 排队数峰值 ≤ 1；贴逐 5 分钟采样（待外部）

## DoD

真实落地：在 tokyo-alpha 生产 runner 上，一次真实的推送突发里，过期提交的 CI run 被机械顶替（AC4 读数为证）而不是靠人手 `gh run cancel`，且正在执行的 `test` 没有被打断、schedule/dispatch 触发的 CI 没有被误顶替。仅"测试存在"不算达标。⛔ 不得为使读数好看而设 `cancel-in-progress: true`，也不得对 `tasks/` 推送跳过 `test`。

## Touches

- .github/workflows/ci.yml
- plugin/test/ci-workflow-concurrency.test.mjs
- tasks/gap-ci-yml-no-concurrency-group-push-runs-pile-up-on-single-runner.md
