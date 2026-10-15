---
id: gap-ci-mutation-fixture-profiles-role-coverage-tmpfs-always-red
title: develop CI 自 2026-10-14 起 100/100 红：profiles-role-coverage-check 的
  mutation 夹具在 tmpfs /tmp 上跑 quay init 被拒 ⇒ always-red，阻塞 v0.20.0 正式发布
status: needs-human
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

**真实读数（2026-10-15，quay-fleet Manager 会话 + quay 发布会话 `0aa4332a-…` 只读核实）**
- `gh run list --branch develop --workflow ci.yml --limit 100`：**100/100 failure**，区间 2026-10-14T03:46:35Z – 2026-10-15T06:13:31Z；最近一次 success 是 2026-10-10T03:04:40Z（headSha `2b8dd5689`）。develop 已连续数十个任务落地无一次 CI 绿。
- 最新失败 run `38691147885`（headSha `aa3cbd10a`）`test` job（发布会话读日志）：`checker-mutation-check` 把 `profiles-role-coverage-check` 判为 **always-red**——其 mutation 夹具 `plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh` 以 `/tmp` 为 workdir 跑一次真实 `quay init`，而 `quay init` 现对 tmpfs worktree-root fail-closed 拒绝（`packages/quay/src/init.ts` 约 1464–1470 行 `validateWorktreeRoot` ⇒「worktree root … is on tmpfs」）；CI 自宿主 runner（`tokyo-alpha`，本机 `gh-runner-quay` 容器）以 `--tmpfs /tmp` 运行 ⇒ baseline 一步即 NOT-EVALUATED（exit 3≠期望 0）⇒ always-red。本机 `/tmp` 非 tmpfs，同脚本 GREEN ⇒ 只在 CI 容器上复现。
- 后果：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §3 的切版前置「上一次 decisive CI 绿」不成立 ⇒ v0.20.0 正式发布被阻（发布会话已按边界停下，未切版、未打 tag、未 push）。

## Plan

1. 让该 mutation 夹具不依赖 `/tmp` 的文件系统类型：workdir 改为真实磁盘路径（如仓库内 gitignored 的临时目录或 `$RUNNER_TEMP`/`mktemp -d -p <disk path>`），或显式传 `--worktree-root <真实磁盘路径>` 给 `quay init`。⛔ 不放宽 `quay init` 对 tmpfs 的拒绝（那是 2026-08-04 OOM 的防线）。
2. 用与 CI 相同的条件复现：在一个 `--tmpfs /tmp` 的容器（或等价挂载）里先跑一次改动前得红，改动后得绿（A/B）。
3. 推上 develop 后读一次真实 CI 结论。

## Acceptance Criteria

- [ ] AC1: 在 `/tmp` 为 tmpfs 的环境下，改动前 `checker-mutation-check` 对 `profiles-role-coverage-check` 判 always-red、改动后判 GREEN（粘贴 A/B 原文读数与复现命令）。
- [ ] AC2: `quay init` 对 tmpfs worktree-root 的拒绝逻辑未改动（`git diff` 不含 `packages/quay/src/init.ts`）。
- [ ] AC3: 落地后 develop 上一次真实 `ci.yml` run 的 `test` job 不再因该检查失败（粘贴 run id 与结论；若有其它失败如实列出，不在本任务内修）。

## Definition of Done

AC1–AC3 带真实读数勾选；不绕过任何门禁；不改 runner 配置。

落地标志：develop 上 ci.yml 的 test job 不再出现 profiles-role-coverage-check always-red；随后 quay 发布会话可按 SPEC §3「上一次 decisive CI 绿」前置执行 `bash plugin/scripts/release-cut.sh 0.20.0`。

## Touches

- plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh
- tasks/gap-ci-mutation-fixture-profiles-role-coverage-tmpfs-always-red.md

## Needs-Human

**执行 2026-10-15T06:32:55.196Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[AC3: 落地后 develop 上一次真实 `ci.yml` run 的 `test` job 不再因该检查失败（粘贴 run id 与结论；若有其它失败如实列出，不在本任务内修）。]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）
