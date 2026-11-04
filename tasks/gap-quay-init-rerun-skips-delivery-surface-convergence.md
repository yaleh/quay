---
id: gap-quay-init-rerun-skips-delivery-surface-convergence
title: quay init 在合法 config 上重跑只对账 config、不收敛交付面（Codex 三件套 + 4 条孤儿锁 gitignore
  规则到不了老项目）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`quay init` 在 **config 已合法** 的项目上只对账 `.quay/config.yml`，从不收敛交付面：`packages/quay/src/init.ts:2109` 的
`existing.state === "valid"` 分支在 `:2192` 直接 return，而闭集写入段（`:2330-2365`：`.codex/config.toml` /
`.agents/skills` / `AGENTS.md` / `ensureGitignore` / `.claude/settings.json` / `tasks/` / `goals/`）在 `:2211`
之后的 fresh/corrupt 路径里。⇒ `reconciled`（升级）与 `unchanged`（已最新）两条 outcome 都到不了落盘段。

实测（quay HEAD，`node --experimental-strip-types packages/quay/bin/quay.ts init --root <tmp>`）：
fresh 跑 `written/absent`，三件套全在；删掉三件套后再跑 `unchanged/valid`，三件套仍全部 ENOENT。

真实影响（quay-fleet，2026-11-04 读数）：
- Codex 三件套全缺；
- `.gitignore` 缺 manifest 的 4 条孤儿锁规则（`goals/*.lock` / `adr/*.lock` / `docs-managed/*.lock` /
  `meta/*.lock`）。这不是洁癖：`plugin/scripts/quay-runtime-artifacts.txt:66-71` 写明孤儿 lock 会让主检出变脏，
  `fan-in/ff-merge` 的 cleanTreeCheck 会拒绝**每个**任务的 ff。

既有项目上各项的实际后果不同（⛔ 不要按同一权重处置）：
- `.quay/profiles.yml` / `.claude/launch.settings.json` / `tasks/` / `goals/`：写入前有 existsSync 守卫
  ⇒ 既有项目上本来就是 no-op；
- `.claude/settings.json`：重新 read-modify-write，实测与 fresh 输出逐字节相同 ⇒ 无观测漂移；
- `.gitignore` 与 Codex 三件套：**有真实漂移**，是本任务的实际对象。

修法（只改重跑语义，不改 fresh 语义）：
1. 让 valid / reconciled 路径也走 create-if-absent 的交付面收敛（三件套 + `ensureGitignore`），
   **不覆盖**任何已存在文件；
2. 报告里给出本轮 `added: [...]`（补了什么要可观测，⛔ 静默补文件）；
3. 同步 `plugin/skills/init/SKILL.md`：其「Write surface（六文件闭集）」+「Nothing else is written」已过期
   —— `CLOSED_SET_ITEMS`（`packages/quay/src/init/delivery-surface.ts:220`）现为 10 项。加一条单源测试防再次漂移。

形状判别：这是「升级后新增的交付面到不了老项目」，与已修的
`gap-quay-init-sh-upgrade-leaves-version-level-loop-defaults-unfilled`（同一形状，当年只修了 config）同族。

## AC

- [ ] 合法 config + 缺少三件套的项目上重跑 `quay init` 后三者恢复（文件/目录类型断言）——`node --test packages/quay/test/init-rerun-convergence.test.mjs` exit 0。
- [ ] 合法 config + `.gitignore` 缺 manifest 条目的项目上重跑后，4 条锁规则各出现且**恰好 1 次**（`grep -cF 'goals/*.lock'` == 1，其余三条同）。
- [ ] 幂等负控制：对已是最新的项目重跑，报告 `added` 为空、`.quay/config.yml` 字节不变、`git status --porcelain` 无新增（证明不是「每次 init 都翻目录」）。
- [ ] 不覆盖负控制：预置自定义内容的 `AGENTS.md` 与 `.codex/config.toml`，重跑后逐字节不变。
- [ ] 单源守卫：一条测试读 `CLOSED_SET_ITEMS` 并对每一项断言它出现在 `plugin/skills/init/SKILL.md` 的写面清单里（少一项即红），使「Nothing else is written」这类过期说法不能再漂。
- [ ] 范围门绿：`bash scripts/test.sh --for-task gap-quay-init-rerun-skips-delivery-surface-convergence --allow-thin`。

## DoD

在「旧项目形态」的临时仓库（`.quay/config.yml` 合法、缺三件套与 4 条锁规则）上真跑一次 `quay init`（非单测替身），
贴：init 真实输出（含 `added` 清单）、`ls -la` 显示三件套、四条锁规则各 `grep -c` = 1 的读数；随后第二次重跑
`added` 为空且 `git status --porcelain` 干净。`--for-task` 范围门绿。仅 fixture 绿不算落地。

## Touches

- packages/quay/src/init.ts
- packages/quay/src/init/delivery-surface.ts
- packages/quay/test/init-rerun-convergence.test.mjs (new)
- plugin/skills/init/SKILL.md
- tasks/gap-quay-init-rerun-skips-delivery-surface-convergence.md