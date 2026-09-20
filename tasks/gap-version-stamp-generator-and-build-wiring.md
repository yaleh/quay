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

## AC

- [ ] `node --experimental-strip-types --test scripts/stamp-version.test.ts` exit 0：改 fixture 的 `VERSION` 后 `stamp-version` 一次调用使全部载体（含 package-lock 4 条）== `X.Y.Z-dev`，随后 `version-consistency-check.ts` exit 0；`--check` 对被人为改乱的载体 exit 1 并列出该文件。
- [ ] 载体表单一：`grep -rn "packages/quay-backlog/package.json" scripts/*.ts | grep -v "\.test\."` 只在一个模块里出现（打印前 3 条命中，人工核对不是注释误命中；并把谓词对已知为真的样本干跑一次）。
- [ ] 真实对象：在真实仓库把 `VERSION` 改成 `9.9.9`（临时），运行 `node --experimental-strip-types scripts/stamp-version.ts` 后 `git diff --name-only` 列出的文件集合 == 载体表全集（15 处逐个在场，报条数与清单），`version-consistency-check.ts` exit 0；`git checkout -- .` 还原后同命令仍 exit 0。
- [ ] build 模式真实读数：在真实 `release/*` 临时分支上跑 `sync-vendor.sh` 的产物，其 `plugin/.claude-plugin/plugin.json` 与 `plugin/VERSION` 无 `-dev`；在 develop/author 上带 `-dev`。两个读数都贴进任务体。
- [ ] `bash packages/quay/scripts/package.sh` 在版本载体被人为改乱时以 `stamp-version --check` 的报错失败；`grep -n "PKG_VERSION.*MKT_VERSION" packages/quay/scripts/package.sh` 无命中（旧手抄比对已删）。
- [ ] `packages/quay/plugin/`（gitignored 的过期构建产物，实测停在 0.7.0）在 `package.sh` 或 `stamp-version --mode build` 的输出里被覆盖或被清除，之后 `cat packages/quay/plugin/VERSION` 不再是过期值。

## DoD

真实走通一次「改 `VERSION` 一处 → 运行生成器 → 全部 15 处载体更新 → 检查器变绿」，并真实走通一次 release 分支上的 dist 构建产物无 `-dev`；证据是真实仓库上的命令输出，不是 fixture 自证。

## Touches

- scripts/stamp-version.ts
- scripts/stamp-version.test.ts
- scripts/version-consistency-check.ts
- scripts/version-consistency-check.test.ts
- packages/quay/scripts/package.sh
- plugin/scripts/sync-vendor.sh
- plugin/scripts/publish-dist-branch.sh
- tasks/gap-version-stamp-generator-and-build-wiring.md
