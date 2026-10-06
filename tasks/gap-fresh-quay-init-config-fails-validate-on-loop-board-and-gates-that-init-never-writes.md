---
id: gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes
title: 全新项目 /quay:init 之后立即 config validate 与 MCP config_validate 仍失败——validator
  要求 loop.board / loop.gates，init 与 LOOP_VERSION_DEFAULTS 都不写；发布前演练的第一个真实红
status: ready
labels:
  - gap
  - defect
  - priority:p1
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**症状(2026-10-06 发布前演练,发布形态产物 0.17.0,user scope 与 project scope 各一次,全新 scratch 项目)**:`CLAUDE_PLUGIN_ROOT=<安装目录> bash <安装目录>/scripts/quay-init.sh --all --loop …` 退出 0 之后,立刻
`quay config validate --root <项目>` 退出 1:
```
error: loop.board — Missing required field "board" (provider name, e.g. "native")
error: loop.gates — Missing required field "gates" (gate name or list, e.g. ["acceptance"])
2 error(s) found.
```
MCP `config_validate` 返回同样两条(`{"ok": false, "issues":[loop.board, loop.gates]}`)。从 v0.16.0 tag 重建的产物上同样存在这两条(并另有 `providers.native — missing mcp_entry`,后者已由 gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver 修掉);升级路径(0.16.0 → 0.17.0,重跑 init)后同样红。原始读数:`/data/scratch/yale/quay-release-rehearsal-1791298862/readings-user.txt`、`readings-upgrade.txt`(演练目录,可能已被清理,以任务完成记录中重新取得的读数为准)。cantus 会话此前也独立报告过同一缺口,并称这两个键在 bundle/scripts/gate-scripts/workflows 里只有校验器读、无运行时消费者(**该说法我只用一次窄 grep 复核过未找到反例,未经完整核对**)。

**机制(已读代码)**:
1. `packages/quay/src/config-validate.ts` 第 446-480 行附近:`checkLoopRequired`(第 7 项检查)要求 `loop.board` 为非空字符串、`loop.gates` 为非空字符串或非空数组,缺失即 error;第 405 行附近另有 `loop.gates` 名称解析检查。
2. init 写出的 `loop:` 段(`plugin/scripts/quay-init.sh` 的新装 heredoc 约 1535-1580 行;已有 config 的版本级默认值由 `packages/quay/src/init.ts` 的 `LOOP_VERSION_DEFAULTS`(约 117 行)经 `quay init --reconcile`/MCP init 填入,两个写者必须一致)只含 `repo_root`、`test_command`、`tmux_session`、`worktree_root`、`doc_surfaces`、`fork_baseline` 等键,**没有 `board` 与 `gates`**。
3. 两套裁判分叉:init 写什么与 validator 要什么各写各的,没有"init 输出必须能被 validate 通过"的往返检查(与上一个已 done 任务同一类缺陷:其验收只覆盖了 `mcp_entry`)。

**修法(先取证再定边,不要预设哪一边)**:
(A) **取证**:全仓(`packages/quay/src`、`plugin/scripts`、`plugin/gate-scripts`、`plugin/workflows`、`plugin/skills`、`plugin/loop`)搜索对 `loop.board`、`loop.gates`(含 `loop?.board`、`cfg.loop.board`、`lp.board`、`["board"]` 等各种读法)的**读取**点,逐个列出文件:行与上下文。
(B) **若确无运行时消费者**:校验器不得把无人使用的键设为必填——移除 `checkLoopRequired` 对这两个键的必填要求(保留"若存在则类型/名称必须合法"的检查),并在完成记录里贴出(A)的零消费者证据与"谓词对真样本的干跑"(硬规则 2)。**若有消费者**:让 init 的两个写者(`quay-init.sh` 新装 heredoc 与 `LOOP_VERSION_DEFAULTS`)都写出合理默认(`board: native`;`gates` 取项目已有的 acceptance 类 gate 名或空安全默认,且必须通过第 405 行的名称解析检查),并保证两个写者一致。
(C) **单一裁判**:同一份 `.quay/config.yml`,`config validate`、MCP `config_validate` 与 init 的默认值来源不得各写一份判断;往返测试必须覆盖"init 刚写出的配置 ⇒ validate 通过"。
(D) 更新 `plugin/skills/init/SKILL.md`、`.quay/config.yml.example` 与 init 模板注释中对这两个键的描述,使其与最终契约一致。

**不在范围**:`providers.native` 的 `path`/`mcp_entry`(已由另一任务修复);重新设计 `loop:` 段 schema;发布门禁里加断言(另有任务 gap-release-gate-verify-plugin-channel-misses-config-validate-version-pointer-scope-and-upgrade-assertions)。

<!-- dedup-ref -->相关(追溯,非前置):gap-config-validate-requires-mcp-entry-contradicts-native-default-resolver(done,只修了 mcp_entry,其"init 后立即 validate 通过"的验收在真实产物上未满足);gap-release-gate-verify-plugin-channel-misses-config-validate-version-pointer-scope-and-upgrade-assertions(todo,本缺陷是其断言的第一个真实 FAIL)。

## Touches
- `packages/quay/src/init.ts`
- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `packages/quay/test/init.test.mjs`
- `packages/quay/test/config-validate.test.mjs`
- `packages/quay/test/mcp-config-validate.test.mjs`
- `plugin/test/quay-init-characterization.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes.md`

未改动但原在 Touches 里的(附理由,非静默):`packages/quay/src/config-validate.ts`(走"init 写默认"一支 ⇒ 校验器不动)、`.quay/config.yml.example`(已含 `board: native`/`gates: [acceptance]`,无需改)、`plugin/test/quay-init.test.mjs`(两写者断言落在 init.test.mjs)、`plugin/sh-census-baseline.json`(棘轮往下走,无需重锚)。

## AC
- [x] 完成记录里贴出(A)的取证:对 `loop.board`/`loop.gates` 的全部读取点清单(文件:行与上下文),并先打印"谓词对已知真样本(例如 `config-validate.ts` 自身对 `lp.board` 的读取)的干跑结果",再给出零消费者或有消费者的结论;结论决定走(B)的哪一支。→ 见 Evidence §A:**有消费者**,走 (B) 的"init 写默认"一支。
- [x] 往返测试(`packages/quay/test/init.test.mjs` 或 `plugin/test/quay-init.test.mjs`,用真 `.quay/config.yml` 的临时 workspace,⛔ 不用裸 tasks 目录):①**全新 init**(`quay-init.sh --all --loop`)输出的配置 ⇒ `quay config validate` 退出 0 且 MCP `config_validate` 返回 `ok: true`;②**旧配置升级**(缺 `loop.board`/`loop.gates`、含 native 显式 `path`/`mcp_entry` 与多行注释)经 init/`--reconcile` 迁移后同样通过,且注释逐字节保留(迁移前后 `diff` 只差被改动的行)。`node --experimental-strip-types --test` 对应测试文件退出 0。取假:把 `checkLoopRequired` 改回必填且 init 不写这两个键后,用例红(附实跑输出)。→ `init.test.mjs` 的 `AC2①`/`AC2②` 两条;取假实跑见 Evidence §B。
- [x] 校验器用例(`config-validate.test.mjs` 与 `mcp-config-validate.test.mjs` 各覆盖):按(B)结论——若移除必填:缺这两个键 ⇒ 无 error;`loop.gates` 存在但为空串或类型错误 ⇒ 仍报错;`loop.board` 存在但非字符串 ⇒ 仍报错。若改为 init 写默认:init 输出含这两个键且 `loop.gates` 名称解析通过。→ 两文件各新增用例,正反两侧都钉(见 Evidence §C)。
- [x] 两个写者一致(仅当走"init 写默认"一支):`quay-init.sh` 新装 heredoc 与 `LOOP_VERSION_DEFAULTS` 对这两个键的默认值逐字相同,由一条测试断言;`quay-init.sh` 是 sh-census 棘轮收费文件,行数不高于改前基线,`plugin/sh-census-baseline.json` 同步。→ `init.test.mjs` 的 `AC4` 用例(三方一致:heredoc / 表 / TS 模板);棘轮净额为负,基线文件**无需**改(见 Evidence §D)。
- [x] 文档同步:`grep -n "loop.board\|loop.gates\|board:\|gates:" plugin/skills/init/SKILL.md .quay/config.yml.example packages/quay/src/init.ts` 中对这两个键的描述与最终契约一致;列出命中与处理结果。→ 见 Evidence §E。
- [x] 读生产载体:在一个一次性目录里,用**构建出的发布形态插件树**(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify`(不 push)→ `git archive` → 临时 `HOME` 下 `claude plugin marketplace add` + `install`)对全新项目跑 `quay-init.sh --all --loop` 后立即 `quay config validate` 与 MCP `config_validate`,读出退出 0 / `ok:true`;命令与输出原文贴进完成记录。该 AC 在撤销本任务改动后必须变红(负控制)。⛔ 不在真实 `~/.claude` 上操作,不 push。→ 见 Evidence §F(含负控制原文)。
- [x] `bash scripts/test.sh --for-task gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes` 退出 0 且执行了 ≥1 个测试文件。→ exit 0,执行 239 个测试(见 Evidence §G)。

## DoD
真实落地:在发布形态的插件产物上,全新项目与从 0.16.0 升级的项目,init 完成后立即运行 `quay config validate` 与 MCP `config_validate` 均通过;`loop.board`/`loop.gates` 的取证结论与最终契约一致且被测试钉住;两个写者与校验器之间没有第二份判断。仅 fixture 绿不算完成。

## Evidence

### §A (AC1) 取证:这两个键的读取点

谓词(先对**已知真样本**干跑,硬规则 2):`[A-Za-z_$][A-Za-z0-9_$]*\.(board|gates)\b`。对 `config-validate.ts` 自身干跑 ⇒ 命中 `:416 lp.gates`、`:419`、`:454 lp.board`、`:462` …(谓词确实认得"读取",不是零命中)⇒ 这次的零结果才有意义。

全仓读取点(排除 `node_modules` / `*.test.*`):

| 文件:行 | 上下文 | 是不是消费者 |
|---|---|---|
| `packages/quay/src/config-validate.ts:416,419-422,454,462-477` | `lp.gates` / `lp.board` 的必填与类型检查、第 405 行 `checkGateReferences` 的名称解析 | **校验器**(本次争议的一方) |
| `packages/quay/src/loop-params.ts:126` | `if (!p?.board \|\| typeof p.board !== "string" \|\| !(p.board as string).trim()) throw FAIL-CLOSED` | **是** —— 缺键即抛 |
| `packages/quay/src/loop-params.ts:141-144,243` | `p.gates` 归一化 + `board: (p.board as string).trim()` 进返回对象 | **是** —— 返回值消费者用 |
| `plugin/skills/loop-driver/SKILL.md:92,125,155,156` | `provider: <params.board>` 传给 MCP `task_list`/`task_write`;`gate: <params.gates[0]>` 传给 `gate_run` | **是** —— 通用 loop-driver 真的把它当参数用 |
| `plugin/scripts/config-wiring-check.ts:113-127,415-416` | 以 `readLoopParams()` 的返回对象为**唯一真值**判定 "a real reader exists" | **是**(仪器,以它为准绳) |
| `packages/quay/src/worktree-deps.ts:86` | `readLoopParams()` 的调用者(catch 后回退) | **是**(调用者) |
| `plugin/scripts/verification-marginal-return.ts:446,450,714,839…` | `input.gates` 是 gate-events 路径,与 `loop.gates` 无关 | 否(谓词假阳性,已剔除) |

**结论(决定 (B) 的哪一支):有消费者。** cantus 的说法只覆盖 `bundle/scripts/gate-scripts/workflows`,而消费者在 `packages/quay/src/loop-params.ts`(FAIL-CLOSED)与 `plugin/skills/loop-driver/SKILL.md`(`params.board`/`params.gates`)—— 后者是**通用 loop-driver** 的正文,不是脚本目录。故**不**放宽校验器(那会让 `readLoopParams` 与校验器继续分叉),而是让 init **写出**这两个键。

### §B (AC2) 往返 + 取假实跑

`packages/quay/test/init.test.mjs`(55 测试全绿)新增两条:
- `AC2① (round-trip)`:真 `quay-init.sh --loop` 写出的临时候 workspace ⇒ 解析出 `loop.board === "native"`、`loop.gates` deep-equal `["acceptance"]`;`quay config validate` 匹配 `/Config valid/`;MCP 侧注册的 `config_validate` handler 返回 `structuredContent.ok === true`。
- `AC2② (round-trip)`:0.16.0 形状的旧配置(显式 `path`/`mcp_entry`、独立注释行、块式标量)经 `quay init --reconcile` 后报告 `filled loop.board` / `filled loop.gates`;并断言**逐字节纯插入**——`before` 的每一行在 `after` 中按序仍能找到(用子序列而非 diff 工具,直接把"没重写任何行"说出来);随后 `quay config validate` 通过。

**取假(硬规则:判据必须能取假)**:把 `LOOP_VERSION_DEFAULTS` 的 `board`/`gates` 两项与 heredoc 的 `board: native`/`gates: ["acceptance"]` 两行同时撤掉后重跑:

```
✖ AC2 reconcile unit: reconcileConfigContent edits in place — only the keys it sets appear
✖ AC1/AC2: a FRESH workspace's init output validates CLEANLY (provideR axis AND loop.board/loop.gates)
✖ AC1: a FRESH `quay init` (CLI) output validates with exit 0
✖ AC2① (round-trip): a fresh `quay-init.sh --loop` output passes BOTH ...
✖ AC2② (round-trip): an OLD config missing loop.board/loop.gates passes after `quay init --reconcile` ...
✖ AC4: the shell heredoc's loop.board/loop.gates ARE the LOOP_VERSION_DEFAULTS values ...
ℹ tests 55 / ℹ pass 49 / ℹ fail 6

AC2① 的失败原文:
  AssertionError [ERR_ASSERTION]: the fresh install writes loop.board
  + actual - expected
  + undefined
  - 'native'
```
恢复后 55/55 绿(备份/还原,非 `git checkout`)。

### §C (AC3) 校验器用例

- `packages/quay/test/config-validate.test.mjs` 新增 `AC3: the fresh-install shape (board: native + gates: [acceptance]) validates; blank/ill-typed gates still red`:正面 `ok:true`(该 workspace **没有** `gates:` 段——正是新装形态,`acceptance` 由内置 registry 解析);反面 `gates: ""` 与 `gates: 3` 仍 `ok:false` 且 issue 点名 `loop.gates`。
- `packages/quay/test/mcp-config-validate.test.mjs` 新增两条同名正/反用例,**同一个 `validateConfig`**(MCP 与 CLI 是同一个裁判)。
- 两文件共 79 测试全绿。既有的 "missing loop.board/gates exits with error" 两条**保留不动**——它们正是"必填"这一半,与本任务的"init 必须写"互补。

### §D (AC4) 两个写者一致 + 棘轮

`init.test.mjs` 的 `AC4` 用例:按 `plugin/test/quay-init-loop.test.mjs` 同样的手法枚举 `quay-init.sh` 的 heredoc,用只有配置写者正文才有的 marker 定位到它(找不到 ⇒ 红,不做空转假绿);把 `${...}` 抹成占位符后当 YAML 解析,断言 `board`/`gates` **先存在**(`typeof === "string"` / 非空数组,否则 `undefined === undefined` 会把"啥也没写"读成"两写者一致"),**再**等于 `LOOP_VERSION_DEFAULTS` 的同名值;第三写者(TS 模板 `generateConfigContent`)用**真实输出**解析后同样比对 ⇒ 三方一致是被**测量**的,不是手写断言的。

`quay-init.sh` 的 sh-census `codeLines`:**改前 1009 → 改后 1009**(净零),合并 develop 后 **1009 → 1007**(净负)。为付这两行的账,`mkdir -p …`/`echo "  created: …"` 两对语句按本文件自己 `write_config` 头注释记录的同一手法合成一行(该注释明写"必须净零或净负")。`embeddedInterpreterLines` 7692 → 7690 ≤ 基线 7692 ⇒ **`plugin/sh-census-baseline.json` 无需改动**(棘轮只降不升,降无需重锚)。

### §E (AC5) 文档同步

`grep -n "loop.board\|loop.gates\|board:\|gates:" plugin/skills/init/SKILL.md .quay/config.yml.example packages/quay/src/init.ts` 的命中与处理:

| 命中 | 处理 |
|---|---|
| `plugin/skills/init/SKILL.md`:**0 命中**(该 skill 此前对这两个键完全沉默) | **新增** "### The REQUIRED `loop:` keys — `board` and `gates`" 一节:两键的值、为什么必填(校验器 + `readLoopParams` FAIL-CLOSES)、为什么 `acceptance`(内置、新装即解析)、以及"版本级默认值的唯一来源是 `LOOP_VERSION_DEFAULTS`,shell 侧是镜像且被测试钉住"。 |
| `.quay/config.yml.example:134,141` | 已经是 `board: native` / `gates: [acceptance]`——与本任务最终契约一致,**无需改动**(它的注释还记录了 `acceptance` 是经 `listGates()` + 真实 gate 历史双向核对过的值)。 |
| `packages/quay/src/init.ts:135,149`(新表项)、`:553-554`(模板字段说明"REQUIRED") | 表项为本轮新增,注释写明值、理由、镜像对象;模板的 "REQUIRED" 说明本来就与最终契约一致。 |

另修一处**由本任务引入**的文档闸红:我在 SKILL.md 里写了字面量 `plugin/scripts/quay-init.sh`,而 `capability-catalog.ts` 的 `DOC_SH_RE = /plugin\/scripts\/([a-zA-Z0-9._-]+\.sh)/g` 会把它当成"内部 .sh 出现在消费面文档" ⇒ `npm-pack-e2e` 的 AC3 红。改为本文件既有的裸 basename 形式(该文件从来用 `${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh` 或裸名)。

### §F (AC6) 生产载体读数 + 负控制

**正读数**(发布形态,不 push,全部在一次性目录 + 临时 `HOME`):

```
$ bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify
[publish-dist-branch] orphan commit ready: aa951a97d652be9742d48c178c3d157d4372d048
[publish-dist-branch] --push not given; built+committed locally only

$ git archive plugin-channel-verify | tar -x -C $MKT
$ node -e 'require("'$MKT'/.claude-plugin/marketplace.json").name'   →  quay   (stamp 生效)
$ grep -E '^  (board|gates):' $MKT/scripts/quay-init.sh
  board: native
  gates: ["acceptance"]

$ HOME=$TH claude plugin marketplace add $MKT      → Successfully added marketplace: quay
$ HOME=$TH claude plugin install quay@quay --scope user
  → Successfully installed plugin: quay@quay (scope: user)
  → /tmp/qhome-…/.claude/plugins/cache/quay/quay/0.17.0-dev

$ CLAUDE_PLUGIN_ROOT=<installed> bash <installed>/scripts/quay-init.sh --all --loop --root $WS --test-command "node --test"
quay-init complete.
$ grep -E '^  (board|gates):' $WS/.quay/config.yml
  board: native
  gates: ["acceptance"]
$ node <installed>/vendor/quay/dist/quay.js config validate --root $WS
Config valid.                                                            (exit 0)

MCP(同一安装的 bundle,JSON-RPC over stdio → tools/call config_validate):
{ "content": [ { "type": "text", "text": "{\n  \"ok\": true,\n  \"issues\": []\n}" } ],
  "structuredContent": { "ok": true, "issues": [] } }
```

⛔ 全程 `HOME=<mktemp>`,未触碰真实 `~/.claude`;未 push。

**负控制**(撤销本任务改动后必须变红):把两处改动撤掉后同样 `publish-dist-branch.sh --branch plugin-channel-negctrl` → archive → 临时 HOME 安装 → 同一流程:

```
$ grep -E '^  (board|gates):' $WS2/.quay/config.yml
(neither key written)
$ node <installed>/vendor/quay/dist/quay.js config validate --root $WS2
error: loop.board — Missing required field "board" (provider name, e.g. "native")
error: loop.gates — Missing required field "gates" (gate name or list, e.g. ["acceptance"])
2 error(s) found.                                                        (exit 1)
```
与 Proposal 的原始症状**逐字相同** ⇒ 该 AC 能取假。(负控制分支已删;`plugin-channel-verify` 保留本地、未 push。)

### §G (AC7) scoped 门

```
$ bash scripts/test.sh --for-task gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes --allow-thin
ℹ tests 239 / ℹ pass 239 / ℹ fail 0                                        (exit 0)
```

### §H 与 develop 的并发修复撞车(必须记)

本任务在飞期间 **develop 也修了同一个缺陷的一半**(`gap-release-gate-verify-plugin-channel-misses-config-validate-…`):它在 heredoc 里加了 `board: "native"` + `gates: []`,并重锚了 `quay-init-characterization`。git 自动合并 ⇒ heredoc 里**同时出现两块** `board:`/`gates:`(YAML 重复键)。已语义解决:

1. 删掉 develop 那一块,保留本分支的:本分支的 `board: native`(不带引号)与 `LOOP_VERSION_DEFAULTS` 的渲染**逐字一致**(AC4 的镜像判据要求),`gates: ["acceptance"]` 是内置可解析、driver 真能跑的 gate,而 `[]` 只是让校验器**空转通过**、`params.gates[0]` 仍是 undefined。
2. develop 只修了**新装写者**;本分支还把两键加进 `LOOP_VERSION_DEFAULTS` ⇒ **升级路径**才能靠重跑 init 转绿。这是本任务不可被 develop 那半替代的部分。
3. `quay-init-characterization.test.mjs` 的 `.quay/config.yml` 哈希按该文件自己写的"故意变更 ⇒ 一行重锚"重锚(`fc818a6a…` → `9020508355…`);另外五个文件哈希不变 —— 正是它自己声称的定向交叉核对。
4. `docs/analysis/quay-init-closure-ratchet.baseline.json` 合并冲突同样按"footprint 未膨胀 ⇒ 重锚指纹"处理(3 files / 1022 bytes 不变)。
