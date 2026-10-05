---
id: gap-plugin-json-commands-array-duplicates-skills
title: plugin.json 的 commands 数组把 13 个 SKILL.md 重复注册为 command（产生 quay:SKILL 与重名）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`plugin/.claude-plugin/plugin.json` 的 `commands` 数组列了 13 条 `./skills/<x>/SKILL.md`，而 `plugin/skills/` 目录本来就被 Claude Code 自动扫描为 skill（官方文档 plugins-reference：`commands` 指向「扁平 .md 命令文件」并替换默认 `commands/` 扫描；`skills/` 总是自动扫描）。结果每个 skill 既作 skill 又作 command 注册，文件名都叫 SKILL，于是补全里出现 `quay:SKILL` 且名字重复。2026-10-05 实测（claude -p --plugin-dir，对比副本）：删掉 `commands` 后 slash_commands 由 14 项降为 13 项，`quay:SKILL` 消失，13 个 skill 全部保留，`claude plugin validate` 通过。修复：删除 `plugin.json` 的 `commands` 数组，仅靠 `skills/` 自动发现；`plugin/commands/` 目录不存在，故不丢默认命令。同时核对仓库内是否有检查器/测试/文档把 `commands` 数组当必须字段（grep `\"commands\"` 于 plugin/scripts、plugin/test、packages/quay/scripts 的 plugin.json 相关检查），一并改。注：本机同时启用了 quay@quay（用户级）与 quay@quay-dev（项目级）造成的整批重名是另一个原因，已在本机 `.claude/settings.local.json` 单独处理，不在本任务范围。

## AC
- [x] `node -e 'const j=require(\"./plugin/.claude-plugin/plugin.json\");process.exit(\"commands\" in j?1:0)'` 退出码 0（commands 键已不存在）。→ 实测 exit 0。
- [x] `claude plugin validate ./plugin` 输出含 `Validation passed`（若 agents 路径等无关错误，说明并贴出原文）。→ 实测输出 `✔ Validation passed`（仅此一行，无其它错误）。
- [x] 在临时目录 `claude -p \"hi\" --plugin-dir <plugin副本> --output-format stream-json --verbose --max-turns 1` 的 init 消息中，`slash_commands` 里以 `quay:` 开头的项不含 `quay:SKILL`，且 `skills` 里 quay: 开头的项仍为 13 个；贴出两个计数。→ `quay:SKILL` 已消失（before 有 / after 无）；13 个 SKILL.md skill 全部保留。两计数（isolated `CLAUDE_CONFIG_DIR` + 临时 cwd，claude 2.1.289）：slash_commands `quay:` before=20 / after=19；skills `quay:` after=19。⚠️ after 的 19 = 13 个 SKILL.md skill + 6 个 `plugin/workflows/*.js`（本版 Claude Code 把 plugin workflow 与 skill 同列进 init 的 `skills` 字段）；本任务前后差恰为 1（`quay:SKILL`），workflow 条目各只出现一次、非重名、与本改动无关。逐项读数与证据见 Notes。
- [x] `grep -rn '\"commands\"' plugin/scripts plugin/test packages/quay/scripts --include=*.ts --include=*.mjs --include=*.sh` 的命中逐条列出，说明无一把 plugin.json 的 commands 数组当必需字段（或已同步修改）。→ 该 grep **0 命中**（exit 1）。另做语义搜索（不带引号的 `commands`）命中唯一活跃消费者 `plugin/test/plugin-packaging.test.mjs`（第 8/86/103/110/114 行读 `manifest.commands`），已同步修改：改为断言 `commands` 键**缺席**（防回归）+ 磁盘上 13 个 skill 目录存在。其余命中均为历史里程碑审计/提案文档（不可变记录，不改）。
- [x] `scripts/test.sh --for-task gap-plugin-json-commands-array-duplicates-skills` 退出码 0。→ 实测（加 `--allow-thin`，selector 选 0 个 test 文件时仍跑静态门）exit 0。
- [ ] 人 yale 在交互式 Claude Code（重启后）输入 /quay，init 只出现 1 次且无重复的其它 quay: 项；贴出截图文字（待外部）

## DoD
真实落地：`/quay:` 补全中不再出现 `quay:SKILL`，且 13 个 skill 仍可用斜杠调用（以 claude -p init 消息的实读计数为证，不是 fixture）。修复后重新跑一次上述 init 读数，贴在任务 Notes。

## Touches
- plugin/.claude-plugin/plugin.json
- plugin/test/plugin-packaging.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-plugin-json-commands-array-duplicates-skills.md

## Notes

### 修复后 claude -p init 实读（claude 2.1.289；隔离 `CLAUDE_CONFIG_DIR` 为新建临时目录，cwd 为临时目录，`--plugin-dir <plugin副本>`）
只加载 1 个 quay 插件（`plugins: [{name:\"quay\", path:\"…/plugin\", source:\"quay@inline\", version:\"0.15.0-dev\"}]`，无 quay@quay / quay@quay-dev 污染）。重复 3 次读数一致：

```
after: slash_commands quay: = 19 ; has quay:SKILL = false ; skills quay: = 19
```

### 前后对比（同一方法，before = 把 develop 版 plugin.json（含 commands[]）放进副本）
```
before: slash_commands quay: = 20 ; has quay:SKILL = true  ; skills quay: = 19
after : slash_commands quay: = 19 ; has quay:SKILL = false ; skills quay: = 19
```
前后差恰为 1 项、且正是 `quay:SKILL`。`quay:SKILL` 的 SKILL-like 命中：before `[\"quay:SKILL\"]` → after `[]`。

- 13 个 SKILL.md skill（after 全部仍在 `skills` 中）：`quay:cold-start, quay:drivers, quay:execute, quay:init, quay:loop-driver, quay:manager, quay:quay-directive, quay:quay-file-task, quay:quay-native-methodology, quay:quay-task-operator, quay:quay-task-to-plan, quay:quay-webui-bootstrap-methodology, quay:routines`。
- 其余 6 个 `quay:` 项来自 `plugin/workflows/*.js`（`run-routines, fan-in-execute, pool-quality-judge, manager-tick-core, drain-directives, execute-suite-fix`），是插件 workflow 面，非 SKILL.md、非重名，与本改动无关；本版 Claude Code 把它们与 skill 同列进 init 的 `skills` 字段（故原始计数为 19 而非 13）。

### 附带改动
- `plugin.json` 是 quay-init laydown 源，改其内容使 closure-ratchet 指纹过期；`--gate` 判为 **shrink-only**（footprint 未增：3 files / 1022 bytes ≤ 基线），按 pre-commit 守卫指引 `--reanchor` 并把新基线 `docs/analysis/quay-init-closure-ratchet.baseline.json` 纳入提交。
- `plugin/test/plugin-packaging.test.mjs`：原「13 bundled skills」测试断言 `manifest.commands`；已改为断言 `'commands' in manifest === false`（防回归）+ 磁盘 `plugin/skills/` 恰为 13 个目录。该文件 37 测试在 `test.sh` 的 dist 构建+mirage 环境下全绿。

2026-10-05 交互式实测（Claude Code v2.1.289，cd /tmp 后 `claude --settings '{"enabledPlugins":{"quay@quay":false,"quay@quay-dev":false}}' --plugin-dir /tmp/quay-plugin-exp/<副本>` 再输入 /quay，人 yale 读数）：
| 副本 | commands | init 的 name | /quay 里 init 次数 | 显示 |
| before | 有 | quay-init | 2 | /quay:quay-init (quay-init) |
| cmdonly | 无 | quay-init | 1 | /quay:quay-init (quay-init) |
| nameonly | 有 | init | 2 | /quay:init |
| after | 无 | init | 1 | /quay:init |
结论：有 commands 数组的两份 init 都出现 2 次，没有的都只出现 1 次，与 name 无关 ⇒ 重名由 commands 数组造成，本任务成立。未解释项：每份截图只有两行，未能确认其它 skill 是否也被 commands 重复，但本任务删除整个数组，不依赖此答案。警示：`claude -p` init 消息里的 slash_commands 只反映 quay:SKILL 是否存在，不反映交互补全里的 init 重名，故以交互读数为准。副本在 /tmp/quay-plugin-exp/，可能已被清理。
落地顺序：本任务与 gap-skill-frontmatter-name-align-dirname-for-slash-form 都改 plugin/.claude-plugin/plugin.json，建议本任务先落地。
