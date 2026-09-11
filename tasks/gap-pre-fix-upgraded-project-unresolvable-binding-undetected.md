---
id: gap-pre-fix-upgraded-project-unresolvable-binding-undetected
title: 按旧语义升级过的项目停在绑定不到的裸 `quay-native` 上，且没有任何检查会发现——只能靠人想起来重跑 quay-init
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Finding

2026-09-11 实测（orangevps，外部可核）。`gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated`
（status: done）修掉的是**机制**：`quay-init` 从此会把既有项目的裸 PATH 形式 `mcp_entry` 迁成指向本次
交付物的绝对路径。修复落地于 commit `ba960f503`（2026-09-11T04:40Z）。

**本条的残留不在那条任务的范围内**：那条修复只对**修复之后跑的升级**生效。在它之前升级过的项目，
config 停在 `mcp_entry: [quay-native, mcp]` 这个裸 PATH 名上——没有任何路径把 `quay-native` 放进
`$PATH` ⇒ **项目自己的 runtime 读不出自己的任务板**，且**没有任何检查会报出来**。

两个独立现场（不是单次偶然），实测命令与真实输出：

```
$ ssh orangevps 'bash -lc "command -v quay-native" || echo "(not on PATH)"'
(not on PATH)

$ ssh orangevps 'cd /home/yale/quay-verify-upgrade-9eda8c70-root && \
    node --no-warnings .quay/runtime/bin/quay.js task list --root . --json'
Error: spawn quay-native ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:285:19)

$ ssh orangevps 'sed -n "1,7p" /home/yale/quay-verify-upgrade-9eda8c70-root/.quay/config.yml'
providers:
  native:
    enabled: true
    path: .
    mcp_entry:
    - quay-native
    - mcp
```

第二现场 `/home/yale/quay-verify-upgrade-1c202737-root`（同一形态、独立一次升级、独立时间戳）
逐字复现同一结果 ⇒ 是形态不是偶然。两处 `providers.native.path` 仍是 `.`，`mcp_entry` 仍是裸名。

**为什么它至今没被发现（这是本条的核）**：读「升级后项目能不能读自己的盘」的那条检查
（`plugin/scripts/verify-deliver-coldstart.sh` 的 `step_upgrade_existing` ⑥）当时是用
`PATH="$PREFIX/bin:$PATH" node "$rtbin/quay.js" task list …` 跑的——**外部 PATH 辅助把它盖住了**。
辅助一撤，ENOENT 立刻现形。⇒ 该读数在旧写法下**结构上取不到假**（恒绿的辅助），而 AC-238 的四件读数
照常全成立、记录照常写出：**「升级成功」与「升级后项目不可用」在那套读数下同形**。

**自愈路径存在，但只能靠人想起来**：对该项目再跑一次 `quay-init`（ba960f503 之后的版本）即可迁移。
⇒ 缺的不是修法，是**发现**：没有任何检查、告警或登记会把「这个项目处于修复前的绑定形态」讲出来。

（同轮已实测的另一半：`verify-deliver-coldstart.sh` 的 AC-238 步骤本身在 `ba960f503` 之后也失效了——
它 `cp -f` 覆盖 project-local `.quay/runtime/bin/quay.js`，而那正是 quay-init 现在要退休的路径。
那一半已在 `gap-aged-project-post-upgrade-driver-e2e` 里修掉（该步骤的读数改为按当前语义取三方向：
退休备份逐字等于升级前那份 ∧ live 路径不再有 `.quay/runtime` ∧ 项目此刻绑定到的 bundle 逐字等于本次
交付物），⛔ 不在本任务范围内。）

## Ruling and landed mechanism

**裁定（AC1 选项 ①）：加一个机械检查** —— 新增 `plugin/scripts/provider-binding-resolvability-check.ts`。
「缺的不是修法，是发现」⇒ 补的正是发现。

为什么不是 ② / ③：② 只在有人**当场跑**该项目时才说话，且要改所有项目的启动行为——本条要的是
「项目静置时也能被问出来」，不是在用的一瞬间报错；③ 要人裁定，worker 层级做不了，且把机制缺口留在原地。

**判据按形态，不按「在本机解析得开」**——这是本条的关键：产品自己的
`packages/quay/src/config-validate.ts:648` 的 `isPathBinary` 正是这个盲点的**产品形态**
（token 在本进程 `$PATH` 上解析得开就报合格）。本检查**刻意不查 `$PATH`**：无路径分隔符的 token
只能由外部 `$PATH`（或 cwd）满足 ⇒ 它**不是绑定**，恒红，与「本机恰好解析得开」无关。
带分隔符的 token 按**产品自己的口径**解析（`cli/shared.ts:175` 的 `<workspaceRoot>/<provider.path>` 为
cwd，⛔ 不是 workspace root——否则本仓库自己的 `./bin/quay-native.ts` 会被误报）。

三态可区分（⛔ 不与合格同形）：`path-resolved`（合格）·`bare-path-name`/`dangling-absolute`/`dangling-relative`（红）·
`no-mcp-entry`/`unrecognized-shape`（NOT-EVALUATED，exit 3）。

### AC2 · 判据能取假——两侧真实读数

**不合格侧（两个真实现场，orangevps 上实跑，无任何 `$PATH` 辅助）**：

```
$ node --no-warnings --experimental-strip-types \
    .tmp-provider-binding-check/provider-binding-resolvability-check.ts \
    --root /home/yale/quay-verify-upgrade-9eda8c70-root
provider binding resolvability — /home/yale/quay-verify-upgrade-9eda8c70-root/.quay/config.yml
  [RED           ] native: bare-path-name  token="quay-native"
FAIL: provider-binding-resolvability-check: 1 provider binding(s) do not resolve without $PATH
      assistance (native=bare-path-name) — re-run quay-init on this project to migrate the binding
exit=1

$ … --root /home/yale/quay-verify-upgrade-1c202737-root
provider binding resolvability — /home/yale/quay-verify-upgrade-1c202737-root/.quay/config.yml
  [RED           ] native: bare-path-name  token="quay-native"
exit=1
```

**合格侧（同一条检查，已迁移项目）** —— 以现场 `9eda8c70` 的 config **逐字副本**为输入
（sha256 双侧核对：本地与远端同为 `80c7ab9de40991a780de530e7c6c97645471788e8c56a4c48520da498104e55e`），
跑**本次交付物自带的真实 `quay-init`**：

```
$ CLAUDE_PLUGIN_ROOT=<wt>/plugin bash <wt>/plugin/scripts/quay-init.sh --root <copy> --auto-commit-skip
  migrated: mcp_entry bare PATH reference 'quay-native' (resolved by whatever $PATH happens to hold)
            -> <wt>/plugin/vendor/quay-native/dist/quay-native.js (upgrade-channel runtime migration — AC1/AC2)

$ node --no-warnings --experimental-strip-types …/provider-binding-resolvability-check.ts --root <copy>
provider binding resolvability — <copy>/.quay/config.yml
  [ok            ] native: path-resolved  token="…/plugin/vendor/quay-native/dist/quay-native.js" -> (exists)
PASS: provider-binding-resolvability-check: 1 provider binding(s) name their runtime by a
      resolvable path (no $PATH assistance required)
exit=0
```

⇒ 同一条检查，两个现场 `exit=1`、已迁移项目 `exit=0`，**两种取值可区分**。

### DoD · 不依赖 `$PATH` 辅助的读数

迁移后的项目在 `PATH` 只含 node、**不含 `quay-native`** 的环境下读出了自己的任务板：

```
$ PATH=<nodedir>:/usr/bin:/bin node <wt>/packages/quay/bin/quay.ts task list --root <copy> --json
EXIT=0
OUT: [ { "id": "DIR-001", "title": "demo task", "status": "todo", … } ]
```

同一条命令对**未迁移**的现场副本给出 Finding 里那条 ENOENT（负控制）：

```
$ PATH=<nodedir>:/usr/bin:/bin node <wt>/packages/quay/bin/quay.ts task list --root <site-as-is> --json
Error: spawn quay-native ENOENT
```

### AC3 · 测试在修复被 revert 之后必须失败（真实跑过）

把检查器的裸名分支改成 `row.state = "path-resolved"`（模拟修复前的盲：「裸名没关系，`$PATH` 会解析」）
后重跑单测：

```
✖ bare-path binding is RED and is classified by FORM, never by $PATH resolution
✖ CLI exits 1 on the legacy bare-PATH site form and 0 on the migrated form
✖ CLI accepts --json and emits a machine-readable report
ℹ fail 3
```

恢复后 `ℹ pass 13 / ℹ fail 0`（`diff -q` 核对逐字还原）。同一 revert 下 mutation case 报
`STAYED-GREEN`（exit 3）；恢复后 exit 0 ⇒ **mutation case 本身也能被 revert 检出**（硬规则 4）。

### AC4 · 复现命令与真实输出

已落进本记录：Finding 的三条 ssh 实录（升级现场自身的 ENOENT 与 config 形态）＋ AC2 两侧读数
＋ 上节两条 `task list` 前后对照。

### 两个存量现场的处理（DoD）

| 现场 | 绑定形态 | config sha256 | 处置 |
|---|---|---|---|
| `/home/yale/quay-verify-upgrade-9eda8c70-root` | `path: .` + `mcp_entry: [quay-native, mcp]` | `80c7ab9de40991a780de530e7c6c97645471788e8c56a4c48520da498104e55e` | 登记（不就地修） |
| `/home/yale/quay-verify-upgrade-1c202737-root` | 同上 | `790d157d1fc9a823f64d659d9f7623023fd7f34a52fc2b487f364fec3401c725` | 登记（不就地修） |

**为什么不就地修**：① 它们是本条唯一的**负控制现场**——AC2 要求它们给出「不合格」，就地修完就给不出了；
② 它们是 `gap-aged-project-post-upgrade-driver-e2e` 要用的取证现场，不是生产项目。
**自愈路径已在逐字副本上验证**（上方 AC2 合格侧），动作 = 对任一现场重跑 `quay-init`
（会打印 `migrated: mcp_entry bare PATH reference …`）。⇒ 显式处理、不留悬空。

### 机制登记

- 检查器：`plugin/scripts/provider-binding-resolvability-check.ts`（新；exit 0/1/2/3；`--json`）
- 接线：`plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`（`@static-tier change`，
  `@static-object .quay/config.yml`）——`.quay/config.yml` 被改时 scoped 门会跑到它
- 负控制：`plugin/scripts/checker-mutation-cases/provider-binding-resolvability-check.sh`，
  含 **`$PATH` shim 反例**（给裸名在 `$PATH` 上造一个可执行 `quay-native`，检查器**仍须红**）——
  这一支正对着 `isPathBinary` 那个盲点
- 单测：`plugin/test/provider-binding-resolvability-check.test.mjs`
- 能力目录：`capability-catalog.sh` 五字段已登记（`--summary`：305 scripts / 0 unclassified）
- **交付验证（本条 Finding 的「核」）**：`verify-deliver-coldstart.sh` 的 `step_upgrade_existing` 新增
  `binding_state()` 读数——**刻意不注入任何 `$PATH` 辅助**，升级前取一次（存量读数）、升级后取一次
  （并入 AC-238 判定的**新门** `post_binding = path-resolved`）。旧读数带 `PATH="$PREFIX/bin:$PATH"`
  辅助时结构上取不到假（硬规则 4），新读数把「升级成功」与「升级后项目不可用」重新拆成两种取值。
- 未改动 `plugin/scripts/quay-init.sh`（迁移机制已由 `ba960f503` 落地，本条补的是发现），
  ⇒ 已把它从 `## Touches` 移出。

## Acceptance Criteria

- [x] 明确裁定这一存量怎么处理，并落地其中一条（三选一，⛔ 不得沉默）：① 加一个机械检查——读项目的
      `mcp_entry` 并判它**不借助外部 PATH 辅助**能否解析，不能则报出（可区分取值，⛔ 不与「解析成功」同形）；
      ② 产品侧在启动/读取路径上对裸 PATH 名做一次解析失败的可区分报错（fail-closed）；
      ③ 人裁定历史现场不修，只作已知存量登记——登记里必须逐个列出上引两个现场路径与其绑定形态。
      〔裁定 = ①，见上「Ruling and landed mechanism」；③ 的历史现场登记也一并做了（见「两个存量现场的处理」）。〕
- [x] 若选 ①/②：该判据必须**能取假**——对一个已迁移（绝对路径绑定）的项目跑同一条检查必须给出「合格」，
      对上面两个现场必须给出「不合格」，两种取值可区分，并且真实跑过这两侧（贴上两条真实输出）。
      〔见「AC2 · 判据能取假」：两个现场 exit=1、逐字副本迁移后 exit=0，四条真实输出已贴。〕
- [x] 若选 ①/②：新增/修改的测试在**把修复 revert 之后必须失败**（否则它测的是别的东西）。
      〔见「AC3」：revert 后 3 条 ✖、恢复后 13 pass / 0 fail；mutation case 同一 revert 下报 STAYED-GREEN。〕
- [x] 上引复现命令与真实输出已落进本任务记录（⛔ 不接受「已复现」的自述）。
      〔Finding 三条 ssh 实录 + AC2/DoD 各条前后对照，全部为真实粘贴输出。〕

## Definition of Done

- [x] 裁定与落地都已完成，且有一个**不依赖 `$PATH` 辅助**的读数证明结论成立
      〔迁移后项目在 `PATH` 不含 `quay-native` 时 `task list` exit=0 读出 `DIR-001`；未迁移副本同一命令 ENOENT。〕
- [x] 两个已实测的存量现场（`/home/yale/quay-verify-upgrade-9eda8c70-root`、
      `/home/yale/quay-verify-upgrade-1c202737-root`）在本次工作中被显式处理（修复、或被登记），不留悬空
      〔已逐个登记：路径 + 绑定形态 + config sha256 + 不就地修的理由 + 已验证的自愈动作。〕
- [x] 若新增检查器：它若在修复被 revert 后仍取「合格」，则该检查器视为未完成（硬规则 4）
      〔revert 后单测 ✖×3、mutation case STAYED-GREEN（exit 3）⇒ 未通过；已逐字还原并复跑全绿。〕

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/provider-binding-resolvability-check.ts（新）
- plugin/scripts/checker-mutation-cases/provider-binding-resolvability-check.sh（新）
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/provider-binding-resolvability-check.test.mjs（新）
- tasks/gap-pre-fix-upgraded-project-unresolvable-binding-undetected.md
