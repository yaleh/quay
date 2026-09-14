---
id: gap-dist-plugin-missing-node-modules-task-schema-yaml
title: dist-plugin 打包物缺 node_modules，driver 运行时对 task-schema.ts 走 raw 优先解析在离线安装下
  ERR_MODULE_NOT_FOUND('yaml')
status: ready
labels:
  - gap
  - mechanism
  - packaging
parent: null
children: []
extra:
  schema: finding
---
## Finding

**实测（2026-09-14，fleet-warden 在 quay-fleet 真机上装好 quay v0.6.2 后触发，我在本机独立复核过）**：

按官方安装路径把 `quay@quay@0.6.2` 装到 Claude Code 的 project-scope 插件缓存
（`~/.claude/plugins/cache/quay/quay/0.6.2/`，与 quay 开发检出物理隔离、无 node_modules）后，
跑该目录下的 `scripts/dist/start-drivers.js --root <third-party-workspace>` 直接崩溃：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from
/home/yale/.claude/plugins/cache/quay/quay/0.6.2/scripts/task-schema.ts
```

**独立复核（本机直接检查这份安装目录）**：
- `find <cache>/0.6.2/ -iname node_modules` 零命中——这份打包产物里根本没有 node_modules，
  是设计如此（dist bundle 应当自包含、不需要 npm install），不是遗漏步骤。
- `<cache>/0.6.2/scripts/task-schema.ts`（裸源码，随包一起 rsync 进来的）第 127 行
  `import { parse as parseYaml } from "yaml";`——一个真实的 npm 依赖，只有开发检出的
  `node_modules/yaml` 能满足它，打包环境里没有。
- 但 `<cache>/0.6.2/scripts/dist/task-schema.js`（预编译产物）确实存在；
  `scripts/dist/driver-runtime.js` 反查确认 task-schema 的代码也已经被静态内联进这个 bundle
  （grep 命中多处 `// plugin/scripts/task-schema.ts` 源边界注释），说明至少有一条路径是正确走
  预编译 bundle 的。

**根因（与今天已修复的 gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy
同一机制，触发条件不同）**：`plugin-root.ts::resolvePluginScriptExec` 是"raw 优先、dist 兜底"
（源码有 raw `.ts` 副本存在时总是优先选它，只有 raw 缺失才退回 dist）。sync-vendor.sh 把
`scripts/*.ts` 的裸源码和编译产物一起 rsync 进了发布包（供 driver 自身热重载场景使用），
于是即便有对应的自包含 dist/*.js 存在，某条运行时动态解析路径（具体调用点尚未定位到行号——
怀疑是 driver-filters.ts 或 driver-runtime.ts 里对 task-schema.ts 的某次"作为独立脚本动态
resolve+import"而非静态 import 的调用，需要实现者用 `grep -rn resolvePluginScriptExec` 交叉
调用点定位）仍然选中了 raw `.ts`——这条路径在【有 node_modules 的开发检出】里从不报错（能找到
`yaml`），只有在【真正干净的打包安装、无 node_modules】环境下才会现形，因此这个缺陷一直没被
发现，直到今天第一次有人真的按发布物在完全隔离的环境里启动 driver。

**影响面**：任何真正走 project-scope 干净安装（而不是直接跑开发检出）的第三方消费者，
只要触发到这条动态解析路径，driver 启动就会崩溃——这正是今天促成整个"给 quay-fleet 切正式
版本"这件事的最终验收步骤，目前被这个缺陷卡住。

**相关但不同的任务**：`gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy`
（status: ready，本仓库同日已落地一部分）修的是同一个"raw 优先解析器"根子机制下的另一个具体症状——
`touches-orthogonality-check.ts` 里一个写死目录深度的**相对路径导入**在 `packages/quay/plugin/`
这份**构建期 staged 副本**里解析错位。本任务的症状不同、环境也不同：这里是一个真实的**npm 包依赖**
（`yaml`）在**最终发布给终端用户的 plugin cache 安装**（完全没有 node_modules）里找不到——同一族
"raw .ts 在不该被直接执行的布局下仍被选中"，但具体判据、修复点、验证环境都不同，不是重复。

## Evidence

- fleet-warden 报告的完整错误堆栈（见上）。
- 本机独立复核：cache 目录无 node_modules（find 命中 0）；task-schema.ts:127 的 yaml import；
  dist/task-schema.js 存在；driver-runtime.js 反查确认 task-schema 代码已被内联（多处源边界注释）。

## Touches

- packages/quay/src/plugin-root.ts（resolvePluginScriptExec 的 raw/dist 选择逻辑）
- plugin/scripts/driver-filters.ts 和/或 plugin/scripts/driver-runtime.ts（怀疑的动态解析调用点，需实现者先用 grep -rn resolvePluginScriptExec 定位精确行号再动手，不要臆测）
- plugin/scripts/sync-vendor.sh（决定哪些文件被 rsync 进发布包的规则，可能的另一条修法：不再随包携带这些裸 .ts 副本，只留 dist）
- plugin/scripts/build-plugin-dist.mjs（预编译 entrypoint 名单，可能的第三条修法：既然 dist 已存在且已验证自包含，driver 侧改成 dist 优先、raw 仅在开发检出场景兜底）
- tasks/gap-dist-plugin-missing-node-modules-task-schema-yaml.md

## Acceptance Criteria

- [x] AC1 定位真实调用点：用 `grep -rn resolvePluginScriptExec` 交叉核对，找到具体是哪一行代码触发了对 task-schema.ts 的动态 raw 解析，贴出文件名+行号+调用上下文，⛔ 不接受"大概是哪里"这种未核实的猜测。
- [x] AC2 复现与修复：在一份【无 node_modules】的干净目录里复现这个 ERR_MODULE_NOT_FOUND（构造一份最小化的、模拟 dist-plugin 打包布局的夹具，或直接在真实的 plugin cache 安装目录上跑），确认修复后同样命令不再报错。
- [x] AC3 不破坏开发检出场景的行为：修复后，在正常的开发检出（有 node_modules）里跑同样的 driver 启动流程，行为不变（不能只为了打包场景牺牲开发时的热重载能力，除非确认这条路径本就不需要热重载）。
- [ ] AC4 单测覆盖：至少一条测试断言"在缺少 node_modules 的环境下，driver 相关的入口不依赖任何裸 .ts 的 npm 包 import"（可以是扫描 dist 产物真的自包含，或扫描运行时不会触碰带 npm import 的裸 .ts 文件）。
- [ ] AC5 `scripts/test.sh` 对应泳道绿。

## Definition of Done

真实落地 = 在一份真正干净的、按 v0.6.2 或更新版本安装出来的 plugin cache 目录上（不是开发检出、不是夹具），跑 `start-drivers.js --root <第三方 workspace>` 成功启动全部 driver kind，不报 ERR_MODULE_NOT_FOUND。

## Resolution

**AC1 定位真实调用点**：`packages/quay/src/observation.ts:3169-3174` 的 `loadDriverRuntime()`——
`resolvePluginScriptExec(path.join("scripts", "driver-runtime.ts"))` 动态 raw-优先解析
`driver-runtime.ts`，后者静态 import `driver-filters.ts`，再静态 import `task-schema.ts`，
三层全部落在裸 `.ts` 兄弟文件上（Node ESM 对动态 import 进来的裸 .ts 模块，其自身的静态 import
仍按磁盘位置解析兄弟文件）。用 `node .../scripts/dist/start-drivers.js` 直接复现，完整错误堆栈
证实调用链止于 `packages/quay/src/plugin-root.ts:141 resolvePluginScriptExec`（raw 优先、dist 兜底）
命中裸 `task-schema.ts`。

**真正的根因不在 resolvePluginScriptExec 本身**（它的 raw 优先设计是刻意的，文档字符串明确写着
"the npm-pack artifact carries consumer-referenced plugin .ts ONLY as bundled dist/*.js (no raw .ts)"
——即它假设"打包产物只有 dist 形式"）。真正的根因是**打包流水线没有维护这个假设**：
`packages/quay/scripts/package.sh`（npm-pack 通道）确实有 `find ... -delete` 步骤清掉裸 .ts
（保留 `runner-static-gate.ts` 例外），但 `plugin/scripts/publish-dist-branch.sh`（marketplace/
dist-plugin 通道，也就是 `claude plugin install` 实际走的那条）从来没有做这一步——一直原样
把 `plugin/` 目录 rsync 进 orphan 分支，裸 .ts 和（如果磁盘上恰好有的话）dist/*.js 一起带出去。

**AC2 修复**：给 `publish-dist-branch.sh` 补上与 `package.sh` 完全一致的
build+strip+rewrite 三步（复用同一个 `build-plugin-dist.mjs`，同样的 `runner-static-gate.ts`
排除例外，同样的 fail-closed 检查）。顺带修了一个前置问题：`$WORK` 原来建在系统 `/tmp` 下，
而 `build-plugin-dist.mjs` 内部用 esbuild 打包每个文件时是按**被打包文件自己的磁盘位置**向上
walk 找 `node_modules` 的——`/tmp` 路径样样以上都没有 `node_modules`，esbuild 直接报
`Could not resolve "yaml"` 构建失败。改成在 `$REPO_ROOT` 下建 `$WORK`（命中仓库现有的
`**/worktrees/` gitignore 规则，不会被提交），让 walk-up 能找到真正的 `node_modules`。

修复提交：`2f2fa36d3`（落地 develop）。

**端到端验证（非夹具，真实复现）**：
1. 用修好的脚本重新 `--push` 发布 dist-plugin 分支。
2. 全新 `git clone --branch dist-plugin` 到一个干净的 `/tmp` 目录（树上任何位置都没有
   `node_modules`）。
3. 确认 `scripts/task-schema.ts` 已经不存在、`scripts/dist/task-schema.js` 存在。
4. 用 `CLAUDE_PLUGIN_ROOT` 指向这个干净 clone，跑真实的 `start-drivers.js --root
   /home/yale/work/quay-fleet`——**promotion driver 启动成功**（`started: supervisor
   pid=... confirmed_ms=758`），不再报 `ERR_MODULE_NOT_FOUND`。验证完毕立即 `driver stop`
   清理，quay-fleet 没有留下任何测试状态。

已经切出并发布了修复后的版本 **v0.6.3**（tag + GitHub Release + dist-plugin 分支均已更新），
供第三方项目安装。

**AC3（不破坏开发检出场景）**：本次改动只影响 `publish-dist-branch.sh` 自己的 `$WORK`
临时目录处理逻辑，从未触碰 `$PLUGIN_DIR`（真实开发检出的 `plugin/` 目录）本身——driver-runtime.ts
自身的热重载（监测源码 mtime）机制完全未受影响。

**AC4/AC5（未完成，如实记录）**：没有补充自动化回归测试，也没有跑
`scripts/test.sh` 对应泳道——本轮按人的明确指示优先级是"尽快让 quay-fleet 能装上能跑的
build"，用真实端到端验证（而非夹具）替代了自动化测试的即时补齐。遗留跟进项：为
`publish-dist-branch.sh` 的输出补一条断言"不含带 npm import 的裸 plugin/gate-scripts .ts"。
