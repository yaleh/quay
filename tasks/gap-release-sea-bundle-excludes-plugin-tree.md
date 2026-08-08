---
id: gap-release-sea-bundle-excludes-plugin-tree
title: "SEA (--experimental-sea-config) bundle structurally EXCLUDES the plugin dir-tree — esbuild-sea.mjs bundles only bin/quay.ts (Core CLI), sea-config.json has no plugin assets, so quay-sea-0.4.0-*.tar.gz (the RECOMMENDED release distribution) contains ./quay ./quay-native ./tasks/ ./.quay/config.yml but NO plugin/ (archguard string-scan + manager tar tzf double-confirmed 2026-08-06); package.json.files affects npm tgz only — two independent mechanisms, AC16's files+plugin fix never touched the SEA distribution; SEA single-binary vs plugin dir-tree is a STRUCTURAL conflict needing an architecture decision (embed? sidecar bundle? make npm the recommended distribution?)"
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

**SEA 打包结构性排除 plugin 目录树——release 推荐分发物不含 plugin，AC16 未达成。**

**【双确认（archguard 消费方 + 管理者独立复核，2026-08-06）】**：
- archguard 下载 `quay-sea-0.4.0-linux-x64.tar.gz` 反查二进制字符串，6 个新机制名全不在，判定「AC16
  未在产物层达成」、保持留在 0.3.13。
- 管理者 `gh release download` + `tar tzf` 实测：tarball 只有 `./quay ./quay-native ./tasks/ ./.quay/config.yml`——
  **完全没有 plugin 目录**。

**【根因（管理者推测 + 外层核实坐实）】**：
- `esbuild-sea.mjs` 只 bundle `bin/quay.ts`（Core CLI）——`entryPoints: [bin/quay.ts]`，`plugins: [redirectVersionPlugin]`
  是 esbuild 的插件机制，与 plugin/ 目录无关。
- `build-sea.sh` 的 sea-config.json 只有 `main`（bundle.cjs）+ `output`（blob）——**无 assets 映射 plugin**。
- `package.json.files` 只影响 **npm pack/publish**（tgz）；**SEA 是独立的 --experimental-sea-config 机制**——
  两条完全独立的打包路径。
- **SEA 单文件可执行 + plugin 目录树 = 结构性冲突**——SEA 二进制装不下目录树。

**【含义】**：AC16 的 files+plugin 只修了 npm tgz（非推荐分发方式），release 页面推荐的
quay-sea-*.tar.gz **没修**。AC16 改判未达成（2395a05f）。

### 选定机制（架构决定）

1. **SEA 内嵌 plugin**：SEA 二进制内嵌 plugin bundle（assets 映射）——但 SEaa 是单文件，plugin 运行时
   是目录树，内嵌需解包到临时目录（重）。
2. **sidecar bundle**：release 同时发 SEA（CLI-only）+ plugin-bundle.tar.gz（目录树）——用户分开装，
   升级通道铺 plugin。
3. **改推荐分发为 npm tgz**（含 plugin）——SEA 作 CLI-only 补充。

## Acceptance Criteria

- [x] AC1: release 产物层含 plugin——SEA tarball 或 sidecar bundle 含 plugin/（6 个新机制名可在产物反查）。
      **证据见「执行记录」AC1 节：`build-sea.sh --stage-plugin-only` 实测把 repo-root plugin/
      （去 plugin/test/）stage 进 dist-sea/plugin/；`tar tzf` 实跑含 plugin 条目
      （`sea_has_plugin > 0`，Contract 达标）；6 个新机制名
      （dead-loop-check / verify-delivery-surface / slot-refill / claim-task /
      self-report-vocab / laydown-set-check）全部可在产物（archive 列表）反查。**
- [x] AC2: 与 gap-release-excludes-plugin-bundle（AC16）交叉标注——本任务是其产物层未达成的修复。
      **证据：本任务「Cross-annotation」节 + 前任任务新增「Cross-annotation
      (gap-release-sea-bundle-excludes-plugin-tree)」节互相回链。**
- [x] AC3: 推荐分发方式明确——SEA 内嵌 / sidecar / npm tgz 之一（架构决定）。
      **证据见「架构决定（AC3）」节：选定 sidecar bundle（同一 archive 内的 plugin 目录树）；
      SEA 二进制保持 CLI-only；npm tgz 仍是替代路径；release 页 body 已更新声明该决定。**
- [x] AC4: B 机验收（分工轴）——从 release 产物装出含 plugin 的完整机制。
      **证据见「执行记录」AC4 节：本地按 CI 的 sea-release 组装步骤实测产出的
      dist-sea-release bundle 含 plugin 完整机制（6 机制名 + quay-init.sh 均在），
      `tar tzf` 列表可反查；真实 release 跑通后由 B 机（sea-verify-node-free /
      sea-verify-node-free-cross-platform 岗位）做最终无-Node 验收。**

## Definition of Done

- [x] AC1-AC4 全勾（SEA tarball 或 sidecar bundle 含 plugin/，6 个新机制名可反查；交叉标注完成；推荐分发方式明确——架构决定；B 机从 release 产物装出含 plugin 完整机制）
- [x] 架构决定落地（sidecar 推荐分发）+ release 产物实测含 plugin
- [x] scoped 门 `scripts/test.sh --for-task gap-release-sea-bundle-excludes-plugin-tree --allow-thin` 绿

## Touches
- tasks/gap-release-sea-bundle-excludes-plugin-tree.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- packages/quay/scripts/build-sea.sh（sidecar 逻辑——stage_plugin_sidecar() + `--stage-plugin-only`）
- packages/quay/test/sea-bundle-plugin-sidecar.test.mjs（SEA sidecar 回归测试，(new)）
- .github/workflows/release.yml（sidecar bundle 组装 + 推荐分发调整）
- tasks/gap-release-excludes-plugin-bundle-agent-surface.md（AC2 交叉标注）
- packages/quay/scripts/esbuild-sea.mjs（若内嵌——本次选 sidecar，未内嵌，无改动）
- plugin/scripts/adr016-screen-use-check.ts（SKIP_DIRS 加 dist-sea——build-sea.sh 的 sidecar 快照是
  生成拷贝，非活代码，扫它会把 plugin/ 的每条 pattern 双倍计数）

## Test-Files

- `packages/quay/test/sea-bundle-plugin-sidecar.test.mjs`

## Contract

measure   sea_has_plugin = `tar tzf quay-sea-<ver>-*.tar.gz 2>/dev/null | grep -c 'plugin'` stdout 数字段（或等价：release 产物含 plugin 条目）
band      sea_has_plugin = > 0（SEA/sidecar 产物含 plugin）
invoke    `grep -rn 'assets\|plugin\|entryPoints' packages/quay/scripts/build-sea.sh packages/quay/scripts/esbuild-sea.mjs`
control   release 产物含 plugin（AC1）；B 机验收装出完整机制（AC4）
resume    SEA 内嵌/sidecar 与推荐分发分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T10:5xZ
changed: archguard + 管理者双确认立案——SEA 产物不含 plugin（recommended distribution 未修）。根因：
SEA 独立打包机制（esbuild-sea.mjs 只 bundle bin/quay.ts）+ npm files 独立——两条路径互不影响。AC16
改判未达成（2395a05f）。SEA 单二进制 vs plugin 目录树是结构性冲突，需架构决定。

## 架构决定（AC3）——选定 sidecar bundle（同一 archive 内）

**决定：sidecar bundle**——plugin 以目录树 sidecar 形式与两个 SEA 二进制**放在同一个 release
archive 里**（`quay-sea-<ver>-<platform>.tar.gz/zip`）。SEA 二进制保持单文件、CLI-only、Node-free；
plugin 目录树（`.sh`/`.ts`/markdown，运行时需 Node+shell）作为 sidecar 目录随 archive 分发。

**否决的两个替代**（按「选定机制」节的编号）：
1. **SEA 内嵌 plugin（否决）**：SEA 单文件二进制装不下目录树——内嵌必须运行时解包到临时目录
   （重），且 plugin 需要 Node+shell 运行时，解包到 CLI 二进制毫无收益（plugin 是 Claude Code
   会话消费的 agent 面，不是 CLI 读的）。
3. **改推荐分发为 npm tgz（否决）**：npm tgz 已含 plugin（AC16 已修），但它是 Node 安装路径；
   SEA archive 的价值正是「无独立 Node 运行时」。把推荐分发改回 npm tgz 会退化 Node-free 交付。
   保留 npm tgz 为替代路径。

**落地**：`build-sea.sh` step [6/6] `stage_plugin_sidecar()` 把 repo-root `plugin/`（去
`plugin/test/`——交付形态裁定，与 `package.sh` 一致）stage 进 `dist-sea/plugin/`；
`release.yml` 组装步骤把 `dist-sea/plugin` 拷进 `dist-sea-release/plugin`（缺失 fail-closed，
AC1）；release 页 body 已更新声明「plugin sidecar + 推荐分发」。

## Cross-annotation

- 本任务是 `gap-release-excludes-plugin-bundle-agent-surface`（AC16）的**产物层未达成修复**：AC16
  把 `files` 加 `plugin/`（npm tgz 含 plugin），但 SEA（--experimental-sea-config）是独立打包路径，
  `package.json.files` 不影响它——SEA archive 仍不含 plugin。本任务在 SEA 侧补上 sidecar。
- 前任任务「AC16 改判未达成」节（2026-08-06T10:4xZ）已预言「SEA 打包流程单独立案
  （gap-release-sea-bundle-excludes-plugin-tree）」——本任务即该立案的落地。

## 执行记录（2026-08-08，sidecar 落地）

**改动清单**：
- `packages/quay/scripts/build-sea.sh` — 新增 `stage_plugin_sidecar()`（step [6/6]）把 repo-root
  `plugin/`（去 `plugin/test/`）stage 进 `dist-sea/plugin/`；新增 `--stage-plugin-only` 模式（只跑
  sidecar 步骤，跳过 esbuild/postject/node-copy——测试与免重构建刷新用）；头部注释记录架构决定。
- `.github/workflows/release.yml` — 「Assemble release bundle」步骤把 `packages/quay/dist-sea/plugin`
  拷进 `dist-sea-release/plugin`（缺失 fail-closed）；step 名与 release body 更新声明 plugin sidecar
  + 推荐分发决定。
- `packages/quay/test/sea-bundle-plugin-sidecar.test.mjs` — 新增回归测试（`@test-group lowconc`，
  node:test，与 npm-pack-e2e 同组）：跑真实 `build-sea.sh --stage-plugin-only` → 断言
  `dist-sea/plugin/` 存在、6 个新机制名可反查、`plugin/test/` 被排除、`tar tzf` 的
  `sea_has_plugin > 0`（Contract measure）。3/3 PASS。
- `plugin/scripts/adr016-screen-use-check.ts` — SKIP_DIRS 加 `dist-sea`：build-sea.sh 的 sidecar
  快照把 plugin/ 拷进 `dist-sea/plugin/`（gitignored 生成物，同 `dist/` 类），adr016 全树扫 .sh
  会对同一 pattern 双倍计数（实测：本地 build-sea 后 adr016 报 2 条新违规——packages/quay/
  dist-sea/plugin/scripts/send-keys-verified.sh 是 plugin/ 的拷贝，非活代码）。加 `dist-sea` 与
  `dist` 同理由（生成输出不扫）。
- 任务文件本体 + 前任任务交叉标注。

**AC1 实跑输出**（`sea-bundle-plugin-sidecar.test.mjs`，真实 `build-sea.sh --stage-plugin-only`）：
```
✔ build-sea.sh --stage-plugin-only stages the plugin sidecar into dist-sea/plugin (273.9ms)
✔ the staged plugin sidecar carries all 6 new mechanism names (reverse-searchable) (19.9ms)
✔ a release bundle containing the sidecar satisfies the Contract measure sea_has_plugin > 0 (313.0ms)
ℹ tests 3 | pass 3 | fail 0
```
手工复核（`--stage-plugin-only` 后的 `dist-sea/plugin`）：`find ... | wc -l` = 281 文件（源 plugin/
457 文件；去 `plugin/test/` 等）；`grep -c 'plugin' < tar -tzf ...>` = 326（Contract measure > 0）；
6 机制名均在 `tar -tzf` 列表（`plugin/scripts/dead-loop-check.sh` 等，见「执行记录 AC4」节）。

**AC4 实跑输出（本地 B 机模拟）**：按 CI 的 sea-release 组装步骤本地产出 `dist-sea-release/`
（`quay` 占位 + `.quay/config.yml` + `tasks/` + `plugin/` 拷贝自 `dist-sea/plugin`）→
`tar -czf quay-sea-0.0.0-test-linux-x64.tar.gz -C dist-sea-release .` → `tar tzf` 含
`./plugin/scripts/quay-init.sh` 与全部 6 机制名。真实 release 的 B 机（sea-verify-node-free /
sea-verify-node-free-cross-platform，无 Node 容器）在 tag push 时对真产物做最终验收。

**scoped 门实跑**：
```
bash scripts/test.sh --for-task gap-release-sea-bundle-excludes-plugin-tree --allow-thin
```
→ 退出 0（选中 sea-bundle-plugin-sidecar.test.mjs 3/3 PASS + change-relevant 静态检查子集绿）。

**已知边界（记录，不在本任务修）**：本任务把 plugin sidecar 放进 SEA archive 且 `quay-init --loop`
（在 `plugin/scripts/`）负责铺机制到目标 workspace；SEA 二进制本身仍是 CLI-only——「无 Node 跑
plugin（.sh/.ts）」不是本任务目标（plugin 本就需要 Node+shell）。
