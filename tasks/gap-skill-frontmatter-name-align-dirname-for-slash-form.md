---
id: gap-skill-frontmatter-name-align-dirname-for-slash-form
title: skill 的 frontmatter name 与目录名不一致，导致补全显示/输入形态不是 /quay:init 这样的统一形式
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
人（yale，2026-10-05）的要求：在 Claude Code CLI 中，提示和输入都应是 `/quay:init` 这样的形式。现状：`plugin/skills/` 下 5 个 skill 的 frontmatter `name:` 与目录名不一致——init→`quay-init`、drivers→`quay-drivers`、cold-start→`quay-cold-start`、loop-driver→`quay-loop-driver`、manager→`quay-manager`。交互式补全（Claude Code v2.1.289）按 frontmatter name 显示为 `/quay:quay-init (quay-init)`，而 `claude -p` 的 slash_commands 里是 `/quay:init`，两种形态并存；调用统计里 `quay:drivers`、`quay:cold-start` 与 `quay-drivers` 也因此分裂。官方文档称 plugin skill 的 frontmatter `name` 替换目录名作命令末段。修复：把这 5 个 SKILL.md 的 `name:` 改成与目录名一致（init、drivers、cold-start、loop-driver、manager）；其余 8 个本来一致，不动。同步全仓库对旧名的引用：`plugin/.claude-plugin/plugin.json` 的 description 里列的 `quay-cold-start`、`quay-drivers`，以及 grep 到的 `quay:quay-init`、`quay-cold-start`、`quay-loop-driver`、`quay-manager`、`quay-drivers` 等对 skill 的引用（Skill 调用、文档、检查器、测试；注意区分 skill 名与 CLI 命令 `quay driver`、脚本名、文件名等同形字面量，只改指 skill 的）。packages/quay-native/skills/execute 已是 name: execute，不动；plugin/skills/execute 由 plugin/scripts/sync-vendor.sh 从 quay-native 镜像，勿手改。Touches 含多个 SKILL.md，改前先 grep `name:` 相关检查器（如 allowed-tools-plugin-prefix-check.ts、capability-catalog 等）确认无把旧名钉死的断言。

<!-- dedup-ref -->
可追溯说明：gap-plugin-json-commands-array-duplicates-skills 也改动 `plugin/.claude-plugin/plugin.json`，两者同文件，最好顺序落地以免合并冲突（仅作提示，不构成本任务的前置声明）。

## AC
- [ ] `for d in plugin/skills/*/; do n=$(basename $d); grep -q "^name: $n\$" $d/SKILL.md || echo MISMATCH $n; done` 无任何输出。
- [ ] 在临时目录用 `claude -p "hi" --plugin-dir <plugin副本> --output-format stream-json --verbose --max-turns 1`，init 消息里 `slash_commands` 与 `skills` 中 quay: 开头的项都不含 `quay:quay-init`/`quay:quay-drivers`/`quay:quay-cold-start`/`quay:quay-loop-driver`/`quay:quay-manager`；贴出清单。
- [ ] `grep -rnE 'quay:quay-(init|drivers|cold-start|loop-driver|manager)|"?quay-(cold-start|loop-driver|manager)"?' plugin packages orchestration docs --include=*.md --include=*.ts --include=*.json --include=*.sh --include=*.mjs`（排除 node_modules、archive、tasks）的每条命中被逐条归类为「已更新」或「非 skill 引用（说明原因）」，贴出命中数与前 3 条（规则 5b）。
- [ ] `claude plugin validate ./plugin` 含 `Validation passed`。
- [ ] `scripts/test.sh --for-task gap-skill-frontmatter-name-align-dirname-for-slash-form` 退出码 0。

## DoD
真实落地：交互式 Claude Code 中输入 `/quay:` 补全，init、drivers、cold-start、loop-driver、manager 均以 `/quay:init` 这样的形式显示与输入（人 yale 在交互界面截图确认，该项属人工关卡）（待外部）。机械侧以 claude -p init 消息读数为证。

## Touches
- plugin/skills/init/SKILL.md
- plugin/skills/drivers/SKILL.md
- plugin/skills/cold-start/SKILL.md
- plugin/skills/loop-driver/SKILL.md
- plugin/skills/manager/SKILL.md
- plugin/.claude-plugin/plugin.json
- tasks/gap-skill-frontmatter-name-align-dirname-for-slash-form.md
（执行者须补上 grep 命中的其它引用文件与对应测试文件。）
