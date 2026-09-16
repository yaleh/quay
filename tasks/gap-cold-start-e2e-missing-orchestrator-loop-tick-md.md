---
id: gap-cold-start-e2e-missing-orchestrator-loop-tick-md
title: cold-start-e2e 在 ubuntu-latest 上本身就是红的——缺
  orchestration/orchestrator-loop-tick.md（与 self-hosted runner 迁移无关，既存缺陷）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

在排查 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red`（tokyo-alpha self-hosted runner 环境缺口）过程中，作为负控制/AC3 排查的一部分，两次 `workflow_dispatch` 触发了 `.github/workflows/ci.yml` 的全部 4 个 job（含 `cold-start-e2e`），意外发现 **`cold-start-e2e` 这个 job 本身就是红的，而且是在 GitHub 官方托管的 `ubuntu-latest` 上跑的**——跟这次 self-hosted runner 迁移完全无关，是一个独立的既存缺陷，只是此前从未被真实触发过（该 job 的触发条件是 `if: github.event_name == 'workflow_dispatch'`，平时的 push/PR 从不跑它）。

**复现（两次独立跑，同一失败）**：
- run `35115599539`（2026-09-16T15:28Z，`task/gap-outer-tick-log-awk-mawk-interval-red` 分支）
- run `35119940633`（2026-09-16T16:08Z，`task/gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red` 分支）——`cold-start-e2e` job 在 `Image: ubuntu-24.04`（GitHub 托管，非 self-hosted）上运行，`startedAt` 16:08:16Z / `completedAt` 16:08:50Z，`conclusion: failure`。

**失败原文**：
```
install source has quay-init.sh + orchestrator-loop-tick.md (inner-state.sh retired, not required)
FAIL: missing file: /tmp/tmp.h5lIjSnDjC/empty-project/orchestration/orchestrator-loop-tick.md
#    resolve step is NOT optional, because `uninstall --scope project` FAILS outright when the ...
```
即 `test/cold-start-e2e.sh --from-build`（该 job 唯一的执行步骤）断言构建产物里应当含 `orchestration/orchestrator-loop-tick.md`，但从构建产物安装出来的空项目里没有这个文件。

## Requested action

查清 `orchestrator-loop-tick.md` 该由哪一步产出/laydown 到 `orchestration/` 下（`quay-init.sh` 的模板集，还是 `--from-build` 的打包脚本遗漏了它），修复后让 `cold-start-e2e` 在 `workflow_dispatch` 上真正转绿一次。

## Acceptance Criteria
- [ ] AC1: 定位 `orchestrator-loop-tick.md` 缺失的根因（laydown 模板漏收 / package 脚本漏打包 / cold-start-e2e.sh 断言的路径本身就不对，三选一，给出确凿依据，不是猜测）。
- [ ] AC2: 修复后 `bash test/cold-start-e2e.sh --from-build` 本地跑通（exit 0）。
- [ ] AC3: 用 `gh workflow run ci.yml` 触发一次真实 `workflow_dispatch`，`cold-start-e2e` job 转绿（`gh run view <id>` 链接落证据）——不满足于本地跑通，因为本地环境可能掩盖真实构建产物的缺口。

## Definition of Done
- [ ] 一次真实 GitHub Actions `workflow_dispatch` 触发的 `cold-start-e2e` job 转绿记录（run 链接）。

## Touches
- test/cold-start-e2e.sh（或其断言的构建产物路径）
- packages/quay/scripts/package.sh（若根因是打包脚本漏收模板）
- tasks/gap-cold-start-e2e-missing-orchestrator-loop-tick-md.md（自身）
