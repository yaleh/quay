---
id: gap-metered-hosted-runner-jobs-to-self-hosted
title: 7 个 ubuntu-latest job 被 hosted runner 账单闸挡住未启动——迁到 self-hosted
  tokyo-alpha + 防回漂静态闸（AC-319）
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-319
---
## Proposal

**直接量（2026-09-24）**：develop CI run `35966264609` 的 `version-consistency` / `dist-verify-node-floor` 两个 job `runner_name=""`、`steps=0`，check-run annotation 逐字 *"The job was not started because recent account payments have failed or your spending limit needs to be increased"*。同一账单闸同形挡住 `ubuntu-latest` 上的全部 job：`ci.yml` 3 个（`dist-verify-node-floor` / `version-consistency` / `cold-start-e2e`）、`release.yml` 3 个（`verify-plugin-channel` / `create-github-release` / `advance-master`）、`publish-plugin-dist.yml` 1 个。只有 `ci.yml:test` 已在 `[self-hosted, tokyo-alpha]` 上（2026-09-16 迁移）。⇒ v0.12.0 的 release run 不可执行，master 停在 v0.11.0（按 AC-270 这是正确输出）。

**做法**：
1. 把上述 7 个 job 的 `runs-on` 改为 `[self-hosted, tokyo-alpha]`。**每个 job 保留自己的 `actions/setup-node@v4` + `node-version`**——tokyo-alpha 镜像自带 `node v10`、无 `npm`（上一轮镜像探针），⛔ 不得依赖 runner 自带的 node；`ci.yml:test` 已证明 setup-node 在该 runner 上可用。`dist-verify-node-floor` 的 Node 20 底线同样由 setup-node 提供。逐个 job 核对它用到的 CLI（`gh`/`jq`/`git` 镜像已有；`npm` 仅经 setup-node 提供）。
2. **容量**：当前只有 1 个在线 runner（`tokyo-alpha-1`）。8 个 job 全落一台会串行排队。实测一次 develop push 的总排队墙钟；若 `test` 被 release/cold-start 拖出自身 25m 超时，再在同机加 runner 实例（⛔ 不写死并发数，硬规则 4 推论二）。
3. **防回漂静态闸**：新建 `plugin/scripts/workflow-runner-self-hosted-check.ts`，判据与 AC-319 同一谓词（每个 workflow 的每个 job `runs-on` 含 `self-hosted`；表达式 / 无 `runs-on` 视为不合格；读不懂 ⇒ exit 3 NOT-EVALUATED，⛔ 不与 PASS 同形）。登记进 `runner-static-gate.ts` 的 `run_static_checks`（`@static-tier change`、`@static-object`、`@checker-count` +1），附 mutation case 与 capability-catalog 声明。**⚠️ 与 AC-319 共用谓词**：criterion 不能 import 仓库脚本（它是 goal 层独立测量），故二者是两份实现——在检查器头注释写明「与 goals/AC-319 同谓词，改一处须改另一处」，并在测试里加一条把两者对同一组 fixture 跑、结论必须一致的用例（防两份漂移，硬规则 5b）。

## AC

- [x] `grep -nE 'runs-on:\s*ubuntu-latest' .github/workflows/*.yml | wc -l` = 0（立条读数 7，能取假）
- [x] `node --experimental-strip-types plugin/scripts/workflow-runner-self-hosted-check.ts --root .` exit 0；对一份把任一 job 改回 `ubuntu-latest` 的副本 exit 1 且输出点名该 job；对无 workflow 目录 exit 3
- [x] `bash plugin/scripts/checker-mutation-cases/workflow-runner-self-hosted-check.sh` exit 0，且 `runner-static-gate.ts` 的 `@checker-count` 与实际 `run_checker` 数一致
- [x] 测试文件里存在一条用例：同一组 fixture 分别跑检查器与 `goals/AC-319-*.md` 的 criterion（经 `bash`），二者 pass/fail/not-evaluated 结论逐一相同
- [x] 逐 job 枚举（python+yaml，打印前 3 条命中）：在 7 个被迁移 job 中，凡 steps 的 `run:` 调用 `node`/`npm`/`npx` 的，都有一步 `uses: actions/setup-node@…`；缺者数 = 0（⛔ 不按全文件 grep 计数——计数不能证明每个 job 都有）
- [x] `quay goal gate AC-319 --dry-run` exit 0

## DoD

真跑：迁移后在 develop 上至少一次 push 触发的 CI run 里，`.quay/ci-runs.jsonl` 载体记录中被迁移的每个 job 都有非空 `steps`（证明真的在 self-hosted 上起跑，而不是再次「未启动」），并记下该 run 的排队+执行总墙钟。发布侧：经 release.yml 的 workflow_dispatch 真跑一次（v0.12.0 或下一版），`verify-plugin-channel` / `create-github-release` / `advance-master` 三个 job 在 self-hosted 上 conclusion=success，随后 `quay goal gate AC-270` 仍 exit 0（master 已由 advance-master 推进到该 tag）。若发布真跑失败，逐字记 runId + 失败 job + 首条决定性日志行，不宣告完成。

## Touches

- tasks/gap-metered-hosted-runner-jobs-to-self-hosted.md
- .github/workflows/ci.yml
- .github/workflows/release.yml
- .github/workflows/publish-plugin-dist.yml
- plugin/scripts/workflow-runner-self-hosted-check.ts (new)
- experiments/quay-perpetual-stream/scripts/workflow-runner-self-hosted-check.ts (new, symlink twin)
- plugin/scripts/checker-mutation-cases/workflow-runner-self-hosted-check.sh (new)
- plugin/test/workflow-runner-self-hosted-check.test.mjs (new)
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/capability-catalog-declarations.json
- docs/analysis/test-file-baseline.txt
- docs/analysis/suite-perfile-duration-baseline.json
