---
id: gap-dashboard-kernel-not-packaged-in-plugin-artifact
title: dashboard-kernel 不在任何发布产物里：sync-vendor 只按文件名镜像 dist/quay.js，vendor
  package.json 又被重写成无 exports——发布 0.18.0 也对消费方不可达
status: todo
labels:
  - gap
  - defect
  - cross-project
parent: null
children: []
extra: {}
---
## Finding

`quay/dashboard-kernel`（`gap-dashboard-kernel-export-for-cross-project-reuse` 的产物）**不会被任何发布产物打包**，因此它对"安装到 user scope 的插件"这一唯一可用消费渠道是**不可达的**。发布一个 0.18.0 也不会改变这一点。

### 取证（2026-10-09 实测，逐环节）

| 环节 | 现状 |
|---|---|
| 构建 `packages/quay/scripts/build-dist.mjs` | ✅ 有 kernel 输出：`DEFAULT_KERNEL_ENTRY = src/dashboard-kernel.ts` → `DEFAULT_KERNEL_OUTFILE = dist/dashboard-kernel.js` |
| **镜像进插件 `plugin/scripts/sync-vendor.sh`** | ❌ **只按文件名逐个 `cp`：`dist/quay.js` 与 `quay-native.js`；整目录不镜像。** 两种模式（full build 与 `--sync-dist`）都是如此，`--check` 也只校验这两个文件。⇒ `dist/dashboard-kernel.js` 永远到不了 `plugin/vendor/quay/dist/` |
| 插件 vendor 的 `package.json` | ❌ 被 `sync-vendor.sh` §6 一个内联 node 脚本**重写**为 `{name:"quay-plugin-vendor", version, private:true, type}` —— `exports` 整个丢掉。⇒ 即便文件在，`require('quay/dashboard-kernel')` 也解析不到 |
| 契约向量 `packages/quay/src/dashboard-kernel-vectors.json` | ❌ 不在任何插件镜像路径里（`plugin/vendor/quay/` 只有 `package.json` + `dist/quay.js` 两个文件，实测 `find` 全树） |
| `publish-dist-branch.sh` → `dist-plugin` 分支 | rsync `plugin/` 整棵子树。**plugin/ 里没有的东西，分支里就没有** |
| marketplace / user-scope 安装 | `.claude-plugin/marketplace.json` 里 `quay` 插件的 source = `github: yaleh/quay` @ `ref: dist-plugin` ⇒ 装的就是上面那棵树 |

实测命令与输出（`/data/home/yale/work/quay`）：

```
$ find plugin/vendor/quay -type f
plugin/vendor/quay/package.json
plugin/vendor/quay/dist/quay.js

$ grep -n 'cp "${SRC}/dist' plugin/scripts/sync-vendor.sh
220:  cp "${SRC}/dist/quay.js" "${DEST}/dist/quay.js"          # --sync-dist 模式
235:  cp "${SRC}/dist/quay.js" "${DEST}/dist/quay.js"          # full-build 模式

$ node -p "Object.keys(require('./plugin/vendor/quay/package.json'))"
[ 'name', 'version', 'private', 'type' ]        # 无 exports
```

### 为什么现在才发现

`gap-dashboard-kernel-export-for-cross-project-reuse` 的 AC1 判据是用 **`npm pack` + 装进 `/tmp` 独立 consumer** 证明子路径可解析——那条路径走的是 `packages/quay` 的 `files` 白名单（含 `src`、`dist`），**绕开了 `plugin/vendor`**。任务 Evidence 里也如实记了 "npm 和 SEA 发布渠道已退役 / 本子路径今天靠本地打包 tarball 或 `file:` 依赖到达外部项目"。但**实际可用的安装渠道是插件 marketplace（dist-plugin 分支 + user scope）**，不是 tarball——这两条路径的打包逻辑不同，前者被证明过，后者没有。

### 影响

- 消费方（claudecodeui 的 Quay tab，已立案 `gap-quay-tab-loop-pulse-gantt-integration`）**拿不到 kernel**：`.quay/plugin/vendor/quay/dist/dashboard-kernel.js` 不存在，`quay/dashboard-kernel` 子路径也不可解析。
- 用户已裁定消费方式为：quay 正式发布 → user scope 安装 → 项目跑 `/quay:init` 升级。**在当前打包现状下这条路径空转**——升级完仍无 kernel。
- 不是 claudecodeui 侧能绕的：vendor 源码副本、`file:` 本地路径依赖、自建 tarball 都已被明确排除（`file:` 会把机器本地绝对路径写进已发布的 `@yalehwang/cloudcli`，对所有消费者致命）。

## Requested action

1. **`plugin/scripts/sync-vendor.sh` 镜像 kernel bundle**：在 full-build 与 `--sync-dist` 两种模式下都 `cp "${SRC}/dist/dashboard-kernel.js" "${DEST}/dist/dashboard-kernel.js"`，并在 `--check` 分支加对应的 `cmp_or_report`（否则 `--check` 会漏掉它，仓内 suite 也不会发现漂移）。注意 `--sync-dist` 的既有前置校验（"缺 bundle 即 `exit 2`，绝不静默"）要同样覆盖 kernel bundle。
2. **镜像契约向量**：`packages/quay/src/dashboard-kernel-vectors.json` 需要到达消费方可读的位置（例如 `plugin/vendor/quay/dist/dashboard-kernel-vectors.json`，或 plugin 内另一个显式声明的路径）。消费方的等价性测试要靠它证明"跑的是同一套算法"，不随包发就等于这条契约不存在。
3. **决定消费方如何 import，并写进 README**：
   - 若走**直接文件路径**（`.quay/plugin/vendor/quay/dist/dashboard-kernel.js`）：`exports` 不需要，但要在 README 写明这个绝对路径契约；
   - 若走**子路径名**（`quay/dashboard-kernel`）：`sync-vendor.sh` §6 重写 vendor `package.json` 时必须保留/生成对应的 `exports` 条目（含 `types` 指向与 `./dashboard-kernel/vectors`）。
   两条选一即可，但必须是**被实际验证过的那一条**——不要只在 `packages/quay` 侧验证。
4. **验证要打在真实产物上**：判据不能再用 `npm pack`（那条路径本来就通）。应从 `publish-dist-branch.sh` 产出的树（或 `plugin/` 装配后的镜像）里，用与消费方相同的方式解析并调用 kernel，断言可用。这是"发布产物真的带上了 kernel"的唯一证据。
5. 以上齐备后再走 0.18.0 发布（`plugin/scripts/release-cut.sh` → tag + `release.yml`；`dist-plugin` 分支是**手动 `workflow_dispatch`** 发布，`publish-plugin-dist.yml` 不会因 push/tag 自动跑，见该 workflow 文件头注释）。

## AC

- [ ] `ls plugin/vendor/quay/dist/dashboard-kernel.js` 存在；`bash plugin/scripts/sync-vendor.sh --check` 对拉起的漂移会红（证明 `--check` 真的覆盖了新文件，而不是"没检查所以没报错"）。
- [ ] 向量文件在插件镜像里可达，路径写进 README。
- [ ] README 写明消费方 import 的确切形式（路径或子路径名），且该形式经过一次真实装配树验证。
- [ ] 判据在**真实发布装配产物**上取真（不是 `npm pack` 的结果，也不是源树直读）。
- [ ] 既有面不回归：`sync-vendor.sh --check` 在干净树上绿；仓内 suite 全绿。

## Notes

- 本任务只解决"kernel 到不了发布产物"。**发布本身**是另一件事（`release-cut.sh`），建议本任务落地后再切 0.18.0，否则切出来的版本仍然对消费方无用。
- 与 `gap-dashboard-kernel-export-for-cross-project-reuse` 的关系：那条任务做的是**算法抽取与子路径声明**（已完成、已合入 develop `2a894daf4`）；本任务是那条的**发布面缺口**——它证明过的 `npm pack` 路径与实际唯一的安装渠道（插件 marketplace）不是同一条。不是重复立案，是其后续。
- 消费方状态：claudecodeui 侧集成任务 `gap-quay-tab-loop-pulse-gantt-integration` 已立案并**被本缺口阻塞**，AC1 就是前置解除取证。
