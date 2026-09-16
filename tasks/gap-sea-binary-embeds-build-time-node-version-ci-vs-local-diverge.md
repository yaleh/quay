---
id: gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge
title: SEA 二进制嵌入构建时 PATH 上的 node 本体——CI pin Node 20、本机开发环境 Node
  25，同一脚本两处产出不同运行时（npm/SEA 渠道，按 GOAL-019 origin 裁定暂缓，不阻塞当前工作）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

**实测（2026-09-16，直接读脚本原文，非推断）**：`packages/quay/scripts/build-sea.sh`（`packages/quay-native/scripts/build-sea.sh` 同构）第 [4/6] 步：

```
echo "[4/6] Copying node binary as the executable base..."
NODE_BIN="$(command -v node)"
cp "${NODE_BIN}" "${EXE}"
```

即 SEA 可执行文件的"底座"就是**构建当时 PATH 上解析到的那个 node 二进制本体**，而不是某个锁定版本下载/校验后的产物。

`.github/workflows/release.yml` 的 `sea-release` job 显式 `actions/setup-node@v4` `node-version: '20'`，
即 **CI 产出的三平台 SEA 二进制都嵌入 Node 20**。而本仓库 CLAUDE.md 明文记录"开发机 Node 25"——
若有人在本机直接跑同一份 `build-sea.sh`（脚本本身完全相同，未被改写），产出的 SEA 二进制会**嵌入 Node 25**，
而不是 CI 产出的 Node 20。

⇒ 这是"构建脚本相同"不能推出"构建产物一致"的一个真实反例（对照 `plugin/scripts/publish-dist-branch.sh`
一类——那条路径不受此影响，因为它产出的是纯 JS bundle，不嵌入宿主 node 二进制）。目前没有任何机制/判据
钉住"SEA 产物嵌入的 Node 版本 = release.yml 声明的 Node 20 floor"这件事——`dist-verify-node-floor` job
验证的是 **npm tarball**（`dist/quay.js`）能在 Node 20 上跑，不是 SEA 二进制自身嵌入的是哪个 Node。

**范围澄清**：这属于 npm/SEA 发布渠道，按 `GOAL-019` 的 `origin`裁定（人 2026-09-15：「优先遵循 Claude Code
plugin 分发和部署实践，在这一目标实现前不考虑 npm」）**暂不列入当前优先工作**，本任务只是把这个已验证的
真实缺口记录下来，避免遗忘；不要求现在就修。

## Proposal（方向，具体落点由执行者按实际形态定）

1. 在 `build-sea.sh` 里显式校验/记录构建当时 `node --version`，并把它写入产物的一个可读位置
   （如随 SEA 归档一起打包一个 `BUILD_NODE_VERSION` 文本文件，或 `verify-sea-artifact.sh` 里加一条读数）。
2. 可选：让 `build-sea.sh` 支持锁定到某个具体 Node 版本（例如通过 nvm/n 或校验 `node --version` 与声明的
   floor 一致，不一致则 fail-closed），而不是隐式吃 PATH 上的任意 node。
3. 加一条能取假的判据：构建时刻的 `node --version` 与 SEA 产物内实际嵌入/运行时报告的版本一致
   （SEA 二进制启动时 `--version` 应能读出），并与 CI 声明的 floor（Node 20）做对照。

## Acceptance Criteria

- [ ] AC1 复现（本任务已提供，执行者核实即可）：`build-sea.sh` 第 [4/6] 步 `cp "$(command -v node)"`
      —— 构建时 PATH 上是什么 node，产物就嵌入什么 node。
- [ ] AC2 加一条判据：在两个不同 Node 版本的环境各跑一次 `build-sea.sh`，产出的两个可执行文件启动后
      报告的 Node 版本不同（负控制：证明"版本随构建环境变"这件事本身是真的，不是臆测）。
- [ ] AC3 修复后：CI 产出的 SEA 二进制的嵌入版本可被机械核实 = release.yml 声明的 floor（Node 20），
      且该核实写入某个持久载体（不是仅打印到 CI 日志里，随 run 过期不可查）。

## Definition of Done

- [ ] 至少落一条可长期复核的判据（CI 载体或 verify-sea-artifact.sh 的一条新检查），把"SEA 产物嵌入的
      Node 版本"从"隐式依赖构建机器环境"变成"显式声明 + 可核实"。
- [ ] 本任务不要求立刻修复——按 GOAL-019 origin 的优先级裁定，可以在该 GOAL 达成后再排期；但状态在此之前
      不应被误判为"无需处理"（它是一个已验证的真实缺口，不是观察项）。

## Touches

- `packages/quay/scripts/build-sea.sh`
- `packages/quay-native/scripts/build-sea.sh`
- `packages/quay/scripts/verify-sea-artifact.sh`
- `tasks/gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge.md`