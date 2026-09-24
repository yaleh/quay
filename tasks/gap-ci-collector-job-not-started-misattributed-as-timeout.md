---
id: gap-ci-collector-job-not-started-misattributed-as-timeout
title: 采集器不读 runner_name/annotation——从未起跑的 job 被归因成 infra:job-timeout-reached；补
  job-not-started 独立取值
status: done
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

- [x] `grep -c runnerName plugin/scripts/ci-runs-collect.ts` ≥ 1，且测试用 run `35966264609` 的 jobs API 形态 fixture（`runner_name:""`, `steps:[]`, dur 132, timeout 2）断言：归因 signals 含 `infra:job-not-started:version-consistency`，**不含** `infra:job-timeout-reached:version-consistency`
- [x] 负控制：同 fixture 把 `runner_name` 改为 `"tokyo-alpha-1"`、`steps` 非空、dur ≥ timeout ⇒ 仍产出 `job-timeout-reached`（真超时不被新判据吞掉）
- [x] 缺键控制：fixture 无 `runner_name` 键 ⇒ 不产出 not-started（缺 ≠ 空串）
- [x] annotation 调用失败的 fixture ⇒ `notStartedCause: null` 且 not-started signal 仍在
- [x] `plugin/test/ci-runs-collect.test.mjs` 与 `plugin/test/ci-red-attribute.test.mjs` 全绿

## DoD

生产载体读数：落地后由真实采集写入 `.quay/ci-runs.jsonl` 的记录中，至少一条含 `runnerName` 键（证明采集面真的在取它；N 只计落地后的时间窗）。若落地后窗口内再次出现未启动 job，则该记录的 signals 含 `infra:job-not-started:<job>` 且带逐字 `notStartedCause`；若窗口内没有未启动 job，如实写「生产侧 not-started 分支尚无样本」，并以落地后记录里 `runnerName` 非空的 self-hosted job 证明取值链路通。

## 落地证据（2026-09-24，worktree `task/gap-ci-collector-job-not-started-misattributed-as-timeout`）

**AC1 机械读数**：`grep -c runnerName plugin/scripts/ci-runs-collect.ts` = **7**（≥1）；同文件 `runner_name` 命中 3、`annotation_level` 命中 5 —— 改动前这两个读数都是 0（`grep -ci annotation` = 0 是 Proposal 点名的根因）。

**逐条用例**（12 条，全部绿）：AC1（不可启动的 job ⇒ not-started 且同 job 无 timeout）、AC2（单变量负控制 ⇒ 真超时仍 timeout）、AC3（缺 `runner_name` 键 ⇒ 判不出 not-started，且**该夹具仍报 timeout** —— 这条对照证明 AC1 的「不产出 timeout」不是恒真回声）、AC3 配套（判据两个条件缺一不报，含 steps 键缺失）、SC11-1/2/3/3b（落键纪律：空串落、null/缺键不落）、SC11-4/5（annotation 失败 ⇒ `null` + signal 在；拿得到 ⇒ 逐字）、SC11-6/7（没有未启动 job ⇒ 不写键 / 离线缝不为成因破例）、SC11-9（响应形态）。两个测试文件合计 **tests 90 / pass 90 / fail 0**。

**真实 API 端到端证据**（`node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --limit 5 --log-fetch none --dry-run`，真打 `yaleh/quay`，2026-09-24）：job 读数落成 `version-consistency runnerName="" steps=0 dur=2~3s timeout=2min conclusion=failure`、`test runnerName="tokyo-alpha-1" steps=15`、`cold-start-e2e`（skipped）**没有 runnerName 键**（缺 ≠ 空串，跳过的 job 结构上进不了 not-started）；每条记录的 `notStartedCause` 都是 annotation 逐字：
*"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"*。
⇒ 取值链路（jobs API `runner_name` + check-runs annotations）**在真实 API 上端到端通**。同一批真实 run 里 `infra:job-not-started:version-consistency` / `:dist-verify-node-floor` 如期产出，并被同 run `test` job 的实质失败按既有规则压制为 `suppressed-by-substantive-failure:…`（方向正确：真缺陷不被基础设施信号洗掉，且「命中过、只是没定案」仍可见）。

**⛔ 真打 API 才发现的一条（单测夹具无从发现）**：annotations 端点返回的是**裸 JSON 数组**（实测原始字节），⛔ 不是 `{annotations:[…]}` 包一层。只认后者时生产侧**只落 `null`**，而 `null` 恰好也是「真的没拿到成因」的合法取值 ⇒「端点形态读错了」与「真的没有成因」同形（硬规则 3b）。现两种形态都收，SC11-9 钉住（同一 message 两种外壳都必须命中）。

**DoD 状态（诚实读数）**：本任务落地**前**的真实采集只写进 worktree，⛔ 未动生产载体 `.quay/ci-runs.jsonl`（那是常驻 loop 的运行时态）。故「落地后窗口内至少一条含 `runnerName` 键」这一条**由落地后的真实采集给出**，此处不声称已达成；落地后若窗口内没有未启动 job，则以记录里 `runnerName` 非空的 self-hosted job 证明取值链路通。

## Touches

- tasks/gap-ci-collector-job-not-started-misattributed-as-timeout.md
- plugin/scripts/ci-runs-collect.ts
- plugin/scripts/ci-red-attribute.ts
- plugin/test/ci-runs-collect.test.mjs
- plugin/test/ci-red-attribute.test.mjs
