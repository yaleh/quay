---
id: gap-ci-collector-job-not-started-misattributed-as-timeout
title: 采集器不读 runner_name/annotation——从未起跑的 job 被归因成 infra:job-timeout-reached；补
  job-not-started 独立取值
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**缺陷（2026-09-24 实测）**：run `35966264609` 的 `version-consistency` job：jobs API 读数 `runner_name=""`、`steps=[]`、`started_at == created_at`（06:48:06）、`completed_at` 06:50:18 ⇒ `durationSec=132`；`timeoutMinutes=2`。`ci-red-attribute.ts:237` 的 `dur >= to*60` 因此产出 `infra:job-timeout-reached:version-consistency`。**但该 job 从未拿到 runner**——`timeout-minutes` 只计执行时间，它根本没撞到自己的超时；132s 是排队到被拒的时长。check-run annotation 逐字给出真因：*"The job was not started because recent account payments have failed or your spending limit needs to be increased"*。⇒ 「从没起跑」被报成「超时」，与「跑到一半挂死」共用同一个 signal（硬规则 3b / 4b：一个由间接形态推出的量冒充了直接量）。

**根因**：`ci-runs-collect.ts` 的 `GhJob` 不含 `runner_name`（`grep -c runner_name` = 0），也从不读 annotation（`grep -ci annotation` = 0）。jobs API 本来就返回 `runner_name`，是免费的直接量。

**做法**：
1. **主判据（直接量）**：采集器把 `runner_name` 写进 job 读数（键名 `runnerName`；API 给 `null` / 缺键 ⇒ 不写键，缺 ≠ 空串，硬规则 6）。`ci-red-attribute.ts` 新增 `infra:job-not-started:<job>`，条件 `runnerName === "" ∧ steps 为空`；**它与 `job-timeout-reached` 互斥且优先**——not-started 成立时不再产出同 job 的 timeout signal。
2. **成因补充（非唯一信号源）**：仅对 conclusion=failure 且 not-started 的 job 调 `/repos/<repo>/check-runs/<job_id>/annotations`，取 `annotation_level=failure` 的 message 写入 `notStartedCause`（逐字，截断长度写死在一处常量）。annotation 调用失败 ⇒ 写 `notStartedCause: null` 并在 signal 上保留 not-started（⛔ 不因拿不到成因就回落成 timeout）。
3. 回填：对载体里已有的记录**不改写**（历史载体不重算）；新行为只对落地后采集的记录生效。

<!-- dedup-ref -->
关联：AC-269（每条 failure 带三值归因——本任务修的是 infrastructure 这一值内部的**成因正确性**，不改三值集合）；与 `gap-metered-hosted-runner-jobs-to-self-hosted` 是一对（那条消除未启动的发生源，这条让它发生时在台账上可区分）。

## AC

- [ ] `grep -c runnerName plugin/scripts/ci-runs-collect.ts` ≥ 1，且测试用 run `35966264609` 的 jobs API 形态 fixture（`runner_name:""`, `steps:[]`, dur 132, timeout 2）断言：归因 signals 含 `infra:job-not-started:version-consistency`，**不含** `infra:job-timeout-reached:version-consistency`
- [ ] 负控制：同 fixture 把 `runner_name` 改为 `"tokyo-alpha-1"`、`steps` 非空、dur ≥ timeout ⇒ 仍产出 `job-timeout-reached`（真超时不被新判据吞掉）
- [ ] 缺键控制：fixture 无 `runner_name` 键 ⇒ 不产出 not-started（缺 ≠ 空串）
- [ ] annotation 调用失败的 fixture ⇒ `notStartedCause: null` 且 not-started signal 仍在
- [ ] `plugin/test/ci-runs-collect.test.mjs` 与 `plugin/test/ci-red-attribute.test.mjs` 全绿

## DoD

生产载体读数：落地后由真实采集写入 `.quay/ci-runs.jsonl` 的记录中，至少一条含 `runnerName` 键（证明采集面真的在取它；N 只计落地后的时间窗）。若落地后窗口内再次出现未启动 job，则该记录的 signals 含 `infra:job-not-started:<job>` 且带逐字 `notStartedCause`；若窗口内没有未启动 job，如实写「生产侧 not-started 分支尚无样本」，并以落地后记录里 `runnerName` 非空的 self-hosted job 证明取值链路通。

## Touches

- tasks/gap-ci-collector-job-not-started-misattributed-as-timeout.md
- plugin/scripts/ci-runs-collect.ts
- plugin/scripts/ci-red-attribute.ts
- plugin/test/ci-runs-collect.test.mjs
- plugin/test/ci-red-attribute.test.mjs
