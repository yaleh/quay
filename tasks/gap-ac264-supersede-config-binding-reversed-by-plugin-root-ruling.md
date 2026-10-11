---
id: gap-ac264-supersede-config-binding-reversed-by-plugin-root-ruling
title: AC-264 台账恒假的收口：criterion 要求 quay-fleet 的 config.yml 有一条指向
  .claude/plugins/cache/ 的绑定行，而人 2026-10-06 裁定 native provider 必须【不】写
  path/mcp_entry（「绑定（决定行为，目标为零）」）⇒ 二者结构性互斥，且 2026-10-12 的一次正确 init
  已把上一轮修复的绑定逐行删除 ⇒ 合法终态只能是 superseded + 枚举存续保证的活体承接者
status: ready
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-264
---
**type:** execution

## Touches
- goals/AC-264-收口-quay-fleet-以-project-scope-marketplace-渠道真实部署-driver-驱一条真.md
- tasks/gap-ac264-supersede-config-binding-reversed-by-plugin-root-ruling.md

## Finding

**① 本轮当场直接量 = 假（2026-10-12，cwd `/data/home/yale/work/quay`，逐字重跑 `goals/AC-264-…md` 的 criterion，⛔ 不是台账尾）**

- criterion **exit 1**，stderr 逐字：
  `AC-264: /home/yale/work/quay-fleet/.quay/config.yml binds to no .claude/plugins/cache/ path (binding lines: []) => the project is not consuming the marketplace-installed plugin, so install_channel=marketplace is self-report only`
- 判据的另两支**同轮为真**（同一轮读数，⛔ 不是推断）：record 支 PASS（`break` 取到的首条合格记录 `ts=2026-09-15T06:59:50Z`）；settings 支 PASS（`enabledPlugins` keys `['quay@quay']`）。
- 台账同读数：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass` → **exit 1**、`frozenScope: 172`、`failing: ["AC-264"]` —— 172 条冻结 AC 里**只有它一条**为假。

**② 根因：这条判据的 config.yml 绑定支，现在与仓的意图正好相反 —— 不是漂移，是裁定反转**

AC-264 设计时（2026-09-15）把「走的是 marketplace 渠道」的机制证据定为 `config.yml` 里一条指向 `.claude/plugins/cache/` 的绑定行。此后**人在 2026-10-06 裁定反转了这件事**（任务 `gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it`，status done，修法 (D) 逐字）：

> (D) native provider 缺省解析：`config.yml` **不再**为 native provider 写 `path`/`mcp_entry`；Core 缺省按 `plugin-root.ts` 解析 `<插件根>/vendor/quay-native`；自定义 provider（github、开发检出）仍写显式 `path`。`/quay:init` 对已有 config 的迁移必须**逐行删除**这两项。

同一任务把三类量明确切开（逐字）：**「绑定（决定行为，目标为零）、指引（只有 `.quay/plugin` 一个）、读数（观察运行中的进程，允许存在）」**。理由写进了实现注释（`packages/quay/src/init.ts:1004-1005`）：**"a declared path freezes the runtime to the install-cache version that wrote it, so a plugin upgrade never takes effect."** 并有测试钉死：`plugin/test/quay-init.test.mjs:160-161` 断言 init 产出的 config **不得**出现 `path:` / `mcp_entry:`。

⇒ **「绑定行数 = 0」是当前仓的明文意图；AC-264 的 config 支要求绑定行数 ≥ 1 且落在 cache 下。二者结构性互斥。** 任何「把判据修绿」的动作都只能把 `path:` 加回去 —— 而那既违反上述裁定、又会在下一次 `quay init` 被逐行删除（下面 ③ 就是这次删除的实测记录）。

**③ 为什么前两次立案没守住：这一次不是腐烂，是一次【正确的、人裁定的】操作合法地把绑定删掉了**

- `gap-ac264-quay-fleet-project-scope-plugin-only-deployment`（done，2026-09-15）：把 `path`/`mcp_entry` 写成指向 `…/cache/quay/quay/0.7.0/vendor/quay-native`。
- `gap-ac264-fleet-project-scope-deployment-rotted`（done，2026-10-10）：因 0.7.0/0.9.0 cache 目录被后续机器级 `claude plugin install` 顶掉，真实重装并重锚到 `0.17.0`。
- **2026-10-06 的人裁定 (D) 落地后**，`quay-fleet` 于 **2026-10-12 01:11** 跑了一次真 `quay init`（fleet 提交 `8bce695`，subject 逐字 `chore(quay-init): initialize quay project files (plugin v0.19.0)`）—— 该次 init **逐行删掉**了上述两行绑定（这正是 (D) 要求迁移做的事；`git -C /home/yale/work/quay-fleet log -p -1 -- .quay/config.yml` 可见该文件是**新写入**且不含 `path:`/`mcp_entry:`）。

⇒ **两次修复都不是修错了：它们被一次正确的、人裁定的后续操作推翻了。** 这使本条与「腐烂」不同 —— 它是**结构性的**：只要 (D) 有效，`path:` 就永远不该出现在 config.yml 里，而判据要求它在 ⇒ 判据**不可能稳定为真**。合法终态只能是 `superseded`（同 ⑤ 的先例）。

**④ 不降覆盖：AC-264 真正断言的【保证】的活体承接者（supersede 前必须逐条实测存在，fail-closed）**

AC-264 断言的是「quay-fleet 以 project scope 走 marketplace 渠道**真实部署**，且**自足**（不经 npm、不设 `QUAY_PLUGIN_ROOT`、不绑开发检出）」。绑定行只是它选的一种**证据形态**，不是保证本身。承接者：

| 面 | 直接量（立案当轮实测） |
|---|---|
| project-scope 启用声明 | `quay-fleet/.claude/settings.json` 的 `enabledPlugins` = `{"quay@quay": true}`（判据自己的 settings 支，现为真） |
| project-scope **安装记录** | `~/.claude/plugins/installed_plugins.json` 含 `{"scope":"project","projectPath":"/data/home/yale/work/quay-fleet","installPath":"/home/yale/.claude/plugins/cache/quay/quay/0.19.0","version":"0.19.0"}` |
| 运行中确实从 cache 插件跑 | `ps`：`…/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /home/yale/work/quay-fleet`（in-flight）；fleet 2026-10-12T04:16 仍在 `task_write`/`todo→ready`（`git -C /home/yale/work/quay-fleet log`） |
| 「不绑开发检出」由**缺席**表达 | `quay-fleet/.quay/config.yml` 的非注释 `path`/`mcp_entry` 行数 = 0 —— **比钉一条 cache 版本更自足**（无版本可冻、无开发检出可指） |
| 该缺席是一条**被钉的契约**，不是巧合 | `plugin/test/quay-init.test.mjs:160-161`；且 `plugin/scripts/provider-binding-resolvability-check.ts` 对省略形态给 **NOT-EVALUATED (exit 3)**，⛔ 不与「合格」同形（硬规则 3b） |

⇒ **保证仍在被这些直接量承载；被撤销的只是「用 config.yml 绑定行当证据」这一种形态。** AC2 的 fail-closed：上表任一条读不出来 ⇒ **不得 supersede**，把缺口逐条写进任务体并停在 `needs-human`。

**⑤ 合法终态 = `superseded`（同形先例）**

`gap-ac259-supersede-frozen-cycle-literal-and-restore-develop-dev`（status done）是同一形态：判据钉在一个被后续人裁定推翻的字面量上 ⇒ 终态 = 经 goal store 写入 `superseded` + reason（reason 逐字含根因三项），并**枚举存续保证的活体承接者**证明不降覆盖。**⛔ 不采用「改写 criterion 使其通过」**（该先例的 DoD 逐字禁止这条取巧路径：「改写判据使其通过是取巧路径，本条裁定的终态是 supersede」）。

**⑥ 连带面（如实标注）**：AC-242 的 criterion 逐字是 `goal-store.ts check --stale-pass` ⇒ 它此刻是 `achievedButFailing: ["AC-242"]` 的**唯一**成因；AC-264 一 supersede，该读数应随之消失（AC-259 先例的同形效果）。⚠️ 注意：AC-242 的红是 AC-264 造成的，**不是两条独立红**。

## AC

- [x] **AC1｜终态 = `superseded`，且理由写进记录本体（⛔ 不是只在任务里说）**：`goals/AC-264-….md` 的 `status:` == `superseded`，`statusLog` 末条 `to: superseded`，其 `reason` **逐字含下列探针**：`2026-10-06`、`path`/`mcp_entry`、`plugin-root.ts`、`install-cache`（冻结运行时那条理由）、`8bce695`（把绑定删掉的 init 提交）、`enabledPlugins`、`installed_plugins.json`、`绑定为 0`。核法：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get AC-264` 读出 `status` 与末条 `statusLog[].reason`。**只改 status 不写 reason ⇒ 红**（判据读 reason 文本，不是只读 status）。写入必须经 **goal store 本身**（`goal-store.ts write AC-264 --status superseded --reason "…"`，或 MCP `goal_write`），⛔ 不得手改 `goals/AC-264-*.md` 绕过 store。
  - 取证（写入经 goal store 本身，⛔ 未手改）：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts write AC-264 --root /data/home/yale/work/quay --status superseded --actor "worker:gap-ac264-supersede-config-binding-reversed-by-plugin-root-ruling" --reason "<2309 字符>"` ⇒ **exit 0**，落盘提交 `4e48f6300 goals: AC-264 status achieved→superseded by cli:718961`（`git status --porcelain -- goals/` 为空 ⇒ 已提交，⛔ 非只改工作树）。读回：`goal-store.ts get AC-264 --json` ⇒ `exit 0`、`status: "superseded"`、末条 `statusLog` = `{from: "achieved", to: "superseded", actor: "worker:gap-ac264-supersede-config-binding-reversed-by-plugin-root-ruling", reason 长度 2309}`。**探针逐条机械核验（9/9 命中，⛔ 非目测）**：`2026-10-06` OK / `path/mcp_entry` OK / `` `path`/`mcp_entry` `` OK / `plugin-root.ts` OK / `install-cache` OK / `8bce695` OK / `enabledPlugins` OK / `installed_plugins.json` OK / `绑定为 0` OK。
  - ⚠️ 诚实披露（根的选择）：`check --stale-pass` 是**纯读**（`goal-store.ts:3755` 注释逐字「PURE-READ judgment（⛔ runs no criterion）」），它读 `<root>/.quay/gate-events.jsonl` —— 该台账是 **workspace-local、gitignored、只存在于主检出**（实测 worktree 根读得 `NOT-EVALUATED`、`sweptEver: 0`）。而 `store-commit.ts:171` 逐字「the goal driver runs from the main checkout」且 `propagate: "none"`「a goal write rides the branch it lands on」。故**作者一次**（主检出，经 goal store），**落后把同一份字节 transport 到任务分支**（`git -C <wt> checkout author -- goals/AC-264-*.md` + commit `74d44724d`）——⛔ 不写第二遍，两遍写会各留一个 `at` 时间戳 ⇒ 与 develop 合并必冲突。transport 是搬运不是撰写，复选框/criterion 字符全部来自 ABI 记录。
- [x] **AC2｜先证不降覆盖，再允许 supersede（fail-closed）**：逐条实测 ④ 表的五个面并贴当场读数（settings.json 的 `enabledPlugins` 键；`installed_plugins.json` 里 `scope=project ∧ projectPath=/home/yale/work/quay-fleet` 的那条记录四字段；运行中进程 cmdline 含 `cache/quay/quay/<ver>/…driver-anchor.js --root /home/yale/work/quay-fleet`；config.yml 非注释 `path`/`mcp_entry` 行数 = 0）。**若任一条读不出 ⇒ 不得 supersede**：把缺口逐条写进任务体并停在 `needs-human`（硬规则 3b：读不出合格态时不许给出与合格同形的输出）。
  - 取证（五面**全部读出**，⛔ 未触发 fail-closed，未停在 needs-human）：① 启用声明 —— `/home/yale/work/quay-fleet/.claude/settings.json` 的 `enabledPlugins = {"quay@quay": true}`、`keys = ["quay@quay"]`。② 安装记录 —— `~/.claude/plugins/installed_plugins.json`（= `/data/home/yale/.claude/plugins/installed_plugins.json`）中 `scope==="project" ∧ projectPath==="/data/home/yale/work/quay-fleet"` 的记录**恰 1 条**：`{scope: "project", projectPath: "/data/home/yale/work/quay-fleet", installPath: "/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0", version: "0.19.0"}`。③ 运行中确实从 cache 插件跑 —— `ps` 实测两条同根进程：`2738045 … /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /data/home/yale/work/quay-fleet`，以及 `797809 … /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/vendor/quay/dist/quay.js goal gate AC-010 --store --root /data/home/yale/work/quay-fleet`（后者是 driver 正在跑一条真任务的当场证据）。④ 该缺席由**缺席**表达 —— `grep -nE '^[[:space:]]*(path|mcp_entry):' /home/yale/work/quay-fleet/.quay/config.yml` ⇒ **0 命中**（exit 1），即**绑定为 0**。⑤ 该缺席是被钉的契约 —— `plugin/test/quay-init.test.mjs:160-161` 两条 `assert.doesNotMatch(cfg, /^\s*path:/m …)` / `mcp_entry` 逐字在；`node --experimental-strip-types plugin/scripts/provider-binding-resolvability-check.ts --root /home/yale/work/quay-fleet` ⇒ `[NOT-EVALUATED ] native: no-mcp-entry`、**exit 3**（⛔ 不与「合格」同形，硬规则 3b）。⇒ 五面全真 ⇒ **允许 supersede**。
- [x] **AC3｜台账翻绿的机械读数（终态的独立验证）+ 负控制**：`goal-store.ts check --stale-pass` ⇒ **exit 0 且 `failing == []`**（改前实测 exit 1、`failing: ["AC-264"]`、`frozenScope: 172`）；且 `goal-store.ts check --achieved-failing` 的 `achievedButFailing` 不再含 `AC-242`（改前实测含）。负控制（**真跑，可证伪**）：把 supersede 回退（还原 `goals/AC-264-*.md`）⇒ 上面两个读数必须各自重新变红；再复原 ⇒ 复绿 —— 证明翻转的原因确是这一步。
  - 取证（同一根 = 主检出 `/data/home/yale/work/quay`，四个读数**逐字实跑**）：**改前** `check --stale-pass` ⇒ **exit 1**、`{"frozenScope":172,"failing":["AC-264"],"notEvaluated":[],"rotation":{"sweptEver":172}}`，stderr 逐字 `stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-264`；`check --achieved-failing` ⇒ exit 1、`{"achievedButFailing":["AC-242"]}`。**改后** `check --stale-pass` ⇒ **exit 0**、`{"frozenScope":171,"failing":[],"notEvaluated":[],"rotation":{"sweptEver":171}}`、stderr 空；`check --achieved-failing` ⇒ **exit 0**、`{"achievedButFailing":[]}`；集合差实测 `removed: ["AC-242"]`、`ADDED: []`（⛔ 未新增任何红）。
  - **负控制（真跑过，⛔ 不是推理）**：`cp` 备份改后文件 → 把改前字节（`git show <改前 HEAD>:goals/AC-264-*.md`，105 行）覆盖回去（`status: achieved`）⇒ `check --stale-pass` 重新 **exit 1**、`{"failing":["AC-264"],"frozenScope":172}`、stderr 逐字同上；`check --achieved-failing` 重新 **exit 1**、`{"achievedButFailing":["AC-242"]}` ⇒ **两个读数各自重新变红**，证明翻转的原因确是 supersede 这一步而非碰巧。→ `cp` 复原 ⇒ 复绿（exit 0 / `failing: []` / `achievedButFailing: []`），且 `git status --porcelain -- goals/` **为空**（与 HEAD 逐字节相同 ⇒ 负控制的扰动未留在盘上）。
- [x] **AC4｜⛔ 不得走取巧路径（三条否定断言，各一条命令可查）**：(a) `grep -nE '^[[:space:]]*(path|mcp_entry):' /home/yale/work/quay-fleet/.quay/config.yml` 命中 0（⛔ 不把绑定加回去）；(b) `git diff <本任务 base>..HEAD -- goals/AC-264-*.md` 逐行看**只有** `status:` 一行 + 一条 `statusLog` 条目 ⇒ criterion/expect 文本逐字未变（⛔ 不改写判据使其通过）；(c) `plugin/test/quay-init.test.mjs` 的两条 `doesNotMatch(cfg, /^\s*path:/m …)` / `mcp_entry` 断言逐字未动（它们是 2026-10-06 裁定的钉）。
  - 取证（三条否定断言，逐条命令 + 读数）：(a) `grep -nE '^[[:space:]]*(path|mcp_entry):' /home/yale/work/quay-fleet/.quay/config.yml` ⇒ **0 命中**、exit 1 ⇒ ⛔ 未把绑定加回去（模板行被注释前缀 `#` 占据，非注释行只有 `tasks_dir` / `env` / `loop:` 那些）。零计数的配套动作（硬规则 2 的**另一半**）**真跑过、可证伪**：同一条正则对**已知为真**的样本 `packages/quay-native/examples/sample-workspace/.quay/config.yml` ⇒ **2 命中**（`:19 path: "../.."`、`:24 mcp_entry: ["node", …]`）、`plugin/test/fixtures/init-matrix/v0.15.0/config.yml` ⇒ **2 命中**（`:9 path: "/tmp/…"`、`:11 mcp_entry: […]`）⇒ 该 0 是「查过且确实没有」，不是「谓词写坏了」。(b) `git -C <wt> diff e0a6159511c4c76b8b6acfb574fb7834619570ce..HEAD -- goals/AC-264-*.md` ⇒ `1 file changed, 11 insertions(+), 1 deletion(-)`，两个 hunk：`@@ -2,7 +2,7 @@` 只把 `status: achieved` 换成 `status: superseded`（1 行），`@@ -98,6 +98,16 @@` 只在 `statusLog:` 末尾追加**一条**条目（10 行）⇒ 逐行看**没有任何 criterion/expect 文本改动**。机械复核（⛔ 非目测）：`criterion:` 块在 base 与 HEAD 的 sha256 **两侧同为 `1f8995edc9e0b8dcd949b30c7d915cf7c17b31bafd246dcc4b2dcfa594b82114`**，`IDENTICAL: true`。(c) `git -C <wt> diff <base>..HEAD --stat -- plugin/test/quay-init.test.mjs` **输出为空**（该文件在本分支 delta 中逐字节未动）；`sed -n '160,161p'` 逐字读出两条 `assert.doesNotMatch(cfg, /^\s*path:/m, "the native provider must NOT carry a \`path:\` (Core resolves it from the plugin root)");` 与 `assert.doesNotMatch(cfg, /^\s*mcp_entry:/m, "…")` ⇒ ⛔ 未动契约断言。
  - 另记（**DoD 的 ⛔ 遵守面**）：⛔ 全程未改 `quay-fleet` 仓库任何文件（全部读数都是只读；`grep` / `ps` / `node -e` 读 JSON），⛔ 未把 `path`/`mcp_entry` 加回 fleet 的 `config.yml`，⛔ 未改 AC-264 的 criterion 文本。
- [ ] driver 在下一轮独立复验该 AC 的终态（`--stale-pass` 仍 exit 0；本任务带 `goal_ac: AC-264`）。（待外部）

## DoD

- **真实落点，不是产物清单**：AC1 的 supersede 经 **goal store 写入**并由 `get AC-264` **读回**（写不进去 = 没做）；⛔ 手改 `goals/*.md` 不算。
- **证据形态**：逐字输出 + exit code 落进任务体，⛔ 不复述「应该会」。
- **反例面**：AC3 的负控制必须**真跑过一次**并留下前后两个读数（改前红 / 改后绿），不是推理出来的。
- **不做**：⛔ 不把 `path`/`mcp_entry` 加回 `quay-fleet/.quay/config.yml`（那是**倒退**，且直接违反 2026-10-06 人裁定 (D)）；⛔ 不改写 AC-264 的 criterion 文本使其通过（取巧路径）；⛔ 不动 `plugin/test/quay-init.test.mjs` 的两条契约断言；⛔ 不改 `quay-fleet` 仓库任何文件。
