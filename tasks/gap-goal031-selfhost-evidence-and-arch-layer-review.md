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

- [x] `.quay/goal-031-evidence/selfhost-identity.json` 存在，`match === true` 且 `loadedFrom` 含子串 `goal-GOAL-031`
- [x] `.quay/goal-031-evidence/archguard-dispersion.json` 存在，`after.dispersion === 4` 且 `after.files` 不含 `plugin/scripts/goal-driver.ts`
- [x] `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `verdict.ok === true`
- [x] `.quay/goal-031-evidence/arch-layer-review-output.json` 存在，顶层恰好三个 key（`facts`/`declaredRules`/`judgment`），`judgment` 的每条结论都有非空 `evidence` 数组
- [x] 以上三份证据文件均已 `git add` 纳入本任务的提交（证据本身要进仓库，不是散落 .quay/ 的临时产物——若 `.quay/` 被 gitignore，改落盘到 `docs/evidence/goal-031/` 或等效的会被提交的路径，并同步更新本任务与 AC-344 criterion 里的路径引用）

## Definition of Done

三份证据文件落地且内容达标，`arch-layer-review` 真实跑过一次 before/after，AC-344 的判据能读到这些文件并判定为真（本任务不负责触发 AC-344 的最终判定时机，只负责让判据有真实证据可读）。

## Evidence

实施形态：worktree `/data/home/yale/work/quay-worktrees/gap-goal031-selfhost-evidence-and-arch-layer-review`（分支 `task/gap-goal031-selfhost-evidence-and-arch-layer-review`，从 `goal/GOAL-031` @ `08d7238a8` 开出；`dispatch-worktree-setup.sh --base goal/GOAL-031` 已 provision）。实现提交见本分支。

- **自举身份（AC1）**：`scripts/goal-031-selfhost-probe.mjs` 以子进程 cwd=被求值树，经 Node 自己的 ESM 解析（`import.meta.resolve`）＋真实 `import()` 读回 `plugin/scripts/goal-driver.ts` 的 realpath；被求值树 = GOAL-031 的 worktree（目录名带 `goal-GOAL-031` 标记，即 AC 标题/§验证步骤 4 点名的「本 goal 的 worktree」）。读数：`loadedFrom = /data/home/yale/work/quay-worktrees/goal-GOAL-031/plugin/scripts/goal-driver.ts`，`worktreeRoot` 同根，`match = true`，`loaded = true`。**负对照**（同一 specifier、cwd=主检出 `/data/home/yale/work/quay`）读出不同路径，故 `match` 是可证伪的读数而非常量；`alsoReadings` 另记本任务 worktree 的同一读法（其 loadedFrom 落在本任务 worktree 内）。
- **ArchGuard before/after（AC2）**：同一 archguard 构建的 `extractDiscriminatorTypes + detectDispersion`（源目录 `packages` + `plugin/scripts`，同 MCP `archguard_detect_shape_smells` 的 `expandSourceEntries`）。before = `git archive develop`（`a821d680e`）→ `dispersion = 5`（files 含 `plugin/scripts/goal-driver.ts`）；after = 本 worktree → `dispersion = 4`（goal-driver.ts 移出）。交叉核对 `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts`：before=6，after=1（唯一残量为 `goal-driver.ts:827` 的 GOAL-AC status 行，不同词表，有意保留）。
- **import-graph 棘轮（AC3）**：`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` → `verdict.ok = true`（valueSccs / typeSccs / reverseEdges = 0，kernelViolations = 0）。
- **arch-layer-review（AC4）**：真实 Skill 工具调用（`archguard:arch-layer-review`），三层物理分离。`declaredRules` = `check-layers.mjs` 原样输出的三态结果（`status = pass`，violations=0，drift=0，cycle-1 = cross-layer-declared；注意 quay 树内 `layers.yml` 仍是未提交 draft）。`judgment` 四条结论各带非空 `evidence`。
- **AC-344 判据自检**：在本 worktree 用 `quay goal show AC-344` 取出的 criterion 实跑一次 → `exit 0`（`PASS: ArchGuard dispersion after=4 with goal-driver.ts cleared, self-host identity proven inside the goal worktree, import-graph-check ratchet unregressed`）。最终判定时机由 goal 侧决定，本任务只保证证据可读且判据为真。
- **探针落点：为什么在仓库根的 `scripts/` 而不在 `plugin/scripts/`（本轮修复，原首发于 `plugin/scripts/`）**：探针是**开发期、goal 专属的一次性证据工具，没有运行时消费者**——AC-344 的判据只读已提交的快照 JSON，不跑这个文件。`plugin/` 是**发布树**（`publish-dist-branch.sh` rsync 它、且只删原始 `.ts`，不删 `.mjs`），所以放在 `plugin/scripts/` 的 `.mjs` 会**随产物发到每个用户的安装里**：实测它把产物的文件数由 264 顶到 265，`plugin/test/shipped-set.test.mjs` 因此红 3 例（`the artifact's totals must be ≤ the recorded clean build: measured {"files":265,...} vs {"files":264,...}`）。这正是 GOAL-029「开发期内容混进产物」那一类，也是 `plugin/shipped-set-baseline.json` 的体积上限本来要抓的东西 ⇒ **它抓对了，正确反应是不发它**，而不是抬上限。**负对照（同一测试、同一棵树，只去掉这个文件）**：`shipped-set: artifact 264 files … 0 forbidden`，10/10 通过。修法 = 移到仓库根 `scripts/goal-031-selfhost-probe.mjs`，与姊妹自举探针同址（`scripts/branch-selfhost-probe.mjs`，任务 `gap-goal030-branch-selfhost-probe`），不进发布树。**技术不受落点影响**：读数由 cwd=被求值树的**子进程**取，本文件自己在哪里不进入读数；移动后重跑探针，`selfhost-identity.json` **逐字节相同**，AC-344 判据仍 `exit 0`。
- **新脚本登记随之撤销**：落点在 `plugin/scripts/` 时才有的 AC1c 入口闸义务（`capability-catalog-declarations.json` 登记）随文件移出而消失，已把本轮分支对该文件的改动退回 `develop` 版本：`bash plugin/scripts/capability-catalog.sh` ⇒ `371 scripts | 371 declared | 0 unclassified | 366 ship`（exit 0，与 develop 一致）。
- **Touches 增列两条（反漂移的判集是「本任务自己的提交」，不是净 diff）**：机械 fan-in 的 anti-drift 两行基线取 `git log --name-only HEAD --not goal/GOAL-031 develop`——本任务**自己的提交所触达文件的并集**。本分支有两条中间提交曾把探针首发在 `plugin/scripts/`、并为其登记 CONSUMER；随后 `e185fbc00` 把它移到 `scripts/` 并把登记退回 develop ⇒ 这两个路径的**净变化为零**，但仍落在上述并集里 ⇒ 不声明即 anti-drift HARD FAIL（实测两条 `out-of-declared`：`plugin/scripts/capability-catalog-declarations.json`、`plugin/scripts/goal-031-selfhost-probe.mjs`）。声明它们不是放宽闸门——声明的正是「本任务确实写过的文件」，与判据的判集一致；判据本身未改动。

## Touches

- .quay/goal-031-evidence/selfhost-identity.json (new)
- .quay/goal-031-evidence/archguard-dispersion.json (new)
- .quay/goal-031-evidence/arch-layer-review-output.json (new)
- scripts/goal-031-selfhost-probe.mjs (new)
- plugin/scripts/goal-031-selfhost-probe.mjs (removed: probe first added here, then relocated to scripts/)
- plugin/scripts/capability-catalog-declarations.json (reverted: CONSUMER row added then withdrawn with the move)
- tasks/gap-goal031-selfhost-evidence-and-arch-layer-review.md
