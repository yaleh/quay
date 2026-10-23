---
id: gap-release-branch-model-hardcoded-not-configurable
title: quay 交付物：发布线/release/hotfix 分支模型硬编码于
  quay（master/release-*/release/*）不可配置，被驱动项目无法声明并核验自己的发布分支模型
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

<!-- dedup-ref -->
本任务与 loop 侧分支模型已产品化的三条 done 任务同族但**机制不同**（发布侧，非 loop 侧）：`gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`（doc 分支去硬编码）、`gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`（merge target 去硬编码）、`gap-upgrade-entry-never-establishes-branch-model`（升级入口建立分支模型）。这三条管 landing baseline/doc 分支/默认分支；本任务管**发布线/release/hotfix 分支/tag/advance 推进**，该侧今天没有任何配置面。

**现状（实测）**：发布分支模型全部硬编码在 quay 仓库私有脚本，不在 `.quay/config.yml` schema 内。5 个脚本含 `master` 或 `release-*`/`release/*` 字面量：`release-cut.mjs`、`release-branch-finish.sh`、`release-branch-janitor.ts`、`release-reading-sandbox.ts`、`release-master-advance-needs-check.ts`；`release.yml` 的 `advance-master` job 硬编码 `master`；判据 AC-270..285 硬编码 `master`/`release-*` 语义。`packages/quay/src/core/branch-model.ts` 把默认分支（master 角色）显式建模为「quay has no release flow」——发布侧是被排除在既有模型之外的。

**后果（实测）**：第二个 quay 驱动项目 plantuml-js 无 master、无 release/*，发布走自有 `npm run release` 在 author 上 bump+commit+tag。它无法声明/核验「发布线不被直接提交、且停在最近一次全绿发布」这条不变量——其发布线（author）同时是直接提交面。quay 自己有此能力只因私有脚本，不是交付物能力。

**目标**：把发布分支模型做成可声明 + 可运行判据的交付物能力；收敛**不变量**（发布线本地可读、不被直接提交、停在最近一次全绿发布），不收敛机制（不强制 master/release/*/hotfix）。merge 决策：`task-granularity-advice.ts` peers=[]，单独立案。

## Plan

1. **config 单一来源**：`.quay/config.yml` 加 `release:` 节（`line`/`baseline`/`globs`/`tag_prefix`/`advance`），每个字段有命名消费者；`config.ts` 加类型、`config-validate.ts` 认新节、`init.ts` 模板写出默认值。
2. **泛化 5 个硬编码脚本**：`release-branch-finish.sh`/`release-branch-janitor.ts`/`release-reading-sandbox.ts` 的 `release-*`/`release/*` 枚举改读 `release.globs`；`release-master-advance-needs-check.ts` 的 `master` 改读 `release.line`；`release-cut.mjs` 的 dispatch/tag 前缀改读 `release.baseline`/`release.tag_prefix`。
3. **通用 meter**：新 `plugin/scripts/release-model-check.ts`，读 `release:` 节 + repo 状态，输出每条不变量 pass/fail/**not-evaluated**（「没配 release 节」与「查过且合格」必须可区分，硬规则 3b）。
4. **quay 自身 dogfood**：quay 的 `.quay/config.yml` 落 `release:` 节（line=master、globs=[release/*, release-*]、tag_prefix=v、advance=ci），5 脚本改读，meter 在 quay 主检出上给出真实读数。

**非目标**：不强制每个项目有 master/release/*/hotfix；不做进 core 的通用 release 框架；`advance: local` 模式与 `version_source` 泛化留作后续（需求发生率 0，硬规则 12）；plantuml-js 采用是对方项目自己的决定。

## AC

- [ ] config schema 含 `release:` 节且 `quay init` 模板写出默认值——`grep -n 'release' packages/quay/src/config.ts` 与 `grep -n 'release:' packages/quay/src/init.ts` 均非零命中
- [ ] 5 个 release 脚本的裸 `master`/`release-*`/`release/*` 字面量替换为 config 读取——`grep -cE 'release-\*|release/\*' plugin/scripts/release-branch-finish.sh plugin/scripts/release-branch-janitor.ts plugin/scripts/release-reading-sandbox.ts` 合计 0，`grep -c '"master"' plugin/scripts/release-master-advance-needs-check.ts` 为 0，且各脚本含读 `release:` config 的调用（位置判定）
- [ ] `plugin/scripts/release-model-check.ts` 对四态给出可区分输出——「无 release 节」「合格」「不合格」「无法评估」互不复用取值；负控制：tip 不在任何 tag 上的 fixture repo 报 fail、无 release 节的 repo 报 not-evaluated 而非 pass
- [ ] quay 自身 `.quay/config.yml` 落 `release:` 节，且 meter 在 quay 主检出上给出真实读数（生产载体，非 fixture，硬规则 4 推论三）
- [ ] 新脚本登记 capability-catalog——`plugin/scripts/capability-catalog-declarations.json` 增条目，`bash plugin/scripts/capability-catalog.sh` 自报声明数较落地前 +1

## DoD

真实落地：quay 主检出的 `.quay/config.yml` 携带 `release:` 节，`release-model-check.ts` 在主检出上给出真实读数（读生产载体，非 fixture）；5 个 release 脚本不再含裸 `master`/`release-*`/`release/*` 字面量。仅「测试存在」或「config 写好了但无脚本消费」不算。

## Touches

- packages/quay/src/config.ts
- packages/quay/src/config-validate.ts
- packages/quay/src/init.ts
- plugin/scripts/release-cut.mjs
- plugin/scripts/release-branch-finish.sh
- plugin/scripts/release-branch-janitor.ts
- plugin/scripts/release-reading-sandbox.ts
- plugin/scripts/release-master-advance-needs-check.ts
- plugin/scripts/release-model-check.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/release-model-check.test.mjs
- plugin/test/release-cut.test.mjs
- tasks/gap-release-branch-model-hardcoded-not-configurable.md
