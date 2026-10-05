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
`plugin/.claude-plugin/plugin.json` 的 `commands` 数组列了 13 条 `./skills/<x>/SKILL.md`，而 `plugin/skills/` 目录本来就被 Claude Code 自动扫描为 skill（官方文档 plugins-reference：`commands` 指向「扁平 .md 命令文件」并替换默认 `commands/` 扫描；`skills/` 总是自动扫描）。结果每个 skill 既作 skill 又作 command 注册，文件名都叫 SKILL，于是补全里出现 `quay:SKILL` 且名字重复。2026-10-05 实测（claude -p --plugin-dir，对比副本）：删掉 `commands` 后 slash_commands 由 14 项降为 13 项，`quay:SKILL` 消失，13 个 skill 全部保留，`claude plugin validate` 通过。修复：删除 `plugin.json` 的 `commands` 数组，仅靠 `skills/` 自动发现；`plugin/commands/` 目录不存在，故不丢默认命令。同时核对仓库内是否有检查器/测试/文档把 `commands` 数组当必须字段（grep `"commands"` 于 plugin/scripts、plugin/test、packages/quay/scripts 的 plugin.json 相关检查），一并改。注：本机同时启用了 quay@quay（用户级）与 quay@quay-dev（项目级）造成的整批重名是另一个原因，已在本机 `.claude/settings.local.json` 单独处理，不在本任务范围。

## AC
- [ ] `node -e 'const j=require("./plugin/.claude-plugin/plugin.json");process.exit("commands" in j?1:0)'` 退出码 0（commands 键已不存在）。
- [ ] `claude plugin validate ./plugin` 输出含 `Validation passed`（若 agents 路径等无关错误，说明并贴出原文）。
- [ ] 在临时目录 `claude -p "hi" --plugin-dir <plugin副本> --output-format stream-json --verbose --max-turns 1` 的 init 消息中，`slash_commands` 里以 `quay:` 开头的项不含 `quay:SKILL`，且 `skills` 里 quay: 开头的项仍为 13 个；贴出两个计数。
- [ ] `grep -rn '"commands"' plugin/scripts plugin/test packages/quay/scripts --include=*.ts --include=*.mjs --include=*.sh` 的命中逐条列出，说明无一把 plugin.json 的 commands 数组当必需字段（或已同步修改）。
- [ ] `scripts/test.sh --for-task gap-plugin-json-commands-array-duplicates-skills` 退出码 0。

## DoD
真实落地：`/quay:` 补全中不再出现 `quay:SKILL`，且 13 个 skill 仍可用斜杠调用（以 claude -p init 消息的实读计数为证，不是 fixture）。修复后重新跑一次上述 init 读数，贴在任务 Notes。

## Touches
- plugin/.claude-plugin/plugin.json
- tasks/gap-plugin-json-commands-array-duplicates-skills.md
（执行者须在 Touches 补上 grep 命中的检查器/测试文件；若无命中则保持以上两项。）
