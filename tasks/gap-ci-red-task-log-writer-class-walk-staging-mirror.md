---
id: gap-ci-red-task-log-writer-class-walk-staging-mirror
title: task-log (h) registry 同步测试的 walk 跟进 packages/quay/plugin 暂存镜像致 ENOENT/误报
status: todo
labels:
  - gap
  - ci-red
  - defect
parent: null
children: []
extra: {}
---
## Proposal

CI test job 里 `packages/quay/test/task-log.test.mjs` 的 `(h) the declared writer-class registry is IN
SYNC with every real appendTaskStatusEvent call site` 反复红，两种形态同一根因：`delivery-standalone-
smoke.sh`/`package.sh` 在 suite 运行中把 repo 根 `plugin/` 暂存成 `packages/quay/plugin/` 再 rm -rf。
该测试的 walk 遍历 `packages/` 时跟进了这个暂存镜像——镜像被删时 `readFileSync` 抛 ENOENT；镜像在场
时其 `scripts/ready-pool-check.ts` 被当成未声明的 appendTaskStatusEvent 调用点（registry 里只有
`plugin/scripts/...` 路径）。这是对暂存镜像的竞态，不是 registry 真脱节。

## Plan

在 walk 里跳过任何嵌套 `plugin` 目录（唯一合法的 `plugin/` 是 repo 根，已单独显式遍历）：
`if (e.name === "plugin" && full !== path.join(repoRoot, "plugin")) continue;`。

## AC

- [x] 本地 (h) 测试全绿。
- [x] walk 不再把 `packages/quay/plugin/**` 纳入调用点枚举；repo 根 `plugin/**` 仍被遍历。

## DoD

修复提交（377000a60）落地后，packaging 暂存镜像在场/被删时 (h) 测试都不红；真正的第五个写者未登记
时（新 appendTaskStatusEvent 调用点）仍会红。

该轴仍暗,理由:纯测试 walk 修复，不改动 L_D/L_G 依赖结构，本次提交未记录读数