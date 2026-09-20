---
id: gap-version-marketplace-omit-and-spec-amendment
title: marketplace.json 省略 version 字段的真实安装实测 + 修订 SPEC §4.3/发布流程（去掉「去 -dev 的 bump 提交」）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-version-stamp-generator-and-build-wiring
---
## Proposal

前置：`gap-version-stamp-generator-and-build-wiring`（生成器与 build 模式盖章已落地）。

**问题**：① 根 `.claude-plugin/marketplace.json` 的 `plugins[].version` 由 Claude Code 直接从 git 读、没有构建步骤可盖章，仍是一处必须手写的提交字面量；它是否可以整个省略、改由 `plugin.json` 的 version 决定，**没有被实测过**（SPEC §4.3 只实测过「接受 `-dev` 后缀」，§10 残留 1）。② `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.3 的落实口径、§4.1 的 release 规程、§9 迁移表仍写「release 分支上一个提交去 `-dev`、合回后 bump 到下一个 `-dev`」，与新机制（单一来源 + build 模式解析）不符。

**人的裁定（2026-09-20，逐字）**：「版本号应有唯一来源，由 git 跟踪。可以在 build 过程中，监测分支并加后缀，如 -dev。」「tag 提交不再自描述。」——此处即对 SPEC §4.3「选项 ii」（2026-09-15 人裁定：`-dev` 后缀）的落实机制修订：`-dev` 语义不变，变的是「谁写后缀」。

**做法**：
1. 实测：隔离的 `CLAUDE_CONFIG_DIR` 下，用「根 marketplace.json 的 quay 条目不含 `version`」的构建，真实 `claude plugin marketplace add` + `claude plugin install quay@quay -s user --json`，回读 `claude plugin list --json` 的 `version` 与 `installPath`（缓存目录键）。读数写入任务体。
2. 若实测通过：从两个 `marketplace.json`（根与 `plugin/.claude-plugin/`）删除 quay 条目的 `version`，并从 `stamp-version`/`version-consistency-check` 的载体表移除这两条；若实测不通过：保持字段，记录读数与失败形态，本任务只做第 3 步并把该字段留在载体表（这是一个可取假的分支，不许因为「方案里写了要删」就删）。
3. 修订 SPEC：§4.3 落实口径、§4.1 release 规程、§9 迁移表第 3 行与 §10 残留 1，改为「`VERSION` 单一来源 + `resolveVersion` build 模式 + 生成器」，明确 tag 提交的提交载体为 `X.Y.Z-dev`（不自描述）、发布产物版本由 build 模式决定；`release-branch-finish.sh` 不再要求存在「去 -dev 的 bump 提交」（如其判据依赖该提交，同步改并留测试）。

## AC

- [ ] 隔离 `CLAUDE_CONFIG_DIR` 的真实安装读数已写入任务体：`claude plugin install quay@quay -s user --json` 的 outcome、`claude plugin list --json` 的 `version` 与 `installPath`（含省略 `version` 与保留 `version` 两组对照，硬规则 4 推论四：给出「若假设为假则读数不同」的对照）。
- [ ] 按实测结论：通过 ⇒ `grep -c '"version"' .claude-plugin/marketplace.json` 中 quay 条目无 version（用 `node -p` 读 `plugins[0].version === undefined` 为 true），且 `node --experimental-strip-types scripts/version-consistency-check.ts` exit 0；不通过 ⇒ 任务体记录失败读数，字段保留，checker 仍 exit 0。
- [ ] `grep -n "去 -dev\|去后缀\|-dev.*bump\|bump.*-dev" orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` 的每个命中（打印命中条数与前 3 条）都已改写或明确标注为历史记录；SPEC 新增一节记录本次修订、人的逐字裁定与日期。
- [ ] `bash plugin/scripts/release-branch-finish.sh --help` 与其测试在不含「去 -dev bump 提交」的 release 分支上 exit 0（若该脚本原判据依赖该提交）；相关测试 `scripts/test.sh --for-task gap-version-marketplace-omit-and-spec-amendment` exit 0。

## DoD

真实安装读数决定了 marketplace 字段的去留，且 SPEC 与实现一致：从 `VERSION` 改一处开始，走完「develop 常态 -dev → release 分支/tag 产物无后缀 → 合回后仅改 VERSION 一行」整条发布链，无人工去后缀提交。证据是真实安装与真实分支上的读数，不是 fixture。

## Touches

- .claude-plugin/marketplace.json
- plugin/.claude-plugin/marketplace.json
- scripts/stamp-version.ts
- scripts/version-consistency-check.ts
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- plugin/scripts/release-branch-finish.sh
- tasks/gap-version-marketplace-omit-and-spec-amendment.md
