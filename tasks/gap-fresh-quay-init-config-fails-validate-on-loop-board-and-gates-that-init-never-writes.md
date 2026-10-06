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
- `packages/quay/src/config-validate.ts`
- `packages/quay/src/init.ts`
- `plugin/scripts/quay-init.sh`
- `plugin/skills/init/SKILL.md`
- `.quay/config.yml.example`
- `packages/quay/test/config-validate.test.mjs`
- `packages/quay/test/mcp-config-validate.test.mjs`
- `packages/quay/test/init.test.mjs`
- `plugin/test/quay-init.test.mjs`
- `plugin/sh-census-baseline.json`
- `tasks/gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes.md`

## AC
- [ ] 完成记录里贴出(A)的取证:对 `loop.board`/`loop.gates` 的全部读取点清单(文件:行与上下文),并先打印"谓词对已知真样本(例如 `config-validate.ts` 自身对 `lp.board` 的读取)的干跑结果",再给出零消费者或有消费者的结论;结论决定走(B)的哪一支。
- [ ] 往返测试(`packages/quay/test/init.test.mjs` 或 `plugin/test/quay-init.test.mjs`,用真 `.quay/config.yml` 的临时 workspace,⛔ 不用裸 tasks 目录):①**全新 init**(`quay-init.sh --all --loop`)输出的配置 ⇒ `quay config validate` 退出 0 且 MCP `config_validate` 返回 `ok: true`;②**旧配置升级**(缺 `loop.board`/`loop.gates`、含 native 显式 `path`/`mcp_entry` 与多行注释)经 init/`--reconcile` 迁移后同样通过,且注释逐字节保留(迁移前后 `diff` 只差被改动的行)。`node --experimental-strip-types --test` 对应测试文件退出 0。取假:把 `checkLoopRequired` 改回必填且 init 不写这两个键后,用例红(附实跑输出)。
- [ ] 校验器用例(`config-validate.test.mjs` 与 `mcp-config-validate.test.mjs` 各覆盖):按(B)结论——若移除必填:缺这两个键 ⇒ 无 error;`loop.gates` 存在但为空串或类型错误 ⇒ 仍报错;`loop.board` 存在但非字符串 ⇒ 仍报错。若改为 init 写默认:init 输出含这两个键且 `loop.gates` 名称解析通过。
- [ ] 两个写者一致(仅当走"init 写默认"一支):`quay-init.sh` 新装 heredoc 与 `LOOP_VERSION_DEFAULTS` 对这两个键的默认值逐字相同,由一条测试断言;`quay-init.sh` 是 sh-census 棘轮收费文件,行数不高于改前基线,`plugin/sh-census-baseline.json` 同步。
- [ ] 文档同步:`grep -n "loop.board\|loop.gates\|board:\|gates:" plugin/skills/init/SKILL.md .quay/config.yml.example packages/quay/src/init.ts` 中对这两个键的描述与最终契约一致;列出命中与处理结果。
- [ ] 读生产载体:在一个一次性目录里,用**构建出的发布形态插件树**(`bash plugin/scripts/publish-dist-branch.sh --branch plugin-channel-verify`(不 push)→ `git archive` → 临时 `HOME` 下 `claude plugin marketplace add` + `install`)对全新项目跑 `quay-init.sh --all --loop` 后立即 `quay config validate` 与 MCP `config_validate`,读出退出 0 / `ok:true`;命令与输出原文贴进完成记录。该 AC 在撤销本任务改动后必须变红(负控制)。⛔ 不在真实 `~/.claude` 上操作,不 push。
- [ ] `bash scripts/test.sh --for-task gap-fresh-quay-init-config-fails-validate-on-loop-board-and-gates-that-init-never-writes` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:在发布形态的插件产物上,全新项目与从 0.16.0 升级的项目,init 完成后立即运行 `quay config validate` 与 MCP `config_validate` 均通过;`loop.board`/`loop.gates` 的取证结论与最终契约一致且被测试钉住;两个写者与校验器之间没有第二份判断。仅 fixture 绿不算完成。
