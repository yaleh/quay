---
id: gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy
title: touches-orthogonality-check.ts 的相对导入路径写死假设仓库顶层布局——在 npm 打包用的 staged
  plugin 副本下 ERR_MODULE_NOT_FOUND,quay driver 命令整体失败
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

**实测证据（2026-09-14，本机排查驱动 dist 过期问题时意外发现）**：`plugin/scripts/touches-orthogonality-check.ts:25`：
```ts
import { isRuntimeArtifactPath, loadRuntimeArtifactPatterns } from "../../packages/quay/src/runtime-artifacts.ts";
```
这行相对路径写死假设自己位于仓库顶层 `plugin/scripts/`（往上两级到仓库根，再进 `packages/quay/src/`）。

但 `packages/quay/scripts/package.sh` 会把整个 `plugin/` 目录完整拷贝一份到 `packages/quay/plugin/`（npm 打包用的 staged 快照，供 `build-plugin-dist.mjs` 编译 dist）。**这份 staged 副本里的同一个文件，同一行相对路径，往上两级只到 `packages/quay/`**，于是实际解析成
`packages/quay/packages/quay/src/runtime-artifacts.ts`——一个不存在的路径。

**触发场景（真实复现，不是构造）**：`build-plugin-dist.mjs` 的"预编译 entrypoint"名单里没有收录
`touches-orthogonality-check.ts`（该脚本不在其中，具体名单条目需实现者核实——本任务标题不预先断言
名单大小，只断言这一个文件不在其中），因此这个文件**始终以裸 `.ts` 通过 `--experimental-strip-types`
执行，而不是被预编译进某个不受相对路径影响的 dist bundle**。当 `packages/quay/plugin/` 这份 staged
快照处于"刚被完整刷新"的状态时，`quay driver <verb>`（不带 `QUAY_PLUGIN_ROOT` 覆盖时，CLI 默认解析
到这份 staged 副本而非仓库顶层 `plugin/`）会在真正执行 stop/start 之前，因为这一行 `ERR_MODULE_NOT_FOUND`
而整体失败退出——**不会伤害已有 driver 状态**（失败发生在触碰 supervisor 之前），但会让操作者以为
`quay driver restart` 这个命令本身坏了。

**已验证的绕过方式（不是修法，只是当下的应急手段）**：`QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin`
强制 CLI 解析到仓库顶层（未嵌套）的 plugin 路径，绕开这份 staged 副本，`driver status`/`driver restart`
即可正常工作。

## Plan

1. 定位 `build-plugin-dist.mjs` 的预编译 entrypoint 名单，确认 `touches-orthogonality-check.ts`
   确实不在其中（若已经在，说明此文件应该被预编译成 dist、不该再以裸 `.ts` 形态执行，问题落在
   "为什么没编译进去"而不是路径本身）。
2. 若确认不在名单中且不适合硬加进预编译名单（若这个脚本有理由必须保持源码可读/独立执行），修法应
   该是让这一行相对路径**不再假设固定的目录深度**——用一个运行时可靠的锚点（如
   `import.meta.resolve` 配合仓库根探测，或复用本仓库已有的 `findRepoRoot`/`findWorkspaceRoot` 之类
   动态定位辅助函数，而不是硬编码 `"../../"` 这个字面量层数）。
3. 若加入预编译名单更简单直接（编译后 bundle 内部的模块解析不受源码目录相对位置影响），优先选择
   这条路径，除非有明确理由不能预编译这个文件。
4. ⛔ 不要只在这一个文件上打补丁——`grep -rn '"\.\./\.\./packages/quay/src"' plugin/scripts/*.ts`，
   核实是不是还有其他脚本用同样写死层数的相对路径（同一类缺陷可能不止这一处，硬规则 5b：在一处修好
   不等于只有那一处）。

## Acceptance Criteria

- [ ] AC1 在仓库顶层 `plugin/scripts/` 直接运行 `touches-orthogonality-check.ts`（现有行为）仍然正常
      工作（负控制：本任务不能破坏未嵌套场景下的既有行为）。
- [ ] AC2 构造一份 staged 副本（复现 `package.sh` 的拷贝步骤，或直接对现有 `packages/quay/plugin/`
      跑一次同类刷新），在这份副本路径下运行同一个文件，**不再**报 `ERR_MODULE_NOT_FOUND`。
- [ ] AC3 `quay driver status`/`quay driver restart --kind <any>`（不带 `QUAY_PLUGIN_ROOT` 覆盖）在
      staged 副本处于"刚完整刷新"状态时，跑通不报错——这是这次真实撞到的触发条件，必须直接复现并
      验证修复。
- [ ] AC4 `grep -rn '"\.\./\.\./packages/quay/src"' plugin/scripts/*.ts` 的命中数与本任务处理前的命中数
      对比，若发现其他文件有同类写死路径，须在本任务体里列出清单（不必在本任务里全部修完，但必须
      枚举出来，不能只顾自己撞到的这一个）。
- [ ] AC5 全量 `scripts/test.sh` 绿。

## Definition of Done

- 五条 AC 全部满足。
- 任务体保留第一手证据：`touches-orthogonality-check.ts:25` 的原始导入行、staged 副本下实际解析出的
  错误路径、`QUAY_PLUGIN_ROOT` 应急绕过方式的验证结果。
- ⛔ 不得只用 `QUAY_PLUGIN_ROOT` 环境变量覆盖当作最终修法写进文档了事——那是应急手段，本任务要修的
  是"默认（不设覆盖变量）情况下就不出错"。

## Touches
- tasks/gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy.md
- plugin/scripts/touches-orthogonality-check.ts
- packages/quay/scripts/build-plugin-dist.mjs（需实现者先核实预编译名单是否需要变更，再精确声明是否
  真的改动这个文件）
