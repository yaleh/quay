---
id: gap-ci-runs-collect-gh-fallback-defeats-unavailable-test
title: resolveGhBin 的硬编码绝对路径回退，让「gh 不可达」测试在真装了 gh 的机器/CI 上失真
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-265
---
## Proposal

`plugin/scripts/ci-runs-collect.ts:297` 的 `resolveGhBin` 按序探测：`env.QUAY_GH_BIN` → `env.GH_BIN` →
`env.PATH` 各目录 → `~/.local/bin/gh` → **四个硬编码绝对路径**（`/usr/local/bin/gh`、
`/opt/homebrew/bin/gh`、`/usr/bin/gh`、`/bin/gh`）。最后这一段**不受 `env.PATH`/`env.HOME` 覆盖影响**——
这是它的设计目的（常驻 driver 的 PATH 不保证含 `~/.local/bin`），但副作用是：`plugin/test/ci-runs-collect.test.mjs:344`
那条「gh 不可达」测试只靠把 `env` 覆写成 `{ PATH: "/nonexistent", HOME: "/nonexistent" }` 来模拟不可达，
**在任何一台把 `gh` 真的装在这四个硬编码路径之一的机器上（GitHub Actions 的 ubuntu 镜像默认预装 `gh`，
通常就在这几个路径下），这条模拟完全不生效**——`resolveGhBin` 照样会在硬编码回退里找到真实可执行的 `gh`，
`collectForRound` 不会返回测试期望的 `status: 'gh-unavailable'`。

<!-- dedup-ref -->
本机本地跑这条测试会过，是因为本机的 `gh` 只装在 `~/.local/bin/gh`（不在那四个硬编码绝对路径里）——
"本地绿、CI 红"的表象，根因是环境差异，不是随机 flake，也不是 `collectForRound` 本身的业务逻辑错误。
`AC-265`（GOAL-020，develop CI 需要一次 decisive 绿跑）因此间接受阻：2026-09-16 `develop` push 后的
CI run（`https://github.com/yaleh/quay/actions/runs/35054411272`）里，`ci-runs-collect.test.mjs`
在 `04:25:11` 以 `passed=false` 收尾，唯一红的正是这条：

```
✖ collectForRound — gh 不可达 ⇒ status='gh-unavailable'，⛔ 不静默写成 0 条 (1021.460781ms)
```

修法：给测试一个不依赖真实文件系统状态的方式去强制"不可达"——`resolveGhBin(env, isExec)` 本身已经支持
注入 `isExec`，但 `collectForRound`（`ci-runs-collect.ts:811` 调用处：`resolveGhBin(opts.env ?? process.env)`）
没有把这个参数透传出来给调用方（测试）覆盖。把它穿透（比如 `collectForRound` 的 opts 增加一个测试专用的
`ghIsExec` 覆盖，或等价机制），测试改用"强制 isExec 恒 false"而不是"猜测 PATH/HOME 能不能覆盖住所有可能装
gh 的位置"来模拟不可达。

## AC

- [ ] 在一台/一个环境里把 `gh` 放在 `resolveGhBin` 的某个硬编码回退路径上（真机没有权限就用等价 fixture：临时在 `/usr/bin/gh` 等路径放一个可执行占位文件，或改造测试注入层）复现"测试期望 gh-unavailable 但实际找到了 gh"，确认这就是 CI 红的根因，不是别的偶发因素。
- [ ] `collectForRound`（或 `resolveGhBin` 的调用点）暴露一个测试可控的钩子，让「gh 判定为不可达」不依赖真实文件系统当前状态。
- [ ] 用该钩子重写 `plugin/test/ci-runs-collect.test.mjs:344` 那条测试，在装了 gh 的环境（覆盖上面第一条的复现场景）下验证：修复前红、修复后绿。
- [ ] `node --experimental-strip-types --test plugin/test/ci-runs-collect.test.mjs` 全文件在本机以及（如可行）任一装有系统级 `gh` 的环境下都是 `passed=true`。

## DoD

下一次 `develop` 分支触发的 GitHub CI `test` job 日志里，`ci-runs-collect.test.mjs` 以 `passed=true` 出现——不是本地手跑一次充数（本地环境本来就不装系统级 gh，测不出这个问题）。

## Touches

- plugin/scripts/ci-runs-collect.ts
- plugin/test/ci-runs-collect.test.mjs
- tasks/gap-ci-runs-collect-gh-fallback-defeats-unavailable-test.md
