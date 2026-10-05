---
id: gap-release-bundle-embeds-dev-version-after-stamp
title: release 构建后 dist/quay.js 与 scripts/dist/*.js 仍内嵌 X.Y.Z-dev：stamp 不覆盖
  bundle，且没有任何检查能发现
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**机制**:`packages/quay/src/version.ts` 的 QUAY_VERSION 在构建时由 esbuild 内联 `packages/quay/package.json` 的 version,该文件已提交的值恒为 `X.Y.Z-dev`。`plugin/scripts/sync-vendor.sh`(约 490-506 行)与 `plugin/scripts/publish-dist-branch.sh`(:154)都先生成 bundle、最后才跑 `scripts/stamp-version.mjs --mode build`;stamp 只改已登记的版本载体(plugin/VERSION、plugin.json、marketplace.json、README.md、vendor/quay/package.json),不重建 bundle。结果:release/* 分支或 vX.Y.Z tag 上的构建,载体是 X.Y.Z,bundle 里仍是 X.Y.Z-dev。

**生产实测(2026-10-05,已安装的 quay 0.14.0,~/.claude/plugins/cache/quay/quay/0.14.0/)**:VERSION、plugin.json、vendor/quay/package.json 都是 0.14.0;但 `vendor/quay/dist/quay.js` 内嵌 package_default.version 为 "0.14.0-dev",所以 `quay --version`、MCP 工具描述 "Version: …"、`_version` 字段都输出 0.14.0-dev;`scripts/dist/send-to-session.js` 同样含 "0.14.0-dev"。

**为什么没人发现**:`plugin/scripts/quay-init.sh:1137` 用 `grep -oE '[0-9]+\.[0-9]+\.[0-9]+'` 取 `--version` 的第一个 X.Y.Z,把 `-dev` 后缀吞掉;读数与"合格"同形(硬规则 3b)。

**修法(方向,二选一由实现者在 AC 约束内定)**:(a)发布前校验门:在 stamp 之后检查 dist/quay.js 与 scripts/dist/*.js 内嵌版本 == plugin.json 版本,读不到内嵌版本时报"未评估"而非通过;(b)stamp 之后重建 bundle。优先 (a),成本低且能取假;(b) 改动面更大,需同时核对 sync-vendor 与 publish-dist-branch 两条路径。

<!-- dedup-ref -->相关(追溯,非前置):gap-version-stamp-generator-and-build-wiring(stamp 生成器本身,已 done,未覆盖 bundle 内嵌值);gap-dist-runtime-not-self-contained-reads-external-package-json(引入了 build-time 内联,已 done)。

## Touches
- `scripts/version-consistency-check.ts`
- `scripts/version-consistency-check.mjs`
- `scripts/version-consistency-check.test.ts`
- `plugin/scripts/sync-vendor.sh`
- `plugin/scripts/publish-dist-branch.sh`
- `tasks/gap-release-bundle-embeds-dev-version-after-stamp.md`
- `plugin/skills/manager/SKILL.md`
- `plugin/skills/init/SKILL.md`

## AC
- [x] 新增/扩展的测试(在 `scripts/version-consistency-check.test.ts` 中)构造一棵载体=0.14.0 而 dist/quay.js 内嵌 "0.14.0-dev" 的 fixture 树,校验门对它退出非 0 并点名 dist/quay.js;`node --experimental-strip-types --test scripts/version-consistency-check.test.ts` 退出 0。
- [x] 取假:同一 fixture 在内嵌版本改为 "0.14.0" 后校验门退出 0;内嵌版本串读不出时输出含 `NOT-EVALUATED` 且退出码与"通过"可区分(附两次实跑输出)。
- [x] 校验门被接入 `plugin/scripts/sync-vendor.sh` 与 `plugin/scripts/publish-dist-branch.sh` 的 stamp 之后:`grep -n` 能在两个文件中各找到对该门的调用,且调用位于 stamp-version.mjs 调用之后(贴出行号)。
- [x] 读生产载体:对一次真实 `--mode build` 在 release/* 形态下产出的装配树(或临时 release 分支构建)实跑校验门,读出 dist/quay.js 内嵌版本与 plugin.json 版本一致;输出原文贴进完成记录。该条 AC 在关闭校验门接入后必须变红(负控制)。
- [x] `bash scripts/test.sh --for-task gap-release-bundle-embeds-dev-version-after-stamp` 退出 0,且执行了 ≥1 个测试文件。

## DoD
真实落地:一次真实 release 形态构建产出的已安装式插件树上,`node <plugin>/vendor/quay/dist/quay.js --version` 的输出与该树的 plugin.json 版本一致(不含 -dev),且校验门在把 bundle 改回内嵌 -dev 时能拦住构建。仅有 fixture 测试绿不算完成。

## 完成记录

**实现**(分支 `task/gap-release-bundle-embeds-dev-version-after-stamp`,commit `356ff0398`):
- `scripts/version-consistency-check.ts` 新增 **BUILD-TREE BUNDLE AXIS**:`checkBundleTree(tree)` 判 `<tree>/vendor/quay/dist/quay.js`(必带内嵌版本)与每个带内嵌版本的 `<tree>/scripts/dist/*.js` 是否 == `<tree>/.claude-plugin/plugin.json` 的版本;读不出锚点 ⇒ `NOT-EVALUATED`(exit 3,与 PASS/DRIFT 均不同)。`stampBundleTree(tree)` 从树的 manifest 重新派生内嵌 token((b) 半)。CLI 重构为导出 `main(argv, env)`。
- `scripts/version-consistency-check.mjs` 新增(Node-20-safe runner,镜像 `stamp-version.mjs`)——sync-vendor.sh 是 root postinstall 与 package.sh 的 Node-20 路径,`--experimental-strip-types` 在那里不存在;故两个 .sh 都经此 runner 调用。
- 两个 .sh:stamp → restamp → gate,链在**既有** stamp 行上(sh-census 棘轮按 embedded-interpreter 有效行计数且拒绝高于 HEAD 的工作树基线 ⇒ 不新增代码行;注释行不计)。

**AC1**:fixture `[AC1] bundle gate REDDENS…`(plugin.json=0.14.0,bundle=0.14.0-dev ⇒ DRIFT,点名 `dist/quay.js`)。
`node --experimental-strip-types --test scripts/version-consistency-check.test.ts` ⇒ `tests 34 · pass 34 · fail 0`,exit 0。

**AC2**(三例实跑,`.mjs` runner):
```
CASE A  bundle=0.14.0-dev, plugin.json=0.14.0:
BUNDLE-EMBEDDED: DRIFT DETECTED
  expected (from .claude-plugin/plugin.json): 0.14.0
  vendor/quay/dist/quay.js  0.14.0-dev != 0.14.0
1 of 1 bundles != the tree's .claude-plugin/plugin.json version:
  vendor/quay/dist/quay.js (0.14.0-dev)                          EXIT=1
CASE B  bundle=0.14.0 (匹配):
BUNDLE-EMBEDDED: OK
  vendor/quay/dist/quay.js  0.14.0 == 0.14.0                     EXIT=0
CASE C  bundle 无内嵌 token:
BUNDLE-EMBEDDED: NOT-EVALUATED
  vendor/quay/dist/quay.js  ERROR — no inlined package_default.version token (cannot evaluate — not a pass)
  (the bundle axis could not be judged — NOT a pass; hard rule 3b)  EXIT=3
```

**AC3**(grep -n;两个调用都在 stamp 之后 —— 与 stamp 同一逻辑行,`&&` 保证执行在其后;链式是为满足 sh-census 棘轮的行数中立,注释见脚本内):
```
plugin/scripts/sync-vendor.sh:524  echo "…stamping…" && node …/stamp-version.mjs --mode build … && node …/version-consistency-check.mjs --stamp-bundle-tree "$PLUGIN_DIR" && node …/version-consistency-check.mjs --bundle-tree "$PLUGIN_DIR"
plugin/scripts/publish-dist-branch.sh:168  … && node …/stamp-version.mjs --mode build --root "$WORK" --git-root "$REPO_ROOT" && node …/version-consistency-check.mjs --stamp-bundle-tree "$WORK" && node …/version-consistency-check.mjs --bundle-tree "$WORK"
```

**AC4 + DoD**(临时 release 分支 `release/v0.15.0-bundlegap-evidence` 上的真实 `bash plugin/scripts/sync-vendor.sh`;VERSION=0.15.0):
```
STAMP-VERSION: mode=build … VERSION = 0.15.0 => every carrier must == 0.15.0
STAMP-VERSION: wrote 4 file(s) … .claude-plugin/plugin.json / README.md / vendor/quay/package.json / VERSION : 0.15.0-dev -> 0.15.0
BUNDLE-EMBEDDED-STAMP: OK — re-derived 1 bundle(s) to 0.15.0   (# vendor/quay/dist/quay.js)
BUNDLE-EMBEDDED: OK
  expected (from .claude-plugin/plugin.json): 0.15.0
  vendor/quay/dist/quay.js  0.15.0 == 0.15.0
SYNC_EXIT=0
---
plugin.json version: 0.15.0
bundle --version:    0.15.0            (DoD: 一致,不含 -dev)
```
负控制(把 bundle 内嵌 token 改回 `0.15.0-dev`):`bundle --version` 变 `0.15.0-dev`;gate 转红 `BUNDLE-EMBEDDED: DRIFT DETECTED … vendor/quay/dist/quay.js  0.15.0-dev != 0.15.0` exit 1;且在 `set -euo pipefail` 链下中止构建(`CHAIN_EXIT=1`,`REACHED` 未打印)。恢复后 gate 复绿。

**AC5**:
```
bash scripts/test.sh --for-task gap-release-bundle-embeds-dev-version-after-stamp --allow-thin   ⇒ exit 0
selector: test-selection-thin 1/5 Touches (0.20) < 0.5;ran 1 test file(plugin/test/…postinstall… 5 tests,pass 5);
scoped static checks 全绿(incl. sh-census-check 7686 == baseline 7686,未越基线)。
```
⛔ `scripts/version-consistency-check.test.ts` 是 `.ts` 且不在 `test/` 目录下,`select-tests-for-touches` 只认 `test/**/*.test.mjs` ⇒ 该测试文件不进入 scoped/full suite 的自动选择,只由 AC1 的直接调用运行(既有 `scripts/*.test.ts` 同此)。

---

**本轮补修(develop 全域静态红,非本任务 delta)**:`orchestration/SPEC-goal-author-branch-2026-10-05.md` 于 2026-10-05 直落 develop(`7a596134b`)时未在 `plugin/skills/manager/SKILL.md` 与 `plugin/skills/init/SKILL.md` 两个声明点补声明 ⇒ `spec-declaration-point-check` 全域红,所有任务的 fan-in suite 在静态层 abort(`# tests 0 · # fail 72`)。本任务 branch 补两处声明后 checker 复绿(48 SPECs / 2 points)。两个 skill 文件已加入本任务 `## Touches`。
