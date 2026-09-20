---
id: gap-version-single-source-root-file-and-resolver
title: 版本号唯一来源——根 VERSION（git 跟踪）+ resolve-version
  解析函数，version-consistency-check 改判据为「载体 == 解析结果」
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯，同机制的前半：补检查器受检清单；本任务做后半：让版本号从单一来源派生）：gap-develop-version-union-missing-dev-suffix、gap-ac259-version-union-lockstep-and-host-install-readings、gap-ac169-readme-version-not-in-version-consistency-set。

**问题（直接量，2026-09-20）**：版本号字面量散落 15 处（`scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES` 11 条 + `package-lock.json` 4 条 workspace 版本），发布要手改两轮（release 分支去 `-dev`、合回后改 `X.(Y+1).Z-dev`）；靠检查器事后兜底，且已发生过漏数（SPEC §4.3 条数 9→10→14 三次更正；`6bf000622` 声称改全 8 处却漏 `plugin/VERSION`）。检查器只回答「载体互相一致吗」，不回答「载体等于唯一来源吗」，也回答不了「清单外还有没有载体」。

**人的裁定（2026-09-20，逐字）**：「版本号应有唯一来源，由 git 跟踪。可以在 build 过程中，监测分支并加后缀，如 -dev。」「a. 仍提交字面量，但写死为基础版本加 -dev，由生成器在改 VERSION 时一并更新。」「tag 提交不再自描述。」

**做法**：
1. 新增根文件 `VERSION`（git 跟踪），内容仅基础 semver `X.Y.Z`，无后缀、单行。落地时取 develop 当前载体的基础版本。
2. 新增 `scripts/resolve-version.ts`，导出 `resolveVersion(base, ctx)` 与 CLI（`--mode tracked|build [--json]`）。两个模式：`tracked`＝提交进 git 的字面量形态，恒为 `X.Y.Z-dev`；`build`＝构建产物形态：HEAD 恰在 tag `vX.Y.Z` 上、或当前分支名匹配 `release/*` ⇒ `X.Y.Z`，否则 `X.Y.Z-dev`；若 HEAD 上的 tag 名 ≠ `v`+VERSION ⇒ 抛错（fail-closed，硬规则 3b：不得返回与合格同形的值）。分支/tag 读取失败（如 detached HEAD 无 tag）⇒ 返回独立态 `evaluated:false`，不静默按 `-dev` 处理。
3. `scripts/version-consistency-check.ts` 改判据：每个载体（含清单内全部 11 条）== `resolveVersion(VERSION,'tracked')`；保留 all-or-none 断言；缺 VERSION 或格式非法 ⇒ 红。

## AC

- [ ] `test -f VERSION && grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+' VERSION`，exit 0（单行、无后缀）。
- [ ] `node --experimental-strip-types --test scripts/resolve-version.test.ts` exit 0，用例至少覆盖：tracked 恒 `-dev`；HEAD 在 `vX.Y.Z` tag 上 build 无后缀；分支 `release/v9.9.9` build 无后缀；develop/author 分支 build 带 `-dev`；tag 名≠`v`+VERSION 抛错；detached HEAD 且无 tag ⇒ `evaluated:false`（与 `-dev` 结果可区分）。
- [ ] `node --experimental-strip-types scripts/version-consistency-check.ts` 在落地后的真实仓库 HEAD 上 exit 0，且输出含「== resolveVersion(VERSION,'tracked')」形态的比对（打印前 3 条载体实际读数）。
- [ ] 负控制：临时把任一载体（如 `plugin/VERSION`）改成 `9.9.9-dev` 后同一命令 exit 1；还原后 exit 0。`bash plugin/scripts/checker-mutation-cases/version-consistency-check.sh` 更新为新判据后 exit 0。
- [ ] 反例判据（硬规则 4 推论三）：删除 `VERSION` 后 checker exit 非 0（证明它读生产载体，不是回声）。

## DoD

在真实仓库上，checker 以「载体 == 唯一来源」判据对真实 15 处载体中的 11 条清单项出绿、对人为漂移出红；并在一个临时 git 仓库里真实打 tag `v0.0.1` / 建 `release/v0.0.1` 分支，实测 `--mode build` 返回无后缀、普通分支返回 `-dev`（不是只靠 fixture 注入）。本任务只落「唯一来源 + 解析 + 判据」，不改任何载体的写入方式（生成器见后继任务）。

## Touches

- VERSION
- scripts/resolve-version.ts
- scripts/resolve-version.test.ts
- scripts/version-consistency-check.ts
- scripts/version-consistency-check.test.ts
- plugin/scripts/checker-mutation-cases/version-consistency-check.sh
- tasks/gap-version-single-source-root-file-and-resolver.md
