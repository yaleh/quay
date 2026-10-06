---
id: gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions
title: 发布版 workflow 把 ${CLAUDE_PLUGIN_ROOT} 写进发给 agent 的命令，但该变量在普通会话里不存在——0.14.0
  加载即 ReferenceError，0.15.0+ 加载通过、运行期路径退化成 /scripts/dist/…；应改为把插件根作为
  args.pluginRoot 传入并写绝对路径
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
**人的裁定(2026-10-06)**:同意"不依赖环境变量,把插件根作为参数传进 workflow、命令里写绝对路径"的修法,优先处理。

**现象(2026-10-06,claudecodeui 工作区两个会话先后撞到)**:在普通 CloudCLI 会话里用 `Workflow({scriptPath: …/quay/0.14.0/workflows/fan-in-execute.js})` 派发 `quay:fan-in-execute`,16ms 即失败:`ReferenceError: CLAUDE_PLUGIN_ROOT is not defined at workflow.js:240`。结果:文档里"机械 fan-in 失败 ⇒ 续做 prompt 以 scriptPath 调本 workflow 兜底"在普通会话里不可达。

**机制(已读代码与缓存)**:
1. 开发树的 workflow 引用 `${worktree}/plugin/scripts/X.ts`(`plugin/workflows/fan-in-execute.js` 约 211、246、331-334、509 行);第三方项目的 worktree 里没有 `plugin/`,所以发布构建(`packages/quay/scripts/build-plugin-dist.mjs`)把这些引用改写成 `${CLAUDE_PLUGIN_ROOT}/scripts/dist/X.js`。
2. 0.14.0 的 `workflows/fan-in-execute.js` 含 13 处**活的** `${CLAUDE_PLUGIN_ROOT}` JS 模板插值,Workflow 沙箱没有该绑定 ⇒ 加载即 ReferenceError。已 done 的任务 gap-dist-rewrite-injects-live-interpolation-into-workflow-js(提交 96429beb8,2026-10-04,`JS_ROOT_ANCHOR = '${"$"}{CLAUDE_PLUGIN_ROOT}'`)把 0.15.0/0.16.0 改成 20 处不求值的拼写(活插值为 0)。
3. **残留(本任务要修)**:新拼写只让加载通过,发给 agent 的命令里仍是字面 `${CLAUDE_PLUGIN_ROOT}`(0.16.0 `fan-in-execute.js` 约 246、331、577-600、935-948 行,如 `node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/anti-drift-touches-check.js …`、`import … from "${CLAUDE_PLUGIN_ROOT}/…"`),留给 agent 的 shell 去展开。该变量只在 SKILL.md 文本替换、hooks、MCP 配置这几种上下文里有值。**实测(2026-10-06,本机 CloudCLI 普通会话)**:会话自己的 Bash 与其 subagent 的 Bash 里 `echo "${CLAUDE_PLUGIN_ROOT:-UNSET}"` 都是 `UNSET`(subagent 环境只有 CLAUDE_AGENT_SDK_VERSION、CLAUDE_CLI_PATH、CLAUDE_CODE_* 等 11 个 CLAUDE_ 变量)。workflow 源码里没有 `args.pluginRoot` 之类的注入。⇒ 命令里的路径会展开为空串,变成 `/scripts/dist/…`,到运行期才失败,且与"文件不存在"同形(硬规则 3b)。(此条路径退化是由上述读数推出的强推断,**尚未在真实派发中复现**;AC 要求实证。)
4. 同类写法还出现在 `plugin/workflows/execute-suite-fix.js`(3 处)、`pool-quality-judge.js`(4 处)、`manager-tick-core.js`(2 处)——其具体用法**尚未读**,按同类风险处理(硬规则 5b:缺陷成簇)。
5. 为什么没被发现:96429beb8 的验收只证明"加载不抛 ReferenceError",没有证明"路径在普通会话里解析得到"(硬规则 4c:判据只验了加载,没验运行)。

**修法**:
(A) workflow 入口接收 `args.pluginRoot`(调用方知道 `scriptPath`,插件根 = scriptPath 的上两级目录);脚本里定义真正的 JS 绑定(例如 `const PLUGIN_ROOT = args.pluginRoot`),发给 agent 的命令与内联 node 脚本里直接用 `${PLUGIN_ROOT}` 的**绝对路径**,不再生成字面 `${CLAUDE_PLUGIN_ROOT}`。
(B) 入口校验:`args.pluginRoot` 缺失、或 `<pluginRoot>/scripts/dist` 不存在 ⇒ 立即以稳定错误码 `plugin-root-not-provided`(缺参数)/`plugin-root-invalid`(目录不对)拒绝,⛔ 不得悄悄展开成空串。开发树形态(workflow 在仓库 `plugin/workflows/` 下运行)的缺省值可取 `${worktree}/plugin`,以保持开发路径不变。
(C) 构建改写:`build-plugin-dist.mjs` 对 `.js` 载体生成对该绑定的引用(而不是字面 `${CLAUDE_PLUGIN_ROOT}`);`.md`/`.sh` 载体保持原样(skill 文本替换仍有效)。
(D) 调用方文档:所有给出 `Workflow({scriptPath…})` 调用示例的位置(skill、续做 prompt 生成处)补上 `pluginRoot`;先 grep 确认这些位置,不要凭记忆。
(E) 同类的另外三个 workflow 按同样方式处理,或在读过其用法后记录"不受影响"的证据。

**不在范围**:driver 自己的机械 fan-in(它不经 workflow,不读该变量);`${CLAUDE_PLUGIN_ROOT}` 在 `.md`/`.sh`/MCP 配置里的合法用法;serve 独立 scope 任务。

<!-- dedup-ref -->相关(追溯,非前置):gap-dist-rewrite-injects-live-interpolation-into-workflow-js(done,只修了加载期);gap-manager-tick-core-hardcodes-quay-dev-root-silently-wrong-repo(同样涉及 manager-tick-core 的根路径)。

## Touches
- `packages/quay/scripts/build-plugin-dist.mjs`
- `plugin/workflows/fan-in-execute.js`
- `plugin/workflows/execute-suite-fix.js`
- `plugin/workflows/pool-quality-judge.js`
- `plugin/workflows/manager-tick-core.js`
- `packages/quay/test/build-plugin-dist.test.mjs`
- `plugin/test/fan-in-execute-plugin-root-arg.test.mjs`
- `plugin/test/fan-in-execute-paths-s01.test.mjs`
- `packages/quay/test/config-validate.test.mjs`
- `tasks/gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions.md`

## AC
- [x] 新增测试 `plugin/test/fan-in-execute-plugin-root-arg.test.mjs`,沿用 `fan-in-execute-paths-s0*.test.mjs` 的真实调用 harness(vm 执行构建产物 workflow 文件,mock workflow 运行时全局 args/phase/log/agent,捕获其发出的 agent prompt):用**构建出的发布版** `fan-in-execute.js`,传 `args.pluginRoot = <临时插件根,含 scripts/dist 目录>`,断言发出的全部 prompt/命令中 ①不含字面 `${CLAUDE_PLUGIN_ROOT}`;②不含以 `/scripts/dist/` 开头的空根路径(正则 `(^|[\s"'=])/scripts/dist/`);③所有 `scripts/dist/…` 引用都以传入的绝对 pluginRoot 为前缀。`node --experimental-strip-types --test plugin/test/fan-in-execute-plugin-root-arg.test.mjs` 退出 0。取假:把构建改回旧拼写后 ①② 红(附实跑输出)。 —— 实测:node --experimental-strip-types --test plugin/test/fan-in-execute-plugin-root-arg.test.mjs ⇒ 7 tests / pass 7 / fail 0;取假用例把绑定换回 0.15.0 的 fold 拼写 ⇒ 提示词仍含字面锚点(①红)、模拟空环境展开后命中 (^|[\s"'=])/scripts/dist/(②红)。
- [x] 入口校验用例:不传 `args.pluginRoot` ⇒ 以稳定错误码 `plugin-root-not-provided` 拒绝且 `agent` mock 从未被调用;传入不存在 `scripts/dist` 的目录 ⇒ `plugin-root-invalid`;两种错误输出与成功输出可区分。 —— 实测:不传 pluginRoot ⇒ outcome=plugin-root-not-provided 且捕获 0 个 prompt(agent 未被调用);相对 pluginRoot ⇒ plugin-root-invalid;真实执行 entry preflight:含 scripts/dist 的目录 exit 0(PLUGIN_ROOT_OK),空目录 exit 9(PLUGIN_ROOT_INVALID);phase-1 报 plugin-root-invalid ⇒ 工作流返回同码并点名该 pluginRoot。
- [x] 清环境实证:在 `env -u CLAUDE_PLUGIN_ROOT` 的环境里重复上述 harness 用例,结果与设置了该变量时**完全相同**(证明不依赖环境变量);对 `execute-suite-fix.js`、`pool-quality-judge.js`、`manager-tick-core.js` 各做同样检查——凡含 `CLAUDE_PLUGIN_ROOT` 的,改为同一方式并通过断言;凡不受影响的,在完成记录里贴出该文件中每处出现的上下文,逐处证明"不会在 agent shell 里展开"。 —— 实测:env -u CLAUDE_PLUGIN_ROOT 下同一文件 7/7 绿;断言 CLAUDE_PLUGIN_ROOT 未设/设为两个不同错值时发出的 prompt 逐字节相同;三个同类 workflow 改为同一 binding+校验并在该文件断言(built 载体 0 锚点 + 定义 const PLUGIN_ROOT + dev 缺省被构建清空 + 缺失/相对各返回稳定码)。
- [x] 构建产物扫描:`packages/quay/test/build-plugin-dist.test.mjs` 新增断言:构建出的 `workflows/*.js` 中,字面 `${CLAUDE_PLUGIN_ROOT}`(含 `${"$"}{CLAUDE_PLUGIN_ROOT}` 拼写)出现次数为 0;`.md`/`.sh` 载体的锚点保持不变。先打印改前基线(0.16.0 的 fan-in-execute.js 为 20 处)与前 3 条命中,证明谓词对改前产物能命中。 —— 实测:build-plugin-dist.test.mjs 打印改前基线 {"manager-tick-core":2,"pool-quality-judge":3,"fan-in-execute":22,"execute-suite-fix":3} 与前 3 条命中,断言 6 个 built workflows/*.js 的两种锚点拼写均为 0;.md/.sh 载体锚点保持不变(rewriteMarkdown/rewriteShell 断言)。该文件 44 tests 全绿。
- [x] 调用方文档:`grep -rn "scriptPath" plugin/skills plugin/loop plugin/workflows plugin/README.md README.md --include=*.md --include=*.js` 中凡给出 `Workflow({scriptPath…})` 调用示例的位置都带 `pluginRoot`;列出命中与处理结果,不得凭记忆。 —— grep -rn scriptPath plugin/skills plugin/loop plugin/workflows plugin/README.md README.md --include=*.md --include=*.js ⇒ 命中 2 处:plugin/workflows/fan-in-execute.js(meta whenToUse,已补 pluginRoot 及其缺失/非绝对错误码)与 plugin/loop/fast-mode-tick-core.md:40(A6 行,只描述 scriptPath 兜底机制、不含 Workflow({scriptPath…}) 调用示例 ⇒ 无需改;args 契约正本在 workflow meta,已更新)。
- [x] 开发树不回归:`node --experimental-strip-types --test plugin/test/fan-in-execute-paths-s01.test.mjs plugin/test/fan-in-execute-paths-s02.test.mjs plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs plugin/test/fan-in-execute-paths-s05.test.mjs` 退出 0(开发树形态缺省 pluginRoot=`${worktree}/plugin`)。 —— 实测:node --experimental-strip-types --test plugin/test/fan-in-execute-paths-s01..s05.test.mjs ⇒ 全绿(另跑 s06-s12 共 12 shard 亦全绿);开发树缺省 pluginRoot=<worktree>/plugin,发出的命令与改前逐字节一致。
- [x] 读生产载体:从本机已安装的 0.16.0(或重新构建发布后的版本)缓存里取 `workflows/fan-in-execute.js`,在一个清掉 `CLAUDE_PLUGIN_ROOT` 的普通会话里,以真实 `Workflow({scriptPath, args:{…, pluginRoot}})` 派发到**第一个 agent 步骤的命令被发出为止**(⛔ 不得对真实任务执行 fan-in 落地;用一个一次性临时 workspace/任务,或在 args 里使用 dry 模式,若 workflow 没有 dry 模式则以 mock agent 的 harness 实证并写明为何不能真派发),把该命令原文贴进完成记录,证明其中的路径是绝对路径。该 AC 在撤销 (A)(B) 改动后必须变红(负控制)。 —— 生产载体:把 plugin/ stage 到临时目录并以生产改写器 rewriteInvokers 重写(41 invokers),产出的 workflows/fan-in-execute.js 锚点 0、binding 引用 22、DEV 缺省被清空;清掉 CLAUDE_PLUGIN_ROOT 后以 args.pluginRoot=<stage> 派发到阶段 1 prompt,首条命令原文 `node /tmp/quay-stage-XXXX/scripts/dist/select-static-checks-for-touches.js --bootstrap-orchestration --root /tmp/wt $bootstrap_delta`(绝对路径)。fan-in 无 dry 模式且不得对真实任务落地 ⇒ 以 mock agent harness 实证;该 AC 的负控制 = 上面的 AC1 取假用例。
- [x] `bash scripts/test.sh --for-task gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions` 退出 0 且执行了 ≥1 个测试文件。 —— 实测:bash scripts/test.sh --for-task gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions --allow-thin ⇒ EXIT=0,执行 98 个测试(含本任务新增 plugin/test/fan-in-execute-plugin-root-arg.test.mjs)。

## DoD
真实落地:在一个没有 `CLAUDE_PLUGIN_ROOT` 环境变量的普通 CloudCLI 会话里,用发布版 `quay:fan-in-execute`(以及同类的另外三个 workflow,若受影响)按文档的调用示例派发,发出的 agent 命令里每个 `scripts/dist/…` 路径都是绝对路径且文件存在;缺少或写错 `pluginRoot` 时得到稳定错误码而不是运行期的 `/scripts/dist/…` 失败。仅"加载不报错"不算完成。

## Evidence

### 附带修复:config-validate.test.mjs AC4 的取假控制挂在移动的 `develop` 上(开发面、无主红)

**现象**:fan-in suite 唯一红是 `packages/quay/test/config-validate.test.mjs` AC4 的
`AssertionError: the predicate must match the pre-change file`。delta-relatedness 判 UNRELATED,
但它**可复现**(连续两轮 exited-not-landed + 本轮单独重跑),不是 flake。

**根因(实测,非推断)**:该 AC4 的取假半边拿 `git show develop:packages/quay/src/config-validate.ts`
当"改前文件",断言谓词 `/\.mcp_entry\b|\[\s*["']mcp_entry["']\s*\]/` 至少命中 1 行。而 `6f747e39e`
(`fix(config): single judge for the native provider's mcp_entry binding`)**同时**删掉了原始 `.mcp_entry`
访问**并**新增了这条断言,且已落在 develop 上 ⇒ `develop` 本身就是"改后"状态。读数:
`6f747e39e^` ⇒ 1 命中;`6f747e39e` ⇒ 0;`develop` ⇒ 0 ⇒ 该断言在 develop 上恒假,**每个任务的
fan-in suite 都红**。这是"before/after 判据不是单态检查":它只在落地窗口内成立。

**无主取证(三项全过 ⇒ 无人会修)**:① `grep -rl config-validate tasks/*.md` ∩ `status: ready` ⇒ 命中的
ready 任务 `gap-release-gate-verify-plugin-channel-misses-config-validate-version-pointer-scope-and-upgrade-assertions`
的 `## Touches` **不含**该文件;② 无 peer 任务分支改过 `packages/quay/test/config-validate.test.mjs`
(`git diff --name-only develop...task/*` 全 0);③ 在飞 worker 只有上面那个 + 本任务。
⇒ 按 `orphaned-develop-wide-static-red-self-fix` 自行修 + 放宽 Touches。

**修法(最小)**:把"改前修订"从**移动的 ref `develop`** 换成**固定的 `6f747e39e^`**(不可变,父提交),
其余不动。同款先例:`gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs` 的
`303a94950^:packages/quay/src/serve-git.ts`。固定对象缺失时 `exec` 抛错 ⇒ 测试红,不静默通过(硬规则 3b)。

**读数**:`6f747e39e^` ⇒ 1 命中(控制可命中);`6f747e39e` / `develop` ⇒ 0(控制仍能取假);
`node --experimental-strip-types --test packages/quay/test/config-validate.test.mjs` ⇒ tests 63 / pass 63 / fail 0。
anti-drift 在放宽前 `out-of-declared: packages/quay/test/config-validate.test.mjs` hard fail(exit 1);
放宽 Touches 并 merge develop 进 worktree 后复跑 ⇒ 通过。