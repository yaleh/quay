---
id: gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy
title: quay init 铺出的 mcp_entry=["node","./bin/quay-native.ts","mcp"] 在已安装副本上必挂——Node ≥23.7 拒绝 node_modules 下的 type-stripping（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING），quay task create 等一切经 provider MCP 的命令全崩
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（outer 2026-08-11 14:2x，AC16③ Level3 复测时撞出）**：`quay init` 铺出的 `.quay/config.yml` 把 provider `mcp_entry` 写成 `["node", "./bin/quay-native.ts", "mcp"]`（`packages/quay/src/init.ts:78`）。这在 **dev checkout**（repo 树内，`.ts` 不在 node_modules 下）能跑；但 **已安装副本**（`npm install -g quay-native-*.tgz` 后 provider path 解析到 `~/.local/.../lib/node_modules/quay-native/`）上，`bin/quay-native.ts` **位于 node_modules 下**，而 Node ≥23.7 对 node_modules 下的文件**拒绝** `--experimental-strip-types` ⇒ `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，provider MCP server 起不来 ⇒ 一切经 provider 的 CLI 命令（`task create/list/promote/complete`、`quay serve`）全崩。

**实证命令 + 错误**（C=ad-arm1, Node v24.19.0）：
```text
$ quay init --root ~/quay-ac16c3-ws   # 铺出 mcp_entry=["node","./bin/quay-native.ts","mcp"]
$ cd ~/quay-ac16c3-ws && quay task create ...
node:internal/modules/typescript:189
  throw new ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING(filename);
Error: Stripping types is currently unsupported for files under node_modules,
  for "file:///home/yale/.local/opt/node-v24.19.0/lib/node_modules/quay-native/bin/quay-native.ts"
```

**根因**：`init.ts` 的模板把 mcp_entry 硬编码为 dev-tree 形态（`./bin/quay-native.ts`），没区分「安装形态」。已安装的 `quay-native` 的 `bin` 字段指向 **`./dist/quay-native.js`**（bundled ESM，Node ≥20 可跑，无 type-stripping）——**安装形态的 mcp_entry 应指向 dist bundle**。

**修法（方向）**：`init.ts` 在写 config 时按 provider 解析后的实际形态选 mcp_entry：
- **安装形态**（provider 在 node_modules 下）：`["node", "./dist/quay-native.js", "mcp"]`（或直接 `["quay-native", "mcp"]` 走 bin）；
- **dev 形态**（provider 在 repo 树内）：保持 `["./bin/quay-native.ts", "mcp"]`。

**影响面（delivery-critical）**：任何装了 quay 的机器 `quay init` 出来的 workspace 都不能用——本 directive 的 deliver 目标 B/C 首当其冲。C 上已验证 dist-bundle 形态（`mcp_entry: ["node","./dist/quay-native.js","mcp"]`）全生命周期 todo→done 跑通。

**验证锚**：修后 (a) 安装副本 `quay init` → `task create` 成功（不崩）；(b) dev checkout `quay init` → `task create` 不回归；(c) AC16③ Level3（todo→done）在安装副本上可复现；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——本任务 Proposal 记录 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING 实证 + init.ts:78 硬编码
- [ ] AC2: **修复**——init.ts 按安装/dev 形态选 mcp_entry（安装 → dist bundle，dev → .ts）
- [ ] AC3: **安装副本全生命周期**——C（或任一安装副本）`quay init` → `task create/promote/complete` todo→done 全绿
- [ ] AC4: **dev 不回归**——dev checkout `quay init` 后 provider MCP 照常
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：安装副本 init→create→promote→complete 证据贴出（C 上）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- packages/quay/src/init.ts（mcp_entry 按形态选择）
- packages/quay/test/init.test.mjs（新增安装/dev 两形态用例，若存在）
- tasks/DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop.md（交叉标注——AC16③ Level3 复测撞出的）
- tasks/gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy.md（自身：勾 AC + 贴证据）

## Contract

measure   installed_task_create_ok = `ssh ad-arm1 'cd ~/quay-ac16c3-ws && quay task create PROBE --title probe'` 退出码
band      installed_task_create_ok = 0（安装副本 init 后 task create 不崩）
invariant provider_mcp_serves = 1（provider MCP 在安装形态下可起）
invoke    `ssh ad-arm1 'cd ~/quay-ac16c3-ws && quay task create PROBE --title probe && quay task list'`（贴 todo→done 证据）
control   安装形态可用；dev 不回归；AC16③ Level3 可复现；既有不回归
resume    init.ts 修复 / 安装复测 / dev 回归 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: AC16③ Level3 复测（C 上 todo→done）撞出安装副本 init mcp_entry 必挂——Node ≥23.7 禁 node_modules 下 type-stripping；init.ts:78 硬编码 dev-tree 形态。delivery-critical（B/C 首当其冲）。实现归 inner，判定归 outer
