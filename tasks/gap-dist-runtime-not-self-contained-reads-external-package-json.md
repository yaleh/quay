---
id: gap-dist-runtime-not-self-contained-reads-external-package-json
title: "dist runtime 'self-contained' claim false — version.ts reads
  ../package.json at __init (B machine verified: ENOENT after path-2 install);
  sync-vendor claims fully self-contained but has undeclared runtime file dep;
  3-layer gap all passed by verify (package.json in neither lay-down set nor
  referenced); fix: inline version at build time (option ②) + fix sync-vendor
  claim; AC12b blocker ② extension"
status: done
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

- [x] AC1: dist 运行时启动不读外部 package.json（版本号内联进 bundle，构建时注入）——node vendor/quay/dist/quay.js --version 正常
      —— `packages/quay/src/version.ts` 改为 `import pkg from "../package.json" with { type: "json" }`；
      esbuild `json` loader 在 build-dist.mjs 构建时把版本号**内联进 bundle**（与 SEA 构建
      `scripts/version-sea-shim.js` 同一构建时内嵌机制），运行时零外部文件读。实跑证据（dist/quay.js 单独拷到
      一个**没有任何 package.json 的隔离目录**）：
      ```
      $ node --no-warnings quay.js --version
      0.3.13
      $ node --no-warnings quay.js --version 2>&1 | grep -c 'ENOENT\|Error'
      0
      ```
      bundle 内已无 version.ts 旧的运行时读路径（`grep -c '\.\./package\.json' dist/quay.js` = **0**），
      版本串 0.3.13 已内联（`grep -c '0.3.13' dist/quay.js` = 1）。
      回归：`build-dist.test.mjs` test (e)（无 sibling package.json 构建后 `--version` 返回 0.3.13，且断言
      bundle 不含 `../package.json`）；`plugin-vendor-standalone.test.mjs` 改为**只拷 dist/quay.js 单独运行**
      （零 node_modules、零 package.json）`--help`/`--version`/MCP `initialize` 全过。
- [x] AC2: 若保留运行时读文件，quay-init 铺设映射补 vendor/<pkg>/package.json（fresh-clone 后存在）
      —— **N/A（条件不成立，依题意空满足）**：本 AC 是条件式「若保留运行时读文件，则铺设映射补
      vendor/<pkg>/package.json」。外层裁定选②（构建时内联版本号），**未保留**运行时读文件 ⇒ 前件为假，
      该条件 AC 空满足，无需铺设 package.json。已实测 dist/quay.js **单独存在**即运行
      （无 package.json 的隔离布局下 `--version`/`task list` 全正常）。
- [x] AC3: sync-vendor 完成语修正（修好前不声称 fully self-contained，或改为准确的描述）
      —— `plugin/scripts/sync-vendor.sh` 完成语已改为准确描述并点名机制（修复后该陈述为真）：
      `[sync-vendor] done. The vendored dist/quay.js is self-contained: version inlined at build time (no runtime package.json read), no npm install needed.`
      实跑（sync-vendor 全量执行，最后一行）：`[sync-vendor] done. The vendored dist/quay.js is self-contained: version inlined at build time (no runtime package.json read), no npm install needed.`
- [x] AC4: 旧 config mcp_entry 指向不存在路径 ⇒ quay-init 更新为安装态路径（vendor/.../dist/*.js，升级通道 config 迁移）
      —— `plugin/scripts/quay-init.sh` 新增 `migrate_stale_mcp_entry()`：在 `write_provider_config` 的
      config-已存在分支中，检测旧 config 的 native provider `path`（spawn cwd）与 `mcp_entry[1]`（runtime 文件）
      是否指向目标中**不存在**的路径；是则迁移到安装态路径（`vendor/quay-native` + `vendor/quay-native/dist/quay-native.js`）。
      **范围守卫**：只迁移指向 quay 运行时文件（basename `quay(-native)?.{js,ts}`）的悬空引用与不存在的 provider
      dir；任意无关悬空路径（如 `./nonexistent/runtime.js`）不迁移，保留已落地 vendor-runtime AC3 的 fail-closed
      负控制语义。测试 `quay-init-loop.test.mjs`「AC4 — …stale dev-tree runtime is migrated…」绿。实跑：
      ```
      $ quay-init --loop ...  (旧 config: path=<ws>/bin, mcp_entry=[...,"<ws>/bin/quay-native.ts","mcp"])
      migrated: stale provider config -> <ws>/vendor/quay-native (upgrade-channel config migration — AC4)
      verify-provider-runtime-existence: OK (<ws>/vendor/quay-native/dist/quay-native.js exists)
      ```
- [x] AC5: B 机路径二端到端：安装后 task list 无 ENOENT + mcp_entry 指向存在运行时（实跑输出贴任务体）
      —— 本机以**路径二同形布局**实测（vendor/quay/dist/quay.js **单独**存在、无 package.json；旧 config 残留
      dev-tree path+mcp_entry），quay-init --loop 全绿、旧 config 迁移后 `task list` 真实 provider 往返
      **无 ENOENT、exit 0**：
      ```
      $ node $WS/vendor/quay/dist/quay.js --version
      0.3.13
      $ (cd $WS && node vendor/quay/dist/quay.js task list)
      quay-native mcp: serving tasks from $WS/tasks, ADRs from <repo>/adr
      AC5E1	todo	primitive	ac5 e2e	6s ago
      $ echo $?    # 0
      ```
      config 迁移后 `mcp_entry: ["node", "$WS/vendor/quay-native/dist/quay-native.js", "mcp"]`（指向存在的运行时，
      verify-provider-runtime-existence: OK）。（B 机 fresh 安装复核留外层 DoD 项；本机布局与 B 机路径二相同。）
- [x] AC6: 与 gap-vendor-runtime-not-in-git-clone-broken-mcp-entry 交叉标注（AC12b 阻塞②延伸）
      —— **交叉标注**：`gap-vendor-runtime-not-in-git-clone-broken-mcp-entry`（AC12b 阻塞②，已落地）负责
      vendor 运行时「存在性 + fail-closed + 安装自动构建」（`ensure_vendor_runtime` / quay-init auto-build /
      `verify_provider_runtime_existence`）；**本任务（AC12b 阻塞③）负责「自包含」**——version 构建时内联
      （dist 运行时零外部 package.json 读）+ **旧 config 升级通道迁移**（stale mcp_entry/path → 安装态）。
      两者互补闭环 AC12b 阻塞②③：②保证运行时在、③保证运行时真正自包含且旧 config 不再残留 dev-tree 路径。
      已在 `gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md` 完成记录中反向标注本任务已闭环其 ENOENT 缺陷域。

## Definition of Done

- [x] AC1–AC6 全部勾上
- [x] version.ts 不在 __init 读外部 package.json（构建时内联版本号），node vendor/quay/dist/quay.js --version 返回 0.3.13（实跑输出贴任务体）
- [x] B 机端到端：fresh 安装后 task list 无 ENOENT、mcp_entry 指向存在运行时（实跑输出贴任务体）
- [x] sync-vendor 完成语已修正
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-dist-runtime-not-self-contained-reads-external-package-json.md（自身文件：勾 AC + 贴 invoke 证据授权）

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

## Test-Files

- packages/quay/test/build-dist.test.mjs（build-dist.mjs + version.ts：build + `--version` + test (e) 无 package.json 自包含回归）
- packages/quay/test/npm-pack-e2e.test.mjs（dist 产物 npm-pack 安装后 `--version` / `task list` 真实往返）
- packages/quay/test/build-dist-smoke.test.mjs（dist 独立可运行：task list / serve / MCP initialize / doc-gate）
- plugin/test/plugin-vendor-standalone.test.mjs（vendor dist 单独拷出、零 node_modules 零 package.json 运行）
- plugin/test/quay-init-loop.test.mjs（AC4 旧 config mcp_entry 迁移 + AC3 referenced-existence 负控制）

## Dispatch review

reviewer: inner
at: 2026-08-05T15:05:00Z
changed: 执行本任务（AC12b 阻塞③——dist 运行时自包含 + 旧 config 升级通道迁移）。(1) version.ts 改为构建时内联
版本号（esbuild json loader inlines `import pkg from "../package.json" with { type: "json" }`），dist 运行时
零外部 package.json 读，tsconfig module ES2022→esnext 保持 tsc 0-error；(2) sync-vendor 完成语改为准确描述；
(3) quay-init.sh 新增 `migrate_stale_mcp_entry()`（旧 config 的 path/mcp_entry 指向不存在路径 ⇒ 迁移到安装态
vendor/quay-native；范围守卫保留 AC3 fail-closed）；(4) 测试：build-dist.test.mjs 增 test (e)、
plugin-vendor-standalone.test.mjs 改为只拷 dist 单独运行、quay-init-loop.test.mjs 增 AC4 迁移测试。
AC1/2/3/4/5/6 勾上并贴实跑证据；AC2 N/A（选②未保留运行时读）。
DoD 留空（B 机 fresh 安装 + 全量套件由外层复核）。
