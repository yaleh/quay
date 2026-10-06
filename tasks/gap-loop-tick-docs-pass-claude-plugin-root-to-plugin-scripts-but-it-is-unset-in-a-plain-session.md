---
id: gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session
title: plugin/loop 的 tick 文档让 agent 跑 `--plugin-root
  "$CLAUDE_PLUGIN_ROOT"`，而该变量在普通会话的 Bash 里 UNSET（sibling 任务只修到了
  plugin/workflows/*.js）
status: ready
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
---
## Finding
**发现者**：worker 任务 gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them 的机械检查 `plugin/test/shipped-agent-text-unbound-vars.test.mjs`（2026-10-06）。

**实测读数**（2026-10-06，本机普通会话 subagent 的 Bash）：
- `printenv CLAUDE_PLUGIN_ROOT` ⇒ UNSET（`CLAUDE_PROJECT_DIR`、`QUAY_PLUGIN_ROOT` 同样 UNSET）。同批实测存在的只有 HOME/PATH/PWD/SHELL/USER/LANG。
- 该检查在 **workflow 面 0 命中**（sibling 任务 gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions 的修复已落地），但在随插件发布的 loop tick 文档的 ```bash 围栏里仍有 2 处：`plugin/loop/fast-mode-loop-tick.md:1062`、`plugin/loop/orchestrator-loop-tick.md:520`，两处都是 `--plugin-root "$CLAUDE_PLUGIN_ROOT" \`。

**为什么这是缺陷而非占位符**：这两份文档不是散文——`plugin/scripts/quay-init.sh:749` 明说它们是 **shipped tick templates**，被铺进目标工作区当作每轮读的 tick 文档（`orchestration/<name>` 落地点）。读它的 agent 在自己的 Bash 里跑这条命令时该变量为空 ⇒ `--plugin-root ""`，与 sibling 任务修掉的那一类**完全同形**（展开成空串，失败形态与「文件不存在」同形，硬规则 3b）。
对照：同一检查里 `plugin/skills/*/SKILL.md` 的 `${CLAUDE_PLUGIN_ROOT}` **不算缺陷**（SKILL 文本由宿主做替换，`plugin/scripts/quay-init.sh:6,99` 有明文）——差别就在「这份文本是否由 skill 载入路径消费」。

**注意**：sibling 任务只改了 `plugin/workflows/*.js`；`plugin/loop/*.md` 不在它的 Touches 里，所以那两处是它**没有覆盖的残留**，不是它的回归。

## Touches
- `plugin/loop/fast-mode-loop-tick.md`
- `plugin/loop/orchestrator-loop-tick.md`
- `tasks/gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session.md`

## AC
- [ ] `plugin/loop/fast-mode-loop-tick.md` 与 `plugin/loop/orchestrator-loop-tick.md` 中不再出现 `$CLAUDE_PLUGIN_ROOT` / `${CLAUDE_PLUGIN_ROOT}` 作为交给 agent 执行的命令参数；替换形式必须让 agent 的 Bash 里能取到真实插件根（例如与这些文档里其它脚本调用同源的解析方式，或把 `--plugin-root` 交给脚本自解析而不再外部注入），⛔ 不得换成另一个同样未赋值的字面量。
- [ ] 取假/取真：`node --experimental-strip-types --test plugin/test/shipped-agent-text-unbound-vars.test.mjs` 在该修复前是绿的（因为 `CLAUDE_PLUGIN_ROOT` 走「散文说明」赦免），修复后**仍须绿**；本条的真实判据是「按 comm 精确匹配的 `grep -c 'CLAUDE_PLUGIN_ROOT' plugin/loop/*.md` 为 0」——先打印修复前该计数的前 3 条实际命中（硬规则 2），再证明修复后为 0。
- [ ] 落点映射：若两处替换删除了任何独有词条，按硬规则 5 产出「被删内容 → 新正本路径」的逐条映射并贴进提交。
- [ ] `bash scripts/test.sh --for-task gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session` 退出 0 且执行 ≥1 个测试文件。

## DoD
真实落地：两份 shipped tick 模板里交给 agent 的命令不再引用该未赋值变量；`grep -c` 的修复前/修复后两次读数与替换后的实际命令行贴进完成记录（仅改散文、把变量名换成另一个字面量都不算）。