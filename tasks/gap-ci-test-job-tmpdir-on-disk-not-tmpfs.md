---
id: gap-ci-test-job-tmpdir-on-disk-not-tmpfs
title: CI test job 把 TMPDIR 指向 runner 磁盘目录：runner 容器 /tmp 是 tmpfs，quay init
  拒绝且吃内存（与夹具修复互补）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

**真实读数（2026-10-15）**：`ci.yml` 的 `test` job 跑在自宿主 runner `tokyo-alpha`（本机 `gh-runner-quay` 容器）。该容器自 `gap-ci-runner-container-needs-user-systemd`（done，2026-10-10）起以 `--tmpfs /run`、`--tmpfs /tmp` 运行（容器内 systemd 需要）。develop 的 `ci.yml` 最近一次 success 是 2026-10-10T03:04:40Z（`2b8dd5689`），2026-10-11 起取到的 400 次 run 全部 failure。直接失败点是 `profiles-role-coverage-check` 的 mutation 夹具在 tmpfs `/tmp` 上跑 `quay init` 被拒（已立案 `gap-ci-mutation-fixture-profiles-role-coverage-tmpfs-always-red`，只修那一个夹具）。

**本任务**：从 job 层面让所有测试的临时文件落在磁盘上，而不是只修一个夹具——在 `test` job 的 `env:` 里设 `TMPDIR: ${{ runner.temp }}`（runner 的工作盘目录，非 tmpfs）。这同时消掉两类问题：① 任何在 `os.tmpdir()`/`mktemp` 下跑 `quay init` 的测试都会撞 tmpfs 拒绝；② 套件在 tmpfs `/tmp` 写临时文件直接吃容器内存。⛔ 不改 runner 容器的 `/run`、`/tmp` tmpfs（systemd 需要）；⛔ 不放宽 `quay init` 的 tmpfs 拒绝。

## Plan

1. 在 `.github/workflows/ci.yml` 的 `test` job `env:` 加 `TMPDIR: ${{ runner.temp }}`（若该 job 已有 env 块则追加）。
2. 本地用与 CI 等价的条件复现：在 `/tmp` 为 tmpfs 的环境（容器 `--tmpfs /tmp` 或等价 mount namespace）里分别以默认 `TMPDIR` 与 `TMPDIR=<磁盘目录>` 跑 `plugin/scripts/checker-mutation-cases/profiles-role-coverage-check.sh` 对应的 mutation 检查，记录 A/B。
3. 校验 workflow 语法。

## Acceptance Criteria

- [ ] AC1: `ci.yml` 的 `test` job 设置 `TMPDIR` 为 runner 工作盘目录（粘贴 diff）；其它 job 与 runner 配置不变。
- [ ] AC2: 在 tmpfs `/tmp` 条件下 A/B：默认 `TMPDIR` 时 `profiles-role-coverage-check` 的 mutation baseline 为 NOT-EVALUATED（quay init 拒绝 tmpfs），`TMPDIR` 指向磁盘目录时为 GREEN（粘贴复现命令与原文读数）。
- [ ] AC3: workflow 文件可被解析（`actionlint` 或 YAML 解析读数），且 `git diff` 不含 `packages/quay/src/init.ts`。

## Definition of Done

AC1–AC3 带真实读数勾选。落地后观测（不在 worker 内）：develop 上第一次真实 `ci.yml` run 的 `test` job 进入并完成测试套件阶段——粘贴 run id、结论、耗时与失败文件清单（若有，另行立案；若 25 分钟超时不够，如实记录供人裁定）。

## Touches

- .github/workflows/ci.yml
- tasks/gap-ci-test-job-tmpdir-on-disk-not-tmpfs.md
