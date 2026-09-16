---
id: gap-cold-start-e2e-missing-orchestrator-loop-tick-md
title: cold-start-e2e 在 ubuntu-latest 上本身就是红的——缺
  orchestration/orchestrator-loop-tick.md（与 self-hosted runner 迁移无关，既存缺陷）
status: done
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
- [x] AC1: 定位 `orchestrator-loop-tick.md` 缺失的根因（laydown 模板漏收 / package 脚本漏打包 / cold-start-e2e.sh 断言的路径本身就不对，三选一，给出确凿依据，不是猜测）。
- [x] AC2: 修复后 `bash test/cold-start-e2e.sh --from-build` 本地跑通（exit 0）。
- [x] AC3: 用 `gh workflow run ci.yml` 触发一次真实 `workflow_dispatch`，`cold-start-e2e` job 转绿（`gh run view <id>` 链接落证据）——不满足于本地跑通，因为本地环境可能掩盖真实构建产物的缺口。

## Definition of Done
- [x] 一次真实 GitHub Actions `workflow_dispatch` 触发的 `cold-start-e2e` job 转绿记录（run 链接）。

## Evidence

**AC1 — root cause (option 3 of 3): the e2e's asserted paths were themselves stale.**
`quay-init` no longer writes `orchestration/` at all. SPEC-plugin-lifecycle-single-bundle-2026-09-02
§6 (裁定 6, `:187`) puts 「`orchestration/` tick 文档」and `docs/analysis/` under **⛔ 不再写入**, landed
in `6358b2cd6` ("AC168 收缩本体", 2026-09-08) — quay-init is a project initializer, not an installer.
The other two options are ruled out by measurement, not assumption:
- **(a) laydown template missed it** — `plugin/scripts/quay-init.sh` has NO `orchestration/` laydown code
  path left (`grep -E '^ *(write_template|cp|install|copy_one|mkdir -p).*orchestration'` → 0 hits).
- **(b) package script did not pack it** — the build artifact DOES carry it: `packages/quay/scripts/package.sh:39-40`
  ("The release tarball must carry the loop tick docs"), and in BOTH the red baseline and the green run the
  AC3 install-source assertion passes (`install source has quay-init.sh + orchestrator-loop-tick.md`).
- Baseline red is independent of the tokyo-alpha self-hosted runner migration: run `35119940633`, job
  `cold-start-e2e`, `runner_group_name="GitHub Actions"`, labels `["ubuntu-latest"]` — GitHub-HOSTED. The
  failing step is `Cold-start e2e (install the plugin from build artifacts, no --push)` with
  `FAIL: missing file: /tmp/tmp.h5lIjSnDjC/empty-project/orchestration/orchestrator-loop-tick.md`.
  It stayed invisible because the job is `workflow_dispatch`-gated and had never really run.

**AC2** — `bash test/cold-start-e2e.sh --from-build` → **exit 0** locally (wall-clock 13s; re-run on the
final commit → exit 0 again).

**AC3** — real `workflow_dispatch` on the task branch: run **`35126883036`**
(https://github.com/yaleh/quay/actions/runs/35126883036), job `cold-start-e2e` → `conclusion: success`,
GitHub-hosted `ubuntu-latest`, 17:14:01Z → 17:14:35Z, in-job `wall-clock: 11s (from-build=true)`, job
https://github.com/yaleh/quay/actions/runs/35126883036/job/104898003585. Two earlier dispatches were also
green (`35126406873` on `7903c12a2`, `35126702003` on `d2593375d`).

**Bidirectional negative controls (run before landing — the new assertions CAN fail):**
- `--sabotage loop/orchestrator-loop-tick.md` → AC3 fails naming the file (retained AC4 fail direction).
- a doctored install source whose quay-init also writes `orchestration/orchestrator-loop-tick.md` → LEG 2b
  fails naming it as outside the closed set.
- a doctored `CLOSED_SET_ITEMS` that regrows to include that path → LEG 2b PASSES and LEG 2c fails,
  proving 2c is not shadowed by 2b (the retired-surface control is independently live).

**hard rule 5b sweep** — the same dead premise survives in two more carriers: `test/cold-start-oneliner-e2e.sh`
(4 hits: `:142`, `:247`, `:248`, `:147/:162/:256`; DORMANT — in neither `scripts/test.sh` nor any CI job) and
`plugin/skills/cold-start/SKILL.md:36`. Recorded in the carrier (`test/cold-start-e2e.sh` header), NOT fixed
here: both are outside this task's `## Touches`.

## Touches
- test/cold-start-e2e.sh（或其断言的构建产物路径）
- packages/quay/scripts/package.sh（若根因是打包脚本漏收模板）
- tasks/gap-cold-start-e2e-missing-orchestrator-loop-tick-md.md（自身）
