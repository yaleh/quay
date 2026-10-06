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
- `tasks/gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions.md`

## AC
- [ ] 新增测试 `plugin/test/fan-in-execute-plugin-root-arg.test.mjs`,沿用 `fan-in-execute-paths-s0*.test.mjs` 的真实调用 harness(vm 执行构建产物 workflow 文件,mock workflow 运行时全局 args/phase/log/agent,捕获其发出的 agent prompt):用**构建出的发布版** `fan-in-execute.js`,传 `args.pluginRoot = <临时插件根,含 scripts/dist 目录>`,断言发出的全部 prompt/命令中 ①不含字面 `${CLAUDE_PLUGIN_ROOT}`;②不含以 `/scripts/dist/` 开头的空根路径(正则 `(^|[\s"'=])/scripts/dist/`);③所有 `scripts/dist/…` 引用都以传入的绝对 pluginRoot 为前缀。`node --experimental-strip-types --test plugin/test/fan-in-execute-plugin-root-arg.test.mjs` 退出 0。取假:把构建改回旧拼写后 ①② 红(附实跑输出)。
- [ ] 入口校验用例:不传 `args.pluginRoot` ⇒ 以稳定错误码 `plugin-root-not-provided` 拒绝且 `agent` mock 从未被调用;传入不存在 `scripts/dist` 的目录 ⇒ `plugin-root-invalid`;两种错误输出与成功输出可区分。
- [ ] 清环境实证:在 `env -u CLAUDE_PLUGIN_ROOT` 的环境里重复上述 harness 用例,结果与设置了该变量时**完全相同**(证明不依赖环境变量);对 `execute-suite-fix.js`、`pool-quality-judge.js`、`manager-tick-core.js` 各做同样检查——凡含 `CLAUDE_PLUGIN_ROOT` 的,改为同一方式并通过断言;凡不受影响的,在完成记录里贴出该文件中每处出现的上下文,逐处证明"不会在 agent shell 里展开"。
- [ ] 构建产物扫描:`packages/quay/test/build-plugin-dist.test.mjs` 新增断言:构建出的 `workflows/*.js` 中,字面 `${CLAUDE_PLUGIN_ROOT}`(含 `${"$"}{CLAUDE_PLUGIN_ROOT}` 拼写)出现次数为 0;`.md`/`.sh` 载体的锚点保持不变。先打印改前基线(0.16.0 的 fan-in-execute.js 为 20 处)与前 3 条命中,证明谓词对改前产物能命中。
- [ ] 调用方文档:`grep -rn "scriptPath" plugin/skills plugin/loop plugin/workflows plugin/README.md README.md --include=*.md --include=*.js` 中凡给出 `Workflow({scriptPath…})` 调用示例的位置都带 `pluginRoot`;列出命中与处理结果,不得凭记忆。
- [ ] 开发树不回归:`node --experimental-strip-types --test plugin/test/fan-in-execute-paths-s01.test.mjs plugin/test/fan-in-execute-paths-s02.test.mjs plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs plugin/test/fan-in-execute-paths-s05.test.mjs` 退出 0(开发树形态缺省 pluginRoot=`${worktree}/plugin`)。
- [ ] 读生产载体:从本机已安装的 0.16.0(或重新构建发布后的版本)缓存里取 `workflows/fan-in-execute.js`,在一个清掉 `CLAUDE_PLUGIN_ROOT` 的普通会话里,以真实 `Workflow({scriptPath, args:{…, pluginRoot}})` 派发到**第一个 agent 步骤的命令被发出为止**(⛔ 不得对真实任务执行 fan-in 落地;用一个一次性临时 workspace/任务,或在 args 里使用 dry 模式,若 workflow 没有 dry 模式则以 mock agent 的 harness 实证并写明为何不能真派发),把该命令原文贴进完成记录,证明其中的路径是绝对路径。该 AC 在撤销 (A)(B) 改动后必须变红(负控制)。
- [ ] `bash scripts/test.sh --for-task gap-workflow-js-carriers-emit-literal-plugin-root-env-ref-that-is-unset-in-plain-sessions` 退出 0 且执行了 ≥1 个测试文件。

## DoD
真实落地:在一个没有 `CLAUDE_PLUGIN_ROOT` 环境变量的普通 CloudCLI 会话里,用发布版 `quay:fan-in-execute`(以及同类的另外三个 workflow,若受影响)按文档的调用示例派发,发出的 agent 命令里每个 `scripts/dist/…` 路径都是绝对路径且文件存在;缺少或写错 `pluginRoot` 时得到稳定错误码而不是运行期的 `/scripts/dist/…` 失败。仅"加载不报错"不算完成。
