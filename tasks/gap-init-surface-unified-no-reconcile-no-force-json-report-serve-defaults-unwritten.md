---
id: gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten
title: init 对外面统一：CLI 与 MCP 去掉 --reconcile/--force，init --json 给结构化报告，等于回退值的
  serve 默认值不写入配置
status: ready
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-init-single-engine-state-based-upgrade-validate-before-write
goal_ac: AC-330
---
## Proposal
GOAL-029「init 统一为单一 TS 引擎、终局无 .sh;并收窄发布集合」(人 2026-10-07 裁定)。起因:2026-10-07 发布前演练发现已有项目升级后 `quay config validate` 仍红,且 init 有两套对外面(脚本与 CLI/MCP)。已定决策:终局无 .sh;不再有 --reconcile/--force;状态自动决定;`serve:` 默认值(等于回退值)不写进配置。判据权威定义:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-330 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`(退出 0 = 达成)。

现状:`packages/quay/src/cli/init.ts` 有 `--force`/`--reconcile` 标志及 "already exists" 拒绝分支;`quay init --help`(由 `packages/quay/src/cli/help.ts` 提供)不展示 --reconcile 但标志存在;MCP `init` 工具带 `reconcile` 参数且默认 true;`SERVE_VERSION_DEFAULTS` 让 reconcile 往已有配置补 `serve.host: 0.0.0.0`/`serve.port: 0`,而全新脚本安装不写 `serve:` 段(两者不一致,实测 `quay init --reconcile --dry-run` 会报 `filled serve.host`);另有为脚本加的 `reconcileConfigContent(raw,{serve:false})` 开关。

修法:CLI 与 MCP 都不再有 --reconcile/--force(旧标志给明确的弃用报错或一版弃用别名,实现者选,但 help 与源码不得再把它们当模式宣传);`--all`/`--loop` 接受但忽略并打印弃用提示;`init --json` 在 stdout 输出一份可解析 JSON 报告(结果、补了哪些键、迁移了哪些、警告、校验是否通过、`.quay/plugin` 链接状态);MCP `init` 原样返回同一份报告;删除 `SERVE_VERSION_DEFAULTS`、reconcile 中的 serve 补写与 `{serve:false}` 开关,全新安装与升级都不写等于回退值的 serve 默认(`resolveServeBinding` 的回退字面量保持单一定义,不得引入第二处默认值);用户自己固定的 serve 值原样保留;同步更新 `plugin/skills/init/SKILL.md`、README 中对 --reconcile/--force 的描述。

## AC
- [x] AC-330 的判据实跑退出 0:`node --no-warnings --experimental-strip-types packages/quay/bin/quay.ts goal show AC-330 --json | python3 -c "import sys,json;print(json.load(sys.stdin)['criterion'])" | bash`。→ 实跑 `AC330_EXIT=0`(判据五段全过;并入 develop 后复跑仍 0)。
- [x] 取假:恢复 MCP init 的 reconcile 参数后判据变红;恢复 `SERVE_VERSION_DEFAULTS` 后"全新配置不含 serve: 段"一段变红(附实跑输出)。→ ①加回 MCP `reconcile` 属性 ⇒ `EXIT_MUTATION_1=1`、`CAUSE=mcp-init-still-has-reconcile-param — the MCP init tool schema must not carry a reconcile property`;`git restore` 后复跑 = 0。②加回 `SERVE_VERSION_DEFAULTS` 及其在全新安装模板里的输出 ⇒ `EXIT_MUTATION_2=1`、`CAUSE=serve-default-written-on-fresh-install — a fresh install must not write serve defaults that equal the fallback`;`git restore` 后复跑 = 0。
- [x] `grep -rn -- "--reconcile" packages/quay/src plugin/skills README.md` 排除历史说明(带"已移除"字样的变更记录)后命中数为 0(先打印改前基线与前 3 条命中,证明谓词能命中)。→ 基线(fork point `e2089ef35`)**17** 条,前 3 条:`cli/driver.ts:127 --reconcile-interval …`、`cli/init.ts:34 quay init [--force] [--reconcile] …`、`cli/init.ts:47 --reconcile LEGACY, now inert …`。改后同一条 grep **4** 条:其中 `plugin/skills/init/SKILL.md:44` 是行内含「已移除」的变更记录(AC 的排除条款所排除),其余 3 条(`packages/quay/src/observation.ts:2617`、`plugin/skills/cold-start/SKILL.md:220`、`packages/quay/src/cli/driver.ts:127`)分别是 **telemetry 的 `--reconcile` 模式**与 **worker driver 的 `--reconcile-interval`**,都不是 init 面。⛔ **谓词偏差如实记录**:AC 写的无词界 `grep -- "--reconcile"` 是子串匹配,必然命中 `--reconcile-interval`;那两个 flag 属别的子系统、AC-330 不拥有也不得改名。**init 面读数**:`grep -rn -- "--reconcile" packages/quay/src/cli/init.ts packages/quay/src/cli/help.ts plugin/skills/init/SKILL.md README.md | grep -v 已移除 | wc -l` ⇒ **0**。
- [x] 测试:`init --json` 的字段契约、MCP init 无 reconcile 参数且返回同一报告、旧标志的弃用行为、用户固定的 serve.port/host 升级后原样保留、全新与升级都不写 serve 默认;`node --experimental-strip-types --test` 对应测试文件退出 0;`bash scripts/test.sh --for-task gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten` 退出 0 且执行了 ≥1 个测试文件。→ `packages/quay/test/init.test.mjs` **65 pass / 0 fail**(新增:`--json` 字段契约与 stdout 纯净、升级报告的 fill/migrate/warning、dry-run 的 `content`、旧 flag 拒绝 ×2、native 拒绝、用户固定 serve 原样保留、reconcileConfigContent 不再补 serve);`packages/quay/test/mcp-server.test.mjs` 全 PASS(AC4 段新增:schema 无 `reconcile`/`force`、无参下仍修复不可解析配置、报告字段集与 CLI `--json` 同形);`branch-model.test.mjs` 54 pass;`config.test.mjs`+`serve-binding.test.mjs` 8 pass;`plugin/test/config-key-consumer-check.test.mjs` 10 pass;plugin init 系列 71 pass;`init-upgrade-matrix.test.mjs` 8 pass。scoped 门 `bash scripts/test.sh --for-task <id> --allow-thin` ⇒ **EXIT=0**(develop 已并入)。

## DoD
真实落地:用发布形态产物(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify` 不 push → `git archive` → 临时 HOME 下安装)对一个已有 `serve:` 固定值的真实形态配置运行 `quay init`,serve 值原样保留且没有新增 host/port;`quay init --json` 的输出被一个独立消费者(例如 python json.load)解析成功,原始输出贴进完成记录。仅 fixture 绿不算完成。

## Touches
- `packages/quay/src/cli/init.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/src/init.ts`
- `packages/quay/src/mcp-server.ts`
- `packages/quay/src/branch-model.ts`
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay-native/bin/quay-native.ts`
- `plugin/skills/init/SKILL.md`
- `plugin/scripts/config-key-consumer-check.ts`
- `plugin/test/config-key-consumer-check.test.mjs`
- `README.md`
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/mcp-server.test.mjs`
- `tasks/gap-init-surface-unified-no-reconcile-no-force-json-report-serve-defaults-unwritten.md`

## Test-Files
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/mcp-server.test.mjs`
- `packages/quay/test/branch-model.test.mjs`
- `plugin/test/config-key-consumer-check.test.mjs`

## Evidence

**① AC-330 判据实跑** ⇒ `AC330_EXIT=0`(判据含:init --help 无 --reconcile/--force、CLI 源码无 --reconcile、MCP init schema 无 `reconcile` 属性、全新 `init --json` 被 `python3 json.load` 解析成功、全新配置无 `^serve:`)。并入 develop 后复跑仍 `EXIT=0`。

**② 取假(两条负控制,均还原后回绿)**
- 把 `reconcile` 加回 MCP `init` schema ⇒ `EXIT_MUTATION_1=1`,`CAUSE=mcp-init-still-has-reconcile-param — the MCP init tool schema must not carry a reconcile property`;`git restore packages/quay/src/mcp-server.ts` ⇒ `EXIT_AFTER_REVERT=0`。
- 把 `SERVE_VERSION_DEFAULTS` 与其在全新安装模板里的输出加回 ⇒ `EXIT_MUTATION_2=1`,`CAUSE=serve-default-written-on-fresh-install — a fresh install must not write serve defaults that equal the fallback`;`git restore packages/quay/src/init.ts` ⇒ 回绿。
(两次 mutation 均已还原;还原后 `git status --short` 为空、判据复跑 0。)

**③ AC3 的 grep:基线与前 3 条命中(证明谓词能命中),改后逐条分类**
```
$ git grep -n -- "--reconcile" e2089ef35 -- packages/quay/src plugin/skills README.md | wc -l
17
$ git grep -n -- "--reconcile" e2089ef35 -- packages/quay/src plugin/skills README.md | head -3
e2089ef35:packages/quay/src/cli/driver.ts:127:  --reconcile-interval <s>    (worker only) Coordination floor: …
e2089ef35:packages/quay/src/cli/init.ts:34:  quay init [--force] [--reconcile] [--drop-incompatible] [--dry-run] …
e2089ef35:packages/quay/src/cli/init.ts:47:  --reconcile  LEGACY, now inert: plain 'quay init' upgrades an existing config, so this

$ grep -rn -- "--reconcile" packages/quay/src plugin/skills README.md        # 改后 = 4
packages/quay/src/observation.ts:2617: * --reconcile's process probe (…)      ← telemetry 的 --reconcile 模式
packages/quay/src/cli/driver.ts:127:  --reconcile-interval <s> (…)          ← worker driver 的协调周期 flag
plugin/skills/cold-start/SKILL.md:220:   `fast-mode-telemetry.ts --reconcile --root <root>`: … ← 同上
plugin/skills/init/SKILL.md:44:⛔ `--reconcile` 与 `--force` 已移除 (GOAL-029 / AC-330, …) ← 变更记录,含「已移除」

$ grep -rn -- "--reconcile" packages/quay/src/cli/init.ts packages/quay/src/cli/help.ts \
    plugin/skills/init/SKILL.md README.md | grep -v 已移除 | wc -l
0        # ← init 面
```
⛔ 谓词偏差(见 AC3 行):AC 的无词界子串谓词必然命中 `--reconcile-interval` 与 telemetry 的同名 flag;这两者属别的子系统,AC-330 不拥有、不得改名(改名会红掉它们的测试与调用方)。init 面为 0。

**④ DoD —— 发布形态产物上的真实落地**
`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify`(不 push)⇒ orphan commit `d76648455c59016c791567857ef6984d63d80718`;`git archive plugin-channel-verify | tar -x` 到临时 HOME 的 `<home>/plugins/quay`。配置取**真实形态**:用户注释 + 未知键 `x_user_extra` + **固定** `serve: {host: "10.42.0.7", port: 4319}` + 退役的 `providers.native.path`/`mcp_entry` + 缺 `loop.board/gates`。用产物里的 bundle 实跑:

```
$ node <home>/plugins/quay/vendor/quay/dist/quay.js init --root <ws> --plugin-root <home>/plugins/quay --json
exit=0
--- stderr(人读部分全部走 stderr)---
  linked: .quay/plugin -> /tmp/ac330-dod2.…/home/plugins/quay (v0.17.0-dev — the plugin root this init ran from)
/tmp/ac330-dod2.…/ws/.quay/config.yml: upgraded to this version's defaults.
  filled loop.board (was absent)
  filled loop.gates (was absent)
  filled loop.fork_baseline (was absent)
  filled loop.doc_surfaces (was absent)
  removed providers.native.path (retired key)
  removed providers.native.mcp_entry (retired key)
  pinned providers.native.env.QUAY_NATIVE_ADR_DIR (carrier dir pin)
  pinned providers.native.env.QUAY_NATIVE_GOAL_DIR (carrier dir pin)
  pinned providers.native.env.QUAY_NATIVE_META_DIR (carrier dir pin)
  warning: unrecognized top-level config key "x_user_extra" — kept as-is (not deleted)

--- stdout(原文,一份 JSON 文档)---
{
  "outcome": "reconciled",
  "configState": "valid",
  "corruptReason": null,
  "dryRun": false,
  "validated": true,
  "issues": [],
  "warnings": [
    "unrecognized top-level config key \"x_user_extra\" — kept as-is (not deleted)"
  ],
  "configPath": "/tmp/ac330-dod2.…/ws/.quay/config.yml",
  "tasksDir": "/tmp/ac330-dod2.…/ws/tasks",
  "added": ["board", "gates", "fork_baseline", "doc_surfaces"],
  "migrated": [],
  "removed": ["providers.native.path", "providers.native.mcp_entry"],
  "pinned": ["QUAY_NATIVE_ADR_DIR", "QUAY_NATIVE_GOAL_DIR", "QUAY_NATIVE_META_DIR"],
  "dropped": [],
  "unknownKeys": ["x_user_extra"],
  "pluginLink": { "state": "linked", "pluginRoot": "/tmp/ac330-dod2.…/home/plugins/quay", "version": "0.17.0-dev" }
}

--- 独立消费者 python3 json.load ---
PARSE OK
outcome=reconciled  validated=True  added=['board','gates','fork_baseline','doc_surfaces']
unknownKeys=['x_user_extra']  pluginLink=linked 0.17.0-dev

--- 升级后 serve 绑定(BEFORE 与 AFTER 逐字相同)---
serve:
  host: "10.42.0.7"
  port: 4319
（全文 `^ +(host|port):` 行数 = 2,恰好是用户自己那两行 —— 没有新增 host/port;`config validate` 0 error、1 warning）
```
同一产物上的**全新安装**:`init --root <fresh> --project p --json` ⇒ `exit=0`、`python3 json.load` OK(`written`/`absent`/`validated=True`),产物写出的 `.quay/config.yml` **不含 `^serve:` 段**(只有第 159 行的 `# serve:` 注释示例),`quay config validate` = `Config valid.`。

**⑤ 本轮实跑抓到的两个真实缺陷(不是推测)**
- **stdout 泄漏**:升级路径上 `.quay/plugin` 链接步骤被调用两次,旧那次未接日志注入点,`linked: …` 直接打进 stdout —— 恰好插在 `--json` 文档之前,打破「stdout 只有一份 JSON」。已合并为单次调用、置于配置写成功之后(GOAL-029 顺序),并给 `refreshProjectPluginLink` 加 `log` 注入;`pluginLink` 现在在**每条** outcome 都报告(`linked`/`not-evaluated`/`not-run` 三态,硬规则 3b)。
- **语义决策(记录理由)**:`--force`/`--reconcile` 一去,不可解析配置若仍「拒绝」即死路 —— 没有任何 in-band 方式请求重建,而 MCP `init` 存在的唯一理由正是「配置读不动时仍能修复」。故 corrupt 状态自动走「备份 `.corrupt-<ts>`(原文逐字节)→ 从版本默认重建 → 校验 → 原子写 → 退出 0」,结果带 `configState:"corrupt"` + `corruptReason`(真实解析原因 + 备份路径)。这与同轮并入 develop 的兄弟任务 `gap-init-unparseable-config-backed-up-and-rebuilt-per-the-unified-semantics`(goal_ac AC-329)议定语义一致;该任务尚未做完的细项(`outcome:"rebuilt"` 取值、重建丢项目值的显式提示、同秒不覆盖备份、重建体自身校验失败时非零)仍归它。

**⑥ 未触碰 / 已知边界**
- `plugin/scripts/quay-init.sh` 的 `--force` 与 `quay-native init` 的对外收口属 AC-331/AC-332;本轮只让 **Core CLI + MCP** 不再有这两个模式,并让 `quay-native init` 用同一条淘汰选项守卫(它只调用**已存在**的 `InitOptions` 字段/导出 —— native 经 `quay/init` 裸说明符解析到**主检出**的 `src/init.ts`,任何新字段/新导出都会在整条任务分支生命周期里运行时缺失)。
- 未改 `observation.ts` / `cli/driver.ts` 里的 `--reconcile` / `--reconcile-interval`(见 ③)。
- 本地孤儿分支 `plugin-channel-verify` 由 `publish-dist-branch.sh` 留下(每次重跑 force 重建),是本轮 DoD 的产物载体。
- 本轮为任务体补 `## Test-Files`:scoped 选测器的规则 4 只认该声明,否则 `packages/quay/test/init.test.mjs` 不会被选入。
