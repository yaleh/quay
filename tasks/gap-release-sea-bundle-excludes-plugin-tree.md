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

- [ ] AC1: release 产物层含 plugin——SEA tarball 或 sidecar bundle 含 plugin/（6 个新机制名可在产物反查）
- [ ] AC2: 与 gap-release-excludes-plugin-bundle（AC16）交叉标注——本任务是其产物层未达成的修复
- [ ] AC3: 推荐分发方式明确——SEA 内嵌 / sidecar / npm tgz 之一（架构决定）
- [ ] AC4: B 机验收（分工轴）——从 release 产物装出含 plugin 的完整机制

## Definition of Done

- [ ] AC1-AC4 全勾（SEA tarball 或 sidecar bundle 含 plugin/，6 个新机制名可反查；交叉标注完成；推荐分发方式明确——架构决定；B 机从 release 产物装出含 plugin 完整机制）
- [ ] 架构决定落地（SEA 内嵌 / sidecar / npm tgz 推荐分发之一）+ release 产物实测含 plugin
- [ ] scoped 门 `scripts/test.sh --for-task gap-release-sea-bundle-excludes-plugin-tree` 绿

## Touches
- tasks/gap-release-sea-bundle-excludes-plugin-tree.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- packages/quay/scripts/build-sea.sh（SEA 内嵌 assets 或 sidecar 逻辑）
- packages/quay/scripts/esbuild-sea.mjs（若内嵌）
- .github/workflows/release.yml（sidecar bundle 或推荐分发调整）
- tasks/gap-release-excludes-plugin-bundle-agent-surface.md（AC2 交叉标注）

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
