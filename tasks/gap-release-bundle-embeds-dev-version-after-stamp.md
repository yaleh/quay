---
id: gap-release-bundle-embeds-dev-version-after-stamp
title: release 构建后 dist/quay.js 与 scripts/dist/*.js 仍内嵌 X.Y.Z-dev：stamp 不覆盖
  bundle，且没有任何检查能发现
status: ready
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
- `scripts/version-consistency-check.test.ts`
- `plugin/scripts/sync-vendor.sh`
- `plugin/scripts/publish-dist-branch.sh`
- `tasks/gap-release-bundle-embeds-dev-version-after-stamp.md`

## AC
- [ ] 新增/扩展的测试(在 `scripts/version-consistency-check.test.ts` 中)构造一棵载体=0.14.0 而 dist/quay.js 内嵌 "0.14.0-dev" 的 fixture 树,校验门对它退出非 0 并点名 dist/quay.js;`node --experimental-strip-types --test scripts/version-consistency-check.test.ts` 退出 0。
- [ ] 取假:同一 fixture 在内嵌版本改为 "0.14.0" 后校验门退出 0;内嵌版本串读不出时输出含 `NOT-EVALUATED` 且退出码与"通过"可区分(附两次实跑输出)。
- [ ] 校验门被接入 `plugin/scripts/sync-vendor.sh` 与 `plugin/scripts/publish-dist-branch.sh` 的 stamp 之后:`grep -n` 能在两个文件中各找到对该门的调用,且调用位于 stamp-version.mjs 调用之后(贴出行号)。
- [ ] 读生产载体:对一次真实 `--mode build` 在 release/* 形态下产出的装配树(或临时 release 分支构建)实跑校验门,读出 dist/quay.js 内嵌版本与 plugin.json 版本一致;输出原文贴进完成记录。该条 AC 在关闭校验门接入后必须变红(负控制)。
- [ ] `bash scripts/test.sh --for-task gap-release-bundle-embeds-dev-version-after-stamp` 退出 0,且执行了 ≥1 个测试文件。

## DoD
真实落地:一次真实 release 形态构建产出的已安装式插件树上,`node <plugin>/vendor/quay/dist/quay.js --version` 的输出与该树的 plugin.json 版本一致(不含 -dev),且校验门在把 bundle 改回内嵌 -dev 时能拦住构建。仅有 fixture 测试绿不算完成。
