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

- [ ] AC1 定位真实调用点：用 `grep -rn resolvePluginScriptExec` 交叉核对，找到具体是哪一行代码触发了对 task-schema.ts 的动态 raw 解析，贴出文件名+行号+调用上下文，⛔ 不接受"大概是哪里"这种未核实的猜测。
- [ ] AC2 复现与修复：在一份【无 node_modules】的干净目录里复现这个 ERR_MODULE_NOT_FOUND（构造一份最小化的、模拟 dist-plugin 打包布局的夹具，或直接在真实的 plugin cache 安装目录上跑），确认修复后同样命令不再报错。
- [ ] AC3 不破坏开发检出场景的行为：修复后，在正常的开发检出（有 node_modules）里跑同样的 driver 启动流程，行为不变（不能只为了打包场景牺牲开发时的热重载能力，除非确认这条路径本就不需要热重载）。
- [ ] AC4 单测覆盖：至少一条测试断言"在缺少 node_modules 的环境下，driver 相关的入口不依赖任何裸 .ts 的 npm 包 import"（可以是扫描 dist 产物真的自包含，或扫描运行时不会触碰带 npm import 的裸 .ts 文件）。
- [ ] AC5 `scripts/test.sh` 对应泳道绿。

## Definition of Done

真实落地 = 在一份真正干净的、按 v0.6.2 或更新版本安装出来的 plugin cache 目录上（不是开发检出、不是夹具），跑 `start-drivers.js --root <第三方 workspace>` 成功启动全部 driver kind，不报 ERR_MODULE_NOT_FOUND。
