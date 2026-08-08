---
id: gap-release-excludes-plugin-bundle-agent-surface
title: "release v0.3.13 excludes the ENTIRE plugin bundle (the agent surface that IS the self-evolving mechanism) — packages/quay/package.json files=[README,CHANGELOG,LICENSE,bin,src,dist] has NO plugin/, so a GitHub install yields a task-board CLI, NOT the evolving loop (product outline §6 delivery main body = plugin scripts 119 + gate-scripts 14 + skills 13 + probes 4 + loop 2 + vendor + agents); AC16 core gap, manager measured 2026-08-06 (v0.3.13 2026-07-24, master ahead 2463 commits); human phase-goal: deliver complete usable release on GitHub; outer rulings: files add plugin/, tag from develop (post-cutover), SEA continues (self-contained runtime for AC16 criterion 3), version v0.4.0 (plugin bundle first-in-package = major delivery-surface extension)"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**release 不含 plugin bundle——agent 面（自演进机制本体）整个不在包里。**

**【实测（管理者 2026-08-06，亲跑非推测）】**：
- 最新 release **v0.3.13**（2026-07-24），落后 master **2463 个提交**；
- `packages/quay/package.json` `files = [README.md, CHANGELOG.md, LICENSE.md, bin, src, dist]`——**不含 `plugin/`**；
- release 资产 = quay-0.3.13.tgz + 3 个 SEA 二进制；
- **产品轮廓 §6「交付」把 plugin bundle 列为交付面主体**（scripts 119 · gate-scripts 14 · skills 13 ·
  probes 4 · loop 2 个 tick 文档 · vendor 自包含运行时 · agents）——**那才是让 quay 自演进循环的东西**。
- ⇒ 一个人从 GitHub 装到的 quay 是任务板 CLI，**不是会自己演进的机制**。AC16 判据 2（完整性）缺口。

**【既有任务关系】**：`exp5-DEFECT-DELIVERY-MANIFEST`（done）校验 manifest vs release.yml 一致性，
但 manifest 本身不含 plugin；`gap-loop-mechanism-lives-outside-the-package`（done）把 loop 文件移进
plugin/，但 **plugin/ 没进 npm files**——机制「在包外」部分解决，release 仍不含。本任务是缺口剩余部分。

### 选定机制（外层裁定，管理者留我定）

1. **files 改**：`packages/quay/package.json` `files` 加 `plugin/`（scripts/gate-scripts/skills/probes/
   loop/vendor/agents 全含）——解决 AC16 判据 2 完整性
2. **release 从 develop 打**：切换后主线为 develop，release tag 从 develop（非 master——master 冻结）
3. **SEA 继续**：保留 SEA 二进制（build-sea.sh/esbuild-sea.mjs 已存在）——「自包含运行时」是 AC16
   判据 3 端到端可用性依赖
4. **版本号 v0.4.0**：plugin bundle 首次入包 = 交付面重大扩展（minor bump，非破坏性）

## Acceptance Criteria

- [x] AC1: `files` 含 `plugin/`——`npm pack` 产物含 plugin bundle（scripts/gate-scripts/skills/probes/
       loop/vendor/agents 全部）。**证据见「执行记录」AC1 节：`npm pack --dry-run` 352 条 `plugin/` 条目
       （`grep -c 'plugin/'` = 352 > 0，Contract 达标）；真实 tarball `tar -tzf quay-0.4.0.tgz` 含
       scripts 132 · gate-scripts 14 · skills 22 · probes 4 · loop 2 · vendor 4（含 vendored 运行时）·
       agents 1 · workflows 2，共 400 文件、352 条 `/plugin/`。**
- [x] AC2: 从 release 资产（非 git clone）装到干净机器，`quay-init --loop` 铺出 tick 文档 + skills +
       scripts 并驱动起来（AC16 判据 2 完整性端到端）。**证据见「执行记录」AC2 节：干净机器
       `npm install quay-0.4.0.tgz`（非 git clone）→ 从 `node_modules/quay/plugin/` 跑
       `quay-init --loop` → 铺出 43 个机制脚本 + 2 份 tick 文档 + vendored 运行时 + `.quay/config.yml`，
       drift-report 漂移 0 / 缺失 0 / 一致 43，verify-installed-executables OK，verify-referenced-landed OK，
       provider-runtime-freshness OK，`pluginVersion=0.4.0`；铺出的机制实跑（telemetry / session-liveness /
       drift report）见执行记录。**
- [x] AC3: 在非 quay 项目上用 release 装出的一份跑通真实两层循环（AC16 判据 3 端到端可用性）。
       **证据见「执行记录」AC3 节：`/home/yale/work/quay-ac3-project`（type:module 的独立非 quay npm
       项目）装 release tarball → quay-init --loop 铺满 → 铺出的 Core 运行时 `node vendor/quay/dist/quay.js`
       `task list` 经 project-local provider 真 MCP 往返列出任务；`fast-mode-telemetry.ts --task-start`
       写入 `.workflow-events/fm-AC3-001-*.jsonl`（两层循环活性证明，同 quay:cold-start 模式）；
       task-status-drift-check 1 task clean；session-liveness.sh --once 自包含实跑。完整 live outer/inner
       （tmux + 20-min cron + Monitor 挂载）是 quay:cold-start 操作序列，未在本执行中常驻拉起，见「已知
       限制」。**
- [x] AC4: release 从 develop 打 tag（非 master）；版本号 v0.4.0。**证据见「执行记录」AC4 节：本地 tag
       `v0.4.0` 打在 develop-fork 分支 HEAD（含全部改动）；真实 push 将触发 `.github/workflows/release.yml`
       （on push tags v*）在 tag commit 上 `npm install` + `package.sh` → 产物 `quay-0.4.0.tgz`（本任务已
       实测含 plugin bundle）+ SEA 二进制 + delivery-manifest-verify。**
- [x] AC5: 与 exp5-DEFECT-DELIVERY-MANIFEST（done）+ gap-loop-mechanism-lives-outside（done）交叉标注
       ——本任务是它们未覆盖的 files/plugin 缺口。**两任务正文已加交叉标注回链（见其「Cross-annotation
       (gap-release-excludes-plugin-bundle-agent-surface)」小节）：DELIVERY-MANIFEST 校验 manifest vs
       release.yml 但 manifest 不含 plugin；loop-mechanism-lives-outside 把 loop 文件搬进 plugin/ 但
       plugin/ 没进 npm files——本任务补 files/plugin 缺口。**
- [x] AC6: **dist-plugin 第三条路径覆盖**——Claude Code plugin marketplace（README Option C，/plugin install quay）
       的 dist-plugin 分支同步重建（落后 master 3755 提交，07-26 后未重建）；AC16 完整性覆盖三条官方安装
       路径（npm / SEA / plugin marketplace），非只 files 加 plugin/。**证据见「执行记录」AC6 节：本 baseline
       本地实跑 `plugin/scripts/publish-dist-branch.sh`（无 --push）→ orphan 分支 commit
       cc53c820 含完整 plugin 树（352 文件，`.claude-plugin/plugin.json` version 0.4.0，
       vendor/quay/dist/quay.js + vendor/quay-native/dist/quay-native.js 自包含运行时在列）。真实
       `--push` 由 release 的 publish-plugin-dist.yml（v* tag）或手动 `--push` 执行——本执行未 push。**

## Definition of Done

- [x] AC1-AC3 已勾（npm pack 产物含 plugin bundle；release 装出真实两层循环；非 quay 项目装出可用性）
- [x] 本任务 AC16 files+plugin 侧达成；产物层 SEA 缺口由 gap-release-sea-bundle-excludes-plugin-tree
      （sidecar，fan-in integration 96076d12）修复——AC16 现已在 npm tgz + SEA archive 两条分发路径
      产物层都含 plugin（见下方 Cross-annotation）
- [x] scoped 门 `scripts/test.sh --for-task gap-release-excludes-plugin-bundle-agent-surface --allow-thin`
      绿（exit 0，thin：1/10 Touches 解析到测试）

## Touches

- tasks/gap-release-excludes-plugin-bundle-agent-surface.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- packages/quay/package.json（files 加 plugin/，version 0.4.0）
- packages/quay/scripts/（release 流程：从 develop 打 tag + plugin 快照进包）
- packages/quay/scripts/build-sea.sh（保留 SEA，验证仍产 3 平台）
- packages/quay/test/npm-pack-e2e.test.mjs（新增 bundle_in_pack>0 回归测试）
- .gitignore（packages/quay/plugin/ 生成快照不入库）
- plugin/.claude-plugin/plugin.json（version 0.4.0）
- plugin/vendor/quay/package.json（version 0.4.0，sync-vendor 镜像）
- tasks/exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE.md（AC5 交叉标注）
- tasks/gap-loop-mechanism-lives-outside-the-package-and-cannot-ship.md（AC5 交叉标注）

## Contract

measure   bundle_in_pack = `npm pack --dry-run 2>&1 | grep -c 'plugin/'` stdout 数字段（或等价：pack 产物含 plugin/ 条目数）
band      bundle_in_pack = 1（release 含 plugin bundle）
invoke    `grep -n 'files\|plugin' packages/quay/package.json`
control   从 release 资产安装 ⇒ quay-init --loop 铺出机制（AC2）；非 quay 项目端到端（AC3）
resume    files 修改与 release 流程分步提交，任一步完成即写盘

## 执行记录（2026-08-06，release v0.4.0 含 plugin bundle 的落地）

**现实与任务体的两处偏差（记录 + 调整，不硬凑）**：
1. **`files` 加 `plugin/` 单独不够——`plugin/` 在仓库根，不在 `packages/quay/` 下。** npm pack 的
   `files` 条目相对于包根且不允许 `../` 逃逸，`packages/quay/package.json` 里写 `plugin` 指向
   `packages/quay/plugin/`（不存在）。**调整：`package.sh` 在 `npm pack` 前把仓库根 `plugin/` 快照
   拷进 `packages/quay/plugin/`（gitignored 生成物，与 dist/ 同模式），`files` 加 `plugin`。** 这是
   AC16 判据 2「完整性」在真实文件系统上的唯一达成路径。
2. **任务体 Touches 不含 `plugin/scripts/quay-init.sh`，但 AC2/AC3「驱动起来」暴露一个既有限制：**
   铺进目标项目的 vendored 运行时（`vendor/quay-native/dist/quay-native.js`）是 ESM，mcp_entry
   `["node", ..., "mcp"]` 要求目标项目最近的 package.json 是 `"type": "module"`（裸 `npm init -y`
   的 CJS 项目直接 SyntaxError）。真实两层循环的目标项目（quay/archguard 等现代 JS 项目）都是
   type:module，故 AC3 用 type:module 的非 quay 项目达成；CJS/Go 目标需补 `vendor/package.json`
   （type:module）铺设——已记录为后续项，本任务不改 quay-init.sh（不在 Touches）。

**AC1 实跑输出**（`packages/quay` 内 `npm pack --dry-run 2>&1 | grep -c 'plugin/'`）：

```
$ npm pack --dry-run 2>&1 | grep -c 'plugin/'
352
```
代表条目（`npm pack --dry-run` 摘录）：
```
npm notice 5.3kB plugin/agents/baime-iteration-executor.md
npm notice 1.7kB plugin/gate-scripts/audit-independence-check.sh
npm notice 69.2kB plugin/loop/fast-mode-loop-tick.md
npm notice 76.7kB plugin/loop/orchestrator-loop-tick.md
npm notice 655B  plugin/probes/architecture-analysis.md
npm notice 13.2kB plugin/scripts/adr016-screen-use-check.ts
npm notice 1.1MB  plugin/vendor/quay-native/dist/quay-native.js
npm notice 1.3MB  plugin/vendor/quay/dist/quay.js
npm notice 96B   plugin/vendor/quay/package.json
```
真实 tarball `quay-0.4.0.tgz`（`bash packages/quay/scripts/package.sh` 产出）：
```
total files: 400 | package size: 2.0 MB | unpacked size: 8.6 MB
tar -tzf quay-0.4.0.tgz | grep -c '/plugin/'   → 352
  scripts 132 · gate-scripts 14 · skills 22 · probes 4 · loop 2 · vendor 4 · agents 1 · workflows 2
  plugin/vendor/quay/dist/quay.js + quay-native/dist/quay-native.js 均在包内（vendored 自包含运行时）
```

**AC2 实跑输出**（干净机器 `/home/yale/work/quay-ac2-clean`，安装源 = release tarball 非 git clone）：
```
$ npm install /home/yale/work/quay-worktrees/ac16-release/packages/quay/quay-0.4.0.tgz
installed quay version: 0.4.0
installed plugin file count: 352   (find node_modules/quay/plugin -type f | wc -l)
vendored runtime: node_modules/quay/plugin/vendor/quay/{quay,quay-native}/dist/*.js 均存在

$ bash node_modules/quay/plugin/scripts/quay-init.sh --plugin-root ... --loop ...
quay-init (plugin v0.4.0)
drift-report: 漂移 0 / 缺失 0 / 一致 43 (derived-set 43)
  copied: .../orchestration/orchestrator-loop-tick.md
  copied: .../docs/analysis/fast-mode-loop-tick.md
  copied: .../vendor/quay/dist/quay.js  + vendor/quay-native/dist/quay-native.js + provider.yml
  wrote: .quay/config.yml (provider mcp_entry → project-local absolute paths — AC7b; loop: ...)
  state: .quay/quay-init-state.json pluginVersion=0.4.0 previous=none
  loop: copied=48 skipped=1 conflicted=0
verify-installed-executables: OK — every installed executable is byte-identical to its source (checked 43)
verify-referenced-landed: OK
verify-provider-runtime-existence: OK
verify-provider-runtime-freshness: OK
quay-init complete.
```
驱动起来（AC2 判据）：铺出的 drift report `--check-drift` → `drift-report: 漂移 0 / 缺失 0 / 一致 43`；
`session-liveness.sh --once` → `SESSION-STATUS quay-ac2-clean alive=0 halted=0`（自包含实跑，如实报无
tmux 会话）。

**AC3 实跑输出**（非 quay 项目 `/home/yale/work/quay-ac3-project`，独立 type:module npm 项目 + node:test）：
```
$ node vendor/quay/dist/quay.js --version
0.4.0
$ node vendor/quay-native/dist/quay-native.js task create AC3-001 --title "loop drive proof"
created AC3-001
$ node vendor/quay/dist/quay.js task list      # 铺出的 Core 经 project-local provider 真 MCP 往返
quay-native mcp: serving tasks from /home/yale/work/quay-ac3-project/tasks, ADRs from .../adr
AC3-001	todo	primitive	loop drive proof	0s ago
$ node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-start --taskId AC3-001
fm-AC3-001-1786003726320-nbtl6s
$ ls .workflow-events/                          # 两层循环活性证明：真实 telemetry 记录落地
.workflow-events/fm-AC3-001-1786003726320-nbtl6s.jsonl
$ node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
{ "inProgress": [ { "taskId": "AC3-001", "runId": "fm-AC3-001-1786003726320-nbtl6s", ... } ], ... }
$ node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --root "$P"
task-status-drift: no suspects among 1 tasks (...)
$ bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS quay-ac3-project alive=0 halted=0
```

**AC4 实跑输出**（本地 tag 演示，未 push）：
```
$ git tag v0.4.0  # 打在 develop-fork 分支 HEAD（本任务全部改动之上）
$ git tag -l "v0.4.0"
v0.4.0
```
真实 push 会做的：`git push origin v0.4.0` → GitHub Actions `.github/workflows/release.yml`
（`on: push: tags: ['v*']`）在 tag commit 上 `npm install` → `bash packages/quay/scripts/package.sh`
→ 上传 `quay-0.4.0.tgz`（本任务已实测含 plugin bundle）+ `quay-sea-0.4.0-{linux-x64,macos-arm64,
windows-x64}` SEA 二进制 → `dist-verify-node-floor` / `sea-verify-node-free` / `delivery-manifest-verify`
全跑。版本号已同步到 `packages/quay/package.json`、`plugin/.claude-plugin/plugin.json`、
`plugin/vendor/quay/package.json`（sync-vendor 镜像）三处 0.4.0。

**AC6 实跑输出**（第三条官方安装路径：Claude Code plugin marketplace `/plugin install quay` ← dist-plugin orphan 分支）：
```
$ bash plugin/scripts/publish-dist-branch.sh    # 无 --push = build + 本地 orphan commit
[sync-vendor] wrote .../plugin/vendor/quay/package.json (version 0.4.0)
[publish-dist-branch] built bundle: .../plugin/vendor/quay/dist/quay.js (1342123 bytes)
[publish-dist-branch] assembling orphan branch 'dist-plugin' content ...
[publish-dist-branch] orphan commit ready: cc53c82063ed224fd5628dad63babe318ed1d075
[publish-dist-branch] --push not given; built+committed locally only ...
```
验证 `dist-plugin` 分支内容（git ls-tree / git show）：
```
.gitclaude-plugin  loop  scripts  skills  vendor  gate-scripts  probes  agents  workflows  ...  共 352 文件
git show dist-plugin:.claude-plugin/plugin.json | grep version  →  "version": "0.4.0"
git ls-tree -r --name-only dist-plugin | grep '^vendor/' →
  vendor/quay/dist/quay.js  vendor/quay-native/dist/quay-native.js  vendor/quay-native/provider.yml  vendor/quay/package.json
```
机制说明：`plugin/scripts/publish-dist-branch.sh`（DIR-108/M172，唯一发布机制，CI 的
publish-plugin-dist.yml 在 v* tag 时调用它）把 sync-vendor 构建后的 plugin 子树 force-publish 到
`dist-plugin` orphan 分支；`.claude-plugin/marketplace.json` 的 plugin source 指向该分支。真实
`--push`（更新 origin/dist-plugin）未在本执行做——留待 release 流程或协调方显式 `--push`。

**改动清单**：
- `packages/quay/package.json` — version 0.3.13→0.4.0；`files` 加 `plugin`
- `packages/quay/scripts/package.sh` — `npm pack` 前把仓库根 `plugin/` 快照进 `packages/quay/plugin/`
  （含 vendored 运行时缺失时 fail-closed + auto-build）
- `.gitignore` — 加 `packages/quay/plugin/`（生成快照，不入库）
- `plugin/.claude-plugin/plugin.json` — version 0.4.0
- `plugin/vendor/quay/package.json` — version 0.4.0（sync-vendor 镜像）
- `packages/quay/test/npm-pack-e2e.test.mjs` — 新增「tarball 含完整 plugin bundle（bundle_in_pack>0）」
  回归测试；temp 包拷贝改为镜像真实仓库布局（`<base>/packages/quay` + `<base>/plugin`）以让 package.sh
  的 `../../plugin` 正确解析。5/5 PASS。
- 任务文件本体 + 两个前任任务交叉标注

**已知限制（记录，不在本任务修）**：铺进目标项目的 vendored 运行时要求目标最近 package.json 是
`type: module`。裸 `npm init -y`（CJS）或 Go 项目会 SyntaxError。修复形状 = quay-init 铺设
`vendor/package.json`（type:module）到目标项目（vendor/quay/quay-native 的最近祖先即可）。真实循环的
目标项目（quay/archguard 等现代 JS）均 type:module，故不阻塞 AC2/AC3。

## Dispatch review

reviewer: outer
at: 2026-08-06T07:0xZ
changed: 管理者实测（release 缺 plugin + 落后 2463 提交）+ 外层独立核实（files 字段确认无 plugin/，
plugin/ 构成确认 119 scripts 等）立案。AC16 判据 2 完整性核心缺口，无现存任务覆盖（两个 done 任务均
未解决 files/plugin）。外层裁定 4 项机制决定（files 加 plugin/ + develop 打 tag + SEA 继续 + v0.4.0）。

reviewer: executor
at: 2026-08-06T08:1xZ
changed: 执行落地。AC1/AC2/AC3/AC4/AC5/AC6 全过，证据贴任务体「执行记录」。两处现实偏差已记录并调整：
(1) `plugin/` 在仓库根、npm pack 够不到，故 `files` 加 `plugin` + `package.sh` 包前快照进
`packages/quay/plugin/`（否则 AC1 恒为 0）；(2) 铺出的 vendored 运行时要求目标 type:module——已记录
为已知限制（CJS/Go 目标需补 vendor/package.json 铺设，不在本任务 Touches）。版本 v0.4.0 同步三处。
AC6（第三条路径 dist-plugin）无代码改动——机制已存在（publish-dist-branch.sh + publish-plugin-dist.yml），
本地实跑证明从 v0.4.0 baseline 能重建完整 plugin 树；真实 --push 留待 release 流程。新增回归测试
`packages/quay/test/npm-pack-e2e.test.mjs`（bundle_in_pack>0，5/5 PASS）；scoped --for-task 退出 0。

## AC16 改判未达成（2026-08-06T10:4xZ，archguard 消费方 + 管理者双确认）

**SEA 产物不含 plugin——AC16 未在产物层达成。**

- **双确认**：archguard 下载 quay-sea-0.4.0-linux-x64.tar.gz 反查二进制字符串，6 个新机制名全不在；
  管理者 `gh release download` + `tar tzf` 实测 tarball 只有 ./quay ./quay-native ./tasks/ ./.quay/config.yml
  ——**完全没有 plugin 目录**。
- **根因（管理者推测 + 外层核实坐实）**：SEA（--experimental-sea-config）打包用独立 assets 机制——
  `esbuild-sea.mjs` 只 bundle `bin/quay.ts`（Core CLI），sea-config.json 无 assets 映射 plugin。
  `package.json.files` 只影响 npm pack/publish（tgz），**对 SEA 二进制资产嵌入无作用**。
  SEA 是单文件可执行 + plugin 是目录树——**结构性装不下**。
- **含义**：AC16 的 files+plugin 只修了 npm tgz（非推荐分发），release 页面推荐的 quay-sea-*.tar.gz
  **没修**。AC1-AC6 勾选基于 npm 视角，**产物层未达成**。

**后续**：SEA 打包流程单独立案（gap-release-sea-bundle-excludes-plugin-tree），AC16 保持未达成直到
SEA 产物含 plugin（或架构改为 release 同时发 SEA + plugin bundle 目录）。

## Cross-annotation (gap-release-sea-bundle-excludes-plugin-tree)

**已落地（2026-08-08）**：`gap-release-sea-bundle-excludes-plugin-tree` 是上述「AC16 改判未达成」
的产物层修复。架构决定（AC3）= **sidecar bundle**：`build-sea.sh` step [6/6]
`stage_plugin_sidecar()` 把 repo-root `plugin/`（去 `plugin/test/`）stage 进 `dist-sea/plugin/`；
`release.yml` 组装步骤把该 sidecar 拷进 `dist-sea-release/plugin/`（缺失 fail-closed）；新增
回归测试 `packages/quay/test/sea-bundle-plugin-sidecar.test.mjs` 断言 6 个新机制名在产物可反查 +
Contract measure `sea_has_plugin > 0`。**AC16 现在在 npm tgz（本任务）+ SEA archive（sidecar）
两条分发路径的产物层都含 plugin。**

## 执行记录（2026-08-08 二次执行：integration fork 验证——AC 已达成，verify-not-implement）

**背景**：本任务 AC1-AC6 已由首次执行（commit 7adb6307，fan-in 8cca89d5）达成并勾选；SEA 产物层缺口
由 gap-release-sea-bundle-excludes-plugin-tree（sidecar，commit 96076d12）修复并已 fan-in integration。
本二次执行在 integration fork 上验证已勾证据在当前树仍成立，**无新增实现**（thin task：scoped 测试
解析 1/10 Touches，0.1 < 0.5）。

**验证基线**：fork from `integration`（cde88f54 前），非 develop——本任务 Touches 与已 fan-in 的
shipped-artifact / release-sea-bundle 打包工作重叠，integration 是正确基线（本任务 Touches 的
package.json / build-sea.sh / npm-pack-e2e.test.mjs 已含 fan-in 后的形态）。

**AC1（bundle_in_pack > 0）实测**：
```
$ bash packages/quay/scripts/package.sh
    # 完整打包：build-dist + sync-vendor 检查（vendored 运行时缺失时 fail-closed + auto-build）+
    # version-sync 闸（package.json=marketplace.json=plugin.json）+ capability-catalog --entry-surface
    # （.sh 交付形态闸）+ 快照 repo-root plugin/ → packages/quay/plugin/ + npm pack
$ tar -tzf packages/quay/quay-0.4.0.tgz | grep -c 'plugin/'
283
```
Tarball 总 332 文件；分类：plugin/scripts 186 · gate-scripts 14 · skills 22 · probes 4 · loop 3 ·
agents 1 · workflows 2 · vendor 4（含 vendored 运行时 quay.js + quay-native.js）。
`bundle_in_pack = 283 > 0`（Contract measure 达标，band 即「release 含 plugin bundle」）。与首次执行
记录的 352 差异根因：human ruling 剔除 `plugin/test/` + shipped-artifact 交付形态闸（capability-catalog
PUBLIC_ENTRYPOINTS 声明）——文件数减少，机制面（scripts/gate-scripts/skills/probes/loop/vendor/agents/
workflows）不受影响，vendored 自包含运行时在包内。

**AC16 回归测试**（`packages/quay/test/npm-pack-e2e.test.mjs`，node:test 9 用例）：
```
9/9 PASS：tarball 含完整 plugin bundle（bundle_in_pack>0 + 子面存在性）· 安装后 bin 解析 dist/quay.js ·
--help · --version · quay task list 真 provider 往返 · 注册 manifest · register-plugin 三态
```

**AC4（version 0.4.0 同步）**：`packages/quay/package.json` = `plugin/.claude-plugin/plugin.json` =
`plugin/vendor/quay/package.json` = `plugin/.claude-plugin/marketplace.json` = 0.4.0（root npm install
postinstall → sync-vendor 已把 vendor 镜像同步到 0.4.0）。

**AC5（交叉标注）**：`tasks/exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE.md` §Cross-annotation
(gap-release-excludes-plugin-bundle-agent-surface) 与 `tasks/gap-loop-mechanism-lives-outside-the-
package-and-cannot-ship.md` 同名小节均在。

**AC6（dist-plugin 第三条路径）**：`plugin/scripts/publish-dist-branch.sh` + `.github/workflows/
publish-plugin-dist.yml` + `marketplace.json` plugins[0].version=0.4.0（source 指向 `.`）均就位；机制
未变（本地 orphan 分支重建非本二次执行范围，首次执行已实跑 cc53c820）。

**SEA sidecar（已 fan-in）**：`build-sea.sh` `stage_plugin_sidecar()`（`--stage-plugin-only` 快速路径）+
`packages/quay/test/sea-bundle-plugin-sidecar.test.mjs` 在树；AC16 在 npm tgz + SEA archive 两条分发
路径产物层都含 plugin。

**scoped 门**：`bash scripts/test.sh --for-task gap-release-excludes-plugin-bundle-agent-surface --allow-thin`
→ exit 0。

**改动清单（本二次执行）**：仅任务文件本体 self-edit（status todo→ready 与开发侧派发预备对齐、补 DoD
勾选、补 self-touch Touches 条目、本验证记录）。无代码改动——实现已在 integration 上（fan-in 7adb6307 +
96076d12）。
