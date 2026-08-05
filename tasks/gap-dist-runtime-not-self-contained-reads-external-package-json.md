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

**dist 运行时「自包含」声称不成立——version.ts 在 __init 阶段 readFileSync 外部 package.json（管理者 B 机实测 + 外层独立验证）**：

**实测（B 机，路径二安装后）**：node vendor/quay/dist/quay.js task list 报
`Error: ENOENT: no such file or directory, open /home/yale/work/quay/vendor/quay/package.json`，
栈顶是 src/version.ts:29147 在 __init 阶段 readFileSync。⇒ 运行时一启动就读一个没被铺过去的
package.json。

**与 sync-vendor 完成语直接矛盾**：sync-vendor.sh 明写「the vendored dist/quay.js is fully
self-contained (no npm install needed)」——但产物不自包含，有未声明的运行期文件依赖。

**三层缺口叠在一起，都被 verify 放过**：
① sync-vendor 声称自包含，实际不是（version.ts:13-14 在 __init 读 ../package.json）；
② quay-init 把 dist 铺过去了但没铺同目录的 package.json（铺设映射无此项）；
③ verify-installed-executables 检查 98 文件字节一致、verify-referenced-landed 说每个被引用文件
都已落地，两条都 OK——因为 package.json 既不在铺设集也不被任何 SKILL.md 引用，**判据看不见它**。
与 vendor 运行时被 WARN 放过同一族：判据覆盖「声明过的东西」，漏的恰是「没人声明所以没人检查」。

**修法（管理者建议，外层裁定选②）**：
- ② **version.ts 不在 __init 读外部文件，构建时内联版本号进 bundle**——真正的自包含，对得起
  sync-vendor 那句完成语。
- ③ sync-vendor 那句「fully self-contained」修好前应改掉（会误导下一个人）。

### 选定机制

1. version.ts 版本号构建时内联进 bundle（build-dist 注入），不在 __init readFileSync 外部文件
2. sync-vendor 完成语修正（修好前不声称自包含）
3. 验证：B 机路径二安装后，node vendor/quay/dist/quay.js task list 正常（无 ENOENT）

## Acceptance Criteria

- [ ] AC1: dist 运行时启动不读外部 package.json（版本号内联进 bundle，构建时注入）——node vendor/quay/dist/quay.js --version 正常
- [ ] AC2: 若保留运行时读文件，quay-init 铺设映射补 vendor/<pkg>/package.json（fresh-clone 后存在）
- [ ] AC3: sync-vendor 完成语修正（修好前不声称 fully self-contained，或改为准确的描述）
- [ ] AC4: B 机路径二验证：安装后 task list 无 ENOENT（实跑输出贴任务体）
- [ ] AC5: 与 gap-vendor-runtime-not-in-git-clone-broken-mcp-entry 交叉标注（AC12b 阻塞②延伸）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] version.ts 不在 __init 读外部 package.json（构建时内联版本号），node vendor/quay/dist/quay.js --version 返回 0.3.13（实跑输出贴任务体）
- [ ] B 机路径二验证：fresh 安装后 task list 无 ENOENT（实跑输出贴任务体）
- [ ] sync-vendor 完成语已修正（不声称 fully self-contained）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- packages/quay/src/version.ts（内联版本号，不在 __init 读外部文件）
- packages/quay/scripts/build-dist.mjs（构建时注入版本号）
- plugin/scripts/sync-vendor.sh（完成语修正）
- plugin/scripts/quay-init.sh（若选②：铺设映射补 package.json）
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（AC5 交叉标注）

## Contract

measure   dist_no_external_read = `node --no-warnings vendor/quay/dist/quay.js --version 2>&1 | grep -c 'ENOENT\|Error'` stdout 数字段（fresh 安装后）
band      dist_no_external_read = 0（无 ENOENT/Error）
invariant version_inlined_at_build = 1（版本号构建时内联，运行时零外部文件读）
invoke    `grep -n 'package.json\|readFileSync\|self-contained' plugin/scripts/sync-vendor.sh packages/quay/src/version.ts`
control   当前形态（读外部 package.json）⇒ fresh 安装 ENOENT（AC1 负控制）；修后 ⇒ 无 ENOENT
resume    version 内联与 sync-vendor 完成语分步提交，任一步完成即写盘