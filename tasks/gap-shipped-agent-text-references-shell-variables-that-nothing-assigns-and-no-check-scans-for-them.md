---
id: gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them
title: 发布版 workflow 与 skill 里发给 agent 的命令引用了无人赋值的大写 shell
  变量，且没有任何机械检查会发现这一类（CLAUDE_PLUGIN_ROOT 只是其中一个）
status: todo
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**背景(人 2026-10-06 同意)**:`CLAUDE_PLUGIN_ROOT` 在普通会话里不存在、却被写进 workflow 发给 agent 的命令(见任务 gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions,在飞)。人问"其它环境变量是否有类似问题",并同意把它做成**机械检查**而不是靠人再读一遍。

**已读到的现状(2026-10-06,已安装 0.16.0 缓存的扫描,非穷尽)**:
1. 缓存里 `CLAUDE_PLUGIN_ROOT` 出现在 80 个文件、221 处;在 `workflows/*.js` 中:fan-in-execute 20、pool-quality-judge 4、execute-suite-fix 3、manager-tick-core 2。
2. 其它 `CLAUDE_*` 变量:`CLAUDE_CODE_MESSAGING_SOCKET`/`_TOKEN`(`scripts/dist/send-to-session.js:8961-8962`)缺失时有具名报错(不属同类);`CLAUDE_CODE_SESSION_ID`/`CLAUDE_CODE_CHILD_SESSION`(`runtime-usage-inventory.js:932`)只用于可选排除。普通会话及其 subagent 的 Bash 里实测只有 11 个 `CLAUDE_*` 变量(CLAUDE_AGENT_SDK_VERSION、CLAUDE_CLI_PATH、CLAUDE_CODE_* 等),`CLAUDE_PLUGIN_ROOT`、`CLAUDE_PROJECT_DIR`、`QUAY_PLUGIN_ROOT` 均为 UNSET。
3. **同类嫌疑(未证实)**:`skills/*/SKILL.md` 与 `loop/*.md` 的面向 agent 文本里,有大写变量被引用但同文本内**从未赋值**:`$FORK_BASELINE`(86 次)、`$MERGE_TARGET`(52)、`$REPO_ROOT`(20)、`$WORKTREE_ROOT`(12)、`$TMUX_SESSION`(9)、`$TEST_COMMAND`(7)、`$QUAY_GLOBAL_DIR`(2)、`$QUAY_CLAIM_REMOTE`(2)。它们可能只是给模型读的占位符,也可能被放进 bash 执行;**未逐处读上下文,无法判定**。
4. 没有任何现有检查会发现"发给 agent 的 bash 里有无人赋值的变量":展开为空串时失败形态与"文件不存在"同形(硬规则 3b)。

**修法**:新增一个**测试形态**的机械检查(⛔ 不新增 `plugin/scripts/*.ts`,以免触发 capability-catalog 六张表的登记负担;若以后要提升为检查器另案):
(A) workflow 部分:沿用现有真实调用 harness(`plugin/test/helpers/fan-in-execute-paths-harness.mjs`,以及 `plugin/test/execute-suite-fix-scope-gate.test.mjs`、`plugin/test/manager-tick-core.test.mjs` 里 vm 执行 workflow 的做法;⛔ 本任务不修改这些 harness 文件,只复用/参照),对 fan-in-execute、execute-suite-fix、pool-quality-judge、manager-tick-core 四个 workflow 捕获其发出的全部 agent prompt,从 prompt 里的 bash 代码中提取 `$NAME`/`${NAME}`(大写、长度≥3),剔除 ①同一命令块内此前已赋值的(`NAME=`、`for NAME in`、`read NAME`、`local NAME`、`export NAME=`);②shell 特殊参数(`$1`、`$$`、`$?`、`$@`、`$#`);③"已知由宿主注入"的白名单。白名单的每一项必须带注释说明来源,且来源须是**实测**(在普通会话 subagent 的 Bash 里 `env` 的读数),⛔ 不得凭记忆添加。其余出现的变量 ⇒ 测试红并逐条列出(变量名、所在 workflow、所在行片段)。
(B) skill/loop 文本部分:只检查 ``` 围栏的 bash 代码块(⛔ 不检查散文),规则同上;散文里的占位符另行计数并作为**信息读数**输出(不判红),避免把占位符误判为缺陷。无法解析某文件时输出 `NOT-EVALUATED` 与原因,⛔ 不与"零命中"同形。
(C) 完成记录里对第 3 点列出的八个变量逐个给出结论:占位符(附上下文证据)/ 在 bash 中被使用(附命令与修法)。

**不在范围**:修复 `CLAUDE_PLUGIN_ROOT`(另一个任务在飞,本任务不改 workflow 源码也不改构建);修复 (C) 中发现的任何缺陷(发现即另立任务,附证据);`.sh` 脚本里的环境变量读取(本任务只扫发给 agent 的文本)。

<!-- dedup-ref -->相关(追溯,非前置):gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions(在飞,修 CLAUDE_PLUGIN_ROOT;本任务与它的 Touches 无重叠,不共享测试文件);gap-dist-rewrite-injects-live-interpolation-into-workflow-js(done,只修加载期)。

## Touches
- `plugin/test/shipped-agent-text-unbound-vars.test.mjs`
- `tasks/gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them.md`

## AC
- [ ] 新增 `plugin/test/shipped-agent-text-unbound-vars.test.mjs`,对四个 workflow(fan-in-execute、execute-suite-fix、pool-quality-judge、manager-tick-core)用真实调用 harness 捕获发出的 prompt,提取 bash 中未赋值的大写变量并与白名单比对;`node --experimental-strip-types --test plugin/test/shipped-agent-text-unbound-vars.test.mjs` 退出 0。测试输出必须打印本次提取到的未赋值变量总数与前 3 条,证明谓词对真样本命中(硬规则 2);零命中必须同时打印"谓词对已知真样本的干跑结果"。
- [ ] 取假:向被扫文本注入一个故意未赋值的变量(如在夹具 prompt 里加 `echo $UNBOUND_PROBE_VAR`)后测试红并指名该变量;去掉注入后恢复绿(附两次实跑输出)。另做第二个取假:把一个白名单项从白名单删除后,依赖它的文本使测试红。
- [ ] 白名单实证:每个白名单变量在完成记录里附"在普通会话 subagent 的 Bash 里 `env | grep ^NAME=` 的原始读数";白名单里不得出现 `CLAUDE_PLUGIN_ROOT`(它应由另一任务消除,在其落地前本测试允许对它单独标记为已知缺陷并列出,而不是静默放过)。
- [ ] skill/loop 部分:只扫围栏 bash 代码块;对无法解析的文件输出 `NOT-EVALUATED` 与原因;散文占位符计数作为信息读数打印(不判红)。
- [ ] 完成记录里对 `FORK_BASELINE`、`MERGE_TARGET`、`REPO_ROOT`、`WORKTREE_ROOT`、`TMUX_SESSION`、`TEST_COMMAND`、`QUAY_GLOBAL_DIR`、`QUAY_CLAIM_REMOTE` 八个变量各给出一行结论(占位符,附上下文;或在 bash 中被使用,附命令);凡属后者,另立任务并附证据,本任务不修。
- [ ] `bash scripts/test.sh --for-task gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:对已安装/待发布的真实 workflow 与 skill 文本运行该检查,得到一份"无人赋值变量"的真实清单(含对八个嫌疑变量的逐个结论),且检查能对注入的未赋值变量变红;零命中读数同时附有对真样本的干跑证明。仅 fixture 绿不算完成。
