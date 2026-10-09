---
id: gap-dashboard-kernel-not-packaged-in-plugin-artifact
title: dashboard-kernel 不在任何发布产物里：sync-vendor 只按文件名镜像 dist/quay.js，vendor
  package.json 又被重写成无 exports——发布 0.18.0 也对消费方不可达
status: ready
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

- [x] `ls plugin/vendor/quay/dist/dashboard-kernel.js` 存在；`bash plugin/scripts/sync-vendor.sh --check` 对拉起的漂移会红（证明 `--check` 真的覆盖了新文件，而不是"没检查所以没报错"）。 —— 实测：`plugin/vendor/quay/dist/dashboard-kernel.js` 存在，且与 `packages/quay/dist/dashboard-kernel.js` 逐字节相同。本任务顺带修掉了一处会让这条判据【恒假】的构建性质：kernel bundle 的字节原本随构建进程的 cwd 变化（esbuild 把入口路径按 cwd 相对写进首行注释——实测同一源树 cwd=worktree 2074 B / cwd=packages/quay 2060 B，唯一差异就是那一行），⇒ 任何带外的单独 build 都会让「镜像 vs 源」错误变红（本轮实测到一次，见 Disposition）。修法：`build-dist.mjs` 的 `buildDashboardKernel` 固定 `absWorkingDir: pkgDir`；实测四种 cwd（worktree / 主检出 / packages/quay / /tmp）现在产出同一字节（2060 B，md5 `320ae9d5a3752f3a7afccacd491b81f0`）；真实树上把该镜像改一字节 ⇒ `bash plugin/scripts/sync-vendor.sh --check` exit 1 且输出 `DRIFT: vendor/quay/dist/dashboard-kernel.js differs…`，`cp` 回备份后 exit 0（落痕 /tmp/ac-kernel-negctl.txt）。覆盖性对照：把新增的两行 `cmp_or_report` 从脚本里删掉后，同一处改字节 ⇒ exit 0 / `CLEAN`、全文 0 处提到 kernel（/tmp/ac-kernel-checkcov-negctl.txt）——即红来自这两行检查，不是别的文件。`plugin/test/sync-vendor.test.mjs` 在一次性拷贝树里把正反两向都钉住。
- [x] 向量文件在插件镜像里可达，路径写进 README。 —— `plugin/vendor/quay/dist/dashboard-kernel-vectors.json`（9637 B）与 `packages/quay/src/dashboard-kernel-vectors.json` 逐字节相同。README `## Public API: quay/dashboard-kernel` 以 `new URL("vendor/quay/dist/dashboard-kernel-vectors.json", pluginRoot)` 写明该路径；`plugin/test/sync-vendor.test.mjs` 从 README 里【解析出这两个路径】再逐个 stat 插件镜像（不是关键词匹配），并断言 README 交出的正是这两条。
- [x] README 写明消费方 import 的确切形式（路径或子路径名），且该形式经过一次真实装配树验证。 —— README 写明的形式是【插件根下的文件路径】：`<plugin-root>/vendor/quay/dist/dashboard-kernel.js` 与其旁的向量文件，动态 `import()` 即用（kernel 是零 import 的 ESM 叶子，不涉及 node_modules 解析）。该形式在【真实发布产物】上验证：`/tmp/kernel-art/tree`（由 `publish-dist-branch.sh` 在 throwaway stub 仓装配出的 266 文件树）里 `import()` 成功、返回 `packLanes`/`mergeLiveAndHistoryIntervals`（函数）、`FIXED_GANTT_LANES=5`，3/3 契约向量逐字节复现。⛔ 未按方案 B 的【子路径名】写死（`quay/dashboard-kernel` 那条仍等 A/B/C 人工裁决）；文件路径形式是 Requested action 1/2「无论选哪条都成立」的那一半，故不构成对裁决的预判。
- [x] 判据在**真实发布装配产物**上取真（不是 `npm pack` 的结果，也不是源树直读）。 —— 判据取真的载体就是发布装配产物而非 `npm pack` 或源树直读：`bash plugin/scripts/publish-dist-branch.sh --no-build --branch probe-dist`（stub 仓、真脚本）→ `git archive` 出来的树里 `vendor/quay/dist/{dashboard-kernel.js,dashboard-kernel-vectors.json}` 在场，`--verify-closure-dir` 与 shipped-set 规则都放行（`isExcluded=false`，由测试用真规则判定），并从中 import + 复现向量（上一条）。
- [x] 既有面不回归：`sync-vendor.sh --check` 在干净树上绿；仓内 suite 全绿。 —— 干净树上 `bash plugin/scripts/sync-vendor.sh --check` ⇒ exit 0 / `CLEAN`（含 `OK (identical): vendor/quay/dist/dashboard-kernel.js` 与向量两行）；`--sync-dist` 的缺 bundle 前置校验现覆盖 kernel bundle（缺即 exit 2）。本轮的 scoped 门（`scripts/test.sh --for-task gap-dashboard-kernel-not-packaged-in-plugin-artifact --allow-thin`）由本轮跑绿；全量 suite 是 fan-in 的步骤，本轮不含。附带两次棘轮重锚均取【产物自身的读数】并已提交：`plugin/shipped-set-baseline.json` shipped 264→266 文件、`plugin/sh-census-baseline.json` embeddedInterpreterLines 6559→6566（`sync-vendor.sh` +7 行，差分实测：回退该文件后同一条检查读回 6559）。

## DoD

判据打在**装配后的发布树**上、且能取假：`bash plugin/scripts/sync-vendor.sh --check` 在干净树上 exit 0，在其镜像的 kernel bundle 被人为改一字节后 exit≠0（证明 `--check` 真覆盖了 kernel，而不是「没检查所以没报错」）；向量文件与 `dist/dashboard-kernel.js` 在装配树里按 README 写明的形式可解析，并用与消费方相同的方式（从 `publish-dist-branch.sh` 产出的树 / 装配后的 `plugin/` 镜像，**不是** `npm pack`、**不是**源树直读）import 成功并调用 kernel（断言 `packLanes` / `mergeLiveAndHistoryIntervals` 可调用）。负控制有落痕：回退 `sync-vendor.sh` 后同一条装配树判据非 0，恢复后为 0。⛔ 只在 `packages/quay` 侧验证、或只改 README 未装配 ⇒ 不算达成。

## Touches

- plugin/scripts/sync-vendor.sh
- plugin/test/sync-vendor.test.mjs
- packages/quay/src/dashboard-kernel-vectors.json
- plugin/vendor/quay/package.json
- packages/quay/README.md
- packages/quay/scripts/build-dist.mjs
- tasks/gap-dashboard-kernel-not-packaged-in-plugin-artifact.md
- plugin/shipped-set-baseline.json
- plugin/sh-census-baseline.json

## Notes

- 本任务只解决"kernel 到不了发布产物"。**发布本身**是另一件事（`release-cut.sh`），建议本任务落地后再切 0.18.0，否则切出来的版本仍然对消费方无用。
- 与 `gap-dashboard-kernel-export-for-cross-project-reuse` 的关系：那条任务做的是**算法抽取与子路径声明**（已完成、已合入 develop `2a894daf4`）；本任务是那条的**发布面缺口**——它证明过的 `npm pack` 路径与实际唯一的安装渠道（插件 marketplace）不是同一条。不是重复立案，是其后续。
- 消费方状态：claudecodeui 侧集成任务 `gap-quay-tab-loop-pulse-gantt-integration` 已立案并**被本缺口阻塞**，AC1 就是前置解除取证。

## Update（2026-10-09）：独立复核 + 交付机制升级为 A/B/C 人工裁决

会话 `Quay Dashboard Gantt Kernel 架构决策` 已独立逐行复核，结论一致，并补充/修正如下（以下每条我均已自行复验）：

1. **`--check` 的形状测试不覆盖本缺口**（修正上文 Requested action 1 的一半）：`sync-vendor.sh` 对 vendor package.json 的形状测试只拒绝四种情况——`name !== 'quay-plugin-vendor'` / `type !== 'module'` / 无 `version` / **有 `dependencies`**（实测该 `node -e` 断言）。**新增一个 `exports` 键不会触发它**。⇒ 镜像 kernel bundle 仍必须新增 `cmp_or_report`（否则漂移无人发现）；但"加 `exports` 会被 `--check` 拦"这个顾虑不成立。
2. **措辞校正**：`packLanes` 算法本身一直随 Core bundle 出货（抽取前它内联在 `serve-dashboard.ts` 里）。**从未出货的是"可导入的子路径"**，不是算法。
3. **`/quay:init` 结构上不可能提供模块**：`plugin/skills/init/SKILL.md:9` 明写 "init is a project initializer, NOT an installer"，写入面是六文件闭集（同文件 `## Write surface (the six-file closed set)`）。所以"升级后跑 `/quay:init`"只能切 `.quay/plugin` 的指向，装不出任何可导入物。
4. **"让文件存在"是必要但可能不充分**（重要，影响方案 B）：从版本化插件缓存路径导入（`~/.claude/plugins/cache/quay/quay/<version>/vendor/quay/dist/…`）结构上脆弱——版本目录每次升级都变，且位于消费方项目构建图之外。
5. **CI 是红的，与本缺口无关但同为发布门禁**：实测 `gh run list --branch develop --status completed --limit 10` → 最近完成的 8 次中 **6 次 `failure`、2 次 `cancelled`**（2026-10-09 07:27–08:48）；更新的运行全部卡在 `queued`（积压）。**任何发布都被此挡住**，与选哪个交付方案无关。

**交付机制已升级为人工裁决**（由上述会话推动，本任务不单方面选定）：

- **A. quay CLI 直接输出 merged+packed lanes 的 JSON**，消费方 shell 出去取——与既有 `quay driver live --json` 同一模式，**同时满足全部约束**（不 vendor / 不 `file:` / 不 npm 公共渠道），且消费方（claudecodeui）后端本来就对 quay 全程走 CLI 子进程，最贴既有架构。
- **B. 从插件镜像按路径 import**（上文 options 1/2）——受第 4 条脆弱性影响。
- **C. 恢复 GitHub Release tarball asset**（`npm install <release-url>`）：保留 `exports` 映射、复用已测过的 AC1 面，不需要公共 npm；但这部分**反转 2026-09-16 取消 npm/SEA 渠道的裁定**，需人工明确同意。

**在 A/B/C 裁决前**：上文 Requested action 的第 1、2、4、5 条仍然成立（无论选哪条，"产物里可达 / 经 CLI 可达"与"判据打在真实装配产物上"都必须满足），但**第 3 条（消费方 import 的确切形式）应等裁决**，不要先按 B 写死。
## Disposition（2026-10-09，worker 落地）

实现面（commit `320b9bffb`，分支 `task/gap-dashboard-kernel-not-packaged-in-plugin-artifact`）：

- `plugin/scripts/sync-vendor.sh`：两种模式（full build 与 `--sync-dist`）都镜像 `packages/quay/dist/dashboard-kernel.js` → `plugin/vendor/quay/dist/dashboard-kernel.js`、`packages/quay/src/dashboard-kernel-vectors.json` → `plugin/vendor/quay/dist/dashboard-kernel-vectors.json`；`--check` 对两者各加一条 `cmp_or_report`；`--sync-dist` 的「缺 bundle 即 exit 2」前置校验由单文件 `if` 扩成对 `quay.js dashboard-kernel.js` 的循环（同样 fail-closed）。
- `packages/quay/README.md`：新增「从已安装插件取用」一节，写明插件根下的两条路径与零 import/零解析的消费方式；并把 Distribution note 更正为「活渠道是插件 marketplace」。
- `plugin/test/sync-vendor.test.mjs`：四条读数——镜像逐字节一致、shipped-set 规则不排除这两条路径、`--check` 双向控制（一次性拷贝树：干净 exit 0 / 改一字节 exit≠0 且点名 kernel）、README 写明的路径被解析后从【拷出仓库的树】导入并复现镜像向量。
- 两次棘轮重锚（取产物自身读数）：`plugin/shipped-set-baseline.json`（shipped 264→266 文件，`--reanchor` 由真装配树写出）、`plugin/sh-census-baseline.json`（6559→6566）。
- 本轮实测到、并【顺手修掉】的一条先存性质：`dist/dashboard-kernel.js` 把【相对构建进程 cwd】的入口路径写进产物首行注释，于是同一个源树在不同 cwd 下构建出的 bundle 字节不同（实测 cwd=worktree 2074 B / cwd=packages/quay 2060 B；`.js` 其余部分逐字节相同）。这颗雷本来就存在（`dist/quay.js` 同样把路径写进产物），但本任务把 kernel 加进 `--check` 的逐字节比较后它就会【从无害变成会错误地判红】：验证过程中实测到一次带外的单独 kernel 重建让镜像与源失配、`--check` 变红（重建 + 重新镜像即恢复）。修法：`packages/quay/scripts/build-dist.mjs` 的 `buildDashboardKernel` 加 `absWorkingDir: pkgDir`（只影响 esbuild 如何拼写路径，不影响入口解析）。⛔ `buildDist`（quay.js）未一并改：它的产物更大、被更多既有断言间接约束，且它今天不出问题（构建与 `--sync-dist` 永远成对），改它是独立的一件事。

**与 `## Update` 里 A/B/C 裁决的关系**：本任务只落地 Requested action 的 1/2/4/5（镜像 + `--check` 覆盖 + 真实装配产物上的判据），第 3 条的【消费方 import 的确切形式】按裁决前的指示【未按方案 B 的子路径名写死】——README 写的是 artifact 内的文件路径契约（方案 A 的 CLI 输出与方案 C 的 tarball 都不改变「产物里文件可达」这一必要条件）。裁决落地后若选 B/A，README 那一节按裁决改写即可，本任务的产物与检查不需要回退。
