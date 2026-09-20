---
id: gap-version-stamp-generator-and-build-wiring
title: 版本号生成器 stamp-version——改 VERSION 一处即更新全部提交载体（含 package-lock 4 条），构建阶段按
  build 模式盖章，替换 package.sh 的手工漂移校验
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-version-single-source-root-file-and-resolver
---
## Proposal

前置：`gap-version-single-source-root-file-and-resolver`（根 `VERSION` 与 `resolveVersion` 已落地；本任务消费它，不重定义）。

**问题**：单一来源落地后，改 `VERSION` 仍要手改 15 处字面量才能让检查器变绿——来源是唯一了，写入还是人肉的。`packages/quay/scripts/package.sh:83-92` 也是「三处手抄再比对」的事后校验，而不是从来源生成。

**人的裁定（2026-09-20，逐字）**：「a. 仍提交字面量，但写死为基础版本加 -dev，由生成器在改 VERSION 时一并更新。」「可以在 build 过程中，监测分支并加后缀，如 -dev。」

**做法**：
1. 新增 `scripts/stamp-version.ts`：`--mode tracked`（默认）把 `resolveVersion(VERSION,'tracked')` 写入全部提交载体——4 个 `packages/*/package.json`、`package-lock.json` 里 `packages/quay{,-native,-github,-backlog}` 4 条、`plugin/.claude-plugin/plugin.json`、两个 `marketplace.json` 的 quay 条目、`plugin/README.md` 首行、`plugin/vendor/quay/package.json`、`plugin/VERSION`、`delivery-manifest.json`；`--check` 只报不写（有差异 exit 1，列出文件与前后值）；写入后输出「改了哪些文件」清单。`--mode build --root <staged-dir>`：对构建产物目录按 `resolveVersion(VERSION,'build')` 盖章。
2. 载体清单只有一份：`version-consistency-check.ts` 与 `stamp-version.ts` 共用同一个导出的载体表（禁止两处各抄一份，否则又成漂移源）。`package-lock.json` 的 4 条并入该表（补上原检查器缺口）。
3. 接线：`packages/quay/scripts/package.sh` 的 manifest 版本校验改为调用 `stamp-version.ts --check`（旧的三处手抄比对删除）；`plugin/scripts/sync-vendor.sh` 与 `plugin/scripts/publish-dist-branch.sh` 在产出 dist 后调用 `stamp-version.ts --mode build --root <dist>`，使 release 分支/tag 上的 dist 无 `-dev`、其余带 `-dev`。
4. 人裁定接受：tag 提交里的提交载体仍是 `X.Y.Z-dev`（不再自描述），发布产物的版本由 build 模式决定；因此发布不再需要「去 -dev 的 bump 提交」。

### 实施记录（落地时才暴露的三件事）

**A. `stamp-version.mjs`——Node 20 地板逼出来的第二个入口（实测，非预防性设计）。**
`engines` 是 `>=20`，而 `--experimental-strip-types` 要 Node 22.6+。实测 `npx node@20 --experimental-strip-types …` ⇒ `node: bad option`。而两个调用方都钉在地板上：`package.sh` 由 ci.yml 的 `dist-verify-node-floor`（Node 20）跑，`sync-vendor.sh` 的常驻调用方是根 `postinstall`。所以这两个 .sh 走 `scripts/stamp-version.mjs`（esbuild 把 .ts 打成 .mjs 再调其 `main`）——与 `build-dist.sh` 自己在 Node 20 上跑 esbuild 是同一条已确立的路。单一实现，两个入口；runner 只转发 argv 与退出码，自身不持有任何判据（有测试钉这一点）。

**B. `sync-vendor.sh` section 3 的既有缺陷（本任务暴露，一并修掉）。**
`experiments/quay-perpetual-stream/scripts/{task-schema,task-schema-check}.{ts,sh}` 与 `gate-script-lib.sh` 现是指回 `plugin/scripts/` 的符号链接，section 3 的 `cp` 因此是「把文件拷到自己身上」⇒ `cp: … are the same file` exit 1 ⇒ `set -e` 中止整个脚本。实测（2026-09-20，新建 worktree）：full（无参）路径死在 section 3，**永远到不了后面的步骤**——包括本任务新增的盖章步。该中止是既有的、且不可见：唯一常驻调用方 postinstall 的 `|| true` 把它吞了。section 4 早有同款 `-L` 守卫，这里只是补齐该文件自己的既有做法。不修则本任务的接线是死代码，release 构建会静默发布带 `-dev` 的产物。

**C. sh-census 只降不升棘轮逼出的压紧（改法不是调基线）。**
`plugin/sh-census-check.ts` 对 `embeddedInterpreterLines` 设只降不升棘轮（基线 `plugin/sh-census-baseline.json`）；两个被改的 .sh 都含内嵌解释器 ⇒ 其**全部有效行**计入读数。初版接线实测 +28（9533 > 9505）直接红。改法：section 3 合并拷贝（-2 行）、section 7 的 else 分支收成 1 行、publish 侧挂到既有 `--rewrite` 行（+0）。实测 delta：`sync-vendor.sh` -1、`publish-dist-branch.sh` 0、`package.sh` +4（该文件无内嵌解释器，不计入）。⛔ 未动基线、未进例外清单。

**D. 一处必须说清的副作用。** build 模式的盖章落在 `plugin/` 上，所以在 `release/*` 分支上它会写**被跟踪的文件**（`plugin/VERSION` 等 5 个）。这是刻意的、也是 AC4 要求的读数：release 分支是瞬态构建面，这些改动不被提交（tag 打在 `-dev` 提交上，发布版本属于产物）；develop/author 上 build == tracked，不写任何文件、`git status` 干净。

## AC

- [x] `node --experimental-strip-types --test scripts/stamp-version.test.ts` exit 0：改 fixture 的 `VERSION` 后 `stamp-version` 一次调用使全部载体（含 package-lock 4 条）== `X.Y.Z-dev`，随后 `version-consistency-check.ts` exit 0；`--check` 对被人为改乱的载体 exit 1 并列出该文件。
  - 读数：`ℹ tests 14  ℹ pass 14  ℹ fail 0`，exit 0（同目录 `version-consistency-check.test.ts`：26/26，exit 0）。
  - fixture 不是手写的替身，而是**真实载体树的拷贝**（路径来自共享表），所以「表里有、生成器够不着」的载体在这里就会失败（硬规则 4 推论三）。
  - 「载体表单一」不是断言一次，而是**逐条**验：测试对 15 条载体**每条**单独改坏，要求 `--check` exit 1 且点名该文件，再恢复要求回绿——生成器的表比判据短、或比判据长，都会在这里露出来。
- [x] 载体表单一：`grep -rn "packages/quay-backlog/package.json" scripts/*.ts | grep -v "\.test\."` 只在一个模块里出现（打印前 3 条命中，人工核对不是注释误命中；并把谓词对已知为真的样本干跑一次）。
  - 只有一条命中，且不是注释：`scripts/version-carriers.ts:193:  jsonVersionField('packages/quay-backlog', 'packages/quay-backlog/package.json'),`。
  - 干跑（对已知为真的样本 `scripts/version-carriers.ts`）返回同一命中 ⇒ 谓词非空转。其余三条 carrier 路径同样只在 `scripts/version-carriers.ts` 出现。
  - 负控制：把 4 条 lock 条目喂给旧 fixture（无 `package-lock.json`）⇒ 新检查器 exit 1 / `mode:'error'`（4 条 ERROR）——证明 fixture 扩展是承重的，不是装饰。
- [x] 真实对象：在真实仓库把 `VERSION` 改成 `9.9.9`（临时），运行 `node --experimental-strip-types scripts/stamp-version.ts` 后 `git diff --name-only` 列出的文件集合 == 载体表全集（15 处逐个在场，报条数与清单），`version-consistency-check.ts` exit 0；`git checkout -- .` 还原后同命令仍 exit 0。
  - `STAMP-VERSION: wrote 12 file(s), 15 carrier(s)`；15 条逐条读回全为 `9.9.9-dev`（含 4 条 lock 条目，另用 `require('./package-lock.json')` 从盘上直读复核）。
  - `git diff --name-only` = 13 项：**载体表的 12 个文件逐个在场** + `VERSION`（就是被临时改掉的输入本身）；**没有任何表外文件被碰**。
  - 盖完 `version-consistency-check.ts` exit 0（`All 15 carriers == resolveVersion(VERSION,'tracked') == 9.9.9-dev`）；`git checkout -- .` 还原后同命令仍 exit 0（`== 0.10.0-dev`），`git status --porcelain` 干净。
- [x] build 模式真实读数：在真实 `release/*` 临时分支上跑 `sync-vendor.sh` 的产物，其 `plugin/.claude-plugin/plugin.json` 与 `plugin/VERSION` 无 `-dev`；在 develop/author 上带 `-dev`。两个读数都贴进任务体。
  - **release 分支读数**（worktree on `release/ac4-reading2`，`VERSION = 0.10.0`，跑**真实 full 路径** `bash plugin/scripts/sync-vendor.sh`，exit 0）：
    - 前：`plugin/VERSION = 0.10.0-dev`、`plugin.json .version = 0.10.0-dev`
    - `STAMP-VERSION: mode=build root=…/plugin source=…/VERSION = 0.10.0 => every carrier must == 0.10.0` / `wrote 5 file(s), 5 carrier(s)`
    - 后：`plugin/VERSION = 0.10.0`、`plugin/.claude-plugin/plugin.json = 0.10.0`、`plugin/README.md = quay plugin v0.10.0`、`plugin/vendor/quay/package.json = 0.10.0`、`plugin/.claude-plugin/marketplace.json = 0.10.0` —— **无 `-dev`**。
  - **发布通道同款读数**：`bash plugin/scripts/publish-dist-branch.sh --no-build` exit 0，盖章落在装配树 `${WORK}` 上（`wrote 5 file(s)`），随后 dist-closure 门仍 OK（100 个被引用 bundle 全在），未 `--push`（什么都没发布）。
  - **develop/author 读数**（本任务 worktree，分支 `task/gap-version-stamp-generator-and-build-wiring`）：`node scripts/stamp-version.mjs --mode build --check --root plugin` ⇒ `STAMP-VERSION: OK — all 5 carriers == 0.10.0-dev`，exit 0；`plugin.json .version = 0.10.0-dev`、`plugin/VERSION = 0.10.0-dev` —— **带 `-dev`**。
  - 两次读数都是在**最终代码**上重测的（压紧接线之前先测过一次，压紧后重测，见 `实施记录 C`）。
- [x] `bash packages/quay/scripts/package.sh` 在版本载体被人为改乱时以 `stamp-version --check` 的报错失败；`grep -n "PKG_VERSION.*MKT_VERSION" packages/quay/scripts/package.sh` 无命中（旧手抄比对已删）。
  - 负控制：把 `plugin/VERSION` 改成 `9.9.9-dev` 后跑**真实** `package.sh` ⇒ exit 1，输出为
    `STAMP-VERSION: DRIFT — 1 of 15 carriers != 0.10.0-dev` / `plugin/VERSION  (plugin/VERSION): 9.9.9-dev -> 0.10.0-dev` / `ERROR: version carriers are out of sync with …/VERSION — refusing to pack.`
  - `grep -n "PKG_VERSION.*MKT_VERSION" packages/quay/scripts/package.sh` ⇒ 无命中（exit 1）。
  - 干净树上 `package.sh` exit 0，产出 `quay-0.10.0-dev.tgz`（dist-closure OK，100 个 bundle）。
- [x] `packages/quay/plugin/`（gitignored 的过期构建产物，实测停在 0.7.0）在 `package.sh` 或 `stamp-version --mode build` 的输出里被覆盖或被清除，之后 `cat packages/quay/plugin/VERSION` 不再是过期值。
  - 记录的条件在**主检出**实测存在：`/home/yale/work/quay/packages/quay/plugin/VERSION = 0.7.0`（mtime 2026-09-15，gitignored）。
  - 在本 worktree 复现同一过期态（`packages/quay/plugin/VERSION = 0.7.0`）后跑真实 `package.sh`：exit 0，`rm -rf ${PLUGIN_DEST}` + `cp -R plugin/.` 覆盖 ⇒ 之后 `packages/quay/plugin/VERSION = 0.10.0-dev`、`packages/quay/plugin/.claude-plugin/plugin.json .version = 0.10.0-dev`。

## DoD

真实走通一次「改 `VERSION` 一处 → 运行生成器 → 全部 15 处载体更新 → 检查器变绿」，并真实走通一次 release 分支上的 dist 构建产物无 `-dev`；证据是真实仓库上的命令输出，不是 fixture 自证。

**已做到**：AC3 是前者的真实仓库命令输出（15 条逐条在场、表外文件零触碰、检查器两次都绿）；AC4 是后者的真实读数，且是在 `release/*` 分支上跑**真实的** `sync-vendor.sh` full 路径得到的（不是直接手调生成器）。全部读数落在 `.quay/ac-stamp-version-evidence.txt`（含 AC1/AC2 读数与 AC2 的负控制）。

## Touches

- scripts/stamp-version.ts
- scripts/stamp-version.test.ts
- scripts/stamp-version.mjs
- scripts/version-carriers.ts
- scripts/version-consistency-check.ts
- scripts/version-consistency-check.test.ts
- packages/quay/scripts/package.sh
- plugin/scripts/sync-vendor.sh
- plugin/scripts/publish-dist-branch.sh
- plugin/scripts/checker-mutation-cases/version-consistency-check.sh
- .quay/ac-stamp-version-evidence.txt
- tasks/gap-version-stamp-generator-and-build-wiring.md
