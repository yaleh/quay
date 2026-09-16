---
id: gap-dashboard-driver-status-card-ci-red
title: gap-dashboard-driver-status-card.test.mjs 在 GitHub CI 上 5 个断言真实失败，本地未复现过
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-265
---
## Finding

2026-09-16 `develop` push 后的 CI run（`https://github.com/yaleh/quay/actions/runs/35054411272`，
job `test` id `104661434192`）里，`packages/quay/test/gap-dashboard-driver-status-card.test.mjs`
以 `passed=false` 收尾（`04:20:30.3591923Z`），5 个断言真实失败（发生在 25 分钟超时把整个 job 杀掉**之前**，
与超时无关）：

```
✖ AC1: readDriverStatus matches aliveness()+carrierStats() field-by-field (all kinds alive)
    AssertionError [ERR_ASSERTION]: one reading per KNOWN_KINDS
✖ AC1: ...（pid 缺失 → dead）
    AssertionError: reading for promotion must be present
✖ AC1: ... matches `driver-runtime.ts status --json`（kernel 子进程端到端）
    AssertionError: reading for promotion must be present
✖ AC7: 5 个存活 kind 渲染「运行中」...
    AssertionError: promotion must render 运行中
✖ AC7 负控制: 删 pid 文件 ⇒ ...
    AssertionError: quality must start 运行中
```

该测试文件本身是自包含的（`makeTmpDir` 隔离临时目录 + 手写 fixture pid/carrier 文件，`writeAllFixtures`
对 `KNOWN_KINDS` 逐一写好，不依赖任何环境里真实常驻的 driver 进程），所以"CI 环境没有本地那种常驻 driver
进程"这个最直观的猜测**站不住**——测试本来就不该依赖真实进程存活。

真正的信号是第一条断言：`readDriverStatus(root)` 返回的数组长度**少于** `KNOWN_KINDS.length`——
即至少有一个 kind 在这次调用里完全没有读数，而"缺的是哪个 kind"在不同断言里不一样（`promotion` 出现
两次，`quality` 出现一次），这更像**非确定性**（可能与 CI runner 的 CPU/并发限制相关——该测试对每个
KNOWN_KINDS 都会 `execFileSync` 起一个 `driver-runtime.ts status --json` 子进程，一个测试里就是六次
子进程调用，在共享/限流的 CI runner 上比本机更容易撞上时序问题），也可能是 `readDriverStatus`/
`aliveness`/`carrierStats` 遍历 `KNOWN_KINDS` 时的真实并发/遍历 bug——本任务不预判是哪一种，需要实测
区分（仓库里已有"负载相关 flake 不要往自己 delta 上找"的先例，但也不能不经复现就直接归为 flake）。

## AC

- [ ] 在人为限制 CPU/并发的本地环境（例如 `cpulimit`、Docker `--cpus`，或干脆并发跑多份同一测试文件制造资源争用）下重跑该测试 ≥5 次，统计"某个 kind 读数缺失"是否可复现，用来区分负载相关 flake 与确定性回归。
- [ ] 若确定性复现：定位 `readDriverStatus`（`packages/quay/src/observation.ts`）遍历 `KNOWN_KINDS` 时哪一步会漏掉某个 kind（例如子进程调用失败被吞掉却没有让对应 kind 落入返回数组），修复它。
- [ ] 若判定为负载相关 flake：不能只凭这一次 CI 红下结论——必须给出"同一份代码在低负载下必过"的负控制读数，并按仓库已有 flake 处理惯例登记（不是简单加 retry 掩盖）。
- [ ] 无论走哪条分支，`node --experimental-strip-types --test packages/quay/test/gap-dashboard-driver-status-card.test.mjs` 单独重跑需要给出至少 5 次连续绿的读数（而不是 1 次）。

## DoD

下一次 `develop` 分支触发的 GitHub CI `test` job 日志里，`gap-dashboard-driver-status-card.test.mjs`
以 `passed=true` 出现；若判定为已知负载相关 flake，则任务体/载体里留一条可核的判定依据（复现率、负控制读数），
而不是仅凭一次绿就视为解决。

## Touches

- packages/quay/src/observation.ts
- packages/quay/test/gap-dashboard-driver-status-card.test.mjs
- tasks/gap-dashboard-driver-status-card-ci-red.md
