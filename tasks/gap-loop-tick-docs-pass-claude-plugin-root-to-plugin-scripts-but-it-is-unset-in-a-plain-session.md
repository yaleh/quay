---
id: gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session
title: plugin/loop 的 tick 文档让 agent 跑 `--plugin-root
  "$CLAUDE_PLUGIN_ROOT"`，而该变量在普通会话的 Bash 里 UNSET（sibling 任务只修到了
  plugin/workflows/*.js）
status: done
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

## Test-Files
- `plugin/test/shipped-agent-text-unbound-vars.test.mjs`

## AC
- [x] `plugin/loop/fast-mode-loop-tick.md` 与 `plugin/loop/orchestrator-loop-tick.md` 中不再出现 `$CLAUDE_PLUGIN_ROOT` / `${CLAUDE_PLUGIN_ROOT}` 作为交给 agent 执行的命令参数；替换形式必须让 agent 的 Bash 里能取到真实插件根（例如与这些文档里其它脚本调用同源的解析方式，或把 `--plugin-root` 交给脚本自解析而不再外部注入），⛔ 不得换成另一个同样未赋值的字面量。
- [x] 取假/取真：`node --experimental-strip-types --test plugin/test/shipped-agent-text-unbound-vars.test.mjs` 在该修复前是绿的（因为 `CLAUDE_PLUGIN_ROOT` 走「散文说明」赦免），修复后**仍须绿**；本条的真实判据是「按 comm 精确匹配的 `grep -c 'CLAUDE_PLUGIN_ROOT' plugin/loop/*.md` 为 0」——先打印修复前该计数的前 3 条实际命中（硬规则 2），再证明修复后为 0。
- [x] 落点映射：若两处替换删除了任何独有词条，按硬规则 5 产出「被删内容 → 新正本路径」的逐条映射并贴进提交。
- [x] `bash scripts/test.sh --for-task gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session` 退出 0 且执行 ≥1 个测试文件。

## DoD
真实落地：两份 shipped tick 模板里交给 agent 的命令不再引用该未赋值变量；`grep -c` 的修复前/修复后两次读数与替换后的实际命令行贴进完成记录（仅改散文、把变量名换成另一个字面量都不算）。

## Evidence

**完成记录（2026-10-06，worker；分支 `task/gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session`，实现提交 `d5ccdfbf0`）**

### 实际改动（4 处，就地替换）

| # | 文件:行（修复后） | 上下文 |
|---|---|---|
| 1 | `plugin/loop/fast-mode-loop-tick.md:750` | 3.7 例常例行——调度（inline 命令） |
| 2 | `plugin/loop/fast-mode-loop-tick.md:763` | external-dogfooding `--surface` 校验（inline 命令） |
| 3 | `plugin/loop/fast-mode-loop-tick.md:1064` | §4b Routine due 判定（```bash 围栏） |
| 4 | `plugin/loop/orchestrator-loop-tick.md:522` | §1a 外层 Routine 检查（```bash 围栏） |

替换后的实际命令行（以 §4b/§1a 两处为准，文件其余部分不变）：

```
node --experimental-strip-types plugin/scripts/routine-scheduler.ts \
  --now "$(($(date +%s) * 1000))" \
  --last-run .quay/routine-last-run.json \
  --plugin-root "$(pwd)/plugin" \
  /tmp/routines-<tick>.json
```

**为什么是 `$(pwd)/plugin`**：这些 tick 文档把机制脚本按**仓库根相对路径**调用（`plugin/scripts/<name>`），所以插件根就是同一基准下的 `plugin/`；`$(pwd)/plugin` 由 shell 在命令里**现取**（绝对路径，无需手工代入占位符、也不依赖任何宿主环境变量），正是「与这些文档里其它脚本调用同源的解析方式」。这也与机制自身的约定一致——`quality-gate-driver.ts:1256`、`meta-driver.ts:2400` 都用 `path.join(root, "plugin")`，`quay-init --loop` 亦把脚本铺到 `<root>/plugin/scripts/`。

### AC2 取假/取真读数

修复前 `grep -c 'CLAUDE_PLUGIN_ROOT' plugin/loop/*.md`：`fast-mode-loop-tick.md:3`、`orchestrator-loop-tick.md:1`（其余 4 个文件 0）。前 3 条实际命中（硬规则 2）：

1. `plugin/loop/fast-mode-loop-tick.md:750:   \`node --no-warnings --experimental-strip-types routine-scheduler.ts --iteration <tick 计数> --event checkpoint --plugin-root "$CLAUDE_PLUGIN_ROOT" /tmp/routines-<tick>.json\``
2. `plugin/loop/fast-mode-loop-tick.md:762:AC1c，fail-closed）——派发前先 \`--selftest\` + \`--surface --plugin-root "$CLAUDE_PLUGIN_ROOT"\` +`
3. `plugin/loop/fast-mode-loop-tick.md:1062:  --plugin-root "$CLAUDE_PLUGIN_ROOT" \`

（第 4 条：`plugin/loop/orchestrator-loop-tick.md:520:  --plugin-root "$CLAUDE_PLUGIN_ROOT" \`。）

修复后：全部 6 个 `plugin/loop/*.md` 的 `grep -c` = 0（grep 退出码 1 = 零命中）。
检查器：`node --experimental-strip-types --test plugin/test/shipped-agent-text-unbound-vars.test.mjs` —— 修复前 7/7 pass，修复后 7/7 pass。

**取真**（真实读数，cwd = 仓库根）：`--plugin-root "$(pwd)/plugin"` ⇒ `/…/<worktree>/plugin`（绝对路径），其下 `probes/` 8 个文件、`scripts/` 381 个文件；实跑
`routine-scheduler.ts --now <epoch-ms> --last-run <json> --plugin-root "$(pwd)/plugin" /tmp/routines-evidence.json`
⇒ `DUE: self-validation (interval:60m) → probe self-validation`（exit 0）。

**取假（负控制，同一条命令、旧形态）**：宿主变量未赋值 ⇒ `--plugin-root ""` ⇒
`SKIP: self-validation (interval:60m) → routine "self-validation": probe requires pluginRoot but none provided`（exit 0）
——探针轨道**静默死掉**，输出与「本轮无 due」同形（硬规则 3b）。这就是修复前那两处的运行期行为。

### AC3 落点映射

**未删除任何独有词条。** 被替换的 `CLAUDE_PLUGIN_ROOT` 是**活词条**：修复后发布语料里仍有 16 个落点文件（`plugin/skills/{routines,init,loop-driver,quay-file-task,quay-directive,quay-task-operator}/SKILL.md` + `plugin/README.md` + `plugin/probes/external-dogfooding.md` 等）——那些是 SKILL 文本，由宿主替换，**不算缺陷**（见 Finding 的对照）。本次只是**就地替换该 token 的 4 处使用**，不是移除词汇表 ⇒「被删内容 → 新正本路径」映射**按构造为空**（无条目）。

### AC4 scoped 门

`bash scripts/test.sh --for-task gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session --allow-thin`
⇒ **exit 0**，执行 **1 个测试文件**（`plugin/test/shipped-agent-text-unbound-vars.test.mjs`，经本任务新增的 `## Test-Files` 声明进入选择集）。

⚠️ **诚实读数**：**不加 `--allow-thin` 时**选择器 `coverageRatio = 0/3`（3 个 Touches 条目都是文档，没有同名 `*/test/<basename>.test.mjs`）⇒ 退出 1（`test-selection-thin`）；测试仍会跑，但整体退出码为 1。`--allow-thin` 正是 driver 的 fan-in scoped 门所用形态——`.quay/config.yml` `loop.scoped_command` = `["bash","{worktree}/scripts/test.sh","--for-task","{task}","--allow-thin"]`。`## Test-Files` 是本仓库既有的「声明式补测」机制（`select-tests-for-touches.ts` 规则 4），用于 basename 配对看不见的覆盖关系。