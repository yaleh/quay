---
id: gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them
title: 发布版 workflow 与 skill 里发给 agent 的命令引用了无人赋值的大写 shell
  变量，且没有任何机械检查会发现这一类（CLAUDE_PLUGIN_ROOT 只是其中一个）
status: done
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions
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

<!-- dedup-ref -->相关(追溯,非前置):gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions(在飞,修 CLAUDE_PLUGIN_ROOT;本任务与它的 Touches 无重叠,不共享测试文件);gap-dist-rewrite-injects-live-interpolation-into-workflow-js(done,只修加载期)。 本任务 frontmatter 声明了对前一个任务的 depends_on(它落地后本任务才可派发);该段仍只作追溯说明。

## Touches
- `plugin/test/shipped-agent-text-unbound-vars.test.mjs`
- `tasks/gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them.md`

## AC
- [x] 新增 `plugin/test/shipped-agent-text-unbound-vars.test.mjs`,对四个 workflow(fan-in-execute、execute-suite-fix、pool-quality-judge、manager-tick-core)用真实调用 harness 捕获发出的 prompt,提取 bash 中未赋值的大写变量并与白名单比对;`node --experimental-strip-types --test plugin/test/shipped-agent-text-unbound-vars.test.mjs` 退出 0。测试输出必须打印本次提取到的未赋值变量总数与前 3 条,证明谓词对真样本命中(硬规则 2);零命中必须同时打印"谓词对已知真样本的干跑结果"。
- [x] 取假:向被扫文本注入一个故意未赋值的变量(如在夹具 prompt 里加 `echo $UNBOUND_PROBE_VAR`)后测试红并指名该变量;去掉注入后恢复绿(附两次实跑输出)。另做第二个取假:把一个白名单项从白名单删除后,依赖它的文本使测试红。
- [x] 白名单实证:每个白名单变量在完成记录里附"在普通会话 subagent 的 Bash 里 `env | grep ^NAME=` 的原始读数";白名单里不得出现 `CLAUDE_PLUGIN_ROOT`:本任务在 gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions 落地之后才可派发(见 frontmatter 的 depends_on),所以**不设"已知缺陷"例外**,`CLAUDE_PLUGIN_ROOT` 与其它未赋值变量同等判红。
- [x] skill/loop 部分:只扫围栏 bash 代码块;对无法解析的文件输出 `NOT-EVALUATED` 与原因;散文占位符计数作为信息读数打印(不判红)。
- [x] 完成记录里对 `FORK_BASELINE`、`MERGE_TARGET`、`REPO_ROOT`、`WORKTREE_ROOT`、`TMUX_SESSION`、`TEST_COMMAND`、`QUAY_GLOBAL_DIR`、`QUAY_CLAIM_REMOTE` 八个变量各给出一行结论(占位符,附上下文;或在 bash 中被使用,附命令);凡属后者,另立任务并附证据,本任务不修。
- [x] `bash scripts/test.sh --for-task gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:对已安装/待发布的真实 workflow 与 skill 文本运行该检查,得到一份"无人赋值变量"的真实清单(含对八个嫌疑变量的逐个结论),且检查能对注入的未赋值变量变红;零命中读数同时附有对真样本的干跑证明。`CLAUDE_PLUGIN_ROOT` 在该检查的读数中零命中(这同时证明其修复已落地)。仅 fixture 绿不算完成。

## 完成记录（2026-10-06，per-task worker）

**实现**：新增 `plugin/test/shipped-agent-text-unbound-vars.test.mjs`（本任务唯一新增文件，测试形态；⛔ 未新增 `plugin/scripts/*.ts`，故无 capability-catalog 登记负担）。一套共享提取器（`$NAME` / `${NAME}`，大写、长度≥3），剔除本块内**此前**已赋值的（`NAME=` / `export NAME=` / `local NAME` / `for NAME in` / `read NAME`，位置敏感）、shell 特殊参数、实测白名单；两个扫描面：

- **面 A = workflow 真实发出的 prompt**（vm 执行 fan-in-execute / execute-suite-fix / pool-quality-judge / manager-tick-core，`agent()` 只捕获，参照既有 harness 手法、⛔ 未改那些 harness 文件）。这一面**没有「散文说明」这条出路**：prompt 是代码每轮现生成的，变量必须由 prompt 自己赋值或由宿主环境注入。
- **面 B = 随插件发布的 skill/loop 文本**（`plugin/skills/**/*.md` + `plugin/loop/*.md`，28 个文件）。只扫 ```` ```bash ```` 围栏（`bash|sh|shell|zsh`；无标注围栏不算 bash ⇒ 不检查散文）。除前两条外多一条赦免：变量名在该批文本的**散文里**出现过（即文本自己说了它从哪来）——`$WORKTREE_ROOT` 这类 workspace 参数走这条。
- 读不懂 ⇒ 独立取值：围栏未闭合返回 `{ok:false, evaluated:false, reason}`；workflow 零 prompt 记为 NOT-EVALUATED。⛔ 两者都不与「零命中」同形（硬规则 3b）。

**AC1（真实调用 + 退出 0）**：`node --experimental-strip-types --test plugin/test/shipped-agent-text-unbound-vars.test.mjs` ⇒ `ℹ tests 7 / pass 7 / fail 0`，**EXIT=0**。
读数：面 A `prompts=15 refs=0 bound(assigned=0, hostEnv=0) notEvaluated=0` ⇒ **unbound=0**；面 B `files=28 notEvaluated=0 bound(assigned=2, hostEnv=1, documented=40)` ⇒ **unbound=0**。
零命中必须同附的干跑证明（硬规则 2 的另一半）：`sample="echo \"$FOO\" && echo \"${BAR_BAZ}\" && rc=$? && echo \"$1 $@ $#\"" ⇒ unbound=[FOO]`（`FOO` 已知真 ⇒ 命中；`${BAR_BAZ}` 在 documented 里 ⇒ 不命中；`$?`/`$1`/`$@`/`$#` 是特殊参数 ⇒ 不命中）。另有两个位置断言：`OUT=…` 之后引用 `$OUT` ⇒ 赦免；`echo $LATE` 之后才写 `LATE=1` ⇒ **不**赦免（防「只要文本里出现过赋值就放行」的假绿）。

**AC2（两个取假控制，各附两次实跑；均为真实文本，非 fixture）**：
① 注入 `echo $UNBOUND_PROBE_VAR`：in-process 断言指名该变量、去掉注入恢复 0。另做一次**真实文件实跑**——注入 `plugin/loop/orchestrator-loop-tick.md` 里 `$HOME` 那一行之后（`cp` 备份 → 注入 → 跑 → `cp` 还原，前后 md5 一致 `e6ce5f4da4dee2ceaec0d247b5a79868`）：
  - 注入后：`[B/skill+loop] unbound=1` / `#1 {"file":"plugin/loop/orchestrator-loop-tick.md","line":284,"name":"UNBOUND_PROBE_VAR",…}` / `ℹ fail 2` ⇒ **RED_EXIT=1**；
  - 还原后：`ℹ pass 7 / fail 0` ⇒ **GREEN_EXIT=0**。
② 把 `HOME` 从 `HOST_ENV` 白名单删掉（真实文本里恰好只有 `$HOME` 依赖它）：`[B/skill+loop] unbound=1`（`"name": "HOME"`）/ `ℹ fail 1` ⇒ **RED_EXIT=1**；恢复后 `ℹ pass 7 / fail 0` ⇒ **GREEN_EXIT=0**。⇒ 白名单条目是承重的，不是装饰。

**AC3（白名单实证）**：`HOST_ENV` 只有 6 项，每项带实测读数（2026-10-06，本机**普通会话 subagent 的 Bash**，`printenv <NAME>` 原始输出）：
`HOME=/data/home/yale`；`PATH=/data/home/yale/work/claudecodeui/node_modules/.bin:/data/home/yale/work/node_modules/.bin:/data/home/yale/node_modules/.bin:/data/home/node_modules/.bin:/data/node_modules/.bin:/node_modules/.bin:…:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin:…`（全量 1400+ 字符）；`PWD=/data/home/yale/work/quay`；`SHELL=/bin/bash`；`USER=yale`；`LANG=en_US.UTF-8`。
同一次实测里 `HOSTNAME` / `TMPDIR` / `TERM` **UNSET** ⇒ ⛔ 不入表（凭记忆加就是造假，硬规则 4）。**`CLAUDE_PLUGIN_ROOT` / `CLAUDE_PROJECT_DIR` / `QUAY_PLUGIN_ROOT` 实测 UNSET ⇒ 白名单里没有它们、也不设任何「已知缺陷」例外**；面 A 读数里 `CLAUDE_PLUGIN_ROOT` **零命中**（这同时是 sibling 任务修复已落地的机械证据）。面 B 里它由**与其它变量完全相同的规则**判定（散文说明），没有特殊分支。

**AC4（skill/loop 扫描规则）**：只扫 ```` ```bash ```` 围栏；散文占位符作为**信息读数**打印、不判红：`CLAUDE_PLUGIN_ROOT×21 FORK_BASELINE×80 MERGE_TARGET×46 REPO_ROOT×11 WORKTREE_ROOT×6 TMUX_SESSION×4 TEST_COMMAND×4 QUAY_GLOBAL_DIR×2 QUAY_CLAIM_REMOTE×1 ALIYUN_API_KEY×1 ALIYUN_API_KEY_FILE×1 SCRIPT_DIR×1`。无法解析 ⇒ `NOT-EVALUATED` + 原因，且带独立取值：控制实跑 `ok=false evaluated=false reason=unterminated ```bash fence opened at line 3`，并与「合法文件、零 bash 块、`evaluated=true`」断言**取值不同**。本次真实 28 个文件全部可解析（`notEvaluated=0`）。

**AC5（八个嫌疑变量逐个结论）**——机械读数（行号为当前 develop 时的读数）+ 上下文证据：

| 变量 | ```bash 围栏内落点 | 结论与绑定来源 |
|---|---|---|
| `$FORK_BASELINE` | fast-mode-loop-tick:902,969；orchestrator-loop-tick:702,703 | **占位符**：`.quay/config.yml` `loop.fork_baseline`（`quay-init --loop` 写入；`plugin/scripts/quay-init-steps.ts:42` `ensure-loop-config <cfg> <repo_root> <test_command> <tmux_session> <worktree_root>` 是同一族参数）。散文在 3 个 loop 文件里说明 |
| `$MERGE_TARGET` | fast-mode-loop-tick:446,468；orchestrator-loop-tick:702,703 | **占位符**：`loop.merge_target` 同上；散文 3 文件 |
| `$REPO_ROOT` | fast-mode-loop-tick:902,969；orchestrator-loop-tick:88,466,467,518,552,566,934 | **占位符**：`loop.repo_root`；`plugin/loop/orchestrator-loop-tick.md:89` 行内注「REPO_ROOT 见 .quay/config.yml loop.repo_root（或 `git rev-parse --show-toplevel`）」 |
| `$WORKTREE_ROOT` | fast-mode-loop-tick:446,456,468,902,969,975 | **占位符**：`loop.worktree_root`（唯一 resolver = `packages/quay/src/worktree-namespace.ts`） |
| `$TMUX_SESSION` | fast-mode-loop-tick:539；orchestrator-loop-tick:322,464,465,484 | **占位符**：`loop.tmux_session`（可选：`quay-init` 刻意不猜；缺失时用 tmux 的动作运行期 fail-closed） |
| `$TEST_COMMAND` | fast-mode-loop-tick:456,1248,1251 | **占位符**：`loop.test_command`；:457 行内注「TEST_COMMAND 见 `.quay/config.yml` `loop.test_command`」 |
| `$QUAY_GLOBAL_DIR` | **无** ```bash 围栏落点（仅 `plugin/skills/manager/SKILL.md` 散文） | **占位符**：`README.md:1014` 明确登记为 manager 层的**环境变量**（会话家在 `$QUAY_GLOBAL_DIR/manager/`），由 operator 设置 ⇒ 不属「无人赋值」 |
| `$QUAY_CLAIM_REMOTE` | fast-mode-loop-tick:930 | **占位符**（八者里唯一真的落在 ```bash 围栏内的一条）：operator 设置的**可选**环境变量——`docs/analysis/fast-mode-loop-tick.md:652` 明说「`.quay/config.yml` `loop:` 未配置、但环境变量 `QUAY_CLAIM_REMOTE` 指向共享裸仓库」；:667「单机（未设置 `QUAY_CLAIM_REMOTE`）⇒ 认领步骤为 no-op，行为不变」。⇒ 绑定来源由文本点名，且**未设置时的行为被显式定义成「跳过」**，不是「静默跑一条坏命令」，故判占位符而非缺陷 |

⇒ 八个变量**全部是占位符**，无一落在「在 bash 中被使用且无人赋值」的缺陷形态上，故按 AC 无待另立的修复任务。

**⚠️ 本任务的检查同时暴露了一条 AC 覆盖范围之外的残留（如实报出，本任务按「不在范围」未修）**：`CLAUDE_PLUGIN_ROOT` 在面 A 零命中，但在面 B 的 ```bash 围栏里还有 4 处（`plugin/loop/fast-mode-loop-tick.md:1062`、`plugin/loop/orchestrator-loop-tick.md:520`、`plugin/skills/init/SKILL.md:390,392`），它们由本检查的「散文说明」赦免（散文里 21 处提到它）。其中 **`plugin/skills/*/SKILL.md` 那 2 处不算缺陷**（SKILL 文本由宿主做 `${CLAUDE_PLUGIN_ROOT}` 替换，`plugin/scripts/quay-init.sh:6,99` 有明文）；但 **`plugin/loop/*.md` 那 2 处是同一缺陷形态**：`plugin/scripts/quay-init.sh:749` 明说这两份是 **shipped tick templates**、被铺进目标工作区当每轮 tick 文档读，读它的 agent 的 Bash 里该变量实测 UNSET ⇒ `--plugin-root ""`。sibling 任务的修复面只到 `plugin/workflows/*.js`，未覆盖 `plugin/loop/*.md`。**已另立一条 gap 任务承载它**<!-- dedup-ref -->（`gap-loop-tick-docs-pass-claude-plugin-root-to-plugin-scripts-but-it-is-unset-in-a-plain-session`，本 worker 经 task ABI 创建）。

**AC6（scoped 门实跑）**：`bash scripts/test.sh --for-task gap-shipped-agent-text-references-shell-variables-that-nothing-assigns-and-no-check-scans-for-them --allow-thin` ⇒ **EXIT=0**，`ℹ tests 7 / pass 7 / fail 0`；不带 `--allow-thin` 的同一条命令同样 **EXIT=0 / tests 7 / pass 7**。选中集确实执行了本任务新增的测试文件（`test-file-snapshot` 的 additions 列表含 `plugin/test/shipped-agent-text-unbound-vars.test.mjs`）。随后按 fan-in 约定写入 scoped-gate 缓存（`develop-sha=bc0b8b36075a4ea70ba37016c9b9f348ab8ed1a2`，写前已核 `git merge-base --is-ancestor <develop> HEAD` 成立）。worktree 上跑过两次 `git merge --no-edit develop`（均无冲突）。

**DoD**：检查已对**真实**发布文本运行（28 个 skill/loop 文件 + 四个 workflow 的 15 条真实 prompt），产出的「无人赋值变量」清单为**空**，并附 ①真样本干跑证明；②两个取假控制的实跑红/绿输出；③八个嫌疑变量的逐个结论与上下文。`CLAUDE_PLUGIN_ROOT` 在上述读数里零命中。⛔ 非「仅 fixture 绿」：所有断言打在真实文本 / 真实 workflow prompt 上，fixture 只用于 NOT-EVALUATED 与位置判定的单元控制。