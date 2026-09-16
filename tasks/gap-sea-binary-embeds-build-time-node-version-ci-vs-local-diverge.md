---
id: gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge
title: SEA 二进制嵌入构建时 PATH 上的 node 本体——CI pin Node 20、本机开发环境 Node
  25，同一脚本两处产出不同运行时（npm/SEA 渠道，按 GOAL-019 origin 裁定暂缓，不阻塞当前工作）
status: done
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

## Finding（执行期实测补充，2026-09-16）

**Proposal §3 的"SEA 二进制启动时 `--version` 应能读出"这条取数路径不成立——实测否证。**
用一个最小 SEA（main 只 `console.log`）在 Node 20 与 Node 24 下各构建一次：`--version` / `-v` /
`-p process.version` **三者都只是把 main 跑一遍**（打印 main 的输出、exit 0），Node 自己的参数处理
被完全绕过、根本不进 node 的参数解析。生产 SEA 二进制同理：`./quay --version` 打印的是 quay 自己的
版本（`0.7.0-dev`），与里面的 Node 无关。
⇒ 因此"产物内嵌的 Node 版本"只能**从二进制字节里读**（本任务采用 `node.js/vX.Y.Z` 与 config.gypi
里的源码 tarball URL 两个锚点，实测在 v20.19.0 与 v24.19.0 官方构建上都存在且一致）。
这正是硬规则 4c 的形态：判据点名的量必须穿过所有中间层还取得到——`--version` 这个量在 SEA 这一层就没了。

**另一个实测**：blob 与底座 node 的版本必须匹配。用 Node 24 生成的 blob 注入 Node 20 底座，产出物
启动时**静默无输出**（不报错、不打印）——所以"能构建"同样不蕴含"能运行"。

## Proposal（方向，具体落点由执行者按实际形态定）

1. 在 `build-sea.sh` 里显式校验/记录构建当时 `node --version`，并把它写入产物的一个可读位置
   （如随 SEA 归档一起打包一个 `BUILD_NODE_VERSION` 文本文件，或 `verify-sea-artifact.sh` 里加一条读数）。
2. 可选：让 `build-sea.sh` 支持锁定到某个具体 Node 版本（例如通过 nvm/n 或校验 `node --version` 与声明的
   floor 一致，不一致则 fail-closed），而不是隐式吃 PATH 上的任意 node。
3. 加一条能取假的判据：构建时刻的 `node --version` 与 SEA 产物内实际嵌入/运行时报告的版本一致
   （SEA 二进制启动时 `--version` 应能读出），并与 CI 声明的 floor（Node 20）做对照。

## What landed（执行结果）

**单一声明源**：`release.yml` 顶层 `env: SEA_NODE_VERSION: '20'` —— 这一处是唯一字面量，
`setup-node`（经一个 `id: sea-node-floor` 的 step output）、"runner 是否真在该 floor 上"的守卫、
两个 `build-sea.sh` 调用、assemble、verify 全部由它派生。

**写入侧**（`packages/{quay,quay-native}/scripts/build-sea.sh`）：在 [4/6]/[4/5] 拷贝 node 本体处
调用 `record_build_node_version`，把构建当时的 `node --version` 写到 `<exe-name>.build-node-version`
（与可执行文件并列、随归档一起发布）；并与 `SEA_NODE_VERSION` 对照——默认**告警**，`SEA_STRICT_NODE_FLOOR=1`
时 **fail-closed**（CI 两个 build step 都设它）。新增 `--record-build-node-version` 快速路径，
让测试跑真代码而非复述实现（对齐既有 `--stage-plugin-only` 的形态）。

**核实侧**（`packages/quay/scripts/verify-sea-artifact.sh`）：新增 check (c) 与 `--extract-node-version` 子命令。
check (c) 做三个读数的互校，任一不一致或**读不出来**都 fail-closed（未评估不得报 PASS）：
① 从二进制**字节**里读出的版本；② 构建记录的 `<exe>.build-node-version`；③ 声明的 floor。

**CI 接线**：`sea-release` 在**上传前**对三平台各自组装出的归档跑 check (c)；两个无 checkout 的
node-free job（Linux 容器 / macOS+Windows）按硬规则 5b 同样补上**对已下载资产**的字节级镜像检查
（各自多两行注释说明与正本的同步义务）。

**为什么判据能取假**（实跑，同一份未被改写的 `build-sea.sh`）：
```
Node 24 环境构建 → 记录 v24.19.0，字节读出 v24.19.0
Node 20 环境构建 → 记录 v20.19.0，字节读出 v20.19.0
装成 bundle 后：SEA_NODE_VERSION=20 判 Node-20 bundle → PASS；判 Node-24 bundle → exit 1
              （ERROR: 'quay' embeds Node v24.19.0, but release.yml declares the SEA Node floor as 20）
```

## Acceptance Criteria

- [x] AC1 复现（本任务已提供，执行者核实即可）：`build-sea.sh` 第 [4/6] 步 `cp "$(command -v node)"`
      —— 构建时 PATH 上是什么 node，产物就嵌入什么 node。
      核实：读原文确认；并实跑两次（Node 24 / Node 20 环境各一次完整 `build-sea.sh`），
      产出的两个二进制的字节读数为 v24.19.0 / v20.19.0。
- [x] AC2 加一条判据：在两个不同 Node 版本的环境各跑一次 `build-sea.sh`，产出的两个可执行文件启动后
      报告的 Node 版本不同（负控制：证明"版本随构建环境变"这件事本身是真的，不是臆测）。
      核实（两种形态，都实跑）：①最小 SEA，同一份 main/配置，Node24 构建→ `startup-reported node: v24.19.0`，
      Node20 构建→ `startup-reported node: v20.19.0`；②生产脚本，同一份未改写的 `build-sea.sh`
      在两个环境产出嵌入 v24.19.0 / v20.19.0 的两个 quay 二进制。
      **执行期修正**：AC 原文的"启动后报告"若指 node 自己报版本，该路径**不存在**（见 Finding 补充）；
      形态①用 main 打印 `process.version` 给出了等价的真·运行时读数。
- [x] AC3 修复后：CI 产出的 SEA 二进制的嵌入版本可被机械核实 = release.yml 声明的 floor（Node 20），
      且该核实写入某个持久载体（不是仅打印到 CI 日志里，随 run 过期不可查）。
      核实：`release.yml` 的 `sea-release` 在**上传前**对每个平台的归档跑 `verify-sea-artifact.sh`，
      check (c) 从字节读出嵌入版本并与 `SEA_NODE_VERSION=20` 对照，不符即 fail-closed（已实跑两向验证）。
      **持久载体** = 随归档发布的 `<exe>.build-node-version`（写在归档内、GitHub Releases 上长期可查）：
      任何持有归档的人可 `SEA_NODE_VERSION=20 bash packages/quay/scripts/verify-sea-artifact.sh <解包目录>`
      独立复核，不依赖那次 CI run 的日志。

## Definition of Done

- [x] 至少落一条可长期复核的判据（CI 载体或 verify-sea-artifact.sh 的一条新检查），把"SEA 产物嵌入的
      Node 版本"从"隐式依赖构建机器环境"变成"显式声明 + 可核实"。
      落地形态：`release.yml` 顶层 `SEA_NODE_VERSION` 单一声明 + 两个 build script 的入库记录 +
      `verify-sea-artifact.sh` check (c) 的字节级互校 + CI 上传前 fail-closed 闸 + 两个下载侧镜像。
      新增测试 18 条（`sea-build-node-version.test.mjs` 5 条、`verify-sea-artifact.test.mjs` 13 条），
      其中包含对**真 node 二进制**跑提取器（与 `node --version` 相等）这一非自证判据，
      以及错误版本 / 记录与字节不符 / 缺记录 / 无二进制 / 未声明 floor 五条负控制。
- [x] 本任务不要求立刻修复——按 GOAL-019 origin 的优先级裁定，可以在该 GOAL 达成后再排期；但状态在此之前
      不应被误判为"无需处理"（它是一个已验证的真实缺口，不是观察项）。
      本任务**未**改变"开发机上仍会构建出嵌入 Node 25 的产物"这一事实（那属于 GOAL-019 的排期范围）；
      改变的是它**不再是隐式的**：记录在案、且 CI 侧一旦产出非声明版本的产物就会在上传前拦下。

## Touches

- `packages/quay/scripts/build-sea.sh`
- `packages/quay-native/scripts/build-sea.sh`
- `packages/quay/scripts/verify-sea-artifact.sh`
- `packages/quay/test/verify-sea-artifact.test.mjs`
- `packages/quay/test/sea-build-node-version.test.mjs`
- `.github/workflows/release.yml`
- `tasks/gap-sea-binary-embeds-build-time-node-version-ci-vs-local-diverge.md`
