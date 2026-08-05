---
id: gap-dist-runtime-not-self-contained-reads-external-package-json
title: "dist runtime 'self-contained' claim false — version.ts reads
  ../package.json at __init (B machine verified: ENOENT after path-2 install);
  sync-vendor claims fully self-contained but has undeclared runtime file dep;
  3-layer gap all passed by verify (package.json in neither lay-down set nor
  referenced); fix: inline version at build time (option ②) + fix sync-vendor
  claim; AC12b blocker ② extension"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**dist 运行时「自包含」声称不成立 + mcp_entry 旧 config 残留——AC12b 阻塞②只解决三分之一（管理者 B 机实测 + 外层独立验证）**：

**实测（B 机，走正当升级通道 git push/pull，非手工 cp）**：
- **fail-closed 有效**：WARN→FAIL（referenced-runtime-missing）——正确修法方向（判据从「无依据仍给答案」变「拒绝回答」）。
- **第三层缺口**：FAIL 内容 `the provider mcp_entry references ./bin/quay-native.ts but it does not exist`——B 机 .quay/config.yml 是旧版（dev-tree 路径）残留。quay-init 生成逻辑本身正确（vendor 绝对路径，quay-init.sh:433），但「config 已存在不重写」保留旧值。**旧 config 不迁移 = 升级通道问题**。
- **package.json ENOENT 未解决**：node vendor/quay/dist/quay.js task list 仍 node:fs:435 readFileUtf8 报错。根因：src/version.ts:14 在 __init 阶段 readFileSync `../package.json`，而它没被铺过去。

**共同形态**：每修好一层下一层才暴露（上层失败掩盖下层）——只能在真实目标环境端到端逐层剥出，开发树检查看不见（开发树里文件都在）。

**修法（管理者建议 + 外层裁定）**：
1. **package.json（最根本）**：版本号构建时内联进 bundle（version.ts 不 readFileSync 外部文件），对得起 sync-vendor 那句 fully self-contained。退而求其次是把 vendor/<pkg>/package.json 加进铺设映射。
2. **mcp_entry**：config 生成按安装态写路径（vendor/.../dist/*.js）；**旧 config 迁移**——quay-init 检测已有 config 的 mcp_entry 指向不存在路径时更新（升级通道 config 迁移）。

### 选定机制

1. version.ts 版本号构建时内联进 bundle（build-dist 注入），不在 __init readFileSync 外部文件
2. sync-vendor 完成语修正（修好前不声称自包含）
3. quay-init 检测旧 config mcp_entry 指向不存在路径 ⇒ 更新为安装态路径（vendor/.../dist）
4. 验证：B 机路径二端到端——安装后 task list 无 ENOENT、mcp_entry 指向存在的运行时

## Acceptance Criteria

- [ ] AC1: dist 运行时启动不读外部 package.json（版本号内联进 bundle，构建时注入）——node vendor/quay/dist/quay.js --version 正常
- [ ] AC2: 若保留运行时读文件，quay-init 铺设映射补 vendor/<pkg>/package.json（fresh-clone 后存在）
- [ ] AC3: sync-vendor 完成语修正（修好前不声称 fully self-contained）
- [ ] AC4: 旧 config mcp_entry 指向不存在路径 ⇒ quay-init 更新为安装态路径（vendor/.../dist/*.js，升级通道 config 迁移）
- [ ] AC5: B 机路径二端到端：安装后 task list 无 ENOENT + mcp_entry 指向存在运行时（实跑输出贴任务体）
- [ ] AC6: 与 gap-vendor-runtime-not-in-git-clone-broken-mcp-entry 交叉标注（AC12b 阻塞②延伸）

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] version.ts 不在 __init 读外部 package.json（构建时内联版本号），node vendor/quay/dist/quay.js --version 返回 0.3.13（实跑输出贴任务体）
- [ ] B 机端到端：fresh 安装后 task list 无 ENOENT、mcp_entry 指向存在运行时（实跑输出贴任务体）
- [ ] sync-vendor 完成语已修正
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- packages/quay/src/version.ts（内联版本号，不在 __init 读外部文件）
- packages/quay/scripts/build-dist.mjs（构建时注入版本号）
- plugin/scripts/sync-vendor.sh（完成语修正）
- plugin/scripts/quay-init.sh（若选②：铺设映射补 package.json；旧 config mcp_entry 迁移）
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（AC6 交叉标注）
- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md（AC4 交叉标注：config 迁移）

## Contract

measure   dist_no_external_read = `node --no-warnings vendor/quay/dist/quay.js --version 2>&1 | grep -c 'ENOENT\|Error'` stdout 数字段（fresh 安装后）
band      dist_no_external_read = 0（无 ENOENT/Error）
invariant version_inlined_at_build = 1（版本号构建时内联，运行时零外部文件读）
invariant mcp_entry_points_to_runtime = 1（旧 config mcp_entry 指向不存在路径 ⇒ quay-init 更新）
invoke    `grep -n 'package.json\|readFileSync\|self-contained' plugin/scripts/sync-vendor.sh packages/quay/src/version.ts`
control   当前形态（读外部 package.json）⇒ fresh 安装 ENOENT（AC1 负控制）；修后 ⇒ 无 ENOENT
resume    version 内联 + mcp_entry 迁移 + 完成语分步提交，任一步完成即写盘