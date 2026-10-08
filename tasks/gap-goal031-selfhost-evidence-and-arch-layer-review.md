---
id: gap-goal031-selfhost-evidence-and-arch-layer-review
title: GOAL-031 ②：分支自举身份证明 + ArchGuard before/after 证据 + arch-layer-review 三层输出
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal031-needs-human-literal-migration
goal_ac: AC-344
---
**type:** execution

## Proposal

GOAL-031 的第二块：在 `gap-goal031-needs-human-literal-migration` 落地之后（依赖它，串行），在本 goal 的分支/worktree 上产出 AC-344 所需的三份证据，并用已验证可真实调用的 `archguard:arch-layer-review` skill 跑一次 before/after。

**⛔ 不复用 `scripts/branch-selfhost-probe.mjs`**——该脚本只存在于尚未合并的 `goal/GOAL-030` 分支，`develop`/`goal/GOAL-031` 上都没有，依赖它会违反 GOAL-031「不依赖 goal/GOAL-030 未并入产物」的红线。本任务复用它验证过的**技术**（校验被加载模块的 realpath 落在本 goal 的 worktree 内），自己写一个规模相应缩小的身份校验。

## Plan

1. **自举身份证据**（`.quay/goal-031-evidence/selfhost-identity.json`）：在本任务的 worktree 内，写一小段探针——动态 `import()` 或直接 `require.resolve`/`fileURLToPath(import.meta.url)` 读取 `plugin/scripts/goal-driver.ts`（或其编译产物，若走 dist）被加载时的 realpath，与当前 worktree 根目录比较，落盘 `{loadedFrom: <realpath>, worktreeRoot: <realpath>, match: <boolean>}`。`loadedFrom` 必须包含子串 `goal-GOAL-031`（worktree 目录命名约定）。
2. **ArchGuard before/after 证据**（`.quay/goal-031-evidence/archguard-dispersion.json`）：
   - before：对 `develop` 当前检出跑 `archguard_get_literal_dispersion(value:"needs-human")`（或对应 CLI/MCP 路径），记录 `{dispersion, files}`。
   - after：对本 worktree（已含 Task A 的改动）跑同一查询，记录 `{dispersion, files}`。
   - 落盘为 `{before: {...}, after: {...}}`。
   - 同时用 `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 在 before/after 各跑一次，交叉核对（before=6, after=1）。
3. **import-graph-check 棘轮**：跑 `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`，确认 `verdict.ok === true`（AC-344 的 criterion 会独立重跑这一步，这里是先行自检）。
4. **arch-layer-review 三层输出**（真实 Skill 工具调用，不是手动读 SKILL.md）：对 before（develop）/after（本 worktree）做一次 before/after change-review，产出 `facts`/`declaredRules`/`judgment` 三层 JSON，归档到 `.quay/goal-031-evidence/arch-layer-review-output.json`。这是证据/归档用途，advisory，不是 gate——不要求它本身"通过"，只要求产出且三层物理分离、judgment 的每条结论都带非空 evidence。

## Acceptance Criteria

- [ ] `.quay/goal-031-evidence/selfhost-identity.json` 存在，`match === true` 且 `loadedFrom` 含子串 `goal-GOAL-031`
- [ ] `.quay/goal-031-evidence/archguard-dispersion.json` 存在，`after.dispersion === 4` 且 `after.files` 不含 `plugin/scripts/goal-driver.ts`
- [ ] `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `verdict.ok === true`
- [ ] `.quay/goal-031-evidence/arch-layer-review-output.json` 存在，顶层恰好三个 key（`facts`/`declaredRules`/`judgment`），`judgment` 的每条结论都有非空 `evidence` 数组
- [ ] 以上三份证据文件均已 `git add` 纳入本任务的提交（证据本身要进仓库，不是散落 .quay/ 的临时产物——若 `.quay/` 被 gitignore，改落盘到 `docs/evidence/goal-031/` 或等效的会被提交的路径，并同步更新本任务与 AC-344 criterion 里的路径引用）

## Definition of Done

三份证据文件落地且内容达标，`arch-layer-review` 真实跑过一次 before/after，AC-344 的判据能读到这些文件并判定为真（本任务不负责触发 AC-344 的最终判定时机，只负责让判据有真实证据可读）。

## Touches

- .quay/goal-031-evidence/selfhost-identity.json (new)
- .quay/goal-031-evidence/archguard-dispersion.json (new)
- .quay/goal-031-evidence/arch-layer-review-output.json (new)
- plugin/scripts/goal-031-selfhost-probe.mjs (new)
- tasks/gap-goal031-selfhost-evidence-and-arch-layer-review.md
