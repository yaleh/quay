---
id: gap-ac168-quay-init-contract-closed-set
title: AC168 判据仍红——SPEC §6 缺 QUAY-INIT-CLOSED-SET 标记块；补块并钉死 CLI quay init laydown ⊆ 闭集
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-168
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-168-quay-init-contract-closed-set.md`（status=active、goal=GOAL-003）判据现为 fail（`evidence.verdict=fail`、exit 1）。根因：判据从 `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 抽取 `QUAY-INIT-CLOSED-SET:BEGIN/END` 标记块做对照，而该块在 SPEC §6 尚不存在（`grep -rn QUAY-INIT-CLOSED-SET` 全仓仅命中 AC-168 记录自身的 criterion）⇒ `allowed` 为空 ⇒ `[ -n "$allowed" ] || exit 1` 当场判假。**这不是 laydown 超标，是判据的对照面缺失。**

**判定面（判据唯一测的对象）**：`node packages/quay/bin/quay.ts init --root <tmp>` 是 CLI `quay init`（product 表面，DIR-098），不是 `/quay:init` skill。当前 CLI laydown（`packages/quay/src/init.ts` `runInit`）= {`.quay/config.yml`、`.quay/profiles.yml`、`.claude/launch.settings.json`} + 空 `tasks/`——三文件，天然不含 §6 禁写的扩展/脚本（`.claude/workflows/`、`.claude/agents/`、`plugin/scripts/` 副本、`orchestration/` tick 文档、`docs/analysis/`）。故本任务主工作量 = 补闭集块 + 钉死契约测试，不是大改 laydown。

**两个须有意识的调和点（⛔ 不得手滑或游戏判据）**：① `.claude/launch.settings.json` 是 AC154（profile 抽层）承重产物（cold-start bypassPermissions），§6 闭集清单未列它——必须进块，否则判据红且 AC154 回归；② §6 列的 `.gitignore`、`.claude/settings.json` 当前 CLI 不产——判据单向 `produced ⊆ allowed`（`comm -23`），不产不判红，块应忠实反映 §6 契约。**块内不得夹 `- ` 前缀的非路径行**（BEGIN/END 之间无 code fence、无嵌套列表），否则 `sed -n 's/^- //p'` 会把 fence 行当 allowed 成员抽出。

**正本**：`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §6。**前置已就绪**：`gap-plugin-root-resolution-non-skill-entrypoints`（§6b，已实现并回填）。

## Plan

1. **补闭集块**：SPEC §6 加 `QUAY-INIT-CLOSED-SET:BEGIN` / `QUAY-INIT-CLOSED-SET:END` 两标记行，之间以列 0 `- <path>` 逐行列允许产物——至少 `.quay/config.yml`、`.quay/profiles.yml`、`tasks/`、`.claude/launch.settings.json`（AC154），并按 §6 契约补 `.gitignore`、`.claude/settings.json`。
2. **核对 laydown ⊆ 块**：实跑 `node packages/quay/bin/quay.ts init --root $(mktemp -d)` 后 `find . -type f`，确认产物集是块子集（当前三文件，预期已满足；不加产 `.gitignore`/`.claude/settings.json`，避免与 AC161/AC162 的 enabledPlugins 语义交叉）。
3. **钉死契约测试**：`packages/quay/test/init.test.mjs` 加一条「CLI laydown ⊆ SPEC §6 闭集」测试——真实 `quay init --root <tmp>`、`find . -type f`、抽 SPEC 块做 `comm -23` 断言为空；负控制：临时删块一条 ⇒ 该测试红（贴实跑输出，证明能取假）。
4. **验证**：AC-168 criterion 逐字 exit 0；`node --test packages/quay/test/init.test.mjs` 绿；schema check exit 0。

## AC

- [x] AC1（AC-168 criterion 逐字 exit 0）：`tmp=$(mktemp -d); node --experimental-strip-types packages/quay/bin/quay.ts init --root "$tmp" >/dev/null 2>&1 || { rm -rf "$tmp"; exit 1; }; produced=$(cd "$tmp" && find . -type f | sed 's|^\./||' | sort); rm -rf "$tmp"; allowed=$(sed -n '/QUAY-INIT-CLOSED-SET:BEGIN/,/QUAY-INIT-CLOSED-SET:END/p' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md | sed -n 's/^- //p' | sort); [ -n "$allowed" ] || exit 1; comm -23 <(printf '%s\n' "$produced") <(printf '%s\n' "$allowed") | grep -q . && exit 1; exit 0`
- [x] AC2（块存在且非空）：`sed -n '/QUAY-INIT-CLOSED-SET:BEGIN/,/QUAY-INIT-CLOSED-SET:END/p' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md | sed -n 's/^- //p' | grep -c '^\.'` ≥ 3 且退出 0
- [x] AC3（三承重产物在块内）：闭集块抽取结果含 `.quay/config.yml`、`.quay/profiles.yml`、`.claude/launch.settings.json` 三条（`grep -c` 各 == 1）
- [x] AC4（契约测试能取假）：`packages/quay/test/init.test.mjs` 新测试实跑 exit 0；负控制——临时从块删 `.quay/config.yml` 后该测试红（贴出两段实跑输出）
- [x] AC5（CLI init 测试绿）：`node --test packages/quay/test/init.test.mjs` exit 0
- [x] AC6（schema）：`node plugin/scripts/task-schema-check.ts tasks/gap-ac168-quay-init-contract-closed-set.md` exit 0

## DoD

`goals/AC-168-quay-init-contract-closed-set.md` criterion exit 0（SPEC §6 有非空 QUAY-INIT-CLOSED-SET 块 ∧ 一次真实 `quay init --root <repo 外 tmp>` 产物清单 ⊆ 块），goal-driver 下一轮 verdict 由 fail 转 pass（读 `.quay/goal-round.jsonl` 中 AC-168 的 verdict）；`packages/quay/test/init.test.mjs` 含能取假的闭集契约测试且绿。⛔ 只补块不跑真实 laydown / 块内夹 code fence 或非路径 `- ` 行使 allowed 抽出错误成员 / 契约测试恒真（删条仍绿）⇒ 不算达成。

## Touches

- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- packages/quay/test/init.test.mjs
- tasks/gap-ac168-quay-init-contract-closed-set.md